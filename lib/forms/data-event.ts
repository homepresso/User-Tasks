/**
 * "Map to data event": where a form's data goes when it is submitted.
 *
 * A form has a DATA EVENT when something it does writes data outside the
 * submission: a rule step that writes a data table or calls an API
 * reference, or that starts a workflow (lib/forms/field-buttons.ts — the
 * server rule actions, minus the read-only table steps); a bar button that
 * starts a workflow, applies table changes or saves to a data target
 * (lib/forms/buttons.ts); a data binding that saves (lib/forms/data-binding.ts);
 * an extension data target (lib/forms/data-target.ts); or a workflow whose
 * "Form submitted" trigger names the form. The designer offers "Map to data
 * event" only while a form has none (formDataEvents).
 *
 * The wizard builds a PLAN — an ordered list of steps, each writing one
 * table or calling one API reference, once for the form or once per item of
 * a repeating section / List — and compiles it into either:
 *
 *  - Write directly (compileDirectRule): one "After submit" rule marked
 *    `server_steps` whose steps run on the server, in plan order, once the
 *    submission is accepted and stored (so a refused submission writes
 *    nothing). A parent step's new
 *    id is kept in a form variable (outputs → var.<step>_id) that later
 *    steps read ({{var.step_1_id}}); a child step runs once per item
 *    (`each_item`, {{row.<field>}} = that item).
 *  - Send to a workflow (lib/forms/data-event-workflow.ts): a draft workflow
 *    started by the form's "Form submitted" trigger, with insert steps and a
 *    loop per repeating section / List.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isServerRuleAction, type FieldButtonAction } from './field-buttons'
import { TABLE_ACTION_TYPES, TABLE_WRITE_ACTIONS } from './data-actions'
import { newRuleId, normalizeFormRules, type FormRule } from './form-rules'
import { normalizeFormButtons, type FormAction } from './buttons'
import { layoutDataBinding } from './data-binding'
import { normalizeDataTarget } from './data-target'
import type { FormVariable } from './form-params'
import { FORM_RULE_LIMITS } from './form-rules'
import { addableColumns, type DataTableColumnType, type DataTableFieldConfig } from './data-table'

/* ── Detection ──────────────────────────────────────────────────────── */

/** Table steps that only read (derived: any new table step that is not a write still counts as a read). */
const TABLE_READ_ACTIONS: ReadonlySet<string> = new Set(TABLE_ACTION_TYPES.filter((t) => !TABLE_WRITE_ACTIONS.has(t)))

/**
 * Does a rule step write data (a table, an API reference) or start a
 * workflow? Every server rule action does (isServerRuleAction — so a new
 * server action kind counts automatically) except the table reads.
 */
export function isDataEventAction(action: Pick<FieldButtonAction, 'type' | 'commit_mode'>): boolean {
  return isServerRuleAction(action) && !TABLE_READ_ACTIONS.has(action.type)
}

/** Bar button actions that write or start a workflow. */
const DATA_EVENT_FORM_ACTIONS: ReadonlySet<FormAction['type']> = new Set(['start_workflow', 'apply_table_changes', 'save_target'])

export function isDataEventFormAction(action: Pick<FormAction, 'type'>): boolean {
  return DATA_EVENT_FORM_ACTIONS.has(action.type)
}

export type DataEventKind = 'rule' | 'button' | 'binding' | 'target' | 'workflow'

export interface FormDataEvent {
  kind: DataEventKind
  /** Plain words: `Rule "Save order" → Create a table row`. */
  label: string
  /** The rule / button / workflow it lives in. */
  id?: string
}

/** A workflow whose Form submitted trigger names the form (forms.get `usages`, or a workflow list). */
export interface BoundWorkflow { workflow_id: string; workflow_name: string; node_type?: string }

const ACTION_WORDS: Partial<Record<string, string>> = {
  call_reference: 'calls an API reference', start_workflow: 'starts a workflow', apply_table_changes: 'applies table changes',
  table_create: 'creates a table row', table_update: 'updates table rows', table_delete: 'deletes a table row', commit_row: 'saves a table row', delete_row: 'deletes a table row',
  save_target: 'saves the record',
}

/** Every action of a list, with question answers and on-success / on-failure steps (any depth the model allows). */
function everyAction(actions: FieldButtonAction[] | undefined): FieldButtonAction[] {
  const out: FieldButtonAction[] = []
  const walk = (list: FieldButtonAction[] | undefined) => {
    for (const a of list ?? []) {
      out.push(a)
      if (a.type === 'prompt') for (const b of a.prompt?.buttons ?? []) walk(b.then)
      walk(a.on_success)
      walk(a.on_failure)
    }
  }
  walk(actions)
  return out
}

/** Rules of the form and of every repeating section's items (item rules may write too). */
function allRules(fields: TaskFieldDef[], layout: unknown): FormRule[] {
  const out: FormRule[] = isPlainObject(layout) ? normalizeFormRules(layout.rules) : []
  const walk = (list: TaskFieldDef[]) => {
    for (const f of list) {
      if (f.type !== 'repeating_section' || !f.repeating_section) continue
      out.push(...normalizeFormRules(f.repeating_section.layout?.rules))
      walk(f.repeating_section.fields ?? [])
    }
  }
  walk(fields)
  return out
}

/**
 * The form's data events (empty: none — the designer offers "Map to data
 * event"). `boundWorkflows`: workflows started by its Form submitted
 * trigger (only `form_submitted` usages count).
 */
