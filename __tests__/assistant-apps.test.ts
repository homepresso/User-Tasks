/**
 * The Agent building apps (lib/assistants/tools/apps.ts + designer.ts), with
 * a mocked model and the REAL MCP tools bound to the person over the
 * in-memory store:
 *
 *  - the app tools are a deferred group (offered on an app screen, or after
 *    load_tools) and only for people with the permission; read-only people
 *    get no write tool;
 *  - plan → confirm → apply: the expense-desk prompt drafts one spec; the
 *    card is the plan (pages, widgets, audience) and NOTHING is written
 *    before Confirm; confirming builds it and announces the change;
 *  - a spec with problems never reaches a card: the plain-language errors go
 *    back to the model, which fixes them and calls again;
 *  - an incremental edit ("add a chart of overdue tasks to the Team page");
 *  - a person without Build apps gets a refusal, not a card;
 *  - access grants: the card lists the exact grants; packaging drops the
 *    file bytes;
 *  - parity: every assistant app tool is an MCP tool, and the spec tools are
 *    REST endpoints and CLI commands too; the instructions carry the app
 *    design rules.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows and model payloads */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { designerTools, personMcpContext } from '@/lib/assistants/tools/designer'
import { appWriteResult, describeAppWrite, APPS_RULE, SPEC_PROBLEMS } from '@/lib/assistants/tools/apps'
import { assistantInstructions } from '@/lib/assistants/prompts'
import { DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS, type AssistantEvent, type ChatMessage } from '@/lib/assistants/types'
import { createMcpServer } from '@/lib/mcp/server'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { COMMAND_SPECS } from '../packages/cli/src/generated/commands'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = 'tenant-a'
const ME = '0a000000-0000-4000-8000-000000000001'
const TEAM = '0b000000-0000-4000-8000-000000000001'
const FORM = '0e000000-0000-4000-8000-000000000001'
const WF = '0f000000-0000-4000-8000-000000000001'
const APP = '0d000000-0000-4000-8000-000000000001'
const STAMP = '2026-11-20T10:00:00.000Z'

function seed() {
  return createMemorySupabase({
    apps: [{ id: APP, tenant_id: T, slug: 'team-hub', name: 'Team hub', subtitle: null, description: null, icon: null, color: null, menu: [], settings: {}, created_by: ME, created_at: STAMP, updated_at: STAMP }],
    app_pages: [
      { id: 'p1', tenant_id: T, app_id: APP, slug: 'home', title: 'Home', icon: null, position: 0, layout: { widgets: [] }, filters: [], created_at: STAMP, updated_at: STAMP },
      { id: 'p2', tenant_id: T, app_id: APP, slug: 'team', title: 'Team', icon: null, position: 1, layout: { widgets: [{ id: 'load', type: 'team_workload', w: 6, h: 7, title: 'Workload', config: { team: { filter: 'team' } } }] }, filters: [{ id: 'team', kind: 'team', label: 'Team', default: 'my_teams' }], created_at: STAMP, updated_at: STAMP },
    ],
    app_audience: [],
    app_editors: [{ id: 'e1', tenant_id: T, app_id: APP, user_id: ME }],
    user_teams: [], user_roles: [], object_permissions: [], agents: [], integration_references: [], custom_tables: [], reports: [],
    users: [{ id: ME, team_id: null, display_name: 'Andy', email: 'andy@example.com' }],
    user_memberships: [{ user_id: ME, tenant_id: T, is_active: true }],
    teams: [{ id: TEAM, tenant_id: T, name: 'Finance' }],
    roles: [],
    forms: [{ id: FORM, tenant_id: T, name: 'Expense claim', created_by: ME, version: 1, fields: [], layout: {} }],
    workflows: [{ id: WF, tenant_id: T, name: 'Expense approval', created_by: ME, trigger_type: 'form_submitted', trigger_config: { form_id: FORM }, is_active: true }],
  }, { uuids: true })
}

let db: ReturnType<typeof seed>
beforeEach(() => { db = seed() })

