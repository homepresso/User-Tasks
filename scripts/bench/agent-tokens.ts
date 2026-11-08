/**
 * Offline token benchmark for the in-app Agent (no network, no database).
 *
 *   npx tsx scripts/bench/agent-tokens.ts [--json]
 *
 * A mock LLM replays a scripted sequence of tool calls through the real turn
 * engine (lib/assistants/engine.ts), the real designer tool wrappers
 * (lib/assistants/tools/designer.ts), the real system prompt and the real
 * tool list. MCP handlers return realistic payloads from local data: the real
 * workflows_catalog, the stress workflows in test-workflows/, synthetic lists,
 * a decision table and create results. The mock reports prompt_tokens as
 * ceil(chars / 4) of what it was sent (messages + tools + system) and, for
 * native Anthropic requests, emulates prompt caching: the part of the request
 * that is byte-identical to the previous request's prefix is a cache read,
 * the rest after it a cache write.
 *
 * Scenarios:
 *  (a) the production case: catalog → data tables → workflows → check →
 *      decision table → workflows → 3 workflow reads → a final call
 *      (8 LLM calls, 9 tool calls);
 *  (b) a full build_plan of a 10-item process over three requests (look-ups +
 *      plan → confirm and build → a follow-up question);
 *  (a*) the steered version of (a) when workflow_node_reference exists:
 *      compact catalog + node reference, then build_plan.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { designerTools } from '@/lib/assistants/tools/designer'
import { assistantInstructions } from '@/lib/assistants/prompts'
import type { ChatMessage } from '@/lib/assistants/types'
import { registerWorkflowTools } from '@/lib/mcp/tools/workflows'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ROOT = join(__dirname, '..', '..')
const ALL_BUILD = ['workflows.view', 'workflows.create', 'workflows.edit', 'forms.view', 'forms.edit', 'data.view', 'data.create', 'data.edit_schema', 'data.manage_rows', 'extensibility.view', 'extensibility.create', 'extensibility.edit', 'reports.view', 'reports.create', 'decision_tables.view', 'decision_tables.create', 'decision_tables.edit']

/* ── Realistic tool payloads ── */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const workflowFile = (name: string) => JSON.parse(readFileSync(join(ROOT, 'test-workflows', name), 'utf8'))

function catalogPayload(): any {
  const handlers = new Map<string, (a: any) => Promise<any>>()
  registerWorkflowTools({ tool: (name: string, _d: string, _s: unknown, h: any) => handlers.set(name, h) } as any, { tenantId: 't', supabase: {}, scopes: {} } as any)
  return handlers.get('workflows_catalog')!({})
}

/** A workflow as workflows_get_definition returns it: the author payload, with the noise real ones carry (positions, cached form fields, sections). */
function definitionPayload(file: string, n: number) {
  const wf = workflowFile(file)
  const nodes = (wf.nodes ?? []).map((node: any, i: number) => (i === 0 ? { ...node, config: { ...node.config, fields: Array.from({ length: 8 }, (_, k) => ({ key: `field_${k}`, label: `Field ${k}`, type: 'text', required: k < 3, help_text: 'Shown under the field' })) } } : node))
  return { workflow_id: uuid(n), definition: { name: wf.name ?? file.replace('.json', ''), description: wf.description ?? 'A workflow', trigger_type: nodes[0]?.type ?? 'manual', trigger_config: {}, nodes, edges: wf.edges ?? [], user_variables: wf.user_variables ?? [], swimlanes: [], sections: wf.sections ?? [], tags: ['ops'] } }
}

