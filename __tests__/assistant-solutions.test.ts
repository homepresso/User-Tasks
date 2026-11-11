/**
 * Whole solutions with the Agent: the Solution blueprint in the prompt, the
 * packaging question, build_plan's raised cap and sections, the checks every
 * item passes before the card (lookup columns, Data table fields, admin-form
 * "For each changed row" steps, report columns and charts), parent → child id
 * substitution, packaging every created item (create → build 1.0.0 →
 * register as installed for one-click uninstall), "Add to package", sharing
 * to the gallery through its confirmed submission flow, the redirect default
 * on Agent-built User Tasks, and an end-to-end mocked build of the
 * purchase-request example. The LLM is mocked throughout.
 */
import { describe, expect, it, vi } from 'vitest'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { designerTools, draftOnlyArgs } from '@/lib/assistants/tools/designer'
import { buildPlanTools, itemProblems, normalizePlan, MAX_PLAN_ITEMS, substituteRefs } from '@/lib/assistants/tools/build-plan'
import { packageItems, UNINSTALL_NOTE, normalizePackageOption } from '@/lib/assistants/tools/solution-package'
import { applyRedirectDefault, withAssignmentHelp, type AssignmentDeps } from '@/lib/assistants/assignment'
import { buildReference } from '@/lib/assistants/tools/node-reference'
import { assistantInstructions } from '@/lib/assistants/prompts'
import { SOLUTION_BLUEPRINT, PACKAGE_OPTIONS, SOLUTION_OPTIONS } from '@/lib/assistants/prompts-solution'
import { askUserTool } from '@/lib/assistants/tools/ask-user'
import type { AssistantEvent, ChatMessage } from '@/lib/assistants/types'
import { purchaseRequestPlan } from './fixtures/purchase-request-plan'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'

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
const env = (events: AssistantEvent[] = []) => ({ emit: (e: AssistantEvent) => events.push(e), toolCallId: 'p1' })
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = '11111111-1111-4111-8111-111111111111'

/** A fake MCP server (the real tool catalog validates the arguments): records calls, returns ids. */
function fakeServer(opts: { packages?: any[]; failInstall?: boolean } = {}) {
  let n = 100
  const calls: Array<{ tool: string; args: any }> = []
  const payload = (tool: string, args: any): any => {
    if (tool === 'packages_list') return { packages: opts.packages ?? [] }
    if (tool === 'packages_create') return { package: { id: uuid(900), name: args.name, slug: 'purchase-requests', latest_version: null } }
    if (tool === 'packages_update') return { package: { id: args.package_id, name: 'Purchase requests', slug: 'purchase-requests', latest_version: '1.0.0' } }
    if (tool === 'packages_build') return { version: { version: args.version ?? '1.1.0' }, manifest: {}, warnings: [], file_name: 'x.utpkg' }
    if (tool === 'packages_install') return opts.failInstall ? null : { install: { id: uuid(901) }, dry_run: false }
    if (tool === 'packages_get') return { package: { id: args.package_id, name: 'Purchase requests', latest_version: '1.0.0' } }
    if (tool === 'packages_download') return { file_name: 'purchase-requests-1.0.0.utpkg', file_base64: Buffer.from('PK-bytes').toString('base64') }
    const id = uuid(++n)
    if (tool === 'forms_create') return { created: true, form: { id, name: args.name } }
    if (tool === 'workflows_create') return { workflow: { id, name: args.name } }
    if (tool === 'reports_create') return { created: true, report: { id, name: args.name } }
    if (tool === 'decision_tables_create') return { created: true, decision_table: { id, name: args.name } }
    return { created: true, table: { id, name: args.name } }
  }
  const server = {
    getHandler: (tool: string) => async (args: any) => {
      calls.push({ tool, args })
      if (tool === 'packages_install' && opts.failInstall) return { isError: true, content: [{ type: 'text', text: 'Error: Forbidden' }] }
      return { content: [{ type: 'text', text: JSON.stringify(payload(tool, args)) }] }
    },
  }
  return { server: server as any, calls }
}
const BUILDER = ['workflows.view', 'workflows.create', 'workflows.edit', 'forms.view', 'forms.create', 'forms.edit', 'data.view', 'data.create', 'data.edit_schema', 'reports.view', 'reports.create', 'reports.edit_own']
const PACKAGER = [...BUILDER, 'packages.view', 'packages.manage', 'packages.install']
const tool = (tools: AssistantToolDef[], name: string) => tools.find((t) => t.name === name)!
const names: AssignmentDeps['names'] = async () => ({ users: new Map([[ME, 'Andy Hayes']]), teams: new Map() })

