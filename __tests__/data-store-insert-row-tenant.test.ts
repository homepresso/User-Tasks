/**
 * insertRow (Data table "add row") must file the row under the table's own
 * workspace, never a tenant id the client sent.
 */
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ inserted: null as Record<string, unknown> | null }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/permissions-server', () => ({ requirePermission: async () => {} }))
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEventWorkflows: async () => {} }))
vi.mock('@/lib/supabase/server', () => {
  const tables: Record<string, any> = { custom_tables: { id: 'tbl-1', tenant_id: 'tenant-table', columns: [] } }
  const from = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      single: async () => (table === 'custom_table_rows' ? { data: { id: 'row-1' }, error: null } : { data: tables[table] ?? null, error: null }),
      insert: (row: Record<string, unknown>) => { state.inserted = row; return q },
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    }
    return q
  }
  return { createClient: async () => ({ from }), getCachedUser: async () => ({ id: 'user-1' }) }
})

import { insertRow } from '@/app/actions/data-store'

describe('insertRow tenant', () => {
  it("ignores the client's tenant id and uses the table's", async () => {
    await insertRow('tbl-1', 'tenant-attacker', { name: 'x' })
    expect(state.inserted?.tenant_id).toBe('tenant-table')
  })
})
