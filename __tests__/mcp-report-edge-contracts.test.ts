import { describe, expect, it } from 'vitest'

import { createMcpServer } from '@/lib/mcp/server'

function parseToolResponse(result: any) {
  const text = result?.content?.[0]?.text
  expect(typeof text).toBe('string')
  return JSON.parse(text)
}

function createReportEdgeSupabaseMock(seed?: Partial<Record<string, any[]>>) {
  const records: Record<string, any[]> = {
    tasks: [],
    users: [],
    workflows: [],
    workflow_runs: [],
    reports: [],
    ...seed,
  }

  let idCounter = 1
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value))
  const nextId = (table: string) => `${table}_${idCounter++}`

  const applyFilters = (
    rows: any[],
    filters: Array<{ type: string; field: string; value?: any; operator?: string }>,
  ) => {
    let filtered = [...rows]
    for (const filter of filters) {
      if (filter.type === 'eq') filtered = filtered.filter((row) => row?.[filter.field] === filter.value)
      if (filter.type === 'neq') filtered = filtered.filter((row) => row?.[filter.field] !== filter.value)
      if (filter.type === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : []
        filtered = filtered.filter((row) => values.includes(row?.[filter.field]))
      }
      if (filter.type === 'gt') filtered = filtered.filter((row) => row?.[filter.field] > filter.value)
      if (filter.type === 'lt') filtered = filtered.filter((row) => row?.[filter.field] < filter.value)
      if (filter.type === 'gte') filtered = filtered.filter((row) => row?.[filter.field] >= filter.value)
      if (filter.type === 'lte') filtered = filtered.filter((row) => row?.[filter.field] <= filter.value)
      if (filter.type === 'like' || filter.type === 'ilike') {
        const needle = String(filter.value ?? '').replaceAll('%', '').toLowerCase()
        filtered = filtered.filter((row) => String(row?.[filter.field] ?? '').toLowerCase().includes(needle))
      }
      if (filter.type === 'is') {
        filtered = filtered.filter((row) => row?.[filter.field] === filter.value)
      }
      if (filter.type === 'not' && filter.operator === 'is' && filter.value === null) {
        filtered = filtered.filter((row) => row?.[filter.field] != null)
      }
    }
    return filtered
  }

  const applyOrder = (
    rows: any[],
    orderings: Array<{ field: string; ascending: boolean }>,
  ) => {
    if (orderings.length === 0) return rows
    const next = [...rows]
    next.sort((left, right) => {
      for (const ordering of orderings) {
        const leftValue = left?.[ordering.field]
        const rightValue = right?.[ordering.field]
        if (leftValue === rightValue) continue
        const comparison = leftValue > rightValue ? 1 : -1
        return ordering.ascending ? comparison : -comparison
      }
      return 0
    })
    return next
  }

  const buildQuery = (table: string): any => {
    const state = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      payload: undefined as any,
      filters: [] as Array<{ type: string; field: string; value?: any; operator?: string }>,
      orderings: [] as Array<{ field: string; ascending: boolean }>,
      limitValue: undefined as number | undefined,
      upsertOptions: undefined as any,
      mode: 'many' as 'many' | 'single',
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

      const filtered = applyFilters(rows, state.filters)
      const ordered = applyOrder(filtered, state.orderings)
      const limited = typeof state.limitValue === 'number' ? ordered.slice(0, state.limitValue) : ordered
      const selected = limited.map((row) => clone(row))
      return state.mode === 'single' ? selected[0] ?? null : selected
    }

    const resolve = () => Promise.resolve({ data: execute(), error: null })

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
      select() { return this },
      eq(field: string, value: any) {
        state.filters.push({ type: 'eq', field, value })
        return this
      },
      neq(field: string, value: any) {
        state.filters.push({ type: 'neq', field, value })
        return this
      },
      in(field: string, value: any) {
        state.filters.push({ type: 'in', field, value })
        return this
      },
      gt(field: string, value: any) {
        state.filters.push({ type: 'gt', field, value })
        return this
      },
      lt(field: string, value: any) {
        state.filters.push({ type: 'lt', field, value })
        return this
      },
      gte(field: string, value: any) {
        state.filters.push({ type: 'gte', field, value })
        return this
      },
      lte(field: string, value: any) {
        state.filters.push({ type: 'lte', field, value })
        return this
      },
      like(field: string, value: any) {
        state.filters.push({ type: 'like', field, value })
        return this
      },
      ilike(field: string, value: any) {
        state.filters.push({ type: 'ilike', field, value })
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
      order(field: string, options?: { ascending?: boolean }) {
        state.orderings.push({ field, ascending: options?.ascending ?? true })
        return this
      },
      limit(value: number) {
        state.limitValue = value
        return this
      },
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

describe('MCP report edge contracts', () => {
  it('remediates rough grouped report configs before preview/save', async () => {
    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase: createReportEdgeSupabaseMock(),
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const result = await server.callTool('reports_remediate_config', {
      config: JSON.stringify({
        source: 'workflow_runs',
        columns: ['workflow_runs._count', 'status', 'not_real'],
        groupBy: ['status', 'missing_group'],
        aggregations: [{ field: 'id', fn: 'COUNT' }],
        joins: [
          {
            source: 'not_a_source',
            alias: 'bad_join',
            local_field: 'workflow_id',
            foreign_field: 'id',
            columns: ['name'],
          },
        ],
        sort: { field: 'workflow_runs._count', direction: 'desc' },
      }),
    })

    expect(result?.isError).not.toBe(true)
    const payload = parseToolResponse(result)

    expect(payload.remediated).toBe(true)
    expect(payload.issues_before.length).toBeGreaterThan(0)
    expect(payload.fixes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dropped joins that referenced unknown sources'),
        expect.stringContaining('Removed invalid report columns'),
        expect.stringContaining('Removed invalid group_by fields'),
        expect.stringContaining('Defaulted visualization to table'),
      ]),
    )
    expect(payload.issues_after).toEqual([])
    expect(payload.config).toMatchObject({
      data_source: 'workflow_runs',
      columns: ['COUNT_id', 'status'],
      group_by: ['status'],
      aggregations: [{ field: 'id', fn: 'COUNT' }],
      sort: { field: 'COUNT_id', direction: 'desc' },
      visualization: 'table',
      joins: [],
    })
  })

  it('previews joined and grouped reports after remediation and persists them', async () => {
    const supabase = createReportEdgeSupabaseMock({
      tasks: [
        {
          id: 'task_1',
          tenant_id: 'test-tenant',
          title: 'Approve budget',
          status: 'todo',
          assignee_id: 'user_1',
          deleted_at: null,
          created_at: '2026-04-15T10:00:00.000Z',
        },
        {
          id: 'task_2',
          tenant_id: 'test-tenant',
          title: 'Approve contract',
          status: 'todo',
          assignee_id: 'user_2',
          deleted_at: null,
          created_at: '2026-04-15T11:00:00.000Z',
        },
        {
          id: 'task_3',
          tenant_id: 'test-tenant',
          title: 'Closed request',
          status: 'done',
          assignee_id: 'user_1',
          deleted_at: null,
          created_at: '2026-04-15T12:00:00.000Z',
        },
      ],
      users: [
        { id: 'user_1', tenant_id: 'test-tenant', display_name: 'Andy Hayes', created_at: '2026-04-01T00:00:00.000Z' },
        { id: 'user_2', tenant_id: 'test-tenant', display_name: 'Sam Lee', created_at: '2026-04-01T00:00:00.000Z' },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const draftConfig = {
      source: 'tasks',
      columns: ['status', 'tasks._count', 'reviewer.display_name', 'bad_col'],
      groupBy: ['status'],
      aggregations: [{ field: 'id', fn: 'COUNT' }],
      joins: [
        {
          source: 'users',
          alias: 'reviewer',
          local_field: 'assignee_id',
          foreign_field: 'id',
          columns: ['display_name'],
          join_type: 'left',
        },
      ],
      sort: { field: 'tasks._count', direction: 'desc' },
    }

    const remediatedResult = await server.callTool('reports_remediate_config', {
      config: JSON.stringify(draftConfig),
    })
    expect(remediatedResult?.isError).not.toBe(true)
    const remediatedPayload = parseToolResponse(remediatedResult)

    const previewResult = await server.callTool('reports_preview', {
      config: JSON.stringify(remediatedPayload.config),
    })
    expect(previewResult?.isError).not.toBe(true)
    const previewPayload = parseToolResponse(previewResult)

    expect(previewPayload.preview.source).toMatchObject({ key: 'tasks' })
    expect(previewPayload.preview.joins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'users',
          alias: 'reviewer',
        }),
      ]),
    )
    expect(previewPayload.preview.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'status' }),
        expect.objectContaining({ key: 'reviewer.display_name' }),
      ]),
    )
    expect(previewPayload.preview.sample_rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'todo', COUNT_id: 2 }),
        expect.objectContaining({ status: 'done', COUNT_id: 1 }),
      ]),
    )

    const createResult = await server.callTool('reports_create', {
      name: 'Tasks By Status With Reviewer',
      config: JSON.stringify(remediatedPayload.config),
    })
    expect(createResult?.isError).not.toBe(true)
    const createPayload = parseToolResponse(createResult)

    expect(createPayload).toMatchObject({
      created: true,
      report: expect.objectContaining({
        name: 'Tasks By Status With Reviewer',
      }),
    })
    expect(createPayload.report.config).toMatchObject({
      data_source: 'tasks',
      columns: ['status', 'COUNT_id', 'reviewer.display_name'],
      visualization: 'table',
    })
  })

  it('fails clearly on invalid report updates and succeeds after remediation', async () => {
    const supabase = createReportEdgeSupabaseMock({
      reports: [
        {
          id: 'report_1',
          tenant_id: 'test-tenant',
          name: 'Workflow Volume',
          description: null,
          category: null,
          is_shared: false,
          config: {
            data_source: 'workflow_runs',
            columns: ['status', 'COUNT_id'],
            group_by: ['status'],
            aggregations: [{ field: 'id', fn: 'COUNT' }],
            visualization: 'bar',
            sort: { field: 'COUNT_id', direction: 'desc' },
          },
        },
      ],
    })

    const server = createMcpServer({
      tenantId: 'test-tenant',
      supabase,
      actingUserId: 'test-user',
      keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] },
    })

    const badUpdate = await server.callTool('reports_update', {
      report_id: 'report_1',
      config: JSON.stringify({
        data_source: 'workflow_runs',
        columns: ['status', 'workflow_runs._count'],
        group_by: ['missing_group'],
        aggregations: [{ field: 'id', fn: 'COUNT' }],
        sort: { field: 'not_real', direction: 'desc' },
      }),
    })

    expect(badUpdate?.isError).toBe(true)
    expect(String(badUpdate?.content?.[0]?.text ?? '')).toContain('Report config is invalid')

    const remediated = await server.callTool('reports_remediate_config', {
      config: JSON.stringify({
        data_source: 'workflow_runs',
        columns: ['status', 'workflow_runs._count'],
        group_by: ['missing_group'],
        aggregations: [{ field: 'id', fn: 'COUNT' }],
        sort: { field: 'not_real', direction: 'desc' },
      }),
    })
    expect(remediated?.isError).not.toBe(true)
    const remediatedPayload = parseToolResponse(remediated)

    const goodUpdate = await server.callTool('reports_update', {
      report_id: 'report_1',
      config: JSON.stringify(remediatedPayload.config),
    })
    expect(goodUpdate?.isError).not.toBe(true)
    const updatedPayload = parseToolResponse(goodUpdate)

    expect(updatedPayload).toMatchObject({
      updated: true,
      report_id: 'report_1',
    })
    expect(supabase.__records.reports[0].config).toMatchObject({
      data_source: 'workflow_runs',
      columns: ['status', 'COUNT_id'],
      group_by: [],
      visualization: 'table',
    })
  })
})
