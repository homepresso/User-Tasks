/**
 * The form designer's working state and its pure edit operations: fields
 * (each with a stable designer id, so a key rename is tracked), the grid and
 * the theme reference. Converted from / to the stored FormDefinition when the
 * dialog opens / saves. Every operation returns a new state (undo history).
 */

import {
  DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, fieldKeyFromLabel, fieldKeyProblem, normalizeTaskFields, uniqueFieldKey,
  type TaskFieldDef, type TaskFieldType,
} from '@/lib/task-field-schema'
import {
  defaultFormLayout, findCell, normalizeFormLayout, placeField, removeFieldFromLayout, renameLayoutKey, type FormLayout,
} from './layout'
import { storedButtons, type FormDefinition } from './definition'
import { normalizeFormButtons, type FormButton } from './buttons'
import { defaultFormHeader, normalizeFormHeader, type FormHeader } from './header'
import { lookupConfigProblem, lookupItemKey } from './lookup'
import { ATTACHMENT_DEFAULTS, attachmentsConfigProblem, attachmentsCountKey } from './attachments'
import type { FormThemeRef } from './form-theme'

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
  const order = new Map(state.layout.rows.flatMap((row) => row.cells.map((c) => c.field_key)).map((key, i) => [key, i]))
  const fields = [...state.fields]
    .sort((a, b) => (order.get(a.key) ?? 1e9) - (order.get(b.key) ?? 1e9))
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
}

/** A new field of `type` with a unique key (label "Text", "Number 2", …). */
export function newField(type: TaskFieldType, taken: string[]): DesignerField {
  const base = DEFAULT_LABELS[type] ?? TASK_FIELD_TYPE_LABELS[type].replace(/\s*\(.*\)$/, '')
  const key = uniqueFieldKey(base, taken)
  const suffix = key.match(/_(\d+)$/)?.[1]
  const label = suffix && !fieldKeyFromLabel(base).endsWith(`_${suffix}`) ? `${base} ${suffix}` : base
  const field: DesignerField = { _id: designerId(), key, label, type }
  if (type === 'choice' || type === 'multi_choice') field.options = ['Option 1', 'Option 2']
  if (type === 'currency') field.currency = 'USD'
  if (type === 'lookup') field.lookup = { source: 'table' }
  if (type === 'attachments') field.attachments = { max_files: ATTACHMENT_DEFAULTS.max_files, max_file_mb: ATTACHMENT_DEFAULTS.max_file_mb, types: ['any'] }
  return field
}

/** Add a field of `type` at a grid position (default: a new full-width row at the end). */
export function addField(state: DesignerState, type: TaskFieldType, at?: { row: number; index: number }): { state: DesignerState; field: DesignerField } {
  const field = newField(type, state.fields.map((f) => f.key))
  const fields = [...state.fields, field]
  const layout = at ? placeField(state.layout, field.key, at.row, at.index) : placeField(state.layout, field.key, state.layout.rows.length, 0)
  return { state: { ...state, fields, layout }, field }
}

export function duplicateField(state: DesignerState, id: string): { state: DesignerState; field: DesignerField } | null {
  const source = state.fields.find((f) => f._id === id)
  if (!source) return null
  const key = uniqueFieldKey(source.key, state.fields.map((f) => f.key))
  const field: DesignerField = { ...structuredClone(source), _id: designerId(), key, label: `${source.label} (copy)`, _keyLocked: true }
  const at = findCell(state.layout, source.key)
  const layout = at ? placeField(state.layout, key, at.row, at.index + 1) : placeField(state.layout, key, state.layout.rows.length, 0)
  return { state: { ...state, fields: [...state.fields, field], layout }, field }
}

export function removeField(state: DesignerState, id: string): DesignerState {
  const field = state.fields.find((f) => f._id === id)
  if (!field) return state
  return {
    ...state,
    fields: state.fields.filter((f) => f._id !== id).map((f) => (f.visible_when?.field === field.key ? { ...f, visible_when: undefined } : f)),
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
  }
  return { ...state, fields, layout }
}

/** Key problem for a field (null = ok). */
export function keyProblemFor(state: DesignerState, id: string): string | null {
  const field = state.fields.find((f) => f._id === id)
  if (!field) return null
  return fieldKeyProblem(field.key, state.fields.filter((f) => f._id !== id).map((f) => f.key))
}

/** Every blocking problem (field id → message): keys, labels, empty choices. */
export function designerProblems(state: DesignerState): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of state.fields) {
    const keyProblem = keyProblemFor(state, field._id)
    if (keyProblem) { out[field._id] = keyProblem; continue }
    if (!field.label.trim() && field.type !== 'divider') { out[field._id] = 'Label is required'; continue }
    if ((field.type === 'choice' || field.type === 'multi_choice') && !(field.options ?? []).some((o) => o.trim()) && !field.options_source) {
      out[field._id] = 'Add at least one option'
      continue
    }
    if (field.type === 'lookup') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const problem = lookupConfigProblem(field.lookup, field.key, others)
        ?? (others.includes(lookupItemKey(field.key)) ? `Another field uses the key "${lookupItemKey(field.key)}" (this lookup stores its selected item there)` : null)
      if (problem) out[field._id] = problem
    }
    if (field.type === 'attachments') {
      const others = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type)).map((f) => f.key)
      const problem = attachmentsConfigProblem(field.attachments)
        ?? (others.includes(attachmentsCountKey(field.key)) ? `Another field uses the key "${attachmentsCountKey(field.key)}" (this field stores its file count there)` : null)
      if (problem) out[field._id] = problem
    }
  }
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
