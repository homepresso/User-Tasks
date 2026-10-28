/**
 * `workflow_started_by` is the person who started the run, per start path
 * (real engine, queue worker and services over the in-memory Supabase fake):
 *  - Run dialog / API / CLI / MCP: the context's user (a tenant key: its
 *    creator), with `workflow_started_via`; sync and queued;
 *  - a form button's Start workflow and the Form submitted trigger: the
 *    submitter; task triggers: the task's actor; sub-workflows: the parent's
 *    initiator; data-table events: the writer;
 *  - schedules and other user-less starts: the workflow's owner;
 *  - `workflow_owner_id` is always the creator, and nobody can set the
 *    three variables: not start variables, not a forged / replayed / foreign
 *    signature, not a resumed task's values.
 * The signing helpers themselves are covered at the end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { resetQueueKickState } from '@/lib/process-queue'
import { startWorkflow } from '@/lib/services/workflow-start'
import { enqueueFormSubmittedWorkflows, runButtonActions } from '@/lib/services/form-submissions'
import { enqueueDataTableEvents } from '@/lib/data-table-workflow-triggers'
import type { ServiceContext } from '@/lib/services/context'
import {
  canonicalJson, initiatorFromContext, initiatorVariables, isCliUserAgent, readQueuedInitiator,
  stripInitiatorVariables, taskEventActor, viaForTriggerType, withQueuedInitiator,
} from '@/lib/workflow-initiator'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = '0f000000-0000-4000-8000-00000000000a'
const WF = '0f000000-0000-4000-8000-0000000000a1'
const PARENT = '0f000000-0000-4000-8000-0000000000a2'
const FORM_WF = '0f000000-0000-4000-8000-0000000000a3'
const TABLE_WF = '0f000000-0000-4000-8000-0000000000a4'
const OWNER = '0f000000-0000-4000-8000-0000000000b1'
const ALICE = '0f000000-0000-4000-8000-0000000000b2'
const BOB = '0f000000-0000-4000-8000-0000000000b3'
const CAROL = '0f000000-0000-4000-8000-0000000000b4'
const TASK = '0f000000-0000-4000-8000-0000000000c1'
const FORM = '0f000000-0000-4000-8000-0000000000d1'
const TABLE = '0f000000-0000-4000-8000-0000000000e1'

const who = { id: 'who', type: 'set_variable', label: 'Who', config: { name: 'who', expression: '{{workflow_started_by}}|{{workflow_started_via}}|{{workflow_owner_id}}' } }
const wf = (id: string, trigger: string, extra: Record<string, unknown> = {}) => ({
  id, tenant_id: TENANT, name: `WF ${id.slice(-2)}`, is_active: true, trigger_type: trigger, run_count: 0,
  published_version_id: null, user_variables: [], created_by: OWNER,
  nodes: [{ id: 'start', type: trigger, label: 'Start', config: {} }, who],
  edges: [{ id: 'e1', source: 'start', target: 'who' }],
  ...extra,
})

function seed() {
  const fake = createFakeSupabase({
    workflows: [
      wf(WF, 'manual'),
      wf(PARENT, 'manual', {
        nodes: [
          { id: 'start', type: 'manual', label: 'Start', config: {} },
          { id: 'call', type: 'call_sub_workflow', label: 'Call', config: { sub_workflow_id: WF, sub_workflow_name: 'Child' } },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'call' }],
      }),
      wf(FORM_WF, 'form_submitted', { nodes: [{ id: 'start', type: 'form_submitted', label: 'Start', config: { form_id: FORM } }, who] }),
      wf(TABLE_WF, 'data_table_event', { nodes: [{ id: 'start', type: 'data_table_event', label: 'Start', config: { table_id: TABLE } }, who] }),
    ],
    workflow_runs: [],
    workflow_queue: [],
    tasks: [{ id: TASK, tenant_id: TENANT, assigner_id: OWNER, assignee_id: BOB, actioned_by: CAROL }],
    custom_tables: [{ id: TABLE, tenant_id: TENANT, name: 'Orders', slug: 'orders', columns: [] }],
  })
  fake.rpcs.record_workflow_run = () => ({})
  const enqueue = (job: { workflow_id: unknown; tenant_id: unknown; task_id?: unknown; trigger_type: unknown; trigger_data: unknown }) => {
    const id = crypto.randomUUID()
    // JSON round trip with reordered keys, like jsonb.
    const data = JSON.parse(JSON.stringify(job.trigger_data ?? {}))
    const reordered = Object.fromEntries(Object.entries(data).reverse())
    fake.tables.workflow_queue.push({ id, ...job, task_id: job.task_id ?? null, trigger_data: reordered, status: 'pending', attempts: 0, priority: 0 })
    return id
  }
  fake.rpcs.enqueue_workflow = (a) => ({ data: enqueue({ workflow_id: a.p_workflow_id, tenant_id: a.p_tenant_id, task_id: a.p_task_id, trigger_type: a.p_trigger_type, trigger_data: a.p_trigger_data }) })
  fake.rpcs.enqueue_workflow_batch = (a) => {
    for (const job of a.p_jobs as any[]) enqueue({ ...job, tenant_id: a.p_tenant_id })
    return { data: (a.p_jobs as unknown[]).length }
  }
  fake.rpcs.claim_jobs = (a) => {
    const picked = fake.tables.workflow_queue.filter((j) => j.status === 'pending').slice(0, Number(a.p_limit))
    for (const job of picked) job.status = 'processing'
    return { data: picked.map((j) => structuredClone(j)) }
  }
  fake.rpcs.complete_job = (a) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === a.p_job_id)!, { status: 'completed', result: a.p_result }); return {} }
  fake.rpcs.fail_job = (a) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === a.p_job_id)!, { status: 'failed', error: a.p_error }); return {} }
  createClientMock.mockImplementation(() => fake.client)
  return fake
}

/** started_by|via|owner of the (only / last) run of `workflowId`. */
function startedOf(fake: ReturnType<typeof seed>, workflowId: string): string {
  const runs = fake.tables.workflow_runs.filter((r) => r.workflow_id === workflowId)
  const run: any = runs[runs.length - 1]
  return run?.node_results?.who?.output?.value ?? `(no run: ${JSON.stringify(run ?? null).slice(0, 200)})`
}

