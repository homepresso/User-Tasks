import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SqlClient } from '../ops/instance-db'
import { tableExists } from '../ops/instance-db'
import type { StepRecord, SwitchRecordRow } from './types'

/**
 * Switch log: public.instance_provider_switches (migration 20261107000000),
 * mirrored to <backup dir>/switch.json so a record survives even when the
 * database it was written to is gone (a database switch's rollback reads
 * either).
 *
 * Migration 20261110000000 adds what Settings → Infrastructure needs: the
 * run's output lines (`log`), a cancel request, and the queued job's options
 * (`job`). Every write checks for those columns first, so the CLI keeps
 * working against a database without that migration.
 *
 * One switch at a time per database: runSwitch / runRollback hold a
 * session-level advisory lock (SWITCH_LOCK_KEY) on their connection while
 * they change anything. The lock goes away with the connection, so a
 * crashed run never blocks the next one; a `running` record whose lock is
 * free was interrupted.
 */

const TABLE = 'public.instance_provider_switches'
const COLUMNS = 'id, kind, area, from_provider, to_provider, status, rollback_of, steps, config_before, config_after, env_changes, backup_dir, actor, host, error, started_at, finished_at'
const EXTRA_COLUMNS = 'log, job, cancel_requested_at'

/** pg advisory lock key held while a switch or rollback runs ("usertasks provider switch"). */
export const SWITCH_LOCK_KEY = 815_147_001
export const LOG_LINES_MAX = 400

export async function hasSwitchLog(db: SqlClient): Promise<boolean> {
  return tableExists(db, TABLE)
}

// Per connection: whether migration 20261110000000's columns exist.
const extras = new WeakMap<object, Promise<boolean>>()

export function hasSwitchLogExtras(db: SqlClient): Promise<boolean> {
  let known = extras.get(db)
  if (!known) {
    known = db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'instance_provider_switches' AND column_name IN ('log', 'job', 'cancel_requested_at')`,
    ).then(({ rows }) => (rows[0]?.n ?? 0) === 3, () => false)
    extras.set(db, known)
  }
  return known
}

/** Take the switch lock on this connection (false: another switch or rollback holds it). Re-entrant per connection. */
export async function tryLockSwitches(db: SqlClient): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [SWITCH_LOCK_KEY])
  return rows[0]?.ok === true
}

export async function unlockSwitches(db: SqlClient): Promise<void> {
  await db.query('SELECT pg_advisory_unlock($1)', [SWITCH_LOCK_KEY]).catch(() => undefined)
}

/** Whether a switch or rollback is running right now (anywhere, against this database). */
export async function switchRunning(db: SqlClient): Promise<boolean> {
  const { rows } = await db.query<{ busy: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_locks l
        WHERE l.locktype = 'advisory' AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND l.classid = 0 AND l.objid = $1::bigint::oid AND l.objsubid = 1 AND l.granted AND l.pid <> pg_backend_pid()) AS busy`,
    [SWITCH_LOCK_KEY],
  )
  return rows[0]?.busy === true
}

/** Whether a cancel was requested for this switch (Settings → Infrastructure). */
export async function cancelRequested(db: SqlClient, id: string): Promise<boolean> {
  if (!(await hasSwitchLogExtras(db))) return false
  const { rows } = await db.query<{ c: boolean }>(`SELECT cancel_requested_at IS NOT NULL AS c FROM ${TABLE} WHERE id = $1`, [id])
  return rows[0]?.c === true
}

export function newSwitchId(): string {
  return randomUUID()
}

/** Private directory for backups (they can hold password hashes and data). */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* best effort (e.g. Windows) */ }
}

export function writePrivateFile(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch { /* best effort */ }
}

export function mirrorRecord(record: SwitchRecordRow): void {
  if (!record.backup_dir) return
  ensurePrivateDir(record.backup_dir)
  writePrivateFile(path.join(/*turbopackIgnore: true*/ record.backup_dir, 'switch.json'), JSON.stringify(record, null, 2))
}

export function readMirroredRecord(dir: string): SwitchRecordRow | null {
  const file = path.join(/*turbopackIgnore: true*/ dir, 'switch.json')
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf8')) as SwitchRecordRow
}

export function newRecord(fields: Pick<SwitchRecordRow, 'id' | 'kind' | 'area' | 'from_provider' | 'to_provider' | 'actor' | 'backup_dir'> & Partial<SwitchRecordRow>): SwitchRecordRow {
  return {
    status: 'running',
    rollback_of: null,
    steps: [],
    config_before: null,
    config_after: null,
    env_changes: {},
    host: os.hostname(),
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    ...fields,
  }
}

