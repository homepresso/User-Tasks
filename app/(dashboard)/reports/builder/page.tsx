'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Play, Save, ChevronDown, ChevronRight, Plus, X, Trash2,
  Database, Calendar, SortAsc, SortDesc, Hash, Search, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ReferenceInputsEditor } from '@/components/shared/reference-inputs-editor'
import { SearchableOptionPicker } from '@/components/ui/searchable-option-picker'
import { SearchableMultiOptionPicker } from '@/components/ui/searchable-multi-option-picker'
import {
  REPORT_SOURCES, buildJoinedReportColumns, customTableToSource, DRILL_TARGETS, resolveDrillHref, CHART_PALETTES,
  type ReportSource, type ReportConfig, type ReportFilter, type ReportAggregation, type ReportJoinConfig, type ReportSourceInput,
} from '@/lib/report-sources'
import {
  applyRequiredReferenceInputValidation,
  buildReferenceInputTemplate,
  normalizeReferenceInputPayload,
  validateReferenceInputsJson,
} from '@/lib/reference-input-utils'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { createReport } from '@/app/actions/reports'

const VIZ_OPTIONS = [
  { value: 'table', label: 'Table', icon: '▦' },
  { value: 'bar', label: 'Bar', icon: '▮' },
  { value: 'stacked-bar', label: 'Stacked', icon: '▥' },
  { value: 'horizontal-bar', label: 'Horizontal', icon: '▬' },
  { value: 'line', label: 'Line', icon: '╱' },
  { value: 'area', label: 'Area', icon: '▲' },
  { value: 'pie', label: 'Pie', icon: '◔' },
  { value: 'radar', label: 'Radar', icon: '◇' },
  { value: 'scatter', label: 'Scatter', icon: '∷' },
  { value: 'funnel', label: 'Funnel', icon: '▽' },
] as const

const OPERATORS = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
  { value: 'ilike', label: 'Contains' },
  { value: 'is_null', label: 'Is empty' },
  { value: 'is_not_null', label: 'Not empty' },
]

const AGG_FNS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'] as const

const DATE_PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Year to date', days: -1 },
  { label: 'All time', days: 0 },
]

const ROW_LIMITS = [100, 250, 500, 1000, 2500, 5000]
const SOURCE_SORT_OPTIONS = [
  { value: 'label-asc', label: 'Name A-Z' },
  { value: 'label-desc', label: 'Name Z-A' },
  { value: 'category-asc', label: 'Category' },
  { value: 'columns-desc', label: 'Most columns' },
  { value: 'columns-asc', label: 'Fewest columns' },
] as const

function getColumnGroupLabel(type?: string | null) {
  switch (type) {
    case 'date':
      return 'Date fields'
    case 'number':
      return 'Number fields'
    case 'boolean':
      return 'Boolean fields'
    default:
      return 'Text and other fields'
  }
}

function buildSourceBadges(source: ReportSource) {
  const badges = [`${source.columns.length} cols`]
  if (source.key.startsWith('reference_')) {
    badges.unshift('Reference')
  } else if (source.dynamic) {
    badges.unshift('Dynamic')
  } else {
    badges.unshift('Built-in')
  }
  return badges
}

function getSourceTypeLabel(source: ReportSource) {
  if (source.key.startsWith('reference_')) return 'Reference source'
  if (source.dynamic) return 'Dynamic source'
  return 'Built-in source'
}

function SourceSummaryCard({
  source,
  inputLabel,
}: {
  source: ReportSource
  inputLabel?: string
}) {
  const badges = buildSourceBadges(source)
  const needsInputs = source.key.startsWith('reference_')

  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: 'var(--theme-surface-border)',
        backgroundColor: 'var(--theme-surface)',
      }}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {source.label}
          </div>
          <div className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            {source.category} · {getSourceTypeLabel(source)}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                color: 'var(--theme-muted-text)',
                border: '1px solid var(--theme-surface-border)',
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
      {source.description ? (
        <div className="mt-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          {source.description}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
        <span>Default sort: {source.defaultSort.field} {source.defaultSort.direction.toUpperCase()}</span>
        <span>{source.columns.length} fields available</span>
        <span>{needsInputs ? `${inputLabel ?? 'Inputs'} required` : 'No source inputs required'}</span>
        {source.schemaFlexible ? <span>Flexible schema</span> : null}
      </div>
    </div>
  )
}

type BuilderJoinConfig = ReportJoinConfig & {
  source_inputs_json?: string
  source_search?: string
  source_category?: string
  source_sort?: (typeof SOURCE_SORT_OPTIONS)[number]['value']
}

