import type { SupabaseClient } from '@supabase/supabase-js'

type ReviewTargetType = 'data_table' | 'data_row' | 'role'

export interface DueRetentionReview {
  tenant_id: string
  retention_policy_id: string
  retention_policy_name: string
  policy_mode: 'review' | 'review_on_exact_date'
  review_date: string
  target_type: ReviewTargetType
  target_id: string
  asset_name: string
  applied_at?: string | null
  created_at?: string | null
}

export interface DueRetentionExecution {
  tenant_id: string
  retention_policy_id: string
  retention_policy_name: string
  policy_mode: 'purge_on' | 'purge_on_exact_date'
  action_type: 'purge'
  execution_date: string
  target_type: ReviewTargetType
  target_id: string
  asset_name: string
  applied_at?: string | null
  created_at?: string | null
}

function addInterval(baseAt: Date, value: number, unit: 'days' | 'months' | 'years') {
  const dueAt = new Date(baseAt)
  if (unit === 'days') dueAt.setDate(dueAt.getDate() + value)
  else if (unit === 'months') dueAt.setMonth(dueAt.getMonth() + value)
  else dueAt.setFullYear(dueAt.getFullYear() + value)
  return dueAt
}

function isoDay(value: Date) {
  return value.toISOString().slice(0, 10)
}

function sameOrPastDay(value: string, now: Date) {
  return value <= isoDay(now)
}

function resolveReviewDate(policy: any, appliedAt?: string | null, createdAt?: string | null) {
  if (policy?.policy_mode === 'review_on_exact_date') {
    const exact = String(policy?.exact_date ?? '').trim()
    if (!exact) return null
    return isoDay(new Date(exact))
  }
  if (policy?.policy_mode !== 'review') return null
  const base = appliedAt ?? createdAt
  if (!base || !policy?.duration_value || !policy?.duration_unit) return null
  const dueAt = addInterval(new Date(base), Number(policy.duration_value), policy.duration_unit)
  return isoDay(dueAt)
}

function resolveExecutionDate(policy: any, appliedAt?: string | null, createdAt?: string | null) {
  if (policy?.policy_mode === 'purge_on_exact_date') {
    const exact = String(policy?.exact_date ?? '').trim()
    if (!exact) return null
    return isoDay(new Date(exact))
  }
  if (policy?.policy_mode !== 'purge_on') return null
  const base = appliedAt ?? createdAt
  if (!base || !policy?.duration_value || !policy?.duration_unit) return null
  const dueAt = addInterval(new Date(base), Number(policy.duration_value), policy.duration_unit)
  return isoDay(dueAt)
}

export async function listDueRetentionReviews(supabase: SupabaseClient, tenantId?: string) {
  const now = new Date()
  const due: DueRetentionReview[] = []

  const tenantFilter = tenantId ? { tenant_id: tenantId } : null

  const [tables, rows, roles] = await Promise.all([
    (supabase as any)
      .from('custom_tables')
      .select('id, tenant_id, name, created_at, retention_applied_at, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date)')
      .not('retention_policy_id', 'is', null)
      .match(tenantFilter ?? {}),
    (supabase as any)
      .from('custom_table_rows')
      .select('id, tenant_id, created_at, data, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date)')
      .not('retention_policy_id', 'is', null)
      .match(tenantFilter ?? {}),
    (supabase as any)
      .from('roles')
      .select('id, tenant_id, name, created_at, retention_applied_at, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date)')
      .not('retention_policy_id', 'is', null)
      .match(tenantFilter ?? {}),
  ])

  const append = (targetType: ReviewTargetType, record: any, assetName: string) => {
    const effective = {
      policy: record?.retention_policy,
      appliedAt: record?.created_at ?? null,
      createdAt: record?.created_at ?? null,
    }
    const policy = effective.policy
    if (!policy || !['review', 'review_on_exact_date'].includes(String(policy.policy_mode ?? ''))) return
    const reviewDate = resolveReviewDate(policy, effective.appliedAt, effective.createdAt)
    if (!reviewDate || !sameOrPastDay(reviewDate, now)) return
    due.push({
      tenant_id: record.tenant_id,
      retention_policy_id: policy.id,
      retention_policy_name: policy.name,
      policy_mode: policy.policy_mode,
      review_date: reviewDate,
      target_type: targetType,
      target_id: record.id,
      asset_name: assetName,
      applied_at: effective.appliedAt ?? null,
      created_at: effective.createdAt ?? null,
    })
  }

  for (const record of (tables.data ?? [])) append('data_table', record, record.name || `Table ${record.id}`)
  for (const record of (rows.data ?? [])) {
    const rowName = String(record?.data?.name ?? record?.data?.title ?? record?.data?.id ?? record.id)
    append('data_row', record, rowName)
  }
  for (const record of (roles.data ?? [])) append('role', record, record.name || `Role ${record.id}`)

  return due
}

