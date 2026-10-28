import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import {
  EVENT_STREAM_PURGE_BATCH,
  EVENT_STREAM_PURGE_MAX_BATCHES,
  eventStreamRetentionHours,
} from '@/lib/log-export/retention'

/**
 * Cleanup expired observability logs based on per-tenant retention policy.
 * Call via cron (daily) or manually.
 *
 * Respects `tenants.log_retention_days` (default 365). Cleans:
 *   - workflow_logs (by created_at)
 *   - integration_call_logs (by started_at — the table has no created_at)
 *
 * Purges the event_stream export outbox past
 * `tenants.settings.event_stream_retention_hours` (default 72h, max 168h) in
 * id-bounded batches via purge_event_stream() so no single delete holds
 * long locks.
 *
 * Also purges agent execution history (agent_runs older than
 * `tenants.agent_run_retention_days`, default 90) and finished queue rows —
 * workflow_queue completed/dead, agent_queue completed/failed/dead — older
 * than QUEUE_RETENTION_DAYS (default 7), in batches via purge_queue_history().
 *
 * Also deletes form submissions older than their form's
 * `submission_retention_days` (forms without one keep them).
 *
 * Also cancels designer test runs left waiting for more than 24 hours
 * (lib/workflow-test-runs.ts — never a production run) and their open tasks.
 *
 * Does NOT delete workflow_runs or object_audit_log —
 * those are retained indefinitely as audit records. Operators can manually
 * archive if needed.
 */

// Finished queue rows are transient scheduling state — keep a short window
// for debugging then purge regardless of tenant log retention.
function queueRetentionDays(): number {
  const value = Number(process.env.QUEUE_RETENTION_DAYS)
  return Number.isFinite(value) && value > 0 ? value : 7
}
const QUEUE_PURGE_BATCH = 5000
const QUEUE_PURGE_MAX_BATCHES = 200

