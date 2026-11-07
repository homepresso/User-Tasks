/**
 * Organization structure service: the org chart (reporting lines + people
 * attributes), org units, the team tree and people scopes. Shared by
 * /api/v1/org/*, the MCP org_* tools, the CLI (through REST), the
 * Organization page (UI reads and server actions) and — next — the task
 * tracker's "my team" / "project team" views (resolvePeopleScope).
 *
 * Permissions:
 *  - org.view: the org chart, people attributes, org units, the team tree,
 *    anyone's reports / chain / peers. Your own reporting line, reports,
 *    teams and projects need no permission.
 *  - org.manage: create / edit / delete / detach org units and their
 *    members; edit people attributes. Changing a manager here takes
 *    org.manage or team.change_roles (the Team page's permission).
 *  - Teams keep their permissions (lib/services/teams.ts): team.view_members
 *    also reads the team tree.
 *
 * Directory-owned data is read-only until detached: an org unit imported
 * from a directory (source ≠ manual, not detached) and people attributes
 * with profile_source 'directory'. Detaching makes them manual; sync then
 * leaves them alone.
 *
 * Reads and writes use the service-role client with explicit tenant filters,
 * after the checks here (like lib/services/manager-tasks.ts).
 */

import { loadOrgSnapshot, loadPeople, toUnit, ORG_UNIT_COLUMNS, type SnapshotPart } from '@/lib/org/load'
import {
  ancestorIds, buildTree, chartRoots, descendantIds, depthOf, managerChainOf, orgUnitMembersOf, orgUnitsOfUser, peersOf,
  projectsOfUser, PROFILE_FIELDS, reportCounts, reportingIndexOf, resolveScopeIds, subordinatesOf, teamMembersOf,
  teamsOfUser, unitHeadcounts, wouldCreateTreeCycle,
  type OrgPerson, type OrgSnapshot, type PeopleScope, type ProfileField, type SubordinateDepth,
} from '@/lib/org/structure'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

/* ── People cards ── */

export interface PersonCard {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  job_title: string | null
  department: string | null
  location: string | null
}

export function personCard(p: OrgPerson | undefined, id: string): PersonCard {
  return {
    id,
    display_name: p?.display_name ?? null,
    email: p?.email ?? null,
    avatar_url: p?.avatar_url ?? null,
    job_title: p?.job_title ?? null,
    department: p?.department ?? null,
    location: p?.location ?? null,
  }
}

function peopleById(snapshot: Pick<OrgSnapshot, 'people'>): Map<string, OrgPerson> {
  return new Map(snapshot.people.map((p) => [p.id, p]))
}

function canViewOrg(ctx: ServiceContext): boolean {
  return hasPerm(ctx, 'org.view')
}

/** Reading someone else's org data needs org.view (or team.view_members, which already lists members). */
function requireOrgViewFor(ctx: ServiceContext, userId: string) {
  if (userId === ctx.actorId) return
  if (hasPerm(ctx, 'team.view_members')) return
  requirePerm(ctx, 'org.view')
}

async function snapshot(ctx: ServiceContext, parts?: readonly SnapshotPart[]) {
  const db = await serviceRoleClient(ctx)
  return { db, snap: await loadOrgSnapshot(db, ctx.tenantId, parts) }
}

function resolveUserId(ctx: ServiceContext, id: string): string {
  if (id !== 'me') return id
  if (!ctx.actorId) throw ServiceError.validation('`me` needs a user-bound credential')
  return ctx.actorId
}

function requireMember(snap: Pick<OrgSnapshot, 'people'>, userId: string): OrgPerson {
  const person = snap.people.find((p) => p.id === userId)
  if (!person) throw ServiceError.notFound('User is not a member of this workspace')
  return person
}

/* ── Org chart (reporting lines) ── */

export interface OrgChartPerson extends PersonCard {
  manager_user_id: string | null
  manager_source: string | null
  employee_id: string | null
  cost_center: string | null
  profile_source: string | null
  direct_reports: number
  total_reports: number
}

