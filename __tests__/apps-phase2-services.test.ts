/**
 * App builder Phase 2 services: picker search (only what the person using
 * it may see, server-side paging), Phase 2 widget aggregations, card view
 * sources (API reference governance, declared inputs only, cache and rate
 * limit, no request details to the browser), card-reference save checks,
 * custom icon uploads (editors only, sanitised).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- recorded query chains */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appAccess = vi.fn(async (): Promise<'edit' | 'view' | null> => 'edit')
vi.mock('@/lib/services/apps', async (orig) => ({ ...(await orig()), getAppAccess: (...a: unknown[]) => (appAccess as any)(...a) }))
const executeReference = vi.fn(async () => ({ status: 200, data: { data: { items: [{ id: 'a1', name: 'Alpha', status: 'Open', secret: 'hide-me' }, { id: 'b2', name: 'Beta', status: 'Closed', secret: 'hide-me' }] } } }))
vi.mock('@/lib/reference-executor', () => ({ executeReference: (...a: unknown[]) => (executeReference as any)(...a) }))
vi.mock('@/lib/trace', () => ({ newTraceId: () => 'trace' }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
let refRow: any = { id: '0f000000-0000-4000-8000-0000000000c1', inputs: [{ name: 'q' }], request_config: {} }
const stored: Array<{ path: string; bytes: Uint8Array }> = []
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig()),
  serviceRoleClient: async () => recorder(refRow ? [refRow] : []).client,
  audit: vi.fn(async () => {}),
}))
vi.mock('@/lib/providers/storage', () => ({ getStorageProvider: async () => ({ id: 'supabase', put: async (_b: string, path: string, bytes: Uint8Array) => { stored.push({ path, bytes }) }, publicUrl: (b: string, p: string) => `https://files.example/${b}/${p}` }) }))

import type { ServiceContext } from '@/lib/services/context'
import { pickerHint, searchPicker } from '@/lib/services/app-search'
import { bucketLabel, heatmapCells, monthWindow, onTime, pivotCells, quantile, timeBuckets } from '@/lib/services/app-widgets-more'
import { _resetCardCache, cardViewData, rateLimited, REFERENCE_RATE_PER_MIN, resolveReferenceInputs, searchSortPage, templateKeys, toCard, formatCardField } from '@/lib/services/app-card-sources'
import { checkCardReferences } from '@/lib/services/apps'
import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout } from '@/lib/apps/schema'

const ME = '0a000000-0000-4000-8000-000000000001'
const REF = '0f000000-0000-4000-8000-0000000000c1'

function recorder(rows: any[] = []) {
  const calls: Array<[string, string, ...unknown[]]> = []
  const from = (table: string) => {
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: any) => resolve({ data: rows, count: rows.length, error: null })
        if (prop === 'maybeSingle' || prop === 'single') return () => { calls.push([table, prop]); return Promise.resolve({ data: rows[0] ?? null, error: null }) }
        return (...args: unknown[]) => { calls.push([table, prop, ...args]); return chain }
      },
    })
    return chain
  }
  return { client: { from } as any, calls }
}
const ctx = (client: any, perms: string[]): ServiceContext => ({ db: client, supabase: client, tenantId: 'tenant-a', actorId: ME, permissions: new Set(perms), authKind: 'session', source: 'ui' })

