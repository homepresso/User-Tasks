import { describe, expect, it } from 'vitest'
import { __testing } from '@/lib/workflow-engine'
import { validateNode } from '@/lib/workflow-validation'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { buildDataTree, rootsForNode, type PickerEdgeLike, type PickerNodeLike } from '@/lib/workflow-data-picker'
import { definitionVariableColumns } from '@/lib/report-workflow-variables'
import {
  expressionSyntaxError,
  setVariableAssignments,
  setVariableEditorRows,
  setVariableNames,
  setVariableRowIssues,
  setVariableSummary,
} from '@/lib/workflow-set-variable'
import { createEmptyAssetIdMaps, remapKnownIds } from '@/lib/portability/id-maps'
import { normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { planManifest } from '@/lib/portability/plan'

function makeCtx(variables: Record<string, any> = {}, events: any[] = []) {
  return {
    supabase: {} as any,
    tenantId: 'tenant-1',
    variables,
    liveBindings: {},
    nodeResults: {} as Record<string, any>,
    executedNodes: new Set<string>(),
    executionTrace: [],
    logs: [],
    onEvent: (event: any) => events.push(event),
  } as any
}

const setNode = (id: string, config: Record<string, any>, label = 'Set') =>
  ({ id, type: 'set_variable', label, position: { x: 0, y: 0 }, config }) as any

describe('Set Variable config shapes', () => {
  it('reads the legacy single shape as one assignment', () => {
    expect(setVariableAssignments({ name: 'a', expression: '{{x}}' })).toEqual([{ name: 'a', expression: '{{x}}' }])
    expect(setVariableAssignments({})).toEqual([])
    expect(setVariableAssignments({ name: '', expression: '1' })).toEqual([])
    expect(setVariableNames({ name: 'a', expression: '1' })).toEqual(['a'])
  })

  it('reads assignments in order (with row aliases) and prefers them over legacy keys', () => {
    const config = { name: 'ignored', expression: 'x', assignments: [{ name: ' a ', expression: '1' }, { variable: 'b', value: 2 }, { name: '' }] }
    expect(setVariableAssignments(config)).toEqual([
      { name: 'a', expression: '1' },
      { name: 'b', expression: 2 },
      { name: '', expression: '' },
    ])
    expect(setVariableNames(config)).toEqual(['a', 'b'])
    // An empty list falls back to the legacy pair.
    expect(setVariableAssignments({ name: 'a', expression: '1', assignments: [] })).toEqual([{ name: 'a', expression: '1' }])
  })

  it('gives the editor at least one row', () => {
    expect(setVariableEditorRows({})).toEqual([{ name: '', expression: '' }])
    expect(setVariableEditorRows({ name: 'a', expression: '{{x}}' })).toEqual([{ name: 'a', expression: '{{x}}' }])
    expect(setVariableEditorRows({ assignments: [{ name: 'a', expression: { k: 1 } }] })).toEqual([{ name: 'a', expression: '{"k":1}' }])
  })

  it('summarises one or several variables for the canvas', () => {
    expect(setVariableSummary({ name: 'a', expression: '{{x}}' })).toBe('a = {{x}}')
    expect(setVariableSummary({ name: 'a' })).toBe('a = ...')
    expect(setVariableSummary({})).toBeNull()
    expect(setVariableSummary({ assignments: [{ name: 'a', expression: '1' }] })).toBe('a = 1')
    expect(setVariableSummary({ assignments: [{ name: 'a', expression: '1' }, { name: 'b', expression: '2' }, { name: 'c', expression: '3' }] }))
      .toBe('Set 3 variables: a, b, c')
    expect(setVariableSummary({ assignments: ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, expression: '1' })) }))
      .toBe('Set 5 variables: a, b, c +2 more')
    expect(getNodeConfigSummary({ type: 'set_variable', config: { assignments: [{ name: 'a', expression: '1' }, { name: 'b', expression: '2' }] } }))
      .toBe('Set 2 variables: a, b')
    expect(getNodeConfigSummary({ type: 'set_variable', config: { name: 'legacy', expression: '{{x}}' } })).toBe('legacy = {{x}}')
  })
})

