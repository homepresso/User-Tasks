import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  UsertasksApiError,
  UsertasksNetworkError,
  apiKeyAuth,
  createClient,
  findOperation,
  type TokenProvider,
} from '../src'

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>

function mockFetch(...handlers: Handler[]) {
  const calls: { url: URL; init: RequestInit }[] = []
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)]
    return handler(url, init)
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

const client = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof createClient>[0]> = {}) =>
  createClient({ baseUrl: 'https://tasks.example.com', auth: apiKeyAuth('ut_test'), fetch: fetchImpl, retryDelayMs: 0, ...extra })

describe('UsertasksClient', () => {
  it('sends the bearer token to /api/v1 and unwraps the envelope', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: true, data: { workflows: [{ id: 'w1' }], total: 1 } }))
    const data = await client(fetch).GET('/workflows', { query: { active: 'false' } })
    expect(data).toEqual({ workflows: [{ id: 'w1' }], total: 1 })
    expect(calls[0].url.toString()).toBe('https://tasks.example.com/api/v1/workflows?active=false')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer ut_test')
  })

  it('accepts a base URL that already ends in /api/v1', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: true, data: {} }))
    await client(fetch, { baseUrl: 'https://tasks.example.com/api/v1/' }).GET('/me')
    expect(calls[0].url.pathname).toBe('/api/v1/me')
  })

  it('fills and encodes path params', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: true, data: { workflow: {} } }))
    await client(fetch).GET('/workflows/{id}', { path: { id: 'a/b c' } })
    expect(calls[0].url.pathname).toBe('/api/v1/workflows/a%2Fb%20c')
  })

  it('serialises JSON bodies', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: true, data: { mode: 'sync' } }, 200))
    await client(fetch).POST('/workflows/start', { body: { workflow_id: '00000000-0000-0000-0000-000000000000', async: false, priority: 50 } })
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ workflow_id: '00000000-0000-0000-0000-000000000000' })
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('returns the bare body for x-usertasks-envelope: false operations', async () => {
    expect(findOperation('GET', '/reports/sources')?.envelope).toBe(false)
    const body = { sources: [{ id: 'tasks' }] }
    const { fetch } = mockFetch(() => json(body))
    expect(await client(fetch).GET('/reports/sources')).toEqual(body)
  })

  it('throws UsertasksApiError with status, code, details and request id', async () => {
    const { fetch } = mockFetch(() =>
      json(
        { success: false, error: 'Validation failed: name: Required', code: 'validation_error', details: [{ path: 'body.name', message: 'Required' }] },
        400,
        { 'x-request-id': 'req_123' },
      ),
    )
    const error = await client(fetch).POST('/decision-tables', { body: {} as never }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UsertasksApiError)
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'Validation failed: name: Required',
      details: [{ path: 'body.name', message: 'Required' }],
      requestId: 'req_123',
    })
  })

  it('handles legacy error bodies and non-JSON errors', async () => {
    const legacy = mockFetch(() => json({ success: false, error: 'Not found' }, 404))
    await expect(client(legacy.fetch).GET('/workflows/{id}', { path: { id: 'x' } })).rejects.toMatchObject({ status: 404, message: 'Not found', code: undefined })
    const text = mockFetch(() => new Response('Bad gateway', { status: 502 }))
    await expect(client(text.fetch, { retries: 0 }).GET('/me')).rejects.toMatchObject({ status: 502, message: 'Bad gateway' })
  })

  it('retries idempotent requests on 429 and 5xx, honouring Retry-After', async () => {
    const { fetch, calls } = mockFetch(
      () => json({ success: false, error: 'slow down' }, 429, { 'Retry-After': '0' }),
      () => json({ success: false, error: 'boom' }, 503),
      () => json({ success: true, data: { ok: 1 } }),
    )
    expect(await client(fetch).GET('/me')).toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
  })

  it('gives up after the retry budget', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: false, error: 'down' }, 500))
    await expect(client(fetch, { retries: 2 }).GET('/me')).rejects.toMatchObject({ status: 500 })
    expect(calls).toHaveLength(3)
  })

  it('never retries non-idempotent methods', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: false, error: 'down' }, 503))
    await expect(client(fetch).POST('/workflows/start', { body: { workflow_id: 'x' } as never })).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })

  it('retries network errors for GET and wraps the final failure', async () => {
    const failing = mockFetch(() => {
      throw new TypeError('fetch failed')
    })
    await expect(client(failing.fetch, { retries: 1 }).GET('/me')).rejects.toBeInstanceOf(UsertasksNetworkError)
    expect(failing.calls).toHaveLength(2)

    const post = mockFetch(() => {
      throw new TypeError('fetch failed')
    })
    await expect(client(post.fetch).request('POST', '/tasks/ingest', { body: {} })).rejects.toBeInstanceOf(UsertasksNetworkError)
    expect(post.calls).toHaveLength(1)
  })

  it('lets the token provider recover once from a 401', async () => {
    let token = 'old'
    const auth: TokenProvider = {
      kind: 'oauth',
      getToken: async () => token,
      invalidate: vi.fn(async () => {
        token = 'new'
        return true
      }),
    }
    const { fetch, calls } = mockFetch(
      () => json({ success: false, error: 'expired' }, 401),
      () => json({ success: true, data: { ok: true } }),
    )
    expect(await client(fetch, { auth }).GET('/me')).toEqual({ ok: true })
    expect(auth.invalidate).toHaveBeenCalledWith('old')
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer new')
  })

  it('surfaces the 401 when the provider cannot refresh, and API keys never retry', async () => {
    const auth: TokenProvider = { kind: 'oauth', getToken: async () => 't', invalidate: async () => false }
    const declined = mockFetch(() => json({ success: false, error: 'Invalid API key' }, 401))
    await expect(client(declined.fetch, { auth }).GET('/me')).rejects.toMatchObject({ status: 401, message: 'Invalid API key' })
    expect(declined.calls).toHaveLength(1)

    const key = mockFetch(() => json({ success: false, error: 'Invalid API key' }, 401))
    await expect(client(key.fetch).GET('/me')).rejects.toMatchObject({ status: 401 })
    expect(key.calls).toHaveLength(1)
  })

  it('apiKeyAuth rejects an empty key', () => {
    expect(() => apiKeyAuth('  ')).toThrow()
  })
})

