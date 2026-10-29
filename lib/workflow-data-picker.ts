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

import { documentNodeRoots } from '@/lib/documents/schemas'
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
import { lookupItemFields, lookupItemKey } from './forms/lookup'
import { attachmentsCountKey } from './forms/attachments'
import { fieldValueSchemaType, normalizeTaskFields, TASK_FIELD_TYPE_LABELS, valueFields, type TaskFieldDef } from './task-field-schema'

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

/** The value model of a form field (numbers, booleans, ISO date strings, multi-select arrays, file lists). */
export function fieldSchema(field: TaskFieldDef): SchemaNode {
  if (field.type === 'attachments') return { type: 'array', items: ATTACHMENT_FILE_SCHEMA, description: 'Uploaded files (loop over them, or attach them all)' }
  if (field.type === 'lookup') {
    const what = field.lookup?.source === 'reference' ? 'API reference' : 'data table'
    return field.lookup?.multiple
      ? { type: 'array', items: { type: 'string' }, description: `Selected values (from a ${what})` }
      : { type: 'string', description: `Selected value (from a ${what})` }
  }
  const type = fieldValueSchemaType(field.type)
  const description = field.type === 'date' ? 'Date (YYYY-MM-DD)' : field.type === 'datetime' ? 'Date and time (ISO 8601)' : field.type === 'user' ? 'User id' : field.type === 'currency' ? `Amount${field.currency ? ` (${field.currency})` : ''}` : undefined
  const base: SchemaNode = type === 'array' ? { type: 'array', items: { type: 'string' } } : { type }
  return description ? { ...base, description } : base
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

/** Data picker fields of a form: each value field, plus `<key>_item` for lookups. */
function formFieldEntries(fields: TaskFieldDef[]): FormFieldEntry[] {
  const out: FormFieldEntry[] = []
  for (const field of valueFields(fields)) {
    out.push({ key: field.key, label: field.label || field.key, schema: fieldSchema(field), typeLabel: TASK_FIELD_TYPE_LABELS[field.type], ...(field.default !== undefined ? { example: field.default } : {}) })
    const item = lookupItemSchema(field)
    if (item) out.push({ key: lookupItemKey(field.key), label: `${field.label || field.key} (selected item)`, schema: item, typeLabel: 'Lookup item' })
    if (field.type === 'attachments') out.push({ key: attachmentsCountKey(field.key), label: `${field.label || field.key} (number of files)`, schema: { type: 'integer', description: 'Number of files' }, typeLabel: 'Number' })
  }
  return out
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
export function rootsForNode(node: PickerNodeLike, known: DataRoot[] = []): DataRoot[] {
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
      if (op === 'list') {
        return [
          { path: c.output_rows_var || 'rows', label: c.output_rows_var || 'rows', schema: columnsSchema(cols, 'rows'), description: 'Rows returned by the query' },
          { path: c.output_count_var || 'row_count', label: c.output_count_var || 'row_count', schema: { type: 'integer' }, description: 'Number of rows returned' },
        ]
      }
      if (op === 'get') {
        return [
          { path: c.output_row_var || 'row', label: c.output_row_var || 'row', schema: columnsSchema(cols, 'row'), description: 'The row' },
          { path: c.output_row_id_var || 'row_id', label: c.output_row_id_var || 'row_id', schema: { type: 'string' }, description: 'Row ID' },
        ]
      }
      return [{ path: c.output_row_id_var || 'row_id', label: c.output_row_id_var || 'row_id', schema: { type: 'string' }, description: `Row ID from ${op}` }]
    }
    case 'set_variable': {
      if (!c.name) return []
      return [{ path: c.name, label: c.name, schema: schemaForExpression(c.expression, known) ?? { type: 'any' }, description: 'Set Variable' }]
    }
    case 'run_agent': {
      const outVar = c.output_variable || 'agent_response'
      const roots: DataRoot[] = [
        { path: outVar, label: outVar, schema: { type: 'string' }, description: 'Agent response text' },
        { path: `${outVar}_status`, label: `${outVar}_status`, schema: { type: 'string' }, description: 'Execution status' },
      ]
      for (const output of (Array.isArray(c._agent_outputs) ? c._agent_outputs : []) as { name?: string; type?: string; description?: string }[]) {
        const key = String(output?.name ?? '').trim()
        if (!key) continue
        roots.push({ path: `${prefix}_${key}`, label: key, schema: str(typeFromDeclared(output.type), output.description), description: output.description || 'Agent output' })
      }
      return roots
    }
    case 'custom_activity': {
      const outputs = Array.isArray(c.manifest?.outputs) ? c.manifest.outputs : []
      return outputs.flatMap((output: any) => {
        const key = String(output?.name ?? output?.key ?? '').trim()
        if (!key) return []
        const declared = output?.schema && typeof output.schema === 'object' ? normalizeResponseSchema(isResponseSchema(output.schema) ? output.schema : { root: output.schema })?.root : null
        return [{ path: key, label: output?.label ?? key, schema: declared ?? str(typeFromDeclared(output?.type)), description: output?.description || 'Custom step output' }]
      })
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
    case 'user_task':
      return [
        { path: `${prefix}_task_id`, label: 'task_id', schema: { type: 'string' }, description: 'Created task ID' },
        { path: 'outcome', label: 'outcome', schema: { type: 'string' }, description: 'Outcome chosen on completion' },
      ]
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
    default:
      return []
  }
}

const TRIGGER_TYPES = new Set([
  'task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected',
  'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted',
  'middleware_received', 'schedule', 'webhook_received',
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
  known.push(...workflowRoots)

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
      const entries = formFieldEntries(nodeFormFields(node, linkedForms))
      const formName = String(node.config?.form_name ?? 'form')
      const roots: DataRoot[] = [
        ...entries.map((entry) => fieldRoot('form', entry)),
        { path: 'submitted_by_name', label: 'Submitted by (name)', hint: 'submitted_by_name', schema: str('string', 'Submitter name') },
        { path: 'submitted_by_email', label: 'Submitted by (email)', hint: 'submitted_by_email', schema: str('string', 'Submitter email') },
        { path: 'submitted_by', label: 'Submitted by (user id)', hint: 'submitted_by', schema: str('string', 'User id of the submitter') },
        { path: 'submitted_at', label: 'Submitted at', hint: 'submitted_at', schema: str('string', 'ISO 8601') },
        { path: 'form_button', label: 'Button pressed', hint: 'form_button', schema: str('string', 'Button pressed (id)') },
        { path: 'form_outcome', label: 'Outcome', hint: 'form_outcome', schema: str('string', 'Outcome of an outcome button / task') },
        { path: 'form_submission_id', label: 'Submission id', hint: 'form_submission_id', schema: str('string', 'Submission id') },
        { path: 'form_source', label: 'Source', hint: 'form_source', schema: str('string', 'standalone, api or task') },
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
      if (entries.length) {
        const roots: DataRoot[] = [
          ...entries.map((entry) => fieldRoot('task.data', entry)),
          {
            path: 'task.data',
            label: 'All values (object)',
            hint: 'task.data',
            schema: { type: 'object', fields: entries.map((entry) => ({ ...entry.schema, name: entry.key, description: `${entry.label} (${entry.typeLabel})` })) },
            description: 'Form fields of the task that started the run',
          },
        ]
        known.push(...roots)
        triggerFormGroups.push({ id: `trigger:${node.id}`, label: `${node.label || 'Task trigger'} › Task form`, kind: 'form', nodeId: node.id, nodeType: node.type, roots })
      }
      continue
    }
    if (node.type === 'user_task') {
      // The task's form (its own fields, or the linked reusable form):
      // {{task_data.<key>}} once the task completes.
      const entries = formFieldEntries(nodeFormFields(node, linkedForms))
      if (entries.length) {
        const roots = entries.map((entry) => fieldRoot('task_data', entry, node.label))
        known.push(...roots)
        taskFormGroups.push({ id: `form:${node.id}`, label: `${node.label || 'User task'} › Form`, kind: 'form', nodeId: node.id, nodeType: node.type, roots })
      }
    }
    const roots = rootsForNode(node, known)
    if (!roots.length) continue
    known.push(...roots)
    stepGroups.push({ id: `step:${node.id}`, label: node.label || node.type, kind: 'step', nodeId: node.id, nodeType: node.type, roots })
  }

  const loopGroups: DataGroup[] = []
  if (currentNodeId) {
    const loops = enclosingLoops(currentNodeId, nodes, edges)
    const loopRoots: DataRoot[] = []
    loops.forEach((loop, index) => {
      const itemVar = loop.config?.item_var || 'item'
      const indexVar = loop.config?.index_var || 'index'
      const listSchema = schemaForExpression(loop.config?.items, [...known, ...loopRoots])
      const itemSchema = listSchema?.type === 'array' ? (listSchema.items ?? { type: 'any' }) : { type: 'any' as const }
      const roots: DataRoot[] = [
        { path: itemVar, label: itemVar, schema: itemSchema, description: `The item this pass of "${loop.label}" is on` },
        { path: indexVar, label: indexVar, schema: { type: 'integer' }, description: 'Position of the current item (0 = first)' },
      ]
      loopRoots.push(...roots)
      const innermost = index === loops.length - 1
      loopGroups.unshift({ id: `loop:${loop.id}`, label: innermost ? 'Current item' : `Outer loop item (${loop.label})`, kind: 'loop', nodeId: loop.id, nodeType: 'loop', roots })
    })
  }

  const groups: DataGroup[] = [...loopGroups, ...triggerFormGroups]
  if (workflowRoots.length) groups.push({ id: 'workflow-variables', label: 'Start form › Workflow inputs', kind: 'workflow', roots: workflowRoots })
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
