/**
 * App rules' server actions (lib/apps/rules.ts): "Call an API reference",
 * "Look up / create / update data table rows" and "Start a workflow" — one
 * audited, rate-limited endpoint (POST /api/v1/apps/{id}/actions, the MCP
 * apps_run_rule_action tool, the CLI `apps actions run`).
 *
 * Security model:
 *  - The action is read from the SAVED app by rule id and action path
 *    (page rules: the page's saved layout; app rules: the app's settings) —
 *    never from the request. Object ids (the reference, table, workflow)
 *    come only from that saved config.
 *  - The request carries only the values of the action's declared template
 *    slots (a slot holding a fixed value uses the saved value) (serverSlots: reference inputs, column values, a row id, filter
 *    values, workflow inputs), each text and capped; anything else is
 *    ignored. Like a button press, a person could have produced the event,
 *    so conditions are not re-judged — every action is governed by the
 *    viewer's own rights instead:
 *  - Governance is re-checked per action, exactly as the page is presented:
 *    the viewer must be able to open the app (and the page); viewers
 *    (read-only app role) never run writes or workflow starts; data table
 *    steps run with the viewer's permissions and RLS (data.view to read,
 *    data.manage_rows to write, a credential's table allowlist); a workflow
 *    starts as the viewer (workflows.activate, View workflows). An API
 *    reference runs with the WORKSPACE connection, so — as for Card view
 *    API sources — it needs View integrations, or a designer with Manage
 *    references must have turned on "Allow app viewers" (audited at save);
 *    only read-only references; only declared inputs reach the request.
 *  - Rate limited per person (APP_ACTION_RATE); a repeated idempotency key
 *    replays the result; every run is audited (app, rule, action, object).
 */

import { actionAt, isServerAction, serverSlots, type AppRule, type RuleAction } from '@/lib/apps/rules'
import { INSTANCE_RECORD_DATASETS } from '@/lib/instance-admin/schema'
import { readInstanceDataset, requireInstanceAdmin, runInstanceAction } from './instance-admin'
import { ruleActionAllowed, ruleActionBinding, OBJECT_KINDS, type ObjectKind } from '@/lib/apps/governance'
import { conditionTerm, DataTableQueryError, isConditionGroup, type DataTableColumnType, type DataTableCondition, type DataTableConditionGroup } from '@/lib/forms/data-table'
import { isPlainObject } from '@/lib/utils/guards'
import { getDb, rateSubject, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit } from './_shared'
import type { PreviewOptions } from './apps'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows and responses */

export const APP_ACTION_RATE = { max: 60, windowMs: 60_000 } as const
const REPLAY_TTL_MS = 10 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RESULT_BYTES = 256 * 1024
export const APP_REFERENCE_TIMEOUT_MS = 10_000

export interface AppActionInput {
  /** Page rules: the page (id or slug); app rules: null / omitted. */
  page?: string | null
  rule_id: string
  /** The action's place in the rule ("then.2", "then.1.then.0", "on_error.0"). */
  path: string
  /** Values of the action's declared template slots ({ "inputs.customer": "…" }). */
  values?: Record<string, unknown> | null
  idempotency_key: string
  /** Editors previewing the draft (and / or as a lower app role): run the DRAFT's rule. Everyone else runs the published rule. */
  preview?: PreviewOptions | null
}

export interface AppActionResult {
  type: RuleAction['type']
  result: unknown
  replayed?: boolean
}

/** Test seams. */
export const appActionDeps = {
  executeReference: async (opts: any) => (await import('@/lib/reference-executor')).executeReference(opts),
  startWorkflow: async (ctx: ServiceContext, input: any) => (await import('./workflow-start')).startWorkflow(ctx, input, { via: 'ui' }),
  loadRule: async (ctx: ServiceContext, app: string, page: string | null, ruleId: string, preview?: PreviewOptions | null) => (await import('./apps')).loadRuleForAction(ctx, app, page, ruleId, preview ?? undefined),
  facts: async (ctx: ServiceContext, db: any, viewer: any, ids: Record<ObjectKind, string[]>) => (await import('./app-access')).objectFactsFor(ctx, db, viewer, ids),
  rateLimit: async (key: string) => (await import('@/lib/rate-limit')).rateLimit(key, APP_ACTION_RATE),
  cache: async () => (await import('@/lib/providers/cache')).getCacheStore().catch(() => null),
}

