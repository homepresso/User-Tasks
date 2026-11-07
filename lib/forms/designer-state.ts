/**
 * The form designer's working state and its pure edit operations: fields
 * (each with a stable designer id, so a key rename is tracked), the grid and
 * the theme reference. Converted from / to the stored FormDefinition when the
 * dialog opens / saves. Every operation returns a new state (undo history).
 */

import { isSurveyType, surveyFieldDefaults } from '@/lib/forms/survey/controls'
import {
  DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, fieldKeyFromLabel, fieldKeyProblem, normalizeTaskFields, uniqueFieldKey,
  type TaskFieldDef, type TaskFieldType,
} from '@/lib/task-field-schema'
import {
  defaultFormLayout, findCell, isPaged, mapStateTargets, layoutKeyOrder, normalizeFormLayout, pageGrid, pageOfField, placeField, removeFieldFromLayout,
  renameLayoutKey, withPageGrid, groupSectionRows, type FormLayout, type FormPage, type FormRow, type FormSection,
} from './layout'
import { sectionIncludedKey, sectionKeyFromTitle, sectionKeyProblem } from './sections'
import { addPage, pageFieldKeys, removePage } from './pages'
import { storedButtons, type FormDefinition } from './definition'
import { normalizeFormButtons, type FormButton } from './buttons'
import { defaultFormHeader, normalizeFormHeader, type FormHeader } from './header'
import { lookupConfigProblem, lookupItemKey } from './lookup'
import { ATTACHMENT_DEFAULTS, attachmentsConfigProblem, attachmentsCountKey } from './attachments'
import type { FormThemeRef } from './form-theme'
import { takePendingCustomControl } from './custom-controls/palette'
import { customControlConfigProblem } from './custom-controls/field'
import { defaultFieldButton, fieldButtonProblem, type FieldButtonConfig } from './field-buttons'
import { dataTableConfigProblem } from './data-table'
import { formStateConfig, parseTarget } from './form-state'
import { formRuleProblem, normalizeFormRules, promptIds, type FormRule, type RuleKnown } from './form-rules'
import type { DataTableCondition, DataTableConditionGroup } from './data-table'
import { layoutFormVariables } from './form-params'
import { expressionKnown, expressionProblems, labelOrder, renameExpressionKey } from './label-field'

export interface DesignerField extends TaskFieldDef {
  /** Stable id inside the designer (never saved). */
  _id: string
  /** The author edited the key: stop deriving it from the label. */
  _keyLocked?: boolean
}

export interface DesignerState {
  fields: DesignerField[]
  layout: FormLayout
  theme: FormThemeRef
  /** The button bar (the defaults when the form has none stored). */
  buttons: FormButton[]
  /** The header (enabled: false when the form has none). */
  header: FormHeader
}

let counter = 0
export function designerId(): string {
  counter += 1
  return `f${Date.now().toString(36)}${counter.toString(36)}`
}

/** Stored definition → designer state (a missing layout becomes one full-width row per field). */
export function designerStateFrom(def: FormDefinition): DesignerState {
  const fields: DesignerField[] = def.fields.map((f) => ({ ...f, _id: designerId(), _keyLocked: true }))
  const keys = fields.map((f) => f.key)
  // New (empty) forms start with a header; existing forms keep theirs (or none).
  const header = def.header ?? (def.fields.length === 0 ? defaultFormHeader() : { ...defaultFormHeader(), enabled: false })
  return {
    fields,
    layout: def.layout ?? normalizeFormLayout(null, keys) ?? defaultFormLayout(keys),
    theme: def.theme,
    buttons: normalizeFormButtons(def.buttons ?? null),
    header,
  }
}

/** The header to store: null when off and never customised. */
function storedHeader(header: FormHeader): FormHeader | null {
  const normalized = normalizeFormHeader(header)
  if (!normalized) return null
  if (!normalized.enabled && !normalized.title && !normalized.subtitle && normalized.image === 'default' && !normalized.banner && normalized.align !== 'center') return null
  return normalized
}

