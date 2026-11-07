import { afterEach, describe, expect, it, vi } from 'vitest'

const dns = vi.hoisted(() => ({ map: {} as Record<string, string> }))
vi.mock('node:dns/promises', () => ({
  lookup: async (host: string) => [{ address: dns.map[host] ?? '93.184.216.34', family: 4 }],
}))

import { encodeQueryValue, renderBodyTemplate, renderHeaderTemplate, renderPathTemplate } from '@/lib/integrations/request-template'
import { connectorFetch, parseRetryAfter, providerErrorMessage, readCappedBody, ResponseTooLargeError } from '@/lib/integrations/http'
import { clearMintedTokenCache, mintMicrosoftToken } from '@/lib/integrations/token-mint'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'
import { runConnectorTemplate } from './helpers/connector-contract'

afterEach(() => {
  vi.unstubAllGlobals()
  clearMintedTokenCache()
  dns.map = {}
})

describe('request templates', () => {
  it('encodes path segments, keeps slashes and refuses traversal', () => {
    expect(renderPathTemplate('/files/{{id}}/content', { id: 'a b?c#d' })).toBe('/files/a%20b%3Fc%23d/content')
    expect(renderPathTemplate('/drive/root:{{path}}:/children', { path: '/Reports/Q3 é.pdf' })).toBe('/drive/root:/Reports/Q3%20%C3%A9.pdf:/children')
    expect(() => renderPathTemplate('/users/{{id}}', { id: '../admin' })).toThrow(/relative path segment/)
    expect(() => renderPathTemplate('/users/{{id}}', { id: 'x/../../admin' })).toThrow(/relative path segment/)
    // Encoded dots stay data (a literal "%2e%2e" never becomes "..")
    expect(renderPathTemplate('/users/{{id}}', { id: '%2e%2e' })).toBe('/users/%252e%252e')
  })

  it('encodes query values and drops empty optional pairs', () => {
    expect(renderPathTemplate('/v1/customers?limit={{limit}}&email={{email}}&starting_after={{after}}', { limit: 25, email: 'a+b&c=d@example.com', after: '' }))
      .toBe('/v1/customers?limit=25&email=a%2Bb%26c%3Dd@example.com')
    expect(renderPathTemplate('/x?$filter={{f}}&$format=json', { f: "name eq 'O''Brien'" })).toBe("/x?$filter=name%20eq%20'O''Brien'&$format=json")
    expect(renderPathTemplate('/x?{{qs}}&a=1', { qs: 'b=two words&c=3' })).toBe('/x?b=two%20words&c=3&a=1')
    expect(renderPathTemplate('/x?{{qs}}', { qs: '' })).toBe('/x')
    // Unknown placeholders are left alone
    expect(renderPathTemplate('/x/{{nope}}', {})).toBe('/x/{{nope}}')
    expect(encodeQueryValue('a&b#c')).toBe('a%26b%23c')
  })

  it('escapes JSON string values and keeps typed literals', () => {
    const body = renderBodyTemplate('{"text":"Hi {{name}}","n":{{n}},"tags":{{tags}},"obj":"{{obj}}","flag":{{flag}}}', {
      name: 'He said "x"\n", "admin": true, "y": "', n: '5', tags: '["a","b"]', obj: { a: 1 }, flag: true,
    }, 'application/json')
    const parsed = JSON.parse(body)
    expect(parsed.text).toBe('Hi He said "x"\n", "admin": true, "y": "')
    expect(parsed).not.toHaveProperty('admin')
    expect(parsed.n).toBe(5)
    expect(parsed.tags).toEqual(['a', 'b'])
    expect(parsed.obj).toEqual({ a: 1 })
    expect(parsed.flag).toBe(true)
  })

  it('drops empty unquoted JSON members and quotes non-JSON text', () => {
    const body = renderBodyTemplate('{"a":{{a}},"b":"{{b}}","c":{{c}},"list":[{{c}}]}', { a: '', b: '', c: 'plain words' }, 'application/json')
    expect(JSON.parse(body)).toEqual({ b: '', c: 'plain words', list: ['plain words'] })
    expect(JSON.parse(renderBodyTemplate('{"x":{{x}},"y":[{{x}}]}', { x: null }))).toEqual({ y: [null] })
  })

  it('renders form bodies like a query and escapes XML', () => {
    expect(renderBodyTemplate('To={{to}}&Body={{body}}&MediaUrl={{media}}', { to: '+6421000000', body: 'a & b = c', media: '' }, 'application/x-www-form-urlencoded'))
      .toBe('To=%2B6421000000&Body=a%20%26%20b%20%3D%20c')
    expect(renderBodyTemplate('<a>{{v}}</a>', { v: '<b>&' }, 'text/xml')).toBe('<a>&lt;b&gt;&amp;</a>')
  })

  it('strips header line breaks', () => {
    expect(renderHeaderTemplate('Bearer {{t}}', { t: 'x\r\nX-Evil: 1' })).toBe('Bearer x X-Evil: 1')
  })
})

