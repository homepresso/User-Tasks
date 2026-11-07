import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { getRetentionPolicyUsageSummary } from '@/lib/retention-policy-api'
import { listRetentionPolicyAssets } from '@/lib/services/retention'

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
  const limitPerType = Math.min(Math.max(Number(query.get('limit_per_type') ?? 100), 1), 500)
  let assets
  try {
    assets = await listRetentionPolicyAssets(supabase, tenantId, id, {
      data_tables: query.get('include_data_tables') !== 'false',
      data_rows: query.get('include_data_rows') !== 'false',
      roles: query.get('include_roles') !== 'false',
      forms: query.get('include_forms') !== 'false',
    }, limitPerType)
  } catch (error) {
    return err((error as Error).message, 500)
  }

  const usage = await getRetentionPolicyUsageSummary(supabase, tenantId, id)

  return ok({
    retention_policy: policy,
    usage,
    assets,
  })
}
