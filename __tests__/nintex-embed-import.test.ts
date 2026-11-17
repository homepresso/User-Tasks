/**
 * Nintex import from the embedded (SharePoint) designer, on SYNTHETIC exports
 * only: the column check (internal / display names, type compatibility,
 * missing-column suggestions), start-form variables → start parameters, the
 * designer's default target (the workflow's own list and event, imported as a
 * new draft of it with its trigger kept), one workflow per event (plan.into:
 * a new version of the workflow that already covers the event, never a
 * duplicate), steps flagged for missing columns, an extension's SharePoint-only
 * actions for every target (unbound), and "create a list for this workflow"
 * (createTarget: create + bind, the name clash, the permission refusal).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))

import { defineExtension, defineServerExtension, ExtensionError, type ImportTargetColumns, type NintexImportHook, type ServerExtension } from '@/lib/extensions/sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { parseNwf } from '@/lib/importers/nintex/read-nwf'
import { mapNintex } from '@/lib/importers/nintex/map'
import { checkColumns, collectColumnRefs, columnsNeeded, flagMissingColumns, decodeInternalName, nodeUsesColumn, startParameters, suggestColumn, typeProblem, usesDocuments } from '@/lib/importers/nintex/columns'
import { boundNintexTarget, createNintexColumns, createNintexTarget, nintexCreateTargetInfo } from '@/lib/importers/nintex/importer'
import { analyzeImport, runImport } from '@/lib/services/importers'
import { importReviewNotes, validateWorkflowWiring } from '@/lib/workflow-wiring'
import type { ServiceContext } from '@/lib/services/context'

const enc = (s: string) => new TextEncoder().encode(s)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const pv = (name: string, value: string) => `<Parameter Name="${name}"><PrimitiveValue Value="${esc(value)}" ValueType="Text" /></Parameter>`
const action = (type: string, label: string, inner = '') =>
  `<NWActionConfig><Enabled>true</Enabled><TLabel>${esc(label)}</TLabel><Assembly>Nintex.Workflow, Version=1.0.0.0</Assembly><Type>Nintex.Workflow.Activities.Adapters.${type}</Type>${inner}</NWActionConfig>`
const kids = (...a: string[]) => `<ChildActivities>${a.join('')}</ChildActivities>`
const thisItem = (field: string, type: string) => `<ListLookup LookupType="ThisItemLookup"><Field Name="${field}" Type="${type}" /></ListLookup>`
const cond = (left: string, right: string) => `<Condition xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="NWConditionConfig" Name="If any value equals value"><Params><Param Name="operator"><PrimitiveValue Value="Equal" ValueType="Text" /></Param><Param Name="left">${left}</Param><Param Name="right"><PrimitiveValue Value="${right}" ValueType="Text" /></Param></Params></Condition>`

function nwf(actions: string[], variables = '', opts: { create?: boolean } = {}): string {
  const settings = action('NWWorkflowVariablesAdapter', '', `<Parameters>${pv('StartManually', 'true')}${pv('StartOnCreate', String(opts.create ?? true))}${pv('StartOnChange', 'false')}</Parameters>`)
  const inner = `<?xml version="1.0" encoding="utf-16"?><ExportedWorkflow><Title>Synthetic purchase request</Title><Configurations><ActionConfigs>${settings}${actions.join('')}</ActionConfigs></Configurations><WorkflowVariables><Variable Name="Amount" Type="Number" Initiate="false" />${variables}</WorkflowVariables></ExportedWorkflow>`
  return `<?xml version="1.0" encoding="utf-8"?><ExportedWorkflowWithListMetdata><ExportedWorkflowSeralized>${esc(inner)}</ExportedWorkflowSeralized><ListReferences><ListReference><ListName>Purchase Requests</ListName></ListReference></ListReferences><WorkflowType>List</WorkflowType></ExportedWorkflowWithListMetdata>`
}

const START_VARS = '<Variable Name="Justification" Type="Text" Initiate="true" Required="true" ControlType="MultipleLine" Description="Why it is needed" /><Variable Name="Urgency" Type="Text" Initiate="true" ControlType="ChoiceDropDown"><Choice Value="Low" /><Choice Value="High" /></Variable><Variable Name="Needed by" Type="DateTime" Initiate="true" ControlType="DateOnly" />'

const SAMPLE = nwf([
  action('NWWriteToHistoryListAdapter', 'Log', `<Parameters>${pv('Message', 'Request {ItemProperty:Title} for {ItemProperty:Cost_x0020_Centre}')}</Parameters>`),
  action('WFIfElseAdapter', 'Rush?', `${cond(thisItem('Priority', 'Choice'), 'Rush')}${kids(
    action('WFIfElseBranchAdapter', 'IfElseBranch', kids(action('SPSetFieldWithKeyAdapter', 'Set status', `<Parameters>${pv('LookupField', 'Approval_x0020_State')}${pv('LookupFieldType', 'Choice')}${pv('LookupFieldValue', 'Escalated')}</Parameters>`))),
    action('WFIfElseBranchAdapter', 'IfElseBranch', ''),
  )}`),
  action('SPUpdateItemWithKeyAdapter', 'Record amount', `<Parameters>${pv('ThisItem', 'true')}</Parameters><FieldReferences><FieldReference Name="Approved Amount" Value="Approved_x0020_Amount"><Variable Name="Amount" Type="Number" /></FieldReference><FieldReference Name="Reviewer" Value="Reviewer"><PrimitiveValue Value="manager@example.com" ValueType="Text" /></FieldReference></FieldReferences>`),
  action('NWSendMessageAdapter', 'Notify', `<Approvers><Approver PrincipalType="User" User="{ItemProperty:Author}" /></Approvers><Message><Subject>Request {ItemProperty:Title}</Subject><Body>Amount {ItemProperty:Total} ({ItemProperty:Notes})</Body><CcList /></Message>`),
  action('NWSetItemPermissions', 'Lock the item', `<Parameters>${pv('ThisItem', 'true')}${pv('AddToExistingPermissions', 'false')}${pv('Message', '{ItemProperty:Author};#Read;#None##Approvers;#Contribute;#SharePointGroup')}</Parameters>`),
], START_VARS)

/** The connected list as an extension reports it. */
const LIST: ImportTargetColumns = {
  title: 'Purchase Requests',
  aliases: ['5a1b8c2d-0000-4000-8000-00000000abcd', 'Purchase Requests'],
  creatable: ['text', 'note', 'number', 'currency', 'datetime', 'boolean', 'choice', 'multichoice', 'person', 'url'],
  canCreate: true,
  columns: [
    { key: 'Title', label: 'Title', kind: 'text', typeLabel: 'Single line of text' },
    { key: 'Author', label: 'Created By', kind: 'person', typeLabel: 'Person or group', readOnly: true },
    { key: 'CostCentre', label: 'Cost Centre', kind: 'text', typeLabel: 'Single line of text' },
    { key: 'Priority', label: 'Priority', kind: 'choice', typeLabel: 'Choice', choices: ['Normal', 'Rush'] },
    { key: 'Approved_x0020_Amount', label: 'Approved Amount', kind: 'text', typeLabel: 'Single line of text' },
    { key: 'Total', label: 'Total', kind: 'currency', typeLabel: 'Currency' },
    { key: 'Notes', label: 'Notes', kind: 'note', typeLabel: 'Multiple lines of text' },
  ],
}

