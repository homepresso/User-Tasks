/**
 * Task dashboard reads (providers phase 4): lib/services/ui-reads/tasks.ts.
 * The memory client doesn't project columns or resolve embeds, so rows are
 * asserted by id / toMatchObject.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

/** Memory client plus the two filters these reads use that it lacks (lt, not in). */
function memory(seed: Record<string, any[]>) {
  const db: any = createMemorySupabase(seed)
  const from = db.from
  db.from = (table: string) => {
    const b = from(table)
    b.lt = (field: string, value: unknown) => b.lte(field, value).neq(field, value)
    b.not = (field: string, _op: string, list: string) => {
      for (const v of list.replace(/[()]/g, '').split(',')) b.neq(field, v)
      return b
    }
    return b
  }
  return db
}

function ctx(db: any, permissions: string[], actorId = 'u1'): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

const seed = () => ({
  users: [
    { id: 'u1', display_name: 'Me', avatar_url: 'a.png', current_tenant_id: 'tenant-a', team_id: 'team-1' },
    { id: 'u2', display_name: 'Bob', current_tenant_id: null, team_id: null },
    { id: 'u3', display_name: 'Cy', current_tenant_id: null },
  ],
  teams: [{ id: 'team-2', name: 'Zeta' }, { id: 'team-1', name: 'Alpha' }],
  user_teams: [
    { user_id: 'u1', team_id: 'team-1', user: { id: 'u1' } },
    { user_id: 'u3', team_id: 'team-1', user: { id: 'u3', display_name: 'Cy' } },
  ],
  tasks: [
    // Top-level tasks
    { id: 't1', tenant_id: 'tenant-a', parent_task_id: null, title: 'Write report', status: 'todo', priority: 'high', due_date: '2026-10-01T00:00:00.000Z', assignee_id: 'u2', assigner_id: 'u1', acceptance_status: null, created_at: '2026-09-01', sequence: 1 },
    { id: 't2', tenant_id: 'tenant-a', parent_task_id: null, title: 'Review', status: 'completed', priority: 'low', due_date: '2026-11-01T00:00:00.000Z', assignee_id: 'u1', assigner_id: 'u2', acceptance_status: 'pending', created_at: '2026-09-02' },
    { id: 't3', tenant_id: 'tenant-b', parent_task_id: null, title: 'Other org', status: 'todo', priority: 'high', due_date: '2026-10-05T00:00:00.000Z', assignee_id: 'u3', assigner_id: 'u1', acceptance_status: null, created_at: '2026-09-03' },
    { id: 't4', tenant_id: 'tenant-a', parent_task_id: null, title: 'Gone', status: 'todo', deleted_at: '2026-09-10', assignee_id: 'u1', assigner_id: 'u2', created_at: '2026-09-04' },
    { id: 't5', tenant_id: 'tenant-a', parent_task_id: null, title: 'Flow step', status: 'todo', is_workflow_task: true, acceptance_status: null, assignee_id: 'u1', assigner_id: 'u2', created_at: '2026-09-05' },
    { id: 't6', tenant_id: 'tenant-a', parent_task_id: null, title: 'Team step', status: 'in_progress', is_workflow_task: true, acceptance_status: null, assigned_team_id: 'team-1', assigner_id: 'u2', created_at: '2026-09-06' },
    { id: 't7', tenant_id: 'tenant-a', parent_task_id: null, title: 'Bob queue', status: 'todo', is_workflow_task: true, acceptance_status: null, assignee_id: 'u2', assigner_id: 'u1', created_at: '2026-09-07' },
    // Subtasks of t1
    { id: 's2', tenant_id: 'tenant-a', parent_task_id: 't1', title: 'Second', status: 'completed', sequence: 2, assignee_id: 'u2' },
    { id: 's1', tenant_id: 'tenant-a', parent_task_id: 't1', title: 'First', status: 'todo', sequence: 1, assignee_id: 'u2' },
    { id: 's3', tenant_id: 'tenant-a', parent_task_id: 't1', title: 'Deleted', status: 'todo', sequence: 3, deleted_at: '2026-09-09' },
  ],
  task_assignees: [
    { id: 'ta1', task_id: 't7', user_id: 'u1', acceptance_status: 'pending', created_at: '2026-09-01' },
    { id: 'ta2', task_id: 't1', user_id: 'u3', acceptance_status: 'accepted', created_at: '2026-09-02' },
  ],
  task_dependencies: [
    { task_id: 't1', depends_on_task_id: 't2', blocker: { id: 't2', title: 'Review', status: 'completed' } },
    { task_id: 't1', depends_on_task_id: 't3', blocker: { id: 't3', title: 'Other org', status: 'todo' } },
    { task_id: 't5', depends_on_task_id: 't1', blocked: { id: 't5', title: 'Flow step', status: 'todo' } },
  ],
  effort_records: [
    { id: 'e1', task_id: 't1', record_type: 'actual', created_at: '2026-09-01' },
    { id: 'e2', task_id: 't1', record_type: 'estimate', created_at: '2026-09-02' },
    { id: 'e3', task_id: 't1', record_type: 'timer_entry', created_at: '2026-09-03' },
    { id: 'e4', task_id: 't2', record_type: 'actual', created_at: '2026-09-04' },
  ],
  lifecycle_events: [
    { id: 'l1', task_id: 't1', event_type: 'task_created', created_at: '2026-09-01' },
  ],
  tenants: [{ id: 'tenant-a', name: 'A', slug: 'a' }],
})

