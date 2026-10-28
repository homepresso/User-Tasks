import { afterEach, describe, expect, it, vi } from 'vitest'
import { __testing } from '@/lib/workflow-engine'

/**
 * Contract: call_reference and http_request treat an HTTP error status as a
 * response, not a step failure — the step succeeds and stores the status so
 * a Condition can branch on it (`{{status}}` / `{{<prefix>_status}}`). Only a
 * transport failure (DNS, refused connection, timeout) fails the step, which
 * then follows the node's onError policy.
 */

const REF_ID = 'ref-1'
const reference = {
  id: REF_ID,
  name: 'Get vendor',
  request_config: { method: 'GET', path_template: '/vendors/{{vendor_id}}' },
  inputs: [{ name: 'vendor_id', location: 'path' }],
  outputs: [],
  integration: { name: 'ERP', config: { base_url: 'https://erp.example.com', auth_type: 'none' } },
}

type Ctx = Parameters<typeof __testing.executeNode>[3]
type Node = Parameters<typeof __testing.executeNode>[0]

function makeCtx() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: structuredClone(reference), error: null }),
  }
  return {
    supabase: { from: () => chain },
    tenantId: 'tenant-1',
    variables: { vendor_id: 'V-1099' } as Record<string, unknown>,
    liveBindings: {},
    nodeResults: {} as Record<string, { status: string; output?: unknown }>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [],
  } as unknown as Ctx & { variables: Record<string, unknown>; nodeResults: Record<string, { status: string; output?: unknown }> }
}

const callRef = { id: 'n-ref', type: 'call_reference', label: 'Get vendor', position: { x: 0, y: 0 }, config: { reference_id: REF_ID, input_mappings: { vendor_id: '{{vendor_id}}' }, _output_prefix: 'vendor' } } as unknown as Node
const httpReq = { id: 'n-http', type: 'http_request', label: 'Notify', position: { x: 0, y: 0 }, config: { url: 'https://hooks.example.com/notify', method: 'POST', body: '{}', _output_prefix: 'notify' } } as unknown as Node

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })))
}

afterEach(() => { vi.unstubAllGlobals() })

describe('HTTP error statuses are responses, not step failures', () => {
  it.each([500, 404])('call_reference stores a %i response and status for branching', async (code) => {
    respond(code, { error: 'boom' })
    const ctx = makeCtx()
    await __testing.executeNode(callRef, [callRef], [], ctx)

    expect(ctx.nodeResults['n-ref'].status).toBe('success')
    expect(ctx.nodeResults['n-ref'].output).toMatchObject({ status: code, data: { error: 'boom' } })
    expect(ctx.variables.status).toBe(code)
    expect(ctx.variables.response).toEqual({ error: 'boom' })
    expect(ctx.variables.vendor_status).toBe(code)
  })

  it('call_reference fails the step on a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const ctx = makeCtx()
    await expect(__testing.executeNode(callRef, [callRef], [], ctx)).rejects.toThrow(/API call to https:\/\/erp\.example\.com\/vendors\/V-1099 failed/)
    expect(ctx.nodeResults['n-ref'].status).toBe('error')
  })

  it('http_request behaves the same way: 500 is stored as <prefix>_status', async () => {
    respond(500, { error: 'down' })
    const ctx = makeCtx()
    await __testing.executeNode(httpReq, [httpReq], [], ctx)

    expect(ctx.nodeResults['n-http'].status).toBe('success')
    expect(ctx.nodeResults['n-http'].output).toMatchObject({ status: 500 })
    expect(ctx.variables.notify_status).toBe(500)
    expect(ctx.variables.response).toEqual({ error: 'down' })
  })
})
