/**
 * Integration references: the callable operations behind workflow
 * call_reference nodes and agent tools. Shared by /api/v1, the MCP
 * references_* tools and the reference-builder server actions.
 *
 * Side effects match the UI actions: GitHub-sync capture of the reference
 * asset on every save/delete, plus an audit row (integration_reference).
 */

import { executeReference as runReference } from '@/lib/reference-executor'
import { captureResponseSample, normalizeResponseSchema, referenceResponseSchema } from '@/lib/response-schema'
import { EgressBlockedError } from '@/lib/egress-guard'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, maskSecrets, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference inputs/outputs/request_config are free-form JSON */

export const MAX_REFERENCES_PER_IMPORT = 500

export interface ReferenceInput {
  name: string
  description?: string | null
  method?: string
  path_template?: string
  pathTemplate?: string
  body_template?: string
  bodyTemplate?: string
  headers?: Record<string, string>
  query_params?: Record<string, unknown>
  request_config?: Record<string, any>
  inputs?: any[] | null
  outputs?: any[] | null
  /** Response model (see lib/response-schema); stored at request_config.response_schema. */
  response_schema?: unknown
  responseSchema?: unknown
  tags?: string[] | null
}

export function normalizeReferenceInput(input: any) {
  return {
    id: input.id ?? crypto.randomUUID(),
    name: input.name,
    type: input.type ?? 'string',
    required: input.required ?? false,
    description: input.description ?? '',
    default_value: input.default_value ?? input.defaultValue ?? '',
    location: input.location ?? 'query',
    source: input.source ?? 'variable',
  }
}

export function normalizeReferenceOutput(output: any) {
  return {
    id: output.id ?? crypto.randomUUID(),
    name: output.name,
    path: output.path ?? '',
    type: output.type ?? 'string',
  }
}

/** Row for integration_references from a loose reference description (camelCase or snake_case). */
export function buildReferenceInsert(params: { tenantId: string; integrationId: string; reference: ReferenceInput }) {
  const ref = params.reference as any
  return {
    integration_id: params.integrationId,
    tenant_id: params.tenantId,
    name: String(ref.name ?? '').trim().slice(0, 160) || 'Untitled reference',
    description: ref.description || null,
    tags: Array.isArray(ref.tags) ? ref.tags : [],
    inputs: Array.isArray(ref.inputs) ? ref.inputs.map(normalizeReferenceInput) : [],
    outputs: Array.isArray(ref.outputs) ? ref.outputs.map(normalizeReferenceOutput) : [],
    request_config: {
      method: String(ref.method ?? ref.request_config?.method ?? 'GET').toUpperCase(),
      path_template: ref.path_template ?? ref.pathTemplate ?? ref.request_config?.path_template ?? '',
      body_template: ref.body_template ?? ref.bodyTemplate ?? ref.request_config?.body_template ?? '',
      query_params: ref.query_params ?? ref.request_config?.query_params ?? {},
      headers: ref.headers ?? ref.request_config?.headers ?? {},
      ...(ref.request_config && typeof ref.request_config === 'object' ? ref.request_config : {}),
      ...withResponseSchema(ref.response_schema ?? ref.responseSchema ?? ref.request_config?.response_schema),
    },
  }
}

/** `{ response_schema }` when the value is a valid model, else nothing (an invalid one is dropped, not stored). */
function withResponseSchema(raw: unknown): { response_schema?: ReturnType<typeof normalizeResponseSchema> } {
  const schema = normalizeResponseSchema(raw)
  return schema ? { response_schema: schema } : { response_schema: undefined }
}

/** Mask anything credential-shaped a reference's request headers may carry. */
// The response model is lifted out of request_config to a top-level
// `response_schema` (derived from the declared outputs when none is stored),
// so API/MCP/CLI callers read and write it as its own field.
function presentReference<T extends Record<string, any>>(row: T): T & { response_schema: ReturnType<typeof referenceResponseSchema> } {
  const response_schema = referenceResponseSchema(row)
  if (!row.request_config) return { ...row, response_schema }
  const { response_schema: _stored, ...requestConfig } = row.request_config as Record<string, any>
  void _stored
  return { ...row, request_config: maskSecrets(requestConfig), response_schema }
}