const VIEW = ['tasks.view_own']
const ids = (result: any) => (result.data as any[]).map((r) => r.id)

describe('permissions', () => {
  it.each([
    ['tasks.list', {}, ['tasks.view_own']],
    ['tasks.list', {}, ['tasks.view_all']],
    ['tasks.detail', { id: 't1' }, ['tasks.view_all']],
    ['tasks.collaborators', { taskId: 't1' }, VIEW],
    ['tasks.effortEntries', { taskId: 't1' }, VIEW],
    ['tasks.dependencies', { taskId: 't1' }, VIEW],
    ['tasks.openBlockers', { taskId: 't1' }, VIEW],
    ['tasks.dependencyCandidates', { excludeTaskId: 't1' }, VIEW],
    ['tasks.subtasks', { parentTaskId: 't1' }, ['tasks.manage_queue']],
    ['tasks.queue', undefined, ['tasks.manage_queue']],
    ['tasks.assigned', {}, ['tasks.view_all']],
  ])('%s is allowed with %j / %j', async (name, args, perms) => {
    const db = memory(seed())
    db.rpc = async () => ({ data: { task: { id: 't1', tenant_id: 'tenant-a' }, subtasks: [] }, error: null })
    expect(await runUiRead(ctx(db, perms), { name, args })).toMatchObject({ ok: true })
  })

  it.each([
    ['tasks.list', {}, ['tasks.manage_queue']],
    ['tasks.detail', { id: 't1' }, ['tasks.create']],
    ['tasks.collaborators', { taskId: 't1' }, []],
    ['tasks.effortEntries', { taskId: 't1' }, []],
    ['tasks.dependencies', { taskId: 't1' }, []],
    ['tasks.openBlockers', { taskId: 't1' }, []],
    ['tasks.dependencyCandidates', { excludeTaskId: 't1' }, []],
    ['tasks.subtasks', { parentTaskId: 't1' }, []],
    ['tasks.queue', undefined, ['tasks.view_own', 'tasks.view_all']],
    ['tasks.assigned', {}, ['tasks.view_own']],
  ])('%s is denied with %j / %j', async (name, args, perms) => {
    const db = memory(seed())
    const from = vi.spyOn(db, 'from')
    expect(await runUiRead(ctx(db, perms), { name, args })).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
  })

  it('pickers and own profile need no task permission', async () => {
    for (const [name, args] of [['tasks.teams', undefined], ['tasks.teamMembers', { teamId: 'team-1' }], ['tasks.redirectUsers', undefined], ['tasks.myProfile', undefined]] as const) {
      expect(await runUiRead(ctx(memory(seed()), []), { name, args })).toMatchObject({ ok: true })
    }
  })
})

