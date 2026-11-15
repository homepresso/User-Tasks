/**
 * First SSO sign-in of someone an organisation brought in — the IdP's
 * defaultOrg, or a pending directory entry (e.g. a SharePoint site user
 * arriving through the add-in button) — creates the account in that
 * workspace and no personal workspace (provision_auth_user_in); everyone
 * else keeps the personal workspace (provision_auth_user). Older databases
 * without the new function fall back to the personal workspace.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params?: unknown[] }>,
  hasFunction: true,
  pendingTenants: [] as string[],
  tenants: { contoso: 'tenant-contoso', fabrikam: 'tenant-fabrikam' } as Record<string, string>,
  grants: [] as unknown[],
}))

const fakeDb = vi.hoisted(() => {
  const db = {
    async query(sql: string, params?: unknown[]) {
      state.queries.push({ sql, params })
      if (sql.includes('to_regprocedure')) return { rows: [{ ok: state.hasFunction }], rowCount: 1 }
      if (sql.includes('provision_auth_user')) return { rows: [{ created: true }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
    async transaction(fn: (tx: unknown) => Promise<unknown>) { return fn(db) },
  }
  return db
})

vi.mock('@/lib/providers/auth/builtin/db', () => ({ authDb: () => fakeDb }))
vi.mock('@/lib/providers/auth/builtin/store', () => ({
  findIdentity: async () => null,
  findCredentialByEmail: async () => null,
  insertCredential: async () => undefined,
  linkIdentity: async () => undefined,
  confirmEmail: async () => undefined,
}))
vi.mock('@/lib/providers/db', () => ({
  getServiceDb: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      let slug = ''
      q.select = () => q
      q.eq = (col: string, value: string) => { if (col === 'slug') slug = value; return q }
      q.is = () => q
      q.in = () => q
      q.limit = () => q
      q.update = () => ({ eq: async () => ({ error: null }) })
      q.maybeSingle = async () => ({ data: table === 'tenants' && state.tenants[slug] ? { id: state.tenants[slug] } : null })
      return q
    },
  }),
  hasServiceDb: () => true,
}))
vi.mock('@/lib/directory-sync/sources', () => ({
  hasPendingDirectoryEntry: async () => state.pendingTenants.length > 0,
  pendingDirectoryTenants: async () => state.pendingTenants,
  claimDirectoryEntries: async () => ({ tenants: state.pendingTenants, refused: 0 }),
}))
vi.mock('@/lib/providers/auth/provisioning', async (orig) => ({
  ...(await orig() as object),
  grantTenantRole: async (...args: unknown[]) => { state.grants.push(args); return true },
}))

const { resolveExternalAccount } = await import('@/lib/providers/auth/sso/accounts')
const { parseSsoProviders } = await import('@/lib/providers/auth/sso/config')

const idp = (fields: Record<string, unknown>) => parseSsoProviders([{ id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: 'https://adfs.contoso.local', clientId: 'c', allowedDomains: ['contoso.local'], ...fields }])[0]
const identity = (fields: Record<string, unknown>) => ({
  idp: idp(fields), subject: 's-1', email: 'ut-plain@contoso.local', emailVerified: true, name: 'UT Plain', groups: ['UT-Users'], claims: { upn: 'ut-plain@contoso.local' },
})
const provisionCall = () => state.queries.find((q) => /SELECT public\.provision_auth_user/.test(q.sql))

beforeEach(() => {
  state.queries.length = 0
  state.grants.length = 0
  state.hasFunction = true
  state.pendingTenants = []
})

describe('first SSO sign-in: which workspace the account is created in', () => {
  it('defaultOrg: created in that workspace, no personal workspace', async () => {
    const { created } = await resolveExternalAccount(identity({ defaultOrg: 'contoso', defaultRole: 'member' }) as never)
    expect(created).toBe(true)
    expect(provisionCall()?.sql).toMatch(/provision_auth_user_in\(/)
    expect(provisionCall()?.params?.[4]).toBe('tenant-contoso')
    expect(state.grants[0]).toEqual([expect.any(String), 'contoso', 'member', { setHome: true }])
  })

  it('a pending directory entry (no defaultOrg, JIT off): created in the directory source\'s workspace', async () => {
    state.pendingTenants = ['tenant-fabrikam']
    await resolveExternalAccount(identity({ jit: false }) as never)
    expect(provisionCall()?.sql).toMatch(/provision_auth_user_in\(/)
    expect(provisionCall()?.params?.[4]).toBe('tenant-fabrikam')
  })

  it('nobody brought them in (JIT, no defaultOrg, no directory entry): a personal workspace as before', async () => {
    await resolveExternalAccount(identity({}) as never)
    expect(provisionCall()?.sql).toMatch(/provision_auth_user\(\$1, \$2, \$3, \$4\)/)
  })

  it('an older database without provision_auth_user_in: the personal workspace, then the home moves (setHome)', async () => {
    state.hasFunction = false
    await resolveExternalAccount(identity({ defaultOrg: 'contoso' }) as never)
    expect(provisionCall()?.sql).toMatch(/provision_auth_user\(\$1, \$2, \$3, \$4\)/)
    expect(state.grants[0]).toEqual([expect.any(String), 'contoso', 'viewer', { setHome: true }])
  })
})
