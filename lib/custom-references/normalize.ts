/**
 * Validate and normalise a custom reference config from the builder, the
 * API, MCP, the CLI or an import. Unknown keys are dropped, sizes capped,
 * names checked; a config that would not run is refused with a clear message.
 *
 * Pure and client-safe (the builder validates before saving, the service
 * validates again).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- configs arrive as free-form JSON */

import { isSensitiveKey } from '@/lib/secret-keys'
import { isCollectionPath, normalizeCollectionPath } from '@/lib/response-collections'
import { CustomReferenceError, coerceInputValue, PAGING_INPUTS, templateInputNames } from './inputs'
import { normalizeWriteConfig, writeInputsMentioned } from './write'
import {
  CUSTOM_INPUT_TYPES,
  CUSTOM_KINDS,
  isWriteKind,
  CUSTOM_LIMITS,
  FILTER_OPERATORS,
  columnName,
  isFilterGroup,
  type CustomColumn,
  type CustomInput,
  type CustomInputType,
  type CustomReferenceConfig,
  type CustomSource,
  type FilterCondition,
  type FilterGroup,
  type SortSpec,
} from './types'

const INPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** Operation parameter names (placeholders): letters, digits, `_`, `-`, `.`, `$`. */
const PARAM_NAME = /^[A-Za-z0-9_.$-]{1,100}$/
const FIELD_PATH = /^[A-Za-z0-9_$@-]{1,64}(\.[A-Za-z0-9_$@-]{1,64}){0,5}$/
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
const OPERATORS = new Set(FILTER_OPERATORS.map((o) => o.value))
const UNARY = new Set(FILTER_OPERATORS.filter((o) => o.unary).map((o) => o.value))

const fail = (message: string): never => { throw new CustomReferenceError(message) }
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : v === undefined || v === null ? '' : String(v).slice(0, max))

function fieldPath(raw: unknown, what: string, maxDepth = 6): string {
  const path = str(raw, 400)
  if (!FIELD_PATH.test(path) || path.split('.').some((s) => FORBIDDEN.has(s))) fail(`${what} "${path}" is not a valid field path`)
  if (path.split('.').length > maxDepth) fail(`${what} "${path}" is nested more than ${maxDepth} levels`)
  return path
}

function normalizeInputs(raw: unknown, settingNames: Set<string> | null): CustomInput[] {
  const list = Array.isArray(raw) ? raw.slice(0, CUSTOM_LIMITS.maxInputs + 1) : []
  if (list.length > CUSTOM_LIMITS.maxInputs) fail(`At most ${CUSTOM_LIMITS.maxInputs} inputs`)
  const seen = new Set<string>()
  return list.map((item: any) => {
    const name = str(item?.name, 64)
    if (!INPUT_NAME.test(name)) fail(`Input name "${name}" must start with a letter and use letters, digits or _`)
    if (seen.has(name)) fail(`Input "${name}" is declared twice`)
    seen.add(name)
    const type = (CUSTOM_INPUT_TYPES as readonly string[]).includes(item?.type) ? (item.type as CustomInputType) : 'string'
    const mode = item?.mode === 'fixed' ? 'fixed' : 'ask'
    const input: CustomInput = { name, type, mode }
    if (item?.description) input.description = str(item.description, 300)
    if (mode === 'ask') {
      if (item?.required) input.required = true
      if (item?.default_value !== undefined && item?.default_value !== null && item?.default_value !== '') {
        input.default_value = coerceInputValue(type, item.default_value, name)
      }
      return input
    }
    const setting = str(item?.fixed_setting, 100)
    if (setting) {
      if (settingNames && !settingNames.has(setting)) fail(`Fixed input "${name}": the integration has no setting "${setting}"`)
      input.fixed_setting = setting
      return input
    }
    // A secret typed in plain text: it belongs in the integration's credentials.
    if (isSensitiveKey(name)) {
      fail(`Fixed input "${name}" looks like a secret — store it in the integration's credentials and pick it as an integration setting instead of typing it here`)
    }
    if (item?.fixed_value === undefined || item?.fixed_value === null || item?.fixed_value === '') fail(`Fixed input "${name}" needs a value`)
    input.fixed_value = coerceInputValue(type, item.fixed_value, name)
    return input
  })
}

