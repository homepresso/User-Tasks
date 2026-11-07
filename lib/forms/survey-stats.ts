/**
 * Survey aggregation: answers → the numbers the survey charts draw
 * (components/forms/survey-charts). Runs on the server (the wizard's results
 * page, the results API) so only aggregates reach the browser, never every
 * response. Pure and isomorphic; each question type has its own summary:
 *
 *   rating        average, distribution per point
 *   nps           score (% promoters − % detractors), the three groups, 0–10 distribution
 *   likert        distribution per point, average position, agree / neutral / disagree shares
 *   matrix        per row: counts per column and the average position
 *   slider        average, median, min, max, a histogram
 *   csat          distribution per face, CSAT % (satisfied share), average
 *   ranking       per option: average position, first-place count, counts per position
 *   choice        counts per option (choice, multi-select, picture choice, yes / no / maybe, checkbox)
 *   number        average, min, max, sum (number, currency)
 *
 * Values come from submissions (the field's value as stored) or from data
 * table rows written by the wizard (a matrix as one column per row:
 * `<key>_<row key>`); tableRowValue reads both.
 */

import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import {
  csatLabels, csatSatisfied, matrixRows, matrixValue, npsBand, scalePoints, surveyOptions, surveyScale, type RatingIcon,
} from '@/lib/forms/survey/controls'

export interface StatBucket {
  /** The stored value (an option, a score). */
  name: string
  /** What people read. */
  label: string
  value: number
}

interface StatBase {
  key: string
  label: string
  /** The field type it summarises. */
  field_type: TaskFieldDef['type']
  /** Responses that answered it. */
  answered: number
  /** Responses considered (answered or not). */
  total: number
}

export interface RatingStat extends StatBase { kind: 'rating'; max: number; icon: RatingIcon; average: number | null; distribution: StatBucket[] }
export interface NpsStat extends StatBase {
  kind: 'nps'
  /** −100…100, rounded; null without answers. */
  score: number | null
  promoters: number
  passives: number
  detractors: number
  distribution: StatBucket[]
  average: number | null
}
export interface LikertStat extends StatBase {
  kind: 'likert'
  options: string[]
  distribution: StatBucket[]
  /** Mean position, 1 = the first option. */
  average: number | null
  /** Shares (0–100) of answers below / at / above the middle. */
  disagree: number
  neutral: number
  agree: number
}
export interface MatrixStat extends StatBase {
  kind: 'matrix'
  columns: string[]
  rows: Array<{ key: string; label: string; counts: number[]; answered: number; average: number | null }>
}
export interface SliderStat extends StatBase {
  kind: 'slider'
  unit?: string
  min: number
  max: number
  average: number | null
  median: number | null
  lowest: number | null
  highest: number | null
  histogram: StatBucket[]
}
export interface CsatStat extends StatBase {
  kind: 'csat'
  faces: 3 | 5
  distribution: StatBucket[]
  /** Satisfied share 0–100 (top two of five faces, the top one of three). */
  satisfied: number | null
  average: number | null
}
export interface RankingStat extends StatBase {
  kind: 'ranking'
  /** Best (lowest average position) first. */
  items: Array<{ name: string; label: string; average_position: number | null; first: number; positions: number[] }>
}
export interface ChoiceStat extends StatBase {
  kind: 'choice'
  multiple: boolean
  /** How to draw it: bars, a donut (few single answers) or a split bar (yes / no / maybe, checkboxes). */
  display: 'bar' | 'donut' | 'split'
  distribution: StatBucket[]
}
export interface NumberStat extends StatBase { kind: 'number'; average: number | null; lowest: number | null; highest: number | null; sum: number; currency?: string }

export type SurveyStat = RatingStat | NpsStat | LikertStat | MatrixStat | SliderStat | CsatStat | RankingStat | ChoiceStat | NumberStat

/** Field types the results summarise (every other type is listed, not charted). */
export const CHARTED_FIELD_TYPES: ReadonlySet<TaskFieldDef['type']> = new Set([
  'rating', 'nps', 'likert', 'matrix', 'slider', 'csat', 'ranking', 'image_choice', 'yes_no_maybe', 'choice', 'multi_choice', 'boolean', 'number', 'currency',
])

/* ── Helpers ─────────────────────────────────────────────────────────── */

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean)
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try { const parsed = JSON.parse(s); if (Array.isArray(parsed)) return parsed.map((x) => String(x ?? '').trim()).filter(Boolean) } catch { /* text */ }
    }
    return s.split(s.includes(' > ') ? ' > ' : ',').map((x) => x.trim()).filter(Boolean)
  }
  return v === null || v === undefined ? [] : [String(v)]
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

const round = (n: number, places = 2) => Number(n.toFixed(places))
const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
const share = (n: number, of: number) => (of ? round((n / of) * 100, 1) : 0)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2)
}