/** Designer state → stored definition (designer-only props dropped; fields in grid reading order). */
export function definitionFrom(state: DesignerState): FormDefinition {
  const order = new Map(layoutKeyOrder(state.layout).map((key, i) => [key, i]))
  const fields = [...state.fields]
    .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
    .map(({ _id: _i, _keyLocked: _k, ...field }) => field)
  const normalized = normalizeTaskFields(fields)
  const keys = normalized.map((f) => f.key)
  return {
    fields: normalized,
    layout: normalizeFormLayout(state.layout, keys),
    theme: state.theme,
    buttons: storedButtons(state.buttons),
    header: storedHeader(state.header),
  }
}

const DEFAULT_LABELS: Partial<Record<TaskFieldType, string>> = {
  heading: 'Section',
  divider: 'Divider',
  button: 'Show more',
  data_table: 'Table',
  label: 'Total',
}

/** A new field of `type` with a unique key (label "Text", "Number 2", …). */
export function newField(type: TaskFieldType, taken: string[]): DesignerField {
  // A custom control comes from the palette (lib/forms/custom-controls/palette.ts).
  const custom = type === 'custom' ? takePendingCustomControl() : null
  const base = custom?.name ?? DEFAULT_LABELS[type] ?? TASK_FIELD_TYPE_LABELS[type].replace(/\s*\(.*\)$/, '')
  const key = uniqueFieldKey(base, taken)
  const suffix = key.match(/_(\d+)$/)?.[1]
  const label = suffix && !fieldKeyFromLabel(base).endsWith(`_${suffix}`) ? `${base} ${suffix}` : base
  const field: DesignerField = { _id: designerId(), key, label, type }
  if (type === 'choice' || type === 'multi_choice') field.options = ['Option 1', 'Option 2']
  // Survey controls start with a sensible scale / options (lib/forms/survey/controls.ts).
  if (isSurveyType(type)) Object.assign(field, structuredClone(surveyFieldDefaults(type)))
  if (type === 'currency') field.currency = 'USD'
  if (type === 'lookup') field.lookup = { source: 'table' }
  if (type === 'attachments' || custom?.value_type === 'files') field.attachments = { max_files: ATTACHMENT_DEFAULTS.max_files, max_file_mb: ATTACHMENT_DEFAULTS.max_file_mb, types: ['any'] }
  if (custom) field.custom = custom
  if (type === 'button') field.button = defaultFieldButton()
  if (type === 'data_table') field.data_table = { source: 'table', mode: 'display', columns: [] }
  return field
}

/** Rewrite the field keys / page ids a button's actions point at (null: drop the reference). */
export function mapButtonRefs(config: FieldButtonConfig, mapKey: (key: string) => string | null, mapPage: (id: string) => string | null = (id) => id): FieldButtonConfig {
  const mapAction = (a: FieldButtonConfig['actions'][number]): FieldButtonConfig['actions'][number] => {
    const next = { ...a }
    if (a.targets) {
      next.targets = a.targets.map((target) => {
        const t = parseTarget(target)
        if (!t) return null
        const id = t.kind === 'page' ? mapPage(t.id) : mapKey(t.id)
        return id ? `${t.kind}:${id}` : null
      }).filter((t): t is string => Boolean(t))
    }
    if (a.assign) next.assign = Object.fromEntries(Object.entries(a.assign).flatMap(([k, v]) => { const to = mapKey(k); return to ? [[to, v]] : [] }))
    if (a.fields) next.fields = a.fields.map(mapKey).filter((k): k is string => Boolean(k))
    if (a.page) { const to = mapPage(a.page); if (to) next.page = to; else delete next.page }
    // A question's responses point at fields / pages too.
    if (a.prompt) next.prompt = { ...a.prompt, buttons: a.prompt.buttons.map((b) => (b.then ? { ...b, then: b.then.map(mapAction) } : b)) }
    return next
  }
  const actions = config.actions.map(mapAction)
  const out: FieldButtonConfig = { ...config, actions }
  if (config.disabled_when) {
    const to = config.disabled_when.field.startsWith('state.') ? config.disabled_when.field : mapKey(config.disabled_when.field)
    if (to) out.disabled_when = { ...config.disabled_when, field: to }
    else delete out.disabled_when
  }
  return out
}

function withButtonRefs(fields: DesignerField[], mapKey: (key: string) => string | null): DesignerField[] {
  return fields.map((f) => (f.type === 'button' && f.button ? { ...f, button: mapButtonRefs(f.button, mapKey) } : f))
}

