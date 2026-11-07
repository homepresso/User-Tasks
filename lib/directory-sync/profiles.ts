/**
 * Directory sync → people attributes and org units.
 *
 * After the user pass (every synced user has a directory link) and when the
 * connection allows it:
 *
 *  - `import_profiles`: job title, department, location, employee id and cost
 *    centre go to the member's row in this workspace (user_memberships),
 *    with profile_source 'directory'. Rules:
 *      · a member whose attributes were detached (profile_source 'manual')
 *        is left alone;
 *      · a field the provider said nothing about (absent) is left alone; a
 *        field it has no value for (null) clears a value the directory set;
 *      · only changed fields are written (a re-sync is a no-op).
 *  - `import_org_units`: org units from company → division → department
 *    (lib/org/import-units.ts; source = the provider, so re-syncs update the
 *    same units) and one membership per synced user in their deepest unit.
 *    Google Workspace: when any synced user sits in a non-root
 *    organizational unit, the orgUnitPath tree is the structure (department
 *    stays a person attribute); otherwise the department path is used, as for
 *    the other providers.
 *
 * Best-effort like the manager sync: failures are logged, the run goes on.
 */

import { ensureOrgUnits, attributeUnitPath, orgUnitPathToUnitPath, syncUnitMemberships, unitPathKey, type UnitPath } from '@/lib/org/import-units'
import { fetchAllRows } from '@/lib/org/load'
import type { OrgSource } from '@/lib/org/structure'
import { profileValue, type DirectoryProfile, type DirectoryUser } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

/** Membership attributes the directory can own, with their column limits. */
export const DIRECTORY_PROFILE_FIELDS = { job_title: 200, department: 200, location: 200, employee_id: 100, cost_center: 100 } as const
export type DirectoryProfileField = keyof typeof DIRECTORY_PROFILE_FIELDS

export interface MembershipProfile {
  job_title: string | null
  department: string | null
  location: string | null
  employee_id: string | null
  cost_center: string | null
  profile_source: string | null
}

export interface ProfileChange {
  user_id: string
  updates: Partial<Record<DirectoryProfileField, string | null>>
}

function fieldValue(field: DirectoryProfileField, raw: unknown): string | null {
  const value = profileValue(raw)
  return value ? value.slice(0, DIRECTORY_PROFILE_FIELDS[field]) : null
}

/** The attribute changes for one member (see the rules above); null when nothing changes. */
export function planProfileChange(profile: DirectoryProfile | undefined, current: MembershipProfile): ProfileChange['updates'] | null {
  if (!profile || current.profile_source === 'manual') return null
  const owned = current.profile_source === 'directory'
  const updates: ProfileChange['updates'] = {}
  for (const field of Object.keys(DIRECTORY_PROFILE_FIELDS) as DirectoryProfileField[]) {
    if (!(field in profile) || profile[field] === undefined) continue
    const next = fieldValue(field, profile[field])
    const now = current[field] ?? null
    if (next === now) continue
    // Clearing needs ownership: a value nobody attributed to the directory stays.
    if (next === null && !owned) continue
    updates[field] = next
  }
  return Object.keys(updates).length ? updates : null
}

export function planProfileChanges(input: {
  users: DirectoryUser[]
  localIdByExternalId: Map<string, string>
  current: Map<string, MembershipProfile>
}): ProfileChange[] {
  const out = new Map<string, ProfileChange>()
  for (const user of input.users) {
    if (!user.active || !user.profile) continue
    const localId = input.localIdByExternalId.get(user.externalId)
    const now = localId ? input.current.get(localId) : undefined
    if (!localId || !now) continue
    const updates = planProfileChange(user.profile, now)
    if (updates) out.set(localId, { user_id: localId, updates })
  }
  return [...out.values()]
}

/** Which org unit path a user belongs to (null: the provider said nothing about it). */
export function unitPathFor(user: DirectoryUser, mode: 'org_unit_path' | 'attributes'): UnitPath | null {
  if (mode === 'org_unit_path') return user.orgUnitPath === undefined ? null : orgUnitPathToUnitPath(user.orgUnitPath)
  if (!user.profile) return null
  return attributeUnitPath(user.profile)
}

