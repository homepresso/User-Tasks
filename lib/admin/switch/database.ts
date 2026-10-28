import type pg from 'pg'
import { isSecretRef, resolveSecretRef } from '@/lib/config/secret-refs'
import { maskUrl, type SqlClient } from '../ops/instance-db'
import { loadMigrations } from '../ops/migrations'
import { migrate } from '../ops/migration-runner'
import {
  connectTarget,
  copySequences,
  copySize,
  copyTables,
  fkOrder,
  formatSize,
  listTables,
  matchTables,
  restoreConstraints,
  tableChecksum,
  tableKey,
  targetConnectionFrom,
  targetPrivileges,
  type CopyState,
  type TargetConnection,
} from './db-copy'
import { insertRecord, newRecord } from './log'
import type { AreaSwitch, PreflightCheck, SwitchContext } from './types'

export { COPY_SCHEMAS, copySequences, listTables, matchTables, type CopyTable } from './db-copy'

/**
 * database: copy the app database into another PostgreSQL 15+ (plain
 * Postgres, RDS, Azure Flexible Server, Cloud SQL, …) and point the app at
 * it — everything over the connection the operator gives, in-process (no
 * pg_dump / psql, ./db-copy):
 *
 *  0. pre-flight: reachability, version, what the target role may do (with
 *     the one-time SQL a DBA runs when it may not), extensions, the data
 *     size to copy, an empty or non-empty target, Supabase-only providers;
 *  1. prepare the target: the built-in migration runner applies the whole
 *     chain (the compat bootstrap first: roles, auth shim, extensions
 *     schema) — `--prepare-only` stops here (a fresh, empty install);
 *  2. copy every table of schemas public and app_auth in foreign-key order,
 *     in primary-key batches with progress per table; resumable after an
 *     interruption and in chunks (a deadline pauses it between batches);
 *  3. carry sequence positions over;
 *  4. verify row counts and checksums table by table;
 *  5. RLS smoke test: for a few users, the rows visible as `authenticated`
 *     with their JWT claims must match table by table;
 *  6. cut over: copy the switch record into the target's log and print the
 *     new environment (DB_PROVIDER=postgres, DATABASE_URL) — the database is
 *     bootstrap config, so nothing is written to instance_settings.
 * The source is only read. Rollback = point the app back at it (writes made
 * to the target since are not copied back).
 */

const COPY_STATE = 'copy'
const VOLATILE_TABLES = new Set(['public.instance_provider_switches'])
const VERIFY_STATE = 'verify'

/** The target connection from the flags, with a secret:// password / URL resolved through the secret store. */
async function targetConnection(ctx: SwitchContext): Promise<TargetConnection | null> {
  const flags: Record<string, unknown> = { ...ctx.options.flags }
  for (const name of ['target-url', 'target-password']) {
    const value = flags[name]
    if (typeof value === 'string' && isSecretRef(value)) {
      const secrets = ctx.config.providers.secrets
      const { secretStoreFor } = await import('@/lib/providers/secrets')
      flags[name] = await resolveSecretRef(value, secretStoreFor(secrets.id, secrets.options), { label: `--${name}` })
    }
  }
  return targetConnectionFrom(flags)
}

// One target connection per switch run, closed by the engine's cleanup.
const targets = new WeakMap<SwitchContext, Promise<pg.Client>>()

function target(ctx: SwitchContext): Promise<pg.Client> {
  let client = targets.get(ctx)
  if (!client) {
    client = targetConnection(ctx).then((conn) => {
      if (!conn) throw new Error('no target database given')
      return connectTarget(conn)
    })
    targets.set(ctx, client)
    ctx.cleanup.push(async () => (await client!).end())
    client.catch(() => targets.delete(ctx))
  }
  return client
}

const prepareOnly = (ctx: SwitchContext) => ctx.options.flags['prepare-only'] === true

function copyState(ctx: SwitchContext): CopyState {
  const state = (ctx.rollbackData[COPY_STATE] ??= { tables: {} }) as CopyState
  return state
}

export const RLS_SMOKE_TABLES = ['public.tenants', 'public.users', 'public.tasks', 'public.workflows', 'public.notifications', 'public.roles', 'public.teams', 'public.custom_tables']

