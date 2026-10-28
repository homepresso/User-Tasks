import { describe, expect, it } from 'vitest'
import { inferSchema } from '@/lib/response-schema'
import { resolveExpression } from '@/lib/expression-resolver'
import { evaluateFunction } from '@/lib/expression-functions'
import {
  arrayStatus,
  buildDataTree,
  buildPickExpression,
  childItems,
  collectArrayCandidates,
  enclosingLoops,
  flattenTree,
  insertLoopBefore,
  listSchemaFor,
  matchableFields,
  rankArrayCandidates,
  rootItem,
  schemaForExpression,
  upstreamNodeIds,
  type PickerEdgeLike,
  type PickerNodeLike,
} from '@/lib/workflow-data-picker'

const sample = {
  total: 3,
  data: [
    { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', address: { city: 'Wellington' }, orders: [{ total: 10 }] },
    { id: 2, name: 'Grace Hopper', email: 'grace@example.com', address: { city: 'Auckland' }, orders: [] },
    { id: 3, name: 'Alan Turing', email: 'alan@example.com', address: { city: 'Dunedin' }, orders: [{ total: 7 }] },
  ],
}

function node(id: string, type: string, label: string, config: Record<string, any> = {}, y = 0): PickerNodeLike & { position: { x: number; y: number } } {
  return { id, type, label, config, position: { x: 200, y } }
}

const trigger = node('t', 'task_created', 'Task created')
const getCustomers = node('ref', 'call_reference', 'Get Customers', {
  reference_id: 'r1',
  _ref_response_schema: { version: 1, source: 'sample', root: inferSchema(sample) },
  _ref_outputs: [{ name: 'count', path: 'total', type: 'number' }, { name: 'rows', path: '[].id', type: 'number' }],
  output_mappings: { count: { enabled: true, variableName: 'ref_count' }, rows: { enabled: true, variableName: 'ignored_rows' } },
}, 100)
const firstName = node('set1', 'set_variable', 'First name', { name: 'first_name', expression: '{{get_customers_response.data.0.name}}' }, 200)
const loop = node('loop', 'loop', 'Each customer', { items: '{{get_customers_response.data}}' }, 300)
const inBody = node('body', 'set_variable', 'Email', { name: 'email', expression: '{{item.email}}' }, 400)
const innerLoop = node('loop2', 'loop', 'Each order', { items: '{{item.orders}}', item_var: 'order' }, 500)
const innerBody = node('body2', 'set_variable', 'Order total', { name: 'total', expression: '{{order.total}}' }, 600)
const after = node('after', 'log', 'Done', {}, 700)
const rowsQuery = node('rows', 'update_data_table', 'Query orders', { operation: 'list', _table_columns: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'qty', type: 'number' }] }, 150)
const unconnected = node('lonely', 'set_variable', 'Lonely', { name: 'x', expression: '1' }, 900)

const nodes = [trigger, getCustomers, rowsQuery, firstName, loop, inBody, innerLoop, innerBody, after, unconnected]
const edges: (PickerEdgeLike & { id: string })[] = [
  { id: 'e1', source: 't', target: 'ref' },
  { id: 'e2', source: 'ref', target: 'rows' },
  { id: 'e3', source: 'rows', target: 'set1' },
  { id: 'e4', source: 'set1', target: 'loop' },
  { id: 'e5', source: 'loop', target: 'body', label: 'Each Item' },
  { id: 'e6', source: 'body', target: 'loop2' },
  { id: 'e7', source: 'loop2', target: 'body2', label: 'Each Item' },
  { id: 'e8', source: 'loop', target: 'after', label: 'Done' },
]

const ctxVars = { get_customers_response: sample }
const resolve = (expr: string, extra: Record<string, unknown> = {}) => resolveExpression(expr, { variables: { ...ctxVars, ...extra } })

