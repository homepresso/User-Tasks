import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { fixtureXsn } from './helpers/infopath-fixtures'

/* The forms / data table / workflow services and audit are stubbed: this tests the importer's own logic. */
const store = vi.hoisted(() => ({ forms: [] as any[], tables: [] as any[], workflows: [] as any[], audits: [] as any[], failOn: null as null | string }))

vi.mock('@/lib/services/forms', () => ({
  createForm: vi.fn(async (_ctx: unknown, input: any) => {
    if (store.failOn && input.name.includes(store.failOn)) throw new Error('boom')
    const row = { id: `f${store.forms.length + 1}`, version: 1, ...input }
    store.forms.push(row)
    return row
  }),
  updateForm: vi.fn(async (_ctx: unknown, id: string, input: any) => {
    const row = store.forms.find((f) => f.id === id)
    Object.assign(row, input, { version: row.version + 1 })
    return row
  }),
  getForm: vi.fn(async (_ctx: unknown, id: string) => ({ ...store.forms.find((f) => f.id === id) })),
  deleteForm: vi.fn(async (_ctx: unknown, id: string) => { store.forms = store.forms.filter((f) => f.id !== id) }),
}))
vi.mock('@/lib/services/data-tables', () => ({
  createDataTable: vi.fn(async (_ctx: unknown, input: any) => { const row = { id: `t${store.tables.length + 1}`, ...input }; store.tables.push(row); return row }),
}))
vi.mock('@/lib/services/workflows', () => ({
  createWorkflow: vi.fn(async (_ctx: unknown, input: any) => { store.workflows.push(input); return { workflow_id: `w${store.workflows.length}` } }),
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/_shared')>()),
  audit: vi.fn(async (_ctx: unknown, row: unknown) => { store.audits.push(row) }),
  serviceRoleClient: vi.fn(async () => stubDb()),
}))

const { analyzeInfoPathFile, importInfoPathFile, decodeBase64File } = await import('@/lib/services/infopath-import')

/** A chainable Supabase stub: `forms` with layout.source returns the store's forms. */
function stubDb() {
  const chain = (table: string): any => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, limit: () => q, delete: () => q, order: () => q,
      then: (resolve: (v: unknown) => void) => resolve({ data: table === 'forms' ? store.forms.map((f) => ({ id: f.id, name: f.name, layout: f.layout })) : [], error: null }),
    }
    return q
  }
  return { from: chain }
}

