/**
 * Reports reads (providers phase 4, lib/services/ui-reads/reports.ts):
 * permission gate, args, the individual report reading the session user,
 * the workflow reads (incl. the report-analytics RPCs) and the payload
 * trimming / effort aggregation done server-side.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import { collapseEffortRecords } from '@/lib/services/ui-reads/reports'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[] = ['reports.view'], actorId = 'user-1'): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId, permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

/**
 * Memory client plus the bits these reads use that it lacks: `.not(col,'is',null)`,
 * `.lt` (approximated with lte — seeds avoid equal values) and `.rpc`.
 */
function db(seed: Record<string, any[]> = {}, rpc: (fn: string, args: any) => any = () => ({ data: [], error: null })) {
  const memory: any = createMemorySupabase(seed)
  const from = memory.from
  memory.from = (table: string) => {
    const builder = from(table)
    builder.not = (field: string, op: string, value: unknown) => {
      if (op !== 'is' || value !== null) throw new Error(`unsupported not(${op})`)
      return builder.neq(field, null)
    }
    builder.lt = (field: string, value: unknown) => builder.lte(field, value)
    return builder
  }
  memory.rpc = vi.fn(async (fn: string, args: any) => rpc(fn, args))
  return memory
}

const run = (c: ServiceContext, name: string, args?: unknown) => runUiRead(c, { name, args })

