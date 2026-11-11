import { describe, it, expect } from 'vitest'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'

// Purchase request run 6b428d21: the "Raise purchase order" User Task waited and resumed and
// has no stored node result, but the trace visited it — the steps after it must not show "Not run".
describe('run overlay with a resumed User Task that has no stored result', () => {
  const nodes = ['trigger', 'exec_check', 'po', 'po_vars', 'approved_info', 'end_approved', 'exec_task'].map((id) => ({ id, type: id === 'po' || id === 'approved_info' || id === 'exec_task' ? 'user_task' : 'set_variable' }))
  const edges = [
    { id: 'e1', source: 'trigger', target: 'exec_check' },
    { id: 'e2', source: 'exec_check', target: 'po' },
    { id: 'e2b', source: 'exec_check', target: 'exec_task' },
    { id: 'e3', source: 'po', target: 'po_vars' },
    { id: 'e4', source: 'po_vars', target: 'approved_info' },
    { id: 'e5', source: 'approved_info', target: 'end_approved' },
  ]
  const nodeResults = { trigger: { status: 'success' }, exec_check: { status: 'success' }, po_vars: { status: 'success' }, end_approved: { status: 'success' } }
  const visits = { trigger: 1, exec_check: 1, po: 2, po_vars: 1, approved_info: 2, end_approved: 1 }

  it('marks the resumed tasks and everything after them as completed', () => {
    const o = computeRunOverlay({ nodes, edges, nodeResults, visits })
    for (const id of ['po', 'po_vars', 'approved_info', 'end_approved']) expect(o.nodes[id].status).toBe('completed')
    expect(o.nodes.exec_task.status).toBe('not_run')
  })

  it('without trace visits it falls back to results only (old behaviour)', () => {
    const o = computeRunOverlay({ nodes, edges, nodeResults })
    expect(o.nodes.po.status).toBe('not_run')
  })
})
