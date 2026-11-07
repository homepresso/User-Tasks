/**
 * Custom references: a tidy, reusable reference a designer builds on top of
 * one of an integration's operations (or a database table/view), with
 * declared inputs, a column projection, filters, sort, distinct and paging.
 *
 * Storage (no extra column — exports, packages, GitHub sync, config-as-code,
 * API, MCP and CLI carry it as part of request_config):
 *
 *   integration_references.request_config = {
 *     ...source request (method, path_template, body_template, headers,
 *        query_params, connector_template, typed_placeholders …),
 *     origin: 'custom',
 *     custom: CustomReferenceConfig,
 *     response_schema: <generated from the projection>,
 *   }
 *   integration_references.inputs = the PUBLIC inputs (Ask mode + paging)
 *   integration_references.outputs = the projected columns
 *
 * Everything keyed by a user-chosen name is stored as an ARRAY of
 * `{ name, … }` (never an object keyed by the name): export scrubbing masks
 * values under credential-shaped keys, and an input called `next_token`
 * must not turn its mapping into "__SECRET__".
 *
 * Pure and client-safe.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- configs arrive as free-form JSON */

export const CUSTOM_ORIGIN = 'custom' as const

export const CUSTOM_LIMITS = {
  /** Rows the server shapes after fetching (anything the API did not do). */
  serverRows: 1000,
  /** Hard cap on the page size / max rows a reference may return. */
  maxRows: 1000,
  defaultPageSize: 100,
  maxInputs: 40,
  maxColumns: 60,
  maxConditions: 40,
  maxGroupDepth: 3,
  maxSort: 5,
  /** Nested levels of a column path (`owner.address.city` = 3). */
  columnDepth: 3,
  /** Shaping time budget (ms) — the pipeline stops with an error past it. */
  shapingMs: 2000,
  /** Largest `in` list. */
  maxInValues: 200,
  /** Largest string value compared. */
  maxValueLength: 2000,
} as const

export type CustomKind = 'read' | 'list' | WriteKind

/** Kinds that change data (Create, Update, Upsert, Delete, Execute). */
export type WriteKind = 'create' | 'update' | 'upsert' | 'delete' | 'execute'

export const WRITE_KINDS: readonly WriteKind[] = ['create', 'update', 'upsert', 'delete', 'execute']
export const CUSTOM_KINDS: readonly CustomKind[] = ['read', 'list', ...WRITE_KINDS]

export type WriteHttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const WRITE_HTTP_METHODS: readonly WriteHttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/** Builder labels, descriptions and the default REST method of each kind. */
export const KIND_INFO: Record<CustomKind, { label: string; description: string; method?: WriteHttpMethod; writes: boolean }> = {
  read: { label: 'Read', description: 'Returns one record, looked up by a key input.', writes: false },
  list: { label: 'List', description: 'Returns rows, filtered, sorted and paged.', writes: false },
  create: { label: 'Create', description: 'Adds one record (REST POST or SQL INSERT) and returns it.', method: 'POST', writes: true },
  update: { label: 'Update', description: 'Changes the record(s) a key or conditions pick (REST PATCH/PUT or SQL UPDATE … WHERE).', method: 'PATCH', writes: true },
  upsert: { label: 'Upsert', description: 'Creates the record, or updates it when its key already exists (REST PUT, SQL ON CONFLICT / MERGE).', method: 'PUT', writes: true },
  delete: { label: 'Delete', description: 'Removes the record(s) a key or conditions pick (REST DELETE or SQL DELETE … WHERE).', method: 'DELETE', writes: true },
  execute: { label: 'Execute', description: 'Runs an action: any operation (typically POST with a body) or a stored procedure / function.', method: 'POST', writes: true },
}

export function isWriteKind(kind: unknown): kind is WriteKind {
  return typeof kind === 'string' && (WRITE_KINDS as readonly string[]).includes(kind)
}

/** Caps of write kinds. */
export const WRITE_LIMITS = {
  /** Default max affected rows (Update / Upsert / Delete). */
  defaultMaxAffected: 1,
  /** Highest max affected rows an author may set. */
  maxAffected: 1000,
  maxBodyFields: 60,
  /** Nested levels of a body field path (`customer.address.city` = 3). */
  bodyDepth: 5,
  maxSetColumns: 100,
  maxKeyColumns: 8,
  maxProcedureParams: 60,
} as const

export type CustomInputType = 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'object'