export function formDataEvents(def: { fields: TaskFieldDef[]; layout?: unknown; buttons?: unknown }, options: { boundWorkflows?: BoundWorkflow[] | null } = {}): FormDataEvent[] {
  const out: FormDataEvent[] = []
  const fields = Array.isArray(def.fields) ? def.fields : []
  for (const rule of allRules(fields, def.layout)) {
    if (rule.disabled) continue
    for (const a of everyAction(rule.then)) {
      if (isDataEventAction(a)) out.push({ kind: 'rule', id: rule.id, label: `Rule "${rule.name || rule.id}" ${ACTION_WORDS[a.type] ?? 'writes data'}` })
    }
  }
  // An in-form Button's own actions (Apply table changes is the only writing one today; checked the same way).
  for (const f of fields) {
    for (const a of everyAction(f.button?.actions)) {
      if (isDataEventAction(a)) out.push({ kind: 'rule', id: `btn_${f.key}`, label: `Button "${f.label || f.key}" ${ACTION_WORDS[a.type] ?? 'writes data'}` })
    }
  }
  for (const b of def.buttons === undefined || def.buttons === null ? [] : normalizeFormButtons(def.buttons)) {
    for (const a of b.actions ?? []) if (isDataEventFormAction(a)) out.push({ kind: 'button', id: b.id, label: `Button "${b.label}" ${ACTION_WORDS[a.type] ?? 'writes data'}` })
  }
  const layout = isPlainObject(def.layout) ? def.layout : {}
  const binding = layoutDataBinding(layout)
  if (binding?.save) out.push({ kind: 'binding', label: `Data binding saves to ${binding.label ? `"${binding.label}"` : 'a data table'}` })
  const target = normalizeDataTarget(layout.data_target)
  if (target) out.push({ kind: 'target', label: `Saves to ${target.label ? `"${target.label}"` : 'an external record'}` })
  for (const w of options.boundWorkflows ?? []) {
    if (w.node_type && w.node_type !== 'form_submitted') continue
    if (out.some((e) => e.kind === 'workflow' && e.id === w.workflow_id)) continue
    out.push({ kind: 'workflow', id: w.workflow_id, label: `Workflow "${w.workflow_name}" starts when the form is submitted` })
  }
  return out
}

export function hasDataEvent(def: { fields: TaskFieldDef[]; layout?: unknown; buttons?: unknown }, options: { boundWorkflows?: BoundWorkflow[] | null } = {}): boolean {
  return formDataEvents(def, options).length > 0
}

/* ── Sources: the form and its repeating parts ──────────────────────── */

export interface DataEventField {
  key: string
  label: string
  /** A form field type (lib/task-field-schema.ts), or a List column's type. */
  type: string
  required: boolean
  options?: string[]
}

export interface DataEventSource {
  /** '' = the form itself; else the repeating section / List / Data table key (nested: its own key). */
  key: string
  label: string
  /** grid: an editable (or Select mode) Data table control — its rows are the items. */
  kind: 'form' | 'list' | 'repeating_section' | 'grid'
  /** grid: which rows are the items — the rows the person added (edit mode) or the selected rows (select mode). */
  rows?: 'added' | 'selected'
  fields: DataEventField[]
  /** The source holding it ('' = the form; null for the form itself). */
  parent: string | null
  /** 0 = the form, 1 = a top-level section / List, 2+ = nested. */
  depth: number
}

/** Types that hold no writable value. */
const SKIPPED_TYPES = new Set(['data_table', 'custom', 'list', 'repeating_section', 'button', 'heading', 'divider', 'display_image', 'matrix'])

function fieldOf(f: { key: string; label?: string; type: string; required?: boolean; options?: string[] }): DataEventField {
  return { key: f.key, label: f.label || f.key, type: f.type, required: f.required === true, ...(f.options?.length ? { options: f.options.slice(0, 200) } : {}) }
}

/** A Data table column's type as the form field type it fits like (choice → choice, the rest by name). */
const GRID_COLUMN_FIELD: Record<DataTableColumnType, string> = { text: 'text', number: 'number', date: 'date', datetime: 'datetime', choice: 'choice', boolean: 'boolean' }

/** The fields a grid's rows carry: the columns a person fills in when adding a row (edit), or every fetched column (select). */
function gridFields(config: DataTableFieldConfig): DataEventField[] {
  const columns = config.mode === 'edit' ? addableColumns(config) : config.columns
  return columns.filter((c) => /^[a-z0-9_]{1,64}$/i.test(c.key)).map((c) => fieldOf({ key: c.key, label: c.label, type: GRID_COLUMN_FIELD[c.type] ?? 'text', required: config.mode === 'edit' && c.required === true, options: c.options }))
}

/** Is a field a grid whose rows can be child records (an editable table that may add rows, or a Select mode table)? */
export function isGridSource(f: Pick<TaskFieldDef, 'type' | 'data_table' | 'read_only'>): boolean {
  const c = f.type === 'data_table' ? f.data_table : undefined
  return Boolean(c) && !f.read_only && ((c!.mode === 'edit' && c!.allow_add === true) || c!.mode === 'select')
}

