/**
 * Generic HTTPS webhook.
 *
 *   POST {url}
 *   Content-Type: application/json
 *   X-UserTasks-Event-Count: <n>
 *   X-UserTasks-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
 *   body: {"events": [<event>, ...]}
 *
 * Receivers verify with verifyWebhookSignature (or the same computation in
 * any language): recompute the HMAC over `${t}.${rawBody}` with the
 * destination's signing secret, compare in constant time, and reject
 * timestamps outside a tolerance window (default 5 minutes) to stop replays.
 * Events carry a stable `id`; delivery is at-least-once, so dedupe on it.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  chunkEntries,
  customHeaders,
  FormatterConfigError,
  serializeEntry,
  toExportedEvent,
  type FormatContext,
  type Formatter,
  type OutboundRequest,
  type ShipEvent,
} from './types'

export const WEBHOOK_MAX_REQUEST_BYTES = 1_000_000
export const WEBHOOK_MAX_EVENTS = 500
export const WEBHOOK_SIGNATURE_HEADER = 'X-UserTasks-Signature'
export const WEBHOOK_COUNT_HEADER = 'X-UserTasks-Event-Count'
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300

const PREFIX = '{"events":['
const SUFFIX = ']}'

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function webhookSignatureHeader(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${signWebhookBody(secret, timestamp, body)}`
}

export interface VerifyWebhookOptions {
  /** Max age (and future skew) of the signature timestamp, in seconds (default 300). */
  toleranceSeconds?: number
  /** Current time in ms (default Date.now()). */
  now?: number
}

/**
 * Verify an X-UserTasks-Signature header against the raw request body.
 * Accepts any of several v1 signatures (e.g. during secret rotation).
 */
export function verifyWebhookSignature(secret: string, header: string | null | undefined, rawBody: string, options: VerifyWebhookOptions = {}): boolean {
  if (!secret || !header) return false
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2)
    if (key === 't' && /^\d{1,12}$/.test(value ?? '')) timestamp = Number(value)
    if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value ?? '')) signatures.push(value.toLowerCase())
  }
  if (timestamp === null || signatures.length === 0) return false
  const tolerance = options.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false
  const expected = Buffer.from(signWebhookBody(secret, timestamp, rawBody), 'hex')
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}

export const webhookFormatter: Formatter = {
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    const secret = ctx.credentials.signing_secret
    if (typeof secret !== 'string' || !secret) throw new FormatterConfigError('credentials.signing_secret is not set')
    const extra = customHeaders(ctx.credentials, ['content-type', WEBHOOK_COUNT_HEADER, WEBHOOK_SIGNATURE_HEADER])
    const timestamp = Math.floor((ctx.now ?? Date.now)() / 1000)
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => ev, WEBHOOK_MAX_REQUEST_BYTES - PREFIX.length - SUFFIX.length))
    return chunkEntries(entries, {
      maxBytes: WEBHOOK_MAX_REQUEST_BYTES, maxEntries: WEBHOOK_MAX_EVENTS, wrapperBytes: PREFIX.length + SUFFIX.length, separatorBytes: 1,
    }).map((group) => {
      const body = `${PREFIX}${group.map((entry) => entry.json).join(',')}${SUFFIX}`
      return {
        url: String(ctx.config.url),
        method: 'POST',
        headers: {
          ...extra,
          'Content-Type': 'application/json',
          [WEBHOOK_COUNT_HEADER]: String(group.length),
          [WEBHOOK_SIGNATURE_HEADER]: webhookSignatureHeader(secret, timestamp, body),
        },
        body,
        eventCount: group.length,
        lastEventId: group[group.length - 1].eventId,
      }
    })
  },
}
