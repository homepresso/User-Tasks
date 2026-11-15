import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConfigError, parseConfig, sourceAllowed, type GatewayConfig } from '../src/config'
import { checkJob, executeJob, JobRefused } from '../src/executor'
import { assertSafeEgressHost, assertSafeResolvedAddress, setGatewayEgressAllowlist } from '../src/egress-shim'
import { BODY_PART_BYTES, sha256Hex, type GatewayJob } from '../../../lib/gateway/protocol'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utgw-test-'))
const file = path.join(dir, 'gateway.json')

function config(extra: Record<string, unknown> = {}): GatewayConfig {
  process.env.UTGW_TEST_PW = 'pw-from-env'
  return parseConfig({
    cloudUrl: 'https://acme.usertasks.com',
    stateDir: dir,
    targets: [
      { id: 'sharepoint', url: 'http://spsites', auth: { type: 'windows', mode: 'ntlm', username: 'CONTOSO\\svc', passwordEnv: 'UTGW_TEST_PW' }, pathPrefixes: ['/sites/finance/'] },
      { id: 'hightrust', url: 'https://sp.contoso.com', auth: { type: 'none' }, forwardAuthorization: true, methods: ['GET', 'POST'] },
    ],
    ...extra,
  }, file)
}

function job(over: Partial<GatewayJob> = {}): GatewayJob {
  return { v: 1, id: 'j1', gatewayId: 'g', target: 'sharepoint', method: 'GET', path: '/sites/finance/_api/web', headers: {}, body: null, anonymous: false, issuedAt: Date.now(), expiresAt: Date.now() + 60_000, attempt: 1, ...over }
}

describe('gateway configuration', () => {
  it('parses targets with secrets from the environment, never from the file', () => {
    const c = config()
    expect(c.targets.map((t) => [t.id, t.origin])).toEqual([['sharepoint', 'http://spsites'], ['hightrust', 'https://sp.contoso.com']])
    expect(c.targets[0].auth).toMatchObject({ type: 'windows', username: 'CONTOSO\\svc', password: 'pw-from-env' })
    expect(() => parseConfig({ cloudUrl: 'https://a.usertasks.com', targets: [{ id: 'x', url: 'http://h', auth: { type: 'windows', username: 'a\\b', password: 'inline' } }] }, file)).toThrow(/passwordEnv or passwordFile/)
  })

  it('requires https to the cloud, origin-only target URLs and valid ids', () => {
    expect(() => config({ cloudUrl: 'http://acme.usertasks.com' })).toThrow(ConfigError)
    expect(() => parseConfig({ cloudUrl: 'https://a.usertasks.com', targets: [{ id: 'x', url: 'http://h/sites/a' }] }, file)).toThrow(/origin/)
    expect(() => parseConfig({ cloudUrl: 'https://a.usertasks.com', targets: [{ id: 'Bad', url: 'http://h' }] }, file)).toThrow(/id/)
    expect(() => parseConfig({ cloudUrl: 'https://a.usertasks.com', targets: [] }, file)).toThrow(/at least one target/)
  })

  it('relay: TLS or an explicit allowHttp, /ext-public/ prefixes only, source CIDRs', () => {
    expect(() => config({ relay: { listen: '0.0.0.0:8443', publicUrl: 'http://gw:8443' } })).toThrow(/tls/)
    expect(() => config({ relay: { listen: '0.0.0.0:8443', allowHttp: true, publicUrl: 'http://gw:8443', pathPrefixes: ['/api/'] } })).toThrow(/ext-public/)
    const c = config({ relay: { listen: '0.0.0.0:8443', allowHttp: true, publicUrl: 'http://gw:8443', allowSources: ['10.1.0.0/16', '::1'] } })
    expect(sourceAllowed('10.1.2.3', c.relay!.allowSources)).toBe(true)
    expect(sourceAllowed('::ffff:10.1.2.3', c.relay!.allowSources)).toBe(true)
    expect(sourceAllowed('10.2.0.1', c.relay!.allowSources)).toBe(false)
    expect(sourceAllowed('::1', c.relay!.allowSources)).toBe(true)
  })
})

