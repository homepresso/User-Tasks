/**
 * The form designer's working state and its pure edit operations: fields
 * (each with a stable designer id, so a key rename is tracked), the grid and
 * the theme reference. Converted from / to the stored FormDefinition when the
 * dialog opens / saves. Every operation returns a new state (undo history).
 */

import { displayImageConfigProblem } from '@/lib/forms/media-fields'
import { richTextTextKey } from '@/lib/forms/rich-text'
import { textListConfigProblem } from '@/lib/forms/text-list'
import { urlConfigProblem } from '@/lib/forms/link-field'
import { isRowsField, rowCommitKit } from './row-rules'
import { isSurveyType, surveyFieldDefaults } from '@/lib/forms/survey/controls'
import {
  DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, fieldDefinitionProblems, fieldKeyFromLabel, fieldKeyProblem, normalizeTaskFields, uniqueFieldKey,
  type TaskFieldDef, type TaskFieldType,
} from '@/lib/task-field-schema'
import {
  defaultFormLayout, findCell, isPaged, mapStateTargets, layoutKeyOrder, normalizeFormLayout, pageGrid, pageOfField, placeField, removeFieldFromLayout,
  renameLayoutKey, withPageGrid, groupSectionRows, CHOICE_GROUP_LIMITS, type FormChoiceGroup, type FormLayout, type FormPage, type FormRow, type FormSection,
} from './layout'
import { choiceGroupKeys, sectionIncludedKey, sectionKeyFromTitle, sectionKeyProblem } from './sections'
import { addPage, pageFieldKeys, removePage } from './pages'
import { storedButtons, type FormDefinition } from './definition'
import { normalizeFormButtons, type FormButton } from './buttons'
import { defaultFormHeader, normalizeFormHeader, type FormHeader } from './header'
import { lookupConfigProblem, lookupItemKey } from './lookup'
import { ATTACHMENT_DEFAULTS, attachmentsConfigProblem, attachmentsCountKey } from './attachments'
import { REPEATING_EXCLUDED_TYPES, repeatingConfigProblem, repeatingListConfig } from './repeating-section'
import { DEFAULT_LIST_CONFIG, childListPaths, listConfigProblem, listDerivedKeys, listEntryKit, normalizeListConfig } from './list-field'
import type { FormThemeRef } from './form-theme'
import { takePendingCustomControl } from './custom-controls/palette'
import { customControlConfigProblem } from './custom-controls/field'
import { defaultFieldButton, fieldButtonProblem, type FieldButtonConfig } from './field-buttons'
import { dataTableConfigProblem } from './data-table'
import { formStateConfig, parseTarget } from './form-state'
import { formRuleProblem, newRuleId, normalizeFormRules, promptIds, renameRuleKey, type FormRule, type RuleKnown } from './form-rules'
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
  /**
   * A repeating section's inner form (sectionView): the form's other keys —
   * inner keys are unique over the whole form, so new / renamed keys avoid them.
   */
  outerKeys?: string[]
}

let counter = 0
export function designerId(): string {
  counter += 1
  return `f${Date.now().toString(36)}${counter.toString(36)}`
}

