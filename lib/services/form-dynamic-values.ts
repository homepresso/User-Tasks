/**
 * forms.dynamicValue — resolve a field's dynamic property
 * (lib/forms/dynamic-values.ts) from a data table or an API reference, for a
 * task's form, a reusable form's page (signed in or anonymous) or the
 * designer's preview; and, on submit, re-resolve the properties that decide
 * validation (options, min / max, earliest / latest, required) for that
 * submission's context.
 *
 * Security model — the Data table field's (lib/services/form-data-table.ts),
 * reused rather than re-implemented:
 *  - the binding comes from the SAVED form by field key and property; the
 *    browser never names a table, a reference, a projection or a filter.
 *    A property without a source binding on that field is refused. Only the
 *    designer preview sends an (unsaved) field, and it needs forms.edit or
 *    workflows.edit (plus data.view / integrations.view for the source);
 *  - task forms need tasks.complete and a task the caller can act on;
 *    reusable forms need forms.submit;
 *  - data tables are read with the caller's own client (data.view, RLS as
 *    the user, the credential's table allowlist) unless the binding has
 *    "open access"; anonymous visitors only with the binding's own
 *    `anonymous_read`;
 *  - placeholders ({{param.x}}, {{var.x}}, {{form.x}}…) are re-validated
 *    against the saved declarations and are only ever quoted values of the
 *    author's base filter / mapped inputs — they narrow, never widen;
 *  - rows are capped (500 options, 1,000 rows; API rows fetched ≤ 1,000)
 *    and projected to the declared columns before anything is shaped or
 *    returned; rate limited and time limited like a Data table.
 */

import {
  DATA_TABLE_LIMITS, DATA_TABLE_ROW_ID, DataTableQueryError, applyLocally, baseFilterTerm, projectRow, referencedColumns,
  type DataTableFieldConfig, type DataTableScope,
} from '@/lib/forms/data-table'
import {
  VALIDATING_PROPS, applyDynamicValues, bindingQueryConfig, bindingRowLimit, coerceDynamicValue, expectedType, isSourceBinding, resolveExpression,
  restrictsToList, shapeRows, type DynamicBinding, type DynamicValueType, type SourceBinding,
} from '@/lib/forms/dynamic-values'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, isAnonymous, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'
import {
  callReference, contextEntries, dataTableDeps, friendlyDbError, rateLimited, readClient, responseRows, scopeValues, tableColumnTypes, userScope,
} from './form-data-table'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata and table rows are free-form JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TABLE_TIMEOUT_MS = 6000

export type DynamicValueTarget = { task_id: string } | { form_id: string } | { preview_field: unknown }

export interface DynamicValueInput {
  field_key?: string
  /** The bound property: `options`, `max`, `props.data`… */
  prop?: string
  /** The form's current values (placeholders, parameters / variables under their reserved keys). */
  values?: Record<string, unknown>
  params?: Record<string, unknown>
  variables?: Record<string, unknown>
}

export interface DynamicValueResult {
  /** The property's value, typed as it expects (undefined: nothing found). */
  value: unknown
  /** Rows the source returned (before shaping). */
  count: number
  /** More rows than the cap: the list was cut. */
  truncated?: boolean
}

interface Loaded {
  fields: TaskFieldDef[]
  field: TaskFieldDef
  stored: Record<string, unknown>
  layout?: unknown
  storedParams?: Record<string, unknown> | null
  task: Record<string, unknown> | null
  preview: boolean
}

function bindingOf(field: TaskFieldDef, prop: string | undefined): { binding: DynamicBinding; expects: DynamicValueType } {
  const binding = prop ? field.dynamic?.[prop] : undefined
  const expects = binding && prop ? expectedType(field, prop, binding) : null
  if (!binding || !expects) throw ServiceError.notFound(`The field "${field.key}" has no dynamic "${String(prop ?? '').slice(0, 80)}"`)
  return { binding, expects }
}

