/**
 * Google Cloud Logging (entries.write).
 *
 *   POST https://logging.googleapis.com/v2/entries:write
 *   Authorization: Bearer <OAuth token, scope logging.write>
 *   body: { logName, resource, labels?, entries: [{ timestamp, severity, insertId, labels, jsonPayload }] }
 *
 * Requests stay ≤ 5 MB and 1000 entries (the API allows 10 MB). insertId is
 * `<tenant>-<event id>`, so a batch re-sent after a timeout is deduplicated.
 * Auth: a service-account key with roles/logging.logWriter, or the
 * instance's workload identity (lib/log-export/cloud-auth).
 * LOG_EXPORT_GCP_LOGGING_URL (operator) replaces the API origin (Private
 * Service Connect, tests).
 */

import { googleToken } from '../cloud-auth'
import {
  byteLength,
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

export const GCP_LOGGING_MAX_REQUEST_BYTES = 5_000_000
export const GCP_LOGGING_MAX_ENTRIES = 1000
const SEVERITY: Record<string, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' }

export function gcpLoggingEntry(event: ExportedEvent, projectId: string) {
  return {
    timestamp: event.occurred_at,
    severity: SEVERITY[event.severity] ?? 'DEFAULT',
    insertId: `${event.tenant_id}-${event.id}`,
    labels: { tenant_id: event.tenant_id, category: event.category, event_type: event.type },
    ...(event.trace_id && /^[0-9a-f]{32}$/.test(event.trace_id) ? { trace: `projects/${projectId}/traces/${event.trace_id}` } : {}),
    jsonPayload: event,
  }
}

export const gcpLoggingFormatter: Formatter = {
  authorize(ctx, options) {
    return googleToken({ auth: ctx.config.auth === 'workload_identity' ? 'workload_identity' : 'service_account', serviceAccountJson: ctx.credentials.service_account_json, scope: 'https://www.googleapis.com/auth/logging.write' }, options)
  },
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    if (!ctx.accessToken) throw new FormatterConfigError('no access token')
    const project = String(ctx.config.project_id)
    const origin = trimSlash(process.env.LOG_EXPORT_GCP_LOGGING_URL?.trim() || 'https://logging.googleapis.com')
    const wrapper = {
      logName: `projects/${project}/logs/${encodeURIComponent(String(ctx.config.log_id ?? 'usertasks'))}`,
      resource: { type: String(ctx.config.resource_type ?? 'global'), labels: { project_id: project } },
      ...(ctx.config.labels ? { labels: ctx.config.labels } : {}),
    }
    // `{...wrapper,"entries":[` + entries + `]}`
    const head = `${JSON.stringify(wrapper).slice(0, -1)},"entries":[`
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => gcpLoggingEntry(ev, project), 250_000))
    return chunkEntries(entries, { maxBytes: GCP_LOGGING_MAX_REQUEST_BYTES, maxEntries: GCP_LOGGING_MAX_ENTRIES, wrapperBytes: byteLength(head) + 2, separatorBytes: 1 }).map((group) => ({
      url: `${origin}/v2/entries:write`,
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: `${head}${group.map((entry) => entry.json).join(',')}]}`,
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