/** Stored definition → designer state (a missing layout becomes one full-width row per field). */
export function designerStateFrom(def: FormDefinition): DesignerState {
  const fields: DesignerField[] = def.fields.map((f) => withDesignerIds({ ...f, _id: designerId(), _keyLocked: true }))
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

/** A repeating section's inner fields get designer ids too (any level). */
function withDesignerIds(field: DesignerField): DesignerField {
  if (field.type !== 'repeating_section' || !field.repeating_section) return field
  const fields = field.repeating_section.fields.map((f) => withDesignerIds({ ...f, _id: (f as Partial<DesignerField>)._id ?? designerId(), _keyLocked: true }))
  return { ...field, repeating_section: { ...field.repeating_section, fields } }
}

/** A field without the designer's own props (deep: a section's inner fields too). */
function stripDesignerProps(field: TaskFieldDef): TaskFieldDef {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
  const { _id: _i, _keyLocked: _k, ...rest } = field as DesignerField
  return rest.type === 'repeating_section' && rest.repeating_section ? { ...rest, repeating_section: { ...rest.repeating_section, fields: rest.repeating_section.fields.map(stripDesignerProps) } } : rest
}

/** Every key in the state: its fields, their repeating sections' inner fields (any level), and the outer form's (a section view). */
export function takenKeys(state: { fields: TaskFieldDef[]; outerKeys?: string[] }): string[] {
  const out: string[] = [...(state.outerKeys ?? [])]
  const walk = (fields: TaskFieldDef[]) => { for (const f of fields) { out.push(f.key); if (f.type === 'repeating_section') walk(f.repeating_section?.fields ?? []) } }
  walk(state.fields)
  return out
}

/* ── Repeating sections: their inner form as a designer state ─────────── */

/**
 * A repeating section's inner form as a designer state (lib/forms/repeating-section.ts):
 * its fields (designer ids) and grid (rows, sections, per-item rules) — the
 * grid canvas, the field properties and the rules panel edit it like a form.
 * Null when `sectionId` is not a repeating section of the state.
 */
export function sectionView(state: DesignerState, sectionId: string): DesignerState | null {
  const section = state.fields.find((f) => f._id === sectionId)
  if (!section || section.type !== 'repeating_section') return null
  const config = section.repeating_section ?? { fields: [] }
  const fields = config.fields as DesignerField[]
  const keys = fields.map((f) => f.key)
  const stored = config.layout
  const placed = new Set((stored?.rows ?? []).flatMap((r) => r.cells.map((c) => c.field_key)))
  const rows = [...(stored?.rows ?? []), ...keys.filter((k) => !placed.has(k)).map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))]
  const own = new Set(takenKeys({ fields }))
  return {
    ...state,
    fields,
    layout: { rows, ...(stored?.sections ? { sections: stored.sections } : {}), ...(stored?.rules ? { rules: stored.rules } : {}) },
    outerKeys: takenKeys(state).filter((k) => !own.has(k)),
  }
}

/** Write a section view back into its repeating section. */
export function withSectionView(state: DesignerState, sectionId: string, view: DesignerState): DesignerState {
  return {
    ...state,
    fields: state.fields.map((f) => {
      if (f._id !== sectionId || f.type !== 'repeating_section') return f
      const layout = { rows: view.layout.rows, ...(view.layout.sections?.length ? { sections: view.layout.sections } : {}), ...(view.layout.rules?.length ? { rules: view.layout.rules } : {}) }
      return { ...f, repeating_section: { ...(f.repeating_section ?? { fields: [] }), fields: view.fields, layout } }
    }),
  }
}

/** The repeating sections (designer ids, outermost first) holding a field; [] = a field of the state itself; null = not found. */
export function designerFieldPath(state: Pick<DesignerState, 'fields'>, id: string): string[] | null {
  for (const f of state.fields) {
    if (f._id === id) return []
    if (f.type === 'repeating_section') {
      const inner = designerFieldPath({ fields: (f.repeating_section?.fields ?? []) as DesignerField[] }, id)
      if (inner) return [f._id, ...inner]
    }
  }
  return null
}

/** The designer state at a path of repeating sections ([] = the state itself). */
export function scopedView(state: DesignerState, path: string[]): DesignerState | null {
  let view: DesignerState | null = state
  for (const id of path) view = view ? sectionView(view, id) : null
  return view
}

/** Write a view at a path of repeating sections back. */
export function withScopedView(state: DesignerState, path: string[], view: DesignerState): DesignerState {
  if (!path.length) return { ...view, outerKeys: state.outerKeys }
  const [head, ...rest] = path
  const inner = sectionView(state, head)
  if (!inner) return state
  return withSectionView(state, head, withScopedView(inner, rest, view))
}

/** Take a field out of wherever it is (the state, or any repeating section in it): the state without it and the field. */
export function extractField(state: DesignerState, key: string): { state: DesignerState; field: DesignerField } | null {
  const own = state.fields.find((f) => f.key === key)
  if (own) return { state: removeField(state, own._id), field: own }
  for (const f of state.fields) {
    if (f.type !== 'repeating_section') continue
    const view = sectionView(state, f._id)
    const found = view ? extractField(view, key) : null
    if (found) return { state: withSectionView(state, f._id, found.state), field: found.field }
  }
  return null
}

/**
 * Move a field (by key, from anywhere in the form) into a repeating section's
 * grid at a position. Refused (null) for the section itself, a section that
 * holds the target, and controls an item can't hold (data tables, custom controls).
 */
