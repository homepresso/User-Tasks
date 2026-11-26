/**
 * Run checkpoints and step idempotency (lib/workflow-checkpoints.ts) on the
 * real engine with an in-memory Supabase fake:
 *  - a run records its start (base) and each side-effecting step's output
 *    and variable changes; the checkpoint is cleared when the run finishes;
 *  - recovering a run whose worker was lost replays completed steps (not run
 *    again), runs the rest, and finishes the same run;
 *  - a non-idempotent step that was started but not completed fails with
 *    "outcome unknown" (or runs again with interrupted_steps: retry);
 *  - an email whose effect was recorded is not sent again; HTTP requests can
 *    carry the step's idempotency key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true, id: 'mail-1' })))
vi.mock('@/lib/email', () => ({ sendEmail: sendEmailMock }))

import { executeWorkflow, recoverRunFromCheckpoint } from '@/lib/workflow-engine'
import { checkpointMode, isIdempotentStep, isSideEffectingNode, variablesDelta, snapshotVariables } from '@/lib/workflow-checkpoints'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = '0b000000-0000-4000-8000-00000000000a'
const WF = '0b000000-0000-4000-8000-0000000000a1'
const RUN = '0b000000-0000-4000-8000-0000000000c1'

type Node = { id: string; type: string; label: string; config: Record<string, unknown> }
const chain = (nodes: Node[]) => ({ nodes, edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })) })

const trigger = (config: Record<string, unknown> = {}): Node => ({ id: 'start', type: 'manual', label: 'Start', config })
const log = (id: string, message: string): Node => ({ id, type: 'log', label: `Log ${id}`, config: { message } })
const email = (id: string): Node => ({ id, type: 'send_email', label: 'Notify', config: { to: 'ops@example.com', subject: 'Hi {{who}}', body: 'Body' } })
const setVar = (id: string, name: string, expression: string): Node => ({ id, type: 'set_variable', label: `Set ${name}`, config: { name, expression } })

function seed(def: { nodes: Node[]; edges: unknown[] }, runs: Array<Record<string, unknown>> = []): FakeSupabase {
  const fake = createFakeSupabase({
    workflows: [{ id: WF, tenant_id: TENANT, name: 'Checkpointed', trigger_type: 'manual', nodes: def.nodes, edges: def.edges, run_count: 0, published_version_id: null }],
    workflow_runs: runs,
    workflow_step_effects: [],
  })
  fake.rpcs.record_workflow_run = () => ({})
  fake.rpcs.checkpoint_run_step = (args) => {
    const run = fake.tables.workflow_runs.find((r) => r.id === args.p_run_id)
    const cp = run?.checkpoint as any
    if (!run || run.status !== 'running' || cp?.segment !== args.p_segment) return { data: false }
    cp.completed = { ...(cp.completed ?? {}), ...((args.p_completed as object) ?? {}) }
    cp.started = { ...(cp.started ?? {}), ...((args.p_started as object) ?? {}) }
    return { data: true }
  }
  createClientMock.mockImplementation(() => fake.client)
  return fake
}

beforeEach(() => {
  createClientMock.mockReset()
  sendEmailMock.mockClear()
  delete process.env.WORKFLOW_CHECKPOINTS
})

describe('classification', () => {
  it('knows pure, side-effecting and idempotent steps', () => {
    expect(isSideEffectingNode('set_variable')).toBe(false)
    expect(isSideEffectingNode('http_request')).toBe(true)
    expect(isSideEffectingNode('some_new_step')).toBe(true) // unknown = side-effecting (safe)
    expect(isIdempotentStep({ type: 'send_email' })).toBe(true)
    expect(isIdempotentStep({ type: 'http_request', config: { method: 'GET' } })).toBe(true)
    expect(isIdempotentStep({ type: 'http_request', config: { method: 'POST' } })).toBe(false)
    expect(isIdempotentStep({ type: 'http_request', config: { method: 'POST', idempotency_header: true } })).toBe(true)
    expect(isIdempotentStep({ type: 'create_subtask' })).toBe(false)
  })

  it('WORKFLOW_CHECKPOINTS: side_effects by default, all, off', () => {
    expect(checkpointMode({})).toBe('side_effects')
    expect(checkpointMode({ WORKFLOW_CHECKPOINTS: 'all' })).toBe('all')
    expect(checkpointMode({ WORKFLOW_CHECKPOINTS: 'off' })).toBe('off')
  })

  it('variable deltas: set and removed keys only', () => {
    const vars: Record<string, unknown> = { a: 1, b: { x: 1 }, c: 3 }
    const before = snapshotVariables(vars)
    vars.a = 2
    delete vars.c
    vars.d = 'new'
    expect(variablesDelta(before, vars)).toEqual({ set: { a: 2, d: 'new' }, removed: ['c'] })
  })
})

describe('checkpoints during a run', () => {
  it('records the start and each side-effecting step, then clears the checkpoint at the end', async () => {
    const fake = seed(chain([trigger(), log('l1', 'one'), setVar('s1', 'who', 'Ana'), email('m1')]))
    const result = await executeWorkflow(WF, undefined, false, { input: 1 })
    expect(result.status).toBe('completed')
    const steps = fake.calls.filter((c) => c.rpc === 'checkpoint_run_step')
    const completed = steps.flatMap((c) => Object.keys(((c.args as any).p_completed as object) ?? {}))
    const started = steps.flatMap((c) => Object.keys(((c.args as any).p_started as object) ?? {}))
    expect(completed).toEqual(['l1#1', 'm1#1']) // pure set_variable / trigger are recomputed on replay
    expect(started).toEqual(['l1#1']) // the email is idempotent (effect record): no started mark
    const run = fake.tables.workflow_runs[0]
    expect(run.status).toBe('completed')
    expect(run.checkpoint).toBeNull()
    // The email's effect is recorded by its idempotency key.
    expect(fake.tables.workflow_step_effects).toEqual([expect.objectContaining({ key: `${run.id}:m1:1`, kind: 'send_email' })])
  })

  it('WORKFLOW_CHECKPOINTS=off writes nothing', async () => {
    process.env.WORKFLOW_CHECKPOINTS = 'off'
    const fake = seed(chain([trigger(), log('l1', 'one')]))
    await executeWorkflow(WF, undefined, false, {})
    expect(fake.calls.filter((c) => c.rpc === 'checkpoint_run_step')).toHaveLength(0)
  })
})

function runningRun(checkpoint: Record<string, unknown>) {
  return { id: RUN, workflow_id: WF, tenant_id: TENANT, status: 'running', version_id: null, trace_id: null, checkpoint, node_results: {} }
}
const base = { kind: 'start', task_id: null, test: false, variables: { who: 'Ana' }, initiator: { userId: null, via: 'api' } }

describe('recovery after a lost worker', () => {
  it('replays completed steps (not run again) and finishes the same run', async () => {
    const fake = seed(
      chain([trigger(), log('l1', 'recomputed'), setVar('s1', 'greeting', 'Hello {{l1_marker}}'), log('l2', 'two')]),
      [runningRun({ v: 1, segment: 'seg-1', base, completed: { 'l1#1': { o: { logged: 'stored' }, d: { l1_marker: 'from-checkpoint' }, at: 'x' } }, started: { 'l1#1': 'x' } })],
    )
    const result = await recoverRunFromCheckpoint(RUN, { tenantId: TENANT, workflowId: WF })
    expect(result?.status).toBe('completed')
    expect(result?.run_id).toBe(RUN)
    expect(result?.node_results.l1.output).toEqual({ logged: 'stored' })
    expect(result?.node_results.s1).toBeTruthy()
    expect(result?.logs?.some((l: any) => /Replayed from checkpoint: Log l1/.test(l.message))).toBe(true)
    // No new run row; the recovered one finished.
    expect(fake.tables.workflow_runs).toHaveLength(1)
    expect(fake.tables.workflow_runs[0]).toMatchObject({ status: 'completed', checkpoint: null })
  })

  it('fails a started-but-unfinished non-idempotent step as outcome unknown', async () => {
    seed(
      chain([trigger(), log('l1', 'one'), log('l2', 'two')]),
      [runningRun({ v: 1, segment: 'seg-1', base, completed: { 'l1#1': { o: { logged: 'one' }, d: {}, at: 'x' } }, started: { 'l1#1': 'x', 'l2#1': 'x' } })],
    )
    const result = await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })
    expect(result?.status).toBe('failed')
    expect(result?.error).toMatch(/^Outcome unknown: the worker running "Log l2" was lost/)
  })

  it('runs it again when the workflow says interrupted_steps: retry', async () => {
    seed(
      chain([trigger({ interrupted_steps: 'retry' }), log('l1', 'one'), log('l2', 'two')]),
      [runningRun({ v: 1, segment: 'seg-1', base, completed: { 'l1#1': { o: { logged: 'one' }, d: {}, at: 'x' } }, started: { 'l1#1': 'x', 'l2#1': 'x' } })],
    )
    const result = await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })
    expect(result?.status).toBe('completed')
    expect(result?.node_results.l2.output).toEqual({ logged: 'two' })
  })

  it('does not send an email again when its effect was recorded before the worker was lost', async () => {
    const fake = seed(
      chain([trigger(), email('m1'), log('l2', 'after')]),
      [runningRun({ v: 1, segment: 'seg-1', base, completed: {}, started: { 'm1#1': 'x' } })],
    )
    fake.tables.workflow_step_effects.push({ key: `${RUN}:m1:1`, tenant_id: TENANT, kind: 'send_email', result: { o: { sent: true, email_id: 'mail-0' }, d: {} } })
    const result = await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })
    expect(result?.status).toBe('completed')
    expect(sendEmailMock).not.toHaveBeenCalled()
    expect(result?.node_results.m1.output).toEqual({ sent: true, email_id: 'mail-0' })
  })

  it('re-sends an email that was started but never recorded (idempotent by key, not outcome unknown)', async () => {
    seed(
      chain([trigger(), email('m1')]),
      [runningRun({ v: 1, segment: 'seg-1', base, completed: {}, started: { 'm1#1': 'x' } })],
    )
    const result = await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })
    expect(result?.status).toBe('completed')
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
  })

  it('returns null without a usable checkpoint, or for a run that is not running', async () => {
    seed(chain([trigger()]), [{ ...runningRun(null as any) }])
    expect(await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })).toBeNull()
    seed(chain([trigger()]), [{ ...runningRun({ v: 1, segment: 's', base, completed: {}, started: {} }), status: 'completed' }])
    expect(await recoverRunFromCheckpoint(RUN, { tenantId: TENANT })).toBeNull()
  })
})

describe('checkpoint size budget (a Loop of thousands of side-effecting steps)', () => {
  it('keeps completed records within MAX_COMPLETED_BYTES: later steps are recorded without output / variables', async () => {
    const { CheckpointRuntime, MAX_COMPLETED_BYTES, newCheckpoint } = await import('@/lib/workflow-checkpoints')
    let written = 0
    const supabase = { rpc: vi.fn(async (_fn: string, args: any) => { written += JSON.stringify(args.p_completed ?? {}).length; return { data: true, error: null } }) } as any
    const cp = newCheckpoint({ kind: 'start', variables: {} } as any)
    const runtime = new CheckpointRuntime(supabase, RUN, cp, 'side_effects', null)
    const node = { id: 'http', type: 'http_request', config: {} }
    const output = { body: 'x'.repeat(100 * 1024) }
    for (let visit = 1; visit <= 200; visit++) await runtime.recordCompleted(node, visit, output, { set: { last: output }, removed: [] })
    const kept = JSON.stringify(cp.completed).length
    // Before: 200 x ~200 KB = ~40 MB held in memory and merged into the run row.
    expect(kept).toBeLessThan(MAX_COMPLETED_BYTES + 200 * 200)
    expect(written).toBeLessThan(MAX_COMPLETED_BYTES + 200 * 200)
    expect(cp.completed['http#1']).toMatchObject({ o: output })
    expect(cp.completed['http#200']).toMatchObject({ o: null, d: {}, t: true })
    // A replay of a step recorded past the budget is the oversized-step case: not restored.
    const replay = new CheckpointRuntime(supabase, RUN, newCheckpoint({ kind: 'start', variables: {} } as any), 'side_effects', cp, 'fail')
    expect(replay.decide({ id: 'http', type: 'http_request', config: { method: 'POST' } }, 200).kind).toBe('outcome_unknown')
    expect(replay.decide({ id: 'http', type: 'http_request', config: { method: 'POST' } }, 1).kind).toBe('replay')
  })
})

describe('Loop N times iteration cap', () => {
  it('fails the step with a clear error instead of allocating a 100M-entry array (worker OOM; main caps it via maxStepsPerRun)', async () => {
    const loopN = (count: string): Node => ({ id: 'ln', type: 'loop_n_times', label: 'Repeat', config: { count, index_var: 'i' } })
    seed(chain([trigger(), loopN('100000000'), log('l1', 'x')]))
    const heapBefore = process.memoryUsage().heapUsed
    const result = await executeWorkflow(WF, undefined, false, {})
    expect(result.status).toBe('failed')
    expect(JSON.stringify(result)).toMatch(/Step limit reached/)
    expect(process.memoryUsage().heapUsed - heapBefore).toBeLessThan(200 * 1024 * 1024)
  })
})

describe('people directory shared across runs (USER_NAME / USER_EMAIL)', () => {
  it('loads a workspace\'s directory once for consecutive runs, and still resolves names', async () => {
    const { clearPeopleDirectoriesForTests } = await import('@/lib/workflow-engine')
    clearPeopleDirectoriesForTests()
    const USER = '0b000000-0000-4000-8000-0000000000e1'
    const fake = seed(chain([trigger(), log('l1', `hi {{=USER_NAME("${USER}")}}`)]))
    fake.tables.user_memberships = [{ id: 'm1', tenant_id: TENANT, user_id: USER }]
    fake.tables.users = [{ id: USER, display_name: 'Ana Lima', email: 'ana@example.com' }]
    const r1 = await executeWorkflow(WF, undefined, false, {})
    const r2 = await executeWorkflow(WF, undefined, false, {})
    expect([r1.status, r2.status]).toEqual(['completed', 'completed'])
    expect(JSON.stringify(fake.tables.workflow_runs)).toContain('Ana Lima')
    // Before: one membership read (+ user chunks) per run.
    expect(fake.calls.filter((c) => c.table === 'user_memberships').length).toBe(1)
    clearPeopleDirectoriesForTests()
  })
})
