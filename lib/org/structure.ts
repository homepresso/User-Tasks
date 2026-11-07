/**
 * Org structure: pure, cycle-safe queries over one workspace's people,
 * reporting lines, org units, teams and projects. No database access here —
 * lib/org/load.ts loads an OrgSnapshot and lib/services/org.ts /
 * lib/services/projects.ts apply permissions on top.
 *
 * These are the building blocks later features (the task tracker's "my
 * team", "project team" views) use to answer "who is in X":
 *  - reporting lines: subordinates (direct / all), manager chain, peers
 *    (lib/reporting-lines.ts holds the index; MAX_REPORTING_DEPTH applies);
 *  - org units and teams: trees by parent_id, members optionally including
 *    every unit / team below;
 *  - projects: direct members unioned with the members of attached teams.
 *
 * Every walk carries a visited set and a depth cap, so bad data (a loop the
 * database would refuse today, or one imported before the triggers existed)
 * can't hang a request.
 */

import { buildReportingIndex, listReports, managerChain, MAX_REPORTING_DEPTH, type ReportingIndex, type ReportingLine } from '@/lib/reporting-lines'

/** Deepest org unit / team nesting walked (the database refuses > 64). */
export const MAX_TREE_DEPTH = 64

export type ProfileSource = 'manual' | 'directory'
export type OrgSource = 'manual' | 'okta' | 'entra' | 'google' | 'ldap' | 'scim' | 'csv'
export const ORG_SOURCES: readonly OrgSource[] = ['manual', 'okta', 'entra', 'google', 'ldap', 'scim', 'csv']
export const ORG_UNIT_KINDS = ['company', 'division', 'department', 'unit'] as const
export const TEAM_KINDS = ['team', 'squad', 'guild'] as const
export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** Profile attributes held per workspace membership. */
export const PROFILE_FIELDS = ['job_title', 'department', 'location', 'employee_id', 'cost_center'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

export interface OrgPerson {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  manager_user_id: string | null
  manager_source: string | null
  job_title: string | null
  department: string | null
  location: string | null
  employee_id: string | null
  cost_center: string | null
  profile_source: ProfileSource | null
}

export interface OrgUnitRow {
  id: string
  name: string
  kind: string
  parent_id: string | null
  head_user_id: string | null
  description: string | null
  source: OrgSource
  external_id: string | null
  detached: boolean
  sort: number
}

export interface OrgUnitMemberRow {
  org_unit_id: string
  user_id: string
  role: string | null
  is_primary: boolean
  source: OrgSource
}

export interface TeamRow {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  lead_user_id: string | null
  org_unit_id: string | null
  colour: string | null
  kind: string
}

export interface TeamMemberRow {
  team_id: string
  user_id: string
  role: string | null
}

export interface ProjectRow {
  id: string
  name: string
  key: string
  description: string | null
  status: ProjectStatus
  owner_user_id: string | null
  sponsor_user_id: string | null
  team_id: string | null
  org_unit_id: string | null
  start_date: string | null
  end_date: string | null
  colour: string | null
  archived_at: string | null
}

export interface ProjectMemberRow {
  project_id: string
  user_id: string
  role: string
  allocation_percent: number | null
}

export interface ProjectTeamRow {
  project_id: string
  team_id: string
}

/** Everything the org queries need for one workspace (any part may be empty). */
export interface OrgSnapshot {
  people: OrgPerson[]
  units: OrgUnitRow[]
  unitMembers: OrgUnitMemberRow[]
  teams: TeamRow[]
  teamMembers: TeamMemberRow[]
  projects: ProjectRow[]
  projectMembers: ProjectMemberRow[]
  projectTeams: ProjectTeamRow[]
}

export function emptySnapshot(): OrgSnapshot {
  return { people: [], units: [], unitMembers: [], teams: [], teamMembers: [], projects: [], projectMembers: [], projectTeams: [] }
}

/* ── Trees (org units, teams) ── */

export interface Tree {
  /** Ids with no (known) parent, plus ids whose parent chain loops. */
  roots: string[]
  parentOf: Map<string, string>
  childrenOf: Map<string, string[]>
  ids: Set<string>
}

/**
 * Build a forest from id / parent_id rows. A parent that isn't in `rows`
 * makes the row a root; rows caught in a loop are cut at the first repeat
 * (the looping row becomes a root), so every walk terminates.
 */
export function buildTree(rows: ReadonlyArray<{ id: string; parent_id: string | null }>): Tree {
  const ids = new Set(rows.map((r) => r.id))
  const parentOf = new Map<string, string>()
  for (const row of rows) {
    if (row.parent_id && row.parent_id !== row.id && ids.has(row.parent_id)) parentOf.set(row.id, row.parent_id)
  }
  // Cut loops: walk up from each row; meeting a row twice means a loop.
  for (const row of rows) {
    const seen = new Set<string>([row.id])
    let current = parentOf.get(row.id)
    let depth = 0
    while (current && depth <= MAX_TREE_DEPTH) {
      if (seen.has(current)) { parentOf.delete(row.id); break }
      seen.add(current)
      current = parentOf.get(current)
      depth++
    }
    if (depth > MAX_TREE_DEPTH) parentOf.delete(row.id)
  }
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const row of rows) {
    const parent = parentOf.get(row.id)
    if (!parent) { roots.push(row.id); continue }
    const list = childrenOf.get(parent)
    if (list) list.push(row.id)
    else childrenOf.set(parent, [row.id])
  }
  return { roots, parentOf, childrenOf, ids }
}

