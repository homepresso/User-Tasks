import { NextResponse, type NextRequest } from 'next/server'
import { completeSamlResponse, ssoOrigin } from '@/lib/providers/auth/sso/flow'

/**
 * SAML Assertion Consumer Service (HTTP-POST binding):
 * <APP_URL>/auth/saml/<id>/acs. The IdP's form post is cross-site by design,
 * so this route takes no cookies as proof: the signed assertion (audience,
 * conditions, InResponseTo for SP-initiated sign-ins, one-time assertion id)
 * is the proof. Answers with a 303 so the browser follows with a GET.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ idp: string }> }) {
  const { idp } = await params
  const origin = ssoOrigin(request)
  let body: { SAMLResponse: string | null; RelayState: string | null }
  try {
    const form = await request.formData()
    body = { SAMLResponse: form.get('SAMLResponse')?.toString() ?? null, RelayState: form.get('RelayState')?.toString() ?? null }
  } catch {
    return NextResponse.redirect(`${origin}/login?error=sso_failed`, 303)
  }
  const ctx = {
    ip: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
    userAgent: request.headers.get('user-agent'),
  }
  const target = await completeSamlResponse(idp, body, request, ctx)
  return NextResponse.redirect(`${origin}${target}`, 303)
}
