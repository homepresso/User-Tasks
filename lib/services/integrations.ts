/**
 * Integrations: CRUD, connection test, bundle create and OpenAPI/Postman
 * import. Shared by /api/v1/integrations, the MCP integrations_* tools and
 * the integration server actions.
 *
 * Credentials: config is encrypted field-by-field at rest
 * (encryptSensitiveFields) and NEVER returned — responses carry the masked
 * config (secrets → '__SECRET__'); sending the sentinel back on update keeps
 * the stored value.
 */

import { parseApiSpec } from '@/lib/api-spec-parser'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'
import { assertSafeEgressUrl } from '@/lib/egress-guard'
import { processDeletionQueueBatch } from '@/lib/deletion-queue'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import {
  applyPage, audit, dbError, ilikeTerm, maskSecrets, queueDeletion, resolveSecretPlaceholders, syncChange, type Page,
} from './_shared'
import { buildReferenceInsert, MAX_REFERENCES_PER_IMPORT, type ReferenceInput } from './references'

/* eslint-disable @typescript-eslint/no-explicit-any -- integration config is free-form JSON */

export const CREATABLE_INTEGRATION_TYPES = ['rest_api', 'odata', 'webhook', 'database'] as const
export type CreatableIntegrationType = (typeof CREATABLE_INTEGRATION_TYPES)[number]
export const INTEGRATION_AUTH_TYPES = ['none', 'api_key', 'bearer', 'basic', 'oauth2'] as const

const LIST_COLUMNS = 'id, name, type, is_active, tags, last_test_status, last_tested_at, last_test_message, created_at, updated_at'

/** Validate a base URL: absolute http(s), HTTPS unless loopback, no credentials/fragment. Returns it normalised. */
export function validateBaseUrl(raw: unknown, field = 'base_url'): string {
  const baseUrl = String(raw ?? '').trim().replace(/\/+$/, '')
  let parsed: URL
  try { parsed = new URL(baseUrl) } catch { throw ServiceError.validation(`${field} must be a valid absolute URL`) }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw ServiceError.validation(`${field} must use HTTPS outside local development`)
  }
  if (parsed.username || parsed.password || parsed.hash) throw ServiceError.validation(`${field} cannot contain credentials or a fragment`)
  return baseUrl
}

/** Validate (and normalise) a non-database integration config. Database configs pass through. */
export function validateIntegrationConfig(type: string, config: Record<string, any>): Record<string, any> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw ServiceError.validation('config must be an object')
  if (type === 'database') return config
  const authType = String(config.auth_type ?? 'none')
  if (!(INTEGRATION_AUTH_TYPES as readonly string[]).includes(authType)) throw ServiceError.validation('config.auth_type is not supported')
  return { ...config, base_url: validateBaseUrl(config.base_url, 'config.base_url') }
}

function validateName(name: unknown): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed || trimmed.length > 120) throw ServiceError.validation('Integration name must be between 1 and 120 characters')
  return trimmed
}

/** Integration row as returned by the API: config masked, never decrypted. */
export function presentIntegration<T extends Record<string, any>>(row: T): T {
  return 'config' in row ? { ...row, config: maskSecrets(row.config ?? {}) } : row
}