export function moveIntoSection(state: DesignerState, sectionId: string, key: string, at: { row: number; index: number }): DesignerState | null {
  const section = state.fields.find((f) => f._id === sectionId)
  if (!section || section.type !== 'repeating_section' || section.key === key) return null
  const moving = takenKeys({ fields: [section] }).includes(key) ? null : (function find(fields: TaskFieldDef[]): TaskFieldDef | null {
    for (const f of fields) { if (f.key === key) return f; if (f.type === 'repeating_section') { const x = find(f.repeating_section?.fields ?? []); if (x) return x } }
    return null
  })(state.fields)
  if (!moving || REPEATING_EXCLUDED_TYPES.has(moving.type)) return null
  const out = extractField(state, key)
  if (!out) return null
  const view = sectionView(out.state, sectionId)
  if (!view) return null
  return withSectionView(out.state, sectionId, { ...view, fields: [...view.fields, out.field], layout: placeField(view.layout, key, at.row, at.index) })
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
  list: 'Line items',
  repeating_section: 'Items',
  label: 'Total',
  image: 'Photo',
  display_image: 'Picture',
  rich_text: 'Details',
  text_list: 'Items',
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
  if (type === 'list') field.list = structuredClone(DEFAULT_LIST_CONFIG)
  if (type === 'repeating_section') {
    // A starter item: a description across the card and an amount (USD) — drag more controls in.
    const used = [...taken, key]
    const description = uniqueFieldKey('Description', used)
    const amount = uniqueFieldKey('Amount', [...used, description])
    field.repeating_section = {
      fields: [
        { _id: designerId(), key: description, label: 'Description', type: 'text', required: true, _keyLocked: true } as DesignerField,
        { _id: designerId(), key: amount, label: 'Amount', type: 'currency', currency: 'USD', _keyLocked: true } as DesignerField,
      ],
      layout: { rows: [{ columns: 3, cells: [{ field_key: description, span: 2 }, { field_key: amount, span: 1 }] }] },
      start_items: 1,
    }
  }
  if (type === 'display_image') field.display_image = { src: '', alt: '' }
  if (type === 'signature') field.signature = { statement: 'I confirm the information above is correct.' }
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
  const field = newField(type, takenKeys(state))
  const next = onPage(state, pageId, (view) => ({
    ...view,
    fields: [...view.fields, field],
    layout: at ? placeField(view.layout, field.key, at.row, at.index) : placeField(view.layout, field.key, view.layout.rows.length, 0),
  }))
  return { state: next, field }
}

/**
 * The List field's helper "Add inputs and an Add button with a rule"
 * (lib/forms/list-field.ts listEntryKit): one input per column and an "Add …"
 * button in rows just above the list, and an "Add row to list" rule on the
 * button's click (values from the inputs, required columns required, the
 * inputs cleared after adding). Null when the field is not a List.
 */
export function addListEntryKit(state: DesignerState, listId: string, options: { edit?: 'button' | 'row_click' | false; selection?: 'single' | 'multiple' } = {}): { state: DesignerState; ruleId: string; fields: DesignerField[] } | null {
  const list = state.fields.find((f) => f._id === listId)
  if (!list || list.type !== 'list') return null
  const taken = (state.layout.rules ?? []).map((r) => r.id)
  const ruleId = newRuleId(taken)
  const ruleIds: string[] = []
  for (let i = 0; i < 4; i++) ruleIds.push(newRuleId([...taken, ruleId, ...ruleIds]))
  const kit = listEntryKit(list.key, list.label || list.key, normalizeListConfig(list.list), state.fields.map((f) => f.key), { ruleId, ruleIds, edit: options.edit, selection: options.selection })
  const added = kit.fields.map((f) => ({ ...f, _id: designerId(), _keyLocked: true }) as unknown as DesignerField)
  const inputs = added.filter((f) => f.type !== 'button')
  const buttons = added.filter((f) => f.type === 'button')
  const page = pageOfField(state.layout, list.key)?.id ?? null
  const next = onPage(state, page, (view) => {
    const rows = view.layout.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }))
    const at = findCell(view.layout, list.key)?.row ?? rows.length
    const section = rows[at]?.section
    const tag = section ? { section } : {}
    const fresh: FormRow[] = []
    for (let i = 0; i < inputs.length; i += 3) {
      const chunk = inputs.slice(i, i + 3)
      fresh.push({ columns: chunk.length, cells: chunk.map((f) => ({ field_key: f.key, span: 1 })), ...tag })
    }
    // The Add button, and (editing) the Cancel button beside it; the selection buttons (Edit / Delete selected, Clear) on a row of their own.
    const first = buttons.slice(0, 2)
    const rest = buttons.slice(2)
    fresh.push({ columns: Math.max(1, first.length), cells: first.map((f) => ({ field_key: f.key, span: 1 })), ...tag })
    if (rest.length) fresh.push({ columns: rest.length, cells: rest.map((f) => ({ field_key: f.key, span: 1 })), ...tag })
    rows.splice(at, 0, ...fresh)
    const fields = view.fields.map((f) => (f._id === listId ? { ...f, list: { ...normalizeListConfig(f.list), ...kit.listPatch } } : f))
    return { ...view, fields: [...fields, ...added], layout: { ...view.layout, rows } }
  })
  const rules = [...(next.layout.rules ?? []), ...normalizeFormRules([kit.rule, ...kit.editRules])]
  const stateConfig = next.layout.state ?? {}
  const flags = kit.flag && !(stateConfig.flags ?? []).some((f) => f.key === kit.flag) ? [...(stateConfig.flags ?? []), { key: kit.flag }] : stateConfig.flags
  return { state: { ...next, layout: { ...next.layout, rules, ...(flags ? { state: { ...stateConfig, flags } } : {}) } }, ruleId, fields: added }
}

