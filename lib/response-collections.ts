/**
 * Collections in an API response: every list a designer can use as "the
 * rows" (a form Data table, a lookup's suggestions, a workflow Loop), at any
 * depth, plus the fields of its items and paging hints.
 *
 * A collection path is relative to what the runtime reads — the reference
 * executor's `data` (the parsed response body):
 *
 *   ''                 the response itself is the list
 *   contents           a list field
 *   data.result.items  a list a few objects deep
 *   value[0].children  a list inside the first item of another list
 *   orders[].lines     every order's lines, one after the other
 *
 * The designer stores these paths verbatim and `collectionAt` reads them at
 * runtime (lib/services/form-data-table, lib/forms/lookup), so what the
 * designer previews is what the server uses.
 *
 * Pure and client-safe.
 */

import { defaultFormatKind, type CellFormatKind } from '@/lib/formatting/cell-format'
import { splitPath, valueAtPath, type ResponseSchema, type SchemaNode } from '@/lib/response-schema'


export const COLLECTION_LIMITS = {
  /** Object levels walked looking for lists. */
  maxDepth: 8,
  maxCandidates: 60,
  /** Nested levels of item fields offered as columns (`owner.display_name` = 2). */
  fieldDepth: 3,
  maxFields: 120,
  /** Items gathered when a path flattens lists (`orders[].lines`). */
  maxFlattened: 5000,
} as const

const SEGMENT = '[A-Za-z0-9_$@-]{1,64}'
const INDEX = '(?:\\[\\d{0,4}\\])'
/** `contents`, `data.items`, `value[0].children`, `orders[].lines`, `[0].rows` — at most 10 segments. */
export const COLLECTION_PATH_RE = new RegExp(`^(?:${SEGMENT}${INDEX}*|${INDEX}+)(?:\\.${SEGMENT}${INDEX}*){0,9}$`)

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Canonical spelling of a typed path: trimmed, a leading JSONPath `$.` dropped,
 * `.0.` spelled `[0].`, a trailing `[]` or `.` dropped (`contents[]` =
 * `contents`). A leading `response.` is kept: it may be a real key.
 */
export function normalizeCollectionPath(path: unknown): string {
  let p = String(path ?? '').trim()
  p = p.replace(/^\$\.?/, '').replace(/^\.+/, '')
  p = p.replace(/\.(\d+)(?=\.|\[|$)/g, '[$1]')
  p = p.replace(/^(\d+)(?=\.|\[|$)/, '[$1]')
  for (;;) {
    const next = p.replace(/\[\]$/, '').replace(/\.$/, '')
    if (next === p) break
    p = next
  }
  return p
}

export function isCollectionPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (!COLLECTION_PATH_RE.test(path)) return false
  return !splitPath(path).some((segment) => FORBIDDEN.has(segment))
}

/**
 * The rows at a collection path in a response (the runtime side of the
 * designer's picker). A list → its items; `[]` flattens; a single object at
 * a non-empty path → one row; anything else → no rows.
 */
export function collectionAt(data: unknown, path: string | undefined | null): unknown[] {
  const p = normalizeCollectionPath(path ?? '')
  if (!p) return Array.isArray(data) ? data : []
  // A key that itself contains dots (OData '@odata.nextLink' style) wins.
  if (data !== null && typeof data === 'object' && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, p)) {
    const at = (data as Record<string, unknown>)[p]
    return Array.isArray(at) ? at : isPlainObject(at) ? [at] : []
  }
  if (!isCollectionPath(p)) return []
  let current: unknown[] = [data]
  let flattened = false
  for (const segment of splitPath(p)) {
    if (FORBIDDEN.has(segment)) return []
    const next: unknown[] = []
    for (const value of current) {
      if (segment === '[]') {
        flattened = true
        if (Array.isArray(value)) next.push(...value)
      } else if (/^\d+$/.test(segment) && Array.isArray(value)) {
        const item = value[Number(segment)]
        if (item !== undefined) next.push(item)
      } else if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, segment)) {
        next.push((value as Record<string, unknown>)[segment])
      }
      if (next.length > COLLECTION_LIMITS.maxFlattened) break
    }
    current = next.slice(0, COLLECTION_LIMITS.maxFlattened)
  }
  if (!flattened) {
    const at = current[0]
    if (Array.isArray(at)) return at
    return isPlainObject(at) ? [at] : []
  }
  const out: unknown[] = []
  for (const value of current) {
    if (Array.isArray(value)) out.push(...value)
    else if (value !== undefined && value !== null) out.push(value)
    if (out.length >= COLLECTION_LIMITS.maxFlattened) break
  }
  return out.slice(0, COLLECTION_LIMITS.maxFlattened)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// ─── The runtime's view of a stored model ───────────────────────────────