const BUILDER = ['apps.view', 'apps.manage', 'forms.view', 'forms.submit', 'workflows.view', 'team.view_members', 'data.view', 'reports.view']
function tools(perms: string[], opts: { area?: string | null; allTools?: boolean } = {}): AssistantToolDef[] {
  const server = createMcpServer(personMcpContext({ tenantId: T, userId: ME, permissions: new Set(perms), serviceDb: db }))
  return designerTools({ server, permissions: new Set(perms), area: opts.area ?? null, allTools: opts.allTools })
}

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
const toolMessages = (msgs: ChatMessage[]) => msgs.filter((m) => m.role === 'tool').map((m) => String(m.content))

const EXPENSE_PROMPT = 'Build me an expense desk for the finance team: a New claim button, my claims, an approvals queue for managers, and an SLA chart.'
const expenseDesk = (overrides: Record<string, unknown> = {}) => ({
  app: { name: 'Expense desk', subtitle: 'Claims for the finance team', icon: 'Receipt' },
  pages: [
    { title: 'Home', widgets: [
      { type: 'actions', config: { buttons: [{ label: 'New claim', icon: 'Plus', action: { kind: 'new_submission', form_id: FORM } }] } },
      { type: 'my_submissions', title: 'My claims', config: { form_id: FORM } },
    ] },
    { title: 'Approvals', min_role: 'contributor', widgets: [
      { type: 'task_list', title: 'Waiting for my approval', config: { scope: 'queue', workflow_id: WF } },
      { type: 'sla_trend', title: 'Approval SLA', config: { workflow_id: WF } },
    ] },
  ],
  audience: [{ type: 'team', id: TEAM, role: 'contributor' }],
  ...overrides,
})

