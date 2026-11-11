/**
 * Timeline: a run (or a standalone task) told as a story people can read —
 * when it started and by whom, who each step went to, accepts / holds,
 * reassignments, comments, approvals, notable automatic steps (emails, data
 * writes, decisions, waits, sub-workflows, errors), how it ended and where it
 * is now. Built server-side (lib/services/run-timeline.ts) from the run, its
 * trace, its tasks and their history, filtered to what the caller may see.
 *
 * This module is client-safe: the shared shape, the filter chips and the
 * small helpers the UI, REST, MCP and the Agent all use.
 */

export type TimelineKind =
  | 'started' | 'task_created' | 'accepted' | 'held' | 'declined'
  | 'reassigned' | 'redirected' | 'escalated' | 'took_ownership'
  | 'comment' | 'outcome' | 'task_closed'
  | 'attachment' | 'subtask' | 'shared' | 'form_saved' | 'effort'
  | 'system' | 'system_group' | 'subworkflow' | 'error'
  | 'run_paused' | 'run_resumed' | 'run_cancelled'
  | 'ended' | 'now'

/** Filter chips: Approvals & decisions / Comments / People & assignments / System. */
export type TimelineCategory = 'decisions' | 'comments' | 'people' | 'system'

export type TimelineTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

/** Icon names the UI maps to lucide icons (kept as names so REST / MCP carry them too). */
export type TimelineIcon =
  | 'play' | 'form' | 'user' | 'check' | 'x' | 'message' | 'mail' | 'database' | 'branch' | 'clock'
  | 'workflow' | 'alert' | 'paperclip' | 'list' | 'share' | 'flag' | 'hourglass' | 'bot' | 'pause'
  | 'arrow' | 'cog' | 'rules' | 'bell' | 'plug' | 'save' | 'timer' | 'stop'

export interface TimelinePerson { id: string | null; name: string; avatar_url: string | null }

export interface TimelineLink {
  kind: 'task' | 'form' | 'process' | 'run'
  label: string
  href: string
}

export interface TimelineField { label: string; value: string }

export interface TimelineEvent {
  id: string
  kind: TimelineKind
  category: TimelineCategory
  /** ISO time (null: not recorded). */
  at: string | null
  actor: TimelinePerson | null
  /** Acted for this person (a manager / workflow manager / admin on their behalf). */
  on_behalf_of?: TimelinePerson | null
  /** How it was done when not in the app: agent, api, mcp, email… */
  via?: string | null
  icon: TimelineIcon
  tone: TimelineTone
  title: string
  /** The step it happened on ("Finance approval"). */
  step?: string | null
  /** Comment text, outcome notes, an error message… */
  body?: string | null
  /** The on-behalf reason. */
  note?: string | null
  /** The outcome, as a coloured badge. */
  badge?: { label: string; tone: TimelineTone } | null
  /** A few highlighted form values (outcome events). */
  fields?: TimelineField[]
  links?: TimelineLink[]
  /** Started: the start form submission the caller may open (its submitter, or full detail). */
  submission?: { id: string; form_id: string; form_name: string } | null
  task_id?: string | null
  node_id?: string | null
  /** Task created: when it is due. */
  due_date?: string | null
  /** Since the previous human event (ms) — "2 h 15 m later". */
  since_previous_ms?: number | null
  /** A group ("6 automatic steps") or a sub-workflow: its steps, collapsed by default. */
  children?: TimelineEvent[]
  /** Highlighted (the "Now" line). */
  highlight?: boolean
}

export type TimelineRunStatus = 'running' | 'waiting' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'queued'

export interface TimelineHeader {
  workflow: { id: string | null; name: string } | null
  /** The run's title, else the task's title. */
  title: string | null
  /** The submission's reference ("PR-1042" / short id). */
  reference: string | null
  status: string
  status_label: string
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  started_by: TimelinePerson | null
  started_how: string | null
  /** Where it is now ("Waiting for Priya Shah — Finance approval"). */
  current: string | null
  version: number | null
  sla_due_at: string | null
}

export interface RunTimeline {
  /** run: a workflow run; task: one task's own history (a standalone task, or a workflow task whose run the caller can't see). */
  kind: 'run' | 'task'
  run_id: string | null
  task_id: string | null
  /** The task the timeline was opened from. */
  focus_task_id: string | null
  /**
   * What the caller sees: full (the run is in their run scope — every step,
   * errors and values), progress (they may follow the run's progress — people
   * and steps, no internal values or error text), task (one task only).
   */
  detail: 'full' | 'progress' | 'task'
  header: TimelineHeader
  events: TimelineEvent[]
  /** Still moving: the UI polls (processViewPollMs of `status`). */
  live: boolean
  links: { process: string | null; timeline: string; task: string | null }
}

export type TimelineTarget = { runId: string; taskId?: undefined } | { taskId: string; runId?: undefined }

export const TIMELINE_FILTERS: ReadonlyArray<{ value: 'all' | TimelineCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'decisions', label: 'Approvals & decisions' },
  { value: 'comments', label: 'Comments' },
  { value: 'people', label: 'People & assignments' },
  { value: 'system', label: 'System' },
]

/** Events of a filter chip. Ended / Started / Now always show; groups keep the children that match. */
export function filterTimeline(events: readonly TimelineEvent[], filter: 'all' | TimelineCategory): TimelineEvent[] {
  if (filter === 'all') return [...events]
  const always = new Set<TimelineKind>(['started', 'ended', 'now'])
  return events.filter((e) => always.has(e.kind) || e.category === filter)
}

/** "45 s", "12 m", "2 h 15 m", "3 d 4 h". */
export function formatGap(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} m` : `${h} h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`
}

/** Plain-text version (Copy as text, the Agent): one line per event, children indented. */
export function timelineAsText(timeline: Pick<RunTimeline, 'header' | 'events'>, format: (iso: string) => string = (iso) => iso.replace('T', ' ').slice(0, 16)): string {
  const h = timeline.header
  const lines: string[] = []
  lines.push([h.workflow?.name, h.title].filter(Boolean).join(' — ') || 'Timeline')
  const meta = [h.status_label, h.started_by ? `started by ${h.started_by.name}` : h.started_how, h.duration_ms != null ? `took ${formatGap(h.duration_ms)}` : null, h.current].filter(Boolean)
  if (meta.length) lines.push(meta.join(' · '))
  lines.push('')
  const line = (e: TimelineEvent, indent: string) => {
    const when = e.at ? `${format(e.at)}  ` : ''
    const who = e.actor && !e.title.includes(e.actor.name) ? ` (${e.actor.name}${e.on_behalf_of ? ` for ${e.on_behalf_of.name}` : ''})` : ''
    const badge = e.badge ? ` [${e.badge.label}]` : ''
    lines.push(`${indent}${when}${e.kind === 'now' ? 'Now: ' : ''}${e.title}${e.step && !e.title.includes(e.step) ? ` (${e.step})` : ''}${badge}${who}`)
    if (e.note) lines.push(`${indent}    Reason: ${e.note}`)
    if (e.body) lines.push(`${indent}    “${e.body.replace(/\s+/g, ' ').slice(0, 500)}”`)
    for (const f of e.fields ?? []) lines.push(`${indent}    ${f.label}: ${f.value}`)
    for (const c of e.children ?? []) line(c, `${indent}    `)
  }
  for (const e of timeline.events) line(e, '')
  return lines.join('\n')
}
