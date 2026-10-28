import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { getRetentionStatus } from '@/lib/retention-policies'
import {
  REPORT_SOURCES,
  DRILL_TARGETS,
  CHART_PALETTES,
  buildJoinedReportColumns,
  getReferenceReportSourceId,
  isReferenceReportSourceKey,
  type ReportConfig,
  type ReportFilter,
  type ReportJoinConfig,
  type ReportColumn,
  type ReportSource,
} from '@/lib/report-sources'
import { MCP_CORE_TOOL_DESCRIPTIONS } from '@/lib/mcp/descriptions'
import { fromMcpContext } from '@/lib/services/context'
import * as reportService from '@/lib/services/reports'
import { getDerivedReportColumnKeys, normalizeReportConfig } from '@/lib/report-config'
import { listTenantReportSources, resolveTenantReportSource } from '@/lib/report-source-registry'
import { executeReference } from '@/lib/reference-executor'

function parseJsonString<T>(value: string | undefined, fieldName: string): T | null | { error: string } {
  if (value == null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return { error: `${fieldName} must be a valid JSON string` }
  }
}

function summarizeReport(report: any) {
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    category: report.category,
    is_shared: report.is_shared,
    is_favorite: report.is_favorite,
    updated_at: report.updated_at,
    created_at: report.created_at,
    config: report.config,
  }
}

const MAX_RESULT_ROWS = 5000
const MAX_FILTER_VALUE_LENGTH = 1000

