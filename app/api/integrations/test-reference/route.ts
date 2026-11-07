import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { executeReference } from '@/lib/reference-executor'
import { getCurrentTenantId, getOwnedReference } from '@/lib/integrations/auth'
import { getUserPermissions } from '@/lib/permissions-server'
import { isWriteReference } from '@/lib/custom-references/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Executing a reference makes an authenticated call with the integration's
  // credentials — the same permission as the API / MCP reference execute.
  const perms = await getUserPermissions()
  if (!perms.has('integrations.test') && !perms.has('integrations.edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { reference_id, inputs, capture_schema, confirm_write } = body
  const tenantId = await getCurrentTenantId(supabase, user.id)

  // New path: use shared executor with reference_id + inputs
  if (reference_id) {
    try {
      const owned: any = await getOwnedReference(supabase, tenantId, reference_id, 'id, tenant_id, integration_id, request_config')
      // A write reference changes real data: its Test runs only after an explicit confirmation.
      if (isWriteReference(owned) && confirm_write !== true) {
        return NextResponse.json({ error: 'This reference writes data — confirm to run it for real', code: 'confirm_write' }, { status: 409 })
      }
      const result = await executeReference({
        supabase,
        referenceId: reference_id,
        inputValues: inputs ?? {},
        timeout: 30000,
        caller: { traceId: '', callerType: 'manual_test', callerId: user.id },
        expectedTenantId: tenantId,
      })
      // capture_schema: true folds the response into the reference's model;
      // "auto" only when the model is missing or sample-inferred (first test
      // backfills older references). Needs manage_references; never fails the test.
      if (capture_schema && (result.status ?? 200) < 400 && result.data !== undefined && result.data !== null) {
        try {
          const { fromSession } = await import('@/lib/services/context')
          const { captureReferenceSchema } = await import('@/lib/services/references')
          const responseSchema = await captureReferenceSchema(await fromSession(), reference_id, result.data, { onlyIfInferred: capture_schema === 'auto' })
          return NextResponse.json({ ...result, response_schema: responseSchema })
        } catch {
          // No permission or the write failed — the test result still stands.
        }
      }
      return NextResponse.json(result)
    } catch (e: any) {
      const message = e.message ?? 'Execution failed'
      const status = message === 'Reference not found' ? 404 : 500
      return NextResponse.json({ error: message }, { status })
    }
  }

  // The legacy { url, integration_id } form (send an integration's credentials
  // to any URL) is gone: references are tested by id only.
  return NextResponse.json({ error: 'reference_id required' }, { status: 400 })
}
