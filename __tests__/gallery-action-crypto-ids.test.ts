/**
 * Official action ut_crypto (gallery/actions/crypto-ids): contract checks and
 * every operation run in the QuickJS sandbox from the built module — known
 * hash and HMAC vectors (RFC 4231), JWT round trips and failures, UUID v7
 * ordering and version bits, ULID format and monotonicity.
 */
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const SECRETS = { hmac_key: 'example-secret', token_secret: 'example-secret' }
const mocks = { secrets: SECRETS }

const action = contractSuite('crypto-ids', {
  key: 'ut_crypto',
  operations: ['uuid', 'ulid', 'hash', 'hmac', 'encode', 'decode', 'random_code', 'otp', 'sign_token', 'verify_token'],
  capabilities: ['credentials'],
  mocks,
})

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
function jwt(payload: Record<string, unknown>, secret = 'example-secret', header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }) {
  const input = `${b64url(header)}.${b64url(payload)}`
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`
}
const now = () => Math.floor(Date.now() / 1000)

describe('ut_crypto manifest secrets', () => {
  it('declares the two optional secrets', () => {
    expect(action.manifest.capabilities.credentials).toEqual([
      { name: 'hmac_key', label: 'HMAC key', description: expect.any(String) },
      { name: 'token_secret', label: 'Token signing secret', description: expect.any(String) },
    ])
  })
})

describe('ut_crypto uuid and ulid', () => {
  it('v4 UUIDs', async () => {
    const out = await ok(action, 'uuid', { count: 5 })
    expect(out.uuids).toHaveLength(5)
    expect(new Set(out.uuids).size).toBe(5)
    for (const u of out.uuids) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(out.uuid).toBe(out.uuids[0])
    expect((await ok(action, 'uuid', { uppercase: true })).uuid).toMatch(/^[0-9A-F-]{36}$/)
  })

  it('v7 UUIDs: version and variant bits, current timestamp, strictly increasing', async () => {
    const before = Date.now()
    const out = await ok(action, 'uuid', { version: 'v7', count: 200 })
    const after = Date.now()
    for (const u of out.uuids) expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const ts = parseInt(out.uuids[0].replace(/-/g, '').slice(0, 12), 16)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after + 1)
    const sorted = [...out.uuids].sort()
    expect(sorted).toEqual(out.uuids)
    expect(new Set(out.uuids).size).toBe(200)
  })

  it('ULIDs: Crockford base32, time prefix, strictly increasing', async () => {
    const before = Date.now()
    const out = await ok(action, 'ulid', { count: 300 })
    for (const u of out.ulids) expect(u).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    const ms = [...out.ulid.slice(0, 10)].reduce((acc: number, ch: string) => acc * 32 + alphabet.indexOf(ch), 0)
    expect(ms).toBeGreaterThanOrEqual(before)
    expect(ms).toBeLessThanOrEqual(Date.now() + 1)
    for (let i = 1; i < out.ulids.length; i++) expect(out.ulids[i] > out.ulids[i - 1]).toBe(true)
  })

  it('limits the count', async () => {
    await fails(action, 'uuid', { count: 1001 }, /at most 1000/)
    await fails(action, 'ulid', { count: 0 }, /at least 1/)
  })
})

describe('ut_crypto hash and hmac', () => {
  it('known SHA vectors', async () => {
    expect(await ok(action, 'hash', { text: 'abc' })).toEqual({ hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', algorithm: 'SHA-256' })
    expect((await ok(action, 'hash', { text: 'abc', algorithm: 'SHA-1' })).hash).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect((await ok(action, 'hash', { text: 'abc', algorithm: 'SHA-512' })).hash).toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f')
    expect((await ok(action, 'hash', { text: 'abc', encoding: 'base64' })).hash).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=')
    expect((await ok(action, 'hash', { text: '' })).hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect((await ok(action, 'hash', { text: 'héllo' })).hash).toBe(createHash('sha256').update('héllo', 'utf8').digest('hex'))
  })

  it('HMAC RFC 4231 test case 2 with the mocked secret', async () => {
    const rfc = { secrets: { ...SECRETS, hmac_key: 'Jefe' } }
    const data = 'what do ya want for nothing?'
    expect(await ok(action, 'hmac', { message: data }, rfc)).toEqual({ signature: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', matches: null })
    expect((await ok(action, 'hmac', { message: data, algorithm: 'SHA-512' }, rfc)).signature).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737')
  })

  it('checks a received signature (prefix and case tolerant)', async () => {
    const message = '{"event":"invoice.paid","id":"evt_1042"}'
    const sig = createHmac('sha256', 'example-secret').update(message).digest('hex')
    expect((await ok(action, 'hmac', { message, expected: `sha256=${sig.toUpperCase()}` }, mocks)).matches).toBe(true)
    expect((await ok(action, 'hmac', { message: `${message} `, expected: sig }, mocks)).matches).toBe(false)
    const b64 = createHmac('sha256', 'example-secret').update(message).digest('base64')
    expect((await ok(action, 'hmac', { message, expected: b64, encoding: 'base64' }, mocks)).matches).toBe(true)
  })

  it('explains a missing secret', async () => {
    await fails(action, 'hmac', { message: 'x' }, /hmac needs the secret "hmac_key"/, { secrets: {} })
  })
})

describe('ut_crypto encode and decode', () => {
  const text = 'Hello, Wörld & friends ✓'
  it.each([
    ['base64', 'SGVsbG8sIFfDtnJsZCAmIGZyaWVuZHMg4pyT'],
    ['base64url', 'SGVsbG8sIFfDtnJsZCAmIGZyaWVuZHMg4pyT'],
    ['hex', Buffer.from(text).toString('hex')],
    ['url', 'Hello%2C%20W%C3%B6rld%20%26%20friends%20%E2%9C%93'],
  ])('%s round trip', async (format, encoded) => {
    expect((await ok(action, 'encode', { text, format })).result).toBe(encoded)
    expect((await ok(action, 'decode', { text: encoded, format })).result).toBe(text)
  })

  it('base64url differs from base64 where it should', async () => {
    expect((await ok(action, 'encode', { text: '>>>???', format: 'base64' })).result).toBe('Pj4+Pz8/')
    expect((await ok(action, 'encode', { text: '>>>???', format: 'base64url' })).result).toBe('Pj4-Pz8_')
    expect((await ok(action, 'decode', { text: 'Pj4+\nPz8/', format: 'base64' })).result).toBe('>>>???')
  })

  it('URL decoding options and errors', async () => {
    expect((await ok(action, 'decode', { text: 'a+b%20c', format: 'url' })).result).toBe('a+b c')
    expect((await ok(action, 'decode', { text: 'a+b%20c', format: 'url', plus_as_space: true })).result).toBe('a b c')
    await fails(action, 'decode', { text: '%E0%A4%A', format: 'url' }, /broken %-escape/)
    await fails(action, 'decode', { text: 'not base64!', format: 'base64' }, /not valid base64/)
    await fails(action, 'decode', { text: 'abc', format: 'hex' }, /not valid hex/)
    await fails(action, 'decode', { text: 'Pj4+Pz8/', format: 'base64url' }, /not valid base64url/)
  })
})

describe('ut_crypto random_code and otp', () => {
  it('generates codes from presets with grouping', async () => {
    const out = await ok(action, 'random_code', { length: 12, count: 50, group_size: 4 })
    expect(out.codes).toHaveLength(50)
    for (const c of out.codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    expect(new Set(out.codes).size).toBe(50)
    expect((await ok(action, 'random_code', { length: 6, alphabet: 'digits' })).code).toMatch(/^\d{6}$/)
    expect((await ok(action, 'random_code', { length: 32, alphabet: 'hex' })).code).toMatch(/^[0-9a-f]{32}$/)
    expect((await ok(action, 'random_code', { length: 10, alphabet: 'custom', custom_alphabet: 'AB' })).code).toMatch(/^[AB]{10}$/)
    expect((await ok(action, 'random_code', { length: 4, alphabet: 'custom', custom_alphabet: '🍎🍌' })).code).toMatch(/^(?:🍎|🍌){4}$/u)
  })

  it('is roughly uniform over the alphabet', async () => {
    const out = await ok(action, 'random_code', { length: 256, count: 40, alphabet: 'digits' })
    const counts = new Array(10).fill(0)
    for (const c of out.codes) for (const ch of c) counts[Number(ch)]++
    // 10,240 draws: each digit ~1,024; a biased generator would skew 0–5.
    for (const n of counts) expect(n).toBeGreaterThan(850)
  })

  it('rejects bad alphabets', async () => {
    await fails(action, 'random_code', { alphabet: 'custom', custom_alphabet: 'AAAA' }, /at least 2 different/)
    await fails(action, 'random_code', { length: 0 }, /at least 1/)
  })

  it('one-time codes with expiry and hash', async () => {
    const before = Date.now()
    const out = await ok(action, 'otp', { digits: 8, expires_minutes: 15 })
    expect(out.code).toMatch(/^\d{8}$/)
    const exp = Date.parse(out.expires_at)
    expect(exp).toBeGreaterThanOrEqual(before + 15 * 60_000)
    expect(exp).toBeLessThanOrEqual(Date.now() + 15 * 60_000)
    expect(out.code_hash).toBe(createHash('sha256').update(out.code).digest('hex'))
    await fails(action, 'otp', { digits: 3 }, /at least 4/)
  })
})

describe('ut_crypto tokens', () => {
  it('sign → verify round trip with claims, issuer and audience', async () => {
    const signed = await ok(action, 'sign_token', { claims: { role: 'approver', request_id: 'REQ-1042' }, expires_minutes: 60, issuer: 'usertasks', audience: 'approvals', subject: 'user-42' }, mocks)
    expect(signed.jwt.split('.')).toHaveLength(3)
    expect(signed.claims).toMatchObject({ role: 'approver', request_id: 'REQ-1042', iss: 'usertasks', aud: 'approvals', sub: 'user-42' })
    expect(signed.claims.exp - signed.claims.iat).toBe(3600)
    expect(signed.claims.jti).toMatch(/^[0-9a-f-]{36}$/)
    expect(Date.parse(signed.expires_at)).toBe(signed.claims.exp * 1000)
    // Independently verifiable with the same secret.
    const [h, p, s] = signed.jwt.split('.')
    expect(createHmac('sha256', 'example-secret').update(`${h}.${p}`).digest('base64url')).toBe(s)
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' })
    const verified = await ok(action, 'verify_token', { jwt: `Bearer ${signed.jwt}`, issuer: 'usertasks', audience: 'approvals' }, mocks)
    expect(verified).toEqual({ valid: true, reason: '', claims: signed.claims, expires_at: signed.expires_at })
  })

  it('tokens without expiry', async () => {
    const signed = await ok(action, 'sign_token', { claims: { a: 1 }, expires_minutes: 0 }, mocks)
    expect(signed.expires_at).toBeNull()
    expect(signed.claims.exp).toBeUndefined()
    expect((await ok(action, 'verify_token', { jwt: signed.jwt }, mocks)).valid).toBe(true)
  })

  it('rejects tampered, wrongly signed and unsupported tokens', async () => {
    const good = jwt({ sub: 'user-42', exp: now() + 600 })
    const [h, , s] = good.split('.')
    const tampered = `${h}.${b64url({ sub: 'admin', exp: now() + 600 })}.${s}`
    expect(await ok(action, 'verify_token', { jwt: tampered }, mocks)).toEqual({ valid: false, reason: 'bad signature', claims: null, expires_at: null })
    expect((await ok(action, 'verify_token', { jwt: jwt({ sub: 'x' }, 'another-secret') }, mocks)).reason).toBe('bad signature')
    expect((await ok(action, 'verify_token', { jwt: jwt({ sub: 'x' }, 'example-secret', { alg: 'none' }) }, mocks)).reason).toMatch(/unsupported algorithm "none"/)
    expect((await ok(action, 'verify_token', { jwt: 'abc.def' }, mocks)).reason).toMatch(/malformed/)
    expect((await ok(action, 'verify_token', { jwt: 'a.b.c' }, mocks)).reason).toMatch(/malformed/)
  })

  it('enforces exp, nbf, issuer and audience', async () => {
    const expired = await ok(action, 'verify_token', { jwt: jwt({ sub: 'x', exp: now() - 120 }) }, mocks)
    expect(expired).toMatchObject({ valid: false, reason: 'expired', claims: { sub: 'x' } })
    expect((await ok(action, 'verify_token', { jwt: jwt({ exp: now() - 10 }) }, mocks)).valid).toBe(true)
    expect((await ok(action, 'verify_token', { jwt: jwt({ exp: now() - 10 }), leeway_seconds: 0 }, mocks)).reason).toBe('expired')
    expect((await ok(action, 'verify_token', { jwt: jwt({ nbf: now() + 600 }) }, mocks)).reason).toMatch(/not yet valid/)
    expect((await ok(action, 'verify_token', { jwt: jwt({ iss: 'someone' }), issuer: 'usertasks' }, mocks)).reason).toBe('issuer does not match')
    expect((await ok(action, 'verify_token', { jwt: jwt({ aud: ['a', 'approvals'] }), audience: 'approvals' }, mocks)).valid).toBe(true)
    expect((await ok(action, 'verify_token', { jwt: jwt({ aud: 'other' }), audience: 'approvals' }, mocks)).reason).toBe('audience does not match')
  })

  it('explains a missing token secret', async () => {
    await fails(action, 'sign_token', { claims: {} }, /sign_token needs the secret "token_secret"/, { secrets: {} })
    await fails(action, 'verify_token', { jwt: jwt({}) }, /verify_token needs the secret "token_secret"/, { secrets: {} })
  })
})