/** The request's slot values for an action: declared template slots only, as text, capped; fixed values come from the saved rule. */
export function slotValues(action: RuleAction, given: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const src = isPlainObject(given) ? given : {}
  for (const { slot, template } of serverSlots(action)) {
    // A fixed value in the saved rule is used as saved: only template slots take the browser's value.
    if (!template.includes('{{')) { out[slot] = template.slice(0, 2000); continue }
    const v = src[slot]
    out[slot] = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 2000)
  }
  return out
}

const prefixed = (values: Record<string, string>, prefix: string) => Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith(`${prefix}.`)).map(([k, v]) => [k.slice(prefix.length + 1), v]))

export async function runAppRuleAction(ctx: ServiceContext, appKey: string, input: AppActionInput): Promise<AppActionResult> {
  if (typeof input.idempotency_key !== 'string' || input.idempotency_key.length < 8 || input.idempotency_key.length > 100) throw ServiceError.validation('idempotency_key must be 8-100 characters')
  if (ctx.authKind === 'anonymous') throw ServiceError.forbidden('Apps are not available on a public form')
  const loaded = await appActionDeps.loadRule(ctx, appKey, input.page ?? null, String(input.rule_id ?? ''), input.preview ?? null)
  const action = actionAt(loaded.rule, String(input.path ?? ''))
  if (!action || !isServerAction(action)) throw ServiceError.notFound('That rule has no server action at that position')

  // Governance, as the page is presented to this viewer.
  const binding = ruleActionBinding(action, '')
  const ids = Object.fromEntries(OBJECT_KINDS.map((k) => [k, [] as string[]])) as Record<ObjectKind, string[]>
  if (binding) ids[binding.kind].push(binding.id)
  const facts = await appActionDeps.facts(ctx, loaded.db, loaded.viewer, ids)
  if (!ruleActionAllowed(action, facts, loaded.role)) {
    throw ServiceError.forbidden(loaded.role === 'viewer' && binding?.action ? 'Your app role is read-only: ask for contributor access' : action.type === 'call_reference' ? 'This API reference is only available to people with integration access' : 'You don’t have access to what this action uses')
  }

  const hit = await appActionDeps.rateLimit(`app-rule:${ctx.tenantId}:${rateSubject(ctx)}`)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many requests — wait a moment and try again', { status: 429, details: { retry_after_ms: hit.retryAfterMs } })

  const replayKey = `app-rule:done:${loaded.app.id}:${loaded.page?.id ?? 'app'}:${loaded.rule.id}:${input.path}:${rateSubject(ctx)}:${input.idempotency_key}`
  const store = await appActionDeps.cache()
  const previous = store ? await store.get(replayKey).catch(() => null) : null
  if (previous) { try { return { ...(JSON.parse(previous) as AppActionResult), replayed: true } } catch { /* run again */ } }

  const values = slotValues(action, input.values)
  const result = await execute(ctx, loaded, action, values)
  let size = 0
  try { size = JSON.stringify(result ?? null).length } catch { size = Infinity }
  if (size > MAX_RESULT_BYTES) throw ServiceError.validation('The result is too large for an app rule (narrow it with a results path or a lower limit)')
  const out: AppActionResult = { type: action.type, result: result ?? null }
  void audit(ctx, {
    objectType: 'app', objectId: loaded.app.id, action: 'execute',
    summary: `App rule "${loaded.rule.name || loaded.rule.id}" (${loaded.page ? `page "${loaded.page.title}"` : 'app'}) ran ${action.type.replace(/_/g, ' ')}`,
    metadata: { rule_id: loaded.rule.id, path: input.path, action: action.type, page_id: loaded.page?.id ?? null, object_id: binding?.id ?? null, app_role: loaded.role },
  })
  if (store) await store.set(replayKey, JSON.stringify(out), REPLAY_TTL_MS).catch(() => undefined)
  return out
}

type Loaded = Awaited<ReturnType<typeof appActionDeps.loadRule>>

