'use client'

/**
 * The report builder's "Charts" panel: add, edit, reorder and remove a
 * report's summary charts (config.charts, lib/report-charts.ts) in plain
 * words — "Count of rows by day (Created)", "Average of Score by Status".
 * Every chart is validated as it is edited (the same zod schema the config
 * normaliser uses); invalid charts are not saved or previewed.
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  MAX_REPORT_CHARTS, REPORT_CHART_BUCKETS, REPORT_CHART_BUCKET_LABELS, REPORT_CHART_MEASURES, REPORT_CHART_MEASURE_LABELS,
  REPORT_CHART_TYPES, REPORT_CHART_TYPE_LABELS, describeReportChart, validateReportChart,
  type ReportChartBucket, type ReportChartMeasureFn, type ReportChartSpec, type ReportChartType,
} from '@/lib/report-charts'
import { cn } from '@/lib/utils'

export interface ChartColumn { key: string; label: string; type?: string }

/** Charts that pass validation (the builder previews and saves only these). */
export function validCharts(charts: ReportChartSpec[], columns?: Iterable<string>): ReportChartSpec[] {
  const keys = columns ? [...columns] : undefined
  return charts.filter((chart) => validateReportChart(chart, keys).length === 0)
}

function newId(charts: ReportChartSpec[]): string {
  const taken = new Set(charts.map((c) => c.id))
  for (let i = charts.length + 1; ; i++) if (!taken.has(`chart_${i}`)) return `chart_${i}`
}

/** Starting points for "Add chart", from the report's columns. */
export function chartPresets(columns: ChartColumn[], noun = 'rows'): Array<{ label: string; chart: Omit<ReportChartSpec, 'id'> }> {
  const date = columns.find((c) => c.key === 'created_at') ?? columns.find((c) => c.type === 'date')
  const category = columns.find((c) => c.type === 'text' && c.key !== 'id' && !/(^|_)id$/.test(c.key))
  const number = columns.find((c) => c.type === 'number')
  const presets: Array<{ label: string; chart: Omit<ReportChartSpec, 'id'> }> = [
    { label: `Total ${noun}`, chart: { title: `Total ${noun}`, type: 'number', measure: { fn: 'count' } } },
  ]
  if (date) {
    presets.push(
      { label: `Count of ${noun} by day`, chart: { title: `${capital(noun)} over time`, type: 'area', dimension: { field: date.key, bucket: 'day' }, measure: { fn: 'count' }, range_days: 30 } },
      { label: `Count of ${noun} by day of the week`, chart: { title: 'By day of the week', type: 'column', dimension: { field: date.key, bucket: 'day_of_week' }, measure: { fn: 'count' } } },
      { label: `Count of ${noun} by hour of the day`, chart: { title: 'By hour of the day', type: 'column', dimension: { field: date.key, bucket: 'hour_of_day' }, measure: { fn: 'count' } } },
      { label: 'Day × hour heatmap', chart: { title: 'When', type: 'heatmap', dimension: { field: date.key }, measure: { fn: 'count' } } },
    )
  }
  if (category) presets.push({ label: `Count of ${noun} by ${category.label}`, chart: { title: `By ${category.label}`, type: 'bar', dimension: { field: category.key }, measure: { fn: 'count' }, top_n: 10 } })
  if (number) presets.push({ label: `Average of ${number.label}`, chart: { title: `Average ${number.label}`, type: 'number', measure: { fn: 'avg', field: number.key } } })
  return presets
}