describe('pickers', () => {
  beforeEach(() => { appAccess.mockResolvedValue('edit') })
  it('secondary lines: status, owner, counts, size, email', () => {
    expect(pickerHint('workflow', { is_active: true, trigger_type: 'form_submission', run_count: 3 })).toBe('Active · form submission · 3 runs')
    expect(pickerHint('table', { columns: [{}, {}], row_count: [{ count: 1200 }] })).toBe('1,200 rows · 2 columns')
    expect(pickerHint('team', { member_count: [{ count: 1 }] })).toBe('1 member')
    expect(pickerHint('report', { category: 'SLA', is_shared: false })).toBe('SLA · Private')
  })
  it('builder pickers need edit access to the app; the filter bar any access', async () => {
    const r = recorder([])
    appAccess.mockResolvedValue('view')
    await expect(searchPicker(ctx(r.client, ['workflows.view']), { app: 'desk', kind: 'workflow' })).rejects.toThrow(/not found/i)
    await expect(searchPicker(ctx(r.client, ['workflows.view']), { app: 'desk', kind: 'workflow', mode: 'filter' })).resolves.toMatchObject({ items: [] })
  })
  it('lists only what the person may see: a missing permission says so; search and paging run server-side', async () => {
    const r = recorder(Array.from({ length: 21 }, (_, i) => ({ id: `0f000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `W${i}`, is_active: true })))
    expect(await searchPicker(ctx(r.client, []), { app: 'desk', kind: 'workflow' })).toEqual({ items: [], next: null, denied: 'workflows.view' })
    const page = await searchPicker(ctx(r.client, ['workflows.view']), { app: 'desk', kind: 'workflow', q: 'pay_50%', offset: 20 })
    expect(page.items).toHaveLength(20)
    expect(page.next).toBe(40)
    expect(r.calls).toContainEqual(['workflows', 'ilike', 'name', '%pay\\_50\\%%'])
    expect(r.calls).toContainEqual(['workflows', 'range', 20, 40])
    expect(r.calls).toContainEqual(['workflows', 'eq', 'tenant_id', 'tenant-a'])
  })
  it('reports: shared or the person’s own; people without View members only themselves', async () => {
    const r = recorder([])
    await searchPicker(ctx(r.client, ['reports.view']), { app: 'desk', kind: 'report' })
    expect(r.calls).toContainEqual(['reports', 'or', `is_shared.eq.true,created_by.eq.${ME}`])
    const u = recorder([{ id: ME, display_name: 'Me', email: 'me@example.com', avatar_url: null }])
    const res = await searchPicker(ctx(u.client, []), { app: 'desk', kind: 'user' })
    expect(res.items.map((i) => i.id)).toEqual([ME])
  })
})

describe('Phase 2 aggregations', () => {
  it('quantiles, on-time, heatmap, buckets, pivot', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([], 0.9)).toBeNull()
    expect(onTime('2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z')).toBe(true)
    expect(onTime('2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z')).toBe(false)
    expect(onTime(null, '2026-11-02')).toBe(true)
    const h = heatmapCells(['2026-11-23T09:15:00Z', '2026-11-23T09:45:00Z', 'bad'])
    expect(h.cells[0][9]).toBe(2)
    expect(h.max).toBe(2)
    const b = timeBuckets({ from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-10T00:00:00Z') }, 'week')
    expect(b[0]).toBe('2026-10-26')
    expect(bucketLabel('2026-11', 'month')).toBe('Nov 2026')
    const p = pivotCells([{ a: 'x', b: '1' }, { a: 'x', b: '2' }, { a: 'y', b: '1' }], (f) => f.a, (f) => f.b, (l) => l.length)
    expect(p.cells).toEqual({ x: { 1: 1, 2: 1 }, y: { 1: 1 } })
    expect(p.rowTotals).toEqual({ x: 2, y: 1 })
    expect(p.total).toBe(3)
    expect(monthWindow('2026-02').month).toBe('2026-02')
  })
})

describe('card view', () => {
  const template = WIDGET_CONFIG_SCHEMAS.card_view.parse({ template: { title: 'name', badge: 'status', badge_colors: [{ value: 'open', tone: 'success' }], fields: [{ key: 'owner.name', label: 'Owner' }] } })
  it('maps records through the template; only template / action keys reach the browser', () => {
    const card = toCard({ name: 'Alpha', status: 'Open', owner: { name: 'Sam' }, secret: 'x' }, 'a1', template)
    expect(card).toMatchObject({ title: 'Alpha', badge: 'Open', badge_tone: 'success', fields: [{ label: 'Owner', value: 'Sam' }] })
    expect(Object.keys(card.values).sort()).toEqual(['name', 'owner.name', 'status'])
    expect(templateKeys(template.template, [{ kind: 'open_url', label: 'Go', url: 'https://x/{{id}}' }])).toContain('id')
    expect(toCard({ __proto__: { polluted: 1 } } as any, 'z', { ...template, template: { ...template.template, title: '__proto__.polluted' } }).title).toBe('—')
  })
  it('formats card fields: currency (field, column, USD), percent, number, date, progress', () => {
    const t = WIDGET_CONFIG_SCHEMAS.card_view.parse({ template: { title: 'name', fields: [
      { key: 'amount', label: 'Amount', format: 'currency' },
      { key: 'eur', label: 'EUR', format: 'currency' },
      { key: 'gbp', label: 'GBP', format: 'currency', currency: 'GBP' },
      { key: 'prob', label: 'Probability', format: 'percent' },
      { key: 'close', label: 'Close', format: 'date' },
      { key: 'done', label: 'Done', format: 'progress' },
      { key: 'spent', label: 'Spent', format: 'progress', max: 200 },
      { key: 'raw', label: 'Raw' },
    ] } })
    const card = toCard({ name: 'A', amount: 125000, eur: 990.5, gbp: 12, prob: 40, seats: 12500, close: '2026-12-15', done: 65, spent: 250, raw: 125000 }, 'a', t, [{ key: 'eur', type: 'number', currency: 'EUR' }])
    const v = Object.fromEntries(card.fields.map((f) => [f.label, f.value]))
    expect(v).toMatchObject({ Amount: '$125,000.00', EUR: '€990.50', GBP: '£12.00', Probability: '40%', Close: '15 Dec 2026', Done: '65%', Spent: '125%', Raw: '125000' })
    const p = Object.fromEntries(card.fields.map((f) => [f.label, f.progress]))
    expect(p.Done).toBe(0.65)
    expect(p.Spent).toBe(1)
    expect(p.Raw).toBeUndefined()
    expect(formatCardField({ key: 'seats', format: 'number' }, 12500).value).toBe('12,500')
    expect(formatCardField({ key: 'rate', format: 'percent', decimals: 1 }, 12.345).value).toBe('12.3%')
    // Not a number: shown as written.
    expect(toCard({ name: 'B', amount: 'n/a' }, 'b', t).fields[0].value).toBe('n/a')
    expect(toCard({ name: 'B' }, 'b', t).fields[0].value).toBe('—')
    // A numeric string still formats; a board's currency is the fallback.
    expect(toCard({ name: 'C', amount: '1500' }, 'c', t, [], { currency: 'NZD' }).fields[0].value).toBe('NZ$1,500.00')
  })
  it('search / sort / page in memory; declared inputs only, viewer tokens and filters resolved', () => {
    const r = searchSortPage([{ n: 'b' }, { n: 'a' }, { n: 'c' }], { q: '', sort: 'n', dir: 'desc', page: 0, size: 2 })
    expect(r.list.map((x) => x.n)).toEqual(['c', 'b'])
    expect(r.total).toBe(3)
    expect(resolveReferenceInputs({ q: '{{filter:region}}-{{me_email}}', url: 'https://evil' }, ['q'], { userId: ME, email: 'me@example.com', filters: { region: 'emea' } })).toEqual({ q: 'emea-me@example.com' })
  })
  it('rate limit per viewer and widget', () => {
    _resetCardCache()
    for (let i = 0; i < REFERENCE_RATE_PER_MIN; i++) expect(rateLimited('u:w', 1000)).toBe(false)
    expect(rateLimited('u:w', 1000)).toBe(true)
    expect(rateLimited('u:w', 62_000)).toBe(false)
  })

  const refConfig = (extra: Record<string, unknown> = {}) => WIDGET_CONFIG_SCHEMAS.card_view.parse({ source: 'reference', reference_id: REF, results_path: 'data.items', reference_inputs: { q: '{{me_id}}', other: 'x' }, template: { title: 'name', badge: 'status' }, ...extra })
  const extra = (preview = false) => ({ params: {}, filters: {}, widgetKey: 'app:page:cards', preview })
  beforeEach(() => { _resetCardCache(); executeReference.mockClear(); refRow = { id: REF, inputs: [{ name: 'q' }], request_config: {} } })

  it('API data: integration access, or allowed for app viewers; previews always need View integrations', async () => {
    const c = ctx(recorder([]).client, [])
    await expect(cardViewData(c, refConfig(), extra())).rejects.toThrow(/integration access/)
    await expect(cardViewData(c, refConfig({ allow_viewers: true }), extra(true))).rejects.toThrow(/View integrations/)
    const out = await cardViewData(c, refConfig({ allow_viewers: true }), extra()) as any
    expect(out.cards.map((x: any) => x.title)).toEqual(['Alpha', 'Beta'])
    expect(JSON.stringify(out)).not.toContain('hide-me')
    const call = (executeReference.mock.calls[0] as any[])[0]
    expect(call).toMatchObject({ readOnly: true, referenceId: REF, expectedTenantId: 'tenant-a', inputValues: { q: ME } })
  })
  it('responses are cached per widget for the TTL; references that write are refused', async () => {
    const c = ctx(recorder([]).client, ['integrations.view'])
    await cardViewData(c, refConfig(), extra())
    const again = await cardViewData(c, refConfig(), extra()) as any
    expect(again.cached).toBe(true)
    expect(executeReference).toHaveBeenCalledTimes(1)
    refRow = { id: REF, inputs: [], request_config: { kind: 'sql_write', custom: { kind: 'sql_write' } } }
    const { isWriteReference } = await import('@/lib/custom-references/types')
    if (isWriteReference(refRow)) await expect(cardViewData(c, refConfig({ cache_ttl_s: 0 }), extra())).rejects.toThrow(/writes data/)
  })
  it('saving: binding needs View integrations; allowing viewers needs Manage references; unchanged bindings pass', async () => {
    const page = (cfg: Record<string, unknown>) => normalisePageLayout({ widgets: [{ id: 'cards', type: 'card_view', w: 6, h: 6, config: WIDGET_CONFIG_SCHEMAS.card_view.parse({ source: 'reference', reference_id: REF, ...cfg }) }] })
    const c0 = ctx(recorder([]).client, ['apps.manage'])
    await expect(checkCardReferences(c0, 'app', null, page({}))).rejects.toThrow(/View integrations/)
    await expect(checkCardReferences(c0, 'app', page({}), page({}))).resolves.toBeUndefined()
    const c1 = ctx(recorder([]).client, ['integrations.view'])
    await expect(checkCardReferences(c1, 'app', null, page({ allow_viewers: true }))).rejects.toThrow(/Manage references/)
    const c2 = ctx(recorder([]).client, ['integrations.view', 'integrations.manage_references'])
    await expect(checkCardReferences(c2, 'app', null, page({ allow_viewers: true }))).resolves.toBeUndefined()
  })
})

describe('custom icons', () => {
  it('only an app’s editors upload; the file is sanitised before it is stored', async () => {
    const { uploadAppIcon } = await import('@/lib/services/app-icons')
    refRow = { id: 'tenant-a', settings: {} }
    const c = ctx(recorder([]).client, ['apps.view'])
    appAccess.mockResolvedValue('view')
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0"/></svg>')
    await expect(uploadAppIcon(c, { app: 'desk', name: 'a.svg', type: 'image/svg+xml', bytes: svg })).rejects.toThrow(/editors/)
    appAccess.mockResolvedValue('edit')
    await expect(uploadAppIcon(c, { app: 'desk', name: 'a.png', type: 'image/png', bytes: svg })).rejects.toThrow(/SVG/)
    await expect(uploadAppIcon(c, { app: 'desk', name: 'a.svg', type: 'image/svg+xml', bytes: new Uint8Array(101 * 1024) })).rejects.toThrow(/100 KB/)
    const icon = await uploadAppIcon(c, { app: 'desk', name: 'Bell.svg', type: 'image/svg+xml', bytes: svg, tint: true })
    expect(icon).toMatchObject({ name: 'Bell', tint: true })
    expect(icon.token).toMatch(/^svg:/)
    const saved = new TextDecoder().decode(stored[stored.length - 1].bytes)
    expect(saved).not.toContain('script')
    expect(stored[stored.length - 1].path).toMatch(/^app-icons\/tenant-a\/.+\.svg$/)
  })
})
