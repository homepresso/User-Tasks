import { redirect } from 'next/navigation'
import { PublicThemeReset } from '@/components/layout/public-theme-reset'
import { FormSignInScreen } from '@/components/forms/sign-in/form-sign-in-screen'
import { formLinkUser, formLinkVisitor } from '@/lib/forms/form-link-visitor'
import { EMBED_PARAM } from '@/lib/forms/embed'
import {
  appOfReturnPath, cleanOrgSlug, formIdOfReturnPath, returnPathKind, sanitizeSignInReturnPath, settingsForApp, signInErrorMessage,
  usesWorkspaceSignIn,
} from '@/lib/forms/sign-in-page'
import { signInThemeStyle } from '@/lib/forms/sign-in-theme'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { authCookieSecure } from '@/lib/providers/auth/cookies'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { apexOrigin, baseDomainFromEnv, canShareCookies, workspaceHopPath } from '@/lib/workspace-address'
import { loginUrlFor } from '@/lib/workspace-host'
import type { LoginOptions } from '@/lib/providers/auth/types'

/**
 * The workspace sign-in page for forms and apps, served at /sign-in (apps)
 * and /form-login (form links; the older address, kept for existing links
 * and embeds): ?redirect=<form or app path>[&org=<workspace>][&embed=1], on
 * the host the link is on (a workspace address or the main one).
 *
 *  - The workspace: the address's, else the /f/<id> form's, else the
 *    ?org= hint (friendly app links on the main address). None of them: the
 *    default design with an Organisation field (form links), or the
 *    standard /login (apps — as before the page was shared).
 *  - Turned off for this kind of link (use_for_forms / use_for_apps, or the
 *    app's own choice): straight on to the standard /login, same return path.
 *  - `redirect` must be a form link or an app path on this host
 *    (sanitizeSignInReturnPath); anything else is ignored, so this page can't
 *    be used as an open redirect.
 *  - Already signed in (top level): straight back.
 *  - Embedded in another site: "Open … in a new tab" (no sign-in in
 *    third-party frames).
 */

const FALLBACK: LoginOptions = { provider: 'supabase', password: true, sso: [] }

export type SignInQuery = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The path without ?embed=1 (Open in a new tab opens the full page). */
function withoutEmbed(path: string): string {
  const [pathname, search = ''] = path.split('?')
  const params = new URLSearchParams(search)
  params.delete(EMBED_PARAM)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** The standard UserTasks sign-in, back to `path` afterwards. */
function standardLogin(hostTenant: { subdomain: string; slug: string } | null, path: string | null, org: string | null): string {
  if (hostTenant) return loginUrlFor(hostTenant, path ?? '/home')
  const params = new URLSearchParams()
  if (path) params.set('redirect', path)
  if (org) params.set('org', org)
  const qs = params.toString()
  return qs ? `/login?${qs}` : '/login'
}

export async function signInRoute(query: SignInQuery) {
  const returnPath = sanitizeSignInReturnPath(first(query.redirect))
  const kind = returnPathKind(returnPath)
  const app = kind === 'app' ? appOfReturnPath(returnPath) : null
  const visitor = await formLinkVisitor(query)
  const { host } = visitor
  const user = host.kind === 'non_member' ? null : await formLinkUser(visitor)
  if (host.kind === 'non_member' && visitor.frame !== 'cross-origin-frame') redirect('/no-access')
  if (user && returnPath && !visitor.embed) redirect(returnPath)

  const hostTenant = host.kind === 'member' || host.kind === 'signed_out' || host.kind === 'non_member' ? host.tenant : null
  const svc = await import('@/lib/services/form-sign-in-page')
  const formId = formIdOfReturnPath(returnPath)
  const orgHint = hostTenant ? null : cleanOrgSlug(first(query.org))
  const hinted = !hostTenant && !formId && orgHint ? await svc.tenantBySlug(orgHint) : null
  const tenantId = hostTenant?.id ?? (formId ? await svc.tenantOfForm(formId) : null) ?? hinted?.id ?? null
  const topLevel = visitor.frame !== 'cross-origin-frame'

  // An app on the main address with no workspace named: the standard sign-in, as before.
  if (kind === 'app' && !tenantId && topLevel) redirect(standardLogin(null, returnPath, orgHint))

  const [page, options] = await Promise.all([
    svc.loadPublicSignInPage(tenantId, app ? { appSlug: app.slug } : {}),
    import('@/app/actions/auth').then((m) => m.getLoginOptions()).catch((error) => {
      console.error('[auth] login options unavailable:', (error as Error).message)
      return FALLBACK
    }),
  ])

  // Turned off for this kind of link (or by the app): the standard sign-in.
  if (tenantId && topLevel && !usesWorkspaceSignIn(page.settings, kind, page.app?.choice ?? null)) {
    redirect(standardLogin(hostTenant, returnPath, hostTenant ? null : (page.workspace?.slug || orgHint)))
  }

  let settings = kind === 'app' ? settingsForApp(page.settings) : page.settings
  // The app's own colour as the accent, when the workspace asks for it.
  if (kind === 'app' && settings.use_app_color && !settings.use_workspace_theme && page.app?.color) settings = { ...settings, accent_color: page.app.color }

  // SSO callbacks live on the main address; with shared sessions a workspace address starts SSO there and hops back.
  const base = baseDomainFromEnv()
  const back = returnPath ?? '/home'
  const ssoStart = hostTenant && base && canShareCookies(base, authCookieSecure())
    ? { base: apexOrigin(base, configuredAppUrl()), redirect: workspaceHopPath(hostTenant.subdomain, back) }
    : null

  return (
    <>
      <PublicThemeReset />
      <FormSignInScreen
        settings={settings}
        logoUrl={settings.logo_url ? resolveStorageUrl(settings.logo_url) : null}
        workspace={page.workspace}
        themeStyle={signInThemeStyle(settings, page.theme)}
        options={options}
        returnPath={back}
        ssoStart={ssoStart}
        openUrl={returnPath ? withoutEmbed(returnPath) : '/home'}
        embed={visitor.embed}
        target={kind === 'app' ? 'app' : 'form'}
        error={signInErrorMessage(first(query.error))}
      />
    </>
  )
}
