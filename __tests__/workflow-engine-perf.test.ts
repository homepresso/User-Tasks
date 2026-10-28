/**
 * Perf phase 1 engine contracts, run against an in-memory Supabase fake:
 *  - delay / pause_until over 30 s pause the run and enqueue a delay_resume
 *    job; the queue worker resumes it at the scheduled time at the next node
 *    with variables intact. ≤ 30 s still waits inline.
 *  - per-run caches (decision tables, data table columns),
 *  - persisted node outputs / trace / logs are capped, in-memory ones are not,
 *  - run stats via record_workflow_run (with fallback), logs flushed before
 *    executeWorkflow returns, sub-workflow logs stored once, one client per tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refuseClient = () => { throw new Error('engine must reuse the caller\'s client') }
const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { executeWorkflow, resumeTimedPause } from '@/lib/workflow-engine'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const OTHER_TENANT = '0e000000-0000-4000-8000-00000000000b'
const WF = '0e000000-0000-4000-8000-0000000000a1'
const SUB_WF = '0e000000-0000-4000-8000-0000000000a2'

type Node = { id: string; type: string; label: string; config: Record<string, unknown> }

function chain(nodes: Node[]) {
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id }))
  return { nodes, edges }
}

const trigger: Node = { id: 'start', type: 'schedule', label: 'Start', config: {} }
const setVar = (id: string, name: string, expression: string): Node =>
  ({ id, type: 'set_variable', label: `Set ${name}`, config: { name, expression } })

function seed(workflows: Array<{ id: string; nodes: Node[]; edges: unknown[]; name?: string }>) {
  const fake = createFakeSupabase({
    workflows: workflows.map((w) => ({
      id: w.id, tenant_id: TENANT, name: w.name ?? 'Perf test', trigger_type: 'schedule',
      nodes: w.nodes, edges: w.edges, run_count: 0, published_version_id: null,
    })),
  })
  // Queue: enqueue_workflow / claim_next_job / complete_job / fail_job over a
  // workflow_queue table, honouring scheduled_for against the (fake) clock.
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
    const job = (fake.tables.workflow_queue ?? []).find((j) => j.status === 'pending' && Number(j.scheduled_for) <= Date.now())
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
  fake.rpcs.record_workflow_run = (args) => {
    const wf = fake.tables.workflows.find((w) => w.id === args.p_workflow_id)
    if (wf) wf.run_count = Number(wf.run_count ?? 0) + 1
    return {}
  }
  return fake
}

beforeEach(() => { createClientMock.mockReset(); createClientMock.mockImplementation(refuseClient) })

const run = (fake: FakeSupabase, id = WF, vars: Record<string, unknown> = {}) =>
  executeWorkflow(id, undefined, false, vars, undefined, undefined, undefined, { supabase: fake.client })

type StoredNodeResult = { status: string; output: Record<string, unknown> }
type StoredRun = {
  status: string
  event_id: string
  paused_node_id: string | null
  pause_variables: Record<string, unknown>
  node_results: Record<string, StoredNodeResult>
  execution_trace: Array<Record<string, unknown>>
}
const runRow = (fake: FakeSupabase, runId?: string) =>
  fake.tables.workflow_runs.find((r) => r.id === runId) as unknown as StoredRun

describe('long delays pause the run and resume from the queue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T10:00:00Z'))
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
  })
  afterEach(() => { vi.useRealTimers() })

  const delayFlow = () => chain([
    trigger,
    setVar('before', 'greeting', 'hello'),
    { id: 'wait', type: 'delay', label: 'Wait', config: { duration: 45, unit: 'seconds' } },
    setVar('after', 'echo', '{{greeting}} again'),
  ])

  it('persists a waiting run and enqueues a delay_resume job for the resume time', async () => {
    const fake = seed([{ id: WF, ...delayFlow() }])
    const result = await run(fake)

    expect(result.status).toBe('waiting_for_event')
    expect(result.paused_node_id).toBe('wait')
    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('waiting_for_event')
    expect(row.paused_node_id).toBe('wait')
    expect(row.event_id).toMatch(/^delay_/)
    expect(row.pause_variables.greeting).toBe('hello')
    expect(row.node_results.after).toBeUndefined()
    expect(row.node_results.wait.status).toBe('waiting')
    expect(row.node_results.wait.output.resume_at).toBe('2026-10-24T10:00:45.000Z')

    const [job] = fake.tables.workflow_queue
    expect(job.trigger_type).toBe('delay_resume')
    expect(job.trigger_data).toEqual({ _resume_run_id: result.run_id, _resume_event_id: row.event_id })
    expect(job.scheduled_for).toBe(new Date('2026-10-24T10:00:45Z').getTime())
    // Not counted as a finished run yet.
    expect(fake.tables.workflows[0].run_count).toBe(0)
  })

  it('the queue worker resumes at the scheduled time at the next node with variables intact', async () => {
    const fake = seed([{ id: WF, ...delayFlow() }])
    const result = await run(fake)
    // The queue worker creates the one client and hands it to the engine.
    createClientMock.mockImplementation(() => fake.client)

    // Before the resume time: nothing to claim, the run keeps waiting.
    vi.setSystemTime(new Date('2026-10-24T10:00:44Z'))
    expect((await processWorkflowQueueBatch({ batchSize: 5 })).processed).toBe(0)
    expect(runRow(fake, result.run_id).status).toBe('waiting_for_event')

    vi.setSystemTime(new Date('2026-10-24T10:00:46Z'))
    const batch = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(batch.processed).toBe(1)
    expect(batch.results[0].status).toBe('completed')

    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.after.status).toBe('success')
    expect(row.node_results.after.output.value).toBe('hello again')
    expect(row.node_results.before.status).toBe('success') // not re-run, kept from before the pause
    expect(row.node_results.wait.status).toBe('success')
    expect(row.node_results.wait.output.waited_ms).toBe(46_000)
    expect(fake.count('workflow_runs', 'insert')).toBe(1) // same run, not a new one
    expect(fake.tables.workflows[0].run_count).toBe(1)
    expect(fake.tables.workflow_queue[0].status).toBe('completed')
  })

  it('pause_until a later time pauses until that time', async () => {
    const fake = seed([{ id: WF, ...chain([
      trigger,
      { id: 'until', type: 'pause_until', label: 'Until', config: { date: '2026-10-24T12:00:00Z' } },
      setVar('after', 'done', 'yes'),
    ]) }])
    const result = await run(fake)
    createClientMock.mockImplementation(() => fake.client)
    expect(result.status).toBe('waiting_for_event')
    expect(fake.tables.workflow_queue[0].scheduled_for).toBe(new Date('2026-10-24T12:00:00Z').getTime())

    vi.setSystemTime(new Date('2026-10-24T12:00:01Z'))
    await processWorkflowQueueBatch({ batchSize: 1 })
    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.after.output.value).toBe('yes')
  })

  it('a resume job is a no-op once the run was resumed, and only resumes runs of its own workflow and tenant', async () => {
    const fake = seed([{ id: WF, ...delayFlow() }])
    const result = await run(fake)
    const eventId = runRow(fake, result.run_id).event_id

    const wrongTenant = await resumeTimedPause(result.run_id!, eventId, { workflowId: WF, tenantId: OTHER_TENANT }, { supabase: fake.client })
    expect(wrongTenant.status).toBe('skipped')
    const wrongEvent = await resumeTimedPause(result.run_id!, 'evt_0000', { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(wrongEvent.status).toBe('skipped')
    expect(runRow(fake, result.run_id).status).toBe('waiting_for_event')

    const ok = await resumeTimedPause(result.run_id!, eventId, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(ok.status).toBe('completed')
    const again = await resumeTimedPause(result.run_id!, eventId, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(again.status).toBe('skipped')
  })
})

describe('short and loop delays', () => {
  it('a delay of 30 s or less still waits inline', async () => {
    const fake = seed([{ id: WF, ...chain([
      trigger,
      { id: 'wait', type: 'delay', label: 'Wait', config: { duration: 0.02, unit: 'seconds' } },
      setVar('after', 'x', '1'),
    ]) }])
    const started = Date.now()
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(Date.now() - started).toBeGreaterThanOrEqual(15)
    expect(fake.tables.workflow_queue ?? []).toHaveLength(0)
  })

  it('a long delay inside a loop body does not pause (loop state cannot be resumed) and logs a warning', async () => {
    const nodes: Node[] = [
      trigger,
      { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: 2 } },
      { id: 'wait', type: 'delay', label: 'Wait', config: { duration: 5, unit: 'minutes' } },
    ]
    const fake = seed([{ id: WF, nodes, edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'e2', source: 'loop', target: 'wait', label: 'Each Item' },
    ] }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(fake.tables.workflow_queue ?? []).toHaveLength(0)
    expect(result.logs?.some((l) => l.level === 'warn' && /inside a loop body/.test(l.message))).toBe(true)
  })
})

describe('per-run caches', () => {
  it('reads a decision table once for a loop of evaluations', async () => {
    const nodes: Node[] = [
      trigger,
      { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: 5 } },
      { id: 'rule', type: 'decision_table', label: 'Rule', config: { decision_table_id: 'dt1', input_mappings: { amount: '{{i}}' } } },
    ]
    const fake = seed([{ id: WF, nodes, edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'e2', source: 'loop', target: 'rule', label: 'Each Item' },
    ] }])
    fake.tables.decision_tables = [{
      id: 'dt1', tenant_id: TENANT, name: 'Tier',
      inputs: [{ id: 'in1', key: 'amount', label: 'Amount', type: 'number' }],
      outputs: [{ id: 'out1', key: 'tier', label: 'Tier', type: 'text' }],
      rules: [{ id: 'r1', label: 'High', conditions: [{ id: 'c1', inputKey: 'amount', operator: 'gte', value: '3' }], outputs: { tier: 'high' } }],
    }]
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(fake.count('decision_tables')).toBe(1)
  })

  it('reads data table columns once per run and re-reads after the engine adds columns', async () => {
    const nodes: Node[] = [
      trigger,
      { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: 3 } },
      { id: 'ins', type: 'update_data_table', label: 'Insert', config: { table_id: 't1', operation: 'insert', column_values: { name: 'row {{i}}' } } },
    ]
    const fake = seed([{ id: WF, nodes, edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'e2', source: 'loop', target: 'ins', label: 'Each Item' },
    ] }])
    fake.tables.custom_tables = [{ id: 't1', tenant_id: TENANT, name: 'T', slug: 't', columns: [{ key: 'name', label: 'Name' }] }]
    const before = fake.count('custom_tables', 'select')
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(fake.tables.custom_table_rows).toHaveLength(3)
    // 1 cached column read by the engine; with no data_table_event workflow
    // active the trigger path no longer reads the table at all (phase 2) —
    // previously 2 reads per insert.
    expect(fake.count('custom_tables', 'select') - before).toBe(1)
  })
})

describe('persisted size caps', () => {
  afterEach(() => {
    delete process.env.WORKFLOW_NODE_RESULT_MAX_BYTES
    delete process.env.WORKFLOW_TRACE_MAX_ENTRIES
    delete process.env.WORKFLOW_LOG_MAX_ENTRIES
  })

  it('truncates oversized node outputs only in the stored copy', async () => {
    process.env.WORKFLOW_NODE_RESULT_MAX_BYTES = '200'
    const big = 'x'.repeat(1000)
    const fake = seed([{ id: WF, ...chain([
      trigger,
      setVar('big', 'payload', big),
      setVar('len', 'length', '{{=LENGTH(payload)}}'),
    ]) }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    // In memory: full output, and the downstream node saw the full value.
    expect(result.node_results.big.output.value).toBe(big)
    expect(result.node_results.len.output.value).toBe(1000)
    // Stored: truncated with a marker.
    const stored = runRow(fake, result.run_id).node_results
    expect(stored.big.output._truncated).toBe(true)
    expect(stored.big.output._original_size).toBeGreaterThan(1000)
    expect(stored.big.output.preview).toHaveLength(200)
    expect(stored.len.output.value).toBe(1000)
  })

  it('caps the stored execution trace and log rows with a truncation marker', async () => {
    process.env.WORKFLOW_TRACE_MAX_ENTRIES = '50'
    process.env.WORKFLOW_LOG_MAX_ENTRIES = '40'
    const nodes: Node[] = [
      trigger,
      { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: 100 } },
      setVar('body', 'x', '{{i}}'),
    ]
    const fake = seed([{ id: WF, nodes, edges: [
      { id: 'e1', source: 'start', target: 'loop' },
      { id: 'e2', source: 'loop', target: 'body', label: 'Each Item' },
    ] }])
    const result = await run(fake)
    expect(result.status).toBe('completed')

    const trace = runRow(fake, result.run_id).execution_trace
    expect(trace).toHaveLength(50)
    const marker = trace.find((t) => t.type === 'truncated')
    expect(marker?.dropped).toBeGreaterThan(0)
    // The end of the run is kept.
    expect(trace[trace.length - 1].node_id).toBe('body')

    const logs = fake.tables.workflow_logs.filter((l) => l.run_id === result.run_id)
    expect(logs).toHaveLength(40)
    expect(logs.some((l) => /log entries dropped/.test(String(l.message)))).toBe(true)
    expect(String(logs[logs.length - 1].message)).toMatch(/Workflow completed/)
  })
})

describe('run bookkeeping', () => {
  it('increments run stats with record_workflow_run and flushes logs before returning', async () => {
    const fake = seed([{ id: WF, ...chain([trigger, setVar('a', 'x', '1')]) }])
    const result = await run(fake)
    expect(fake.calls.some((c) => c.rpc === 'record_workflow_run')).toBe(true)
    expect(fake.count('workflows', 'update')).toBe(0)
    expect(fake.tables.workflows[0].run_count).toBe(1)
    // Awaited: the log rows exist as soon as executeWorkflow resolves.
    expect(fake.tables.workflow_logs.filter((l) => l.run_id === result.run_id).length).toBeGreaterThan(0)
  })

  it('falls back to a direct update while record_workflow_run is not deployed', async () => {
    const fake = seed([{ id: WF, ...chain([trigger, setVar('a', 'x', '1')]) }])
    delete fake.rpcs.record_workflow_run
    await run(fake)
    expect(fake.count('workflows', 'update')).toBe(1)
    expect(fake.tables.workflows[0].run_count).toBe(1)
  })

  it('stores sub-workflow logs once (under the sub-run) and reuses the client', async () => {
    const sub = chain([trigger, setVar('s', 'sub_value', 'from sub')])
    const parent = chain([
      trigger,
      { id: 'call', type: 'call_sub_workflow', label: 'Call', config: { sub_workflow_id: SUB_WF, sub_workflow_name: 'Child' } },
    ])
    const fake = seed([{ id: WF, ...parent }, { id: SUB_WF, ...sub, name: 'Child' }])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(createClientMock).not.toHaveBeenCalled()

    // Returned logs still include the sub-workflow's lines…
    expect(result.logs?.some((l) => String(l.message).startsWith('[Sub: Child]'))).toBe(true)
    // …but they are stored only under the sub-run.
    const parentRows = fake.tables.workflow_logs.filter((l) => l.run_id === result.run_id)
    expect(parentRows.some((l) => String(l.message).startsWith('[Sub:'))).toBe(false)
    expect(parentRows.some((l) => (l.metadata as Record<string, unknown> | null)?.sub_run_id)).toBe(true)
    const subRun = fake.tables.workflow_runs.find((r) => r.workflow_id === SUB_WF)!
    const subRows = fake.tables.workflow_logs.filter((l) => l.run_id === subRun.id)
    expect(subRows.some((l) => /Workflow completed/.test(String(l.message)))).toBe(true)
  })
})
