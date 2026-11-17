/**
 * Workflow runs parked because an extension's licence lapsed.
 *
 * When a running workflow reaches an extension step more than 24 hours after
 * the licence expired, the engine parks it (lib/workflow-engine.ts
 * parkLicenceBlockedRun): status `paused`, the step recorded as failed with
 * extension_licence_expired, `pause_variables._licence_blocked_node_id` set.
 * Nothing is lost. After a licence arrives, resuming re-runs that step and
 * continues — one run at a time here (ctx.licence.resumePausedRuns, used by
 * an extension's licence-lapse job), each one audited on the run. A run that
 * is still blocked (another extension still lapsed) parks again.
 */

import { writeAudit } from '@/lib/audit-log'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role client */

const BLOCKED = 'pause_variables->>_licence_blocked_node_id'

export async function countLicencePausedRuns(db: any, tenantId: string): Promise<number> {
  const { count, error } = await db.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'paused').not(BLOCKED, 'is', null)
  if (error) throw new Error(`workflow_runs: ${error.message}`)
  return Number(count ?? 0)
}

export interface ResumePausedDeps {
  resume: (runId: string) => Promise<{ status: string }>
}

const defaultDeps: ResumePausedDeps = {
  resume: async (runId) => {
    const { resumeWorkflow } = await import('@/lib/workflow-engine')
    return resumeWorkflow(runId, { outcome: 'resumed', outcome_notes: 'Resumed after the licence was renewed' })
  },
}

export async function resumeLicencePausedRuns(
  db: any,
  input: { tenantId: string; extensionId: string; limit?: number; deadline?: number },
  deps: ResumePausedDeps = defaultDeps,
): Promise<{ resumed: number; failed: number; remaining: number }> {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 200))
  const { data, error } = await db.from('workflow_runs').select('id, workflow_id').eq('tenant_id', input.tenantId).eq('status', 'paused').not(BLOCKED, 'is', null).order('paused_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`workflow_runs: ${error.message}`)
  let resumed = 0
  let failed = 0
  for (const run of (data ?? []) as Array<{ id: string; workflow_id: string }>) {
    if (input.deadline && Date.now() > input.deadline - 3000) break
    try {
      const result = await deps.resume(run.id)
      resumed++
      await writeAudit({
        supabase: db, tenantId: input.tenantId, actorId: null, objectType: 'workflow_run', objectId: run.id, action: 'resume',
        summary: `Resumed workflow run paused by a lapsed ${input.extensionId} licence (licence renewed)`,
        metadata: { workflow_id: run.workflow_id, extension: input.extensionId, status: result.status, reason: 'licence_renewed' },
      })
    } catch (err) {
      failed++
      console.warn(`[licensing] resuming licence-paused run ${run.id} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const remaining = await countLicencePausedRuns(db, input.tenantId).catch(() => 0)
  return { resumed, failed, remaining }
}