function splitTopLevelComma(value: string) {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of value) {
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function buildSelectClause(source: ReportSource, requiredKeys: string[]) {
  if (source.dynamic) return source.select

  const joinSpecs = new Map<string, string>()
  const baseFields = new Set(
    (source.columns ?? [])
      .map((column) => column?.key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0 && !key.includes('.')),
  )
  for (const part of splitTopLevelComma(source.select)) {
    const joinMatch = part.match(/^([a-zA-Z0-9_]+):([^,(]+(?:![^(,]+)?)\((.*)\)$/)
    if (!joinMatch) continue
    const [, alias, relationSpec] = joinMatch
    joinSpecs.set(alias, `${alias}:${relationSpec}`)
  }

  const selectedBaseFields = new Set<string>()
  const joinFields = new Map<string, Set<string>>()

  for (const key of requiredKeys) {
    if (!key || key === '_count') continue
    if (key.includes('.')) {
      const [alias, ...rest] = key.split('.')
      const field = rest.join('.')
      if (!alias || !field || !joinSpecs.has(alias)) continue
      if (!joinFields.has(alias)) joinFields.set(alias, new Set<string>())
      joinFields.get(alias)!.add(field)
      continue
    }
    if (baseFields.has(key)) {
      selectedBaseFields.add(key)
    }
  }

  const parts = [...selectedBaseFields]
  for (const [alias, fields] of joinFields.entries()) {
    if (fields.size === 0) continue
    const relationSpec = joinSpecs.get(alias)
    if (!relationSpec) continue
    parts.push(`${relationSpec}(${[...fields].join(', ')})`)
  }

  return parts.length > 0 ? parts.join(', ') : source.select
}

async function resolveSource(supabase: any, dataSource: string, tenantId: string): Promise<ReportSource | undefined> {
  return resolveTenantReportSource(supabase, tenantId, dataSource)
}

function isBaseFilterField(field: string) {
  return field.startsWith('data_') || !field.includes('.')
}

function compareValues(a: any, b: any) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const dateA = a != null ? new Date(a).getTime() : Number.NaN
  const dateB = b != null ? new Date(b).getTime() : Number.NaN
  if (!Number.isNaN(dateA) && !Number.isNaN(dateB)) return dateA - dateB
  return String(a ?? '').localeCompare(String(b ?? ''))
}

function matchesFilterValue(value: any, filter: ReportFilter) {
  switch (filter.operator) {
    case 'eq': return value === filter.value
    case 'neq': return value !== filter.value
    case 'gt': return compareValues(value, filter.value) > 0
    case 'lt': return compareValues(value, filter.value) < 0
    case 'gte': return compareValues(value, filter.value) >= 0
    case 'lte': return compareValues(value, filter.value) <= 0
    case 'like':
    case 'ilike':
      return String(value ?? '').toLowerCase().includes(String(filter.value ?? '').toLowerCase())
    case 'in':
      return Array.isArray(filter.value) ? filter.value.includes(value) : [filter.value].includes(value)
    case 'is_null':
      return value == null || value === ''
    case 'is_not_null':
      return value != null && value !== ''
    default:
      return true
  }
}

function flattenDynamicRows(source: ReportSource, rows: any[]) {
  return rows.map((row: any) => {
    const flat: Record<string, any> = {
      id: row.id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
    const rowData = row.data ?? {}
    for (const col of source.columns) {
      if (col.key.startsWith('data_')) {
        flat[col.key] = rowData[col.key.replace('data_', '')] ?? null
      }
    }
    return flat
  })
}

function normalizeReferenceInputValues(inputValues?: Record<string, any>) {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(inputValues ?? {})) {
    if (value == null) continue
    normalized[key] = typeof value === 'string'
      ? value
      : JSON.stringify(value)
  }
  return normalized
}

function normalizeReferenceResultRows(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') {
    return payload == null ? [] : [{ value: payload }]
  }

  const candidates = ['rows', 'data', 'documents', 'items', 'value', 'results', 'records']
  for (const key of candidates) {
    if (Array.isArray(payload[key])) return payload[key]
  }

  return [payload]
}

function normalizeReferenceRow(row: any) {
  if (row == null) return {}
  if (typeof row !== 'object' || Array.isArray(row)) return { value: row }
  return row
}

async function executeReferenceSourceRows(
  supabase: any,
  tenantId: string,
  source: ReportSource,
  sourceInputs?: Record<string, any>,
) {
  const referenceId = getReferenceReportSourceId(source.key)
  if (!referenceId) throw new Error(`Invalid reference source key: ${source.key}`)

  const result = await executeReference({
    supabase,
    referenceId,
    inputValues: normalizeReferenceInputValues(sourceInputs),
    expectedTenantId: tenantId,
  })

  if (result.status >= 400) {
    const message = typeof result.data?.message === 'string'
      ? result.data.message
      : typeof result.data?.error === 'string'
        ? result.data.error
        : `Reference returned HTTP ${result.status}`
    throw new Error(message)
  }

  return normalizeReferenceResultRows(result.data).map(normalizeReferenceRow)
}

function inferRuntimeColumns(rows: any[], existingColumns: ReportColumn[]) {
  const next = [...existingColumns]
  const seen = new Set(existingColumns.map((column) => column.key))
  const sample = rows.find((row) => row && typeof row === 'object' && !Array.isArray(row))
  if (!sample) return next

  for (const [key, value] of Object.entries(sample)) {
    if (seen.has(key) || value == null || typeof value === 'object') continue
    next.push({
      key,
      label: key.replace(/^data_/, '').replace(/[._]+/g, ' '),
      type: typeof value === 'number'
        ? 'number'
        : typeof value === 'boolean'
          ? 'boolean'
          : (Number.isNaN(new Date(String(value)).getTime()) ? 'text' : 'date'),
    })
    seen.add(key)
  }
  return next
}

function getValue(row: any, key: string) {
  return key.split('.').reduce((acc, part) => acc?.[part], row)
}

async function fetchJoinRows(
  supabase: any,
  source: ReportSource,
  sourceKey: string,
  tenantId: string,
  foreignField: string,
  requestedColumns: string[],
  lookupValues: any[],
  sourceInputs?: Record<string, any>,
) {
  const uniqueLookupValues = Array.from(new Set(lookupValues.filter((value) => value != null && value !== '')))
  if (uniqueLookupValues.length === 0) return []

  if (source.dynamic && source.table === 'custom_table_rows') {
    const tableId = sourceKey.replace('custom_table_', '')
    const { data, error } = await (supabase as any)
      .from('custom_table_rows')
      .select('*')
      .eq('table_id', tableId)
      .eq('tenant_id', tenantId)
      .limit(MAX_RESULT_ROWS)
    if (error) throw new Error(error.message)
    const flattened = flattenDynamicRows(source, data ?? [])
    return flattened.filter((row) => uniqueLookupValues.includes(getValue(row, foreignField)))
  }

  if (isReferenceReportSourceKey(source.key)) {
    const rows = await executeReferenceSourceRows(supabase, tenantId, source, sourceInputs)
    return rows.filter((row) => uniqueLookupValues.includes(getValue(row, foreignField)))
  }

  const requiredKeys = Array.from(new Set([foreignField, ...requestedColumns].filter(Boolean)))
  let query = (supabase as any)
    .from(source.table)
    .select(buildSelectClause(source, requiredKeys))
    .limit(MAX_RESULT_ROWS)

  if (source.table === 'tasks') {
    query = query.is('deleted_at', null)
  }

  if (!foreignField.includes('.')) {
    query = query.in(foreignField, uniqueLookupValues)
  }

  if (!source.dynamic) {
    query = query.eq('tenant_id', tenantId)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

async function applyReportJoins(
  supabase: any,
  tenantId: string,
  rows: any[],
  joins: ReportJoinConfig[],
  allSources: ReportSource[],
) {
  let result = [...rows]

  for (const join of joins) {
    if (!join?.source || !join?.alias || !join?.local_field || !join?.foreign_field) continue
    const targetSource = allSources.find((source) => source.key === join.source)
    if (!targetSource) continue

    const localValues = result.map((row) => getValue(row, join.local_field))
    const targetRows = await fetchJoinRows(
      supabase,
      targetSource,
      join.source,
      tenantId,
      join.foreign_field,
      join.columns ?? [],
      localValues,
      join.source_inputs,
    )

    const targetMap = new Map<any, any>()
    for (const row of targetRows) {
      const key = getValue(row, join.foreign_field)
      if (key != null && !targetMap.has(key)) targetMap.set(key, row)
    }

    result = result
      .map((row) => {
        const localValue = getValue(row, join.local_field)
        const matched = targetMap.get(localValue)
        if (!matched) {
          if (join.join_type === 'inner') return null
          return { ...row, [join.alias]: null }
        }
        const nested: Record<string, any> = {}
        for (const columnKey of join.columns ?? []) {
          nested[columnKey] = getValue(matched, columnKey)
        }
        if (!Object.prototype.hasOwnProperty.call(nested, join.foreign_field)) {
          nested[join.foreign_field] = getValue(matched, join.foreign_field)
        }
        return { ...row, [join.alias]: nested }
      })
      .filter(Boolean)
  }

  return result
}

function normalizeJoins(rawJoins: unknown): ReportJoinConfig[] {
  return Array.isArray(rawJoins)
    ? rawJoins
      .filter((join): join is Record<string, any> => !!join && typeof join === 'object')
      .map((join) => ({
        id: typeof join.id === 'string' ? join.id : undefined,
        source: String(join.source ?? ''),
        alias: String(join.alias ?? '').trim(),
        local_field: String(join.local_field ?? ''),
        foreign_field: String(join.foreign_field ?? ''),
        columns: Array.isArray(join.columns) ? join.columns.filter((value): value is string => typeof value === 'string') : [],
        join_type: (join.join_type === 'inner' ? 'inner' : 'left') as 'inner' | 'left',
        source_inputs: join.source_inputs && typeof join.source_inputs === 'object' && !Array.isArray(join.source_inputs)
          ? join.source_inputs
          : undefined,
      }))
      .filter((join) => Boolean(join.source && join.alias && join.local_field && join.foreign_field))
    : []
}

export async function executeReportPreview(
  supabase: any,
  tenantId: string,
  config: Partial<ReportConfig>,
  scopedTableIds?: string[] | null,
) {
  config = normalizeReportConfig(config)
  const dataSource = String(config.data_source ?? '')
  if (!dataSource) throw new Error('config.data_source is required')

  const source = await resolveSource(supabase, dataSource, tenantId)
  if (!source) throw new Error(`Unknown data source: ${dataSource}`)

  if (source.virtual && source.key === 'retention_policy_assignments') {
    const allowedKeys = new Set(source.columns.map((column) => column.key))
    let rows = await buildRetentionPolicyAssignmentRows(supabase, tenantId)

    const safeFilters = Array.isArray(config.filters)
      ? (config.filters as ReportFilter[]).filter((filter) => filter?.field && allowedKeys.has(filter.field))
      : []
    if (safeFilters.length > 0) {
      rows = rows.filter((row: any) => safeFilters.every((filter) => matchesFilterValue(getValue(row, filter.field), filter)))
    }

    if (config.date_range?.field && allowedKeys.has(config.date_range.field)) {
      rows = rows.filter((row: any) => {
        const value = getValue(row, config.date_range!.field)
        if (value == null || value === '') return false
        const timestamp = new Date(value).getTime()
        if (Number.isNaN(timestamp)) return false
        if (config.date_range?.from && timestamp < new Date(config.date_range.from).getTime()) return false
        if (config.date_range?.to && timestamp > new Date(config.date_range.to).getTime()) return false
        return true
      })
    }

    if (config.sort?.field && allowedKeys.has(config.sort.field)) {
      rows = [...rows].sort((left, right) => {
        const comparison = compareValues(getValue(left, config.sort!.field), getValue(right, config.sort!.field))
        return config.sort?.direction === 'asc' ? comparison : -comparison
      })
    } else {
      rows = [...rows].sort((left, right) => compareValues(getValue(left, source.defaultSort.field), getValue(right, source.defaultSort.field)))
    }

    return {
      source,
      data: rows.slice(0, Math.min(Math.max(1, Number(config.row_limit) || 1000), MAX_RESULT_ROWS)),
      total: rows.length,
      available_columns: source.columns,
      joins: [] as ReportJoinConfig[],
    }
  }

  const normalizedJoins = normalizeJoins(config.joins)
  const joinSources = await Promise.all(normalizedJoins.map((join) => resolveSource(supabase, join.source, tenantId)))
  const allSources = [source, ...joinSources.filter(Boolean) as ReportSource[]]
  const allColumns = buildJoinedReportColumns(source.columns, normalizedJoins, allSources)
  const allowedKeys = new Set(allColumns.map((column) => column.key))
  const derivedKeys = getDerivedReportColumnKeys(config)
  const dynamicSeedKeys = new Set<string>([...derivedKeys])
  if (source.schemaFlexible) {
    for (const key of config.columns ?? []) if (typeof key === 'string') dynamicSeedKeys.add(key)
    for (const filter of config.filters ?? []) if (typeof filter?.field === 'string') dynamicSeedKeys.add(filter.field)
    for (const key of config.group_by ?? []) if (typeof key === 'string') dynamicSeedKeys.add(key)
    for (const aggregation of config.aggregations ?? []) if (typeof aggregation?.field === 'string') dynamicSeedKeys.add(aggregation.field)
    if (typeof config.sort?.field === 'string') dynamicSeedKeys.add(config.sort.field)
    if (typeof config.date_range?.field === 'string') dynamicSeedKeys.add(config.date_range.field)
  }
  for (const join of normalizedJoins) {
    const joinSource = allSources.find((candidate) => candidate.key === join.source)
    if (!joinSource?.schemaFlexible) continue
    for (const column of join.columns ?? []) dynamicSeedKeys.add(`${join.alias}.${column}`)
  }
  const selectableKeys = new Set([...allowedKeys, ...dynamicSeedKeys])

  const selectedColumns = Array.isArray(config.columns)
    ? config.columns.filter((column): column is string => typeof column === 'string' && selectableKeys.has(column))
    : []

  const requiredColumns = new Set<string>(selectedColumns)
  if (Array.isArray(config.filters)) {
    for (const filter of config.filters) {
      if (filter?.field && typeof filter.field === 'string' && allowedKeys.has(filter.field) && isBaseFilterField(filter.field)) {
        requiredColumns.add(filter.field)
      }
    }
  }
  if (config.sort?.field && allowedKeys.has(config.sort.field) && isBaseFilterField(config.sort.field)) {
    requiredColumns.add(config.sort.field)
  }
  if (config.date_range?.field && allowedKeys.has(config.date_range.field) && isBaseFilterField(config.date_range.field)) {
    requiredColumns.add(config.date_range.field)
  }
  if (Array.isArray(config.group_by)) {
    for (const groupField of config.group_by) {
      if (typeof groupField === 'string' && allowedKeys.has(groupField) && isBaseFilterField(groupField)) requiredColumns.add(groupField)
    }
  }
  if (Array.isArray(config.aggregations)) {
    for (const aggregation of config.aggregations) {
      if (aggregation?.field && typeof aggregation.field === 'string' && allowedKeys.has(aggregation.field) && isBaseFilterField(aggregation.field)) {
        requiredColumns.add(aggregation.field)
      }
    }
  }

  const limit = Math.min(Math.max(1, Number(config.row_limit) || 1000), MAX_RESULT_ROWS)
  let result: any[] = []

  if (isReferenceReportSourceKey(source.key)) {
    result = await executeReferenceSourceRows(supabase, tenantId, source, config.source_inputs)
  } else {
    let query = (supabase as any).from(source.table).select(buildSelectClause(source, [...requiredColumns]))

    if (source.dynamic && source.table === 'custom_table_rows') {
      const tableId = dataSource.replace('custom_table_', '')
      // Honor the API key's table scope, consistent with data_rows_*: an empty
      // scope allows all, a non-empty scope must include this table.
      if (Array.isArray(scopedTableIds) && scopedTableIds.length > 0 && !scopedTableIds.includes(tableId)) {
        throw new Error('This API key is not allowed to access that table')
      }
      query = query.eq('table_id', tableId)
    }
    if (source.table === 'tasks') {
      query = query.is('deleted_at', null)
    }
    if (!source.dynamic) {
      query = query.eq('tenant_id', tenantId)
    }

    for (const filter of source.baseFilters ?? []) {
      const col = filter.field.startsWith('data_') ? `data->>${filter.field.replace('data_', '')}` : filter.field
      switch (filter.operator) {
        case 'eq': query = query.eq(col, filter.value); break
        case 'neq': query = query.neq(col, filter.value); break
        case 'gt': query = query.gt(col, filter.value); break
        case 'lt': query = query.lt(col, filter.value); break
        case 'gte': query = query.gte(col, filter.value); break
        case 'lte': query = query.lte(col, filter.value); break
        case 'like': query = query.like(col, `%${filter.value}%`); break
        case 'ilike': query = query.ilike(col, `%${filter.value}%`); break
        case 'in': query = query.in(col, Array.isArray(filter.value) ? filter.value : [filter.value]); break
        case 'is_null': query = query.is(col, null); break
        case 'is_not_null': query = query.not(col, 'is', null); break
      }
    }

    for (const filter of Array.isArray(config.filters) ? config.filters : []) {
      if (!filter?.field || typeof filter.field !== 'string') continue
      if (filter.value && typeof filter.value === 'string' && filter.value.length > MAX_FILTER_VALUE_LENGTH) continue
      if (!isBaseFilterField(filter.field)) continue

      const baseKey = filter.field.split('.')[0]
      const isDataCol = filter.field.startsWith('data_')
      const col = isDataCol
        ? `data->>${filter.field.replace('data_', '')}`
        : filter.field.includes('.') ? filter.field.split('.')[0] : filter.field

      if (!isDataCol && !allowedKeys.has(filter.field) && !allowedKeys.has(baseKey)) continue

      switch (filter.operator) {
        case 'eq': query = query.eq(col, filter.value); break
        case 'neq': query = query.neq(col, filter.value); break
        case 'gt': query = query.gt(col, filter.value); break
        case 'lt': query = query.lt(col, filter.value); break
        case 'gte': query = query.gte(col, filter.value); break
        case 'lte': query = query.lte(col, filter.value); break
        case 'like': query = query.like(col, `%${filter.value}%`); break
        case 'ilike': query = query.ilike(col, `%${filter.value}%`); break
        case 'in': query = query.in(col, Array.isArray(filter.value) ? filter.value : [filter.value]); break
        case 'is_null': query = query.is(col, null); break
        case 'is_not_null': query = query.not(col, 'is', null); break
      }
    }

    if (config.date_range?.field && allowedKeys.has(config.date_range.field) && isBaseFilterField(config.date_range.field)) {
      const drCol = config.date_range.field.startsWith('data_')
        ? `data->>${config.date_range.field.replace('data_', '')}`
        : config.date_range.field
      if (config.date_range.from) query = query.gte(drCol, config.date_range.from)
      if (config.date_range.to) query = query.lte(drCol, config.date_range.to)
    }

    if (config.sort?.field && allowedKeys.has(config.sort.field) && isBaseFilterField(config.sort.field)) {
      const sortCol = config.sort.field.startsWith('data_')
        ? `data->>${config.sort.field.replace('data_', '')}`
        : config.sort.field.split('.')[0]
      query = query.order(sortCol, { ascending: config.sort.direction === 'asc' })
    } else {
      query = query.order(source.defaultSort.field, { ascending: source.defaultSort.direction === 'asc' })
    }

    query = query.limit(limit)

    const { data, error } = await query
    if (error) {
      const detail = [error.message, error.details, error.hint].filter(Boolean).join(' — ')
      throw new Error(detail || 'Query failed')
    }

    result = data ?? []
    if (source.dynamic && source.table === 'custom_table_rows') {
      result = flattenDynamicRows(source, result)
    }
  }

  if (normalizedJoins.length > 0) {
    result = await applyReportJoins(supabase, tenantId, result, normalizedJoins, allSources)
  }

  const clientSideFilters = Array.isArray(config.filters)
    ? config.filters.filter((filter) => filter?.field && selectableKeys.has(filter.field) && (!allowedKeys.has(filter.field) || !isBaseFilterField(filter.field)))
    : []

  if (config.date_range?.field && allowedKeys.has(config.date_range.field) && !isBaseFilterField(config.date_range.field)) {
    result = result.filter((row: any) => {
      const value = getValue(row, config.date_range!.field)
      if (value == null || value === '') return false
      const timestamp = new Date(value).getTime()
      if (Number.isNaN(timestamp)) return false
      if (config.date_range?.from && timestamp < new Date(config.date_range.from).getTime()) return false
      if (config.date_range?.to && timestamp > new Date(config.date_range.to).getTime()) return false
      return true
    })
  }

  if (Array.isArray(config.group_by) && config.group_by.length && Array.isArray(config.aggregations) && config.aggregations.length) {
    const validGroupBy = config.group_by.filter((groupField) => typeof groupField === 'string' && allowedKeys.has(groupField))
    const validAggs = config.aggregations.filter((aggregation) => {
      if (!aggregation || typeof aggregation.fn !== 'string') return false
      if (aggregation.fn === 'COUNT') return true
      return Boolean(aggregation.field && typeof aggregation.field === 'string' && aggregation.field.trim().length > 0)
    })

    if (validGroupBy.length > 0) {
      const groups = new Map<string, any[]>()
      for (const row of result) {
        const key = validGroupBy.map((groupField) => getValue(row, groupField)).join('|||')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(row)
      }
      result = [...groups.entries()].slice(0, limit).map(([key, rows]) => {
        const keyParts = key.split('|||')
        const grouped: Record<string, any> = {}
        validGroupBy.forEach((groupField, index) => { grouped[groupField] = keyParts[index] })
        for (const aggregation of validAggs) {
          const aggKey = aggregation.field ? `${aggregation.fn}_${aggregation.field}` : `${aggregation.fn}`
          if (aggregation.fn === 'COUNT') {
            grouped[aggKey] = rows.length
            continue
          }
          const values = rows
            .map((row) => Number(getValue(row, aggregation.field)))
            .filter((value) => !Number.isNaN(value))
          switch (aggregation.fn) {
            case 'SUM': grouped[aggKey] = values.reduce((sum, value) => sum + value, 0); break
            case 'AVG': grouped[aggKey] = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0; break
            case 'MIN': grouped[aggKey] = values.length ? Math.min(...values) : 0; break
            case 'MAX': grouped[aggKey] = values.length ? Math.max(...values) : 0; break
          }
        }
        grouped._count = rows.length
        return grouped
      })
    }
  }

  if (clientSideFilters.length > 0) {
    result = result.filter((row: any) => clientSideFilters.every((filter) => matchesFilterValue(getValue(row, filter.field), filter)))
  }

  if (isReferenceReportSourceKey(source.key)) {
    const baseFilters = Array.isArray(config.filters)
      ? config.filters.filter((filter) => filter?.field && isBaseFilterField(filter.field))
      : []
    if (baseFilters.length > 0) {
      result = result.filter((row: any) => baseFilters.every((filter) => matchesFilterValue(getValue(row, filter.field), filter)))
    }

    if (config.date_range?.field && isBaseFilterField(config.date_range.field)) {
      result = result.filter((row: any) => {
        const value = getValue(row, config.date_range!.field)
        if (value == null || value === '') return false
        const timestamp = new Date(value).getTime()
        if (Number.isNaN(timestamp)) return false
        if (config.date_range?.from && timestamp < new Date(config.date_range.from).getTime()) return false
        if (config.date_range?.to && timestamp > new Date(config.date_range.to).getTime()) return false
        return true
      })
    }

    if (config.sort?.field && isBaseFilterField(config.sort.field)) {
      result = [...result].sort((left, right) => {
        const comparison = compareValues(getValue(left, config.sort!.field), getValue(right, config.sort!.field))
        return config.sort?.direction === 'asc' ? comparison : -comparison
      })
    } else {
      result = [...result].sort((left, right) => compareValues(getValue(left, source.defaultSort.field), getValue(right, source.defaultSort.field)))
    }
  }

  if (config.sort?.field && selectableKeys.has(config.sort.field) && (!allowedKeys.has(config.sort.field) || !isBaseFilterField(config.sort.field))) {
    result = [...result].sort((left, right) => {
      const comparison = compareValues(getValue(left, config.sort!.field), getValue(right, config.sort!.field))
      return config.sort?.direction === 'asc' ? comparison : -comparison
    })
  }

  return {
    source,
    data: result.slice(0, limit),
    total: result.length,
    available_columns: inferRuntimeColumns(result, allColumns),
    joins: normalizedJoins,
  }
}

function summarizeSource(source: ReportSource) {
  return {
    key: source.key,
    label: source.label,
    description: source.description,
    category: source.category,
    dynamic: Boolean(source.dynamic),
    virtual: Boolean(source.virtual),
    schema_flexible: Boolean(source.schemaFlexible),
    default_sort: source.defaultSort,
    columns: source.columns,
  }
}

export function buildSourceSpecificRecipes(source: ReportSource) {
  const has = (key: string) => source.columns.some((column) => column.key === key)
  const firstKey = source.columns[0]?.key ?? 'id'

  switch (source.key) {
    case 'workflow_runs':
      return [
        {
          name: 'Recent workflow runs',
          goal: 'List the most recent workflow executions with status and timing.',
          config: {
            data_source: 'workflow_runs',
            columns: ['id', 'title', 'status', 'workflow.name', 'started_at', 'completed_at'].filter(has),
            visualization: 'table',
            sort: { field: has('started_at') ? 'started_at' : firstKey, direction: 'desc' },
          },
        },
        {
          name: 'Runs by status',
          goal: 'Count workflow runs by status for an operational dashboard.',
          config: {
            data_source: 'workflow_runs',
            columns: ['status', 'COUNT_id'].filter((key) => key === 'COUNT_id' || has(key)),
            group_by: ['status'].filter(has),
            aggregations: has('id') ? [{ field: 'id', fn: 'COUNT' }] : [],
            visualization: 'bar',
            sort: { field: 'COUNT_id', direction: 'desc' },
          },
        },
      ]
    case 'tasks':
      return [
        {
          name: 'Open tasks',
          goal: 'Show active tasks with assignee and due date.',
          config: {
            data_source: 'tasks',
            columns: ['title', 'status', 'priority', 'assignee.display_name', 'due_date'].filter(has),
            filters: [{ field: 'status', operator: 'neq', value: 'completed' }].filter((filter) => has(filter.field)),
            visualization: 'table',
            sort: { field: has('due_date') ? 'due_date' : firstKey, direction: 'asc' },
          },
        },
        {
          name: 'Tasks by priority',
          goal: 'Count tasks by priority for workload monitoring.',
          config: {
            data_source: 'tasks',
            columns: ['priority', 'COUNT_id'].filter((key) => key === 'COUNT_id' || has(key)),
            group_by: ['priority'].filter(has),
            aggregations: has('id') ? [{ field: 'id', fn: 'COUNT' }] : [],
            visualization: 'bar',
            sort: { field: 'COUNT_id', direction: 'desc' },
          },
        },
      ]
    case 'business_rule_executions':
      return [
        {
          name: 'Recent business rule executions',
          goal: 'Inspect recent business rule executions with workflow and matched rule details.',
          config: {
            data_source: 'business_rule_executions',
            columns: ['metadata.decision_table_name', 'metadata.rule_label', 'workflow.name', 'run.status', 'created_at'].filter(has),
            visualization: 'table',
            sort: { field: has('created_at') ? 'created_at' : firstKey, direction: 'desc' },
          },
        },
        {
          name: 'Executions by business rule',
          goal: 'Count how many times each business rule executed.',
          config: {
            data_source: 'business_rule_executions',
            columns: ['metadata.decision_table_name', 'COUNT_id'].filter((key) => key === 'COUNT_id' || has(key)),
            group_by: ['metadata.decision_table_name'].filter(has),
            aggregations: has('id') ? [{ field: 'id', fn: 'COUNT' }] : [],
            visualization: 'bar',
            sort: { field: 'COUNT_id', direction: 'desc' },
          },
        },
      ]
    case 'retention_policy_assignments':
      return [
        {
          name: 'Retention coverage',
          goal: 'List assets covered by retention policies with current status.',
          config: {
            data_source: 'retention_policy_assignments',
            columns: ['asset_name', 'retention_policy_name', 'target_type', 'retention_status', 'next_review_date', 'next_execution_date'].filter(has),
            visualization: 'table',
            sort: { field: has('asset_name') ? 'asset_name' : firstKey, direction: 'asc' },
          },
        },
        {
          name: 'Coverage by retention policy',
          goal: 'Count how many assets are assigned to each retention policy.',
          config: {
            data_source: 'retention_policy_assignments',
            columns: ['retention_policy_name', 'COUNT_id'].filter((key) => key === 'COUNT_id' || has(key)),
            group_by: ['retention_policy_name'].filter(has),
            aggregations: has('id') ? [{ field: 'id', fn: 'COUNT' }] : [],
            visualization: 'bar',
            sort: { field: 'COUNT_id', direction: 'desc' },
          },
        },
      ]
    default:
      return [
        {
          name: 'Starter table',
          goal: 'Start with a simple table report using the source default sort.',
          config: {
            data_source: source.key,
            columns: source.columns.slice(0, Math.min(5, source.columns.length)).map((column) => column.key),
            visualization: 'table',
            sort: source.defaultSort,
          },
        },
      ]
  }
}

function buildStaticSelectableReportKeys(config: Partial<ReportConfig>) {
  const sourceKey = String(config.data_source ?? '')
  const dynamicPlaceholder = (key: string): ReportSource | null => {
    if (key.startsWith('custom_table_') || isReferenceReportSourceKey(key)) {
      return {
        key,
        table: '__dynamic__',
        label: key,
        category: 'Dynamic',
        columns: [],
        defaultSort: { field: 'id', direction: 'asc' },
        select: '*',
        dynamic: true,
        schemaFlexible: true,
      }
    }
    return null
  }

  const source = REPORT_SOURCES.find((candidate) => candidate.key === sourceKey) ?? dynamicPlaceholder(sourceKey)
  if (!source) {
    return {
      source: null as ReportSource | null,
      joinedColumns: [] as any[],
      selectableKeys: new Set<string>(),
      allowedKeys: new Set<string>(),
    }
  }

  const joins = normalizeJoins(config.joins).filter((join) => REPORT_SOURCES.some((candidate) => candidate.key === join.source) || isReferenceReportSourceKey(join.source) || join.source.startsWith('custom_table_'))
  const joinSources = joins
    .map((join) => REPORT_SOURCES.find((candidate) => candidate.key === join.source) ?? dynamicPlaceholder(join.source))
    .filter((candidate): candidate is ReportSource => Boolean(candidate))
  const joinedColumns = buildJoinedReportColumns(source.columns, joins, [source, ...joinSources])
  const allowedKeys = new Set(joinedColumns.map((column) => column.key))
  if (source.schemaFlexible) {
    for (const key of config.columns ?? []) if (typeof key === 'string') allowedKeys.add(key)
    for (const filter of config.filters ?? []) if (typeof filter?.field === 'string') allowedKeys.add(filter.field)
    for (const key of config.group_by ?? []) if (typeof key === 'string') allowedKeys.add(key)
    for (const aggregation of config.aggregations ?? []) if (typeof aggregation?.field === 'string') allowedKeys.add(aggregation.field)
    if (typeof config.sort?.field === 'string') allowedKeys.add(config.sort.field)
    if (typeof config.date_range?.field === 'string') allowedKeys.add(config.date_range.field)
  }
  for (const join of joins) {
    const joinSource = joinSources.find((candidate) => candidate.key === join.source)
    if (!joinSource?.schemaFlexible) continue
    for (const column of join.columns ?? []) allowedKeys.add(`${join.alias}.${column}`)
  }
  const derivedKeys = getDerivedReportColumnKeys(config)
  const selectableKeys = new Set([...allowedKeys, ...derivedKeys])

  return { source, joinedColumns, selectableKeys, allowedKeys }
}

export function inspectReportConfigIssues(raw: unknown) {
  const config = normalizeReportConfig(raw)
  const issues: string[] = []
  const sourceKey = String(config.data_source ?? '').trim()

  if (!sourceKey) {
    issues.push('data_source is missing')
    return { config, issues, source: null as ReportSource | null }
  }

  const { source, selectableKeys, allowedKeys } = buildStaticSelectableReportKeys(config)
  if (!source) {
    issues.push(`Unknown data source: ${sourceKey}`)
    return { config, issues, source: null as ReportSource | null }
  }

  if (!Array.isArray(config.columns) || config.columns.length === 0) {
    issues.push('No columns selected')
  }

  for (const column of config.columns ?? []) {
    if (typeof column === 'string' && /^[^.]+\._count$/i.test(column)) {
      issues.push(`Legacy aggregate alias still present: ${column}`)
    }
    if (!selectableKeys.has(column)) issues.push(`Unknown report column: ${column}`)
  }
  for (const filter of config.filters ?? []) {
    if (!filter?.field || !selectableKeys.has(filter.field)) issues.push(`Unknown filter field: ${filter?.field ?? 'unknown'}`)
  }
  if (config.sort?.field && !selectableKeys.has(config.sort.field)) issues.push(`Unknown sort field: ${config.sort.field}`)
  if (config.date_range?.field && !allowedKeys.has(config.date_range.field)) issues.push(`Unknown date_range field: ${config.date_range.field}`)
  for (const groupField of config.group_by ?? []) {
    if (!allowedKeys.has(groupField)) issues.push(`Unknown group_by field: ${groupField}`)
  }
  for (const aggregation of config.aggregations ?? []) {
    if (aggregation.fn !== 'COUNT' && aggregation.field && !allowedKeys.has(aggregation.field)) {
      issues.push(`Unknown aggregation field: ${aggregation.field}`)
    }
  }

  return { config, issues, source }
}

export function remediateReportConfig(raw: unknown) {
  const config = normalizeReportConfig(raw) as Partial<ReportConfig>
  const fixes: string[] = []
  const sourceKey = String(config.data_source ?? '').trim()
  const staticSource = REPORT_SOURCES.find((candidate) => candidate.key === sourceKey)

  if (!staticSource) {
    return { config, fixes }
  }

  const allowedJoinKeys = new Set(REPORT_SOURCES.map((candidate) => candidate.key))
  if (Array.isArray(config.joins)) {
    const nextJoins = normalizeJoins(config.joins).filter((join) => allowedJoinKeys.has(join.source))
    if (nextJoins.length !== config.joins.length) fixes.push('Dropped joins that referenced unknown sources')
    config.joins = nextJoins
  }

  const { source, selectableKeys, allowedKeys } = buildStaticSelectableReportKeys(config)
  if (!source) return { config, fixes }

  const validColumns = (config.columns ?? []).filter((column) => selectableKeys.has(column))
  if (validColumns.length !== (config.columns ?? []).length) {
    fixes.push('Removed invalid report columns')
  }
  config.columns = validColumns.length > 0
    ? validColumns
    : source.columns.slice(0, Math.min(5, source.columns.length)).map((column) => column.key)
  if (validColumns.length === 0) fixes.push('Seeded default report columns from the selected source')

  const validFilters = (config.filters ?? []).filter((filter) => filter?.field && selectableKeys.has(filter.field))
  if (validFilters.length !== (config.filters ?? []).length) {
    fixes.push('Removed invalid filters')
  }
  config.filters = validFilters

  const validGroupBy = (config.group_by ?? []).filter((field) => allowedKeys.has(field))
  if (validGroupBy.length !== (config.group_by ?? []).length) {
    fixes.push('Removed invalid group_by fields')
  }
  config.group_by = validGroupBy

  const validAggregations = (config.aggregations ?? []).filter((aggregation) => aggregation.fn === 'COUNT' || !aggregation.field || allowedKeys.has(aggregation.field))
  if (validAggregations.length !== (config.aggregations ?? []).length) {
    fixes.push('Removed invalid aggregations')
  }
  config.aggregations = validAggregations

  const selectableAfter = buildStaticSelectableReportKeys(config).selectableKeys
  if (!config.sort?.field || !selectableAfter.has(config.sort.field)) {
    config.sort = source.defaultSort ?? { field: config.columns[0] ?? source.columns[0]?.key ?? 'id', direction: 'asc' }
    fixes.push('Reset sort to a valid default field')
  }

  if (config.date_range?.field && !allowedKeys.has(config.date_range.field)) {
    delete config.date_range
    fixes.push('Removed invalid date_range field')
  }

  if (!config.visualization) {
    config.visualization = 'table'
    fixes.push('Defaulted visualization to table')
  }

  return { config, fixes }
}

async function validateReportConfig(supabase: any, tenantId: string, config: Partial<ReportConfig>) {
  config = normalizeReportConfig(config)
  const errors: string[] = []
  const warnings: string[] = []
  const sourceKey = String(config.data_source ?? '')
  if (!sourceKey) {
    errors.push('config.data_source is required')
    return { errors, warnings, source: null as ReportSource | null, joinedColumns: [] as any[] }
  }

  const source = await resolveSource(supabase, sourceKey, tenantId)
  if (!source) {
    errors.push(`Unknown data source: ${sourceKey}`)
    return { errors, warnings, source: null as ReportSource | null, joinedColumns: [] as any[] }
  }

  const joins = normalizeJoins(config.joins)
  const joinSources = await Promise.all(joins.map((join) => resolveSource(supabase, join.source, tenantId)))
  joins.forEach((join, index) => {
    if (!joinSources[index]) errors.push(`Unknown join source: ${join.source}`)
  })
  const allSources = [source, ...joinSources.filter(Boolean) as ReportSource[]]
  const joinedColumns = buildJoinedReportColumns(source.columns, joins, allSources)
  const allowedKeys = new Set(joinedColumns.map((column) => column.key))
  if (source.schemaFlexible) {
    for (const key of config.columns ?? []) if (typeof key === 'string') allowedKeys.add(key)
    for (const filter of config.filters ?? []) if (typeof filter?.field === 'string') allowedKeys.add(filter.field)
    for (const key of config.group_by ?? []) if (typeof key === 'string') allowedKeys.add(key)
    for (const aggregation of config.aggregations ?? []) if (typeof aggregation?.field === 'string') allowedKeys.add(aggregation.field)
    if (typeof config.sort?.field === 'string') allowedKeys.add(config.sort.field)
    if (typeof config.date_range?.field === 'string') allowedKeys.add(config.date_range.field)
  }
  joins.forEach((join, index) => {
    if (!joinSources[index]?.schemaFlexible) return
    for (const column of join.columns ?? []) allowedKeys.add(`${join.alias}.${column}`)
  })
  const derivedKeys = getDerivedReportColumnKeys(config)
  const selectableKeys = new Set([...allowedKeys, ...derivedKeys])

  for (const column of config.columns ?? []) {
    if (!selectableKeys.has(column)) errors.push(`Unknown report column: ${column}`)
  }
  for (const filter of config.filters ?? []) {
    if (!filter?.field || !selectableKeys.has(filter.field)) errors.push(`Unknown filter field: ${filter?.field ?? 'unknown'}`)
  }
  if (config.sort?.field && !selectableKeys.has(config.sort.field)) errors.push(`Unknown sort field: ${config.sort.field}`)
  if (config.date_range?.field && !allowedKeys.has(config.date_range.field)) errors.push(`Unknown date_range field: ${config.date_range.field}`)
  for (const groupField of config.group_by ?? []) {
    if (!allowedKeys.has(groupField)) errors.push(`Unknown group_by field: ${groupField}`)
  }
  for (const aggregation of config.aggregations ?? []) {
    if (aggregation.fn !== 'COUNT' && aggregation.field && !allowedKeys.has(aggregation.field)) {
      errors.push(`Unknown aggregation field: ${aggregation.field}`)
    }
  }

  if (!Array.isArray(config.columns) || config.columns.length === 0) {
    warnings.push('No explicit columns were provided; preview and saved reports may be harder for MCP consumers to reason about')
  }
  if (!config.visualization) {
    warnings.push('No visualization specified; defaulting to table is recommended for portable reports')
  }
  if ((config.joins?.length ?? 0) > 3) {
    warnings.push('This report uses several joins; preview before saving to ensure performance and expected row matching')
  }

  return { errors, warnings, source, joinedColumns }
}

function addRetentionInterval(baseAt: Date, value: number, unit: 'days' | 'months' | 'years') {
  const dueAt = new Date(baseAt)
  if (unit === 'days') dueAt.setDate(dueAt.getDate() + value)
  else if (unit === 'months') dueAt.setMonth(dueAt.getMonth() + value)
  else dueAt.setFullYear(dueAt.getFullYear() + value)
  return dueAt
}

function resolveRetentionDueDates(policy: any, appliedAt?: string | null, createdAt?: string | null) {
  if (!policy) return { nextReviewDate: null as string | null, nextExecutionDate: null as string | null }
  if ((policy.policy_mode === 'review_on_exact_date' || policy.policy_mode === 'purge_on_exact_date') && policy.exact_date) {
    return {
      nextReviewDate: policy.policy_mode === 'review_on_exact_date' ? new Date(policy.exact_date).toISOString() : null,
      nextExecutionDate: policy.policy_mode === 'purge_on_exact_date' ? new Date(policy.exact_date).toISOString() : null,
    }
  }
  const base = appliedAt ?? createdAt
  if (!base || !policy.duration_value || !policy.duration_unit) return { nextReviewDate: null, nextExecutionDate: null }
  const dueAt = addRetentionInterval(new Date(base), Number(policy.duration_value), policy.duration_unit)
  return {
    nextReviewDate: policy.policy_mode === 'review' ? dueAt.toISOString() : null,
    nextExecutionDate: policy.policy_mode === 'purge_on' ? dueAt.toISOString() : null,
  }
}

async function buildRetentionPolicyAssignmentRows(supabase: any, tenantId: string) {
  const [tables, rows, roles] = await Promise.all([
    (supabase as any)
      .from('custom_tables')
      .select('id, name, created_at, retention_applied_at, retention_policy_id, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date, applies_to)')
      .eq('tenant_id', tenantId)
      .not('retention_policy_id', 'is', null)
      .limit(5000),
    (supabase as any)
      .from('custom_table_rows')
      .select('id, data, created_at, retention_policy_id, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date, applies_to)')
      .eq('tenant_id', tenantId)
      .not('retention_policy_id', 'is', null)
      .limit(5000),
    (supabase as any)
      .from('roles')
      .select('id, name, created_at, retention_applied_at, retention_policy_id, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date, applies_to)')
      .eq('tenant_id', tenantId)
      .not('retention_policy_id', 'is', null)
      .limit(5000),
  ])

  const result: any[] = []
  const append = (targetType: string, record: any, assetName: string) => {
    const effective = {
      policy: Array.isArray(record?.retention_policy) ? record.retention_policy[0] : record?.retention_policy,
      appliedAt: record?.created_at ?? null,
      createdAt: record?.created_at ?? null,
      source: 'direct',
    }
    const policy = effective.policy
    if (!policy) return
    const dueDates = resolveRetentionDueDates(policy, effective.appliedAt ?? null, effective.createdAt ?? null)
    const retentionStatus = getRetentionStatus({
      policy,
      appliedAt: effective.appliedAt ?? null,
      createdAt: effective.createdAt ?? null,
    })
    result.push({
      id: `${targetType}:${record.id}`,
      target_type: targetType,
      target_id: record.id,
      asset_name: assetName,
      retention_policy_id: policy.id,
      retention_policy_name: policy.name,
      policy_mode: policy.policy_mode,
      applies_to: policy.applies_to ?? [],
      retention_applied_at: effective.appliedAt ?? null,
      created_at: effective.createdAt ?? null,
      retention_source: effective.source,
      next_review_date: dueDates.nextReviewDate,
      next_execution_date: dueDates.nextExecutionDate,
      retention_status: retentionStatus.label,
      retention_status_tone: retentionStatus.tone,
    })
  }

  for (const record of (tables.data ?? [])) append('data_table', record, record.name || `Table ${record.id}`)
  for (const record of (rows.data ?? [])) {
    const rowName = String(record?.data?.name ?? record?.data?.title ?? record?.data?.id ?? record.id)
    append('data_row', record, rowName)
  }
  for (const record of (roles.data ?? [])) append('role', record, record.name || `Role ${record.id}`)

  return result
}

export function registerReportTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx

  server.tool('reports_query', 'Query report data from any source with filters, grouping, and aggregation. This is useful for ad hoc analysis, but for saved custom reports prefer reports_preview plus reports_create so MCP can validate the exact config before saving.', {
    source: z.string().describe('Data source key (e.g. tasks, workflow_runs, agent_runs)'),
    filters: z.array(z.object({
      field: z.string(),
      operator: z.enum(['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'ilike']),
      value: z.string(),
    })).optional().describe('Filter conditions'),
    group_by: z.array(z.string()).optional().describe('Fields to group by'),
    aggregations: z.array(z.object({
      field: z.string(),
      fn: z.enum(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']),
    })).optional(),
    sort_field: z.string().optional(),
    sort_direction: z.enum(['asc', 'desc']).optional(),
    limit: z.number().optional(),
  }, async (args) => {
    try {
      const preview = await executeReportPreview(supabase, tenantId, {
        data_source: args.source,
        columns: [],
        filters: args.filters as any,
        group_by: args.group_by,
        aggregations: args.aggregations as any,
        visualization: 'table',
        sort: args.sort_field ? { field: args.sort_field, direction: args.sort_direction ?? 'asc' } : undefined,
        row_limit: Math.min(args.limit ?? 100, 200),
      }, ctx.scopes?.table_ids)
      return mcpOk({ data: preview.data, count: preview.total, source: args.source, available_columns: preview.available_columns })
    } catch (error: any) {
      return mcpErr(error?.message ?? 'Failed to query report source')
    }
  })

  server.tool('reports_sources_list', 'List available report data sources with the columns MCP can query. Use this before building a custom report so you can choose the right source and fields.', {
    include_columns: z.boolean().optional().describe('Include the full column metadata for each source'),
  }, async (args) => {
    const sources = (await listTenantReportSources(supabase, tenantId)).map((source) => ({
      key: source.key,
      label: source.label,
      description: source.description,
      category: source.category,
      dynamic: Boolean(source.dynamic),
      virtual: Boolean(source.virtual),
      schema_flexible: Boolean(source.schemaFlexible),
      default_sort: source.defaultSort,
      column_count: source.columns.length,
      columns: args.include_columns ? source.columns : undefined,
    }))
    return mcpOk({ sources })
  })

  server.tool('reports_source_get', 'Get a single report source with full column metadata, plus report-building helpers such as supported visualizations, chart palettes, and drill target templates. Use this to design a comprehensive custom report before saving it.', {
    source: z.string().describe('Report source key, e.g. tasks or retention_policy_reviews'),
  }, async (args) => {
    const source = await resolveSource(supabase, args.source, tenantId)
    if (!source) return mcpErr(`Unknown data source: ${args.source}`)
    return mcpOk({
      source: summarizeSource(source),
      source_inputs_supported: isReferenceReportSourceKey(source.key),
      supported_visualizations: ['table', 'bar', 'line', 'area', 'pie', 'radar', 'scatter', 'funnel', 'stacked-bar', 'horizontal-bar'],
      supported_filter_operators: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'like', 'ilike', 'in', 'is_null', 'is_not_null'],
      supported_aggregations: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'],
      chart_palettes: CHART_PALETTES,
      drill_targets: DRILL_TARGETS.filter((target) => target.source === source.key),
      join_guidance: {
        supported: true,
        instructions: isReferenceReportSourceKey(source.key)
          ? 'Reference-backed sources can also join, but the response schema may be discovered at runtime. Supply source_inputs when needed, choose a stable local_field/foreign_field pair, and list the joined columns you want returned under alias.column.'
          : 'Use joins to pull columns from another report source or custom table. Set local_field on the base source, foreign_field on the joined source, provide an alias, and list the joined columns you want returned under alias.column.',
      },
      aggregation_guidance: {
        instructions: 'Grouped report outputs use derived keys. COUNT on id becomes COUNT_id, SUM on amount becomes SUM_amount, and _count is the raw grouped row count. Do not prefix derived aggregate keys with the source name.',
      },
      examples: {
        raw_table: {
          data_source: source.key,
          columns: source.columns.slice(0, Math.min(5, source.columns.length)).map((column) => column.key),
          visualization: 'table',
          sort: source.defaultSort,
        },
        grouped_count: source.columns.some((column) => column.key === 'id')
          ? {
              data_source: source.key,
              columns: [source.columns[0]?.key ?? 'id', 'COUNT_id'],
              group_by: [source.columns[0]?.key ?? 'id'],
              aggregations: [{ field: 'id', fn: 'COUNT' }],
              visualization: 'bar',
              sort: { field: 'COUNT_id', direction: 'desc' },
            }
          : null,
        joined_report_pattern: {
          instructions: 'Only use joins when the base source does not already expose the needed joined column. Many built-in sources already include relation columns such as assignee.display_name.',
          shape: {
            data_source: source.key,
            columns: [source.columns[0]?.key ?? 'id'],
            joins: [{
              source: 'users',
              alias: 'joined_alias',
              local_field: 'created_by',
              foreign_field: 'id',
              columns: ['display_name'],
              join_type: 'left',
            }],
            visualization: 'table',
          },
        },
      },
      source_specific_recipes: buildSourceSpecificRecipes(source),
    })
  })

  server.tool('reports_preview', 'Validate and preview a full custom report configuration before saving it. Supports the same config shape as saved reports, including joins, filters, group_by, aggregations, date ranges, chart settings, and drill targets.', {
    config: z.string().describe('JSON string matching the saved report config shape, including data_source, columns, filters, joins, visualization, sort, date_range, row_limit, chart_style, and drill_target. For grouped reports, reference derived output keys such as COUNT_id in columns/sort instead of source-prefixed aliases like workflow_runs._count.'),
  }, async (args) => {
    const parsedConfig = parseJsonString<ReportConfig>(args.config, 'config')
    if (parsedConfig && 'error' in parsedConfig) return mcpErr(parsedConfig.error)
    const config = normalizeReportConfig(parsedConfig ?? {}) as ReportConfig

    const validation = await validateReportConfig(supabase, tenantId, config)
    if (validation.errors.length > 0) {
      return mcpErr(`Report config is invalid: ${validation.errors.join('; ')}`)
    }

    const preview = await executeReportPreview(supabase, tenantId, config, ctx.scopes?.table_ids)
    return mcpOk({
      preview: {
        source: summarizeSource(preview.source),
        total_rows: preview.total,
        returned_rows: preview.data.length,
        sample_rows: preview.data.slice(0, 25),
        columns: preview.available_columns,
        joins: preview.joins,
      },
      warnings: validation.warnings,
    })
  })

  server.tool('reports_remediate_config', MCP_CORE_TOOL_DESCRIPTIONS.reports_remediate_config, {
    config: z.string().describe('JSON string matching the report config shape. Pass draft or invalid configs here to get issue analysis plus a repaired config before preview or save.'),
  }, async (args) => {
    const parsedConfig = parseJsonString<ReportConfig>(args.config, 'config')
    if (parsedConfig && 'error' in parsedConfig) return mcpErr(parsedConfig.error)

    const before = inspectReportConfigIssues(parsedConfig ?? {})
    const remediation = remediateReportConfig(parsedConfig ?? {})
    const after = inspectReportConfigIssues(remediation.config)

    return mcpOk({
      remediated: remediation.fixes.length > 0,
      issues_before: before.issues,
      fixes: remediation.fixes,
      issues_after: after.issues,
      config: remediation.config,
    })
  })

  server.tool('reports_list', 'List saved custom reports that MCP can inspect or clone.', {
    limit: z.number().optional(),
  }, async (args) => {
    const { data, error } = await (supabase as any).from('reports')
      .select('id, name, description, category, is_shared, config, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false }).limit(Math.min(args.limit ?? 50, 200))
    if (error) return mcpErr(error.message)
    return mcpOk({ reports: data ?? [] })
  })

  server.tool('reports_get', 'Get a saved report with full configuration. Useful before updating or cloning a report through MCP.', {
    report_id: z.string().describe('Report ID'),
  }, async (args) => {
    const { data, error } = await (supabase as any).from('reports')
      .select('*')
      .eq('id', args.report_id)
      .eq('tenant_id', tenantId)
      .single()
    if (error || !data) return mcpErr('Report not found')
    return mcpOk({ report: summarizeReport(data) })
  })

  server.tool('reports_create', MCP_CORE_TOOL_DESCRIPTIONS.reports_create, {
    name: z.string().describe('Report name'),
    description: z.string().optional(),
    category: z.string().optional().describe('Report category'),
    config: z.string().describe('JSON string matching the full ReportConfig shape: data_source, columns, filters, joins, group_by, aggregations, calculated_columns, visualization, sort, date_range, row_limit, drill_target, and chart_style. Canonical grouped example: {"data_source":"workflow_runs","columns":["status","COUNT_id"],"group_by":["status"],"aggregations":[{"field":"id","fn":"COUNT"}],"visualization":"bar","sort":{"field":"COUNT_id","direction":"desc"}}'),
    is_shared: z.boolean().optional().describe('Whether the report is shared'),
  }, async (args) => {
    const parsedConfig = parseJsonString<ReportConfig>(args.config, 'config')
    if (parsedConfig && 'error' in parsedConfig) return mcpErr(parsedConfig.error)
    const config = normalizeReportConfig(parsedConfig ?? {}) as ReportConfig
    const validation = await validateReportConfig(supabase, tenantId, config)
    if (validation.errors.length > 0) {
      return mcpErr(`Report config is invalid: ${validation.errors.join('; ')}`)
    }

    const { data, error } = await (supabase as any).from('reports').insert({
      tenant_id: tenantId,
      name: args.name,
      description: args.description ?? null,
      category: args.category ?? null,
      config,
      is_shared: args.is_shared ?? false,
      created_by: ctx.actingUserId ?? null,
    }).select('*').single()
    if (error) return mcpErr(error.message)
    return mcpOk({ created: true, report: summarizeReport(data), warnings: validation.warnings })
  })

  server.tool('reports_update', 'Update a saved custom report. Config updates support the same full authoring model as reports_create, including joins and visual settings.', {
    report_id: z.string().describe('Report ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    config: z.string().optional().describe('JSON string matching the full ReportConfig shape'),
    is_shared: z.boolean().optional(),
  }, async (args) => {
    const updates: any = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.description !== undefined) updates.description = args.description
    if (args.is_shared !== undefined) updates.is_shared = args.is_shared
    if (args.config !== undefined) {
      const parsedConfig = parseJsonString<ReportConfig>(args.config, 'config')
      if (parsedConfig && 'error' in parsedConfig) return mcpErr(parsedConfig.error)
      const config = normalizeReportConfig(parsedConfig ?? {}) as ReportConfig
      const validation = await validateReportConfig(supabase, tenantId, config)
      if (validation.errors.length > 0) {
        return mcpErr(`Report config is invalid: ${validation.errors.join('; ')}`)
      }
      updates.config = config
      if (validation.warnings.length > 0) {
        updates._mcp_warnings = validation.warnings
      }
    }
    if (Object.keys(updates).length === 0) return mcpErr('No fields to update')
    const warnings = Array.isArray(updates._mcp_warnings) ? updates._mcp_warnings : []
    delete updates._mcp_warnings
    const { error } = await (supabase as any).from('reports').update(updates).eq('id', args.report_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ updated: true, report_id: args.report_id, warnings })
  })

  // Export / import are thin wrappers over lib/services/reports (import is audited there).
  server.tool('reports_export', 'Export a saved report as portable JSON so MCP can clone or recreate the report in another tenant.', {
    report_id: z.string().describe('Report ID'),
  }, async (args) => {
    try {
      return mcpOk({ exported: true, export: await reportService.exportReport(fromMcpContext(ctx), args.report_id) })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Report not found')
    }
  })

  server.tool('reports_import', 'Import a saved report from portable JSON. Useful when MCP is recreating a reporting layer entirely by prompt.', {
    import_json: z.string().describe('JSON string from reports_export or a compatible object with report.name, config, and optional metadata'),
    name_override: z.string().optional().describe('Optional replacement report name'),
  }, async (args) => {
    const parsed = parseJsonString<any>(args.import_json, 'import_json')
    if (parsed && 'error' in parsed) return mcpErr(parsed.error)
    try {
      const data = await reportService.importReport(fromMcpContext(ctx), { payload: parsed, name_override: args.name_override })
      return mcpOk({ imported: true, report: summarizeReport(data) })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Failed to import report')
    }
  })

  server.tool('reports_delete', 'Delete a saved report by ID.', {
    report_id: z.string().describe('Report ID'),
  }, async (args) => {
    const { error } = await (supabase as any).from('reports').delete().eq('id', args.report_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ deleted: true, report_id: args.report_id })
  })
}
