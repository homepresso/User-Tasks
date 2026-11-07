import { normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { submittingButtonKeys } from '@/lib/forms/form-state'

/**
 * Quick actions on the task lists (Home My tasks, /tasks): which actions a
 * person may take on a task without opening it. Pure — the facts come from
 * the `tasks.quickActions` read — and mirrors the server's own rules, so
 * the panel never offers an action the server would refuse:
 *
 *  - complete / outcomes: tasks.complete; workflow tasks need the assignee
 *    act mode (managers acting on behalf use the task page, which asks for
 *    their reason); never while the task still waits for my acceptance.
 *    Tasks whose form must be filled (required fields empty, a button bar,
 *    an external form) complete on the task page: "Open form to complete".
 *  - hold / resume (respondToTask): the assignee (or a collaborator) while
 *    queued / held; hold needs a reason (the server requires one).
 *  - redirect (rerouteTask): the assignee, allow_reassign true; single or
 *    many people, recipient cap, email + invite per metadata.task_actions.
 *  - escalate (rerouteTask): the assignee, allow_escalate not false.
 *  - invite someone (inviteToTask): the assignee, allow_reassign true and
 *    the task's redirect mode "many" (the task allows several people);
 *    the recipient cap counts everyone on the task.
 */

export type QuickActMode = 'assignee' | 'on_behalf' | 'break_glass' | 'none'

export interface QuickActionsTaskRow {
  id: string
  title?: string | null
  status?: string | null
  assignee_id?: string | null
  assignment_mode?: string | null
  acceptance_status?: string | null
  allow_reassign?: boolean | null
  allow_escalate?: boolean | null
  available_outcomes?: unknown
  is_workflow_task?: boolean | null
  event_id?: string | null
  workflow_run_id?: string | null
  metadata?: unknown
}

export interface QuickActionsFacts {
  actorId: string | null
  /** tasks.complete (every action here needs it). */
  canComplete: boolean
  /** workflows.view_runs: Process view opens the full run, else the progress view. */
  canViewRuns: boolean
  /** describeTaskAccess mode (lib/task-authz.ts); null when unknown. */
  mode: QuickActMode | null
  /** The actor's task_assignees row (collaborative tasks), if any. */
  collaborator: { acceptance_status: string | null } | null
  /** People on the task now (assignee + collaborators), for the invite cap. */
  participantCount: number
  /** The actor's manager in the task's workspace (default escalation target). */
  manager?: { id: string; name: string } | null
}

export type CompleteVia = 'quick' | 'form' | 'task' | 'none'

export interface TaskQuickActionsInfo {
  taskId: string
  title: string
  closed: boolean
  workflow: boolean
  /** The task page, its form tab and the run's Process view. */
  taskHref: string
  formHref: string
  processHref: string | null
  /** quick: outcome buttons here; form: the form must be filled ("Open form to complete"); task: only on the task page (acting on behalf); none: can't complete. */
  completeVia: CompleteVia
  /** Why completeVia is 'form' / 'none' (shown under the link). */
  completeNote: string | null
  outcomes: string[]
  canHold: boolean
  canResume: boolean
  redirect: null | { mode: 'single' | 'many'; limit: number | null; allowEmail: boolean }
  canEscalate: boolean
  escalateTo: { id: string; name: string } | null
  invite: null | { remaining: number | null; allowEmail: boolean }
}

const CLOSED = new Set(['completed', 'cancelled'])

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** The task's redirect settings (metadata.task_actions), as rerouteTask reads them. */
export function redirectSettings(metadata: unknown) {
  const actions = record(record(metadata).task_actions)
  const mode: 'single' | 'many' = actions.redirect_assignment_mode === 'many' ? 'many' : 'single'
  const capped = actions.redirect_recipient_limit_mode === 'capped'
  const limit = capped ? Math.max(1, Number(actions.redirect_recipient_limit ?? 1) || 1) : null
  return { mode, limit, allowEmail: actions.allow_invite_on_redirect === true }
}

/** Must the task's form be filled before it can complete? Returns the reason, or null. */
export function formRequirement(metadata: unknown): string | null {
  const meta = record(metadata)
  if (typeof meta.form_url === 'string' && meta.form_url) return 'This task is completed in an external form.'
  const fields = normalizeTaskFields(meta.fields)
  // A button bar (configured, or implied by an in-form Submit): its actions and rules run from the form.
  if (Array.isArray(meta.form_buttons) || submittingButtonKeys(fields).length > 0) return 'This task is completed with its form’s buttons.'
  if (!fields.length) return null
  const layout = normalizeFormLayout(meta.form_layout, fields.map((f) => f.key))
  const errors = validateTaskFieldValues(fields, record(meta.template_values), { layout })
  const missing = fields.filter((f) => errors[f.key]).map((f) => f.label)
  if (!missing.length) return null
  return `Fill in ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''} first.`
}

export function taskQuickActions(task: QuickActionsTaskRow, facts: QuickActionsFacts): TaskQuickActionsInfo {
  const workflow = Boolean(task.is_workflow_task && task.event_id)
  const closed = CLOSED.has(String(task.status ?? ''))
  const runId = task.workflow_run_id ?? null
  const collaborative = task.assignment_mode === 'collaborative'
  // rerouteTask / respondToTask: the assignee, or a collaborator on a collaborative task.
  const isMember = Boolean(facts.actorId) && (collaborative ? Boolean(facts.collaborator) : task.assignee_id === facts.actorId)
  const myAcceptance = collaborative ? (facts.collaborator?.acceptance_status ?? null) : (task.acceptance_status ?? null)
  const awaitingMe = isMember && myAcceptance === 'pending'
  const settings = redirectSettings(task.metadata)
  const outcomesRaw = Array.isArray(task.available_outcomes) ? (task.available_outcomes as unknown[]).map(String).filter(Boolean) : []
  const outcomes = outcomesRaw.length ? outcomesRaw : ['completed']

  const info: TaskQuickActionsInfo = {
    taskId: task.id,
    title: String(task.title ?? ''),
    closed,
    workflow,
    taskHref: `/tasks/${task.id}`,
    formHref: `/tasks/${task.id}?tab=form`,
    processHref: runId ? (facts.canViewRuns ? `/automations/runs/${runId}` : `/home/runs/${runId}`) : null,
    completeVia: 'none',
    completeNote: null,
    outcomes: [],
    canHold: false,
    canResume: false,
    redirect: null,
    canEscalate: false,
    escalateTo: null,
    invite: null,
  }
  if (closed || !facts.canComplete) return info

  // Complete / outcomes.
  if (awaitingMe) {
    info.completeNote = 'Accept the task to complete it.'
  } else if (workflow && facts.mode !== 'assignee') {
    if (facts.mode === 'on_behalf' || facts.mode === 'break_glass') {
      info.completeVia = 'task'
      info.completeNote = 'Acting on behalf of the assignee needs a reason — open the task.'
    }
  } else {
    const needsForm = formRequirement(task.metadata)
    if (needsForm) {
      info.completeVia = 'form'
      info.completeNote = needsForm
    } else {
      info.completeVia = 'quick'
      info.outcomes = outcomes
    }
  }

  if (isMember) {
    info.canHold = myAcceptance === 'pending'
    info.canResume = myAcceptance === 'held'
    if (task.allow_reassign === true) {
      info.redirect = settings
      if (settings.mode === 'many') {
        info.invite = { remaining: settings.limit === null ? null : Math.max(0, settings.limit - facts.participantCount), allowEmail: settings.allowEmail }
        if (info.invite.remaining === 0) info.invite = null
      }
    }
    if (task.allow_escalate !== false) {
      info.canEscalate = true
      info.escalateTo = facts.manager && facts.manager.id !== facts.actorId ? facts.manager : null
    }
  }
  return info
}

/** Does the panel have anything to do (beyond Open task)? */
export function hasQuickActions(info: TaskQuickActionsInfo): boolean {
  return info.completeVia !== 'none' || info.canHold || info.canResume || !!info.redirect || info.canEscalate || !!info.invite
}