/** The form and each repeating section / List / grid (editable Data table; nested ones too), with their fields. */
export function dataEventSources(fields: TaskFieldDef[], formLabel = 'The form'): DataEventSource[] {
  const out: DataEventSource[] = []
  const top = valueFields(Array.isArray(fields) ? fields : [])
  out.push({ key: '', label: formLabel, kind: 'form', parent: null, depth: 0, fields: top.filter((f) => !SKIPPED_TYPES.has(f.type)).map(fieldOf) })
  const listSource = (key: string, label: string, columns: Array<{ key: string; label: string; type: string; required?: boolean; options?: string[]; list?: { columns?: unknown[] } }>, parent: string, depth: number) => {
    out.push({ key, label, kind: 'list', parent, depth, fields: columns.filter((c) => c.type !== 'list').map((c) => fieldOf(c)) })
    for (const c of columns) if (c.type === 'list' && c.list && Array.isArray(c.list.columns)) listSource(c.key, c.label || c.key, c.list.columns as typeof columns, key, depth + 1)
  }
  const walk = (list: TaskFieldDef[], parent: string, depth: number) => {
    for (const f of list) {
      if (f.type === 'list' && f.list) listSource(f.key, f.label || f.key, f.list.columns as Parameters<typeof listSource>[2], parent, depth)
      if (isGridSource(f)) out.push({ key: f.key, label: f.label || f.key, kind: 'grid', rows: f.data_table!.mode === 'select' ? 'selected' : 'added', parent, depth, fields: gridFields(f.data_table!) })
      if (f.type === 'repeating_section' && f.repeating_section) {
        const inner = valueFields(f.repeating_section.fields ?? [])
        out.push({ key: f.key, label: f.label || f.key, kind: 'repeating_section', parent, depth, fields: inner.filter((x) => !SKIPPED_TYPES.has(x.type)).map(fieldOf) })
        walk(inner, f.key, depth + 1)
      }
    }
  }
  walk(top, '', 1)
  return out
}

/** The chain of sources from the form down to `key` (form first). */
export function sourceChain(sources: DataEventSource[], key: string): DataEventSource[] {
  const byKey = new Map(sources.map((s) => [s.key, s]))
  const out: DataEventSource[] = []
  let cur = byKey.get(key)
  const seen = new Set<string>()
  while (cur && !seen.has(cur.key)) {
    seen.add(cur.key)
    out.unshift(cur)
    cur = cur.parent === null ? undefined : byKey.get(cur.parent)
  }
  return out
}

/* ── Targets and type fit ───────────────────────────────────────────── */

export interface DataEventColumn {
  key: string
  label: string
  /** Data table column type (text, longtext, number, date, boolean, select, file, lookup) or a reference input's type. */
  type: string
  required?: boolean
  options?: string[]
  /** lookup columns: the table and column they point at. */
  lookup?: { sourceTableId?: string; sourceColumn?: string }
}

export interface DataEventTarget {
  kind: 'table' | 'reference'
  id: string
  name: string
  columns: DataEventColumn[]
  integration_id?: string
  /** Data tables: their child relations (lib/grid/grouping.ts). */
  child_relations?: Array<{ table_id: string; lookup_column: string }>
  /** References: does it write (POST / PUT / PATCH / DELETE)? */
  writes?: boolean
  /** A table the wizard will create (not saved yet). */
  new_table?: boolean
}

export type FitLevel = 'ok' | 'warn' | 'bad'
export interface Fit { level: FitLevel; note?: string }

const NUMERIC_FIELDS = new Set(['number', 'currency', 'calculated', 'rating', 'nps', 'slider', 'csat'])
const TEXT_FIELDS = new Set(['text', 'textarea', 'email', 'phone', 'url', 'rich_text', 'label', 'lookup', 'user', 'choice', 'likert', 'yes_no_maybe', 'image_choice'])
const DATE_FIELDS = new Set(['date', 'datetime'])
const FILE_FIELDS = new Set(['attachments', 'image', 'signature'])
const MULTI_FIELDS = new Set(['multi_choice', 'text_list', 'ranking'])

/** System columns a write never sets. */
export const SYSTEM_COLUMNS: ReadonlySet<string> = new Set(['id', 'date_created', 'row_id', 'created_at', 'updated_at', 'created_by'])

/** How well a form field's value fits a column (or a reference input). */
export function fieldColumnFit(fieldType: string, columnType: string): Fit {
  const col = columnType.toLowerCase()
  switch (col) {
    case 'number': case 'integer': case 'float': case 'decimal':
      if (NUMERIC_FIELDS.has(fieldType)) return { level: 'ok' }
      if (fieldType === 'text' || fieldType === 'choice' || fieldType === 'label') return { level: 'warn', note: 'Must hold a number' }
      return { level: 'bad', note: 'A number column cannot hold this value' }
    case 'date': case 'datetime':
      if (DATE_FIELDS.has(fieldType)) return { level: 'ok' }
      if (fieldType === 'text' || fieldType === 'label') return { level: 'warn', note: 'Must hold a date' }
      return { level: 'bad', note: 'A date column cannot hold this value' }
    case 'boolean':
      if (fieldType === 'boolean') return { level: 'ok' }
      if (fieldType === 'choice' || fieldType === 'yes_no_maybe' || fieldType === 'text') return { level: 'warn', note: 'Must hold yes / no' }
      return { level: 'bad', note: 'A yes / no column cannot hold this value' }
    case 'select':
      if (fieldType === 'choice' || fieldType === 'likert' || fieldType === 'yes_no_maybe' || fieldType === 'image_choice') return { level: 'ok' }
      if (fieldType === 'text' || MULTI_FIELDS.has(fieldType) || fieldType === 'label') return { level: 'warn', note: 'Must be one of the column\'s options' }
      return { level: 'bad', note: 'A choice column cannot hold this value' }
    case 'file':
      if (FILE_FIELDS.has(fieldType)) return { level: 'ok' }
      return { level: 'bad', note: 'A file column holds files only' }
    case 'lookup':
      if (fieldType === 'lookup') return { level: 'ok' }
      return { level: 'warn', note: 'Must hold the value of the looked-up row' }
    case 'text': case 'longtext': case 'string':
    default:
      if (TEXT_FIELDS.has(fieldType) || NUMERIC_FIELDS.has(fieldType) || DATE_FIELDS.has(fieldType) || fieldType === 'boolean') return { level: 'ok' }
      if (MULTI_FIELDS.has(fieldType)) return { level: 'warn', note: 'Several values are stored as one text' }
      if (FILE_FIELDS.has(fieldType)) return { level: 'warn', note: 'The file details are stored as text' }
      return { level: 'warn', note: 'Stored as text' }
  }
}

