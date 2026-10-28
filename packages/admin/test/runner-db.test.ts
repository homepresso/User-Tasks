/**
 * usertasks-admin db migrate against a real, plain PostgreSQL server: the
 * whole repository chain on a fresh database, idempotence, concurrent runs,
 * per-migration transactions, out-of-order and changed-file handling, repair.
 *
 * Runs only with MIGRATION_TEST_ADMIN_URL — a role that may CREATE DATABASE
 * on a NON-Supabase server (scratch databases are created and dropped), e.g.
 *   docker run -d -p 55416:5432 -e POSTGRES_PASSWORD=postgres postgres:16
 *   MIGRATION_TEST_ADMIN_URL=postgresql://postgres:postgres@127.0.0.1:55416/postgres npx vitest run packages/admin/test
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations } from '../src/db/migrations'
import { computeStatus, migrate, readApplied, repair } from '../src/db/runner'

const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL
const REPO_MIGRATIONS = path.resolve(__dirname, '../../../supabase/migrations')

function dbUrl(name: string): string {
  const url = new URL(ADMIN_URL!)
  url.pathname = `/${name}`
  return url.toString()
}

describe.skipIf(!ADMIN_URL)('db migrate (plain PostgreSQL)', () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  const created: string[] = []
  const dirs: string[] = []

  async function scratchDb(): Promise<string> {
    const name = `ut_migrate_${randomUUID().slice(0, 8)}`
    await admin.query(`CREATE DATABASE ${name}`)
    created.push(name)
    return dbUrl(name)
  }
  async function connect(url: string): Promise<pg.Client> {
    const client = new pg.Client({ connectionString: url })
    await client.connect()
    return client
  }
  function migrationsDir(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ut-mig-'))
    for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql)
    dirs.push(dir)
    return dir
  }

  beforeAll(async () => {
    await admin.connect()
    const { rows } = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin'`)
    if (rows.length) throw new Error('MIGRATION_TEST_ADMIN_URL must point at plain PostgreSQL, not a Supabase stack')
  })
  afterAll(async () => {
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined)
    await admin.end()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('applies the whole repository chain to a fresh database, then has nothing to do', async () => {
    const db = await connect(await scratchDb())
    try {
      const files = loadMigrations(REPO_MIGRATIONS)
      const first = await migrate(db, files)
      expect(first.applied).toEqual(files.map((f) => f.version))
      expect(first.target.supabase).toBe(false)

      const status = computeStatus(files, await readApplied(db))
      expect(status.every((r) => r.state === 'applied')).toBe(true)
      expect((await migrate(db, files)).applied).toEqual([])

      // What the rest of the app relies on exists.
      const { rows } = await db.query(`
        SELECT to_regprocedure('auth.uid()') IS NOT NULL AS uid,
               to_regclass('auth.users') IS NOT NULL AS users,
               to_regclass('public.tasks') IS NOT NULL AS tasks,
               to_regclass('app_auth.credentials') IS NOT NULL AS credentials,
               (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role', 'authenticator')) AS roles,
               (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public') > 100 AS policies`)
      expect(rows[0]).toEqual({ uid: true, users: true, tasks: true, credentials: true, roles: 4, policies: true })
      // History in the Supabase CLI's format.
      const { rows: history } = await db.query(`SELECT version, name, array_length(statements, 1) AS n FROM supabase_migrations.schema_migrations ORDER BY version LIMIT 1`)
      expect(history[0]).toEqual({ version: '20261014000000', name: 'compat_bootstrap', n: 1 })

      // auth.uid() reads the request claims, as on Supabase.
      await db.query('BEGIN')
      await db.query(`SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true)`)
      const { rows: who } = await db.query('SELECT auth.uid()::text AS uid, auth.role() AS role')
      await db.query('ROLLBACK')
      expect(who[0]).toEqual({ uid: '00000000-0000-4000-8000-000000000001', role: 'authenticated' })
    } finally {
      await db.end()
    }
  }, 120_000)

  it('serialises concurrent runs: each migration is applied once', async () => {
    const url = await scratchDb()
    const dir = migrationsDir({
      '1_slow.sql': 'CREATE TABLE t (n int); SELECT pg_sleep(0.5); INSERT INTO t VALUES (1);',
      '2_more.sql': 'INSERT INTO t VALUES (2);',
    })
    const files = loadMigrations(dir)
    const [a, b] = [await connect(url), await connect(url)]
    try {
      const [ra, rb] = await Promise.all([migrate(a, files), migrate(b, files)])
      expect([...ra.applied, ...rb.applied].sort()).toEqual(['1', '2'])
      const { rows } = await a.query('SELECT array_agg(n ORDER BY n) AS ns FROM t')
      expect(rows[0].ns).toEqual([1, 2])
    } finally {
      await a.end()
      await b.end()
    }
  })

  it('rolls a failing migration back completely and records nothing for it', async () => {
    const db = await connect(await scratchDb())
    try {
      const dir = migrationsDir({ '1_ok.sql': 'CREATE TABLE ok (n int);', '2_bad.sql': 'CREATE TABLE half (n int); SELECT 1/0;' })
      await expect(migrate(db, loadMigrations(dir))).rejects.toThrow(/2_bad failed: division by zero/)
      const { rows } = await db.query(`SELECT to_regclass('ok') IS NOT NULL AS ok, to_regclass('half') IS NOT NULL AS half`)
      expect(rows[0]).toEqual({ ok: true, half: false })
      expect((await readApplied(db)).map((r) => r.version)).toEqual(['1'])
    } finally {
      await db.end()
    }
  })

  it('refuses out-of-order versions unless included or repaired; warns about changed files', async () => {
    const db = await connect(await scratchDb())
    try {
      await migrate(db, loadMigrations(migrationsDir({ '2_b.sql': 'CREATE TABLE b (n int);' })))
      const dir = migrationsDir({ '1_a.sql': 'CREATE TABLE a (n int);', '2_b.sql': 'CREATE TABLE b (n int); -- edited' })
      const files = loadMigrations(dir)
      await expect(migrate(db, files)).rejects.toThrow(/older than the last applied one: 1/)
      expect((await migrate(db, files, { dryRun: true, includeAll: true })).pending).toEqual(['1'])

      // Marking it applied (production adopting the compat bootstrap) runs nothing.
      await repair(db, files, { status: 'applied', versions: ['1'] })
      const result = await migrate(db, files)
      expect(result.applied).toEqual([])
      expect(result.warnings).toEqual(['2_b: file changed since it was applied (not re-run)'])
      const { rows } = await db.query(`SELECT to_regclass('a') IS NOT NULL AS a`)
      expect(rows[0].a).toBe(false)

      await repair(db, files, { status: 'reverted', versions: ['1'] })
      expect((await migrate(db, files, { includeAll: true })).applied).toEqual(['1'])
    } finally {
      await db.end()
    }
  })
})
