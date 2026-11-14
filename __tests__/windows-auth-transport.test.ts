import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { connectorFetch } from '@/lib/integrations/http'
import { resolveTransportFetch, transportKindOf, TransportUnavailableError } from '@/lib/integrations/transports'
import { closeWindowsTransportPools, createWindowsTransport } from '@/lib/integrations/windows-auth/transport'
import { registerSpnegoProvider } from '@/lib/integrations/windows-auth/kerberos'
import type { WindowsAuthConfig } from '@/lib/integrations/windows-auth/config'
import { makeTestCertificates, startMockNtlmServer, type MockNtlmServer } from './helpers/windows-auth-mock'

const TLS = makeTestCertificates()
const auth = (over: Partial<WindowsAuthConfig> = {}): WindowsAuthConfig => ({
  mode: 'ntlm', username: 'CONTOSO\\svc', password: 'S3cret!', spn: null, ca_bundle: null, proxy_url: null, ...over,
})

let servers: MockNtlmServer[] = []
async function server(opts: Parameters<typeof startMockNtlmServer>[0] = {}) {
  const s = await startMockNtlmServer(opts)
  servers.push(s)
  return s
}

const previousEgress = process.env.ALLOW_PRIVATE_EGRESS
beforeEach(() => { process.env.ALLOW_PRIVATE_EGRESS = 'true' })
afterEach(async () => {
  closeWindowsTransportPools()
  registerSpnegoProvider(null)
  await Promise.all(servers.map((s) => s.close()))
  servers = []
})
afterAll(() => {
  if (previousEgress === undefined) delete process.env.ALLOW_PRIVATE_EGRESS
  else process.env.ALLOW_PRIVATE_EGRESS = previousEgress
})

