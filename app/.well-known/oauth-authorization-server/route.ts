import { NextRequest, NextResponse } from 'next/server'
import { getServiceDb, hasServiceDb } from '@/lib/providers/db'
import { appBaseUrl } from '@/lib/oauth/redirect'
import { OAUTH_SCOPES } from '@/lib/oauth/scopes'
import { OAUTH_CORS_HEADERS } from '@/lib/oauth/errors'
import { USERTASKS_CLI_CLIENT_ID } from '@/lib/oauth/first-party'

export const dynamic = 'force-dynamic'

/**
 * The CLI's client id, only when the seeded first-party client exists and is
 * not revoked — otherwise the CLI falls back to dynamic registration.
 */
async function cliClientId(): Promise<string | null> {
  if (!hasServiceDb()) return null
  try {
    const { data, error } = await getServiceDb()
      .from('oauth_clients')
      .select('client_id')
      .eq('client_id', USERTASKS_CLI_CLIENT_ID)
      .eq('is_first_party', true)
      .is('revoked_at', null)
      .maybeSingle()
    return !error && data ? USERTASKS_CLI_CLIENT_ID : null
  } catch {
    return null
  }
}

/** RFC 8414 authorization-server metadata (public; CORS-open for MCP clients). */
export async function GET(_request: NextRequest) {
  const base = appBaseUrl()
  const cliId = await cliClientId()
  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      scopes_supported: OAUTH_SCOPES,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'client_credentials', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
      ...(cliId ? { usertasks_cli_client_id: cliId } : {}),
    },
    { headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } },
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS })
}
