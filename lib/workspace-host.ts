import { headers } from 'next/headers'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { cache } from 'react'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { authCookieSecure } from '@/lib/providers/auth/cookies'
import {
  HOST_WORKSPACE_HEADER, INVALID_HOST_MARK, REQUEST_PATH_HEADER,
  apexOrigin, baseDomainFromEnv, canShareCookies, safeLocalPath, workspaceHopPath, workspaceOrigin,
} from '@/lib/workspace-address'
import type { HostTenant } from '@/lib/services/workspace-address'

/**
 * Host-based workspace resolution (server only): which workspace a request's
 * address (acme.usertasks.com) names, and the rules every page on a
 * workspace address follows (enforceHostWorkspace).
 *
 * The proxy only classifies the Host (no database in the proxy) and passes
 * the label in a request header it controls; this module looks it up.
 *
 * Tenant context: RLS resolves the workspace from users.current_tenant_id
 * (get_current_tenant_id()), and every service follows it. A request-scoped
 * override would need a second, header-driven tenant path through every
 * policy and SECURITY DEFINER function, so a workspace address instead
 * switches the signed-in member's current workspace — once, through the same
 * switch_tenant RPC the avatar-menu switcher uses (it checks membership) —
 * and reloads the page. The address is the source of truth for the page
 * that's open; the switcher on another tab simply switches back the next time
 * that tab loads a page.
 */

export type HostWorkspace =
  /** Not on a workspace address (the apex, www, app, a preview host, subdomains off). */
  | { kind: 'none' }
  | { kind: 'unknown'; label: string }
  | { kind: 'moved'; label: string; subdomain: string }
  | { kind: 'workspace'; tenant: HostTenant }

/** The workspace this request's address names (once per request). */
export const getHostWorkspace = cache(async (): Promise<HostWorkspace> => {
  if (!baseDomainFromEnv()) return { kind: 'none' }
  let label: string | null = null
  try {
    label = (await headers()).get(HOST_WORKSPACE_HEADER)
  } catch {
    return { kind: 'none' } // outside a request (prerender, tests)
  }
  if (!label) return { kind: 'none' }
  if (label === INVALID_HOST_MARK) return { kind: 'unknown', label: '' }
  const { resolveSubdomain } = await import('@/lib/services/workspace-address')
  const resolved = await resolveSubdomain(label)
  if (resolved.kind === 'workspace') return { kind: 'workspace', tenant: resolved.tenant }
  if (resolved.kind === 'moved') return { kind: 'moved', label, subdomain: resolved.subdomain }
  return { kind: 'unknown', label }
})

/** This request's path + query, as the proxy saw it ('/' when unknown). */
export async function requestPath(): Promise<string> {
  return safeLocalPath((await headers()).get(REQUEST_PATH_HEADER)) ?? '/'
}

/** `https://<subdomain>.<base>` for this instance (scheme and port follow APP_URL). */
export function originForSubdomain(subdomain: string): string | null {
  const base = baseDomainFromEnv()
  return base ? workspaceOrigin(subdomain, base, configuredAppUrl()) : null
}

/**
 * Where a signed-out visitor of a workspace address signs in, returning to
 * `path` on that address afterwards:
 *  - sessions shared across subdomains (production): the apex login with
 *    `redirect=/ws/<subdomain><path>` — every auth flow (password, SSO,
 *    OAuth) stays on the apex exactly as today, and the shared cookie
 *    carries the session back;
 *  - host-only sessions (local http on *.localhost): the address's own
 *    /login with a same-origin redirect.
 * `org` pre-fills the organisation field with the workspace's slug.
 */
export function loginUrlFor(tenant: Pick<HostTenant, 'subdomain' | 'slug'>, path: string): string {
  const base = baseDomainFromEnv()
  const org = tenant.slug ? `&org=${encodeURIComponent(tenant.slug)}` : ''
  if (base && canShareCookies(base, authCookieSecure())) {
    return `${apexOrigin(base, configuredAppUrl())}/login?redirect=${encodeURIComponent(workspaceHopPath(tenant.subdomain, path))}${org}`
  }
  return `/login?redirect=${encodeURIComponent(safeLocalPath(path) ?? '/home')}${org}`
}

export type EnforcedHost =
  | { kind: 'none' }
  | { kind: 'member'; tenant: HostTenant; userId: string }
  /** Only with allowSignedOut: a visitor on a workspace address (the page decides, e.g. a public friendly form link). */
  | { kind: 'signed_out'; tenant: HostTenant }
  /** Only with allowSignedOut: signed in, but not a member (a public friendly link still opens for them). */
  | { kind: 'non_member'; tenant: HostTenant; userId: string }

/**
 * The rules of a page on a workspace address:
 *  - unknown address → 404 (app/not-found.tsx says "no workspace here");
 *  - a retired address → 308 to the same path on the current one;
 *  - signed out → sign in, then back to the same URL (unless allowSignedOut);
 *  - signed in, not a member → /no-access ("You don't have access to …");
 *  - a member whose current workspace is another one (or the "All
 *    organizations" view) → switch it (switch_tenant) and reload the URL.
 * Off a workspace address nothing changes: { kind: 'none' }.
 */
export async function enforceHostWorkspace(options: { allowSignedOut?: boolean } = {}): Promise<EnforcedHost> {
  const host = await getHostWorkspace()
  if (host.kind === 'none') return host
  if (host.kind === 'unknown') notFound()
  const path = await requestPath()
  if (host.kind === 'moved') {
    const origin = originForSubdomain(host.subdomain)
    if (origin) permanentRedirect(`${origin}${path}`)
    notFound()
  }
  const { tenant } = host
  const { getCachedUser } = await import('@/lib/supabase/server')
  const user = await getCachedUser()
  if (!user) {
    if (options.allowSignedOut) return { kind: 'signed_out', tenant }
    redirect(loginUrlFor(tenant, path))
  }
  const svc = await import('@/lib/services/workspace-address')
  if (!(await svc.isActiveMember(user.id, tenant.id))) {
    if (options.allowSignedOut) return { kind: 'non_member', tenant, userId: user.id }
    redirect('/no-access')
  }
  const stored = await svc.storedWorkspaceOf(user.id)
  if (stored.current !== tenant.id) {
    const { getSessionDb } = await import('@/lib/providers/db/session')
    const db = await getSessionDb()
    const { error } = await (db as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }> })
      .rpc('switch_tenant', { p_tenant_id: tenant.id })
    if (error) throw new Error(`Could not open workspace ${tenant.subdomain}: ${error.message}`)
    // Reload so every server read of this request runs in the new workspace.
    const after = await svc.storedWorkspaceOf(user.id)
    if (after.current !== tenant.id) throw new Error(`Could not open workspace ${tenant.subdomain}`)
    redirect(path)
  }
  return { kind: 'member', tenant, userId: user.id }
}