describe('column check', () => {
  const wf = parseNwf(SAMPLE, 'purchase.nwf')

  it('reads the columns, their types and how they are used', () => {
    const refs = collectColumnRefs(wf)
    const by = Object.fromEntries(refs.map((r) => [r.name, r]))
    expect(Object.keys(by).sort()).toEqual(['Approval_x0020_State', 'Approved_x0020_Amount', 'Author', 'Cost_x0020_Centre', 'Notes', 'Priority', 'Reviewer', 'Title', 'Total'])
    expect(by.Priority).toMatchObject({ nintexType: 'Choice', kind: 'choice', usages: ['condition'], values: ['Rush'] })
    expect(by.Approval_x0020_State).toMatchObject({ nintexType: 'Choice', usages: ['write'], values: ['Escalated'] })
    expect(by.Approved_x0020_Amount).toMatchObject({ usages: ['write'], fromTypes: ['Number'] })
    expect(by.Title.usages).toEqual(['read'])
    expect(decodeInternalName('Cost_x0020_Centre')).toBe('Cost Centre')
  })

  it('matches by internal name, then display name; flags type mismatches and missing columns', () => {
    const check = checkColumns(collectColumnRefs(wf), LIST)
    const row = (n: string) => check.rows.find((r) => r.name === n)!
    expect(row('Title')).toMatchObject({ status: 'matched', by: 'internal' })
    expect(row('Cost_x0020_Centre')).toMatchObject({ status: 'matched', by: 'display', column: { key: 'CostCentre' } })
    expect(check.columnMap).toEqual({ Cost_x0020_Centre: 'CostCentre' })
    expect(row('Priority').status).toBe('matched')
    // A number variable written to a text column, and a person read from a read-only column (fine), money read as currency.
    expect(row('Approved_x0020_Amount')).toMatchObject({ status: 'type_mismatch', note: expect.stringMatching(/number/i) })
    expect(row('Author').status).toBe('matched')
    expect(row('Total').status).toBe('matched')
    expect(row('Approval_x0020_State')).toMatchObject({ status: 'missing', suggestion: { key: 'Approval_x0020_State', label: 'Approval State', kind: 'choice', choices: ['Escalated'], creatable: true } })
    expect(row('Reviewer')).toMatchObject({ status: 'missing', suggestion: { kind: 'text', creatable: true } })
    expect(check.counts).toEqual({ matched: 6, type_mismatch: 1, missing: 2 })
    expect(check.rows[0].status).toBe('missing')
  })

  it('type compatibility: same group, one vs several values, read-only targets', () => {
    const col = (kind: any, extra: any = {}) => ({ key: 'X', label: 'X', kind, typeLabel: kind, ...extra })
    expect(typeProblem('number', col('currency'), ['read'])).toBeNull()
    expect(typeProblem('text', col('choice'), ['read'])).toBeNull()
    expect(typeProblem('note', col('text'), ['write'])).toMatch(/one line/)
    expect(typeProblem('person', col('people'), ['read'])).toMatch(/several/)
    expect(typeProblem('datetime', col('boolean'), ['read'])).toMatch(/date and time/)
    expect(typeProblem(null, col('calculated', { readOnly: true }), ['write'])).toMatch(/read-only/)
    expect(typeProblem(null, col('lookup'), ['read'])).toBeNull()
  })

  it('suggests a type from the Nintex type, the variable written, literal values, within what the target can create', () => {
    const base = { name: 'Days_x0020_Off', display: null, nintexType: null, kind: null, usages: ['write'] as any, actions: ['A'], values: [] as string[], fromTypes: [] as string[] }
    expect(suggestColumn({ ...base, fromTypes: ['Number'] }, LIST.creatable!)).toMatchObject({ kind: 'number', label: 'Days Off', key: 'Days_x0020_Off' })
    expect(suggestColumn({ ...base, values: ['3', '5'] }, LIST.creatable!).kind).toBe('number')
    expect(suggestColumn({ ...base, values: ['Open', 'Closed'] }, LIST.creatable!)).toMatchObject({ kind: 'choice', choices: ['Open', 'Closed'] })
    expect(suggestColumn({ ...base, kind: 'lookup', nintexType: 'Lookup' }, LIST.creatable!)).toMatchObject({ kind: 'text', creatable: true })
    expect(suggestColumn({ ...base, kind: 'people' }, LIST.creatable!).kind).toBe('person')
    expect(suggestColumn({ ...base, name: '1st reviewer' }, ['text']).key).toBe('Col1streviewer')
  })

  it('start form variables become start parameters', () => {
    expect(wf.variables.filter((v) => v.startForm).map((v) => v.name)).toEqual(['Justification', 'Urgency', 'Needed by'])
    expect(startParameters(wf.variables)).toEqual([
      { name: 'justification', label: 'Justification', type: 'string', required: true, description: 'Why it is needed' },
      { name: 'urgency', label: 'Urgency', type: 'string', format: 'select', options: ['Low', 'High'], description: 'Nintex start form: "Urgency"' },
      { name: 'needed_by', label: 'Needed by', type: 'string', format: 'date', description: 'Nintex start form: "Needed by"' },
    ])
  })

  it('maps references to the list\'s names and flags the steps using missing columns', () => {
    const check = checkColumns(collectColumnRefs(wf), LIST)
    const m = mapNintex(wf, { sharepoint: true, columnMap: check.columnMap, listAction: (a) => ({ node: { type: 'ext.demo.items', label: a.label, config: { fields: JSON.stringify(a.fields) } }, mappedTo: 'items' }) })
    const log = m.nodes.find((n) => n.type === 'log')!
    expect((log.config as any).message).toBe('Request {{after.Title}} for {{after.CostCentre}}')
    expect(nodeUsesColumn(m.nodes.find((n) => n.label === 'Set status')!.config, 'Approval_x0020_State')).toBe(true)
    expect(flagMissingColumns(m.nodes, check.rows, 'Purchase Requests')).toBe(2)
    const flagged = m.nodes.find((n) => n.label === 'Set status')!
    expect(importReviewNotes(flagged.config)).toEqual(['Column "Approval State" (Approval_x0020_State) is not on "Purchase Requests": add it to the list, or change this step'])
    const warnings = validateWorkflowWiring({ nodes: m.nodes, edges: m.edges }).filter((w) => w.kind === 'import_review')
    expect(warnings.map((w) => w.node_id).sort()).toEqual(m.nodes.filter((n) => importReviewNotes(n.config).length).map((n) => n.id).sort())
    const start = m.variables.find((v) => v.name === 'urgency')!
    expect(start.start).toMatchObject({ label: 'Urgency', format: 'select', options: ['Low', 'High'] })
  })

  it('columns for a new list: the workflow\'s columns (not built-in ones) and its start form fields; a library for document actions', () => {
    const needed = columnsNeeded(wf)
    expect(needed.map((c) => [c.key, c.kind, c.source])).toEqual([
      ['Cost_x0020_Centre', 'text', 'column'], ['Priority', 'choice', 'column'], ['Approval_x0020_State', 'choice', 'column'], ['Approved_x0020_Amount', 'number', 'column'],
      ['Reviewer', 'text', 'column'], ['Total', 'text', 'column'], ['Notes', 'text', 'column'],
      ['Justification', 'text', 'start_form'], ['Urgency', 'choice', 'start_form'], ['Neededby', 'datetime', 'start_form'],
    ])
    expect(needed.find((c) => c.key === 'Justification')!.required).toBe(true)
    expect(needed.find((c) => c.key === 'Priority')!.choices).toEqual(['Rush'])
    expect(usesDocuments(wf)).toBe(false)
    expect(usesDocuments(parseNwf(nwf([action('SPCheckOutItemWithKeyAdapter', 'Check out', `<Parameters>${pv('ThisItem', 'true')}</Parameters>`)])))).toBe(true)
  })
})

