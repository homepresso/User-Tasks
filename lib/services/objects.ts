/**
 * Composite objects: joins over data tables and/or references, each with a
 * generated callable reference under the tenant's internal `__objects__`
 * integration. Shared by /api/v1/objects and the MCP objects_* tools (the
 * integrations view still edits objects client-side and reports changes via
 * notifyIntegrationObjectChange). An update accepts what getObject returns
 * (snake_case source rows; ids, timestamps and references are ignored).
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- object/source rows are untyped tables */

export const OBJECTS_INTEGRATION_NAME = '__objects__'

export interface ObjectSourceInput {
  sourceType?: 'table' | 'reference'
  source_type?: 'table' | 'reference'
  tableId?: string
  table_id?: string
  referenceId?: string
  reference_id?: string
  alias: string
  isPrimary?: boolean
  is_primary?: boolean
  joinType?: string
  join_type?: string
  joinOnLocal?: string
  join_on_local?: string
  joinOnForeign?: string
  join_on_foreign?: string
  joinToAlias?: string
  join_to_alias?: string
}

interface NormalizedSource {
  sourceType: string
  tableId: string | null
  referenceId: string | null
  alias: string
  isPrimary: boolean
  joinType: string | null
  joinOnLocal: string | null
  joinOnForeign: string | null
  joinToAlias: string | null
}

/** Accept the MCP camelCase shape and the REST snake_case shape. */
function normalizeSource(source: any): NormalizedSource {
  return {
    sourceType: source?.sourceType ?? source?.source_type,
    tableId: source?.tableId ?? source?.table_id ?? null,
    referenceId: source?.referenceId ?? source?.reference_id ?? null,
    alias: source?.alias,
    isPrimary: Boolean(source?.isPrimary ?? source?.is_primary),
    joinType: source?.joinType ?? source?.join_type ?? null,
    joinOnLocal: source?.joinOnLocal ?? source?.join_on_local ?? null,
    joinOnForeign: source?.joinOnForeign ?? source?.join_on_foreign ?? null,
    joinToAlias: source?.joinToAlias ?? source?.join_to_alias ?? null,
  }
}

function validateSources(raw: unknown): NormalizedSource[] {
  if (!Array.isArray(raw) || raw.length === 0) throw ServiceError.validation('At least one source is required')
  for (const [index, source] of raw.entries()) {
    if (!source || typeof source !== 'object') throw ServiceError.validation(`Source ${index + 1} must be an object`)
  }
  const sources = raw.map(normalizeSource)
  if (sources.filter((source) => source.isPrimary).length !== 1) throw ServiceError.validation('Exactly one primary source is required')

  const aliases = new Set<string>()
  for (const [index, source] of sources.entries()) {
    if (!['table', 'reference'].includes(source.sourceType)) throw ServiceError.validation(`Source ${index + 1} must have sourceType "table" or "reference"`)
    if (!source.alias || typeof source.alias !== 'string') throw ServiceError.validation(`Source ${index + 1} must include an alias`)
    if (source.sourceType === 'table' && !source.tableId) throw ServiceError.validation(`Table source ${source.alias} must include tableId`)
    if (source.sourceType === 'reference' && !source.referenceId) throw ServiceError.validation(`Reference source ${source.alias} must include referenceId`)
    if (!source.isPrimary && (!source.joinOnLocal || !source.joinOnForeign || !source.joinToAlias)) {
      throw ServiceError.validation(`Joined source ${source.alias} must include joinOnLocal, joinOnForeign, and joinToAlias`)
    }
    if (aliases.has(source.alias)) throw ServiceError.validation(`Duplicate source alias: ${source.alias}`)
    aliases.add(source.alias)
  }
  return sources
}

/** Every table/reference a source points at must belong to the tenant. */
async function assertSourcesOwned(ctx: ServiceContext, sources: NormalizedSource[]) {
  const check = async (table: string, ids: string[], label: string) => {
    if (ids.length === 0) return
    const unique = [...new Set(ids)]
    const { data, error } = await ctx.supabase.from(table).select('id').eq('tenant_id', ctx.tenantId).in('id', unique)
    if (error) throw dbError(error)
    const found = new Set((data ?? []).map((row: any) => row.id))
    const missing = unique.filter((id) => !found.has(id))
    if (missing.length) throw ServiceError.validation(`${label} not found: ${missing.join(', ')}`)
  }
  await check('custom_tables', sources.filter((s) => s.sourceType === 'table').map((s) => s.tableId!), 'Data table')
  await check('integration_references', sources.filter((s) => s.sourceType === 'reference').map((s) => s.referenceId!), 'Reference')
}