describe('the Solution blueprint', () => {
  it('is in the builder instructions (parent / child, config, admin forms, reports, packaging question), not for read-only people', () => {
    const text = assistantInstructions({ groups: ['designer'], canBuild: true })
    expect(text).toContain(SOLUTION_BLUEPRINT)
    for (const s of ['parent', 'CHILD tables', 'CONFIG', 'ADMIN form', 'config.charts', 'allow_redirect true', SOLUTION_OPTIONS.small, SOLUTION_OPTIONS.full, PACKAGE_OPTIONS.package, PACKAGE_OPTIONS.share, PACKAGE_OPTIONS.none, 'Add to package', 'uninstalling the package']) expect(text).toContain(s)
    expect(assistantInstructions({ groups: ['designer'], canBuild: false })).not.toContain('Solution blueprint')
  })

  it('the reference tool returns the solution patterns, and the user_task example allows redirect', () => {
    const out: any = buildReference({ patterns: ['solution'], types: ['user_task'] }, { itemSchema: () => null })
    expect(Object.keys(out.patterns)).toEqual(expect.arrayContaining(['parent_child', 'config_lookup', 'list_field', 'child_rows_from_list', 'admin_form', 'report_charts', 'package']))
    // The editable-grid patterns are for editing existing forms only: not offered for new builds, still there by name.
    expect(Object.keys(out.patterns)).not.toContain('line_items_grid')
    expect(Object.keys(out.patterns)).not.toContain('child_rows_loop')
    expect(Object.keys((buildReference({ patterns: ['line_items_grid'] }, { itemSchema: () => null }) as any).patterns)).toEqual(['line_items_grid'])
    expect(out.patterns.list_field.layout.rules[0].then[0]).toMatchObject({ type: 'add_list_row', list_field: 'line_items' })
    expect(out.patterns.child_rows_from_list.nodes[1].config.items).toBe('{{form.line_items}}')
    expect(out.patterns.parent_child.child.args.columns[0].lookup.sourceTableId).toBe('{{ref:requests.id}}')
    expect(out.nodes[0].example.config.allow_redirect).toBe(true)
  })

  it('a multi-item build asks the packaging question with buttons first (mocked model)', async () => {
    const { server } = fakeServer()
    const tools = [...designerTools({ server, permissions: new Set(PACKAGER), allTools: true }), askUserTool()]
    const p = provider({ content: null, tool_calls: [call('q1', 'ask_user', { question: 'Package the solution? It can then be removed in one click, versioned and shared.', options: [{ label: PACKAGE_OPTIONS.package, description: 'Recommended' }, { label: PACKAGE_OPTIONS.share }, { label: PACKAGE_OPTIONS.none }] })] })
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: assistantInstructions({ groups: ['designer'], canBuild: true }), context: null, history: [{ role: 'user', content: 'Build a purchase request solution — a full solution' }] as ChatMessage[], tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).not.toBe('awaiting_confirmation')
    const choice: any = events.find((e) => e.type === 'choice')
    expect(choice.options.map((o: any) => o.label)).toEqual([PACKAGE_OPTIONS.package, PACKAGE_OPTIONS.share, PACKAGE_OPTIONS.none])
    // The model was offered packaging and sharing tools alongside build_plan.
    const offered = p.bodies[0].tools.map((t: any) => t.function.name)
    expect(offered).toEqual(expect.arrayContaining(['build_plan', 'package_solution']))
  })
})