describe('scoping', () => {
  it('only upstream steps appear', () => {
    expect([...upstreamNodeIds('set1', edges)].sort()).toEqual(['ref', 'rows', 't'])
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'set1' })
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('Get Customers')
    expect(labels).toContain('Query orders')
    expect(labels).not.toContain('First name')
    expect(labels).not.toContain('Email')
    expect(groups.some((g) => g.kind === 'loop')).toBe(false)
  })

  it('an unconnected step sees no steps; with no current node everything shows', () => {
    expect(buildDataTree({ nodes, edges, currentNodeId: 'lonely' }).filter((g) => g.kind === 'step')).toHaveLength(0)
    expect(buildDataTree({ nodes, edges }).some((g) => g.label === 'Lonely')).toBe(true)
  })

  it('inside a loop body the current item appears with the item model', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'body' })
    expect(groups[0]).toMatchObject({ kind: 'loop', label: 'Current item' })
    const item = groups[0].roots.find((r) => r.path === 'item')!
    expect(item.schema?.type).toBe('object')
    expect(item.schema?.fields?.map((f) => f.name)).toContain('email')
    // After the loop's Done edge the item is gone.
    expect(buildDataTree({ nodes, edges, currentNodeId: 'after' }).some((g) => g.kind === 'loop')).toBe(false)
  })

  it('nested loops: inner item is Current item, outer item stays pickable', () => {
    expect(enclosingLoops('body2', nodes, edges).map((n) => n.id)).toEqual(['loop', 'loop2'])
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'body2' })
    expect(groups[0].label).toBe('Current item')
    expect(groups[0].roots[0]).toMatchObject({ path: 'order' })
    expect(groups[0].roots[0].schema?.fields?.map((f) => f.name)).toEqual(['total'])
    expect(groups[1].label).toBe('Outer loop item (Each customer)')
  })

  it('types set_variable outputs from their expression', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'loop' })
    const first = groups.find((g) => g.label === 'First name')!.roots[0]
    expect(first.schema?.type).toBe('string')
    expect(schemaForExpression('{{=SPLIT(a, ",")}}', [])?.type).toBe('array')
    expect(schemaForExpression('[1,2]', [])).toMatchObject({ type: 'array', items: { type: 'integer' } })
  })

  it('mapped outputs keep working and gain their model', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'set1' })
    const roots = groups.find((g) => g.label === 'Get Customers')!.roots
    expect(roots.map((r) => r.path)).toEqual(['get_customers_response', 'get_customers_status', 'ref_count'])
    expect(roots[2].schema?.type).toBe('integer')
  })
})

describe('tree items', () => {
  it('follows the response model levels: response › data[] › address › city', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'set1' })
    const group = groups.find((g) => g.label === 'Get Customers')!
    const response = rootItem(group, group.roots[0])
    const data = childItems(response).find((i) => i.label === 'data')!
    expect(data.schema.type).toBe('array')
    const address = childItems(data).find((i) => i.label === 'address')!
    expect(address.path).toBe('get_customers_response.data[].address')
    const city = childItems(address).find((i) => i.label === 'city')!
    expect(city.path).toBe('get_customers_response.data[].address.city')
    expect(flattenTree(groups).some((i) => i.path === 'get_customers_response.data[].orders[].total')).toBe(true)
  })
})