/** Every active member with manager, attributes and report counts, plus the chart roots. org.view. */
export async function getOrgChart(ctx: ServiceContext) {
  requirePerm(ctx, 'org.view')
  const db = await serviceRoleClient(ctx)
  const people = await loadPeople(db, ctx.tenantId)
  const index = reportingIndexOf(people)
  const counts = reportCounts(index)
  const ids = new Set(people.map((p) => p.id))
  const rows: OrgChartPerson[] = people.map((p) => ({
    ...personCard(p, p.id),
    manager_user_id: p.manager_user_id && ids.has(p.manager_user_id) ? p.manager_user_id : null,
    manager_source: p.manager_source,
    employee_id: p.employee_id,
    cost_center: p.cost_center,
    profile_source: p.profile_source,
    direct_reports: counts.get(p.id)?.direct ?? 0,
    total_reports: counts.get(p.id)?.total ?? 0,
  }))
  rows.sort((a, b) => String(a.display_name ?? a.email ?? '').localeCompare(String(b.display_name ?? b.email ?? '')))
  return { people: rows, roots: chartRoots(people, index), total: rows.length }
}

export interface SubordinateView extends PersonCard {
  depth: number
  manager_user_id: string | null
}

/**
 * People who report to `userId` — `depth: 'direct'` (default) or `'all'`
 * (every level, capped at 10), optionally with the person first (depth 0).
 * Own: anyone; others: org.view or team.view_members.
 */
export async function getSubordinates(ctx: ServiceContext, userIdOrMe: string, options: { depth?: SubordinateDepth; includeSelf?: boolean } = {}) {
  const userId = resolveUserId(ctx, userIdOrMe)
  requireOrgViewFor(ctx, userId)
  const { snap } = await snapshot(ctx, ['people'])
  requireMember(snap, userId)
  const byId = peopleById(snap)
  const index = reportingIndexOf(snap.people)
  const subs = subordinatesOf(index, userId, { depth: options.depth ?? 'direct', includeSelf: options.includeSelf })
  return {
    user_id: userId,
    depth: options.depth ?? 'direct',
    include_self: options.includeSelf === true,
    people: subs.map((s): SubordinateView => ({ ...personCard(byId.get(s.user_id), s.user_id), depth: s.depth, manager_user_id: s.manager_user_id })),
    total: subs.length,
  }
}

/** `userId`'s managers, nearest first. Own: anyone; others: org.view or team.view_members. */
export async function getManagerChain(ctx: ServiceContext, userIdOrMe: string) {
  const userId = resolveUserId(ctx, userIdOrMe)
  requireOrgViewFor(ctx, userId)
  const { snap } = await snapshot(ctx, ['people'])
  requireMember(snap, userId)
  const byId = peopleById(snap)
  const chain = managerChainOf(reportingIndexOf(snap.people), userId)
  return { user_id: userId, chain: chain.map((id) => personCard(byId.get(id), id)) }
}

/** Others with the same manager. Own: anyone; others: org.view or team.view_members. */
export async function getPeers(ctx: ServiceContext, userIdOrMe: string) {
  const userId = resolveUserId(ctx, userIdOrMe)
  requireOrgViewFor(ctx, userId)
  const { snap } = await snapshot(ctx, ['people'])
  const person = requireMember(snap, userId)
  const byId = peopleById(snap)
  const peers = peersOf(reportingIndexOf(snap.people), userId)
  return { user_id: userId, manager_user_id: person.manager_user_id, peers: peers.map((id) => personCard(byId.get(id), id)) }
}

/**
 * One person in context: attributes, manager chain, direct reports, peers,
 * teams, org units and (with projects.view, or for yourself) projects.
 * Own: anyone; others: org.view or team.view_members.
 */
