/**
 * Workflow activities (custom workflow steps): CRUD plus portable
 * export/import. Shared by /api/v1/workflow-activities, the MCP
 * workflow_activities_* tools and the Extensibility server actions.
 *
 * Saving an activity never runs its code. Execution stays gated in the
 * workflow engine (ENABLE_CUSTOM_ACTIVITY_CODE, off by default), so an
 * activity can be authored on any server but only runs where an operator
 * has opted in; responses carry `code_execution_enabled` so callers can tell.
 *
 * Every write validates the source shape (an exported run/execute/handler/
 * main entry point) and requires at least one manifest input and output.
 */

import {
  exportWorkflowActivityAsset,
  getWorkflowActivityDisplayName,
  getWorkflowActivityInputDefinitions,
  getWorkflowActivityOutputDefinitions,
  getWorkflowActivityPresentation,
  getWorkflowActivityReadiness,
  getWorkflowActivitySummary,
  normalizeWorkflowActivityManifest,
  parseWorkflowActivityImportPayload,
  slugifyWorkflowActivityKey,
  type PortableWorkflowActivityPayload,
  type WorkflowActivitySourceKind,
  type WorkflowActivityStatus,
} from '@/lib/extensibility'
import { processDeletionQueueBatch } from '@/lib/deletion-queue'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, queueDeletion, queueDeletions, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifest / demo inputs are free-form JSON */

export const WORKFLOW_ACTIVITY_STATUSES = ['draft', 'active', 'archived'] as const
export const WORKFLOW_ACTIVITY_SOURCE_KINDS = ['upload', 'inline'] as const

const LIST_COLUMNS = 'id, name, description, key, status, source_kind, version, icon_name, color, manifest, tags, created_at, updated_at'

export function customActivityCodeEnabled(): boolean {
  return process.env.ENABLE_CUSTOM_ACTIVITY_CODE === 'true'
}

export interface WorkflowActivityInput {
  name: string
  description?: string | null
  key?: string | null
  status?: WorkflowActivityStatus
  source_kind?: WorkflowActivitySourceKind
  version?: string | null
  icon_name?: string | null
  color?: string | null
  source_code: string
  manifest?: Record<string, any> | null
  demo_inputs?: Record<string, any> | null
  tags?: string[] | null
  source_filename?: string | null
}

export type WorkflowActivityUpdateInput = Partial<WorkflowActivityInput>

const ENTRY_POINT = /(?:function\s+(run|execute|handler|main)\b|const\s+(run|execute|handler|main)\s*=|let\s+(run|execute|handler|main)\s*=|var\s+(run|execute|handler|main)\s*=|module\.exports\s*=|exports\.default\s*=|module\.exports\.default\s*=)/
// The engine runs the source as an async function body, so the editor's
// body-style code (`return { outputs }` at the top level) is valid too.
const BODY_RETURN = /(^|[;\n}])\s*return\b/

/** Problems with the source shape (the engine looks for these entry points). */
export function validateWorkflowActivitySource(sourceCode: string): string[] {
  const trimmed = sourceCode.trim()
  if (!trimmed) return ['source_code is required']
  if (!ENTRY_POINT.test(trimmed) && !BODY_RETURN.test(trimmed)) {
    return ['source_code must expose one of run, execute, handler, main, module.exports, or module.exports.default (or return its result from the top level)']
  }
  return []
}

/** Activity row → API shape: manifest summary, display name and readiness findings. */
export function summarizeWorkflowActivity(activity: any) {
  const inputs = getWorkflowActivityInputDefinitions(activity.manifest)
  const outputs = getWorkflowActivityOutputDefinitions(activity.manifest)
  const presentation = getWorkflowActivityPresentation(activity.manifest)
  const readiness = getWorkflowActivityReadiness({ manifest: activity.manifest, name: activity.name, key: activity.key })
  return {
    ...activity,
    manifest_summary: {
      input_count: inputs.length,
      output_count: outputs.length,
      display_name: presentation.displayName ?? null,
      purpose: presentation.purpose ?? null,
      recommended_for: presentation.recommendedFor ?? null,
      summary: getWorkflowActivitySummary(activity.manifest),
      setup_notes: presentation.setupNotes,
      readiness_score: readiness.score,
      readiness_ready: readiness.ready,
      readiness_findings: readiness.findings,
    },
    display_name: getWorkflowActivityDisplayName(activity.manifest, activity.name),
    readiness,
    code_execution_enabled: customActivityCodeEnabled(),
  }
}

export type WorkflowActivitySummary = ReturnType<typeof summarizeWorkflowActivity>

/** Readiness guidance lines (shown after a save). */
export function activityGuidance(activity: WorkflowActivitySummary): string[] {
  return activity.readiness.ready
    ? ['Activity metadata is designer-friendly and ready for workflow use.']
    : activity.readiness.findings.map((finding: { message: string }) => finding.message)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null) return undefined
  if (!(allowed as readonly unknown[]).includes(value)) throw ServiceError.validation(`${field} must be one of ${allowed.join(', ')}`)
  return value as T
}

