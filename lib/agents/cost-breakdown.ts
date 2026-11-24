/**
 * AI cost breakdowns (client-safe, pure): Agents → Costs & budgets and
 * GET /api/v1/agents/usage?group_by=… (MCP agents_workspace_usage_get, CLI
 * `agents workspace-usage`).
 *
 * Input is a "cube": usage rows already grouped per UTC day, source,
 * provider, model, agent, profile, capability, person, cost status and
 * currency — from the SQL function public.ai_usage_breakdown, or built here
 * from raw rows (cubeFromAgentRuns / cubeFromAssistantUsage) when the
 * function isn't deployed yet. rollupBreakdown() filters it and rolls it up
 * by model, profile, agent, source, person and day.
 *
 * Cost: the cost stored with each call (the price in effect when it was
 * made) when there is one. A call recorded without a cost whose model has a
 * price today is costed at today's price and reported separately as
 * `estimated_cost`; one with no price even today stays "cost unknown"
 * (`unknown_calls`) — never guessed.
 */
import { costOf, resolvePrice, type ModelPrice } from './pricing'

/** Where an AI call came from. */
export const COST_SOURCES = ['assistant', 'workflow_agent', 'agent', 'pdf_import', 'redact_ai'] as const
export type CostSource = (typeof COST_SOURCES)[number]
export const COST_SOURCE_LABELS: Record<CostSource, string> = {
  assistant: 'In-product Agent',
  workflow_agent: 'Workflow agents',
  agent: 'Agents (API, MCP, tests, apps)',
  pdf_import: 'PDF import AI assist',
  redact_ai: 'Redaction AI detection',
}
/** Sources recorded in assistant_usage (they carry an Agent profile and a capability). */
export const PROFILE_SOURCES: readonly CostSource[] = ['assistant', 'pdf_import', 'redact_ai']

export const GROUP_BYS = ['day', 'model', 'profile', 'agent', 'source', 'user'] as const
export type CostGroupBy = (typeof GROUP_BYS)[number]

export const PERIOD_PRESETS = ['7d', '30d', '90d', 'this_month', 'last_month'] as const
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]
export const PERIOD_LABELS: Record<PeriodPreset | 'custom', string> = {
  '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', this_month: 'This month', last_month: 'Last month', custom: 'Custom range',
}
/** Longest period one breakdown covers. */
export const MAX_PERIOD_DAYS = 366

/** The profile key of requests no profile matched. */
export const DEFAULT_PROFILE = 'default'

export interface CubeRow {
  day: string
  source: CostSource
  provider: string | null
  model: string | null
  agent_id: string | null
  profile: string | null
  capability: string | null
  user_id: string | null
  cost_status: 'priced' | 'unknown'
  cost_currency: string | null
  calls: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  cache_write_tokens: number
  total_tokens: number
  cost_amount: number | null
}

export interface CostFilters {
  provider?: string | null
  model?: string | null
  profile?: string | null
  agent?: string | null
  source?: string | null
  user?: string | null
}

export interface Period { from: string; to: string; preset: PeriodPreset | 'custom'; days: string[] }

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const validDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(dayMs(v)) && isoDay(dayMs(v)) === v

export class PeriodError extends Error {
  constructor(message: string) { super(message); this.name = 'PeriodError' }
}

/**
 * The period of a breakdown: inclusive UTC days `from`..`to`. A preset, or
 * from/to (custom; to defaults to today, from to 30 days before to), or
 * `days` (the last N days including today, the legacy parameter).
 */