function ctx(perms: string[]): ServiceContext {
  return { supabase: stubDb() as never, tenantId: 't1', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext
}

const EDITOR = ['forms.view', 'forms.edit', 'data.view', 'data.create', 'workflows.create']

beforeEach(() => { store.forms = []; store.tables = []; store.workflows = []; store.audits = []; store.failOn = null })

describe('InfoPath import service', () => {
  it('analyses without storing anything (forms.view)', async () => {
    const out = await analyzeInfoPathFile(ctx(['forms.view']), fixtureXsn('leave-request'), 'Leave Request.xsn', {}, { definitions: true })
    expect(out.forms.map((f) => f.name)).toEqual(['Leave Request — Leave request', 'Leave Request — Manager approval'])
    expect(out.forms[0].definition?.fields.length).toBeGreaterThan(5)
    expect(out.markdown).toContain('# InfoPath import')
    expect(store.forms).toEqual([])
    expect(store.audits).toEqual([])
  })

  it('creates one form per view (forms.edit), audited', async () => {
    const out = await importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn')
    expect(out.created.map((c) => [c.name, c.href])).toEqual([['Leave Request — Leave request', '/automations/forms/f1'], ['Leave Request — Manager approval', '/automations/forms/f2']])
    expect(store.forms.map((f) => f.layout.source.view)).toEqual(['Request', 'Approval'])
    expect(store.audits[0]).toMatchObject({ action: 'import', metadata: { created: ['f1', 'f2'] } })
  })

  it('combined mode makes one form with steps', async () => {
    const out = await importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn', { mode: 'combined' })
    expect(out.created).toHaveLength(1)
    expect(store.forms[0].layout.mode).toBe('steps')
  })

  it('re-import offers and performs an update of the forms made before', async () => {
    await importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn')
    const again = await analyzeInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn', { existing: 'update' })
    expect(again.existing.map((e) => [e.id, e.view, e.same_file])).toEqual([['f1', 'Request', true], ['f2', 'Approval', true]])
    expect(again.forms.map((f) => f.updates?.id)).toEqual(['f1', 'f2'])
    const out = await importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn', { existing: 'update' })
    expect(out.created).toEqual([])
    expect(out.updated.map((u) => u.id)).toEqual(['f1', 'f2'])
    expect(store.forms).toHaveLength(2)
    expect(store.forms[0].version).toBe(2)
    // existing: new still creates copies.
    const copies = await importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn')
    expect(copies.created).toHaveLength(2)
  })

  it('creates the data table, child tables and a draft save workflow on request', async () => {
    const out = await importInfoPathFile(ctx(EDITOR), fixtureXsn('expense-report'), 'Expense Report.xsn', { create_table: true })
    expect(out.table).toMatchObject({ name: 'Expense Report submissions', child_tables: [{ list: 'line_items', name: 'Expense Report — Line items' }] })
    expect(store.tables[0].columns.map((c: any) => c.key)).toEqual(expect.arrayContaining(['reference', 'employee_name', 'email', 'total']))
    expect(store.tables[1].columns.map((c: any) => c.key)).toEqual(['parent_id', 'reference', 'expense_date', 'description', 'category', 'quantity', 'unit_price', 'line_total'])
    const wf = store.workflows[0]
    expect(wf).toMatchObject({ trigger_type: 'form_submitted', is_active: false })
    expect(wf.nodes.map((n: any) => n.type)).toEqual(['form_submitted', 'update_data_table', 'loop', 'update_data_table', 'end_workflow'])
    expect(wf.nodes[3].config.column_values).toMatchObject({ parent_id: '{{parent_id}}', unit_price: '{{item.unit_price}}' })
  })

  it('checks permissions', async () => {
    await expect(analyzeInfoPathFile(ctx([]), fixtureXsn('expense-report'), 'x.xsn')).rejects.toThrow(/forms.view/)
    await expect(importInfoPathFile(ctx(['forms.view']), fixtureXsn('expense-report'), 'x.xsn')).rejects.toThrow(/forms.edit/)
    await expect(importInfoPathFile(ctx(['forms.view', 'forms.edit']), fixtureXsn('expense-report'), 'x.xsn', { create_table: true })).rejects.toThrow(/data.create/)
    expect(store.forms).toEqual([])
  })

  it('rolls back everything when a step fails', async () => {
    store.failOn = 'Manager approval'
    await expect(importInfoPathFile(ctx(EDITOR), fixtureXsn('leave-request'), 'Leave Request.xsn')).rejects.toThrow(/Nothing was kept/)
    expect(store.forms).toEqual([])
  })

  it('turns bad files into validation errors and decodes base64 safely', async () => {
    await expect(analyzeInfoPathFile(ctx(EDITOR), Buffer.from('not a form'), 'x.xsn')).rejects.toMatchObject({ status: 400 })
    expect(() => decodeBase64File('***', 10)).toThrow(/not base64/)
    expect(() => decodeBase64File(Buffer.alloc(100).toString('base64'), 10)).toThrow(/larger than/)
    expect(decodeBase64File(`data:application/octet-stream;base64,${Buffer.from('hi').toString('base64')}`, 10).toString()).toBe('hi')
  })
})

describe('REST / MCP parity', () => {
  it('the MCP tool and the REST endpoint take the same options', async () => {
    const { createMcpServer } = await import('@/lib/mcp/server')
    const { importInfoPathEndpoint } = await import('@/lib/api-schemas/forms')
    const tool = createMcpServer({ tenantId: 't1', supabase: stubDb() as never }).getRegisteredTools().find((t) => t.name === 'forms_import_infopath')!
    expect(tool).toBeTruthy()
    const restKeys = Object.keys((importInfoPathEndpoint.body as any).shape).sort()
    const mcpKeys = Object.keys((tool as any).inputSchema.properties).sort()
    expect(mcpKeys).toEqual(restKeys)
  })

  it('the MCP tool returns the same analysis as the service', async () => {
    const { createMcpServer } = await import('@/lib/mcp/server')
    const server = createMcpServer({ tenantId: 't1', supabase: stubDb() as never, permissions: ['forms.view'] } as never)
    const res: any = await server.callTool('forms_import_infopath', { file_base64: fixtureXsn('expense-report').toString('base64'), file_name: 'Expense Report.xsn', dry_run: true })
    const body = JSON.parse(res.content[0].text)
    const direct = await analyzeInfoPathFile(ctx(['forms.view']), fixtureXsn('expense-report'), 'Expense Report.xsn')
    expect(body.dry_run).toBe(true)
    expect(body.report.summary).toEqual(direct.report.summary)
    expect(body.forms.map((f: any) => f.name)).toEqual(direct.forms.map((f) => f.name))
  })
})
