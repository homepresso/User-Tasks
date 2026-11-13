import type { Client } from 'pg'
import { checksumOf, compareVersions, substituteOwner, type MigrationFile } from './migrations'
import { describeTarget, withLock, type MigrateResult } from './migration-runner'

/**
 * Extension database migrations (extensibility plan §3.4).
 *
 * An extension ships its SQL in its server module (`migrations: [{ version,
 * name, sql }]`, bundled into the build — nothing is read from disk at
 * runtime). They run with the core runner's rules: the same advisory lock
 * (core and extension runs never overlap), one transaction per file with its
 * history row, changed files reported and never re-run. History is per
 * extension in supabase_migrations.usertasks_extension_migrations.
 *
 * Every file must pass lintExtensionMigration first:
 *   - it only creates / alters / drops tables named ext_<id>__*; no DDL on
 *     core tables (foreign keys TO core tables are fine);
 *   - every table it creates has a tenant_id column and enables row-level
 *     security;
 *   - policies resolve the workspace with get_current_tenant_id() (which
 *     COALESCEs the current workspace with the home one) or an explicit
 *     COALESCE — never a bare users.current_tenant_id, which is NULL in the
 *     "All organizations" view and silently rejects everything.
 *
 * Used by `usertasks-admin ext migrate|status` and the deploy runbook.
 */

export const EXTENSION_HISTORY = 'supabase_migrations.usertasks_extension_migrations'

export interface ExtensionMigrationInput { version: string; name: string; sql: string }

export function extensionMigrationFiles(extensionId: string, migrations: readonly ExtensionMigrationInput[]): MigrationFile[] {
  return migrations
    .map((m) => ({ version: m.version, name: m.name, file: `${extensionId}/${m.version}_${m.name}.sql`, sql: m.sql, checksum: checksumOf(m.sql) }))
    .sort((a, b) => compareVersions(a.version, b.version))
}

