/**
 * The form designer's variable catalog: every placeholder an input can use,
 * in designer words, for where the input is.
 *
 *   This event            {{event.*}}  (rules: follows the When event and its table)
 *   Controls              {{control.<key>.*}}  ("Orders › Selected row › ID")
 *   Fields on this form   {{key}} / {{form.key}} / {{task_data.key}}  (the input's own style)
 *   Parameters            {{param.*}}
 *   Variables             {{var.*}}
 *   Sections              {{control.<section>.included / visible}}
 *   Current user          {{user.*}}
 *   Dates                 {{today}}, {{now}}, {{today-7d}}…
 *   Flags                 {{state.*}}
 *   Functions             SUM(…), SUMPRODUCT(…), ROUND(…)…  (a Label's expression only)
 *
 * Which groups an input gets follows what its runtime resolves (CONTEXT_GROUPS):
 * a rule's conditions read everything (lib/forms/form-rules.ts ruleValue); its
 * actions read the event, the user and the values (interpolateButtonText with
 * `event` / `user` extras); a Button's steps read the values only, so "This
 * event" is replaced by a note pointing at Controls. `problem()` says why a
 * stored token would come out empty here (wrong event, no such control…);
 * the input underlines it.
 *
 * The paths come from the same functions the runtime uses (eventVariables,
 * controlVariables in lib/forms/rule-variables.ts — tests keep them in step).
 * Pure and isomorphic.
 */

import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { FUNCTION_CATALOG } from '@/lib/expression-functions'
import { LABEL_FUNCTIONS, type LabelFieldConfig } from './label-field'
import type { PickerScope, PickerType, PickerVariable } from '@/lib/variable-picker'
import { legacyPickerEntries } from '@/lib/variable-picker'
import { dataTableKeyColumn, type DataTableFieldConfig } from './data-table'
import { EVENT_TARGET, FORM_RULE_EVENT_LABELS, type FormRuleEventType } from './form-rules'
import { layoutFormParams, layoutFormVariables, type FormVariableType } from './form-params'
import { lookupItemFields, lookupLabelKey, type LookupConfig } from './lookup'
import { controlState, eventVariables, layoutPages, layoutSectionControls, type RuleVariableType } from './rule-variables'

export const FORM_VARIABLE_GROUPS = [
  'This event', 'Controls', 'Fields on this form', 'Parameters', 'Variables', 'Sections', 'Current user', 'Dates', 'Flags',
] as const
export type FormVariableGroup = typeof FORM_VARIABLE_GROUPS[number]

export type FormVariableContext =
  /** A form rule: its When event / target; `condition` (If values) or `action` (Then). */
  | { kind: 'rule'; event: FormRuleEventType; target?: string; slot?: 'condition' | 'action' }
  /** An in-form Button's On click steps (no event). */
  | { kind: 'button' }
  /** Header title / subtitle, heading text. */
  | { kind: 'header' }
  /** A field's default value. */
  | { kind: 'default' }
  /** A bar button's behaviours (after the submission is stored). */
  | { kind: 'bar' }
  /** A Data table's base filter / API mappings; `exclude`: the table itself. */
  | { kind: 'table_query'; exclude?: string }
  /** An autocomplete's filters / API mappings; `exclude`: the autocomplete itself. */
  | { kind: 'lookup_query'; exclude?: string }
  /** "Apply table changes" mappings. */
  | { kind: 'table_changes' }
  /** A dynamic property's expression / source filter and inputs (lib/forms/dynamic-values.ts); `exclude`: the field itself. */
  | { kind: 'dynamic_value'; exclude?: string }
  /** A Label's expression (lib/forms/label-field.ts); `exclude`: the label itself. */
  | { kind: 'expression'; exclude?: string }
  /** The Task completed screen's wording (lib/tasks/completion-screen.ts): its own placeholders only. */
  | { kind: 'task_completed' }

export type FormVariableContextKind = FormVariableContext['kind']

