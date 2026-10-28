import { z } from 'zod'
import { getDb, type ServiceContext } from '../context'
import * as tasksService from '../tasks'
import { htmlToPlainText } from '@/lib/html-sanitize'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'

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
  outcome, available_outcomes, acceptance_status, is_workflow_task, event_id,
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

function priorityWeight(priority: string | null | undefined) {
  switch (priority) {
    case 'critical': return 4
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

function normalizeSearch(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

type TaskRef = { id: string; title: string; status: string }

function embeddedTask(row: any, key: string): TaskRef | null {
  const t = Array.isArray(row[key]) ? row[key][0] : row[key]
  return t ? { id: t.id, title: t.title, status: t.status } : null
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
    }),
    perm: TASK_VIEW,
    run: async (ctx, filters) => {
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
        .select(`
          *,
          tenant:tenants(id, name, slug, branding),
          assignee:users!tasks_assignee_id_fkey(id, display_name, avatar_url, email),
          assigner:users!tasks_assigner_id_fkey(id, display_name, email),
          assigned_team:teams!tasks_assigned_team_id_fkey(id, name),
          workflow_source:workflow_sources(id, display_name, engine_type)
        `)
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

      const { data: subtasks } = await db
        .from('tasks')
        .select('id, parent_task_id, title, status, priority, due_date, assignee_id')
        .in('parent_task_id', taskIds)
        .is('deleted_at', null)
        .order('sequence', { ascending: true })

      const subtaskMap: Record<string, any[]> = {}
      for (const st of subtasks ?? []) {
        const pid = st.parent_task_id as string
        if (!pid) continue
        ;(subtaskMap[pid] ??= []).push(st)
      }

      const [activityResult, collaboratorResult] = await Promise.all([
        db.from('lifecycle_events')
          .select('id, task_id, event_type, created_at, metadata, actor:users!lifecycle_events_actor_id_fkey(id, display_name)')
          .in('task_id', taskIds)
          .order('created_at', { ascending: false })
          .limit(Math.max(taskIds.length * 4, 20)),
        db.from('task_assignees')
          .select('id, task_id, user_id, role, acceptance_status, accepted_at, user:users(id, display_name, email)')
          .in('task_id', taskIds),
      ])

      const activityByTask: Record<string, any[]> = {}
      for (const event of activityResult.data ?? []) {
        const list = (activityByTask[event.task_id] ??= [])
        if (list.length < 5) list.push(event)
      }

      const collaboratorByTask: Record<string, any[]> = {}
      for (const row of collaboratorResult.data ?? []) {
        (collaboratorByTask[row.task_id] ??= []).push(row)
      }

      const assigneeIds = Array.from(new Set((tasks as any[]).map((task) => task.assignee_id).filter(Boolean)))
      const assigneeRankMap: Record<string, { position: number; total: number }> = {}
      if (assigneeIds.length > 0) {
        const { data: assigneeTasks } = await db
          .from('tasks')
          .select('id, assignee_id, sequence, priority, due_date, created_at, status')
          .in('assignee_id', assigneeIds)
          .is('parent_task_id', null)
          .is('deleted_at', null)
          .not('status', 'in', '(completed,cancelled)')

        const byAssignee: Record<string, any[]> = {}
        for (const task of assigneeTasks ?? []) {
          if (!task.assignee_id) continue
          ;(byAssignee[task.assignee_id] ??= []).push(task)
        }
        for (const rows of Object.values(byAssignee)) {
          rows.sort((a: any, b: any) => {
            const seqA = a.sequence == null ? Number.MAX_SAFE_INTEGER : Number(a.sequence)
            const seqB = b.sequence == null ? Number.MAX_SAFE_INTEGER : Number(b.sequence)
            if (seqA !== seqB) return seqA - seqB
            const prio = priorityWeight(b.priority) - priorityWeight(a.priority)
            if (prio !== 0) return prio
            const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
            const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
            if (dueA !== dueB) return dueA - dueB
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })
          rows.forEach((task: any, index: number) => {
            assigneeRankMap[task.id] = { position: index + 1, total: rows.length }
          })
        }
      }

      const enrichedTasks = (tasks as any[]).map((task) => {
        const subs = subtaskMap[task.id] ?? []
        const completedSubs = subs.filter((s) => s.status === 'completed')
        const collaborators = collaboratorByTask[task.id] ?? []
        const acceptanceSummary = collaborators.length > 0
          ? {
              pending: collaborators.filter((row: any) => row.acceptance_status === 'pending').length,
              accepted: collaborators.filter((row: any) => row.acceptance_status === 'accepted').length,
              held: collaborators.filter((row: any) => row.acceptance_status === 'held').length,
              rejected: collaborators.filter((row: any) => row.acceptance_status === 'rejected').length,
            }
          : null
        const progressPct = subs.length > 0
          ? Math.round((completedSubs.length / subs.length) * 100)
          : task.status === 'completed' ? 100 : 0

        return {
          ...task,
          subtasks: subs,
          recent_activity: activityByTask[task.id] ?? [],
          collaborators,
          acceptance_summary: acceptanceSummary,
          assignee_rank: assigneeRankMap[task.id] ?? null,
          subtask_count: subs.length,
          completed_subtask_count: completedSubs.length,
          progress_pct: progressPct,
        }
      })

      const searchNeedle = normalizeSearch(filters.search)
      if (!searchNeedle) return enrichedTasks

      return enrichedTasks.filter((task: any) => {
        const haystack = [
          task.id,
          task.title,
          htmlToPlainText(task.description),
          task.status,
          task.priority,
          task.outcome,
          task.acceptance_status,
          task.assignee_rank ? `${task.assignee_rank.position}/${task.assignee_rank.total}` : null,
          task.assignee?.display_name,
          task.assignee?.email,
          task.assigner?.display_name,
          task.assigner?.email,
          task.assigned_team?.name,
          task.workflow_source?.display_name,
          ...(Array.isArray(task.recent_activity) ? task.recent_activity.flatMap((event: any) => [event.event_type, event.actor?.display_name]) : []),
          ...(Array.isArray(task.tags) ? task.tags : []),
          ...((task.subtasks ?? []).flatMap((sub: any) => [sub.title, sub.status, sub.priority])),
        ]
          .map(normalizeSearch)
          .filter(Boolean)
        return haystack.some((value) => value.includes(searchNeedle))
      })
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
    }).optional(),
    run: async (ctx, args) => {
      const { listReportTasks } = await import('../manager-tasks')
      return listReportTasks(ctx, {
        indirect: args?.indirect, person: args?.person ?? null, status: args?.status ?? null, priority: args?.priority ?? null,
        workflow_id: args?.workflowId ?? null, overdue: args?.overdue, sla_breached: args?.slaBreached,
      })
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
} satisfies Record<string, UiRead<any, any>>