export const CUSTOM_INPUT_TYPES: readonly CustomInputType[] = ['string', 'number', 'integer', 'boolean', 'date', 'array', 'object']

export interface CustomInput {
  name: string
  type: CustomInputType
  required?: boolean
  default_value?: unknown
  description?: string
  /** 'ask' (callers map it) is the default; 'fixed' = a constant inside the reference. */
  mode?: 'ask' | 'fixed'
  /** Fixed mode: a typed constant … */
  fixed_value?: unknown
  /** … or one of the integration's settings / credentials by name (resolved server-side). */
  fixed_setting?: string
}

/** A source parameter (the operation's own input) and what fills it: a constant or `{{input.x}}`. */
export interface SourceParam {
  name: string
  value: string
}

export interface SourceInputDef {
  id?: string
  name: string
  type?: string
  required?: boolean
  default_value?: unknown
  description?: string
  location?: string
}

export interface TableColumnDef {
  name: string
  type?: string
}

export type CustomSource =
  | {
      /** An operation of the integration: copied (materialised) into request_config at save. */
      type: 'operation'
      /** What it was built from — `reference`, `template` (connector), `openapi`, `endpoint`. */
      from?: 'reference' | 'template' | 'openapi' | 'endpoint'
      /** Display label (e.g. the source reference's name or template key). */
      label?: string
      /** Connector template key / OpenAPI operation key, when built from one. */
      key?: string
      /** The operation's own inputs (placeholders in the request). */
      inputs: SourceInputDef[]
      /** What each operation input receives. Inputs not listed use their default. */
      params: SourceParam[]
    }
  | {
      type: 'table'
      schema?: string
      table: string
      /** Introspected columns — the only names the SQL compiler accepts. */
      columns: TableColumnDef[]
    }

export interface CustomColumn {
  /** Dotted path inside one row (`owner.display_name`), at most 3 levels. For tables: the column name. */
  path: string
  /** Output name (defaults to the last path segment). */
  alias?: string
  type?: string
}

export type FilterOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains' | 'starts_with' | 'ends_with'
  | 'in' | 'not_in' | 'is_empty' | 'is_not_empty'

export const FILTER_OPERATORS: ReadonlyArray<{ value: FilterOperator; label: string; unary?: boolean }> = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'greater or equal' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'less or equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'is_empty', label: 'is empty', unary: true },
  { value: 'is_not_empty', label: 'is not empty', unary: true },
]

export interface FilterCondition {
  /** Field path in the (unprojected) row. */
  field: string
  operator: FilterOperator
  /** A constant, or `{{input.<name>}}` (a whole-value token keeps the input's type). */
  value?: unknown
  /**
   * REST only: send this condition's value to an operation parameter instead
   * of applying it on the server (the API does the filtering).
   */
  api_param?: string
}

export interface FilterGroup {
  op: 'and' | 'or'
  conditions: Array<FilterCondition | FilterGroup>
}

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

/** REST: request parameters the API understands for sort and paging. */
export interface ApiMapping {
  /** Receives the first sort column's field. */
  sort_param?: string
  /** Receives 'asc' / 'desc' of the first sort column. */
  order_param?: string
  /** Receives the page size. */
  limit_param?: string
  /** Receives the row offset … */
  offset_param?: string
  /** … or the 1-based page number. */
  page_param?: string
}

/** A table column (or procedure parameter) and what it receives: `{{input.x}}` or a constant. */
export interface WriteColumn {
  column: string
  value: string
}

export type BodyFieldType = 'auto' | 'string' | 'number' | 'boolean' | 'json' | 'null'

/** One field of a REST request body: a dotted JSON path and its value. */
export interface BodyField {
  /** `customer.name` (at most 5 levels). */
  path: string
  /** `{{input.x}}` (a whole token keeps the input's type), text with tokens, or a constant. */
  value?: unknown
  /** How the value is written (auto = as given). */
  type?: BodyFieldType
}

