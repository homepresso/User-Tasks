/**
 * Data the workflow designer can pick from at a given step: every upstream
 * step's outputs as a tree (following reference response models level by
 * level), the current loop item inside a loop body, workflow variables and
 * trigger data — plus the expressions each picker choice inserts.
 *
 * Pure (no React): shared by the data picker popover, the Variables panel and
 * the Loop node's "items to loop through" autocomplete, so they never drift.
 *
 * Expression syntax is the engine resolver's (lib/expression-resolver):
 * `{{step_response.data.0.email}}` (dotted, numeric segments index arrays;
 * `data[0]` also works) and `{{=FUNC(...)}}` for functions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { extensionCatalogEntry } from './extensions/nodes'
import { documentNodeRoots } from '@/lib/documents/schemas'
import { mediaNodeRoots } from '@/lib/media/schemas'
import {
  inferSchema,
  isResponseSchema,
  normalizeResponseSchema,
  schemaAtPath,
  schemaFromColumns,
  schemaFromOutputs,
  splitPath,
  type SchemaNode,
} from './response-schema'
import { lookupItemFields, lookupItemKey, lookupLabelKey } from './forms/lookup'
import { runAgentOutputPrefix } from './agent-knowledge'
import { attachmentsCountKey } from './forms/attachments'
import { richTextTextKey } from './forms/rich-text'
import { isPeopleList } from './forms/people-field'
import { childListPaths, childListAt, isNumericColumn, listCountKey, listTotalKey, listTotalLabel, type ListColumn, type ListFieldConfig } from './forms/list-field'
import { repeatingCountKey, repeatingTotalKey } from './forms/repeating-section'
import { customValueSchemaType } from './forms/custom-controls/field'
import { activeOutput, keepsRaw, outputExtraKeys } from './forms/custom-controls/output'
import type { ControlValueSchema } from './forms/custom-controls/contract'
import { actionFieldSchema } from './custom-actions/manifest'
import { ACTION_FIELD_TYPES, type ActionField } from './custom-actions/contract'
import { projectedKeys } from './forms/data-table'
import { includedContextSchema } from './forms/form-params'
import { SUBMISSION_META_FIELDS, SUBMISSION_META_KEY } from './forms/submission-meta'
import { fieldValueSchemaType, normalizeTaskFields, TASK_FIELD_TYPE_LABELS, valueFields, type TaskFieldDef } from './task-field-schema'
import { setVariableAssignments } from './workflow-set-variable'

export interface PickerNodeLike {
  id: string
  type: string
  label: string
  config: Record<string, any>
}

export interface PickerEdgeLike {
  id?: string
  source: string
  target: string
  label?: string
}

export interface PickerWorkflowVariable {
  name: string
  type?: string
  defaultValue?: string
  description?: string
  /** Start-form label (lib/forms/start-form.ts). */
  label?: string
}

/** A reusable form as the picker needs it (fields of its latest version). */
export interface LinkedFormLike {
  fields: unknown
  /** The form's layout (parameters / variables "Include in submission"). */
  layout?: unknown
  version?: number
  name?: string
}

/** `form` = form fields (trigger form, task forms); `recent` = recently used. */
export type DataGroupKind = 'loop' | 'step' | 'workflow' | 'trigger' | 'task' | 'form' | 'recent'

/** One pickable top-level value (a workflow variable name) with its model. */
export interface DataRoot {
  /** The variable path the engine sets, e.g. `get_customers_response`. */
  path: string
  /** Display label within its group, e.g. `response`. */
  label: string
  schema: SchemaNode | null
  description?: string
  /** Secondary text: the technical key/path when the label is a human label. */
  hint?: string
}

export interface DataGroup {
  id: string
  label: string
  kind: DataGroupKind
  nodeId?: string
  nodeType?: string
  roots: DataRoot[]
}

export interface BuildDataTreeInput {
  nodes: PickerNodeLike[]
  edges: PickerEdgeLike[]
  /** The step being configured. Null/undefined → every step (Variables panel with nothing selected). */
  currentNodeId?: string | null
  workflowVariables?: PickerWorkflowVariable[]
  /** Linked reusable forms by id (latest version) — fills a missing / stale cached copy. */
  linkedForms?: Record<string, LinkedFormLike> | null
}

// ─── Graph scoping ─────────────────────────────────────────────────────

/** Ids of every node with a path TO `nodeId` (excluding itself unless it is on a cycle). */
export function upstreamNodeIds(nodeId: string, edges: PickerEdgeLike[]): Set<string> {
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? []
    list.push(edge.source)
    incoming.set(edge.target, list)
  }
  const seen = new Set<string>()
  const queue = [...(incoming.get(nodeId) ?? [])]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const source of incoming.get(id) ?? []) if (!seen.has(source)) queue.push(source)
  }
  seen.delete(nodeId)
  return seen
}

/**
 * The nodes a Loop re-runs per item — the engine's rule: targets of its
 * "Each Item" (or unlabeled) edges and everything reachable from them,
 * stopping at the loop itself and its "Done" targets.
 */
export function loopBodyNodeIds(loopId: string, edges: PickerEdgeLike[]): Set<string> {
  const out = edges.filter((edge) => edge.source === loopId)
  const label = (edge: PickerEdgeLike) => (edge.label ?? '').toLowerCase().trim()
  const body = out.filter((edge) => label(edge) === 'each item' || label(edge) === '')
  const done = out.filter((edge) => label(edge) === 'done')
  const bodyEdges = body.length > 0 || done.length > 0 ? body : out
  const doneTargets = new Set(done.map((edge) => edge.target))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge.target)
    outgoing.set(edge.source, list)
  }
  const ids = new Set<string>()
  const visit = (id: string) => {
    if (ids.has(id) || id === loopId || doneTargets.has(id)) return
    ids.add(id)
    for (const next of outgoing.get(id) ?? []) visit(next)
  }
  for (const edge of bodyEdges) visit(edge.target)
  return ids
}

/** Loop nodes whose body contains `nodeId`, outermost first. */
export function enclosingLoops(nodeId: string, nodes: PickerNodeLike[], edges: PickerEdgeLike[]): PickerNodeLike[] {
  const loops = nodes
    .filter((node) => node.type === 'loop' && node.id !== nodeId)
    .map((node) => ({ node, body: loopBodyNodeIds(node.id, edges) }))
    .filter((entry) => entry.body.has(nodeId))
  loops.sort((a, b) => b.body.size - a.body.size)
  return loops.map((entry) => entry.node)
}

// ─── Per-node outputs ──────────────────────────────────────────────────

export function nodeOutputPrefix(node: PickerNodeLike): string {
  return node.config?._output_prefix
    || String(node.label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
    || node.id.slice(0, 8)
}

function str(type: SchemaNode['type'], description?: string): SchemaNode {
  return description ? { type, description } : { type }
}

/** {{submission.*}}: the submission metadata (lib/forms/submission-meta.ts), typed. */
export const SUBMISSION_META_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'Who submitted the form, when and from where (set by the server)',
  fields: SUBMISSION_META_FIELDS.map((f) => ({
    name: f.name, type: f.type, description: f.description,
    ...(f.fields ? { fields: f.fields.map((c) => ({ name: c.name, type: c.type, description: c.description })) } : {}),
  })),
}

function submissionRoot(description: string): DataRoot {
  return { path: SUBMISSION_META_KEY, label: 'Submission details', hint: SUBMISSION_META_KEY, schema: SUBMISSION_META_SCHEMA, description }
}

const TASK_FORM_TRIGGERS = new Set(['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected'])

/**
 * One uploaded file of an Attachments field (lib/forms/attachments.ts
 * AttachmentFile): what a Loop over the field gives as `{{item}}`, and what
 * Send Email attachments, HTTP multipart, document and storage steps accept.
 */
export const ATTACHMENT_FILE_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'An uploaded file',
  fields: [
    { name: 'name', type: 'string', description: 'File name', example: 'invoice.pdf' },
    { name: 'size', type: 'integer', description: 'Size in bytes', example: 48213 },
    { name: 'mime_type', type: 'string', description: 'Verified MIME type', example: 'application/pdf' },
    { name: 'url', type: 'string', description: 'Download link (signed-in people who can see the task / submission)' },
    { name: 'id', type: 'string', description: 'File id' },
    { name: 'uploaded_by', type: 'string', description: 'User id of the uploader' },
    { name: 'uploaded_at', type: 'string', description: 'ISO 8601' },
    { name: 'checksum_sha256', type: 'string', description: 'SHA-256 of the content (hex)' },
    { name: 'storage_ref', type: 'string', description: 'Storage reference the workflow reads the file with' },
  ],
}

/**
 * One file on a task's Attachments tab (lib/task-attachments.ts): the items
 * of a User Task's `attachments` output and of `{{task.attachments}}`. File
 * steps (Read File, document actions, Send Email attachments) accept it.
 */
export const TASK_ATTACHMENT_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'A task attachment',
  fields: [
    { name: 'name', type: 'string', description: 'Name given to the attachment', example: 'Signed contract' },
    { name: 'type', type: 'string', description: 'Type (Contract, Invoice, Receipt, Evidence, Image, Other or the workspace\'s own)', example: 'Contract' },
    { name: 'description', type: 'string', description: 'Description' },
    { name: 'file_name', type: 'string', description: 'Original file name', example: 'contract.pdf' },
    { name: 'mime', type: 'string', description: 'Verified MIME type', example: 'application/pdf' },
    { name: 'size', type: 'integer', description: 'Size in bytes', example: 48213 },
    { name: 'url', type: 'string', description: 'Download link (signed-in people who can see the task)' },
    { name: 'storage_ref', type: 'string', description: 'Storage reference the workflow reads the file with' },
    { name: 'id', type: 'string', description: 'Attachment id' },
    { name: 'uploaded_by', type: 'string', description: 'User id of the uploader (empty when a workflow step attached it)' },
    { name: 'created_at', type: 'string', description: 'When it was attached (ISO 8601)' },
  ],
}

