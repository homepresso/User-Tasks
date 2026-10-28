import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/workflow-engine'
import { validateNode } from '@/lib/workflow-validation'

/** set_sla amounts accept expressions: resolved, coerced to a number and validated. */
function makeCtx(variables: Record<string, any>) {
  return {
    supabase: { from: () => ({}) },
    tenantId: 'tenant-1',
    variables,
    liveBindings: {},
    nodeResults: {} as Record<string, any>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [] as any[],
    onEvent: () => {},
  } as any
}
const sla = (config: Record<string, any>) => ({ id: 'n1', type: 'set_sla', label: 'SLA', position: { x: 0, y: 0 }, config }) as any

describe('set_sla amount expressions', () => {
  it('validation accepts an expression amount and warning amount', () => {
    expect(validateNode(sla({ mode: 'relative', amount: '{{sla_days}}', unit: 'days', warning_amount: '{{=SUBTRACT(sla_days, 1)}}' }))).toEqual([])
    expect(validateNode(sla({ mode: 'relative', amount: '' }))).toContain('SLA amount required')
    expect(validateNode(sla({ mode: 'relative', amount: 'abc' })).join(' ')).toMatch(/number or an expression/)
    expect(validateNode(sla({ mode: 'relative', amount: 3, warning_amount: 'soon' })).join(' ')).toMatch(/number or an expression/)
  })

  it('resolves the amount at run time (number coercion)', async () => {
    const ctx = makeCtx({ sla_days: '3', warn: ' 1 ' })
    const before = Date.now()
    await __testing.executeNode(sla({ mode: 'relative', amount: '{{sla_days}}', unit: 'days', warning_amount: '{{warn}}', warning_unit: 'days' }), [], [], ctx)
    expect(ctx.nodeResults.n1.status).toBe('success')
    const due = Date.parse(ctx.variables.workflow_sla_due_at)
    expect(due - before).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000)
    expect(due - before).toBeLessThan(3 * 86_400_000 + 5000)
    expect(Date.parse(ctx.variables.workflow_sla_warning_at)).toBe(due - 86_400_000)
  })

  it('a non-numeric resolved amount fails the node with a clear message', async () => {
    const ctx = makeCtx({ sla_days: 'three' })
    await expect(__testing.executeNode(sla({ mode: 'relative', amount: '{{sla_days}}', unit: 'days' }), [], [], ctx))
      .rejects.toThrow(/SLA amount must be a positive number.*"three"/)
  })

  it('a function amount works', async () => {
    const ctx = makeCtx({ base: 2 })
    await __testing.executeNode(sla({ mode: 'relative', amount: '{{=ADD(base, 2)}}', unit: 'hours' }), [], [], ctx)
    expect(ctx.nodeResults.n1.status).toBe('success')
    expect(ctx.variables.workflow_sla_status).toBe('on_track')
  })
})