/**
 * Run a grid edit on one page of a steps / tabs form: `fn` sees that page's
 * rows as the layout (row indexes are the page's), and the result is put
 * back. Fields `fn` removed also lose any page rule on them. Without pages
 * it is `fn(state)`.
 */
export function onPage(state: DesignerState, pageId: string | null | undefined, fn: (view: DesignerState) => DesignerState): DesignerState {
  if (!isPaged(state.layout)) {
    // Grid operations return just the rows: keep the layout's form state / Application mode.
    const next = fn(state)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
    const { rows: _rows, ...extras } = state.layout
    return { ...next, layout: { ...extras, ...next.layout } }
  }
  const id = state.layout.pages.find((p) => p.id === pageId)?.id ?? state.layout.pages[0].id
  const next = fn({ ...state, layout: pageGrid(state.layout, id) })
  let layout = withPageGrid(state.layout, id, next.layout)
  const kept = new Set(next.fields.map((f) => f.key))
  for (const field of state.fields) if (!kept.has(field.key)) layout = removeFieldFromLayout(layout, field.key)
  return { ...next, layout }
}

/** Add a field of `type` at a grid position (default: a new full-width row at the end; of page `pageId` on a paged form). */
export function addField(state: DesignerState, type: TaskFieldType, at?: { row: number; index: number }, pageId?: string | null): { state: DesignerState; field: DesignerField } {
  const field = newField(type, state.fields.map((f) => f.key))
  const next = onPage(state, pageId, (view) => ({
    ...view,
    fields: [...view.fields, field],
    layout: at ? placeField(view.layout, field.key, at.row, at.index) : placeField(view.layout, field.key, view.layout.rows.length, 0),
  }))
  return { state: next, field }
}

export function duplicateField(state: DesignerState, id: string): { state: DesignerState; field: DesignerField } | null {
  const source = state.fields.find((f) => f._id === id)
  if (!source) return null
  const key = uniqueFieldKey(source.key, state.fields.map((f) => f.key))
  const field: DesignerField = { ...structuredClone(source), _id: designerId(), key, label: `${source.label} (copy)`, _keyLocked: true }
  const next = onPage(state, pageOfField(state.layout, source.key)?.id, (view) => {
    const at = findCell(view.layout, source.key)
    const layout = at ? placeField(view.layout, key, at.row, at.index + 1) : placeField(view.layout, key, view.layout.rows.length, 0)
    return { ...view, fields: [...view.fields, field], layout }
  })
  return { state: next, field }
}

/**
 * Duplicate a page with copies of its fields (new keys, "(copy)" labels),
 * inserted after it. Rules inside the copy that point at a copied field
 * point at the copy.
 */
export function duplicatePage(state: DesignerState, pageId: string): { state: DesignerState; id: string } | null {
  if (!isPaged(state.layout)) return null
  const source = state.layout.pages.find((p) => p.id === pageId)
  if (!source) return null
  const added = addPage(state.layout, { title: `${source.title} (copy)`.slice(0, 80), after: pageId })
  if (!added.id) return null
  const taken = state.fields.map((f) => f.key)
  const rename = new Map<string, string>()
  const copies: DesignerField[] = []
  for (const key of pageFieldKeys(source)) {
    const original = state.fields.find((f) => f.key === key)
    if (!original) continue
    const copyKey = uniqueFieldKey(key, taken)
    taken.push(copyKey)
    rename.set(key, copyKey)
    copies.push({ ...structuredClone(original), _id: designerId(), key: copyKey, label: original.label ? `${original.label} (copy)` : original.label, _keyLocked: true })
  }
  for (const copy of copies) if (copy.visible_when && rename.has(copy.visible_when.field)) copy.visible_when = { ...copy.visible_when, field: rename.get(copy.visible_when.field)! }
  const rows = source.rows.filter((row) => row.cells.length).map((row) => ({ columns: row.columns, cells: row.cells.filter((c) => rename.has(c.field_key)).map((c) => ({ field_key: rename.get(c.field_key)!, span: c.span })) }))
  const pages = added.layout.pages!.map((p): FormPage => (p.id === added.id ? {
    ...p,
    rows,
    ...(source.description ? { description: source.description } : {}),
    ...(source.icon ? { icon: source.icon } : {}),
    ...(source.visible_when ? { visible_when: { ...source.visible_when } } : {}),
  } : p))
  return { state: { ...state, fields: [...state.fields, ...copies], layout: { ...added.layout, pages } }, id: added.id }
}