/** A Signature field's value (lib/forms/media-fields.ts SignatureValue). */
const SIGNATURE_SCHEMA: SchemaNode = {
  type: 'object',
  description: 'An electronic signature (not a cryptographic digital signature)',
  fields: [
    { name: 'file', type: 'object', description: 'The signature image (PNG file object; attach it or pass it to a document step)' },
    { name: 'method', type: 'string', description: 'draw or type', example: 'draw' },
    { name: 'typed_name', type: 'string', description: 'The name typed (method type)' },
    { name: 'signed_at', type: 'string', description: 'When it was signed (ISO 8601, server time)' },
    { name: 'user_id', type: 'string', description: 'The signed-in person who signed' },
    { name: 'user_name', type: 'string', description: 'Their name', example: 'Ada Lovelace' },
    { name: 'ip', type: 'string', description: 'IP address (only when the field records audit details)' },
    { name: 'user_agent', type: 'string', description: 'Browser (only when the field records audit details)' },
  ],
}

/** One pick of a Person field with several people / teams (lib/forms/people-field.ts PersonRef). */
const PERSON_REF_SCHEMA: SchemaNode = {
  type: 'object',
  fields: [
    { name: 'kind', type: 'string', description: 'user or team', example: 'user' },
    { name: 'id', type: 'string', description: 'The user / team id (assign a task to it)' },
    { name: 'name', type: 'string', description: 'Their name (set by the server)', example: 'Ada Lovelace' },
  ],
}

const TASK_ATTACHMENTS_LIST: SchemaNode = { type: 'array', items: TASK_ATTACHMENT_SCHEMA, description: 'Files on the task\'s Attachments tab (loop over them, or pass one to a file step)' }

/** The value model of a form field (numbers, booleans, ISO date strings, multi-select arrays, file lists). */
export function fieldSchema(field: TaskFieldDef): SchemaNode {
  if (field.type === 'attachments') return { type: 'array', items: ATTACHMENT_FILE_SCHEMA, description: 'Uploaded files (loop over them, or attach them all)' }
  if (field.type === 'image') return { ...ATTACHMENT_FILE_SCHEMA, description: 'The picture (one file object; attach it or pass it to a file step)' }
  if (field.type === 'signature') return SIGNATURE_SCHEMA
  if (field.type === 'rich_text') return { type: 'string', nullable: true, description: `Formatted text (sanitised HTML); the plain text is {{form.${field.key}_text}}` }
  if (field.type === 'text_list') return { type: 'array', items: { type: 'string' }, description: 'Text items, in order (loop over them, or join them)' }
  if (isPeopleList(field)) return { type: 'array', items: PERSON_REF_SCHEMA, description: field.user_config?.allow_teams ? 'People and teams (loop over them; kind says which)' : 'People (loop over them)' }
  if (field.type === 'lookup') {
    const what = field.lookup?.source === 'reference' ? 'API reference' : 'data table'
    return field.lookup?.multiple
      ? { type: 'array', items: { type: 'string' }, description: `Selected values (from a ${what})` }
      : { type: 'string', description: `Selected value (from a ${what})` }
  }
  if (field.type === 'data_table') return dataTableValueSchema(field)
  if (field.type === 'list') return listValueSchema(field)
  if (field.type === 'repeating_section') return repeatingValueSchema(field)
  if (field.type === 'custom') {
    if (field.custom?.value_type === 'files') return { type: 'array', items: ATTACHMENT_FILE_SCHEMA, description: `Uploaded files (${field.custom.name ?? 'custom control'})` }
    const output = field.custom ? activeOutput(field.custom) : null
    if (output && field.custom?.output) {
      // The declared output (lib/forms/custom-controls/output.ts): a primitive the workflow can use directly.
      const what = output.html ? 'HTML (sanitised)' : output.type === 'date' ? 'date (YYYY-MM-DD)' : output.type === 'string' ? 'text' : output.type
      const description = field.custom.output.description ?? `${field.custom.name ?? 'Custom control'}: ${what}`
      if (output.type === 'array') return { type: 'array', items: { type: 'any' }, description }
      if (output.type === 'object') return { ...valueSchemaNode(field.custom.value_schema), description }
      return { type: output.type === 'date' ? 'string' : output.type, nullable: true, description }
    }
    const kind = customValueSchemaType(field.custom)
    const description = `${field.custom?.name ?? 'Custom control'} value${field.custom?.value_type === 'date' ? ' (YYYY-MM-DD)' : ''}`
    return kind === 'array' ? { type: 'array', items: { type: 'any' }, description } : { type: kind, description }
  }
  const type = fieldValueSchemaType(field.type)
  const description = field.type === 'date' ? 'Date (YYYY-MM-DD)' : field.type === 'datetime' ? 'Date and time (ISO 8601)' : field.type === 'user' ? 'User id' : field.type === 'currency' ? `Amount${field.currency ? ` (${field.currency})` : ''}` : undefined
  const base: SchemaNode = type === 'array' ? { type: 'array', items: { type: 'string' } } : { type }
  return description ? { ...base, description } : base
}

/** A control's value schema (the JSON Schema subset) as a picker model: objects keep their properties. */
function valueSchemaNode(schema: ControlValueSchema | undefined, depth = 0): SchemaNode {
  const type = Array.isArray(schema?.type) ? schema?.type.find((t) => t !== 'null') : schema?.type
  if (type === 'object' || (!type && schema?.properties)) {
    const fields = depth > 3 ? [] : Object.entries(schema?.properties ?? {}).map(([name, sub]) => ({ name, ...valueSchemaNode(sub, depth + 1) }))
    return fields.length ? { type: 'object', fields } : { type: 'object' }
  }
  if (type === 'array') return { type: 'array', items: depth > 3 ? { type: 'any' } : valueSchemaNode(schema?.items, depth + 1) }
  if (type === 'integer') return { type: 'integer' }
  if (type === 'number' || type === 'string' || type === 'boolean') return { type }
  return { type: 'any' }
}

/** Path of a dot path inside a value schema (an extra's model). */
function valueSchemaAt(schema: ControlValueSchema | undefined, path: string): SchemaNode {
  let cursor = schema
  for (const part of path.split('.').filter(Boolean)) {
    if (/^\d+$/.test(part)) cursor = cursor?.items
    else cursor = cursor?.properties?.[part]
  }
  return valueSchemaNode(cursor)
}

function listColumnSchema(column: ListColumn): SchemaNode & { name: string } {
  // A nested List: its rows (a Loop over {{item.<column>}} inside a Loop over the List gives their columns).
  if (column.type === 'list') return { name: column.key, ...listRowsSchema(column.list), description: `${column.label} (nested list — loop over it inside the outer loop)` }
  // A signature per row: the Signature field's value ({{item.<column>.user_name}}, .signed_at, .file).
  if (column.type === 'signature') return { name: column.key, ...SIGNATURE_SCHEMA, nullable: true, description: `${column.label} (electronic signature of the row: file, signed_at, user_name…)` }
  const type: SchemaNode['type'] = isNumericColumn(column) ? 'number' : column.type === 'boolean' ? 'boolean' : 'string'
  const what = column.type === 'date' ? ' (YYYY-MM-DD)' : column.type === 'currency' ? ` (${column.currency ?? 'USD'})` : column.type === 'calculated' && column.formula ? ` (= ${column.formula})` : column.type === 'choice' && column.options?.length ? ` (${column.options.slice(0, 6).join(', ')})` : ''
  return { name: column.key, type, ...(column.type === 'boolean' ? {} : { nullable: true }), description: `${column.label}${what}` }
}

/**
 * A repeating section's value (lib/forms/repeating-section.ts): the items, an
 * array of objects keyed by the inner fields (each typed like the field on
 * a form; a rich text's `_text`, a lookup's `_label`, a nested section's /
 * List's count and totals beside it) — a Loop gives `{{item.<field>}}`; a
 * nested section is looped inside (`{{parent_item.*}}` = the outer item).
 */
export function repeatingValueSchema(field: TaskFieldDef): SchemaNode {
  return { type: 'array', items: { type: 'object', fields: repeatingItemFields(field) }, description: 'The items added on the form (loop over them: {{item.<field>}})' }
}

function repeatingItemFields(field: TaskFieldDef): Array<SchemaNode & { name: string }> {
  const out: Array<SchemaNode & { name: string }> = []
  for (const inner of valueFields(field.repeating_section?.fields ?? [])) {
    const schema = fieldSchema(inner)
    const nested = inner.type === 'repeating_section' || inner.type === 'list'
    out.push({ name: inner.key, ...schema, description: `${inner.label}${nested ? ' (loop over it inside the outer loop)' : schema.description ? ` — ${schema.description}` : ''}` })
    if (inner.type === 'rich_text') out.push({ name: richTextTextKey(inner.key), type: 'string', nullable: true, description: `${inner.label} (plain text)` })
    if (inner.type === 'lookup') out.push({ name: lookupLabelKey(inner.key), type: 'string', nullable: true, description: `${inner.label} (display label)` })
    if (inner.type === 'repeating_section' || inner.type === 'list') out.push({ name: listCountKey(inner.key), type: 'integer', description: `${inner.label}: items in this item` })
    for (const total of inner.repeating_section?.totals ?? []) out.push({ name: repeatingTotalKey(inner.key, total), type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: `${inner.label}: ${total.fn === 'sum' ? 'total' : total.fn === 'avg' ? 'average' : 'count'} of ${total.field}` })
    for (const total of inner.list?.totals ?? []) out.push({ name: listTotalKey(inner.key, total), type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: `${inner.label}: ${listTotalLabel(inner.list!, total).toLowerCase()}` })
  }
  return out
}