/** Rows each user sees under RLS (authenticated + JWT claims), per table. */
export async function rlsSnapshot(db: SqlClient, userIds: string[], tables = RLS_SMOKE_TABLES): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {}
  const present: string[] = []
  for (const table of tables) {
    const { rows } = await db.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [table])
    if (rows[0]?.ok) present.push(table)
  }
  for (const id of userIds) {
    out[id] = {}
    await db.query('BEGIN')
    try {
      await db.query('SET LOCAL ROLE authenticated')
      await db.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: id, role: 'authenticated' }), id])
      for (const table of present) {
        const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)
        out[id][table] = Number(rows[0]?.n ?? 0)
      }
    } finally {
      await db.query('ROLLBACK').catch(() => undefined)
    }
  }
  return out
}

async function isSupabase(db: SqlClient): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS ok`)
  return rows[0]?.ok === true
}

export const databaseSwitch: AreaSwitch = {
  area: 'db',
  writesProviderSetting: false,
  sameProviderAllowed: true,
  supports(_from, to) {
    return to === 'postgres' ? null : 'The database can be switched to the postgres provider (any PostgreSQL 15+). Moving to another Supabase project is a Supabase dump / restore.'
  },
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    let conn: TargetConnection | null
    try {
      conn = await targetConnection(ctx)
    } catch (error) {
      return [{ name: 'target', severity: 'error', detail: (error as Error).message }]
    }
    if (!conn) return [{ name: 'target', severity: 'error', detail: '--target-url <postgres://…> (or --target-host, --target-database, --target-user) is required: the database to copy into' }]
    const url = conn.url
    let t: pg.Client
    const started = Date.now()
    try {
      t = await target(ctx)
    } catch (error) {
      return [{ name: 'target', severity: 'error', detail: `cannot connect to ${maskUrl(url)} from this host: ${(error as Error).message}` }]
    }
    checks.push({ name: 'reachable', severity: 'ok', detail: `connected in ${Date.now() - started} ms${conn.auth && conn.auth !== 'password' ? ` (${conn.auth} token auth)` : ''}${/sslmode=(require|verify)/.test(url) || conn.ca ? ', TLS' : ''}` })
    const { rows: [info] } = await t.query<{ version: number; db: string; user: string; sysid: string }>(
      `SELECT current_setting('server_version_num')::int AS version, current_database() AS db, current_user AS user,
              (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
    ).catch(async () => t.query<{ version: number; db: string; user: string; sysid: string }>(
      `SELECT current_setting('server_version_num')::int AS version, current_database() AS db, current_user AS user, '' AS sysid`))
    const { rows: [src] } = await ctx.db.query<{ db: string; sysid: string }>(
      `SELECT current_database() AS db, (SELECT system_identifier::text FROM pg_control_system()) AS sysid`,
    ).catch(async () => ctx.db.query<{ db: string; sysid: string }>(`SELECT current_database() AS db, '' AS sysid`))
    if (info.sysid && info.sysid === src.sysid && info.db === src.db) checks.push({ name: 'target', severity: 'error', detail: 'the target is the source database' })
    const major = Math.floor(info.version / 10000)
    checks.push({ name: 'target', severity: major >= 15 ? 'ok' : 'error', detail: `${maskUrl(url)} — PostgreSQL ${major} as ${info.user}${major >= 15 ? '' : ' (15 or later required)'}` })

    const targetSupabase = await isSupabase(t)
    if (!targetSupabase) {
      const privileges = await targetPrivileges(t)
      checks.push(...privileges.checks)
      if (privileges.dbaSql.length) {
        checks.push({ name: 'dba sql', severity: 'warn', detail: `run once as an admin, then test again:\n${privileges.dbaSql.join('\n')}` })
      }
    }
    const cfg = ctx.config.providers
    if (!targetSupabase && !prepareOnly(ctx)) {
      if (cfg.auth.id === 'supabase') checks.push({ name: 'auth', severity: 'error', detail: 'auth is Supabase Auth, which needs a Supabase database: run `usertasks-admin switch auth --to builtin` first' })
      if (cfg.realtime.id === 'supabase') checks.push({ name: 'realtime', severity: 'error', detail: 'realtime is Supabase Realtime: run `usertasks-admin switch realtime --to sse` first' })
      if (cfg.scheduler.id === 'pg_cron') {
        const { rows } = await t.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') AS ok`)
        if (!rows[0]?.ok) checks.push({ name: 'scheduler', severity: 'error', detail: 'the target has no pg_cron: run `usertasks-admin switch scheduler --to worker` (or external) first' })
      }
      if (cfg.storage.id === 'supabase') checks.push({ name: 'storage', severity: 'warn', detail: 'storage stays on Supabase Storage (it keeps working while the project exists); `switch storage` moves the files' })
    }
    if (!prepareOnly(ctx)) {
      const size = await copySize(ctx.db).catch(() => 0)
      checks.push({ name: 'size', severity: 'ok', detail: `about ${formatSize(size)} of tables and indexes to copy: the target needs at least that much free space` })
    }
    // Planner estimates: cheap on big databases (re-checked on every chunk of a chunked run).
    const { rows: [est] } = await t.query<{ n: string }>(
      `SELECT coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint::text AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    )
    const resumed = Object.keys(copyState(ctx).tables).length > 0
    const rows = Number(est?.n ?? 0)
    checks.push(resumed
      ? { name: 'target data', severity: 'ok', detail: 'continuing an earlier run of this switch' }
      : { name: 'target data', severity: rows > 0 ? 'warn' : 'ok', detail: rows > 0 ? `the target already has about ${rows} row(s): they will be replaced by the source's` : 'the target is empty' })
    return checks
  },
  steps(ctx) {
    const steps: ReturnType<AreaSwitch['steps']> = [
      {
        id: 'migrate-target',
        title: 'Prepare the target (compat bootstrap and migrations)',
        async plan() {
          const t = await target(ctx)
          const dir = typeof ctx.options.flags.dir === 'string' ? ctx.options.flags.dir : process.env.MIGRATIONS_DIR || 'supabase/migrations'
          const result = await migrate(t, loadMigrations(dir), { dryRun: true })
          return result.pending.length ? `apply ${result.pending.length} migration(s)` : 'already at head'
        },
        async run() {
          const t = await target(ctx)
          const dir = typeof ctx.options.flags.dir === 'string' ? ctx.options.flags.dir : process.env.MIGRATIONS_DIR || 'supabase/migrations'
          const result = await migrate(t, loadMigrations(dir), { log: () => undefined })
          return result.applied.length ? `applied ${result.applied.length} migration(s)` : 'already at head'
        },
      },
    ]
    if (prepareOnly(ctx)) {
      ctx.notes.push('The target is prepared (empty, at the latest migration). Point a fresh install at it, or run this switch again without --prepare-only to copy the data.')
      return steps
    }
    steps.push(
      {
        id: 'copy-data',
        title: 'Copy table data',
        async plan() {
          const t = await target(ctx)
          const { tables, onlySource } = matchTables(await listTables(ctx.db), await listTables(t))
          return `${tables.length} table(s) in foreign-key order${onlySource.length ? `; not in the target yet (created by the migrations first): ${onlySource.length}` : ''}`
        },
        async run() {
          const t = await target(ctx)
          const { tables, onlySource } = matchTables(await listTables(ctx.db), await listTables(t))
          if (onlySource.length) ctx.warn(`  warning: not in the target schema (skipped): ${onlySource.join(', ')}`)
          const state = copyState(ctx)
          if (!state.mode) state.mode = (await targetPrivileges(t)).replicaMode ? 'replica' : 'owner'
          const ordered = await fkOrder(ctx.db, tables)
          let lastSave = 0
          // Always save where the copy got to (also when it pauses at the deadline or fails).
          const result = await copyTables(ctx.db, t, ordered, {
            state,
            deadline: ctx.options.deadline,
            batch: Number(ctx.options.flags['copy-batch']) || undefined,
            log: ctx.log,
            save: async () => {
              if (Date.now() - lastSave < 1000) return
              lastSave = Date.now()
              await ctx.persist()
            },
            progress: (done, total) => ctx.progress(done / total),
          }).finally(() => ctx.persist())
          return `${result.rows} row(s) in ${result.tables} table(s) (${state.mode === 'replica' ? 'triggers off' : 'owner mode'})`
        },
      },
      {
        id: 'constraints',
        title: 'Re-create foreign keys and triggers',
        async run() {
          const state = copyState(ctx)
          if (state.mode !== 'owner') return 'not needed (replica mode)'
          const n = await restoreConstraints(await target(ctx), state, ctx.log)
          await ctx.persist()
          return `${n} foreign key(s) re-created and validated; user triggers re-enabled`
        },
      },
      {
        id: 'sequences',
        title: 'Copy sequence positions',
        async run() {
          return `${await copySequences(ctx.db, await target(ctx))} sequence(s)`
        },
      },
      {
        id: 'verify-counts',
        title: 'Verify row counts and checksums',
        async run() {
          const t = await target(ctx)
          const { tables } = matchTables(await listTables(ctx.db), await listTables(t))
          const done = (ctx.rollbackData[VERIFY_STATE] ??= {}) as Record<string, string>
          const diff: string[] = []
          let checked = 0
          let thisRun = 0
          for (const [i, table] of tables.entries()) {
            const key = tableKey(table)
            if (done[key]) { checked++; continue }
            if (ctx.options.deadline && thisRun > 0 && Date.now() >= ctx.options.deadline) {
              await ctx.persist()
              const { DeadlineReached } = await import('./db-copy')
              throw new DeadlineReached()
            }
            const [a, b] = await Promise.all([tableChecksum(ctx.db, table), tableChecksum(t, table)])
            if (a.rows !== b.rows) diff.push(`${key} rows ${a.rows}≠${b.rows}`)
            // The switch log changes while this very switch runs (its own record): counts only.
            else if (a.checksum !== b.checksum && !VOLATILE_TABLES.has(key)) diff.push(`${key} checksum differs`)
            else done[key] = a.checksum
            checked++
            thisRun++
            ctx.progress((i + 1) / tables.length)
          }
          await ctx.persist()
          if (diff.length) {
            // A failed verification starts the copy of those tables again on the next run.
            const state = copyState(ctx)
            for (const d of diff) delete state.tables[d.split(' ')[0]]
            await ctx.persist()
            throw new Error(`tables differ: ${diff.slice(0, 10).join(', ')} (re-run the switch to copy them again)`)
          }
          return `${checked} table(s) match (rows and checksums)`
        },
      },
      {
        id: 'rls-smoke',
        title: 'RLS smoke test',
        async run() {
          const t = await target(ctx)
          const { rows } = await ctx.db.query<{ id: string }>(
            `SELECT id::text FROM public.users WHERE coalesce(current_tenant_id, tenant_id) IS NOT NULL ORDER BY created_at LIMIT 3`,
          ).catch(() => ({ rows: [] as Array<{ id: string }> }))
          const ids = rows.map((r) => r.id)
          if (!ids.length) return 'no users to test with'
          const [a, b] = await Promise.all([rlsSnapshot(ctx.db, ids), rlsSnapshot(t, ids)])
          const diff: string[] = []
          for (const id of ids) for (const [table, n] of Object.entries(a[id])) if (b[id]?.[table] !== n) diff.push(`${table} for ${id}: ${n}≠${b[id]?.[table]}`)
          if (diff.length) throw new Error(`RLS visibility differs: ${diff.slice(0, 5).join(', ')}`)
          return `${ids.length} user(s) × ${Object.keys(a[ids[0]]).length} table(s) identical`
        },
      },
      {
        id: 'record',
        title: 'Cut over: record the switch in the target, print the new environment',
        async run() {
          const t = await target(ctx)
          const url = (await targetConnection(ctx))!.url
          const { rows } = await t.query<{ ok: boolean }>(`SELECT to_regclass('public.instance_provider_switches') IS NOT NULL AS ok`)
          if (rows[0]?.ok) {
            // The copy brought this run's own row over while it was still running.
            await t.query('DELETE FROM public.instance_provider_switches WHERE id = $1', [ctx.switchId])
            await insertRecord(t, newRecord({
              id: ctx.switchId, kind: 'switch', area: 'db', from_provider: ctx.from, to_provider: ctx.to, actor: ctx.options.actor,
              backup_dir: null, status: 'succeeded', finished_at: new Date().toISOString(),
              env_changes: { DB_PROVIDER: 'postgres', DATABASE_URL: maskUrl(url) },
            }))
          }
          ctx.envChanges.DB_PROVIDER = 'postgres'
          ctx.envChanges.DATABASE_URL = maskUrl(url)
          const conn = (await targetConnection(ctx))!
          if (conn.auth && conn.auth !== 'password') ctx.envChanges.DATABASE_AUTH = conn.auth
          ctx.notes.push(
            'DATABASE_URL is the target you gave (password masked above). Stop writes to the source before switching',
            '(maintenance window), run this switch again for a final copy, then set the environment above and restart the app and the worker.',
          )
          return 'target log updated'
        },
      },
    )
    return steps
  },
  async rollback(ctx) {
    ctx.envChanges.DB_PROVIDER = ctx.record.from_provider ?? 'supabase'
    ctx.envChanges.DATABASE_URL = process.env.DATABASE_URL ? maskUrl(process.env.DATABASE_URL) : '(the source database URL)'
    return [
      'the source database was not changed by the switch: point the app back at it',
      'writes made to the target since the switch are not copied back',
    ]
  },
}