export default function ReportBuilderPage() {
  const router = useRouter()

  // Dynamic sources (custom tables loaded from API)
  const [dynamicSources, setDynamicSources] = useState<ReportSource[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState('all')
  const [sourceSortMode, setSourceSortMode] = useState<(typeof SOURCE_SORT_OPTIONS)[number]['value']>('category-asc')
  const [columnsSearch, setColumnsSearch] = useState('')
  const [dateFieldSearch, setDateFieldSearch] = useState('')
  const [sortFieldSearch, setSortFieldSearch] = useState('')
  const [filterFieldSearch, setFilterFieldSearch] = useState<Record<number, string>>({})
  const [joinLocalFieldSearch, setJoinLocalFieldSearch] = useState<Record<number, string>>({})
  const [joinTargetFieldSearch, setJoinTargetFieldSearch] = useState<Record<number, string>>({})
  const [joinColumnSearch, setJoinColumnSearch] = useState<Record<number, string>>({})

  useEffect(() => {
    async function loadDynamicSources() {
      try {
        const res = await fetch('/api/v1/reports/sources')
        if (res.ok) {
          const json = await res.json()
          setDynamicSources(json.sources ?? [])
        }
      } catch {}
      setLoadingSources(false)
    }
    loadDynamicSources()
  }, [])

  const allSources = useMemo(() => {
    const byKey = new Map<string, ReportSource>()
    for (const source of [...REPORT_SOURCES, ...dynamicSources]) {
      byKey.set(source.key, source)
    }
    return [...byKey.values()]
  }, [dynamicSources])
  const sourceCategoryOptions = useMemo(() => {
    return ['all', ...new Set(allSources.map((source) => source.category).filter(Boolean))] as string[]
  }, [allSources])
  const visibleSources = useMemo(() => {
    const next = allSources.filter((candidate) => {
      if (sourceCategoryFilter !== 'all' && candidate.category !== sourceCategoryFilter) return false
      return true
    })

    next.sort((left, right) => {
      switch (sourceSortMode) {
        case 'label-desc':
          return right.label.localeCompare(left.label)
        case 'columns-desc':
          return (right.columns.length - left.columns.length) || left.label.localeCompare(right.label)
        case 'columns-asc':
          return (left.columns.length - right.columns.length) || left.label.localeCompare(right.label)
        case 'category-asc': {
          const categoryCmp = left.category.localeCompare(right.category)
          return categoryCmp !== 0 ? categoryCmp : left.label.localeCompare(right.label)
        }
        case 'label-asc':
        default:
          return left.label.localeCompare(right.label)
      }
    })
    return next
  }, [allSources, sourceCategoryFilter, sourceSortMode])
  const sourceOptions = useMemo(() => visibleSources.map((candidate) => ({
    value: candidate.key,
    label: candidate.label,
    subtitle: candidate.description || `${candidate.key} · ${candidate.columns.length} cols`,
    keywords: [candidate.key, candidate.category, candidate.description ?? '', ...(candidate.columns ?? []).map((column) => column.key)],
    group: candidate.category,
    badges: buildSourceBadges(candidate),
  })), [visibleSources])
  // Builder state
  const [source, setSource] = useState('')
  const [sourceInputsJson, setSourceInputsJson] = useState('{}')
  const [selectedCols, setSelectedCols] = useState<string[]>([])
  const [filters, setFilters] = useState<ReportFilter[]>([])
  const [joins, setJoins] = useState<BuilderJoinConfig[]>([])
  const [groupBy, setGroupBy] = useState<string[]>([])
  const [aggregations, setAggregations] = useState<ReportAggregation[]>([])
  const [viz, setViz] = useState<ReportConfig['visualization']>('table')
  const [xKey, setXKey] = useState('')
  const [yKey, setYKey] = useState('')
  const [sortField, setSortField] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [dateRangeField, setDateRangeField] = useState('')
  const [datePreset, setDatePreset] = useState(0)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rowLimit, setRowLimit] = useState(1000)
  // Drill-down target — optional link template per row
  const [drillHref, setDrillHref] = useState('')

  // Chart styling — palette, title, axis labels, legend/grid toggles. These
  // are all optional and persist into ReportConfig.chart_style when saved.
  const [chartPaletteId, setChartPaletteId] = useState<string>('default')
  const [customColors, setCustomColors] = useState<string[]>([])
  const [chartTitle, setChartTitle] = useState('')
  const [xAxisLabel, setXAxisLabel] = useState('')
  const [yAxisLabel, setYAxisLabel] = useState('')
  const [hideLegend, setHideLegend] = useState(false)
  const [hideGrid, setHideGrid] = useState(false)

  // Resolved colors — the selected preset palette or the user's custom list.
  // `default` stores no colours, so the chart follows the workspace theme's palette.
  const resolvedColors = useMemo(() => {
    if (chartPaletteId === 'custom' && customColors.length > 0) return customColors
    if (chartPaletteId === 'default') return undefined
    return CHART_PALETTES.find(p => p.id === chartPaletteId)?.colors
  }, [chartPaletteId, customColors])

  const chartStyle = useMemo(() => ({
    colors: resolvedColors,
    chart_title: chartTitle || undefined,
    x_axis_label: xAxisLabel || undefined,
    y_axis_label: yAxisLabel || undefined,
    hide_legend: hideLegend || undefined,
    hide_grid: hideGrid || undefined,
  }), [resolvedColors, chartTitle, xAxisLabel, yAxisLabel, hideLegend, hideGrid])

  const [previewData, setPreviewData] = useState<any[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewTime, setPreviewTime] = useState(0)

  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [saveShared, setSaveShared] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const sourceDef = allSources.find(s => s.key === source)
  const sourceInputsValidation = useMemo(
    () => applyRequiredReferenceInputValidation(
      validateReferenceInputsJson(sourceInputsJson),
      sourceDef?.inputs,
    ),
    [sourceDef?.inputs, sourceInputsJson],
  )
  const joinInputValidationByIndex = useMemo(
    () => joins.map((join) => {
      const selectedJoinSource = allSources.find((candidate) => candidate.key === join.source)
      return applyRequiredReferenceInputValidation(
        validateReferenceInputsJson(join.source_inputs_json ?? ''),
        selectedJoinSource?.inputs,
      )
    }),
    [allSources, joins],
  )
  const hasInputValidationErrors = useMemo(
    () => Boolean(
      (source.startsWith('reference_') && sourceInputsValidation.error)
      || joins.some((join, index) => join.source.startsWith('reference_') && joinInputValidationByIndex[index]?.error),
    ),
    [joinInputValidationByIndex, joins, source, sourceInputsValidation.error],
  )

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['source', 'columns', 'visualization']))

  const toggleSection = (s: string) => {
    setExpandedSections(prev => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next })
  }

  const sourceInputTemplate = useMemo(
    () => buildReferenceInputTemplate(sourceDef?.inputs),
    [sourceDef?.inputs],
  )
  const baseSourceColumns = sourceDef?.columns ?? []
  const sourceColumns = useMemo(
    () => buildJoinedReportColumns(baseSourceColumns, joins, allSources),
    [baseSourceColumns, joins, allSources],
  )
  const availableSourceColumns = useMemo(() => {
    const merged = [...sourceColumns]
    const seen = new Set(merged.map((column) => column.key))
    const sample = previewData?.[0]
    if (!sample || typeof sample !== 'object') return merged
    for (const [key, value] of Object.entries(sample)) {
      if (seen.has(key) || value == null || typeof value === 'object') continue
      merged.push({
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
    return merged
  }, [sourceColumns, previewData])
  const dateColumns = availableSourceColumns.filter(c => c.type === 'date')
  const numericColumns = availableSourceColumns.filter(c => c.type === 'number')
  const visibleSelectedColumns = useMemo(() => {
    const search = columnsSearch.trim().toLowerCase()
    if (!search) return availableSourceColumns
    return availableSourceColumns.filter((column) =>
      [column.label, column.key, column.type].some((value) => String(value ?? '').toLowerCase().includes(search)),
    )
  }, [availableSourceColumns, columnsSearch])
  const visibleDateColumns = useMemo(() => {
    const search = dateFieldSearch.trim().toLowerCase()
    if (!search) return dateColumns
    return dateColumns.filter((column) =>
      [column.label, column.key].some((value) => String(value ?? '').toLowerCase().includes(search)),
    )
  }, [dateColumns, dateFieldSearch])
  const visibleSortColumns = useMemo(() => {
    const search = sortFieldSearch.trim().toLowerCase()
    if (!search) return availableSourceColumns
    return availableSourceColumns.filter((column) =>
      [column.label, column.key, column.type].some((value) => String(value ?? '').toLowerCase().includes(search)),
    )
  }, [availableSourceColumns, sortFieldSearch])
  const dateFieldOptions = useMemo(() => visibleDateColumns.map((column) => ({
    value: column.key,
    label: column.label,
    subtitle: `${column.key} · ${column.type}`,
    keywords: [column.key, column.type],
    group: getColumnGroupLabel(column.type),
  })), [visibleDateColumns])
  const sortFieldOptions = useMemo(() => visibleSortColumns.map((column) => ({
    value: column.key,
    label: column.label,
    subtitle: `${column.key} · ${column.type}`,
    keywords: [column.key, column.type],
    group: getColumnGroupLabel(column.type),
  })), [visibleSortColumns])
  const selectedColumnOptions = useMemo(() => visibleSelectedColumns.map((column) => ({
    value: column.key,
    label: column.label,
    subtitle: `${column.key} · ${column.type}`,
    keywords: [column.key, column.type],
    group: getColumnGroupLabel(column.type),
  })), [visibleSelectedColumns])

  const buildVisibleJoinSources = useCallback((join: BuilderJoinConfig) => {
    const category = join.source_category ?? 'all'
    const sortMode = join.source_sort ?? 'label-asc'

    const next = allSources
      .filter((candidate) => candidate.key !== source)
      .filter((candidate) => {
        if (category !== 'all' && candidate.category !== category) return false
        return true
      })

    next.sort((left, right) => {
      switch (sortMode) {
        case 'label-desc':
          return right.label.localeCompare(left.label)
        case 'columns-desc':
          return (right.columns.length - left.columns.length) || left.label.localeCompare(right.label)
        case 'columns-asc':
          return (left.columns.length - right.columns.length) || left.label.localeCompare(right.label)
        case 'category-asc': {
          const categoryCmp = left.category.localeCompare(right.category)
          return categoryCmp !== 0 ? categoryCmp : left.label.localeCompare(right.label)
        }
        case 'label-asc':
        default:
          return left.label.localeCompare(right.label)
      }
    })

    return next
  }, [allSources, source])

  function resetSource(key: string) {
    setSource(key)
    setSourceInputsJson('{}')
    setColumnsSearch('')
    setDateFieldSearch('')
    setSortFieldSearch('')
    setFilterFieldSearch({})
    setJoinLocalFieldSearch({})
    setJoinTargetFieldSearch({})
    setJoinColumnSearch({})
    const sourceDefLocal = allSources.find(s => s.key === key)
    const cols = sourceDefLocal?.columns ?? []
    // Pre-select the first ~8 columns so the preview shows *something* useful
    // on the first click instead of an empty table. Users can toggle from
    // there. For sources with fewer columns, select them all.
    setSelectedCols(cols.slice(0, 8).map(c => c.key))
    setFilters([])
    setJoins([])
    setGroupBy([])
    setAggregations([])
    setPreviewData(null)
    setPreviewError('')
    // Auto-populate a sensible date range field — prefer created_at /
    // started_at / the source's default sort field, then fall back to the
    // first date column. Saves the user a click for the common case where
    // they want a date-scoped report.
    const dateCols = cols.filter(c => c.type === 'date')
    const preferredDate =
      dateCols.find(c => c.key === sourceDefLocal?.defaultSort.field) ??
      dateCols.find(c => c.key === 'created_at') ??
      dateCols.find(c => c.key === 'started_at') ??
      dateCols[0]
    setDateRangeField(preferredDate?.key ?? '')
    setDatePreset(30) // default to "last 30 days" when a date field is available
    setDateFrom('')
    setDateTo('')
    setSortField('')
    setXKey('')
    setYKey('')
    // Auto-populate drill target from the known preset (user can override)
    const preset = DRILL_TARGETS.find(d => d.source === key)
    setDrillHref(preset?.href_template ?? '')
  }

  // Compute date range for preview
  function getDateRange() {
    if (!dateRangeField) return undefined
    if (datePreset === 0 && !dateFrom && !dateTo) return undefined
    let from = dateFrom
    let to = dateTo
    if (datePreset > 0) {
      const d = new Date()
      d.setDate(d.getDate() - datePreset)
      from = d.toISOString()
      to = ''
    } else if (datePreset === -1) {
      const d = new Date()
      d.setMonth(0, 1); d.setHours(0, 0, 0, 0)
      from = d.toISOString()
      to = ''
    }
    return { field: dateRangeField, from: from || undefined, to: to || undefined }
  }

  const runPreview = useCallback(async () => {
    if (!source) return
    setPreviewLoading(true)
    setPreviewError('')
    const t0 = performance.now()
    const parsedSourceInputs = source.startsWith('reference_')
      ? normalizeReferenceInputPayload(sourceInputsValidation.parsed, sourceDef?.inputs)
      : undefined
    if (source.startsWith('reference_') && sourceInputsValidation.error) {
      setPreviewError(sourceInputsValidation.error)
      setPreviewLoading(false)
      return
    }
    try {
      const res = await fetch('/api/v1/reports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data_source: source,
          source_inputs: parsedSourceInputs,
          columns: selectedCols,
          filters: filters.filter(f => f.field && (f.operator === 'is_null' || f.operator === 'is_not_null' || f.value)),
          joins: joins.map((join) => {
            const selectedJoinSource = allSources.find((candidate) => candidate.key === join.source)
            const validation = applyRequiredReferenceInputValidation(
              validateReferenceInputsJson(join.source_inputs_json ?? ''),
              selectedJoinSource?.inputs,
            )
            if (join.source.startsWith('reference_') && validation.error) {
              throw new Error(`Join "${join.alias}" inputs: ${validation.error}`)
            }
            const normalizedSourceInputs = normalizeReferenceInputPayload(validation.parsed, selectedJoinSource?.inputs)
            return normalizedSourceInputs ? { ...join, source_inputs: normalizedSourceInputs } : join
          }),
          group_by: groupBy.length ? groupBy : undefined,
          aggregations: aggregations.length ? aggregations : undefined,
          sort: sortField ? { field: sortField, direction: sortDir } : undefined,
          date_range: getDateRange(),
          row_limit: rowLimit,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPreviewData(json.data)
      setPreviewTime(Math.round(performance.now() - t0))
    } catch (err: any) {
      setPreviewError(err.message)
      setPreviewData(null)
    }
    setPreviewLoading(false)
  }, [allSources, source, sourceDef?.inputs, sourceInputsValidation, selectedCols, filters, joins, groupBy, aggregations, sortField, sortDir, dateRangeField, datePreset, dateFrom, dateTo, rowLimit])

  async function handleSave() {
    if (!saveName.trim() || !source) return
    setSaving(true)
    try {
      if (source.startsWith('reference_') && sourceInputsValidation.error) {
        throw new Error(sourceInputsValidation.error)
      }
      const parsedSourceInputs = source.startsWith('reference_')
        ? normalizeReferenceInputPayload(sourceInputsValidation.parsed, sourceDef?.inputs)
        : undefined
      // Only persist chart_style if the user actually customized something —
      // otherwise leave it off so the saved config stays compact.
      const hasCustomStyle =
        chartPaletteId !== 'default' || chartTitle || xAxisLabel || yAxisLabel || hideLegend || hideGrid

      const config: ReportConfig = {
        data_source: source,
        source_inputs: parsedSourceInputs,
        columns: selectedCols,
        filters,
        joins: joins.length
          ? joins.map((join: any) => ({
              ...join,
              source_inputs: (() => {
                const selectedJoinSource = allSources.find((candidate) => candidate.key === join.source)
                const validation = applyRequiredReferenceInputValidation(
                  validateReferenceInputsJson(join.source_inputs_json ?? ''),
                  selectedJoinSource?.inputs,
                )
                if (join.source.startsWith('reference_') && validation.error) {
                  throw new Error(`Join "${join.alias}" inputs: ${validation.error}`)
                }
                return normalizeReferenceInputPayload(validation.parsed, selectedJoinSource?.inputs)
              })(),
            }))
          : undefined,
        group_by: groupBy.length ? groupBy : undefined,
        aggregations: aggregations.length ? aggregations : undefined,
        visualization: viz,
        sort: sortField ? { field: sortField, direction: sortDir } : undefined,
        date_range: getDateRange(),
        row_limit: rowLimit,
        drill_target: drillHref.trim() ? { href_template: drillHref.trim() } : undefined,
        chart_style: hasCustomStyle
          ? {
              colors: resolvedColors,
              chart_title: chartTitle || undefined,
              x_axis_label: xAxisLabel || undefined,
              y_axis_label: yAxisLabel || undefined,
              hide_legend: hideLegend || undefined,
              hide_grid: hideGrid || undefined,
            }
          : undefined,
      }
      const result = await createReport({
        name: saveName,
        description: saveDesc || undefined,
        config,
        category: sourceDef?.category.toLowerCase() ?? 'custom',
        is_shared: saveShared,
      })
      router.push(`/reports/${(result as any).id}`)
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  // Preview columns
  const previewColumns = useMemo(() => {
    if (!sourceDef) return []

    const selectedSourceColumns = selectedCols
      .map((key) => availableSourceColumns.find((col) => col.key === key))
      .filter(Boolean) as typeof availableSourceColumns

    const fallbackRow = previewData?.[0] ?? null
    const fallbackColumns = fallbackRow
      ? Object.keys(fallbackRow)
          .filter((key) => key !== '_count' && typeof fallbackRow[key] !== 'object')
          .map((key) => {
            const col = availableSourceColumns.find((sourceCol) => sourceCol.key === key)
            return {
              key,
              label: col?.label ?? key.replace(/^data_/, '').replace(/_/g, ' '),
              type: col?.type,
            }
          })
      : []

    if (groupBy.length > 0 || aggregations.length > 0) {
      return fallbackColumns
    }

    if (selectedSourceColumns.length > 0) {
      return selectedSourceColumns.map((col) => ({
        key: col.key,
        label: col.label,
        type: col.type,
      }))
    }

    return fallbackColumns
  }, [sourceDef, availableSourceColumns, selectedCols, previewData, groupBy, aggregations])

  const exportColumns = previewColumns.map(c => ({ key: c.key, label: c.label }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Report Builder</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runPreview} disabled={!source || previewLoading || hasInputValidationErrors}>
            <Play size={14} className="mr-1" /> {previewLoading ? 'Running...' : 'Run Query'}
          </Button>
          <Button size="sm" onClick={() => setShowSave(true)} disabled={!source || hasInputValidationErrors}>
            <Save size={14} className="mr-1" /> Save
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config panel */}
        <div className="space-y-2 max-h-[calc(100vh-120px)] overflow-y-auto pr-1">

          {/* Source */}
          <AccordionSection title="Data Source" id="source" expanded={expandedSections} onToggle={toggleSection}>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sourceCategoryFilter}
                  onChange={(e) => setSourceCategoryFilter(e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--theme-surface-border)' }}
                >
                  {sourceCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {category === 'all' ? 'All categories' : category}
                    </option>
                  ))}
                </select>
                <select
                  value={sourceSortMode}
                  onChange={(e) => setSourceSortMode(e.target.value as (typeof SOURCE_SORT_OPTIONS)[number]['value'])}
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--theme-surface-border)' }}
                >
                  {SOURCE_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <SearchableOptionPicker
                value={source}
                onChange={resetSource}
                placeholder={loadingSources ? 'Loading data sources...' : 'Select a data source'}
                searchPlaceholder="Search data sources..."
                emptyLabel={loadingSources ? 'Loading data sources...' : 'No data sources match the current filters.'}
                options={sourceOptions}
                disabled={loadingSources}
                recentStorageKey="report-builder:data-sources"
              />
              {sourceDef ? (
                <SourceSummaryCard source={sourceDef} inputLabel="Reference inputs" />
              ) : null}
            </div>
            {source.startsWith('reference_') && (
              <div className="mt-3 rounded-lg border p-2 space-y-1" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <ReferenceInputsEditor
                  title="Reference inputs"
                  description="Use the form fields below for the common setup path, or open the JSON editor for advanced payloads."
                  inputs={sourceDef?.inputs ?? []}
                  rawJson={sourceInputsJson}
                  onChange={setSourceInputsJson}
                  validation={sourceInputsValidation}
                  emptyLabel="No reference inputs configured yet."
                  placeholder={sourceInputTemplate || '{"collection":"orders","limit":100}'}
                />
              </div>
            )}
          </AccordionSection>

          {/* Columns */}
          {sourceDef && (
            <AccordionSection title={`Columns (${selectedCols.length}/${availableSourceColumns.length})`} id="columns" expanded={expandedSections} onToggle={toggleSection}>
              <div className="flex gap-1 mb-2">
                <button onClick={() => setSelectedCols(availableSourceColumns.map(c => c.key))} className="text-[10px] text-[color:var(--theme-card-text)] hover:underline">Select all</button>
                <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>·</span>
                <button onClick={() => setSelectedCols([])} className="text-[10px] text-[color:var(--theme-card-text)] hover:underline">Clear</button>
              </div>
              <div className="relative mb-2">
                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                <Input
                  value={columnsSearch}
                  onChange={(e) => setColumnsSearch(e.target.value)}
                  className="!h-8 !pl-7 !text-xs"
                  placeholder="Search columns..."
                />
              </div>
              <SearchableMultiOptionPicker
                values={selectedCols}
                onChange={setSelectedCols}
                placeholder="Choose report columns"
                searchPlaceholder="Search columns..."
                emptyLabel="No columns match the current search."
                options={selectedColumnOptions}
                recentStorageKey="report-builder:selected-columns"
              />
            </AccordionSection>
          )}

          {/* Date Range */}
          {sourceDef && dateColumns.length > 0 && (
            <AccordionSection title="Date Range" id="daterange" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-2">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                  <Input
                    value={dateFieldSearch}
                    onChange={(e) => setDateFieldSearch(e.target.value)}
                    className="!h-8 !pl-7 !text-xs"
                    placeholder="Search date fields..."
                  />
                </div>
                <SearchableOptionPicker
                  value={dateRangeField}
                  onChange={setDateRangeField}
                  placeholder="No date filter"
                  searchPlaceholder="Search date fields..."
                  emptyLabel="No date fields match the current search."
                  options={dateFieldOptions}
                  recentStorageKey="report-builder:date-range-field"
                />
                {dateRangeField && (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {DATE_PRESETS.map(p => (
                        <button
                          key={p.label}
                          onClick={() => { setDatePreset(p.days); setDateFrom(''); setDateTo('') }}
                          className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors"
                          style={{
                            backgroundColor: datePreset === p.days ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                            color: datePreset === p.days ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <input
                        type="date"
                        value={dateFrom ? dateFrom.split('T')[0] : ''}
                        onChange={e => { setDateFrom(e.target.value ? `${e.target.value}T00:00:00` : ''); setDatePreset(0) }}
                        className="flex-1 rounded border px-1.5 py-1 text-xs"
                        style={{ borderColor: 'var(--theme-surface-border)' }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>to</span>
                      <input
                        type="date"
                        value={dateTo ? dateTo.split('T')[0] : ''}
                        onChange={e => { setDateTo(e.target.value ? `${e.target.value}T23:59:59` : ''); setDatePreset(0) }}
                        className="flex-1 rounded border px-1.5 py-1 text-xs"
                        style={{ borderColor: 'var(--theme-surface-border)' }}
                      />
                    </div>
                  </>
                )}
              </div>
            </AccordionSection>
          )}

          {/* Filters */}
          {sourceDef && (
            <AccordionSection title={`Filters${filters.length ? ` (${filters.length})` : ''}`} id="filters" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-2">
                {filters.map((f, i) => (
                  <div key={i} className="space-y-1">
                    {(() => {
                      const filterFieldOptions = availableSourceColumns
                        .filter((column) => {
                          const search = (filterFieldSearch[i] ?? '').trim().toLowerCase()
                          if (!search) return true
                          return [column.label, column.key, column.type].some((value) => String(value ?? '').toLowerCase().includes(search))
                        })
                        .map((column) => ({
                          value: column.key,
                          label: column.label,
                          subtitle: `${column.key} · ${column.type}`,
                          keywords: [column.key, column.type],
                          group: getColumnGroupLabel(column.type),
                        }))
                      return (
                        <>
                          <div className="relative">
                            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                            <Input
                              value={filterFieldSearch[i] ?? ''}
                              onChange={e => setFilterFieldSearch(prev => ({ ...prev, [i]: e.target.value }))}
                              className="!h-8 !pl-7 !text-xs"
                              placeholder="Search filter fields..."
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <div className="flex-1 min-w-0">
                              <SearchableOptionPicker
                                value={f.field}
                                onChange={(nextValue) => setFilters(prev => prev.map((ff, fi) => fi === i ? { ...ff, field: nextValue } : ff))}
                                placeholder="Field"
                                searchPlaceholder="Search filter fields..."
                                emptyLabel="No filter fields match the current search."
                                options={filterFieldOptions}
                                recentStorageKey="report-builder:filter-fields"
                              />
                            </div>
                            <select
                              value={f.operator}
                              onChange={e => setFilters(prev => prev.map((ff, fi) => fi === i ? { ...ff, operator: e.target.value as any } : ff))}
                              className="w-20 rounded border px-1 py-1 text-xs"
                              style={{ borderColor: 'var(--theme-surface-border)' }}
                            >
                              {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            {f.operator !== 'is_null' && f.operator !== 'is_not_null' && (
                              <Input
                                value={f.value ?? ''}
                                onChange={e => setFilters(prev => prev.map((ff, fi) => fi === i ? { ...ff, value: e.target.value } : ff))}
                                className="flex-1 min-w-0 h-7 text-xs"
                                placeholder="Value"
                              />
                            )}
                            <button onClick={() => setFilters(prev => prev.filter((_, fi) => fi !== i))} className="shrink-0 p-1 text-red-400 hover:text-red-600">
                              <X size={12} />
                            </button>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                ))}
                <button
                  onClick={() => setFilters(prev => [...prev, { field: '', operator: 'eq', value: '' }])}
                  className="text-xs text-[color:var(--theme-card-text)] hover:underline flex items-center gap-1"
                >
                  <Plus size={11} /> Add filter
                </button>
              </div>
            </AccordionSection>
          )}

          {/* Joins */}
          {sourceDef && (
            <AccordionSection title={`Joins${joins.length ? ` (${joins.length})` : ''}`} id="joins" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-3">
                {joins.map((join, index) => {
                  const targetSource = allSources.find((candidate) => candidate.key === join.source)
                  const localOptions = availableSourceColumns
                  const targetColumns = targetSource?.columns ?? []
                  const targetIsFlexible = Boolean((targetSource as any)?.schemaFlexible)
                  const localFieldOptions = localOptions
                    .filter((col) => {
                      const search = (joinLocalFieldSearch[index] ?? '').trim().toLowerCase()
                      if (!search) return true
                      return [col.label, col.key, col.type].some((value) => String(value ?? '').toLowerCase().includes(search))
                    })
                    .map((col) => ({
                      value: col.key,
                      label: col.label,
                      subtitle: `${col.key} · ${col.type}`,
                      keywords: [col.key, col.type],
                      group: getColumnGroupLabel(col.type),
                    }))
                  const targetFieldOptions = targetColumns
                    .filter((col) => {
                      const search = (joinTargetFieldSearch[index] ?? '').trim().toLowerCase()
                      if (!search) return true
                      return [col.label, col.key, col.type].some((value) => String(value ?? '').toLowerCase().includes(search))
                    })
                    .map((col) => ({
                      value: col.key,
                      label: col.label,
                      subtitle: `${col.key} · ${col.type}`,
                      keywords: [col.key, col.type],
                      group: getColumnGroupLabel(col.type),
                    }))
                  const joinColumnOptions = targetColumns
                    .filter((col) => {
                      const search = (joinColumnSearch[index] ?? '').trim().toLowerCase()
                      if (!search) return true
                      return [col.label, col.key, col.type].some((value) => String(value ?? '').toLowerCase().includes(search))
                    })
                    .map((col) => ({
                      value: col.key,
                      label: col.label,
                      subtitle: `${col.key} · ${col.type}`,
                      keywords: [col.key, col.type],
                      group: getColumnGroupLabel(col.type),
                    }))
                  const joinVisibleSources = buildVisibleJoinSources(join)
                  const joinSourceOptions = joinVisibleSources.map((candidate) => ({
                    value: candidate.key,
                    label: candidate.label,
                    subtitle: candidate.description || `${candidate.key} · ${candidate.columns.length} cols`,
                    keywords: [candidate.key, candidate.category, candidate.description ?? '', ...(candidate.columns ?? []).map((column) => column.key)],
                    group: candidate.category,
                    badges: buildSourceBadges(candidate),
                  }))
                  const selectedJoinSource = allSources.find((candidate) => candidate.key === join.source)
                  const joinInputTemplate = buildReferenceInputTemplate(selectedJoinSource?.inputs)
                  const joinCategoryOptions = ['all', ...new Set(
                    allSources
                      .filter((candidate) => candidate.key !== source)
                      .map((candidate) => candidate.category)
                      .filter(Boolean),
                  )] as string[]
                  return (
                    <div key={join.id ?? index} className="rounded-lg border p-2 space-y-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
                          Join {index + 1}
                        </span>
                        <button
                          onClick={() => {
                            const removed = joins[index]
                            setJoins((prev) => prev.filter((_, joinIndex) => joinIndex !== index))
                            if (removed?.alias) {
                              const prefix = `${removed.alias}.`
                              setSelectedCols((prev) => prev.filter((key) => !key.startsWith(prefix)))
                              setFilters((prev) => prev.filter((filter) => !filter.field.startsWith(prefix)))
                              setGroupBy((prev) => prev.filter((key) => !key.startsWith(prefix)))
                              setAggregations((prev) => prev.filter((agg) => !agg.field.startsWith(prefix)))
                              setSortField((prev) => (prev.startsWith(prefix) ? '' : prev))
                              setDateRangeField((prev) => (prev.startsWith(prefix) ? '' : prev))
                            }
                          }}
                          className="p-1 text-red-400 hover:text-red-600"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Join source</label>
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={join.source_category ?? 'all'}
                                onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
                                  ...item,
                                  source_category: e.target.value,
                                } : item))}
                                className="w-full rounded border px-2 py-1.5 text-xs"
                                style={{ borderColor: 'var(--theme-surface-border)' }}
                              >
                                {joinCategoryOptions.map((category) => (
                                  <option key={category} value={category}>
                                    {category === 'all' ? 'All categories' : category}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={join.source_sort ?? 'label-asc'}
                                onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
                                  ...item,
                                  source_sort: e.target.value as (typeof SOURCE_SORT_OPTIONS)[number]['value'],
                                } : item))}
                                className="w-full rounded border px-2 py-1.5 text-xs"
                                style={{ borderColor: 'var(--theme-surface-border)' }}
                              >
                                {SOURCE_SORT_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                            <SearchableOptionPicker
                              value={join.source}
                              onChange={(nextValue) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
                                ...item,
                                source: nextValue,
                                foreign_field: '',
                                columns: [],
                                source_inputs_json: '{}',
                              } : item))}
                              placeholder="Select join source"
                              searchPlaceholder="Search join sources..."
                              emptyLabel="No join sources match the current filters."
                              options={joinSourceOptions}
                              recentStorageKey="report-builder:join-sources"
                            />
                            {selectedJoinSource ? (
                              <SourceSummaryCard source={selectedJoinSource} inputLabel="Join inputs" />
                            ) : null}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Alias</label>
                          <Input
                            value={join.alias}
                            onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, alias: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') } : item))}
                            className="!h-8 !text-xs"
                            placeholder="customer"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Current field</label>
                          <div className="relative mb-1">
                            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                            <Input
                              value={joinLocalFieldSearch[index] ?? ''}
                              onChange={(e) => setJoinLocalFieldSearch((prev) => ({ ...prev, [index]: e.target.value }))}
                              className="!h-8 !pl-7 !text-xs"
                              placeholder="Search current fields..."
                            />
                          </div>
                          <SearchableOptionPicker
                            value={join.local_field}
                            onChange={(nextValue) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, local_field: nextValue } : item))}
                            placeholder="Select field"
                            searchPlaceholder="Search current fields..."
                            emptyLabel="No current fields match the current search."
                            options={localFieldOptions}
                            recentStorageKey="report-builder:join-local-fields"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Matches target field</label>
                          {targetIsFlexible ? (
                            <Input
                              value={join.foreign_field}
                              onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, foreign_field: e.target.value } : item))}
                              className="!h-8 !text-xs"
                              placeholder="customer_id"
                            />
                          ) : (
                            <>
                              <div className="relative mb-1">
                                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                                <Input
                                  value={joinTargetFieldSearch[index] ?? ''}
                                  onChange={(e) => setJoinTargetFieldSearch((prev) => ({ ...prev, [index]: e.target.value }))}
                                  className="!h-8 !pl-7 !text-xs"
                                  placeholder="Search target fields..."
                                />
                              </div>
                              <SearchableOptionPicker
                                value={join.foreign_field}
                                onChange={(nextValue) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, foreign_field: nextValue } : item))}
                                placeholder="Select target field"
                                searchPlaceholder="Search target fields..."
                                emptyLabel="No target fields match the current search."
                                options={targetFieldOptions}
                                recentStorageKey="report-builder:join-target-fields"
                              />
                            </>
                          )}
                        </div>
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Join type</label>
                          <select
                            value={join.join_type ?? 'left'}
                            onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, join_type: e.target.value as 'left' | 'inner' } : item))}
                            className="w-full rounded border px-2 py-1.5 text-xs"
                            style={{ borderColor: 'var(--theme-surface-border)' }}
                          >
                            <option value="left">Left join</option>
                            <option value="inner">Inner join</option>
                          </select>
                        </div>
                      </div>

                      {(targetColumns.length > 0 || targetIsFlexible) && (
                        <div>
                          <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Columns to bring in</label>
                          {targetIsFlexible ? (
                            <>
                              <Input
                                value={join.columns.join(', ')}
                                onChange={(e) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
                                  ...item,
                                  columns: e.target.value
                                    .split(',')
                                    .map((value) => value.trim())
                                    .filter(Boolean),
                                } : item))}
                                className="!h-8 !text-xs"
                                placeholder="name, status, amount"
                              />
                              <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                Enter response field names as a comma-separated list for flexible API sources.
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="relative mb-2">
                                <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                                <Input
                                  value={joinColumnSearch[index] ?? ''}
                                  onChange={(e) => setJoinColumnSearch((prev) => ({ ...prev, [index]: e.target.value }))}
                                  className="!h-8 !pl-7 !text-xs"
                                  placeholder="Search target columns..."
                                />
                              </div>
                              <SearchableMultiOptionPicker
                                values={join.columns}
                                onChange={(nextValues) => setJoins((prev) => prev.map((item, itemIndex) => itemIndex === index ? {
                                  ...item,
                                  columns: nextValues,
                                } : item))}
                                placeholder="Choose join columns"
                                searchPlaceholder="Search target columns..."
                                emptyLabel="No target columns match the current search."
                                options={joinColumnOptions}
                                recentStorageKey="report-builder:join-columns"
                              />
                            </>
                          )}
                        </div>
                      )}

                      {join.source.startsWith('reference_') && (
                        <div>
                          <ReferenceInputsEditor
                            title="Join source inputs"
                            description="Configure any parameters this joined reference needs before it can return rows."
                            inputs={selectedJoinSource?.inputs ?? []}
                            rawJson={(join as any).source_inputs_json ?? '{}'}
                            onChange={(nextValue) => setJoins((prev) => prev.map((item: any, itemIndex) => itemIndex === index ? {
                              ...item,
                              source_inputs_json: nextValue,
                            } : item))}
                            validation={joinInputValidationByIndex[index] ?? { keyCount: 0 }}
                            emptyLabel="No join inputs configured yet."
                            placeholder={joinInputTemplate || '{"entity_set":"Orders","top":100}'}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}

                <button
                  onClick={() => setJoins((prev) => [...prev, {
                    id: crypto.randomUUID(),
                    source: '',
                    alias: `join_${prev.length + 1}`,
                    local_field: '',
                    foreign_field: '',
                    columns: [],
                    join_type: 'left',
                    source_inputs_json: '{}',
                    source_search: '',
                    source_category: 'all',
                    source_sort: 'label-asc',
                  }])}
                  className="text-xs text-[color:var(--theme-card-text)] hover:underline flex items-center gap-1"
                >
                  <Plus size={11} /> Add join
                </button>
              </div>
            </AccordionSection>
          )}

          {/* Sort & Limit */}
          {sourceDef && (
            <AccordionSection title="Sort & Limit" id="sort" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-2">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
                  <Input
                    value={sortFieldSearch}
                    onChange={(e) => setSortFieldSearch(e.target.value)}
                    className="!h-8 !pl-7 !text-xs"
                    placeholder="Search sort fields..."
                  />
                </div>
                <div className="flex gap-1.5">
                  <div className="flex-1">
                    <SearchableOptionPicker
                      value={sortField}
                      onChange={setSortField}
                      placeholder="Default sort"
                      searchPlaceholder="Search sort fields..."
                      emptyLabel="No sort fields match the current search."
                      options={sortFieldOptions}
                      recentStorageKey="report-builder:sort-fields"
                    />
                  </div>
                  <button
                    onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    className="px-2 py-1 rounded border text-xs flex items-center gap-1"
                    style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                  >
                    {sortDir === 'asc' ? <SortAsc size={13} /> : <SortDesc size={13} />}
                    {sortDir.toUpperCase()}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Hash size={12} style={{ color: 'var(--theme-muted-text)' }} />
                  <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Row limit</span>
                  <div className="flex gap-1 ml-auto">
                    {ROW_LIMITS.map(l => (
                      <button
                        key={l}
                        onClick={() => setRowLimit(l)}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
                        style={{
                          backgroundColor: rowLimit === l ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                          color: rowLimit === l ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                        }}
                      >
                        {l >= 1000 ? `${l / 1000}k` : l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Drill-down target — makes each row in the table view clickable */}
                <div className="pt-2 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
                      Row click target (drill-down)
                    </span>
                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                      optional · use {'{column}'} placeholders
                    </span>
                  </div>
                  <Input
                    value={drillHref}
                    onChange={(e) => setDrillHref(e.target.value)}
                    placeholder="/tasks/{id}"
                    className="!h-7 !text-[10px] font-mono"
                  />
                  {DRILL_TARGETS.find(d => d.source === source) && (
                    <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                      Preset for <span className="font-mono">{source}</span> auto-populated · edit to customize.
                    </p>
                  )}
                </div>
              </div>
            </AccordionSection>
          )}

          {/* Group & Aggregate */}
          {sourceDef && (
            <AccordionSection title={`Group & Aggregate${groupBy.length ? ` (${groupBy.length})` : ''}`} id="group" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-2">
                <label className="text-[10px] font-medium block" style={{ color: 'var(--theme-muted-text)' }}>Group By</label>
                <div className="flex flex-wrap gap-1">
                  {availableSourceColumns.map(col => (
                    <button
                      key={col.key}
                      onClick={() => setGroupBy(prev => prev.includes(col.key) ? prev.filter(k => k !== col.key) : [...prev, col.key])}
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors"
                      style={{
                        backgroundColor: groupBy.includes(col.key) ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                        color: groupBy.includes(col.key) ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                      }}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
                {groupBy.length > 0 && (
                  <>
                    <label className="text-[10px] font-medium block mt-2" style={{ color: 'var(--theme-muted-text)' }}>Aggregations</label>
                    {aggregations.map((a, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <select
                          value={a.fn}
                          onChange={e => setAggregations(prev => prev.map((aa, ai) => ai === i ? { ...aa, fn: e.target.value as any } : aa))}
                          className="w-20 rounded border px-1 py-1 text-xs"
                          style={{ borderColor: 'var(--theme-surface-border)' }}
                        >
                          {AGG_FNS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <select
                          value={a.field}
                          onChange={e => setAggregations(prev => prev.map((aa, ai) => ai === i ? { ...aa, field: e.target.value } : aa))}
                          className="flex-1 rounded border px-1 py-1 text-xs"
                          style={{ borderColor: 'var(--theme-surface-border)' }}
                        >
                          <option value="">Field</option>
                          {availableSourceColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button onClick={() => setAggregations(prev => prev.filter((_, ai) => ai !== i))} className="text-red-400 hover:text-red-600 p-1">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setAggregations(prev => [...prev, { fn: 'COUNT', field: numericColumns[0]?.key ?? availableSourceColumns[0]?.key ?? '' }])} className="text-xs text-[color:var(--theme-card-text)] hover:underline flex items-center gap-1">
                      <Plus size={11} /> Add aggregation
                    </button>
                  </>
                )}
              </div>
            </AccordionSection>
          )}

          {/* Visualization */}
          {sourceDef && (
            <AccordionSection title="Visualization" id="visualization" expanded={expandedSections} onToggle={toggleSection}>
              <div className="grid grid-cols-4 gap-1.5">
                {VIZ_OPTIONS.map(v => (
                  <button
                    key={v.value}
                    onClick={() => setViz(v.value)}
                    className="px-2 py-2 rounded-lg text-center transition-colors"
                    style={{
                      backgroundColor: viz === v.value ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                      color: viz === v.value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                      boxShadow: viz === v.value ? '0 0 0 1px var(--theme-primary)' : undefined,
                    }}
                  >
                    <span className="text-lg block">{v.icon}</span>
                    <span className="text-[9px] font-medium">{v.label}</span>
                  </button>
                ))}
              </div>
              {viz !== 'table' && (
                <div className="mt-3 space-y-2">
                  <label className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>X Axis / Label</label>
                  <select value={xKey} onChange={e => setXKey(e.target.value)} className="w-full rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    <option value="">Auto</option>
                    {(previewData ? previewColumns : availableSourceColumns).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <label className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Y Axis / Value</label>
                  {/* Allow any column for Y axis. Originally this was filtered
                      to type === 'number', but custom data tables store
                      everything in JSONB and often surface numeric columns
                      as 'text', so the filter hid real numeric data and
                      left only "Auto" as the option. Users can still pick
                      obviously-non-numeric columns; Recharts will simply
                      render 0/NaN for those which is recoverable. Numeric
                      columns are grouped first for convenience. */}
                  <select value={yKey} onChange={e => setYKey(e.target.value)} className="w-full rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    <option value="">Auto</option>
                    {(() => {
                      const cols = previewData ? previewColumns : availableSourceColumns
                      const numeric = cols.filter(c => c.type === 'number')
                      const other = cols.filter(c => c.type !== 'number')
                      return (
                        <>
                          {numeric.length > 0 && (
                            <optgroup label="Numeric">
                              {numeric.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </optgroup>
                          )}
                          {other.length > 0 && (
                            <optgroup label="Other columns">
                              {other.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                            </optgroup>
                          )}
                        </>
                      )
                    })()}
                  </select>
                </div>
              )}
            </AccordionSection>
          )}

          {/* Chart Style — palette, title, axis labels, legend/grid toggles */}
          {sourceDef && viz !== 'table' && (
            <AccordionSection title="Chart Style" id="style" expanded={expandedSections} onToggle={toggleSection}>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-medium block mb-1.5" style={{ color: 'var(--theme-muted-text)' }}>Color Palette</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CHART_PALETTES.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setChartPaletteId(p.id)}
                        className="rounded-md p-1.5 text-left transition-colors"
                        style={{
                          backgroundColor: chartPaletteId === p.id ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                          boxShadow: chartPaletteId === p.id ? '0 0 0 1px var(--theme-primary)' : undefined,
                        }}
                      >
                        <div className="flex gap-0.5 mb-1">
                          {p.colors.slice(0, 6).map((c, i) => (
                            <span key={i} className="h-3 flex-1 rounded-sm" style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <span className="text-[9px] font-medium" style={{ color: chartPaletteId === p.id ? 'var(--theme-primary-text)' : 'var(--theme-card-text)' }}>{p.label}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setChartPaletteId('custom')
                        if (customColors.length === 0) setCustomColors([...CHART_PALETTES[0].colors])
                      }}
                      className="rounded-md p-1.5 text-left transition-colors col-span-2"
                      style={{
                        backgroundColor: chartPaletteId === 'custom' ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                        boxShadow: chartPaletteId === 'custom' ? '0 0 0 1px var(--theme-primary)' : undefined,
                      }}
                    >
                      <span className="text-[9px] font-medium" style={{ color: chartPaletteId === 'custom' ? 'var(--theme-primary-text)' : 'var(--theme-card-text)' }}>Custom colors</span>
                    </button>
                  </div>
                  {chartPaletteId === 'custom' && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                        Pick up to 10 colors — applied in order to chart series.
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {customColors.map((c, i) => (
                          <div key={i} className="relative">
                            <input
                              type="color"
                              value={c}
                              onChange={e => setCustomColors(prev => prev.map((cc, ci) => ci === i ? e.target.value : cc))}
                              className="h-7 w-7 rounded cursor-pointer border"
                              style={{ borderColor: 'var(--theme-surface-border)' }}
                            />
                            <button
                              onClick={() => setCustomColors(prev => prev.filter((_, ci) => ci !== i))}
                              className="absolute -top-1 -right-1 rounded-full w-3 h-3 flex items-center justify-center text-[8px]"
                              style={{ backgroundColor: 'var(--status-error)', color: 'var(--theme-on-danger)' }}
                              title="Remove"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {customColors.length < 10 && (
                          <button
                            onClick={() => setCustomColors(prev => [...prev, '#17150F'])}
                            className="h-7 w-7 rounded border flex items-center justify-center"
                            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
                          >
                            <Plus size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Chart Title</label>
                  <Input
                    value={chartTitle}
                    onChange={e => setChartTitle(e.target.value)}
                    placeholder="Optional — defaults to report name"
                    className="!h-7 !text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>X Axis Label</label>
                    <Input
                      value={xAxisLabel}
                      onChange={e => setXAxisLabel(e.target.value)}
                      placeholder="e.g. Date"
                      className="!h-7 !text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Y Axis Label</label>
                    <Input
                      value={yAxisLabel}
                      onChange={e => setYAxisLabel(e.target.value)}
                      placeholder="e.g. Count"
                      className="!h-7 !text-xs"
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--theme-card-text)' }}>
                    <input type="checkbox" checked={hideLegend} onChange={e => setHideLegend(e.target.checked)} className="rounded" />
                    Hide legend
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--theme-card-text)' }}>
                    <input type="checkbox" checked={hideGrid} onChange={e => setHideGrid(e.target.checked)} className="rounded" />
                    Hide gridlines
                  </label>
                </div>
              </div>
            </AccordionSection>
          )}
        </div>

        {/* Preview panel */}
        <div className="lg:col-span-2 space-y-4">
          {previewError && (
            <div
              className="rounded-lg border px-4 py-3 text-sm"
              style={{
                borderColor: 'var(--status-error)',
                backgroundColor: 'var(--status-error-bg)',
                color: 'var(--status-error)',
              }}
            >
              <div className="font-semibold mb-1">Query failed</div>
              <div className="text-xs break-words whitespace-pre-wrap font-mono opacity-90">{previewError}</div>
            </div>
          )}

          {previewData && viz !== 'table' && (() => {
            // Auto fallback: prefer an explicit numeric column, then
            // any numeric-looking key in the first preview row (catches
            // JSONB data-table columns typed as 'text'), and finally
            // the second column by position. The old logic only looked
            // for type === 'number' and otherwise rendered an empty
            // chart against a fake 'value' key.
            const numericCol = previewColumns.find(c => c.type === 'number')
            const firstRow = (previewData[0] ?? {}) as Record<string, any>
            const inferredNumeric = previewColumns.find(c => {
              if (c.key === (xKey || previewColumns[0]?.key)) return false
              const v = firstRow[c.key]
              return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))
            })
            const autoKey = numericCol?.key
              ?? inferredNumeric?.key
              ?? previewColumns[1]?.key
              ?? previewColumns[0]?.key
              ?? 'value'
            const effectiveYKey = yKey || autoKey
            return (
              <ReportChart
                type={viz as any}
                data={previewData}
                xKey={xKey || previewColumns[0]?.key || 'name'}
                yKeys={[effectiveYKey]}
                nameKey={xKey || previewColumns[0]?.key || 'name'}
                valueKey={effectiveYKey}
                title={chartTitle || 'Preview'}
                height={350}
                style={chartStyle}
              />
            )
          })()}

          {previewData && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                {previewData.length} row{previewData.length !== 1 ? 's' : ''}
                {previewTime > 0 && ` · ${previewTime}ms`}
                {sourceDef?.dynamic && (
                  <span
                    className="ml-1.5 px-1 py-0.5 rounded text-[9px]"
                    style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                  >Data Table</span>
                )}
              </span>
              <ReportExportButton data={previewData} columns={exportColumns} filename="custom-report" />
            </div>
          )}

          {previewData ? (
            <ReportDataTable
              columns={previewColumns.map(c => ({ key: c.key, label: c.label, type: c.type as any }))}
              data={previewData}
              pageSize={20}
              rowHref={drillHref.trim() ? (row) => resolveDrillHref(drillHref.trim(), row) : undefined}
            />
          ) : (
            <div className="flex items-center justify-center rounded-xl border p-16" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <div className="text-center">
                <Database size={32} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
                  {source ? 'Click Run Query to execute' : 'Select a data source to begin'}
                </p>
                <p className="text-xs mt-1 max-w-[300px] mx-auto" style={{ color: 'var(--theme-muted-text)' }}>
                  {source
                    ? 'Configure columns, filters, and grouping, then hit Run Query to see results'
                    : `Choose from ${allSources.length} sources including system tables and your custom data tables`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save dialog */}
      {showSave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSave(false)}>
          <Card className="w-full max-w-md p-6 space-y-4" style={{ backgroundColor: 'var(--theme-card-bg)' }} onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>Save Report</h2>
            <div className="space-y-3">
              <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Report name" autoFocus />
              <textarea
                value={saveDesc}
                onChange={e => setSaveDesc(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={saveShared} onChange={e => setSaveShared(e.target.checked)} className="rounded" />
                <span style={{ color: 'var(--theme-card-text)' }}>Share with team</span>
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowSave(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={!saveName.trim() || saving}>
                {saving ? 'Saving...' : 'Save Report'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function AccordionSection({
  title, id, expanded, onToggle, children,
}: {
  title: string; id: string; expanded: Set<string>; onToggle: (id: string) => void; children: React.ReactNode
}) {
  const isOpen = expanded.has(id)
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold"
        style={{ color: 'var(--theme-card-text)' }}
      >
        {title}
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}