export function resolvePeriod(input: { preset?: string | null; from?: string | null; to?: string | null; days?: number | null }, now: Date = new Date()): Period {
  const today = isoDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const lastN = (n: number) => ({ from: isoDay(dayMs(today) - (n - 1) * DAY_MS), to: today })
  let range: { from: string; to: string }
  let preset: Period['preset']
  if (input.from || input.to) {
    if (input.from && !validDay(input.from)) throw new PeriodError('from must be a date (YYYY-MM-DD)')
    if (input.to && !validDay(input.to)) throw new PeriodError('to must be a date (YYYY-MM-DD)')
    const to = input.to ?? today
    const from = input.from ?? isoDay(dayMs(to) - 29 * DAY_MS)
    if (from > to) throw new PeriodError('from must be on or before to')
    range = { from, to }
    preset = 'custom'
  } else {
    const p = (input.preset ?? '') as PeriodPreset
    if (input.preset && !PERIOD_PRESETS.includes(p)) throw new PeriodError(`period must be one of ${PERIOD_PRESETS.join(', ')}`)
    if (p === 'this_month') range = { from: `${today.slice(0, 8)}01`, to: today }
    else if (p === 'last_month') {
      const end = dayMs(`${today.slice(0, 8)}01`) - DAY_MS
      range = { from: `${isoDay(end).slice(0, 8)}01`, to: isoDay(end) }
    } else if (p) range = lastN(Number(p.replace('d', '')))
    else range = lastN(Math.min(Math.max(Math.floor(Number(input.days) || 30), 1), 90))
    preset = p || (input.days && Number(input.days) !== 30 ? 'custom' : '30d')
  }
  const span = Math.round((dayMs(range.to) - dayMs(range.from)) / DAY_MS) + 1
  if (span > MAX_PERIOD_DAYS) throw new PeriodError(`A period covers at most ${MAX_PERIOD_DAYS} days`)
  const days: string[] = []
  for (let t = dayMs(range.from); t <= dayMs(range.to); t += DAY_MS) days.push(isoDay(t))
  return { ...range, preset, days }
}

/** [from, to) timestamps of a period, for the queries. */
export function periodBounds(period: Pick<Period, 'from' | 'to'>): { fromIso: string; toIso: string } {
  return { fromIso: `${period.from}T00:00:00.000Z`, toIso: new Date(dayMs(period.to) + DAY_MS).toISOString() }
}

/* ── Cube from raw rows (fallback when public.ai_usage_breakdown isn't deployed) ── */

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

function cubeKey(r: Omit<CubeRow, 'calls' | 'input_tokens' | 'output_tokens' | 'cached_tokens' | 'cache_write_tokens' | 'total_tokens' | 'cost_amount'>): string {
  return [r.day, r.source, r.provider, r.model, r.agent_id, r.profile, r.capability, r.user_id, r.cost_status, r.cost_currency].map((v) => v ?? '').join('\u0001')
}

function addToCube(cube: Map<string, CubeRow>, row: CubeRow) {
  const key = cubeKey(row)
  const hit = cube.get(key)
  if (!hit) { cube.set(key, { ...row }); return }
  hit.calls += row.calls
  hit.input_tokens += row.input_tokens
  hit.output_tokens += row.output_tokens
  hit.cached_tokens += row.cached_tokens
  hit.cache_write_tokens += row.cache_write_tokens
  hit.total_tokens += row.total_tokens
  if (row.cost_amount !== null) hit.cost_amount = (hit.cost_amount ?? 0) + row.cost_amount
}

const dayOf = (ts: unknown) => {
  const t = Date.parse(String(ts ?? ''))
  return Number.isFinite(t) ? isoDay(t) : null
}

/** agent_runs rows → cube rows (same rules as the SQL function). */
export function cubeFromAgentRuns(rows: readonly any[]): CubeRow[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cube = new Map<string, CubeRow>()
  for (const r of rows) {
    const day = dayOf(r.started_at)
    if (!day) continue
    const priced = r.cost_status === 'priced' && Boolean(r.cost_currency)
    const provider = r.price?.provider && r.price.provider !== '*' ? String(r.price.provider) : null
    const input = n(r.input_tokens)
    const output = n(r.output_tokens)
    addToCube(cube, {
      day, source: r.caller_type === 'workflow_node' || r.workflow_run_id ? 'workflow_agent' : 'agent',
      provider, model: r.model ?? null, agent_id: r.agent_id ?? null, profile: null, capability: null, user_id: null,
      cost_status: priced ? 'priced' : 'unknown', cost_currency: priced ? String(r.cost_currency) : null,
      calls: 1, input_tokens: input, output_tokens: output,
      cached_tokens: typeof r.usage?.cached_tokens === 'number' ? r.usage.cached_tokens : 0,
      cache_write_tokens: typeof r.usage?.cache_write_tokens === 'number' ? r.usage.cache_write_tokens : 0,
      total_tokens: r.total_tokens == null ? input + output : n(r.total_tokens),
      cost_amount: priced ? n(r.cost_amount) : null,
    })
  }
  return Array.from(cube.values())
}

