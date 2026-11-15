import { NextResponse } from "next/server"
import { getAuthProvider } from "@/lib/providers/auth"
import { applyOrgOnSignIn } from "@/lib/providers/auth/provisioning"
import { touchUserLastSeen } from "@/lib/last-seen"
import { sanitizeRedirect } from "@/lib/safe-redirect"
import { withSsoError } from "@/lib/providers/auth/sso/auto"

/**
 * Supabase Auth redirect target: OAuth sign-in (Google / Microsoft), email
 * confirmation and password-recovery links all land here with a PKCE code,
 * which is exchanged for an httpOnly session cookie. With `org` (from the
 * login page), the user is switched into that organisation or their
 * invitation is accepted. Built-in / OIDC / SAML sign-ins use
 * /auth/sso/<id>/callback and /auth/saml/<id>/acs instead.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url)

  // A passive (prompt=none) sign-in the provider couldn't complete silently
  // (lib/providers/auth/sso/auto.ts): an interactive sign-in at the same
  // provider, or — in a frame — back to the target with ?sso_error=. Only
  // ever starts a non-passive flow, so this can't loop or sign anyone in.
  const passive = /^([a-z0-9_-]{1,40})\.(interactive|return)$/.exec(searchParams.get("sso") ?? "")
  if (passive && searchParams.get("error") && !searchParams.get("code")) {
    const redirect = sanitizeRedirect(searchParams.get("redirect"))
    if (passive[2] === "return") return NextResponse.redirect(`${origin}${withSsoError(redirect, "login_required")}`, 303)
    try {
      const url = await (await getAuthProvider()).startSso(passive[1], { redirect, org: searchParams.get("org"), origin, passive: false })
      return NextResponse.redirect(url, 303)
    } catch {
      return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
    }
  }

  try {
    const provider = await getAuthProvider()
    const { user, redirect, org } = await provider.handleCallback(request)

    if (org) {
      const outcome = await applyOrgOnSignIn(user, org)
      if (outcome === "no_invite") {
        return NextResponse.redirect(`${origin}/login?error=no_invite&org=${encodeURIComponent(org)}`)
      }
    }

    await touchUserLastSeen(user.id)
    return NextResponse.redirect(`${origin}${redirect}`)
  } catch {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }
}
