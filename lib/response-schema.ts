/**
 * Response models for integration references (and any node output whose
 * shape is known): a small JSON-Schema-like tree the workflow data picker
 * walks so designers can click `Get Customers › response › data[] › email`
 * instead of hand-writing JSON paths.
 *
 * Stored on the reference at `request_config.response_schema` (no extra
 * column, so exports, GitHub sync and config-as-code carry it unchanged).
 *
 * Object fields are an ARRAY of `{ name, ... }` rather than a JSON Schema
 * `properties` map on purpose: export scrubbing masks values under
 * credential-shaped KEYS, and a `properties.password` map entry would turn
 * the field's `type` into "__SECRET__". As an array the field name is a value,
 * never a key. Examples under credential-shaped field names are never kept.
 *
 * Pure and client-safe (no node imports): used by the reference builder, the
 * workflow designer, the API service layer and the OpenAPI importer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- walks arbitrary JSON */

export type SchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'any'

export interface SchemaNode {
  type: SchemaType
  /** The value can also be null (seen null in a sample, or `nullable` in a spec). */
  nullable?: boolean
  description?: string
  format?: string
  /** A short primitive example (strings trimmed); never kept for credential-shaped fields. */
  example?: string | number | boolean | null
  /** Object fields, in source order. */
  fields?: SchemaField[]
  /** Array item model. */
  items?: SchemaNode
}

export interface SchemaField extends SchemaNode {
  name: string
  /** False when a merged sample lacked the field (or a spec does not require it). */
  required?: boolean
}

export type ResponseSchemaSource = 'openapi' | 'sample' | 'database' | 'connector' | 'outputs' | 'manual'

export interface ResponseSchema {
  version: 1
  source: ResponseSchemaSource
  root: SchemaNode
  /** A trimmed copy of the last captured response (arrays cut to a few items). */
  sample?: unknown
  /** How many samples were merged into the model. */
  samples?: number
  updated_at?: string
}

export const SCHEMA_LIMITS = {
  maxDepth: 8,
  maxFieldsPerObject: 80,
  maxItemsInspected: 25,
  maxTotalNodes: 600,
  exampleLength: 120,
  /** List items kept in a stored sample (fewer when over sampleMaxBytes). */
  sampleArrayItems: 20,
  sampleStringLength: 200,
  sampleDepth: 6,
  /** Upper bound for a stored sample's JSON size. */
  sampleMaxBytes: 48 * 1024,
} as const

const SENSITIVE_FIELD = /password|secret|private_key|account_key|service_account|(^|_)token$|^token$|(^|_)api_key$|^key_value$|^authorization$|^cookie$/i

/** True for field names whose values must never be kept as examples / samples. */
export function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD.test(String(name ?? ''))
}

