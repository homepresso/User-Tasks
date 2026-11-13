/**
 * Extension lifecycle: enable / disable per workspace (data kept), default
 * role seeding, typed settings (server validation, encrypted write-only
 * secrets, scopes, audit, versions), the extension migration linter and
 * runner bookkeeping, and the UI guard evaluation shared by server and
 * browser.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))
vi.mock('@/lib/api-auth-cache', () => ({ invalidateCredentialCache: async () => {} }))

import exampleDefinition from '@/extensions/example-hello/manifest'
import exampleServer from '@/extensions/example-hello/server'
import exampleJson from '@/extensions/example-hello/usertasks-extension.json'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { validateSettings, isFieldVisible, isFieldRequired, settingsDefaults } from '@/lib/extensions/settings'
import { appliesTo, evaluateGuard, resolveNav, resolveItemActions, resolveDetailTabs, resolveSettingsPages, resolveCreateEntries, resolveUserMenu, resolveWidgets, resolvePaletteEntries, resolveNotificationTypes, targetHref, permissionChecker, type ExtensionUiState } from '@/lib/extensions/ui'
import { guardsReferencing } from '@/lib/extensions/ui-server'
import * as service from '@/lib/services/extensions'
import { decryptSecret } from '@/lib/secret-crypto'
import { extensionMigrationFiles, extensionMigrationStatus, lintExtensionMigration } from '@/lib/admin/ops/extension-migrations'
import { expandPermissions } from '@/lib/permissions'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000f0001'
const USER = '0e000000-0000-4000-8000-0000000f00aa'

function ctx(permissions: string[]) {
  return { supabase: db.current, db: db.current, tenantId: TENANT, actorId: USER, permissions: new Set(expandPermissions(permissions)), authKind: 'session', source: 'ui' } as any
}

function seed(extra: Record<string, any[]> = {}) {
  db.current = createMemorySupabase({
    tenant_extensions: [], instance_extensions: [], object_audit_log: [],
    roles: [
      { id: 'r-owner', tenant_id: TENANT, slug: 'owner', is_system: true, permissions: ['settings.edit'] },
      { id: 'r-viewer', tenant_id: TENANT, slug: 'viewer', is_system: true, permissions: ['tasks.view_own'] },
      { id: 'r-custom', tenant_id: TENANT, slug: 'custom', is_system: false, permissions: [] },
    ],
    users: [{ id: USER, tenant_id: TENANT, preferences: { theme: 'dark' } }],
    ...extra,
  })
  return db.current
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY ??= 'b'.repeat(64)
  registerExtensionsForTest({ definitions: [exampleDefinition], servers: [exampleServer] })
})
afterEach(() => resetExtensionsForTest())

describe('enable / disable', () => {
  it('lists extensions with licence state and compatibility', async () => {
    seed()
    const list = await service.listExtensions(ctx(['settings.view']))
    expect(list.extensions).toHaveLength(1)
    expect(list.extensions[0]).toMatchObject({ id: 'example-hello', enabled: false, compatible: true, runs_here: true, licence: { tier: 'free', state: 'not_required', allowed: true } })
    expect(list.extensions[0].settings_pages.map((p) => p.scope)).toEqual(['workspace', 'instance', 'user'])
  })

  it('enables (seeding default roles, audited) and disables keeping settings', async () => {
    const mem = seed()
    const enabled = await service.enableExtension(ctx(['settings.edit']), 'example-hello')
    expect(enabled.extension.enabled).toBe(true)
    const roles = Object.fromEntries(mem.tables.roles.map((r: any) => [r.slug, r.permissions]))
    expect(roles.owner).toEqual(['settings.edit', 'ext.example-hello.view', 'ext.example-hello.manage'])
    expect(roles.viewer).toEqual(['tasks.view_own', 'ext.example-hello.view'])
    expect(roles.custom).toEqual([])
    expect(mem.tables.instance_extensions[0]).toMatchObject({ extension_id: 'example-hello', installed_version: '1.0.0' })
    await service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: 'Hi there' })
    const disabled = await service.disableExtension(ctx(['settings.edit']), 'example-hello')
    expect(disabled.extension.enabled).toBe(false)
    expect(mem.tables.tenant_extensions[0].config.greeting_word).toBe('Hi there')
    const audits = mem.tables.object_audit_log.filter((r: any) => r.object_type === 'extension').map((r: any) => r.summary)
    expect(audits).toEqual([expect.stringMatching(/Enabled/), expect.stringMatching(/Updated .* settings/), expect.stringMatching(/Disabled .* kept/)])
  })

  it('needs settings.edit, a licence and a runnable extension', async () => {
    seed()
    await expect(service.enableExtension(ctx(['settings.view']), 'example-hello')).rejects.toThrow(/settings.edit/)
    setEntitlementPort({ check: async () => ({ allowed: false, state: 'unlicensed', reason: 'Needs a licence' }) })
    await expect(service.enableExtension(ctx(['settings.edit']), 'example-hello')).rejects.toMatchObject({ status: 402 })
    await expect(service.enableExtension(ctx(['settings.edit']), 'nope')).rejects.toMatchObject({ status: 404 })
  })

  it('reports a missing migration instead of failing obscurely', async () => {
    const mem = seed()
    const original = mem.from
    mem.from = (table: string) => table === 'tenant_extensions'
      ? { select: () => ({ eq: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "tenant_extensions" does not exist' } }) }), upsert: () => Promise.resolve({ error: { code: '42P01', message: 'relation does not exist' } }) }
      : original(table)
    const list = await service.listExtensions(ctx(['settings.view']))
    expect(list.notice).toMatch(/20270112000000_extension_framework/)
    await expect(service.enableExtension(ctx(['settings.edit']), 'example-hello')).rejects.toThrow(/20270112000000/)
  })
})

describe('typed settings', () => {
  const page = parseExtensionManifest(exampleJson).contributes.ui.settingsPages[0]

  it('validates types, options, patterns and requiredWhen; drops unknown keys', () => {
    const ok = validateSettings(page.schema, { greeting_word: 'Hello', default_punctuation: '.', show_digest: 'true', junk: 1 })
    expect(ok.errors).toEqual({})
    expect(ok.values).toMatchObject({ greeting_word: 'Hello', default_punctuation: '.', show_digest: true })
    expect('junk' in ok.values).toBe(false)
    const bad = validateSettings(page.schema, { greeting_word: 'H3llo', default_punctuation: '?', endpoint_url: 'ftp://x' })
    expect(Object.keys(bad.errors).sort()).toEqual(['api_token', 'default_punctuation', 'endpoint_url', 'greeting_word'])
    // api_token is required once an endpoint is set — satisfied by a stored secret.
    expect(validateSettings(page.schema, { greeting_word: 'Hi', endpoint_url: 'https://x.example' }, new Set(['api_token'])).errors).toEqual({})
    expect(validateSettings(page.schema, { greeting_word: 'Hi', client_certificate: 'not a pem' }).errors.client_certificate).toMatch(/PEM/)
  })

  it('evaluates visibleWhen / requiredWhen and defaults', () => {
    const token = page.schema.sections[1].fields.find((f) => f.key === 'api_token')!
    expect(isFieldVisible(token, {})).toBe(true)
    expect(isFieldRequired(token, { endpoint_url: '' })).toBe(false)
    expect(isFieldRequired(token, { endpoint_url: 'https://x' })).toBe(true)
    expect(settingsDefaults(page.schema)).toEqual({ greeting_word: 'Hello', default_punctuation: '!', show_digest: true })
  })

  it('stores secrets encrypted, never returns them, clears with null, and versions every save', async () => {
    const mem = seed()
    const saved = await service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: 'Hello', api_token: 'tok-123', endpoint_url: 'https://api.example.com' })
    expect(saved.secrets_set).toEqual(['api_token'])
    expect(JSON.stringify(saved)).not.toContain('tok-123')
    const stored = mem.tables.tenant_extensions[0]
    expect(stored.secrets.api_token).not.toBe('tok-123')
    expect(decryptSecret(stored.secrets.api_token)).toBe('tok-123')
    expect(stored.config_version).toBe(1)
    const kept = await service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: 'Hey', endpoint_url: 'https://api.example.com' })
    expect(kept.secrets_set).toEqual(['api_token'])
    expect(kept.config_version).toBe(2)
    const cleared = await service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: 'Hey', api_token: null })
    expect(cleared.secrets_set).toEqual([])
  })

  it('runs the extension\'s own validation and refuses bad values', async () => {
    seed()
    await expect(service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: 'Goodbye' })).rejects.toThrow(/cannot be "Goodbye"/)
    await expect(service.updateExtensionSettings(ctx(['settings.edit']), 'example-hello', 'general', { greeting_word: '' })).rejects.toThrow(/Greeting word is required/)
  })

  it('scopes: workspace needs settings.*, instance needs an instance admin, user pages store in preferences', async () => {
    const mem = seed()
    await expect(service.getExtensionSettings(ctx(['tasks.view_own']), 'example-hello', 'general')).rejects.toThrow(/settings.view/)
    await expect(service.getExtensionSettings(ctx(['settings.edit']), 'example-hello', 'instance')).rejects.toThrow(/instance administrators/)
    const inst = await service.updateExtensionSettings(ctx([]), 'example-hello', 'instance', { max_greetings_per_day: 50 }, { instanceAdmin: true })
    expect(inst.values.max_greetings_per_day).toBe(50)
    expect(mem.tables.instance_extensions[0].config.max_greetings_per_day).toBe(50)
    const mine = await service.updateExtensionSettings(ctx(['tasks.view_own']), 'example-hello', 'preferences', { wave_emoji: true, nickname: 'Andy' })
    expect(mine.values).toMatchObject({ wave_emoji: true, nickname: 'Andy' })
    expect(mem.tables.users[0].preferences).toEqual({ theme: 'dark', ext: { 'example-hello': { wave_emoji: true, nickname: 'Andy' } } })
  })
})

describe('extension migrations', () => {
  it('passes the example migration', () => {
    for (const m of exampleServer.migrations!) expect(lintExtensionMigration('example-hello', m.sql)).toEqual([])
  })

  it('refuses DDL on core tables, missing tenant_id / RLS and non-coalescing policies', () => {
    expect(lintExtensionMigration('example-hello', 'ALTER TABLE public.tasks ADD COLUMN x int;').join(' ')).toMatch(/only change tables named ext_example_hello__/)
    expect(lintExtensionMigration('example-hello', 'DROP TABLE users;').join(' ')).toMatch(/only change tables/)
    expect(lintExtensionMigration('example-hello', 'CREATE TABLE ext_example_hello__x (id uuid);').join(' ')).toMatch(/tenant_id uuid column[\s\S]*ROW LEVEL SECURITY/)
    const bareCurrent = `CREATE TABLE ext_example_hello__x (id uuid, tenant_id uuid NOT NULL);
ALTER TABLE ext_example_hello__x ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON ext_example_hello__x USING (tenant_id IN (SELECT current_tenant_id FROM users WHERE id = auth.uid()));`
    expect(lintExtensionMigration('example-hello', bareCurrent).join(' ')).toMatch(/without COALESCE/)
    expect(lintExtensionMigration('example-hello', 'CREATE ROLE evil;').join(' ')).toMatch(/managed by core/)
    expect(lintExtensionMigration('example-hello', 'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;').join(' ')).toMatch(/only tables named/)
    expect(lintExtensionMigration('example-hello', "-- ALTER TABLE tasks\nSELECT 'ALTER TABLE tasks';")).toEqual([])
  })

  it('tracks status per extension (pending, applied, changed, missing)', () => {
    const files = extensionMigrationFiles('example-hello', exampleServer.migrations!)
    expect(extensionMigrationStatus(files, []).map((r) => r.state)).toEqual(['pending'])
    expect(extensionMigrationStatus(files, [{ version: files[0].version, name: 'greetings', checksum: files[0].checksum }]).map((r) => r.state)).toEqual(['applied'])
    expect(extensionMigrationStatus(files, [{ version: files[0].version, name: 'greetings', checksum: 'x' }, { version: '20200101000000', name: 'old', checksum: 'y' }]).map((r) => r.state)).toEqual(['missing_file', 'changed'])
  })
})

describe('UI contributions (guards shared by server and browser)', () => {
  const entry = { id: 'example-hello', name: 'Hello', version: '1.0.0', licence: 'not_required' as const, features: ['greetings', 'digest'], config: { show_digest: true } }
  const state: ExtensionUiState = { extensions: [entry], deployment: 'self_hosted', instanceAdmin: false }
  const member = { has: permissionChecker(expandPermissions(['tasks.view_own'])) }
  const admin = { has: permissionChecker(expandPermissions(['tasks.view_own', 'settings.edit', 'settings.view'])) }

  it('resolves nav: sections with items, core groups, guards (permission, feature, setting)', () => {
    const nav = resolveNav({ state, subject: member })
    expect(nav.sections.map((s) => [s.label, s.items.map((i) => i.label)])).toEqual([['Hello', ['Hello home']]])
    expect(nav.byGroup.operate.map((i) => i.href)).toEqual(['/x/example-hello/digest'])
    const adminNav = resolveNav({ state, subject: admin })
    expect(adminNav.sections[0].items.map((i) => i.label)).toEqual(['Hello home', 'New greeting'])
    const noDigest = resolveNav({ state: { ...state, extensions: [{ ...entry, features: ['greetings'] }] }, subject: member })
    expect(noDigest.byGroup.operate).toBeUndefined()
    expect(resolveNav({ state: { ...state, extensions: [] }, subject: admin })).toEqual({ byGroup: {}, sections: [] })
  })

  it('evaluates every guard kind', () => {
    const s = { deployment: 'cloud' as const, instanceAdmin: false }
    expect(evaluateGuard({ deployment: 'self_hosted' }, admin, entry, s)).toBe(false)
    expect(evaluateGuard({ instanceAdmin: true }, admin, entry, s)).toBe(false)
    expect(evaluateGuard({ managerOnly: true }, { ...admin, isManager: true }, entry, s)).toBe(true)
    expect(evaluateGuard({ setting: 'show_digest' }, admin, entry, s)).toBe(true)
    expect(evaluateGuard({ setting: 'show_digest == false' }, admin, entry, s)).toBe(false)
    expect(evaluateGuard({ anyPermission: ['reports.view', 'settings.edit'] }, admin, entry, s)).toBe(true)
  })

  it('resolves create entries, palette, user menu, widgets, settings pages, notifications', () => {
    expect(resolveCreateEntries({ state, subject: member })).toEqual([])
    expect(resolveCreateEntries({ state, subject: admin }).map((e) => e.href)).toEqual(['/x/example-hello/new'])
    expect(resolvePaletteEntries({ state, subject: admin }).map((e) => [e.id, e.href])).toEqual([['say-hello', null], ['open-hello', '/x/example-hello']])
    expect(resolveUserMenu({ state, subject: member }).map((e) => e.href)).toEqual(['/settings/extensions/example-hello/preferences'])
    expect(resolveWidgets({ state, subject: member }).map((w) => w.id)).toEqual(['greetings-today', 'recent-greetings'])
    expect(resolveSettingsPages({ state, subject: admin }).map((p) => p.id)).toEqual(['preferences', 'general'])
    expect(resolveSettingsPages({ state: { ...state, instanceAdmin: true }, subject: admin }, 'instance').map((p) => p.id)).toEqual(['instance'])
    expect(resolveNotificationTypes(state).map((t) => t.type)).toEqual(['ext.example-hello.greeting_sent'])
  })

  it('resolves row actions per object type with appliesWhen, placement and bulk', () => {
    const task = { id: 't1', assignee_id: 'u1' }
    expect(resolveItemActions({ state, subject: admin }, 'task', [task]).map((a) => a.id)).toEqual(['greet-assignee'])
    expect(resolveItemActions({ state, subject: admin }, 'task', [{ id: 't2', assignee_id: null }])).toEqual([])
    expect(resolveItemActions({ state, subject: member }, 'task', [task])).toEqual([])
    expect(resolveItemActions({ state, subject: admin }, 'workflow', [{ id: 'w' }], 'toolbar').map((a) => a.id)).toEqual(['greet-workflow'])
    expect(resolveItemActions({ state, subject: admin }, 'data_row', [{ id: 'a' }, { id: 'b' }]).map((a) => a.id)).toEqual(['greet-rows'])
    expect(resolveItemActions({ state, subject: admin }, 'form', [{ id: 'f' }, { id: 'g' }])).toEqual([])
    expect(resolveDetailTabs({ state, subject: member }, 'task', task).map((t) => t.label)).toEqual(['Hello'])
  })

  it('appliesWhen expressions', () => {
    expect(appliesTo('item.metadata.sp_url', { metadata: { sp_url: 'x' } })).toBe(true)
    expect(appliesTo('!item.metadata.sp_url', { metadata: {} })).toBe(true)
    expect(appliesTo("item.status == 'open'", { status: 'open' })).toBe(true)
    expect(appliesTo('item.count != 0', { count: 0 })).toBe(false)
    expect(appliesTo('item.x == null', {})).toBe(true)
    expect(appliesTo('process.exit()', {})).toBe(false)
  })

  it('maps targets to hrefs and knows which entries guard an action / data source', () => {
    expect(targetHref('example-hello', { page: '' })).toBe('/x/example-hello')
    expect(targetHref('example-hello', { settings: 'general' })).toBe('/settings/extensions/example-hello/general')
    expect(targetHref('example-hello', { action: 'x' })).toBeNull()
    const manifest = parseExtensionManifest(exampleJson)
    expect(guardsReferencing(manifest, { kind: 'data', name: 'greeting_count' })).toHaveLength(2)
    expect(guardsReferencing(manifest, { kind: 'data', name: 'nope' })).toEqual([])
    expect(guardsReferencing(manifest, { kind: 'action', name: 'test_connection' }).length).toBeGreaterThan(0)
  })
})