const ctxOf = (over: Partial<ServiceContext>): ServiceContext => ({
  supabase: null as any, tenantId: TENANT, actorId: null, permissions: null, authKind: 'session', source: 'ui', ...over,
})

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  resetQueueKickState()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('run dialog / API / CLI / MCP', () => {
  it('Run dialog (sync): the signed-in user, via ui; the owner stays workflow_owner_id', async () => {
    const fake = seed()
    const result = await startWorkflow(ctxOf({ supabase: fake.client, actorId: ALICE }), { workflow_id: WF })
    expect(result.mode).toBe('sync')
    expect(startedOf(fake, WF)).toBe(`${ALICE}|ui|${OWNER}`)
  })

  it('API key (queued): the key\'s user, via api — start variables cannot set it', async () => {
    const fake = seed()
    const ctx = ctxOf({ supabase: fake.client, actorId: BOB, authKind: 'api_key', source: 'api' })
    const result = await startWorkflow(ctx, { workflow_id: WF, async: true, variables: { workflow_started_by: CAROL, workflow_owner_id: CAROL, workflow_started_via: 'form', note: 'x' } })
    expect(result.mode).toBe('async')
    const job: any = fake.tables.workflow_queue[0]
    expect(job.trigger_data.workflow_started_by).toBeUndefined()
    expect(job.trigger_data._started_by).toMatchObject({ user_id: BOB, via: 'api' })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, WF)).toBe(`${BOB}|api|${OWNER}`)
  })

  it('a workspace (tenant) key: its creator', async () => {
    const fake = seed()
    await startWorkflow(ctxOf({ supabase: fake.client, actorId: null, credentialOwnerId: CAROL, authKind: 'api_key', source: 'api', keyType: 'tenant' }), { workflow_id: WF })
    expect(startedOf(fake, WF)).toBe(`${CAROL}|api|${OWNER}`)
  })

  it('CLI: via cli (the REST route passes it for the CLI user agent)', async () => {
    const fake = seed()
    expect(isCliUserAgent('usertasks-cli/0.4.0')).toBe(true)
    expect(isCliUserAgent('usertasks-sdk/0.1.0')).toBe(false)
    expect(isCliUserAgent(null)).toBe(false)
    await startWorkflow(ctxOf({ supabase: fake.client, actorId: ALICE, authKind: 'oauth', source: 'api' }), { workflow_id: WF, async: true }, { via: 'cli' })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, WF)).toBe(`${ALICE}|cli|${OWNER}`)
  })

  it('MCP: the connection\'s user, via mcp', async () => {
    const fake = seed()
    await startWorkflow(ctxOf({ supabase: fake.client, actorId: BOB, authKind: 'mcp', source: 'mcp' }), { workflow_id: WF })
    expect(startedOf(fake, WF)).toBe(`${BOB}|mcp|${OWNER}`)
  })

  it('designer test runs / direct engine calls: the initiator passed in; none = the owner, via system', async () => {
    const fake = seed()
    await executeWorkflow(WF, undefined, true, { workflow_started_by: CAROL }, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: ALICE, via: 'test' } })
    expect(startedOf(fake, WF)).toBe(`${ALICE}|test|${OWNER}`)
    await executeWorkflow(WF, undefined, false, { workflow_started_by: CAROL }, undefined, undefined, undefined, { supabase: fake.client })
    expect(startedOf(fake, WF)).toBe(`${OWNER}|system|${OWNER}`)
  })
})

