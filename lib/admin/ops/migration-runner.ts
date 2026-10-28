import type { Client } from 'pg'
import { compareVersions, substituteOwner, type MigrationFile } from './migrations'

/**
 * Migration runner for any PostgreSQL (usertasks-admin db migrate|status|repair).
 *
 * History lives in supabase_migrations.schema_migrations — the table the
 * Supabase CLI keeps (version, statements, name) — so a database migrated by
 * `supabase db push` and one migrated here read the same history, and either
 * tool can take over from the other. File checksums (which the Supabase table
 * has no column for) go in supabase_migrations.usertasks_checksums.
 *
 *  - Each migration runs in its own transaction together with its history
 *    row: it applies completely or not at all.
 *  - A session advisory lock serialises concurrent runs (two replicas
 *    starting at once): the second waits, then finds nothing to do. Use a
 *    direct / session-mode connection — not PgBouncer transaction mode.
 *  - Pending versions older than the newest applied one are refused unless
 *    includeAll, like `supabase db push` (mark them with repair, or include).
 *  - Applied files whose checksum changed are reported, never re-run.
 */

const LOCK_KEY = 'usertasks.migrations'
const HISTORY = 'supabase_migrations.schema_migrations'
const CHECKSUMS = 'supabase_migrations.usertasks_checksums'

export interface AppliedMigration {
  version: string
  name: string | null
  checksum: string | null
}

export interface TargetInfo {
  /** Supabase databases are migrated as-is (supabase_admin exists). */
  supabase: boolean
  currentUser: string
  serverVersion: number
  /** Role the dump's "postgres" ownership statements are pointed at. */
  owner: string
  superuser: boolean
}

export type MigrationState = 'applied' | 'pending' | 'out_of_order' | 'changed' | 'missing_file'

export interface StatusRow {
  version: string
  name: string
  state: MigrationState
}

export interface MigrateOptions {
  dryRun?: boolean
  includeAll?: boolean
  /** Owner for the dump's "postgres" statements (default: postgres when usable, else current_user). */
  owner?: string
  lockTimeoutMs?: number
  log?: (line: string) => void
}

export interface MigrateResult {
  target: TargetInfo
  applied: string[]
  pending: string[]
  warnings: string[]
}

export async function ensureHistory(db: Client): Promise<void> {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS ${HISTORY} (version text PRIMARY KEY, statements text[], name text);
    CREATE TABLE IF NOT EXISTS ${CHECKSUMS} (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT current_user
    );`)
}

/** History rows, or [] when the database has never been migrated. */
export async function readApplied(db: Client): Promise<AppliedMigration[]> {
  const { rows: exists } = await db.query<{ history: string | null; sums: string | null }>(
    `SELECT to_regclass('${HISTORY}')::text AS history, to_regclass('${CHECKSUMS}')::text AS sums`,
  )
  if (!exists[0]?.history) return []
  const sql = exists[0].sums
    ? `SELECT h.version, h.name, c.checksum FROM ${HISTORY} h LEFT JOIN ${CHECKSUMS} c USING (version)`
    : `SELECT version, name, NULL::text AS checksum FROM ${HISTORY}`
  const { rows } = await db.query<AppliedMigration>(sql)
  return rows.sort((a, b) => compareVersions(a.version, b.version))
}

export async function describeTarget(db: Client, ownerOverride?: string): Promise<TargetInfo> {
  const { rows } = await db.query<{ supabase: boolean; current_user: string; server_version: string; superuser: boolean; postgres_usable: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS supabase,
           current_user::text AS current_user,
           current_setting('server_version_num') AS server_version,
           (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
           EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
             AND pg_has_role(current_user, (SELECT oid FROM pg_roles WHERE rolname = 'postgres'), 'USAGE') AS postgres_usable`)
  const r = rows[0]
  const owner = ownerOverride ?? (r.supabase || r.postgres_usable ? 'postgres' : r.current_user)
  return { supabase: r.supabase, currentUser: r.current_user, serverVersion: Number(r.server_version), owner, superuser: r.superuser }
}

export function computeStatus(files: MigrationFile[], applied: AppliedMigration[]): StatusRow[] {
  const byVersion = new Map(applied.map((a) => [a.version, a]))
  const local = new Set(files.map((f) => f.version))
  const newestApplied = applied.length ? applied[applied.length - 1].version : null
  const rows: StatusRow[] = []
  for (const f of files) {
    const a = byVersion.get(f.version)
    let state: MigrationState
    if (a) state = a.checksum && a.checksum !== f.checksum ? 'changed' : 'applied'
    else state = newestApplied && compareVersions(f.version, newestApplied) < 0 ? 'out_of_order' : 'pending'
    rows.push({ version: f.version, name: f.name, state })
  }
  for (const a of applied) {
    if (!local.has(a.version)) rows.push({ version: a.version, name: a.name ?? '', state: 'missing_file' })
  }
  return rows.sort((a, b) => compareVersions(a.version, b.version))
}

