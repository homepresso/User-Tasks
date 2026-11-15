/**
 * On-premises gateways of a workspace (lib/gateway): create, list, inspect,
 * issue instance registration tokens, revoke instances and gateways.
 * Shared by /api/v1/gateways, MCP, the CLI and Settings → On-premises
 * gateways.
 *
 * Permissions: reading needs integrations.view; every change needs
 * settings.edit (a gateway opens a path into the customer's network, so it
 * is a workspace-administrator decision). All changes are audited; tokens
 * are shown once and only their SHA-256 is stored.
 *
 * Tables have no client grants: reads and writes use a service-role client
 * scoped to ctx.tenantId after the permission check.
 */
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'
import { getServiceDb } from '@/lib/providers/db'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { INSTANCE_OFFLINE_AFTER_MS, compareVersions, newRegistrationToken, sha256Hex } from '@/lib/gateway/protocol'
import { gatewayVersionPolicy } from '@/lib/gateway/versions'
import { gatewaysConfigured } from '@/lib/gateway/cloud-key'
import { isMissingTableError } from '@/lib/gateway/queue'
import { recordGatewayEvent } from '@/lib/gateway/events'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role tables */

const db = () => getServiceDb() as any
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const REGISTRATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
const MAX_GATEWAYS = 50
const MAX_KEYS_PER_GATEWAY = 20

function storeError(error: any): never {
  if (isMissingTableError(error)) throw new ServiceError('internal', 'On-premises gateways are not set up in this database: apply migration 20270114200000_onprem_gateways', { status: 503 })
  throw dbError(error)
}

export interface GatewayInstance {
  id: string
  label: string | null
  status: 'pending' | 'active' | 'rotated' | 'revoked'
  online: boolean
  fingerprint: string | null
  instance_name: string | null
  hostname: string | null
  platform: string | null
  version: string | null
  update_available: boolean
  below_min_version: boolean
  registered_at: string | null
  last_seen_at: string | null
  token_expires_at: string | null
  revoked_at: string | null
  inflight: number | null
  capacity: number | null
}

export interface GatewaySummary {
  id: string
  name: string
  description: string | null
  status: 'active' | 'revoked'
  online: boolean
  state: 'online' | 'offline' | 'never_connected' | 'revoked'
  targets: Array<{ id: string; origin: string }>
  relay_url: string | null
  version: string | null
  latest_version: string | null
  last_seen_at: string | null
  created_at: string
  instances: GatewayInstance[]
}

function isOnline(lastSeen: string | null | undefined): boolean {
  return Boolean(lastSeen && Date.now() - Date.parse(lastSeen) < INSTANCE_OFFLINE_AFTER_MS)
}

function presentInstance(row: any): GatewayInstance {
  const policy = gatewayVersionPolicy()
  const report = (row.status_report ?? {}) as Record<string, any>
  return {
    id: row.id,
    label: row.label ?? null,
    status: row.status,
    online: row.status === 'active' && isOnline(row.last_seen_at),
    fingerprint: row.fingerprint ?? null,
    instance_name: row.instance_name ?? null,
    hostname: row.hostname ?? null,
    platform: row.platform ?? null,
    version: row.version ?? null,
    update_available: Boolean(row.version && policy.latest && compareVersions(row.version, policy.latest) < 0),
    below_min_version: Boolean(row.version && policy.min && compareVersions(row.version, policy.min) < 0),
    registered_at: row.registered_at ?? null,
    last_seen_at: row.last_seen_at ?? null,
    token_expires_at: row.status === 'pending' ? row.token_expires_at ?? null : null,
    revoked_at: row.revoked_at ?? null,
    inflight: typeof report.inflight === 'number' ? report.inflight : null,
    capacity: typeof report.capacity === 'number' ? report.capacity : null,
  }
}

function presentGateway(row: any, keys: any[]): GatewaySummary {
  const instances = keys.filter((k) => k.gateway_id === row.id && (k.status === 'active' || k.status === 'pending')).map(presentInstance)
  const online = row.status === 'active' && instances.some((i) => i.online)
  const everSeen = Boolean(row.last_seen_at)
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: row.status,
    online,
    state: row.status === 'revoked' ? 'revoked' : online ? 'online' : everSeen ? 'offline' : 'never_connected',
    targets: Array.isArray(row.targets) ? row.targets : [],
    relay_url: row.relay_url ?? null,
    version: row.version ?? null,
    latest_version: gatewayVersionPolicy().latest,
    last_seen_at: row.last_seen_at ?? null,
    created_at: row.created_at,
    instances,
  }
}