describe('forms', () => {
  it('a form button\'s Start workflow: the submitter, via form (no workflow permission needed)', async () => {
    const fake = seed()
    const ctx = ctxOf({ supabase: fake.client, actorId: CAROL, permissions: new Set(['forms.submit']) })
    const { runs } = await runButtonActions(ctx, fake.client, {
      button: { id: 'b1', label: 'Submit', kind: 'submit', actions: [{ type: 'start_workflow', workflow_id: WF, inputs: {} }] } as any,
      values: {}, form: { id: FORM, name: 'Leave' }, submissionId: 'sub-1',
    })
    expect(runs[0]).toMatchObject({ status: 'queued' })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, WF)).toBe(`${CAROL}|form|${OWNER}`)
  })

  it('the Form submitted trigger: the submitter, via form', async () => {
    const fake = seed()
    const queued = await enqueueFormSubmittedWorkflows(fake.client, TENANT, { form_id: FORM, submitted_by: ALICE, form_submission_id: 'sub-2', form: { a: 1 } })
    expect(queued).toBe(1)
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, FORM_WF)).toBe(`${ALICE}|form|${OWNER}`)
  })
})

describe('task triggers, sub-workflows, data-table events, schedules', () => {
  it('task triggers: the task\'s actor per event', async () => {
    const fake = seed()
    for (const type of ['task_created', 'task_submitted', 'task_completed']) {
      fake.rpcs.enqueue_workflow({ p_workflow_id: WF, p_tenant_id: TENANT, p_task_id: TASK, p_trigger_type: type, p_trigger_data: { task_id: TASK } })
      await processWorkflowQueueBatch({ batchSize: 5 })
      const expected = type === 'task_created' ? OWNER : type === 'task_submitted' ? BOB : CAROL
      expect(startedOf(fake, WF)).toBe(`${expected}|task|${OWNER}`)
    }
  })

  it('a sub-workflow: the parent run\'s initiator, via subworkflow', async () => {
    const fake = seed()
    await startWorkflow(ctxOf({ supabase: fake.client, actorId: BOB }), { workflow_id: PARENT })
    expect(startedOf(fake, WF)).toBe(`${BOB}|subworkflow|${OWNER}`)
  })

  it('a data-table row event: the writer, via data_table', async () => {
    const fake = seed()
    const n = await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: TABLE, events: [{ rowId: 'r1', rowData: { a: 1 }, eventType: 'created' }], initiator: { userId: ALICE, via: 'ui' } })
    expect(n).toBe(1)
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, TABLE_WF)).toBe(`${ALICE}|data_table|${OWNER}`)
  })

  it('a schedule (no user): the owner, via schedule', async () => {
    const fake = seed()
    fake.rpcs.enqueue_workflow({ p_workflow_id: WF, p_tenant_id: TENANT, p_task_id: null, p_trigger_type: 'schedule', p_trigger_data: { schedule_occurrence: 'x' } })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, WF)).toBe(`${OWNER}|schedule|${OWNER}`)
  })
})