/** Normalise and validate a full activity payload (create, import, or a merged update). */
function buildRow(input: WorkflowActivityInput) {
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('name is required')
  const key = slugifyWorkflowActivityKey(String(input.key ?? '').trim() || name)
  if (!key) throw ServiceError.validation('A valid activity key is required')
  const sourceCode = String(input.source_code ?? '').trim()
  const problems = validateWorkflowActivitySource(sourceCode)
  if (problems.length) throw ServiceError.validation(problems.join('; '))
  const manifest = normalizeWorkflowActivityManifest(input.manifest ?? {})
  if (manifest.inputs.length === 0) throw ServiceError.validation('manifest.inputs must include at least one input')
  if (manifest.outputs.length === 0) throw ServiceError.validation('manifest.outputs must include at least one output')
  const demoInputs = input.demo_inputs && typeof input.demo_inputs === 'object' && !Array.isArray(input.demo_inputs) ? input.demo_inputs : {}
  return {
    name,
    description: String(input.description ?? '').trim() || null,
    key,
    status: oneOf(input.status, WORKFLOW_ACTIVITY_STATUSES, 'status') ?? 'draft',
    source_kind: oneOf(input.source_kind, WORKFLOW_ACTIVITY_SOURCE_KINDS, 'source_kind') ?? 'inline',
    version: String(input.version ?? '').trim() || '1.0.0',
    icon_name: String(input.icon_name ?? '').trim() || 'Puzzle',
    color: String(input.color ?? '').trim() || '#0EA5E9',
    source_code: sourceCode,
    manifest,
    demo_inputs: demoInputs,
    tags: (Array.isArray(input.tags) ? input.tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean),
    source_filename: String(input.source_filename ?? '').trim() || null,
    updated_at: new Date().toISOString(),
  }
}

/** Supabase error → ServiceError (duplicate key → 409). */
function writeError(error: { code?: string; message?: string } | null | undefined, key: string, fallback: string): Error {
  if (error?.code === '23505') return ServiceError.conflict(`A workflow activity with key "${key}" already exists`)
  return dbError(error, fallback)
}

async function loadOwned(ctx: ServiceContext, activityId: string, select = '*') {
  const { data, error } = await (ctx.supabase as any).from('custom_workflow_activities')
    .select(select).eq('id', activityId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow activity not found')
  return data as any
}

export async function listWorkflowActivities(
  ctx: ServiceContext,
  filters: { search?: string; status?: WorkflowActivityStatus } = {},
  page: Page,
) {
  requirePerm(ctx, 'extensibility.view')
  let query = (ctx.supabase as any).from('custom_workflow_activities')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('updated_at', { ascending: false })
  if (filters.status) query = query.eq('status', oneOf(filters.status, WORKFLOW_ACTIVITY_STATUSES, 'status'))
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%,key.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return {
    workflow_activities: (data ?? []).map(summarizeWorkflowActivity) as WorkflowActivitySummary[],
    total: (count ?? (data ?? []).length) as number,
  }
}

/** Full activity (source code, manifest, demo inputs) with its summary. */
export async function getWorkflowActivity(ctx: ServiceContext, activityId: string) {
  requirePerm(ctx, 'extensibility.view')
  return summarizeWorkflowActivity(await loadOwned(ctx, activityId))
}

async function insertActivity(ctx: ServiceContext, input: WorkflowActivityInput, auditAction: 'create' | 'import') {
  const row = buildRow(input)
  const { data, error } = await (ctx.supabase as any).from('custom_workflow_activities').insert({
    ...row,
    tenant_id: ctx.tenantId,
    created_by: ctx.actorId,
    updated_by: ctx.actorId,
  }).select('*').single()
  if (error || !data) throw writeError(error, row.key, 'Failed to create workflow activity')
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: data.id, action: 'create',
    summary: `${auditAction === 'import' ? 'Imported' : 'Created'} workflow activity "${data.name}"`,
    ...(auditAction === 'import' ? { metadata: { imported: true } } : {}),
  })
  void syncChange(ctx, 'workflow_activity', data)
  return summarizeWorkflowActivity(data)
}

export async function createWorkflowActivity(ctx: ServiceContext, input: WorkflowActivityInput) {
  requirePerm(ctx, 'extensibility.create')
  return insertActivity(ctx, input, 'create')
}

