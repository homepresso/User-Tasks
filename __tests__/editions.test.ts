/**
 * Edition downloads (lib/editions): licence-gated pull tokens, the signed
 * edition manifest, the usertasks.com registry front and its upstream
 * client. Throwaway keys and a fake upstream only; nothing leaves the process.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { DAY_MS, HOUR_MS } from '@/lib/licensing/format'
import type { LicenceKey } from '@/lib/licensing/keyring'
import { EDITIONS, editionById, editionInstallPs1, editionInstallSh, editionSwitchSh, editionVersion, parseEditionVersion } from '@/lib/editions/catalog'
import { editionDigests, parseEditionManifest, verifyEditionSignature } from '@/lib/editions/edition-manifest'
import { checkLicenceForEdition } from '@/lib/editions/licence-gate'
import { basicPassword, mintPullToken, verifyPullToken } from '@/lib/editions/pull-token'
import { issuePullToken, releaseTagFor, type PullServiceDeps } from '@/lib/editions/pull-service'
import { handleRegistryRequest, parseRegistryPath, type RegistryFrontDeps } from '@/lib/editions/registry-front'
import { clearUpstreamTokenCache, parseChallenge, parseUpstream, UpstreamRegistry } from '@/lib/editions/upstream'
import { editionServerConfig } from '@/lib/editions/config'
import type { PullLogEntry } from '@/lib/editions/access-log'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

const SP = EDITIONS.sharepoint
const MAIN = throwawayKey('lic-test-1')
const TRIAL = throwawayKey('trial-1')
const KEYRING: LicenceKey[] = [MAIN.entry, { ...TRIAL.entry, kind: 'trial', trialSkus: ['sharepoint-se'] }]
const NOW = new Date('2026-12-01T12:00:00.000Z')
const FARM = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const SECRET = 'x'.repeat(40)
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const d = (c: string) => `sha256:${c.repeat(64)}`

const paid = (o: Parameters<typeof makeLicence>[2] = {}) => makeLicence(MAIN.pem, MAIN.entry.kid, { licence_id: 'lic_paid_1', issued_at: iso(-DAY_MS), expires_at: iso(300 * DAY_MS), ...o })
const trial = (o: Parameters<typeof makeLicence>[2] = {}) => makeLicence(TRIAL.pem, TRIAL.entry.kid, {
  licence_id: 'lic_trial_1', issued_at: NOW.toISOString(), expires_at: iso(30 * DAY_MS), sku: 'sharepoint-se', trial: true,
  binding: { farm_ids: [FARM] }, extensions: [{ id: 'sharepoint', limits: { farms: 1 } }], ...o,
})

// A release key for edition.json (the same kind as the installer release key).
const RELEASE = generateKeyPairSync('ed25519')
const RELEASE_PUB = RELEASE.publicKey.export({ type: 'spki', format: 'pem' }).toString()
function editionFiles(o: Record<string, unknown> = {}) {
  const body = {
    format: 1, kind: 'usertasks.edition', edition: 'sharepoint',
    edition_version: '0.3.0-sp1.2.0', core_version: '0.3.0', core_commit: 'abcdef1', extension_version: '1.2.0', extension_commit: '1234567',
    built_at: '2026-11-30T00:00:00Z', index_digest: d('a'),
    platforms: { 'linux/amd64': { manifest: d('b'), config: d('c') }, 'linux/arm64': { manifest: d('e'), config: d('f') } },
    ...o,
  }
  const manifest = Buffer.from(`${JSON.stringify(body, null, 2)}\n`)
  return { manifest, signature: sign(null, manifest, RELEASE.privateKey) }
}

describe('catalog', () => {
  it('pairs core and extension versions', () => {
    expect(editionVersion(SP, '0.3.0', '1.2.0')).toBe('0.3.0-sp1.2.0')
    expect(parseEditionVersion(SP, '0.3.0-sp1.2.0')).toEqual({ core: '0.3.0', extension: '1.2.0' })
    expect(parseEditionVersion(SP, '0.3.0-rc.1-sp1.2.0')).toEqual({ core: '0.3.0-rc.1', extension: '1.2.0' })
    expect(parseEditionVersion(SP, '0.3.0')).toBeNull()
    expect(editionById('sharepoint')).toBe(SP)
    expect(editionById('__proto__')).toBeNull()
  })

  it('builds the commands people copy, with only public names', () => {
    expect(editionInstallSh(SP)).toBe('curl -fsSL https://usertasks.com/install.sh | sh -s -- --edition sharepoint --licence usertasks.licence')
    expect(editionInstallPs1(SP)).toContain('-Edition sharepoint -Licence')
    expect(editionSwitchSh(SP)).toBe('usertasks upgrade --edition sharepoint')
    for (const e of Object.values(EDITIONS)) expect(e.repository).toMatch(/^editions\//)
  })
})

describe('edition manifest', () => {
  it('parses, checks the pairing and verifies the release signature', () => {
    const { manifest, signature } = editionFiles()
    const m = parseEditionManifest(manifest)
    expect(m.edition_version).toBe('0.3.0-sp1.2.0')
    expect(verifyEditionSignature(manifest, signature, RELEASE_PUB)).toBe(true)
    expect(verifyEditionSignature(Buffer.from(manifest.toString().replace('0.3.0', '0.3.1')), signature, RELEASE_PUB)).toBe(false)
    expect(editionDigests(m)).toEqual([d('a'), d('b'), d('c'), d('e'), d('f')])
  })

  it('refuses a mismatched edition version and bad digests', () => {
    expect(() => parseEditionManifest(editionFiles({ edition_version: '0.3.0-sp9.9.9' }).manifest)).toThrow(/does not pair/)
    expect(() => parseEditionManifest(editionFiles({ index_digest: 'sha256:nope' }).manifest)).toThrow(/index_digest/)
    expect(() => parseEditionManifest('not json')).toThrow(/not JSON/)
  })

  it('keeps the keys the shell installers read unique', () => {
    const text = editionFiles().manifest.toString()
    for (const key of ['edition_version', 'core_version', 'extension_version', 'index_digest']) {
      expect(text.split(`"${key}"`).length - 1, key).toBe(1)
    }
  })
})

describe('pull tokens', () => {
  it('round-trips and expires after 30 minutes', () => {
    const { token, payload } = mintPullToken({ edition: 'sharepoint', licenceId: 'lic_1', trial: false, now: NOW }, SECRET)
    expect(token.startsWith('utpt1.')).toBe(true)
    expect(payload.exp - payload.iat).toBe(1800)
    expect(verifyPullToken(token, 'sharepoint', new Date(NOW.getTime() + 29 * 60_000), SECRET)).toMatchObject({ ok: true })
    expect(verifyPullToken(token, 'sharepoint', new Date(NOW.getTime() + 30 * 60_000), SECRET)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects tampering, another secret and another edition', () => {
    const { token } = mintPullToken({ edition: 'sharepoint', licenceId: 'lic_1', trial: false, now: NOW }, SECRET)
    const [p, body, mac] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64').toString()), exp: 9e9 })).toString('base64url')
    expect(verifyPullToken(`${p}.${forged}.${mac}`, 'sharepoint', NOW, SECRET)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyPullToken(token, 'sharepoint', NOW, 'y'.repeat(40))).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyPullToken(token, 'other', NOW, SECRET)).toEqual({ ok: false, reason: 'wrong_edition' })
    expect(verifyPullToken('garbage', 'sharepoint', NOW, SECRET)).toEqual({ ok: false, reason: 'malformed' })
    expect(() => mintPullToken({ edition: 'sharepoint', licenceId: 'l', trial: false, now: NOW }, 'short')).toThrow(/32/)
  })

  it('reads the password of a Basic or Bearer header', () => {
    expect(basicPassword(`Basic ${Buffer.from('licence:abc.def').toString('base64')}`)).toBe('abc.def')
    expect(basicPassword('Bearer tok')).toBe('tok')
    expect(basicPassword(null)).toBeNull()
  })
})

describe('licence gate', () => {
  const check = (raw: unknown, now = NOW, revoked: string[] = []) => checkLicenceForEdition({ raw: typeof raw === 'string' ? raw : JSON.stringify(raw), edition: SP, now, keyring: KEYRING, revoked })

  it('accepts a paid licence and a trial (JSON or base64)', () => {
    expect(check(paid())).toMatchObject({ ok: true, trial: false })
    expect(check(Buffer.from(JSON.stringify(trial())).toString('base64'))).toMatchObject({ ok: true, trial: true })
  })

  it('honours the 24-hour cutoff after expiry', () => {
    const lic = paid({ expires_at: iso(-2 * HOUR_MS) })
    expect(check(lic)).toMatchObject({ ok: true })
    const gone = check(lic, new Date(NOW.getTime() + 23 * HOUR_MS))
    expect(gone).toMatchObject({ ok: false, code: 'licence_expired' })
    if (!gone.ok) expect(gone.message).toMatch(/keeps running/)
  })

  it('refuses forged, wrong-SKU, other-extension, future, revoked and trial-rule-breaking licences', () => {
    const forged = { ...paid(), expires_at: iso(900 * DAY_MS) }
    expect(check(forged)).toMatchObject({ ok: false, code: 'licence_invalid' })
    expect(check(paid({ sku: 'other-sku' }))).toMatchObject({ ok: false, code: 'licence_not_for_edition' })
    expect(check(paid({ extensions: [{ id: 'servicenow' }] }))).toMatchObject({ ok: false, code: 'licence_not_for_edition' })
    expect(check(paid({ not_before: iso(DAY_MS) }))).toMatchObject({ ok: false, code: 'licence_not_yet_valid' })
    expect(check(paid(), NOW, ['lic_paid_1'])).toMatchObject({ ok: false, code: 'licence_revoked' })
    expect(check(trial({ expires_at: iso(90 * DAY_MS) }))).toMatchObject({ ok: false, code: 'licence_invalid' })
    expect(check('{"nope":1}')).toMatchObject({ ok: false, code: 'licence_malformed' })
    const unknown = makeLicence(throwawayKey('stranger').pem, 'stranger', {})
    expect(check(unknown)).toMatchObject({ ok: false, code: 'licence_invalid' })
  })
})

describe('pull-token service', () => {
  let logs: PullLogEntry[]
  let releases: Record<string, ReturnType<typeof editionFiles> | undefined>
  let configured: boolean
  beforeEach(() => {
    logs = []
    const f = editionFiles()
    releases = { 'edition-latest': f, 'edition-0.3.0': f, 'edition-0.3.0-sp1.2.0': f }
    configured = true
  })
  const deps = (): PullServiceDeps => ({
    now: () => NOW,
    keyring: () => KEYRING,
    config: () => (configured ? { ok: true, secret: SECRET, registryHost: 'usertasks.com', revoked: [] } : { ok: false, missing: ['EDITION_PULL_TOKEN_SECRET'] }),
    readRelease: async (ref) => releases[ref] ?? null,
    log: async (e) => { logs.push(e) },
  })
  const ctx = { ipHash: 'h', userAgent: 'usertasks-installer/sh' }

  it('maps versions to artifact tags', () => {
    expect(releaseTagFor(SP, 'latest')).toBe('edition-latest')
    expect(releaseTagFor(SP, '0.3.0')).toBe('edition-0.3.0')
    expect(releaseTagFor(SP, '0.3.0-sp1.2.0')).toBe('edition-0.3.0-sp1.2.0')
    expect(releaseTagFor(SP, '../x')).toBeNull()
  })

  it('issues a flat credential with the signed manifest, and logs without secrets', async () => {
    const out = await issuePullToken(SP, { licence: JSON.stringify(paid()), version: 'latest', purpose: 'install' }, ctx, deps())
    expect(out.status).toBe(200)
    const b = out.body as Record<string, string>
    expect(b).toMatchObject({ registry: 'usertasks.com', repository: 'editions/sharepoint', username: 'licence', core_version: '0.3.0', edition_version: '0.3.0-sp1.2.0', index_digest: d('a'), licence_id: 'lic_paid_1', trial: false })
    expect(b.image).toBe(`usertasks.com/editions/sharepoint@${d('a')}`)
    expect(Object.values(b).every((v) => typeof v !== 'object' || v === null)).toBe(true)
    expect(verifyPullToken(b.password, 'sharepoint', NOW, SECRET).ok).toBe(true)
    const manifest = Buffer.from(b.edition_manifest, 'base64')
    expect(verifyEditionSignature(manifest, Buffer.from(b.edition_signature, 'base64'), RELEASE_PUB)).toBe(true)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ outcome: 'issued', licence_id: 'lic_paid_1', purpose: 'install', edition_version: '0.3.0-sp1.2.0' })
    expect(JSON.stringify(logs)).not.toContain(b.password)
    expect(JSON.stringify(logs)).not.toContain('signature')
  })

  it('refuses an expired licence with 403 and the reason', async () => {
    const out = await issuePullToken(SP, { licence: JSON.stringify(paid({ expires_at: iso(-2 * DAY_MS) })), purpose: 'upgrade' }, ctx, deps())
    expect(out.status).toBe(403)
    expect(out.body.code).toBe('licence_expired')
    expect(logs[0]).toMatchObject({ outcome: 'denied', code: 'licence_expired', licence_id: 'lic_paid_1' })
  })

  it('404s a core version without a build and names the newest', async () => {
    const out = await issuePullToken(SP, { licence: JSON.stringify(paid()), version: '0.4.0' }, ctx, deps())
    expect(out.status).toBe(404)
    expect(out.body).toMatchObject({ code: 'edition_not_found', latest_core_version: '0.3.0' })
  })

  it('refuses a manifest that is not the requested version or edition', async () => {
    releases['edition-0.3.0'] = editionFiles({ edition_version: '0.2.0-sp1.2.0', core_version: '0.2.0' })
    expect((await issuePullToken(SP, { licence: JSON.stringify(paid()), version: '0.3.0' }, ctx, deps())).status).toBe(502)
  })

  it('validates input and reports when downloads are not configured', async () => {
    expect((await issuePullToken(SP, {}, ctx, deps())).status).toBe(400)
    expect((await issuePullToken(SP, { licence: 'x', version: 'v; rm' }, ctx, deps())).status).toBe(400)
    configured = false
    const out = await issuePullToken(SP, { licence: JSON.stringify(paid()) }, ctx, deps())
    expect(out).toMatchObject({ status: 503, body: { code: 'editions_unavailable' } })
  })
})

describe('server config', () => {
  it('needs the secret, the upstream and its credential', () => {
    expect(editionServerConfig(SP, {} as NodeJS.ProcessEnv)).toMatchObject({ ok: false })
    const ok = editionServerConfig(SP, { EDITION_PULL_TOKEN_SECRET: SECRET, EDITION_UPSTREAM_SHAREPOINT: 'registry.example/acme/private-image', EDITION_UPSTREAM_USERNAME: 'bot', EDITION_UPSTREAM_TOKEN: 't', EDITION_REGISTRY_HOST: 'usertasks.com', EDITION_REVOKED_LICENCES: 'a, b' } as unknown as NodeJS.ProcessEnv)
    expect(ok).toMatchObject({ ok: true, config: { registryHost: 'usertasks.com', upstream: { host: 'registry.example', repository: 'acme/private-image' }, revoked: ['a', 'b'] } })
    expect(parseUpstream('https://registry.example/acme/x/')).toEqual({ host: 'registry.example', repository: 'acme/x' })
    expect(parseUpstream('nohost')).toBeNull()
  })
})

// ─── Fake upstream (token challenge, manifests, CDN-redirected blobs, ORAS artifact) ──

function fakeUpstream() {
  const calls: Array<{ url: string; auth?: string }> = []
  const files = editionFiles()
  const blobs = new Map<string, Buffer>()
  const add = (b: Buffer) => { const dg = `sha256:${createHash('sha256').update(b).digest('hex')}`; blobs.set(dg, b); return dg }
  const mDigest = add(files.manifest)
  const sDigest = add(files.signature)
  const artifact = JSON.stringify({ layers: [
    { digest: mDigest, size: files.manifest.length, annotations: { 'org.opencontainers.image.title': 'edition.json' } },
    { digest: sDigest, size: files.signature.length, annotations: { 'org.opencontainers.image.title': 'edition.json.sig' } },
  ] })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    calls.push({ url, auth })
    const u = new URL(url)
    if (u.pathname === '/v2/') return new Response('', { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="https://up.example/token",service="up.example",scope="repository:x:pull"' } })
    if (u.pathname === '/token') {
      if (auth !== `Basic ${Buffer.from('bot:secret-token').toString('base64')}`) return new Response('', { status: 401 })
      expect(u.searchParams.get('scope')).toBe('repository:acme/private:pull')
      return Response.json({ token: 'upstream-bearer', expires_in: 300 })
    }
    if (u.host === 'cdn.example') {
      const b = blobs.get(u.pathname.slice(1))
      return b ? new Response(new Uint8Array(b), { status: 200, headers: { 'content-length': String(b.length) } }) : new Response('', { status: 404 })
    }
    if (auth !== 'Bearer upstream-bearer') return new Response('', { status: 401 })
    const m = /^\/v2\/acme\/private\/(manifests|blobs)\/(.+)$/.exec(u.pathname)
    if (!m) return new Response('', { status: 404 })
    if (m[1] === 'manifests') {
      if (m[2] === 'edition-latest') return new Response(artifact, { status: 200, headers: { 'content-type': 'application/vnd.oci.image.manifest.v1+json' } })
      if (m[2] === d('a')) return new Response('{"schemaVersion":2}', { status: 200, headers: { 'content-type': 'application/vnd.oci.image.index.v1+json', 'docker-content-digest': d('a'), 'content-length': '19' } })
      return new Response('', { status: 404 })
    }
    return new Response(null, { status: 307, headers: { location: `https://cdn.example/${m[2]}?sig=short-lived` } })
  }
  const upstream = new UpstreamRegistry({ host: 'up.example', repository: 'acme/private' }, { username: 'bot', token: 'secret-token' }, fetchImpl as typeof fetch, () => NOW.getTime())
  return { calls, upstream, files }
}

describe('upstream registry client', () => {
  beforeEach(() => clearUpstreamTokenCache())

  it('parses token challenges', () => {
    expect(parseChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"')).toEqual({ scheme: 'bearer', params: { realm: 'https://ghcr.io/token', service: 'ghcr.io', scope: 'repository:a/b:pull' } })
  })

  it('gets a pull-scoped token once and reads the edition artifact, digest-checked', async () => {
    const { upstream, calls, files } = fakeUpstream()
    const got = await upstream.artifactFiles('edition-latest', ['edition.json', 'edition.json.sig'])
    expect(got?.['edition.json'].equals(files.manifest)).toBe(true)
    expect(got?.['edition.json.sig'].equals(files.signature)).toBe(true)
    expect(calls.filter((c) => c.url.includes('/token'))).toHaveLength(1)
    // The CDN never gets the upstream credential.
    expect(calls.filter((c) => c.url.includes('cdn.example')).every((c) => !c.auth)).toBe(true)
    expect(await upstream.artifactFiles('edition-9.9.9', ['edition.json'])).toBeNull()
  })
})

describe('registry front', () => {
  beforeEach(() => clearUpstreamTokenCache())
  const token = (edition = 'sharepoint', now = NOW) => mintPullToken({ edition, licenceId: 'lic_1', trial: false, now }, SECRET).token
  const basic = (t: string) => `Basic ${Buffer.from(`licence:${t}`).toString('base64')}`
  function front(upstream = fakeUpstream().upstream, allow = true): RegistryFrontDeps {
    return { now: () => NOW, edition: () => ({ secret: SECRET, upstream }), allow: async () => allow }
  }
  const req = (path: string, auth: string | null, method = 'GET') => ({ method, segments: path.split('/').filter(Boolean), authorization: auth, accept: null })

  it('parses repository paths and refuses anything else', () => {
    expect(parseRegistryPath(['editions', 'sharepoint', 'manifests', 'latest'])).toEqual({ repository: 'editions/sharepoint', kind: 'manifests', ref: 'latest' })
    expect(parseRegistryPath(['editions', 'sharepoint', 'blobs', 'latest'])).toBeNull()
    expect(parseRegistryPath(['editions', 'sharepoint', 'tags', 'list'])).toBeNull()
  })

  it('challenges without a token (what makes docker login send one) and accepts a valid one', async () => {
    const none = await handleRegistryRequest(req('', null), front())
    expect(none.status).toBe(401)
    expect(none.headers.get('www-authenticate')).toBe('Basic realm="UserTasks editions"')
    expect(none.headers.get('docker-distribution-api-version')).toBe('registry/2.0')
    expect((await handleRegistryRequest(req('', basic(token())), front())).status).toBe(200)
    expect((await handleRegistryRequest(req('', basic(token('sharepoint', new Date(NOW.getTime() - 3_600_000)))), front())).status).toBe(401)
  })

  it('relays manifests and passes blob redirects through without the upstream credential', async () => {
    const t = basic(token())
    const m = await handleRegistryRequest(req(`editions/sharepoint/manifests/${d('a')}`, t), front())
    expect(m.status).toBe(200)
    expect(m.headers.get('docker-content-digest')).toBe(d('a'))
    expect(await m.text()).toBe('{"schemaVersion":2}')
    const b = await handleRegistryRequest(req(`editions/sharepoint/blobs/${d('b')}`, t), front())
    expect(b.status).toBe(307)
    expect(b.headers.get('location')).toBe(`https://cdn.example/${d('b')}?sig=short-lived`)
    expect((await handleRegistryRequest(req('editions/sharepoint/manifests/nope', t), front())).status).toBe(404)
  })

  it('is read-only, scoped to known repositories, and rate limited', async () => {
    const t = basic(token())
    expect((await handleRegistryRequest(req(`editions/sharepoint/manifests/latest`, t, 'PUT'), front())).status).toBe(405)
    expect((await handleRegistryRequest(req(`someone/else/manifests/latest`, t), front())).status).toBe(404)
    expect((await handleRegistryRequest(req(`editions/sharepoint/manifests/latest`, basic(token('other'))), front())).status).toBe(403)
    expect((await handleRegistryRequest(req(`editions/sharepoint/manifests/latest`, null), front())).status).toBe(401)
    expect((await handleRegistryRequest(req(`editions/sharepoint/manifests/latest`, t), front(undefined, false))).status).toBe(429)
  })
})

describe('usertasks-admin licence export (what `usertasks upgrade` sends)', () => {
  it('prints the best valid licence for the extension, verbatim enough to verify', async () => {
    const { runLicence } = await import('@/packages/admin/src/licence-cli')
    const old = paid({ licence_id: 'lic_old', expires_at: iso(10 * DAY_MS) })
    const newer = paid({ licence_id: 'lic_new', expires_at: iso(200 * DAY_MS) })
    const other = paid({ licence_id: 'lic_other', extensions: [{ id: 'servicenow' }] })
    const settings = new Map<string, unknown>([['instance.licences', [old, newer, other]]])
    const store = {
      readSetting: async (k: string) => settings.get(k),
      writeSetting: async () => undefined,
      ensureInstanceId: async () => 'inst_abcdefghijklmnopqrstuvwx',
      listEntitlements: async () => [],
      upsertEntitlement: async () => undefined,
      deleteEntitlement: async () => false,
      recordEvent: async () => undefined,
    }
    const out: string[] = []
    const err: string[] = []
    const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l), env: {} as NodeJS.ProcessEnv }
    expect(await runLicence('export', [], { ext: 'sharepoint', actor: 't' }, store, io, { now: () => NOW, keyring: KEYRING })).toBe(0)
    const printed = JSON.parse(out.join('\n'))
    expect(printed.licence_id).toBe('lic_new')
    expect(checkLicenceForEdition({ raw: out.join('\n'), edition: SP, now: NOW, keyring: KEYRING })).toMatchObject({ ok: true })
    expect(await runLicence('export', [], { ext: 'nothing', actor: 't' }, store, io, { now: () => NOW, keyring: KEYRING })).toBe(1)
    expect(err[0]).toMatch(/No installed licence/)
  })
})

describe('latest edition info (install.sh picks the release that has a build)', () => {
  it('reports the newest build, cached, and nothing when not configured', async () => {
    const { latestEditionInfo, clearLatestEditionCache } = await import('@/lib/editions/pull-service')
    clearLatestEditionCache()
    let reads = 0
    const f = editionFiles()
    const deps = { now: () => NOW, config: () => ({ ok: true as const, secret: SECRET, registryHost: 'usertasks.com', revoked: [] }), readRelease: async () => { reads++; return f } }
    expect(await latestEditionInfo(SP, deps)).toEqual({ edition: 'sharepoint', name: SP.name, available: true, latest_core_version: '0.3.0', latest_edition_version: '0.3.0-sp1.2.0' })
    await latestEditionInfo(SP, deps)
    expect(reads).toBe(1)
    clearLatestEditionCache()
    expect(await latestEditionInfo(SP, { ...deps, config: () => ({ ok: false as const, missing: ['x'] }) })).toMatchObject({ available: false })
    clearLatestEditionCache()
  })
})
