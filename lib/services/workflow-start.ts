/**
 * Starting workflows by hand: the input schema of a workflow and the start
 * itself. Shared by POST /api/v1/workflows/start, GET /api/v1/workflows/{id}/inputs,
 * the MCP workflows_start / workflows_inputs_get tools and the Run dialog's
 * server action, so every surface validates inputs the same way.
 *
 * Inputs come from the published version's user_variables (the draft's while
 * the workflow was never published — runs then use the draft too). Required
 * inputs are enforced and values coerced to their types (400 with per-field
 * `details` otherwise); a workflow without declared inputs accepts any
 * variables, as before. Starting needs workflows.activate, reading the
 * schema workflows.view.
 *
 * The run's `workflow_started_by` is the context's user (the signed-in user,
 * an API key's / OAuth token's user, a tenant key's creator) and
 * `workflow_started_via` its channel (ui / api / cli / mcp, or the caller's
 * `via` — a form button passes `form`); start variables never set them.
 * Queued starts carry the initiator signed (lib/workflow-initiator).
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { executeWorkflow } from '@/lib/workflow-engine'
import { initiatorFromContext, stripInitiatorVariables, withQueuedInitiator, type StartedVia } from '@/lib/workflow-initiator'
import { kickQueueProcessor } from '@/lib/process-queue'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { parseFormThemeRef } from '@/lib/forms/form-theme'
import { resolveThemeOverrides } from './forms'
import {
  deriveInputFields,
  formatInputErrors,
  validateWorkflowInputs,
  type WorkflowInputSchema,
} from '@/lib/workflow-inputs'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows are untyped here */

function requireWorkflowScope(ctx: ServiceContext, workflowId: string) {
  const allow = ctx.resourceScopes?.workflow_ids
  if (allow?.length && !allow.includes(workflowId)) {
    throw ServiceError.forbidden('This API key is not allowed to start that workflow')
  }
}

