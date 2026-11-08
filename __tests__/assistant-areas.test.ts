/**
 * The Agent everywhere: each area's screen context (route → area / open item),
 * the building tools per area and permission (reports, workflow agents, email
 * templates, integrations — reads for viewers, writes for editors, confirmed),
 * agent writes that list every grant and start inactive, and the Agent moving
 * into an open modal editor.
 */
import { describe, expect, it, vi } from 'vitest'
import { designerAreaForPath, screenLabel, hostDialog } from '@/components/assistants/assistant-host'
import { allowedDesignerToolNames, designerTools, draftOnlyArgs } from '@/lib/assistants/tools/designer'
import { runAssistantTurn } from '@/lib/assistants/engine'
import { DESIGNER_STARTERS, type AssistantEvent } from '@/lib/assistants/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ID = '0c8ba0c3-6cec-4f13-a73e-0097d95fe2fb'

describe('screen context per area', () => {
  it('maps routes to areas and open items', () => {
    expect(designerAreaForPath(`/reports/${ID}`)).toEqual({ area: 'report', item_id: ID })
    expect(designerAreaForPath('/reports/builder')).toEqual({ area: 'report' })
    expect(designerAreaForPath(`/agents/${ID}`)).toEqual({ area: 'agent', item_id: ID })
    expect(designerAreaForPath('/agents/costs')).toEqual({ area: 'agent' })
    expect(designerAreaForPath(`/integrations/${ID}`)).toEqual({ area: 'integration', item_id: ID })
    expect(designerAreaForPath('/automations/email-templates')).toEqual({ area: 'email_template' })
    expect(designerAreaForPath(`/automations/${ID}`)).toEqual({ area: 'workflow', item_id: ID })
    expect(designerAreaForPath('/home')).toBeNull()
    expect(screenLabel({ pathname: '/reports/builder', surface: null, designer: { area: 'report', item_id: ID, item_name: 'Requests' } })).toBe('Report “Requests”')
  })
  it('has starter prompts per area', () => {
    expect(DESIGNER_STARTERS.report).toContain('Add a chart of requests by department')
    expect(DESIGNER_STARTERS.agent).toContain('Write instructions for an agent that triages support emails')
  })
})

describe('tools per area and permission', () => {
  it('viewers get reads only; editors get the writes of their areas', () => {
    const viewer = allowedDesignerToolNames(new Set(['reports.view', 'agents.view', 'integrations.view', 'workflows.view']))
    expect(viewer).toEqual(expect.arrayContaining(['reports_list', 'reports_get', 'reports_preview', 'agents_get', 'integrations_get', 'email_templates_get']))
    expect(viewer.filter((n) => /_(create|update|test)$/.test(n) && n !== 'decision_tables_test')).toEqual([])
    const reports = allowedDesignerToolNames(new Set(['reports.view', 'reports.create', 'reports.edit_own']))
    expect(reports).toEqual(expect.arrayContaining(['reports_create', 'reports_update']))
    expect(reports).not.toContain('agents_create')
    const agents = allowedDesignerToolNames(new Set(['agents.view', 'agents.create', 'agents.edit']))
    expect(agents).toEqual(expect.arrayContaining(['agents_create', 'agents_update']))
    // Never: deleting agents, running them, evals, raw integration secrets / create / update.
    const all = allowedDesignerToolNames(new Set(['agents.view', 'agents.create', 'agents.edit', 'agents.delete', 'agents.test', 'integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test']))
    expect(all.filter((n) => /agents_(delete|execute|eval)|integrations_(create|update|delete)|connectors_(create|update)/.test(n))).toEqual([])
    expect(all).toContain('integrations_test')
  })

  it('a new workflow agent is created inactive; is_active cannot be changed by an update', () => {
    expect(draftOnlyArgs('agents_create', { name: 'A', is_active: true }).is_active).toBe(false)
    expect('is_active' in draftOnlyArgs('agents_update', { agent_id: 'a', is_active: true })).toBe(false)
  })

  it('agent and report writes wait for confirmation; the agent card lists every grant and powerful tool', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ agent: { id: 'a1', name: 'Triage' } }) }] }))
    const tools = designerTools({ server: { getHandler: () => handler } as any, permissions: new Set(['agents.view', 'agents.create', 'reports.view', 'reports.create']) })
    const events: AssistantEvent[] = []
    const call = { id: 'c', type: 'function', function: { name: 'agents_create', arguments: JSON.stringify({ name: 'Triage', system_prompt: 'Triage support emails', tools: JSON.stringify([{ name: 'http_post' }, { name: 'query_data_table' }]), output_config: JSON.stringify({ data_access: { grants: [{ table_id: '12345678-aaaa', read: true, delete: true }] }, task_access: true }) }) } }
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] }), { status: 200 }))
    const r = await runAssistantTurn({ connection: { provider: 'openai', model: 'm', url: 'https://x/v1/chat/completions', headers: {}, baseUrl: 'https://x' }, instructions: 'I', context: null, history: [{ role: 'user', content: 'draft an agent' }], tools, onEvent: (e) => events.push(e), fetchImpl: fetchImpl as any })
    expect(r.status).toBe('awaiting_confirmation')
    expect(handler).not.toHaveBeenCalled()
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card.title).toBe('Create agent “Triage”')
    expect(card.warnings.join(' ')).toMatch(/Powerful tools: “http_post”/)
    expect(card.warnings.join(' ')).toMatch(/Data access: read\/delete on table/)
    expect(card.warnings.join(' ')).toMatch(/Task access/)
    expect(card.lines.join(' ')).toMatch(/Created inactive/)
  })
})

describe('inside a modal editor', () => {
  it('the topmost big open dialog hosts the Agent; small confirmations and the Agent\'s own sheet do not', () => {
    const el = (attrs: Record<string, string>, w: number, h: number, parent?: any) => ({ attrs, closest: (sel: string) => (sel === '[data-assistant-panel]' && parent?.panel ? parent : null), hasAttribute: (a: string) => a in attrs, getAttribute: (a: string) => attrs[a] ?? null, getBoundingClientRect: () => ({ width: w, height: h }) })
    const doc = (list: any[]) => ({ querySelectorAll: () => list }) as any
    const big = el({ role: 'dialog', 'data-state': 'open' }, 1200, 800)
    const small = el({ role: 'dialog', 'data-state': 'open' }, 400, 200)
    const sheet = el({ role: 'dialog', 'data-state': 'open', 'data-assistant-panel': 'sheet' }, 390, 800)
    expect(hostDialog(doc([big]))).toBe(big)
    expect(hostDialog(doc([big, small]))).toBeNull()
    expect(hostDialog(doc([big, sheet]))).toBe(big)
    expect(hostDialog(doc([]))).toBeNull()
    // A settings sheet with its own footer opts out (the Agent button would cover its primary action).
    expect(hostDialog(doc([el({ role: 'dialog', 'data-state': 'open', 'data-agent-no-host': '' }, 640, 900)]))).toBeNull()
  })
})