/** `id` and everything below it (breadth-first, `id` first). */
export function descendantIds(tree: Tree, id: string, options: { includeSelf?: boolean; maxDepth?: number } = {}): string[] {
  if (!tree.ids.has(id)) return []
  const maxDepth = Math.max(0, Math.min(options.maxDepth ?? MAX_TREE_DEPTH, MAX_TREE_DEPTH))
  const out: string[] = options.includeSelf === false ? [] : [id]
  const seen = new Set<string>([id])
  let frontier = [id]
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: string[] = []
    for (const current of frontier) {
      for (const child of tree.childrenOf.get(current) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        out.push(child)
        next.push(child)
      }
    }
    frontier = next
  }
  return out
}

/** Parents of `id`, nearest first. */
export function ancestorIds(tree: Tree, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let current = tree.parentOf.get(id)
  while (current && !seen.has(current) && out.length < MAX_TREE_DEPTH) {
    out.push(current)
    seen.add(current)
    current = tree.parentOf.get(current)
  }
  return out
}

/** Depth of each node (roots = 0). */
export function depthOf(tree: Tree, id: string): number {
  return ancestorIds(tree, id).length
}

/** Would giving `id` the parent `parentId` close a loop? */
export function wouldCreateTreeCycle(tree: Tree, id: string, parentId: string | null): boolean {
  if (!parentId) return false
  if (parentId === id) return true
  return ancestorIds(tree, parentId).includes(id)
}

/* ── Reporting lines ── */

export function reportingIndexOf(people: readonly Pick<OrgPerson, 'id' | 'manager_user_id'>[]): ReportingIndex {
  const lines: ReportingLine[] = people.map((p) => ({ user_id: p.id, manager_user_id: p.manager_user_id }))
  return buildReportingIndex(lines)
}

export type SubordinateDepth = 'direct' | 'all'

export interface Subordinate {
  user_id: string
  /** 0 = the person themselves (includeSelf), 1 = direct report, … */
  depth: number
  manager_user_id: string | null
}

/** People who report to `userId`: direct only, or every level (capped at MAX_REPORTING_DEPTH). */
export function subordinatesOf(index: ReportingIndex, userId: string, options: { depth?: SubordinateDepth; includeSelf?: boolean } = {}): Subordinate[] {
  const reports = listReports(index, userId, { indirect: options.depth === 'all' })
  const out: Subordinate[] = reports.map((r) => ({ user_id: r.user_id, depth: r.depth, manager_user_id: r.manager_user_id }))
  if (options.includeSelf) out.unshift({ user_id: userId, depth: 0, manager_user_id: index.managerOf.get(userId) ?? null })
  return out
}

