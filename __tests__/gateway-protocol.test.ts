import { describe, expect, it, afterEach } from 'vitest'
import {
  canonicalJson,
  canonicalResponse,
  compareVersions,
  generateEd25519,
  isRawPublicKey,
  isRegistrationToken,
  keyFingerprint,
  newRegistrationToken,
  readSignatureHeaders,
  resolveTargetUrl,
  sanitizeHeaders,
  sha256Hex,
  signBytes,
  signRequest,
  splitParts,
  BODY_PART_BYTES,
  validateJobPath,
  verifyBytes,
  verifyRequestSignature,
} from '@/lib/gateway/protocol'
import { advertisedCloudKeys, cloudSigningKey } from '@/lib/gateway/cloud-key'
import { connectorFetch } from '@/lib/integrations/http'
import { isRemoteTransport, markRemoteTransport } from '@/lib/integrations/transports'
import { EgressBlockedError } from '@/lib/egress-guard'
import { withValidGatewayTransport } from '@/lib/services/integrations'
import { GATEWAY_MIN_VERSION, gatewayVersionPolicy } from '@/lib/gateway/versions'
import gatewayPackage from '@/packages/gateway/package.json'

const KEY_ID = '11111111-2222-3333-4444-555555555555'

function signed(body = '{"a":1}', overrides: Partial<{ method: string; path: string; now: number }> = {}) {
  const pair = generateEd25519()
  const headers = signRequest({ keyId: KEY_ID, privateKey: pair.privateKeyPem, method: overrides.method ?? 'POST', path: overrides.path ?? '/api/gateway/v1/poll', body, now: overrides.now })
  const parts = readSignatureHeaders((n) => headers[n] ?? null)!
  return { pair, headers, parts }
}

describe('gateway protocol: signed requests', () => {
  it('verifies an untouched request', () => {
    const { pair, parts } = signed()
    expect(verifyRequestSignature({ parts, publicKey: pair.publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: '{"a":1}' })).toEqual({ ok: true })
  })

  it('refuses a changed body, path, method or key', () => {
    const { pair, parts } = signed()
    expect(verifyRequestSignature({ parts, publicKey: pair.publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: '{"a":2}' })).toEqual({ ok: false, problem: 'bad_signature' })
    expect(verifyRequestSignature({ parts, publicKey: pair.publicKey, method: 'POST', path: '/api/gateway/v1/relay', body: '{"a":1}' })).toEqual({ ok: false, problem: 'bad_signature' })
    expect(verifyRequestSignature({ parts, publicKey: pair.publicKey, method: 'PUT', path: '/api/gateway/v1/poll', body: '{"a":1}' })).toEqual({ ok: false, problem: 'bad_signature' })
    expect(verifyRequestSignature({ parts, publicKey: generateEd25519().publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: '{"a":1}' })).toEqual({ ok: false, problem: 'bad_signature' })
  })

  it('refuses stale or future timestamps (replay window) and malformed nonces', () => {
    const old = signed('x', { now: Date.now() - 120_000 })
    expect(verifyRequestSignature({ parts: old.parts, publicKey: old.pair.publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: 'x' })).toEqual({ ok: false, problem: 'stale' })
    const future = signed('x', { now: Date.now() + 120_000 })
    expect(verifyRequestSignature({ parts: future.parts, publicKey: future.pair.publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: 'x' })).toEqual({ ok: false, problem: 'stale' })
    const { pair, parts } = signed('x')
    expect(verifyRequestSignature({ parts: { ...parts, nonce: 'short' }, publicKey: pair.publicKey, method: 'POST', path: '/api/gateway/v1/poll', body: 'x' }).ok).toBe(false)
  })

  it('reads signature headers only when all are present and the key id is a uuid', () => {
    expect(readSignatureHeaders(() => null)).toBeNull()
    const { headers } = signed()
    expect(readSignatureHeaders((n) => (n === 'x-utgw-key' ? 'not-a-uuid' : headers[n]))).toBeNull()
  })

  it('binds cloud answers to the request nonce', () => {
    const pair = generateEd25519()
    const body = JSON.stringify({ jobs: [] })
    const sig = signBytes(pair.privateKeyPem, canonicalResponse({ status: 200, requestNonce: 'nonce-aaaaaaaaaaaaaaaa', bodySha256: sha256Hex(body) }))
    expect(verifyBytes(pair.publicKey, canonicalResponse({ status: 200, requestNonce: 'nonce-aaaaaaaaaaaaaaaa', bodySha256: sha256Hex(body) }), sig)).toBe(true)
    // A recorded answer replayed for another request (other nonce) or with another status does not verify.
    expect(verifyBytes(pair.publicKey, canonicalResponse({ status: 200, requestNonce: 'nonce-bbbbbbbbbbbbbbbb', bodySha256: sha256Hex(body) }), sig)).toBe(false)
    expect(verifyBytes(pair.publicKey, canonicalResponse({ status: 201, requestNonce: 'nonce-aaaaaaaaaaaaaaaa', bodySha256: sha256Hex(body) }), sig)).toBe(false)
  })

  it('validates keys, fingerprints and registration tokens', () => {
    const { publicKey } = generateEd25519()
    expect(isRawPublicKey(publicKey)).toBe(true)
    expect(isRawPublicKey('abc')).toBe(false)
    expect(keyFingerprint(publicKey)).toMatch(/^[0-9a-f]{16}$/)
    const token = newRegistrationToken()
    expect(isRegistrationToken(token)).toBe(true)
    expect(isRegistrationToken(`${token}x`)).toBe(false)
    expect(isRegistrationToken('utgwr_short')).toBe(false)
  })
})

