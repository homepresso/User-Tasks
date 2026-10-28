/**
 * Form fields downstream in the workflow designer — every way a form feeds a
 * workflow (User Task fields designed inline, a linked reusable form with /
 * without / with a stale cache, the Form submitted trigger, the start form,
 * task triggers) shows up FIRST in the Data sidebar / Variables panel /
 * Insert data picker / `{{` autocomplete, labelled and typed (every field
 * type, lookups with their `_item`); plus drag-and-drop insertion, chips and
 * "Recently used". The engine test at the end checks the same paths resolve
 * at run time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import {
  buildDataTree, flattenTree, formFieldSuggestions, fuzzyScore, nodeFormFields, pathLabels, recentGroup,
  type PickerNodeLike,
} from '@/lib/workflow-data-picker'
import {
  DATA_DRAG_MIME, decodeDragPayload, encodeDragPayload, insertTokenAt, loopItemsFromDrop, pathsInExpression, tokenizeTemplate, withRecent,
} from '@/lib/workflow-data-drop'
import { executeWorkflow, resumeWorkflow } from '@/lib/workflow-engine'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- node configs / fake rows */

const TABLE = '0fa00000-0000-4000-8000-0000000000e1'
const FORM = '0fa00000-0000-4000-8000-0000000000d1'

/** One field of every value type, plus display-only fields that must not show. */
const ALL_FIELDS = [
  { key: 'section', label: 'Section', type: 'heading' },
  { key: 'name', label: 'Employee name', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'amount', label: 'Amount', type: 'currency', currency: 'NZD', default: '25' },
  { key: 'email', label: 'Work email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'site', label: 'Website', type: 'url' },
  { key: 'day', label: 'Day', type: 'date' },
  { key: 'at', label: 'Meeting time', type: 'datetime' },
  { key: 'urgent', label: 'Urgent', type: 'boolean' },
  { key: 'category', label: 'Category', type: 'choice', options: ['Travel', 'Meals'] },
  { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
  { key: 'owner', label: 'Owner', type: 'user' },
  { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: TABLE, search_columns: ['name'], display_columns: ['name'], value_column: 'id' } },
  { key: 'line', label: 'Divider', type: 'divider' },
]

const EXPECTED_TASK_DATA = [
  ['task_data.name', 'Employee name', 'string'],
  ['task_data.notes', 'Notes', 'string'],
  ['task_data.qty', 'Quantity', 'number'],
  ['task_data.amount', 'Amount', 'number'],
  ['task_data.email', 'Work email', 'string'],
  ['task_data.phone', 'Phone', 'string'],
  ['task_data.site', 'Website', 'string'],
  ['task_data.day', 'Day', 'string'],
  ['task_data.at', 'Meeting time', 'string'],
  ['task_data.urgent', 'Urgent', 'boolean'],
  ['task_data.category', 'Category', 'string'],
  ['task_data.tags', 'Tags', 'array'],
  ['task_data.owner', 'Owner', 'string'],
  ['task_data.customer', 'Customer', 'string'],
  ['task_data.customer_item', 'Customer (selected item)', 'object'],
]

const n = (id: string, type: string, label: string, config: Record<string, any> = {}, y = 0): PickerNodeLike & { position: { x: number; y: number } } =>
  ({ id, type, label, config, position: { x: 0, y } })

function chain(...nodes: PickerNodeLike[]) {
  return { nodes, edges: nodes.slice(1).map((node, i) => ({ source: nodes[i].id, target: node.id })) }
}

const shape = (roots: { path: string; label: string; schema: any }[]) => roots.map((r) => [r.path, r.label, r.schema?.type])

describe('1. User Task with fields designed inline (grid layout)', () => {
  const { nodes, edges } = chain(
    n('start', 'manual', 'Start'),
    n('ut', 'user_task', 'Approve expense', { fields: ALL_FIELDS, form_layout: { rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'amount', span: 1 }] }] } }, 100),
    n('sv', 'set_variable', 'Build summary', { name: 'summary', expression: '{{task_data.name}}' }, 200),
    n('log', 'log', 'Log', {}, 300),
  )

  it('lists every value field (every type, lookup _item) typed and labelled, in a group named after the step', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    const form = groups.find((g) => g.id === 'form:ut')!
    expect(form).toMatchObject({ kind: 'form', label: 'Approve expense › Form' })
    expect(shape(form.roots)).toEqual(EXPECTED_TASK_DATA)
    // Technical key as secondary text; type in the description; default as the example.
    const amount = form.roots.find((r) => r.path === 'task_data.amount')!
    expect(amount.hint).toBe('task_data.amount')
    expect(amount.description).toContain('Currency')
    expect(amount.schema?.example).toBe('25')
    // The lookup's selected item opens to its configured fields.
    const item = form.roots.find((r) => r.path === 'task_data.customer_item')!
    expect(item.schema?.fields?.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'id']))
  })

  it('form fields come before step outputs (promoted to the top)', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    expect(groups.map((g) => g.id)).toEqual(['form:ut', 'step:ut', 'step:sv'])
  })

  it('only downstream steps see them (not the task itself, not steps before it)', () => {
    expect(buildDataTree({ nodes, edges, currentNodeId: 'ut' }).some((g) => g.kind === 'form')).toBe(false)
    expect(buildDataTree({ nodes, edges, currentNodeId: 'sv' }).some((g) => g.id === 'form:ut')).toBe(true)
  })

  it('the `{{` autocomplete and chips get the labelled form fields', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    const suggestions = formFieldSuggestions(groups)
    expect(suggestions[0]).toEqual({ name: 'task_data.name', label: 'Employee name', group: 'Approve expense › Form' })
    expect(suggestions.map((s) => s.name)).toContain('task_data.customer_item')
    expect(pathLabels(groups).get('task_data.email')).toBe('Work email')
  })

  it('search matches labels as well as keys', () => {
    const items = flattenTree(buildDataTree({ nodes, edges, currentNodeId: 'log' }))
    const best = (query: string) => items
      .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.path), fuzzyScore(query, item.label) + 50) }))
      .filter((e) => e.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.item.path
    expect(best('work email')).toBe('task_data.email')
    expect(best('Meeting')).toBe('task_data.at')
    expect(best('task_data.qty')).toBe('task_data.qty')
  })
})

