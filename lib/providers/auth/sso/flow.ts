import { cookies } from 'next/headers'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { touchUserLastSeen } from '@/lib/last-seen'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { startBuiltinSession } from '../builtin'
import { authCookieOptions, SSO_FLOW_COOKIE_NAMES } from '../cookies'
import { applyOrgOnSignIn } from '../provisioning'
import { AuthError, isAuthError, type AuthRequestContext } from '../types'
import { resolveExternalAccount } from './accounts'
import { getSsoProvider } from './config'
import { finishOidc } from './oidc'
import { finishSaml } from './saml'

/**
 * Completes an SSO sign-in (OIDC callback / SAML ACS): validate the IdP's
 * response, find or provision the account, start a built-in session, then
 * apply the organisation the user chose on the login page. Returns the local
 * path to send the browser to. Failures map to /login?error=… with a fixed
 * message (details are logged, never reflected).
 */

export function ssoOrigin(request: Request): string {
  return (configuredAppUrl()?.trim() || new URL(request.url).origin).replace(/\/+$/, '')
}

async function finish(
  result: { identity: Parameters<typeof resolveExternalAccount>[0]; redirect: string; org: string | null },
  method: string,
  ctx: AuthRequestContext,
): Promise<string> {
  const { user } = await resolveExternalAccount(result.identity)
  await startBuiltinSession(user.id, method, ctx)
  if (result.org) {
    const outcome = await applyOrgOnSignIn(user, result.org)
    if (outcome === 'no_invite') return `/login?error=no_invite&org=${encodeURIComponent(result.org)}`
  }
  await touchUserLastSeen(user.id).catch(() => undefined)
  return sanitizeRedirect(result.redirect)
}

function failure(error: unknown, idpId: string): string {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[auth] SSO sign-in via "${idpId}" failed: ${message}`)
  return isAuthError(error) && error.code === 'not_supported' ? '/login?error=sso_unavailable' : '/login?error=sso_failed'
}

export async function completeOidcCallback(idpId: string, request: Request, ctx: AuthRequestContext): Promise<string> {
  try {
    const idp = await getSsoProvider(idpId)
    if (!idp || idp.type !== 'oidc') throw new AuthError('not_supported', `Unknown OIDC provider "${idpId}"`)
    const store = await cookies()
    const binding = SSO_FLOW_COOKIE_NAMES.map((n) => store.get(n)?.value).find(Boolean) ?? null
    for (const name of SSO_FLOW_COOKIE_NAMES) {
      if (store.get(name)) store.set(name, '', { ...authCookieOptions(0), secure: name.startsWith('__Host-') || authCookieOptions().secure })
    }
    const params = new URL(request.url).searchParams
    const result = await finishOidc(idp, {
      state: params.get('state'),
      code: params.get('code'),
      error: params.get('error'),
      errorDescription: params.get('error_description'),
      binding,
      origin: ssoOrigin(request),
    })
    return await finish(result, `oidc:${idp.id}`, ctx)
  } catch (error) {
    return failure(error, idpId)
  }
}

export async function completeSamlResponse(
  idpId: string,
  body: { SAMLResponse?: string | null; RelayState?: string | null },
  request: Request,
  ctx: AuthRequestContext,
): Promise<string> {
  try {
    const idp = await getSsoProvider(idpId)
    if (!idp || idp.type !== 'saml') throw new AuthError('not_supported', `Unknown SAML provider "${idpId}"`)
    const result = await finishSaml(idp, body, ssoOrigin(request))
    return await finish(result, `saml:${idp.id}`, ctx)
  } catch (error) {
    return failure(error, idpId)
  }
}
