import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { unwrapAction } from '@/lib/action-result'
import { getRunDurationStats } from '@/app/actions/report-analytics'

/**
 * Data for the workflow reports hub (/reports and /reports/workflows).
 *
 * Run aggregates come from SQL (workflow_run_daily_stats /
 * workflow_run_duration_stats, see
 * supabase/migrations/20261028000000_perf_api_reports.sql) instead of
 * downloading up to 10k runs with their traces and aggregating here.
 */

/** How far back the hub can look (its largest range option). */
export const HUB_MAX_RANGE_DAYS = 180

export type { RunDailyStat, RunDurationStat } from '@/lib/services/report-analytics'

/** Start (UTC midnight) of the window of the last `days` whole days, today included. */
export function sinceDays(days: number): string {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  since.setUTCDate(since.getUTCDate() - (days - 1))
  return since.toISOString()
}

export function useWorkflowHub() {
  return useQuery({
    queryKey: ['reports', 'workflows', 'hub'],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    // Workflows, live queue and the per-day run aggregates (whole UTC days,
    // so every range bucket is complete) — one server read.
    queryFn: () => serverQuery('reports.workflowHub', { since: sinceDays(HUB_MAX_RANGE_DAYS) }),
  })
}

/** Status counts and avg/p50/p95 completed durations over the last `days`. */
export function useRunDurationStats(days: number, workflowIds?: string[]) {
  return useQuery({
    queryKey: ['reports', 'workflows', 'durations', days, workflowIds ?? null],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      return unwrapAction(await getRunDurationStats({ since: sinceDays(days), workflowIds: workflowIds ?? null }))
    },
  })
}
