import { z } from 'zod'
import { getDb, hasPerm, type ServiceContext } from '../context'
import * as tasksService from '../tasks'
import { enrichTrackerTasks, searchTrackerTasks, TRACKER_TASK_SELECT } from '../task-tracker'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'
import { CLAIM_CANDIDATE_ROLE, displayStatus, matchesStatusFilter, queueActionFor, queuedFirst, storedStatusesFor } from '@/lib/tasks/unified-list'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/**
 * Tasks: list, detail (+ collaborators, effort log, dependencies), queue,
 * assigned-by-me, subtasks and the pickers the task screens use.
 */

const TASK_VIEW = ['tasks.view_own', 'tasks.view_all'] as const
// Subtasks expand inline in the task list and in the queue.
const TASK_OR_QUEUE_VIEW = ['tasks.view_own', 'tasks.view_all', 'tasks.manage_queue'] as const

const search = z.string().max(200)
const statusList = z.array(z.string().max(50)).max(20)
const column = z.string().regex(/^[a-z_]+$/).max(64)
const isoTime = z.iso.datetime()

// List columns (no deleted/scheduling internals); one joined query for the
// tenant badge and assignee/assigner names.
const TASK_LIST_COLUMNS = `
  id, tenant_id, parent_task_id, title, description, status, priority, sequence,
  assignee_id, assigner_id, due_date, started_at, completed_at,
  estimated_effort_assigner, estimated_effort_assignee, actual_effort, progress_pct,
  child_count, completed_child_count, allow_reassign, allow_escalate, allow_delegate,
  workflow_source_id, workflow_step_id, metadata, tags, created_at, updated_at,
  outcome, available_outcomes, acceptance_status, is_workflow_task, event_id, workflow_run_id,
  actioned_by, actioned_at,
  tenant:tenants(id, name, slug, branding),
  assignee:users!tasks_assignee_id_fkey(
    id, display_name, avatar_url
  ),
  assigner:users!tasks_assigner_id_fkey(
    id, display_name
  )
`

const QUEUE_COLUMNS = `*, tenant:tenants(id, name, slug, branding), assigner:users!tasks_assigner_id_fkey(id, display_name, avatar_url, email)`
const QUEUE_BUCKET_LIMIT = 100

/** The signed-in user's current workspace; null = unified "All organizations" view. */
async function currentTenantId(ctx: ServiceContext): Promise<string | null> {
  if (!ctx.actorId) return null
  const { data } = await (getDb(ctx) as any).from('users').select('current_tenant_id').eq('id', ctx.actorId).maybeSingle()
  return (data as { current_tenant_id?: string | null } | null)?.current_tenant_id ?? null
}

type TaskRef = { id: string; title: string; status: string }

