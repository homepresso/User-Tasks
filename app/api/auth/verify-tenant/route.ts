import { NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { joinInvitedTenant } from '@/lib/providers/auth/provisioning'

export async function POST(request: NextRequest) {
  try {
    const { slug, inviteToken } = await request.json()

    if (!slug || typeof slug !== 'string' || slug.length > 100) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Identity comes from the verified session — NEVER from the request body.
    // Trusting body-supplied userId/email allowed anyone who knew an invited
    // email to join that tenant with the invited role.
    const user = await getCachedUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await joinInvitedTenant(user, slug, typeof inviteToken === 'string' ? inviteToken : null)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ success: true, tenantId: result.tenantId })
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
