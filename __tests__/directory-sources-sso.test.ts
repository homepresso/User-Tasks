import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SSO sign-in and pending directory entries (lib/providers/auth/sso/accounts.ts
 * + lib/directory-sync/sources.ts): a person a directory source lists as
 * pending gets an account at first sign-in even without jit; every sign-in
 * claims the person's pending entries for the verified addresses (the email,
 * plus the UPN in an allowed domain); unverified emails claim nothing.
 */

const sources = vi.hoisted(() => ({
  pending: false,
  claims: [] as Array<{ userId: string; keys: string[] }>,
}))
vi.mock('@/lib/directory-sync/sources', () => ({
  hasPendingDirectoryEntry: vi.fn(async () => sources.pending),
  claimDirectoryEntries: vi.fn(async (_db: unknown, input: { userId: string; keys: string[] }) => { sources.claims.push(input); return { tenants: ['tenant-sp'], refused: 0 } }),
}))
const created: string[] = []
vi.mock('@/lib/providers/auth/builtin/db', () => ({ authDb: () => ({ transaction: async (fn: (tx: unknown) => Promise<void>) => fn({}) }) }))
vi.mock('@/lib/providers/auth/builtin/store', () => ({
  findIdentity: vi.fn(async () => null),
  findCredentialByEmail: vi.fn(async () => null),
  insertCredential: vi.fn(async () => undefined),
  linkIdentity: vi.fn(async () => undefined),
  confirmEmail: vi.fn(async () => undefined),
}))
vi.mock('@/lib/providers/auth/provisioning', () => ({
  onUserCreated: vi.fn(async (_tx: unknown, user: { id: string }) => { created.push(user.id) }),
  grantTenantRole: vi.fn(async () => true),
}))
const homes: Array<Record<string, unknown>> = []
vi.mock('@/lib/providers/db', () => ({
  getServiceDb: () => ({
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, is: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: null }),
        update: (patch: Record<string, unknown>) => { homes.push(patch); return chain },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null }).then(resolve),
      }
      return chain
    },
  }),
}))

import { parseSsoProviders, type OidcIdpConfig } from '@/lib/providers/auth/sso/config'
import { resolveExternalAccount, type ExternalIdentity } from '@/lib/providers/auth/sso/accounts'

const identity = (fields: Partial<ExternalIdentity> = {}, idpFields: Record<string, unknown> = {}): ExternalIdentity => ({
  idp: parseSsoProviders([{ id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: 'https://adfs.contoso.local', clientId: 'c', allowedDomains: ['contoso.local'], jit: false, ...idpFields }])[0] as OidcIdpConfig,
  subject: 'sub-1', email: 'ut-jit@contoso.local', emailVerified: true, name: 'Jit', groups: [], claims: { upn: 'UT-JIT@contoso.local' }, ...fields,
})

beforeEach(() => { sources.pending = false; sources.claims.length = 0; created.length = 0; homes.length = 0 })

describe('SSO and pending directory entries', () => {
  it('without jit and without a pending entry: refused', async () => {
    await expect(resolveExternalAccount(identity())).rejects.toThrow(/No account exists/)
    expect(created).toEqual([])
  })

  it('without jit, a pending entry creates the account and claims it (home = the source workspace)', async () => {
    sources.pending = true
    const { user, created: isNew } = await resolveExternalAccount(identity())
    expect(isNew).toBe(true)
    expect(created).toEqual([user.id])
    expect(sources.claims).toEqual([{ userId: user.id, keys: ['ut-jit@contoso.local'] }])
    expect(homes).toContainEqual({ tenant_id: 'tenant-sp', current_tenant_id: 'tenant-sp' })
  })

  it('claims with the UPN as well when it is in an allowed domain; never for unverified emails', async () => {
    sources.pending = true
    await resolveExternalAccount(identity({ claims: { upn: 'jdoe@contoso.local' } }))
    expect(sources.claims[0].keys).toEqual(['ut-jit@contoso.local', 'jdoe@contoso.local'])
    await resolveExternalAccount(identity({ claims: { upn: 'jdoe@elsewhere.com' } }, { jit: true }))
    expect(sources.claims[1].keys).toEqual(['ut-jit@contoso.local'])
    sources.claims.length = 0
    await expect(resolveExternalAccount(identity({ emailVerified: false }))).rejects.toThrow()
    expect(sources.claims).toEqual([])
  })
})
