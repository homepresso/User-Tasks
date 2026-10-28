import pg from 'pg'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'
import type { SqlClient } from '../ops/instance-db'
import { SwitchPaused, type PreflightCheck } from './types'

/**
 * The database switch's moving parts, all in-process over two `pg`
 * connections (no pg_dump / psql needed):
 *
 *  - the target connection from the switch flags: a URL, or host / port /
 *    database / user / password (a secret:// reference is resolved before
 *    it gets here), TLS mode and CA, and DATABASE_AUTH-style token auth
 *    (azure, gcp, aws where this build supports it);
 *  - what the target role may do, and the exact one-time SQL a DBA runs
 *    when it may not (roles, CREATE on the database / public schema,
 *    extensions);
 *  - a table copy in foreign-key order, in key-ordered batches that can
 *    stop at a deadline and continue later from the last key (chunked runs
 *    on serverless, resume after an interruption). With a role that may
 *    set session_replication_role triggers and foreign keys are off during
 *    the copy; otherwise (managed services) the target's foreign keys are
 *    dropped first and re-created afterwards, and user triggers disabled —
 *    the tables belong to the migrating role, so it may do both;
 *  - per-table row counts and checksums on both sides.
 */

export const COPY_SCHEMAS = ['public', 'app_auth']
export const COPY_BATCH = 500
const q = (name: string) => `"${name.replace(/"/g, '""')}"`

export interface CopyTable {
  schema: string
  name: string
  columns: string[]
}

