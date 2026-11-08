import { taskDataFieldSlug } from '@/lib/task-data'
import { isPlainObject } from '@/lib/utils/guards'
import { compileUserRegex, MAX_REGEX_PATTERN_LENGTH } from '@/lib/safe-regex'
import { LOOKUP_LIMITS, lookupConfigProblem, lookupItemKey, lookupValues, normalizeLookupConfig, type LookupConfig } from '@/lib/forms/lookup'
import {
  attachmentsConfigProblem, attachmentsCountKey, attachmentsValueError, attachmentUploadsInFlight, normalizeAttachmentsConfig, normalizeAttachmentValue,
  type AttachmentFile, type AttachmentsConfig,
} from '@/lib/forms/attachments'
import {
  coerceCustomValue, customControlConfigProblem, customControlValidityMessage, customValueError, isBlankCustomValue, normalizeCustomControlConfig,
  type CustomControlFieldConfig,
} from '@/lib/forms/custom-controls/field'
import { customOutputEntries, customOutputError, nativeCustomValue } from '@/lib/forms/custom-controls/output'
import { normalizeAutocomplete } from '@/lib/forms/autocomplete'
import { normalizeFieldButton, type FieldButtonConfig } from '@/lib/forms/field-buttons'
import { ruleClaimGate, ruleHiddenFieldKeys, ruleReadOnlyFieldKeys, ruleValidationErrors, ruleWrittenReadOnlyValues } from '@/lib/forms/form-rules'
import { excludedSectionFieldKeys, isSectionIncluded, layoutSections, sectionConditionValue, sectionIncludedKeys, sectionInclusionPatch, sectionRuleHiddenFieldKeys } from '@/lib/forms/sections'
import {
  changeCount, dataTableConfigProblem, isChangeSet, normalizeDataTableConfig, validateChangeSet, validateSelection, type DataTableFieldConfig,
} from '@/lib/forms/data-table'
import {
  FORM_STATE_KEY, formStateConfig, hiddenPageIds, normalizeStateRuleField, sanitizeFormState, stateHiddenFieldKeys, stateRuleFlag, type FormUiState,
} from '@/lib/forms/form-state'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY } from '@/lib/forms/form-params'
import { dynamicBindingProblems, hasUnresolvedOptions, normalizeDynamicBindings, type DynamicBindings } from '@/lib/forms/dynamic-values'
import { coerceLabelValue, expressionProblems, labelOrder, normalizeLabelConfig, serverLabelValues, type LabelFieldConfig } from '@/lib/forms/label-field'
import {
  SURVEY_FIELD_LABELS, SURVEY_FIELD_TYPES, SURVEY_OPTION_TYPES, coerceSurveyValue, isBlankSurveyValue, isMultiSurvey, isSurveyType, normalizeSurveyConfig,
  surveyConfigProblem, surveyValueError, type SurveyFieldConfig,
} from '@/lib/forms/survey/controls'

/**
 * User Task `fields` — the inputs a User Task node (or a reusable Form) asks
 * the assignee to fill in. Values live in task `metadata.template_values`
 * (surfaced as `task.data.<key>`) and are handed to the resumed workflow as
 * `task_data.<key>`. Isomorphic: used by the engine, server actions, API
 * routes, MCP tools, the form designer and the task screen.
 *
 * Backward compatible: the original five types (text, number, date,
 * boolean, choice) and their stored shape are unchanged; every newer
 * property is optional and only emitted when set. Layout (the grid) lives
 * beside the field list — see lib/forms/layout.ts.
 */

export type TaskFieldType =
  | 'text' | 'textarea' | 'number' | 'currency' | 'email' | 'phone' | 'url'
  | 'date' | 'datetime' | 'boolean' | 'choice' | 'multi_choice' | 'user'
  | 'lookup' | 'attachments' | 'heading' | 'divider' | 'custom' | 'button' | 'data_table' | 'label'
  /** Survey controls (lib/forms/survey/controls.ts). */
  | 'rating' | 'nps' | 'likert' | 'matrix' | 'slider' | 'csat' | 'ranking' | 'image_choice' | 'yes_no_maybe'

export const TASK_FIELD_TYPES: TaskFieldType[] = [
  'text', 'textarea', 'number', 'currency', 'email', 'phone', 'url',
  'date', 'datetime', 'boolean', 'choice', 'multi_choice', 'user',
  'lookup', 'attachments', 'heading', 'divider', 'custom', 'button', 'data_table', 'label',
  ...SURVEY_FIELD_TYPES,
]

/** Display-only elements: placed on the grid, never hold a value. */
export const DISPLAY_FIELD_TYPES: ReadonlySet<TaskFieldType> = new Set(['heading', 'divider', 'button'])

export const TASK_FIELD_TYPE_LABELS: Record<TaskFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  date: 'Date',
  datetime: 'Date & time',
  boolean: 'Checkbox (yes/no)',
  choice: 'Single select',
  multi_choice: 'Multi-select',
  user: 'Person',
  lookup: 'Autocomplete / lookup',
  attachments: 'Attachments',
  heading: 'Section heading',
  divider: 'Divider',
  custom: 'Custom control',
  button: 'Button',
  data_table: 'Data table',
  label: 'Label',
  ...SURVEY_FIELD_LABELS,
}

/**
 * Keys a field may not use: prototype names (values are merged into plain
 * objects) and names the resume payload / task object already own.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set([
  '__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof',
  'outcome', 'outcome_notes', 'outcome_counts', 'actioned_by', 'actioned_by_name',
  'actioned_on_behalf_of', 'actioned_on_behalf_of_name', 'on_behalf_note',
  'response_count', 'user_task_id', 'task', 'task_id', 'task_data', 'id', 'tenant_id', FORM_STATE_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY, CONTROLS_KEY,
])

export type VisibleWhenOperator = 'equals' | 'not_equals' | 'is_set' | 'is_not_set' | 'contains'
export const VISIBLE_WHEN_OPERATORS: VisibleWhenOperator[] = ['equals', 'not_equals', 'is_set', 'is_not_set', 'contains']

export interface VisibleWhen {
  field: string
  operator: VisibleWhenOperator
  value?: string
}

export interface OptionsSource {
  /** Data table id (custom_tables). */
  table_id: string
  /** Column whose distinct values become the options. */
  column: string
}

