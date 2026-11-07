'use client'

/**
 * Survey result charts, one per question type, drawn from the server's
 * aggregates (lib/forms/survey-stats.ts — never the raw responses):
 *
 *   rating    average with the symbols, distribution bars (one hue, light → dark)
 *   nps       the score on a −100…100 gauge, detractor / passive / promoter split, 0–10 columns
 *   likert    a diverging stacked bar centred on the neutral point, agree / disagree shares
 *   matrix    a diverging stacked bar per statement with its average
 *   slider    average and median, a histogram
 *   csat      CSAT % and the distribution per face
 *   ranking   average position per option (shorter = ranked higher), first places
 *   choice    bars, a donut-free split bar (yes / no / maybe) — counts and shares
 *   number    average, lowest, highest, total
 *
 * SurveyStatChart picks the chart for a summary; every chart sits in the
 * report ChartFrame with a Table toggle (the same numbers as a table), a
 * one-line text alternative, a legend for two or more series, and theme
 * colours (light / dark) from the chart palette resolver.
 */

import { Angry, Frown, Heart, Laugh, Meh, Smile, Star, ThumbsUp, type LucideIcon } from 'lucide-react'
import { ChartFrame, type ChartTableData } from '@/components/reports/chart-kit'
import { statHeadline, type ChoiceStat, type CsatStat, type LikertStat, type MatrixStat, type NpsStat, type NumberStat, type RankingStat, type RatingStat, type SliderStat, type SurveyStat } from '@/lib/forms/survey-stats'
import { Columns, HBars, Hero, Legend, StackedBar, fmt, pct, useSurveyColors } from './chart-parts'

const ICON: Record<RatingStat['icon'], LucideIcon> = { star: Star, heart: Heart, thumb: ThumbsUp }
const FACES: Record<3 | 5, LucideIcon[]> = { 3: [Frown, Meh, Smile], 5: [Angry, Frown, Meh, Smile, Laugh] }

function share(n: number, of: number) { return `${fmt(pct(n, of), 0)}%` }

/* ── Per type ────────────────────────────────────────────────────────── */

export function RatingChart({ stat }: { stat: RatingStat }) {
  const c = useSurveyColors()
  const ramp = c.sequential(stat.max)
  const Icon = ICON[stat.icon]
  const avg = stat.average ?? 0
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <Hero value={fmt(stat.average)} caption={`average out of ${stat.max}`} />
        <span className="flex pb-4" aria-hidden>
          {Array.from({ length: stat.max }, (_, i) => (
            <span key={i} className="relative inline-block size-4">
              <Icon size={16} className="absolute text-fg-subtle" />
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(1, avg - i)) * 100}%` }}>
                <Icon size={16} style={{ color: c.positive, fill: c.positive }} />
              </span>
            </span>
          ))}
        </span>
      </div>
      <HBars label={`${stat.label}: answers per point`} color={c.positive} total={stat.answered}
        rows={[...stat.distribution].reverse().map((b) => ({ key: b.name, label: `${b.name} ${stat.icon === 'star' ? '★' : ''}`.trim(), value: b.value, color: ramp[Number(b.name) - 1] }))} />
    </div>
  )
}

/** A half-circle gauge for −100…100 (the needle at the score). */
function NpsGauge({ score, color, track }: { score: number | null; color: string; track: string }) {
  const r = 52
  const angle = Math.PI * (1 - ((score ?? 0) + 100) / 200)
  const x = 60 + r * Math.cos(angle)
  const y = 60 - r * Math.sin(angle)
  const large = 0
  return (
    <svg viewBox="0 0 120 66" className="h-20 w-36" aria-hidden>
      <path d="M 8 60 A 52 52 0 0 1 112 60" fill="none" stroke={track} strokeWidth="10" strokeLinecap="round" />
      {score !== null && <path d={`M 8 60 A 52 52 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />}
      <line x1="60" y1="8" x2="60" y2="14" stroke="var(--ds-border)" strokeWidth="1.5" />
    </svg>
  )
}

