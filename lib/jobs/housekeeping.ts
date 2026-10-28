import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { getProviderConfig } from '@/lib/config'
import { rpcHousekeeping, type HousekeepingRunResult } from '@/lib/admin/housekeeping'

/**
 * Instance housekeeping from the job registry (`housekeeping`, every 15
 * minutes; `housekeeping-daily`, 03:30 UTC) for the worker and external
 * schedulers. The pass is app_cron.run_housekeeping() in the database
 * (migration 20261109500000): it reads the `housekeeping.*` settings and
 * skips itself until the configured interval is due, so this only asks.
 *
 * With pg_cron the database runs the same function on its own schedule
 * (usertasks-housekeeping / usertasks-cron-housekeeping), so the registry
 * jobs skip unless `force` (the manual endpoint).
 */
export async function runHousekeepingJob(options: {
  supabase?: SupabaseClient
  daily?: boolean
  force?: boolean
  budgetMs?: number
} = {}): Promise<HousekeepingRunResult | { skipped: string }> {
  if (!options.force && (await getProviderConfig('scheduler')).id === 'pg_cron') {
    return { skipped: 'pg_cron runs housekeeping in the database (usertasks-housekeeping)' }
  }
  const supabase = options.supabase ?? createServiceClient()
  return rpcHousekeeping(supabase).run({
    trigger: options.daily ? 'tick-daily' : 'tick',
    force: options.daily === true || options.force === true,
    budgetMs: Math.min(options.budgetMs ?? 20_000, options.daily ? 45_000 : 25_000),
  })
}
