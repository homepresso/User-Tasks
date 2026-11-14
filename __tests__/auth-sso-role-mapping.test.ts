import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Group → role mapping on later SSO sign-ins (lib/providers/auth/sso/accounts.ts):
 * a mapped role replaces the current one; with enforceRoleMapping a sign-in
 * whose groups map to nothing goes back to defaultRole; a workspace owner is
 * never replaced by a claim rule unless the mapping itself says owner.
 */

const granted: Array<{ userId: string; slug: string; role: string; opts: Record<string, unknown> }> = []
let currentRoleSlug = 'admin'

vi.mock('@/lib/providers/auth/builtin/db', () => ({ authDb: () => ({}) }))
vi.mock('@/lib/providers/auth/builtin/store', () => ({
  findIdentity: vi.fn(async () => ({ user_id: 'user-1' })),
  findCredentialByEmail: vi.fn(async () => null),
  insertCredential: vi.fn(async () => undefined),
  linkIdentity: vi.fn(async () => undefined),
  confirmEmail: vi.fn(async () => undefined),
}))
vi.mock('@/lib/providers/auth/provisioning', () => ({
  onUserCreated: vi.fn(async () => undefined),
  grantTenantRole: vi.fn(async (userId: string, slug: string, role: string, opts: Record<string, unknown> = {}) => { granted.push({ userId, slug, role, opts }); return true }),
}))
// tenants → user_roles → roles, as holdsOwnerRole reads them.
vi.mock('@/lib/providers/db', () => ({
  getServiceDb: () => ({
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const result = () => {
        if (table === 'tenants') return { data: { id: 'tenant-1' } }
        if (table === 'user_roles') return { data: [{ role_id: `role-${currentRoleSlug}` }] }
        if (table === 'roles') return { data: filters.slug === 'owner' && currentRoleSlug === 'owner' ? [{ id: 'role-owner' }] : [] }
        return { data: null }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; return chain },
        in: () => chain,
        is: () => chain,
        limit: () => chain,
        maybeSingle: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return chain
    },
  }),
}))

import { parseSsoProviders, type OidcIdpConfig } from '@/lib/providers/auth/sso/config'
import { resolveExternalAccount, type ExternalIdentity } from '@/lib/providers/auth/sso/accounts'

const idp = (fields: Record<string, unknown> = {}) => parseSsoProviders([{
  id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: 'https://adfs.contoso.local', clientId: 'c', allowedDomains: ['contoso.local'],
  defaultOrg: 'contoso', defaultRole: 'member', roleMapping: { 'UT-Admins': 'admin', 'UT-Owners': 'owner' }, ...fields,
}])[0] as OidcIdpConfig
const identity = (groups: string[], fields: Record<string, unknown> = {}): ExternalIdentity => ({
  idp: idp(fields), subject: 'sub-1', email: 'jdoe@contoso.local', emailVerified: true, name: 'J Doe', groups, claims: {},
})

beforeEach(() => { granted.length = 0; currentRoleSlug = 'admin' })

describe('SSO group → role mapping on sign-in', () => {
  it('a mapped group sets the role on every sign-in', async () => {
    currentRoleSlug = 'member'
    await resolveExternalAccount(identity(['Domain Users', 'ut-admins']))
    expect(granted).toEqual([{ userId: 'user-1', slug: 'contoso', role: 'admin', opts: { replace: true } }])
  })

  it('no mapped group: the role is kept by default, reset to defaultRole with enforceRoleMapping', async () => {
    await resolveExternalAccount(identity(['Domain Users']))
    expect(granted).toEqual([])
    await resolveExternalAccount(identity(['Domain Users'], { enforceRoleMapping: true }))
    expect(granted).toEqual([{ userId: 'user-1', slug: 'contoso', role: 'member', opts: { replace: true } }])
  })

  it('an owner is never demoted by a claim rule, but a mapping to owner applies', async () => {
    currentRoleSlug = 'owner'
    await resolveExternalAccount(identity(['UT-Admins']))
    await resolveExternalAccount(identity([], { enforceRoleMapping: true }))
    expect(granted).toEqual([])
    currentRoleSlug = 'member'
    await resolveExternalAccount(identity(['UT-Owners']))
    expect(granted.at(-1)).toMatchObject({ role: 'owner' })
  })

  it('enforceRoleMapping defaults to false and needs no roleMapping to parse', () => {
    expect(idp().enforceRoleMapping).toBe(false)
    expect(idp({ roleMapping: undefined, enforceRoleMapping: true }).enforceRoleMapping).toBe(true)
  })
})
