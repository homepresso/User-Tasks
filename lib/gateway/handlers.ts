/**
 * The gateway API (/api/gateway/v1/*, app/api/gateway/v1/[...path]) — what an
 * on-premises gateway instance calls. See lib/gateway/protocol.ts for the
 * channel and its signatures.
 *
 *   POST register                       one-time registration token → active key
 *   POST poll                           heartbeat + long poll for jobs (signed)
 *   POST jobs/<id>/result               a job's answer (signed)
 *   PUT  jobs/<id>/parts/<n>            a part of a large response body (signed)
 *   GET  jobs/<id>/request-parts/<n>    a part of a large request body (signed)
 *   POST relay                          an inbound callback taken by the gateway (signed)
 *   POST rotate                         replace this instance's key (signed with the old key)
 *   POST release                        graceful shutdown: give back claimed jobs not yet running
 *
 * Server-only.
 */
import { NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/providers/db'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { rateLimit } from '@/lib/rate-limit'
import { authenticateGateway, GatewayAuthError, signedJson, type GatewayCaller } from './auth'
import { advertisedCloudKeys, cloudSigningKey, GatewayNotConfiguredError } from './cloud-key'
import { recordGatewayEvent } from './events'
import {
  BODY_PART_BYTES,
  compareVersions,
  GATEWAY_PROTOCOL_VERSION,
  isRawPublicKey,
  isRegistrationToken,
  keyFingerprint,
  MAX_POLL_WAIT_MS,
  MAX_RELAY_BODY_BYTES,
  MAX_RESPONSE_BODY_BYTES,
  MAX_TARGETS,
  normaliseOrigin,
  sanitizeHeaders,
  sha256Hex,
  TARGET_ID_RE,
  validateJobPath,
  type GatewayJobResult,
  type GatewayStatusReport,
  type GatewayTargetAdvert,
  type PollResponse,
} from './protocol'
import { claimJobs, completeJob, GatewayQueueError, isMissingTableError, jobVisibleTo, pollJobs, purgeGatewayData, readPart, releaseClaimed, renewLeases, writePart } from './queue'
import { gatewayVersionPolicy } from './versions'
import { clientIp } from '@/lib/client-ip'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client, untyped tables, JSON bodies */

const db = () => getServiceDb() as any
const MAX_JSON_BODY = 3 * 1024 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function plain(status: number, error: string, code: string): Response {
  return new Response(JSON.stringify({ error, code }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

function clientAddress(request: Request): string {
  return clientIp(request) ?? 'unknown'
}

async function readBody(request: Request, max: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > max) throw new GatewayQueueError('Body too large', 'payload_too_large', 413)
  const buf = Buffer.from(await request.arrayBuffer())
  if (buf.length > max) throw new GatewayQueueError('Body too large', 'payload_too_large', 413)
  return buf
}

function parseJson(body: Buffer): any {
  try { return JSON.parse(body.toString('utf8') || '{}') } catch { throw new GatewayQueueError('Body is not JSON', 'invalid_request', 400) }
}

/** Only https in production; http only for loopback / development. */
function transportAllowed(request: Request): boolean {
  const proto = (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')).split(',')[0].trim()
  if (proto === 'https') return true
  const host = new URL(request.url).hostname
  return process.env.NODE_ENV !== 'production' || host === 'localhost' || host === '127.0.0.1' || process.env.GATEWAY_ALLOW_HTTP === 'true'
}

export async function handleGatewayRequest(request: Request, segments: string[]): Promise<Response> {
  try {
    if (!transportAllowed(request)) return plain(403, 'Gateways must connect over HTTPS', 'tls_required')
    cloudSigningKey()
    const route = segments.join('/')
    if (request.method === 'POST' && route === 'register') return await register(request)
    const url = new URL(request.url)
    const maxBody = request.method === 'PUT' ? BODY_PART_BYTES * 2 : MAX_JSON_BODY
    const body = request.method === 'GET' ? Buffer.alloc(0) : await readBody(request, maxBody)
    const caller = await authenticateGateway({ method: request.method, pathWithQuery: `${url.pathname}${url.search}`, body, get: (n) => request.headers.get(n) })
    const limited = await rateLimit(`gateway:${caller.keyId}`, { max: 1200, windowMs: 60_000 })
    if (!limited.ok) return signedJson({ error: 'Too many requests', code: 'rate_limited' }, 429, caller.nonce)

    if (request.method === 'POST' && route === 'poll') return await poll(request, caller, parseJson(body))
    if (request.method === 'POST' && route === 'relay') return await relay(caller, parseJson(body))
    if (request.method === 'POST' && route === 'rotate') return await rotate(caller, parseJson(body))
    if (request.method === 'POST' && route === 'release') {
      // Graceful shutdown: hand back every job this instance holds but is not running.
      const input = parseJson(body)
      const keep = Array.isArray(input?.running) ? input.running.filter((x: unknown) => typeof x === 'string' && UUID_RE.test(x)).slice(0, 64) : []
      const released = await releaseClaimed(caller.keyId, { except: keep })
      await renewLeases(caller.keyId)
      return signedJson({ released }, 200, caller.nonce)
    }
    const m = /^jobs\/([0-9a-f-]{36})\/(result|parts\/(\d{1,2})|request-parts\/(\d{1,2}))$/i.exec(route)
    if (m && UUID_RE.test(m[1])) {
      const jobId = m[1]
      if (request.method === 'POST' && m[2] === 'result') return await result(caller, jobId, parseJson(body))
      if (request.method === 'PUT' && m[3] !== undefined) {
        if (!(await jobVisibleTo(caller.gatewayId, caller.keyId, jobId))) return signedJson({ error: 'Unknown request', code: 'not_found' }, 404, caller.nonce)
        await writePart(jobId, Number(m[3]), body)
        return signedJson({ ok: true }, 200, caller.nonce)
      }
      if (request.method === 'GET' && m[4] !== undefined) {
        if (!(await jobVisibleTo(caller.gatewayId, caller.keyId, jobId))) return signedJson({ error: 'Unknown request', code: 'not_found' }, 404, caller.nonce)
        const part = await readPart(jobId, 'request', Number(m[4]))
        if (!part) return signedJson({ error: 'Unknown part', code: 'not_found' }, 404, caller.nonce)
        return signedJson({ data: part.toString('base64') }, 200, caller.nonce)
      }
    }
    return signedJson({ error: 'Not found', code: 'not_found' }, 404, caller.nonce)
  } catch (error) {
    if (error instanceof GatewayAuthError) return plain(error.status, error.message, error.code)
    if (error instanceof GatewayNotConfiguredError) return plain(503, error.message, 'gateway_not_configured')
    if (error instanceof GatewayQueueError) return plain(error.status, error.message, error.code)
    console.error('[gateway] API error:', error)
    return plain(500, 'Internal server error', 'internal')
  }
}

/* ── register ──────────────────────────────────────────────────────── */

async function register(request: Request): Promise<Response> {
  const limited = await rateLimit(`gateway-register:${clientAddress(request)}`, { max: 20, windowMs: 10 * 60_000 })
  if (!limited.ok) return plain(429, 'Too many registration attempts', 'rate_limited')
  const input = parseJson(await readBody(request, 64 * 1024))
  if (!isRegistrationToken(input.token)) return plain(401, 'Invalid or expired registration token', 'gateway_unauthorized')
  if (!isRawPublicKey(input.publicKey)) return plain(400, 'publicKey must be a raw Ed25519 public key (base64url)', 'invalid_request')
  const tokenHash = sha256Hex(String(input.token))
  const { data: key, error } = await db().from('gateway_keys').select('id, gateway_id, tenant_id, status, token_expires_at').eq('registration_token_hash', tokenHash).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return plain(503, 'On-premises gateways are not set up on this server', 'gateway_not_installed')
    throw error
  }
  if (!key || key.status !== 'pending' || !key.token_expires_at || Date.parse(key.token_expires_at) < Date.now()) {
    return plain(401, 'Invalid or expired registration token', 'gateway_unauthorized')
  }
  const { data: gateway } = await db().from('gateways').select('id, name, status, tenant_id').eq('id', key.gateway_id).maybeSingle()
  if (!gateway || gateway.status !== 'active') return plain(403, 'This gateway has been revoked', 'gateway_revoked')
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\0]/g, ' ').trim().slice(0, max) : null)
  const { data: updated, error: updError } = await db().from('gateway_keys').update({
    status: 'active',
    public_key: input.publicKey,
    fingerprint: keyFingerprint(input.publicKey),
    registration_token_hash: null,
    token_expires_at: null,
    instance_name: str(input.instanceName, 200),
    hostname: str(input.hostname, 255),
    platform: str(input.platform, 100),
    version: str(input.version, 50),
    registered_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }).eq('id', key.id).eq('status', 'pending').select('id')
  if (updError) {
    if (/duplicate key/i.test(updError.message ?? '')) return plain(409, 'This public key is already registered', 'conflict')
    throw updError
  }
  if (!(updated ?? []).length) return plain(401, 'Invalid or expired registration token', 'gateway_unauthorized')
  await recordGatewayEvent({ tenantId: key.tenant_id, gatewayId: key.gateway_id, keyId: key.id, type: 'instance_registered', message: `Instance ${str(input.instanceName, 200) ?? key.id} registered (key ${keyFingerprint(input.publicKey)})`, detail: { hostname: str(input.hostname, 255), version: str(input.version, 50) } })
  const policy = gatewayVersionPolicy()
  return new Response(JSON.stringify({
    protocol: GATEWAY_PROTOCOL_VERSION,
    gatewayId: key.gateway_id,
    gatewayName: gateway.name,
    keyId: key.id,
    cloudKeys: advertisedCloudKeys(),
    latestVersion: policy.latest,
    minVersion: policy.min,
  }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

/* ── poll ──────────────────────────────────────────────────────────── */

function cleanTargets(raw: unknown): GatewayTargetAdvert[] {
  const out: GatewayTargetAdvert[] = []
  for (const t of Array.isArray(raw) ? raw.slice(0, MAX_TARGETS) : []) {
    const id = typeof t?.id === 'string' ? t.id : ''
    const origin = typeof t?.origin === 'string' ? normaliseOrigin(t.origin) : null
    if (TARGET_ID_RE.test(id) && origin && !out.some((o) => o.id === id)) out.push({ id, origin })
  }
  return out
}

function cleanRelayUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const url = new URL(raw)
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return url.toString().replace(/\/+$/, '')
  } catch { return null }
}

async function poll(request: Request, caller: GatewayCaller, input: any): Promise<Response> {
  const status = (input?.status ?? {}) as Partial<GatewayStatusReport>
  const version = typeof status.version === 'string' ? status.version.slice(0, 50) : null
  const targets = cleanTargets(status.targets)
  const relayUrl = cleanRelayUrl(status.relayUrl)
  const now = new Date().toISOString()
  const report = {
    targets, relayUrl,
    inflight: Number(status.inflight) || 0, capacity: Number(status.capacity) || 0,
    platform: typeof status.platform === 'string' ? status.platform.slice(0, 100) : null,
  }
  await db().from('gateway_keys').update({
    last_seen_at: now, version,
    hostname: typeof status.hostname === 'string' ? status.hostname.slice(0, 255) : undefined,
    instance_name: typeof status.instanceName === 'string' ? status.instanceName.slice(0, 200) : undefined,
    status_report: report,
  }).eq('id', caller.keyId)
  await db().from('gateways').update({ last_seen_at: now, targets, relay_url: relayUrl, version, updated_at: now }).eq('id', caller.gatewayId)
  for (const event of Array.isArray(status.events) ? status.events.slice(0, 50) : []) {
    if (!event || typeof event.type !== 'string' || typeof event.message !== 'string') continue
    await recordGatewayEvent({ tenantId: caller.tenantId, gatewayId: caller.gatewayId, keyId: caller.keyId, type: `gateway.${event.type}`.slice(0, 60), severity: 'warn', message: event.message, detail: event.detail && typeof event.detail === 'object' ? event.detail : undefined })
  }
  // Leases are renewed only by what the instance itself sends (here, at the start of its poll).
  await renewLeases(caller.keyId)
  if (Math.random() < 0.01) void purgeGatewayData().catch(() => {})

  const policy = gatewayVersionPolicy()
  const base: Omit<PollResponse, 'jobs'> = { cloudKeys: advertisedCloudKeys(), latestVersion: policy.latest, minVersion: policy.min }
  if (policy.min && version && compareVersions(version, policy.min) < 0) {
    // Too old to speak this protocol safely: keep it connected (so the UI shows it) but give it no work.
    return signedJson({ ...base, jobs: [] }, 200, caller.nonce)
  }
  const max = Math.max(0, Math.min(64, Number(input?.max) || 0))
  const waitMs = Math.max(0, Math.min(MAX_POLL_WAIT_MS, Number(input?.waitMs) || 0))
  const jobs = waitMs > 0 ? await pollJobs(caller.gatewayId, caller.keyId, max, waitMs, request.signal) : await claimJobs(caller.gatewayId, caller.keyId, max)
  if (jobs.length && request.signal.aborted) {
    await releaseClaimed(caller.keyId, jobs.map((j) => j.id))
    return signedJson({ ...base, jobs: [] }, 200, caller.nonce)
  }
  return signedJson({ ...base, jobs }, 200, caller.nonce)
}

/* ── result ────────────────────────────────────────────────────────── */

async function result(caller: GatewayCaller, jobId: string, input: any): Promise<Response> {
  const res = input as Partial<GatewayJobResult>
  const body = res.body && typeof res.body === 'object' ? res.body : null
  if (body) {
    if (typeof body.size !== 'number' || body.size < 0 || body.size > MAX_RESPONSE_BODY_BYTES) return signedJson({ error: 'Response body too large', code: 'payload_too_large' }, 413, caller.nonce)
    if (typeof body.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) return signedJson({ error: 'Invalid body checksum', code: 'invalid_request' }, 400, caller.nonce)
    if (body.inline === undefined && !(Number.isInteger(body.parts) && body.parts! >= 0 && body.parts! <= 64)) return signedJson({ error: 'Invalid body', code: 'invalid_request' }, 400, caller.nonce)
  }
  const error = res.error && typeof res.error === 'object' ? { code: String(res.error.code ?? 'gateway_error').slice(0, 60), message: String(res.error.message ?? '').slice(0, 1000) } : null
  const status = Number(res.status)
  if (!error && !(Number.isInteger(status) && status >= 100 && status <= 599)) return signedJson({ error: 'Invalid status', code: 'invalid_request' }, 400, caller.nonce)
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.headers && typeof res.headers === 'object' ? res.headers : {})) {
    if (typeof v === 'string' && /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(k) && !/[\r\n\0]/.test(v)) headers[k.toLowerCase()] = v.slice(0, 16 * 1024)
  }
  const stored = await completeJob(caller.gatewayId, caller.keyId, jobId, { status, headers, body: body as GatewayJobResult['body'], error, durationMs: Number(res.durationMs) || 0 })
  return signedJson({ ok: true, stored }, 200, caller.nonce)
}

