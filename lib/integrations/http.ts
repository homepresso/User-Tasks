import { assertSafeEgressUrl, EgressBlockedError } from '@/lib/egress-guard'

/**
 * Outbound HTTP for integrations and connectors (references, token mints,
 * connector probes). One place for the rules every provider call needs:
 *
 *  - Egress: every hop goes through assertSafeEgressUrl. Redirects are
 *    followed manually so a public URL cannot bounce the request (with its
 *    credentials) to a private or metadata address; credential headers are
 *    dropped when a redirect leaves the original origin. A hop the
 *    private-network allowlist admits (EGRESS_PRIVATE_ALLOW) is sent with a
 *    fetch that re-checks DNS answers at connect time (no rebinding window),
 *    unless the caller supplied its own transport (which must do the same,
 *    as the Windows transport does).
 *  - Timeouts: one budget for the whole call, retries included.
 *  - Retries: 429 is retried for every method (rate-limited requests are not
 *    processed); 502/503/504 and network errors only for idempotent methods
 *    or requests carrying an Idempotency-Key. Retry-After (seconds or an
 *    HTTP date) is honoured when it fits the remaining budget; otherwise the
 *    response is returned as-is. Exponential backoff with jitter.
 *  - Size: readCappedBody refuses bodies over a limit instead of buffering
 *    an unbounded response into memory.
 *
 * Server-only.
 */

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_ATTEMPTS = 3
/** Structured (JSON / text / XML) response cap. */
export const MAX_STRUCTURED_RESPONSE_BYTES = 20 * 1024 * 1024
/** Binary (file download) response cap — matches the workflow file limit. */
export const MAX_BINARY_RESPONSE_BYTES = 50 * 1024 * 1024

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])
const RETRYABLE_STATUS = new Set([502, 503, 504])
const CREDENTIAL_HEADER_RE = /^(authorization|cookie|proxy-authorization|x-api-key|api-key|x-auth-token|x-access-token)$/i

export class ResponseTooLargeError extends Error {
  constructor(limit: number) {
    super(`The response is larger than the ${Math.round(limit / (1024 * 1024))} MB limit for integration calls`)
    this.name = 'ResponseTooLargeError'
  }
}

export class ConnectorTimeoutError extends Error {
  constructor(ms: number, target: string) {
    super(`The request to ${target} timed out after ${Math.round(ms / 1000)}s`)
    this.name = 'ConnectorTimeoutError'
  }
}

export interface ConnectorFetchOptions {
  /** Whole-call budget in ms, retries and backoff included. */
  timeoutMs?: number
  /** Attempts in total (1 = no retry). */
  maxAttempts?: number
  /** 'never' turns retries off (e.g. non-replayable streaming bodies). */
  retry?: 'auto' | 'never'
  maxRedirects?: number
  fetchImpl?: typeof fetch
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>
  /** Skip the egress guard — only for fixed, first-party provider endpoints that are not user-supplied. */
  skipEgressCheck?: boolean
}

let guardedFetchPromise: Promise<typeof fetch> | null = null
/** Connect-time-checked fetch for allowlisted private targets (loaded on first use: node:http code). */
function guardedFetch(): Promise<typeof fetch> {
  guardedFetchPromise ??= import('./windows-auth/transport').then((m) => m.createGuardedFetch())
  return guardedFetchPromise
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function headerValue(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null
  const lower = name.toLowerCase()
  if (headers instanceof Headers) return headers.get(name)
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => k.toLowerCase() === lower)
    return hit ? hit[1] : null
  }
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === lower) return String(v)
  return null
}

function withoutCredentialHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const entries = headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers ?? {})
  for (const [k, v] of entries) if (!CREDENTIAL_HEADER_RE.test(k)) out[k] = String(v)
  return out
}

/** Retry-After → milliseconds (null when absent or unparseable). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(0, Math.round(Number(trimmed) * 1000))
  const date = Date.parse(trimmed)
  if (Number.isFinite(date)) return Math.max(0, date - now)
  return null
}

/** Provider rate-limit reset headers some APIs send instead of Retry-After. */
function rateLimitResetMs(res: Response, now = Date.now()): number | null {
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'), now)
  if (retryAfter != null) return retryAfter
  const reset = res.headers.get('x-ratelimit-reset') ?? res.headers.get('ratelimit-reset')
  if (reset && /^\d+$/.test(reset.trim())) {
    const n = Number(reset.trim())
    // Epoch seconds (GitHub/Twilio style) vs delta seconds (IETF draft).
    return n > 1_000_000_000 ? Math.max(0, n * 1000 - now) : n * 1000
  }
  return null
}

function backoffMs(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250)
}

function isReplayableBody(body: BodyInit | null | undefined): boolean {
  if (body == null) return true
  return typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer
    || (typeof FormData !== 'undefined' && body instanceof FormData)
    || (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
    || (typeof Blob !== 'undefined' && body instanceof Blob)
}

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: string })?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/**
 * fetch() for integration traffic: egress-guarded on every hop, bounded by
 * one timeout budget, with rate-limit-aware retries. Returns the final
 * Response (any status) — callers map statuses to results.
 */
