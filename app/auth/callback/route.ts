import { NextResponse } from "next/server"
import { getAuthProvider } from "@/lib/providers/auth"
import { applyOrgOnSignIn } from "@/lib/providers/auth/provisioning"
import { touchUserLastSeen } from "@/lib/last-seen"

/**
 * Supabase Auth redirect target: OAuth sign-in (Google / Microsoft), email
 * confirmation and password-recovery links all land here with a PKCE code,
 * which is exchanged for an httpOnly session cookie. With `org` (from the
 * login page), the user is switched into that organisation or their
 * invitation is accepted. Built-in / OIDC / SAML sign-ins use
 * /auth/sso/<id>/callback and /auth/saml/<id>/acs instead.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url)

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
