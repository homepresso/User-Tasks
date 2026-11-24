/**
 * Run history and statistics for an extension's own workflows and forms
 * (lib/extensions/insights-host.ts): ctx.workflows.history / stats and
 * ctx.forms.submissionStats see only the extension's own workflows and bound
 * forms in the caller's workspace, follow the run-list visibility rule
 * (view_runs / view_queue), hide task assignees without view_runs or
 * tasks.view_all, never return submission values, and aggregate the same
 * way in the database (RPC) and in the bounded fallback.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { createExtensionContext } from '@/lib/extensions/host'
import { aggregateRuns, clearStatsCache, percentileCont, period, runGroup } from '@/lib/extensions/insights-host'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000c0001'
const OTHER = '0e000000-0000-4000-8000-0000000c0002'
const ANA = '0e000000-0000-4000-8000-0000000c0101'
const BEN = '0e000000-0000-4000-8000-0000000c0102'
const W1 = '0e000000-0000-4000-8000-0000000c0201'
const W2 = '0e000000-0000-4000-8000-0000000c0202'
const PLAIN = '0e000000-0000-4000-8000-0000000c0203'
const ELSEWHERE = '0e000000-0000-4000-8000-0000000c0204'
const V1 = '0e000000-0000-4000-8000-0000000c0301'
const TEAM = '0e000000-0000-4000-8000-0000000c0401'
const F_NEW = '0e000000-0000-4000-8000-0000000c0501'
const F_EDIT = '0e000000-0000-4000-8000-0000000c0502'
const F_PLAIN = '0e000000-0000-4000-8000-0000000c0503'
const run = (n: number) => `0e000000-0000-4000-8000-0000000c06${String(n).padStart(2, '0')}`

const manifest = {
  manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'free' }, deployments: ['cloud', 'self_hosted'],
  contributes: { triggers: [{ key: 'changed', label: 'Changed', description: 'x', config: [], variables: [] }] },
}

const NOW = new Date('2026-11-14T12:00:00Z')
const at = (daysAgo: number, h = 9, m = 0) => new Date(Date.UTC(2026, 10, 14 - daysAgo, h, m)).toISOString()
const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString()

function seed() {
  const runs = [
    { id: run(1), tenant_id: TENANT, workflow_id: W1, status: 'completed', started_at: at(0, 8), completed_at: plus(at(0, 8), 4000), started_by: null, title: null },
    { id: run(2), tenant_id: TENANT, workflow_id: W1, status: 'failed', started_at: at(1), completed_at: plus(at(1), 1000), error: 'Upstream system said no', started_by: null },
    { id: run(3), tenant_id: TENANT, workflow_id: W1, status: 'paused', started_at: at(0, 10), completed_at: at(0, 10, 1) /* the engine stamps the pause */, paused_node_id: 'approve', version_id: V1, started_by: ANA },
    { id: run(4), tenant_id: TENANT, workflow_id: W2, status: 'completed', started_at: at(2), completed_at: plus(at(2), 10000) },
    { id: run(5), tenant_id: TENANT, workflow_id: W2, status: 'cancelled', started_at: at(3), completed_at: plus(at(3), 500) },
    { id: run(6), tenant_id: TENANT, workflow_id: W1, status: 'completed', started_at: at(20), completed_at: plus(at(20), 2000) }, // outside 7 days
    { id: run(7), tenant_id: TENANT, workflow_id: PLAIN, status: 'completed', started_at: at(0), completed_at: plus(at(0), 1) },
    { id: run(8), tenant_id: OTHER, workflow_id: ELSEWHERE, status: 'completed', started_at: at(0), completed_at: plus(at(0), 1) },
    { id: run(9), tenant_id: TENANT, workflow_id: W2, status: 'running', started_at: at(0, 11, 30), completed_at: null },
    { id: run(10), tenant_id: TENANT, workflow_id: W2, status: 'failed', error: 'Manually cancelled', started_at: at(30), completed_at: plus(at(30), 100) }, // a person cancelled it (outside 7 days)
  ]
  const job = (n: number, wf: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id: `q${n}`, tenant_id: TENANT, workflow_id: wf, trigger_type: 'ext.acme.changed', status: 'completed', trigger_data: data, result: { run_id: run(n) }, created_at: plus(runs.find((r) => r.id === run(n))?.started_at ?? at(0), -500), ...extra })
  db.current = createMemorySupabase({
    workflows: [
      { id: W1, tenant_id: TENANT, name: 'Approve claims', trigger_type: 'ext.acme.changed', nodes: [{ id: 'trigger', type: 'ext.acme.changed' }, { id: 'approve', type: 'user_task', label: 'Draft approval' }], updated_at: '2026-11-14T09:00:00Z' },
      { id: W2, tenant_id: TENANT, name: 'Archive', trigger_type: 'ext.acme.changed', nodes: [], updated_at: '2026-11-13T09:00:00Z' },
      { id: PLAIN, tenant_id: TENANT, name: 'Plain', trigger_type: 'manual', nodes: [], updated_at: '2026-11-14T09:00:00Z' },
      { id: ELSEWHERE, tenant_id: OTHER, name: 'Elsewhere', trigger_type: 'ext.acme.changed', nodes: [], updated_at: '2026-11-14T09:00:00Z' },
    ],
    workflow_versions: [{ id: V1, workflow_id: W1, nodes: [{ id: 'approve', type: 'user_task', label: 'Manager approval' }] }],
    workflow_runs: runs,
    workflow_queue: [
      job(1, W1, { event: 'created', item_id: 7, title: 'Taxi', item_url: 'http://sp/7', amount: 99 }),
      job(2, W1, { event: 'updated', item_id: 8, title: 'Hotel', nested: { x: 1 } }),
      job(3, W1, { event: 'created', item_id: 9, title: 'Flight' }),
      { id: 'q3r', tenant_id: TENANT, workflow_id: W1, trigger_type: 'task_resume', status: 'pending', trigger_data: { title: 'resume' }, result: { run_id: run(3) }, created_at: at(0, 11) },
      job(4, W2, { event: 'deleted', item_id: 10 }),
      job(5, W2, { event: 'updated', item_id: 11 }),
      job(9, W2, { event: 'updated', item_id: 12 }),
      { id: 'q-new', tenant_id: TENANT, workflow_id: W1, trigger_type: 'ext.acme.changed', status: 'pending', trigger_data: { event: 'created', item_id: 13, title: 'Lunch', _started_by: { user_id: BEN } }, result: null, created_at: at(0, 11, 59) },
      { id: 'q-plain', tenant_id: TENANT, workflow_id: PLAIN, trigger_type: 'manual', status: 'pending', trigger_data: {}, result: null, created_at: at(0, 11, 59) },
    ],
    tasks: [
      { id: 't1', tenant_id: TENANT, title: 'Approve "Flight"', status: 'todo', assignee_id: BEN, assigned_team_id: null, workflow_run_id: run(3), due_date: at(-2), deleted_at: null, created_at: at(0, 10) },
      { id: 't2', tenant_id: TENANT, title: 'Second look', status: 'in_progress', assignee_id: null, assigned_team_id: TEAM, workflow_run_id: run(3), due_date: null, deleted_at: null, created_at: at(0, 10, 1) },
      { id: 't3', tenant_id: TENANT, title: 'Done already', status: 'completed', assignee_id: BEN, workflow_run_id: run(3), deleted_at: null, created_at: at(0, 10) },
    ],
    teams: [{ id: TEAM, tenant_id: TENANT, name: 'Finance' }],
    users: [{ id: ANA, email: 'ana@contoso.local', display_name: 'Ana B' }, { id: BEN, email: 'ben@contoso.local', display_name: 'Ben C' }],
    forms: [
      { id: F_NEW, tenant_id: TENANT, name: 'Claims – New', version: 2, layout: { rows: [], data_target: { extension: 'acme', key: 'list', config: { role: 'new' } } }, updated_at: '2026-11-10T00:00:00Z' },
      { id: F_EDIT, tenant_id: TENANT, name: 'Claims – Edit', version: 1, layout: { rows: [], data_target: { extension: 'acme', key: 'list', config: { role: 'edit' } } }, updated_at: '2026-11-10T00:00:00Z' },
      { id: F_PLAIN, tenant_id: TENANT, name: 'Plain form', version: 1, layout: { rows: [] }, updated_at: '2026-11-10T00:00:00Z' },
    ],
    form_submissions: [
      { id: 's1', tenant_id: TENANT, form_id: F_NEW, values: { amount: 'SECRET-123' }, created_at: at(0, 9) },
      { id: 's2', tenant_id: TENANT, form_id: F_NEW, values: { amount: 'SECRET-456' }, created_at: at(0, 10) },
      { id: 's3', tenant_id: TENANT, form_id: F_NEW, values: {}, created_at: at(4) },
      { id: 's4', tenant_id: TENANT, form_id: F_EDIT, values: {}, created_at: at(40) },
      { id: 's5', tenant_id: TENANT, form_id: F_PLAIN, values: {}, created_at: at(0) },
      { id: 's6', tenant_id: OTHER, form_id: F_NEW, values: {}, created_at: at(0) },
    ],
  }, { uuids: true }) as any
  return db.current
}

