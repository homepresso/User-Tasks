import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// A middleware workflow's response is served from the app origin
// (app/api/webhooks/inbound): it must never be able to plant cookies or run
// script there (cross-site form POST → author-controlled HTML → XSS).

const pending = vi.hoisted(() => ({ db: null as unknown, outcome: null as unknown }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => { void Promise.resolve().then(fn).catch(() => {}) } }
})
vi.mock('@/lib/providers/db', () => ({ getServiceDb: () => pending.db }))
vi.mock('@/lib/processing/dispatch', () => ({
  handsOff: vi.fn(async () => false),
  QueuedRunTimeoutError: class extends Error {},
  startRun: vi.fn(async () => pending.outcome),
}))
vi.mock('@/lib/workflow-queue-processor', () => ({ processWorkflowQueueBatch: vi.fn() }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))

import { isActiveContentType, safeWebhookResponseHeaders, WEBHOOK_RESPONSE_CSP } from '@/lib/webhook-response'
import { hashWebhookSecret } from '@/lib/webhook-secret'
import { POST as inbound } from '@/app/api/webhooks/inbound/route'

/** Just enough of the client for the route: the webhook row (with its workflow joined) and fire-and-forget updates. */
function fakeDb(row: Record<string, unknown>) {
  const chain = (result: unknown): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'update', 'single', 'maybeSingle']) c[m] = () => c
    c.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return c
  }
  return { from: () => chain({ data: row, error: null }), rpc: async () => ({ data: 'job', error: null }) }
}

const SECRET = 'a1b2c3d4'.repeat(8)

describe('safeWebhookResponseHeaders', () => {
  it('drops cookies, security and hop-by-hop headers; keeps ordinary ones', () => {
    const h = safeWebhookResponseHeaders({
      'Set-Cookie': 'sb-access-token=attacker; Path=/', 'content-security-policy': "script-src *",
      'X-Frame-Options': 'ALLOW', 'Strict-Transport-Security': 'max-age=0', 'Access-Control-Allow-Credentials': 'true',
      'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json', 'X-Request-Id': 'r1', 'Access-Control-Allow-Origin': '*',
    })
    expect(h.get('set-cookie')).toBeNull()
    expect(h.get('x-frame-options')).toBeNull()
    expect(h.get('strict-transport-security')).toBeNull()
    expect(h.get('access-control-allow-credentials')).toBeNull()
    expect(h.get('transfer-encoding')).toBeNull()
    expect(h.get('content-security-policy')).toBe(WEBHOOK_RESPONSE_CSP)
    expect(h.get('x-content-type-options')).toBe('nosniff')
    expect(h.get('x-request-id')).toBe('r1')
    expect(h.get('access-control-allow-origin')).toBe('*')
    expect(h.get('content-disposition')).toBeNull() // JSON is not an active type
  })

  it('serves active content (HTML, SVG, XML, untyped) as a download', () => {
    for (const type of ['text/html; charset=utf-8', 'TEXT/HTML', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/rss+xml', '']) {
      expect(isActiveContentType(type)).toBe(true)
      expect(safeWebhookResponseHeaders({ 'Content-Type': type }).get('content-disposition')).toMatch(/^attachment/)
    }
    expect(safeWebhookResponseHeaders({ 'Content-Type': 'text/html', 'Content-Disposition': 'inline; filename="page.html"' }).get('content-disposition'))
      .toBe('attachment; filename="page.html"')
    for (const type of ['application/json', 'text/plain', 'application/pdf', 'image/png', 'text/csv']) expect(isActiveContentType(type)).toBe(false)
  })

  it('drops header values a workflow could use for response splitting instead of failing', () => {
    const h = safeWebhookResponseHeaders({ 'X-Evil': 'a\r\nSet-Cookie: x=1', 'Content-Type': 'text/plain' })
    expect(h.get('x-evil')).toBeNull()
    expect(h.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/webhooks/inbound (middleware response)', () => {
  it('an author-built HTML response with Set-Cookie is neutralised', async () => {
    pending.db = fakeDb({
      id: 'wh-a', slug: 'evil', tenant_id: 'tenant-a', is_active: true, payload_mapping: [], receive_count: 0,
      api_key_hash: 'x', api_key_prefix: SECRET.slice(0, 8), api_key_sha256: hashWebhookSecret(SECRET),
      workflow: { id: 'wf-a', is_active: true, trigger_type: 'middleware_received', published_version_id: 'v1' },
    })
    pending.outcome = {
      status: 'completed',
      response: { statusCode: 200, bodyType: 'text', headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'sb-x=attacker; Path=/' }, body: '<script>fetch("/api/v1/me")</script>' },
    }
    // A cross-site form POST (text/plain body, key in the query string).
    const res = await inbound(new NextRequest(`http://localhost/api/webhooks/inbound?hook=evil&key=${SECRET}`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x=1',
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(res.headers.get('content-security-policy')).toBe(WEBHOOK_RESPONSE_CSP)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await res.text()).toContain('<script>') // the body itself is the author's; it just never renders on our origin
  })
})

describe('POST /api/webhooks/inbound limits', () => {
  const row = (id: string) => ({
    id, slug: id, tenant_id: 'tenant-a', is_active: true, payload_mapping: [], receive_count: 0,
    api_key_hash: 'x', api_key_prefix: SECRET.slice(0, 8), api_key_sha256: hashWebhookSecret(SECRET),
    workflow: { id: 'wf-a', is_active: true, trigger_type: 'middleware_received', published_version_id: 'v1' },
  })
  const ok = { status: 'completed', response: { statusCode: 200, bodyType: 'json', headers: { 'Content-Type': 'application/json' }, body: { ok: true } } }
  const post = (slug: string, body: BodyInit, headers: Record<string, string> = {}) =>
    inbound(new NextRequest(`http://localhost/api/webhooks/inbound?hook=${slug}`, {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json', ...headers }, body,
    }))

  it('refuses a body over WEBHOOK_MAX_BODY_BYTES with 413 (declared or streamed)', async () => {
    process.env.WEBHOOK_MAX_BODY_BYTES = '1024'
    try {
      pending.db = fakeDb(row('big'))
      pending.outcome = ok
      expect((await post('big', JSON.stringify({ a: 'x'.repeat(4000) }))).status).toBe(413)
      const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":"' + 'x'.repeat(4000) + '"}')); c.close() } })
      expect((await inbound(new NextRequest('http://localhost/api/webhooks/inbound?hook=big', {
        method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: stream, duplex: 'half',
      } as never))).status).toBe(413)
      expect((await post('big', JSON.stringify({ a: 1 }))).status).toBe(200)
    } finally {
      delete process.env.WEBHOOK_MAX_BODY_BYTES
    }
  })

  it('rate-limits each webhook (429 with Retry-After)', async () => {
    process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE = '3'
    try {
      pending.db = fakeDb(row('busy'))
      pending.outcome = ok
      const statuses: number[] = []
      for (let i = 0; i < 4; i++) statuses.push((await post('busy', '{}')).status)
      expect(statuses).toEqual([200, 200, 200, 429])
      const res = await post('busy', '{}')
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    } finally {
      delete process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE
    }
  })
})
