/**
 * E-sign transport and auth (server only).
 *
 *  - Every call goes through lib/integrations/http connectorFetch: egress
 *    guard on every hop, one timeout budget, 429 / 5xx retries with
 *    Retry-After, capped response sizes.
 *  - Auth reuses lib/integrations/attach-auth (static tokens, refresh-token
 *    mints, the OAuth 2.0 connect flow's token store, API keys, basic) and
 *    adds what the e-sign providers need on top: DocuSign JWT Grant and
 *    refresh-token grants that authenticate the client with HTTP Basic
 *    (DocuSign, SignNow). Minted tokens are cached per tenant + credential
 *    hash; a 401 drops the cached token and retries once.
 *  - Errors become EsignError with the provider's message — never request
 *    headers, tokens or keys.
 */

import { createHash, createSign } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'
import { connectorFetch, MAX_BINARY_RESPONSE_BYTES, MAX_STRUCTURED_RESPONSE_BYTES, providerErrorMessage, readCappedBody } from '@/lib/integrations/http'
import { invalidateMintedToken } from '@/lib/integrations/token-mint'
import type { EsignProviderId } from './catalog'
import { EsignError, esignErrorCodeFor } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON is free-form */

/** Non-secret connector settings an adapter reads (from the integration's template_vars). */
export type EsignSettings = Record<string, string>

