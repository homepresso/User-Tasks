/**
 * The import's contract on every surface: the REST endpoint (registry,
 * OpenAPI, multipart, async variant, the route itself), the CLI command
 * metadata, the MCP tool, the `data.import` background job and the Agent
 * tool (write mode, no file upload, confirmation card from a dry run).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const spy = vi.hoisted(() => ({ events: [] as any[] }))
vi.mock('@/lib/api-auth', async (orig) => ({ ...(await orig<any>()), validateApiKey: vi.fn() }))
vi.mock('@/lib/user-jobs/runner', async (orig) => ({ ...(await orig<any>()), enqueueUserJob: vi.fn() }))
vi.mock('@/lib/data-table-workflow-triggers', async (orig) => ({
  ...(await orig<any>()),
  enqueueDataTableEvents: vi.fn(async (p: any) => { spy.events.push(...p.events); return p.events.length }),
}))
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig<any>()), audit: vi.fn(async () => undefined), queueDeletions: vi.fn(async () => undefined) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { enqueueUserJob } from '@/lib/user-jobs/runner'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { importRowsEndpoint, rowImportBody } from '@/lib/api-schemas/data-tables'
import { buildOpenApiDocument } from '@/lib/api-schemas/openapi'
import { API_JOB_ENDPOINTS } from '@/lib/user-jobs/kinds/api'
import { getJobKind, isUiJobKind } from '@/lib/user-jobs/kinds'
import { dataImportParams } from '@/lib/user-jobs/kinds/data'
import { POST as importRoute } from '@/app/api/v1/data-tables/[id]/rows/import/route'
import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { designerTools, personMcpContext } from '@/lib/assistants/tools/designer'
import { runAssistantTurn } from '@/lib/assistants/engine'
import type { AssistantEvent } from '@/lib/assistants/types'
import { SURFACE_PARITY } from '@/lib/surface-parity'
import { createImportFakeDb, type ImportFakeDb } from './helpers/data-import-fake-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABLE = '30000000-0000-4000-8000-000000000001'
const COLUMNS = [
  { key: 'id', name: 'ID', type: 'number' },
  { key: 'date_created', name: 'Date Created', type: 'date' },
  { key: 'order_no', name: 'Order No', type: 'text' },
  { key: 'amount', name: 'Amount', type: 'number' },
]
const CSV = 'Order No,Amount\nINV-1,$1200.00\nINV-2,$35.50\n'
let db: ImportFakeDb
const rows = () => (db.tables.custom_table_rows ?? []).filter((r) => r.table_id === TABLE)

function authAs(permissions: string[], tableIds: string[] = []) {
  vi.mocked(validateApiKey).mockResolvedValue({
    success: true, tenantId: 't1', keyId: 'key-1', keyType: 'user', createdBy: 'u1', actingUserId: 'u1',
    scopes: { workflow_ids: [], table_ids: tableIds }, permissions, supabase: db.client as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  spy.events = []
  db = createImportFakeDb({ custom_tables: [{ id: TABLE, tenant_id: 't1', name: 'Orders', slug: 'orders', columns: COLUMNS }] })
})

describe('REST endpoint', () => {
  it('is registered: path, permission, async variant, multipart, CLI', () => {
    expect(API_ENDPOINTS).toContain(importRowsEndpoint)
    expect(importRowsEndpoint).toMatchObject({
      method: 'POST', path: '/data-tables/{id}/rows/import', operationId: 'importDataRows', permission: 'data.manage_rows', async: true,
      multipart: { files: { file: { name: 'file_name', content: 'file_base64' } } },
      cli: { resource: 'rows', verb: 'import', positional: ['id'] },
    })
    expect(API_JOB_ENDPOINTS.map((e) => e.endpoint.operationId)).toContain('importDataRows')
    expect(existsSync(path.join(process.cwd(), 'app/api/v1/data-tables/[id]/rows/import/route.ts'))).toBe(true)
    const rowsOps = SURFACE_PARITY.find((r) => r.resource === 'data rows')!.ops
    expect(rowsOps.find((o) => o.op === 'import')).toMatchObject({ rest: 'POST /data-tables/{id}/rows/import', mcp: 'data_rows_import', cli: 'rows import' })
  })

  it('OpenAPI: multipart/form-data with a binary file, and x-usertasks-async', () => {
    const op = (buildOpenApiDocument() as any).paths['/data-tables/{id}/rows/import'].post
    expect(op.operationId).toBe('importDataRows')
    expect(op['x-usertasks-async']).toBe(true)
    expect(op.requestBody.content['multipart/form-data'].schema.properties.file).toEqual({ type: 'string', format: 'binary' })
    expect(op.requestBody.content['application/json']).toBeTruthy()
    expect(op.responses['202']).toBeTruthy()
  })

  it('the body accepts multipart-style text: booleans, JSON mapping / new_columns', () => {
    const parsed = rowImportBody.parse({
      file_base64: 'eA==', file_name: 'a.csv', dry_run: 'true', skip_invalid: '0', fire_triggers: 'off', trim: 'on',
      mapping: '{"Ref":"order_no","Junk":null}', new_columns: '[{"header":"Region","type":"select","options":["West"]}]', delimiter: '\t',
    })
    expect(parsed).toMatchObject({ dry_run: true, skip_invalid: false, fire_triggers: false, trim: true, mapping: { Ref: 'order_no', Junk: null }, new_columns: [{ header: 'Region', type: 'select' }] })
    expect(rowImportBody.safeParse({ file_base64: 'eA==', file_name: 'a.csv', mapping: '{bad' }).success).toBe(false)
    expect(rowImportBody.safeParse({ file_name: 'a.csv' }).success).toBe(false)
    expect(rowImportBody.safeParse({ file_base64: 'eA==', file_name: 'a.csv', mode: 'merge' }).success).toBe(false)
  })

  it('multipart upload imports inline and returns the report', async () => {
    authAs(['data.manage_rows'])
    const form = new FormData()
    form.set('file', new File([CSV], 'orders.csv', { type: 'text/csv' }))
    form.set('fire_triggers', 'false')
    const res = await importRoute(new NextRequest(`https://app.test/api/v1/data-tables/${TABLE}/rows/import`, { method: 'POST', body: form, headers: { authorization: 'Bearer ut_x' } }), { params: Promise.resolve({ id: TABLE }) } as any)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ imported: true, fire_triggers: false, counts: { inserted: 2, failed: 0 }, file: { name: 'orders.csv', format: 'csv' } })
    expect(rows().map((r) => r.data.amount)).toEqual([1200, 35.5])
    expect(spy.events).toEqual([])
  })

  it('row errors are a 400 with the errors; nothing written', async () => {
    authAs(['data.manage_rows'])
    const res = await importRoute(new NextRequest(`https://app.test/api/v1/data-tables/${TABLE}/rows/import`, {
      method: 'POST', body: JSON.stringify({ file_base64: Buffer.from('Order No,Amount\nA,ten\n').toString('base64'), file_name: 'x.csv' }),
      headers: { authorization: 'Bearer ut_x', 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: TABLE }) } as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(JSON.stringify(json)).toMatch(/Not a number/)
    expect(rows()).toEqual([])
  })

  it('without data.manage_rows: 403', async () => {
    authAs(['data.view'])
    const res = await importRoute(new NextRequest(`https://app.test/api/v1/data-tables/${TABLE}/rows/import`, {
      method: 'POST', body: JSON.stringify({ file_base64: 'eA==', file_name: 'x.csv' }), headers: { authorization: 'Bearer ut_x', 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: TABLE }) } as any)
    expect(res.status).toBe(403)
  })

  it('?async=true queues api.importdatarows (202)', async () => {
    authAs(['data.manage_rows'])
    vi.mocked(enqueueUserJob).mockResolvedValue({ id: 'job-1', status: 'queued' } as any)
    const res = await importRoute(new NextRequest(`https://app.test/api/v1/data-tables/${TABLE}/rows/import?async=true`, {
      method: 'POST', body: JSON.stringify({ file_base64: Buffer.from(CSV).toString('base64'), file_name: 'orders.csv' }), headers: { authorization: 'Bearer ut_x', 'content-type': 'application/json' },
    }), { params: Promise.resolve({ id: TABLE }) } as any)
    expect(res.status).toBe(202)
    expect(vi.mocked(enqueueUserJob).mock.calls[0][1]).toBe('api.importdatarows')
    expect(rows()).toEqual([])
  })
})

describe('background job kind', () => {
  it('data.import takes a file input and can be started from the UI', () => {
    const kind = getJobKind('data.import')!
    expect(kind).toBeTruthy()
    expect(kind.input?.maxBytes).toBeGreaterThanOrEqual(10 * 1024 * 1024)
    expect(kind.effect).toBe('change')
    expect(isUiJobKind('data.import')).toBe(true)
    const p = dataImportParams.parse({ table_id: TABLE, file_name: 'orders.csv' })
    expect(p).toMatchObject({ mode: 'insert', trim: true, empty_cells: 'empty', skip_invalid: false, fire_triggers: true })
    expect(kind.title(p)).toBe('Import orders.csv into table')
  })

  it('authorize: data.manage_rows, data.edit_schema for new columns, table scope', async () => {
    const kind = getJobKind('data.import')!
    const base = { supabase: db.client, tenantId: 't1', actorId: 'u1', authKind: 'job', source: 'job' } as any
    const p = dataImportParams.parse({ table_id: TABLE, file_name: 'x.csv' })
    expect(() => kind.authorize({ ...base, permissions: new Set(['data.view']) }, p)).toThrow(/data\.manage_rows/)
    expect(() => kind.authorize({ ...base, permissions: new Set(['data.manage_rows']) }, { ...p, new_columns: [{ header: 'X' }] })).toThrow(/data\.edit_schema/)
    expect(() => kind.authorize({ ...base, permissions: new Set(['data.manage_rows']), resourceScopes: { workflow_ids: [], table_ids: ['other'] } }, p)).toThrow(/not allowed/)
    expect(() => kind.authorize({ ...base, permissions: new Set(['data.manage_rows']) }, p)).not.toThrow()
  })
})

const mcpCtx = (perms: string[]): McpContext => personMcpContext({ tenantId: 't1', userId: 'u1', permissions: new Set(perms), serviceDb: db.client })
const text = (r: any) => JSON.parse(r.content[0].text)

describe('MCP data_rows_import', () => {
  it('needs data.manage_rows', async () => {
    expect(requiredToolPermission('data_rows_import')).toBe('data.manage_rows')
    const denied = await createMcpServer(mcpCtx(['data.view'])).callTool('data_rows_import', { table_id: TABLE, csv_text: CSV })
    expect(denied.isError).toBe(true)
  })

  it('dry run from csv_text through the real service; then the import', async () => {
    const server = createMcpServer(mcpCtx(['data.view', 'data.manage_rows']))
    const dry = text(await server.callTool('data_rows_import', { table_id: TABLE, csv_text: CSV, dry_run: true }))
    expect(dry).toMatchObject({ dry_run: true, counts: { valid: 2 }, preview: [{ order_no: 'INV-1', amount: 1200 }, { order_no: 'INV-2', amount: 35.5 }] })
    expect(rows()).toEqual([])
    const done = text(await server.callTool('data_rows_import', { table_id: TABLE, file_base64: Buffer.from(CSV).toString('base64'), file_name: 'orders.csv' }))
    expect(done.counts.inserted).toBe(2)
    expect(rows()).toHaveLength(2)
  })

  it('needs a file or text', async () => {
    const r = await createMcpServer(mcpCtx(['data.manage_rows'])).callTool('data_rows_import', { table_id: TABLE })
    expect(r.isError).toBe(true)
  })
})

const conn = { provider: 'openai' as const, model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' }
function provider(...replies: Array<{ content?: string | null; tool_calls?: any[] }>) {
  let n = 0
  const fetchImpl = vi.fn(async () => {
    const msg = replies[Math.min(n++, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200 })
  })
  return fetchImpl as unknown as typeof fetch
}
const PERMS = ['data.view', 'data.manage_rows']
const agentTools = () => designerTools({ server: createMcpServer(mcpCtx(PERMS)), permissions: new Set(PERMS) })

describe('the Agent tool', () => {
  it('is a write tool without file_base64 / sheet in its schema', () => {
    const tool = agentTools().find((t) => t.name === 'data_rows_import')!
    expect(tool.mode).toBe('write')
    const props = (tool.parameters as any).properties
    expect(props.csv_text).toBeTruthy()
    expect(props.file_base64).toBeUndefined()
    expect(props.sheet).toBeUndefined()
  })

  it('the confirmation card is a dry run: nothing is written until confirmed', async () => {
    const events: AssistantEvent[] = []
    const call = { id: 'c1', type: 'function', function: { name: 'data_rows_import', arguments: JSON.stringify({ table_id: TABLE, csv_text: CSV }) } }
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'import' }], tools: agentTools(), onEvent: (e) => events.push(e), fetchImpl: provider({ content: null, tool_calls: [call] }) })
    expect(r.status).toBe('awaiting_confirmation')
    const card = (events.find((e) => e.type === 'confirm') as any).card
    expect(card.title).toBe('Import into “Orders”: 2 rows')
    expect(card.preview.total).toBe(2)
    expect(card.preview.rows[0]).toEqual(['INV-1', '1200'])
    expect(rows()).toEqual([])
  })

  it('rows with errors: the model is told to fix them or skip_invalid (no card)', async () => {
    const events: AssistantEvent[] = []
    const call = { id: 'c1', type: 'function', function: { name: 'data_rows_import', arguments: JSON.stringify({ table_id: TABLE, csv_text: 'Order No,Amount\nA,ten\nB,2\n' }) } }
    const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'import' }], tools: agentTools(), onEvent: (e) => events.push(e), fetchImpl: provider({ content: null, tool_calls: [call] }, { content: 'ok' }) })
    expect(events.find((e) => e.type === 'confirm')).toBeUndefined()
    // The tool result the model sees.
    expect(JSON.stringify(r.newMessages)).toMatch(/1 of 2 rows have errors \(row 2 Amount: Not a number\).*skip_invalid/)
    expect(rows()).toEqual([])
  })
})