describe('build_plan for whole solutions', () => {
  it('raises the cap to 30 items; a long build pauses and continues', async () => {
    expect(MAX_PLAN_ITEMS).toBe(30)
    const forms = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `f${i}`, kind: 'form', name: `Form ${i}`, args: { fields: [{ key: 'a', label: 'A', type: 'text' }] } }))
    expect(normalizePlan(forms(30))).toHaveLength(30)
    expect(() => normalizePlan(forms(31))).toThrow(/at most 30/)
    let t = 0
    const created: any[] = []
    const tools = buildPlanTools({ call: async (_n, a) => { t += 20_000; const id = uuid(created.length + 1); created.push(id); return { form: { id, name: a.name } } }, allowedTools: new Set(['forms_create']), draftOnly: draftOnlyArgs, now: () => t })
    const first: any = (await tools[0].run({ items: forms(20) }, env())).result
    expect(first.status).toBe('paused')
    let last: any = first
    for (let round = 0; round < 5 && last.status === 'paused'; round++) last = (await tools[1].run({ items: forms(20), created: last.created }, env())).result
    expect(last.status).toBe('completed')
    expect(last.created).toHaveLength(20)
    expect(created).toHaveLength(20) // nothing built twice
  })

  it('checks each item before the card: lookup columns, Data table fields, admin-form steps, report columns and charts', () => {
    const plan = normalizePlan(purchaseRequestPlan().items)
    for (const it of plan) expect(itemProblems(it, plan)).toEqual([])
    const bad = normalizePlan(purchaseRequestPlan().items.map((it: any) => {
      if (it.key === 'line_items') return { ...it, args: { columns: [{ name: 'Request', type: 'lookup', lookup: { sourceTableId: '{{ref:requests.id}}', sourceColumn: 'ref_no' } }] } }
      if (it.key === 'admin_categories') return { ...it, args: { ...it.args, buttons: [{ id: 'save', label: 'Save', kind: 'submit', actions: [{ type: 'apply_table_changes', table_changes: { field: 'rows', target: 'table', table_id: '{{ref:categories.id}}', operation: 'auto' } }] }] } }
      if (it.key === 'requests_report') return { ...it, args: { config: { ...it.args.config, columns: ['status'], charts: [{ id: 'x', type: 'pie' }] } } }
      if (it.key === 'start_form') return { ...it, args: { ...it.args, layout: { rules: [{ ...it.args.layout.rules[0], then: [{ ...it.args.layout.rules[0].then[0], values: { sku: '{{line_items_item}}', item: '{{nope}}' } }] }] } } }
      return it
    }))
    const problems = (key: string) => itemProblems(bad.find((i) => i.key === key)!, bad).join(' | ')
    expect(problems('line_items')).toMatch(/has no column "ref_no"/)
    expect(problems('admin_categories')).toMatch(/matched on|map at least one column/)
    expect(problems('requests_report')).toMatch(/unknown report column "status"/)
    expect(problems('requests_report')).toMatch(/chart/)
    expect(problems('start_form')).toMatch(/the List "line_items" has no column "sku"/)
    expect(problems('start_form')).toMatch(/"\{\{nope\}\}" is not a field of this form/)
    // A List nothing fills in: flagged before the card.
    const noRule = normalizePlan(purchaseRequestPlan().items.map((it: any) => (it.key === 'start_form' ? { ...it, args: { ...it.args, layout: { rules: [] } } } : it)))
    expect(itemProblems(noRule.find((i) => i.key === 'start_form')!, noRule).join(' | ')).toMatch(/nothing adds rows to this List/)
  })

  it('a bad item comes back to the model before any card (schema check through the real tool catalog)', async () => {
    const { server } = fakeServer()
    const plan = purchaseRequestPlan()
    plan.items[0].args.columns[0].type = 'colour'
    await expect(tool(designerTools({ server, permissions: new Set(PACKAGER), allTools: true }), 'build_plan').confirm!(plan)).rejects.toThrow(/Check the plan before showing it[\s\S]*Categories \(categories\): invalid data_tables_create arguments/)
  })

  it('parent → child id substitution: lookups, Data table fields, admin steps and report sources get the real ids', () => {
    const created = { categories: { id: 'C1', name: 'Categories', kind: 'data_table' }, requests: { id: 'R1', name: 'Purchase requests', kind: 'data_table' } }
    expect(substituteRefs({ lookup: { sourceTableId: '{{ref:requests.id}}' }, data_source: '{{ref:requests.source}}', t: '{{ref:categories.id}}' }, created))
      .toEqual({ lookup: { sourceTableId: 'R1' }, data_source: 'custom_table_R1', t: 'C1' })
  })
})

