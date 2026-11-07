/**
 * "For each changed row" rules: an action that loops over an editable Data
 * table field's change set (added / updated / deleted, optionally filtered)
 * and, for each row, writes to a workspace data table, calls an API
 * reference / connector operation, or starts a workflow (per row, or once
 * with the whole change set).
 *
 * It is an action of the form's submitting buttons (`apply_table_changes`
 * in lib/forms/buttons.ts — run after the submission is stored) and an
 * on-click step of in-form Buttons ("Apply table changes",
 * lib/forms/field-buttons.ts). Either way it runs on the SERVER only
 * (lib/services/form-table-changes.ts): the targets come from the saved form
 * definition, the browser only sends the change set, which the server
 * validates and re-reads (`before`) from the source first.
 *
 * Row templates: {{row.<col>}} (the row after the change; before it for a
 * deleted row), {{before.<col>}}, {{after.<col>}}, {{key}}, {{change}}
 * (added / updated / deleted), {{changed_fields}}, {{form.<field>}},
 * {{user.id}} / {{user.email}} / {{user.name}}, {{today}}, {{now}}; for a
 * workflow started once: {{changes}} (the whole change set).
 *
 * Pure and isomorphic: config, problems, planning (also the designer's
 * dry run) and the summary text.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'
import {
  DATA_TABLE_OPERATORS, dateExpression, rowMeets, type DataTableChangeSet, type DataTableColumnType, type DataTableCondition, type DataTableOperator,
} from './data-table'

export type TableChangeKind = 'added' | 'updated' | 'deleted'
export const TABLE_CHANGE_KINDS: TableChangeKind[] = ['added', 'updated', 'deleted']
export type TableChangeTarget = 'table' | 'reference' | 'workflow'
export type TableWriteOperation = 'auto' | 'insert' | 'update' | 'upsert' | 'delete'
export const TABLE_WRITE_OPERATIONS: TableWriteOperation[] = ['auto', 'insert', 'update', 'upsert', 'delete']
export const TABLE_WRITE_OPERATION_LABELS: Record<TableWriteOperation, string> = {
  auto: 'Mirror the change (insert added, update changed, delete deleted)',
  insert: 'Insert a row', update: 'Update the matching row', upsert: 'Update, or insert when no row matches', delete: 'Delete the matching row',
}

export interface TableChangesConfig {
  /** The editable Data table field whose changes are looped over. */
  field: string
  /** Which changes (default: all three). */
  kinds?: TableChangeKind[]
  /** Only rows meeting this condition (on {{row.<col>}}). */
  where?: DataTableCondition
  target: TableChangeTarget
  // ── table ──
  table_id?: string
  operation?: TableWriteOperation
  /** Target column a row is matched on (`row_id` = the target row's own id). */
  match_column?: string
  /** The value matched (template; default {{key}}). */
  match_value?: string
  /** Target column → template. */
  mapping?: Record<string, string>
  // ── reference ──
  integration_id?: string
  reference_id?: string
  // ── workflow ──
  workflow_id?: string
  workflow_name?: string
  /** workflow: once per row (default) or once with the whole change set. */
  per?: 'row' | 'once'
  /** reference / workflow inputs: name → template. */
  inputs?: Record<string, string>
  // ── run ──
  /** deletes → updates → inserts (default), or inserts first. */
  order?: 'deletes_first' | 'inserts_first'
  /** Stop at the first failure (default) or continue and report. */
  on_error?: 'stop' | 'continue'
  /** Show the summary ("3 rows updated, 1 failed") as a message (default on). */
  show_summary?: boolean
}

export const TABLE_CHANGES_LIMITS = { mapping: 40, inputs: 40, template: 500, maxOpsPerRun: 200 } as const

const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const INPUT_RE = /^[A-Za-z0-9_.$-]{1,100}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

function templateMap(raw: unknown, keyRe: RegExp, limit: number): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw).slice(0, limit)) {
    if (!keyRe.test(k) || k === '__proto__') continue
    const t = v === null || v === undefined ? '' : String(v).slice(0, TABLE_CHANGES_LIMITS.template)
    if (t) out[k] = t
  }
  return Object.keys(out).length ? out : undefined
}