/* ── through the importer service, with a fake extension ── */

const TENANT = '0e000000-0000-4000-8000-0000000e2001'
const USER = '0e000000-0000-4000-8000-0000000e20aa'
const LIST_ID = '0e000000-0000-4000-8000-00000000c001'
const BOUND_WF = '0e000000-0000-4000-8000-0000000000b1'
const OTHER_WF = '0e000000-0000-4000-8000-0000000000b2'

const manifest = {
  manifest_version: 1, id: 'demo-sp', name: 'Demo lists', version: '1.0.0', publisher: { id: 'demo', name: 'Demo' },
  engines: { usertasks: '>=0.1.0', extension_sdk: '^1.0.0' }, licence: { tier: 'paid', sku: 'demo', features: ['importers'] }, deployments: ['self_hosted', 'cloud'],
  contributes: { triggers: [{ key: 'item_event', label: 'List item event', description: 'An item changed', config: [{ name: 'list', type: 'string' }] }] },
}

const created: any[] = []
const madeLists: string[] = []
const otherAction: NonNullable<Awaited<ReturnType<NonNullable<NintexImportHook['unbound']>>>['otherAction']> = (a) => a.type === 'NWSetItemPermissions'
  ? { node: { type: 'ext.demo-sp.permissions', label: a.label, config: { list: '', action: 'break_inheritance' } }, nodes: [{ type: 'ext.demo-sp.permissions', label: 'Grant', config: { list: '', action: 'grant' } }], status: 'partial', mappedTo: 'permissions', detail: 'choose the SharePoint list' }
  : null

