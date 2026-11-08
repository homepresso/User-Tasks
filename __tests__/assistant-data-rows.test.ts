/**
 * Data rows through the Agent and MCP: the Agent's row tools are permission
 * filtered and always confirmed (previews, caps, typed confirm for big
 * deletes, a filtered delete runs on exactly the previewed ids); MCP gains
 * data_rows_create / data_rows_update, filtered bulk delete, a name filter on
 * data_tables_list and lookup by name in data_tables_get; long lists are
 * compacted for the Agent so a name lookup is never cut off.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const svc = vi.hoisted(() => ({
  tables: [] as any[],
  rows: [] as any[],
  upserts: [] as any[],
  updates: [] as any[],
  deletes: [] as any[],
}))

vi.mock('@/lib/services/data-tables', async (orig) => {
  const actual: any = await orig()
  return {
    ...actual,
    listDataTables: vi.fn(async (_ctx: any, f: { search?: string }) => ({ data_tables: svc.tables.filter((t) => !f.search || t.name.toLowerCase().includes(f.search.toLowerCase())), total: svc.tables.length })),
    getDataTable: vi.fn(async (_ctx: any, id: string) => { const t = svc.tables.find((x) => x.id === id); if (!t) throw new Error('Table not found'); return t }),
    queryRows: vi.fn(async (_ctx: any, _id: string, q: any, page: any) => {
      const rows = svc.rows.filter((r) => (q.filters ?? []).every((f: any) => String(r.data[f.field]) === String(f.value)))
      return { rows: rows.slice(0, page.limit), total: rows.length, truncated: false }
    }),
    getRow: vi.fn(async (_c: any, _t: string, id: string) => svc.rows.find((r) => r.id === id)),
    upsertRows: vi.fn(async (_c: any, tableId: string, rows: any[]) => { svc.upserts.push({ tableId, rows }); return rows.map((_r, i) => ({ row_id: `new-${i}`, action: 'created' })) }),
    updateRow: vi.fn(async (_c: any, tableId: string, id: string, cells: any) => { svc.updates.push({ tableId, id, cells }); return {} }),
    deleteRows: vi.fn(async (_c: any, tableId: string, ids: string[]) => { svc.deletes.push({ tableId, ids }); return { deleted: ids.length, ids } }),
  }
})

import { createMcpServer, type McpContext } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { allowedDesignerToolNames, compactListPayload, designerTools, personMcpContext, TYPED_DELETE_THRESHOLD } from '@/lib/assistants/tools/designer'
import { runAssistantTurn } from '@/lib/assistants/engine'
import type { AssistantEvent } from '@/lib/assistants/types'

/* eslint-disable @typescript-eslint/no-explicit-any */

const T1 = '11111111-1111-4111-8111-111111111111'
const ROWS_PERMS = ['data.view', 'data.manage_rows']
const ctx = (perms: string[]): McpContext => ({ ...personMcpContext({ tenantId: 't1', userId: 'u1', permissions: new Set(perms), serviceDb: {} }) })
const text = (r: any) => JSON.parse(r.content[0].text)

beforeEach(() => {
  svc.tables = [
    ...Array.from({ length: 120 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: `Table ${i}`, slug: `table_${i}`, columns: Array.from({ length: 30 }, (_, c) => ({ key: `c${c}`, name: `Column ${c}`, type: 'text' })) })),
    { id: T1, name: 'Temporary employees', slug: 'temporary_employees', columns: [{ key: 'name', name: 'Name', type: 'text' }, { key: 'status', name: 'Status', type: 'select' }, { key: 'pin', name: 'PIN', type: 'secret' }] },
  ]
  svc.rows = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, data: { name: `Person ${i}`, status: i < 30 ? 'ended' : 'active', pin: '1234' } }))
  svc.upserts = []; svc.updates = []; svc.deletes = []
})