/* ── relay (inbound callbacks through the gateway) ─────────────────── */

const RELAY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

async function relay(caller: GatewayCaller, input: any): Promise<Response> {
  const method = String(input?.method ?? '').toUpperCase()
  const path = String(input?.path ?? '')
  const problem = validateJobPath(path)
  if (problem || !RELAY_METHODS.has(method)) return signedJson({ error: problem ?? 'Method not allowed', code: 'invalid_request' }, 400, caller.nonce)
  // Only extension inbound routes (receivers, app events) can be reached this way.
  const m = /^\/ext-public\/([a-z][a-z0-9-]{0,40})\/([^?]*)(\?.*)?$/.exec(path)
  if (!m) return signedJson({ error: 'Only /ext-public/<extension>/… can be relayed', code: 'relay_forbidden' }, 403, caller.nonce)
  const bodyBytes = typeof input?.body === 'string' ? Buffer.from(input.body, 'base64') : Buffer.alloc(0)
  if (bodyBytes.length > MAX_RELAY_BODY_BYTES) return signedJson({ error: 'Body too large', code: 'payload_too_large' }, 413, caller.nonce)
  const headers = sanitizeHeaders(input?.headers ?? {}, { allowAuthorization: true })
  headers['x-forwarded-for'] = `gateway:${caller.gatewayId}`
  const base = configuredAppUrl() || 'http://localhost'
  const forwarded = new NextRequest(new URL(path, base), {
    method,
    headers,
    body: method === 'GET' ? undefined : new Uint8Array(bodyBytes),
  })
  const { dispatchPublicRoute } = await import('@/lib/extensions/api')
  const segments = m[2].split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s) } catch { return s } })
  const started = Date.now()
  const answer = await dispatchPublicRoute(forwarded, m[1], segments, { via: { kind: 'gateway', gatewayId: caller.gatewayId, tenantId: caller.tenantId } })
  const answerBody = Buffer.from(await answer.arrayBuffer())
  const outHeaders: Record<string, string> = {}
  answer.headers.forEach((v, k) => { if (/^(content-type|cache-control|location|retry-after|x-[a-z-]+)$/i.test(k)) outHeaders[k] = v })
  return signedJson({ status: answer.status, headers: outHeaders, body: answerBody.subarray(0, MAX_RELAY_BODY_BYTES).toString('base64'), ms: Date.now() - started }, 200, caller.nonce)
}