describe('connectorFetch', () => {
  const sleep = async () => {}

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(Response.json({ ok: true }))
    const waits: number[] = []
    const res = await connectorFetch('https://api.example.com/x', { method: 'POST', body: '{}' }, { fetchImpl, sleep: async (ms) => { waits.push(ms) } })
    expect(res.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1000])
  })

  it('does not retry a non-idempotent 503, but does with an Idempotency-Key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    expect((await connectorFetch('https://api.example.com/x', { method: 'POST' }, { fetchImpl, sleep })).status).toBe(503)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockClear()
    await connectorFetch('https://api.example.com/x', { method: 'POST', headers: { 'Idempotency-Key': 'k' } }, { fetchImpl, sleep })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('hands back a 429 whose Retry-After exceeds the budget', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }))
    const res = await connectorFetch('https://api.example.com/x', {}, { fetchImpl, sleep, timeoutMs: 5_000 })
    expect(res.status).toBe(429)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('re-checks egress on redirects and drops credentials cross-origin', async () => {
    dns.map['evil.example.net'] = '169.254.169.254'
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.net/latest/meta-data' } }))
    await expect(connectorFetch('https://api.example.com/x', { headers: { Authorization: 'Bearer s' } }, { fetchImpl, sleep })).rejects.toThrow(/metadata/)

    const seen: Array<Record<string, string>> = []
    const fetch2 = vi.fn(async (url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>)
      return url.includes('api.example.com') ? new Response(null, { status: 307, headers: { location: 'https://cdn.example.org/file' } }) : new Response('ok')
    })
    await connectorFetch('https://api.example.com/x', { headers: { Authorization: 'Bearer s', Accept: 'x' } }, { fetchImpl: fetch2 as any, sleep })
    expect(seen[0].Authorization).toBe('Bearer s')
    expect(seen[1]).toEqual({ Accept: 'x' })
  })

  it('blocks private targets unless ALLOW_PRIVATE_EGRESS', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'))
    await expect(connectorFetch('http://127.0.0.1:8080/', {}, { fetchImpl })).rejects.toThrow(/not allowed/)
    vi.stubEnv('ALLOW_PRIVATE_EGRESS', 'true')
    try {
      expect((await connectorFetch('http://127.0.0.1:8080/', {}, { fetchImpl })).status).toBe(200)
      await expect(connectorFetch('http://169.254.169.254/', {}, { fetchImpl })).rejects.toThrow(/metadata/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('caps response bodies', async () => {
    await expect(readCappedBody(new Response('x'.repeat(100)), 10)).rejects.toBeInstanceOf(ResponseTooLargeError)
    expect((await readCappedBody(new Response('abc'), 10)).toString()).toBe('abc')
  })

  it('parses Retry-After dates and provider errors', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:05 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(5000)
    expect(providerErrorMessage({ error: { message: { value: 'OData says no' } } })).toBe('OData says no')
    expect(providerErrorMessage({ ok: false, error: 'channel_not_found' })).toBe('channel_not_found')
    expect(providerErrorMessage([{ message: 'Bad SOQL', errorCode: 'MALFORMED_QUERY' }])).toBe('Bad SOQL')
    expect(providerErrorMessage({ errorMessages: ['Issue does not exist'] })).toBe('Issue does not exist')
  })
})