const ctxFor = (permissions: string[] | null, actorId: string | null = ANA) => createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: actorId ?? undefined, permissions: permissions ?? undefined } as any)

describe('ctx.workflows.history', () => {
  beforeEach(() => {
    clearStatsCache()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acme', triggers: { changed: { matches: () => true } } })] })
  })
  afterEach(() => { resetExtensionsForTest(); vi.useRealTimers() })

  it('lists queued jobs, then runs newest first, of its own workflows only, with picked trigger data, steps, tasks and durations', async () => {
    seed()
    const h = await ctxFor(['workflows.view', 'workflows.view_runs']).workflows.history({ pick: ['item_id', 'title', 'item_url', 'nested'], limit: 10 })
    expect(h).toMatchObject({ visibility: 'all', assignees: true, total: 8, queued: 1, hasMore: false })
    expect(h.runs.map((r) => r.runId ?? 'queued')).toEqual(['queued', run(9), run(3), run(1), run(2), run(4), run(5), run(6), run(10)])
    const [queued, running, paused, done, failed] = h.runs
    expect(queued).toMatchObject({ status: 'pending', group: 'waiting', path: null, startedBy: 'Ben C', data: { item_id: 13, title: 'Lunch' } })
    expect(running).toMatchObject({ group: 'running', durationMs: 30 * 60_000, currentStep: null })
    expect(paused).toMatchObject({ group: 'waiting', durationMs: 2 * 3_600_000, currentStep: 'Manager approval', startedBy: 'Ana B', event: 'created', data: { item_id: 9, title: 'Flight' } })
    expect(paused.tasks).toEqual([
      { id: 't2', title: 'Second look', status: 'in_progress', dueAt: null, assignee: null, team: 'Finance' },
      { id: 't1', title: 'Approve "Flight"', status: 'todo', dueAt: at(-2), assignee: 'Ben C', team: null },
    ])
    expect(done).toMatchObject({ group: 'completed', durationMs: 4000, path: `/automations/runs/${run(1)}`, data: { item_id: 7, title: 'Taxi', item_url: 'http://sp/7', nested: null }, workflowName: 'Approve claims' })
    expect(done.data).not.toHaveProperty('amount')
    expect(failed).toMatchObject({ group: 'failed', error: 'Upstream system said no' })
    expect(h.runs.some((r) => r.workflowId === PLAIN || r.workflowId === ELSEWHERE)).toBe(false)
  })

  it('filters by status group and workflow (foreign ids ignored) and pages', async () => {
    seed()
    const ctx = ctxFor(['workflows.view', 'workflows.view_runs'])
    const failed = await ctx.workflows.history({ status: ['failed'] })
    expect(failed.runs.map((r) => [r.runId, r.status])).toEqual([[run(2), 'failed'], [run(5), 'cancelled'], [run(10), 'cancelled']])
    expect(failed.queued).toBe(0)
    const w2 = await ctx.workflows.history({ workflowIds: [W2, PLAIN, ELSEWHERE, 'nope'] })
    expect(new Set(w2.runs.map((r) => r.workflowId))).toEqual(new Set([W2]))
    expect((await ctx.workflows.history({ workflowIds: [PLAIN] })).runs).toEqual([])
    const page1 = await ctx.workflows.history({ status: ['completed', 'failed'], limit: 2 })
    const page2 = await ctx.workflows.history({ status: ['completed', 'failed'], limit: 2, offset: 2 })
    expect(page1).toMatchObject({ total: 6, hasMore: true })
    expect([...page1.runs, ...page2.runs].map((r) => r.runId)).toEqual([run(1), run(2), run(4), run(5)])
    const matched = await ctx.workflows.history({ match: { item_id: 9 } })
    expect(matched.runs.map((r) => r.runId)).toEqual([run(3)])
  })

  it('queue: started-by, date range, search (item title, run id, starter), duration / status sort, queued and cancelled on their own', async () => {
    seed()
    const ctx = ctxFor(['workflows.view', 'workflows.view_runs'])
    expect((await ctx.workflows.history({ startedBy: ANA })).runs.map((r) => r.runId)).toEqual([run(3)])
    expect((await ctx.workflows.history({ since: at(1, 0), until: at(0, 9) })).runs.map((r) => r.runId)).toEqual([run(1), run(2)])
    expect((await ctx.workflows.history({ search: 'flight' })).runs.map((r) => r.runId)).toEqual([run(3)])
    expect((await ctx.workflows.history({ search: run(4) })).runs.map((r) => r.runId)).toEqual([run(4)])
    expect((await ctx.workflows.history({ search: 'ana b' })).runs.map((r) => r.runId)).toEqual([run(3)])
    const byDuration = await ctx.workflows.history({ status: ['completed'], sort: 'duration' })
    expect(byDuration.runs.map((r) => r.runId)).toEqual([run(4), run(1), run(6)])
    expect((await ctx.workflows.history({ status: ['queued'] })).runs.map((r) => r.jobId)).toEqual(['q-new'])
    expect((await ctx.workflows.history({ status: ['cancelled'] })).runs.map((r) => [r.runId, r.status])).toEqual([[run(5), 'cancelled'], [run(10), 'cancelled']])
    expect((await ctx.workflows.stats({ days: 90 })).totals).toMatchObject({ failed: 1, cancelled: 2 })
    expect((await ctx.workflows.history({ sort: 'status', status: ['completed', 'failed'] })).runs.map((r) => r.status)).toEqual(['cancelled', 'completed', 'completed', 'completed', 'failed', 'cancelled'])
  })

  it('waiting: open runs by step and their open tasks by assignee (names only when allowed)', async () => {
    seed()
    const w = await ctxFor(['workflows.view', 'workflows.view_runs']).workflows.waiting()
    expect(w).toMatchObject({ total: 1, steps: [{ workflowId: W1, step: 'Manager approval', count: 1 }], assigneesVisible: true })
    expect(w.assignees).toEqual(expect.arrayContaining([{ name: 'Ben C', team: false, unassigned: false, count: 1 }, { name: 'Finance', team: true, unassigned: false, count: 1 }]))
    const hidden = await ctxFor(['workflows.view']).workflows.waiting()
    expect(hidden).toMatchObject({ total: 1, assigneesVisible: false, assignees: [{ name: null, count: 2 }] })
    expect(await ctxFor([]).workflows.waiting()).toMatchObject({ total: 0, steps: [] })
  })

  it('keyset paging (cursor) walks every run once, newest first; counts are capped; a bad cursor is ignored', async () => {
    seed()
    const ctx = ctxFor(['workflows.view', 'workflows.view_runs'])
    const seenIds: string[] = []
    let r = await ctx.workflows.history({ status: ['completed', 'failed', 'running', 'waiting'], limit: 3 })
    seenIds.push(...r.runs.filter((x) => x.runId).map((x) => x.runId!))
    while (r.nextCursor) {
      r = await ctx.workflows.history({ status: ['completed', 'failed', 'running', 'waiting'], limit: 3, cursor: r.nextCursor })
      seenIds.push(...r.runs.map((x) => x.runId!))
    }
    expect(seenIds).toEqual([run(9), run(3), run(1), run(2), run(4), run(5), run(6), run(10)])
    expect(new Set(seenIds).size).toBe(seenIds.length)
    expect(r).toMatchObject({ totalCapped: false, nextCursor: null })
    expect((await ctx.workflows.history({ cursor: 'not-a-cursor', limit: 2 })).runs[0].runId).toBeNull() // first page (queued first)
    const { encodeCursor, decodeCursor, COUNT_CAP } = await import('@/lib/extensions/insights-host')
    expect(decodeCursor(encodeCursor('2026-11-14T10:00:00Z', run(1)))).toEqual({ t: '2026-11-14T10:00:00Z', id: run(1) })
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: 'x', id: run(1) })).toString('base64url'))).toBeNull()
    expect(COUNT_CAP).toBe(10_000)
  })

  it('cancelRun / retryRun act only on its own runs, with the right permissions', async () => {
    const mem = seed()
    mem.rpc = vi.fn(async () => ({ data: null, error: null }))
    const member = ctxFor(['workflows.view'])
    await expect(member.workflows.retryRun(run(2))).rejects.toMatchObject({ status: 403 })
    const starter = ctxFor(['workflows.view', 'workflows.start'])
    await expect(starter.workflows.retryRun(run(1))).rejects.toMatchObject({ status: 400 })
    await expect(starter.workflows.retryRun(run(7))).rejects.toMatchObject({ status: 404 })
    mem.tables.workflows[0].is_active = true
    mem.tables.workflows[0].published_version_id = V1
    expect(await starter.workflows.retryRun(run(2))).toEqual({ started: true })
    const call = mem.rpc.mock.calls.find((c: any[]) => c[0] === 'enqueue_workflow')
    expect(call[1]).toMatchObject({ p_workflow_id: W1, p_trigger_data: { item_id: 8, title: 'Hotel', _retry_of: run(2), _version_id: V1 } })
    expect(call[1].p_trigger_data).not.toHaveProperty('_dedupe_key')
    await expect(starter.workflows.cancelRun({ runId: run(7) })).rejects.toMatchObject({ status: 404 })
    await expect(starter.workflows.cancelRun({ jobId: 'q-plain' })).rejects.toMatchObject({ status: 404 })
  })

  it('follows the run-list rule: none without access, involved runs only with view_queue, assignees hidden', async () => {
    seed()
    expect(await ctxFor([]).workflows.history()).toMatchObject({ runs: [], visibility: 'none' })
    expect(await ctxFor(['workflows.view']).workflows.history()).toMatchObject({ runs: [], visibility: 'none' })
    // Ben is involved in run 3 (his task) and queued the pending job.
    const ben = await ctxFor(['workflows.view', 'workflows.view_queue'], BEN).workflows.history()
    expect(ben).toMatchObject({ visibility: 'involved', assignees: false })
    expect(ben.runs.map((r) => r.runId ?? 'queued')).toEqual(['queued', run(3)])
    expect(ben.runs[1].tasks.map((t) => [t.assignee, t.team])).toEqual([[null, null], [null, null]])
    // Ana is involved in nothing but started run 3 (started_by).
    const ana = await ctxFor(['workflows.view', 'workflows.view_queue']).workflows.history()
    expect(ana.runs.map((r) => r.runId)).toEqual([run(3)])
    // tasks.view_all shows assignees; system / elevated contexts see everything.
    expect((await ctxFor(['workflows.view', 'workflows.view_queue', 'tasks.view_all'], BEN).workflows.history()).assignees).toBe(true)
    expect(await ctxFor(null, null).workflows.history()).toMatchObject({ visibility: 'all', assignees: true, total: 8 })
    expect(await ctxFor(['workflows.view']).elevate('via test').workflows.history()).toMatchObject({ visibility: 'all', total: 8 })
  })
})

