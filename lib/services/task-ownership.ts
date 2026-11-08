/**
 * Taking ownership of a task and (re)assigning it — one implementation
 * behind the task page ("Take ownership", "Assign to…"), the process view's
 * Unassigned chip, the queue page's Active tasks tab (single and bulk) and
 * the Agent's task tools (lib/assistants/tools/task-assign.ts).
 *
 * Authorisation is lib/task-authz.ts decideTaskAssignment:
 *  - an UNASSIGNED task (no assignee, collaborators or team): a workspace
 *    admin (tasks.complete_any) or a manager of the workflow (Edit grant);
 *  - an assigned task: the assignee when the step allows redirect
 *    (allow_reassign), anyone in the assignee's manager chain, a manager of
 *    the workflow, or an admin.
 * Team members keep claiming team tasks (lib/services/home claimTask).
 *
 * Every change: the task row (service-role, tenant-filtered, after the
 * check), a `reassigned` lifecycle event (task history and the run's
 * process view; `took_ownership` marks taking it), an audit row and a
 * notification to the new assignee (and the previous one).
 */

import { authorizeTaskAssignment, TaskAuthzError, type AssignBasis } from '@/lib/task-authz'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { acceptanceForAssignee } from '@/lib/tasks/queue-rules-server'
import { decideAcceptance, QUEUE_TASK_COLUMNS, queueFactsFromTask } from '@/lib/tasks/queue-rules'
import { CLAIM_CANDIDATE_ROLE } from '@/lib/tasks/unified-list'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const ASSIGN_REASON_MAX = 2000
/** At most this many tasks per bulk reassign. */
export const BULK_ASSIGN_MAX = 100

export type AssignVia = 'ui' | 'api' | 'mcp' | 'agent'

export interface AssignmentResult {
  task_id: string
  title: string
  previous_assignee_id: string | null
  previous_team_id: string | null
  assignee_id: string | null
  team_id: string | null
  took_ownership: boolean
  basis: AssignBasis
}

const TASK_COLUMNS = `title, assignee_id, assigned_team_id, assignment_mode, acceptance_status, ${QUEUE_TASK_COLUMNS}`

function serviceError(error: unknown): unknown {
  if (error instanceof TaskAuthzError) return new ServiceError(error.code, error.message, { status: error.status })
  return error
}

function cleanReason(reason: unknown): string | null {
  const text = typeof reason === 'string' ? reason.trim() : ''
  if (text.length > ASSIGN_REASON_MAX) throw ServiceError.validation(`The reason is too long (${ASSIGN_REASON_MAX} characters at most)`)
  return text || null
}

async function displayName(db: AnySupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await (db as any).from('users').select('display_name, email').eq('id', userId).maybeSingle()
  return data ? String(data.display_name || data.email || '') || null : null
}

async function requireActiveMember(db: AnySupabaseClient, tenantId: string, userId: string) {
  const { data, error } = await (db as any).from('user_memberships').select('user_id, is_active')
    .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw dbError(error)
  if (!data || data.is_active === false) throw ServiceError.validation('That person is not a member of this workspace')
}