/** `userId`'s managers, nearest first. */
export function managerChainOf(index: ReportingIndex, userId: string): string[] {
  return managerChain(index, userId, MAX_REPORTING_DEPTH)
}

/** Others with the same manager (none for someone without a manager). */
export function peersOf(index: ReportingIndex, userId: string): string[] {
  const manager = index.managerOf.get(userId)
  if (!manager) return []
  return (index.reportsOf.get(manager) ?? []).filter((id) => id !== userId)
}

/* ── Membership queries ── */

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = out.get(k)
    if (list) list.push(row)
    else out.set(k, [row])
  }
  return out
}

export interface GroupMember {
  user_id: string
  /** Where the membership comes from: the unit / team ids (the asked-for one first when direct). */
  via: string[]
  /** Role in the nearest unit / team that has one. */
  role: string | null
  /** True when the person is a member of the asked-for unit / team itself. */
  direct: boolean
}

function collectMembers<M extends { user_id: string; role: string | null }>(
  groupIds: string[],
  membersByGroup: Map<string, M[]>,
  rootId: string,
): GroupMember[] {
  const byUser = new Map<string, GroupMember>()
  for (const groupId of groupIds) {
    for (const m of membersByGroup.get(groupId) ?? []) {
      const existing = byUser.get(m.user_id)
      if (existing) {
        if (!existing.via.includes(groupId)) existing.via.push(groupId)
        if (groupId === rootId) existing.direct = true
        if (!existing.role && m.role) existing.role = m.role
        continue
      }
      byUser.set(m.user_id, { user_id: m.user_id, via: [groupId], role: m.role ?? null, direct: groupId === rootId })
    }
  }
  return [...byUser.values()]
}

/** Members of an org unit (with `recursive`, also of every unit below). */
export function orgUnitMembersOf(snapshot: Pick<OrgSnapshot, 'units' | 'unitMembers'>, unitId: string, options: { recursive?: boolean; tree?: Tree } = {}): GroupMember[] {
  const tree = options.tree ?? buildTree(snapshot.units)
  if (!tree.ids.has(unitId)) return []
  const ids = options.recursive ? descendantIds(tree, unitId) : [unitId]
  return collectMembers(ids, groupBy(snapshot.unitMembers, (m) => m.org_unit_id), unitId)
}

/** Members of a team (with `recursive`, also of every sub-team). */
export function teamMembersOf(snapshot: Pick<OrgSnapshot, 'teams' | 'teamMembers'>, teamId: string, options: { recursive?: boolean; tree?: Tree } = {}): GroupMember[] {
  const tree = options.tree ?? buildTree(snapshot.teams)
  if (!tree.ids.has(teamId)) return []
  const ids = options.recursive ? descendantIds(tree, teamId) : [teamId]
  return collectMembers(ids, groupBy(snapshot.teamMembers, (m) => m.team_id), teamId)
}

export interface ProjectMember {
  user_id: string
  /** Role on the project (direct membership), else the team role, else null. */
  role: string | null
  allocation_percent: number | null
  /** A direct project member. */
  direct: boolean
  /** Attached teams the person is in (sub-teams count toward their attached parent). */
  via_team_ids: string[]
}

/**
 * A project's people: direct members, unioned (with `includeTeams`, the
 * default) with the members of its attached teams and of its owning team —
 * each team including its sub-teams.
 */