describe('MCP: row tools and table lookup', () => {
  it('authz: the new row writes need data.manage_rows', () => {
    for (const t of ['data_rows_create', 'data_rows_update', 'data_rows_bulk_delete']) expect(requiredToolPermission(t)).toBe('data.manage_rows')
    expect(requiredToolPermission('data_tables_list')).toBe('data.view')
  })

  it('data_tables_list filters by query; data_tables_get takes a name or system name', async () => {
    const server = createMcpServer(ctx(['data.view']))
    const listed = text(await server.callTool('data_tables_list', { query: 'temporary' }))
    expect(listed.tables.map((t: any) => t.name)).toEqual(['Temporary employees'])
    expect(text(await server.callTool('data_tables_get', { table_id: 'Temporary employees' })).id).toBe(T1)
    expect(text(await server.callTool('data_tables_get', { table_id: 'temporary_employees' })).id).toBe(T1)
  })

  it('data_rows_create inserts many rows; refused without data.manage_rows', async () => {
    const denied = await createMcpServer(ctx(['data.view'])).callTool('data_rows_create', { table_id: T1, rows: [{ name: 'A' }] })
    expect(denied.isError).toBe(true)
    const r = text(await createMcpServer(ctx(ROWS_PERMS)).callTool('data_rows_create', { table_id: 'Temporary employees', rows: [{ name: 'A' }, { name: 'B' }] }))
    expect(r.created).toBe(2)
    expect(svc.upserts[0]).toMatchObject({ tableId: T1, rows: [{ data: { name: 'A' } }, { data: { name: 'B' } }] })
  })

  it('data_rows_update by filter respects max_rows (more matches change nothing)', async () => {
    const server = createMcpServer(ctx(ROWS_PERMS))
    const over = await server.callTool('data_rows_update', { table_id: T1, data: { status: 'archived' }, filters: [{ field: 'status', operator: 'equals', value: 'ended' }], max_rows: 10 })
    expect(over.isError).toBe(true)
    expect(svc.updates).toEqual([])
    const ok = text(await server.callTool('data_rows_update', { table_id: T1, data: { status: 'archived' }, filters: [{ field: 'status', operator: 'equals', value: 'active' }] }))
    expect(ok.updated).toBe(10)
    expect(svc.updates[0].cells).toEqual({ status: 'archived' })
  })

  it('data_rows_bulk_delete by filter, capped', async () => {
    const server = createMcpServer(ctx(ROWS_PERMS))
    expect((await server.callTool('data_rows_bulk_delete', { table_id: T1, filters: [{ field: 'status', operator: 'equals', value: 'ended' }], max_rows: 5 })).isError).toBe(true)
    const ok = text(await server.callTool('data_rows_bulk_delete', { table_id: T1, filters: [{ field: 'status', operator: 'equals', value: 'active' }] }))
    expect(ok.deleted).toBe(10)
  })
})

/* ── The Agent ── */

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
const agentTools = (perms: string[]) => designerTools({ server: createMcpServer(ctx(perms)), permissions: new Set(perms) })

async function confirmCard(perms: string[], name: string, args: any) {
  const events: AssistantEvent[] = []
  const p = provider({ content: null, tool_calls: [call('c1', name, args)] })
  const r = await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: [{ role: 'user', content: 'go' }], tools: agentTools(perms), onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
  return { r, card: (events.find((e) => e.type === 'confirm') as any)?.card, events, history: [{ role: 'user' as const, content: 'go' }, ...r.newMessages] }
}

