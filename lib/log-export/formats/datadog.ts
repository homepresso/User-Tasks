/**
 * Datadog Logs (HTTP intake v2).
 *
 *   POST https://http-intake.logs.<site>/api/v2/logs
 *   DD-API-KEY: <api key>
 *   body: JSON array of {ddsource, service, ddtags, status, message, date, ...event}
 *
 * Limits (Datadog docs): ≤ 5 MB uncompressed per request, ≤ 1000 entries,
 * ≤ 1 MB per entry.
 *
 * LOG_EXPORT_DATADOG_URL (server environment, operator-controlled) replaces
 * the intake URL for every Datadog destination — for an Observability
 * Pipelines worker / proxy in front of Datadog, or a mock intake in tests.
 */

import {
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

export const DATADOG_MAX_REQUEST_BYTES = 5_000_000
export const DATADOG_MAX_ENTRIES = 1000
export const DATADOG_MAX_ENTRY_BYTES = 1_000_000

const DATADOG_STATUS: Record<string, string> = { debug: 'debug', info: 'info', warn: 'warning', error: 'error' }

export function datadogIntakeUrl(site: string | undefined): string {
  const override = process.env.LOG_EXPORT_DATADOG_URL?.trim()
  if (override) return override
  return `https://http-intake.logs.${site || 'datadoghq.com'}/api/v2/logs`
}

export function datadogTags(event: ExportedEvent, extra: unknown): string {
  const tags = [`tenant_id:${event.tenant_id}`, `category:${event.category}`, `event_type:${event.type}`]
  if (Array.isArray(extra)) tags.push(...extra.filter((t): t is string => typeof t === 'string'))
  return tags.join(',')
}

export function datadogEntry(event: ExportedEvent, config: Record<string, unknown>) {
  const { message, ...rest } = event
  return {
    ddsource: 'usertasks',
    service: (config.service as string | undefined) ?? 'usertasks',
    ddtags: datadogTags(event, config.tags),
    status: DATADOG_STATUS[event.severity] ?? 'info',
    message,
    date: event.occurred_at,
    ...rest,
  }
}

export const datadogFormatter: Formatter = {
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    const apiKey = ctx.credentials.api_key
    if (typeof apiKey !== 'string' || !apiKey) throw new FormatterConfigError('credentials.api_key is not set')
    const url = datadogIntakeUrl(ctx.config.site)
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => datadogEntry(ev, ctx.config), DATADOG_MAX_ENTRY_BYTES))
    return chunkEntries(entries, {
      maxBytes: DATADOG_MAX_REQUEST_BYTES, maxEntries: DATADOG_MAX_ENTRIES, wrapperBytes: 2, separatorBytes: 1,
    }).map((group) => ({
      url,
      method: 'POST',
      headers: { 'DD-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: `[${group.map((entry) => entry.json).join(',')}]`,
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
