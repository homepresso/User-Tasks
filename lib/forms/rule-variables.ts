/**
 * Everything a form rule can read, made discoverable — not just resolvable:
 *
 *   This event   {{event.*}}: what the rule's When event carries (a clicked
 *                row and its id, an edited cell, the selected autocomplete
 *                item, the answered question, the step change…). The
 *                runtime fills it through enrichEventContext, and
 *                eventVariables lists exactly those paths, typed, for the
 *                rule's event (tests keep the two in step).
 *   Controls     {{control.<key>.*}}: the live state of the form's
 *                interactive controls, readable from ANY rule — a Data
 *                table's selected / last-clicked row, its row and change
 *                counts; an autocomplete's value, label and item; the
 *                current step / tab (`control.form.*`).
 *   Parameters / Variables   {{param.*}} / {{var.*}} (lib/forms/form-params.ts).
 *
 * Control state lives in the values under CONTROLS_KEY, like variables:
 * the parts that follow from field values (selections, change sets,
 * autocomplete values) are derived from them (controlState); the parts only
 * the browser knows (the last clicked row, how many rows the table shows,
 * the current step) are reported by the controls. Like parameters and
 * variables they are user-controllable input: the server rebuilds them with
 * sanitizeControls — declared controls only, a Data table's rows restricted
 * to its declared columns, typed and bounded — and, in a Data table query
 * or an API mapping, they are only placeholder values (the author's base
 * filter stays, quoted; references come from the saved form).
 *
 * Data tables also expose their rows for aggregates (`rows`: the loaded
 * page with the edits applied, reported as `loaded_rows`; `added_rows` /
 * `changed_rows` / `deleted_rows` from the change set) and Labels their
 * value (`control.<label>.value`; lib/forms/label-field.ts).
 *
 * Sections (`control.<section>.included` / `.visible`, lib/forms/sections.ts)
 * plug in through SECTION_CONTROL_HOOK: the layout's sections are passed
 * beside the fields. `included` follows the `<key>_included` value (always
 * true for a non-optional section); `visible` is false while a button or
 * rule has hidden `section:<key>` — the same reading as the conditions
 * `section.<key>.included` / `.visible`. Both derive from values the server
 * re-judges, so nothing is trusted as reported. `control.<section>.loaded`
 * and `control.form.loaded.<page id>` (lib/forms/lazy-load.ts) read the
 * state's `loaded` list — presentation only, true for a part that loads on
 * open.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { CONTROLS_KEY } from './form-params'
import { changeCount, dataTableKeyColumn, isChangeSet, projectedKeys, type DataTableColumnType, type DataTableFieldConfig } from './data-table'
import { lookupItemFields, lookupItemKey, lookupLabelKey, type LookupConfig } from './lookup'
import type { FormRuleEventType } from './form-rules'
import { isSectionIncluded, sectionConditionValue } from './sections'
import { loadedTargets } from './lazy-load'
import { changeRows, workingRows, type LabelFieldConfig } from './label-field'

export { CONTROLS_KEY }

export type RuleVariableType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object' | 'any'

export interface RuleVariable {
  /** The placeholder path ({{path}}). */
  path: string
  label: string
  type: RuleVariableType
  group: 'This event' | 'Controls'
}

interface FieldLike {
  key: string
  label?: string
  type: string
  data_table?: DataTableFieldConfig
  lookup?: LookupConfig
  label_config?: LabelFieldConfig
}

/** A step / tab; `lazy`: it does not load on open (lib/forms/lazy-load.ts). */
interface PageLike { id: string; title?: string; lazy?: boolean }

const ROW_EVENTS: ReadonlySet<FormRuleEventType> = new Set(['row_click', 'row_select', 'row_deselect', 'row_double_click', 'cell_edit', 'row_add', 'row_delete'])
const COLUMN_TYPE: Record<DataTableColumnType, RuleVariableType> = { text: 'text', number: 'number', date: 'date', datetime: 'date', choice: 'text', boolean: 'boolean' }
export const RULE_VARIABLE_TYPE_LABELS: Record<RuleVariableType, string> = { text: 'text', number: 'number', boolean: 'yes / no', date: 'date', list: 'list', object: 'row / object', any: 'value' }