export function NpsChart({ stat }: { stat: NpsStat }) {
  const c = useSurveyColors()
  const groups = [
    { key: 'detractors', label: 'Detractors (0–6)', value: stat.detractors, color: c.negative },
    { key: 'passives', label: 'Passives (7–8)', value: stat.passives, color: c.neutral },
    { key: 'promoters', label: 'Promoters (9–10)', value: stat.promoters, color: c.positive },
  ]
  const colColors = stat.distribution.map((b) => (Number(b.name) >= 9 ? c.positive : Number(b.name) >= 7 ? c.neutral : c.negative))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <NpsGauge score={stat.score} color={(stat.score ?? 0) >= 0 ? c.positive : c.negative} track="var(--ds-bg-subtle)" />
        <Hero value={stat.score === null ? '—' : `${stat.score > 0 ? '+' : ''}${stat.score}`} caption="NPS (−100 to +100): % promoters − % detractors" />
      </div>
      <StackedBar label={`${stat.label}: promoters, passives and detractors`} parts={groups} />
      <Legend items={groups.map((g) => ({ label: g.label, color: g.color, value: `${g.value} · ${share(g.value, stat.answered)}` }))} />
      <Columns label={`${stat.label}: answers per score`} colors={colColors} rows={stat.distribution.map((b) => ({ key: b.name, label: b.name, value: b.value }))} height={72} />
    </div>
  )
}

/** Diverging bar: the negative points left of the centre line, the neutral split across it, the positive ones right. */
function DivergingRow({ counts, colors, labels, label, scaleMax }: { counts: number[]; colors: string[]; labels: string[]; label: string; scaleMax: number }) {
  const n = counts.length
  const total = counts.reduce((a, b) => a + b, 0)
  const mid = (n - 1) / 2
  const neg = counts.reduce((a, v, i) => a + (i < mid ? v : 0), 0) + (n % 2 ? counts[mid] / 2 : 0)
  // The bar's width is its share of the widest row's side, centred: 50% is the centre line.
  const widthPct = total ? (total / scaleMax) * 50 : 0
  const offset = total ? 50 - (neg / scaleMax) * 50 : 50
  return (
    <div className="relative">
      <span aria-hidden className="absolute inset-y-[-3px] left-1/2 w-px" style={{ backgroundColor: 'var(--ds-border)' }} />
      <StackedBar label={label} offset={offset} width={widthPct} parts={counts.map((v, i) => ({ key: String(i), label: labels[i], value: v, color: colors[i] }))} />
    </div>
  )
}

/** The widest side (negative or positive, neutral halved) across rows: the diverging scale. */
function divergingMax(rows: number[][]): number {
  let max = 1
  for (const counts of rows) {
    const n = counts.length
    const mid = (n - 1) / 2
    const half = n % 2 ? counts[mid] / 2 : 0
    const neg = counts.reduce((a, v, i) => a + (i < mid ? v : 0), 0) + half
    const pos = counts.reduce((a, v, i) => a + (i > mid ? v : 0), 0) + half
    max = Math.max(max, neg, pos)
  }
  return max
}

export function LikertChart({ stat }: { stat: LikertStat }) {
  const c = useSurveyColors()
  const colors = c.diverging(stat.options.length)
  const counts = stat.distribution.map((b) => b.value)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6">
        <Hero value={`${fmt(stat.agree, 0)}%`} caption="agree (the upper points)" />
        <Hero value={`${fmt(stat.disagree, 0)}%`} caption="disagree (the lower points)" />
        {stat.average != null && <Hero value={fmt(stat.average)} caption={`average of ${stat.options.length} points`} />}
      </div>
      <DivergingRow counts={counts} colors={colors} labels={stat.distribution.map((b) => b.label)} label={`${stat.label}: answers per point`} scaleMax={divergingMax([counts])} />
      <Legend items={stat.distribution.map((b, i) => ({ label: b.label, color: colors[i], value: String(b.value) }))} />
    </div>
  )
}

export function MatrixChart({ stat }: { stat: MatrixStat }) {
  const c = useSurveyColors()
  const colors = c.diverging(stat.columns.length)
  const max = divergingMax(stat.rows.map((r) => r.counts))
  return (
    <div className="space-y-2.5">
      <ul className="space-y-2.5">
        {stat.rows.map((r) => (
          <li key={r.key} className="grid gap-1 sm:grid-cols-[minmax(6rem,12rem)_1fr_3.5rem] sm:items-center sm:gap-3">
            <span className="truncate text-xs text-fg" title={r.label}>{r.label}</span>
            <DivergingRow counts={r.counts} colors={colors} labels={stat.columns} label={`${r.label}: answers per column`} scaleMax={max} />
            <span className="num text-right text-xs text-fg-muted" title="Average position">{r.average == null ? '—' : `${fmt(r.average)} / ${stat.columns.length}`}</span>
          </li>
        ))}
      </ul>
      <Legend items={stat.columns.map((col, i) => ({ label: col, color: colors[i] }))} />
    </div>
  )
}