function optionLabelOf(field: TaskFieldDef, value: string): string {
  return field.option_labels?.[value] ?? value
}

/**
 * A field's value in a stored row: the value itself, or — for a matrix the
 * wizard saved as one column per row — the object rebuilt from
 * `<key>_<row key>` columns.
 */
export function tableRowValue(field: TaskFieldDef, row: Record<string, unknown>): unknown {
  const direct = row[field.key]
  if (field.type !== 'matrix') return direct
  if (isPlainObject(direct) || (typeof direct === 'string' && direct.trim().startsWith('{'))) return matrixValue(direct)
  const out: Record<string, string> = {}
  for (const r of matrixRows(field)) {
    const v = row[`${field.key}_${r.key}`]
    if (!blank(v) && typeof v !== 'object') out[r.key] = String(v)
  }
  return out
}

function answeredValue(field: TaskFieldDef, v: unknown): boolean {
  if (field.type === 'matrix') return Object.keys(matrixValue(v)).length > 0
  if (field.type === 'boolean') return v === true || v === false || v === 'true' || v === 'false'
  return !blank(v)
}

/* ── Per type ────────────────────────────────────────────────────────── */

function counts(points: Array<string | number>, values: unknown[], labelOf: (p: string) => string): StatBucket[] {
  const map = new Map(points.map((p) => [String(p), 0]))
  for (const v of values) {
    const n = num(v)
    const k = n !== null && map.has(String(n)) ? String(n) : String(v)
    if (map.has(k)) map.set(k, map.get(k)! + 1)
  }
  return [...map].map(([name, value]) => ({ name, label: labelOf(name), value }))
}

export function ratingStat(field: TaskFieldDef, values: unknown[], total = values.length): RatingStat {
  const scale = surveyScale(field) ?? { min: 1, max: 5, step: 1 }
  const nums = values.map(num).filter((n): n is number => n !== null && n >= scale.min && n <= scale.max)
  // Half steps are counted on the whole point at or above them (4.5 → 5), so the bars stay 1…max.
  const whole = Array.from({ length: scale.max }, (_, i) => i + 1)
  const distribution = whole.map((p) => ({ name: String(p), label: `${p}`, value: nums.filter((n) => Math.ceil(n) === p).length }))
  return { kind: 'rating', key: field.key, label: field.label, field_type: field.type, answered: nums.length, total, max: scale.max, icon: field.survey?.icon ?? 'star', average: mean(nums), distribution }
}

export function npsStat(field: TaskFieldDef, values: unknown[], total = values.length): NpsStat {
  const nums = values.map(num).filter((n): n is number => n !== null && n >= 0 && n <= 10).map(Math.round)
  const promoters = nums.filter((n) => npsBand(n) === 'promoter').length
  const detractors = nums.filter((n) => npsBand(n) === 'detractor').length
  const passives = nums.length - promoters - detractors
  return {
    kind: 'nps', key: field.key, label: field.label, field_type: field.type, answered: nums.length, total,
    score: nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null,
    promoters, passives, detractors,
    distribution: counts(Array.from({ length: 11 }, (_, i) => i), nums, (p) => p),
    average: mean(nums),
  }
}

export function likertStat(field: TaskFieldDef, values: unknown[], total = values.length): LikertStat {
  const options = surveyOptions(field)
  const answers = values.filter((v) => !blank(v)).map((v) => String(v).trim()).filter((v) => options.includes(v))
  const positions = answers.map((a) => options.indexOf(a) + 1)
  const n = options.length
  const mid = (n + 1) / 2
  return {
    kind: 'likert', key: field.key, label: field.label, field_type: field.type, answered: answers.length, total, options,
    distribution: options.map((o) => ({ name: o, label: optionLabelOf(field, o), value: answers.filter((a) => a === o).length })),
    average: mean(positions),
    disagree: share(positions.filter((p) => p < mid).length, positions.length),
    neutral: share(positions.filter((p) => p === mid).length, positions.length),
    agree: share(positions.filter((p) => p > mid).length, positions.length),
  }
}

export function matrixStat(field: TaskFieldDef, values: unknown[], total = values.length): MatrixStat {
  const columns = surveyOptions(field)
  const answers = values.map(matrixValue)
  const rows = matrixRows(field).map((r) => {
    const picked = answers.map((a) => a[r.key]).filter((v): v is string => typeof v === 'string' && columns.includes(v))
    return {
      key: r.key, label: r.label,
      counts: columns.map((c) => picked.filter((p) => p === c).length),
      answered: picked.length,
      average: mean(picked.map((p) => columns.indexOf(p) + 1)),
    }
  })
  return { kind: 'matrix', key: field.key, label: field.label, field_type: field.type, answered: answers.filter((a) => Object.keys(a).length).length, total, columns, rows }
}