async function getObjectsIntegrationId(ctx: ServiceContext): Promise<string> {
  const { data: existing, error: existingError } = await ctx.supabase.from('integrations')
    .select('id').eq('tenant_id', ctx.tenantId).eq('name', OBJECTS_INTEGRATION_NAME).maybeSingle()
  if (existingError) throw dbError(existingError)
  if (existing?.id) return existing.id

  const { data: created, error: createError } = await ctx.supabase.from('integrations').insert({
    tenant_id: ctx.tenantId,
    name: OBJECTS_INTEGRATION_NAME,
    type: 'rest_api',
    config: { base_url: 'internal://objects', _executor: 'object' },
    is_active: true,
  }).select('id').single()
  if (createError || !created?.id) throw dbError(createError, 'Failed to create objects integration')
  return created.id
}

async function loadOwned(ctx: ServiceContext, objectId: string) {
  const { data, error } = await ctx.supabase.from('integration_objects')
    .select('*').eq('id', objectId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Object not found')
  return data as any
}

export async function listObjects(ctx: ServiceContext, page: Page) {
  requirePerm(ctx, 'integrations.view')
  const { data: objects, count, error } = await applyPage(
    ctx.supabase.from('integration_objects')
      .select('*', { count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false }),
    page,
  )
  if (error) throw dbError(error)
  if (!objects?.length) return { objects: [] as any[], total: count ?? 0 }

  const { data: sources, error: sourcesError } = await ctx.supabase.from('integration_object_sources')
    .select('*').in('object_id', objects.map((obj: any) => obj.id)).order('sort_order')
  if (sourcesError) throw dbError(sourcesError)
  return {
    objects: objects.map((obj: any) => ({ ...obj, sources: (sources ?? []).filter((source: any) => source.object_id === obj.id) })),
    total: count ?? objects.length,
  }
}

export async function getObject(ctx: ServiceContext, objectId: string) {
  requirePerm(ctx, 'integrations.view')
  const objectRow = await loadOwned(ctx, objectId)
  const [{ data: sources }, { data: references }] = await Promise.all([
    ctx.supabase.from('integration_object_sources').select('*').eq('object_id', objectId).order('sort_order'),
    ctx.supabase.from('integration_references')
      .select('id, name, description, request_config, inputs, outputs')
      .eq('tenant_id', ctx.tenantId)
      .filter('request_config->>object_id', 'eq', objectId),
  ])
  return { ...objectRow, sources: sources ?? [], references: references ?? [] }
}

/** Outputs of the generated reference: the primary table's columns (none for a reference primary). */
async function objectOutputs(ctx: ServiceContext, sources: NormalizedSource[]) {
  const primary = sources.find((source) => source.isPrimary)!
  const primaryTable = primary.sourceType === 'table'
    ? (await ctx.supabase.from('custom_tables').select('columns').eq('id', primary.tableId).eq('tenant_id', ctx.tenantId).maybeSingle()).data
    : null
  return Array.isArray((primaryTable as any)?.columns)
    ? ((primaryTable as any).columns as any[]).map((column: any) => ({
        id: crypto.randomUUID(),
        name: column.name ?? column.key,
        path: `${primary.alias}.${column.key}`,
        type: column.type ?? 'string',
      }))
    : []
}

function sourceRows(objectId: string, sources: NormalizedSource[]) {
  return sources.map((source, index) => ({
    object_id: objectId,
    source_type: source.sourceType,
    table_id: source.sourceType === 'table' ? source.tableId : null,
    reference_id: source.sourceType === 'reference' ? source.referenceId : null,
    alias: source.alias,
    is_primary: source.isPrimary,
    join_type: source.isPrimary ? null : (source.joinType ?? 'left'),
    join_on_local: source.isPrimary ? null : source.joinOnLocal,
    join_on_foreign: source.isPrimary ? null : source.joinOnForeign,
    join_to_alias: source.isPrimary ? null : source.joinToAlias,
    sort_order: index,
  }))
}

export async function createObject(ctx: ServiceContext, input: { name: string; description?: string | null; sources: unknown }) {
  requirePerm(ctx, 'integrations.edit')
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('Object name is required')
  const sources = validateSources(input.sources)
  await assertSourcesOwned(ctx, sources)

  const { data: objectRow, error: objectError } = await ctx.supabase.from('integration_objects').insert({
    tenant_id: ctx.tenantId,
    name,
    description: input.description ?? null,
    config: {},
  }).select('id, name').single()
  if (objectError || !objectRow?.id) throw dbError(objectError, 'Failed to create object')

  try {
    const rows = sourceRows(objectRow.id, sources)
    const { error: sourceError } = await ctx.supabase.from('integration_object_sources').insert(rows)
    if (sourceError) throw dbError(sourceError)

    const integrationId = await getObjectsIntegrationId(ctx)
    const outputs = await objectOutputs(ctx, sources)

    const { data: reference, error: referenceError } = await ctx.supabase.from('integration_references').insert({
      tenant_id: ctx.tenantId,
      integration_id: integrationId,
      name: `Object: ${name}`,
      description: input.description ?? `Composite object ${name}`,
      request_config: { _executor: 'object', method: 'GET', operation: 'list', object_id: objectRow.id },
      inputs: [],
      outputs,
    }).select('id, name').single()
    if (referenceError) throw dbError(referenceError)

    await audit(ctx, {
      objectType: 'integration', objectId: objectRow.id, action: 'create',
      summary: `Created object "${name}"`, metadata: { kind: 'object', source_count: sources.length },
    })
    void syncChange(ctx, 'object', objectRow)
    if (reference?.id) void syncChange(ctx, 'reference', reference)
    return { object: objectRow as { id: string; name: string }, sources: rows, generated_reference: reference }
  } catch (error) {
    await ctx.supabase.from('integration_object_sources').delete().eq('object_id', objectRow.id)
    await ctx.supabase.from('integration_objects').delete().eq('id', objectRow.id).eq('tenant_id', ctx.tenantId)
    throw error
  }
}

/**
 * Update name / description and (optionally) replace the sources. The
 * generated reference follows: renamed, and its outputs rebuilt when the
 * sources change. Sending getObject's output back unedited changes nothing.
 */
export async function updateObject(ctx: ServiceContext, objectId: string, input: { name?: string; description?: string | null; sources?: unknown }) {
  requirePerm(ctx, 'integrations.edit')
  const existing = await loadOwned(ctx, objectId)
  const objectUpdate: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name) throw ServiceError.validation('Object name cannot be empty')
    if (name !== existing.name) objectUpdate.name = name
  }
  if (input.description !== undefined && (input.description ?? null) !== (existing.description ?? null)) objectUpdate.description = input.description ?? null

  let sources: NormalizedSource[] | null = null
  if (input.sources !== undefined) {
    const incoming = validateSources(input.sources)
    const { data: current, error } = await ctx.supabase.from('integration_object_sources').select('*').eq('object_id', objectId).order('sort_order')
    if (error) throw dbError(error)
    const comparable = (rows: any[]) => JSON.stringify(sourceRows(objectId, rows.map(normalizeSource)))
    if (comparable(current ?? []) !== comparable(incoming)) {
      await assertSourcesOwned(ctx, incoming)
      sources = incoming
    }
  }
  if (!Object.keys(objectUpdate).length && !sources) return { ...(await getObject(ctx, objectId)), changed: false }

  if (Object.keys(objectUpdate).length) {
    const { error } = await ctx.supabase.from('integration_objects').update(objectUpdate).eq('id', objectId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  }
  if (sources) {
    const { error: deleteError } = await ctx.supabase.from('integration_object_sources').delete().eq('object_id', objectId)
    if (deleteError) throw dbError(deleteError)
    const { error: insertError } = await ctx.supabase.from('integration_object_sources').insert(sourceRows(objectId, sources))
    if (insertError) throw dbError(insertError)
  }

  const name = String(objectUpdate.name ?? existing.name)
  const referenceUpdate: Record<string, unknown> = {}
  if (objectUpdate.name !== undefined) referenceUpdate.name = `Object: ${name}`
  if (objectUpdate.description !== undefined) referenceUpdate.description = objectUpdate.description ?? `Composite object ${name}`
  if (sources) referenceUpdate.outputs = await objectOutputs(ctx, sources)
  if (Object.keys(referenceUpdate).length) {
    const { error } = await ctx.supabase.from('integration_references').update(referenceUpdate)
      .eq('tenant_id', ctx.tenantId).filter('request_config->>object_id', 'eq', objectId)
    if (error) throw dbError(error)
  }

  await audit(ctx, {
    objectType: 'integration', objectId, action: 'update',
    summary: `Updated object "${name}"`,
    metadata: { kind: 'object', fields: [...Object.keys(objectUpdate), ...(sources ? ['sources'] : [])] },
  })
  void syncChange(ctx, 'object', { id: objectId, name })
  return { ...(await getObject(ctx, objectId)), changed: true }
}