/** assistant_usage rows → cube rows. */
export function cubeFromAssistantUsage(rows: readonly any[]): CubeRow[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const cube = new Map<string, CubeRow>()
  for (const r of rows) {
    const day = dayOf(r.created_at)
    if (!day) continue
    const priced = r.cost_status === 'priced' && Boolean(r.cost_currency)
    const source = (COST_SOURCES as readonly string[]).includes(r.source) ? r.source as CostSource : 'assistant'
    addToCube(cube, {
      day, source, provider: r.provider ?? null, model: r.model ?? null, agent_id: null, profile: r.model_rule ?? null,
      capability: r.capability ?? null, user_id: r.user_id ?? null,
      cost_status: priced ? 'priced' : 'unknown', cost_currency: priced ? String(r.cost_currency) : null,
      calls: 1, input_tokens: n(r.prompt_tokens), output_tokens: n(r.completion_tokens), cached_tokens: n(r.cached_tokens), cache_write_tokens: 0,
      total_tokens: n(r.total_tokens), cost_amount: priced ? n(r.cost_amount) : null,
    })
  }
  return Array.from(cube.values())
}

/** Rows of public.ai_usage_breakdown → cube rows (numbers arrive as strings from numeric / bigint). */
export function cubeFromRpc(rows: readonly any[]): CubeRow[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  return rows.map((r) => {
    const priced = r.cost_status === 'priced' && Boolean(r.cost_currency)
    return {
      day: String(r.day).slice(0, 10),
      source: (COST_SOURCES as readonly string[]).includes(r.source) ? r.source : 'assistant',
      provider: r.provider ?? null, model: r.model ?? null, agent_id: r.agent_id ?? null, profile: r.profile ?? null,
      capability: r.capability ?? null, user_id: r.user_id ?? null,
      cost_status: priced ? 'priced' : 'unknown', cost_currency: priced ? String(r.cost_currency) : null,
      calls: n(r.calls), input_tokens: n(r.input_tokens), output_tokens: n(r.output_tokens), cached_tokens: n(r.cached_tokens),
      cache_write_tokens: n(r.cache_write_tokens), total_tokens: n(r.total_tokens), cost_amount: priced ? n(r.cost_amount) : null,
    } as CubeRow
  })
}

/* ── Rollup ── */

export interface CostAmounts {
  calls: number
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  total_tokens: number
  /** Stored cost (at the price in effect when the call was made), per currency. */
  cost: Record<string, number>
  /** Calls recorded without a cost, costed at today's price, per currency. */
  estimated_cost: Record<string, number>
  /** Calls recorded without a cost. */
  unpriced_calls: number
  /** Of those, calls whose model has no price even today: cost unknown. */
  unknown_calls: number
}

export interface BreakdownRow extends CostAmounts {
  key: string
  label: string
  provider?: string | null
  model?: string | null
  /** provider:model keys this row used (profile / agent / source / person rows). */
  models?: string[]
  /** Share of the table's total in the main currency (stored + estimated), 0..1. */
  share: number
  /** Main-currency cost (stored + estimated) per 1,000 tokens; null without tokens or cost. */
  cost_per_1k: number | null
  /** Main-currency cost (stored + estimated) per day of the period. */
  trend: number[]
  /** Profile rows: calls / cost per capability (form, task, designer). */
  capabilities?: Array<{ capability: string; label: string; calls: number; cost: number }>
  /** Model rows: the model has no price (some calls cost unknown). */
  price_missing?: boolean
  /** Profile rows: the profile's monthly cost cap (main currency), when it has one. */
  monthly_cost_cap?: number | null
}

export interface CostSeries {
  keys: string[]
  labels: Record<string, string>
  /** Per day: main-currency cost per key ('other' = the rest). */
  points: Array<{ day: string } & Record<string, number | string>>
}

export interface CostBreakdown {
  period: Period
  currency: string
  filters: CostFilters
  totals: CostAmounts & { main_cost: number }
  groups: Partial<Record<CostGroupBy, BreakdownRow[]>>
  series: { model: CostSeries; profile: CostSeries }
  /** Some calls are costed at today's prices (recorded without a cost). */
  estimated: boolean
  /** The source rows were capped (the SQL function isn't deployed and the period has more rows). */
  truncated: boolean
  /** Which query produced the cube. */
  aggregated_in: 'database' | 'app'
}

