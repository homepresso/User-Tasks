/**
 * Running "For each changed row" rules (lib/forms/table-changes.ts) on the
 * server: a submitting button's `apply_table_changes` action (after the
 * submission is stored, from runButtonActions) and an in-form Button's
 * "Apply table changes" step (applyTableChangesFromButton).
 *
 * Rules:
 *  - The targets (table, reference, workflow, mappings) come only from the
 *    saved form definition; the browser only sends the change set, which is
 *    validated against the declared columns and re-read from the source
 *    (`before`) by resolveDataTableValues before anything runs.
 *  - Data table writes run AS THE SUBMITTER through the data-tables service:
 *    data.manage_rows is required and the submitter's own database client is
 *    used (RLS for a session). A matching row is looked up in the target
 *    table by the configured column; one that matches several rows fails.
 *  - API calls and workflow starts were configured by the form's author
 *    (who needed integrations.test / workflows.activate to add them,
 *    lib/services/forms) and run as system actions attributed to the
 *    submitter, like a button's Start workflow. Credentials stay on the
 *    server; per-row results (HTTP status, a bounded excerpt) are captured.
 *  - Ordered deletes → updates → inserts (default); stop at the first error
 *    or continue and report. At most TABLE_CHANGES_LIMITS.maxOpsPerRun rows.
 *  - Idempotent: one form_table_change_runs row per idempotency key (the
 *    submission + action, or the browser's click key). A repeat returns the
 *    first run's summary; a run still in progress is refused.
 *  - Audited on the form; the run row keeps the per-row results.
 */

import {
  dryRunTableChanges, normalizeTableChanges, planTableChanges, summarizeTableChanges, tableChangesProblem,
  type ChangesScope, type PlannedOp, type TableChangeResult, type TableChangesConfig, type TableChangesSummary,
} from '@/lib/forms/table-changes'
import { emptyChangeSet, isChangeSet, type DataTableChangeSet, type DataTableColumnType } from '@/lib/forms/data-table'
import { coerceTaskFieldValues, normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- run rows and table rows are free-form JSON */

const REFERENCE_TIMEOUT_MS = 15_000
const RESPONSE_EXCERPT = 2000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Test seams. */
export const tableChangesDeps = {
  executeReference: async (opts: Parameters<typeof import('@/lib/reference-executor').executeReference>[0]) => (await import('@/lib/reference-executor')).executeReference(opts),
  startWorkflow: async (...args: Parameters<typeof import('./workflow-start').startWorkflow>) => (await import('./workflow-start')).startWorkflow(...args),
  dataTables: async () => import('./data-tables'),
  now: () => new Date(),
}

export interface RunTableChangesInput {
  config: TableChangesConfig
  fields: TaskFieldDef[]
  /** Server-verified values (the change set already passed resolveDataTableValues). */
  values: Record<string, unknown>
  idempotencyKey: string
  origin: 'submit' | 'button'
  form?: { id: string | null; name: string }
  taskId?: string | null
  submissionId?: string | null
}

function systemContext(ctx: ServiceContext, db: AnySupabaseClient): ServiceContext {
  return { db, supabase: db, tenantId: ctx.tenantId, actorId: ctx.actorId, permissions: null, authKind: 'job', source: 'job' }
}

function columnTypes(fields: TaskFieldDef[], fieldKey: string): Record<string, DataTableColumnType> {
  const field = fields.find((f) => f.key === fieldKey)
  return Object.fromEntries((field?.data_table?.columns ?? []).map((c) => [c.key, c.type]))
}

function excerpt(data: unknown): unknown {
  try {
    const json = JSON.stringify(data ?? null)
    return json.length <= RESPONSE_EXCERPT ? JSON.parse(json) : `${json.slice(0, RESPONSE_EXCERPT)}…`
  } catch { return null }
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ServiceError) return error.message.slice(0, 300)
  return fallback
}

async function userScope(db: AnySupabaseClient, actorId: string | null): Promise<ChangesScope['user']> {
  if (!actorId) return null
  const { data } = await (db as any).from('users').select('id, email, display_name').eq('id', actorId).maybeSingle()
  return { id: actorId, email: data?.email ?? null, name: data?.display_name ?? null }
}

