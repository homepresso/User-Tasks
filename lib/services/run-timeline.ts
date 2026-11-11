/**
 * Timeline (lib/run-timeline.ts describes the shape): a workflow run — or a
 * standalone task — as a readable story, built from the run row, its
 * execution trace and node results, its User Tasks (lib/services/run-tasks:
 * who has each and what this caller may open), their lifecycle events
 * (accepts, holds, reassignments, comments, responses, attachments,
 * subtasks, invites) and the run's audit lines (pause / resume / cancel).
 *
 * Visibility (the same rules as the process views — never wider):
 *  - run: in the caller's run scope (lib/services/run-visibility: view_runs,
 *    or view_queue and involved / an explicit workflow View grant) → `full`;
 *    else can_view_run_progress (started it, their submission, a task in it,
 *    an invited viewer of one of its tasks) → `progress`; else not found.
 *    API-key workflow allowlists apply on top.
 *  - `progress` sees people and steps, never internal values: labels are not
 *    resolved against run variables, error text is hidden, and who submitted
 *    the start form is shown only to the submitter (as Home does).
 *  - per task: comments, notes, form values, reassignment / share lines need
 *    the task to be openable (RunTask.can_open) or an invite to view it
 *    (task_viewer_grant); the outcome also shows with `full`.
 *  - task: a task the caller can view (lib/task-authz canViewTask). A
 *    workflow task whose run they may see opens the run's timeline; else the
 *    task's own history.
 */

import type { RunTask } from '@/lib/run-tasks'
import { runOutcomeLabel } from '@/lib/run-tasks'
import { classifyOutcome } from '@/lib/home/activity'
import { resolveTemplateText } from '@/lib/assistants/process'
import { isSensitiveFieldName } from '@/lib/response-schema'
import { isSensitiveKey } from '@/lib/secret-keys'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { describeListValue } from '@/lib/forms/list-field'
import { canViewTask, findTaskViewerGrant } from '@/lib/task-authz'
import {
  formatGap,
  type RunTimeline, type TimelineCategory, type TimelineEvent, type TimelineField, type TimelineHeader,
  type TimelineIcon, type TimelineLink, type TimelinePerson, type TimelineTarget, type TimelineTone,
} from '@/lib/run-timeline'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { resolveRunScope, runInScope } from './run-visibility'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows and definitions */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TIMELINE_EVENT_LIMIT = 2000
const MAX_GROUP_CHILDREN = 200
const MAX_FIELDS = 3
const LIVE = new Set(['running', 'processing', 'pending', 'queued', 'waiting_for_event', 'waiting', 'paused'])
const HUMAN_NODES = new Set(['user_task', 'approval', 'form_task'])
const TRIGGER_NODES = new Set(['manual', 'form_submitted', 'start', 'schedule', 'webhook', 'webhook_received', 'email_received', 'data_table_event', 'api_trigger', 'middleware_received', 'workflow_sla', 'task_completed'])
const SUB_NODES = new Set(['call_sub_workflow', 'sub_workflow', 'call_workflow', 'run_workflow', 'start_workflow', 'trigger_workflow'])
const WAIT_NODES = new Set(['delay', 'pause_until'])
const NOTIFY_NODES = new Set(['send_notification', 'notification', 'send_slack', 'send_teams'])
const CALL_NODES = new Set(['call_reference', 'custom_activity', 'http_request', 'api_call'])
/** Steps worth their own line, named by their label. */
const LABEL_NOTABLE = new Set(['add_user_to_role', 'remove_user_from_role', 'create_subtask', 'doc_pdf', 'doc_word', 'doc_excel', 'doc_powerpoint', 'set_sla', 'add_task_attachment'])
const SKIP_FIELD_TYPES = new Set(['user', 'users', 'file', 'files', 'attachment', 'signature', 'image', 'heading', 'section', 'html', 'divider', 'info', 'paragraph'])

/* ── Rows the builder reads ───────────────────────────────────────────── */

export interface TimelineRunRow {
  id: string
  workflow_id: string | null
  version_id?: string | null
  status: string
  title?: string | null
  error?: string | null
  started_at?: string | null
  completed_at?: string | null
  paused_at?: string | null
  paused_node_id?: string | null
  started_by?: string | null
  started_via?: string | null
  form_submission_id?: string | null
  variables?: Record<string, unknown> | null
  execution_trace?: any[] | null
  node_results?: Record<string, any> | null
  sla_due_at?: string | null
  migrated_to_run_id?: string | null
}

export interface TimelineTaskRow {
  id: string
  title?: string | null
  status: string
  created_at?: string | null
  completed_at?: string | null
  actioned_at?: string | null
  due_date?: string | null
  outcome?: string | null
  outcome_notes?: string | null
  actioned_by?: string | null
  actioned_on_behalf_of?: string | null
  assignee_id?: string | null
  assigned_team_id?: string | null
  assigner_id?: string | null
  workflow_step_id?: string | null
  workflow_id?: string | null
  workflow_run_id?: string | null
  metadata?: Record<string, any> | null
  available_outcomes?: unknown
  parent_task_id?: string | null
}

export interface TimelineLifecycleRow {
  id?: string
  task_id: string
  event_type: string
  actor_id: string | null
  metadata: Record<string, any> | null
  created_at: string
}

export interface TimelineAuditRow { id?: string; actor_id: string | null; summary: string | null; metadata?: Record<string, any> | null; created_at: string }

export interface TimelineSubRun { id: string; status: string; name: string; started_at: string | null; completed_at: string | null; execution_trace: any[] | null; node_results: Record<string, any> | null }

export interface TimelineNames {
  tables?: Map<string, string>
  workflows?: Map<string, string>
  decisionTables?: Map<string, string>
}

export interface RunTimelineInput {
  run: TimelineRunRow
  workflow: { id: string | null; name: string; version?: number | null }
  nodes: any[]
  submission?: { id: string; form_id: string | null; form_name: string | null; created_at: string | null; submitted_by: string | null } | null
  /** The run's tasks for this caller (lib/services/run-tasks). */
  tasks: RunTask[]
  taskRows: TimelineTaskRow[]
  events: TimelineLifecycleRow[]
  audits?: TimelineAuditRow[]
  people: Map<string, TimelinePerson>
  teams?: Map<string, string>
  names?: TimelineNames
  /** Sub-workflow runs, by the calling node's trace index. */
  subRuns?: Map<number, TimelineSubRun>
  viewer: { id: string | null; tier: 'full' | 'progress'; viewerTaskIds?: ReadonlySet<string>; canOpenForms?: boolean }
  focusTaskId?: string | null
  /** Clock (tests). */
  now?: number
}

export interface TaskTimelineInput {
  task: TimelineTaskRow
  events: TimelineLifecycleRow[]
  people: Map<string, TimelinePerson>
  teams?: Map<string, string>
  workflow?: { id: string | null; name: string } | null
  stepName?: string | null
  now?: number
}

/* ── Small helpers ────────────────────────────────────────────────────── */

function personOf(people: Map<string, TimelinePerson>, id: unknown): TimelinePerson | null {
  if (!id || typeof id !== 'string') return null
  return people.get(id) ?? { id, name: 'Someone', avatar_url: null }
}

function namesList(names: string[]): string {
  const list = names.filter(Boolean)
  if (!list.length) return 'someone'
  if (list.length === 1) return list[0]
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

function idsOf(v: unknown): string[] {
  return (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === 'string' && x.length > 0)
}

function text(v: unknown, max = 2000): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null
}

const ms = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN
  return Number.isFinite(t) ? t : null
}

function outcomeTone(outcome: string, available?: unknown): TimelineTone {
  const kind = classifyOutcome(outcome, Array.isArray(available) ? available : [])
  return kind === 'approve' ? 'success' : kind === 'reject' ? 'danger' : kind === 'return' ? 'warning' : kind === 'other' ? 'brand' : 'success'
}

