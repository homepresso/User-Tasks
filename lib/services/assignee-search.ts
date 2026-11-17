/**
 * Type-ahead search for the assignee pickers (Create task, Assign to… /
 * Reassign, the workflow User Task node's team, people fields with teams):
 * people and teams of the workspace matching what was typed, in one round
 * trip, each team with where it comes from (lib/teams/origin.ts) and its
 * member count; the origins present in the workspace (the picker's filter
 * chips); and the first members of a team (hover / expand).
 *
 * Who may be picked is unchanged: the active members of the workspace and
 * its teams — the same targets Take ownership / Assign to… offered
 * (tasks.assignTargets) and the teams Create task listed (tasks.teams).
 * People are read through the session client first (RLS: users the caller
 * can see), then narrowed to active members of the workspace; teams through
 * the session client filtered to the workspace.
 */

import { getDb, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { checkOrigin, withOrigin } from './teams'
import { escapeLikePattern } from '@/lib/utils'
import { sortTeamOrigins, TEAM_ORIGIN_LABELS, type TeamOrigin } from '@/lib/teams/origin'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const ASSIGNEE_SEARCH_MAX = 50
const PEOPLE_CANDIDATES = 200

export type AssigneeKind = 'person' | 'team'

export interface AssigneeSearchInput {
  /** What was typed (name or e-mail; team name). Empty: the first people / teams by name. */
  q?: string | null
  /** Which kinds to return (default both). */
  kinds?: AssigneeKind[] | null
  /** Only teams from this origin. */
  origin?: string | null
  /** Per kind (default 8, max 50). */
  limit?: number | null
}

export interface AssigneePerson {
  kind: 'person'
  id: string
  name: string
  email: string | null
}

export interface AssigneeTeam {
  kind: 'team'
  id: string
  name: string
  description: string | null
  origin: TeamOrigin
  origin_label: string
  /** Where a directory-source team comes from, e.g. "SharePoint · Sales". */
  source_label: string | null
  member_count: number
}

export interface AssigneeSearchResult {
  people: AssigneePerson[]
  teams: AssigneeTeam[]
}

/** Characters PostgREST's or=() syntax or LIKE treat specially are dropped from the term. */
export function searchTerm(q: string | null | undefined): string {
  return String(q ?? '').replace(/[,()"\\%_*:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

function clampLimit(limit: number | null | undefined, fallback = 8): number {
  const n = Number(limit ?? fallback)
  return Number.isFinite(n) ? Math.max(1, Math.min(ASSIGNEE_SEARCH_MAX, Math.floor(n))) : fallback
}

const memberCount = (row: any): number => {
  const agg = row?.user_teams
  if (Array.isArray(agg)) return Number(agg[0]?.count ?? 0)
  return Number(agg?.count ?? 0)
}

async function searchPeople(ctx: ServiceContext, term: string, limit: number): Promise<AssigneePerson[]> {
  let query = (getDb(ctx) as any).from('users').select('id, display_name, email').is('deleted_at', null)
  if (term) query = query.or(`display_name.ilike.%${term}%,email.ilike.%${term}%`)
  const { data, error } = await query.order('display_name').limit(PEOPLE_CANDIDATES)
  if (error) throw dbError(error)
  const candidates = (data ?? []) as any[]
  if (!candidates.length) return []
  // Active members of this workspace only (the targets assignment accepts).
  const db = await serviceRoleClient(ctx) as any
  const { data: members, error: memberError } = await db.from('user_memberships').select('user_id')
    .eq('tenant_id', ctx.tenantId).eq('is_active', true).in('user_id', candidates.map((u) => String(u.id)))
  if (memberError) throw dbError(memberError)
  const active = new Set(((members ?? []) as any[]).map((m) => String(m.user_id)))
  const needle = term.toLowerCase()
  const rank = (u: any) => {
    const name = String(u.display_name ?? '').toLowerCase()
    const email = String(u.email ?? '').toLowerCase()
    return !needle ? 0 : name.startsWith(needle) || email.startsWith(needle) ? 0 : name.split(/\s+/).some((w) => w.startsWith(needle)) ? 1 : 2
  }
  return candidates
    .filter((u) => active.has(String(u.id)))
    .map((u) => ({ row: u, rank: rank(u), name: String(u.display_name || u.email || 'Someone') }))
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ row, name }) => ({ kind: 'person' as const, id: String(row.id), name, email: row.email ?? null }))
}

async function searchTeams(ctx: ServiceContext, term: string, origin: TeamOrigin | null, limit: number): Promise<AssigneeTeam[]> {
  const pattern = term ? `%${escapeLikePattern(term)}%` : null
  const run = (columns: string, filterOrigin: boolean) => {
    let query = (getDb(ctx) as any).from('teams').select(`${columns}, user_teams(count)`).eq('tenant_id', ctx.tenantId)
    if (pattern) query = query.ilike('name', pattern)
    if (origin && filterOrigin) query = query.eq('origin', origin)
    return query.order('name').limit(origin && !filterOrigin ? 500 : limit)
  }
  const base = 'id, name, description'
  let result = await run(`${base}, source, source_label, origin`, true)
  let originRead = true
  if (result.error && /origin|source|42703|PGRST204/i.test(`${result.error.code ?? ''} ${result.error.message ?? ''}`)) {
    originRead = false
    result = await run(`${base}, source, source_label`, false)
    if (result.error) result = await run(base, false)
  }
  if (result.error) throw dbError(result.error)
  let teams = ((result.data ?? []) as any[]).map((row) => withOrigin(row))
  if (origin && !originRead) teams = teams.filter((t) => t.origin === origin)
  return teams.slice(0, limit).map((t: any) => ({
    kind: 'team' as const,
    id: String(t.id),
    name: String(t.name ?? 'Team'),
    description: t.description ?? null,
    origin: t.origin,
    origin_label: t.origin_label,
    source_label: t.source_label ?? null,
    member_count: memberCount(t),
  }))
}

/** People and teams matching `q` (each kind up to `limit`), for the assignee pickers. */
export async function searchAssignees(ctx: ServiceContext, input: AssigneeSearchInput = {}): Promise<AssigneeSearchResult> {
  const term = searchTerm(input.q)
  const kinds = new Set<AssigneeKind>(input.kinds?.length ? input.kinds : ['person', 'team'])
  const origin = checkOrigin(input.origin)
  const limit = clampLimit(input.limit)
  // An origin filter is about teams: people are not listed under it.
  const wantPeople = kinds.has('person') && !origin
  const [people, teams] = await Promise.all([
    wantPeople ? searchPeople(ctx, term, limit) : Promise.resolve([]),
    kinds.has('team') ? searchTeams(ctx, term, origin, limit) : Promise.resolve([]),
  ])
  return { people, teams }
}

/** The origins of the workspace's teams with counts (the picker's filter chips: only what exists). */
export async function teamOriginCounts(ctx: ServiceContext): Promise<Array<{ origin: TeamOrigin; label: string; count: number }>> {
  const db = getDb(ctx) as any
  let { data, error } = await db.from('teams').select('id, origin, source, source_label').eq('tenant_id', ctx.tenantId).limit(10_000)
  if (error) ({ data, error } = await db.from('teams').select('id, source, source_label').eq('tenant_id', ctx.tenantId).limit(10_000))
  if (error) ({ data, error } = await db.from('teams').select('id').eq('tenant_id', ctx.tenantId).limit(10_000))
  if (error) throw dbError(error)
  const counts = new Map<TeamOrigin, number>()
  for (const row of (data ?? []) as any[]) {
    const origin = withOrigin(row).origin
    counts.set(origin, (counts.get(origin) ?? 0) + 1)
  }
  return sortTeamOrigins(counts.keys()).map((origin) => ({ origin, label: TEAM_ORIGIN_LABELS[origin], count: counts.get(origin) ?? 0 }))
}

/** The first members of a team by name and how many it has (picker hover / expand). */
export async function teamMemberPreview(ctx: ServiceContext, teamId: string, limit = 5): Promise<{ team_id: string; total: number; members: Array<{ id: string; name: string; email: string | null }> }> {
  const db = getDb(ctx) as any
  const { data: team, error: teamError } = await db.from('teams').select('id').eq('id', teamId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (teamError) throw dbError(teamError)
  if (!team) return { team_id: teamId, total: 0, members: [] }
  const { data, error } = await db.from('user_teams').select('user_id, user:users(id, display_name, email)').eq('team_id', teamId).limit(2000)
  if (error) throw dbError(error)
  const members = ((data ?? []) as any[]).map((row) => row.user).filter(Boolean)
    .map((u: any) => ({ id: String(u.id), name: String(u.display_name || u.email || 'Someone'), email: u.email ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { team_id: teamId, total: members.length, members: members.slice(0, Math.max(1, Math.min(20, limit))) }
}
