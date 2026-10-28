/**
 * Azure Event Hubs (REST send, batched): for Microsoft Sentinel / Fabric /
 * Stream Analytics / any Kafka-compatible consumer of the hub.
 *
 *   POST https://{namespace}.servicebus.windows.net/{event_hub}/messages?timeout=60&api-version=2014-01
 *   Content-Type: application/vnd.microsoft.servicebus.json
 *   body: [{ "Body": "<event JSON>", "UserProperties": { … } }, …]  (≤ ~1 MB)
 *
 * Auth: a shared access policy with Send (auth=sas: sas_key_name +
 * credentials.sas_key; a SharedAccessSignature valid for an hour is
 * computed locally), an Entra app (client_secret) or the instance's managed
 * identity, with "Azure Event Hubs Data Sender". LOG_EXPORT_EVENT_HUBS_URL
 * (operator) replaces https://<namespace host> — for a private endpoint or tests.
 */

import { createHmac } from 'node:crypto'
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

export const EVENT_HUBS_MAX_REQUEST_BYTES = 900_000

const SUFFIX: Record<AzureCloud, string> = {
  public: 'servicebus.windows.net',
  usgov: 'servicebus.usgovcloudapi.net',
  china: 'servicebus.chinacloudapi.cn',
}

export function eventHubsBase(config: Record<string, unknown>): string {
  const override = process.env.LOG_EXPORT_EVENT_HUBS_URL?.trim()
  if (override) return trimSlash(override)
  const ns = String(config.namespace ?? '')
  const host = ns.includes('.') ? ns : `${ns}.${SUFFIX[(config.cloud ?? 'public') as AzureCloud] ?? SUFFIX.public}`
  return `https://${host}`
}

export function eventHubsResource(config: Record<string, unknown>): string {
  return `${eventHubsBase(config)}/${encodeURIComponent(String(config.event_hub))}`
}

/** SharedAccessSignature for `resource`, valid until `expiry` (epoch seconds). */
export function sasToken(resource: string, keyName: string, key: string, expiry: number): string {
  const encoded = encodeURIComponent(resource.toLowerCase())
  const signature = createHmac('sha256', key).update(`${encoded}\n${expiry}`).digest('base64')
  return `SharedAccessSignature sr=${encoded}&sig=${encodeURIComponent(signature)}&se=${expiry}&skn=${encodeURIComponent(keyName)}`
}

export function eventHubsMessage(event: ExportedEvent) {
  return {
    Body: JSON.stringify(event),
    UserProperties: { tenant_id: event.tenant_id, event_type: event.type, category: event.category, severity: event.severity, source: 'usertasks' },
  }
}

export const azureEventHubsFormatter: Formatter = {
  async authorize(ctx, options) {
    const auth = String(ctx.config.auth ?? 'sas')
    if (auth === 'sas') {
      const keyName = ctx.config.sas_key_name
      const key = ctx.credentials.sas_key
      if (typeof keyName !== 'string' || !keyName) throw new FormatterConfigError('config.sas_key_name is required for sas auth')
      if (typeof key !== 'string' || !key) throw new FormatterConfigError('credentials.sas_key is not set')
      return sasToken(eventHubsResource(ctx.config), keyName, key, Math.floor((options.now ?? Date.now)() / 1000) + 3600)
    }
    const token = await entraToken({
      auth: auth === 'managed_identity' ? 'managed_identity' : 'client_secret',
      cloud: (ctx.config.cloud ?? 'public') as AzureCloud, tenantId: ctx.config.tenant_id, clientId: ctx.config.client_id,
      clientSecret: ctx.credentials.client_secret, scope: 'https://eventhubs.azure.net/.default',
    }, options)
    return `Bearer ${token}`
  },
  build(events: ShipEvent[], ctx: FormatContext): OutboundRequest[] {
    if (!ctx.accessToken) throw new FormatterConfigError('no access token')
    const url = `${eventHubsResource(ctx.config)}/messages?timeout=60&api-version=2014-01`
    const entries = events.map((e) => serializeEntry(toExportedEvent(e, ctx.tenantId), eventHubsMessage, 250_000))
    return chunkEntries(entries, { maxBytes: EVENT_HUBS_MAX_REQUEST_BYTES, maxEntries: 1000, wrapperBytes: 2, separatorBytes: 1 }).map((group) => ({
      url,
      method: 'POST',
      headers: { Authorization: ctx.accessToken!, 'Content-Type': 'application/vnd.microsoft.servicebus.json' },
      body: `[${group.map((entry) => entry.json).join(',')}]`,
      eventCount: group.length,
      lastEventId: group[group.length - 1].eventId,
    }))
  },
}