export async function cleanupExpiredLogs(options: { supabase?: SupabaseClient } = {}) {
  const supabase = options.supabase ?? createServiceClient()

  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, log_retention_days, agent_run_retention_days, settings')

  // Timestamp column each log table is aged by.
  const tables = [
    ['workflow_logs', 'created_at'],
    ['integration_call_logs', 'started_at'],
  ] as const
  const totals: Record<string, number> = {}
  for (const [t] of tables) totals[t] = 0
  totals['agent_runs'] = 0
  totals['agent_queue'] = 0
  totals['workflow_queue'] = 0
  totals['event_stream'] = 0

  const daysAgoIso = (days: number) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return cutoff.toISOString()
  }

  const purge = async (table: string, tenantId: string, cutoffIso: string, column = 'created_at') => {
    try {
      const { count, error: countError } = await (supabase as any)
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .lt(column, cutoffIso)
      if (countError) throw countError

      if ((count ?? 0) > 0) {
        const { error } = await (supabase as any).from(table)
          .delete()
          .eq('tenant_id', tenantId)
          .lt(column, cutoffIso)
        if (error) throw error
        totals[table] += count ?? 0
      }
    } catch (err) {
      console.warn(`[cleanup-logs] ${table} failed for tenant ${tenantId}:`, err)
    }
  }

  const purgeEventStream = async (tenantId: string, settings: unknown) => {
    const cutoffIso = new Date(Date.now() - eventStreamRetentionHours(settings) * 3600_000).toISOString()
    try {
      for (let i = 0; i < EVENT_STREAM_PURGE_MAX_BATCHES; i++) {
        const { data, error } = await supabase.rpc('purge_event_stream', {
          p_tenant_id: tenantId,
          p_before: cutoffIso,
          p_batch_size: EVENT_STREAM_PURGE_BATCH,
        })
        if (error) throw error
        const deleted = Number(data ?? 0)
        totals['event_stream'] += deleted
        if (deleted < EVENT_STREAM_PURGE_BATCH) break
      }
    } catch (err) {
      console.warn(`[cleanup-logs] event_stream failed for tenant ${tenantId}:`, err)
    }
  }

  for (const tenant of tenants ?? []) {
    const retentionDays = (tenant as any).log_retention_days ?? 365
    const cutoffIso = daysAgoIso(retentionDays)

    for (const [table, column] of tables) {
      await purge(table, tenant.id, cutoffIso, column)
    }

    // agent_runs — per-tenant retention (default 90 when null).
    const agentRunRetentionDays = (tenant as any).agent_run_retention_days ?? 90
    await purge('agent_runs', tenant.id, daysAgoIso(agentRunRetentionDays))

    await purgeEventStream(tenant.id, tenant.settings)
  }

  // Finished workflow_queue / agent_queue rows, all tenants, in batches.
  try {
    const before = new Date(Date.now() - queueRetentionDays() * 86_400_000).toISOString()
    for (let i = 0; i < QUEUE_PURGE_MAX_BATCHES; i++) {
      const { data, error } = await supabase.rpc('purge_queue_history', {
        p_before: before,
        p_batch_size: QUEUE_PURGE_BATCH,
      })
      if (error?.code === 'PGRST202') {
        // purge_queue_history not migrated yet: one unbatched delete per table.
        for (const [table, statuses] of [
          ['workflow_queue', ['completed', 'dead']],
          ['agent_queue', ['completed', 'failed', 'dead']],
        ] as const) {
          const { count } = await (supabase as any).from(table)
            .delete({ count: 'exact' }).in('status', statuses).lt('created_at', before)
          totals[table] += count ?? 0
        }
        break
      }
      if (error) throw error
      const purged = (data ?? {}) as { workflow_queue?: number; agent_queue?: number }
      const workflowRows = Number(purged.workflow_queue ?? 0)
      const agentRows = Number(purged.agent_queue ?? 0)
      totals['workflow_queue'] += workflowRows
      totals['agent_queue'] += agentRows
      if (workflowRows < QUEUE_PURGE_BATCH && agentRows < QUEUE_PURGE_BATCH) break
    }
  } catch (err) {
    console.warn('[cleanup-logs] queue purge failed:', err)
  }

  // Form submissions past their form's submission_retention_days (forms
  // without one keep theirs). Missing table (migration 20261116000000 not
  // applied yet) → skipped.
  totals['form_submissions'] = 0
  try {
    const { data: forms, error } = await (supabase as any).from('forms')
      .select('id, tenant_id, submission_retention_days').not('submission_retention_days', 'is', null)
    if (error) throw error
    for (const form of (forms ?? []) as Array<{ id: string; tenant_id: string; submission_retention_days: number }>) {
      const { count, error: deleteError } = await (supabase as any).from('form_submissions')
        .delete({ count: 'exact' }).eq('tenant_id', form.tenant_id).eq('form_id', form.id)
        .lt('created_at', daysAgoIso(form.submission_retention_days))
      if (deleteError) throw deleteError
      totals['form_submissions'] += count ?? 0
    }
  } catch (err) {
    console.warn('[cleanup-logs] form submissions purge failed:', err)
  }

  // Designer test runs paused (Save & Test at a User Task) for more than
  // STALE_TEST_RUN_HOURS: the Test runner was closed without cleaning up.
  totals['stale_test_runs'] = 0
  totals['stale_test_run_tasks'] = 0
  try {
    const { cancelStaleTestRuns } = await import('@/lib/workflow-test-runs')
    const stale = await cancelStaleTestRuns(supabase, new Date())
    totals['stale_test_runs'] += stale.runs.length
    totals['stale_test_run_tasks'] += stale.tasks.length
  } catch (err) {
    console.warn('[cleanup-logs] stale test run cleanup failed:', err)
  }

  // OAuth hygiene (tenant-agnostic; the rotation design guarantees dead rows):
  //   - expired authorization codes past a 1-day forensic window
  //   - access/refresh tokens 30 days past expiry or revocation (keeps the
  //     refresh-reuse-detection chain alive for the 30-day refresh TTL)
  //   - consumed/expired connect-state rows
  totals['oauth_authorization_codes'] = 0
  totals['oauth_tokens'] = 0
  totals['oauth_connect_states'] = 0
  try {
    const codeCut = daysAgoIso(1)
    const { count: c1 } = await (supabase as any)
      .from('oauth_authorization_codes').select('*', { count: 'exact', head: true }).lt('expires_at', codeCut)
    if ((c1 ?? 0) > 0) { await (supabase as any).from('oauth_authorization_codes').delete().lt('expires_at', codeCut); totals['oauth_authorization_codes'] += c1 ?? 0 }

    const tokCut = daysAgoIso(30)
    const { count: c2 } = await (supabase as any)
      .from('oauth_tokens').select('*', { count: 'exact', head: true }).or(`expires_at.lt.${tokCut},revoked_at.lt.${tokCut}`)
    if ((c2 ?? 0) > 0) { await (supabase as any).from('oauth_tokens').delete().or(`expires_at.lt.${tokCut},revoked_at.lt.${tokCut}`); totals['oauth_tokens'] += c2 ?? 0 }

    const stateCut = daysAgoIso(1)
    const { count: c3 } = await (supabase as any)
      .from('oauth_connect_states').select('*', { count: 'exact', head: true }).lt('expires_at', stateCut)
    if ((c3 ?? 0) > 0) { await (supabase as any).from('oauth_connect_states').delete().lt('expires_at', stateCut); totals['oauth_connect_states'] += c3 ?? 0 }
  } catch (err) {
    console.warn('[cleanup-logs] oauth purge failed:', err)
  }

  return {
    cleaned: totals,
    total: Object.values(totals).reduce((s, c) => s + c, 0),
  }
}
