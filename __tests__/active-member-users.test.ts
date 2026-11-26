import { describe, expect, it } from 'vitest'
import { activeMemberUsers } from '@/lib/services/ui-reads/define'
import { createMemorySupabase } from './fixtures/supabase-memory'

// Pickers (tasks.assignTargets, the form task-access read) looked up every
// member's user row with ONE .in('id', ids) of up to 2,000 uuids: ~74 KB of
// PostgREST query string, beyond common gateway URL limits. Chunks of 200.
describe('activeMemberUsers', () => {
  it('reads users in .in() chunks of at most 200 ids, active members of the workspace only', async () => {
    const T = 'tenant-a'
    const users = Array.from({ length: 450 }, (_, i) => ({ id: `u${i}`, tenant_id: T, display_name: `User ${i}`, email: null, deleted_at: i === 7 ? '2026-01-01' : null }))
    const db: any = createMemorySupabase({
      users,
      user_memberships: [
        ...users.map((u, i) => ({ user_id: u.id, tenant_id: T, is_active: i !== 3 })),
        { user_id: 'other', tenant_id: 'tenant-b', is_active: true },
      ],
    })
    const sizes: number[] = []
    const from = db.from.bind(db)
    db.from = (table: string) => {
      const q: any = from(table)
      if (table === 'users') { const inFn = q.in.bind(q); q.in = (col: string, ids: string[]) => { sizes.push(ids.length); return inFn(col, ids) } }
      return q
    }
    const rows = await activeMemberUsers(db, T)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(200)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(449)
    expect(rows).toHaveLength(448)
    expect(rows.find((r) => r.id === 'u3' || r.id === 'u7')).toBeUndefined()
  })
})