async function requireOwnedIntegration(ctx: ServiceContext, integrationId: string) {
  const { data, error } = await ctx.supabase.from('integrations')
    .select('id, name').eq('id', integrationId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Integration not found')
  return data as { id: string; name: string }
}

async function requireOwnedReference(ctx: ServiceContext, referenceId: string, select = 'id, name, integration_id, request_config') {
  const { data, error } = await ctx.supabase.from('integration_references')
    .select(select).eq('id', referenceId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Reference not found')
  return data as any
}

export async function listReferences(
  ctx: ServiceContext,
  filters: { integrationId?: string; search?: string },
  page: Page,
) {
  requirePerm(ctx, 'integrations.view')
  if (filters.integrationId) await requireOwnedIntegration(ctx, filters.integrationId)
  let query = ctx.supabase.from('integration_references')
    .select('id, name, description, tags, created_at, updated_at, integration_id, integration:integrations(id, name, type, is_active)', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('name')
  if (filters.integrationId) query = query.eq('integration_id', filters.integrationId)
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { references: (data ?? []) as any[], total: count ?? (data ?? []).length }
}

export async function getReference(ctx: ServiceContext, referenceId: string) {
  requirePerm(ctx, 'integrations.view')
  const { data, error } = await ctx.supabase.from('integration_references')
    .select('*, integration:integrations(id, name, type, is_active)')
    .eq('id', referenceId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Reference not found')
  return presentReference(data as any)
}

export async function createReference(ctx: ServiceContext, integrationId: string, input: ReferenceInput) {
  requirePerm(ctx, 'integrations.manage_references')
  if (!String(input.name ?? '').trim()) throw ServiceError.validation('Reference name is required')
  await requireOwnedIntegration(ctx, integrationId)

  const row = buildReferenceInsert({ tenantId: ctx.tenantId, integrationId, reference: input })
  const { data, error } = await ctx.supabase.from('integration_references')
    .insert(row).select('id, name, integration_id').single()
  if (error || !data) throw dbError(error, 'Failed to create reference')

  await audit(ctx, {
    objectType: 'integration_reference', objectId: data.id, action: 'create',
    summary: `Created reference "${data.name}"`, metadata: { integration_id: integrationId },
  })
  void syncChange(ctx, 'reference', { id: data.id, name: data.name })
  return data as { id: string; name: string; integration_id: string }
}

export interface ReferenceUpdateInput {
  name?: string
  description?: string | null
  method?: string
  request_config?: Record<string, any>
  inputs?: any[]
  outputs?: any[]
  /** A model to store, or null to clear it (it is then derived from outputs again). */
  response_schema?: unknown
  tags?: string[] | null
}

export async function updateReference(ctx: ServiceContext, referenceId: string, input: ReferenceUpdateInput) {
  requirePerm(ctx, 'integrations.manage_references')
  const existing = await requireOwnedReference(ctx, referenceId)

  const updates: Record<string, any> = {}
  if (input.name !== undefined) {
    if (!input.name.trim()) throw ServiceError.validation('Reference name cannot be empty')
    updates.name = input.name
  }
  if (input.description !== undefined) updates.description = input.description
  if (input.inputs !== undefined) updates.inputs = input.inputs
  if (input.outputs !== undefined) updates.outputs = input.outputs
  if (input.tags !== undefined) updates.tags = input.tags
  if (input.request_config !== undefined || input.method !== undefined || input.response_schema !== undefined) {
    // `method` and the response model live inside request_config (there is no
    // column for either). A request_config sent without `response_schema`
    // (e.g. the masked GET shape, which lifts it out) keeps the stored model.
    const base: Record<string, any> = { ...(input.request_config ?? existing.request_config ?? {}) }
    if (input.request_config && !('response_schema' in input.request_config) && existing.request_config?.response_schema) {
      base.response_schema = existing.request_config.response_schema
    }
    if (input.response_schema !== undefined) {
      if (input.response_schema === null) delete base.response_schema
      else {
        const schema = normalizeResponseSchema(input.response_schema)
        if (!schema) throw ServiceError.validation('response_schema must be a model ({ root: { type, fields?, items? } }) or null')
        base.response_schema = schema
      }
    } else if ('response_schema' in base) {
      const schema = normalizeResponseSchema(base.response_schema)
      if (schema) base.response_schema = schema
      else delete base.response_schema
    }
    updates.request_config = input.method !== undefined ? { ...base, method: input.method.toUpperCase() } : base
  }
  if (Object.keys(updates).length === 0) throw ServiceError.validation('No fields to update')

  const { error } = await ctx.supabase.from('integration_references')
    .update(updates).eq('id', referenceId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)

  await audit(ctx, {
    objectType: 'integration_reference', objectId: referenceId, action: 'update',
    summary: `Updated reference "${updates.name ?? existing.name}"`,
    metadata: { fields: Object.keys(updates) },
  })
  void syncChange(ctx, 'reference', { id: referenceId, name: updates.name ?? existing.name })
  return { id: referenceId, updated_fields: Object.keys(updates) }
}

export async function deleteReference(ctx: ServiceContext, referenceId: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const existing = await requireOwnedReference(ctx, referenceId, 'id, name')
  const { error } = await ctx.supabase.from('integration_references')
    .delete().eq('id', referenceId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, {
    objectType: 'integration_reference', objectId: referenceId, action: 'delete',
    summary: `Deleted reference "${existing.name}"`,
  })
  void syncChange(ctx, 'reference', { id: referenceId, name: existing.name }, 'delete')
  return { deleted: true as const, id: referenceId }
}

/** Delete many references; ids outside the tenant are ignored (not counted). */
export async function bulkDeleteReferences(ctx: ServiceContext, referenceIds: string[]) {
  requirePerm(ctx, 'integrations.manage_references')
  const uniqueIds = Array.from(new Set(referenceIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { deleted: 0, ids: [] as string[] }

  const { data: owned, error: ownedError } = await ctx.supabase.from('integration_references')
    .select('id, name').eq('tenant_id', ctx.tenantId).in('id', uniqueIds)
  if (ownedError) throw dbError(ownedError)
  const rows = (owned ?? []) as Array<{ id: string; name: string }>
  if (rows.length === 0) return { deleted: 0, ids: [] as string[] }

  const ids = rows.map((row) => row.id)
  const { error } = await ctx.supabase.from('integration_references')
    .delete().eq('tenant_id', ctx.tenantId).in('id', ids)
  if (error) throw dbError(error)

  for (const row of rows) {
    void audit(ctx, { objectType: 'integration_reference', objectId: row.id, action: 'delete', summary: `Deleted reference "${row.name}"` })
    void syncChange(ctx, 'reference', row, 'delete')
  }
  return { deleted: ids.length, ids }
}

/** Run a reference against its integration (egress guard + call log live in the executor). */
export async function executeReference(
  ctx: ServiceContext,
  referenceId: string,
  inputs: Record<string, unknown> = {},
  options: { captureSchema?: boolean } = {},
) {
  requirePerm(ctx, 'integrations.test')
  if (options.captureSchema) requirePerm(ctx, 'integrations.manage_references')
  await requireOwnedReference(ctx, referenceId, 'id')
  try {
    const result = await runReference({
      supabase: ctx.supabase,
      referenceId,
      inputValues: inputs as Record<string, string>,
      timeout: 30000,
      caller: { traceId: '', callerType: ctx.source === 'ui' || ctx.source === 'job' ? 'manual_test' : ctx.source, callerId: ctx.actorId },
      expectedTenantId: ctx.tenantId,
    })
    const status = result.status ?? 200
    const response = { status, data: result.data ?? null, headers: result.headers ?? {} }
    if (options.captureSchema && status < 400 && result.data !== undefined && result.data !== null) {
      const captured = await captureReferenceSchema(ctx, referenceId, result.data)
      return { ...response, response_schema: captured }
    }
    return response
  } catch (error: any) {
    if (error instanceof EgressBlockedError) throw ServiceError.validation(error.message)
    if (error instanceof ServiceError) throw error
    throw new ServiceError('internal', `Execution failed: ${error?.message ?? 'unknown error'}`, { status: 502 })
  }
}

/** Add one tag to many references (bulk "Add tag"); ids outside the tenant are ignored. */
export async function addTagToReferences(ctx: ServiceContext, referenceIds: string[], rawTag: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const tag = String(rawTag ?? '').trim().toLowerCase()
  if (!tag || tag.length > 60) throw ServiceError.validation('Tag must be 1-60 characters')
  const ids = Array.from(new Set((referenceIds ?? []).map((id) => String(id).trim()).filter(Boolean))).slice(0, MAX_REFERENCES_PER_IMPORT)
  if (ids.length === 0) return { updated: 0 }

  const { data, error } = await ctx.supabase.from('integration_references')
    .select('id, name, tags').eq('tenant_id', ctx.tenantId).in('id', ids)
  if (error) throw dbError(error)
  let updated = 0
  for (const row of (data ?? []) as Array<{ id: string; name: string; tags: string[] | null }>) {
    const current = row.tags ?? []
    if (current.includes(tag)) continue
    const { error: updateError } = await ctx.supabase.from('integration_references')
      .update({ tags: [...current, tag] }).eq('id', row.id).eq('tenant_id', ctx.tenantId)
    if (updateError) throw dbError(updateError)
    updated++
    void syncChange(ctx, 'reference', row)
  }
  return { updated }
}

/**
 * Fold a successful response into the reference's model (inferred from the
 * sample, merged with earlier samples; spec/manual models only gain fields
 * and examples) and store it. Returns the stored model.
 */
export async function captureReferenceSchema(
  ctx: ServiceContext,
  referenceId: string,
  sample: unknown,
  options: { onlyIfInferred?: boolean } = {},
) {
  requirePerm(ctx, 'integrations.manage_references')
  const existing = await requireOwnedReference(ctx, referenceId, 'id, name, request_config, outputs')
  const prior = referenceResponseSchema(existing)
  // "auto" capture (every builder test) never touches a spec/manual/database model.
  if (options.onlyIfInferred && prior && !['sample', 'outputs'].includes(prior.source)) return prior
  const captured = captureResponseSample(prior, sample)
  const requestConfig = { ...(existing.request_config ?? {}), response_schema: captured }
  const { error } = await ctx.supabase.from('integration_references')
    .update({ request_config: requestConfig }).eq('id', referenceId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  void syncChange(ctx, 'reference', { id: referenceId, name: existing.name })
  return captured
}
