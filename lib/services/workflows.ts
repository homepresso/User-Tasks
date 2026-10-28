/**
 * Workflow lifecycle: delete (deletion queue), activate / deactivate and
 * published version history. Shared by /api/v1/workflows/{id}[/activate|
 * /deactivate|/versions…] and the MCP workflows_delete / workflows_toggle /
 * workflows_versions_list tools.
 *
 * Mirrors the UI actions (app/actions/automations.ts): delete → workflows.delete,
 * queued hard delete (versions, runs and spawned tasks go with it), audit +
 * sync capture; toggle → workflows.activate, audit + sync capture. Keys
 * restricted to specific workflows only reach those workflows.
 */

import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { diffValues } from '@/lib/portability/plan'
import { WORKFLOW_DEFINITION_FIELDS } from '@/lib/api-schemas/workflows'
import { applyPage, audit, dbError, queueDeletion, serviceRoleClient, syncChange, type Page } from './_shared'
import { assertWorkflowActivatable } from '@/lib/packages/activation'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import { isPlainObject } from '@/lib/utils/guards'
import { pinWorkflowForms } from './forms'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows are untyped here */

const VERSION_LIST_COLUMNS = 'id, workflow_id, version_number, is_active, publish_notes, trigger_type, published_by, published_at'

function requireWorkflowScope(ctx: ServiceContext, workflowId: string) {
  const allow = ctx.resourceScopes?.workflow_ids
  if (allow?.length && !allow.includes(workflowId)) {
    throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that workflow')
  }
}

async function loadOwned(ctx: ServiceContext, workflowId: string) {
  requireWorkflowScope(ctx, workflowId)
  const { data, error } = await (ctx.supabase as any).from('workflows')
    .select('id, name, is_active').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow not found')
  return data as { id: string; name: string; is_active: boolean }
}

/** Queue the workflow for deletion (definition, versions, runs and the tasks it spawned). */
export async function deleteWorkflow(ctx: ServiceContext, workflowId: string) {
  requirePerm(ctx, 'workflows.delete')
  const workflow = await loadOwned(ctx, workflowId)
  await queueDeletion(ctx, 'workflow', workflowId, { name: workflow.name ?? null })
  invalidateDataTableTriggerCache(ctx.tenantId)
  await audit(ctx, {
    objectType: 'workflow', objectId: workflowId, action: 'delete',
    summary: `Queued deletion for workflow "${workflow.name}"`,
  })
  await syncChange(ctx, 'workflow', workflow, 'delete')
  return { deleted: true as const, id: workflowId, queued: true }
}

/** Package installs with incomplete setup keep their workflows inactive (lib/packages/activation). */
async function assertActivatable(ctx: ServiceContext, workflowId: string) {
  let admin
  try {
    admin = await serviceRoleClient(ctx)
  } catch {
    return // no service-role credentials configured (unit tests)
  }
  await assertWorkflowActivatable(admin, workflowId, ctx.tenantId)
}