async function execute(ctx: ServiceContext, loaded: Loaded, action: RuleAction, values: Record<string, string>): Promise<unknown> {
  switch (action.type) {
    case 'call_reference': return callReference(ctx, loaded, action, values)
    case 'table_lookup': return lookupRows(ctx, action, values)
    case 'table_create': {
      requirePerm(ctx, 'data.manage_rows')
      tableAllowed(ctx, action.table_id)
      const { getDataTable, upsertRows } = await import('./data-tables')
      await getDataTable(ctx, action.table_id)
      const [created] = await upsertRows(ctx, action.table_id, [{ data: prefixed(values, 'values') }])
      void audit(ctx, { objectType: 'data_table', objectId: action.table_id, action: 'create', summary: `App rule "${loaded.rule.name || loaded.rule.id}" added a row`, metadata: { app_id: loaded.app.id, rule_id: loaded.rule.id, row_id: created.row_id } })
      return { id: created.row_id, row_id: created.row_id, ...(isPlainObject(created.row?.data) ? created.row.data : {}) }
    }
    case 'table_update': {
      requirePerm(ctx, 'data.manage_rows')
      tableAllowed(ctx, action.table_id)
      const rowId = values.row_id?.trim() ?? ''
      if (!UUID_RE.test(rowId)) throw ServiceError.validation('Update a row: the row id is missing or not an id')
      const { updateRow } = await import('./data-tables')
      const row = await updateRow(ctx, action.table_id, rowId, prefixed(values, 'values'))
      void audit(ctx, { objectType: 'data_table', objectId: action.table_id, action: 'update', summary: `App rule "${loaded.rule.name || loaded.rule.id}" updated a row`, metadata: { app_id: loaded.app.id, rule_id: loaded.rule.id, row_id: rowId } })
      return { id: rowId, row_id: rowId, ...(isPlainObject((row as any)?.data) ? (row as any).data : {}) }
    }
    case 'start_workflow': {
      const started: any = await appActionDeps.startWorkflow(ctx, { workflow_id: action.workflow_id, variables: { ...prefixed(values, 'inputs'), app_id: loaded.app.id, app_rule_id: loaded.rule.id }, async: true })
      return { started: true, ...(started?.job_id ? { job_id: started.job_id } : {}), ...(started?.run_id ? { run_id: started.run_id } : {}) }
    }
    case 'instance_read': {
      // Instance admins only: anyone else gets the access message (403).
      const params = Object.fromEntries(Object.entries(prefixed(values, 'params')).filter(([, v]) => v.trim() !== ''))
      const page = await readInstanceDataset(ctx, action.dataset, params, { via: 'app', refusal: 'forbidden' })
      return INSTANCE_RECORD_DATASETS.has(action.dataset) ? page.rows[0] ?? null : page.rows
    }
    case 'instance_action': {
      // Instance admins only; needs a reason; recorded in the instance trail and in the workspace's own audit log.
      const inputs = Object.fromEntries(Object.entries(prefixed(values, 'inputs')).filter(([, v]) => v.trim() !== ''))
      const admin = await requireInstanceAdmin(ctx, { kind: 'action', via: 'app', refusal: 'forbidden' })
      return runInstanceAction(ctx, action.action, inputs, { via: 'app', admin })
    }
    default: throw ServiceError.validation('Not a server action')
  }
}