function normalizeSource(raw: any, procedureOnly = false): CustomSource {
  if (raw?.type === 'table') {
    const table = str(raw.table, 128)
    if (!table && !procedureOnly) fail('Pick a table or view')
    const columns = (Array.isArray(raw.columns) ? raw.columns : []).slice(0, 500).map((c: any) => ({
      name: str(c?.name, 128),
      ...(c?.type ? { type: str(c.type, 60) } : {}),
    })).filter((c: { name: string }) => c.name)
    if (!columns.length && !procedureOnly) fail('The table has no columns — load its columns first')
    return { type: 'table', ...(raw.schema ? { schema: str(raw.schema, 128) } : {}), table, columns }
  }
  const inputs = (Array.isArray(raw?.inputs) ? raw.inputs : []).slice(0, 80).map((i: any) => ({
    ...(i?.id ? { id: str(i.id, 80) } : {}),
    name: str(i?.name, 100),
    type: str(i?.type || 'string', 20),
    required: Boolean(i?.required),
    default_value: i?.default_value ?? '',
    description: str(i?.description, 300),
    location: str(i?.location || 'query', 20),
  })).filter((i: { name: string }) => PARAM_NAME.test(i.name))
  const names = new Set(inputs.map((i: { name: string }) => i.name))
  const params = (Array.isArray(raw?.params) ? raw.params : []).slice(0, 80).map((p: any) => ({ name: str(p?.name, 100), value: str(p?.value, 2000) }))
    .filter((p: { name: string; value: string }) => p.name && p.value !== '')
  for (const p of params) if (!names.has(p.name)) fail(`The operation has no parameter "${p.name}"`)
  const from = ['reference', 'template', 'openapi', 'endpoint'].includes(raw?.from) ? raw.from : undefined
  return {
    type: 'operation',
    ...(from ? { from } : {}),
    ...(raw?.label ? { label: str(raw.label, 200) } : {}),
    ...(raw?.key ? { key: str(raw.key, 200) } : {}),
    inputs,
    params,
  }
}

function normalizeCondition(raw: any, source: CustomSource): FilterCondition {
  const operator = OPERATORS.has(raw?.operator) ? raw.operator : fail(`Unknown filter operator "${str(raw?.operator, 40)}"`)
  const condition: FilterCondition = { field: fieldPath(raw?.field, 'Filter field'), operator }
  if (!UNARY.has(operator)) {
    const value = raw?.value
    if (Array.isArray(value)) condition.value = value.slice(0, CUSTOM_LIMITS.maxInValues).map((v) => (typeof v === 'object' ? JSON.stringify(v) : v))
    else if (typeof value === 'number' || typeof value === 'boolean') condition.value = value
    else condition.value = str(value, CUSTOM_LIMITS.maxValueLength)
  }
  const apiParam = str(raw?.api_param, 100)
  if (apiParam) {
    if (source.type !== 'operation') fail('Only operation sources send filters to the API')
    else if (!source.inputs.some((i) => i.name === apiParam)) fail(`The operation has no parameter "${apiParam}"`)
    condition.api_param = apiParam
  }
  return condition
}

function normalizeGroup(raw: any, source: CustomSource, depth: number, counter: { n: number }): FilterGroup {
  if (depth > CUSTOM_LIMITS.maxGroupDepth) fail('Filter groups are nested too deeply')
  const op = raw?.op === 'or' ? 'or' : 'and'
  const conditions = (Array.isArray(raw?.conditions) ? raw.conditions : []).map((node: any) => {
    if (++counter.n > CUSTOM_LIMITS.maxConditions) fail(`At most ${CUSTOM_LIMITS.maxConditions} filter conditions`)
    return isFilterGroup(node) ? normalizeGroup(node, source, depth + 1, counter) : normalizeCondition(node, source)
  })
  // API-mapped conditions are only meaningful at the root of an AND group.
  if (depth > 0 || op === 'or') for (const node of conditions) if (!isFilterGroup(node) && node.api_param) fail('Only top-level conditions combined with AND can be sent to the API')
  return { op, conditions }
}