/** Activate or deactivate (active workflows respond to their triggers). */
export async function setWorkflowActive(ctx: ServiceContext, workflowId: string, active: boolean) {
  requirePerm(ctx, 'workflows.activate')
  const workflow = await loadOwned(ctx, workflowId)
  if (active && !workflow.is_active) await assertActivatable(ctx, workflowId)
  const { error } = await (ctx.supabase as any).from('workflows')
    .update({ is_active: active }).eq('id', workflowId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  invalidateDataTableTriggerCache(ctx.tenantId)
  if (workflow.is_active !== active) {
    await audit(ctx, {
      objectType: 'workflow', objectId: workflowId, action: 'toggle',
      summary: active ? 'Activated workflow' : 'Deactivated workflow',
      diff: { is_active: { before: workflow.is_active, after: active } },
    })
    await syncChange(ctx, 'workflow', workflow)
  }
  return { id: workflowId, is_active: active }
}

export async function listWorkflowVersions(ctx: ServiceContext, workflowId: string, page: Page) {
  requirePerm(ctx, 'workflows.view')
  await loadOwned(ctx, workflowId)
  const query = (ctx.supabase as any).from('workflow_versions')
    .select(VERSION_LIST_COLUMNS, { count: 'exact' })
    .eq('workflow_id', workflowId)
    .eq('tenant_id', ctx.tenantId)
    .order('version_number', { ascending: false })
  const [{ data, count, error }, live] = await Promise.all([
    applyPage(query, page),
    // Best effort: a failing count must not fail the version list.
    Promise.resolve()
      .then(() => (ctx.supabase as any).rpc('workflow_live_instance_counts', { p_tenant_id: ctx.tenantId, p_workflow_id: workflowId }))
      .catch(() => ({ data: [] })),
  ])
  if (error) throw dbError(error)
  // Live (waiting / paused) runs per version; 0 when the count is unavailable.
  const liveByVersion = new Map(((live?.data ?? []) as Array<{ version_id: string | null; instances: number }>).map((r) => [r.version_id, Number(r.instances) || 0]))
  const versions = ((data ?? []) as any[]).map((v) => ({ ...v, active_instances: liveByVersion.get(v.id) ?? 0 }))
  return { versions, total: (count ?? versions.length) as number }
}

/** One published snapshot with its full definition (nodes, edges, trigger config, variables). */
export async function getWorkflowVersion(ctx: ServiceContext, workflowId: string, versionId: string) {
  requirePerm(ctx, 'workflows.view')
  await loadOwned(ctx, workflowId)
  const { data, error } = await (ctx.supabase as any).from('workflow_versions')
    .select('*').eq('id', versionId).eq('workflow_id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow version not found')
  return data
}

// ─── Authoring: definition read, create, update (draft) and publish ───
//
// Shared by POST /api/v1/workflows, /api/v1/workflows/{id}[/definition|
// /publish] and the MCP workflows_get_definition / workflows_create /
// workflows_update / workflows_publish tools. Same draft model as the editor
// (app/actions/automations.ts): saving edits the draft and sets
// has_unpublished_changes; publishing snapshots the draft into a new active
// workflow_versions row, which is what runs execute.

export { WORKFLOW_DEFINITION_FIELDS, unwrapWorkflowBody } from '@/lib/api-schemas/workflows'

export type WorkflowDefinitionField = (typeof WORKFLOW_DEFINITION_FIELDS)[number]
export type WorkflowDefinition = { [K in WorkflowDefinitionField]: any }

export interface WorkflowWriteInput extends Partial<WorkflowDefinition> {
  is_active?: boolean
  publish?: boolean
  publish_notes?: string | null
}

const DEFINITION_DEFAULTS: Record<WorkflowDefinitionField, unknown> = {
  name: '', description: null, trigger_type: 'manual', trigger_config: {}, nodes: [], edges: [],
  user_variables: [], swimlanes: [], sections: [], tags: [],
}

/** The author payload (exactly what PATCH /workflows/{id} and POST /workflows accept) from a workflow row. */
export function toWorkflowDefinition(row: Record<string, any>): WorkflowDefinition {
  const out = {} as WorkflowDefinition
  for (const field of WORKFLOW_DEFINITION_FIELDS) out[field] = row[field] ?? DEFINITION_DEFAULTS[field]
  return out
}

function middlewareViolation(triggerType: string, nodes: unknown[]): string | null {
  if (triggerType !== 'middleware_received') return null
  if (nodes.some((node) => isPlainObject(node) && node.type === 'user_task')) {
    return 'Middleware workflows cannot contain user_task nodes. Remove user tasks before adding or publishing middleware flows.'
  }
  if (nodes.length > 0 && !nodes.some((node) => isPlainObject(node) && node.type === 'end_workflow')) {
    return 'Middleware workflows must include an end_workflow node so the synchronous response can be returned to the caller.'
  }
  return null
}

/** Node ids unique, every edge endpoint a known node, middleware rules. */
function validateGraph(triggerType: string, nodes: unknown, edges: unknown) {
  if (!Array.isArray(nodes)) throw ServiceError.validation('nodes must be an array')
  if (!Array.isArray(edges)) throw ServiceError.validation('edges must be an array')
  const ids = new Set<string>()
  for (const node of nodes) {
    if (!isPlainObject(node) || typeof node.id !== 'string' || !node.id) throw ServiceError.validation('Every node needs a string id')
    if (ids.has(node.id)) throw ServiceError.validation(`Duplicate node id '${node.id}'`)
    ids.add(node.id)
  }
  for (const edge of edges) {
    if (!isPlainObject(edge)) throw ServiceError.validation('Every edge must be an object')
    if (!ids.has(edge.source as string)) throw ServiceError.validation(`Edge '${edge.id}' references unknown source node '${edge.source}'`)
    if (!ids.has(edge.target as string)) throw ServiceError.validation(`Edge '${edge.id}' references unknown target node '${edge.target}'`)
  }
  const violation = middlewareViolation(triggerType, nodes)
  if (violation) throw ServiceError.validation(violation)
}

/** The draft definition (what the editor shows), in author-payload shape. */
export async function getWorkflowDefinition(ctx: ServiceContext, workflowId: string): Promise<WorkflowDefinition> {
  requirePerm(ctx, 'workflows.view')
  requireWorkflowScope(ctx, workflowId)
  const { data, error } = await (ctx.supabase as any).from('workflows')
    .select(WORKFLOW_DEFINITION_FIELDS.join(', ')).eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow not found')
  return toWorkflowDefinition(data)
}

/**
 * Create a workflow from an author payload. The nodes must include the
 * trigger node (type = trigger_type). `publish: true` also publishes v1
 * (needs workflows.activate).
 */
export async function createWorkflow(ctx: ServiceContext, input: WorkflowWriteInput & { name: string }) {
  // The UI and MCP gate creation on workflows.create, the API has always
  // used workflows.edit: either is enough.
  if (!hasPerm(ctx, 'workflows.create')) requirePerm(ctx, 'workflows.edit')
  if (input.publish) requirePerm(ctx, 'workflows.activate')
  if (ctx.resourceScopes?.workflow_ids?.length) throw ServiceError.forbidden('Creating workflows is not allowed for workflow-scoped credentials')
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('name is required')
  const triggerType = input.trigger_type || 'webhook_received'
  const nodes = input.nodes ?? []
  const edges = input.edges ?? []
  if (!Array.isArray(nodes) || !nodes.some((node) => isPlainObject(node) && node.type === triggerType)) {
    throw ServiceError.validation(`Nodes must include a trigger node of type '${triggerType}'`)
  }
  validateGraph(triggerType, nodes, edges)

  const { data, error } = await (ctx.supabase as any).from('workflows').insert({
    tenant_id: ctx.tenantId,
    name,
    description: input.description ?? null,
    trigger_type: triggerType,
    trigger_config: input.trigger_config ?? {},
    nodes,
    edges,
    user_variables: input.user_variables ?? [],
    swimlanes: input.swimlanes ?? [],
    sections: input.sections ?? [],
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    is_active: input.publish ? true : (input.is_active ?? false),
    has_unpublished_changes: !input.publish,
    created_by: ctx.actorId,
  }).select('id, name, is_active').single()
  if (error || !data) throw dbError(error, 'Failed to create workflow')
  invalidateDataTableTriggerCache(ctx.tenantId)

  await audit(ctx, {
    objectType: 'workflow', objectId: data.id, action: 'create',
    summary: `Created workflow "${name}"`, metadata: { trigger_type: triggerType },
  })
  await syncChange(ctx, 'workflow', data)

  const published = input.publish ? await publishWorkflow(ctx, data.id, input.publish_notes) : null
  return {
    workflow_id: data.id as string,
    name,
    node_count: nodes.length,
    edge_count: edges.length,
    is_active: published ? true : Boolean(data.is_active),
    published: Boolean(published),
    ...(published ? { version_number: published.version_number, version_id: published.version_id } : {}),
  }
}

/**
 * Save draft changes. Only the fields given change; a field equal to what is
 * stored is not a change, so sending a fetched definition back unedited
 * reports `changed: false` and leaves has_unpublished_changes alone.
 * `publish: true` then publishes the draft (needs workflows.activate).
 */
export async function updateWorkflow(ctx: ServiceContext, workflowId: string, input: WorkflowWriteInput) {
  requirePerm(ctx, 'workflows.edit')
  if (input.publish) requirePerm(ctx, 'workflows.activate')
  requireWorkflowScope(ctx, workflowId)
  const { data: existing, error } = await (ctx.supabase as any).from('workflows')
    .select(`id, is_active, ${WORKFLOW_DEFINITION_FIELDS.join(', ')}`).eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!existing) throw ServiceError.notFound('Workflow not found')

  const before = toWorkflowDefinition(existing)
  const changes: Record<string, unknown> = {}
  for (const field of WORKFLOW_DEFINITION_FIELDS) {
    // null clears a field: back to its default ([] / {}), description stays null.
    const value = input[field] === null ? DEFINITION_DEFAULTS[field] : input[field]
    if (value === undefined) continue
    if (field === 'trigger_type' && !value) throw ServiceError.validation('trigger_type cannot be empty')
    if (field === 'name' && !String(value).trim()) throw ServiceError.validation('name cannot be empty')
    if (diffValues(before[field], value).length > 0) changes[field] = field === 'name' ? String(value).trim() : value
  }
  if (changes.nodes !== undefined || changes.edges !== undefined || changes.trigger_type !== undefined) {
    validateGraph(
      String(changes.trigger_type ?? before.trigger_type),
      changes.nodes ?? before.nodes,
      changes.edges ?? before.edges,
    )
  }
  const activeChange = input.is_active !== undefined && input.is_active !== Boolean(existing.is_active)
  if (activeChange) requirePerm(ctx, 'workflows.activate')
  if (activeChange && input.is_active) await assertActivatable(ctx, workflowId)

  const changedFields = Object.keys(changes)
  if (changedFields.length || activeChange) {
    const update: Record<string, unknown> = { ...changes }
    if (changedFields.length) update.has_unpublished_changes = true
    if (activeChange) update.is_active = input.is_active
    const { error: updateError } = await (ctx.supabase as any).from('workflows')
      .update(update).eq('id', workflowId).eq('tenant_id', ctx.tenantId)
    if (updateError) throw dbError(updateError, 'Failed to update workflow')
    invalidateDataTableTriggerCache(ctx.tenantId)
    await audit(ctx, {
      objectType: 'workflow', objectId: workflowId, action: 'update',
      summary: `Updated workflow "${String(changes.name ?? before.name)}"`,
      metadata: { fields: [...changedFields, ...(activeChange ? ['is_active'] : [])] },
    })
    await syncChange(ctx, 'workflow', { id: workflowId, name: String(changes.name ?? before.name) })
  }

  const published = input.publish ? await publishWorkflow(ctx, workflowId, input.publish_notes) : null
  return {
    workflow_id: workflowId,
    name: String(changes.name ?? before.name),
    changed: changedFields.length > 0 || activeChange,
    updated_fields: [...changedFields, ...(activeChange ? ['is_active'] : [])],
    published: Boolean(published),
    ...(published ? { version_number: published.version_number, version_id: published.version_id } : {}),
  }
}

