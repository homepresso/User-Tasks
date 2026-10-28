import { NextRequest, NextResponse } from 'next/server'
import { fromSession, isServiceError } from '@/lib/services/context'
import { completeOnboarding } from '@/lib/services/tenant-settings'

/**
 * First-run workspace setup (components/onboarding/tenant-onboarding.tsx).
 * Acts on the caller's current workspace and requires `settings.edit`, like
 * any other workspace rename — it used to accept any member of the tenant.
 */
export async function POST(request: NextRequest) {
  let ctx
  try {
    ctx = await fromSession()
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.code === 'unauthorized' ? 'Unauthorized' : error.message }, { status: error.status })
    throw error
  }

  const body = await request.json().catch(() => ({}))
  const { tenant_id, name, slug, contact_name, contact_email, industry, company_size } = body ?? {}

  if (!tenant_id || !name || !slug) {
    return NextResponse.json({ error: 'name and slug are required' }, { status: 400 })
  }
  if (tenant_id !== ctx.tenantId) return NextResponse.json({ error: 'Not your tenant' }, { status: 403 })

  try {
    const result = await completeOnboarding(ctx, { name, slug, contact_name, contact_email, industry, company_size })
    return NextResponse.json({ success: true, slug: result.slug })
  } catch (error) {
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[onboarding]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to complete setup' }, { status: 500 })
  }
}
