/**
 * The queue page's Active tasks tab (lib/services/active-tasks.ts,
 * lib/automations/active-task-filters.ts): visibility per tier (admin with
 * tasks.view_all, a manager of the assignee, a workflow manager, the
 * assignee, an unrelated member who sees only their own), per-row
 * reassign / take-ownership flags per role, filters, and the URL tab
 * round-trip.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'
import {
  DEFAULT_ACTIVE_FILTERS, hasActiveFilters, nextActiveFilters, parseQueueTab, parseActiveFilters, serializeQueueTab, slaStatus, waitingFor,
} from '@/lib/automations/active-task-filters'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const memory = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})

import { listActiveTasks } from '@/lib/services/active-tasks'

const T = 'ta'
const WF = '0a000000-0000-4000-8000-000000000001'
const WF2 = '0a000000-0000-4000-8000-000000000002'
const task = (id: string, extra: Record<string, unknown>) => ({
  id, tenant_id: T, title: `Task ${id}`, status: 'todo', is_workflow_task: true, event_id: `e-${id}`, assignee_id: null, assigned_team_id: null,
  workflow_id: WF, workflow_run_id: `run-${id}`, acceptance_status: 'accepted', priority: 'medium', created_at: '2026-11-01T00:00:00Z', deleted_at: null, ...extra,
})

function seed() {
  return createMemorySupabase({
    tasks: [
      task('ana-task', { assignee_id: 'ana', due_date: '2020-01-01T00:00:00Z' }),
      task('bob-task', { assignee_id: 'bob', workflow_id: WF2, priority: 'high' }),
      task('unassigned', { workflow_id: WF2 }),
      task('olga-wf', { assignee_id: 'zed', workflow_id: WF }),
      task('done', { assignee_id: 'ana', status: 'completed' }),
      task('other-tenant', { tenant_id: 'tb', assignee_id: 'ana' }),
      task('standard', { assignee_id: 'ana', is_workflow_task: false }),
    ],
    workflows: [{ id: WF, tenant_id: T, name: 'Leave' }, { id: WF2, tenant_id: T, name: 'Expenses' }],
    users: ['owen', 'mia', 'ana', 'bob', 'olga', 'zed'].map((id) => ({ id, display_name: id[0].toUpperCase() + id.slice(1), email: `${id}@x` })),
    user_memberships: [
      { tenant_id: T, user_id: 'ana', manager_user_id: 'mia', is_active: true },
      { tenant_id: T, user_id: 'mia', manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: 'bob', manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: 'zed', manager_user_id: null, is_active: true },
    ],
    object_permissions: [{ tenant_id: T, object_type: 'workflow', object_id: WF2, user_id: 'olga', role_id: null, team_id: null, can_view: true, can_edit: true }],
    user_roles: [], user_teams: [], teams: [], task_assignees: [],
  })
}

function ctx(actorId: string, permissions: string[]): ServiceContext {
  return { db: memory.db, supabase: memory.db, tenantId: T, actorId, permissions: new Set(['tasks.view_own', 'tasks.complete', ...permissions]), authKind: 'session', source: 'ui' }
}
const ids = async (c: ServiceContext, f: Record<string, unknown> = {}) => { memory.db = seed(); return (await listActiveTasks(c, f)).tasks.map((t) => t.id).sort() }

describe('Active tasks visibility (server-side)', () => {
  it('an admin with tasks.view_all sees every open workflow task in the workspace', async () => {
    expect(await ids(ctx('owen', ['tasks.view_all', 'tasks.complete_any']))).toEqual(['ana-task', 'bob-task', 'olga-wf', 'unassigned'])
  })

  it('a manager sees their reporting chain\'s tasks (and their own)', async () => {
    expect(await ids(ctx('mia', []))).toEqual(['ana-task'])
  })

  it('a workflow manager (Edit grant) sees that workflow\'s tasks', async () => {
    expect(await ids(ctx('olga', []))).toEqual(['bob-task', 'unassigned'])
  })

  it('the assignee and an unrelated member see only their own', async () => {
    expect(await ids(ctx('ana', []))).toEqual(['ana-task'])
    expect(await ids(ctx('zed', []))).toEqual(['olga-wf'])
    expect(await ids(ctx('nobody', []))).toEqual([])
  })

  it('per-row actions follow the reassign rules', async () => {
    memory.db = seed()
    const admin = await listActiveTasks(ctx('owen', ['tasks.view_all', 'tasks.complete_any']))
    const row = (page: any, id: string) => page.tasks.find((t: any) => t.id === id)
    expect(admin.can_bulk_reassign).toBe(true)
    expect(admin.scope).toBe('all')
    expect(row(admin, 'unassigned')).toMatchObject({ state: 'unassigned', can_take_ownership: true, can_reassign: true, assignee: null })
    expect(row(admin, 'ana-task')).toMatchObject({ state: 'assigned', assignee: { name: 'Ana' }, sla: 'overdue', workflow: { name: 'Leave' } })
    memory.db = seed()
    const manager = await listActiveTasks(ctx('mia', []))
    expect(manager.can_bulk_reassign).toBe(false)
    expect(row(manager, 'ana-task')).toMatchObject({ can_reassign: true })
    memory.db = seed()
    const assignee = await listActiveTasks(ctx('ana', []))
    // The step doesn't allow redirect: the assignee can't reassign it.
    expect(row(assignee, 'ana-task')).toMatchObject({ can_reassign: false, can_take_ownership: false })
    memory.db = seed()
    const wfm = await listActiveTasks(ctx('olga', []))
    expect(row(wfm, 'unassigned')).toMatchObject({ can_take_ownership: true })
    expect(row(wfm, 'bob-task')).toMatchObject({ can_reassign: true })
    memory.db = seed()
    const viewer = await listActiveTasks(ctx('bob', ['tasks.view_all']))
    expect(row(viewer, 'unassigned')).toMatchObject({ can_take_ownership: false, can_reassign: false })
  })

  it('filters: unassigned only, workflow, priority, search, SLA', async () => {
    const admin = ctx('owen', ['tasks.view_all'])
    expect(await ids(admin, { unassigned: true })).toEqual(['unassigned'])
    expect(await ids(admin, { workflow: WF2 })).toEqual(['bob-task', 'unassigned'])
    expect(await ids(admin, { priority: 'high' })).toEqual(['bob-task'])
    expect(await ids(admin, { search: 'olga' })).toEqual(['olga-wf'])
    expect(await ids(admin, { sla: 'overdue' })).toEqual(['ana-task'])
    expect(await ids(admin, { assignee: 'bob' })).toEqual(['bob-task'])
  })
})

describe('Active tasks URL (tab round-trip)', () => {
  it('?tab=tasks and the wt_ filters survive a round trip; other params are kept', () => {
    const filters = { ...DEFAULT_ACTIVE_FILTERS, search: 'leave', workflow: WF, waiting: '3d' as const, sla: 'overdue' as const, unassigned: true, page: 2, priority: 'high' }
    const qs = serializeQueueTab('tasks', filters, new URLSearchParams('view=active'))
    const params = new URLSearchParams(qs)
    expect(params.get('view')).toBe('active')
    expect(parseQueueTab(params)).toBe('tasks')
    expect(parseActiveFilters(params)).toEqual(filters)
    // Back to Workflows: the tab and its filters leave the URL.
    const back = new URLSearchParams(serializeQueueTab('workflows', filters, params))
    expect(parseQueueTab(back)).toBe('workflows')
    expect([...back.keys()]).toEqual(['view'])
    expect(parseQueueTab(new URLSearchParams(''))).toBe('workflows')
  })

  it('bad values are dropped; a filter change returns to page 1', () => {
    expect(parseActiveFilters(new URLSearchParams('wt_sla=late&wt_workflow=x&wt_size=7&wt_page=-3'))).toEqual(DEFAULT_ACTIVE_FILTERS)
    expect(nextActiveFilters({ ...DEFAULT_ACTIVE_FILTERS, page: 3 }, { unassigned: true }).page).toBe(1)
    expect(nextActiveFilters({ ...DEFAULT_ACTIVE_FILTERS, page: 3 }, { page: 4 }).page).toBe(4)
    expect(hasActiveFilters(DEFAULT_ACTIVE_FILTERS)).toBe(false)
  })

  it('waiting time and SLA status', () => {
    const now = Date.parse('2026-11-10T00:00:00Z')
    expect(waitingFor('2026-11-07T00:00:00Z', now)).toBe('3 days')
    expect(waitingFor('2026-11-09T21:00:00Z', now)).toBe('3 hours')
    expect(slaStatus(null, now)).toBe('none')
    expect(slaStatus('2026-11-09T00:00:00Z', now)).toBe('overdue')
    expect(slaStatus('2026-11-10T10:00:00Z', now)).toBe('due_soon')
    expect(slaStatus('2026-11-20T00:00:00Z', now)).toBe('on_track')
  })
})
