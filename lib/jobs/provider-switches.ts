import type { SupabaseClient } from '@supabase/supabase-js'
import { databaseUrl } from '@/lib/config/bootstrap'

/**
 * Background provider switches, every minute from the job registry (and
 * /api/cron/provider-switches): when a switch queued from Settings →
 * Infrastructure is waiting or was interrupted, the Infrastructure add-on
 * runs or continues it (lib/extensions/sdk InfrastructureProvider.runQueued).
 * Without the add-on, or without its licence, nothing runs: a queued switch
 * stays queued (the running providers are untouched — a switch only writes
 * the new provider at its end) until the add-on is licensed again.
 */

export function providerSwitchesEnabled(): boolean {
  return Boolean(databaseUrl())
}

/** Cheap check over the service client: is there background work? */
export async function hasProviderSwitchWork(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase
    .from('instance_provider_switches')
    .select('id')
    .eq('kind', 'switch')
    .in('status', ['queued', 'running'])
    .not('job', 'is', null)
    .limit(1)
  return !error && (data ?? []).length > 0
}

export async function runProviderSwitchesJob(options: { supabase?: SupabaseClient; deadline?: number } = {}): Promise<Record<string, unknown>> {
  if (!providerSwitchesEnabled()) return { skipped: 'no DATABASE_URL' }
  if (options.supabase && !(await hasProviderSwitchWork(options.supabase))) return { skipped: 'nothing queued' }
  const { infrastructureAddon } = await import('@/lib/infrastructure/provider')
  const addon = await infrastructureAddon()
  if (addon.state !== 'ready') return { skipped: addon.state === 'missing' ? 'the Infrastructure add-on is not installed' : 'the Infrastructure add-on is not licensed' }
  if (!addon.resolved.provider.runQueued) return { skipped: 'the add-on has no background runner' }
  return addon.resolved.provider.runQueued({ ctx: addon.resolved.ctx, deadline: options.deadline })
}