/** Delete a page: its fields move to `moveTo`, or (null) are deleted with it. */
export function deletePage(state: DesignerState, pageId: string, moveTo: string | null): DesignerState {
  const { layout, removedKeys } = removePage(state.layout, pageId, moveTo)
  if (layout === state.layout) return state
  const removed = new Set(removedKeys)
  const fields = state.fields.filter((f) => !removed.has(f.key)).map((f) => (f.visible_when && removed.has(f.visible_when.field) ? { ...f, visible_when: undefined } : f))
  return {
    ...state,
    layout: mapStateTargets(layout, (t) => (t === `page:${pageId}` ? null : t)),
    fields: fields.map((f) => (f.type === 'button' && f.button ? { ...f, button: mapButtonRefs(f.button, (k) => (removed.has(k) ? null : k), (id) => (id === pageId ? null : id)) } : f)),
  }
}

export function removeField(state: DesignerState, id: string): DesignerState {
  const field = state.fields.find((f) => f._id === id)
  if (!field) return state
  return {
    ...state,
    fields: withButtonRefs(state.fields.filter((f) => f._id !== id).map((f) => (f.visible_when?.field === field.key ? { ...f, visible_when: undefined } : f)), (k) => (k === field.key ? null : k)),
    layout: removeFieldFromLayout(state.layout, field.key),
  }
}

/**
 * Patch a field. A label change re-derives the key while the author hasn't
 * edited it; a key change (explicit or derived) is carried into the layout
 * and into other fields' `visible_when`.
 */
export function updateField(state: DesignerState, id: string, patch: Partial<TaskFieldDef>): DesignerState {
  const current = state.fields.find((f) => f._id === id)
  if (!current) return state
  const next: DesignerField = { ...current, ...patch }
  if (patch.key !== undefined) next._keyLocked = true
  else if (patch.label !== undefined && !current._keyLocked) {
    const derived = fieldKeyFromLabel(patch.label)
    if (derived) next.key = uniqueFieldKey(derived, state.fields.filter((f) => f._id !== id).map((f) => f.key))
  }
  if (DISPLAY_FIELD_TYPES.has(next.type)) {
    delete next.required
    delete next.read_only
  }
  let layout = state.layout
  let fields = state.fields.map((f) => (f._id === id ? next : f))
  if (next.key !== current.key) {
    layout = renameLayoutKey(layout, current.key, next.key)
    fields = fields.map((f) => (f.visible_when?.field === current.key ? { ...f, visible_when: { ...f.visible_when, field: next.key } } : f))
    fields = withButtonRefs(fields, (k) => (k === current.key ? next.key : k))
    // Labels' expressions name fields too (lib/forms/label-field.ts).
    fields = fields.map((f) => (f.type === 'label' && f.label_config?.expression ? { ...f, label_config: { ...f.label_config, expression: renameExpressionKey(f.label_config.expression, current.key, next.key) } } : f))
  }
  return { ...state, fields, layout }
}

/** Key problem for a field (null = ok). */
export function keyProblemFor(state: DesignerState, id: string): string | null {
  const field = state.fields.find((f) => f._id === id)
  if (!field) return null
  return fieldKeyProblem(field.key, state.fields.filter((f) => f._id !== id).map((f) => f.key))
}

