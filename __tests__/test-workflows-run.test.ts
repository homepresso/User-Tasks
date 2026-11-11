/**
 * Every example in test-workflows/ runs through the engine (in-memory
 * Supabase fake, network stubbed) and must use the config shapes the engine
 * and builder read (issue #10). Fails on:
 * - a node config that is not canonical (canonicalizeNodeConfigShapes would change it),
 * - an unknown / skipped node type,
 * - a step that errors (unless the file sets onError: continue on it on purpose),
 * - obviously empty outputs: an empty array built from items, a custom date
 *   format that came out as ISO, a delay that waited 0 ms.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- workflow and fake-database rows are free-form JSON */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { buildKitchenSink, KITCHEN_SINK_IDS } from '@/lib/kitchen-sink/build'
import { canonicalizeNodeConfigShapes } from '@/lib/portability/normalize'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000010a'
const WF = '0e000000-0000-4000-8000-0000000001b1'
const DIR = path.join(process.cwd(), 'test-workflows')

/** Files that need something the fake cannot provide, with the reason. They still get the shape check. */
const SKIP_RUN: Record<string, string> = {
  '16-ultimate-stress.json':
    'needs real tenant entities picked in the builder (two data tables, a decision table, a sub-workflow; see the README setup)',
  '17-kitchen-sink.json': 'runs end to end below, with its bundled assets (kitchen sink self-test)',
}

/** Expected end state when it is not "completed". */
const EXPECTED_STATUS: Record<string, string> = {
  // Pauses on the approval user task by design.
  '07-user-task-approval.json': 'waiting_for_event',
}

type Node = { id: string; type: string; label: string; config?: Record<string, any>; onError?: string }
type Wf = { nodes: Node[]; edges: Array<Record<string, unknown>>; user_variables?: unknown[] }

const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
const load = (file: string) => JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as Wf

beforeEach(() => {
  createClientMock.mockReset()
  createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is disabled in this test') }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

it('finds the example workflows', () => {
  expect(files.length).toBeGreaterThanOrEqual(16)
})

describe.each(files)('test-workflows/%s', (file) => {
  const wf = load(file)

  it('uses canonical config shapes', () => {
    for (const node of wf.nodes) {
      const config = node.config ?? {}
      expect(canonicalizeNodeConfigShapes(node.type, config), `${node.id} (${node.type})`).toEqual(config)
    }
  })

  it.skipIf(file in SKIP_RUN)('runs through the engine without skipped nodes, errors or empty outputs', async () => {
    const fake = createFakeSupabase({
      workflows: [{
        id: WF, tenant_id: TENANT, name: file, trigger_type: 'webhook_received',
        nodes: wf.nodes, edges: wf.edges, user_variables: wf.user_variables ?? [],
        run_count: 0, published_version_id: null,
      }],
    })
    fake.rpcs.record_workflow_run = () => ({})
    fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })

    const result = await executeWorkflow(WF, undefined, true, {}, undefined, undefined, undefined, {
      supabase: fake.client,
      initiator: { userId: null, via: 'test' },
    })
    const row = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
    const results = (row?.node_results ?? {}) as Record<string, { status: string; output?: any; error?: string }>
    expect(Object.keys(results).length, 'steps that ran').toBeGreaterThan(2)
    const problems: string[] = []
    if (result.status !== (EXPECTED_STATUS[file] ?? 'completed')) {
      problems.push(`run ${result.status}: ${row?.error ?? (result as any).error ?? ''}`)
    }
    const byId = new Map(wf.nodes.map((n) => [n.id, n]))
    for (const [id, r] of Object.entries(results)) {
      const node = byId.get(id)
      if (!node) continue
      const where = `${id} (${node.type} "${node.label}")`
      if (r.output?.skipped && String(r.output?.reason ?? '').startsWith('Unknown node type')) problems.push(`${where}: ${r.output.reason}`)
      if (r.status === 'error' && node.onError !== 'continue') problems.push(`${where}: ${r.error ?? 'error'}`)
      const config = node.config ?? {}
      if (node.type === 'json_build_array' && Array.isArray(config.items) && config.items.length > 0 && !r.output?.count) {
        problems.push(`${where}: built an empty array from ${config.items.length} items`)
      }
      if (node.type === 'format_date' && config.format && config.format !== 'iso' && /^\d{4}-\d\d-\d\dT/.test(String(r.output?.result ?? ''))) {
        problems.push(`${where}: format "${config.format}" came out as ISO`)
      }
      if (node.type === 'delay' && r.status === 'success' && !r.output?.waited_ms && !r.output?.skipped_wait_ms) {
        problems.push(`${where}: waited 0 ms`)
      }
    }
    expect(problems).toEqual([])
  }, 30_000)
})

