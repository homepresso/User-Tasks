import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { SqlClient } from '../ops/instance-db'
import { ensurePrivateDir, writePrivateFile } from './log'

/**
 * Backups taken before a switch changes anything, all under the switch's
 * private backup directory (0700):
 *  - config.json      instance_settings rows (secrets stay ciphertext) and
 *                     the <AREA>_PROVIDER environment variables
 *  - <name>.jsonl     row snapshots of the tables a switch modifies (what
 *                     `rollback` restores data from)
 *  - database.dump    pg_dump -Fc of the app database, when pg_dump is
 *                     available (PG_DUMP, else on PATH) and not --no-dump —
 *                     the restore-everything fallback (pg_restore)
 */

export function writeJson(dir: string, name: string, value: unknown): string {
  ensurePrivateDir(dir)
  const file = path.join(/*turbopackIgnore: true*/ dir, name)
  writePrivateFile(file, JSON.stringify(value, null, 2))
  return file
}

export function readJson<T>(dir: string, name: string): T | null {
  const file = path.join(/*turbopackIgnore: true*/ dir, name)
  return existsSync(/*turbopackIgnore: true*/ file) ? (JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, 'utf8')) as T) : null
}

export function writeJsonl(dir: string, name: string, rows: unknown[]): string {
  ensurePrivateDir(dir)
  const file = path.join(/*turbopackIgnore: true*/ dir, name)
  writePrivateFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''))
  return file
}

export function readJsonl<T>(dir: string, name: string): T[] | null {
  const file = path.join(/*turbopackIgnore: true*/ dir, name)
  if (!existsSync(/*turbopackIgnore: true*/ file)) return null
  return readFileSync(/*turbopackIgnore: true*/ file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T)
}

/** Every row of a table as JSON (row_to_json, so types round-trip through jsonb_populate_record). */
export async function snapshotTable(db: SqlClient, table: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.query<{ j: Record<string, unknown> }>(`SELECT row_to_json(t) AS j FROM ${table} t`)
  return rows.map((r) => r.j)
}

/** Insert-or-replace rows saved by snapshotTable (by primary key `pk`). */
export async function restoreRows(db: SqlClient, table: string, pk: string, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0
  const [schema, name] = table.includes('.') ? table.split('.') : ['public', table]
  const { rows: cols } = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [schema, name],
  )
  const names = cols.map((c) => `"${c.column_name}"`)
  const updates = names.filter((n) => n !== `"${pk}"`).map((n) => `${n} = EXCLUDED.${n}`)
  await db.query(
    `INSERT INTO ${table} (${names.join(', ')})
     SELECT ${names.join(', ')} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)
     ON CONFLICT ("${pk}") DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
    [JSON.stringify(rows)],
  )
  return rows.length
}

export function pgDumpBinary(env: NodeJS.ProcessEnv = process.env): string {
  return env.PG_DUMP || 'pg_dump'
}

/** pg_dump -Fc into `file` (./pg-dump, loaded on use). Resolves with an error message instead of throwing. */
export async function pgDump(url: string, file: string, options: { schemas?: string[]; binary?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; error?: string }> {
  const { runPgDump } = await import('./pg-dump')
  return runPgDump(url, file, { binary: pgDumpBinary(), ...options })
}