/* ── This event ─────────────────────────────────────────────────────── */

/**
 * The event context as the rules see it: what the control dispatched plus
 * the documented aliases — `row_id` (the row's key), `previous_value`,
 * `label` and `item.<field>` for an autocomplete, `from` / `to` for a step
 * change. Run on every dispatch (browser) and on the server's copy of the
 * event (rule actions), so both read the same names.
 */
export function enrichEventContext(type: FormRuleEventType, context: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(context ?? {}) }
  if (ROW_EVENTS.has(type)) {
    // A new row has no id yet (row_add).
    if (type !== 'row_add' && !('row_id' in out)) out.row_id = out.key ?? null
    if (!isPlainObject(out.row)) out.row = {}
  }
  if ((type === 'value_change' || type === 'cell_edit' || type === 'label_change' || type === 'cell_change') && !('previous_value' in out)) out.previous_value = out.previous ?? null
  if (type === 'item_select') {
    const item = isPlainObject(out.item) ? out.item : {}
    const fields = isPlainObject(item.fields) ? item.fields : {}
    // The item's fields on the item itself ({{event.item.city}}); value / label / fields kept.
    out.item = { ...fields, ...item }
    if (!('label' in out)) out.label = item.label ?? null
  }
  if (type === 'page_change') {
    if (!('to' in out)) out.to = out.page ?? null
    if (!('from' in out)) out.from = out.previous ?? null
  }
  return out
}

/** The {{event.*}} paths of a rule's event, typed (the "This event" group). `target`: the rule's field / table / lookup. */
export function eventVariables(type: FormRuleEventType, target: string | undefined, fields: FieldLike[]): RuleVariable[] {
  const v = (path: string, label: string, t: RuleVariableType): RuleVariable => ({ path: `event.${path}`, label, type: t, group: 'This event' })
  const field = target ? fields.find((f) => f.key === target) : undefined
  const out: RuleVariable[] = []
  if (ROW_EVENTS.has(type)) {
    out.push(v('field', 'Data table (key)', 'text'))
    if (type !== 'row_add') out.push(v('row_id', 'Row id (the row\'s key)', 'text'))
    out.push(v('row', 'The whole row', 'object'))
    for (const c of field?.data_table?.columns ?? []) out.push(v(`row.${c.key}`, `Row: ${c.label || c.key}`, COLUMN_TYPE[c.type] ?? 'any'))
    if (type === 'row_click' || type === 'row_double_click' || type === 'cell_edit') out.push(v('column', 'Column (key)', 'text'))
    if (type === 'row_select') out.push(v('selected', 'Selected', 'boolean'))
    if (type === 'cell_edit') out.push(v('value', 'New value', 'any'), v('previous_value', 'Previous value', 'any'))
    return out
  }
  switch (type) {
    case 'value_change':
      return [v('field', 'Field (key)', 'text'), v('value', 'New value', 'any'), v('previous_value', 'Previous value', 'any')]
    case 'focus':
    case 'blur':
      return [v('field', 'Field (key)', 'text'), v('value', 'Value', 'any')]
    case 'item_select': {
      out.push(v('field', 'Autocomplete (key)', 'text'), v('value', 'Stored value', 'text'), v('label', 'Display label', 'text'), v('item', 'The whole item', 'object'))
      for (const f of field?.lookup ? lookupItemFields(field.lookup) : []) out.push(v(`item.${f}`, `Item: ${f}`, 'any'))
      return out
    }
    case 'page_change':
      return [v('to', 'Step / tab now (id)', 'text'), v('from', 'Step / tab before (id)', 'text')]
    case 'button_click':
    case 'before_submit':
    case 'after_submit':
      return [v('button', 'Button (id)', 'text')]
    case 'flag_change':
      return [v('flag', 'Flag', 'text'), v('value', 'On / off', 'boolean')]
    case 'label_change':
      return [v('field', 'Label (key)', 'text'), v('value', 'New value', 'any'), v('previous_value', 'Previous value', 'any')]
    case 'part_loaded':
      return [v('part', 'Section / tab (section:<key> or page:<id>)', 'text')]
    case 'message_answered':
      return [v('message', 'Question (id)', 'text'), v('response', 'Response (value)', 'text'), v('label', 'Response (label)', 'text')]
    case 'row_created':
    case 'row_values_changed':
    case 'row_committed':
    case 'row_commit_failed':
    case 'cell_change': {
      // Editable table rules (lib/forms/row-rules.ts): a List's or an editable Data table's row.
      out.push(v('field', 'List / Data table (key)', 'text'), v('row', 'The whole row', 'object'), v('row_number', 'Row number (1 = first)', 'number'), v('key', 'Row key (an existing Data table row)', 'text'))
      const columns = (field as { list?: { columns?: Array<{ key: string; label?: string }> } } | undefined)?.list?.columns ?? field?.data_table?.columns ?? []
      for (const c of columns) out.push(v(`row.${c.key}`, `Row: ${c.label || c.key}`, 'any'))
      if (type === 'row_values_changed') out.push(v('columns', 'Columns set', 'list'))
      if (type === 'row_committed') out.push(v('saved', 'Saved to the table now', 'boolean'), v('result', 'Saved row (Save now: result.id)', 'object'))
      if (type === 'row_commit_failed') out.push(v('error', 'The first problem', 'text'), v('errors', 'Problems by column', 'object'))
      if (type === 'cell_change') out.push(v('column', 'Column (key)', 'text'), v('value', 'New value', 'any'), v('previous_value', 'Previous value', 'any'))
      return out
    }
    default:
      return []
  }
}

