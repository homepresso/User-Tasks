/**
 * Integrations and activity dashboard reads (providers phase 4): permission
 * gates, argument validation, filtering by id, call-log stats computed
 * server-side, object hydration and the unified trace read.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

const db = () => createMemorySupabase({
  integrations: [
    { id: 'i2', name: 'Zeta', type: 'rest_api', is_active: true },
    { id: 'i1', name: 'Alpha', type: 'rest_api', is_active: true },
  ],
  integration_references: [
    { id: 'ref1', integration_id: 'i1', name: 'List customers', description: 'd' },
    { id: 'ref2', integration_id: 'i2', name: 'Charge', description: 'd' },
  ],
  integration_call_logs: [
    { id: 'c1', integration_id: 'i1', method: 'GET', response_status: 200, duration_ms: 100, error: null, started_at: '2026-10-01', trace_id: 't1', reference_id: 'ref1' },
    { id: 'c2', integration_id: 'i1', method: 'POST', response_status: 500, duration_ms: 300, error: 'boom', started_at: '2026-10-02', trace_id: 't1', reference_id: null },
    { id: 'c3', integration_id: 'i1', method: 'GET', response_status: null, duration_ms: null, error: 'timeout', started_at: '2026-10-03', trace_id: null, reference_id: null },
    { id: 'c4', integration_id: 'i2', method: 'GET', response_status: 200, duration_ms: 1, error: null, started_at: '2026-10-04', trace_id: 't2', reference_id: null },
  ],
  workflow_runs: [{ id: 'wr1', status: 'completed', trace_id: 't1', started_at: '2026-10-01' }],
  agent_runs: [
    { id: 'ar1', agent_id: 'ag1', status: 'completed', trace_id: 't1', started_at: '2026-10-01' },
    { id: 'ar2', agent_id: 'ag1', status: 'completed', trace_id: 't2', started_at: '2026-10-01' },
  ],
  integration_objects: [{ id: 'o1', name: 'Customer', created_at: '2026-10-01' }],
  integration_object_sources: [
    { id: 's1', object_id: 'o1', table_id: 'tb1', reference_id: null, sort_order: 0 },
    { id: 's2', object_id: 'o1', table_id: null, reference_id: 'ref1', sort_order: 1 },
  ],
  custom_tables: [{ id: 'tb1', name: 'Customers', columns: [] }],
})

const VIEW = ['integrations.view']

describe('integrations reads: permissions and args', () => {
  it.each([
    ['integrations.list', undefined],
    ['integrations.references', undefined],
    ['integrations.connectors', undefined],
    ['integrations.tagDefinitions', undefined],
    ['integrations.mcpServers', undefined],
    ['integrations.get', { id: 'i1' }],
    ['integrations.referencesFor', { integrationId: 'i1' }],
    ['integrations.meta', { id: 'i1' }],
    ['integrations.calls', { integrationId: 'i1', page: 0 }],
    ['integrations.callStats', { integrationId: 'i1' }],
    ['integrations.call', { integrationId: 'i1', callId: 'c1' }],
    ['integrations.callWorkflowRun', { runId: 'wr1' }],
    ['integrations.callTraceSiblings', { traceId: 't1', callId: 'c1' }],
    ['integrations.callTraceAgentRuns', { traceId: 't1' }],
    ['integrations.objects', undefined],
    ['integrations.objectTables', undefined],
  ])('%s needs integrations.view', async (name, args) => {
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await runUiRead(ctx(memory, ['data.view']), { name, args })).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
    expect(await runUiRead(ctx(db(), VIEW), { name, args })).toMatchObject({ ok: true })
  })

  it('validates ids, page and the status filter', async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.get', args: {} })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.call', args: { integrationId: 'i1', callId: 7 } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.calls', args: { integrationId: 'i1', page: 1.5 } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.calls', args: { integrationId: 'i1', page: 0, status: 'weird' } })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('integrations reads: data', () => {
  it('lists integrations by name and one integration by id (missing → null)', async () => {
    const list = await runUiRead(ctx(db(), VIEW), { name: 'integrations.list' }) as any
    expect(list.data.map((r: any) => r.id)).toEqual(['i1', 'i2'])
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.get', args: { id: 'i2' } })).toMatchObject({ ok: true, data: { id: 'i2', name: 'Zeta' } })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.get', args: { id: 'nope' } })).toEqual({ ok: true, data: null })
  })

  it("returns only that integration's references", async () => {
    const res = await runUiRead(ctx(db(), VIEW), { name: 'integrations.referencesFor', args: { integrationId: 'i2' } }) as any
    expect(res.data.map((r: any) => r.id)).toEqual(['ref2'])
  })

  it('pages calls newest first with a total, filtered by integration and method', async () => {
    const res = await runUiRead(ctx(db(), VIEW), { name: 'integrations.calls', args: { integrationId: 'i1', page: 0 } }) as any
    expect(res.data.rows.map((r: any) => r.id)).toEqual(['c3', 'c2', 'c1'])
    expect(res.data.total).toBe(3)
    const gets = await runUiRead(ctx(db(), VIEW), { name: 'integrations.calls', args: { integrationId: 'i1', page: 0, method: 'GET' } }) as any
    expect(gets.data.rows.map((r: any) => r.id)).toEqual(['c3', 'c1'])
    // (The status filters use lt / or, which the memory client doesn't model.)
  })

  it('computes call stats server-side for that integration only', async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.callStats', args: { integrationId: 'i1' } }))
      .toEqual({ ok: true, data: { total: 3, success: 1, errors: 2, avgDuration: 133 } })
  })

  it('returns a call with its integration and reference; unknown call → nulls', async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.call', args: { integrationId: 'i1', callId: 'c1' } }))
      .toMatchObject({ ok: true, data: { call: { id: 'c1' }, integration: { id: 'i1' }, reference: { id: 'ref1' } } })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'integrations.call', args: { integrationId: 'i1', callId: 'cx' } }))
      .toMatchObject({ ok: true, data: { call: null, reference: null } })
  })

  it('related: trace siblings exclude the call itself; agent runs are by trace', async () => {
    const siblings = await runUiRead(ctx(db(), VIEW), { name: 'integrations.callTraceSiblings', args: { traceId: 't1', callId: 'c1' } }) as any
    expect(siblings.data.map((r: any) => r.id)).toEqual(['c2'])
    const agents = await runUiRead(ctx(db(), VIEW), { name: 'integrations.callTraceAgentRuns', args: { traceId: 't1' } }) as any
    expect(agents.data.map((r: any) => r.id)).toEqual(['ar1'])
  })

  it('hydrates object sources with their table and reference', async () => {
    const res = await runUiRead(ctx(db(), VIEW), { name: 'integrations.objects' }) as any
    expect(res.data).toHaveLength(1)
    expect(res.data[0].sources).toMatchObject([
      { id: 's1', table: { id: 'tb1', name: 'Customers' }, reference: null },
      { id: 's2', table: null, reference: { id: 'ref1', name: 'List customers' } },
    ])
  })
})

describe('activity.trace', () => {
  it('needs settings.view or observability.view', async () => {
    const args = { traceId: 't1' }
    expect(await runUiRead(ctx(db(), VIEW), { name: 'activity.trace', args })).toMatchObject({ ok: false, status: 403 })
    expect(await runUiRead(ctx(db(), ['settings.view']), { name: 'activity.trace', args })).toMatchObject({ ok: true })
    expect(await runUiRead(ctx(db(), ['observability.view']), { name: 'activity.trace', args })).toMatchObject({ ok: true })
    expect(await runUiRead(ctx(db(), ['settings.view']), { name: 'activity.trace', args: {} })).toMatchObject({ ok: false, status: 400 })
  })

  it('returns every entity sharing the trace id', async () => {
    const res = await runUiRead(ctx(db(), ['settings.view']), { name: 'activity.trace', args: { traceId: 't1' } }) as any
    expect(res.data.workflowRuns.map((r: any) => r.id)).toEqual(['wr1'])
    expect(res.data.agentRuns.map((r: any) => r.id)).toEqual(['ar1'])
    expect(res.data.integrationCalls.map((r: any) => r.id).sort()).toEqual(['c1', 'c2'])
  })
})
