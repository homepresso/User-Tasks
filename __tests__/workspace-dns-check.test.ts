import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpCheck, runWorkspaceDnsChecks, withTimeout, type DnsCheck, type DnsCheckDeps, type WorkspaceDnsReport } from '@/lib/workspace-dns-check'

/**
 * Settings → Workspace DNS checks (lib/workspace-dns-check): each check's
 * pass / fail / timeout, provider detection through the nameservers, and the
 * SSRF rule (only names under the configured base domain are ever looked up).
 */

function notFound(host: string): Error {
  return Object.assign(new Error(`queryA ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
}

interface Zone {
  a?: Record<string, string[]>
  cname?: Record<string, string[]>
  ns?: Record<string, string[]>
}

const okCert = { authorized: true, subject: '*.usertasks.com', issuer: "Let's Encrypt", validTo: 'Feb  1 00:00:00 2027 GMT', altNames: 'DNS:*.usertasks.com, DNS:usertasks.com' }

function appResponse(status = 404, headers: Record<string, string> = { 'content-security-policy': "default-src 'self'" }) {
  return new Response('x', { status, headers })
}

function deps(zone: Zone, overrides: Partial<DnsCheckDeps> = {}): DnsCheckDeps & { lookups: string[] } {
  const lookups: string[] = []
  const look = (table: Record<string, string[]> | undefined) => async (host: string) => {
    lookups.push(host)
    const hit = table?.[host] ?? (host.startsWith('ut-check-') ? table?.[host.replace(/^ut-check-[^.]+/, '*')] : undefined)
    if (!hit) throw notFound(host)
    return hit
  }
  return {
    lookups,
    resolve4: look(zone.a),
    resolve6: async (host) => { lookups.push(host); throw notFound(host) },
    resolveCname: look(zone.cname),
    resolveNs: look(zone.ns),
    tlsProbe: async () => okCert,
    fetch: (async () => appResponse()) as unknown as typeof fetch,
    randomLabel: () => 'ut-check-abcd1234',
    ...overrides,
  }
}

const VERCEL_WORKING: Zone = {
  a: { 'usertasks.com': ['76.76.21.21'], '*.usertasks.com': ['76.76.21.98'] },
  cname: { '*.usertasks.com': ['cname.vercel-dns.com'] },
  ns: { 'usertasks.com': ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'] },
}

const byId = (report: WorkspaceDnsReport) => Object.fromEntries(report.checks.map((c) => [c.id, c])) as Record<DnsCheck['id'], DnsCheck>

describe('runWorkspaceDnsChecks', () => {
  afterEach(() => { vi.useRealTimers() })

  it('passes everything for a working Vercel wildcard', async () => {
    const report = await runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', appUrl: 'https://usertasks.com', hosting: 'vercel' }, deps(VERCEL_WORKING))
    const c = byId(report)
    expect(report.probeHost).toBe('ut-check-abcd1234.usertasks.com')
    expect(report.provider).toBe('vercel')
    expect(report.zone).toBe('usertasks.com')
    expect(c.wildcard.status).toBe('pass')
    expect(c.wildcard.values).toEqual(['CNAME cname.vercel-dns.com', '76.76.21.98'])
    expect(c.apex.status).toBe('pass')
    expect(c.nameservers.status).toBe('pass')
    expect(c.acme.status).toBe('skip') // not needed on Vercel nameservers
    expect(c.tls.status).toBe('pass')
    expect(c.tls.values?.join(' ')).toContain("Let's Encrypt")
    expect(c.http.status).toBe('pass')
  })

  it('fails the wildcard (and skips TLS / HTTP) on GoDaddy without records, and warns about _acme-challenge', async () => {
    const zone: Zone = { a: { 'usertasks.com': ['76.76.21.21'] }, ns: { 'usertasks.com': ['ns51.domaincontrol.com', 'ns52.domaincontrol.com'] } }
    const tlsProbe = vi.fn()
    const report = await runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', appUrl: 'https://usertasks.com', hosting: 'vercel' }, deps(zone, { tlsProbe }))
    const c = byId(report)
    expect(report.provider).toBe('godaddy')
    expect(c.wildcard.status).toBe('fail')
    expect(c.wildcard.detail).toContain('ENOTFOUND')
    expect(c.acme.status).toBe('warn')
    expect(c.tls.status).toBe('skip')
    expect(c.http.status).toBe('skip')
    expect(tlsProbe).not.toHaveBeenCalled()
  })

  it('passes _acme-challenge when delegated to Vercel (GoDaddy option B)', async () => {
    const zone: Zone = {
      ...VERCEL_WORKING,
      ns: { 'usertasks.com': ['ns51.domaincontrol.com', 'ns52.domaincontrol.com'], '_acme-challenge.usertasks.com': ['ns1.vercel-dns.com.', 'ns2.vercel-dns.com.'] },
    }
    const c = byId(await runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', appUrl: 'https://usertasks.com', hosting: 'vercel' }, deps(zone)))
    expect(c.acme.status).toBe('pass')
    expect(c.acme.detail).toContain('delegated to Vercel')
  })

  it('reports an invalid certificate as a failed check with its error and details', async () => {
    const tlsProbe = async () => ({ authorized: false, authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID', subject: 'usertasks.com', issuer: "Let's Encrypt" })
    const c = byId(await runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', hosting: 'vercel' }, deps(VERCEL_WORKING, { tlsProbe })))
    expect(c.tls.status).toBe('fail')
    expect(c.tls.detail).toContain('ERR_TLS_CERT_ALTNAME_INVALID')
    expect(c.tls.values).toContain('Subject: usertasks.com')
  })

  it('turns TLS errors, HTTP errors and DNS timeouts into failed checks without throwing', async () => {
    vi.useFakeTimers()
    const hang = () => new Promise<never>(() => undefined)
    const run = runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', hosting: 'vercel' }, deps(VERCEL_WORKING, {
      tlsProbe: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) },
      fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch,
      resolveNs: hang,
    }))
    await vi.advanceTimersByTimeAsync(30_000)
    const report = await run
    const c = byId(report)
    expect(c.nameservers.status).toBe('warn')
    expect(c.nameservers.detail).toMatch(/timed out after 4 s/)
    expect(report.provider).toBe('unknown')
    expect(c.acme.status).toBe('warn')
    expect(c.tls.status).toBe('fail')
    expect(c.tls.detail).toContain('ECONNREFUSED')
    expect(c.http.status).toBe('fail')
    expect(c.http.detail).toContain('fetch failed')
  })

  it('times out a hanging TLS handshake', async () => {
    vi.useFakeTimers()
    const run = runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', hosting: 'vercel' }, deps(VERCEL_WORKING, { tlsProbe: () => new Promise<never>(() => undefined) }))
    await vi.advanceTimersByTimeAsync(30_000)
    const c = byId(await run)
    expect(c.tls.status).toBe('fail')
    expect(c.tls.detail).toMatch(/timed out/)
  })

  it('fetches the probe host with redirect: manual and finds the zone of a sub-domain base', async () => {
    const fetchMock = vi.fn(async () => appResponse(307))
    const zone: Zone = {
      a: { 'tasks.example.com': ['203.0.113.10'], '*.tasks.example.com': ['203.0.113.10'] },
      ns: { 'example.com': ['ns-1.awsdns-01.org', 'ns-2.awsdns-02.com'] },
    }
    const d = deps(zone, { fetch: fetchMock as unknown as typeof fetch })
    const report = await runWorkspaceDnsChecks({ baseDomain: 'tasks.example.com', appUrl: 'https://tasks.example.com', hosting: 'self_hosted' }, d)
    expect(report.zone).toBe('example.com')
    expect(report.provider).toBe('route53')
    expect(report.apexAddresses.v4).toEqual(['203.0.113.10'])
    expect(byId(report).http.status).toBe('pass')
    expect(byId(report).acme.status).toBe('skip') // self-hosted: tooling with zone API access is fine
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ut-check-abcd1234.tasks.example.com/')
    expect(init.redirect).toBe('manual')
  })

  it('only ever looks up names under the configured base domain (SSRF), even with a hostile random label', async () => {
    const d = deps(VERCEL_WORKING, { randomLabel: () => 'evil.internal.example.net#' })
    const report = await runWorkspaceDnsChecks({ baseDomain: 'usertasks.com', hosting: 'vercel' }, d)
    expect(report.probeHost).toBe('ut-check-probe.usertasks.com')
    for (const host of d.lookups) expect(host === 'usertasks.com' || host.endsWith('.usertasks.com') || host === 'com').toBe(true)
  })

  it('skips the network for local development and reports addresses off without a base domain', async () => {
    const d = deps({})
    const local = await runWorkspaceDnsChecks({ baseDomain: 'localhost', appUrl: 'http://localhost:3000', hosting: 'self_hosted' }, d)
    expect(local.enabled).toBe(true)
    expect(byId(local).wildcard.status).toBe('skip')
    expect(byId(local).wildcard.detail).toContain('http://<workspace>.localhost:3000')
    const off = await runWorkspaceDnsChecks({ baseDomain: null, hosting: 'self_hosted' }, d)
    expect(off.enabled).toBe(false)
    expect(off.checks).toHaveLength(1)
    expect(off.checks[0].status).toBe('fail')
    expect(d.lookups).toEqual([])
  })

  it('skips the certificate on a plain-http app URL', async () => {
    const c = byId(await runWorkspaceDnsChecks({ baseDomain: 'example.test', appUrl: 'http://example.test:8080', hosting: 'self_hosted' }, deps({
      a: { 'example.test': ['10.0.0.1'], '*.example.test': ['10.0.0.1'] },
      ns: { 'example.test': ['ns1.example.net'] },
    })))
    expect(c.tls.status).toBe('skip')
    expect(c.nameservers.detail).toContain('Another DNS provider')
  })
})

describe('httpCheck', () => {
  const url = 'https://ut-check-x.usertasks.com/'
  it('passes a 404 / 200 / 30x from the app (its CSP header)', () => {
    expect(httpCheck(appResponse(404), url).status).toBe('pass')
    expect(httpCheck(appResponse(200), url).status).toBe('pass')
    expect(httpCheck(appResponse(308), url).status).toBe('pass')
  })
  it('fails Vercel\'s own error and 5xx, warns for a foreign server', () => {
    expect(httpCheck(appResponse(404, { 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' }), url).status).toBe('fail')
    expect(httpCheck(appResponse(502), url).status).toBe('fail')
    expect(httpCheck(appResponse(200, {}), url).status).toBe('warn')
    expect(httpCheck(appResponse(403), url).status).toBe('warn')
  })
})

describe('withTimeout', () => {
  it('resolves fast promises and rejects slow ones with a message', async () => {
    await expect(withTimeout(Promise.resolve(1), 50, 'x')).resolves.toBe(1)
    await expect(withTimeout(new Promise(() => undefined), 10, 'Lookup')).rejects.toThrow('Lookup timed out')
  })
})
