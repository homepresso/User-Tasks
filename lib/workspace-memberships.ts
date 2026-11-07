import type { MembershipWithTenant } from '@/lib/services/ui-reads/settings'

/**
 * Memberships the org switcher and the organizations list can show.
 *
 * The memberships read embeds `tenant:tenants(...)`; when the tenant row is not
 * readable (soft-deleted workspace, RLS hides it, a membership left behind by a
 * failed provisioning) the embed comes back null. Those rows used to crash the
 * switcher (`null.id`); they are dropped here and the trigger shows
 * "Unavailable workspace" when the active workspace is one of them.
 */
export function usableMemberships(rows: ReadonlyArray<MembershipWithTenant | null | undefined> | null | undefined): MembershipWithTenant[] {
  return (rows ?? []).filter((m): m is MembershipWithTenant =>
    Boolean(m && m.tenant && typeof m.tenant.id === 'string' && m.tenant.id))
}

export type SwitcherLabel =
  | { kind: 'workspace'; membership: MembershipWithTenant }
  | { kind: 'all' }
  | { kind: 'unavailable' }

/** What the switcher trigger shows for the active workspace (null = unified view). */
export function switcherLabel(memberships: MembershipWithTenant[] | undefined, currentTenantId: string | null): SwitcherLabel {
  if (!currentTenantId) return { kind: 'all' }
  const membership = memberships?.find((m) => m.tenant?.id === currentTenantId)
  if (membership) return { kind: 'workspace', membership }
  // Still loading: keep the previous neutral label rather than flashing a warning.
  return memberships ? { kind: 'unavailable' } : { kind: 'all' }
}

/** Two-letter badge for a workspace name ("Acme Corp" → "AC"); "?" without a name. */
export function workspaceInitials(name: string | null | undefined): string {
  const initials = String(name ?? '').split(' ').map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
  return initials || '?'
}

export interface WorkspaceMenuEntry {
  /** null = the unified "All organizations" view. */
  tenantId: string | null
  name: string
  initials: string | null
  color: string | null
  isHome: boolean
  current: boolean
}

/**
 * The workspace switcher's entries (the avatar menu in the top bar): "All
 * organizations", then every usable membership, with the active one marked.
 */
export function workspaceMenuEntries(memberships: ReadonlyArray<MembershipWithTenant | null | undefined> | null | undefined, currentTenantId: string | null): WorkspaceMenuEntry[] {
  return [
    { tenantId: null, name: 'All organizations', initials: null, color: null, isHome: false, current: !currentTenantId },
    ...usableMemberships(memberships).map((m) => ({
      tenantId: m.tenant.id,
      name: m.tenant.name,
      initials: workspaceInitials(m.tenant.name),
      color: ((m.tenant.branding as { primary_color?: string } | null)?.primary_color) ?? null,
      isHome: Boolean(m.is_home),
      current: currentTenantId === m.tenant.id,
    })),
  ]
}

/**
 * Switch workspace, then drop every client cache (all of it is
 * tenant-scoped) and re-render the server components. Returns whether the
 * switch happened (switch_tenant checks membership).
 */
export async function performWorkspaceSwitch(tenantId: string | null, deps: {
  switchWorkspace: (tenantId: string | null) => Promise<{ ok: boolean }>
  clearCurrentTenantCache: () => void
  invalidateQueries: () => Promise<unknown>
  /** Re-read the signed-in profile (current workspace, role, permissions) so the shell isn't stale. */
  refreshProfile?: () => Promise<unknown>
  refresh: () => void
}): Promise<boolean> {
  const result = await deps.switchWorkspace(tenantId)
  if (!result.ok) return false
  // router.refresh() only re-renders server components — React Query caches
  // (messages, tasks, notifications, ...) would keep showing the previous
  // workspace's rows without the invalidation.
  deps.clearCurrentTenantCache()
  await deps.invalidateQueries()
  await deps.refreshProfile?.()
  deps.refresh()
  return true
}