export interface BreakdownNames {
  agents?: Record<string, { name: string; provider?: string | null }>
  profiles?: Record<string, { name: string; monthly_cost_cap?: number | null }>
  users?: Record<string, string>
  capabilities?: Record<string, string>
}

export interface PriceLayersLike { workspace?: readonly ModelPrice[]; instance?: readonly ModelPrice[]; defaults?: readonly ModelPrice[] }

const emptyAmounts = (): CostAmounts => ({ calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, total_tokens: 0, cost: {}, estimated_cost: {}, unpriced_calls: 0, unknown_calls: 0 })
const round = (v: number) => Math.round(v * 1e8) / 1e8
const addCur = (bucket: Record<string, number>, cur: string, amount: number) => { bucket[cur] = round((bucket[cur] ?? 0) + amount) }

export const modelKey = (provider: string | null | undefined, model: string | null | undefined) => `${provider || 'unknown'}:${model || 'unknown'}`

/** A cube row with its resolved provider, estimate and main-currency cost. */
interface Costed extends CubeRow { est_currency: string | null; est_amount: number | null; unknown: boolean }

function costRows(cube: readonly CubeRow[], layers: PriceLayersLike, names: BreakdownNames): Costed[] {
  const priceCache = new Map<string, ReturnType<typeof resolvePrice>>()
  return cube.map((r) => {
    const provider = r.provider ?? (r.agent_id ? names.agents?.[r.agent_id]?.provider ?? null : null)
    const row = { ...r, provider }
    if (r.cost_status === 'priced') return { ...row, est_currency: null, est_amount: null, unknown: false }
    if (!r.total_tokens && !r.input_tokens && !r.output_tokens) return { ...row, est_currency: null, est_amount: null, unknown: false }
    const k = modelKey(provider, r.model)
    if (!priceCache.has(k)) priceCache.set(k, r.model ? resolvePrice(layers, provider ?? '', r.model) : null)
    const price = priceCache.get(k)
    if (!price) return { ...row, est_currency: null, est_amount: null, unknown: true }
    const amount = costOf({ prompt_tokens: r.input_tokens, completion_tokens: r.output_tokens, cached_tokens: r.cached_tokens, cache_write_tokens: r.cache_write_tokens }, price)
    return { ...row, est_currency: price.currency, est_amount: amount, unknown: false }
  })
}

function addRow(acc: CostAmounts, r: Costed) {
  acc.calls += r.calls
  acc.input_tokens += r.input_tokens
  acc.output_tokens += r.output_tokens
  acc.cached_tokens += r.cached_tokens
  acc.total_tokens += r.total_tokens
  if (r.cost_status === 'priced' && r.cost_currency) addCur(acc.cost, r.cost_currency, r.cost_amount ?? 0)
  else {
    acc.unpriced_calls += r.calls
    if (r.unknown) acc.unknown_calls += r.calls
    if (r.est_currency && r.est_amount !== null) addCur(acc.estimated_cost, r.est_currency, r.est_amount)
  }
}

const mainCost = (r: Costed, currency: string) =>
  r.cost_status === 'priced' ? (r.cost_currency === currency ? r.cost_amount ?? 0 : 0) : (r.est_currency === currency ? r.est_amount ?? 0 : 0)

export function matchesFilters(r: Pick<CubeRow, 'provider' | 'model' | 'profile' | 'agent_id' | 'source' | 'user_id'>, f: CostFilters): boolean {
  if (f.provider && (r.provider || 'unknown') !== f.provider) return false
  if (f.model && (r.model || 'unknown') !== f.model) return false
  if (f.agent && r.agent_id !== f.agent) return false
  if (f.source && r.source !== f.source) return false
  if (f.user && r.user_id !== f.user) return false
  if (f.profile) {
    if (!PROFILE_SOURCES.includes(r.source)) return false
    if ((r.profile || DEFAULT_PROFILE) !== f.profile) return false
  }
  return true
}

interface GroupSpec { key: (r: Costed) => string | null; label: (key: string, r: Costed) => string }