describe('the Agent\'s row tools', () => {
  it('permission filtered: a viewer gets reads only (no row writes); a member with data.manage_rows gets all three, as write tools', () => {
    const viewer = allowedDesignerToolNames(new Set(['data.view']))
    expect(viewer).toEqual(expect.arrayContaining(['data_rows_query', 'data_rows_get', 'data_tables_list']))
    expect(viewer.filter((n) => /data_rows_(create|update|bulk_delete)/.test(n))).toEqual([])
    expect(allowedDesignerToolNames(new Set(['tasks.view_own']))).toEqual([])
    const tools = agentTools(ROWS_PERMS)
    for (const n of ['data_rows_create', 'data_rows_update', 'data_rows_bulk_delete']) expect(tools.find((t) => t.name === n)?.mode).toBe('write')
  })

  it('creating rows waits for confirmation with a table preview (first 10 + count; secret columns masked)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `Fictional ${i}`, status: 'active', pin: '9999' }))
    const { r, card } = await confirmCard(ROWS_PERMS, 'data_rows_create', { table_id: 'Temporary employees', rows })
    expect(r.status).toBe('awaiting_confirmation')
    expect(svc.upserts).toEqual([])
    expect(card.title).toBe('Add 12 rows to “Temporary employees”')
    expect(card.preview.rows).toHaveLength(10)
    expect(card.preview.total).toBe(12)
    expect(JSON.stringify(card.preview)).not.toContain('9999')
    expect(card.warnings.join(' ')).toMatch(/triggered by row changes/)
  })

  it('bulk caps: more than 200 rows are refused before any card', async () => {
    const { card, r } = await confirmCard(ROWS_PERMS, 'data_rows_create', { table_id: T1, rows: Array.from({ length: 201 }, () => ({ name: 'x' })) })
    expect(card).toBeUndefined()
    expect(JSON.stringify(r.newMessages)).toMatch(/At most 200 rows/)
  })

  it('update by filter shows before → after for a sample', async () => {
    const { card } = await confirmCard(ROWS_PERMS, 'data_rows_update', { table_id: T1, data: { status: 'archived' }, filters: [{ field: 'status', operator: 'equals', value: 'active' }] })
    expect(card.title).toBe('Update 10 rows in “Temporary employees”')
    expect(card.preview.columns).toEqual(['Row', 'Status (before)', 'Status (after)'])
    expect(card.preview.rows[0].slice(1)).toEqual(['active', 'archived'])
  })

  it('delete by filter: preview, red "Delete N rows", typed confirm over the threshold; runs on exactly the previewed ids', async () => {
    const small = await confirmCard(ROWS_PERMS, 'data_rows_bulk_delete', { table_id: T1, filters: [{ field: 'status', operator: 'equals', value: 'active' }] })
    expect(small.card).toMatchObject({ danger: true, confirm_label: 'Delete 10 rows' })
    expect(small.card.typed_confirm).toBeUndefined()
    const big = await confirmCard(ROWS_PERMS, 'data_rows_bulk_delete', { table_id: T1, filters: [{ field: 'status', operator: 'equals', value: 'ended' }] })
    expect(big.card.confirm_label).toBe('Delete 30 rows')
    expect(30).toBeGreaterThan(TYPED_DELETE_THRESHOLD)
    expect(big.card.typed_confirm).toBe('delete 30')
    expect(svc.deletes).toEqual([])
    // Confirmed (next request): deletes those 30 ids, by id.
    const p = provider({ content: 'Deleted.' })
    const events: AssistantEvent[] = []
    await runAssistantTurn({ connection: conn, instructions: 'I', context: null, history: big.history, tools: agentTools(ROWS_PERMS), decision: { tool_call_id: 'c1', approved: true }, onEvent: (e) => events.push(e), fetchImpl: p.fetchImpl })
    expect(svc.deletes).toHaveLength(1)
    expect(svc.deletes[0].ids).toHaveLength(30)
    expect(events.find((e) => e.type === 'changed')).toMatchObject({ kind: 'data_rows', action: 'deleted' })
  })

  it('more rows than the cap match: the card is refused (nothing to confirm)', async () => {
    const { card } = await confirmCard(ROWS_PERMS, 'data_rows_bulk_delete', { table_id: T1, filters: [{ field: 'status', operator: 'equals', value: 'ended' }], max_rows: 5 })
    expect(card).toBeUndefined()
  })
})

describe('table lookup with many tables never truncates the answer', () => {
  it('list results are compact for the Agent (id, name, counts) — the table at the end of a long list is still there', async () => {
    const tools = agentTools(['data.view'])
    const list = tools.find((t) => t.name === 'data_tables_list')!
    const { result } = await list.run({}, { emit: () => {}, toolCallId: 'x' })
    const json = JSON.stringify(result)
    expect(json.length).toBeLessThan(20_000) // the engine's tool-result cap
    expect(json).toContain('Temporary employees')
    expect((result as any).tables[0]).toEqual({ id: expect.any(String), name: 'Table 0', system_name: 'table_0', columns: 30 })
    expect(compactListPayload({ error: 'x' })).toEqual({ error: 'x' })
  })
})