describe('ctx.workflows.stats and ctx.forms.submissionStats', () => {
  beforeEach(() => {
    clearStatsCache()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [defineServerExtension({ id: 'acme', triggers: { changed: { matches: () => true } } })] })
  })
  afterEach(() => { resetExtensionsForTest(); vi.useRealTimers() })

  it('aggregates its own workflows over the period (bounded fallback): counts, success rate, durations, per day, now', async () => {
    seed()
    const s = await ctxFor(['workflows.view']).workflows.stats({ days: 7 })
    expect(s).toMatchObject({ days: 7, since: '2026-11-08T00:00:00.000Z' })
    expect(s.workflows.map((w) => w.name)).toEqual(['Approve claims', 'Archive'])
    const [w1, w2] = s.workflows
    expect(w1).toMatchObject({ started: 3, completed: 1, failed: 1, cancelled: 0, successRate: 0.5, avgMs: 4000, p95Ms: 4000, running: 0, waiting: 1, queued: 1 })
    expect(w2).toMatchObject({ started: 3, completed: 1, failed: 0, cancelled: 1, successRate: 0.5, avgMs: 10000, running: 1, waiting: 0, queued: 0 })
    expect(w1.perDay).toHaveLength(7)
    expect(w1.perDay.at(-1)).toEqual({ day: '2026-11-14', started: 2, completed: 1, failed: 0, avgMs: 4000 })
    expect(w1.perDay.at(-2)).toEqual({ day: '2026-11-13', started: 1, completed: 0, failed: 1, avgMs: null })
    expect(s.totals).toMatchObject({ started: 6, completed: 2, failed: 1, cancelled: 1, successRate: 0.5, avgMs: 7000, p95Ms: 9700, running: 1, waiting: 1, queued: 1 })
    expect(s.totals.perDay.reduce((a, d) => a + d.started, 0)).toBe(6)
    // 30 days take in run 6; unknown periods are clamped.
    expect((await ctxFor(['workflows.view']).workflows.stats({ days: 30 })).totals.started).toBe(7)
    expect((await ctxFor(['workflows.view']).workflows.stats({ days: 9999 })).days).toBe(90)
    expect(await ctxFor([]).workflows.stats()).toMatchObject({ workflows: [], totals: { started: 0 } })
  })

  it('uses the database aggregate when present, with only its own workflow ids, and falls back when it is missing', async () => {
    const mem = seed()
    mem.rpc = vi.fn(async () => ({ data: { workflows: [{ workflow_id: W1, started: 5, completed: 4, failed: 1, cancelled: 0, avg_ms: 1234.4, p95_ms: 3000, running: 0, waiting: 2, queued: 0, per_day: [{ day: '2026-11-14', started: 5, completed: 4, failed: 1 }] }], total: { started: 5, completed: 4, failed: 1, cancelled: 0, avg_ms: 1234.4, p95_ms: 3000, running: 0, waiting: 2, queued: 0, per_day: [{ day: '2026-11-14', started: 5, completed: 4, failed: 1 }] } }, error: null }))
    const s = await ctxFor(['workflows.view']).workflows.stats({ days: 7, workflowIds: [W1, PLAIN] })
    expect(mem.rpc).toHaveBeenCalledWith('workflow_run_stats', { p_tenant_id: TENANT, p_workflow_ids: [W1], p_since: '2026-11-08T00:00:00.000Z', p_until: expect.any(String) })
    expect(s.workflows).toHaveLength(1)
    expect(s.workflows[0]).toMatchObject({ started: 5, successRate: 0.8, avgMs: 1234, waiting: 2 })
    expect(s.workflows[0].perDay.at(-1)?.started).toBe(5)
    clearStatsCache()
    mem.rpc = vi.fn(async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.workflow_run_stats' } }))
    expect((await ctxFor(['workflows.view']).workflows.stats({ days: 7 })).totals.started).toBe(6)
    clearStatsCache()
    mem.rpc = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }))
    await expect(ctxFor(['workflows.view']).workflows.stats({ days: 7 })).rejects.toThrow(/statement timeout/)
  })

  it('statistics are cached for 30 seconds per workspace, workflows and period', async () => {
    const mem = seed()
    // The report rollups (tried first) answer nothing here; count the stats RPC itself.
    const statsCalls = (m: any) => m.rpc.mock.calls.filter((c: any[]) => c[0] === 'workflow_run_stats').length // eslint-disable-line @typescript-eslint/no-explicit-any
    mem.rpc = vi.fn(async () => ({ data: { workflows: [], total: { started: 1, per_day: [] } }, error: null }))
    const ctx = ctxFor(['workflows.view'])
    await ctx.workflows.stats({ days: 7 })
    await ctx.workflows.stats({ days: 7 })
    expect(statsCalls(mem)).toBe(1)
    await ctx.workflows.stats({ days: 30 })
    expect(statsCalls(mem)).toBe(2)
    vi.setSystemTime(new Date(NOW.getTime() + 31_000))
    await ctx.workflows.stats({ days: 7 })
    expect(statsCalls(mem)).toBe(3)
  })

  it('counts submissions of its own bound forms per day (never values), last submission any time; forms.view needed', async () => {
    seed()
    const s = await ctxFor(['forms.view']).forms.submissionStats({ days: 7 })
    expect(s.forms.map((f) => [f.name, f.total, f.lastAt])).toEqual([['Claims – New', 3, at(0, 10)], ['Claims – Edit', 0, at(40)]])
    expect(s.forms[0].perDay.at(-1)).toEqual({ day: '2026-11-14', count: 2 })
    expect(s.forms[0].perDay.at(-5)).toEqual({ day: '2026-11-10', count: 1 })
    expect(s.totals).toMatchObject({ total: 3, lastAt: at(0, 10) })
    expect(JSON.stringify(s)).not.toMatch(/SECRET/)
    expect((await ctxFor(['forms.view']).forms.submissionStats({ formIds: [F_EDIT, F_PLAIN] })).forms.map((f) => f.formId)).toEqual([F_EDIT])
    expect((await ctxFor(['forms.view']).forms.submissionStats({ key: 'other' })).forms).toEqual([])
    expect(await ctxFor([]).forms.submissionStats()).toMatchObject({ forms: [], totals: { total: 0 } })
    const mem = db.current
    mem.rpc = vi.fn(async () => ({ data: { forms: [{ form_id: F_NEW, total: 9, last_at: at(0, 11), per_day: [{ day: '2026-11-14', count: 9 }] }] }, error: null }))
    const viaDb = await ctxFor(['forms.view']).forms.submissionStats({ days: 7 })
    expect(mem.rpc).toHaveBeenCalledWith('form_submission_stats', expect.objectContaining({ p_form_ids: [F_NEW, F_EDIT] }))
    expect(viaDb.forms.map((f) => f.total)).toEqual([9, 0])
  })

  it('helpers: period, percentile (percentile_cont), status groups, aggregation', () => {
    const p = period(7, NOW.getTime())
    expect(p.dayKeys).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'])
    expect(period(0, NOW.getTime()).days).toBe(30)
    expect(percentileCont([], 0.95)).toBeNull()
    expect(percentileCont([1000, 2000, 3000, 4000], 0.95)).toBeCloseTo(3850)
    expect(percentileCont([5], 0.95)).toBe(5)
    expect(['running', 'paused', 'waiting_for_event', 'pending', 'completed', 'cancelled', 'dead'].map(runGroup)).toEqual(['running', 'waiting', 'waiting', 'waiting', 'completed', 'failed', 'failed'])
    const agg = aggregateRuns(['a'], [{ workflow_id: 'a', status: 'completed', started_at: at(0), completed_at: plus(at(0), 100) }, { workflow_id: 'b', status: 'failed', started_at: at(0), completed_at: null }], [], [])
    expect(agg.workflows[0]).toMatchObject({ started: 1, avg_ms: 100 })
    expect(agg.total).toMatchObject({ started: 2, failed: 1 })
  })
})
