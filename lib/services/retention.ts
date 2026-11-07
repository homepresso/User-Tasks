/**
 * Retention-policy assignment, shared by the Settings → Governance UI (server
 * action), POST /api/v1/retention-policies/assign and the MCP
 * retention_policies_assign tool, so every surface validates, writes and
 * audits the same way.
 *
 * Callers gate the operation with their own permission (UI: team.change_roles;
 * REST / MCP: settings.edit). Targets: data tables, rows, roles and reusable
 * forms (a form's policy governs its submissions, lib/services/form-governance).
 * Forms have no client write grants, so their assignment is written with the
 * service-role client, pinned to ctx.tenantId like every other write here.
 */

import {
  isRetentionAssignmentTarget, PURGE_MODES, RETENTION_ASSIGNMENT_TABLE_MAP, RETENTION_ASSIGNMENT_TARGETS,
  type RetentionAssignmentTarget,
} from '@/lib/retention-policy-api'
import { getDb, requireAny, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient, syncChange } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables */

export interface RetentionAssignmentInput {
  targetType: string
  targetId: string
  /** null / empty clears the assignment. */
  retentionPolicyId?: string | null
}

export interface RetentionAssignmentResult {
  assigned: boolean
  target_type: RetentionAssignmentTarget
  target_id: string
  retention_policy_id: string | null
  retention_applied_at: string | null
}

/** Audit object type per target (rows are audited on their table). */
const AUDIT_TYPE: Record<RetentionAssignmentTarget, 'data_table' | 'role' | 'form'> = {
  data_table: 'data_table', data_row: 'data_table', role: 'role', form: 'form',
}

export async function assignRetentionPolicy(ctx: ServiceContext, input: RetentionAssignmentInput): Promise<RetentionAssignmentResult> {
  // The callers disagreed (REST / MCP settings.edit, the UI team.change_roles); either is enough, checked here for every surface.
  requireAny(ctx, ['settings.edit', 'team.change_roles'])
  const targetType = String(input.targetType ?? '').trim()
  const targetId = String(input.targetId ?? '').trim()
  const policyId = String(input.retentionPolicyId ?? '').trim() || null
  if (!isRetentionAssignmentTarget(targetType)) {
    throw ServiceError.validation(`target_type must be one of: ${RETENTION_ASSIGNMENT_TARGETS.join(', ')}`)
  }
  if (!targetId) throw ServiceError.validation('target_id is required')
  const target = RETENTION_ASSIGNMENT_TABLE_MAP[targetType]
  const db = getDb(ctx) as any

  let policy: { id: string; name: string; applies_to: string[] | null; policy_mode: string } | null = null
  if (policyId) {
    const { data, error } = await db.from('retention_policies').select('id, name, applies_to, policy_mode')
      .eq('tenant_id', ctx.tenantId).eq('id', policyId).maybeSingle()
    if (error) throw dbError(error)
    if (!data) throw ServiceError.notFound('Retention policy not found')
    policy = data
    if (Array.isArray(policy!.applies_to) && !policy!.applies_to.includes(target.scope)) {
      throw ServiceError.validation('That retention policy cannot be applied to this target type')
    }
    if (targetType === 'role' && PURGE_MODES.has(String(policy!.policy_mode ?? ''))) {
      throw ServiceError.validation('Roles support review-style retention policies only. Purge policies cannot be applied to roles.')
    }
  }

  const appliedAt = policyId ? new Date().toISOString() : null
  const update: Record<string, unknown> = { retention_policy_id: policyId }
  if (targetType !== 'data_row') update.retention_applied_at = appliedAt
  const writer = targetType === 'form' ? await serviceRoleClient(ctx) as any : db
  const nameColumn = targetType === 'data_row' ? 'table_id' : 'name'
  const { data: row, error } = await writer.from(target.table).update(update)
    .eq('tenant_id', ctx.tenantId).eq('id', targetId)
    .select(`id, ${nameColumn}, retention_policy_id${targetType !== 'data_row' ? ', retention_applied_at' : ''}`)
    .maybeSingle()
  if (error) throw dbError(error, 'Failed to update the retention assignment')
  if (!row) throw ServiceError.notFound('Target not found')

  const auditId = targetType === 'data_row' ? String(row.table_id ?? targetId) : targetId
  const label = targetType === 'data_row' ? `row ${targetId}` : `"${row.name ?? targetId}"`
  await audit(ctx, {
    objectType: AUDIT_TYPE[targetType], objectId: auditId, action: 'retention',
    summary: policy ? `Applied retention policy "${policy.name}" to ${label}` : `Cleared the retention policy on ${label}`,
    metadata: { target_type: targetType, target_id: targetId, retention_policy_id: policyId, retention_policy_name: policy?.name ?? null },
  })
  // A form's retention policy travels with it in config as code / GitHub sync.
  if (targetType === 'form') await syncChange(ctx, 'form', { id: targetId, name: row.name ?? null })

  return {
    assigned: Boolean(policyId),
    target_type: targetType,
    target_id: targetId,
    retention_policy_id: row.retention_policy_id ?? null,
    retention_applied_at: row.retention_applied_at ?? null,
  }
}

/** Assets governed by a policy, per scope (REST / MCP `assets`). */
export async function listRetentionPolicyAssets(db: any, tenantId: string, policyId: string, include: { data_tables?: boolean; data_rows?: boolean; roles?: boolean; forms?: boolean }, limit: number) {
  const none = Promise.resolve({ data: [], error: null })
  const pick = (on: boolean | undefined, table: string, columns: string) => on === false ? none
    : db.from(table).select(columns).eq('tenant_id', tenantId).eq('retention_policy_id', policyId).order('updated_at', { ascending: false }).limit(limit)
  const [tables, rows, roles, forms] = await Promise.all([
    pick(include.data_tables, 'custom_tables', 'id, name, created_at, retention_applied_at'),
    pick(include.data_rows, 'custom_table_rows', 'id, table_id, data, created_at'),
    pick(include.roles, 'roles', 'id, name, slug, created_at, retention_applied_at'),
    pick(include.forms, 'forms', 'id, name, created_at, retention_applied_at, legal_hold'),
  ])
  for (const result of [tables, rows, roles, forms]) if (result?.error) throw dbError(result.error)
  return { data_tables: tables.data ?? [], data_rows: rows.data ?? [], roles: roles.data ?? [], forms: forms.data ?? [] }
}
