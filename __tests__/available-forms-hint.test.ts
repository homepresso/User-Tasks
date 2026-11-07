import { describe, expect, it } from 'vitest'
import { availabilityHint, availabilityStatus } from '@/lib/forms/available-forms'

const user = { user_id: 'u1', can_view: true, can_execute: true }
const team = { team_id: 't1', can_view: true, can_execute: false }
const role = { role_id: 'r1', can_view: false, can_execute: true }

describe('availabilityHint', () => {
  it('offers to turn Available forms on when the form has grants but is not listed', () => {
    const hint = availabilityHint({ available: false, grants: [user] })
    expect(hint).toEqual({ tone: 'warning', text: expect.stringContaining('until you tick Available forms'), action: 'turn_on' })
    expect(hint!.text).toMatch(/^People with access won.t see this form in their Forms menu/)
  })

  it('says nobody has access when Available forms is on without grants', () => {
    const hint = availabilityHint({ available: true, grants: [] })
    expect(hint?.tone).toBe('info')
    expect(hint?.text).toMatch(/^Nobody has access yet .* add people, teams or roles below$/)
    expect(hint?.action).toBeUndefined()
  })

  it('is quiet when the two agree', () => {
    expect(availabilityHint({ available: true, grants: [user] })).toBeNull()
    expect(availabilityHint({ available: false, grants: [] })).toBeNull()
  })

  it('ignores grants that give neither View nor Submit', () => {
    const none = { user_id: 'u2', can_view: false, can_execute: false }
    expect(availabilityHint({ available: false, grants: [none] })).toBeNull()
    expect(availabilityHint({ available: true, grants: [none] })?.tone).toBe('info')
  })
})

describe('availabilityStatus', () => {
  it('summarises who the form is shown to', () => {
    expect(availabilityStatus([user])).toBe('Shown to 1 person (1 grant)')
    expect(availabilityStatus([user, { ...user, user_id: 'u2' }, team, role])).toBe('Shown to 2 people, 1 team and 1 role (4 grants)')
    expect(availabilityStatus([team, { ...team, team_id: 't2' }])).toBe('Shown to 2 teams (2 grants)')
  })

  it('is null without grants that list the form', () => {
    expect(availabilityStatus([])).toBeNull()
    expect(availabilityStatus([{ role_id: 'r', can_view: false, can_execute: false }])).toBeNull()
  })
})
