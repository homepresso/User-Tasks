import { NextRequest, NextResponse } from 'next/server'
import { checkInvitation } from '@/lib/providers/auth/provisioning'

export async function POST(request: NextRequest) {
  try {
    const { slug, email } = await request.json()

    if (!slug || !email) {
      return NextResponse.json({ error: 'Organisation and email are required' }, { status: 400 })
    }

    const result = await checkInvitation(String(slug), String(email))
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({
      success: true,
      tenantId: result.tenantId,
      tenantName: result.tenantName,
      inviteToken: result.inviteToken,
      role: result.role,
      hasExistingAccess: result.hasExistingAccess,
      existingUserId: result.existingUserId,
    })
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