/** Partial update: omitted fields keep their stored values. */
export async function updateWorkflowActivity(ctx: ServiceContext, activityId: string, input: WorkflowActivityUpdateInput) {
  requirePerm(ctx, 'extensibility.edit')
  const existing = await loadOwned(ctx, activityId)
  const pick = <K extends keyof WorkflowActivityInput>(key: K) => (input[key] !== undefined ? input[key] : existing[key])
  const row = buildRow({
    name: pick('name') as string,
    description: pick('description'),
    key: pick('key'),
    status: pick('status'),
    source_kind: pick('source_kind'),
    version: pick('version'),
    icon_name: pick('icon_name'),
    color: pick('color'),
    source_code: pick('source_code') as string,
    manifest: pick('manifest'),
    demo_inputs: pick('demo_inputs'),
    tags: pick('tags'),
    source_filename: pick('source_filename'),
  })
  const { data, error } = await (ctx.supabase as any).from('custom_workflow_activities')
    .update({ ...row, updated_by: ctx.actorId ?? existing.updated_by ?? null })
    .eq('id', activityId).eq('tenant_id', ctx.tenantId)
    .select('*').single()
  if (error || !data) throw writeError(error, row.key, 'Failed to update workflow activity')
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: activityId, action: 'update',
    summary: `Updated workflow activity "${data.name}"`,
    metadata: { fields: Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined) },
  })
  void syncChange(ctx, 'workflow_activity', data)
  return summarizeWorkflowActivity(data)
}

/**
 * Queue the activity for deletion (deletion queue, audit, sync). By default
 * the queue is drained inline so the row — and its key — are gone on return.
 */
export async function deleteWorkflowActivity(ctx: ServiceContext, activityId: string, options: { processInline?: boolean } = {}) {
  requirePerm(ctx, 'extensibility.delete')
  const existing = await loadOwned(ctx, activityId, 'id, name')
  await queueDeletion(ctx, 'workflow_activity', activityId, { name: existing.name ?? null })
  await audit(ctx, {
    objectType: 'workflow_activity', objectId: activityId, action: 'delete',
    summary: `Queued deletion for workflow activity "${existing.name}"`,
  })
  void syncChange(ctx, 'workflow_activity', existing, 'delete')
  if (options.processInline !== false) await processDeletionQueueBatch({ batchSize: 10 })
  return { deleted: true as const, id: activityId }
}

/** Delete several activities (ids outside the tenant are ignored); queued, not drained inline. */
export async function bulkDeleteWorkflowActivities(ctx: ServiceContext, activityIds: string[]) {
  requirePerm(ctx, 'extensibility.delete')
  if (activityIds.length === 0) return { deleted: 0, ids: [] as string[] }
  const { data, error } = await (ctx.supabase as any).from('custom_workflow_activities')
    .select('id, name').eq('tenant_id', ctx.tenantId).in('id', activityIds)
  if (error) throw dbError(error)
  const rows = (data ?? []) as Array<{ id: string; name: string | null }>
  // One queue insert and one processor kick for the batch.
  await queueDeletions(ctx, 'workflow_activity', rows.map((row) => ({ id: row.id, payload: { name: row.name ?? null } })))
  for (const existing of rows) {
    await audit(ctx, {
      objectType: 'workflow_activity', objectId: existing.id, action: 'delete',
      summary: `Queued deletion for workflow activity "${existing.name}"`,
    })
    void syncChange(ctx, 'workflow_activity', existing, 'delete')
  }
  return { deleted: rows.length, ids: rows.map((row) => row.id) }
}

/** Portable JSON export (no ids or tenant data), accepted by importWorkflowActivity. */
export async function exportWorkflowActivity(ctx: ServiceContext, activityId: string): Promise<PortableWorkflowActivityPayload> {
  requirePerm(ctx, 'extensibility.view')
  return exportWorkflowActivityAsset(await loadOwned(ctx, activityId))
}

/**
 * Create an activity from a portable export (JSON text or object; either the
 * `{ asset_type, workflow_activity }` envelope or the bare activity).
 * `publish` makes it active regardless of the exported status.
 */
export async function importWorkflowActivity(
  ctx: ServiceContext,
  source: string | object,
  options: { publish?: boolean } = {},
) {
  requirePerm(ctx, 'extensibility.create')
  const { payload, error } = parseWorkflowActivityImportPayload(typeof source === 'string' ? source : JSON.stringify(source))
  if (error || !payload) throw ServiceError.validation(error ?? 'Invalid import payload')
  if (!String(payload.name ?? '').trim()) throw ServiceError.validation('Imported activity name is required')
  return insertActivity(ctx, {
    name: String(payload.name),
    description: payload.description ?? null,
    key: payload.key ?? null,
    status: options.publish ? 'active' : (payload.status ?? 'draft'),
    source_kind: payload.source_kind ?? 'inline',
    version: payload.version ?? null,
    icon_name: payload.icon_name ?? null,
    color: payload.color ?? null,
    source_code: String(payload.source_code ?? ''),
    manifest: payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : {},
    demo_inputs: payload.demo_inputs && typeof payload.demo_inputs === 'object' ? payload.demo_inputs : {},
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    source_filename: payload.source_filename ?? null,
  }, 'import')
}