async function requireTeam(db: AnySupabaseClient, tenantId: string, teamId: string): Promise<string> {
  const { data, error } = await (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).eq('id', teamId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.validation('That team is not in this workspace')
  return String(data.name ?? 'the team')
}

/**
 * Write one assignment after the check: the task row, the claim candidates
 * dropping out, history, audit and notifications.
 */
async function applyAssignment(ctx: ServiceContext, db: AnySupabaseClient, task: Record<string, any>, input: {
  toUser: string | null
  toTeam: string | null
  basis: AssignBasis
  tookOwnership: boolean
  reason: string | null
  via: AssignVia
}): Promise<AssignmentResult> {
  const taskId = String(task.id)
  const now = new Date().toISOString()
  const facts = queueFactsFromTask(task, { assignedBy: ctx.actorId ?? null, origins: ['reassign'] })
  const patch: Record<string, unknown> = input.toUser
    ? {
        assignee_id: input.toUser,
        assigned_team_id: null,
        assignment_mode: 'single',
        // Taking ownership is the person's own choice: accepted. Someone else gets it through their queue rules.
        acceptance_status: input.tookOwnership ? 'accepted' : await acceptanceForAssignee(db, input.toUser, facts, undefined, { tenantId: ctx.tenantId }),
        ...(input.tookOwnership ? { accepted_at: now, ...(task.status === 'todo' ? { status: 'in_progress', started_at: now } : {}) } : {}),
      }
    : {
        assignee_id: null,
        assigned_team_id: input.toTeam,
        assignment_mode: 'team',
        assignment_type: 'team',
        acceptance_status: decideAcceptance({ preferences: null, facts: { ...facts, assignment: 'team', assigned_team_id: input.toTeam } }),
      }
  if (task.assignment_type === 'aad_group' && input.toUser) patch.assignment_type = 'individual'
  const { error } = await (db as any).from('tasks').update(patch).eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  // Claim candidates (directory-group pools) drop out: the task now has its owner.
  await (db as any).from('task_assignees').delete().eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('role', CLAIM_CANDIDATE_ROLE)

  const previousAssignee = task.assignee_id ? String(task.assignee_id) : null
  const previousTeam = task.assigned_team_id ? String(task.assigned_team_id) : null
  await writeLifecycleEvent({
    supabase: db as any, tenantId: ctx.tenantId, taskId, eventType: 'reassigned', actorId: ctx.actorId,
    metadata: {
      old_assignee: previousAssignee, new_assignee: input.toUser, old_team: previousTeam, new_team: input.toTeam,
      comment: input.reason, via: input.via, acted_as: input.basis, ...(input.tookOwnership ? { took_ownership: true } : {}),
    },
  })
  const actorName = (await displayName(db, ctx.actorId)) ?? 'Someone'
  const title = String(task.title ?? 'a task')
  const notes: Array<{ user_id: string; title: string; body: string }> = []
  if (input.toUser && input.toUser !== ctx.actorId) {
    notes.push({ user_id: input.toUser, title: `Assigned to you: ${title}`, body: input.reason || `${actorName} assigned this task to you.` })
  }
  if (previousAssignee && previousAssignee !== ctx.actorId && previousAssignee !== input.toUser) {
    notes.push({ user_id: previousAssignee, title: `Reassigned: ${title}`, body: `${actorName} reassigned this task${input.reason ? `: ${input.reason}` : '.'}` })
  }
  if (notes.length) {
    await (db as any).from('notifications').insert(notes.map((n) => ({ ...n, tenant_id: ctx.tenantId, type: 'task_assigned', task_id: taskId })))
  }
  await audit(ctx, {
    objectType: 'task' as any, objectId: taskId, action: 'reassign',
    summary: input.tookOwnership
      ? `Took ownership of "${title.slice(0, 120)}"${previousAssignee || previousTeam ? '' : ' (unassigned)'}`
      : `Reassigned "${title.slice(0, 120)}"`,
    metadata: { from: previousAssignee, from_team: previousTeam, to: input.toUser, to_team: input.toTeam, basis: input.basis, reason: input.reason, ...(input.tookOwnership ? { took_ownership: true } : {}) },
  })
  return {
    task_id: taskId, title, previous_assignee_id: previousAssignee, previous_team_id: previousTeam,
    assignee_id: input.toUser, team_id: input.toTeam, took_ownership: input.tookOwnership, basis: input.basis,
  }
}

/** Assign the task to the signed-in person (an unassigned task: admins and workflow managers; else managers / admins). */
export async function takeTaskOwnership(ctx: ServiceContext, taskId: string, input: { reason?: string | null; via: AssignVia }, options: { db?: AnySupabaseClient } = {}): Promise<AssignmentResult> {
  requirePerm(ctx, 'tasks.complete')
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: taking ownership needs a signed-in person')
  const reason = cleanReason(input.reason)
  const db = options.db ?? await serviceRoleClient(ctx)
  let access
  try {
    access = await authorizeTaskAssignment(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions, action: 'take', columns: TASK_COLUMNS })
  } catch (error) { throw serviceError(error) }
  return applyAssignment(ctx, db, access.task, { toUser: ctx.actorId, toTeam: null, basis: access.basis, tookOwnership: true, reason, via: input.via })
}