describe('2. User Task linked to a reusable form', () => {
  const linkedFields = [{ key: 'claim_no', label: 'Claim number', type: 'text' }, { key: 'total', label: 'Total', type: 'currency' }]
  const linked = (config: Record<string, any>) => chain(
    n('start', 'manual', 'Start'),
    n('ut', 'user_task', 'Fill in claim', { form_id: FORM, form_name: 'Expense claim', ...config }, 100),
    n('log', 'log', 'Log', {}, 200),
  )

  it('freshly linked (cached copy on the node) — after reload the cache is what is read', () => {
    const { nodes, edges } = linked({ fields: linkedFields, form_cached_version: 3 })
    const form = buildDataTree({ nodes, edges, currentNodeId: 'log' }).find((g) => g.kind === 'form')!
    expect(shape(form.roots)).toEqual([['task_data.claim_no', 'Claim number', 'string'], ['task_data.total', 'Total', 'number']])
  })

  it('cache missing (imported / installed workflow): the linked form fills it', () => {
    const { nodes, edges } = linked({})
    expect(buildDataTree({ nodes, edges, currentNodeId: 'log' }).some((g) => g.kind === 'form')).toBe(false)
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log', linkedForms: { [FORM]: { fields: linkedFields, version: 3 } } })
    expect(groups[0].roots.map((r) => r.path)).toEqual(['task_data.claim_no', 'task_data.total'])
  })

  it('the form got a new version: drafts follow the latest; a pinned (published) node keeps its copy', () => {
    const latest = { fields: [...linkedFields, { key: 'approver_note', label: 'Approver note', type: 'textarea' }], version: 4 }
    const stale = n('ut', 'user_task', 'x', { form_id: FORM, fields: linkedFields, form_cached_version: 3 })
    expect(nodeFormFields(stale, { [FORM]: latest }).map((f) => f.key)).toEqual(['claim_no', 'total', 'approver_note'])
    const current = n('ut', 'user_task', 'x', { form_id: FORM, fields: linkedFields, form_cached_version: 4 })
    expect(nodeFormFields(current, { [FORM]: latest }).map((f) => f.key)).toEqual(['claim_no', 'total'])
    const pinned = n('ut', 'user_task', 'x', { form_id: FORM, fields: linkedFields, form_cached_version: 3, form_version: 3 })
    expect(nodeFormFields(pinned, { [FORM]: latest }).map((f) => f.key)).toEqual(['claim_no', 'total'])
  })
})