/**
 * The "New → fill → Commit" kit (lib/forms/row-rules.ts rowCommitKit) for a
 * List or an editable Data table: inputs, New row / (Apply) / Save row
 * buttons above the field and their rules.
 */
export function addRowCommitKit(state: DesignerState, fieldId: string, options: { apply?: 'change' | 'button'; save?: 'stage' | 'save_now' } = {}): { state: DesignerState; fields: DesignerField[] } | null {
  const target = state.fields.find((f) => f._id === fieldId)
  if (!target || !isRowsField(target as never)) return null
  const taken = (state.layout.rules ?? []).map((r) => r.id)
  const ruleIds: string[] = []
  for (let i = 0; i < 40; i++) ruleIds.push(newRuleId([...taken, ...ruleIds]))
  const kit = rowCommitKit(target as never, state.fields.map((f) => f.key), { ...options, ruleIds })
  const added = kit.fields.map((f) => ({ ...f, _id: designerId(), _keyLocked: true }) as unknown as DesignerField)
  const inputs = added.filter((f) => f.type !== 'button')
  const buttons = added.filter((f) => f.type === 'button')
  const page = pageOfField(state.layout, target.key)?.id ?? null
  const next = onPage(state, page, (view) => {
    const rows = view.layout.rows.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c })) }))
    const at = findCell(view.layout, target.key)?.row ?? rows.length
    const section = rows[at]?.section
    const tag = section ? { section } : {}
    const fresh: FormRow[] = []
    for (let i = 0; i < inputs.length; i += 3) {
      const chunk = inputs.slice(i, i + 3)
      fresh.push({ columns: chunk.length, cells: chunk.map((f) => ({ field_key: f.key, span: 1 })), ...tag })
    }
    fresh.push({ columns: Math.max(1, buttons.length), cells: buttons.map((f) => ({ field_key: f.key, span: 1 })), ...tag })
    rows.splice(at, 0, ...fresh)
    return { ...view, fields: [...view.fields, ...added], layout: { ...view.layout, rows } }
  })
  const rules = [...(next.layout.rules ?? []), ...normalizeFormRules(kit.rules)]
  return { state: { ...next, layout: { ...next.layout, rules } }, fields: added }
}

export function duplicateField(state: DesignerState, id: string): { state: DesignerState; field: DesignerField } | null {
  const source = state.fields.find((f) => f._id === id)
  if (!source) return null
  const key = uniqueFieldKey(source.key, takenKeys(state))
  const field: DesignerField = { ...structuredClone(source), _id: designerId(), key, label: `${source.label} (copy)`, _keyLocked: true }
  // A copied repeating section: its inner controls get new keys (keys are unique over the form) and ids.
  if (field.type === 'repeating_section' && field.repeating_section) field.repeating_section = copySectionConfig(field.repeating_section, [...takenKeys(state), key])
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
    if (derived) next.key = uniqueFieldKey(derived, takenKeys({ ...state, fields: state.fields.filter((f) => f._id !== id) }))
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
  return fieldKeyProblem(field.key, [...state.fields.filter((f) => f._id !== id).map((f) => f.key), ...(state.outerKeys ?? [])])
}

