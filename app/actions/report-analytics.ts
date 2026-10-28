'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as analytics from '@/lib/services/report-analytics'

/* Workflow report aggregates (lib/services/report-analytics), reports.view. */

export async function getRunDailyStats(input: { since: string; workflowIds?: string[] | null }): Promise<ActionResult<analytics.RunDailyStat[]>> {
  return runAction('getRunDailyStats', 'Could not load run statistics.', async () => analytics.runDailyStats(await fromSession(), input))
}

export async function getRunDurationStats(input: { since: string; workflowIds?: string[] | null }): Promise<ActionResult<analytics.RunDurationStat[]>> {
  return runAction('getRunDurationStats', 'Could not load run statistics.', async () => analytics.runDurationStats(await fromSession(), input))
}

export async function getRunSummaries(input: { workflowIds: string[]; since?: string | null; limit?: number }): Promise<ActionResult<Array<Record<string, unknown>>>> {
  return runAction('getRunSummaries', 'Could not load runs.', async () => analytics.runSummaries(await fromSession(), input))
}

export async function getNodeVisitStats(input: { workflowIds: string[]; since?: string | null; limit?: number }): Promise<ActionResult<analytics.NodeVisitStat[]>> {
  return runAction('getNodeVisitStats', 'Could not load node statistics.', async () => analytics.nodeVisitStats(await fromSession(), input))
}
