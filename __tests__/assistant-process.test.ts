/**
 * "What happens next?": the deterministic process walker (per outcome:
 * conditions in plain words, decision tables, parallel branches, loops,
 * assignees resolved to names), the run's own version, permission checks,
 * and the tool being offered on task / form / run screens.
 */
import { describe, expect, it, vi } from 'vitest'
import { describeProcess, describeStep, plainExpression } from '@/lib/assistants/process'
import { processContext } from '@/lib/assistants/tools/process'
import { runAssistantTurn } from '@/lib/assistants/engine'
import { parseChatRequest, prepareAssistantTurn } from '@/lib/assistants/chat'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const PRIYA = '11111111-1111-4111-8111-111111111111'
const ANDY = '22222222-2222-4222-8222-222222222222'
const FIN = '33333333-3333-4333-8333-333333333333'
const TBL = '44444444-4444-4444-8444-444444444444'
const DT = '55555555-5555-4555-8555-555555555555'
const NODES = [
  { id: 'start', type: 'form_submitted', label: 'Request submitted', config: { form_id: 'f1' } },
  { id: 'mgr', type: 'user_task', label: 'Manager approval', config: { outcomes: ['Approve', 'Decline'], assignment_type: 'individual', assignee_variable: '{{submitted_by_manager_id}}', due_offset_amount: 2, due_offset_unit: 'days', api_key: 'sk-SECRET' } },
  { id: 'amt', type: 'condition', label: 'Over limit?', config: { branches: [{ label: 'Large', logic: 'and', rules: [{ field: '{{form.amount}}', operator: 'greater_than', value: '5000' }] }], has_else: true } },
  { id: 'cfo', type: 'user_task', label: 'CFO approval', config: { outcomes: ['Approve', 'Decline'], assignment_type: 'individual', assignee_id: PRIYA } },
  { id: 'par', type: 'parallel', label: 'Finish', config: { branches: [{ label: 'Record' }, { label: 'Tell finance' }] } },
  { id: 'rec', type: 'update_data_table', label: 'Record', config: { table_id: TBL, operation: 'insert' } },
  { id: 'fin', type: 'user_task', label: 'Raise PO', config: { outcomes: ['Done'], assignment_type: 'team', team_id: FIN } },
  { id: 'policy', type: 'decision_table', label: 'Policy', config: { decision_table_id: DT } },
  { id: 'mail', type: 'send_email', label: 'Tell requester', config: { to: '{{submitted_by_email}}', subject: 'Your request was declined' } },
  { id: 'back', type: 'goto_activity', label: 'Rework', config: { target_node_label: 'Manager approval' } },
  { id: 'end', type: 'end_workflow', label: 'End', config: {} },
]
const EDGES = [
  { source: 'start', target: 'mgr' },
  { source: 'mgr', target: 'amt', label: 'Approve' },
  { source: 'mgr', target: 'mail', label: 'Decline' },
  { source: 'amt', target: 'cfo', label: 'Large' },
  { source: 'amt', target: 'par', label: 'Else' },
  { source: 'par', target: 'rec', label: 'Record' },
  { source: 'par', target: 'policy', label: 'Tell finance' },
  { source: 'policy', target: 'fin' },
  { source: 'mail', target: 'end' },
]
const names = {
  users: new Map([[PRIYA, 'Priya Shah'], [ANDY, 'Andy Hayes']]),
  teams: new Map([[FIN, 'Finance']]),
  tables: new Map([[TBL, 'Purchase requests']]),
  decisionTables: new Map([[DT, { name: 'Spend policy', rules: ['amount > 10000 → approver = CEO'] }]]),
}

