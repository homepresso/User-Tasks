/**
 * Org units from imported attributes — shared by directory sync (Okta,
 * Entra ID, Google Workspace, LDAP / AD, SCIM) and the CSV import.
 *
 * A person's position is a unit path, top to bottom: company → division →
 * department (whichever the source has), or Google's orgUnitPath
 * (/Engineering/Web). Each prefix of a path is one org unit, keyed by
 * (tenant, source, external_id) where external_id is the normalised path
 * ("company:acme/division:ops/department:finance", "ou:/engineering/web"),
 * so a re-import updates the same rows instead of duplicating them.
 *
 * Rules:
 *  - a missing unit is created (source = the importer) under its parent;
 *  - an existing, non-detached unit gets the source's latest name casing,
 *    kind and parent;
 *  - a detached unit (edited by hand since) is left alone but still used
 *    for memberships;
 *  - units are never deleted by an import (an emptied department stays,
 *    with no members, until someone deletes it).
 * Membership sync touches only rows the same source created
 * (org_unit_members.source), never manual memberships.
 */

import type { OrgSource } from './structure'
import { fetchAllRows } from './load'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export interface UnitPathSegment {
  kind: string
  name: string
}

/** Top → bottom. */
export type UnitPath = UnitPathSegment[]

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)

/** company / division / department attributes → a path (empty parts skipped). */
export function attributeUnitPath(attrs: { company?: string | null; division?: string | null; department?: string | null }): UnitPath {
  const path: UnitPath = []
  if (clean(attrs.company)) path.push({ kind: 'company', name: clean(attrs.company) })
  if (clean(attrs.division)) path.push({ kind: 'division', name: clean(attrs.division) })
  if (clean(attrs.department)) path.push({ kind: 'department', name: clean(attrs.department) })
  return path
}

/** Google Workspace orgUnitPath ("/Engineering/Web") → a path of units. "/" (the root) → []. */
export function orgUnitPathToUnitPath(orgUnitPath: string | null | undefined): UnitPath {
  return String(orgUnitPath ?? '').split('/').map(clean).filter(Boolean).map((name) => ({ kind: 'unit', name }))
}

/** Stable external id of a path prefix (case- and whitespace-insensitive). */
export function unitPathKey(path: UnitPath): string {
  if (path.length && path.every((s) => s.kind === 'unit')) return `ou:/${path.map((s) => s.name.toLowerCase()).join('/')}`
  return path.map((s) => `${s.kind}:${s.name.toLowerCase()}`).join('/')
}

export interface PlannedUnit {
  external_id: string
  name: string
  kind: string
  parent_external_id: string | null
}

/** Every unit the paths need, parents before children, de-duplicated (first casing wins). */
export function planUnitPaths(paths: readonly UnitPath[]): PlannedUnit[] {
  const out = new Map<string, PlannedUnit>()
  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      const key = unitPathKey(path.slice(0, i + 1))
      if (out.has(key)) continue
      out.set(key, { external_id: key, name: path[i].name, kind: path[i].kind, parent_external_id: i ? unitPathKey(path.slice(0, i)) : null })
    }
  }
  return [...out.values()]
}

export interface EnsureUnitsResult {
  /** external_id → unit id, for every unit the paths need. */
  idByKey: Map<string, string>
  created: number
  updated: number
}