/** Clean a stored / submitted rule. */
export function normalizeTableChanges(raw: unknown): TableChangesConfig {
  const r = isPlainObject(raw) ? raw : {}
  const target: TableChangeTarget = r.target === 'reference' || r.target === 'workflow' ? r.target : 'table'
  const out: TableChangesConfig = { field: typeof r.field === 'string' && KEY_RE.test(r.field) ? r.field : '', target }
  if (Array.isArray(r.kinds)) {
    const kinds = TABLE_CHANGE_KINDS.filter((k) => (r.kinds as unknown[]).includes(k))
    if (kinds.length && kinds.length < 3) out.kinds = kinds
  }
  if (isPlainObject(r.where) && typeof r.where.column === 'string' && COLUMN_RE.test(r.where.column.split('.')[0] ?? '')) {
    const operator = DATA_TABLE_OPERATORS.includes(r.where.operator as DataTableOperator) ? r.where.operator as DataTableOperator : 'eq'
    out.where = { column: r.where.column.slice(0, 200), operator, ...(operator === 'is_set' || operator === 'is_not_set' ? {} : { value: String(r.where.value ?? '').slice(0, TABLE_CHANGES_LIMITS.template) }) }
  }
  if (target === 'table') {
    const tableId = str(r.table_id, 64)
    if (tableId) out.table_id = tableId
    out.operation = TABLE_WRITE_OPERATIONS.includes(r.operation as TableWriteOperation) ? r.operation as TableWriteOperation : 'auto'
    const match = typeof r.match_column === 'string' && (r.match_column === 'row_id' || COLUMN_RE.test(r.match_column)) ? r.match_column : undefined
    if (match) out.match_column = match
    const matchValue = str(r.match_value, TABLE_CHANGES_LIMITS.template)
    if (matchValue) out.match_value = matchValue
    const mapping = templateMap(r.mapping, COLUMN_RE, TABLE_CHANGES_LIMITS.mapping)
    if (mapping) { delete mapping.id; delete mapping.date_created; if (Object.keys(mapping).length) out.mapping = mapping }
  }
  if (target === 'reference') {
    const integrationId = str(r.integration_id, 64)
    const referenceId = str(r.reference_id, 64)
    if (integrationId) out.integration_id = integrationId
    if (referenceId) out.reference_id = referenceId
    const inputs = templateMap(r.inputs, INPUT_RE, TABLE_CHANGES_LIMITS.inputs)
    if (inputs) out.inputs = inputs
  }
  if (target === 'workflow') {
    if (typeof r.workflow_id === 'string' && UUID_RE.test(r.workflow_id)) out.workflow_id = r.workflow_id
    const name = str(r.workflow_name, 200)
    if (name) out.workflow_name = name
    if (r.per === 'once') out.per = 'once'
    const inputs = templateMap(r.inputs, /^[A-Za-z_][A-Za-z0-9_]{0,99}$/, TABLE_CHANGES_LIMITS.inputs)
    if (inputs) out.inputs = inputs
  }
  if (r.order === 'inserts_first') out.order = 'inserts_first'
  if (r.on_error === 'continue') out.on_error = 'continue'
  if (r.show_summary === false) out.show_summary = false
  return out
}

/** The operation a change becomes on a table target. */
export function operationFor(config: TableChangesConfig, kind: TableChangeKind): Exclude<TableWriteOperation, 'auto'> {
  const op = config.operation ?? 'auto'
  if (op !== 'auto') return op
  return kind === 'added' ? 'insert' : kind === 'updated' ? 'update' : 'delete'
}

/**
 * Designer problems (null = fine). `editableTables`: the form's editable
 * Data table field keys.
 */
