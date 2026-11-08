/**
 * The Agent's task assignment tools (server side): take ownership,
 * (re)assign to a person or team, claim a queued team / group task. Offered
 * with task help (a task on screen) and on the screens where people manage
 * waiting work (a run's process view, My tasks / My team, Home's tracker,
 * the queue page).
 *
 * Every change is a WRITE tool: the engine shows a confirmation card (the
 * task, who has it now → who will, the reason) and runs it only after the
 * person confirms. The tools call the same services as the UI with the
 * person's own ServiceContext, so the same rules apply
 * (lib/task-authz.ts decideTaskAssignment; lib/services/home claimTask):
 * the assignee redirects when the step allows it, managers and workflow
 * managers reassign, admins (tasks.complete_any) take or reassign anything,
 * unassigned tasks go to admins and workflow managers, team members claim.
 * Audit, task history, notifications and the process view follow.
 *
 * There is still no tool that completes, approves, declines or otherwise
 * actions a task.
 */
import type { AssistantToolDef } from '../engine'
import type { ServiceContext } from '@/lib/services/context'
import { serviceRoleClient } from '@/lib/services/_shared'
import { authorizeTaskAssignment } from '@/lib/task-authz'
import { assignTask, takeTaskOwnership } from '@/lib/services/task-ownership'
import { listActiveTasks } from '@/lib/services/active-tasks'
import { claimTask } from '@/lib/services/home'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const TASK_ASSIGN_TOOLS = ['find_active_tasks', 'task_assign_targets', 'task_take_ownership', 'task_assign', 'task_claim'] as const

export interface TaskAssignDeps {
  /** The signed-in person (their permissions; the services re-check everything). */
  ctx: ServiceContext
  /** The task on screen (task help): the default task_id. */
  taskId?: string | null
}

interface TaskFacts { id: string; title: string; who: string; status: string }

async function loadFacts(ctx: ServiceContext, taskId: string): Promise<TaskFacts> {
  const db = await serviceRoleClient(ctx) as any
  const { data: task } = await db.from('tasks').select('id, title, status, assignee_id, assigned_team_id')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (!task) throw new Error('Task not found')
  let who = 'Unassigned'
  if (task.assignee_id) {
    const { data: u } = await db.from('users').select('display_name, email').eq('id', task.assignee_id).maybeSingle()
    who = String(u?.display_name || u?.email || 'Someone')
  } else if (task.assigned_team_id) {
    const { data: t } = await db.from('teams').select('name').eq('id', task.assigned_team_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    who = `${t?.name ?? 'A'} team`
  }
  return { id: String(task.id), title: String(task.title ?? 'Task'), who, status: String(task.status ?? '') }
}

async function nameOf(ctx: ServiceContext, kind: 'user' | 'team', id: string): Promise<string> {
  const db = await serviceRoleClient(ctx) as any
  if (kind === 'team') {
    const { data } = await db.from('teams').select('name').eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (!data) throw new Error('That team is not in this workspace — look it up with task_assign_targets')
    return `${data.name} team`
  }
  const { data: member } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', ctx.tenantId).eq('user_id', id).maybeSingle()
  if (!member || member.is_active === false) throw new Error('That person is not a member of this workspace — look them up with task_assign_targets')
  const { data } = await db.from('users').select('display_name, email').eq('id', id).maybeSingle()
  return String(data?.display_name || data?.email || 'Someone')
}

const reasonOf = (args: Record<string, any>) => (typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim().slice(0, 2000) : null)

/** Throws the service's refusal as a plain Error (the engine shows it to the model instead of a card). */
async function precheck(ctx: ServiceContext, taskId: string, action: 'take' | 'assign') {
  const db = await serviceRoleClient(ctx)
  try {
    return await authorizeTaskAssignment(db, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions, action })
  } catch (error) {
    throw new Error((error as Error)?.message || 'Not allowed')
  }
}

