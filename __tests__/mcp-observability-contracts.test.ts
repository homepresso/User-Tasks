import { describe, expect, it } from 'vitest'

import { createMcpServer } from '@/lib/mcp/server'

function parseToolResponse(result: any) {
  const text = result?.content?.[0]?.text
  expect(typeof text).toBe('string')
  return JSON.parse(text)
}

function createObservabilitySupabaseMock(seed?: Partial<Record<string, any[]>>) {
  const records: Record<string, any[]> = {
    integrations: [],
    integration_references: [],
    integration_call_logs: [],
    agents: [],
    agent_runs: [],
    users: [],
    object_audit_log: [],
    workflows: [],
    workflow_runs: [],
    ...seed,
  }

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

  const applyFilters = (
    rows: any[],
    filters: Array<{ type: 'eq' | 'gte' | 'lte' | 'or'; field?: string; value?: any; expression?: string }>,
  ) => {
    let filtered = [...rows]
    for (const filter of filters) {
      if (filter.type === 'eq') {
        filtered = filtered.filter((row) => row?.[filter.field!] === filter.value)
      }
      if (filter.type === 'gte') {
        filtered = filtered.filter((row) => row?.[filter.field!] >= filter.value)
      }
      if (filter.type === 'lte') {
        filtered = filtered.filter((row) => row?.[filter.field!] <= filter.value)
      }
      if (filter.type === 'or' && filter.expression === 'response_status.gte.400,error.not.is.null') {
        filtered = filtered.filter((row) => Number(row?.response_status ?? 0) >= 400 || row?.error != null)
      }
    }
    return filtered
  }

  const applyOrdering = (
    rows: any[],
    orderings: Array<{ field: string; ascending: boolean }>,
  ) => {
    if (orderings.length === 0) return rows
    const next = [...rows]
    next.sort((left, right) => {
      for (const ordering of orderings) {
        const leftValue = left?.[ordering.field]
        const rightValue = right?.[ordering.field]
        if (leftValue === rightValue) continue
        const comparison = leftValue > rightValue ? 1 : -1
        return ordering.ascending ? comparison : -comparison
      }
      return 0
    })
    return next
  }

  const buildQuery = (table: string): any => {
    const state = {
      filters: [] as Array<{ type: 'eq' | 'gte' | 'lte' | 'or'; field?: string; value?: any; expression?: string }>,
      orderings: [] as Array<{ field: string; ascending: boolean }>,
      limitValue: undefined as number | undefined,
      mode: 'many' as 'many' | 'single',
    }

    const resolveRows = () => {
      const rows = records[table] ?? []
      const filtered = applyFilters(rows, state.filters)
      const ordered = applyOrdering(filtered, state.orderings)
      const limited = typeof state.limitValue === 'number' ? ordered.slice(0, state.limitValue) : ordered
      const payload = limited.map((row) => clone(row))
      return state.mode === 'single' ? payload[0] ?? null : payload
    }

    const resolve = () => Promise.resolve({ data: resolveRows(), error: null })

    return {
      select() {
        return this
      },
      eq(field: string, value: any) {
        state.filters.push({ type: 'eq', field, value })
        return this
      },
      gte(field: string, value: any) {
        state.filters.push({ type: 'gte', field, value })
        return this
      },
      lte(field: string, value: any) {
        state.filters.push({ type: 'lte', field, value })
        return this
      },
      or(expression: string) {
        state.filters.push({ type: 'or', expression })
        return this
      },
      order(field: string, options?: { ascending?: boolean }) {
        state.orderings.push({ field, ascending: options?.ascending ?? true })
        return this
      },
      limit(value: number) {
        state.limitValue = value
        return this
      },
      single() {
        state.mode = 'single'
        return resolve()
      },
      maybeSingle() {
        state.mode = 'single'
        return resolve()
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve().then(onFulfilled, onRejected)
      },
    }
  }

  return {
    from(table: string) {
      return buildQuery(table)
    },
    __records: records,
  }
}