/** Target rows matching a value (the row id, or `data->>column`), read with the submitter's client. */
async function matchRows(ctx: ServiceContext, tableId: string, column: string, value: unknown): Promise<string[]> {
  const text = value === null || value === undefined ? '' : String(value)
  if (!text) return []
  let q = (ctx.supabase as any).from('custom_table_rows').select('id').eq('tenant_id', ctx.tenantId).eq('table_id', tableId)
  if (column === 'row_id') {
    if (!UUID_RE.test(text)) return []
    q = q.eq('id', text)
  } else q = q.eq(`data->>${column}`, text)
  const { data, error } = await q.limit(2)
  if (error) throw new ServiceError('internal', 'The target table could not be read')
  return ((data ?? []) as any[]).map((r) => String(r.id))
}

async function runOp(ctx: ServiceContext, sys: AnySupabaseClient, config: TableChangesConfig, op: PlannedOp, callerId: string | null, extra: { formId: string | null; submissionId: string | null }): Promise<TableChangeResult> {
  const base: TableChangeResult = { kind: op.kind, key: op.key, action: op.action, status: 'ok' }
  try {
    if (op.action === 'call') {
      const { newTraceId } = await import('@/lib/trace')
      const inputs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(op.data ?? {})) inputs[k] = v
      const result = await tableChangesDeps.executeReference({
        supabase: sys as any,
        referenceId: config.reference_id!,
        inputValues: inputs,
        timeout: REFERENCE_TIMEOUT_MS,
        expectedTenantId: ctx.tenantId,
        caller: { traceId: newTraceId(), callerType: 'form_submit', callerId },
      })
      const status = result.status ?? 200
      if (status >= 400) return { ...base, status: 'failed', http_status: status, error: `The API answered ${status}${result.error_message ? `: ${String(result.error_message).slice(0, 200)}` : ''}`, response: excerpt(result.data) }
      return { ...base, http_status: status, response: excerpt(result.data) }
    }
    if (op.action === 'start') {
      const started = await tableChangesDeps.startWorkflow(systemContext(ctx, sys), {
        workflow_id: config.workflow_id!,
        variables: { ...(op.data ?? {}), form_submission_id: extra.submissionId, form_id: extra.formId },
        async: true,
      }, { via: ctx.authKind === 'anonymous' ? 'anonymous' : 'form', filesVerified: true })
      return { ...base, ...(started.mode === 'async' ? { id: started.job_id } : {}) }
    }
    const tableId = config.table_id!
    const svc = await tableChangesDeps.dataTables()
    if (op.action === 'insert') {
      const [written] = await svc.upsertRows(ctx, tableId, [{ data: op.data ?? {} }])
      return { ...base, id: written?.row_id }
    }
    const matches = await matchRows(ctx, tableId, op.match?.column ?? 'row_id', op.match?.value)
    if (matches.length > 1) return { ...base, status: 'failed', error: `Several rows match ${op.match?.column} = ${String(op.match?.value ?? '').slice(0, 60)}` }
    if (op.action === 'delete') {
      if (!matches.length) return { ...base, status: 'failed', error: 'No matching row to delete' }
      await svc.deleteRows(ctx, tableId, matches)
      return { ...base, id: matches[0] }
    }
    if (!matches.length) {
      if (op.action === 'update') return { ...base, status: 'failed', error: 'No matching row to update' }
      const [written] = await svc.upsertRows(ctx, tableId, [{ data: op.data ?? {} }])
      return { ...base, id: written?.row_id }
    }
    await svc.updateRow(ctx, tableId, matches[0], op.data ?? {})
    return { ...base, id: matches[0] }
  } catch (error) {
    return { ...base, status: 'failed', error: errorText(error, op.action === 'call' ? 'The API call failed' : op.action === 'start' ? 'The workflow could not be started' : 'The row could not be written') }
  }
}

/** The change set of a verified value (an empty one when there is none). */
function changeSetOf(value: unknown): DataTableChangeSet {
  if (!isChangeSet(value)) return emptyChangeSet()
  return { added: value.added ?? [], updated: value.updated ?? [], deleted: value.deleted ?? [] }
}

/**
 * Run one rule for a verified change set. Never throws for a row's failure
 * (it is in the summary); throws for a refused run (permissions, a run with
 * the same key still in progress).
 */