/** Strip comments and string literals so the checks look at statements only. */
function statementsOnly(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

const IDENT = String.raw`(?:"?(?:public)"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`

/** Problems that keep a migration from running (empty = OK). */
export function lintExtensionMigration(extensionId: string, sql: string): string[] {
  const prefix = `ext_${extensionId.replace(/-/g, '_')}__`
  const body = statementsOnly(sql)
  const problems: string[] = []
  const created = new Set<string>()
  const ddl = new RegExp(String.raw`\b(CREATE\s+(?:UNLOGGED\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?(?:\s+ONLY)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|TRUNCATE(?:\s+TABLE)?|CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+\w+\s+(?:BEFORE|AFTER|INSTEAD\s+OF)[\s\S]*?\bON|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?(?:\s+\w+)?\s+ON|CREATE\s+POLICY\s+\w+\s+ON|ALTER\s+POLICY\s+\w+\s+ON|DROP\s+POLICY(?:\s+IF\s+EXISTS)?\s+\w+\s+ON|COMMENT\s+ON\s+TABLE|GRANT\s+[\w\s,()]+\s+ON(?:\s+TABLE)?|REVOKE\s+[\w\s,()]+\s+ON(?:\s+TABLE)?)\s+${IDENT}`, 'gi')
  for (const match of body.matchAll(ddl)) {
    const verb = match[1].replace(/\s+/g, ' ').toUpperCase()
    const table = match[2]
    if (/^(ALL|SCHEMA|FUNCTION|SEQUENCE)$/i.test(table)) {
      problems.push(`${verb.split(' ').slice(0, 2).join(' ')} ${table} …: only tables named ${prefix}* may be granted / revoked`)
      continue
    }
    if (!table.startsWith(prefix)) problems.push(`${verb.split(' ').slice(0, 3).join(' ')} ${table}: extension migrations may only change tables named ${prefix}*`)
    if (/^CREATE( UNLOGGED)? TABLE/.test(verb)) created.add(table)
  }
  if (/\b(CREATE|ALTER|DROP)\s+(SCHEMA|ROLE|USER|EXTENSION|DATABASE)\b/i.test(body)) problems.push('schemas, roles, database extensions and databases are managed by core, not extension migrations')
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(?!(?:"?public"?\.)?"?ext_)/i.test(body)) problems.push(`functions must be named ${prefix}* too`)
  for (const table of created) {
    const definition = new RegExp(String.raw`CREATE\s+(?:UNLOGGED\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"?public"?\.)?"?${table}"?\s*\(([\s\S]*?)\)\s*;`, 'i').exec(body)?.[1] ?? ''
    if (!/\btenant_id\s+uuid\b/i.test(definition)) problems.push(`${table}: needs a tenant_id uuid column`)
    if (!new RegExp(String.raw`ALTER\s+TABLE\s+(?:"?public"?\.)?"?${table}"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`, 'i').test(body)) problems.push(`${table}: must ENABLE ROW LEVEL SECURITY`)
  }
  for (const policy of body.matchAll(/CREATE\s+POLICY\s+\w+\s+ON\s+[^;]+;/gi)) {
    const text = policy[0]
    if (/(?<!get_)current_tenant_id/i.test(text) && !/coalesce\s*\(/i.test(text)) problems.push('a policy reads users.current_tenant_id without COALESCE (NULL in the unified view): use get_current_tenant_id()')
    if (/tenant_id/i.test(text) && !/get_current_tenant_id\s*\(|rls_visible_tenant_ids\s*\(|rls_member_tenant_ids\s*\(|coalesce\s*\(/i.test(text)) problems.push('a tenant policy must resolve the workspace with get_current_tenant_id() (COALESCE pattern)')
  }
  return [...new Set(problems)]
}

export async function ensureExtensionHistory(db: Client): Promise<void> {
  await db.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS ${EXTENSION_HISTORY} (
      extension_id text NOT NULL,
      version text NOT NULL,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by text NOT NULL DEFAULT current_user,
      PRIMARY KEY (extension_id, version)
    );`)
}

export async function readExtensionApplied(db: Client, extensionId: string): Promise<Array<{ version: string; name: string; checksum: string }>> {
  const { rows: exists } = await db.query<{ t: string | null }>(`SELECT to_regclass('${EXTENSION_HISTORY}')::text AS t`)
  if (!exists[0]?.t) return []
  const { rows } = await db.query<{ version: string; name: string; checksum: string }>(`SELECT version, name, checksum FROM ${EXTENSION_HISTORY} WHERE extension_id = $1`, [extensionId])
  return rows.sort((a, b) => compareVersions(a.version, b.version))
}

export type ExtensionMigrationState = 'applied' | 'pending' | 'changed' | 'missing_file'

export function extensionMigrationStatus(files: MigrationFile[], applied: Array<{ version: string; name: string; checksum: string }>): Array<{ version: string; name: string; state: ExtensionMigrationState }> {
  const byVersion = new Map(applied.map((a) => [a.version, a]))
  const rows = files.map((f) => {
    const a = byVersion.get(f.version)
    return { version: f.version, name: f.name, state: (a ? (a.checksum !== f.checksum ? 'changed' : 'applied') : 'pending') as ExtensionMigrationState }
  })
  for (const a of applied) if (!files.some((f) => f.version === a.version)) rows.push({ version: a.version, name: a.name, state: 'missing_file' })
  return rows.sort((a, b) => compareVersions(a.version, b.version))
}

/** Apply an extension's pending migrations (lint first; one transaction per file). */
export async function migrateExtension(db: Client, extensionId: string, files: MigrationFile[], options: { dryRun?: boolean; owner?: string; lockTimeoutMs?: number; log?: (line: string) => void } = {}): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined)
  const lint = files.flatMap((f) => lintExtensionMigration(extensionId, f.sql).map((p) => `${f.version}_${f.name}: ${p}`))
  if (lint.length) throw new Error(`Extension "${extensionId}" migrations fail the linter:\n  ${lint.join('\n  ')}`)
  const target = await describeTarget(db, options.owner)
  return withLock(db, options.lockTimeoutMs ?? 60_000, async () => {
    const status = extensionMigrationStatus(files, await readExtensionApplied(db, extensionId))
    const warnings = status.filter((r) => r.state === 'changed' || r.state === 'missing_file').map((r) => `${extensionId} ${r.version}_${r.name}: ${r.state === 'changed' ? 'file changed since it was applied (not re-run)' : 'applied but no longer shipped'}`)
    const todo = status.filter((r) => r.state === 'pending').map((r) => files.find((f) => f.version === r.version)!)
    const result: MigrateResult = { target, applied: [], pending: todo.map((f) => f.version), warnings }
    if (options.dryRun || !todo.length) return result
    await ensureExtensionHistory(db)
    for (const file of todo) {
      const sql = target.supabase ? file.sql : substituteOwner(file.sql, target.owner)
      log(`applying ${extensionId} ${file.version}_${file.name}`)
      await db.query('BEGIN')
      try {
        await db.query(sql)
        await db.query('RESET search_path')
        await db.query(`INSERT INTO ${EXTENSION_HISTORY} (extension_id, version, name, checksum) VALUES ($1, $2, $3, $4)`, [extensionId, file.version, file.name, file.checksum])
        await db.query('COMMIT')
      } catch (err) {
        await db.query('ROLLBACK').catch(() => undefined)
        throw new Error(`${extensionId} ${file.version}_${file.name} failed: ${(err as Error).message}`)
      } finally {
        await db.query('RESET ALL').catch(() => undefined)
      }
      result.applied.push(file.version)
    }
    return result
  })
}