export interface WriteConfig {
  /** REST: the HTTP method sent (defaults per kind; the author may change it). */
  method?: WriteHttpMethod
  /**
   * REST request body:
   *  - source: the operation's own body template, filled by its parameters;
   *  - none: no body;
   *  - inputs: the whole input object (every input except credentials and the idempotency key);
   *  - mapped: built from `fields`.
   */
  body?: { mode: 'source' | 'none' | 'inputs' | 'mapped'; fields?: BodyField[] }
  /** Create / Execute: an input whose value is sent as an idempotency key (header for REST). */
  idempotency?: { input: string; header?: string }
  /** REST: statuses counted as success, e.g. "200-299" (default) or "200,201,204". */
  success_statuses?: string
  /** DB Create / Update / Upsert: column ← value. */
  set?: WriteColumn[]
  /** DB Update / Delete: WHERE column = value (AND). Upsert: the conflict (match) columns. */
  key?: WriteColumn[]
  /** DB: return the written row(s) (RETURNING / OUTPUT), projected through `columns`. */
  returning?: boolean
  /** DB Execute: a stored procedure or function from introspection. */
  procedure?: {
    schema?: string
    name: string
    routine_type?: 'procedure' | 'function'
    /** Introspected parameters (the only names accepted) and what each receives. */
    params: Array<{ name: string; type?: string; value?: string; is_output?: boolean }>
  }
  /** DB Update / Upsert / Delete: more affected rows than this rolls the transaction back (default 1). */
  max_affected?: number
  /** Update / Delete with nothing affected: fail with 404 (default) or succeed as a no-op. */
  not_found?: 'error' | 'noop'
  /** Output field holding the record id (default `id`, else the first key column). */
  id_field?: string
}

export interface CustomReferenceConfig {
  version: 1
  kind: CustomKind
  source: CustomSource
  /** Every declared input (Ask and Fixed). The reference's public `inputs` are the Ask ones. */
  inputs: CustomInput[]
  /** Collection path of the rows in the source response ('' = the response is the list). */
  rows_path?: string
  columns: CustomColumn[]
  filter?: FilterGroup
  sort?: SortSpec[]
  distinct?: boolean
  /** Rows per call (list). */
  page_size?: number
  /** Upper bound on rows returned (list). */
  max_rows?: number
  /** Expose `page` / `limit` inputs to callers. */
  paging_inputs?: boolean
  /** List output becomes `{ rows, total }` instead of the bare rows array. */
  include_total?: boolean
  api?: ApiMapping
  read?: {
    /** The input that identifies the record (e.g. `id`). */
    key_input?: string
    /** Row field matched against the key input on the server (optional). */
    key_field?: string
    /** No row: return null (default) or fail the call (HTTP 404). */
    not_found?: 'null' | 'error'
  }
  /** Write kinds: request / statement, safety and output settings. */
  write?: WriteConfig
}

export function isFilterGroup(node: unknown): node is FilterGroup {
  return !!node && typeof node === 'object' && Array.isArray((node as FilterGroup).conditions)
}

export function isCustomReference(ref: { request_config?: any } | null | undefined): boolean {
  const rc = ref?.request_config
  return !!rc && rc.origin === CUSTOM_ORIGIN && !!rc.custom && typeof rc.custom === 'object'
}

/** Output name of a column. */
export function columnName(column: CustomColumn): string {
  const alias = String(column.alias ?? '').trim()
  if (alias) return alias
  const parts = String(column.path ?? '').split('.')
  return parts[parts.length - 1] || String(column.path ?? '')
}

/** The name an `{{input.x}}` token refers to, when the whole value is one token. */
export function wholeInputToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\s*\{\{\s*input\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}\s*$/.exec(value)
  return match ? match[1] : null
}

/** The kind of a custom reference (null for generated references). */
export function customKindOf(ref: { request_config?: any } | null | undefined): CustomKind | null {
  if (!isCustomReference(ref)) return null
  const kind = ref?.request_config?.custom?.kind
  return (CUSTOM_KINDS as readonly string[]).includes(kind) ? (kind as CustomKind) : 'list'
}

/** A custom reference of a write kind (Create, Update, Upsert, Delete, Execute). */
export function isWriteReference(ref: { request_config?: any } | null | undefined): boolean {
  return isWriteKind(customKindOf(ref))
}

export const WRITES_DATA_BADGE = 'Writes data'

/** Picker hint for a reference: its integration, tagged "Custom" for custom references and "Writes data" for write kinds. */
export function referencePickerHint(ref: { request_config?: any; integration?: { name?: string | null } | null } | null | undefined): string | undefined {
  const parts = [ref?.integration?.name ?? undefined, isCustomReference(ref) ? 'Custom' : undefined, isWriteReference(ref) ? WRITES_DATA_BADGE : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

export const INPUT_TOKEN_RE =/\{\{\s*input\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g