export function tableChangesProblem(config: TableChangesConfig | undefined, editableTables: ReadonlySet<string>): string | null {
  if (!config) return 'Configure the table changes'
  if (!config.field) return 'Apply table changes: choose the Data table field'
  if (!editableTables.has(config.field)) return `Apply table changes: "${config.field}" is not an editable Data table on this form`
  if (config.target === 'table') {
    if (!config.table_id) return 'Apply table changes: choose the data table to write to'
    const ops = new Set((config.kinds ?? TABLE_CHANGE_KINDS).map((k) => operationFor(config, k)))
    if ([...ops].some((op) => op !== 'insert') && !config.match_column) return 'Apply table changes: choose the column rows are matched on'
    if (![...ops].every((op) => op === 'delete') && !Object.keys(config.mapping ?? {}).length) return 'Apply table changes: map at least one column'
  }
  if (config.target === 'reference' && !config.reference_id) return 'Apply table changes: choose the API reference to call'
  if (config.target === 'workflow' && !config.workflow_id) return 'Apply table changes: choose the workflow to start'
  return null
}

/* ── Templates ───────────────────────────────────────────────────────── */

const TEMPLATE_RE = /\{\{\s*([\w.\-+[\]]+)\s*\}\}/g

export interface RowScope {
  kind: TableChangeKind
  key: string | null
  row: Record<string, unknown>
  before: Record<string, unknown>
  after: Record<string, unknown>
  changed_fields: string[]
}

export interface ChangesScope {
  values: Record<string, unknown>
  user?: { id?: string | null; email?: string | null; name?: string | null } | null
  now?: Date
  changes?: DataTableChangeSet
}

function lookup(path: string, row: RowScope | null, scope: ChangesScope): unknown {
  if (row) {
    if (path === 'key') return row.key
    if (path === 'change') return row.kind
    if (path === 'changed_fields') return row.changed_fields
    const m = /^(row|before|after)\.(.+)$/.exec(path)
    if (m) return pathValue(row[m[1] as 'row' | 'before' | 'after'], m[2])
    if (path === 'row' || path === 'before' || path === 'after') return row[path]
  }
  if (path === 'changes') return scope.changes ?? null
  let m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
  if (m) return pathValue(scope.values, m[1])
  m = /^user\.(id|email|name)$/.exec(path)
  if (m) return scope.user?.[m[1] as 'id' | 'email' | 'name'] ?? null
  const date = dateExpression(path, scope.now)
  if (date !== undefined) return date
  return undefined
}

/** A template's value for a row: one whole reference keeps its type (numbers stay numbers); mixed text is interpolated. */
export function resolveRowTemplate(template: string | undefined, row: RowScope | null, scope: ChangesScope): unknown {
  if (template === undefined) return null
  if (!template.includes('{{')) return template
  const whole = /^\{\{\s*([\w.\-+[\]]+)\s*\}\}$/.exec(template.trim())
  if (whole) {
    const v = lookup(whole[1], row, scope)
    return v === undefined ? null : v
  }
  return template.replace(TEMPLATE_RE, (_m, path: string) => {
    const v = lookup(path, row, scope)
    if (v === undefined || v === null) return ''
    if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
    return String(v)
  })
}

/* ── Planning ────────────────────────────────────────────────────────── */

export interface PlannedOp {
  kind: TableChangeKind
  /** The source row's key ('' for added rows). */
  key: string
  action: 'insert' | 'update' | 'upsert' | 'delete' | 'call' | 'start'
  /** table: the match ({ column, value }) for update / upsert / delete. */
  match?: { column: string; value: unknown }
  /** table: the cells written; reference / workflow: the inputs. */
  data?: Record<string, unknown>
}

export interface TableChangesPlan {
  ops: PlannedOp[]
  /** Rows skipped by the kinds / where filter. */
  skipped: number
  /** More rows than one run may process. */
  over_cap?: boolean
}

function rowScopes(changes: DataTableChangeSet): RowScope[] {
  const out: RowScope[] = []
  for (const row of changes.added ?? []) out.push({ kind: 'added', key: null, row, before: {}, after: row, changed_fields: Object.keys(row) })
  for (const u of changes.updated ?? []) {
    const after = { ...u.before, ...u.after }
    out.push({ kind: 'updated', key: u.key, row: after, before: u.before, after, changed_fields: u.changed_fields })
  }
  for (const d of changes.deleted ?? []) out.push({ kind: 'deleted', key: d.key, row: d.before, before: d.before, after: {}, changed_fields: [] })
  return out
}

