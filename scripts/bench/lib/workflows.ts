/**
 * Benchmark workflow definitions, (re)written by the seed and by the engine
 * suite so the graphs always match this file. Fixed ids keep runs comparable
 * across labels; each workflow gets a published version (the production path
 * loads the version, not the draft).
 */
import type { Client } from 'pg'

type Node = { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> }
type Edge = { id: string; source: string; target: string; label?: string }
type UserVar = { name: string; type: string; defaultValue: string }

export interface BenchWorkflow {
  key: string
  id: string
  versionId: string
  name: string
  triggerType: string
  isActive: boolean
  nodes: Node[]
  edges: Edge[]
  userVariables: UserVar[]
}

export interface WorkflowRefs {
  eventsTableId: string
  decisionTableId: string
  referenceId: string
}

const wfId = (n: number) => `0be00000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`
const verId = (n: number) => `0be00000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`

class Graph {
  nodes: Node[] = []
  edges: Edge[] = []
  private y = 0
  add(id: string, type: string, config: Record<string, unknown> = {}, label = type): string {
    this.nodes.push({ id, type, label, position: { x: 400, y: (this.y += 140) }, config })
    return id
  }
  link(source: string, target: string, label?: string): void {
    this.edges.push({ id: `e-${source}-${target}`, source, target, ...(label ? { label } : {}) })
  }
}

const numVar = (name: string): UserVar => ({ name, type: 'number', defaultValue: '0' })

/** Trigger + 49 nodes in a straight line (set_variable, math, text_template, condition, log). */
function linear50(): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  let prev = g.add('t', 'webhook_received')
  let prevLabel: string | undefined
  for (let i = 1; i <= 49; i++) {
    const id = `n${i}`
    switch (i % 5) {
      case 1: g.add(id, 'set_variable', { name: `v${i}`, expression: `{{=CONCAT("step-", ${i})}}` }); break
      case 2: g.add(id, 'math', { expression: '{{n}} + 1', output_var: 'n' }); break
      case 3: g.add(id, 'text_template', { template: `Step ${i} of {{workflow_name}}: {{=UPPER(v${i - 2})}} n={{n}}`, output_var: 'text' }); break
      case 4: g.add(id, 'condition', { branches: [{ label: 'Yes', logic: 'and', rules: [{ field: '{{n}}', operator: 'gte', value: '0' }] }], has_else: false }); break
      default: g.add(id, 'log', { message: `Checkpoint ${i}: n={{n}}` })
    }
    g.link(prev, id, prevLabel)
    prevLabel = i % 5 === 4 ? 'Yes' : undefined
    prev = id
  }
  return { nodes: g.nodes, edges: g.edges, userVariables: [numVar('n')] }
}

/** loop_n_times 500 → math + 2 expression-heavy set_variables + condition with two branches. */
function loop500(): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('loop', 'loop_n_times', { count: '500', index_var: 'i' })
  g.add('sum', 'math', { expression: '{{total}} + {{i}}', output_var: 'total' })
  g.add('label', 'set_variable', { name: 'label', expression: '{{=UPPER(CONCAT("item-", PAD_LEFT(i, 5, "0")))}}' })
  g.add('due', 'set_variable', { name: 'due', expression: '{{=FORMAT_DATE(ADD_DAYS(TODAY(), MOD(i, 30)), "YYYY-MM-DD")}}' })
  g.add('cond', 'condition', {
    branches: [{ label: 'High', logic: 'and', rules: [{ field: '{{i}}', operator: 'gte', value: '250' }, { field: '{{label}}', operator: 'contains', value: 'ITEM' }] }],
    has_else: true,
  })
  g.add('high', 'math', { expression: '{{high}} + 1', output_var: 'high' })
  g.add('low', 'math', { expression: '{{low}} + 1', output_var: 'low' })
  g.add('done', 'log', { message: 'total={{total}} high={{high}} low={{low}}' })
  g.link('t', 'loop')
  g.link('loop', 'sum', 'Each Item')
  g.link('sum', 'label')
  g.link('label', 'due')
  g.link('due', 'cond')
  g.link('cond', 'high', 'High')
  g.link('cond', 'low', 'Else')
  g.link('loop', 'done', 'Done')
  return { nodes: g.nodes, edges: g.edges, userVariables: [numVar('total'), numVar('high'), numVar('low')] }
}

/** loop_n_times 500 → insert a data-table row (fires the active data_table_event workflow). */
function dataTable500(refs: WorkflowRefs): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('loop', 'loop_n_times', { count: '500', index_var: 'i' })
  g.add('insert', 'update_data_table', {
    table_id: refs.eventsTableId,
    operation: 'insert',
    column_values: { name: '{{=CONCAT("event-", i)}}', amount: '{{=MOD(i, 97)}}', status: 'new' },
  })
  g.link('t', 'loop')
  g.link('loop', 'insert', 'Each Item')
  return { nodes: g.nodes, edges: g.edges, userVariables: [] }
}

/** The active data_table_event workflow the row inserts trigger (enqueued, not run inline). */
function onRowCreated(refs: WorkflowRefs): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'data_table_event', { table_id: refs.eventsTableId, event_types: ['created'] })
  g.add('flag', 'set_variable', { name: 'seen', expression: '{{=CONCAT("row-", row_id)}}' })
  g.link('t', 'flag')
  return { nodes: g.nodes, edges: g.edges, userVariables: [] }
}