/** Snapshot the current draft as the next active version (what runs execute) and activate the workflow. */
export async function publishWorkflow(ctx: ServiceContext, workflowId: string, notes?: string | null) {
  requirePerm(ctx, 'workflows.activate')
  requireWorkflowScope(ctx, workflowId)
  const db = ctx.supabase as any
  const { data: workflow, error } = await db.from('workflows')
    .select('*').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')
  validateGraph(String(workflow.trigger_type ?? ''), workflow.nodes ?? [], workflow.edges ?? [])
  await assertActivatable(ctx, workflowId)

  const { data: last, error: lastError } = await db.from('workflow_versions')
    .select('version_number').eq('workflow_id', workflowId).eq('tenant_id', ctx.tenantId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle()
  if (lastError) throw dbError(lastError)
  const versionNumber = (last?.version_number ?? 0) + 1

  const { error: deactivateError } = await db.from('workflow_versions')
    .update({ is_active: false }).eq('workflow_id', workflowId).eq('tenant_id', ctx.tenantId).eq('is_active', true)
  if (deactivateError) throw dbError(deactivateError)

  // Linked reusable forms are pinned to their current version in the snapshot.
  const pinned = await pinWorkflowForms(await serviceRoleClient(ctx), ctx.tenantId, workflow.nodes, workflow.trigger_config ?? {})
  const { data: version, error: versionError } = await db.from('workflow_versions').insert({
    workflow_id: workflowId,
    tenant_id: ctx.tenantId,
    version_number: versionNumber,
    nodes: pinned.nodes,
    edges: workflow.edges,
    user_variables: workflow.user_variables ?? [],
    swimlanes: workflow.swimlanes ?? [],
    sections: workflow.sections ?? [],
    trigger_type: workflow.trigger_type,
    trigger_config: pinned.trigger_config,
    publish_notes: notes || null,
    published_by: ctx.actorId,
    is_active: true,
  }).select('id').single()
  if (versionError || !version) throw dbError(versionError, 'Failed to publish workflow')

  const { error: pointError } = await db.from('workflows').update({
    published_version_id: version.id,
    has_unpublished_changes: false,
    is_active: true,
  }).eq('id', workflowId).eq('tenant_id', ctx.tenantId)
  if (pointError) throw dbError(pointError)
  invalidateDataTableTriggerCache(ctx.tenantId)

  await audit(ctx, {
    objectType: 'workflow', objectId: workflowId, action: 'publish',
    summary: `Published version ${versionNumber} of "${workflow.name}"`,
    metadata: { version_number: versionNumber, version_id: version.id, publish_notes: notes ?? null },
  })
  await syncChange(ctx, 'workflow', workflow)
  return { workflow_id: workflowId, published: true as const, version_number: versionNumber, version_id: version.id as string }
}

/** Star / unstar a node type in the designer palette (favorites are tenant-wide). */
export async function setNodeFavorite(ctx: ServiceContext, nodeType: string, favorite: boolean) {
  requirePerm(ctx, 'workflows.edit')
  const type = String(nodeType ?? '').trim()
  if (!type || type.length > 100) throw ServiceError.validation('nodeType is required')
  const db = ctx.supabase as any
  const { error } = favorite
    ? await db.from('node_favorites').insert({ tenant_id: ctx.tenantId, node_type: type })
    : await db.from('node_favorites').delete().eq('tenant_id', ctx.tenantId).eq('node_type', type)
  // Starring twice is not an error.
  if (error && error.code !== '23505') throw dbError(error, 'Failed to update favorites')
  return { node_type: type, favorite }
}