/** Every blocking problem (field id → message): keys, labels, empty choices, buttons' actions. */
export function designerProblems(state: DesignerState): Record<string, string> {
  const out: Record<string, string> = {}
  const paged = isPaged(state.layout)
  const buttonKnown = {
    fieldKeys: new Set(state.fields.map((f) => f.key)),
    // A Button's steps set inputs (a Label is filled by rules: the server checks those).
    valueKeys: new Set(state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !f.read_only && f.type !== 'label').map((f) => f.key)),
    headingKeys: new Set(state.fields.filter((f) => f.type === 'heading').map((f) => f.key)),
    sectionKeys: new Set((state.layout.sections ?? []).map((s) => s.key)),
    pageIds: new Set(paged ? state.layout.pages!.map((p) => p.id) : []),
    flags: new Set((formStateConfig(state.layout).flags ?? []).map((f) => f.key)),
    barButtons: state.buttons,
    editableTables: new Set(state.fields.filter((f) => f.type === 'data_table' && f.data_table?.mode === 'edit').map((f) => f.key)),
    paged,
    policy: { appOrigin: typeof window !== 'undefined' ? window.location.origin : null },
  }
  for (const field of state.fields) {
    const keyProblem = keyProblemFor(state, field._id)
    if (keyProblem) { out[field._id] = keyProblem; continue }
    if (!field.label.trim() && field.type !== 'divider') { out[field._id] = 'Label is required'; continue }
    if ((field.type === 'choice' || field.type === 'multi_choice') && !(field.options ?? []).some((o) => o.trim()) && !field.options_source && !field.dynamic?.options) {
      out[field._id] = 'Add at least one option'
      continue
    }
    if (field.type === 'lookup') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const problem = lookupConfigProblem(field.lookup, field.key, others)
        ?? (others.includes(lookupItemKey(field.key)) ? `Another field uses the key "${lookupItemKey(field.key)}" (this lookup stores its selected item there)` : null)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'data_table') {
      const problem = dataTableConfigProblem(field.data_table)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'label' && field.label_config?.expression) {
      const { cyclic } = labelOrder(state.fields)
      const problem = cyclic.has(field.key) ? 'The expression reads itself (directly or through other labels)' : expressionProblems(field.label_config.expression, expressionKnown(state.fields, state.layout, field.key))[0]
      if (problem) out[field._id] = `Expression: ${problem}`
    }
    if (field.type === 'attachments') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const problem = attachmentsConfigProblem(field.attachments)
        ?? (others.includes(attachmentsCountKey(field.key)) ? `Another field uses the key "${attachmentsCountKey(field.key)}" (this field stores its file count there)` : null)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'custom') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const problem = customControlConfigProblem(field.custom, others)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'button') {
      // A button whose clicks are handled by form rules needs no steps of its own.
      const ruled = (state.layout.rules ?? []).some((r) => r.event === 'button_click' && r.target === field.key && !r.disabled)
      const problem = ruled && !field.button?.actions.length ? null : fieldButtonProblem(field.button, buttonKnown)
      if (problem) out[field._id] = problem
      else if (field.visible_when?.field.startsWith('state.') && !buttonKnown.flags.has(field.visible_when.field.slice(6))) out[field._id] = `"Visible when" uses an undeclared state flag (${field.visible_when.field})`
    }
    if (field.type !== 'button' && field.visible_when?.field.startsWith('state.') && !buttonKnown.flags.has(field.visible_when.field.slice(6))) {
      out[field._id] = `"Visible when" uses an undeclared state flag (${field.visible_when.field})`
    }
  }
  return out
}

/** Problems of the form's own rules (layout.rules): rule id → message. */
export function designerRuleProblems(state: DesignerState): Record<string, string> {
  const out: Record<string, string> = {}
  const paged = isPaged(state.layout)
  const known: RuleKnown = {
    fieldKeys: new Set(state.fields.map((f) => f.key)),
    valueKeys: new Set(state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !f.read_only).map((f) => f.key)),
    // Rules may also write read-only value fields (the server bounds what they may hold) — and Labels, unless an expression fills them.
    writableKeys: new Set(state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !(f.type === 'label' && f.label_config?.expression)).map((f) => f.key)),
    fieldTypes: new Map(state.fields.map((f) => [f.key, f.type])),
    headingKeys: new Set(state.fields.filter((f) => f.type === 'heading').map((f) => f.key)),
    sectionKeys: new Set((state.layout.sections ?? []).map((s) => s.key)),
    pageIds: new Set(paged ? state.layout.pages!.map((p) => p.id) : []),
    flags: new Set((formStateConfig(state.layout).flags ?? []).map((f) => f.key)),
    barButtons: state.buttons,
    variables: new Set(layoutFormVariables(state.layout).map((v) => v.name)),
    messageIds: new Set(promptIds({ fields: state.fields as never, layout: state.layout as never })),
  }
  for (const rule of state.layout.rules ?? []) {
    const problem = formRuleProblem(rule, known)
    if (problem) out[rule.id] = problem
  }
  return out
}

/* ── Sections (lib/forms/sections.ts) ──────────────────────────────── */