export async function listDueRetentionExecutions(supabase: SupabaseClient, tenantId?: string) {
  const now = new Date()
  const due: DueRetentionExecution[] = []

  const tenantFilter = tenantId ? { tenant_id: tenantId } : null

  const [tables, rows] = await Promise.all([
    (supabase as any)
      .from('custom_tables')
      .select('id, tenant_id, name, created_at, retention_applied_at, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date)')
      .not('retention_policy_id', 'is', null)
      .match(tenantFilter ?? {}),
    (supabase as any)
      .from('custom_table_rows')
      .select('id, tenant_id, created_at, data, retention_policy:retention_policies(id, name, policy_mode, duration_value, duration_unit, exact_date)')
      .not('retention_policy_id', 'is', null)
      .match(tenantFilter ?? {}),
  ])

  const append = (targetType: ReviewTargetType, record: any, assetName: string) => {
    const effective = {
      policy: record?.retention_policy,
      appliedAt: record?.created_at ?? null,
      createdAt: record?.created_at ?? null,
    }
    const policy = effective.policy
    if (!policy || !['purge_on', 'purge_on_exact_date'].includes(String(policy.policy_mode ?? ''))) return
    const executionDate = resolveExecutionDate(policy, effective.appliedAt, effective.createdAt)
    if (!executionDate || !sameOrPastDay(executionDate, now)) return
    due.push({
      tenant_id: record.tenant_id,
      retention_policy_id: policy.id,
      retention_policy_name: policy.name,
      policy_mode: policy.policy_mode,
      action_type: 'purge',
      execution_date: executionDate,
      target_type: targetType,
      target_id: record.id,
      asset_name: assetName,
      applied_at: effective.appliedAt ?? null,
      created_at: effective.createdAt ?? null,
    })
  }

  for (const record of (tables.data ?? [])) append('data_table', record, record.name || `Table ${record.id}`)
  for (const record of (rows.data ?? [])) {
    const rowName = String(record?.data?.name ?? record?.data?.title ?? record?.data?.id ?? record.id)
    append('data_row', record, rowName)
  }

  return due
}

export async function ensureRetentionReviewEvent(supabase: SupabaseClient, review: DueRetentionReview) {
  const payload = {
    tenant_id: review.tenant_id,
    retention_policy_id: review.retention_policy_id,
    target_type: review.target_type,
    target_id: review.target_id,
    review_date: review.review_date,
    asset_name: review.asset_name,
    metadata: {
      retention_policy_name: review.retention_policy_name,
      policy_mode: review.policy_mode,
      applied_at: review.applied_at ?? null,
      created_at: review.created_at ?? null,
    },
  }

  const { data, error } = await (supabase as any)
    .from('retention_review_events')
    .upsert(payload, { onConflict: 'tenant_id,retention_policy_id,target_type,target_id,review_date' })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to upsert retention review event')
  return data
}

export async function createRetentionExecutionEvent(supabase: SupabaseClient, execution: DueRetentionExecution) {
  const { data, error } = await (supabase as any)
    .from('retention_execution_events')
    .insert({
      tenant_id: execution.tenant_id,
      retention_policy_id: execution.retention_policy_id,
      action_type: execution.action_type,
      target_type: execution.target_type,
      target_id: execution.target_id,
      executed_at: new Date().toISOString(),
      asset_name: execution.asset_name,
      result_status: 'completed',
      metadata: {
        retention_policy_name: execution.retention_policy_name,
        policy_mode: execution.policy_mode,
        execution_date: execution.execution_date,
        applied_at: execution.applied_at ?? null,
        created_at: execution.created_at ?? null,
      },
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Failed to create retention execution event')
  return data
}

export async function findRetentionExecutionEvent(supabase: SupabaseClient, execution: DueRetentionExecution) {
  const { data } = await (supabase as any)
    .from('retention_execution_events')
    .select('*')
    .eq('tenant_id', execution.tenant_id)
    .eq('retention_policy_id', execution.retention_policy_id)
    .eq('action_type', execution.action_type)
    .eq('target_type', execution.target_type)
    .eq('target_id', execution.target_id)
    .order('executed_at', { ascending: false, nullsFirst: false })
    .limit(1)

  return (data ?? [])[0] ?? null
}

export async function listTenantAdminUserIds(supabase: SupabaseClient, tenantId: string) {
  const ids = new Set<string>()

  const { data: roleAssignments } = await (supabase as any)
    .from('user_roles')
    .select('user_id, role:roles(slug, is_system, name)')
    .eq('tenant_id', tenantId)

  for (const assignment of roleAssignments ?? []) {
    const slug = String((assignment as any).role?.slug ?? '').toLowerCase()
    const name = String((assignment as any).role?.name ?? '').toLowerCase()
    if (slug === 'owner' || slug === 'admin' || name === 'owner' || name === 'admin') {
      ids.add(assignment.user_id)
    }
  }

  const { data: users } = await (supabase as any)
    .from('users')
    .select('id, role')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'admin'])

  for (const user of users ?? []) {
    ids.add(user.id)
  }

  return [...ids]
}
