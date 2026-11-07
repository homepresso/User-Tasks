import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import type { ServiceContext } from '@/lib/services/context'
import * as org from '@/lib/services/org'
import * as projects from '@/lib/services/projects'
import { scopeFromQuery } from '@/lib/api/org-route-helpers'
import { createMcpServer } from '@/lib/mcp/server'
import { PERMISSION_KEYS } from '@/lib/permissions'
import * as scopeRoute from '@/app/api/v1/org/scope/route'
import * as subordinatesRoute from '@/app/api/v1/org/people/[id]/subordinates/route'
import * as projectMembersRoute from '@/app/api/v1/projects/[id]/members/route'
import * as unitsRoute from '@/app/api/v1/org/units/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Org structure and projects services, their REST routes and MCP tools:
 * permission gates (org.view / org.manage / projects.view / projects.manage),
 * self-scoped reads without permissions, directory-owned attributes, the
 * project people union and tenant isolation.
 */

const T = 'tenant-a'
const membership = (user_id: string, manager_user_id: string | null, extra: Record<string, unknown> = {}) =>
  ({ id: `m-${user_id}`, tenant_id: T, user_id, manager_user_id, manager_source: manager_user_id ? 'manual' : null, is_active: true, ...extra })

function seed() {
  return createMemorySupabase({
    users: [
      { id: 'ceo', tenant_id: T, display_name: 'Cleo', email: 'cleo@a.test', deleted_at: null },
      { id: 'mgr', tenant_id: T, display_name: 'Max', email: 'max@a.test', deleted_at: null },
      { id: 'dev', tenant_id: T, display_name: 'Dee', email: 'dee@a.test', deleted_at: null },
      { id: 'intern', tenant_id: T, display_name: 'Ivy', email: 'ivy@a.test', deleted_at: null },
      { id: 'outsider', tenant_id: 'tenant-b', display_name: 'Eve', email: 'eve@b.test', deleted_at: null },
    ],
    user_memberships: [
      membership('ceo', null),
      membership('mgr', 'ceo'),
      membership('dev', 'mgr', { job_title: 'Engineer', department: 'Eng', profile_source: 'directory' }),
      membership('intern', 'dev'),
      { id: 'm-out', tenant_id: 'tenant-b', user_id: 'outsider', manager_user_id: null, is_active: true },
    ],
    org_units: [
      { id: 'u-eng', tenant_id: T, name: 'Engineering', kind: 'department', parent_id: null, head_user_id: 'mgr', source: 'manual', external_id: null, detached: false, sort: 0 },
      { id: 'u-okta', tenant_id: T, name: 'Sales', kind: 'department', parent_id: null, head_user_id: null, source: 'okta', external_id: 'department:sales', detached: false, sort: 0 },
      { id: 'u-b', tenant_id: 'tenant-b', name: 'Foreign', kind: 'unit', parent_id: null, head_user_id: null, source: 'manual', external_id: null, detached: false, sort: 0 },
    ],
    org_unit_members: [{ tenant_id: T, org_unit_id: 'u-eng', user_id: 'dev', role: null, is_primary: true, source: 'manual' }],
    teams: [
      { id: 'team-plat', tenant_id: T, name: 'Platform', description: null, parent_id: null, lead_user_id: 'mgr', org_unit_id: 'u-eng', colour: null, kind: 'team' },
      { id: 'team-infra', tenant_id: T, name: 'Infra', description: null, parent_id: 'team-plat', lead_user_id: null, org_unit_id: null, colour: null, kind: 'squad' },
    ],
    user_teams: [
      { id: 'ut-1', team_id: 'team-plat', user_id: 'mgr', role: 'lead' },
      { id: 'ut-2', team_id: 'team-infra', user_id: 'intern', role: 'member' },
    ],
    projects: [
      { id: 'p-1', tenant_id: T, name: 'Apollo', key: 'APO', description: null, status: 'active', owner_user_id: 'ceo', sponsor_user_id: null, team_id: null, org_unit_id: null, start_date: null, end_date: null, colour: null, archived_at: null },
    ],
    project_members: [{ tenant_id: T, project_id: 'p-1', user_id: 'dev', role: 'Lead', allocation_percent: 50 }],
    project_teams: [{ tenant_id: T, project_id: 'p-1', team_id: 'team-plat' }],
  })
}

type Memory = ReturnType<typeof seed>

function ctx(supabase: Memory, permissions: string[], actorId: string | null = 'dev'): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: T,
    actorId,
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
  }
}

beforeEach(() => vi.mocked(writeAudit).mockClear())

