/**
 * Shared types for directory synchronization. Every pull connector — Entra ID,
 * Okta, LDAP / Active Directory, Google Workspace — normalizes to these
 * shapes so the sync engine (lib/directory-sync/sync.ts) is provider-agnostic.
 * SCIM is push (the IdP calls /scim/v2, lib/scim) and reuses the engine's
 * reconciliation helpers instead of a client.
 */

/** Directories the sync engine pulls from (directory_sync_runs.provider). */
export type DirectoryProvider = 'entra' | 'okta' | 'ldap' | 'google'
export const DIRECTORY_PROVIDERS: readonly DirectoryProvider[] = ['entra', 'okta', 'ldap', 'google']

/** Every source of directory_links rows: the pull connectors plus SCIM. */
export type DirectoryLinkProvider = DirectoryProvider | 'scim'

export function isDirectoryProvider(value: unknown): value is DirectoryProvider {
  return typeof value === 'string' && (DIRECTORY_PROVIDERS as readonly string[]).includes(value)
}

/** API error with HTTP status — mirror of GitHubApiError in lib/github-sync/client.ts. */
export class DirectoryApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DirectoryApiError'
    this.status = status
  }
}

export interface DirectoryUser {
  externalId: string
  displayName: string
  /** Best-effort email — null when the directory record has none. */
  email: string | null
  active: boolean
  /**
   * The user's manager as the directory names it (Entra `manager`, Okta
   * `profile.managerId`, Google `relations[type=manager]`, LDAP `manager`
   * DN, SCIM enterprise `manager.value`). Absent: the provider did not say
   * (nothing changes); null: no manager. Resolved to a local user after the
   * user pass (lib/directory-sync/managers.ts).
   */
  manager?: DirectoryManagerRef | null
}

export interface DirectoryManagerRef {
  /** The manager's id in the same directory (directory_links.external_id). */
  externalId?: string | null
  email?: string | null
}

export interface DirectoryGroup {
  externalId: string
  displayName: string
  description: string | null
}

/** Incremental user listing: what changed since `cursor`. */
export interface DirectoryUserChanges {
  users: DirectoryUser[]
  /** Cursor for the next delta run. */
  cursor: string | null
}

/** Normalized surface every provider client implements. */
export interface DirectoryClient {
  verify(): Promise<{ orgName: string | null }>
  listUsers(): Promise<DirectoryUser[]>
  listGroups(): Promise<DirectoryGroup[]>
  /** User externalIds in the group (transitively, where the directory nests groups). */
  listGroupMemberIds(groupId: string): Promise<string[]>
  /**
   * Delta support (LDAP: uSNChanged / modifyTimestamp). Without a cursor:
   * the cursor to start from after a full listing (taken BEFORE the listing,
   * so nothing changed during it is missed). With one: the users changed
   * since, and the next cursor.
   */
  deltaCursor?(): Promise<string | null>
  listUserChanges?(cursor: string): Promise<DirectoryUserChanges>
  /** Release connections (LDAP). */
  close?(): Promise<void>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function looksLikeEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_RE.test(value)
}
