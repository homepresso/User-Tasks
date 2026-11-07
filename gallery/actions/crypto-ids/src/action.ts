/**
 * ut_crypto — Crypto & IDs: UUID v4 / v7, ULID, hashes, HMAC with a stored
 * secret, base64 / hex / URL encoding, random codes, one-time codes and
 * compact HS256 JSON Web Tokens. Randomness and digests come from the host
 * (ctx.crypto, Node's CSPRNG); secret values never enter the sandbox for
 * HMAC (the host resolves secret://name).
 */

import { defineAction, type ActionContext } from '@usertasks/action'
import { bool, choice, num, obj, str, text, type Inputs } from '../../shared/inputs'

const HASHES = ['SHA-256', 'SHA-512', 'SHA-384', 'SHA-1'] as const
const ENCODINGS = ['hex', 'base64', 'base64url'] as const
const FORMATS = ['base64', 'base64url', 'hex', 'url'] as const
const HMAC_KEY = 'secret://hmac_key'
const TOKEN_SECRET = 'secret://token_secret'

// ── Random ──────────────────────────────────────────────────────────────────

/** Random bytes from the host CSPRNG (at most 4096 per host call). */
function randomBytes(ctx: ActionContext, n: number): number[] {
  const out: number[] = []
  while (out.length < n) {
    const take = Math.min(4096, n - out.length)
    const hex = ctx.crypto.randomBytes(take, 'hex')
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
  }
  return out
}

const toBig = (bytes: number[]) => bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)

/** Uniform random strings over an alphabet (rejection sampling: no modulo bias). */
function randomStrings(ctx: ActionContext, alphabet: string[], length: number, count: number): string[] {
  const n = alphabet.length
  const limit = 256 - (256 % n)
  const out: string[] = []
  let pool: number[] = []
  for (let c = 0; c < count; c++) {
    const chars: string[] = []
    while (chars.length < length) {
      if (pool.length === 0) pool = randomBytes(ctx, Math.min(4096, Math.ceil(length * (count - c) * 1.3) + 16))
      const b = pool.pop()!
      if (b < limit) chars.push(alphabet[b % n])
    }
    out.push(chars.join(''))
  }
  return out
}

// ── UUID / ULID ─────────────────────────────────────────────────────────────

