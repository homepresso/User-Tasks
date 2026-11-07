/**
 * Projects: a named piece of work with an owner, optional sponsor, owning
 * team and org unit, dates and a status, plus its people — direct members
 * (role, allocation) and whole attached teams. Shared by /api/v1/projects,
 * the MCP projects_* tools, the CLI (through REST) and the Organization page.
 *
 * Permissions: projects.view reads every project; anyone reads the projects
 * they're on (member, owner, sponsor or through a team) — getMyProjects and
 * getProject for those. projects.manage creates, edits, archives and deletes
 * projects and manages their members and teams.
 *
 * Service-role client with explicit tenant filters, after the checks here.
 */

import { loadOrgSnapshot, PROJECT_COLUMNS, toProject } from '@/lib/org/load'
import { projectMembersOf, projectsOfUser, projectTeamIdsOf, PROJECT_STATUSES, teamMembersOf, buildTree, type OrgSnapshot, type ProjectStatus } from '@/lib/org/structure'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { personCard, type PersonCard } from './org'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export interface ProjectInput {
  name: string
  key?: string | null
  description?: string | null
  status?: ProjectStatus
  owner_user_id?: string | null
  sponsor_user_id?: string | null
  team_id?: string | null
  org_unit_id?: string | null
  start_date?: string | null
  end_date?: string | null
  colour?: string | null
}

export type ProjectUpdateInput = Partial<ProjectInput>

export interface ProjectSummary {
  id: string
  name: string
  key: string
  description: string | null
  status: ProjectStatus
  colour: string | null
  start_date: string | null
  end_date: string | null
  archived_at: string | null
  owner: PersonCard | null
  sponsor: PersonCard | null
  team: { id: string; name: string; colour: string | null } | null
  org_unit: { id: string; name: string } | null
  team_ids: string[]
  member_count: number
  /** Distinct people: direct members plus attached teams' members. */
  people_count: number
  member_preview: PersonCard[]
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const COLOUR_RE = /^#[0-9A-Fa-f]{6}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!name) throw ServiceError.validation('Project name is required')
  if (name.length > 200) throw ServiceError.validation('Project name too long (max 200 characters)')
  return name
}

/** A key from the name: initials of the words (ACME Mobile App → AMA), else the first letters. */
export function suggestProjectKey(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  const initials = words.map((w) => w[0]).join('').toUpperCase()
  const key = (words.length > 1 ? initials : (words[0] ?? 'PRJ').slice(0, 6).toUpperCase()).slice(0, 10)
  return KEY_RE.test(key) ? key : 'PRJ'
}

function cleanKey(raw: unknown): string {
  const key = String(raw ?? '').trim()
  if (!KEY_RE.test(key)) throw ServiceError.validation('Project key: 1–40 letters, digits, - or _, starting with a letter or digit')
  return key
}

function cleanDate(raw: unknown, field: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = String(raw).slice(0, 10)
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw ServiceError.validation(`${field} must be a date (YYYY-MM-DD)`)
  return value
}

function cleanColour(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = String(raw).trim()
  if (!COLOUR_RE.test(value)) throw ServiceError.validation('Colour must be a hex colour like #3366FF')
  return value.toUpperCase()
}

function cleanStatus(raw: unknown): ProjectStatus {
  const value = String(raw ?? '').trim()
  if (!(PROJECT_STATUSES as readonly string[]).includes(value)) throw ServiceError.validation(`Status must be one of ${PROJECT_STATUSES.join(', ')}`)
  return value as ProjectStatus
}

function mapProjectDbError(error: { message?: string; code?: string } | null): Error {
  const message = error?.message ?? ''
  if (/uq_projects_tenant_key/.test(message) || (error?.code === '23505' && /key/.test(message))) return ServiceError.conflict('Another project already uses that key')
  if (/project_team_tenant|project_org_unit_tenant|org_member_not_member|projects_dates_check/.test(message)) {
    if (/projects_dates_check/.test(message)) return ServiceError.validation('The end date must be on or after the start date')
    return ServiceError.validation(message.replace(/^.*?: /, ''))
  }
  return dbError(error)
}

