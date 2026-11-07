/**
 * Parallel / Sequential join semantics, run against the in-memory Supabase
 * fake: when the branches of a Parallel node meet at a later step, that step
 * (the join) runs exactly once, after every branch that can reach it has
 * finished, with the branches' variables merged in branch order (a later
 * branch wins a conflict). Covers async steps of different durations (HTTP,
 * sub-workflow, inline delays), waits (user task, timed pause) that pause the
 * run and resume it, several waits at once, failures, nested parallels,
 * parallels inside loops, branches that never reach the join and conditions
 * that skip it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { executeWorkflow, resumeTimedPause, resumeWorkflow } from '@/lib/workflow-engine'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { enqueueResume } from '@/lib/workflow-resume-queue'
import { compareWaits, computeParallelGraph, parallelBranchLabels } from '@/lib/workflow-parallel'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const WF = '0e000000-0000-4000-8000-0000000000b1'
const SUB_WF = '0e000000-0000-4000-8000-0000000000b2'

type Node = { id: string; type: string; label: string; config: Record<string, unknown>; onError?: 'stop' | 'continue' }
type Edge = { id: string; source: string; target: string; label?: string }

const trigger: Node = { id: 'start', type: 'schedule', label: 'Start', config: {} }
const setVar = (id: string, name: string, expression: string): Node =>
  ({ id, type: 'set_variable', label: `Set ${id}`, config: { name, expression } })
const wait = (id: string, ms: number): Node =>
  ({ id, type: 'delay', label: `Wait ${id}`, config: { duration: ms / 1000, unit: 'seconds' } })
const parallel = (id: string, branches: string[], mode: 'parallel' | 'sequential' = 'parallel'): Node =>
  ({ id, type: 'parallel', label: `Parallel ${id}`, config: { mode, branches: branches.map((label, order) => ({ label, order })) } })
const http = (id: string, url: string, outputVar: string): Node =>
  ({ id, type: 'http_request', label: `Call ${id}`, config: { url, method: 'GET', output_var: outputVar } })
let edgeSeq = 0
const e = (source: string, target: string, label?: string): Edge => ({ id: `e${++edgeSeq}`, source, target, ...(label ? { label } : {}) })

function seed(workflows: Array<{ id: string; nodes: Node[]; edges: Edge[] }>) {
  const fake = createFakeSupabase({
    workflows: workflows.map((w) => ({
      id: w.id, tenant_id: TENANT, name: 'Parallel test', trigger_type: 'schedule',
      nodes: w.nodes, edges: w.edges, run_count: 0, published_version_id: null,
    })),
  })
  fake.rpcs.enqueue_workflow = (args) => {
    const id = crypto.randomUUID()
    fake.tables.workflow_queue ??= []
    fake.tables.workflow_queue.push({
      id, workflow_id: args.p_workflow_id, tenant_id: args.p_tenant_id, task_id: args.p_task_id ?? null,
      trigger_type: args.p_trigger_type, trigger_data: args.p_trigger_data, status: 'pending',
      scheduled_for: Date.now() + Number(args.p_delay_seconds ?? 0) * 1000,
    })
    return { data: id }
  }
  fake.rpcs.claim_next_job = () => {
    const job = (fake.tables.workflow_queue ?? [])
      .filter((j) => j.status === 'pending' && Number(j.scheduled_for) <= Date.now())
      .sort((a, b) => Number(a.scheduled_for) - Number(b.scheduled_for))[0]
    if (!job) return { data: null }
    job.status = 'running'
    return { data: { ...job } }
  }
  fake.rpcs.complete_job = (args) => {
    const job = fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)
    if (job) Object.assign(job, { status: 'completed', result: args.p_result })
    return {}
  }
  fake.rpcs.fail_job = (args) => {
    const job = fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)
    if (job) Object.assign(job, { status: 'failed', error: args.p_error })
    return {}
  }
  fake.rpcs.record_workflow_run = () => ({})
  return fake
}

const run = (fake: FakeSupabase, opts: { test?: boolean; vars?: Record<string, unknown> } = {}) =>
  executeWorkflow(WF, undefined, opts.test ?? false, opts.vars ?? {}, undefined, undefined, undefined, {
    supabase: fake.client,
    ...(opts.test ? { initiator: { userId: null, via: 'test' as const } } : {}),
  })

type StoredRun = {
  status: string
  event_id: string | null
  paused_node_id: string | null
  pause_variables: (Record<string, unknown> & { _parallel?: { waits: Array<{ event_id: string; node_id: string }>; completed: Record<string, unknown> } }) | null
  node_results: Record<string, { status: string; output?: Record<string, unknown> }>
  execution_trace: Array<Record<string, unknown>>
  error?: string
}
const runRow = (fake: FakeSupabase, runId?: string) =>
  fake.tables.workflow_runs.find((r) => r.id === runId) as unknown as StoredRun

/** Order in which nodes were entered ("enter" trace entries). */
const entered = (trace: Array<Record<string, unknown>>) =>
  trace.filter((t) => t.type === 'node' && t.phase === 'enter').map((t) => String(t.node_id))
