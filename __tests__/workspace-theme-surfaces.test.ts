import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as getTheme, PUT as putTheme } from '@/app/api/v1/workspace-theme/route'
import { POST as applyPreset } from '@/app/api/v1/workspace-theme/apply-preset/route'
import { GET as listPresets } from '@/app/api/v1/workspace-theme/presets/route'
import { POST as uploadFont } from '@/app/api/v1/workspace-theme/fonts/route'
import { createMcpServer } from '@/lib/mcp/server'
import { PERMISSION_KEYS } from '@/lib/permissions'
import type { ServiceContext } from '@/lib/services/context'
import { applyConfig, exportConfig } from '@/lib/services/config'
import {
  MAX_FONT_BYTES, familyFromFileName, resolveManifestWorkspaceTheme, uploadWorkspaceThemeFont, validateFontUpload, workspaceThemeToManifest,
} from '@/lib/services/workspace-theme'
import { filesToManifest, manifestToFiles } from '@/lib/github-sync/layout'
import { THEME_TEMPLATES, defaultWorkspaceTheme, presetToWorkspaceTheme } from '@/lib/theme/presets'
import type { WorkspaceTheme } from '@/lib/theme/schema'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { pinDefaultStorageProvider } from './fixtures/pin-storage'

// Supabase Storage path (mocked client / local stack buckets).
pinDefaultStorageProvider()

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows and JSON bodies */

const BASE = 'https://proj.supabase.co'
const A = 'tenant-a'
const B = 'tenant-b'
const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, 1, 2, 3, 4])
const logoUrl = (tenant: string, file = 'logo-light.png') => `${BASE}/storage/v1/object/public/logos/${tenant}/${file}?t=1`
const fontUrl = (tenant: string, file: string) => `${BASE}/storage/v1/object/public/brand-fonts/${tenant}/${file}`

/** Memory db plus a minimal Storage API (upload / list) for brand-fonts. */
function seed(rows: any[] = []) {
  const db = createMemorySupabase({ workspace_themes: rows }) as ReturnType<typeof createMemorySupabase> & { storage: any; objects: Map<string, any> }
  const objects = new Map<string, any>()
  db.objects = objects
  db.storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts: any) => { objects.set(`${bucket}/${path}`, { bytes, opts }); return { data: { path }, error: null } },
      list: async (folder: string, opts: { search?: string } = {}) => ({
        data: [...objects.keys()]
          .filter((key) => key.startsWith(`${bucket}/${folder}/`))
          .map((key) => ({ name: key.slice(`${bucket}/${folder}/`.length) }))
          .filter((o) => !opts.search || o.name.includes(opts.search)),
        error: null,
      }),
    }),
  }
  return db
}
type Db = ReturnType<typeof seed>

const ctx = (db: Db, permissions: readonly string[] = PERMISSION_KEYS, tenantId = A): ServiceContext => ({
  supabase: db as any, tenantId, actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api',
})
const stored = (db: Db, tenantId = A) => (db.tables.workspace_themes as any[]).find((r) => r.tenant_id === tenantId)

