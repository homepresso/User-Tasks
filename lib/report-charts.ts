/**
 * Report summary charts: a saved report's optional `charts` (up to
 * MAX_REPORT_CHARTS) drawn as a grid of chart cards above its table.
 *
 * Each chart is one grouped aggregate of the report's own rows — the same
 * data source, source inputs, joins, filters and date range, so the same
 * permissions and RLS — plus the chart's own extra filters and an optional
 * "last N days" window. The server aggregates (lib/report-charts-server.ts)
 * and returns compact series; rows never go to the browser for charts.
 *
 * This module is pure and isomorphic: the spec schema + normaliser (used by
 * normalizeReportConfig), plain-language descriptions (builder), and the
 * bucketing / aggregation the server runs over the fetched rows.
 *
 * Time buckets (day / week / month / day of week / hour of day) are computed
 * in an IANA time zone: the viewer's browser zone when the request names one,
 * else the user's profile zone, else UTC (see the preview route).
 */

import { z } from 'zod'
import { npsBand } from '@/lib/forms/survey/controls'
import type { ReportFilter } from '@/lib/report-sources'
import { isPlainObject } from '@/lib/utils/guards'

export const MAX_REPORT_CHARTS = 8
/** Rows a chart aggregates at most (newest first); a larger result is flagged `truncated`. */
export const REPORT_CHART_ROW_CAP = 10_000
export const MAX_CHART_CATEGORIES = 50

export const REPORT_CHART_TYPES = ['number', 'line', 'area', 'column', 'bar', 'donut', 'pie', 'heatmap'] as const
export type ReportChartType = (typeof REPORT_CHART_TYPES)[number]
export const REPORT_CHART_BUCKETS = ['day', 'week', 'month', 'day_of_week', 'hour_of_day'] as const
export type ReportChartBucket = (typeof REPORT_CHART_BUCKETS)[number]
export const REPORT_CHART_MEASURES = ['count', 'sum', 'avg', 'min', 'max', 'nps'] as const
export type ReportChartMeasureFn = (typeof REPORT_CHART_MEASURES)[number]

export const REPORT_CHART_TYPE_LABELS: Record<ReportChartType, string> = {
  number: 'Number', line: 'Line', area: 'Area', column: 'Columns', bar: 'Bars', donut: 'Donut', pie: 'Pie', heatmap: 'Day × hour heatmap',
}
export const REPORT_CHART_BUCKET_LABELS: Record<ReportChartBucket, string> = {
  day: 'day', week: 'week', month: 'month', day_of_week: 'day of the week', hour_of_day: 'hour of the day',
}
export const REPORT_CHART_MEASURE_LABELS: Record<ReportChartMeasureFn, string> = {
  count: 'Count', sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest', nps: 'Net Promoter Score',
}

const FILTER_OPERATORS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'like', 'ilike', 'in', 'is_null', 'is_not_null'] as const

const field = z.string().trim().min(1).max(200)