/** Delete an object, its sources and its generated references. */
export async function deleteObject(ctx: ServiceContext, objectId: string) {
  requirePerm(ctx, 'integrations.delete')
  const existing = await loadOwned(ctx, objectId)

  const { data: references, error: refsError } = await ctx.supabase.from('integration_references')
    .select('id, name').eq('tenant_id', ctx.tenantId).filter('request_config->>object_id', 'eq', objectId)
  if (refsError) throw dbError(refsError)
  const refIds = (references ?? []).map((ref: any) => ref.id)
  if (refIds.length) {
    const { error } = await ctx.supabase.from('integration_references').delete().eq('tenant_id', ctx.tenantId).in('id', refIds)
    if (error) throw dbError(error)
  }

  const { error: sourceDeleteError } = await ctx.supabase.from('integration_object_sources').delete().eq('object_id', objectId)
  if (sourceDeleteError) throw dbError(sourceDeleteError)
  const { error } = await ctx.supabase.from('integration_objects').delete().eq('id', objectId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)

  await audit(ctx, {
    objectType: 'integration', objectId, action: 'delete',
    summary: `Deleted object "${existing.name}"`, metadata: { kind: 'object', deleted_reference_count: refIds.length },
  })
  void syncChange(ctx, 'object', existing, 'delete')
  for (const ref of references ?? []) void syncChange(ctx, 'reference', ref as any, 'delete')
  return { deleted: true as const, id: objectId, deleted_reference_count: refIds.length }
}

