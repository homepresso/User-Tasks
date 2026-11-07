import { describe, expect, it } from 'vitest'
import { attributeUnitPath, orgUnitPathToUnitPath, planUnitMemberships, planUnitPaths, unitPathKey } from '@/lib/org/import-units'

/** Pure planning of imported org units and memberships (lib/org/import-units.ts). */

describe('unit paths', () => {
  it('builds attribute paths, skipping empty parts', () => {
    expect(attributeUnitPath({ company: ' Acme ', division: '', department: 'Finance' }))
      .toEqual([{ kind: 'company', name: 'Acme' }, { kind: 'department', name: 'Finance' }])
    expect(attributeUnitPath({})).toEqual([])
  })

  it('parses Google OU paths', () => {
    expect(orgUnitPathToUnitPath('/Engineering//Web/')).toEqual([{ kind: 'unit', name: 'Engineering' }, { kind: 'unit', name: 'Web' }])
    expect(orgUnitPathToUnitPath('/')).toEqual([])
    expect(orgUnitPathToUnitPath(null)).toEqual([])
  })

  it('keys are case-insensitive and distinguish kinds', () => {
    expect(unitPathKey([{ kind: 'department', name: 'Finance' }])).toBe(unitPathKey([{ kind: 'department', name: 'FINANCE' }]))
    expect(unitPathKey([{ kind: 'division', name: 'Ops' }, { kind: 'department', name: 'Finance' }])).toBe('division:ops/department:finance')
    expect(unitPathKey([{ kind: 'unit', name: 'Eng' }, { kind: 'unit', name: 'Web' }])).toBe('ou:/eng/web')
    expect(unitPathKey([{ kind: 'division', name: 'Finance' }])).not.toBe(unitPathKey([{ kind: 'department', name: 'Finance' }]))
  })

  it('plans every prefix once, parents first, first casing wins', () => {
    const plan = planUnitPaths([
      [{ kind: 'division', name: 'Ops' }, { kind: 'department', name: 'Finance' }],
      [{ kind: 'division', name: 'OPS' }, { kind: 'department', name: 'Legal' }],
      [{ kind: 'department', name: 'Finance' }],
    ])
    expect(plan).toEqual([
      { external_id: 'division:ops', name: 'Ops', kind: 'division', parent_external_id: null },
      { external_id: 'division:ops/department:finance', name: 'Finance', kind: 'department', parent_external_id: 'division:ops' },
      { external_id: 'division:ops/department:legal', name: 'Legal', kind: 'department', parent_external_id: 'division:ops' },
      { external_id: 'department:finance', name: 'Finance', kind: 'department', parent_external_id: null },
    ])
  })
})

describe('membership plan', () => {
  it('adds, swaps, clears and leaves unchanged memberships alone', () => {
    const current = [
      { user_id: 'same', org_unit_id: 'fin' },
      { user_id: 'mover', org_unit_id: 'fin' },
      { user_id: 'leaver', org_unit_id: 'legal' },
    ]
    const desired = new Map<string, string | null>([['same', 'fin'], ['mover', 'legal'], ['leaver', null], ['new', 'fin']])
    expect(planUnitMemberships(desired, current)).toEqual([
      { user_id: 'mover', add: 'legal', remove: ['fin'] },
      { user_id: 'leaver', add: null, remove: ['legal'] },
      { user_id: 'new', add: 'fin', remove: [] },
    ])
  })

  it('a re-sync with the same data plans nothing', () => {
    expect(planUnitMemberships(new Map([['a', 'x']]), [{ user_id: 'a', org_unit_id: 'x' }])).toEqual([])
  })
})
