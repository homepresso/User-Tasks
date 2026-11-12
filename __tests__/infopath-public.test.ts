import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixtureXsn } from './helpers/infopath-fixtures'
import { writeCab } from './helpers/cab-writer'

const hits = vi.hoisted(() => new Map<string, number>())
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async (key: string, opts: { max: number }) => {
    const n = (hits.get(key) ?? 0) + 1
    hits.set(key, n)
    return n > opts.max ? { ok: false, retryAfterMs: 30_000 } : { ok: true, remaining: opts.max - n, retryAfterMs: 0 }
  }),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const { POST } = await import('@/app/api/public/infopath/analyze/route')
const { publicInfoPathSummary, PUBLIC_INFOPATH_LIMITS } = await import('@/lib/infopath/public-summary')
const { importerHref } = await import('@/lib/infopath/pending-file')

function upload(file: Buffer | null, opts: { ip?: string; name?: string; website?: string; length?: number } = {}) {
  const body = new FormData()
  if (file) body.append('file', new File([new Uint8Array(file)], opts.name ?? 'Expense Report.xsn'))
  if (opts.website !== undefined) body.append('website', opts.website)
  const req = new Request('https://usertasks.com/api/public/infopath/analyze', { method: 'POST', body })
  return req.arrayBuffer().then((buf) => new NextRequest('https://usertasks.com/api/public/infopath/analyze', {
    method: 'POST',
    headers: { 'content-type': req.headers.get('content-type')!, 'content-length': String(opts.length ?? buf.byteLength), 'x-forwarded-for': opts.ip ?? '203.0.113.7' },
    body: buf,
  }))
}

beforeEach(() => { vi.stubEnv('DEPLOYMENT_MODE', 'cloud'); hits.clear() })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('public InfoPath preview endpoint', () => {
  it('returns a derived summary without raw expressions or provenance', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await POST(await upload(fixtureXsn('expense-report')))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { summary } = await res.json()
    expect(summary.counts).toMatchObject({ views: 1, fields: 11, repeating: 1, rules: { total: 5, converted: 4 } })
    expect(summary.views[0].fields.find((f: { label: string }) => f.label === 'Line items').columns).toContain('Unit price')
    expect(summary.preview.fields.length).toBeGreaterThan(5)
    const text = JSON.stringify(summary)
    for (const raw of ['my:', 'xdXDocument', 'GetDOM', 'Lists/Projects', '../', '"hash"', '"source"', 'Original']) expect(text, raw).not.toContain(raw)
    // Only "Always" rules that restyle, hide, lock or flag go to the preview — no notes, nothing that calls out.
    expect(summary.preview.layout.rules.length).toBeGreaterThan(0)
    for (const r of summary.preview.layout.rules) {
      expect(r.event).toBe('always')
      expect(r.description).toBeUndefined()
      for (const a of r.then) expect(['show_hide', 'enable_disable', 'read_only', 'set_style', 'field_error']).toContain(a.type)
    }
    // Every field type has a readable label; the counts and the "what converts" list are there.
    for (const f of summary.views[0].fields) expect(f.type_label, f.type).toMatch(/^[A-Z]/)
    expect(summary.counts.formatting).toEqual({ total: 3, converted: 3 })
    expect(summary.features.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(['lists', 'calculated_columns', 'styles', 'functions']))
    // Logs hold counts only.
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain('"views":1')
    expect(logged).not.toMatch(/Expense|Employee|Line items/)
  })

  it('stores nothing: no database, storage or cache writes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await POST(await upload(fixtureXsn('leave-request')))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is cloud-only', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect((await POST(await upload(fixtureXsn('expense-report')))).status).toBe(404)
  })

  it('rate-limits per IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) statuses.push((await POST(await upload(Buffer.from('x'), { ip: '198.51.100.9' }))).status)
    expect(statuses.slice(0, 6).every((s) => s !== 429)).toBe(true)
    expect(statuses.slice(6)).toEqual([429, 429])
    // Another visitor is not affected.
    expect((await POST(await upload(fixtureXsn('expense-report'), { ip: '198.51.100.10' }))).status).toBe(200)
  })

  it('refuses big bodies before reading them, honeypots, non-templates and LZX', async () => {
    expect((await POST(await upload(fixtureXsn('expense-report'), { length: 5 * 1024 * 1024 }))).status).toBe(413)
    expect((await POST(await upload(fixtureXsn('expense-report'), { website: 'http://spam.example' }))).status).toBe(400)
    const notForm = await POST(await upload(Buffer.from('%PDF-1.7 not a form'), { name: 'x.xsn' }))
    expect(notForm.status).toBe(422)
    expect((await notForm.json()).error).toMatch(/not an InfoPath form template/)
    const lzx = await POST(await upload(writeCab([{ name: 'manifest.xsf', data: '<x/>' }], 'lzx')))
    expect((await lzx.json()).error).toMatch(/LZX/)
  })

  it('applies the tighter anonymous caps (zip-bomb guard)', () => {
    const big = writeCab([{ name: 'manifest.xsf', data: '<a/>' }, { name: 'pad.xml', data: 'x'.repeat(PUBLIC_INFOPATH_LIMITS.maxTotalBytes + 10) }])
    expect(big.length).toBeLessThan(PUBLIC_INFOPATH_LIMITS.maxInputBytes)
    expect(() => publicInfoPathSummary(big)).toThrow(/unpack/)
  })
})

