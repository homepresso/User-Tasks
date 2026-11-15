/**
 * The workspace's automatic sign-in settings (lib/services/workspace-sso.ts):
 * stored in tenants.settings.sso next to the other keys, settings.edit to
 * change, the IdP must be one of the instance's, audited; the view says which
 * IdP is in effect.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, audits: [] as unknown[] }))
const serviceDb = vi.hoisted(() => ({
  from: () => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.maybeSingle = async () => ({ data: { id: 'tenant-a', slug: 'contoso', settings: db.settings }, error: null })
    q.update = (row: { settings: Record<string, unknown> }) => { db.settings = row.settings; return { eq: async () => ({ error: null }) } }
    return q
  },
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig() as object),
  serviceRoleClient: async () => serviceDb,
  audit: async (_ctx: unknown, entry: unknown) => { db.audits.push(entry) },
}))

const { getWorkspaceSso, setWorkspaceSso, workspaceSsoDeps } = await import('@/lib/services/workspace-sso')

const ctx = (perms: string[]) => ({ supabase: serviceDb, tenantId: 'tenant-a', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' }) as never

beforeEach(() => {
  db.settings = { forms: { sign_in: { design: 2 } } }
  db.audits = []
  workspaceSsoDeps.candidates = async () => ({
    candidates: [{ id: 'adfs', name: 'Contoso AD FS', defaultOrg: 'contoso' }, { id: 'okta', name: 'Okta', defaultOrg: 'other' }],
    implicit: true,
    instanceSsoOnly: false,
  })
})

describe('workspace single sign-on settings', () => {
  it('defaults, with the IdPs and the one in effect (the IdP provisioning into this workspace)', async () => {
    expect(await getWorkspaceSso(ctx([]))).toEqual({
      auto_sign_in: true, sso_only: false, idp: null, instance_sso_only: false,
      providers: [{ id: 'adfs', name: 'Contoso AD FS' }, { id: 'okta', name: 'Okta' }],
      effective_idp: 'adfs',
    })
  })

  it('needs settings.edit', async () => {
    await expect(setWorkspaceSso(ctx(['settings.view']), { sso_only: true })).rejects.toThrow()
  })

  it('saves next to the other settings, audited', async () => {
    const next = await setWorkspaceSso(ctx(['settings.edit']), { sso_only: true, idp: 'okta' })
    expect(next).toMatchObject({ auto_sign_in: true, sso_only: true, idp: 'okta', effective_idp: 'okta' })
    expect(db.settings).toEqual({ forms: { sign_in: { design: 2 } }, sso: { auto_sign_in: true, sso_only: true, idp: 'okta' } })
    expect(db.audits).toHaveLength(1)
    expect((await setWorkspaceSso(ctx(['settings.edit']), { idp: null, auto_sign_in: false })).effective_idp).toBe('adfs')
  })

  it('refuses an IdP the instance does not have, and malformed input', async () => {
    await expect(setWorkspaceSso(ctx(['settings.edit']), { idp: 'entra' })).rejects.toThrow(/not an identity provider of this instance \(adfs, okta\)/)
    await expect(setWorkspaceSso(ctx(['settings.edit']), { auto_sign_in: 'yes' })).rejects.toThrow(/true or false/)
    await expect(setWorkspaceSso(ctx(['settings.edit']), { username: 'anab' })).rejects.toThrow(/Unknown setting/)
    expect(db.audits).toHaveLength(0)
  })
})
