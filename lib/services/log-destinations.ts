/**
 * Log export destinations (public.log_destinations): list, get, create,
 * update, delete, cursor reset and delivery status. Shared by
 * /api/v1/log-destinations, the MCP log_destinations_* tools, config-as-code
 * (applyLogDestinationManifest) and, later, the settings UI.
 *
 * Permissions: reads need observability.view; writes need settings.edit as
 * well. A destination that can export audit or security events (no category
 * filter, or one naming them) also needs settings.view — the same rule as
 * reading those events (lib/services/events.ts).
 *
 * Credentials (Splunk token, Datadog API key, OTLP/webhook header values,
 * webhook signing secret) are encrypted at rest (lib/secret-crypto, when
 * ENCRYPTION_KEY is set), never returned (every value reads '__SECRET__')
 * and '__SECRET__' on update keeps the stored value. Destination URLs pass the
 * egress guard on save; plain http needs ALLOW_PRIVATE_EGRESS=true.
 *
 * The table has no client grants, so every query runs on a service-role
 * client (serviceRoleClient) with an explicit tenant filter.
 */

import { randomBytes } from 'node:crypto'
import type { z } from 'zod'
import {
  LOG_DESTINATION_SCHEMAS,
  LOG_DESTINATION_TYPES,
  logDestinationFilters,
  type LogDestinationType,
} from '@/lib/api-schemas/log-destinations'
import { assertSafeEgressHost, assertSafeEgressUrl, EgressBlockedError } from '@/lib/egress-guard'
import { deliverEvents } from '@/lib/log-export/deliver'
import { decryptSecret, encryptSecret } from '@/lib/secret-crypto'
import { instanceIdentityAllowed } from '@/lib/log-export/cloud-auth'
import { isSecretRef } from '@/lib/config/secret-refs'
import { assertTenantSecretRef } from '@/lib/config/tenant-secret-refs'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, SECRET_PLACEHOLDER, serviceRoleClient, syncChange, type Page } from './_shared'
import { latestEventId, RESTRICTED_EVENT_CATEGORIES } from './events'
import { isPlainObject } from '@/lib/utils/guards'

/* eslint-disable @typescript-eslint/no-explicit-any -- log_destinations rows carry free-form JSON */

const COLUMNS = 'id, name, type, config, credentials, filters, enabled, cursor, status, next_attempt_at, events_sent, last_success_at, last_error, last_error_at, consecutive_failures, created_by, created_at, updated_at'

export type LogDestinationFilters = z.infer<typeof logDestinationFilters>
export type StartFrom = 'now' | 'retention_start'

export interface LogDestinationCreateInput {
  name: string
  type: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
  filters?: Record<string, unknown>
  enabled?: boolean
  start_from?: StartFrom
}

export interface LogDestinationUpdateInput {
  name?: string
  type?: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
  filters?: Record<string, unknown>
  enabled?: boolean
}

// ─── Helpers ───

/** Map every string leaf of a JSON value. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn))
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapStrings(child, fn)]))
  return value
}

/** Every credential value → '__SECRET__' (header names stay visible). */
export function maskCredentials(credentials: unknown): Record<string, unknown> {
  return (mapStrings(isPlainObject(credentials) ? credentials : {}, () => SECRET_PLACEHOLDER) ?? {}) as Record<string, unknown>
}

/** Order-insensitive JSON equality (jsonb does not keep key order). */
function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => [k, canonical(value[k])]))
    return value
  }
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null))
}

function encryptCredentials(credentials: Record<string, unknown>): Record<string, unknown> {
  return mapStrings(credentials, encryptSecret) as Record<string, unknown>
}

/** Stored (possibly encrypted) credentials → plaintext. Used by validation now and the shipper later. */
export function decryptCredentials(credentials: unknown): Record<string, unknown> {
  return mapStrings(isPlainObject(credentials) ? credentials : {}, decryptSecret) as Record<string, unknown>
}

function present(row: Record<string, any>): Record<string, any> {
  const out = { ...row }
  delete out.locked_by
  delete out.locked_at
  return {
    ...out,
    cursor: String(row.cursor ?? 0),
    events_sent: Number(row.events_sent ?? 0),
    credentials: maskCredentials(row.credentials),
  }
}

