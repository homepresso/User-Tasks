/**
 * Automations dashboard reads (providers phase 4): permissions, argument
 * validation, and the queries/aggregation that moved server-side from the
 * workflow pages, the designer's pickers and the live log tail.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

/** Memory client plus the bits it lacks: `.not()` (ignored) and the live-count RPC. */
function db() {
  const memory: any = createMemorySupabase({
    workflows: [
      { id: 'wf1', tenant_id: 'tenant-a', name: 'Onboard', trigger_type: 'schedule', is_active: true, published_version_id: 'v2', updated_at: '2026-10-02', tags: null,
        nodes: [{ id: 'n1', type: 'schedule', config: { schedule_mode: 'daily', time_of_day: '09:00' } }, { id: 'n2', type: 'update_data_table', config: { tableId: 't1' } }, { id: 'n3', type: 'trigger_workflow', config: { workflow_id: 'wf2' } }] },
      { id: 'wf2', tenant_id: 'tenant-a', name: 'Child', trigger_type: 'workflow_error', is_active: false, updated_at: '2026-10-03', nodes: [] },
    ],
    workflow_versions: [
      { id: 'v1', workflow_id: 'wf1', tenant_id: 'tenant-a', version_number: 1, nodes: [{ id: 'old' }] },
      { id: 'v2', workflow_id: 'wf1', tenant_id: 'tenant-a', version_number: 2, nodes: [{ id: 'new' }] },
    ],
    workflow_runs: [
      { id: 'r1', workflow_id: 'wf1', version_id: 'v1', status: 'completed', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:00:10Z' },
      // (The memory client doesn't resolve embeds, so r2 carries its workflow.)
      { id: 'r2', workflow_id: 'wf1', workflow: { id: 'wf1', nodes: [] }, version_id: 'v2', status: 'failed', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:05Z' },
      { id: 'r3', workflow_id: 'wf1', version_id: 'v2', status: 'running', started_at: '2026-10-03T00:00:00Z', completed_at: null },
      { id: 'r4', workflow_id: 'wf2', status: 'completed', started_at: '2026-10-03T00:00:00Z', completed_at: '2026-10-03T00:00:30Z' },
    ],
    workflow_logs: [
      { id: 'l2', run_id: 'r2', created_at: '2026-10-02T00:00:02Z' },
      { id: 'l1', run_id: 'r2', created_at: '2026-10-02T00:00:01Z' },
      { id: 'l3', run_id: 'r1', created_at: '2026-10-01T00:00:01Z' },
    ],
    workflow_queue: [
      { id: 'q1', workflow_id: 'wf1', status: 'pending', created_at: '2026-10-02T00:00:00Z', started_at: '2026-10-02T00:00:03Z', result: null },
      { id: 'q2', workflow_id: 'wf1', status: 'failed', created_at: '2026-10-01T00:00:00Z', started_at: null, result: null },
    ],
    tasks: [{ id: 'task1', source_workflow_id: 'wf1' }, { id: 'task2', source_workflow_id: 'wf2' }],
    workflow_webhooks: [{ id: 'wh1', workflow_id: 'wf1' }],
    custom_tables: [{ id: 't1', name: 'Customers' }, { id: 't2', name: 'Accounts' }],
    custom_table_rows: [
      { id: 'row1', table_id: 't1', data: {}, created_at: '2026-10-01' },
      { id: 'row2', table_id: 't1', data: {}, created_at: '2026-10-02' },
      { id: 'row3', table_id: 't2', data: {}, created_at: '2026-10-03' },
    ],
    decision_tables: [{ id: 'dt1', name: 'Bands', updated_at: '2026-10-01' }, { id: 'dt2', name: 'Approvers', updated_at: '2026-10-02' }],
    node_favorites: [{ tenant_id: 'tenant-a', node_type: 'send_email' }, { tenant_id: 'tenant-b', node_type: 'http' }],
    integration_call_logs: [
      { id: 'c1', started_at: '2026-10-01T00:00:00Z' },
      { id: 'c2', started_at: '2026-10-05T00:00:00Z' },
    ],
  })
  const from = memory.from
  memory.from = (table: string) => {
    const builder = from(table)
    builder.not = () => builder
    return builder
  }
  memory.rpc = vi.fn(async () => ({ data: [{ version_id: 'v1', instances: 2 }, { version_id: 'v2', instances: '1' }], error: null }))
  return memory
}

const VIEW = ['workflows.view']

describe('automations reads: permissions', () => {
  it.each([
    ['automations.list', undefined],
    ['automations.builder', { id: 'wf1' }],
    ['automations.dependencies', { workflowId: 'wf1' }],
    ['automations.decisionTables', undefined],
    ['automations.tableRows', { tableId: 't1', limit: 10 }],
  ])('%s needs workflows.view', async (name, args) => {
    expect(await runUiRead(ctx(db(), VIEW), { name, args })).toMatchObject({ ok: true })
    expect(await runUiRead(ctx(db(), ['tasks.view_own']), { name, args })).toMatchObject({ ok: false, status: 403 })
  })

  it('run reads accept workflows.view or workflows.view_runs', async () => {
    for (const perms of [['workflows.view'], ['workflows.view_runs']]) {
      expect(await runUiRead(ctx(db(), perms), { name: 'automations.workflowRunStats', args: { workflowId: 'wf1' } })).toMatchObject({ ok: true })
    }
    expect(await runUiRead(ctx(db(), ['tasks.view_own']), { name: 'automations.processView', args: { id: 'r1' } })).toMatchObject({ ok: false, status: 403 })
  })

  it('the queue needs workflows.view_runs (its route gate)', async () => {
    expect(await runUiRead(ctx(db(), ['workflows.view_runs']), { name: 'automations.queue' })).toMatchObject({ ok: true })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'automations.queue' })).toMatchObject({ ok: false, status: 403 })
  })

  it('the live log tail needs settings.view (the logs page gate)', async () => {
    const args = { source: 'integration', since: '2026-10-02T00:00:00Z' }
    expect(await runUiRead(ctx(db(), ['settings.view']), { name: 'automations.liveLogs', args })).toMatchObject({ ok: true })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'automations.liveLogs', args })).toMatchObject({ ok: false, status: 403 })
  })
})