export const reportChartSpecSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Chart ids use letters, digits, - and _'),
  title: z.string().trim().min(1).max(120),
  type: z.enum(REPORT_CHART_TYPES),
  /** What the chart splits by: a date column bucketed by time, or a column's values. Not for number cards. */
  dimension: z.object({
    field,
    bucket: z.enum(REPORT_CHART_BUCKETS).optional(),
  }).optional(),
  /** What each bar / point / slice / card shows: a count, or sum / avg / min / max / NPS of a numeric column. */
  measure: z.object({
    fn: z.enum(REPORT_CHART_MEASURES),
    field: field.optional(),
  }).default({ fn: 'count' }),
  /** Extra filters, ANDed with the report's own. */
  filters: z.array(z.object({
    field,
    operator: z.enum(FILTER_OPERATORS),
    value: z.unknown().optional(),
  })).max(10).optional(),
  /** Categorical charts: keep the N largest categories, the rest as "Other". */
  top_n: z.number().int().min(1).max(MAX_CHART_CATEGORIES).optional(),
  /** Only rows whose dimension (or, for number cards, `window_field`) date is in the last N days. */
  range_days: z.number().int().min(1).max(3660).optional(),
  /** Number cards with range_days: the date column the window applies to. */
  window_field: field.optional(),
  /** Categorical charts: the categories in this order, all shown (zero when unused); others follow. */
  categories: z.array(z.string().max(200)).max(MAX_CHART_CATEGORIES).optional(),
  /** Categorical charts: order by value (largest first, default) or by label. */
  sort: z.enum(['value', 'label']).optional(),
}).superRefine((spec, ctx) => {
  const needsField = spec.measure.fn !== 'count'
  if (needsField && !spec.measure.field) ctx.addIssue({ code: 'custom', path: ['measure', 'field'], message: `${REPORT_CHART_MEASURE_LABELS[spec.measure.fn]} needs a numeric column` })
  if (spec.type === 'number') return
  if (!spec.dimension) { ctx.addIssue({ code: 'custom', path: ['dimension'], message: 'Choose what the chart splits by' }); return }
  if (spec.type === 'heatmap' && spec.dimension.bucket && spec.dimension.bucket !== 'hour_of_day' && spec.dimension.bucket !== 'day_of_week') {
    ctx.addIssue({ code: 'custom', path: ['dimension', 'bucket'], message: 'A heatmap splits a date column by day of the week and hour' })
  }
  if ((spec.type === 'line' || spec.type === 'area') && !spec.dimension.bucket) {
    ctx.addIssue({ code: 'custom', path: ['dimension', 'bucket'], message: 'Line and area charts need a date column split by time' })
  }
  if (spec.range_days && !spec.dimension.bucket && spec.type !== 'heatmap') {
    ctx.addIssue({ code: 'custom', path: ['range_days'], message: '"Last N days" needs a date column' })
  }
})

export type ReportChartSpec = z.infer<typeof reportChartSpecSchema>

/** The `charts` array of a report config (for API schemas). */
export const reportChartsSchema = z.array(reportChartSpecSchema).max(MAX_REPORT_CHARTS)

/** A chart spec's problems in plain words (empty = valid). `columns`: the report's column keys, when known. */
export function validateReportChart(raw: unknown, columns?: Iterable<string>): string[] {
  // A missing id is filled in on save (normalizeReportCharts).
  const candidate = isPlainObject(raw) && !raw.id ? { ...raw, id: 'chart' } : raw
  const parsed = reportChartSpecSchema.safeParse(candidate)
  const errors = parsed.success ? [] : parsed.error.issues.map((issue) => (issue.code === 'custom' || !issue.path.length ? issue.message : `${issue.path.join('.')}: ${issue.message}`))
  if (parsed.success && columns) {
    const known = new Set(columns)
    for (const key of chartFields(parsed.data)) if (!known.has(key)) errors.push(`Unknown column "${key}"`)
  }
  return errors
}

/** Problems with a config's raw `charts` (before normalising drops the invalid ones), for API / MCP errors. */
export function reportChartIssues(raw: unknown, columns?: Iterable<string>): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return ['charts must be an array of chart specs']
  const issues: string[] = []
  if (raw.length > MAX_REPORT_CHARTS) issues.push(`A report has at most ${MAX_REPORT_CHARTS} charts (got ${raw.length})`)
  const known = columns ? [...columns] : undefined
  raw.slice(0, MAX_REPORT_CHARTS).forEach((entry, i) => {
    const name = isPlainObject(entry) && typeof entry.title === 'string' && entry.title ? ` ("${entry.title}")` : ''
    for (const message of validateReportChart(entry, known)) issues.push(`Chart ${i + 1}${name}: ${message}`)
  })
  return issues
}

/** Every column a chart reads. */
export function chartFields(spec: ReportChartSpec): string[] {
  const out = new Set<string>()
  if (spec.dimension?.field) out.add(spec.dimension.field)
  if (spec.measure.field) out.add(spec.measure.field)
  if (spec.window_field) out.add(spec.window_field)
  for (const f of spec.filters ?? []) out.add(f.field)
  return [...out]
}

/**
 * The `charts` of a config: valid specs only (invalid entries are dropped),
 * at most MAX_REPORT_CHARTS, ids unique. Returns undefined for "no charts"
 * so configs without charts stay as they were.
 */
