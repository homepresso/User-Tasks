/**
 * Taking ownership / (re)assigning tasks (lib/task-authz.ts
 * decideTaskAssignment, lib/services/task-ownership.ts): an admin
 * (tasks.complete_any) or a manager of the workflow takes an UNASSIGNED
 * task; a non-admin can't; managers reassign their reports' tasks; the
 * assignee redirects only when the step allows it; acting directly on an
 * unassigned task takes ownership first; audit, history (reassigned with
 * took_ownership), notifications and the process view follow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { decideTaskAction, decideTaskAssignment, describeTaskAccess, isUnassignedTask, type TaskActorFacts } from '@/lib/task-authz'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const memory = vi.hoisted(() => ({ db: null as any, audits: [] as any[] }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async (entry: any) => { memory.audits.push(entry) }) }))

import { assignTask, bulkAssignTasks, takeTaskOwnership } from '@/lib/services/task-ownership'
import { loadRunTasks } from '@/lib/services/run-tasks'

const T = 'ta'
const RUN = '22222222-2222-4222-8222-222222222222'
const TASK = { id: 't1', tenant_id: T, status: 'todo', is_workflow_task: true, event_id: 'evt', assignee_id: 'alice' }
const facts = (over: Partial<TaskActorFacts> = {}): TaskActorFacts => ({ isAssignee: false, isTeamMember: false, assigneeIds: ['alice'], managedAssigneeId: null, ...over })
const perms = (...keys: string[]) => new Set(['tasks.complete', 'tasks.view_own', ...keys])

describe('decideTaskAssignment (pure)', () => {
  const unassigned = { ...TASK, assignee_id: null }
  const none = facts({ assigneeIds: [] })

  it('unassigned: admins (tasks.complete_any) and workflow managers take or assign; others are refused', () => {
    expect(isUnassignedTask(unassigned, none)).toBe(true)
    expect(isUnassignedTask({ ...unassigned, assigned_team_id: 'team' }, none)).toBe(false)
    expect(decideTaskAssignment({ task: unassigned, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: none, action: 'take' }))
      .toEqual({ allowed: true, basis: 'admin', unassigned: true })
    expect(decideTaskAssignment({ task: unassigned, actorId: 'olga', permissions: perms(), facts: { ...none, isWorkflowManager: true }, action: 'assign' }))
      .toEqual({ allowed: true, basis: 'workflow_manager', unassigned: true })
    const everything = perms('tasks.view_all', 'tasks.assign', 'tasks.manage_queue')
    expect(decideTaskAssignment({ task: unassigned, actorId: 'bob', permissions: everything, facts: none, action: 'take' })).toMatchObject({ allowed: false, status: 403 })
  })

  it('assigned: the assignee redirects only when allowed; managers, workflow managers and admins reassign', () => {
    expect(decideTaskAssignment({ task: TASK, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }), action: 'assign' })).toMatchObject({ allowed: false, status: 403 })
    expect(decideTaskAssignment({ task: { ...TASK, allow_reassign: true }, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }), action: 'assign' }))
      .toMatchObject({ allowed: true, basis: 'assignee' })
    expect(decideTaskAssignment({ task: TASK, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }), action: 'take' })).toMatchObject({ allowed: false, status: 409 })
    expect(decideTaskAssignment({ task: TASK, actorId: 'mia', permissions: perms(), facts: facts({ managedAssigneeId: 'alice' }), action: 'assign' })).toMatchObject({ allowed: true, basis: 'manager' })
    expect(decideTaskAssignment({ task: TASK, actorId: 'mia', permissions: perms(), facts: facts({ managedAssigneeId: 'alice' }), action: 'take' })).toMatchObject({ allowed: true, basis: 'manager' })
    expect(decideTaskAssignment({ task: TASK, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: facts(), action: 'assign' })).toMatchObject({ allowed: true, basis: 'admin' })
    expect(decideTaskAssignment({ task: TASK, actorId: 'bob', permissions: perms(), facts: facts(), action: 'assign' })).toMatchObject({ allowed: false, status: 403 })
    expect(decideTaskAssignment({ task: { ...TASK, status: 'completed' }, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: facts(), action: 'assign' })).toMatchObject({ allowed: false, status: 409 })
    expect(decideTaskAssignment({ task: TASK, actorId: null, permissions: null, facts: facts(), action: 'take' })).toMatchObject({ allowed: false, status: 403 })
  })

  it('acting directly on an unassigned task: admins take ownership, others stay refused', () => {
    expect(decideTaskAction({ task: unassigned, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: none }))
      .toEqual({ allowed: true, mode: 'assignee', onBehalfOf: null, takesOwnership: true })
    expect(decideTaskAction({ task: unassigned, actorId: 'bob', permissions: perms(), facts: none })).toMatchObject({ allowed: false, status: 403 })
  })
})

function seed() {
  return createMemorySupabase({
    workflows: [{ id: 'wf1', tenant_id: T, name: 'Leave', nodes: [{ id: 'approve', type: 'user_task', label: 'Approve leave' }] }],
    workflow_runs: [{ id: RUN, tenant_id: T, workflow_id: 'wf1', status: 'waiting_for_event', started_at: '2026-11-01T00:00:00Z' }],
    tasks: [
      { id: 'u1', tenant_id: T, title: 'Approve leave', status: 'todo', is_workflow_task: true, event_id: 'e1', assignee_id: null, assigned_team_id: null, workflow_id: 'wf1', workflow_run_id: RUN, workflow_step_id: 'approve', acceptance_status: 'pending', created_at: '2026-11-01T00:00:00Z', metadata: {} },
      { id: 'r1', tenant_id: T, title: 'Expense claim', status: 'todo', is_workflow_task: true, event_id: 'e2', assignee_id: 'ana', workflow_id: 'wf1', acceptance_status: 'accepted', created_at: '2026-11-01T00:00:00Z', metadata: {} },
    ],
    users: [
      { id: 'owen', display_name: 'Owen Admin', email: 'owen@x' },
      { id: 'mia', display_name: 'Mia Manager', email: 'mia@x' },
      { id: 'ana', display_name: 'Ana Report', email: 'ana@x' },
      { id: 'ben', display_name: 'Ben Report', email: 'ben@x' },
      { id: 'bob', display_name: 'Bob Member', email: 'bob@x' },
    ],
    user_memberships: [
      { tenant_id: T, user_id: 'ana', manager_user_id: 'mia', is_active: true },
      { tenant_id: T, user_id: 'ben', manager_user_id: 'mia', is_active: true },
      { tenant_id: T, user_id: 'mia', manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: 'owen', manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: 'bob', manager_user_id: null, is_active: true },
    ],
    teams: [{ id: 'team-1', tenant_id: T, name: 'Finance' }],
    task_assignees: [],
    task_responses: [],
    user_teams: [],
    object_permissions: [],
    user_roles: [],
    lifecycle_events: [],
    notifications: [],
  })
}

function ctx(actorId: string, permissions: string[]): ServiceContext {
  return { db: memory.db, supabase: memory.db, tenantId: T, actorId, permissions: perms(...permissions), authKind: 'session', source: 'ui' }
}

describe('takeTaskOwnership / assignTask (service)', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = [] })
  const read = async (table: string, filter: Record<string, unknown> = {}) => {
    let q = memory.db.from(table).select('*')
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v)
    return ((await q).data ?? []) as any[]
  }

  it('an admin takes an unassigned task: assigned + accepted, history, audit, process view', async () => {
    const before = await describeTaskAccess(memory.db, { tenantId: T, taskId: 'u1', actorId: 'owen', permissions: perms('tasks.complete_any') })
    expect(before).toMatchObject({ unassigned: true, canTakeOwnership: true, canReassign: true, mode: 'assignee' })
    const result = await takeTaskOwnership(ctx('owen', ['tasks.complete_any']), 'u1', { reason: 'Nobody had it', via: 'ui' })
    expect(result).toMatchObject({ task_id: 'u1', assignee_id: 'owen', took_ownership: true, basis: 'admin', previous_assignee_id: null })
    const [task] = await read('tasks', { id: 'u1' })
    expect(task).toMatchObject({ assignee_id: 'owen', acceptance_status: 'accepted', status: 'in_progress' })
    const [event] = await read('lifecycle_events', { task_id: 'u1' })
    expect(event).toMatchObject({ event_type: 'reassigned', actor_id: 'owen', metadata: { new_assignee: 'owen', took_ownership: true, comment: 'Nobody had it', acted_as: 'admin' } })
    expect(memory.audits).toHaveLength(1)
    expect(memory.audits[0]).toMatchObject({ action: 'reassign', objectId: 'u1', actorId: 'owen', metadata: { took_ownership: true, to: 'owen' } })
    expect(memory.audits[0].summary).toContain('Took ownership')
    // The run's process view: Owen is the assignee and the history says he took it.
    const tasks = await loadRunTasks(ctx('owen', ['tasks.complete_any', 'tasks.view_all']), { id: RUN, workflow_id: 'wf1' } as any, { labels: new Map([['approve', 'Approve leave']]), db: memory.db })
    expect(tasks[0].assignees.map((a) => a.id)).toEqual(['owen'])
    expect(tasks[0].history.find((h) => h.kind === 'reassigned')).toMatchObject({ took_ownership: true, actor: { name: 'Owen Admin' } })
  })

  it('a non-admin member can\'t take or assign an unassigned task', async () => {
    const access = await describeTaskAccess(memory.db, { tenantId: T, taskId: 'u1', actorId: 'bob', permissions: perms('tasks.view_all') })
    expect(access).toMatchObject({ unassigned: true, canTakeOwnership: false, canReassign: false, mode: 'none' })
    await expect(takeTaskOwnership(ctx('bob', ['tasks.view_all']), 'u1', { via: 'ui' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(assignTask(ctx('bob', []), 'u1', { target_user_id: 'ana', via: 'ui' })).rejects.toMatchObject({ code: 'forbidden' })
    expect(memory.audits).toHaveLength(0)
  })

  it('the process view offers Take ownership to the admin only', async () => {
    const labels = { labels: new Map([['approve', 'Approve leave']]), db: memory.db }
    const admin = await loadRunTasks(ctx('owen', ['tasks.complete_any', 'tasks.view_all']), { id: RUN, workflow_id: 'wf1' } as any, labels)
    expect(admin[0]).toMatchObject({ unassigned: true, can_take_ownership: true, can_reassign: true })
    const member = await loadRunTasks(ctx('bob', ['tasks.view_all']), { id: RUN, workflow_id: 'wf1' } as any, labels)
    expect(member[0]).toMatchObject({ unassigned: true, can_take_ownership: false, can_reassign: false })
  })

  it('a manager reassigns a direct report\'s task to another report; notifications go to both', async () => {
    const result = await assignTask(ctx('mia', []), 'r1', { target_user_id: 'ben', reason: 'Ana is on leave', via: 'ui' })
    expect(result).toMatchObject({ previous_assignee_id: 'ana', assignee_id: 'ben', basis: 'manager', took_ownership: false })
    const notes = await read('notifications', { task_id: 'r1' })
    expect(notes.map((n) => n.user_id).sort()).toEqual(['ana', 'ben'])
    const [event] = await read('lifecycle_events', { task_id: 'r1' })
    expect(event.metadata).toMatchObject({ old_assignee: 'ana', new_assignee: 'ben', acted_as: 'manager', comment: 'Ana is on leave' })
    expect(memory.audits[0]).toMatchObject({ action: 'reassign', metadata: { from: 'ana', to: 'ben', basis: 'manager' } })
  })

  it('a member who is not a manager is refused; assigning to a team works for an admin', async () => {
    await expect(assignTask(ctx('bob', []), 'r1', { target_user_id: 'ben', via: 'ui' })).rejects.toMatchObject({ code: 'forbidden' })
    const result = await assignTask(ctx('owen', ['tasks.complete_any']), 'r1', { target_team_id: 'team-1', via: 'ui' })
    expect(result).toMatchObject({ team_id: 'team-1', assignee_id: null })
    const [task] = await read('tasks', { id: 'r1' })
    expect(task).toMatchObject({ assignee_id: null, assigned_team_id: 'team-1', assignment_mode: 'team' })
  })

  it('bulk reassign is admin-only', async () => {
    await expect(bulkAssignTasks(ctx('mia', []), ['r1'], { target_user_id: 'ben', via: 'ui' })).rejects.toMatchObject({ code: 'forbidden' })
    const out = await bulkAssignTasks(ctx('owen', ['tasks.complete_any']), ['r1', 'u1', 'missing'], { target_user_id: 'ben', via: 'ui' })
    expect(out.assigned.map((a) => a.task_id).sort()).toEqual(['r1', 'u1'])
    expect(out.failed).toEqual([{ task_id: 'missing', error: 'Task not found' }])
  })

  it('acting directly on an unassigned task (the task page, REST, MCP) takes ownership first', async () => {
    const { authorizeTaskForContext } = await import('@/lib/services/task-actions')
    const access = await authorizeTaskForContext(ctx('owen', ['tasks.complete_any']), memory.db, 'u1', { columns: '*' })
    expect(access).toMatchObject({ mode: 'assignee', takesOwnership: true, task: { assignee_id: 'owen' } })
    const [task] = await read('tasks', { id: 'u1' })
    expect(task.assignee_id).toBe('owen')
    expect(memory.audits[0].summary).toContain('Took ownership')
    await expect(authorizeTaskForContext(ctx('bob', []), memory.db, 'r1', {})).rejects.toMatchObject({ code: 'forbidden' })
  })
})