const WRAPPER_KEYS = new Set(['status', 'status_code', 'statusCode', 'status_text', 'statusText', 'ok', 'headers', 'data', 'body', 'error_message', 'duration_ms', 'url'])

/**
 * A model / sample as the runtime sees it. References return the parsed
 * response body (`data`), but a model pasted or captured from a whole test
 * result (`{ status, headers, data }`) wraps it: paths are then shown
 * relative to the body, which is what Data tables, lookups and Loops read.
 */
export function runtimeView(schema: ResponseSchema | null | undefined): { root: SchemaNode | null; sample: unknown; unwrapped: string | null } {
  if (!schema?.root) return { root: null, sample: undefined, unwrapped: null }
  const root = schema.root
  if (root.type === 'object' && root.fields?.length) {
    const names = root.fields.map((field) => field.name)
    const status = root.fields.find((field) => field.name === 'status' || field.name === 'status_code' || field.name === 'statusCode')
    const body = root.fields.find((field) => field.name === 'data' || field.name === 'body')
    if (status && (status.type === 'integer' || status.type === 'number') && body && names.every((name) => WRAPPER_KEYS.has(name))) {
      const sample = isPlainObject(schema.sample) ? (schema.sample as Record<string, unknown>)[body.name] : undefined
      return { root: body, sample, unwrapped: body.name }
    }
  }
  return { root, sample: schema.sample, unwrapped: null }
}

/** The response body of an executor result (`{ status, data, headers }`), else the value itself. */
export function unwrapExecutorResult(value: unknown): unknown {
  if (isPlainObject(value) && 'data' in value && typeof value.status === 'number' && Object.keys(value).every((key) => WRAPPER_KEYS.has(key))) return value.data
  return value
}

// ─── Candidates ─────────────────────────────────────────────────────────

export interface CollectionCandidate {
  /** Collection path ('' = the response itself). */
  path: string
  /** The list's model. */
  schema: SchemaNode
  itemSchema: SchemaNode | null
  /** Items are objects (rows with fields). */
  objectItems: boolean
  /** Inside another list (`orders[].lines`, `value[0].children`). */
  nested: boolean
  /** Object levels from the root. */
  depth: number
  /** Items in the sample, when there is one. */
  count?: number
}

function joinPath(base: string, name: string): string {
  return base ? `${base}.${name}` : name
}

/**
 * Every list in a model, outermost first, depth-first in field order: the
 * root, list fields at any depth, and lists inside list items (as `a[].b`,
 * which flattens). Bounded.
 */
export function findCollections(root: SchemaNode | null | undefined, sample?: unknown): CollectionCandidate[] {
  const out: CollectionCandidate[] = []
  const visit = (node: SchemaNode | null | undefined, path: string, depth: number, nested: boolean) => {
    if (!node || depth > COLLECTION_LIMITS.maxDepth || out.length >= COLLECTION_LIMITS.maxCandidates) return
    if (node.type === 'array') {
      const items = node.items ?? null
      const sampled = sample === undefined || nested ? undefined : (path ? valueAtPath(sample, path) : sample)
      out.push({
        path,
        schema: node,
        itemSchema: items,
        objectItems: items?.type === 'object',
        nested,
        depth,
        ...(Array.isArray(sampled) ? { count: sampled.length } : {}),
      })
      if (items?.type === 'object') for (const field of items.fields ?? []) visit(field, `${path}[].${field.name}`, depth + 1, true)
      else if (items?.type === 'array') visit(items, `${path}[]`, depth + 1, true)
      return
    }
    if (node.type === 'object') for (const field of node.fields ?? []) visit(field, joinPath(path, field.name), depth + 1, nested)
  }
  visit(root, '', 0, false)
  return out
}