describe('org service: reads', () => {
  it('the org chart needs org.view and counts reports at every level', async () => {
    const db = seed()
    await expect(org.getOrgChart(ctx(db, []))).rejects.toMatchObject({ code: 'forbidden' })
    const chart = await org.getOrgChart(ctx(db, ['org.view']))
    expect(chart.total).toBe(4)
    expect(chart.roots).toEqual(['ceo'])
    expect(chart.people.find((p) => p.id === 'ceo')).toMatchObject({ direct_reports: 1, total_reports: 3 })
    expect(chart.people.some((p) => p.id === 'outsider')).toBe(false)
  })

  it('your own subordinates and chain need no permission; someone else’s need org.view', async () => {
    const db = seed()
    const mine = await org.getSubordinates(ctx(db, [], 'mgr'), 'me', { depth: 'all' })
    expect(mine.people.map((p) => [p.id, p.depth])).toEqual([['dev', 1], ['intern', 2]])
    expect((await org.getManagerChain(ctx(db, [], 'intern'), 'me')).chain.map((p) => p.id)).toEqual(['dev', 'mgr', 'ceo'])
    await expect(org.getSubordinates(ctx(db, [], 'dev'), 'mgr')).rejects.toMatchObject({ code: 'forbidden' })
    expect((await org.getSubordinates(ctx(db, ['org.view'], 'dev'), 'mgr', { includeSelf: true })).people.map((p) => p.id)).toEqual(['mgr', 'dev'])
  })

  it('a person outside the workspace is not found', async () => {
    await expect(org.getPerson(ctx(seed(), ['org.view']), 'outsider')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('getPerson shows teams, org units and (with projects.view or for yourself) projects', async () => {
    const db = seed()
    const self = await org.getPerson(ctx(db, [], 'intern'), 'me')
    expect(self.manager_chain.map((p) => p.id)).toEqual(['dev', 'mgr', 'ceo'])
    expect(self.teams.map((t) => t.id)).toEqual(['team-infra'])
    expect(self.projects?.map((p) => p.id)).toEqual(['p-1'])
    const other = await org.getPerson(ctx(db, ['org.view'], 'ceo'), 'dev')
    expect(other.org_units).toEqual([expect.objectContaining({ id: 'u-eng', is_primary: true })])
    expect(other.projects).toBeNull()
  })

  it('people scopes: my reports freely, a team I am in, a project needs projects.view unless I am on it', async () => {
    const db = seed()
    expect((await org.resolvePeopleScope(ctx(db, [], 'mgr'), 'all_reports')).user_ids).toEqual(['dev', 'intern'])
    expect((await org.resolvePeopleScope(ctx(db, [], 'intern'), { kind: 'team', team_id: 'team-plat', recursive: true })).user_ids.sort()).toEqual(['intern', 'mgr'])
    await expect(org.resolvePeopleScope(ctx(db, [], 'ceo'), { kind: 'team', team_id: 'team-plat' })).rejects.toMatchObject({ code: 'forbidden' })
    expect((await org.resolvePeopleScope(ctx(db, [], 'intern'), { kind: 'project', project_id: 'p-1' })).user_ids.sort()).toEqual(['dev', 'intern', 'mgr'])
    await expect(org.resolvePeopleScope(ctx(db, ['org.view'], 'dev'), { kind: 'org_unit', org_unit_id: 'u-b' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('org units: tree with headcounts, another workspace’s unit is not found', async () => {
    const db = seed()
    const tree = await org.getOrgUnitTree(ctx(db, ['org.view']))
    expect(tree.units.map((u) => u.id).sort()).toEqual(['u-eng', 'u-okta'])
    expect(tree.units.find((u) => u.id === 'u-okta')?.read_only).toBe(true)
    expect(tree.units.find((u) => u.id === 'u-eng')).toMatchObject({ headcount: 1, team_ids: ['team-plat'] })
    await expect(org.getOrgUnit(ctx(db, ['org.view']), 'u-b')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('org service: writes', () => {
  it('org units need org.manage; imported ones are read-only until detached', async () => {
    const db = seed()
    await expect(org.createOrgUnit(ctx(db, ['org.view']), { name: 'Ops' })).rejects.toMatchObject({ code: 'forbidden' })
    const unit = await org.createOrgUnit(ctx(db, ['org.manage']), { name: '  Ops  ', parent_id: 'u-eng' })
    expect(unit).toMatchObject({ name: 'Ops', parent_id: 'u-eng', source: 'manual' })
    await expect(org.updateOrgUnit(ctx(db, ['org.manage']), 'u-okta', { name: 'Revenue' })).rejects.toMatchObject({ code: 'conflict' })
    await org.detachOrgUnit(ctx(db, ['org.manage']), 'u-okta')
    expect(await org.updateOrgUnit(ctx(db, ['org.manage']), 'u-okta', { name: 'Revenue' })).toMatchObject({ name: 'Revenue', detached: true })
    expect(vi.mocked(writeAudit).mock.calls.map(([entry]) => entry.objectType)).toContain('org_unit')
  })

  it('moving a unit under its own descendant is refused', async () => {
    const db = seed()
    const child = await org.createOrgUnit(ctx(db, ['org.manage']), { name: 'Web', parent_id: 'u-eng' })
    await expect(org.updateOrgUnit(ctx(db, ['org.manage']), 'u-eng', { parent_id: child.id })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('directory-owned attributes are refused until detached; manual ones save', async () => {
    const db = seed()
    await expect(org.updatePersonProfile(ctx(db, ['org.view']), 'intern', { job_title: 'Intern' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(org.updatePersonProfile(ctx(db, ['org.manage']), 'dev', { job_title: 'Staff Engineer' })).rejects.toMatchObject({ code: 'conflict' })
    // Unchanged values are not a change, even when directory-owned.
    await expect(org.updatePersonProfile(ctx(db, ['org.manage']), 'dev', { job_title: 'Engineer' })).resolves.toBeTruthy()
    expect(await org.detachPersonProfile(ctx(db, ['org.manage']), 'dev')).toEqual({ detached: true, user_id: 'dev' })
    const updated = await org.updatePersonProfile(ctx(db, ['org.manage']), 'dev', { job_title: 'Staff Engineer', location: ' Auckland ' })
    expect(updated).toMatchObject({ job_title: 'Staff Engineer', location: 'Auckland', profile_source: 'manual' })
  })
})

describe('projects service', () => {
  it('lists with projects.view; reading one needs projects.view unless you are on it', async () => {
    const db = seed()
    await expect(projects.listProjects(ctx(db, []))).rejects.toMatchObject({ code: 'forbidden' })
    expect((await projects.listProjects(ctx(db, ['projects.view']))).projects[0]).toMatchObject({ key: 'APO', member_count: 1, people_count: 3 })
    await expect(projects.getProject(ctx(db, [], 'outsider'), 'p-1')).rejects.toMatchObject({ code: 'forbidden' })
    const viaTeam = await projects.getProject(ctx(db, [], 'intern'), 'p-1')
    expect(viaTeam.teams[0]).toMatchObject({ id: 'team-plat', member_count: 2 })
  })

  it('members = direct ∪ attached teams (sub-teams included); include_teams=false is direct only', async () => {
    const db = seed()
    const all = await projects.getProjectMembers(ctx(db, ['projects.view']), 'p-1')
    expect(all.members.map((m) => m.id).sort()).toEqual(['dev', 'intern', 'mgr'])
    expect(all.members.find((m) => m.id === 'intern')).toMatchObject({ direct: false, via_team_ids: ['team-plat'] })
    expect((await projects.getProjectMembers(ctx(db, ['projects.view']), 'p-1', { includeTeams: false })).members.map((m) => m.id)).toEqual(['dev'])
  })

  it('writes need projects.manage; keys are generated and validated', async () => {
    const db = seed()
    await expect(projects.createProject(ctx(db, ['projects.view']), { name: 'Hermes' })).rejects.toMatchObject({ code: 'forbidden' })
    const created = await projects.createProject(ctx(db, ['projects.manage']), { name: 'Mobile App Relaunch', start_date: '2026-01-01', end_date: '2026-06-30' })
    expect(created).toMatchObject({ key: 'MAR', status: 'active', owner: expect.objectContaining({ id: 'dev' }) })
    await expect(projects.createProject(ctx(db, ['projects.manage']), { name: 'Bad', start_date: '2026-02-01', end_date: '2026-01-01' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(projects.addProjectMember(ctx(db, ['projects.manage']), 'p-1', 'outsider')).rejects.toMatchObject({ code: 'validation_error' })
    expect(await projects.addProjectMember(ctx(db, ['projects.manage']), 'p-1', 'intern', { role: 'Member', allocation_percent: 20 })).toMatchObject({ already_member: false, allocation_percent: 20 })
    expect((await projects.archiveProject(ctx(db, ['projects.manage']), 'p-1')).status).toBe('archived')
  })
})

describe('REST routes', () => {
  const mocked = vi.mocked(validateApiKey)
  function authAs(db: Memory, permissions: string[], actingUserId: string | null = 'dev') {
    mocked.mockResolvedValue({
      success: true, supabase: db, tenantId: T, keyId: 'key-1', keyType: actingUserId ? 'user' : 'tenant', actingUserId,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
    } as unknown as ApiKeySuccessResult)
  }
  const call = async (handler: (req: NextRequest, c: { params: Promise<Record<string, string>> }) => Promise<Response>, url: string, params: Record<string, string> = {}, init?: RequestInit) => {
    const res = await handler(new NextRequest(`http://localhost/api/v1${url}`, init as never), { params: Promise.resolve(params) })
    return { status: res.status, json: await res.json() }
  }

  it('GET /org/scope resolves my reports for a key with no org permission', async () => {
    authAs(seed(), ['tasks.view_own'], 'mgr')
    const { status, json } = await call(scopeRoute.GET as never, '/org/scope?scope=all_reports')
    expect(status).toBe(200)
    expect(json.data.user_ids).toEqual(['dev', 'intern'])
  })

  it('GET /org/scope with team but no id is a 400', async () => {
    authAs(seed(), ['org.view'])
    expect((await call(scopeRoute.GET as never, '/org/scope?scope=team')).status).toBe(400)
  })

  it('GET /org/people/{id}/subordinates: me is free, others need org.view', async () => {
    authAs(seed(), [], 'mgr')
    expect((await call(subordinatesRoute.GET as never, '/org/people/me/subordinates?depth=all', { id: 'me' })).json.data.total).toBe(2)
    expect((await call(subordinatesRoute.GET as never, '/org/people/ceo/subordinates', { id: 'ceo' })).status).toBe(403)
  })

  it('GET /projects/{id}/members and POST /org/units enforce permissions', async () => {
    authAs(seed(), ['projects.view'])
    expect((await call(projectMembersRoute.GET as never, '/projects/p-1/members?include_teams=false', { id: 'p-1' })).json.data.total).toBe(1)
    authAs(seed(), ['org.view'])
    const denied = await call(unitsRoute.POST as never, '/org/units', {}, { method: 'POST', body: JSON.stringify({ name: 'X' }) })
    expect(denied.status).toBe(403)
    authAs(seed(), ['org.manage'])
    const created = await call(unitsRoute.POST as never, '/org/units', {}, { method: 'POST', body: JSON.stringify({ name: 'X' }) })
    expect(created.status).toBe(201)
    expect(created.json.data.unit.name).toBe('X')
  })

  it('scopeFromQuery maps flags', () => {
    expect(scopeFromQuery({ scope: 'project', id: 'p', include_teams: 'false' })).toEqual({ kind: 'project', project_id: 'p', includeTeams: false })
    expect(scopeFromQuery({ scope: 'direct_reports', include_self: 'true' })).toEqual({ kind: 'direct_reports', includeSelf: true })
  })
})

describe('MCP tools', () => {
  const text = (r: { content?: Array<{ text?: string }> }) => r.content?.[0]?.text ?? ''
  const server = (db: Memory, permissions: string[], actingUserId = 'mgr') =>
    createMcpServer({ tenantId: T, supabase: db, actingUserId, keyType: 'user', permissions })

  it('org_subordinates for yourself works at the floor permission', async () => {
    const result = await server(seed(), ['tasks.view_own']).callTool('org_subordinates', { user_id: 'me', depth: 'all' })
    expect(result.isError).toBeFalsy()
    expect(JSON.parse(text(result)).total).toBe(2)
  })

  it('org_chart needs org.view; org_unit_create needs org.manage', async () => {
    expect((await server(seed(), ['tasks.view_own']).callTool('org_chart', {})).isError).toBe(true)
    expect((await server(seed(), ['org.view']).callTool('org_chart', {})).isError).toBeFalsy()
    expect((await server(seed(), ['org.view']).callTool('org_unit_create', { name: 'Ops' })).isError).toBe(true)
    expect((await server(seed(), ['org.manage']).callTool('org_unit_create', { name: 'Ops' })).isError).toBeFalsy()
  })

  it('projects_members unions teams; projects_create needs projects.manage', async () => {
    const members = await server(seed(), [...PERMISSION_KEYS]).callTool('projects_members', { project_id: 'p-1' })
    expect(JSON.parse(text(members)).total).toBe(3)
    expect((await server(seed(), ['projects.view']).callTool('projects_create', { name: 'Hermes' })).isError).toBe(true)
  })

  it('teams_update passes the new team fields through', async () => {
    const db = seed()
    const result = await server(db, [...PERMISSION_KEYS]).callTool('teams_update', { team_id: 'team-infra', kind: 'Guild', colour: '#112233' })
    expect(result.isError).toBeFalsy()
    expect(db.calls.find((c) => c.table === 'teams' && c.op === 'update')?.payload).toMatchObject({ kind: 'guild', colour: '#112233' })
  })
})