describe('paginate', () => {
  it('walks limit/offset pages using the operation listKey', async () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}` }))
    const { fetch, calls } = mockFetch((url) => {
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      return json({ success: true, data: { workflows: all.slice(offset, offset + limit), total: all.length } })
    })
    const items = []
    for await (const item of client(fetch).paginate('/workflows', { pageSize: 2, query: { active: 'false' } })) items.push(item)
    expect(items).toEqual(all)
    expect(calls.map((c) => c.url.search)).toEqual([
      '?active=false&limit=2&offset=0',
      '?active=false&limit=2&offset=2',
      '?active=false&limit=2&offset=4',
    ])
  })

  it('stops at the reported total even when pages are full', async () => {
    const { fetch, calls } = mockFetch(() => json({ success: true, data: { tasks: [{ id: 1 }, { id: 2 }], total: 2 } }))
    const items = []
    for await (const item of client(fetch).paginate('/tasks', { pageSize: 2 })) items.push(item)
    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(1)
  })

  it('requires a listKey for unknown paths', async () => {
    const { fetch } = mockFetch(() => json({ success: true, data: {} }))
    await expect(client(fetch).paginate('/nope').next()).rejects.toThrow(/listKey/)
  })
})

describe('findOperation', () => {
  it('prefers exact template matches over parameterised ones', () => {
    expect(findOperation('GET', '/workflows/runs')?.operationId).toBe('listWorkflowRuns')
    expect(findOperation('GET', '/workflows/abc')?.operationId).toBe('getWorkflow')
    expect(findOperation('get', '/workflows/runs/r1')?.operationId).toBe('getWorkflowRun')
    expect(findOperation('POST', '/nope')).toBeUndefined()
  })
})

describe('types', () => {
  it('infers unwrapped response data from the OpenAPI types', () => {
    const typed = createClient({ baseUrl: 'https://x.test' })
    expectTypeOf(typed.GET<'/me'>).returns.resolves.toHaveProperty('tenant')
    expectTypeOf(typed.GET<'/workflows'>).returns.resolves.toHaveProperty('workflows')
  })
})