describe('which app tools the Agent offers', () => {
  it('builders get the app tools as a deferred group (offered on an app screen); read-only people get no write', () => {
    const general = tools(BUILDER)
    expect(general.find((t) => t.name === 'apps_apply_spec')).toMatchObject({ mode: 'write', group: 'apps' })
    expect(general.find((t) => t.name === 'load_tools')?.description).toMatch(/apps \(apps: build or change a whole app/)
    const onApp = tools(BUILDER, { area: 'app' })
    expect(onApp.find((t) => t.name === 'apps_apply_spec')?.group).toBeUndefined()
    const none = tools(['forms.view'])
    expect(none.some((t) => t.name.startsWith('apps_'))).toBe(false)
    // The raw widget catalogue is not an Agent tool (full schemas come from apps_spec_reference).
    expect(general.some((t) => t.name === 'apps_widget_types')).toBe(false)
  })

  it('the building instructions carry the app rules only when the app tools are offered', () => {
    expect(assistantInstructions({ groups: ['designer'], canBuild: true, apps: true })).toContain(APPS_RULE)
    expect(assistantInstructions({ groups: ['designer'], canBuild: true })).not.toContain(APPS_RULE)
    for (const s of ['apps_spec_reference', 'apps_search', 'ONE app spec', 'no raw colours', 'contributors', 'screenshot']) expect(APPS_RULE).toContain(s)
  })
})

describe('plan → confirm → apply (the expense desk)', () => {
  it('looks things up, shows the plan card, writes nothing before Confirm, then builds the app', async () => {
    const t = tools(BUILDER)
    const events: AssistantEvent[] = []
    const p = provider(
      { tool_calls: [call('l1', 'load_tools', { groups: ['apps'] })] },
      { tool_calls: [call('r1', 'apps_spec_reference', {}), call('s1', 'apps_search', { kind: 'form', q: 'expense' }), call('s2', 'apps_search', { kind: 'workflow', q: 'expense' }), call('s3', 'apps_search', { kind: 'team', q: 'finance' })] },
      { tool_calls: [call('a1', 'apps_apply_spec', expenseDesk())] },
    )
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }], tools: t, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    // The app tools were offered only after load_tools.
    expect(p.bodies[0].tools.some((x: any) => x.function.name === 'apps_apply_spec')).toBe(false)
    expect(p.bodies[2].tools.some((x: any) => x.function.name === 'apps_apply_spec')).toBe(true)
    const results = toolMessages(r.newMessages)
    expect(results.some((c) => c.includes('Expense claim') && c.includes(FORM))).toBe(true)
    expect(results.some((c) => c.includes('Building apps: an app is pages of widgets'))).toBe(true)
    const card = events.find((e) => e.type === 'confirm') as Extract<AssistantEvent, { type: 'confirm' }>
    expect(card.card).toMatchObject({ tool: 'apps_apply_spec', title: 'Build app “Expense desk”', confirm_label: 'Build app' })
    expect(card.card.lines).toEqual(expect.arrayContaining(['Home page “Home” (/home): 2 widgets', 'New page “Approvals” (/approvals): 2 widgets', 'Shared with: Team Finance (contributor)']))
    expect(card.card.preview?.rows.map((row) => row[1])).toEqual(['Buttons: “New claim”', 'My submissions “My claims” (Expense claim)', 'Task list “Waiting for my approval” (Expense approval)', 'SLA trend “Approval SLA” (Expense approval)'])
    // Nothing written before the person confirms.
    expect(db.tables.apps).toHaveLength(1)

    const events2: AssistantEvent[] = []
    const p2 = provider({ content: 'Built **Expense desk**.' })
    const r2 = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }, ...r.newMessages], tools: t, decision: { tool_call_id: 'a1', approved: true }, onEvent: (e) => events2.push(e), fetchImpl: p2.fetchImpl })
    expect(r2.status).toBe('completed')
    expect(db.tables.apps.map((a: any) => a.slug)).toEqual(['team-hub', 'expense-desk'])
    expect(events2.find((e) => e.type === 'changed')).toMatchObject({ kind: 'app', title: 'Expense desk', href: '/apps/expense-desk/home?edit=1', action: 'created' })
    const applied = JSON.parse(JSON.parse(toolMessages(r2.newMessages)[0]).result)
    expect(applied).toMatchObject({ applied: true, app: { slug: 'expense-desk' } })
    expect(applied.next).toMatch(/access issue|Link the app/)
  })

  it('declining writes nothing', async () => {
    const t = tools(BUILDER, { area: 'app' })
    const p = provider({ tool_calls: [call('a1', 'apps_apply_spec', expenseDesk())] })
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }], tools: t, onEvent: () => {}, fetchImpl: p.fetchImpl })
    await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }, ...r.newMessages], tools: t, decision: { tool_call_id: 'a1', approved: false }, onEvent: () => {}, fetchImpl: provider({ content: 'OK' }).fetchImpl })
    expect(db.tables.apps).toHaveLength(1)
  })

  it('a spec with problems comes back to the model as plain-language errors (no card), and the fixed spec gets the card', async () => {
    const t = tools(BUILDER, { area: 'app' })
    const events: AssistantEvent[] = []
    const bad = expenseDesk({ pages: [{ title: 'Home', widgets: [{ type: 'barchart' }, { type: 'chart', title: 'By status', config: { group_by: 'state' } }] }] })
    const p = provider(
      { tool_calls: [call('a1', 'apps_apply_spec', bad)] },
      { tool_calls: [call('a2', 'apps_apply_spec', expenseDesk())] },
    )
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }], tools: t, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    const first = JSON.parse(JSON.parse(toolMessages(r.newMessages)[0]).result)
    expect(first.error).toContain(SPEC_PROBLEMS)
    expect(first.errors[0]).toMatch(/^Page 1 “Home” › widget 1: unknown widget type "barchart"/)
    expect(first.errors[1]).toMatch(/group_by: use one of "time"/)
    const cards = events.filter((e) => e.type === 'confirm') as Array<Extract<AssistantEvent, { type: 'confirm' }>>
    expect(cards.map((c) => c.card.tool_call_id)).toEqual(['a2'])
    expect(db.tables.apps).toHaveLength(1)
  })

  it('without Build apps: a refusal the model can explain, never a card', async () => {
    const perms = BUILDER.filter((p) => p !== 'apps.manage')
    const events: AssistantEvent[] = []
    const p = provider({ tool_calls: [call('a1', 'apps_apply_spec', expenseDesk())] }, { content: 'You need Build apps.' })
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: EXPENSE_PROMPT }], tools: tools(perms, { area: 'app' }), onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(events.some((e) => e.type === 'confirm')).toBe(false)
    expect(toolMessages(r.newMessages)[0]).toMatch(/Creating an app needs Build apps/)
  })
})