export interface TaskFieldDef {
  key: string
  label: string
  type: TaskFieldType
  required?: boolean
  /** Option values (choice / multi_choice). */
  options?: string[]
  /** Display label per option value, when it differs from the value. */
  option_labels?: Record<string, string>
  /** Options read from a data table column when the task is created. */
  options_source?: OptionsSource
  /** choice only: dropdown (default) or radio buttons. */
  display?: 'dropdown' | 'radio'
  placeholder?: string
  default?: string
  help_text?: string
  read_only?: boolean
  /** number / currency: value bounds; multi_choice: selection count bounds. */
  min?: number
  max?: number
  /** Text-like: length bounds. */
  min_length?: number
  max_length?: number
  /** Text-like: a pattern the value must match (safe-regex checked). */
  pattern?: string
  pattern_message?: string
  /** Text-like / date: HTML autofill token (input purpose, WCAG 1.3.5) — lib/forms/autocomplete.ts. */
  autocomplete?: string
  /** date / datetime bounds (YYYY-MM-DD or ISO). */
  min_date?: string
  max_date?: string
  /** currency: ISO 4217 code (default USD). */
  currency?: string
  visible_when?: VisibleWhen
  /** lookup only: where suggestions come from and what is stored (lib/forms/lookup.ts). */
  lookup?: LookupConfig
  /** attachments only: counts, sizes and allowed types (lib/forms/attachments.ts). */
  attachments?: AttachmentsConfig
  /** custom only: the workspace form control (web component) and its settings (lib/forms/custom-controls/field.ts). */
  custom?: CustomControlFieldConfig
  /** button only: an in-form button and what it does on click (lib/forms/field-buttons.ts). */
  button?: FieldButtonConfig
  /** data_table only: rows from a data table / API reference, the query the author set up, the mode (lib/forms/data-table.ts). */
  data_table?: DataTableFieldConfig
  /**
   * label only: display text whose value comes from an expression, rules or
   * the default — format, prefix / suffix, "Include in submission"
   * (lib/forms/label-field.ts).
   */
  label_config?: LabelFieldConfig
  /**
   * Dynamic properties (lib/forms/dynamic-values.ts): property → binding (an
   * expression, a data table query or an API reference). The static value
   * beside it stays the preview and the fallback.
   */
  dynamic?: DynamicBindings
  /**
   * Survey controls only (rating, nps, likert, matrix, slider, csat, ranking,
   * image_choice, yes_no_maybe): their settings — icon, half steps, end
   * labels, NPS bands, slider step / unit, faces, matrix rows, picture
   * images (lib/forms/survey/controls.ts).
   */
  survey?: SurveyFieldConfig
}

export type TaskFieldValue = string | number | boolean | string[] | AttachmentFile[] | null
  /** Custom controls: JSON values typed by their manifest. */
  | Record<string, unknown> | unknown[]

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9 ()./-]{5,30}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURRENCY_RE = /^[A-Z]{3}$/
const MAX_OPTIONS = 500
const MAX_TEXT = 50_000

function isTaskFieldType(value: unknown): value is TaskFieldType {
  return typeof value === 'string' && (TASK_FIELD_TYPES as string[]).includes(value)
}

/** Fields whose value is a list of uploaded files: Attachments, and custom controls storing files. */
export function holdsFiles(field: Pick<TaskFieldDef, 'type' | 'custom'>): boolean {
  return field.type === 'attachments' || (field.type === 'custom' && field.custom?.value_type === 'files')
}

/** Fields that answer lookups: Lookup fields, and custom controls with the lookup capability and a source. */
export function answersLookups(field: Pick<TaskFieldDef, 'type' | 'custom' | 'lookup'>): boolean {
  return field.type === 'lookup' || (field.type === 'custom' && Boolean(field.custom?.capabilities?.includes('lookup')) && Boolean(field.lookup))
}

export function isDisplayField(field: Pick<TaskFieldDef, 'type'>): boolean {
  return DISPLAY_FIELD_TYPES.has(field.type)
}

/**
 * Fields that hold a stored value (headings, dividers and buttons excluded;
 * a Label only when it is included in the submission).
 */
export function valueFields(fields: TaskFieldDef[]): TaskFieldDef[] {
  return fields.filter((field) => !isDisplayField(field) && (field.type !== 'label' || field.label_config?.include === true))
}

const TEXT_LIKE: ReadonlySet<TaskFieldType> = new Set(['text', 'textarea', 'email', 'phone', 'url'])
const NUMERIC: ReadonlySet<TaskFieldType> = new Set(['number', 'currency'])
const CHOICE_TYPES: ReadonlySet<TaskFieldType> = new Set(['choice', 'multi_choice'])

/** snake_case key from a label (the designer's auto key). */
export function fieldKeyFromLabel(label: string): string {
  return taskDataFieldSlug(String(label ?? '')).slice(0, 64)
}

/**
 * Problem with a key (null = fine): empty, not snake_case, reserved, or
 * already used by another field (`others` = the other fields' keys).
 */
export function fieldKeyProblem(key: string, others: Iterable<string> = []): string | null {
  const k = String(key ?? '')
  if (!k) return 'Key is required'
  if (k.length > 64) return 'Key must be 64 characters or fewer'
  if (!/^[a-z0-9][a-z0-9_]*$/.test(k)) return 'Use lowercase letters, digits and underscores'
  if (RESERVED_FIELD_KEYS.has(k)) return `"${k}" is reserved`
  for (const other of others) if (other === k) return `Key "${k}" is used by another field`
  return null
}

