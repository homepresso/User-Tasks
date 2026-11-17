/**
 * "Workflow data" in the form designer: when a User Task's form is designed
 * from its step ("Design form" in the workflow designer, or the form page
 * opened with ?workflow=<id>&step=<node id>), everything in scope at that
 * step, as fields the designer can drag onto the form:
 *
 *   List item      the trigger's record (a SharePoint list item through the
 *                  extension's `record` declaration, a data table row),
 *                  every column with its type and choices, system / read-only
 *                  columns included, plus the trigger's other run variables;
 *   Start inputs   workflow input parameters (start form) and the fields of a
 *                  form / task that started the run;
 *   Variables      Set Variable results and the current loop item;
 *   Earlier steps  previous tasks' outcomes and form fields, lookups, HTTP /
 *                  reference results — whatever the steps before set.
 *
 * The scope is the workflow designer's own (buildDataTree in
 * lib/workflow-data-picker.ts — the data picker and the engine agree on
 * every path); this module only groups it, picks a control for each entry
 * and turns an entry into a form field.
 *
 * A dropped entry binds through the field's `default` — an expression the
 * engine resolves when the task is created (defaultTaskFieldValues, the
 * existing resolver), so nothing new is stored on the form:
 *
 *   prefill    default = {{after.Title}}            editable, starts with the value
 *   read_only  default = {{after.Title}}, read_only shown, never edited
 *   empty      no default                           same type and label only
 *
 * Values of the trigger's record are also refreshed when the task opens
 * (lib/forms/live-prefill.ts). Credential-shaped names (lib/secret-keys) are
 * never offered. Pure and isomorphic.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { extensionCatalogEntry } from '@/lib/extensions/nodes'
import { isSensitiveKey } from '@/lib/secret-keys'
import type { SchemaNode } from '@/lib/response-schema'
import { buildDataTree, nodeFormFields, type DataGroup, type DataRoot, type LinkedFormLike, type PickerEdgeLike, type PickerNodeLike, type PickerWorkflowVariable, upstreamNodeIds } from '@/lib/workflow-data-picker'
import { fieldKeyFromLabel, isDisplayField, TASK_FIELD_TYPE_LABELS, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'

export type WorkflowDataGroupKey = 'list' | 'start' | 'variables' | 'steps'
export const WORKFLOW_DATA_GROUPS: WorkflowDataGroupKey[] = ['list', 'start', 'variables', 'steps']
export const WORKFLOW_DATA_GROUP_LABELS: Record<WorkflowDataGroupKey, string> = { list: 'List item', start: 'Start inputs', variables: 'Variables', steps: 'Earlier steps' }

export type WorkflowDataMode = 'prefill' | 'read_only' | 'empty'
export const WORKFLOW_DATA_MODE_LABELS: Record<WorkflowDataMode, string> = { prefill: 'Prefill from list data', read_only: 'Show read-only', empty: 'Empty field' }

/** Where a lookup column's options come from (an extension's lookup source: lib/forms/lookup.ts `extension`). */
export interface RecordLookupSource { extension: string; provider: string; source: string; value_field?: string; label_field?: string }

/** One field (column) of the trigger's record, as a provider describes it (FormTargetSourceField, or a filter field). */
export interface RecordField {
  key: string
  label: string
  typeLabel?: string
  /** Form field types that can hold it, the suggested one first (FormTargetSourceField.fieldTypes). */
  fieldTypes?: TaskFieldType[]
  /** A filter-field type (string, number, date, boolean, choice, multichoice, user, lookup) or a data table column type. */
  type?: string
  choices?: string[]
  readOnly?: boolean
  required?: boolean
  multi?: boolean
  group?: string | null
  help?: string | null
  /** Sub-path of a structured value's plain value (`value` of a lookup's { id, value }). */
  valuePath?: string | null
  /** A lookup column's source list, when the provider offers it as a lookup source. */
  lookupSource?: RecordLookupSource | null
}

/** The trigger record behind the step: run variable + its fields. */
export interface TriggerRecordInfo {
  kind: 'extension' | 'table'
  nodeId: string
  nodeType: string
  /** Run variable holding the values by field key ('after', 'row'). */
  variable: string
  label: string
  /** Extension triggers: the extension and its UI data source listing the fields. */
  extensionId?: string
  fieldsFrom?: string
  /** Run variables identifying the record (record.idFrom). */
  idFrom?: string[]
  config: Record<string, unknown>
  /** Data table triggers: the columns cached on the trigger. */
  fields?: RecordField[]
}

