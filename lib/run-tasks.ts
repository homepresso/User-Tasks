/**
 * The User Tasks of one workflow run as the Process view shows them (both
 * surfaces: /automations/runs/[id] and /home/runs/[id]; also REST
 * GET /workflows/runs/{id} and /home/runs/{id}/progress, MCP
 * workflows_run_get): who each task is with, their status, who completed
 * it, its history (responses, redirects, reassignments, escalations), and —
 * per CALLER — whether they may open the task and act on it.
 *
 * Shaped server-side by lib/services/run-tasks.ts. Pure and isomorphic
 * (types and display helpers only).
 *
 * Visibility (decided per task on the server):
 *  - Everyone who can see the run sees the step, who it is with (names, as
 *    Home's "people involved" already shows) and who completed it, when.
 *  - Task details — the task title, outcomes, comments / reasons and the
 *    redirect / reassignment / escalation lines — only reach callers who may
 *    open the task (`can_open`): its assignee / collaborator / claim
 *    candidate / team member, a manager of an assignee (reporting lines,
 *    direct or indirect), a manager of the workflow (explicit Edit grant),
 *    its assigner, or task oversight (tasks.view_all).
 *  - `can_act`: 'assignee' (their own task), 'on_behalf' (manager, workflow
 *    manager, or break-glass tasks.complete_any — with a reason on the task
 *    page), else 'none'. The run's initiator alone gets neither: they see
 *    "Waiting for {name}".
 */

export type RunTaskPersonStatus = 'queued' | 'in_progress' | 'on_hold' | 'done' | 'declined' | 'closed'
export type RunTaskAccess = 'assignee' | 'manager' | 'workflow_manager' | 'assigner' | 'admin'

export interface RunTaskPersonRef { id: string; name: string; avatar_url: string | null }

export interface RunTaskPerson extends RunTaskPersonRef {
  role: 'assignee' | 'collaborator' | 'candidate'
  status: RunTaskPersonStatus
}

export interface RunTaskHistoryEntry {
  kind: 'response' | 'completed' | 'declined' | 'redirected' | 'reassigned' | 'escalated'
  at: string | null
  actor: RunTaskPersonRef | null
  /** A manager / workflow manager / break-glass holder acted for this person. */
  on_behalf_of: RunTaskPersonRef | null
  /** Details (null unless the caller may open the task). */
  outcome: string | null
  comment: string | null
  /** Redirect / reassign / escalate: from whom, to whom (names). */
  from: string[]
  to: string[]
}

export interface RunTask {
  id: string
  node_id: string | null
  step_name: string
  /** The task title; null unless can_open. */
  title: string | null
  status: 'waiting' | 'completed' | 'cancelled'
  open: boolean
  has_form: boolean
  /** Team / AAD group of an unclaimed team or claim task. */
  team: string | null
  assignees: RunTaskPerson[]
  waiting_since: string | null
  due_date: string | null
  completed_at: string | null
  completed_by: RunTaskPersonRef | null
  completed_on_behalf_of: RunTaskPersonRef | null
  /** Winning outcome; null unless can_open. */
  outcome: string | null
  can_open: boolean
  can_act: 'assignee' | 'on_behalf' | 'none'
  /** Why the caller may open it (null = they can't). */
  access: RunTaskAccess | null
  /** For can_act 'on_behalf': whom the caller would act for. */
  on_behalf_of: RunTaskPersonRef | null
  /** The task page (form tab when it has a form); null unless can_open. */
  href: string | null
  history: RunTaskHistoryEntry[]
}

export const RUN_TASK_PERSON_STATUS_LABEL: Record<RunTaskPersonStatus, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  on_hold: 'On hold',
  done: 'Done',
  declined: 'Declined',
  closed: 'Closed',
}

/** "need_more_information" → "Need more information". */
export function runOutcomeLabel(outcome: string): string {
  const s = outcome.replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export type RunOutcomeTone = 'success' | 'danger' | 'warning' | 'brand'

/** Same colours as the task header's outcome badge. */
export function runOutcomeTone(outcome: string): RunOutcomeTone {
  const o = outcome.toLowerCase()
  if (o === 'approved' || o === 'completed' || o === 'approve' || o === 'accepted') return 'success'
  if (o === 'rejected' || o === 'declined' || o === 'reject' || o === 'decline') return 'danger'
  if (o === 'deferred' || o === 'ask_for_changes' || o === 'changes_requested' || o === 'returned' || o === 'need_more_information') return 'warning'
  return 'brand'
}

/** "Priya Nair", "Priya Nair +2", the team, or "Unassigned". */
export function runTaskWho(task: Pick<RunTask, 'assignees' | 'team'>): string {
  if (task.assignees.length === 1) return task.assignees[0].name
  if (task.assignees.length > 1) return `${task.assignees[0].name} +${task.assignees.length - 1}`
  if (task.team) return task.team
  return 'Unassigned'
}

/** Every name, for tooltips: "Priya Nair, Tom Lee and Ana Ruiz". */
export function runTaskAllNames(task: Pick<RunTask, 'assignees' | 'team'>): string {
  const names = task.assignees.map((a) => a.name)
  if (!names.length) return task.team ?? 'Unassigned'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The open tasks of a run (what it is waiting on). */
export function waitingTasks(tasks: readonly RunTask[] | null | undefined): RunTask[] {
  return (tasks ?? []).filter((t) => t.open)
}