export async function getPerson(ctx: ServiceContext, userIdOrMe: string) {
  const userId = resolveUserId(ctx, userIdOrMe)
  requireOrgViewFor(ctx, userId)
  const { snap } = await snapshot(ctx)
  const person = requireMember(snap, userId)
  const byId = peopleById(snap)
  const index = reportingIndexOf(snap.people)
  const counts = reportCounts(index)
  const teamTree = buildTree(snap.teams)
  const teamsById = new Map(snap.teams.map((t) => [t.id, t]))
  const unitsById = new Map(snap.units.map((u) => [u.id, u]))
  const unitTree = buildTree(snap.units)
  const showProjects = userId === ctx.actorId || hasPerm(ctx, 'projects.view')
  const projectsById = new Map(snap.projects.map((p) => [p.id, p]))
  return {
    ...personCard(person, userId),
    employee_id: person.employee_id,
    cost_center: person.cost_center,
    profile_source: person.profile_source,
    manager_user_id: person.manager_user_id,
    manager_source: person.manager_source,
    direct_report_count: counts.get(userId)?.direct ?? 0,
    total_report_count: counts.get(userId)?.total ?? 0,
    manager_chain: managerChainOf(index, userId).map((id) => personCard(byId.get(id), id)),
    direct_reports: subordinatesOf(index, userId).map((s) => personCard(byId.get(s.user_id), s.user_id)),
    peers: peersOf(index, userId).map((id) => personCard(byId.get(id), id)),
    teams: teamsOfUser(snap, userId).map((id) => {
      const t = teamsById.get(id)
      const membership = snap.teamMembers.find((m) => m.team_id === id && m.user_id === userId)
      return { id, name: t?.name ?? '', kind: t?.kind ?? 'team', colour: t?.colour ?? null, role: membership?.role ?? null, is_lead: t?.lead_user_id === userId, path: ancestorIds(teamTree, id).reverse().map((a) => teamsById.get(a)?.name ?? '') }
    }),
    org_units: orgUnitsOfUser(snap, userId).map((id) => {
      const u = unitsById.get(id)
      const membership = snap.unitMembers.find((m) => m.org_unit_id === id && m.user_id === userId)
      return { id, name: u?.name ?? '', kind: u?.kind ?? 'unit', role: membership?.role ?? null, is_primary: membership?.is_primary ?? false, is_head: u?.head_user_id === userId, path: ancestorIds(unitTree, id).reverse().map((a) => unitsById.get(a)?.name ?? '') }
    }),
    projects: showProjects
      ? projectsOfUser(snap, userId).map((p) => {
        const project = projectsById.get(p.project_id)
        return { id: p.project_id, name: project?.name ?? '', key: project?.key ?? '', status: project?.status ?? 'active', colour: project?.colour ?? null, role: p.role, direct: p.direct, via_team_ids: p.via_team_ids }
      })
      : null,
  }
}

/* ── People attributes ── */

export interface PersonProfilePatch {
  job_title?: string | null
  department?: string | null
  location?: string | null
  employee_id?: string | null
  cost_center?: string | null
  /** Set (or clear with null) the manager — org.manage or team.change_roles. */
  manager_user_id?: string | null
}

const PROFILE_LIMITS: Record<ProfileField, number> = { job_title: 200, department: 200, location: 200, employee_id: 100, cost_center: 100 }

export function cleanProfileValue(field: ProfileField, raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const value = String(raw).replace(/\s+/g, ' ').trim()
  if (!value) return null
  if (value.length > PROFILE_LIMITS[field]) throw ServiceError.validation(`${field} is too long (max ${PROFILE_LIMITS[field]} characters)`)
  return value
}

/**
 * Edit a member's attributes (org.manage) and/or manager. Attributes the
 * directory owns (profile_source 'directory') are refused until detached.
 */