export interface EsignContext {
  provider: EsignProviderId
  tenantId: string
  integrationId: string
  settings: EsignSettings
  /** Decrypted integration config (auth_type / auth_config / base_url). */
  integrationConfig: Record<string, any>
  supabase?: SupabaseClient | null
  timeoutMs: number
  /** Tests: deterministic clock / no real waits. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export function settingsFrom(integrationConfig: Record<string, any>): EsignSettings {
  const vars = integrationConfig?.template_vars && typeof integrationConfig.template_vars === 'object' ? integrationConfig.template_vars : {}
  const out: EsignSettings = {}
  for (const [k, v] of Object.entries(vars)) if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  return out
}

/* ── Token cache for the e-sign specific mints ─────────────────────── */

interface Cached { token: string; expiresAt: number }
const cache = new Map<string, Cached>()
const inflight = new Map<string, Promise<string>>()
const SKEW_MS = 60_000

function cacheKey(kind: string, tenantId: string | null, parts: unknown[]): string {
  return `${kind}:${tenantId ?? '-'}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`
}

async function cachedToken(key: string, mint: () => Promise<{ token: string; expiresInSec: number }>): Promise<string> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt - SKEW_MS > Date.now()) return hit.token
  const pending = inflight.get(key)
  if (pending) return pending
  const p = (async () => {
    try {
      const { token, expiresInSec } = await mint()
      if (cache.size > 1000) cache.clear()
      cache.set(key, { token, expiresAt: Date.now() + Math.max(60, expiresInSec) * 1000 })
      return token
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

export function clearEsignTokenCache(): void {
  cache.clear()
  inflight.clear()
  discoveryCache.clear()
}

function invalidate(key: string | undefined) {
  if (!key) return
  cache.delete(key)
  invalidateMintedToken(key)
}

async function postTokenForm(url: string, form: Record<string, string>, label: string, basic?: { id: string; secret: string }): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`
  const res = await connectorFetch(url, { method: 'POST', headers, body: new URLSearchParams(form).toString() }, { timeoutMs: 15_000, maxAttempts: 2 })
  const text = (await readCappedBody(res, 1024 * 1024)).toString('utf8')
  let payload: any = null
  try { payload = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok || !payload?.access_token) {
    const detail = providerErrorMessage(payload) ?? `HTTP ${res.status}`
    if (payload?.error === 'consent_required') {
      throw new EsignError('unauthorized', `${label}: the user has not granted consent to this integration key yet (consent_required). Open the consent URL from the connector docs once, then retry.`, { status: res.status, providerCode: 'consent_required', retryable: false })
    }
    throw new EsignError('unauthorized', `${label} token request failed: ${detail}`, { status: res.status, providerCode: payload?.error ?? null, retryable: res.status >= 500 })
  }
  return payload
}

/* ── DocuSign ──────────────────────────────────────────────────────── */

export function docusignAuthServer(settings: EsignSettings, authCfg: Record<string, any> = {}): string {
  const override = String(settings.auth_base_url ?? authCfg.auth_base_url ?? '').trim().replace(/\/+$/, '')
  if (override) return override
  const env = String(settings.environment ?? authCfg.environment ?? '').toLowerCase()
  const base = String(settings.base_url ?? '').toLowerCase()
  const demo = env ? env !== 'production' : (!base || base === 'auto' || /demo\.docusign\.net/.test(base))
  return demo ? 'https://account-d.docusign.com' : 'https://account.docusign.com'
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/** RS256 JWT for the DocuSign JWT Grant (exported for tests). */
export function docusignJwtAssertion(opts: { integrationKey: string; userId: string; privateKey: string; authServer: string; scopes?: string; nowSec?: number }): string {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: opts.integrationKey,
    sub: opts.userId,
    aud: new URL(opts.authServer).host,
    iat: now,
    exp: now + 3600,
    scope: opts.scopes || 'signature impersonation',
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const pem = opts.privateKey.includes('\\n') ? opts.privateKey.replace(/\\n/g, '\n') : opts.privateKey
  let signature: Buffer
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(pem)
  } catch {
    throw new EsignError('configuration', 'The DocuSign RSA private key could not be read — paste the whole PEM key (-----BEGIN RSA PRIVATE KEY----- …)', { retryable: false })
  }
  return `${unsigned}.${base64url(signature)}`
}

/* ── Auth ──────────────────────────────────────────────────────────── */

/** Attach auth to `headers`; returns the cache key to drop after a 401. */
export async function applyEsignAuth(ctx: EsignContext, headers: Record<string, string>): Promise<string | undefined> {
  const cfg = ctx.integrationConfig ?? {}
  const auth = (cfg.auth_config ?? {}) as Record<string, any>
  if (cfg.auth_type === 'bearer' && auth._executor === 'docusign_jwt') {
    const integrationKey = String(auth.client_id ?? '').trim()
    const userId = String(auth.user_id ?? '').trim()
    const privateKey = String(auth.private_key ?? '')
    if (!integrationKey || !userId || !privateKey) throw new EsignError('configuration', 'DocuSign JWT Grant needs the integration key, the user ID (GUID) to act as and the RSA private key', { retryable: false })
    const server = docusignAuthServer(ctx.settings, auth)
    const key = cacheKey('ds-jwt', ctx.tenantId, [server, integrationKey, userId, privateKey])
    const token = await cachedToken(key, async () => {
      const payload = await postTokenForm(`${server}/oauth/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: docusignJwtAssertion({ integrationKey, userId, privateKey, authServer: server }),
      }, 'DocuSign JWT Grant')
      return { token: String(payload.access_token), expiresInSec: Number(payload.expires_in) || 3600 }
    })
    headers.Authorization = `Bearer ${token}`
    return key
  }
  if (cfg.auth_type === 'bearer' && auth._executor === 'oauth_refresh' && auth.client_auth === 'basic' && auth.refresh_token && auth.token_url) {
    const tokenUrl = String(auth.token_url)
    const key = cacheKey('esign-refresh', ctx.tenantId, [tokenUrl, auth.refresh_token, auth.client_id, auth.client_secret])
    const token = await cachedToken(key, async () => {
      const payload = await postTokenForm(tokenUrl, { grant_type: 'refresh_token', refresh_token: String(auth.refresh_token) }, 'OAuth refresh',
        { id: String(auth.client_id ?? ''), secret: String(auth.client_secret ?? '') })
      return { token: String(payload.access_token), expiresInSec: Number(payload.expires_in) || 3600 }
    })
    headers.Authorization = `Bearer ${token}`
    return key
  }
  if (cfg.auth_type === 'bearer' && auth._executor === 'oauth_password' && auth.token_url && auth.username) {
    // Resource-owner password grant (SignNow service users); client authenticates with Basic.
    const tokenUrl = String(auth.token_url)
    const key = cacheKey('esign-password', ctx.tenantId, [tokenUrl, auth.username, auth.password, auth.client_id, auth.client_secret])
    const token = await cachedToken(key, async () => {
      const payload = await postTokenForm(tokenUrl, { grant_type: 'password', username: String(auth.username), password: String(auth.password ?? ''), scope: String(auth.scope || '*') }, 'OAuth password grant',
        { id: String(auth.client_id ?? ''), secret: String(auth.client_secret ?? '') })
      return { token: String(payload.access_token), expiresInSec: Number(payload.expires_in) || 3600 }
    })
    headers.Authorization = `Bearer ${token}`
    return key
  }
  const applied = await applyAuthHeaders(cfg, headers, { supabase: ctx.supabase ?? undefined, integrationId: ctx.integrationId, tenantId: ctx.tenantId })
  return applied.mintedTokenKey
}