describe('automations reads: arguments', () => {
  it.each([
    ['automations.builder', {}],
    ['automations.workflowRuns', { workflowId: 'wf1', sortKey: 'name', sortDir: 'asc', page: 0 }],
    ['automations.workflowRuns', { workflowId: 'wf1', sortKey: 'status', sortDir: 'asc', page: -1 }],
    ['automations.tableRows', { tableId: 't1', limit: 5000 }],
    ['automations.retentionPolicyOptions', { select: '*, secrets' }],
    ['automations.triggerSourceWorkflows', { exclude: 'schedule' }],
    ['automations.liveLogs', { source: 'users', since: '2026-10-01' }],
    ['automations.definitionNodes', { workflowId: 'x'.repeat(201) }],
  ])('%s rejects %j', async (name, args) => {
    expect(await runUiRead(ctx(db(), [...VIEW, 'workflows.view_runs', 'settings.view']), { name, args })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('automations reads: queries', () => {
  const run = (name: string, args?: unknown, perms = [...VIEW, 'workflows.view_runs', 'settings.view']) =>
    runUiRead(ctx(db(), perms), { name, args }).then((r) => {
      if (!r.ok) throw new Error(r.error)
      return r.data as any
    })

  it('list orders by updated_at desc and normalises tags', async () => {
    const rows = await run('automations.list')
    expect(rows.map((r: any) => r.id)).toEqual(['wf2', 'wf1'])
    expect(rows[0].tags).toBeNull()
  })

  it('builder: workflow, its runs, published version and live badge counts', async () => {
    const data = await run('automations.builder', { id: 'wf1' })
    expect(data.workflow).toMatchObject({ id: 'wf1' })
    expect(data.runs.map((r: any) => r.id)).toEqual(['r3', 'r2', 'r1'])
    expect(data.publishedVersionNumber).toBe(2)
    expect(data).toMatchObject({ liveInstances: 3, liveOnOlder: 2 })
    expect(await run('automations.builder', { id: 'missing' })).toBeNull()
  })

  it('workflow runs page: filter, sort, page; stats computed server-side', async () => {
    const page = await run('automations.workflowRuns', { workflowId: 'wf1', status: 'completed', sortKey: 'started_at', sortDir: 'desc', page: 0 })
    expect(page).toMatchObject({ total: 1, rows: [{ id: 'r1' }] })
    const all = await run('automations.workflowRuns', { workflowId: 'wf1', sortKey: 'started_at', sortDir: 'asc', page: 0 })
    expect(all.rows.map((r: any) => r.id)).toEqual(['r1', 'r2', 'r3'])
    expect(await run('automations.workflowRunStats', { workflowId: 'wf1' }))
      .toEqual({ total: 3, completed: 1, failed: 1, running: 1, avgDuration: 10_000, successRate: 50 })
  })

  it('process view: the run, the version it executes, its logs in order', async () => {
    const data = await run('automations.processView', { id: 'r2' })
    expect(data.run).toMatchObject({ id: 'r2' })
    expect(data.versionNumber).toBe(2)
    expect(data.workflow.nodes).toEqual([{ id: 'new' }])
    expect(data.logs.map((l: any) => l.id)).toEqual(['l1', 'l2'])
    expect(data.compareRun).toMatchObject({ id: 'r1' })
  })

  it('queue: status counts, jobs matched to runs, awaiting/paused counts', async () => {
    const data = await run('automations.queue')
    expect(data.counts).toEqual({ pending: 1, processing: 0, failed: 1, completed: 0, dead: 0 })
    expect(data.jobs.map((j: any) => j.id)).toEqual(['q1', 'q2'])
    // q1 started 3s after r2 → matched to it.
    expect(data.jobs[0].result).toEqual({ run_id: 'r2' })
    expect(Object.keys(data.runs).sort()).toEqual(['r1', 'r2', 'r3'])
  })

  it('definition nodes come from the run version, else the draft', async () => {
    expect(await run('automations.definitionNodes', { workflowId: 'wf1', versionId: 'v1' })).toEqual([{ id: 'old' }])
    expect((await run('automations.definitionNodes', { workflowId: 'wf1' })).map((n: any) => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('dependencies: counts and the assets the nodes name', async () => {
    expect(await run('automations.dependencies', { workflowId: 'wf1' })).toMatchObject({
      runs: 3, tasks: 1, webhooks: 1,
      customTables: [{ id: 't1' }],
      references: [],
      childWorkflows: [{ id: 'wf2' }],
    })
  })

  it('scheduled workflows return the schedule config, not the definition', async () => {
    const rows = await run('automations.scheduled')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'wf1' })
    expect(rows[0]).not.toHaveProperty('nodes')
    expect(rows[0].config).not.toBeNull()
  })

  it('version history: versions newest first with live counts per version', async () => {
    const data = await run('automations.versionHistory', { workflowId: 'wf1' })
    expect(data.versions.map((v: any) => v.id)).toEqual(['v2', 'v1'])
    expect(data.liveCounts).toEqual({ v1: 2, v2: 1 })
  })

  it('decision tables list and detail', async () => {
    expect((await run('automations.decisionTables')).map((t: any) => t.id)).toEqual(['dt2', 'dt1'])
    expect(await run('automations.decisionTable', { id: 'dt1' })).toMatchObject({ id: 'dt1' })
    expect(await run('automations.decisionTable', { id: 'nope' })).toBeNull()
  })

  it('pickers: table rows by table (newest first, limited), trigger sources exclude their kind', async () => {
    expect((await run('automations.tableRows', { tableId: 't1', limit: 1 })).map((r: any) => r.id)).toEqual(['row2'])
    expect((await run('automations.triggerSourceWorkflows', { exclude: 'workflow_error' })).map((w: any) => w.id)).toEqual(['wf1'])
    expect((await run('automations.tableOptions', { limit: 1 })).map((t: any) => t.id)).toEqual(['t2'])
  })

  it('node favorites are filtered by the tenant passed', async () => {
    expect(await run('automations.nodeFavorites', { tenantId: 'tenant-a' })).toEqual(['send_email'])
  })

  it('current tenant comes from the session, not the browser', async () => {
    expect(await run('automations.currentTenant')).toEqual({ tenantId: 'tenant-a' })
  })

  it('live logs: rows since the tail started, on the source timestamp column', async () => {
    const rows = await run('automations.liveLogs', { source: 'integration', since: '2026-10-02T00:00:00Z' })
    expect(rows.map((r: any) => r.id)).toEqual(['c2'])
  })
})
