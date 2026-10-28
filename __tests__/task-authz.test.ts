/**
 * The workflow-task rule (lib/task-authz.ts) and reporting lines
 * (lib/reporting-lines.ts): assignee only, manager on behalf with a note,
 * break-glass tasks.complete_any, credentials without a user.
 */
import { describe, expect, it } from 'vitest'
import { authorizeTaskAction, canUserSeeTask, decideTaskAction, describeTaskAccess, findOpenWorkflowTaskForEvent, type TaskActorFacts } from '@/lib/task-authz'
import { buildReportingIndex, isInManagerChain, listReports, managerChain, MAX_REPORTING_DEPTH, wouldCreateCycle } from '@/lib/reporting-lines'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TASK = { id: 't1', tenant_id: 'ta', status: 'todo', is_workflow_task: true, event_id: 'evt', assignee_id: 'alice' }
const facts = (over: Partial<TaskActorFacts> = {}): TaskActorFacts => ({ isAssignee: false, isTeamMember: false, assigneeIds: ['alice'], managedAssigneeId: null, ...over })
const perms = (...keys: string[]) => new Set(['tasks.complete', ...keys])

describe('decideTaskAction', () => {
  it('the assignee acts directly; on_behalf on your own task is a 400', () => {
    expect(decideTaskAction({ task: TASK, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }) }))
      .toEqual({ allowed: true, mode: 'assignee', onBehalfOf: null })
    expect(decideTaskAction({ task: TASK, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }), onBehalf: true, note: 'x' }))
      .toMatchObject({ allowed: false, status: 400 })
  })

  it('a team member acts on a team task with no individual assignee', () => {
    expect(decideTaskAction({ task: { ...TASK, assignee_id: null, assigned_team_id: 'team' }, actorId: 'tm', permissions: perms(), facts: facts({ isTeamMember: true, assigneeIds: [] }) }))
      .toMatchObject({ allowed: true, mode: 'assignee' })
  })

  it('another member is refused (403) — no admin override', () => {
    const everything = new Set(['tasks.complete', 'tasks.view_all', 'tasks.manage_queue', 'settings.edit', 'team.change_roles'])
    expect(decideTaskAction({ task: TASK, actorId: 'bob', permissions: everything, facts: facts() }))
      .toMatchObject({ allowed: false, status: 403 })
    expect(decideTaskAction({ task: TASK, actorId: 'bob', permissions: everything, facts: facts(), onBehalf: true, note: 'please' }))
      .toMatchObject({ allowed: false, status: 403 })
  })

  it('a manager must ask for on_behalf, with a note', () => {
    const f = facts({ managedAssigneeId: 'alice' })
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f })).toMatchObject({ allowed: false, status: 403 })
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f, onBehalf: true })).toMatchObject({ allowed: false, status: 400 })
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f, onBehalf: true, note: '  ' })).toMatchObject({ allowed: false, status: 400 })
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f, onBehalf: true, note: 'x'.repeat(2001) })).toMatchObject({ allowed: false, status: 400 })
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f, onBehalf: true, note: 'Alice is on leave' }))
      .toEqual({ allowed: true, mode: 'on_behalf', onBehalfOf: 'alice' })
    // Draft saves need no note.
    expect(decideTaskAction({ task: TASK, actorId: 'mia', permissions: perms(), facts: f, onBehalf: true, requireNote: false }))
      .toMatchObject({ allowed: true, mode: 'on_behalf' })
  })

  it('break-glass: tasks.complete_any outside the chain, on behalf with a note', () => {
    expect(decideTaskAction({ task: TASK, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: facts(), onBehalf: true, note: 'Audit request' }))
      .toEqual({ allowed: true, mode: 'break_glass', onBehalfOf: 'alice' })
    expect(decideTaskAction({ task: TASK, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: facts() })).toMatchObject({ allowed: false, status: 403 })
    // Team task without an individual assignee: nobody to act for.
    expect(decideTaskAction({ task: { ...TASK, assignee_id: null }, actorId: 'owen', permissions: perms('tasks.complete_any'), facts: facts({ assigneeIds: [] }), onBehalf: true, note: 'x' }))
      .toMatchObject({ allowed: false, status: 403 })
  })

  it('credentials with no user need tasks.complete_any; ungated contexts pass', () => {
    expect(decideTaskAction({ task: TASK, actorId: null, permissions: perms(), facts: facts() })).toMatchObject({ allowed: false, status: 403 })
    expect(decideTaskAction({ task: TASK, actorId: null, permissions: perms('tasks.complete_any'), facts: facts() })).toMatchObject({ allowed: true, mode: 'credential' })
    expect(decideTaskAction({ task: TASK, actorId: null, permissions: null, facts: facts() })).toMatchObject({ allowed: true, mode: 'credential' })
  })

  it('closed tasks are a 409 for everyone', () => {
    for (const status of ['completed', 'cancelled']) {
      expect(decideTaskAction({ task: { ...TASK, status }, actorId: 'alice', permissions: perms(), facts: facts({ isAssignee: true }) })).toMatchObject({ allowed: false, status: 409 })
    }
  })
})

