import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import {
  RETENTION_ASSIGNMENT_TARGETS,
  RETENTION_ASSIGNMENT_TABLE_MAP,
  isRetentionAssignmentTarget,
  resolveScopedRetentionPolicy,
} from '@/lib/retention-policy-api'

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.edit')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const body = await request.json()
  const targetType = String(body.target_type ?? '').trim()
  const targetId = String(body.target_id ?? '').trim()
  const retentionPolicyId = String(body.retention_policy_id ?? '').trim() || null

  if (!isRetentionAssignmentTarget(targetType)) {
    return err(`target_type must be one of: ${RETENTION_ASSIGNMENT_TARGETS.join(', ')}`)
  }
  if (!targetId) return err('target_id is required')

  const target = RETENTION_ASSIGNMENT_TABLE_MAP[targetType]
  const resolved = await resolveScopedRetentionPolicy({
    supabase,
    tenantId,
    retentionPolicyId,
    scope: target.scope,
  })
  if (resolved && 'error' in resolved) return err(resolved.error)
  if (targetType === 'role' && resolved?.policy && ['purge_on', 'purge_on_exact_date'].includes(String(resolved.policy.policy_mode ?? ''))) {
    return err('Roles support review-style retention policies only')
  }

  const updatePayload: Record<string, any> = {
    retention_policy_id: retentionPolicyId,
  }
  if (targetType !== 'data_row') {
    updatePayload.retention_applied_at = retentionPolicyId ? new Date().toISOString() : null
  }

  const { data, error: updateError } = await (supabase as any)
    .from(target.table)
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', targetId)
    .select('id, retention_policy_id, retention_applied_at')
    .single()

  if (updateError || !data) return err(updateError?.message ?? 'Failed to update retention assignment', 500)

  return ok({
    assigned: Boolean(retentionPolicyId),
    target_type: targetType,
    target_id: targetId,
    retention_policy_id: data.retention_policy_id ?? null,
    retention_applied_at: data.retention_applied_at ?? null,
  })
}