export function normalizeReportCharts(raw: unknown): ReportChartSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: ReportChartSpec[] = []
  for (const entry of raw) {
    if (out.length >= MAX_REPORT_CHARTS) break
    if (!isPlainObject(entry)) continue
    const candidate = { ...entry, id: typeof entry.id === 'string' && entry.id ? entry.id : `chart_${out.length + 1}` }
    const parsed = reportChartSpecSchema.safeParse(candidate)
    if (!parsed.success) continue
    let id = parsed.data.id
    for (let i = 2; seen.has(id); i++) id = `${parsed.data.id}_${i}`
    seen.add(id)
    out.push({ ...parsed.data, id })
  }
  return out.length ? out : undefined
}

/** "Count of responses by day", "Average of Score by Status", "Total responses". */
export function describeReportChart(spec: ReportChartSpec, labelOf: (key: string) => string = (k) => k, noun = 'rows'): string {
  const what = spec.measure.fn === 'count' ? `Count of ${noun}` : `${REPORT_CHART_MEASURE_LABELS[spec.measure.fn]} of ${labelOf(spec.measure.field ?? '')}`
  const window = spec.range_days ? `, last ${spec.range_days} days` : ''
  if (spec.type === 'number') return `${what}${window}`
  if (!spec.dimension) return what
  if (spec.type === 'heatmap') return `${what} by day of the week and hour (${labelOf(spec.dimension.field)})${window}`
  if (spec.dimension.bucket) return `${what} by ${REPORT_CHART_BUCKET_LABELS[spec.dimension.bucket]} (${labelOf(spec.dimension.field)})${window}`
  return `${what} by ${labelOf(spec.dimension.field)}${spec.top_n ? ` (top ${spec.top_n})` : ''}`
}

/* ── Results ─────────────────────────────────────────────────────────── */

export interface ReportChartPoint { key: string; label: string; value: number | null }

export interface ReportChartResult {
  id: string
  type: ReportChartType
  title: string
  /** number cards */
  value?: number | null
  /** every other type, in display order */
  points?: ReportChartPoint[]
  /** heatmap: day of week (0 = Monday) × hour (0–23) */
  cells?: Array<{ dow: number; hour: number; value: number }>
  /** rows the chart aggregated */
  rows: number
  /** more rows matched than REPORT_CHART_ROW_CAP: the newest were used */
  truncated: boolean
  timezone: string
  error?: string
}

/* ── Time zones and buckets ──────────────────────────────────────────── */

const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/

/** A usable IANA zone name, else null. */
export function validTimeZone(tz: unknown): string | null {
  if (typeof tz !== 'string' || !TZ_RE.test(tz)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    formatters.set(tz, f)
  }
  return f
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Wall-clock parts of an instant in a zone: date (YYYY-MM-DD), hour, weekday (0 = Monday). */
export function zonedParts(date: Date, tz: string): { ymd: string; hour: number; dow: number } {
  const parts: Record<string, string> = {}
  for (const p of partsFormatter(tz).formatToParts(date)) parts[p.type] = p.value
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, dow: WEEKDAYS.indexOf(parts.weekday) }
}

