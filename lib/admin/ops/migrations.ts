import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Migration files: supabase/migrations/<version>_<name>.sql, the layout the
 * Supabase CLI uses, so one directory serves `supabase db push` (Supabase
 * projects) and `usertasks-admin db migrate` (any PostgreSQL).
 */

export interface MigrationFile {
  /** Timestamp prefix (the history key, as in supabase_migrations.schema_migrations). */
  version: string
  name: string
  file: string
  sql: string
  /** sha256 of the file as written (before any owner substitution). */
  checksum: string
}

const FILE_RE = /^(\d+)_(.+)\.sql$/

export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

export function loadMigrations(dir: string): MigrationFile[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    throw new Error(`Migrations directory not found: ${dir} (set --dir or MIGRATIONS_DIR)`)
  }
  const out: MigrationFile[] = []
  const seen = new Map<string, string>()
  for (const entry of entries.sort()) {
    const m = FILE_RE.exec(entry)
    if (!m) continue
    const [, version, name] = m
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version}: ${seen.get(version)} and ${entry}`)
    seen.set(version, entry)
    const file = path.join(/*turbopackIgnore: true*/ dir, entry)
    const sql = readFileSync(file, 'utf8')
    out.push({ version, name, file, sql, checksum: checksumOf(sql) })
  }
  return out.sort((a, b) => compareVersions(a.version, b.version))
}

/** Numeric order (the Supabase CLI compares versions as numbers). */
export function compareVersions(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * The baseline is a Supabase dump: objects are re-owned by, and default
 * privileges declared for, the role "postgres". On managed PostgreSQL the
 * migrating role usually is not (and can't become) "postgres", so those
 * references are pointed at `owner` instead — only the three statement
 * forms the dump uses, never other text. Identity when owner is postgres.
 */
export function substituteOwner(sql: string, owner: string): string {
  if (owner === 'postgres') return sql
  const role = quoteIdent(owner)
  return sql
    .replace(/\bOWNER TO "postgres";/g, `OWNER TO ${role};`)
    .replace(/\bFOR ROLE "postgres"/g, `FOR ROLE ${role}`)
    .replace(/(\bGRANT [^;]*? TO )"postgres";/g, `$1${role};`)
}