/** The column type a new table gets for a form field (user → text, file fields → file …). */
export function columnTypeFor(fieldType: string): string {
  if (NUMERIC_FIELDS.has(fieldType)) return 'number'
  if (DATE_FIELDS.has(fieldType)) return 'date'
  if (fieldType === 'boolean') return 'boolean'
  if (fieldType === 'choice') return 'select'
  if (FILE_FIELDS.has(fieldType)) return 'file'
  if (fieldType === 'textarea' || fieldType === 'rich_text') return 'longtext'
  return 'text'
}

/* ── The plan ───────────────────────────────────────────────────────── */

/** What a column / input gets: a form field, the new id of an earlier step, or a fixed value. */
export type DataEventValue =
  | { kind: 'field'; key: string }
  | { kind: 'parent'; step: string; path?: string }
  | { kind: 'text'; value: string }

export interface DataEventStep {
  /** `step_1`… (also names the id it outputs: step_1_id). */
  id: string
  target: { kind: 'table' | 'reference'; id: string; name: string; integration_id?: string; new_table?: boolean }
  /** '' = once for the form; else the repeating section / List key — once per item. */
  source: string
  /** Column key (table) / input name (reference) → value. */
  map: Record<string, DataEventValue>
  /** reference: the response path holding the new record's id (default `id`). */
  id_path?: string
}

export type DataEventDestination = 'direct' | 'workflow'

export interface DataEventPlan {
  destination: DataEventDestination
  steps: DataEventStep[]
  /** direct: people who fill in the form write without data permissions of their own (the author allows it). */
  open_access?: boolean
  /** workflow: the workflow's name. */
  workflow_name?: string
}

export const DATA_EVENT_LIMITS = { steps: FORM_RULE_LIMITS.actions, workflowSteps: 30, text: 500 } as const

const STEP_ID_RE = /^step_[0-9]{1,3}$/

/** A free step id. */
export function newStepId(steps: Pick<DataEventStep, 'id'>[]): string {
  const taken = new Set(steps.map((s) => s.id))
  for (let i = 1; ; i++) if (!taken.has(`step_${i}`)) return `step_${i}`
}

/** The id path a parent step outputs by default (a table's new row id; a reference's `id`). */
export function defaultIdPath(step: Pick<DataEventStep, 'target' | 'id_path'>): string {
  return step.target.kind === 'table' ? 'row_id' : (step.id_path?.trim() || 'id')
}

/** Words a reference's name often starts with that say what it does, not what it makes ("Create CRM deal" → crm_deal). */
const VERB_WORDS = new Set(['create', 'add', 'new', 'post', 'insert', 'save', 'make', 'call', 'send', 'submit', 'upsert', 'write'])

/** A target's name as a variable stem, the way a person names it: "Orders" → order, "Order lines" → order_line, "Create CRM deal" → crm_deal. */
export function nameStem(name: string): string {
  let words = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length > 1 && VERB_WORDS.has(words[0])) words = words.slice(1)
  if (words.length) {
    const last = words[words.length - 1]
    // A plural table name reads as one record: orders → order, entries → entry (not "status", "address").
    if (/ies$/.test(last) && last.length > 4) words[words.length - 1] = `${last.slice(0, -3)}y`
    else if (/[^su]s$/.test(last) && last.length > 3) words[words.length - 1] = last.slice(0, -1)
  }
  const stem = words.join('_').replace(/^[^a-z]+/, '').slice(0, 28).replace(/_+$/, '')
  return stem || 'record'
}

