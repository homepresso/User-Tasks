import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { makeAcroFormFixture, makeFlatFixture } from './fixtures/pdf-forms'

const hits = vi.hoisted(() => new Map<string, number>())
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async (key: string, opts: { max: number }) => {
    const n = (hits.get(key) ?? 0) + 1
    hits.set(key, n)
    return n > opts.max ? { ok: false, retryAfterMs: 30_000 } : { ok: true, remaining: opts.max - n, retryAfterMs: 0 }
  }),
}))

const { POST } = await import('@/app/api/public/pdf/analyze/route')

async function upload(file: Uint8Array | null, opts: { ip?: string; website?: string; length?: number } = {}) {
  const body = new FormData()
  if (file) body.append('file', new File([file as unknown as BlobPart], 'survey.pdf'))
  if (opts.website !== undefined) body.append('website', opts.website)
  const req = new Request('https://usertasks.com/api/public/pdf/analyze', { method: 'POST', body })
  const buf = await req.arrayBuffer()
  return new NextRequest('https://usertasks.com/api/public/pdf/analyze', {
    method: 'POST', body: buf,
    headers: { 'content-type': req.headers.get('content-type')!, 'content-length': String(opts.length ?? buf.byteLength), 'x-forwarded-for': opts.ip ?? '203.0.113.9' },
  })
}

beforeEach(() => { vi.stubEnv('DEPLOYMENT_MODE', 'cloud'); hits.clear() })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('public PDF preview endpoint', () => {
  it('returns a derived summary only: no field names, scripts or provenance', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await POST(await upload(await makeAcroFormFixture()))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const { summary } = await res.json()
    expect(summary).toMatchObject({ kind: 'acroform', name: 'Vehicle and household survey', counts: { fields: 12, rules: 3, rules_enabled: 3 } })
    expect(summary.preview.fields.length).toBe(12)
    const text = JSON.stringify(summary)
    expect(text).not.toMatch(/util\.printx|app\.alert|ownVehicle|start_month|survey\.pdf/)
    expect(summary.preview.layout.source).toBeUndefined()
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Vehicle/)
  })

  it('says a flat PDF has no fields', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { summary } = await (await POST(await upload(await makeFlatFixture()))).json()
    expect(summary).toMatchObject({ kind: 'flat', counts: { fields: 0 }, preview: null })
  })

  it('is cloud only, rate limited, size limited, honeypot guarded and refuses non-PDFs', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect((await POST(await upload(await makeFlatFixture()))).status).toBe(404)
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect((await POST(await upload(await makeFlatFixture(), { length: 5 * 1024 * 1024 }))).status).toBe(413)
    expect((await POST(await upload(await makeFlatFixture(), { website: 'spam' }))).status).toBe(400)
    expect((await POST(await upload(new TextEncoder().encode('not a pdf')))).status).toBe(422)
    for (let i = 0; i < 6; i++) await POST(await upload(null, { ip: '198.51.100.1' }))
    expect((await POST(await upload(null, { ip: '198.51.100.1' }))).status).toBe(429)
  })
})