const listOf = (key: string, count: number, extra: (i: number) => Record<string, unknown>) => ({ [key]: Array.from({ length: count }, (_, i) => ({ id: uuid(100 + i), name: `${key.replace(/s$/, '')} ${i + 1}`, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-20T10:00:00Z', ...extra(i) })), count })

const PAYLOADS: Record<string, (args: any) => any> = {
  data_tables_list: () => listOf('tables', 25, (i) => ({ slug: `table_${i}`, description: 'Records kept by the team for reporting', columns: Array.from({ length: 8 }, (_, k) => ({ key: `col_${k}`, name: `Column ${k}`, type: 'text' })) })),
  workflows_list: () => listOf('workflows', 30, (i) => ({ is_active: i % 3 === 0, trigger_type: 'form_submitted', run_count: i * 7, last_run_at: '2026-10-21T08:00:00Z' })),
  workflows_preflight: () => ({ ok: true, checks: Array.from({ length: 12 }, (_, i) => ({ ok: i % 4 !== 0, type: 'form', id: uuid(300 + i), source: `nodes[${i}].config.form_id`, message: i % 4 ? undefined : 'form was not found in this tenant', candidate_matches: i % 4 ? undefined : [{ id: uuid(400 + i), name: 'Patient intake' }] })), warnings: ['User Task “Review” has no outcomes'] }),
  decision_tables_get: () => ({ decision_table: { id: uuid(500), name: 'Triage priority', description: 'Priority from symptoms and age', inputs: [{ key: 'age', label: 'Age', type: 'number' }, { key: 'pain', label: 'Pain score', type: 'number' }, { key: 'fever', label: 'Fever', type: 'boolean' }], outputs: [{ key: 'priority', label: 'Priority', type: 'text' }, { key: 'wait_minutes', label: 'Max wait', type: 'number' }], rules: Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, enabled: true, description: `Rule ${i + 1}`, conditions: { age: { operator: 'gte', value: i * 5 }, pain: { operator: 'gte', value: i % 10 }, fever: { operator: 'equals', value: i % 2 === 0 } }, outputs: { priority: ['Low', 'Medium', 'High', 'Urgent'][i % 4], wait_minutes: 240 - i * 15 } })), version: 3, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' } }),
  workflows_get_definition: (args) => definitionPayload(({ [uuid(1)]: '14-multi-path-conditions.json', [uuid(2)]: '15-kitchen-sink-stress.json', [uuid(3)]: '16-ultimate-stress.json' } as Record<string, string>)[args.workflow_id] ?? '12-order-processing.json', 1),
}

let created = 0
function fakeServer(catalog: any) {
  return {
    getHandler: (name: string) => async (args: any) => {
      if (name === 'workflows_catalog') return catalog
      if (name.endsWith('_create')) {
        created++
        const kind = name.startsWith('data_tables') ? 'table' : name.startsWith('forms') ? 'form' : name.startsWith('decision') ? 'decision_table' : name.startsWith('reports') ? 'report' : 'workflow'
        return { content: [{ type: 'text', text: JSON.stringify({ created: true, [kind]: { id: uuid(900 + created), name: args.name }, warnings: [] }) }] }
      }
      const payload = PAYLOADS[name]?.(args) ?? { ok: true }
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
    },
  }
}

/* ── The 10-item plan (patient visit + medicine) ── */

const text = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, type: 'text', ...extra })
function plan() {
  const cols = (names: string[]) => names.map((n) => ({ key: n.toLowerCase().replace(/\W+/g, '_'), name: n, type: /date/i.test(n) ? 'date' : /count|age|qty|dose/i.test(n) ? 'number' : 'text' }))
  const items: any[] = [
    { key: 'patients', kind: 'data_table', name: 'Patients', summary: 'Patient records', args: { name: 'Patients', description: 'Registered patients', columns: cols(['Full name', 'Date of birth', 'Phone', 'Email', 'NHI number', 'Allergies', 'GP', 'Notes']) } },
    { key: 'visits', kind: 'data_table', name: 'Visits', summary: 'One row per visit', args: { name: 'Visits', columns: cols(['Patient', 'Visit date', 'Reason', 'Triage priority', 'Doctor', 'Diagnosis', 'Status', 'Reference']) } },
    { key: 'prescriptions', kind: 'data_table', name: 'Prescriptions', summary: 'Medicines prescribed', args: { name: 'Prescriptions', columns: cols(['Visit', 'Medicine', 'Dose', 'Qty', 'Instructions', 'Dispensed date', 'Pharmacist']) } },
    { key: 'intake', kind: 'form', name: 'Patient intake', summary: 'Start form', args: { name: 'Patient intake', fields: [text('full_name', 'Full name', { required: true }), { key: 'date_of_birth', label: 'Date of birth', type: 'date', required: true }, { key: 'phone', label: 'Phone', type: 'phone' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'reason', label: 'Reason for visit', type: 'textarea', required: true }, { key: 'pain', label: 'Pain score (0-10)', type: 'number' }, { key: 'fever', label: 'Fever', type: 'checkbox' }, text('allergies', 'Allergies')] } },
    { key: 'triage', kind: 'form', name: 'Nurse triage', summary: 'Nurse checks vitals', args: { name: 'Nurse triage', fields: [text('full_name', 'Patient', { read_only: true, default: '{{form.full_name}}' }), { key: 'temperature', label: 'Temperature', type: 'number' }, { key: 'blood_pressure', label: 'Blood pressure', type: 'text' }, { key: 'notes', label: 'Triage notes', type: 'textarea' }] } },
    { key: 'consult', kind: 'form', name: 'Doctor consultation', summary: 'Diagnosis and prescription', args: { name: 'Doctor consultation', fields: [text('full_name', 'Patient', { read_only: true, default: '{{form.full_name}}' }), { key: 'diagnosis', label: 'Diagnosis', type: 'textarea', required: true }, { key: 'needs_medicine', label: 'Prescribe medicine', type: 'checkbox' }, text('medicine', 'Medicine'), text('dose', 'Dose'), { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'instructions', label: 'Instructions', type: 'textarea' }] } },
    { key: 'dispense', kind: 'form', name: 'Pharmacy dispense', summary: 'Pharmacist dispenses', args: { name: 'Pharmacy dispense', fields: [text('medicine', 'Medicine', { read_only: true, default: '{{doctor_consultation_task_data.medicine}}' }), text('dose', 'Dose', { read_only: true }), { key: 'dispensed', label: 'Dispensed', type: 'checkbox', required: true }, { key: 'counselling', label: 'Counselling notes', type: 'textarea' }] } },
    { key: 'priority', kind: 'decision_table', name: 'Triage priority', summary: 'Priority from pain and fever', args: { name: 'Triage priority', inputs: [{ key: 'pain', label: 'Pain', type: 'number' }, { key: 'fever', label: 'Fever', type: 'boolean' }], outputs: [{ key: 'priority', label: 'Priority', type: 'text' }], rules: [{ conditions: { pain: { operator: 'gte', value: 8 } }, outputs: { priority: 'Urgent' } }, { conditions: { fever: { operator: 'equals', value: true } }, outputs: { priority: 'High' } }, { conditions: {}, outputs: { priority: 'Normal' } }] } },
  ]
  const n = (id: string, type: string, label: string, config: Record<string, unknown>) => ({ id, type, label, config })
  items.push({
    key: 'workflow', kind: 'workflow', name: 'Patient visit', summary: 'Intake → triage → consult → pharmacy', depends_on: ['intake', 'triage', 'consult', 'dispense', 'visits', 'prescriptions', 'priority'],
    args: {
      name: 'Patient visit', trigger_type: 'form_submitted', trigger_config: { form_id: '{{ref:intake.id}}', form_name: '{{ref:intake.name}}' },
      nodes: [
        n('trigger', 'form_submitted', 'Intake submitted', { form_id: '{{ref:intake.id}}', form_name: '{{ref:intake.name}}' }),
        n('title', 'set_title', 'Title', { title: 'Visit {{form.full_name}} {{submission.reference}}' }),
        n('rules', 'decision_table', 'Triage priority', { decision_table_id: '{{ref:priority.id}}', inputs: { pain: '{{form.pain}}', fever: '{{form.fever}}' }, output_var: 'triage' }),
        n('save', 'update_data_table', 'Save visit', { table_id: '{{ref:visits.id}}', operation: 'insert', column_values: { patient: '{{form.full_name}}', visit_date: '{{=NOW()}}', reason: '{{form.reason}}', triage_priority: '{{triage.priority}}', status: 'Waiting', reference: '{{submission.reference}}' }, output_row_id_var: 'visit_row_id' }),
        n('nurse', 'user_task', 'Nurse triage', { task_title: 'Triage {{form.full_name}} ({{triage.priority}})', outcomes: ['Done'], form_id: '{{ref:triage.id}}', field_values: { full_name: '{{form.full_name}}' }, assignment_type: 'role', role_name: 'Nurse' }),
        n('doctor', 'user_task', 'Doctor consultation', { task_title: 'See {{form.full_name}}', outcomes: ['Complete'], form_id: '{{ref:consult.id}}', field_values: { full_name: '{{form.full_name}}' }, assignment_type: 'role', role_name: 'Doctor' }),
        n('upd', 'update_data_table', 'Record diagnosis', { table_id: '{{ref:visits.id}}', operation: 'update', row_id: '{{visit_row_id}}', column_values: { diagnosis: '{{doctor_consultation_task_data.diagnosis}}', doctor: '{{completed_by_name}}', status: 'Seen' } }),
        n('rx', 'condition', 'Medicine?', { branches: [{ label: 'Yes', logic: 'and', rules: [{ field: '{{doctor_consultation_task_data.needs_medicine}}', operator: 'is_true' }] }], has_else: true }),
        n('rxsave', 'update_data_table', 'Save prescription', { table_id: '{{ref:prescriptions.id}}', operation: 'insert', column_values: { visit: '{{submission.reference}}', medicine: '{{doctor_consultation_task_data.medicine}}', dose: '{{doctor_consultation_task_data.dose}}', qty: '{{doctor_consultation_task_data.qty}}', instructions: '{{doctor_consultation_task_data.instructions}}' }, output_row_id_var: 'rx_row_id' }),
        n('pharm', 'user_task', 'Pharmacy dispense', { task_title: 'Dispense for {{form.full_name}}', outcomes: ['Dispensed'], form_id: '{{ref:dispense.id}}', field_values: { medicine: '{{doctor_consultation_task_data.medicine}}', dose: '{{doctor_consultation_task_data.dose}}' }, assignment_type: 'role', role_name: 'Pharmacist' }),
        n('rxupd', 'update_data_table', 'Mark dispensed', { table_id: '{{ref:prescriptions.id}}', operation: 'update', row_id: '{{rx_row_id}}', column_values: { dispensed_date: '{{=NOW()}}', pharmacist: '{{completed_by_name}}' } }),
        n('done', 'update_data_table', 'Close visit', { table_id: '{{ref:visits.id}}', operation: 'update', row_id: '{{visit_row_id}}', column_values: { status: 'Closed' } }),
        n('mail', 'send_email', 'Tell the patient', { to: '{{form.email}}', subject: 'Your visit {{submission.reference}}', body: '<p>Thank you, {{form.full_name}}. Diagnosis: {{doctor_consultation_task_data.diagnosis}}</p>' }),
      ],
      edges: [['trigger', 'title'], ['title', 'rules'], ['rules', 'save'], ['save', 'nurse'], ['nurse', 'doctor', 'Done'], ['doctor', 'upd', 'Complete'], ['upd', 'rx'], ['rx', 'rxsave', 'Yes'], ['rx', 'done', 'Else'], ['rxsave', 'pharm'], ['pharm', 'rxupd', 'Dispensed'], ['rxupd', 'done'], ['done', 'mail']].map(([s, t, l], i) => ({ id: `e${i}`, source: s, target: t, ...(l ? { label: l } : {}) })),
    },
  })
  items.push({ key: 'report', kind: 'report', name: 'Visits by priority', summary: 'Chart of visits', depends_on: ['visits'], args: { name: 'Visits by priority', config: { source: 'data_table', table_id: '{{ref:visits.id}}', columns: ['patient', 'visit_date', 'triage_priority', 'status'], group_by: 'triage_priority', charts: [{ type: 'bar', x: 'triage_priority', title: 'Visits by priority' }] } } })
  return { title: 'Patient visit process', items }
}

/* ── Mock LLM ── */

interface CallStat { prompt: number; cached: number; written: number }
const tok = (s: string) => Math.ceil(s.length / 4)

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

/** The provider's cache, shared by the requests of one scenario (they follow each other within minutes). */
const cache = { previous: '' }

function mockLlm(script: Array<{ content?: string; tool_calls?: any[] }>) {
  const stats: CallStat[] = []
  let step = 0
  const fetchImpl = (async (url: any, init: any) => {
    const body = JSON.parse(init.body)
    const native = String(url).endsWith('/messages')
    // Render order tools → system → messages (Anthropic's cache prefix order).
    const rendered = JSON.stringify(body.tools ?? []) + JSON.stringify(body.system ?? '') + JSON.stringify(body.messages ?? [])
    const prompt = tok(rendered)
    let cached = 0
    if (native && cache.previous) {
      const same = commonPrefix(cache.previous, rendered)
      cached = same / 4 >= 512 ? tok(rendered.slice(0, same)) : 0
    }
    const written = native ? prompt - cached : 0
    if (native) cache.previous = rendered
    stats.push({ prompt, cached, written: Math.max(0, written) })
    const reply = script[Math.min(step++, script.length - 1)]
    if (native) {
      const content: any[] = []
      if (reply.content) content.push({ type: 'text', text: reply.content })
      for (const c of reply.tool_calls ?? []) content.push({ type: 'tool_use', id: c.id, name: c.function.name, input: JSON.parse(c.function.arguments) })
      return new Response(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', content, stop_reason: reply.tool_calls ? 'tool_use' : 'end_turn', usage: { input_tokens: prompt - cached - written, cache_read_input_tokens: cached, cache_creation_input_tokens: written, output_tokens: 200 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls }, finish_reason: reply.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: prompt, completion_tokens: 200, total_tokens: prompt + 200 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, stats }
}

const call = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

/* ── Scenarios ── */

const conn = { provider: 'anthropic' as const, model: 'claude-sonnet-5-5', url: 'https://api.anthropic.com/v1/chat/completions', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' }, baseUrl: 'https://api.anthropic.com' }
const USER = 'Build this process out in full using forms, workflow, decision tables, tables. (A patient doctor-visit and medicine process: intake, nurse triage, doctor consult, prescription, pharmacy dispense.)'

async function turn(tools: AssistantToolDef[], history: ChatMessage[], script: any[], decision?: { tool_call_id: string; approved: boolean }) {
  const llm = mockLlm(script)
  const result = await runAssistantTurn({
    connection: conn, instructions: assistantInstructions({ groups: ['designer'], canBuild: true }), context: { screen: { label: 'Workflows', path: '/automations' }, building: 'The person can build.' },
    history, tools, decision: decision ?? null, onEvent: () => {}, fetchImpl: llm.fetchImpl, sleep: async () => {}, limits: { maxIterations: 20, maxTokens: 1e12, maxOutputTokens: 16_384, timeoutMs: 600_000 },
  })
  return { result, stats: llm.stats }
}

function sum(stats: CallStat[]) {
  const prompt = stats.reduce((a, s) => a + s.prompt, 0)
  const cached = stats.reduce((a, s) => a + s.cached, 0)
  const written = stats.reduce((a, s) => a + s.written, 0)
  // claude-sonnet-5-5 list prices per 1M: input $2, cache write (5m) $2.50, cache read $0.10.
  const dollars = ((prompt - cached - written) * 2 + written * 2.5 + cached * 0.1) / 1e6
  return { llm_calls: stats.length, prompt_tokens: prompt, cached_tokens: cached, cache_write_tokens: written, input_cost_usd: Math.round(dollars * 10000) / 10000, per_call: stats.map((s) => s.prompt) }
}

async function scenarioA(tools: AssistantToolDef[]) {
  cache.previous = ''
  const wf = (i: number) => uuid(i)
  const script = [
    { tool_calls: [call('c1', 'workflows_catalog', {})] },
    { tool_calls: [call('c2', 'data_tables_list', {})] },
    { tool_calls: [call('c3', 'workflows_list', {})] },
    { tool_calls: [call('c4', 'workflows_preflight', { name: 'Draft', trigger_type: 'form_submitted', nodes: '[]', edges: '[]' })] },
    { tool_calls: [call('c5', 'decision_tables_get', { decision_table_id: uuid(500) })] },
    { tool_calls: [call('c6', 'workflows_list', { query: 'visit' })] },
    { tool_calls: [call('c7', 'workflows_get_definition', { workflow_id: wf(1) }), call('c8', 'workflows_get_definition', { workflow_id: wf(2) }), call('c9', 'workflows_get_definition', { workflow_id: wf(3) })] },
    { content: 'Here is what I found…' },
  ]
  const { result, stats } = await turn(tools, [{ role: 'user', content: USER }], script)
  return { ...sum(stats), tool_calls: result.toolCalls, status: result.status }
}

async function scenarioB(tools: AssistantToolDef[]) {
  cache.previous = ''
  const p = plan()
  const all: CallStat[] = []
  let history: ChatMessage[] = [{ role: 'user', content: USER }]
  const r1 = await turn(tools, history, [
    { tool_calls: [call('b1', 'workflows_catalog', {})] },
    { tool_calls: [call('b2', 'data_tables_list', { query: 'patient' })] },
    { content: 'Here is the plan.', tool_calls: [call('b3', 'build_plan', p)] },
  ])
  all.push(...r1.stats)
  history = [...history, ...r1.result.newMessages]
  const r2 = await turn(tools, history, [{ content: 'Built: 3 tables, 4 forms, a decision table, the workflow and a report. Open the workflow?' }], { tool_call_id: 'b3', approved: true })
  all.push(...r2.stats)
  history = [...history, ...r2.result.newMessages, { role: 'user', content: 'Thanks. Which form does the pharmacist use?' }]
  const r3 = await turn(tools, history, [{ content: 'The “Pharmacy dispense” form.' }])
  all.push(...r3.stats)
  return { ...sum(all), plan_chars: JSON.stringify(p).length, statuses: [r1.result.status, r2.result.status, r3.result.status] }
}

async function scenarioSteered(tools: AssistantToolDef[]) {
  if (!tools.some((t) => t.name === 'workflow_node_reference')) return null
  cache.previous = ''
  const p = plan()
  const all: CallStat[] = []
  let history: ChatMessage[] = [{ role: 'user', content: USER }]
  const r1 = await turn(tools, history, [
    { tool_calls: [call('s1', 'workflows_catalog', {}), call('s2', 'data_tables_list', { query: 'patient' })] },
    { tool_calls: [call('s3', 'workflow_node_reference', { types: ['form_submitted', 'user_task', 'update_data_table', 'decision_table', 'condition', 'send_email', 'set_title'], items: ['form', 'data_table', 'decision_table'] })] },
    { content: 'Here is the plan.', tool_calls: [call('s4', 'build_plan', p)] },
  ])
  all.push(...r1.stats)
  history = [...history, ...r1.result.newMessages]
  const r2 = await turn(tools, history, [{ content: 'Built everything. Open the workflow?' }], { tool_call_id: 's4', approved: true })
  all.push(...r2.stats)
  return { ...sum(all), statuses: [r1.result.status, r2.result.status] }
}

async function main() {
  const catalog = await catalogPayload()
  const tools = designerTools({ server: fakeServer(catalog) as any, permissions: new Set(ALL_BUILD), checkWorkflow: () => [] })
  const toolDefs = JSON.stringify(tools.filter((t) => !t.group).map((t) => ({ type: 'function', function: { name: t.name, description: t.description.slice(0, 1024), parameters: t.parameters } })))
  const out = {
    fixed_per_call: { tools: tools.filter((t) => !t.group).length, tool_definition_tokens: tok(toolDefs), system_prompt_tokens: tok(assistantInstructions({ groups: ['designer'], canBuild: true })) },
    a_production_case: await scenarioA(tools),
    b_build_plan_10_items: await scenarioB(tools),
    a_steered: await scenarioSteered(tools),
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`tools: ${out.fixed_per_call.tools}, tool definitions ≈${out.fixed_per_call.tool_definition_tokens} tokens, system prompt ≈${out.fixed_per_call.system_prompt_tokens} tokens per call`)
    for (const [name, s] of Object.entries(out).slice(1)) {
      if (!s) continue
      const r = s as any
      console.log(`${name}: ${r.llm_calls} LLM calls, prompt_tokens ${r.prompt_tokens.toLocaleString('en-US')} (cached ${r.cached_tokens.toLocaleString('en-US')}, written ${r.cache_write_tokens.toLocaleString('en-US')}), input cost @ Sonnet 5.5 $${r.input_cost_usd} — per call ${r.per_call.join(', ')}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