export function projectMembersOf(
  snapshot: Pick<OrgSnapshot, 'projects' | 'projectMembers' | 'projectTeams' | 'teams' | 'teamMembers'>,
  projectId: string,
  options: { includeTeams?: boolean; teamTree?: Tree } = {},
): ProjectMember[] {
  const project = snapshot.projects.find((p) => p.id === projectId)
  if (!project) return []
  const byUser = new Map<string, ProjectMember>()
  for (const m of snapshot.projectMembers) {
    if (m.project_id !== projectId) continue
    byUser.set(m.user_id, { user_id: m.user_id, role: m.role, allocation_percent: m.allocation_percent ?? null, direct: true, via_team_ids: [] })
  }
  if (options.includeTeams !== false) {
    const teamIds = projectTeamIdsOf(snapshot, projectId)
    const tree = options.teamTree ?? buildTree(snapshot.teams)
    for (const teamId of teamIds) {
      for (const member of teamMembersOf(snapshot, teamId, { recursive: true, tree })) {
        const existing = byUser.get(member.user_id)
        if (existing) {
          if (!existing.via_team_ids.includes(teamId)) existing.via_team_ids.push(teamId)
          continue
        }
        byUser.set(member.user_id, { user_id: member.user_id, role: member.role, allocation_percent: null, direct: false, via_team_ids: [teamId] })
      }
    }
  }
  return [...byUser.values()]
}

/** Teams attached to a project: project_teams plus the owning team (first), de-duplicated. */
export function projectTeamIdsOf(snapshot: Pick<OrgSnapshot, 'projects' | 'projectTeams'>, projectId: string): string[] {
  const project = snapshot.projects.find((p) => p.id === projectId)
  const ids: string[] = []
  if (project?.team_id) ids.push(project.team_id)
  for (const pt of snapshot.projectTeams) {
    if (pt.project_id === projectId && !ids.includes(pt.team_id)) ids.push(pt.team_id)
  }
  return ids
}

/** Teams a person is in: directly, and (with `includeParents`) every team above those. */
export function teamsOfUser(snapshot: Pick<OrgSnapshot, 'teams' | 'teamMembers'>, userId: string, options: { includeParents?: boolean; tree?: Tree } = {}): string[] {
  const direct = snapshot.teamMembers.filter((m) => m.user_id === userId).map((m) => m.team_id)
  if (!options.includeParents) return Array.from(new Set(direct))
  const tree = options.tree ?? buildTree(snapshot.teams)
  const out = new Set<string>()
  for (const id of direct) {
    out.add(id)
    for (const parent of ancestorIds(tree, id)) out.add(parent)
  }
  return [...out]
}

/** Org units a person is in (directly). Primary first. */
export function orgUnitsOfUser(snapshot: Pick<OrgSnapshot, 'unitMembers'>, userId: string): string[] {
  return snapshot.unitMembers
    .filter((m) => m.user_id === userId)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
    .map((m) => m.org_unit_id)
}

/**
 * Projects a person is on: as a direct member, owner or sponsor, or through
 * an attached (or owning) team they're in, sub-teams included.
 */