async function snapshot(ctx: ServiceContext) {
  const db = await serviceRoleClient(ctx)
  return { db, snap: await loadOrgSnapshot(db, ctx.tenantId) }
}

function summarise(snap: OrgSnapshot, projectId: string): ProjectSummary {
  const p = snap.projects.find((x) => x.id === projectId)!
  const people = new Map(snap.people.map((x) => [x.id, x]))
  const teams = new Map(snap.teams.map((t) => [t.id, t]))
  const units = new Map(snap.units.map((u) => [u.id, u]))
  const tree = buildTree(snap.teams)
  const members = projectMembersOf(snap, projectId, { teamTree: tree })
  const direct = members.filter((m) => m.direct)
  const previewIds = [...direct, ...members.filter((m) => !m.direct)].map((m) => m.user_id).slice(0, 12)
  const team = p.team_id ? teams.get(p.team_id) : undefined
  const unit = p.org_unit_id ? units.get(p.org_unit_id) : undefined
  return {
    id: p.id, name: p.name, key: p.key, description: p.description, status: p.status, colour: p.colour,
    start_date: p.start_date, end_date: p.end_date, archived_at: p.archived_at,
    owner: p.owner_user_id ? personCard(people.get(p.owner_user_id), p.owner_user_id) : null,
    sponsor: p.sponsor_user_id ? personCard(people.get(p.sponsor_user_id), p.sponsor_user_id) : null,
    team: team ? { id: team.id, name: team.name, colour: team.colour } : null,
    org_unit: unit ? { id: unit.id, name: unit.name } : null,
    team_ids: projectTeamIdsOf(snap, projectId),
    member_count: direct.length,
    people_count: members.length,
    member_preview: previewIds.map((id) => personCard(people.get(id), id)),
  }
}

function isOnProject(snap: OrgSnapshot, projectId: string, userId: string | null): boolean {
  if (!userId) return false
  return projectsOfUser(snap, userId, { includeArchived: true }).some((p) => p.project_id === projectId)
}

function requireProjectRead(ctx: ServiceContext, snap: OrgSnapshot, projectId: string) {
  if (!snap.projects.some((p) => p.id === projectId)) throw ServiceError.notFound('Project not found')
  if (hasPerm(ctx, 'projects.view') || isOnProject(snap, projectId, ctx.actorId)) return
  requirePerm(ctx, 'projects.view')
}

export interface ProjectListFilters {
  status?: ProjectStatus[] | null
  include_archived?: boolean
  team_id?: string | null
  org_unit_id?: string | null
  q?: string | null
}

/** Projects with owner, team, counts and a member preview. projects.view. */
export async function listProjects(ctx: ServiceContext, filters: ProjectListFilters = {}) {
  requirePerm(ctx, 'projects.view')
  const { snap } = await snapshot(ctx)
  const q = String(filters.q ?? '').trim().toLowerCase()
  const statuses = filters.status?.length ? new Set(filters.status) : null
  const projects = snap.projects
    .filter((p) => (statuses ? statuses.has(p.status) : filters.include_archived || p.status !== 'archived'))
    .filter((p) => !filters.team_id || projectTeamIdsOf(snap, p.id).includes(filters.team_id))
    .filter((p) => !filters.org_unit_id || p.org_unit_id === filters.org_unit_id)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => summarise(snap, p.id))
  return { projects, total: projects.length }
}

/** Projects a person is on (member, owner, sponsor or via a team). Own: anyone; others: projects.view. */
export async function getMyProjects(ctx: ServiceContext, userIdOrMe = 'me', options: { include_archived?: boolean } = {}) {
  const userId = userIdOrMe === 'me' ? ctx.actorId : userIdOrMe
  if (!userId) throw ServiceError.validation('`me` needs a user-bound credential')
  if (userId !== ctx.actorId) requirePerm(ctx, 'projects.view')
  const { snap } = await snapshot(ctx)
  const mine = projectsOfUser(snap, userId, { includeArchived: options.include_archived })
  return {
    user_id: userId,
    projects: mine.map((m) => ({ ...summarise(snap, m.project_id), my_role: m.role, direct: m.direct, via_team_ids: m.via_team_ids })),
  }
}

