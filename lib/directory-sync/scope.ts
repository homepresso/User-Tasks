/**
 * A pull connection's group scope (tenant_connectors.config.settings
 * .scope_group_ids): when set, the sync (lib/directory-sync/sync.ts) brings in
 * only the users who are members of these directory groups, and — with
 * sync_groups on — only these groups as teams. Unset / empty: everyone the
 * connection's own settings return, as before. Chosen in Organization →
 * Import people ("Keep in sync"). Pure.
 */

import { z } from 'zod'

export const MAX_SCOPE_GROUPS = 200

export const scopeGroupIdsSetting = {
  scope_group_ids: z.array(z.string().trim().min(1).max(512)).max(MAX_SCOPE_GROUPS).optional(),
}

/** The connection's scope (deduplicated), or [] for no scope. */
export function scopeGroupIds(settings: Record<string, unknown> | null | undefined): string[] {
  const raw = settings?.scope_group_ids
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))].slice(0, MAX_SCOPE_GROUPS)
}

/** What the sync keeps for this connection's scope: membership of the scope groups, read once per run. */
export async function scopeFilter(
  client: { listGroupMemberIds(groupId: string): Promise<string[]> },
  settings: Record<string, unknown> | null | undefined,
): Promise<{ scope: string[]; userInScope: (user: { externalId: string }) => boolean; groupInScope: (group: { externalId: string }) => boolean }> {
  const scope = scopeGroupIds(settings)
  if (!scope.length) return { scope, userInScope: () => true, groupInScope: () => true }
  const members = new Set<string>()
  for (const groupId of scope) for (const id of await client.listGroupMemberIds(groupId)) members.add(id)
  const groups = new Set(scope)
  return { scope, userInScope: (u) => members.has(u.externalId), groupInScope: (g) => groups.has(g.externalId) }
}