/** Each step's variable stem, unique in the plan (order, order_line; a second step on Orders → order_2). */
export function stepStems(steps: Pick<DataEventStep, 'id' | 'target'>[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()
  for (const s of steps) {
    const base = nameStem(s.target.name)
    let stem = base
    for (let i = 2; used.has(stem); i++) stem = `${base}_${i}`
    used.add(stem)
    out.set(s.id, stem)
  }
  return out
}

/** The variable that holds a step's output at `path` (order_id; order_id_number for row.id_number). */
export function stepVariable(stem: string, path: string): string {
  if (path === 'row_id' || path === 'id') return `${stem}_id`
  const slug = path.replace(/^row\./, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
  // A column called "id" (not the row's own id, which is <stem>_id): order_column_id.
  return `${stem}_${slug === 'id' ? 'column_id' : slug || 'value'}`
}

/** The variable a parent step's id at `path` is kept in: its default id → order_id (stems: stepStems of the plan; without, the step id). */
export function idVariable(step: Pick<DataEventStep, 'id' | 'target' | 'id_path'>, path: string, stems?: ReadonlyMap<string, string>): string {
  const stem = stems?.get(step.id) ?? step.id
  return path === defaultIdPath(step) ? `${stem}_id` : stepVariable(stem, path)
}

/** A clean plan (unknown shapes dropped; the wizard's and the API's input). */
export function normalizeDataEventPlan(raw: unknown): DataEventPlan {
  const r = isPlainObject(raw) ? raw : {}
  const destination: DataEventDestination = r.destination === 'workflow' ? 'workflow' : 'direct'
  const steps: DataEventStep[] = []
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (!isPlainObject(s) || !isPlainObject(s.target)) continue
    if (steps.length >= DATA_EVENT_LIMITS.workflowSteps) break
    const kind = s.target.kind === 'reference' ? 'reference' : s.target.kind === 'table' ? 'table' : null
    const id = typeof s.id === 'string' && STEP_ID_RE.test(s.id) && !steps.some((x) => x.id === s.id) ? s.id : newStepId(steps)
    const targetId = typeof s.target.id === 'string' ? s.target.id.slice(0, 80) : ''
    if (!kind || !targetId) continue
    const map: Record<string, DataEventValue> = {}
    if (isPlainObject(s.map)) {
      for (const [k, v] of Object.entries(s.map).slice(0, 100)) {
        if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(k) || !isPlainObject(v)) continue
        if (v.kind === 'field' && typeof v.key === 'string' && /^[a-z0-9_]{1,64}$/i.test(v.key)) map[k] = { kind: 'field', key: v.key }
        else if (v.kind === 'parent' && typeof v.step === 'string' && STEP_ID_RE.test(v.step)) map[k] = { kind: 'parent', step: v.step, ...(typeof v.path === 'string' && /^[A-Za-z0-9_.[\]-]{1,100}$/.test(v.path) ? { path: v.path } : {}) }
        else if (v.kind === 'text' && typeof v.value === 'string') map[k] = { kind: 'text', value: v.value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, DATA_EVENT_LIMITS.text) }
      }
    }
    const step: DataEventStep = {
      id,
      target: {
        kind, id: targetId, name: typeof s.target.name === 'string' && s.target.name.trim() ? s.target.name.trim().slice(0, 120) : kind === 'table' ? 'Data table' : 'API reference',
        ...(typeof s.target.integration_id === 'string' && s.target.integration_id ? { integration_id: s.target.integration_id.slice(0, 80) } : {}),
        ...(s.target.new_table === true ? { new_table: true } : {}),
      },
      source: typeof s.source === 'string' && /^[a-z0-9_]{0,64}$/i.test(s.source) ? s.source : '',
      map,
    }
    if (kind === 'reference' && typeof s.id_path === 'string' && /^[A-Za-z0-9_.[\]-]{1,100}$/.test(s.id_path)) step.id_path = s.id_path
    steps.push(step)
  }
  const out: DataEventPlan = { destination, steps }
  if (r.open_access === true && destination === 'direct') out.open_access = true
  if (typeof r.workflow_name === 'string' && r.workflow_name.trim()) out.workflow_name = r.workflow_name.trim().slice(0, 120)
  return out
}

/* ── Auto-mapping ───────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')

function matchScore(field: DataEventField, column: DataEventColumn): number {
  const fk = norm(field.key)
  const fl = norm(field.label)
  const ck = norm(column.key)
  const cl = norm(column.label)
  if (!fk && !fl) return 0
  if (fk === ck || (fl && fl === cl)) return 3
  if ((fk && fk === cl) || (fl && fl === ck)) return 2.5
  const long = (a: string, b: string) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))
  if (long(fk, ck) || long(fl, cl) || long(fk, cl) || long(fl, ck)) return 1
  return 0
}

/**
 * Columns → fields by matching names / labels (exact before partial; each
 * field and column used once; a value that cannot fit the column is never
 * suggested). Columns already mapped in `existing` are kept.
 */
export function autoMap(fields: DataEventField[], columns: DataEventColumn[], existing: Record<string, DataEventValue> = {}): Record<string, DataEventValue> {
  const out: Record<string, DataEventValue> = { ...existing }
  const usedFields = new Set(Object.values(existing).flatMap((v) => (v.kind === 'field' ? [v.key] : [])))
  const pairs: Array<{ field: DataEventField; column: DataEventColumn; score: number }> = []
  for (const column of columns) {
    if (SYSTEM_COLUMNS.has(column.key) || column.key in out) continue
    for (const field of fields) {
      const score = matchScore(field, column)
      const fit = fieldColumnFit(field.type, column.type).level
      // A lookup column links a row: only a lookup field is suggested for it (the parent link is set apart).
      if (score && fit !== 'bad' && (column.type !== 'lookup' || fit === 'ok')) pairs.push({ field, column, score: score + (fieldColumnFit(field.type, column.type).level === 'ok' ? 0.1 : 0) })
    }
  }
  pairs.sort((a, b) => b.score - a.score)
  for (const p of pairs) {
    if (p.column.key in out || usedFields.has(p.field.key)) continue
    out[p.column.key] = { kind: 'field', key: p.field.key }
    usedFields.add(p.field.key)
  }
  return out
}

/** The parent link path a lookup column needs: the parent row's id, or the column it looks up. */
function lookupPath(column: DataEventColumn, parent: DataEventTarget | undefined): string {
  const source = (column.lookup?.sourceColumn ?? '').trim()
  if (!source || /^(row_?id|_row_id)$/i.test(source)) return 'row_id'
  if (/^id$/i.test(source)) return 'row.id'
  const match = parent?.columns.find((c) => c.key === source || c.label.toLowerCase() === source.toLowerCase())
  return `row.${match?.key ?? source}`
}

/** The id path a column linking to `parent` reads: a lookup column's looked-up column, else the parent's id. */
export function parentPath(column: DataEventColumn | undefined, parent: DataEventStep, targets: DataEventTarget[]): string {
  if (column?.type === 'lookup' && parent.target.kind === 'table') return lookupPath(column, targets.find((t) => t.kind === 'table' && t.id === parent.target.id))
  return defaultIdPath(parent)
}

/**
 * Link a child step to its parent step: a lookup column of the child table
 * that points at the parent's table (or the parent table's child relation),
 * else a column named like `parent_row_id` / `<parent>_id`. Returns the map
 * with the link set (unchanged when nothing fits or a link is already set).
 */
