/**
 * On-premises gateway protocol (v1) — shared by the cloud (lib/gateway/*,
 * app/api/gateway/v1) and the gateway program (packages/gateway, which
 * bundles this file). Pure: node:crypto only, no app imports.
 *
 * Shape of the channel (the gateway only ever dials OUT, over HTTPS):
 *
 *   gateway ──POST /api/gateway/v1/register──▶ cloud   one-time token → key registered
 *   gateway ──POST /api/gateway/v1/poll──────▶ cloud   long poll (≤ 25 s): heartbeat + claims jobs
 *   gateway ──POST /api/gateway/v1/jobs/<id>/result ▶  the answer of one job
 *   gateway ──PUT  /api/gateway/v1/jobs/<id>/parts/<n> large response bodies, in parts
 *   gateway ──GET  /api/gateway/v1/jobs/<id>/request-parts/<n> large request bodies
 *   gateway ──POST /api/gateway/v1/relay─────▶ cloud   an inbound callback (e.g. a SharePoint
 *                                                      remote event receiver) the gateway took
 *                                                      on the customer's network
 *   gateway ──POST /api/gateway/v1/rotate────▶ cloud   swap to a new key (signed with the old one)
 *   gateway ──POST /api/gateway/v1/release───▶ cloud   stopping: hand back claimed jobs not yet started
 *
 * Every request after registration is signed by the gateway instance's own
 * Ed25519 key (REQUEST_SIGNATURE_HEADERS, canonicalRequest): method, path,
 * timestamp, a random nonce and the body's SHA-256. The cloud refuses
 * signatures older / newer than SIGNATURE_WINDOW_MS and any nonce it has seen
 * (replay). Every answer to a signed request is signed by the cloud's
 * Ed25519 key, bound to the request's nonce (canonicalResponse), so a TLS-
 * inspecting proxy or anyone who can write the jobs table cannot make a
 * gateway run a request: jobs only come inside a signed poll answer.
 *
 * A job never carries a URL: it names one of the gateway's TARGETS (ids the
 * customer configured locally, each bound to one origin) and an absolute
 * path. The gateway resolves the path against its own copy of the target and
 * refuses anything that would leave that origin (validateJobPath).
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto'

export const GATEWAY_PROTOCOL_VERSION = 1
export const GATEWAY_API_PREFIX = '/api/gateway/v1'

/** Signed-request headers. */
export const REQUEST_SIGNATURE_HEADERS = {
  key: 'x-utgw-key',
  timestamp: 'x-utgw-timestamp',
  nonce: 'x-utgw-nonce',
  signature: 'x-utgw-signature',
} as const
/** Signed-response headers (cloud → gateway). */
export const RESPONSE_SIGNATURE_HEADERS = {
  keyId: 'x-utgw-cloud-key',
  signature: 'x-utgw-cloud-signature',
} as const

/** A signed request is accepted only within ±60 s of the cloud's clock. */
export const SIGNATURE_WINDOW_MS = 60_000
/** Longest long poll the cloud holds (Vercel functions: maxDuration 60 s). */
export const MAX_POLL_WAIT_MS = 25_000
/** A gateway instance not seen for this long is offline. */
export const INSTANCE_OFFLINE_AFTER_MS = 45_000
/** Bodies above this size travel in parts (each part is base64 in JSON, under the 4.5 MB serverless body limit). */
export const INLINE_BODY_MAX_BYTES = 256 * 1024
export const BODY_PART_BYTES = 2 * 1024 * 1024
/** Hard ceilings (the gateway can be configured lower). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024 * 1024
export const MAX_RESPONSE_BODY_BYTES = 64 * 1024 * 1024
export const MAX_RELAY_BODY_BYTES = 2 * 1024 * 1024
export const MAX_PATH_LENGTH = 8 * 1024
export const MAX_HEADER_COUNT = 64
export const MAX_HEADER_BYTES = 32 * 1024
export const MAX_TARGETS = 50
export const DEFAULT_JOB_TIMEOUT_MS = 60_000
export const MAX_JOB_TIMEOUT_MS = 300_000

export const JOB_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'MERGE', 'OPTIONS'] as const
export type JobMethod = (typeof JOB_METHODS)[number]
/** Methods a job may be re-run for after its gateway instance vanished mid-request. */
export const REPLAYABLE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS'])

