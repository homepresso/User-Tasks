/**
 * Directory sync → reporting lines (user_memberships.manager_user_id).
 *
 * After the user pass every synced user has a directory link, so each
 * user's manager reference (DirectoryUser.manager) resolves to a local user:
 * by the manager's directory id (directory_links of the same provider), else
 * by email. Rules:
 *  - a resolved manager is written with manager_source 'directory' (it
 *    replaces a manual line: the directory is the source of truth for the
 *    users it manages);
 *  - an explicit "no manager" (null) clears only a line the directory set;
 *  - an unresolvable reference (manager not synced here) changes nothing;
 *  - a provider that says nothing (manager absent) changes nothing.
 * A loop in the directory data is refused by the database trigger for the
 * offending user only.
 */

import type { DirectoryUser } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export interface ManagerPlanInput {
  users: DirectoryUser[]
  /** directory externalId → local user id (this provider's links). */
  localIdByExternalId: Map<string, string>
  /** lower-cased email → local user id. */
  localIdByEmail: Map<string, string>
  /** local user id → current { manager_user_id, manager_source } in the tenant. */
  current: Map<string, { manager_user_id: string | null; manager_source: string | null }>
}

export interface ManagerChange {
  user_id: string
  manager_user_id: string | null
}

export function planManagerChanges(input: ManagerPlanInput): ManagerChange[] {
  const changes = new Map<string, ManagerChange>()
  for (const user of input.users) {
    if (!user.active || user.manager === undefined) continue
    const localId = input.localIdByExternalId.get(user.externalId)
    if (!localId) continue
    const now = input.current.get(localId)
    if (!now) continue // not a member here
    if (user.manager === null) {
      if (now.manager_user_id && now.manager_source === 'directory') changes.set(localId, { user_id: localId, manager_user_id: null })
      continue
    }
    const ref = user.manager
    const managerId = (ref.externalId ? input.localIdByExternalId.get(ref.externalId) : undefined)
      ?? (ref.email ? input.localIdByEmail.get(ref.email.toLowerCase()) : undefined)
    if (!managerId || managerId === localId) continue
    if (now.manager_user_id === managerId && now.manager_source === 'directory') continue
    changes.set(localId, { user_id: localId, manager_user_id: managerId })
  }
  return [...changes.values()]
}

/** Apply the directory's manager attributes to the tenant's reporting lines. Returns how many changed. */
export async function syncDirectoryManagers(supabase: any, tenantId: string, provider: string, users: DirectoryUser[]): Promise<number> {
  if (!users.some((u) => u.manager !== undefined)) return 0
  const { data: links } = await supabase.from('directory_links')
    .select('external_id, local_id').eq('tenant_id', tenantId).eq('provider', provider).eq('object_type', 'user')
  const localIdByExternalId = new Map<string, string>(((links ?? []) as any[]).map((l) => [String(l.external_id), String(l.local_id)]))

  const { data: members } = await supabase.from('user_memberships')
    .select('user_id, manager_user_id, manager_source').eq('tenant_id', tenantId).eq('is_active', true)
  const current = new Map<string, { manager_user_id: string | null; manager_source: string | null }>()
  for (const m of (members ?? []) as any[]) current.set(String(m.user_id), { manager_user_id: m.manager_user_id ?? null, manager_source: m.manager_source ?? null })

  const emails = Array.from(new Set(users.map((u) => u.manager?.email?.toLowerCase()).filter((e): e is string => Boolean(e))))
  const localIdByEmail = new Map<string, string>()
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await supabase.from('users').select('id, email').in('email', emails.slice(i, i + 200))
    for (const u of (data ?? []) as any[]) if (u.email && current.has(String(u.id))) localIdByEmail.set(String(u.email).toLowerCase(), String(u.id))
  }

  const changes = planManagerChanges({ users, localIdByExternalId, localIdByEmail, current })
  let applied = 0
  const nowIso = new Date().toISOString()
  for (const change of changes) {
    const { error } = await supabase.from('user_memberships')
      .update({ manager_user_id: change.manager_user_id, manager_source: change.manager_user_id ? 'directory' : null, manager_updated_at: nowIso })
      .eq('tenant_id', tenantId).eq('user_id', change.user_id)
    if (error) console.warn(`[directory-sync] manager not set for ${change.user_id}: ${error.message}`)
    else applied++
  }
  return applied
}