function parseInstant(value: unknown): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = String(value).trim()
  // A bare date ("2026-11-03") is a calendar day, not UTC midnight: read it at noon UTC so every zone keeps the day.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00Z`) : new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Calendar arithmetic on YYYY-MM-DD strings (zone-free). */
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function weekStart(ymd: string): string {
  const dow = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(ymd, -dow)
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** The bucket key of an instant ("2026-11-03", "2026-11-02" (the Monday), "2026-11", "0".."6", "0".."23"). */
export function bucketKey(date: Date, bucket: ReportChartBucket, tz: string): string {
  const { ymd, hour, dow } = zonedParts(date, tz)
  switch (bucket) {
    case 'day': return ymd
    case 'week': return weekStart(ymd)
    case 'month': return ymd.slice(0, 7)
    case 'day_of_week': return String(dow)
    case 'hour_of_day': return String(hour)
  }
}

export function bucketLabel(key: string, bucket: ReportChartBucket): string {
  switch (bucket) {
    case 'day': case 'week': {
      const [, m, d] = key.split('-').map(Number)
      return `${d} ${MONTHS[m - 1]}`
    }
    case 'month': {
      const [y, m] = key.split('-').map(Number)
      return `${MONTHS[m - 1]} ${y}`
    }
    case 'day_of_week': return WEEKDAYS[Number(key)] ?? key
    case 'hour_of_day': return `${key.padStart(2, '0')}:00`
  }
}

/** Every bucket key from `first` to `last` (inclusive), so a time series has no holes. */
function bucketRange(first: string, last: string, bucket: ReportChartBucket): string[] {
  const out: string[] = []
  if (bucket === 'day_of_week') return WEEKDAYS.map((_, i) => String(i))
  if (bucket === 'hour_of_day') return Array.from({ length: 24 }, (_, i) => String(i))
  if (first > last) return out
  const step = bucket === 'month' ? (k: string) => addMonths(k, 1) : (k: string) => addDays(k, bucket === 'week' ? 7 : 1)
  for (let k = first; k <= last && out.length < 1000; k = step(k)) out.push(k)
  return out
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()
/** The zone's UTC offset at an instant, in ms (wall clock − UTC). */
function tzOffsetMs(date: Date, tz: string): number {
  let f = offsetFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
    offsetFormatters.set(tz, f)
  }
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(date)) if (part.type !== 'literal') p[part.type] = Number(part.value)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second)
  return wall - (date.getTime() - date.getUTCMilliseconds())
}

/** Start of the "last N days" window: local midnight N−1 days ago (today counts as a day), as an ISO instant. */
export function windowStart(days: number, tz: string, now: Date = new Date()): string {
  const todayYmd = zonedParts(now, tz).ymd
  const startYmd = addDays(todayYmd, -(days - 1))
  // Local midnight of startYmd in tz: two-pass offset correction (DST-safe).
  const guess = Date.parse(`${startYmd}T00:00:00Z`)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  t = guess - tzOffsetMs(new Date(t), tz)
  return new Date(t).toISOString()
}

/* ── Aggregation ─────────────────────────────────────────────────────── */