describe('token mints and auth', () => {
  it('mints Microsoft tokens once per credential set, per tenant, single-flight', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'ms-token', expires_in: 3600 }))
    const cfg = { tenant_id: 'contoso.onmicrosoft.com', client_id: 'cid', client_secret: 'fake-secret', scope: 'https://graph.microsoft.com/.default' }
    const [a, b] = await Promise.all([mintMicrosoftToken(cfg, 't1', fetchImpl as any), mintMicrosoftToken(cfg, 't1', fetchImpl as any)])
    expect(a.token).toBe('ms-token')
    expect(b.cacheKey).toBe(a.cacheKey)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const call = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])
    expect(call[0]).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token')
    expect(String(call[1].body)).toContain('grant_type=client_credentials')
    const other = await mintMicrosoftToken(cfg, 't2', fetchImpl as any)
    expect(other.cacheKey).not.toBe(a.cacheKey)
    await expect(mintMicrosoftToken({ ...cfg, tenant_id: '../x' }, 't1', fetchImpl as any)).rejects.toThrow(/not valid/)
  })

  it('scopes oauth2 token stores to the integration tenant', async () => {
    const eqs: Array<[string, unknown]> = []
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => { eqs.push([col, val]); return builder },
      maybeSingle: async () => ({ data: null, error: null }),
    }
    const supabase: any = { from: () => builder }
    await expect(applyAuthHeaders({ auth_type: 'oauth2', auth_config: { connector_id: 'other-tenants-connector' } }, {}, { supabase, tenantId: 'tenant-a' }))
      .rejects.toThrow(/not found/)
    expect(eqs).toContainEqual(['tenant_id', 'tenant-a'])
  })

  it('adds query api keys, UKG customer keys and strips header breaks', async () => {
    const headers: Record<string, string> = {}
    const query: Record<string, string> = {}
    await applyAuthHeaders({ auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'k1', add_to: 'query' } }, headers, {}, query)
    expect(query).toEqual({ key: 'k1' })
    await applyAuthHeaders({ auth_type: 'basic', auth_config: { username: 'u', password: 'p', _executor: 'ukg_pro', customer_api_key: 'CUST\r\nX: y' } }, headers)
    expect(headers['US-Customer-Api-Key']).toBe('CUST X: y')
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
  })
})

