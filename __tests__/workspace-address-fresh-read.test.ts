/**
 * storedWorkspaceOf is a fresh read. enforceHostWorkspace (lib/workspace-host.ts)
 * reads the user's current workspace, switches it with switch_tenant, then
 * reads it again in the same Server Component render. Next memoizes
 * identical GET fetches within a render unless they carry their own
 * AbortSignal, so the second read returned the old workspace and the first
 * visit to another workspace's address failed with "Could not open
 * workspace …" (seen in a real browser: a user who belongs to two
 * workspaces opening the second one's address).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { addressDeps, storedWorkspaceOf } from '@/lib/services/workspace-address'

type Row = { current_tenant_id: string | null; tenant_id: string | null }

/**
 * A service client whose reads behave like supabase-js under Next's fetch
 * memoization: the same query in the same render returns the first response,
 * unless abortSignal() gave it its own signal.
 */
function memoizingClient(db: { row: Row }) {
  const memo = new Map<string, Row>()
  return {
    from(table: string) {
      let key = table
      let signal: AbortSignal | null = null
      const builder = {
        select(cols: string) { key += `?select=${cols}`; return builder },
        eq(col: string, value: string) { key += `&${col}=eq.${value}`; return builder },
        maybeSingle() { return builder },
        abortSignal(s: AbortSignal) { signal = s; return builder },
        then(resolve: (value: { data: Row; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
          let data: Row
          if (signal) data = { ...db.row }
          else {
            if (!memo.has(key)) memo.set(key, { ...db.row })
            data = memo.get(key)!
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return builder
    },
  }
}

const original = addressDeps.serviceClient

afterEach(() => {
  addressDeps.serviceClient = original
})

describe('storedWorkspaceOf', () => {
  it('sees a workspace switch made earlier in the same render', async () => {
    const db = { row: { current_tenant_id: 'home', tenant_id: 'home' } }
    const client = memoizingClient(db)
    addressDeps.serviceClient = async () => client as never

    expect(await storedWorkspaceOf('u1')).toEqual({ current: 'home', home: 'home' })
    db.row.current_tenant_id = 'other' // switch_tenant
    expect(await storedWorkspaceOf('u1')).toEqual({ current: 'other', home: 'home' })
  })

  it('works with a client that has no abortSignal (other database providers)', async () => {
    const row: Row = { current_tenant_id: null, tenant_id: 'home' }
    const plain = {
      from: () => {
        const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: row, error: null }) }
        return b
      },
    }
    addressDeps.serviceClient = async () => plain as never
    expect(await storedWorkspaceOf('u1')).toEqual({ current: null, home: 'home' })
  })
})