describe('gateway protocol: jobs never carry a URL', () => {
  it('accepts absolute paths only', () => {
    expect(validateJobPath('/sites/finance/_api/web?$select=Title')).toBeNull()
    for (const bad of ['', 'sites/x', '//evil.example/x', 'http://evil.example/x', '/a\\b', '/a\nb', '/a#frag', `/${'a'.repeat(9000)}`]) {
      expect(validateJobPath(bad)).not.toBeNull()
    }
  })

  it('never resolves outside the target origin', () => {
    expect(resolveTargetUrl('http://spsites', '/sites/a/../b?x=1').href).toBe('http://spsites/sites/b?x=1')
    expect(() => resolveTargetUrl('http://spsites', '//evil.example/x')).toThrow()
    expect(() => resolveTargetUrl('http://spsites', 'https://evil.example/')).toThrow()
    expect(resolveTargetUrl('http://spsites', '/@evil.example').origin).toBe('http://spsites')
  })

  it('sanitises headers: no hop-by-hop, cookies, protocol headers; Authorization only when allowed', () => {
    const input = { Host: 'evil', Cookie: 'a=b', 'Content-Length': '5', Authorization: 'Bearer x', 'X-UTGW-Key': 'k', Accept: 'application/json', 'X-Evil': 'a\r\nInjected: 1', 'X-RequestDigest': 'd' }
    expect(sanitizeHeaders(input, { allowAuthorization: false })).toEqual({ accept: 'application/json', 'x-requestdigest': 'd' })
    expect(sanitizeHeaders(input, { allowAuthorization: true })).toEqual({ accept: 'application/json', 'x-requestdigest': 'd', authorization: 'Bearer x' })
  })

  it('splits bodies into parts and canonicalises JSON', () => {
    const body = Buffer.alloc(BODY_PART_BYTES * 2 + 10, 7)
    expect(splitParts(body).map((p) => p.length)).toEqual([BODY_PART_BYTES, BODY_PART_BYTES, 10])
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }], u: undefined })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
  })

  it('compares versions', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0)
  })
})

