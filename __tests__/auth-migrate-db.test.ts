/**
 * Supabase Auth → built-in auth user migration (lib/auth/migrate.ts) on the
 * local stack: dry run changes nothing; a real run copies the demo users with
 * their ids, bcrypt hashes and confirmation, plus OAuth identities (mapped to
 * a configured IdP key); a re-run is a no-op; and the demo user then signs in
 * through built-in auth with the password they already had.
 *
 * Runs only against a LOCAL Supabase stack with the demo data
 * (ada@northwind.example / demo-password-2026, scripts/screenshots/README.md):
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/auth-migrate-db.test.ts
 * The copied rows are removed afterwards; Supabase's own tables are only read.
 */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, Pool } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import { resetRequest } from './helpers/next-headers-mock'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const DEMO_EMAIL = 'ada@northwind.example'
const DEMO_PASSWORD = 'demo-password-2026'
const ENV_KEYS = ['AUTH_PROVIDER', 'DATABASE_URL', 'APP_URL'] as const
const saved: Record<string, string | undefined> = {}

// Reads Supabase Auth's own tables (auth.users, auth.identities).
describe.skipIf(!DB_URL || !CAPS?.supabase)('Supabase users → built-in auth (local stack)', () => {
  const pg = new Client({ connectionString: DB_URL })
  const pool = new Pool({ connectionString: DB_URL, max: 2 })
  let ids: string[] = []
  let demoId = ''
  const oauthUser = randomUUID()
  const oauthEmail = `oauth-${oauthUser.slice(0, 8)}@migrate.test`
  let hasDemo = false

  beforeAll(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key]
    Object.assign(process.env, { AUTH_PROVIDER: 'builtin', DATABASE_URL: DB_URL, APP_URL: 'https://app.test' })
    await pg.connect()
    const { rows } = await pg.query<{ id: string; email: string }>(`SELECT id, email FROM auth.users WHERE email = $1`, [DEMO_EMAIL])
    hasDemo = rows.length === 1
    demoId = rows[0]?.id ?? ''
    // An OAuth-only Supabase user (Google identity, no password): the trigger gives it a profile.
    await pg.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
       VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', now(), '{"full_name":"OAuth User"}', '{"provider":"google"}')`,
      [oauthUser, oauthEmail],
    )
    await pg.query(
      `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'google', now(), now(), now())`,
      [`google-sub-${oauthUser}`, oauthUser, JSON.stringify({ sub: `google-sub-${oauthUser}`, email: oauthEmail })],
    )
    ids = [demoId, oauthUser].filter(Boolean)
  }, 60_000)

  afterAll(async () => {
    await pg.query(`DELETE FROM app_auth.credentials WHERE user_id = ANY($1)`, [ids])
    await pg.query(`DELETE FROM auth.users WHERE id = $1`, [oauthUser])
    await pg.query(`DELETE FROM public.tenants WHERE slug = $1`, [`personal-${oauthUser.slice(0, 8)}`])
    await pg.end()
    await pool.end()
    const { closeAuthDb } = await import('@/lib/providers/auth/builtin/db')
    await closeAuthDb()
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }, 60_000)

  it('dry run reports without writing', async () => {
    const { migrateSupabaseUsers } = await import('@/lib/auth/migrate')
    const { poolAuthDb } = await import('@/lib/providers/auth/builtin/db')
    const report = await migrateSupabaseUsers({ db: poolAuthDb(pool), dryRun: true, userIds: ids, identityProviders: { google: 'oidc:google' } })
    expect(report).toMatchObject({ dryRun: true, users: { total: ids.length, created: ids.length, skipped: 0 }, identities: { total: 1, linked: 1 } })
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM app_auth.credentials WHERE user_id = ANY($1)`, [ids])
    expect(rows[0].n).toBe(0)
  })

  it('copies users with ids, hashes and confirmation; OAuth identities are linked; re-running is a no-op', async () => {
    const { migrateSupabaseUsers, formatMigrationReport } = await import('@/lib/auth/migrate')
    const { poolAuthDb } = await import('@/lib/providers/auth/builtin/db')
    const report = await migrateSupabaseUsers({ db: poolAuthDb(pool), userIds: ids, identityProviders: { google: 'oidc:google' } })
    expect(report.users).toMatchObject({ created: ids.length, updated: 0, unchanged: 0 })
    expect(report.withoutPassword).toBe(1)
    expect(formatMigrationReport(report)).toContain(`users: ${ids.length} found`)

    const { rows } = await pg.query(
      `SELECT c.user_id, c.email, c.password_hash = u.encrypted_password AS same_hash, c.email_confirmed_at = u.email_confirmed_at AS same_confirmed, c.migrated_from
         FROM app_auth.credentials c JOIN auth.users u ON u.id = c.user_id WHERE c.user_id = ANY($1) ORDER BY c.email`,
      [ids],
    )
    if (hasDemo) expect(rows.find((r) => r.user_id === demoId)).toMatchObject({ email: DEMO_EMAIL, same_hash: true, same_confirmed: true, migrated_from: 'supabase' })
    expect(rows.find((r) => r.user_id === oauthUser)).toMatchObject({ email: oauthEmail, same_hash: null })
    const { rows: identities } = await pg.query(`SELECT provider, subject FROM app_auth.identities WHERE user_id = $1`, [oauthUser])
    expect(identities).toEqual([{ provider: 'oidc:google', subject: `google-sub-${oauthUser}` }])

    const again = await migrateSupabaseUsers({ db: poolAuthDb(pool), userIds: ids, identityProviders: { google: 'oidc:google' } })
    expect(again.users).toMatchObject({ created: 0, updated: 0, unchanged: ids.length })
    expect(again.identities).toMatchObject({ linked: 0, unchanged: 1 })
  })

  it.skipIf(!process.env.EVENT_STREAM_DB_URL)('the migrated demo user signs in with their existing password', async () => {
    if (!hasDemo) return
    const { resolveAuthProvider } = await import('@/lib/providers/auth')
    const provider = resolveAuthProvider('builtin')
    resetRequest()
    await expect(provider.signInWithPassword(DEMO_EMAIL, 'not-the-password')).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(provider.signInWithPassword(DEMO_EMAIL, DEMO_PASSWORD)).resolves.toMatchObject({ id: demoId })
    expect((await provider.getSessionUser())?.id).toBe(demoId)
    await pg.query(`UPDATE app_auth.credentials SET failed_attempts = 0 WHERE user_id = $1`, [demoId])
  })

  it('bcrypt variants from other systems verify ($2a$ GoTrue, $2b$, $2y$)', async () => {
    const { verifyPassword } = await import('@/lib/providers/auth/builtin/passwords')
    const hash = await bcrypt.hash('portable-pass', 10)
    for (const prefix of ['$2a$', '$2b$', '$2y$']) {
      expect(await verifyPassword('portable-pass', `${prefix}${hash.slice(4)}`), prefix).toBe(true)
      expect(await verifyPassword('wrong', `${prefix}${hash.slice(4)}`), prefix).toBe(false)
    }
  })
})
