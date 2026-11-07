import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { assignRetentionPolicy } from '@/lib/services/retention'

/**
 * POST /api/v1/retention-policies/assign — assign (or clear) the retention
 * policy on a data table, row, role or form (lib/services/retention: scope
 * and purge-on-role checks, audit).
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'settings.edit')
  if (forbidden) return forbidden

  const body = await request.json().catch(() => ({}))
  try {
    return ok(await assignRetentionPolicy(fromApiAuth(auth), {
      targetType: String(body?.target_type ?? ''),
      targetId: String(body?.target_id ?? ''),
      retentionPolicyId: body?.retention_policy_id ?? null,
    }))
  } catch (error) {
    if (isServiceError(error)) return err(error.message, error.status)
    return err('Failed to update retention assignment', 500)
  }
}
