import { describe, it, expect } from 'vitest'
import { checkRateLimit, checkAgentExecutionRateLimit } from '@/lib/rate-limit'

describe('checkRateLimit', () => {
  it('allows up to max within the window, then blocks', () => {
    const key = `t-${Math.random()}`
    const opts = { max: 3, windowMs: 60_000 }
    expect(checkRateLimit(key, opts).ok).toBe(true)
    expect(checkRateLimit(key, opts).ok).toBe(true)
    expect(checkRateLimit(key, opts).ok).toBe(true)
    const blocked = checkRateLimit(key, opts)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterMs).toBeGreaterThan(0)
  })
})

describe('checkAgentExecutionRateLimit', () => {
  it('returns null while under the per-actor ceiling', () => {
    const tenant = `tenant-${Math.random()}`
    expect(checkAgentExecutionRateLimit(tenant, 'user-1', { perActorMax: 2, perTenantMax: 100 })).toBeNull()
    expect(checkAgentExecutionRateLimit(tenant, 'user-1', { perActorMax: 2, perTenantMax: 100 })).toBeNull()
  })

  it('throttles the actor after the per-actor ceiling', () => {
    const tenant = `tenant-${Math.random()}`
    checkAgentExecutionRateLimit(tenant, 'user-2', { perActorMax: 1, perTenantMax: 100 })
    const throttled = checkAgentExecutionRateLimit(tenant, 'user-2', { perActorMax: 1, perTenantMax: 100 })
    expect(throttled).not.toBeNull()
    expect(throttled!.message).toMatch(/slow down|rate limit/i)
  })

  it('throttles the whole tenant after the per-tenant ceiling even across actors', () => {
    const tenant = `tenant-${Math.random()}`
    // Two different actors, per-tenant ceiling of 2 → third (any actor) is blocked.
    expect(checkAgentExecutionRateLimit(tenant, 'a', { perActorMax: 100, perTenantMax: 2 })).toBeNull()
    expect(checkAgentExecutionRateLimit(tenant, 'b', { perActorMax: 100, perTenantMax: 2 })).toBeNull()
    const throttled = checkAgentExecutionRateLimit(tenant, 'c', { perActorMax: 100, perTenantMax: 2 })
    expect(throttled).not.toBeNull()
    expect(throttled!.message).toMatch(/workspace/i)
  })
})