describe('reference executor', () => {
  it('does not repeat template-placed inputs as query params, and redacts returned headers', async () => {
    const { call, result } = await runConnectorTemplate({ connector: 'stripe', template: 'get_customer', inputs: { customer_id: 'cus_FAKE' } })
    expect(call.url).toBe('https://api.stripe.com/v1/customers/cus_FAKE')
    expect(result.log?.requestHeaders?.Authorization).toBe('***')
  })

  it('mints Microsoft Graph tokens at runtime and re-mints once after a 401', async () => {
    let graphCalls = 0
    const { requests, result } = await runConnectorTemplate({
      connector: 'sharepoint',
      template: 'list_drives',
      inputs: { site_id: 'contoso.sharepoint.com,1,2' },
      respond: (req) => {
        if (req.url.includes('login.microsoftonline.com')) return Response.json({ access_token: 'fresh', expires_in: 3600 })
        graphCalls++
        return graphCalls === 1 ? new Response('{"error":{"message":"expired"}}', { status: 401, headers: { 'content-type': 'application/json' } }) : Response.json({ value: [] })
      },
    })
    expect(result.status).toBe(200)
    expect(requests.filter((r) => r.url.includes('login.microsoftonline.com'))).toHaveLength(2)
    expect(requests.filter((r) => r.url.startsWith('https://graph.microsoft.com')).every((r) => r.headers.authorization === 'Bearer ***')).toBe(true)
  })

  it('only follows next_link on the integration origin', async () => {
    const ok = await runConnectorTemplate({ connector: 'stripe', template: 'get_customer', inputs: { customer_id: 'cus_1' }, mutateReference: (ref) => { ref.inputs.push({ name: 'next_link', type: 'string', location: 'query', default_value: '' }) } })
    expect(ok.call.url).toContain('/v1/customers/cus_1')
    await expect(runConnectorTemplate({
      connector: 'stripe', template: 'get_customer', inputs: { customer_id: 'cus_1', next_link: 'https://evil.example.net/steal' },
      mutateReference: (ref) => { ref.inputs.push({ name: 'next_link', type: 'string', location: 'query', default_value: '' }) },
    })).rejects.toThrow(/own host/)
  })

  it('maps provider errors to error_message', async () => {
    const { result } = await runConnectorTemplate({
      connector: 'stripe', template: 'get_customer', inputs: { customer_id: 'cus_missing' },
      respond: () => new Response(JSON.stringify({ error: { message: 'No such customer', type: 'invalid_request_error' } }), { status: 404, headers: { 'content-type': 'application/json' } }),
    })
    expect(result.status).toBe(404)
    expect(result.error_message).toBe('No such customer')
  })
})

describe('generated reference upgrade on read', () => {
  it('follows the current template only while the stored reference is untouched', async () => {
    const { currentConnectorReference, templateHash } = await import('@/lib/connectors/reference-upgrade')
    const { getConnectorDefinition } = await import('@/lib/connectors/registry')
    const { normalizeReferenceInput } = await import('@/lib/services/references')
    const def = getConnectorDefinition('stripe')!
    const template = def.referenceTemplates.find((t) => t.key === 'get_customer')!
    const old = { ...template, pathTemplate: '/v0/customers/{{customer_id}}' }
    const stored = {
      inputs: old.inputs.map((i) => normalizeReferenceInput({ ...i, default_value: i.defaultValue ?? '' })),
      request_config: { method: old.method, path_template: old.pathTemplate, body_template: '', headers: old.headers ?? {}, connector_template: { key: old.key, hash: templateHash(old) } },
    }
    const upgraded = currentConnectorReference(stored, def)
    expect(upgraded.request_config.path_template).toBe(template.pathTemplate)
    expect(upgraded.inputs.map((i: any) => i.id)).toEqual(stored.inputs.map((i: any) => i.id))
    const edited = { ...stored, request_config: { ...stored.request_config, path_template: '/custom/{{customer_id}}' } }
    expect(currentConnectorReference(edited, def).request_config.path_template).toBe('/custom/{{customer_id}}')
    const legacy = { ...stored, request_config: { ...stored.request_config, connector_template: undefined } }
    expect(currentConnectorReference(legacy, def)).toBe(legacy)
  })
})

describe('generic client credentials', () => {
  it('mints with HTTP Basic client auth and caches', async () => {
    const { mintClientCredentialsToken } = await import('@/lib/integrations/token-mint')
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'cc-token', expires_in: 600 }))
    const cfg = { token_url: 'https://auth.example.com/oauth/token', client_id: 'sb-client!b1', client_secret: 'fake-secret', scope: 'read' }
    expect((await mintClientCredentialsToken(cfg, 't1', fetchImpl as any)).token).toBe('cc-token')
    await mintClientCredentialsToken(cfg, 't1', fetchImpl as any)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
    expect(String(init.body)).toBe('grant_type=client_credentials&scope=read')
  })
})