function zodMessage(error: z.ZodError, where: string): ServiceError {
  const details = error.issues.map((issue) => ({ path: [where, ...issue.path.map(String)].join('.'), message: issue.message, code: issue.code }))
  return ServiceError.validation(`Invalid ${where}: ${details.map((d) => `${d.path}: ${d.message}`).join(', ')}`, details)
}

function parse<S extends z.ZodType>(schema: S, value: unknown, where: string): z.output<S> {
  const result = schema.safeParse(value ?? {})
  if (!result.success) throw zodMessage(result.error, where)
  return result.data
}

function requireType(type: unknown): LogDestinationType {
  if (!(LOG_DESTINATION_TYPES as readonly unknown[]).includes(type)) {
    throw ServiceError.validation(`type must be one of ${LOG_DESTINATION_TYPES.join(', ')}`)
  }
  return type as LogDestinationType
}

function cleanName(name: unknown): string {
  const value = String(name ?? '').trim()
  if (!value || value.length > 200) throw ServiceError.validation('name must be between 1 and 200 characters')
  return value
}

function requireRead(ctx: ServiceContext) {
  requirePerm(ctx, 'observability.view')
}

function requireWrite(ctx: ServiceContext) {
  requirePerm(ctx, 'observability.view')
  requirePerm(ctx, 'settings.edit')
}

/** Whether the filters let audit or security events through. */
export function exportsRestrictedEvents(filters: LogDestinationFilters): boolean {
  const categories = filters.categories ?? []
  return categories.length === 0 || categories.some((c) => (RESTRICTED_EVENT_CATEGORIES as readonly string[]).includes(c))
}

function requireAuditAccess(ctx: ServiceContext, filters: LogDestinationFilters) {
  if (!exportsRestrictedEvents(filters) || hasPerm(ctx, 'settings.view')) return
  throw ServiceError.forbidden("Forbidden: exporting audit and security events also needs the 'settings.view' permission (set filters.categories to leave them out)")
}

/** URL fields of a validated config. */
function destinationUrls(type: LogDestinationType, config: Record<string, any>): string[] {
  if (type === 'splunk_hec' || type === 'webhook') return [String(config.url)]
  if (type === 'otlp_http' || type === 'azure_monitor') return [String(config.endpoint)]
  return [] // Datadog, Event Hubs, Cloud Logging, Pub/Sub: fixed cloud hosts; syslog: checkDestinationUrls
}

/**
 * https (plain http only with ALLOW_PRIVATE_EGRESS=true) and the SSRF egress
 * guard. Splunk verify_tls=false is rejected: Node's fetch cannot skip
 * certificate checks per request (trust a private CA with
 * NODE_EXTRA_CA_CERTS, or use plain http on a private network).
 */
export async function checkDestinationUrls(type: LogDestinationType, config: Record<string, any>): Promise<void> {
  if (type === 'splunk_hec' && config.verify_tls === false) {
    throw ServiceError.validation('config.verify_tls=false is not supported: trust the HEC certificate with NODE_EXTRA_CA_CERTS (self-hosted), or use plain http on a private network with ALLOW_PRIVATE_EGRESS=true')
  }
  if (type === 'syslog') {
    if (config.transport !== 'tls' && process.env.ALLOW_PRIVATE_EGRESS !== 'true') {
      throw ServiceError.validation(`syslog over ${config.transport} is unencrypted: use transport tls (plain tcp / udp are allowed only with ALLOW_PRIVATE_EGRESS=true)`)
    }
    try {
      await assertSafeEgressHost(String(config.host))
    } catch (error) {
      if (error instanceof EgressBlockedError) throw ServiceError.validation(error.message)
      throw error
    }
  }
  for (const url of destinationUrls(type, config)) {
    if (!/^https:\/\//i.test(url) && process.env.ALLOW_PRIVATE_EGRESS !== 'true') {
      throw ServiceError.validation(`${url}: destinations must use https (plain http is allowed only with ALLOW_PRIVATE_EGRESS=true)`)
    }
    try {
      await assertSafeEgressUrl(url)
    } catch (error) {
      if (error instanceof EgressBlockedError) throw ServiceError.validation(error.message)
      throw error
    }
  }
}

/**
 * Auth fields the chosen auth method needs. The instance's own identity
 * (managed / workload identity) is refused unless the operator allows it:
 * it could reach anything the operator's cloud identity can.
 */
