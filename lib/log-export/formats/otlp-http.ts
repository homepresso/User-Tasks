/**
 * OpenTelemetry OTLP/HTTP logs, JSON encoding.
 *
 *   POST {endpoint}/v1/logs     Content-Type: application/json
 *   { resourceLogs: [{ resource: { attributes: [service.name=usertasks,
 *       tenant.id, ...resource_attributes] }, scopeLogs: [{ scope:
 *       { name: "usertasks.event_stream" }, logRecords: [...] }] }] }
 *
 * Each LogRecord: timeUnixNano / observedTimeUnixNano (decimal strings),
 * severityNumber (debug 5, info 9, warn 13, error 17) + severityText, body
 * (stringValue = message), attributes as a KeyValue list (event.name,
 * usertasks.* ids, usertasks.attr.* for the event attributes) and traceId
 * when the event's trace id is 32 hex digits (a UUID without dashes).
 *
 * `endpoint` may be the collector base (https://otel:4318) or already end in
 * /v1/logs. credentials.headers are sent with every request (API keys for
 * Grafana Cloud, Honeycomb, New Relic, …).
 */

import {
  byteLength,
  chunkEntries,
  customHeaders,
  serializeEntry,
  toExportedEvent,
  trimSlash,
  type ExportedEvent,
  type FormatContext,
  type Formatter,
  type OutboundRequest,
  type ShipEvent,
} from './types'

export const OTLP_MAX_REQUEST_BYTES = 4_000_000
export const OTLP_MAX_RECORDS = 1000

export const OTLP_SEVERITY: Record<string, { number: number; text: string }> = {
  debug: { number: 5, text: 'DEBUG' },
  info: { number: 9, text: 'INFO' },
  warn: { number: 13, text: 'WARN' },
  error: { number: 17, text: 'ERROR' },
}

export function otlpLogsUrl(endpoint: string): string {
  const base = trimSlash(String(endpoint ?? '').trim())
  return /\/v1\/logs$/i.test(base) ? base : `${base}/v1/logs`
}

export type AnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: AnyValue[] } }
  | { kvlistValue: { values: KeyValue[] } }

export interface KeyValue { key: string; value: AnyValue }

/** JSON value → OTLP AnyValue (null/undefined → empty string). */
export function anyValue(value: unknown, depth = 0): AnyValue {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  if (depth < 5 && Array.isArray(value)) return { arrayValue: { values: value.map((v) => anyValue(v, depth + 1)) } }
  if (depth < 5 && value && typeof value === 'object') {
    return { kvlistValue: { values: Object.entries(value).map(([key, v]) => ({ key, value: anyValue(v, depth + 1) })) } }
  }
  if (value === null || value === undefined) return { stringValue: '' }
  return { stringValue: JSON.stringify(value) }
}

const kv = (key: string, value: unknown): KeyValue => ({ key, value: anyValue(value) })

/** UUID / hex trace id → 32 lower-case hex digits, or null when not representable. */
export function otlpTraceId(traceId: string | null | undefined): string | null {
  if (!traceId) return null
  const hex = traceId.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex) || /^0+$/.test(hex)) return null
  return hex
}

/** ISO timestamp → nanoseconds since the epoch, as a decimal string. */
export function unixNano(iso: string | number): string {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  return `${BigInt(Math.round(Number.isFinite(ms) ? ms : 0)) * BigInt(1_000_000)}`
}

export function otlpLogRecord(event: ExportedEvent, observedMs: number) {
  const severity = OTLP_SEVERITY[event.severity] ?? OTLP_SEVERITY.info
  const attributes: KeyValue[] = [
    kv('event.name', event.type),
    kv('usertasks.event.id', event.id),
    kv('usertasks.category', event.category),
    kv('usertasks.source_table', event.source_table),
  ]
  for (const key of ['source_id', 'run_id', 'workflow_id', 'task_id', 'actor_id', 'trace_id'] as const) {
    if (event[key]) attributes.push(kv(`usertasks.${key}`, event[key]))
  }
  for (const [key, value] of Object.entries(event.attributes ?? {})) attributes.push(kv(`usertasks.attr.${key}`, value))
  const traceId = otlpTraceId(event.trace_id)
  return {
    timeUnixNano: unixNano(event.occurred_at),
    observedTimeUnixNano: unixNano(observedMs),
    severityNumber: severity.number,
    severityText: severity.text,
    body: { stringValue: event.message },
    attributes,
    ...(traceId ? { traceId } : {}),
  }
}

function envelope(ctx: FormatContext, records: string): string {
  const resourceAttributes: KeyValue[] = [kv('service.name', 'usertasks'), kv('tenant.id', ctx.tenantId)]
  for (const [key, value] of Object.entries((ctx.config.resource_attributes ?? {}) as Record<string, string>)) {
    const existing = resourceAttributes.find((attr) => attr.key === key)
    if (existing) existing.value = anyValue(value)
    else resourceAttributes.push(kv(key, value))
  }
  const RECORDS = '"__RECORDS__"'
  const json = JSON.stringify({
    resourceLogs: [{
      resource: { attributes: resourceAttributes },
      scopeLogs: [{ scope: { name: 'usertasks.event_stream' }, logRecords: ['__RECORDS__'] }],
    }],
  })
  // logRecords is the last array in the document: splice at the last match
  // (a resource attribute could contain the placeholder text too).
  const at = json.lastIndexOf(RECORDS)
  return json.slice(0, at) + records + json.slice(at + RECORDS.length)
}

export const otlpHttpFormatter: Formatter = {
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    const observed = (ctx.now ?? Date.now)()
    const headers = { ...customHeaders(ctx.credentials), 'Content-Type': 'application/json' }
    const url = otlpLogsUrl(String(ctx.config.endpoint))
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => otlpLogRecord(ev, observed), OTLP_MAX_REQUEST_BYTES / 2))
    const wrapperBytes = byteLength(envelope(ctx, ''))
    return chunkEntries(entries, { maxBytes: OTLP_MAX_REQUEST_BYTES, maxEntries: OTLP_MAX_RECORDS, wrapperBytes, separatorBytes: 1 }).map((group) => ({
      url,
      method: 'POST',
      headers,
      body: envelope(ctx, group.map((entry) => entry.json).join(',')),
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
