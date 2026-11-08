/**
 * The User Tasks of one run for the Process view, with per-caller access
 * flags (lib/run-tasks.ts describes the shape and the visibility rules).
 *
 * The CALLER must already be allowed to see the run (run-visibility for the
 * full run view / REST / MCP, can_view_run_progress for Home): this module
 * only decides, per task, what of it they see and whether they may open /
 * act on it. Everything is loaded in a fixed number of tenant-filtered
 * queries (tasks, collaborators, responses, history events, names, teams,
 * the caller's teams, reporting lines, workflow grant) — no per-task reads.
 *
 * The flags mirror the server rules the task page and actions enforce:
 * canReachTask (open) and decideTaskAction (act) in lib/task-authz.ts.
 */

import { decideTaskAction, decideTaskAssignment, isUnassignedTask, type AuthzTask, type TaskActorFacts } from '@/lib/task-authz'
import { isInManagerChain, loadReportingIndex, type ReportingIndex } from '@/lib/reporting-lines'
import { workflowGrantIds } from '@/lib/workflow-grants'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { CLAIM_CANDIDATE_ROLE } from '@/lib/tasks/unified-list'
import type {
  RunTask, RunTaskAccess, RunTaskHistoryEntry, RunTaskPerson, RunTaskPersonRef, RunTaskPersonStatus,
} from '@/lib/run-tasks'
import { hasPerm, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export const RUN_TASK_LIMIT = 200
const OPEN = new Set(['draft', 'todo', 'in_progress', 'blocked'])
const HISTORY_EVENTS = ['task_redirected', 'reassigned', 'task_escalated', 'task_rejected', 'task_response']

export interface RunRef { id: string; workflow_id: string | null }

/** The caller, as far as task access goes. */
export interface RunTaskViewer {
  actorId: string | null
  permissions: ReadonlySet<string> | null
  has: (permission: string) => boolean
}

export function viewerOf(ctx: ServiceContext): RunTaskViewer {
  return { actorId: ctx.actorId, permissions: ctx.permissions, has: (p) => hasPerm(ctx, p) }
}

/** Everything shapeRunTasks needs, loaded in batch. */
export interface RunTaskRows {
  tasks: any[]
  assignees: any[]
  responses: any[]
  events: any[]
  people: Map<string, RunTaskPersonRef>
  teams: Map<string, string>
  /** Node id → step label. */
  labels: Map<string, string>
  /** The caller's teams (team tasks with no assignee are theirs to claim). */
  myTeams: Set<string>
  /** Workflow ids the caller manages (explicit Edit grant). */
  managedWorkflows: Set<string>
  reporting: ReportingIndex | null
}

function hasForm(metadata: any): boolean {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  if (typeof meta.form_url === 'string' && meta.form_url) return true
  if (meta.form_ref && typeof meta.form_ref === 'object' && meta.form_ref.form_id) return true
  return normalizeTaskFields(meta.fields).length > 0
}

function personOf(people: Map<string, RunTaskPersonRef>, id: string | null | undefined): RunTaskPersonRef | null {
  if (!id) return null
  return people.get(String(id)) ?? { id: String(id), name: 'Someone', avatar_url: null }
}

function namesOf(people: Map<string, RunTaskPersonRef>, ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : []
  return list.filter(Boolean).map((id) => personOf(people, String(id))!.name)
}

/** Pure: rows → the Process view's tasks for this viewer. */
export function shapeRunTasks(rows: RunTaskRows, viewer: RunTaskViewer): RunTask[] {
  const me = viewer.actorId
  const viewAll = viewer.permissions === null || viewer.has('tasks.view_all')
  const canComplete = viewer.has('tasks.complete')
  const collabBy = new Map<string, any[]>()
  for (const a of rows.assignees) collabBy.set(String(a.task_id), [...(collabBy.get(String(a.task_id)) ?? []), a])
  const responsesBy = new Map<string, any[]>()
  for (const r of rows.responses) responsesBy.set(String(r.task_id), [...(responsesBy.get(String(r.task_id)) ?? []), r])
  const eventsBy = new Map<string, any[]>()
  for (const e of rows.events) eventsBy.set(String(e.task_id), [...(eventsBy.get(String(e.task_id)) ?? []), e])

  return rows.tasks.map((t): RunTask => {
    const id = String(t.id)
    const open = OPEN.has(String(t.status))
    const collabs = collabBy.get(id) ?? []
    const responses = [...(responsesBy.get(id) ?? [])].sort((a, b) => String(a.responded_at ?? '').localeCompare(String(b.responded_at ?? '')))
    const responded = new Set(responses.map((r) => String(r.user_id)))
    const events = [...(eventsBy.get(id) ?? [])].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))

    // People: the individual assignee, then collaborators / claim candidates.
    const personStatus = (userId: string, acceptance: string | null | undefined): RunTaskPersonStatus => {
      if (responded.has(userId) || (t.status === 'completed' && (t.actioned_on_behalf_of === userId || t.actioned_by === userId))) return 'done'
      if (acceptance === 'rejected' || acceptance === 'declined') return 'declined'
      if (t.status === 'completed') return t.assignee_id === userId && !collabs.length ? 'done' : 'closed'
      if (t.status === 'cancelled') return 'closed'
      if (acceptance === 'pending' || acceptance === 'queued') return 'queued'
      if (acceptance === 'held') return 'on_hold'
      return 'in_progress'
    }
    const assignees: RunTaskPerson[] = []
    const seen = new Set<string>()
    if (t.assignee_id) {
      const uid = String(t.assignee_id)
      seen.add(uid)
      assignees.push({ ...personOf(rows.people, uid)!, role: 'assignee', status: personStatus(uid, t.acceptance_status) })
    }
    for (const c of collabs) {
      const uid = String(c.user_id)
      if (seen.has(uid)) continue
      seen.add(uid)
      const candidate = c.role === CLAIM_CANDIDATE_ROLE
      assignees.push({ ...personOf(rows.people, uid)!, role: candidate ? 'candidate' : 'collaborator', status: candidate && open && !responded.has(uid) ? 'queued' : personStatus(uid, c.acceptance_status) })
    }
    const assigneeIds = assignees.map((a) => a.id)
    const team = t.assigned_team_id ? (rows.teams.get(String(t.assigned_team_id)) ?? 'A team') : (t.aad_group_id && !assignees.length ? 'A directory group' : null)

    // Access: mirrors canReachTask (open) and decideTaskAction (act).
    const isAssignee = Boolean(me) && assigneeIds.includes(me!)
    const isTeamMember = Boolean(me) && !isAssignee && !t.assignee_id && Boolean(t.assigned_team_id) && rows.myTeams.has(String(t.assigned_team_id))
    const managedAssigneeId = me && !isAssignee && !isTeamMember && rows.reporting
      ? assigneeIds.find((uid) => isInManagerChain(rows.reporting!, me, uid)) ?? null
      : null
    const workflowId = t.workflow_id ? String(t.workflow_id) : null
    const isWorkflowManager = Boolean(me) && !isAssignee && !isTeamMember && !managedAssigneeId && workflowId != null && rows.managedWorkflows.has(workflowId)
    const isAssigner = Boolean(me) && t.assigner_id === me
    const access: RunTaskAccess | null = isAssignee || isTeamMember ? 'assignee'
      : managedAssigneeId ? 'manager'
        : isWorkflowManager ? 'workflow_manager'
          : viewAll ? 'admin'
            : isAssigner ? 'assigner'
              : null
    const canOpen = access !== null

    let canAct: RunTask['can_act'] = 'none'
    let onBehalfOf: RunTaskPersonRef | null = null
    if (open && canComplete && (canOpen || viewer.has('tasks.complete_any'))) {
      if (isAssignee || isTeamMember) canAct = 'assignee'
      else {
        const facts: TaskActorFacts = { isAssignee, isTeamMember, assigneeIds, managedAssigneeId, isWorkflowManager }
        const decision = decideTaskAction({ task: t as AuthzTask, actorId: me, permissions: viewer.permissions, facts, onBehalf: true, note: 'probe' })
        if (decision.allowed) {
          canAct = 'on_behalf'
          onBehalfOf = personOf(rows.people, decision.onBehalfOf)
        }
      }
    }
    // Acting needs the task page: a break-glass holder who can't open it can't act from here either.
    if (!canOpen) { canAct = 'none'; onBehalfOf = null }
    // Taking ownership / reassigning (the Unassigned chip, the reassign action).
    const assignFacts: TaskActorFacts = { isAssignee, isTeamMember, assigneeIds, managedAssigneeId, isWorkflowManager }
    const unassigned = open && isUnassignedTask(t as AuthzTask, assignFacts)
    const assignProbe = (action: 'take' | 'assign') => Boolean(open && canComplete && (canOpen || viewer.has('tasks.complete_any'))
      && decideTaskAssignment({ task: t as AuthzTask, actorId: me, permissions: viewer.permissions, facts: assignFacts, action }).allowed)
    const canTakeOwnership = assignProbe('take')
    const canReassign = assignProbe('assign')
    // Acting directly on an unassigned task takes ownership first: the task page.
    if (unassigned && canAct === 'on_behalf') { canAct = canTakeOwnership && canOpen ? 'assignee' : 'none'; onBehalfOf = null }

    // History: responses (every one), then redirects / reassignments / escalations / declines.
    const behalfNotes = new Map<string, string>()
    for (const e of events) {
      if (e.event_type === 'task_response' && e.metadata?.on_behalf_of && e.metadata?.on_behalf_note) behalfNotes.set(String(e.metadata.on_behalf_of), String(e.metadata.on_behalf_note))
    }
    const history: RunTaskHistoryEntry[] = []
    for (const r of responses) {
      const uid = String(r.user_id)
      const actorId = r.actioned_by ? String(r.actioned_by) : uid
      const behalf = actorId !== uid
      const notes = [r.outcome_notes, behalf ? behalfNotes.get(uid) : null].filter((x) => typeof x === 'string' && x.trim())
      history.push({
        kind: 'response', at: r.responded_at ?? null,
        actor: personOf(rows.people, actorId), on_behalf_of: behalf ? personOf(rows.people, uid) : null,
        outcome: canOpen ? String(r.outcome ?? '') || null : null,
        comment: canOpen && notes.length ? notes.join(' — ') : null,
        from: [], to: [],
      })
    }
    // Completed with no per-person response (a credential without a user, legacy rows).
    if (t.status === 'completed' && !responses.length) {
      const actorId = t.actioned_by ?? null
      history.push({
        kind: 'completed', at: t.actioned_at ?? t.completed_at ?? null,
        actor: personOf(rows.people, actorId), on_behalf_of: t.actioned_on_behalf_of ? personOf(rows.people, t.actioned_on_behalf_of) : null,
        outcome: canOpen ? (t.outcome ?? null) : null, comment: canOpen ? (t.outcome_notes ?? null) : null, from: [], to: [],
      })
    }
    if (canOpen) {
      for (const e of events) {
        const m = e.metadata ?? {}
        const base = { at: e.created_at ?? null, actor: personOf(rows.people, e.actor_id), on_behalf_of: m.on_behalf_of ? personOf(rows.people, m.on_behalf_of) : null, outcome: null }
        if (e.event_type === 'task_redirected') {
          history.push({ ...base, kind: 'redirected', comment: m.comment ?? null, from: e.actor_id ? namesOf(rows.people, e.actor_id) : [], to: [...namesOf(rows.people, m.to_user_ids), ...(Array.isArray(m.invited_emails) ? m.invited_emails.map(String) : [])] })
        } else if (e.event_type === 'reassigned') {
          history.push({
            ...base, kind: 'reassigned', comment: m.comment ?? null,
            from: [...namesOf(rows.people, m.old_assignee), ...(m.old_team ? [rows.teams.get(String(m.old_team)) ?? 'A team'] : [])],
            to: [...namesOf(rows.people, m.new_assignee), ...(m.new_team ? [rows.teams.get(String(m.new_team)) ?? 'A team'] : [])],
            ...(m.took_ownership ? { took_ownership: true } : {}),
          })
        } else if (e.event_type === 'task_escalated') {
          history.push({ ...base, kind: 'escalated', comment: null, from: [], to: [...namesOf(rows.people, m.escalated_to_user), ...(m.escalated_to_team ? [rows.teams.get(String(m.escalated_to_team)) ?? 'A team'] : [])] })
        } else if (e.event_type === 'task_rejected') {
          history.push({ ...base, kind: 'declined', comment: m.comment ?? null, from: [], to: [] })
        }
      }
      history.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
    }

    const stepName = (t.workflow_step_id && rows.labels.get(String(t.workflow_step_id))) || 'Task'
    const form = hasForm(t.metadata)
    return {
      id,
      node_id: t.workflow_step_id ? String(t.workflow_step_id) : null,
      step_name: stepName,
      title: canOpen ? String(t.title ?? stepName) : null,
      status: open ? 'waiting' : t.status === 'completed' ? 'completed' : 'cancelled',
      open,
      has_form: form,
      team,
      assignees,
      waiting_since: open ? (t.accepted_at ?? t.created_at ?? null) : null,
      due_date: t.due_date ?? null,
      completed_at: t.status === 'completed' ? (t.completed_at ?? t.actioned_at ?? null) : null,
      completed_by: t.status === 'completed' ? personOf(rows.people, t.actioned_by) : null,
      completed_on_behalf_of: t.status === 'completed' && t.actioned_on_behalf_of ? personOf(rows.people, t.actioned_on_behalf_of) : null,
      outcome: canOpen && t.status === 'completed' ? (t.outcome ?? null) : null,
      can_open: canOpen,
      can_act: canAct,
      access,
      on_behalf_of: onBehalfOf,
      unassigned,
      can_take_ownership: canTakeOwnership,
      can_reassign: canReassign,
      href: canOpen ? `/tasks/${id}${form ? '?tab=form' : ''}` : null,
      history,
    }
  })
}