describe('packaging a solution', () => {
  it('creates a package with every created item, builds 1.0.0 and registers it as installed (one-click uninstall)', async () => {
    const calls: Array<[string, any]> = []
    const items = [{ kind: 'data_table', id: uuid(1) }, { kind: 'form', id: uuid(2) }, { kind: 'workflow', id: uuid(3) }, { kind: 'report', id: uuid(4) }, { kind: 'decision_table', id: uuid(5) }]
    const r = await packageItems(items, { name: 'Purchase requests' }, {
      access: { manage: true, install: true, share: false },
      call: async (name, args) => { calls.push([name, args]); return name === 'packages_create' ? { package: { id: uuid(9), name: args.name, slug: 'purchase-requests' } } : name === 'packages_build' ? { version: { version: args.version } } : { install: { id: uuid(10) } } },
    })
    expect(calls.map((c) => c[0])).toEqual(['packages_create', 'packages_build', 'packages_install'])
    expect(calls[0][1].roots).toEqual(items.map((i) => ({ type: i.kind, id: i.id })))
    expect(calls[1][1]).toMatchObject({ package_id: uuid(9), version: '1.0.0' })
    expect(calls[2][1]).toEqual({ package_id: uuid(9), version: '1.0.0' })
    expect(r).toMatchObject({ status: 'packaged', installed: true, install_id: uuid(10), install_note: UNINSTALL_NOTE, package: { version: '1.0.0', href: '/packages?tab=authored' } })
  })

  it('without packages.manage packaging is skipped (and the card says why); without packages.install it is not registered', async () => {
    const skipped = await packageItems([{ kind: 'form', id: uuid(1) }], { name: 'X' }, { call: vi.fn(), access: { manage: false, install: false, share: false } })
    expect(skipped.status).toBe('skipped')
    const { server, calls } = fakeServer()
    const card = await tool(designerTools({ server, permissions: new Set(BUILDER), allTools: true }), 'build_plan').confirm!(purchaseRequestPlan())
    expect(card.warnings.join(' ')).toMatch(/Packaging is skipped: .*packages\.manage/)
    expect(calls.some((c) => c.tool.startsWith('packages_'))).toBe(false)
    const calls2: string[] = []
    const noInstall = await packageItems([{ kind: 'form', id: uuid(1) }], { name: 'X' }, { access: { manage: true, install: false, share: false }, call: async (n, a) => { calls2.push(n); return n === 'packages_create' ? { package: { id: uuid(9), name: a.name } } : { version: { version: '1.0.0' } } } })
    expect(calls2).toEqual(['packages_create', 'packages_build'])
    expect(noInstall.installed).toBe(false)
    expect(noInstall.install_note).toMatch(/packages\.install/)
  })

  it('an existing package of that name: the card refuses and asks "Add to package"; add_to adds the items and bumps the version', async () => {
    const existing = { id: uuid(900), name: 'Purchase requests', slug: 'purchase-requests', latest_version: '1.0.0' }
    const { server } = fakeServer({ packages: [existing] })
    const tools = designerTools({ server, permissions: new Set(PACKAGER), allTools: true })
    await expect(tool(tools, 'build_plan').confirm!(purchaseRequestPlan())).rejects.toThrow(/already exists[\s\S]*Add to package Purchase requests/)
    const plan = { ...purchaseRequestPlan(), package: { add_to: existing.id } }
    const card = await tool(tools, 'build_plan').confirm!(plan)
    expect(card.lines.join(' ')).toMatch(/Packaged as: Purchase requests \(adds these items/)
    const calls: Array<[string, any]> = []
    await packageItems([{ kind: 'form', id: uuid(1) }], normalizePackageOption({ add_to: existing.id })!, { access: { manage: true, install: true, share: false }, call: async (n, a) => { calls.push([n, a]); return n === 'packages_update' ? { package: existing } : n === 'packages_build' ? { version: { version: '1.1.0' } } : { install: { id: 'i' } } } })
    expect(calls.map((c) => c[0])).toEqual(['packages_update', 'packages_build', 'packages_install'])
    expect(calls[0][1].add).toEqual([{ type: 'form', id: uuid(1) }])
    expect(calls[1][1]).toMatchObject({ bump: 'minor' })
  })

  it('package_solution packages items built one by one (one confirmation)', async () => {
    const { server, calls } = fakeServer()
    const t = tool(designerTools({ server, permissions: new Set(PACKAGER), allTools: true }), 'package_solution')
    const args = { name: 'Leave', items: [{ kind: 'form', id: uuid(1), name: 'Leave request' }, { kind: 'workflow', id: uuid(2), name: 'Leave approval' }] }
    const card = await t.confirm!(args)
    expect(card.title).toBe('Package “Leave”')
    const { result }: any = await t.run(args, env())
    expect(result.status).toBe('packaged')
    expect(calls.find((c) => c.tool === 'packages_create')!.args.roots).toHaveLength(2)
  })

  it('sharing follows the gallery submission flow with a confirmation card (submitted for review)', async () => {
    const { server } = fakeServer()
    const share = vi.fn(async () => ({ id: 's1', slug: 'purchase-requests', version: '1.0.0', title: 'Purchase requests', status: 'pending' }))
    const tools = designerTools({ server, permissions: new Set(PACKAGER), allTools: true, galleryShare: share })
    const t = tool(tools, 'package_share_to_gallery')
    expect(designerTools({ server, permissions: new Set(PACKAGER), allTools: true }).some((x) => x.name === 'package_share_to_gallery')).toBe(false)
    const listing = { title: 'Purchase requests', summary: 'Purchase requests with line items, approval thresholds and reports.', description: 'A complete purchase request solution: the request form with a line-items grid, manager and finance approval, a categories admin form, thresholds and reports with charts.', category: 'finance', tags: ['purchasing', 'approvals'], author_name: 'Andy Hayes' }
    expect(t.mode).toBe('write')
    await expect(t.confirm!({ package_id: uuid(900), listing: { ...listing, summary: 'short' } })).rejects.toThrow(/Fix the listing/)
    const card = await t.confirm!({ package_id: uuid(900), listing })
    expect(card.confirm_label).toBe('Submit for review')
    expect(card.lines.join(' ')).toMatch(/moderator/)
    expect(share).not.toHaveBeenCalled()
    const { result }: any = await t.run({ package_id: uuid(900), listing }, env())
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ name: 'purchase-requests-1.0.0.utpkg' }), expect.objectContaining({ title: 'Purchase requests', licence: 'Apache-2.0' }))
    expect(result.note).toMatch(/submitted for review/)
  })
})

