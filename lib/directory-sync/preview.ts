/**
 * Preview mode for the directory clients: read who and what a connection
 * would bring in, writing nothing (Organization → Import people). Works on
 * the provider-agnostic DirectoryClient surface (Entra ID, Okta, Google
 * Workspace, LDAP / AD), so every connector supports it.
 *
 * With `groupIds`: the members of those groups (transitively, where the
 * directory nests them), each user tagged with the selected groups it is in.
 * Without: everyone the connection returns. Users are capped (`maxUsers`)
 * and the result says when it was truncated.
 */

import type { DirectoryClient, DirectoryGroup, DirectoryUser } from './types'

export const PREVIEW_MAX_USERS = 2000
export const PREVIEW_MAX_GROUPS = 1000

export interface DirectoryPreviewUser {
  externalId: string
  displayName: string
  email: string | null
  active: boolean
  /** Selected groups this user belongs to (externalIds). */
  groupIds: string[]
}

export interface DirectoryPreview {
  users: DirectoryPreviewUser[]
  groups: DirectoryGroup[]
  /** Users found before the cap. */
  totalUsers: number
  truncated: boolean
}

export async function previewDirectory(client: DirectoryClient, options: { groupIds?: string[]; maxUsers?: number } = {}): Promise<DirectoryPreview> {
  const max = Math.max(1, Math.min(options.maxUsers ?? PREVIEW_MAX_USERS, PREVIEW_MAX_USERS))
  const [users, groups] = await Promise.all([client.listUsers(), client.listGroups()])
  const groupIds = [...new Set(options.groupIds ?? [])].filter((id) => groups.some((g) => g.externalId === id))
  const memberOf = new Map<string, string[]>()
  for (const id of groupIds) {
    for (const userId of await client.listGroupMemberIds(id)) memberOf.set(userId, [...(memberOf.get(userId) ?? []), id])
  }
  const seen = new Set<string>()
  const picked: DirectoryUser[] = []
  for (const user of users) {
    if (seen.has(user.externalId)) continue
    seen.add(user.externalId)
    if (groupIds.length && !memberOf.has(user.externalId)) continue
    picked.push(user)
  }
  picked.sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''))
  return {
    users: picked.slice(0, max).map((u) => ({ externalId: u.externalId, displayName: u.displayName, email: u.email ? u.email.toLowerCase() : null, active: u.active, groupIds: memberOf.get(u.externalId) ?? [] })),
    groups: [...groups].sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, PREVIEW_MAX_GROUPS),
    totalUsers: picked.length,
    truncated: picked.length > max,
  }
}
