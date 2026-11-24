'use client'

/**
 * Agents → Costs & budgets charts: cost over time stacked by model (or by
 * profile) and the share of cost by model as a donut. Drawn with the shared
 * report chart kit (theme series colours, hairline grid, tooltips, a Table
 * toggle). Load through cost-breakdown.tsx's dynamic import so recharts stays
 * out of the page's first-load chunk.
 */
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_TICK, BAND_GAP, BASE_AXIS, CURSOR_FILL, ChartFrame, ChartTooltip, GRID_PROPS, LEGEND_PROPS, VALUE_AXIS, useSeriesColors } from '@/components/reports/chart-kit'
import { Legend } from 'recharts'
import { formatCost } from '@/lib/agents/pricing'
import type { BreakdownRow, CostSeries } from '@/lib/agents/cost-breakdown'

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts event payloads */

const MAX_SLICES = 8

export function CostOverTimeChart({ series, currency, title, onSelect }: { series: CostSeries; currency: string; title: string; onSelect?: (key: string) => void }) {
  const colors = useSeriesColors(series.keys.length)
  const money = (v: unknown) => formatCost(Number(v) || 0, currency)
  const empty = series.keys.length === 0
  return (
    <ChartFrame
      title={title}
      table={{
        caption: title,
        columns: ['Day', ...series.keys.map((k) => series.labels[k] ?? k)],
        rows: series.points.map((p) => [p.day, ...series.keys.map((k) => money(p[k]))]),
      }}
    >
      {empty ? <p className="py-10 text-center text-xs text-fg-muted">No priced AI calls in this period.</p> : (
        <div style={{ height: 240 }} data-testid="cost-over-time">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series.points} barCategoryGap={BAND_GAP}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="day" tick={AXIS_TICK} {...BASE_AXIS} tickFormatter={(d: string) => d.slice(5)} minTickGap={16} />
              <YAxis tick={AXIS_TICK} {...VALUE_AXIS} width={56} tickFormatter={(v: number) => money(v)} />
              <Tooltip cursor={CURSOR_FILL} content={<ChartTooltip valueFormatter={money} />} />
              <Legend {...LEGEND_PROPS} />
              {series.keys.map((k, i) => (
                <Bar key={k} dataKey={k} name={series.labels[k] ?? k} stackId="cost" fill={colors[i % colors.length]} isAnimationActive={false}
                  cursor={onSelect && k !== 'other' ? 'pointer' : undefined} onClick={() => { if (k !== 'other') onSelect?.(k) }} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  )
}

export function CostShareDonut({ rows, currency, onSelect }: { rows: readonly BreakdownRow[]; currency: string; onSelect?: (row: BreakdownRow) => void }) {
  const priced = rows.filter((r) => r.share > 0)
  const top = priced.slice(0, MAX_SLICES - 1)
  const rest = priced.slice(MAX_SLICES - 1)
  const restShare = rest.reduce((s, r) => s + r.share, 0)
  const slices = [...top.map((r) => ({ name: r.label, value: r.share, row: r as BreakdownRow | null })), ...(rest.length ? [{ name: 'Other', value: restShare, row: null }] : [])]
  const colors = useSeriesColors(slices.length)
  const pct = (v: unknown) => `${Math.round((Number(v) || 0) * 1000) / 10}%`
  return (
    <ChartFrame
      title={`Share of cost by model (${currency})`}
      table={{ caption: 'Share of cost by model', columns: ['Model', 'Share'], rows: slices.map((s) => [s.name, pct(s.value)]) }}
    >
      {slices.length === 0 ? <p className="py-10 text-center text-xs text-fg-muted">No priced AI calls in this period.</p> : (
        <div style={{ height: 240 }} data-testid="cost-share-donut">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip content={<ChartTooltip valueFormatter={pct} />} />
              <Legend {...LEGEND_PROPS} />
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%" paddingAngle={1} isAnimationActive={false}
                onClick={(d: any) => { const row = d?.payload?.row ?? d?.row; if (row) onSelect?.(row) }}>
                {slices.map((s, i) => <Cell key={s.name} fill={colors[i % colors.length]} cursor={s.row && onSelect ? 'pointer' : undefined} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  )
}