export function checkDestinationAuth(type: LogDestinationType, config: Record<string, any>, credentials: Record<string, unknown>, tenantId?: string): void {
  const has = (key: string) => typeof credentials[key] === 'string' && (credentials[key] as string).trim() !== ''
  const need = (ok: boolean, message: string) => { if (!ok) throw ServiceError.validation(message) }
  const instance = (config.auth === 'managed_identity' || config.auth === 'workload_identity' || config.auth === 'instance_role')
  if (instance && !instanceIdentityAllowed()) {
    throw ServiceError.validation(`auth=${config.auth} uses this server's own cloud identity, which this deployment does not allow; use ${type.startsWith('gcp') ? 'a service account key' : type.startsWith('aws') ? 'an IAM access key (access_key)' : 'an app registration (client_secret)'} instead`)
  }
  if (type === 'aws_cloudwatch_logs' && config.auth === 'access_key') {
    need(has('access_key_id') && has('secret_access_key'), 'credentials.access_key_id and credentials.secret_access_key are required for access_key auth')
    // secret:// references must stay inside the workspace's own secret-store prefix.
    for (const key of ['access_key_id', 'secret_access_key']) {
      if (!isSecretRef(credentials[key])) continue
      if (!tenantId) throw ServiceError.validation(`credentials.${key}: secret references need a workspace`)
      try {
        assertTenantSecretRef(credentials[key] as string, tenantId, `credentials.${key}`, 'cloudwatch-secret-key')
      } catch (error) {
        throw ServiceError.validation((error as Error).message)
      }
    }
  }
  if (type === 'azure_monitor' || type === 'azure_event_hubs') {
    if (config.auth === 'client_secret') {
      need(Boolean(config.tenant_id && config.client_id), 'config.tenant_id and config.client_id are required for client_secret auth')
      need(has('client_secret'), 'credentials.client_secret is required for client_secret auth')
    }
    if (type === 'azure_event_hubs' && config.auth === 'sas') {
      need(Boolean(config.sas_key_name), 'config.sas_key_name is required for sas auth')
      need(has('sas_key'), 'credentials.sas_key is required for sas auth')
    }
  }
  if ((type === 'gcp_logging' || type === 'gcp_pubsub') && config.auth === 'service_account') {
    need(has('service_account_json'), 'credentials.service_account_json is required for service_account auth')
  }
  if (type === 'syslog') need(has('client_cert') === has('client_key'), 'mutual TLS needs both credentials.client_cert and credentials.client_key')
}

function generateSigningSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}

/** Credential keys a destination of `type` cannot ship without. */
export function missingCredentials(type: LogDestinationType, credentials: Record<string, unknown>): string[] {
  const required: readonly string[] = type === 'webhook' ? ['signing_secret'] : LOG_DESTINATION_SCHEMAS[type].required
  return required.filter((key) => typeof credentials[key] !== 'string' || !(credentials[key] as string).trim())
}

/**
 * Merge incoming credentials over stored plaintext ones: '__SECRET__' keeps
 * a value, null removes it; `headers` maps merge per header the same way
 * (a header left out is removed, so a fetched destination round-trips).
 */