/** The groups each kind of input resolves (the runtime decides; see the file comment). */
export function contextGroups(ctx: FormVariableContext): FormVariableGroup[] {
  switch (ctx.kind) {
    case 'rule': return ctx.slot === 'condition'
      ? [...FORM_VARIABLE_GROUPS]
      : ['This event', 'Controls', 'Fields on this form', 'Parameters', 'Variables', 'Sections', 'Current user']
    case 'button': return ['Controls', 'Fields on this form', 'Parameters', 'Variables', 'Sections']
    case 'header': return ['Fields on this form', 'Parameters', 'Variables']
    case 'bar': return ['Fields on this form', 'Parameters', 'Variables']
    case 'default': return ['Parameters']
    case 'table_query': return ['Controls', 'Fields on this form', 'Parameters', 'Variables', 'Sections', 'Current user', 'Dates']
    case 'lookup_query': return ['Controls', 'Fields on this form', 'Parameters', 'Variables']
    case 'table_changes': return ['Fields on this form', 'Current user', 'Dates']
    case 'dynamic_value': return ['Controls', 'Fields on this form', 'Parameters', 'Variables', 'Sections', 'Current user', 'Dates']
    case 'expression': return ['Fields on this form', 'Controls', 'Parameters', 'Variables', 'Sections']
    case 'task_completed': return []
  }
}

/** How the input writes a field: `{{key}}`, `{{form.key}}` or `{{task_data.key}}`. */
export function fieldPrefix(ctx: FormVariableContext): '' | 'form.' | 'task_data.' {
  return ctx.kind === 'table_query' || ctx.kind === 'table_changes' || ctx.kind === 'dynamic_value' || ctx.kind === 'expression' ? 'form.' : ctx.kind === 'lookup_query' ? 'task_data.' : ''
}

/** What a bar button's behaviours also read, after the submission is stored (lib/forms/buttons.ts). */
export const AFTER_SUBMIT_VARIABLES: Array<{ name: string; group: string; label: string }> = [
  { name: 'run_reference', group: 'After submit', label: 'Reference of the workflow started' },
  { name: 'submission_id', group: 'After submit', label: 'Submission reference' },
  { name: 'table_changes_summary', group: 'After submit', label: 'Summary of the table changes applied' },
]

/* ── Source ──────────────────────────────────────────────────────────── */

interface FieldLike {
  key: string
  label?: string
  type: string
  data_table?: DataTableFieldConfig
  lookup?: LookupConfig
  label_config?: LabelFieldConfig
}

export interface FormVariableSource {
  fields: FieldLike[]
  layout: unknown
  /** The designer's live preview values (samples). */
  values?: Record<string, unknown> | null
  now?: Date
}

const RECENT_KEY = 'ut.forms.recentVariables'
const ROW_EVENT_NOUN: Partial<Record<FormRuleEventType, string>> = {
  row_click: 'Clicked row', row_select: 'Selected row', row_deselect: 'Deselected row', row_double_click: 'Double-clicked row',
  cell_edit: 'Edited row', row_add: 'New row', row_delete: 'Deleted row',
}
const COLUMN_TYPE: Record<string, PickerType> = { text: 'text', number: 'number', date: 'date', datetime: 'date', choice: 'text', boolean: 'boolean' }
const RULE_TYPE: Record<RuleVariableType, PickerType> = { text: 'text', number: 'number', boolean: 'boolean', date: 'date', list: 'list', object: 'row', any: 'value' }
const PARAM_TYPE: Record<FormVariableType, PickerType> = { text: 'text', number: 'number', boolean: 'boolean', date: 'date', text_list: 'list', object: 'row' }

function fieldType(type: string): PickerType {
  if (type === 'number' || type === 'currency' || type === 'rating' || type === 'slider') return 'number'
  if (type === 'date' || type === 'datetime') return 'date'
  if (type === 'boolean') return 'boolean'
  if (type === 'multi_choice' || type === 'data_table' || type === 'attachments' || type === 'text_list') return 'list'
  if (type === 'image' || type === 'signature') return 'row'
  return 'text'
}