export async function runTableChanges(ctx: ServiceContext, input: RunTableChangesInput): Promise<TableChangesSummary> {
  const config = normalizeTableChanges(input.config)
  const editable = new Set(input.fields.filter((f) => f.type === 'data_table' && f.data_table?.mode === 'edit').map((f) => f.key))
  const problem = tableChangesProblem(config, editable)
  if (problem) throw ServiceError.validation(problem)
  if (config.target === 'table') requirePerm(ctx, 'data.manage_rows')
  const sys = await serviceRoleClient(ctx)
  const changes = changeSetOf(input.values[config.field])
  const scope: ChangesScope = { values: input.values, user: await userScope(sys, ctx.actorId), now: tableChangesDeps.now() }
  const plan = planTableChanges(config, changes, scope, columnTypes(input.fields, config.field))
  if (plan.over_cap) throw ServiceError.validation('Too many table changes to apply at once')
  if (!plan.ops.length) return summarizeTableChanges(config, [], { skipped: plan.skipped })

  // Idempotency: claim the key (a repeat returns the first run's summary).
  const key = input.idempotencyKey.slice(0, 200)
  const { data: claimed, error: claimError } = await (sys as any).from('form_table_change_runs').insert({
    tenant_id: ctx.tenantId,
    idempotency_key: key,
    form_id: input.form?.id && UUID_RE.test(input.form.id) ? input.form.id : null,
    task_id: input.taskId && UUID_RE.test(input.taskId) ? input.taskId : null,
    submission_id: input.submissionId && UUID_RE.test(input.submissionId) ? input.submissionId : null,
    field_key: config.field,
    origin: input.origin,
    actor_id: ctx.actorId,
  }).select('id').single()
  if (claimError) {
    if (claimError.code !== '23505') throw new ServiceError('internal', 'The table changes could not be started')
    const { data: prior } = await (sys as any).from('form_table_change_runs').select('status, summary, actor_id').eq('tenant_id', ctx.tenantId).eq('idempotency_key', key).maybeSingle()
    if (!prior || (prior.actor_id ?? null) !== (ctx.actorId ?? null)) throw ServiceError.conflict('That request was already used')
    if (prior.status === 'running') throw ServiceError.conflict('These table changes are already being applied')
    return { ...(prior.summary as TableChangesSummary), replayed: true }
  }

  const results: TableChangeResult[] = []
  let stopped = false
  const callerId = input.submissionId ?? input.taskId ?? input.form?.id ?? null
  for (const op of plan.ops) {
    if (stopped) { results.push({ kind: op.kind, key: op.key, action: op.action, status: 'skipped' }); continue }
    const result = await runOp(ctx, sys, config, op, callerId, { formId: input.form?.id ?? null, submissionId: input.submissionId ?? null })
    results.push(result)
    if (result.status === 'failed' && config.on_error !== 'continue') stopped = true
  }
  const summary = summarizeTableChanges(config, results, { skipped: plan.skipped, stopped })
  const status = summary.failed === 0 ? 'succeeded' : summary.succeeded > 0 ? 'partial' : 'failed'
  await (sys as any).from('form_table_change_runs').update({ status, summary, finished_at: new Date().toISOString() }).eq('id', claimed.id).eq('tenant_id', ctx.tenantId)
  if (input.form?.id && UUID_RE.test(input.form.id)) {
    void audit(ctx, {
      objectType: 'form', objectId: input.form.id, action: 'execute',
      summary: `Form "${input.form.name}" applied table changes: ${summary.text}`,
      metadata: { field: config.field, target: config.target, table_id: config.table_id ?? null, reference_id: config.reference_id ?? null, workflow_id: config.workflow_id ?? null, run_id: claimed.id, submission_id: input.submissionId ?? null, task_id: input.taskId ?? null, succeeded: summary.succeeded, failed: summary.failed, on_behalf_of: ctx.actorId },
    })
  }
  return summary
}

/* ── In-form Button: "Apply table changes" ───────────────────────────── */

export interface ApplyFromButtonInput {
  /** The Button field's key and the index of its "Apply table changes" step. */
  button_key: string
  action_index: number
  /** A step inside a question's response ("If Yes → …"): the response and the step's index there. */
  branch?: { response: string; index: number } | null
  values?: Record<string, unknown>
  /** One key per click (reused on retries): 8–100 characters. */
  idempotency_key: string
}