describe('nobody else can set it', () => {
  it('a forged, replayed (other variables) or foreign-workflow signature falls back to the owner', async () => {
    const fake = seed()
    const signed = withQueuedInitiator({ note: 'a' }, { tenantId: TENANT, workflowId: WF }, { userId: ALICE, via: 'ui' })
    const jobs = [
      { ...signed, _started_by: { ...(signed._started_by as object), sig: 'f'.repeat(64) } }, // forged
      { ...signed, note: 'b' }, // replayed with other variables
      withQueuedInitiator({ note: 'a' }, { tenantId: TENANT, workflowId: PARENT }, { userId: ALICE, via: 'ui' }), // for another workflow
      { ...signed, _started_by: { ...(signed._started_by as object), user_id: BOB } }, // someone else
    ]
    for (const data of jobs) {
      fake.rpcs.enqueue_workflow({ p_workflow_id: WF, p_tenant_id: TENANT, p_task_id: null, p_trigger_type: 'api', p_trigger_data: data })
      await processWorkflowQueueBatch({ batchSize: 5 })
      expect(startedOf(fake, WF)).toBe(`${OWNER}|api|${OWNER}`)
    }
    // The genuine one still verifies after the jsonb-like round trip.
    fake.rpcs.enqueue_workflow({ p_workflow_id: WF, p_tenant_id: TENANT, p_task_id: null, p_trigger_type: 'api', p_trigger_data: signed })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(startedOf(fake, WF)).toBe(`${ALICE}|ui|${OWNER}`)
  })

  it('a resumed designer test run stays a test run: its next User Task creates no real task', async () => {
    const fake = seed()
    const TWO = '0f000000-0000-4000-8000-0000000000a8'
    fake.tables.workflows.push(wf(TWO, 'manual', {
      nodes: [
        { id: 'start', type: 'manual', label: 'Start', config: {} },
        { id: 'u1', type: 'user_task', label: 'First', config: { title: 'First', assignee_id: BOB } },
        { id: 'u2', type: 'user_task', label: 'Second', config: { title: 'Second', assignee_id: BOB } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'u1' }, { id: 'e2', source: 'u1', target: 'u2' }],
    }))
    const tasksBefore = fake.tables.tasks.length
    const first = await executeWorkflow(TWO, undefined, true, {}, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: ALICE, via: 'test' } })
    expect(first.status).toBe('waiting_for_event')
    const events: any[] = []
    // A task's values cannot switch test mode off (workflow_started_via is engine-owned).
    const second = await resumeWorkflow(first.run_id!, { outcome: 'completed', workflow_started_via: 'ui' }, (e) => events.push(e), { supabase: fake.client })
    expect(second.status).toBe('waiting_for_event')
    expect(events.some((e) => e.type === 'node_complete' && e.node_id === 'u2' && e.data?.status === 'test_user_task')).toBe(true)
    expect(fake.tables.tasks.length).toBe(tasksBefore)
    // Finishing it is not counted as a run (like executeWorkflow's test runs).
    let counted = 0
    fake.rpcs.record_workflow_run = () => { counted++; return {} }
    const third = await resumeWorkflow(first.run_id!, { outcome: 'completed' }, undefined, { supabase: fake.client })
    expect(third.status).toBe('completed')
    expect(counted).toBe(0)
  })

  it('a resumed task\'s values do not overwrite the initiator variables', async () => {
    const fake = seed()
    fake.tables.workflows.push(wf('0f000000-0000-4000-8000-0000000000a9', 'manual'))
    fake.tables.workflow_runs.push({
      id: 'run-paused', workflow_id: WF, tenant_id: TENANT, task_id: null, status: 'waiting_for_event', event_id: 'evt-1',
      paused_node_id: 'start', pause_variables: { workflow_started_by: ALICE, workflow_started_via: 'form', workflow_owner_id: OWNER },
      version_id: null, trace_id: null, execution_trace: [], node_results: { start: { status: 'success' } },
    })
    const result = await resumeWorkflow('evt-1', { workflow_started_by: BOB, workflow_owner_id: BOB, outcome: 'ok' }, undefined, { supabase: fake.client })
    expect(result.node_results.who?.output?.value).toBe(`${ALICE}|form|${OWNER}`)
  })
})