/** (Re)assign the task to a person or a team, with a reason. */
export async function assignTask(ctx: ServiceContext, taskId: string, input: { target_user_id?: string | null; target_team_id?: string | null; reason?: string | null; via: AssignVia }, options: { db?: AnySupabaseClient } = {}): Promise<AssignmentResult> {
  requirePerm(ctx, 'tasks.complete')
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: assigning a task needs a signed-in person')
  const toUser = typeof input.target_user_id === 'string' && input.target_user_id.trim() ? input.target_user_id.trim() : null
  const toTeam = !toUser && typeof input.target_team_id === 'string' && input.target_team_id.trim() ? input.target_team_id.trim() : null
  if (!toUser && !toTeam) throw ServiceError.validation('Choose a person or a team to assign the task to')
  const reason = cleanReason(input.reason)
  const db = options.db ?? await serviceRoleClient(ctx)
  // Assigning to yourself is taking ownership (its own rule).
  if (toUser === ctx.actorId) return takeTaskOwnership(ctx, taskId, { reason, via: input.via }, { db })
  let access
  try {
    access = await authorizeTaskAssignment(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions, action: 'assign', columns: TASK_COLUMNS })
  } catch (error) { throw serviceError(error) }
  const task = access.task
  if (task.assignment_mode === 'collaborative') throw ServiceError.validation('This task is shared by several people — invite or redirect from the task instead')
  if (toUser) {
    if (toUser === task.assignee_id) throw ServiceError.validation('The task is already assigned to that person')
    await requireActiveMember(db, ctx.tenantId, toUser)
  } else {
    if (toTeam === task.assigned_team_id && !task.assignee_id) throw ServiceError.validation('The task is already assigned to that team')
    await requireTeam(db, ctx.tenantId, toTeam!)
  }
  return applyAssignment(ctx, db, task, { toUser, toTeam, basis: access.basis, tookOwnership: false, reason, via: input.via })
}

/**
 * Bulk reassign (the queue page's Active tasks tab): admins only
 * (tasks.complete_any), to one person, each task checked and written on its
 * own — one failure doesn't stop the rest.
 */
export async function bulkAssignTasks(ctx: ServiceContext, taskIds: string[], input: { target_user_id: string; reason?: string | null; via: AssignVia }): Promise<{ assigned: AssignmentResult[]; failed: Array<{ task_id: string; error: string }> }> {
  requirePerm(ctx, 'tasks.complete_any')
  const ids = Array.from(new Set((Array.isArray(taskIds) ? taskIds : []).map(String).filter(Boolean)))
  if (!ids.length) throw ServiceError.validation('Choose at least one task')
  if (ids.length > BULK_ASSIGN_MAX) throw ServiceError.validation(`At most ${BULK_ASSIGN_MAX} tasks at a time`)
  const db = await serviceRoleClient(ctx)
  const assigned: AssignmentResult[] = []
  const failed: Array<{ task_id: string; error: string }> = []
  for (const id of ids) {
    try {
      assigned.push(await assignTask(ctx, id, { target_user_id: input.target_user_id, reason: input.reason, via: input.via }, { db }))
    } catch (error) {
      failed.push({ task_id: id, error: (error as Error)?.message || 'Could not reassign' })
    }
  }
  return { assigned, failed }
}
