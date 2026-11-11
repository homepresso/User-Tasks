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
 *  - Data table steps (table_read / list / create / update / delete,
 *    lib/forms/data-actions.ts) read and write through the data-table
 *    services with the person's own rights (data.view to read,
 *    data.manage_rows to write, a credential's table allowlist) — unless the
 *    author opened the step to everyone who fills the form in (`open_access`)
 *    or to anonymous visitors (`allow_anonymous`), when the step's own saved
 *    table, filter and columns run with the service client. Writes are
 *    audited. An update needs a row id or a filter; a delete a row id.
 *  - Results write only the saved step's `outputs` (declared fields, Lists,
 *    a choice's options, variables); the browser gets, for {{result.*}},
 *    only the result paths the step's own on-success steps read.
 *  - "Call an API reference" may run without waiting (`wait: false`): it is
 *    queued after the response (next/server `after`) and the form goes on.
 */

import { coerceTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { findServerRuleAction, resolveRuleTemplate, ruleConditionsMet, serverVerifiable } from '@/lib/forms/form-rules'
import { layoutFormVariables, serverFormContext } from '@/lib/forms/form-params'
import { mapReferenceResults } from '@/lib/forms/reference-results'
import { ruleValue } from '@/lib/forms/form-rules'
import { allActions, type FieldButtonAction } from '@/lib/forms/field-buttons'
import {
  DATA_ACTION_LIMITS, TABLE_WRITE_ACTIONS, applyLocalQuery, singleRowOnly, readActionResult, resolveActionTemplate, resolveFilter, resultProjection, setAtPath,
  type ActionScope,
} from '@/lib/forms/data-actions'
import { mapActionOutputs } from '@/lib/forms/action-outputs'
import { LIST_SELECT_KEY, listSelectionEntries } from '@/lib/forms/list-field'
import { ROW_CURRENT_KEY, rowCurrentEntries } from '@/lib/forms/row-rules'
import { DataTableQueryError, conditionTerm, isConditionGroup, type DataTableColumnType, type DataTableConditionGroup } from '@/lib/forms/data-table'
import { unwrapExecutorResult } from '@/lib/response-collections'
import { enrichEventContext, serverControlEntries } from '@/lib/forms/rule-variables'
import { isPlainObject } from '@/lib/utils/guards'
import { isAnonymous, rateSubject, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata and forms rows are free-form JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const RULE_ACTION_RATE = { max: 60, windowMs: 60_000 } as const
const REFERENCE_TIMEOUT_MS = 10_000
const REPLAY_TTL_MS = 10 * 60 * 1000
const OPTIONS_TTL_MS = 6 * 60 * 60 * 1000

function optionsKey(owner: string, field: string): string {
  return `form-rule:options:${owner}:${field}`
}

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
  /** Choice options a step loaded (field key → options). */
  options?: Record<string, Array<{ value: string; label: string }>>
  /** {{result.*}} for the step's own on-success steps: only the paths they read. */
  result?: unknown
  /** call_reference without waiting: queued, nothing written. */
  queued?: boolean
}

/** Executor seam (tests replace it). */
export const ruleActionDeps = {
  /** Run work after the response (fire and forget): next/server `after`, else right away in the background. */
  defer: async (work: () => Promise<void>) => {
    try {
      const { after } = await import('next/server')
      after(work)
    } catch {
      void work().catch(() => undefined)
    }
  },
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
  // A List's selection (UI state the browser sends): {{form.<list>_selected}}, _selected_row, _selected_count — like the event, as a click would have it.
  Object.assign(typed, listSelectionEntries(t.fields, { ...typed, [LIST_SELECT_KEY]: submitted[LIST_SELECT_KEY] }))
  // The current row of each List / editable Data table ({{form.<field>_current_row.<column>}}), from the rows as sent.
  {
    const rowScope: Record<string, unknown> = { ...typed, [ROW_CURRENT_KEY]: submitted[ROW_CURRENT_KEY] }
    for (const f of t.fields) if (f.type === 'list' || f.type === 'data_table') rowScope[f.key] = submitted[f.key]
    Object.assign(typed, rowCurrentEntries(t.fields, rowScope))
  }
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
    result = await runCallReference(ctx, t, rule, action, { values: typed, user: await actorScope(t.db, ctx), event }, editable)
  } else if ((action.type === 'commit_row' || action.type === 'delete_row') && action.commit_mode === 'save_now') {
    result = await runRowSave(ctx, t, rule, action, typed, isPlainObject(input.event) ? input.event : {})
  } else if (isTableAction(action)) {
    result = await runTableAction(ctx, t, rule, action, { values: typed, user: await actorScope(t.db, ctx), event }, editable)
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
  // Options a step loaded: remembered for this person and form (the submission is checked against them).
  if (store && result.options) {
    for (const [key, options] of Object.entries(result.options)) await store.set(optionsKey(t.owner, key), JSON.stringify(options.map((o) => o.value)), OPTIONS_TTL_MS).catch(() => undefined)
  }
  return result
}

/* ── Data and API steps (lib/forms/data-actions.ts) ──────────────────── */

type Target = Awaited<ReturnType<typeof loadTarget>>
type RuleLike = { id: string; name?: string }

async function actorScope(db: any, ctx: ServiceContext): Promise<Record<string, unknown> | null> {
  if (!ctx.actorId || isAnonymous(ctx)) return null
  const { userScope } = await import('./form-data-table')
  return (await userScope(db, ctx.actorId)) as Record<string, unknown> | null
}

/** {{form.x}}, {{row.x}}, {{result.x}}, {{param.x}} / {{var.x}}, {{user.*}}, {{event.*}}, {{today}}… on the server. */
const readPath = (path: string, scope: ActionScope) => ruleValue(path, { values: scope.values, user: scope.user ?? null, event: scope.event ?? null, now: scope.now })

/** The templates a step's own on-success / on-failure steps read (what the browser needs of the result). */
function branchTemplates(action: FieldButtonAction): string[] {
  return JSON.stringify([action.on_success ?? [], action.on_failure ?? []]).match(/\{\{[^}]*\}\}/g) ?? []
}