export function suggestParentLink(step: DataEventStep, parent: DataEventStep, targets: DataEventTarget[]): Record<string, DataEventValue> {
  if (Object.values(step.map).some((v) => v.kind === 'parent')) return step.map
  const child = targets.find((t) => t.kind === step.target.kind && t.id === step.target.id)
  const parentTarget = targets.find((t) => t.kind === parent.target.kind && t.id === parent.target.id)
  if (!child) return step.map
  const free = child.columns.filter((c) => !SYSTEM_COLUMNS.has(c.key) && !(c.key in step.map))
  if (parent.target.kind === 'table') {
    const relation = parentTarget?.child_relations?.find((r) => r.table_id === child.id)
    const viaRelation = relation ? free.find((c) => c.key === relation.lookup_column) : undefined
    const lookup = viaRelation ?? free.find((c) => c.type === 'lookup' && c.lookup?.sourceTableId === parent.target.id)
    if (lookup) return { ...step.map, [lookup.key]: { kind: 'parent', step: parent.id, path: lookupPath(lookup, parentTarget) } }
  }
  const slug = norm(parent.target.name)
  const named = free.find((c) => ['parentrowid', 'parentid', 'parent', 'parentrow', `${slug}id`, `${slug}rowid`].includes(norm(c.key)) || ['parentrowid', 'parentid', 'parentrow', `${slug}id`].includes(norm(c.label)))
  if (named) return { ...step.map, [named.key]: { kind: 'parent', step: parent.id, path: defaultIdPath(parent) } }
  return step.map
}

/* ── Order ──────────────────────────────────────────────────────────── */

/** Steps a step reads the id of. */
export function stepDependencies(step: DataEventStep): string[] {
  return [...new Set(Object.values(step.map).flatMap((v) => (v.kind === 'parent' ? [v.step] : [])))]
}

/**
 * The steps in a runnable order: every step after the steps whose ids it
 * reads and after steps of its source's parent (the form before its items,
 * an item before its nested items) — otherwise the current order is kept.
 */
export function autoOrder(steps: DataEventStep[], sources: DataEventSource[]): DataEventStep[] {
  const depth = new Map(sources.map((s) => [s.key, s.depth]))
  const byId = new Map(steps.map((s) => [s.id, s]))
  const done = new Set<string>()
  const out: DataEventStep[] = []
  const visiting = new Set<string>()
  const visit = (s: DataEventStep) => {
    if (done.has(s.id) || visiting.has(s.id)) return
    visiting.add(s.id)
    for (const dep of stepDependencies(s)) { const d = byId.get(dep); if (d) visit(d) }
    visiting.delete(s.id)
    done.add(s.id)
    out.push(s)
  }
  // Shallower sources first (stable), then dependencies pull their parents ahead.
  const sorted = steps.map((s, i) => ({ s, i })).sort((a, b) => (depth.get(a.s.source) ?? 0) - (depth.get(b.s.source) ?? 0) || a.i - b.i).map((x) => x.s)
  for (const s of sorted) visit(s)
  return out
}