/**
 * Generate callable references for an object (integrations view, "Generate
 * references"): full CRUD over the primary table when every source is a data
 * table, otherwise a passthrough per linked reference plus a list per table.
 * The sources are read from the database, not taken from the caller.
 */
export async function generateObjectReferences(ctx: ServiceContext, objectId: string) {
  requirePerm(ctx, 'integrations.manage_references')
  const object = await loadOwned(ctx, objectId)
  const { data: sourceRowsData, error: sourcesError } = await ctx.supabase.from('integration_object_sources')
    .select('*').eq('object_id', objectId).order('sort_order')
  if (sourcesError) throw dbError(sourcesError)
  const srcs = (sourceRowsData ?? []) as any[]
  const primarySrc = srcs.find((s) => s.is_primary)
  if (!primarySrc) throw ServiceError.validation('Object has no primary source')

  const tenantId = ctx.tenantId
  const integrationId = await getObjectsIntegrationId(ctx)
  const baseConfig = { object_id: objectId }
  const tableColumns = async (tableId: string) => {
    const { data } = await ctx.supabase.from('custom_tables').select('name, columns').eq('id', tableId).eq('tenant_id', tenantId).maybeSingle()
    return data as { name?: string; columns?: any[] } | null
  }
  const refs: any[] = []

  if (srcs.every((s) => s.source_type === 'table')) {
    // Full CRUD — all sources are data tables (object executor, not SQL/HTTP).
    const primaryTable = primarySrc.table_id ? await tableColumns(primarySrc.table_id) : null
    const cols = ((primaryTable?.columns ?? []) as any[]).filter((c) => c.key !== 'id' && c.key !== 'date_created')
    const colOutputs = cols.map((c) => ({ id: crypto.randomUUID(), name: c.name ?? c.key, path: c.key, type: c.type ?? 'string' }))
    const objExec = { _executor: 'object', ...baseConfig }
    const idInput = () => ({ id: crypto.randomUUID(), name: 'id', type: 'string', required: true, location: 'path' })
    const bodyInputs = () => cols.map((c) => ({ id: crypto.randomUUID(), name: c.name ?? c.key, type: c.type ?? 'string', required: false, location: 'body' }))
    const base = { tenant_id: tenantId, integration_id: integrationId }
    refs.push(
      { ...base, name: `${object.name}: List All`, description: `Query all rows from ${object.name}`,
        request_config: { ...objExec, method: 'GET', operation: 'list', table_id: primarySrc.table_id },
        inputs: [{ id: crypto.randomUUID(), name: 'limit', type: 'number', required: false, default_value: '50', location: 'query' }, { id: crypto.randomUUID(), name: 'offset', type: 'number', required: false, default_value: '0', location: 'query' }],
        outputs: colOutputs },
      { ...base, name: `${object.name}: Get by ID`, description: 'Get a single row by ID',
        request_config: { ...objExec, method: 'GET', operation: 'get', table_id: primarySrc.table_id },
        inputs: [idInput()], outputs: colOutputs },
      { ...base, name: `${object.name}: Insert`, description: 'Insert a new row',
        request_config: { ...objExec, method: 'POST', operation: 'insert', table_id: primarySrc.table_id },
        inputs: bodyInputs(), outputs: [{ id: crypto.randomUUID(), name: 'id', path: 'id', type: 'string' }] },
      { ...base, name: `${object.name}: Update`, description: 'Update a row by ID',
        request_config: { ...objExec, method: 'PUT', operation: 'update', table_id: primarySrc.table_id },
        inputs: [idInput(), ...bodyInputs()], outputs: [{ id: crypto.randomUUID(), name: 'updated', path: 'updated', type: 'boolean' }] },
      { ...base, name: `${object.name}: Delete`, description: 'Delete a row by ID',
        request_config: { ...objExec, method: 'DELETE', operation: 'delete', table_id: primarySrc.table_id },
        inputs: [idInput()], outputs: [{ id: crypto.randomUUID(), name: 'deleted', path: 'deleted', type: 'boolean' }] },
    )
  } else {
    // Mixed (tables + API references): a passthrough per linked reference…
    const refSources = srcs.filter((s) => s.source_type === 'reference' && s.reference_id)
    const refIds = refSources.map((s) => s.reference_id as string)
    const { data: linkedRefs, error: linkedError } = refIds.length
      ? await ctx.supabase.from('integration_references').select('id, name, inputs, outputs, request_config').eq('tenant_id', tenantId).in('id', refIds)
      : { data: [], error: null }
    if (linkedError) throw dbError(linkedError)
    for (const linkedRef of (linkedRefs ?? []) as any[]) {
      const src = refSources.find((s) => s.reference_id === linkedRef.id)
      const refMethod = linkedRef.request_config?.method ?? 'GET'
      refs.push({
        tenant_id: tenantId, integration_id: integrationId,
        name: `${object.name}: ${linkedRef.name}`,
        description: `${refMethod} via ${object.name} object (from ${src?.alias ?? 'ref'})`,
        request_config: { ...baseConfig, method: refMethod, source_reference_id: linkedRef.id, ...(linkedRef.request_config ?? {}) },
        inputs: linkedRef.inputs ?? [],
        outputs: linkedRef.outputs ?? [],
      })
    }
    // …and a list for each table source.
    for (const tblSrc of srcs.filter((s) => s.source_type === 'table' && s.table_id)) {
      const tbl = await tableColumns(tblSrc.table_id)
      const cols = ((tbl?.columns ?? []) as any[]).filter((c) => c.key !== 'id' && c.key !== 'date_created')
      refs.push({
        tenant_id: tenantId, integration_id: integrationId,
        name: `${object.name}: List ${tbl?.name ?? tblSrc.alias}`,
        description: `Query rows from ${tbl?.name ?? 'table'} (${tblSrc.alias})`,
        request_config: { _executor: 'object', ...baseConfig, method: 'GET', operation: 'list', source_alias: tblSrc.alias, table_id: tblSrc.table_id },
        inputs: [{ id: crypto.randomUUID(), name: 'limit', type: 'number', required: false, default_value: '50', location: 'query' }],
        outputs: cols.map((c) => ({ id: crypto.randomUUID(), name: c.name ?? c.key, path: `${tblSrc.alias}.${c.key}`, type: c.type ?? 'string' })),
      })
    }
  }

  if (refs.length === 0) return { created: 0, references: [] as Array<{ id: string; name: string }> }
  const { data: created, error } = await ctx.supabase.from('integration_references').insert(refs).select('id, name')
  if (error) throw dbError(error, 'Failed to create the references')
  for (const ref of (created ?? []) as Array<{ id: string; name: string }>) void syncChange(ctx, 'reference', ref)
  await audit(ctx, {
    objectType: 'integration', objectId, action: 'update',
    summary: `Generated ${refs.length} reference${refs.length === 1 ? '' : 's'} for object "${object.name}"`,
    metadata: { kind: 'object', generated_reference_count: refs.length },
  })
  return { created: refs.length, references: (created ?? []) as Array<{ id: string; name: string }> }
}