/** A repeating section's config with new keys / ids for its inner controls (any level), the grid and totals following. */
function copySectionConfig(config: NonNullable<TaskFieldDef['repeating_section']>, taken: string[]): NonNullable<TaskFieldDef['repeating_section']> {
  const used = [...taken]
  const renames = new Map<string, string>()
  const fields = config.fields.map((f) => {
    const key = uniqueFieldKey(f.key, used)
    used.push(key)
    renames.set(f.key, key)
    const copy: DesignerField = { ...structuredClone(f), key, _id: designerId(), _keyLocked: true }
    if (copy.type === 'repeating_section' && copy.repeating_section) {
      copy.repeating_section = copySectionConfig(copy.repeating_section, used)
      used.push(...takenKeys({ fields: copy.repeating_section.fields as DesignerField[] }))
    }
    return copy
  })
  const rename = (k: string) => renames.get(k) ?? k
  const layout = config.layout ? { ...config.layout, rows: config.layout.rows.map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, field_key: rename(c.field_key) })) })) } : undefined
  let rules = layout?.rules
  for (const [from, to] of renames) rules = rules?.map((r) => renameRuleKey(r, from, to))
  return { ...config, fields, ...(layout ? { layout: { ...layout, ...(rules ? { rules } : {}) } } : {}), ...(config.totals ? { totals: config.totals.map((t) => ({ ...t, field: rename(t.field) })) } : {}) }
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
    if (field.type === 'display_image') {
      const problem = displayImageConfigProblem(field.display_image)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'rich_text' && state.fields.some((f) => f._id !== field._id && f.key === richTextTextKey(field.key))) {
      out[field._id] = `Another field uses the key "${richTextTextKey(field.key)}" (this field stores its plain text there)`
    }
    if (field.type === 'text_list') {
      const problem = textListConfigProblem(field.text_list)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'url') {
      const problem = urlConfigProblem(field.key, field.url_config, state.fields)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'list') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const clash = listDerivedKeys(field.key, field.list).find((k) => others.includes(k))
      const problem = listConfigProblem(field.list) ?? (clash ? `Another field uses the key "${clash}" (this list stores its row count / totals there)` : null)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'repeating_section') {
      // Its config, derived keys, and its inner controls' first problem (keys unique over the whole form).
      const outer = [...takenKeys({ ...state, fields: state.fields.filter((f) => f._id !== field._id) })]
      const config = normalizeTaskFields([{ ...field, key: field.key || 'section' }])[0]?.repeating_section
      const problem = repeatingConfigProblem(config, outer) ?? fieldDefinitionProblems(normalizeTaskFields(state.fields.map(stripDesignerProps)))[field.key]
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
    // …and choice groups' chosen section (`<group key>`, lib/forms/sections.ts): value_change on it, Set values into it.
    valueKeys: new Set([...state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !f.read_only).map((f) => f.key), ...choiceGroupKeys(state.layout)]),
    // Rules may also write read-only value fields (the server bounds what they may hold) — and Labels, unless an expression fills them.
    writableKeys: new Set([...state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && !(f.type === 'label' && f.label_config?.expression)).map((f) => f.key), ...choiceGroupKeys(state.layout)]),
    // A repeating section is a List to the List rules (lib/forms/repeating-section.ts asListField).
    fieldTypes: new Map(state.fields.map((f) => [f.key, f.type === 'repeating_section' ? 'list' : f.type])),
    listChildren: new Map(state.fields.filter((f) => f.type === 'list' || f.type === 'repeating_section').map((f) => [f.key, new Set(childListPaths(f.type === 'list' ? normalizeListConfig(f.list) : repeatingListConfig(f.repeating_section)).map((p) => p.join('.')))])),
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
  // Choice groups: the alternative renamed, or dropped (a group left with one alternative goes).
  if (layout.choice_groups?.length) {
    const groups = layout.choice_groups
      .map((g) => {
        const sections = g.sections.flatMap((k) => (k === from ? (to ? [to] : []) : [k]))
        const def = g.default === from ? (to ?? undefined) : g.default
        return { ...g, sections, ...(def ? { default: def } : {}) }
      })
      .map((g) => (g.default && !g.sections.includes(g.default) ? (({ default: _d, ...rest }) => rest)(g) : g)) // eslint-disable-line @typescript-eslint/no-unused-vars
      .filter((g) => g.sections.length >= 2)
    layout = { ...layout, choice_groups: groups }
    if (!groups.length) delete layout.choice_groups
  }
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