export async function updatePersonProfile(ctx: ServiceContext, userIdOrMe: string, patch: PersonProfilePatch) {
  const userId = resolveUserId(ctx, userIdOrMe)
  const fields = PROFILE_FIELDS.filter((f) => patch[f] !== undefined)
  const managerChange = patch.manager_user_id !== undefined
  if (!fields.length && !managerChange) throw ServiceError.validation('No fields to update')
  if (fields.length) requirePerm(ctx, 'org.manage')
  if (managerChange && !hasPerm(ctx, 'org.manage')) requirePerm(ctx, 'team.change_roles')

  const db = await serviceRoleClient(ctx)
  const { data: row, error } = await (db as any).from('user_memberships')
    .select('user_id, is_active, job_title, department, location, employee_id, cost_center, profile_source')
    .eq('tenant_id', ctx.tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw dbError(error)
  if (!row || row.is_active === false) throw ServiceError.notFound('User is not a member of this workspace')

  if (fields.length) {
    const updates: Record<string, unknown> = {}
    const diff: Record<string, { before: unknown; after: unknown }> = {}
    for (const field of fields) {
      const next = cleanProfileValue(field, patch[field])
      if ((row[field] ?? null) === next) continue
      updates[field] = next
      diff[field] = { before: row[field] ?? null, after: next }
    }
    if (Object.keys(updates).length) {
      if (row.profile_source === 'directory') {
        throw ServiceError.conflict('These attributes come from the directory. Detach them first to edit them here (directory sync then stops updating them).')
      }
      updates.profile_source = 'manual'
      updates.profile_updated_at = new Date().toISOString()
      const { error: updateError } = await (db as any).from('user_memberships').update(updates).eq('tenant_id', ctx.tenantId).eq('user_id', userId)
      if (updateError) throw dbError(updateError)
      await audit(ctx, { objectType: 'member', objectId: userId, action: 'update', summary: 'Updated profile attributes', diff })
    }
  }
  if (managerChange) {
    const { setManager } = await import('./manager-tasks')
    await setManager(ctx, userId, patch.manager_user_id ?? null)
  }
  return getPerson(ctx, userId)
}

/** Stop directory sync from updating a member's attributes; they become editable here. org.manage. */
export async function detachPersonProfile(ctx: ServiceContext, userIdOrMe: string) {
  requirePerm(ctx, 'org.manage')
  const userId = resolveUserId(ctx, userIdOrMe)
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('user_memberships')
    .update({ profile_source: 'manual', profile_updated_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId).eq('user_id', userId).eq('profile_source', 'directory').select('user_id')
  if (error) throw dbError(error)
  const detached = (data ?? []).length > 0
  if (detached) await audit(ctx, { objectType: 'member', objectId: userId, action: 'update', summary: 'Detached profile attributes from the directory' })
  return { detached, user_id: userId }
}

/* ── Org units ── */

export interface OrgUnitView {
  id: string
  name: string
  kind: string
  parent_id: string | null
  head_user_id: string | null
  head: PersonCard | null
  description: string | null
  source: string
  external_id: string | null
  detached: boolean
  /** Imported and not detached: read-only here. */
  read_only: boolean
  sort: number
  depth: number
  child_ids: string[]
  /** Members of the unit itself. */
  member_count: number
  /** Distinct members of the unit and every unit below. */
  headcount: number
  team_ids: string[]
}

function unitViews(snap: OrgSnapshot): { units: OrgUnitView[]; roots: string[] } {
  const tree = buildTree(snap.units)
  const counts = unitHeadcounts(snap, tree)
  const byId = peopleById(snap)
  const order = (ids: string[]) => ids.slice().sort((a, b) => {
    const ua = snap.units.find((u) => u.id === a)!
    const ub = snap.units.find((u) => u.id === b)!
    return ua.sort - ub.sort || ua.name.localeCompare(ub.name)
  })
  const units = snap.units.map((u): OrgUnitView => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    parent_id: tree.parentOf.get(u.id) ?? null,
    head_user_id: u.head_user_id,
    head: u.head_user_id ? personCard(byId.get(u.head_user_id), u.head_user_id) : null,
    description: u.description,
    source: u.source,
    external_id: u.external_id,
    detached: u.detached,
    read_only: u.source !== 'manual' && !u.detached,
    sort: u.sort,
    depth: depthOf(tree, u.id),
    child_ids: order(tree.childrenOf.get(u.id) ?? []),
    member_count: counts.get(u.id)?.direct ?? 0,
    headcount: counts.get(u.id)?.total ?? 0,
    team_ids: snap.teams.filter((t) => t.org_unit_id === u.id).map((t) => t.id),
  }))
  return { units, roots: order(tree.roots) }
}

/** Every org unit with head, depth, children and headcounts, plus the roots. org.view. */
export async function getOrgUnitTree(ctx: ServiceContext) {
  requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx, ['people', 'units', 'teams'])
  const { units, roots } = unitViews(snap)
  return { units, roots, total: units.length }
}

/** One org unit with its path, children, direct members, teams and projects. org.view. */
export async function getOrgUnit(ctx: ServiceContext, unitId: string) {
  requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx)
  const { units } = unitViews(snap)
  const unit = units.find((u) => u.id === unitId)
  if (!unit) throw ServiceError.notFound('Org unit not found')
  const tree = buildTree(snap.units)
  const unitsById = new Map(units.map((u) => [u.id, u]))
  const byId = peopleById(snap)
  return {
    ...unit,
    path: ancestorIds(tree, unitId).reverse().map((id) => ({ id, name: unitsById.get(id)?.name ?? '' })),
    children: unit.child_ids.map((id) => unitsById.get(id)!).filter(Boolean),
    members: snap.unitMembers.filter((m) => m.org_unit_id === unitId).map((m) => ({ ...personCard(byId.get(m.user_id), m.user_id), role: m.role, is_primary: m.is_primary, source: m.source })),
    teams: snap.teams.filter((t) => t.org_unit_id === unitId).map((t) => ({ id: t.id, name: t.name, kind: t.kind, colour: t.colour })),
    projects: hasPerm(ctx, 'projects.view')
      ? snap.projects.filter((p) => p.org_unit_id === unitId).map((p) => ({ id: p.id, name: p.name, key: p.key, status: p.status }))
      : null,
  }
}

