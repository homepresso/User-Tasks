import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'

const tables: Record<string, unknown> = {}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        update: () => builder,
        maybeSingle: async () => ({ data: Array.isArray(tables[table]) ? tables[table][0] ?? null : tables[table] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      }
      return builder
    },
  }),
}))

import { validateApiKey } from '@/lib/api-auth'
import { resetCredentialCacheForTests } from '@/lib/api-auth-cache'

const API_KEY = 'utk_test_0123456789abcdef'
let keyHash = ''

beforeAll(async () => {
  keyHash = await bcrypt.hash(API_KEY, 4)
})

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  // Each case re-validates the same token against different rows.
  resetCredentialCacheForTests()
})

const request = (token: string) => new NextRequest('https://app.test/api/v1/me', { headers: { authorization: `Bearer ${token}` } })

describe('validateApiKey identity metadata', () => {
  it('tags API keys with authKind api_key and the key expiry', async () => {
    tables.api_keys = [{
      id: 'key-1', tenant_id: 'tenant-1', key_hash: keyHash, key_prefix: API_KEY.slice(0, 8), key_type: 'tenant',
      permissions: ['workflows.view'], scopes: {}, expires_at: '2099-01-01T00:00:00.000Z', created_by: 'u-1', user_id: null,
    }]
    const result = await validateApiKey(request(API_KEY))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.authKind).toBe('api_key')
    expect(result.expiresAt).toBe('2099-01-01T00:00:00.000Z')
    expect(result.oauthScopes).toBeUndefined()
  })

  it('tags OAuth access tokens with authKind oauth, granted scopes and expiry', async () => {
    tables.oauth_tokens = {
      id: 'tok-1', tenant_id: 'tenant-1', token_type: 'access', client_id: 'client-1', user_id: null, grant_type: 'client_credentials',
      scopes: ['workflows:read'], refresh_parent: null, expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null,
    }
    tables.oauth_clients = { id: 'c-1', revoked_at: null, created_by: null }
    const result = await validateApiKey(request('uoa_test_access_token'))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.authKind).toBe('oauth')
    expect(result.oauthScopes).toEqual(['workflows:read'])
    expect(result.expiresAt).toBe('2099-01-01T00:00:00.000Z')
  })

  it('still rejects expired OAuth tokens', async () => {
    tables.oauth_tokens = {
      id: 'tok-1', tenant_id: 'tenant-1', token_type: 'access', client_id: 'client-1', user_id: null, grant_type: 'client_credentials',
      scopes: ['workflows:read'], refresh_parent: null, expires_at: '2000-01-01T00:00:00.000Z', revoked_at: null,
    }
    const result = await validateApiKey(request('uoa_test_access_token'))
    expect(result.success).toBe(false)
  })
})