/** Every grid of the layout (each page's, or the single one) — rows edited in place by `fn`. */
function mapLayoutRows(layout: FormLayout, fn: (rows: FormRow[], pageId: string | null) => FormRow[]): FormLayout {
  if (isPaged(layout)) return { ...layout, pages: layout.pages.map((p) => ({ ...p, rows: fn(p.rows, p.id) })) }
  return { ...layout, rows: fn(layout.rows, null) }
}

/** Add a section (an empty row of it) at the end of a page's grid (or before row `at`). Returns its key. */
export function addSection(state: DesignerState, pageId?: string | null, options: { title?: string; at?: number } = {}): { state: DesignerState; key: string } {
  const title = options.title?.trim() || 'Section'
  const taken = [...state.fields.map((f) => f.key), ...(state.layout.sections ?? []).map((s) => s.key)]
  const key = sectionKeyFromTitle(title, taken)
  const section: FormSection = { key, title }
  const next = onPage(state, pageId, (view) => {
    const rows = view.layout.rows.map((r) => ({ ...r }))
    const at = options.at === undefined ? rows.length : Math.max(0, Math.min(rows.length, options.at))
    // Inside another section's run: go after it (sections don't nest).
    let index = at
    while (index > 0 && index < rows.length && rows[index].section && rows[index].section === rows[index - 1].section) index++
    rows.splice(index, 0, { columns: 1, cells: [], section: key })
    return { ...view, layout: { ...view.layout, rows } }
  })
  return { state: { ...next, layout: { ...next.layout, sections: [...(next.layout.sections ?? []), section] } }, key }
}

/** Rewrite a section key everywhere it is named (targets, conditions, `<key>_included` reads); null drops the references. */
function renameSectionRefs(state: DesignerState, from: string, to: string | null): DesignerState {
  const target = (t: string) => (t === `section:${from}` ? (to ? `section:${to}` : null) : t)
  const included = sectionIncludedKey(from)
  const column = (c: string) => (c === `section.${from}.included` || c === `section.${from}.visible` || c === `section.${from}.loaded` ? (to ? c.replace(`section.${from}.`, `section.${to}.`) : c) : c === included && to ? sectionIncludedKey(to) : c)
  const group = (g: DataTableConditionGroup): DataTableConditionGroup => ({
    match: g.match,
    conditions: g.conditions.map((c) => ('conditions' in c ? group(c as DataTableConditionGroup) : { ...(c as DataTableCondition), column: column((c as DataTableCondition).column) })),
  })
  const mapActions = (actions: FormRule['then']): FormRule['then'] => actions.map((a) => ({
    ...a,
    ...(a.targets ? { targets: a.targets.map(target).filter((t): t is string => Boolean(t)) } : {}),
    ...(a.prompt ? { prompt: { ...a.prompt, buttons: a.prompt.buttons.map((b) => (b.then ? { ...b, then: mapActions(b.then) } : b)) } } : {}),
  }))
  const rules = normalizeFormRules(state.layout.rules).map((r) => ({
    ...r,
    ...(r.event === 'section_change' && r.target === from ? (to ? { target: to } : {}) : {}),
    ...(r.event === 'part_loaded' && r.target === `section:${from}` ? (to ? { target: `section:${to}` } : {}) : {}),
    ...(r.if ? { if: group(r.if) } : {}),
    then: mapActions(r.then),
  }))
  let layout: FormLayout = { ...state.layout, ...(rules.length ? { rules } : {}) }
  layout = mapStateTargets(layout, target)
  const fields = state.fields.map((f) => (f.type === 'button' && f.button ? { ...f, button: { ...f.button, actions: mapActions(f.button.actions) } } : f))
  return { ...state, layout, fields }
}

/** Patch a section (a new key is carried into rows, rules, buttons and start-hidden targets). */
export function updateSection(state: DesignerState, key: string, patch: Partial<FormSection>): DesignerState {
  const sections = state.layout.sections ?? []
  const current = sections.find((s) => s.key === key)
  if (!current) return state
  const next: FormSection = { ...current, ...patch }
  for (const k of ['description', 'visible_when', 'add_label'] as const) if (k in patch && !patch[k]) delete next[k]
  for (const k of ['optional', 'collapsible', 'collapsed', 'preload'] as const) if (k in patch && !patch[k]) delete next[k]
  if (!next.collapsible) delete next.collapsed
  if (!next.load || next.load === 'eager') { delete next.load; delete next.preload }
  if (next.style !== 'plain') delete next.style
  if (!next.optional) delete next.add_label
  let out: DesignerState = { ...state, layout: { ...state.layout, sections: sections.map((s) => (s.key === key ? next : s)) } }
  if (next.key !== key) {
    out = { ...out, layout: mapLayoutRows(out.layout, (rows) => rows.map((r) => (r.section === key ? { ...r, section: next.key } : r))) }
    out = renameSectionRefs(out, key, next.key)
  }
  return out
}