async function withLock<T>(db: Client, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { rows } = await db.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [LOCK_KEY])
    if (rows[0]?.ok) break
    if (Date.now() >= deadline) throw new Error('Another migration run holds the lock (usertasks.migrations); try again when it finishes')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  try {
    return await fn()
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]).catch(() => undefined)
  }
}

export async function migrate(db: Client, files: MigrationFile[], options: MigrateOptions = {}): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined)
  const target = await describeTarget(db, options.owner)
  return withLock(db, options.lockTimeoutMs ?? 60_000, async () => {
    const applied = await readApplied(db)
    const status = computeStatus(files, applied)
    const warnings: string[] = []
    for (const row of status) {
      if (row.state === 'changed') warnings.push(`${row.version}_${row.name}: file changed since it was applied (not re-run)`)
      if (row.state === 'missing_file') warnings.push(`${row.version}: applied but has no local file`)
    }
    const outOfOrder = status.filter((r) => r.state === 'out_of_order')
    if (outOfOrder.length && !options.includeAll) {
      throw new Error(
        `Found migrations older than the last applied one: ${outOfOrder.map((r) => r.version).join(', ')}. ` +
          'Apply them with --include-all, or mark them applied with `db repair --status applied <version>`.',
      )
    }
    const todo = status.filter((r) => r.state === 'pending' || r.state === 'out_of_order').map((r) => files.find((f) => f.version === r.version)!)
    const result: MigrateResult = { target, applied: [], pending: todo.map((f) => f.version), warnings }
    if (options.dryRun || todo.length === 0) return result

    await ensureHistory(db)
    for (const file of todo) {
      const sql = target.supabase ? file.sql : substituteOwner(file.sql, target.owner)
      log(`applying ${file.version}_${file.name}`)
      await db.query('BEGIN')
      try {
        await db.query(sql)
        // Session settings a dump may change (search_path ''): restore for the bookkeeping.
        await db.query('RESET search_path')
        await db.query(`INSERT INTO ${HISTORY} (version, name, statements) VALUES ($1, $2, $3)`, [file.version, file.name, [file.sql]])
        await db.query(
          `INSERT INTO ${CHECKSUMS} (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), applied_by = current_user`,
          [file.version, file.checksum],
        )
        await db.query('COMMIT')
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined)
        const e = err as Error & { position?: string; where?: string }
        throw new Error(`${file.version}_${file.name} failed: ${e.message}${e.where ? ` (${e.where})` : ''}`)
      } finally {
        // SET (not LOCAL) in a migration persists on the session; start each file clean.
        await db.query('RESET ALL').catch(() => undefined)
      }
      result.applied.push(file.version)
    }
    return result
  })
}

export interface RepairOptions {
  status: 'applied' | 'reverted'
  versions: string[]
}

/** Marks versions applied (without running them) or removes them from the history, like `supabase migration repair`. */
export async function repair(db: Client, files: MigrationFile[], options: RepairOptions): Promise<string[]> {
  if (!options.versions.length) throw new Error('repair needs at least one version')
  return withLock(db, 60_000, async () => {
    await ensureHistory(db)
    await db.query('BEGIN')
    try {
      for (const version of options.versions) {
        if (options.status === 'applied') {
          const file = files.find((f) => f.version === version)
          if (!file) throw new Error(`No migration file for version ${version}`)
          await db.query(
            `INSERT INTO ${HISTORY} (version, name, statements) VALUES ($1, $2, $3) ON CONFLICT (version) DO NOTHING`,
            [file.version, file.name, [file.sql]],
          )
          await db.query(
            `INSERT INTO ${CHECKSUMS} (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum`,
            [file.version, file.checksum],
          )
        } else {
          await db.query(`DELETE FROM ${HISTORY} WHERE version = $1`, [version])
          await db.query(`DELETE FROM ${CHECKSUMS} WHERE version = $1`, [version])
        }
      }
      await db.query('COMMIT')
    } catch (err) {
      await db.query('ROLLBACK').catch(() => undefined)
      throw err
    }
    return options.versions
  })
}
