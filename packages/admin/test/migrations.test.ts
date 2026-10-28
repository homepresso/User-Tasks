import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checksumOf, compareVersions, loadMigrations, substituteOwner } from '../src/db/migrations'
import { computeStatus, type AppliedMigration } from '../src/db/runner'

const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')

let dirs: string[] = []
function tempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ut-migrations-'))
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql)
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs = []
})

describe('loadMigrations', () => {
  it('reads <version>_<name>.sql in version order and ignores other files', () => {
    const dir = tempDir({ '20261102000000_b.sql': 'select 2;', '20261101000000_a.sql': 'select 1;', 'README.md': '#', 'seed.sql': 'x' })
    const files = loadMigrations(dir)
    expect(files.map((f) => [f.version, f.name])).toEqual([['20261101000000', 'a'], ['20261102000000', 'b']])
    expect(files[0].checksum).toBe(checksumOf('select 1;'))
  })

  it('refuses duplicate versions and a missing directory', () => {
    const dir = tempDir({ '20261101000000_a.sql': '', '20261101000000_b.sql': '' })
    expect(() => loadMigrations(dir)).toThrow(/Duplicate migration version 20261101000000/)
    expect(() => loadMigrations(path.join(dir, 'nope'))).toThrow(/not found/)
  })

  it('checksums ignore CRLF line endings', () => {
    expect(checksumOf('a\r\nb')).toBe(checksumOf('a\nb'))
  })

  it('compares versions numerically', () => {
    expect(compareVersions('9', '10')).toBeLessThan(0)
    expect(compareVersions('20261014000000', '20261015000000')).toBeLessThan(0)
  })

  it('the compat bootstrap sorts first in the repository', () => {
    const files = loadMigrations(REPO_MIGRATIONS)
    expect(files[0].name).toBe('compat_bootstrap')
    expect(files[1].name).toBe('baseline')
  })
})

describe('substituteOwner', () => {
  const sql = [
    'ALTER TABLE "public"."tasks" OWNER TO "postgres";',
    'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";',
    'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";',
    'GRANT USAGE ON SCHEMA "public" TO "postgres";',
    "COMMENT ON TABLE x IS 'owned by \"postgres\"';",
    'SELECT \'OWNER TO postgres\';',
  ].join('\n')

  it('points the dump\'s three "postgres" statement forms at the owner, and nothing else', () => {
    expect(substituteOwner(sql, 'app_owner')).toBe([
      'ALTER TABLE "public"."tasks" OWNER TO "app_owner";',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "app_owner" IN SCHEMA "public" GRANT ALL ON TABLES TO "app_owner";',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "app_owner" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";',
      'GRANT USAGE ON SCHEMA "public" TO "app_owner";',
      "COMMENT ON TABLE x IS 'owned by \"postgres\"';",
      'SELECT \'OWNER TO postgres\';',
    ].join('\n'))
  })

  it('is the identity for postgres and quotes unusual role names', () => {
    expect(substituteOwner(sql, 'postgres')).toBe(sql)
    expect(substituteOwner('ALTER TABLE t OWNER TO "postgres";', 'odd"name')).toBe('ALTER TABLE t OWNER TO "odd""name";')
  })
})

describe('computeStatus', () => {
  const files = loadMigrations(tempDir({ '1_a.sql': 'a', '2_b.sql': 'b', '3_c.sql': 'c' }))
  const applied = (versions: string[], checksums: Record<string, string> = {}): AppliedMigration[] =>
    versions.map((version) => ({ version, name: null, checksum: checksums[version] ?? null }))

  it('fresh database: everything pending', () => {
    expect(computeStatus(files, []).map((r) => r.state)).toEqual(['pending', 'pending', 'pending'])
  })

  it('applied, pending, changed checksum, missing file and out-of-order versions', () => {
    const rows = computeStatus(files, applied(['0', '2'], { 2: 'stale-checksum' }))
    expect(rows.map((r) => [r.version, r.state])).toEqual([
      ['0', 'missing_file'], ['1', 'out_of_order'], ['2', 'changed'], ['3', 'pending'],
    ])
  })

  it('history written by the Supabase CLI (no checksum) counts as applied', () => {
    expect(computeStatus(files, applied(['1', '2', '3'])).every((r) => r.state === 'applied')).toBe(true)
  })

  it('production (Supabase, migrated by supabase db push): only the compat bootstrap is new, and it is out of order', () => {
    // Every version except the bootstrap is in production's history (the
    // guarded old files were applied before they were edited: never re-run).
    const repo = loadMigrations(REPO_MIGRATIONS)
    const history = applied(repo.map((f) => f.version).filter((v) => v !== '20261014000000'))
    const rows = computeStatus(repo, history)
    expect(rows.filter((r) => r.state !== 'applied')).toEqual([{ version: '20261014000000', name: 'compat_bootstrap', state: 'out_of_order' }])
  })
})