/** Display-only controls (the value can't be edited, or has no editable control). */
interface Control {
  type: TaskFieldType
  options?: string[]
  option_labels?: Record<string, string>
  currency?: string
  display?: TaskFieldDef['display']
  multiple?: boolean
  /** The value can't be edited here (shown only). */
  displayOnly?: boolean
  lookup?: TaskFieldDef['lookup']
}

export interface WorkflowDataEntry {
  /** Stable id: the expression path. */
  id: string
  group: WorkflowDataGroupKey
  /** Expression path, e.g. `after.Title`, `approve_task_data.comments`. */
  path: string
  /** `{{path}}` */
  token: string
  label: string
  /** Where it comes from ("List item", "Approve › Form", "Get customer"). */
  source: string
  typeLabel: string
  control: Control
  /** The value can't be written back / edited (system columns, display-only values): prefill is not offered. */
  readOnly: boolean
  system?: boolean
  /** The record's field key (list entries): name matching and saving back. */
  column?: string
  sample?: unknown
}

export interface WorkflowDataScope {
  entries: WorkflowDataEntry[]
  record: TriggerRecordInfo | null
}

const MAX_ENTRIES = 800

export const tokenFor = (path: string) => `{{${path}}}`
const TOKEN_RE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}$/

/** The path of a value that is exactly one token (`{{after.Title}}` → `after.Title`), else null. */
export function singleTokenPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return TOKEN_RE.exec(value.trim())?.[1] ?? null
}

/** A path segment that names a credential or an internal value: never offered. */
function hiddenPath(path: string): boolean {
  return path.split('.').some((seg) => seg.startsWith('_') || isSensitiveKey(seg))
}

/* ── the trigger's record ───────────────────────────────────────────── */

const TABLE_TYPES: Record<string, string> = { text: 'string', number: 'number', date: 'date', datetime: 'datetime', boolean: 'boolean', choice: 'choice', email: 'string', url: 'string' }

/** The upstream trigger whose record the step can read (an extension trigger declaring `record`, or a data table event). */
export function triggerRecordFor(nodes: PickerNodeLike[], edges: PickerEdgeLike[], nodeId: string | null): TriggerRecordInfo | null {
  const upstream = nodeId ? upstreamNodeIds(nodeId, edges) : null
  for (const node of nodes) {
    if (upstream && !upstream.has(node.id)) continue
    const config = (isPlainObject(node.config) ? node.config : {}) as Record<string, unknown>
    if (node.type === 'data_table_event') {
      const cols = Array.isArray(config._table_columns) ? config._table_columns as Array<{ key?: string; label?: string; type?: string; options?: unknown }> : []
      return {
        kind: 'table', nodeId: node.id, nodeType: node.type, variable: 'row', label: 'Table row', config,
        fields: cols.filter((c) => typeof c?.key === 'string' && c.key).map((c) => ({
          key: String(c.key), label: String(c.label ?? c.key), type: TABLE_TYPES[String(c.type ?? 'text')] ?? 'string', typeLabel: String(c.type ?? 'text'),
          ...(Array.isArray(c.options) ? { choices: c.options.map(String).slice(0, 200) } : {}),
        })),
      }
    }
    const ext = extensionCatalogEntry(node.type)
    if (ext?.category === 'trigger' && ext.record) {
      return {
        kind: 'extension', nodeId: node.id, nodeType: node.type, variable: ext.record.variable, label: ext.record.label ?? 'List item',
        extensionId: ext.extensionId, fieldsFrom: ext.record.fieldsFrom, idFrom: ext.record.idFrom ?? [], config,
      }
    }
  }
  return null
}

const FIELD_TYPE_SET = new Set<string>(Object.keys(TASK_FIELD_TYPE_LABELS))