const TASK_COLUMNS = 'id, tenant_id, title, status, workflow_step_id, workflow_id, workflow_run_id, assignee_id, assigned_team_id, aad_group_id, assignment_mode, assigner_id, acceptance_status, accepted_at, is_workflow_task, event_id, created_at, completed_at, due_date, outcome, outcome_notes, actioned_by, actioned_on_behalf_of, actioned_at, metadata, allow_reassign'

/** Step labels of the definition a run executes (its version, else the workflow draft). */
export async function runStepLabels(db: AnySupabaseClient, tenantId: string, run: { workflow_id: string | null; version_id?: string | null }): Promise<Map<string, string>> {
  let nodes: any[] = []
  if (run.version_id) {
    const { data } = await (db as any).from('workflow_versions').select('nodes').eq('id', run.version_id).eq('tenant_id', tenantId).maybeSingle()
    nodes = Array.isArray(data?.nodes) ? data.nodes : []
  }
  if (!nodes.length && run.workflow_id) {
    const { data } = await (db as any).from('workflows').select('nodes').eq('id', run.workflow_id).eq('tenant_id', tenantId).maybeSingle()
    nodes = Array.isArray(data?.nodes) ? data.nodes : []
  }
  return labelsOf(nodes)
}

export function labelsOf(nodes: readonly any[]): Map<string, string> {
  return new Map((nodes ?? []).filter((n) => n && typeof n.id === 'string').map((n) => [n.id as string, String(n.label || n.type || 'Step')]))
}