function groupSpecs(names: BreakdownNames): Record<CostGroupBy, GroupSpec> {
  return {
    day: { key: (r) => r.day, label: (k) => k },
    model: { key: (r) => modelKey(r.provider, r.model), label: (_k, r) => r.model || 'unknown model' },
    profile: {
      key: (r) => (PROFILE_SOURCES.includes(r.source) ? r.profile || DEFAULT_PROFILE : null),
      label: (k) => (k === DEFAULT_PROFILE ? 'Default' : names.profiles?.[k]?.name ?? `Deleted profile (${k.slice(0, 8)})`),
    },
    agent: {
      key: (r) => (r.agent_id ? r.agent_id : null),
      label: (k) => names.agents?.[k]?.name ?? 'Deleted agent',
    },
    source: { key: (r) => r.source, label: (k) => COST_SOURCE_LABELS[k as CostSource] ?? k },
    user: {
      key: (r) => (PROFILE_SOURCES.includes(r.source) ? r.user_id ?? 'none' : null),
      label: (k) => (k === 'none' ? 'No person (system)' : names.users?.[k] ?? 'Former member'),
    },
  }
}

const SERIES_TOP = 6

function buildSeries(rows: readonly Costed[], spec: GroupSpec, days: readonly string[], currency: string): CostSeries {
  const totals = new Map<string, { label: string; cost: number }>()
  for (const r of rows) {
    const k = spec.key(r)
    if (k === null) continue
    const t = totals.get(k) ?? { label: spec.label(k, r), cost: 0 }
    t.cost += mainCost(r, currency)
    totals.set(k, t)
  }
  const ranked = Array.from(totals.entries()).filter(([, t]) => t.cost > 0).sort((a, b) => b[1].cost - a[1].cost)
  const top = ranked.slice(0, SERIES_TOP).map(([k]) => k)
  const hasOther = ranked.length > SERIES_TOP
  const keys = hasOther ? [...top, 'other'] : top
  const labels: Record<string, string> = Object.fromEntries(top.map((k) => [k, totals.get(k)!.label]))
  if (hasOther) labels.other = 'Other'
  const index = new Map(days.map((d, i) => [d, i]))
  const points = days.map((day) => ({ day, ...Object.fromEntries(keys.map((k) => [k, 0])) })) as CostSeries['points']
  const topSet = new Set(top)
  for (const r of rows) {
    const k = spec.key(r)
    const i = index.get(r.day)
    if (k === null || i === undefined) continue
    const slot = topSet.has(k) ? k : hasOther ? 'other' : null
    if (!slot) continue
    points[i][slot] = round((points[i][slot] as number) + mainCost(r, currency))
  }
  return { keys, labels, points }
}

/**
 * Filter the cube and roll it up by the requested groups. Each group's rows
 * are sorted by main-currency cost, then tokens (descending); `share` is of
 * that group's own total (profile and person rows cover the in-product Agent
 * sources only; agent rows the agent runs only).
 */