/** Move a step up (-1) / down (+1). */
export function moveStep(steps: DataEventStep[], id: string, delta: -1 | 1): DataEventStep[] {
  const i = steps.findIndex((s) => s.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= steps.length) return steps
  const out = [...steps]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Which step feeds which: `step_1 (Orders) id → step_2.order` lines for the order screen. */
export function idFeeds(steps: DataEventStep[]): Array<{ from: string; to: string; column: string; path: string }> {
  const out: Array<{ from: string; to: string; column: string; path: string }> = []
  for (const s of steps) {
    for (const [column, v] of Object.entries(s.map)) {
      if (v.kind !== 'parent') continue
      const parent = steps.find((p) => p.id === v.step)
      out.push({ from: v.step, to: s.id, column, path: v.path ?? (parent ? defaultIdPath(parent) : 'row_id') })
    }
  }
  return out
}

/* ── Problems ───────────────────────────────────────────────────────── */

export interface DataEventProblem {
  step?: string
  column?: string
  severity: 'error' | 'warning'
  message: string
}

/** What stops (errors) or deserves a look (warnings) before the plan is created. */
export function planProblems(plan: DataEventPlan, sources: DataEventSource[], targets: DataEventTarget[]): DataEventProblem[] {
  const out: DataEventProblem[] = []
  const err = (message: string, step?: string, column?: string) => out.push({ severity: 'error', message, ...(step ? { step } : {}), ...(column ? { column } : {}) })
  const warn = (message: string, step?: string, column?: string) => out.push({ severity: 'warning', message, ...(step ? { step } : {}), ...(column ? { column } : {}) })
  if (!plan.steps.length) { err('Pick at least one table or API reference'); return out }
  if (plan.destination === 'direct' && plan.steps.length > DATA_EVENT_LIMITS.steps) err(`A rule runs at most ${DATA_EVENT_LIMITS.steps} steps: send the data to a workflow instead`)
  const bySource = new Map(sources.map((s) => [s.key, s]))
  const seen = new Set<string>()
  for (const step of plan.steps) {
    const name = step.target.name
    const source = bySource.get(step.source)
    if (!source) { err(`${name}: "${step.source}" is not a repeating section or List of this form`, step.id); seen.add(step.id); continue }
    if (plan.destination === 'direct' && source.depth > 1) err(`${name}: "${source.label}" sits inside "${bySource.get(source.parent ?? '')?.label ?? 'another item'}", and a rule can't link each nested item to its own parent item — choose "Send to a workflow" instead (it loops over the items and links each one)`, step.id)
    const target = targets.find((t) => t.kind === step.target.kind && t.id === step.target.id)
    if (!target && !step.target.new_table) err(`${name}: the ${step.target.kind === 'table' ? 'data table' : 'API reference'} was not found`, step.id)
    const allowed = new Map<string, DataEventField>()
    for (const f of bySource.get('')?.fields ?? []) allowed.set(f.key, f)
    for (const f of source.fields) allowed.set(f.key, f)
    const columns = new Map((target?.columns ?? []).map((c) => [c.key, c]))
    for (const [col, v] of Object.entries(step.map)) {
      const column = columns.get(col)
      if (target && !column && !target.new_table) { err(`${name}: "${col}" is not a ${step.target.kind === 'table' ? 'column' : 'input'} of it`, step.id, col); continue }
      if (v.kind === 'field') {
        const field = allowed.get(v.key)
        if (!field) { err(`${name}: "${v.key}" is not a field of ${source.depth ? `"${source.label}" or ` : ''}the form`, step.id, col); continue }
        if (column) {
          const fit = fieldColumnFit(field.type, column.type)
          if (fit.level === 'bad') err(`${name}: ${field.label} → ${column.label}: ${fit.note}`, step.id, col)
          else if (fit.level === 'warn') warn(`${name}: ${field.label} → ${column.label}: ${fit.note}`, step.id, col)
        }
      } else if (v.kind === 'parent') {
        const parent = plan.steps.find((p) => p.id === v.step)
        if (!parent) err(`${name}: the step whose id it reads is gone`, step.id, col)
        else if (!seen.has(parent.id)) err(`${name} must run after ${parent.target.name} (it reads that record's id)`, step.id, col)
        else {
          const chain = sourceChain(sources, step.source).map((s) => s.key)
          if (!chain.includes(parent.source)) err(`${name}: ${parent.target.name} runs for "${bySource.get(parent.source)?.label ?? parent.source}", which does not hold "${source.label}"`, step.id, col)
          // A rule keeps ONE id per step (its variable): a per-item step's id is only the last item's by the time a later step reads it.
          else if (plan.destination === 'direct' && parent.source) err(`${name}: ${parent.target.name} runs once for each item of "${bySource.get(parent.source)?.label ?? parent.source}", and a rule keeps only the last item's id — choose "Send to a workflow" to link each item to its own record`, step.id, col)
        }
      }
    }
    for (const c of target?.columns ?? []) {
      if (c.required && !SYSTEM_COLUMNS.has(c.key) && !(c.key in step.map)) warn(`${name}: required ${step.target.kind === 'table' ? 'column' : 'input'} "${c.label}" has no value`, step.id, c.key)
    }
    if (!Object.keys(step.map).length) warn(`${name}: nothing is mapped yet`, step.id)
    // A child step linked to nothing: its rows will not point at the parent record.
    if (source.depth > 0 && !Object.values(step.map).some((v) => v.kind === 'parent') && plan.steps.some((p) => seen.has(p.id) && sourceChain(sources, step.source).some((s) => s.key === p.source && s.key !== step.source))) {
      warn(`${name}: each item is written without a link to its parent record`, step.id)
    }
    seen.add(step.id)
  }
  return out
}

export function hasErrors(problems: DataEventProblem[]): boolean {
  return problems.some((p) => p.severity === 'error')
}

/* ── Option 1: write directly (an After submit server_steps rule) ────────────────── */

export interface DirectRuleResult {
  rule: FormRule
  /** Form variables the rule outputs parent ids into (to add to layout.variables). */
  variables: FormVariable[]
}

/** The parent links the plan reads: step → paths (each becomes an output into a variable). */
function neededOutputs(plan: DataEventPlan): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const s of plan.steps) {
    for (const v of Object.values(s.map)) {
      if (v.kind !== 'parent') continue
      const parent = plan.steps.find((p) => p.id === v.step)
      if (!parent) continue
      const path = v.path ?? defaultIdPath(parent)
      out.set(v.step, (out.get(v.step) ?? new Set()).add(path))
    }
  }
  return out
}

/** Variable names (order_id, order_line_id…), kept clear of names the form already declares. */
function variableNames(plan: DataEventPlan, taken: Iterable<string>): Map<string, string> {
  const used = new Set(taken)
  const out = new Map<string, string>()
  const stems = stepStems(plan.steps)
  for (const [step, paths] of neededOutputs(plan)) {
    const s = plan.steps.find((p) => p.id === step)!
    for (const path of paths) {
      const base = idVariable(s, path, stems).slice(0, 38)
      let name = base
      for (let i = 2; used.has(name); i++) name = `${base}_${i}`.slice(0, 40)
      used.add(name)
      out.set(`${step}:${path}`, name)
    }
  }
  return out
}

/** "for each item of Order lines" / "for each row added to Parts" / "for each row selected in Products". */
export function itemWords(source: Pick<DataEventSource, 'label' | 'kind' | 'rows'> | undefined, fallback = ''): string {
  const label = source?.label ?? fallback
  if (source?.kind === 'grid') return `for each row ${source.rows === 'selected' ? 'selected in' : 'added to'} ${label}`
  return `for each item of ${label}`
}

/**
 * The plan as one "After submit" `server_steps` rule (steps in plan order, on the server after the submission is stored). Field values
 * read the form ({{form.<key>}}) or, in a per-item step, the item
 * ({{row.<key>}}); a parent's id comes from the variable its step output it
 * into ({{var.step_1_id}}).
 */