/** Members of an org unit; with `recursive`, also everyone in the units below. org.view. */
export async function getOrgUnitMembers(ctx: ServiceContext, unitId: string, options: { recursive?: boolean } = {}) {
  requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx, ['people', 'units'])
  if (!snap.units.some((u) => u.id === unitId)) throw ServiceError.notFound('Org unit not found')
  const byId = peopleById(snap)
  const members = orgUnitMembersOf(snap, unitId, { recursive: options.recursive })
  return {
    org_unit_id: unitId,
    recursive: options.recursive === true,
    members: members.map((m) => ({ ...personCard(byId.get(m.user_id), m.user_id), role: m.role, direct: m.direct, via_unit_ids: m.via })),
    total: members.length,
  }
}

export interface OrgUnitInput {
  name: string
  kind?: string | null
  parent_id?: string | null
  head_user_id?: string | null
  description?: string | null
  sort?: number | null
}

function cleanUnitName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!name) throw ServiceError.validation('Org unit name is required')
  if (name.length > 200) throw ServiceError.validation('Org unit name too long (max 200 characters)')
  return name
}

export function cleanKind(raw: unknown, fallback: string): string {
  const kind = String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!kind) return fallback
  if (kind.length > 50) throw ServiceError.validation('Kind too long (max 50 characters)')
  return kind
}

async function loadUnit(ctx: ServiceContext, db: any, unitId: string) {
  const { data, error } = await db.from('org_units').select(ORG_UNIT_COLUMNS).eq('id', unitId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Org unit not found')
  return toUnit(data)
}

function assertEditable(unit: { source: string; detached: boolean; name: string }) {
  if (unit.source !== 'manual' && !unit.detached) {
    throw ServiceError.conflict(`"${unit.name}" comes from ${unit.source === 'csv' ? 'a CSV import' : 'the directory'}. Detach it first to edit it here.`)
  }
}

async function assertActiveMember(ctx: ServiceContext, db: any, userId: string, what: string) {
  const { data, error } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', ctx.tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw dbError(error)
  if (!data || data.is_active === false) throw ServiceError.validation(`${what} must be an active member of this workspace`)
}

function mapUnitDbError(error: { message?: string } | null): Error {
  const message = error?.message ?? ''
  if (/org_unit_cycle|org_unit_parent_tenant|org_unit_head_not_member|org_unit_depth/.test(message)) return ServiceError.validation(message.replace(/^.*?: /, ''))
  if (/uq_org_units_source_external|duplicate key/i.test(message)) return ServiceError.conflict('An org unit with that external id already exists')
  return dbError(error)
}

async function checkUnitParent(ctx: ServiceContext, db: any, unitId: string | null, parentId: string | null | undefined): Promise<string | null> {
  if (!parentId) return null
  if (unitId && parentId === unitId) throw ServiceError.validation('An org unit cannot be its own parent')
  const { data, error } = await db.from('org_units').select('id, parent_id').eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  const rows = (data ?? []) as Array<{ id: string; parent_id: string | null }>
  if (!rows.some((r) => r.id === parentId)) throw ServiceError.validation('Parent org unit not found')
  if (unitId && wouldCreateTreeCycle(buildTree(rows), unitId, parentId)) throw ServiceError.validation('That unit is inside this one — moving it there would create a loop')
  return parentId
}

export async function createOrgUnit(ctx: ServiceContext, input: OrgUnitInput) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const name = cleanUnitName(input.name)
  const parentId = await checkUnitParent(ctx, db, null, input.parent_id)
  if (input.head_user_id) await assertActiveMember(ctx, db, input.head_user_id, 'The head')
  const { data, error } = await (db as any).from('org_units').insert({
    tenant_id: ctx.tenantId,
    name,
    kind: cleanKind(input.kind, 'unit'),
    parent_id: parentId,
    head_user_id: input.head_user_id || null,
    description: String(input.description ?? '').trim() || null,
    sort: Number.isFinite(Number(input.sort)) ? Math.trunc(Number(input.sort)) : 0,
    source: 'manual',
    created_by: ctx.actorId,
  }).select(ORG_UNIT_COLUMNS).single()
  if (error || !data) throw mapUnitDbError(error)
  await audit(ctx, { objectType: 'org_unit', objectId: data.id, action: 'create', summary: `Created org unit "${name}"` })
  return toUnit(data)
}

export type OrgUnitUpdateInput = Partial<OrgUnitInput>

