/**
 * The core Nintex importer on SYNTHETIC exports (hand-written minimal
 * .nwf / .nwp structures reproducing each construct — no real customer
 * export is used): readers, mapping (standalone and with an extension's
 * list-action mapping), Nintex Forms, and the importer service end to end
 * (new standalone workflow, replace as a new draft with confirmation).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { createMemorySupabase } from '@/__tests__/fixtures/supabase-memory'
import { parseNwf } from '@/lib/importers/nintex/read-nwf'
import { parseNwpEntries } from '@/lib/importers/nintex/read-nwp'
import { mapNintex, nintexTokens } from '@/lib/importers/nintex/map'
import { parseNintexForm } from '@/lib/importers/nintex/forms'
import { analyzeImport, listImporterViews, runImport } from '@/lib/services/importers'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pv = (name: string, value: string) => `<Parameter Name="${name}"><PrimitiveValue Value="${esc(value)}" ValueType="Text" /></Parameter>`
const pvar = (name: string, variable: string) => `<Parameter Name="${name}"><Variable Name="${variable}" Type="Text" /></Parameter>`
const action = (type: string, label: string, inner = '', opts: { enabled?: boolean; assembly?: string } = {}) =>
  `<NWActionConfig><Enabled>${opts.enabled === false ? 'false' : 'true'}</Enabled><TLabel>${esc(label)}</TLabel><Assembly>${opts.assembly ?? 'Nintex.Workflow, Version=1.0.0.0'}</Assembly><Type>Nintex.Workflow.Activities.Adapters.${type}</Type>${inner}</NWActionConfig>`
const kids = (...a: string[]) => `<ChildActivities>${a.join('')}</ChildActivities>`
const seq = (...a: string[]) => action('WFSequenceAdapter', '', kids(...a))
const cond = (left: string, op: string, right: string) => `<Condition xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="NWConditionConfig" Name="If any value equals value"><Params><Param Name="operator"><PrimitiveValue Value="${op}" ValueType="Text" /></Param><Param Name="left">${left}</Param><Param Name="right"><PrimitiveValue Value="${right}" ValueType="Text" /></Param></Params></Condition>`

function nwf(actions: string[], opts: { title?: string; type?: string; create?: boolean; change?: boolean } = {}): string {
  const settings = action('NWWorkflowVariablesAdapter', '', `<Parameters>${pv('StartManually', 'true')}${pv('StartOnCreate', String(opts.create ?? false))}${pv('StartOnChange', String(opts.change ?? false))}${pv('StartOnCreateCondition', 'false')}${pv('StartOnChangeCondition', 'false')}</Parameters>`)
  const inner = `<?xml version="1.0" encoding="utf-16"?><ExportedWorkflow><Title>${opts.title ?? 'Synthetic leave request'}</Title><Description /><Configurations><ActionConfigs>${settings}${actions.join('')}</ActionConfigs></Configurations><WorkflowVariables><Variable Name="Days" Type="Number" /><Variable Name="Summary" Type="Text" /><Variable Name="Ids" Type="ArrayList" /><Variable Name="Id" Type="Text" /></WorkflowVariables></ExportedWorkflow>`
  return `<?xml version="1.0" encoding="utf-8"?><ExportedWorkflowWithListMetdata><ExportedWorkflowSeralized>${esc(inner)}</ExportedWorkflowSeralized><ListReferences><ListReference><ListName>Leave Requests</ListName></ListReference></ListReferences><WorkflowType>${opts.type ?? 'List'}</WorkflowType></ExportedWorkflowWithListMetdata>`
}

const thisItem = (field: string) => `<ListLookup LookupType="ThisItemLookup"><Field Name="${field}" Type="Text" /></ListLookup>`

const SAMPLE = nwf([
  action('NWWriteToHistoryListAdapter', 'Log start', `<Parameters>${pv('Message', 'Started for {ItemProperty:Title}')}</Parameters>`),
  action('SPSetVariableAdapter', 'Set days', `<Parameters>${pvar('VariableName', 'Days')}${pv('Value', '{ItemProperty:Days_x0020_Off}')}</Parameters>`),
  action('WFIfElseAdapter', 'Long leave?', `${cond('<Variable Name="Days" />', 'GreaterThan', '5')}${kids(
    action('WFIfElseBranchAdapter', 'IfElseBranch', kids(
      action('NWApproverAdapter', 'Manager approval', `<Parameters>${pv('TaskName', 'Approve {ItemProperty:Title}')}${pv('ApprovalType', 'FirstToRespond')}</Parameters><Approvers><Approver PrincipalType="User" User="i:0#.w|contoso\\manager" AllowDelegation="true" /></Approvers>${kids(
        action('NWApproverBranchAdapter', 'ApprovalBranch', kids(action('SPUpdateItemWithKeyAdapter', 'Mark approved', `<Parameters>${pv('ThisItem', 'true')}</Parameters><FieldReferences><FieldReference Name="Status" Value="Status"><PrimitiveValue Value="Approved" ValueType="Text" /></FieldReference></FieldReferences>`))),
        action('NWApproverBranchAdapter', 'ApprovalBranch', kids(action('WFTerminateAdapter', 'Stop', `<Parameters>${pv('Message', 'Rejected')}</Parameters>`))),
      )}`),
    )),
    action('WFIfElseBranchAdapter', 'IfElseBranch', kids(action('NWCommitAdapter', 'Commit pending changes'))),
  )}`),
  action('NWBuildStringAdapter', 'Summary', `<Parameters>${pv('Input', '{ItemProperty:Title}: {WorkflowVariable:Days} days ({WFConstant:Region})')}${pvar('Output', 'Summary')}</Parameters>`),
  action('NWSendMessageAdapter', 'Tell the requester', `<Approvers><Approver PrincipalType="User" User="requester@example.com" /></Approvers><Message><Subject>Leave {ItemProperty:Title}</Subject><Body>Summary: {WorkflowVariable:Summary}</Body><CcList /></Message>`),
  action('NWQueryListAdapter', 'Find open requests', `<Parameters>${pv('Query', '<Query><Where /></Query>')}${pvar('Output', 'Ids')}${pv('ItemLimitLookup', '10')}</Parameters>`),
  action('NWForEachLoopAdapter', 'Each id', `<Parameters>${pvar('Target', 'Ids')}${pvar('Value', 'Id')}</Parameters>${kids(seq(action('NWWriteToHistoryListAdapter', 'Log id', `<Parameters>${pv('Message', 'Id {WorkflowVariable:Id}')}</Parameters>`)))}`),
  action('NWStateMachine2Adapter', 'Stages', `<Parameters>${pv('InitialState', 'Draft')}${pv('VariableName', '_StateA')}</Parameters>${kids(
    seq(action('NWState2Adapter', 'State', `<Parameters>${pv('State', 'Draft')}</Parameters>${kids(seq(action('NWStateChangeAdapter', 'Change state', `<Parameters>${pvar('VariableName', '_StateA')}${pv('State', 'Review')}</Parameters>`)))}`)),
    seq(action('NWState2Adapter', 'State', `<Parameters>${pv('State', 'Review')}</Parameters>${kids(seq(action('NWWriteToHistoryListAdapter', 'In review', `<Parameters>${pv('Message', 'review')}</Parameters>`), action('NWStateChangeAdapter', 'Change state', `<Parameters>${pvar('VariableName', '_StateA')}${pv('State', 'End State Machine')}</Parameters>`)))}`)),
  )}`),
  action('NWCallWebServiceAdapter', 'Call HR', `<Parameters>${pv('Url', 'https://hr.example.com/api')}${pv('Username', 'svc')}${pv('Password', 'Sup3rSecret!')}</Parameters>`),
  action('NWSendMessageAdapter', 'Disabled mail', '<Message><Subject>x</Subject><Body /></Message>', { enabled: false }),
  action('ExecuteStoredProcedureAdapter', 'Custom SQL', `<Parameters>${pv('Proc', 'dbo.Do')}</Parameters>`, { assembly: 'Contoso.Nintex.Actions, Version=1.0.0.0' }),
], { create: true })

describe('Nintex .nwf reader (synthetic)', () => {
  it('reads settings, variables, the action tree and branch labels', () => {
    const wf = parseNwf(SAMPLE, 'leave.nwf')
    expect(wf).toMatchObject({ name: 'Synthetic leave request', format: 'nwf', workflowType: 'List', listName: 'Leave Requests', startManually: true, startOnCreate: true, startOnChange: false })
    expect(wf.variables.map((v) => v.name)).toEqual(['Days', 'Summary', 'Ids', 'Id'])
    expect(wf.actions.map((a) => a.type)).toEqual(['NWWriteToHistoryListAdapter', 'SPSetVariableAdapter', 'WFIfElseAdapter', 'NWBuildStringAdapter', 'NWSendMessageAdapter', 'NWQueryListAdapter', 'NWForEachLoopAdapter', 'NWStateMachine2Adapter', 'NWCallWebServiceAdapter', 'NWSendMessageAdapter', 'ExecuteStoredProcedureAdapter'])
    const ifElse = wf.actions[2]
    expect(ifElse.condition).toMatchObject({ rules: [{ left: '{WorkflowVariable:Days}', op: 'GreaterThan', right: '5' }], exact: true })
    expect(ifElse.branches[0].actions[0]).toMatchObject({ type: 'NWApproverAdapter', assignees: ['contoso\\manager'], behaviours: ['delegation'] })
    expect(wf.actions[7].branches.map((b) => b.label)).toEqual(['Draft', 'Review'])
    expect(wf.actions[9].enabled).toBe(false)
    expect(wf.actions[10].custom).toBe('Contoso.Nintex.Actions')
  })

  it('refuses a file that is not a Nintex export', () => {
    expect(() => parseNwf('<Something/>')).toThrow(/Not a Nintex workflow export/)
  })
})

describe('Nintex mapping', () => {
  it('standalone: SharePoint list actions are placeholders, item fields become start parameters, secrets are never copied', () => {
    const m = mapNintex(parseNwf(SAMPLE))
    const types = m.nodes.map((n) => n.type)
    expect(types).toEqual(expect.arrayContaining(['log', 'set_variable', 'condition', 'user_task', 'text_template', 'send_email', 'loop', 'switch_case', 'goto_activity', 'http_request', 'placeholder']))
    expect(types.some((t) => t.startsWith('ext.'))).toBe(false)
    expect(m.items.filter((i) => i.status === 'placeholder').map((i) => i.name)).toEqual(['Mark approved', 'Find open requests', 'Custom SQL'])
    expect(m.variables.map((v) => v.name)).toEqual(expect.arrayContaining(['days', 'summary', 'const_region', 'item_title', 'item_days_x0020_off']))
    expect(JSON.stringify(m.nodes)).not.toContain('Sup3rSecret')
    expect(m.items.find((i) => i.name === 'Disabled mail')).toMatchObject({ status: 'info', mappedTo: 'not imported' })
    expect(m.items.find((i) => i.name === 'Commit pending changes')).toMatchObject({ status: 'info' })
    const task = m.nodes.find((n) => n.type === 'user_task')!
    expect(task.config).toMatchObject({ outcomes: ['Approve', 'Reject'] })
    expect(m.edges.filter((e) => e.source === task.id).map((e) => e.label).sort()).toEqual(['Approve', 'Reject'])
  })

  it('a state machine loops through Go To Activity with the next state', () => {
    const m = mapNintex(parseNwf(SAMPLE))
    const sw = m.nodes.find((n) => n.type === 'switch_case' && n.label === 'Stages')!
    expect(sw.config).toMatchObject({ field: '{{state_a}}', cases: [{ value: 'Draft' }, { value: 'Review' }] })
    const gotos = m.nodes.filter((n) => n.type === 'goto_activity' && (n.config as any).target_node_id === sw.id)
    expect(gotos).toHaveLength(2)
    expect(gotos[0].config).toMatchObject({ input_overrides: { state_a: '{{state_a_next}}' } })
    expect(m.edges.some((e) => gotos.some((g) => g.id === e.source))).toBe(false)
  })

  it('with an extension: list actions become its steps and the first step comes first', () => {
    const m = mapNintex(parseNwf(SAMPLE), {
      sharepoint: true,
      firstStep: { id: 'remember_item', type: 'set_variable', label: 'Remember', config: {} },
      listAction: (a) => ({ node: { type: 'ext.demo.items', label: a.label, config: { op: a.kind, fields: a.fields } }, mappedTo: `items.${a.kind}` }),
    })
    expect(m.nodes[0].id).toBe('remember_item')
    expect(m.nodes.find((n) => n.type === 'ext.demo.items' && (n.config as any).op === 'update')!.config).toMatchObject({ fields: { Status: 'Approved' } })
    expect(m.items.find((i) => i.name === 'Mark approved')).toMatchObject({ status: 'mapped', mappedTo: 'items.update' })
  })

  it('translates inserted references', () => {
    expect(nintexTokens('{ItemProperty:Start Date} by {Common:Initiator} ({WorkflowVariable:Days}) {WFConstant:Api Key}', new Map([['Days', 'days']]))).toBe('{{after.Start_x0020_Date}} by {{user.email}} ({{days}}) {{const_api_key}}')
  })
})

const nwpActions = `<?xml version="1.0"?><WorkflowAction><Id>root</Id><Configuration><ServerInfo><ClassName>#RootActivity</ClassName></ServerInfo></Configuration><Children>
<WorkflowAction><Id>a1</Id><Configuration><Name>Set status</Name><ServerInfo><ClassName>Microsoft.SharePoint.WorkflowServices.Activities.SetWorkflowStatus</ClassName></ServerInfo><Properties><Property><Parameters><Name>Status</Name><Value><PrimitiveValue><Type>String</Type><Value><string>Started</string></Value></PrimitiveValue></Value></Parameters></Property></Properties></Configuration>
<Next><Id>a2</Id><Configuration><Name>Approve</Name><ServerInfo><ClassName>Microsoft.SharePoint.WorkflowServices.Activities.SingleTask</ClassName></ServerInfo><Properties><Property><Parameters><Name>Title</Name><Value><PrimitiveValue><Type>String</Type><Value><string>Review {0}</string></Value><FormatValues><SelectedValue><ListLookup><SelectList>[Current Item]</SelectList><SelectField>Title</SelectField></ListLookup></SelectedValue></FormatValues></PrimitiveValue></Value></Parameters></Property></Properties></Configuration>
<Children><WorkflowAction><Id>s1</Id><Configuration><Name>Approved</Name><ServerInfo><ClassName>#SequenceActivity</ClassName></ServerInfo></Configuration><Children><WorkflowAction><Id>a3</Id><Configuration><Name>Log</Name><ServerInfo><ClassName>#WriteToHistory</ClassName></ServerInfo><Properties><Property><Parameters><Name>Message</Name><Value><PrimitiveValue><Type>String</Type><Value><string>ok</string></Value></PrimitiveValue></Value></Parameters></Property></Properties></Configuration></WorkflowAction></Children></WorkflowAction>
<WorkflowAction><Id>s2</Id><Configuration><Name>Rejected</Name><ServerInfo><ClassName>#SequenceActivity</ClassName></ServerInfo></Configuration><Children /></WorkflowAction></Children></Next></WorkflowAction>
</Children></WorkflowAction>`
const enc = (s: string) => new TextEncoder().encode(s)
const NWP = [
  { name: 'Workflow/Actions.xml', bytes: enc(nwpActions) },
  { name: 'Workflow/Settings.xml', bytes: enc('<WorkflowSettings><Title>Synthetic O365 approval</Title><StartManually>true</StartManually><StartOnCreate>false</StartOnCreate><StartOnChange>true</StartOnChange></WorkflowSettings>') },
  { name: 'Workflow/Variables.xml', bytes: enc('<ArrayOfVariable><Variable><Name>Note</Name><Type>String</Type></Variable></ArrayOfVariable>') },
]

describe('Nintex .nwp reader (synthetic)', () => {
  it('reads the Next chain, branches named by their sequence and {0} templates', () => {
    const wf = parseNwpEntries(NWP, 'approval.nwp')
    expect(wf).toMatchObject({ name: 'Synthetic O365 approval', format: 'nwp', startOnChange: true, variables: [{ name: 'Note', type: 'String' }] })
    expect(wf.actions.map((a) => [a.type, a.source])).toEqual([['SPSetCustomWorkflowStatusAdapter', 'SetWorkflowStatus'], ['NWMultiOutcomeAdapter', 'SingleTask']])
    expect(wf.actions[1]).toMatchObject({ outcomes: ['Approved', 'Rejected'], params: { TaskName: 'Review {ItemProperty:Title}' } })
    const m = mapNintex(wf)
    expect(m.nodes.map((n) => n.type)).toEqual(['set_variable', 'user_task', 'log'])
  })
})

describe('Nintex Forms (synthetic)', () => {
  it('classic XML controls become fields; display controls are listed', () => {
    const inner = '<Form xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><FormControls><FormControlProperties i:type="d2p1:TextBoxFormControlProperties" xmlns:d2p1="x"><d2p1:DisplayName>Title</d2p1:DisplayName><d2p1:Name>Title</d2p1:Name><d2p1:IsRequired>true</d2p1:IsRequired></FormControlProperties><FormControlProperties i:type="d2p1:ChoiceFormControlProperties" xmlns:d2p1="x"><d2p1:DisplayName>Outcome</d2p1:DisplayName><d2p1:Name>Outcome</d2p1:Name><d2p1:Choices><string>Approved</string><string>Rejected</string></d2p1:Choices></FormControlProperties><FormControlProperties i:type="d2p1:ButtonFormControlProperties" xmlns:d2p1="x"><d2p1:DisplayName>Save</d2p1:DisplayName></FormControlProperties></FormControls></Form>'
    const f = parseNintexForm(enc(`<Form><ActionId>a2</ActionId><FormXml>${esc(inner)}</FormXml></Form>`), 'Forms/Form1.xml')
    expect(f).toMatchObject({ kind: 'classic', actionId: 'a2' })
    expect(f.fields).toEqual([{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'outcome', label: 'Outcome', type: 'choice', options: ['Approved', 'Rejected'] }])
    expect(f.skipped).toEqual([{ control: 'Button "Save"', reason: 'display control' }])
  })

  it('responsive JSON controls become fields', () => {
    const json = JSON.stringify({ rows: [{ controls: [{ widget: 'textbox', properties: { title: 'Destination', name: 'Destination', required: true } }, { widget: 'choice', properties: { title: 'Class', name: 'Class', items: 'eco|Economy,biz|Business' } }, { widget: 'image', properties: {} }] }], ruleGroups: [{ rules: [{}] }] })
    const f = parseNintexForm(enc(`<Form><FormContent>${esc(json)}</FormContent></Form>`), 'Forms/Form1.json')
    expect(f.kind).toBe('responsive')
    expect(f.fields).toEqual([{ key: 'destination', label: 'Destination', type: 'text', required: true }, { key: 'class', label: 'Class', type: 'choice', options: ['eco', 'biz'], option_labels: { eco: 'Economy', biz: 'Business' } }])
    expect(f.rules).toBe(1)
  })
})

describe('Nintex importer service', { timeout: 60_000 }, () => {
  const TENANT = '00000000-0000-4000-8000-000000000001'
  const USER = '00000000-0000-4000-8000-000000000002'
  const EXISTING = '00000000-0000-4000-8000-0000000000aa'
  afterEach(() => { db.current = null })
  function seed() {
    db.current = createMemorySupabase({
      workflows: [{ id: EXISTING, tenant_id: TENANT, name: 'Leave approvals', trigger_type: 'webhook_received', trigger_config: {}, nodes: [{ id: 'start', type: 'webhook_received', label: 'Webhook', position: { x: 0, y: 0 }, config: { path: 'leave' } }], edges: [], user_variables: [], swimlanes: [], sections: [], is_active: true, published_version_id: '00000000-0000-4000-8000-0000000000bb', has_unpublished_changes: false }],
      object_audit_log: [], event_stream: [], forms: [], form_versions: [],
    }, { uuids: true })
    return { db: db.current, supabase: db.current, tenantId: TENANT, actorId: USER, permissions: null, authKind: 'session', source: 'api' } as any
  }
  const files = () => [{ name: 'leave.nwf', bytes: enc(SAMPLE) }]

  it('is listed and available without any extension or licence', async () => {
    const { importers } = await listImporterViews(seed())
    expect(importers.find((i) => i.id === 'nintex')).toMatchObject({ available: true, extension_id: null, endpoint: null })
  })

  it('analyses (detects the files), then imports a standalone draft workflow', async () => {
    const ctx = seed()
    const analysis = await analyzeImport(ctx, 'auto', files())
    expect(analysis.importer).toBe('nintex')
    expect(analysis.report.outputs).toEqual([{ kind: 'workflow', name: 'Synthetic leave request', detail: expect.stringContaining('Started manually / by API') }])
    expect(analysis.report.warnings.join(' ')).toMatch(/created/)
    const result = await runImport(ctx, 'nintex', files(), { target: 'new' })
    expect(result.created).toEqual([{ kind: 'workflow', id: expect.any(String), name: 'Synthetic leave request', href: expect.stringMatching(/^\/automations\//) }])
    const wf = db.current.tables.workflows.find((w: any) => w.id === result.created[0].id)
    expect(wf).toMatchObject({ is_active: false, trigger_type: 'webhook_received', tags: ['nintex'] })
    expect(wf.edges[0]).toMatchObject({ source: 'trigger' })
  })

  it('a site workflow becomes a scheduled workflow', async () => {
    const ctx = seed()
    const site = nwf([action('NWWriteToHistoryListAdapter', 'Log', `<Parameters>${pv('Message', 'nightly')}</Parameters>`)], { type: 'Site', title: 'Nightly' })
    await runImport(ctx, 'nintex', [{ name: 'nightly.nwf', bytes: enc(site) }], {})
    expect(db.current.tables.workflows.find((w: any) => w.name === 'Nightly')).toMatchObject({ trigger_type: 'schedule' })
  })

  it('replaces an existing workflow as a new draft only when confirmed, keeping its id and trigger', async () => {
    const ctx = seed()
    const analysis = await analyzeImport(ctx, 'nintex', files(), { target: 'replace', workflow_id: EXISTING })
    expect(analysis.report.outputs[0]).toMatchObject({ name: 'Leave approvals (new draft)' })
    expect((analysis.report as any).details.needsConfirm).toBe(true)
    await expect(runImport(ctx, 'nintex', files(), { target: 'replace', workflow_id: EXISTING })).rejects.toMatchObject({ status: 400 })
    const result = await runImport(ctx, 'nintex', files(), { target: 'replace', workflow_id: EXISTING, confirm: true })
    expect(result.created).toEqual([{ kind: 'workflow', id: EXISTING, name: 'Leave approvals', href: `/automations/${EXISTING}` }])
    const wf = db.current.tables.workflows.find((w: any) => w.id === EXISTING)
    expect(db.current.tables.workflows).toHaveLength(1)
    expect(wf).toMatchObject({ name: 'Leave approvals', trigger_type: 'webhook_received', has_unpublished_changes: true, published_version_id: '00000000-0000-4000-8000-0000000000bb' })
    expect(wf.nodes[0]).toMatchObject({ id: 'start', config: { path: 'leave' } })
    expect(wf.edges[0]).toMatchObject({ source: 'start' })
    expect(wf.nodes.length).toBeGreaterThan(10)
  })
})

describe('CAML → filter', () => {
  it('translates comparisons, and / or, order and row limit to OData', async () => {
    const { parseCaml, camlToODataFilter, camlToODataOrderBy, camlToText } = await import('@/lib/importers/caml')
    const q = parseCaml('<Query><Lists><List ID="{AB-CD}" /></Lists><ViewFields><FieldRef Name="ID" /></ViewFields><Where><And><And><BeginsWith><FieldRef Name="Request_x0020_Type" /><Value Type="Choice">New</Value></BeginsWith><Geq><FieldRef Name="Created" /><Value Type="DateTime">{WorkflowVariable:since}</Value></Geq></And><Or><Neq><FieldRef Name="Status" /><Value Type="Text">Closed</Value></Neq><IsNull><FieldRef Name="Owner" /></IsNull></Or></And></Where><OrderBy><FieldRef Name="Created" Ascending="false" /></OrderBy><RowLimit>10</RowLimit></Query>', (v) => v.replace('{WorkflowVariable:since}', '{{since}}'))
    expect(q).toMatchObject({ exact: true, rowLimit: 10, listId: 'ab-cd', viewFields: ['ID'] })
    expect(camlToODataFilter(q.where)).toBe("(startswith(Request_x0020_Type,'New') and Created ge datetime'{{since}}') and (Status ne 'Closed' or Owner eq null)")
    expect(camlToODataOrderBy(q.orderBy)).toBe('Created desc')
    expect(camlToText(q.where)).toContain('Status ≠ Closed or Owner is empty')
  })
  it('marks what it cannot translate', async () => {
    const { parseCaml } = await import('@/lib/importers/caml')
    const q = parseCaml('<Where><And><Eq><FieldRef Name="Due" /><Value Type="DateTime"><Today /></Value></Eq><In><FieldRef Name="A" /><Values /></In></And></Where>')
    expect(q.exact).toBe(false)
    expect(q.unsupported).toEqual(['<Today/> in a value', 'In'])
  })
})

describe('inline functions → native expressions', () => {
  it('translates nested Nintex functions, references and .NET date formats', async () => {
    const { translateInline } = await import('@/lib/importers/nintex/inline')
    const ref = (tok: string) => (tok === '{WorkflowVariable:body}' ? '{{body}}' : tok === '{ItemProperty:Title}' ? '{{after.Title}}' : tok)
    expect(translateInline('Body: fn-Replace(fn-Replace({WorkflowVariable:body},[T],{ItemProperty:Title}),\n,<br>)', ref).text).toBe('Body: {{=REPLACE(REPLACE({{body}}, "[T]", {{after.Title}}), "\\n", "<br>")}}')
    const d = translateInline('Due fn-FormatDate({WorkflowVariable:body},dd MMMM yyyy)', ref)
    expect(d).toMatchObject({ text: 'Due {{=FORMAT_DATE({{body}}, "DD MMMM YYYY")}}', translated: 1, approximate: [] })
    expect(translateInline('fn-FormatDate({WorkflowVariable:body},d)', ref).approximate).toHaveLength(1)
    expect(translateInline('fn-DateDiffDays({WorkflowVariable:body},{ItemProperty:Title})', ref).text).toBe('{{=DATE_DIFF({{body}}, {{after.Title}}, "days")}}')
    expect(translateInline('x fn-XPath({WorkflowVariable:body},/a)', ref)).toMatchObject({ text: 'x fn-XPath({WorkflowVariable:body},/a)', unsupported: ['fn-XPath'] })
  })
  it('the translated expressions evaluate natively', async () => {
    const { resolveExpression } = await import('@/lib/expression-resolver')
    expect(resolveExpression('Body: {{=REPLACE(REPLACE({{body}}, "[T]", {{t}}), ";", ",")}}', { variables: { body: 'a;[T]', t: 'Hi' } } as any)).toBe('Body: a,Hi')
  })
})

describe('collection operations → native list functions', () => {
  it('maps add / get / pop / remove value / clear / count onto Set variable with list functions that run', async () => {
    const { resolveExpression } = await import('@/lib/expression-resolver')
    const coll = (op: string, extra = '') => action('NWCollectionAdapter', `Coll ${op}`, `<Parameters>${pv('Operation', op)}${pvar('Target', 'Ids')}${pvar('Output', 'Id')}${extra}</Parameters>`)
    const wf = parseNwf(nwf([coll('Add', pv('LookupFieldValue', 'x') + pv('Index', '-1')), coll('Get', pv('Index', '1')), coll('Pop'), coll('RemoveValue', pv('LookupFieldValue', 'a')), coll('Count'), coll('Clear')]))
    const m = mapNintex(wf)
    const steps = m.nodes.filter((n) => n.type === 'set_variable').map((n) => (n.config as any).assignments)
    expect(m.items.filter((i) => /^Coll/.test(i.name)).every((i) => i.status === 'mapped')).toBe(true)
    let vars: Record<string, unknown> = { ids: ['a', 'b'] }
    const run = (as: Array<{ name: string; expression: string }>) => { const next = { ...vars }; for (const x of as) next[x.name] = resolveExpression(x.expression, { variables: vars } as any); vars = next }
    run(steps[0]); expect(vars.ids).toEqual(['a', 'b', 'x'])
    run(steps[1]); expect(vars.id).toBe('b')
    run(steps[2]); expect(vars).toMatchObject({ id: 'x', ids: ['a', 'b'] })
    run(steps[3]); expect(vars.ids).toEqual(['b'])
    run(steps[4]); expect(vars.id).toBe(1)
    run(steps[5]); expect(vars.ids).toEqual([])
  })
})

describe('task assignees', () => {
  it('resolves e-mails, logins, teams, initiator and manager; applies the mapping step', async () => {
    const { resolveAssignees, assignmentConfig } = await import('@/lib/importers/nintex/assignees')
    const T = '00000000-0000-4000-8000-000000000001'
    const U1 = '00000000-0000-4000-8000-0000000000c1', U2 = '00000000-0000-4000-8000-0000000000c2', TM = '00000000-0000-4000-8000-0000000000d1'
    const mem = createMemorySupabase({
      user_memberships: [{ tenant_id: T, user_id: U1 }, { tenant_id: T, user_id: U2 }],
      users: [{ id: U1, email: 'ada.lovelace@example.com', display_name: 'Ada' }, { id: U2, email: 'grace@example.com', display_name: 'Grace' }],
      teams: [{ id: TM, tenant_id: T, name: 'Finance Approvers', origin: 'sharepoint' }],
    }, { uuids: true })
    const ctx = { supabase: mem, db: mem, tenantId: T } as any
    const r = await resolveAssignees(ctx, ['i:0#.w|contoso\\ada.lovelace', 'grace@example.com', 'Finance Approvers', '{Common:Initiator}', 'Manager', '{ItemProperty:Approver}', 'Unknown Person', 'Mapped Person'], { 'Mapped Person': `user:${U2}` })
    expect(r.get('contoso\\ada.lovelace')).toMatchObject({ kind: 'user', id: U1 })
    expect(r.get('grace@example.com')).toMatchObject({ kind: 'user', id: U2 })
    expect(r.get('Finance Approvers')).toMatchObject({ kind: 'team', id: TM, origin: 'sharepoint' })
    expect(r.get('{Common:Initiator}')).toMatchObject({ kind: 'initiator' })
    expect(r.get('Manager')).toMatchObject({ kind: 'manager' })
    expect(r.get('{ItemProperty:Approver}')).toMatchObject({ kind: 'variable', expression: '{{after.Approver}}' })
    expect(r.get('Unknown Person')).toBeNull()
    expect(r.get('Mapped Person')).toMatchObject({ kind: 'user', id: U2 })
    expect(assignmentConfig(['Manager'], r).config).toEqual({ assignment_type: 'individual', assignee_relation: 'initiator_manager' })
    expect(assignmentConfig(['Finance Approvers', 'Unknown Person'], r)).toMatchObject({ config: { assignment_type: 'team', team_id: TM }, unresolved: ['Unknown Person'] })
  })

  it('"manager of initiator" is a native assignee: the engine reads the reporting line', async () => {
    const { managerOfInitiator } = await import('@/lib/reporting-lines')
    const T = '00000000-0000-4000-8000-000000000001', U = '00000000-0000-4000-8000-0000000000c1', M = '00000000-0000-4000-8000-0000000000c9'
    const mem = createMemorySupabase({ user_memberships: [{ tenant_id: T, user_id: U, manager_user_id: M }] }, { uuids: true })
    expect(await managerOfInitiator(mem, T, U)).toBe(M)
    expect(await managerOfInitiator(mem, T, 'not-a-user')).toBeNull()
  })
})
