import { redirect } from 'next/navigation'
import { appOfReturnPath, cleanOrgSlug, signInPageUrl } from '@/lib/forms/sign-in-page'
import { getHostWorkspace, requestPath } from '@/lib/workspace-host'
import { safeLocalPath } from '@/lib/workspace-address'

/**
 * Signed-out visitors of an app (server only): where they sign in. Apps use
 * the workspace sign-in page (/sign-in, lib/forms/sign-in-page.ts) — the
 * page itself decides whether this workspace (and this app) uses it, and
 * otherwise forwards to the standard /login with the same return path.
 *
 *  - A workspace address names the workspace: /sign-in?redirect=<path>.
 *  - The main address with an ?org=<workspace> hint (the share link of a
 *    workspace without its own address): /sign-in?redirect=<path>&org=<slug>.
 *  - The main address without one: the standard /login, as before.
 */
export function appSignInRedirect(path: string, options: { onWorkspaceAddress?: boolean; org?: string | null; embed?: boolean } = {}): string {
  const org = options.onWorkspaceAddress ? null : cleanOrgSlug(options.org)
  if (options.onWorkspaceAddress || org) return signInPageUrl(path, { org, embed: options.embed })
  return `/login?redirect=${encodeURIComponent(safeLocalPath(path) ?? '/home')}`
}

/** `?org=` of a path's query, cleaned (null when absent or not a slug). */
export function orgHintOf(path: string): string | null {
  const q = path.indexOf('?')
  return q === -1 ? null : cleanOrgSlug(new URLSearchParams(path.slice(q + 1)).get('org'))
}

/**
 * The dashboard layout's check for app pages (/apps/<slug>[/<page>]): a
 * visitor who isn't signed in goes to the workspace sign-in page now, on
 * the server, instead of the client's /login bounce. Any other path, or a
 * signed-in visitor: nothing (enforceHostWorkspace and the app's audience
 * check carry on as before).
 */
export async function enforceAppVisitor(): Promise<void> {
  const path = await requestPath()
  const app = appOfReturnPath(path)
  if (!app || app.route !== 'apps') return
  const host = await getHostWorkspace()
  if (host.kind === 'unknown' || host.kind === 'moved') return // enforceHostWorkspace: 404 / the current address
  const { getCachedUser, getSessionUserFast } = await import('@/lib/supabase/server')
  // On a workspace address enforceHostWorkspace reads the verified user next (deduped); elsewhere a cookie read is enough.
  const user = host.kind === 'workspace' ? await getCachedUser() : await getSessionUserFast()
  if (user) return
  redirect(appSignInRedirect(path, { onWorkspaceAddress: host.kind === 'workspace', org: orgHintOf(path) }))
}

/**
 * Signed in on the main address with an ?org=<workspace> hint (a friendly
 * app link): open that workspace when the person is an active member of it
 * and it isn't already their current one (switch_tenant checks membership
 * again). Not a member, or no such workspace: nothing changes.
 */
export async function openHintedWorkspace(userId: string, org: string | null): Promise<void> {
  if (!org) return
  const { tenantBySlug } = await import('@/lib/services/form-sign-in-page')
  const tenant = await tenantBySlug(org)
  if (!tenant) return
  const svc = await import('@/lib/services/workspace-address')
  if (!(await svc.isActiveMember(userId, tenant.id))) return
  const stored = await svc.storedWorkspaceOf(userId)
  if (stored.current === tenant.id) return
  const { getSessionDb } = await import('@/lib/providers/db/session')
  const db = await getSessionDb()
  await (db as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
    .rpc('switch_tenant', { p_tenant_id: tenant.id })
}
