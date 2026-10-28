import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { writeAudit } from '@/lib/audit-log'
import type { ServiceContext } from '@/lib/services/context'
import { applyWorkspaceThemePreset, getWorkspaceTheme, updateWorkspaceTheme } from '@/lib/services/workspace-theme'
import { defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const BASE = 'https://proj.supabase.co'

function seed(rows: any[] = [{ tenant_id: 'tenant-a', theme: { base_preset: 'night-drive' }, version: 1, updated_by: null, updated_at: '2026-10-01T00:00:00Z' }]) {
  return createMemorySupabase({ workspace_themes: rows })
}
type Db = ReturnType<typeof seed>

// authKind 'api_key' → serviceRoleClient() uses ctx.supabase (the memory db).
const ctx = (db: Db, permissions: string[], tenantId = 'tenant-a'): ServiceContext => ({
  supabase: db as any, tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api',
})
const row = (db: Db, tenantId = 'tenant-a') => (db.tables.workspace_themes as any[]).find((r) => r.tenant_id === tenantId)

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
  vi.mocked(writeAudit).mockClear()
})

describe('getWorkspaceTheme', () => {
  it('expands the seeded preset stub for any member (no permission needed)', async () => {
    const result = await getWorkspaceTheme(ctx(seed(), []))
    expect(result.theme.meta).toMatchObject({ name: 'Noir', basePreset: 'night-drive' })
    expect(result.version).toBe(1)
    expect(result.contrast.every((i) => i.level === 'warn')).toBe(true)
  })

  it('falls back to the platform default without a row', async () => {
    const result = await getWorkspaceTheme(ctx(seed([]), []))
    expect(result.theme.meta.basePreset).toBe('basecamp')
    expect(result.version).toBe(0)
  })
})

describe('updateWorkspaceTheme', () => {
  it('requires settings.edit', async () => {
    const db = seed()
    await expect(updateWorkspaceTheme(ctx(db, ['settings.view']), defaultWorkspaceTheme())).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(row(db).version).toBe(1)
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it('stores a validated theme, bumps the version and audits', async () => {
    const db = seed()
    const theme = presetToWorkspaceTheme('lagoon')!
    theme.meta.name = 'Acme brand'
    const result = await updateWorkspaceTheme(ctx(db, ['settings.edit']), theme)
    expect(result.version).toBe(2)
    expect(row(db)).toMatchObject({ version: 2, updated_by: 'user-1' })
    expect(row(db).theme.meta.name).toBe('Acme brand')
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'theme', objectId: 'tenant-a', tenantId: 'tenant-a', action: 'update' }))
  })

  it('inserts the row when the workspace has none yet', async () => {
    const db = seed([])
    await updateWorkspaceTheme(ctx(db, ['settings.edit']), defaultWorkspaceTheme())
    expect(row(db)).toMatchObject({ tenant_id: 'tenant-a', version: 1 })
  })

  it('rejects invalid themes and CSS injection with a validation error', async () => {
    const db = seed()
    const bad = defaultWorkspaceTheme() as any
    bad.colors.light.primary = '#000;}body{background:url(https://evil.example)'
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), bad)).rejects.toMatchObject({ code: 'validation_error', status: 400 })
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), { meta: {} })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), 'x'.repeat(70_000))).rejects.toMatchObject({ code: 'validation_error' })
    expect(row(db).version).toBe(1)
  })

  it('refuses themes whose primary buttons or sidebar text fall below 3:1', async () => {
    const theme = defaultWorkspaceTheme()
    theme.colors.light.onPrimary = theme.colors.light.primary
    await expect(updateWorkspaceTheme(ctx(seed(), ['settings.edit']), theme)).rejects.toMatchObject({ code: 'validation_error', message: expect.stringContaining('onPrimary/primary') })
  })

  it("only accepts this workspace's own uploads", async () => {
    const db = seed()
    const other = defaultWorkspaceTheme()
    other.branding.logoLight = `${BASE}/storage/v1/object/public/logos/tenant-b/logo.png`
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), other)).rejects.toMatchObject({ code: 'validation_error' })
    const font = defaultWorkspaceTheme()
    font.typography.sans = { source: 'upload', family: 'Brand Sans', url: `${BASE}/storage/v1/object/public/brand-fonts/tenant-b/brand.woff2` }
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), font)).rejects.toMatchObject({ code: 'validation_error' })
    const own = defaultWorkspaceTheme()
    own.branding.logoLight = `${BASE}/storage/v1/object/public/logos/tenant-a/logo.png`
    own.typography.sans = { source: 'upload', family: 'Brand Sans', url: `${BASE}/storage/v1/object/public/brand-fonts/tenant-a/brand.woff2` }
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), own)).resolves.toMatchObject({ version: 2 })
  })

  it('rejects a stale expectedVersion with 409', async () => {
    const db = seed()
    await updateWorkspaceTheme(ctx(db, ['settings.edit']), defaultWorkspaceTheme(), { expectedVersion: 1 })
    await expect(updateWorkspaceTheme(ctx(db, ['settings.edit']), defaultWorkspaceTheme(), { expectedVersion: 1 })).rejects.toMatchObject({ code: 'conflict', status: 409 })
  })

  it('writes only the caller’s tenant', async () => {
    const db = seed([
      { tenant_id: 'tenant-a', theme: { base_preset: 'basecamp' }, version: 1 },
      { tenant_id: 'tenant-b', theme: { base_preset: 'sage' }, version: 4 },
    ])
    await updateWorkspaceTheme(ctx(db, ['settings.edit']), presetToWorkspaceTheme('onyx')!)
    expect(row(db, 'tenant-b')).toMatchObject({ version: 4, theme: { base_preset: 'sage' } })
  })
})

describe('applyWorkspaceThemePreset', () => {
  it('applies a template and rejects unknown ids', async () => {
    const db = seed()
    await applyWorkspaceThemePreset(ctx(db, ['settings.edit']), 'corporate-blue')
    expect(row(db).theme.meta).toMatchObject({ name: 'Corporate Blue', basePreset: 'corporate-blue' })
    await expect(applyWorkspaceThemePreset(ctx(db, ['settings.edit']), 'nope')).rejects.toMatchObject({ code: 'validation_error' })
    await expect(applyWorkspaceThemePreset(ctx(db, []), 'onyx')).rejects.toMatchObject({ code: 'forbidden' })
  })
})