/** `base`, or `base_2`, `base_3`… — the first not in `taken` and not reserved. */
export function uniqueFieldKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let root = fieldKeyFromLabel(base) || 'field'
  if (!/^[a-z0-9]/.test(root)) root = `field_${root}`
  if (RESERVED_FIELD_KEYS.has(root)) root = `${root}_field`
  if (!used.has(root)) return root
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${root}_${i}`
    if (!used.has(candidate)) return candidate
  }
  return `${root}_${Date.now()}`
}

function finite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function nonNegInt(value: unknown): number | undefined {
  const n = finite(value)
  return n === undefined || n < 0 ? undefined : Math.floor(n)
}

function cleanString(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

function normalizeOptions(raw: unknown): { options: string[]; labels: Record<string, string> } {
  const options: string[] = []
  const labels: Record<string, string> = {}
  if (!Array.isArray(raw)) return { options, labels }
  for (const entry of raw) {
    let value: string
    let label: string | undefined
    if (isPlainObject(entry)) {
      value = String(entry.value ?? entry.label ?? '').trim()
      label = typeof entry.label === 'string' ? entry.label.trim() : undefined
    } else {
      value = String(entry ?? '').trim()
    }
    if (!value || options.includes(value) || options.length >= MAX_OPTIONS) continue
    options.push(value)
    if (label && label !== value) labels[value] = label.slice(0, 200)
  }
  return { options, labels }
}

export function normalizeVisibleWhen(raw: unknown): VisibleWhen | undefined {
  if (!isPlainObject(raw)) return undefined
  // `state.<flag>`: a form state flag set by in-form buttons (lib/forms/form-state.ts).
  const field = typeof raw.field === 'string' ? (normalizeStateRuleField(raw.field) ?? taskDataFieldSlug(raw.field)) : ''
  const operator = VISIBLE_WHEN_OPERATORS.includes(raw.operator as VisibleWhenOperator) ? raw.operator as VisibleWhenOperator : 'equals'
  if (!field) return undefined
  const out: VisibleWhen = { field, operator }
  if (operator !== 'is_set' && operator !== 'is_not_set') out.value = raw.value === undefined || raw.value === null ? '' : String(raw.value).slice(0, 500)
  return out
}

/**
 * Normalize raw node config into a clean field list: the key falls back to a
 * slug of the label, duplicate / reserved keys and entries without a usable
 * key/label are dropped, unknown types become `text`, and choice options are
 * trimmed/deduped. Properties that do not apply to a type are dropped.
 */
export function normalizeTaskFields(raw: unknown): TaskFieldDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TaskFieldDef[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const rawKey = typeof entry.key === 'string' ? entry.key.trim() : ''
    const type: TaskFieldType = isTaskFieldType(entry.type) ? entry.type : 'text'
    const key = taskDataFieldSlug(rawKey || label).slice(0, 64)
    if (!key || seen.has(key) || RESERVED_FIELD_KEYS.has(key)) continue
    seen.add(key)
    const field: TaskFieldDef = { key, label: label || key, type }
    if (isDisplayField(field)) {
      if (type === 'heading') {
        const help = cleanString(entry.help_text, 2000)
        if (help) field.help_text = help
      }
      // Headings and dividers show / hide like fields (a heading-made section's title with its fields).
      if (type === 'heading' || type === 'divider') {
        const visible = normalizeVisibleWhen(entry.visible_when)
        if (visible && visible.field !== key) field.visible_when = visible
      }
      if (type === 'button') {
        field.button = normalizeFieldButton(entry.button)
        const disabled = normalizeVisibleWhen(isPlainObject(entry.button) ? entry.button.disabled_when : undefined)
        if (disabled) field.button.disabled_when = disabled
        const visible = normalizeVisibleWhen(entry.visible_when)
        if (visible && visible.field !== key) field.visible_when = visible
      }
      out.push(field)
      continue
    }
    if (entry.required === true) field.required = true
    if (CHOICE_TYPES.has(type)) {
      const { options, labels } = normalizeOptions(entry.options)
      field.options = options
      if (Object.keys(labels).length) field.option_labels = labels
      if (isPlainObject(entry.options_source) && typeof entry.options_source.table_id === 'string' && typeof entry.options_source.column === 'string'
        && entry.options_source.table_id && entry.options_source.column) {
        field.options_source = { table_id: entry.options_source.table_id, column: String(entry.options_source.column).slice(0, 120) }
      }
      if (type === 'choice' && entry.display === 'radio') field.display = 'radio'
    }
    if (SURVEY_OPTION_TYPES.has(type)) {
      // Survey controls with options (lib/forms/survey/controls.ts): a fixed list, no table / dynamic source.
      const { options, labels } = normalizeOptions(entry.options)
      field.options = options.slice(0, 50)
      const kept = Object.fromEntries(Object.entries(labels).filter(([v]) => field.options!.includes(v)))
      if (Object.keys(kept).length) field.option_labels = kept
    }
    if (type === 'lookup') field.lookup = normalizeLookupConfig(entry.lookup)
    if (type === 'data_table') field.data_table = normalizeDataTableConfig(entry.data_table)
    if (type === 'label') {
      // Display text (lib/forms/label-field.ts): no input properties; its caption, help, default, visibility and config.
      delete field.required
      const config = normalizeLabelConfig(entry.label_config)
      if (Object.keys(config).length) field.label_config = config
      if (entry.default !== undefined && entry.default !== null && String(entry.default) !== '') field.default = String(entry.default).slice(0, 5000)
      const help = cleanString(entry.help_text, 2000)
      if (help) field.help_text = help
      const visible = normalizeVisibleWhen(entry.visible_when)
      if (visible && visible.field !== key) field.visible_when = visible
      // Dynamic caption / help / default (lib/forms/dynamic-values.ts) — never options or bounds.
      const dynamic = normalizeDynamicBindings(entry.dynamic, field)
      if (dynamic) field.dynamic = dynamic
      out.push(field)
      continue
    }
    if (type === 'custom') {
      const custom = normalizeCustomControlConfig(entry.custom)
      if (custom) field.custom = custom
      // Host services the control may request: lookups from a data source, uploads into the Attachments pipeline.
      if (custom?.capabilities?.includes('lookup') && isPlainObject(entry.lookup)) field.lookup = normalizeLookupConfig(entry.lookup)
      if (custom?.value_type === 'files') {
        const config = normalizeAttachmentsConfig(entry.attachments)
        if (Object.keys(config).length) field.attachments = config
      }
    }
    if (type === 'attachments') {
      const config = normalizeAttachmentsConfig(entry.attachments)
      if (Object.keys(config).length) field.attachments = config
    }
    if (typeof entry.placeholder === 'string' && entry.placeholder.trim()) {
      field.placeholder = entry.placeholder
    }
    if (type !== 'attachments' && entry.default !== undefined && entry.default !== null && String(entry.default) !== '') {
      field.default = Array.isArray(entry.default) ? entry.default.map(String).join(',') : String(entry.default)
    }
    const help = cleanString(entry.help_text, 2000)
    if (help) field.help_text = help
    if (entry.read_only === true) field.read_only = true
    if (NUMERIC.has(type) || type === 'multi_choice' || type === 'rating' || type === 'slider' || type === 'image_choice') {
      const min = finite(entry.min)
      const max = finite(entry.max)
      if (min !== undefined) field.min = min
      if (max !== undefined) field.max = max
    }
    if (TEXT_LIKE.has(type)) {
      const minLength = nonNegInt(entry.min_length)
      const maxLength = nonNegInt(entry.max_length)
      if (minLength !== undefined) field.min_length = minLength
      if (maxLength !== undefined) field.max_length = maxLength
      const pattern = typeof entry.pattern === 'string' ? entry.pattern.trim() : ''
      if (pattern && pattern.length <= MAX_REGEX_PATTERN_LENGTH) {
        field.pattern = pattern
        const message = cleanString(entry.pattern_message, 200)
        if (message) field.pattern_message = message
      }
    }
    const autocomplete = TEXT_LIKE.has(type) || type === 'date' || type === 'number' ? normalizeAutocomplete(entry.autocomplete) : undefined
    if (autocomplete) field.autocomplete = autocomplete
    if (type === 'date' || type === 'datetime') {
      const minDate = cleanString(entry.min_date, 40)
      const maxDate = cleanString(entry.max_date, 40)
      if (minDate && DATE_RE.test(minDate)) field.min_date = minDate
      if (maxDate && DATE_RE.test(maxDate)) field.max_date = maxDate
    }
    if (isSurveyType(type)) {
      const survey = normalizeSurveyConfig(type, entry.survey, field.options)
      if (survey) field.survey = survey
      // A rating's maximum is its scale (whole numbers 2–10); a picture choice's bounds count picks (several only).
      if (type === 'rating') { delete field.min; if (field.max !== undefined) field.max = Math.round(field.max) }
      if (type === 'image_choice' && !survey?.multiple) { delete field.min; delete field.max }
    }
    if (type === 'currency') {
      const code = typeof entry.currency === 'string' ? entry.currency.trim().toUpperCase() : ''
      if (CURRENCY_RE.test(code)) field.currency = code
    }
    const visible = normalizeVisibleWhen(entry.visible_when)
    if (visible && visible.field !== key) field.visible_when = visible
    const dynamic = normalizeDynamicBindings(entry.dynamic, field)
    if (dynamic) field.dynamic = dynamic
    out.push(field)
  }
  return out
}

/** Problems with a field definition the designer should flag (key → message). */
export function fieldDefinitionProblems(fields: TaskFieldDef[]): Record<string, string> {
  const problems: Record<string, string> = {}
  const keys = new Set(fields.map((f) => f.key))
  const valueKeys = valueFields(fields).map((f) => f.key)
  for (const field of fields) {
    const lookupProblem = field.type === 'lookup' ? lookupConfigProblem(field.lookup, field.key, valueKeys.filter((k) => k !== field.key)) : null
    if (lookupProblem) {
      problems[field.key] = lookupProblem
    } else if (field.type === 'lookup' && keys.has(lookupItemKey(field.key))) {
      problems[field.key] = `Another field uses the key "${lookupItemKey(field.key)}" (this lookup stores its selected item there)`
    } else if (field.type === 'attachments' && (attachmentsConfigProblem(field.attachments) || keys.has(attachmentsCountKey(field.key)))) {
      problems[field.key] = attachmentsConfigProblem(field.attachments) ?? `Another field uses the key "${attachmentsCountKey(field.key)}" (this field stores its file count there)`
    } else if (field.type === 'label' && labelProblem(field, fields)) {
      problems[field.key] = labelProblem(field, fields)!
    } else if (field.type === 'data_table' && dataTableConfigProblem(field.data_table)) {
      problems[field.key] = dataTableConfigProblem(field.data_table)!
    } else if (field.type === 'custom' && customControlConfigProblem(field.custom, valueKeys.filter((k) => k !== field.key))) {
      problems[field.key] = customControlConfigProblem(field.custom, valueKeys.filter((k) => k !== field.key))!
    } else if (isSurveyType(field.type) && surveyConfigProblem(field)) {
      problems[field.key] = surveyConfigProblem(field)!
    } else if (field.dynamic && Object.keys(dynamicBindingProblems(field)).length) {
      const [prop, message] = Object.entries(dynamicBindingProblems(field))[0]
      problems[field.key] = `Dynamic ${prop}: ${message}`
    } else if (CHOICE_TYPES.has(field.type) && !(field.options ?? []).length && !field.options_source && !field.dynamic?.options) {
      problems[field.key] = 'Add at least one option'
    } else if (field.pattern) {
      try { compileUserRegex(field.pattern) } catch (err) { problems[field.key] = err instanceof Error ? err.message : 'Invalid pattern' }
    } else if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      problems[field.key] = 'Minimum is greater than maximum'
    } else if (field.min_length !== undefined && field.max_length !== undefined && field.min_length > field.max_length) {
      problems[field.key] = 'Minimum length is greater than maximum length'
    } else if (field.visible_when && !stateRuleFlag(field.visible_when.field) && !keys.has(field.visible_when.field)) {
      problems[field.key] = `"Visible when" refers to an unknown field "${field.visible_when.field}"`
    }
  }
  return problems
}

/** A Label's blocking problem: its expression doesn't read (unknown names / functions, syntax) or reads itself. */
function labelProblem(field: TaskFieldDef, fields: TaskFieldDef[]): string | null {
  const expression = field.label_config?.expression
  if (!expression) return null
  const { cyclic } = labelOrder(fields)
  if (cyclic.has(field.key)) return 'The expression reads itself (directly or through other labels)'
  // Names: only what the engine itself can't read (functions, syntax, volatile); unknown keys are designer warnings.
  const problems = expressionProblems(expression, { fields: new Set(fields.map((f) => f.key)), tables: new Map(), labels: new Set(), params: new Set(), variables: new Set(), lookups: new Set() })
    .filter((p) => !/^(Unknown name|No (parameter|variable|control)|The table)/.test(p))
  return problems[0] ? `Expression: ${problems[0]}` : null
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'off', ''].includes(s)) return false
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Multi-select value → array of strings (array, JSON array text or comma list). */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
      } catch { /* comma list */ }
    }
    return s.split(',').map((v) => v.trim()).filter(Boolean)
  }
  if (value === undefined || value === null) return []
  return [String(value)]
}

function validDate(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(new Date(s).getTime())
}

function dateKey(s: string): number {
  const m = DATE_ONLY_RE.exec(s)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s).getTime()
}

function isSet(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return !isBlank(value)
}

/** Whether `visible_when` shows the field for these values (no condition → visible). */
export function isFieldVisible(field: TaskFieldDef, values: Record<string, unknown> | null | undefined): boolean {
  return isRuleMet(field.visible_when, values)
}

/** Whether a `visible_when` rule (a field's or a form page's) holds for these values; no rule → true. */
export function isRuleMet(cond: VisibleWhen | null | undefined, values: Record<string, unknown> | null | undefined): boolean {
  if (!cond) return true
  // `state.<flag>` reads the form state (values[FORM_STATE_KEY].flags); an unset flag is off.
  const flag = stateRuleFlag(cond.field)
  const state = flag ? (values ?? {})[FORM_STATE_KEY] : undefined
  const raw = flag ? (isPlainObject(state) && isPlainObject(state.flags) ? state.flags[flag] === true : false) : (values ?? {})[cond.field]
  // A Data table's change set reads as its number of changes ("has a value" = something changed).
  const other = isChangeSet(raw) ? (changeCount(raw) || null) : raw
  const target = String(cond.value ?? '').trim().toLowerCase()
  const asText = (v: unknown) => (typeof v === 'boolean' ? String(v) : String(v ?? '').trim().toLowerCase())
  switch (cond.operator) {
    case 'is_set': return isSet(other)
    case 'is_not_set': return !isSet(other)
    case 'contains':
      return Array.isArray(other) ? other.some((v) => asText(v) === target) : asText(other).includes(target)
    case 'not_equals':
      return Array.isArray(other) ? !other.some((v) => asText(v) === target) : asText(other) !== target
    case 'equals':
    default:
      if (typeof other === 'boolean' || ['true', 'false'].includes(target)) return toBoolean(other) === toBoolean(target)
      return Array.isArray(other) ? other.some((v) => asText(v) === target) : asText(other) === target
  }
}

/** Display text for an option value. */
export function optionLabel(field: TaskFieldDef, value: string): string {
  return field.option_labels?.[value] ?? value
}

/**
 * Fields on a hidden page of a steps / tabs form (lib/forms/layout.ts): a
 * page whose `visible_when` does not hold hides every field on it. Takes the
 * stored layout as is (task metadata `form_layout`, a form's `layout`); a
 * layout without pages hides nothing. `knownKeys`: the form's field keys
 * (a rule on any other key is ignored).
 */
export function hiddenPageFieldKeys(layout: unknown, values: Record<string, unknown> | null | undefined, knownKeys?: ReadonlySet<string>): Set<string> {
  const hidden = new Set<string>()
  if (!isPlainObject(layout) || (layout.mode !== 'steps' && layout.mode !== 'tabs') || !Array.isArray(layout.pages)) return hidden
  const flags = new Set((formStateConfig(layout).flags ?? []).map((f) => f.key))
  const hiddenByButton = hiddenPageIds(layout, values)
  for (const page of layout.pages) {
    if (!isPlainObject(page)) continue
    const rule = normalizeVisibleWhen(page.visible_when)
    const flag = rule ? stateRuleFlag(rule.field) : null
    // A rule on a field (or flag) the form no longer has is ignored (as normalizeFormLayout drops it).
    const ruleHides = Boolean(rule && (flag ? flags.has(flag) : (!knownKeys || knownKeys.has(rule.field))) && !isRuleMet(rule, values))
    if (!ruleHides && !hiddenByButton.has(String(page.id))) continue
    for (const row of Array.isArray(page.rows) ? page.rows : []) {
      if (!isPlainObject(row) || !Array.isArray(row.cells)) continue
      for (const cell of row.cells) if (isPlainObject(cell) && typeof cell.field_key === 'string') hidden.add(cell.field_key)
    }
  }
  return hidden
}

/**
 * Validate submitted values against the field list. Returns a map of
 * field key → error message; empty when everything is valid. Keys not in the
 * field list are ignored, as are display elements, read-only fields and
 * fields hidden by `visible_when` (their own, or their page's when `layout`
 * — the form's grid — organises the form into steps / tabs). A required
 * boolean must be true (a checkbox the assignee has to tick).
 */
export interface ValidateOptions {
  partial?: boolean
  layout?: unknown
  user?: Record<string, unknown> | null
  /** The bar buttons this submission counts as (Before-submit rules aimed at another button do not apply). */
  buttonIds?: readonly string[] | null
  /**
   * A step's Next (lib/forms/pages.ts validatePage): only these fields are
   * checked, Before-submit rules only when they ask to be (`step_check`),
   * and no error on a field of another step.
   */
  step?: { keys: ReadonlySet<string> } | null
}

/** Fields hidden for these values (with the sanitized state): hidden pages, state targets, Always rules, sections. */
function hiddenFieldKeys(fields: TaskFieldDef[], vals: Record<string, unknown>, options: ValidateOptions): Set<string> {
  const known = new Set(fields.map((f) => f.key))
  const hidden = hiddenPageFieldKeys(options.layout, vals, known)
  for (const key of stateHiddenFieldKeys(options.layout, fields, vals)) hidden.add(key)
  // "Always" rules (lib/forms/form-rules.ts): recomputed from the values, never trusted from the client.
  for (const key of ruleHiddenFieldKeys(options.layout, fields, vals, { user: options.user ?? null })) hidden.add(key)
  // Sections (lib/forms/sections.ts): a section's own rule; an optional section not included.
  for (const key of sectionRuleHiddenFieldKeys(options.layout, vals, isRuleMet, known)) hidden.add(key)
  for (const key of excludedSectionFieldKeys(options.layout, vals)) hidden.add(key)
  return hidden
}

/**
 * Fields hidden for these values, judged like validation does (the state
 * sanitized first): hidden fields are not required. The browser uses it to
 * leave lazy parts holding only hidden fields unloaded on submit
 * (lib/forms/lazy-load.ts partsToLoad).
 */
export function hiddenFieldKeysForValues(fields: TaskFieldDef[], values: Record<string, unknown> | null | undefined, layout: unknown): Set<string> {
  const vals: Record<string, unknown> = { ...(values ?? {}), [FORM_STATE_KEY]: sanitizeFormState(fields, layout, values, ruleClaimGate(values ?? {})) }
  const hidden = hiddenFieldKeys(fields, vals, { layout })
  for (const f of fields) if (!isFieldVisible(f, vals)) hidden.add(f.key)
  return hidden
}

export function validateTaskFieldValues(
  fields: TaskFieldDef[],
  values: Record<string, unknown> | null | undefined,
  options: ValidateOptions = {},
): Record<string, string> {
  const errors: Record<string, string> = {}
  // In-form buttons' and event rules' state (lib/forms/form-state.ts), bounded to what the form's buttons and
  // rules can do (a rule's claim only when its condition holds for these values) — never as sent.
  const vals: Record<string, unknown> = { ...(values ?? {}), [FORM_STATE_KEY]: sanitizeFormState(fields, options.layout, values, ruleClaimGate(values ?? {})) }
  // {{control.<section>.*}} (lib/forms/rule-variables.ts): re-derived from the sanitized state, never as reported.
  const sections = layoutSections(options.layout)
  if (sections.length && isPlainObject(vals[CONTROLS_KEY])) {
    const controls: Record<string, unknown> = { ...(vals[CONTROLS_KEY] as Record<string, unknown>) }
    for (const s of sections) {
      // `loaded` (lib/forms/lazy-load.ts) is presentation only: kept as the browser had it (a person can always load a part).
      const sent = controls[s.key]
      const loaded = isPlainObject(sent) && typeof sent.loaded === 'boolean' ? { loaded: sent.loaded } : {}
      controls[s.key] = { included: isSectionIncluded(s, vals), visible: sectionConditionValue(`section.${s.key}.visible`, vals) ?? true, ...loaded }
    }
    vals[CONTROLS_KEY] = controls
  }
  const pageHidden = hiddenFieldKeys(fields, vals, options)
  // Read only by a rule (lib/forms/form-rules.ts "Make read only"): not required — the person can't fill it in.
  // Always rules recomputed, event rules' claims as sanitized above; every other check still runs.
  const ruleReadOnly = ruleReadOnlyFieldKeys(options.layout, fields, vals, { user: options.user ?? null })
  const stepKeys = options.step?.keys ?? null
  for (const field of fields) {
    // Labels are display text: nothing to validate (their stored value is the server's own).
    if (isDisplayField(field) || field.read_only || field.type === 'label') continue
    if (stepKeys && !stepKeys.has(field.key)) continue
    // Partial saves (drafts) only check the keys that were sent and skip
    // required checks; completion validates the full set.
    if (options.partial && !Object.prototype.hasOwnProperty.call(vals, field.key)) continue
    const visible = isFieldVisible(field, vals) && !pageHidden.has(field.key)
    const required = field.required && !options.partial && visible && !ruleReadOnly.has(field.key)
    const value = vals[field.key]
    // In the browser: files still uploading would be left out of the submission.
    if (holdsFiles(field) && attachmentUploadsInFlight(field.key) > 0) {
      errors[field.key] = `${field.label}: wait for the files to finish uploading`
      continue
    }
    if (field.type === 'custom') {
      // Typed by the control's manifest (snapshot on the field); never trusts the control. A stored
      // output (`<key>` = main output, `<key>_raw` = the control's value) is judged on the value.
      const native = field.custom ? nativeCustomValue(field.custom, field.key, vals) : value
      const typed = field.custom ? coerceCustomValue(field.custom, native) : native
      if (isBlankCustomValue(field.custom?.value_type ?? 'json', typed)) {
        if (required) errors[field.key] = `${field.label} is required`
        continue
      }
      if (!visible) continue
      const error = field.custom
        ? (customValueError(field.label, field.custom, typed) ?? customOutputError(field.label, field.custom, typed) ?? (field.custom.value_type === 'files' ? attachmentsValueError(field, typed) : null))
        : `${field.label}: the custom control is not configured`
      const reported = customControlValidityMessage(field.key)
      if (error) errors[field.key] = error
      else if (reported) errors[field.key] = `${field.label}: ${reported}`
      continue
    }
    if (field.type === 'data_table') {
      const config = field.data_table
      if (!config || config.mode === 'display') continue
      if (config.mode === 'select') {
        const { rows, errors: problems } = validateSelection(config, value)
        if (problems.length) { if (visible) errors[field.key] = `${field.label}: ${problems[0]}` }
        else if (required && !rows.length) errors[field.key] = `${field.label}: choose ${config.multiple ? 'at least one row' : 'a row'}`
        continue
      }
      const { changes, errors: problems } = validateChangeSet(config, value)
      if (problems.length) { if (visible) errors[field.key] = `${field.label}: ${problems.slice(0, 3).join('; ')}` }
      else if (required && !changeCount(changes)) errors[field.key] = `${field.label}: make at least one change`
      continue
    }
    if (field.type === 'boolean') {
      if (!isBlank(value) && toBoolean(value) === null) {
        errors[field.key] = `${field.label} must be true or false`
      } else if (required && toBoolean(value) !== true) {
        errors[field.key] = `${field.label} is required`
      }
      continue
    }
    if (isSurveyType(field.type)) {
      // Survey controls (lib/forms/survey/controls.ts): a matrix {} is blank; a required matrix needs every row.
      if (isBlankSurveyValue(field, value)) {
        if (required) errors[field.key] = `${field.label} is required`
        continue
      }
      if (!visible) continue
      const error = surveyValueError(field, value, Boolean(required))
      if (error) errors[field.key] = error
      continue
    }
    if (isBlank(value)) {
      if (required) errors[field.key] = `${field.label} is required`
      continue
    }
    if (!visible) continue
    const error = valueError(field, value)
    if (error) errors[field.key] = error
  }
  // Validate rules (field errors, blocked submits) — the same check the server runs at submit.
  if (!options.partial && options.layout) {
    const hiddenKeys = new Set(fields.filter((f) => pageHidden.has(f.key) || !isFieldVisible(f, vals)).map((f) => f.key))
    const ruleErrors = ruleValidationErrors(options.layout, vals, {
      hiddenKeys, state: vals[FORM_STATE_KEY] as FormUiState, user: options.user ?? null, buttonIds: options.buttonIds ?? null,
      ...(stepKeys ? { phase: 'step' as const, stepKeys } : {}),
    })
    for (const [key, message] of Object.entries(ruleErrors)) if (!errors[key]) errors[key] = message
  }
  return errors
}

function valueError(field: TaskFieldDef, value: unknown): string | null {
  const label = field.label
  if (field.type === 'attachments') return attachmentsValueError(field, value)
  if (field.type === 'lookup') {
    if (field.lookup?.multiple) {
      if (!Array.isArray(value) && typeof value !== 'string') return `${label} has an invalid value`
      const list = lookupValues(value, true)
      if (list.length > LOOKUP_LIMITS.maxSelections) return `${label}: choose at most ${LOOKUP_LIMITS.maxSelections}`
      if (list.some((v) => v.length > 1000)) return `${label} has an invalid value`
      return null
    }
    if (typeof value === 'object') return `${label} has an invalid value`
    return String(value).length > 1000 ? `${label} is too long` : null
  }
  if (field.type === 'multi_choice') {
    const list = toStringArray(value)
    const allowed = field.options ?? []
    // Options from a binding not resolved here (the browser before they load): the server resolves them
    // for the submission and judges against those (lib/services/form-dynamic-values.ts), never this list.
    const bad = hasUnresolvedOptions(field) ? [] : list.filter((v) => !allowed.includes(v))
    if (bad.length) return `${label} must be from: ${allowed.join(', ')}`
    if (field.min !== undefined && list.length < field.min) return `${label}: choose at least ${field.min}`
    if (field.max !== undefined && list.length > field.max) return `${label}: choose at most ${field.max}`
    return null
  }
  if (typeof value === 'object') return `${label} has an invalid value`
  const s = String(value).trim()
  switch (field.type) {
    case 'number':
    case 'currency': {
      const n = toNumber(value)
      if (n === null) return `${label} must be a number`
      if (field.min !== undefined && n < field.min) return `${label} must be at least ${field.min}`
      if (field.max !== undefined && n > field.max) return `${label} must be at most ${field.max}`
      return null
    }
    case 'date':
    case 'datetime': {
      if (!validDate(s)) return field.type === 'date' ? `${label} must be a date (YYYY-MM-DD)` : `${label} must be a date and time (ISO 8601)`
      if (field.min_date && dateKey(s) < dateKey(field.min_date)) return `${label} must be on or after ${field.min_date}`
      if (field.max_date && dateKey(s) > dateKey(field.max_date)) return `${label} must be on or before ${field.max_date}`
      return null
    }
    case 'choice': {
      const options = field.options ?? []
      if (!hasUnresolvedOptions(field) && !options.includes(s)) return `${label} must be one of: ${options.join(', ')}`
      return null
    }
    case 'user':
      return UUID_RE.test(s) ? null : `${label} must be a person in this workspace`
    default:
      break
  }
  // Text-like.
  if (s.length > MAX_TEXT) return `${label} is too long`
  if (field.type === 'email' && !EMAIL_RE.test(s)) return `${label} must be an email address`
  if (field.type === 'phone' && !PHONE_RE.test(s)) return `${label} must be a phone number`
  if (field.type === 'url') {
    try {
      const url = new URL(s)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${label} must be an http(s) URL`
    } catch {
      return `${label} must be an http(s) URL`
    }
  }
  if (field.min_length !== undefined && s.length < field.min_length) return `${label} must be at least ${field.min_length} characters`
  if (field.max_length !== undefined && s.length > field.max_length) return `${label} must be at most ${field.max_length} characters`
  if (field.pattern) {
    let re: RegExp
    try { re = compileUserRegex(field.pattern) } catch { return null }
    if (!re.test(s)) return field.pattern_message ? `${label}: ${field.pattern_message}` : `${label} is not in the expected format`
  }
  return null
}