/** A provider's `{ fields }` answer (FormTargetSourceField or filter-field shapes) → clean record fields. */
export function normalizeRecordFields(raw: unknown): RecordField[] {
  const list = isPlainObject(raw) && Array.isArray(raw.fields) ? raw.fields : Array.isArray(raw) ? raw : []
  const out: RecordField[] = []
  const seen = new Set<string>()
  for (const f of list.slice(0, 500)) {
    if (!isPlainObject(f)) continue
    const key = String(f.key ?? f.name ?? '').trim()
    if (!key || key.length > 200 || seen.has(key) || hiddenPath(key)) continue
    seen.add(key)
    const field: RecordField = { key, label: String(f.label ?? f.title ?? key).slice(0, 200) }
    if (typeof f.typeLabel === 'string') field.typeLabel = f.typeLabel.slice(0, 80)
    if (Array.isArray(f.fieldTypes)) field.fieldTypes = f.fieldTypes.filter((t): t is TaskFieldType => FIELD_TYPE_SET.has(String(t)))
    if (typeof f.type === 'string') field.type = f.type
    if (Array.isArray(f.choices)) field.choices = f.choices.map(String).slice(0, 500)
    if (f.readOnly === true) field.readOnly = true
    if (f.required === true) field.required = true
    if (f.multi === true) field.multi = true
    if (typeof f.group === 'string') field.group = f.group
    if (typeof f.help === 'string') field.help = f.help.slice(0, 500)
    if (typeof f.valuePath === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(f.valuePath)) field.valuePath = f.valuePath
    const ls = f.lookupSource
    if (isPlainObject(ls) && typeof ls.extension === 'string' && typeof ls.provider === 'string' && typeof ls.source === 'string') {
      field.lookupSource = { extension: ls.extension, provider: ls.provider, source: ls.source, ...(typeof ls.value_field === 'string' ? { value_field: ls.value_field } : {}), ...(typeof ls.label_field === 'string' ? { label_field: ls.label_field } : {}) }
    }
    out.push(field)
  }
  return out
}

/* ── controls ───────────────────────────────────────────────────────── */

/** Field types a dropped entry may become (complex controls are never made from data). */
const DROPPABLE = new Set<TaskFieldType>(['text', 'textarea', 'number', 'currency', 'email', 'phone', 'url', 'date', 'datetime', 'boolean', 'choice', 'multi_choice', 'user', 'lookup', 'label'])

const display = (type: TaskFieldType = 'label'): Control => ({ type, displayOnly: true })

/** The control for a column of the trigger's record. */
export function recordFieldControl(f: RecordField): Control {
  const label = (f.typeLabel ?? '').toLowerCase()
  const kind = (f.type ?? '').toLowerCase()
  if (/attach|^file$|document|picture|image/.test(label) || kind === 'file' || kind === 'attachments') return display()
  const isLookup = kind === 'lookup' || /lookup|managed metadata/.test(label) || Boolean(f.lookupSource)
  if (isLookup) {
    if (f.lookupSource) {
      return { type: 'lookup', multiple: Boolean(f.multi), lookup: { source: 'extension', extension: f.lookupSource.extension, provider: f.lookupSource.provider, source_id: f.lookupSource.source, source_label: f.label, value_column: f.lookupSource.value_field ?? 'id', ...(f.lookupSource.label_field ? { display_columns: [f.lookupSource.label_field], search_columns: [f.lookupSource.label_field] } : {}), ...(f.multi ? { multiple: true } : {}) } as TaskFieldDef['lookup'] }
    }
    if (f.choices?.length) return { type: f.multi ? 'multi_choice' : 'choice', options: f.choices }
    return { type: 'text', displayOnly: true }
  }
  const suggested = (f.fieldTypes ?? []).find((t) => DROPPABLE.has(t))
    ?? (f.fieldTypes?.includes('rich_text') ? 'textarea' : undefined)
  let type: TaskFieldType | undefined = suggested
  if (!type) {
    if (/multiple lines|note|multi-line|long text/.test(label)) type = 'textarea'
    else if (/currency/.test(label) || kind === 'currency') type = 'currency'
    else if (kind === 'number' || kind === 'integer') type = 'number'
    else if (kind === 'datetime' || /date and time/.test(label)) type = 'datetime'
    else if (kind === 'date') type = 'date'
    else if (kind === 'boolean' || /yes\/no/.test(label)) type = 'boolean'
    else if (kind === 'choice') type = 'choice'
    else if (kind === 'multichoice') type = 'multi_choice'
    else if (kind === 'user' || /person/.test(label)) type = 'user'
    else if (/hyperlink|url/.test(label)) type = 'url'
    else type = 'text'
  }
  if ((type === 'choice' || type === 'multi_choice') && !f.choices?.length) type = 'text'
  const control: Control = { type }
  if (type === 'choice' || type === 'multi_choice') control.options = f.choices
  if (type === 'currency') control.currency = 'USD'
  if (type === 'user' && f.multi) control.multiple = true
  if (f.multi && type === 'choice') { control.type = 'multi_choice' }
  return control
}

