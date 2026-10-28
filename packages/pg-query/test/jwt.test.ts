import crypto from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { JwtVerifier, decodeJwtPayload } from '../src/jwt'
import { PgrstError } from '../src/errors'

const SECRET = 'test-secret-with-at-least-32-characters!!'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)

function hs256(payload: Record<string, unknown>, secret = SECRET, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }) {
  const h = b64(header)
  const p = b64(payload)
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
}

function es256Pair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1', alg: 'ES256' }
  const sign = (payload: Record<string, unknown>, kid = 'k1') => {
    const h = b64({ alg: 'ES256', typ: 'JWT', kid })
    const p = b64(payload)
    const sig = crypto.sign('sha256', Buffer.from(`${h}.${p}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    return `${h}.${p}.${sig.toString('base64url')}`
  }
  return { jwk, sign }
}

async function rejects(p: Promise<unknown>, code: string, message?: string) {
  const err = await p.then(() => null, (e) => e)
  expect(err).toBeInstanceOf(PgrstError)
  expect((err as PgrstError).status).toBe(401)
  expect((err as PgrstError).body.code).toBe(code)
  if (message) expect((err as PgrstError).body.message).toBe(message)
}

describe('JwtVerifier (PostgREST-equivalent token checks)', () => {
  const user = { sub: 'u1', role: 'authenticated', exp: now() + 3600 }

  it('accepts a valid HS256 token and maps its role', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    await expect(v.identity(hs256(user))).resolves.toEqual({ role: 'authenticated', claims: user })
  })

  it('uses the anon role when the token has no role claim', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    const { role } = await v.identity(hs256({ sub: 'x', exp: now() + 60 }))
    expect(role).toBe('anon')
  })

  it('rejects a token signed with another secret', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    await rejects(v.verify(hs256(user, 'another-secret-another-secret-another!!')), 'PGRST301', 'JWT cryptographic operation failed')
  })

  it('rejects a tampered payload', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    const [h, , s] = hs256(user).split('.')
    await rejects(v.verify(`${h}.${b64({ ...user, role: 'service_role' })}.${s}`), 'PGRST301')
  })

  it('rejects alg "none" and unsigned tokens', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    await rejects(v.verify(`${b64({ alg: 'none' })}.${b64(user)}.`), 'PGRST301', 'Wrong or unsupported encoding algorithm')
  })

  it('rejects malformed tokens', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    await rejects(v.verify('a.b'), 'PGRST301', 'Expected 3 parts in JWT; got 2')
    await rejects(v.verify(''), 'PGRST301')
  })

  it('rejects expired / not-yet-valid tokens (30 s skew)', async () => {
    const v = new JwtVerifier({ secret: SECRET })
    await rejects(v.verify(hs256({ ...user, exp: now() - 120 })), 'PGRST303', 'JWT expired')
    await rejects(v.verify(hs256({ ...user, nbf: now() + 600 })), 'PGRST303', 'JWT not yet valid')
    await rejects(v.verify(hs256({ ...user, exp: 'tomorrow' })), 'PGRST303')
    await expect(v.verify(hs256({ ...user, exp: now() - 10 }))).resolves.toBeTruthy()
  })

  it('checks the audience only when configured', async () => {
    await expect(new JwtVerifier({ secret: SECRET }).verify(hs256({ ...user, aud: 'other' }))).resolves.toBeTruthy()
    await rejects(new JwtVerifier({ secret: SECRET, audience: 'authenticated' }).verify(hs256({ ...user, aud: 'other' })), 'PGRST303', 'JWT not in audience')
    await expect(new JwtVerifier({ secret: SECRET, audience: 'authenticated' }).verify(hs256({ ...user, aud: ['authenticated'] }))).resolves.toBeTruthy()
  })

  it('HS256 without a secret: no key, unless the fallback vouches for it', async () => {
    await rejects(new JwtVerifier({}).verify(hs256(user)), 'PGRST301', 'No suitable key or wrong key type')
    const fallbackVerify = vi.fn(async () => true)
    await expect(new JwtVerifier({ fallbackVerify }).verify(hs256(user))).resolves.toEqual(user)
    expect(fallbackVerify).toHaveBeenCalledTimes(1)
    await rejects(new JwtVerifier({ fallbackVerify: async () => false }).verify(hs256(user)), 'PGRST301')
  })

  it('verifies ES256 tokens against a JWKS (fetched, by kid)', async () => {
    const { jwk, sign } = es256Pair()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })))
    const v = new JwtVerifier({ jwksUrl: 'https://auth.example/jwks', fetch: fetchMock as unknown as typeof fetch })
    await expect(v.identity(sign(user))).resolves.toMatchObject({ role: 'authenticated' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // A key from another pair with the same kid fails the signature check.
    const other = es256Pair()
    await rejects(v.verify(other.sign({ ...user, sub: 'u2' })), 'PGRST301', 'JWT cryptographic operation failed')
    // Unknown kid and no reload yet allowed: no suitable key.
    await rejects(v.verify(sign(user, 'unknown')), 'PGRST301', 'No suitable key or wrong key type')
  })

  it('caches verified tokens until they expire', async () => {
    const fallbackVerify = vi.fn(async () => true)
    const v = new JwtVerifier({ fallbackVerify })
    const t = hs256(user)
    await v.verify(t)
    await v.verify(t)
    expect(fallbackVerify).toHaveBeenCalledTimes(1)
  })

  it('decodeJwtPayload reads payloads without verifying (trusted keys only)', () => {
    expect(decodeJwtPayload(hs256({ role: 'anon' }))).toEqual({ role: 'anon' })
    expect(decodeJwtPayload('sb_publishable_xyz')).toBeNull()
  })
})
