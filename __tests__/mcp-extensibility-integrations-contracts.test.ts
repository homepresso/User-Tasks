import { describe, expect, it } from 'vitest'

import { createMcpServer } from '@/lib/mcp/server'

function parseToolResponse(result: any) {
  const text = result?.content?.[0]?.text
  expect(typeof text).toBe('string')
  return JSON.parse(text)
}

function createExtensibilityIntegrationSupabaseMock(seed?: Partial<Record<string, any[]>>) {
  const records: Record<string, any[]> = {
    custom_workflow_activities: [],
    integrations: [],
    integration_references: [],
    tenant_connectors: [],
    ...seed,
  }

  let idCounter = 1
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
  const nextId = (table: string) => `${table}_${idCounter++}`

  const applyFilters = (
    rows: any[],
    filters: Array<{ type: 'eq' | 'in'; field: string; value: any }>,
  ) => {
    let filtered = [...rows]
    for (const filter of filters) {
      if (filter.type === 'eq') filtered = filtered.filter((row) => row?.[filter.field] === filter.value)
      if (filter.type === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : []
        filtered = filtered.filter((row) => values.includes(row?.[filter.field]))
      }
    }
    return filtered
  }

  const buildQuery = (table: string): any => {
    const state = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      payload: undefined as any,
      filters: [] as Array<{ type: 'eq' | 'in'; field: string; value: any }>,
      upsertOptions: undefined as any,
      mode: 'many' as 'many' | 'single',
    }

    const execute = () => {
      const rows = records[table] ?? (records[table] = [])

      if (state.op === 'insert') {
        const inputRows = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = inputRows.map((item) => {
          const row = clone(item ?? {})
          if (!row.id) row.id = nextId(table)
          rows.push(row)
          return clone(row)
        })
        return state.mode === 'single' ? inserted[0] ?? null : inserted
      }

      if (state.op === 'upsert') {
        const inputRows = Array.isArray(state.payload) ? state.payload : [state.payload]
        const upserted = inputRows.map((item) => {
          const row = clone(item ?? {})
          const onConflict = String(state.upsertOptions?.onConflict ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
          const existingIndex = rows.findIndex((candidate) => {
            if (onConflict.length === 0) return candidate?.id && row?.id && candidate.id === row.id
            return onConflict.every((field) => candidate?.[field] === row?.[field])
          })
          if (existingIndex >= 0) {
            rows[existingIndex] = { ...rows[existingIndex], ...row }
            return clone(rows[existingIndex])
          }
          if (!row.id) row.id = nextId(table)
          rows.push(row)
          return clone(row)
        })
        return state.mode === 'single' ? upserted[0] ?? null : upserted
      }

      if (state.op === 'update') {
        const matchingRows = applyFilters(rows, state.filters)
        const updated = matchingRows.map((row) => {
          Object.assign(row, clone(state.payload ?? {}))
          return clone(row)
        })
        return state.mode === 'single' ? updated[0] ?? null : updated
      }

      if (state.op === 'delete') {
        const removed = applyFilters(rows, state.filters)
        records[table] = rows.filter((row) => !removed.includes(row))
        return state.mode === 'single' ? clone(removed[0] ?? null) : clone(removed)
      }

      const selected = applyFilters(rows, state.filters).map((row) => clone(row))
      return state.mode === 'single' ? selected[0] ?? null : selected
    }

    const resolve = () => Promise.resolve({ data: execute(), error: null })

    return {
      insert(payload: any) {
        state.op = 'insert'
        state.payload = payload
        return this
      },
      upsert(payload: any, options?: any) {
        state.op = 'upsert'
        state.payload = payload
        state.upsertOptions = options
        return this
      },
      update(payload: any) {
        state.op = 'update'
        state.payload = payload
        return this
      },
      delete() {
        state.op = 'delete'
        return this
      },
      select() { return this },
      eq(field: string, value: any) {
        state.filters.push({ type: 'eq', field, value })
        return this
      },
      in(field: string, value: any) {
        state.filters.push({ type: 'in', field, value })
        return this
      },
      or() { return this },
      order() { return this },
      limit() { return this },
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

describe('MCP extensibility contracts', () => {
  it('creates, exports, and imports workflow activities with manifest enforcement', async () => {
    const supabase = createExtensibilityIntegrationSupabaseMock()
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const createResult = await server.callTool('workflow_activities_create', {
      name: 'Risk Calculator',
      source_code: 'async function run(inputs) { return { outputs: { score: Number(inputs.amount ?? 0) } } }',
      manifest: {
        inputs: [{ name: 'amount', type: 'number', required: true }],
        outputs: [{ name: 'score', type: 'number' }],
      },
      demo_inputs: { amount: 42 },
    })

    expect(createResult?.isError).not.toBe(true)
    const createPayload = parseToolResponse(createResult)
    expect(createPayload).toMatchObject({
      created: true,
      workflow_activity: expect.objectContaining({
        name: 'Risk Calculator',
        key: 'risk_calculator',
      }),
    })
    expect(createPayload.workflow_activity.manifest_summary).toMatchObject({
      input_count: 1,
      output_count: 1,
    })

    const exportResult = await server.callTool('workflow_activities_export', {
      workflow_activity_id: createPayload.workflow_activity.id,
    })
    expect(exportResult?.isError).not.toBe(true)
    const exportPayload = parseToolResponse(exportResult)
    expect(exportPayload).toMatchObject({
      exported: true,
      export: expect.objectContaining({
        asset_type: 'workflow_activity',
      }),
    })

    const importResult = await server.callTool('workflow_activities_import', {
      import_json: JSON.stringify(exportPayload.export),
      publish: true,
    })
    expect(importResult?.isError).not.toBe(true)
    const importPayload = parseToolResponse(importResult)
    expect(importPayload).toMatchObject({
      imported: true,
      workflow_activity: expect.objectContaining({
        name: 'Risk Calculator',
        status: 'active',
      }),
    })
  })
})

describe('MCP integrations contracts', () => {
  it('creates integration bundles and standalone references', async () => {
    const supabase = createExtensibilityIntegrationSupabaseMock()
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const bundleResult = await server.callTool('integrations_create_bundle', {
      name: 'ERP API',
      type: 'rest_api',
      config: JSON.stringify({
        base_url: 'https://erp.example.com',
        auth_type: 'api_key',
        auth_config: { key_name: 'X-API-Key', key_value: 'secret' },
      }),
      references: JSON.stringify([
        {
          name: 'Get Orders',
          description: 'Fetch orders',
          method: 'GET',
          path_template: '/orders',
          inputs: [{ name: 'status', type: 'string', required: false }],
          outputs: [{ name: 'rows', path: 'data', type: 'array' }],
        },
      ]),
    })

    expect(bundleResult?.isError).not.toBe(true)
    const bundlePayload = parseToolResponse(bundleResult)
    expect(bundlePayload).toMatchObject({
      created: true,
      integration: expect.objectContaining({
        name: 'ERP API',
        type: 'rest_api',
      }),
      references_created: 1,
    })

    const refCreateResult = await server.callTool('references_create', {
      integration_id: bundlePayload.integration.id,
      name: 'Create Order',
      method: 'POST',
      request_config: JSON.stringify({
        path_template: '/orders',
        body_template: '{"customer":"{{customer}}"}',
      }),
      inputs: JSON.stringify([{ name: 'customer', type: 'string', required: true }]),
      outputs: JSON.stringify([{ name: 'order_id', path: 'id', type: 'string' }]),
    })
    expect(refCreateResult?.isError).not.toBe(true)
    const refPayload = parseToolResponse(refCreateResult)
    expect(refPayload).toMatchObject({
      created: true,
      reference: expect.objectContaining({
        name: 'Create Order',
      }),
    })
  })

  it('creates connector-backed integrations and imports API specs into integration bundles', async () => {
    const supabase = createExtensibilityIntegrationSupabaseMock()
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const connectorResult = await server.callTool('connectors_create', {
      connector_key: 'openai',
      display_name: 'OpenAI Workspace',
      credentials: JSON.stringify({ api_key: 'sk-test' }),
      config: JSON.stringify({ default_model: 'gpt-4o-mini' }),
    })
    expect(connectorResult?.isError).not.toBe(true)
    const connectorPayload = parseToolResponse(connectorResult)
    expect(connectorPayload).toMatchObject({
      created: true,
      connector: expect.objectContaining({
        key: 'openai',
        display_name: 'OpenAI Workspace',
      }),
      integration: expect.objectContaining({
        type: 'openai',
      }),
    })
    expect(connectorPayload.references_created).toBeGreaterThan(0)

    const importSpecResult = await server.callTool('integrations_import_api_spec', {
      name_override: 'Orders API',
      spec_content: JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Orders API', version: '1.0.0' },
        servers: [{ url: 'https://orders.example.com' }],
        paths: {
          '/orders': {
            get: {
              operationId: 'listOrders',
              summary: 'List orders',
              responses: {
                '200': { description: 'OK' },
              },
            },
          },
        },
      }),
    })
    expect(importSpecResult?.isError).not.toBe(true)
    const importSpecPayload = parseToolResponse(importSpecResult)
    expect(importSpecPayload).toMatchObject({
      created: true,
      integration: expect.objectContaining({
        name: 'Orders API',
        type: 'rest_api',
      }),
    })
    expect(importSpecPayload.references_created).toBeGreaterThan(0)
    expect(importSpecPayload.imported_reference_names.length).toBeGreaterThan(0)
  })
})
