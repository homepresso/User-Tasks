import { describe, expect, it } from 'vitest'
import { loadGovernanceData } from '@/lib/governance-data'

const TENANT = 'tenant-1'

/** Records every PostgREST call; answers each table with canned rows. */
function recorder(rows: Record<string, unknown[]>) {
  const calls: Array<{ table: string; select?: string; filters: Array<[string, unknown]> }> = []
  const from = (table: string) => {
    const call = { table, select: undefined as string | undefined, filters: [] as Array<[string, unknown]> }
    calls.push(call)
    const chain: Record<string, unknown> = {
      select: (cols: string) => { call.select = cols; return chain },
      eq: (col: string, value: unknown) => { call.filters.push([col, value]); return chain },
      order: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
    }
    return chain
  }
  return { client: { from } as unknown as Parameters<typeof loadGovernanceData>[0], calls }
}

describe('loadGovernanceData', () => {
  it('scopes every query to the tenant and resolves audit actors without a PostgREST embed', async () => {
    const { client, calls } = recorder({
      users: [{ id: 'u1', display_name: 'Ada Lovelace', email: 'ada@example.com', role: 'owner' }],
      user_roles: [{ id: 'ur1', user_id: 'u1', role_id: 'r1' }],
      permission_audit_log: [
        { id: 'a1', action: 'role_created', actor_id: 'u1', created_at: '2026-10-24T00:00:00Z' },
        { id: 'a2', action: 'role_updated', actor_id: 'someone-else', created_at: '2026-10-23T00:00:00Z' },
      ],
    })
    const data = await loadGovernanceData(client, TENANT)

    for (const call of calls) expect(call.filters).toContainEqual(['tenant_id', TENANT])
    const audit = calls.find((c) => c.table === 'permission_audit_log')!
    // permission_audit_log has no actor_id foreign key: an embed answers 400.
    expect(audit.select).not.toMatch(/actor:|!/)
    expect(data.auditLog.map((e) => e.actor)).toEqual([{ id: 'u1', display_name: 'Ada Lovelace' }, null])
    expect(data.users[0].assignments).toHaveLength(1)
  })

  it('refuses to query without a tenant (no `tenant_id=eq.` requests)', async () => {
    const { client, calls } = recorder({})
    await expect(loadGovernanceData(client, '')).rejects.toThrow(/tenant id is required/)
    expect(calls).toHaveLength(0)
  })
})