function toNumber(value: unknown): number | null {
  if (value == null || value === '' || typeof value === 'boolean') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** One measure over a group of rows. Count counts rows; the others skip blanks / non-numbers (null when none). */
export function measureValue(rows: readonly unknown[], fn: ReportChartMeasureFn, read: (row: unknown) => unknown): number | null {
  if (fn === 'count') return rows.length
  const nums = rows.map((row) => toNumber(read(row))).filter((n): n is number => n !== null)
  if (fn === 'nps') {
    const scores = nums.filter((n) => n >= 0 && n <= 10).map(Math.round)
    if (!scores.length) return null
    const promoters = scores.filter((n) => npsBand(n) === 'promoter').length
    const detractors = scores.filter((n) => npsBand(n) === 'detractor').length
    return Math.round(((promoters - detractors) / scores.length) * 100)
  }
  if (!nums.length) return null
  switch (fn) {
    case 'sum': return round2(nums.reduce((a, b) => a + b, 0))
    case 'avg': return round2(nums.reduce((a, b) => a + b, 0) / nums.length)
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
  }
}

export const BLANK_CATEGORY = '(blank)'
export const OTHER_CATEGORY = 'Other'

function categoryOf(value: unknown): string {
  if (value == null) return BLANK_CATEGORY
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : BLANK_CATEGORY
  const text = String(value).trim()
  return text === '' ? BLANK_CATEGORY : text
}

function compareLabels(a: string, b: string) {
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export interface AggregateOptions {
  timezone?: string
  now?: Date
  /** Reads a column of a row (defaults to row[key]). */
  read?: (row: unknown, key: string) => unknown
  truncated?: boolean
}

/**
 * A chart's series from rows already narrowed by the report's (and the
 * chart's) filters. Rows outside `range_days` are skipped here too, so the
 * result is right even if the caller fetched a wider set.
 */
export function aggregateReportChart(rows: readonly unknown[], spec: ReportChartSpec, options: AggregateOptions = {}): ReportChartResult {
  const tz = validTimeZone(options.timezone) ?? 'UTC'
  const now = options.now ?? new Date()
  const read = options.read ?? ((row: unknown, key: string) => (row as Record<string, unknown> | null)?.[key])
  const measure = (group: readonly unknown[]) => measureValue(group, spec.measure.fn, (row) => (spec.measure.field ? read(row, spec.measure.field) : null))
  const base = { id: spec.id, type: spec.type, title: spec.title, timezone: tz, truncated: Boolean(options.truncated) }

  const windowField = spec.range_days ? (spec.type === 'number' ? spec.window_field : spec.dimension?.field) : undefined
  const since = spec.range_days && windowField ? new Date(windowStart(spec.range_days, tz, now)).getTime() : null
  let scoped = rows
  if (since !== null && windowField) {
    scoped = rows.filter((row) => {
      const d = parseInstant(read(row, windowField))
      return d !== null && d.getTime() >= since
    })
  }

  if (spec.type === 'number' || !spec.dimension) {
    return { ...base, value: measure(scoped), rows: scoped.length }
  }

  const dim = spec.dimension
  if (spec.type === 'heatmap') {
    const groups = new Map<string, unknown[]>()
    let used = 0
    for (const row of scoped) {
      const d = parseInstant(read(row, dim.field))
      if (!d) continue
      const { dow, hour } = zonedParts(d, tz)
      const key = `${dow}:${hour}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
      used++
    }
    const cells: Array<{ dow: number; hour: number; value: number }> = []
    for (let dow = 0; dow < 7; dow++) for (let hour = 0; hour < 24; hour++) {
      const group = groups.get(`${dow}:${hour}`) ?? []
      cells.push({ dow, hour, value: group.length ? (measure(group) ?? 0) : 0 })
    }
    return { ...base, cells, rows: used }
  }

  if (dim.bucket) {
    const bucket = dim.bucket
    const groups = new Map<string, unknown[]>()
    let used = 0
    for (const row of scoped) {
      const d = parseInstant(read(row, dim.field))
      if (!d) continue
      const key = bucketKey(d, bucket, tz)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
      used++
    }
    let keys: string[]
    if (bucket === 'day_of_week' || bucket === 'hour_of_day') {
      keys = bucketRange('', '', bucket)
    } else {
      const present = [...groups.keys()].sort()
      const today = bucketKey(now, bucket, tz)
      const first = since !== null ? bucketKey(new Date(since), bucket, tz) : present[0]
      const last = since !== null ? today : present[present.length - 1]
      keys = first && last ? bucketRange(first, last, bucket) : []
      // Keys outside the filled range (dates in the future) still show.
      for (const k of present) if (!keys.includes(k)) keys.push(k)
      keys.sort()
    }
    const points = keys.map((key) => {
      const group = groups.get(key) ?? []
      return { key, label: bucketLabel(key, bucket), value: group.length ? measure(group) : (spec.measure.fn === 'count' || spec.measure.fn === 'sum' ? 0 : null) }
    })
    return { ...base, points, rows: used }
  }

  // Categorical.
  const groups = new Map<string, unknown[]>()
  for (const row of scoped) {
    const key = categoryOf(read(row, dim.field))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }
  let points: ReportChartPoint[] = [...groups.entries()].map(([key, group]) => ({ key, label: key, value: measure(group) }))
  const fixed = spec.categories ?? []
  if (fixed.length) {
    const byKey = new Map(points.map((p) => [p.key, p]))
    const ordered = fixed.map((c) => byKey.get(c) ?? { key: c, label: c, value: spec.measure.fn === 'count' || spec.measure.fn === 'sum' ? 0 : null })
    const rest = points.filter((p) => !fixed.includes(p.key)).sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity))
    points = [...ordered, ...rest]
  } else if (spec.sort === 'label') {
    points.sort((a, b) => compareLabels(a.label, b.label))
  } else {
    points.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || compareLabels(a.label, b.label))
  }
  const cap = Math.min(spec.top_n ?? MAX_CHART_CATEGORIES, MAX_CHART_CATEGORIES)
  if (points.length > cap) {
    const keep = points.slice(0, cap)
    const keptKeys = new Set(keep.map((p) => p.key))
    const otherRows = [...groups.entries()].filter(([key]) => !keptKeys.has(key)).flatMap(([, group]) => group)
    if (otherRows.length) keep.push({ key: OTHER_CATEGORY, label: OTHER_CATEGORY, value: measure(otherRows) })
    points = keep
  }
  return { ...base, points, rows: scoped.length }
}