function mergeCredentials(stored: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored }
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null) { delete out[key]; continue }
    if (value === SECRET_PLACEHOLDER) continue
    if (key === 'headers' && isPlainObject(value)) {
      const prior = isPlainObject(stored.headers) ? stored.headers : {}
      const headers: Record<string, unknown> = {}
      for (const [name, headerValue] of Object.entries(value)) {
        if (headerValue === SECRET_PLACEHOLDER) { if (prior[name] !== undefined) headers[name] = prior[name]; continue }
        if (headerValue !== null) headers[name] = headerValue
      }
      out.headers = headers
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * Credentials a manifest names with '__SECRET__' that have no stored value
 * here (e.g. an OTLP API-key header exported from another environment).
 */
export function unresolvedSecrets(incoming: unknown, merged: Record<string, unknown>): string[] {
  if (!isPlainObject(incoming)) return []
  const out: string[] = []
  for (const [key, value] of Object.entries(incoming)) {
    if (value === SECRET_PLACEHOLDER && merged[key] === undefined) out.push(key)
    if (key === 'headers' && isPlainObject(value)) {
      const headers = isPlainObject(merged.headers) ? merged.headers : {}
      for (const [name, headerValue] of Object.entries(value)) {
        if (headerValue === SECRET_PLACEHOLDER && headers[name] === undefined) out.push(`headers.${name}`)
      }
    }
  }
  return out
}

/** Drop '__SECRET__' sentinels (nothing stored to keep on create). */
function withoutSentinels(credentials: Record<string, unknown>): Record<string, unknown> {
  return mergeCredentials({}, credentials)
}

async function startCursor(ctx: ServiceContext, client: AnySupabaseClient, from: StartFrom): Promise<number> {
  if (from === 'retention_start') {
    const { data, error } = await (client as any).from('event_stream')
      .select('id').eq('tenant_id', ctx.tenantId).order('id', { ascending: true }).limit(1).maybeSingle()
    if (error) throw dbError(error)
    if (data) return Math.max(0, Number(data.id) - 1)
  }
  return latestEventId(ctx, client)
}

async function loadRow(ctx: ServiceContext, client: AnySupabaseClient, id: string): Promise<Record<string, any>> {
  const { data, error } = await (client as any).from('log_destinations')
    .select(COLUMNS).eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Log destination not found')
  return data
}

const TYPE_LABEL: Record<LogDestinationType, string> = {
  splunk_hec: 'Splunk HEC', datadog: 'Datadog', otlp_http: 'OTLP/HTTP', webhook: 'webhook', syslog: 'syslog',
  azure_monitor: 'Azure Monitor', azure_event_hubs: 'Event Hubs', gcp_logging: 'Cloud Logging', gcp_pubsub: 'Pub/Sub',
  aws_cloudwatch_logs: 'CloudWatch Logs',
}

// ─── Reads ───

export async function listLogDestinations(ctx: ServiceContext, page: Page) {
  requireRead(ctx)
  const client = await serviceRoleClient(ctx)
  const query = (client as any).from('log_destinations')
    .select(COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId).order('name')
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const rows: Array<Record<string, any>> = ((data ?? []) as Array<Record<string, any>>).map(present)
  return { log_destinations: rows, total: (count ?? rows.length) as number }
}

export async function getLogDestination(ctx: ServiceContext, id: string) {
  requireRead(ctx)
  return { log_destination: present(await loadRow(ctx, await serviceRoleClient(ctx), id)) }
}

/**
 * Delivery status. Lag counts the tenant's retained events after the cursor
 * (before filters: the shipper skips non-matching events by advancing past
 * them); lag_seconds is the age of the oldest of them.
 */
export async function getLogDestinationStatus(ctx: ServiceContext, id: string) {
  requireRead(ctx)
  const client = await serviceRoleClient(ctx)
  const row = await loadRow(ctx, client, id)
  const cursor = String(row.cursor ?? 0)
  const [latest, lag, oldest] = await Promise.all([
    latestEventId(ctx, client),
    (client as any).from('event_stream').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).gt('id', cursor),
    (client as any).from('event_stream').select('occurred_at').eq('tenant_id', ctx.tenantId).gt('id', cursor)
      .order('id', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (lag.error) throw dbError(lag.error)
  if (oldest.error) throw dbError(oldest.error)
  const oldestAt = oldest.data?.occurred_at ? Date.parse(oldest.data.occurred_at) : NaN
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    enabled: row.enabled,
    cursor,
    latest_event_id: String(Math.max(latest, Number(cursor))),
    lag_events: Number(lag.count ?? 0),
    lag_seconds: Number.isFinite(oldestAt) ? Math.max(0, Math.round((Date.now() - oldestAt) / 1000)) : null,
    oldest_unsent_at: oldest.data?.occurred_at ?? null,
    events_sent: Number(row.events_sent ?? 0),
    last_success_at: row.last_success_at ?? null,
    last_error: row.last_error ?? null,
    last_error_at: row.last_error_at ?? null,
    consecutive_failures: Number(row.consecutive_failures ?? 0),
    next_attempt_at: row.next_attempt_at ?? null,
  }
}

// ─── Writes ───

/**
 * Create a destination. Webhook destinations without a signing_secret get a
 * generated one, returned once as `signing_secret`.
 */
export async function createLogDestination(ctx: ServiceContext, input: LogDestinationCreateInput) {
  requireWrite(ctx)
  const name = cleanName(input.name)
  const type = requireType(input.type)
  const schemas = LOG_DESTINATION_SCHEMAS[type]
  const config = parse(schemas.config, input.config, 'config') as Record<string, any>
  const credentialsIn = withoutSentinels(isPlainObject(input.credentials) ? input.credentials : {})
  let generatedSecret: string | undefined
  if (type === 'webhook' && !credentialsIn.signing_secret) {
    generatedSecret = generateSigningSecret()
    credentialsIn.signing_secret = generatedSecret
  }
  const credentials = parse(schemas.credentials, credentialsIn, 'credentials') as Record<string, unknown>
  const filters = parse(logDestinationFilters, input.filters, 'filters')
  requireAuditAccess(ctx, filters)
  await checkDestinationUrls(type, config)
  checkDestinationAuth(type, config, credentials, ctx.tenantId)

  const client = await serviceRoleClient(ctx)
  const enabled = input.enabled ?? true
  const cursor = await startCursor(ctx, client, input.start_from ?? 'now')
  const { data, error } = await (client as any).from('log_destinations').insert({
    tenant_id: ctx.tenantId,
    name,
    type,
    config,
    credentials: encryptCredentials(credentials),
    filters,
    enabled,
    cursor,
    status: enabled ? 'healthy' : 'disabled',
    next_attempt_at: new Date().toISOString(),
    created_by: ctx.actorId,
  }).select(COLUMNS).single()
  if (error?.code === '23505') throw ServiceError.conflict(`A log destination named "${name}" already exists`)
  if (error || !data) throw dbError(error, 'Failed to create log destination')

  await audit(ctx, {
    objectType: 'log_destination', objectId: data.id, action: 'create',
    summary: `Created ${TYPE_LABEL[type]} log destination "${name}"`,
    metadata: { type, enabled, start_from: input.start_from ?? 'now', filters },
  })
  await syncChange(ctx, 'log_destination', { id: data.id, name })
  return { log_destination: present(data), ...(generatedSecret ? { signing_secret: generatedSecret } : {}) }
}

export async function updateLogDestination(ctx: ServiceContext, id: string, input: LogDestinationUpdateInput) {
  requireWrite(ctx)
  const client = await serviceRoleClient(ctx)
  const row = await loadRow(ctx, client, id)
  const type = requireType(row.type)
  if (input.type !== undefined && input.type !== type) throw ServiceError.validation(`type cannot change (this destination is ${type}); create a new destination instead`)
  const schemas = LOG_DESTINATION_SCHEMAS[type]
  const updates: Record<string, unknown> = {}
  const changedFields: string[] = []

  if (input.name !== undefined) {
    const name = cleanName(input.name)
    if (name !== row.name) { updates.name = name; changedFields.push('name') }
  }

  let config = row.config as Record<string, any>
  if (input.config !== undefined) {
    if (!isPlainObject(input.config)) throw ServiceError.validation('config must be an object')
    const merged: Record<string, unknown> = { ...(row.config ?? {}) }
    for (const [key, value] of Object.entries(input.config)) {
      if (value === null) delete merged[key]
      else merged[key] = value
    }
    config = parse(schemas.config, merged, 'config') as Record<string, any>
    if (!sameJson(config, row.config ?? {})) {
      await checkDestinationUrls(type, config)
      updates.config = config
      changedFields.push('config')
    }
  }

  let finalCredentials: Record<string, unknown> | null = null
  if (input.credentials !== undefined) {
    if (!isPlainObject(input.credentials)) throw ServiceError.validation('credentials must be an object')
    const stored = decryptCredentials(row.credentials)
    const merged = mergeCredentials(stored, input.credentials)
    const credentials = parse(schemas.credentials, merged, 'credentials') as Record<string, unknown>
    if (type === 'webhook' && !credentials.signing_secret) throw ServiceError.validation('credentials.signing_secret cannot be removed from a webhook destination')
    finalCredentials = credentials
    if (!sameJson(credentials, stored)) {
      updates.credentials = encryptCredentials(credentials)
      changedFields.push('credentials')
    }
  }
  if (updates.config !== undefined || updates.credentials !== undefined) {
    checkDestinationAuth(type, config, finalCredentials ?? decryptCredentials(row.credentials), ctx.tenantId)
  }

  if (input.filters !== undefined) {
    const filters = parse(logDestinationFilters, input.filters, 'filters')
    if (!sameJson(filters, row.filters ?? {})) {
      requireAuditAccess(ctx, filters)
      updates.filters = filters
      changedFields.push('filters')
    }
  }

  if (input.enabled !== undefined && input.enabled !== row.enabled) {
    updates.enabled = input.enabled
    changedFields.push('enabled')
    if (input.enabled) Object.assign(updates, { status: 'healthy', consecutive_failures: 0, next_attempt_at: new Date().toISOString() })
    else updates.status = 'disabled'
  }

  if (changedFields.length === 0) return { log_destination: present(row), changed: false }

  const { data, error } = await (client as any).from('log_destinations')
    .update(updates).eq('id', id).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
  if (error?.code === '23505') throw ServiceError.conflict(`A log destination named "${updates.name}" already exists`)
  if (error || !data) throw dbError(error, 'Failed to update log destination')

  await audit(ctx, {
    objectType: 'log_destination', objectId: id, action: 'update',
    summary: `Updated log destination "${data.name}" (${changedFields.join(', ')})`,
    // Field names only: config/credentials values never go to the audit log.
    metadata: { type, changed: changedFields, ...(updates.enabled !== undefined ? { enabled: updates.enabled } : {}) },
  })
  await syncChange(ctx, 'log_destination', { id, name: data.name })
  return { log_destination: present(data), changed: true }
}

export async function deleteLogDestination(ctx: ServiceContext, id: string) {
  requireWrite(ctx)
  const client = await serviceRoleClient(ctx)
  const row = await loadRow(ctx, client, id)
  const { error } = await (client as any).from('log_destinations').delete().eq('id', id).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to delete log destination')
  await audit(ctx, {
    objectType: 'log_destination', objectId: id, action: 'delete',
    summary: `Deleted ${TYPE_LABEL[row.type as LogDestinationType] ?? row.type} log destination "${row.name}"`,
    metadata: { type: row.type },
  })
  await syncChange(ctx, 'log_destination', { id, name: row.name }, 'delete')
  return { deleted: true as const }
}

/** Move the cursor to now (skip the backlog) or to the start of retention (re-send it). */
export async function resetLogDestinationCursor(ctx: ServiceContext, id: string, from: StartFrom) {
  requireWrite(ctx)
  if (from !== 'now' && from !== 'retention_start') throw ServiceError.validation('from must be now or retention_start')
  const client = await serviceRoleClient(ctx)
  const row = await loadRow(ctx, client, id)
  const cursor = await startCursor(ctx, client, from)
  const { data, error } = await (client as any).from('log_destinations').update({
    cursor,
    status: row.enabled ? 'healthy' : 'disabled',
    consecutive_failures: 0,
    next_attempt_at: new Date().toISOString(),
  }).eq('id', id).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to reset cursor')
  await audit(ctx, {
    objectType: 'log_destination', objectId: id, action: 'update',
    summary: `Reset the cursor of log destination "${row.name}" to ${from === 'now' ? 'now' : 'the start of retention'}`,
    metadata: { type: row.type, event: 'reset_cursor', from, cursor_before: String(row.cursor), cursor_after: String(cursor) },
  })
  return { log_destination: present(data) }
}

/**
 * Send one synthetic `system.test` event through the real formatter and send
 * path (egress guard, timeout, redaction). The destination's cursor, status
 * and stats are left alone; works for disabled destinations too.
 */
export async function testLogDestination(ctx: ServiceContext, id: string) {
  requireWrite(ctx)
  const client = await serviceRoleClient(ctx)
  const row = await loadRow(ctx, client, id)
  const type = requireType(row.type)
  const event = {
    id: 0,
    occurred_at: new Date().toISOString(),
    type: 'system.test',
    category: 'system' as const,
    severity: 'info' as const,
    message: `UserTasks log export test event for destination "${row.name}"`,
    source_table: 'log_destinations',
    source_id: String(row.id),
    trace_id: null, run_id: null, workflow_id: null, task_id: null,
    actor_id: ctx.actorId ?? null,
    attributes: { destination_id: row.id, destination_name: row.name, test: true },
  }
  const { result, requests } = await deliverEvents(type, [event], {
    tenantId: ctx.tenantId, destinationId: String(row.id), config: row.config ?? {}, credentials: decryptCredentials(row.credentials),
  })
  await audit(ctx, {
    objectType: 'log_destination', objectId: row.id, action: 'execute',
    summary: `Sent a test event to log destination "${row.name}" (${result.kind === 'success' ? 'delivered' : 'failed'})`,
    metadata: { type, event: 'test', ok: result.kind === 'success', status_code: result.status },
  })
  return {
    ok: result.kind === 'success',
    status_code: result.status,
    latency_ms: result.latencyMs,
    error: result.error,
    retryable: result.kind === 'retry',
    requests,
  }
}

// ─── Config as code ───

export interface LogDestinationManifestAsset {
  id?: string
  name?: string
  type?: string
  config?: Record<string, unknown>
  credentials?: Record<string, unknown>
  filters?: Record<string, unknown>
  enabled?: boolean
}

/**
 * Export shape: non-secret fields, every credential '__SECRET__' (or the
 * stored, encrypted values for server-side plan comparison).
 */
export function logDestinationManifestRow(row: Record<string, any>, keepCredentials = false) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: row.config ?? {},
    credentials: keepCredentials ? (row.credentials ?? {}) : maskCredentials(row.credentials),
    filters: row.filters ?? {},
    enabled: row.enabled ?? false,
  }
}

