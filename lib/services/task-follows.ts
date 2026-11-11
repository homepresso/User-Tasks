/**
 * Task tracker → Following: tasks a person follows (task_followers,
 * migration 20261226000000).
 *
 *  - Follow / unfollow (the bell on each tracker row and on the task page).
 *    Only a task the person can see: task_view_access — active member of
 *    its workspace and assignee, collaborator, team member of an unassigned
 *    team task, a manager of an assignee, the assigner, tasks.view_all or
 *    tasks.manage_queue. Anything else is "Task not found" (no probing).
 *  - followedTaskIds: which of a page of task ids I follow (one read per
 *    page, for the bells' state).
 *  - listFollowedTasks: my followed tasks in the tracker's row shape. The
 *    database re-checks visibility on every read (list_followed_tasks), so a
 *    task I can no longer see — or one that was deleted — drops out without
 *    leaking. Completed tasks stay until unfollowed (hideCompleted hides them).
 *
 * Personal: everything is the caller's own (ctx.actorId); a credential with
 * no user gets 403. Session callers run on their RLS client (the policies
 * enforce the same rules); API / MCP callers run on the service-role client
 * of their workspace with the same checks done here.
 */

import { getDb, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError } from './_shared'
import { enrichTrackerTasks, searchTrackerTasks, TRACKER_TASK_SELECT } from './task-tracker'

/* eslint-disable @typescript-eslint/no-explicit-any -- tracker rows are the joined task rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLOSED = ['completed', 'cancelled']
/** Most ids one followedTaskIds call checks (a tracker page is at most 100 rows). */
export const MAX_FOLLOW_ID_BATCH = 250

export interface FollowedTaskFilters {
  search?: string | null
  status?: string[] | null
  priority?: string[] | null
  /** Hide completed and cancelled tasks. */
  hideCompleted?: boolean
  /**
   * Also the tasks of the workflow runs I follow (run_followers: runs I
   * started or acted on), labelled with their run — the app's Following tab.
   * A task followed directly and through its run is listed once.
   */
  viaRuns?: boolean
  /** Only the tasks shared with me by an invite (the tracker's "Shared with me" filter). */
  sharedOnly?: boolean
}

interface SharedRow { task_id: string; tenant_id: string; status: string; viewer_id: string; principal_type: 'user' | 'team' | 'role'; principal_id: string; invited_by: string | null; shared_at: string }

/** What a tracker row shared with me says: "Shared with me · via Finance (team) · by Priya". */
export interface SharedWithMe { via: 'user' | 'team' | 'role'; name: string | null; invited_by: string | null; shared_at: string }

/**
 * Tasks shared with me by an invite (task_viewers: directly, through a team
 * I'm in or a role I hold — list_viewer_tasks). They show in Following
 * without a follow row of their own (team / role invites have none). Until
 * 20270105000000 is applied there are none.
 */
async function sharedTasks(ctx: ServiceContext, me: string, tenantId: string | null): Promise<SharedRow[]> {
  const { data, error } = await (getDb(ctx) as any).rpc('list_viewer_tasks', { p_user_id: me, p_tenant_id: tenantId })
  if (error) return []
  return ((data ?? []) as SharedRow[]).filter((row) => row && UUID_RE.test(String(row.task_id)))
}

