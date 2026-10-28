import { describe, expect, it } from 'vitest'
import { __testing } from '@/lib/workflow-engine'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import { validateNode } from '@/lib/workflow-validation'

/**
 * send_push and ai_action were "coming soon" placeholders and are gone from
 * the catalog. Workflows that still store them keep loading and running: the
 * engine skips unknown node types and validation reports nothing.
 */

function makeCtx() {
  const b: any = {
    update: () => b, eq: () => b, select: () => b, order: () => b, limit: () => b, in: () => b, insert: () => b,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
  }
  return {
    supabase: { from: () => b }, tenantId: 'tenant-1', taskId: null, variables: {}, liveBindings: {},
    nodeResults: {} as Record<string, any>, executedNodes: new Set<string>(), executionTrace: [], logs: [], onEvent: () => {},
  } as any
}

describe.each(['send_push', 'ai_action'])('retired node type %s', (type) => {
  const node = { id: 'n1', type, label: 'Old', position: { x: 0, y: 0 }, config: {} } as any

  it('is not offered in the catalog', () => {
    expect(NODE_CATALOG.some((n) => n.type === type)).toBe(false)
  })

  it('is skipped when a stored workflow runs it', async () => {
    const ctx = makeCtx()
    await __testing.executeNode(node, [node], [], ctx)
    expect(ctx.nodeResults.n1.status).toBe('success')
    expect(ctx.nodeResults.n1.output).toMatchObject({ skipped: true, reason: `Unknown node type: ${type}` })
  })

  it('does not fail validation', () => {
    expect(validateNode(node)).toEqual([])
  })
})