/**
 * A List field's value (lib/forms/list-field.ts): the rows people added, an
 * array of row objects typed by the columns — a Loop over it gives
 * `{{item.<column>}}` per row.
 */
export function listValueSchema(field: TaskFieldDef): SchemaNode {
  return { ...listRowsSchema(field.list), description: 'The rows added on the form (loop over them: {{item.<column>}})' }
}

/** A List level's rows: its columns, lookups' labels, and per nested List its count / totals in each row. */
function listRowsSchema(config: ListFieldConfig | undefined): SchemaNode {
  const columns = config?.columns ?? []
  // A lookup column's display label travels beside its value (`product` → `product_label`).
  const fields = columns.flatMap((c) => (c.type === 'lookup' ? [listColumnSchema(c), { name: `${c.key}_label`, type: 'string' as const, nullable: true, description: `${c.label} (display label)` }] : [listColumnSchema(c)]))
  for (const c of columns) {
    if (c.type !== 'list' || !c.list) continue
    fields.push({ name: listCountKey(c.key), type: 'integer', description: `${c.label}: rows in this row` } as SchemaNode & { name: string })
    for (const total of c.list.totals ?? []) fields.push({ name: listTotalKey(c.key, total), type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: `${c.label}: ${listTotalLabel(c.list, total).toLowerCase()} in this row` } as SchemaNode & { name: string })
  }
  return { type: 'array', items: { type: 'object', fields } }
}

const DT_TYPE: Record<string, SchemaNode['type']> = { text: 'string', number: 'number', date: 'string', datetime: 'string', choice: 'string', boolean: 'boolean' }

/**
 * A Data table field's value (lib/forms/data-table.ts): select mode → the
 * selected rows; edit mode → the change set { added, updated, deleted };
 * read-only tables hold nothing.
 */
export function dataTableValueSchema(field: TaskFieldDef): SchemaNode {
  const config = field.data_table
  const row: SchemaNode = {
    type: 'object',
    fields: (config ? projectedKeys(config) : []).map((key) => {
      const col = config?.columns.find((c) => c.key === key)
      return { name: key, type: col ? DT_TYPE[col.type] ?? 'any' : 'string', ...(col?.label && col.label !== key ? { description: col.label } : {}) }
    }),
  }
  if (config?.mode === 'select') return { type: 'array', items: row, description: config.multiple ? 'The selected rows' : 'The selected row (a list of one)' }
  if (config?.mode === 'edit') {
    return {
      type: 'object',
      description: 'The changes made in the table',
      fields: [
        { name: 'added', type: 'array', items: row, description: 'New rows' },
        {
          name: 'updated', type: 'array', description: 'Changed rows',
          items: { type: 'object', fields: [
            { name: 'key', type: 'string', description: 'The row key' },
            { name: 'before', ...row, description: 'The row before (re-read on the server)' },
            { name: 'after', ...row, description: 'The changed cells' },
            { name: 'changed_fields', type: 'array', items: { type: 'string' } },
          ] },
        },
        { name: 'deleted', type: 'array', description: 'Deleted rows', items: { type: 'object', fields: [{ name: 'key', type: 'string' }, { name: 'before', ...row }] } },
      ],
    }
  }
  return { type: 'any', nullable: true, description: 'A read-only table holds no value' }
}

/** The model of a lookup's `<key>_item`: the selected item's display / value / fill fields (an array when multiple). */
export function lookupItemSchema(field: TaskFieldDef): SchemaNode | null {
  if (field.type !== 'lookup' || !field.lookup) return null
  const root: SchemaNode = { type: 'object', fields: [] }
  for (const path of lookupItemFields(field.lookup)) {
    let cursor = root
    const parts = path.split('.')
    parts.forEach((part, i) => {
      cursor.fields ??= []
      let next = cursor.fields.find((f) => f.name === part)
      if (!next) {
        next = i === parts.length - 1 ? { name: part, type: 'any' } : { name: part, type: 'object', fields: [] }
        cursor.fields.push(next)
      }
      cursor = next
    })
  }
  return field.lookup.multiple
    ? { type: 'array', items: root, description: 'The selected items (configured fields only)' }
    : { ...root, nullable: true, description: 'The selected item (configured fields only)' }
}

interface FormFieldEntry { key: string; label: string; schema: SchemaNode; typeLabel: string; example?: string }

/** Data picker fields of a form: each value field, plus `<key>_item` and `<key>_label` for lookups. */
function formFieldEntries(fields: TaskFieldDef[]): FormFieldEntry[] {
  const out: FormFieldEntry[] = []
  for (const field of valueFields(fields)) {
    out.push({ key: field.key, label: field.label || field.key, schema: fieldSchema(field), typeLabel: TASK_FIELD_TYPE_LABELS[field.type], ...(field.default !== undefined ? { example: field.default } : {}) })
    const item = lookupItemSchema(field)
    if (item) out.push({ key: lookupItemKey(field.key), label: `${field.label || field.key} (selected item)`, schema: item, typeLabel: 'Lookup item' })
    if (item) {
      out.push({
        key: lookupLabelKey(field.key), label: `${field.label || field.key} (display label)`, typeLabel: 'Lookup label',
        schema: field.lookup?.multiple
          ? { type: 'array', items: { type: 'string' }, description: 'What the person saw for each selected value' }
          : { type: 'string', nullable: true, description: 'What the person saw for the selected value (the field itself is the stored value)' },
      })
    }
    if (field.type === 'rich_text') out.push({ key: richTextTextKey(field.key), label: `${field.label || field.key} (plain text)`, schema: { type: 'string', nullable: true, description: 'The formatted text without markup' }, typeLabel: 'Text' })
    if (field.type === 'attachments') out.push({ key: attachmentsCountKey(field.key), label: `${field.label || field.key} (number of files)`, schema: { type: 'integer', description: 'Number of files' }, typeLabel: 'Number' })
    if (field.type === 'list') {
      // The row count and the configured totals (lib/forms/list-field.ts listDerivedValues).
      out.push({ key: listCountKey(field.key), label: `${field.label || field.key} (number of rows)`, schema: { type: 'integer', description: 'Number of rows' }, typeLabel: 'Number' })
      // Nested Lists: their rows over every parent (count, totals) and the count per row.
      for (const path of childListPaths(field.list)) {
        const at = childListAt(field.list, path)!
        const name = `${field.label || field.key} › ${at.columns.map((c) => c.label).join(' › ')}`
        const p = `${field.key}_${path.join('_')}`
        out.push({ key: listCountKey(p), label: `${name} (rows in all)`, schema: { type: 'integer', description: 'Rows under every parent row' }, typeLabel: 'Number' })
        out.push({ key: `${p}_counts`, label: `${name} (rows per ${field.label || 'row'})`, schema: { type: 'array', items: { type: 'integer' }, description: 'Rows under each top-level row, in order' }, typeLabel: 'List' })
        for (const total of at.config.totals ?? []) out.push({ key: listTotalKey(field.key, { ...total, column: `${path.join('_')}_${total.column}` }), label: `${name} (${listTotalLabel(at.config, total).toLowerCase()}, all rows)`, schema: { type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: `${listTotalLabel(at.config, total)} over every parent row` }, typeLabel: 'Number' })
      }
      for (const total of field.list?.totals ?? []) {
        out.push({ key: listTotalKey(field.key, total), label: `${field.label || field.key} (${listTotalLabel(field.list!, total).toLowerCase()})`, schema: { type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: listTotalLabel(field.list!, total) }, typeLabel: 'Number' })
      }
    }
    if (field.type === 'repeating_section') {
      // The item count and the configured totals (lib/forms/repeating-section.ts repeatingDerivedValues).
      out.push({ key: repeatingCountKey(field.key), label: `${field.label || field.key} (number of items)`, schema: { type: 'integer', description: 'Number of items' }, typeLabel: 'Number' })
      for (const total of field.repeating_section?.totals ?? []) {
        const what = total.label ?? `${total.fn === 'sum' ? 'Total' : total.fn === 'avg' ? 'Average' : 'Count'} of ${field.repeating_section?.fields.find((f) => f.key === total.field)?.label ?? total.field}`
        out.push({ key: repeatingTotalKey(field.key, total), label: `${field.label || field.key} (${what.toLowerCase()})`, schema: { type: total.fn === 'count' ? 'integer' : 'number', nullable: total.fn === 'avg', description: what }, typeLabel: 'Number' })
      }
    }
    if (field.type === 'custom' && field.custom?.output) {
      // A control's other outputs: the whole value (`<key>_raw`) and its extras (`<key>_<suffix>`).
      for (const { suffix, path } of outputExtraKeys(field.custom)) {
        out.push({ key: `${field.key}_${suffix}`, label: `${field.label || field.key} (${suffix.replace(/_/g, ' ')})`, typeLabel: 'Control output', schema: { ...valueSchemaAt(field.custom.value_schema, path), nullable: true } })
      }
      if (keepsRaw(field.custom)) {
        out.push({ key: `${field.key}_raw`, label: `${field.label || field.key} (full value)`, typeLabel: 'Control value', schema: { ...valueSchemaNode(field.custom.value_schema), nullable: true, description: 'Everything the control stores (the shape before outputs: e.g. .html, .text)' } })
      }
    }
  }
  return out
}

/**
 * Parameters / variables marked "Include in submission" (lib/forms/form-params.ts)
 * travel beside the fields under their own names: typed picker entries.
 */
