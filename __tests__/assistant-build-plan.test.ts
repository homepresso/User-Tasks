/**
 * Building with the Agent: the workflow self-check (validator adapter + the
 * wiring checks, one automatic correction round, remaining warnings on the
 * card) and the solution builder (one plan card, dependency order, real ids
 * substituted, permission-filtered items, stop on failure, resume).
 */
import { describe, expect, it, vi } from 'vitest'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { designerTools, draftOnlyArgs, SELF_CHECK_PREFIX } from '@/lib/assistants/tools/designer'
import { draftFromArgs, workflowWarnings } from '@/lib/assistants/workflow-check'
import { buildPlanTools, normalizePlan, orderPlan, skippedItems, substituteRefs, MAX_PLAN_ITEMS } from '@/lib/assistants/tools/build-plan'
import { assistantInstructions, WIRING_GUIDE } from '@/lib/assistants/prompts'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const conn = { provider: 'openai' as const, model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' }
function provider(...replies: Array<{ content?: string | null; tool_calls?: any[] }>) {
  const bodies: any[] = []
  const fetchImpl = vi.fn(async (_u: any, init: any) => {
    bodies.push(JSON.parse(init.body))
    const msg = replies[Math.min(bodies.length - 1, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies }
}
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

const MISWIRED = {
  name: 'Temporary employee onboarding', trigger_type: 'form_submitted',
  nodes: [
    { id: 't', type: 'form_submitted', label: 'Form submitted', config: { form_id: 'f1', form_name: 'Temp', fields: [{ key: 'full_name' }, { key: 'department' }] } },
    { id: 'ins', type: 'update_data_table', label: 'Insert row', config: { table_id: 'tb', operation: 'insert', column_values: { name: '{{full_name}}' }, output_var: 'temp_row_id' } },
    { id: 'ap', type: 'user_task', label: 'Approve', config: { task_title: 'Approve {{form.full_name}}', outcomes: ['Approve'], assignment_type: 'individual', assignee_id: 'u1', fields: [{ key: 'approver_comment', type: 'text', label: 'Comment' }] } },
    { id: 'up', type: 'update_data_table', label: 'Update row', config: { table_id: 'tb', operation: 'update', row_id: '{{temp_row_id}}', column_values: { note: '{{approver_comment}}' } } },
  ],
  edges: [{ source: 't', target: 'ins' }, { source: 'ins', target: 'ap' }, { source: 'ap', target: 'up', label: 'Approve' }],
}
const FIXED = {
  ...MISWIRED,
  nodes: [
    MISWIRED.nodes[0],
    { ...MISWIRED.nodes[1], config: { table_id: 'tb', operation: 'insert', column_values: { name: '{{form.full_name}}' }, output_row_id_var: 'temp_row_id' } },
    MISWIRED.nodes[2],
    { ...MISWIRED.nodes[3], config: { table_id: 'tb', operation: 'update', row_id: '{{temp_row_id}}', column_values: { note: '{{task_data.approver_comment}}' } } },
  ],
}

describe('workflow self-check', () => {
  it('finds the production wiring mistakes: bare form fields, output_var on insert, bare task fields', () => {
    const w = workflowWarnings(draftFromArgs(MISWIRED)!)
    const text = w.join('\n')
    expect(text).toMatch(/\{\{full_name\}\}.*\{\{form\.full_name\}\}/)
    expect(text).toMatch(/output_var.*output_row_id_var/)
    expect(text).toMatch(/\{\{approver_comment\}\}/)
    expect(workflowWarnings(draftFromArgs(FIXED)!)).toEqual([])
  })

  it('per-step task outputs ({{<prefix>_task_data.x}}) count as set; read-only task fields without a value are flagged', () => {
    const nodes = [
      FIXED.nodes[0],
      { id: 'hr', type: 'user_task', label: 'HR approval', config: { task_title: 'x', outcomes: ['OK'], assignment_type: 'individual', assignee_id: 'u', fields: [{ key: 'full_name', type: 'text', label: 'Name', read_only: true }, { key: 'approver_comment', type: 'text', label: 'Comment' }] } },
      { id: 'mail', type: 'send_email', label: 'Mail', config: { to: '{{submitted_by_email}}', subject: '{{hr_approval_outcome}}', body: '{{hr_approval_task_data.approver_comment}}' } },
    ]
    const edges = [{ source: 't', target: 'hr' }, { source: 'hr', target: 'mail', label: 'OK' }]
    const w = workflowWarnings({ nodes: nodes as any, edges, triggerType: 'form_submitted', userVariables: [] })
    expect(w.join('\n')).not.toMatch(/hr_approval/)
    expect(w.join('\n')).toMatch(/full_name/)
    expect(w.join('\n')).toMatch(/field_values|prefill|read-only/i)
    const prefilled = nodes.map((n) => (n.id === 'hr' ? { ...n, config: { ...n.config, field_values: { full_name: '{{form.full_name}}' } } } : n))
    expect(workflowWarnings({ nodes: prefilled as any, edges, triggerType: 'form_submitted', userVariables: [] }).join('\n')).not.toMatch(/full_name/)
  })

  it('goes through the workflow validator (its errors and any warnings it returns are included)', () => {
    const validate = vi.fn(() => ({ valid: false, totalErrors: 1, nodeErrors: [{ nodeId: 'x', nodeLabel: 'Approve', errors: ['Assign the task'] }], warnings: ['Approve: outcome "Decline" has no edge'] })) as any
    const w = workflowWarnings(draftFromArgs(FIXED)!, validate, null)
    expect(validate).toHaveBeenCalled()
    expect(w).toEqual(expect.arrayContaining(['Approve: Assign the task', 'Approve: outcome "Decline" has no edge']))
  })

  it('a miswired draft gets ONE correction round; the corrected second attempt shows a clean card', async () => {
    const server = { getHandler: () => vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ workflow: { id: 'w9', name: 'x' } }) }] })) }
    const tools = designerTools({ server: server as any, permissions: new Set(['workflows.view', 'workflows.create', 'workflows.edit']) })
    const p = provider(
      { content: null, tool_calls: [call('a1', 'workflows_create', MISWIRED)] },
      { content: null, tool_calls: [call('a2', 'workflows_create', FIXED)] },
    )
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'build onboarding' }], tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    // The model saw the self-check feedback after its first attempt…
    expect(JSON.stringify(p.bodies[1].messages)).toContain(SELF_CHECK_PREFIX)
    expect(JSON.stringify(p.bodies[1].messages)).toContain('{{form.full_name}}')
    // …and the card is for the corrected workflow, with no wiring warnings left.
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card.tool_call_id).toBe('a2')
    expect(card.warnings.join(' ')).not.toMatch(/wiring/)
  })

  it('warnings still left after the round are shown on the card ("N possible wiring issues")', async () => {
    const server = { getHandler: () => vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] })) }
    const tools = designerTools({ server: server as any, permissions: new Set(['workflows.view', 'workflows.create']), checkWorkflow: () => ['Approve: {{x}} is not set by any step', 'Save: set table_id'] })
    const p = provider({ content: null, tool_calls: [call('a1', 'workflows_create', FIXED)] }, { content: null, tool_calls: [call('a2', 'workflows_create', FIXED)] })
    const events: AssistantEvent[] = []
    await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'go' }], tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect((events.find((e) => e.type === 'confirm') as any).card.warnings[0]).toMatch(/^2 possible wiring issues/)
  })

  it('the wiring guide is in the builder instructions (form.<key>, task_data, output_row_id_var, linking forms)', () => {
    const i = assistantInstructions({ groups: ['designer'], canBuild: true })
    expect(i).toContain(WIRING_GUIDE)
    for (const s of ['{{form.<key>}}', '{{task_data.<key>}}', 'output_row_id_var', 'config.form_id', '{{submission.reference}}']) expect(WIRING_GUIDE).toContain(s)
    expect(assistantInstructions({ groups: ['designer'], canBuild: false })).not.toContain('Wiring guide')
  })
})

