import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '@/lib/org/csv'
import { buildImportState, exportRows, findCycles, IMPORT_FIELDS, planImport, resolveMapping, splitTeams, unitPlacement, type ImportState } from '@/lib/org/import-plan'
import { emptySnapshot, type OrgPerson, type OrgSnapshot } from '@/lib/org/structure'
import { orgCsvTemplate } from '@/lib/services/org-import'

function person(id: string, over: Partial<OrgPerson> = {}): OrgPerson {
  return {
    id, display_name: id.toUpperCase(), email: `${id}@x.test`, avatar_url: null, manager_user_id: null, manager_source: null,
    job_title: null, department: null, location: null, employee_id: null, cost_center: null, profile_source: null, ...over,
  }
}

function snapshot(): OrgSnapshot {
  return {
    ...emptySnapshot(),
    people: [
      person('ceo', { job_title: 'CEO', location: 'London' }),
      person('cto', { manager_user_id: 'ceo', job_title: 'CTO' }),
      person('dev', { manager_user_id: 'cto', job_title: 'Engineer', employee_id: 'E9' }),
      person('dir', { job_title: 'Synced', profile_source: 'directory' }),
      person('blank'),
    ],
    units: [
      { id: 'u-ops', name: 'Operations', kind: 'division', parent_id: null, head_user_id: null, description: null, source: 'csv', external_id: 'division:operations', detached: false, sort: 0 },
      { id: 'u-fin', name: 'Finance', kind: 'department', parent_id: 'u-ops', head_user_id: null, description: null, source: 'csv', external_id: 'division:operations/department:finance', detached: false, sort: 0 },
    ],
    unitMembers: [{ org_unit_id: 'u-fin', user_id: 'cto', role: null, is_primary: true, source: 'csv' }],
    teams: [{ id: 't1', name: 'Platform', description: null, parent_id: null, lead_user_id: null, org_unit_id: null, colour: null, kind: 'team' }],
    teamMembers: [{ team_id: 't1', user_id: 'dev', role: 'member' }],
  }
}

const state: ImportState = buildImportState(snapshot())

function plan(csv: string, mapping?: Parameters<typeof planImport>[1], s: ImportState = state) {
  return planImport(parseCsv(csv), mapping, s)
}

const byRow = (p: ReturnType<typeof plan>, row: number) => p.rows.find((r) => r.row === row)!

describe('import state', () => {
  it('derives department / division from the primary unit when the attribute is empty', () => {
    expect(unitPlacement(snapshot(), 'cto')).toEqual({ department: 'Finance', division: 'Operations', has_unit: true })
    const cto = state.people.find((p) => p.user_id === 'cto')!
    expect(cto).toMatchObject({ department: 'Finance', division: 'Operations', has_unit: true })
    expect(state.people.find((p) => p.user_id === 'dev')!.teams).toEqual(['Platform'])
  })
})

