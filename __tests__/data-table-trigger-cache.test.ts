/**
 * Perf phase 2 data-table triggers: the tenant's active data_table_event
 * workflows are cached (TTL, invalidated on workflow changes), the table is
 * read only when a trigger matches, a write's jobs go out in one
 * enqueue_workflow_batch call and the queue is kicked once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kickMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: kickMock }))
// enqueue_workflow(_batch) is service-role only: the jobs go out on the service client.
const service = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => service.client }))

import {
  DATA_TABLE_TRIGGER_CACHE_TTL_MS,
  enqueueDataTableEvents,
  enqueueDataTableEventWorkflows,
  invalidateDataTableTriggerCache,
} from '@/lib/data-table-workflow-triggers'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = 'tenant-a'
const trigger = (config: Record<string, unknown>) => [{ id: 'trg', type: 'data_table_event', config }]

function seed() {
  const fake = createFakeSupabase({
    workflows: [
      { id: 'wf-orders', tenant_id: TENANT, is_active: true, trigger_type: 'data_table_event', nodes: [], published_version_id: 'v-orders' },
      { id: 'wf-any', tenant_id: TENANT, is_active: true, trigger_type: 'data_table_event', nodes: trigger({ event_types: ['created'] }), published_version_id: null },
      { id: 'wf-other', tenant_id: TENANT, is_active: true, trigger_type: 'data_table_event', nodes: trigger({ table_id: 'tbl-other' }), published_version_id: null },
    ],
    workflow_versions: [{ id: 'v-orders', nodes: trigger({ table_id: 'tbl-orders' }) }],
    custom_tables: [{ id: 'tbl-orders', tenant_id: TENANT, name: 'Orders', slug: 'orders', columns: [{ key: 'amount', label: 'Amount' }] }],
  })
  const jobs: Array<Record<string, unknown>> = []
  fake.rpcs.enqueue_workflow_batch = (args) => {
    jobs.push(...(args.p_jobs as Array<Record<string, unknown>>))
    return { data: (args.p_jobs as unknown[]).length }
  }
  service.client = fake.client
  return { fake, jobs }
}

beforeEach(() => {
  invalidateDataTableTriggerCache()
  kickMock.mockClear()
})
afterEach(() => { vi.useRealTimers() })

const events = (n: number, eventType: 'created' | 'updated' = 'created') =>
  Array.from({ length: n }, (_, i) => ({ rowId: `row-${i}`, rowData: { amount: i }, eventType }))

describe('data table trigger cache', () => {
  it('batches a write: trigger set + table read once, one enqueue call, one kick', async () => {
    const { fake, jobs } = seed()
    const count = await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(50) })
    // wf-orders (version nodes, table matches) + wf-any (created) per row; wf-other is another table.
    expect(count).toBe(100)
    expect(fake.count('workflows', 'select')).toBe(1)
    expect(fake.count('workflow_versions', 'select')).toBe(1)
    expect(fake.count('custom_tables', 'select')).toBe(1)
    expect(fake.calls.filter((c) => c.rpc === 'enqueue_workflow_batch')).toHaveLength(1)
    expect(kickMock).toHaveBeenCalledTimes(1)
    expect(jobs[0]).toMatchObject({
      workflow_id: 'wf-orders', trigger_type: 'data_table_event',
      trigger_data: { _version_id: 'v-orders', data_event: 'created', row_id: 'row-0', data_table_name: 'Orders', amount: 0 },
    })
    expect(jobs[1]).toMatchObject({ workflow_id: 'wf-any', trigger_data: { _version_id: null } })
  })

  it('serves later writes from the cache until the TTL passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { fake } = seed()
    const write = () => enqueueDataTableEventWorkflows({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', rowId: 'r', rowData: {}, eventType: 'updated' })
    for (let i = 0; i < 5; i++) await write()
    expect(fake.count('workflows', 'select')).toBe(1)
    vi.setSystemTime(Date.now() + DATA_TABLE_TRIGGER_CACHE_TTL_MS + 1)
    await write()
    expect(fake.count('workflows', 'select')).toBe(2)
  })

  it('a deactivated workflow stops firing as soon as the cache is invalidated', async () => {
    const { fake, jobs } = seed()
    const write = () => enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(1) })
    expect(await write()).toBe(2)
    fake.tables.workflows.find((w) => w.id === 'wf-any')!.is_active = false
    expect(await write()).toBe(2) // still cached
    invalidateDataTableTriggerCache(TENANT)
    expect(await write()).toBe(1)
    expect(jobs.at(-1)!.workflow_id).toBe('wf-orders')
  })

  it('does not read the table or enqueue when nothing matches', async () => {
    const { fake } = seed()
    const count = await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-none', events: events(3, 'updated') })
    expect(count).toBe(0)
    expect(fake.count('custom_tables', 'select')).toBe(0)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(kickMock).not.toHaveBeenCalled()
  })

  it('uses a caller cache for the table read', async () => {
    const { fake } = seed()
    const tableCache = new Map()
    for (let i = 0; i < 3; i++) {
      await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(1), tableCache })
    }
    expect(fake.count('custom_tables', 'select')).toBe(1)
  })

  it('falls back to one enqueue_workflow per job while the batch RPC is not migrated', async () => {
    const { fake } = seed()
    delete fake.rpcs.enqueue_workflow_batch
    fake.rpcs.enqueue_workflow = () => ({ data: 'job' })
    const count = await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(2) })
    expect(count).toBe(4)
    expect(fake.calls.filter((c) => c.rpc === 'enqueue_workflow')).toHaveLength(4)
    expect(kickMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed trigger read', async () => {
    const { fake } = seed()
    const from = fake.client.from.bind(fake.client)
    let fail = true
    ;(fake.client as unknown as { from: (table: string) => unknown }).from = (table: string) => {
      if (table === 'workflows' && fail) {
        fail = false
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: 'down' } }) }) }) }) }
      }
      return from(table)
    }
    expect(await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(1) })).toBe(0)
    expect(await enqueueDataTableEvents({ supabase: fake.client, tenantId: TENANT, tableId: 'tbl-orders', events: events(1) })).toBe(2)
  })
})