describe('incremental edits', () => {
  it('"add a chart of overdue tasks to the Team page": reads the page, one card, then only that page changes', async () => {
    const t = tools(BUILDER, { area: 'app' })
    const events: AssistantEvent[] = []
    const change = { app_id: APP, pages: [{ page: 'team', add_widgets: [{ type: 'chart', title: 'Overdue tasks by person', config: { source: 'tasks', group_by: 'assignee', status: 'open', team: { filter: 'team' } }, after: 'load' }] }] }
    const p = provider({ tool_calls: [call('g1', 'apps_page_get', { app_id: APP, page_id: 'team' })] }, { tool_calls: [call('a1', 'apps_apply_spec', change)] })
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'Add a chart of overdue tasks to the Team page' }], tools: t, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card).toMatchObject({ title: 'Update app “Team hub”', confirm_label: 'Apply changes' })
    expect(card.lines[0]).toBe('Page “Team”: add Chart “Overdue tasks by person”')
    // Drafts: the change goes to the app's draft (the card says so; the audience keeps the published version).
    expect(card.lines).toContain('Saved as a draft — the app’s audience keeps seeing the published version until you publish')
    expect((db.tables.app_pages.find((x: any) => x.slug === 'team' && x.app_id === APP) as any).layout.widgets).toHaveLength(1)
    await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'Add a chart' }, ...r.newMessages], tools: t, decision: { tool_call_id: 'a1', approved: true }, onEvent: () => {}, fetchImpl: provider({ content: 'Added.' }).fetchImpl })
    expect((db.tables.app_pages.find((x: any) => x.slug === 'team' && x.app_id === APP) as any).layout.widgets.map((w: any) => w.id)).toEqual(['load', 'chart-1'])
  })
})

describe('access grants and packaging cards', () => {
  it('the grant card lists the exact grants; nothing grantable is a precheck for the model', async () => {
    const analysis = { gaps: [
      { key: 'k1', principal: { type: 'team', id: TEAM, name: 'Team Finance' }, object: { id: FORM, name: 'Expense claim' }, fix: { kind: 'grant', can_grant: true } },
      { key: 'k2', principal: { type: 'role', id: 'r', name: 'Role Execs' }, object: { id: FORM, name: 'Expense claim' }, fix: { kind: 'ask', who: 'an admin' }, message: 'Execs can’t submit' },
    ] }
    const read = vi.fn(async () => analysis)
    const card = await describeAppWrite('apps_access_grant', { app_id: APP }, read)
    expect(card.lines).toEqual(['Team Finance: View + Submit on form “Expense claim”'])
    await expect(describeAppWrite('apps_access_grant', { app_id: APP, keys: ['k2'] }, read)).rejects.toThrow(/None of these access issues is one you can fix/)
  })

  it('packaging: the card is the preview; the result never carries the file', async () => {
    const card = await describeAppWrite('apps_package', { app_id: APP }, async () => ({ app: { name: 'Expense desk' }, package: null, contents: { items: [{ type: 'form' }, { type: 'workflow' }, { type: 'form' }] }, embed_origins: [] }))
    expect(card.lines).toContain('Includes 2 forms, 1 workflow')
    const events: AssistantEvent[] = []
    const out = appWriteResult('apps_package', { package: { id: 'pk', name: 'Expense desk' }, version: { version: '1.0.0' }, file_base64: 'UEsDB...', file_name: 'x.utpkg' }, { emit: (e) => events.push(e), toolCallId: 'x' })
    expect(out.file_base64).toBeUndefined()
    expect(events[0]).toMatchObject({ type: 'changed', kind: 'package', title: 'Expense desk 1.0.0' })
  })
})

