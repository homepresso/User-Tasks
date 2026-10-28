/**
 * Format + send for log export destinations: the path shared by the shipper
 * (lib/log-export/shipper.ts) and "send test event"
 * (POST /api/v1/log-destinations/{id}/test).
 *
 * Every request re-checks the target at send time: https only (plain http
 * with ALLOW_PRIVATE_EGRESS=true), the SSRF egress guard, no redirects
 * followed, 10 s timeout. Error text that is stored or returned is redacted:
 * credential values never appear in it.
 */

import { assertSafeEgressHost, assertSafeEgressUrl, EgressBlockedError } from '@/lib/egress-guard'
import type { LogDestinationType } from '@/lib/api-schemas/log-destinations'
import { awsCloudWatchLogsFormatter } from './formats/aws-cloudwatch-logs'
import { azureEventHubsFormatter } from './formats/azure-event-hubs'
import { azureMonitorFormatter } from './formats/azure-monitor'
import { datadogFormatter } from './formats/datadog'
import { gcpLoggingFormatter } from './formats/gcp-logging'
import { gcpPubsubFormatter } from './formats/gcp-pubsub'
import { syslogFormatter } from './formats/syslog'
import { otlpHttpFormatter } from './formats/otlp-http'
import { splunkHecFormatter } from './formats/splunk-hec'
import { AuthorizeError, FormatterConfigError, type FormatContext, type Formatter, type OutboundRequest, type ShipEvent } from './formats/types'
import { webhookFormatter } from './formats/webhook'
import { parseSyslogUrl, sendSyslog } from './syslog-transport'

export const REQUEST_TIMEOUT_MS = 10_000
/** Longest Retry-After we honour. */
export const RETRY_AFTER_CAP_MS = 3_600_000
const ERROR_TEXT_MAX = 500

export const FORMATTERS: Record<LogDestinationType, Formatter> = {
  splunk_hec: splunkHecFormatter,
  datadog: datadogFormatter,
  otlp_http: otlpHttpFormatter,
  webhook: webhookFormatter,
  syslog: syslogFormatter,
  azure_monitor: azureMonitorFormatter,
  azure_event_hubs: azureEventHubsFormatter,
  gcp_logging: gcpLoggingFormatter,
  gcp_pubsub: gcpPubsubFormatter,
  aws_cloudwatch_logs: awsCloudWatchLogsFormatter,
}

/** success: 2xx. retry: 408, 429, 5xx, network/timeout. permanent: other 4xx, 3xx, config/egress errors. */
export type SendKind = 'success' | 'retry' | 'permanent'

export interface SendResult {
  kind: SendKind
  status: number | null
  latencyMs: number
  error: string | null
  /** From Retry-After (429/503), capped at 1 h. */
  retryAfterMs: number | null
}

export interface DeliverResult {
  /** Events delivered (requests that succeeded, in order). */
  sent: number
  /** Cursor after the delivered requests (null when none succeeded). */
  sentThrough: number | null
  /** Result of the last request attempted (success when everything went). */
  result: SendResult
  requests: number
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type SyslogSender = (request: OutboundRequest, options: { timeoutMs: number }) => Promise<void>

export function classifyStatus(status: number): SendKind {
  if (status >= 200 && status < 300) return 'success'
  if (status === 408 || status === 429 || status >= 500) return 'retry'
  return 'permanent'
}

/** Retry-After: delta seconds or an HTTP date → ms from now (null when absent/invalid). */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null
  const text = value.trim()
  let ms: number
  if (/^\d+$/.test(text)) ms = Number(text) * 1000
  else {
    const at = Date.parse(text)
    if (Number.isNaN(at)) return null
    ms = at - now
  }
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, ms))
}

/** Every credential string (incl. header values) of at least 4 characters. */
export function secretValues(credentials: unknown): string[] {
  const out: string[] = []
  const walk = (value: unknown) => {
    if (typeof value === 'string') { if (value.length >= 4) out.push(value) }
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(credentials)
  return out.sort((a, b) => b.length - a.length)
}

/** Replace any credential value in `text` with ***, then clip. */
export function redactSecrets(text: string, credentials: unknown): string {
  let out = String(text ?? '')
  for (const secret of secretValues(credentials)) out = out.split(secret).join('***')
  return out.length > ERROR_TEXT_MAX ? `${out.slice(0, ERROR_TEXT_MAX - 1)}…` : out
}

/**
 * https (http only with ALLOW_PRIVATE_EGRESS=true) + SSRF guard; syslog:
 * tls, or tcp / udp with ALLOW_PRIVATE_EGRESS=true. Throws EgressBlockedError.
 */
export async function assertDeliverableUrl(url: string): Promise<void> {
  if (url.startsWith('syslog+')) {
    const target = parseSyslogUrl(url)
    if (target.transport !== 'tls' && process.env.ALLOW_PRIVATE_EGRESS !== 'true') {
      throw new EgressBlockedError(`${target.host}:${target.port}`, 'syslog must use tls (plain tcp / udp needs ALLOW_PRIVATE_EGRESS=true)')
    }
    await assertSafeEgressHost(target.host)
    return
  }
  if (!/^https:\/\//i.test(url) && process.env.ALLOW_PRIVATE_EGRESS !== 'true') {
    throw new EgressBlockedError(new URL(url).origin, 'destinations must use https (plain http needs ALLOW_PRIVATE_EGRESS=true)')
  }
  await assertSafeEgressUrl(url)
}

function networkErrorText(error: unknown, timeoutMs: number): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return `timed out after ${Math.round(timeoutMs / 1000)}s`
  const cause = err?.cause?.code ?? err?.cause?.message
  return `network error: ${err?.message ?? 'request failed'}${cause ? ` (${cause})` : ''}`
}