/**
 * Coerce submitted values to their stored types: blank → null, number /
 * currency → Number, boolean → true/false, multi-select → string[],
 * datetime → ISO string, everything else → string. Only value fields in the
 * list are returned. Call after validateTaskFieldValues.
 */
export function coerceTaskFieldValues(
  fields: TaskFieldDef[],
  values: Record<string, unknown> | null | undefined,
): Record<string, TaskFieldValue> {
  const out: Record<string, TaskFieldValue> = {}
  const vals = values ?? {}
  for (const field of fields) {
    if (isDisplayField(field)) continue
    if (!Object.prototype.hasOwnProperty.call(vals, field.key)) continue
    out[field.key] = coerceOne(field, vals[field.key])
  }
  return out
}

function coerceOne(field: TaskFieldDef, value: unknown): TaskFieldValue {
  if (field.type === 'label') return coerceLabelValue(field, value)
  if (field.type === 'data_table') {
    const config = field.data_table
    if (!config || config.mode === 'display') return null
    if (config.mode === 'select') return validateSelection(config, value).rows as unknown as TaskFieldValue
    return validateChangeSet(config, value).changes as unknown as TaskFieldValue
  }
  if (field.type === 'custom') {
    if (field.custom?.value_type === 'files') return normalizeAttachmentValue(value)
    const typed = field.custom ? coerceCustomValue(field.custom, value) : value
    return (typed === undefined || (typeof typed === 'string' && typed.trim() === '') ? null : typed) as TaskFieldValue
  }
  if (isSurveyType(field.type)) return coerceSurveyValue(field, value) as TaskFieldValue
  if (field.type === 'boolean') return toBoolean(value) ?? false
  if (field.type === 'multi_choice') return toStringArray(value)
  if (field.type === 'lookup' && field.lookup?.multiple) return lookupValues(value, true)
  if (field.type === 'attachments') return normalizeAttachmentValue(value)
  if (isBlank(value)) return null
  if (field.type === 'number' || field.type === 'currency') return toNumber(value)
  if (field.type === 'datetime') {
    const d = new Date(String(value).trim())
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
  }
  if (field.type === 'date') {
    const s = String(value).trim()
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
  }
  return typeof value === 'string' ? value : String(value)
}

