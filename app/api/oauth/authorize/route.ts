import { NextRequest, NextResponse } from 'next/server'
import { getServiceDb } from '@/lib/providers/db'
import { getCachedUser } from '@/lib/supabase/server'
import { parseScopeParam, requestsFirstPartyScope, scopesAllowed } from '@/lib/oauth/scopes'
import { isAllowedRedirect, appBaseUrl } from '@/lib/oauth/redirect'
import { buildClientRedirect, createConsentRequest, resolveConsentTenant } from '@/lib/oauth/provider'

export const dynamic = 'force-dynamic'

function service() {
  return getServiceDb()
}

/**
 * Render an error WITHOUT redirecting — used when the client or redirect_uri
 * is untrustworthy (open-redirect prevention). Only once the redirect_uri is
 * validated against the allowlist do we ever redirect an error back.
 */
function errorPage(message: string, status = 400): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Authorization error</title></head>`
    + `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">`
    + `<h1 style="font-size:1.25rem">Authorization error</h1>`
    + `<p style="color:#555">${message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))}</p>`
    + `</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const responseType = params.get('response_type')
  const clientId = params.get('client_id') ?? ''
  const redirectUri = params.get('redirect_uri') ?? ''
  const state = params.get('state')
  const codeChallenge = params.get('code_challenge') ?? ''
  const codeChallengeMethod = params.get('code_challenge_method') ?? ''
  const resource = params.get('resource')

  const supabase = service()

  // 1. Client must exist, not be revoked, and support authorization_code.
  //    `*` rather than a column list so a server whose database predates
  //    is_first_party keeps authorizing (it then simply has no first-party clients).
  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client || client.revoked_at) return errorPage('Unknown or revoked client.')
  if (!(Array.isArray(client.grant_types) && client.grant_types.includes('authorization_code'))) {
    return errorPage('This client is not permitted to use the authorization code flow.')
  }

  const isFirstParty = client.is_first_party === true && !client.is_dynamic

  // 2. redirect_uri match (exact, or any port for a registered http loopback
  //    URI — RFC 8252) — before any redirect happens.
  if (!isAllowedRedirect(client.redirect_uris ?? [], redirectUri)) {
    return errorPage('The redirect_uri does not match a registered URI for this client.')
  }

  // 3. RFC 8707 resource, if present, must name our API/MCP surface.
  if (resource) {
    const base = appBaseUrl()
    if (resource !== base && !resource.startsWith(`${base}/api/`)) {
      return NextResponse.redirect(buildClientRedirect(redirectUri, { error: 'invalid_target', state }))
    }
  }

  // From here, validation errors CAN redirect back to the (validated) client.
  const back = (error: string, description?: string) =>
    NextResponse.redirect(buildClientRedirect(redirectUri, {
      error, ...(description ? { error_description: description } : {}), state,
    }))

  if (responseType !== 'code') return back('unsupported_response_type')
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return back('invalid_request', 'PKCE with S256 is required')
  }

  const requestedScopes = parseScopeParam(params.get('scope'))
  if (requestedScopes.length === 0) return back('invalid_scope')
  if (!scopesAllowed(requestedScopes, client.allowed_scopes ?? [])) return back('invalid_scope')
  // Public/dynamic clients may never obtain admin scope.
  if (requestedScopes.includes('admin') && (client.client_type !== 'confidential')) {
    return back('invalid_scope', 'admin scope is not available to this client')
  }
  // keys:write (minting API keys) is reserved for first-party clients, even
  // if a row's allowed_scopes somehow lists it.
  if (requestsFirstPartyScope(requestedScopes) && !isFirstParty) {
    return back('invalid_scope', 'keys:write is only available to first-party clients')
  }

  // 4. Authenticate the user (cookie session). If none, bounce to login and
  //    return here afterwards.
  const user = await getCachedUser()
  if (!user) {
    const returnTo = `/api/oauth/authorize?${params.toString()}`
    return NextResponse.redirect(`${appBaseUrl()}/login?redirect=${encodeURIComponent(returnTo)}`)
  }

  // 5. Resolve + authorize the tenant this consent binds to.
  const tenantId = await resolveConsentTenant(supabase, client, user.id)
  if (!tenantId) {
    return back('access_denied', 'You are not a member of this application’s workspace')
  }

  // 6. Stash the validated request server-side; hand the consent page an
  //    opaque id only.
  const requestId = await createConsentRequest(supabase, user.id, {
    client_id: client.client_id,
    client_name: client.name,
    client_first_party: isFirstParty,
    client_dynamic: client.is_dynamic === true,
    redirect_uri: redirectUri,
    scopes: requestedScopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    tenant_id: tenantId,
    resource,
  })

  return NextResponse.redirect(`${appBaseUrl()}/oauth/consent?request=${encodeURIComponent(requestId)}`)
}
