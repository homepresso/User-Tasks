import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { getRetentionPolicyUsageSummary } from '@/lib/retention-policy-api'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data: policy, error: policyError } = await (supabase as any)
    .from('retention_policies')
    .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()
  if (policyError || !policy) return err(policyError?.message ?? 'Retention policy not found', 404)

  const query = request.nextUrl.searchParams
  const includeTables = query.get('include_data_tables') !== 'false'
  const includeRows = query.get('include_data_rows') !== 'false'
  const includeRoles = query.get('include_roles') !== 'false'
  const limitPerType = Math.min(Math.max(Number(query.get('limit_per_type') ?? 100), 1), 500)

  const [tablesResult, rowsResult, rolesResult] = await Promise.all([
    includeTables
      ? (supabase as any).from('custom_tables').select('id, name, created_at, retention_applied_at').eq('tenant_id', tenantId).eq('retention_policy_id', id).order('updated_at', { ascending: false }).limit(limitPerType)
      : Promise.resolve({ data: [], error: null }),
    includeRows
      ? (supabase as any).from('custom_table_rows').select('id, table_id, data, created_at').eq('tenant_id', tenantId).eq('retention_policy_id', id).order('updated_at', { ascending: false }).limit(limitPerType)
      : Promise.resolve({ data: [], error: null }),
    includeRoles
      ? (supabase as any).from('roles').select('id, name, slug, created_at, retention_applied_at').eq('tenant_id', tenantId).eq('retention_policy_id', id).order('updated_at', { ascending: false }).limit(limitPerType)
      : Promise.resolve({ data: [], error: null }),
  ])

  for (const result of [tablesResult, rowsResult, rolesResult]) {
    if (result?.error) return err(result.error.message, 500)
  }

  const usage = await getRetentionPolicyUsageSummary(supabase, tenantId, id)

  return ok({
    retention_policy: policy,
    usage,
    assets: {
      data_tables: tablesResult.data ?? [],
      data_rows: rowsResult.data ?? [],
      roles: rolesResult.data ?? [],
    },
  })
}