describe('Set Variable validation', () => {
  it('keeps the legacy single check unchanged', () => {
    expect(validateNode(setNode('n', {}))).toEqual(['Variable name required'])
    expect(validateNode(setNode('n', { name: 'a', expression: '{{unbalanced' }))).toEqual([])
  })

  it('flags empty and duplicate names per row', () => {
    const config = { assignments: [{ name: 'a', expression: '1' }, { name: '', expression: '2' }, { name: 'a', expression: '3' }] }
    expect(setVariableRowIssues(config)).toEqual([
      { index: 1, field: 'name', message: 'Variable name required' },
      { index: 2, field: 'name', message: '"a" is already set in row 1' },
    ])
    expect(validateNode(setNode('n', config))).toEqual([
      'Row 2: Variable name required',
      'Row 3: "a" is already set in row 1',
    ])
  })

  it('flags unbalanced expressions and invalid names', () => {
    expect(expressionSyntaxError('{{a}} and {{b')).toBe('has "{{" without a matching "}}"')
    expect(expressionSyntaxError('a}}')).toBe('has "}}" without a matching "{{"')
    expect(expressionSyntaxError('{{=IF(a > 1, "x", "y")}}')).toBeNull()
    expect(expressionSyntaxError(5)).toBeNull()
    expect(validateNode(setNode('n', { assignments: [{ name: 'my var', expression: '{{x' }] }))).toEqual([
      'Row 1: "my var" can\'t contain spaces or braces',
      'Row 1 (my var): Value has "{{" without a matching "}}"',
    ])
    expect(validateNode(setNode('n', { assignments: [{ name: 'a', expression: '1' }, { name: 'b', expression: '{{=a * 2}}' }] }))).toEqual([])
  })
})

describe('Set Variable execution', () => {
  it('sets every assignment in order; a later one reads an earlier one', async () => {
    const node = setNode('n1', {
      assignments: [
        { name: 'net', expression: '{{=amount / 2}}' },
        { name: 'tax', expression: '{{=amount - net}}' },
        { name: 'label', expression: 'Net {{net}}, tax {{tax}}' },
        { name: 'net', expression: '{{=net + 1}}' },
      ],
    })
    const ctx = makeCtx({ amount: 100 })
    await __testing.executeNode(node, [node], [], ctx)
    expect(ctx.variables.tax).toBe(50)
    expect(ctx.variables.label).toBe('Net 50, tax 50')
    expect(ctx.variables.net).toBe(51)
    expect(ctx.nodeResults.n1.status).toBe('success')
    expect(ctx.nodeResults.n1.output.assignments.map((a: any) => a.name)).toEqual(['net', 'tax', 'label', 'net'])
    expect(ctx.nodeResults.n1.output.variables).toMatchObject({ tax: 50, net: 51 })
  })

  it('still executes the legacy single shape with the same output', async () => {
    const node = setNode('n2', { name: 'greeting', expression: 'Hi {{who}}' })
    const ctx = makeCtx({ who: 'Ana' })
    await __testing.executeNode(node, [node], [], ctx)
    expect(ctx.variables.greeting).toBe('Hi Ana')
    expect(ctx.nodeResults.n2.output).toEqual({ variable: 'greeting', value: 'Hi Ana' })
  })

  it('fails the node with an error naming the row when a name is missing; earlier rows stay set', async () => {
    const node = setNode('n3', { assignments: [{ name: 'a', expression: '1' }, { name: '', expression: '2' }] })
    const ctx = makeCtx()
    await expect(__testing.executeNode(node, [node], [], ctx)).rejects.toThrow('Set Variable: row 2 has no variable name')
    expect(ctx.variables.a).toBe('1')
    expect(ctx.nodeResults.n3.status).toBe('error')
  })
})

