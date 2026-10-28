/**
 * Azure Monitor Logs Ingestion API (Log Analytics / Microsoft Sentinel).
 *
 *   POST {endpoint}/dataCollectionRules/{dcr_immutable_id}/streams/{stream_name}?api-version=2023-01-01
 *   Authorization: Bearer <Entra ID token for https://monitor.azure.com/.default>
 *   body: JSON array of rows, ≤ 1 MB per call
 *
 * `endpoint` is the logs-ingestion endpoint of the data collection endpoint
 * (or of the rule itself). The DCR's stream declares the columns below
 * (TimeGenerated datetime, Attributes dynamic, the rest string / long) and
 * its transform maps them into the target table, e.g. UserTasks_CL. The
 * identity needs "Monitoring Metrics Publisher" on the rule. Auth: an app
 * registration (tenant_id, client_id, credentials.client_secret) or the
 * instance's managed identity (lib/log-export/cloud-auth).
 */

import { entraToken, type AzureCloud } from '../cloud-auth'
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

export const AZURE_MONITOR_MAX_REQUEST_BYTES = 1_000_000
export const AZURE_MONITOR_API_VERSION = '2023-01-01'

const MONITOR_SCOPE: Record<AzureCloud, string> = {
  public: 'https://monitor.azure.com/.default',
  usgov: 'https://monitor.azure.us/.default',
  china: 'https://monitor.azure.cn/.default',
}

export function azureMonitorRow(event: ExportedEvent) {
  return {
    TimeGenerated: event.occurred_at,
    EventId: event.id,
    TenantId: event.tenant_id,
    EventType: event.type,
    Category: event.category,
    Severity: event.severity,
    Message: event.message,
    SourceTable: event.source_table,
    SourceId: event.source_id,
    TraceId: event.trace_id,
    RunId: event.run_id,
    WorkflowId: event.workflow_id,
    TaskId: event.task_id,
    ActorId: event.actor_id,
    Attributes: event.attributes,
  }
}

export function azureMonitorUrl(config: Record<string, unknown>): string {
  return `${trimSlash(String(config.endpoint ?? ''))}/dataCollectionRules/${encodeURIComponent(String(config.dcr_immutable_id))}/streams/${encodeURIComponent(String(config.stream_name))}?api-version=${AZURE_MONITOR_API_VERSION}`
}

export const azureMonitorFormatter: Formatter = {
  authorize(ctx, options) {
    const cloud = (ctx.config.cloud ?? 'public') as AzureCloud
    return entraToken({
      auth: ctx.config.auth === 'managed_identity' ? 'managed_identity' : 'client_secret',
      cloud, tenantId: ctx.config.tenant_id, clientId: ctx.config.client_id, clientSecret: ctx.credentials.client_secret, scope: MONITOR_SCOPE[cloud] ?? MONITOR_SCOPE.public,
    }, options)
  },
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    if (!ctx.accessToken) throw new FormatterConfigError('no access token')
    const url = azureMonitorUrl(ctx.config)
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), azureMonitorRow, AZURE_MONITOR_MAX_REQUEST_BYTES - 2))
    return chunkEntries(entries, { maxBytes: AZURE_MONITOR_MAX_REQUEST_BYTES, maxEntries: 5000, wrapperBytes: 2, separatorBytes: 1 }).map((group) => ({
      url,
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: `[${group.map((entry) => entry.json).join(',')}]`,
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