function uuidFromBig(v: bigint): string {
  const hex = v.toString(16).padStart(32, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const RAND74_MAX = (1n << 74n) - 1n

/** UUID v7 (RFC 9562): 48-bit Unix ms, then 74 random bits; monotonic within a call (counter in the random bits). */
function uuidV7(ctx: ActionContext, count: number): string[] {
  const out: string[] = []
  let lastMs = -1
  let rand = 0n
  for (let i = 0; i < count; i++) {
    let ms = Date.now()
    if (ms <= lastMs) {
      ms = lastMs
      rand += 1n
      if (rand > RAND74_MAX) { ms = lastMs + 1; rand = toBig(randomBytes(ctx, 10)) & (RAND74_MAX >> 1n) }
    } else {
      // Top bit clear leaves room to count up within the millisecond.
      rand = toBig(randomBytes(ctx, 10)) & (RAND74_MAX >> 1n)
    }
    lastMs = ms
    const randA = rand >> 62n
    const randB = rand & ((1n << 62n) - 1n)
    const v = (BigInt(ms) << 80n) | (7n << 76n) | (randA << 64n) | (2n << 62n) | randB
    out.push(uuidFromBig(v))
  }
  return out
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RAND80_MAX = (1n << 80n) - 1n

function crockford(v: bigint, chars: number): string {
  let s = ''
  for (let i = 0; i < chars; i++) {
    s = CROCKFORD[Number(v & 31n)] + s
    v >>= 5n
  }
  return s
}

/** ULID: 10 characters of time + 16 of randomness, Crockford base32; monotonic within a call. */
function ulids(ctx: ActionContext, count: number): string[] {
  const out: string[] = []
  let lastMs = -1
  let rand = 0n
  for (let i = 0; i < count; i++) {
    let ms = Date.now()
    if (ms <= lastMs) {
      ms = lastMs
      rand += 1n
      if (rand > RAND80_MAX) { ms = lastMs + 1; rand = toBig(randomBytes(ctx, 10)) >> 1n }
    } else {
      rand = toBig(randomBytes(ctx, 10)) >> 1n
    }
    lastMs = ms
    out.push(crockford(BigInt(ms), 10) + crockford(rand, 16))
  }
  return out
}

// ── Encoding ────────────────────────────────────────────────────────────────

const b64url = (ctx: ActionContext, s: string) => ctx.crypto.encode(s, 'utf8', 'base64url')

function fromB64url(ctx: ActionContext, s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url')
  return ctx.crypto.encode(s, 'base64url', 'utf8')
}

function checkEncoded(format: (typeof FORMATS)[number], s: string): string {
  const compact = format === 'url' ? s : s.replace(/\s+/g, '')
  const ok = format === 'base64' ? /^[A-Za-z0-9+/]*={0,2}$/.test(compact) && compact.replace(/=+$/, '').length % 4 !== 1
    : format === 'base64url' ? /^[A-Za-z0-9_-]*={0,2}$/.test(compact) && compact.replace(/=+$/, '').length % 4 !== 1
      : format === 'hex' ? /^(?:[0-9a-fA-F]{2})*$/.test(compact)
        : true
  if (!ok) throw new Error(`text is not valid ${format}`)
  return compact
}

/** Run a host HMAC with a declared secret; explain an unset secret. */
async function hmacWith(ctx: ActionContext, alg: (typeof HASHES)[number], ref: string, data: string, encoding: (typeof ENCODINGS)[number]): Promise<string> {
  try {
    return await ctx.crypto.hmac(alg, ref, data, encoding)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const name = ref.replace('secret://', '')
    throw new Error(/secret/i.test(message) ? `${ctx.operation} needs the secret "${name}": ${message}` : message)
  }
}

// ── JWT ─────────────────────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000)
const isoOfSeconds = (s: unknown) => (typeof s === 'number' && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null)

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    uuid(inputs: Inputs, ctx: ActionContext) {
      const version = choice(inputs, 'version', ['v4', 'v7'] as const, 'v4')
      const count = num(inputs, 'count', { integer: true, min: 1, max: 1000, default: 1 })
      const uppercase = bool(inputs, 'uppercase', false)
      let uuids = version === 'v7' ? uuidV7(ctx, count) : Array.from({ length: count }, () => ctx.crypto.randomUUID())
      if (uppercase) uuids = uuids.map((u) => u.toUpperCase())
      return { uuid: uuids[0], uuids }
    },

    ulid(inputs: Inputs, ctx: ActionContext) {
      const count = num(inputs, 'count', { integer: true, min: 1, max: 1000, default: 1 })
      const list = ulids(ctx, count)
      return { ulid: list[0], ulids: list }
    },

    hash(inputs: Inputs, ctx: ActionContext) {
      const value = text(inputs, 'text', { max: 5_000_000 })
      const algorithm = choice(inputs, 'algorithm', HASHES, 'SHA-256')
      const encoding = choice(inputs, 'encoding', ENCODINGS, 'hex')
      return { hash: ctx.crypto.digest(algorithm, value, encoding), algorithm }
    },

    async hmac(inputs: Inputs, ctx: ActionContext) {
      const message = text(inputs, 'message', { max: 5_000_000 })
      const algorithm = choice(inputs, 'algorithm', HASHES, 'SHA-256')
      const encoding = choice(inputs, 'encoding', ENCODINGS, 'hex')
      const signature = await hmacWith(ctx, algorithm, HMAC_KEY, message, encoding)
      let expected = str(inputs, 'expected')
      let matches: boolean | null = null
      if (expected) {
        // Webhook headers often prefix the algorithm: sha256=…
        expected = expected.replace(/^(?:sha(?:1|256|384|512)|v\d)=/i, '')
        if (encoding === 'hex') expected = expected.toLowerCase()
        matches = ctx.crypto.timingSafeEqual(signature, expected)
      }
      return { signature, matches }
    },

    encode(inputs: Inputs, ctx: ActionContext) {
      const value = text(inputs, 'text', { max: 5_000_000 })
      const format = choice(inputs, 'format', FORMATS, 'base64')
      return { result: format === 'url' ? encodeURIComponent(value) : ctx.crypto.encode(value, 'utf8', format) }
    },

    decode(inputs: Inputs, ctx: ActionContext) {
      const value = text(inputs, 'text', { max: 5_000_000 })
      const format = choice(inputs, 'format', FORMATS, 'base64')
      const compact = checkEncoded(format, value)
      if (format === 'url') {
        try {
          return { result: decodeURIComponent(compact.replace(/\+/g, bool(inputs, 'plus_as_space', false) ? ' ' : '+')) }
        } catch {
          throw new Error('text has a broken %-escape (URL decoding failed)')
        }
      }
      return { result: ctx.crypto.encode(compact, format, 'utf8') }
    },

    random_code(inputs: Inputs, ctx: ActionContext) {
      const length = num(inputs, 'length', { integer: true, min: 1, max: 256, default: 8 })
      const count = num(inputs, 'count', { integer: true, min: 1, max: 1000, default: 1 })
      const preset = choice(inputs, 'alphabet', ['no_lookalikes', 'digits', 'alphanumeric', 'alphanumeric_upper', 'letters_upper', 'hex', 'custom'] as const, 'no_lookalikes')
      const presets: Record<string, string> = {
        digits: '0123456789',
        alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        alphanumeric_upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        letters_upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        hex: '0123456789abcdef',
        // No 0/O, 1/I/L: safe to read aloud or type from paper.
        no_lookalikes: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
      }
      const alphabet = Array.from(new Set(Array.from(preset === 'custom' ? str(inputs, 'custom_alphabet', { trim: false }) : presets[preset])))
      if (alphabet.length < 2) throw new Error('custom_alphabet needs at least 2 different characters')
      if (alphabet.length > 256) throw new Error('custom_alphabet has more than 256 characters')
      const group = num(inputs, 'group_size', { integer: true, min: 0, max: 64, default: 0 })
      const separator = str(inputs, 'separator', { default: '-', trim: false })
      const codes = randomStrings(ctx, alphabet, length, count).map((code) => {
        if (!group) return code
        const chars = Array.from(code)
        const parts: string[] = []
        for (let i = 0; i < chars.length; i += group) parts.push(chars.slice(i, i + group).join(''))
        return parts.join(separator)
      })
      return { code: codes[0], codes }
    },

    otp(inputs: Inputs, ctx: ActionContext) {
      const digits = num(inputs, 'digits', { integer: true, min: 4, max: 10, default: 6 })
      const minutes = num(inputs, 'expires_minutes', { integer: true, min: 1, max: 10080, default: 10 })
      const [code] = randomStrings(ctx, Array.from('0123456789'), digits, 1)
      return {
        code,
        expires_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        code_hash: ctx.crypto.digest('SHA-256', code, 'hex'),
      }
    },

    async sign_token(inputs: Inputs, ctx: ActionContext) {
      const claims = obj(inputs, 'claims')
      const minutes = num(inputs, 'expires_minutes', { integer: true, min: 0, max: 525_600, default: 60 })
      const issuer = str(inputs, 'issuer')
      const audience = str(inputs, 'audience')
      const subject = str(inputs, 'subject')
      const iat = nowSeconds()
      const payload: Record<string, unknown> = {
        ...claims,
        iat,
        ...(minutes > 0 ? { exp: iat + minutes * 60 } : {}),
        ...(issuer ? { iss: issuer } : {}),
        ...(audience ? { aud: audience } : {}),
        ...(subject ? { sub: subject } : {}),
        jti: typeof claims.jti === 'string' && claims.jti ? claims.jti : ctx.crypto.randomUUID(),
      }
      const signingInput = `${b64url(ctx, JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(ctx, JSON.stringify(payload))}`
      const signature = await hmacWith(ctx, 'SHA-256', TOKEN_SECRET, signingInput, 'base64url')
      return { jwt: `${signingInput}.${signature}`, expires_at: isoOfSeconds(payload.exp), claims: payload }
    },

    async verify_token(inputs: Inputs, ctx: ActionContext) {
      const token = str(inputs, 'jwt', { required: true, max: 20_000 }).replace(/^Bearer\s+/i, '')
      const issuer = str(inputs, 'issuer')
      const audience = str(inputs, 'audience')
      const leeway = num(inputs, 'leeway_seconds', { integer: true, min: 0, max: 3600, default: 30 })
      const result = (valid: boolean, reason: string, claims: Record<string, unknown> | null) => ({
        valid, reason, claims, expires_at: claims ? isoOfSeconds(claims.exp) : null,
      })
      const parts = token.split('.')
      if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p)) || !parts[0] || !parts[1]) return result(false, 'malformed token (expected header.payload.signature)', null)
      let header: Record<string, unknown>
      let claims: Record<string, unknown>
      try {
        header = JSON.parse(fromB64url(ctx, parts[0]))
        claims = JSON.parse(fromB64url(ctx, parts[1]))
      } catch {
        return result(false, 'malformed token (header or payload is not JSON)', null)
      }
      if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object' || Array.isArray(claims)) return result(false, 'malformed token', null)
      if (header.alg !== 'HS256') return result(false, `unsupported algorithm "${String(header.alg).slice(0, 20)}" (only HS256)`, null)
      const expected = await hmacWith(ctx, 'SHA-256', TOKEN_SECRET, `${parts[0]}.${parts[1]}`, 'base64url')
      if (!ctx.crypto.timingSafeEqual(expected, parts[2])) return result(false, 'bad signature', null)
      const now = nowSeconds()
      if (claims.exp !== undefined && (typeof claims.exp !== 'number' || now > claims.exp + leeway)) return result(false, 'expired', claims)
      if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || now + leeway < claims.nbf)) return result(false, 'not yet valid (nbf)', claims)
      if (issuer && claims.iss !== issuer) return result(false, 'issuer does not match', claims)
      if (audience) {
        const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
        if (!aud.includes(audience)) return result(false, 'audience does not match', claims)
      }
      return result(true, '', claims)
    },
  },
})
