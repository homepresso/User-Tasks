/**
 * "Ask Agent to fix": the failure context is built from what the test runner
 * shows and redacted; the button needs the Agent + edit permission; the Agent
 * diagnoses and proposes a draft fix behind a confirmation, or explains when
 * there is no safe fix.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildFailureContext, canAskAgentToFix, failureAttachment, runFailureInput, upstreamSteps, FAILURE_CONTEXT_MAX_CHARS } from '@/lib/assistants/failure'
import { runAssistantTurn, buildModelMessages } from '@/lib/assistants/engine'
import { designerTools } from '@/lib/assistants/tools/designer'
import { ATTACH_OPEN } from '@/lib/assistants/attachments-core'
import { NO_ASSISTANTS, type AssistantEvent, type ChatMessage } from '@/lib/assistants/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const NODES = [
  { id: 'start', type: 'start', label: 'Start', config: {} },
  { id: 'calc', type: 'set_variable', label: 'Pick date', config: { assignments: [{ name: 'when', expression: '{{start_date}}' }] } },
  { id: 'wait', type: 'pause_until', label: 'Wait until start', config: { until: '{{when}}', api_key: 'sk-live-SECRET' } },
]
const EDGES = [{ source: 'start', target: 'calc' }, { source: 'calc', target: 'wait' }]
const input = {
  workflow: { id: 'w1', name: 'Onboarding' }, nodes: NODES, edges: EDGES, failedNodeId: 'wait',
  error: 'Invalid date: "next Friday"', logs: [{ level: 'error', message: 'Failed: Wait until start — Invalid date: "next Friday"', node_id: 'wait' }],
  inputs: { start_date: 'next Friday', password: 'hunter2', notes: 'x'.repeat(2000) }, source: 'test' as const,
}

describe('failure context', () => {
  it('has the failed step, its config, the error, upstream steps, inputs and logs — secrets masked, long values capped', () => {
    const c = buildFailureContext(input) as any
    expect(c.failed_step).toMatchObject({ id: 'wait', type: 'pause_until', label: 'Wait until start' })
    expect(c.error).toContain('next Friday')
    expect(c.upstream_steps.map((s: any) => s.id)).toEqual(['calc', 'start'])
    const json = JSON.stringify(c)
    expect(json).not.toContain('sk-live-SECRET')
    expect(json).not.toContain('hunter2')
    expect(c.inputs.notes.length).toBeLessThan(600)
    expect(c.recent_logs[0].step).toBe('wait')
    expect(upstreamSteps('wait', EDGES, 1)).toEqual(['calc'])
  })
  it('becomes a size-capped text attachment, placed in the untrusted attachment block', () => {
    const a = failureAttachment({ ...input, logs: Array.from({ length: 500 }, (_, i) => ({ level: 'info', message: `line ${i} ${'y'.repeat(400)}` })) })
    expect(a.kind).toBe('text')
    expect(a.text!.length).toBeLessThanOrEqual(FAILURE_CONTEXT_MAX_CHARS + 20)
    const msgs = buildModelMessages('SYS', [{ role: 'user', content: 'fix', attachments: [failureAttachment(input)] }], null)
    expect(String(msgs[0].content)).not.toContain('next Friday')
    expect(String(msgs[1].content)).toContain(ATTACH_OPEN)
    expect(String(msgs[1].content)).toContain('next Friday')
  })
})

describe('the button', () => {
  it('only with the Agent available, building help, and edit permission on the workflow', () => {
    expect(canAskAgentToFix({ ...NO_ASSISTANTS, agent: true, designer: true }, true)).toBe(true)
    expect(canAskAgentToFix({ ...NO_ASSISTANTS, agent: true, designer: true }, false)).toBe(false)
    expect(canAskAgentToFix({ ...NO_ASSISTANTS, agent: true }, true)).toBe(false)
    expect(canAskAgentToFix(null, true)).toBe(false)
  })
})

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

describe('diagnosis and fix', () => {
  const history: ChatMessage[] = [{ role: 'user', content: 'This workflow failed. Find the cause…', attachments: [failureAttachment(input)] }]

  it('diagnosis + a draft fix behind a confirmation; confirming updates the draft', async () => {
    const update = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ updated: true, workflow: { id: 'w1', name: 'Onboarding' } }) }] }))
    const server = { getHandler: (name: string) => (name === 'workflows_update' ? update : vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ definition: { name: 'Onboarding', nodes: NODES } }) }] }))) }
    const tools = designerTools({ server: server as any, permissions: new Set(['workflows.view', 'workflows.edit']), checkWorkflow: () => [] })
    const fixed = NODES.map((n) => (n.id === 'calc' ? { ...n, config: { assignments: [{ name: 'when', expression: '{{=DATEVALUE(start_date)}}' }] } } : n))
    const p = provider({ content: '`Wait until start` got “next Friday”, which isn\'t a date. I\'ll convert it first.', tool_calls: [call('f1', 'workflows_update', { workflow_id: 'w1', nodes: JSON.stringify(fixed) })] })
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history, tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    expect(update).not.toHaveBeenCalled()
    const done = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [...history, ...r.newMessages], tools, decision: { tool_call_id: 'f1', approved: true }, onEvent: (e) => events.push(e), fetchImpl: provider({ content: 'Fixed — re-run the test.' }).fetchImpl })
    expect(done.status).toBe('completed')
    expect(update).toHaveBeenCalledTimes(1)
    expect(events.find((e) => e.type === 'changed')).toMatchObject({ kind: 'workflow', id: 'w1', action: 'updated' })
  })

  it('no safe fix: the Agent explains and nothing is changed', async () => {
    const update = vi.fn()
    const tools = designerTools({ server: { getHandler: () => update } as any, permissions: new Set(['workflows.view', 'workflows.edit']) })
    const p = provider({ content: 'The external API answered 503 (unavailable). That is not something to change in the workflow — try again later or check the integration.' })
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history, tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('completed')
    expect(events.some((e) => e.type === 'confirm')).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('failed real runs (run history / process view)', () => {
  const wf = { id: 'w1', name: 'Onboarding', nodes: NODES, edges: EDGES, trigger_type: 'manual' }
  it('builds the failure from the run: failed step, its error, variables masked; real-run rules', () => {
    const run = { status: 'failed', error: 'Run failed', node_results: { start: { status: 'completed' }, wait: { status: 'error', error: 'Invalid date: "next Friday"' } }, variables: { start_date: 'next Friday', api_token: 'tok-123' } }
    const fi = runFailureInput(run, wf, [{ level: 'error', message: 'boom', node_id: 'wait' }])!
    expect(fi.source).toBe('run')
    expect(fi.failedNodeId).toBe('wait')
    expect(fi.error).toBe('Invalid date: "next Friday"')
    const c = buildFailureContext(fi) as any
    expect(c.kind).toBe('workflow run failure')
    expect(c.rules).toMatch(/never change data or retry/)
    expect(JSON.stringify(c)).not.toContain('tok-123')
    const a = failureAttachment(fi)
    expect(a.name.startsWith('Run failure')).toBe(true)
    expect(a.note).toMatch(/run history/)
  })
  it('falls back to the error log step and the run error; null unless the run failed', () => {
    const fi = runFailureInput({ status: 'failed', error: 'Timed out', node_results: {} }, wf, [{ level: 'error', message: 'x', node_id: 'calc' }])!
    expect(fi.failedNodeId).toBe('calc')
    expect(fi.error).toBe('Timed out')
    expect(runFailureInput({ status: 'completed' }, wf)).toBeNull()
    expect(runFailureInput({ status: 'failed' }, null)).toBeNull()
  })
})