/** A project with its people (direct members and attached teams' members) and teams. projects.view, or on the project. */
export async function getProject(ctx: ServiceContext, projectId: string) {
  const { snap } = await snapshot(ctx)
  requireProjectRead(ctx, snap, projectId)
  const people = new Map(snap.people.map((x) => [x.id, x]))
  const tree = buildTree(snap.teams)
  const teams = new Map(snap.teams.map((t) => [t.id, t]))
  const summary = summarise(snap, projectId)
  return {
    ...summary,
    members: projectMembersOf(snap, projectId, { teamTree: tree }).map((m) => ({
      ...personCard(people.get(m.user_id), m.user_id), role: m.role, allocation_percent: m.allocation_percent, direct: m.direct, via_team_ids: m.via_team_ids,
    })),
    teams: projectTeamIdsOf(snap, projectId).map((id) => {
      const t = teams.get(id)
      const members = teamMembersOf(snap, id, { recursive: true, tree })
      return {
        id, name: t?.name ?? '', kind: t?.kind ?? 'team', colour: t?.colour ?? null,
        is_owning_team: summary.team?.id === id,
        lead: t?.lead_user_id ? personCard(people.get(t.lead_user_id), t.lead_user_id) : null,
        member_count: members.length,
        members: members.map((m) => ({ ...personCard(people.get(m.user_id), m.user_id), role: m.role })),
      }
    }),
  }
}

/** A project's people: direct members, and with `includeTeams` (default) its teams' members. projects.view, or on the project. */
export async function getProjectMembers(ctx: ServiceContext, projectId: string, options: { includeTeams?: boolean } = {}) {
  const { snap } = await snapshot(ctx)
  requireProjectRead(ctx, snap, projectId)
  const people = new Map(snap.people.map((x) => [x.id, x]))
  const members = projectMembersOf(snap, projectId, { includeTeams: options.includeTeams })
  return {
    project_id: projectId,
    include_teams: options.includeTeams !== false,
    members: members.map((m) => ({ ...personCard(people.get(m.user_id), m.user_id), role: m.role, allocation_percent: m.allocation_percent, direct: m.direct, via_team_ids: m.via_team_ids })),
    total: members.length,
  }
}