/* ── Choice groups (lib/forms/sections.ts) ─────────────────────────── */

/** A choice group from sections (at least two; the first is the default). Returns the new group's key. */
export function addChoiceGroup(state: DesignerState, sectionKeys: string[], label = 'Choose one'): { state: DesignerState; key: string } | null {
  const declared = new Set((state.layout.sections ?? []).map((s) => s.key))
  const inGroups = new Set((state.layout.choice_groups ?? []).flatMap((g) => g.sections))
  const sections = [...new Set(sectionKeys)].filter((k) => declared.has(k) && !inGroups.has(k)).slice(0, CHOICE_GROUP_LIMITS.max)
  if (sections.length < CHOICE_GROUP_LIMITS.min) return null
  const taken = [...state.fields.map((f) => f.key), ...declared, ...(state.layout.choice_groups ?? []).map((g) => g.key)]
  const key = sectionKeyFromTitle(label, taken)
  const group: FormChoiceGroup = { key, label, sections }
  return { state: { ...state, layout: { ...state.layout, choice_groups: [...(state.layout.choice_groups ?? []), group] } }, key }
}

/** Patch a choice group (label, key, sections, default, display); a group left with fewer than two sections is removed. */
export function updateChoiceGroup(state: DesignerState, key: string, patch: Partial<FormChoiceGroup>): DesignerState {
  const groups = state.layout.choice_groups ?? []
  const current = groups.find((g) => g.key === key)
  if (!current) return state
  const next: FormChoiceGroup = { ...current, ...patch }
  if (!next.default || !next.sections.includes(next.default)) delete next.default
  if (!next.display || next.display === 'radio') delete next.display
  if (next.sections.length < CHOICE_GROUP_LIMITS.min) return removeChoiceGroup(state, key)
  let out: DesignerState = { ...state, layout: { ...state.layout, choice_groups: groups.map((g) => (g.key === key ? next : g)) } }
  // A new key: rules reading / setting the old one follow (conditions, Set values, value_change targets).
  if (next.key !== key) out = { ...out, layout: { ...out.layout, ...(out.layout.rules?.length ? { rules: normalizeFormRules(out.layout.rules).map((r) => renameRuleKey(r, key, next.key)) } : {}) } }
  return out
}

/** Remove a choice group (its sections stay, each shown as an ordinary section). */
export function removeChoiceGroup(state: DesignerState, key: string): DesignerState {
  const groups = (state.layout.choice_groups ?? []).filter((g) => g.key !== key)
  const layout: FormLayout = { ...state.layout, choice_groups: groups }
  if (!groups.length) delete layout.choice_groups
  return { ...state, layout }
}

/** Choice group problems (group key → message): a key clashing with a field / section, fewer than two sections. */
export function designerChoiceGroupProblems(state: DesignerState): Record<string, string> {
  const out: Record<string, string> = {}
  const groups = state.layout.choice_groups ?? []
  const fieldKeys = new Set(state.fields.map((f) => f.key))
  const sectionKeys = new Set((state.layout.sections ?? []).map((s) => s.key))
  groups.forEach((g, i) => {
    if (!/^[a-z][a-z0-9_]{0,51}$/.test(g.key)) out[g.key] = 'Key: lowercase letters, digits and _ (start with a letter)'
    else if (fieldKeys.has(g.key)) out[g.key] = `A field already uses the key "${g.key}"`
    else if (sectionKeys.has(g.key) || [...sectionKeys].some((s) => sectionIncludedKey(s) === g.key)) out[g.key] = `A section uses the key "${g.key}"`
    else if (groups.some((o, j) => j !== i && o.key === g.key)) out[g.key] = `Another choice group uses the key "${g.key}"`
    else if (g.sections.filter((k) => sectionKeys.has(k)).length < CHOICE_GROUP_LIMITS.min) out[g.key] = 'A choice group needs at least two sections'
    else if (!g.label.trim()) out[g.key] = 'A choice group needs a label'
  })
  return out
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