export function sliderStat(field: TaskFieldDef, values: unknown[], total = values.length): SliderStat {
  const scale = surveyScale(field) ?? { min: 0, max: 100, step: 1 }
  const nums = values.map(num).filter((n): n is number => n !== null)
  const points = scalePoints(scale)
  let histogram: StatBucket[]
  if (points.length && points.length <= 21) {
    histogram = points.map((p) => ({ name: String(p), label: String(p), value: nums.filter((n) => n === p).length }))
  } else {
    const bins = 10
    const width = (scale.max - scale.min) / bins
    histogram = Array.from({ length: bins }, (_, i) => {
      const lo = scale.min + i * width
      const hi = i === bins - 1 ? scale.max : lo + width
      const fmt = (x: number) => String(round(x, 2))
      return { name: `${fmt(lo)}–${fmt(hi)}`, label: `${fmt(lo)}–${fmt(hi)}`, value: nums.filter((n) => n >= lo && (i === bins - 1 ? n <= hi : n < hi)).length }
    })
  }
  return {
    kind: 'slider', key: field.key, label: field.label, field_type: field.type, answered: nums.length, total,
    ...(field.survey?.unit ? { unit: field.survey.unit } : {}),
    min: scale.min, max: scale.max, average: mean(nums), median: median(nums),
    lowest: nums.length ? Math.min(...nums) : null, highest: nums.length ? Math.max(...nums) : null, histogram,
  }
}

export function csatStat(field: TaskFieldDef, values: unknown[], total = values.length): CsatStat {
  const faces: 3 | 5 = field.survey?.faces === 3 ? 3 : 5
  const labels = csatLabels(field)
  const nums = values.map(num).filter((n): n is number => n !== null && n >= 1 && n <= faces).map(Math.round)
  return {
    kind: 'csat', key: field.key, label: field.label, field_type: field.type, answered: nums.length, total, faces,
    distribution: labels.map((l, i) => ({ name: String(i + 1), label: l, value: nums.filter((n) => n === i + 1).length })),
    satisfied: nums.length ? share(nums.filter((n) => csatSatisfied(n, faces)).length, nums.length) : null,
    average: mean(nums),
  }
}

export function rankingStat(field: TaskFieldDef, values: unknown[], total = values.length): RankingStat {
  const options = surveyOptions(field)
  const answers = values.map(list).filter((l) => l.length)
  const items = options.map((o) => {
    const positions = Array.from({ length: options.length }, () => 0)
    const ranks: number[] = []
    for (const a of answers) {
      const i = a.indexOf(o)
      if (i < 0 || i >= options.length) continue
      positions[i]++
      ranks.push(i + 1)
    }
    return { name: o, label: optionLabelOf(field, o), average_position: mean(ranks), first: positions[0], positions }
  })
  items.sort((a, b) => (a.average_position ?? Infinity) - (b.average_position ?? Infinity) || b.first - a.first)
  return { kind: 'ranking', key: field.key, label: field.label, field_type: field.type, answered: answers.length, total, items }
}

export function choiceStat(field: TaskFieldDef, values: unknown[], total = values.length): ChoiceStat {
  const multiple = field.type === 'multi_choice' || (field.type === 'image_choice' && field.survey?.multiple === true)
  const options = field.type === 'boolean' ? ['true', 'false'] : field.type === 'yes_no_maybe' ? surveyOptions(field) : [...(field.options ?? [])]
  const map = new Map(options.map((o) => [o, 0]))
  let answered = 0
  for (const v of values) {
    const picked = field.type === 'boolean'
      ? (v === true || v === 'true' ? ['true'] : v === false || v === 'false' ? ['false'] : [])
      : multiple ? list(v) : blank(v) ? [] : [String(v).trim()]
    if (!picked.length) continue
    answered++
    // Answers no longer among the options (renamed / removed later) still count, after the options.
    for (const p of picked) map.set(p, (map.get(p) ?? 0) + 1)
  }
  const labelOf = (o: string) => (field.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : optionLabelOf(field, o))
  const display: ChoiceStat['display'] = field.type === 'boolean' || field.type === 'yes_no_maybe' || (!multiple && options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o)))
    ? 'split' : !multiple && map.size <= 5 ? 'donut' : 'bar'
  return {
    kind: 'choice', key: field.key, label: field.label, field_type: field.type, answered, total, multiple, display,
    distribution: [...map].map(([name, value]) => ({ name, label: labelOf(name), value })),
  }
}

