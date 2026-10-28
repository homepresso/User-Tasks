import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEventWorkflows: vi.fn(async () => {}) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { getODataCollectionName } from '@/lib/odata'
import { DELETE, GET, PATCH, POST } from '@/app/api/odata/[[...segments]]/route'

const mockedValidate = vi.mocked(validateApiKey)

const TABLE = { id: 'tbl-1', name: 'Expenses', slug: 'expenses', columns: [{ key: 'amount', label: 'Amount', type: 'number' }], tenant_id: 'tenant-1' }
const ROW = { id: 'row-1', data: { amount: 12 }, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const COLLECTION = getODataCollectionName(TABLE)

/** Chainable Supabase stub: list results via await, single rows via single/maybeSingle. */
function mockSupabase() {
  const listFor = (table: string) => (table === 'custom_tables' ? [TABLE] : table === 'custom_table_rows' ? [ROW] : [])
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        or: () => builder,
        order: () => builder,
        range: () => builder,
        limit: () => builder,
        insert: () => builder,
        update: () => builder,
        delete: () => builder,
        single: async () => ({ data: table === 'custom_table_rows' ? ROW : null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: listFor(table), error: null, count: listFor(table).length }),
      }
      return builder
    },
  }
}

function auth(permissions: string[]): ApiKeySuccessResult {
  return {
    success: true,
    tenantId: 'tenant-1',
    keyId: 'key-1',
    keyType: 'tenant',
    createdBy: null,
    actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] },
    permissions,
    supabase: mockSupabase() as unknown as ApiKeySuccessResult['supabase'],
    authKind: 'api_key',
  }
}

const ctx = (segments: string[]) => ({ params: Promise.resolve({ segments }) })
const req = (path: string, method = 'GET', body?: unknown) =>
  new NextRequest(`https://app.test/api/odata${path}`, {
    method,
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => mockedValidate.mockReset())

describe('OData reads', () => {
  it('denies table rows without data.view', async () => {
    mockedValidate.mockResolvedValue(auth(['reports.view', 'data.manage_rows']))
    const response = await GET(req(`/${COLLECTION}`), ctx([COLLECTION]))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain("'data.view'")
  })

  it('serves table rows with data.view', async () => {
    mockedValidate.mockResolvedValue(auth(['data.view']))
    const response = await GET(req(`/${COLLECTION}`), ctx([COLLECTION]))
    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.value).toHaveLength(1)
  })

  it('denies a single row without data.view', async () => {
    mockedValidate.mockResolvedValue(auth([]))
    const response = await GET(req(`/${COLLECTION}('row-1')`), ctx([`${COLLECTION}('row-1')`]))
    expect(response.status).toBe(403)
  })

  it('gates report collections on reports.view rather than data.view', async () => {
    mockedValidate.mockResolvedValue(auth(['data.view']))
    expect((await GET(req('/SavedReports'), ctx(['SavedReports']))).status).toBe(403)

    mockedValidate.mockResolvedValue(auth(['reports.view']))
    expect((await GET(req('/SavedReports'), ctx(['SavedReports']))).status).toBe(200)
  })

  it('denies the service document without any read permission', async () => {
    mockedValidate.mockResolvedValue(auth(['data.manage_rows']))
    expect((await GET(req(''), ctx([]))).status).toBe(403)
    expect((await GET(req('/$metadata'), ctx(['$metadata']))).status).toBe(403)
  })

  it('omits custom tables from the service document without data.view', async () => {
    mockedValidate.mockResolvedValue(auth(['reports.view']))
    const reportsOnly = await (await GET(req(''), ctx([]))).json()
    const names = reportsOnly.value.map((entry: { name: string }) => entry.name)
    expect(names).toContain('SavedReports')
    expect(names).not.toContain(COLLECTION)

    mockedValidate.mockResolvedValue(auth(['data.view']))
    const withData = await (await GET(req(''), ctx([]))).json()
    expect(withData.value.map((entry: { name: string }) => entry.name)).toContain(COLLECTION)
  })
})

describe('OData writes', () => {
  it('denies create, update, replace and delete without data.manage_rows', async () => {
    mockedValidate.mockResolvedValue(auth(['data.view']))
    const entity = `${COLLECTION}('row-1')`
    expect((await POST(req(`/${COLLECTION}`, 'POST', { amount: 1 }), ctx([COLLECTION]))).status).toBe(403)
    expect((await PATCH(req(`/${entity}`, 'PATCH', { amount: 2 }), ctx([entity]))).status).toBe(403)
    expect((await DELETE(req(`/${entity}`, 'DELETE'), ctx([entity]))).status).toBe(403)
  })

  it('allows delete with data.manage_rows', async () => {
    mockedValidate.mockResolvedValue(auth(['data.manage_rows']))
    const entity = `${COLLECTION}('row-1')`
    const response = await DELETE(req(`/${entity}`, 'DELETE'), ctx([entity]))
    expect(response.status).toBe(204)
  })

  it('still enforces the per-key table allowlist', async () => {
    mockedValidate.mockResolvedValue({ ...auth(['data.view', 'data.manage_rows']), scopes: { workflow_ids: [], table_ids: ['other-table'] } })
    expect((await GET(req(`/${COLLECTION}`), ctx([COLLECTION]))).status).toBe(403)
  })
})