function inputsMentioned(config: CustomReferenceConfig): string[] {
  const out: string[] = []
  const walk = (group: FilterGroup | undefined) => {
    for (const node of group?.conditions ?? []) {
      if (isFilterGroup(node)) walk(node)
      else out.push(...templateInputNames(node.value))
    }
  }
  walk(config.filter)
  if (config.source.type === 'operation') for (const p of config.source.params) out.push(...templateInputNames(p.value))
  out.push(...writeInputsMentioned(config.write))
  return out
}

export interface NormalizeOptions {
  /** Names of the integration's settings a Fixed input may use (null = not checked here). */
  settingNames?: Set<string> | null
  /** Settings that hold credentials: inputs fixed to them may only feed operation parameters. */
  secretSettings?: Set<string>
  /** A draft being sampled before any column is picked. */
  allowNoColumns?: boolean
}

export function normalizeCustomConfig(raw: unknown, options: NormalizeOptions = {}): CustomReferenceConfig {
  const r: any = raw && typeof raw === 'object' ? raw : fail('Custom reference config is missing')
  const kind = (CUSTOM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as CustomReferenceConfig['kind']) : 'list'
  const writes = isWriteKind(kind)
  // Execute on a database calls a procedure: no table is needed.
  const procedureOnly = kind === 'execute' && r.source?.type === 'table'
  const source = normalizeSource(r.source, procedureOnly)
  const inputs = normalizeInputs(r.inputs, options.settingNames ?? null)
  const inputNames = new Set(inputs.map((i) => i.name))
  if (r.paging_inputs) for (const reserved of Object.values(PAGING_INPUTS)) if (inputNames.has(reserved)) fail(`"${reserved}" is reserved for paging — rename the input or turn paging inputs off`)

  const maxDepth = source.type === 'table' ? 1 : 3
  const columns: CustomColumn[] = (Array.isArray(r.columns) ? r.columns : []).slice(0, CUSTOM_LIMITS.maxColumns + 1).map((c: any) => {
    const path = source.type === 'table' && !procedureOnly ? str(c?.path, 128) : fieldPath(c?.path, 'Column', maxDepth)
    if (source.type === 'table' && !procedureOnly && !source.columns.some((col) => col.name === path)) fail(`"${path}" is not a column of ${source.table}`)
    const alias = str(c?.alias, 64)
    if (alias && !/^[A-Za-z_][A-Za-z0-9_ -]{0,63}$/.test(alias)) fail(`Column name "${alias}" must start with a letter`)
    return { path, ...(alias && alias !== path ? { alias } : {}), ...(c?.type ? { type: str(c.type, 20) } : {}) }
  })
  if (columns.length > CUSTOM_LIMITS.maxColumns) fail(`At most ${CUSTOM_LIMITS.maxColumns} columns`)
  const names = new Set<string>()
  for (const c of columns) {
    const name = columnName(c)
    if (names.has(name)) fail(`Two columns are named "${name}" — give one an alias`)
    names.add(name)
  }
  // Write kinds return the written record: its columns are optional (none = the whole record).
  if (source.type === 'operation' && !columns.length && !options.allowNoColumns && !writes) fail('Pick at least one column')

  // Write kinds: filter conditions are the WHERE of a table Update / Delete only; no sort or distinct.
  const filterAllowed = !writes || (source.type === 'table' && (kind === 'update' || kind === 'delete'))
  const filter = filterAllowed && r.filter && Array.isArray(r.filter.conditions) && r.filter.conditions.length ? normalizeGroup(r.filter, source, 0, { n: 0 }) : undefined
  if (writes && filter) for (const node of filter.conditions) if (!isFilterGroup(node) && node.api_param) fail('Write conditions run in the database, not as API parameters')
  const sort: SortSpec[] = writes ? [] : (Array.isArray(r.sort) ? r.sort : []).slice(0, CUSTOM_LIMITS.maxSort).map((s: any) => ({
    field: fieldPath(s?.field, 'Sort field'),
    direction: s?.direction === 'desc' ? 'desc' : 'asc',
  }))
  const distinct = !writes && Boolean(r.distinct)
  if (distinct && !columns.length) fail('Distinct needs the columns it compares — pick at least one column')
  if (distinct && source.type === 'table') {
    for (const s of sort) if (!columns.some((c) => c.path === s.field || columnName(c) === s.field)) fail(`With distinct, sort by a selected column ("${s.field}" is not one)`)
  }

  const rowsPath = normalizeCollectionPath(r.rows_path ?? '')
  if (rowsPath && !isCollectionPath(rowsPath)) fail(`Rows list "${rowsPath}" is not a valid path`)

  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Math.floor(Number(v)), CUSTOM_LIMITS.maxRows) : undefined)
  const config: CustomReferenceConfig = {
    version: 1,
    kind,
    source,
    inputs,
    ...(source.type === 'operation' ? { rows_path: rowsPath } : {}),
    columns,
    ...(filter ? { filter } : {}),
    ...(sort.length ? { sort } : {}),
    ...(distinct ? { distinct } : {}),
  }
  if (kind === 'list') {
    const pageSize = num(r.page_size)
    const maxRows = num(r.max_rows)
    if (pageSize) config.page_size = pageSize
    if (maxRows) config.max_rows = maxRows
    if (r.paging_inputs) config.paging_inputs = true
    if (r.include_total) config.include_total = true
  }

  if (source.type === 'operation' && !writes && r.api && typeof r.api === 'object') {
    const api: Record<string, string> = {}
    for (const key of ['sort_param', 'order_param', 'limit_param', 'offset_param', 'page_param'] as const) {
      const v = str(r.api[key], 100)
      if (!v) continue
      if (!source.inputs.some((i) => i.name === v)) fail(`The operation has no parameter "${v}"`)
      api[key] = v
    }
    if ((api.offset_param || api.page_param) && !api.limit_param) fail('Map a page-size parameter before an offset or page parameter')
    if (Object.keys(api).length) config.api = api
  }

  if (kind === 'read') {
    const keyInput = str(r.read?.key_input, 64)
    const keyField = str(r.read?.key_field, 400)
    if (keyInput && !inputNames.has(keyInput)) fail(`The key input "${keyInput}" is not declared`)
    config.read = {
      ...(keyInput ? { key_input: keyInput } : {}),
      ...(keyField ? { key_field: source.type === 'table' ? keyField : fieldPath(keyField, 'Key field') } : {}),
      not_found: r.read?.not_found === 'error' ? 'error' : 'null',
    }
    if (source.type === 'table' && keyField && !source.columns.some((c) => c.name === keyField)) fail(`"${keyField}" is not a column of ${source.table}`)
  }

  if (writes) {
    const write = normalizeWriteConfig(r.write, { kind, source, inputs, hasConditions: !!filter && countConditions(filter) > 0 })
    if (write) config.write = write
  }

  // Every {{input.x}} must be declared; credential-backed inputs never reach server-side filters.
  const secretSettings = options.secretSettings ?? new Set<string>()
  const secretInputs = new Set(inputs.filter((i) => i.fixed_setting && (secretSettings.has(i.fixed_setting) || isSensitiveKey(i.fixed_setting))).map((i) => i.name))
  for (const name of inputsMentioned(config)) {
    if (!inputNames.has(name) && !(config.paging_inputs && (name === PAGING_INPUTS.page || name === PAGING_INPUTS.limit))) fail(`"{{input.${name}}}" refers to an input that is not declared`)
  }
  const walk = (group: FilterGroup | undefined) => {
    for (const node of group?.conditions ?? []) {
      if (isFilterGroup(node)) { walk(node); continue }
      if (node.api_param) continue
      for (const name of templateInputNames(node.value)) if (secretInputs.has(name)) fail(`Input "${name}" holds a credential — it can be sent to the API but not used in a server-side filter`)
    }
  }
  walk(config.filter)
  // …nor database columns / procedure arguments (a write must not copy a credential into a table).
  if (source.type === 'table') {
    for (const name of writeInputsMentioned(config.write)) if (secretInputs.has(name)) fail(`Input "${name}" holds a credential — it cannot be written to the database`)
  }
  return config
}

function countConditions(group: FilterGroup): number {
  return group.conditions.reduce((n, node) => n + (isFilterGroup(node) ? countConditions(node) : 1), 0)
}