function isTableAction(action: FieldButtonAction): boolean {
  return action.type === 'table_read' || action.type === 'table_list' || action.type === 'table_create' || action.type === 'table_update' || action.type === 'table_delete'
}

/** What the step's result writes (saved outputs only), and the result paths its own steps read. */
function finish(action: FieldButtonAction, data: unknown, t: Target, editable: Parameters<typeof mapActionOutputs>[2], current: Record<string, unknown>, text = ''): RuleActionResult {
  const mapped = mapActionOutputs(data, action.outputs, editable.concat(t.fields.filter((f) => f.read_only || f.type === 'label')), layoutFormVariables(t.layout), current)
  const legacy = action.type === 'call_reference' && action.results ? mapReferenceResults(data, action.results, editable, layoutFormVariables(t.layout)) : { values: {}, vars: {} }
  const values = { ...legacy.values, ...mapped.values }
  const vars = { ...legacy.vars, ...mapped.vars }
  return {
    values, text,
    ...(Object.keys(vars).length ? { vars } : {}),
    ...(Object.keys(mapped.options).length ? { options: mapped.options } : {}),
    result: resultProjection(data, branchTemplates(action)),
  }
}

async function runCallReference(ctx: ServiceContext, t: Target, rule: RuleLike, action: FieldButtonAction, scope: ActionScope, editable: Parameters<typeof mapActionOutputs>[2]): Promise<RuleActionResult> {
  const inputs: Record<string, string> = {}
  for (const [name, template] of Object.entries(action.inputs ?? {})) {
    const v = resolveActionTemplate(template, scope, readPath)
    inputs[name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  const call = async () => {
    const { newTraceId } = await import('@/lib/trace')
    return ruleActionDeps.executeReference({
      supabase: t.db as any, referenceId: action.reference_id!, inputValues: inputs, timeout: action.timeout_ms ?? REFERENCE_TIMEOUT_MS, expectedTenantId: ctx.tenantId,
      caller: { traceId: newTraceId(), callerType: 'form_submit', callerId: t.taskId ?? t.form.id },
    })
  }
  // Fire and forget: queued after the response; nothing is written back.
  if (action.wait === false) {
    await ruleActionDeps.defer(async () => {
      try {
        const response = await call()
        if ((response.status ?? 200) >= 400) console.warn('[forms.ruleAction] queued reference call answered', response.status)
      } catch (error: any) {
        console.warn('[forms.ruleAction] queued reference call failed:', String(error?.message ?? '').slice(0, 300))
      }
    })
    void audit(ctx, { objectType: 'form', objectId: t.form.id ?? t.taskId ?? 'form', action: 'execute', summary: `Form rule "${rule.name ?? rule.id}" queued an API call`, metadata: { reference_id: action.reference_id, rule_id: rule.id, task_id: t.taskId } })
    return { text: 'Sent', queued: true, values: {} }
  }
  let body: unknown
  try {
    const response = await call()
    if ((response.status ?? 200) >= 400) throw Object.assign(new Error(`status ${response.status}`), { status: response.status })
    body = unwrapExecutorResult(response.data)
  } catch (error: any) {
    const message = String(error?.message ?? '')
    if (error?.status === 404) throw ServiceError.notFound('The service found nothing for these values')
    if (/reference not found/i.test(message)) throw ServiceError.notFound("The rule's API reference no longer exists")
    if (/abort|timed? ?out/i.test(message)) throw new ServiceError('internal', 'The service took too long — try again', { status: 504 })
    console.warn('[forms.ruleAction] reference call failed:', message.slice(0, 300))
    throw new ServiceError('internal', 'The service is not available right now', { status: 502 })
  }
  // An optional filter / sort / limit on the rows at rows_path (applied here, like a Data table field's API rows).
  if (action.filter || action.sort || action.limit !== undefined) {
    const path = action.rows_path ?? ''
    const rows = readActionResult(body, path)
    if (Array.isArray(rows)) {
      const filtered = applyLocalQuery(rows, { filter: resolveFilter(action.filter, scope, readPath), sort: action.sort, limit: action.limit })
      if (!path) body = filtered
      else { const copy = JSON.parse(JSON.stringify(body)) as Record<string, unknown>; setAtPath(copy, path, filtered); body = copy }
    }
  }
  return finish(action, body, t, editable, scope.values)
}

/** The context a table step reads / writes with: the person's own rights, or (opened by the author) the service client for this step. */
async function tableContext(ctx: ServiceContext, action: FieldButtonAction, write: boolean): Promise<ServiceContext> {
  const opened = action.open_access === true || (isAnonymous(ctx) && action.allow_anonymous === true)
  if (opened) {
    const db = await serviceRoleClient(ctx)
    return { ...ctx, db, supabase: db, permissions: new Set([...(ctx.permissions ?? []), 'data.view', 'data.manage_rows']) } as ServiceContext
  }
  requirePerm(ctx, write ? 'data.manage_rows' : 'data.view')
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (action.table_id && allow.length && !allow.includes(action.table_id)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
  return ctx
}

/** A resolved filter as one PostgREST logic tree (a value that doesn't fit its column matches nothing). */
function filterTree(group: DataTableConditionGroup, types: Record<string, DataTableColumnType>): string | null {
  const parts: string[] = []
  for (const c of group.conditions) {
    if (isConditionGroup(c)) { const inner = filterTree(c, types); if (inner) parts.push(inner); continue }
    try {
      parts.push(conditionTerm(c.column, c.column === 'row_id' ? 'text' : types[c.column] ?? 'text', c.operator, c.value ?? ''))
    } catch (error) {
      if (!(error instanceof DataTableQueryError)) throw error
      parts.push('id.is.null')
    }
  }
  return parts.length ? `${group.match === 'any' ? 'or' : 'and'}(${parts.join(',')})` : null
}

async function queryTableRows(db: any, tenantId: string, action: FieldButtonAction, scope: ActionScope, limit: number, offset = 0): Promise<Array<Record<string, unknown>>> {
  const { tableColumnTypes, friendlyDbError } = await import('./form-data-table')
  const types = await tableColumnTypes(db, tenantId, action.table_id!)
  let q = db.from('custom_table_rows').select('id, data').eq('tenant_id', tenantId).eq('table_id', action.table_id)
  const rowId = action.row_id ? String(resolveActionTemplate(action.row_id, scope, readPath) ?? '').trim() : ''
  if (action.row_id) {
    if (!UUID_RE.test(rowId)) return []
    q = q.eq('id', rowId)
  }
  const filter = resolveFilter(action.filter, scope, readPath)
  const where = filter ? filterTree(filter, types) : null
  if (where) q = q.or(where)
  for (const s of action.sort ?? []) q = q.order(s.column === 'row_id' ? 'id' : `data->${s.column}`, { ascending: s.direction !== 'desc', nullsFirst: false })
  q = q.order('created_at', { ascending: true }).range(offset, offset + limit - 1)
  const { data, error } = await q
  if (error) throw friendlyDbError(error)
  return ((data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>).map((r) => ({ ...(isPlainObject(r.data) ? r.data : {}), row_id: r.id }))
}

async function runTableAction(ctx: ServiceContext, t: Target, rule: RuleLike, action: FieldButtonAction, scope: ActionScope, editable: Parameters<typeof mapActionOutputs>[2]): Promise<RuleActionResult> {
  if (!action.table_id) throw ServiceError.validation('The rule step has no data table')
  const write = TABLE_WRITE_ACTIONS.has(action.type)
  const access = await tableContext(ctx, action, write)
  const db = access.supabase as any
  const cells = () => {
    const out: Record<string, unknown> = {}
    for (const [column, template] of Object.entries(action.column_values ?? {})) out[column] = resolveActionTemplate(template, scope, readPath)
    return out
  }
  const auditWrite = (verb: string, ids: string[]) => void audit(ctx, {
    objectType: 'data_table', objectId: action.table_id!, action: verb,
    summary: `Form rule "${rule.name ?? rule.id}" ${verb === 'create' ? 'added a row to' : verb === 'delete' ? 'deleted a row of' : 'updated rows of'} "${action.table_name ?? action.table_id}"`,
    metadata: { rule_id: rule.id, form_id: t.form.id, task_id: t.taskId, row_ids: ids.slice(0, 50), on_behalf_of: ctx.actorId, anonymous: isAnonymous(ctx) || undefined },
  })
  const { getDataTable, upsertRows, updateRow, deleteRow } = await import('./data-tables')
  switch (action.type) {
    case 'table_read': {
      if (!action.row_id && !action.filter) throw ServiceError.validation('Read a table row: give a row id or a filter')
      const rows = await queryTableRows(db, ctx.tenantId, action, scope, 1)
      return finish(action, rows[0] ?? null, t, editable, scope.values, rows[0] ? '' : '')
    }
    case 'table_list': {
      // Every output takes one value: fetch only the first row (TOP 1, after the filter and sort).
      const top = singleRowOnly(action, (key) => t.fields.find((f) => f.key === key)?.type)
      const rows = await queryTableRows(db, ctx.tenantId, action, scope, top ? 1 : action.limit ?? 50, action.offset ?? 0)
      return finish(action, rows, t, editable, scope.values)
    }
    case 'table_create': {
      await getDataTable(access, action.table_id)
      const [created] = await upsertRows(access, action.table_id, [{ data: cells() }])
      auditWrite('create', [created.row_id])
      const row = { ...(isPlainObject(created.row?.data) ? created.row.data : {}), row_id: created.row_id }
      return finish(action, { row_id: created.row_id, row }, t, editable, scope.values)
    }
    case 'table_update': {
      if (!action.row_id && !action.filter) throw ServiceError.validation('Update table rows: give a row id or a filter (a step never updates a whole table)')
      const rows = await queryTableRows(db, ctx.tenantId, action, scope, DATA_ACTION_LIMITS.updateRows)
      const values = cells()
      const ids: string[] = []
      for (const r of rows) { await updateRow(access, action.table_id, String(r.row_id), values); ids.push(String(r.row_id)) }
      if (ids.length) auditWrite('update', ids)
      return finish(action, { count: ids.length, row_ids: ids }, t, editable, scope.values)
    }
    case 'table_delete': {
      const rowId = String(resolveActionTemplate(action.row_id ?? '', scope, readPath) ?? '').trim()
      if (!UUID_RE.test(rowId)) throw ServiceError.validation('Delete a table row: the row id is missing')
      await deleteRow(access, action.table_id, rowId)
      auditWrite('delete', [rowId])
      return finish(action, { count: 1, row_ids: [rowId] }, t, editable, scope.values)
    }
    default:
      throw ServiceError.validation('The rule action is not configured')
  }
}

/* ── Editable table rules: a Data table row's "Save now" (lib/forms/row-rules.ts) ── */

/**
 * Commit / delete one row of the form's editable Data table now. The step
 * (rule id + index) and the field — its table, columns, read-only columns,
 * allow add / delete, base filter — come from the SAVED form; the browser
 * sends only the row (`event.commit`: { added } | { updated: { key, after } }
 * | { deleted: { key } }). The row is checked like a submitted change set
 * (validateChangeSet: types, required, read-only columns stripped or the
 * change refused), an existing row must be one this person can see, then it
 * is written with their data.manage_rows (or, opened by the author, for
 * everyone filling the form in) and audited. {{result.id}} = the row's id.
 */
async function runRowSave(ctx: ServiceContext, t: Target, rule: RuleLike, action: FieldButtonAction, values: Record<string, unknown>, event: Record<string, unknown>): Promise<RuleActionResult> {
  const field = t.fields.find((f) => f.key === action.field && f.type === 'data_table')
  const config = field?.data_table
  if (!field || !config || config.mode !== 'edit' || config.source !== 'table' || !config.table_id) throw ServiceError.validation('"Save now" needs an editable Data table on a data table')
  if (field.read_only) throw ServiceError.forbidden(`${field.label} is read only`)
  const commit = isPlainObject(event.commit) ? event.commit : {}
  const one = { ...config, on_submit_pending: 'commit' as const }
  let raw: Record<string, unknown>
  if (action.type === 'delete_row') {
    const key = isPlainObject(commit.deleted) ? commit.deleted.key : undefined
    if (typeof key !== 'string' && typeof key !== 'number') throw ServiceError.validation('Delete row: which row?')
    raw = { deleted: [{ key: String(key) }] }
  } else if (isPlainObject(commit.added)) {
    raw = { added: [commit.added] }
  } else if (isPlainObject(commit.updated) && (typeof commit.updated.key === 'string' || typeof commit.updated.key === 'number')) {
    raw = { updated: [{ key: String(commit.updated.key), before: {}, after: isPlainObject(commit.updated.after) ? commit.updated.after : {} }] }
  } else {
    throw ServiceError.validation('Commit row: nothing to save')
  }
  const { validateChangeSet, dataTableKeyColumn } = await import('@/lib/forms/data-table')
  const checked = validateChangeSet(one, raw)
  if (checked.warnings.length) console.warn(`[forms.ruleAction] save now ${field.key}: ${checked.warnings.slice(0, 5).join('; ')}`)
  if (checked.errors.length) throw ServiceError.validation(`${field.label}: ${checked.errors.slice(0, 3).join('; ')}`)
  let changes = checked.changes
  // An existing row: one this person can see (the field's base filter, their access); before / changed fields from the source.
  if (changes.updated.length || changes.deleted.length) {
    const { resolveDataTableValues } = await import('./form-data-table')
    const verified = await resolveDataTableValues(ctx, ctx.tenantId, [{ ...field, data_table: one }], { ...values, [field.key]: changes }, { keys: [field.key], strict: true })
    if (Object.keys(verified.errors).length) throw ServiceError.validation(Object.values(verified.errors).join('; '))
    changes = verified.values[field.key] as typeof changes
  }
  const access = await tableContext(ctx, { ...action, table_id: config.table_id }, true)
  const { getDataTable, upsertRows, updateRow, deleteRow } = await import('./data-tables')
  await getDataTable(access, config.table_id)
  const keyColumn = dataTableKeyColumn(config)
  const rowIdOf = async (key: string): Promise<string> => {
    if (keyColumn === 'row_id') { if (!UUID_RE.test(key)) throw ServiceError.validation('That row is not in the table'); return key }
    const { data } = await (t.db as any).from('custom_table_rows').select('id').eq('tenant_id', ctx.tenantId).eq('table_id', config.table_id).eq(`data->>${keyColumn}`, key).limit(2)
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => String(r.id))
    if (ids.length !== 1) throw ServiceError.validation(ids.length ? `More than one row has ${keyColumn} "${key.slice(0, 60)}"` : 'That row is not in the table')
    return ids[0]
  }
  const name = field.label || field.key
  const auditWrite = (verb: string, id: string) => void audit(ctx, {
    objectType: 'data_table', objectId: config.table_id!, action: verb,
    summary: `Form rule "${rule.name ?? rule.id}" ${verb === 'create' ? 'added a row to' : verb === 'delete' ? 'deleted a row of' : 'updated a row of'} "${name}" (save now)`,
    metadata: { rule_id: rule.id, form_id: t.form.id, task_id: t.taskId, row_ids: [id], field: field.key, on_behalf_of: ctx.actorId, anonymous: isAnonymous(ctx) || undefined },
  })
  if (changes.added.length) {
    const [created] = await upsertRows(access, config.table_id, [{ data: changes.added[0] }])
    auditWrite('create', created.row_id)
    const row = { ...(isPlainObject(created.row?.data) ? created.row.data : changes.added[0]), row_id: created.row_id }
    return { text: `Saved to ${name}`, result: { id: created.row_id, row_id: created.row_id, row } }
  }
  if (changes.updated.length) {
    const u = changes.updated[0]
    const id = await rowIdOf(u.key)
    await updateRow(access, config.table_id, id, u.after)
    auditWrite('update', id)
    return { text: `Saved ${name}`, result: { id: u.key, row_id: id, row: { ...u.before, ...u.after } } }
  }
  if (changes.deleted.length) {
    const d = changes.deleted[0]
    const id = await rowIdOf(d.key)
    await deleteRow(access, config.table_id, id)
    auditWrite('delete', id)
    return { text: `Deleted from ${name}`, result: { id: d.key, row_id: id, count: 1 } }
  }
  // Nothing changed on an existing row (the server's own values match): already saved.
  return { text: '', result: { id: isPlainObject(commit.updated) ? String(commit.updated.key) : null } }
}

/** Every data table a form's rules read or write through table steps (form save checks). */
export function ruleTableTargets(layout: unknown, rules: Array<{ then: FieldButtonAction[] }>): { reads: string[]; writes: string[] } {
  void layout
  const reads = new Set<string>()
  const writes = new Set<string>()
  for (const r of rules) for (const a of allActions(r.then)) {
    if (!a.table_id || !isTableAction(a)) continue
    if (TABLE_WRITE_ACTIONS.has(a.type)) writes.add(a.table_id)
    else reads.add(a.table_id)
  }
  return { reads: [...reads], writes: [...writes] }
}

/* ── The designer's Test (a step not saved yet) ──────────────────────── */

export interface RuleActionTestResult {
  /** The step's result (bounded, as its outputs would read it). */
  result: unknown
  /** Paths the outputs may read, with types and examples (click to map). */
  paths: Array<{ path: string; type: string; example?: unknown; level: number }>
  /** What the outputs would write, for these sample values (field / variable → value; options per field). */
  preview: { values: Record<string, unknown>; vars: Record<string, unknown>; options: Record<string, unknown> }
  /** "3 rows returned: only the first is used for single-value outputs" (null when one row or none). */
  notice: string | null
}

/**
 * Run a table read / list or a (read-only) API call as the designer has it,
 * with sample values — the author's own rights (forms.edit plus data.view /
 * integrations.test); nothing is written. `fields` / `layout`: the form
 * being designed (for the output preview).
 */
export async function testRuleAction(ctx: ServiceContext, input: { action: unknown; values?: Record<string, unknown> | null; fields?: unknown; layout?: unknown }): Promise<RuleActionTestResult> {
  requirePerm(ctx, 'forms.edit')
  const { normalizeFieldButtonAction } = await import('@/lib/forms/field-buttons')
  const action = normalizeFieldButtonAction(input.action, { rule: true })
  if (!action || (action.type !== 'table_read' && action.type !== 'table_list' && action.type !== 'call_reference')) throw ServiceError.validation('Test runs a "Read a table row", "List table rows" or "Call an API reference" step')
  const fields = normalizeTaskFields(input.fields)
  const values = isPlainObject(input.values) ? input.values : {}
  const scope: ActionScope = { values, user: await actorScope(ctx.supabase, ctx), event: { row: isPlainObject(values.row) ? values.row : {} } }
  let result: unknown
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`form-rule-test:${ctx.tenantId}:${rateSubject(ctx)}`, RULE_ACTION_RATE)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many tests — wait a moment and try again')
  if (action.type === 'call_reference') {
    requirePerm(ctx, 'integrations.test')
    if (!action.reference_id) throw ServiceError.validation('Choose the API reference first')
    const db = await serviceRoleClient(ctx)
    const { data: ref } = await (db as any).from('integration_references').select('id, method, request_config').eq('tenant_id', ctx.tenantId).eq('id', action.reference_id).maybeSingle()
    if (!ref) throw ServiceError.notFound('API reference not found')
    const { isWriteReference } = await import('@/lib/custom-references/types')
    if (isWriteReference(ref)) throw ServiceError.validation('This reference writes data: test it from Integrations (a test here would run it for real)')
    const inputs: Record<string, string> = {}
    for (const [name, template] of Object.entries(action.inputs ?? {})) { const v = resolveActionTemplate(template, scope, readPath); inputs[name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v) }
    const { newTraceId } = await import('@/lib/trace')
    const response = await ruleActionDeps.executeReference({ supabase: db as any, referenceId: action.reference_id, inputValues: inputs, timeout: action.timeout_ms ?? REFERENCE_TIMEOUT_MS, expectedTenantId: ctx.tenantId, caller: { traceId: newTraceId(), callerType: 'form_submit', callerId: 'designer-test' } })
    if ((response.status ?? 200) >= 400) throw new ServiceError('internal', `The service answered ${response.status}`, { status: 502 })
    result = unwrapExecutorResult(response.data)
    if (action.filter || action.sort || action.limit !== undefined) {
      const path = action.rows_path ?? ''
      const rows = readActionResult(result, path)
      if (Array.isArray(rows)) {
        const filtered = applyLocalQuery(rows, { filter: resolveFilter(action.filter, scope, readPath), sort: action.sort, limit: action.limit })
        if (!path) result = filtered
        else { const copy = JSON.parse(JSON.stringify(result)) as Record<string, unknown>; setAtPath(copy, path, filtered); result = copy }
      }
    }
  } else {
    if (!action.table_id) throw ServiceError.validation('Choose the data table first')
    const access = await tableContext(ctx, { ...action, open_access: false }, false)
    const rows = await queryTableRows(access.supabase as any, ctx.tenantId, action, scope, action.type === 'table_read' ? 1 : Math.min(action.limit ?? 50, 50), action.offset ?? 0)
    result = action.type === 'table_read' ? rows[0] ?? null : rows
  }
  const { inferSchema, trimSample } = await import('@/lib/response-schema')
  const { resultPathOptions } = await import('@/lib/forms/reference-results')
  const sample = trimSample(result)
  const editable = fields.filter((f) => !['button', 'heading', 'divider'].includes(f.type))
  const mapped = mapActionOutputs(result, action.outputs, editable, layoutFormVariables(input.layout), values)
  return {
    result: sample,
    paths: resultPathOptions(inferSchema(result), { max: 200 }).map((o) => ({ path: o.path, type: o.type, level: o.level, ...(o.example !== undefined ? { example: o.example } : {}) })),
    preview: { values: mapped.values, vars: mapped.vars, options: mapped.options },
    notice: Array.isArray(result) && result.length > 1 ? `${result.length} rows returned: only the first is used for single-value outputs` : null,
  }
}

/* ── Options a rule loaded: checked on submit ────────────────────────── */

/**
 * A choice whose options a rule loads from a table / API: the submitted
 * value must be one the person was offered. The options a step served are
 * remembered per person and form (6 h); when they're gone (another server,
 * an expired cache) the saved step runs again for the submitted values —
 * once per field per submission. Returns field key → error.
 */
export async function verifyRuleOptions(ctx: ServiceContext, target: { task_id: string } | { form_id: string }, values: Record<string, unknown>, keys?: string[] | null): Promise<Record<string, string>> {
  const t = await loadTarget(ctx, target)
  const { layoutFormRules } = await import('@/lib/forms/form-rules')
  const rules = layoutFormRules(t.layout).filter((r) => !r.disabled)
  const errors: Record<string, string> = {}
  const store = await (await import('@/lib/providers/cache')).getCacheStore().catch(() => null)
  for (const field of t.fields) {
    if (field.type !== 'choice' && field.type !== 'multi_choice') continue
    if (keys && !keys.includes(field.key)) continue
    const chosen = (Array.isArray(values[field.key]) ? values[field.key] as unknown[] : [values[field.key]]).filter((v) => v !== null && v !== undefined && v !== '').map(String)
    if (!chosen.length) continue
    const loaders = rules.flatMap((r) => allActions(r.then).filter((a) => (a.outputs ?? []).some((o) => o.as === 'options' && o.to === field.key)).map((a) => ({ rule: r, action: a })))
    if (!loaders.length) continue
    let offered: string[] | null = null
    const cached = store ? await store.get(optionsKey(t.owner, field.key)).catch(() => null) : null
    if (cached) { try { offered = JSON.parse(cached) as string[] } catch { offered = null } }
    if (!offered) {
      // Not remembered: the saved step again, for the submitted values (no event context).
      offered = []
      const editable = t.fields.filter((f) => !f.read_only && f.type !== 'button' && f.type !== 'heading' && f.type !== 'divider')
      for (const { rule, action } of loaders) {
        try {
          const scope: ActionScope = { values: { ...t.stored, ...values }, user: await actorScope(t.db, ctx), event: {} }
          const out = action.type === 'call_reference' ? await runCallReference(ctx, t, rule, { ...action, on_success: undefined }, scope, editable) : await runTableAction(ctx, t, rule, action, scope, editable)
          offered.push(...(out.options?.[field.key] ?? []).map((o) => o.value))
        } catch { /* a source that fails offers nothing */ }
      }
    }
    const bad = chosen.find((v) => !offered!.includes(v))
    if (bad) errors[field.key] = `${field.label}: "${bad.slice(0, 80)}" is not one of the options — choose again`
  }
  return errors
}
