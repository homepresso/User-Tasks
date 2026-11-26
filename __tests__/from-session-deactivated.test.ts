/**
 * fromSession resolves the workspace with get_current_tenant_id(), which is
 * NULL where the user's membership is inactive (migration 20270130121500):
 * a deactivated member gets no ServiceContext there.
 */
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ current: null as string | null }))

vi.mock('@/lib/providers/db/session', () => ({
  getSessionDbWithUser: async () => ({
    user: { id: 'user-1' },
    supabase: {
      rpc: async (name: string) => (name === 'get_current_tenant_id' ? { data: state.current, error: null } : { data: null, error: null }),
      from: () => { throw new Error('fromSession must not read users.current_tenant_id directly') },
    },
  }),
}))
vi.mock('@/lib/permissions-server', () => ({ getUserPermissions: async () => new Set<string>() }))

import { fromSession } from '@/lib/services/context'

describe('fromSession workspace', () => {
  it('uses get_current_tenant_id()', async () => {
    state.current = 'tenant-a'
    expect((await fromSession()).tenantId).toBe('tenant-a')
  })
  it('refuses when there is no active workspace (deactivated membership)', async () => {
    state.current = null
    await expect(fromSession()).rejects.toThrow(/No workspace selected/)
  })
})