async function loadGatewayRow(ctx: ServiceContext, id: string): Promise<any> {
  if (!UUID_RE.test(String(id ?? ''))) throw ServiceError.notFound('Gateway not found')
  const { data, error } = await db().from('gateways').select('*').eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) storeError(error)
  if (!data) throw ServiceError.notFound('Gateway not found')
  return data
}

async function keysOf(gatewayIds: string[]): Promise<any[]> {
  if (!gatewayIds.length) return []
  const { data, error } = await db().from('gateway_keys')
    .select('id, gateway_id, label, status, fingerprint, instance_name, hostname, platform, version, registered_at, last_seen_at, token_expires_at, revoked_at, status_report, created_at')
    .in('gateway_id', gatewayIds).order('created_at', { ascending: true })
  if (error) storeError(error)
  return data ?? []
}

export async function listGateways(ctx: ServiceContext, options: { include_revoked?: boolean } = {}) {
  requirePerm(ctx, 'integrations.view')
  let query = db().from('gateways').select('*').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: true })
  if (!options.include_revoked) query = query.eq('status', 'active')
  const { data, error } = await query
  if (error) storeError(error)
  const rows = (data ?? []) as any[]
  const keys = await keysOf(rows.map((r) => r.id))
  return { gateways: rows.map((r) => presentGateway(r, keys)), configured: gatewaysConfigured() }
}

export interface GatewayJobStats {
  window_hours: number
  total: number
  done: number
  failed: number
  p50_ms: number | null
  p95_ms: number | null
}

export async function getGateway(ctx: ServiceContext, id: string) {
  requirePerm(ctx, 'integrations.view')
  const row = await loadGatewayRow(ctx, id)
  const keys = await keysOf([row.id])
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: jobs } = await db().from('gateway_jobs')
    .select('id, target, method, path, status, response_status, error_code, gateway_ms, created_at, completed_at, claimed_by, request_bytes, response_bytes, source')
    .eq('gateway_id', row.id).eq('tenant_id', ctx.tenantId).gte('created_at', since).order('created_at', { ascending: false }).limit(500)
  const list = (jobs ?? []) as any[]
  const totals = list.filter((j) => j.completed_at).map((j) => Date.parse(j.completed_at) - Date.parse(j.created_at)).sort((a, b) => a - b)
  const pct = (p: number) => (totals.length ? totals[Math.min(totals.length - 1, Math.floor(p * totals.length))] : null)
  const stats: GatewayJobStats = {
    window_hours: 24,
    total: list.length,
    done: list.filter((j) => j.status === 'done').length,
    failed: list.filter((j) => ['failed', 'expired'].includes(j.status)).length,
    p50_ms: pct(0.5),
    p95_ms: pct(0.95),
  }
  const { data: events } = await db().from('gateway_events').select('id, key_id, type, severity, message, detail, created_at')
    .eq('gateway_id', row.id).order('created_at', { ascending: false }).limit(50)
  return {
    ...presentGateway(row, keys),
    revoked_instances: keys.filter((k) => k.status === 'revoked' || k.status === 'rotated').map(presentInstance),
    stats,
    recent_jobs: list.slice(0, 50).map((j) => ({
      id: j.id, target: j.target, method: j.method, path: String(j.path).split('?')[0].slice(0, 300), status: j.status,
      response_status: j.response_status ?? null, error_code: j.error_code ?? null, gateway_ms: j.gateway_ms ?? null,
      total_ms: j.completed_at ? Date.parse(j.completed_at) - Date.parse(j.created_at) : null, instance_id: j.claimed_by ?? null,
      request_bytes: j.request_bytes ?? 0, response_bytes: j.response_bytes ?? null, created_at: j.created_at,
    })),
    events: events ?? [],
  }
}

function cleanText(value: unknown, field: string, max: number, required: boolean): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) {
    if (required) throw ServiceError.validation(`${field} is required`)
    return null
  }
  if (text.length > max) throw ServiceError.validation(`${field} is longer than ${max} characters`)
  if (/[\r\n\0]/.test(text) && field === 'name') throw ServiceError.validation(`${field} must be one line`)
  return text
}