describe('initiator helpers', () => {
  it('maps contexts, trigger types and task events', () => {
    expect(initiatorFromContext({ actorId: ALICE, source: 'ui' })).toEqual({ userId: ALICE, via: 'ui' })
    expect(initiatorFromContext({ actorId: null, credentialOwnerId: BOB, source: 'api' })).toEqual({ userId: BOB, via: 'api' })
    expect(initiatorFromContext({ actorId: ALICE, source: 'job' }, 'form')).toEqual({ userId: ALICE, via: 'form' })
    expect(viaForTriggerType('task_rejected')).toBe('task')
    expect(viaForTriggerType('webhook_received')).toBe('webhook')
    expect(viaForTriggerType('workflow_error')).toBe('event')
    expect(viaForTriggerType('something')).toBe('system')
    const task = { assigner_id: OWNER, assignee_id: BOB, actioned_by: CAROL }
    expect(taskEventActor('task_created', task)).toBe(OWNER)
    expect(taskEventActor('task_received', task)).toBe(OWNER)
    expect(taskEventActor('task_rejected', task)).toBe(BOB)
    expect(taskEventActor('task_updated', task)).toBe(CAROL)
    expect(taskEventActor('task_completed', { assignee_id: BOB })).toBe(BOB)
    expect(taskEventActor('task_completed', null)).toBeNull()
  })

  it('strips and builds the engine-owned variables', () => {
    expect(stripInitiatorVariables({ a: 1, workflow_started_by: 'x', workflow_started_via: 'y', workflow_owner_id: 'z' })).toEqual({ a: 1 })
    expect(initiatorVariables({ userId: null, via: 'schedule' }, OWNER)).toEqual({ workflow_started_by: OWNER, workflow_started_via: 'schedule', workflow_owner_id: OWNER })
    expect(initiatorVariables({ userId: ALICE, via: 'bogus' as any }, null)).toEqual({ workflow_started_by: ALICE, workflow_started_via: 'system', workflow_owner_id: '' })
  })

  it('signs over sorted JSON and expires after 7 days', () => {
    expect(canonicalJson({ b: [1, { d: 1, c: null }], a: 'x', u: undefined, t: new Date(0) })).toBe('{"a":"x","b":[1,{"c":null,"d":1}],"t":"1970-01-01T00:00:00.000Z"}')
    const now = Date.UTC(2026, 9, 28)
    const signed = withQueuedInitiator({ a: 1, _version_id: 'v1' }, { tenantId: TENANT, workflowId: WF }, { userId: ALICE, via: 'mcp' }, now)
    const target = { tenantId: TENANT, workflowId: WF }
    expect(readQueuedInitiator({ ...signed, _version_id: undefined }, target, now + 1000)).toEqual({ userId: ALICE, via: 'mcp' })
    expect(readQueuedInitiator(signed, target, now + 8 * 24 * 3600 * 1000)).toBeNull()
    expect(readQueuedInitiator(signed, { tenantId: 'other', workflowId: WF }, now)).toBeNull()
    expect(readQueuedInitiator({ a: 1 }, target, now)).toBeNull()
  })
})