async function loadProjectRow(ctx: ServiceContext, db: any, projectId: string) {
  const { data, error } = await db.from('projects').select(PROJECT_COLUMNS).eq('id', projectId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Project not found')
  return toProject(data)
}

async function checkMember(ctx: ServiceContext, db: any, userId: string | null | undefined, what: string): Promise<string | null> {
  if (!userId) return null
  const { data, error } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', ctx.tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw dbError(error)
  if (!data || data.is_active === false) throw ServiceError.validation(`${what} must be an active member of this workspace`)
  return userId
}

async function checkRef(ctx: ServiceContext, db: any, table: 'teams' | 'org_units', id: string | null | undefined, what: string): Promise<string | null> {
  if (!id) return null
  const { data, error } = await db.from(table).select('id').eq('id', id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.validation(`${what} not found`)
  return id
}

async function uniqueKey(ctx: ServiceContext, db: any, base: string): Promise<string> {
  const { data } = await db.from('projects').select('key').eq('tenant_id', ctx.tenantId)
  const taken = new Set(((data ?? []) as any[]).map((r) => String(r.key).toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 36)}${i}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`
}

export async function createProject(ctx: ServiceContext, input: ProjectInput) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const name = cleanName(input.name)
  const key = input.key ? cleanKey(input.key) : await uniqueKey(ctx, db, suggestProjectKey(name))
  const status = input.status ? cleanStatus(input.status) : 'active'
  const row = {
    tenant_id: ctx.tenantId,
    name,
    key,
    description: String(input.description ?? '').trim() || null,
    status,
    owner_user_id: await checkMember(ctx, db, input.owner_user_id === undefined ? ctx.actorId : input.owner_user_id, 'The owner'),
    sponsor_user_id: await checkMember(ctx, db, input.sponsor_user_id, 'The sponsor'),
    team_id: await checkRef(ctx, db, 'teams', input.team_id, 'Team'),
    org_unit_id: await checkRef(ctx, db, 'org_units', input.org_unit_id, 'Org unit'),
    start_date: cleanDate(input.start_date, 'start_date'),
    end_date: cleanDate(input.end_date, 'end_date'),
    colour: cleanColour(input.colour),
    archived_at: status === 'archived' ? new Date().toISOString() : null,
    created_by: ctx.actorId,
  }
  if (row.start_date && row.end_date && row.end_date < row.start_date) throw ServiceError.validation('The end date must be on or after the start date')
  const { data, error } = await (db as any).from('projects').insert(row).select(PROJECT_COLUMNS).single()
  if (error || !data) throw mapProjectDbError(error)
  await audit(ctx, { objectType: 'project', objectId: data.id, action: 'create', summary: `Created project "${name}" (${key})` })
  return getProject(ctx, data.id)
}

export async function updateProject(ctx: ServiceContext, projectId: string, input: ProjectUpdateInput) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const current = await loadProjectRow(ctx, db, projectId)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = cleanName(input.name)
  if (input.key !== undefined && input.key !== null) updates.key = cleanKey(input.key)
  if (input.description !== undefined) updates.description = String(input.description ?? '').trim() || null
  if (input.status !== undefined) {
    updates.status = cleanStatus(input.status)
    if (updates.status === 'archived' && current.status !== 'archived') updates.archived_at = new Date().toISOString()
    if (updates.status !== 'archived') updates.archived_at = null
  }
  if (input.owner_user_id !== undefined) updates.owner_user_id = await checkMember(ctx, db, input.owner_user_id, 'The owner')
  if (input.sponsor_user_id !== undefined) updates.sponsor_user_id = await checkMember(ctx, db, input.sponsor_user_id, 'The sponsor')
  if (input.team_id !== undefined) updates.team_id = await checkRef(ctx, db, 'teams', input.team_id, 'Team')
  if (input.org_unit_id !== undefined) updates.org_unit_id = await checkRef(ctx, db, 'org_units', input.org_unit_id, 'Org unit')
  if (input.start_date !== undefined) updates.start_date = cleanDate(input.start_date, 'start_date')
  if (input.end_date !== undefined) updates.end_date = cleanDate(input.end_date, 'end_date')
  if (input.colour !== undefined) updates.colour = cleanColour(input.colour)
  if (!Object.keys(updates).length) throw ServiceError.validation('No fields to update')
  const start = (updates.start_date !== undefined ? updates.start_date : current.start_date) as string | null
  const end = (updates.end_date !== undefined ? updates.end_date : current.end_date) as string | null
  if (start && end && end < start) throw ServiceError.validation('The end date must be on or after the start date')
  const { data, error } = await (db as any).from('projects').update(updates).eq('id', projectId).eq('tenant_id', ctx.tenantId).select(PROJECT_COLUMNS).single()
  if (error || !data) throw mapProjectDbError(error)
  const diff: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of Object.keys(updates)) if (key !== 'archived_at') diff[key] = { before: (current as any)[key] ?? null, after: (data as any)[key] ?? null }
  await audit(ctx, { objectType: 'project', objectId: projectId, action: 'update', summary: `Updated project "${data.name}"`, diff })
  return getProject(ctx, projectId)
}

/** Archive (status archived) — or restore with `archived: false` (status active). projects.manage. */
export async function archiveProject(ctx: ServiceContext, projectId: string, archived = true) {
  return updateProject(ctx, projectId, { status: archived ? 'archived' : 'active' })
}

export async function deleteProject(ctx: ServiceContext, projectId: string) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const project = await loadProjectRow(ctx, db, projectId)
  const { error } = await (db as any).from('projects').delete().eq('id', projectId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to delete project')
  await audit(ctx, { objectType: 'project', objectId: projectId, action: 'delete', summary: `Deleted project "${project.name}"` })
  return { deleted: true as const, id: projectId }
}

function cleanRole(raw: unknown): string {
  const role = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!role) return 'Member'
  if (role.length > 100) throw ServiceError.validation('Role too long (max 100 characters)')
  return role
}

function cleanAllocation(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 100) throw ServiceError.validation('Allocation must be a whole percentage between 0 and 100')
  return value
}

/** Add a member, or update their role / allocation when already on the project. projects.manage. */
export async function addProjectMember(ctx: ServiceContext, projectId: string, userId: string, options: { role?: string | null; allocation_percent?: number | null } = {}) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const project = await loadProjectRow(ctx, db, projectId)
  await checkMember(ctx, db, userId, 'The person')
  const { data: existing } = await (db as any).from('project_members').select('user_id, role, allocation_percent').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  const role = options.role === undefined && existing ? existing.role : cleanRole(options.role)
  const allocation = options.allocation_percent === undefined && existing ? existing.allocation_percent : cleanAllocation(options.allocation_percent)
  const { error } = existing
    ? await (db as any).from('project_members').update({ role, allocation_percent: allocation }).eq('project_id', projectId).eq('user_id', userId)
    : await (db as any).from('project_members').insert({ project_id: projectId, user_id: userId, tenant_id: ctx.tenantId, role, allocation_percent: allocation, added_by: ctx.actorId })
  if (error) throw mapProjectDbError(error)
  await audit(ctx, { objectType: 'project', objectId: projectId, action: 'grant', summary: `${existing ? 'Updated a member of' : 'Added a member to'} project "${project.name}"`, metadata: { user_id: userId, role, allocation_percent: allocation } })
  return { added: true, already_member: Boolean(existing), project_id: projectId, user_id: userId, role, allocation_percent: allocation }
}

export async function removeProjectMember(ctx: ServiceContext, projectId: string, userId: string) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const project = await loadProjectRow(ctx, db, projectId)
  const { data, error } = await (db as any).from('project_members').delete().eq('project_id', projectId).eq('user_id', userId).eq('tenant_id', ctx.tenantId).select('user_id')
  if (error) throw dbError(error)
  const removed = (data ?? []).length > 0
  if (removed) await audit(ctx, { objectType: 'project', objectId: projectId, action: 'revoke', summary: `Removed a member from project "${project.name}"`, metadata: { user_id: userId } })
  return { removed, project_id: projectId, user_id: userId }
}

/** Attach a whole team: its members (and sub-teams' members) count as the project's people. Idempotent. projects.manage. */
export async function attachProjectTeam(ctx: ServiceContext, projectId: string, teamId: string) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const project = await loadProjectRow(ctx, db, projectId)
  await checkRef(ctx, db, 'teams', teamId, 'Team')
  const { data: existing } = await (db as any).from('project_teams').select('team_id').eq('project_id', projectId).eq('team_id', teamId).maybeSingle()
  if (existing) return { attached: true, already_attached: true, project_id: projectId, team_id: teamId }
  const { error } = await (db as any).from('project_teams').insert({ project_id: projectId, team_id: teamId, tenant_id: ctx.tenantId, added_by: ctx.actorId })
  if (error && !/duplicate|unique/i.test(error.message ?? '')) throw mapProjectDbError(error)
  await audit(ctx, { objectType: 'project', objectId: projectId, action: 'grant', summary: `Attached a team to project "${project.name}"`, metadata: { team_id: teamId } })
  return { attached: true, already_attached: false, project_id: projectId, team_id: teamId }
}

export async function detachProjectTeam(ctx: ServiceContext, projectId: string, teamId: string) {
  requirePerm(ctx, 'projects.manage')
  const db = await serviceRoleClient(ctx)
  const project = await loadProjectRow(ctx, db, projectId)
  const { data, error } = await (db as any).from('project_teams').delete().eq('project_id', projectId).eq('team_id', teamId).eq('tenant_id', ctx.tenantId).select('team_id')
  if (error) throw dbError(error)
  const detached = (data ?? []).length > 0
  if (detached) await audit(ctx, { objectType: 'project', objectId: projectId, action: 'revoke', summary: `Detached a team from project "${project.name}"`, metadata: { team_id: teamId } })
  return { detached, project_id: projectId, team_id: teamId }
}