const RANK_DELETES_FIRST: Record<TableChangeKind, number> = { deleted: 0, updated: 1, added: 2 }
const RANK_INSERTS_FIRST: Record<TableChangeKind, number> = { added: 0, updated: 1, deleted: 2 }

/**
 * What a rule does with a change set, in order (pure: the server runs it,
 * the designer shows it as the dry run). Rows are filtered by kind and the
 * `where` condition, ordered deletes → updates → inserts (or inserts
 * first), and capped at TABLE_CHANGES_LIMITS.maxOpsPerRun.
 */
export function planTableChanges(config: TableChangesConfig, changes: DataTableChangeSet, scope: ChangesScope, columnTypes: Record<string, DataTableColumnType> = {}): TableChangesPlan {
  const kinds = new Set(config.kinds ?? TABLE_CHANGE_KINDS)
  const rank = config.order === 'inserts_first' ? RANK_INSERTS_FIRST : RANK_DELETES_FIRST
  const all = rowScopes(changes)
  const rows = all
    .filter((r) => kinds.has(r.kind))
    .filter((r) => {
      if (!config.where) return true
      const value = config.where.value === undefined ? '' : String(resolveRowTemplate(config.where.value, r, scope) ?? '')
      return rowMeets(r.row, config.where.column, columnTypes[config.where.column] ?? 'text', config.where.operator, value)
    })
    .sort((a, b) => rank[a.kind] - rank[b.kind])
  const skipped = all.length - rows.length
  const fullScope: ChangesScope = { ...scope, changes }
  const ops: PlannedOp[] = []
  if (config.target === 'workflow' && config.per === 'once') {
    if (rows.length) {
      const data: Record<string, unknown> = {}
      for (const [name, t] of Object.entries(config.inputs ?? {})) data[name] = resolveRowTemplate(t, null, fullScope)
      ops.push({ kind: rows[0].kind, key: '', action: 'start', data })
    }
    return { ops, skipped }
  }
  for (const r of rows.slice(0, TABLE_CHANGES_LIMITS.maxOpsPerRun)) {
    const key = r.key ?? ''
    if (config.target === 'table') {
      const action = operationFor(config, r.kind)
      const op: PlannedOp = { kind: r.kind, key, action }
      if (action !== 'insert') op.match = { column: config.match_column ?? 'row_id', value: resolveRowTemplate(config.match_value ?? '{{key}}', r, fullScope) }
      if (action !== 'delete') {
        const data: Record<string, unknown> = {}
        for (const [column, t] of Object.entries(config.mapping ?? {})) data[column] = resolveRowTemplate(t, r, fullScope)
        op.data = data
      }
      ops.push(op)
    } else {
      const data: Record<string, unknown> = {}
      for (const [name, t] of Object.entries(config.inputs ?? {})) data[name] = resolveRowTemplate(t, r, fullScope)
      ops.push({ kind: r.kind, key, action: config.target === 'reference' ? 'call' : 'start', data })
    }
  }
  return { ops, skipped, ...(rows.length > TABLE_CHANGES_LIMITS.maxOpsPerRun ? { over_cap: true } : {}) }
}

/* ── Results and the summary ─────────────────────────────────────────── */

export interface TableChangeResult {
  kind: TableChangeKind
  key: string
  action: PlannedOp['action']
  status: 'ok' | 'failed' | 'skipped'
  error?: string
  /** table: the written row's id; workflow: the queued job id. */
  id?: string
  /** reference: the HTTP status and a bounded excerpt of the response. */
  http_status?: number
  response?: unknown
}

export interface TableChangesSummary {
  field: string
  target: TableChangeTarget
  total: number
  succeeded: number
  failed: number
  skipped: number
  /** Successes per kind. */
  by_kind: Record<TableChangeKind, number>
  results: TableChangeResult[]
  /** "3 rows updated, 1 added, 1 failed". */
  text: string
  dry_run?: boolean
  replayed?: boolean
  stopped?: boolean
}

