import { cookies } from 'next/headers'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { touchUserLastSeen } from '@/lib/last-seen'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { startBuiltinSession } from '../builtin'
import { authCookieOptions, ssoFlowCookieOptions, SSO_FLOW_COOKIE_NAMES } from '../cookies'
import { applyOrgOnSignIn } from '../provisioning'
import { AuthError, isAuthError, type AuthRequestContext } from '../types'
import { resolveExternalAccount } from './accounts'
import { flowOf, isInteractionRequired, withFlow, withSsoError, type SsoFlowMeta } from './auto'
import { getSsoProvider } from './config'
import { finishOidc } from './oidc'
import { finishSaml } from './saml'

/**
 * Completes an SSO sign-in (OIDC callback / SAML ACS): validate the IdP's
 * response, find or provision the account, start a built-in session, then
 * apply the organisation the user chose on the login page. Returns where to
 * send the browser: a local path, or — when a passive (automatic) attempt
 * needs interaction and the flow's fallback is interactive — the IdP's
 * sign-in URL for a new, non-passive flow (./auto.ts). Failures map to
 * /login?error=… with a fixed message (details are logged, never reflected);
 * flows with the `return` fallback (frames, which can't show /login) go back
 * to their target with ?sso_error=<code> instead.
 */

export function ssoOrigin(request: Request): string {
  return (configuredAppUrl()?.trim() || new URL(request.url).origin).replace(/\/+$/, '')
}

/** Absolute URL for a completion target: local paths on our origin, IdP URLs (an interactive restart) as they are. */
export function completionUrl(origin: string, target: string): string {
  return target.startsWith('/') ? `${origin}${target}` : target
}

async function finish(
  result: { identity: Parameters<typeof resolveExternalAccount>[0]; redirect: string; org: string | null; flow: SsoFlowMeta | null },
  method: string,
  ctx: AuthRequestContext,
): Promise<string> {
  try {
    const { user } = await resolveExternalAccount(result.identity)
    await startBuiltinSession(user.id, method, ctx)
    if (result.org) {
      const outcome = await applyOrgOnSignIn(user, result.org)
      if (outcome === 'no_invite') {
        return result.flow?.fallback === 'return'
          ? withSsoError(sanitizeRedirect(result.redirect), 'no_invite')
          : `/login?error=no_invite&org=${encodeURIComponent(result.org)}`
      }
    }
    await touchUserLastSeen(user.id).catch(() => undefined)
    return sanitizeRedirect(result.redirect)
  } catch (error) {
    throw withFlow(error, result.flow)
  }
}

async function failure(error: unknown, idpId: string, origin: string): Promise<string> {
  // A passive attempt the IdP couldn't complete silently: follow the flow's fallback.
  if (isInteractionRequired(error)) {
    const flow = error.flow
    if (flow.fallback === 'return') return withSsoError(sanitizeRedirect(flow.redirect), 'login_required')
    try {
      const { getAuthProvider } = await import('@/lib/providers/auth')
      return await (await getAuthProvider()).startSso(flow.idp, {
        redirect: sanitizeRedirect(flow.redirect), org: flow.org, origin, passive: false, loginHint: flow.loginHint,
      })
    } catch (restart) {
      console.warn(`[auth] SSO via "${idpId}": interactive sign-in after a passive attempt could not start: ${(restart as Error)?.message ?? restart}`)
      return '/login?error=sso_failed'
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[auth] SSO sign-in via "${idpId}" failed: ${message}`)
  const code = isAuthError(error) && error.code === 'not_supported' ? 'sso_unavailable' : 'sso_failed'
  const flow = flowOf(error)
  if (flow?.fallback === 'return') return withSsoError(sanitizeRedirect(flow.redirect), code)
  return `/login?error=${code}`
}

export async function completeOidcCallback(idpId: string, request: Request, ctx: AuthRequestContext): Promise<string> {
  try {
    const idp = await getSsoProvider(idpId)
    if (!idp || idp.type !== 'oidc') throw new AuthError('not_supported', `Unknown OIDC provider "${idpId}"`)
    const store = await cookies()
    const binding = SSO_FLOW_COOKIE_NAMES.map((n) => store.get(n)?.value).find(Boolean) ?? null
    for (const name of SSO_FLOW_COOKIE_NAMES) {
      // Cleared with SameSite=None when Secure, so a frame flow's cookie (set None) goes too.
      if (store.get(name)) store.set(name, '', { ...ssoFlowCookieOptions(true, 0), secure: name.startsWith('__Host-') || authCookieOptions().secure })
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
    return failure(error, idpId, ssoOrigin(request))
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
    return failure(error, idpId, ssoOrigin(request))
  }
}
