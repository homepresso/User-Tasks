/**
 * Home → My activity: the shapes the stats read returns, the period rules,
 * and the formatters the charts use (shared by the service, the API and the
 * browser). The aggregates themselves are computed in SQL
 * (supabase/migrations/20261220000000_home_activity_stats.sql).
 *
 * Metric definitions (also in the Home docs page):
 *  - My tasks: completed (not deleted) in the period, assigned to me, or with
 *    no single assignee (team / collaborative) and I responded.
 *  - Decisions: my outcome (my own response, else the task's) mapped by
 *    OUTCOME_RULES. Approval rate = approve ÷ decisions (approve + reject +
 *    return + other). Completions without a choice are not decisions.
 *  - Time to complete: assigned (created, or last reassigned) → completed.
 *    Time to pick up: assigned → accepted / claimed.
 *  - On time: completed at or before the task's due date, else its run's SLA
 *    due time; tasks with neither are left out of the share.
 *  - Day buckets (7 / 30 days) and ISO-week buckets (90 days, weeks start on
 *    Monday) are in the time zone the read reports (the browser's when the
 *    app asks, else the profile's, else UTC).
 */

export const HOME_STATS_PERIODS = [7, 30, 90] as const
export type HomeStatsPeriod = (typeof HOME_STATS_PERIODS)[number]
export const DEFAULT_HOME_STATS_PERIOD: HomeStatsPeriod = 30

/** "7d" / "30d" / "90d" / 7 / "7" → the period; anything else → 30. */
export function parseStatsPeriod(value: unknown): HomeStatsPeriod {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(/d$/i, ''))
  return (HOME_STATS_PERIODS as readonly number[]).includes(n) ? (n as HomeStatsPeriod) : DEFAULT_HOME_STATS_PERIOD
}

export type OutcomeKind = 'approve' | 'reject' | 'return' | 'other' | 'completion'

/** How outcome labels map to decision kinds (mirrors public.home_outcome_kind; documented on the Home page). */
export const OUTCOME_RULES: ReadonlyArray<{ kind: OutcomeKind; label: string; matches: string }> = [
  { kind: 'reject', label: 'Rejected', matches: 'Reject, Decline, Deny / Denied, Refuse, Disapprove, Veto, Not approved, Unapproved, No, Fail' },
  { kind: 'approve', label: 'Approved', matches: 'Approve, Accept, Authorise / Authorize, Endorse, Grant, Sign off, Agree, Yes, Pass, Go ahead' },
  { kind: 'return', label: 'Sent back', matches: 'Send back, Return, Request changes, Changes requested, Rework, Revise, More info, Need info' },
  { kind: 'completion', label: 'Completed (not a decision)', matches: 'Completed, Complete, Done, Submit(ted), Finish(ed), Close(d), Acknowledge(d), Noted, OK, Save(d) — and any other label on a task that offered one outcome or none' },
  { kind: 'other', label: 'Its own label', matches: 'Any other label on a task that offered two or more outcomes (Escalate, Partial release …)' },
]

const REJECT_RE = /\b(reject\w*|declin\w*|deny|denied|refus\w*|disapprov\w*|veto\w*|not approved?|unapproved)\b/
const APPROVE_RE = /\b(approv\w*|accept\w*|authori[sz]\w*|endors\w*|grant\w*|signs? off|signed off|agree\w*|go ahead)\b/
const RETURN_RE = /\b(sen[dt] back|return\w*|requests? changes?|requested changes?|changes? requested|rework\w*|revis\w*|more info\w*|needs? (more )?info\w*)\b/
const COMPLETION_WORDS = new Set(['completed', 'complete', 'done', 'submit', 'submitted', 'finish', 'finished', 'close', 'closed', 'acknowledge', 'acknowledged', 'noted', 'ok', 'okay', 'save', 'saved'])

/**
 * An outcome's kind: the TypeScript twin of public.home_outcome_kind (same
 * rules, same order: reject before approve, so "Not approved" is a
 * rejection). `available`: the outcomes the task offered (two or more make
 * an unmatched label a real choice, "other"; else it is a "completion").
 */