const VERB: Record<PlannedOp['action'], [string, string]> = {
  insert: ['added', 'added'], update: ['updated', 'updated'], upsert: ['saved', 'saved'], delete: ['deleted', 'deleted'],
  call: ['sent to the API', 'sent to the API'], start: ['started a workflow', 'started workflows'],
}

/** The summary of a run (or a dry run's plan, every op counted as ok). */
export function summarizeTableChanges(config: TableChangesConfig, results: TableChangeResult[], extra: { skipped?: number; dry_run?: boolean; stopped?: boolean } = {}): TableChangesSummary {
  const by_kind: Record<TableChangeKind, number> = { added: 0, updated: 0, deleted: 0 }
  const counts = new Map<PlannedOp['action'], number>()
  let failed = 0
  let skipped = extra.skipped ?? 0
  for (const r of results) {
    if (r.status === 'ok') { by_kind[r.kind]++; counts.set(r.action, (counts.get(r.action) ?? 0) + 1) }
    else if (r.status === 'failed') failed++
    else skipped++
  }
  const parts: string[] = []
  for (const [action, n] of counts) {
    if (action === 'start') parts.push(n === 1 ? (config.per === 'once' ? 'Started a workflow' : '1 row started a workflow') : `${n} rows started workflows`)
    else parts.push(`${n} row${n === 1 ? '' : 's'} ${VERB[action][n === 1 ? 0 : 1]}`)
  }
  if (failed) parts.push(`${failed} failed`)
  if (extra.stopped && results.some((r) => r.status === 'skipped')) parts.push(`${results.filter((r) => r.status === 'skipped').length} not attempted`)
  const text = parts.length ? `${extra.dry_run ? 'Preview: ' : ''}${parts.join(', ')}` : (extra.dry_run ? 'Preview: no rows to process' : 'No table changes to apply')
  const succeeded = results.filter((r) => r.status === 'ok').length
  return {
    field: config.field, target: config.target, total: results.length, succeeded, failed, skipped, by_kind, results, text,
    ...(extra.dry_run ? { dry_run: true } : {}), ...(extra.stopped ? { stopped: true } : {}),
  }
}

/** A dry run: the plan as a summary (nothing is written). */
export function dryRunTableChanges(config: TableChangesConfig, changes: DataTableChangeSet, scope: ChangesScope, columnTypes?: Record<string, DataTableColumnType>): { plan: TableChangesPlan; summary: TableChangesSummary } {
  const plan = planTableChanges(config, changes, scope, columnTypes)
  const results: TableChangeResult[] = plan.ops.map((op) => ({ kind: op.kind, key: op.key, action: op.action, status: 'ok' }))
  return { plan, summary: summarizeTableChanges(config, results, { skipped: plan.skipped, dry_run: true }) }
}

/** One line per planned op (designer dry run). */
export function describePlannedOp(op: PlannedOp, config: TableChangesConfig): string {
  const data = op.data ? Object.entries(op.data).map(([k, v]) => `${k} = ${v === null || v === undefined ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(', ') : ''
  const who = op.key ? `row ${op.key}` : 'new row'
  if (op.action === 'call') return `${who}: call the API with ${data || 'no inputs'}`
  if (op.action === 'start') return config.per === 'once' ? `start the workflow once with ${data || 'no inputs'}` : `${who}: start the workflow with ${data || 'no inputs'}`
  const match = op.match ? ` where ${op.match.column} = ${String(op.match.value ?? '∅')}` : ''
  return `${who}: ${op.action}${match}${data ? ` — ${data}` : ''}`
}

/** Ids of what rules write to / call / start (design-time permission checks). */
export function tableChangesTargets(configs: TableChangesConfig[]): { tables: string[]; references: string[]; workflows: string[] } {
  const tables = new Set<string>(); const references = new Set<string>(); const workflows = new Set<string>()
  for (const c of configs) {
    if (c.target === 'table' && c.table_id) tables.add(c.table_id)
    if (c.target === 'reference' && c.reference_id) references.add(c.reference_id)
    if (c.target === 'workflow' && c.workflow_id) workflows.add(c.workflow_id)
  }
  return { tables: [...tables], references: [...references], workflows: [...workflows] }
}
