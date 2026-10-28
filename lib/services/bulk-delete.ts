/**
 * Bulk delete for list pages (the selection bar's "Delete {n}"): queues a
 * deferred hard delete per item (deletion_queue → /api/deletions/process),
 * as the per-type bulk server actions did, with the same permissions and
 * side effects (audit, GitHub-sync change, agent reference integrity,
 * retention-policy usage check, own reports only), but set-based: one read,
 * one queue insert and one audit insert per batch instead of one each per
 * item.
 *
 * Runs as a background job (lib/user-jobs/kinds, `bulk.delete`) or directly;
 * every query is pinned to ctx.tenantId, so it works on a service-role
 * client (jobs, API) as well as on the session client.
 */

import { kickDeletionProcessor, type DeletionTargetType } from '@/lib/deletion-queue'
import { recordAssetChange, type SyncAssetType } from '@/lib/github-sync/enqueue'
import { GITHUB_CONNECTOR_KEY } from '@/lib/github-sync/connection'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import type { AuditObjectType } from '@/lib/audit-log'
import { getDb, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export const BULK_DELETE_TYPES = [
  'workflow', 'data_table', 'data_row', 'decision_table', 'agent', 'report', 'retention_policy',
] as const
export type BulkDeleteType = (typeof BULK_DELETE_TYPES)[number]

/** At most this many ids per call (the selection is one page or "select all" of a list). */
export const MAX_BULK_IDS = 5_000
/** Ids per `in.(…)` read: longer URLs are refused by the API gateway. */
const BATCH = 100

interface TypeDef {
  table: string
  permission: string
  select: string
  deletion: DeletionTargetType
  sync?: SyncAssetType
  audit?: AuditObjectType
  noun: string
  payload?: (row: any) => Record<string, unknown>
  /** Extra filter (reports: only the caller's own). */
  scope?: (query: any, ctx: ServiceContext) => any
}

const TYPES: Record<BulkDeleteType, TypeDef> = {
  workflow: { table: 'workflows', permission: 'workflows.delete', select: 'id, name', deletion: 'workflow', sync: 'workflow', audit: 'workflow', noun: 'workflow' },
  data_table: { table: 'custom_tables', permission: 'data.delete', select: 'id, name', deletion: 'data_table', sync: 'data_table', noun: 'data table' },
  data_row: {
    table: 'custom_table_rows', permission: 'data.manage_rows', select: 'id, table_id, data', deletion: 'data_row', noun: 'row',
    payload: (row) => ({ table_id: row.table_id, row_data: (row.data as Record<string, unknown>) ?? {} }),
  },
  decision_table: { table: 'decision_tables', permission: 'workflows.delete', select: 'id, name', deletion: 'decision_table', sync: 'decision_table', audit: 'decision_table', noun: 'business rule' },
  agent: { table: 'agents', permission: 'agents.delete', select: 'id, name', deletion: 'agent', sync: 'agent', audit: 'agent', noun: 'agent' },
  report: {
    table: 'reports', permission: 'reports.delete', select: 'id, name', deletion: 'report', sync: 'report', audit: 'report', noun: 'report',
    // Only the caller's own reports, as the reports_delete RLS policy allows.
    scope: (query, ctx) => query.eq('created_by', ctx.actorId),
  },
  retention_policy: { table: 'retention_policies', permission: 'team.change_roles', select: 'id, name', deletion: 'retention_policy', sync: 'retention_policy', noun: 'retention policy' },
}

export function bulkDeletePermission(type: BulkDeleteType): string {
  return TYPES[type].permission
}

export interface BulkDeleteResult {
  queued: number
  /** Ids not found in this workspace (or not yours, for reports). */
  missing: number
  /** Retention policies still in use (not deleted). */
  blocked: string[]
}

function cleanIds(ids: string[]): string[] {
  const unique = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id ?? '').trim()).filter(Boolean)))
  if (unique.length > MAX_BULK_IDS) throw ServiceError.validation(`At most ${MAX_BULK_IDS} items per bulk delete`)
  return unique
}

async function githubSyncEnabled(db: any, tenantId: string): Promise<boolean> {
  try {
    const { data } = await db.from('tenant_connectors').select('is_enabled').eq('tenant_id', tenantId).eq('connector_key', GITHUB_CONNECTOR_KEY).maybeSingle()
    return Boolean(data?.is_enabled)
  } catch {
    return false
  }
}