describe('Windows auth transport (NTLMv2 against a mock server)', () => {
  it('authenticates a GET and reuses the authenticated connection', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    const r1 = await f(`${s.url}/echo?x=1`)
    expect(r1.status).toBe(200)
    const j1 = await r1.json()
    const r2 = await f(`${s.url}/echo?x=2`)
    const j2 = await r2.json()
    expect(j2.socket).toBe(j1.socket)
    expect(s.stats.handshakes).toBe(1)
    // The second request carried no Authorization header: the socket was already authenticated.
    expect(s.stats.requests.at(-1)?.auth).toBeNull()
    expect(s.stats.failures).toEqual([])
  })

  it('accepts a UPN and Unicode credentials', async () => {
    const s = await server({ user: 'sváç@contoso.com', domain: '', password: 'Pässwörd€' })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ username: 'sváç@contoso.com', password: 'Pässwörd€' }) })
    expect((await f(`${s.url}/echo`)).status).toBe(200)
    expect(s.stats.failures).toEqual([])
  })

  it('returns the 401 for a wrong password', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ password: 'wrong' }) })
    const r = await f(`${s.url}/echo`)
    expect(r.status).toBe(401)
    await r.text()
    expect(s.stats.failures).toContain('bad credentials')
  })

  it('re-handshakes after the server drops the connection', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await (await f(`${s.url}/echo`)).text()
    s.dropConnections()
    await new Promise((r) => setTimeout(r, 20))
    const r = await f(`${s.url}/echo`)
    expect(r.status).toBe(200)
    await r.text()
    expect(s.stats.handshakes).toBe(2)
  })

  it('keeps parallel requests on separate authenticated connections (one handshake each)', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth(), maxConnections: 3 })
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => f(`${s.url}/echo?i=${i}`).then((r) => r.json())))
    expect(new Set(results.map((r) => r.socket)).size).toBeLessThanOrEqual(3)
    expect(s.stats.handshakes).toBe(new Set(results.map((r) => r.socket)).size)
    expect(s.stats.failures).toEqual([])
  })

  it('POST: handshake with an empty body, the body goes once with AUTHENTICATE', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    const payload = JSON.stringify({ Title: 'x'.repeat(5000) })
    const r = await f(`${s.url}/items`, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json' } })
    const j = await r.json()
    expect(j.bodyBytes).toBe(payload.length)
    const legs = s.stats.requests.filter((q) => q.path === '/items')
    expect(legs.map((q) => [q.auth, q.bodyBytes])).toEqual([['NTLM', 0], ['NTLM', payload.length]])
    expect(s.stats.failures).toEqual([])
  })

  it('replays a buffered body after losing the authenticated connection', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await (await f(`${s.url}/echo`)).text()
    s.dropConnections()
    await new Promise((r) => setTimeout(r, 20))
    const r = await f(`${s.url}/items`, { method: 'PUT', body: new Uint8Array([1, 2, 3, 4]) })
    expect((await r.json()).bodyBytes).toBe(4)
  })

  it('streams a large upload once, only after the challenge', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await (await f(`${s.url}/echo`)).text() // the slot is authenticated; streams still handshake first
    const chunk = Buffer.alloc(64 * 1024, 0x61)
    const stream = Readable.toWeb(Readable.from((function* () { for (let i = 0; i < 32; i++) yield chunk })())) as unknown as ReadableStream
    const r = await f(`${s.url}/upload`, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect((await r.json()).bodyBytes).toBe(32 * chunk.length)
    const legs = s.stats.requests.filter((q) => q.path === '/upload')
    expect(legs.map((q) => q.bodyBytes)).toEqual([0, 32 * chunk.length])
  })

  it('switches to the Negotiate scheme when the server offers only Negotiate', async () => {
    const s = await server({ schemes: ['Negotiate'] })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    expect((await f(`${s.url}/echo`)).status).toBe(200)
    expect(s.stats.requests.filter((q) => q.auth).map((q) => q.auth)).toEqual(['NTLM', 'Negotiate', 'Negotiate'])
  })

  it('fails clearly when the server breaks connection affinity', async () => {
    const s = await server({ closeAfterChallenge: true })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await expect(f(`${s.url}/echo`)).rejects.toThrow(/keep-alive/)
  })

  it('negotiate mode falls back to NTLM when no Kerberos provider is available', async () => {
    const s = await server()
    registerSpnegoProvider({ name: 'none', initContext: async () => { throw new Error('no credentials cache') } })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ mode: 'negotiate' }) })
    expect((await f(`${s.url}/echo`)).status).toBe(200)
    expect(s.stats.handshakes).toBe(1)
  })

  it('kerberos mode fails with an actionable error when Kerberos is unavailable', async () => {
    const s = await server()
    registerSpnegoProvider({ name: 'none', initContext: async () => { throw new Error('No Kerberos credentials available') } })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ mode: 'kerberos' }) })
    await expect(f(`${s.url}/echo`)).rejects.toThrow(/KRB5_CLIENT_KTNAME/)
    expect(s.stats.requests).toEqual([])
  })

  it('kerberos mode sends the SPNEGO token for HTTP/<host> (or the SPN override) and verifies mutual auth', async () => {
    const http = await import('node:http')
    const seen: string[] = []
    const srv = http.createServer((req, res) => {
      seen.push(String(req.headers.authorization))
      if (req.headers.authorization === 'Negotiate a3JiLXRva2Vu') {
        res.writeHead(200, { 'WWW-Authenticate': 'Negotiate bXV0dWFs', 'Content-Length': '2' })
        return res.end('ok')
      }
      res.writeHead(401, { 'WWW-Authenticate': 'Negotiate', 'Content-Length': '0' }); res.end()
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    const spns: string[] = []
    const verified: string[] = []
    registerSpnegoProvider({
      name: 'fake',
      initContext: async (spn) => {
        spns.push(spn)
        return { step: async () => 'a3JiLXRva2Vu', verify: async (t) => { verified.push(t) } }
      },
    })
    try {
      const f = createWindowsTransport({ baseUrl: `http://127.0.0.1:${port}`, auth: auth({ mode: 'kerberos', spn: 'HTTP/sp.contoso.com' }) })
      const r = await f(`http://127.0.0.1:${port}/x`)
      expect(r.status).toBe(200)
      expect(await r.text()).toBe('ok')
      expect(spns).toEqual(['HTTP/sp.contoso.com'])
      expect(verified).toEqual(['bXV0dWFs'])
      expect(seen).toEqual(['Negotiate a3JiLXRva2Vu'])
    } finally {
      closeWindowsTransportPools()
      await new Promise<void>((r) => srv.close(() => r()))
    }
  })

  it('does not send Windows credentials to another origin; credential headers are stripped', async () => {
    const target = await server()
    const other = await server()
    const f = createWindowsTransport({ baseUrl: target.url, auth: auth() })
    const r = await f(`${other.url}/echo`, { headers: { Authorization: 'Bearer leak', Cookie: 'a=b', 'X-Other': 'ok' } })
    expect(r.status).toBe(401)
    await r.text()
    expect(other.stats.requests).toHaveLength(1)
    expect(other.stats.requests[0].auth).toBeNull()
    expect(other.stats.type1).toBe(0)
  })

  it('through connectorFetch: same-origin redirects stay authenticated, cross-origin redirects carry nothing', async () => {
    const target = await server()
    const other = await server()
    const fetchImpl = createWindowsTransport({ baseUrl: target.url, auth: auth() })
    const same = await connectorFetch(`${target.url}/redirect-same`, {}, { fetchImpl })
    expect(same.status).toBe(200)
    expect((await same.json()).query).toBe('?after=redirect')
    const cross = await connectorFetch(`${target.url}/redirect-cross?to=${encodeURIComponent(`${other.url}/echo`)}`, {}, { fetchImpl })
    expect(cross.status).toBe(401)
    await cross.text()
    expect(other.stats.requests.every((q) => q.auth === null)).toBe(true)
    expect(other.stats.type1 + other.stats.type3).toBe(0)
  })

  it('through connectorFetch: the egress guard still blocks private targets by default', async () => {
    const s = await server()
    delete process.env.ALLOW_PRIVATE_EGRESS
    const fetchImpl = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await expect(connectorFetch(`${s.url}/echo`, {}, { fetchImpl })).rejects.toMatchObject({ name: 'EgressBlockedError' })
    expect(s.stats.requests).toEqual([])
  })

  it('checks DNS answers at connect time (localhost is private)', async () => {
    const s = await server()
    delete process.env.ALLOW_PRIVATE_EGRESS
    const url = s.url.replace('127.0.0.1', 'localhost')
    const f = createWindowsTransport({ baseUrl: url, auth: auth() })
    await expect(f(`${url}/echo`)).rejects.toMatchObject({ name: 'EgressBlockedError' })
    expect(s.stats.requests).toEqual([])
  })

  it('refuses a proxy on a blocked address', async () => {
    const s = await server()
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ proxy_url: 'http://169.254.169.254:3128' }) })
    await expect(f(`${s.url}/echo`)).rejects.toMatchObject({ name: 'EgressBlockedError' })
  })

  it('tunnels through an HTTP CONNECT proxy and keeps NTLM affinity', async () => {
    const s = await server()
    const net = await import('node:net')
    const http = await import('node:http')
    const tunnels: string[] = []
    const proxy = http.createServer()
    proxy.on('connect', (req, client, head) => {
      tunnels.push(String(req.url))
      const [host, port] = String(req.url).split(':')
      const upstream = net.connect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.write(head)
        upstream.pipe(client); client.pipe(upstream)
      })
      upstream.on('error', () => client.destroy())
    })
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()))
    try {
      const port = (proxy.address() as { port: number }).port
      const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ proxy_url: `http://127.0.0.1:${port}` }) })
      for (let i = 0; i < 2; i++) {
        const r = await f(`${s.url}/echo`)
        expect(r.status).toBe(200)
        await r.text()
      }
      expect(tunnels).toHaveLength(1)
      expect(s.stats.handshakes).toBe(1)
    } finally {
      closeWindowsTransportPools()
      await new Promise<void>((r) => proxy.close(() => r()))
    }
  })
})

