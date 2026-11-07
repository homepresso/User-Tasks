/**
 * The form sign-in page settings service (lib/services/form-sign-in-page.ts):
 * stored in tenants.settings.forms.sign_in next to the other keys,
 * settings.edit to change, the logo must be in the workspace's own logos
 * folder, audited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, audits: [] as unknown[] }))
const serviceDb = vi.hoisted(() => ({
  from: () => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.maybeSingle = async () => ({ data: { id: 'tenant-a', settings: db.settings }, error: null })
    q.update = (row: { settings: Record<string, unknown> }) => { db.settings = row.settings; return { eq: async () => ({ error: null }) } }
    return q
  },
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig() as object),
  serviceRoleClient: async () => serviceDb,
  audit: async (_ctx: unknown, entry: unknown) => { db.audits.push(entry) },
}))

const { getFormSignInSettings, setFormSignInSettings } = await import('@/lib/services/form-sign-in-page')

const ctx = (perms: string[]) => ({ supabase: serviceDb, tenantId: 'tenant-a', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' }) as never

beforeEach(() => {
  db.settings = { forms: { anonymous: { enabled: true } }, tasks: { completion_screen: { enabled: false } } }
  db.audits = []
})

describe('form sign-in page settings', () => {
  it('reads the defaults until changed', async () => {
    expect((await getFormSignInSettings(ctx([]))).design).toBe(1)
  })

  it('needs settings.edit', async () => {
    await expect(setFormSignInSettings(ctx(['settings.view']), { design: 3 })).rejects.toThrow()
  })

  it('saves a change next to the other settings, audited', async () => {
    const next = await setFormSignInSettings(ctx(['settings.edit']), { design: 6, heading: 'Hello', logo_url: '/files/logos/tenant-a/form-sign-in.png?t=1' })
    expect(next).toMatchObject({ design: 6, heading: 'Hello', logo_url: '/files/logos/tenant-a/form-sign-in.png?t=1' })
    expect(db.settings).toMatchObject({ forms: { anonymous: { enabled: true }, sign_in: { design: 6 } }, tasks: { completion_screen: { enabled: false } } })
    expect(db.audits).toHaveLength(1)
  })

  it('turns the workspace theme on and off (off by default)', async () => {
    expect((await getFormSignInSettings(ctx([]))).use_workspace_theme).toBe(false)
    expect((await setFormSignInSettings(ctx(['settings.edit']), { use_workspace_theme: true })).use_workspace_theme).toBe(true)
    expect(db.settings).toMatchObject({ forms: { sign_in: { use_workspace_theme: true } } })
    await expect(setFormSignInSettings(ctx(['settings.edit']), { use_workspace_theme: 'on' })).rejects.toThrow(/use_workspace_theme/)
  })

  it('refuses a logo outside the workspace’s logos folder and invalid input', async () => {
    await expect(setFormSignInSettings(ctx(['settings.edit']), { logo_url: '/files/logos/tenant-b/form-sign-in.png' })).rejects.toThrow(/logo/)
    await expect(setFormSignInSettings(ctx(['settings.edit']), { logo_url: 'https://evil.example/x.png' })).rejects.toThrow(/logo/)
    await expect(setFormSignInSettings(ctx(['settings.edit']), { design: 11 })).rejects.toThrow(/design/)
    expect(db.audits).toHaveLength(0)
  })
})