export async function updateOrgUnit(ctx: ServiceContext, unitId: string, input: OrgUnitUpdateInput) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const unit = await loadUnit(ctx, db, unitId)
  assertEditable(unit)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = cleanUnitName(input.name)
  if (input.kind !== undefined) updates.kind = cleanKind(input.kind, 'unit')
  if (input.parent_id !== undefined) updates.parent_id = await checkUnitParent(ctx, db, unitId, input.parent_id)
  if (input.head_user_id !== undefined) {
    if (input.head_user_id) await assertActiveMember(ctx, db, input.head_user_id, 'The head')
    updates.head_user_id = input.head_user_id || null
  }
  if (input.description !== undefined) updates.description = String(input.description ?? '').trim() || null
  if (input.sort !== undefined) updates.sort = Number.isFinite(Number(input.sort)) ? Math.trunc(Number(input.sort)) : 0
  if (!Object.keys(updates).length) throw ServiceError.validation('No fields to update')
  const { data, error } = await (db as any).from('org_units').update(updates).eq('id', unitId).eq('tenant_id', ctx.tenantId).select(ORG_UNIT_COLUMNS).single()
  if (error || !data) throw mapUnitDbError(error)
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of Object.keys(updates)) diff[key] = { before: (unit as any)[key] ?? null, after: (data as any)[key] ?? null }
  await audit(ctx, {
    objectType: 'org_unit', objectId: unitId, action: updates.parent_id !== undefined && unit.parent_id !== updates.parent_id ? 'move' : 'update',
    summary: `Updated org unit "${data.name}"`, diff,
  })
  return toUnit(data)
}

/**
 * Delete an org unit. Its sub-units move up to its parent and its teams /
 * projects lose the link; memberships go with it. Imported units must be
 * detached first (the next sync would recreate them otherwise).
 */
export async function deleteOrgUnit(ctx: ServiceContext, unitId: string) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const unit = await loadUnit(ctx, db, unitId)
  assertEditable(unit)
  const { error: moveError } = await (db as any).from('org_units').update({ parent_id: unit.parent_id }).eq('tenant_id', ctx.tenantId).eq('parent_id', unitId)
  if (moveError) throw mapUnitDbError(moveError)
  const { error } = await (db as any).from('org_units').delete().eq('id', unitId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to delete org unit')
  await audit(ctx, { objectType: 'org_unit', objectId: unitId, action: 'delete', summary: `Deleted org unit "${unit.name}"` })
  return { deleted: true as const, id: unitId }
}

/** Make an imported org unit manual: editable here, no longer updated by its source. org.manage. */
export async function detachOrgUnit(ctx: ServiceContext, unitId: string) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const unit = await loadUnit(ctx, db, unitId)
  if (unit.source === 'manual' || unit.detached) return { ...unit, detached: unit.detached, already: true }
  const { data, error } = await (db as any).from('org_units').update({ detached: true }).eq('id', unitId).eq('tenant_id', ctx.tenantId).select(ORG_UNIT_COLUMNS).single()
  if (error || !data) throw dbError(error)
  await audit(ctx, { objectType: 'org_unit', objectId: unitId, action: 'update', summary: `Detached org unit "${unit.name}" from ${unit.source}` })
  return { ...toUnit(data), already: false }
}

/** Add (or update the role / primary flag of) a member of an org unit. org.manage. */
export async function addOrgUnitMember(ctx: ServiceContext, unitId: string, userId: string, options: { role?: string | null; is_primary?: boolean } = {}) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const unit = await loadUnit(ctx, db, unitId)
  await assertActiveMember(ctx, db, userId, 'The person')
  const role = options.role === undefined || options.role === null ? null : (String(options.role).trim().slice(0, 100) || null)
  if (options.is_primary) {
    const { error } = await (db as any).from('org_unit_members').update({ is_primary: false }).eq('tenant_id', ctx.tenantId).eq('user_id', userId).eq('is_primary', true)
    if (error) throw dbError(error)
  }
  const { data: existing } = await (db as any).from('org_unit_members').select('org_unit_id').eq('org_unit_id', unitId).eq('user_id', userId).maybeSingle()
  const row = { org_unit_id: unitId, user_id: userId, tenant_id: ctx.tenantId, role, is_primary: Boolean(options.is_primary) }
  const { error } = existing
    ? await (db as any).from('org_unit_members').update({ role, is_primary: row.is_primary }).eq('org_unit_id', unitId).eq('user_id', userId)
    : await (db as any).from('org_unit_members').insert({ ...row, source: 'manual' })
  if (error) throw mapUnitDbError(error)
  await audit(ctx, { objectType: 'org_unit', objectId: unitId, action: 'grant', summary: `${existing ? 'Updated a member of' : 'Added a member to'} org unit "${unit.name}"`, metadata: { user_id: userId, role, is_primary: row.is_primary } })
  return { added: true, already_member: Boolean(existing), org_unit_id: unitId, user_id: userId }
}

