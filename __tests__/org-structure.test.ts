import { describe, expect, it } from 'vitest'
import {
  allBelow, ancestorIds, buildTree, chartRoots, descendantIds, emptySnapshot, managerChainOf, orgUnitMembersOf, peersOf,
  projectMembersOf, projectsOfUser, projectTeamIdsOf, reportCounts, reportingIndexOf, resolveScopeIds, subordinatesOf,
  teamMembersOf, teamsOfUser, unitHeadcounts, wouldCreateTreeCycle,
  type OrgPerson, type OrgSnapshot,
} from '@/lib/org/structure'

function person(id: string, manager: string | null = null): OrgPerson {
  return {
    id, display_name: id.toUpperCase(), email: `${id}@x.test`, avatar_url: null, manager_user_id: manager, manager_source: null,
    job_title: null, department: null, location: null, employee_id: null, cost_center: null, profile_source: null,
  }
}

// ceo → (cto → (dev1, dev2 → intern), cfo → acct)
const PEOPLE = [
  person('ceo'), person('cto', 'ceo'), person('cfo', 'ceo'), person('dev1', 'cto'), person('dev2', 'cto'),
  person('intern', 'dev2'), person('acct', 'cfo'), person('loner'),
]

function snap(partial: Partial<OrgSnapshot> = {}): OrgSnapshot {
  return { ...emptySnapshot(), people: PEOPLE, ...partial }
}

describe('reporting lines', () => {
  const index = reportingIndexOf(PEOPLE)

  it('direct subordinates', () => {
    expect(subordinatesOf(index, 'cto').map((s) => s.user_id).sort()).toEqual(['dev1', 'dev2'])
  })

  it('all subordinates with depth, and includeSelf', () => {
    const all = subordinatesOf(index, 'ceo', { depth: 'all', includeSelf: true })
    expect(all[0]).toEqual({ user_id: 'ceo', depth: 0, manager_user_id: null })
    expect(Object.fromEntries(all.map((s) => [s.user_id, s.depth]))).toEqual({ ceo: 0, cto: 1, cfo: 1, dev1: 2, dev2: 2, acct: 2, intern: 3 })
  })

  it('manager chain and peers', () => {
    expect(managerChainOf(index, 'intern')).toEqual(['dev2', 'cto', 'ceo'])
    expect(peersOf(index, 'dev1')).toEqual(['dev2'])
    expect(peersOf(index, 'ceo')).toEqual([])
  })

  it('is cycle-safe on bad data', () => {
    const looped = reportingIndexOf([person('a', 'c'), person('b', 'a'), person('c', 'b')])
    expect(subordinatesOf(looped, 'a', { depth: 'all' }).map((s) => s.user_id)).toEqual(['b', 'c'])
    expect(managerChainOf(looped, 'a')).toEqual(['c', 'b'])
    expect(allBelow(looped, 'a').sort()).toEqual(['b', 'c'])
    // Everyone in the loop is still reachable from a chart root.
    expect(chartRoots([person('a', 'c'), person('b', 'a'), person('c', 'b')])).toHaveLength(1)
  })

  it('report counts are uncapped totals', () => {
    const counts = reportCounts(index)
    expect(counts.get('ceo')).toEqual({ direct: 2, total: 6 })
    expect(counts.get('dev2')).toEqual({ direct: 1, total: 1 })
    // A 30-level chain: the chart counts every level (the subordinate query caps at 10).
    const chain = Array.from({ length: 30 }, (_, i) => person(`p${i}`, i ? `p${i - 1}` : null))
    const chainIndex = reportingIndexOf(chain)
    expect(reportCounts(chainIndex).get('p0')?.total).toBe(29)
    expect(subordinatesOf(chainIndex, 'p0', { depth: 'all' })).toHaveLength(10)
    expect(chartRoots(chain)).toEqual(['p0'])
  })

  it('chart roots: biggest organisation first', () => {
    expect(chartRoots(PEOPLE)).toEqual(['ceo', 'loner'])
  })
})

