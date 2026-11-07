/**
 * Workflow queue / run visibility tiers (lib/services/run-visibility), the
 * one scope every queue and run list applies (governance audit 2026-11):
 * all runs (view_runs), explicit workflow grant (every run of that workflow),
 * involved-only (view_queue), no access.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const memory = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})

import {
  queueJobInScope, queueScopeFilter, resolveRunScope, runInScope, runScopeFilter,
} from '@/lib/services/run-visibility'

const T = 'tenant-a'
const id = (n: number) => `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const WF_GRANTED = id(1), WF_OTHER = id(2)
const RUN_STARTED = id(11), RUN_SUBMITTED = id(12), RUN_ASSIGNED = id(13), RUN_COLLAB = id(14), RUN_OTHER = id(15), RUN_GRANTED = id(16), RUN_OTHER_TENANT = id(17)
const ME = id(100), ROLE = id(200), TEAM = id(300), SUB = id(400)

function seed() {
  return createMemorySupabase({
    workflow_runs: [
      { id: RUN_STARTED, tenant_id: T, workflow_id: WF_OTHER, started_by: ME, started_at: '2026-11-01' },
      { id: RUN_SUBMITTED, tenant_id: T, workflow_id: WF_OTHER, form_submission_id: SUB, started_at: '2026-11-02' },
      { id: RUN_ASSIGNED, tenant_id: T, workflow_id: WF_OTHER, started_at: '2026-11-03' },
      { id: RUN_COLLAB, tenant_id: T, workflow_id: WF_OTHER, started_at: '2026-11-04' },
      { id: RUN_OTHER, tenant_id: T, workflow_id: WF_OTHER, started_at: '2026-11-05' },
      { id: RUN_GRANTED, tenant_id: T, workflow_id: WF_GRANTED, started_at: '2026-11-06' },
      { id: RUN_OTHER_TENANT, tenant_id: 'tenant-b', workflow_id: WF_OTHER, started_by: ME, started_at: '2026-11-07' },
    ],
    form_submissions: [{ id: SUB, tenant_id: T, submitted_by: ME, created_at: '2026-11-02' }],
    tasks: [
      { id: 't1', tenant_id: T, assignee_id: ME, workflow_run_id: RUN_ASSIGNED, created_at: '2026-11-03' },
      { id: 't2', tenant_id: T, assignee_id: id(101), workflow_run_id: RUN_COLLAB, created_at: '2026-11-04' },
      { id: 't3', tenant_id: T, assignee_id: id(101), workflow_run_id: RUN_OTHER, created_at: '2026-11-05' },
    ],
    task_assignees: [{ id: 'ta1', tenant_id: T, task_id: 't2', user_id: ME }],
    user_roles: [{ tenant_id: T, user_id: ME, role_id: ROLE }],
    user_teams: [{ user_id: ME, team_id: TEAM }],
    teams: [{ id: TEAM, tenant_id: T }],
    object_permissions: [],
  }) as any
}

function ctx(permissions: string[], actorId: string | null = ME): ServiceContext {
  return { db: memory.db, supabase: memory.db, tenantId: T, actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

describe('run visibility tiers', () => {
  it('no queue permission: no access (403)', async () => {
    memory.db = seed()
    await expect(resolveRunScope(ctx(['workflows.view', 'tasks.view_own']))).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('view_runs (Admin / Owner / Manager): every run and queue item', async () => {
    memory.db = seed()
    const scope = await resolveRunScope(ctx(['workflows.view_runs']))
    expect(scope).toEqual({ kind: 'all' })
    expect(runScopeFilter(scope)).toBeNull()
    expect(queueScopeFilter(scope)).toBeNull()
    expect(runInScope(scope, { id: RUN_OTHER, workflow_id: WF_OTHER })).toBe(true)
  })

  it('view_queue: only the runs the person is involved in (started, own submission, assignee, collaborator)', async () => {
    memory.db = seed()
    const scope = await resolveRunScope(ctx(['workflows.view_queue']))
    expect(scope.kind).toBe('scoped')
    if (scope.kind !== 'scoped') return
    expect(scope.workflowIds).toEqual([])
    expect([...scope.runIds].sort()).toEqual([RUN_STARTED, RUN_SUBMITTED, RUN_ASSIGNED, RUN_COLLAB].sort())
    expect(runInScope(scope, { id: RUN_OTHER, workflow_id: WF_OTHER })).toBe(false)
    expect(runInScope(scope, { id: RUN_GRANTED, workflow_id: WF_GRANTED })).toBe(false)
    expect(scope.runIds).not.toContain(RUN_OTHER_TENANT)
  })

  it.each([
    ['the person', { user_id: ME }],
    ['a role they hold', { role_id: ROLE }],
    ['a team they are in', { team_id: TEAM }],
  ])('explicit View grant on a workflow (to %s): every run of that workflow', async (_label, grantee) => {
    memory.db = seed()
    memory.db.tables.object_permissions.push({ tenant_id: T, object_type: 'workflow', object_id: WF_GRANTED, can_view: true, ...grantee })
    const scope = await resolveRunScope(ctx(['workflows.view_queue']))
    if (scope.kind !== 'scoped') throw new Error('expected scoped')
    expect(scope.workflowIds).toEqual([WF_GRANTED])
    expect(runInScope(scope, { id: RUN_GRANTED, workflow_id: WF_GRANTED })).toBe(true)
    expect(runInScope(scope, { id: id(999), workflow_id: WF_GRANTED })).toBe(true)
    expect(runInScope(scope, { id: RUN_OTHER, workflow_id: WF_OTHER })).toBe(false)
  })

  it('grants without View, on other object types, or in other workspaces do not count', async () => {
    memory.db = seed()
    memory.db.tables.object_permissions.push(
      { tenant_id: T, object_type: 'workflow', object_id: WF_GRANTED, can_view: false, user_id: ME },
      { tenant_id: T, object_type: 'form', object_id: WF_GRANTED, can_view: true, user_id: ME },
      { tenant_id: 'tenant-b', object_type: 'workflow', object_id: WF_OTHER, can_view: true, user_id: ME },
    )
    const scope = await resolveRunScope(ctx(['workflows.view_queue']))
    if (scope.kind !== 'scoped') throw new Error('expected scoped')
    expect(scope.workflowIds).toEqual([])
  })

  it('tenant-wide credentials (no user) with view_queue alone see nothing', async () => {
    memory.db = seed()
    const scope = await resolveRunScope(ctx(['workflows.view_queue'], null))
    expect(scope).toEqual({ kind: 'scoped', userId: null, workflowIds: [], runIds: [] })
    expect(runScopeFilter(scope)).toBe('id.eq.00000000-0000-0000-0000-000000000000')
  })

  it('filters: workflow grants OR involved runs; queue jobs also by their run and their signed initiator', () => {
    const scope = { kind: 'scoped' as const, userId: ME, workflowIds: [WF_GRANTED], runIds: [RUN_STARTED] }
    expect(runScopeFilter(scope)).toBe(`workflow_id.in.(${WF_GRANTED}),id.in.(${RUN_STARTED})`)
    expect(queueScopeFilter(scope)).toBe(`workflow_id.in.(${WF_GRANTED}),result->>run_id.in.(${RUN_STARTED}),trigger_data->_started_by->>user_id.eq.${ME}`)
    expect(queueJobInScope(scope, { workflow_id: WF_OTHER, result: { run_id: RUN_STARTED } })).toBe(true)
    expect(queueJobInScope(scope, { workflow_id: WF_OTHER, trigger_data: { _started_by: { user_id: ME } } })).toBe(true)
    expect(queueJobInScope(scope, { workflow_id: WF_OTHER, result: { run_id: RUN_OTHER } })).toBe(false)
    // Ids are validated before they reach a filter string.
    expect(runScopeFilter({ kind: 'scoped', userId: ME, workflowIds: ['x),id.neq.(y'], runIds: [] })).toBe('id.eq.00000000-0000-0000-0000-000000000000')
  })
})