function tableAllowed(ctx: ServiceContext, tableId: string): void {
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (allow.length && !allow.includes(tableId)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
}

async function callReference(ctx: ServiceContext, loaded: Loaded, action: Extract<RuleAction, { type: 'call_reference' }>, values: Record<string, string>): Promise<unknown> {
  const { serviceRoleClient } = await import('./_shared')
  const db = await serviceRoleClient(ctx)
  const { data: ref, error } = await (db as any).from('integration_references').select('id, inputs, request_config').eq('tenant_id', ctx.tenantId).eq('id', action.reference_id).maybeSingle()
  if (error) throw new ServiceError('internal', 'Could not load the API reference')
  if (!ref) throw ServiceError.notFound('The rule’s API reference no longer exists')
  const { isWriteReference } = await import('@/lib/custom-references/types')
  if (isWriteReference(ref)) throw ServiceError.validation('This API reference writes data — app rules only call read-only references')
  const declared = new Set(((Array.isArray(ref.inputs) ? ref.inputs : []) as any[]).map((i) => String(i?.name ?? i?.key ?? '')).filter(Boolean))
  const inputs = Object.fromEntries(Object.entries(prefixed(values, 'inputs')).filter(([k]) => declared.has(k)).map(([k, v]) => [k, v.slice(0, 400)]))
  let data: unknown
  try {
    const { newTraceId } = await import('@/lib/trace')
    const response: any = await appActionDeps.executeReference({
      supabase: db, referenceId: action.reference_id, inputValues: inputs, timeout: APP_REFERENCE_TIMEOUT_MS, expectedTenantId: ctx.tenantId,
      caller: { traceId: newTraceId(), callerType: 'app_widget', callerId: ctx.actorId ?? null }, readOnly: true,
    })
    if ((response?.status ?? 200) >= 400) throw Object.assign(new Error(`status ${response.status}`), { status: response.status })
    const { unwrapExecutorResult } = await import('@/lib/response-collections')
    data = unwrapExecutorResult(response?.data)
  } catch (e: any) {
    if (e?.status === 404) throw ServiceError.notFound('The service found nothing for these values')
    if (/abort|timed? ?out/i.test(String(e?.message ?? ''))) throw new ServiceError('internal', 'The service took too long — try again', { status: 504 })
    throw new ServiceError('internal', 'The service is not available right now', { status: 502 })
  }
  const { readResultPath } = await import('@/lib/forms/reference-results')
  void loaded
  return action.results_path ? readResultPath(data, action.results_path) : data
}

/** A resolved condition group (slot values in place) as one PostgREST logic tree. */
export function lookupFilter(group: DataTableConditionGroup | null | undefined, values: Record<string, string>, types: Record<string, DataTableColumnType>): string | null {
  if (!group?.conditions.length) return null
  const term = (c: DataTableCondition, slot: string) => {
    const column = c.column.replace(/^row\./, '')
    try { return conditionTerm(column, column === 'row_id' || column === 'id' ? 'text' : types[column] ?? 'text', c.operator, values[slot] ?? '') } catch (e) { if (e instanceof DataTableQueryError) return 'id.is.null'; throw e }
  }
  const parts = group.conditions.map((c, i) => {
    if (isConditionGroup(c as DataTableCondition | DataTableConditionGroup)) {
      const g = c as DataTableConditionGroup
      const inner = g.conditions.map((d, j) => term(d as DataTableCondition, `filter.${i}.${j}`))
      return inner.length ? `${g.match === 'any' ? 'or' : 'and'}(${inner.join(',')})` : null
    }
    return term(c as DataTableCondition, `filter.${i}`)
  }).filter(Boolean)
  return parts.length ? `${group.match === 'any' ? 'or' : 'and'}(${parts.join(',')})` : null
}

async function lookupRows(ctx: ServiceContext, action: Extract<RuleAction, { type: 'table_lookup' }>, values: Record<string, string>): Promise<unknown> {
  requirePerm(ctx, 'data.view')
  tableAllowed(ctx, action.table_id)
  const { getDataTable } = await import('./data-tables')
  await getDataTable(ctx, action.table_id)
  // The viewer's own client: RLS and their table scope apply.
  const db = getDb(ctx) as any
  const { tableColumnTypes, friendlyDbError } = await import('./form-data-table')
  const types = await tableColumnTypes(db, ctx.tenantId, action.table_id)
  let q = db.from('custom_table_rows').select('id, data, created_at').eq('tenant_id', ctx.tenantId).eq('table_id', action.table_id)
  if (action.row_id) {
    const rowId = values.row_id?.trim() ?? ''
    if (!UUID_RE.test(rowId)) return action.limit === 1 ? null : []
    q = q.eq('id', rowId)
  }
  const where = lookupFilter(action.filter as DataTableConditionGroup | null | undefined, values, types)
  if (where) q = q.or(where)
  const { data, error } = await q.order('created_at', { ascending: true }).limit(action.limit)
  if (error) throw friendlyDbError(error)
  const rows = ((data ?? []) as any[]).map((r) => ({ ...(isPlainObject(r.data) ? r.data : {}), id: String(r.id), row_id: String(r.id) }))
  return action.limit === 1 ? rows[0] ?? null : rows
}

export type { AppRule }
