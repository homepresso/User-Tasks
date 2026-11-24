'use client'

/**
 * Agents → Costs & budgets → Breakdown: every AI call of the workspace in a
 * period (agent runs, the in-product Agent, PDF import AI assist, redaction
 * AI detection) by model, profile, source, agent and person (admins of the
 * Agent only). Charts: cost over time stacked by model or profile, share by
 * model. Clicking a row (or a chart mark) filters the rest of the page; CSV
 * exports the table shown. Data: the agents.costBreakdown read
 * (lib/agents/cost-breakdown.ts).
 */
import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { formatCost } from '@/lib/agents/pricing'
import {
  breakdownCsv, COST_SOURCE_LABELS, DEFAULT_PROFILE, PERIOD_LABELS, PERIOD_PRESETS,
  type BreakdownRow, type CostBreakdown, type CostFilters, type CostGroupBy, type CostSource, type PeriodPreset,
} from '@/lib/agents/cost-breakdown'

const ChartSkeleton = () => <div className="h-[240px] w-full rounded-lg bg-subtle" aria-busy="true" aria-label="Loading chart" />
const CostOverTimeChart = dynamic(() => import('./cost-charts').then((m) => m.CostOverTimeChart), { ssr: false, loading: ChartSkeleton })
const CostShareDonut = dynamic(() => import('./cost-charts').then((m) => m.CostShareDonut), { ssr: false, loading: ChartSkeleton })

export interface BreakdownState {
  period: PeriodPreset | 'custom'
  from?: string
  to?: string
  filters: CostFilters
}

export type BreakdownData = CostBreakdown & { can_see_people?: boolean }

/** The read's arguments for a state (custom without both dates falls back to the last 30 days). */
export function breakdownArgs(state: BreakdownState, canSeePeople: boolean) {
  const f = Object.fromEntries(Object.entries(state.filters).filter(([, v]) => v)) as Record<string, string>
  const period = state.period === 'custom' ? (state.from || state.to ? { from: state.from || undefined, to: state.to || undefined } : { period: '30d' as const }) : { period: state.period }
  return { ...period, ...f, group_by: ['day', 'model', 'profile', 'agent', 'source', ...(canSeePeople ? ['user'] : [])].join(',') }
}

