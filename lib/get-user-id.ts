import { getMyCurrentTenantId } from '@/app/actions/session'

let cachedUserId: string | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get the current user ID with caching.
 * Avoids a server round trip on every React Query refetch. The session
 * cookies are httpOnly, so the id comes from GET /api/auth/session.
 */
export async function getUserId(): Promise<string | null> {
  const now = Date.now()
  if (cachedUserId && now - cacheTimestamp < CACHE_TTL) {
    return cachedUserId
  }

  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    cachedUserId = res.ok ? (((await res.json()) as { userId?: string }).userId ?? null) : null
  } catch {
    cachedUserId = null
  }
  cacheTimestamp = now
  return cachedUserId
}

let cachedTenantId: string | null | undefined
let tenantCacheTimestamp = 0
const TENANT_CACHE_TTL = 30 * 1000 // short — workspace switches must not serve stale tenant

/**
 * Current workspace (tenant) id for the signed-in user. null = unified
 * "All organizations" view. Cached briefly; call clearCurrentTenantCache()
 * after switching workspaces.
 */
export async function getCurrentTenantId(): Promise<string | null> {
  const now = Date.now()
  if (cachedTenantId !== undefined && now - tenantCacheTimestamp < TENANT_CACHE_TTL) {
    return cachedTenantId
  }
  const userId = await getUserId()
  if (!userId) return null
  // A failed lookup reads as the unified view, as the browser query did.
  const result = await getMyCurrentTenantId().catch(() => null)
  cachedTenantId = result?.ok ? result.data : null
  tenantCacheTimestamp = now
  return cachedTenantId ?? null
}

export function clearCurrentTenantCache() {
  cachedTenantId = undefined
  tenantCacheTimestamp = 0
}
