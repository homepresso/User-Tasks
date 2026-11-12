/**
 * The Agent and a task's form (client-safe, pure): what the Agent reads,
 * shows and checks when it reads or actions a task (lib/assistants/tools/
 * task-actions.ts). Built from the task as stored — metadata.fields (the
 * step's form), metadata.template_values (saved / prefilled values: the
 * step's field_values and defaults land there when the task is created) and
 * metadata.form_layout (pages, sections and rules decide what is visible).
 *
 *  - taskFormSnapshot: the stored form as the same FormSnapshot the browser
 *    sends for the form on screen, so the Agent's existing helpers apply
 *    (formForModel masks secrets; coerceProposedValue / unsettableReason
 *    check a value the model wants to set).
 *  - formProblems: required-but-empty and invalid fields for a set of values
 *    (the same validateTaskFieldValues the task page and the services run),
 *    with what the Agent needs to ask for each (label, type, options, help,
 *    and whether to ask with buttons, in text, or tell the person to fill it
 *    in on the task page).
 *  - formInfoRows: the compact label → value rows of the panel's info card
 *    (option labels, Yes / No, attachment names, money; secrets masked;
 *    required-but-empty flagged).
 *  - coerceTaskValues: the model's values (key → text) checked and typed.
 *  - outcomeTone: the colour of an outcome on the cards.
 *
 * Every value here is untrusted data (written by other people): it is shown
 * and given to the model as data, never as instructions.
 */
import { describeSignature, normalizeImageValue } from '@/lib/forms/media-fields'
import { controlValueText } from '@/lib/forms/control-text'
import {
  hiddenFieldKeysForValues, holdsFiles, isDisplayField, normalizeTaskFields, optionLabel, validateTaskFieldValues,
  type TaskFieldDef,
} from '@/lib/task-field-schema'
import { coerceProposedValue, isSecretField, unsettableReason, ASSISTANT_SETTABLE_TYPES } from './form-values'
import type { FormSnapshot, FormSnapshotField } from './types'
import { listValueText } from '@/lib/forms/list-field'

/* eslint-disable @typescript-eslint/no-explicit-any -- stored task metadata is JSON */

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {})

export const MASK = '••••'

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

export interface TaskFormFacts {
  fields: TaskFieldDef[]
  values: Record<string, unknown>
  layout: unknown
  /** Keys hidden for these values (rules, pages, sections). */
  hidden: Set<string>
}

/** The task's form as stored: fields, saved / prefilled values, layout, hidden keys. */
export function taskFormFacts(metadata: unknown, overlay: Record<string, unknown> = {}): TaskFormFacts {
  const meta = obj(metadata)
  const fields = normalizeTaskFields(meta.fields)
  const values = { ...obj(meta.template_values), ...overlay }
  const layout = meta.form_layout
  let hidden = new Set<string>()
  try { hidden = hiddenFieldKeysForValues(fields, values, layout) } catch { /* a broken layout hides nothing */ }
  return { fields, values, layout, hidden }
}

function snapshotField(f: TaskFieldDef, value: unknown, hidden: boolean, formReadOnly: boolean): FormSnapshotField {
  return {
    key: f.key,
    label: f.label || f.key,
    type: f.type,
    ...(f.required ? { required: true } : {}),
    ...(f.options?.length ? { options: f.options.slice(0, 200).map((o) => ({ value: o, label: optionLabel(f, o) })) } : {}),
    ...(f.help_text ? { help_text: f.help_text } : {}),
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(f.min !== undefined ? { min: f.min } : {}),
    ...(f.max !== undefined ? { max: f.max } : {}),
    ...(f.min_length !== undefined ? { min_length: f.min_length } : {}),
    ...(f.max_length !== undefined ? { max_length: f.max_length } : {}),
    ...(f.pattern ? { pattern: f.pattern } : {}),
    ...(f.pattern_message ? { pattern_message: f.pattern_message } : {}),
    ...(f.min_date ? { min_date: f.min_date } : {}),
    ...(f.max_date ? { max_date: f.max_date } : {}),
    visible: !hidden,
    read_only: Boolean(f.read_only) || formReadOnly || f.type === 'label',
    secret: isSecretField({ key: f.key, label: f.label }),
    value: value ?? null,
  }
}

/** The stored form as a FormSnapshot (the shape the Agent's form helpers take). */
export function taskFormSnapshot(metadata: unknown, options: { title?: string | null; readOnly?: boolean; overlay?: Record<string, unknown> } = {}): FormSnapshot {
  const facts = taskFormFacts(metadata, options.overlay)
  return {
    ...(options.title ? { title: options.title } : {}),
    ...(options.readOnly ? { read_only: true } : {}),
    fields: facts.fields.filter((f) => !isDisplayField(f)).map((f) => snapshotField(f, facts.values[f.key], facts.hidden.has(f.key), options.readOnly === true)),
  }
}

