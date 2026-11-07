'use client'

import { useIsMobile } from '@/hooks/use-mobile'
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Label,
} from 'recharts'
import { BarChart3 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import {
  AXIS_LABEL, AXIS_TICK, BAND_GAP, BAR_MAX, BASE_AXIS, CURSOR_FILL, ChartFrame, ChartTooltip, GRID_PROPS,
  LEGEND_PROPS, VALUE_AXIS, useSeriesColors, type ChartTableData,
} from './chart-kit'

/* eslint-disable @typescript-eslint/no-explicit-any -- report rows are untyped records */

interface ReportChartProps {
  type: 'bar' | 'line' | 'area' | 'pie' | 'radar' | 'scatter' | 'funnel' | 'stacked-bar' | 'horizontal-bar'
  data: any[]
  xKey?: string
  yKeys?: string[]
  nameKey?: string
  valueKey?: string
  title?: string
  height?: number
  /** Legend / tooltip names of the series (column labels), by key. */
  seriesLabels?: Record<string, string>
  /** Optional style overrides from saved report config */
  style?: {
    colors?: string[]
    chart_title?: string
    x_axis_label?: string
    y_axis_label?: string
    hide_legend?: boolean
    hide_grid?: boolean
  }
}

function cellText(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(v)
  return String(v)
}

export function ReportChart({
  type, data, xKey = 'name', yKeys = ['value'], nameKey = 'name', valueKey = 'value',
  title, height = 300, style, seriesLabels,
}: ReportChartProps) {
  const categorical = type === 'pie' || type === 'funnel'
  // Series colours: the report's own palette (unless it is the old default blue), else the theme's via the resolver.
  const colors = useSeriesColors(categorical ? data.length : Math.max(yKeys.length, 1), style?.colors)
  const displayTitle = style?.chart_title || title
  const showGrid = !style?.hide_grid
  const showLegend = !style?.hide_legend
  const xLabel = style?.x_axis_label
  const yLabel = style?.y_axis_label
  const label = (k: string) => seriesLabels?.[k] ?? k
  // Phones: no slice labels on pies (they collide and clip at this width; the legend and tooltip name the slices).
  const mobile = useIsMobile()

  if (!data.length) {
    return (
      <ChartFrame title={displayTitle}>
        <div className="flex items-center justify-center" style={{ minHeight: Math.min(height, 200) }}>
          <EmptyState size="sm" variant="no-results" icon={BarChart3} title="Nothing to chart yet" description="No rows match this report's filters." />
        </div>
      </ChartFrame>
    )
  }

  const table: ChartTableData = categorical
    ? { caption: displayTitle ?? 'Chart data', columns: [label(nameKey), label(valueKey)], rows: data.map((d) => [cellText(d[nameKey]), cellText(d[valueKey])]) }
    : { caption: displayTitle ?? 'Chart data', columns: [label(xKey), ...yKeys.map(label)], rows: data.map((d) => [cellText(d[xKey]), ...yKeys.map((k) => cellText(d[k]))]) }

  // An x-axis title gets its own band under the tick labels.
  const xAxisHeight = xLabel ? 46 : 30
  const legend = showLegend && (categorical || yKeys.length > 1) ? <Legend {...LEGEND_PROPS} /> : null
  const tooltip = <Tooltip content={<ChartTooltip />} cursor={CURSOR_FILL} />

  // Shared by bar / stacked-bar / line / area.
  function cartesianCommon(horizontal = false) {
    return (
      <>
        {showGrid && <CartesianGrid {...GRID_PROPS} vertical={horizontal} horizontal={!horizontal} />}
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} height={xAxisHeight} {...VALUE_AXIS}>
              {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={AXIS_LABEL} />}
            </XAxis>
            <YAxis type="category" dataKey={xKey} tick={AXIS_TICK} width={100} {...BASE_AXIS}>
              {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={AXIS_LABEL} />}
            </YAxis>
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={AXIS_TICK} height={xAxisHeight} interval="preserveStartEnd" minTickGap={12} {...BASE_AXIS}>
              {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={AXIS_LABEL} />}
            </XAxis>
            <YAxis tick={AXIS_TICK} width={44} {...VALUE_AXIS}>
              {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={AXIS_LABEL} />}
            </YAxis>
          </>
        )}
        {tooltip}
        {legend}
      </>
    )
  }

  const margin = { top: 4, right: 8, bottom: 0, left: 0 }
  const chart = (() => {
    if (type === 'bar') {
      return (
        <BarChart data={data} margin={margin} barCategoryGap={BAND_GAP}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Bar key={k} name={label(k)} dataKey={k} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} maxBarSize={BAR_MAX} isAnimationActive={false} />
          ))}
        </BarChart>
      )
    }
    if (type === 'stacked-bar') {
      return (
        <BarChart data={data} margin={margin} barCategoryGap={BAND_GAP}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Bar key={k} name={label(k)} dataKey={k} stackId="stack" fill={colors[i % colors.length]} maxBarSize={BAR_MAX} isAnimationActive={false} />
          ))}
        </BarChart>
      )
    }
    if (type === 'horizontal-bar') {
      return (
        <BarChart data={data} layout="vertical" margin={{ ...margin, left: 12, right: 16 }} barCategoryGap={BAND_GAP}>
          {cartesianCommon(true)}
          {yKeys.map((k, i) => (
            <Bar key={k} name={label(k)} dataKey={k} fill={colors[i % colors.length]} radius={[0, 4, 4, 0]} maxBarSize={BAR_MAX} isAnimationActive={false} />
          ))}
        </BarChart>
      )
    }
    if (type === 'line') {
      return (
        <LineChart data={data} margin={margin}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Line key={k} name={label(k)} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={data.length <= 24 ? { r: 2.5 } : false} isAnimationActive={false} />
          ))}
        </LineChart>
      )
    }
    if (type === 'area') {
      return (
        <AreaChart data={data} margin={margin}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Area key={k} name={label(k)} type="monotone" dataKey={k} fill={colors[i % colors.length]} fillOpacity={0.15} stroke={colors[i % colors.length]} strokeWidth={2} isAnimationActive={false} />
          ))}
        </AreaChart>
      )
    }
    if (type === 'pie') {
      return (
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%" innerRadius={height / 5} outerRadius={height / 3} paddingAngle={1}
            stroke="var(--theme-card-bg)" isAnimationActive={false}
            label={mobile ? false : ({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          {tooltip}
          {legend}
        </PieChart>
      )
    }
    if (type === 'radar') {
      return (
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
          {showGrid && <PolarGrid stroke="var(--ds-border-subtle)" />}
          <PolarAngleAxis dataKey={nameKey} tick={AXIS_TICK} />
          <PolarRadiusAxis tick={AXIS_TICK} axisLine={false} />
          {yKeys.map((k, i) => (
            <Radar key={k} name={label(k)} dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.15} isAnimationActive={false} />
          ))}
          {tooltip}
          {legend}
        </RadarChart>
      )
    }
    if (type === 'scatter') {
      return (
        <ScatterChart margin={margin}>
          {showGrid && <CartesianGrid {...GRID_PROPS} />}
          <XAxis dataKey={xKey} type="number" tick={AXIS_TICK} name={label(xKey)} height={xAxisHeight} {...BASE_AXIS}>
            {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={AXIS_LABEL} />}
          </XAxis>
          <YAxis dataKey={yKeys[0]} type="number" tick={AXIS_TICK} name={label(yKeys[0])} width={44} {...VALUE_AXIS}>
            {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={AXIS_LABEL} />}
          </YAxis>
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--ds-border)' }} />
          <Scatter data={data} fill={colors[0]} isAnimationActive={false} />
        </ScatterChart>
      )
    }
    if (type === 'funnel') {
      return (
        <FunnelChart>
          {tooltip}
          <Funnel dataKey={valueKey} data={data} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            <LabelList position="right" fill="var(--theme-card-text)" stroke="none" dataKey={nameKey} style={{ fontSize: 11 }} />
          </Funnel>
        </FunnelChart>
      )
    }
    return null
  })()

  return (
    <ChartFrame title={displayTitle} table={table}>
      <ResponsiveContainer width="100%" height={height}>
        {chart as any}
      </ResponsiveContainer>
    </ChartFrame>
  )
}