describe('reports reads: permission and args', () => {
  const names: Array<[string, unknown]> = [
    ['reports.list', undefined],
    ['reports.get', { id: 'r1' }],
    ['reports.individual', undefined],
    ['reports.tasks', undefined],
    ['reports.integrations', undefined],
    ['reports.retention', undefined],
    ['reports.businessRules', undefined],
    ['reports.workflowHub', { since: '2026-05-01T00:00:00.000Z' }],
    ['reports.workflowOverview', { id: 'wf1' }],
    ['reports.workflowOptions', undefined],
    ['reports.workflowCompare', { a: 'wf1', b: 'wf2', since: '2026-05-01T00:00:00.000Z' }],
  ]

  it.each(names)('%s needs reports.view', async (name, args) => {
    const memory = db()
    const spy = vi.spyOn(memory, 'from')
    expect(await run(ctx(memory, ['tasks.view_own']), name, args)).toMatchObject({ ok: false, status: 403 })
    expect(spy).not.toHaveBeenCalled()
    expect(await run(ctx(db()), name, args)).toMatchObject({ ok: true })
  })

  it('validates ids and dates', async () => {
    expect(await run(ctx(db()), 'reports.get', {})).toMatchObject({ ok: false, status: 400 })
    expect(await run(ctx(db()), 'reports.workflowOverview', { id: '' })).toMatchObject({ ok: false, status: 400 })
    expect(await run(ctx(db()), 'reports.workflowHub', { since: 'yesterday' })).toMatchObject({ ok: false, status: 400 })
    expect(await run(ctx(db()), 'reports.workflowCompare', { a: 'wf1', since: '2026-05-01' })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('saved reports', () => {
  const seed = {
    reports: [
      { id: 'r1', name: 'Old', updated_at: '2026-10-01' },
      { id: 'r2', name: 'New', updated_at: '2026-10-05' },
    ],
  }

  it('lists newest first and gets one by id (null when missing)', async () => {
    const list = await run(ctx(db(seed)), 'reports.list') as any
    expect(list.data.map((r: any) => r.id)).toEqual(['r2', 'r1'])
    expect(await run(ctx(db(seed)), 'reports.get', { id: 'r1' })).toMatchObject({ ok: true, data: { id: 'r1', name: 'Old' } })
    expect(await run(ctx(db(seed)), 'reports.get', { id: 'nope' })).toEqual({ ok: true, data: null })
  })
})

describe('reports.individual', () => {
  it('reads the session user (ctx.actorId), not anyone else', async () => {
    const seed = {
      tasks: [
        { id: 't1', assignee_id: 'user-1', deleted_at: null, updated_at: '2026-10-01', completed_at: null },
        { id: 't2', assignee_id: 'user-2', deleted_at: null, updated_at: '2026-10-02', completed_at: null },
        { id: 't3', assignee_id: 'user-2', actioned_by: 'user-1', deleted_at: null, updated_at: '2026-10-03', completed_at: '2026-10-03' },
        { id: 't4', assignee_id: 'user-1', deleted_at: '2026-10-04', updated_at: '2026-10-04', completed_at: null },
      ],
      task_escalations: [
        { id: 'e1', user_id: 'user-1', created_at: '2026-10-01' },
        { id: 'e2', user_id: 'user-2', created_at: '2026-10-01' },
      ],
      lifecycle_events: [
        { id: 'l1', actor_id: 'user-2', created_at: '2026-10-01' },
        { id: 'l2', actor_id: 'user-1', created_at: '2026-10-02' },
      ],
    }
    const result = await run(ctx(db(seed)), 'reports.individual') as any
    expect(result.data.assignedTasks.map((t: any) => t.id)).toEqual(['t1'])
    expect(result.data.completedTasks.map((t: any) => t.id)).toEqual(['t3'])
    expect(result.data.escalations.map((e: any) => e.id)).toEqual(['e1'])
    expect(result.data.lifecycleEvents.map((e: any) => e.id)).toEqual(['l2'])

    const other = await run(ctx(db(seed), ['reports.view'], 'user-2'), 'reports.individual') as any
    expect(other.data.assignedTasks.map((t: any) => t.id)).toEqual(['t3', 't2'])
  })
})

describe('pre-built reports', () => {
  it('task report: overdue/recent lists, assignee names, effort collapsed per task', async () => {
    const past = new Date(Date.now() - 5 * 86400000).toISOString()
    const future = new Date(Date.now() + 5 * 86400000).toISOString()
    const seed = {
      tasks: [
        { id: 't1', status: 'todo', due_date: past, assignee_id: 'u1', deleted_at: null, parent_task_id: null, created_at: past },
        { id: 't2', status: 'todo', due_date: future, assignee_id: 'u2', deleted_at: null, parent_task_id: null, created_at: past },
        { id: 't3', status: 'completed', completed_at: past, assignee_id: 'u2', deleted_at: null, parent_task_id: null, created_at: past },
        { id: 't4', status: 'todo', due_date: past, deleted_at: null, parent_task_id: 't1', created_at: past },
      ],
      users: [{ id: 'u1', display_name: 'Ann' }, { id: 'u2', display_name: 'Bob' }, { id: 'u3', display_name: 'Cy' }],
      effort_records: [
        { task_id: 't1', minutes: 30, record_type: 'assigner_estimate' },
        { task_id: 't1', minutes: 20, record_type: 'actual' },
        { task_id: 't1', minutes: 15, record_type: 'timer_entry' },
        { task_id: 't2', minutes: 10, record_type: 'assigner_estimate' },
      ],
    }
    const { data } = await run(ctx(db(seed)), 'reports.tasks') as any
    expect(data.allTasks.map((t: any) => t.id).sort()).toEqual(['t1', 't2', 't3'])
    expect(data.overdueTasks.map((t: any) => t.id).sort()).toEqual(['t1', 't4'])
    expect(data.recentCompleted).toMatchObject([{ id: 't3', assignee_name: 'Bob' }])
    expect(data.completedRecent.map((t: any) => t.id)).toEqual(['t3'])
    expect(data.userMap).toEqual({ u1: 'Ann', u2: 'Bob' })
    expect(data.effortRecords).toEqual([
      { task_id: 't1', minutes: 30, record_type: 'assigner_estimate' },
      { task_id: 't1', minutes: 35, record_type: 'actual' },
    ])
  })

  it('collapsed effort records give the same estimated-vs-actual pairs as the raw ones', () => {
    const raw = [
      { task_id: 'a', minutes: 10, record_type: 'assigner_estimate' },
      { task_id: 'a', minutes: 5, record_type: 'assigner_estimate' },
      { task_id: 'a', minutes: 7, record_type: 'timer_entry' },
      { task_id: 'b', minutes: 0, record_type: 'assigner_estimate' },
      { task_id: 'b', minutes: 9, record_type: 'actual' },
      { task_id: 'c', minutes: 3, record_type: 'assignee_estimate' },
    ]
    const pairs = (records: any[]) => {
      const m = new Map<string, { estimated: number; actual: number }>()
      records.forEach((r) => {
        if (!m.has(r.task_id)) m.set(r.task_id, { estimated: 0, actual: 0 })
        const e = m.get(r.task_id)!
        if (r.record_type === 'assigner_estimate') e.estimated += r.minutes
        else if (r.record_type === 'actual' || r.record_type === 'timer_entry') e.actual += r.minutes
      })
      return [...m.values()].filter((e) => e.estimated > 0 && e.actual > 0)
    }
    expect(pairs(collapseEffortRecords(raw))).toEqual(pairs(raw))
    expect(pairs(raw)).toEqual([{ estimated: 15, actual: 7 }])
  })

  it('retention report counts governed assets without their row data', async () => {
    const seed = {
      retention_policies: [{ id: 'p2', name: 'B' }, { id: 'p1', name: 'A' }],
      custom_tables: [{ id: 'ct1', name: 'T', retention_policy_id: 'p1' }, { id: 'ct2', name: 'U', retention_policy_id: null }],
      custom_table_rows: [{ id: 'row1', data: { secret: 1 }, retention_policy_id: 'p1' }, { id: 'row2', data: {}, retention_policy_id: null }],
      roles: [{ id: 'ro1', name: 'R', retention_policy_id: 'p2' }],
      retention_review_events: [], retention_execution_events: [],
    }
    const memory = db(seed)
    const selects: Record<string, string> = {}
    const from = memory.from
    memory.from = (table: string) => {
      const b = from(table)
      const select = b.select
      b.select = (cols: string, ...rest: any[]) => { selects[table] = cols; return select(cols, ...rest) }
      return b
    }
    const { data } = await run(ctx(memory), 'reports.retention') as any
    expect(data.policies.map((p: any) => p.id)).toEqual(['p1', 'p2'])
    expect(data.tables.map((t: any) => t.id)).toEqual(['ct1'])
    expect(data.rows.map((r: any) => r.id)).toEqual(['row1'])
    expect(data.roles.map((r: any) => r.id)).toEqual(['ro1'])
    expect(selects.custom_table_rows).toBe('id, retention_policy_id')
  })

  it('business-rules logs carry only the metadata fields the report reads', async () => {
    const seed = {
      workflow_logs: [
        { id: 'l1', node_type: 'decision_table', created_at: '2026-10-01', metadata: { matched: true, decision_table_id: 'd1', decision_table_name: 'Rule', rule_label: 'Hi', inputs: { big: 'x' } } },
        { id: 'l2', node_type: 'decision_table', created_at: '2026-10-02', metadata: null },
        { id: 'l3', node_type: 'action', created_at: '2026-10-03', metadata: {} },
      ],
      decision_tables: [{ id: 'd2', name: 'Z' }, { id: 'd1', name: 'A' }],
    }
    const { data } = await run(ctx(db(seed)), 'reports.businessRules') as any
    expect(data.logs.map((l: any) => l.id)).toEqual(['l2', 'l1'])
    expect(data.logs[1].metadata).toEqual({ matched: true, decision_table_id: 'd1', decision_table_name: 'Rule', rule_label: 'Hi' })
    expect(data.logs[0].metadata).toBeNull()
    expect(data.tables.map((t: any) => t.id)).toEqual(['d1', 'd2'])
  })

  it('integrations report returns integrations, references and connectors', async () => {
    const { data } = await run(ctx(db({
      integrations: [{ id: 'i1', name: 'X' }], integration_references: [{ id: 'ref1', integration_id: 'i1' }], tenant_connectors: [{ id: 'c1' }],
    })), 'reports.integrations') as any
    expect(data).toMatchObject({ integrations: [{ id: 'i1' }], references: [{ id: 'ref1' }], connectors: [{ id: 'c1' }] })
  })
})

describe('workflow reports', () => {
  const seed = () => ({
    workflows: [
      { id: 'wf2', name: 'Beta', nodes: [{ id: 'n1', type: 'run_agent', config: { agent_id: 'ag1' } }] },
      { id: 'wf1', name: 'Alpha', nodes: '[]' },
    ],
    workflow_queue: [
      { id: 'q1', workflow_id: 'wf1', status: 'pending' },
      { id: 'q2', workflow_id: 'wf2', status: 'running' },
      { id: 'q3', workflow_id: 'wf2', status: 'done' },
    ],
    tasks: [{ id: 't1', title: 'Start', assigner_id: 'u1' }],
    users: [{ id: 'u1', display_name: 'Ann', email: 'a@x' }],
    agent_runs: [
      { id: 'ar1', caller_type: 'workflow_node', caller_id: 'run1', started_at: '2026-10-01' },
      { id: 'ar2', caller_type: 'chat', caller_id: 'run1', started_at: '2026-10-01' },
    ],
    agents: [{ id: 'ag1', name: 'Helper' }],
  })
  const rpc = (fn: string, args: any) => {
    if (fn === 'workflow_run_summaries') {
      return { data: [{ id: 'run1', workflow_id: 'wf2', task_id: 't1' }, { id: 'run2', workflow_id: 'wf1', task_id: null }].filter((r) => args.p_workflow_ids.includes(r.workflow_id)), error: null }
    }
    if (fn === 'workflow_node_visit_stats') return { data: [{ workflow_id: 'wf2', node_id: 'n1', visits: '4' }], error: null }
    if (fn === 'workflow_run_daily_stats') return { data: [{ workflow_id: 'wf1', day: '2026-10-01', total: 3 }], error: null }
    return { data: [], error: null }
  }

  it('hub: workflows by name, live queue, daily stats from the RPC', async () => {
    const memory = db(seed(), rpc)
    const { data } = await run(ctx(memory), 'reports.workflowHub', { since: '2026-05-01T00:00:00.000Z' }) as any
    expect(data.workflows.map((w: any) => w.id)).toEqual(['wf1', 'wf2'])
    expect(data.queueStats.map((q: any) => q.id)).toEqual(['q1', 'q2'])
    expect(data.daily).toEqual([{ workflow_id: 'wf1', day: '2026-10-01', total: 3 }])
    expect(memory.rpc).toHaveBeenCalledWith('workflow_run_daily_stats', { p_since: '2026-05-01T00:00:00.000Z' })
  })

  it('overview: one workflow with its runs, queue, originators and agent runs', async () => {
    const memory = db(seed(), rpc)
    const { data } = await run(ctx(memory), 'reports.workflowOverview', { id: 'wf2' }) as any
    expect(data.workflow).toMatchObject({ id: 'wf2' })
    expect(data.runs.map((r: any) => r.id)).toEqual(['run1'])
    expect(data.queueStats.map((q: any) => q.id)).toEqual(['q2'])
    expect(data.taskById.t1).toMatchObject({ id: 't1', creator: { id: 'u1', display_name: 'Ann' } })
    expect(Object.keys(data.agentRunsByRunId)).toEqual(['run1'])
    expect(data.agentRunsByRunId.run1.map((r: any) => r.id)).toEqual(['ar1'])
    expect(data.agentNameById).toEqual({ ag1: 'Helper' })
    expect(memory.rpc).toHaveBeenCalledWith('workflow_run_summaries', { p_workflow_ids: ['wf2'], p_limit: 2000 })
  })

  it('overview: missing workflow is null, not an error', async () => {
    const { data } = await run(ctx(db(seed(), rpc)), 'reports.workflowOverview', { id: 'nope' }) as any
    expect(data.workflow).toBeNull()
  })

  it('compare: split per workflow; failed aggregates show as no runs', async () => {
    const args = { a: 'wf1', b: 'wf2', since: '2026-05-01T00:00:00.000Z' }
    const { data } = await run(ctx(db(seed(), rpc)), 'reports.workflowCompare', args) as any
    expect(data.workflowA).toMatchObject({ id: 'wf1' })
    expect(data.workflowB).toMatchObject({ id: 'wf2' })
    expect(data.runsA.map((r: any) => r.id)).toEqual(['run2'])
    expect(data.runsB.map((r: any) => r.id)).toEqual(['run1'])
    expect(data.queueA.map((q: any) => q.id)).toEqual(['q1'])
    expect(data.queueB.map((q: any) => q.id)).toEqual(['q2'])
    expect(data.visitsA).toEqual({})
    expect(data.visitsB).toEqual({ n1: 4 })

    const failing = await run(ctx(db(seed(), () => ({ data: null, error: { message: 'boom' } }))), 'reports.workflowCompare', args) as any
    expect(failing).toMatchObject({ ok: true, data: { runsA: [], runsB: [], visitsA: {}, visitsB: {} } })
  })

  it('options list workflows by name', async () => {
    const { data } = await run(ctx(db(seed())), 'reports.workflowOptions') as any
    expect(data.map((w: any) => w.id)).toEqual(['wf1', 'wf2'])
  })
})