describe('MCP observability contracts', () => {
  it('lists and fetches integration calls with filtering and detail payloads', async () => {
    const supabase = createObservabilitySupabaseMock({
      integrations: [{ id: 'int_1', tenant_id: 'test-tenant', name: 'ERP Connector' }],
      integration_references: [{ id: 'ref_1', tenant_id: 'test-tenant', name: 'Create Order' }],
      integration_call_logs: [
        {
          id: 'call_older',
          tenant_id: 'test-tenant',
          integration_id: 'int_1',
          reference_id: 'ref_1',
          method: 'POST',
          url: 'https://api.example.com/orders/older',
          response_status: 201,
          duration_ms: 82,
          caller_type: 'workflow_node',
          caller_id: 'run_1',
          caller_node_id: 'node_1',
          trace_id: 'trace_1',
          error: null,
          started_at: '2026-04-14T10:00:00.000Z',
          completed_at: '2026-04-14T10:00:00.082Z',
          integration: { id: 'int_1', name: 'ERP Connector' },
          reference: { id: 'ref_1', name: 'Create Order' },
          request_headers: { authorization: 'REDACTED' },
          request_body: { orderNumber: 'SO-100' },
          response_body: { ok: true },
        },
        {
          id: 'call_newer',
          tenant_id: 'test-tenant',
          integration_id: 'int_1',
          reference_id: 'ref_1',
          method: 'POST',
          url: 'https://api.example.com/orders/newer',
          response_status: 502,
          duration_ms: 120,
          caller_type: 'workflow_node',
          caller_id: 'run_1',
          caller_node_id: 'node_2',
          trace_id: 'trace_1',
          error: 'Upstream timeout',
          started_at: '2026-04-14T12:00:00.000Z',
          completed_at: '2026-04-14T12:00:00.120Z',
          integration: { id: 'int_1', name: 'ERP Connector' },
          reference: { id: 'ref_1', name: 'Create Order' },
          request_headers: { authorization: 'REDACTED' },
          request_body: { orderNumber: 'SO-101' },
          response_body: { ok: false },
        },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const listResult = await server.callTool('integration_calls_list', {
      integration_id: 'int_1',
      caller_type: 'workflow_node',
      from: '2026-04-14T09:00:00.000Z',
      to: '2026-04-14T13:00:00.000Z',
      only_errors: true,
      limit: 10,
    })

    expect(listResult?.isError).not.toBe(true)
    const listPayload = parseToolResponse(listResult)
    expect(listPayload).toMatchObject({
      count: 1,
      calls: [
        expect.objectContaining({
          id: 'call_newer',
          response_status: 502,
          error: 'Upstream timeout',
        }),
      ],
    })

    const getResult = await server.callTool('integration_calls_get', { call_id: 'call_newer' })
    expect(getResult?.isError).not.toBe(true)
    const getPayload = parseToolResponse(getResult)
    expect(getPayload).toMatchObject({
      id: 'call_newer',
      integration: expect.objectContaining({ name: 'ERP Connector' }),
      reference: expect.objectContaining({ name: 'Create Order' }),
      request_body: { orderNumber: 'SO-101' },
      response_body: { ok: false },
    })
  })

  it('lists and fetches agent runs with status and caller filtering', async () => {
    const supabase = createObservabilitySupabaseMock({
      agents: [{ id: 'agent_1', tenant_id: 'test-tenant', name: 'Triage Agent', model: 'gpt-5.4' }],
      agent_runs: [
        {
          id: 'agent_run_old',
          tenant_id: 'test-tenant',
          agent_id: 'agent_1',
          status: 'completed',
          model: 'gpt-5.4',
          iterations: 2,
          total_tokens: 400,
          input_tokens: 150,
          output_tokens: 250,
          duration_ms: 840,
          caller_type: 'workflow_node',
          caller_id: 'run_1',
          trace_id: 'trace_1',
          error: null,
          started_at: '2026-04-14T09:00:00.000Z',
          completed_at: '2026-04-14T09:00:00.840Z',
          created_at: '2026-04-14T09:00:00.000Z',
          agent: { id: 'agent_1', name: 'Triage Agent' },
          input_message: 'Classify severity',
          output_text: 'High',
          tool_calls: [],
        },
        {
          id: 'agent_run_new',
          tenant_id: 'test-tenant',
          agent_id: 'agent_1',
          status: 'failed',
          model: 'gpt-5.4',
          iterations: 1,
          total_tokens: 98,
          input_tokens: 52,
          output_tokens: 46,
          duration_ms: 125,
          caller_type: 'mcp',
          caller_id: 'mcp_request_1',
          trace_id: 'trace_2',
          error: 'Model overloaded',
          started_at: '2026-04-14T11:00:00.000Z',
          completed_at: '2026-04-14T11:00:00.125Z',
          created_at: '2026-04-14T11:00:00.000Z',
          agent: { id: 'agent_1', name: 'Triage Agent' },
          input_message: 'Draft summary',
          output_text: null,
          tool_calls: [
            { name: 'lookup' },
          ],
        },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const listResult = await server.callTool('agent_runs_list', {
      agent_id: 'agent_1',
      caller_type: 'mcp',
      status: 'failed',
      limit: 5,
    })

    expect(listResult?.isError).not.toBe(true)
    const listPayload = parseToolResponse(listResult)
    expect(listPayload).toMatchObject({
      count: 1,
      runs: [
        expect.objectContaining({
          id: 'agent_run_new',
          status: 'failed',
          error: 'Model overloaded',
        }),
      ],
    })

    const getResult = await server.callTool('agent_runs_get', { run_id: 'agent_run_new' })
    expect(getResult?.isError).not.toBe(true)
    const getPayload = parseToolResponse(getResult)
    expect(getPayload).toMatchObject({
      id: 'agent_run_new',
      agent: expect.objectContaining({
        id: 'agent_1',
        name: 'Triage Agent',
      }),
    })
    expect(getPayload.tool_calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'lookup' })]))
  })

  it('returns object audit history with range filtering', async () => {
    const supabase = createObservabilitySupabaseMock({
      users: [{ id: 'user_1', tenant_id: 'test-tenant', display_name: 'Andy Hayes', email: 'andy@example.com' }],
      object_audit_log: [
        {
          id: 'audit_1',
          tenant_id: 'test-tenant',
          object_type: 'workflow',
          object_id: 'wf_1',
          actor_id: 'user_1',
          action: 'publish',
          summary: 'Published onboarding workflow',
          diff: { is_active: [false, true] },
          metadata: { source: 'builder' },
          created_at: '2026-04-14T07:00:00.000Z',
          actor: { id: 'user_1', display_name: 'Andy Hayes', email: 'andy@example.com' },
        },
        {
          id: 'audit_2',
          tenant_id: 'test-tenant',
          object_type: 'workflow',
          object_id: 'wf_1',
          actor_id: 'user_1',
          action: 'update',
          summary: 'Updated onboarding workflow',
          diff: { name: ['Old', 'New'] },
          metadata: { source: 'mcp' },
          created_at: '2026-04-14T09:00:00.000Z',
          actor: { id: 'user_1', display_name: 'Andy Hayes', email: 'andy@example.com' },
        },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const auditResult = await server.callTool('object_audit_log_query', {
      object_type: 'workflow',
      object_id: 'wf_1',
      action: 'update',
      from: '2026-04-14T08:30:00.000Z',
      limit: 10,
    })

    expect(auditResult?.isError).not.toBe(true)
    const auditPayload = parseToolResponse(auditResult)
    expect(auditPayload).toMatchObject({
      count: 1,
      events: [
        expect.objectContaining({
          id: 'audit_2',
          action: 'update',
          actor: expect.objectContaining({ display_name: 'Andy Hayes' }),
        }),
      ],
    })
  })

  it('stitches a unified trace across workflow runs, agent runs, and integration calls in chronological order', async () => {
    const supabase = createObservabilitySupabaseMock({
      workflows: [{ id: 'wf_1', tenant_id: 'test-tenant', name: 'Onboarding Flow' }],
      agents: [{ id: 'agent_1', tenant_id: 'test-tenant', name: 'Triage Agent' }],
      integrations: [{ id: 'int_1', tenant_id: 'test-tenant', name: 'ERP Connector' }],
      workflow_runs: [
        {
          id: 'run_1',
          tenant_id: 'test-tenant',
          trace_id: 'trace_shared',
          status: 'completed',
          error: null,
          started_at: '2026-04-14T09:00:00.000Z',
          completed_at: '2026-04-14T09:10:00.000Z',
          workflow: { id: 'wf_1', name: 'Onboarding Flow' },
        },
      ],
      agent_runs: [
        {
          id: 'agent_run_1',
          tenant_id: 'test-tenant',
          trace_id: 'trace_shared',
          agent_id: 'agent_1',
          status: 'completed',
          error: null,
          started_at: '2026-04-14T09:05:00.000Z',
          completed_at: '2026-04-14T09:05:01.000Z',
          duration_ms: 1000,
          total_tokens: 321,
          agent: { id: 'agent_1', name: 'Triage Agent' },
        },
      ],
      integration_call_logs: [
        {
          id: 'call_1',
          tenant_id: 'test-tenant',
          trace_id: 'trace_shared',
          integration_id: 'int_1',
          reference_id: 'ref_1',
          method: 'POST',
          url: 'https://api.example.com/orders',
          response_status: 200,
          error: null,
          started_at: '2026-04-14T09:06:00.000Z',
          completed_at: '2026-04-14T09:06:00.120Z',
          duration_ms: 120,
          integration: { id: 'int_1', name: 'ERP Connector' },
        },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const traceResult = await server.callTool('trace_get', { trace_id: 'trace_shared' })
    expect(traceResult?.isError).not.toBe(true)
    const tracePayload = parseToolResponse(traceResult)

    expect(tracePayload.trace_id).toBe('trace_shared')
    expect(tracePayload.event_count).toBe(3)
    expect(tracePayload.events.map((event: any) => event.type)).toEqual([
      'workflow_run',
      'agent_run',
      'integration_call',
    ])
    expect(tracePayload.events[0]).toMatchObject({
      workflow: expect.objectContaining({ name: 'Onboarding Flow' }),
    })
  })
})