/** The bearer token alone (discovery calls to account servers). */
async function bearerToken(ctx: EsignContext): Promise<{ token: string; key?: string }> {
  const headers: Record<string, string> = {}
  const key = await applyEsignAuth(ctx, headers)
  const value = headers.Authorization ?? headers.authorization ?? ''
  return { token: value.replace(/^Bearer\s+/i, ''), key }
}

/* ── Discovery (base URIs) ─────────────────────────────────────────── */

const discoveryCache = new Map<string, { value: any; expiresAt: number }>()
const DISCOVERY_TTL_MS = 60 * 60 * 1000

export async function discover<T>(ctx: EsignContext, kind: string, load: () => Promise<T>): Promise<T> {
  const auth = ctx.integrationConfig?.auth_config ?? {}
  const key = cacheKey(`disc-${kind}`, ctx.tenantId, [ctx.integrationId, ctx.settings, auth.client_id ?? '', auth.user_id ?? '', auth.token ?? '', auth.key_value ?? '', auth.refresh_token ?? '', auth.connector_id ?? ''])
  const hit = discoveryCache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.value as T
  const value = await load()
  discoveryCache.set(key, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS })
  return value
}

/** GET a JSON discovery endpoint with the integration's bearer token. */
export async function discoveryGet(ctx: EsignContext, url: string, label: string): Promise<any> {
  let { token, key } = await bearerToken(ctx)
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await connectorFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, { timeoutMs: Math.min(ctx.timeoutMs, 15_000) })
    const text = (await readCappedBody(res, 1024 * 1024)).toString('utf8')
    let data: any = null
    try { data = JSON.parse(text) } catch { data = text }
    if (res.status === 401 && key && attempt === 0) {
      invalidate(key)
      ;({ token, key } = await bearerToken(ctx))
      continue
    }
    if (!res.ok) throw new EsignError(esignErrorCodeFor(res.status), `${label} failed: ${providerErrorMessage(data) ?? `HTTP ${res.status}`}`, { status: res.status })
    return data
  }
  throw new EsignError('unauthorized', `${label} failed: the provider rejected the credentials`, { status: 401 })
}

/* ── Requests ──────────────────────────────────────────────────────── */

export interface EsignRequest {
  method?: string
  /** Path under the client's base URL, or an absolute URL on the same origin. */
  path: string
  query?: Record<string, string | number | boolean | undefined | null>
  json?: unknown
  form?: FormData
  urlencoded?: Record<string, string>
  headers?: Record<string, string>
  /** Read the body as bytes (downloads). */
  binary?: boolean
  /** Safe to retry on 5xx / network errors even though the method is not idempotent. */
  idempotencyKey?: string
  /** Statuses that are not errors (e.g. 404 while polling). */
  allowStatus?: number[]
}

export interface EsignResponse {
  status: number
  data: any
  bytes?: Uint8Array
  headers: Headers
}

export class EsignClient {
  constructor(
    readonly ctx: EsignContext,
    readonly baseUrl: string,
    private readonly opts: {
      /** Provider-specific auth instead of the integration's (e.g. a header the adapter builds). */
      auth?: (headers: Record<string, string>) => Promise<string | undefined>
      errorMessage?: (data: any) => string | null
      label: string
    },
  ) {}

