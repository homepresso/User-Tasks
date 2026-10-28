/**
 * Syslog (RFC 5424 messages) over TLS (RFC 5425), TCP (RFC 6587) or UDP
 * (RFC 5426), for on-premises collectors: rsyslog, syslog-ng, the syslog
 * inputs of Splunk, Graylog, Logstash / Elastic Agent, QRadar, ArcSight.
 *
 *   <PRI>1 TIMESTAMP HOSTNAME APP-NAME - MSGID [usertasks@32473 …] MSG
 *
 * PRI = facility × 8 + severity (debug 7, info 6, warn 4, error 3); MSGID is
 * the event type; the structured-data element carries the tenant, event id,
 * category and severity; MSG is the event as JSON (no BOM). Streams use
 * octet-counting framing (`<length> <message>`, the RFC 5425 / 6587
 * default) or newline framing; UDP sends one datagram per message, each at
 * most 8 KB (larger events are sent with their attributes truncated).
 *
 * The formatter only builds the frames; lib/log-export/syslog-transport
 * sends them. Plain tcp / udp are unencrypted, so (like http destinations)
 * they need ALLOW_PRIVATE_EGRESS=true.
 */

import {
  byteLength,
  chunkEntries,
  FormatterConfigError,
  serializeEntry,
  toExportedEvent,
  type ExportedEvent,
  type FormatContext,
  type Formatter,
  type OutboundRequest,
  type ShipEvent,
} from './types'

export const SYSLOG_UDP_MAX_BYTES = 8_192
export const SYSLOG_STREAM_MAX_REQUEST_BYTES = 1_000_000
export const SYSLOG_MAX_MESSAGE_BYTES = 64_000
/** RFC 5612 documentation enterprise number (SD-ID name@number). */
export const SYSLOG_SD_ID = 'usertasks@32473'

const SEVERITY: Record<string, number> = { debug: 7, info: 6, warn: 4, error: 3 }
const DEFAULT_PORT: Record<string, number> = { tls: 6514, tcp: 514, udp: 514 }

/** SD-PARAM value escaping (RFC 5424 §6.3.3): ", \ and ]. */
export function sdEscape(value: string): string {
  return value.replace(/[\\"\]]/g, (c) => `\\${c}`)
}

/** PRINTUSASCII header field, at most `max` characters ("-" when empty). */
function headerField(value: string | null | undefined, max: number): string {
  const clean = String(value ?? '').replace(/[^!-~]/g, '').slice(0, max)
  return clean || '-'
}

export function syslogMessage(event: ExportedEvent, config: Record<string, unknown>): string {
  const facility = Number(config.facility ?? 16)
  const pri = facility * 8 + (SEVERITY[event.severity] ?? 6)
  const sd = `[${SYSLOG_SD_ID} tenant_id="${sdEscape(event.tenant_id)}" event_id="${event.id}" category="${sdEscape(event.category)}" severity="${sdEscape(event.severity)}"]`
  return `<${pri}>1 ${event.occurred_at} ${headerField(config.hostname as string ?? 'usertasks', 255)} ${headerField(config.app_name as string ?? 'usertasks', 48)} - ${headerField(event.type, 32)} ${sd} ${JSON.stringify(event)}`
}

export function frame(message: string, framing: string): string {
  return framing === 'lf' ? `${message}\n` : `${byteLength(message)} ${message}`
}

/** A PEM pasted into a single-line field (newlines lost) back into PEM lines. */
export function normalisePem(pem: string): string {
  if (/\n/.test(pem.trim())) return pem
  return pem.replace(/(-----BEGIN [A-Z0-9 ]+-----)\s*([A-Za-z0-9+/=\s]+?)\s*(-----END [A-Z0-9 ]+-----)/g, (_, begin: string, body: string, end: string) =>
    `${begin}\n${body.replace(/\s+/g, '').match(/.{1,64}/g)!.join('\n')}\n${end}\n`)
}

export function syslogUrl(config: Record<string, unknown>): string {
  const transport = String(config.transport ?? 'tls')
  const host = String(config.host ?? '')
  if (!host) throw new FormatterConfigError('config.host is not set')
  const port = Number(config.port ?? DEFAULT_PORT[transport] ?? 6514)
  return `syslog+${transport}://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`
}

export const syslogFormatter: Formatter = {
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    const transport = String(ctx.config.transport ?? 'tls')
    if (!['tls', 'tcp', 'udp'].includes(transport)) throw new FormatterConfigError(`config.transport ${transport} is not tls, tcp or udp`)
    const framing = transport === 'udp' ? 'none' : String(ctx.config.framing ?? 'octet_counting')
    const url = syslogUrl(ctx.config)
    const maxEntry = transport === 'udp' ? SYSLOG_UDP_MAX_BYTES - 32 : SYSLOG_MAX_MESSAGE_BYTES
    const cert = typeof ctx.credentials.client_cert === 'string' ? normalisePem(ctx.credentials.client_cert) : undefined
    const key = typeof ctx.credentials.client_key === 'string' ? normalisePem(ctx.credentials.client_key) : undefined
    if (Boolean(cert) !== Boolean(key)) throw new FormatterConfigError('mutual TLS needs both credentials.client_cert and credentials.client_key')
    // serializeEntry measures the JSON; the wrapper is the syslog header around it.
    const entries = events.map((e) => {
      const entry = serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => ev, maxEntry - 512)
      const event = JSON.parse(entry.json) as ExportedEvent
      return { json: framing === 'none' ? syslogMessage(event, ctx.config) : frame(syslogMessage(event, ctx.config), framing), eventId: entry.eventId }
    })
    const limits = transport === 'udp'
      ? { maxBytes: Number.MAX_SAFE_INTEGER, maxEntries: 1000, wrapperBytes: 0, separatorBytes: 0 }
      : { maxBytes: SYSLOG_STREAM_MAX_REQUEST_BYTES, maxEntries: 1000, wrapperBytes: 0, separatorBytes: 0 }
    return chunkEntries(entries, limits).map((group) => ({
      url,
      method: 'POST',
      headers: {},
      body: '',
      messages: group.map((entry) => entry.json),
      ...(transport === 'tls' ? { tls: { ...(ctx.config.tls_servername ? { servername: String(ctx.config.tls_servername) } : {}), ...(cert && key ? { cert, key } : {}) } } : {}),
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