export const qualified = (t: { schema: string; name: string }) => `${q(t.schema)}.${q(t.name)}`
export const tableKey = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`

// ── Target connection ───────────────────────────────────────────────────────

export interface TargetConnection {
  url: string
  auth: string | null
  sslmode: string | null
  ca: string | null
}

const flag = (flags: Record<string, unknown>, name: string): string | null => {
  const value = flags[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** --target-url, or the URL built from --target-host / -port / -database / -user / -password. */
export function targetConnectionFrom(flags: Record<string, unknown>): TargetConnection | null {
  let url = flag(flags, 'target-url')
  if (!url) {
    const host = flag(flags, 'target-host')
    const database = flag(flags, 'target-database')
    const user = flag(flags, 'target-user')
    if (!host || !database || !user) return null
    const u = new URL('postgres://placeholder')
    u.hostname = host
    u.port = flag(flags, 'target-port') ?? '5432'
    u.pathname = `/${encodeURIComponent(database)}`
    u.username = encodeURIComponent(user)
    const password = flag(flags, 'target-password')
    if (password) u.password = encodeURIComponent(password)
    url = u.toString()
  }
  const sslmode = flag(flags, 'target-sslmode')
  if (sslmode && !/[?&]sslmode=/.test(url)) url += `${url.includes('?') ? '&' : '?'}sslmode=${encodeURIComponent(sslmode)}`
  return { url, auth: flag(flags, 'target-auth'), sslmode, ca: flag(flags, 'target-ca') }
}

export function targetClientConfig(target: TargetConnection, application = 'usertasks-admin-target'): pg.ClientConfig {
  // The app's own DATABASE_AUTH / DATABASE_SSL_CA_FILE describe the source: the target gets its own.
  // aws (RDS IAM) takes its region from DATABASE_AWS_REGION / the host name / AWS_REGION and the
  // shipped RDS CA bundle, exactly like DATABASE_AUTH=aws (lib/providers/db/pg-auth).
  const caFile = target.ca && !target.ca.includes('-----BEGIN') ? target.ca : undefined
  const env: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_AUTH: target.auth && target.auth !== 'password' ? target.auth : undefined,
    DATABASE_SSL_CA_FILE: caFile,
  }
  const config = pgConnectionConfig(target.url, { application_name: application, connectionTimeoutMillis: 15_000 }, env) as pg.ClientConfig
  if (target.ca && !caFile) {
    // A CA given as PEM text: pg's connection-string ssl handling would replace an explicit ssl object, so set it here.
    config.ssl = { ca: target.ca, rejectUnauthorized: target.sslmode !== 'require' && target.sslmode !== 'prefer' }
  }
  return config
}

export async function connectTarget(target: TargetConnection, application?: string): Promise<pg.Client> {
  const client = new pg.Client(targetClientConfig(target, application))
  client.on('error', () => undefined)
  await client.connect()
  // Same text forms on both sides (checksums, json round trips).
  await client.query(`SET TIME ZONE 'UTC'; SET DateStyle = 'ISO, YMD'; SET extra_float_digits = 3; SET IntervalStyle = 'postgres'`)
  return client
}

// ── What the target role may do ─────────────────────────────────────────────

export interface TargetPrivileges {
  user: string
  database: string
  superuser: boolean
  /** May SET session_replication_role (triggers and foreign keys off during the copy). */
  replicaMode: boolean
  checks: PreflightCheck[]
  /** One-time SQL for a DBA (superuser / admin) when the role lacks something. */
  dbaSql: string[]
}

const API_ROLES = ['anon', 'authenticated', 'service_role', 'authenticator']

export async function targetPrivileges(t: SqlClient): Promise<TargetPrivileges> {
  const { rows: [info] } = await t.query<{
    user: string; db: string; superuser: boolean; createrole: boolean; create_db: boolean; owns_public: boolean; owner: string
  }>(`SELECT current_user AS user, current_database() AS db,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
             (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS createrole,
             has_database_privilege(current_user, current_database(), 'CREATE') AS create_db,
             coalesce((SELECT pg_has_role(current_user, nspowner, 'MEMBER') FROM pg_namespace WHERE nspname = 'public'), false) AS owns_public,
             (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) AS owner`)
  const checks: PreflightCheck[] = []
  const dbaSql: string[] = []
  const user = q(info.user)
  // The migrations own the public schema (as on Supabase): the role must own the database
  // (schema public belongs to pg_database_owner) — the usual "CREATE DATABASE … OWNER app" setup.
  if (!info.superuser && !info.owns_public) {
    checks.push({ name: 'database owner', severity: 'error', detail: `${info.user} does not own ${info.db} (owner: ${info.owner}), so it can't own schema public as the migrations need` })
    dbaSql.push(`ALTER DATABASE ${q(info.db)} OWNER TO ${user};`)
  } else if (!info.superuser && !info.create_db) {
    checks.push({ name: 'create schemas', severity: 'error', detail: `${info.user} may not create schemas in ${info.db}` })
    dbaSql.push(`GRANT CREATE ON DATABASE ${q(info.db)} TO ${user};`)
  } else checks.push({ name: 'database owner', severity: 'ok', detail: `${info.user} ${info.superuser ? 'is a superuser' : `owns ${info.db}`} and may create schemas` })

  const { rows: roles } = await t.query<{ rolname: string; member: boolean }>(
    `SELECT r.rolname, pg_has_role(current_user, r.oid, 'MEMBER') AS member FROM pg_roles r WHERE r.rolname = ANY($1::text[])`,
    [API_ROLES],
  )
  const existing = new Map(roles.map((r) => [r.rolname, r.member]))
  const missing = API_ROLES.filter((r) => !existing.has(r))
  if (missing.length && !info.superuser && !info.createrole) {
    checks.push({ name: 'roles', severity: 'error', detail: `roles ${missing.join(', ')} are missing and ${info.user} may not create roles` })
    for (const r of missing) dbaSql.push(`CREATE ROLE ${q(r)} NOLOGIN NOINHERIT${r === 'service_role' ? ' BYPASSRLS' : ''};`)
  } else {
    checks.push({ name: 'roles', severity: 'ok', detail: missing.length ? `${info.user} will create ${missing.join(', ')}` : 'anon, authenticated, service_role and authenticator exist' })
  }
  const notMember = ['anon', 'authenticated', 'service_role'].filter((r) => existing.has(r) && !existing.get(r))
  if (notMember.length && !info.superuser) {
    checks.push({ name: 'role membership', severity: info.createrole ? 'warn' : 'error', detail: `${info.user} is not a member of ${notMember.join(', ')} (the app switches to them per request)` })
    dbaSql.push(`GRANT ${notMember.map(q).join(', ')} TO ${user};`)
  }
  if (missing.length || notMember.length) {
    if (dbaSql.some((s) => s.startsWith('CREATE ROLE'))) dbaSql.push(`GRANT anon, authenticated, service_role TO authenticator;`, `GRANT anon, authenticated, service_role TO ${user};`)
  }

  const { rows: ext } = await t.query<{ name: string; installed: string | null; trusted: boolean | null }>(
    `SELECT a.name, a.installed_version AS installed,
            (SELECT bool_or(v.trusted) FROM pg_available_extension_versions v WHERE v.name = a.name) AS trusted
       FROM pg_available_extensions a WHERE a.name = ANY($1::text[])`,
    [['pgcrypto', 'pg_trgm']],
  )
  for (const name of ['pgcrypto', 'pg_trgm']) {
    const row = ext.find((e) => e.name === name)
    if (!row) {
      checks.push({ name: `extension ${name}`, severity: name === 'pg_trgm' ? 'warn' : 'ok', detail: name === 'pgcrypto' ? 'not available: a gen_random_uuid()-based fallback is installed instead' : 'not available on this server: text search falls back to plain matching' })
    } else if (row.installed || info.superuser || row.trusted) {
      checks.push({ name: `extension ${name}`, severity: 'ok', detail: row.installed ? `installed (${row.installed})` : 'available' })
    } else {
      checks.push({ name: `extension ${name}`, severity: 'warn', detail: `available but not trusted: ${info.user} can't create it` })
      dbaSql.push(`CREATE EXTENSION IF NOT EXISTS ${name}${name === 'pgcrypto' ? ' WITH SCHEMA extensions' : ''};`)
    }
  }

  let replicaMode = false
  try {
    await t.query('SET session_replication_role = replica')
    await t.query('RESET session_replication_role')
    replicaMode = true
  } catch { /* managed service: owner mode */ }
  checks.push(replicaMode
    ? { name: 'copy mode', severity: 'ok', detail: 'triggers and foreign keys off during the copy (session_replication_role)' }
    : { name: 'copy mode', severity: 'ok', detail: `owner mode: the target's foreign keys are dropped for the copy and re-created (validated) afterwards; user triggers are disabled meanwhile` })
  if (dbaSql.length) dbaSql.unshift(`-- Run once as a superuser / admin role, connected to ${info.db}; then test the connection again.`)
  return { user: info.user, database: info.db, superuser: info.superuser, replicaMode, checks, dbaSql }
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** Ordinary / partitioned tables (not partitions) with their copyable columns. */
export async function listTables(db: SqlClient, schemas = COPY_SCHEMAS): Promise<CopyTable[]> {
  const { rows } = await db.query<{ schema: string; name: string; columns: string[] }>(
    `SELECT n.nspname AS schema, c.relname AS name,
            array_agg(a.attname::text ORDER BY a.attnum) AS columns
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      GROUP BY n.nspname, c.relname
      ORDER BY n.nspname, c.relname`,
    [schemas],
  )
  return rows
}