/** A task a run is started on must be one of the caller's tenant (the engine reads it with a service-role client). */
async function requireTenantTask(ctx: ServiceContext, taskId: string) {
  const { data: task, error } = await (ctx.supabase as any).from('tasks')
    .select('id').eq('id', taskId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
}

interface LoadedWorkflow {
  schema: WorkflowInputSchema
  publishedVersionId: string | null
}

async function loadWorkflowInputs(ctx: ServiceContext, workflowId: string): Promise<LoadedWorkflow> {
  requireWorkflowScope(ctx, workflowId)
  const { data: workflow, error } = await (ctx.supabase as any).from('workflows')
    .select('id, name, is_active, published_version_id, user_variables, nodes')
    .eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')

  const publishedVersionId: string | null = workflow.published_version_id ?? null
  let version: { id: string; version_number: number | null; user_variables: unknown; nodes: unknown } | null = null
  if (publishedVersionId) {
    const { data, error: versionError } = await (ctx.supabase as any).from('workflow_versions')
      .select('id, version_number, user_variables, nodes').eq('id', publishedVersionId).maybeSingle()
    if (versionError) throw dbError(versionError)
    version = data ?? null
  }

  return {
    publishedVersionId,
    schema: {
      workflow_id: workflow.id,
      workflow_name: workflow.name ?? '',
      is_active: Boolean(workflow.is_active),
      published: Boolean(publishedVersionId),
      source: version ? 'published' : 'draft',
      version_id: version?.id ?? null,
      version_number: version?.version_number ?? null,
      fields: deriveInputFields(version ? version.user_variables : workflow.user_variables),
      start_form: await resolveStartForm(ctx, version ? version.nodes : workflow.nodes, deriveInputFields(version ? version.user_variables : workflow.user_variables).map((f) => f.key)),
    },
  }
}

/** The trigger node's `start_form` (form designer): grid against the input keys, theme resolved to overrides. */
async function resolveStartForm(ctx: ServiceContext, nodes: unknown, keys: string[]): Promise<WorkflowInputSchema['start_form']> {
  const trigger = (Array.isArray(nodes) ? nodes : []).find((n: any) => n?.config?.start_form)
  const stored = (trigger as any)?.config?.start_form
  if (!stored) return null
  const layout = normalizeFormLayout(stored.layout, keys)
  let theme = null
  try {
    theme = await resolveThemeOverrides(ctx.supabase, ctx.tenantId, parseFormThemeRef(stored.theme))
  } catch { theme = null }
  return layout || theme ? { layout, theme: theme as Record<string, unknown> | null } : null
}

/** The input form of a workflow (fields from the published version, else the draft). */
export async function getWorkflowInputs(ctx: ServiceContext, workflowId: string): Promise<WorkflowInputSchema> {
  requirePerm(ctx, 'workflows.view')
  return (await loadWorkflowInputs(ctx, workflowId)).schema
}

export interface StartWorkflowInput {
  workflow_id: string
  variables?: Record<string, unknown> | null
  async?: boolean
  task_id?: string | null
  priority?: number | null
}

export type StartWorkflowResult =
  | { mode: 'async'; job_id: string; run_id?: string; workflow_id: string; published_version_id: string | null; warnings?: string[] }
  | {
      mode: 'sync'; run_id: string | null; status: string; node_results: Record<string, unknown>; error?: string
      workflow_id: string; published_version_id: string | null; warnings?: string[]
    }

/**
 * Start a run of an active workflow on its published version (the draft when
 * never published). Async enqueues it (priority 0-100), sync runs it now.
 */
export async function startWorkflow(ctx: ServiceContext, input: StartWorkflowInput, options: {
  via?: StartedVia
  /** Attachments values were built by the server already (a form button's Start workflow, from the stored submission). */
  filesVerified?: boolean
} = {}): Promise<StartWorkflowResult> {
  requirePerm(ctx, 'workflows.activate')
  const { schema, publishedVersionId } = await loadWorkflowInputs(ctx, input.workflow_id)
  if (!schema.is_active) throw ServiceError.validation('Workflow is not active')

  const checked = validateWorkflowInputs(schema.fields, stripInitiatorVariables(input.variables))
  if (!checked.ok) {
    throw ServiceError.validation(`Invalid workflow inputs: ${formatInputErrors(checked.errors)}`,
      checked.errors.map((e) => ({ path: `body.variables.${e.field}`, field: e.field, message: e.message })))
  }
  // Attachments inputs: rebuilt from the upload records (this person's
  // uploads to this workflow's start form, or file ids from the API).
  const attachmentInputs = schema.fields.filter((f) => f.type === 'attachments')
  if (attachmentInputs.length && !options.filesVerified) {
    const { resolveAttachmentValues } = await import('./form-files')
    const defs = attachmentInputs.map((f) => ({ key: f.key, label: f.label, type: 'attachments' as const, ...(f.required ? { required: true } : {}), ...(f.attachments ? { attachments: f.attachments } : {}) }))
    const db = await serviceRoleClient(ctx)
    const resolved = await resolveAttachmentValues(db, ctx.tenantId, defs, checked.values, { kind: 'start', workflowId: input.workflow_id, actorId: ctx.actorId })
    if (Object.keys(resolved.errors).length) {
      throw ServiceError.validation(`Invalid workflow inputs: ${Object.entries(resolved.errors).map(([k, m]) => `${k}: ${m}`).join('; ')}`,
        Object.entries(resolved.errors).map(([field, message]) => ({ path: `body.variables.${field}`, field, message })))
    }
    for (const field of attachmentInputs) {
      if (checked.values[field.key] === undefined && resolved.values[field.key] !== undefined && !(resolved.values[field.key] as unknown[]).length) continue
      Object.assign(checked.values, { [field.key]: resolved.values[field.key], [`${field.key}_count`]: resolved.values[`${field.key}_count`] })
    }
  }
  const warnings = checked.warnings.length ? { warnings: checked.warnings } : {}
  if (input.task_id) await requireTenantTask(ctx, input.task_id)
  const priority = Math.max(0, Math.min(Math.round(input.priority ?? 50), 100))
  const initiator = initiatorFromContext(ctx, options.via)

  if (input.async) {
    // enqueue_workflow is service-role only (20261118000000): the
    // workflows.activate check above is the gate.
    const db = await serviceRoleClient(ctx)
    const { data: jobId, error } = await (db as any).rpc('enqueue_workflow', {
      p_workflow_id: input.workflow_id,
      p_tenant_id: ctx.tenantId,
      p_task_id: input.task_id ?? null,
      p_trigger_type: 'api',
      p_trigger_data: withQueuedInitiator({ ...checked.values, _version_id: publishedVersionId }, { tenantId: ctx.tenantId, workflowId: input.workflow_id }, initiator),
      p_priority: priority,
      p_delay_seconds: 0,
    })
    if (error) throw new ServiceError('internal', `Failed to enqueue: ${error.message}`)
    kickQueueProcessor()
    return { mode: 'async', job_id: String(jobId), workflow_id: input.workflow_id, published_version_id: publishedVersionId, ...warnings }
  }

  let result: Awaited<ReturnType<typeof executeWorkflow>>
  try {
    result = await executeWorkflow(input.workflow_id, input.task_id ?? undefined, false, checked.values, undefined, publishedVersionId ?? undefined, undefined, { initiator })
  } catch (e) {
    throw new ServiceError('internal', `Workflow execution failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  return {
    mode: 'sync',
    run_id: result.run_id ?? null,
    status: result.status,
    node_results: result.node_results,
    ...(result.error ? { error: result.error } : {}),
    workflow_id: input.workflow_id,
    published_version_id: publishedVersionId,
    ...warnings,
  }
}

/**
 * Run id of a queued start once the queue worker picked it up (null while it
 * is still queued). The Run dialog polls this briefly to link to the run.
 */
export async function queuedRunId(ctx: ServiceContext, jobId: string): Promise<{ status: string; run_id: string | null } | null> {
  const { data } = await (ctx.supabase as any).from('workflow_queue')
    .select('status, result').eq('id', jobId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!data) return null
  const runId = data.result && typeof data.result === 'object' ? (data.result as any).run_id ?? null : null
  return { status: String(data.status), run_id: runId ? String(runId) : null }
}