const name = (f: FieldLike) => f.label || f.key
const tables = (fields: FieldLike[]) => fields.filter((f) => f.type === 'data_table' && f.data_table)

/** The row event's table: the rule's target, else the form's only Data table. */
function eventTable(ctx: Extract<FormVariableContext, { kind: 'rule' }>, fields: FieldLike[]): FieldLike | undefined {
  if (EVENT_TARGET[ctx.event] !== 'table') return undefined
  const all = tables(fields)
  return (ctx.target ? all.find((f) => f.key === ctx.target) : undefined) ?? (all.length === 1 ? all[0] : undefined)
}

/** A table's row id is its key column: "Order ID" / "OrderID" name it exactly. */
function keySynonyms(table: FieldLike | undefined): string[] {
  if (!table?.data_table) return []
  const key = dataTableKeyColumn(table.data_table)
  const column = table.data_table.columns.find((c) => c.key === key)
  return [...new Set([column?.label, key].filter((n): n is string => Boolean(n)))]
}

/** Search words for a table's row id: the key column's label and key, the table's name. */
function keyWords(table: FieldLike | undefined): string {
  if (!table?.data_table) return 'row id key'
  const key = dataTableKeyColumn(table.data_table)
  const column = table.data_table.columns.find((c) => c.key === key)
  return `row id key ${column?.label ?? ''} ${key} ${name(table)}`
}

function dateIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ── Groups ──────────────────────────────────────────────────────────── */

function eventEntries(ctx: Extract<FormVariableContext, { kind: 'rule' }>, source: FormVariableSource, state: Record<string, Record<string, unknown>>): PickerVariable[] {
  const table = eventTable(ctx, source.fields)
  const vars = eventVariables(ctx.event, table?.key ?? ctx.target, source.fields as never)
  const noun = ROW_EVENT_NOUN[ctx.event]
  const tableState = table ? state[table.key] ?? {} : {}
  const sampleRow = (tableState.selected_row ?? tableState.last_clicked_row ?? undefined) as Record<string, unknown> | null | undefined
  const sampleId = tableState.selected_row_id ?? tableState.last_clicked_row_id ?? undefined
  // What designers look for first: the row's id and the row; the table / field key last.
  const order = (p: string) => (p === 'event.row_id' ? 0 : p === 'event.row' ? 1 : p === 'event.field' ? 3 : 2)
  return [...vars].sort((a, b) => order(a.path) - order(b.path)).map((v): PickerVariable => {
    const base = { path: v.path, group: 'This event', type: RULE_TYPE[v.type] }
    if (noun) {
      if (v.path === 'event.row_id') return { ...base, label: `${noun} › ID`, keywords: keyWords(table), synonyms: keySynonyms(table), hint: table ? `The row's key (${name(table)})` : 'The row\'s key', ...(sampleId != null ? { sample: sampleId } : {}) }
      if (v.path === 'event.row') return { ...base, label: noun, hint: 'The whole row: pick a column, or insert it all' }
      if (v.path.startsWith('event.row.')) {
        const col = table?.data_table?.columns.find((c) => `event.row.${c.key}` === v.path)
        const key = v.path.slice('event.row.'.length)
        return { ...base, label: `${noun} › ${col?.label || key}`, parent: 'event.row', keywords: `${key} ${name(table ?? { key: '', type: '' })}`, ...(sampleRow && key in sampleRow ? { sample: sampleRow[key] } : {}) }
      }
      if (v.path === 'event.field') return { ...base, label: 'Data table (key)', ...(table ? { sample: table.key } : {}) }
      if (v.path === 'event.column') return { ...base, label: 'Clicked column (key)' }
      if (v.path === 'event.selected') return { ...base, label: `${noun} › Is selected` }
    }
    if (ctx.event === 'item_select') {
      if (v.path === 'event.item') return { ...base, label: 'Chosen item', hint: 'The whole item: pick a field, or insert it all' }
      if (v.path.startsWith('event.item.')) return { ...base, label: `Chosen item › ${v.path.slice('event.item.'.length)}`, parent: 'event.item' }
      if (v.path === 'event.value') return { ...base, label: 'Chosen item › Stored value' }
      if (v.path === 'event.label') return { ...base, label: 'Chosen item › Display label' }
    }
    return { ...base, label: v.label }
  })
}