/* ── rotate ────────────────────────────────────────────────────────── */

async function rotate(caller: GatewayCaller, input: any): Promise<Response> {
  if (!isRawPublicKey(input?.publicKey)) return signedJson({ error: 'publicKey must be a raw Ed25519 public key', code: 'invalid_request' }, 400, caller.nonce)
  const { data: old } = await db().from('gateway_keys').select('label, instance_name, hostname, platform, version, created_by').eq('id', caller.keyId).maybeSingle()
  const now = new Date().toISOString()
  const { data: created, error } = await db().from('gateway_keys').insert({
    gateway_id: caller.gatewayId, tenant_id: caller.tenantId, label: old?.label ?? null, status: 'active',
    public_key: input.publicKey, fingerprint: keyFingerprint(input.publicKey),
    instance_name: old?.instance_name ?? null, hostname: old?.hostname ?? null, platform: old?.platform ?? null, version: old?.version ?? null,
    registered_at: now, last_seen_at: now, rotated_from: caller.keyId, created_by: old?.created_by ?? null,
  }).select('id').single()
  if (error) {
    if (/duplicate key/i.test(error.message ?? '')) return signedJson({ error: 'This public key is already registered', code: 'conflict' }, 409, caller.nonce)
    throw error
  }
  await db().from('gateway_keys').update({ status: 'rotated', revoked_at: now, revoked_reason: `rotated to ${created.id}` }).eq('id', caller.keyId)
  // Jobs this instance holds stay valid under the new key.
  await db().from('gateway_jobs').update({ claimed_by: created.id }).eq('claimed_by', caller.keyId).eq('status', 'claimed')
  await recordGatewayEvent({ tenantId: caller.tenantId, gatewayId: caller.gatewayId, keyId: created.id, type: 'key_rotated', message: `Instance key rotated (new key ${keyFingerprint(input.publicKey)})`, detail: { previous: caller.keyId } })
  return signedJson({ keyId: created.id }, 200, caller.nonce)
}