export function compileDirectRule(plan: DataEventPlan, sources: DataEventSource[], context: { ruleIds?: Iterable<string>; variables?: Iterable<string>; formName?: string } = {}): DirectRuleResult {
  const bySource = new Map(sources.map((s) => [s.key, s]))
  const names = variableNames(plan, context.variables ?? [])
  const outputs = neededOutputs(plan)
  const template = (step: DataEventStep, v: DataEventValue): string => {
    if (v.kind === 'text') return v.value
    if (v.kind === 'parent') {
      const parent = plan.steps.find((p) => p.id === v.step)
      return `{{var.${names.get(`${v.step}:${v.path ?? (parent ? defaultIdPath(parent) : 'row_id')}`) ?? `${v.step}_id`}}}`
    }
    const own = step.source ? bySource.get(step.source)?.fields.some((f) => f.key === v.key) : false
    return own ? `{{row.${v.key}}}` : `{{form.${v.key}}}`
  }
  const writes: FieldButtonAction[] = plan.steps.map((step) => {
    const values = Object.fromEntries(Object.entries(step.map).map(([k, v]) => [k, template(step, v)]))
    const outs = [...(outputs.get(step.id) ?? [])].map((path) => ({ path, to: `var.${names.get(`${step.id}:${path}`)}` }))
    const each = step.source ? { each_item: step.source } : {}
    if (step.target.kind === 'table') {
      return {
        type: 'table_create', table_id: step.target.id, table_name: step.target.name, column_values: values, ...each,
        ...(plan.open_access ? { open_access: true } : {}), ...(outs.length ? { outputs: outs } : {}),
      } satisfies FieldButtonAction
    }
    return {
      type: 'call_reference', reference_id: step.target.id, ...(step.target.integration_id ? { integration_id: step.target.integration_id } : {}),
      inputs: values, ...each, ...(outs.length ? { outputs: outs } : {}),
    } satisfies FieldButtonAction
  })
  // After submit, on the server (server_steps): the writes run only once the submission is accepted and stored,
  // with the stored values — a submission the browser or the server refuses writes nothing.
  const then: FieldButtonAction[] = writes
  const targets = [...new Set(plan.steps.map((s) => s.target.name))]
  const name = `Save to ${targets.join(', ')}`.slice(0, FORM_RULE_LIMITS.name)
  const rule: FormRule = {
    id: newRuleId(context.ruleIds ?? []),
    name,
    description: `Made by "Map to data event"${context.formName ? ` for "${context.formName}"` : ''}: once a submission is accepted, ${plan.steps.map((s, i) => `${i + 1}. ${s.target.kind === 'table' ? 'adds a row to' : 'calls'} ${s.target.name}${s.source ? ` ${itemWords(bySource.get(s.source), s.source)}` : ''}`).join('; ')}.`,
    event: 'after_submit',
    server_steps: true,
    then,
  }
  const variables: FormVariable[] = []
  for (const [step, paths] of outputs) {
    const s = plan.steps.find((p) => p.id === step)
    for (const path of paths) variables.push({ name: names.get(`${step}:${path}`)!, label: `${s?.target.name ?? step} ${path === 'row_id' || path === 'id' ? 'id' : path.replace(/^row\./, '')}`.slice(0, 80), type: 'text' })
  }
  return { rule, variables }
}

/* ── Proposing a new table from the form ────────────────────────────── */

export interface ProposedColumn { key: string; name: string; type: string; options?: string[] }
export interface ProposedTable { source: string; name: string; columns: ProposedColumn[] }

/** The column key a child table links to its parent row with. */
export const PARENT_LINK_COLUMN = 'parent_row_id'

/** A table for a source's fields (a child source also gets `parent_row_id`). */
export function proposeTable(source: DataEventSource, formName: string): ProposedTable {
  const columns: ProposedColumn[] = []
  if (source.depth > 0) columns.push({ key: PARENT_LINK_COLUMN, name: 'Parent row', type: 'text' })
  const names = new Set(columns.map((c) => c.name.toLowerCase()))
  for (const f of source.fields) {
    if (SYSTEM_COLUMNS.has(f.key) || f.key === PARENT_LINK_COLUMN) continue
    let name = f.label.slice(0, 90) || f.key
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${f.label.slice(0, 85)} (${i})`
    names.add(name.toLowerCase())
    const type = columnTypeFor(f.type)
    columns.push({ key: f.key, name, type, ...(type === 'select' && f.options?.length ? { options: f.options } : {}) })
  }
  return { source: source.key, name: (source.depth ? `${formName} — ${source.label}` : `${formName} submissions`).slice(0, 120), columns }
}

/** A proposed table as a target (columns typed; `new:<source>` until it is created). */
export function proposedTarget(table: ProposedTable): DataEventTarget {
  return { kind: 'table', id: `new:${table.source || 'form'}`, name: table.name, new_table: true, columns: table.columns.map((c) => ({ key: c.key, label: c.name, type: c.type, ...(c.options ? { options: c.options } : {}) })) }
}

/** The step a proposed table gets: every field mapped to its own column, a child linked to `parentStep`. */
export function proposedStep(table: ProposedTable, source: DataEventSource, id: string, parentStep?: DataEventStep): DataEventStep {
  const map: Record<string, DataEventValue> = {}
  for (const c of table.columns) {
    if (c.key === PARENT_LINK_COLUMN) { if (parentStep) map[c.key] = { kind: 'parent', step: parentStep.id, path: defaultIdPath(parentStep) }; continue }
    if (source.fields.some((f) => f.key === c.key)) map[c.key] = { kind: 'field', key: c.key }
  }
  return { id, target: { kind: 'table', id: `new:${table.source || 'form'}`, name: table.name, new_table: true }, source: table.source, map }
}
