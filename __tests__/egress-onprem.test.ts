import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * On-premises egress: the private-network allowlist (EGRESS_PRIVATE_ALLOW),
 * the plain-http opt-in (EGRESS_HTTP_ALLOW), cloud-mode no-op, metadata
 * always blocked, connect-time (DNS rebinding) checks, and the outbound
 * calls that used to bypass the guard.
 */

// DNS answers: the guard's check (node:dns/promises) and the connect-time
// lookup (node:dns, used by the guarded transport) are separate, so a test can
// make them disagree the way a rebinding name does.
const checkAnswers = new Map<string, string[]>()
const connectAnswers = new Map<string, string[]>()

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  const lookup = async (host: string) => {
    const answers = checkAnswers.get(host.toLowerCase())
    if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
    return answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
  return { ...actual, lookup, default: { ...actual, lookup } }
})

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  const lookup = (host: string, opts: unknown, cb?: (...args: unknown[]) => void) => {
    const callback = (typeof opts === 'function' ? opts : cb) as (...args: unknown[]) => void
    const answers = connectAnswers.get(host.toLowerCase()) ?? checkAnswers.get(host.toLowerCase())
    if (!answers) return callback(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' }), [])
    callback(null, answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })))
  }
  return { ...actual, lookup, default: { ...actual, lookup } }
})

const ENV_KEYS = ['EGRESS_PRIVATE_ALLOW', 'EGRESS_HTTP_ALLOW', 'ALLOW_PRIVATE_EGRESS', 'DEPLOYMENT_MODE'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key] }
  checkAnswers.clear()
  connectAnswers.clear()
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  vi.unstubAllGlobals()
})

describe('allowlist parsing and matching', () => {
  it('parses hostnames, wildcards, CIDRs and bare addresses; rejects bad entries with a reason', async () => {
    const { parseEgressList } = await import('@/lib/egress-policy')
    const { rules, errors } = parseEgressList('spsites, *.Contoso.local 10.0.0.0/8;fd00:1234::/32 10.1.2.3 2001:db8::1 spsites')
    expect(rules.map((r) => r.text)).toEqual(['spsites', '*.contoso.local', '10.0.0.0/8', 'fd00:1234::/32', '10.1.2.3', '2001:db8::1'])
    expect(rules.find((r) => r.text === '10.1.2.3')).toMatchObject({ kind: 'cidr', prefix: 32 })
    expect(rules.find((r) => r.text === '2001:db8::1')).toMatchObject({ kind: 'cidr', family: 6, prefix: 128 })
    expect(errors).toEqual([])

    const bad = parseEgressList(['*contoso.local', 'sp.*.local', '*.local', '10.0.0.0/33', '0.0.0.0/0', '::/0', 'a..b', 'http://spsites', '10.0.0.0/x']).errors
    expect(bad).toHaveLength(9)
    expect(bad.join('\n')).toMatch(/too broad.*ALLOW_PRIVATE_EGRESS/)
  })

  it('hostnames: exact (case-insensitive) and *.suffix (subdomains only)', async () => {
    const { hostMatchesRules, parseEgressList } = await import('@/lib/egress-policy')
    const { rules } = parseEgressList('spsites,*.contoso.local')
    expect(hostMatchesRules('SPSITES', rules)).toBe(true)
    expect(hostMatchesRules('spsites.', rules)).toBe(true)
    expect(hostMatchesRules('spsites.evil.com', rules)).toBe(false)
    expect(hostMatchesRules('sp.contoso.local', rules)).toBe(true)
    expect(hostMatchesRules('a.b.contoso.local', rules)).toBe(true)
    expect(hostMatchesRules('contoso.local', rules)).toBe(false)
    expect(hostMatchesRules('evilcontoso.local', rules)).toBe(false)
  })

  it('CIDRs: IPv4, IPv6 and IPv4-mapped IPv6', async () => {
    const { addressInRules, parseEgressList } = await import('@/lib/egress-policy')
    const { rules } = parseEgressList('10.0.0.0/8,192.168.10.0/24,fd00:1234::/32')
    expect(addressInRules('10.20.0.15', rules)).toBe(true)
    expect(addressInRules('11.0.0.1', rules)).toBe(false)
    expect(addressInRules('192.168.10.200', rules)).toBe(true)
    expect(addressInRules('192.168.11.1', rules)).toBe(false)
    expect(addressInRules('::ffff:10.1.2.3', rules)).toBe(true)
    expect(addressInRules('fd00:1234:5::1', rules)).toBe(true)
    expect(addressInRules('fd00:1235::1', rules)).toBe(false)
    expect(addressInRules('fe80::1', rules)).toBe(false)
  })

  it('policy: the environment wins over the setting; the cloud edition ignores both', async () => {
    const { resolveEgressPolicy } = await import('@/lib/egress-policy')
    const settings = new Map<string, unknown>([['instance.egress_private_allow', ['10.0.0.0/8']], ['instance.egress_http_allow', ['spsites']]])
    const fromSetting = resolveEgressPolicy({}, settings)
    expect(fromSetting.privateAllow.map((r) => r.text)).toEqual(['10.0.0.0/8'])
    expect(fromSetting.privateSource).toBe('setting')
    const fromEnv = resolveEgressPolicy({ EGRESS_PRIVATE_ALLOW: '*.contoso.local' }, settings)
    expect(fromEnv.privateAllow.map((r) => r.text)).toEqual(['*.contoso.local'])
    expect(fromEnv.privateSource).toBe('env')
    expect(fromEnv.httpAllow.map((r) => r.text)).toEqual(['spsites'])
    const cloud = resolveEgressPolicy({ DEPLOYMENT_MODE: 'cloud', EGRESS_PRIVATE_ALLOW: '10.0.0.0/8' }, settings)
    expect(cloud.privateAllow).toEqual([])
    expect(cloud.httpAllow).toEqual([])
    expect(cloud.privateSource).toBe('env')
  })

  it('instance setting validation: normalised string lists only', async () => {
    const { validateEgressSetting } = await import('@/lib/egress-policy')
    expect(() => validateEgressSetting('instance.egress_private_allow', ['10.0.0.0/8', '*.contoso.local'])).not.toThrow()
    expect(() => validateEgressSetting('instance.egress_private_allow', '10.0.0.0/8')).toThrow(/list/)
    expect(() => validateEgressSetting('instance.egress_http_allow', ['*bad'])).toThrow(/wildcards/)
    expect(() => validateEgressSetting('instance.egress_http_allow', ['SPSITES'])).toThrow(/store \["spsites"\]/)
    expect(() => validateEgressSetting('instance.fonts_remote', 'anything')).not.toThrow()
  })
})