export function projectsOfUser(
  snapshot: Pick<OrgSnapshot, 'projects' | 'projectMembers' | 'projectTeams' | 'teams' | 'teamMembers'>,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Array<{ project_id: string; role: string | null; direct: boolean; via_team_ids: string[] }> {
  const tree = buildTree(snapshot.teams)
  const myTeams = new Set(teamsOfUser(snapshot, userId, { includeParents: true, tree }))
  const out: Array<{ project_id: string; role: string | null; direct: boolean; via_team_ids: string[] }> = []
  for (const project of snapshot.projects) {
    if (!options.includeArchived && project.status === 'archived') continue
    const member = snapshot.projectMembers.find((m) => m.project_id === project.id && m.user_id === userId)
    const viaTeams = projectTeamIdsOf(snapshot, project.id).filter((id) => myTeams.has(id))
    const isOwner = project.owner_user_id === userId
    const isSponsor = project.sponsor_user_id === userId
    if (!member && !viaTeams.length && !isOwner && !isSponsor) continue
    out.push({
      project_id: project.id,
      role: member?.role ?? (isOwner ? 'Owner' : isSponsor ? 'Sponsor' : null),
      direct: Boolean(member || isOwner || isSponsor),
      via_team_ids: viaTeams,
    })
  }
  return out
}

/* ── People scopes (the task tracker's "whose work do I see") ── */

export type PeopleScope =
  | { kind: 'me' }
  | { kind: 'direct_reports'; includeSelf?: boolean }
  | { kind: 'all_reports'; includeSelf?: boolean }
  | { kind: 'team'; team_id: string; recursive?: boolean }
  | { kind: 'org_unit'; org_unit_id: string; recursive?: boolean }
  | { kind: 'project'; project_id: string; includeTeams?: boolean }

/** The user ids a scope covers for `viewerId`, in a stable order. Unknown team / unit / project: []. */
export function resolveScopeIds(snapshot: OrgSnapshot, viewerId: string, scope: PeopleScope): string[] {
  switch (scope.kind) {
    case 'me':
      return [viewerId]
    case 'direct_reports':
    case 'all_reports': {
      const index = reportingIndexOf(snapshot.people)
      return subordinatesOf(index, viewerId, { depth: scope.kind === 'all_reports' ? 'all' : 'direct', includeSelf: scope.includeSelf }).map((s) => s.user_id)
    }
    case 'team':
      return teamMembersOf(snapshot, scope.team_id, { recursive: scope.recursive }).map((m) => m.user_id)
    case 'org_unit':
      return orgUnitMembersOf(snapshot, scope.org_unit_id, { recursive: scope.recursive }).map((m) => m.user_id)
    case 'project':
      return projectMembersOf(snapshot, scope.project_id, { includeTeams: scope.includeTeams }).map((m) => m.user_id)
  }
}

/* ── Org chart aggregates ── */

/** Everyone below `userId` at any depth (no level cap; cycle-safe). */
export function allBelow(index: ReportingIndex, userId: string): string[] {
  const seen = new Set<string>([userId])
  const out: string[] = []
  const queue = [userId]
  for (let i = 0; i < queue.length; i++) {
    for (const report of index.reportsOf.get(queue[i]) ?? []) {
      if (seen.has(report)) continue
      seen.add(report)
      out.push(report)
      queue.push(report)
    }
  }
  return out
}

/** Direct and total (all levels, no cap) report counts per manager. */
export function reportCounts(index: ReportingIndex): Map<string, { direct: number; total: number }> {
  const out = new Map<string, { direct: number; total: number }>()
  for (const [id, reports] of index.reportsOf) out.set(id, { direct: reports.length, total: allBelow(index, id).length })
  return out
}

/**
 * Headcount per org unit: `direct` (members of the unit) and `total`
 * (distinct members of the unit and every unit below).
 */
export function unitHeadcounts(snapshot: Pick<OrgSnapshot, 'units' | 'unitMembers'>, tree = buildTree(snapshot.units)): Map<string, { direct: number; total: number }> {
  const membersByUnit = groupBy(snapshot.unitMembers, (m) => m.org_unit_id)
  const out = new Map<string, { direct: number; total: number }>()
  const totalSet = (id: string, depth: number): Set<string> => {
    const set = new Set((membersByUnit.get(id) ?? []).map((m) => m.user_id))
    if (depth < MAX_TREE_DEPTH) {
      for (const child of tree.childrenOf.get(id) ?? []) for (const user of totalSet(child, depth + 1)) set.add(user)
    }
    out.set(id, { direct: (membersByUnit.get(id) ?? []).length, total: set.size })
    return set
  }
  for (const root of tree.roots) totalSet(root, 0)
  return out
}

/**
 * Chart roots: people without a (known) manager, biggest organisation first,
 * plus one person per manager loop so nobody is unreachable.
 */
export function chartRoots(people: readonly Pick<OrgPerson, 'id' | 'manager_user_id'>[], index = reportingIndexOf(people)): string[] {
  const ids = new Set(people.map((p) => p.id))
  const roots = people.filter((p) => { const m = index.managerOf.get(p.id); return !m || !ids.has(m) }).map((p) => p.id)
  const counts = new Map<string, number>()
  const reached = new Set<string>()
  for (const root of roots) {
    const below = allBelow(index, root)
    counts.set(root, below.length)
    reached.add(root)
    for (const id of below) reached.add(id)
  }
  roots.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
  for (const p of people) {
    if (reached.has(p.id)) continue
    roots.push(p.id)
    reached.add(p.id)
    for (const id of allBelow(index, p.id)) reached.add(id)
  }
  return roots
}
