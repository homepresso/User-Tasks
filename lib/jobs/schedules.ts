import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { kickQueueProcessor } from '@/lib/process-queue'
import { normalizeScheduleConfig, getDueOccurrence, describeSchedule } from '@/lib/workflow-schedule'

/**
 * Cron sweep for schedule-triggered workflows.
 *
 * Scans active workflows with trigger_type = 'schedule', reads the schedule
 * from the trigger node's config (published version when one exists, matching
 * how the other trigger enqueuers resolve nodes), and enqueues each workflow
 * whose most recent occurrence hasn't fired yet. schedule_last_fired_at makes
 * this exactly-once per occurrence no matter how often the sweep runs — so the
 * schedule granularity users actually get equals this cron's frequency.
 */

async function resolveNodes(supabase: any, workflow: { nodes?: unknown; published_version_id?: string | null }): Promise<unknown[]> {
  if (!workflow.published_version_id) {
    return Array.isArray(workflow.nodes) ? (workflow.nodes as unknown[]) : []
  }
  const { data: version } = await supabase
    .from('workflow_versions')
    .select('nodes')
    .eq('id', workflow.published_version_id)
    .maybeSingle()
  const versionNodes = (version as { nodes?: unknown } | null)?.nodes
  if (Array.isArray(versionNodes)) return versionNodes
  return Array.isArray(workflow.nodes) ? (workflow.nodes as unknown[]) : []
}

/** One schedule sweep. Throws when the workflow list cannot be read. */
export async function processScheduledWorkflows(options: { supabase?: SupabaseClient; now?: Date } = {}) {
  const supabase = options.supabase ?? createServiceClient()
  const now = options.now ?? new Date()

  const { data: workflows, error } = await (supabase as any)
    .from('workflows')
    .select('id, tenant_id, name, nodes, published_version_id, schedule_last_fired_at')
    .eq('trigger_type', 'schedule')
    .eq('is_active', true)

  if (error) throw new Error(error.message)

  let fired = 0
  let skipped = 0
  const results: Array<{ workflow_id: string; name: string; schedule: string; fired_for?: string }> = []

  for (const workflow of workflows ?? []) {
    try {
      const nodes = await resolveNodes(supabase, workflow)
      const triggerNode = nodes.find((node: any) => node && typeof node === 'object' && node.type === 'schedule') as { config?: unknown } | undefined
      const config = normalizeScheduleConfig(triggerNode?.config)
      if (!config) { skipped++; continue }

      const due = getDueOccurrence(config, now, workflow.schedule_last_fired_at)
      if (!due) { skipped++; continue }

      // Claim the occurrence BEFORE enqueueing so two overlapping sweeps can't
      // both fire it: the compare-and-set update succeeds for exactly one.
      let claim = (supabase as any)
        .from('workflows')
        .update({ schedule_last_fired_at: due.toISOString() })
        .eq('id', workflow.id)
      claim = workflow.schedule_last_fired_at
        ? claim.eq('schedule_last_fired_at', workflow.schedule_last_fired_at)
        : claim.is('schedule_last_fired_at', null)
      const { data: claimed } = await claim.select('id')
      if (!claimed?.length) { skipped++; continue }

      await (supabase as any).rpc('enqueue_workflow', {
        p_workflow_id: workflow.id,
        p_tenant_id: workflow.tenant_id,
        p_task_id: null,
        p_trigger_type: 'schedule',
        p_trigger_data: {
          _version_id: workflow.published_version_id ?? null,
          schedule_occurrence: due.toISOString(),
          schedule_description: describeSchedule(config),
        },
        p_priority: 0,
        p_delay_seconds: 0,
      })
      fired++
      results.push({ workflow_id: workflow.id, name: workflow.name, schedule: describeSchedule(config), fired_for: due.toISOString() })
    } catch (err: any) {
      console.error(`[process-schedules] workflow ${workflow.id} failed:`, err?.message)
      skipped++
    }
  }

  if (fired > 0) kickQueueProcessor()

  return { ok: true as const, checked: (workflows ?? []).length, fired, skipped, results }
}
