import type { SupabaseClient } from '@supabase/supabase-js'

export const RETENTION_APPLIES_TO = ['data_tables', 'data_rows', 'roles'] as const
export const RETENTION_POLICY_MODES = ['review', 'review_on_exact_date', 'purge_on', 'purge_on_exact_date', 'keep_forever'] as const
export const RETENTION_DURATION_UNITS = ['days', 'months', 'years'] as const
export const RETENTION_ASSIGNMENT_TARGETS = ['data_table', 'data_row', 'role'] as const

export type RetentionAppliesTo = typeof RETENTION_APPLIES_TO[number]
export type RetentionPolicyMode = typeof RETENTION_POLICY_MODES[number]
export type RetentionDurationUnit = typeof RETENTION_DURATION_UNITS[number]
export type RetentionAssignmentTarget = typeof RETENTION_ASSIGNMENT_TARGETS[number]

function normalizeText(value: unknown) {
  return String(value ?? '').trim()
}

export function isRetentionAppliesTo(value: unknown): value is RetentionAppliesTo {
  return typeof value === 'string' && (RETENTION_APPLIES_TO as readonly string[]).includes(value)
}

export function isRetentionPolicyMode(value: unknown): value is RetentionPolicyMode {
  return typeof value === 'string' && (RETENTION_POLICY_MODES as readonly string[]).includes(value)
}

export function isRetentionAssignmentTarget(value: unknown): value is RetentionAssignmentTarget {
  return typeof value === 'string' && (RETENTION_ASSIGNMENT_TARGETS as readonly string[]).includes(value)
}

export function parseRetentionScopes(value: unknown) {
  if (value == null) return { scopes: null as RetentionAppliesTo[] | null, error: null as string | null }
  if (!Array.isArray(value)) return { scopes: null, error: 'applies_to must be an array' }
  const scopes = value.map((item) => normalizeText(item)).filter(Boolean)
  if (!scopes.every(isRetentionAppliesTo)) {
    return {
      scopes: null,
      error: `applies_to must contain only: ${RETENTION_APPLIES_TO.join(', ')}`,
    }
  }
  return {
    scopes: Array.from(new Set(scopes)) as RetentionAppliesTo[],
    error: null,
  }
}

export function normalizeRetentionPayload(args: {
  policy_mode?: RetentionPolicyMode
  duration_value?: number
  duration_unit?: RetentionDurationUnit
  exact_date?: string
}) {
  if (!args.policy_mode) return { ok: true as const, payload: null }

  if (args.policy_mode === 'keep_forever') {
    return {
      ok: true as const,
      payload: { duration_value: null, duration_unit: null, exact_date: null },
    }
  }

  if (args.policy_mode === 'review_on_exact_date' || args.policy_mode === 'purge_on_exact_date') {
    const exactDate = normalizeText(args.exact_date)
    if (!exactDate) {
      return { ok: false as const, error: `exact_date is required for ${args.policy_mode}` }
    }
    const parsed = new Date(exactDate)
    if (Number.isNaN(parsed.getTime())) return { ok: false as const, error: 'exact_date must be a valid date' }
    return {
      ok: true as const,
      payload: { duration_value: null, duration_unit: null, exact_date: parsed.toISOString() },
    }
  }

  if (!Number.isFinite(args.duration_value) || Number(args.duration_value) <= 0) {
    return { ok: false as const, error: 'duration_value must be greater than 0' }
  }
  if (!args.duration_unit) {
    return { ok: false as const, error: 'duration_unit is required for interval retention policies' }
  }

  return {
    ok: true as const,
    payload: {
      duration_value: Number(args.duration_value),
      duration_unit: args.duration_unit,
      exact_date: null,
    },
  }
}

export async function getRetentionPolicyUsageSummary(supabase: SupabaseClient, tenantId: string, retentionPolicyId: string) {
  const [
    { count: tableCount },
    { count: rowCount },
    { count: roleCount },
  ] = await Promise.all([
    (supabase as any).from('custom_tables').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', retentionPolicyId),
    (supabase as any).from('custom_table_rows').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', retentionPolicyId),
    (supabase as any).from('roles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('retention_policy_id', retentionPolicyId),
  ])

  return {
    data_tables: Number(tableCount ?? 0),
    data_rows: Number(rowCount ?? 0),
    roles: Number(roleCount ?? 0),
  }
}

export async function resolveScopedRetentionPolicy(params: {
  supabase: SupabaseClient
  tenantId: string
  retentionPolicyId?: string | null
  scope: RetentionAppliesTo
}) {
  const normalizedId = normalizeText(params.retentionPolicyId)
  if (!normalizedId) return null

  const { data: policy, error } = await (params.supabase as any)
    .from('retention_policies')
    .select('id, name, applies_to, policy_mode')
    .eq('tenant_id', params.tenantId)
    .eq('id', normalizedId)
    .single()

  if (error || !policy) return { error: error?.message ?? 'Retention policy not found' }
  if (Array.isArray(policy.applies_to) && !policy.applies_to.includes(params.scope)) {
    return { error: `That retention policy cannot be applied to ${params.scope.replace('_', ' ')}` }
  }

  return { policy }
}

export const RETENTION_ASSIGNMENT_TABLE_MAP: Record<RetentionAssignmentTarget, { table: string; scope: RetentionAppliesTo }> = {
  data_table: { table: 'custom_tables', scope: 'data_tables' },
  data_row: { table: 'custom_table_rows', scope: 'data_rows' },
  role: { table: 'roles', scope: 'roles' },
}
