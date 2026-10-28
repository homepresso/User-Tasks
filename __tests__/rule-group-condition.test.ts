import { describe, expect, it } from 'vitest'
import { branchIndexOf, getBranchLabels, isTrueFalseCondition, orderOutgoingEdges } from '@/lib/workflow-branches'
import { branchPortOffsets, DEFAULT_NODE_WIDTH, routeEdges } from '@/lib/workflow-edge-routing'
import type { WorkflowEdge, WorkflowNode } from '@/lib/workflow-schema'

const groupsConfig = { groups: [{ logic: 'and', rules: [{ field: '{{row_count}}', operator: 'greater_than', value: '0' }] }] }
const cond = (config: Record<string, unknown>): WorkflowNode =>
  ({ id: 'cond', type: 'condition', label: 'Any open vendors?', config, position: { x: 400, y: 300 } }) as WorkflowNode

describe('rule-group conditions render True / False ports', () => {
  it('rule groups and the legacy single rule get True / False, branch conditions keep their branches', () => {
    expect(getBranchLabels(cond(groupsConfig))).toEqual(['True', 'False'])
    expect(getBranchLabels(cond({ field: '{{x}}', operator: 'equals', value: '1' }))).toEqual(['True', 'False'])
    expect(getBranchLabels(cond({ branches: [{ label: 'Auto-approve', rules: [] }], has_else: true }))).toEqual(['Auto-approve', 'Else'])
    expect(getBranchLabels(cond({}))).toEqual([]) // nothing configured yet
    expect(getBranchLabels(cond({ groups: [] }))).toEqual([])
    expect(isTrueFalseCondition({ ...groupsConfig, branches: [{ label: 'A' }] })).toBe(false)
  })

  it('rendering only: the config is not changed', () => {
    const config = structuredClone(groupsConfig)
    getBranchLabels(cond(config))
    expect(config).toEqual(groupsConfig)
  })

  it('existing edges stay attached: True / False and legacy true / yes / false / no labels map to the ports', () => {
    const labels = getBranchLabels(cond(groupsConfig))
    expect(branchIndexOf(labels, { label: 'True' }, 'condition')).toBe(0)
    expect(branchIndexOf(labels, { label: 'False' }, 'condition')).toBe(1)
    expect(branchIndexOf(labels, { label: 'true' }, 'condition')).toBe(0)
    expect(branchIndexOf(labels, { label: 'yes' }, 'condition')).toBe(0)
    expect(branchIndexOf(labels, { label: 'no' }, 'condition')).toBe(1)
  })

  it('edges leave from the two ports (not one shared output)', () => {
    const nodes: WorkflowNode[] = [
      cond(groupsConfig),
      { id: 'ins', type: 'update_data_table', label: 'Insert', config: {}, position: { x: 160, y: 460 } } as WorkflowNode,
      { id: 'upd', type: 'update_data_table', label: 'Update', config: {}, position: { x: 640, y: 460 } } as WorkflowNode,
    ]
    const edges: WorkflowEdge[] = [
      { id: 'e4', source: 'cond', target: 'upd', label: 'False' },
      { id: 'e3', source: 'cond', target: 'ins', label: 'True' },
    ]
    const routes = routeEdges(nodes, edges)
    const t = routes.find((r) => r.id === 'e3')!, f = routes.find((r) => r.id === 'e4')!
    expect(t.branchIndex).toBe(0)
    expect(f.branchIndex).toBe(1)
    const [p0, p1] = branchPortOffsets(DEFAULT_NODE_WIDTH, 2)
    expect(Math.abs(t.points[0].x - (400 + p0))).toBeLessThanOrEqual(1) // grid-rounded
    expect(Math.abs(f.points[0].x - (400 + p1))).toBeLessThanOrEqual(1)
    expect(t.points[0].x).not.toBe(f.points[0].x)
    expect(orderOutgoingEdges(nodes[0], edges).map((e) => e.id)).toEqual(['e3', 'e4'])
  })
})
