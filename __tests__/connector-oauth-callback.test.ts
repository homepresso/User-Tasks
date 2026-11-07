import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  stateFilters: [] as Array<[string, unknown]>,
  stateRow: null as any,
  connector: null as any,
  rpcs: [] as Array<{ name: string; args: any }>,
}))

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
vi.mock('@/lib/supabase/server', () => ({ getCachedUser: async () => state.user }))
vi.mock('@/lib/oauth/redirect', () => ({ appBaseUrl: () => 'https://app.example.com' }))
vi.mock('@/lib/cron-auth', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const b: any = {
        update: () => b, select: () => b, is: () => b, gt: () => b,
        eq: (col: string, val: unknown) => { if (table === 'oauth_connect_states') state.stateFilters.push([col, val]); return b },
        maybeSingle: async () => {
          if (table === 'oauth_connect_states') {
            const userFilter = state.stateFilters.find(([c]) => c === 'user_id')
            return { data: state.stateRow && userFilter?.[1] === state.stateRow.user_id ? state.stateRow : null }
          }
          return { data: state.connector }
        },
      }
      return b
    },
    rpc: async (name: string, args: any) => { state.rpcs.push({ name, args }); return { error: null } },
  }),
}))

import { GET } from '@/app/api/connectors/oauth/callback/route'

afterEach(() => {
  vi.unstubAllGlobals()
  state.user = null
  state.stateFilters = []
  state.rpcs = []
})

function call() {
  return GET(new Request('https://app.example.com/api/connectors/oauth/callback?code=c0de&state=uost_fake') as any)
}

describe('connector OAuth callback', () => {
  state.stateRow = { id: 's1', tenant_id: 't1', user_id: 'user-a', payload: { connector_id: 'conn-1', code_verifier_secret: 'v'.repeat(64), redirect_after: '/integrations/i1' } }
  state.connector = { id: 'conn-1', tenant_id: 't1', connector_key: 'oauth2:i1', config: { token_url: 'https://login.example.com/token', client_id: 'cid' }, credentials: { client_secret: 'fake-secret' } }

  it('refuses when nobody is signed in', async () => {
    const res = await call()
    expect(res.headers.get('location')).toContain('oauth=error')
    expect(state.rpcs).toHaveLength(0)
  })

  it('refuses a state started by another user (no token exchange)', async () => {
    state.user = { id: 'user-b' }
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect(res.headers.get('location')).toContain('expired')
    expect(state.stateFilters).toContainEqual(['user_id', 'user-b'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exchanges the code for the user who started the flow', async () => {
    state.user = { id: 'user-a' }
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect(res.headers.get('location')).toContain('oauth=connected')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://login.example.com/token')
    expect(String(init.body)).toContain('code_verifier=')
    expect(state.rpcs.map((r) => r.name)).toEqual(['merge_tenant_connector_credentials', 'merge_tenant_connector_config'])
  })
})