async function load(ctx: ServiceContext, target: DynamicValueTarget, fieldKey: string | undefined): Promise<Loaded> {
  const db = await serviceRoleClient(ctx)
  const pick = (fields: TaskFieldDef[], where: string) => {
    const field = fields.find((f) => f.key === fieldKey)
    if (!field) throw ServiceError.notFound(`${where} has no field "${String(fieldKey ?? '').slice(0, 64)}"`)
    return field
  }
  if ('task_id' in target) {
    const { loadLookupTask } = await import('./form-lookup')
    const task = await loadLookupTask(ctx, db, target.task_id)
    const meta = (task.metadata ?? {}) as Record<string, any>
    const fields = normalizeTaskFields(meta.fields)
    return {
      fields, field: pick(fields, "The task's form"), stored: isPlainObject(meta.template_values) ? meta.template_values : {},
      layout: meta.form_layout, storedParams: isPlainObject(meta.form_params) ? meta.form_params : {},
      task: { id: task.id, title: task.title, priority: task.priority, status: task.status }, preview: false,
    }
  }
  if ('form_id' in target) {
    if (!isAnonymous(ctx) && !hasPerm(ctx, 'forms.submit')) throw ServiceError.forbidden("Forbidden: missing permission 'forms.submit'")
    if (!UUID_RE.test(target.form_id)) throw ServiceError.notFound('Form not found')
    if (isAnonymous(ctx) && ctx.anonymous.formId !== target.form_id) throw ServiceError.notFound('Form not found')
    const { data: form } = await (db as any).from('forms').select('id, fields, layout').eq('id', target.form_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (!form) throw ServiceError.notFound('Form not found')
    const fields = normalizeTaskFields(form.fields)
    return { fields, field: pick(fields, 'The form'), stored: {}, layout: form.layout, storedParams: null, task: null, preview: false }
  }
  if (!hasPerm(ctx, 'workflows.edit') && !hasPerm(ctx, 'forms.edit')) {
    throw ServiceError.forbidden("Forbidden: previewing a dynamic property needs the 'workflows.edit' or 'forms.edit' permission")
  }
  const [field] = normalizeTaskFields([target.preview_field])
  if (!field) throw ServiceError.validation('Not a field')
  return { fields: [field], field, stored: {}, task: null, preview: true }
}

/** A source binding's rows: projected to its declared columns, within its base filter, capped. */
export async function runSourceBinding(
  db: AnySupabaseClient, sys: AnySupabaseClient, tenantId: string, binding: SourceBinding, expects: DynamicValueType, scope: DataTableScope, callerId: string | null,
): Promise<{ rows: Array<Record<string, unknown>>; truncated: boolean }> {
  const limit = bindingRowLimit(binding, expects)
  if (binding.kind === 'table') {
    const types = await tableColumnTypes(db, tenantId, binding.table_id)
    const config = bindingQueryConfig(binding, types)
    for (const column of referencedColumns(config)) {
      if (!Object.prototype.hasOwnProperty.call(types, column)) throw ServiceError.validation(`The dynamic property refers to a column "${column}" the table does not have`)
    }
    const where = baseFilterTerm(config, scope, types)
    let q = (db as any).from('custom_table_rows').select('id, data').eq('tenant_id', tenantId).eq('table_id', binding.table_id)
    if (where) q = q.or(`and(${where})`)
    for (const s of binding.sort ?? []) q = q.order(s.column === DATA_TABLE_ROW_ID ? 'id' : `data->${s.column}`, { ascending: s.direction !== 'desc', nullsFirst: false })
    q = q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, limit)
    if (typeof q.abortSignal === 'function') q = q.abortSignal(AbortSignal.timeout(TABLE_TIMEOUT_MS))
    const { data, error } = await q
    if (error) throw friendlyDbError(error)
    const records = (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>
    const rows = records.slice(0, limit).map((r) => projectRow(config, { ...(isPlainObject(r.data) ? r.data : {}), [DATA_TABLE_ROW_ID]: r.id })?.values ?? {})
    return { rows, truncated: records.length > limit }
  }
  const config: DataTableFieldConfig = bindingQueryConfig(binding)
  const data = await callReference(sys, tenantId, config, scope, callerId)
  const records = responseRows(config, data)
  const projected = records.slice(0, DATA_TABLE_LIMITS.referenceRows).flatMap((r) => { const row = projectRow(config, r); return row ? [row] : [] })
  // The base filter and the sort run here (the API was only given the mapped inputs).
  const local = applyLocally(config, projected, { search: '', filters: [], sort: binding.sort ?? [], page: 1, page_size: limit }, scope, { search: false, sort: false, page: true, filters: [] })
  return { rows: local.rows.map((r) => r.values), truncated: records.length > DATA_TABLE_LIMITS.referenceRows }
}

/** Who reads a table binding: the Data table field's rules (open access, anonymous read, data.view + RLS). */
async function bindingClient(ctx: ServiceContext, binding: SourceBinding, preview: boolean): Promise<AnySupabaseClient> {
  if (binding.kind === 'reference') {
    if (isAnonymous(ctx) && binding.anonymous_read !== true) throw ServiceError.forbidden('This source is not available on a public form')
    if (preview && !hasPerm(ctx, 'integrations.view')) throw ServiceError.forbidden("Forbidden: previewing an API source needs the 'integrations.view' permission")
    return serviceRoleClient(ctx)
  }
  return readClient(ctx, bindingQueryConfig(binding), preview)
}

/**
 * The value of one dynamic property, resolved on the server. Expression
 * bindings are resolved too (the designer preview, API clients), with the
 * same server-validated scope.
 */
export async function resolveDynamicValue(ctx: ServiceContext, target: DynamicValueTarget, input: DynamicValueInput): Promise<DynamicValueResult> {
  const loaded = await load(ctx, target, input.field_key)
  const { binding, expects } = bindingOf(loaded.field, input.prop)
  if (isAnonymous(ctx) && isSourceBinding(binding) && binding.anonymous_read !== true) throw ServiceError.forbidden('This source is not available on a public form')
  await rateLimited(ctx)
  const submitted = isPlainObject(input.values) ? input.values : undefined
  const values = loaded.preview ? { ...(submitted ?? {}) } : scopeValues(loaded.fields, loaded.stored, submitted)
  const config = isSourceBinding(binding) ? bindingQueryConfig(binding) : { source: 'table' as const, mode: 'display' as const, columns: [], base_filter: undefined, input_mappings: { expr: binding.expr } }
  if (!loaded.preview) Object.assign(values, contextEntries(config, loaded.layout, { values: submitted, params: input.params, variables: input.variables }, loaded.storedParams, loaded.fields))
  const sys = await serviceRoleClient(ctx)
  const scope: DataTableScope = { values, user: await userScope(sys, ctx.actorId), now: dataTableDeps.now(), task: loaded.task }
  try {
    if (binding.kind === 'expr') {
      const coerced = coerceDynamicValue(expects, resolveExpression(binding.expr, scope))
      if (!coerced.ok) throw ServiceError.validation(coerced.error)
      return { value: coerced.value, count: coerced.value === undefined ? 0 : 1 }
    }
    const db = await bindingClient(ctx, binding, loaded.preview)
    const { rows, truncated } = await runSourceBinding(db, sys, ctx.tenantId, binding, expects, scope, loaded.task ? String(loaded.task.id) : 'form')
    const shaped = shapeRows(binding, rows, expects)
    if (!shaped.ok) throw ServiceError.validation(shaped.error)
    return { value: shaped.value, count: rows.length, ...(truncated ? { truncated } : {}) }
  } catch (error) {
    if (error instanceof DataTableQueryError) throw ServiceError.validation(error.message)
    throw error
  }
}

/* ── Submissions ─────────────────────────────────────────────────────── */

/** Whether any field has a binding the server must resolve before validating. */
export function needsDynamicValidation(fields: TaskFieldDef[]): boolean {
  return fields.some((f) => Object.keys(f.dynamic ?? {}).some((k) => VALIDATING_PROPS.has(k)))
}

/**
 * The fields with the bindings that decide validation resolved for this
 * submission (`values`: the submitted values over the stored ones, with
 * the server-validated parameters / variables / controls under their
 * reserved keys). Options always end up resolved — a source that fails
 * offers none (a value then fails as "must be one of"), so the browser's
 * list is never what is judged. `ctx` null: a system check (tenant-scoped
 * read, bounded by the binding's base filter and projection).
 */
export async function resolveDynamicFields(
  ctx: ServiceContext | null,
  tenantId: string,
  fields: TaskFieldDef[],
  values: Record<string, unknown>,
  options: { actorId?: string | null; task?: Record<string, unknown> | null } = {},
): Promise<{ fields: TaskFieldDef[]; errors: Record<string, string> }> {
  const errors: Record<string, string> = {}
  if (!needsDynamicValidation(fields)) return { fields, errors }
  const { createServiceClient } = await import('@/lib/cron-auth')
  const sys = createServiceClient() as AnySupabaseClient
  const scope: DataTableScope = { values, user: await userScope(sys, options.actorId ?? ctx?.actorId ?? null), now: dataTableDeps.now(), task: options.task ?? null }
  const out: TaskFieldDef[] = []
  for (const field of fields) {
    const resolved: Record<string, unknown> = {}
    for (const [prop, binding] of Object.entries(field.dynamic ?? {})) {
      if (!VALIDATING_PROPS.has(prop)) continue
      const expects = expectedType(field, prop, binding)
      if (!expects) continue
      try {
        if (binding.kind === 'expr') {
          const coerced = coerceDynamicValue(expects, resolveExpression(binding.expr, scope))
          resolved[prop] = coerced.ok ? coerced.value : undefined
          if (!coerced.ok && prop === 'options') resolved[prop] = []
          continue
        }
        // Anonymous visitors: a source without its own "Allow anonymous read" offers nothing.
        if (ctx && isAnonymous(ctx) && binding.anonymous_read !== true) { resolved[prop] = prop === 'options' ? [] : undefined; continue }
        const db = !ctx || (binding.kind === 'table' && binding.open_access) || binding.kind === 'reference' ? sys : await bindingClient(ctx, binding, false)
        const { rows } = await runSourceBinding(db, sys, tenantId, binding, expects, scope, options.task ? String(options.task.id) : 'form')
        const shaped = shapeRows(binding, rows, expects)
        resolved[prop] = shaped.ok ? shaped.value : prop === 'options' ? [] : undefined
      } catch (error) {
        if (prop === 'options') {
          resolved[prop] = []
          const sent = values[field.key]
          if (sent !== undefined && sent !== null && sent !== '' && !(Array.isArray(sent) && !sent.length)) {
            errors[field.key] = `${field.label}: the options could not be checked${error instanceof ServiceError ? ` (${error.message})` : ''} — try again`
          }
        }
      }
    }
    let next = applyDynamicValues(field, resolved)
    // "Restrict to list" off: a value outside the resolved options is accepted (bounded like any choice).
    if (Object.prototype.hasOwnProperty.call(resolved, 'options') && !restrictsToList(field.dynamic?.options)) {
      const sent = values[field.key]
      const extra = (Array.isArray(sent) ? sent : sent === undefined || sent === null || sent === '' ? [] : String(sent).split(field.type === 'multi_choice' ? ',' : '\u0000'))
        .map((v) => String(v).trim()).filter((v) => v && v.length <= 500).slice(0, 50)
      next = { ...next, options: [...new Set([...(next.options ?? []), ...extra])] }
    }
    out.push(next)
  }
  return { fields: out, errors }
}