describe('Set Variable discovery', () => {
  const trigger: PickerNodeLike = { id: 't', type: 'manual', label: 'Start', config: {}, position: { x: 0, y: 0 } } as any
  const multi: PickerNodeLike = {
    id: 'set', type: 'set_variable', label: 'Totals', position: { x: 0, y: 100 },
    config: { assignments: [{ name: 'parts', expression: '{{=SPLIT(title, ",")}}' }, { name: 'count', expression: '{{=COUNT(parts)}}' }, { name: 'first', expression: '{{=FIRST(parts)}}' }, { name: '', expression: '1' }] },
  } as any
  const legacy: PickerNodeLike = { id: 'old', type: 'set_variable', label: 'Old', position: { x: 0, y: 200 }, config: { name: 'flag', expression: 'true' } } as any
  const after: PickerNodeLike = { id: 'after', type: 'log', label: 'After', config: {}, position: { x: 0, y: 300 } } as any
  const nodes = [trigger, multi, legacy, after]
  const edges: PickerEdgeLike[] = [{ source: 't', target: 'set' }, { source: 'set', target: 'old' }, { source: 'old', target: 'after' }]

  it('lists a root for every named assignment, typed against earlier rows', () => {
    const roots = rootsForNode(multi)
    expect(roots.map((r) => r.path)).toEqual(['parts', 'count', 'first'])
    expect(roots[0].schema).toMatchObject({ type: 'array' })
    expect(roots[1].schema).toMatchObject({ type: 'number' })
    expect(roots[2].schema).toMatchObject({ type: 'string' })
  })

  it('shows both shapes in the data picker and report columns', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'after' })
    expect(groups.find((g) => g.label === 'Totals')!.roots.map((r) => r.path)).toEqual(['parts', 'count', 'first'])
    expect(groups.find((g) => g.label === 'Old')!.roots.map((r) => r.path)).toEqual(['flag'])
    const columns = definitionVariableColumns({ nodes, edges }).map((c) => c.label)
    expect(columns).toEqual(expect.arrayContaining(['count', 'first', 'flag']))
  })
})

describe('Set Variable portability', () => {
  const TRIGGER = { id: 't1', type: 'manual', label: 'Manual Trigger', position: { x: 300, y: 20 }, config: {} }
  const legacyNode = { id: 'n1', type: 'set_variable', label: 'One', position: { x: 220, y: 160 }, config: { name: 'a', expression: '{{x}}' } }
  const multiNode = { id: 'n2', type: 'set_variable', label: 'Many', position: { x: 220, y: 300 }, config: { assignments: [{ name: 'b', expression: '1' }, { name: 'c', expression: '{{=b + 1}}' }] } }
  const workflow = {
    id: '33333333-3333-4333-8333-333333333333', name: 'Vars', trigger_type: 'manual',
    nodes: [TRIGGER, legacyNode, multiNode],
    edges: [{ id: 'e1', source: 't1', target: 'n1' }, { id: 'e2', source: 'n1', target: 'n2' }],
  }

  it('round-trips both shapes through export and import unchanged', () => {
    const exported = JSON.parse(JSON.stringify(scrubSecretsForExport(workflow)))
    const imported = normalizeScaffoldWorkflow(remapKnownIds(exported, createEmptyAssetIdMaps()))
    expect(imported.nodes.find((n: any) => n.id === 'n1').config).toEqual(legacyNode.config)
    expect(imported.nodes.find((n: any) => n.id === 'n2').config).toEqual(multiNode.config)
  })

  it('normalises row aliases on import and plans an untouched export as unchanged', () => {
    const aliased = normalizeScaffoldWorkflow({ ...workflow, nodes: [TRIGGER, { ...multiNode, config: { assignments: [{ variable: 'b', value: 1 }, { name: 'c', expression: '{{=b + 1}}' }] } }] })
    expect(aliased.nodes[1].config).toEqual({ assignments: [{ name: 'b', expression: '1' }, { name: 'c', expression: '{{=b + 1}}' }] })

    const ids = createEmptyAssetIdMaps()
    ids.workflow[workflow.id] = workflow.id
    const plan = planManifest({ incoming: { workflows: [workflow] }, current: { workflows: [workflow] }, idSeed: ids })
    expect(plan.assets[0]).toMatchObject({ action: 'unchanged' })
  })
})
