import type { ReportAggregation, ReportConfig } from '@/lib/report-sources'
import { isPlainObject } from '@/lib/utils/guards'

function normalizeAggregation(raw: unknown): ReportAggregation | null {
  if (!isPlainObject(raw)) return null
  const fn = String(raw.fn ?? '').trim().toUpperCase()
  if (!fn || !['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].includes(fn)) return null
  const field = typeof raw.field === 'string' ? raw.field.trim() : ''
  return {
    fn: fn as ReportAggregation['fn'],
    field,
  }
}

export function getReportAggregationKey(aggregation: Pick<ReportAggregation, 'fn' | 'field'>) {
  const normalizedField = typeof aggregation.field === 'string' ? aggregation.field.trim() : ''
  return normalizedField ? `${aggregation.fn}_${normalizedField}` : aggregation.fn
}

export function getDerivedReportColumnKeys(config: Partial<ReportConfig>) {
  const keys = new Set<string>()
  for (const aggregation of Array.isArray(config.aggregations) ? config.aggregations : []) {
    if (!aggregation || typeof aggregation.fn !== 'string') continue
    keys.add(getReportAggregationKey({
      fn: aggregation.fn,
      field: typeof aggregation.field === 'string' ? aggregation.field : '',
    }))
  }
  if ((config.group_by?.length ?? 0) > 0 || (config.aggregations?.length ?? 0) > 0) {
    keys.add('_count')
  }
  return keys
}

function resolveLegacyCountAlias(config: Partial<ReportConfig>) {
  const countAggregations = (Array.isArray(config.aggregations) ? config.aggregations : [])
    .filter((aggregation) => aggregation?.fn === 'COUNT')
  if (countAggregations.length === 1) {
    return getReportAggregationKey(countAggregations[0])
  }
  return countAggregations.length > 0 ? '_count' : null
}

function normalizeFieldReference(field: unknown, config: Partial<ReportConfig>) {
  if (typeof field !== 'string') return field
  const trimmed = field.trim()
  if (!trimmed) return trimmed
  if (trimmed === '_count') return trimmed
  if (/^[^.]+\._count$/i.test(trimmed)) {
    return resolveLegacyCountAlias(config) ?? '_count'
  }
  return trimmed
}

export function normalizeReportConfig(raw: unknown): Partial<ReportConfig> {
  if (!isPlainObject(raw)) return {}

  const next: Record<string, any> = { ...raw }
  if (!next.data_source && typeof next.source === 'string') next.data_source = next.source
  if (!next.visualization && typeof next.chart_type === 'string') next.visualization = next.chart_type
  if (!next.group_by && Array.isArray(next.groupBy)) next.group_by = next.groupBy
  if (!next.row_limit && typeof next.rowLimit === 'number') next.row_limit = next.rowLimit
  if (!next.date_range && isPlainObject(next.dateRange)) next.date_range = next.dateRange
  if (!next.drill_target && isPlainObject(next.drillTarget)) next.drill_target = next.drillTarget
  if (!next.chart_style && isPlainObject(next.chartStyle)) next.chart_style = next.chartStyle
  if (!next.sort && isPlainObject(next.sorting)) next.sort = next.sorting

  if (Array.isArray(next.aggregations)) {
    next.aggregations = next.aggregations
      .map((aggregation) => normalizeAggregation(aggregation))
      .filter((aggregation): aggregation is ReportAggregation => Boolean(aggregation))
  }

  const partialConfig = next as Partial<ReportConfig>

  if (Array.isArray(next.columns)) {
    next.columns = next.columns.map((column) => normalizeFieldReference(column, partialConfig))
  }
  if (Array.isArray(next.filters)) {
    next.filters = next.filters
      .filter((filter) => isPlainObject(filter))
      .map((filter) => ({
        ...filter,
        field: normalizeFieldReference(filter.field, partialConfig),
      }))
  }
  if (Array.isArray(next.group_by)) {
    next.group_by = next.group_by.map((field) => normalizeFieldReference(field, partialConfig))
  }
  if (isPlainObject(next.sort) && typeof next.sort.field === 'string') {
    next.sort = {
      ...next.sort,
      field: normalizeFieldReference(next.sort.field, partialConfig),
    }
  }
  if (isPlainObject(next.date_range) && typeof next.date_range.field === 'string') {
    next.date_range = {
      ...next.date_range,
      field: normalizeFieldReference(next.date_range.field, partialConfig),
    }
  }

  return next as Partial<ReportConfig>
}
