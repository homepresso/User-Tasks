import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { bumpRollupGeneration } from '@/lib/report-rollups/cache'

/**
 * Report rollups maintenance (migration 20270123100000; the rollups
 * themselves are kept current by delta triggers in the same transaction as
 * each change). This job is the safety net and the history:
 *
 *  1. drain   rebuild day ranges queued in report_rollup_dirty (admin
 *             requests, deferred trigger work during bulk loads)
 *  2. backfill  per tenant, from today backwards in chunks of days (exact
 *             rebuilds; resumable — the cursor lives in report_rollup_state).
 *             Until a tenant is covered far enough back, report reads use
 *             the live path.
 *  3. reconcile  each tenant hourly: rebuild today and yesterday (corrects
 *             any drift and compacts the day's shards into one row)
 *
 * Every SQL call is one short transaction for one tenant, so locks are held
 * briefly; the job stops starting calls at its deadline. Registered as the
 * `report-rollups` job of the scheduler tick (every minute; skipped when
 * there is nothing to do), endpoint /api/cron/report-rollups, and run by
 * `usertasks-admin rollups backfill`.
 */

export interface ReportRollupJobOptions {
  supabase?: SupabaseClient
  /** Epoch ms after which no new call starts. */
  deadline?: number
  /** Backfill chunk (days per call). */
  backfillDays?: number
  /** Minimum minutes between reconciles of a tenant. */
  reconcileMinutes?: number
  /** Only this tenant (CLI). */
  tenantId?: string | null
  /** Which phases to run (default all). */
  phases?: ReadonlyArray<'drain' | 'backfill' | 'reconcile'>
}

export interface ReportRollupJobResult {
  skipped?: string
  drained: number
  backfilled: number
  reconciled: number
  days: number
  tenants_done: string[]
  errors: string[]
}

const MISSING = new Set(['PGRST202', '42883', '42P01'])

type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string; code?: string } | null }> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Cheap pre-check for the tick: anything queued, unfinished or due? false when the migration is missing. */
export async function reportRollupsPending(supabase: SupabaseClient, reconcileMinutes = 60): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('report_rollup_pending', { p_min_age_minutes: reconcileMinutes })
    if (error) return !MISSING.has(String((error as { code?: string }).code ?? '')) // migration not applied: nothing to do
    return Boolean(data?.dirty || data?.backfill || data?.reconcile)
  } catch {
    return true // unknown counts as enabled, like the tick probe
  }
}

export async function runReportRollupsJob(options: ReportRollupJobOptions = {}): Promise<ReportRollupJobResult> {
  const supabase = options.supabase ?? createServiceClient()
  const rpc: Rpc = async (fn, args) => {
    const res = await supabase.rpc(fn, args)
    return { data: res.data, error: res.error as { message: string; code?: string } | null }
  }
  const deadline = options.deadline ?? Date.now() + 30_000
  const phases = new Set(options.phases ?? ['drain', 'backfill', 'reconcile'])
  const result: ReportRollupJobResult = { drained: 0, backfilled: 0, reconciled: 0, days: 0, tenants_done: [], errors: [] }
  const touched = new Set<string>()
  const timeLeft = () => Date.now() < deadline

  /** Run `fn` until it reports idle / an error, or time is up. */
  async function loop(phase: 'drain' | 'backfill' | 'reconcile', call: () => Promise<{ data: any; error: { message: string; code?: string } | null }>, onStep: (data: any) => boolean): Promise<boolean> { // eslint-disable-line @typescript-eslint/no-explicit-any
    while (timeLeft()) {
      const { data, error } = await call()
      if (error) {
        if (MISSING.has(String(error.code ?? ''))) { result.skipped = 'report rollups migration (20270123100000) not applied'; return false }
        result.errors.push(`${phase}: ${error.message}`)
        return true
      }
      if (!data || data.idle) return true
      if (data.tenant_id) touched.add(String(data.tenant_id))
      result.days += Number(data.rebuilt?.days ?? 0) || 0
      if (data.busy || !onStep(data)) return true
    }
    return true
  }

  if (phases.has('drain')) {
    const ok = await loop('drain', () => rpc('report_rollup_drain_next', { p_days: 31 }), (data) => {
      if (options.tenantId && data.tenant_id !== options.tenantId) return true
      result.drained++
      return true
    })
    if (!ok) return result
  }
  if (phases.has('backfill')) {
    const ok = await loop('backfill', () => rpc('report_rollup_backfill_next', { p_tenant_id: options.tenantId ?? null, p_days: options.backfillDays ?? 14 }), (data) => {
      result.backfilled++
      if (data.done) {
        result.tenants_done.push(String(data.tenant_id))
        // One tenant asked for: stop when it is done; otherwise move on to the next tenant.
        if (options.tenantId) return false
      }
      return true
    })
    if (!ok) return result
  }
  if (phases.has('reconcile')) {
    const ok = await loop('reconcile', () => rpc('report_rollup_reconcile_next', { p_min_age_minutes: options.reconcileMinutes ?? 60, p_tenant_id: options.tenantId ?? null }), () => {
      result.reconciled++
      // A named tenant is reconciled once per run.
      return !options.tenantId
    })
    if (!ok) return result
  }
  for (const tenantId of touched) await bumpRollupGeneration(tenantId)
  return result
}
