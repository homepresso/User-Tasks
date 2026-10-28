import { describe, it, expect } from 'vitest'
import { applyAuthHeaders } from '@/lib/integrations/attach-auth'

describe('imported-spec auth (401 "malformed Authorization" fix)', () => {
  it('api_key aimed at the Authorization header gets a Bearer prefix', async () => {
    const headers: Record<string, string> = {}
    await applyAuthHeaders(
      { auth_type: 'api_key', auth_config: { key_name: 'Authorization', key_value: 'hh_live_abc123' } } as any,
      headers, {} as any,
    )
    expect(headers.Authorization).toBe('Bearer hh_live_abc123')
  })

  it('values that already carry a scheme are left untouched', async () => {
    const headers: Record<string, string> = {}
    await applyAuthHeaders(
      { auth_type: 'api_key', auth_config: { key_name: 'Authorization', key_value: 'Basic dXNlcjpwdw==' } } as any,
      headers, {} as any,
    )
    expect(headers.Authorization).toBe('Basic dXNlcjpwdw==')
  })

  it('real API keys in custom headers stay raw', async () => {
    const headers: Record<string, string> = {}
    await applyAuthHeaders(
      { auth_type: 'api_key', auth_config: { key_name: 'X-API-Key', key_value: 'hh_live_abc123' } } as any,
      headers, {} as any,
    )
    expect(headers['X-API-Key']).toBe('hh_live_abc123')
  })
})