export async function removeOrgUnitMember(ctx: ServiceContext, unitId: string, userId: string) {
  requirePerm(ctx, 'org.manage')
  const db = await serviceRoleClient(ctx)
  const unit = await loadUnit(ctx, db, unitId)
  const { data, error } = await (db as any).from('org_unit_members').delete().eq('org_unit_id', unitId).eq('user_id', userId).eq('tenant_id', ctx.tenantId).select('user_id')
  if (error) throw dbError(error)
  const removed = (data ?? []).length > 0
  if (removed) await audit(ctx, { objectType: 'org_unit', objectId: unitId, action: 'revoke', summary: `Removed a member from org unit "${unit.name}"`, metadata: { user_id: userId } })
  return { removed, org_unit_id: unitId, user_id: userId }
}

/* ── Teams ── */

export interface TeamTreeNode {
  id: string
  name: string
  description: string | null
  kind: string
  colour: string | null
  parent_id: string | null
  depth: number
  child_ids: string[]
  lead_user_id: string | null
  lead: PersonCard | null
  org_unit_id: string | null
  org_unit_name: string | null
  member_count: number
  /** Distinct members including every sub-team. */
  total_member_count: number
  /** Up to 12 members (lead first) for avatar stacks. */
  member_preview: PersonCard[]
  project_ids: string[]
}

/** Every team with lead, org unit, counts, a member preview and projects, plus the roots. team.view_members or org.view. */
export async function getTeamTree(ctx: ServiceContext) {
  if (!hasPerm(ctx, 'team.view_members')) requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx)
  const tree = buildTree(snap.teams)
  const byId = peopleById(snap)
  const unitNames = new Map(snap.units.map((u) => [u.id, u.name]))
  const showProjects = hasPerm(ctx, 'projects.view')
  const sortIds = (ids: string[]) => ids.slice().sort((a, b) => (snap.teams.find((t) => t.id === a)?.name ?? '').localeCompare(snap.teams.find((t) => t.id === b)?.name ?? ''))
  const teams = snap.teams.map((t): TeamTreeNode => {
    const direct = snap.teamMembers.filter((m) => m.team_id === t.id).map((m) => m.user_id)
    const total = teamMembersOf(snap, t.id, { recursive: true, tree }).length
    const previewIds = Array.from(new Set([...(t.lead_user_id && direct.includes(t.lead_user_id) ? [t.lead_user_id] : []), ...direct])).slice(0, 12)
    return {
      id: t.id, name: t.name, description: t.description, kind: t.kind, colour: t.colour,
      parent_id: tree.parentOf.get(t.id) ?? null, depth: depthOf(tree, t.id), child_ids: sortIds(tree.childrenOf.get(t.id) ?? []),
      lead_user_id: t.lead_user_id, lead: t.lead_user_id ? personCard(byId.get(t.lead_user_id), t.lead_user_id) : null,
      org_unit_id: t.org_unit_id, org_unit_name: t.org_unit_id ? unitNames.get(t.org_unit_id) ?? null : null,
      member_count: direct.length, total_member_count: total,
      member_preview: previewIds.map((id) => personCard(byId.get(id), id)),
      project_ids: showProjects ? snap.projects.filter((p) => p.status !== 'archived' && (p.team_id === t.id || snap.projectTeams.some((pt) => pt.project_id === p.id && pt.team_id === t.id))).map((p) => p.id) : [],
    }
  })
  return { teams, roots: sortIds(tree.roots), total: teams.length }
}

/** Members of a team; with `recursive`, also everyone in its sub-teams. team.view_members or org.view. */
export async function getTeamMembers(ctx: ServiceContext, teamId: string, options: { recursive?: boolean } = {}) {
  if (!hasPerm(ctx, 'team.view_members')) requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx, ['people', 'teams'])
  if (!snap.teams.some((t) => t.id === teamId)) throw ServiceError.notFound('Team not found')
  const byId = peopleById(snap)
  const members = teamMembersOf(snap, teamId, { recursive: options.recursive })
  return {
    team_id: teamId,
    recursive: options.recursive === true,
    members: members.map((m) => ({ ...personCard(byId.get(m.user_id), m.user_id), role: m.role, direct: m.direct, via_team_ids: m.via })),
    total: members.length,
  }
}

