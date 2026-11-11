/**
 * Invite (read only): share a task with people, teams and roles
 * (task_viewers, migration 20270105000000). One implementation behind the
 * task page and list panel's Invite dialog, REST /api/v1/tasks/{id}/viewers
 * and the MCP tasks_viewers_* tools.
 *
 * Who may invite and remove (lib/task-authz.ts decideViewerManagement): the
 * people who can act on the task — assignee / collaborators / members of the
 * assigned team, the assigner, the assignee's managers, a manager of the
 * workflow, admins (tasks.complete_any). Invited viewers can't invite.
 *
 * What an invite gives (everyone it names — directly, through a team they
 * are in or a role they hold): the task (and its subtasks when
 * include_subtasks), its comments, attachments, history and its run's
 * process view, read only, plus commenting. The task shows in their Task
 * tracker → Following ("Shared with me") and in the dependency picker.
 *
 * Writes run on the service-role client after the check (authenticated
 * callers have SELECT only on task_viewers). Each invite / removal writes a
 * history event (lifecycle `assigned`, metadata.action viewers_invited /
 * viewer_removed), an audit row (share / unshare) and notifications:
 * people invited directly get a bell notification and an email; members of
 * an invited team or role get a bell notification when the group has at
 * most GROUP_NOTIFY_CAP people (larger groups: none — it would be noise; the
 * task still shows in their tracker).
 */