describe('3. Form submitted trigger', () => {
  it('lists {{form.<key>}} labelled first, then who submitted it, then the whole object', () => {
    const { nodes, edges } = chain(
      n('t', 'form_submitted', 'Claim submitted', { form_id: FORM, form_name: 'Expense claim', fields: ALL_FIELDS }),
      n('log', 'log', 'Log', {}, 100),
    )
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    expect(groups[0]).toMatchObject({ kind: 'form', label: 'Form submitted › Expense claim' })
    const paths = groups[0].roots.map((r) => r.path)
    expect(paths.slice(0, EXPECTED_TASK_DATA.length)).toEqual(EXPECTED_TASK_DATA.map(([p]) => p.replace('task_data.', 'form.')))
    expect(paths).toEqual(expect.arrayContaining(['submitted_by_name', 'submitted_by_email', 'submitted_at', 'form_button', 'form']))
    expect(groups[0].roots.find((r) => r.path === 'submitted_by_name')!.label).toBe('Submitted by (name)')
    // Chips show field labels; submission metadata keeps its key.
    const labels = pathLabels(groups)
    expect(labels.get('form.email')).toBe('Work email')
    expect(labels.has('form_source')).toBe(false)
    expect(labels.has('form')).toBe(false)
  })

  it('a linked form with no cached fields is filled from the form', () => {
    const { nodes, edges } = chain(n('t', 'form_submitted', 'Claim submitted', { form_id: FORM }), n('log', 'log', 'Log', {}, 100))
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log', linkedForms: { [FORM]: { fields: [{ key: 'ref', label: 'Reference', type: 'text' }], version: 1 } } })
    expect(groups[0].roots[0]).toMatchObject({ path: 'form.ref', label: 'Reference' })
  })
})

describe('4. Workflow start form (inputs)', () => {
  it('lists the inputs labelled under "Start form", before User Task forms and steps', () => {
    const { nodes, edges } = chain(
      n('start', 'manual', 'Start', { start_form: { layout: { rows: [] } } }),
      n('ut', 'user_task', 'Review', { fields: [{ key: 'ok', label: 'OK', type: 'boolean' }] }, 100),
      n('log', 'log', 'Log', {}, 200),
    )
    const groups = buildDataTree({
      nodes, edges, currentNodeId: 'log',
      workflowVariables: [{ name: 'claimReference', type: 'string', label: 'Claim reference' }, { name: 'expected_amount', type: 'number' }],
    })
    expect(groups.map((g) => g.id)).toEqual(['workflow-variables', 'form:ut', 'step:ut'])
    expect(groups[0].label).toBe('Start form › Workflow inputs')
    expect(shape(groups[0].roots)).toEqual([['claimReference', 'Claim reference', 'string'], ['expected_amount', 'Expected amount', 'number']])
    expect(formFieldSuggestions(groups).map((s) => s.name)).toEqual(['claimReference', 'expected_amount', 'task_data.ok'])
  })
})

describe('5. Task triggers with a task form', () => {
  it('lists {{task.data.<key>}} labelled first, plus the whole object', () => {
    for (const type of ['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected']) {
      const { nodes, edges } = chain(n('t', type, 'Task event', { fields: ALL_FIELDS }), n('log', 'log', 'Log', {}, 100))
      const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
      expect(groups[0]).toMatchObject({ kind: 'form', label: 'Task event › Task form' })
      expect(shape(groups[0].roots).slice(0, EXPECTED_TASK_DATA.length)).toEqual(EXPECTED_TASK_DATA.map(([p, l, t]) => [p.replace('task_data.', 'task.data.'), l, t]))
      expect(groups[0].roots.at(-1)!.path).toBe('task.data')
    }
  })
})