describe('reporting lines', () => {
  const index = buildReportingIndex([
    { user_id: 'alice', manager_user_id: 'mia' },
    { user_id: 'ben', manager_user_id: 'mia' },
    { user_id: 'mia', manager_user_id: 'carl' },
    { user_id: 'carl', manager_user_id: null },
    { user_id: 'self', manager_user_id: 'self' },
  ])

  it('direct and indirect reports, manager chain', () => {
    expect(listReports(index, 'mia').map((r) => r.user_id).sort()).toEqual(['alice', 'ben'])
    expect(listReports(index, 'carl').map((r) => r.user_id)).toEqual(['mia'])
    expect(listReports(index, 'carl', { indirect: true }).map((r) => [r.user_id, r.depth])).toEqual([['mia', 1], ['alice', 2], ['ben', 2]])
    expect(managerChain(index, 'alice')).toEqual(['mia', 'carl'])
    expect(isInManagerChain(index, 'carl', 'alice')).toBe(true)
    expect(isInManagerChain(index, 'carl', 'alice', { indirect: false })).toBe(false)
    expect(isInManagerChain(index, 'ben', 'alice')).toBe(false)
    expect(isInManagerChain(index, 'alice', 'alice')).toBe(false)
    expect(listReports(index, 'self')).toEqual([]) // self-management is ignored
  })

  it('cycle-safe and capped', () => {
    const loop = buildReportingIndex([{ user_id: 'a', manager_user_id: 'b' }, { user_id: 'b', manager_user_id: 'a' }])
    expect(managerChain(loop, 'a')).toEqual(['b'])
    expect(listReports(loop, 'a', { indirect: true }).map((r) => r.user_id)).toEqual(['b'])
    const deep = buildReportingIndex(Array.from({ length: 30 }, (_, i) => ({ user_id: `u${i + 1}`, manager_user_id: `u${i}` })))
    expect(listReports(deep, 'u0', { indirect: true })).toHaveLength(MAX_REPORTING_DEPTH)
    expect(managerChain(deep, 'u30')).toHaveLength(MAX_REPORTING_DEPTH)
  })

  it('wouldCreateCycle', () => {
    expect(wouldCreateCycle(index, 'carl', 'alice')).toBe(true)
    expect(wouldCreateCycle(index, 'mia', 'mia')).toBe(true)
    expect(wouldCreateCycle(index, 'ben', 'alice')).toBe(false)
    expect(wouldCreateCycle(index, 'ben', null)).toBe(false)
  })
})