describe('redirect on Agent-built User Tasks', () => {
  const wf = (nodes: any[]) => ({ name: 'W', trigger_type: 'manual', nodes })
  it('every new User Task allows redirect; an explicit false is kept; existing steps keep theirs on update', () => {
    const nodes = [{ id: 't', type: 'manual', config: {} }, { id: 'a', type: 'user_task', config: { task_title: 'A' } }, { id: 'b', type: 'user_task', config: { task_title: 'B', allow_redirect: false } }]
    const out = applyRedirectDefault('workflows_create', wf(nodes))
    expect(out.nodes[1].config.allow_redirect).toBe(true)
    expect(out.nodes[2].config.allow_redirect).toBe(false)
    const upd = applyRedirectDefault('workflows_update', { workflow_id: 'w', nodes }, new Set(['a']))
    expect(upd.nodes[1].config.allow_redirect).toBeUndefined()
    const plan = applyRedirectDefault('build_plan', purchaseRequestPlan())
    const tasks = plan.items.find((i: any) => i.kind === 'workflow').args.nodes.filter((n: any) => n.type === 'user_task')
    expect(tasks.map((n: any) => n.config.allow_redirect)).toEqual([true, true])
  })

  it('the card says "redirect allowed" per task and the confirmed write saves it', async () => {
    const inner: AssistantToolDef = { name: 'workflows_create', description: '', parameters: {}, mode: 'write', label: () => 'x', confirm: async () => ({ title: 'Create', lines: [], warnings: [] }), run: vi.fn(async (a) => ({ result: { workflow: { id: 'w' } }, args: a })) as any }
    const t = withAssignmentHelp(inner, { meId: ME, names })
    const args = wf([{ id: 't', type: 'manual', config: {} }, { id: 'a', type: 'user_task', label: 'Approve', config: { task_title: 'A', assignee_id: '@me' } }, { id: 'b', type: 'user_task', label: 'Check', config: { task_title: 'B', assignee_id: '@me', allow_redirect: false } }])
    const card = await t.confirm!(args)
    expect(card.lines).toContain('Assignee of “Approve”: you (Andy Hayes), for testing · redirect allowed')
    expect(card.lines).toContain('Assignee of “Check”: you (Andy Hayes), for testing')
    await t.run(args, env())
    const saved = (inner.run as any).mock.calls[0][0]
    expect(saved.nodes[1].config.allow_redirect).toBe(true)
    expect(saved.nodes[2].config.allow_redirect).toBe(false)
  })
})