function embeddedTask(row: any, key: string): TaskRef | null {
  const t = Array.isArray(row[key]) ? row[key][0] : row[key]
  return t ? { id: t.id, title: t.title, status: t.status } : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MINE_LIMIT = 250

/** The teams the user belongs to (user_teams, plus the legacy users.team_id), in this workspace when one is set. */
async function myTeamIds(db: any, userId: string, tenantId: string | null): Promise<string[]> {
  let memberships = db.from('user_teams').select('team_id, team:teams!inner(tenant_id)').eq('user_id', userId)
  if (tenantId) memberships = memberships.eq('team.tenant_id', tenantId)
  const [{ data: rows }, { data: profile }] = await Promise.all([
    memberships,
    db.from('users').select('team_id').eq('id', userId).maybeSingle(),
  ])
  const ids = new Set<string>(((rows ?? []) as any[]).map((m) => m.team_id).filter(Boolean))
  if (profile?.team_id) ids.add(profile.team_id)
  return [...ids].filter((t) => UUID_RE.test(t))
}

/**
 * The unified My tasks list (tasks.list with mine): the caller's tasks plus
 * their queued ones, display status derived (lib/tasks/unified-list.ts).
 */
async function listMine(ctx: ServiceContext, filters: {
  status?: string[]; priority?: string[]; tenantId?: string | null; dueBefore?: string; dueBy?: string
  search?: string; sortBy?: string; sortDir?: 'asc' | 'desc'
}): Promise<any[]> {
  const userId = ctx.actorId
  if (!userId) return []
  const db = getDb(ctx) as any
  const tenantId = filters.tenantId ?? await currentTenantId(ctx)

  let collab = db.from('task_assignees').select('task_id, role').eq('user_id', userId).eq('acceptance_status', 'pending').limit(500)
  if (tenantId) collab = collab.eq('tenant_id', tenantId)
  const [teams, { data: collabRows }] = await Promise.all([myTeamIds(db, userId, tenantId), collab])
  const pendingRows = ((collabRows ?? []) as any[]).filter((r) => typeof r.task_id === 'string' && UUID_RE.test(r.task_id))
  const collabIds: string[] = pendingRows.map((r) => r.task_id)
  // AAD group claim candidates: Claim rather than Accept (lib/tasks/unified-list.ts).
  const candidateIds: string[] = pendingRows.filter((r) => r.role === CLAIM_CANDIDATE_ROLE).map((r) => r.task_id)

  const parts = [`assignee_id.eq.${userId}`]
  if (teams.length) parts.push(`and(assignee_id.is.null,assigned_team_id.in.(${teams.join(',')}))`)
  if (collabIds.length) parts.push(`id.in.(${collabIds.join(',')})`)

  let q = db
    .from('tasks')
    .select(`${TASK_LIST_COLUMNS}, assigned_team_id, assignment_mode`)
    .is('parent_task_id', null)
    .is('deleted_at', null)
    .or(parts.join(','))

  const stored = storedStatusesFor(filters.status)
  if (stored) q = q.in('status', stored)
  if (filters.priority?.length) q = q.in('priority', filters.priority)
  if (tenantId) q = q.eq('tenant_id', tenantId)
  if (filters.search) q = q.ilike('title', `%${filters.search}%`)
  if (filters.dueBefore) q = q.lt('due_date', filters.dueBefore)
  if (filters.dueBy) q = q.lte('due_date', filters.dueBy)

  const sortBy = filters.sortBy === 'sequence' ? 'sequence' : (filters.sortBy ?? 'due_date')
  q = q.order(sortBy, { ascending: filters.sortDir !== 'desc', nullsFirst: false }).order('id')

  const rows = (check(await q.limit(MINE_LIMIT)) ?? []) as any[]
  const scope = { userId, teamIds: new Set(teams), collabPendingIds: new Set(collabIds), claimCandidateIds: new Set(candidateIds) }
  const shaped = rows
    .map((row) => {
      const action = queueActionFor(row, scope)
      return { ...row, display_status: displayStatus(row, action), queue_action: action }
    })
    .filter((row) => matchesStatusFilter(row.display_status, filters.status))
  // Default order (due date): what waits for a response surfaces first.
  return sortBy === 'due_date' && filters.sortDir !== 'desc' ? queuedFirst(shaped) : shaped
}

export const reads = {
  /**
   * Top-level task list (50 rows). Due-range cutoffs come from the browser
   * (its local day/week/month); the current workspace filter is resolved here.
   */
  'tasks.list': defineRead({
    args: z.object({
      status: statusList.optional(),
      priority: statusList.optional(),
      tenantId: id.nullish(),
      dueBefore: isoTime.optional(),
      dueBy: isoTime.optional(),
      assigneeId: id.nullish(),
      search: search.optional(),
      sortBy: column.optional(),
      sortDir: z.enum(['asc', 'desc']).optional(),
      /**
       * The unified My tasks list: everything assigned to the caller plus
       * what waits for their response (pending acceptance, pending
       * collaborations, their teams' unclaimed tasks), each row with
       * display_status ('queued' while it waits) and queue_action.
       * The status filter then matches display statuses ('queued' included).
       */
      mine: z.boolean().optional(),
    }),
    perm: TASK_VIEW,
    run: async (ctx, filters) => {
      if (filters.mine) return listMine(ctx, filters)
      // RLS already limits tasks to the current workspace when one is set;
      // the explicit filter lets the planner use idx_tasks_tenant_created.
      // No current tenant = unified view: RLS spans every member tenant.
      const tenantId = filters.tenantId ?? await currentTenantId(ctx)

      let q = (getDb(ctx) as any)
        .from('tasks')
        .select(TASK_LIST_COLUMNS)
        .is('parent_task_id', null)
        .is('deleted_at', null)
        .neq('acceptance_status', 'pending')

      if (filters.status?.length) q = q.in('status', filters.status)
      if (filters.priority?.length) q = q.in('priority', filters.priority)
      if (tenantId) q = q.eq('tenant_id', tenantId)
      if (filters.search) q = q.ilike('title', `%${filters.search}%`)
      if (filters.assigneeId) q = q.eq('assignee_id', filters.assigneeId)
      if (filters.dueBefore) q = q.lt('due_date', filters.dueBefore)
      if (filters.dueBy) q = q.lte('due_date', filters.dueBy)

      const sortBy = filters.sortBy === 'sequence' ? 'sequence' : (filters.sortBy ?? 'due_date')
      q = q.order(sortBy, { ascending: filters.sortDir !== 'desc', nullsFirst: false })

      return (check(await q.limit(50)) ?? []) as any[]
    },
  }),

  /** Task detail: the tree (RPC) plus tenant badge, assignee/assigner names and workflow source. */
  'tasks.detail': defineRead({
    args: z.object({ id }),
    perm: TASK_VIEW,
    run: async (ctx, { id }) => {
      const tree = await tasksService.getTaskTree(ctx, id)
      if (!tree) return null
      const treeData = tree as any
      const db = getDb(ctx) as any
      const task = treeData.task
      const [tenantResult, assigneeResult, assignerResult, wsResult] = await Promise.all([
        db.from('tenants').select('id, name, slug, branding').eq('id', task.tenant_id).maybeSingle(),
        task.assignee_id
          ? db.from('users').select('display_name').eq('id', task.assignee_id).maybeSingle()
          : Promise.resolve({ data: null }),
        task.assigner_id
          ? db.from('users').select('display_name').eq('id', task.assigner_id).maybeSingle()
          : Promise.resolve({ data: null }),
        task.workflow_source_id
          ? db.from('workflow_sources').select('engine_type, display_name').eq('id', task.workflow_source_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      return {
        treeData,
        tenant: tenantResult.data as any,
        assigneeName: (assigneeResult.data?.display_name ?? null) as string | null,
        assignerName: (assignerResult.data?.display_name ?? null) as string | null,
        workflowSource: wsResult.data as any,
      }
    },
  }),

  'tasks.collaborators': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const { data } = await (getDb(ctx) as any)
        .from('task_assignees')
        .select('*, user:users(id, display_name, avatar_url, email)')
        .eq('task_id', taskId)
        .order('created_at')
      return (data ?? []) as any[]
    },
  }),

  /** Latest 20 actual/timer effort entries (effort box log). */
  'tasks.effortEntries': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const { data } = await (getDb(ctx) as any)
        .from('effort_records')
        .select('*, user:users(display_name)')
        .eq('task_id', taskId)
        .in('record_type', ['actual', 'timer_entry'])
        .order('created_at', { ascending: false })
        .limit(20)
      return (data ?? []) as any[]
    },
  }),

  /** Blocking dependencies in both directions. */
  'tasks.dependencies': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const db = getDb(ctx) as any
      const [{ data: up }, { data: down }] = await Promise.all([
        db.from('task_dependencies')
          .select('depends_on_task_id, blocker:tasks!task_dependencies_depends_on_task_id_fkey(id, title, status)')
          .eq('task_id', taskId),
        db.from('task_dependencies')
          .select('task_id, blocked:tasks!task_dependencies_task_id_fkey(id, title, status)')
          .eq('depends_on_task_id', taskId),
      ])
      return {
        blockedBy: ((up ?? []) as any[]).map((r) => embeddedTask(r, 'blocker')).filter(Boolean) as TaskRef[],
        blocks: ((down ?? []) as any[]).map((r) => embeddedTask(r, 'blocked')).filter(Boolean) as TaskRef[],
      }
    },
  }),

  /** Open blockers of a task (completion dialog's warn-with-override). */
  'tasks.openBlockers': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const { data } = await (getDb(ctx) as any)
        .from('task_dependencies')
        .select('blocker:tasks!task_dependencies_depends_on_task_id_fkey(id, title, status)')
        .eq('task_id', taskId)
      return ((data ?? []) as any[])
        .map((r) => embeddedTask(r, 'blocker'))
        .filter((t): t is TaskRef => !!t && !['completed', 'cancelled'].includes(t.status))
        .map((t) => ({ id: t.id, title: t.title }))
    },
  }),

  /** Open tasks to link as a dependency (picker, 8 newest matching). */
  'tasks.dependencyCandidates': defineRead({
    args: z.object({ excludeTaskId: id, search: search.optional() }),
    perm: TASK_VIEW,
    run: async (ctx, { excludeTaskId, search }) => {
      let q = (getDb(ctx) as any)
        .from('tasks')
        .select('id, title, status')
        .neq('id', excludeTaskId)
        .is('deleted_at', null)
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: false })
        .limit(8)
      if (search?.trim()) q = q.ilike('title', `%${search.trim()}%`)
      const { data } = await q
      return ((data ?? []) as any[]).map((t) => ({ id: t.id as string, label: t.title as string }))
    },
  }),

  'tasks.subtasks': defineRead({
    args: z.object({ parentTaskId: id }),
    perm: TASK_OR_QUEUE_VIEW,
    run: async (ctx, { parentTaskId }) => (check(await (getDb(ctx) as any)
      .from('tasks')
      .select('id, title, status, priority, due_date, sequence')
      .eq('parent_task_id', parentTaskId)
      .is('deleted_at', null)
      .order('sequence', { ascending: true })
      .limit(51)) ?? []) as any[],
  }),

  /**
   * The signed-in user's queue: pending acceptance (direct + collaborative),
   * open workflow tasks for them and for their team. Overdue first.
   *
   * @deprecated The app no longer uses it: My tasks (tasks.list with mine)
   * shows these tasks with status Queued. Kept for existing callers.
   */
  'tasks.queue': defineRead({
    args: NO_ARGS,
    perm: 'tasks.manage_queue',
    run: async (ctx) => {
      const userId = ctx.actorId
      if (!userId) return { tasks: [] as any[], hasMore: false }
      const db = getDb(ctx) as any

      const { data: profile } = await db.from('users').select('team_id').eq('id', userId).maybeSingle()
      const teamId = profile?.team_id

      const queries = [
        // Direct pending acceptance
        db.from('tasks').select(QUEUE_COLUMNS)
          .eq('assignee_id', userId).eq('acceptance_status', 'pending')
          .is('parent_task_id', null).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(QUEUE_BUCKET_LIMIT),
        // Collab pending
        db.from('task_assignees').select('task_id')
          .eq('user_id', userId).eq('acceptance_status', 'pending')
          .limit(QUEUE_BUCKET_LIMIT),
        // Workflow tasks assigned to user (todo/in_progress, not yet accepted for later)
        db.from('tasks').select(QUEUE_COLUMNS)
          .eq('assignee_id', userId).eq('is_workflow_task', true)
          .in('status', ['todo', 'in_progress'])
          .neq('acceptance_status', 'accepted')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(QUEUE_BUCKET_LIMIT),
      ]
      // Team tasks (workflow tasks assigned to user's team)
      if (teamId) {
        queries.push(
          db.from('tasks').select(QUEUE_COLUMNS)
            .eq('assigned_team_id', teamId).eq('is_workflow_task', true)
            .in('status', ['todo', 'in_progress'])
            .neq('acceptance_status', 'accepted')
            .is('deleted_at', null)
            .order('created_at', { ascending: false }).limit(QUEUE_BUCKET_LIMIT),
        )
      }

      const results = await Promise.all(queries)
      const [directResult, collabResult, workflowResult, teamResult] = results

      // Surface truncation instead of silently dropping overflow.
      const hasMore = results.some((result: any) => (result?.data?.length ?? 0) >= QUEUE_BUCKET_LIMIT)

      const tasks: any[] = directResult.data ?? []
      const seen = new Set(tasks.map((t: any) => t.id))
      for (const t of (workflowResult.data ?? [])) {
        if (!seen.has(t.id)) { tasks.push(t); seen.add(t.id) }
      }
      for (const t of (teamResult?.data ?? [])) {
        if (!seen.has(t.id)) { tasks.push(t); seen.add(t.id) }
      }
      const collabIds = (collabResult.data ?? []).map((a: any) => a.task_id).filter((taskId: string) => !seen.has(taskId))
      if (collabIds.length > 0) {
        const { data } = await db.from('tasks').select(QUEUE_COLUMNS).in('id', collabIds).is('deleted_at', null)
        for (const t of data ?? []) { if (!seen.has(t.id)) { tasks.push(t); seen.add(t.id) } }
      }

      // Overdue first, then newest.
      const now = new Date()
      tasks.sort((a: any, b: any) => {
        const aOverdue = a.due_date && new Date(a.due_date) < now && a.status !== 'completed'
        const bOverdue = b.due_date && new Date(b.due_date) < now && b.status !== 'completed'
        if (aOverdue && !bOverdue) return -1
        if (!aOverdue && bOverdue) return 1
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })

      return { tasks, hasMore }
    },
  }),

  /**
   * Tasks the signed-in user assigned to others (or their team members'),
   * with subtasks, recent activity, collaborators and each assignee's queue
   * rank. Search runs here over the enriched rows.
   */
  'tasks.assigned': defineRead({
    args: z.object({
      status: statusList.optional(),
      priority: statusList.optional(),
      search: search.optional(),
      sortBy: column.optional(),
      scope: z.enum(['assigned_by_me', 'team_members', 'all']).optional(),
      teamId: id.optional(),
    }),
    perm: 'tasks.view_all',
    run: async (ctx, filters) => {
      const userId = ctx.actorId
      if (!userId) return [] as any[]
      const db = getDb(ctx) as any
      const tenantId = await currentTenantId(ctx)
      const scope = filters.scope ?? 'assigned_by_me'

      let q = db
        .from('tasks')
        .select(TRACKER_TASK_SELECT)
        .is('parent_task_id', null)
        .is('deleted_at', null)
      // Same rows as RLS (current workspace) but index-friendly; unified view
      // (no current tenant) keeps spanning every member tenant.
      if (tenantId) q = q.eq('tenant_id', tenantId)

      if (scope === 'assigned_by_me') {
        q = q.eq('assigner_id', userId).neq('assignee_id', userId)
      } else if (scope === 'team_members') {
        let memberIds: string[] = []
        if (filters.teamId) {
          const { data: memberships } = await db.from('user_teams').select('user_id').eq('team_id', filters.teamId)
          memberIds = (memberships ?? []).map((row: any) => row.user_id).filter(Boolean)
        } else {
          const { data: myTeams } = await db.from('user_teams').select('team_id').eq('user_id', userId)
          const teamIds = (myTeams ?? []).map((row: any) => row.team_id).filter(Boolean)
          if (teamIds.length > 0) {
            const { data: memberships } = await db.from('user_teams').select('user_id').in('team_id', teamIds)
            memberIds = (memberships ?? []).map((row: any) => row.user_id).filter(Boolean)
          }
        }
        memberIds = Array.from(new Set(memberIds.filter((memberId) => memberId !== userId)))
        if (memberIds.length === 0) return []
        q = q.in('assignee_id', memberIds)
      }

      if (filters.status?.length) q = q.in('status', filters.status)
      if (filters.priority?.length) q = q.in('priority', filters.priority)
      q = q.order(filters.sortBy ?? 'due_date', { ascending: true, nullsFirst: false })

      const { data: tasks, error } = await q.limit(250)
      if (error || !tasks) return []
      const taskIds = (tasks as any[]).map((t) => t.id)
      if (taskIds.length === 0) return []

      return searchTrackerTasks(await enrichTrackerTasks(db, tasks as any[], tenantId), filters.search)
    },
  }),

  /** Teams picker (assignee picker, assigned-tasks team filter). */
  /** My team (manager view): open tasks of the caller's reports with workload counts. */
  'tasks.reports': defineRead({
    args: z.object({
      indirect: z.boolean().optional(),
      person: z.string().max(200).nullable().optional(),
      status: z.array(z.string().max(40)).max(10).optional(),
      priority: z.array(z.string().max(40)).max(10).optional(),
      workflowId: z.string().max(200).nullable().optional(),
      overdue: z.boolean().optional(),
      slaBreached: z.boolean().optional(),
      /** Show completed: closed tasks too (workload counts stay open tasks). */
      includeClosed: z.boolean().optional(),
      /** Reporting-line view: someone in my subtree (or anyone with tasks.view_all) as the root. */
      root: id.nullish(),
      search: z.string().max(200).optional(),
    }).optional(),
    run: async (ctx, args) => {
      const { listReportTasks } = await import('../manager-tasks')
      return listReportTasks(ctx, {
        indirect: args?.indirect, person: args?.person ?? null, status: args?.status ?? null, priority: args?.priority ?? null,
        workflow_id: args?.workflowId ?? null, overdue: args?.overdue, sla_breached: args?.slaBreached, include_closed: args?.includeClosed,
        root_user_id: args?.root ?? null, search: args?.search ?? null,
      })
    },
  }),

  /**
   * The reporting-line view (My team / Task tracker Team members): the
   * caller's org tree with open task counts per person (own and rolled up).
   * Own subtree; another root needs tasks.view_all or to be in it.
   */
  'tasks.teamHierarchy': defineRead({
    args: z.object({ root: id.nullish(), search: z.string().max(200).optional() }).optional(),
    perm: TASK_VIEW,
    run: async (ctx, args) => (await import('../team-hierarchy')).getTeamHierarchy(ctx, { root: args?.root ?? null, search: args?.search ?? null }),
  }),

  /** People (active members) and teams a task can be assigned to (Take ownership / Assign to… / Active tasks). */
  'tasks.assignTargets': defineRead({
    args: NO_ARGS,
    perm: TASK_OR_QUEUE_VIEW,
    run: async (ctx) => {
      const [{ serviceRoleClient }] = await Promise.all([import('../_shared')])
      const db = await serviceRoleClient(ctx) as any
      const [members, teams] = await Promise.all([
        db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).limit(2000),
        db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(500),
      ])
      const ids = ((members.data ?? []) as any[]).map((m) => String(m.user_id))
      const { data: users } = ids.length ? await db.from('users').select('id, display_name, email').in('id', ids).is('deleted_at', null) : { data: [] }
      return {
        users: ((users ?? []) as any[]).map((u) => ({ id: String(u.id), name: String(u.display_name || u.email || 'Someone'), email: u.email ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        teams: ((teams.data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name ?? 'Team') })),
      }
    },
  }),

  /** Task screen: may the signed-in user action this task (assignee, on behalf, or not)? */
  'tasks.actAccess': defineRead({
    args: z.object({ taskId: id }),
    run: async (ctx, { taskId }) => {
      if (!ctx.actorId) return null
      // The task's own workspace (the unified view opens any of the user's tenants).
      const { data: visible } = await (getDb(ctx) as any).from('tasks').select('tenant_id').eq('id', taskId).maybeSingle()
      if (!visible) return null
      const [{ serviceRoleClient }, { describeTaskAccess }] = await Promise.all([import('../_shared'), import('@/lib/task-authz')])
      const db = await serviceRoleClient(ctx)
      return describeTaskAccess(db, { tenantId: String(visible.tenant_id), taskId, actorId: ctx.actorId, permissions: ctx.permissions })
    },
  }),

  /**
   * Quick actions on the task lists (lib/tasks/quick-actions.ts): which
   * actions the signed-in user may take on this task from the list —
   * outcomes or "Open form", hold / resume, redirect, invite, escalate —
   * mirroring the server rules. Null when the task isn't visible.
   */
  'tasks.quickActions': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      if (!ctx.actorId) return null
      const actorId = ctx.actorId
      const { data: task } = await (getDb(ctx) as any).from('tasks')
        .select('id, tenant_id, title, status, assignee_id, assigned_team_id, assignment_mode, acceptance_status, allow_reassign, allow_escalate, available_outcomes, is_workflow_task, event_id, workflow_run_id, metadata')
        .eq('id', taskId).is('deleted_at', null).maybeSingle()
      if (!task) return null
      const tenantId = String(task.tenant_id)
      const [{ serviceRoleClient }, { describeTaskAccess }, { taskQuickActions }] = await Promise.all([
        import('../_shared'), import('@/lib/task-authz'), import('@/lib/tasks/quick-actions'),
      ])
      const db = await serviceRoleClient(ctx) as any
      const has = (key: string) => ctx.permissions === null || ctx.permissions.has(key)
      const [access, assigneesResult, membershipResult] = await Promise.all([
        describeTaskAccess(db, { tenantId, taskId, actorId, permissions: ctx.permissions }),
        db.from('task_assignees').select('user_id, acceptance_status').eq('tenant_id', tenantId).eq('task_id', taskId),
        db.from('user_memberships').select('manager_user_id').eq('tenant_id', tenantId).eq('user_id', actorId).eq('is_active', true).maybeSingle(),
      ])
      const assignees = (assigneesResult.data ?? []) as Array<{ user_id: string; acceptance_status: string | null }>
      const mine = assignees.find((row) => String(row.user_id) === actorId) ?? null
      const participants = new Set([...(task.assignee_id ? [String(task.assignee_id)] : []), ...assignees.map((row) => String(row.user_id))])
      const managerId = membershipResult.data?.manager_user_id ? String(membershipResult.data.manager_user_id) : null
      let manager: { id: string; name: string } | null = null
      if (managerId) {
        const { data: person } = await db.from('users').select('id, display_name, email').eq('id', managerId).maybeSingle()
        if (person) manager = { id: String(person.id), name: String(person.display_name || person.email || 'Your manager') }
      }
      return taskQuickActions(task, {
        actorId,
        canComplete: has('tasks.complete'),
        canViewRuns: has('workflows.view_runs'),
        mode: access?.mode ?? null,
        collaborator: mine ? { acceptance_status: mine.acceptance_status ?? null } : null,
        participantCount: participants.size,
        manager,
      })
    },
  }),

  /**
   * The task lists' detail panel (Task tracker, My team, My tasks, Home):
   * summary, effort, subtasks, latest comment, attachments count, links and
   * what the person may change (lib/services/task-panel.ts). Read when a row
   * opens; null unless the person can reach the task.
   */
  'tasks.panel': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => (await import('../task-panel')).getTaskPanel(ctx, taskId),
  }),

  /** The signed-in user's own task queue rules (version 2; older shapes migrated) and time zone. */
  'tasks.myQueueRules': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      if (!ctx.actorId) return null
      const { data } = await (getDb(ctx) as any).from('users').select('preferences, timezone').eq('id', ctx.actorId).maybeSingle()
      const { resolveQueueRules } = await import('@/lib/tasks/queue-rules')
      const prefs = (data?.preferences ?? null) as Record<string, unknown> | null
      return {
        rules: resolveQueueRules(prefs),
        /** Saved rules (else the legacy threshold, shown as rules). */
        saved: Boolean(prefs && prefs.queue_rules),
        timeZone: (data?.timezone ?? null) as string | null,
      }
    },
  }),

  /** Picker options for the queue rules editor: workflows, forms, people, teams, org units, projects (what RLS shows). */
  'tasks.queueRuleOptions': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const pick = async (table: string, label = 'name') => {
        try {
          const { data } = await db.from(table).select(`id, ${label}`).order(label).limit(1000)
          return ((data ?? []) as any[]).map((r) => ({ id: String(r.id), label: String(r[label] ?? r.id) }))
        } catch { return [] as Array<{ id: string; label: string }> }
      }
      // Workflow / form names are build-area data: people without workflows.view /
      // forms.view only get the workflows behind tasks they were given (and no forms).
      const myWorkflows = async () => {
        if (hasPerm(ctx, 'workflows.view')) return pick('workflows')
        if (!ctx.actorId) return [] as Array<{ id: string; label: string }>
        const { data: mine } = await db.from('tasks').select('workflow_id').eq('assignee_id', ctx.actorId).not('workflow_id', 'is', null).limit(1000)
        const ids = [...new Set(((mine ?? []) as any[]).map((r) => String(r.workflow_id)))]
        if (!ids.length) return [] as Array<{ id: string; label: string }>
        const { data } = await db.from('workflows').select('id, name').in('id', ids).order('name')
        return ((data ?? []) as any[]).map((r) => ({ id: String(r.id), label: String(r.name ?? r.id) }))
      }
      const [workflows, forms, teams, units, projects, users] = await Promise.all([
        myWorkflows(), hasPerm(ctx, 'forms.view') ? pick('forms') : Promise.resolve([] as Array<{ id: string; label: string }>),
        pick('teams'), pick('org_units'), pick('projects'),
        db.from('users').select('id, display_name, email').order('display_name').limit(2000).then((r: any) => r.data ?? [], () => []),
      ])
      return {
        workflows, forms, teams, units, projects,
        people: (users as any[]).map((u) => ({ id: String(u.id), label: String(u.display_name || u.email || u.id) })),
      }
    },
  }),

  /**
   * "Test a task" in the queue rules editor: the decision the given (draft)
   * rules make for a sample task assigned to the signed-in user, and which
   * rule made it — with the real org context (manager chain, reports, the
   * sample assigner's teams / units / projects) in the current workspace.
   */
  'tasks.queueRulesPreview': defineRead({
    args: z.object({
      rules: z.unknown(),
      facts: z.object({
        priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional(),
        source: z.enum(['workflow', 'manual']).optional(),
        origins: z.array(z.string().max(40)).max(20).optional(),
        workflow_id: id.nullable().optional(),
        form_id: id.nullable().optional(),
        assigned_by_user_id: id.nullable().optional(),
        assignment: z.enum(['individual', 'team', 'aad_group', 'collaborative']).optional(),
        assigned_team_id: id.nullable().optional(),
        due_date: z.string().max(40).nullable().optional(),
        title: z.string().max(500).optional(),
        description: z.string().max(5000).optional(),
        has_attachments: z.boolean().optional(),
        is_subtask: z.boolean().optional(),
        tags: z.array(z.string().max(100)).max(50).optional(),
        now: z.string().max(40).optional(),
      }).strict(),
    }),
    run: async (ctx, { rules, facts }) => {
      if (!ctx.actorId) return null
      const actorId = ctx.actorId
      const { parseQueueRules, explainQueueRules, queueRulesOrgNeeds } = await import('@/lib/tasks/queue-rules')
      const parsed = parseQueueRules(rules)
      if (!parsed.ok) return { ok: false as const, error: parsed.error }
      const tenantId = (await currentTenantId(ctx)) ?? ctx.tenantId ?? null
      const needs = queueRulesOrgNeeds(parsed.value)
      let org = null
      if (needs.reporting || needs.teams || needs.units || needs.projects) {
        const [{ serviceRoleClient }, { loadQueueOrgContexts }] = await Promise.all([import('../_shared'), import('@/lib/tasks/queue-rules-server')])
        const db = await serviceRoleClient(ctx)
        org = (await loadQueueOrgContexts(db, { tenantId, assignerId: facts.assigned_by_user_id ?? null, assigneeIds: [actorId], needs }))?.get(actorId) ?? null
      }
      const { data: me } = await (getDb(ctx) as any).from('users').select('timezone').eq('id', actorId).maybeSingle()
      const nowMs = facts.now ? Date.parse(facts.now) : NaN
      const result = explainQueueRules(parsed.value, {
        ...facts,
        source: facts.source ?? (facts.origins?.includes('workflow') ? 'workflow' : 'manual'),
        assigned_by_user_id: facts.assigned_by_user_id ?? null,
        now: Number.isFinite(nowMs) ? nowMs : undefined,
      }, { assigneeId: actorId, org, timeZone: me?.timezone ?? null })
      return { ok: true as const, decision: result.decision, ruleIndex: result.ruleIndex, ruleName: result.rule?.name ?? null }
    },
  }),

  /** Is the signed-in user a manager here (has a direct report)? Shows "My team". */
  'tasks.isManager': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const { isManager } = await import('../manager-tasks')
      return isManager(ctx)
    },
  }),

  'tasks.teams': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('teams').select('id, name').order('name')
      return (data ?? []) as Array<{ id: string; name: string }>
    },
  }),

  /** A team's members as users (assignee picker). */
  'tasks.teamMembers': defineRead({
    args: z.object({ teamId: id }),
    run: async (ctx, { teamId }) => {
      const { data } = await (getDb(ctx) as any)
        .from('user_teams')
        .select('user_id, user:users(id, display_name, email, avatar_url)')
        .eq('team_id', teamId)
      return ((data ?? []) as any[]).map((d) => d.user).filter(Boolean) as any[]
    },
  }),

  /** Users picker for redirecting a task. */
  'tasks.redirectUsers': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('users').select('id, display_name, email').order('display_name')
      return (data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>
    },
  }),

  /** The signed-in user's name and avatar (optimistic timeline comment). */
  'tasks.myProfile': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      if (!ctx.actorId) return null
      const { data } = await (getDb(ctx) as any).from('users').select('display_name, avatar_url').eq('id', ctx.actorId).maybeSingle()
      return data as { display_name: string | null; avatar_url: string | null } | null
    },
  }),

  /** The Task completed screen's workspace settings (any member; `taskId`: that task's workspace). */
  'tasks.completionSettings': defineRead({
    args: z.object({ taskId: id.optional() }).optional(),
    run: async (ctx, args) => {
      const svc = await import('../task-completion-screen')
      return svc.getTaskCompletionSettings(args?.taskId ? await svc.contextForTask(ctx, args.taskId) : ctx)
    },
  }),

  /** The Task completed screen after actioning a task: settings, what happens next, the next task (polled while processing). */
  'tasks.completedScreen': defineRead({
    args: z.object({ taskId: id }),
    perm: TASK_VIEW,
    run: async (ctx, { taskId }) => {
      const svc = await import('../task-completion-screen')
      return svc.getTaskCompletedScreen(await svc.contextForTask(ctx, taskId), taskId)
    },
  }),
} satisfies Record<string, UiRead<any, any>>
