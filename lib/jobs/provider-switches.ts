import type { SupabaseClient } from '@supabase/supabase-js'
import { databaseUrl } from '@/lib/config/bootstrap'
import { backgroundRuntime } from '@/lib/admin/switch-runtime'

/**
 * Background provider switches (Settings → Infrastructure) from the job
 * registry, every minute: when a switch is queued, or a background switch
 * was interrupted (its process died while it ran), it starts this
 * process's switch runner (long-running process: it keeps going after the
 * tick returns and resumes, skipping the steps already done) — or, on
 * serverless, runs one time-boxed chunk of the database switch within the
 * job's budget; the next tick continues it.
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

export async function runProviderSwitchesJob(options: { supabase?: SupabaseClient; deadline?: number } = {}): Promise<{ started: boolean } | { chunks: number } | { skipped: string }> {
  if (!providerSwitchesEnabled()) return { skipped: 'no DATABASE_URL' }
  if (options.supabase && !(await hasProviderSwitchWork(options.supabase))) return { skipped: 'nothing queued' }
  const runner = await import('@/lib/admin/switch/app-runner')
  if (backgroundRuntime().available) {
    runner.kickSwitchRunner()
    return { started: true }
  }
  // Serverless: one chunk of a chunked switch (the database copy), awaited within this job's budget.
  const deadline = Math.min(options.deadline ?? Date.now() + 40_000, Date.now() + runner.chunkBudgetMs()) - 3_000
  return { chunks: await runner.runSwitchChunk(deadline) }
}