describe('the process walker', () => {
  it('per outcome: conditions in plain words, the next human step and who it goes to; parallel branches; decision tables; emails', () => {
    const d = describeProcess({ workflow: { name: 'Purchase request', version: 3 }, nodes: NODES as any, edges: EDGES, currentNodeId: 'mgr', variables: { form: { amount: 7200 } }, names })
    expect(d.workflow).toBe('Purchase request (version 3)')
    expect(d.now).toMatch(/^Human step “Manager approval”/)
    const approve = d.next.find((n) => n.outcome === 'Approve')!.steps.join('\n')
    expect(approve).toContain("If the form's amount (7200) > 5000 (Large):")
    expect(approve).toContain('Human step “CFO approval”: assigned to Priya Shah')
    expect(approve).toContain('At the same time — Record:')
    expect(approve).toContain('Records it in “Purchase requests”')
    expect(approve).toContain('Checks the rules in “Spend policy”: amount > 10000 → approver = CEO')
    expect(approve).toContain('Human step “Raise PO”: assigned to the Finance team')
    const decline = d.next.find((n) => n.outcome === 'Decline')!.steps.join('\n')
    expect(decline).toContain('Emails the person who submitted it: “Your request was declined”')
    expect(decline).toContain('Ends')
  })

  it('resolves an assignee variable to a name from the run; loops are reported once; no raw secrets', () => {
    const step = describeStep(NODES[1] as any, names, { submitted_by_manager_id: ANDY })
    expect(step).toContain("assigned to Andy Hayes (the submitter's manager)")
    expect(step).not.toContain('sk-SECRET')
    const loop = describeProcess({ workflow: { name: 'L' }, nodes: [{ id: 'a', type: 'user_task', label: 'A', config: { outcomes: ['Again'] } }, { id: 'b', type: 'set_variable', label: 'B' }] as any, edges: [{ source: 'a', target: 'b', label: 'Again' }, { source: 'b', target: 'a' }], currentNodeId: 'a' })
    expect(loop.next[0].steps).toEqual(['Goes back to “A”'])
    expect(JSON.stringify(describeProcess({ workflow: { name: 'P' }, nodes: NODES as any, edges: EDGES, currentNodeId: 'mgr', names }))).not.toContain('sk-SECRET')
    expect(plainExpression('{{=IF(a > 1, 2, 3)}}')).toBe('a calculated value')
  })

  it('a start form: what happens after submit', () => {
    const d = describeProcess({ workflow: { name: 'P' }, nodes: NODES as any, edges: EDGES, fromStart: true, names })
    expect(d.next[0].outcome).toBe('After the form is submitted')
    expect(d.next[0].steps[0]).toMatch(/Manager approval/)
  })
})

/* ── Loading: the run's version, permission ── */

function db(tables: Record<string, any[]>, canView = true) {
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    let single = false
    const api: any = {
      select: () => api, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api },
      in: (c: string, v: any[]) => { filters.push((r) => v.includes(r[c])); return api },
      not: (c: string) => { filters.push((r) => r[c] != null); return api }, order: () => api, limit: () => api,
      maybeSingle: () => { single = true; return Promise.resolve(run()) },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    const run = () => { const list = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))); return { data: single ? list[0] ?? null : list, error: null } }
    return api
  }
  return { from, rpc: vi.fn(async () => ({ data: canView, error: null })) } as any
}
const T = 't1'
const tables = () => ({
  tasks: [{ id: 'task1', tenant_id: T, workflow_id: 'w1', workflow_step_id: 'mgr', workflow_run_id: 'run1' }, { id: 'old', tenant_id: T, workflow_run_id: 'run1', title: 'Submitted', completed_at: '2026-11-01T00:00:00Z', outcome: 'Submit', actioned_by: ANDY }],
  workflow_runs: [{ id: 'run1', tenant_id: T, workflow_id: 'w1', version_id: 'v3', variables: { submitted_by_manager_id: ANDY } }],
  workflows: [{ id: 'w1', tenant_id: T, name: 'Purchase request', nodes: [{ id: 'mgr', type: 'user_task', label: 'DRAFT ONLY' }], edges: [], published_version_id: 'v4' }],
  workflow_versions: [{ id: 'v3', version_number: 3, nodes: NODES, edges: EDGES }, { id: 'v4', version_number: 4, nodes: [], edges: [] }],
  users: [{ id: ANDY, display_name: 'Andy Hayes' }, { id: PRIYA, display_name: 'Priya Shah' }],
  teams: [{ id: FIN, tenant_id: T, name: 'Finance' }], custom_tables: [], decision_tables: [],
})

