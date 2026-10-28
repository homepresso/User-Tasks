/**
 * Google Cloud Pub/Sub (topics.publish): for BigQuery subscriptions,
 * Dataflow, Chronicle / Security Operations feeds and other consumers.
 *
 *   POST https://pubsub.googleapis.com/v1/projects/{project}/topics/{topic}:publish
 *   Authorization: Bearer <OAuth token, scope pubsub>
 *   body: { messages: [{ data: base64(<event JSON>), attributes, orderingKey? }] }
 *
 * ≤ 1000 messages and ≤ 5 MB per request (the API allows 10 MB). Attributes:
 * tenant_id, event_type, category, severity plus config.attributes;
 * ordering_key=tenant orders each workspace's events (enable message
 * ordering on the subscription). Auth: a service-account key with
 * roles/pubsub.publisher, or the instance's workload identity.
 * LOG_EXPORT_GCP_PUBSUB_URL (operator) replaces the API origin.
 */

import { googleToken } from '../cloud-auth'
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

export const PUBSUB_MAX_REQUEST_BYTES = 5_000_000
export const PUBSUB_MAX_MESSAGES = 1000

export function pubsubMessage(event: ExportedEvent, config: Record<string, unknown>) {
  const extra = config.attributes && typeof config.attributes === 'object' ? config.attributes as Record<string, string> : {}
  return {
    data: Buffer.from(JSON.stringify(event), 'utf8').toString('base64'),
    attributes: { ...extra, tenant_id: event.tenant_id, event_type: event.type, category: event.category, severity: event.severity },
    ...(config.ordering_key === 'tenant' ? { orderingKey: event.tenant_id } : {}),
  }
}

export const gcpPubsubFormatter: Formatter = {
  authorize(ctx, options) {
    return googleToken({ auth: ctx.config.auth === 'workload_identity' ? 'workload_identity' : 'service_account', serviceAccountJson: ctx.credentials.service_account_json, scope: 'https://www.googleapis.com/auth/pubsub' }, options)
  },
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    if (!ctx.accessToken) throw new FormatterConfigError('no access token')
    const origin = trimSlash(process.env.LOG_EXPORT_GCP_PUBSUB_URL?.trim() || 'https://pubsub.googleapis.com')
    const url = `${origin}/v1/projects/${encodeURIComponent(String(ctx.config.project_id))}/topics/${encodeURIComponent(String(ctx.config.topic))}:publish`
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), (ev) => pubsubMessage(ev, ctx.config), 1_000_000))
    return chunkEntries(entries, { maxBytes: PUBSUB_MAX_REQUEST_BYTES, maxEntries: PUBSUB_MAX_MESSAGES, wrapperBytes: '{"messages":[]}'.length, separatorBytes: 1 }).map((group) => ({
      url,
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: `{"messages":[${group.map((entry) => entry.json).join(',')}]}`,
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
