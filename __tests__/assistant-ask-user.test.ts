/**
 * Questions with answer buttons (ask_user) and who the Agent's User Tasks go
 * to (lib/assistants/assignment.ts): the tool and its card, answering,
 * persistence and expiry, the prompt rules, "@me" → the person building
 * (card + run), build_plan's assignees on the plan card, the wiring
 * validator's `unassigned` warning, and a mocked-LLM conversation: the
 * Agent asks → "Assign to me for testing" → the next call receives the
 * answer → the write card assigns the task to the current user.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { askUserTool, normalizeAskUser } from '@/lib/assistants/tools/ask-user'
import { ASSIGNED_FOR_TESTING_NOTE, ME_ASSIGNEE, resolveMeAssignee, userTasksOf, withAssignmentHelp, withAssignmentTools, type AssignmentDeps } from '@/lib/assistants/assignment'
import { buildPlanTools } from '@/lib/assistants/tools/build-plan'
import { choiceAnswer, choiceStatus, loadConversation, saveConversation, type ChatItem } from '@/lib/assistants/history'
import { assistantInstructions } from '@/lib/assistants/prompts'
import { workflowWarnings } from '@/lib/assistants/workflow-check'
import { validateWorkflowWiring, userTaskIsUnassigned } from '@/lib/workflow-wiring'
import { ChoiceCard } from '@/components/assistants/choice-card'
import { buildFailureContext } from '@/lib/assistants/failure'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'
import type { AssistantConnection } from '@/lib/assistants/settings'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ME = '0d000000-0000-4000-8000-000000000001'
const PRIYA = '0d000000-0000-4000-8000-000000000002'
const TEAM = '0d000000-0000-4000-8000-0000000000a1'
const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' }
const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const names: AssignmentDeps['names'] = async () => ({ users: new Map([[ME, 'Andy Hayes'], [PRIYA, 'Priya Shah']]), teams: new Map([[TEAM, 'Finance']]) })
const deps: AssignmentDeps = { meId: ME, names }

const ASSIGN_OPTIONS = [
  { label: 'Assign to me for testing', value: ME_ASSIGNEE },
  { label: "The submitter's manager", value: '{{submitted_by_manager_id}}' },
  { label: 'A team…' },
  { label: 'A specific person…' },
  { label: 'Leave unassigned (queue)' },
]

function memoryStore() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v) }, removeItem: (k: string) => { map.delete(k) },
    key: (i: number) => [...map.keys()][i] ?? null, get length() { return map.size },
  }
}

const workflowArgs = (taskConfig: Record<string, unknown>) => ({
  name: 'Leave approval',
  nodes: [
    { id: 'trigger', type: 'form_submitted', label: 'Leave request', config: { form_id: 'f1', form_name: 'Leave request' } },
    { id: 'approve', type: 'user_task', label: 'Manager approval', config: { task_title: 'Approve leave', outcomes: ['Approve', 'Decline'], ...taskConfig } },
  ],
  edges: [{ source: 'trigger', target: 'approve' }],
})

describe('ask_user: the tool', () => {
  it('cleans the question: 2–6 distinct options, the value carried in the reply, description kept', () => {
    const q = normalizeAskUser({ question: '  Who should it go to? ', options: [...ASSIGN_OPTIONS, { label: 'assign to me for testing' }], allow_other: true })
    expect(q.question).toBe('Who should it go to?')
    expect(q.options.map((o) => o.label)).toEqual(ASSIGN_OPTIONS.map((o) => o.label))
    expect(q.options[0].reply).toBe('Assign to me for testing (@me)')
    expect(q.options[2].reply).toBe('A team…')
    expect(q.allow_other).toBe(true)
    expect(q.multi).toBe(false)
    expect(() => normalizeAskUser({ question: 'Q', options: [{ label: 'Only one' }] })).toThrow(/2–6/)
    expect(() => normalizeAskUser({ question: 'Q', options: Array.from({ length: 7 }, (_, i) => ({ label: `O${i}` })) })).toThrow(/at most 6/)
    expect(() => normalizeAskUser({ options: ASSIGN_OPTIONS })).toThrow(/question/)
  })

  it('shows the card and stops the turn; a bad call is an error the model can retry in the same turn', async () => {
    const replies = [
      { tool_calls: [toolCall('c0', 'ask_user', { question: 'Pick', options: [{ label: 'Only' }] })] },
      { tool_calls: [toolCall('c1', 'ask_user', { question: 'Who should the task go to?', options: ASSIGN_OPTIONS, allow_other: true })] },
      { content: 'should never be reached' },
    ]
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      const msg = replies[calls++]
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const events: AssistantEvent[] = []
    const result = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'Build a leave workflow' }], tools: [askUserTool()], onEvent: (e) => events.push(e), fetchImpl })
    expect(result.status).toBe('completed')
    expect(calls).toBe(2)
    const choices = events.filter((e) => e.type === 'choice') as Extract<AssistantEvent, { type: 'choice' }>[]
    expect(choices).toHaveLength(1)
    expect(choices[0]).toMatchObject({ id: 'c1', question: 'Who should the task go to?', allow_other: true })
    // Every call is answered, so the next message (the click) is a normal user message.
    expect(result.newMessages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c0', 'c1'])
  })
})

describe('the question card: render, answer, persistence, expiry', () => {
  const card = (over: Partial<Extract<ChatItem, { kind: 'choice' }>> = {}): Extract<ChatItem, { kind: 'choice' }> => ({
    kind: 'choice', id: 'choice-c1', question: 'Who should the task go to?', options: normalizeAskUser({ question: 'q', options: ASSIGN_OPTIONS }).options, answered: null, ...over,
  })

  it('renders the options as buttons (first primary), and "Other…" when allowed', () => {
    const html = renderToStaticMarkup(createElement(ChoiceCard, { item: card({ allow_other: true }), status: 'open', busy: false }))
    expect(html).toContain('role="group"')
    expect(html).toContain('data-choice-status="open"')
    expect(html.match(/data-testid="agent-choice-option"/g)).toHaveLength(5)
    expect(html).toContain('Assign to me for testing')
    expect(html).toContain('data-testid="agent-choice-other"')
    expect(html).not.toContain('agent-choice-send')
    const multi = renderToStaticMarkup(createElement(ChoiceCard, { item: card({ multi: true }), status: 'open', busy: false }))
    expect(multi).toContain('aria-pressed="false"')
    expect(multi).toContain('data-testid="agent-choice-send"')
  })

  it('answered cards show the answer with no buttons; expired cards say so', () => {
    const answered = renderToStaticMarkup(createElement(ChoiceCard, { item: card({ answered: 'Assign to me for testing' }), status: 'answered', busy: false }))
    expect(answered).toContain('You answered: <span class="font-medium text-fg">Assign to me for testing</span>')
    expect(answered).not.toContain('agent-choice-option')
    const expired = renderToStaticMarkup(createElement(ChoiceCard, { item: card(), status: 'expired', busy: false }))
    expect(expired).toContain('Expired — not answered')
    expect(expired).not.toContain('agent-choice-option')
  })

  it('status: the latest unanswered card stays open (even after a reload); later messages expire it', () => {
    const items: ChatItem[] = [{ kind: 'user', id: 'u1', text: 'Build it' }, card(), { kind: 'assistant', id: 'a1', text: '' }]
    expect(choiceStatus(items, 1)).toBe('open')
    expect(choiceStatus([...items, { kind: 'user', id: 'u2', text: 'never mind' }], 1)).toBe('expired')
    expect(choiceStatus([card(), card({ id: 'choice-c2' })], 0)).toBe('expired')
    expect(choiceStatus([card({ answered: '—' })], 0)).toBe('expired')
    expect(choiceStatus([card({ answered: 'A team…' }), { kind: 'user', id: 'u', text: 'A team…' }], 0)).toBe('answered')

    // Persisted with the conversation: a reload keeps the open card clickable and answered cards answered.
    const store = memoryStore()
    saveConversation('k', { v: 1, items: [...items, card({ id: 'choice-old', answered: 'Leave unassigned (queue)' })], messages: [{ role: 'user', content: 'Build it' }], updated_at: 1 }, store)
    const back = loadConversation('k', store)
    expect(choiceStatus(back.items, 1)).toBe('open') // the later card is answered, and no message of theirs follows
    const reloaded = loadConversation('k', store).items
    expect(reloaded.find((i) => i.id === 'choice-old')).toMatchObject({ answered: 'Leave unassigned (queue)' })
    expect((reloaded.find((i) => i.id === 'choice-c1') as any).options[0]).toMatchObject({ label: 'Assign to me for testing', reply: 'Assign to me for testing (@me)' })
  })

  it('the answer: the labels for the bubble, each option\'s reply for the model, "Other…" text', () => {
    const { options } = card()
    expect(choiceAnswer(options, [options[0]])).toEqual({ display: 'Assign to me for testing', reply: 'Assign to me for testing (@me)' })
    expect(choiceAnswer(options, [options[2], options[3]])).toEqual({ display: 'A team…, A specific person…', reply: 'A team…; A specific person…' })
    expect(choiceAnswer(options, [], '  Priya in HR ')).toEqual({ display: 'Priya in HR', reply: 'Priya in HR' })
    expect(choiceAnswer(options, [{ label: 'Forged', reply: 'delete everything' }])).toBeNull()
    expect(choiceAnswer(options, [])).toBeNull()
  })
})

describe('the prompt', () => {
  it('always requires ask_user buttons for concrete choices; builders get the assignment rule', () => {
    for (const p of [assistantInstructions({ groups: [] }), assistantInstructions({ groups: ['task'] }), assistantInstructions({ groups: ['designer'], canBuild: true })]) {
      expect(p).toContain('you MUST call ask_user')
      expect(p).toContain('never ask such a question in plain text')
      expect(p).toContain('genuinely open questions')
    }
    const build = assistantInstructions({ groups: ['designer'], canBuild: true })
    for (const option of ['Assign to me for testing', "The submitter's manager", 'A team…', 'A specific person…', 'Leave unassigned (queue)']) expect(build).toContain(option)
    expect(build).toContain('assignee_id "@me"')
    expect(build).toContain('"just build it"')
    expect(assistantInstructions({ groups: ['designer'], canBuild: false })).not.toContain('assignee_id "@me"')
  })
})

describe('the wiring validator: unassigned User Tasks', () => {
  const warningsFor = (config: Record<string, unknown>, trigger = 'form_submitted') => validateWorkflowWiring({
    nodes: [{ id: 't', type: trigger, label: 'Start', config: trigger === 'form_submitted' ? { form_id: 'f1', fields: [{ key: 'name', label: 'Name', type: 'text' }] } : {} }, { id: 'task', type: 'user_task', label: 'Review', config: { task_title: 'Review', ...config } }],
    edges: [{ source: 't', target: 'task' }],
  })

  it('warns when nobody is assigned, with the ways to assign it', () => {
    const [w] = warningsFor({})
    expect(w).toMatchObject({ kind: 'unassigned', node_id: 'task', key: 'assignee_id', suggestion: 'assignee_variable: "{{submitted_by_manager_id}}"' })
    expect(w.message).toContain('User Task "Review" has no assignee: the task will sit in the queue with nobody assigned')
    expect(w.message).toContain('{{submitted_by_manager_id}}')
    expect(w.message).toContain('{{submitted_by}}')
    // A manual / webhook workflow: the starter, no submitter's manager.
    const [m] = warningsFor({}, 'manual')
    expect(m.message).toContain('{{workflow_started_by}}')
    expect(m.message).not.toContain('submitted_by_manager_id')
    expect(warningsFor({ assignment_type: 'team' })[0]).toMatchObject({ kind: 'unassigned', key: 'team_id' })
    expect(warningsFor({ assignee_id: '   ' })[0].kind).toBe('unassigned')
  })

  it('no warning with a person, a variable or a team', () => {
    expect(warningsFor({ assignee_id: PRIYA })).toEqual([])
    expect(warningsFor({ assignee_variable: '{{submitted_by_manager_id}}' })).toEqual([])
    expect(warningsFor({ assignment_type: 'team', team_id: TEAM })).toEqual([])
    expect(warningsFor({ assignment_type: 'aad_group', aad_group_id: 'g1' })).toEqual([])
    // A team task reads team_id only (a variable does not assign a team).
    expect(userTaskIsUnassigned({ assignment_type: 'team', assignee_variable: '{{x}}' })).toBe(true)
  })

  it('assigned for testing is an info note, not a warning — and not a self-check issue', () => {
    const notes = warningsFor({ assignee_id: ME, _assigned_for_testing: true })
    expect(notes).toEqual([expect.objectContaining({ kind: 'assigned_for_testing', severity: 'info' })])
    expect(notes[0].message).toContain("assigned to the workflow's creator for testing")
    const draft = { nodes: workflowArgs({ assignee_id: ME, _assigned_for_testing: true }).nodes as any, edges: workflowArgs({}).edges, triggerType: 'form_submitted', userVariables: [] }
    expect(workflowWarnings(draft).join('\n')).not.toContain('testing')
    const unassigned = workflowWarnings({ ...draft, nodes: workflowArgs({}).nodes as any })
    expect(unassigned.join('\n')).toContain('has no assignee')
    expect(unassigned.join('\n')).toContain('ask them with ask_user')
    // "Ask Agent to fix" carries the same warnings.
    const failure = buildFailureContext({ source: 'test', workflow: { id: 'w', name: 'Leave' }, nodes: workflowArgs({}).nodes as any, edges: [], error: 'x', failedNodeId: null } as any)
    expect((failure.wiring_warnings as string[]).join('\n')).toContain('has no assignee')
  })
})

describe('"@me": the person building, on the card and when it runs', () => {
  it('resolves "@me" on every User Task and marks it for testing', () => {
    const resolved = resolveMeAssignee('workflows_create', workflowArgs({ assignee_id: '@me', assignee_variable: '{{submitted_by}}' }), ME)
    expect(userTasksOf('workflows_create', resolved)[0].config).toMatchObject({ assignee_id: ME, assignment_type: 'individual', _assigned_for_testing: true })
    expect(userTasksOf('workflows_create', resolved)[0].config.assignee_variable).toBeUndefined()
    // Untouched otherwise.
    const other = resolveMeAssignee('workflows_create', workflowArgs({ assignee_id: PRIYA }), ME)
    expect(userTasksOf('workflows_create', other)[0].config).toEqual(expect.not.objectContaining({ _assigned_for_testing: true }))
    expect(resolveMeAssignee('forms_create', { name: '@me' }, ME)).toEqual({ name: '@me' })
    // MCP takes nodes / definition as JSON text: the form is kept.
    const text = workflowArgs({ assignee_id: '@me' })
    const asText = resolveMeAssignee('workflows_update', { workflow_id: 'w', nodes: JSON.stringify(text.nodes), edges: JSON.stringify(text.edges) }, ME)
    expect(typeof asText.nodes).toBe('string')
    expect(JSON.parse(asText.nodes)[1].config).toMatchObject({ assignee_id: ME, _assigned_for_testing: true })
    expect(asText.edges).toBe(JSON.stringify(text.edges))
    const asDef = resolveMeAssignee('workflows_update', { workflow_id: 'w', definition: JSON.stringify({ nodes: text.nodes }) }, ME)
    expect(JSON.parse(asDef.definition).nodes[1].config.assignee_id).toBe(ME)
    expect(userTasksOf('workflows_update', asText)[0].config.assignee_id).toBe(ME)
  })

  it('build_plan: default assignee = the creator, shown on the plan card; the build creates it assigned', async () => {
    const created: any[] = []
    const call = vi.fn(async (name: string, args: any) => { created.push({ name, args }); return name === 'forms_create' ? { form: { id: 'form-1', name: args.name } } : { workflow: { id: 'wf-1', name: args.name } } })
    const [plan] = buildPlanTools({ call, allowedTools: new Set(['forms_create', 'workflows_create']), draftOnly: (_t, a) => a })
    const tool = withAssignmentHelp(plan, deps)
    const args = {
      title: 'Leave',
      items: [
        { key: 'form', kind: 'form', name: 'Leave request', args: { fields: [] } },
        { key: 'wf', kind: 'workflow', name: 'Leave approval', args: { nodes: [
          { id: 't', type: 'form_submitted', label: 'Start', config: { form_id: '{{ref:form.id}}' } },
          { id: 'a', type: 'user_task', label: 'Manager approval', config: { task_title: 'Approve', assignee_id: '@me' } },
          { id: 'h', type: 'user_task', label: 'HR check', config: { task_title: 'Check', assignment_type: 'team', team_id: TEAM } },
        ], edges: [] } },
      ],
    }
    const card = await tool.confirm!(args)
    expect(card.lines).toContain('Assignee of “Manager approval”: you (Andy Hayes), for testing')
    expect(card.lines).toContain('Assignee of “HR check”: the team Finance')
    expect(card.warnings[0]).toBe(ASSIGNED_FOR_TESTING_NOTE)
    expect((card as any).confirm_label).toBe('Build all')
    const out = await tool.run(args, { emit: () => undefined, toolCallId: 'p1' })
    const wf = created.find((c) => c.name === 'workflows_create')
    expect(wf.args.nodes[1].config).toMatchObject({ assignee_id: ME, _assigned_for_testing: true })
    expect(out.result).toMatchObject({ status: 'completed', assigned_for_testing: ['Manager approval'] })
    expect((out.result as any).assignment_note).toContain('assigned to you for testing')
  })

  it('the card names each assignee and flags unassigned tasks', async () => {
    const inner: AssistantToolDef = { name: 'workflows_update', description: '', parameters: {}, mode: 'write', label: () => 'Updating', confirm: async () => ({ title: 'Update workflow', lines: ['Nodes: 2'], warnings: ['1 possible wiring issue'] }), run: async () => ({ result: { ok: true } }) }
    const card = await withAssignmentHelp(inner, deps).confirm!(workflowArgs({}))
    expect(card.lines).toEqual(['Nodes: 2', 'Assignee of “Manager approval”: nobody — it waits in the queue (unassigned)'])
    expect(card.warnings[0]).toContain('No assignee: “Manager approval”')
    const mgr = await withAssignmentHelp(inner, deps).confirm!(workflowArgs({ assignee_variable: '{{submitted_by_manager_id}}' }))
    expect(mgr.lines[1]).toBe("Assignee of “Manager approval”: the submitter's manager")
    const person = await withAssignmentHelp(inner, deps).confirm!(workflowArgs({ assignee_id: PRIYA }))
    expect(person.lines[1]).toBe('Assignee of “Manager approval”: Priya Shah')
  })

  it('the chat hook wraps only workflow writes and adds assignees_lookup for builders', () => {
    const read: AssistantToolDef = { name: 'forms_list', description: '', parameters: {}, mode: 'read', label: () => '', run: async () => ({ result: {} }) }
    const write: AssistantToolDef = { ...read, name: 'workflows_create', mode: 'write' }
    expect(withAssignmentTools([read], { db: {} as any, tenantId: 't', meId: ME }).map((t) => t.name)).toEqual(['forms_list'])
    const out = withAssignmentTools([read, write], { db: {} as any, tenantId: 't', meId: ME })
    expect(out.map((t) => t.name)).toEqual(['forms_list', 'workflows_create', 'assignees_lookup'])
    expect(out[0]).toBe(read)
  })
})

describe('a mocked conversation: ask → "Assign to me for testing" → the write assigns the current user', () => {
  it('the next call receives the answer and the confirmed write runs with assignee_id = the current user', async () => {
    const bodies: any[] = []
    // The mock model: asks first; once the person answered, creates the workflow with "@me".
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      bodies.push(body)
      const lastUser = String(body.messages.filter((m: any) => m.role === 'user').pop()?.content ?? '')
      const lastTool = body.messages[body.messages.length - 1]
      let msg: any
      if (lastTool?.role === 'tool' && lastTool.name === 'workflows_create') msg = { content: 'Created **Leave approval** as a draft. The Manager approval task is assigned to you for testing — change it before publishing.' }
      else if (/Assign to me for testing/.test(lastUser)) msg = { tool_calls: [toolCall('w1', 'workflows_create', workflowArgs({ assignee_id: '@me' }))] }
      else msg = { content: 'Who should the approval go to?', tool_calls: [toolCall('q1', 'ask_user', { question: 'Who should the Manager approval task go to?', options: ASSIGN_OPTIONS })] }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const ran: any[] = []
    const createTool: AssistantToolDef = {
      name: 'workflows_create', description: 'Create a workflow', parameters: { type: 'object', properties: {} }, mode: 'write', label: () => 'Creating the workflow',
      confirm: async (a) => ({ title: `Create workflow “${a.name}” (draft)`, lines: [], warnings: [] }),
      run: async (a) => { ran.push(a); return { result: { created: true, workflow: { id: 'wf-1', name: a.name } } } },
    }
    // As the chat hook wires it (withAssignmentTools), with the name lookup faked.
    const tools = [askUserTool(), withAssignmentHelp(createTool, deps)]
    const turn = (history: ChatMessage[], decision?: { tool_call_id: string; approved: boolean }) => {
      const events: AssistantEvent[] = []
      return runAssistantTurn({ connection: conn, instructions: 'X', context: null, history, tools, decision, onEvent: (e) => events.push(e), fetchImpl }).then((r) => ({ r, events }))
    }

    // 1. The Agent asks with buttons.
    let history: ChatMessage[] = [{ role: 'user', content: 'Build a leave approval workflow from the Leave request form' }]
    const t1 = await turn(history)
    const choice = t1.events.find((e) => e.type === 'choice') as Extract<AssistantEvent, { type: 'choice' }>
    expect(choice.options.map((o) => o.label)).toEqual(ASSIGN_OPTIONS.map((o) => o.label))
    history = [...history, ...t1.r.newMessages]

    // 2. The click: the person's reply (bubble "Assign to me for testing").
    const answer = choiceAnswer(choice.options, [choice.options[0]])!
    expect(answer.display).toBe('Assign to me for testing')
    history = [...history, { role: 'user', content: answer.reply }]
    const t2 = await turn(history)
    expect(bodies[bodies.length - 1].messages.filter((m: any) => m.role === 'user').pop().content).toBe('Assign to me for testing (@me)')
    expect(t2.r.status).toBe('awaiting_confirmation')
    const confirm = t2.events.find((e) => e.type === 'confirm') as Extract<AssistantEvent, { type: 'confirm' }>
    expect(confirm.card.lines).toContain('Assignee of “Manager approval”: you (Andy Hayes), for testing')
    expect(confirm.card.warnings).toContain(ASSIGNED_FOR_TESTING_NOTE)
    expect(ran).toEqual([]) // nothing written before the confirmation
    history = [...history, ...t2.r.newMessages]

    // 3. Confirmed: the write runs with the current user as the assignee.
    const t3 = await turn(history, { tool_call_id: 'w1', approved: true })
    expect(t3.r.status).toBe('completed')
    expect(ran).toHaveLength(1)
    expect(ran[0].nodes[1].config).toMatchObject({ assignee_id: ME, assignment_type: 'individual', _assigned_for_testing: true })
    const toolResult = t3.r.newMessages.find((m) => m.role === 'tool')!
    expect(toolResult.content).toContain('assigned_for_testing')
  })
})