/** Tables present in both, with the columns both have. */
export function matchTables(source: CopyTable[], target: CopyTable[]): { tables: CopyTable[]; onlySource: string[] } {
  const byName = new Map(target.map((t) => [`${t.schema}.${t.name}`, t]))
  const tables: CopyTable[] = []
  const onlySource: string[] = []
  for (const t of source) {
    const other = byName.get(`${t.schema}.${t.name}`)
    if (!other) { onlySource.push(`${t.schema}.${t.name}`); continue }
    const cols = new Set(other.columns)
    tables.push({ ...t, columns: t.columns.filter((c) => cols.has(c)) })
  }
  return { tables, onlySource }
}

/** Parents before children (foreign keys among the copied tables); cycles keep name order. */
export async function fkOrder(db: SqlClient, tables: CopyTable[]): Promise<CopyTable[]> {
  const { rows } = await db.query<{ child: string; parent: string }>(
    `SELECT cn.nspname || '.' || cc.relname AS child, pn.nspname || '.' || pc.relname AS parent
       FROM pg_constraint k
       JOIN pg_class cc ON cc.oid = k.conrelid JOIN pg_namespace cn ON cn.oid = cc.relnamespace
       JOIN pg_class pc ON pc.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
      WHERE k.contype = 'f' AND cn.nspname = ANY($1::text[])`,
    [COPY_SCHEMAS],
  )
  const keys = new Set(tables.map(tableKey))
  const deps = new Map<string, Set<string>>(tables.map((t) => [tableKey(t), new Set()]))
  for (const r of rows) if (r.child !== r.parent && keys.has(r.child) && keys.has(r.parent)) deps.get(r.child)!.add(r.parent)
  const ordered: CopyTable[] = []
  const done = new Set<string>()
  let remaining = [...tables]
  while (remaining.length) {
    const ready = remaining.filter((t) => [...deps.get(tableKey(t))!].every((p) => done.has(p)))
    const batch = ready.length ? ready : [remaining[0]]
    for (const t of batch) { ordered.push(t); done.add(tableKey(t)) }
    remaining = remaining.filter((t) => !done.has(tableKey(t)))
  }
  return ordered
}