const hook: NintexImportHook = {
  feature: 'importers',
  async targets() { return [{ key: 'list', label: 'A connected list', fields: [{ name: 'list', label: 'List', type: 'select', options: [{ value: LIST_ID, label: 'Purchase Requests' }] }] }] },
  async plan({ config, replacingWorkflowId }) {
    const events = Array.isArray(config.events) ? config.events : ['created']
    return {
      trigger: { key: 'item_event', config: { list: config.list, events } },
      firstStep: { id: 'remember', type: 'set_variable', label: 'Remember the item', config: { assignments: [{ name: 'sp_item_id', expression: '{{after.ID}}' }] } },
      listAction: (a) => ({ node: { type: 'ext.demo-sp.items', label: a.label, config: { fields: JSON.stringify(a.fields) } }, mappedTo: 'items' }),
      otherAction,
      // One workflow per event: "created" on the list is BOUND_WF.
      into: !replacingWorkflowId && events.includes('created') && config.list === LIST_ID ? { workflowId: BOUND_WF, name: 'Purchase Requests – Item created' } : null,
    }
  },
  async unbound() { return { otherAction } },
  async boundTarget({ workflow }) {
    return workflow.config.list ? { target: 'list', config: { list: workflow.config.list, events: workflow.config.events }, label: 'Connect to this SharePoint list', description: 'Purchase Requests · Item created' } : null
  },
  async columns({ config }) { return config.list === LIST_ID || madeLists.includes(String(config.list)) ? LIST : null },
  async createColumns({ columns }) { created.push(...columns); return { created: columns.map((c) => ({ key: c.key, label: c.label })), failed: [] } },
  async createTargetInfo({ workflow }) {
    return { label: 'Create a SharePoint list for this workflow', containers: [{ value: 'site-1', label: 'Finance' }], defaultContainer: workflow ? 'site-1' : null, kinds: [{ value: 'list', label: 'List' }, { value: 'library', label: 'Document library' }], creatable: LIST.creatable!, canCreate: true }
  },
  async createTarget({ ctx, input }) {
    if (!ctx.can('ext.demo-sp.manage')) throw new ExtensionError('forbidden', 'You need Manage Lists on the site', 403)
    if (input.name === 'Purchase Requests' && input.ifExists !== 'use') throw new ExtensionError('exists', '"Purchase Requests" exists already', 409, { existing: { title: 'Purchase Requests' } })
    const id = input.name === 'Purchase Requests' ? LIST_ID : '0e000000-0000-4000-8000-00000000c0ff'
    madeLists.push(id)
    return { target: 'list', config: { list: id }, title: input.name, existing: input.ifExists === 'use' && id === LIST_ID, created: input.columns.map((c) => ({ key: c.key, label: c.label })), failed: [] }
  },
}