describe('job checks (the gateway is never a general proxy)', () => {
  const c = config()
  it('accepts a job for a configured target under its prefixes', () => {
    expect(checkJob(c, job()).url.href).toBe('http://spsites/sites/finance/_api/web')
  })

  it.each([
    [{ target: 'other' }, 'target_not_allowed'],
    [{ path: '//evil.example/x' }, 'path_not_allowed'],
    [{ path: 'http://evil.example/' }, 'path_not_allowed'],
    [{ path: '/sites/hr/_api/web' }, 'path_not_allowed'],
    [{ path: '/sites/finance/../hr/_api/web' }, 'path_not_allowed'],
    [{ target: 'hightrust', path: '/x', method: 'DELETE' as const }, 'method_not_allowed'],
    [{ expiresAt: Date.now() - 1 }, 'gateway_timeout'],
    [{ v: 2 as unknown as 1 }, 'unsupported_job'],
  ])('refuses %o', (over, code) => {
    try {
      checkJob(c, job(over as Partial<GatewayJob>))
      throw new Error('accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(JobRefused)
      expect((error as JobRefused).code).toBe(code)
    }
  })
})

describe('executing a job', () => {
  const c = config()
  const calls: Array<{ url: string; init: RequestInit; anonymous: boolean }> = []
  const deps = (answer: () => Response) => ({
    parts: [] as Array<{ n: number; size: number }>,
    requestPart: async () => Buffer.alloc(0),
    async responsePart(_id: string, n: number, data: Buffer) { this.parts.push({ n, size: data.length }) },
    fetchFor: (_t: unknown, anonymous: boolean) => (async (url: string, init: RequestInit) => { calls.push({ url, init, anonymous }); return answer() }) as unknown as typeof fetch,
  })
  beforeEach(() => { calls.length = 0 })

  it('strips the cloud\'s Authorization unless the target forwards it, never follows redirects', async () => {
    const d = deps(() => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=y' } }))
    const out = await executeJob(c, job({ headers: { authorization: 'Bearer cloud', accept: 'application/json', 'accept-encoding': 'gzip' } }), d)
    expect(calls[0].anonymous).toBe(false)
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[0].init.headers).toEqual({ accept: 'application/json' })
    expect(out.result.status).toBe(200)
    expect(out.result.headers['set-cookie']).toBeUndefined()
    expect(Buffer.from(out.result.body!.inline!, 'base64').toString()).toBe('{"ok":true}')

    await executeJob(c, job({ target: 'hightrust', path: '/_api/web', headers: { authorization: 'Bearer s2s' } }), d)
    expect(calls[1].init.headers).toEqual({ authorization: 'Bearer s2s' })
    expect(calls[1].anonymous).toBe(true)
  })

  it('runs anonymous jobs without the target credentials', async () => {
    const d = deps(() => new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer realm="abc"' } }))
    const out = await executeJob(c, job({ anonymous: true }), d)
    expect(calls[0].anonymous).toBe(true)
    expect(out.result.headers['www-authenticate']).toContain('realm')
  })

  it('uploads large answers in parts with a checksum, refuses answers over the limit', async () => {
    const big = Buffer.alloc(BODY_PART_BYTES + 100, 1)
    const d = deps(() => new Response(new Uint8Array(big), { status: 200 }))
    const out = await executeJob(c, job(), d)
    expect(out.result.body).toEqual({ parts: 2, size: big.length, sha256: sha256Hex(big) })
    expect(d.parts.map((p) => p.size)).toEqual([BODY_PART_BYTES, 100])
    const small = { ...c, maxResponseBytes: 10 }
    await expect(executeJob(small, job(), deps(() => new Response('01234567890123', { status: 200 })))).rejects.toMatchObject({ code: 'payload_too_large' })
  })

  it('verifies request body checksums', async () => {
    const body = Buffer.from('{"Title":"x"}')
    const d = deps(() => new Response(null, { status: 204 }))
    await executeJob(c, job({ method: 'POST', body: { inline: body.toString('base64'), size: body.length, sha256: sha256Hex(body) } }), d)
    expect(Buffer.from(calls[0].init.body as Uint8Array).toString()).toBe('{"Title":"x"}')
    await expect(executeJob(c, job({ method: 'POST', body: { inline: body.toString('base64'), size: body.length, sha256: '0'.repeat(64) } }), d)).rejects.toMatchObject({ code: 'corrupt_body' })
  })
})

describe('egress allowlist on the customer network', () => {
  afterEach(() => setGatewayEgressAllowlist([]))
  it('dials only configured hosts, never link-local metadata', async () => {
    setGatewayEgressAllowlist(['spsites', 'proxy.contoso.com'])
    await expect(assertSafeEgressHost('spsites')).resolves.toBeTruthy()
    await expect(assertSafeEgressHost('dc.contoso.local')).rejects.toThrow(/not a target/)
    expect(() => assertSafeResolvedAddress('spsites', '10.1.1.5')).not.toThrow()
    expect(() => assertSafeResolvedAddress('spsites', '169.254.169.254')).toThrow(/link-local/)
    expect(() => assertSafeResolvedAddress('sql', '10.1.1.6')).toThrow(/not a target/)
  })
})
