import crypto from 'node:crypto'
import { PgrstError } from './errors'
import type { Identity } from './handler'

/**
 * JWT verification the way PostgREST does it before every request: check the
 * signature (HS256/384/512 with the shared secret, or RS/ES/PS/EdDSA keys
 * from a JWKS), then exp / nbf / iat (30 s clock skew) and optionally aud.
 * The verified payload becomes request.jwt.claims; its `role` picks the
 * database role (the anon role when absent). Verified tokens are cached
 * until they expire, so repeated queries in a request cost nothing.
 */

export interface Jwk {
  kty: string
  kid?: string
  alg?: string
  [k: string]: unknown
}

export interface JwtVerifierOptions {
  /** Shared secret for HS* tokens (PostgREST jwt-secret). */
  secret?: string
  /** URL of a JWKS document (e.g. Supabase's /auth/v1/.well-known/jwks.json). */
  jwksUrl?: string
  /** Static JWKS, instead of / in addition to jwksUrl. */
  jwks?: { keys: Jwk[] }
  /** Expected `aud` (PostgREST jwt-aud). Unset: not checked. */
  audience?: string
  anonRole?: string
  fetch?: typeof fetch
  /**
   * Last resort for tokens no configured key can check (e.g. HS256 user
   * tokens when the shared secret isn't configured): ask the issuer, e.g.
   * Supabase Auth's /user endpoint. Returning false rejects the token.
   */
  fallbackVerify?: (token: string) => Promise<boolean>
  /** Max cached verified tokens. */
  cacheSize?: number
}

const SKEW = 30

function decodeErr(message: string, details: string | null = null): PgrstError {
  return new PgrstError(401, { code: 'PGRST301', message, details, hint: null })
}

function claimsErr(message: string): PgrstError {
  return new PgrstError(401, { code: 'PGRST303', message, details: null, hint: null })
}

function b64json(part: string): Record<string, unknown> {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    // fall through
  }
  throw decodeErr("JWT couldn't be decoded")
}