const server: ServerExtension = defineServerExtension({ id: 'demo-sp', triggers: { item_event: {} }, nintex: hook })

function seed() {
  const trigger = (id: string, events: string[]) => ({ id: 'trigger', type: 'ext.demo-sp.item_event', label: 'List item event', position: { x: 0, y: 0 }, config: { list: LIST_ID, events, filters: { field: 'Priority' } } })
  const wf = (id: string, name: string, events: string[]) => ({ id, tenant_id: TENANT, name, trigger_type: 'ext.demo-sp.item_event', trigger_config: { list: LIST_ID, events }, nodes: [trigger(id, events)], edges: [], user_variables: [], swimlanes: [], sections: [], is_active: true, published_version_id: null, has_unpublished_changes: false })
  db.current = createMemorySupabase({
    tenant_extensions: [{ tenant_id: TENANT, extension_id: 'demo-sp', enabled: true, config: {}, secrets: {}, config_version: 1 }],
    workflows: [wf(BOUND_WF, 'Purchase Requests – Item created', ['created']), wf(OTHER_WF, 'Purchase Requests – Item modified', ['updated'])],
    object_audit_log: [], event_stream: [], forms: [], form_versions: [],
  }, { uuids: true })
  return db.current
}

const svc = (permissions: string[] | null = null): ServiceContext => ({ db: db.current, supabase: db.current, tenantId: TENANT, actorId: USER, permissions: permissions ? new Set(permissions) : null, authKind: 'session', source: 'api' } as any)
const files = () => [{ name: 'purchase.nwf', bytes: enc(SAMPLE) }]
const wfRow = (id: string) => db.current.tables.workflows.find((w: any) => w.id === id)