/* ── Solution builder ── */

const PLAN = [
  { key: 'workflow', kind: 'workflow', name: 'Leave request', summary: '3 steps', args: { trigger_type: 'form_submitted', nodes: [
    { id: 't', type: 'form_submitted', label: 'Submitted', config: { form_id: '{{ref:start_form.id}}', form_name: '{{ref:start_form.name}}' } },
    { id: 'a', type: 'user_task', label: 'Manager approves', config: { task_title: 'Approve', outcomes: ['Approve'], form_id: '{{ref:approval_form.id}}' } },
    { id: 'r', type: 'update_data_table', label: 'HR records', config: { table_id: '{{ref:table.id}}', operation: 'insert', column_values: { status: '{{outcome}}' }, output_row_id_var: 'leave_row' } },
  ] } },
  { key: 'approval_form', kind: 'form', name: 'Leave approval', args: { fields: [{ key: 'comment', label: 'Comment', type: 'textarea' }] } },
  { key: 'start_form', kind: 'form', name: 'Leave request', args: { fields: [{ key: 'start', label: 'Start', type: 'date' }] } },
  { key: 'table', kind: 'data_table', name: 'Leave records', args: { columns: [{ name: 'Status', type: 'text' }] } },
]
const ALL = new Set(['data_tables_create', 'forms_create', 'workflows_create', 'decision_tables_create'])