export const TARGET_ID_RE = /^[a-z][a-z0-9-]{0,39}$/

/* ── encoding helpers ──────────────────────────────────────────────── */

export function b64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url')
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export function randomNonce(): string {
  return b64url(randomBytes(18))
}

/** JSON with sorted keys (stable bytes for hashing / comparing). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/* ── Ed25519 keys ──────────────────────────────────────────────────── */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

export interface Ed25519KeyPair {
  /** Raw 32-byte public key, base64url. */
  publicKey: string
  /** PKCS#8 PEM. */
  privateKeyPem: string
}

export function generateEd25519(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { publicKey: rawPublicKey(publicKey), privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
}

/** An Ed25519 private key from a 32-byte seed (deterministic). */
export function ed25519FromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new Error('An Ed25519 seed is 32 bytes')
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8' })
}

export function rawPublicKey(key: KeyObject): string {
  const der = (key.type === 'private' ? createPublicKey(key) : key).export({ type: 'spki', format: 'der' }) as Buffer
  return b64url(der.subarray(der.length - 32))
}

export function publicKeyFromRaw(raw: string): KeyObject {
  const bytes = fromB64url(raw)
  if (bytes.length !== 32) throw new Error('An Ed25519 public key is 32 bytes')
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]), format: 'der', type: 'spki' })
}

export function isRawPublicKey(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return false
  try { publicKeyFromRaw(raw); return true } catch { return false }
}

/** Short, stable id of a public key (shown in the UI, used as the cloud key id). */
export function keyFingerprint(rawPublic: string): string {
  return sha256Hex(fromB64url(rawPublic)).slice(0, 16)
}

export function signBytes(privateKey: KeyObject | string, data: string | Uint8Array): string {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey
  return b64url(edSign(null, Buffer.from(data), key))
}

export function verifyBytes(publicKey: KeyObject | string, data: string | Uint8Array, signature: string): boolean {
  try {
    const key = typeof publicKey === 'string' ? publicKeyFromRaw(publicKey) : publicKey
    const sig = fromB64url(signature)
    if (sig.length !== 64) return false
    return edVerify(null, Buffer.from(data), key, sig)
  } catch {
    return false
  }
}

/* ── signed requests / responses ───────────────────────────────────── */

export function canonicalRequest(input: { method: string; path: string; timestamp: string; nonce: string; bodySha256: string }): string {
  return ['UTGW1-REQ', input.method.toUpperCase(), input.path, input.timestamp, input.nonce, input.bodySha256].join('\n')
}

export function canonicalResponse(input: { status: number; requestNonce: string; bodySha256: string }): string {
  return ['UTGW1-RES', String(input.status), input.requestNonce, input.bodySha256].join('\n')
}

/** Headers for a gateway → cloud request. */
export function signRequest(input: { keyId: string; privateKey: KeyObject | string; method: string; path: string; body: Uint8Array | string; now?: number; nonce?: string }): Record<string, string> {
  const timestamp = String(input.now ?? Date.now())
  const nonce = input.nonce ?? randomNonce()
  const signature = signBytes(input.privateKey, canonicalRequest({ method: input.method, path: input.path, timestamp, nonce, bodySha256: sha256Hex(input.body) }))
  return {
    [REQUEST_SIGNATURE_HEADERS.key]: input.keyId,
    [REQUEST_SIGNATURE_HEADERS.timestamp]: timestamp,
    [REQUEST_SIGNATURE_HEADERS.nonce]: nonce,
    [REQUEST_SIGNATURE_HEADERS.signature]: signature,
  }
}

