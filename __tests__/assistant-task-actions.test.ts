/**
 * The Agent actions tasks (lib/assistants/tools/task-actions.ts):
 *  - task_get_form: the form at a glance (an info card: label → value,
 *    secrets masked, required-but-empty flagged, outcome colours);
 *  - required fields are checked before any card: missing ones come back as
 *    a list (label, type, options, how to ask) and no card is shown;
 *  - values are then saved / passed and the task completed behind a card
 *    (outcome + colour, comment, values with the changed ones marked,
 *    on-behalf / break-glass, what happens next);
 *  - the app's own rules: the assignee completes; a manager acts on behalf
 *    with a reason (asked for); break-glass is flagged; invited viewers and
 *    unrelated people are refused; a queued task is accepted and completed;
 *  - history and audit record "via the Agent" and on behalf;
 *  - the setting off leaves only reading; the prompt no longer forbids
 *    completing (and says never to infer approval);
 *  - a mocked model: "approve Ethan's leave" → task_get_form → missing
 *    "Approver comment" → ask_user → values → card → Confirm → completed, and
 *    the workflow resume is queued.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const memory = vi.hoisted(() => ({ db: null as any, audits: [] as any[], resumes: [] as any[] }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async (entry: any) => { memory.audits.push(entry) }) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => memory.db, isAuthorizedServiceCall: () => false }))
vi.mock('@/lib/workflow-resume-queue', () => ({ enqueueResume: vi.fn(async (input: any) => { memory.resumes.push(input); return { run_id: 'run-1', workflow_id: 'wf-1', job_id: 'job-1', resumed: 'queued' } }) }))
vi.mock('@/lib/services/task-completion-screen', () => ({ nextStepForResponse: vi.fn(async () => ({ state: 'assigned', run_id: 'run-1', steps: [{ name: 'CFO approval', assignees: ['Priya Shah'], team: null }], process: { name: 'Leave' }, run_view: 'full' })) }))

import { runAssistantTurn } from '@/lib/assistants/engine'
import { nextStepLine, taskActionTools, TASK_ACTION_WRITE_TOOLS } from '@/lib/assistants/tools/task-actions'
import { askUserTool } from '@/lib/assistants/tools/ask-user'
import { assistantInstructions } from '@/lib/assistants/prompts'
import { profileTaskActions } from '@/lib/assistants/profiles'
import { normalizeAgentSettings } from '@/lib/assistants/config'
import { formProblems, matchOutcome, outcomeTone } from '@/lib/assistants/task-form'

const T = 'tenant-a'
const id = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ANA = id(1), MIA = id(2), OWEN = id(3), BOB = id(4), VIC = id(5), ETHAN = id(6), AUDREY = id(7)
const LEAVE = id(11), REPORT = id(12), QUEUED = id(13), STANDARD = id(14)

const LEAVE_FIELDS = [
  { key: 'employee', label: 'Employee', type: 'text', read_only: true },
  { key: 'days', label: 'Days requested', type: 'number', read_only: true },
  { key: 'cost', label: 'Cost', type: 'currency', currency: 'NZD', read_only: true },
  { key: 'evidence', label: 'Evidence', type: 'attachments', read_only: true },
  { key: 'paid_leave', label: 'Paid leave?', type: 'choice', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }], required: true },
  { key: 'approver_comment', label: 'Approver comment', type: 'textarea', required: true, help_text: 'Why you approve or decline' },
  { key: 'api_token', label: 'API token', type: 'text' },
]
const leaveMeta = (extra: Record<string, unknown> = {}) => ({
  fields: LEAVE_FIELDS,
  template_values: { employee: 'Ethan Moore', days: 3, cost: 1250, evidence: [{ id: '0c000000-0000-4000-8000-0000000000f1', name: 'medical-note.pdf', size: 1200, mime_type: 'application/pdf', url: '/attachments/0c000000-0000-4000-8000-0000000000f1', storage_ref: 'storage://form-files/tenant-a/medical-note.pdf' }], api_token: 'tok-123' },
  completion_rule: 'first_response',
  ...extra,
})

function seed() {
  const wf = { tenant_id: T, is_workflow_task: true, status: 'in_progress', available_outcomes: ['Approved', 'Declined'], assigner_id: ETHAN, deleted_at: null, assignment_mode: null, acceptance_status: 'accepted' }
  return createMemorySupabase({
    tasks: [
      // Audrey approves Ethan's leave (her own task).
      { ...wf, id: LEAVE, title: 'Approve leave for Ethan Moore', event_id: 'evt-leave', assignee_id: AUDREY, metadata: leaveMeta() },
      // Ana's task: Mia (her manager) can act on her behalf.
      { ...wf, id: REPORT, title: 'Expense claim', event_id: 'evt-report', assignee_id: ANA, metadata: { fields: [], completion_rule: 'first_response' } },
      // Ana's queued task (waiting for her acceptance).
      { ...wf, id: QUEUED, title: 'Review contract', event_id: 'evt-q', assignee_id: ANA, acceptance_status: 'pending', status: 'todo', metadata: { completion_rule: 'first_response' } },
      { id: STANDARD, tenant_id: T, title: 'Book the venue', is_workflow_task: false, event_id: null, status: 'todo', assignee_id: ANA, assigner_id: MIA, available_outcomes: null, deleted_at: null, metadata: {} },
    ],
    users: [[ANA, 'Ana'], [MIA, 'Mia'], [OWEN, 'Owen'], [BOB, 'Bob'], [VIC, 'Vic'], [ETHAN, 'Ethan Moore'], [AUDREY, 'Audrey']].map(([uid, name]) => ({ id: uid, display_name: name, email: `${name.toLowerCase().replace(/\s/g, '')}@x.test` })),
    user_memberships: [ANA, MIA, OWEN, BOB, VIC, ETHAN, AUDREY].map((u) => ({ tenant_id: T, user_id: u, manager_user_id: u === ANA ? MIA : null, is_active: true })),
    task_viewers: [{ id: 'grant-1', tenant_id: T, task_id: REPORT, principal_type: 'user', principal_id: VIC, invited_by: ANA }],
    teams: [], task_assignees: [], user_teams: [], object_permissions: [], user_roles: [], lifecycle_events: [], notifications: [], task_responses: [],
  })
}

const ctx = (actorId: string, extra: string[] = []): ServiceContext => ({
  db: memory.db, supabase: memory.db, tenantId: T, actorId, permissions: new Set(['tasks.complete', 'tasks.view_own', ...extra]), authKind: 'session', source: 'ui',
})
const nextLine = async (_task: string, outcome: string) => (outcome === 'Approved' ? 'Next: goes to Priya Shah (CFO) for approval' : 'Next: Ethan is emailed and the process ends')
const toolsFor = (c: ServiceContext, taskId: string | null = null, canAct = true) => taskActionTools({ ctx: c, taskId, canAct, db: memory.db, nextLine })
const tool = (c: ServiceContext, name: string, taskId: string | null = null) => toolsFor(c, taskId).find((t) => t.name === name)!
const env = (events: AssistantEvent[] = []) => ({ emit: (e: AssistantEvent) => events.push(e), toolCallId: 'call_x' })
const row = async (taskId: string) => ((await memory.db.from('tasks').select('*').eq('id', taskId)).data ?? [])[0]
const events = async (taskId: string) => ((await memory.db.from('lifecycle_events').select('*').eq('task_id', taskId)).data ?? []) as any[]

const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
function provider(...replies: Array<{ content?: string | null; tool_calls?: any[] }>) {
  let n = 0
  const seen: any[] = []
  const fn = vi.fn(async (_url: string, init: any) => {
    seen.push(JSON.parse(init.body))
    const msg = replies[Math.min(n++, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return Object.assign(fn as unknown as typeof fetch, { seen })
}
const call = (callId: string, name: string, args: Record<string, unknown>) => ({ id: callId, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const toolResult = (m: ChatMessage) => JSON.parse(JSON.parse(m.content!).result ?? '{}')
const resultOf = (messages: ChatMessage[], callId: string) => {
  const m = messages.find((x) => x.role === 'tool' && x.tool_call_id === callId)!
  const env = JSON.parse(m.content!)
  return typeof env.result === 'string' ? JSON.parse(env.result) : env.result
}

describe('task forms in the chat (task_get_form)', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = []; memory.resumes = [] })

  it('shows the form as an info card: values in words, secrets masked, required-but-empty flagged, outcome colours', async () => {
    const out: AssistantEvent[] = []
    const r = await tool(ctx(AUDREY), 'task_get_form', LEAVE).run({}, env(out))
    const card = out.find((e) => e.type === 'info_card') as any
    expect(card).toMatchObject({ title: 'Approve leave for Ethan Moore', href: `/tasks/${LEAVE}` })
    const rows = Object.fromEntries(card.rows.map((x: any) => [x.label, x]))
    expect(rows['Employee'].value).toBe('Ethan Moore')
    expect(rows['Days requested'].value).toBe('3')
    expect(rows['Cost'].value).toBe('NZD 1,250.00')
    expect(rows['Evidence'].value).toBe('1 file: medical-note.pdf')
    expect(rows['API token'].value).toBe('••••')
    expect(rows['Approver comment']).toMatchObject({ flag: 'required_empty' })
    expect(rows['Paid leave?']).toMatchObject({ flag: 'required_empty' })
    expect(card.outcomes).toEqual([{ label: 'Approved', tone: 'success' }, { label: 'Declined', tone: 'danger' }])
    expect(card.notes[0]).toMatch(/2 required fields are empty: Paid leave\?, Approver comment/)
    // The model's view: the same, secrets never in it.
    const result = r.result as any
    expect(JSON.stringify(result)).not.toContain('tok-123')
    expect(result.required_empty.map((p: any) => [p.label, p.ask_with])).toEqual([['Paid leave?', 'buttons'], ['Approver comment', 'text']])
    expect(result.person_can_action).toBe(true)
  })

  it('an invited viewer can read the form (read only), and is refused when actioning', async () => {
    memory.db.rpc = async (name: string, args: any) => ({ data: name === 'task_viewer_grant' && args.p_user_id === VIC ? 'grant-1' : null, error: null })
    const out: AssistantEvent[] = []
    const r = await tool(ctx(VIC), 'task_get_form', REPORT).run({}, env(out))
    expect((r.result as any).how).toBe('read_only_viewer')
    expect((out[0] as any).notes).toContain('Read only for you (invited viewer)')
    await expect(tool(ctx(VIC), 'task_complete', REPORT).confirm!({ outcome: 'Approved' })).rejects.toThrow(/invited to view this task \(read only\)/)
  })
})

describe('required fields come first', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = []; memory.resumes = [] })

  it('blocks the completion card and lists the missing fields (label, type, options, help, how to ask)', async () => {
    const t = tool(ctx(AUDREY), 'task_complete', LEAVE)
    const err = await t.confirm!({ outcome: 'approve' }).catch((e) => e)
    expect(err.name).toBe('ToolPrecheck')
    expect(err.message).toBe('Required fields are still empty: Paid leave?, Approver comment')
    expect(err.result.missing_required).toEqual([
      { key: 'paid_leave', label: 'Paid leave?', type: 'choice', options: ['Yes', 'No'], error: expect.any(String), ask_with: 'buttons' },
      { key: 'approver_comment', label: 'Approver comment', type: 'textarea', help_text: 'Why you approve or decline', error: expect.any(String), ask_with: 'text' },
    ])
    expect(err.result.next_step).toMatch(/No card was shown/)
    expect((await row(LEAVE)).status).toBe('in_progress')
  })

  it('through the engine: no card, the model gets the list as the tool result', async () => {
    const out: AssistantEvent[] = []
    const fetchImpl = provider({ tool_calls: [call('c1', 'task_complete', { task_id: LEAVE, outcome: 'Approved' })] }, { content: 'I need two things first.' })
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'approve it' }], tools: toolsFor(ctx(AUDREY)), onEvent: (e) => out.push(e), fetchImpl })
    expect(r.status).toBe('completed')
    expect(out.some((e) => e.type === 'confirm')).toBe(false)
    expect(resultOf(r.newMessages, 'c1').missing_required.map((p: any) => p.label)).toEqual(['Paid leave?', 'Approver comment'])
  })

  it('values are then proposed and saved (a confirmed draft save), and completion is offered', async () => {
    const save = tool(ctx(AUDREY), 'task_save_form_values', LEAVE)
    const card = await save.confirm!({ values: { paid_leave: 'Yes', 'Approver comment': 'Enjoy the break' } })
    expect(card.title).toBe('Save values in “Approve leave for Ethan Moore”')
    expect(card.task!.values).toEqual([{ label: 'Paid leave?', value: 'Yes', changed: true }, { label: 'Approver comment', value: 'Enjoy the break', changed: true }])
    await save.run({ values: { paid_leave: 'Yes', 'Approver comment': 'Enjoy the break' } }, env())
    expect((await row(LEAVE)).metadata.template_values).toMatchObject({ paid_leave: 'yes', approver_comment: 'Enjoy the break', employee: 'Ethan Moore' })
    expect((await events(LEAVE)).find((e) => e.event_type === 'task_data_saved').metadata).toMatchObject({ via: 'agent' })
    const complete = await tool(ctx(AUDREY), 'task_complete', LEAVE).confirm!({ outcome: 'Approved' })
    expect(complete.title).toBe('Complete “Approve leave for Ethan Moore”')
  })

  it('refuses values for read-only or secret fields, and never accepts a value that is not an option', async () => {
    const err = await tool(ctx(AUDREY), 'task_complete', LEAVE).confirm!({ outcome: 'Approved', values: { employee: 'Someone else', api_token: 'x', paid_leave: 'maybe', approver_comment: 'ok' } }).catch((e) => e)
    expect(err.result.skipped.map((s: any) => s.key)).toEqual(['employee', 'api_token', 'paid_leave'])
  })
})

describe('completing, with the app\'s own rules', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = []; memory.resumes = [] })
  const values = { paid_leave: 'yes', approver_comment: 'Approved — enjoy' }

  it('the assignee: the card shows outcome (colour), comment, values (changed marked) and what happens next; Confirm completes and resumes the workflow', async () => {
    const t = tool(ctx(AUDREY), 'task_complete', LEAVE)
    const card = await t.confirm!({ outcome: 'approve', comment: 'Have a good trip', values })
    expect(card).toMatchObject({ title: 'Complete “Approve leave for Ethan Moore”', confirm_label: 'Confirm', danger: false })
    expect(card.task).toMatchObject({
      action: 'complete', outcome: 'Approved', tone: 'success', comment: 'Have a good trip', on_behalf_of: null, accept_first: false,
      next: 'Next: goes to Priya Shah (CFO) for approval',
      values: [{ label: 'Paid leave?', value: 'Yes', changed: true }, { label: 'Approver comment', value: 'Approved — enjoy', changed: true }],
    })
    expect(card.lines).toEqual(['Outcome: Approved', 'Comment: Have a good trip', 'Paid leave?: Yes (changed)', 'Approver comment: Approved — enjoy (changed)', 'Next: goes to Priya Shah (CFO) for approval'])
    const out: AssistantEvent[] = []
    const r = await t.run({ outcome: 'approve', comment: 'Have a good trip', values }, env(out))
    expect(r.result).toMatchObject({ status: 'completed', outcome: 'Approved', workflow_resumed: true, next: { steps: ['CFO approval — with Priya Shah'] } })
    expect(await row(LEAVE)).toMatchObject({ status: 'completed', outcome: 'Approved', outcome_notes: 'Have a good trip', actioned_by: AUDREY, actioned_on_behalf_of: null })
    expect((await row(LEAVE)).metadata.template_values).toMatchObject({ paid_leave: 'yes', approver_comment: 'Approved — enjoy' })
    expect((await events(LEAVE)).find((e) => e.event_type === 'task_response').metadata).toMatchObject({ outcome: 'Approved', via: 'agent' })
    expect(memory.resumes).toEqual([expect.objectContaining({ eventId: 'evt-leave', variables: expect.objectContaining({ outcome: 'Approved', outcome_notes: 'Have a good trip' }) })])
    expect(out).toContainEqual(expect.objectContaining({ type: 'changed', kind: 'task', id: LEAVE }))
  })

  it('an outcome the task does not have is refused (never chosen for the person)', async () => {
    await expect(tool(ctx(AUDREY), 'task_complete', LEAVE).confirm!({ outcome: 'Escalate', values })).rejects.toThrow(/Give one of this task's outcomes: Approved, Declined/)
    expect(matchOutcome(['Approved', 'Declined'], 'complete')).toBeNull()
    expect(matchOutcome(['Approved', 'Declined'], 'decline')).toBe('Declined')
  })

  it('a manager acts on behalf: the reason is asked for first, the card says so, history + audit record it via the Agent', async () => {
    const t = tool(ctx(MIA), 'task_complete', REPORT)
    const ask = await t.confirm!({ outcome: 'Approved' }).catch((e) => e)
    expect(ask.name).toBe('ToolPrecheck')
    expect(ask.result).toMatchObject({ needs: 'on_behalf_note', on_behalf_of: 'Ana', basis: 'manager' })
    const card = await t.confirm!({ outcome: 'Approved', on_behalf_note: 'Ana is on leave this week' })
    expect(card.danger).toBe(false)
    expect(card.task).toMatchObject({ on_behalf_of: 'Ana', basis: 'manager', on_behalf_note: 'Ana is on leave this week' })
    expect(card.lines).toContain('On behalf of Ana (as their manager)')
    expect(card.warnings.join(' ')).toMatch(/on behalf of Ana, via the Agent; Ana is notified/)
    await t.run({ outcome: 'Approved', on_behalf_note: 'Ana is on leave this week' }, env())
    expect(await row(REPORT)).toMatchObject({ status: 'completed', actioned_by: MIA, actioned_on_behalf_of: ANA })
    expect((await events(REPORT)).find((e) => e.event_type === 'task_response')).toMatchObject({ actor_id: MIA, metadata: { via: 'agent', on_behalf_of: ANA, on_behalf_note: 'Ana is on leave this week', acted_as: 'on_behalf', on_behalf_basis: 'manager' } })
    expect(memory.audits[0]).toMatchObject({ action: 'act_on_behalf', actorId: MIA, objectId: REPORT, metadata: { via: 'agent', on_behalf_of: ANA } })
    const notified = ((await memory.db.from('notifications').select('*').eq('user_id', ANA)).data ?? []) as any[]
    expect(notified[0]).toMatchObject({ type: 'task_actioned_on_behalf' })
  })

  it('break-glass is flagged in red on the card and audited as break-glass', async () => {
    const t = tool(ctx(OWEN, ['tasks.complete_any']), 'task_complete', REPORT)
    const card = await t.confirm!({ outcome: 'Declined', on_behalf_note: 'Urgent: Ana unreachable' })
    expect(card.danger).toBe(true)
    expect(card.task).toMatchObject({ basis: 'break_glass', tone: 'danger', on_behalf_of: 'Ana' })
    expect(card.warnings.join(' ')).toMatch(/^Break-glass: you are not in Ana's manager chain/)
    await t.run({ outcome: 'Declined', on_behalf_note: 'Urgent: Ana unreachable' }, env())
    expect(memory.audits[0]).toMatchObject({ action: 'break_glass', metadata: { via: 'agent' } })
  })

  it('unrelated people are refused with the reason (no card); the task is unchanged', async () => {
    // Can't even see it.
    await expect(tool(ctx(BOB), 'task_complete', REPORT).confirm!({ outcome: 'Approved', on_behalf_note: 'x' })).rejects.toThrow(/Task not found/)
    // Can see every task (oversight) but not action someone else's.
    await expect(tool(ctx(BOB, ['tasks.view_all']), 'task_complete', REPORT).confirm!({ outcome: 'Approved', on_behalf_note: 'x' })).rejects.toThrow(/You can't action this task: it is assigned to Ana/)
    await expect(tool(ctx(BOB, ['tasks.view_all']), 'task_complete', REPORT).run({ outcome: 'Approved', on_behalf_note: 'x' }, env())).rejects.toThrow(/can't action/)
    expect((await row(REPORT)).status).toBe('in_progress')
  })

  it('a queued task: "Accept and complete" accepts it, then completes it', async () => {
    const t = tool(ctx(ANA), 'task_complete', QUEUED)
    const card = await t.confirm!({ outcome: 'Approved' })
    expect(card).toMatchObject({ title: 'Accept and complete “Review contract”', confirm_label: 'Accept and complete' })
    expect(card.task!.accept_first).toBe(true)
    await t.run({ outcome: 'Approved' }, env())
    const kinds = (await events(QUEUED)).map((e) => [e.event_type, e.metadata?.via])
    expect(kinds).toEqual([['task_accepted', 'agent'], ['task_response', 'agent']])
    expect(await row(QUEUED)).toMatchObject({ status: 'completed', acceptance_status: 'accepted' })
  })

  it('task_respond: hold and decline need a reason; decline is a red card', async () => {
    const t = tool(ctx(ANA), 'task_respond', QUEUED)
    await expect(t.confirm!({ response: 'hold' })).rejects.toMatchObject({ name: 'ToolPrecheck', result: { needs: 'reason' } })
    const card = await t.confirm!({ response: 'decline', reason: 'Not my area' })
    expect(card).toMatchObject({ title: 'Decline “Review contract”', danger: true, confirm_label: 'Decline' })
    await t.run({ response: 'hold', reason: 'Back next week' }, env())
    expect((await row(QUEUED)).acceptance_status).toBe('held')
    expect((await events(QUEUED))[0]).toMatchObject({ event_type: 'task_held', metadata: { via: 'agent', comment: 'Back next week' } })
  })

  it('a standard task completes through the standard service, recorded via the Agent', async () => {
    const t = tool(ctx(ANA), 'task_complete', STANDARD)
    const card = await t.confirm!({ outcome: 'completed', comment: 'Booked' })
    expect(card.task).toMatchObject({ outcome: 'completed', next: null })
    await t.run({ outcome: 'completed', comment: 'Booked' }, env())
    expect(await row(STANDARD)).toMatchObject({ status: 'completed', outcome: 'completed', outcome_notes: 'Booked' })
    expect((await events(STANDARD))[0]).toMatchObject({ event_type: 'completed', metadata: { via: 'agent' } })
  })

  it('a Before-submit rule aimed at one outcome\'s button applies only to that outcome ("Decline needs a comment")', async () => {
    const t0 = await row(REPORT)
    await memory.db.from('tasks').update({ metadata: { ...t0.metadata,
      fields: [{ key: 'comment', label: 'Comment', type: 'textarea' }],
      form_buttons: [{ id: 'approve', label: 'Approve', kind: 'outcome', outcome: 'Approved' }, { id: 'decline', label: 'Decline', kind: 'outcome', outcome: 'Declined', style: 'danger' }],
      form_layout: { rules: [{ id: 'r1', name: 'Comment required to decline', event: 'before_submit', target: 'decline', if: { match: 'all', conditions: [{ column: 'comment', operator: 'is_not_set' }] }, then: [{ type: 'field_error', field: 'comment', text: 'Tell the requester why you are declining.' }] }] },
    } }).eq('id', REPORT)
    const ok = await tool(ctx(ANA), 'task_complete', REPORT).confirm!({ outcome: 'Approved' })
    expect(ok.task!.outcome).toBe('Approved')
    const err = await tool(ctx(ANA), 'task_complete', REPORT).confirm!({ outcome: 'Declined' }).catch((e) => e)
    expect(err.result.invalid).toEqual([expect.objectContaining({ key: 'comment', error: 'Tell the requester why you are declining.' })])
    // Reading the form doesn't flag it (it depends on the outcome).
    const out: AssistantEvent[] = []
    await tool(ctx(ANA), 'task_get_form', REPORT).run({}, env(out))
    expect((out[0] as any).rows.find((r: any) => r.label === 'Comment')).toBeUndefined()
  })

  it('a form completed with its buttons completes through the matching button; an outcome its buttons lack is refused', async () => {
    const t0 = await row(REPORT)
    await memory.db.from('tasks').update({ metadata: { ...t0.metadata, form_buttons: [{ id: 'b-ok', label: 'Approve', kind: 'outcome', outcome: 'Approved' }] } }).eq('id', REPORT)
    const ok = await tool(ctx(ANA), 'task_complete', REPORT).confirm!({ outcome: 'Approved' })
    expect(ok.warnings.join(' ')).toMatch(/form's “Approve” button/)
    await expect(tool(ctx(ANA), 'task_complete', REPORT).confirm!({ outcome: 'Declined' })).rejects.toThrow(/none of them completes with “Declined”/)
  })
})

describe('the setting, the prompt and the engine', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = []; memory.resumes = [] })

  it('"Let the Agent complete tasks" off: only reading is offered; absent means on; a profile can override', () => {
    expect(toolsFor(ctx(AUDREY), LEAVE, false).map((t) => t.name)).toEqual(['task_get_form'])
    expect(toolsFor(ctx(AUDREY), LEAVE, true).filter((t) => t.mode === 'write').map((t) => t.name)).toEqual([...TASK_ACTION_WRITE_TOOLS])
    expect(normalizeAgentSettings({ version: 3, enabled: true }).task_actions).toBe(true)
    expect(normalizeAgentSettings({ version: 3, enabled: true, task_actions: false }).task_actions).toBe(false)
    expect(profileTaskActions(undefined, null)).toBe(true)
    expect(profileTaskActions(false, null)).toBe(false)
    expect(profileTaskActions(false, { task_actions: true })).toBe(true)
    expect(profileTaskActions(true, { task_actions: false })).toBe(false)
    expect(profileTaskActions(true, { task_actions: null })).toBe(true)
  })

  it('the prompt no longer forbids completing: confirmation, required fields first, on-behalf reason, never infer approval', () => {
    const act = assistantInstructions({ groups: ['task'], taskActions: 'act' })
    expect(act).not.toMatch(/NEVER complete/)
    expect(act).toContain('You may complete, approve, decline or respond to tasks the person is allowed to action, only after showing a confirmation card and receiving Confirm')
    expect(act).toContain('Always check required fields first')
    expect(act).toContain('ask for the reason first')
    expect(act).toContain('Never infer approval: the person must explicitly ask to approve, decline or complete')
    expect(act).toContain('never complete without confirmation')
    expect(act).toContain('Never fabricate field values')
    expect(act).toContain('Never act on tasks the person can\'t action')
    const read = assistantInstructions({ groups: [], taskActions: 'read' })
    expect(read).toContain('Task actions are turned off')
    expect(read).toContain('task_get_form')
  })

  it('a card is never shown in the same step as a question', async () => {
    const out: AssistantEvent[] = []
    const fetchImpl = provider({ tool_calls: [call('q1', 'ask_user', { question: 'Paid leave?', options: [{ label: 'Yes' }, { label: 'No' }] }), call('c1', 'task_complete', { task_id: LEAVE, outcome: 'Approved', values })] })
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'approve' }], tools: [...toolsFor(ctx(AUDREY)), askUserTool()], onEvent: (e) => out.push(e), fetchImpl })
    expect(r.status).toBe('completed')
    expect(out.some((e) => e.type === 'confirm')).toBe(false)
    expect(resultOf(r.newMessages, 'c1').error).toMatch(/asked the person a question in this step/)
  })
  const values = { paid_leave: 'yes', approver_comment: 'ok' }

  it('the card\'s "Next" line: the first concrete step of the outcome\'s path', () => {
    const steps = ['If outcome is Approve (Approve):', '  Tell the requester: approved — with Ethan Brown', 'If outcome is Decline (Decline):', '  Tell the requester: declined']
    expect(nextStepLine(steps, 'Approve')).toBe('Tell the requester: approved — with Ethan Brown')
    expect(nextStepLine(steps, 'Decline')).toBe('Tell the requester: declined')
    expect(nextStepLine(['If amount is greater than 5000:', '  Goes to Priya Shah (CFO) for approval'], 'Approved')).toBe('If amount is greater than 5000, goes to Priya Shah (CFO) for approval')
    expect(nextStepLine(['The process ends'], 'Approved')).toBe('The process ends')
    expect(nextStepLine(['Human step “Tell the requester: approved” (task “Leave approved: Annual leave”): assigned to Chloe Davis (requester id) — choices: Got it, due in 7 days'], 'Approve')).toBe('“Tell the requester: approved”, with Chloe Davis')
  })

  it('outcome colours', () => {
    expect(['Approved', 'Accept', 'Declined', 'Rejected', 'Deferred', 'Send back', 'Reviewed'].map(outcomeTone)).toEqual(['success', 'success', 'danger', 'danger', 'warning', 'warning', 'brand'])
    expect(formProblems({ fields: [{ key: 'a', label: 'A', type: 'text', required: true }], template_values: { a: 'x' } })).toEqual([])
  })
})

describe('a mocked model: "approve Ethan\'s leave"', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = []; memory.resumes = [] })

  it('task_get_form → missing "Approver comment" → ask_user → values → card → Confirm → completed and the workflow resumes', async () => {
    const tools = [...toolsFor(ctx(AUDREY)), askUserTool()]
    const run = (history: ChatMessage[], fetchImpl: typeof fetch, out: AssistantEvent[], decision?: { tool_call_id: string; approved: boolean }) =>
      runAssistantTurn({ connection: conn, instructions: assistantInstructions({ groups: [], taskActions: 'act' }), context: null, history, tools, decision, onEvent: (e) => out.push(e), fetchImpl })

    // Turn 1: read the form, try to complete (missing fields come back, no card), ask with buttons.
    const out1: AssistantEvent[] = []
    let history: ChatMessage[] = [{ role: 'user', content: 'Approve Ethan\'s leave request' }]
    const t1 = await run(history, provider(
      { tool_calls: [call('g1', 'task_get_form', { task_id: LEAVE })] },
      { tool_calls: [call('c1', 'task_complete', { task_id: LEAVE, outcome: 'Approved' })] },
      { content: 'Two fields are required: **Approver comment** (why you approve) and **Paid leave?**.', tool_calls: [call('q1', 'ask_user', { question: 'Is this paid leave?', options: [{ label: 'Yes' }, { label: 'No' }] })] },
    ), out1)
    expect(t1.status).toBe('completed')
    expect(out1.find((e) => e.type === 'info_card')).toBeTruthy()
    expect(resultOf(t1.newMessages, 'c1').missing_required.map((p: any) => p.label)).toEqual(['Paid leave?', 'Approver comment'])
    expect(out1.find((e) => e.type === 'choice')).toMatchObject({ question: 'Is this paid leave?' })
    expect(out1.some((e) => e.type === 'confirm')).toBe(false)

    // Turn 2: the answers → the completion card (awaiting confirmation; nothing completed yet).
    history = [...history, ...t1.newMessages, { role: 'user', content: 'Yes. Comment: Enjoy your time off' }]
    const out2: AssistantEvent[] = []
    const t2 = await run(history, provider({ tool_calls: [call('c2', 'task_complete', { task_id: LEAVE, outcome: 'Approved', comment: 'Enjoy your time off', values: { paid_leave: 'Yes', approver_comment: 'Enjoy your time off' } })] }), out2)
    expect(t2.status).toBe('awaiting_confirmation')
    const confirm = out2.find((e) => e.type === 'confirm') as any
    expect(confirm.card).toMatchObject({ tool: 'task_complete', tool_call_id: 'c2', task: { outcome: 'Approved', next: 'Next: goes to Priya Shah (CFO) for approval' } })
    expect((await row(LEAVE)).status).toBe('in_progress')
    expect(memory.resumes).toHaveLength(0)

    // Turn 3: Confirm → completed, the workflow resume queued, the model summarises.
    history = [...history, ...t2.newMessages]
    const out3: AssistantEvent[] = []
    const t3 = await run(history, provider({ content: 'Approved — it now goes to Priya Shah (CFO).' }), out3, { tool_call_id: 'c2', approved: true })
    expect(t3.status).toBe('completed')
    expect(await row(LEAVE)).toMatchObject({ status: 'completed', outcome: 'Approved', actioned_by: AUDREY })
    expect(memory.resumes).toEqual([expect.objectContaining({ eventId: 'evt-leave' })])
    expect(toolResult(t3.newMessages[0])).toMatchObject({ status: 'completed', workflow_resumed: true })
  })

  it('Cancel on the card leaves the task open', async () => {
    const tools = toolsFor(ctx(AUDREY))
    const args = { task_id: LEAVE, outcome: 'Approved', values: { paid_leave: 'no', approver_comment: 'ok' } }
    const history: ChatMessage[] = [{ role: 'user', content: 'approve it' }]
    const t1 = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history, tools, onEvent: () => {}, fetchImpl: provider({ tool_calls: [call('c1', 'task_complete', args)] }) })
    expect(t1.status).toBe('awaiting_confirmation')
    const t2 = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [...history, ...t1.newMessages], tools, decision: { tool_call_id: 'c1', approved: false }, onEvent: () => {}, fetchImpl: provider({ content: 'OK, left it.' }) })
    expect(t2.status).toBe('completed')
    expect((await row(LEAVE)).status).toBe('in_progress')
  })
})
