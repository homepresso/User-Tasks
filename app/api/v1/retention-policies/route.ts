import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err, parsePagination } from '@/lib/api-auth'
import {
  RETENTION_APPLIES_TO,
  RETENTION_POLICY_MODES,
  isRetentionAppliesTo,
  isRetentionPolicyMode,
  normalizeRetentionPayload,
  parseRetentionScopes,
} from '@/lib/retention-policy-api'

export async function GET(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth

  const params = request.nextUrl.searchParams
  const { limit, offset } = parsePagination(params)
  const search = String(params.get('search') ?? '').trim().toLowerCase()
  const appliesTo = String(params.get('applies_to') ?? '').trim()
  const policyMode = String(params.get('policy_mode') ?? '').trim()

  if (appliesTo && !isRetentionAppliesTo(appliesTo)) {
    return err(`applies_to must be one of: ${RETENTION_APPLIES_TO.join(', ')}`)
  }
  if (policyMode && !isRetentionPolicyMode(policyMode)) {
    return err(`policy_mode must be one of: ${RETENTION_POLICY_MODES.join(', ')}`)
  }

  let query = (supabase as any)
    .from('retention_policies')
    .select('id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('name')

  if (policyMode) query = query.eq('policy_mode', policyMode)
  if (offset > 0) query = query.range(offset, offset + (limit ?? 1000) - 1)
  else if (limit) query = query.limit(limit)

  const { data, count, error: queryError } = await query
  if (queryError) return err(queryError.message, 500)

  const policies = (data ?? []).filter((policy: any) => {
    if (appliesTo && !(policy.applies_to ?? []).includes(appliesTo)) return false
    if (!search) return true
    return `${policy.name ?? ''} ${policy.description ?? ''}`.toLowerCase().includes(search)
  })

  return ok({ retention_policies: policies, total: count ?? policies.length })
}

export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.edit')
  if (forbidden) return forbidden
  const { tenantId, supabase, actingUserId } = auth

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  if (!name) return err('name is required')

  const policyMode = String(body.policy_mode ?? '').trim()
  if (!isRetentionPolicyMode(policyMode)) {
    return err(`policy_mode must be one of: ${RETENTION_POLICY_MODES.join(', ')}`)
  }

  const parsedScopes = parseRetentionScopes(body.applies_to)
  if (parsedScopes.error) return err(parsedScopes.error)

  const retention = normalizeRetentionPayload({
    policy_mode: policyMode,
    duration_value: body.duration_value,
    duration_unit: body.duration_unit,
    exact_date: body.exact_date,
  })
  if (!retention.ok) return err(retention.error)

  const appliesTo = parsedScopes.scopes?.length ? parsedScopes.scopes : [...RETENTION_APPLIES_TO]
  if (appliesTo.includes('roles') && ['purge_on', 'purge_on_exact_date'].includes(policyMode)) {
    return err('Roles support review-style retention policies only')
  }

  const { data, error: insertError } = await (supabase as any)
    .from('retention_policies')
    .insert({
      tenant_id: tenantId,
      name,
      description: String(body.description ?? '').trim() || null,
      policy_mode: policyMode,
      duration_value: retention.payload?.duration_value ?? null,
      duration_unit: retention.payload?.duration_unit ?? null,
      exact_date: retention.payload?.exact_date ?? null,
      applies_to: appliesTo,
      created_by: actingUserId ?? null,
      updated_by: actingUserId ?? null,
    })
    .select('*')
    .single()

  if (insertError || !data) return err(insertError?.message ?? 'Failed to create retention policy', 500)
  return ok({ retention_policy: data }, 201)
}
