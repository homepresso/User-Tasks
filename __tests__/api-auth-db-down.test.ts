/**
 * Database unreachable while validating an API key: 503 + Retry-After, never
 * "Invalid API key" (401), which made clients treat a working key as revoked
 * during an outage (found stopping Postgres under a standalone install).
 */
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        insert: () => builder,
        update: () => builder,
        maybeSingle: async () => ({ data: null, error: { message: 'connect ECONNREFUSED' } }),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'connect ECONNREFUSED' } }).then(resolve, reject),
      }
      return builder
    },
  }),
}))

import { validateApiKey } from '@/lib/api-auth'
import { resetCredentialCacheForTests } from '@/lib/api-auth-cache'

describe('validateApiKey with the database down', () => {
  it('answers 503 Service temporarily unavailable with Retry-After', async () => {
    resetCredentialCacheForTests()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await validateApiKey(new NextRequest('https://app.test/api/v1/me', { headers: { authorization: 'Bearer utk_test_0123456789abcdef' } }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.response.status).toBe(503)
    expect(result.response.headers.get('Retry-After')).toBe('5')
    expect(await result.response.json()).toEqual({ success: false, error: 'Service temporarily unavailable' })
  })
})