/**
 * An in-form Button's "Apply table changes" step: the rule is read from the
 * saved form (task / reusable form), the change set from the request is
 * validated and re-read on the server, then the rule runs (runTableChanges).
 */
export async function applyTableChangesFromButton(ctx: ServiceContext, target: { task_id: string } | { form_id: string }, input: ApplyFromButtonInput): Promise<TableChangesSummary> {
  if (typeof input.idempotency_key !== 'string' || input.idempotency_key.length < 8 || input.idempotency_key.length > 100) throw ServiceError.validation('idempotency_key must be 8-100 characters')
  const db = await serviceRoleClient(ctx)
  let fields: TaskFieldDef[]
  let stored: Record<string, unknown> = {}
  let form: { id: string | null; name: string }
  let taskId: string | null = null
  if ('task_id' in target) {
    const { loadLookupTask } = await import('./form-lookup')
    const task = await loadLookupTask(ctx, db, target.task_id)
    const meta = (task.metadata ?? {}) as Record<string, any>
    fields = normalizeTaskFields(meta.fields)
    stored = isPlainObject(meta.template_values) ? meta.template_values : {}
    const ref = isPlainObject(meta.form_ref) ? meta.form_ref : {}
    form = { id: typeof ref.form_id === 'string' ? ref.form_id : null, name: String(ref.name ?? task.title ?? 'Task form') }
    taskId = String(task.id)
  } else {
    requirePerm(ctx, 'forms.submit')
    if (!UUID_RE.test(target.form_id)) throw ServiceError.notFound('Form not found')
    const { data: row } = await (db as any).from('forms').select('id, name, fields').eq('id', target.form_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (!row) throw ServiceError.notFound('Form not found')
    fields = normalizeTaskFields(row.fields)
    form = { id: String(row.id), name: String(row.name) }
  }
  const button = fields.find((f) => f.key === input.button_key && f.type === 'button')
  const branch = input.branch && typeof input.branch.response === 'string' && Number.isInteger(input.branch.index) ? { response: input.branch.response, index: Number(input.branch.index) } : null
  const { actionAt } = await import('@/lib/forms/field-buttons')
  const action = actionAt(button?.button?.actions, Number(input.action_index), branch)
  if (!action || action.type !== 'apply_table_changes' || !action.table_changes) throw ServiceError.notFound('That button has no "Apply table changes" step')
  // Anonymous visitors: this link's form only, and only a step the author ticked "Allow for anonymous".
  if (ctx.authKind === 'anonymous') {
    if (!('form_id' in target) || target.form_id !== ctx.anonymous?.formId) throw ServiceError.notFound('Form not found')
    if (action.allow_anonymous !== true) throw ServiceError.forbidden('This step is not available on a public form')
  }
  const config = action.table_changes
  const submitted = isPlainObject(input.values) ? input.values : {}
  // Typed form values for the templates (editable fields only; read-only ones keep the stored value).
  const editable = fields.filter((f) => !f.read_only)
  const typed = { ...stored, ...coerceTaskFieldValues(editable.filter((f) => f.type !== 'data_table'), submitted) }
  const { resolveDataTableValues } = await import('./form-data-table')
  const verified = await resolveDataTableValues(ctx, ctx.tenantId, fields, { ...typed, [config.field]: submitted[config.field] }, { keys: [config.field], strict: true })
  if (Object.keys(verified.errors).length) throw ServiceError.validation(Object.values(verified.errors).join('; '), { fields: verified.errors })
  const owner = 'task_id' in target ? `task:${target.task_id}` : `form:${target.form_id}`
  const { anonymousStepContext } = await import('./form-rule-actions')
  return runTableChanges(anonymousStepContext(ctx), {
    config, fields, values: { ...typed, ...verified.values },
    idempotencyKey: `button:${owner}:${input.button_key}:${branch ? `${input.action_index}.${branch.response}.${branch.index}` : input.action_index}:${input.idempotency_key}`,
    origin: 'button', form, taskId,
  })
}

/** The designer's / test runner's dry run (pure plan; nothing is written). */
export function previewTableChanges(config: TableChangesConfig, fields: TaskFieldDef[], values: Record<string, unknown>) {
  const changes = changeSetOf(values[config.field])
  return dryRunTableChanges(normalizeTableChanges(config), changes, { values }, columnTypes(fields, config.field))
}