export type SignatureProblem = 'missing_headers' | 'bad_timestamp' | 'stale' | 'bad_nonce' | 'bad_signature'

export interface SignedRequestParts {
  keyId: string
  timestamp: string
  nonce: string
  signature: string
}

/** Pull the signature headers out (null when any is missing or malformed). */
export function readSignatureHeaders(get: (name: string) => string | null | undefined): SignedRequestParts | null {
  const keyId = get(REQUEST_SIGNATURE_HEADERS.key) ?? ''
  const timestamp = get(REQUEST_SIGNATURE_HEADERS.timestamp) ?? ''
  const nonce = get(REQUEST_SIGNATURE_HEADERS.nonce) ?? ''
  const signature = get(REQUEST_SIGNATURE_HEADERS.signature) ?? ''
  if (!keyId || !timestamp || !nonce || !signature) return null
  if (!/^[0-9a-f-]{36}$/i.test(keyId)) return null
  return { keyId, timestamp, nonce, signature }
}

/** Verify one signed request (the nonce replay check is the caller's: it needs storage). */
export function verifyRequestSignature(input: {
  parts: SignedRequestParts
  publicKey: string
  method: string
  path: string
  body: Uint8Array | string
  now?: number
}): { ok: true } | { ok: false; problem: SignatureProblem } {
  const { parts } = input
  if (!/^\d{10,16}$/.test(parts.timestamp)) return { ok: false, problem: 'bad_timestamp' }
  if (Math.abs((input.now ?? Date.now()) - Number(parts.timestamp)) > SIGNATURE_WINDOW_MS) return { ok: false, problem: 'stale' }
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(parts.nonce)) return { ok: false, problem: 'bad_nonce' }
  const data = canonicalRequest({ method: input.method, path: input.path, timestamp: parts.timestamp, nonce: parts.nonce, bodySha256: sha256Hex(input.body) })
  return verifyBytes(input.publicKey, data, parts.signature) ? { ok: true } : { ok: false, problem: 'bad_signature' }
}

/* ── jobs ──────────────────────────────────────────────────────────── */

export interface JobBodyRef {
  /** Inline body (base64), when small. */
  inline?: string
  /** Number of parts to fetch (GET …/request-parts/<n>, n from 0), when large. */
  parts?: number
  size: number
  sha256: string
}

/** One HTTP request the cloud asks a gateway to run against one of its targets. */
export interface GatewayJob {
  v: 1
  id: string
  gatewayId: string
  target: string
  method: JobMethod
  /** Absolute path + query on the target's origin (never a URL). */
  path: string
  headers: Record<string, string>
  body: JobBodyRef | null
  /** Send without the target's credentials (TLS trust and proxy only). */
  anonymous: boolean
  issuedAt: number
  expiresAt: number
  attempt: number
}

export interface GatewayJobResult {
  status: number
  headers: Record<string, string>
  body: JobBodyRef | null
  /** Set instead of status when the request could not be made. */
  error?: { code: string; message: string } | null
  /** Milliseconds the gateway spent on the request (its own clock). */
  durationMs: number
}

export interface GatewayTargetAdvert {
  id: string
  /** scheme://host[:port] — what the cloud maps connection URLs onto. */
  origin: string
}

export interface GatewayStatusReport {
  version: string
  protocol: number
  platform: string
  hostname: string
  instanceName: string
  targets: GatewayTargetAdvert[]
  /** The address the gateway's relay listener is reached at on the customer's network (null = relay off). */
  relayUrl: string | null
  inflight: number
  capacity: number
  /** Security events since the last poll (allowlist refusals, bad cloud signatures …), at most 50. */
  events?: Array<{ type: string; message: string; at: number; detail?: Record<string, unknown> }>
}

export interface PollRequest {
  waitMs: number
  max: number
  status: GatewayStatusReport
}