/* ── Controls ───────────────────────────────────────────────────────── */

export const CONTROL_LIMITS = { rows: 200, cell: 2000, id: 200, count: 1_000_000 } as const

/** A section as the Controls group sees it (layout.sections). */
export interface SectionLike { key: string; title?: string; optional?: boolean; lazy?: boolean }

/** The sections of a (stored) layout, for the section controls. */
export function layoutSectionControls(layout: unknown): SectionLike[] {
  if (!isPlainObject(layout) || !Array.isArray(layout.sections)) return []
  return layout.sections.filter(isPlainObject).filter((s) => typeof s.key === 'string' && s.key).map((s) => ({
    key: String(s.key), ...(typeof s.title === 'string' ? { title: s.title } : {}), ...(s.optional === true ? { optional: true } : {}),
    ...(s.load === 'visible' || s.load === 'rule' ? { lazy: true } : {}),
  }))
}

/**
 * Sections (lib/forms/sections.ts): `control.<key>.included` (optional
 * sections) and `control.<key>.visible`, listed and derived from the values.
 */
export const SECTION_CONTROL_HOOK: {
  variables: (fields: FieldLike[], sections?: SectionLike[]) => RuleVariable[]
  state: (fields: FieldLike[], values: Record<string, unknown>, sections?: SectionLike[]) => Record<string, Record<string, unknown>>
} = {
  variables: (_fields, sections = []) => sections.flatMap((s) => {
    const name = `Section ${s.title || s.key}`
    return [
      ...(s.optional ? [{ path: `control.${s.key}.included`, label: `${name}: included`, type: 'boolean' as const, group: 'Controls' as const }] : []),
      { path: `control.${s.key}.visible`, label: `${name}: visible`, type: 'boolean' as const, group: 'Controls' as const },
      { path: `control.${s.key}.loaded`, label: `${name}: loaded`, type: 'boolean' as const, group: 'Controls' as const },
    ]
  }),
  state: (_fields, values, sections = []) => {
    const loaded = loadedTargets(values)
    return Object.fromEntries(sections.map((s) => [s.key, {
      included: isSectionIncluded(s, values),
      visible: sectionConditionValue(`section.${s.key}.visible`, values) ?? true,
      // When to load (lib/forms/lazy-load.ts): a section that loads on open always is.
      loaded: !s.lazy || loaded.has(`section:${s.key}`),
    }]))
  },
}