const mockedValidate = vi.mocked(validateApiKey)
function authAs(db: Db, permissions: string[]) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: A, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}
function req(path: string, init: { method?: string; body?: unknown; form?: FormData } = {}) {
  return new NextRequest(`https://app.test/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', ...(init.form ? {} : { 'content-type': 'application/json' }) },
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  })
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE)
  mockedValidate.mockReset()
})

// ── REST ────────────────────────────────────────────────────────────────────

describe('/api/v1/workspace-theme', () => {
  it('GET needs no permission and returns the theme, version and contrast', async () => {
    authAs(seed([{ tenant_id: A, theme: { base_preset: 'night-drive' }, version: 2 }]), [])
    const res = await getTheme(req('/workspace-theme'))
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data).toMatchObject({ version: 2, workspace_theme: { meta: { basePreset: 'night-drive' } } })
    expect(Array.isArray(data.contrast)).toBe(true)
  })

  it('PUT needs settings.edit', async () => {
    const db = seed()
    authAs(db, ['settings.view'])
    const res = await putTheme(req('/workspace-theme', { method: 'PUT', body: defaultWorkspaceTheme() }))
    expect(res.status).toBe(403)
    expect(db.tables.workspace_themes).toEqual([])
  })

  it('PUT accepts the GET response as the body (round trip) and checks expected_version', async () => {
    const db = seed([{ tenant_id: A, theme: { base_preset: 'lagoon' }, version: 4 }])
    authAs(db, ['settings.edit'])
    const fetched = await (await getTheme(req('/workspace-theme'))).json()
    fetched.data.workspace_theme.meta.name = 'Acme'
    const res = await putTheme(req('/workspace-theme', { method: 'PUT', body: fetched.data }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ version: 5, workspace_theme: { meta: { name: 'Acme' } } })

    const stale = await putTheme(req('/workspace-theme', { method: 'PUT', body: { ...fetched.data.workspace_theme, expected_version: 4 } }))
    expect(stale.status).toBe(409)
    expect(stored(db).version).toBe(5)
  })

  it('PUT rejects CSS injection and unknown keys with field details', async () => {
    authAs(seed(), ['settings.edit'])
    const theme: any = defaultWorkspaceTheme()
    theme.colors.light.primary = '#fff;}body{background:url(//x)'
    theme.extra = true
    const res = await putTheme(req('/workspace-theme', { method: 'PUT', body: theme }))
    expect(res.status).toBe(400)
    const paths = (await res.json()).details.map((d: { path: string }) => d.path)
    expect(paths).toEqual(expect.arrayContaining(['body.colors.light.primary']))
  })

  it('apply-preset replaces the theme; unknown templates are a 400', async () => {
    const db = seed()
    authAs(db, ['settings.edit'])
    expect((await applyPreset(req('/workspace-theme/apply-preset', { method: 'POST', body: { preset_id: 'nope' } }))).status).toBe(400)
    const res = await applyPreset(req('/workspace-theme/apply-preset', { method: 'POST', body: { preset_id: 'aurora' } }))
    expect(res.status).toBe(200)
    expect(stored(db).theme.meta.basePreset).toBe('aurora')
    authAs(db, ['settings.view'])
    expect((await applyPreset(req('/workspace-theme/apply-preset', { method: 'POST', body: { preset_id: 'lagoon' } }))).status).toBe(403)
  })

  it('presets lists every built-in template with swatches (any member)', async () => {
    authAs(seed(), [])
    const { data } = await (await listPresets(req('/workspace-theme/presets'))).json()
    expect(data.total).toBe(THEME_TEMPLATES.length)
    expect(data.presets[0]).toMatchObject({ id: expect.any(String), swatches: { light: { primary: expect.any(String) }, dark: { primary: expect.any(String) } } })
  })

  it('fonts: JSON base64 and multipart uploads land in the tenant folder', async () => {
    const db = seed()
    authAs(db, ['settings.edit'])
    const json = await uploadFont(req('/workspace-theme/fonts', { method: 'POST', body: { file_name: 'Acme-Sans.woff2', content_base64: Buffer.from(WOFF2).toString('base64') } }))
    expect(json.status).toBe(201)
    const { data } = await json.json()
    expect(data.font).toMatchObject({ source: 'upload', family: 'Acme Sans' })
    expect(data.font.url).toBe(fontUrl(A, data.path))
    expect([...db.objects.keys()]).toEqual([`brand-fonts/${A}/${data.path}`])
    expect(db.objects.get(`brand-fonts/${A}/${data.path}`).opts.contentType).toBe('font/woff2')

    const form = new FormData()
    form.set('file', new File([WOFF2], 'Brand.woff2', { type: 'font/woff2' }))
    form.set('family', 'Brand Display')
    const multipart = await uploadFont(req('/workspace-theme/fonts', { method: 'POST', form }))
    expect(multipart.status).toBe(201)
    expect((await multipart.json()).data.font.family).toBe('Brand Display')
  })

  it('fonts: refuses other types, bad signatures, oversized files and callers without settings.edit', async () => {
    const db = seed()
    authAs(db, ['settings.edit'])
    const post = (body: unknown) => uploadFont(req('/workspace-theme/fonts', { method: 'POST', body }))
    expect((await post({ file_name: 'a.ttf', content_base64: Buffer.from(WOFF2).toString('base64') })).status).toBe(400)
    expect((await post({ file_name: 'a.woff2', content_base64: Buffer.from('<svg/>').toString('base64') })).status).toBe(400)
    expect((await post({ file_name: 'a.woff2', content_base64: '!!not base64!!' })).status).toBe(400)
    authAs(db, ['settings.view'])
    expect((await post({ file_name: 'a.woff2', content_base64: Buffer.from(WOFF2).toString('base64') })).status).toBe(403)
    expect(db.objects.size).toBe(0)
  })
})

// ── upload validation ───────────────────────────────────────────────────────

describe('font upload validation', () => {
  it('checks extension, signature, size and family name', () => {
    expect(validateFontUpload({ fileName: 'Inter-Var.woff2', bytes: WOFF2 })).toEqual({ family: 'Inter Var' })
    expect(() => validateFontUpload({ fileName: 'x.woff', bytes: WOFF2 })).toThrow(/woff2/)
    expect(() => validateFontUpload({ fileName: 'x.woff2', bytes: new Uint8Array() })).toThrow(/empty/)
    expect(() => validateFontUpload({ fileName: 'x.woff2', bytes: new Uint8Array([0x77, 0x4f, 0x46, 0x46]) })).toThrow(/not a woff2/)
    const big = new Uint8Array(MAX_FONT_BYTES + 1)
    big.set(WOFF2)
    expect(() => validateFontUpload({ fileName: 'x.woff2', bytes: big })).toThrow(expect.objectContaining({ status: 413 }))
    expect(() => validateFontUpload({ fileName: 'x.woff2', bytes: WOFF2, family: "x'; } body { color: red" })).toThrow(/letters, digits/)
    expect(familyFromFileName('../../etc/My_Font!.woff2')).toBe('etcMy Font')
  })

  it('stores under <tenant>/<slug>-<hash>.woff2 only, whatever the file name says', async () => {
    const db = seed()
    const result = await uploadWorkspaceThemeFont(ctx(db), { fileName: '../../other-tenant/evil.woff2', bytes: WOFF2 })
    const [key] = [...db.objects.keys()]
    expect(key).toMatch(new RegExp(`^brand-fonts/${A}/[a-z0-9-]+-[0-9a-f]{12}\\.woff2$`))
    expect(result.path).not.toContain('/')
    await expect(uploadWorkspaceThemeFont(ctx(db, ['settings.view']), { fileName: 'a.woff2', bytes: WOFF2 })).rejects.toMatchObject({ code: 'forbidden' })
  })
})

// ── MCP ─────────────────────────────────────────────────────────────────────

describe('MCP workspace_theme_* tools', () => {
  const textOf = (r: any) => r?.content?.[0]?.text ?? ''
  const server = (db: Db, permissions: string[]) => createMcpServer({ tenantId: A, supabase: db, actingUserId: 'u1', keyType: 'tenant', permissions })

  it('reads need only the any-member floor; writes need settings.edit', async () => {
    const db = seed()
    const reader = server(db, ['tasks.view_own'])
    const got = await reader.callTool('workspace_theme_get', {})
    expect(got.isError).toBeFalsy()
    expect(JSON.parse(textOf(got))).toMatchObject({ version: 0, workspace_theme: { meta: { basePreset: 'basecamp' } } })
    expect(JSON.parse(textOf(await reader.callTool('workspace_theme_presets_list', {}))).total).toBe(THEME_TEMPLATES.length)

    for (const [tool, args] of [
      ['workspace_theme_update', { theme: defaultWorkspaceTheme() }],
      ['workspace_theme_apply_preset', { preset_id: 'lagoon' }],
      ['workspace_theme_font_upload', { file_name: 'a.woff2', content_base64: Buffer.from(WOFF2).toString('base64') }],
    ] as const) {
      const denied = await reader.callTool(tool, args)
      expect(denied.isError, tool).toBe(true)
      expect(textOf(denied)).toContain('settings.edit')
    }
    expect(db.tables.workspace_themes).toEqual([])
    expect(db.objects.size).toBe(0)
  })

  it('updates, applies templates and uploads fonts with settings.edit', async () => {
    const db = seed()
    const editor = server(db, ['settings.edit'])
    const theme = presetToWorkspaceTheme('lagoon')!
    theme.meta.name = 'Via MCP'
    expect((await editor.callTool('workspace_theme_update', { theme })).isError).toBeFalsy()
    expect(stored(db)).toMatchObject({ version: 1, theme: { meta: { name: 'Via MCP' } } })
    const conflict = await editor.callTool('workspace_theme_apply_preset', { preset_id: 'aurora', expected_version: 0 })
    expect(conflict.isError).toBe(true)
    expect((await editor.callTool('workspace_theme_apply_preset', { preset_id: 'aurora', expected_version: 1 })).isError).toBeFalsy()
    expect(stored(db).theme.meta.basePreset).toBe('aurora')
    const font = await editor.callTool('workspace_theme_font_upload', { file_name: 'Brand.woff2', content_base64: Buffer.from(WOFF2).toString('base64') })
    expect(JSON.parse(textOf(font)).font).toMatchObject({ source: 'upload', family: 'Brand' })
  })
})

// ── config-as-code ──────────────────────────────────────────────────────────

function customTheme(tenant: string, fontFile: string): WorkspaceTheme {
  const theme = presetToWorkspaceTheme('night-drive')!
  theme.meta.name = 'Acme brand'
  theme.typography.display = { source: 'upload', family: 'Acme Display', url: fontUrl(tenant, fontFile) }
  theme.branding = { logoLight: logoUrl(tenant), wordmark: 'Acme' }
  return theme
}

describe('config-as-code: workspace_theme section', () => {
  const FONT = 'acme-display-0123456789ab.woff2'

  it('exports one workspace-theme.json with uploaded fonts by file name, and reads it back', async () => {
    const db = seed([{ tenant_id: A, theme: customTheme(A, FONT), version: 3 }])
    const out = await exportConfig(ctx(db), { types: ['workspace-theme'] })
    expect(out.files!.map((f) => f.path)).toEqual(['workspace-theme.json', 'manifest.json'])
    const envelope = JSON.parse(out.files![0].content)
    expect(envelope).toMatchObject({ asset_type: 'workspace_theme', id: 'workspace' })
    expect(envelope.asset.typography.display).toEqual({ source: 'upload', family: 'Acme Display', path: FONT })
    expect(envelope.asset.branding.logoLight).toBe(logoUrl(A))
    expect(filesToManifest(out.files!).manifest.workspace_theme).toEqual(envelope.asset)
    // An id filter selects assets only.
    expect((await exportConfig(ctx(db), { ids: ['a0000000-0000-4000-8000-000000000001'] })).files!.some((f) => f.path === 'workspace-theme.json')).toBe(false)
  })

  it('re-applying to the same workspace is unchanged', async () => {
    const db = seed([{ tenant_id: A, theme: customTheme(A, FONT), version: 3 }])
    db.objects.set(`brand-fonts/${A}/${FONT}`, {})
    const files = (await exportConfig(ctx(db), { types: ['workspace_theme'] })).files!
    const plan = await applyConfig(ctx(db), { files, dry_run: true })
    expect(plan.plan.assets).toEqual([expect.objectContaining({ section: 'workspace_theme', action: 'unchanged', local_id: A })])
    expect(plan.warnings).toEqual([])
  })

  it('applies to another workspace: diffs, drops foreign logos, falls back for missing fonts, then resolves uploaded ones', async () => {
    const db = seed([{ tenant_id: A, theme: customTheme(A, FONT), version: 3 }])
    const files = (await exportConfig(ctx(db), { types: ['workspace_theme'] })).files!

    const dry = await applyConfig(ctx(db, PERMISSION_KEYS, B), { files, dry_run: true })
    const asset = dry.plan.assets.find((a) => a.section === 'workspace_theme')!
    expect(asset).toMatchObject({ action: 'update', name: 'Acme brand' })
    // Night Drive vs the default template: many fields, capped at 50.
    expect(asset.diffs!.map((d) => d.path)).toEqual(expect.arrayContaining(['branding.wordmark', 'chrome.sidebar.gradient.stops[0].color']))
    expect(asset.diffs_truncated).toBe(true)
    const warnings = dry.warnings.map((w) => w.warning).join('\n')
    expect(warnings).toMatch(/branding\.logoLight: dropped/)
    expect(warnings).toMatch(/typography\.display: the font file "acme-display-0123456789ab\.woff2" is not uploaded/)
    expect(db.tables.workspace_themes).toHaveLength(1) // dry run wrote nothing

    const applied = await applyConfig(ctx(db, PERMISSION_KEYS, B), { files })
    expect(applied.result?.updated).toMatchObject({ workspace_theme: 1 })
    const themeB = stored(db, B).theme as WorkspaceTheme
    expect(themeB.meta.name).toBe('Acme brand')
    expect(themeB.branding).toEqual({ wordmark: 'Acme' })
    expect(themeB.typography.display).toEqual(defaultWorkspaceTheme().typography.display)

    // Upload the same file to B, apply again: the font now resolves to B's own copy.
    db.objects.set(`brand-fonts/${B}/${FONT}`, {})
    await applyConfig(ctx(db, PERMISSION_KEYS, B), { files })
    expect((stored(db, B).theme as WorkspaceTheme).typography.display).toEqual({ source: 'upload', family: 'Acme Display', url: fontUrl(B, FONT) })
  })

  it('needs settings.edit to change the theme (dry runs report it)', async () => {
    const db = seed([{ tenant_id: A, theme: customTheme(A, FONT), version: 3 }])
    const files = (await exportConfig(ctx(db), { types: ['workspace_theme'] })).files!
    const viewer = PERMISSION_KEYS.filter((p) => p !== 'settings.edit')
    const dry = await applyConfig(ctx(db, viewer, B), { files, dry_run: true })
    expect(dry.missing_permissions).toEqual([{ section: 'workspace_theme', permission: 'settings.edit' }])
    await expect(applyConfig(ctx(db, viewer, B), { files })).rejects.toMatchObject({ code: 'forbidden' })
    expect(stored(db, B)).toBeUndefined()
  })

  it('reports an invalid theme as a plan error', async () => {
    const db = seed()
    const theme: any = defaultWorkspaceTheme()
    theme.colors.light.primary = 'url(javascript:alert(1))'
    const files = manifestToFiles({ workspace_theme: theme })
    const plan = await applyConfig(ctx(db), { files, dry_run: true })
    expect(plan.plan.assets[0]).toMatchObject({ section: 'workspace_theme', action: 'error', file: 'workspace-theme.json' })
    expect(plan.plan.assets[0].error).toMatch(/colors\.light\.primary/)
  })

  it('keeps own-workspace URLs and rejects images from another project', async () => {
    const db = seed()
    const own = { ...defaultWorkspaceTheme(), branding: { logoDark: logoUrl(A, 'logo-dark.png'), favicon: `https://evil.example/storage/v1/object/public/logos/${A}/favicon.png` } }
    const resolved = await resolveManifestWorkspaceTheme(ctx(db), workspaceThemeToManifest(own, A))
    expect(resolved.theme?.branding).toEqual({ logoDark: logoUrl(A, 'logo-dark.png') })
    expect(resolved.warnings).toEqual([expect.stringMatching(/branding\.favicon: dropped/)])
  })
})
