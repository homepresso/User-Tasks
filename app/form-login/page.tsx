import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PublicThemeReset } from '@/components/layout/public-theme-reset'
import { FormSignInScreen } from '@/components/forms/sign-in/form-sign-in-screen'
import { signInErrorMessage } from '@/lib/forms/sign-in-page'
import { signInThemeStyle } from '@/lib/forms/sign-in-theme'
import { formLinkUser, formLinkVisitor } from '@/lib/forms/form-link-visitor'
import { EMBED_PARAM } from '@/lib/forms/embed'
import { formIdOfReturnPath, sanitizeFormReturnPath } from '@/lib/forms/sign-in-page'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { authCookieSecure } from '@/lib/providers/auth/cookies'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { apexOrigin, baseDomainFromEnv, canShareCookies, workspaceHopPath } from '@/lib/workspace-address'
import type { LoginOptions } from '@/lib/providers/auth/types'

/**
 * The form sign-in page: /form-login?redirect=<form path>[&embed=1], on the
 * host the form link is on (a workspace address or the main one). Form links
 * (/f/<id>, /form/<name>) send visitors here instead of the app's /login.
 *
 *  - The design is the workspace's (Settings → Forms → Form sign-in page):
 *    the workspace of the address, else the workspace of the /f/<id> form;
 *    a /form/<name> link on the main address names no workspace, so the
 *    default design with an Organisation field.
 *  - The look: the UserTasks palette, or the workspace theme when the page
 *    uses it — turned into scoped CSS tokens here, so the theme itself never
 *    reaches the browser (lib/forms/sign-in-theme.ts).
 *  - `redirect` must be a form link path on this host (/f/… or /form/…;
 *    lib/forms/sign-in-page.ts sanitizeFormReturnPath) — anything else is
 *    ignored, so this page can't be used as an open redirect.
 *  - Already signed in (top level): straight back to the form.
 *  - Embedded in another site: "Open the form in a new tab" (no sign-in in
 *    third-party frames).
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false }, referrer: 'no-referrer' }

const FALLBACK: LoginOptions = { provider: 'supabase', password: true, sso: [] }

type Query = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** The form path without ?embed=1 (Open in a new tab opens the full page). */
function withoutEmbed(path: string): string {
  const [pathname, search = ''] = path.split('?')
  const params = new URLSearchParams(search)
  params.delete(EMBED_PARAM)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export default async function FormLoginPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams
  const returnPath = sanitizeFormReturnPath(first(query.redirect))
  const visitor = await formLinkVisitor(query)
  const { host } = visitor
  const user = host.kind === 'non_member' ? null : await formLinkUser(visitor)
  if (host.kind === 'non_member' && visitor.frame !== 'cross-origin-frame') redirect('/no-access')
  if (user && returnPath && !visitor.embed) redirect(returnPath)

  const hostTenant = host.kind === 'member' || host.kind === 'signed_out' || host.kind === 'non_member' ? host.tenant : null
  const svc = await import('@/lib/services/form-sign-in-page')
  const formId = formIdOfReturnPath(returnPath)
  const tenantId = hostTenant?.id ?? (formId ? await svc.tenantOfForm(formId) : null)
  const [page, options] = await Promise.all([
    svc.loadPublicSignInPage(tenantId),
    import('@/app/actions/auth').then((m) => m.getLoginOptions()).catch((error) => {
      console.error('[auth] login options unavailable:', (error as Error).message)
      return FALLBACK
    }),
  ])

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
        settings={page.settings}
        logoUrl={page.settings.logo_url ? resolveStorageUrl(page.settings.logo_url) : null}
        workspace={page.workspace}
        themeStyle={signInThemeStyle(page.settings, page.theme)}
        options={options}
        returnPath={back}
        ssoStart={ssoStart}
        openUrl={returnPath ? withoutEmbed(returnPath) : '/home'}
        embed={visitor.embed}
        error={signInErrorMessage(first(query.error))}
      />
    </>
  )
}
