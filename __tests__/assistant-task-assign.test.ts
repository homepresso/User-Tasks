/**
 * The Agent's task assignment tools (lib/assistants/tools/task-assign.ts):
 * write tools behind a confirmation card naming the task, the old and new
 * assignee and the reason; the same rules as the app (a manager reassigns a
 * direct report's task, an admin takes an unassigned task, a member who is
 * not a manager is refused); audit and history are written; and the
 * task-help prompt no longer says the Agent can't assign (it still never
 * completes). The provider is a mocked fetch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const memory = vi.hoisted(() => ({ db: null as any, audits: [] as any[] }))
vi.mock('@/lib/services/_shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/_shared')>()
  return { ...actual, serviceRoleClient: async () => memory.db }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async (entry: any) => { memory.audits.push(entry) }) }))

import { runAssistantTurn } from '@/lib/assistants/engine'
import { taskAssignTools } from '@/lib/assistants/tools/task-assign'
import { assistantInstructions } from '@/lib/assistants/prompts'

const T = 'ta'
const id = (n: number) => `0b000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ANA = id(1), BEN = id(2), MIA = id(3), OWEN = id(4), BOB = id(5)
const REPORT_TASK = id(11), UNASSIGNED = id(12)

function seed() {
  return createMemorySupabase({
    tasks: [
      { id: REPORT_TASK, tenant_id: T, title: 'Expense claim', status: 'todo', is_workflow_task: true, event_id: 'e1', assignee_id: ANA, acceptance_status: 'accepted', metadata: {} },
      { id: UNASSIGNED, tenant_id: T, title: 'Approve leave', status: 'todo', is_workflow_task: true, event_id: 'e2', assignee_id: null, assigned_team_id: null, acceptance_status: 'pending', metadata: {} },
    ],
    users: [[ANA, 'Ana'], [BEN, 'Ben'], [MIA, 'Mia'], [OWEN, 'Owen'], [BOB, 'Bob']].map(([uid, name]) => ({ id: uid, display_name: name, email: `${name.toLowerCase()}@x` })),
    user_memberships: [
      { tenant_id: T, user_id: ANA, manager_user_id: MIA, is_active: true },
      { tenant_id: T, user_id: BEN, manager_user_id: MIA, is_active: true },
      { tenant_id: T, user_id: MIA, manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: OWEN, manager_user_id: null, is_active: true },
      { tenant_id: T, user_id: BOB, manager_user_id: null, is_active: true },
    ],
    teams: [], task_assignees: [], user_teams: [], object_permissions: [], user_roles: [], lifecycle_events: [], notifications: [],
  })
}

const ctx = (actorId: string, extra: string[] = []): ServiceContext => ({
  db: memory.db, supabase: memory.db, tenantId: T, actorId, permissions: new Set(['tasks.complete', 'tasks.view_own', ...extra]), authKind: 'session', source: 'ui',
})
const tool = (c: ServiceContext, name: string, taskId: string | null = null) => taskAssignTools({ ctx: c, taskId }).find((t) => t.name === name)!
const read = async (table: string, filter: Record<string, unknown>) => {
  let q = memory.db.from(table).select('*')
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v)
  return ((await q).data ?? []) as any[]
}

const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
function provider(...replies: Array<{ content?: string | null; tool_calls?: any[] }>) {
  let n = 0
  return vi.fn(async () => {
    const msg = replies[Math.min(n++, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
}

describe('Agent task assignment tools', () => {
  beforeEach(() => { memory.db = seed(); memory.audits = [] })

  it('every change is a write tool (confirmation first); none completes a task', () => {
    const tools = taskAssignTools({ ctx: ctx(MIA), taskId: null })
    expect(tools.filter((t) => t.mode === 'write').map((t) => t.name)).toEqual(['task_take_ownership', 'task_assign', 'task_claim'])
    expect(tools.map((t) => t.name).filter((n) => /complete|approve|decline|reject|outcome/.test(n))).toEqual([])
  })

  it('a manager reassigns a direct report\'s task: the card names the task, old → new and the reason; history + audit written', async () => {
    const t = tool(ctx(MIA), 'task_assign')
    const args = { task_id: REPORT_TASK, assignee_user_id: BEN, reason: 'Ana is on leave' }
    const card = await t.confirm!(args)
    expect(card.title).toBe('Reassign “Expense claim”')
    expect(card.lines).toEqual(['From: Ana', 'To: Ben', 'Reason: Ana is on leave'])
    const events: AssistantEvent[] = []
    const out = await t.run(args, { emit: (e) => events.push(e), toolCallId: 'c1' })
    expect(out.result).toMatchObject({ assignee_id: BEN, previous_assignee_id: ANA, basis: 'manager' })
    expect((await read('tasks', { id: REPORT_TASK }))[0].assignee_id).toBe(BEN)
    expect((await read('lifecycle_events', { task_id: REPORT_TASK }))[0]).toMatchObject({ event_type: 'reassigned', actor_id: MIA, metadata: { old_assignee: ANA, new_assignee: BEN, via: 'agent' } })
    expect(memory.audits[0]).toMatchObject({ action: 'reassign', objectId: REPORT_TASK, metadata: { agent: true, from: ANA, to: BEN } })
    expect(events).toContainEqual(expect.objectContaining({ type: 'changed', kind: 'task', id: REPORT_TASK }))
  })

  it('an admin takes an unassigned task', async () => {
    const t = tool(ctx(OWEN, ['tasks.complete_any']), 'task_take_ownership', UNASSIGNED)
    const card = await t.confirm!({})
    expect(card).toMatchObject({ title: 'Take ownership of “Approve leave”', confirm_label: 'Take ownership' })
    expect(card.lines[0]).toBe('From: Unassigned')
    await t.run({}, { emit: () => {}, toolCallId: 'c2' })
    expect((await read('tasks', { id: UNASSIGNED }))[0]).toMatchObject({ assignee_id: OWEN, acceptance_status: 'accepted' })
    expect((await read('lifecycle_events', { task_id: UNASSIGNED }))[0].metadata).toMatchObject({ took_ownership: true })
  })

  it('a member who is not a manager is refused (no card), and the task is unchanged', async () => {
    await expect(tool(ctx(BOB), 'task_assign').confirm!({ task_id: REPORT_TASK, assignee_user_id: BEN })).rejects.toThrow(/Forbidden/)
    await expect(tool(ctx(BOB), 'task_take_ownership').confirm!({ task_id: UNASSIGNED })).rejects.toThrow(/admin or a manager of the workflow/)
    await expect(tool(ctx(BOB), 'task_assign').run({ task_id: REPORT_TASK, assignee_user_id: BEN }, { emit: () => {}, toolCallId: 'x' })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await read('tasks', { id: REPORT_TASK }))[0].assignee_id).toBe(ANA)
    expect(memory.audits).toHaveLength(0)
  })

  it('the turn stops at the confirmation; only the person\'s approval reassigns', async () => {
    const tools = taskAssignTools({ ctx: ctx(MIA), taskId: REPORT_TASK })
    const call = { id: 'call_1', type: 'function', function: { name: 'task_assign', arguments: JSON.stringify({ assignee_user_id: BEN, reason: 'Leave' }) } }
    const events: AssistantEvent[] = []
    const first = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'Give this to Ben' }], tools, onEvent: (e) => events.push(e), fetchImpl: provider({ tool_calls: [call] }) })
    expect(first.status).toBe('awaiting_confirmation')
    expect(events.find((e) => e.type === 'confirm')).toMatchObject({ card: { title: 'Reassign “Expense claim”', tool: 'task_assign' } })
    expect((await read('tasks', { id: REPORT_TASK }))[0].assignee_id).toBe(ANA)
    const history: ChatMessage[] = [{ role: 'user', content: 'Give this to Ben' }, ...first.newMessages]
    const second = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history, tools, decision: { tool_call_id: 'call_1', approved: true }, onEvent: () => {}, fetchImpl: provider({ content: 'Done — Ben has it.' }) })
    expect(second.status).toBe('completed')
    expect((await read('tasks', { id: REPORT_TASK }))[0].assignee_id).toBe(BEN)
  })

  it('the task-help prompt allows assigning through the tools and still never completing', () => {
    const text = assistantInstructions('task')
    expect(text).toContain('task_take_ownership')
    expect(text).toContain('task_assign')
    expect(text).not.toMatch(/NEVER complete, approve, reject, redirect, reassign/)
    expect(text).toMatch(/You can NEVER complete, approve, reject or decline the task/)
  })
})