async function retentionPoliciesInUse(db: any, tenantId: string, ids: string[]): Promise<Set<string>> {
  const [tables, rows, roles] = await Promise.all([
    db.from('custom_tables').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', ids),
    db.from('custom_table_rows').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', ids),
    db.from('roles').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', ids),
  ])
  const used = new Set<string>()
  for (const row of [...(tables.data ?? []), ...(rows.data ?? []), ...(roles.data ?? [])]) {
    if (row?.retention_policy_id) used.add(String(row.retention_policy_id))
  }
  return used
}

/**
 * Queue the items for deletion. `onProgress(done, total)` reports each batch
 * (background jobs show it).
 */
export async function bulkQueueDeletion(
  ctx: ServiceContext,
  type: BulkDeleteType,
  rawIds: string[],
  options: { onProgress?: (done: number, total: number) => Promise<void> | void } = {},
): Promise<BulkDeleteResult> {
  const def = TYPES[type]
  if (!def) throw ServiceError.validation(`Unknown bulk delete type "${type}"`)
  requirePerm(ctx, def.permission)
  const ids = cleanIds(rawIds)
  const result: BulkDeleteResult = { queued: 0, missing: 0, blocked: [] }
  if (ids.length === 0) return result

  const db = getDb(ctx) as any
  const syncOn = def.sync ? await githubSyncEnabled(db, ctx.tenantId) : false

  for (let start = 0; start < ids.length; start += BATCH) {
    const batch = ids.slice(start, start + BATCH)
    let query = db.from(def.table).select(def.select).eq('tenant_id', ctx.tenantId).in('id', batch)
    if (def.scope) query = def.scope(query, ctx)
    const { data, error } = await query
    if (error) throw dbError(error)
    let rows = (data ?? []) as any[]
    result.missing += batch.length - rows.length

    if (type === 'retention_policy' && rows.length) {
      const used = await retentionPoliciesInUse(db, ctx.tenantId, rows.map((row) => row.id))
      result.blocked.push(...rows.filter((row) => used.has(row.id)).map((row) => String(row.id)))
      rows = rows.filter((row) => !used.has(row.id))
    }

    if (rows.length) {
      // Agents: deactivate workflows that use them before they go (reference integrity).
      const deactivated = new Map<string, unknown[]>()
      if (type === 'agent') {
        for (const row of rows) {
          const list = await deactivateWorkflowsReferencingAgent(db, ctx.tenantId, row.id)
          if (list.length) deactivated.set(row.id, list)
        }
      }

      const { error: queueError } = await db.from('deletion_queue').insert(rows.map((row) => ({
        tenant_id: ctx.tenantId,
        created_by: ctx.actorId,
        target_type: def.deletion,
        target_id: row.id,
        payload: def.payload ? def.payload(row) : { name: row.name ?? null },
      })))
      if (queueError) throw dbError(queueError)
      result.queued += rows.length

      if (def.audit) {
        try {
          await db.from('object_audit_log').insert(rows.map((row) => ({
            tenant_id: ctx.tenantId,
            actor_id: ctx.actorId,
            object_type: def.audit,
            object_id: String(row.id),
            action: 'delete',
            summary: `Queued deletion for ${def.noun} "${row.name ?? row.id}"`,
            metadata: {
              via: ctx.source, bulk: true,
              ...(ctx.jobId ? { job_id: ctx.jobId } : {}),
              ...(deactivated.has(row.id) ? { deactivated_workflows: deactivated.get(row.id) } : {}),
            },
          })))
        } catch (auditError) {
          console.warn('[bulk-delete] audit insert failed:', auditError)
        }
      }

      if (syncOn && def.sync) {
        for (const row of rows) {
          await recordAssetChange({ supabase: db, tenantId: ctx.tenantId, assetType: def.sync, assetId: row.id, assetName: row.name ?? null, action: 'delete', actorId: ctx.actorId })
        }
      }
    }
    await options.onProgress?.(Math.min(start + BATCH, ids.length), ids.length)
  }

  if (result.queued > 0) {
    kickDeletionProcessor()
    if (type === 'workflow' || type === 'data_table') invalidateDataTableTriggerCache()
  }
  if (type === 'retention_policy' && result.queued === 0 && result.blocked.length > 0) {
    throw ServiceError.conflict('Remove the selected policies from tables, rows and roles before deleting them')
  }
  return result
}
