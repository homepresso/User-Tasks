import { getServiceDb } from '@/lib/providers/db'
import { enqueueDataTableEventWorkflows, invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'
import { appUrlOrLocalhost, processorSecret } from '@/lib/config/bootstrap'
import { getStorageProviderFor } from '@/lib/providers/storage'
import type { SupabaseStorageClient } from '@/lib/providers/storage/supabase'
import { isSafeStorageKey } from '@/lib/storage/buckets'

export type DeletionTargetType =
  | 'workflow'
  | 'report'
  | 'data_table'
  | 'integration'
  | 'decision_table'
  | 'agent'
  | 'workflow_activity'
  | 'retention_policy'
  | 'data_row'

type DeletionJob = {
  id: string
  tenant_id: string
  target_type: DeletionTargetType
  target_id: string
  payload: any
}

function createServiceClient() {
  return getServiceDb()
}

export function kickDeletionProcessor() {
  const baseUrl = appUrlOrLocalhost()
  fetch(`${baseUrl}/api/deletions/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(processorSecret()
        ? { 'X-Processor-Secret': processorSecret()! }
        : {}),
    },
    body: JSON.stringify({ batch_size: 5 }),
  }).catch(() => {
    // Best effort only. Scheduled processing can catch up.
  })
}

export async function enqueueDeletionJob(
  supabase: any,
  input: {
    tenantId: string
    createdBy?: string | null
    targetType: DeletionTargetType
    targetId: string
    payload?: Record<string, unknown>
  },
) {
  const { error } = await (supabase as any).from('deletion_queue').insert({
    tenant_id: input.tenantId,
    created_by: input.createdBy ?? null,
    target_type: input.targetType,
    target_id: input.targetId,
    payload: input.payload ?? {},
  })
  if (error) throw error
}

/**
 * Remove data-table file objects (task-files bucket) through the storage
 * provider. Like before, failures don't block the row delete; keys that
 * aren't valid object keys are skipped.
 */
async function removeTaskFiles(supabase: SupabaseStorageClient, paths: string[]) {
  const keys = paths.filter((p) => isSafeStorageKey(p))
  if (keys.length === 0) return
  try {
    const storage = await getStorageProviderFor(supabase)
    await storage.delete('task-files', keys)
  } catch (error) {
    console.warn('[deletion-queue] could not remove stored files:', (error as Error).message)
  }
}

async function hardDeleteCustomTable(supabase: any, tableId: string) {
  const { data: rows } = await (supabase as any).from('custom_table_rows').select('data').eq('table_id', tableId)
  const filePathsToDelete: string[] = []
  for (const row of rows ?? []) {
    if (row.data && typeof row.data === 'object') {
      for (const value of Object.values(row.data as Record<string, any>)) {
        if (value && typeof value === 'object' && value.path && value.url) {
          filePathsToDelete.push(value.path)
        }
      }
    }
  }
  await removeTaskFiles(supabase, filePathsToDelete)
  await (supabase as any).from('custom_table_rows').delete().eq('table_id', tableId)
  const { error } = await (supabase as any).from('custom_tables').delete().eq('id', tableId)
  if (error) throw error
}

async function hardDeleteDataRow(supabase: any, tenantId: string, rowId: string, payload?: any) {
  const rowData = payload?.row_data && typeof payload.row_data === 'object' ? payload.row_data as Record<string, any> : null
  const tableId = typeof payload?.table_id === 'string' ? payload.table_id : null

  const row = rowData && tableId
    ? { table_id: tableId, tenant_id: tenantId, data: rowData }
    : await (async () => {
      const { data } = await (supabase as any)
        .from('custom_table_rows')
        .select('table_id, tenant_id, data')
        .eq('id', rowId)
        .maybeSingle()
      return data
    })()

  if (!row) return

  const filePathsToDelete: string[] = []
  if (row.data && typeof row.data === 'object') {
    for (const value of Object.values(row.data as Record<string, any>)) {
      if (value && typeof value === 'object' && value.path && value.url) {
        filePathsToDelete.push(value.path)
      }
    }
  }

  await removeTaskFiles(supabase, filePathsToDelete)

  const { error } = await (supabase as any).from('custom_table_rows').delete().eq('id', rowId)
  if (error) throw error

  if (row.table_id && row.tenant_id) {
    await enqueueDataTableEventWorkflows({
      supabase,
      tenantId: row.tenant_id,
      tableId: row.table_id,
      rowId,
      rowData: (row.data as Record<string, any>) ?? {},
      eventType: 'deleted',
    })
  }
}

async function hardDeleteIntegration(supabase: any, tenantId: string, integrationId: string) {
  await (supabase as any).from('integration_references').delete().eq('integration_id', integrationId).eq('tenant_id', tenantId)
  const { error } = await (supabase as any).from('integrations').delete().eq('id', integrationId).eq('tenant_id', tenantId)
  if (error) throw error
}

/**
 * hardDeleteAgent — delete an agent, first deactivating any workflow that
 * references it in a run_agent node so those workflows can't run broken
 * against a phantom agent_id.
 */
async function hardDeleteAgent(supabase: any, tenantId: string, agentId: string) {
  await deactivateWorkflowsReferencingAgent(supabase, tenantId, agentId)
  const { error } = await (supabase as any).from('agents').delete().eq('id', agentId).eq('tenant_id', tenantId)
  if (error) throw error
}

async function processDeletionJob(supabase: any, job: DeletionJob) {
  if (job.target_type === 'data_table') {
    await hardDeleteCustomTable(supabase, job.target_id)
    return
  }

  if (job.target_type === 'data_row') {
    await hardDeleteDataRow(supabase, job.tenant_id, job.target_id, job.payload)
    return
  }

  if (job.target_type === 'integration') {
    await hardDeleteIntegration(supabase, job.tenant_id, job.target_id)
    return
  }

  if (job.target_type === 'workflow') {
    await hardDeleteWorkflow(supabase, job.tenant_id, job.target_id)
    return
  }

  if (job.target_type === 'agent') {
    await hardDeleteAgent(supabase, job.tenant_id, job.target_id)
    return
  }

  const directTableMap: Partial<Record<DeletionTargetType, string>> = {
    report: 'reports',
    decision_table: 'decision_tables',
    workflow_activity: 'custom_workflow_activities',
    retention_policy: 'retention_policies',
  }

  const table = directTableMap[job.target_type]
  if (table) {
    const { error } = await (supabase as any).from(table).delete().eq('id', job.target_id)
    if (error) throw error
  }
}

/**
 * hardDeleteWorkflow — wipe a workflow and the tasks it spawned.
 *
 * Tasks link back to the workflow whose User Task step created them via
 * tasks.workflow_id (ON DELETE SET NULL — workflow_source_id is only for
 * tasks ingested from external engines). Deleting just the workflow row leaves
 * orphaned tasks sitting in the user's queue referencing a phantom
 * workflow_step_id. Soft-delete them here so they disappear from the
 * task list while staying auditable. Hard deletion would lose the
 * completion history we use for capacity/reporting.
 */
async function hardDeleteWorkflow(supabase: any, tenantId: string, workflowId: string) {
  const nowIso = new Date().toISOString()

  // Soft-delete every task spawned by this workflow that isn't
  // already gone. The WHERE on tenant_id is belt-and-braces — the
  // worker runs as service_role so RLS isn't filtering for us.
  const { error: tasksError } = await supabase
    .from('tasks')
    .update({ deleted_at: nowIso })
    .eq('tenant_id', tenantId)
    .eq('workflow_id', workflowId)
    .is('deleted_at', null)
  if (tasksError) throw new Error(`Soft-delete workflow tasks failed: ${tasksError.message}`)

  const { error } = await supabase.from('workflows').delete().eq('id', workflowId)
  if (error) throw error
  invalidateDataTableTriggerCache(tenantId)
}

export async function processDeletionQueueBatch(options?: { batchSize?: number; workerId?: string }) {
  const supabase = createServiceClient()
  const batchSize = options?.batchSize ?? 10
  const workerId = options?.workerId ?? `deletion-worker-${Date.now()}`
  const results: Array<Record<string, unknown>> = []

  for (let index = 0; index < batchSize; index += 1) {
    const { data: job, error: claimError } = await supabase.rpc('claim_next_deletion_job', { p_worker_id: workerId })
    if (claimError || !job || !(job as any).id) break

    try {
      await processDeletionJob(supabase, job as DeletionJob)
      await supabase.rpc('complete_deletion_job', { p_job_id: (job as any).id })
      results.push({ job_id: (job as any).id, status: 'completed', target_type: (job as any).target_type })
    } catch (error: any) {
      await supabase.rpc('fail_deletion_job', { p_job_id: (job as any).id, p_error: error?.message ?? 'Deletion failed' })
      results.push({ job_id: (job as any).id, status: 'failed', error: error?.message ?? 'Deletion failed' })
    }
  }

  return {
    processed: results.length,
    results,
    worker_id: workerId,
  }
}