describe('process context loading', () => {
  it('uses the version the run executes (not the draft or a later published version) and the run\'s history', async () => {
    const out: any = await processContext({ db: db(tables()), tenantId: T, userId: 'me', permissions: new Set() }, { kind: 'task', taskId: 'task1' })
    expect(out.process.workflow).toBe('Purchase request (version 3)')
    expect(out.process.now).toContain("Andy Hayes (the submitter's manager)")
    expect(out.process.history[0]).toContain('Submitted → Submit by Andy Hayes')
    expect(JSON.stringify(out)).not.toContain('DRAFT ONLY')
  })
  it('refuses a run the person can\'t see; a form\'s workflow needs workflows.view', async () => {
    expect(await processContext({ db: db(tables(), false), tenantId: T, userId: 'me', permissions: new Set() }, { kind: 'task', taskId: 'task1' })).toEqual({ error: 'You can\'t see this process' })
    expect((await processContext({ db: db(tables()), tenantId: T, userId: 'me', permissions: new Set() }, { kind: 'form', formId: 'f1' }) as any).error).toMatch(/permission/)
  })
})

describe('offered on the right screens', () => {
  const ON = { tenant_id: T, provider: 'ollama', key_source: 'key', api_key: null, base_url: null, model: 'llama3.1', capabilities: { version: 2, enabled: true }, limits: {} }
  const ctx = (perms: string[]): ServiceContext => ({ tenantId: T, actorId: 'u1', permissions: new Set(perms), supabase: {} as any, authKind: 'session', source: 'ui' })
  const prep = (context: any, perms = ['forms.submit', 'workflows.view']) => prepareAssistantTurn(ctx(perms), parseChatRequest({ messages: [{ role: 'user', content: 'what happens next?' }], context }), { serviceDb: db({ assistant_settings: [ON], forms: [{ id: 'f1', tenant_id: T, layout: {} }] }), skipBurst: true })
  it('a form, a run page and an open workflow get get_process_context; a plain page does not', async () => {
    const has = async (c: any) => (await prep(c)).tools.some((t) => t.name === 'get_process_context')
    expect(await has({ form_id: 'f1', form: { fields: [] } })).toBe(true)
    expect(await has({ screen: { label: 'Run', path: '/automations/runs/0c8ba0c3-6cec-4f13-a73e-0097d95fe2fb' } })).toBe(true)
    expect(await has({ designer: { area: 'workflow', item_id: 'w1', item_name: 'P' } })).toBe(true)
    expect(await has({ screen: { label: 'Home', path: '/home' } })).toBe(false)
  }, 60_000)
})

describe('a conversation using it', () => {
  it('the model calls get_process_context and answers per outcome', async () => {
    const tool = { name: 'get_process_context', description: 'd', parameters: { type: 'object' }, mode: 'read' as const, label: () => 'Reading the process', run: vi.fn(async () => ({ result: { process: describeProcess({ workflow: { name: 'Purchase request' }, nodes: NODES as any, edges: EDGES, currentNodeId: 'mgr', variables: { form: { amount: 7200 } }, names }) } })) }
    const bodies: any[] = []
    const replies = [{ tool_calls: [{ id: 'p', type: 'function', function: { name: 'get_process_context', arguments: '{}' } }] }, { content: 'If you approve, it goes to Priya Shah (CFO) because the amount is over 5,000.' }]
    const fetchImpl = vi.fn(async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); const m: any = replies[bodies.length - 1]; return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls }, finish_reason: m.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 }) })
    const r = await runAssistantTurn({ connection: { provider: 'openai', model: 'm', url: 'https://x/v1/chat/completions', headers: {}, baseUrl: 'https://x' }, instructions: 'I', context: null, history: [{ role: 'user', content: 'what happens next?' }], tools: [tool], onEvent: () => {}, fetchImpl: fetchImpl as any })
    expect(r.status).toBe('completed')
    expect(JSON.stringify(bodies[1].messages)).toContain('CFO approval')
  })
})