describe('drafts: Publish now buttons and the publish / discard / restore cards', () => {
  it('after a draft apply the person gets Publish now / Keep it as a draft; the model is told not to publish unasked', () => {
    const events: AssistantEvent[] = []
    const out = appWriteResult('apps_apply_spec', { applied: true, mode: 'edit', app: { id: APP, slug: 'team-hub', name: 'Team hub' }, href: '/apps/team-hub', builder_href: '/apps/team-hub/home?edit=1', preview_href: '/apps/team-hub/home?preview=1', saved_as: 'draft', version: null, access: null }, { emit: (e) => events.push(e), toolCallId: 'a1' })
    const choice = events.find((e) => e.type === 'choice') as any
    expect(choice.options.map((o: any) => o.label)).toEqual(['Publish now', 'Keep it as a draft'])
    expect(out.next).toMatch(/Saved as a DRAFT/)
    expect(out.next).toMatch(/call apps_publish .* only when they choose to publish/)
    // Published in the same step (publish: true): no buttons.
    const after: AssistantEvent[] = []
    appWriteResult('apps_apply_spec', { applied: true, mode: 'edit', app: { id: APP, slug: 'team-hub', name: 'Team hub' }, saved_as: 'published', version: 2, access: null }, { emit: (e) => after.push(e), toolCallId: 'a2' })
    expect(after.some((e) => e.type === 'choice')).toBe(false)
  })

  it('the publish card lists what changes and the access issues; problems are a precheck', async () => {
    const read = vi.fn(async (name: string) => name === 'apps_compare'
      ? { from: { version: 1 }, publish_problems: [], diff: { unchanged: false, lines: ['Added 1 page: “Team”'] } }
      : name === 'apps_get' ? { name: 'Team hub' } : { gaps: [{}, {}] })
    const card = await describeAppWrite('apps_publish', { app_id: APP }, read)
    expect(card).toMatchObject({ title: 'Publish app “Team hub”', confirm_label: 'Publish', lines: ['Added 1 page: “Team”'] })
    expect(card.warnings.join('\n')).toMatch(/2 access issues/)
    const blocked = vi.fn(async (name: string) => name === 'apps_compare' ? { from: { version: 1 }, publish_problems: ['The app has no pages: add at least one page'], diff: { unchanged: false, lines: [] } } : { name: 'Team hub' })
    await expect(describeAppWrite('apps_publish', { app_id: APP }, blocked)).rejects.toThrow(/can't be published yet/)
    const discard = await describeAppWrite('apps_draft_discard', { app_id: APP }, read)
    expect(discard).toMatchObject({ danger: true, confirm_label: 'Discard draft' })
  })
})

describe('MCP / REST / CLI parity', () => {
  it('every assistant app tool is an MCP tool; the spec tools are REST endpoints and CLI commands', () => {
    const mcp = new Set(createMcpServer({ tenantId: 't1', supabase: {} }).getRegisteredTools().map((x) => x.name))
    for (const name of [...DESIGNER_READ_TOOLS, ...DESIGNER_WRITE_TOOLS].filter((n) => n.startsWith('apps_'))) expect(mcp.has(name), name).toBe(true)
    const rest = new Set(API_ENDPOINTS.map((e) => `${e.method} ${e.path}`))
    for (const op of ['POST /apps/spec/plan', 'POST /apps/spec/apply', 'GET /apps/spec/search', 'GET /apps/spec/reference', 'GET /apps/spec/object']) expect(rest.has(op), op).toBe(true)
    const cli = new Set(COMMAND_SPECS.map((c) => `${c.resource} ${c.verb}`))
    for (const c of ['apps plan', 'apps apply', 'apps search', 'apps spec-reference', 'apps object']) expect(cli.has(c), c).toBe(true)
  })

  it('MCP apps_plan and apps_apply_spec run as the key\'s user (an external agent builds the same app)', async () => {
    const server = createMcpServer({ ...personMcpContext({ tenantId: T, userId: ME, permissions: new Set(BUILDER), serviceDb: db }), via: undefined })
    const plan = JSON.parse((await server.callTool('apps_plan', expenseDesk()) as any).content[0].text)
    expect(plan.valid).toBe(true)
    const applied = JSON.parse((await server.callTool('apps_apply_spec', expenseDesk()) as any).content[0].text)
    expect(applied.app.slug).toBe('expense-desk')
  })
})