/**
 * The list to preselect: the only list of objects outside other lists, else
 * the only list of objects anywhere, else the only list. Null when there is
 * a real choice to make.
 */
export function autoPickCollection(candidates: CollectionCandidate[]): string | null {
  const objects = candidates.filter((c) => c.objectItems)
  const outer = objects.filter((c) => !c.nested)
  if (outer.length === 1) return outer[0].path
  if (outer.length === 0 && objects.length === 1) return objects[0].path
  if (objects.length === 0 && candidates.length === 1) return candidates[0].path
  return null
}

export interface CollectionPathCheck {
  ok: boolean
  /** The canonical spelling to store. */
  path: string
  /** Why not (or a warning when ok and the model can't tell). */
  message?: string
  schema?: SchemaNode | null
  itemSchema?: SchemaNode | null
}

/** Model at a collection path: `[]` and `[n]` step into list items. */
export function schemaAtCollectionPath(root: SchemaNode | null | undefined, path: string): SchemaNode | null {
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

/** Is a typed path a list in the model? Without a model only the syntax is checked. */
export function validateCollectionPath(root: SchemaNode | null | undefined, rawPath: string): CollectionPathCheck {
  const path = normalizeCollectionPath(rawPath)
  if (path && !isCollectionPath(path)) return { ok: false, path, message: 'Use field names separated by dots, with [0] for one item or [] for every item (e.g. data.items or orders[].lines).' }
  if (!root || root.type === 'any') return { ok: true, path, message: path ? 'No response model to check this against — Load a sample to check it.' : undefined }
  const schema = schemaAtCollectionPath(root, path)
  if (!schema) return { ok: false, path, message: `The response has no "${path}".` }
  if (schema.type === 'array') return { ok: true, path, schema, itemSchema: schema.items ?? null }
  // The response itself must be a list; an object further down is read as one row.
  if (schema.type === 'object' && !path) return { ok: false, path, schema, message: 'The response is an object — pick the list inside it that holds the rows.' }
  if (schema.type === 'object') return { ok: true, path, schema, itemSchema: schema, message: 'This is a single object — it becomes one row.' }
  if (schema.type === 'any') return { ok: true, path, schema, itemSchema: null, message: 'The model does not say what this is.' }
  return { ok: false, path, message: `"${path}" is a ${schema.type === 'integer' ? 'number' : schema.type}, not a list.` }
}

// ─── Item fields ────────────────────────────────────────────────────────

export interface CollectionField {
  /** Dotted path inside one item (`owner.display_name`). */
  path: string
  name: string
  type: SchemaNode['type']
  /** Nesting level, 0 = a top-level item field. */
  level: number
  example?: unknown
  /** True for object containers (shown as group headers, not added as columns). */
  container?: boolean
  /** The display format a column of this field starts with. */
  format: CellFormatKind
}

const SIZE_NAME = /(^|[_.-])(size|bytes|file_?size|content_?length|size_?in_?bytes|length_?bytes)$|(Size|Bytes|ContentLength)$|^contentLength$/

/** The format a field's column starts with: datetimes and dates from examples, byte counts as file sizes. */
export function suggestFieldFormat(name: string, type: SchemaNode['type'], example?: unknown): CellFormatKind {
  if ((type === 'integer' || type === 'number') && (SIZE_NAME.test(name) || SIZE_NAME.test(name.toLowerCase()))) return 'file_size'
  if (type === 'integer') return 'integer'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'object' || type === 'array') return 'json'
  return defaultFormatKind(undefined, example === undefined || example === null ? [] : [example])
}

/**
 * Fields of a list's items, nested objects walked up to `maxDepth` levels
 * (`owner.display_name`). Lists inside items are listed (a JSON column) but
 * not walked — pick them as their own collection instead.
 */