async function sharedLabels(db: AnySupabaseClient, rows: SharedRow[]): Promise<Map<string, SharedWithMe>> {
  const of = (type: string) => Array.from(new Set(rows.filter((r) => r.principal_type === type).map((r) => String(r.principal_id))))
  const people = Array.from(new Set(rows.map((r) => r.invited_by).filter((id): id is string => Boolean(id))))
  const [teams, roles, users] = await Promise.all([
    of('team').length ? (db as any).from('teams').select('id, name').in('id', of('team')) : { data: [] },
    of('role').length ? (db as any).from('roles').select('id, name').in('id', of('role')) : { data: [] },
    people.length ? (db as any).from('users').select('id, display_name, email').in('id', people) : { data: [] },
  ])
  const name = new Map<string, string>([
    ...((teams.data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')] as [string, string]),
    ...((roles.data ?? []) as any[]).map((r) => [String(r.id), String(r.name ?? 'Role')] as [string, string]),
  ])
  const person = new Map(((users.data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
  return new Map(rows.map((r) => [String(r.task_id), {
    via: r.principal_type,
    name: r.principal_type === 'user' ? null : name.get(String(r.principal_id)) ?? null,
    invited_by: r.invited_by ? person.get(String(r.invited_by)) ?? null : null,
    shared_at: r.shared_at,
  }]))
}

interface RunTaskRow { task_id: string; tenant_id: string; run_id: string; status: string; run_status: string; workflow_id: string | null; followed_at: string }

/**
 * Tasks of the runs I follow that I may still see (list_followed_run_tasks:
 * can_view_run_progress), open ones of live runs unless includeClosed. Until
 * the migration is applied (no such function) there are none.
 */
async function followedRunTasks(ctx: ServiceContext, me: string, tenantId: string | null, includeClosed: boolean): Promise<RunTaskRow[]> {
  const { data, error } = await (getDb(ctx) as any).rpc('list_followed_run_tasks', { p_user_id: me, p_tenant_id: tenantId, p_include_closed: includeClosed })
  if (error) return []
  return ((data ?? []) as RunTaskRow[]).filter((row) => row && UUID_RE.test(String(row.task_id)))
}

function actor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Following is personal: use a credential bound to a user')
  return ctx.actorId
}

const isSession = (ctx: ServiceContext) => ctx.authKind === 'session'

/**
 * The workspace to list in: API / MCP callers act in their credential's
 * workspace; the signed-in UI in its current workspace (null = the unified
 * "All organizations" view, every member workspace).
 */
async function listTenant(ctx: ServiceContext, me: string): Promise<string | null> {
  if (!isSession(ctx)) return ctx.tenantId
  const { data } = await (getDb(ctx) as any).from('users').select('current_tenant_id').eq('id', me).maybeSingle()
  return (data as { current_tenant_id?: string | null } | null)?.current_tenant_id ?? null
}

/** The task (not deleted) if I can see it — else "Task not found". */
async function visibleTask(ctx: ServiceContext, db: AnySupabaseClient, taskId: string, me: string): Promise<{ id: string; tenant_id: string }> {
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  let query = (db as any).from('tasks').select('id, tenant_id').eq('id', taskId).is('deleted_at', null)
  // Session: RLS scopes the read (the unified view opens any member workspace's task).
  if (!isSession(ctx)) query = query.eq('tenant_id', ctx.tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Task not found')
  const { data: visible, error: accessError } = await (db as any).rpc('task_view_access', { p_task_id: taskId, p_user_id: me })
  if (accessError) throw dbError(accessError)
  if (visible !== true) throw ServiceError.notFound('Task not found')
  return { id: String(data.id), tenant_id: String(data.tenant_id) }
}

/** Follow (true) or unfollow (false) a task I can see. Idempotent. */
export async function setTaskFollowed(ctx: ServiceContext, taskId: string, follow: boolean): Promise<{ task_id: string; following: boolean }> {
  const me = actor(ctx)
  const db = getDb(ctx)
  if (!follow) {
    if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
    let query = (db as any).from('task_followers').delete().eq('user_id', me).eq('task_id', taskId)
    if (!isSession(ctx)) query = query.eq('tenant_id', ctx.tenantId)
    const { error } = await query
    if (error) throw dbError(error)
    return { task_id: taskId, following: false }
  }
  const task = await visibleTask(ctx, db, taskId, me)
  // tenant_id is set from the task by trigger; sent for clarity.
  const { error } = await (db as any).from('task_followers')
    .upsert({ tenant_id: task.tenant_id, user_id: me, task_id: task.id }, { onConflict: 'user_id,task_id', ignoreDuplicates: true })
  if (error) throw dbError(error)
  return { task_id: task.id, following: true }
}

/** Which of these tasks I follow (the bells' state for one page of rows). */
export async function followedTaskIds(ctx: ServiceContext, taskIds: string[]): Promise<string[]> {
  const me = actor(ctx)
  const ids = Array.from(new Set(taskIds.filter((id) => UUID_RE.test(id)))).slice(0, MAX_FOLLOW_ID_BATCH)
  if (!ids.length) return []
  let query = (getDb(ctx) as any).from('task_followers').select('task_id').eq('user_id', me).in('task_id', ids)
  if (!isSession(ctx)) query = query.eq('tenant_id', ctx.tenantId)
  const { data, error } = await query
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map((row) => String(row.task_id))
}

interface FollowRow { task_id: string; tenant_id: string; status: string; followed_at: string }

/** My follows whose task still exists and is visible to me (newest first). */
async function visibleFollows(ctx: ServiceContext, me: string): Promise<{ rows: FollowRow[]; tenantId: string | null }> {
  const tenantId = await listTenant(ctx, me)
  const { data, error } = await (getDb(ctx) as any).rpc('list_followed_tasks', { p_user_id: me, p_tenant_id: tenantId })
  if (error) throw dbError(error)
  return { rows: ((data ?? []) as FollowRow[]).filter((row) => row && UUID_RE.test(String(row.task_id))), tenantId }
}

/** Following tab badge: how many followed tasks I can see, and how many are still open (viaRuns: plus the open tasks of runs I follow; tasks shared with me always count). */
export async function countFollowedTasks(ctx: ServiceContext, options: { viaRuns?: boolean } = {}): Promise<{ total: number; open: number }> {
  const me = actor(ctx)
  const { rows, tenantId } = await visibleFollows(ctx, me)
  const status = new Map(rows.map((row) => [String(row.task_id), String(row.status)]))
  if (options.viaRuns) for (const row of await followedRunTasks(ctx, me, tenantId, false)) if (!status.has(String(row.task_id))) status.set(String(row.task_id), String(row.status))
  for (const row of await sharedTasks(ctx, me, tenantId)) if (!status.has(String(row.task_id))) status.set(String(row.task_id), String(row.status))
  const all = [...status.values()]
  return { total: all.length, open: all.filter((s) => !CLOSED.includes(s)).length }
}

/**
 * My followed tasks in the Task tracker's row shape (with followed_at),
 * filtered and searched like the tracker and sorted by due date (no due date
 * last), then most recently followed.
 */
export async function listFollowedTasks(ctx: ServiceContext, filters: FollowedTaskFilters = {}): Promise<any[]> {
  const me = actor(ctx)
  const { rows, tenantId } = await visibleFollows(ctx, me)
  const followedAt = new Map(rows.map((row) => [String(row.task_id), row.followed_at]))
  const ids = rows
    .filter((row) => !filters.hideCompleted || !CLOSED.includes(String(row.status)))
    .map((row) => String(row.task_id))
  // Through followed runs: only tasks not already followed directly (each task once).
  const viaRun = new Map<string, RunTaskRow>()
  if (filters.viaRuns) {
    const direct = new Set(ids)
    for (const row of await followedRunTasks(ctx, me, tenantId, !filters.hideCompleted)) {
      const taskId = String(row.task_id)
      if (direct.has(taskId) || viaRun.has(taskId)) continue
      viaRun.set(taskId, row)
      followedAt.set(taskId, row.followed_at)
      ids.push(taskId)
    }
  }
  // Shared with me (invites — directly, team or role): listed once, labelled.
  const shares = await sharedTasks(ctx, me, tenantId)
  const shared = await sharedLabels(getDb(ctx), shares)
  const listed = new Set(ids)
  for (const row of shares) {
    const taskId = String(row.task_id)
    if (listed.has(taskId) || (filters.hideCompleted && CLOSED.includes(String(row.status)))) continue
    listed.add(taskId)
    followedAt.set(taskId, row.shared_at)
    ids.push(taskId)
  }
  if (filters.sharedOnly) ids.splice(0, ids.length, ...ids.filter((taskId) => shared.has(taskId)))
  if (!ids.length) return []

  const db = getDb(ctx)
  const tasks: any[] = []
  // .in() lists stay well under URL limits in chunks.
  for (let i = 0; i < ids.length; i += 200) {
    let query = (db as any).from('tasks').select(TRACKER_TASK_SELECT).in('id', ids.slice(i, i + 200)).is('deleted_at', null)
    if (tenantId) query = query.eq('tenant_id', tenantId)
    if (filters.status?.length) query = query.in('status', filters.status)
    if (filters.priority?.length) query = query.in('priority', filters.priority)
    if (filters.hideCompleted) query = query.not('status', 'in', `(${CLOSED.join(',')})`)
    const { data, error } = await query
    if (error) throw dbError(error)
    tasks.push(...((data ?? []) as any[]))
  }

  const workflowNames = await runWorkflowNames(db, [...viaRun.values()])
  const enriched = (await enrichTrackerTasks(db, tasks, tenantId))
    .map((task) => {
      const run = viaRun.get(String(task.id))
      return {
        ...task,
        followed_at: followedAt.get(String(task.id)) ?? null,
        // Listed because I follow its run (not followed itself): "via {workflow} · {run}".
        followed_via_run: run ? { run_id: String(run.run_id), workflow_name: (run.workflow_id && workflowNames.get(String(run.workflow_id))) || 'Workflow', run_status: run.run_status } : null,
        // Shared with me by an invite (read only): who, and through which team / role.
        shared_with_me: shared.get(String(task.id)) ?? null,
      }
    })
  return searchTrackerTasks(enriched, filters.search).sort((a, b) => {
    const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
    const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
    if (dueA !== dueB) return dueA - dueB
    return String(b.followed_at ?? '').localeCompare(String(a.followed_at ?? ''))
  })
}

async function runWorkflowNames(db: AnySupabaseClient, rows: RunTaskRow[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((row) => row.workflow_id).filter((id): id is string => Boolean(id) && UUID_RE.test(String(id)))))
  if (!ids.length) return new Map()
  const { data } = await (db as any).from('workflows').select('id, name').in('id', ids)
  return new Map(((data ?? []) as any[]).map((w) => [String(w.id), String(w.name ?? 'Workflow')]))
}

/** API / MCP: one page of listFollowedTasks with the total. */
export async function pageFollowedTasks(ctx: ServiceContext, filters: FollowedTaskFilters, page: { limit: number | null; offset: number }): Promise<{ tasks: any[]; total: number }> {
  const all = await listFollowedTasks(ctx, filters)
  const end = page.limit == null ? undefined : page.offset + page.limit
  return { tasks: all.slice(page.offset, end), total: all.length }
}
