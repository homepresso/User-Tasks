/**
 * Settings → Query on the cloud edition vs self-hosted:
 *  - cloud: one instance-wide configuration (instance setting
 *    instance.query_settings) governs every workspace; workspace settings are
 *    ignored; per-app and per-widget overrides only when the instance config
 *    allows them; only instance admins may read / change it or run rollup
 *    actions (everyone else, workspace owners included, gets 404 — the page
 *    too);
 *  - self-hosted: per workspace, settings.view / settings.edit, as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ instance: undefined as unknown, sets: [] as Array<{ key: string; value: unknown; updatedBy?: string | null }> }))
vi.mock('@/lib/config/instance-settings', () => ({
  getInstanceSetting: async () => store.instance,
  setInstanceSetting: async (key: string, value: unknown, opts: { updatedBy?: string | null } = {}) => { store.sets.push({ key, value, updatedBy: opts.updatedBy }); store.instance = value },
}))
vi.mock('@/lib/admin/infrastructure', () => ({ viewerCanSeeInfrastructure: async () => false }))
vi.mock('@/lib/report-rollups/cache', () => ({ bumpRollupGeneration: async () => undefined, cachedAggregate: async (_t: string, _s: string, _q: unknown, load: () => unknown) => load() }))
const nav = vi.hoisted(() => ({ notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('next/navigation', () => ({ notFound: nav.notFound }))
const session = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('@/lib/services/context', async (orig) => ({ ...(await orig<object>()), fromSession: async () => session.ctx }))
vi.mock('@/components/settings/query-settings', () => ({ QuerySettingsPage: () => null }))

import * as query from '@/lib/services/query-settings'
import { forgetQuerySettings, resolveDataSource, setQuerySettingsLoader, INSTANCE_QUERY_SETTING } from '@/lib/reports/data-source'
import type { ServiceContext } from '@/lib/services/context'
import QueryPage from '@/app/(dashboard)/settings/query/page'

const TENANT = '1a2504e0-4f89-41d3-9a0c-0305e82c3301'
const OTHER = '2a2504e0-4f89-41d3-9a0c-0305e82c3301'
const APP = '3a2504e0-4f89-41d3-9a0c-0305e82c3301'
const ADMIN = '4a2504e0-4f89-41d3-9a0c-0305e82c3301'
const OWNER = '5a2504e0-4f89-41d3-9a0c-0305e82c3301'
const EMAILS: Record<string, string> = { [ADMIN]: 'ops@example.com', [OWNER]: 'owner@example.com' }

let cloud = true
const tenantSettings: Record<string, unknown> = {}
const tenantLoader = vi.fn(async (tenantId: string) => tenantSettings[tenantId] ?? null)
const tenantWrites: unknown[] = []

function ctxFor(userId: string | null, perms: string[], extra: Partial<ServiceContext> = {}): ServiceContext {
  const supabase = {
    from(table: string) {
      const q: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
        _eq: {} as Record<string, unknown>,
        select() { return q },
        eq(col: string, v: unknown) { q._eq[col] = v; return q },
        async maybeSingle() {
          if (table === 'users') return { data: EMAILS[String(q._eq.id)] ? { email: EMAILS[String(q._eq.id)] } : null, error: null }
          if (table === 'tenants') return { data: { id: q._eq.id, settings: tenantSettings[String(q._eq.id)] ?? {} }, error: null }
          return { data: null, error: null }
        },
        update(v: unknown) { tenantWrites.push(v); return { eq: async () => ({ error: null }) } },
        insert() { return { select: () => ({ single: async () => ({ data: {}, error: null }) }) } },
      }
      return q
    },
    rpc: async (fn: string) => (fn === 'report_rollup_status' ? { data: { installed: true, tenants: 2, backfilled: 2, in_progress: 0, not_started: 0, dirty_ranges: 0, tenants_detail: [], rows: { runs: 0, nodes: 0, tasks: 0, submissions: 0 } }, error: null }
      : fn === 'report_rollup_tenant_freshness' ? { data: { installed: true, done: true, dirty_ranges: 0 }, error: null }
      : { data: { idle: true }, error: null }),
  }
  return { supabase, tenantId: TENANT, actorId: userId, permissions: new Set(perms), authKind: 'api_key', keyType: 'user', source: 'api', ...extra } as unknown as ServiceContext
}

beforeEach(() => {
  cloud = true
  store.instance = undefined
  store.sets = []
  tenantWrites.length = 0
  for (const k of Object.keys(tenantSettings)) delete tenantSettings[k]
  tenantLoader.mockClear()
  setQuerySettingsLoader(tenantLoader, { instance: async () => store.instance, isCloud: () => cloud })
  query.setQueryAdminCheckForTests(async (viewer) => viewer.email === 'ops@example.com')
  forgetQuerySettings()
})
afterEach(() => query.setQueryAdminCheckForTests(null))

describe('resolver', () => {
  it('cloud: the instance config governs every workspace; workspace settings are ignored', async () => {
    store.instance = { default_mode: 'rollup', services: { app_widgets: { mode: 'live', cache_ttl_seconds: 5 } } }
    tenantSettings[TENANT] = { query: { default_mode: 'live' } }
    tenantSettings[OTHER] = { query: { default_mode: 'auto' } }
    for (const tenantId of [TENANT, OTHER]) {
      expect(await resolveDataSource({ tenantId }, { service: 'reports_hub' })).toMatchObject({ mode: 'rollup', level: 'instance' })
      expect(await resolveDataSource({ tenantId }, { service: 'app_widgets' })).toMatchObject({ mode: 'live', level: 'service', cacheTtlMs: 5000 })
    }
    expect(tenantLoader).not.toHaveBeenCalled()
  })

  it('cloud: app and widget overrides apply only when the instance config allows them', async () => {
    store.instance = { default_mode: 'auto', allow_widget_override: false, apps: { [APP]: 'live' } }
    expect(await resolveDataSource({ tenantId: TENANT }, { service: 'app_widgets', appId: APP, widgetMode: 'rollup' })).toMatchObject({ mode: 'auto', level: 'instance' })
    store.instance = { default_mode: 'auto', allow_widget_override: true, apps: { [APP]: 'live' } }
    forgetQuerySettings()
    expect(await resolveDataSource({ tenantId: TENANT }, { service: 'app_widgets', appId: APP })).toMatchObject({ mode: 'live', level: 'app' })
    expect(await resolveDataSource({ tenantId: TENANT }, { service: 'app_widgets', appId: APP, widgetMode: 'rollup' })).toMatchObject({ mode: 'rollup', level: 'widget' })
  })

  it('self-hosted: per workspace, as before', async () => {
    cloud = false
    store.instance = { default_mode: 'rollup' }
    tenantSettings[TENANT] = { query: { default_mode: 'live', apps: { [APP]: 'auto' } } }
    expect(await resolveDataSource({ tenantId: TENANT }, { service: 'reports_hub' })).toMatchObject({ mode: 'live', level: 'workspace' })
    expect(await resolveDataSource({ tenantId: TENANT }, { service: 'app_widgets', appId: APP })).toMatchObject({ mode: 'auto', level: 'app' })
    expect(await resolveDataSource({ tenantId: OTHER }, { service: 'reports_hub' })).toMatchObject({ mode: 'auto', level: 'workspace' })
  })
})

describe('access', () => {
  it('cloud: a workspace owner (every permission) is refused with 404 everywhere', async () => {
    const owner = ctxFor(OWNER, ['settings.view', 'settings.edit'])
    for (const call of [() => query.getQueryStatus(owner), () => query.getQuerySettings(owner), () => query.updateQuerySettings(owner, { default_mode: 'live' }), () => query.runQueryRollupAction(owner, 'backfill')]) {
      await expect(call()).rejects.toMatchObject({ code: 'not_found', status: 404 })
    }
    expect(await query.queryPageAccess(owner)).toEqual({ cloud: true, canView: false, canEdit: false })
    expect(store.sets).toEqual([])
    // Tenant-wide API keys (no person) are never instance admins.
    await expect(query.getQueryStatus(ctxFor(ADMIN, ['settings.view'], { keyType: 'tenant' }))).rejects.toMatchObject({ status: 404 })
  })

  it('cloud: the page 404s for everyone but instance admins', async () => {
    session.ctx = ctxFor(OWNER, ['settings.view', 'settings.edit'])
    await expect(QueryPage()).rejects.toThrow('NEXT_NOT_FOUND')
    session.ctx = ctxFor(ADMIN, [])
    await expect(QueryPage()).resolves.toBeTruthy()
  })

  it('cloud: an instance admin reads and changes the one instance-wide configuration (no workspace permission needed)', async () => {
    const admin = ctxFor(ADMIN, [])
    expect(await query.queryPageAccess(admin)).toEqual({ cloud: true, canView: true, canEdit: true })
    const next = await query.updateQuerySettings(admin, { default_mode: 'live', allow_widget_override: true, services: { reports_hub: { mode: 'rollup' } } })
    expect(next).toMatchObject({ default_mode: 'live', allow_widget_override: true })
    expect(store.sets).toEqual([expect.objectContaining({ key: INSTANCE_QUERY_SETTING, updatedBy: ADMIN })])
    expect(tenantWrites).toEqual([]) // workspace settings untouched
    const status = await query.getQueryStatus(admin)
    expect(status.scope).toBe('instance')
    expect(status.settings.default_mode).toBe('live')
    expect(status.instance_rollups).toMatchObject({ tenants: 2 })
    // The new config applies to every workspace at once.
    expect(await resolveDataSource({ tenantId: OTHER }, { service: 'reports_hub' })).toMatchObject({ mode: 'rollup' })
    expect(await query.runQueryRollupAction(admin, 'backfill', { tenantId: 'all' })).toMatchObject({ target: 'all' })
    expect(await query.runQueryRollupAction(admin, 'reconcile', { tenantId: OTHER })).toMatchObject({ target: OTHER })
    await expect(query.runQueryRollupAction(admin, 'reconcile', { tenantId: 'nope' })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('self-hosted: workspace admins with settings.edit manage it per workspace; instance admins get nothing extra', async () => {
    cloud = false
    const viewer = ctxFor(OWNER, ['settings.view'])
    expect((await query.getQueryStatus(viewer)).scope).toBe('workspace')
    await expect(query.updateQuerySettings(viewer, { default_mode: 'live' })).rejects.toMatchObject({ code: 'forbidden' })
    const editor = ctxFor(OWNER, ['settings.view', 'settings.edit'])
    await query.updateQuerySettings(editor, { default_mode: 'live' })
    expect(tenantWrites).toHaveLength(1)
    expect(store.sets).toEqual([])
    await expect(query.getQueryStatus(ctxFor(ADMIN, []))).rejects.toMatchObject({ code: 'forbidden' })
    await expect(query.runQueryRollupAction(editor, 'backfill', { tenantId: OTHER })).rejects.toMatchObject({ code: 'forbidden' })
    expect(await query.queryPageAccess(editor)).toEqual({ cloud: false, canView: true, canEdit: true })
  })
})
