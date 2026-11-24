import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EmbedAutoSignIn, EmbedSignIn } from '@/components/embed/embed-sign-in'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { frameContext } from '@/lib/forms/embed'
import { autoSsoPath, cleanOrgHint, LAUNCH_ORG_PARAM, SSO_DONE_PATH } from '@/lib/providers/auth/sso/auto'
import { resolveAutoSso } from '@/lib/providers/auth/sso/auto-server'

type Query = Record<string, string | string[] | undefined>

/**
 * The signed-out state of a trusted-embedding page (/embed/…), shared by
 * every embeddable route. With automatic sign-in for the workspace
 * (lib/providers/auth/sso/auto.ts, workspace from ?ut_org=, the address or
 * the only one): at the top level → the IdP and back to the /embed/ page
 * (no sign-in page); inside a frame → the silent attempt in a hidden frame,
 * then storage access / popup / new tab (components/embed/embed-sign-in.tsx).
 * Without it: top level → /login and back to `appPath`; frame → open
 * UserTasks in a new tab, then reload. Server component (may redirect).
 *
 * `embedPath`: this page (/embed/… with its query). `appPath`: where a
 * sign-in in a new tab lands (the full app page, or the same /embed/ page
 * when there is no app twin).
 */
export async function EmbedSignedOut({ embedPath, appPath, query, quiet = false, signInHref = null }: {
  embedPath: string; appPath: string; query: Query
  /**
   * Where to sign in instead of /login when automatic sign-in doesn't apply
   * (embedded apps: the workspace sign-in page, lib/apps/sign-in-server.ts),
   * returning to `appPath`.
   */
  signInHref?: string | null
  /** A host that reveals the frame only once it has a size (e.g. the SharePoint form host page): the silent phases take no space at all. */
  quiet?: boolean
}) {
  const h = await headers()
  const where = frameContext((name) => h.get(name))
  const orgHint = cleanOrgHint(query[LAUNCH_ORG_PARAM])
  const auto = await resolveAutoSso({ org: orgHint, purpose: 'launch' })
  const standard = signInHref ?? `/login?redirect=${encodeURIComponent(appPath)}`
  if (where === 'top') redirect(auto ? autoSsoPath({ redirect: embedPath, org: auto.org }) : standard)
  const loginHref = auto ? autoSsoPath({ redirect: appPath, org: auto.org }) : standard
  if (auto) {
    // In EmbedFrame: transparent like the page it stands in for, and the host sizes it (usertasks:resize / add-in part message).
    return (
      <EmbedFrame embed>
      <EmbedAutoSignIn
        quiet={quiet}
        idpName={auto.idpName}
        silentUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'frame' })}
        popupUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'popup' })}
        newTabHref={loginHref}
        reloadHref={embedPath}
      />
      </EmbedFrame>
    )
  }
  return <EmbedFrame embed><EmbedSignIn loginHref={loginHref} reloadHref={embedPath} /></EmbedFrame>
}

/** `?a=1&b=2` for a Next searchParams object ('' when empty). */
export function embedQueryString(query: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
  const s = q.toString()
  return s ? `?${s}` : ''
}
