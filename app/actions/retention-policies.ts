'use server'

import { revalidatePath } from 'next/cache'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/permissions-server'
import { enqueueDeletionJob, kickDeletionProcessor } from '@/lib/deletion-queue'
import { recordAssetChange } from '@/lib/github-sync/enqueue'

type RetentionTargetType = 'data_table' | 'data_row' | 'role'
type RetentionPolicyMode = 'review' | 'review_on_exact_date' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
type RetentionDurationUnit = 'days' | 'months' | 'years'

async function getAuthContext() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')
  return { supabase, tenantId, userId: user.id }
}

function normalizeAppliesTo(input: unknown) {
  const allowed = new Set(['data_tables', 'data_rows', 'roles'])
  if (!Array.isArray(input)) return ['data_tables', 'data_rows', 'roles']
  const next = input.filter((value): value is string => typeof value === 'string' && allowed.has(value))
  return next.length > 0 ? next : ['data_tables', 'data_rows', 'roles']
}

function normalizeRetentionFields(input: {
  policyMode: RetentionPolicyMode
  durationValue?: number | null
  durationUnit?: string | null
  exactDate?: string | null
}) {
  if (input.policyMode === 'keep_forever') {
    return {
      durationValue: null,
      durationUnit: null,
      exactDate: null,
    }
  }

  if (input.policyMode === 'review_on_exact_date' || input.policyMode === 'purge_on_exact_date') {
    const exactDate = input.exactDate?.trim()
    if (!exactDate) throw new Error(`An exact ${input.policyMode === 'review_on_exact_date' ? 'review' : 'purge'} date is required`)
    const parsed = new Date(exactDate)
    if (Number.isNaN(parsed.getTime())) throw new Error(`Exact ${input.policyMode === 'review_on_exact_date' ? 'review' : 'purge'} date is invalid`)
    return {
      durationValue: null,
      durationUnit: null,
      exactDate: parsed.toISOString(),
    }
  }

  const durationValue = Number(input.durationValue ?? 0)
  const durationUnit = input.durationUnit
  if (!Number.isFinite(durationValue) || durationValue <= 0) {
    throw new Error('Retention duration must be greater than 0')
  }
  if (durationUnit !== 'days' && durationUnit !== 'months' && durationUnit !== 'years') {
    throw new Error('Retention duration unit must be days, months, or years')
  }
  return {
    durationValue,
    durationUnit,
    exactDate: null,
  }
}

export async function createRetentionPolicy(input: {
  name: string
  description?: string
  policyMode: RetentionPolicyMode
  durationValue?: number | null
  durationUnit?: RetentionDurationUnit | null
  exactDate?: string | null
  appliesTo?: string[]
}) {
  await requirePermission('team.change_roles')
  const { supabase, tenantId, userId } = await getAuthContext()

  const name = input.name?.trim()
  if (!name) throw new Error('Policy name is required')

  const retentionFields = normalizeRetentionFields(input)

  const { data: created, error } = await (supabase as any).from('retention_policies').insert({
    tenant_id: tenantId,
    name,
    description: input.description?.trim() || null,
    policy_mode: input.policyMode,
    duration_value: retentionFields.durationValue,
    duration_unit: retentionFields.durationUnit,
    exact_date: retentionFields.exactDate,
    applies_to: normalizeAppliesTo(input.appliesTo),
    created_by: userId,
    updated_by: userId,
  }).select('id').single()
  if (error) throw new Error(error.message)

  if ((created as any)?.id) {
    void recordAssetChange({ supabase, tenantId, assetType: 'retention_policy', assetId: (created as any).id, assetName: name, action: 'save', actorId: userId })
  }

  revalidatePath('/settings/governance')
}

export async function updateRetentionPolicy(policyId: string, input: {
  name: string
  description?: string
  policyMode: RetentionPolicyMode
  durationValue?: number | null
  durationUnit?: RetentionDurationUnit | null
  exactDate?: string | null
  appliesTo?: string[]
}) {
  await requirePermission('team.change_roles')
  const { supabase, tenantId, userId } = await getAuthContext()

  const name = input.name?.trim()
  if (!name) throw new Error('Policy name is required')

  const retentionFields = normalizeRetentionFields(input)

  const { error } = await (supabase as any).from('retention_policies').update({
    name,
    description: input.description?.trim() || null,
    policy_mode: input.policyMode,
    duration_value: retentionFields.durationValue,
    duration_unit: retentionFields.durationUnit,
    exact_date: retentionFields.exactDate,
    applies_to: normalizeAppliesTo(input.appliesTo),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }).eq('id', policyId).eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)

  void recordAssetChange({ supabase, tenantId, assetType: 'retention_policy', assetId: policyId, assetName: name, action: 'save', actorId: userId })

  revalidatePath('/settings/governance')
  revalidatePath('/data')
}

