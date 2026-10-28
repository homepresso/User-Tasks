/**
 * Postgres db provider (lib/providers/db/postgres): the identity a request's
 * bearer token maps to — the security boundary that replaces PostgREST's JWT
 * check. Allowed: configured keys and validly signed, unexpired tokens.
 * Denied: forged, tampered or expired tokens (PostgREST's 401 errors).
 */
import crypto from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const SECRET = 'provider-test-secret-at-least-32-characters'
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function jwt(payload: Record<string, unknown>, secret = SECRET) {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64(payload)
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`
}
const exp = Math.floor(Date.now() / 1000) + 3600
const ANON = jwt({ role: 'anon', iss: 'supabase', exp })
const SERVICE = jwt({ role: 'service_role', iss: 'supabase', exp })

const KEYS = ['DATABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_JWT_SECRET']
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => {
  for (const k of KEYS) delete process.env[k]
  // The pool is created lazily and never connects in these tests.
  process.env.DATABASE_URL = 'postgresql://u:p@127.0.0.1:1/none'
  process.env.SUPABASE_ANON_KEY = ANON
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
  process.env.SUPABASE_JWT_SECRET = SECRET
})

afterAll(async () => {
  const { closePostgresDb } = await import('@/lib/providers/db/postgres')
  await closePostgresDb()
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
})

async function codeOf(p: Promise<unknown>) {
  const err = (await p.then(() => null, (e) => e)) as { status?: number; body?: { code: string } } | null
  return err ? `${err.status} ${err.body?.code}` : 'ok'
}

describe('postgres provider identity', () => {
  it('no token or the anon key → anon, with the anon key\'s claims', async () => {
    const { identityForToken } = await import('@/lib/providers/db/postgres')
    expect(await identityForToken(null)).toEqual({ role: 'anon', claims: { role: 'anon', iss: 'supabase', exp } })
    expect((await identityForToken(ANON)).role).toBe('anon')
    expect(await identityForToken('sb_publishable_abc')).toEqual({ role: 'anon', claims: { role: 'anon' } })
  })

  it('the configured service key → service_role', async () => {
    const { identityForToken, serviceIdentity } = await import('@/lib/providers/db/postgres')
    expect(await identityForToken(SERVICE)).toEqual({ role: 'service_role', claims: { role: 'service_role', iss: 'supabase', exp } })
    expect(serviceIdentity().role).toBe('service_role')
  })

  it('a validly signed session token → its role and claims (auth.uid() = sub)', async () => {
    const { identityForToken } = await import('@/lib/providers/db/postgres')
    const claims = { sub: 'user-1', role: 'authenticated', email: 'a@b.c', exp }
    expect(await identityForToken(jwt(claims))).toEqual({ role: 'authenticated', claims })
  })

  it('denies forged, tampered and expired tokens like PostgREST', async () => {
    const { identityForToken } = await import('@/lib/providers/db/postgres')
    expect(await codeOf(identityForToken(jwt({ sub: 'x', role: 'service_role', exp }, 'wrong-secret-wrong-secret-wrong-secret')))).toBe('401 PGRST301')
    const [h, , s] = jwt({ sub: 'x', role: 'authenticated', exp }).split('.')
    expect(await codeOf(identityForToken(`${h}.${b64({ sub: 'x', role: 'service_role', exp })}.${s}`))).toBe('401 PGRST301')
    expect(await codeOf(identityForToken(jwt({ sub: 'x', role: 'authenticated', exp: 1 })))).toBe('401 PGRST303')
  })

  it('session clients answer an invalid token with a 401 error result (no query runs)', async () => {
    const { postgresFetch } = await import('@/lib/providers/db/postgres')
    const res = await postgresFetch('session')('http://localhost/rest/v1/tasks?select=id', { headers: { Authorization: 'Bearer a.b.c' } })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('PGRST301')
  })
})
