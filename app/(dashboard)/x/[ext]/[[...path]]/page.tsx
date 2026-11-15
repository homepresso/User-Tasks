import { notFound, redirect } from 'next/navigation'
import { renderExtensionPageResult } from '@/lib/extensions/page-host'
import { autoSsoPath, cleanOrgHint, LAUNCH_ORG_PARAM } from '@/lib/providers/auth/sso/auto'
import { resolveAutoSso } from '@/lib/providers/auth/sso/auto-server'

/**
 * Extension custom pages (escape hatch): /x/<extension id>/<path>. Rendered
 * inside the app shell from the extension's pages entry, after the checks in
 * lib/extensions/page-host (extension usable in the workspace, page declared
 * in the manifest, its guard passes). Signed out: sign in and come back here
 * (links into extension pages from other systems keep their target) — with
 * the workspace's IdP straight away when automatic sign-in applies
 * (lib/providers/auth/sso/auto.ts), else the sign-in page. Not
 * found otherwise — always, in a build without extensions.
 */
export default async function ExtensionPageRoute({ params, searchParams }: {
  params: Promise<{ ext: string; path?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { ext, path } = await params
  const query = await searchParams
  const result = await renderExtensionPageResult(ext, path ?? [], query)
  if (result.kind === 'signed_out') {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
    const target = `/x/${encodeURIComponent(ext)}${(path ?? []).map((s) => `/${encodeURIComponent(decodeURIComponent(s))}`).join('')}${q.size ? `?${q}` : ''}`
    // Automatic sign-in with the workspace's IdP when it applies (lib/providers/auth/sso/auto.ts).
    const auto = await resolveAutoSso({ org: cleanOrgHint(query[LAUNCH_ORG_PARAM]), purpose: 'launch' })
    redirect(auto ? autoSsoPath({ redirect: target, org: auto.org }) : `/login?redirect=${encodeURIComponent(target)}`)
  }
  if (result.kind !== 'page') notFound()
  return result.node
}