export function taskAssignTools({ ctx, taskId = null }: TaskAssignDeps): AssistantToolDef[] {
  const agentCtx: ServiceContext = { ...ctx, via: 'agent' }
  const taskIdOf = (args: Record<string, any>): string => {
    const id = typeof args.task_id === 'string' && args.task_id.trim() ? args.task_id.trim() : taskId
    if (!id || !UUID.test(id)) throw new Error(taskId ? 'Unknown task id' : 'Give task_id (find it with find_active_tasks)')
    return id
  }
  const taskIdProp = { type: 'string', description: taskId ? 'The task (default: the task on screen)' : 'The task id (from find_active_tasks)' }
  const changed = (id: string, title: string) => ({ type: 'changed' as const, kind: 'task', id, title, href: `/tasks/${id}`, action: 'updated' as const })

  return [
    {
      name: 'find_active_tasks',
      description: 'List open tasks waiting for people that the person can see (their own, their reports\', workflows they manage; everything for admins), with who has each, how long it has waited, and whether the person may take ownership or reassign it. Use it to find a task id by title.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Part of the task title' }, unassigned_only: { type: 'boolean' } }, required: [] },
      mode: 'read',
      label: () => 'Looking up active tasks',
      run: async (args) => {
        const page = await listActiveTasks(ctx, { search: typeof args.query === 'string' ? args.query.slice(0, 200) : '', unassigned: args.unassigned_only === true, pageSize: 20 })
        return {
          result: {
            tasks: page.tasks.map((t) => ({
              id: t.id, title: t.title, workflow: t.workflow?.name ?? null,
              with: t.assignee?.name ?? (t.team ? `${t.team.name} team` : t.state === 'claim' ? 'queue (claimable)' : 'unassigned'),
              state: t.state, waiting_since: t.waiting_since, due: t.due_date, sla: t.sla,
              can_take_ownership: t.can_take_ownership, can_reassign: t.can_reassign,
            })),
            total: page.total,
          },
        }
      },
    },
    {
      name: 'task_assign_targets',
      description: 'People (workspace members) and teams a task can be assigned to, with their ids. Use it before task_assign, and offer the likely choices to the person as ask_user buttons when it is unclear who should get the task.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Part of a name or email' } }, required: [] },
      mode: 'read',
      label: () => 'Looking up people and teams',
      run: async (args) => {
              const db = await serviceRoleClient(ctx) as any
        const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
        const [members, teams] = await Promise.all([
          db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).limit(2000),
          db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId).limit(500),
        ])
        const ids = ((members.data ?? []) as any[]).map((m) => String(m.user_id))
        const { data: users } = ids.length ? await db.from('users').select('id, display_name, email').in('id', ids) : { data: [] }
        const match = (s: unknown) => !q || String(s ?? '').toLowerCase().includes(q)
        return {
          result: {
            people: ((users ?? []) as any[]).filter((u) => match(u.display_name) || match(u.email)).slice(0, 15).map((u) => ({ id: String(u.id), name: String(u.display_name || u.email), email: u.email ?? null, is_you: u.id === ctx.actorId })),
            teams: ((teams.data ?? []) as any[]).filter((t) => match(t.name)).slice(0, 15).map((t) => ({ id: String(t.id), name: String(t.name) })),
          },
        }
      },
    },
    {
      name: 'task_take_ownership',
      description: 'Assign a task to the person themselves ("assign it to me", "take this task"). Allowed for an unassigned task when they are an admin or a manager of its workflow, and for a task of someone in their reporting chain. Shown as a confirmation card first.',
      parameters: { type: 'object', properties: { task_id: taskIdProp, reason: { type: 'string', description: 'Why (recorded in the history)' } }, required: [] },
      mode: 'write',
      label: () => 'Taking ownership of the task',
      confirm: async (args) => {
        const id = taskIdOf(args)
        const [facts, access] = await Promise.all([loadFacts(ctx, id), precheck(ctx, id, 'take')])
        const reason = reasonOf(args)
        return {
          title: `Take ownership of “${facts.title}”`,
          lines: [`From: ${facts.who}`, 'To: you (accepted, so you can act on it now)', ...(reason ? [`Reason: ${reason}`] : [])],
          warnings: access.unassigned ? ['This task had nobody assigned. The change is audited and shown in the task history.'] : ['The current assignee is notified. The change is audited and shown in the task history.'],
          confirm_label: 'Take ownership',
        }
      },
      run: async (args, env) => {
        const id = taskIdOf(args)
        const result = await takeTaskOwnership(agentCtx, id, { reason: reasonOf(args), via: 'agent' })
        env.emit(changed(id, result.title))
        return { result: { ...result, note: 'Done: the task is now assigned to the person. They act on it themselves (you never complete it).' } }
      },
    },
    {
      name: 'task_assign',
      description: 'Assign or reassign a task to a person or a team, with a reason. Allowed for the assignee when the task allows redirecting, anyone in the assignee\'s manager chain, a manager of the workflow, and admins; unassigned tasks for admins and workflow managers. Give assignee_user_id OR team_id (ids from task_assign_targets). If it is unclear who should get it, ask first with ask_user (buttons for the likely people / teams, allow_other) — never guess. Shown as a confirmation card first.',
      parameters: {
        type: 'object',
        properties: {
          task_id: taskIdProp,
          assignee_user_id: { type: 'string', description: 'The person\'s user id' },
          team_id: { type: 'string', description: 'The team\'s id (instead of a person)' },
          reason: { type: 'string', description: 'Why it is being reassigned (shown to the new assignee)' },
        },
        required: [],
      },
      mode: 'write',
      label: () => 'Reassigning the task',
      confirm: async (args) => {
        const id = taskIdOf(args)
        const userId = typeof args.assignee_user_id === 'string' && UUID.test(args.assignee_user_id) ? args.assignee_user_id : null
        const teamId = !userId && typeof args.team_id === 'string' && UUID.test(args.team_id) ? args.team_id : null
        if (!userId && !teamId) throw new Error('Give assignee_user_id or team_id (look them up with task_assign_targets; ask the person with ask_user if unclear)')
        const selfAssign = userId === ctx.actorId
        const [facts, access, to] = await Promise.all([loadFacts(ctx, id), precheck(ctx, id, selfAssign ? 'take' : 'assign'), nameOf(ctx, userId ? 'user' : 'team', (userId ?? teamId)!)])
        const reason = reasonOf(args)
        return {
          title: `Reassign “${facts.title}”`,
          lines: [`From: ${facts.who}`, `To: ${selfAssign ? 'you' : to}`, `Reason: ${reason ?? '(none given)'}`],
          warnings: [`${selfAssign ? 'You take ownership' : `${to} is notified`}; the change is audited and shown in the task history and process view${access.basis === 'admin' ? ' (as an admin)' : ''}.`],
          confirm_label: 'Reassign',
        }
      },
      run: async (args, env) => {
        const id = taskIdOf(args)
        const userId = typeof args.assignee_user_id === 'string' && UUID.test(args.assignee_user_id) ? args.assignee_user_id : null
        const teamId = !userId && typeof args.team_id === 'string' && UUID.test(args.team_id) ? args.team_id : null
        const result = await assignTask(agentCtx, id, { target_user_id: userId, target_team_id: teamId, reason: reasonOf(args), via: 'agent' })
        env.emit(changed(id, result.title))
        return { result: { ...result, note: 'Done: the task is reassigned and the new assignee notified.' } }
      },
    },
    {
      name: 'task_claim',
      description: 'Claim a queued team or directory-group task for the person (they must be in that team / group). Shown as a confirmation card first.',
      parameters: { type: 'object', properties: { task_id: taskIdProp }, required: [] },
      mode: 'write',
      label: () => 'Claiming the task',
      confirm: async (args) => {
        const facts = await loadFacts(ctx, taskIdOf(args))
        return { title: `Claim “${facts.title}”`, lines: [`From: ${facts.who}`, 'To: you'], warnings: ['Other members of the team stop seeing it in their queue.'], confirm_label: 'Claim' }
      },
      run: async (args, env) => {
        const id = taskIdOf(args)
        const facts = await loadFacts(ctx, id)
        const result = await claimTask(agentCtx, id)
        env.emit(changed(id, facts.title))
        return { result: { ...result, note: 'Claimed: the task is now the person\'s.' } }
      },
    },
  ]
}