function trimExample(value: unknown): SchemaNode['example'] {
  if (value === null) return null
  if (typeof value === 'string') return value.length > SCHEMA_LIMITS.exampleLength ? `${value.slice(0, SCHEMA_LIMITS.exampleLength)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  return undefined
}

// ─── Inference from sample data ────────────────────────────────────────

interface Budget { nodes: number }

function inferNode(value: unknown, depth: number, budget: Budget, fieldName?: string): SchemaNode {
  budget.nodes++
  if (value === null || value === undefined) return { type: 'null' }
  if (Array.isArray(value)) {
    const node: SchemaNode = { type: 'array' }
    if (depth >= SCHEMA_LIMITS.maxDepth || budget.nodes > SCHEMA_LIMITS.maxTotalNodes) return node
    let items: SchemaNode | undefined
    for (const entry of value.slice(0, SCHEMA_LIMITS.maxItemsInspected)) {
      const inferred = inferNode(entry, depth + 1, budget, fieldName)
      items = items ? mergeSchemaNodes(items, inferred) : inferred
    }
    if (items) node.items = items
    return node
  }
  if (typeof value === 'object') {
    const node: SchemaNode = { type: 'object', fields: [] }
    if (depth >= SCHEMA_LIMITS.maxDepth || budget.nodes > SCHEMA_LIMITS.maxTotalNodes) return node
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, SCHEMA_LIMITS.maxFieldsPerObject)) {
      const field: SchemaField = { name: key, ...inferNode(child, depth + 1, budget, key) }
      node.fields!.push(field)
    }
    return node
  }
  const sensitive = fieldName ? isSensitiveFieldName(fieldName) : false
  const example = sensitive ? undefined : trimExample(value)
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number', ...(example !== undefined ? { example } : {}) }
  if (typeof value === 'boolean') return { type: 'boolean', ...(example !== undefined ? { example } : {}) }
  return { type: 'string', ...(example !== undefined ? { example } : {}) }
}

/** Infer a model from one sample value (a parsed JSON response). */
export function inferSchema(value: unknown): SchemaNode {
  return inferNode(value, 0, { nodes: 0 })
}

// ─── Merging ───────────────────────────────────────────────────────────

function mergeFieldLists(a: SchemaField[], b: SchemaField[]): SchemaField[] {
  const out: SchemaField[] = []
  const bByName = new Map(b.map((field) => [field.name, field]))
  const seen = new Set<string>()
  for (const field of a) {
    seen.add(field.name)
    const other = bByName.get(field.name)
    if (other) {
      const merged = mergeSchemaNodes(field, other) as SchemaField
      out.push({ ...merged, name: field.name, ...(field.required === false || other.required === false ? { required: false } : {}) })
    } else {
      out.push({ ...field, required: false })
    }
  }
  for (const field of b) if (!seen.has(field.name)) out.push({ ...field, required: false })
  return out.slice(0, SCHEMA_LIMITS.maxFieldsPerObject)
}

/**
 * Merge two models of the same value (e.g. two samples, or a spec and a
 * sample). Null widens to `nullable`, integer+number → number, conflicting
 * primitives → any; object fields union (missing on one side → not required);
 * array items merge. Descriptions/examples from `a` win, `b` fills gaps.
 */
export function mergeSchemaNodes(a: SchemaNode, b: SchemaNode): SchemaNode {
  if (a.type === 'null' && b.type !== 'null') return { ...b, nullable: true }
  if (b.type === 'null' && a.type !== 'null') return { ...a, nullable: true }
  const nullable = a.nullable || b.nullable ? { nullable: true } : {}
  const description = a.description ?? b.description
  const meta = { ...nullable, ...(description ? { description } : {}) }
  if (a.type === 'object' && b.type === 'object') {
    return { type: 'object', ...meta, fields: mergeFieldLists(a.fields ?? [], b.fields ?? []) }
  }
  if (a.type === 'array' && b.type === 'array') {
    const items = a.items && b.items ? mergeSchemaNodes(a.items, b.items) : (a.items ?? b.items)
    return { type: 'array', ...meta, ...(items ? { items } : {}) }
  }
  if (a.type === b.type) {
    const example = a.example !== undefined ? a.example : b.example
    const format = a.format ?? b.format
    return { type: a.type, ...meta, ...(format ? { format } : {}), ...(example !== undefined ? { example } : {}) }
  }
  const numeric = new Set<SchemaType>(['integer', 'number'])
  if (numeric.has(a.type) && numeric.has(b.type)) {
    const example = a.example !== undefined ? a.example : b.example
    return { type: 'number', ...meta, ...(example !== undefined ? { example } : {}) }
  }
  if (a.type === 'any') return { ...a, ...meta }
  if (b.type === 'any') return { ...b, ...meta }
  return { type: 'any', ...meta }
}

// ─── Samples ───────────────────────────────────────────────────────────

export interface TrimSampleOptions {
  /** List items to keep (default SCHEMA_LIMITS.sampleArrayItems). */
  arrayItems?: number
  /** JSON size budget (default SCHEMA_LIMITS.sampleMaxBytes); the item count halves until it fits. */
  maxBytes?: number
}

function trimSampleValue(value: unknown, depth: number, arrayItems: number): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return value.length > SCHEMA_LIMITS.sampleStringLength ? `${value.slice(0, SCHEMA_LIMITS.sampleStringLength)}…` : value
  if (typeof value !== 'object') return value
  if (depth >= SCHEMA_LIMITS.sampleDepth) return Array.isArray(value) ? [] : {}
  if (Array.isArray(value)) return value.slice(0, arrayItems).map((entry) => trimSampleValue(entry, depth + 1, arrayItems))
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, SCHEMA_LIMITS.maxFieldsPerObject)) {
    out[key] = isSensitiveFieldName(key) ? '••••' : trimSampleValue(child, depth + 1, arrayItems)
  }
  return out
}

/**
 * A display-safe copy of a response for examples and schema inference: up to
 * 20 list items (configurable), short strings, no credential values, and
 * within a JSON size budget — the item count halves until it fits.
 */
export function trimSample(value: unknown, options: TrimSampleOptions = {}): unknown {
  const maxBytes = options.maxBytes ?? SCHEMA_LIMITS.sampleMaxBytes
  let items = Math.max(1, Math.floor(options.arrayItems ?? SCHEMA_LIMITS.sampleArrayItems))
  for (;;) {
    const trimmed = trimSampleValue(value, 0, items)
    if (items <= 1) return trimmed
    let size: number
    try { size = JSON.stringify(trimmed)?.length ?? 0 } catch { return trimmed }
    if (size <= maxBytes) return trimmed
    items = Math.floor(items / 2)
  }
}

/**
 * Fold a captured response into a reference's model: infer from the sample,
 * merge with an existing sample-based (or outputs-derived) model, keep a
 * trimmed sample. A spec/manual model keeps its structure; the sample only
 * fills in examples and fields the spec did not declare.
 */
export function captureResponseSample(existing: ResponseSchema | null | undefined, sample: unknown, now = new Date()): ResponseSchema {
  const inferred = inferSchema(sample)
  const prior = existing && isResponseSchema(existing) ? existing : null
  if (!prior || prior.source === 'outputs') {
    return { version: 1, source: 'sample', root: inferred, sample: trimSample(sample), samples: 1, updated_at: now.toISOString() }
  }
  const root = prior.source === 'sample' ? mergeSchemaNodes(inferred, prior.root) : mergeSchemaNodes(prior.root, inferred)
  return {
    version: 1,
    source: prior.source,
    root,
    sample: trimSample(sample),
    samples: (prior.samples ?? (prior.source === 'sample' ? 1 : 0)) + 1,
    updated_at: now.toISOString(),
  }
}

// ─── From declared outputs (backfill) / database columns ─────────────────

type OutputLike = { name?: string; path?: string; type?: string }

function outputType(type: string | undefined): SchemaType {
  switch (String(type ?? '').toLowerCase()) {
    case 'number': case 'integer': case 'float': case 'decimal': return 'number'
    case 'boolean': case 'bool': return 'boolean'
    case 'array': case 'list': return 'array'
    case 'object': case 'json': return 'object'
    case 'string': case 'text': case 'date': case 'datetime': return 'string'
    default: return 'any'
  }
}

/** Split `data.items[0].name` / `[].col` / `a.0.b` into segments; `[]` and numbers mean "inside an array". */
export function splitPath(path: string): string[] {
  const out: string[] = []
  for (const raw of String(path ?? '').split('.')) {
    if (!raw) continue
    const match = raw.match(/^([^[\]]*)((?:\[\d*\])*)$/)
    if (!match) { out.push(raw); continue }
    if (match[1]) out.push(match[1])
    for (const bracket of match[2].match(/\[\d*\]/g) ?? []) out.push(bracket === '[]' ? '[]' : bracket.slice(1, -1))
  }
  return out
}

function ensureField(node: SchemaNode, name: string): SchemaField {
  if (node.type !== 'object') { node.type = 'object'; delete node.items }
  node.fields ??= []
  let field = node.fields.find((f) => f.name === name)
  if (!field) {
    field = { name, type: 'any' }
    node.fields.push(field)
  }
  return field
}

function ensureItems(node: SchemaNode): SchemaNode {
  if (node.type !== 'array') { node.type = 'array'; delete node.fields }
  node.items ??= { type: 'any' }
  return node.items
}

/**
 * A partial model from a reference's declared outputs ({ name, path, type }):
 * `data.customer.name` → nested objects, `items[0].sku` / `items.0.sku` / `[].col`
 * → arrays of objects. An empty path means the output is the whole response.
 */
export function schemaFromOutputs(outputs: OutputLike[] | null | undefined): SchemaNode | null {
  const list = Array.isArray(outputs) ? outputs : []
  if (list.length === 0) return null
  const root: SchemaNode = { type: 'any' }
  let touched = false
  for (const output of list) {
    const type = outputType(output?.type)
    const segments = splitPath(String(output?.path ?? ''))
    if (segments.length === 0) {
      // Whole response.
      if (root.type === 'any' && type !== 'any') root.type = type
      touched = true
      continue
    }
    let cursor = root
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1
      if (segment === '[]' || /^\d+$/.test(segment)) {
        cursor = ensureItems(cursor)
      } else {
        const field = ensureField(cursor, segment)
        cursor = field
      }
      if (last && (cursor.type === 'any' || (type !== 'any' && cursor.type !== 'object' && cursor.type !== 'array'))) cursor.type = type
    })
    touched = true
  }
  return touched ? root : null
}

export function schemaFromColumns(columns: { name: string; type?: string; description?: string }[], shape: 'rows' | 'row' = 'rows'): SchemaNode {
  const row: SchemaNode = {
    type: 'object',
    fields: columns.slice(0, SCHEMA_LIMITS.maxFieldsPerObject).map((col) => ({
      name: col.name,
      type: dbColumnType(col.type),
      ...(col.description ? { description: col.description } : {}),
    })),
  }
  return shape === 'rows' ? { type: 'array', items: row } : row
}

function dbColumnType(type: string | undefined): SchemaType {
  const t = String(type ?? '').toLowerCase()
  if (/int|serial/.test(t)) return 'integer'
  if (/num|dec|float|double|real|money|number|currency|percent/.test(t)) return 'number'
  if (/bool|bit|checkbox/.test(t)) return 'boolean'
  if (/json|object/.test(t)) return 'object'
  if (/array|\[\]|multi/.test(t)) return 'array'
  if (t === 'any') return 'any'
  return 'string'
}

// ─── From JSON Schema / OpenAPI ────────────────────────────────────────

function resolveJsonRef(ref: string, definitions: Record<string, any> | undefined): { name: string; schema: any } | null {
  const name = ref.replace(/^#\/(definitions|components\/schemas)\//, '')
  const schema = definitions?.[name]
  return schema ? { name, schema } : null
}

/**
 * Convert a JSON Schema / OpenAPI schema (with `$ref`s into `definitions` or
 * `components.schemas`, allOf/oneOf/anyOf, nullable, type arrays) into a
 * SchemaNode. Recursive `$ref`s stop at the second visit.
 */
export function schemaFromJsonSchema(schema: any, definitions?: Record<string, any>, seen: string[] = [], depth = 0): SchemaNode {
  if (!schema || typeof schema !== 'object' || depth > SCHEMA_LIMITS.maxDepth) return { type: 'any' }
  if (typeof schema.$ref === 'string') {
    const resolved = resolveJsonRef(schema.$ref, definitions)
    if (!resolved || seen.includes(resolved.name)) return { type: 'object', ...(resolved ? { description: `${resolved.name} (recursive)` } : {}) }
    const node = schemaFromJsonSchema(resolved.schema, definitions, [...seen, resolved.name], depth + 1)
    return schema.description && !node.description ? { ...node, description: schema.description } : node
  }
  const meta: Partial<SchemaNode> = {}
  if (typeof schema.description === 'string' && schema.description) meta.description = schema.description.slice(0, 300)
  else if (typeof schema.title === 'string' && schema.title) meta.description = schema.title.slice(0, 300)
  if (typeof schema.format === 'string') meta.format = schema.format
  if (schema.nullable === true || schema['x-nullable'] === true) meta.nullable = true
  const example = schema.example !== undefined ? schema.example : Array.isArray(schema.examples) ? schema.examples[0] : undefined
  const trimmedExample = trimExample(example)

  if (Array.isArray(schema.allOf) && schema.allOf.length) {
    let merged: SchemaNode | null = null
    for (const part of schema.allOf) {
      const node = schemaFromJsonSchema(part, definitions, seen, depth + 1)
      if (!merged) { merged = node; continue }
      const prior: SchemaNode = merged
      merged = prior.type === 'object' && node.type === 'object'
        ? { ...prior, fields: [...(prior.fields ?? []), ...(node.fields ?? []).filter((f) => !(prior.fields ?? []).some((m) => m.name === f.name))] }
        : mergeSchemaNodes(prior, node)
    }
    if (schema.properties) {
      const own = schemaFromJsonSchema({ ...schema, allOf: undefined }, definitions, seen, depth + 1)
      merged = merged ? { ...merged, type: 'object', fields: [...(merged.fields ?? []), ...(own.fields ?? [])] } : own
    }
    return { ...(merged ?? { type: 'any' }), ...meta }
  }
  const variants = Array.isArray(schema.oneOf) ? schema.oneOf : Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (variants && variants.length) {
    let merged: SchemaNode | null = null
    for (const part of variants.slice(0, 6)) {
      const node = schemaFromJsonSchema(part, definitions, seen, depth + 1)
      merged = merged ? mergeSchemaNodes(merged, node) : node
    }
    return { ...(merged ?? { type: 'any' }), ...meta }
  }

  let type: string | undefined = schema.type
  if (Array.isArray(schema.type)) {
    const types = schema.type.filter((t: string) => t !== 'null')
    if (types.length < schema.type.length) meta.nullable = true
    type = types.length === 1 ? types[0] : types.length === 0 ? 'null' : 'any'
  }
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : 'any'

  if (type === 'object') {
    const required: string[] = Array.isArray(schema.required) ? schema.required : []
    const fields: SchemaField[] = Object.entries(schema.properties ?? {}).slice(0, SCHEMA_LIMITS.maxFieldsPerObject).map(([name, prop]) => {
      const node = schemaFromJsonSchema(prop, definitions, seen, depth + 1)
      if (isSensitiveFieldName(name)) delete node.example
      return { name, ...node, ...(required.length && !required.includes(name) ? { required: false } : {}) }
    })
    return { type: 'object', ...meta, fields }
  }
  if (type === 'array') {
    return { type: 'array', ...meta, items: schemaFromJsonSchema(schema.items, definitions, seen, depth + 1) }
  }
  const primitive: SchemaType = (['string', 'number', 'integer', 'boolean', 'null'] as const).includes(type as any) ? (type as SchemaType) : 'any'
  return { type: primitive, ...meta, ...(trimmedExample !== undefined ? { example: trimmedExample } : {}) }
}

// ─── Validation / normalization of stored or API-supplied models ─────────

const SCHEMA_TYPES: readonly SchemaType[] = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null', 'any']
const SOURCES: readonly ResponseSchemaSource[] = ['openapi', 'sample', 'database', 'connector', 'outputs', 'manual']

function sanitizeNode(raw: any, depth: number, budget: Budget): SchemaNode {
  budget.nodes++
  const type: SchemaType = SCHEMA_TYPES.includes(raw?.type) ? raw.type : 'any'
  const node: SchemaNode = { type }
  if (raw?.nullable === true) node.nullable = true
  if (typeof raw?.description === 'string' && raw.description) node.description = raw.description.slice(0, 300)
  if (typeof raw?.format === 'string' && raw.format) node.format = raw.format.slice(0, 40)
  const example = trimExample(raw?.example)
  if (example !== undefined && type !== 'object' && type !== 'array') node.example = example
  if (depth >= SCHEMA_LIMITS.maxDepth || budget.nodes > SCHEMA_LIMITS.maxTotalNodes) return node
  if (type === 'object' && Array.isArray(raw?.fields)) {
    node.fields = raw.fields
      .filter((field: any) => field && typeof field.name === 'string' && field.name)
      .slice(0, SCHEMA_LIMITS.maxFieldsPerObject)
      .map((field: any) => {
        const child = sanitizeNode(field, depth + 1, budget)
        if (isSensitiveFieldName(field.name)) delete child.example
        const out: SchemaField = { ...child, name: String(field.name).slice(0, 120) }
        if (field.required === false) out.required = false
        return out
      })
  }
  if (type === 'array' && raw?.items) node.items = sanitizeNode(raw.items, depth + 1, budget)
  return node
}

export function isResponseSchema(value: unknown): value is ResponseSchema {
  return !!value && typeof value === 'object' && !!(value as any).root && typeof (value as any).root === 'object'
}

/**
 * Validate a model from an API/MCP caller or the database: unknown keys are
 * dropped, sizes capped. Accepts either a full ResponseSchema or a bare
 * SchemaNode (wrapped with source "manual"). Returns null for null/invalid.
 */
export function normalizeResponseSchema(raw: unknown, fallbackSource: ResponseSchemaSource = 'manual'): ResponseSchema | null {
  if (!raw || typeof raw !== 'object') return null
  const envelope: any = isResponseSchema(raw) ? raw : { root: raw }
  if (!envelope.root || typeof envelope.root !== 'object' || (!('type' in envelope.root) && !('fields' in envelope.root))) return null
  const out: ResponseSchema = {
    version: 1,
    source: SOURCES.includes(envelope.source) ? envelope.source : fallbackSource,
    root: sanitizeNode(envelope.root, 0, { nodes: 0 }),
  }
  if (envelope.sample !== undefined) out.sample = trimSample(envelope.sample)
  if (Number.isFinite(envelope.samples)) out.samples = Math.max(0, Math.floor(envelope.samples))
  if (typeof envelope.updated_at === 'string') out.updated_at = envelope.updated_at.slice(0, 40)
  return out
}

/** A reference's model: the stored one, else one derived from its declared outputs. */
export function referenceResponseSchema(ref: { request_config?: any; outputs?: any } | null | undefined): ResponseSchema | null {
  const stored = normalizeResponseSchema(ref?.request_config?.response_schema)
  if (stored) return stored
  const derived = schemaFromOutputs(ref?.outputs)
  return derived ? { version: 1, source: 'outputs', root: derived } : null
}

/** The model without its sample — what a workflow node snapshots. */
export function stripSample(schema: ResponseSchema | null): ResponseSchema | null {
  if (!schema) return null
  const { sample: _sample, ...rest } = schema
  void _sample
  return rest
}

// ─── Walking ───────────────────────────────────────────────────────────

/** Model at a dotted path (`data.0.address`, `data[0].address`, `[]`), or null when the model doesn't say. */
export function schemaAtPath(root: SchemaNode | null | undefined, path: string): SchemaNode | null {
  let cursor: SchemaNode | null | undefined = root
  for (const segment of splitPath(path)) {
    if (!cursor) return null
    if (segment === '[]' || /^\d+$/.test(segment)) {
      if (cursor.type !== 'array') return null
      cursor = cursor.items ?? { type: 'any' }
    } else {
      if (cursor.type !== 'object') return null
      cursor = cursor.fields?.find((field) => field.name === segment) ?? null
    }
  }
  return cursor ?? null
}

/** Value at a path in sample data (same syntax as schemaAtPath; `[]` reads the first item). */
export function valueAtPath(value: unknown, path: string): unknown {
  let cursor: any = value
  for (const segment of splitPath(path)) {
    if (cursor === null || cursor === undefined) return undefined
    cursor = segment === '[]' ? cursor?.[0] : cursor[segment]
  }
  return cursor
}

export function countSchemaFields(node: SchemaNode | null | undefined): number {
  if (!node) return 0
  if (node.type === 'object') return (node.fields ?? []).reduce((sum, field) => sum + 1 + countSchemaFields(field), 0)
  if (node.type === 'array') return countSchemaFields(node.items)
  return 0
}

/** A short label like `string`, `list of objects`, `number?`. */
export function describeSchemaType(node: SchemaNode | null | undefined): string {
  if (!node) return 'unknown'
  const base = node.type === 'array'
    ? `list${node.items && node.items.type !== 'any' ? ` of ${node.items.type === 'object' ? 'objects' : `${node.items.type}s`}` : ''}`
    : node.type === 'integer' ? 'number' : node.type
  return node.nullable ? `${base}?` : base
}