export function SliderChart({ stat }: { stat: SliderStat }) {
  const c = useSurveyColors()
  const unit = stat.unit ? ` ${stat.unit}` : ''
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-6">
        <Hero value={`${fmt(stat.average)}${unit}`} caption="average" />
        <Hero value={`${fmt(stat.median)}${unit}`} caption="median" />
        <Hero value={stat.lowest == null ? '—' : `${fmt(stat.lowest)}–${fmt(stat.highest)}`} caption={`lowest – highest (scale ${fmt(stat.min)}–${fmt(stat.max)})`} />
      </div>
      <Columns label={`${stat.label}: how many answered each value`} colors={c.positive} rows={stat.histogram.map((b) => ({ key: b.name, label: b.label, value: b.value }))} />
    </div>
  )
}

export function CsatChart({ stat }: { stat: CsatStat }) {
  const c = useSurveyColors()
  const colors = c.diverging(stat.faces)
  const faces = FACES[stat.faces]
  return (
    <div className="space-y-3">
      <Hero value={stat.satisfied == null ? '—' : `${fmt(stat.satisfied, 0)}%`} caption={`CSAT: satisfied (${stat.faces === 3 ? 'the happy face' : 'the top two faces'})${stat.average != null ? ` · average ${fmt(stat.average)} of ${stat.faces}` : ''}`} />
      <HBars label={`${stat.label}: answers per face`} color={c.positive} total={stat.answered}
        rows={[...stat.distribution].reverse().map((b) => {
          const i = Number(b.name) - 1
          const Face = faces[i]
          return { key: b.name, label: <span className="inline-flex items-center gap-1.5"><Face size={14} aria-hidden />{b.label}</span>, value: b.value, color: colors[i] }
        })} />
    </div>
  )
}

export function RankingChart({ stat }: { stat: RankingStat }) {
  const c = useSurveyColors()
  const n = stat.items.length
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-muted">Average position (1 = ranked first); longer bars ranked higher.</p>
      <HBars label={`${stat.label}: average position per option`} color={c.positive} total={stat.answered}
        rows={stat.items.map((it) => ({
          key: it.name, label: it.label,
          // Bar = how high it ranks: position 1 → full, the last → a sliver.
          value: it.average_position == null ? 0 : n - it.average_position + 1,
          text: it.average_position == null ? '—' : `#${fmt(it.average_position)} · ${it.first} first`,
        }))} />
    </div>
  )
}

export function ChoiceChart({ stat }: { stat: ChoiceStat }) {
  const c = useSurveyColors()
  const total = stat.answered
  if (stat.display === 'split') {
    const n = stat.distribution.length
    const colors = n === 2 ? [c.positive, c.negative] : n === 3 ? [c.positive, c.negative, c.neutral] : c.sequential(n)
    const parts = stat.distribution.map((b, i) => ({ key: b.name, label: b.label, value: b.value, color: colors[i] }))
    return (
      <div className="space-y-2">
        <StackedBar label={`${stat.label}: answers`} parts={parts} height={16} />
        <Legend items={parts.map((p) => ({ label: p.label, color: p.color, value: `${p.value} · ${share(p.value, total)}` }))} />
      </div>
    )
  }
  const rows = [...stat.distribution].sort((a, b) => b.value - a.value)
  return (
    <div className="space-y-2">
      {stat.multiple && <p className="text-xs text-fg-muted">People could pick several: shares are of the {total} who answered.</p>}
      <HBars label={`${stat.label}: answers per option`} color={c.positive} total={total} rows={rows.map((b) => ({ key: b.name, label: b.label, value: b.value }))} />
    </div>
  )
}

export function NumberChart({ stat }: { stat: NumberStat }) {
  const money = (n: number | null) => {
    if (n == null) return '—'
    if (!stat.currency) return fmt(n, 2)
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: stat.currency }).format(n) } catch { return fmt(n, 2) }
  }
  return (
    <div className="flex flex-wrap gap-6">
      <Hero value={money(stat.average)} caption="average" />
      <Hero value={money(stat.lowest)} caption="lowest" />
      <Hero value={money(stat.highest)} caption="highest" />
      <Hero value={money(stat.sum)} caption="total" />
    </div>
  )
}

/* ── Picking a chart, its table view ─────────────────────────────────── */