function controlEntries(source: FormVariableSource, state: Record<string, Record<string, unknown>>, exclude?: string, expression = false): PickerVariable[] {
  const out: PickerVariable[] = []
  const g = 'Controls'
  const at = (key: string, path: string): unknown => {
    let cur: unknown = state[key]
    for (const seg of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined
    return cur
  }
  const add = (key: string, path: string, label: string, type: PickerType, extra: Partial<PickerVariable> = {}) => {
    const sample = at(key, path)
    out.push({ path: `control.${key}.${path}`, label, group: g, type, ...(sample !== undefined && sample !== null && typeof sample !== 'object' ? { sample } : {}), ...extra })
  }
  for (const f of source.fields) {
    if (f.key === exclude) continue
    const n = name(f)
    if (f.type === 'data_table' && f.data_table) {
      const cols = f.data_table.columns ?? []
      const kw = keyWords(f)
      add(f.key, 'selected_row_id', `${n} › Selected row › ID`, 'text', { keywords: kw, synonyms: keySynonyms(f), hint: 'The selected row\'s key' })
      add(f.key, 'selected_row', `${n} › Selected row`, 'row', { hint: 'The whole row: pick a column, or insert it all' })
      for (const c of cols) add(f.key, `selected_row.${c.key}`, `${n} › Selected row › ${c.label || c.key}`, COLUMN_TYPE[c.type] ?? 'value', { parent: `control.${f.key}.selected_row`, keywords: c.key })
      add(f.key, 'selected_rows', `${n} › Selected rows`, 'list')
      add(f.key, 'selected_count', `${n} › Rows selected`, 'number')
      add(f.key, 'last_clicked_row_id', `${n} › Last clicked row › ID`, 'text', { keywords: kw.replace('row id', 'clicked row id') })
      add(f.key, 'last_clicked_row', `${n} › Last clicked row`, 'row', { hint: 'The whole row: pick a column, or insert it all' })
      for (const c of cols) add(f.key, `last_clicked_row.${c.key}`, `${n} › Last clicked row › ${c.label || c.key}`, COLUMN_TYPE[c.type] ?? 'value', { parent: `control.${f.key}.last_clicked_row`, keywords: c.key })
      add(f.key, 'row_count', `${n} › Row count`, 'number')
      add(f.key, 'changes_count', `${n} › Changes`, 'number')
      // Rows for aggregates (a Label's expression: SUM(rows, "amount"), SUMPRODUCT(rows, "qty", "price")…).
      add(f.key, 'rows', `${n} › Rows (with edits)`, 'list', { keywords: 'rows lines all sum total aggregate', hint: 'The rows on the table, your edits applied: use with SUM(…, "column"), SUMPRODUCT, SUMIF, COUNT, MAP' })
      if (f.data_table.mode === 'edit') {
        add(f.key, 'added_rows', `${n} › Added rows`, 'list', { keywords: 'new rows change set' })
        add(f.key, 'changed_rows', `${n} › Changed rows`, 'list', { keywords: 'edited rows change set' })
        add(f.key, 'deleted_rows', `${n} › Deleted rows`, 'list', { keywords: 'removed rows change set' })
      }
      // Column names to aggregate on (inserted as quoted text).
      if (expression) for (const c of cols) out.push({ path: JSON.stringify(c.key), plain: true, label: `${n} › Column › ${c.label || c.key}`, group: g, type: COLUMN_TYPE[c.type] ?? 'value', keywords: `column ${c.key}`, hint: `"${c.key}": a column name for SUM(rows, "${c.key}"), SUMPRODUCT, SUMIF, MAP` })
    } else if (f.type === 'label') {
      add(f.key, 'value', `${n} › Value`, 'value', { keywords: 'label' })
    } else if (f.type === 'lookup' && f.lookup) {
      add(f.key, 'value', `${n} › Value`, f.lookup.multiple ? 'list' : 'text')
      add(f.key, 'label', `${n} › Label`, f.lookup.multiple ? 'list' : 'text')
      const itemFields = lookupItemFields(f.lookup)
      if (itemFields.length) add(f.key, 'item', `${n} › Item`, 'row', { hint: 'The whole item: pick a field, or insert it all' })
      for (const p of itemFields) add(f.key, `item.${p}`, `${n} › Item › ${p}`, 'value', { parent: `control.${f.key}.item` })
    }
  }
  if (layoutPages(source.layout).length) {
    add('form', 'step_id', 'Form › Current step / tab (id)', 'text')
    add('form', 'step_title', 'Form › Current step / tab (title)', 'text')
    // When to load (lib/forms/lazy-load.ts).
    for (const p of layoutPages(source.layout)) add('form', `loaded.${p.id}`, `Form › ${p.title || p.id} › Loaded`, 'boolean', { keywords: 'lazy load step tab' })
  }
  return out
}

function sectionEntries(source: FormVariableSource, state: Record<string, Record<string, unknown>>, condition: boolean): PickerVariable[] {
  return layoutSectionControls(source.layout).flatMap((s) => {
    const n = s.title || s.key
    const sample = state[s.key] ?? {}
    const both = (part: 'included' | 'visible' | 'loaded', label: string): PickerVariable[] => [
      { path: `control.${s.key}.${part}`, label: `${n} › ${label}`, group: 'Sections', type: 'boolean', keywords: `section ${s.key}`, ...(typeof sample[part] === 'boolean' ? { sample: sample[part] } : {}) },
      // The condition picker's own spelling (section.<key>.*): known, not listed twice.
      ...(condition ? [{ path: `section.${s.key}.${part}`, label: `${n} › ${label}`, group: 'Sections', type: 'boolean' as const, hidden: true }] : []),
    ]
    return [...(s.optional ? both('included', 'Included') : []), ...both('visible', 'Visible'), ...both('loaded', 'Loaded')]
  })
}

function fieldEntries(source: FormVariableSource, ctx: FormVariableContext): PickerVariable[] {
  const prefix = fieldPrefix(ctx)
  const exclude = ctx.kind === 'table_query' || ctx.kind === 'lookup_query' || ctx.kind === 'dynamic_value' || ctx.kind === 'expression' ? ctx.exclude : undefined
  const values = source.values ?? {}
  const out: PickerVariable[] = []
  for (const f of source.fields) {
    if (DISPLAY_FIELD_TYPES.has(f.type as never) || f.key === exclude) continue
    // A Label is a field downstream only when it's stored (else: Controls › <label> › Value).
    if (f.type === 'label' && (f.label_config?.include !== true || ctx.kind === 'expression')) continue
    const v = values[f.key]
    out.push({ path: `${prefix}${f.key}`, label: name(f), group: 'Fields on this form', type: fieldType(f.type), keywords: f.key, ...(v !== undefined && v !== '' && (typeof v !== 'object' || v === null) ? { sample: v } : {}) })
    if (f.type === 'lookup' && prefix === '') out.push({ path: lookupLabelKey(f.key), label: `${name(f)} › Display label`, group: 'Fields on this form', type: 'text', keywords: f.key })
  }
  return out
}

function contextEntries(source: FormVariableSource): PickerVariable[] {
  return [
    ...layoutFormParams(source.layout).map((p): PickerVariable => ({ path: `param.${p.name}`, label: p.label ?? p.name, group: 'Parameters', type: PARAM_TYPE[p.type] ?? 'value', keywords: p.name, ...(p.default !== undefined ? { sample: p.default, hint: `Default: ${p.default}` } : {}) })),
    ...layoutFormVariables(source.layout).map((v): PickerVariable => ({ path: `var.${v.name}`, label: v.label ?? v.name, group: 'Variables', type: PARAM_TYPE[v.type] ?? 'value', keywords: v.name, ...(v.initial?.kind === 'constant' ? { sample: v.initial.value } : {}) })),
  ]
}

/** The expression functions a Label may use, with their signatures and an example (insert the name and "("). */
function functionEntries(): PickerVariable[] {
  return FUNCTION_CATALOG.filter((fn) => LABEL_FUNCTIONS.has(fn.name) && ['math', 'list', 'text', 'logical', 'conversion', 'date'].includes(fn.category)).map((fn) => ({
    path: `${fn.name}(`,
    plain: true,
    label: `${fn.name}(${fn.args.map((a) => `${a.name}${a.optional ? '?' : ''}`).join(', ')})`,
    group: 'Functions',
    type: (fn.returnType === 'number' ? 'number' : fn.returnType === 'boolean' ? 'boolean' : fn.returnType === 'array' ? 'list' : 'text') as PickerType,
    keywords: `${fn.category} ${fn.description}`,
    hint: `${fn.description}. e.g. ${fn.example}`,
  }))
}

function userEntries(): PickerVariable[] {
  return [
    { path: 'user.name', label: 'Current user › Name', group: 'Current user', type: 'text' },
    { path: 'user.email', label: 'Current user › Email', group: 'Current user', type: 'text' },
    { path: 'user.id', label: 'Current user › ID', group: 'Current user', type: 'text' },
    { path: 'user.roles', label: 'Current user › Roles', group: 'Current user', type: 'list', hint: 'Role names and ids — "contains Manager" means has the role' },
    { path: 'user.teams', label: 'Current user › Teams', group: 'Current user', type: 'list', hint: 'Team names and ids — "contains Finance" means is in the team' },
  ]
}

function dateEntries(now: Date): PickerVariable[] {
  const day = (offset: number) => { const d = new Date(now); d.setDate(d.getDate() + offset); return dateIso(d) }
  return [
    { path: 'today', label: 'Today', group: 'Dates', type: 'date', sample: dateIso(now), keywords: 'date day' },
    { path: 'now', label: 'Now (date and time)', group: 'Dates', type: 'date', sample: now.toISOString(), keywords: 'time' },
    { path: 'today-7d', label: '7 days ago', group: 'Dates', type: 'date', sample: day(-7), keywords: 'week' },
    { path: 'today+30d', label: 'In 30 days', group: 'Dates', type: 'date', sample: day(30), keywords: 'month' },
    { path: 'start_of_month', label: 'First day of this month', group: 'Dates', type: 'date', sample: dateIso(new Date(now.getFullYear(), now.getMonth(), 1)) },
    { path: 'start_of_year', label: 'First day of this year', group: 'Dates', type: 'date', sample: dateIso(new Date(now.getFullYear(), 0, 1)) },
  ]
}

function flagEntries(layout: unknown): PickerVariable[] {
  const flags = layout && typeof layout === 'object' ? ((layout as { state?: { flags?: Array<{ key: string; label?: string }> } }).state?.flags ?? []) : []
  return flags.map((f) => ({ path: `state.${f.key}`, label: f.label || f.key, group: 'Flags', type: 'boolean' as const, keywords: `flag ${f.key}` }))
}

/* ── Problems ────────────────────────────────────────────────────────── */

const DATE_RE = /^(today|now|start_of_month|start_of_year)(?:[+-]\d{1,4}[dwmy])?$/
const EVENT_ALIASES = /^event\.(key|previous|page|target|item\.fields(\.[\w$-]+)*)$/

/** The Controls equivalent of an event path ({{event.row_id}} → {{control.orders.selected_row_id}}). */
function controlEquivalent(path: string, fields: FieldLike[], target?: string): string | null {
  const all = tables(fields)
  const table = (target ? all.find((f) => f.key === target) : undefined) ?? all[0]
  if (!table) return null
  if (path === 'event.row_id') return `control.${table.key}.selected_row_id`
  if (path === 'event.row') return `control.${table.key}.selected_row`
  if (path.startsWith('event.row.')) return `control.${table.key}.selected_row.${path.slice('event.row.'.length)}`
  return null
}

function problemFor(path: string, ctx: FormVariableContext, source: FormVariableSource, items: PickerVariable[], groups: Set<FormVariableGroup>): string | null {
  const known = items.find((i) => i.path === path)
  if (known) return groups.has(known.group as FormVariableGroup) || !FORM_VARIABLE_GROUPS.includes(known.group as FormVariableGroup) ? null : `${known.group} values aren't filled in here`
  if (ctx.kind === 'task_completed') return 'Not filled in on the Task completed screen: use the task title, outcome, next step, who it is with, your name or the process name.'
  const label = (p: string) => items.find((i) => i.path === p)?.label ?? p
  if (path === 'event' || path.startsWith('event.')) {
    const equivalent = controlEquivalent(path, source.fields, ctx.kind === 'rule' ? ctx.target : undefined)
    const instead = equivalent ? ` Use “${label(equivalent)}” ({{${equivalent}}}) instead.` : ' Use a Controls value instead.'
    if (ctx.kind === 'button') return `Event values aren't available in a Button's steps.${instead}`
    if (ctx.kind !== 'rule') return `Event values only exist in a rule.${instead}`
    if (EVENT_ALIASES.test(path)) return null
    const table = eventTable(ctx, source.fields)
    // A row event on a table whose columns aren't listed (none picked yet): any column.
    if (EVENT_TARGET[ctx.event] === 'table' && path.startsWith('event.row.') && !table?.data_table?.columns.length) return null
    if (EVENT_TARGET[ctx.event] === 'table' && path.startsWith('event.row.')) return `${table ? name(table) : 'The table'} has no column “${path.slice('event.row.'.length)}”.`
    if (ctx.event === 'item_select' && path.startsWith('event.item.')) return null
    return `“${FORM_RULE_EVENT_LABELS[ctx.event]}” rules have no {{${path}}}: it would be empty.${instead}`
  }
  if (path.startsWith('control.')) {
    if (!groups.has('Controls') && !groups.has('Sections')) return 'Control values aren\'t filled in here'
    const key = path.split('.')[1]
    if (items.some((i) => i.path.startsWith(`control.${key}.`))) {
      const column = /^control\.[^.]+\.(selected_row|last_clicked_row)\.(.+)$/.exec(path)
      if (column) return `${name(source.fields.find((f) => f.key === key) ?? { key, type: '' })} has no column “${column[2]}”.`
      return null
    }
    return `No control “${key}” on this form (a Data table, autocomplete, section or step).`
  }
  if (path.startsWith('param.')) return groups.has('Parameters') ? `No parameter “${path.slice(6)}”: declare it on the Data tab.` : 'Parameters aren\'t filled in here'
  if (path.startsWith('var.')) return groups.has('Variables') ? `No variable “${path.slice(4)}”: declare it on the Data tab.` : 'Variables aren\'t filled in here'
  if (path === 'user' || path.startsWith('user.')) return groups.has('Current user') ? null : 'The current user isn\'t filled in here'
  if (DATE_RE.test(path)) return groups.has('Dates') ? null : 'Dates aren\'t filled in here: they work in rule conditions, Data table filters and table changes'
  if (path.startsWith('state.')) return groups.has('Flags') ? `No flag “${path.slice(6)}”.` : 'Flags aren\'t filled in here: test them in a rule\'s If'
  if (path.startsWith('section.')) return ctx.kind === 'rule' && ctx.slot === 'condition' ? null : `Use {{control.${path.slice(8)}}} here`
  // A field: bare, form., task_data. — only judged where fields are bare (rules, buttons, header, bar).
  if (fieldPrefix(ctx) !== '' || !groups.has('Fields on this form')) return null
  const m = /^(?:form\.|task_data\.|task\.data\.)?([^.]+)/.exec(path)
  const key = m?.[1] ?? path
  const base = key.replace(/_(label|item)$/, '')
  if (source.fields.some((f) => f.key === key || f.key === base)) return null
  if (/^task\./.test(path) && ctx.kind === 'header') return null
  return `No field “${key}” on this form.`
}

/* ── Scope ───────────────────────────────────────────────────────────── */

/**
 * The picker scope of one input: its entries (local extras first, then the
 * context's groups in FORM_VARIABLE_GROUPS order), the menu note and the
 * wrong-context check.
 */
export function formVariableScope(source: FormVariableSource, ctx: FormVariableContext, extras: Array<{ name: string; group: string; label?: string }> = []): PickerScope & { context: FormVariableContext; groups: FormVariableGroup[] } {
  const groups = contextGroups(ctx)
  const has = new Set(groups)
  const state = controlState(source.fields as never, source.values ?? {}, layoutPages(source.layout), layoutSectionControls(source.layout))
  const exclude = ctx.kind === 'table_query' || ctx.kind === 'lookup_query' || ctx.kind === 'dynamic_value' || ctx.kind === 'expression' ? ctx.exclude : undefined
  const byGroup: Record<FormVariableGroup, () => PickerVariable[]> = {
    'This event': () => (ctx.kind === 'rule' ? eventEntries(ctx, source, state) : []),
    Controls: () => controlEntries(source, state, exclude, ctx.kind === 'expression'),
    'Fields on this form': () => fieldEntries(source, ctx),
    Parameters: () => contextEntries(source).filter((e) => e.group === 'Parameters'),
    Variables: () => contextEntries(source).filter((e) => e.group === 'Variables'),
    Sections: () => sectionEntries(source, state, ctx.kind === 'rule' && ctx.slot === 'condition'),
    'Current user': userEntries,
    Dates: () => dateEntries(source.now ?? new Date()),
    Flags: () => flagEntries(source.layout),
  }
  // A Label's expression also lists the functions (inserted as text: their names and "(").
  const catalog = [...groups.flatMap((g) => byGroup[g]()), ...(ctx.kind === 'expression' ? functionEntries() : [])]
  const taken = new Set(catalog.map((i) => i.path))
  const local = legacyPickerEntries(extras).filter((e) => !taken.has(e.path) && !FORM_VARIABLE_GROUPS.includes(e.group as FormVariableGroup))
  const items = [...local, ...catalog]
  let note: string | undefined
  if (ctx.kind === 'button') {
    const t = tables(source.fields)[0]
    note = `Event values (“This event”) aren't available in a Button's steps: read the form's controls instead${t ? `, e.g. “${name(t)} › Selected row › ID”` : ''}.`
  } else if (ctx.kind === 'rule' && EVENT_TARGET[ctx.event] === 'table' && !eventTable(ctx, source.fields)) {
    note = 'Choose the Data table above to list its columns.'
  } else if (ctx.kind === 'expression') {
    note = 'A formula: fields, parameters and controls with {x}; functions such as SUM(rows, "amount"), SUMPRODUCT(rows, "qty", "price"), ROUND(x, 2).'
  } else if (ctx.kind === 'default') {
    note = 'A default is filled in when the form opens: parameters, or a workflow\'s {{variables}} on a task form.'
  }
  return {
    context: ctx,
    groups,
    items,
    ...(note ? { note } : {}),
    problem: (path: string) => problemFor(path, ctx, source, items, has),
    recentKey: RECENT_KEY,
  }
}