/** loop_n_times 200 → set inputs → decision_table (one DB read per iteration today). */
function decision200(refs: WorkflowRefs): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('loop', 'loop_n_times', { count: '200', index_var: 'i' })
  g.add('amount', 'set_variable', { name: 'amount', expression: '{{=MOD(i, 1000)}}' })
  g.add('channel', 'set_variable', { name: 'channel', expression: '{{=IF(MOD(i, 2) = 1, "web", "store")}}' })
  g.add('rule', 'decision_table', { decision_table_id: refs.decisionTableId, input_mappings: { amount: '{{amount}}', channel: '{{channel}}' } })
  g.link('t', 'loop')
  g.link('loop', 'amount', 'Each Item')
  g.link('amount', 'channel')
  g.link('channel', 'rule')
  return { nodes: g.nodes, edges: g.edges, userVariables: [] }
}

/** loop_n_times 100 → call_reference against the local echo server. */
function callRef100(refs: WorkflowRefs): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('loop', 'loop_n_times', { count: '100', index_var: 'i' })
  g.add('call', 'call_reference', { reference_id: refs.referenceId, input_mappings: { q: '{{i}}' } })
  g.link('t', 'loop')
  g.link('loop', 'call', 'Each Item')
  return { nodes: g.nodes, edges: g.edges, userVariables: [] }
}

/** Small 5-node workflow the queue suite enqueues. */
function queueSmall(): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('a', 'set_variable', { name: 'greeting', expression: '{{=CONCAT("hello ", workflow_name)}}' })
  g.add('b', 'math', { expression: '{{n}} + 41', output_var: 'n' })
  g.add('c', 'condition', { branches: [{ label: 'Yes', logic: 'and', rules: [{ field: '{{n}}', operator: 'eq', value: '41' }] }], has_else: false })
  g.add('d', 'log', { message: '{{greeting}} n={{n}}' })
  g.link('t', 'a')
  g.link('a', 'b')
  g.link('b', 'c')
  g.link('c', 'd', 'Yes')
  return { nodes: g.nodes, edges: g.edges, userVariables: [numVar('n')] }
}

/** Correctness probe: a 45 s delay (> the 30 s inline cap). */
function delayProbe(): Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'> {
  const g = new Graph()
  g.add('t', 'webhook_received')
  g.add('wait', 'delay', { duration: '45', unit: 'seconds' })
  g.add('after', 'set_variable', { name: 'after', expression: '{{=NOW()}}' })
  g.link('t', 'wait')
  g.link('wait', 'after')
  return { nodes: g.nodes, edges: g.edges, userVariables: [] }
}

export function benchWorkflows(refs: WorkflowRefs): BenchWorkflow[] {
  const defs: Array<[string, string, string, boolean, Pick<BenchWorkflow, 'nodes' | 'edges' | 'userVariables'>]> = [
    ['linear50', 'Bench: 50-node linear', 'webhook_received', false, linear50()],
    ['loop500', 'Bench: 500-iteration loop', 'webhook_received', false, loop500()],
    ['dataTable500', 'Bench: 500 data-table writes', 'webhook_received', false, dataTable500(refs)],
    ['onRowCreated', 'Bench: on row created', 'data_table_event', true, onRowCreated(refs)],
    ['decision200', 'Bench: decision table x200', 'webhook_received', false, decision200(refs)],
    ['callRef100', 'Bench: call_reference x100', 'webhook_received', false, callRef100(refs)],
    ['queueSmall', 'Bench: queue job', 'webhook_received', false, queueSmall()],
    ['delayProbe', 'Bench: 45 s delay probe', 'webhook_received', false, delayProbe()],
  ]
  return defs.map(([key, name, triggerType, isActive, graph], i) => ({
    key, id: wfId(i + 1), versionId: verId(i + 1), name, triggerType, isActive, ...graph,
  }))
}

/** Upsert every bench workflow and its single published version. */
export async function ensureBenchWorkflows(db: Client, tenantId: string, ownerId: string, refs: WorkflowRefs): Promise<BenchWorkflow[]> {
  const workflows = benchWorkflows(refs)
  for (const wf of workflows) {
    const nodes = JSON.stringify(wf.nodes)
    const edges = JSON.stringify(wf.edges)
    const vars = JSON.stringify(wf.userVariables)
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, trigger_type, nodes, edges, user_variables, is_active, created_by, has_unpublished_changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, trigger_type = EXCLUDED.trigger_type, nodes = EXCLUDED.nodes,
         edges = EXCLUDED.edges, user_variables = EXCLUDED.user_variables, is_active = EXCLUDED.is_active, published_version_id = NULL`,
      [wf.id, tenantId, wf.name, wf.triggerType, nodes, edges, vars, wf.isActive, ownerId],
    )
    await db.query(
      `INSERT INTO public.workflow_versions (id, workflow_id, tenant_id, version_number, nodes, edges, user_variables, trigger_type, published_by)
       VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET nodes = EXCLUDED.nodes, edges = EXCLUDED.edges, user_variables = EXCLUDED.user_variables, trigger_type = EXCLUDED.trigger_type`,
      [wf.versionId, wf.id, tenantId, nodes, edges, vars, wf.triggerType, ownerId],
    )
    await db.query('UPDATE public.workflows SET published_version_id = $2 WHERE id = $1', [wf.id, wf.versionId])
  }
  return workflows
}