/** How the Agent should get a missing value from the person. */
export type AskWith = 'buttons' | 'text' | 'person_fills'

const BUTTON_TYPES = new Set(['boolean', 'choice', 'yes_no_maybe', 'likert', 'csat', 'rating'])

export function askWith(field: Pick<FormSnapshotField, 'type' | 'options' | 'secret' | 'key' | 'label'>): AskWith {
  if (field.secret || isSecretField(field) || !ASSISTANT_SETTABLE_TYPES.has(field.type)) return 'person_fills'
  if (field.type === 'boolean') return 'buttons'
  if (BUTTON_TYPES.has(field.type) && (field.options?.length ?? 0) >= 2 && (field.options?.length ?? 0) <= 6) return 'buttons'
  if (field.type === 'multi_choice' && (field.options?.length ?? 0) <= 6 && (field.options?.length ?? 0) >= 2) return 'buttons'
  return 'text'
}

export interface FormProblem {
  key: string
  label: string
  type: string
  problem: 'required_empty' | 'invalid'
  error: string
  options?: string[]
  help_text?: string
  placeholder?: string
  ask_with: AskWith
}

/**
 * Required-but-empty and invalid fields for these values (visible, editable
 * fields only — what completing would refuse). Without buttonIds every
 * Before-submit rule applies (reading the form); completing passes the
 * chosen outcome's buttons.
 */
export function formProblems(metadata: unknown, overlay: Record<string, unknown> = {}, options: { buttonIds?: readonly string[] | null } = {}): FormProblem[] {
  const facts = taskFormFacts(metadata, overlay)
  if (!facts.fields.length) return []
  let errors: Record<string, string> = {}
  // buttonIds: the bar buttons this completion counts as — a Before-submit rule aimed at another button (e.g. "Decline needs a comment") doesn't apply.
  try { errors = validateTaskFieldValues(facts.fields, facts.values, { layout: facts.layout, buttonIds: options.buttonIds ?? null }) } catch { errors = {} }
  const out: FormProblem[] = []
  for (const f of facts.fields) {
    const error = errors[f.key]
    if (!error) continue
    const snap = snapshotField(f, facts.values[f.key], false, false)
    const required = Boolean(f.required) && isEmptyValue(facts.values[f.key])
    out.push({
      key: f.key,
      label: f.label || f.key,
      type: f.type,
      problem: required ? 'required_empty' : 'invalid',
      error: String(error).slice(0, 300),
      ...(snap.options?.length ? { options: snap.options.map((o) => o.label) } : {}),
      ...(f.help_text ? { help_text: f.help_text.slice(0, 500) } : {}),
      ...(f.placeholder ? { placeholder: f.placeholder.slice(0, 200) } : {}),
      ask_with: askWith(snap),
    })
  }
  return out
}

