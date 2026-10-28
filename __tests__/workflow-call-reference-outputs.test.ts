import { afterEach, describe, expect, it, vi } from 'vitest'
import { __testing } from '@/lib/workflow-engine'
import { resolveExpression } from '@/lib/expression-resolver'
import { buildPickExpression } from '@/lib/workflow-data-picker'

/**
 * Contract: existing output_mappings keep working unchanged, node-level
 * custom_outputs ("Add as output" in the data picker) read paths relative to
 * the response, and the expressions the picker inserts resolve against the
 * real run variables.
 */

const body = {
  total: 2,
  data: [
    { id: 1, name: 'Ada', email: 'ada@example.com', address: { city: 'Wellington' } },
    { id: 2, name: 'Grace', email: 'grace@example.com', address: { city: 'Auckland' } },
  ],
}

const reference = {
  id: 'ref-1',
  name: 'Get customers',
  request_config: { method: 'GET', path_template: '/customers', response_schema: { version: 1, source: 'sample', root: { type: 'object' } } },
  inputs: [],
  outputs: [
    { name: 'first_name', path: 'data[0].name', type: 'string' },
    { name: 'total', path: 'total', type: 'number' },
    { name: 'customers', path: 'data', type: 'array' },
    { name: 'col_email', path: '[].email', type: 'string' },
  ],
  integration: { name: 'CRM', config: { base_url: 'https://crm.example.com', auth_type: 'none' } },
}

type Ctx = Parameters<typeof __testing.executeNode>[3]
type Node = Parameters<typeof __testing.executeNode>[0]

function makeCtx() {
  const chain: Record<string, unknown> = { select: () => chain, eq: () => chain, single: async () => ({ data: structuredClone(reference), error: null }) }
  return {
    supabase: { from: () => chain },
    tenantId: 'tenant-1',
    variables: {} as Record<string, unknown>,
    liveBindings: {},
    nodeResults: {} as Record<string, { status: string; output?: unknown }>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [],
  } as unknown as Ctx & { variables: Record<string, unknown> }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('call_reference outputs', () => {
  it('legacy output_mappings, custom_outputs and picker expressions all resolve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })))
    const node = {
      id: 'n1', type: 'call_reference', label: 'Get Customers', position: { x: 0, y: 0 },
      config: {
        reference_id: 'ref-1',
        output_mappings: {
          first_name: { enabled: true, variableName: 'ref_first_name' },
          total: { enabled: true, variableName: 'ref_total' },
          customers: { enabled: false, variableName: 'ref_customers' },
          col_email: { enabled: true, variableName: 'ref_col' },
        },
        custom_outputs: [{ name: 'second_city', path: 'data[1].address.city' }, { name: 'everything', path: '' }],
      },
    } as unknown as Node
    const ctx = makeCtx()
    await __testing.executeNode(node, [node], [], ctx)

    expect(ctx.variables.ref_first_name).toBe('Ada')
    expect(ctx.variables.ref_total).toBe(2)
    expect(ctx.variables).not.toHaveProperty('ref_customers')
    expect(ctx.variables).not.toHaveProperty('ref_col') // column descriptors stay metadata-only
    expect(ctx.variables.second_city).toBe('Auckland')
    expect(ctx.variables.everything).toEqual(body)
    expect(ctx.variables.get_customers_response).toEqual(body)

    const vars = { variables: ctx.variables }
    expect(resolveExpression(buildPickExpression('get_customers_response.data[].name', { type: 'string' }, { kind: 'first' }), vars)).toBe('Ada')
    expect(resolveExpression(buildPickExpression('get_customers_response.data[].email', { type: 'string' }, { kind: 'pluck' }), vars)).toEqual(['ada@example.com', 'grace@example.com'])
    expect(resolveExpression(buildPickExpression('get_customers_response.data[].email', { type: 'string' }, { kind: 'find', field: 'id', value: '2' }), vars)).toBe('grace@example.com')
  })
})