describe.skipIf(!TLS)('Windows auth transport over HTTPS', () => {
  it('trusts the connection CA bundle and sends a matching channel binding (EPA)', async () => {
    const s = await server({ tls: { key: TLS!.key, cert: TLS!.cert }, requireCbt: true })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth({ ca_bundle: TLS!.caPem }) })
    const r = await f(`${s.url}/echo`)
    expect(r.status).toBe(200)
    await r.text()
    expect(s.stats.failures).toEqual([])
  })

  it('rejects an untrusted certificate without a CA bundle (no "allow self-signed")', async () => {
    const s = await server({ tls: { key: TLS!.key, cert: TLS!.cert } })
    const f = createWindowsTransport({ baseUrl: s.url, auth: auth() })
    await expect(f(`${s.url}/echo`)).rejects.toThrow(/certificate/i)
  })
})

describe('transport hook wiring', () => {
  it('auth_type windows selects the windows transport; an explicit _transport wins', () => {
    expect(transportKindOf({ auth_type: 'windows', auth_config: {} })).toBe('windows')
    expect(transportKindOf({ auth_type: 'windows', auth_config: { _transport: 'ext.sp.s2s' } })).toBe('ext.sp.s2s')
    expect(transportKindOf({ auth_type: 'basic', auth_config: {} })).toBeNull()
  })

  it('a misconfigured windows connection fails instead of sending a plain request', async () => {
    await expect(resolveTransportFetch({ tenantId: null, integrationConfig: { base_url: 'https://sp.contoso.com', auth_type: 'windows', auth_config: { username: '' } } }))
      .rejects.toBeInstanceOf(TransportUnavailableError)
    await expect(resolveTransportFetch({ tenantId: null, integrationConfig: { base_url: 'https://sp.contoso.com', auth_type: 'windows', auth_config: { username: 'a\\b', password: 'enc:v1:abc' } } }))
      .rejects.toThrow(/decrypted/)
    await expect(resolveTransportFetch({ tenantId: null, integrationConfig: { auth_type: 'none', auth_config: { _transport: 'constructor' } } }))
      .rejects.toBeInstanceOf(TransportUnavailableError)
  })

  it('a configured windows connection resolves to a working fetch', async () => {
    const s = await server()
    const f = await resolveTransportFetch({ tenantId: null, integrationConfig: { base_url: s.url, auth_type: 'windows', auth_config: { mode: 'ntlm', username: 'CONTOSO\\svc', password: 'S3cret!' } } })
    expect(f).toBeTypeOf('function')
    const r = await connectorFetch(`${s.url}/echo`, {}, { fetchImpl: f })
    expect(r.status).toBe(200)
    await r.text()
  })
})