export async function primaryKey(db: SqlClient, t: { schema: string; name: string }): Promise<Array<{ name: string; type: string }>> {
  const { rows } = await db.query<{ name: string; type: string }>(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [qualified(t)],
  )
  return rows
}

export async function countRows(db: SqlClient, t: { schema: string; name: string }): Promise<number> {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${qualified(t)}`)
  return Number(rows[0]?.n ?? 0)
}

/** Row count and an order-independent checksum of the given columns. */
export async function tableChecksum(db: SqlClient, t: CopyTable): Promise<{ rows: number; checksum: string }> {
  const cols = t.columns.map(q).join(', ')
  const { rows } = await db.query<{ n: string; sum: string }>(
    `SELECT count(*)::text AS n, md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS sum
       FROM (SELECT md5(row_to_json(x)::text) AS h FROM (SELECT ${cols} FROM ${qualified(t)}) x) s`,
  )
  return { rows: Number(rows[0]?.n ?? 0), checksum: rows[0]?.sum ?? '' }
}

// ── Copy ────────────────────────────────────────────────────────────────────

export interface TableState {
  /** partial: some batches copied (continue after `lastKey`); done: finished. */
  status: 'partial' | 'done'
  rows: number
  lastKey?: string[] | null
}

export interface DroppedFk {
  table: string
  name: string
  def: string
}

export interface CopyState {
  mode?: 'replica' | 'owner'
  tables: Record<string, TableState>
  /** Owner mode: foreign keys dropped on the target, re-created after the copy. */
  fks?: DroppedFk[]
  fksRestored?: boolean
  /** Owner mode: tables whose user triggers were disabled. */
  triggersOff?: string[]
}

export class DeadlineReached extends SwitchPaused {
  constructor() {
    super('time budget used: the copy continues on the next run')
    this.name = 'DeadlineReached'
  }
}

export interface CopyOptions {
  state: CopyState
  /** Persist `state` (called after every batch). */
  save: () => Promise<void>
  progress?: (done: number, total: number, table: string) => void
  /** Epoch ms: stop between batches once reached (DeadlineReached). */
  deadline?: number
  batch?: number
  log?: (line: string) => void
}

/** Owner mode: drop the target's foreign keys among the copied schemas (recorded in state, once). */
async function dropForeignKeys(targetDb: SqlClient, state: CopyState): Promise<void> {
  if (state.fks) return
  const { rows } = await targetDb.query<{ tbl: string; name: string; def: string }>(
    `SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS tbl, k.conname AS name, pg_get_constraintdef(k.oid) AS def
       FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE k.contype = 'f' AND n.nspname = ANY($1::text[])
      ORDER BY 1, 2`,
    [COPY_SCHEMAS],
  )
  state.fks = rows.map((r) => ({ table: r.tbl, name: r.name, def: r.def }))
  for (const fk of state.fks) await targetDb.query(`ALTER TABLE ${fk.table} DROP CONSTRAINT IF EXISTS ${q(fk.name)}`)
}

/** Owner mode, after the copy: re-create (and so validate) the foreign keys, re-enable triggers. */
export async function restoreConstraints(targetDb: SqlClient, state: CopyState, log: (line: string) => void = () => undefined): Promise<number> {
  let restored = 0
  for (const fk of state.fks ?? []) {
    const { rows } = await targetDb.query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2) AS ok`, [fk.table, fk.name])
    if (rows[0]?.ok) continue
    await targetDb.query(`ALTER TABLE ${fk.table} ADD CONSTRAINT ${q(fk.name)} ${fk.def}`)
    restored++
  }
  for (const table of state.triggersOff ?? []) await targetDb.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`)
  if (restored) log(`      re-created ${restored} foreign key(s)`)
  state.fksRestored = true
  state.triggersOff = []
  return restored
}

/**
 * Copy `tables` (already in FK order) from source to target, continuing
 * from `state`. Each table is emptied on its first batch; batches follow
 * the primary key, so an interrupted table continues after its last key
 * (tables without one are copied again from the start).
 */
export async function copyTables(source: SqlClient, targetDb: SqlClient, tables: CopyTable[], opts: CopyOptions): Promise<{ rows: number; tables: number }> {
  const { state } = opts
  const batch = opts.batch ?? COPY_BATCH
  const log = opts.log ?? (() => undefined)
  if (state.mode === 'replica') await targetDb.query('SET session_replication_role = replica')
  if (state.mode === 'owner') await dropForeignKeys(targetDb, state)
  let total = 0
  // At least one batch per call, so a chunked run always makes progress.
  let batches = 0
  try {
    for (const [index, t] of tables.entries()) {
      const key = tableKey(t)
      const st = state.tables[key]
      if (st?.status === 'done') { total += st.rows; continue }
      const pk = await primaryKey(source, t)
      const cols = t.columns.map(q).join(', ')
      const current: TableState = st && pk.length ? st : { status: 'partial', rows: 0, lastKey: null }
      if (!st || !pk.length) {
        if (state.mode === 'owner' && !(state.triggersOff ?? []).includes(qualified(t))) {
          await targetDb.query(`ALTER TABLE ${qualified(t)} DISABLE TRIGGER USER`)
          state.triggersOff = [...(state.triggersOff ?? []), qualified(t)]
        }
        await targetDb.query(`DELETE FROM ${qualified(t)}`)
        current.rows = 0
        current.lastKey = null
      }
      state.tables[key] = current
      await opts.save()
      for (;;) {
        if (opts.deadline && batches > 0 && Date.now() >= opts.deadline) throw new DeadlineReached()
        let sql: string
        let params: unknown[] = []
        if (pk.length) {
          const order = pk.map((c) => q(c.name)).join(', ')
          const after = current.lastKey
            ? `WHERE (${order}) > (${pk.map((c, i) => `$${i + 1}::text::${c.type}`).join(', ')})`
            : ''
          params = current.lastKey ?? []
          sql = `SELECT row_to_json(x)::text AS j, ${pk.map((c, i) => `x.${q(c.name)}::text AS k${i}`).join(', ')}
                   FROM (SELECT ${cols} FROM ${qualified(t)} ${after} ORDER BY ${order} LIMIT ${batch}) x`
        } else {
          sql = `SELECT row_to_json(x)::text AS j FROM (SELECT ${cols} FROM ${qualified(t)} OFFSET ${current.rows} LIMIT ${batch}) x`
        }
        const { rows } = await source.query<Record<string, string>>(sql, params)
        if (!rows.length) break
        await targetDb.query(
          `INSERT INTO ${qualified(t)} (${cols}) OVERRIDING SYSTEM VALUE
           SELECT ${cols} FROM json_populate_recordset(NULL::${qualified(t)}, $1::json)`,
          [`[${rows.map((r) => r.j).join(',')}]`],
        )
        batches++
        current.rows += rows.length
        if (pk.length) current.lastKey = pk.map((_, i) => rows[rows.length - 1][`k${i}`])
        await opts.save()
        opts.progress?.(index, tables.length, key)
        if (rows.length < batch) break
      }
      current.status = 'done'
      current.lastKey = null
      total += current.rows
      await opts.save()
      opts.progress?.(index + 1, tables.length, key)
      if (current.rows) log(`      ${key}: ${current.rows} row(s)`)
    }
  } finally {
    if (state.mode === 'replica') await targetDb.query('RESET session_replication_role').catch(() => undefined)
  }
  return { rows: total, tables: tables.length }
}

/** Sequence positions (owned and free-standing) in the copied schemas. */
export async function copySequences(source: SqlClient, targetDb: SqlClient): Promise<number> {
  const { rows } = await source.query<{ name: string; last_value: string | null }>(
    `SELECT quote_ident(schemaname) || '.' || quote_ident(sequencename) AS name, last_value::text
       FROM pg_sequences WHERE schemaname = ANY($1::text[])`,
    [COPY_SCHEMAS],
  )
  let n = 0
  for (const seq of rows) {
    if (seq.last_value === null) continue
    const { rows: exists } = await targetDb.query<{ ok: boolean }>('SELECT to_regclass($1) IS NOT NULL AS ok', [seq.name])
    if (!exists[0]?.ok) continue
    await targetDb.query('SELECT setval($1::regclass, $2::bigint, true)', [seq.name, seq.last_value])
    n++
  }
  return n
}

/** Data size of the copied schemas (the target needs at least this much room, plus indexes). */
export async function copySize(db: SqlClient): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT coalesce(sum(pg_total_relation_size(c.oid)), 0)::text AS n
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'm')`,
    [COPY_SCHEMAS],
  )
  return Number(rows[0]?.n ?? 0)
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
