import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setAuthDbForTests, type AuthDb } from '@/lib/providers/auth/builtin/db'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'

/**
 * viewerCanSeeInfrastructure with the built-in auth provider: the address on
 * the instance admin list must be the account's own, confirmed address (or an
 * IdP-verified SSO identity). A fake app_auth store answers the lookups.
 */

const credentials = new Map<string, { email: string; email_confirmed_at: Date | null }>()
const identities: Array<{ user_id: string; email: string }> = []

const fake: AuthDb = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes('FROM app_auth.credentials')) {
      const row = credentials.get(String(params?.[0]))
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 } as never
    }
    if (sql.includes('FROM app_auth.identities')) {
      const n = identities.filter((i) => i.user_id === params?.[0] && i.email.toLowerCase() === params?.[1]).length
      return { rows: [{ n }], rowCount: 1 } as never
    }
    throw new Error(`unexpected query: ${sql}`)
  },
  transaction: (fn) => fn(fake),
}

describe('Infrastructure access with built-in auth', () => {
  const saved: Record<string, string | undefined> = {}
  const keys = ['AUTH_PROVIDER', 'INSTANCE_ADMIN_EMAILS', 'DB_PROVIDER', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']

  beforeAll(() => {
    for (const key of keys) saved[key] = process.env[key]
    for (const key of keys) delete process.env[key]
    process.env.AUTH_PROVIDER = 'builtin'
    process.env.INSTANCE_ADMIN_EMAILS = 'ops@example.com, sso-admin@example.com'
    invalidateInstanceSettingsCache()
    setAuthDbForTests(fake)
    credentials.set('confirmed', { email: 'ops@example.com', email_confirmed_at: new Date() })
    credentials.set('unconfirmed', { email: 'ops@example.com', email_confirmed_at: null })
    credentials.set('other-email', { email: 'owner@customer.com', email_confirmed_at: new Date() })
    identities.push({ user_id: 'sso-user', email: 'SSO-Admin@example.com' })
  })
  afterAll(() => {
    setAuthDbForTests(null)
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    invalidateInstanceSettingsCache()
  })

  it('allows a listed, confirmed account and a listed SSO identity', async () => {
    const { viewerCanSeeInfrastructure } = await import('@/lib/admin/infrastructure')
    expect(await viewerCanSeeInfrastructure({ id: 'confirmed', email: 'OPS@example.com' })).toBe(true)
    expect(await viewerCanSeeInfrastructure({ id: 'sso-user', email: 'sso-admin@example.com' })).toBe(true)
  })

  it('denies unconfirmed addresses, a session email that is not the account email, and unlisted users', async () => {
    const { viewerCanSeeInfrastructure } = await import('@/lib/admin/infrastructure')
    expect(await viewerCanSeeInfrastructure({ id: 'unconfirmed', email: 'ops@example.com' })).toBe(false)
    expect(await viewerCanSeeInfrastructure({ id: 'other-email', email: 'ops@example.com' })).toBe(false)
    expect(await viewerCanSeeInfrastructure({ id: 'nobody', email: 'ops@example.com' })).toBe(false)
    expect(await viewerCanSeeInfrastructure({ id: 'other-email', email: 'owner@customer.com' })).toBe(false)
    expect(await viewerCanSeeInfrastructure(null)).toBe(false)
  })
})