function withContextEntries(entries: FormFieldEntry[], node: PickerNodeLike, linkedForms?: Record<string, LinkedFormLike> | null): FormFieldEntry[] {
  const formId = typeof node.config?.form_id === 'string' ? node.config.form_id : ''
  const layout = (formId ? linkedForms?.[formId]?.layout : undefined) ?? node.config?.form_layout
  const extra = includedContextSchema(layout, entries.map((e) => e.key))
  return [...entries, ...extra.map((c) => ({
    key: c.key, label: `${c.label} (${c.kind === 'param' ? 'form parameter' : 'form variable'})`, typeLabel: c.kind === 'param' ? 'Parameter' : 'Variable',
    schema: c.type === 'array' ? { type: 'array' as const, items: { type: 'string' as const } } : { type: c.type, nullable: true },
  }))]
}

function columnsSchema(columns: { key: string; label?: string; type?: string }[], shape: 'rows' | 'row'): SchemaNode {
  return schemaFromColumns(columns.map((col) => ({ name: col.key, type: col.type, description: col.label && col.label !== col.key ? col.label : undefined })), shape)
}

/** The model a call_reference / http_request node snapshots (`_ref_response_schema` / `_response_schema`). */
function nodeResponseModel(node: PickerNodeLike): SchemaNode | null {
  const raw = node.type === 'call_reference' || node.type === 'live_reference' ? node.config?._ref_response_schema : node.config?._response_schema
  const stored = normalizeResponseSchema(raw)
  if (stored) return stored.root
  if (node.type === 'call_reference' || node.type === 'live_reference') return schemaFromOutputs(node.config?._ref_outputs)
  return null
}

function typeFromDeclared(type: string | undefined): SchemaNode['type'] {
  switch (String(type ?? '').toLowerCase()) {
    case 'number': case 'integer': return 'number'
    case 'boolean': return 'boolean'
    case 'array': case 'list': return 'array'
    case 'object': case 'json': return 'object'
    case 'string': case 'text': case 'date': return 'string'
    default: return 'any'
  }
}

