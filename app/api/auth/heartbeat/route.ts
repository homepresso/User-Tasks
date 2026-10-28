import { NextResponse } from 'next/server'
import { getSessionUserFast } from '@/lib/supabase/server'
import { touchUserLastSeen } from '@/lib/last-seen'

export async function POST() {
  try {
    const user = await getSessionUserFast()

    if (!user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await touchUserLastSeen(user.id)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to update last seen' }, { status: 500 })
  }
}
