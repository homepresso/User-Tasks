/**
 * Whether the dashboard's cached auth state (sessionStorage, per browser tab
 * and origin) still belongs to the workspace the server renders.
 *
 * Role and permissions are per workspace, but the cache used to be trusted
 * for 50 minutes whatever the current workspace: open another workspace's
 * address in a second tab (which switches users.current_tenant_id), reload
 * this tab, and its controls followed the old workspace's role, e.g. the
 * workspace address field editable for a member, or read-only for an owner.
 *
 * `serverTenantId` is users.current_tenant_id as the dashboard layout read it
 * (null = the "All organizations" view); undefined = unknown (signed out, a
 * shell without it), which never invalidates. The cache's own workspace is
 * the profile's current_tenant_id, saved with it.
 */
export function cachedAuthMatchesWorkspace(
  cached: { profile?: { current_tenant_id?: string | null } | null } | null | undefined,
  serverTenantId: string | null | undefined,
): boolean {
  if (!cached) return false
  if (serverTenantId === undefined) return true
  return (cached.profile?.current_tenant_id ?? null) === serverTenantId
}