/** Remove a section: its rows stay where they are, outside any section (undo brings it back). */
export function removeSection(state: DesignerState, key: string): DesignerState {
  let layout = mapLayoutRows(state.layout, (rows) => rows
    .filter((r) => !(r.section === key && r.cells.length === 0))
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
    .map((r) => { if (r.section !== key) return r; const { section: _s, ...rest } = r; return rest }))
  const sections = (layout.sections ?? []).filter((s) => s.key !== key)
  layout = { ...layout, sections }
  if (!sections.length) delete layout.sections
  return renameSectionRefs({ ...state, layout }, key, null)
}

/**
 * Convert a Section heading into a section: the rows under it (up to the next
 * heading or divider on its grid — the old "section" a `section:<heading>`
 * target meant) join a new section titled like the heading (its help text
 * the description, its Visible when the section's); the heading goes, and
 * targets naming it as a section point at the new one.
 */
export function convertHeadingToSection(state: DesignerState, headingId: string): { state: DesignerState; key: string } | null {
  const heading = state.fields.find((f) => f._id === headingId && f.type === 'heading')
  if (!heading) return null
  const boundaries = new Set(state.fields.filter((f) => f.type === 'heading' || f.type === 'divider').map((f) => f.key))
  const taken = [...state.fields.map((f) => f.key), ...(state.layout.sections ?? []).map((s) => s.key)]
  const key = sectionKeyFromTitle(heading.label || 'Section', taken)
  let found = false
  let layout = mapLayoutRows(state.layout, (rows) => {
    const at = rows.findIndex((r) => r.cells.some((c) => c.field_key === heading.key))
    if (at < 0 || rows[at].section) return rows
    found = true
    const out = rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c })) }))
    out[at].cells = out[at].cells.filter((c) => c.field_key !== heading.key)
    out[at].section = key
    for (let i = at + 1; i < out.length; i++) {
      if (out[i].section || out[i].cells.some((c) => boundaries.has(c.field_key))) break
      out[i].section = key
    }
    // The heading's own row, now empty, stays only when the section has no other row.
    const kept = out.filter((r, i) => !(i === at && r.cells.length === 0 && out.some((o, j) => j !== at && o.section === key)))
    return groupSectionRows(kept)
  })
  if (!found) return null
  const section: FormSection = { key, title: heading.label || 'Section' }
  if (heading.help_text) section.description = heading.help_text.slice(0, 500)
  if (heading.visible_when) section.visible_when = { ...heading.visible_when }
  layout = { ...layout, sections: [...(layout.sections ?? []), section] }
  let next: DesignerState = { ...state, layout, fields: state.fields.filter((f) => f._id !== headingId) }
  next = renameSectionRefs(next, heading.key, key)
  next = { ...next, layout: removeFieldFromLayout(next.layout, heading.key) }
  return { state: next, key }
}

/** Section problems (section key → message): keys clashing with fields, titles missing. */
export function designerSectionProblems(state: DesignerState): Record<string, string> {
  const out: Record<string, string> = {}
  const sections = state.layout.sections ?? []
  const fieldKeys = state.fields.map((f) => f.key)
  sections.forEach((s, i) => {
    const problem = sectionKeyProblem(s.key, fieldKeys, sections.filter((_, j) => j !== i).map((x) => x.key))
    if (problem) out[s.key] = problem
    else if (!s.title.trim()) out[s.key] = 'A section needs a title'
  })
  return out
}

/** Keys renamed since the dialog opened (by designer id), for the downstream-reference check. */
export function keyRenames(initial: Map<string, string>, state: DesignerState): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  for (const field of state.fields) {
    const before = initial.get(field._id)
    if (before && before !== field.key) out.push({ from: before, to: field.key })
  }
  return out
}
