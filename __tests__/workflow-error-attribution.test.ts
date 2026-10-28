import { describe, expect, it } from 'vitest'
import { __testing } from '@/lib/workflow-engine'

/**
 * Contract: a descendant node's failure must be recorded exactly once — for
 * the node where it originated. Ancestors on the execution call stack rethrow
 * without clobbering their own success result or emitting duplicate
 * node_error events (previously the trigger card showed the failing action's
 * error because every ancestor re-recorded the child's error as its own).
 */

function makeCtx(events: any[]) {
  return {
    supabase: {} as any,
    tenantId: 'tenant-1',
    variables: {},
    liveBindings: {},
    nodeResults: {} as Record<string, any>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [],
    onEvent: (event: any) => events.push(event),
  } as any
}

const parent = { id: 'n-parent', type: 'set_variable', label: 'Set Var', position: { x: 0, y: 0 }, config: { name: 'x', expression: '1' } } as any
// http_request with no URL throws synchronously inside runNodeAction.
const child = { id: 'n-child', type: 'http_request', label: 'Call API', position: { x: 0, y: 100 }, config: {} } as any
const edges = [{ id: 'e1', source: 'n-parent', target: 'n-child' }] as any[]

describe('workflow error attribution', () => {
  it('keeps the ancestor successful and records the error only on the failing node', async () => {
    const events: any[] = []
    const ctx = makeCtx(events)

    await expect(__testing.executeNode(parent, [parent, child], edges, ctx)).rejects.toThrow('no URL configured')

    expect(ctx.nodeResults['n-parent']?.status).toBe('success')
    expect(ctx.nodeResults['n-child']?.status).toBe('error')
    expect(ctx.nodeResults['n-child']?.error).toContain('no URL configured')

    const nodeErrors = events.filter((e) => e.type === 'node_error')
    expect(nodeErrors).toHaveLength(1)
    expect(nodeErrors[0].node_id).toBe('n-child')

    // Error context points at the true failing node, not the topmost ancestor.
    expect(ctx.variables['last_error_node']).toBe('Call API')
    expect(ctx.variables['last_error_node_id']).toBe('n-child')
  })

  it('ancestor onError=continue still swallows a descendant failure without marking the ancestor failed', async () => {
    const events: any[] = []
    const ctx = makeCtx(events)
    const tolerantParent = { ...parent, id: 'n-parent-2', onError: 'continue' as const }
    const failingChild = { ...child, id: 'n-child-2' }
    const localEdges = [{ id: 'e1', source: 'n-parent-2', target: 'n-child-2' }] as any[]

    await expect(__testing.executeNode(tolerantParent, [tolerantParent, failingChild], localEdges, ctx)).resolves.toBeUndefined()

    expect(ctx.nodeResults['n-parent-2']?.status).toBe('success')
    expect(ctx.nodeResults['n-child-2']?.status).toBe('error')
    expect(events.filter((e) => e.type === 'node_error')).toHaveLength(1)
  })

  it('a node failing its own action records its own error', async () => {
    const events: any[] = []
    const ctx = makeCtx(events)
    const solo = { ...child, id: 'n-solo' }

    await expect(__testing.executeNode(solo, [solo], [], ctx)).rejects.toThrow()
    expect(ctx.nodeResults['n-solo']?.status).toBe('error')
    expect(events.filter((e) => e.type === 'node_error')).toHaveLength(1)
  })
})