/** Google: the OU tree when anyone is below the root, else department paths. */
export function unitPathMode(users: readonly DirectoryUser[]): 'org_unit_path' | 'attributes' {
  return users.some((u) => orgUnitPathToUnitPath(u.orgUnitPath).length > 0) ? 'org_unit_path' : 'attributes'
}

export interface DirectoryOrgOptions {
  importProfiles: boolean
  importOrgUnits: boolean
}

export interface DirectoryOrgStats {
  profiles_updated: number
  org_units_created: number
  org_units_updated: number
  org_unit_memberships_changed: number
}

export function emptyOrgStats(): DirectoryOrgStats {
  return { profiles_updated: 0, org_units_created: 0, org_units_updated: 0, org_unit_memberships_changed: 0 }
}

async function loadLinks(supabase: any, tenantId: string, provider: string): Promise<Map<string, string>> {
  const links = await fetchAllRows<any>(() => supabase.from('directory_links')
    .select('external_id, local_id').eq('tenant_id', tenantId).eq('provider', provider).eq('object_type', 'user').order('external_id'))
  return new Map(links.map((l) => [String(l.external_id), String(l.local_id)]))
}

/** Write attributes and org units for `users` (already linked) — see the module comment. */
export async function syncDirectoryOrg(
  supabase: any,
  tenantId: string,
  provider: OrgSource,
  users: DirectoryUser[],
  options: DirectoryOrgOptions,
  extra: { localIdByExternalId?: Map<string, string> } = {},
): Promise<DirectoryOrgStats> {
  const stats = emptyOrgStats()
  if (!options.importProfiles && !options.importOrgUnits) return stats
  const relevant = users.filter((u) => u.active && (u.profile !== undefined || u.orgUnitPath !== undefined))
  if (!relevant.length) return stats

  const localIdByExternalId = extra.localIdByExternalId ?? await loadLinks(supabase, tenantId, provider)

  if (options.importProfiles) {
    const members = await fetchAllRows<any>(() => supabase.from('user_memberships')
      .select('user_id, job_title, department, location, employee_id, cost_center, profile_source')
      .eq('tenant_id', tenantId).eq('is_active', true).order('user_id'))
    const current = new Map<string, MembershipProfile>(members.map((m) => [String(m.user_id), {
      job_title: m.job_title ?? null, department: m.department ?? null, location: m.location ?? null,
      employee_id: m.employee_id ?? null, cost_center: m.cost_center ?? null, profile_source: m.profile_source ?? null,
    }]))
    const nowIso = new Date().toISOString()
    for (const change of planProfileChanges({ users: relevant, localIdByExternalId, current })) {
      const { error } = await supabase.from('user_memberships')
        .update({ ...change.updates, profile_source: 'directory', profile_updated_at: nowIso })
        .eq('tenant_id', tenantId).eq('user_id', change.user_id)
        // A concurrent "detach" wins.
        .or('profile_source.is.null,profile_source.eq.directory')
      if (error) console.warn(`[directory-sync] attributes not set for ${change.user_id}: ${error.message}`)
      else stats.profiles_updated++
    }
  }

  if (options.importOrgUnits) {
    const mode = provider === 'google' ? unitPathMode(relevant) : 'attributes'
    const pathByUser = new Map<string, UnitPath>()
    for (const user of relevant) {
      const localId = localIdByExternalId.get(user.externalId)
      const path = unitPathFor(user, mode)
      if (localId && path) pathByUser.set(localId, path)
    }
    if (pathByUser.size) {
      const ensured = await ensureOrgUnits(supabase, tenantId, provider, [...pathByUser.values()].filter((p) => p.length))
      stats.org_units_created = ensured.created
      stats.org_units_updated = ensured.updated
      const desired = new Map<string, string | null>()
      for (const [userId, path] of pathByUser) {
        if (!path.length) { desired.set(userId, null); continue }
        const unitId = ensured.idByKey.get(unitPathKey(path))
        if (unitId) desired.set(userId, unitId)
      }
      const memberships = await syncUnitMemberships(supabase, tenantId, provider, desired)
      stats.org_unit_memberships_changed = memberships.added + memberships.removed
    }
  }
  return stats
}