function outcomeVerb(outcome: string | null, available?: unknown): string {
  if (!outcome) return 'Completed'
  const kind = classifyOutcome(outcome, Array.isArray(available) ? available : [])
  return kind === 'approve' ? 'Approved' : kind === 'reject' ? 'Declined' : kind === 'return' ? 'Sent back' : kind === 'other' ? runOutcomeLabel(outcome) : 'Completed'
}

const VIA_LABEL: Record<string, string> = { agent: 'the Agent', api: 'the API', mcp: 'MCP', email: 'email', teams: 'Teams', slack: 'Slack', cli: 'the CLI', mobile: 'mobile' }
function viaOf(m: Record<string, any> | null | undefined): string | null {
  const v = typeof m?.via === 'string' ? m.via : null
  return v && v !== 'ui' ? (VIA_LABEL[v] ?? v) : null
}

/** A few of the values the person entered (not read-only fields; secrets masked; no people / files). */
export function highlightedFields(row: TimelineTaskRow | undefined): TimelineField[] {
  const meta = row?.metadata ?? {}
  const values = meta.template_values && typeof meta.template_values === 'object' ? meta.template_values as Record<string, unknown> : {}
  const out: TimelineField[] = []
  for (const f of normalizeTaskFields(meta.fields)) {
    if (out.length >= MAX_FIELDS) break
    if (f.read_only || SKIP_FIELD_TYPES.has(String(f.type))) continue
    const v = values[f.key]
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || typeof v === 'object' && !Array.isArray(v)) continue
    // A List's rows: "3 rows" (the rows themselves are on the task / submission).
    if (f.type === 'list') { out.push({ label: f.label || f.key, value: describeListValue(v) }); continue }
    const secret = isSensitiveFieldName(f.key) || isSensitiveKey(f.key) || String(f.type) === 'password'
    const shown = secret ? '••••' : Array.isArray(v) ? v.map((x) => f.option_labels?.[String(x)] ?? String(x)).join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (f.option_labels?.[String(v)] ?? String(v))
    out.push({ label: f.label || f.key, value: shown.length > 120 ? `${shown.slice(0, 119)}…` : shown })
  }
  return out
}

function ev(partial: Omit<TimelineEvent, 'tone' | 'icon' | 'actor'> & Partial<Pick<TimelineEvent, 'tone' | 'icon' | 'actor'>>): TimelineEvent {
  return { tone: 'neutral', icon: 'cog', actor: null, ...partial }
}

/* ── Lifecycle events → timeline events (task history) ────────────────── */

interface TaskCtx {
  step: string | null
  detail: boolean
  outcomeVisible: boolean
  href: string | null
  available?: unknown
}

/**
 * One lifecycle row as a timeline event; null when it isn't shown (covered
 * elsewhere, or a detail the caller may not see).
 */
export function lifecycleToEvent(e: TimelineLifecycleRow, people: Map<string, TimelinePerson>, teams: Map<string, string>, t: TaskCtx): TimelineEvent | null {
  const m = e.metadata ?? {}
  const actor = personOf(people, e.actor_id)
  const who = actor?.name ?? 'Someone'
  const base = { id: `le:${e.id ?? `${e.task_id}:${e.event_type}:${e.created_at}`}`, at: e.created_at, actor, task_id: e.task_id, step: t.step, via: viaOf(m) }
  const behalf = personOf(people, m.on_behalf_of)
  const teamName = (id: unknown) => (typeof id === 'string' && id ? (teams.get(id) ?? 'a team') : null)
  switch (e.event_type) {
    case 'task_accepted':
      return ev({ ...base, kind: 'accepted', category: 'people', icon: 'check', tone: 'info', title: `Accepted by ${who}`, body: t.detail ? text(m.comment) : null })
    case 'task_held':
      return ev({ ...base, kind: 'held', category: 'people', icon: 'pause', tone: 'warning', title: `Put on hold by ${who}`, body: t.detail ? text(m.comment ?? m.reason) : null })
    case 'task_rejected':
      return ev({ ...base, kind: 'declined', category: 'people', icon: 'x', tone: 'danger', title: `Declined by ${who}`, body: t.detail ? text(m.comment) : null })
    case 'reassigned': {
      if (!t.detail) return null
      const from = [...idsOf(m.old_assignee).map((id) => personOf(people, id)!.name), ...(teamName(m.old_team) ? [teamName(m.old_team)!] : [])]
      const to = [...idsOf(m.new_assignee).map((id) => personOf(people, id)!.name), ...(teamName(m.new_team) ? [`the ${teamName(m.new_team)} team`] : [])]
      if (m.took_ownership) return ev({ ...base, kind: 'took_ownership', category: 'people', icon: 'user', tone: 'info', title: `${who} took ownership`, body: text(m.comment) })
      return ev({ ...base, kind: 'reassigned', category: 'people', icon: 'arrow', tone: 'warning', on_behalf_of: behalf, title: `Reassigned${from.length ? ` from ${namesList(from)}` : ''} to ${namesList(to)}`, body: text(m.comment) })
    }
    case 'task_redirected': {
      if (!t.detail) return null
      const to = [...idsOf(m.to_user_ids).map((id) => personOf(people, id)!.name), ...(Array.isArray(m.invited_emails) ? m.invited_emails.map(String) : [])]
      return ev({ ...base, kind: 'redirected', category: 'people', icon: 'arrow', tone: 'warning', on_behalf_of: behalf, title: `${who} redirected it to ${namesList(to)}`, body: text(m.comment) })
    }
    case 'task_escalated': {
      if (!t.detail) return null
      const to = [...idsOf(m.escalated_to_user).map((id) => personOf(people, id)!.name), ...(teamName(m.escalated_to_team) ? [`the ${teamName(m.escalated_to_team)} team`] : [])]
      return ev({ ...base, kind: 'escalated', category: 'people', icon: 'flag', tone: 'danger', title: `Escalated to ${namesList(to)}`, body: text(m.comment ?? m.reason) })
    }
    case 'comment_added': {
      if (!t.detail) return null
      if (m.source === 'subtask_added') return ev({ ...base, kind: 'subtask', category: 'people', icon: 'list', tone: 'neutral', title: text(m.message, 200) ?? 'Added a subtask' })
      if (m.source === 'effort_log' || m.source === 'timer_entry') {
        return ev({ ...base, kind: 'effort', category: 'people', icon: 'timer', tone: 'neutral', title: `${who} logged ${m.hours != null ? `${m.hours} h` : 'time'}`, body: text(m.notes) })
      }
      const subject = text(m.subject, 200)
      return ev({ ...base, kind: 'comment', category: 'comments', icon: 'message', tone: 'brand', title: m.source === 'task_message' ? `${who} sent a message${subject ? `: ${subject}` : ''}` : `${who} commented`, body: text(m.message ?? m.comment, 4000) })
    }
    case 'attachment_added':
      if (!t.detail) return null
      return ev({ ...base, kind: 'attachment', category: 'people', icon: 'paperclip', tone: 'neutral', title: `${who} attached “${text(m.name, 120) ?? text(m.file_name, 120) ?? 'a file'}”`, body: m.file_name && m.name && m.file_name !== m.name ? String(m.file_name) : null })
    case 'attachment_deleted':
      if (!t.detail) return null
      return ev({ ...base, kind: 'attachment', category: 'people', icon: 'paperclip', tone: 'neutral', title: `${who} removed “${text(m.name, 120) ?? text(m.file_name, 120) ?? 'a file'}”` })
    case 'assigned': {
      if (!t.detail) return null
      if (m.action === 'viewers_invited' || m.action === 'viewer_removed') {
        const msg = text(m.message, 200) ?? (m.action === 'viewers_invited' ? 'shared it' : 'stopped sharing it')
        return ev({ ...base, kind: 'shared', category: 'people', icon: 'share', tone: 'neutral', title: `${who} ${msg}`, body: text(m.comment) })
      }
      return null
    }
    case 'completed':
      if (m.source === 'subtask_toggle' && t.detail) return ev({ ...base, kind: 'subtask', category: 'people', icon: 'check', tone: 'success', title: `${who} completed subtask “${text(m.subtask_title, 120) ?? ''}”` })
      return null
    case 'reopened':
      if (m.source === 'subtask_toggle') return t.detail ? ev({ ...base, kind: 'subtask', category: 'people', icon: 'list', tone: 'neutral', title: `${who} reopened subtask “${text(m.subtask_title, 120) ?? ''}”` }) : null
      return ev({ ...base, kind: 'task_closed', category: 'decisions', icon: 'arrow', tone: 'warning', title: `Reopened by ${who}` })
    case 'cancelled':
      return ev({ ...base, kind: 'task_closed', category: 'decisions', icon: 'stop', tone: 'neutral', title: `Cancelled by ${who}`, body: t.detail ? text(m.comment ?? m.reason) : null })
    case 'started':
      return ev({ ...base, kind: 'accepted', category: 'people', icon: 'play', tone: 'info', title: `${who} started working on it` })
    case 'blocked':
      return ev({ ...base, kind: 'held', category: 'people', icon: 'pause', tone: 'danger', title: 'Blocked', body: t.detail ? text(m.reason ?? m.comment) : null })
    case 'unblocked':
      return ev({ ...base, kind: 'accepted', category: 'people', icon: 'play', tone: 'success', title: 'Unblocked' })
    case 'task_data_saved':
      if (!t.detail) return null
      return ev({ ...base, kind: 'form_saved', category: 'people', icon: 'save', tone: 'neutral', title: `${who} saved the form` })
    case 'task_unanimous_failed':
      return ev({ ...base, kind: 'outcome', category: 'decisions', icon: 'x', tone: 'danger', title: 'No unanimous decision' })
    default:
      return null
  }
}

