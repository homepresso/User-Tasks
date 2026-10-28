import { NextResponse } from 'next/server'

/**
 * RFC 6749 error responses. All grant-validation failures collapse to the
 * standard codes with generic descriptions — never reveal WHICH check failed
 * (unknown code vs consumed vs expired vs PKCE mismatch are all
 * `invalid_grant`; unknown client vs wrong secret are both `invalid_client`).
 */

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'server_error'
  | 'invalid_target'
  | 'invalid_client_metadata'

const STATUS: Partial<Record<OAuthErrorCode, number>> = {
  invalid_client: 401,
  server_error: 500,
}

export const OAUTH_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
}

export function oauthError(code: OAuthErrorCode, description?: string): NextResponse {
  const status = STATUS[code] ?? 400
  const headers: Record<string, string> = { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' }
  // RFC 6749 §5.2: 401 invalid_client SHOULD include WWW-Authenticate when
  // the client attempted Authorization-header auth.
  if (code === 'invalid_client') headers['WWW-Authenticate'] = 'Basic realm="oauth", charset="UTF-8"'
  return NextResponse.json(
    { error: code, ...(description ? { error_description: description } : {}) },
    { status, headers },
  )
}

export function oauthJson(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' },
  })
}

export function oauthOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS })
}