/** What a Set Variable expression evaluates to, when we can tell. */
export function schemaForExpression(expression: unknown, roots: DataRoot[]): SchemaNode | null {
  const text = String(expression ?? '').trim()
  if (!text) return null
  const whole = text.match(/^\{\{\s*([\w.\-[\]]+)\s*\}\}$/)
  if (whole) return schemaForPath(whole[1], roots)
  const fn = text.match(/^\{\{\s*=\s*([A-Z_]+)\s*\(([\s\S]*)\)\s*\}\}$/)
  if (fn) {
    const name = fn[1]
    const firstArg = fn[2].split(',')[0]?.trim().replace(/^\{\{\s*|\s*\}\}$/g, '') ?? ''
    const quoted = (index: number) => (fn[2].split(',')[index] ?? '').trim().replace(/^["']|["']$/g, '')
    const listSchema = /^[A-Za-z_][\w.[\]-]*$/.test(firstArg) ? schemaForPath(firstArg, roots) : null
    switch (name) {
      case 'SPLIT': return { type: 'array', items: { type: 'string' } }
      case 'COUNT': case 'LENGTH': case 'SUM': case 'AVG': case 'MIN': case 'MAX': return { type: 'number' }
      case 'FILTER_WHERE': case 'UNIQUE': case 'REVERSE': return listSchema?.type === 'array' ? listSchema : { type: 'array' }
      case 'FLATTEN': return { type: 'array' }
      case 'PLUCK': {
        const field = listSchema?.type === 'array' ? schemaAtPath(listSchema.items ?? null, quoted(1)) : null
        return { type: 'array', items: field ?? { type: 'any' } }
      }
      case 'FIRST': case 'LAST': case 'INDEX': return listSchema?.type === 'array' ? (listSchema.items ?? null) : null
      case 'FIND_WHERE': {
        const item = listSchema?.type === 'array' ? (listSchema.items ?? null) : null
        const returnField = quoted(3)
        return returnField ? schemaAtPath(item, returnField) : item
      }
      case 'FROM_JSON': return { type: 'any' }
      default: return null
    }
  }
  if (/^[[{]/.test(text)) {
    try { return inferSchema(JSON.parse(text)) } catch { /* not JSON */ }
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) return { type: 'number' }
  if (text === 'true' || text === 'false') return { type: 'boolean' }
  return { type: 'string' }
}

/** Model at a full variable path (`get_customers_response.data.0.email`), resolved against known roots. */
export function schemaForPath(path: string, roots: DataRoot[]): SchemaNode | null {
  const segments = splitPath(path)
  let best: { root: DataRoot; length: number } | null = null
  for (const root of roots) {
    const rootSegments = splitPath(root.path)
    if (rootSegments.length > segments.length) continue
    if (rootSegments.every((segment, index) => segment === segments[index]) && (!best || rootSegments.length > best.length)) {
      best = { root, length: rootSegments.length }
    }
  }
  if (!best) return null
  const rest = segments.slice(best.length).join('.')
  return rest ? schemaAtPath(best.root.schema, rest) : best.root.schema
}

function workflowVariableSchema(variable: PickerWorkflowVariable): SchemaNode {
  const declared = typeFromDeclared(variable.type)
  const raw = String(variable.defaultValue ?? '').trim()
  if (/^[[{]/.test(raw)) {
    try { return { ...inferSchema(JSON.parse(raw)), ...(variable.description ? { description: variable.description } : {}) } } catch { /* plain text */ }
  }
  return str(declared === 'any' ? 'string' : declared, variable.description || undefined)
}

/**
 * The roots one step contributes (what the engine sets after it runs).
 * `known` are roots of steps before it, used to type Set Variable expressions.
 */
export function rootsForNode(node: PickerNodeLike, known: DataRoot[] = [], linkedForms?: Record<string, LinkedFormLike> | null): DataRoot[] {
  const c = node.config ?? {}
  const prefix = nodeOutputPrefix(node)
  switch (node.type) {
    case 'call_reference': {
      const response = nodeResponseModel(node)
      const roots: DataRoot[] = [
        { path: `${prefix}_response`, label: 'response', schema: response ?? { type: 'any' }, description: 'Full response' },
        { path: `${prefix}_status`, label: 'status', schema: { type: 'integer' }, description: 'HTTP status code' },
      ]
      const refOutputs = (c._ref_outputs ?? []) as { name: string; path?: string; type?: string }[]
      for (const [name, mapping] of Object.entries((c.output_mappings ?? {}) as Record<string, any>)) {
        if (!mapping?.enabled || !mapping.variableName) continue
        const declared = refOutputs.find((out) => out.name === name)
        if (declared?.path?.startsWith('[].')) continue
        const fromModel = response && declared?.path ? schemaAtPath(response, declared.path) : response && declared && !declared.path ? response : null
        roots.push({ path: mapping.variableName, label: mapping.variableName, schema: fromModel ?? str(typeFromDeclared(declared?.type)), description: `Output "${name}"` })
      }
      for (const out of (Array.isArray(c.custom_outputs) ? c.custom_outputs : []) as { name?: string; path?: string }[]) {
        const name = String(out?.name ?? '').trim()
        if (!name) continue
        roots.push({ path: name, label: name, schema: (response && out.path ? schemaAtPath(response, out.path) : response) ?? { type: 'any' }, description: out.path ? `response.${out.path}` : 'Full response' })
      }
      return roots
    }
    case 'http_request': {
      const response = nodeResponseModel(node) ?? { type: 'any' }
      const roots: DataRoot[] = [
        { path: `${prefix}_response`, label: 'response', schema: response, description: 'Response data' },
        { path: `${prefix}_status`, label: 'status', schema: { type: 'integer' }, description: 'HTTP status code' },
      ]
      if (c.output_var) roots.push({ path: c.output_var, label: c.output_var, schema: response, description: 'Response data (output variable)' })
      return roots
    }
    case 'live_reference': {
      const binding = c.binding_name || prefix
      const response = nodeResponseModel(node) ?? { type: 'any' }
      return [{ path: `live.${binding}`, label: `live.${binding}`, schema: response, description: 'Live response (re-fetched on access)' }]
    }
    case 'update_data_table': {
      const op = c.operation ?? 'insert'
      const cols = (c._table_columns ?? []) as { key: string; label?: string; type?: string }[]
      // The engine reads `output_var` as the row id variable when output_row_id_var is unset.
      const rowIdVar = c.output_row_id_var || c.output_var || 'row_id'
      if (op === 'list') {
        return [
          { path: c.output_rows_var || 'rows', label: c.output_rows_var || 'rows', schema: columnsSchema(cols, 'rows'), description: 'Rows returned by the query' },
          { path: c.output_count_var || 'row_count', label: c.output_count_var || 'row_count', schema: { type: 'integer' }, description: 'Number of rows returned' },
        ]
      }
      if (op === 'get') {
        return [
          { path: c.output_row_var || 'row', label: c.output_row_var || 'row', schema: columnsSchema(cols, 'row'), description: 'The row' },
          { path: rowIdVar, label: rowIdVar, schema: { type: 'string' }, description: 'Row ID' },
        ]
      }
      return [{ path: rowIdVar, label: rowIdVar, schema: { type: 'string' }, description: `Row ID from ${op}` }]
    }
    case 'set_variable': {
      // Every assignment, in order; a later one is typed against the earlier ones.
      const roots: DataRoot[] = []
      for (const a of setVariableAssignments(c)) {
        if (!a.name) continue
        const root: DataRoot = { path: a.name, label: a.name, schema: schemaForExpression(a.expression, [...roots, ...known]) ?? { type: 'any' }, description: 'Set Variable' }
        const existing = roots.findIndex((r) => r.path === a.name)
        if (existing >= 0) roots[existing] = root
        else roots.push(root)
      }
      return roots
    }
    case 'run_agent': {
      const outVar = c.output_variable || 'agent_response'
      // Prefixed outputs use the agent's name (as the engine does), not the node label.
      const agentPrefix = runAgentOutputPrefix(c)
      const roots: DataRoot[] = [
        { path: outVar, label: outVar, schema: { type: 'string' }, description: 'Agent response text' },
        { path: `${outVar}_status`, label: `${outVar}_status`, schema: { type: 'string' }, description: 'Execution status' },
        { path: `${outVar}_outputs`, label: `${outVar}_outputs`, schema: { type: 'object' }, description: 'All declared outputs' },
        { path: `${outVar}_usage`, label: `${outVar}_usage`, schema: { type: 'object' }, description: 'Token usage' },
        { path: `${outVar}_iterations`, label: `${outVar}_iterations`, schema: { type: 'number' }, description: 'Model calls' },
        { path: `${outVar}_tool_calls`, label: `${outVar}_tool_calls`, schema: { type: 'number' }, description: 'Tool calls made' },
        { path: `${outVar}_duration_ms`, label: `${outVar}_duration_ms`, schema: { type: 'number' }, description: 'Run duration' },
        { path: `${outVar}_files`, label: `${outVar}_files`, schema: { type: 'array' }, description: 'Files produced by tools' },
      ]
      for (const output of (Array.isArray(c._agent_outputs) ? c._agent_outputs : []) as { name?: string; type?: string; description?: string }[]) {
        const key = String(output?.name ?? '').trim()
        if (!key) continue
        roots.push({ path: `${agentPrefix}_${key}`, label: key, schema: str(typeFromDeclared(output.type), output.description), description: output.description || 'Agent output' })
        roots.push({ path: key, label: key, schema: str(typeFromDeclared(output.type), output.description), description: `${output.description || 'Agent output'} (also {{${agentPrefix}_${key}}})` })
      }
      return roots
    }
    case 'custom_activity': {
      // Typed outputs of the chosen function (snapshot kept fresh by the panel); legacy steps: manifest.outputs.
      return customActionRoots(c)
    }
    case 'read_csv': case 'read_excel': {
      if (c.mode === 'write') return []
      const ov = c.output_var || (node.type === 'read_csv' ? 'csv_data' : 'excel_data')
      return [
        { path: ov, label: ov, schema: { type: 'array', items: { type: 'object', fields: [] } }, description: 'Parsed rows' },
        { path: `${ov}_count`, label: `${ov}_count`, schema: { type: 'integer' }, description: 'Row count' },
      ]
    }
    case 'collection_filter': case 'collection_sort': case 'collection_unique': {
      const ov = c.output_var || ({ collection_filter: 'filtered', collection_sort: 'sorted', collection_unique: 'unique' } as Record<string, string>)[node.type]
      const source = schemaForExpression(c.collection ?? c.items ?? c.source, known)
      return [{ path: ov, label: ov, schema: source?.type === 'array' ? source : { type: 'array' }, description: 'List' }]
    }
    case 'json_build_array': {
      const ov = c.output_var || 'json_array'
      return [{ path: ov, label: ov, schema: { type: 'array' }, description: 'Built array' }]
    }
    case 'json_add_to_array': {
      const av = c.array_var || 'json_array'
      return [{ path: av, label: av, schema: { type: 'array' }, description: 'Array being built' }]
    }
    case 'collection_count': return [{ path: c.output_var || 'count', label: c.output_var || 'count', schema: { type: 'integer' } }]
    case 'collection_get': return [{ path: c.output_var || 'item', label: c.output_var || 'item', schema: { type: 'any' } }]
    case 'collection_join': return [{ path: c.output_var || 'joined', label: c.output_var || 'joined', schema: { type: 'string' } }]
    case 'math': return [{ path: c.output_var || 'result', label: c.output_var || 'result', schema: { type: 'number' } }]
    case 'modify_string': case 'text_template': case 'format_date': case 'date_math': case 'regex': {
      const defaults: Record<string, string> = { modify_string: 'modified_string', text_template: 'text', format_date: 'formatted_date', date_math: 'new_date', regex: 'regex_result' }
      const ov = c.output_var || defaults[node.type]
      return [{ path: ov, label: ov, schema: { type: 'string' } }]
    }
    case 'user_task': {
      const taskEntries = withContextEntries(formFieldEntries(nodeFormFields(node, linkedForms)), node, linkedForms)
      const taskDataSchema: SchemaNode | null = taskEntries.length
        ? { type: 'object', fields: taskEntries.map((entry) => ({ ...entry.schema, name: entry.key, description: `${entry.label} (${entry.typeLabel})` })) }
        : null
      return [
        { path: `${prefix}_task_id`, label: 'task_id', schema: { type: 'string' }, description: 'Created task ID' },
        { path: 'outcome', label: 'outcome', schema: { type: 'string' }, description: 'Outcome chosen on completion (the latest User Task\'s)' },
        { path: `${prefix}_outcome`, label: `${prefix}_outcome`, schema: { type: 'string' }, description: 'Outcome of this task (kept after later User Tasks)' },
        { path: 'outcome_notes', label: 'outcome_notes', schema: { type: 'string' }, description: 'Comment entered with the outcome' },
        { path: `${prefix}_outcome_notes`, label: `${prefix}_outcome_notes`, schema: { type: 'string' }, description: 'Comment entered with this task\'s outcome' },
        ...(taskDataSchema ? [{ path: `${prefix}_task_data`, label: `${prefix}_task_data`, schema: taskDataSchema, description: 'This task\'s form values (kept after later User Tasks)' }] : []),
        { path: 'user_task_id', label: 'user_task_id', schema: { type: 'string' }, description: 'Created task ID (the latest User Task\'s)' },
        { path: 'completed_by_name', label: 'completed_by_name', schema: { type: 'string' }, description: 'Who completed the task (name)' },
        { path: 'completed_by_email', label: 'completed_by_email', schema: { type: 'string' }, description: 'Who completed the task (email)' },
        { path: 'completed_by', label: 'completed_by', schema: { type: 'string' }, description: 'Who completed the task (user id)' },
        { path: 'completed_at', label: 'completed_at', schema: { type: 'string' }, description: 'When the task was completed (ISO 8601)' },
        { path: 'attachments', label: 'attachments', schema: TASK_ATTACHMENTS_LIST, description: 'Files attached on the task before it completed' },
      ]
    }
    case 'add_task_attachment':
      return [{ path: `${prefix}_attachment`, label: 'attachment', schema: TASK_ATTACHMENT_SCHEMA, description: 'The attachment the step added' }]
    case 'decision_table': {
      const roots: DataRoot[] = [
        { path: `${prefix}_matched`, label: 'matched', schema: { type: 'boolean' } },
        { path: `${prefix}_outputs`, label: 'outputs', schema: { type: 'object', fields: ((c._decision_outputs ?? []) as { key?: string }[]).filter((o) => o?.key).map((o) => ({ name: String(o.key), type: 'any' as const })) } },
      ]
      return roots
    }
    case 'call_sub_workflow':
      return [
        { path: `${prefix}_status`, label: 'status', schema: { type: 'string' } },
        { path: `${prefix}_results`, label: 'results', schema: { type: 'object' } },
      ]
    case 'doc_read': case 'doc_compare': case 'doc_convert': case 'doc_pdf': case 'doc_extract': case 'doc_redact': case 'doc_inspect':
      return documentNodeRoots(node.type, c)
    case 'esign_send': case 'esign_envelope': case 'esign_wait':
      return esignNodeRoots(node.type, c)
    case 'media_transcribe': case 'media_analyze_image': case 'media_analyze_video': case 'media_redact_image': case 'media_redact_video': case 'media_generate_image': case 'media_tts': case 'media_tools':
      return mediaNodeRoots(node.type, c)
    default: {
      // Extension nodes: typed outputs like a custom action; extension triggers: their declared run variables.
      const ext = extensionCatalogEntry(node.type)
      if (ext?.category === 'trigger') {
        return ext.outputs.map((f) => ({ path: f.name, label: f.label ?? f.name, schema: actionFieldSchema(f), description: f.description || `${ext.label} variable` }))
      }
      if (ext) return customActionRoots({ ...c, _action_outputs: Array.isArray(c._action_outputs) ? c._action_outputs : ext.outputs })
      return []
    }
  }
}

/** Typed outputs of a custom action or extension step (`_action_outputs`, legacy `manifest.outputs`). */
function customActionRoots(c: Record<string, any>): DataRoot[] {
  const outputs = Array.isArray(c._action_outputs) ? c._action_outputs : Array.isArray(c.manifest?.outputs) ? c.manifest.outputs : []
  const explicit = String(c._output_prefix ?? '').trim()
  return outputs.flatMap((output: any) => {
    const key = String(output?.name ?? output?.key ?? '').trim()
    if (!key) return []
    const declared = output?.schema && typeof output.schema === 'object' ? normalizeResponseSchema(isResponseSchema(output.schema) ? output.schema : { root: output.schema })?.root : null
    const typed = (ACTION_FIELD_TYPES as readonly string[]).includes(String(output?.type)) ? actionFieldSchema(output as ActionField) : null
    const schema = declared ?? typed ?? str(typeFromDeclared(output?.type))
    const label = output?.label ?? key
    const description = output?.description || 'Custom action output'
    return explicit
      ? [{ path: `${explicit}_${key}`, label, schema, description, hint: `${explicit}_${key}` }]
      : [{ path: key, label, schema, description }]
  })
}

const TRIGGER_TYPES = new Set([
  'task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected',
  'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted',
  'middleware_received', 'schedule', 'webhook_received', 'esign_event',
])

/** Topological-ish order: by graph distance from triggers, then canvas position. */
function orderNodes(nodes: PickerNodeLike[], edges: PickerEdgeLike[]): PickerNodeLike[] {
  const depth = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? []
    list.push(edge.target)
    outgoing.set(edge.source, list)
  }
  const queue = nodes.filter((node) => TRIGGER_TYPES.has(node.type) || !edges.some((edge) => edge.target === node.id)).map((node) => node.id)
  for (const id of queue) depth.set(id, 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const next of outgoing.get(id) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, (depth.get(id) ?? 0) + 1)
        queue.push(next)
      }
    }
  }
  return [...nodes].sort((a, b) => (depth.get(a.id) ?? 999) - (depth.get(b.id) ?? 999) || ((a as any).position?.y ?? 0) - ((b as any).position?.y ?? 0))
}

/**
 * Everything pickable at `currentNodeId`: loop item scopes (innermost first),
 * then each upstream step's outputs, workflow variables and trigger data.
 */
export function buildDataTree(input: BuildDataTreeInput): DataGroup[] {
  const { nodes, edges, currentNodeId, workflowVariables, linkedForms } = input
  const scoped = currentNodeId ? upstreamNodeIds(currentNodeId, edges) : null
  const ordered = orderNodes(nodes, edges)
  const known: DataRoot[] = []
  const stepGroups: DataGroup[] = []
  const triggerGroups: DataGroup[] = []
  // Form fields come first: the trigger's form, the start form, then each
  // upstream User Task's form — what designers look for most.
  const triggerFormGroups: DataGroup[] = []
  const taskFormGroups: DataGroup[] = []

  const workflowRoots: DataRoot[] = (workflowVariables ?? [])
    .filter((variable) => String(variable?.name ?? '').trim())
    .map((variable) => {
      const label = typeof variable.label === 'string' && variable.label.trim() ? variable.label.trim() : humanizeName(variable.name)
      return { path: variable.name, label, hint: variable.name, schema: workflowVariableSchema(variable), description: variable.description || 'Workflow input' }
    })
  // A designed start form's runs carry {{submission.*}} too (no stored row: id / reference empty).
  const startForm = nodes.some((n) => n.config?.start_form && typeof n.config.start_form === 'object') && !nodes.some((n) => n.type === 'form_submitted')
  const startRoots = startForm ? [...workflowRoots, submissionRoot('Who started the run from the start form and when (submitted_by, submitted_at, form, source)')] : workflowRoots
  known.push(...startRoots)

  for (const node of ordered) {
    if (node.id === currentNodeId) continue
    if (scoped && !scoped.has(node.id)) continue
    if (node.type === 'data_table_event') {
      const cols = (node.config?._table_columns ?? []) as { key: string; label?: string; type?: string }[]
      if (cols.length) {
        const roots = [{ path: 'row', label: 'row', schema: columnsSchema(cols, 'row'), description: 'The row that triggered the run' }]
        known.push(...roots)
        triggerGroups.push({ id: `trigger:${node.id}`, label: `Trigger row (${node.label})`, kind: 'trigger', nodeId: node.id, nodeType: node.type, roots })
      }
      continue
    }
    if (node.type === 'loop') continue // its item only exists inside its body (added below)
    if (node.type === 'form_submitted') {
      // The submitted form's fields (cached on the trigger), typed: {{form.<key>}}.
      const entries = withContextEntries(formFieldEntries(nodeFormFields(node, linkedForms)), node, linkedForms)
      const formName = String(node.config?.form_name ?? 'form')
      const roots: DataRoot[] = [
        ...entries.map((entry) => fieldRoot('form', entry)),
        submissionRoot('Submission id and reference, submitted at / by (id, name, email), form (id, name, version), source, URL parameters'),
        { path: 'submitted_by_name', label: 'Submitted by (name)', hint: 'submitted_by_name', schema: str('string', 'Submitter name') },
        { path: 'submitted_by_email', label: 'Submitted by (email)', hint: 'submitted_by_email', schema: str('string', 'Submitter email') },
        { path: 'submitted_by', label: 'Submitted by (user id)', hint: 'submitted_by', schema: str('string', 'User id of the submitter') },
        { path: 'submitted_by_manager_id', label: "Submitter's manager (user id)", hint: 'submitted_by_manager_id', schema: str('string', "User id of the submitter's manager (reporting lines); empty without one") },
        { path: 'submitted_at', label: 'Submitted at', hint: 'submitted_at', schema: str('string', 'ISO 8601') },
        { path: 'form_button', label: 'Button pressed', hint: 'form_button', schema: str('string', 'Button pressed (id)') },
        { path: 'form_outcome', label: 'Outcome', hint: 'form_outcome', schema: str('string', 'Outcome of an outcome button / task') },
        { path: 'form_submission_id', label: 'Submission id', hint: 'form_submission_id', schema: str('string', 'Submission id') },
        { path: 'form_source', label: 'Source (stored)', hint: 'form_source', schema: str('string', 'standalone, api or task (submission.source tells the page from the Run dialog)') },
        { path: 'form_id', label: 'Form id', hint: 'form_id', schema: str('string') },
        { path: 'form_name', label: 'Form name', hint: 'form_name', schema: str('string') },
        { path: 'form_version', label: 'Form version', hint: 'form_version', schema: str('number') },
        {
          path: 'form',
          label: 'All values (object)',
          hint: 'form',
          schema: { type: 'object', fields: entries.map((entry) => ({ ...entry.schema, name: entry.key, description: `${entry.label} (${entry.typeLabel})` })) },
          description: `The values submitted on "${formName}"`,
        },
      ]
      known.push(...roots)
      triggerFormGroups.push({ id: `trigger:${node.id}`, label: `Form submitted › ${formName}`, kind: 'form', nodeId: node.id, nodeType: node.type, roots })
      continue
    }
    if (TASK_FORM_TRIGGERS.has(node.type)) {
      // A task trigger's form declares the fields the triggering task
      // carries: {{task.data.<key>}}.
      const entries = formFieldEntries(nodeFormFields(node, linkedForms))
      const attachmentsRoot: DataRoot = { path: 'task.attachments', label: 'Attachments', hint: 'task.attachments', schema: TASK_ATTACHMENTS_LIST, description: 'Files on the triggering task\'s Attachments tab' }
      const roots: DataRoot[] = entries.length ? [
        ...entries.map((entry) => fieldRoot('task.data', entry)),
        {
          path: 'task.data',
          label: 'All values (object)',
          hint: 'task.data',
          schema: { type: 'object', fields: entries.map((entry) => ({ ...entry.schema, name: entry.key, description: `${entry.label} (${entry.typeLabel})` })) },
          description: 'Form fields of the task that started the run',
        },
        attachmentsRoot,
      ] : [attachmentsRoot]
      known.push(...roots)
      triggerFormGroups.push({ id: `trigger:${node.id}`, label: `${node.label || 'Task trigger'} › ${entries.length ? 'Task form' : 'Task'}`, kind: 'form', nodeId: node.id, nodeType: node.type, roots })
      continue
    }
    if (node.type === 'user_task') {
      // The task's form (its own fields, or the linked reusable form):
      // {{task_data.<key>}} once the task completes.
      const entries = withContextEntries(formFieldEntries(nodeFormFields(node, linkedForms)), node, linkedForms)
      if (entries.length) {
        const roots = entries.map((entry) => fieldRoot('task_data', entry, node.label))
        known.push(...roots)
        taskFormGroups.push({ id: `form:${node.id}`, label: `${node.label || 'User task'} › Form`, kind: 'form', nodeId: node.id, nodeType: node.type, roots })
      }
    }
    const roots = rootsForNode(node, known, linkedForms)
    if (!roots.length) continue
    known.push(...roots)
    stepGroups.push({ id: `step:${node.id}`, label: node.label || node.type, kind: 'step', nodeId: node.id, nodeType: node.type, roots })
  }

  const loopGroups: DataGroup[] = []
  if (currentNodeId) {
    const loops = enclosingLoops(currentNodeId, nodes, edges)
    const loopRoots: DataRoot[] = []
    let outerItem: SchemaNode | null = null
    loops.forEach((loop, index) => {
      const itemVar = loop.config?.item_var || 'item'
      const indexVar = loop.config?.index_var || 'index'
      // Inner loops resolve against the outer loop's item ({{item.lines}} inside a loop over orders); the latest root of a path wins.
      const listSchema = schemaForExpression(loop.config?.items, [...known, ...[...loopRoots].reverse()])
      const itemSchema = listSchema?.type === 'array' ? (listSchema.items ?? { type: 'any' }) : { type: 'any' as const }
      const roots: DataRoot[] = [
        { path: itemVar, label: itemVar, schema: itemSchema, description: `The item this pass of "${loop.label}" is on` },
        { path: indexVar, label: indexVar, schema: { type: 'integer' }, description: 'Position of the current item (0 = first)' },
        // A loop inside another loop: the outer loop's current item / index (whatever its item variable is called).
        ...(outerItem ? [
          { path: 'parent_item', label: 'parent_item', schema: outerItem, description: `The outer loop's current item (${loops[index - 1].label})` },
          { path: 'parent_index', label: 'parent_index', schema: { type: 'integer' as const }, description: `Position of the outer loop's item (0 = first)` },
        ] : []),
      ]
      outerItem = itemSchema
      loopRoots.push(...roots)
      const innermost = index === loops.length - 1
      loopGroups.unshift({ id: `loop:${loop.id}`, label: innermost ? 'Current item' : `Outer loop item (${loop.label})`, kind: 'loop', nodeId: loop.id, nodeType: 'loop', roots })
    })
  }

  const groups: DataGroup[] = [...loopGroups, ...triggerFormGroups]
  if (startRoots.length) groups.push({ id: 'workflow-variables', label: 'Start form › Workflow inputs', kind: 'workflow', roots: startRoots })
  groups.push(...taskFormGroups, ...stepGroups, ...triggerGroups)
  return groups
}

function humanizeName(name: string): string {
  const words = String(name ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : String(name ?? '')
}

/** A form field as a pickable root: labelled, the technical path as the hint. */
function fieldRoot(base: string, entry: FormFieldEntry, stepLabel?: string): DataRoot {
  const path = `${base}.${entry.key}`
  const schema = entry.example !== undefined && entry.schema.type !== 'object' && entry.schema.type !== 'array' ? { ...entry.schema, example: entry.example } : entry.schema
  return { path, label: entry.label, hint: path, schema, description: stepLabel ? `${entry.typeLabel} · from "${stepLabel}"` : entry.typeLabel }
}

/**
 * The fields a form node carries: its own (or cached) copy, or — when the
 * node links a reusable form and the cache is missing or older than the
 * form's latest version (drafts follow the latest) — the linked form's.
 */
export function nodeFormFields(node: PickerNodeLike, linkedForms?: Record<string, LinkedFormLike> | null): TaskFieldDef[] {
  const own = valueFields(normalizeTaskFields(node.config?.fields))
  const formId = typeof node.config?.form_id === 'string' ? node.config.form_id : ''
  const linked = formId ? linkedForms?.[formId] : undefined
  if (!linked) return own
  const pinned = Number.isInteger(node.config?.form_version)
  const stale = !pinned && Number.isInteger(linked.version) && node.config?.form_cached_version !== linked.version
  if (own.length && !stale) return own
  const latest = valueFields(normalizeTaskFields(linked.fields))
  return latest.length ? latest : own
}

/**
 * Pickable form-field suggestions (for the `{{` autocomplete): every root of
 * the form groups, labelled, in tree order.
 */
export function formFieldSuggestions(groups: DataGroup[]): Array<{ name: string; label: string; group: string }> {
  const out: Array<{ name: string; label: string; group: string }> = []
  const seen = new Set<string>()
  for (const group of groups) {
    if (group.kind !== 'form' && group.kind !== 'workflow') continue
    for (const root of group.roots) {
      if (seen.has(root.path)) continue
      seen.add(root.path)
      out.push({ name: root.path, label: root.label, group: group.label })
    }
  }
  return out
}

/** Readable labels for paths (form fields, workflow inputs) — chips show these, the key on hover. */
export function pathLabels(groups: DataGroup[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const group of groups) {
    if (group.kind !== 'form' && group.kind !== 'workflow') continue
    for (const root of group.roots) {
      // Form fields (`form.x`, `task_data.x`, `task.data.x`) and workflow inputs — not submission metadata.
      const isField = group.kind === 'workflow' || (root.path.includes('.') && root.schema?.type !== 'object')
      if (isField && root.label && root.label !== root.path && !out.has(root.path)) out.set(root.path, root.label)
    }
  }
  return out
}

/** "Recently used" group: recent paths still pickable here, most recent first (null when none). */
export function recentGroup(groups: DataGroup[], recentPaths: string[], limit = 5): DataGroup | null {
  const byPath = new Map<string, DataRoot>()
  for (const item of flattenTree(groups)) {
    if (item.path.includes('[]')) continue
    if (!byPath.has(item.path)) byPath.set(item.path, { path: item.path, label: item.label, hint: item.hint ?? item.path, schema: item.schema, description: item.group })
  }
  const roots: DataRoot[] = []
  for (const path of recentPaths) {
    const root = byPath.get(path)
    if (root && !roots.some((r) => r.path === path)) roots.push(root)
    if (roots.length >= limit) break
  }
  return roots.length ? { id: 'recent', label: 'Recently used', kind: 'recent', roots } : null
}

// ─── Tree items (what the picker renders) ───────────────────────────────

/**
 * A row in the tree. `path` uses `[]` for "inside each item of this list"
 * (`get_customers_response.data[].address.city`); `expression` is the plain
 * insert for it (first item for array-interior paths).
 */
export interface PickerItem {
  id: string
  label: string
  path: string
  schema: SchemaNode
  depth: number
  /** Arrays: label for the "each item" level (`data[]`). */
  hasChildren: boolean
  group: string
  description?: string
  /** Secondary text (the technical key when the label is human). */
  hint?: string
}

export function childItems(parent: { path: string; schema: SchemaNode; depth: number; group: string }): PickerItem[] {
  const schema = parent.schema
  if (schema.type === 'object') {
    return (schema.fields ?? []).map((field) => ({
      id: `${parent.path}.${field.name}`,
      label: field.name,
      path: `${parent.path}.${field.name}`,
      schema: field,
      depth: parent.depth + 1,
      hasChildren: hasPickableChildren(field),
      group: parent.group,
      description: field.description,
    }))
  }
  if (schema.type === 'array' && schema.items) {
    const items = schema.items
    if (items.type === 'object') {
      return (items.fields ?? []).map((field) => ({
        id: `${parent.path}[].${field.name}`,
        label: field.name,
        path: `${parent.path}[].${field.name}`,
        schema: field,
        depth: parent.depth + 1,
        hasChildren: hasPickableChildren(field),
        group: parent.group,
        description: field.description,
      }))
    }
    if (items.type === 'array') {
      return [{ id: `${parent.path}[]`, label: 'each item', path: `${parent.path}[]`, schema: items, depth: parent.depth + 1, hasChildren: hasPickableChildren(items), group: parent.group }]
    }
  }
  return []
}

export function hasPickableChildren(schema: SchemaNode): boolean {
  if (schema.type === 'object') return (schema.fields ?? []).length > 0
  if (schema.type === 'array') return !!schema.items && ((schema.items.type === 'object' && (schema.items.fields ?? []).length > 0) || schema.items.type === 'array')
  return false
}

export function rootItem(group: DataGroup, root: DataRoot): PickerItem {
  const schema = root.schema ?? { type: 'any' as const }
  return { id: `${group.id}:${root.path}`, label: root.label, path: root.path, schema, depth: 0, hasChildren: hasPickableChildren(schema), group: group.label, description: root.description, ...(root.hint ? { hint: root.hint } : {}) }
}

/** Every item of every group, depth-first (for search). Bounded. */
export function flattenTree(groups: DataGroup[], limit = 2000): PickerItem[] {
  const out: PickerItem[] = []
  const walk = (item: PickerItem) => {
    if (out.length >= limit) return
    out.push(item)
    if (item.depth < 8) for (const child of childItems(item)) walk(child)
  }
  for (const group of groups) for (const root of group.roots) walk(rootItem(group, root))
  return out
}

// ─── Picker choices → expressions ───────────────────────────────────────

export type PickChoice =
  | { kind: 'value' }
  | { kind: 'list' }
  | { kind: 'first' }
  | { kind: 'index'; index: number }
  | { kind: 'find'; field: string; value: string }
  | { kind: 'pluck' }
  | { kind: 'count' }
  | { kind: 'loop'; itemVar?: string }

export interface PathParts {
  /** The innermost list, outer lists indexed at 0 (`x.data.0.orders`); null when the path is not inside or at a list. */
  arrayPath: string | null
  /** Field path inside one item ('' = the item itself). */
  itemPath: string
  /** True when the picked value itself is a list (choices apply to that list). */
  isList: boolean
}

/** Split a tree path at its innermost list. */
export function splitPickPath(path: string, schema?: SchemaNode | null): PathParts {
  if (schema?.type === 'array' && !path.endsWith('[]')) {
    return { arrayPath: path.split('[]').join('.0'), itemPath: '', isList: true }
  }
  const last = path.lastIndexOf('[]')
  if (last < 0) return { arrayPath: null, itemPath: path, isList: false }
  const arrayPath = path.slice(0, last).split('[]').join('.0')
  const itemPath = path.slice(last + 2).replace(/^\./, '')
  return { arrayPath, itemPath, isList: false }
}

/** `{{path}}` with `[]` (inside a list) read from the first item. */
export function plainExpression(path: string): string {
  return `{{${path.split('[]').join('.0')}}}`
}

function quote(value: string): string {
  return JSON.stringify(value)
}

/** The expression a picker choice inserts. */
export function buildPickExpression(path: string, schema: SchemaNode | null | undefined, choice: PickChoice): string {
  const parts = splitPickPath(path, schema)
  if (choice.kind === 'value' || !parts.arrayPath) return plainExpression(path)
  const list = parts.arrayPath
  const item = parts.itemPath
  switch (choice.kind) {
    case 'list': return `{{${list}}}`
    case 'first': return `{{${list}.0${item ? `.${item}` : ''}}}`
    case 'index': return `{{${list}.${Math.max(0, Math.floor(choice.index))}${item ? `.${item}` : ''}}}`
    case 'find': {
      const value = /^-?\d+(\.\d+)?$/.test(choice.value) || /^\{\{[\w.[\]-]+\}\}$/.test(choice.value) ? choice.value : quote(choice.value)
      return `{{=FIND_WHERE(${list}, ${quote(choice.field)}, ${value}${item ? `, ${quote(item)}` : ''})}}`
    }
    case 'pluck': return item ? `{{=PLUCK(${list}, ${quote(item)})}}` : `{{${list}}}`
    case 'count': return `{{=COUNT(${list})}}`
    case 'loop': return `{{${choice.itemVar || 'item'}${item ? `.${item}` : ''}}}`
  }
}

/** Fields of a list's items that "Find item where…" can match on (primitives, dotted). */
export function matchableFields(schema: SchemaNode | null | undefined, prefix = '', depth = 0): string[] {
  if (!schema || schema.type !== 'object' || depth > 2) return []
  const out: string[] = []
  for (const field of schema.fields ?? []) {
    const name = prefix ? `${prefix}.${field.name}` : field.name
    if (field.type === 'object') out.push(...matchableFields(field, name, depth + 1))
    else if (field.type !== 'array') out.push(name)
  }
  return out.slice(0, 40)
}

/** The list model a path's choices apply to. */
export function listSchemaFor(path: string, schema: SchemaNode | null | undefined, groups: DataGroup[]): SchemaNode | null {
  const parts = splitPickPath(path, schema)
  if (!parts.arrayPath) return null
  if (parts.isList) return schema ?? null
  return schemaForPath(parts.arrayPath, groups.flatMap((group) => group.roots))
}

// ─── Loop items autocomplete ───────────────────────────────────────────

export interface ArrayCandidate {
  /** Expression to put in the Loop's items field. */
  expression: string
  path: string
  label: string
  group: string
  groupKind: DataGroupKind
  nodeType?: string
  itemSchema: SchemaNode | null
  /** e.g. "list of objects · 4 fields". */
  hint: string
  /** One-line preview of an example item built from the model's examples. */
  preview: string
  description?: string
}

/** A representative item built from field examples (bounded). */
export function exampleFromSchema(schema: SchemaNode | null | undefined, depth = 0): unknown {
  if (!schema) return undefined
  if (schema.example !== undefined) return schema.example
  if (depth > 3) return undefined
  if (schema.type === 'object') {
    const out: Record<string, unknown> = {}
    for (const field of (schema.fields ?? []).slice(0, 8)) {
      const value = exampleFromSchema(field, depth + 1)
      out[field.name] = value === undefined ? `<${field.type}>` : value
    }
    return out
  }
  if (schema.type === 'array') {
    const item = exampleFromSchema(schema.items, depth + 1)
    return item === undefined ? [] : [item]
  }
  return undefined
}

function previewOf(schema: SchemaNode | null): string {
  const example = exampleFromSchema(schema)
  if (example === undefined) return ''
  const text = typeof example === 'string' ? example : JSON.stringify(example)
  return text.length > 90 ? `${text.slice(0, 89)}…` : text
}

function listHint(schema: SchemaNode): string {
  const items = schema.items
  if (!items || items.type === 'any') return 'list'
  if (items.type === 'object') {
    const count = (items.fields ?? []).length
    return `list of objects${count ? ` · ${count} field${count === 1 ? '' : 's'}` : ''}`
  }
  return `list of ${items.type === 'integer' ? 'number' : items.type}s`
}

/**
 * Every value a Loop can iterate at this point: lists in the data tree,
 * reachable without going through another list (lists inside list items are
 * reachable from the Current item of an enclosing loop instead).
 */
export function collectArrayCandidates(groups: DataGroup[]): ArrayCandidate[] {
  const out: ArrayCandidate[] = []
  const seen = new Set<string>()
  const visit = (group: DataGroup, path: string, label: string, schema: SchemaNode | null, depth: number, description?: string) => {
    if (!schema || depth > 6) return
    if (schema.type === 'array') {
      if (seen.has(path)) return
      seen.add(path)
      out.push({
        expression: `{{${path}}}`,
        path,
        label,
        group: group.label,
        groupKind: group.kind,
        nodeType: group.nodeType,
        itemSchema: schema.items ?? null,
        hint: listHint(schema),
        preview: previewOf(schema.items ?? null),
        description: description ?? schema.description,
      })
      return
    }
    if (schema.type === 'object') {
      for (const field of schema.fields ?? []) visit(group, `${path}.${field.name}`, `${label} › ${field.name}`, field, depth + 1, field.description)
    }
  }
  for (const group of groups) for (const root of group.roots) visit(group, root.path, root.label, root.schema, 0, root.description)
  return out
}

/**
 * Fuzzy match score (higher is better, -1 = no match): exact/prefix of a path
 * segment beats a substring, which beats an in-order subsequence.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')
  if (!q) return 0
  const t = text.toLowerCase()
  if (t === q) return 1000
  const segments = t.split(/[.\s›_[\]]+/).filter(Boolean)
  if (segments.some((segment) => segment === q)) return 900 - t.length
  if (segments.some((segment) => segment.startsWith(q))) return 800 - t.length
  const index = t.indexOf(q)
  if (index >= 0) return 600 - index - t.length
  let position = 0
  let gaps = 0
  for (const ch of q) {
    const next = t.indexOf(ch, position)
    if (next < 0) return -1
    gaps += next - position
    position = next + 1
  }
  return Math.max(1, 300 - gaps * 5 - t.length)
}

/** Candidates matching `query`, best first (stable for an empty query). */
export function rankArrayCandidates(query: string, candidates: ArrayCandidate[]): ArrayCandidate[] {
  if (!query.trim()) return candidates
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: Math.max(fuzzyScore(query, candidate.path), fuzzyScore(query, `${candidate.group} ${candidate.label}`)),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate)
}

/** Is the Loop items expression known to be a list here? `unknown` when we can't tell (free text). */
export function arrayStatus(expression: string, groups: DataGroup[]): 'array' | 'not-array' | 'unknown' {
  const text = String(expression ?? '').trim()
  if (!text) return 'unknown'
  const schema = schemaForExpression(text, groups.flatMap((group) => group.roots))
  if (!schema || schema.type === 'any') return 'unknown'
  return schema.type === 'array' ? 'array' : 'not-array'
}

// ─── "Loop through each item" ──────────────────────────────────────────

/**
 * Insert a Loop before `targetId`: edges into the target now enter the loop,
 * the loop's "Each Item" runs the target, and the target's unlabeled
 * outgoing edges continue from the loop's "Done" (so the steps after it still
 * run once). Branch-labeled edges stay on the target. Returns new arrays.
 */
export function insertLoopBefore<N extends PickerNodeLike & { position: { x: number; y: number } }, E extends PickerEdgeLike & { id: string }>(
  nodes: N[],
  edges: E[],
  targetId: string,
  itemsExpression: string,
  makeLoop: (x: number, y: number) => N,
  newId: () => string,
): { nodes: N[]; edges: E[]; loop: N } | null {
  const target = nodes.find((node) => node.id === targetId)
  if (!target) return null
  const loop = makeLoop(target.position.x, target.position.y)
  loop.config = { ...loop.config, items: itemsExpression, item_var: loop.config?.item_var ?? 'item', index_var: loop.config?.index_var ?? 'index' }
  const shift = 140
  const movedNodes = nodes.map((node) => (node.id !== loop.id && node.position.y >= target.position.y && Math.abs(node.position.x - target.position.x) < 400
    ? { ...node, position: { ...node.position, y: node.position.y + shift } }
    : node))
  const nextEdges: E[] = []
  for (const edge of edges) {
    if (edge.target === targetId) nextEdges.push({ ...edge, target: loop.id })
    else if (edge.source === targetId && !(edge.label ?? '').trim()) nextEdges.push({ ...edge, source: loop.id, label: 'Done' })
    else nextEdges.push(edge)
  }
  nextEdges.push({ id: newId(), source: loop.id, target: targetId, label: 'Each Item' } as E)
  return { nodes: [...movedNodes, loop], edges: nextEdges, loop }
}

/* ── E-signature steps (lib/esign) ─────────────────────────────────── */

const ESIGN_RECIPIENT: SchemaNode = { type: 'array', items: { type: 'object', fields: [
  { name: 'name', type: 'string' }, { name: 'email', type: 'string' }, { name: 'role', type: 'string' }, { name: 'status', type: 'string' },
  { name: 'routing_order', type: 'integer' }, { name: 'signed_at', type: 'string' }, { name: 'declined_reason', type: 'string' },
] } }
const ESIGN_FILE: SchemaNode = { type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'url', type: 'string' }, { name: 'size', type: 'integer' }, { name: 'mime_type', type: 'string' }] }
const ESIGN_ENVELOPE_FIELDS = [
  { name: 'envelope_id', type: 'string' as const }, { name: 'status', type: 'string' as const }, { name: 'provider', type: 'string' as const },
  { name: 'completed', type: 'boolean' as const }, { name: 'signed_count', type: 'integer' as const }, { name: 'signer_count', type: 'integer' as const },
  { name: 'recipients', ...ESIGN_RECIPIENT }, { name: 'completed_at', type: 'string' as const }, { name: 'client_reference', type: 'string' as const },
]

