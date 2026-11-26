import { afterEach, describe, expect, it, vi } from 'vitest'
import { __testing } from '@/lib/workflow-engine'
import { capResponseBody, ResponseBodyTooLargeError } from '@/lib/capped-response'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

/**
 * HTTP Request step response bodies (2026-11 QA pass):
 *  - a non-JSON body (HTML, XML, CSV, plain text, empty) is stored as text.
 *    The old json()-then-clone() fallback threw "Body has already been
 *    consumed", failing the step for every non-JSON response.
 *  - the body is capped (WORKFLOW_DOWNLOAD_MAX_BYTES) so a step pointed at a
 *    huge file fails cleanly instead of exhausting the worker's memory.
 */

type Ctx = Parameters<typeof __testing.executeNode>[3]
type Node = Parameters<typeof __testing.executeNode>[0]

function makeCtx() {
  return {
    supabase: { from: () => ({}) },
    tenantId: 'tenant-1',
    variables: {} as Record<string, unknown>,
    liveBindings: {},
    nodeResults: {} as Record<string, { status: string; output?: unknown; error?: string }>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [],
  } as unknown as Ctx & { variables: Record<string, unknown>; nodeResults: Record<string, { status: string; output?: unknown; error?: string }> }
}

const httpGet = { id: 'n-http', type: 'http_request', label: 'Fetch', position: { x: 0, y: 0 }, config: { url: 'https://api.example.com/x', method: 'GET', _output_prefix: 'fetch' } } as unknown as Node

afterEach(() => { vi.unstubAllGlobals(); delete process.env.WORKFLOW_DOWNLOAD_MAX_BYTES })

describe('HTTP Request response bodies', () => {
  it.each([
    ['text/plain', 'hello world'],
    ['text/html', '<html><body>ok</body></html>'],
    ['text/csv', 'a,b\n1,2'],
    ['application/xml', '<r><a>1</a></r>'],
    ['text/plain', ''],
  ])('stores a %s body as text', async (type, body) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': type } })))
    const ctx = makeCtx()
    await __testing.executeNode(httpGet, [httpGet], [], ctx)
    expect(ctx.nodeResults['n-http'].status).toBe('success')
    expect(ctx.variables.response).toBe(body)
    expect(ctx.variables.fetch_status).toBe(200)
  })

  it('still parses JSON (whatever the declared type)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'text/plain' } })))
    const ctx = makeCtx()
    await __testing.executeNode(httpGet, [httpGet], [], ctx)
    expect(ctx.variables.response).toEqual({ a: 1 })
  })

  it('fails the step cleanly when the body passes the cap (streamed, no Content-Length)', async () => {
    process.env.WORKFLOW_DOWNLOAD_MAX_BYTES = '1024'
    const chunk = new Uint8Array(512).fill(97)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(chunk) }, // endless
    }), { status: 200, headers: { 'content-type': 'text/plain' } })))
    const ctx = makeCtx()
    await expect(__testing.executeNode(httpGet, [httpGet], [], ctx)).rejects.toThrow(/larger than the .* limit for workflow downloads/)
    expect(ctx.nodeResults['n-http'].status).toBe('error')
  })

  it('refuses a declared Content-Length over the cap before reading', async () => {
    process.env.WORKFLOW_DOWNLOAD_MAX_BYTES = '1024'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(10), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '999999999' } })))
    const ctx = makeCtx()
    await expect(__testing.executeNode(httpGet, [httpGet], [], ctx)).rejects.toThrow(/limit for workflow downloads/)
  })
})

describe('HTTP Request failure messages', () => {
  it('never include the query string (API keys) or userinfo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const node = { ...httpGet, config: { ...(httpGet as any).config, url: 'https://user:pw@api.example.com/x?api_key=SECRET123&q=1' } } as unknown as Node
    const ctx = makeCtx()
    const error = await __testing.executeNode(node, [node], [], ctx).catch((e: Error) => e)
    expect(String((error as Error).message)).toMatch(/HTTP Request to https:\/\/api\.example\.com\/x\?… failed/)
    expect(JSON.stringify(ctx.nodeResults)).not.toContain('SECRET123')
    expect(JSON.stringify(ctx.nodeResults)).not.toContain('pw@')
  })
})

describe('capResponseBody', () => {
  it('passes bodies under the cap through unchanged', async () => {
    const res = capResponseBody(new Response('abc', { status: 201, headers: { 'x-a': '1' } }), 10)
    expect(res.status).toBe(201)
    expect(res.headers.get('x-a')).toBe('1')
    expect(await res.text()).toBe('abc')
  })
  it('errors past the cap', async () => {
    const res = capResponseBody(new Response('abcdefghijk'), 5)
    await expect(res.arrayBuffer()).rejects.toBeInstanceOf(ResponseBodyTooLargeError)
  })
  it('leaves bodiless statuses alone', () => {
    const res = new Response(null, { status: 204 })
    expect(capResponseBody(res, 5)).toBe(res)
  })
})