function fakeCalls(failOn?: string) {
  let n = 0
  const calls: Array<{ tool: string; args: any }> = []
  const fn = vi.fn(async (tool: string, args: any) => {
    calls.push({ tool, args })
    if (failOn && args.name === failOn) return { error: 'Name already taken' }
    n++
    const id = `id-${n}`
    return tool === 'forms_create' ? { form: { id, name: args.name } } : tool === 'workflows_create' ? { workflow: { id, name: args.name } } : { created: true, table: { id, name: args.name } }
  })
  return { fn, calls }
}
const env = (events: AssistantEvent[]) => ({ emit: (e: AssistantEvent) => events.push(e), toolCallId: 'p1' })

describe('solution builder', () => {
  it('dependency order: tables → forms → decision tables → workflows (and refs)', () => {
    expect(orderPlan(normalizePlan(PLAN)).map((i) => i.key)).toEqual(['table', 'approval_form', 'start_form', 'workflow'])
    expect(() => normalizePlan([{ key: 'a', kind: 'form', name: 'A', args: { x: '{{ref:nope.id}}' } }])).toThrow(/not in the plan/)
    expect(() => normalizePlan(Array.from({ length: MAX_PLAN_ITEMS + 1 }, (_, i) => ({ key: `k${i}`, kind: 'form', name: `F${i}`, args: {} })))).toThrow(/at most 15/)
    expect(substituteRefs({ a: 'x {{ref:k.id}}', b: ['{{ref:k.name}}'] }, { k: { id: '7', name: 'K' } })).toEqual({ a: 'x 7', b: ['K'] })
  })

  it('the plan card lists every item in order with its links; Build all', async () => {
    const tools = buildPlanTools({ call: vi.fn(), allowedTools: ALL, draftOnly: draftOnlyArgs })
    const card = await tools[0].confirm!({ title: 'Leave request process', items: PLAN })
    expect(card.title).toBe('Build plan: Leave request process')
    expect(card.confirm_label).toBe('Build all')
    expect(card.preview!.rows.map((r) => r[2])).toEqual(['Leave records', 'Leave approval', 'Leave request', 'Leave request'])
    expect(card.preview!.rows[3][3]).toContain('uses “Leave request”, “Leave approval”, “Leave records”')
  })

  it('Build all creates in order and wires the real ids (form_submitted form_id, user_task form_id, table_id)', async () => {
    const { fn, calls } = fakeCalls()
    const tools = buildPlanTools({ call: fn, allowedTools: ALL, draftOnly: draftOnlyArgs })
    const events: AssistantEvent[] = []
    const { result } = await tools[0].run({ items: PLAN }, env(events)) as any
    expect(result.status).toBe('completed')
    expect(calls.map((c) => c.tool)).toEqual(['data_tables_create', 'forms_create', 'forms_create', 'workflows_create'])
    const wf = calls[3].args
    expect(wf.is_active).toBe(false) // drafts only
    expect(wf.nodes[0].config).toEqual({ form_id: 'id-3', form_name: 'Leave request' })
    expect(wf.nodes[1].config.form_id).toBe('id-2')
    expect(wf.nodes[2].config.table_id).toBe('id-1')
    expect(events.filter((e) => e.type === 'changed').map((e: any) => e.href)).toEqual(['/data/id-1', '/automations/forms?open=id-2', '/automations/forms?open=id-3', '/automations/id-4'])
  })

  it('stops on failure with a summary of what was created and what is left; resumes with build_plan_continue', async () => {
    const { fn } = fakeCalls('Leave request')
    const tools = buildPlanTools({ call: fn, allowedTools: ALL, draftOnly: draftOnlyArgs })
    const { result } = await tools[0].run({ items: PLAN }, env([])) as any
    expect(result.status).toBe('failed')
    expect(result.failed).toMatchObject({ key: 'start_form', error: 'Name already taken' })
    expect(result.created.map((c: any) => c.key)).toEqual(['table', 'approval_form'])
    expect(result.remaining).toEqual(['start_form', 'workflow'])
    // Fixed name, continue: only the rest is created, using the earlier ids.
    const fixed = PLAN.map((p) => (p.key === 'start_form' ? { ...p, name: 'Leave request form', args: { ...p.args, name: 'Leave request form' } } : p))
    const card = await tools[1].confirm!({ items: fixed, created: result.created })
    expect(card.preview!.rows.filter((r) => r[3] === '✓ already built')).toHaveLength(2)
    const second = fakeCalls()
    const tools2 = buildPlanTools({ call: second.fn, allowedTools: ALL, draftOnly: draftOnlyArgs })
    const resumed = (await tools2[1].run({ items: fixed, created: result.created }, env([])) as any).result
    expect(resumed.status).toBe('completed')
    expect(second.calls.map((c) => c.tool)).toEqual(['forms_create', 'workflows_create'])
    expect(second.calls[1].args.nodes[2].config.table_id).toBe('id-1') // from the first request
  })

  it('pauses before the time budget and can continue (interrupted build)', async () => {
    let t = 0
    const { fn } = fakeCalls()
    const tools = buildPlanTools({ call: async (a, b) => { t += 100_000; return fn(a, b) }, allowedTools: ALL, draftOnly: draftOnlyArgs, now: () => t })
    const { result } = await tools[0].run({ items: PLAN }, env([])) as any
    expect(result.status).toBe('paused')
    expect(result.created.length).toBeGreaterThan(0)
    expect(result.remaining.length).toBeGreaterThan(0)
  })

  it('permission filtering: items the person cannot create are skipped with their dependants, and the card says so', async () => {
    const noTables = new Set(['forms_create', 'workflows_create'])
    const skipped = skippedItems(normalizePlan(PLAN), noTables)
    expect([...skipped.keys()].sort()).toEqual(['table', 'workflow'])
    const tools = buildPlanTools({ call: vi.fn(), allowedTools: noTables, draftOnly: draftOnlyArgs })
    const card = await tools[0].confirm!({ items: PLAN })
    expect(card.warnings.join(' ')).toMatch(/“Leave records” is skipped: you can't create data tables — ask an admin/)
    await expect(buildPlanTools({ call: vi.fn(), allowedTools: new Set(), draftOnly: draftOnlyArgs })[0].confirm!({ items: PLAN })).rejects.toThrow(/Nothing in this plan/)
  })

  it('the plan is one confirmation in the turn (write tool) and nothing runs before it', async () => {
    const { fn, calls } = fakeCalls()
    const tools = buildPlanTools({ call: fn, allowedTools: ALL, draftOnly: draftOnlyArgs }) as AssistantToolDef[]
    const p = provider({ content: null, tool_calls: [call('b1', 'build_plan', { title: 'Leave', items: PLAN })] })
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'build it' }] as ChatMessage[], tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    expect(calls).toEqual([])
    expect((events.find((e) => e.type === 'confirm') as any).card.preview.caption).toBe('Build plan')
  })
})