/** The Controls group: every interactive control's readable state, typed. */
export function controlVariables(fields: FieldLike[], pages: PageLike[] = [], sections: SectionLike[] = []): RuleVariable[] {
  const out: RuleVariable[] = []
  const v = (path: string, label: string, t: RuleVariableType): RuleVariable => ({ path: `control.${path}`, label, type: t, group: 'Controls' })
  for (const f of fields) {
    const name = f.label || f.key
    if (f.type === 'data_table' && f.data_table) {
      const cols = f.data_table.columns ?? []
      out.push(v(`${f.key}.selected_row_id`, `${name}: selected row id`, 'text'))
      out.push(v(`${f.key}.selected_row`, `${name}: selected row`, 'object'))
      for (const c of cols) out.push(v(`${f.key}.selected_row.${c.key}`, `${name}: selected ${c.label || c.key}`, COLUMN_TYPE[c.type] ?? 'any'))
      out.push(v(`${f.key}.selected_rows`, `${name}: selected rows`, 'list'), v(`${f.key}.selected_count`, `${name}: rows selected`, 'number'))
      out.push(v(`${f.key}.last_clicked_row_id`, `${name}: last clicked row id`, 'text'))
      for (const c of cols) out.push(v(`${f.key}.last_clicked_row.${c.key}`, `${name}: last clicked ${c.label || c.key}`, COLUMN_TYPE[c.type] ?? 'any'))
      out.push(v(`${f.key}.row_count`, `${name}: rows`, 'number'), v(`${f.key}.changes_count`, `${name}: changes`, 'number'))
      // Rows for aggregates (Labels' expressions; lib/forms/label-field.ts).
      out.push(v(`${f.key}.rows`, `${name}: rows on the table (with edits)`, 'list'))
      if (f.data_table.mode === 'edit') out.push(v(`${f.key}.added_rows`, `${name}: added rows`, 'list'), v(`${f.key}.changed_rows`, `${name}: changed rows`, 'list'), v(`${f.key}.deleted_rows`, `${name}: deleted rows`, 'list'))
    } else if (f.type === 'label') {
      out.push(v(`${f.key}.value`, `${name}: value`, 'any'))
    } else if (f.type === 'lookup' && f.lookup) {
      out.push(v(`${f.key}.value`, `${name}: value`, f.lookup.multiple ? 'list' : 'text'), v(`${f.key}.label`, `${name}: label`, f.lookup.multiple ? 'list' : 'text'))
      for (const p of lookupItemFields(f.lookup)) out.push(v(`${f.key}.item.${p}`, `${name}: item ${p}`, 'any'))
    }
  }
  out.push(...SECTION_CONTROL_HOOK.variables(fields, sections))
  if (pages.length) out.push(v('form.step_id', 'Current step / tab (id)', 'text'), v('form.step_title', 'Current step / tab (title)', 'text'))
  for (const p of pages) out.push(v(`form.loaded.${p.id}`, `Step / tab ${p.title || p.id}: loaded`, 'boolean'))
  return out
}

/** Only the declared columns of a table row, values bounded. */
function cleanRow(row: unknown, columns: string[]): Record<string, unknown> | null {
  if (!isPlainObject(row)) return null
  const out: Record<string, unknown> = {}
  for (const c of columns) {
    const v = row[c]
    if (v === undefined) continue
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[c] = typeof v === 'number' && !Number.isFinite(v) ? null : v
    else if (typeof v === 'string') out[c] = v.slice(0, CONTROL_LIMITS.cell)
    else out[c] = null
  }
  return out
}

/** A JSON value kept only when small (an autocomplete item's nested field). */
function bounded(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.slice(0, CONTROL_LIMITS.cell)
  try { const json = JSON.stringify(v); return json.length <= CONTROL_LIMITS.cell * 2 ? JSON.parse(json) : null } catch { return null }
}

/** An autocomplete value / label: text, or a list of text (multiple), bounded. */
function plainValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.slice(0, CONTROL_LIMITS.rows).map((x) => cleanId(x)).filter((x) => x !== null)
  return cleanId(v)
}