describe('planImport', () => {
  it('row errors: unknown member, duplicate, unknown manager, self-manager, bad email', () => {
    const p = plan([
      'email,manager_email,job_title',
      'stranger@x.test,,Dev',
      'dev@x.test,,Senior Engineer',
      'DEV@x.test,,Again',
      'blank@x.test,ghost@x.test,',
      'cto@x.test,cto@x.test,',
      'not-an-email,,',
      ',,',
    ].join('\n'))
    expect(byRow(p, 1).errors).toEqual(['Not a member of this workspace (invite them first)'])
    expect(byRow(p, 2).action).toBe('update')
    expect(byRow(p, 3).errors).toEqual(['Duplicate of row 2'])
    expect(byRow(p, 4).errors[0]).toMatch(/Manager ghost@x.test is not a member/)
    expect(byRow(p, 5).errors).toEqual(['A person cannot be their own manager'])
    expect(byRow(p, 6).errors[0]).toMatch(/not an email/)
    expect(byRow(p, 7).errors).toEqual(['Email is required'])
    expect(p.summary).toEqual({ total: 7, create: 0, update: 1, unchanged: 0, errors: 6 })
    expect(p.ops.has(1)).toBe(false)
    expect(p.ops.get(2)?.profile).toEqual({ job_title: 'Senior Engineer' })
  })

  it('flags manager loops through existing lines and file lines', () => {
    // Existing: dev → cto → ceo. The file makes ceo report to dev: a loop.
    const p = plan('email,manager_email\nceo@x.test,dev@x.test\nblank@x.test,dev@x.test')
    expect(p.cycles).toHaveLength(1)
    expect(new Set(p.cycles[0])).toEqual(new Set(['ceo@x.test', 'dev@x.test', 'cto@x.test']))
    expect(byRow(p, 1).action).toBe('error')
    expect(byRow(p, 1).errors[0]).toMatch(/Manager loop/)
    expect(byRow(p, 2).action).toBe('create')
    expect(p.ops.get(2)?.manager).toBe('dev')
  })

  it('a swap in one file is not a loop once both rows apply', () => {
    // cto → ceo today; the file makes ceo report to cto and cto report to nobody.
    const p = plan('email,manager_email\nceo@x.test,cto@x.test\ncto@x.test,-')
    expect(p.cycles).toEqual([])
    expect(p.ops.get(1)?.manager).toBe('cto')
    expect(p.ops.get(2)?.manager).toBeNull()
  })

  it('refuses attribute changes for directory-owned people, but allows manager / team', () => {
    const p = plan('email,job_title,manager_email,team\ndir@x.test,Changed,,\ndir@x.test,,,')
    expect(byRow(p, 1).errors[0]).toMatch(/come from the directory/)
    const q = plan('email,job_title,manager_email,team\ndir@x.test,Synced,ceo@x.test,Platform')
    expect(byRow(q, 1).action).toBe('update')
    expect(q.ops.get(1)).toMatchObject({ manager: 'ceo', add_teams: ['Platform'], profile: {} })
  })

  it('blank = unchanged, "-" = clear', () => {
    const p = plan('email,job_title,location,employee_id,manager_email\ndev@x.test,,,-,\ncto@x.test,,,,-\nceo@x.test,CEO,London,,')
    expect(byRow(p, 1).changes).toEqual({ employee_id: { before: 'E9', after: null } })
    expect(p.ops.get(1)?.profile).toEqual({ employee_id: null })
    expect(byRow(p, 2).changes.manager).toEqual({ before: 'ceo@x.test', after: null })
    expect(byRow(p, 3).action).toBe('unchanged')
  })

  it('create = first placement; update otherwise; department/division move the CSV unit', () => {
    const p = plan('email,department,division,team\nblank@x.test,Finance,Operations,New Team; platform\ncto@x.test,Payroll,,')
    expect(byRow(p, 1).action).toBe('create')
    expect(p.ops.get(1)?.unit_path).toEqual([{ kind: 'division', name: 'Operations' }, { kind: 'department', name: 'Finance' }])
    expect(p.ops.get(1)?.add_teams).toEqual(['New Team', 'Platform'])
    expect(byRow(p, 2).action).toBe('update')
    expect(byRow(p, 2).changes.org_unit).toEqual({ before: 'Operations / Finance', after: 'Operations / Payroll' })
    expect(p.org_units.existing).toContain('Operations')
    expect(p.org_units.create).toEqual(['Operations / Payroll'])
    expect(p.org_units.existing).toContain('Operations / Finance')
    expect(p.teams).toEqual({ create: ['New Team'], existing: ['Platform'] })
  })

  it('needs an email column; explicit mapping wins and can skip a column', () => {
    expect(() => plan('name\nx')).toThrow(/No email column/)
    const p = plan('Work Mail,Title\ndev@x.test,Boss', { email: 'Work Mail', job_title: null })
    expect(p.mapping.email).toBe('Work Mail')
    expect(p.mapping.job_title).toBeNull()
    expect(byRow(p, 1).action).toBe('unchanged')
    expect(resolveMapping(['Email'], { team: 'Nope' }).team).toBeNull()
  })

  it('team "-" is ignored with a warning; teams split on ;', () => {
    expect(splitTeams('A; B ;; a|C')).toEqual(['A', 'B', 'a', 'C'])
    const p = plan('email,team\ndev@x.test,-')
    expect(byRow(p, 1).action).toBe('unchanged')
    expect(byRow(p, 1).warnings[0]).toMatch(/never removes/)
  })
})

describe('export round trip', () => {
  it('export → plan is all unchanged', () => {
    const csv = toCsv(IMPORT_FIELDS, exportRows(state))
    const p = plan(csv)
    expect(p.summary).toEqual({ total: 5, create: 0, update: 0, unchanged: 5, errors: 0 })
    expect(p.ops.size).toBe(0)
  })

  it('the template parses and maps every column', () => {
    const parsed = parseCsv(orgCsvTemplate())
    expect(parsed.headers).toEqual([...IMPORT_FIELDS])
    expect(parsed.rows).toHaveLength(2)
  })
})

describe('findCycles', () => {
  it('reports each loop once', () => {
    const m = new Map([['a', 'b'], ['b', 'a'], ['c', 'a'], ['d', 'e']])
    expect(findCycles(m, ['a', 'b', 'c', 'd'])).toEqual([['a', 'b']])
  })
})