describe('egress guard with the allowlist', () => {
  it('default: private targets are blocked and the error names the setting', async () => {
    const { assertSafeEgressHost } = await import('@/lib/egress-guard')
    await expect(assertSafeEgressHost('10.0.0.5')).rejects.toThrow(/EGRESS_PRIVATE_ALLOW/)
    checkAnswers.set('spsites', ['10.20.0.15'])
    await expect(assertSafeEgressHost('spsites')).rejects.toThrow(/resolves to a private address \(10\.20\.0\.15\).*EGRESS_PRIVATE_ALLOW/)
    checkAnswers.set('example.com', ['93.184.216.34'])
    await expect(assertSafeEgressHost('example.com')).resolves.toEqual({ private: null })
  })

  it('CIDR entries allow addresses (literal or resolved) inside them', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '10.0.0.0/8,fd00:1234::/32'
    const { assertSafeEgressHost } = await import('@/lib/egress-guard')
    await expect(assertSafeEgressHost('10.0.0.5')).resolves.toEqual({ private: 'allowlist' })
    await expect(assertSafeEgressHost('[fd00:1234::10]')).resolves.toEqual({ private: 'allowlist' })
    await expect(assertSafeEgressHost('192.168.1.1')).rejects.toThrow(/private address/)
    checkAnswers.set('farm.corp', ['10.1.1.1', '10.1.1.2'])
    await expect(assertSafeEgressHost('farm.corp')).resolves.toEqual({ private: 'allowlist' })
    // Every resolved address must be allowed.
    checkAnswers.set('split.corp', ['10.1.1.1', '192.168.5.5'])
    await expect(assertSafeEgressHost('split.corp')).rejects.toThrow(/192\.168\.5\.5/)
  })

  it('hostname entries allow private addresses, but never metadata, loopback or link-local (rebinding)', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '*.contoso.local,spsites'
    const { assertSafeEgressHost } = await import('@/lib/egress-guard')
    checkAnswers.set('sp.contoso.local', ['192.168.1.5'])
    await expect(assertSafeEgressHost('sp.contoso.local')).resolves.toEqual({ private: 'allowlist' })
    checkAnswers.set('spsites', ['169.254.169.254'])
    await expect(assertSafeEgressHost('spsites')).rejects.toThrow(/cloud metadata/)
    checkAnswers.set('spsites', ['127.0.0.1'])
    await expect(assertSafeEgressHost('spsites')).rejects.toThrow(/loopback.*list the address as a CIDR/)
    checkAnswers.set('spsites', ['169.254.10.10'])
    await expect(assertSafeEgressHost('spsites')).rejects.toThrow(/link-local/)
    // Listed but unresolvable: the connection attempt reports it.
    await expect(assertSafeEgressHost('nowhere.contoso.local')).resolves.toEqual({ private: null })
    // Unlisted internal names stay blocked.
    await expect(assertSafeEgressHost('db.other.local')).rejects.toThrow(/internal hostnames are blocked/)
  })

  it('loopback / link-local need an explicit CIDR; metadata stays blocked whatever is listed', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '127.0.0.0/8,169.254.0.0/16,fd00::/8'
    const { assertSafeEgressHost } = await import('@/lib/egress-guard')
    await expect(assertSafeEgressHost('127.0.0.1')).resolves.toEqual({ private: 'allowlist' })
    await expect(assertSafeEgressHost('169.254.10.10')).resolves.toEqual({ private: 'allowlist' })
    for (const target of ['169.254.169.254', '169.254.170.2', '[fd00:ec2::254]', '::ffff:169.254.169.254', 'metadata.google.internal']) {
      await expect(assertSafeEgressHost(target), target).rejects.toThrow(/metadata/)
    }
    checkAnswers.set('imds.example.com', ['::ffff:a9fe:a9fe'])
    await expect(assertSafeEgressHost('imds.example.com')).rejects.toThrow(/metadata/)
  })

  it('cloud edition: the allowlist has no effect', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    process.env.EGRESS_PRIVATE_ALLOW = '10.0.0.0/8,*.corp.example,*.contoso.local'
    const { assertSafeEgressHost, assertSafeResolvedAddress } = await import('@/lib/egress-guard')
    await expect(assertSafeEgressHost('10.0.0.5')).rejects.toThrow(/cloud edition/)
    checkAnswers.set('sp.corp.example', ['10.1.1.1'])
    await expect(assertSafeEgressHost('sp.corp.example')).rejects.toThrow(/private address/)
    await expect(assertSafeEgressHost('sp.contoso.local')).rejects.toThrow(/internal hostnames are blocked/)
    expect(() => assertSafeResolvedAddress('sp.corp.example', '10.1.1.1')).toThrow(/private address/)
  })

  it('ALLOW_PRIVATE_EGRESS=true keeps working (broad), metadata and IPv4 link-local stay blocked', async () => {
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    const { assertSafeEgressHost } = await import('@/lib/egress-guard')
    await expect(assertSafeEgressHost('10.0.0.5')).resolves.toEqual({ private: 'allow_all' })
    await expect(assertSafeEgressHost('127.0.0.1')).resolves.toEqual({ private: 'allow_all' })
    await expect(assertSafeEgressHost('localhost')).resolves.toEqual({ private: null })
    await expect(assertSafeEgressHost('169.254.1.1')).rejects.toThrow(/link-local/)
    await expect(assertSafeEgressHost('169.254.169.254')).rejects.toThrow(/metadata/)
    await expect(assertSafeEgressHost('::ffff:169.254.169.254')).rejects.toThrow(/metadata/)
  })

  it('connect time: assertSafeResolvedAddress applies the same rules to the dialled address', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '*.contoso.local'
    const { assertSafeResolvedAddress } = await import('@/lib/egress-guard')
    expect(() => assertSafeResolvedAddress('sp.contoso.local', '10.1.1.1')).not.toThrow()
    expect(() => assertSafeResolvedAddress('sp.contoso.local', '169.254.169.254')).toThrow(/metadata/)
    expect(() => assertSafeResolvedAddress('sp.contoso.local', '127.0.0.1')).toThrow(/loopback/)
    expect(() => assertSafeResolvedAddress('other.example', '10.1.1.1')).toThrow(/private address/)
  })
})