function cleanId(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'string' && typeof v !== 'number') return null
  return String(v).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, CONTROL_LIMITS.id) || null
}

function cleanCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 0 && n <= CONTROL_LIMITS.count ? n : null
}

/**
 * The control state for these values (browser and server alike): derived
 * from the controls' own values, plus what the browser reported under
 * CONTROLS_KEY (last clicked row, row count, current step) — declared
 * controls only, rows cut to the table's declared columns, ids and counts
 * bounded. Anything else in the report is dropped.
 */
export function controlState(fields: FieldLike[], values: Record<string, unknown>, pages: PageLike[] = [], sections: SectionLike[] = []): Record<string, Record<string, unknown>> {
  const reported = isPlainObject(values?.[CONTROLS_KEY]) ? values[CONTROLS_KEY] as Record<string, unknown> : {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const f of fields) {
    const sent = isPlainObject(reported[f.key]) ? reported[f.key] as Record<string, unknown> : {}
    if (f.type === 'data_table' && f.data_table) {
      const config = f.data_table
      const columns = projectedKeys(config)
      const keyColumn = dataTableKeyColumn(config)
      // The table's own value when the request carries it; otherwise what was reported (a query sends only its dependencies).
      const own = Object.prototype.hasOwnProperty.call(values, f.key)
      const value = own ? values[f.key] : undefined
      const rows = own ? (f.data_table.mode === 'select' && Array.isArray(value) ? value : []) : (Array.isArray(sent.selected_rows) ? sent.selected_rows : [])
      const selected = rows.slice(0, CONTROL_LIMITS.rows).map((r) => cleanRow(r, columns)).filter((r): r is Record<string, unknown> => Boolean(r))
      const lastRow = cleanRow(sent.last_clicked_row, columns)
      // The rows the table shows (reported by the browser: display only — the server rebuilds them for stored labels).
      const loaded = (Array.isArray(sent.loaded_rows) ? sent.loaded_rows : []).slice(0, CONTROL_LIMITS.rows).map((r) => cleanRow(r, columns)).filter((r): r is Record<string, unknown> => Boolean(r))
      const changes = own ? value : undefined
      // Only when there are some (a form without them keeps its state as before; a missing list adds up to 0).
      const working = workingRows(config, loaded, changes, CONTROL_LIMITS.rows)
      const changed = Object.fromEntries(Object.entries(changeRows(config, changes)).filter(([, list]) => list.length))
      out[f.key] = {
        ...(working.length ? { rows: working } : {}),
        // Kept so the table's next report carries them (reportControl keeps only what the browser knows).
        ...(loaded.length ? { loaded_rows: loaded } : {}),
        ...changed,
        selected_rows: selected,
        selected_count: selected.length,
        selected_row: selected[0] ?? null,
        selected_row_id: selected[0] ? cleanId(selected[0][keyColumn]) : null,
        last_clicked_row: lastRow,
        last_clicked_row_id: lastRow ? cleanId(sent.last_clicked_row_id ?? lastRow[keyColumn]) : null,
        row_count: cleanCount(sent.row_count),
        changes_count: own ? (f.data_table.mode === 'edit' && isChangeSet(value) ? changeCount(value) : 0) : cleanCount(sent.changes_count) ?? 0,
      }
    } else if (f.type === 'lookup' && f.lookup) {
      const allowed = lookupItemFields(f.lookup)
      const own = Object.prototype.hasOwnProperty.call(values, f.key)
      const rawItem = own ? values[lookupItemKey(f.key)] : sent.item
      const item = Array.isArray(rawItem) ? rawItem[0] : rawItem
      const cleanItem: Record<string, unknown> = {}
      if (isPlainObject(item)) for (const p of allowed) { const top = p.split('.')[0]; if (top in item) cleanItem[top] = bounded(item[top]) }
      const value = own ? values[f.key] : sent.value
      const label = own ? values[lookupLabelKey(f.key)] : sent.label
      out[f.key] = { value: plainValue(value), label: plainValue(label), item: isPlainObject(item) ? cleanItem : null }
    } else if (f.type === 'label') {
      const v = values?.[f.key]
      out[f.key] = { value: v === undefined ? null : v === null || typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'string' ? v.slice(0, CONTROL_LIMITS.cell) : null }
    }
  }
  Object.assign(out, SECTION_CONTROL_HOOK.state(fields, values, sections))
  const form = isPlainObject(reported.form) ? reported.form as Record<string, unknown> : {}
  const step = pages.find((p) => p.id === form.step_id)
  if (pages.length) {
    const loaded = loadedTargets(values)
    out.form = { step_id: step?.id ?? null, step_title: step?.title ?? null, loaded: Object.fromEntries(pages.map((p) => [p.id, !p.lazy || loaded.has(`page:${p.id}`)])) }
  }
  return out
}

