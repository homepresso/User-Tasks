import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFreshConnectorToken, assertSafeEgressUrl } = vi.hoisted(() => ({
  getFreshConnectorToken: vi.fn(),
  assertSafeEgressUrl: vi.fn(),
}))

vi.mock('@/lib/oauth/client-token', () => ({ getFreshConnectorToken }))
vi.mock('@/lib/egress-guard', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/egress-guard')>()
  return { ...original, assertSafeEgressUrl }
})

import { executeReference } from '@/lib/reference-executor'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'

function brokerSupabase() {
  const reference = {
    id: 'ref-1',
    tenant_id: 'tenant-1',
    integration_id: 'integration-1',
    request_config: { method: 'GET', path_template: '/widgets' },
    inputs: [],
    integration: {
      id: 'integration-1',
      tenant_id: 'tenant-1',
      name: 'Generic REST service',
      config: {
        base_url: 'https://api.example.com',
        auth_type: 'oauth2',
        auth_config: {},
      },
    },
  }

  return {
    from(table: string) {
      if (table === 'integration_references') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: reference, error: null }),
        }
        return chain
      }
      if (table === 'tenant_connectors') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: 'connector-1' }, error: null }),
        }
        return chain
      }
      if (table === 'integration_call_logs') {
        return { insert: async () => ({ error: null }) }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  } as any
}

describe('generic REST broker OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFreshConnectorToken.mockResolvedValue('fresh-provider-token')
    assertSafeEgressUrl.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: [{ id: 1 }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
  })

  it('resolves the linked connector and authenticates a generic REST reference', async () => {
    const supabase = brokerSupabase()
    const result = await executeReference({
      supabase,
      referenceId: 'ref-1',
      inputValues: {},
      expectedTenantId: 'tenant-1',
    })

    expect(result).toMatchObject({ status: 200, data: { items: [{ id: 1 }] } })
    expect(getFreshConnectorToken).toHaveBeenCalledWith({ supabase, connectorId: 'connector-1' })
    expect(assertSafeEgressUrl).toHaveBeenCalledWith('https://api.example.com/widgets')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/widgets',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-provider-token' }),
      }),
    )
  })

  it('uses an explicitly linked connector when one is stored in auth config', async () => {
    const supabase = brokerSupabase()
    const headers: Record<string, string> = {}

    await applyAuthHeaders(
      { auth_type: 'oauth2', auth_config: { connector_id: 'connector-explicit' } },
      headers,
      { supabase, integrationId: 'integration-1' },
    )

    expect(headers.Authorization).toBe('Bearer fresh-provider-token')
    expect(getFreshConnectorToken).toHaveBeenCalledWith({ supabase, connectorId: 'connector-explicit' })
  })

  it('fails closed when OAuth has not been connected', async () => {
    const supabase = {
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return chain
      },
    } as any

    await expect(applyAuthHeaders(
      { auth_type: 'oauth2', auth_config: {} },
      {},
      { supabase, integrationId: 'integration-1' },
    )).rejects.toThrow('reconnect the integration')
  })
})