describe('cloud signing key', () => {
  const saved = { ...process.env }
  afterEach(() => { process.env = { ...saved } })

  it('derives a stable key from ENCRYPTION_KEY and advertises GATEWAY_SIGNING_KEY_NEXT', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64')
    delete process.env.GATEWAY_SIGNING_KEY
    const a = cloudSigningKey()
    expect(cloudSigningKey().publicKey).toBe(a.publicKey)
    process.env.GATEWAY_SIGNING_KEY_NEXT = Buffer.alloc(32, 9).toString('hex')
    const keys = advertisedCloudKeys()
    expect(keys).toHaveLength(2)
    expect(keys[0].id).toBe(a.id)
  })

  it('prefers GATEWAY_SIGNING_KEY', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64')
    const derived = cloudSigningKey().publicKey
    process.env.GATEWAY_SIGNING_KEY = Buffer.alloc(32, 3).toString('base64')
    expect(cloudSigningKey().publicKey).not.toBe(derived)
  })
})

describe('remote transports and the egress guard', () => {
  it('a remote (gateway) transport is not egress-checked by the server; a local one is', async () => {
    const remote = markRemoteTransport((async () => new Response('ok', { status: 200 })) as unknown as typeof fetch)
    const local = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch
    expect(isRemoteTransport(remote)).toBe(true)
    expect(isRemoteTransport(local)).toBe(false)
    // An address the server's guard always refuses: the gateway decides, not the server.
    const res = await connectorFetch('http://169.254.169.254/latest', {}, { fetchImpl: remote, maxAttempts: 1 })
    expect(res.status).toBe(200)
    await expect(connectorFetch('http://169.254.169.254/latest', {}, { fetchImpl: local, maxAttempts: 1 })).rejects.toBeInstanceOf(EgressBlockedError)
  })

  it('does not retry an error the transport marks non-retryable (gateway offline)', async () => {
    let calls = 0
    const offline = markRemoteTransport((async () => { calls++; throw Object.assign(new Error('Gateway "HQ" is offline'), { retryable: false }) }) as unknown as typeof fetch)
    await expect(connectorFetch('http://spsites/', {}, { fetchImpl: offline, maxAttempts: 3 })).rejects.toThrow(/offline/)
    expect(calls).toBe(1)
  })
})

describe('gateway connections (integration config)', () => {
  it('keeps the gateway reference, drops credentials, accepts private http targets', () => {
    const out = withValidGatewayTransport({ base_url: 'http://spsites/sites/ut-lab/', auth_type: 'windows', auth_config: { _transport: 'gateway', gateway_id: '11111111-2222-3333-4444-555555555555', gateway_target: 'spsites', username: 'x', password: 'y' } })
    expect(out.base_url).toBe('http://spsites/sites/ut-lab')
    expect(out.auth_config).toEqual({ _transport: 'gateway', gateway_id: '11111111-2222-3333-4444-555555555555', gateway_target: 'spsites' })
  })

  it('refuses a missing gateway id, bad target ids and credentials in the URL', () => {
    expect(() => withValidGatewayTransport({ base_url: 'http://spsites', auth_config: { _transport: 'gateway' } })).toThrow(/gateway_id/)
    expect(() => withValidGatewayTransport({ base_url: 'http://spsites', auth_config: { _transport: 'gateway', gateway_id: '11111111-2222-3333-4444-555555555555', gateway_target: 'Bad Target' } })).toThrow(/gateway_target/)
    expect(() => withValidGatewayTransport({ base_url: 'http://u:p@spsites', auth_config: { _transport: 'gateway', gateway_id: '11111111-2222-3333-4444-555555555555' } })).toThrow(/credentials/)
  })
})

describe('gateway versions', () => {
  it('advertises the packaged gateway version and a minimum', () => {
    const policy = gatewayVersionPolicy()
    expect(policy.latest).toBe(gatewayPackage.version)
    expect(policy.min).toBe(GATEWAY_MIN_VERSION)
    expect(compareVersions(gatewayPackage.version, GATEWAY_MIN_VERSION)).toBeGreaterThanOrEqual(0)
  })
})
