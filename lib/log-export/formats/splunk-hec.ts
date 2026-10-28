/**
 * Splunk HTTP Event Collector (HEC).
 *
 *   POST {url}/services/collector/event
 *   Authorization: Splunk <token>
 *   body: newline-delimited {"time": <epoch seconds>, "host", "source",
 *         "sourcetype", "index"?, "event": <event>} objects
 *
 * `url` may be the HEC base (https://splunk:8088) or already end in
 * /services/collector or /services/collector/event. Requests stay ≤ 1 MB
 * (Splunk's classic max_content_length).
 *
 * verify_tls=false is not supported (Node's fetch has no per-request TLS
 * override without an extra dependency); self-hosted Splunk with a private CA
 * should set NODE_EXTRA_CA_CERTS, or run HEC over plain http on a private
 * network with ALLOW_PRIVATE_EGRESS=true.
 */

import {
  chunkEntries,
  FormatterConfigError,
  serializeEntry,
  toExportedEvent,
  trimSlash,
  type ExportedEvent,
  type FormatContext,
  type Formatter,
  type OutboundRequest,
  type ShipEvent,
} from './types'

export const SPLUNK_MAX_REQUEST_BYTES = 1_000_000
export const SPLUNK_DEFAULT_SOURCE = 'usertasks'
export const SPLUNK_DEFAULT_SOURCETYPE = 'usertasks:event'

export function splunkEventUrl(url: string): string {
  const base = trimSlash(String(url ?? '').trim())
  if (/\/services\/collector\/event$/i.test(base)) return base
  if (/\/services\/collector$/i.test(base)) return `${base}/event`
  return `${base}/services/collector/event`
}

/** Epoch seconds with millisecond precision, as HEC's `time` field expects. */
export function epochSeconds(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.round(ms) / 1000 : Math.round(Date.now()) / 1000
}

export function splunkEntry(event: ExportedEvent, config: Record<string, unknown>) {
  return {
    time: epochSeconds(event.occurred_at),
    host: (config.host as string | undefined) ?? 'usertasks',
    source: (config.source as string | undefined) ?? SPLUNK_DEFAULT_SOURCE,
    sourcetype: (config.sourcetype as string | undefined) ?? SPLUNK_DEFAULT_SOURCETYPE,
    ...(config.index ? { index: config.index as string } : {}),
    event,
  }
}

export const splunkHecFormatter: Formatter = {
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    if (ctx.config.verify_tls === false) {
      throw new FormatterConfigError('verify_tls=false is not supported; trust the HEC certificate via NODE_EXTRA_CA_CERTS instead')
    }
    const token = ctx.credentials.token
    if (typeof token !== 'string' || !token) throw new FormatterConfigError('credentials.token is not set')
    const url = splunkEventUrl(String(ctx.config.url))
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => splunkEntry(ev, ctx.config), SPLUNK_MAX_REQUEST_BYTES))
    return chunkEntries(entries, { maxBytes: SPLUNK_MAX_REQUEST_BYTES, maxEntries: 10_000, wrapperBytes: 0, separatorBytes: 1 }).map((group) => ({
      url,
      method: 'POST',
      headers: { Authorization: `Splunk ${token}`, 'Content-Type': 'application/json' },
      body: group.map((entry) => entry.json).join('\n'),
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