describe('argument validation', () => {
  it.each([
    ['tasks.detail', {}],
    ['tasks.detail', { id: '' }],
    ['tasks.collaborators', { taskId: 5 }],
    ['tasks.subtasks', { parentTaskId: 'x'.repeat(201) }],
    ['tasks.list', { sortBy: 'due_date; drop table' }],
    ['tasks.list', { sortDir: 'sideways' }],
    ['tasks.list', { dueBy: 'tomorrow' }],
    ['tasks.list', { status: Array.from({ length: 21 }, () => 'todo') }],
    ['tasks.assigned', { scope: 'everyone' }],
    ['tasks.dependencyCandidates', { excludeTaskId: 't1', search: 'x'.repeat(201) }],
    ['tasks.teamMembers', {}],
  ])('%s rejects %j', async (name, args) => {
    expect(await runUiRead(ctx(memory(seed()), ['tasks.view_all', 'tasks.view_own']), { name, args }))
      .toMatchObject({ ok: false, status: 400 })
  })
})

describe('tasks.list', () => {
  it('filters to the current workspace, top-level, live, non-pending tasks, ordered by due date', async () => {
    const result = await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.list', args: {} })
    // t3 is another tenant (current_tenant_id = tenant-a); t2 pending; t4 deleted; subtasks excluded.
    expect(ids(result)).toEqual(['t1', 't5', 't6', 't7'])
  })

  it('unified view (no current tenant) adds no tenant filter; an explicit tenantId wins', async () => {
    const db = memory(seed())
    db.tables.users[0].current_tenant_id = null
    expect(ids(await runUiRead(ctx(db, VIEW), { name: 'tasks.list', args: { status: ['todo'], priority: ['high'] } }))).toEqual(['t1', 't3'])
    expect(ids(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.list', args: { tenantId: 'tenant-b' } }))).toEqual(['t3'])
  })

  it('applies due cutoffs, search, assignee and sort direction', async () => {
    const run = (args: any) => runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.list', args }).then(ids)
    expect(await run({ dueBefore: '2026-10-01T00:00:00.000Z' })).toEqual([])
    expect(await run({ dueBy: '2026-10-01T00:00:00.000Z' })).toEqual(['t1'])
    expect(await run({ search: 'flow' })).toEqual(['t5'])
    expect(await run({ assigneeId: 'u2' })).toEqual(['t1', 't7'])
    expect(await run({ sortBy: 'created_at', sortDir: 'desc' })).toEqual(['t7', 't6', 't5', 't1'])
  })
})

describe('task detail reads', () => {
  it('tasks.detail returns the tree with tenant, names and null for a missing task', async () => {
    const db = memory(seed())
    db.rpc = vi.fn(async (_fn: string, { p_task_id }: any) => ({
      data: p_task_id === 't1' ? { task: { id: 't1', tenant_id: 'tenant-a', assignee_id: 'u2', assigner_id: 'u1' }, subtasks: [] } : null,
      error: null,
    }))
    expect(await runUiRead(ctx(db, VIEW), { name: 'tasks.detail', args: { id: 't1' } })).toMatchObject({
      ok: true,
      data: { treeData: { task: { id: 't1' } }, tenant: { id: 'tenant-a' }, assigneeName: 'Bob', assignerName: 'Me', workflowSource: null },
    })
    expect(db.rpc).toHaveBeenCalledWith('get_task_tree', { p_task_id: 't1' })
    expect(await runUiRead(ctx(db, VIEW), { name: 'tasks.detail', args: { id: 'nope' } })).toEqual({ ok: true, data: null })
  })

  it('collaborators and effort entries are the task’s own rows', async () => {
    expect(ids(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.collaborators', args: { taskId: 't1' } }))).toEqual(['ta2'])
    expect(ids(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.effortEntries', args: { taskId: 't1' } }))).toEqual(['e3', 'e1'])
  })

  it('dependencies come back normalised both ways; open blockers drop finished ones', async () => {
    expect(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.dependencies', args: { taskId: 't1' } })).toEqual({
      ok: true,
      data: {
        blockedBy: [{ id: 't2', title: 'Review', status: 'completed' }, { id: 't3', title: 'Other org', status: 'todo' }],
        blocks: [{ id: 't5', title: 'Flow step', status: 'todo' }],
      },
    })
    expect(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.openBlockers', args: { taskId: 't1' } }))
      .toEqual({ ok: true, data: [{ id: 't3', title: 'Other org' }] })
  })

  it('dependency candidates: open, not the task itself, newest first, searchable', async () => {
    const result = await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.dependencyCandidates', args: { excludeTaskId: 't1' } })
    expect(result).toMatchObject({ ok: true, data: [{ id: 't7', label: 'Bob queue' }, { id: 't6' }, { id: 't5' }, { id: 't3' }, { id: 's1' }] })
    expect(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.dependencyCandidates', args: { excludeTaskId: 't1', search: ' team ' } }))
      .toEqual({ ok: true, data: [{ id: 't6', label: 'Team step' }] })
  })

  it('subtasks are live children in sequence order', async () => {
    expect(ids(await runUiRead(ctx(memory(seed()), VIEW), { name: 'tasks.subtasks', args: { parentTaskId: 't1' } }))).toEqual(['s1', 's2'])
  })
})

describe('"me" reads use ctx.actorId', () => {
  it('tasks.queue buckets direct pending, own workflow, team and collaborative tasks for the actor only', async () => {
    const result: any = await runUiRead(ctx(memory(seed()), ['tasks.manage_queue']), { name: 'tasks.queue' })
    expect(result.ok).toBe(true)
    expect(result.data.hasMore).toBe(false)
    // None overdue — newest first: t7 (collaborative), t6 (team), t5 (own workflow), t2 (pending acceptance).
    expect(result.data.tasks.map((t: any) => t.id)).toEqual(['t7', 't6', 't5', 't2'])
    const bob: any = await runUiRead(ctx(memory(seed()), ['tasks.manage_queue'], 'u2'), { name: 'tasks.queue' })
    expect(bob.data.tasks.map((t: any) => t.id)).toEqual(['t7'])
  })

  it('tasks.assigned: tasks the actor assigned to others, enriched server-side', async () => {
    const result: any = await runUiRead(ctx(memory(seed()), ['tasks.view_all']), { name: 'tasks.assigned', args: {} })
    // t3 is another tenant; t7 is assigned by u1 to u2 too.
    expect(result.data.map((t: any) => t.id)).toEqual(['t1', 't7'])
    expect(result.data[0]).toMatchObject({
      subtask_count: 2,
      completed_subtask_count: 1,
      progress_pct: 50,
      subtasks: [{ id: 's1' }, { id: 's2' }],
      recent_activity: [{ id: 'l1' }],
      collaborators: [{ id: 'ta2' }],
      acceptance_summary: { pending: 0, accepted: 1, held: 0, rejected: 0 },
      assignee_rank: { position: 1, total: 2 },
    })
    const bob: any = await runUiRead(ctx(memory(seed()), ['tasks.view_all'], 'u2'), { name: 'tasks.assigned', args: {} })
    const bobIds = bob.data.map((t: any) => t.id)
    expect(bobIds).toEqual(expect.arrayContaining(['t2', 't5']))
    expect(bobIds).not.toContain('t1')
    expect(bob.data.every((t: any) => t.assigner_id === 'u2' && t.assignee_id !== 'u2')).toBe(true)
  })

  it('tasks.assigned: team-member scope and server-side search', async () => {
    const team: any = await runUiRead(ctx(memory(seed()), ['tasks.view_all']), { name: 'tasks.assigned', args: { scope: 'team_members' } })
    expect(team.data).toEqual([]) // u3's only task is in another tenant
    const search: any = await runUiRead(ctx(memory(seed()), ['tasks.view_all']), { name: 'tasks.assigned', args: { search: 'FIRST' } })
    expect(search.data.map((t: any) => t.id)).toEqual(['t1']) // matches a subtask title
  })

  it('tasks.myProfile is the actor’s own row', async () => {
    expect(await runUiRead(ctx(memory(seed()), [], 'u2'), { name: 'tasks.myProfile' })).toMatchObject({ ok: true, data: { display_name: 'Bob' } })
  })
})

describe('pickers', () => {
  it('teams by name; team members as users', async () => {
    expect(ids(await runUiRead(ctx(memory(seed()), []), { name: 'tasks.teams' }))).toEqual(['team-1', 'team-2'])
    expect(await runUiRead(ctx(memory(seed()), []), { name: 'tasks.teamMembers', args: { teamId: 'team-1' } }))
      .toEqual({ ok: true, data: [{ id: 'u1' }, { id: 'u3', display_name: 'Cy' }] })
    expect(ids(await runUiRead(ctx(memory(seed()), []), { name: 'tasks.redirectUsers' }))).toEqual(['u2', 'u3', 'u1'])
  })
})
