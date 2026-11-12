/**
 * First-run setup against a real, EMPTY PostgreSQL (the Supabase-free stack:
 * DB_PROVIDER=postgres + AUTH_PROVIDER=builtin, migrations applied with
 * `usertasks-admin db migrate`): six simultaneous /setup submissions with
 * the right code create exactly one workspace and one owner.
 *
 * Opt-in, because it needs a throwaway database with no tenants or users:
 *   docker run -d --name ut-setup-pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
 *   DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres npm run admin -- db migrate
 *   SETUP_TEST_DATABASE_URL=postgresql://postgres:pw@127.0.0.1:55432/postgres npx vitest run __tests__/setup-db.test.ts
 * It leaves the workspace it created behind (drop the database afterwards).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.SETUP_TEST_DATABASE_URL

describe.skipIf(!DB_URL)('first-run setup on an empty PostgreSQL', () => {
  const pg = new Client({ connectionString: DB_URL })
  afterAll(async () => { await pg.end().catch(() => undefined) })

  it('concurrent submissions create exactly one owner', async () => {
    Object.assign(process.env, { DB_PROVIDER: 'postgres', AUTH_PROVIDER: 'builtin', DATABASE_URL: DB_URL, DEPLOYMENT_MODE: 'self_hosted' })
    await pg.connect()
    const count = async (table: string) => Number((await pg.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows[0].n)
    if ((await count('tenants')) || (await count('users'))) throw new Error('SETUP_TEST_DATABASE_URL must be an empty, migrated database')

    const [{ runSetup }, { setupDb }, { rotateSetupCode, resetSetupStateForTests }, { provisionTenant }, { getServiceDb }, { getAuthProvider }] = await Promise.all([
      import('@/lib/setup/run'), import('@/lib/setup/server'), import('@/lib/setup/state'),
      import('@/lib/tenant-provisioning'), import('@/lib/providers/db'), import('@/lib/providers/auth'),
    ])
    resetSetupStateForTests()
    const code = await rotateSetupCode(setupDb())
    const auth = await getAuthProvider()
    const service = getServiceDb()

    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => runSetup({
      org: 'Acme Inc', slug: `acme-${i}`, fullName: `Owner ${i}`, email: `owner${i}@acme.example`,
      password: 'correct horse battery', confirmPassword: 'correct horse battery', code,
    }, {
      db: setupDb(),
      ip: `10.0.0.${i}`,
      env: {},
      rateLimit: async () => ({ ok: true }),
      provision: (data) => provisionTenant(service, data, auth.admin),
      signIn: async () => false,
      audit: async () => {},
    })))

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(await count('tenants')).toBe(1)
    expect(await count('users')).toBe(1)
    const { rows } = await pg.query(`SELECT r.slug FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id`)
    expect(rows).toEqual([{ slug: 'owner' }])
    // The code is gone; the claim records the outcome.
    const settings = await pg.query(`SELECT key, value FROM public.instance_settings WHERE key LIKE 'instance.setup%'`)
    expect(settings.rows.map((r) => r.key)).toEqual(['instance.setup_claim'])
    expect(settings.rows[0].value).toMatchObject({ completed_at: expect.any(String) })
  }, 60_000)
})
