/**
 * ctx.gateways for extensions (lib/extensions/sdk ExtensionContext.gateways):
 * read-only status of the workspace's on-premises gateways and relay
 * addresses for callbacks from the customer's network.
 *
 * Server-only.
 */
import type { ExtensionGateway } from '@/lib/extensions/sdk'
import { getServiceDb } from '@/lib/providers/db'
import { INSTANCE_OFFLINE_AFTER_MS } from './protocol'
import { isMissingTableError } from './queue'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The path prefix the gateway's relay listener forwards (packages/gateway relay.ts). */
export const RELAY_PATH_PREFIX = '/relay'

async function load(tenantId: string, id?: string): Promise<ExtensionGateway[]> {
  const db = getServiceDb() as any
  let query = db.from('gateways').select('id, name, status, targets, relay_url, version, last_seen_at').eq('tenant_id', tenantId)
  query = id ? query.eq('id', id) : query.eq('status', 'active')
  const { data, error } = await query
  if (error) {
    if (isMissingTableError(error)) return []
    throw new Error(`Could not load gateways: ${error.message}`)
  }
  const rows = (data ?? []) as any[]
  if (!rows.length) return []
  const since = new Date(Date.now() - INSTANCE_OFFLINE_AFTER_MS).toISOString()
  const { data: live } = await db.from('gateway_keys').select('gateway_id').in('gateway_id', rows.map((r) => r.id)).eq('status', 'active').gte('last_seen_at', since)
  const online = new Set(((live ?? []) as any[]).map((k) => k.gateway_id))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    online: r.status === 'active' && online.has(r.id),
    state: r.status === 'revoked' ? 'revoked' : online.has(r.id) ? 'online' : r.last_seen_at ? 'offline' : 'never_connected',
    targets: Array.isArray(r.targets) ? r.targets : [],
    relayUrl: r.relay_url ?? null,
    version: r.version ?? null,
    lastSeenAt: r.last_seen_at ?? null,
  }))
}

export function listExtensionGateways(tenantId: string): Promise<ExtensionGateway[]> {
  return load(tenantId)
}

export async function getExtensionGateway(tenantId: string, id: string): Promise<ExtensionGateway | null> {
  if (!UUID_RE.test(String(id ?? ''))) return null
  return (await load(tenantId, id))[0] ?? null
}

/** `<relay>/relay/ext-public/<extension>/<path>` on the customer's network, or null (no relay / unknown gateway). */
export async function extensionRelayUrl(tenantId: string, extensionId: string, gatewayId: string, path: string): Promise<string | null> {
  const gateway = await getExtensionGateway(tenantId, gatewayId)
  if (!gateway || gateway.state === 'revoked' || !gateway.relayUrl) return null
  const clean = `/${String(path ?? '').replace(/^\/+/, '')}`
  return `${gateway.relayUrl.replace(/\/+$/, '')}${RELAY_PATH_PREFIX}/ext-public/${extensionId}${clean === '/' ? '' : clean}`
}
