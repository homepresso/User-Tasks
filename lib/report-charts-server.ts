/**
 * Report summary charts, server side: each chart's series from the report's
 * own rows (lib/report-charts.ts has the spec and the bucketing).
 *
 * The rows come from the report query engine (executeReportPreview) with the
 * report's data source, source inputs, joins, filters and date range — so
 * the same source permissions (assertReportSourceAccess), API key table
 * scope and, for session callers, RLS — plus the chart's own filters and
 * "last N days" window, without the report's grouping or row limit. Charts
 * that read the same rows (same extra filters) share one read. Only the
 * compact series leave the server.
 */

import { executeReportPreview } from '@/lib/mcp/tools/reports'
import { normalizeReportConfig } from '@/lib/report-config'
import {
  REPORT_CHART_ROW_CAP, aggregateReportChart, chartFields, validTimeZone, windowStart,
  type ReportChartResult, type ReportChartSpec,
} from '@/lib/report-charts'
import { getReportValue, type ReportConfig, type ReportFilter } from '@/lib/report-sources'

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase clients are untyped here */

export interface ReportChartRunOptions {
  /** API key table scope (data tables). */
  scopedTableIds?: string[] | null
  /** The caller's permissions (service-role surfaces); null = RLS only (session client). */
  permissions?: Iterable<string> | null
  /** IANA zone for time buckets; invalid / missing → UTC. */
  timezone?: string | null
  now?: Date
  /** Rows a chart reads at most (tests). */
  rowCap?: number
}

/** The filters a chart adds to the report's: its own, then its "last N days" window. */
export function chartExtraFilters(spec: ReportChartSpec, tz: string, now: Date): ReportFilter[] {
  const extra: ReportFilter[] = (spec.filters ?? []).map((f) => ({ field: f.field, operator: f.operator, value: f.value }))
  const windowField = spec.range_days ? (spec.type === 'number' ? spec.window_field : spec.dimension?.field) : undefined
  if (spec.range_days && windowField) extra.push({ field: windowField, operator: 'gte', value: windowStart(spec.range_days, tz, now) })
  return extra
}

/** Every summary chart of a config, aggregated. Empty when the config has none. */
export async function executeReportCharts(
  supabase: any,
  tenantId: string,
  rawConfig: Partial<ReportConfig>,
  options: ReportChartRunOptions = {},
): Promise<ReportChartResult[]> {
  const config = normalizeReportConfig(rawConfig)
  const charts = config.charts ?? []
  if (!charts.length) return []
  const tz = validTimeZone(options.timezone) ?? 'UTC'
  const now = options.now ?? new Date()
  const cap = Math.max(1, options.rowCap ?? REPORT_CHART_ROW_CAP)

  // Charts with the same extra filters read the same rows.
  const groups = new Map<string, { extra: ReportFilter[]; charts: ReportChartSpec[] }>()
  for (const chart of charts) {
    const extra = chartExtraFilters(chart, tz, now)
    const key = JSON.stringify(extra)
    if (!groups.has(key)) groups.set(key, { extra, charts: [] })
    groups.get(key)!.charts.push(chart)
  }

  const results = new Map<string, ReportChartResult>()
  await Promise.all([...groups.values()].map(async (group) => {
    const fields = [...new Set(group.charts.flatMap(chartFields))]
    const derived: Partial<ReportConfig> = {
      ...config,
      charts: undefined,
      columns: fields.length ? fields : ['id'],
      filters: [...(config.filters ?? []), ...group.extra],
      group_by: undefined,
      aggregations: undefined,
      sort: undefined,
      visualization: 'table',
      row_limit: cap,
    }
    try {
      // One row more than the cap tells a truncated read apart from an exact one.
      const preview = await executeReportPreview(supabase, tenantId, derived, options.scopedTableIds, options.permissions ?? null, { maxRows: cap + 1 })
      const truncated = preview.data.length > cap
      const rows = truncated ? preview.data.slice(0, cap) : preview.data
      for (const chart of group.charts) {
        results.set(chart.id, aggregateReportChart(rows, chart, { timezone: tz, now, truncated, read: getReportValue }))
      }
    } catch (error: any) {
      for (const chart of group.charts) {
        results.set(chart.id, { id: chart.id, type: chart.type, title: chart.title, rows: 0, truncated: false, timezone: tz, error: error?.message ?? 'Chart query failed' })
      }
    }
  }))
  return charts.map((chart) => results.get(chart.id)!)
}