/** The control for an earlier form's field (same type, options and currency; complex values shown read-only). */
export function taskFieldControl(field: TaskFieldDef): Control | null {
  if (field.type === 'attachments' || field.type === 'image' || field.type === 'signature' || field.type === 'text_list') return display()
  if (field.type === 'rich_text') return display()
  if (field.type === 'data_table' || field.type === 'list' || field.type === 'repeating_section' || field.type === 'custom') return null
  if (field.type === 'label') return display()
  if (field.type === 'lookup') return { type: 'text', displayOnly: true }
  if (!DROPPABLE.has(field.type)) return { type: 'text', displayOnly: true }
  const control: Control = { type: field.type }
  if (field.options?.length) control.options = [...field.options]
  if (field.option_labels) control.option_labels = { ...field.option_labels }
  if (field.currency) control.currency = field.currency
  if (field.display) control.display = field.display
  if (field.type === 'user' && (field.user_config?.multiple || field.user_config?.allow_teams)) control.multiple = true
  return control
}

const FILE_KEYS = ['name', 'url']
function isFileSchema(s: SchemaNode | undefined | null): boolean {
  const names = new Set((s?.fields ?? []).map((f) => f.name))
  return Boolean(s && s.type === 'object' && FILE_KEYS.every((k) => names.has(k)) && (names.has('size') || names.has('mime_type') || names.has('storage_ref')))
}

/** The control for a value the steps set (typed by its model). Null: not offered (objects are expanded instead). */
export function schemaControl(schema: SchemaNode | null | undefined, key: string): Control | null {
  const name = key.toLowerCase()
  if (!schema) return { type: 'text' }
  if (isFileSchema(schema)) return display()
  switch (schema.type) {
    case 'boolean': return { type: 'boolean' }
    case 'number': case 'integer': return { type: /amount|price|cost|total/.test(name) && schema.type === 'number' ? 'currency' : 'number', ...(/amount|price|cost|total/.test(name) && schema.type === 'number' ? { currency: 'USD' } : {}) }
    case 'array':
      if (isFileSchema(schema.items)) return display()
      if (schema.items?.type === 'string' || !schema.items) return display()
      return null
    case 'object': return null
    default: {
      const format = schema.format ?? ''
      const desc = (schema.description ?? '').toLowerCase()
      if (format === 'date' || /\(yyyy-mm-dd\)/.test(desc)) return { type: 'date' }
      if (format === 'date-time' || /_at$|^date$|iso 8601/.test(name) || /iso 8601/.test(desc)) return { type: 'datetime' }
      if (format === 'email' || /email/.test(name)) return { type: 'email' }
      if (format === 'uri' || /(^|_)url$|link$/.test(name)) return { type: 'url' }
      if (/notes|comment|description|summary|message|body/.test(name)) return { type: 'textarea' }
      return { type: 'text' }
    }
  }
}

/** A sample value for the designer's preview (never a real value). */
export function controlSample(control: Control, label: string, example?: unknown): unknown {
  if (example !== undefined && example !== null && typeof example !== 'object') return example
  switch (control.type) {
    case 'number': return 42
    case 'currency': return 1250
    case 'date': return '2026-01-15'
    case 'datetime': return '2026-01-15T09:30:00Z'
    case 'boolean': return true
    case 'choice': return control.options?.[0] ?? null
    case 'multi_choice': return control.options?.slice(0, 1) ?? []
    case 'email': return 'name@example.com'
    case 'url': return 'https://example.com'
    case 'user': case 'lookup': return null
    default: return label
  }
}

/* ── the scope ──────────────────────────────────────────────────────── */