/** Teams a person is in (with the teams above them). Own: anyone; others: org.view or team.view_members. */
export async function getMyTeams(ctx: ServiceContext, userIdOrMe = 'me') {
  const userId = resolveUserId(ctx, userIdOrMe)
  requireOrgViewFor(ctx, userId)
  const { snap } = await snapshot(ctx, ['teams'])
  const tree = buildTree(snap.teams)
  const direct = new Set(teamsOfUser(snap, userId))
  const byId = new Map(snap.teams.map((t) => [t.id, t]))
  return {
    user_id: userId,
    teams: teamsOfUser(snap, userId, { includeParents: true, tree }).map((id) => {
      const t = byId.get(id)!
      return { id, name: t.name, kind: t.kind, colour: t.colour, parent_id: t.parent_id, direct: direct.has(id), is_lead: t.lead_user_id === userId, role: snap.teamMembers.find((m) => m.team_id === id && m.user_id === userId)?.role ?? null }
    }),
  }
}

/* ── People scopes ── */

export type PeopleScopeInput =
  | 'me' | 'direct_reports' | 'all_reports'
  | PeopleScope

function normaliseScope(scope: PeopleScopeInput): PeopleScope {
  if (scope === 'me' || scope === 'direct_reports' || scope === 'all_reports') return { kind: scope } as PeopleScope
  return scope
}

/**
 * The people a scope covers, for the caller: 'me', 'direct_reports',
 * 'all_reports' (the people I manage — no permission needed), a team
 * (team.view_members, org.view or being in it), an org unit (org.view or
 * being in it) or a project (projects.view or being on it). The task
 * tracker's "my team" / "project team" filters resolve through here.
 */
export async function resolvePeopleScope(ctx: ServiceContext, scopeInput: PeopleScopeInput) {
  const scope = normaliseScope(scopeInput)
  if (!ctx.actorId && (scope.kind === 'me' || scope.kind === 'direct_reports' || scope.kind === 'all_reports')) {
    throw ServiceError.validation('This scope needs a user-bound credential')
  }
  const { snap } = await snapshot(ctx)
  const viewer = ctx.actorId ?? ''
  const ids = resolveScopeIds(snap, viewer, scope)
  const inScope = viewer ? ids.includes(viewer) : false
  if (scope.kind === 'team') {
    if (!snap.teams.some((t) => t.id === scope.team_id)) throw ServiceError.notFound('Team not found')
    if (!inScope && !hasPerm(ctx, 'team.view_members')) requirePerm(ctx, 'org.view')
  } else if (scope.kind === 'org_unit') {
    if (!snap.units.some((u) => u.id === scope.org_unit_id)) throw ServiceError.notFound('Org unit not found')
    if (!inScope) requirePerm(ctx, 'org.view')
  } else if (scope.kind === 'project') {
    const project = snap.projects.find((p) => p.id === scope.project_id)
    if (!project) throw ServiceError.notFound('Project not found')
    const isOwner = viewer && (project.owner_user_id === viewer || project.sponsor_user_id === viewer)
    if (!inScope && !isOwner) requirePerm(ctx, 'projects.view')
  }
  const byId = peopleById(snap)
  const members = ids.filter((id) => byId.has(id))
  return { scope, user_ids: members, people: members.map((id) => personCard(byId.get(id), id)), total: members.length }
}

/** The user ids of the people the caller manages (direct, or every level). Empty for non-managers. */
export async function peopleIManage(ctx: ServiceContext, options: { depth?: SubordinateDepth } = {}): Promise<string[]> {
  if (!ctx.actorId) return []
  const { snap } = await snapshot(ctx, ['people'])
  return subordinatesOf(reportingIndexOf(snap.people), ctx.actorId, { depth: options.depth ?? 'all' }).map((s) => s.user_id)
}

/** Can the caller see the org chart at all (nav, page gate)? */
export function canSeeOrg(ctx: ServiceContext): boolean {
  return canViewOrg(ctx) || hasPerm(ctx, 'projects.view')
}

/** Unit ids below (and including) `unitId` — for callers that filter by unit. */
export async function orgUnitSubtreeIds(ctx: ServiceContext, unitId: string): Promise<string[]> {
  requirePerm(ctx, 'org.view')
  const { snap } = await snapshot(ctx, ['units'])
  return descendantIds(buildTree(snap.units), unitId)
}