describe('picker choices → expressions the resolver evaluates', () => {
  const cityPath = 'get_customers_response.data[].address.city'
  const city = { type: 'string' as const }

  it('first item / index / list / count / pluck / find', () => {
    expect(buildPickExpression(cityPath, city, { kind: 'first' })).toBe('{{get_customers_response.data.0.address.city}}')
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'first' }))).toBe('Wellington')
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'index', index: 2 }))).toBe('Dunedin')
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'pluck' }))).toEqual(['Wellington', 'Auckland', 'Dunedin'])
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'count' }))).toBe(3)
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'list' }))).toEqual(sample.data)
    const find = buildPickExpression('get_customers_response.data[].email', city, { kind: 'find', field: 'name', value: 'Grace Hopper' })
    expect(find).toBe('{{=FIND_WHERE(get_customers_response.data, "name", "Grace Hopper", "email")}}')
    expect(resolve(find)).toBe('grace@example.com')
    expect(resolve(buildPickExpression('get_customers_response.data[].email', city, { kind: 'find', field: 'id', value: '3' }))).toBe('alan@example.com')
    expect(resolve(buildPickExpression('get_customers_response.data[].email', city, { kind: 'find', field: 'address.city', value: 'Auckland' }))).toBe('grace@example.com')
    // find with a variable as the value
    expect(resolve(buildPickExpression('get_customers_response.data[].name', city, { kind: 'find', field: 'id', value: '{{wanted}}' }), { wanted: 2 })).toBe('Grace Hopper')
  })

  it('choices on a list itself', () => {
    const list = { type: 'array' as const, items: { type: 'object' as const } }
    expect(buildPickExpression('get_customers_response.data', list, { kind: 'count' })).toBe('{{=COUNT(get_customers_response.data)}}')
    expect(resolve(buildPickExpression('get_customers_response.data', list, { kind: 'first' }))).toEqual(sample.data[0])
    expect(buildPickExpression('get_customers_response.data', list, { kind: 'value' })).toBe('{{get_customers_response.data}}')
  })

  it('loop choice inserts the item path; nested lists index outer lists at 0', () => {
    expect(buildPickExpression(cityPath, city, { kind: 'loop' })).toBe('{{item.address.city}}')
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'loop' }), { item: sample.data[1] })).toBe('Auckland')
    const total = 'get_customers_response.data[].orders[].total'
    expect(buildPickExpression(total, { type: 'integer' }, { kind: 'pluck' })).toBe('{{=PLUCK(get_customers_response.data.0.orders, "total")}}')
    expect(resolve(buildPickExpression(total, { type: 'integer' }, { kind: 'pluck' }))).toEqual([10])
    // Plain value inside a list reads the first item.
    expect(resolve(buildPickExpression(cityPath, city, { kind: 'value' }))).toBe('Wellington')
  })

  it('matchable fields and list model for Find', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'set1' })
    const list = listSchemaFor(cityPath, city, groups)!
    expect(list.type).toBe('array')
    expect(matchableFields(list.items)).toEqual(['id', 'name', 'email', 'address.city'])
  })

  it('bracket index paths resolve too', () => {
    expect(resolve('{{get_customers_response.data[1].name}}')).toBe('Grace Hopper')
    expect(resolve('Hi {{get_customers_response.data[2].address.city}}!')).toBe('Hi Dunedin!')
    expect(resolve('{{=COUNT(get_customers_response.data[0].orders)}}')).toBe(1)
    expect(resolve('{{=UPPER({{get_customers_response.data[0].name}})}}')).toBe('ADA LOVELACE')
  })

  it('FIND_WHERE / FILTER_WHERE / dotted PLUCK', () => {
    const scope = { rows: sample.data }
    expect(evaluateFunction('FIND_WHERE(rows, "id", 9)', scope)).toBeNull()
    expect(evaluateFunction('FIND_WHERE(rows, "id", 1)', scope)).toEqual(sample.data[0])
    expect(evaluateFunction('FILTER_WHERE(rows, "address.city", "Auckland")', scope)).toEqual([sample.data[1]])
    expect(evaluateFunction('PLUCK(rows, "address.city")', scope)).toEqual(['Wellington', 'Auckland', 'Dunedin'])
    expect(evaluateFunction('PLUCK(rows, "name")', scope)).toEqual(['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
    expect(evaluateFunction('FIND_WHERE(notalist, "id", 1)', scope)).toBeNull()
  })
})