export function classifyOutcome(outcome: string | null | undefined, available: readonly unknown[] | null | undefined = []): OutcomeKind {
  const v = String(outcome ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const n = Array.isArray(available) ? available.length : 0
  if (!v) return 'completion'
  if (REJECT_RE.test(v) || ['no', 'fail', 'failed'].includes(v)) return 'reject'
  if (APPROVE_RE.test(v) || ['yes', 'pass', 'passed'].includes(v)) return 'approve'
  if (RETURN_RE.test(v)) return 'return'
  if (COMPLETION_WORDS.has(v)) return 'completion'
  return n >= 2 ? 'other' : 'completion'
}

export interface StatsBucket { start: string; count: number; median_s: number | null; p90_s: number | null }
export interface DecisionGroup { kind: OutcomeKind; label: string; count: number }

export interface HomeTaskStats {
  period: { days: HomeStatsPeriod; unit: 'day' | 'week'; timezone: string; start: string; end: string }
  completed: { total: number; buckets: StatsBucket[] }
  decisions: {
    total: number; approved: number; rejected: number; returned: number
    approval_rate: number | null; non_decision: number
    groups: DecisionGroup[]; non_decision_labels: string[]
  }
  durations: { count: number; median_s: number | null; p90_s: number | null; pickup: { count: number; median_s: number | null; p90_s: number | null } }
  on_time: { with_deadline: number; on_time: number; late: number; no_deadline: number; rate: number | null }
  top_processes: Array<{ workflow_id: string; name: string; count: number }>
}

export interface HomeSubmissionStats {
  days: HomeStatsPeriod
  timezone: string
  total: number; completed: number; in_progress: number; failed: number; cancelled: number; no_process: number
  median_s: number | null; p90_s: number | null
}

export interface HomeActivityStats {
  period: HomeStatsPeriod
  timezone: string
  /** Null without tasks.view_own. */
  tasks: HomeTaskStats | null
  /** Null without forms.submit. */
  submissions: HomeSubmissionStats | null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v)) || 0
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Coerce the SQL jsonb (numerics may arrive as strings) into HomeTaskStats. */
export function normaliseTaskStats(raw: unknown): HomeTaskStats {
  const r = (raw ?? {}) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- jsonb
  const p = r.period ?? {}
  const d = r.decisions ?? {}
  const du = r.durations ?? {}
  const ot = r.on_time ?? {}
  return {
    period: { days: parseStatsPeriod(p.days), unit: p.unit === 'week' ? 'week' : 'day', timezone: String(p.timezone ?? 'UTC'), start: String(p.start ?? ''), end: String(p.end ?? '') },
    completed: {
      total: num(r.completed?.total),
      buckets: (Array.isArray(r.completed?.buckets) ? r.completed.buckets : []).map((b: Record<string, unknown>) => ({
        start: String(b.start), count: num(b.count), median_s: numOrNull(b.median_s), p90_s: numOrNull(b.p90_s),
      })),
    },
    decisions: {
      total: num(d.total), approved: num(d.approved), rejected: num(d.rejected), returned: num(d.returned),
      approval_rate: numOrNull(d.approval_rate), non_decision: num(d.non_decision),
      groups: (Array.isArray(d.groups) ? d.groups : []).map((g: Record<string, unknown>) => ({ kind: String(g.kind) as OutcomeKind, label: String(g.label), count: num(g.count) })),
      non_decision_labels: (Array.isArray(d.non_decision_labels) ? d.non_decision_labels : []).map(String),
    },
    durations: {
      count: num(du.count), median_s: numOrNull(du.median_s), p90_s: numOrNull(du.p90_s),
      pickup: { count: num(du.pickup?.count), median_s: numOrNull(du.pickup?.median_s), p90_s: numOrNull(du.pickup?.p90_s) },
    },
    on_time: { with_deadline: num(ot.with_deadline), on_time: num(ot.on_time), late: num(ot.late), no_deadline: num(ot.no_deadline), rate: numOrNull(ot.rate) },
    top_processes: (Array.isArray(r.top_processes) ? r.top_processes : []).map((t: Record<string, unknown>) => ({ workflow_id: String(t.workflow_id), name: String(t.name ?? 'Process'), count: num(t.count) })),
  }
}

export function normaliseSubmissionStats(raw: unknown): HomeSubmissionStats {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    days: parseStatsPeriod(r.days), timezone: String(r.timezone ?? 'UTC'), total: num(r.total), completed: num(r.completed), in_progress: num(r.in_progress),
    failed: num(r.failed), cancelled: num(r.cancelled), no_process: num(r.no_process),
    median_s: numOrNull(r.median_s), p90_s: numOrNull(r.p90_s),
  }
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/**
 * A duration in words: "< 1 m", "45 m", "2 h 15 m", "1 day 4 h", "3 days",
 * "12 days". Numbers use the viewer's locale.
 */
export function humaniseDuration(seconds: number | null | undefined, locale?: string): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, seconds)
  const n = (v: number, digits = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)
  if (s < 60) return '< 1 m'
  const mins = Math.round(s / 60)
  if (mins < 60) return `${n(mins)} m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    const m = mins % 60
    return m ? `${n(hours)} h ${n(m)} m` : `${n(hours)} h`
  }
  const totalHours = Math.round(s / 3600)
  if (totalHours < 48) {
    const h = totalHours % 24
    return h ? `1 day ${n(h)} h` : '1 day'
  }
  const exact = s / 86_400
  return `${n(exact, exact < 10 ? 1 : 0)} days`
}

/** A share 0–1 as a whole percentage in the viewer's locale ("78%"). */
export function formatShare(rate: number | null | undefined, locale?: string): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—'
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(rate)
}

export function formatCount(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(n)
}

/** A bucket's label: "4 Nov" for a day, "Week of 3 Nov" for a week (UTC date maths: buckets are calendar dates). */
export function bucketLabel(start: string, unit: 'day' | 'week', locale?: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(`${start}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return start
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC', ...(style === 'long' && unit === 'day' ? { weekday: 'short' } : {}) })
  const text = fmt.format(d)
  return unit === 'week' && style === 'long' ? `Week of ${text}` : text
}

/** A sensible y-axis unit for a set of durations (seconds). */
export function durationAxisUnit(maxSeconds: number): { unit: 'm' | 'h' | 'd'; divisor: number; label: string } {
  if (maxSeconds >= 3 * 86_400) return { unit: 'd', divisor: 86_400, label: 'days' }
  if (maxSeconds >= 3 * 3600) return { unit: 'h', divisor: 3600, label: 'hours' }
  return { unit: 'm', divisor: 60, label: 'minutes' }
}