/** "USD 1,250.00" */
function money(value: unknown, currency?: string): string {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[, ]/g, ''))
  if (!Number.isFinite(n)) return String(value)
  return `${currency || 'USD'} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** A stored value in words (the card and the model see the same). */
export function displayValue(field: TaskFieldDef, value: unknown, names: ReadonlyMap<string, string> = new Map()): string {
  if (isSecretField({ key: field.key, label: field.label })) return isEmptyValue(value) ? '—' : MASK
  if (isEmptyValue(value)) return field.type === 'boolean' ? 'No' : '—'
  if (field.type === 'image') return clip(normalizeImageValue(value)?.name || String((value as { name?: unknown })?.name ?? '') || 'a picture')
  if (field.type === 'signature') return describeSignature(value)
  const control = controlValueText(field, value, { names })
  if (control !== null) return clip(control.replace(/\n/g, '; ')) || '—'
  if (holdsFiles(field)) {
    const files = (Array.isArray(value) ? value : []).map((f: any) => String(f?.name ?? 'file')).filter(Boolean)
    return files.length ? `${files.length} file${files.length === 1 ? '' : 's'}: ${clip(files.join(', '), 200)}` : '—'
  }
  switch (field.type) {
    case 'boolean': return value === true || value === 'true' ? 'Yes' : 'No'
    case 'choice': case 'likert': case 'yes_no_maybe': case 'image_choice': return clip(optionLabel(field, String(value)))
    case 'multi_choice': case 'ranking': return clip((Array.isArray(value) ? value : [value]).map((v) => optionLabel(field, String(v))).join(', '))
    case 'currency': return money(value, field.currency)
    case 'user': return names.get(String(value)) ?? 'a person'
    case 'list': {
      // Repeating rows (lib/forms/list-field.ts): the count and the first rows in words.
      const rows = Array.isArray(value) ? value : []
      const text = listValueText(field.list, rows.slice(0, 5))
      return clip(`${rows.length} row${rows.length === 1 ? '' : 's'}${text ? `: ${text.replace(/\n/g, '; ')}` : ''}`)
    }
    case 'data_table': {
      const rows = Array.isArray(value) ? value : Array.isArray((value as any)?.rows) ? (value as any).rows : null
      return rows ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : 'a table'
    }
    default: break
  }
  if (typeof value === 'object') {
    const label = (value as any)?.label ?? (value as any)?.name
    if (typeof label === 'string') return clip(label)
    if (Array.isArray(value)) return clip(value.map((v) => (typeof v === 'object' ? String((v as any)?.label ?? (v as any)?.name ?? JSON.stringify(v)) : String(v))).join(', '))
    try { return clip(JSON.stringify(value), 200) } catch { return '…' }
  }
  return clip(String(value))
}

export interface InfoRow {
  label: string
  value: string
  /** required_empty: required and still empty; invalid: fails validation; changed: a value about to be submitted. */
  flag?: 'required_empty' | 'invalid' | 'changed' | null
}

/** The info card's rows: every visible field with a value or required (display elements left out), in form order. */
export function formInfoRows(metadata: unknown, options: { names?: ReadonlyMap<string, string>; max?: number; overlay?: Record<string, unknown> } = {}): InfoRow[] {
  const facts = taskFormFacts(metadata, options.overlay)
  // Only what applies whichever button is pressed (rules aimed at one outcome's button, e.g. "Decline needs a comment", are left out).
  const problems = new Map(formProblems(metadata, options.overlay, { buttonIds: [] }).map((p) => [p.key, p.problem]))
  const rows: InfoRow[] = []
  for (const f of facts.fields) {
    if (isDisplayField(f) || facts.hidden.has(f.key)) continue
    const value = facts.values[f.key]
    const flag = problems.get(f.key) ?? null
    if (isEmptyValue(value) && !flag && f.type !== 'boolean') continue
    rows.push({ label: f.label || f.key, value: displayValue(f, value, options.names), ...(flag ? { flag } : {}) })
  }
  return rows.slice(0, options.max ?? 40)
}

export type CoerceOutcome = { values: Record<string, unknown>; display: Record<string, string>; skipped: Array<{ key: string; reason: string }> }

/**
 * The model's values (key → text, or a list of { key, value }) checked
 * against the stored form: only visible, editable, non-secret fields of a
 * type the Agent may set, typed like propose_field_values.
 */
export function coerceTaskValues(snapshot: FormSnapshot, raw: unknown): CoerceOutcome {
  const entries: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.filter((r) => r && typeof r === 'object').map((r: any) => [String(r.key ?? ''), r.value])
    : Object.entries(obj(raw))
  const byKey = new Map(snapshot.fields.map((f) => [f.key, f]))
  const byLabel = new Map(snapshot.fields.map((f) => [f.label.trim().toLowerCase(), f]))
  const out: CoerceOutcome = { values: {}, display: {}, skipped: [] }
  for (const [rawKey, value] of entries.slice(0, 100)) {
    const field = byKey.get(rawKey) ?? byLabel.get(rawKey.trim().toLowerCase())
    const why = unsettableReason(field, snapshot.read_only === true)
    if (why) { out.skipped.push({ key: rawKey, reason: why }); continue }
    const coerced = coerceProposedValue(field!, value)
    if (!coerced.ok) { out.skipped.push({ key: field!.key, reason: `${field!.label}: ${coerced.reason}` }); continue }
    out.values[field!.key] = coerced.value
    out.display[field!.key] = coerced.display
  }
  return out
}

/** The colour of an outcome on the cards (approve-like green, decline-like red, defer-like amber). */
export type OutcomeTone = 'success' | 'danger' | 'warning' | 'brand'
export function outcomeTone(outcome: string): OutcomeTone {
  const o = outcome.trim().toLowerCase()
  if (/^(approv|accept|complete|done|yes|agree|confirm|sign|pass|ok\b|grant|allow|endorse)/.test(o)) return 'success'
  if (/(reject|declin|deny|denied|refus|cancel|^no\b|fail|disapprov|block)/.test(o)) return 'danger'
  if (/(defer|hold|return|send back|more info|escalat|revis|wait|postpone|change)/.test(o)) return 'warning'
  return 'brand'
}

/**
 * The task's outcome that matches what the model asked for: exact
 * (case-insensitive), else the one outcome sharing its word stem ("approve" →
 * "Approved", "decline" → "Declined"). Never a different word: completing
 * with an outcome the person did not name is refused.
 */
export function matchOutcome(outcomes: readonly string[], asked: unknown): string | null {
  const a = typeof asked === 'string' ? asked.trim().toLowerCase() : ''
  if (!a) return null
  const exact = outcomes.find((o) => o.toLowerCase() === a)
  if (exact) return exact
  const stem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 6)
  if (stem(a).length < 4) return null
  const same = outcomes.filter((o) => stem(o) === stem(a))
  return same.length === 1 ? same[0] : null
}