export interface WorkflowDataScopeInput {
  nodes: PickerNodeLike[]
  edges: PickerEdgeLike[]
  /** The task step whose form is designed. */
  nodeId: string
  workflowVariables?: PickerWorkflowVariable[]
  linkedForms?: Record<string, LinkedFormLike> | null
  /** The record's fields (the trigger's `record.fieldsFrom` answer) for an extension trigger. */
  recordFields?: RecordField[] | null
}

const TASK_FORM_TRIGGERS = new Set(['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected'])
/** Run variables a trigger sets that are its record's values or internals (covered by the columns). */
const RECORD_SKIP = new Set(['before', 'changed_fields', 'events'])

/** Everything in scope at the step, grouped (List item, Start inputs, Variables, Earlier steps), each with its control. */
export function workflowDataScope(input: WorkflowDataScopeInput): WorkflowDataScope {
  const { nodes, edges, nodeId } = input
  const groups = buildDataTree({ nodes, edges, currentNodeId: nodeId, workflowVariables: input.workflowVariables, linkedForms: input.linkedForms })
  const record = triggerRecordFor(nodes, edges, nodeId)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const entries: WorkflowDataEntry[] = []
  const seen = new Set<string>()
  const push = (entry: Omit<WorkflowDataEntry, 'id' | 'token'>) => {
    if (entries.length >= MAX_ENTRIES || seen.has(entry.path) || hiddenPath(entry.path)) return
    seen.add(entry.path)
    entries.push({ ...entry, id: entry.path, token: tokenFor(entry.path) })
  }

  // List item: the record's columns first, then the trigger's other run variables (system, read only).
  if (record) {
    const fields = record.kind === 'table' ? record.fields ?? [] : input.recordFields ?? []
    for (const f of fields) {
      const control = recordFieldControl(f)
      const path = `${record.variable}.${f.key}${f.valuePath && control.type !== 'lookup' ? `.${f.valuePath}` : ''}`
      const system = f.group === 'system'
      push({
        group: 'list', path, label: f.label, source: record.label, typeLabel: f.typeLabel ?? TASK_FIELD_TYPE_LABELS[control.type],
        control, readOnly: Boolean(f.readOnly || control.displayOnly), ...(system ? { system: true } : {}), column: f.key, sample: controlSample(control, f.label),
      })
    }
  }

  for (const group of groups) {
    const node = group.nodeId ? byId.get(group.nodeId) : undefined
    if (record && group.nodeId === record.nodeId) {
      if (record.kind === 'table') continue
      for (const root of group.roots) {
        if (root.path === record.variable || RECORD_SKIP.has(root.path)) continue
        addRoot('list', root, record.label, { system: true, readOnly: true })
      }
      continue
    }
    const target: WorkflowDataGroupKey = group.kind === 'loop' ? 'variables'
      : group.kind === 'workflow' ? 'start'
      : group.kind === 'form' && (group.nodeType === 'form_submitted' || TASK_FORM_TRIGGERS.has(group.nodeType ?? '')) ? 'start'
      : group.kind === 'trigger' ? 'start'
      : group.kind === 'step' && group.nodeType === 'set_variable' ? 'variables'
      : group.kind === 'step' && extensionCatalogEntry(group.nodeType ?? '')?.category === 'trigger' ? 'start'
      : 'steps'
    const source = group.kind === 'workflow' ? 'Workflow input' : group.label
    if (group.kind === 'form' && node) {
      // An earlier form's fields: the same control as the field (options, currency).
      const defs = new Map(nodeFormFields(node, input.linkedForms).map((f) => [f.key, f]))
      for (const root of group.roots) {
        const key = root.path.split('.').pop() ?? ''
        const def = defs.get(key)
        if (def && !isDisplayField(def)) {
          const control = taskFieldControl(def)
          if (!control) continue
          push({ group: target, path: root.path, label: def.label || key, source, typeLabel: TASK_FIELD_TYPE_LABELS[def.type], control, readOnly: Boolean(control.displayOnly), sample: controlSample(control, def.label || key, def.default) })
        } else addRoot(target, root, source)
      }
      continue
    }
    for (const root of group.roots) addRoot(target, root, source)
  }

  function addRoot(group: WorkflowDataGroupKey, root: DataRoot, source: string, extra: { system?: boolean; readOnly?: boolean } = {}, depth = 0) {
    const schema = root.schema
    const control = schemaControl(schema, root.path.split('.').pop() ?? root.path)
    if (control) {
      push({
        group, path: root.path, label: root.label, source, typeLabel: control.displayOnly ? (schema?.type === 'array' ? 'List' : 'File') : TASK_FIELD_TYPE_LABELS[control.type],
        control, readOnly: Boolean(extra.readOnly || control.displayOnly), ...(extra.system ? { system: true } : {}), sample: controlSample(control, root.label, schema?.example),
      })
      return
    }
    // Objects: their fields, two levels down (a lookup's row, a response's data).
    if (schema?.type === 'object' && depth < 2) {
      for (const f of (schema.fields ?? []).slice(0, 60)) {
        addRoot(group, { path: `${root.path}.${f.name}`, label: `${root.label} › ${f.name}`, schema: f }, source, extra, depth + 1)
      }
    }
  }

  return { entries, record }
}

