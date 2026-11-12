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
    expect(summary.preview.layout.rules).toBeUndefined()
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
