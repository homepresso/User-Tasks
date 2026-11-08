/**
 * Natural config shapes people and LLMs write (issue #10): the engine reads
 * them at run time and the portability normaliser (imports, MCP) rewrites
 * them to the canonical shapes. Also: the "manual" start node is a known
 * no-op trigger, not an unknown node type.
 */
import { describe, expect, it } from 'vitest'
import {
  calculateDelay, canonicalDelay, formatDatePattern, handleDateMath, handleFormatDate,
  handleJsonBuildArray, handleModifyString, canonicalDataFilterOperator, DATA_FILTER_OPERATORS,
} from '@/lib/workflow-node-handlers'
import { canonicalizeNodeConfigShapes, normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import { __testing } from '@/lib/workflow-engine'

const ctx = (variables: Record<string, unknown> = {}) => ({ variables, liveBindings: {} }) as any

describe('engine accepts the aliases', () => {
  it('modify_string upper / lower', () => {
    expect(handleModifyString({ input: 'Ada', operation: 'upper' }, ctx()).result).toBe('ADA')
    expect(handleModifyString({ input: 'Ada', operation: 'lower' }, ctx()).result).toBe('ada')
    expect(handleModifyString({ input: 'Ada', operation: 'uppercase' }, ctx()).result).toBe('ADA')
  })

  it('json_build_array with plain values', () => {
    const c = ctx({ tier: 'gold' })
    const out = handleJsonBuildArray({ items: ['apple', '{{tier}}', 3, { value: 'x' }], output_var: 'arr' }, c)
    expect(out.count).toBe(4)
    expect(c.variables.arr).toEqual(['apple', 'gold', 3, 'x'])
  })

  it('delay { seconds }', () => {
    const d = canonicalDelay({ seconds: '1' })
    expect(calculateDelay(d.duration, d.unit)).toBe(1000)
    expect(canonicalDelay({ duration: 2, unit: 'minutes', seconds: 9 })).toEqual({ duration: 2, unit: 'minutes' })
  })

  it('format_date with input and a pattern in format', () => {
    const r = handleFormatDate({ input: '2026-03-04T12:00:00', format: 'YYYY-MM-DD' }, ctx())
    expect(r.result).toBe('2026-03-04')
    expect(r.format).toBe('custom')
    expect(handleFormatDate({ date: '2026-03-04T12:00:00', format: 'dddd, MMMM D, YYYY' }, ctx()).result).toBe('Wednesday, March 4, 2026')
    // Presets and the canonical custom shape are unchanged.
    expect(handleFormatDate({ date: '2026-03-04T12:00:00Z', format: 'iso' }, ctx()).result).toBe('2026-03-04T12:00:00.000Z')
    expect(handleFormatDate({ date: '2026-03-04T12:05:09', format: 'custom', custom_format: 'YYYY-MM-DD HH:mm:ss' }, ctx()).result).toBe('2026-03-04 12:05:09')
  })

  it('formatDatePattern keeps words and [literals]', () => {
    const d = new Date(2026, 0, 2, 15, 4, 0)
    expect(formatDatePattern(d, '[Due] D MMM YYYY, h:mm A')).toBe('Due 2 Jan 2026, 3:04 PM')
    expect(formatDatePattern(d, 'Due D')).toBe('Due 2')
  })

  it('date_math with input', () => {
    const r = handleDateMath({ input: '2026-01-01T00:00:00Z', operation: 'add', amount: 7, unit: 'days' }, ctx())
    expect(r.result).toBe('2026-01-08T00:00:00.000Z')
  })
})

describe('normaliser rewrites them to canonical shapes', () => {
  it('rewrites each alias', () => {
    expect(canonicalizeNodeConfigShapes('json_build_array', { items: ['a', 1] }).items).toEqual([{ value: 'a' }, { value: '1' }])
    expect(canonicalizeNodeConfigShapes('parallel', { branches: ['A', 'B'] }).branches).toEqual([{ label: 'A', order: 0 }, { label: 'B', order: 1 }])
    expect(canonicalizeNodeConfigShapes('modify_string', { operation: 'upper' }).operation).toBe('uppercase')
    expect(canonicalizeNodeConfigShapes('delay', { seconds: '1' })).toEqual({ duration: 1, unit: 'seconds' })
    expect(canonicalizeNodeConfigShapes('format_date', { input: '{{d}}', format: 'YYYY-MM-DD' }))
      .toEqual({ date: '{{d}}', format: 'custom', custom_format: 'YYYY-MM-DD' })
    expect(canonicalizeNodeConfigShapes('date_math', { input: '{{d}}', operation: 'add' })).toEqual({ date: '{{d}}', operation: 'add' })
  })

  it('leaves canonical configs alone', () => {
    const configs: Array<[string, Record<string, unknown>]> = [
      ['json_build_array', { items: [{ value: 'a' }], output_var: 'x' }],
      ['parallel', { mode: 'parallel', branches: [{ label: 'A', order: 0 }] }],
      ['modify_string', { operation: 'slug', input: 'x' }],
      ['delay', { duration: 5, unit: 'minutes' }],
      ['format_date', { date: 'x', format: 'custom', custom_format: 'YYYY' }],
      ['format_date', { date: 'x', format: 'datetime' }],
    ]
    for (const [type, config] of configs) expect(canonicalizeNodeConfigShapes(type, config)).toEqual(config)
  })

  it('applies inside normalizeScaffoldWorkflow (imports, MCP)', () => {
    const wf = normalizeScaffoldWorkflow({
      trigger_type: 'manual',
      nodes: [{ id: 'm', type: 'modify_string', label: 'M', config: { operation: 'lower', input: 'X' } }],
      edges: [],
    })
    expect(wf.nodes.find((n: any) => n.id === 'm').config.operation).toBe('lowercase')
  })
})

describe('manual start node', () => {
  function makeCtx() {
    const b: any = {
      update: () => b, eq: () => b, select: () => b, order: () => b, limit: () => b, in: () => b, insert: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (res: any) => Promise.resolve({ data: [], error: null }).then(res),
    }
    return {
      supabase: { from: () => b }, tenantId: 'tenant-1', taskId: null, variables: {}, liveBindings: {},
      nodeResults: {} as Record<string, any>, executedNodes: new Set<string>(), executionTrace: [], logs: [] as any[], onEvent: () => {},
    } as any
  }

  it('runs as a no-op trigger, not an unknown node type', async () => {
    const trigger = { id: 't', type: 'manual', label: 'Manual Trigger', position: { x: 0, y: 0 }, config: {} } as any
    const next = { id: 'n', type: 'set_variable', label: 'Set', position: { x: 0, y: 0 }, config: { name: 'v', expression: 'ok' } } as any
    const c = makeCtx()
    await __testing.executeNode(trigger, [trigger, next], [{ id: 'e', source: 't', target: 'n' }], c)
    expect(c.nodeResults.t.output).toMatchObject({ triggered: true })
    expect(c.nodeResults.t.output?.skipped).toBeUndefined()
    expect(c.variables.v).toBe('ok')
    expect(JSON.stringify(c.logs)).not.toContain('Unknown node type')
  })
})

describe('update_data_table aliases', () => {
  /** A recording Supabase stub: every builder call is logged; inserts return row-1. */
  function makeCtx(variables: Record<string, unknown> = {}) {
    const calls: Array<[string, ...unknown[]]> = []
    const b: any = {}
    for (const m of ['update', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'not', 'select', 'order', 'limit', 'range', 'in', 'insert']) {
      b[m] = (...args: unknown[]) => { calls.push([m, ...args]); return b }
    }
    b.maybeSingle = async () => ({ data: null, error: null })
    b.single = async () => ({ data: { id: 'row-1' }, error: null })
    b.then = (res: any) => Promise.resolve({ data: [], error: null }).then(res)
    const c = {
      supabase: { from: () => b, rpc: async () => ({ data: null, error: null }) }, tenantId: 'tenant-1', taskId: null, variables, liveBindings: {},
      nodeResults: {} as Record<string, any>, executedNodes: new Set<string>(), executionTrace: [], logs: [] as any[], onEvent: () => {},
    } as any
    return { c, calls }
  }
  const node = (config: Record<string, unknown>) => ({ id: 'd', type: 'update_data_table', label: 'Save row', position: { x: 0, y: 0 }, config }) as any

  it('insert: output_var names the row id variable', async () => {
    const { c } = makeCtx()
    const n = node({ table_id: 't1', operation: 'insert', column_values: { name: 'Ada' }, output_var: 'temp_row_id' })
    await __testing.executeNode(n, [n], [], c)
    expect(c.variables.temp_row_id).toBe('row-1')
  })

  it('insert: output_row_id_var wins over output_var', async () => {
    const { c } = makeCtx()
    const n = node({ table_id: 't1', operation: 'insert', column_values: { name: 'Ada' }, output_row_id_var: 'rid', output_var: 'other' })
    await __testing.executeNode(n, [n], [], c)
    expect(c.variables.rid).toBe('row-1')
    expect(c.variables.other).toBeUndefined()
  })

  it('list: "equals" / "==" / "contains" filters apply as eq / eq / ilike', async () => {
    const { c, calls } = makeCtx({ order_no: 'A-1' })
    const n = node({
      table_id: 't1', operation: 'list',
      filters: [
        { column: 'order_no', operator: 'equals', value: '{{order_no}}' },
        { column: 'tier', operator: '==', value: 'gold' },
        { column: 'name', operator: 'contains', value: 'ad' },
        { column: 'note', operator: 'Not_Equals', value: 'x' },
        { column: 'sku', operator: 'starts_with', value: 'AB' },
      ],
    })
    await __testing.executeNode(n, [n], [], c)
    expect(calls).toContainEqual(['eq', 'data->>order_no', 'A-1'])
    expect(calls).toContainEqual(['eq', 'data->>tier', 'gold'])
    expect(calls).toContainEqual(['ilike', 'data->>name', '%ad%'])
    expect(calls).toContainEqual(['neq', 'data->>note', 'x'])
    expect(calls).toContainEqual(['ilike', 'data->>sku', 'AB%'])
  })

  it('canonicalDataFilterOperator', () => {
    expect(canonicalDataFilterOperator('equals')).toBe('eq')
    expect(canonicalDataFilterOperator('EQ')).toBe('eq')
    expect(canonicalDataFilterOperator('!=')).toBe('neq')
    expect(canonicalDataFilterOperator('is_empty')).toBe('is_null')
    expect(canonicalDataFilterOperator('not_empty')).toBe('not_null')
    expect(canonicalDataFilterOperator('>=')).toBe('gte')
    expect(canonicalDataFilterOperator('bogus')).toBe('bogus')
    for (const op of DATA_FILTER_OPERATORS) expect(canonicalDataFilterOperator(op)).toBe(op)
  })

  it('the normaliser canonicalises output_var and filter operators', () => {
    expect(canonicalizeNodeConfigShapes('update_data_table', { operation: 'insert', output_var: 'temp_row_id' }))
      .toEqual({ operation: 'insert', output_row_id_var: 'temp_row_id' })
    expect(canonicalizeNodeConfigShapes('update_data_table', { output_var: 'a', output_row_id_var: 'b' }))
      .toEqual({ output_var: 'a', output_row_id_var: 'b' })
    expect(canonicalizeNodeConfigShapes('update_data_table', { operation: 'list', filters: [{ column: 'a', operator: 'equals', value: 1 }, { column: 'b', operator: 'lte', value: 2 }] }))
      .toEqual({ operation: 'list', filters: [{ column: 'a', operator: 'eq', value: 1 }, { column: 'b', operator: 'lte', value: 2 }] })
    // Other steps' output_var is untouched.
    expect(canonicalizeNodeConfigShapes('math', { expression: '1', output_var: 'x' })).toEqual({ expression: '1', output_var: 'x' })
  })
})