/** Entries grouped and filtered by a search (label, path, type, source). */
export function groupWorkflowData(entries: WorkflowDataEntry[], query = ''): Array<{ key: WorkflowDataGroupKey; label: string; entries: WorkflowDataEntry[] }> {
  const q = query.trim().toLowerCase()
  const match = (e: WorkflowDataEntry) => !q || [e.label, e.path, e.typeLabel, e.source].some((s) => s.toLowerCase().includes(q))
  return WORKFLOW_DATA_GROUPS.map((key) => ({ key, label: WORKFLOW_DATA_GROUP_LABELS[key], entries: entries.filter((e) => e.group === key && match(e)) })).filter((g) => g.entries.length)
}

/* ── binding modes ──────────────────────────────────────────────────── */

/** The mode an entry gets on drop: list columns are prefilled, read-only / display values shown read only, other data shown read only. */
export function defaultMode(entry: WorkflowDataEntry): WorkflowDataMode {
  if (entry.readOnly) return 'read_only'
  return entry.group === 'list' ? 'prefill' : 'read_only'
}

/** Modes an entry allows (prefill needs an editable value). */
export function allowedModes(entry: WorkflowDataEntry): WorkflowDataMode[] {
  return entry.readOnly ? ['read_only', 'empty'] : ['prefill', 'read_only', 'empty']
}

/** A new form field for an entry (key from the label; the designer makes it unique). */
export function fieldFromEntry(entry: WorkflowDataEntry, mode: WorkflowDataMode): TaskFieldDef {
  const m = allowedModes(entry).includes(mode) ? mode : defaultMode(entry)
  const c = entry.control
  const key = fieldKeyFromLabel(entry.label) || fieldKeyFromLabel(entry.column ?? '') || 'field'
  const field: TaskFieldDef = { key, label: entry.label, type: c.type }
  if (c.options) field.options = [...c.options]
  if (c.option_labels) field.option_labels = { ...c.option_labels }
  if (c.currency) field.currency = c.currency
  if (c.display) field.display = c.display
  if (c.type === 'user' && c.multiple) field.user_config = { multiple: true }
  if (c.type === 'lookup') field.lookup = { ...(c.lookup ?? { source: 'table' }) } as TaskFieldDef['lookup']
  return { ...field, ...modePatch(field, entry, m) } as TaskFieldDef
}

/** The field properties a mode sets (for a field bound to `entry`, or unbound when entry is null). */
export function modePatch(field: Pick<TaskFieldDef, 'type'>, entry: WorkflowDataEntry | null, mode: WorkflowDataMode): Partial<TaskFieldDef> {
  if (mode === 'empty' || !entry) return { default: undefined, ...(field.type === 'label' ? {} : { read_only: undefined }) }
  if (field.type === 'label') return { default: entry.token }
  return mode === 'read_only' ? { default: entry.token, read_only: true } : { default: entry.token, read_only: undefined }
}

/** The entry a field is bound to (its default is exactly that entry's token) and the mode. */
export function fieldBinding(field: Pick<TaskFieldDef, 'type' | 'default' | 'read_only'>, entries: WorkflowDataEntry[]): { entry: WorkflowDataEntry; mode: WorkflowDataMode } | null {
  const path = singleTokenPath(field.default)
  if (!path) return null
  const entry = entries.find((e) => e.path === path)
  if (!entry) return null
  return { entry, mode: field.read_only || field.type === 'label' ? 'read_only' : 'prefill' }
}

