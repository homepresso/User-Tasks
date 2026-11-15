import { NextResponse, type NextRequest } from 'next/server'
import { getAuthProvider } from '@/lib/providers/auth'
import { ssoOrigin } from '@/lib/providers/auth/sso/flow'
import { cleanLoginHint, cleanOrgHint, LAUNCH_ORG_PARAM, withSsoError, type AutoSsoMode } from '@/lib/providers/auth/sso/auto'
import { resolveAutoSso } from '@/lib/providers/auth/sso/auto-server'
import { sanitizeRedirect } from '@/lib/safe-redirect'

/**
 * Automatic sign-in (lib/providers/auth/sso/auto.ts): start a passive SSO
 * round trip with the workspace's identity provider, coming back to
 * `?redirect=` (a local path) signed in — no UserTasks sign-in page.
 *
 *   ?redirect=  where to go afterwards (local paths only)
 *   ?org=       the workspace (slug); default: the address / the only one
 *   ?mode=      top (default) — a failed passive attempt continues with the
 *               IdP's interactive sign-in; popup — the same, in a popup the
 *               page opened; frame — inside a frame, where IdP pages can't
 *               show: a failed attempt returns to `redirect` with
 *               ?sso_error=<code> (the page then offers the popup)
 *   ?for=login  the sign-in page sent us (SSO only); otherwise a launch
 *   ?login_hint passed to the IdP's account picker (never an identity)
 *
 * Nothing here decides who signs in: only the IdP's signed answer, checked
 * by the callback, does. Without an applicable IdP (no SSO, the workspace
 * turned automatic sign-in off) → the normal sign-in page.
 */
export const dynamic = 'force-dynamic'

function redirectTo(url: string): NextResponse {
  const response = NextResponse.redirect(url, 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request: NextRequest) {
  const origin = ssoOrigin(request)
  const search = request.nextUrl.searchParams
  const target = sanitizeRedirect(search.get('redirect'))
  const requested = search.get('mode')
  const framed = ['iframe', 'frame'].includes((request.headers.get('sec-fetch-dest') ?? '').toLowerCase())
  const mode: AutoSsoMode = requested === 'popup' ? 'popup' : requested === 'frame' || framed ? 'frame' : 'top'
  // The workspace: ?org=, else the launch hint inside the target (…?ut_org=<slug>, ctx.launchUrl).
  const orgHint = cleanOrgHint(search.get('org')) ?? cleanOrgHint(new URL(target, 'http://local.invalid').searchParams.get(LAUNCH_ORG_PARAM))
  const purpose = search.get('for') === 'login' ? 'login' : 'launch'
  const loginPage = `${origin}/login?redirect=${encodeURIComponent(target)}${orgHint ? `&org=${encodeURIComponent(orgHint)}` : ''}${purpose === 'login' ? '&local=1' : ''}`

  // Already signed in (top-level and popups: a framed request here carries no session — the proxy strips it).
  if (mode !== 'frame') {
    const user = await (await getAuthProvider()).getSessionUser().catch(() => null)
    if (user) return redirectTo(`${origin}${target}`)
  }

  const auto = await resolveAutoSso({ org: orgHint, purpose })
  if (!auto) return redirectTo(mode === 'frame' ? `${origin}${withSsoError(target, 'not_configured')}` : loginPage)

  try {
    const url = await (await getAuthProvider()).startSso(auto.idpId, {
      redirect: target,
      org: auto.org,
      origin,
      passive: true,
      fallback: mode === 'frame' ? 'return' : 'interactive',
      loginHint: cleanLoginHint(search.get('login_hint')),
      frame: mode === 'frame',
    })
    return redirectTo(url)
  } catch (error) {
    console.warn(`[auth] automatic sign-in via "${auto.idpId}" could not start: ${(error as Error)?.message ?? error}`)
    return redirectTo(mode === 'frame' ? `${origin}${withSsoError(target, 'sso_unavailable')}` : `${origin}/login?error=sso_unavailable`)
  }
}