/**
 * The kitchen sink self-test (test-workflows/17-kitchen-sink.json) end to end:
 * its bundled assets seeded into the fake, files on the local storage
 * provider (a temp dir — no network), started by a person (Run now), the
 * Human step task completed through resumeWorkflow with the values the task
 * was created with. Every check must pass and the run must complete.
 */
describe('test-workflows/17-kitchen-sink.json (end to end)', () => {
  const USER = '0e000000-0000-4000-8000-0000000001c1'
  const saved: Record<string, string | undefined> = {}
  let storageRoot = ''
  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), 'ks-storage-'))
    for (const [k, v] of Object.entries({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_ROOT: storageRoot, APP_URL: 'http://127.0.0.1:3999' })) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(storageRoot, { recursive: true, force: true })
  })

  function seed() {
    const built = buildKitchenSink()
    const asset = (section: string) => built.bundle[section][0]
    const sub = built.bundle.workflows.find((w: any) => w.id === KITCHEN_SINK_IDS.subWorkflow)
    const action = asset('workflow_activities')
    const fake = createFakeSupabase({
      workflows: [
        { id: KITCHEN_SINK_IDS.workflow, tenant_id: TENANT, name: 'Kitchen sink', trigger_type: 'webhook_received', nodes: built.workflow.nodes, edges: built.workflow.edges, user_variables: built.workflow.user_variables, run_count: 0, published_version_id: null },
        { id: sub.id, tenant_id: TENANT, name: sub.name, trigger_type: 'webhook_received', nodes: sub.nodes, edges: sub.edges, user_variables: sub.user_variables, run_count: 0, published_version_id: null },
      ],
      custom_tables: [{ ...asset('data_tables'), tenant_id: TENANT }],
      decision_tables: [{ ...asset('decision_tables'), tenant_id: TENANT }],
      forms: [{ ...asset('forms'), tenant_id: TENANT, layout: null, buttons: null, header: null, version: 1 }],
      roles: [{ ...asset('roles'), tenant_id: TENANT, is_system: false }],
      users: [{ id: USER, tenant_id: TENANT, display_name: 'Kitchen Sink Tester', email: 'tester@example.com' }],
      custom_workflow_activities: [{ ...action, tenant_id: TENANT, sha256: null }],
    })
    fake.rpcs.record_workflow_run = () => ({})
    fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })
    // user_roles → roles(permissions): the embed PostgREST resolves, which the fake does not.
    const from = fake.client.from.bind(fake.client)
    ;(fake.client as any).from = (table: string) => {
      const query = from(table) as any
      if (table !== 'user_roles') return query
      const then = query.then.bind(query)
      ;(query as any).then = (resolve: any, reject: any) => then((result: any) => resolve(Array.isArray(result?.data)
        ? { ...result, data: result.data.map((row: any) => ({ ...row, role: fake.tables.roles?.find((r) => r.id === row.role_id) ?? null })) }
        : result), reject)
      return query
    }
    return { built, fake }
  }

  it('passes every check, including the Human step after the task is completed', async () => {
    const { built, fake } = seed()
    const started = await executeWorkflow(KITCHEN_SINK_IDS.workflow, undefined, false, {}, undefined, undefined, undefined, {
      supabase: fake.client,
      initiator: { userId: USER, via: 'ui' },
    })
    const runOf = (id: string | undefined) => fake.tables.workflow_runs.find((r) => r.id === id) as any
    expect(started.status, runOf(started.run_id)?.error).toBe('waiting_for_event')
    // The Human step task: assigned to the starter, prefilled with the run key.
    const task = (fake.tables.tasks ?? []).find((t: any) => t.workflow_step_id === 'human_task') as any
    expect(task?.assignee_id).toBe(USER)
    const values = task.metadata.template_values
    expect(values.ks_token).toMatch(/^[0-9a-f-]{36}$/)
    const resumed = await resumeWorkflow(String(started.run_id), {
      outcome: 'Confirm',
      task_data: { ...values, ks_ok: true },
    }, undefined, { supabase: fake.client })
    const row = runOf(started.run_id)
    const results = (row?.node_results ?? {}) as Record<string, { status: string; output?: any; error?: string }>
    const failures = row?.pause_variables?.failures ?? null
    expect({ status: resumed.status, error: resumed.error ?? null }).toEqual({ status: 'completed', error: null })
    expect(row.title).toBe(`Kitchen sink: ${built.checks.length}/${built.checks.length} passed`)
    // Every check ran and passed; no failure recorder ran.
    for (const check of built.checks) {
      expect(results[`chk_${check.id}`]?.output?.matched_branch, `${check.id} (${check.label})`).toBe('Pass')
      expect(results[`fail_${check.id}`], `${check.id} recorded a failure`).toBeUndefined()
    }
    expect(results.end_pass?.status).toBe('success')
    expect(results.end_fail).toBeUndefined()
    expect(failures).toBeNull()
    // Nothing errored except the deliberate failure.
    const errored = Object.entries(results).filter(([, r]) => r.status === 'error').map(([id, r]) => `${id}: ${r.error}`)
    expect(errored).toEqual([expect.stringMatching(/^err_fail: /)])
    // Every step type of the canvas ran (send_email is behind send_test_email, off by default).
    const ranTypes = new Set(Object.keys(results).map((id) => built.workflow.nodes.find((n) => n.id === id)?.type))
    const notRun = [...new Set(built.workflow.nodes.map((n) => n.type))].filter((t) => !ranTypes.has(t) && t !== 'section_group' && t !== 'send_email')
    expect(notRun).toEqual([])
    // The data steps cleaned up after themselves.
    expect((fake.tables.custom_table_rows ?? []).length).toBe(0)
  }, 60_000)

  it('skips the Human step when include_human_step is off and still passes', async () => {
    const { built, fake } = seed()
    const result = await executeWorkflow(KITCHEN_SINK_IDS.workflow, undefined, false, { include_human_step: false }, undefined, undefined, undefined, {
      supabase: fake.client,
      initiator: { userId: USER, via: 'ui' },
    })
    const row = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
    expect({ status: result.status, error: row?.error ?? null }).toEqual({ status: 'completed', error: null })
    const ran = built.checks.length - built.humanChecks
    expect(row.title).toBe(`Kitchen sink: ${ran}/${ran} passed (${built.humanChecks} skipped)`)
    expect((fake.tables.tasks ?? []).length).toBe(0)
  }, 60_000)

  it('in a designer test run, simulates the User Task and skips the task writes', async () => {
    const { built, fake } = seed()
    const started = await executeWorkflow(KITCHEN_SINK_IDS.workflow, undefined, true, {}, undefined, undefined, undefined, {
      supabase: fake.client,
      initiator: { userId: USER, via: 'test' },
    })
    expect(started.status).toBe('waiting_for_event')
    expect((fake.tables.tasks ?? []).length).toBe(0)
    const paused = fake.tables.workflow_runs.find((r) => r.id === started.run_id) as any
    const resumed = await resumeWorkflow(String(started.run_id), {
      outcome: 'Confirm',
      task_data: { ks_token: paused.pause_variables.ks_run_key, ks_note: 'Prefilled by the kitchen sink' },
    }, undefined, { supabase: fake.client })
    const row = fake.tables.workflow_runs.find((r) => r.id === started.run_id) as any
    expect({ status: resumed.status, error: resumed.error ?? null }).toEqual({ status: 'completed', error: null })
    const ran = built.checks.length - built.realTaskChecks
    expect(row.title).toBe(`Kitchen sink: ${ran}/${ran} passed (${built.realTaskChecks} skipped)`)
  }, 60_000)

  it('fails the run, listing the failed checks, when a check fails', async () => {
    const { fake } = seed()
    // Break the decision table: the High value rule now gives 11 %.
    const table = fake.tables.decision_tables[0] as any
    table.rules = table.rules.map((r: any) => (r.label === 'High value' ? { ...r, outputs: { ...r.outputs, discount: 11 } } : r))
    const result = await executeWorkflow(KITCHEN_SINK_IDS.workflow, undefined, false, { include_human_step: false }, undefined, undefined, undefined, {
      supabase: fake.client,
      initiator: { userId: USER, via: 'ui' },
    })
    const row = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
    expect(result.status).toBe('failed')
    expect(row.error).toMatch(/^Kitchen sink failed: 1 of \d+ checks failed \(dt_discount\)/)
    expect(row.title).toMatch(/^Kitchen sink: \d+\/\d+ passed/)
    expect(row.node_results.end_fail?.status).toBe('error')
  }, 60_000)
})
