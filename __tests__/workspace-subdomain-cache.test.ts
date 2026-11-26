import { afterEach, describe, expect, it } from 'vitest'
import { addressDeps, clearResolvedSubdomains, resolveSubdomain, resolvedSubdomainCacheSize, RESOLVED_CACHE_MAX } from '@/lib/services/workspace-address'
import { createMemorySupabase } from './fixtures/supabase-memory'

// The subdomain label comes from the Host header: with wildcard DNS, random
// labels each cached an `unknown` entry forever (Map never evicted).
describe('resolveSubdomain cache', () => {
  const original = addressDeps.serviceClient
  afterEach(() => { addressDeps.serviceClient = original; clearResolvedSubdomains() })

  it('stays bounded under a flood of random subdomains and still resolves real ones', async () => {
    const db = createMemorySupabase({ tenants: [{ id: 't1', name: 'Acme', slug: 'acme', subdomain: 'acme', deleted_at: null }], tenant_subdomain_history: [] })
    addressDeps.serviceClient = async () => db as never
    for (let i = 0; i < RESOLVED_CACHE_MAX + 500; i++) await resolveSubdomain(`rnd${i}x`)
    expect(resolvedSubdomainCacheSize()).toBeLessThanOrEqual(RESOLVED_CACHE_MAX)
    expect(await resolveSubdomain('acme')).toMatchObject({ kind: 'workspace', tenant: { id: 't1' } })
  })
})
