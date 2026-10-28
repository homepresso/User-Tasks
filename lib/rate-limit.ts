import { createHash } from 'node:crypto'
import { memoryHit } from '@/lib/providers/cache/memory'
import type { RateLimitResult } from '@/lib/providers/cache/types'

/**
 * Fixed-window rate limiter.
 *
 * `rateLimit()` (async) counts in the configured cache store
 * (lib/providers/cache): with the default `memory` store the window is
 * per server instance, as it always was (on serverless the effective limit
 * is the configured limit × instance count); with `postgres` or `redis`
 * every replica, the worker and the admin CLI share one window per key.
 * If the shared store fails the hit is counted in-process instead (and a
 * warning logged), so an outage degrades to per-instance limits rather than
 * no limits.
 *
 * `checkRateLimit()` (sync) is the in-process window alone, kept for callers
 * that can't await.
 */

export type { RateLimitResult }

/**
 * Record a hit against `key` in this process. Returns ok:false once `max`
 * hits occur within `windowMs`.
 */
export function checkRateLimit(key: string, opts: { max: number; windowMs: number }): RateLimitResult {
  return memoryHit(key, opts)
}

let lastWarning = 0
function warn(message: string) {
  // At most one line a minute: a store outage would otherwise log per request.
  if (Date.now() - lastWarning < 60_000) return
  lastWarning = Date.now()
  console.warn(`[rate-limit] ${message}; counting in-process until it recovers`)
}

/** Shared keys stay short (IPs, client ids and user agents can be long). */
function sharedKey(key: string): string {
  return key.length > 200 ? `rl:h:${createHash('sha256').update(key).digest('hex')}` : `rl:${key}`
}

/** Record a hit against `key` in the configured cache store (see above). */
export async function rateLimit(key: string, opts: { max: number; windowMs: number }): Promise<RateLimitResult> {
  let store
  try {
    store = await (await import('@/lib/providers/cache')).getCacheStore()
  } catch (error) {
    warn(`cache store unavailable: ${(error as Error).message}`)
    return memoryHit(key, opts)
  }
  if (!store.shared) return memoryHit(key, opts)
  try {
    return await store.hit(sharedKey(key), opts)
  } catch (error) {
    warn((error as Error).message)
    return memoryHit(key, opts)
  }
}

type AgentLimitOptions = { perActorMax?: number; perTenantMax?: number; windowMs?: number }
type Throttled = { message: string; retryAfterMs: number } | null

const ACTOR_MESSAGE = 'Too many agent executions — please slow down and try again shortly.'
const TENANT_MESSAGE = 'This workspace has hit its agent execution rate limit — please try again shortly.'

/**
 * Enforce both a per-actor and a per-tenant ceiling for agent executions
 * (this process only). Returns null when allowed, or a { message,
 * retryAfterMs } when throttled. Defaults: 20/min per actor, 60/min per tenant.
 */
export function checkAgentExecutionRateLimit(tenantId: string, actorKey: string, opts?: AgentLimitOptions): Throttled {
  const windowMs = opts?.windowMs ?? 60_000
  const actor = checkRateLimit(`agent-exec:actor:${tenantId}:${actorKey}`, { max: opts?.perActorMax ?? 20, windowMs })
  if (!actor.ok) return { message: ACTOR_MESSAGE, retryAfterMs: actor.retryAfterMs }
  const tenant = checkRateLimit(`agent-exec:tenant:${tenantId}`, { max: opts?.perTenantMax ?? 60, windowMs })
  if (!tenant.ok) return { message: TENANT_MESSAGE, retryAfterMs: tenant.retryAfterMs }
  return null
}

/** checkAgentExecutionRateLimit in the configured cache store (shared across replicas). */
export async function agentExecutionRateLimit(tenantId: string, actorKey: string, opts?: AgentLimitOptions): Promise<Throttled> {
  const windowMs = opts?.windowMs ?? 60_000
  const actor = await rateLimit(`agent-exec:actor:${tenantId}:${actorKey}`, { max: opts?.perActorMax ?? 20, windowMs })
  if (!actor.ok) return { message: ACTOR_MESSAGE, retryAfterMs: actor.retryAfterMs }
  const tenant = await rateLimit(`agent-exec:tenant:${tenantId}`, { max: opts?.perTenantMax ?? 60, windowMs })
  if (!tenant.ok) return { message: TENANT_MESSAGE, retryAfterMs: tenant.retryAfterMs }
  return null
}