describe('loop items autocomplete', () => {
  const candidates = () => collectArrayCandidates(buildDataTree({
    nodes,
    edges,
    currentNodeId: 'loop',
    workflowVariables: [{ name: 'ids', type: 'object', defaultValue: '[1,2,3]' }, { name: 'title', type: 'string' }],
  }))

  it('collects lists from reference models, data-table rows, set variables and workflow variables', () => {
    const list = candidates()
    const paths = list.map((c) => c.path)
    expect(paths).toContain('get_customers_response.data')
    expect(paths).toContain('rows')
    expect(paths).toContain('ids')
    expect(paths).not.toContain('title')
    expect(paths).not.toContain('get_customers_response.data.0.orders') // reached via Current item in a loop instead
    const data = list.find((c) => c.path === 'get_customers_response.data')!
    expect(data.group).toBe('Get Customers')
    expect(data.hint).toMatch(/list of objects · 5 fields/)
    expect(data.preview).toContain('ada@example.com')
    expect(data.expression).toBe('{{get_customers_response.data}}')
  })

  it('split/list outputs, http responses with a model, agents and custom steps', () => {
    const extra = [
      node('split', 'set_variable', 'Split', { name: 'parts', expression: '{{=SPLIT({{title}}, ",")}}' }),
      node('http', 'http_request', 'Fetch', { _response_schema: { root: { type: 'object', fields: [{ name: 'items', type: 'array', items: { type: 'string' } }] } } }),
      node('agent', 'run_agent', 'Agent', { _agent_outputs: [{ name: 'labels', type: 'array' }] }),
      node('custom', 'custom_activity', 'Custom', { manifest: { outputs: [{ name: 'results', type: 'array' }] } }),
      node('target', 'loop', 'Loop'),
    ]
    const extraEdges = [
      { source: 'split', target: 'http' }, { source: 'http', target: 'agent' }, { source: 'agent', target: 'custom' }, { source: 'custom', target: 'target' },
    ]
    const paths = collectArrayCandidates(buildDataTree({ nodes: extra, edges: extraEdges, currentNodeId: 'target' })).map((c) => c.path)
    expect(paths).toEqual(expect.arrayContaining(['parts', 'fetch_response.items', 'agent_labels', 'results']))
  })

  it('inside a loop the current item lists are candidates (nested loops)', () => {
    const list = collectArrayCandidates(buildDataTree({ nodes, edges, currentNodeId: 'loop2' }))
    expect(list[0]).toMatchObject({ path: 'item.orders', group: 'Current item' })
  })

  it('fuzzy ranking: segment prefix beats substring beats subsequence', () => {
    const list = candidates()
    expect(rankArrayCandidates('data', list)[0].path).toBe('get_customers_response.data')
    expect(rankArrayCandidates('row', list)[0].path).toBe('rows')
    expect(rankArrayCandidates('gcd', list)[0].path).toBe('get_customers_response.data')
    expect(rankArrayCandidates('zzz', list)).toHaveLength(0)
    expect(rankArrayCandidates('', list)).toEqual(list)
  })

  it('warns only when a value is known not to be a list', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'loop' })
    expect(arrayStatus('{{get_customers_response.data}}', groups)).toBe('array')
    expect(arrayStatus('{{get_customers_response.total}}', groups)).toBe('not-array')
    expect(arrayStatus('{{something_unknown}}', groups)).toBe('unknown')
    expect(arrayStatus('{{=SPLIT(first_name, " ")}}', groups)).toBe('array')
  })
})

describe('Loop through each item', () => {
  it('inserts a loop before the step, body = the step, after-steps continue from Done', () => {
    let n = 0
    const result = insertLoopBefore(
      [trigger, getCustomers, firstName, after],
      [{ id: 'a', source: 't', target: 'ref' }, { id: 'b', source: 'ref', target: 'set1' }, { id: 'c', source: 'set1', target: 'after' }],
      'set1',
      '{{get_customers_response.data}}',
      (x, y) => node('newloop', 'loop', 'Loop For Each', {}, y),
      () => `edge${++n}`,
    )!
    expect(result.loop.config.items).toBe('{{get_customers_response.data}}')
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'ref', target: 'newloop' }),
      expect.objectContaining({ source: 'newloop', target: 'after', label: 'Done' }),
      expect.objectContaining({ source: 'newloop', target: 'set1', label: 'Each Item' }),
    ]))
    const groups = buildDataTree({ nodes: result.nodes, edges: result.edges, currentNodeId: 'set1' })
    expect(groups[0].roots[0].schema?.fields?.some((f) => f.name === 'email')).toBe(true)
  })
})
