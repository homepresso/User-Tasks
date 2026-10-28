import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/workflow-engine'

/**
 * update_data_table `get` writes the row to `output_row_var` (default `row`)
 * and each column under the node's prefix (`<prefix>_<column>`). For
 * backward compatibility each column is also copied to a top-level variable —
 * but never over a workflow input (trigger payload / user variable) or a
 * run variable the engine owns (task_id, workflow_id, outcome, …).
 */
function makeCtx(variables: Record<string, any>, rowData: Record<string, any>) {
  const b: any = {
    select: () => b, eq: () => b, order: () => b, limit: () => b, in: () => b, update: () => b,
    single: async () => ({ data: { id: 'row-1', data: rowData, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
  }
  return {
    supabase: { from: () => b },
    tenantId: 'tenant-1',
    taskId: 'task-1',
    variables,
    liveBindings: {},
    nodeResults: {} as Record<string, any>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [] as any[],
    onEvent: () => {},
  } as any
}

const node = { id: 'n1', type: 'update_data_table', label: 'Get Invoice', position: { x: 0, y: 0 }, config: { table_id: 'tbl-1', operation: 'get', row_id: 'row-1' } } as any

describe('data table get → run variables', () => {
  it('does not overwrite workflow inputs or engine variables with same-named columns', async () => {
    const ctx = makeCtx(
      { amount: 100, task_id: 'task-1', workflow_id: 'wf-1', _workflow_inputs: ['amount'] },
      { amount: 5, status: 'paid', task_id: 'other-task', workflow_id: 'other-wf' },
    )
    await __testing.executeNode(node, [node], [], ctx)
    expect(ctx.nodeResults.n1.status).toBe('success')
    // Inputs and engine-owned variables are kept.
    expect(ctx.variables.amount).toBe(100)
    expect(ctx.variables.task_id).toBe('task-1')
    expect(ctx.variables.workflow_id).toBe('wf-1')
    // The row and prefixed columns carry the row's values.
    expect(ctx.variables.row.amount).toBe(5)
    expect(ctx.variables.get_invoice_amount).toBe(5)
    expect(ctx.variables.get_invoice_task_id).toBe('other-task')
    // Non-colliding columns are still copied top-level (documented compat).
    expect(ctx.variables.status).toBe('paid')
    expect(ctx.logs.some((l: any) => /amount/.test(l.message) && l.level === 'warn')).toBe(true)
  })

  it('a later get may refresh a column an earlier get wrote', async () => {
    const ctx = makeCtx({ _workflow_inputs: [] }, { status: 'paid' })
    await __testing.executeNode(node, [node], [], ctx)
    ctx.executedNodes.clear()
    const again = makeCtx(ctx.variables, { status: 'void' })
    await __testing.executeNode(node, [node], [], again)
    expect(again.variables.status).toBe('void')
  })
})