async function loadOwned(ctx: ServiceContext, integrationId: string, select = '*') {
  const { data, error } = await ctx.supabase.from('integrations')
    .select(select).eq('id', integrationId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Integration not found')
  return data as any
}

export async function listIntegrations(ctx: ServiceContext, filters: { active?: boolean; type?: string; search?: string }, page: Page) {
  requirePerm(ctx, 'integrations.view')
  let query = ctx.supabase.from('integrations')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('name')
  if (filters.active !== undefined) query = query.eq('is_active', filters.active)
  if (filters.type) query = query.eq('type', filters.type)
  if (filters.search?.trim()) query = query.ilike('name', `%${ilikeTerm(filters.search)}%`)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  // presentIntegration is a no-op for the selected columns; it guards against config ever being selected here.
  return { integrations: (data ?? []).map(presentIntegration) as any[], total: count ?? (data ?? []).length }
}

/** Integration with masked config and its references (id, name, description). */
export async function getIntegration(ctx: ServiceContext, integrationId: string) {
  requirePerm(ctx, 'integrations.view')
  const integration = await loadOwned(ctx, integrationId, `${LIST_COLUMNS}, config`)
  const { data: references, error } = await ctx.supabase.from('integration_references')
    .select('id, name, description')
    .eq('integration_id', integrationId)
    .eq('tenant_id', ctx.tenantId)
    .order('name')
  if (error) throw dbError(error)
  return { ...presentIntegration(integration), references: references ?? [] }
}

export interface IntegrationCreateInput {
  name: string
  type: CreatableIntegrationType
  config: Record<string, any>
  tags?: string[] | null
}

async function insertIntegration(ctx: ServiceContext, input: IntegrationCreateInput) {
  const name = validateName(input.name)
  if (!(CREATABLE_INTEGRATION_TYPES as readonly string[]).includes(input.type)) throw ServiceError.validation('Unsupported integration type')
  const config = validateIntegrationConfig(input.type, input.config ?? {})
  const { data, error } = await ctx.supabase.from('integrations').insert({
    tenant_id: ctx.tenantId,
    name,
    type: input.type,
    // Encrypt credential fields (passwords, tokens, keys) at rest
    config: encryptSensitiveFields(config),
    tags: input.tags?.length ? input.tags.slice(0, 50) : null,
    is_active: true,
    created_by: ctx.actorId,
  }).select('id, name, type, is_active').single()
  if (error || !data) throw dbError(error, 'Failed to create integration')
  return data as { id: string; name: string; type: string; is_active: boolean }
}

export async function createIntegration(ctx: ServiceContext, input: IntegrationCreateInput) {
  requirePerm(ctx, 'integrations.create')
  const integration = await insertIntegration(ctx, input)
  await audit(ctx, {
    objectType: 'integration', objectId: integration.id, action: 'create',
    summary: `Created ${integration.type} integration "${integration.name}"`,
    metadata: { type: integration.type },
  })
  void syncChange(ctx, 'integration', integration)
  return integration
}

/** Create an integration and its references atomically (the integration is removed if references fail). */
export async function createIntegrationWithReferences(
  ctx: ServiceContext,
  input: IntegrationCreateInput & { references?: ReferenceInput[] },
) {
  requirePerm(ctx, 'integrations.create')
  const references = input.references ?? []
  if (!Array.isArray(references) || references.length > MAX_REFERENCES_PER_IMPORT) {
    throw ServiceError.validation(`Imports are limited to ${MAX_REFERENCES_PER_IMPORT} references`)
  }
  const integration = await insertIntegration(ctx, input)

  let created: Array<{ id: string; name: string }> = []
  try {
    const rows = references.map((reference) => buildReferenceInsert({ tenantId: ctx.tenantId, integrationId: integration.id, reference }))
    if (rows.length > 0) {
      const { data, error } = await ctx.supabase.from('integration_references').insert(rows).select('id, name')
      if (error) throw dbError(error)
      created = (data ?? []) as Array<{ id: string; name: string }>
    }
  } catch (error) {
    await ctx.supabase.from('integration_references').delete().eq('integration_id', integration.id).eq('tenant_id', ctx.tenantId)
    await ctx.supabase.from('integrations').delete().eq('id', integration.id).eq('tenant_id', ctx.tenantId)
    throw error
  }

  await audit(ctx, {
    objectType: 'integration', objectId: integration.id, action: 'create',
    summary: `Created ${integration.type} integration "${integration.name}" with ${references.length} reference(s)`,
    metadata: { type: integration.type, reference_count: references.length },
  })
  void syncChange(ctx, 'integration', integration)
  for (const ref of created) void syncChange(ctx, 'reference', ref)
  return { integration, references_created: references.length, references: created }
}

export interface ImportOpenApiInput {
  /** Raw OpenAPI 2/3 or Postman document (JSON/YAML string, or an already-parsed object). */
  spec: string | Record<string, unknown>
  name?: string
  base_url?: string
  auth_type?: 'none' | 'api_key' | 'bearer' | 'basic'
  auth_config?: Record<string, any>
  /** Zero-based indexes of the parsed operations to import (default: all). */
  selected_reference_indexes?: number[]
  tags?: string[]
}

/** Parse an API description and create a rest_api integration with one reference per operation. */
export async function importOpenApi(ctx: ServiceContext, input: ImportOpenApiInput) {
  requirePerm(ctx, 'integrations.create')
  let parsed
  try {
    parsed = parseApiSpec(typeof input.spec === 'string' ? input.spec : JSON.stringify(input.spec))
  } catch (error: any) {
    throw ServiceError.validation(error?.message ?? 'Failed to parse API specification')
  }

  const selected = Array.isArray(input.selected_reference_indexes) ? new Set(input.selected_reference_indexes) : null
  const operations = parsed.references.filter((_, index) => !selected || selected.has(index))
  const authType = input.auth_type ?? parsed.authType
  const result = await createIntegrationWithReferences(ctx, {
    name: input.name ?? parsed.name,
    type: 'rest_api',
    config: {
      base_url: input.base_url ?? parsed.baseUrl,
      auth_type: authType,
      auth_config: input.auth_config ?? parsed.authConfig ?? {},
      headers: {},
    },
    tags: input.tags ?? null,
    references: operations.map((op) => ({
      name: op.name,
      description: op.description,
      method: op.method,
      pathTemplate: op.pathTemplate,
      bodyTemplate: op.bodyTemplate,
      inputs: op.inputs,
      outputs: op.outputs,
      response_schema: op.responseSchema,
      headers: op.headers,
      tags: op.tags,
    })),
  })
  return { ...result, imported_reference_names: operations.map((op) => op.name) }
}

export interface IntegrationUpdateInput {
  name?: string
  config?: Record<string, any>
  is_active?: boolean
  tags?: string[] | null
}

export async function updateIntegration(ctx: ServiceContext, integrationId: string, input: IntegrationUpdateInput) {
  requirePerm(ctx, 'integrations.edit')
  const existing = await loadOwned(ctx, integrationId, 'id, name, type, config')

  const updates: Record<string, any> = {}
  if (input.name !== undefined) updates.name = validateName(input.name)
  if (input.is_active !== undefined) updates.is_active = input.is_active
  if (input.tags !== undefined) updates.tags = input.tags
  if (input.config !== undefined) {
    // '__SECRET__' sentinels (from a masked GET) keep the stored ciphertext.
    let config = resolveSecretPlaceholders(input.config, existing.config ?? {})
    // Only re-validate the URL when it changes, so legacy rows stay editable.
    const storedUrl = String(existing.config?.base_url ?? '').replace(/\/+$/, '')
    if (existing.type !== 'database' && config?.base_url !== undefined && String(config.base_url).trim().replace(/\/+$/, '') !== storedUrl) {
      config = { ...config, base_url: validateBaseUrl(config.base_url, 'config.base_url') }
    }
    // Idempotent for values an edit form round-trips already encrypted
    updates.config = encryptSensitiveFields(config)
  }
  if (Object.keys(updates).length === 0) throw ServiceError.validation('No fields to update')
  updates.updated_at = new Date().toISOString()

  const { error } = await ctx.supabase.from('integrations').update(updates).eq('id', integrationId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)

  const name = updates.name ?? existing.name
  await audit(ctx, {
    objectType: 'integration', objectId: integrationId, action: 'update',
    summary: `Updated integration "${name}"`,
    metadata: { fields: Object.keys(updates).filter((key) => key !== 'updated_at') },
  })
  void syncChange(ctx, 'integration', { id: integrationId, name })
  return { id: integrationId, name }
}

/**
 * Queue the integration (and its references/endpoints) for deletion. By
 * default the queue is drained inline so the row is gone when this returns.
 */
export async function deleteIntegration(ctx: ServiceContext, integrationId: string, options: { processInline?: boolean } = {}) {
  requirePerm(ctx, 'integrations.delete')
  const existing = await loadOwned(ctx, integrationId, 'id, name')
  await queueDeletion(ctx, 'integration', integrationId, { name: existing.name ?? null })
  await audit(ctx, {
    objectType: 'integration', objectId: integrationId, action: 'delete',
    summary: `Queued deletion for integration "${existing.name}"`,
  })
  void syncChange(ctx, 'integration', existing, 'delete')
  if (options.processInline !== false) await processDeletionQueueBatch({ batchSize: 10 })
  return { deleted: true as const, id: integrationId }
}

/** GET the base URL with the integration's auth; records the outcome on the row. */
export async function testIntegration(ctx: ServiceContext, integrationId: string) {
  requirePerm(ctx, 'integrations.test')
  const integration = await loadOwned(ctx, integrationId, 'id, type, config')
  // Credential fields are encrypted at rest — decrypt so auth headers carry plaintext.
  const config = decryptSensitiveFields(integration.config ?? {}) as any

  const record = (status: string, message: string) => ctx.supabase.from('integrations').update({
    last_tested_at: new Date().toISOString(),
    last_test_status: status,
    last_test_message: message,
  }).eq('id', integrationId).eq('tenant_id', ctx.tenantId)

  try {
    const headers: Record<string, string> = { ...(config.headers ?? {}) }
    await applyAuthHeaders(config, headers, { supabase: ctx.supabase, integrationId })
    await assertSafeEgressUrl(config.base_url)
    const resp = await fetch(config.base_url, { headers, signal: AbortSignal.timeout(10000) })
    const status = resp.ok ? 'success' : 'error'
    const message = resp.ok ? `${resp.status} OK` : `${resp.status} ${resp.statusText}`
    await record(status, message)
    return { status, message, http_status: resp.status as number | null, reachable: true }
  } catch (error: any) {
    const message = error?.message ?? 'Connection failed'
    await record('error', message)
    return { status: 'error', message, http_status: null, reachable: false }
  }
}