describe('public preview of the new mappings (site inspection sample)', () => {
  it('summarises repeating sections, nested Lists, pictures, signatures, styles, roles and XPath functions', () => {
    const s = publicInfoPathSummary(fixtureXsn('site-inspection'), 'Site Inspection.xsn')
    expect(s.counts).toMatchObject({ fields: 17, repeating: 2, rules: { total: 1, converted: 1 }, validations: { total: 3, converted: 3 }, calculations: { total: 2, converted: 2 }, formatting: { total: 4, converted: 4 } })
    const features = Object.fromEntries(s.features.map((f) => [f.key, f]))
    for (const k of ['lists', 'nested_lists', 'repeating_sections', 'images', 'display_images', 'signatures', 'rich_text', 'text_lists', 'people', 'choice_groups', 'styles', 'list_validations', 'roles', 'functions'] as const) expect(features[k]?.count, k).toBeGreaterThan(0)
    expect(features.repeating_sections.count).toBe(2)
    expect(features.functions.items).toEqual(expect.arrayContaining(['COUNTIF', 'SUBSTRING_BEFORE']))
    expect(s.attention).toEqual([])
    const labels = Object.fromEntries(s.views[0].fields.map((f) => [f.label, f.type_label]))
    expect(labels).toMatchObject({ Hazards: 'Repeating section', Checks: 'List (repeating table)', 'Site photo': 'Image', Sketch: 'Signature', Notes: 'Rich text', 'Follow-up actions': 'Text list', 'Site owner': 'Person picker', Regions: 'Multi-select' })
    expect(s.views[0].fields.find((f) => f.label === 'Hazards')?.columns).toEqual(['Hazard', 'Level', 'Photo', 'Control measure'])
  })

  it('previews the new controls as a real form: display image, Image, Signature, nested List, Repeating section, choice group, styles', () => {
    const p = publicInfoPathSummary(fixtureXsn('site-inspection'), 'Site Inspection.xsn').preview!
    const byType = (t: string) => p.fields.filter((f) => (f.type as string) === t) as Array<Record<string, any>>
    expect(byType('display_image')[0].display_image.src).toMatch(/^data:image\/png;base64,/)
    expect(byType('image')).toHaveLength(1)
    expect(byType('signature')).toHaveLength(1)
    expect(byType('list')[0].list.columns.find((c: { type: string }) => c.type === 'list')).toBeTruthy()
    expect(byType('list')[0].list.row_styles).toHaveLength(1)
    const rs = byType('repeating_section')[0].repeating_section
    expect(rs.fields.map((f: { type: string }) => f.type)).toEqual(['text', 'choice', 'image', 'repeating_section'])
    expect(rs.layout.rules.every((r: { event: string; description?: string }) => r.event === 'always' && !r.description)).toBe(true)
    expect(p.layout.choice_groups).toHaveLength(1)
    expect(p.layout.rules!.map((r) => r.name)).toEqual(['Style: Status (Failed in red)', 'Style: Status (Pending shaded)'])
    // The form_load role rule (sets a value) stays out of a static preview.
    expect(JSON.stringify(p)).not.toContain('user.roles')
    for (const raw of ['my:', 'xdXDocument', 'get-Role', 'help_text', '"source"']) expect(JSON.stringify(p), raw).not.toContain(raw)
  })

  it('labels every field type', async () => {
    const { TASK_FIELD_TYPES } = await import('@/lib/task-field-schema')
    const { publicTypeLabel } = await import('@/lib/infopath/public-summary')
    for (const t of TASK_FIELD_TYPES) expect(publicTypeLabel(t), t).not.toBe(t)
    expect(publicTypeLabel('repeating_section')).toBe('Repeating section')
    expect(publicTypeLabel('display_image')).toBe('Display image')
  })

  it('serves both samples on the page, and they analyse through the endpoint', async () => {
    const { readFileSync } = await import('node:fs')
    vi.spyOn(console, 'info').mockImplementation(() => {})
    for (const [file, fields] of [['expense-report.xsn', 11], ['site-inspection.xsn', 17]] as const) {
      const res = await POST(await upload(readFileSync(`public/samples/${file}`), { name: file }))
      expect(res.status, file).toBe(200)
      expect((await res.json()).summary.counts.fields).toBe(fields)
    }
  })
})

describe('the "Create these forms" path', () => {
  it('goes to the importer when signed in, sign-up first otherwise', () => {
    expect(importerHref(true)).toBe('/automations/forms?import=infopath')
    expect(importerHref(false)).toBe('/start?next=infopath')
  })

  it('sign-up only follows the known destination', async () => {
    const { StartPage } = await import('@/components/marketing/start-page')
    const withNext = renderToStaticMarkup(StartPage({ email: '', next: 'infopath' }))
    expect(withNext).toContain('After sign-up your InfoPath form opens in the importer')
    expect(renderToStaticMarkup(StartPage({ email: '' }))).not.toContain('start-infopath-note')
  })
})
