import { NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'

/**
 * Session status for the dashboard shell (lib/dashboard-auth-context): who is
 * signed in, from the httpOnly session cookies. 401 when nobody is. Reading
 * it also keeps a Supabase session's access token fresh (the proxy refreshes
 * it on every request). Sign-in itself happens in server actions
 * (app/actions/auth.ts); the browser never handles tokens.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await getCachedUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ userId: user.id }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Session check failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
