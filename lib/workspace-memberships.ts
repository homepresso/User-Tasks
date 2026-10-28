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