function registrationHelp(token: string) {
  const url = configuredAppUrl() ?? '<your UserTasks address>'
  return {
    token,
    expires_at: new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS).toISOString(),
    commands: {
      windows: `.\\Install-UserTasksGateway.ps1 -CloudUrl ${url} -Token ${token}`,
      docker: `docker run -d --name usertasks-gateway --restart unless-stopped --stop-timeout 90 -v usertasks-gateway:/var/lib/usertasks-gateway -v ./gateway.json:/etc/usertasks-gateway/gateway.json:ro -e UTGW_REGISTRATION_TOKEN=${token} usertasks-gateway register-and-run`,
      cli: `usertasks-gateway register --token ${token}`,
    },
  }
}

async function newPendingKey(ctx: ServiceContext, gatewayId: string, label: string | null) {
  const token = newRegistrationToken()
  const { data, error } = await db().from('gateway_keys').insert({
    gateway_id: gatewayId,
    tenant_id: ctx.tenantId,
    label,
    status: 'pending',
    registration_token_hash: sha256Hex(token),
    token_expires_at: new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS).toISOString(),
    created_by: ctx.actorId,
  }).select('id').single()
  if (error) storeError(error)
  return { keyId: String(data.id), token }
}

export async function createGateway(ctx: ServiceContext, input: { name?: unknown; description?: unknown }) {
  requirePerm(ctx, 'settings.edit')
  if (!gatewaysConfigured()) throw ServiceError.validation('On-premises gateways need ENCRYPTION_KEY (or GATEWAY_SIGNING_KEY) on the server')
  const name = cleanText(input.name, 'name', 100, true)!
  const description = cleanText(input.description, 'description', 500, false)
  const { count } = await db().from('gateways').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('status', 'active')
  if ((count ?? 0) >= MAX_GATEWAYS) throw ServiceError.validation(`A workspace can have at most ${MAX_GATEWAYS} gateways`)
  const { data, error } = await db().from('gateways').insert({ tenant_id: ctx.tenantId, name, description, created_by: ctx.actorId }).select('*').single()
  if (error) {
    if (/duplicate key/i.test(error.message ?? '')) throw ServiceError.conflict(`A gateway named "${name}" already exists`)
    storeError(error)
  }
  const { keyId, token } = await newPendingKey(ctx, data.id, 'first instance')
  await audit(ctx, { objectType: 'integration', objectId: data.id, action: 'create', summary: `Created on-premises gateway "${name}"`, metadata: { kind: 'gateway', key_id: keyId } })
  await recordGatewayEvent({ tenantId: ctx.tenantId, gatewayId: data.id, keyId, type: 'created', message: `Gateway "${name}" created; registration token issued` })
  return { gateway: presentGateway(data, await keysOf([data.id])), registration: { key_id: keyId, ...registrationHelp(token) } }
}

export async function updateGateway(ctx: ServiceContext, id: string, input: { name?: unknown; description?: unknown }) {
  requirePerm(ctx, 'settings.edit')
  const row = await loadGatewayRow(ctx, id)
  if (row.status !== 'active') throw ServiceError.validation('A revoked gateway cannot be changed')
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) patch.name = cleanText(input.name, 'name', 100, true)
  if (input.description !== undefined) patch.description = cleanText(input.description, 'description', 500, false)
  const { data, error } = await db().from('gateways').update(patch).eq('id', row.id).eq('tenant_id', ctx.tenantId).select('*').single()
  if (error) {
    if (/duplicate key/i.test(error.message ?? '')) throw ServiceError.conflict(`A gateway named "${patch.name}" already exists`)
    storeError(error)
  }
  await audit(ctx, { objectType: 'integration', objectId: row.id, action: 'update', summary: `Updated on-premises gateway "${data.name}"`, metadata: { kind: 'gateway' } })
  return presentGateway(data, await keysOf([row.id]))
}