/** The same numbers as a table (the Chart / Table toggle). */
export function statTable(stat: SurveyStat): ChartTableData {
  const caption = `${stat.label}: ${statHeadline(stat)}`
  switch (stat.kind) {
    case 'rating': case 'nps': case 'likert': case 'csat': case 'choice':
      return { caption, columns: ['Answer', 'Responses', 'Share'], rows: stat.distribution.map((b) => [b.label, b.value, share(b.value, stat.answered)]) }
    case 'slider':
      return { caption, columns: ['Value', 'Responses'], rows: stat.histogram.map((b) => [b.label, b.value]) }
    case 'matrix':
      return { caption, columns: ['Statement', ...stat.columns, 'Average'], rows: stat.rows.map((r) => [r.label, ...r.counts, fmt(r.average)]) }
    case 'ranking':
      return { caption, columns: ['Option', 'Average position', 'Ranked first'], rows: stat.items.map((it) => [it.label, fmt(it.average_position), it.first]) }
    case 'number':
      return { caption, columns: ['Measure', 'Value'], rows: [['Average', fmt(stat.average, 2)], ['Lowest', fmt(stat.lowest, 2)], ['Highest', fmt(stat.highest, 2)], ['Total', fmt(stat.sum, 2)]] }
  }
}

export function StatBody({ stat }: { stat: SurveyStat }) {
  switch (stat.kind) {
    case 'rating': return <RatingChart stat={stat} />
    case 'nps': return <NpsChart stat={stat} />
    case 'likert': return <LikertChart stat={stat} />
    case 'matrix': return <MatrixChart stat={stat} />
    case 'slider': return <SliderChart stat={stat} />
    case 'csat': return <CsatChart stat={stat} />
    case 'ranking': return <RankingChart stat={stat} />
    case 'choice': return <ChoiceChart stat={stat} />
    case 'number': return <NumberChart stat={stat} />
  }
}

/**
 * One question's result: the chart its type calls for, in a frame with the
 * question, its headline (also the text alternative), the answer count and a
 * Table toggle.
 */
export function SurveyStatChart({ stat, className }: { stat: SurveyStat; className?: string }) {
  const headline = statHeadline(stat)
  return (
    <ChartFrame className={className} title={stat.label} description={`${stat.answered} of ${stat.total} answered`} table={statTable(stat)}>
      <p className="sr-only">{headline}</p>
      <div data-survey-chart={stat.kind} data-field-type={stat.field_type}>
        {stat.answered === 0 ? <p className="py-6 text-center text-sm text-fg-muted">No answers yet</p> : <StatBody stat={stat} />}
      </div>
    </ChartFrame>
  )
}

/** Responses per day (the last 30 days) as columns, with the total. */
export function ResponseTrendChart({ trend, className }: { trend: Array<{ date: string; count: number }>; className?: string }) {
  const c = useSurveyColors()
  const total = trend.reduce((a, d) => a + d.count, 0)
  const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <ChartFrame className={className} title="Responses over time" description={`${total} in the last ${trend.length} days`}
      table={{ caption: 'Responses per day', columns: ['Day', 'Responses'], rows: trend.map((d) => [label(d.date), d.count]) }}>
      <Columns label="Responses per day" colors={c.positive} rows={trend.map((d) => ({ key: d.date, label: label(d.date), value: d.count }))} showLabels={false} height={72} />
      <div className="mt-1 flex justify-between text-2xs text-fg-muted" aria-hidden>
        <span>{trend[0] ? label(trend[0].date) : ''}</span>
        <span>{trend.length ? label(trend[trend.length - 1].date) : ''}</span>
      </div>
    </ChartFrame>
  )
}

/** How many answered each question (completion), as bars. */
export function CompletionChart({ completion, total, className }: { completion: Array<{ key: string; label: string; answered: number; share: number }>; total: number; className?: string }) {
  const c = useSurveyColors()
  return (
    <ChartFrame className={className} title="Answered per question" description={`Out of ${total} response${total === 1 ? '' : 's'}`}
      table={{ caption: 'Answered per question', columns: ['Question', 'Answered', 'Share'], rows: completion.map((q) => [q.label, q.answered, `${fmt(q.share, 0)}%`]) }}>
      <HBars label="Answered per question" color={c.positive} total={total} rows={completion.map((q) => ({ key: q.key, label: q.label, value: q.answered }))} />
    </ChartFrame>
  )
}
