/**
 * Form rules' server actions (lib/forms/form-rules.ts): "Call an API
 * reference", "Start a workflow" and "Apply table changes" of a rule, run
 * for the person filling in a task's form or a reusable form's page.
 *
 * Security model (the in-form Button / Data table model):
 *  - The action is looked up by rule id + action index (and, for a step in a
 *    question's response, the response + its index) in the SAVED form
 *    (task metadata `form_layout`, the form's latest `layout`) — never taken
 *    from the request. The request carries the form's values and the event
 *    context, nothing else.
 *  - Authorised like the form's lookups: a task's form → tasks.complete and
 *    able to act on that open task (lib/services/form-lookup loadLookupTask);
 *    a form page → forms.submit.
 *  - When the rule's condition can be judged from the values (no event /
 *    user context) it must hold for the submitted values, else the call is
 *    refused — a forged event cannot reach the action.
 *  - Values are typed against the form's fields (read-only fields keep their
 *    stored values); a reference's response writes only to declared, editable
 *    fields of the form; a started workflow runs as the form's system action
 *    attributed to the person (like a bar button's Start workflow, which its
 *    author needed workflows.activate to add — lib/services/forms checks rules
 *    the same way at save).
 *  - Rate limited per person; a repeated idempotency key replays the result.
 */

import { coerceTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { findServerRuleAction, resolveRuleTemplate, ruleConditionsMet, serverVerifiable } from '@/lib/forms/form-rules'
import { layoutFormVariables, serverFormContext } from '@/lib/forms/form-params'
import { mapReferenceResults } from '@/lib/forms/reference-results'
import { enrichEventContext, serverControlEntries } from '@/lib/forms/rule-variables'
import { isPlainObject } from '@/lib/utils/guards'
import { isAnonymous, rateSubject, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata and forms rows are free-form JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const RULE_ACTION_RATE = { max: 60, windowMs: 60_000 } as const
const REFERENCE_TIMEOUT_MS = 10_000
const REPLAY_TTL_MS = 10 * 60 * 1000

export interface RuleActionInput {
  rule_id: string
  action_index: number
  /** A step inside a question's response ("If Yes → …"): the response and the step's index there. */
  branch?: { response: string; index: number } | null
  values?: Record<string, unknown> | null
  event?: Record<string, unknown> | null
  idempotency_key: string
  /** The form's parameters by name ({{param.<name>}}; a task form's come from the task, never from here). */
  params?: Record<string, unknown> | null
  /** The form's variables by name ({{var.<name>}}). */
  variables?: Record<string, unknown> | null
}

export interface RuleActionResult {
  /** A message for the person (summary, "Workflow started"). */
  text?: string
  /** Field values to set (declared, editable fields only). */
  values?: Record<string, unknown>
  /** Form variables to set (declared variables only, typed): API results mapped to `var.<name>`. */
  vars?: Record<string, unknown>
  /** apply_table_changes: rows that failed. */
  failed?: number
  replayed?: boolean
}

/** Executor seam (tests replace it). */
export const ruleActionDeps = {
  executeReference: async (opts: Parameters<typeof import('@/lib/reference-executor').executeReference>[0]) => (await import('@/lib/reference-executor')).executeReference(opts),
}

async function loadTarget(ctx: ServiceContext, target: { task_id: string } | { form_id: string }) {
  const db = await serviceRoleClient(ctx)
  if ('task_id' in target) {
    const { loadLookupTask } = await import('./form-lookup')
    const task = await loadLookupTask(ctx, db, target.task_id)
    const meta = (task.metadata ?? {}) as Record<string, any>
    const ref = isPlainObject(meta.form_ref) ? meta.form_ref : {}
    return {
      db, fields: normalizeTaskFields(meta.fields), layout: meta.form_layout as unknown,
      stored: isPlainObject(meta.template_values) ? meta.template_values as Record<string, unknown> : {},
      form: { id: typeof ref.form_id === 'string' ? ref.form_id as string : null, name: String(ref.name ?? task.title ?? 'Task form') },
      taskId: String(task.id), owner: `task:${task.id}`,
      storedParams: isPlainObject(meta.form_params) ? meta.form_params as Record<string, unknown> : {},
    }
  }
  requirePerm(ctx, 'forms.submit')
  if (!UUID_RE.test(target.form_id)) throw ServiceError.notFound('Form not found')
  const { data: row } = await (db as any).from('forms').select('id, name, fields, layout').eq('id', target.form_id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!row) throw ServiceError.notFound('Form not found')
  return { db, fields: normalizeTaskFields(row.fields), layout: row.layout as unknown, stored: {}, form: { id: String(row.id), name: String(row.name) }, taskId: null, owner: `form:${row.id}:${ctx.actorId ?? (ctx.anonymous ? `anon-${ctx.anonymous.ipHash}` : 'tenant')}`, storedParams: null }
}

/**
 * An anonymous visitor's context for a step the author allowed for anonymous visitors: the same
 * context plus data.manage_rows, so the step's own declared table writes can run (the step, its
 * targets and mappings come from the saved form; nothing else gains the permission).
 */
export function anonymousStepContext(ctx: ServiceContext): ServiceContext {
  if (!isAnonymous(ctx)) return ctx
  return { ...ctx, permissions: new Set([...(ctx.permissions ?? []), 'data.manage_rows']) }
}

function systemContext(ctx: ServiceContext, db: any): ServiceContext {
  return { db, supabase: db, tenantId: ctx.tenantId, actorId: ctx.actorId, permissions: null, authKind: 'job', source: 'job' }
}

export async function runRuleAction(ctx: ServiceContext, target: { task_id: string } | { form_id: string }, input: RuleActionInput): Promise<RuleActionResult> {
  if (typeof input.idempotency_key !== 'string' || input.idempotency_key.length < 8 || input.idempotency_key.length > 100) throw ServiceError.validation('idempotency_key must be 8-100 characters')
  const t = await loadTarget(ctx, target)
  const branch = input.branch && typeof input.branch.response === 'string' && Number.isInteger(input.branch.index) ? { response: input.branch.response, index: Number(input.branch.index) } : null
  // Declared steps only: a forged response / index that the saved question does not have reaches nothing.
  const found = findServerRuleAction(t.layout, String(input.rule_id), Number(input.action_index), branch)
  if (!found) throw ServiceError.notFound('That rule has no server action at that position')
  const { rule, action } = found
  // Anonymous visitors: this link's form only, and only steps the author ticked "Allow for anonymous".
  if (isAnonymous(ctx)) {
    if (!('form_id' in target) || target.form_id !== ctx.anonymous.formId) throw ServiceError.notFound('Form not found')
    if (action.allow_anonymous !== true) throw ServiceError.forbidden('This step is not available on a public form')
  }

  // Typed values: editable fields as submitted, read-only ones as stored.
  const submitted = isPlainObject(input.values) ? input.values : {}
  const editable = t.fields.filter((f) => !f.read_only && f.type !== 'button' && f.type !== 'heading' && f.type !== 'divider')
  const typed: Record<string, unknown> = { ...t.stored, ...coerceTaskFieldValues(editable.filter((f) => f.type !== 'data_table'), submitted) }
  for (const key of Object.keys(submitted)) if (/_label$|_item$/.test(key) && !(key in typed)) typed[key] = submitted[key]
  // {{param.x}} / {{var.x}}: re-validated against the saved declarations; a task's parameters come from the task.
  const context = serverFormContext(t.layout, { values: submitted, params: input.params, variables: input.variables }, { storedParams: t.storedParams })
  Object.assign(typed, context.entries, serverControlEntries(t.layout, t.fields, submitted))
  // The same event names the browser's rules read (row_id, previous_value, item.<field>, from / to).
  const event = enrichEventContext(rule.event, isPlainObject(input.event) ? input.event : {})
  // A forged event cannot reach the action: a condition the server can judge must hold.
  if (serverVerifiable(rule)) {
    const scopeEvent = rule.target && (rule.event === 'value_change' || rule.event === 'blur') ? { field: rule.target, value: typed[rule.target] } : {}
    if (!ruleConditionsMet(rule.if, { values: typed, event: scopeEvent })) throw ServiceError.forbidden("The rule's conditions do not hold for these values")
  }

  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`form-rule:${ctx.tenantId}:${rateSubject(ctx)}`, RULE_ACTION_RATE)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many requests — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })

  const at = branch ? `${input.action_index}.${branch.response}.${branch.index}` : String(input.action_index)
  const replayKey = `form-rule:done:${t.owner}:${rule.id}:${at}:${input.idempotency_key}`
  const store = await (await import('@/lib/providers/cache')).getCacheStore().catch(() => null)
  const previous = store ? await store.get(replayKey).catch(() => null) : null
  if (previous) {
    try { return { ...(JSON.parse(previous) as RuleActionResult), replayed: true } } catch { /* run again */ }
  }

  const scope = { values: typed, event }
  let result: RuleActionResult
  if (action.type === 'apply_table_changes' && action.table_changes) {
    const config = action.table_changes
    const { resolveDataTableValues } = await import('./form-data-table')
    const verified = await resolveDataTableValues(ctx, ctx.tenantId, t.fields, { ...typed, [config.field]: submitted[config.field] }, { keys: [config.field], strict: true })
    if (Object.keys(verified.errors).length) throw ServiceError.validation(Object.values(verified.errors).join('; '), { fields: verified.errors })
    const { runTableChanges } = await import('./form-table-changes')
    const summary = await runTableChanges(anonymousStepContext(ctx), {
      config, fields: t.fields, values: { ...typed, ...verified.values },
      idempotencyKey: `rule:${t.owner}:${rule.id}:${at}:${input.idempotency_key}`,
      origin: 'button', form: t.form, taskId: t.taskId,
    })
    result = { text: summary.text, failed: summary.failed }
  } else if (action.type === 'call_reference' && action.reference_id) {
    const inputs: Record<string, string> = {}
    for (const [name, template] of Object.entries(action.inputs ?? {})) {
      const v = resolveRuleTemplate(template, scope)
      inputs[name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
    let data: unknown
    try {
      const { newTraceId } = await import('@/lib/trace')
      const response = await ruleActionDeps.executeReference({
        supabase: t.db as any, referenceId: action.reference_id, inputValues: inputs, timeout: REFERENCE_TIMEOUT_MS, expectedTenantId: ctx.tenantId,
        caller: { traceId: newTraceId(), callerType: 'form_submit', callerId: t.taskId ?? t.form.id },
      })
      if ((response.status ?? 200) >= 400) throw Object.assign(new Error(`status ${response.status}`), { status: response.status })
      data = response.data
    } catch (error: any) {
      const message = String(error?.message ?? '')
      if (error?.status === 404) throw ServiceError.notFound('The service found nothing for these values')
      if (/reference not found/i.test(message)) throw ServiceError.notFound("The rule's API reference no longer exists")
      console.warn('[forms.ruleAction] reference call failed:', message.slice(0, 300))
      throw new ServiceError('internal', 'The service is not available right now', { status: 502 })
    }
    // The saved rule's mapping, on the server: declared, editable fields (typed) and declared variables only.
    const { values, vars } = mapReferenceResults(data, action.results, editable, layoutFormVariables(t.layout))
    result = { values, text: '', ...(Object.keys(vars).length ? { vars } : {}) }
  } else if (action.type === 'start_workflow' && action.workflow_id) {
    const variables: Record<string, unknown> = {}
    for (const [name, template] of Object.entries(action.inputs ?? {})) variables[name] = resolveRuleTemplate(template, scope)
    const { startWorkflow } = await import('./workflow-start')
    const started = await startWorkflow(systemContext(ctx, t.db), {
      workflow_id: action.workflow_id,
      variables: { ...variables, form_id: t.form.id, task_id: t.taskId, form_rule_id: rule.id },
      async: true,
    }, { via: isAnonymous(ctx) ? 'anonymous' : 'form' })
    void audit(ctx, {
      objectType: 'form', objectId: t.form.id ?? t.taskId ?? 'form', action: 'execute',
      summary: `Form rule "${rule.name ?? rule.id}" started workflow "${action.workflow_name ?? action.workflow_id}"`,
      metadata: { workflow_id: action.workflow_id, rule_id: rule.id, task_id: t.taskId, job_id: started.mode === 'async' ? started.job_id : null, on_behalf_of: ctx.actorId },
    })
    result = { text: `Started ${action.workflow_name ?? 'the workflow'}${started.mode === 'async' ? ` (${started.job_id.slice(0, 8)})` : ''}` }
  } else {
    throw ServiceError.validation('The rule action is not configured')
  }
  if (store) await store.set(replayKey, JSON.stringify(result), REPLAY_TTL_MS).catch(() => undefined)
  return result
}