export async function insertRecord(db: SqlClient, record: SwitchRecordRow): Promise<void> {
  await db.query(
    `INSERT INTO ${TABLE} (${COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (id) DO NOTHING`,
    [
      record.id, record.kind, record.area, record.from_provider, record.to_provider, record.status, record.rollback_of,
      JSON.stringify(record.steps), JSON.stringify(record.config_before), JSON.stringify(record.config_after),
      JSON.stringify(record.env_changes), record.backup_dir, record.actor, record.host, record.error, record.started_at, record.finished_at,
    ],
  )
  mirrorRecord(record)
}

export async function updateRecord(db: SqlClient, record: SwitchRecordRow): Promise<void> {
  await db.query(
    `UPDATE ${TABLE} SET status = $2, steps = $3::jsonb, config_after = $4::jsonb, env_changes = $5::jsonb, error = $6, finished_at = $7
      WHERE id = $1`,
    [record.id, record.status, JSON.stringify(record.steps), JSON.stringify(record.config_after), JSON.stringify(record.env_changes), record.error, record.finished_at],
  )
  if (record.log && (await hasSwitchLogExtras(db))) {
    if (record.log.length > LOG_LINES_MAX) record.log.splice(0, record.log.length - LOG_LINES_MAX)
    await db.query(`UPDATE ${TABLE} SET log = $2::jsonb WHERE id = $1`, [record.id, JSON.stringify(record.log)])
  }
  mirrorRecord(record)
}

/**
 * Persist a running step's progress (and the log so far) in ONE statement,
 * issued synchronously: a step may open a transaction on the same
 * connection right after reporting progress (the database copy's read-only
 * snapshot), so nothing may be queued behind an await here.
 */
export function flushProgress(db: SqlClient, record: SwitchRecordRow, withLog: boolean): Promise<unknown> {
  return withLog
    ? db.query(`UPDATE ${TABLE} SET steps = $2::jsonb, log = $3::jsonb WHERE id = $1`, [record.id, JSON.stringify(record.steps), JSON.stringify((record.log ?? []).slice(-LOG_LINES_MAX))])
    : db.query(`UPDATE ${TABLE} SET steps = $2::jsonb WHERE id = $1`, [record.id, JSON.stringify(record.steps)])
}

/** A queued record taken over by the runner: everything the switch fills in when it starts. */
export async function startQueuedRecord(db: SqlClient, record: SwitchRecordRow): Promise<void> {
  await db.query(
    `UPDATE ${TABLE} SET status = $2, steps = $3::jsonb, config_before = $4::jsonb, backup_dir = $5, host = $6, started_at = $7
      WHERE id = $1`,
    [record.id, record.status, JSON.stringify(record.steps), JSON.stringify(record.config_before), record.backup_dir, record.host, record.started_at],
  )
  await updateRecord(db, record)
}

/** Drop the queued job's encrypted secret values once the switch no longer needs them. */
export async function clearJobSecrets(db: SqlClient, id: string): Promise<void> {
  if (!(await hasSwitchLogExtras(db))) return
  await db.query(`UPDATE ${TABLE} SET job = job - 'secret' WHERE id = $1 AND job IS NOT NULL`, [id])
}

export async function setRecordStatus(db: SqlClient, id: string, status: SwitchRecordRow['status']): Promise<void> {
  await db.query(`UPDATE ${TABLE} SET status = $2 WHERE id = $1`, [id, status])
}

function normalise(row: Record<string, unknown>): SwitchRecordRow {
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v))
  return {
    ...(row as unknown as SwitchRecordRow),
    started_at: iso(row.started_at) ?? '',
    finished_at: iso(row.finished_at),
    ...('cancel_requested_at' in row ? { cancel_requested_at: iso(row.cancel_requested_at) } : {}),
  }
}

async function columns(db: SqlClient): Promise<string> {
  return (await hasSwitchLogExtras(db)) ? `${COLUMNS}, ${EXTRA_COLUMNS}` : COLUMNS
}

export async function getRecord(db: SqlClient, id: string): Promise<SwitchRecordRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { rows } = await db.query(`SELECT ${await columns(db)} FROM ${TABLE} WHERE id = $1`, [id])
  return rows[0] ? normalise(rows[0]) : null
}

export async function listRecords(db: SqlClient, limit = 20): Promise<SwitchRecordRow[]> {
  const { rows } = await db.query(`SELECT ${await columns(db)} FROM ${TABLE} ORDER BY started_at DESC LIMIT $1`, [limit])
  return rows.map(normalise)
}

export function stepRecord(id: string, title: string): StepRecord {
  return { id, title, status: 'pending' }
}