describe('group order and Recently used', () => {
  it('loop item, trigger form, start form, task forms, steps, other trigger data', () => {
    const nodes = [
      n('t', 'task_submitted', 'Submitted', { fields: [{ key: 'po', label: 'PO', type: 'text' }] }),
      n('ut', 'user_task', 'Approve', { fields: [{ key: 'ok', label: 'OK', type: 'boolean' }] }, 100),
      n('rows', 'update_data_table', 'Rows', { operation: 'list', _table_columns: [{ key: 'name' }] }, 200),
      n('loop', 'loop', 'Each row', { items: '{{rows}}' }, 300),
      n('log', 'log', 'Log', {}, 400),
    ]
    const edges = [
      { source: 't', target: 'ut' }, { source: 'ut', target: 'rows' }, { source: 'rows', target: 'loop' }, { source: 'loop', target: 'log', label: 'Each Item' },
    ]
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log', workflowVariables: [{ name: 'x' }] })
    expect(groups.map((g) => g.kind)).toEqual(['loop', 'form', 'workflow', 'form', 'step', 'step'])
  })

  it('recent paths still pickable here, most recent first', () => {
    const { nodes, edges } = chain(n('ut', 'user_task', 'Approve', { fields: ALL_FIELDS }), n('log', 'log', 'Log', {}, 100))
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'log' })
    const recent = recentGroup(groups, ['task_data.email', 'gone.elsewhere', 'task_data.customer_item.name', 'task_data.email'])!
    expect(recent).toMatchObject({ id: 'recent', kind: 'recent', label: 'Recently used' })
    expect(recent.roots.map((r) => [r.path, r.label])).toEqual([['task_data.email', 'Work email'], ['task_data.customer_item.name', 'name']])
    expect(recentGroup(groups, [])).toBeNull()
    expect(withRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(withRecent(Array.from({ length: 12 }, (_, i) => `v${i}`), 'new')).toHaveLength(12)
    // Function wrappers are skipped; the variables inside them count (a picked "count of x" uses x).
    expect(pathsInExpression('{{task_data.a}} and {{=COUNT({{b}})}} {{=NOW()}} {{c.0.d}}')).toEqual(['task_data.a', 'b', 'c.0.d'])
  })
})

describe('drag and drop into inputs', () => {
  it('inserts at the drop caret; replaces an empty field; clamps', () => {
    expect(insertTokenAt('Hello  world', 6, '{{task_data.name}}')).toEqual({ value: 'Hello {{task_data.name}} world', caret: 24 })
    expect(insertTokenAt('', 5, '{{form.amount}}')).toEqual({ value: '{{form.amount}}', caret: 15 })
    expect(insertTokenAt('   ', 1, '{{x}}')).toEqual({ value: '{{x}}', caret: 5 })
    expect(insertTokenAt('abc', 99, '{{x}}').value).toBe('abc{{x}}')
    expect(insertTokenAt('abc', -3, '{{x}}').value).toBe('{{x}}abc')
    expect(insertTokenAt('abc', null, '{{x}}').value).toBe('abc{{x}}')
  })

  it('the drag payload round-trips; foreign drags are ignored', () => {
    expect(DATA_DRAG_MIME).toBe('application/x-usertasks-data')
    const payload = { path: 'rows[].name', label: 'name', type: 'string', needsChoices: true }
    expect(decodeDragPayload(encodeDragPayload(payload))).toEqual(payload)
    expect(decodeDragPayload('not json')).toBeNull()
    expect(decodeDragPayload(JSON.stringify({ label: 'no path' }))).toBeNull()
  })

  it('a list (or a field inside one) dropped on Loop items sets the list', () => {
    expect(loopItemsFromDrop({ path: 'get_customers_response.data', type: 'array' })).toBe('{{get_customers_response.data}}')
    expect(loopItemsFromDrop({ path: 'get_customers_response.data[].email', type: 'string' })).toBe('{{get_customers_response.data}}')
    expect(loopItemsFromDrop({ path: 'task_data.name', type: 'string' })).toBeNull()
  })

  it('chips: known paths carry their label (key kept for the value / hover), expressions stay as they are', () => {
    const labels = new Map([['task_data.email', 'Work email']])
    expect(tokenizeTemplate('To {{task_data.email}} re {{ outcome }} {{= UPPER(x) }}', labels)).toEqual([
      { type: 'text', value: 'To ' },
      { type: 'var', value: 'task_data.email', isExpression: false, label: 'Work email' },
      { type: 'text', value: ' re ' },
      { type: 'var', value: 'outcome', isExpression: false },
      { type: 'text', value: ' ' },
      { type: 'var', value: 'UPPER(x)', isExpression: true },
    ])
  })
})

// ─── Runtime: the same paths resolve downstream ────────────────────────

const TENANT = '0fa00000-0000-4000-8000-00000000000a'
const WF = '0fa00000-0000-4000-8000-0000000000a1'
const OWNER = '0fa00000-0000-4000-8000-0000000000b1'
const TASK = '0fa00000-0000-4000-8000-0000000000c1'

function seed(workflows: any[], tasks: any[] = []) {
  const fake = createFakeSupabase({ workflows, workflow_runs: [], workflow_queue: [], tasks })
  fake.rpcs.record_workflow_run = () => ({})
  createClientMock.mockImplementation(() => fake.client)
  return fake
}
const wf = (trigger: string, nodes: any[], extra: Record<string, unknown> = {}) => ({
  id: WF, tenant_id: TENANT, name: 'Form vars', is_active: true, trigger_type: trigger, run_count: 0,
  published_version_id: null, user_variables: [], created_by: OWNER,
  nodes, edges: nodes.slice(1).map((node, i) => ({ id: `e${i}`, source: nodes[i].id, target: node.id })),
  ...extra,
})