/**
 * Load and shape the run's tasks for the caller. `db` defaults to the
 * service-role client (tenant-filtered reads); the caller must already have
 * passed the run visibility check.
 */
export async function loadRunTasks(ctx: ServiceContext, run: RunRef, options: { labels: Map<string, string>; db?: AnySupabaseClient }): Promise<RunTask[]> {
  const db = (options.db ?? await serviceRoleClient(ctx)) as any
  const tenantId = ctx.tenantId
  const { data: taskRows, error } = await db.from('tasks').select(TASK_COLUMNS)
    .eq('tenant_id', tenantId).eq('workflow_run_id', run.id).is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(RUN_TASK_LIMIT)
  if (error) throw dbError(error)
  const tasks = (taskRows ?? []) as any[]
  if (!tasks.length) return []
  const taskIds = tasks.map((t) => String(t.id))
  const me = ctx.actorId
  const workflowIds = [...new Set([run.workflow_id, ...tasks.map((t) => t.workflow_id)].filter(Boolean).map(String))]
  // Tasks whose workflow_id is unset belong to the run's workflow.
  for (const t of tasks) if (!t.workflow_id && run.workflow_id) t.workflow_id = run.workflow_id

  const [assigneesResult, responsesResult, eventsResult, myTeamsResult, managed, reporting] = await Promise.all([
    db.from('task_assignees').select('task_id, user_id, role, acceptance_status').eq('tenant_id', tenantId).in('task_id', taskIds),
    db.from('task_responses').select('task_id, user_id, outcome, outcome_notes, responded_at, actioned_by').eq('tenant_id', tenantId).in('task_id', taskIds),
    db.from('lifecycle_events').select('task_id, event_type, actor_id, metadata, created_at').eq('tenant_id', tenantId).in('task_id', taskIds).in('event_type', HISTORY_EVENTS)
      .order('created_at', { ascending: true }).limit(2000),
    me ? db.from('user_teams').select('team_id').eq('user_id', me) : Promise.resolve({ data: [] }),
    me ? workflowGrantIds(db, tenantId, me, 'can_edit', workflowIds) : Promise.resolve([] as string[]),
    me ? loadReportingIndex(db, tenantId) : Promise.resolve(null),
  ])
  for (const r of [assigneesResult, responsesResult, eventsResult]) if (r.error) throw dbError(r.error)
  const assignees = (assigneesResult.data ?? []) as any[]
  const responses = (responsesResult.data ?? []) as any[]
  const events = (eventsResult.data ?? []) as any[]

  const personIds = new Set<string>()
  const add = (v: unknown) => { for (const x of Array.isArray(v) ? v : [v]) if (x) personIds.add(String(x)) }
  for (const t of tasks) { add(t.assignee_id); add(t.actioned_by); add(t.actioned_on_behalf_of) }
  for (const a of assignees) add(a.user_id)
  for (const r of responses) { add(r.user_id); add(r.actioned_by) }
  for (const e of events) {
    add(e.actor_id)
    const m = e.metadata ?? {}
    add(m.to_user_ids); add(m.old_assignee); add(m.new_assignee); add(m.escalated_to_user); add(m.on_behalf_of)
  }
  const teamIds = new Set<string>()
  for (const t of tasks) if (t.assigned_team_id) teamIds.add(String(t.assigned_team_id))
  for (const e of events) for (const k of ['escalated_to_team', 'old_team', 'new_team']) if (e.metadata?.[k]) teamIds.add(String(e.metadata[k]))

  const [usersResult, teamsResult] = await Promise.all([
    personIds.size ? db.from('users').select('id, display_name, email, avatar_url').in('id', [...personIds]) : Promise.resolve({ data: [] }),
    teamIds.size ? db.from('teams').select('id, name').eq('tenant_id', tenantId).in('id', [...teamIds]) : Promise.resolve({ data: [] }),
  ])
  const people = new Map<string, RunTaskPersonRef>()
  for (const u of (usersResult.data ?? []) as any[]) {
    people.set(String(u.id), { id: String(u.id), name: String(u.display_name || (u.email ? String(u.email).split('@')[0] : '') || 'Someone'), avatar_url: u.avatar_url ?? null })
  }
  const teams = new Map<string, string>()
  for (const t of (teamsResult.data ?? []) as any[]) teams.set(String(t.id), String(t.name ?? 'Team'))

  return shapeRunTasks({
    tasks, assignees, responses, events, people, teams, labels: options.labels,
    myTeams: new Set(((myTeamsResult.data ?? []) as any[]).map((r) => String(r.team_id))),
    managedWorkflows: new Set(managed),
    reporting,
  }, viewerOf(ctx))
}

/** For REST / MCP: load the step labels too. */
export async function loadRunTasksForRun(ctx: ServiceContext, run: RunRef & { version_id?: string | null }): Promise<RunTask[]> {
  const db = await serviceRoleClient(ctx)
  const labels = await runStepLabels(db, ctx.tenantId, run)
  return loadRunTasks(ctx, run, { labels, db })
}
