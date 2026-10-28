import type { NextRequest } from 'next/server'
import { handleScimRequest } from '@/lib/scim/handler'

/**
 * SCIM 2.0 provisioning endpoint (RFC 7643 / 7644) for identity providers —
 * Microsoft Entra ID, Okta, OneLogin, JumpCloud, Keycloak with a SCIM
 * plugin. Tenant URL: <APP_URL>/scim/v2, secret token: a workspace SCIM
 * token. Everything happens in lib/scim/handler.ts.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Context = { params: Promise<{ path?: string[] }> }

async function handle(request: NextRequest, { params }: Context) {
  const { path } = await params
  return handleScimRequest(request, path ?? [])
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