function capital(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

export function ReportChartsEditor({
  charts, onChange, columns, noun = 'rows',
}: {
  charts: ReportChartSpec[]
  onChange: (charts: ReportChartSpec[]) => void
  columns: ChartColumn[]
  /** What a row is, for the plain-language labels ("responses"). */
  noun?: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const columnKeys = columns.map((c) => c.key)
  const labelOf = (key: string) => columns.find((c) => c.key === key)?.label ?? key
  const full = charts.length >= MAX_REPORT_CHARTS

  const update = (id: string, patch: Partial<ReportChartSpec>) => onChange(charts.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const move = (index: number, by: number) => {
    const next = [...charts]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    onChange(next)
  }
  const add = (chart: Omit<ReportChartSpec, 'id'>) => {
    if (full) return
    const id = newId(charts)
    onChange([...charts, { ...chart, id }])
    setEditing(id)
  }

  return (
    <div className="space-y-2" data-report-charts-editor>
      <p className="text-2xs text-fg-muted">
        Chart cards shown above the report&apos;s table, worked out from all its rows (up to {MAX_REPORT_CHARTS}).
      </p>
      {charts.length === 0 && <p className="text-xs text-fg-muted">No charts yet.</p>}
      <ol className="space-y-2">
        {charts.map((chart, index) => {
          const errors = validateReportChart(chart, columnKeys)
          const open = editing === chart.id
          return (
            <li key={chart.id} className={cn('rounded-md border p-2', errors.length ? 'border-danger' : 'border-border')} data-chart-row={chart.id}>
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">{chart.title || 'Untitled chart'}</p>
                  <p className="text-2xs text-fg-muted">{REPORT_CHART_TYPE_LABELS[chart.type]} · {describeReportChart(chart, labelOf, noun)}</p>
                </div>
                <IconButton size="sm" label="Move up" icon={<ArrowUp />} disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton size="sm" label="Move down" icon={<ArrowDown />} disabled={index === charts.length - 1} onClick={() => move(index, 1)} />
                <IconButton size="sm" label={open ? 'Done' : 'Edit chart'} icon={open ? <Check /> : <Pencil />} onClick={() => setEditing(open ? null : chart.id)} />
                <IconButton size="sm" label="Remove chart" icon={<Trash2 />} onClick={() => { onChange(charts.filter((c) => c.id !== chart.id)); if (open) setEditing(null) }} />
              </div>
              {open && <ChartForm chart={chart} columns={columns} noun={noun} onPatch={(patch) => update(chart.id, patch)} />}
              {errors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-2xs text-danger" role="alert">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} disabled={full || columns.length === 0}>
            {full ? `${MAX_REPORT_CHARTS} charts at most` : 'Add chart'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {chartPresets(columns, noun).map((preset) => (
            <DropdownMenuItem key={preset.label} onSelect={() => add(preset.chart)}>{preset.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ChartForm({ chart, columns, noun, onPatch }: { chart: ReportChartSpec; columns: ChartColumn[]; noun: string; onPatch: (patch: Partial<ReportChartSpec>) => void }) {
  const dateColumns = columns.filter((c) => c.type === 'date')
  const numberColumns = columns.filter((c) => c.type === 'number')
  const otherColumns = columns.filter((c) => c.type !== 'number')
  const dimensionColumn = columns.find((c) => c.key === chart.dimension?.field)
  const isDate = dimensionColumn?.type === 'date'
  const categorical = chart.type !== 'number' && chart.type !== 'heatmap' && !chart.dimension?.bucket
  const field = (label: string, control: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-2xs font-medium text-fg-muted">{label}</span>
      {control}
    </label>
  )

  function setType(type: ReportChartType) {
    const patch: Partial<ReportChartSpec> = { type }
    if (type === 'number') { patch.dimension = undefined; patch.top_n = undefined; patch.categories = undefined }
    else if (!chart.dimension) {
      const first = type === 'line' || type === 'area' || type === 'heatmap' ? dateColumns[0] : otherColumns.find((c) => c.type !== 'date') ?? otherColumns[0]
      if (first) patch.dimension = { field: first.key, ...(first.type === 'date' && type !== 'heatmap' ? { bucket: 'day' as const } : {}) }
    }
    if (type === 'heatmap' && chart.dimension) patch.dimension = { field: dateColumns.some((c) => c.key === chart.dimension!.field) ? chart.dimension.field : dateColumns[0]?.key ?? chart.dimension.field }
    if ((type === 'line' || type === 'area') && chart.dimension && !chart.dimension.bucket) patch.dimension = { field: dateColumns[0]?.key ?? chart.dimension.field, bucket: 'day' }
    onPatch(patch)
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border-subtle pt-2">
      <div className="col-span-2">{field('Title', <Input size="sm" value={chart.title} maxLength={120} onChange={(e) => onPatch({ title: e.target.value })} />)}</div>
      {field('Chart', (
        <Select size="sm" value={chart.type} onChange={(e) => setType(e.target.value as ReportChartType)}
          options={REPORT_CHART_TYPES.map((t) => ({ value: t, label: REPORT_CHART_TYPE_LABELS[t] }))} />
      ))}
      {field('Show', (
        <Select size="sm" value={chart.measure.fn}
          onChange={(e) => {
            const fn = e.target.value as ReportChartMeasureFn
            onPatch({ measure: fn === 'count' ? { fn } : { fn, field: chart.measure.field ?? numberColumns[0]?.key } })
          }}
          options={REPORT_CHART_MEASURES.map((m) => ({ value: m, label: m === 'count' ? `Count of ${noun}` : `${REPORT_CHART_MEASURE_LABELS[m]} of…` }))} />
      ))}
      {chart.measure.fn !== 'count' && (
        <div className="col-span-2">{field(`${REPORT_CHART_MEASURE_LABELS[chart.measure.fn]} of`, (
          <Select size="sm" value={chart.measure.field ?? ''} placeholder="Choose a column" onChange={(e) => onPatch({ measure: { fn: chart.measure.fn, field: e.target.value || undefined } })}>
            {numberColumns.length > 0 && <optgroup label="Numbers">{numberColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>}
            {otherColumns.length > 0 && <optgroup label="Other columns">{otherColumns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>}
          </Select>
        ))}</div>
      )}
      {chart.type !== 'number' && (
        <>
          {field(chart.type === 'heatmap' ? 'Date column' : 'Split by', (
            <Select size="sm" value={chart.dimension?.field ?? ''} placeholder="Choose a column"
              onChange={(e) => {
                const col = columns.find((c) => c.key === e.target.value)
                if (!col) { onPatch({ dimension: undefined }); return }
                const bucket = col.type === 'date' && chart.type !== 'heatmap' ? (chart.dimension?.bucket ?? 'day') : undefined
                onPatch({ dimension: { field: col.key, ...(bucket ? { bucket } : {}) }, ...(bucket ? { top_n: undefined, categories: undefined } : {}) })
              }}
              options={(chart.type === 'heatmap' ? dateColumns : columns).map((c) => ({ value: c.key, label: c.label }))} />
          ))}
          {isDate && chart.type !== 'heatmap' && field('Group dates by', (
            <Select size="sm" value={chart.dimension?.bucket ?? ''} placeholder={chart.type === 'line' || chart.type === 'area' ? undefined : 'Each value'}
              onChange={(e) => onPatch({ dimension: { field: chart.dimension!.field, ...(e.target.value ? { bucket: e.target.value as ReportChartBucket } : {}) } })}
              options={REPORT_CHART_BUCKETS.map((b) => ({ value: b, label: capital(REPORT_CHART_BUCKET_LABELS[b]) }))} />
          ))}
          {categorical && field('Largest only', (
            <Input size="sm" type="number" min={1} max={50} placeholder="All" value={chart.top_n ?? ''}
              onChange={(e) => onPatch({ top_n: e.target.value ? Math.max(1, Math.min(50, Math.round(Number(e.target.value)))) : undefined })} />
          ))}
        </>
      )}
      {(chart.type === 'number' ? dateColumns.length > 0 : Boolean(chart.dimension?.bucket) || chart.type === 'heatmap') && (
        <>
          {field('Only the last … days', (
            <Input size="sm" type="number" min={1} max={3660} placeholder="All time" value={chart.range_days ?? ''}
              onChange={(e) => {
                const days = e.target.value ? Math.max(1, Math.min(3660, Math.round(Number(e.target.value)))) : undefined
                onPatch({ range_days: days, ...(chart.type === 'number' ? { window_field: days ? (chart.window_field ?? dateColumns[0]?.key) : undefined } : {}) })
              }} />
          ))}
          {chart.type === 'number' && chart.range_days ? field('Of the date', (
            <Select size="sm" value={chart.window_field ?? ''} onChange={(e) => onPatch({ window_field: e.target.value || undefined })}
              options={dateColumns.map((c) => ({ value: c.key, label: c.label }))} />
          )) : null}
        </>
      )}
    </div>
  )
}