export function rollupBreakdown(input: {
  cube: readonly CubeRow[]
  period: Period
  currency: string
  layers: PriceLayersLike
  names?: BreakdownNames
  filters?: CostFilters
  groupBy?: readonly CostGroupBy[]
  truncated?: boolean
  aggregatedIn?: 'database' | 'app'
}): CostBreakdown {
  const names = input.names ?? {}
  const filters = input.filters ?? {}
  const currency = input.currency || 'USD'
  const inPeriod = new Set(input.period.days)
  const rows = costRows(input.cube.filter((r) => inPeriod.has(r.day)), input.layers, names).filter((r) => matchesFilters(r, filters))
  const totals = emptyAmounts()
  let totalMain = 0
  for (const r of rows) { addRow(totals, r); totalMain += mainCost(r, currency) }
  const specs = groupSpecs(names)
  const dayIndex = new Map(input.period.days.map((d, i) => [d, i]))
  const groups: CostBreakdown['groups'] = {}
  for (const by of input.groupBy ?? ['day', 'model', 'profile', 'agent', 'source']) {
    const spec = specs[by]
    const acc = new Map<string, BreakdownRow & { _main: number; _models: Set<string>; _caps: Map<string, { calls: number; cost: number }> }>()
    for (const r of rows) {
      const key = spec.key(r)
      if (key === null) continue
      let g = acc.get(key)
      if (!g) {
        g = { key, label: spec.label(key, r), ...emptyAmounts(), share: 0, cost_per_1k: null, trend: input.period.days.map(() => 0), _main: 0, _models: new Set(), _caps: new Map() }
        if (by === 'model') { g.provider = r.provider; g.model = r.model }
        acc.set(key, g)
      }
      addRow(g, r)
      const main = mainCost(r, currency)
      g._main += main
      const i = dayIndex.get(r.day)
      if (i !== undefined) g.trend[i] = round(g.trend[i] + main)
      g._models.add(modelKey(r.provider, r.model))
      if (by === 'profile' && r.capability) {
        const c = g._caps.get(r.capability) ?? { calls: 0, cost: 0 }
        c.calls += r.calls
        c.cost = round(c.cost + main)
        g._caps.set(r.capability, c)
      }
    }
    const list = Array.from(acc.values())
    const groupTotal = list.reduce((s, g) => s + g._main, 0)
    const built = list.map(({ _main, _models, _caps, ...g }) => {
      const out: BreakdownRow = {
        ...g,
        share: groupTotal > 0 ? _main / groupTotal : 0,
        cost_per_1k: g.total_tokens > 0 && _main > 0 ? round((_main / g.total_tokens) * 1000) : null,
      }
      if (by === 'model') out.price_missing = g.unknown_calls > 0
      else if (by !== 'day') out.models = Array.from(_models).sort()
      if (by === 'profile') {
        out.capabilities = Array.from(_caps.entries()).map(([capability, c]) => ({ capability, label: names.capabilities?.[capability] ?? capability, ...c })).sort((a, b) => b.cost - a.cost || b.calls - a.calls)
        out.monthly_cost_cap = g.key === DEFAULT_PROFILE ? null : names.profiles?.[g.key]?.monthly_cost_cap ?? null
      }
      return { row: out, main: _main }
    })
    built.sort((a, b) => (by === 'day' ? a.row.key.localeCompare(b.row.key) : b.main - a.main || b.row.total_tokens - a.row.total_tokens || a.row.label.localeCompare(b.row.label)))
    groups[by] = built.map((b) => b.row)
  }
  return {
    period: input.period,
    currency,
    filters,
    totals: { ...totals, main_cost: round(totalMain) },
    groups,
    series: {
      model: buildSeries(rows, specs.model, input.period.days, currency),
      profile: buildSeries(rows, specs.profile, input.period.days, currency),
    },
    estimated: Object.keys(totals.estimated_cost).length > 0,
    truncated: Boolean(input.truncated),
    aggregated_in: input.aggregatedIn ?? 'database',
  }
}

/* ── CSV ── */

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // Spreadsheet formula injection: a leading = + - @ (or tab / CR) is quoted with an apostrophe.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** One breakdown table as CSV (the main currency's stored + estimated cost, and every currency's stored cost). */
export function breakdownCsv(rows: readonly BreakdownRow[], by: CostGroupBy, currency: string): string {
  const head = [by === 'model' ? 'provider' : null, by, 'calls', 'input_tokens', 'output_tokens', 'cached_tokens', 'total_tokens', `cost_${currency.toLowerCase()}`, `estimated_${currency.toLowerCase()}`, 'other_currencies', 'cost_unknown_calls', 'share', `cost_per_1k_tokens_${currency.toLowerCase()}`, by === 'model' ? null : 'models']
    .filter((h): h is string => h !== null)
  const lines = [head.join(',')]
  for (const r of rows) {
    const other = Object.entries(r.cost).filter(([c]) => c !== currency).map(([c, a]) => `${a} ${c}`).join('; ')
    const cells = [
      ...(by === 'model' ? [r.provider ?? ''] : []),
      r.label, r.calls, r.input_tokens, r.output_tokens, r.cached_tokens, r.total_tokens,
      r.cost[currency] ?? 0, r.estimated_cost[currency] ?? 0, other, r.unknown_calls,
      Math.round(r.share * 10000) / 10000, r.cost_per_1k ?? '',
      ...(by === 'model' ? [] : [(r.models ?? []).join('; ')]),
    ]
    lines.push(cells.map(csvCell).join(','))
  }
  return `${lines.join('\n')}\n`
}

/** Parse `group_by` (comma-separated) into known groups; unknown names are an error. */
export function parseGroupBy(value: string | readonly string[] | null | undefined): CostGroupBy[] {
  const parts = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((s) => String(s).trim()).filter(Boolean)
  const bad = parts.filter((p) => !(GROUP_BYS as readonly string[]).includes(p))
  if (bad.length) throw new PeriodError(`group_by must be one or more of ${GROUP_BYS.join(', ')} (got ${bad.join(', ')})`)
  return Array.from(new Set(parts)) as CostGroupBy[]
}
