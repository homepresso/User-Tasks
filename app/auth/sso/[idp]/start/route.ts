import { NextResponse, type NextRequest } from 'next/server'
import { getAuthProvider } from '@/lib/providers/auth'
import { ssoOrigin } from '@/lib/providers/auth/sso/flow'
import { sanitizeRedirect } from '@/lib/safe-redirect'

/**
 * Starts an SSO sign-in with IdP `<id>` and redirects there — a bookmarkable
 * entry point for IdP app tiles / portals (the login page uses the
 * startSsoAction server action). `?redirect=` (local paths only) and `?org=`
 * work as on the login page.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ idp: string }> }) {
  const { idp } = await params
  const origin = ssoOrigin(request)
  const search = request.nextUrl.searchParams
  try {
    const url = await (await getAuthProvider()).startSso(idp, {
      redirect: sanitizeRedirect(search.get('redirect')),
      org: search.get('org')?.trim().toLowerCase() || null,
      origin,
    })
    return NextResponse.redirect(url, 303)
  } catch (error) {
    console.warn(`[auth] could not start SSO via "${idp}": ${(error as Error).message}`)
    return NextResponse.redirect(`${origin}/login?error=sso_unavailable`, 303)
  }
}