  url(path: string, query?: EsignRequest['query']): string {
    let full: URL
    if (/^https?:\/\//i.test(path)) {
      full = new URL(path)
      const base = new URL(this.baseUrl)
      // Credentials never follow a link to another origin.
      if (full.origin !== base.origin) throw new EsignError('validation', `Refusing to call ${full.origin}: not the ${this.opts.label} API origin`, { retryable: false })
    } else {
      full = new URL(path ? `${this.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}` : this.baseUrl)
    }
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === null || v === '') continue
      full.searchParams.set(k, String(v))
    }
    return full.toString()
  }

  async request(req: EsignRequest): Promise<EsignResponse> {
    const method = (req.method ?? 'GET').toUpperCase()
    const url = this.url(req.path, req.query)
    let body: BodyInit | undefined
    const baseHeaders: Record<string, string> = { Accept: req.binary ? '*/*' : 'application/json', ...(req.headers ?? {}) }
    if (req.json !== undefined) {
      body = JSON.stringify(req.json)
      baseHeaders['Content-Type'] = 'application/json'
    } else if (req.form) {
      body = req.form
    } else if (req.urlencoded) {
      body = new URLSearchParams(req.urlencoded).toString()
      baseHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
    }
    if (req.idempotencyKey) baseHeaders['Idempotency-Key'] = req.idempotencyKey

    const authorize = this.opts.auth ?? ((h: Record<string, string>) => applyEsignAuth(this.ctx, h))
    let headers = { ...baseHeaders }
    let mintedKey = await authorize(headers)
    let res = await this.send(url, method, headers, body)
    if (res.status === 401 && mintedKey) {
      await res.body?.cancel().catch(() => {})
      invalidate(mintedKey)
      headers = { ...baseHeaders }
      mintedKey = await authorize(headers)
      res = await this.send(url, method, headers, body)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (req.binary && res.ok) {
      const bytes = new Uint8Array(await readCappedBody(res, MAX_BINARY_RESPONSE_BYTES))
      return { status: res.status, data: null, bytes, headers: res.headers }
    }
    const raw = await readCappedBody(res, MAX_STRUCTURED_RESPONSE_BYTES)
    let data: any = null
    const text = raw.toString('utf8')
    if (text) {
      if (/json/i.test(contentType) || /^[\s]*[[{]/.test(text)) {
        try { data = JSON.parse(text) } catch { data = text }
      } else data = text
    }
    if (!res.ok && !(req.allowStatus ?? []).includes(res.status)) {
      const detail = this.opts.errorMessage?.(data) ?? providerErrorMessage(data) ?? `HTTP ${res.status}`
      const providerCode = typeof data === 'object' && data ? String(data.errorCode ?? data.code ?? data.error?.error_name ?? data.type ?? '') || null : null
      throw new EsignError(esignErrorCodeFor(res.status), `${this.opts.label}: ${detail}${res.status === 429 ? ' (rate limited — retry later)' : ''}`, { status: res.status, providerCode })
    }
    return { status: res.status, data, headers: res.headers }
  }

  async json(req: EsignRequest): Promise<any> {
    return (await this.request(req)).data
  }

  private async send(url: string, method: string, headers: Record<string, string>, body: BodyInit | undefined): Promise<Response> {
    try {
      return await connectorFetch(url, { method, headers, body }, { timeoutMs: this.ctx.timeoutMs, sleep: this.ctx.sleep })
    } catch (error: any) {
      if (error?.name === 'EgressBlockedError') throw new EsignError('configuration', String(error.message), { retryable: false })
      if (error?.name === 'ConnectorTimeoutError') throw new EsignError('provider_unavailable', `${this.opts.label}: ${error.message}`)
      throw new EsignError('provider_unavailable', `${this.opts.label}: the request failed (${error?.message ?? 'network error'})`)
    }
  }
}

/* ── Small helpers for adapters ────────────────────────────────────── */

export function isoOrNull(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  if (typeof value === 'string' && /^\d{9,13}$/.test(value)) return isoOrNull(Number(value))
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function splitName(name: string): { first: string; last: string } {
  const parts = String(name ?? '').trim().split(/\s+/)
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

export function extOf(name: string, mime: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name)
  if (m) return m[1].toLowerCase()
  if (/pdf/i.test(mime)) return 'pdf'
  if (/word/i.test(mime)) return 'docx'
  return 'pdf'
}

export function plainObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

/** Deep-merge "Advanced" provider fields into a request body (objects merge, everything else replaces). */
export function mergeAdvanced<T extends Record<string, any>>(body: T, advanced: Record<string, unknown> | undefined): T {
  if (!advanced) return body
  const out: Record<string, any> = { ...body }
  for (const [k, v] of Object.entries(advanced)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = mergeAdvanced(out[k], v as Record<string, unknown>)
    else out[k] = v
  }
  return out as T
}
