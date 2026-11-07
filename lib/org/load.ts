/**
 * Load one workspace's org structure (an OrgSnapshot, lib/org/structure.ts)
 * with explicit tenant filters. Callers pass a service-role client after
 * their own permission checks (lib/services/org.ts, lib/services/projects.ts),
 * so nothing here relies on RLS.
 *
 * Reads page through PostgREST's row cap (1,000 by default), so a workspace
 * of a few thousand people loads completely.
 */

import type { AnySupabaseClient } from '@/lib/services/context'
import type { OrgPerson, OrgSnapshot, OrgSource, OrgUnitMemberRow, OrgUnitRow, ProjectMemberRow, ProjectRow, ProjectStatus, ProjectTeamRow, ProfileSource, TeamMemberRow, TeamRow } from './structure'
import { emptySnapshot } from './structure'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export const PAGE_SIZE = 1000
/** Hard ceiling on rows read per table (a runaway import shouldn't take the server down). */
export const MAX_ROWS = 50_000

export class OrgLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrgLoadError'
  }
}

/** Every row of a filtered query, page by page. `build` must return a fresh, ordered query. */
export async function fetchAllRows<T = any>(build: () => any, options: { pageSize?: number; maxRows?: number } = {}): Promise<T[]> {
  const pageSize = options.pageSize ?? PAGE_SIZE
  const maxRows = options.maxRows ?? MAX_ROWS
  const out: T[] = []
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build().range(from, Math.min(from + pageSize, maxRows) - 1)
    if (error) throw new OrgLoadError(error.message ?? String(error))
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break
  }
  return out
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export const MEMBERSHIP_PROFILE_COLUMNS = 'user_id, manager_user_id, manager_source, job_title, department, location, employee_id, cost_center, profile_source'
export const ORG_UNIT_COLUMNS = 'id, name, kind, parent_id, head_user_id, description, source, external_id, detached, sort, created_at, updated_at'
export const TEAM_COLUMNS_FULL = 'id, name, description, parent_id, lead_user_id, org_unit_id, colour, kind, created_at, updated_at'
export const PROJECT_COLUMNS = 'id, name, key, description, status, owner_user_id, sponsor_user_id, team_id, org_unit_id, start_date, end_date, colour, created_at, updated_at, archived_at'

export function toUnit(row: any): OrgUnitRow {
  return {
    id: String(row.id), name: String(row.name ?? ''), kind: String(row.kind ?? 'unit'), parent_id: s(row.parent_id),
    head_user_id: s(row.head_user_id), description: s(row.description), source: (row.source ?? 'manual') as OrgSource,
    external_id: s(row.external_id), detached: Boolean(row.detached), sort: Number(row.sort ?? 0),
  }
}

export function toTeam(row: any): TeamRow {
  return {
    id: String(row.id), name: String(row.name ?? ''), description: s(row.description), parent_id: s(row.parent_id),
    lead_user_id: s(row.lead_user_id), org_unit_id: s(row.org_unit_id), colour: s(row.colour), kind: String(row.kind ?? 'team'),
  }
}

export function toProject(row: any): ProjectRow {
  return {
    id: String(row.id), name: String(row.name ?? ''), key: String(row.key ?? ''), description: s(row.description),
    status: (row.status ?? 'active') as ProjectStatus, owner_user_id: s(row.owner_user_id), sponsor_user_id: s(row.sponsor_user_id),
    team_id: s(row.team_id), org_unit_id: s(row.org_unit_id), start_date: s(row.start_date), end_date: s(row.end_date),
    colour: s(row.colour), archived_at: s(row.archived_at),
  }
}