import {
  authorizeViewerManagement, canReachTask, canViewTask, decideTaskComment, findTaskViewerGrant, loadTaskActorFacts,
  decideViewerManagement, TaskAuthzError, VIEWER_PRINCIPAL_TYPES, type ViewerManageBasis, type ViewerPrincipalType,
} from '@/lib/task-authz'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { getDb, requireAny, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

const TASK_VIEW = ['tasks.view_own', 'tasks.view_all'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Most principals one invite names. */
export const MAX_VIEWERS_PER_INVITE = 50
/** Most invites one task holds. */
export const MAX_VIEWERS_PER_TASK = 200
export const VIEWER_NOTE_MAX = 2000
/** Members of an invited team / role are notified when the group is at most this big. */
export const GROUP_NOTIFY_CAP = 25

export type ViewerVia = 'ui' | 'api' | 'mcp' | 'agent'

export interface ViewerPrincipal { type: ViewerPrincipalType; id: string }

export interface TaskViewer {
  id: string
  task_id: string
  principal_type: ViewerPrincipalType
  principal_id: string
  /** Person / team / role name ("Deleted team" when it is gone). */
  name: string
  /** Team members / role holders in the workspace (null for a person). */
  member_count: number | null
  include_subtasks: boolean
  note: string | null
  invited_by: { id: string; name: string } | null
  created_at: string
}

export interface TaskViewerList {
  task_id: string
  tenant_id: string
  viewers: TaskViewer[]
  /** May the caller invite viewers and remove them. */
  can_manage: boolean
}

const TYPE_LABEL: Record<ViewerPrincipalType, string> = { user: 'person', team: 'team', role: 'role' }

function serviceError(error: unknown): unknown {
  if (error instanceof TaskAuthzError) return new ServiceError(error.code, error.message, { status: error.status })
  return error
}

/** "Finance (team)", "Priya Nair", "Approvers (role)". */
export function viewerLabel(v: { principal_type: ViewerPrincipalType; name: string }): string {
  return v.principal_type === 'user' ? v.name : `${v.name} (${TYPE_LABEL[v.principal_type]})`
}

/** Validate and de-duplicate requested principals (pure). */
export function parseViewerPrincipals(input: unknown): ViewerPrincipal[] {
  if (!Array.isArray(input) || !input.length) throw ServiceError.validation('Choose at least one person, team or role to invite')
  const seen = new Set<string>()
  const out: ViewerPrincipal[] = []
  for (const raw of input) {
    const type = String((raw as any)?.type ?? '') as ViewerPrincipalType
    const id = String((raw as any)?.id ?? '').trim()
    if (!VIEWER_PRINCIPAL_TYPES.includes(type)) throw ServiceError.validation('Each invitee has a type: user, team or role')
    if (!UUID_RE.test(id)) throw ServiceError.validation(`Invalid ${TYPE_LABEL[type] ?? 'invitee'} id`)
    const key = `${type}:${id.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type, id: id.toLowerCase() })
  }
  if (out.length > MAX_VIEWERS_PER_INVITE) throw ServiceError.validation(`Invite at most ${MAX_VIEWERS_PER_INVITE} people, teams or roles at a time`)
  return out
}

/**
 * 404 unless the caller may READ this task: anyone who can reach it
 * (requireTaskReach's rule) or an invited viewer. The task page, the list
 * panel and the viewer list use it; every write keeps requireTaskReach.
 */
export async function requireTaskView(ctx: ServiceContext, taskId: string): Promise<void> {
  if (ctx.permissions === null || ctx.permissions.has('tasks.view_all')) return
  if (!ctx.actorId) return
  const ok = await canViewTask(ctx.supabase, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
  if (!ok) throw ServiceError.notFound('Task not found')
}

/**
 * Commenting: tasks.complete on a task the person can reach (the earlier
 * rule), or an invited viewer (read + comment). 404 when they can't see the
 * task at all, 403 when they can see it but not comment.
 */
export async function requireTaskComment(ctx: ServiceContext, taskId: string): Promise<void> {
  if (ctx.permissions === null) return
  const reachable = ctx.permissions.has('tasks.view_all') || !ctx.actorId
    || await canReachTask(ctx.supabase, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
  if (decideTaskComment({ permissions: ctx.permissions, reachable, viewer: false })) return
  const viewer = !reachable && Boolean(await findTaskViewerGrant(ctx.supabase, ctx.tenantId, ctx.actorId, taskId))
  if (decideTaskComment({ permissions: ctx.permissions, reachable, viewer })) return
  if (!reachable && !viewer) throw ServiceError.notFound('Task not found')
  throw ServiceError.forbidden("Forbidden: your role can't comment on tasks (tasks.complete)")
}

async function names(db: AnySupabaseClient, tenantId: string, rows: Array<{ principal_type: string; principal_id: string }>, extraUserIds: string[] = []) {
  const ids = (type: string) => Array.from(new Set(rows.filter((r) => r.principal_type === type).map((r) => String(r.principal_id))))
  const userIds = Array.from(new Set([...ids('user'), ...extraUserIds.filter(Boolean)]))
  const teamIds = ids('team')
  const roleIds = ids('role')
  const [users, teams, roles, teamMembers, roleHolders] = await Promise.all([
    userIds.length ? (db as any).from('users').select('id, display_name, email').in('id', userIds) : { data: [] },
    teamIds.length ? (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', teamIds) : { data: [] },
    roleIds.length ? (db as any).from('roles').select('id, name').eq('tenant_id', tenantId).in('id', roleIds) : { data: [] },
    teamIds.length ? (db as any).from('user_teams').select('team_id, user_id').in('team_id', teamIds).limit(5000) : { data: [] },
    roleIds.length ? (db as any).from('user_roles').select('role_id, user_id').eq('tenant_id', tenantId).in('role_id', roleIds).limit(5000) : { data: [] },
  ])
  const count = (list: any[], key: string) => {
    const m = new Map<string, number>()
    for (const r of list ?? []) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1)
    return m
  }
  return {
    user: new Map<string, string>(((users.data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')])),
    team: new Map<string, string>(((teams.data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')])),
    role: new Map<string, string>(((roles.data ?? []) as any[]).map((r) => [String(r.id), String(r.name ?? 'Role')])),
    teamCount: count(teamMembers.data as any[], 'team_id'),
    roleCount: count(roleHolders.data as any[], 'role_id'),
  }
}

function present(rows: any[], n: Awaited<ReturnType<typeof names>>): TaskViewer[] {
  return rows.map((r) => {
    const type = r.principal_type as ViewerPrincipalType
    const pid = String(r.principal_id)
    const name = n[type].get(pid) ?? (type === 'user' ? 'Former member' : type === 'team' ? 'Deleted team' : 'Deleted role')
    return {
      id: String(r.id), task_id: String(r.task_id), principal_type: type, principal_id: pid, name,
      member_count: type === 'team' ? (n.teamCount.get(pid) ?? 0) : type === 'role' ? (n.roleCount.get(pid) ?? 0) : null,
      include_subtasks: r.include_subtasks !== false, note: r.note ?? null,
      invited_by: r.invited_by ? { id: String(r.invited_by), name: n.user.get(String(r.invited_by)) ?? 'Someone' } : null,
      created_at: String(r.created_at),
    }
  })
}

async function loadViewers(db: AnySupabaseClient, tenantId: string, taskId: string): Promise<TaskViewer[]> {
  const { data, error } = await (db as any).from('task_viewers')
    .select('id, task_id, principal_type, principal_id, invited_by, include_subtasks, note, created_at')
    .eq('tenant_id', tenantId).eq('task_id', taskId).order('created_at').limit(MAX_VIEWERS_PER_TASK)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  return present(rows, await names(db, tenantId, rows, rows.map((r) => r.invited_by)))
}

/** The task's invites (anyone who can see the task), with whether the caller may manage them. */
export async function listTaskViewers(ctx: ServiceContext, taskId: string): Promise<TaskViewerList> {
  requireAny(ctx, TASK_VIEW)
  if (!UUID_RE.test(String(taskId))) throw ServiceError.notFound('Task not found')
  const db = await serviceRoleClient(ctx)
  const { data: task, error } = await (db as any).from('tasks')
    .select('id, tenant_id, status, is_workflow_task, event_id, assignee_id, assigned_team_id, assignment_mode, deleted_at, workflow_id, workflow_run_id, allow_reassign, assigner_id')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  if (ctx.actorId && ctx.permissions !== null && !ctx.permissions.has('tasks.view_all')) {
    if (!(await canViewTask(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions }))) throw ServiceError.notFound('Task not found')
  }
  const facts = await loadTaskActorFacts(db, task, ctx.actorId)
  const can = decideViewerManagement({ actorId: ctx.actorId, permissions: ctx.permissions, facts, assignerId: task.assigner_id ?? null })
  return { task_id: taskId, tenant_id: ctx.tenantId, viewers: await loadViewers(db, ctx.tenantId, taskId), can_manage: can.allowed }
}

async function validatePrincipals(db: AnySupabaseClient, tenantId: string, principals: ViewerPrincipal[]) {
  const of = (type: ViewerPrincipalType) => principals.filter((p) => p.type === type).map((p) => p.id)
  const [users, teams, roles] = await Promise.all([
    of('user').length ? (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', of('user')) : { data: [] },
    of('team').length ? (db as any).from('teams').select('id').eq('tenant_id', tenantId).in('id', of('team')) : { data: [] },
    of('role').length ? (db as any).from('roles').select('id').eq('tenant_id', tenantId).in('id', of('role')) : { data: [] },
  ])
  const ok = {
    user: new Set(((users.data ?? []) as any[]).map((r) => String(r.user_id))),
    team: new Set(((teams.data ?? []) as any[]).map((r) => String(r.id))),
    role: new Set(((roles.data ?? []) as any[]).map((r) => String(r.id))),
  }
  const bad = principals.find((p) => !ok[p.type].has(p.id))
  if (bad) throw ServiceError.validation(bad.type === 'user' ? 'That person is not a member of this workspace' : `That ${bad.type} is not in this workspace`)
}

/** Who to notify for an invite: people named directly, plus members of small teams / roles (not the actor). */
async function recipients(db: AnySupabaseClient, tenantId: string, principals: ViewerPrincipal[], actorId: string | null) {
  const direct = new Set(principals.filter((p) => p.type === 'user').map((p) => p.id))
  const group = new Set<string>()
  const skippedGroups: string[] = []
  for (const p of principals) {
    if (p.type === 'user') continue
    const { data } = p.type === 'team'
      ? await (db as any).from('user_teams').select('user_id').eq('team_id', p.id).limit(GROUP_NOTIFY_CAP + 1)
      : await (db as any).from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', p.id).limit(GROUP_NOTIFY_CAP + 1)
    const ids = ((data ?? []) as any[]).map((r) => String(r.user_id))
    if (ids.length > GROUP_NOTIFY_CAP) { skippedGroups.push(p.id); continue }
    for (const id of ids) if (!direct.has(id)) group.add(id)
  }
  if (actorId) { direct.delete(actorId); group.delete(actorId) }
  // Active members of this workspace only.
  const all = [...direct, ...group]
  if (!all.length) return { direct: [] as string[], group: [] as string[], skippedGroups }
  const { data: active } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', all)
  const keep = new Set(((active ?? []) as any[]).map((r) => String(r.user_id)))
  return { direct: [...direct].filter((id) => keep.has(id)), group: [...group].filter((id) => keep.has(id)), skippedGroups }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

async function notifyInvited(db: AnySupabaseClient, tenantId: string, task: { id: string; title: string }, actorName: string, note: string | null, people: { direct: string[]; group: string[] }) {
  try {
    const title = `Shared with you: ${task.title}`
    const body = note ? `${actorName}: ${note}` : `${actorName} invited you to view this task (read only).`
    const rows = [...people.direct, ...people.group].map((userId) => ({ user_id: userId, tenant_id: tenantId, type: 'task_shared', title: title.slice(0, 300), body: body.slice(0, 1000), task_id: task.id }))
    if (rows.length) await (db as any).from('notifications').insert(rows)
    if (!people.direct.length) return
    const { data: users } = await (db as any).from('users').select('id, email').in('id', people.direct)
    const [{ sendEmail }, { appUrlOrLocalhost }] = await Promise.all([import('@/lib/email'), import('@/lib/config/bootstrap')])
    const link = `${appUrlOrLocalhost().replace(/\/$/, '')}/tasks/${task.id}`
    for (const u of (users ?? []) as any[]) {
      if (!u.email) continue
      await sendEmail({
        to: String(u.email),
        subject: title.slice(0, 200),
        body: `<p>${escapeHtml(actorName)} invited you to view <strong>${escapeHtml(task.title)}</strong> (read only — you can follow it and comment).</p>`
          + (note ? `<p>${escapeHtml(note)}</p>` : '')
          + `<p><a href="${escapeHtml(link)}">Open the task</a></p>`,
      }).catch(() => undefined)
    }
  } catch (error) {
    console.warn('[task-viewers] notify failed:', error instanceof Error ? error.message : error)
  }
}

export interface AddViewersResult {
  task_id: string
  added: TaskViewer[]
  /** Already invited (unchanged). */
  existing: number
  /** People notified (bell), and the groups too large to notify. */
  notified: number
  skipped_group_notifications: number
  basis: ViewerManageBasis
}

/** Invite people, teams and roles to view the task (read only). Already-invited ones are left as they are. */
export async function addTaskViewers(ctx: ServiceContext, taskId: string, input: { principals: unknown; note?: string | null; include_subtasks?: boolean | null; via: ViewerVia }): Promise<AddViewersResult> {
  requireAny(ctx, TASK_VIEW)
  if (!UUID_RE.test(String(taskId))) throw ServiceError.notFound('Task not found')
  const principals = parseViewerPrincipals(input.principals)
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null
  if (note && note.length > VIEWER_NOTE_MAX) throw ServiceError.validation(`The note is too long (${VIEWER_NOTE_MAX} characters at most)`)
  const includeSubtasks = input.include_subtasks !== false
  const db = await serviceRoleClient(ctx)
  let access
  try {
    access = await authorizeViewerManagement(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
  } catch (error) { throw serviceError(error) }
  await validatePrincipals(db, ctx.tenantId, principals)

  const { data: existingRows, error: existingError } = await (db as any).from('task_viewers')
    .select('principal_type, principal_id').eq('tenant_id', ctx.tenantId).eq('task_id', taskId)
  if (existingError) throw dbError(existingError)
  const existing = new Set(((existingRows ?? []) as any[]).map((r) => `${r.principal_type}:${r.principal_id}`))
  // Inviting yourself changes nothing.
  const fresh = principals.filter((p) => !existing.has(`${p.type}:${p.id}`) && !(p.type === 'user' && p.id === ctx.actorId))
  if (existing.size + fresh.length > MAX_VIEWERS_PER_TASK) throw ServiceError.validation(`A task can be shared with at most ${MAX_VIEWERS_PER_TASK} people, teams and roles`)
  const task = { id: taskId, title: String(access.task.title ?? 'a task') }
  if (!fresh.length) return { task_id: taskId, added: [], existing: principals.length, notified: 0, skipped_group_notifications: 0, basis: access.basis }

  // Auto-follow for people invited directly (only where they didn't follow it already: removing the invite unfollows).
  const userIds = fresh.filter((p) => p.type === 'user').map((p) => p.id)
  const { data: follows } = userIds.length
    ? await (db as any).from('task_followers').select('user_id').eq('task_id', taskId).in('user_id', userIds)
    : { data: [] }
  const alreadyFollowing = new Set(((follows ?? []) as any[]).map((r) => String(r.user_id)))

  const { data: inserted, error } = await (db as any).from('task_viewers').insert(fresh.map((p) => ({
    tenant_id: ctx.tenantId, task_id: taskId, principal_type: p.type, principal_id: p.id,
    invited_by: ctx.actorId, include_subtasks: includeSubtasks, note,
    auto_followed: p.type === 'user' && !alreadyFollowing.has(p.id),
  }))).select('id, task_id, principal_type, principal_id, invited_by, include_subtasks, note, created_at')
  if (error) throw dbError(error, 'Failed to invite')
  const newFollows = userIds.filter((id) => !alreadyFollowing.has(id))
  if (newFollows.length) {
    await (db as any).from('task_followers')
      .upsert(newFollows.map((userId) => ({ tenant_id: ctx.tenantId, user_id: userId, task_id: taskId })), { onConflict: 'user_id,task_id', ignoreDuplicates: true })
  }

  const rows = (inserted ?? []) as any[]
  const n = await names(db, ctx.tenantId, rows, [ctx.actorId ?? ''])
  const added = present(rows, n)
  const labels = added.map(viewerLabel)
  const actorName = (ctx.actorId && n.user.get(ctx.actorId)) || 'Someone'
  await writeLifecycleEvent({
    supabase: db as any, tenantId: ctx.tenantId, taskId, eventType: 'assigned', actorId: ctx.actorId,
    metadata: {
      action: 'viewers_invited', via: input.via, acted_as: access.basis, comment: note, include_subtasks: includeSubtasks,
      viewers: added.map((v) => ({ id: v.id, type: v.principal_type, principal_id: v.principal_id, name: v.name })),
      message: `invited ${labels.join(', ')} to view`,
    },
  })
  await audit(ctx, {
    objectType: 'task' as any, objectId: taskId, action: 'share',
    summary: `Invited ${labels.join(', ').slice(0, 300)} to view "${task.title.slice(0, 120)}" (read only)`,
    metadata: { viewers: added.map((v) => ({ type: v.principal_type, id: v.principal_id })), basis: access.basis, include_subtasks: includeSubtasks, note, via: input.via },
  })
  const people = await recipients(db, ctx.tenantId, fresh, ctx.actorId)
  await notifyInvited(db, ctx.tenantId, task, actorName, note, people)
  return {
    task_id: taskId, added, existing: principals.length - fresh.length,
    notified: people.direct.length + people.group.length, skipped_group_notifications: people.skippedGroups.length, basis: access.basis,
  }
}

/** Remove one invite (by its id): its people lose access unless something else lets them in. */
export async function removeTaskViewer(ctx: ServiceContext, taskId: string, viewerId: string, input: { via: ViewerVia }): Promise<{ task_id: string; removed: TaskViewer }> {
  requireAny(ctx, TASK_VIEW)
  if (!UUID_RE.test(String(taskId))) throw ServiceError.notFound('Task not found')
  if (!UUID_RE.test(String(viewerId))) throw ServiceError.notFound('Invite not found')
  const db = await serviceRoleClient(ctx)
  let access
  try {
    access = await authorizeViewerManagement(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
  } catch (error) { throw serviceError(error) }
  const { data: row, error } = await (db as any).from('task_viewers')
    .select('id, task_id, principal_type, principal_id, invited_by, include_subtasks, note, created_at, auto_followed')
    .eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('id', viewerId).maybeSingle()
  if (error) throw dbError(error)
  if (!row) throw ServiceError.notFound('Invite not found')
  const { error: deleteError } = await (db as any).from('task_viewers').delete().eq('tenant_id', ctx.tenantId).eq('id', viewerId)
  if (deleteError) throw dbError(deleteError, 'Failed to remove the invite')
  // The follow the invite created goes with it.
  if (row.principal_type === 'user' && row.auto_followed) {
    await (db as any).from('task_followers').delete().eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('user_id', row.principal_id)
  }
  const [removed] = present([row], await names(db, ctx.tenantId, [row], [row.invited_by]))
  const title = String(access.task.title ?? 'a task')
  await writeLifecycleEvent({
    supabase: db as any, tenantId: ctx.tenantId, taskId, eventType: 'assigned', actorId: ctx.actorId,
    metadata: {
      action: 'viewer_removed', via: input.via, acted_as: access.basis,
      viewers: [{ id: removed.id, type: removed.principal_type, principal_id: removed.principal_id, name: removed.name }],
      message: `stopped sharing with ${viewerLabel(removed)}`,
    },
  })
  await audit(ctx, {
    objectType: 'task' as any, objectId: taskId, action: 'unshare',
    summary: `Stopped sharing "${title.slice(0, 120)}" with ${viewerLabel(removed).slice(0, 200)}`,
    metadata: { viewer: { type: removed.principal_type, id: removed.principal_id }, basis: access.basis, via: input.via },
  })
  return { task_id: taskId, removed }
}

/** Remove the invite naming this principal (REST / MCP convenience). */
export async function removeTaskViewerByPrincipal(ctx: ServiceContext, taskId: string, principal: { type: string; id: string }, input: { via: ViewerVia }) {
  const [p] = parseViewerPrincipals([principal])
  const db = await serviceRoleClient(ctx)
  const { data } = await (db as any).from('task_viewers').select('id')
    .eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('principal_type', p.type).eq('principal_id', p.id).maybeSingle()
  if (!data) {
    // Same answer as an unknown task for people who can't manage it.
    try {
      await authorizeViewerManagement(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
    } catch (error) { throw serviceError(error) }
    throw ServiceError.notFound('Invite not found')
  }
  return removeTaskViewer(ctx, taskId, String(data.id), input)
}

/** How many invites a task has (the "Shared with N" chip), for someone who can see it. */
export async function countTaskViewers(ctx: ServiceContext, taskId: string): Promise<number> {
  const { count } = await (getDb(ctx) as any).from('task_viewers').select('id', { count: 'exact', head: true }).eq('task_id', taskId)
  return count ?? 0
}

