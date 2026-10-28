import { NextRequest } from 'next/server'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import {
  RETENTION_APPLIES_TO,
  RETENTION_POLICY_MODES,
  isRetentionPolicyMode,
  normalizeRetentionPayload,
  parseRetentionScopes,
  getRetentionPolicyUsageSummary,
} from '@/lib/retention-policy-api'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.view')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data, error: queryError } = await (supabase as any)
    .from('retention_policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()

  if (queryError || !data) return err(queryError?.message ?? 'Retention policy not found', 404)
  return ok({ retention_policy: data })
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.edit')
  if (forbidden) return forbidden
  const { tenantId, supabase, actingUserId } = auth
  const { id } = await params

  const { data: existing, error: existingError } = await (supabase as any)
    .from('retention_policies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()
  if (existingError || !existing) return err(existingError?.message ?? 'Retention policy not found', 404)

  // The GET response (`{ retention_policy: {...} }`) is accepted as the body too.
  const body = prepareRoundTripBody(undefined, { unwrap: 'retention_policy' }, await request.json()) as Record<string, any>
  const nextPolicyMode = body.policy_mode !== undefined ? String(body.policy_mode ?? '').trim() : String(existing.policy_mode ?? '')
  if (!isRetentionPolicyMode(nextPolicyMode)) {
    return err(`policy_mode must be one of: ${RETENTION_POLICY_MODES.join(', ')}`)
  }

  const parsedScopes = parseRetentionScopes(body.applies_to)
  if (parsedScopes.error) return err(parsedScopes.error)
  const appliesTo = parsedScopes.scopes?.length
    ? parsedScopes.scopes
    : Array.isArray(existing.applies_to) && existing.applies_to.length
      ? existing.applies_to
      : [...RETENTION_APPLIES_TO]

  const retention = normalizeRetentionPayload({
    policy_mode: nextPolicyMode,
    duration_value: body.duration_value ?? existing.duration_value ?? undefined,
    duration_unit: body.duration_unit ?? existing.duration_unit ?? undefined,
    exact_date: body.exact_date ?? existing.exact_date ?? undefined,
  })
  if (!retention.ok) return err(retention.error)

  if (appliesTo.includes('roles') && ['purge_on', 'purge_on_exact_date'].includes(nextPolicyMode)) {
    return err('Roles support review-style retention policies only')
  }

  const name = body.name !== undefined ? String(body.name ?? '').trim() : String(existing.name ?? '').trim()
  if (!name) return err('name is required')

  const { data, error: updateError } = await (supabase as any)
    .from('retention_policies')
    .update({
      name,
      description: body.description !== undefined ? (String(body.description ?? '').trim() || null) : existing.description,
      policy_mode: nextPolicyMode,
      duration_value: retention.payload?.duration_value ?? null,
      duration_unit: retention.payload?.duration_unit ?? null,
      exact_date: retention.payload?.exact_date ?? null,
      applies_to: appliesTo,
      updated_by: actingUserId ?? existing.updated_by ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select('*')
    .single()

  if (updateError || !data) return err(updateError?.message ?? 'Failed to update retention policy', 500)
  return ok({ retention_policy: data })
}

/** PATCH is the same partial update as PUT. */
export const PATCH = PUT

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.edit')
  if (forbidden) return forbidden
  const { tenantId, supabase } = auth
  const { id } = await params

  const { data: existing, error: existingError } = await (supabase as any)
    .from('retention_policies')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .single()
  if (existingError || !existing) return err(existingError?.message ?? 'Retention policy not found', 404)

  const usage = await getRetentionPolicyUsageSummary(supabase, tenantId, id)
  const totalUsage = Object.values(usage).reduce((sum, value) => sum + Number(value ?? 0), 0)
  if (totalUsage > 0) {
    return err(`Remove this policy from all assigned assets before deleting it. Current usage: ${JSON.stringify(usage)}`)
  }

  const { error: deleteError } = await (supabase as any)
    .from('retention_policies')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (deleteError) return err(deleteError.message, 500)
  return ok({ deleted: true, retention_policy_id: id, retention_policy_name: existing.name })
}
