/**
 * POST /api/references/execute (session path) needs integrations.test, like
 * POST /api/v1/references/{id}/execute: a member without it must not run a
 * reference against the external system with the workspace's credentials.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ perms: new Set<string>(), executed: 0 }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  getCachedUser: async () => ({ id: 'user-1', email: 'u@x.test' }),
}))
vi.mock('@/lib/permissions-server', () => ({ getUserPermissions: async () => state.perms }))
vi.mock('@/lib/integrations/auth', () => ({
  getCurrentTenantId: async () => 'tenant-1',
  getOwnedReference: async () => ({ id: 'ref-1' }),
}))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: () => ({}), isAuthorizedServiceCall: () => false }))
vi.mock('@/lib/reference-executor', () => ({
  executeReference: async () => { state.executed++; return { success: true } },
}))

import { POST } from '@/app/api/references/execute/route'

const req = () => new Request('http://localhost/api/references/execute', {
  method: 'POST',
  body: JSON.stringify({ referenceId: 'ref-1', inputs: {} }),
}) as any

describe('/api/references/execute session authz', () => {
  beforeEach(() => { state.perms = new Set(); state.executed = 0 })

  it('refuses a member without integrations.test and runs nothing', async () => {
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(state.executed).toBe(0)
  })

  it('runs for a member with integrations.test', async () => {
    state.perms = new Set(['integrations.test'])
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(state.executed).toBe(1)
  })
})

describe('/api/integrations/reference-usage authz', () => {
  it('needs integrations.view', async () => {
    vi.resetModules()
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: [] }) }) }) }),
      getSessionUserFast: async () => ({ id: 'user-1' }),
    }))
    const { GET } = await import('@/app/api/integrations/reference-usage/route')
    const req = () => ({ nextUrl: new URL('http://localhost/api/integrations/reference-usage?id=ref-1') }) as any
    state.perms = new Set()
    expect((await GET(req())).status).toBe(403)
    state.perms = new Set(['integrations.view'])
    expect((await GET(req())).status).toBe(200)
  })
})
