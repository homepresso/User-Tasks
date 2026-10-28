import { describe, expect, it } from 'vitest'

import { createMcpServer, type McpContext } from '@/lib/mcp/server'

function textOf(result: any): string {
  return result?.content?.[0]?.text ?? ''
}

/**
 * Minimal chainable Supabase mock. `results` maps a table name to the rows the
 * terminal (.maybeSingle/.single/await) should resolve with.
 */
function mockSupabase(results: Record<string, any>) {
  const make = (table: string) => {
    const builder: any = {
      _table: table,
      select() { return builder },
      eq() { return builder },
      in() { return builder },
      or() { return builder },
      order() { return builder },
      limit() { return builder },
      range() { return builder },
      is() { return builder },
      maybeSingle: async () => ({ data: results[table] ?? null, error: null }),
      single: async () => ({ data: results[table] ?? null, error: null }),
      insert() { return builder },
      update() { return builder },
      delete() { return builder },
      then(resolve: any) { resolve({ data: results[table] ?? [], error: null }) },
    }
    return builder
  }
  return { from: (table: string) => make(table) }
}

function ctxWith(supabase: any, extra: Partial<McpContext> = {}): McpContext {
  return {
    tenantId: 't1',
    supabase,
    actingUserId: 'u1',
    keyType: 'tenant',
    scopes: { workflow_ids: [], table_ids: [] },
    ...extra,
  } as McpContext
}

describe('data_rows_upsert validation', () => {
  it('rejects data keys that are not declared columns', async () => {
    const supabase = mockSupabase({ custom_tables: { columns: [{ key: 'name' }, { name: 'Email' }] } })
    const server = createMcpServer(ctxWith(supabase))
    const result = await server.callTool('data_rows_upsert', {
      table_id: 'tbl1',
      data: { name: 'Ada', bogus_field: 'x' },
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('bogus_field')
  })

  it('accepts data whose keys match declared columns', async () => {
    const supabase = mockSupabase({
      custom_tables: { columns: [{ key: 'name' }, { name: 'Email' }] },
      custom_table_rows: { id: 'row1' },
    })
    const server = createMcpServer(ctxWith(supabase))
    const result = await server.callTool('data_rows_upsert', {
      table_id: 'tbl1',
      data: { name: 'Ada', email: 'ada@x.io' },
    })
    expect(result.isError).toBeFalsy()
  })

  it('returns Table not found when the table is missing', async () => {
    const supabase = mockSupabase({}) // custom_tables → null
    const server = createMcpServer(ctxWith(supabase))
    const result = await server.callTool('data_rows_upsert', { table_id: 'nope', data: { a: 1 } })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Table not found')
  })
})

describe('agents_execute guards', () => {
  it('rejects an oversized message before touching the DB', async () => {
    const server = createMcpServer(ctxWith(mockSupabase({})))
    const result = await server.callTool('agents_execute', { agent_id: 'a1', message: 'x'.repeat(100_001) })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('maximum length')
  })

  it('rejects an agent that does not belong to the tenant', async () => {
    const supabase = mockSupabase({}) // agents → null
    const server = createMcpServer(ctxWith(supabase))
    const result = await server.callTool('agents_execute', { agent_id: 'ghost', message: 'hello' })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Agent not found')
  })
})