const visits = (trace: Array<Record<string, unknown>>, id: string) => entered(trace).filter((x) => x === id).length

beforeEach(() => {
  edgeSeq = 0
  createClientMock.mockReset()
  createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('graph helpers', () => {
  it('accepts branch labels as strings or {label, order} objects', () => {
    expect(parallelBranchLabels(['A', 'B'])).toEqual(['A', 'B'])
    expect(parallelBranchLabels([{ label: 'A', order: 0 }, { label: 'B', order: 1 }])).toEqual(['A', 'B'])
    expect(parallelBranchLabels(undefined)).toEqual([])
  })

  it('finds the convergence nodes and which branches reach them', () => {
    const edges = [e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'c', 'C'), e('a', 'j'), e('b', 'j'), e('j', 'k'), e('c', 'side')]
    const out = (id: string) => edges.filter((x) => x.source === id)
    const g = computeParallelGraph('p', ['a', 'b', 'c'], out)
    expect([...g.stop].sort()).toEqual(['j', 'k'])
    expect(g.reach.get('j')).toEqual([0, 1])
    expect(g.reach.get('side')).toEqual([2])
  })
})

describe('Parallel join: runs once, after all reaching branches', () => {
  it('waits for a slow branch before running the join (the decision-table bug)', async () => {
    const nodes = [
      trigger, parallel('p', ['Vendor', 'Amount']),
      wait('slow', 60), setVar('vendor', 'vendor', 'ACME'),
      setVar('amount', 'amount', '42'),
      setVar('join', 'summary', '{{vendor}}:{{amount}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'slow', 'Vendor'), e('slow', 'vendor'), e('p', 'amount', 'Amount'), e('vendor', 'join'), e('amount', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('ACME:42')
    expect(visits(row.execution_trace, 'join')).toBe(1)
    const order = entered(row.execution_trace)
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('vendor'))
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('amount'))
  })

  it('joins three branches with HTTP calls and a sub-workflow of different durations', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const ms = url.includes('slow') ? 80 : 5
      await new Promise((r) => setTimeout(r, ms))
      return new Response(JSON.stringify({ from: url.includes('slow') ? 'slow' : 'fast' }), { headers: { 'content-type': 'application/json' } })
    }))
    const sub = { id: SUB_WF, nodes: [trigger, wait('subwait', 40), setVar('subset', 'sub_value', 'from-sub')], edges: [e('start', 'subwait'), e('subwait', 'subset')] }
    const nodes = [
      trigger, parallel('p', ['Slow', 'Fast', 'Sub']),
      http('h1', 'https://api.example.test/slow', 'slow_res'),
      http('h2', 'https://api.example.test/fast', 'fast_res'),
      { id: 'sub', type: 'call_sub_workflow', label: 'Sub', config: { sub_workflow_id: SUB_WF, sub_workflow_name: 'Sub' } },
      setVar('join', 'summary', '{{slow_res.from}}|{{fast_res.from}}|{{sub_workflow_status}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'h1', 'Slow'), e('p', 'h2', 'Fast'), e('p', 'sub', 'Sub'), e('h1', 'join'), e('h2', 'join'), e('sub', 'join')]
    const fake = seed([{ id: WF, nodes, edges }, sub])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('slow|fast|completed')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('merges conflicting variables in branch order: the later branch wins, however long each took', async () => {
    const nodes = [
      trigger, parallel('p', ['First', 'Second']),
      wait('w1', 50), setVar('a', 'status', 'from-first'),
      setVar('b', 'status', 'from-second'),
      setVar('join', 'seen', '{{status}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'w1', 'First'), e('w1', 'a'), e('p', 'b', 'Second'), e('a', 'join'), e('b', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(runRow(fake, result.run_id).node_results.join.output?.value).toBe('from-second')
  })

  it('accepts branches given as plain strings (test-workflows format)', async () => {
    const nodes = [
      trigger,
      { id: 'p', type: 'parallel', label: 'P', config: { mode: 'parallel', branches: ['Branch A', 'Branch B'] } },
      wait('w', 30), setVar('a', 'a', '1'), setVar('b', 'b', '2'), setVar('join', 'sum', '{{a}}{{b}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'w', 'Branch A'), e('w', 'a'), e('p', 'b', 'Branch B'), e('a', 'join'), e('b', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(runRow(fake, result.run_id).node_results.join.output?.value).toBe('12')
  })

  it('sequential mode runs the branches one after another and the join once at the end', async () => {
    const nodes = [
      trigger, parallel('p', ['One', 'Two'], 'sequential'),
      setVar('one', 'trail', 'one'), setVar('two', 'trail', '{{trail}}+two'), setVar('join', 'final', '{{trail}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'one', 'One'), e('p', 'two', 'Two'), e('one', 'join'), e('two', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('one+two')
    expect(entered(row.execution_trace)).toEqual(['start', 'p', 'one', 'two', 'join'])
  })

  it('a branch that never reaches the join is not waited for by it; the run still waits for it', async () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B', 'Side']),
      setVar('a', 'a', '1'), setVar('b', 'b', '2'), wait('sidewait', 80), setVar('side', 'side', 'done'),
      setVar('join', 'ab', '{{a}}{{b}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'sidewait', 'Side'), e('sidewait', 'side'), e('a', 'join'), e('b', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    const order = entered(row.execution_trace)
    expect(order.indexOf('join')).toBeLessThan(order.indexOf('side'))
    expect(row.node_results.side.status).toBe('success')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('a condition inside a branch that skips the join path: the join runs once that branch has finished', async () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B']),
      setVar('a', 'a', '1'),
      { id: 'sw', type: 'switch_case', label: 'Route', config: { field: 'skip', cases: [{ value: 'go', label: 'Go' }] } },
      wait('bw', 40), setVar('bskip', 'b', 'skipped'),
      setVar('join', 'ab', '{{a}}-{{b}}'),
    ]
    const edges = [
      e('start', 'p'), e('p', 'a', 'A'), e('p', 'sw', 'B'), e('sw', 'join', 'Go'), e('sw', 'bw', 'default'), e('bw', 'bskip'), e('a', 'join'),
    ]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('1-skipped')
    const order = entered(row.execution_trace)
    expect(order.indexOf('join')).toBeGreaterThan(order.indexOf('bskip'))
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('if/else convergence outside a Parallel still runs on the first (only) arrival', async () => {
    const nodes = [
      trigger,
      { id: 'sw', type: 'switch_case', label: 'Route', config: { field: 'go', cases: [{ value: 'go', label: 'Go' }] } },
      setVar('yes', 'path', 'yes'), setVar('no', 'path', 'no'), setVar('merge', 'merged', '{{path}}'),
    ]
    const edges = [e('start', 'sw'), e('sw', 'yes', 'Go'), e('sw', 'no', 'default'), e('yes', 'merge'), e('no', 'merge')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake, { vars: { go: 'go' } })
    const row = runRow(fake, result.run_id)
    expect(row.node_results.merge.output?.value).toBe('yes')
    expect(entered(row.execution_trace)).toEqual(['start', 'sw', 'yes', 'merge'])
  })

  it('nested parallels: each join waits for its own branches', async () => {
    const nodes = [
      trigger, parallel('p1', ['Left', 'Right']),
      parallel('p2', ['L1', 'L2']), wait('l1w', 60), setVar('l1', 'l1', 'x'), setVar('l2', 'l2', 'y'),
      setVar('j2', 'left', '{{l1}}{{l2}}'),
      wait('rw', 20), setVar('r', 'right', 'z'),
      setVar('j1', 'all', '{{left}}{{right}}'),
    ]
    const edges = [
      e('start', 'p1'), e('p1', 'p2', 'Left'), e('p1', 'rw', 'Right'), e('rw', 'r'),
      e('p2', 'l1w', 'L1'), e('l1w', 'l1'), e('p2', 'l2', 'L2'), e('l1', 'j2'), e('l2', 'j2'),
      e('j2', 'j1'), e('r', 'j1'),
    ]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    const row = runRow(fake, result.run_id)
    expect(row.node_results.j2.output?.value).toBe('xy')
    expect(row.node_results.j1.output?.value).toBe('xyz')
    expect(visits(row.execution_trace, 'j1')).toBe(1)
    expect(visits(row.execution_trace, 'j2')).toBe(1)
  })

  it('a parallel inside a loop joins once per iteration', async () => {
    const nodes = [
      trigger,
      { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: '3', index_var: 'i' } },
      parallel('p', ['A', 'B']),
      wait('aw', 30), setVar('a', 'a', 'a{{i}}'), setVar('b', 'b', 'b{{i}}'),
      { id: 'join', type: 'log', label: 'Join', config: { message: '{{i}}:{{a}}:{{b}}' } },
    ]
    const edges = [e('start', 'loop'), e('loop', 'p', 'Each Item'), e('p', 'aw', 'A'), e('aw', 'a'), e('p', 'b', 'B'), e('a', 'join'), e('b', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const joins = (result.logs ?? []).filter((l: { node_id?: string; message?: string }) => l.node_id === 'join' && String(l.message).startsWith('Executed'))
    expect(joins).toHaveLength(3)
    expect(runRow(fake, result.run_id).node_results.join.output?.logged).toBe('2:a2:b2')
    const messages = joins.map((l: { metadata?: { logged?: unknown } }) => l.metadata?.logged)
    expect(messages).toEqual(['0:a0:b0', '1:a1:b1', '2:a2:b2'])
  })
})

describe('Parallel join: failures', () => {
  it('a failing branch (stop) fails the run and the join never runs; the sibling still finishes', async () => {
    const nodes = [
      trigger, parallel('p', ['Bad', 'Good']),
      { id: 'bad', type: 'http_request', label: 'Bad call', config: { url: '' } },
      wait('gw', 30), setVar('good', 'good', 'yes'),
      setVar('join', 'j', 'ran'),
    ]
    const edges = [e('start', 'p'), e('p', 'bad', 'Bad'), e('p', 'gw', 'Good'), e('gw', 'good'), e('bad', 'join'), e('good', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('failed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join).toBeUndefined()
    expect(row.node_results.good.status).toBe('success')
    expect(row.node_results.bad.status).toBe('error')
  })

  it('a failing step set to continue lets its branch reach the join', async () => {
    const nodes = [
      trigger, parallel('p', ['Bad', 'Good']),
      { id: 'bad', type: 'http_request', label: 'Bad call', config: { url: '' }, onError: 'continue' as const },
      setVar('good', 'good', 'yes'),
      setVar('join', 'j', '{{has_error}}/{{good}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'bad', 'Bad'), e('p', 'good', 'Good'), e('bad', 'join'), e('good', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('true/yes')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })
})

describe('Parallel join: waits inside branches', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T10:00:00Z'))
  })

  it('a branch waiting on a user task pauses the run; the join runs after the resume, once', async () => {
    const nodes = [
      trigger, parallel('p', ['Approve', 'Lookup']),
      { id: 'ut', type: 'user_task', label: 'Approve', config: { task_title: 'Approve', outcomes: ['Approved', 'Rejected'] } },
      setVar('lookup', 'vendor', 'ACME'),
      setVar('join', 'summary', '{{vendor}}:{{outcome}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'ut', 'Approve'), e('p', 'lookup', 'Lookup'), e('ut', 'join'), e('lookup', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake, { test: true })
    expect(result.status).toBe('waiting_for_event')
    expect(result.paused_node_id).toBe('ut')
    let row = runRow(fake, result.run_id)
    expect(row.node_results.lookup.status).toBe('success')
    // The join shows as waiting for the one branch still open.
    expect(row.node_results.join.status).toBe('waiting')
    expect(row.node_results.join.output?._join_waiting).toMatchObject({ arrived: 1, expected: 2, waiting_for: ['Approve'] })
    expect(row.pause_variables?.vendor).toBe('ACME')

    const resumed = await resumeWorkflow(result.run_id!, { outcome: 'Approved' }, undefined, { supabase: fake.client })
    expect(resumed.status).toBe('completed')
    row = runRow(fake, result.run_id)
    expect(row.node_results.join.status).toBe('success')
    expect(row.node_results.join.output?.value).toBe('ACME:Approved')
    expect(visits(row.execution_trace, 'join')).toBe(1)

    // Idempotent: a second resume of the same event is refused.
    await expect(resumeWorkflow(result.run_id!, { outcome: 'Approved' }, undefined, { supabase: fake.client, eventId: row.event_id ?? 'x' })).rejects.toThrow()
  })

  it('two waits in parallel branches: the run waits for both, in turn, and joins once', async () => {
    const nodes = [
      trigger, parallel('p', ['Short', 'Long']),
      wait('short', 60_000), setVar('s', 's', 'S'),
      wait('long', 120_000), setVar('l', 'l', 'L'),
      setVar('join', 'both', '{{s}}{{l}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'short', 'Short'), e('short', 's'), e('p', 'long', 'Long'), e('long', 'l'), e('s', 'join'), e('l', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    createClientMock.mockImplementation(() => fake.client)
    // Both timed waits are scheduled.
    expect(fake.tables.workflow_queue.filter((j) => j.trigger_type === 'delay_resume')).toHaveLength(2)

    vi.setSystemTime(new Date('2026-10-24T10:01:01Z'))
    await processWorkflowQueueBatch({ batchSize: 5 })
    let row = runRow(fake, result.run_id)
    expect(row.status).toBe('waiting_for_event')
    expect(row.node_results.s.status).toBe('success')
    expect(row.node_results.join.status).toBe('waiting')

    vi.setSystemTime(new Date('2026-10-24T10:02:01Z'))
    await processWorkflowQueueBatch({ batchSize: 5 })
    row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.join.output?.value).toBe('SL')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('a wait whose resume arrives while the run waits on another one is kept and applied later', async () => {
    const nodes = [
      trigger, parallel('p', ['Long', 'Short']),
      wait('long', 120_000), setVar('l', 'l', 'L'),
      wait('short', 60_000), setVar('s', 's', 'S'),
      setVar('join', 'both', '{{l}}{{s}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'long', 'Long'), e('long', 'l'), e('p', 'short', 'Short'), e('short', 's'), e('l', 'join'), e('s', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    expect(runRow(fake, result.run_id).event_id).toBe((fake.tables.workflow_queue[0].trigger_data as Record<string, unknown>)._resume_event_id)
    createClientMock.mockImplementation(() => fake.client)

    // The short wait ends first, while the run is waiting on the long one.
    vi.setSystemTime(new Date('2026-10-24T10:01:01Z'))
    await processWorkflowQueueBatch({ batchSize: 5 })
    let row = runRow(fake, result.run_id)
    expect(row.status).toBe('waiting_for_event')

    vi.setSystemTime(new Date('2026-10-24T10:02:01Z'))
    await processWorkflowQueueBatch({ batchSize: 5 })
    row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.s.status).toBe('success')
    expect(row.node_results.join.output?.value).toBe('LS')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('parallel approvals: the second task completed first is kept, and the join runs after both', async () => {
    const task = (id: string) => ({ id, type: 'user_task', label: `Task ${id}`, config: { task_title: id, outcomes: ['Approved', 'Rejected'] } })
    const nodes = [
      trigger, parallel('p', ['Finance', 'Legal']),
      task('fin'), setVar('finout', 'finance', '{{outcome}}'),
      task('leg'), setVar('legout', 'legal', '{{outcome}}'),
      setVar('join', 'both', '{{finance}}/{{legal}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'fin', 'Finance'), e('fin', 'finout'), e('p', 'leg', 'Legal'), e('leg', 'legout'), e('finout', 'join'), e('legout', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake, { test: true })
    expect(result.status).toBe('waiting_for_event')
    createClientMock.mockImplementation(() => fake.client)
    const waits = runRow(fake, result.run_id).pause_variables!._parallel!.waits
    const finEvent = waits.find((w) => w.node_id === 'fin')!.event_id
    const legEvent = waits.find((w) => w.node_id === 'leg')!.event_id
    expect(runRow(fake, result.run_id).event_id).toBe(finEvent)

    // Legal answers first: kept on the run, which still waits for Finance.
    await enqueueResume({ tenantId: TENANT, eventId: legEvent, variables: { outcome: 'Rejected' }, supabase: fake.client })
    await processWorkflowQueueBatch({ batchSize: 5 })
    let row = runRow(fake, result.run_id)
    expect(row.status).toBe('waiting_for_event')
    expect(row.pause_variables?._parallel?.completed[legEvent]).toEqual({ outcome: 'Rejected' })

    await enqueueResume({ tenantId: TENANT, eventId: finEvent, variables: { outcome: 'Approved' }, supabase: fake.client })
    await processWorkflowQueueBatch({ batchSize: 5 })
    row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.join.output?.value).toBe('Approved/Rejected')
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('the run waits on the first branch\'s wait, whichever wait opened first', async () => {
    const task = (id: string) => ({ id, type: 'user_task', label: `Task ${id}`, config: { task_title: id, outcomes: ['Done'] } })
    // Branch One reaches its task later than branch Two.
    const nodes = [trigger, parallel('p', ['One', 'Two']), wait('slow', 40), task('one'), task('two'), setVar('join', 'j', 'x')]
    const edges = [e('start', 'p'), e('p', 'slow', 'One'), e('slow', 'one'), e('p', 'two', 'Two'), e('one', 'join'), e('two', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake, { test: true })
    expect(result.paused_node_id).toBe('one')
    const row = runRow(fake, result.run_id)
    expect(row.paused_node_id).toBe('one')
    // Resuming it moves the run on to the other branch's wait.
    const resumed = await resumeWorkflow(result.run_id!, { outcome: 'Done' }, undefined, { supabase: fake.client })
    expect(resumed.status).toBe('waiting_for_event')
    expect(runRow(fake, result.run_id).paused_node_id).toBe('two')
  })

  it('orders waits by place, not time: root first, then frame, then lowest branch', () => {
    const w = (path: Array<[string, number[]]>) => ({ path: path.map(([frame, token], record) => ({ frame, token, record })) })
    const sorted = [w([['p#2', [0]]]), w([['p#1', [1]]]), w([]), w([['p#1', [0]], ['q#3', [1]]]), w([['p#1', [0]]])].sort(compareWaits)
    expect(sorted.map((x) => x.path.map((p) => `${p.frame}:${p.token}`).join('/'))).toEqual(['', 'p#1:0', 'p#1:0/q#3:1', 'p#1:1', 'p#2:0'])
  })

  it('test runs show the prompt of the task the run waits on last', async () => {
    const task = (id: string) => ({ id, type: 'user_task', label: `Task ${id}`, config: { task_title: id, outcomes: ['Done'] } })
    const nodes = [trigger, parallel('p', ['One', 'Two']), task('one'), task('two'), setVar('join', 'j', 'x')]
    const edges = [e('start', 'p'), e('p', 'one', 'One'), e('p', 'two', 'Two'), e('one', 'join'), e('two', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const prompts: string[] = []
    const result = await executeWorkflow(WF, undefined, true, {}, (event) => {
      if (event.type === 'node_complete' && (event.data as { status?: string })?.status === 'test_user_task') prompts.push(String(event.node_id))
    }, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
    expect(result.paused_node_id).toBe('one')
    expect(prompts).toEqual(['one', 'two', 'one'])
  })

  it('sequential mode: a wait in the first branch delays the second branch until the resume', async () => {
    const nodes = [
      trigger, parallel('p', ['One', 'Two'], 'sequential'),
      wait('w', 60_000), setVar('one', 'trail', 'one'), setVar('two', 'trail', '{{trail}}+two'),
      setVar('join', 'final', '{{trail}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'w', 'One'), e('w', 'one'), e('p', 'two', 'Two'), e('one', 'join'), e('two', 'join')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    expect(runRow(fake, result.run_id).node_results.two).toBeUndefined()
    const eventId = runRow(fake, result.run_id).event_id!
    const resumed = await resumeTimedPause(result.run_id!, eventId, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(resumed.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.join.output?.value).toBe('one+two')
    expect(visits(row.execution_trace, 'two')).toBe(1)
    expect(visits(row.execution_trace, 'join')).toBe(1)
  })

  it('a nested parallel with a wait resumes into the inner join and then the outer one', async () => {
    const nodes = [
      trigger, parallel('p1', ['Inner', 'Other']),
      parallel('p2', ['I1', 'I2']), wait('iw', 60_000), setVar('i1', 'i1', 'x'), setVar('i2', 'i2', 'y'),
      setVar('j2', 'inner', '{{i1}}{{i2}}'),
      setVar('o', 'other', 'z'),
      setVar('j1', 'all', '{{inner}}{{other}}'),
    ]
    const edges = [
      e('start', 'p1'), e('p1', 'p2', 'Inner'), e('p1', 'o', 'Other'),
      e('p2', 'iw', 'I1'), e('iw', 'i1'), e('p2', 'i2', 'I2'), e('i1', 'j2'), e('i2', 'j2'),
      e('j2', 'j1'), e('o', 'j1'),
    ]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    let row = runRow(fake, result.run_id)
    expect(row.node_results.j1.status).toBe('waiting')
    expect(row.node_results.j2.status).toBe('waiting')
    const resumed = await resumeTimedPause(result.run_id!, row.event_id!, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(resumed.status).toBe('completed')
    row = runRow(fake, result.run_id)
    expect(row.node_results.j2.output?.value).toBe('xy')
    expect(row.node_results.j1.output?.value).toBe('xyz')
    expect(visits(row.execution_trace, 'j1')).toBe(1)
    expect(visits(row.execution_trace, 'j2')).toBe(1)
  })

  it('the run overlay shows the join waiting for its open branches', () => {
    const overlay = computeRunOverlay({
      nodes: [{ id: 'p', type: 'parallel' }, { id: 'a', type: 'log' }, { id: 'b', type: 'user_task' }, { id: 'j', type: 'log' }],
      edges: [{ id: '1', source: 'p', target: 'a' }, { id: '2', source: 'p', target: 'b' }, { id: '3', source: 'a', target: 'j' }, { id: '4', source: 'b', target: 'j' }],
      nodeResults: {
        p: { status: 'success' }, a: { status: 'success' }, b: { status: 'waiting' },
        j: { status: 'waiting', output: { _join_waiting: { arrived: 1, expected: 2, waiting_for: ['B'] } } },
      },
      pausedNodeId: 'b',
      runWaiting: true,
    })
    expect(overlay.nodes.j.status).toBe('waiting')
    expect(overlay.nodes.j.joinWaiting).toEqual({ arrived: 1, expected: 2, waitingFor: ['B'] })
    expect(overlay.nodes.b.status).toBe('waiting')
    // Once the run is no longer waiting the placeholder is not a completed step.
    const done = computeRunOverlay({
      nodes: [{ id: 'j', type: 'log' }], edges: [],
      nodeResults: { j: { status: 'waiting', output: { _join_waiting: { arrived: 1, expected: 2, waiting_for: ['B'] } } } },
    })
    expect(done.nodes.j.status).toBe('not_run')
  })
})

describe('Parallel: the issue #9 scenario', () => {
  it('HTTP branch and delay + format_date branch meet at a log step: it runs once, after both, and the flow continues once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 7 }), { headers: { 'content-type': 'application/json' } })))
    const nodes: Node[] = [
      trigger, parallel('p', ['A', 'B']),
      http('a', 'https://api.example.test/item', 'item'),
      wait('b_wait', 150),
      { id: 'b_fmt', type: 'format_date', label: 'Format', config: { date: '2026-01-02T12:00:00Z', format: 'custom', custom_format: 'YYYY-MM-DD', output_var: 'day' } },
      { id: 'log', type: 'log', label: 'Log', config: { message: 'item={{item.id}} day={{day}}' } },
      setVar('after', 'after', 'continued'),
    ]
    const edges = [
      e('start', 'p'), e('p', 'a', 'A'), e('p', 'b_wait', 'B'), e('b_wait', 'b_fmt'),
      e('a', 'log'), e('b_fmt', 'log'), e('log', 'after'),
    ]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.log.output?.logged).toBe('item=7 day=2026-01-02')
    expect(visits(row.execution_trace, 'log')).toBe(1)
    expect(visits(row.execution_trace, 'after')).toBe(1)
    const order = entered(row.execution_trace)
    expect(order.indexOf('log')).toBeGreaterThan(order.indexOf('b_fmt'))
    expect(order.indexOf('log')).toBeGreaterThan(order.indexOf('a'))
  })
})

describe('Parallel: Done edge (runs after all branches)', () => {
  it('an unlabelled edge from the Parallel node runs once, after every branch, with all branch variables', async () => {
    const nodes = [
      trigger, parallel('p', ['Slow', 'Fast']),
      wait('slow', 60), setVar('s', 'shared', 'from-slow'),
      setVar('f', 'shared', 'from-fast'), setVar('f2', 'fast_only', 'F'),
      setVar('done', 'seen', '{{shared}}|{{fast_only}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'slow', 'Slow'), e('slow', 's'), e('p', 'f', 'Fast'), e('f', 'f2'), e('p', 'done')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    // Variables applied in branch order: the later branch ("Fast") wins a conflict.
    expect(row.node_results.done.output?.value).toBe('from-fast|F')
    expect(visits(row.execution_trace, 'done')).toBe(1)
    const order = entered(row.execution_trace)
    expect(order.indexOf('done')).toBeGreaterThan(order.indexOf('s'))
    expect(order.indexOf('done')).toBeGreaterThan(order.indexOf('f2'))
  })

  it('a "Done" edge runs after the branches and their join have finished', async () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B']),
      wait('aw', 40), setVar('a', 'a', '1'), setVar('b', 'b', '2'),
      setVar('join', 'ab', '{{a}}{{b}}'),
      setVar('done', 'final', '{{ab}}!'),
    ]
    const edges = [e('start', 'p'), e('p', 'aw', 'A'), e('aw', 'a'), e('p', 'b', 'B'), e('a', 'join'), e('b', 'join'), e('p', 'done', 'Done')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.done.output?.value).toBe('12!')
    const order = entered(row.execution_trace)
    expect(order.indexOf('done')).toBeGreaterThan(order.indexOf('join'))
    expect(row.execution_trace.some((t) => t.type === 'edge' && t.target === 'done' && t.reason === 'parallel_done')).toBe(true)
  })

  it('a branch called "Done" is a branch, not the Done edge', async () => {
    const nodes = [
      trigger, parallel('p', ['Work', 'Done']),
      setVar('w', 'w', 'x'), setVar('d', 'd', 'y'), setVar('after', 'after', 'z'),
    ]
    const edges = [e('start', 'p'), e('p', 'w', 'Work'), e('p', 'd', 'Done'), e('p', 'after')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    const order = entered(row.execution_trace)
    expect(order.indexOf('after')).toBeGreaterThan(order.indexOf('d'))
    expect(order.indexOf('after')).toBeGreaterThan(order.indexOf('w'))
  })

  it('a failing branch (stop) fails the run and Done never runs', async () => {
    const nodes = [
      trigger, parallel('p', ['Bad', 'Good']),
      { id: 'bad', type: 'http_request', label: 'Bad call', config: { url: '' } },
      setVar('good', 'good', 'yes'), setVar('done', 'd', 'ran'),
    ]
    const edges = [e('start', 'p'), e('p', 'bad', 'Bad'), e('p', 'good', 'Good'), e('p', 'done', 'Done')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('failed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.done).toBeUndefined()
    expect(row.node_results.good.status).toBe('success')
  })

  it('a failing step set to continue: Done still runs', async () => {
    const nodes = [
      trigger, parallel('p', ['Bad', 'Good']),
      { id: 'bad', type: 'http_request', label: 'Bad call', config: { url: '' }, onError: 'continue' as const },
      setVar('good', 'good', 'yes'), setVar('done', 'd', '{{good}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'bad', 'Bad'), e('p', 'good', 'Good'), e('p', 'done')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(runRow(fake, result.run_id).node_results.done.output?.value).toBe('yes')
  })

  it('branches that never meet and no Done edge: every branch runs to its end, as before', async () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B']),
      setVar('a', 'a', '1'), setVar('a2', 'a2', '1'), wait('bw', 30), setVar('b', 'b', '2'),
    ]
    const edges = [e('start', 'p'), e('p', 'a', 'A'), e('a', 'a2'), e('p', 'bw', 'B'), e('bw', 'b')]
    const fake = seed([{ id: WF, nodes, edges }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    for (const id of ['a', 'a2', 'bw', 'b']) expect(visits(row.execution_trace, id)).toBe(1)
  })

  describe('with a branch waiting', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-10-24T10:00:00Z'))
    })

    it('a user task in a branch: the run pauses, and Done runs once after the resume', async () => {
      const nodes = [
        trigger, parallel('p', ['Approve', 'Lookup']),
        { id: 'ut', type: 'user_task', label: 'Approve', config: { task_title: 'Approve', outcomes: ['Approved', 'Rejected'] } },
        setVar('lookup', 'vendor', 'ACME'),
        setVar('done', 'summary', '{{vendor}}:{{outcome}}'),
        setVar('after', 'after', 'yes'),
      ]
      const edges = [e('start', 'p'), e('p', 'ut', 'Approve'), e('p', 'lookup', 'Lookup'), e('p', 'done', 'Done'), e('done', 'after')]
      const fake = seed([{ id: WF, nodes, edges }])
      const result = await run(fake, { test: true })
      expect(result.status).toBe('waiting_for_event')
      let row = runRow(fake, result.run_id)
      expect(row.node_results.done).toBeUndefined()
      expect(row.node_results.lookup.status).toBe('success')

      const resumed = await resumeWorkflow(result.run_id!, { outcome: 'Approved' }, undefined, { supabase: fake.client })
      expect(resumed.status).toBe('completed')
      row = runRow(fake, result.run_id)
      expect(row.node_results.done.output?.value).toBe('ACME:Approved')
      expect(row.node_results.after.status).toBe('success')
      expect(visits(row.execution_trace, 'done')).toBe(1)
    })

    it('two timed waits: Done runs only after the last branch resumes', async () => {
      const nodes = [
        trigger, parallel('p', ['Short', 'Long']),
        wait('short', 60_000), setVar('s', 's', 'S'),
        wait('long', 120_000), setVar('l', 'l', 'L'),
        setVar('done', 'both', '{{s}}{{l}}'),
      ]
      const edges = [e('start', 'p'), e('p', 'short', 'Short'), e('short', 's'), e('p', 'long', 'Long'), e('long', 'l'), e('p', 'done')]
      const fake = seed([{ id: WF, nodes, edges }])
      const result = await run(fake)
      expect(result.status).toBe('waiting_for_event')
      createClientMock.mockImplementation(() => fake.client)

      vi.setSystemTime(new Date('2026-10-24T10:01:01Z'))
      await processWorkflowQueueBatch({ batchSize: 5 })
      let row = runRow(fake, result.run_id)
      expect(row.status).toBe('waiting_for_event')
      expect(row.node_results.s.status).toBe('success')
      expect(row.node_results.done).toBeUndefined()

      vi.setSystemTime(new Date('2026-10-24T10:02:01Z'))
      await processWorkflowQueueBatch({ batchSize: 5 })
      row = runRow(fake, result.run_id)
      expect(row.status).toBe('completed')
      expect(row.node_results.done.output?.value).toBe('SL')
      expect(visits(row.execution_trace, 'done')).toBe(1)
    })

    it('a nested Parallel with a wait: its Done runs after the resume, then the outer join', async () => {
      const nodes = [
        trigger, parallel('p1', ['Inner', 'Other']),
        parallel('p2', ['I1', 'I2']), wait('iw', 60_000), setVar('i1', 'i1', 'x'), setVar('i2', 'i2', 'y'),
        setVar('d2', 'inner', '{{i1}}{{i2}}'),
        setVar('o', 'other', 'z'),
        setVar('j1', 'all', '{{inner}}{{other}}'),
      ]
      const edges = [
        e('start', 'p1'), e('p1', 'p2', 'Inner'), e('p1', 'o', 'Other'),
        e('p2', 'iw', 'I1'), e('iw', 'i1'), e('p2', 'i2', 'I2'), e('p2', 'd2', 'Done'),
        e('d2', 'j1'), e('o', 'j1'),
      ]
      const fake = seed([{ id: WF, nodes, edges }])
      const result = await run(fake)
      expect(result.status).toBe('waiting_for_event')
      let row = runRow(fake, result.run_id)
      expect(row.node_results.d2).toBeUndefined()
      expect(row.node_results.j1.status).toBe('waiting')
      const resumed = await resumeTimedPause(result.run_id!, row.event_id!, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
      expect(resumed.status).toBe('completed')
      row = runRow(fake, result.run_id)
      expect(row.node_results.d2.output?.value).toBe('xy')
      expect(row.node_results.j1.output?.value).toBe('xyz')
      expect(visits(row.execution_trace, 'd2')).toBe(1)
      expect(visits(row.execution_trace, 'j1')).toBe(1)
    })
  })
})