export interface PollResponse {
  jobs: GatewayJob[]
  /** Cloud keys the gateway should trust from now on (rolls of the cloud key; only honoured inside a response signed by an already trusted key). */
  cloudKeys: Array<{ id: string; publicKey: string }>
  latestVersion: string | null
  minVersion: string | null
  /** The gateway was revoked / its key was rotated: stop. */
  stop?: { reason: string }
}

/* ── validation (both sides) ───────────────────────────────────────── */

/** Hop-by-hop and transport headers a job / relay may never set. */
const FORBIDDEN_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'content-length', 'expect', 'proxy-authorization', 'proxy-authenticate', 'forwarded', 'x-forwarded-for',
  'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'cookie', 'set-cookie',
])
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/

/**
 * Keep the headers a job may carry: drops hop-by-hop / transport headers,
 * cookies, invalid names and values with CR / LF / NUL; `authorization`
 * only when allowed. Lower-cased names.
 */
export function sanitizeHeaders(headers: Record<string, string>, options: { allowAuthorization: boolean }): Record<string, string> {
  const out: Record<string, string> = {}
  let bytes = 0
  for (const [rawName, rawValue] of Object.entries(headers ?? {})) {
    const name = rawName.toLowerCase()
    if (!HEADER_NAME_RE.test(name) || FORBIDDEN_HEADERS.has(name) || name.startsWith('x-utgw-')) continue
    if (name === 'authorization' && !options.allowAuthorization) continue
    const value = String(rawValue ?? '')
    if (/[\r\n\0]/.test(value)) continue
    bytes += name.length + value.length
    if (bytes > MAX_HEADER_BYTES || Object.keys(out).length >= MAX_HEADER_COUNT) break
    out[name] = value
  }
  return out
}

/**
 * A job path: absolute (`/…`), no scheme / authority (`//host`), no
 * backslashes, no control characters, no fragment. Returns the error or null.
 */
export function validateJobPath(path: unknown): string | null {
  if (typeof path !== 'string' || !path) return 'path is required'
  if (path.length > MAX_PATH_LENGTH) return 'path is too long'
  if (!path.startsWith('/') || path.startsWith('//')) return 'path must be absolute (/…) and name no host'
  if (/[\\\0-\x1f\x7f]/.test(path)) return 'path contains forbidden characters'
  if (/#/.test(path)) return 'path must not contain a fragment'
  return null
}

/**
 * Resolve a job path against a target origin; refuses anything that would
 * end up on another origin (the gateway's last line of defence).
 */
export function resolveTargetUrl(origin: string, path: string): URL {
  const problem = validateJobPath(path)
  if (problem) throw new Error(problem)
  const base = new URL(origin)
  const url = new URL(path, base)
  if (url.origin !== base.origin) throw new Error('path leaves the target origin')
  if (url.username || url.password) throw new Error('path must not carry credentials')
  return url
}

/** scheme://host[:port], lower-case, default ports dropped; null when not an http(s) origin. */
export function normaliseOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

/** Compare dotted versions (1.2.10 > 1.2.9). Non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  const pb = String(b).split(/[.+-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** Split a body into parts of BODY_PART_BYTES. */
export function splitParts(body: Buffer): Buffer[] {
  const parts: Buffer[] = []
  for (let i = 0; i < body.length; i += BODY_PART_BYTES) parts.push(body.subarray(i, i + BODY_PART_BYTES))
  return parts.length ? parts : [Buffer.alloc(0)]
}

/** Registration tokens: `utgwr_` + 32 random bytes; only their SHA-256 is stored. */
export const REGISTRATION_TOKEN_PREFIX = 'utgwr_'
export function newRegistrationToken(): string {
  return `${REGISTRATION_TOKEN_PREFIX}${b64url(randomBytes(32))}`
}
export function isRegistrationToken(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(REGISTRATION_TOKEN_PREFIX) && /^[A-Za-z0-9_-]{43}$/.test(value.slice(REGISTRATION_TOKEN_PREFIX.length))
}