export function numberStat(field: TaskFieldDef, values: unknown[], total = values.length): NumberStat {
  const nums = values.map(num).filter((n): n is number => n !== null)
  return {
    kind: 'number', key: field.key, label: field.label, field_type: field.type, answered: nums.length, total,
    average: mean(nums), lowest: nums.length ? Math.min(...nums) : null, highest: nums.length ? Math.max(...nums) : null,
    sum: round(nums.reduce((a, b) => a + b, 0)),
    ...(field.type === 'currency' ? { currency: field.currency ?? 'USD' } : {}),
  }
}

/** One field's summary (null for a type that isn't charted). */
export function fieldStat(field: TaskFieldDef, values: unknown[], total = values.length): SurveyStat | null {
  switch (field.type) {
    case 'rating': return ratingStat(field, values, total)
    case 'nps': return npsStat(field, values, total)
    case 'likert': return likertStat(field, values, total)
    case 'matrix': return matrixStat(field, values, total)
    case 'slider': return sliderStat(field, values, total)
    case 'csat': return csatStat(field, values, total)
    case 'ranking': return rankingStat(field, values, total)
    case 'choice': case 'multi_choice': case 'image_choice': case 'yes_no_maybe': case 'boolean': return choiceStat(field, values, total)
    case 'number': case 'currency': return numberStat(field, values, total)
    default: return null
  }
}

/**
 * Every charted field's summary over the rows (submission values or data
 * table rows), in field order. `valueOf` reads a field's value from a row
 * (default: tableRowValue).
 */
export function surveyStats(
  fields: TaskFieldDef[],
  rows: Array<Record<string, unknown>>,
  valueOf: (field: TaskFieldDef, row: Record<string, unknown>) => unknown = tableRowValue,
): SurveyStat[] {
  const out: SurveyStat[] = []
  for (const field of fields) {
    if (!CHARTED_FIELD_TYPES.has(field.type)) continue
    const values = rows.map((r) => valueOf(field, r))
    const stat = fieldStat(field, values.filter((v) => answeredValue(field, v)), rows.length)
    if (stat) out.push(stat)
  }
  return out
}

/** Responses per day for the last `days` days (UTC dates, oldest first, zero days included). */
export function responseTrend(createdAt: string[], days = 30, now = Date.now()): Array<{ date: string; count: number }> {
  const dayMs = 86_400_000
  const end = Math.floor(now / dayMs)
  const counts = new Map<number, number>()
  for (const at of createdAt) {
    const t = Date.parse(at)
    if (Number.isNaN(t)) continue
    const d = Math.floor(t / dayMs)
    if (d > end || d <= end - days) continue
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return Array.from({ length: days }, (_, i) => {
    const d = end - days + 1 + i
    return { date: new Date(d * dayMs).toISOString().slice(0, 10), count: counts.get(d) ?? 0 }
  })
}

/** How many responses answered each value field (completion per question), in field order. */
export function completionStats(
  fields: TaskFieldDef[],
  rows: Array<Record<string, unknown>>,
  valueOf: (field: TaskFieldDef, row: Record<string, unknown>) => unknown = tableRowValue,
): Array<{ key: string; label: string; answered: number; share: number }> {
  return fields.map((f) => {
    const answered = rows.filter((r) => answeredValue(f, valueOf(f, r))).length
    return { key: f.key, label: f.label, answered, share: share(answered, rows.length) }
  })
}

/** A one-line headline for a summary (cards, screen readers, the chart's text alternative). */
export function statHeadline(stat: SurveyStat): string {
  const fmt = (n: number | null, places = 1) => (n === null ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: places }))
  const answers = `${stat.answered} answer${stat.answered === 1 ? '' : 's'}`
  switch (stat.kind) {
    case 'rating': return `Average ${fmt(stat.average)} out of ${stat.max} · ${answers}`
    case 'nps': return `NPS ${stat.score === null ? '—' : `${stat.score > 0 ? '+' : ''}${stat.score}`} · ${stat.promoters} promoters, ${stat.passives} passives, ${stat.detractors} detractors`
    case 'likert': return `${fmt(stat.agree)}% agree, ${fmt(stat.neutral)}% neutral, ${fmt(stat.disagree)}% disagree · ${answers}`
    case 'matrix': return `${stat.rows.length} statements · ${answers}`
    case 'slider': return `Average ${fmt(stat.average)}${stat.unit ? ` ${stat.unit}` : ''}, median ${fmt(stat.median)} · ${answers}`
    case 'csat': return `CSAT ${stat.satisfied === null ? '—' : `${fmt(stat.satisfied)}%`} satisfied · ${answers}`
    case 'ranking': return stat.items[0]?.average_position != null ? `Ranked first on average: ${stat.items[0].label} · ${answers}` : answers
    case 'choice': {
      const top = [...stat.distribution].sort((a, b) => b.value - a.value)[0]
      return top && top.value ? `Most picked: ${top.label} (${top.value}) · ${answers}` : answers
    }
    case 'number': return `Average ${fmt(stat.average, 2)} · ${answers}`
  }
}