/** A response (lifecycle task_response, else the task row) as an outcome event. */
function responseEvent(args: {
  id: string; at: string | null; actorId: string | null; behalfId: string | null; outcome: string | null; notes: string | null; behalfNote: string | null
  via: string | null; taskId: string; row?: TimelineTaskRow; people: Map<string, TimelinePerson>; t: TaskCtx
}): TimelineEvent {
  const { t, people } = args
  const outcome = t.outcomeVisible ? args.outcome : null
  const actor = personOf(people, args.actorId)
  const behalf = args.behalfId && args.behalfId !== args.actorId ? personOf(people, args.behalfId) : null
  const verb = outcomeVerb(outcome, t.available)
  // The values entered, less the one that repeats the outcome notes (a "comment" field usually is them).
  const notesText = text(args.notes, 4000)
  const fields = t.detail ? highlightedFields(args.row).filter((f) => !notesText || f.value !== notesText) : []
  const links: TimelineLink[] = []
  if (t.href) links.push(fields.length ? { kind: 'form', label: 'View form', href: `/tasks/${args.taskId}?tab=form` } : { kind: 'task', label: 'Open task', href: t.href })
  return ev({
    id: args.id, kind: 'outcome', category: 'decisions', at: args.at, actor, on_behalf_of: behalf, via: args.via,
    icon: outcome ? (outcomeTone(outcome, t.available) === 'danger' ? 'x' : 'check') : 'check',
    tone: outcome ? outcomeTone(outcome, t.available) : 'success',
    title: actor ? `${verb} by ${actor.name}` : verb,
    step: t.step, task_id: args.taskId,
    badge: outcome ? { label: runOutcomeLabel(outcome), tone: outcomeTone(outcome, t.available) } : null,
    body: t.detail ? text(args.notes, 4000) : null,
    note: t.detail && behalf ? text(args.behalfNote, 2000) : null,
    fields: fields.length ? fields : undefined,
    links: links.length ? links : undefined,
  })
}

/* ── Trace → system steps ─────────────────────────────────────────────── */

interface SystemItem { at: string | null; seq: number; event: TimelineEvent; notable: boolean }

interface TraceCtx {
  nodes: Map<string, any>
  vars: Record<string, unknown> | null
  full: boolean
  names: TimelineNames
  nodeResults: Record<string, any>
  subRuns?: Map<number, TimelineSubRun>
  idPrefix: string
  depth: number
  runStatus: string
}

const ELSE_RE = /^(else|otherwise|default|false|no)$/i

function label(node: any, entry: any, c: TraceCtx): string {
  const raw = String(entry?.node_label ?? node?.label ?? entry?.node_type ?? 'Step')
  return resolveTemplateText(raw, c.full ? c.vars : null) || 'Step'
}

