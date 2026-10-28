'use client'

import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, FunnelChart, Funnel, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Label,
} from 'recharts'
import { useThemeChartColors } from '@/components/providers/theme-provider'

interface ReportChartProps {
  type: 'bar' | 'line' | 'area' | 'pie' | 'radar' | 'scatter' | 'funnel' | 'stacked-bar' | 'horizontal-bar'
  data: any[]
  xKey?: string
  yKeys?: string[]
  nameKey?: string
  valueKey?: string
  title?: string
  height?: number
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

export function ReportChart({
  type, data, xKey = 'name', yKeys = ['value'], nameKey = 'name', valueKey = 'value',
  title, height = 300, style,
}: ReportChartProps) {
  // Series colours: the report's own palette, else the workspace theme's.
  const themeColors = useThemeChartColors()
  if (!data.length) {
    return (
      <div className="flex items-center justify-center rounded-xl border p-8" style={{ height, borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <span className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No data available</span>
      </div>
    )
  }

  const colors = style?.colors && style.colors.length > 0 ? style.colors : themeColors
  const displayTitle = style?.chart_title || title
  const showGrid = !style?.hide_grid
  const showLegend = !style?.hide_legend
  const xLabel = style?.x_axis_label
  const yLabel = style?.y_axis_label

  const tooltipStyle = {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid var(--theme-surface-border)',
    backgroundColor: 'var(--theme-card-bg)',
    color: 'var(--theme-card-text)',
  }
  const axisTick = { fontSize: 11, fill: 'var(--theme-muted-text)' }
  const axisLabelStyle = { fontSize: 11, fill: 'var(--theme-muted-text)', textAnchor: 'middle' as const }
  // An x-axis title gets its own band under the tick labels (it used to sit at
  // offset -5, below the axis, where the bottom legend overlapped it).
  const xAxisHeight = xLabel ? 46 : 30
  const legendStyle = { fontSize: 11, paddingTop: 6 }

  // Render Cartesian common bits once — bar/stacked-bar/line/area all share
  // the same axis + grid + tooltip config.
  function cartesianCommon(horizontal = false) {
    return (
      <>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />}
        {horizontal ? (
          <>
            <XAxis type="number" tick={axisTick} height={xAxisHeight}>
              {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={axisLabelStyle} />}
            </XAxis>
            <YAxis type="category" dataKey={xKey} tick={axisTick} width={100}>
              {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={axisLabelStyle} />}
            </YAxis>
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={axisTick} height={xAxisHeight}>
              {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={axisLabelStyle} />}
            </XAxis>
            <YAxis tick={axisTick}>
              {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={axisLabelStyle} />}
            </YAxis>
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--theme-surface)' }} />
        {showLegend && <Legend wrapperStyle={legendStyle} />}
      </>
    )
  }

  const chart = (() => {
    if (type === 'bar') {
      return (
        <BarChart data={data}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[4, 4, 0, 0]} />
          ))}
        </BarChart>
      )
    }
    if (type === 'stacked-bar') {
      return (
        <BarChart data={data}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="stack" fill={colors[i % colors.length]} />
          ))}
        </BarChart>
      )
    }
    if (type === 'horizontal-bar') {
      // Horizontal bars — swap the X and Y dataKey roles in layout="vertical"
      return (
        <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
          {cartesianCommon(true)}
          {yKeys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={colors[i % colors.length]} radius={[0, 4, 4, 0]} />
          ))}
        </BarChart>
      )
    }
    if (type === 'line') {
      return (
        <LineChart data={data}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
      )
    }
    if (type === 'area') {
      return (
        <AreaChart data={data}>
          {cartesianCommon()}
          {yKeys.map((k, i) => (
            <Area key={k} type="monotone" dataKey={k} fill={colors[i % colors.length]} fillOpacity={0.2} stroke={colors[i % colors.length]} strokeWidth={2} />
          ))}
        </AreaChart>
      )
    }
    if (type === 'pie') {
      return (
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%" outerRadius={height / 3} label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={legendStyle} />}
        </PieChart>
      )
    }
    if (type === 'radar') {
      return (
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={data}>
          {showGrid && <PolarGrid stroke="var(--theme-surface-border)" />}
          <PolarAngleAxis dataKey={nameKey} tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
          <PolarRadiusAxis tick={{ fontSize: 9, fill: 'var(--theme-muted-text)' }} />
          {yKeys.map((k, i) => (
            <Radar key={k} name={k} dataKey={k} stroke={colors[i % colors.length]} fill={colors[i % colors.length]} fillOpacity={0.15} />
          ))}
          <Tooltip contentStyle={tooltipStyle} />
          {showLegend && <Legend wrapperStyle={legendStyle} />}
        </RadarChart>
      )
    }
    if (type === 'scatter') {
      return (
        <ScatterChart>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />}
          <XAxis dataKey={xKey} type="number" tick={axisTick} name={xKey} height={xAxisHeight}>
            {xLabel && <Label value={xLabel} position="insideBottom" offset={0} style={axisLabelStyle} />}
          </XAxis>
          <YAxis dataKey={yKeys[0]} type="number" tick={axisTick} name={yKeys[0]}>
            {yLabel && <Label value={yLabel} angle={-90} position="insideLeft" style={axisLabelStyle} />}
          </YAxis>
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={data} fill={colors[0]} />
        </ScatterChart>
      )
    }
    if (type === 'funnel') {
      return (
        <FunnelChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Funnel dataKey={valueKey} data={data} isAnimationActive>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            <LabelList position="right" fill="var(--theme-card-text)" stroke="none" dataKey={nameKey} style={{ fontSize: 11 }} />
          </Funnel>
        </FunnelChart>
      )
    }
    return null
  })()

  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
      {displayTitle && <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-card-text)' }}>{displayTitle}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        {chart as any}
      </ResponsiveContainer>
    </div>
  )
}