/** The values with CONTROLS_KEY holding the full control state (forms without interactive controls: unchanged). */
export function withControlState(fields: FieldLike[], values: Record<string, unknown>, pages: PageLike[] = [], sections: SectionLike[] = []): Record<string, unknown> {
  if (!pages.length && !sections.length && !fields.some((f) => (f.type === 'data_table' && f.data_table) || (f.type === 'lookup' && f.lookup) || f.type === 'label')) return values
  return { ...values, [CONTROLS_KEY]: controlState(fields, values, pages, sections) }
}

/** What a control reports (merged into CONTROLS_KEY by the surface). */
export function reportControl(values: Record<string, unknown>, key: string, patch: Record<string, unknown>): Record<string, unknown> {
  const current = isPlainObject(values?.[CONTROLS_KEY]) ? values[CONTROLS_KEY] as Record<string, unknown> : {}
  const mine = isPlainObject(current[key]) ? current[key] as Record<string, unknown> : {}
  // Keep only what the browser alone knows; derived parts are recomputed from the values.
  const keep = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => ['last_clicked_row', 'last_clicked_row_id', 'row_count', 'step_id', 'loaded_rows'].includes(k)))
  const reported: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) if (isPlainObject(v)) reported[k] = keep(v as Record<string, unknown>)
  reported[key] = { ...keep(mine), ...patch }
  return reported
}

/** Pages of a (stored) layout, for the current step / tab control. */
export function layoutPages(layout: unknown): PageLike[] {
  if (!isPlainObject(layout) || (layout.mode !== 'steps' && layout.mode !== 'tabs') || !Array.isArray(layout.pages)) return []
  return layout.pages.filter(isPlainObject).map((p) => ({ id: String(p.id ?? ''), title: typeof p.title === 'string' ? p.title : undefined, ...(p.load === 'visible' || p.load === 'rule' ? { lazy: true } : {}) })).filter((p) => p.id)
}

/**
 * Server side: the control state of a request, rebuilt from its values
 * (sanitized like controlState) — the reserved entry to resolve
 * {{control.*}} with, or nothing for a form without controls.
 */
export function serverControlEntries(layout: unknown, fields: FieldLike[], values: unknown): Record<string, unknown> {
  const vals = isPlainObject(values) ? values : {}
  const pages = layoutPages(layout)
  const out = withControlState(fields, vals, pages, layoutSectionControls(layout))
  return out === vals ? {} : { [CONTROLS_KEY]: out[CONTROLS_KEY] }
}

/** Every variable a rule can pick (This event for its When, then Controls). */
export function ruleVariables(rule: { event: FormRuleEventType; target?: string }, fields: FieldLike[], pages: PageLike[] = [], sections: SectionLike[] = []): RuleVariable[] {
  return [...eventVariables(rule.event, rule.target, fields), ...controlVariables(fields, pages, sections)]
}

/** Placeholder-menu options (VariableInput `extraVariables`) for these variables, typed. */
export function ruleVariableOptions(vars: RuleVariable[]): Array<{ name: string; group: string; label: string }> {
  return vars.map((v) => ({ name: v.path, group: v.group, label: `${v.label} · ${RULE_VARIABLE_TYPE_LABELS[v.type]}` }))
}
