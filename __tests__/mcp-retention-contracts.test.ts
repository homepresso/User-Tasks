import { describe, expect, it } from 'vitest'

import { createMcpServer } from '@/lib/mcp/server'

function parseToolResponse(result: any) {
  const text = result?.content?.[0]?.text
  expect(typeof text).toBe('string')
  return JSON.parse(text)
}

function createRetentionSupabaseMock(seed?: Partial<Record<string, any[]>>) {
  const records: Record<string, any[]> = {
    retention_policies: [],
    custom_tables: [],
    custom_table_rows: [],
    roles: [],
    ...seed,
  }

  let idCounter = 1

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
  const nextId = (table: string) => `${table}_${idCounter++}`

  const applyFilters = (
    rows: any[],
    filters: Array<{ type: 'eq' | 'in' | 'is' | 'not'; field: string; value?: any; operator?: string }>,
  ) => {
    let filtered = [...rows]
    for (const filter of filters) {
      if (filter.type === 'eq') filtered = filtered.filter((row) => row?.[filter.field] === filter.value)
      if (filter.type === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : []
        filtered = filtered.filter((row) => values.includes(row?.[filter.field]))
      }
      if (filter.type === 'is') filtered = filtered.filter((row) => row?.[filter.field] === filter.value)
      if (filter.type === 'not' && filter.operator === 'is' && filter.value === null) {
        filtered = filtered.filter((row) => row?.[filter.field] != null)
      }
    }
    return filtered
  }

  const buildCountResult = (rows: any[]) => ({
    data: null,
    error: null,
    count: rows.length,
  })

  const buildQuery = (table: string): any => {
    const state = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      payload: undefined as any,
      filters: [] as Array<{ type: 'eq' | 'in' | 'is' | 'not'; field: string; value?: any; operator?: string }>,
      upsertOptions: undefined as any,
      mode: 'many' as 'many' | 'single',
      head: false,
      count: undefined as any,
    }

    const execute = () => {
      const rows = records[table] ?? (records[table] = [])

      if (state.op === 'insert') {
        const inputRows = Array.isArray(state.payload) ? state.payload : [state.payload]
        const inserted = inputRows.map((item) => {
          const row = clone(item ?? {})
          if (!row.id) row.id = nextId(table)
          rows.push(row)
          return clone(row)
        })
        return state.mode === 'single' ? inserted[0] ?? null : inserted
      }

      if (state.op === 'upsert') {
        const inputRows = Array.isArray(state.payload) ? state.payload : [state.payload]
        const upserted = inputRows.map((item) => {
          const row = clone(item ?? {})
          const onConflict = String(state.upsertOptions?.onConflict ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
          const existingIndex = rows.findIndex((candidate) => {
            if (onConflict.length === 0) return candidate?.id && row?.id && candidate.id === row.id
            return onConflict.every((field) => candidate?.[field] === row?.[field])
          })
          if (existingIndex >= 0) {
            rows[existingIndex] = { ...rows[existingIndex], ...row }
            return clone(rows[existingIndex])
          }
          if (!row.id) row.id = nextId(table)
          rows.push(row)
          return clone(row)
        })
        return state.mode === 'single' ? upserted[0] ?? null : upserted
      }

      if (state.op === 'update') {
        const matchingRows = applyFilters(rows, state.filters)
        const updated = matchingRows.map((row) => {
          Object.assign(row, clone(state.payload ?? {}))
          return clone(row)
        })
        return state.mode === 'single' ? updated[0] ?? null : updated
      }

      if (state.op === 'delete') {
        const removed = applyFilters(rows, state.filters)
        records[table] = rows.filter((row) => !removed.includes(row))
        return state.mode === 'single' ? clone(removed[0] ?? null) : clone(removed)
      }

      const selected = applyFilters(rows, state.filters).map((row) => clone(row))
      return state.mode === 'single' ? selected[0] ?? null : selected
    }

    const resolve = () => {
      const rows = applyFilters(records[table] ?? [], state.filters)
      if (state.op === 'select' && state.head && state.count === 'exact') {
        return Promise.resolve(buildCountResult(rows))
      }
      return Promise.resolve({ data: execute(), error: null })
    }

    return {
      insert(payload: any) {
        state.op = 'insert'
        state.payload = payload
        return this
      },
      upsert(payload: any, options?: any) {
        state.op = 'upsert'
        state.payload = payload
        state.upsertOptions = options
        return this
      },
      update(payload: any) {
        state.op = 'update'
        state.payload = payload
        return this
      },
      delete() {
        state.op = 'delete'
        return this
      },
      select(_columns?: any, options?: any) {
        state.head = Boolean(options?.head)
        state.count = options?.count
        return this
      },
      eq(field: string, value: any) {
        state.filters.push({ type: 'eq', field, value })
        return this
      },
      in(field: string, value: any) {
        state.filters.push({ type: 'in', field, value })
        return this
      },
      is(field: string, value: any) {
        state.filters.push({ type: 'is', field, value })
        return this
      },
      not(field: string, operator: string, value: any) {
        state.filters.push({ type: 'not', field, operator, value })
        return this
      },
      or() { return this },
      order() { return this },
      limit() { return this },
      single() {
        state.mode = 'single'
        return resolve()
      },
      maybeSingle() {
        state.mode = 'single'
        return resolve()
      },
      then(onFulfilled: any, onRejected: any) {
        return resolve().then(onFulfilled, onRejected)
      },
    }
  }

  return {
    from(table: string) {
      return buildQuery(table)
    },
    __records: records,
  }
}
describe('MCP retention contracts', () => {
  it('creates retention policies, assigns usage, and blocks deletion while in use', async () => {
    const supabase = createRetentionSupabaseMock({
      custom_tables: [{ id: 'table-1', tenant_id: 'test-tenant', name: 'Contracts' }],
    })
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const policyResult = await server.callTool('retention_policies_create', {
      name: 'Seven Year Record Policy',
      policy_mode: 'purge_on',
      duration_value: 7,
      duration_unit: 'years',
      applies_to: ['data_tables', 'data_rows'],
    })
    expect(policyResult?.isError).not.toBe(true)
    const policyPayload = parseToolResponse(policyResult)
    expect(policyPayload).toMatchObject({
      created: true,
      retention_policy: expect.objectContaining({
        name: 'Seven Year Record Policy',
        policy_mode: 'purge_on',
      }),
    })

    const assignResult = await server.callTool('retention_policies_assign', {
      target_type: 'data_table',
      target_id: 'table-1',
      retention_policy_id: policyPayload.retention_policy.id,
    })
    expect(assignResult?.isError).not.toBe(true)
    expect(parseToolResponse(assignResult)).toMatchObject({
      updated: true,
      target_type: 'data_table',
      target_id: 'table-1',
      retention_policy_id: policyPayload.retention_policy.id,
    })

    const assetsResult = await server.callTool('retention_policies_list_assets', {
      retention_policy_id: policyPayload.retention_policy.id,
    })
    expect(assetsResult?.isError).not.toBe(true)
    const assetsPayload = parseToolResponse(assetsResult)
    expect(assetsPayload.usage).toEqual({
      data_tables: 1,
      data_rows: 0,
      roles: 0,
    })
    expect(assetsPayload.assets.data_tables).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'table-1', name: 'Contracts' })]),
    )

    const deleteWhileAssigned = await server.callTool('retention_policies_delete', {
      retention_policy_id: policyPayload.retention_policy.id,
    })
    expect(deleteWhileAssigned?.isError).toBe(true)
    expect(deleteWhileAssigned.content[0].text).toContain('Remove this policy from all assigned assets before deleting it')
  })

  it('rejects assigning a policy to a scope it does not cover', async () => {
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase: createRetentionSupabaseMock({
        roles: [{ id: 'role-1', tenant_id: 'test-tenant', name: 'Reviewer' }],
      }),
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const policyPayload = parseToolResponse(await server.callTool('retention_policies_create', {
      name: 'Table only',
      policy_mode: 'review',
      duration_value: 1,
      duration_unit: 'years',
      applies_to: ['data_tables'],
    }))

    const assignResult = await server.callTool('retention_policies_assign', {
      target_type: 'role',
      target_id: 'role-1',
      retention_policy_id: policyPayload.retention_policy.id,
    })
    expect(assignResult?.isError).toBe(true)
    expect(assignResult.content[0].text).toContain('cannot be applied to this target type')
  })
})