describe('trees', () => {
  const rows = [
    { id: 'co', parent_id: null }, { id: 'eng', parent_id: 'co' }, { id: 'web', parent_id: 'eng' },
    { id: 'fin', parent_id: 'co' }, { id: 'orphan', parent_id: 'missing' },
  ]
  const tree = buildTree(rows)

  it('builds roots, children and walks', () => {
    expect(tree.roots).toEqual(['co', 'orphan'])
    expect(descendantIds(tree, 'co')).toEqual(['co', 'eng', 'fin', 'web'])
    expect(descendantIds(tree, 'co', { includeSelf: false, maxDepth: 1 })).toEqual(['eng', 'fin'])
    expect(ancestorIds(tree, 'web')).toEqual(['eng', 'co'])
  })

  it('detects would-be cycles', () => {
    expect(wouldCreateTreeCycle(tree, 'eng', 'web')).toBe(true)
    expect(wouldCreateTreeCycle(tree, 'eng', 'eng')).toBe(true)
    expect(wouldCreateTreeCycle(tree, 'fin', 'web')).toBe(false)
    expect(wouldCreateTreeCycle(tree, 'fin', null)).toBe(false)
  })

  it('cuts existing loops so walks terminate', () => {
    const looped = buildTree([{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'a' }])
    expect(looped.roots.length).toBeGreaterThan(0)
    expect(descendantIds(looped, 'a').sort()).toEqual(expect.arrayContaining(['a', 'c']))
  })
})

describe('org units', () => {
  const s = snap({
    units: [
      { id: 'co', name: 'Co', kind: 'company', parent_id: null, head_user_id: 'ceo', description: null, source: 'manual', external_id: null, detached: false, sort: 0 },
      { id: 'eng', name: 'Eng', kind: 'department', parent_id: 'co', head_user_id: 'cto', description: null, source: 'manual', external_id: null, detached: false, sort: 0 },
      { id: 'web', name: 'Web', kind: 'unit', parent_id: 'eng', head_user_id: null, description: null, source: 'manual', external_id: null, detached: false, sort: 0 },
    ],
    unitMembers: [
      { org_unit_id: 'co', user_id: 'ceo', role: 'CEO', is_primary: true, source: 'manual' },
      { org_unit_id: 'eng', user_id: 'cto', role: null, is_primary: true, source: 'manual' },
      { org_unit_id: 'web', user_id: 'dev1', role: null, is_primary: true, source: 'manual' },
      { org_unit_id: 'web', user_id: 'cto', role: 'Sponsor', is_primary: false, source: 'manual' },
    ],
  })

  it('direct and recursive members (de-duplicated, provenance kept)', () => {
    expect(orgUnitMembersOf(s, 'eng').map((m) => m.user_id)).toEqual(['cto'])
    const all = orgUnitMembersOf(s, 'co', { recursive: true })
    expect(all.map((m) => m.user_id).sort()).toEqual(['ceo', 'cto', 'dev1'])
    expect(all.find((m) => m.user_id === 'cto')).toMatchObject({ direct: false, via: ['eng', 'web'] })
    expect(orgUnitMembersOf(s, 'nope', { recursive: true })).toEqual([])
  })

  it('headcounts', () => {
    const counts = unitHeadcounts(s)
    expect(counts.get('co')).toEqual({ direct: 1, total: 3 })
    expect(counts.get('web')).toEqual({ direct: 2, total: 2 })
  })
})

