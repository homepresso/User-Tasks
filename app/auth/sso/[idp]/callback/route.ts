import { NextResponse, type NextRequest } from 'next/server'
import { completeOidcCallback, ssoOrigin } from '@/lib/providers/auth/sso/flow'

/**
 * OpenID Connect redirect URI: <APP_URL>/auth/sso/<id>/callback (register it at
 * the IdP). Validates state (single use, bound to this browser), exchanges
 * the code with PKCE, verifies the ID token, then signs the user in with a
 * built-in session (lib/providers/auth/sso).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ idp: string }> }) {
  const { idp } = await params
  const ctx = {
    ip: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    userAgent: request.headers.get('user-agent'),
  }
  const target = await completeOidcCallback(idp, request, ctx)
  return NextResponse.redirect(`${ssoOrigin(request)}${target}`, 303)
}