describe('Nintex import onto a list (embedded designer)', { timeout: 60_000 }, () => {
  beforeEach(() => {
    created.length = 0; madeLists.length = 0
    registerExtensionsForTest({ definitions: [defineExtension({ manifest })], servers: [server] })
    setEntitlementPort({ check: async () => ({ allowed: true, state: 'licensed' }) })
  })
  afterEach(() => { resetExtensionsForTest(); db.current = null })

  it('the designer\'s default target is the workflow\'s own list and event', async () => {
    seed()
    expect(await boundNintexTarget(svc(), BOUND_WF)).toEqual({ id: 'ext.demo-sp.list', label: 'Connect to this SharePoint list', description: 'Purchase Requests · Item created', extension: 'Demo lists', config: { list: LIST_ID, events: ['created'] }, workflow: { id: BOUND_WF, name: 'Purchase Requests – Item created' } })
  })

  it('imports as a new draft of THAT workflow: trigger kept, references wired to the list, start parameters, missing columns flagged', async () => {
    seed()
    const options = { target: 'ext.demo-sp.list', target_config: { list: LIST_ID, events: ['created'] }, workflow_id: BOUND_WF, keep_trigger: true, forms: 'skip' }
    const analysis = await analyzeImport(svc(), 'nintex', files(), options)
    const details = analysis.report.details as any
    expect(details.needsConfirm).toBe(true)
    expect(details.workflows[0]).toMatchObject({ keepTrigger: true, trigger: { label: 'kept' }, columns: { counts: { matched: 6, type_mismatch: 1, missing: 2 } } })
    expect(details.workflows[0].startParameters.map((p: any) => p.label)).toEqual(['Justification', 'Urgency', 'Needed by'])
    expect(analysis.report.warnings.join(' ')).toMatch(/2 column\(s\) the workflow uses are not on "Purchase Requests": 2 step\(s\) are flagged/)
    const result = await runImport(svc(), 'nintex', files(), { ...options, confirm: true })
    expect(result.created).toEqual([{ kind: 'workflow', id: BOUND_WF, name: 'Purchase Requests – Item created', href: `/automations/${BOUND_WF}` }])
    expect(db.current.tables.workflows).toHaveLength(2)
    const wf = wfRow(BOUND_WF)
    expect(wf.nodes[0]).toMatchObject({ id: 'trigger', type: 'ext.demo-sp.item_event', config: { list: LIST_ID, events: ['created'], filters: { field: 'Priority' } } })
    expect(wf.has_unpublished_changes).toBe(true)
    expect(JSON.stringify(wf.nodes)).toContain('{{after.CostCentre}}')
    expect(wf.nodes.filter((n: any) => importReviewNotes(n.config).length).map((n: any) => n.label).sort()).toEqual(['Record amount', 'Set status'])
    expect(wf.user_variables.find((v: any) => v.name === 'justification')).toMatchObject({ label: 'Justification', required: true })
    expect(wf.user_variables.find((v: any) => v.name === 'urgency')).toMatchObject({ format: 'select', options: ['Low', 'High'] })
    // SharePoint-only actions map onto the extension's steps (two steps: stop inheriting, then grant).
    expect(wf.nodes.filter((n: any) => n.type === 'ext.demo-sp.permissions')).toHaveLength(2)
  })

  it('a list person with an Edit grant only (no workflows.create) may import into that one workflow, not another', async () => {
    seed()
    db.current.tables.object_permissions = [{ tenant_id: TENANT, object_type: 'workflow', object_id: BOUND_WF, user_id: USER, can_edit: true }]
    db.current.tables.user_roles = []; db.current.tables.user_teams = []
    const options = { target: 'ext.demo-sp.list', target_config: { list: LIST_ID, events: ['created'] }, keep_trigger: true, forms: 'skip', confirm: true }
    await expect(runImport(svc(['workflows.view']), 'nintex', files(), { ...options, workflow_id: OTHER_WF })).rejects.toMatchObject({ status: 403 })
    const ok = await runImport(svc(['workflows.view']), 'nintex', files(), { ...options, workflow_id: BOUND_WF })
    expect(ok.created[0].id).toBe(BOUND_WF)
  })

  it('one workflow per event: a target whose event is covered becomes a new version of that workflow, never a duplicate', async () => {
    seed()
    const options = { target: 'ext.demo-sp.list', target_config: { list: LIST_ID, events: ['created'] }, forms: 'skip' }
    const analysis = await analyzeImport(svc(), 'nintex', files(), options)
    expect(analysis.report.outputs[0]).toMatchObject({ name: 'Purchase Requests – Item created (new draft)' })
    expect(analysis.report.warnings.join(' ')).toMatch(/already runs on these events: the import becomes its new draft/)
    await expect(runImport(svc(), 'nintex', files(), options)).rejects.toMatchObject({ status: 400 })
    const result = await runImport(svc(), 'nintex', files(), { ...options, confirm: true })
    expect(result.created[0].id).toBe(BOUND_WF)
    expect(db.current.tables.workflows).toHaveLength(2)
    expect(wfRow(BOUND_WF).nodes[0].config).toMatchObject({ events: ['created'], filters: { field: 'Priority' } })
  })

  it('adds the confirmed columns through the extension, then the check passes', async () => {
    seed()
    const out = await createNintexColumns(svc(), { target: 'ext.demo-sp.list', target_config: JSON.stringify({ list: LIST_ID }), columns: [{ key: 'Approval_x0020_State', label: 'Approval State', kind: 'choice', choices: ['Escalated'] }] })
    expect(out).toEqual({ created: [{ key: 'Approval_x0020_State', label: 'Approval State' }], failed: [] })
    expect(created[0]).toMatchObject({ kind: 'choice', choices: ['Escalated'] })
    await expect(createNintexColumns(svc(), { target: 'ext.demo-sp.list', columns: [{ key: 'X', label: 'X', kind: 'formula' }] })).rejects.toMatchObject({ status: 400 })
    await expect(createNintexColumns(svc(), { target: 'new', columns: [] })).rejects.toMatchObject({ status: 400 })
  })

  it('SharePoint-only actions map for a standalone import when the extension is usable; else say what is needed', async () => {
    seed()
    const withExt = await analyzeImport(svc(), 'nintex', files(), { target: 'new' })
    const item = withExt.report.items.find((i) => i.name === 'Lock the item')!
    expect(item).toMatchObject({ status: 'partial', mappedTo: 'permissions', detail: expect.stringContaining('choose the SharePoint list') })
    expect(JSON.stringify(withExt.report)).not.toMatch(/Lock the item[^}]*no UserTasks equivalent/)
    resetExtensionsForTest()
    const without = await analyzeImport(svc(), 'nintex', files(), { target: 'new' })
    expect(without.report.items.find((i) => i.name === 'Lock the item')).toMatchObject({ status: 'placeholder', detail: expect.stringContaining('needs the SharePoint extension') })
  })

  it('create a list for the workflow: offered, created and bound (the import then goes onto it); the name clash; the permission refusal', async () => {
    seed()
    const info = await nintexCreateTargetInfo(svc(), BOUND_WF)
    expect(info).toMatchObject({ extension: 'demo-sp', label: 'Create a SharePoint list for this workflow', defaultContainer: 'site-1' })
    const body = { name: 'Purchases 2026', container: 'site-1', kind: 'list', request_id: 'req-00000001', columns: [{ key: 'Approval_x0020_State', label: 'Approval State', kind: 'choice', choices: ['Escalated'] }, { key: 'Reviewer', label: 'Reviewer', kind: 'text', required: true }] }
    await expect(createNintexTarget(svc(['workflows.view']), 'demo-sp', body)).rejects.toMatchObject({ status: 403 })
    const made = await createNintexTarget(svc(), 'demo-sp', body)
    expect(made).toMatchObject({ id: 'ext.demo-sp.list', config: { list: '0e000000-0000-4000-8000-00000000c0ff' }, title: 'Purchases 2026', existing: false, created: [{ key: 'Approval_x0020_State' }, { key: 'Reviewer' }] })
    // Bound: a new workflow on the new list (nobody covers its events yet), events from the Nintex start options.
    const result = await runImport(svc(), 'nintex', files(), { target: made.id, target_config: made.config, forms: 'skip' })
    const fresh = wfRow(result.created[0].id)
    expect(db.current.tables.workflows).toHaveLength(3)
    expect(fresh).toMatchObject({ trigger_type: 'ext.demo-sp.item_event', trigger_config: { list: made.config.list, events: ['created'] } })
    await expect(createNintexTarget(svc(), 'demo-sp', { ...body, name: 'Purchase Requests' })).rejects.toMatchObject({ code: 'exists', status: 409 })
    const existing = await createNintexTarget(svc(), 'demo-sp', { ...body, name: 'Purchase Requests', if_exists: 'use' })
    expect(existing).toMatchObject({ existing: true, config: { list: LIST_ID } })
    await expect(createNintexTarget(svc(), 'demo-sp', { ...body, request_id: '' })).rejects.toMatchObject({ status: 400 })
  })
})
