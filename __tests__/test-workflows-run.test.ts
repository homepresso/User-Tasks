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
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { executeWorkflow } from '@/lib/workflow-engine'
import { canonicalizeNodeConfigShapes } from '@/lib/portability/normalize'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000010a'
const WF = '0e000000-0000-4000-8000-0000000001b1'
const DIR = path.join(process.cwd(), 'test-workflows')

/** Files that need something the fake cannot provide, with the reason. They still get the shape check. */
const SKIP_RUN: Record<string, string> = {
  '16-ultimate-stress.json':
    'needs real tenant entities picked in the builder (two data tables, a decision table, a sub-workflow; see the README setup)',
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