/** The trace as system items (no user tasks, triggers or end steps; they have their own events). */
export function traceSystemItems(trace: readonly any[], c: TraceCtx): { items: SystemItem[]; endLabel: string | null; truncated: boolean } {
  const items: SystemItem[] = []
  let endLabel: string | null = null
  let truncated = false
  const list = Array.isArray(trace) ? trace : []
  const nextEdgeFrom = (i: number, nodeId: string) => {
    for (let j = i + 1; j < list.length && j < i + 50; j++) {
      const e = list[j]
      if (e?.type === 'edge' && e.source === nodeId) return e
      if (e?.type === 'node' && e.node_id === nodeId) return null
    }
    return null
  }
  const lastNotable = new Map<string, SystemItem>()
  for (let i = 0; i < list.length; i++) {
    const entry = list[i]
    if (entry?.type === 'truncated') { truncated = true; continue }
    if (entry?.type !== 'node') continue
    const nodeId = String(entry.node_id ?? '')
    const node = c.nodes.get(nodeId)
    const type = String(entry.node_type ?? node?.type ?? '')
    const cfg = node?.config ?? {}
    const at = entry.at ?? null
    const name = label(node, entry, c)
    const id = `${c.idPrefix}sys:${i}`
    const push = (event: Omit<TimelineEvent, 'id' | 'at' | 'category' | 'node_id' | 'actor'> & { actor?: TimelinePerson | null }, notable: boolean) => {
      // The same notable step again in a row (a loop): one line, ×N.
      const prev = notable ? lastNotable.get(nodeId) : undefined
      if (prev && items[items.length - 1] === prev) {
        const n = Number(prev.event.title.match(/ ×(\d+)$/)?.[1] ?? 1) + 1
        prev.event.title = `${prev.event.title.replace(/ ×\d+$/, '')} ×${n}`
        return
      }
      const item: SystemItem = { at, seq: i, notable, event: { id, at, category: 'system', node_id: nodeId || null, actor: null, ...event } }
      items.push(item)
      if (notable) lastNotable.set(nodeId, item)
    }

    if (entry.phase === 'error') {
      const result = c.nodeResults?.[nodeId]
      const later = list.slice(i + 1).some((e) => e?.type === 'node' || (e?.type === 'edge' && e.source === nodeId))
      const continued = later || !['failed', 'cancelled'].includes(c.runStatus)
      // Replace this visit's own step line with the error.
      const last = items[items.length - 1]
      if (last && last.event.node_id === nodeId && last.event.kind !== 'error') items.pop()
      push({ kind: 'error', icon: 'alert', tone: 'danger', title: `Error in “${name}”${continued ? ' (continued)' : ''}`, body: c.full ? text(result?.error, 500) : null }, true)
      continue
    }
    if (entry.phase === 'wait') continue
    if (entry.phase === 'resume') {
      if (WAIT_NODES.has(type)) {
        // "Waited 2 d" — from its enter to this resume.
        for (let j = items.length - 1; j >= 0; j--) {
          const it = items[j]
          if (it.event.node_id === nodeId && it.event.kind === 'system' && it.event.icon === 'hourglass') {
            const gap = (ms(at) ?? 0) - (ms(it.at) ?? 0)
            it.event.title = `Waited ${formatGap(gap) || 'a moment'} — ${name}`
            break
          }
        }
      }
      continue
    }
    if (entry.phase !== 'enter') continue
    if (TRIGGER_NODES.has(type) || HUMAN_NODES.has(type)) continue
    if (type === 'end_workflow') { endLabel = name; continue }

    const result = c.nodeResults?.[nodeId]?.output ?? {}
    if (type === 'send_email') {
      const to = c.full && cfg.to ? resolveTemplateText(cfg.to, c.vars) : null
      const subject = c.full && cfg.subject ? resolveTemplateText(cfg.subject, c.vars) : null
      push({ kind: 'system', icon: 'mail', tone: 'info', title: to ? `Emailed ${to}` : `Email sent: ${name}`, body: subject ? `“${subject}”` : null, step: to ? name : null }, true)
    } else if (NOTIFY_NODES.has(type)) {
      push({ kind: 'system', icon: 'bell', tone: 'info', title: `Notification sent: ${name}` }, true)
    } else if (type === 'update_data_table') {
      const tableId = String(cfg.table_id ?? cfg.tableId ?? result.table_id ?? '')
      const table = c.names.tables?.get(tableId) ?? (cfg.table_name ? resolveTemplateText(cfg.table_name, c.full ? c.vars : null) : 'a data table')
      const op = String(cfg.operation ?? result.operation ?? 'insert')
      if (op === 'get' || op === 'list' || op === 'query' || op === 'find' || op === 'count') push({ kind: 'system', icon: 'database', tone: 'neutral', title: `Looked up ${table}` }, false)
      else push({ kind: 'system', icon: 'database', tone: 'info', title: op === 'update' ? `Updated ${table}` : op === 'delete' ? `Removed a record from ${table}` : `Recorded in ${table}`, step: name }, true)
    } else if (type === 'decision_table') {
      const dt = c.names.decisionTables?.get(String(cfg.decision_table_id ?? '')) ?? cfg.decision_table_name ?? name
      const rule = c.full ? text(result.rule_label ?? result.label, 160) : null
      push({ kind: 'system', icon: 'rules', tone: 'brand', title: `Checked the rules in “${dt}”${rule ? ` → ${rule}` : ''}` }, true)
    } else if (type === 'condition' || type === 'switch_case') {
      const edge = nextEdgeFrom(i, nodeId)
      const branch = text(edge?.label, 80)
      const otherwise = !branch || ELSE_RE.test(branch)
      const shown = otherwise ? (type === 'condition' && /\?\s*$/.test(name) ? 'No' : 'otherwise') : branch
      push({ kind: 'system', icon: 'branch', tone: otherwise ? 'neutral' : 'brand', title: `Decision: ${name} → ${shown}` }, !otherwise)
    } else if (WAIT_NODES.has(type)) {
      push({ kind: 'system', icon: 'hourglass', tone: 'neutral', title: `Waiting — ${name}` }, true)
    } else if (SUB_NODES.has(type)) {
      const subName = text(result.sub_workflow_name, 160) ?? c.names.workflows?.get(String(cfg.workflow_id ?? cfg.sub_workflow_id ?? '')) ?? text(cfg.workflow_name, 160) ?? name
      const sub = c.depth === 0 ? c.subRuns?.get(i) : undefined
      let children: TimelineEvent[] | undefined
      if (sub && c.full) {
        const child = traceSystemItems(sub.execution_trace ?? [], { ...c, nodeResults: sub.node_results ?? {}, idPrefix: `${c.idPrefix}sub${i}:`, depth: 1, subRuns: undefined, nodes: new Map() })
        children = groupSystem(child.items)
      }
      const status = text(sub?.status ?? result.status, 40)
      push({
        kind: 'subworkflow', icon: 'workflow', tone: status === 'failed' ? 'danger' : 'brand', title: `Called sub-workflow “${subName}”`,
        body: status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}${typeof result.node_count === 'number' ? ` · ${result.node_count} steps` : ''}` : null,
        children: children?.length ? children : undefined,
      }, true)
    } else if (type === 'run_agent') {
      push({ kind: 'system', icon: 'bot', tone: 'brand', title: `AI agent: ${name}` }, true)
    } else if (CALL_NODES.has(type)) {
      push({ kind: 'system', icon: 'plug', tone: 'neutral', title: `Called ${name}` }, true)
    } else if (LABEL_NOTABLE.has(type)) {
      push({ kind: 'system', icon: 'cog', tone: 'neutral', title: name }, true)
    } else if (type === 'goto_activity') {
      push({ kind: 'system', icon: 'arrow', tone: 'neutral', title: `Went back: ${name}` }, false)
    } else {
      push({ kind: 'system', icon: 'cog', tone: 'neutral', title: name }, false)
    }
  }
  return { items, endLabel, truncated }
}

/** Notable steps as they are; the noisy ones of a stretch collapsed into "N automatic steps". */
function groupSystem(items: readonly SystemItem[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  const noisy = items.filter((i) => !i.notable)
  let groupAt = -1
  for (const item of items) {
    if (!item.notable && groupAt < 0) { groupAt = out.length; out.push(null as unknown as TimelineEvent) }
    if (item.notable) out.push(item.event)
  }
  if (groupAt >= 0) out[groupAt] = automaticGroup(noisy)
  return out
}

function automaticGroup(noisy: readonly SystemItem[]): TimelineEvent {
  const first = noisy[0]
  const children = noisy.slice(0, MAX_GROUP_CHILDREN).map((n) => n.event)
  if (noisy.length > MAX_GROUP_CHILDREN) children.push(ev({ id: `${first.event.id}:more`, kind: 'system', category: 'system', at: null, title: `…and ${noisy.length - MAX_GROUP_CHILDREN} more` }))
  return ev({
    id: `grp:${first.event.id}`, kind: 'system_group', category: 'system', at: first.at, icon: 'cog', tone: 'neutral',
    title: `${noisy.length} automatic step${noisy.length === 1 ? '' : 's'}`, children,
  })
}

/* ── Assembly ─────────────────────────────────────────────────────────── */

interface Item { at: string | null; seq: number; event: TimelineEvent; system: boolean; notable: boolean }

/** Sort, collapse system stretches, and add "N later" gaps between human events. */
function assemble(items: Item[]): TimelineEvent[] {
  const sorted = [...items].sort((a, b) => {
    const d = (ms(a.at) ?? Number.MAX_SAFE_INTEGER) - (ms(b.at) ?? Number.MAX_SAFE_INTEGER)
    return d !== 0 ? d : a.seq - b.seq
  })
  const out: TimelineEvent[] = []
  let stretch: SystemItem[] = []
  const flush = () => {
    if (stretch.length) out.push(...groupSystem(stretch))
    stretch = []
  }
  for (const it of sorted) {
    if (it.system) { stretch.push({ at: it.at, seq: it.seq, event: it.event, notable: it.notable }); continue }
    flush()
    out.push(it.event)
  }
  flush()
  let lastHuman: number | null = null
  for (const e of out) {
    if (e.category === 'system' || e.kind === 'now' || e.kind === 'ended') continue
    const t = ms(e.at)
    if (t == null) continue
    if (lastHuman != null && t - lastHuman >= 60_000) e.since_previous_ms = t - lastHuman
    lastHuman = t
  }
  return out
}

function runStatusOf(run: TimelineRunRow): string {
  const s = String(run.status ?? '')
  if (s === 'failed' && run.error === 'Manually cancelled') return 'cancelled'
  if (s === 'canceled') return 'cancelled'
  if (s === 'waiting_for_event') return 'waiting'
  if (s === 'processing') return 'running'
  if (s === 'pending') return 'queued'
  return s
}

const STATUS_LABEL: Record<string, string> = {
  running: 'Running', waiting: 'Waiting for people', paused: 'Paused', queued: 'Queued', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', migrated: 'Moved to another version',
  todo: 'Open', draft: 'Draft', in_progress: 'In progress', blocked: 'Blocked',
}

function whoHas(task: RunTask): string {
  const people = task.assignees.filter((a) => a.role !== 'candidate' || task.open)
  const candidates = people.filter((a) => a.role === 'candidate')
  if (task.team && !task.assignees.some((a) => a.role === 'assignee')) return `the ${task.team} team`
  if (candidates.length > 1 && candidates.length === people.length) return `one of ${namesList(candidates.map((c) => c.name))}`
  return namesList(people.map((a) => a.name))
}

function startedEvent(input: RunTimelineInput, starter: TimelinePerson | null, how: string): TimelineEvent {
  const { run, submission } = input
  const reference = text((run.variables as any)?.submission?.reference, 60)
  const iAmSubmitter = Boolean(input.viewer.id && submission?.submitted_by === input.viewer.id)
  const shown = submission && submission.form_id && (iAmSubmitter || input.viewer.tier === 'full')
  return ev({
    id: `start:${run.id}`, kind: 'started', category: 'decisions', at: run.started_at ?? submission?.created_at ?? null,
    actor: starter, icon: submission ? 'form' : 'play', tone: 'brand', title: how,
    body: reference ? `Reference ${reference}` : null,
    submission: shown ? { id: submission!.id, form_id: submission!.form_id!, form_name: submission!.form_name ?? 'Form' } : null,
  })
}

function howStarted(input: RunTimelineInput, starter: TimelinePerson | null): string {
  const { run, submission } = input
  const via = String(run.started_via ?? '')
  const trigger = (Array.isArray(run.execution_trace) ? run.execution_trace : []).find((e) => e?.type === 'node')
  const ttype = String(trigger?.node_type ?? '')
  const by = starter ? ` by ${starter.name}` : ''
  if (submission || via === 'form' || via === 'anonymous' || ttype === 'form_submitted') {
    const form = submission?.form_name ?? (run.variables as any)?.submission?.form?.name ?? 'The form'
    if (via === 'anonymous') return `${form} submitted anonymously`
    return `${form} submitted${by}`
  }
  if (via === 'subworkflow') return 'Started as a sub-workflow'
  if (via === 'schedule' || ttype === 'schedule') return 'Started by schedule'
  if (via === 'webhook' || ttype === 'webhook' || (ttype === 'webhook_received' && via !== 'ui' && via !== 'test')) return 'Started by webhook'
  if (ttype === 'email_received') return 'Started by an email'
  if (ttype === 'data_table_event') return 'Started by a data table change'
  if (ttype === 'task_completed') return 'Started when a task was completed'
  if (via === 'test') return `Test run started${by}`
  if (via === 'api') return `Started through the API${by}`
  if (via === 'ui' || ttype === 'manual') return `Started manually${by}`
  return `Started${by}`
}

/** Pure: a run's timeline for this caller. */
export function buildRunTimeline(input: RunTimelineInput): RunTimeline {
  const { run, viewer } = input
  const full = viewer.tier === 'full'
  const people = input.people
  const teams = input.teams ?? new Map()
  const now = input.now ?? Date.now()
  const nodes = new Map<string, any>((input.nodes ?? []).filter((n) => n && typeof n.id === 'string').map((n) => [n.id, n]))
  const vars = run.variables && typeof run.variables === 'object' ? run.variables : null
  const status = runStatusOf(run)
  const live = LIVE.has(String(run.status)) || LIVE.has(status)
  const processHref = full ? `/automations/runs/${run.id}` : `/home/runs/${run.id}`
  const items: Item[] = []
  let seq = 0
  const add = (event: TimelineEvent, system = false, notable = true) => items.push({ at: event.at, seq: seq++, event, system, notable })

  // Started — the submitter's name only for full detail or the submitter themselves (as Home does).
  const starterId = input.submission?.submitted_by ?? run.started_by ?? null
  const starterVisible = full || (starterId != null && starterId === viewer.id)
  const starter = starterVisible ? personOf(people, starterId) : null
  const how = howStarted(input, starter)
  add(startedEvent(input, starter, how))

  // System steps from the trace (system items keep their own order by seq).
  const trace = Array.isArray(run.execution_trace) ? run.execution_trace : []
  const sys = traceSystemItems(trace, {
    nodes, vars, full, names: input.names ?? {}, nodeResults: (run.node_results ?? {}) as Record<string, any>,
    subRuns: input.subRuns, idPrefix: '', depth: 0, runStatus: status,
  })
  const base = seq
  for (const s of sys.items) items.push({ at: s.at, seq: base + s.seq, event: s.event, system: true, notable: s.notable })
  seq = base + trace.length + 1
  if (sys.truncated) add(ev({ id: `trunc:${run.id}`, kind: 'system', category: 'system', at: null, title: 'Some steps of this long run were not recorded' }), true, false)

  // Tasks.
  const rows = new Map(input.taskRows.map((r) => [r.id, r]))
  const eventsBy = new Map<string, TimelineLifecycleRow[]>()
  for (const e of input.events) eventsBy.set(e.task_id, [...(eventsBy.get(e.task_id) ?? []), e])
  for (const task of input.tasks) {
    const row = rows.get(task.id)
    const detail = task.can_open || Boolean(viewer.viewerTaskIds?.has(task.id))
    const t: TaskCtx = { step: task.step_name, detail, outcomeVisible: detail || full, href: task.href ?? (detail ? `/tasks/${task.id}` : null), available: row?.available_outcomes }
    const evs = [...(eventsBy.get(task.id) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))

    // Created / assigned: to whom it first went (before any reassignment).
    let firstTo = whoHas(task)
    const firstMove = detail ? evs.find((e) => e.event_type === 'reassigned' || e.event_type === 'task_redirected') : undefined
    if (firstMove) {
      const m = firstMove.metadata ?? {}
      const from = firstMove.event_type === 'reassigned'
        ? [...idsOf(m.old_assignee).map((id) => personOf(people, id)!.name), ...(m.old_team ? [`the ${teams.get(String(m.old_team)) ?? 'assigned'} team`] : [])]
        : idsOf(firstMove.actor_id).map((id) => personOf(people, id)!.name)
      if (from.length) firstTo = namesList(from)
    }
    const createdLinks: TimelineLink[] = t.href ? [{ kind: 'task', label: 'Open task', href: t.href }] : []
    add(ev({
      id: `task:${task.id}`, kind: 'task_created', category: 'people', at: row?.created_at ?? task.waiting_since ?? null,
      icon: 'user', tone: task.open ? 'warning' : 'neutral',
      title: task.open && !firstMove ? `Waiting for ${firstTo}` : `Assigned to ${firstTo}`,
      step: task.step_name, task_id: task.id, node_id: task.node_id, due_date: task.due_date,
      body: detail && task.title && task.title !== task.step_name ? task.title : null,
      links: createdLinks.length ? createdLinks : undefined,
    }))

    // History.
    const responses = evs.filter((e) => e.event_type === 'task_response')
    for (const e of evs) {
      if (e.event_type === 'task_response') continue
      const event = lifecycleToEvent(e, people, teams, t)
      if (event) add(event)
    }
    if (responses.length) {
      for (const e of responses) {
        const m = e.metadata ?? {}
        add(responseEvent({ id: `resp:${e.id ?? `${task.id}:${e.created_at}`}`, at: e.created_at, actorId: e.actor_id, behalfId: typeof m.on_behalf_of === 'string' ? m.on_behalf_of : null, outcome: text(m.outcome, 120), notes: m.outcome_notes ?? null, behalfNote: m.on_behalf_note ?? null, via: viaOf(m), taskId: task.id, row, people, t }))
      }
    } else {
      const hist = task.history.filter((h) => h.kind === 'response')
      if (hist.length) {
        for (const [i, h] of hist.entries()) {
          add(responseEvent({ id: `resp:${task.id}:${i}`, at: h.at, actorId: h.actor?.id ?? null, behalfId: h.on_behalf_of?.id ?? null, outcome: h.outcome ?? (full ? row?.outcome ?? null : null), notes: h.comment, behalfNote: null, via: null, taskId: task.id, row, people, t }))
        }
      } else if (task.status === 'completed') {
        add(responseEvent({ id: `done:${task.id}`, at: task.completed_at ?? row?.completed_at ?? null, actorId: row?.actioned_by ?? task.completed_by?.id ?? null, behalfId: row?.actioned_on_behalf_of ?? null, outcome: row?.outcome ?? task.outcome, notes: row?.outcome_notes ?? null, behalfNote: null, via: null, taskId: task.id, row, people, t }))
      }
    }
  }

  // Run actions from the audit log (full detail only): paused / resumed / cancelled by whom.
  if (full) {
    for (const a of input.audits ?? []) {
      const action = String(a.metadata?.action ?? '')
      const actor = personOf(people, a.actor_id)
      if (action === 'pause') add(ev({ id: `audit:${a.id ?? a.created_at}`, kind: 'run_paused', category: 'people', at: a.created_at, actor, icon: 'pause', tone: 'warning', title: `Paused by ${actor?.name ?? 'someone'}` }))
      else if (action === 'resume') add(ev({ id: `audit:${a.id ?? a.created_at}`, kind: 'run_resumed', category: 'people', at: a.created_at, actor, icon: 'play', tone: 'info', title: `Resumed by ${actor?.name ?? 'someone'}` }))
      else if (action === 'cancel') add(ev({ id: `audit:${a.id ?? a.created_at}`, kind: 'run_cancelled', category: 'decisions', at: a.created_at, actor, icon: 'stop', tone: 'neutral', title: `Cancelled by ${actor?.name ?? 'someone'}` }))
    }
  }

  const events = assemble(items)

  // Ended / Now.
  const started = ms(run.started_at)
  const ended = ms(run.completed_at)
  const duration = started != null ? Math.max(0, (ended ?? (live ? now : started)) - started) : null
  let current: string | null = null
  if (!live) {
    const cancelledBy = (input.audits ?? []).find((a) => a.metadata?.action === 'cancel')
    const by = full && cancelledBy ? personOf(people, cancelledBy.actor_id) : null
    const title = status === 'completed' ? `Completed${sys.endLabel ? ` — ${sys.endLabel}` : ''}`
      : status === 'cancelled' ? `Cancelled${by ? ` by ${by.name}` : ''}`
        : status === 'failed' ? (full && run.error ? `Failed: ${text(run.error, 300)}` : 'Failed')
          : status === 'migrated' ? 'Moved to another version' : STATUS_LABEL[status] ?? status
    current = title
    const links: TimelineLink[] = run.migrated_to_run_id ? [{ kind: 'run', label: 'Continue on the new version', href: full ? `/automations/runs/${run.migrated_to_run_id}` : `/home/runs/${run.migrated_to_run_id}` }] : []
    events.push(ev({
      id: `end:${run.id}`, kind: 'ended', category: 'decisions', at: run.completed_at ?? null, actor: by,
      icon: status === 'completed' ? 'flag' : status === 'failed' ? 'alert' : 'stop',
      tone: status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'neutral',
      title, body: duration != null ? `Took ${formatGap(duration) || 'under a second'} in total` : null,
      links: links.length ? links : undefined,
    }))
  } else {
    const open = input.tasks.filter((t) => t.open).slice(0, 5)
    // Waiting since it reached the person who has it now (its last reassignment / redirect / escalation), else since it was created.
    const sinceOf = (task: RunTask) => {
      const moves = (eventsBy.get(task.id) ?? []).filter((e) => ['reassigned', 'task_redirected', 'task_escalated'].includes(e.event_type)).map((e) => e.created_at)
      return [task.waiting_since, ...moves].filter((x): x is string => Boolean(x)).sort().pop() ?? null
    }
    const nows: TimelineEvent[] = open.map((task) => ev({
      id: `now:${task.id}`, kind: 'now', category: 'people', at: sinceOf(task), icon: 'hourglass', tone: 'warning', highlight: true,
      title: `Waiting for ${whoHas(task)}`, step: task.step_name, task_id: task.id, due_date: task.due_date,
      body: sinceOf(task) ? `For ${formatGap(now - (ms(sinceOf(task)) ?? now)) || 'a moment'} so far` : null,
      links: task.href ? [{ kind: 'task', label: 'Open task', href: task.href }] : undefined,
    }))
    if (!nows.length) {
      const pausedNode = run.paused_node_id ? nodes.get(run.paused_node_id) : null
      const title = status === 'paused' ? 'Paused'
        : pausedNode ? `Waiting at “${resolveTemplateText(pausedNode.label ?? pausedNode.type, full ? vars : null)}”`
          : status === 'queued' ? 'Queued to start' : 'Running…'
      nows.push(ev({ id: `now:${run.id}`, kind: 'now', category: 'system', at: run.paused_at ?? null, icon: status === 'paused' ? 'pause' : 'hourglass', tone: 'warning', highlight: true, title }))
    }
    current = nows.map((n) => `${n.title}${n.step ? ` — ${n.step}` : ''}`).join('; ')
    events.push(...nows)
  }

  const header: TimelineHeader = {
    workflow: { id: input.workflow.id, name: input.workflow.name },
    title: text(run.title, 300),
    reference: text((run.variables as any)?.submission?.reference, 60),
    status,
    status_label: STATUS_LABEL[status] ?? status,
    started_at: run.started_at ?? null,
    ended_at: run.completed_at ?? null,
    duration_ms: duration,
    started_by: starter,
    started_how: how,
    current,
    version: input.workflow.version ?? null,
    sla_due_at: run.sla_due_at ?? null,
  }
  const focus = input.focusTaskId ?? null
  return {
    kind: 'run', run_id: run.id, task_id: null, focus_task_id: focus, detail: viewer.tier, header, events, live,
    links: { process: processHref, timeline: `/timeline/${run.id}`, task: focus ? `/tasks/${focus}` : null },
  }
}

/** Pure: one task's own history (a standalone task, or a workflow task whose run the caller can't see). */
export function buildTaskTimeline(input: TaskTimelineInput): RunTimeline {
  const { task, people } = input
  const teams = input.teams ?? new Map()
  const now = input.now ?? Date.now()
  const t: TaskCtx = { step: null, detail: true, outcomeVisible: true, href: `/tasks/${task.id}`, available: task.available_outcomes }
  const items: Item[] = []
  let seq = 0
  const add = (event: TimelineEvent) => items.push({ at: event.at, seq: seq++, event, system: false, notable: true })
  const creator = personOf(people, task.assigner_id)
  const assignee = personOf(people, task.assignee_id)
  const team = task.assigned_team_id ? teams.get(task.assigned_team_id) ?? 'a team' : null
  const to = assignee && assignee.id !== creator?.id ? assignee.name : !assignee && team ? `the ${team} team` : null
  const evs = [...input.events].sort((a, b) => a.created_at.localeCompare(b.created_at))
  add(ev({
    id: `start:${task.id}`, kind: 'started', category: 'decisions', at: task.created_at ?? null, actor: creator, icon: 'play', tone: 'brand',
    title: input.workflow ? `Created by the workflow “${input.workflow.name}”` : creator ? `Created by ${creator.name}${to ? ` and assigned to ${to}` : ''}` : `Task created${to ? ` for ${to}` : ''}`,
    step: input.stepName ?? null, due_date: task.due_date ?? null,
  }))
  if (input.workflow && (assignee || team)) {
    add(ev({ id: `task:${task.id}`, kind: 'task_created', category: 'people', at: task.created_at ?? null, icon: 'user', tone: 'neutral', title: `Assigned to ${assignee?.name ?? `the ${team} team`}`, step: input.stepName ?? null, task_id: task.id, due_date: task.due_date ?? null }))
  }
  const responses = evs.filter((e) => e.event_type === 'task_response')
  for (const e of evs) {
    if (e.event_type === 'task_response' || e.event_type === 'created') continue
    const event = lifecycleToEvent(e, people, teams, t)
    if (event) add(event)
  }
  for (const e of responses) {
    const m = e.metadata ?? {}
    add(responseEvent({ id: `resp:${e.id ?? e.created_at}`, at: e.created_at, actorId: e.actor_id, behalfId: typeof m.on_behalf_of === 'string' ? m.on_behalf_of : null, outcome: text(m.outcome, 120), notes: m.outcome_notes ?? null, behalfNote: m.on_behalf_note ?? null, via: viaOf(m), taskId: task.id, row: task, people, t }))
  }
  const done = task.status === 'completed'
  if (done && !responses.length) {
    add(responseEvent({ id: `done:${task.id}`, at: task.completed_at ?? task.actioned_at ?? null, actorId: task.actioned_by ?? task.assignee_id ?? null, behalfId: task.actioned_on_behalf_of ?? null, outcome: task.outcome ?? null, notes: task.outcome_notes ?? null, behalfNote: null, via: null, taskId: task.id, row: task, people, t }))
  }
  const events = assemble(items)
  const started = ms(task.created_at)
  const endedAt = done ? (task.completed_at ?? task.actioned_at ?? null) : null
  const duration = started != null ? Math.max(0, (ms(endedAt) ?? now) - started) : null
  let current: string
  if (done || task.status === 'cancelled') {
    current = done ? `Completed${task.outcome ? ` — ${runOutcomeLabel(task.outcome)}` : ''}` : 'Cancelled'
    events.push(ev({ id: `end:${task.id}`, kind: 'ended', category: 'decisions', at: endedAt, icon: done ? 'flag' : 'stop', tone: done ? 'success' : 'neutral', title: current, body: done && duration != null ? `Took ${formatGap(duration) || 'under a second'} in total` : null }))
  } else {
    const with_ = assignee?.name ?? (team ? `the ${team} team` : null)
    current = with_ ? `With ${with_}` : 'Open'
    events.push(ev({ id: `now:${task.id}`, kind: 'now', category: 'people', at: task.created_at ?? null, icon: 'hourglass', tone: 'warning', highlight: true, title: current, due_date: task.due_date ?? null, body: started != null ? `Open for ${formatGap(now - started) || 'a moment'}` : null }))
  }
  return {
    kind: 'task', run_id: task.workflow_run_id ?? null, task_id: task.id, focus_task_id: task.id, detail: 'task',
    header: {
      workflow: input.workflow ?? null, title: text(task.title, 300), reference: null, status: task.status, status_label: STATUS_LABEL[task.status] ?? task.status,
      started_at: task.created_at ?? null, ended_at: endedAt, duration_ms: duration, started_by: creator, started_how: null, current, version: null, sla_due_at: task.due_date ?? null,
    },
    events, live: !done && task.status !== 'cancelled',
    links: { process: null, timeline: `/tasks/${task.id}?timeline=1`, task: `/tasks/${task.id}` },
  }
}

/* ── Loading ──────────────────────────────────────────────────────────── */

const RUN_COLUMNS = 'id, tenant_id, workflow_id, version_id, status, title, error, started_at, completed_at, paused_at, paused_node_id, started_by, started_via, form_submission_id, variables, execution_trace, node_results, sla_due_at, migrated_to_run_id'
const TASK_COLUMNS = 'id, title, status, created_at, completed_at, actioned_at, due_date, outcome, outcome_notes, actioned_by, actioned_on_behalf_of, assignee_id, assigned_team_id, assigner_id, workflow_step_id, workflow_id, workflow_run_id, metadata, available_outcomes, parent_task_id, deleted_at'

/** Which view of the run the caller gets: full (run scope), progress (can_view_run_progress), or null (not found). */
export async function runTimelineAccess(ctx: ServiceContext, db: AnySupabaseClient, run: { id: string; workflow_id: string | null }): Promise<'full' | 'progress' | null> {
  const allow = ctx.resourceScopes?.workflow_ids ?? []
  if (allow.length && (!run.workflow_id || !allow.includes(run.workflow_id))) return null
  if (hasPerm(ctx, 'workflows.view_runs') || hasPerm(ctx, 'workflows.view_queue')) {
    if (runInScope(await resolveRunScope(ctx), run)) return 'full'
  }
  if (!ctx.actorId) return null
  const { data, error } = await (db as any).rpc('can_view_run_progress', { p_run_id: run.id, p_user_id: ctx.actorId })
  if (error) throw dbError(error)
  return data === true ? 'progress' : null
}

async function loadPeople(db: any, ids: Iterable<string>): Promise<Map<string, TimelinePerson>> {
  const list = [...new Set([...ids].filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))]
  const people = new Map<string, TimelinePerson>()
  if (!list.length) return people
  const { data } = await db.from('users').select('id, display_name, email, avatar_url').in('id', list.slice(0, 500))
  for (const u of (data ?? []) as any[]) people.set(String(u.id), { id: String(u.id), name: String(u.display_name || (u.email ? String(u.email).split('@')[0] : '') || 'Someone'), avatar_url: u.avatar_url ?? null })
  return people
}

function lifecyclePeopleIds(events: TimelineLifecycleRow[]): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.actor_id) out.push(e.actor_id)
    const m = e.metadata ?? {}
    for (const k of ['to_user_ids', 'old_assignee', 'new_assignee', 'escalated_to_user', 'on_behalf_of']) out.push(...idsOf(m[k]))
  }
  return out
}

function lifecycleTeamIds(events: TimelineLifecycleRow[]): string[] {
  return events.flatMap((e) => ['old_team', 'new_team', 'escalated_to_team'].map((k) => e.metadata?.[k]).filter((v): v is string => typeof v === 'string'))
}

async function loadTeams(db: any, tenantId: string, ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set([...ids].filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 64))]
  if (!list.length) return new Map()
  const { data } = await db.from('teams').select('id, name').eq('tenant_id', tenantId).in('id', list)
  return new Map(((data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')]))
}

async function loadRunTimeline(ctx: ServiceContext, db: any, run: any, tier: 'full' | 'progress', focusTaskId: string | null): Promise<RunTimeline> {
  const tenantId = ctx.tenantId
  const [{ data: workflow }, versionResult, submissionResult, taskRowsResult] = await Promise.all([
    db.from('workflows').select('id, name, nodes').eq('id', run.workflow_id).eq('tenant_id', tenantId).maybeSingle(),
    run.version_id ? db.from('workflow_versions').select('version_number, nodes').eq('id', run.version_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null }),
    run.form_submission_id ? db.from('form_submissions').select('id, form_id, form_name, created_at, submitted_by').eq('id', run.form_submission_id).eq('tenant_id', tenantId).maybeSingle() : Promise.resolve({ data: null }),
    db.from('tasks').select(TASK_COLUMNS).eq('tenant_id', tenantId).eq('workflow_run_id', run.id).is('deleted_at', null).order('created_at', { ascending: true }).limit(200),
  ])
  if (taskRowsResult.error) throw dbError(taskRowsResult.error)
  const nodes: any[] = Array.isArray(versionResult.data?.nodes) && versionResult.data.nodes.length ? versionResult.data.nodes : Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const taskRows = (taskRowsResult.data ?? []) as TimelineTaskRow[]
  const taskIds = taskRows.map((t) => t.id)

  const { loadRunTasks, labelsOf } = await import('./run-tasks')
  const [tasks, eventsResult, auditsResult] = await Promise.all([
    loadRunTasks(ctx, { id: run.id, workflow_id: run.workflow_id ?? null }, { labels: labelsOf(nodes), db }),
    taskIds.length ? db.from('lifecycle_events').select('id, task_id, event_type, actor_id, metadata, created_at').eq('tenant_id', tenantId).in('task_id', taskIds).order('created_at', { ascending: true }).limit(TIMELINE_EVENT_LIMIT) : Promise.resolve({ data: [] }),
    tier === 'full' ? db.from('object_audit_log').select('id, actor_id, summary, metadata, created_at').eq('tenant_id', tenantId).eq('object_type', 'workflow_run').eq('object_id', run.id).order('created_at', { ascending: true }).limit(50) : Promise.resolve({ data: [] }),
  ])
  if (eventsResult.error) throw dbError(eventsResult.error)
  const events = (eventsResult.data ?? []) as TimelineLifecycleRow[]
  const audits = (auditsResult.data ?? []) as TimelineAuditRow[]

  // Invited viewers: the tasks of the run the caller can't open but is invited to view.
  const viewerTaskIds = new Set<string>()
  const closedToMe = tasks.filter((t) => !t.can_open).map((t) => t.id)
  if (ctx.actorId && closedToMe.length) {
    const { data: shared } = await db.from('task_viewers').select('task_id').eq('tenant_id', tenantId).in('task_id', closedToMe).limit(200)
    const candidates = [...new Set(((shared ?? []) as any[]).map((r) => String(r.task_id)))].slice(0, 20)
    const grants = await Promise.all(candidates.map(async (id) => ((await findTaskViewerGrant(db, tenantId, ctx.actorId, id)) ? id : null)))
    for (const id of grants) if (id) viewerTaskIds.add(id)
  }

  // Names: people, teams, tables, decision tables, workflows.
  const submission = submissionResult.data ?? null
  const personIds = [run.started_by, submission?.submitted_by, ...taskRows.flatMap((t) => [t.actioned_by, t.actioned_on_behalf_of, t.assignee_id, t.assigner_id]), ...lifecyclePeopleIds(events), ...audits.map((a) => a.actor_id)].filter(Boolean) as string[]
  const configIds = (key: string) => [...new Set(nodes.map((n) => n?.config?.[key]).filter((v) => typeof v === 'string' && UUID_RE.test(v)))]
  const tableIds = [...configIds('table_id'), ...configIds('tableId')]
  const [people, teams, tables, dts, wfs] = await Promise.all([
    loadPeople(db, personIds),
    loadTeams(db, tenantId, lifecycleTeamIds(events)),
    tableIds.length ? db.from('custom_tables').select('id, name').eq('tenant_id', tenantId).in('id', tableIds) : Promise.resolve({ data: [] }),
    configIds('decision_table_id').length ? db.from('decision_tables').select('id, name').eq('tenant_id', tenantId).in('id', configIds('decision_table_id')) : Promise.resolve({ data: [] }),
    configIds('workflow_id').length ? db.from('workflows').select('id, name').eq('tenant_id', tenantId).in('id', configIds('workflow_id')) : Promise.resolve({ data: [] }),
  ])
  const names: TimelineNames = {
    tables: new Map(((tables.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
    decisionTables: new Map(((dts.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
    workflows: new Map(((wfs.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
  }

  // Sub-workflow runs (full detail): each call matched to the child run that started at it.
  const subRuns = new Map<number, TimelineSubRun>()
  if (tier === 'full') {
    const trace: any[] = Array.isArray(run.execution_trace) ? run.execution_trace : []
    const calls = trace.map((e, i) => ({ e, i })).filter(({ e }) => e?.type === 'node' && e.phase === 'enter' && SUB_NODES.has(String(e.node_type)))
    const subIds = [...new Set(calls.map(({ e }) => String(run.node_results?.[e.node_id]?.output?.sub_workflow_id ?? nodes.find((n) => n?.id === e.node_id)?.config?.workflow_id ?? '')).filter((id) => UUID_RE.test(id)))]
    if (calls.length && subIds.length && run.started_at) {
      const { data: children } = await db.from('workflow_runs').select('id, workflow_id, status, started_at, completed_at, execution_trace, node_results, workflow:workflows(name)')
        .eq('tenant_id', tenantId).in('workflow_id', subIds).eq('started_via', 'subworkflow').gte('started_at', new Date(new Date(run.started_at).getTime() - 2000).toISOString())
        .lte('started_at', run.completed_at ?? new Date().toISOString()).order('started_at', { ascending: true }).limit(20)
      const pool = [...((children ?? []) as any[])]
      for (const { e, i } of calls) {
        const wid = String(run.node_results?.[e.node_id]?.output?.sub_workflow_id ?? nodes.find((n) => n?.id === e.node_id)?.config?.workflow_id ?? '')
        const at = ms(e.at) ?? 0
        const idx = pool.findIndex((c) => c.workflow_id === wid && (ms(c.started_at) ?? 0) >= at - 2000)
        if (idx < 0) continue
        const c = pool.splice(idx, 1)[0]
        subRuns.set(i, { id: c.id, status: c.status, name: c.workflow?.name ?? 'Sub-workflow', started_at: c.started_at, completed_at: c.completed_at, execution_trace: c.execution_trace, node_results: c.node_results })
      }
    }
  }

  return buildRunTimeline({
    run, workflow: { id: workflow?.id ?? run.workflow_id ?? null, name: String(workflow?.name ?? 'Workflow'), version: versionResult.data?.version_number ?? null },
    nodes, submission, tasks, taskRows, events, audits, people, teams, names, subRuns,
    viewer: { id: ctx.actorId, tier, viewerTaskIds }, focusTaskId,
  })
}

/** A run's timeline (404 unless the caller may see the run). */
export async function getRunTimeline(ctx: ServiceContext, runId: string, options: { focusTaskId?: string | null } = {}): Promise<RunTimeline> {
  if (!UUID_RE.test(String(runId))) throw ServiceError.notFound('Run not found')
  const db = await serviceRoleClient(ctx) as any
  const { data: run, error } = await db.from('workflow_runs').select(RUN_COLUMNS).eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!run) throw ServiceError.notFound('Run not found')
  const tier = await runTimelineAccess(ctx, db, run)
  if (!tier) throw ServiceError.notFound('Run not found')
  return loadRunTimeline(ctx, db, run, tier, options.focusTaskId ?? null)
}

/**
 * A task's timeline: its run's timeline when the caller may see the run,
 * else the task's own history when they may view the task; else 404.
 */
export async function getTaskTimeline(ctx: ServiceContext, taskId: string): Promise<RunTimeline> {
  if (!UUID_RE.test(String(taskId))) throw ServiceError.notFound('Task not found')
  const db = await serviceRoleClient(ctx) as any
  const { data: task, error } = await db.from('tasks').select(TASK_COLUMNS).eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  if (task.workflow_run_id) {
    const { data: run } = await db.from('workflow_runs').select(RUN_COLUMNS).eq('id', task.workflow_run_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (run) {
      const tier = await runTimelineAccess(ctx, db, run)
      if (tier) return loadRunTimeline(ctx, db, run, tier, task.id)
    }
  }
  const visible = await canViewTask(db, { tenantId: ctx.tenantId, taskId: task.id, actorId: ctx.actorId, permissions: ctx.permissions })
  if (!visible) throw ServiceError.notFound('Task not found')
  const { data: eventRows, error: eventsError } = await db.from('lifecycle_events').select('id, task_id, event_type, actor_id, metadata, created_at')
    .eq('tenant_id', ctx.tenantId).eq('task_id', task.id).order('created_at', { ascending: true }).limit(TIMELINE_EVENT_LIMIT)
  if (eventsError) throw dbError(eventsError)
  const events = (eventRows ?? []) as TimelineLifecycleRow[]
  let workflow: { id: string | null; name: string } | null = null
  let stepName: string | null = null
  if (task.workflow_id) {
    const { data: wf } = await db.from('workflows').select('id, name, nodes').eq('id', task.workflow_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (wf) {
      workflow = { id: wf.id, name: String(wf.name) }
      stepName = (Array.isArray(wf.nodes) ? wf.nodes : []).find((n: any) => n?.id === task.workflow_step_id)?.label ?? null
    }
  }
  const [people, teams] = await Promise.all([
    loadPeople(db, [task.assigner_id, task.assignee_id, task.actioned_by, task.actioned_on_behalf_of, ...lifecyclePeopleIds(events)].filter(Boolean)),
    loadTeams(db, ctx.tenantId, [task.assigned_team_id, ...lifecycleTeamIds(events)].filter(Boolean)),
  ])
  return buildTaskTimeline({ task, events, people, teams, workflow, stepName })
}

/** `{ runId }` or `{ taskId }`. */
export async function getTimeline(ctx: ServiceContext, target: TimelineTarget): Promise<RunTimeline> {
  if (target.runId) return getRunTimeline(ctx, target.runId)
  if (target.taskId) return getTaskTimeline(ctx, target.taskId)
  throw ServiceError.validation('Give runId or taskId')
}
