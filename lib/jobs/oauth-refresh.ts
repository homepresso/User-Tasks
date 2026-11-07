import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'

/**
 * Proactively refresh connector OAuth tokens that are near expiry, so
 * long-idle connectors don't fail their first call after a quiet period and
 * refresh errors surface early. The executor also refreshes lazily on demand;
 * this cron is a warm-keeper. Runs every 10 minutes from the scheduler tick.
 */
export async function refreshExpiringConnectorTokens(options: { supabase?: SupabaseClient } = {}) {
  const supabase = options.supabase ?? createServiceClient()

  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  // OAuth connectors store expiry in config.expires_at; find those due soon.
  const { data: connectors } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, config')
    .eq('is_enabled', true)
    .not('config->>expires_at', 'is', null)
    .lt('config->>expires_at', soon)
    .limit(100)

  let refreshed = 0
  let failed = 0
  // getFreshConnectorToken (lib/oauth/client-token) performs the refresh +
  // persist; ask for 10 minutes of validity so tokens due soon really refresh.
  let getFreshConnectorToken: ((args: { supabase: any; connectorId: string; tenantId?: string | null; minValidityMs?: number }) => Promise<string>) | null = null
  try {
    ;({ getFreshConnectorToken } = await import('@/lib/oauth/client-token'))
  } catch {
    // client-token module not present yet — nothing to do.
    return { ok: true as const, refreshed: 0, failed: 0, skipped: 'no oauth client module' }
  }

  for (const connector of (connectors ?? []) as any[]) {
    try {
      await getFreshConnectorToken!({ supabase, connectorId: String(connector.id), tenantId: null, minValidityMs: 10 * 60 * 1000 })
      refreshed++
    } catch {
      failed++
    }
  }

  return { ok: true as const, refreshed, failed }
}
