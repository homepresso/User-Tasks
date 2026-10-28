import { NextRequest, NextResponse } from 'next/server'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { executeReference } from '@/lib/reference-executor'
import { getCurrentTenantId, getOwnedReference } from '@/lib/integrations/auth'
import { createServiceClient, isAuthorizedServiceCall } from '@/lib/cron-auth'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const referenceId = body?.referenceId
  const inputs = body?.inputs
  if (!referenceId) return NextResponse.json({ error: 'referenceId is required' }, { status: 400 })

  // Processor path — trusted server-to-server call from the agent executor.
  // tenant_id / acting_user_id are trusted ONLY because the processor secret verified.
  if (isAuthorizedServiceCall(request)) {
    const tenantId = String(body?.tenant_id ?? '').trim()
    if (!tenantId) return NextResponse.json({ error: 'tenant_id is required for processor calls' }, { status: 400 })
    const actingUserId = String(body?.acting_user_id ?? '').trim() || null
    const supabase = createServiceClient()
    try {
      // Verify the reference belongs to the resolved tenant before executing.
      await getOwnedReference(supabase, tenantId, referenceId)
      const result = await executeReference({
        supabase,
        referenceId,
        inputValues: inputs ?? {},
        timeout: 30000,
        caller: { traceId: '', callerType: 'api', callerId: actingUserId },
        expectedTenantId: tenantId,
      })
      return NextResponse.json(result)
    } catch (e: any) {
      const message = e.message ?? 'Execution failed'
      const status = message === 'Reference not found' ? 404 : 500
      return NextResponse.json({ error: message }, { status })
    }
  }

  // Session path — authenticated browser user.
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const tenantId = await getCurrentTenantId(supabase, user.id)
    await getOwnedReference(supabase, tenantId, referenceId)
    const result = await executeReference({
      supabase,
      referenceId,
      inputValues: inputs ?? {},
      timeout: 30000,
      caller: { traceId: '', callerType: 'api', callerId: user.id },
      expectedTenantId: tenantId,
    })
    return NextResponse.json(result)
  } catch (e: any) {
    const message = e.message ?? 'Execution failed'
    const status = message === 'Reference not found' ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