/** Initial values for a field list: each field's default (or a type-appropriate blank). */
export function defaultTaskFieldValues(
  fields: TaskFieldDef[],
  resolve: (value: string) => unknown = (v) => v,
): Record<string, TaskFieldValue> {
  const raw: Record<string, unknown> = {}
  for (const field of fields) {
    if (isDisplayField(field)) continue
    if (field.default !== undefined) raw[field.key] = resolve(field.default)
    else if (field.type === 'data_table') raw[field.key] = field.data_table?.mode === 'select' ? [] : null
    else raw[field.key] = field.type === 'boolean' ? false : field.type === 'multi_choice' || field.type === 'attachments' || (field.type === 'lookup' && field.lookup?.multiple) || (isSurveyType(field.type) && isMultiSurvey(field)) ? [] : null
  }
  return coerceTaskFieldValues(fields, raw)
}

/**
 * A User Task step's prefill map (`config.field_values`: field key →
 * expression or value), resolved and coerced: what the task opens with over
 * the fields' own defaults. Only the form's declared value fields are taken
 * (unknown keys, display fields and labels are ignored) and blank entries
 * are skipped, so the field's default still applies. The reusable form is
 * not changed; read-only fields stay read-only (mergeTaskFieldValues keeps
 * their stored value on submit).
 */