/** A one-time token for another instance (high availability) or a replacement. */
export async function createGatewayRegistrationToken(ctx: ServiceContext, id: string, input: { label?: unknown } = {}) {
  requirePerm(ctx, 'settings.edit')
  const row = await loadGatewayRow(ctx, id)
  if (row.status !== 'active') throw ServiceError.validation('This gateway has been revoked')
  const keys = await keysOf([row.id])
  if (keys.filter((k) => k.status === 'active' || k.status === 'pending').length >= MAX_KEYS_PER_GATEWAY) {
    throw ServiceError.validation(`A gateway can have at most ${MAX_KEYS_PER_GATEWAY} instances (revoke unused ones first)`)
  }
  const label = cleanText(input.label, 'label', 100, false)
  const { keyId, token } = await newPendingKey(ctx, row.id, label)
  await audit(ctx, { objectType: 'integration', objectId: row.id, action: 'grant', summary: `Issued a registration token for gateway "${row.name}"`, metadata: { kind: 'gateway', key_id: keyId } })
  await recordGatewayEvent({ tenantId: ctx.tenantId, gatewayId: row.id, keyId, type: 'token_issued', message: `Registration token issued${label ? ` (${label})` : ''}` })
  return { key_id: keyId, ...registrationHelp(token) }
}

/** Revoke one instance key (pending tokens are invalidated the same way). Its in-flight jobs fail. */
export async function revokeGatewayInstance(ctx: ServiceContext, id: string, keyId: string) {
  requirePerm(ctx, 'settings.edit')
  const row = await loadGatewayRow(ctx, id)
  if (!UUID_RE.test(String(keyId ?? ''))) throw ServiceError.notFound('Instance not found')
  const now = new Date().toISOString()
  const { data, error } = await db().from('gateway_keys').update({ status: 'revoked', revoked_at: now, revoked_reason: 'revoked by an administrator', registration_token_hash: null })
    .eq('id', keyId).eq('gateway_id', row.id).eq('tenant_id', ctx.tenantId).in('status', ['pending', 'active']).select('id, instance_name, fingerprint')
  if (error) storeError(error)
  if (!(data ?? []).length) throw ServiceError.notFound('Instance not found (or already revoked)')
  await db().from('gateway_jobs').update({ status: 'failed', completed_at: now, error_code: 'gateway_key_revoked', error_message: 'The gateway instance was revoked', lease_until: null })
    .eq('claimed_by', keyId).eq('status', 'claimed')
  await audit(ctx, { objectType: 'integration', objectId: row.id, action: 'revoke', summary: `Revoked an instance of gateway "${row.name}"`, metadata: { kind: 'gateway', key_id: keyId, fingerprint: data[0].fingerprint ?? null } })
  await recordGatewayEvent({ tenantId: ctx.tenantId, gatewayId: row.id, keyId, type: 'instance_revoked', severity: 'warn', message: `Instance ${data[0].instance_name ?? keyId} revoked by an administrator` })
  return { revoked: true, key_id: keyId }
}

/** Revoke the whole gateway: every key, every queued job. Connections using it stop working. */
export async function revokeGateway(ctx: ServiceContext, id: string) {
  requirePerm(ctx, 'settings.edit')
  const row = await loadGatewayRow(ctx, id)
  if (row.status === 'revoked') return { revoked: true, id: row.id }
  const now = new Date().toISOString()
  const { error } = await db().from('gateways').update({ status: 'revoked', revoked_at: now, revoked_by: ctx.actorId, updated_at: now }).eq('id', row.id).eq('tenant_id', ctx.tenantId)
  if (error) storeError(error)
  await db().from('gateway_keys').update({ status: 'revoked', revoked_at: now, revoked_reason: 'gateway revoked', registration_token_hash: null }).eq('gateway_id', row.id).in('status', ['pending', 'active'])
  await db().from('gateway_jobs').update({ status: 'cancelled', completed_at: now, error_code: 'gateway_revoked', error_message: 'The gateway was revoked', lease_until: null })
    .eq('gateway_id', row.id).in('status', ['staging', 'queued', 'claimed'])
  await audit(ctx, { objectType: 'integration', objectId: row.id, action: 'revoke', summary: `Revoked on-premises gateway "${row.name}"`, metadata: { kind: 'gateway' } })
  await recordGatewayEvent({ tenantId: ctx.tenantId, gatewayId: row.id, type: 'revoked', severity: 'warn', message: `Gateway "${row.name}" revoked by an administrator` })
  return { revoked: true, id: row.id }
}