/** Payload of a JWT without verifying it (for trusted, configured keys only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return b64json(parts[1])
  } catch {
    return null
  }
}

const HASH: Record<string, string> = { '256': 'sha256', '384': 'sha384', '512': 'sha512' }

export class JwtVerifier {
  private jwks: Jwk[] = []
  private jwksLoadedAt = 0
  private jwksLoading: Promise<void> | null = null
  private readonly cache = new Map<string, { claims: Record<string, unknown>; until: number }>()

  constructor(private readonly opts: JwtVerifierOptions) {
    if (opts.jwks) this.jwks = [...opts.jwks.keys]
  }

  /** Identity (role + claims) for a bearer token; throws PGRST301/303 like PostgREST. */
  async identity(token: string): Promise<Identity> {
    const claims = await this.verify(token)
    const role = typeof claims.role === 'string' && claims.role ? claims.role : (this.opts.anonRole ?? 'anon')
    return { role, claims }
  }

  async verify(token: string): Promise<Record<string, unknown>> {
    const now = Math.floor(Date.now() / 1000)
    const hit = this.cache.get(token)
    if (hit && hit.until > now) return hit.claims
    if (token === '') throw decodeErr('Empty JWT is sent in Authorization header')
    const parts = token.split('.')
    if (parts.length !== 3) throw decodeErr(`Expected 3 parts in JWT; got ${parts.length}`)
    const header = b64json(parts[0])
    const claims = b64json(parts[1])
    const alg = String(header.alg ?? '')
    const data = Buffer.from(`${parts[0]}.${parts[1]}`)
    const sig = Buffer.from(parts[2], 'base64url')
    let valid: boolean
    try {
      valid = await this.checkSignature(alg, header.kid as string | undefined, data, sig)
    } catch (err) {
      const noKey = err instanceof PgrstError && err.body.message === 'No suitable key or wrong key type'
      if (!noKey || !this.opts.fallbackVerify) throw err
      valid = await this.opts.fallbackVerify(token)
    }
    if (!valid) throw decodeErr('JWT cryptographic operation failed')
    for (const [key, msg] of [['exp', "The JWT 'exp' claim must be a number"], ['nbf', "The JWT 'nbf' claim must be a number"], ['iat', "The JWT 'iat' claim must be a number"]] as const) {
      if (claims[key] !== undefined && typeof claims[key] !== 'number') throw claimsErr(msg)
    }
    if (typeof claims.exp === 'number' && now - SKEW > claims.exp) throw claimsErr('JWT expired')
    if (typeof claims.nbf === 'number' && now + SKEW < claims.nbf) throw claimsErr('JWT not yet valid')
    if (typeof claims.iat === 'number' && now + SKEW < claims.iat) throw claimsErr('JWT issued at future')
    if (this.opts.audience !== undefined && claims.aud !== undefined) {
      const aud = claims.aud
      if (!(typeof aud === 'string' || (Array.isArray(aud) && aud.every((a) => typeof a === 'string')))) {
        throw claimsErr("The JWT 'aud' claim must be a string or an array of strings")
      }
      const list = Array.isArray(aud) ? aud : [aud]
      if (!list.includes(this.opts.audience)) throw claimsErr('JWT not in audience')
    }
    const until = typeof claims.exp === 'number' ? claims.exp + SKEW : now + 300
    if (this.cache.size >= (this.opts.cacheSize ?? 1000)) this.cache.delete(this.cache.keys().next().value as string)
    this.cache.set(token, { claims, until })
    return claims
  }

  private async checkSignature(alg: string, kid: string | undefined, data: Buffer, sig: Buffer): Promise<boolean> {
    const m = /^(HS|RS|PS|ES)(256|384|512)$|^EdDSA$/.exec(alg)
    if (!m) throw decodeErr('Wrong or unsupported encoding algorithm', alg)
    if (m[1] === 'HS') {
      if (!this.opts.secret) throw decodeErr('No suitable key or wrong key type', 'No suitable key was found to decode the JWT')
      const expected = crypto.createHmac(HASH[m[2]], this.opts.secret).update(data).digest()
      return expected.length === sig.length && crypto.timingSafeEqual(expected, sig)
    }
    const jwk = await this.findKey(kid, alg)
    if (!jwk) throw decodeErr('No suitable key or wrong key type', 'No suitable key was found to decode the JWT')
    const key = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' })
    if (alg === 'EdDSA') return crypto.verify(null, data, key, sig)
    const hash = HASH[m[2]]
    if (m[1] === 'ES') return crypto.verify(hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig)
    if (m[1] === 'PS') return crypto.verify(hash, data, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, sig)
    return crypto.verify(hash, data, key, sig)
  }

  private async findKey(kid: string | undefined, alg: string): Promise<Jwk | undefined> {
    const pick = () => this.jwks.find((k) => (kid ? k.kid === kid : !k.alg || k.alg === alg))
    let key = pick()
    // Unknown kid: reload the JWKS (rotation), at most once a minute.
    if (!key && this.opts.jwksUrl && Date.now() - this.jwksLoadedAt > 60_000) {
      await this.loadJwks()
      key = pick()
    }
    return key
  }

  private loadJwks(): Promise<void> {
    if (!this.jwksLoading) {
      const f = this.opts.fetch ?? globalThis.fetch
      this.jwksLoading = f(this.opts.jwksUrl as string)
        .then(async (res) => {
          if (!res.ok) return
          const doc = (await res.json()) as { keys?: Jwk[] }
          if (Array.isArray(doc.keys)) this.jwks = [...(this.opts.jwks?.keys ?? []), ...doc.keys]
        })
        .catch(() => undefined)
        .finally(() => {
          this.jwksLoadedAt = Date.now()
          this.jwksLoading = null
        })
    }
    return this.jwksLoading
  }
}