export function stepFieldValues(
  fields: TaskFieldDef[],
  map: unknown,
  resolve: (value: string) => unknown = (v) => v,
): Record<string, TaskFieldValue> {
  if (!isPlainObject(map)) return {}
  const raw: Record<string, unknown> = {}
  const targets: TaskFieldDef[] = []
  for (const field of fields) {
    if (isDisplayField(field) || field.type === 'label' || !Object.prototype.hasOwnProperty.call(map, field.key)) continue
    const template = map[field.key]
    if (template === undefined || template === null || (typeof template === 'string' && !template.trim())) continue
    raw[field.key] = typeof template === 'string' ? resolve(template) : template
    targets.push(field)
  }
  return coerceTaskFieldValues(targets, raw)
}

/**
 * Apply submitted values to a task's metadata: validates against
 * `metadata.fields` and returns the merged `template_values` (existing values
 * overlaid with the coerced submission). Only declared, editable field keys
 * are taken from `values` — read-only fields keep their stored value. On
 * completion (`partial: false`) the merged set is validated, so values saved
 * earlier as a draft count toward required fields. Never trust the client:
 * every surface (UI action, REST, MCP, CLI) goes through here.
 */
export function mergeTaskFieldValues(
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown> | null | undefined,
  options: {
    partial?: boolean
    buttonIds?: readonly string[] | null
    /** Data tables' source rows the server fetched for Labels reading `control.<table>.rows` (lib/forms/task-values.ts). */
    labelRows?: Record<string, Array<Record<string, unknown>>>
  } = {},
): { errors: Record<string, string>; templateValues: Record<string, unknown> } {
  const meta = metadata ?? {}
  const fields = normalizeTaskFields(meta.fields)
  const existing = isPlainObject(meta.template_values) ? meta.template_values : {}
  // Labels are never taken as sent: they are worked out below (serverLabelValues).
  const editable = fields.filter((field) => !field.read_only && !isDisplayField(field) && field.type !== 'label')
  const submitted: Record<string, unknown> = {}
  for (const field of editable) {
    if (values && Object.prototype.hasOwnProperty.call(values, field.key)) {
      // Custom controls with an output: what is judged and stored is the control's value (a form
      // opened again sends back its output; the value comes from `<key>_raw`, re-validated).
      submitted[field.key] = field.type === 'custom' && field.custom?.output ? nativeCustomValue(field.custom, field.key, values, existing) : values[field.key]
    }
  }
  // A steps / tabs form: fields on a hidden page are not required (judged on the full values).
  // The in-form buttons' state is judged as declared (sanitizeFormState); it is never stored.
  const layout = meta.form_layout
  const state = values && Object.prototype.hasOwnProperty.call(values, FORM_STATE_KEY) ? { [FORM_STATE_KEY]: values[FORM_STATE_KEY] } : {}
  // Parameters / variables ({{param.x}}, {{var.x}} in rules): the caller puts the server-validated ones in (serverFormContext).
  for (const key of [FORM_PARAMS_KEY, FORM_VARS_KEY, CONTROLS_KEY]) if (values && Object.prototype.hasOwnProperty.call(values, key)) Object.assign(state, { [key]: values[key] })
  // Optional sections (lib/forms/sections.ts): whether the person added each one (`<key>_included`, a boolean).
  const inclusion: Record<string, boolean> = {}
  for (const key of sectionIncludedKeys(layout)) {
    if (values && Object.prototype.hasOwnProperty.call(values, key)) inclusion[key] = values[key] === true || values[key] === 'true'
  }
  // Read-only fields a form rule wrote (Set / Copy / Clear values): kept only when a rule of the saved form could produce them.
  const readOnly = fields.filter((field) => field.read_only && !isDisplayField(field) && field.type !== 'label')
  const ruleWritten = values && readOnly.length && !options.partial
    ? ruleWrittenReadOnlyValues(layout, readOnly.map((f) => f.key), { ...existing, ...submitted, ...inclusion, ...values, ...state }, existing, null)
    : {}
  const base = { ...existing, ...submitted, ...inclusion, ...ruleWritten, ...state }
  // Labels (lib/forms/label-field.ts): recomputed from the checked values — rules judged below read these, never the browser's.
  const labels = fields.filter((f) => f.type === 'label')
  const labelValues = labels.length && values && !options.partial
    ? serverLabelValues(fields, layout, base, { sent: values, stored: existing, rows: options.labelRows })
    : {}
  const judged = { ...base, ...labelValues }
  const errors = options.partial
    ? validateTaskFieldValues(fields, submitted, { partial: true })
    : validateTaskFieldValues(fields, judged, { layout, buttonIds: options.buttonIds ?? null })
  const templateValues: Record<string, unknown> = {
    ...existing,
    ...coerceTaskFieldValues(editable, submitted),
    ...coerceTaskFieldValues(readOnly.filter((f) => Object.prototype.hasOwnProperty.call(ruleWritten, f.key)), ruleWritten),
    // Only labels marked "Include in submission" are stored.
    ...coerceTaskFieldValues(labels.filter((f) => f.label_config?.include && Object.prototype.hasOwnProperty.call(labelValues, f.key)), labelValues),
    ...inclusion,
  }
  if (!options.partial) {
    // A section left out: its fields are stored empty, and `<key>_included` says so.
    const patch = sectionInclusionPatch(layout, judged)
    const blanked = fields.filter((f) => patch.blank.includes(f.key) && !isDisplayField(f))
    Object.assign(templateValues, coerceTaskFieldValues(blanked, Object.fromEntries(blanked.map((f) => [f.key, null]))), patch.included)
  }
  // Custom control outputs (lib/forms/custom-controls/output.ts): `<key>` becomes the main output
  // (typed, HTML sanitised), the value stays under `<key>_raw`, extras beside it — recomputed here
  // from the validated value, never taken from the client.
  for (const field of fields) {
    if (field.type !== 'custom' || !field.custom?.output) continue
    const value = templateValues[field.key]
    if (value === undefined || (value === existing[field.key] && !Object.prototype.hasOwnProperty.call(submitted, field.key))) continue
    Object.assign(templateValues, customOutputEntries(field.key, field.custom, value))
  }
  return { errors, templateValues }
}

/** Data picker type of a field's value. */
export function fieldValueSchemaType(type: TaskFieldType): 'string' | 'number' | 'boolean' | 'array' | 'object' {
  if (type === 'number' || type === 'currency' || type === 'rating' || type === 'nps' || type === 'slider' || type === 'csat') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'multi_choice' || type === 'attachments' || type === 'ranking') return 'array'
  if (type === 'data_table' || type === 'matrix') return 'object'
  return 'string'
}