const hostOf = (url: string) => {
  if (url.startsWith('syslog+')) {
    try { const t = parseSyslogUrl(url); return `${t.host}:${t.port}` } catch { return 'destination' }
  }
  try { return new URL(url).host } catch { return 'destination' }
}

export async function sendRequest(
  request: OutboundRequest,
  options: { fetch?: FetchLike; timeoutMs?: number; credentials?: unknown; now?: () => number; syslog?: SyslogSender } = {},
): Promise<SendResult> {
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const started = now()
  const done = (kind: SendKind, status: number | null, error: string | null, retryAfterMs: number | null = null): SendResult => ({
    kind, status, latencyMs: Math.max(0, now() - started), error: error === null ? null : redactSecrets(error, options.credentials), retryAfterMs,
  })

  try {
    await assertDeliverableUrl(request.url)
  } catch (error) {
    if (error instanceof EgressBlockedError || error instanceof TypeError) return done('permanent', null, (error as Error).message)
    throw error
  }

  if (request.messages) {
    try {
      await (options.syslog ?? sendSyslog)(request, { timeoutMs })
      return done('success', null, null)
    } catch (error) {
      return done('retry', null, `syslog to ${hostOf(request.url)}: ${networkErrorText(error, timeoutMs)}`)
    }
  }

  let response: Response
  try {
    response = await (options.fetch ?? fetch)(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return done('retry', null, networkErrorText(error, timeoutMs))
  }

  let kind = classifyStatus(response.status)
  if (kind === 'success') {
    await response.body?.cancel().catch(() => {})
    return done('success', response.status, null)
  }
  let detail = ''
  try {
    detail = (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 2000)
  } catch { /* body unreadable */ }
  const vendorKind = request.classify?.(response.status, detail) ?? null
  if (vendorKind === 'success') return done('success', response.status, null)
  if (vendorKind) kind = vendorKind
  detail = detail.slice(0, 300)
  const location = response.status >= 300 && response.status < 400 ? ' (redirects are not followed; use the final URL)' : ''
  const retryAfter = kind === 'retry' ? parseRetryAfter(response.headers.get('retry-after'), now()) : null
  return done(kind, response.status, `HTTP ${response.status} from ${hostOf(request.url)}${location}${detail ? `: ${detail}` : ''}`, retryAfter)
}

/**
 * Format `events` for a destination and send the resulting request(s) in
 * order, stopping at the first failure. Partial progress is reported through
 * `sentThrough` so the caller can advance the cursor past what was delivered.
 */
export async function deliverEvents(
  type: LogDestinationType,
  events: ShipEvent[],
  ctx: FormatContext,
  options: { fetch?: FetchLike; timeoutMs?: number; syslog?: SyslogSender } = {},
): Promise<DeliverResult> {
  const now = ctx.now ?? Date.now
  let requests: OutboundRequest[]
  let secrets: unknown = ctx.credentials
  try {
    const formatter = FORMATTERS[type]
    if (!formatter) throw new FormatterConfigError(`unknown destination type ${type}`)
    // Bearer token / AWS credentials first (cached), one-off setup, then the pure build.
    let built: FormatContext = formatter.authorize ? { ...ctx, accessToken: await formatter.authorize(ctx, { fetch: options.fetch, now }) } : ctx
    if (formatter.authorizeAws) built = { ...built, awsCredentials: await formatter.authorizeAws(ctx, { fetch: options.fetch, now }) }
    if (built.accessToken || built.awsCredentials) secrets = { ...ctx.credentials, access_token: built.accessToken, aws: built.awsCredentials }
    await formatter.prepare?.(built, { fetch: options.fetch, now, assertUrl: assertDeliverableUrl })
    requests = formatter.build(events, built)
  } catch (error) {
    const kind = error instanceof FormatterConfigError || error instanceof EgressBlockedError ? 'permanent' : error instanceof AuthorizeError ? 'retry' : null
    if (!kind) throw error
    return { sent: 0, sentThrough: null, requests: 0, result: { kind, status: null, latencyMs: 0, error: redactSecrets((error as Error).message, secrets), retryAfterMs: null } }
  }

  let sent = 0
  let sentThrough: number | null = null
  let result: SendResult = { kind: 'success', status: null, latencyMs: 0, error: null, retryAfterMs: null }
  let attempted = 0
  for (const request of requests) {
    attempted += 1
    result = await sendRequest(request, { ...options, credentials: secrets, now })
    if (result.kind !== 'success') break
    sent += request.eventCount
    sentThrough = request.lastEventId
  }
  return { sent, sentThrough, result, requests: attempted }
}
