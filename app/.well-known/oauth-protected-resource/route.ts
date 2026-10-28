import { NextRequest, NextResponse } from 'next/server'
import { appBaseUrl } from '@/lib/oauth/redirect'
import { OAUTH_SCOPES } from '@/lib/oauth/scopes'
import { OAUTH_CORS_HEADERS } from '@/lib/oauth/errors'

export const dynamic = 'force-dynamic'

/** RFC 9728 protected-resource metadata for the MCP endpoint (public, CORS-open). */
export async function GET(_request: NextRequest) {
  const base = appBaseUrl()
  return NextResponse.json(
    {
      resource: `${base}/api/mcp`,
      authorization_servers: [base],
      scopes_supported: ['mcp', ...OAUTH_SCOPES.filter((s) => s !== 'mcp')],
      bearer_methods_supported: ['header'],
    },
    { headers: { ...OAUTH_CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' } },
  )
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: OAUTH_CORS_HEADERS })
}