const money = (n: number, cur: string) => formatCost(n, cur)
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`

function rowMain(r: BreakdownRow, cur: string) { return (r.cost[cur] ?? 0) + (r.estimated_cost[cur] ?? 0) }

function Sparkline({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(...values, 0)
  if (!values.length || max <= 0) return <span className="text-xs text-fg-muted">—</span>
  const w = 72
  const h = 18
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="text-primary">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

type SortKey = 'label' | 'calls' | 'input_tokens' | 'output_tokens' | 'cached_tokens' | 'cost' | 'share' | 'cost_per_1k'

function sortRows(rows: readonly BreakdownRow[], key: SortKey, dir: 'asc' | 'desc', cur: string): BreakdownRow[] {
  const val = (r: BreakdownRow): number | string => key === 'label' ? r.label.toLowerCase() : key === 'cost' ? rowMain(r, cur) : key === 'cost_per_1k' ? r.cost_per_1k ?? -1 : r[key]
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    return (x < y ? -1 : x > y ? 1 : 0) * sign
  })
}

const TABLES: Array<{ value: Exclude<CostGroupBy, 'day'>; text: string }> = [
  { value: 'model', text: 'By model' },
  { value: 'profile', text: 'By profile' },
  { value: 'source', text: 'By source' },
  { value: 'agent', text: 'By agent' },
  { value: 'user', text: 'By person' },
]

const TABLE_NOTES: Partial<Record<CostGroupBy, string>> = {
  profile: 'The in-product Agent (and PDF import / redaction AI) per Agent profile; "Default" = no profile matched. Agent runs have no profile.',
  agent: 'Runs of your agents (workflow steps, API, MCP, tests, apps).',
  user: 'In-product Agent calls per person. Visible to admins of the Agent (assistants.manage) only.',
}

/** The value a row sets as a filter when clicked. */
function rowFilter(by: CostGroupBy, r: BreakdownRow): CostFilters {
  if (by === 'model') return { provider: r.provider || 'unknown', model: r.model || 'unknown' }
  if (by === 'profile') return { profile: r.key }
  if (by === 'source') return { source: r.key }
  if (by === 'agent') return { agent: r.key }
  if (by === 'user') return r.key === 'none' ? {} : { user: r.key }
  return {}
}

function isActive(by: CostGroupBy, r: BreakdownRow, f: CostFilters) {
  const want = rowFilter(by, r)
  const keys = Object.keys(want) as Array<keyof CostFilters>
  return keys.length > 0 && keys.every((k) => f[k] === want[k])
}

/** Cross-filter: clicking a row (or chart mark) filters the page by it; clicking it again removes that filter. */
export function toggleRowFilter(by: CostGroupBy, r: BreakdownRow, filters: CostFilters): CostFilters {
  const want = rowFilter(by, r)
  if (!Object.keys(want).length) return filters
  if (isActive(by, r, filters)) {
    const next = { ...filters }
    for (const k of Object.keys(want) as Array<keyof CostFilters>) delete next[k]
    return next
  }
  return { ...filters, ...want }
}

function filterChips(f: CostFilters, data: BreakdownData | undefined): Array<{ key: keyof CostFilters | 'model_pair'; label: string }> {
  const name = (by: CostGroupBy, key: string) => data?.groups[by]?.find((r) => r.key === key)?.label ?? key
  const out: Array<{ key: keyof CostFilters | 'model_pair'; label: string }> = []
  if (f.model || f.provider) out.push({ key: 'model_pair', label: `Model: ${f.model ?? 'any'}${f.provider ? ` (${f.provider})` : ''}` })
  if (f.profile) out.push({ key: 'profile', label: `Profile: ${f.profile === DEFAULT_PROFILE ? 'Default' : name('profile', f.profile)}` })
  if (f.source) out.push({ key: 'source', label: `Source: ${COST_SOURCE_LABELS[f.source as CostSource] ?? f.source}` })
  if (f.agent) out.push({ key: 'agent', label: `Agent: ${name('agent', f.agent)}` })
  if (f.user) out.push({ key: 'user', label: `Person: ${name('user', f.user)}` })
  return out
}

export function CostBreakdownView({ data, state, onChange, loading, error, canEditPrices, onAddPrice }: {
  data?: BreakdownData
  state: BreakdownState
  onChange: (next: BreakdownState) => void
  loading?: boolean
  error?: string | null
  canEditPrices?: boolean
  /** "Add a price" for a model with no price (adds a row to the workspace's price table and scrolls to it). */
  onAddPrice?: (provider: string, model: string) => void
}) {
  const [table, setTable] = useState<Exclude<CostGroupBy, 'day'>>('model')
  const [chartBy, setChartBy] = useState<'model' | 'profile'>('model')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'cost', dir: 'desc' })
  const cur = data?.currency ?? 'USD'
  const canSeePeople = Boolean(data?.can_see_people)
  const tables = TABLES.filter((t) => t.value !== 'user' || canSeePeople)
  const activeTable = tables.some((t) => t.value === table) ? table : 'model'
  const rows = useMemo(() => sortRows(data?.groups[activeTable] ?? [], sort.key, sort.dir, cur), [data, activeTable, sort, cur])
  const setFilters = (filters: CostFilters) => onChange({ ...state, filters })
  const toggleRow = (by: CostGroupBy, r: BreakdownRow) => setFilters(toggleRowFilter(by, r, state.filters))
  const chips = filterChips(state.filters, data)
  const totals = data?.totals
  const estimated = totals?.estimated_cost[cur] ?? 0

  const downloadCsv = () => {
    const csv = breakdownCsv(rows, activeTable, cur)
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-costs-by-${activeTable}-${data?.period.from ?? ''}-${data?.period.to ?? ''}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const th = (key: SortKey, label: string, numeric = true) => (
    <TH numeric={numeric} col={numeric ? 'number' : 'name'} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}>
        {label}
        {sort.key === key && (sort.dir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </TH>
  )

  return (
    <Card padding="none" data-testid="cost-breakdown">
      <CardHeader
        title="AI cost breakdown"
        description="Every AI call of this workspace: agent runs, the in-product Agent, PDF import AI assist and redaction AI detection. Click a row or a chart mark to filter the page."
      />
      <CardBody className="space-y-4 pt-0">
        <div className="flex flex-wrap items-end gap-2">
          <Select size="sm" aria-label="Period" value={state.period} wrapperClassName="w-40"
            options={[...PERIOD_PRESETS, 'custom' as const].map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
            onChange={(e) => onChange({ ...state, period: e.target.value as BreakdownState['period'] })} />
          {state.period === 'custom' && (
            <>
              <Input size="sm" type="date" aria-label="From" value={state.from ?? ''} onChange={(e) => onChange({ ...state, from: e.target.value })} className="w-40" />
              <Input size="sm" type="date" aria-label="To" value={state.to ?? ''} onChange={(e) => onChange({ ...state, to: e.target.value })} className="w-40" />
            </>
          )}
          {data && <span className="pb-1.5 text-xs text-fg-muted">{data.period.from} – {data.period.to} (UTC)</span>}
          {chips.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5 pb-0.5" aria-label="Filters">
              {chips.map((c) => (
                <li key={c.key}>
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-border bg-subtle px-2 py-0.5 text-xs text-fg hover:bg-panel"
                    aria-label={`Remove filter ${c.label}`}
                    onClick={() => {
                      const next = { ...state.filters }
                      if (c.key === 'model_pair') { delete next.model; delete next.provider } else delete next[c.key]
                      setFilters(next)
                    }}>
                    {c.label}<X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
              {chips.length > 1 && <li><button type="button" className="text-xs text-primary underline" onClick={() => setFilters({})}>Clear all</button></li>}
            </ul>
          )}
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        {loading && !data && <div className="h-40 animate-pulse rounded-lg bg-subtle" aria-busy="true" aria-label="Loading breakdown" />}
        {data && totals && (
          <>
            <StatGrid>
              <StatCard label={`Cost (${cur})`} value={money(totals.main_cost, cur)}>
                <p className="text-xs text-fg-muted">{estimated > 0 ? `incl. ${money(estimated, cur)} estimated at today's prices` : 'at the prices when each call was made'}</p>
              </StatCard>
              <StatCard label="AI calls" value={formatCount(totals.calls)}>
                <p className="text-xs text-fg-muted">agent runs and Agent requests</p>
              </StatCard>
              <StatCard label="Tokens" value={formatCount(totals.total_tokens)}>
                <p className="num text-xs text-fg-muted">{formatCount(totals.input_tokens)} in · {formatCount(totals.output_tokens)} out · {formatCount(totals.cached_tokens)} cached</p>
              </StatCard>
              <StatCard label="Cost unknown" value={plural(totals.unknown_calls, 'call')} tone={totals.unknown_calls ? 'warning' : undefined}>
                <p className="text-xs text-fg-muted">No price for the model</p>
              </StatCard>
            </StatGrid>
            {Object.keys(totals.cost).some((c) => c !== cur) && (
              <p className="text-xs text-fg-muted">Also charged in other currencies (not in the charts): {Object.entries(totals.cost).filter(([c]) => c !== cur).map(([c, a]) => money(a, c)).join(', ')}.</p>
            )}
            {data.truncated && <p role="status" className="text-xs text-warning">This period has more than 50,000 records per table; totals cover the first 50,000. Apply migration 20270126130000 to aggregate in the database.</p>}

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="mb-2 flex justify-end">
                  <SegmentedControl size="sm" aria-label="Stack cost by" value={chartBy} onValueChange={(v) => setChartBy(v as 'model' | 'profile')}
                    options={[{ value: 'model', text: 'By model' }, { value: 'profile', text: 'By profile' }]} />
                </div>
                <CostOverTimeChart series={data.series[chartBy]} currency={cur} title={`Cost per day by ${chartBy} (${cur})`}
                  onSelect={(key) => {
                    const row = data.groups[chartBy]?.find((r) => r.key === key)
                    if (row) toggleRow(chartBy, row)
                  }} />
              </div>
              <div className="lg:pt-10">
                <CostShareDonut rows={data.groups.model ?? []} currency={cur} onSelect={(row) => toggleRow('model', row)} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl size="sm" aria-label="Breakdown table" value={activeTable} onValueChange={(v) => setTable(v as Exclude<CostGroupBy, 'day'>)} options={tables} />
              <Button size="sm" variant="secondary" leadingIcon={<Download />} onClick={downloadCsv} disabled={!rows.length}>Export CSV</Button>
            </div>
            {TABLE_NOTES[activeTable] && <p className="text-xs text-fg-muted">{TABLE_NOTES[activeTable]}</p>}
            <Table bare label={`AI costs ${TABLES.find((t) => t.value === activeTable)?.text.toLowerCase()}`} stickyFirstColumn data-testid={`breakdown-table-${activeTable}`}>
              <THead>
                <tr>
                  {th('label', TABLES.find((t) => t.value === activeTable)!.text.replace('By ', '').replace(/^./, (c) => c.toUpperCase()), false)}
                  {activeTable !== 'model' && <TH col="name">Models</TH>}
                  {th('calls', activeTable === 'agent' ? 'Runs' : 'Calls')}
                  {th('input_tokens', 'Input')}
                  {th('output_tokens', 'Output')}
                  {th('cached_tokens', 'Cached')}
                  {th('cost', `Cost (${cur})`)}
                  {th('share', 'Share')}
                  {th('cost_per_1k', 'Per 1k tokens')}
                  <TH col="name">Trend</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const active = isActive(activeTable, r, state.filters)
                  const est = r.estimated_cost[cur] ?? 0
                  return (
                    <TR key={r.key} selected={active} interactive onClick={() => toggleRow(activeTable, r)} data-row-key={r.key}>
                      <TD className="whitespace-nowrap font-medium">
                        <button type="button" className="text-left hover:underline" aria-pressed={active} onClick={(e) => { e.stopPropagation(); toggleRow(activeTable, r) }}>
                          {activeTable === 'model' ? <span className="font-mono text-xs">{r.label}</span> : r.label}
                        </button>
                        {activeTable === 'model' && <span className="ml-1.5 text-xs text-fg-muted">{r.provider || 'unknown provider'}</span>}
                        {r.monthly_cost_cap ? <span className="ml-1.5 text-xs text-fg-muted">cap {money(r.monthly_cost_cap, cur)}/month</span> : null}
                        {r.capabilities && r.capabilities.length > 0 && (
                          <div className="text-xs font-normal text-fg-muted">{r.capabilities.map((c) => `${c.label} ${plural(c.calls, 'call')}`).join(' · ')}</div>
                        )}
                      </TD>
                      {activeTable !== 'model' && <TD className="max-w-[16rem] truncate font-mono text-xs text-fg-muted" title={(r.models ?? []).join(', ')}>{(r.models ?? []).map((m) => m.split(':').slice(1).join(':')).join(', ')}</TD>}
                      <TD numeric>{formatCount(r.calls)}</TD>
                      <TD numeric>{formatCount(r.input_tokens)}</TD>
                      <TD numeric>{formatCount(r.output_tokens)}</TD>
                      <TD numeric>{formatCount(r.cached_tokens)}</TD>
                      <TD numeric className="whitespace-nowrap">
                        {money(rowMain(r, cur), cur)}
                        {est > 0 && <span className="block text-xs text-fg-muted">incl. {money(est, cur)} estimated</span>}
                        {r.unknown_calls > 0 && (
                          <span className="block text-xs text-warning">
                            {plural(r.unknown_calls, 'call')} cost unknown
                            {activeTable === 'model' && (canEditPrices && onAddPrice
                              ? <> — <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); onAddPrice(r.provider || '*', r.model || '') }}>add a price</button></>
                              : <> — <a className="underline" href="#model-prices" onClick={(e) => e.stopPropagation()}>add a price</a></>)}
                          </span>
                        )}
                      </TD>
                      <TD numeric>{pct(r.share)}</TD>
                      <TD numeric>{r.cost_per_1k != null ? money(r.cost_per_1k, cur) : '—'}</TD>
                      <TD><Sparkline values={r.trend} label={`${r.label}: cost per day`} /></TD>
                    </TR>
                  )
                })}
                {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-fg-muted">No AI calls in this period{chips.length ? ' for these filters' : ''}.</td></tr>}
              </TBody>
            </Table>
            {data.estimated && <p className="text-xs text-fg-muted">Estimated: calls recorded without a cost (their model had no price then) are costed at today&apos;s price. Stored costs never change.</p>}
          </>
        )}
      </CardBody>
    </Card>
  )
}