describe('teams and projects', () => {
  const s = snap({
    teams: [
      { id: 'platform', name: 'Platform', description: null, parent_id: null, lead_user_id: 'cto', org_unit_id: null, colour: null, kind: 'team' },
      { id: 'infra', name: 'Infra', description: null, parent_id: 'platform', lead_user_id: null, org_unit_id: null, colour: null, kind: 'squad' },
      { id: 'finance', name: 'Finance', description: null, parent_id: null, lead_user_id: null, org_unit_id: null, colour: null, kind: 'team' },
    ],
    teamMembers: [
      { team_id: 'platform', user_id: 'cto', role: 'lead' },
      { team_id: 'infra', user_id: 'dev2', role: 'member' },
      { team_id: 'infra', user_id: 'intern', role: 'member' },
      { team_id: 'finance', user_id: 'acct', role: 'member' },
    ],
    projects: [
      { id: 'p1', name: 'Apollo', key: 'APO', description: null, status: 'active', owner_user_id: 'ceo', sponsor_user_id: null, team_id: null, org_unit_id: null, start_date: null, end_date: null, colour: null, archived_at: null },
      { id: 'p2', name: 'Ledger', key: 'LED', description: null, status: 'archived', owner_user_id: null, sponsor_user_id: null, team_id: 'finance', org_unit_id: null, start_date: null, end_date: null, colour: null, archived_at: null },
    ],
    projectMembers: [
      { project_id: 'p1', user_id: 'dev1', role: 'Lead', allocation_percent: 50 },
      { project_id: 'p1', user_id: 'dev2', role: 'Member', allocation_percent: null },
    ],
    projectTeams: [{ project_id: 'p1', team_id: 'platform' }],
  })

  it('team members, recursive through sub-teams', () => {
    expect(teamMembersOf(s, 'platform').map((m) => m.user_id)).toEqual(['cto'])
    expect(teamMembersOf(s, 'platform', { recursive: true }).map((m) => m.user_id).sort()).toEqual(['cto', 'dev2', 'intern'])
  })

  it('project members = direct ∪ attached teams (with sub-teams)', () => {
    const members = projectMembersOf(s, 'p1')
    expect(members.map((m) => m.user_id).sort()).toEqual(['cto', 'dev1', 'dev2', 'intern'])
    // A direct member who is also in an attached team keeps the project role and records the team.
    expect(members.find((m) => m.user_id === 'dev2')).toMatchObject({ role: 'Member', direct: true, via_team_ids: ['platform'] })
    expect(members.find((m) => m.user_id === 'intern')).toMatchObject({ direct: false, via_team_ids: ['platform'], allocation_percent: null })
    expect(projectMembersOf(s, 'p1', { includeTeams: false }).map((m) => m.user_id).sort()).toEqual(['dev1', 'dev2'])
  })

  it('the owning team counts as attached', () => {
    expect(projectTeamIdsOf(s, 'p2')).toEqual(['finance'])
    expect(projectMembersOf(s, 'p2').map((m) => m.user_id)).toEqual(['acct'])
  })

  it('a person’s teams and projects', () => {
    expect(teamsOfUser(s, 'intern')).toEqual(['infra'])
    expect(teamsOfUser(s, 'intern', { includeParents: true }).sort()).toEqual(['infra', 'platform'])
    expect(projectsOfUser(s, 'intern')).toEqual([{ project_id: 'p1', role: null, direct: false, via_team_ids: ['platform'] }])
    expect(projectsOfUser(s, 'ceo')).toEqual([{ project_id: 'p1', role: 'Owner', direct: true, via_team_ids: [] }])
    expect(projectsOfUser(s, 'acct')).toEqual([])
    expect(projectsOfUser(s, 'acct', { includeArchived: true }).map((p) => p.project_id)).toEqual(['p2'])
  })

  it('people scopes', () => {
    expect(resolveScopeIds(s, 'cto', { kind: 'me' })).toEqual(['cto'])
    expect(resolveScopeIds(s, 'cto', { kind: 'direct_reports' }).sort()).toEqual(['dev1', 'dev2'])
    expect(resolveScopeIds(s, 'cto', { kind: 'all_reports', includeSelf: true }).sort()).toEqual(['cto', 'dev1', 'dev2', 'intern'])
    expect(resolveScopeIds(s, 'x', { kind: 'team', team_id: 'platform', recursive: true }).sort()).toEqual(['cto', 'dev2', 'intern'])
    expect(resolveScopeIds(s, 'x', { kind: 'project', project_id: 'p1', includeTeams: false }).sort()).toEqual(['dev1', 'dev2'])
    expect(resolveScopeIds(s, 'x', { kind: 'team', team_id: 'missing' })).toEqual([])
  })
})