describe('end to end: the purchase-request solution (mocked model)', () => {
  it('one plan card with sections and the package; Build all creates every item wired to the right ids, then packages them', async () => {
    const { server, calls } = fakeServer()
    const tools = designerTools({ server, permissions: new Set([...PACKAGER, 'workflows.view']), allTools: true, checkWorkflow: async () => [] }).map((t) => withAssignmentHelp(t, { meId: ME, names }))
    const plan = purchaseRequestPlan()
    const p = provider({ content: null, tool_calls: [call('b1', 'build_plan', plan)] })
    const events: AssistantEvent[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'Package this solution' }] as ChatMessage[], tools, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(r.status).toBe('awaiting_confirmation')
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card.preview.columns).toEqual(['#', 'Section', 'Kind', 'Name', 'Details'])
    expect([...new Set(card.preview.rows.map((row: string[]) => row[1]))]).toEqual(['Data model', 'Forms', 'Rules', 'Workflows', 'Reports', 'Package'])
    expect(card.preview.rows.find((row: string[]) => row[3] === 'Manage categories')[2]).toBe('Form · admin form')
    expect(card.lines.join(' ')).toMatch(/Packaged as: Purchase requests 1\.0\.0/)
    expect(card.lines.join(' ')).toMatch(/redirect allowed/)
    expect(calls.filter((c) => !c.tool.startsWith('packages_'))).toEqual([]) // nothing built before Build all

    const out: any = (await tool(tools, 'build_plan').run(plan, env())).result
    expect(out.status).toBe('completed')
    expect(out.skipped).toEqual([])
    expect(out.created).toHaveLength(11)
    const id = (key: string) => out.created.find((c: any) => c.key === key).id
    const created = (tool: string, name: string) => calls.find((c) => c.tool === tool && c.args.name === name)!.args
    const order = calls.filter((c) => /_create$/.test(c.tool) && !c.tool.startsWith('packages')).map((c) => c.args.name)
    expect(order.indexOf('Categories')).toBeLessThan(order.indexOf('Purchase requests'))
    expect(order.indexOf('Purchase requests')).toBeLessThan(order.indexOf('Line items'))
    // Parent → child: the lookups hold the real table ids.
    expect(created('data_tables_create', 'Purchase requests').columns.find((c: any) => c.name === 'Category').lookup.sourceTableId).toBe(id('categories'))
    expect(created('data_tables_create', 'Line items').columns[0].lookup.sourceTableId).toBe(id('requests'))
    // The application form's grid is bound to the child table; the admin form's grid and Save step to the config table.
    const start = created('forms_create', 'Purchase request')
    // The line items are a List filled by inputs + an "Add item" button rule.
    expect(start.fields.find((f: any) => f.key === 'line_items').type).toBe('list')
    expect(start.fields.find((f: any) => f.key === 'add_item').type).toBe('button')
    expect(start.layout.rules[0]).toMatchObject({ event: 'button_click', target: 'add_item', then: [{ type: 'add_list_row', list_field: 'line_items' }] })
    expect(start.fields.find((f: any) => f.key === 'category').lookup.table_id).toBe(id('categories'))
    const adminForm = created('forms_create', 'Manage categories')
    expect(adminForm.fields[0].data_table.table_id).toBe(id('categories'))
    expect(adminForm.buttons[0].actions[0].table_changes.table_id).toBe(id('categories'))
    // The workflow: start form, decision table, child-row loop, task forms, redirect on.
    const wf = calls.find((c) => c.tool === 'workflows_create')!.args
    const nodes = typeof wf.nodes === 'string' ? JSON.parse(wf.nodes) : wf.nodes
    const node = (nid: string) => nodes.find((n: any) => n.id === nid)
    expect(node('trigger').config.form_id).toBe(id('start_form'))
    expect(node('add_line').config.table_id).toBe(id('line_items'))
    expect(node('lines').config.items).toBe('{{form.line_items}}')
    expect(node('add_line').config.column_values).toMatchObject({ item: '{{item.item}}', request_id: '{{parent_id}}' })
    expect(node('save_request').config.output_row_id_var).toBe('parent_id')
    // The real wiring check over the built workflow, with the created forms' fields: zero warnings
    // ({{form.line_items}}, its total, {{item.*}} in the loop, the task prefills).
    const linked = Object.fromEntries(calls.filter((c) => c.tool === 'forms_create').map((c) => [out.created.find((x: any) => x.name === c.args.name).id, { fields: c.args.fields, layout: c.args.layout }]))
    const edgesBuilt = typeof wf.edges === 'string' ? JSON.parse(wf.edges) : wf.edges
    expect(validateWorkflowWiring({ nodes, edges: edgesBuilt.map((e: any, i: number) => ({ id: `e${i}`, ...e })), linkedForms: linked }).filter((w) => w.severity !== 'info')).toEqual([])
    expect(node('thresholds').config.decision_table_id).toBe(id('thresholds'))
    expect(node('thresholds').config._decision_outputs).toEqual([{ key: 'approval_level', label: 'Approval level', type: 'text' }])
    expect(out.warnings).toEqual([]) // the wiring self-check: zero warnings (loop item, decision outputs, task prefills)
    expect(node('manager').config).toMatchObject({ form_id: id('manager_form'), assignee_id: ME, allow_redirect: true })
    expect(node('finance').config.allow_redirect).toBe(true)
    expect(wf.is_active).toBe(false)
    // Reports: real sources and charts.
    const report = JSON.parse(created('reports_create', 'Purchase requests').config)
    expect(report.data_source).toBe(`custom_table_${id('requests')}`)
    expect(report.charts.map((c: any) => c.type)).toEqual(['number', 'donut', 'bar', 'column'])
    // Packaged: every created item, 1.0.0, registered.
    const roots = calls.find((c) => c.tool === 'packages_create')!.args.roots
    expect(roots.map((x: any) => x.id).sort()).toEqual(out.created.map((c: any) => c.id).sort())
    expect(calls.find((c) => c.tool === 'packages_build')!.args.version).toBe('1.0.0')
    expect(out.package).toMatchObject({ status: 'packaged', installed: true })
    expect(out.note).toMatch(/Packaged as|packaged as/)
    expect(out.note).toMatch(/removes everything it created/)
  })
})