function esignNodeRoots(type: string, c: Record<string, any>): DataRoot[] {
  const ov = String(c.output_var ?? '').trim() || (type === 'esign_send' ? 'envelope' : type === 'esign_wait' ? 'signature' : 'esign_result')
  if (type === 'esign_send') {
    return [
      { path: ov, label: ov, schema: { type: 'object', fields: ESIGN_ENVELOPE_FIELDS }, description: 'The envelope that was sent' },
      { path: `${ov}_id`, label: `${ov}_id`, schema: { type: 'string' }, description: 'Envelope ID' },
    ]
  }
  if (type === 'esign_wait') {
    return [
      { path: ov, label: ov, schema: { type: 'object', fields: [...ESIGN_ENVELOPE_FIELDS, { name: 'outcome', type: 'string' }, { name: 'signed_document', ...ESIGN_FILE }, { name: 'certificate', ...ESIGN_FILE }] }, description: 'Outcome, recipients and the signed PDF' },
      { path: 'esign_outcome', label: 'esign_outcome', schema: { type: 'string' }, description: 'completed, declined, voided, expired or timeout' },
    ]
  }
  const action = String(c.action ?? 'status')
  const schema: SchemaNode = action === 'download'
    ? { type: 'object', fields: [{ name: 'file', ...ESIGN_FILE }, { name: 'certificate', ...ESIGN_FILE }, { name: 'files', type: 'array' }] }
    : action === 'signing_url' ? { type: 'object', fields: [{ name: 'url', type: 'string' }, { name: 'expires_at', type: 'string' }] }
      : action === 'list_templates' ? { type: 'object', fields: [{ name: 'templates', type: 'array' }, { name: 'next_cursor', type: 'string' }] }
        : action === 'cancel' ? { type: 'object', fields: [{ name: 'envelope_id', type: 'string' }, { name: 'cancelled', type: 'boolean' }] }
          : { type: 'object', fields: ESIGN_ENVELOPE_FIELDS }
  return [{ path: ov, label: ov, schema }]
}