export async function deleteRetentionPolicy(policyId: string) {
  await requirePermission('team.change_roles')
  const { supabase, tenantId, userId } = await getAuthContext()

  const [{ count: tableCount }, { count: rowCount }, { count: roleCount }] = await Promise.all([
    (supabase as any).from('custom_tables').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', policyId),
    (supabase as any).from('custom_table_rows').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', policyId),
    (supabase as any).from('roles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', policyId),
  ])

  if ((tableCount ?? 0) > 0 || (rowCount ?? 0) > 0 || (roleCount ?? 0) > 0) {
    throw new Error('Remove this policy from tables, rows, and roles before deleting it')
  }

  const { data: policy, error } = await (supabase as any)
    .from('retention_policies')
    .select('id, name')
    .eq('id', policyId)
    .eq('tenant_id', tenantId)
    .single()
  if (error) throw new Error(error.message)
  if (!policy) throw new Error('Retention policy not found')
  await enqueueDeletionJob(supabase, {
    tenantId,
    createdBy: userId,
    targetType: 'retention_policy',
    targetId: policyId,
    payload: { name: (policy as any).name ?? null },
  })

  void recordAssetChange({ supabase, tenantId, assetType: 'retention_policy', assetId: policyId, assetName: (policy as any).name ?? null, action: 'delete', actorId: userId })

  kickDeletionProcessor()
  revalidatePath('/settings/governance')
}

export async function bulkDeleteRetentionPolicies(policyIds: string[]) {
  await requirePermission('team.change_roles')
  const { supabase, tenantId, userId } = await getAuthContext()

  const uniqueIds = Array.from(new Set(policyIds.map((id) => id.trim()).filter(Boolean)))
  if (uniqueIds.length === 0) return { queued: 0 }

  const [{ data: policies }, { data: tableCounts }, { data: rowCounts }, { data: roleCounts }] = await Promise.all([
    (supabase as any).from('retention_policies').select('id, name').eq('tenant_id', tenantId).in('id', uniqueIds),
    (supabase as any).from('custom_tables').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', uniqueIds),
    (supabase as any).from('custom_table_rows').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', uniqueIds),
    (supabase as any).from('roles').select('retention_policy_id').eq('tenant_id', tenantId).in('retention_policy_id', uniqueIds),
  ])

  const blocked = new Set<string>()
  for (const row of [...(tableCounts ?? []), ...(rowCounts ?? []), ...(roleCounts ?? [])]) {
    if (row?.retention_policy_id) blocked.add(String(row.retention_policy_id))
  }

  const deletablePolicies = (policies ?? []).filter((policy: any) => !blocked.has(policy.id))
  if (deletablePolicies.length === 0 && blocked.size > 0) {
    throw new Error('Remove selected policies from tables, rows, and roles before deleting them')
  }

  for (const policy of deletablePolicies) {
    await enqueueDeletionJob(supabase, {
      tenantId,
      createdBy: userId,
      targetType: 'retention_policy',
      targetId: policy.id,
      payload: { name: policy.name ?? null },
    })
    void recordAssetChange({ supabase, tenantId, assetType: 'retention_policy', assetId: policy.id, assetName: policy.name ?? null, action: 'delete', actorId: userId })
  }

  kickDeletionProcessor()
  revalidatePath('/settings/governance')
  return { queued: deletablePolicies.length, blocked: Array.from(blocked) }
}

export async function assignRetentionPolicy(params: {
  targetType: RetentionTargetType
  targetId: string
  retentionPolicyId?: string | null
}) {
  await requirePermission('team.change_roles')
  const { supabase, tenantId } = await getAuthContext()

  const targetMap: Record<RetentionTargetType, { table: string; path: string }> = {
    data_table: { table: 'custom_tables', path: `/data/${params.targetId}` },
    data_row: { table: 'custom_table_rows', path: '/data' },
    role: { table: 'roles', path: '/settings/governance?tab=roles' },
  }
  const target = targetMap[params.targetType]
  if (!target) throw new Error('Unsupported target type')

  let policyRecord: any = null
  if (params.retentionPolicyId) {
    const { data: policy, error: policyError } = await (supabase as any)
      .from('retention_policies')
      .select('id, applies_to, policy_mode')
      .eq('id', params.retentionPolicyId)
      .eq('tenant_id', tenantId)
      .single()
    if (policyError || !policy) throw new Error(policyError?.message ?? 'Retention policy not found')
    policyRecord = policy

    const expectedScope =
      params.targetType === 'data_row'
        ? 'data_rows'
        : params.targetType === 'role'
          ? 'roles'
          : 'data_tables'
    if (Array.isArray(policy.applies_to) && !policy.applies_to.includes(expectedScope)) {
      throw new Error('That retention policy cannot be applied to this object type')
    }
    if (params.targetType === 'role' && ['purge_on', 'purge_on_exact_date'].includes(String(policy.policy_mode ?? ''))) {
      throw new Error('Roles support review-style retention policies only. Purge policies cannot be applied to roles.')
    }
  }

  const updatePayload: Record<string, any> = {
    retention_policy_id: params.retentionPolicyId || null,
  }
  if (params.targetType !== 'data_row') {
    updatePayload.retention_applied_at = params.retentionPolicyId ? new Date().toISOString() : null
  }

  const { error } = await (supabase as any)
    .from(target.table)
    .update(updatePayload)
    .eq('id', params.targetId)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)

  revalidatePath('/settings/governance')
  revalidatePath('/data')
  revalidatePath('/settings')
  revalidatePath(target.path)
}