describe('runtime: downstream steps read the form values', () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('User Task (inline or linked form): {{task_data.<key>}} incl. lookup _item, next to start-form inputs', async () => {
    const fake = seed([wf('manual', [
      { id: 'start', type: 'manual', label: 'Start', config: {} },
      { id: 'ut', type: 'user_task', label: 'Approve', config: { fields: ALL_FIELDS } },
      { id: 'log', type: 'log', label: 'Log', config: { message: 'ref={{claimReference}} name={{task_data.name}} amount={{task_data.amount}} tags={{task_data.tags}} urgent={{task_data.urgent}} customer={{task_data.customer_item.name}}' } },
    ])])
    fake.tables.workflow_runs.push({
      id: 'run-paused', workflow_id: WF, tenant_id: TENANT, task_id: null, status: 'waiting_for_event', event_id: 'evt-ut',
      paused_node_id: 'ut', pause_variables: { claimReference: 'C-42' },
      version_id: null, trace_id: null, execution_trace: [], node_results: { start: { status: 'success' } },
    })
    const result = await resumeWorkflow('evt-ut', {
      outcome: 'Approved',
      task_data: { name: 'Ada', amount: 12.5, tags: ['a', 'b'], urgent: true, customer: 'c1', customer_item: { id: 'c1', name: 'Alfreds' } },
    }, undefined, { supabase: fake.client })
    expect(result.error).toBeUndefined()
    expect(result.node_results.log?.output?.logged).toBe('ref=C-42 name=Ada amount=12.5 tags=a,b urgent=true customer=Alfreds')
  })

  it('Form submitted trigger: {{form.<key>}} and the submitter', async () => {
    const fields = normalizeTaskFields(ALL_FIELDS)
    const fake = seed([wf('form_submitted', [
      { id: 't', type: 'form_submitted', label: 'Submitted', config: { form_id: FORM, fields: ALL_FIELDS } },
      { id: 'log', type: 'log', label: 'Log', config: { message: '{{submitted_by_name}}: {{form.name}} {{form.amount}} {{form.customer_item.name}}' } },
    ])])
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Expense claim', version: 2 }, fields,
      values: { name: 'Nancy', amount: 99, customer: 'c1', customer_item: { id: 'c1', name: 'Alfreds' } },
      submission: { id: 'sub-1', created_at: '2026-10-28T00:00:00Z', source: 'standalone' }, submitter: { id: OWNER, name: 'Nancy D' },
    })
    const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.error).toBeUndefined()
    expect(result.node_results.log?.output?.logged).toBe('Nancy D: Nancy 99 Alfreds')
  })

  it('Task trigger: {{task.data.<key>}} from the task\'s form values', async () => {
    const fake = seed([wf('task_submitted', [
      { id: 't', type: 'task_submitted', label: 'Submitted', config: { fields: [{ key: 'po', label: 'PO', type: 'text' }] } },
      { id: 'log', type: 'log', label: 'Log', config: { message: 'po={{task.data.po}}' } },
    ])], [{ id: TASK, tenant_id: TENANT, title: 'T', status: 'todo', metadata: { fields: [{ key: 'po', label: 'PO', type: 'text' }], template_values: { po: 'PO-9' } } }])
    const result = await executeWorkflow(WF, TASK, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.error).toBeUndefined()
    expect(result.node_results.log?.output?.logged).toBe('po=PO-9')
  })

  it('Start form inputs: {{<input>}}', async () => {
    const fake = seed([wf('manual', [
      { id: 'start', type: 'manual', label: 'Start', config: {} },
      { id: 'log', type: 'log', label: 'Log', config: { message: 'ref={{claimReference}} amt={{expected_amount}}' } },
    ], { user_variables: [{ id: 'v1', name: 'claimReference', type: 'string', defaultValue: '' }, { id: 'v2', name: 'expected_amount', type: 'number', defaultValue: '5' }] })])
    const result = await executeWorkflow(WF, undefined, false, { claimReference: 'C-7' }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.error).toBeUndefined()
    expect(result.node_results.log?.output?.logged).toBe('ref=C-7 amt=5')
  })
})