describe('plain http opt-in (EGRESS_HTTP_ALLOW)', () => {
  it('default: https required except loopback; the error names the setting', async () => {
    const { assertHttpAllowed, httpUrlProblem } = await import('@/lib/egress-guard')
    await expect(assertHttpAllowed('https://spsites/sites/hr')).resolves.toBeUndefined()
    await expect(assertHttpAllowed('http://localhost:8080')).resolves.toBeUndefined()
    await expect(assertHttpAllowed('http://spsites')).rejects.toThrow(/plain http:\/\/ is not allowed for spsites.*EGRESS_HTTP_ALLOW/)
    expect(httpUrlProblem(new URL('http://spsites'))).toMatch(/EGRESS_HTTP_ALLOW/)
  })

  it('listed hostnames, wildcards and CIDRs (literal or resolved) may use http', async () => {
    process.env.EGRESS_HTTP_ALLOW = 'spsites,*.contoso.local,10.0.0.0/8'
    const { assertHttpAllowed, httpUrlProblem } = await import('@/lib/egress-guard')
    await expect(assertHttpAllowed('http://SPSITES/sites/hr')).resolves.toBeUndefined()
    await expect(assertHttpAllowed('http://sp.contoso.local')).resolves.toBeUndefined()
    await expect(assertHttpAllowed('http://10.4.4.4:8080')).resolves.toBeUndefined()
    checkAnswers.set('farm.corp', ['10.2.3.4'])
    await expect(assertHttpAllowed('http://farm.corp')).resolves.toBeUndefined()
    checkAnswers.set('public.example', ['93.184.216.34'])
    await expect(assertHttpAllowed('http://public.example')).rejects.toThrow(/EGRESS_HTTP_ALLOW/)
    // Synchronous form: a name that could match a CIDR after resolution is deferred.
    expect(httpUrlProblem(new URL('http://farm.corp'))).toBeNull()
    expect(httpUrlProblem(new URL('http://192.168.1.1'))).toMatch(/EGRESS_HTTP_ALLOW/)
  })

  it('cloud edition: never', async () => {
    process.env.DEPLOYMENT_MODE = 'cloud'
    process.env.EGRESS_HTTP_ALLOW = 'spsites'
    const { assertHttpAllowed } = await import('@/lib/egress-guard')
    await expect(assertHttpAllowed('http://spsites')).rejects.toThrow(/use https/)
  })

  it('connector base URLs: validateBaseUrl follows the setting', async () => {
    const { validateBaseUrl, assertBaseUrlProtocol } = await import('@/lib/services/integrations')
    expect(() => validateBaseUrl('http://spsites')).toThrow(/EGRESS_HTTP_ALLOW/)
    expect(validateBaseUrl('https://spsites/')).toBe('https://spsites')
    expect(validateBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
    process.env.EGRESS_HTTP_ALLOW = 'spsites'
    expect(validateBaseUrl('http://spsites/')).toBe('http://spsites')
    await expect(assertBaseUrlProtocol('http://spsites')).resolves.toBeUndefined()
    await expect(assertBaseUrlProtocol('http://other')).rejects.toThrow(/EGRESS_HTTP_ALLOW/)
  })

  it('the connection form warns about Basic / Bearer / API keys over http, not Windows auth', async () => {
    const { sendsCredentialsInClear } = await import('@/components/integrations/http-credentials-warning')
    expect(sendsCredentialsInClear('http://spsites', 'basic')).toBe(true)
    expect(sendsCredentialsInClear('http://spsites', 'bearer')).toBe(true)
    expect(sendsCredentialsInClear('http://spsites', 'windows')).toBe(false)
    expect(sendsCredentialsInClear('https://spsites', 'basic')).toBe(false)
    expect(sendsCredentialsInClear('http://localhost:8080', 'basic')).toBe(false)
  })
})

describe('connectorFetch: allowlisted targets are dialled with connect-time checks', () => {
  let server: http.Server
  let port = 0
  const hits: string[] = []
  beforeAll(async () => {
    server = http.createServer((req, res) => { hits.push(`${req.headers.host} ${req.headers.authorization ?? ''}`); res.end('ok') })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('uses the guarded transport (not the platform fetch) and reaches the server', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '*.contoso.local,127.0.0.0/8'
    process.env.EGRESS_HTTP_ALLOW = '*.contoso.local'
    checkAnswers.set('sp.contoso.local', ['127.0.0.1'])
    const platformFetch = vi.fn(async () => new Response('platform'))
    vi.stubGlobal('fetch', platformFetch)
    const { connectorFetch } = await import('@/lib/integrations/http')
    const res = await connectorFetch(`http://sp.contoso.local:${port}/sites/hr`, { headers: { Authorization: 'Bearer t' } }, { maxAttempts: 1 })
    expect(await res.text()).toBe('ok')
    expect(platformFetch).not.toHaveBeenCalled()
    expect(hits.at(-1)).toBe(`sp.contoso.local:${port} Bearer t`)
  })

  it('DNS rebinding: a listed name that passes the check but resolves to metadata at connect time is blocked', async () => {
    process.env.EGRESS_PRIVATE_ALLOW = '*.contoso.local'
    checkAnswers.set('sp.contoso.local', ['10.0.0.5'])
    connectAnswers.set('sp.contoso.local', ['169.254.169.254'])
    const { connectorFetch } = await import('@/lib/integrations/http')
    const { EgressBlockedError } = await import('@/lib/egress-guard')
    const attempt = connectorFetch(`https://sp.contoso.local:${port}/`, {}, { maxAttempts: 1, timeoutMs: 5_000 })
    await expect(attempt).rejects.toBeInstanceOf(EgressBlockedError)
    await expect(connectorFetch(`https://sp.contoso.local:${port}/`, {}, { maxAttempts: 1, timeoutMs: 5_000 })).rejects.toThrow(/metadata/)
  })
})

describe('outbound calls that bypassed the guard', () => {
  it('fetchFile: URLs outside the app\'s own origins go through the egress guard', async () => {
    const platformFetch = vi.fn(async () => new Response('secret'))
    vi.stubGlobal('fetch', platformFetch)
    const { fetchFile } = await import('@/lib/storage/files')
    await expect(fetchFile('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/metadata/)
    await expect(fetchFile('http://10.0.0.5/file.pdf')).rejects.toThrow(/private address/)
    expect(platformFetch).not.toHaveBeenCalled()
    // A public URL is fetched (redirects followed manually, each hop checked).
    checkAnswers.set('files.example.com', ['93.184.216.34'])
    platformFetch.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.9/x' } }))
    await expect(fetchFile('https://files.example.com/a.pdf')).rejects.toThrow(/private address \(10\.0\.0\.9\)/)
  })

  it('workflow engine: no plain fetch() left (server-event push and file responses use the guarded paths)', () => {
    const source = readFileSync(path.join(process.cwd(), 'lib/workflow-engine.ts'), 'utf8')
    expect(source).not.toMatch(/(^|[^\w.])fetch\(/m)
    expect(source).toMatch(/connectorFetch\(baseUrl \+ path/)
  })
})

describe('usertasks-admin egress', () => {
  it('parses the subcommands', async () => {
    const { parseCommand: parse, UsageError } = await import('@/packages/admin/src/cli')
    const parseCommand = (argv: string[], env: Record<string, string>) => parse(argv, env as NodeJS.ProcessEnv)
    expect(parseCommand(['egress'], {}).command).toEqual({ kind: 'egress', action: 'show', args: [] })
    expect(parseCommand(['egress', 'allow-private', '*.contoso.local', '10.0.0.0/8'], {}).command).toEqual({ kind: 'egress', action: 'allow-private', args: ['*.contoso.local', '10.0.0.0/8'] })
    expect(parseCommand(['egress', 'remove-http', '--all'], {}).command).toEqual({ kind: 'egress', action: 'remove-http', args: [] })
    expect(() => parseCommand(['egress', 'allow-http'], {})).toThrow(UsageError)
    expect(() => parseCommand(['egress', 'open'], {})).toThrow(UsageError)
  })

  it('edits the instance setting and shows the effective policy', async () => {
    const rows = new Map<string, { key: string; value: unknown; secret: boolean }>()
    const db = {
      async query(sql: string, params: unknown[] = []) {
        if (/to_regclass/.test(sql)) return { rows: [{ ok: true }], rowCount: 1 }
        if (/^\s*SELECT/i.test(sql) && /instance_settings/.test(sql)) return { rows: [...rows.values()], rowCount: rows.size }
        if (/^\s*INSERT INTO public\.instance_settings/i.test(sql)) { rows.set(String(params[0]), { key: String(params[0]), value: JSON.parse(String(params[1])), secret: false }); return { rows: [], rowCount: 1 } }
        if (/^\s*DELETE FROM public\.instance_settings/i.test(sql)) { rows.delete(String(params[0])); return { rows: [], rowCount: 1 } }
        return { rows: [], rowCount: 0 }
      },
    }
    const out: string[] = []
    const err: string[] = []
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {} as NodeJS.ProcessEnv }
    const { runEgressCommand } = await import('@/packages/admin/src/egress-cli')
    expect(await runEgressCommand('allow-private', ['*.Contoso.local', '10.0.0.0/8'], db as never, io, {})).toBe(0)
    expect(rows.get('instance.egress_private_allow')?.value).toEqual(['*.contoso.local', '10.0.0.0/8'])
    expect(out.join('\n')).toMatch(/Private network allowlist \(instance setting\): \*\.contoso\.local, 10\.0\.0\.0\/8/)
    expect(await runEgressCommand('allow-http', ['bad*'], db as never, io, {})).toBe(2)
    expect(await runEgressCommand('remove-private', [], db as never, io, { all: true })).toBe(0)
    expect(rows.has('instance.egress_private_allow')).toBe(false)
  })
})