/** Token → readable label ("List item › Title"), for the canvas and the preview. */
export function tokenLabels(entries: WorkflowDataEntry[]): Map<string, string> {
  return new Map(entries.map((e) => [e.path, `${e.group === 'list' ? WORKFLOW_DATA_GROUP_LABELS.list : e.source} › ${e.label}`]))
}

/** Preview samples by path: a field's default token shows its sample in Preview (WYSIWYG). */
export function previewSamples(entries: WorkflowDataEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const e of entries) if (e.sample !== undefined && e.sample !== null) out[e.path] = e.sample
  return out
}

/* ── bulk prefill ───────────────────────────────────────────────────── */

/** Name for matching: SharePoint's _x0020_ escapes decoded, case, spaces and punctuation ignored. */
export function matchName(value: string): string {
  return String(value ?? '')
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
}

const COMPATIBLE: Record<string, TaskFieldType[]> = {
  text: ['text', 'textarea', 'email', 'phone', 'url', 'choice', 'number', 'currency', 'date', 'datetime'],
  textarea: ['text', 'textarea', 'email', 'phone', 'url', 'choice'],
  email: ['email', 'text'], phone: ['phone', 'text'], url: ['url', 'text'],
  number: ['number', 'currency'], currency: ['currency', 'number'],
  date: ['date', 'datetime'], datetime: ['datetime', 'date'],
  boolean: ['boolean'], choice: ['choice', 'text'], multi_choice: ['multi_choice'],
  user: ['user'], lookup: ['lookup', 'choice', 'text'],
}

/** Can a field of type `fieldType` hold the entry's value? (labels show anything) */
export function compatibleType(fieldType: TaskFieldType, entry: WorkflowDataEntry): boolean {
  if (fieldType === 'label') return true
  if (entry.control.displayOnly) return fieldType === 'text' || fieldType === 'textarea'
  return (COMPATIBLE[fieldType] ?? []).includes(entry.control.type)
}

/**
 * "Prefill all fields from list data": existing fields without a default whose
 * key or label matches a list column's key or label (matchName), of a type
 * that can hold it. Each field gets at most one column.
 */
export function bulkPrefillPlan(fields: TaskFieldDef[], entries: WorkflowDataEntry[]): Array<{ fieldKey: string; entry: WorkflowDataEntry }> {
  const list = entries.filter((e) => e.group === 'list' && e.column)
  const byName = new Map<string, WorkflowDataEntry>()
  for (const e of list) {
    for (const name of [matchName(e.column!), matchName(e.label)]) if (name && !byName.has(name)) byName.set(name, e)
  }
  const out: Array<{ fieldKey: string; entry: WorkflowDataEntry }> = []
  for (const field of fields) {
    if (isDisplayField(field) || ['data_table', 'list', 'repeating_section', 'custom', 'attachments', 'image', 'signature', 'button'].includes(field.type)) continue
    if (field.default !== undefined && String(field.default).trim() !== '') continue
    const entry = byName.get(matchName(field.key)) ?? byName.get(matchName(field.label))
    if (entry && compatibleType(field.type, entry)) out.push({ fieldKey: field.key, entry })
  }
  return out
}

/* ── saving back to the record ──────────────────────────────────────── */

/**
 * A form whose Save rule writes the record ("Save to …", the save_target
 * action): the prefilled field maps back to its column (`values[column] =
 * {{form.<key>}}`), unless the step already sets that column. Buttons are
 * passed through untouched when none has the action.
 */
export function withSaveTargetValue<T>(buttons: T[], column: string, fieldKey: string): { buttons: T[]; changed: boolean } {
  let changed = false
  const next = buttons.map((b) => {
    const actions = isPlainObject(b) && Array.isArray((b as any).actions) ? (b as any).actions as any[] : null
    if (!actions?.some((a) => a?.type === 'save_target')) return b
    const nextActions = actions.map((a) => {
      if (a?.type !== 'save_target') return a
      const values = isPlainObject(a.values) ? a.values as Record<string, string> : {}
      if (values[column]) return a
      changed = true
      return { ...a, values: { ...values, [column]: `{{form.${fieldKey}}}` } }
    })
    return { ...(b as any), actions: nextActions } as T
  })
  return { buttons: changed ? next : buttons, changed }
}

/** Groups of a data tree (re-exported for callers that already hold them). */
export type { DataGroup }