describe('authorizeTaskAction (loads the task, team, collaborators, reporting lines)', () => {
  const db = () => createMemorySupabase({
    tasks: [
      { ...TASK, title: 'Approve' },
      { id: 't-team', tenant_id: 'ta', status: 'todo', is_workflow_task: true, event_id: 'evt2', assignee_id: null, assigned_team_id: 'team-1' },
      { id: 't-collab', tenant_id: 'ta', status: 'todo', is_workflow_task: true, event_id: 'evt3', assignee_id: 'ben', assignment_mode: 'collaborative' },
      { id: 't-b', tenant_id: 'tb', status: 'todo', is_workflow_task: true, event_id: 'evt4', assignee_id: 'alice' },
      { id: 't-done', tenant_id: 'ta', status: 'completed', is_workflow_task: true, event_id: 'evt5', assignee_id: 'alice' },
    ],
    task_assignees: [{ tenant_id: 'ta', task_id: 't-collab', user_id: 'ben' }, { tenant_id: 'ta', task_id: 't-collab', user_id: 'alice' }],
    user_teams: [{ team_id: 'team-1', user_id: 'tm' }],
    user_memberships: [
      { tenant_id: 'ta', user_id: 'alice', manager_user_id: 'mia', is_active: true },
      { tenant_id: 'ta', user_id: 'mia', manager_user_id: 'carl', is_active: true },
      { tenant_id: 'ta', user_id: 'carl', manager_user_id: null, is_active: true },
      { tenant_id: 'ta', user_id: 'bob', manager_user_id: null, is_active: true },
      // Mia manages Alice only in ta, not in tb.
      { tenant_id: 'tb', user_id: 'alice', manager_user_id: null, is_active: true },
    ],
  })
  const run = (actorId: string | null, taskId: string, extra: Record<string, unknown> = {}) =>
    authorizeTaskAction(db(), { tenantId: 'ta', taskId, actorId, permissions: perms(), ...extra })

  it('assignee, collaborator and team member', async () => {
    await expect(run('alice', 't1')).resolves.toMatchObject({ mode: 'assignee' })
    await expect(run('alice', 't-collab')).resolves.toMatchObject({ mode: 'assignee' })
    await expect(run('tm', 't-team')).resolves.toMatchObject({ mode: 'assignee' })
  })

  it('manager and indirect manager on behalf; others 403', async () => {
    await expect(run('mia', 't1', { onBehalf: true, note: 'leave' })).resolves.toMatchObject({ mode: 'on_behalf', onBehalfOf: 'alice', note: 'leave' })
    await expect(run('carl', 't1', { onBehalf: true, note: 'leave' })).resolves.toMatchObject({ mode: 'on_behalf', onBehalfOf: 'alice' })
    // The collaborator Mia manages is the one acted for.
    await expect(run('mia', 't-collab', { onBehalf: true, note: 'x' })).resolves.toMatchObject({ onBehalfOf: 'alice' })
    await expect(run('bob', 't1')).rejects.toMatchObject({ status: 403 })
    await expect(run('bob', 't1', { onBehalf: true, note: 'x' })).rejects.toMatchObject({ status: 403 })
    await expect(run('mia', 't-team', { onBehalf: true, note: 'x' })).rejects.toMatchObject({ status: 403 })
  })

  it('another tenant 404, closed 409', async () => {
    await expect(run('alice', 't-b')).rejects.toMatchObject({ status: 404 })
    await expect(run('alice', 'missing')).rejects.toMatchObject({ status: 404 })
    await expect(run('alice', 't-done')).rejects.toMatchObject({ status: 409 })
  })

  it('canUserSeeTask and describeTaskAccess', async () => {
    expect(await canUserSeeTask(db(), 'ta', 'mia', 't1')).toBe(true)
    expect(await canUserSeeTask(db(), 'ta', 'bob', 't1')).toBe(false)
    expect(await canUserSeeTask(db(), 'ta', 'alice', 't-b')).toBe(false)
    expect(await describeTaskAccess(db(), { tenantId: 'ta', taskId: 't1', actorId: 'mia', permissions: perms() })).toMatchObject({ mode: 'on_behalf', onBehalfOf: 'alice', workflowTask: true })
    expect(await describeTaskAccess(db(), { tenantId: 'ta', taskId: 't1', actorId: 'bob', permissions: perms() })).toMatchObject({ mode: 'none' })
    expect(await describeTaskAccess(db(), { tenantId: 'ta', taskId: 't1', actorId: 'owen', permissions: perms('tasks.complete_any') })).toMatchObject({ mode: 'break_glass' })
  })

  it('findOpenWorkflowTaskForEvent', async () => {
    expect(await findOpenWorkflowTaskForEvent(db(), 'ta', 'evt')).toBe('t1')
    expect(await findOpenWorkflowTaskForEvent(db(), 'ta', 'evt5')).toBeNull()
    expect(await findOpenWorkflowTaskForEvent(db(), 'ta', 'evt4')).toBeNull()
  })
})