export function collectionItemFields(itemSchema: SchemaNode | null | undefined, maxDepth: number = COLLECTION_LIMITS.fieldDepth): CollectionField[] {
  const out: CollectionField[] = []
  const walk = (node: SchemaNode, prefix: string, level: number) => {
    for (const field of node.fields ?? []) {
      if (out.length >= COLLECTION_LIMITS.maxFields) return
      const path = prefix ? `${prefix}.${field.name}` : field.name
      if (field.type === 'object' && (field.fields ?? []).length && level + 1 < maxDepth) {
        out.push({ path, name: field.name, type: 'object', level, container: true, format: 'json' })
        walk(field, path, level + 1)
        continue
      }
      out.push({ path, name: field.name, type: field.type, level, ...(field.example !== undefined ? { example: field.example } : {}), format: suggestFieldFormat(field.name, field.type, field.example) })
    }
  }
  if (itemSchema?.type === 'object') walk(itemSchema, '', 0)
  return out
}

// ─── Paging hints ───────────────────────────────────────────────────────

export type PagingHintKind = 'total' | 'next_link' | 'cursor' | 'has_more'

export interface PagingHint { path: string; kind: PagingHintKind }

const PAGING_PATTERNS: Array<[PagingHintKind, RegExp]> = [
  ['next_link', /^(@odata\.nextLink|odata\.nextLink|__next|next|nextLink|next_link|next_page_url|nextPageUrl|next_url|nextUrl)$/],
  ['cursor', /^(next_continuation_token|NextContinuationToken|continuation_token|continuationToken|nextToken|next_token|NextToken|cursor|next_cursor|nextCursor|next_page_token|nextPageToken|page_token|pageToken|after|end_cursor|endCursor)$/],
  ['has_more', /^(is_truncated|IsTruncated|isTruncated|has_more|hasMore|has_next|hasNext|has_next_page|hasNextPage|more)$/],
  ['total', /^(total|total_count|totalCount|total_results|totalResults|total_items|totalItems|total_records|totalRecords|totalSize|@odata\.count|odata\.count|__count|count)$/],
]

/** Paging keys in the response (top level and one object down, e.g. `meta.total`, `paging.next`). */
export function pagingHints(root: SchemaNode | null | undefined): PagingHint[] {
  const out: PagingHint[] = []
  const scan = (node: SchemaNode | null | undefined, prefix: string, depth: number) => {
    if (!node || node.type !== 'object' || depth > 1) return
    for (const field of node.fields ?? []) {
      const path = prefix ? `${prefix}.${field.name}` : field.name
      const match = PAGING_PATTERNS.find(([, re]) => re.test(field.name))
      if (match && field.type !== 'array' && field.type !== 'object') out.push({ path, kind: match[0] })
      else if (field.type === 'object') scan(field, path, depth + 1)
    }
  }
  scan(root, '', 0)
  return out.slice(0, 12)
}

// ─── Workflow expressions ───────────────────────────────────────────────

/**
 * The Loop items expression for a collection under a workflow variable
 * (`get_files_response`): `{{get_files_response.contents}}`, indexes as
 * `.0`, and `[]` (every item's list) as FLATTEN(PLUCK(…)).
 */
export function workflowCollectionExpression(base: string, path: string): string {
  const p = normalizeCollectionPath(path)
  const parts = p.split('[]')
  const dotted = (text: string) => text.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '')
  let expr = [base, dotted(parts[0])].filter(Boolean).join('.')
  if (parts.length === 1) return `{{${expr}}}`
  for (const rest of parts.slice(1)) {
    const field = dotted(rest)
    expr = field ? `FLATTEN(PLUCK(${expr}, ${JSON.stringify(field)}))` : `FLATTEN(${expr})`
  }
  return `{{=${expr}}}`
}

/** The collection path a Loop items expression points at under `base`, or null (another expression). */
export function collectionPathFromExpression(expression: string, base: string): string | null {
  const match = String(expression ?? '').trim().match(/^\{\{\s*([\w.$@-]+)\s*\}\}$/)
  if (!match) return null
  const full = match[1]
  if (full === base) return ''
  if (!full.startsWith(`${base}.`)) return null
  return normalizeCollectionPath(full.slice(base.length + 1))
}