/**
 * Create or update a destination from a config manifest. Credentials merge
 * ('__SECRET__' keeps a stored value; supply real values, e.g. via ${env:}).
 * A destination missing its token / API key / signing secret is written
 * DISABLED with a warning (as connectors are), never with a generated secret.
 * New destinations start at "now".
 */
export async function applyLogDestinationManifest(ctx: ServiceContext, asset: LogDestinationManifestAsset, existingId: string | null) {
  requireWrite(ctx)
  const type = requireType(asset?.type)
  const name = cleanName(asset.name)
  const schemas = LOG_DESTINATION_SCHEMAS[type]
  const config = parse(schemas.config, asset.config, 'config') as Record<string, any>
  const filters = parse(logDestinationFilters, asset.filters, 'filters')
  requireAuditAccess(ctx, filters)
  await checkDestinationUrls(type, config)
  const client = await serviceRoleClient(ctx)
  const warnings: string[] = []

  const existing = existingId ? await loadRow(ctx, client, existingId) : null
  if (existing && existing.type !== type) throw ServiceError.validation(`type cannot change (local destination is ${existing.type})`)
  const stored = existing ? decryptCredentials(existing.credentials) : {}
  const merged = mergeCredentials(stored, isPlainObject(asset.credentials) ? asset.credentials : {})
  // Partial while credentials may still be missing: the required ones are checked below.
  const credentials = parse((schemas.credentials as z.ZodObject<any>).partial(), merged, 'credentials') as Record<string, unknown>
  const missing = [...new Set([...missingCredentials(type, credentials), ...unresolvedSecrets(asset.credentials, credentials)])]
  if (missing.length) {
    warnings.push(`Log destination "${name}" needs credentials (${missing.join(', ')}); ${existing ? 'kept' : 'created'} disabled — set them and enable it`)
  }
  const enabled = !missing.length && (asset.enabled ?? existing?.enabled ?? true) !== false
  const statusFields = enabled
    ? (existing?.enabled ? {} : { status: 'healthy', consecutive_failures: 0, next_attempt_at: new Date().toISOString() })
    : { status: 'disabled' }

  let row: Record<string, any>
  if (!existing) {
    const { data, error } = await (client as any).from('log_destinations').insert({
      tenant_id: ctx.tenantId, name, type, config, filters, enabled,
      credentials: encryptCredentials(credentials),
      cursor: await startCursor(ctx, client, 'now'),
      next_attempt_at: new Date().toISOString(),
      created_by: ctx.actorId,
      status: 'healthy',
      ...statusFields,
    }).select(COLUMNS).single()
    if (error?.code === '23505') throw ServiceError.conflict(`A log destination named "${name}" already exists`)
    if (error || !data) throw dbError(error, 'Failed to create log destination')
    row = data
  } else {
    const { data, error } = await (client as any).from('log_destinations').update({
      name, config, filters, enabled,
      credentials: encryptCredentials(credentials),
      ...statusFields,
    }).eq('id', existing.id).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
    if (error?.code === '23505') throw ServiceError.conflict(`A log destination named "${name}" already exists`)
    if (error || !data) throw dbError(error, 'Failed to update log destination')
    row = data
  }

  await audit(ctx, {
    objectType: 'log_destination', objectId: row.id, action: existing ? 'update' : 'create',
    summary: `${existing ? 'Updated' : 'Created'} ${TYPE_LABEL[type]} log destination "${name}" from configuration`,
    metadata: { type, enabled, via_config: true },
  })
  await syncChange(ctx, 'log_destination', { id: row.id, name })
  return { id: String(row.id), created: !existing, warnings }
}