export async function connectorFetch(rawUrl: string, init: RequestInit = {}, options: ConnectorFetchOptions = {}): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch
  const customTransport = Boolean(options.fetchImpl)
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const method = String(init.method ?? 'GET').toUpperCase()
  const idempotent = IDEMPOTENT_METHODS.has(method) || Boolean(headerValue(init.headers, 'idempotency-key'))
  const canRetry = options.retry !== 'never' && isReplayableBody(init.body)
  const maxAttempts = canRetry ? Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) : 1
  const maxRedirects = options.maxRedirects ?? 5
  const target = (() => { try { return new URL(rawUrl).host } catch { return 'the service' } })()

  for (let attempt = 1; ; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new ConnectorTimeoutError(timeoutMs, target)
    let res: Response
    try {
      res = await fetchFollowingRedirects(doFetch, rawUrl, { ...init, method }, {
        maxRedirects,
        signal: AbortSignal.timeout(remaining),
        skipEgressCheck: options.skipEgressCheck === true,
        customTransport,
      })
    } catch (error) {
      if (error instanceof EgressBlockedError) throw error
      if (isAbortError(error)) throw new ConnectorTimeoutError(timeoutMs, target)
      const wait = backoffMs(attempt)
      if (idempotent && attempt < maxAttempts && Date.now() + wait < deadline) {
        await sleep(wait)
        continue
      }
      throw error
    }

    const retryable = res.status === 429 || (idempotent && RETRYABLE_STATUS.has(res.status))
    if (!retryable || attempt >= maxAttempts) return res
    const hinted = rateLimitResetMs(res)
    const wait = hinted ?? backoffMs(attempt)
    // A provider asking for a longer pause than we have left: hand back its
    // answer (the caller sees 429 + Retry-After) rather than time out blind.
    if (Date.now() + wait >= deadline - 250) return res
    await res.body?.cancel().catch(() => {})
    await sleep(wait)
  }
}

async function fetchFollowingRedirects(
  doFetch: typeof fetch,
  rawUrl: string,
  init: RequestInit,
  opts: { maxRedirects: number; signal: AbortSignal; skipEgressCheck: boolean; customTransport?: boolean },
): Promise<Response> {
  let current = rawUrl
  let currentInit: RequestInit = { ...init, redirect: 'manual', signal: opts.signal }
  const origin = (() => { try { return new URL(rawUrl).origin } catch { return '' } })()
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const check = !opts.skipEgressCheck || hop > 0 ? await assertSafeEgressUrl(current) : null
    const hopFetch = check?.private === 'allowlist' && !opts.customTransport ? await guardedFetch() : doFetch
    const res = await hopFetch(current, currentInit)
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location || res.status === 304) return res
    await res.body?.cancel().catch(() => {})
    const next = new URL(location, current)
    if (next.origin !== origin) {
      // Never forward credentials to another origin (as browsers do for Authorization).
      currentInit = { ...currentInit, headers: withoutCredentialHeaders(currentInit.headers) }
    }
    const verb = String(currentInit.method ?? 'GET').toUpperCase()
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && verb === 'POST')) {
      const { body: _body, ...rest } = currentInit
      currentInit = { ...rest, method: verb === 'HEAD' ? 'HEAD' : 'GET' }
    }
    current = next.toString()
  }
  throw new EgressBlockedError(rawUrl, 'too many redirects')
}

/** Read a response body into memory, refusing anything over `maxBytes`. */
export async function readCappedBody(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new ResponseTooLargeError(maxBytes)
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new ResponseTooLargeError(maxBytes)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function readCappedText(res: Response, maxBytes = MAX_STRUCTURED_RESPONSE_BYTES): Promise<string> {
  return (await readCappedBody(res, maxBytes)).toString('utf8')
}

/**
 * A short, human message for a provider error payload (common shapes:
 * OAuth, Graph/OData, Google, Salesforce arrays, Jira, Slack, Stripe,
 * ServiceNow, SOAP faults). Never includes request headers or credentials —
 * only what the provider returned. null when nothing recognisable.
 */
export function providerErrorMessage(data: unknown): string | null {
  const pick = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 500)
    return null
  }
  if (data == null) return null
  if (typeof data === 'string') return pick(data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined
    return first ? pick(first.message) ?? pick(first.errorCode) : null
  }
  if (typeof data !== 'object') return null
  const d = data as Record<string, any>
  if (d.ok === false && typeof d.error === 'string') return d.error // Slack
  if (d.error && typeof d.error === 'object') {
    const e = d.error
    return pick(e.message?.value) ?? pick(e.message) ?? pick(e.code) ?? pick(e.type)
  }
  return pick(d.error_description) ?? pick(d.error) ?? pick(d.message) ?? pick(d.detail)
    ?? pick(d.errorMessages?.[0]) ?? pick(d.errors?.[0]?.message) ?? pick(d.fault?.faultstring)
    ?? pick(d.Message) ?? pick(d.title) ?? pick(d._raw)
}
