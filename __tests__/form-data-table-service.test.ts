import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = 'bbbbbbbb-0000-4000-8000-000000000001'
const FORM = 'bbbbbbbb-0000-4000-8000-000000000002'
const TABLE = 'bbbbbbbb-0000-4000-8000-000000000003'
const OTHER_TABLE = 'bbbbbbbb-0000-4000-8000-000000000004'

const API_FIELD = {
  key: 'suppliers', label: 'Suppliers', type: 'data_table',
  data_table: {
    source: 'reference', reference_id: 'ref-suppliers', mode: 'select', multiple: true, key_column: 'id', results_path: 'data',
    input_mappings: { q: '{{search}}', country: '{{form.country}}' },
    columns: [{ key: 'id', label: 'Id', type: 'text' }, { key: 'name', label: 'Name', type: 'text', sortable: true, filterable: true }, { key: 'rating', label: 'Rating', type: 'number', sortable: true, filterable: true }],
    base_filter: { match: 'all', conditions: [{ column: 'rating', operator: 'gte', value: '3' }] },
    page_size: 2,
  },
}
const TABLE_FIELD = {
  key: 'vendors', label: 'Vendors', type: 'data_table',
  data_table: { source: 'table', table_id: TABLE, mode: 'display', columns: [{ key: 'name', label: 'Name', type: 'text' }], base_filter: { match: 'all', conditions: [{ column: 'name', operator: 'is_set' }] } },
}

let forms: Record<string, any>
let orCalls: string[]
let clientUsed: string[]

function fakeDb(label: string) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, in() { return api }, order() { return api },
        range() { return api }, limit() { return api }, abortSignal() { return api }, maybeSingle() { return api },
        or(expr: string) { orCalls.push(expr); return api },
        then(resolve: (v: unknown) => unknown) {
          clientUsed.push(`${label}:${table}`)
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'custom_tables') return Promise.resolve({ data: get('id') === TABLE ? { columns: [{ key: 'name', type: 'text' }, { key: 'secret', type: 'text' }] } : null, error: null }).then(resolve)
          if (table === 'custom_table_rows') return Promise.resolve({ data: [{ id: 'r1', data: { name: 'Acme', secret: 'S1' } }], count: 1, error: null }).then(resolve)
          if (table === 'users') return Promise.resolve({ data: null, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const serviceDb = fakeDb('service')
const callerDb = fakeDb('caller')
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => serviceDb }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))

const { queryDataTable, dataTableDeps } = await import('@/lib/services/form-data-table')

const ctx = (perms: string[], over: Partial<ServiceContext> = {}): ServiceContext => ({ supabase: callerDb as any, tenantId: TENANT, actorId: null, permissions: new Set(perms), authKind: 'api_key', source: 'api', ...over })
let refCalls: any[]

beforeEach(() => {
  forms = { [FORM]: { id: FORM, fields: [{ key: 'country', label: 'Country', type: 'text' }, API_FIELD, TABLE_FIELD] } }
  orCalls = []
  clientUsed = []
  refCalls = []
  dataTableDeps.executeReference = async (opts: any) => {
    refCalls.push(opts)
    return { status: 200, data: { data: [
      { id: 's1', name: 'Alpha', rating: 5, api_key: 'LEAK-1', contact: { phone: '1' } },
      { id: 's2', name: 'Beta', rating: 2, api_key: 'LEAK-2' },
      { id: 's3', name: 'Gamma', rating: 4, api_key: 'LEAK-3' },
      { id: 's4', name: 'Delta', rating: 3, api_key: 'LEAK-4' },
    ] } } as any
  }
})

describe('API reference sources', () => {
  it('maps the table state to request inputs, projects the response, applies the rest on the server', async () => {
    const res = await queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'suppliers', query: { search: 'a', sort: [{ column: 'rating', direction: 'desc' }] }, values: { country: 'NZ' } })
    expect(refCalls[0]).toMatchObject({ referenceId: 'ref-suppliers', inputValues: { q: 'a', country: 'NZ' }, expectedTenantId: TENANT })
    // Base filter (rating >= 3) always; the API did the search; sort + page applied by the server.
    expect(res.rows.map((r) => r.key)).toEqual(['s1', 's3'])
    expect(res).toMatchObject({ total: 3, page_size: 2, applied_locally: ['sort', 'page'] })
    expect(JSON.stringify(res)).not.toMatch(/LEAK|contact|phone/)
  })

  it('an API error is a friendly 502, never the upstream detail', async () => {
    dataTableDeps.executeReference = async () => { throw new Error('ECONNREFUSED 10.0.0.5:443 token=abc') }
    await expect(queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'suppliers' })).rejects.toThrow("The table's API is not available right now")
  })
})

describe('source resolution and permissions', () => {
  it('only Data table fields of the saved form answer', async () => {
    await expect(queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'country' })).rejects.toThrow(/no Data table field/)
    await expect(queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'nope' })).rejects.toThrow(/no Data table field/)
    await expect(queryDataTable(ctx([]), { form_id: FORM }, { field_key: 'suppliers' })).rejects.toThrow(/forms.submit/)
  })

  it('data tables need data.view and run on the caller’s own client (RLS); the credential’s table allowlist applies', async () => {
    await expect(queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'vendors' })).rejects.toThrow(/data.view/)
    const res = await queryDataTable(ctx(['forms.submit', 'data.view']), { form_id: FORM }, { field_key: 'vendors' })
    expect(res.rows).toEqual([{ key: 'r1', values: { name: 'Acme', row_id: 'r1' } }])
    expect(clientUsed).toContain('caller:custom_table_rows')
    expect(orCalls).toEqual(['and(and(data->name.not.is.null))'])
    await expect(queryDataTable(ctx(['forms.submit', 'data.view'], { resourceScopes: { table_ids: [OTHER_TABLE] } as any }), { form_id: FORM }, { field_key: 'vendors' })).rejects.toThrow(/not allowed to access that table/)
  })

  it('open access: the form authorises the read (tenant-scoped service client), still projected', async () => {
    forms[FORM].fields[2] = { ...TABLE_FIELD, data_table: { ...TABLE_FIELD.data_table, open_access: true } }
    const res = await queryDataTable(ctx(['forms.submit']), { form_id: FORM }, { field_key: 'vendors' })
    expect(JSON.stringify(res)).not.toContain('S1')
    expect(clientUsed).toContain('service:custom_table_rows')
    expect(clientUsed).not.toContain('caller:custom_table_rows')
  })

  it('the designer preview runs an unsaved config only with edit rights (and data / integration access)', async () => {
    await expect(queryDataTable(ctx(['forms.submit', 'data.view']), { preview_field: TABLE_FIELD }, {})).rejects.toThrow(/forms.edit/)
    await expect(queryDataTable(ctx(['forms.edit']), { preview_field: TABLE_FIELD }, {})).rejects.toThrow(/data.view/)
    await expect(queryDataTable(ctx(['forms.edit']), { preview_field: API_FIELD }, {})).rejects.toThrow(/integrations.view/)
    // Open access does not apply to previews.
    await expect(queryDataTable(ctx(['forms.edit']), { preview_field: { ...TABLE_FIELD, data_table: { ...TABLE_FIELD.data_table, open_access: true } } }, {})).rejects.toThrow(/data.view/)
    expect((await queryDataTable(ctx(['forms.edit', 'data.view']), { preview_field: TABLE_FIELD }, {})).total).toBe(1)
  })
})