/** Active members with their reporting line and profile attributes, joined to users for names. */
export async function loadPeople(db: AnySupabaseClient, tenantId: string): Promise<OrgPerson[]> {
  const memberships = await fetchAllRows<any>(() => (db as any).from('user_memberships')
    .select(MEMBERSHIP_PROFILE_COLUMNS).eq('tenant_id', tenantId).eq('is_active', true).order('user_id'))
  const ids = memberships.map((m) => String(m.user_id))
  const users = new Map<string, any>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await (db as any).from('users')
      .select('id, display_name, email, avatar_url, deleted_at').in('id', ids.slice(i, i + 200))
    if (error) throw new OrgLoadError(error.message)
    for (const u of data ?? []) users.set(String(u.id), u)
  }
  const out: OrgPerson[] = []
  for (const m of memberships) {
    const u = users.get(String(m.user_id))
    if (!u || u.deleted_at) continue
    out.push({
      id: String(m.user_id),
      display_name: s(u.display_name),
      email: s(u.email),
      avatar_url: s(u.avatar_url),
      manager_user_id: s(m.manager_user_id),
      manager_source: s(m.manager_source),
      job_title: s(m.job_title),
      department: s(m.department),
      location: s(m.location),
      employee_id: s(m.employee_id),
      cost_center: s(m.cost_center),
      profile_source: (s(m.profile_source) as ProfileSource | null),
    })
  }
  return out
}

export type SnapshotPart = 'people' | 'units' | 'teams' | 'projects'

/** Load the parts of the snapshot a query needs (default: all). */
export async function loadOrgSnapshot(db: AnySupabaseClient, tenantId: string, parts: readonly SnapshotPart[] = ['people', 'units', 'teams', 'projects']): Promise<OrgSnapshot> {
  const snap = emptySnapshot()
  const want = new Set(parts)
  const tasks: Array<Promise<void>> = []
  if (want.has('people')) tasks.push(loadPeople(db, tenantId).then((p) => { snap.people = p }))
  if (want.has('units')) {
    tasks.push(fetchAllRows<any>(() => (db as any).from('org_units').select(ORG_UNIT_COLUMNS).eq('tenant_id', tenantId).order('id'))
      .then((rows) => { snap.units = rows.map(toUnit) }))
    tasks.push(fetchAllRows<any>(() => (db as any).from('org_unit_members').select('org_unit_id, user_id, role, is_primary, source').eq('tenant_id', tenantId).order('org_unit_id').order('user_id'))
      .then((rows) => {
        snap.unitMembers = rows.map((r): OrgUnitMemberRow => ({ org_unit_id: String(r.org_unit_id), user_id: String(r.user_id), role: s(r.role), is_primary: Boolean(r.is_primary), source: (r.source ?? 'manual') as OrgSource }))
      }))
  }
  if (want.has('teams') || want.has('projects')) {
    tasks.push((async () => {
      const teams = await fetchAllRows<any>(() => (db as any).from('teams').select(TEAM_COLUMNS_FULL).eq('tenant_id', tenantId).order('id'))
      snap.teams = teams.map(toTeam)
      const teamIds = snap.teams.map((t) => t.id)
      const members: TeamMemberRow[] = []
      // user_teams has no tenant column: read by team id.
      for (let i = 0; i < teamIds.length; i += 200) {
        const chunk = teamIds.slice(i, i + 200)
        const rows = await fetchAllRows<any>(() => (db as any).from('user_teams').select('team_id, user_id, role').in('team_id', chunk).order('id'))
        for (const r of rows) members.push({ team_id: String(r.team_id), user_id: String(r.user_id), role: s(r.role) })
      }
      snap.teamMembers = members
    })())
  }
  if (want.has('projects')) {
    tasks.push(fetchAllRows<any>(() => (db as any).from('projects').select(PROJECT_COLUMNS).eq('tenant_id', tenantId).order('id'))
      .then((rows) => { snap.projects = rows.map(toProject) }))
    tasks.push(fetchAllRows<any>(() => (db as any).from('project_members').select('project_id, user_id, role, allocation_percent').eq('tenant_id', tenantId).order('project_id').order('user_id'))
      .then((rows) => {
        snap.projectMembers = rows.map((r): ProjectMemberRow => ({ project_id: String(r.project_id), user_id: String(r.user_id), role: String(r.role ?? 'Member'), allocation_percent: r.allocation_percent ?? null }))
      }))
    tasks.push(fetchAllRows<any>(() => (db as any).from('project_teams').select('project_id, team_id').eq('tenant_id', tenantId).order('project_id').order('team_id'))
      .then((rows) => { snap.projectTeams = rows.map((r): ProjectTeamRow => ({ project_id: String(r.project_id), team_id: String(r.team_id) })) }))
  }
  await Promise.all(tasks)
  return snap
}