/** Create / refresh the org units for `paths` (see the rules above). */
export async function ensureOrgUnits(db: any, tenantId: string, source: OrgSource, paths: readonly UnitPath[], options: { createdBy?: string | null } = {}): Promise<EnsureUnitsResult> {
  const planned = planUnitPaths(paths)
  const idByKey = new Map<string, string>()
  if (!planned.length) return { idByKey, created: 0, updated: 0 }
  const existing = await fetchAllRows<any>(() => db.from('org_units')
    .select('id, name, kind, parent_id, external_id, detached').eq('tenant_id', tenantId).eq('source', source).not('external_id', 'is', null).order('id'))
  const byKey = new Map<string, any>(existing.map((u) => [String(u.external_id), u]))
  let created = 0
  let updated = 0
  for (const unit of planned) {
    const parentId = unit.parent_external_id ? idByKey.get(unit.parent_external_id) ?? null : null
    const current = byKey.get(unit.external_id)
    if (current) {
      idByKey.set(unit.external_id, String(current.id))
      if (current.detached) continue
      const changes: Record<string, unknown> = {}
      if (current.name !== unit.name) changes.name = unit.name
      if (current.kind !== unit.kind) changes.kind = unit.kind
      if ((current.parent_id ?? null) !== parentId) changes.parent_id = parentId
      if (Object.keys(changes).length) {
        const { error } = await db.from('org_units').update(changes).eq('id', current.id).eq('tenant_id', tenantId)
        if (error) console.warn(`[org-import] unit ${unit.external_id} not updated: ${error.message}`)
        else updated++
      }
      continue
    }
    const { data, error } = await db.from('org_units').insert({
      tenant_id: tenantId, name: unit.name, kind: unit.kind, parent_id: parentId, source, external_id: unit.external_id,
      created_by: options.createdBy ?? null,
    }).select('id').single()
    if (error || !data) {
      // A concurrent import created it: pick it up.
      const { data: again } = await db.from('org_units').select('id').eq('tenant_id', tenantId).eq('source', source).eq('external_id', unit.external_id).maybeSingle()
      if (again?.id) { idByKey.set(unit.external_id, String(again.id)); continue }
      console.warn(`[org-import] unit ${unit.external_id} not created: ${error?.message ?? 'unknown error'}`)
      continue
    }
    idByKey.set(unit.external_id, String(data.id))
    created++
  }
  return { idByKey, created, updated }
}

export interface MembershipChange {
  user_id: string
  add: string | null
  remove: string[]
}

/**
 * Plan membership changes for the users in `desired` (user → unit id, or
 * null for "no unit from this source"): drop the source's other memberships,
 * add the desired one. `current` holds the source's existing memberships.
 */
export function planUnitMemberships(desired: ReadonlyMap<string, string | null>, current: ReadonlyArray<{ user_id: string; org_unit_id: string }>): MembershipChange[] {
  const byUser = new Map<string, string[]>()
  for (const m of current) {
    const list = byUser.get(m.user_id)
    if (list) list.push(m.org_unit_id)
    else byUser.set(m.user_id, [m.org_unit_id])
  }
  const out: MembershipChange[] = []
  for (const [userId, unitId] of desired) {
    const have = byUser.get(userId) ?? []
    const remove = have.filter((id) => id !== unitId)
    const add = unitId && !have.includes(unitId) ? unitId : null
    if (add || remove.length) out.push({ user_id: userId, add, remove })
  }
  return out
}

/** Apply planUnitMemberships for one source. Primary unit: set when the person has no primary yet. */
export async function syncUnitMemberships(db: any, tenantId: string, source: OrgSource, desired: ReadonlyMap<string, string | null>): Promise<{ added: number; removed: number }> {
  if (!desired.size) return { added: 0, removed: 0 }
  const userIds = [...desired.keys()]
  const current: Array<{ user_id: string; org_unit_id: string; is_primary: boolean; source: string }> = []
  for (let i = 0; i < userIds.length; i += 200) {
    const rows = await fetchAllRows<any>(() => db.from('org_unit_members')
      .select('user_id, org_unit_id, is_primary, source').eq('tenant_id', tenantId).in('user_id', userIds.slice(i, i + 200)).order('org_unit_id').order('user_id'))
    for (const r of rows) current.push({ user_id: String(r.user_id), org_unit_id: String(r.org_unit_id), is_primary: Boolean(r.is_primary), source: String(r.source) })
  }
  const changes = planUnitMemberships(desired, current.filter((m) => m.source === source))
  let added = 0
  let removed = 0
  for (const change of changes) {
    if (change.remove.length) {
      const { error } = await db.from('org_unit_members').delete().eq('tenant_id', tenantId).eq('user_id', change.user_id).eq('source', source).in('org_unit_id', change.remove)
      if (error) console.warn(`[org-import] memberships of ${change.user_id} not removed: ${error.message}`)
      else removed += change.remove.length
    }
    if (change.add) {
      // Primary memberships that survive this change (the source's removed ones don't).
      const hasPrimary = current.some((m) => m.user_id === change.user_id && m.is_primary && !(m.source === source && change.remove.includes(m.org_unit_id)))
      const { error } = await db.from('org_unit_members').upsert(
        { tenant_id: tenantId, org_unit_id: change.add, user_id: change.user_id, source, is_primary: !hasPrimary },
        { onConflict: 'org_unit_id,user_id', ignoreDuplicates: true },
      )
      if (error) console.warn(`[org-import] ${change.user_id} not added to unit ${change.add}: ${error.message}`)
      else added++
    }
  }
  return { added, removed }
}
