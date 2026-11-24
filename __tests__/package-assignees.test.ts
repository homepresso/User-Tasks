/**
 * Package assignees (lib/packages/assignees.ts, lib/services/package-assignees.ts):
 * what each step can take, the value forms (id / email / team:<id>), a team
 * written into the team field and a person into the person field, the
 * workspace check (foreign ids and emails rejected), "Assign all", the
 * picker's typed / pasted text, and the API / CLI value forms unchanged.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { createFakeSupabase } from './helpers/fake-supabase'
import { applyRequirementValues, detectRequirements } from '@/lib/packages/requirements'
import { assigneeTargetOf, fillEmptyAssignees, parseAssigneeValue, resolveTypedAssignee } from '@/lib/packages/assignees'
import { assigneeWriter, checkPackageAssignees, stripAssigneeInfo, withAssigneeInfo } from '@/lib/services/package-assignees'
import { assigneeFieldLabel, AssigneePicker } from '@/components/packages/assignee-requirement-field'
import type { PackageRequirement } from '@/lib/packages/format'

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

const T = '20000000-0000-4000-8000-00000000000a' // this workspace
const OTHER = '20000000-0000-4000-8000-00000000000b' // another workspace
const W = '20000000-0000-4000-8000-000000000001'
const ALICE = '20000000-0000-4000-8000-000000000101' // member here
const BOB = '20000000-0000-4000-8000-000000000102' // member of the other workspace only
const GONE = '20000000-0000-4000-8000-000000000103' // inactive member here
const SALES = '20000000-0000-4000-8000-000000000201' // team here
const FOREIGN_TEAM = '20000000-0000-4000-8000-000000000202' // team of the other workspace
const PLACEHOLDER = '20000000-0000-4000-8000-000000000999' // the package's own (unknown) person

function workflow() {
  return {
    id: W, name: 'Lead conversion', is_active: true,
    nodes: [
      { id: 'a', type: 'user_task', label: 'Qualify the lead', config: { assignment_type: 'individual', assignee_id: PLACEHOLDER, escalation_enabled: true, escalation_type: 'individual', escalation_user_id: PLACEHOLDER } },
      { id: 'b', type: 'user_task', label: 'Triage', config: { assignment_type: 'team', team_id: PLACEHOLDER } },
      { id: 'c', type: 'update_task', label: 'Reassign', config: { assignee_id: PLACEHOLDER } },
      { id: 'd', type: 'user_task', label: 'Entra group', config: { assignment_type: 'aad_group', assignee_id: PLACEHOLDER } },
    ],
  }
}

function setup() {
  const assets: Record<string, any> = { workflows: [workflow()] }
  const people = [
    { kind: 'user' as const, id: PLACEHOLDER, section: 'workflows', asset_id: W, path: ['nodes', 0, 'config', 'assignee_id'] },
    { kind: 'user' as const, id: PLACEHOLDER, section: 'workflows', asset_id: W, path: ['nodes', 0, 'config', 'escalation_user_id'] },
    { kind: 'team' as const, id: PLACEHOLDER, section: 'workflows', asset_id: W, path: ['nodes', 1, 'config', 'team_id'] },
    { kind: 'user' as const, id: PLACEHOLDER, section: 'workflows', asset_id: W, path: ['nodes', 2, 'config', 'assignee_id'] },
    { kind: 'user' as const, id: PLACEHOLDER, section: 'workflows', asset_id: W, path: ['nodes', 3, 'config', 'assignee_id'] },
  ]
  const [requirement] = detectRequirements(assets, { people })
  const field = (key: string) => requirement.fields.find((f) => f.key === key)!
  return { assets, requirement, field, REQ: requirement.id }
}

function fakeDb() {
  return createFakeSupabase({
    users: [
      { id: ALICE, display_name: 'Alice Ng', email: 'alice@example.com', deleted_at: null },
      { id: BOB, display_name: 'Bob Roe', email: 'bob@other.example', deleted_at: null },
      { id: GONE, display_name: 'Gone Person', email: 'gone@example.com', deleted_at: null },
    ],
    user_memberships: [
      { user_id: ALICE, tenant_id: T, is_active: true },
      { user_id: BOB, tenant_id: OTHER, is_active: true },
      { user_id: GONE, tenant_id: T, is_active: false },
    ],
    teams: [
      { id: SALES, tenant_id: T, name: 'Sales' },
      { id: FOREIGN_TEAM, tenant_id: OTHER, name: 'Their team' },
    ],
  })
}

describe('what a step can take', () => {
  const { assets, field } = setup()
  it('a user task takes a person or a team, for its assignee and its escalation', () => {
    expect(assigneeTargetOf(assets, field('nodes.0.config.assignee_id'))).toEqual({ declared: 'user', accepts: ['user', 'team'], slot: 'assignment' })
    expect(assigneeTargetOf(assets, field('nodes.0.config.escalation_user_id'))).toEqual({ declared: 'user', accepts: ['user', 'team'], slot: 'escalation' })
    expect(assigneeTargetOf(assets, field('nodes.1.config.team_id'))).toEqual({ declared: 'team', accepts: ['user', 'team'], slot: 'assignment' })
  })
  it('other steps (and Entra group assignment) take the declared kind only', () => {
    expect(assigneeTargetOf(assets, field('nodes.2.config.assignee_id'))).toEqual({ declared: 'user', accepts: ['user'], slot: null })
    expect(assigneeTargetOf(assets, field('nodes.3.config.assignee_id'))).toEqual({ declared: 'user', accepts: ['user'], slot: null })
  })
})

describe('value forms (API / CLI unchanged)', () => {
  const user = { declared: 'user' as const, accepts: ['user' as const] }
  const both = { declared: 'user' as const, accepts: ['user' as const, 'team' as const] }
  const team = { declared: 'team' as const, accepts: ['team' as const] }
  it('a plain id is the declared kind; an email is a person; prefixes are explicit', () => {
    expect(parseAssigneeValue(ALICE, user)).toEqual({ kind: 'user', id: ALICE })
    expect(parseAssigneeValue(SALES, team)).toEqual({ kind: 'team', id: SALES })
    expect(parseAssigneeValue(' Alice@Example.com ', user)).toEqual({ kind: 'user', email: 'alice@example.com' })
    expect(parseAssigneeValue(`team:${SALES}`, both)).toEqual({ kind: 'team', id: SALES })
    expect(parseAssigneeValue(`user:${ALICE}`, both)).toEqual({ kind: 'user', id: ALICE })
  })
  it('refuses a team where the step takes a person only, and junk', () => {
    expect(parseAssigneeValue(`team:${SALES}`, user)).toEqual({ error: expect.stringMatching(/only be assigned to a person/) })
    expect(parseAssigneeValue('someone', user)).toEqual({ error: expect.any(String) })
    expect(parseAssigneeValue('team:not-a-uuid', both)).toEqual({ error: expect.any(String) })
  })
})

describe('server check: this workspace only', () => {
  it('resolves members, emails and teams of this workspace; rejects foreign ids, unknown emails and inactive members', async () => {
    const { assets, requirement, REQ } = setup()
    const fake = fakeDb()
    const values = { [REQ]: {
      'nodes.0.config.assignee_id': 'alice@example.com',
      'nodes.0.config.escalation_user_id': BOB, // another workspace's person
      'nodes.1.config.team_id': FOREIGN_TEAM, // another workspace's team
      'nodes.2.config.assignee_id': GONE, // inactive here
      'nodes.3.config.assignee_id': 'nobody@example.com',
    } }
    const check = await checkPackageAssignees(fake.client as any, T, { requirements: [requirement], values, supplied: values, assets })
    expect(check.errors.map((e) => [e.field.key, e.supplied])).toEqual([
      ['nodes.0.config.escalation_user_id', true],
      ['nodes.1.config.team_id', true],
      ['nodes.2.config.assignee_id', true],
      ['nodes.3.config.assignee_id', true],
    ])
    expect(check.errors.find((e) => e.field.key === 'nodes.3.config.assignee_id')!.message).toBe('No one in this workspace has the email nobody@example.com')
    // Invalid values are dropped (the field counts as empty), the valid one resolved.
    expect(check.values[REQ]).toEqual({ 'nodes.0.config.assignee_id': 'alice@example.com' })
    expect(check.choiceFor(requirement, requirement.fields[0])).toEqual({ kind: 'user', id: ALICE, name: 'Alice Ng', email: 'alice@example.com' })
    // Team lookups are scoped to the workspace.
    expect(fake.calls.some((c) => c.table === 'teams')).toBe(true)
  })

  it('a team on a step that takes a person only is refused', async () => {
    const { assets, requirement, REQ } = setup()
    const values = { [REQ]: { 'nodes.2.config.assignee_id': `team:${SALES}` } }
    const check = await checkPackageAssignees(fakeDb().client as any, T, { requirements: [requirement], values, supplied: values, assets })
    expect(check.errors[0].message).toMatch(/only be assigned to a person/)
  })

  it('kept values that are no longer valid are not "supplied"; a step still holding the package placeholder is not set', async () => {
    const { assets, requirement, REQ } = setup()
    const values = { [REQ]: { 'nodes.0.config.assignee_id': BOB } }
    const check = await checkPackageAssignees(fakeDb().client as any, T, {
      requirements: [requirement], values, supplied: {}, assets,
      stored: (_r, field) => field.key === 'nodes.1.config.team_id' ? SALES : PLACEHOLDER,
    })
    expect(check.errors).toHaveLength(1)
    expect(check.errors[0].supplied).toBe(false)
    expect(check.storedValid(requirement, requirement.fields[0])).toBe(false)
    expect(check.storedValid(requirement, requirement.fields[2])).toBe(true)
    // The earlier, still valid team shows prefilled.
    expect(check.info.get(`${REQ}\u0000nodes.1.config.team_id`)).toEqual({ accepts: ['user', 'team'], current: { kind: 'team', id: SALES, name: 'Sales' } })
  })
})

describe('written into the field the step reads', () => {
  async function install(values: Record<string, string>) {
    const { assets, requirement, REQ } = setup()
    const all = { [REQ]: values }
    const check = await checkPackageAssignees(fakeDb().client as any, T, { requirements: [requirement], values: all, supplied: all, assets })
    applyRequirementValues(assets, [requirement], check.values, undefined, assigneeWriter(check))
    return { nodes: assets.workflows[0].nodes, check }
  }

  it('a team picked for a person step goes into team_id and switches the step to team assignment', async () => {
    const { nodes } = await install({ 'nodes.0.config.assignee_id': `team:${SALES}` })
    expect(nodes[0].config).toMatchObject({ assignment_type: 'team', team_id: SALES })
    expect(nodes[0].config).not.toHaveProperty('assignee_id')
  })

  it('a person picked for a team step goes into assignee_id and switches it to individual', async () => {
    const { nodes } = await install({ 'nodes.1.config.team_id': ALICE.replace(/^/, 'user:') })
    expect(nodes[1].config).toMatchObject({ assignment_type: 'individual', assignee_id: ALICE })
    expect(nodes[1].config).not.toHaveProperty('team_id')
  })

  it('a plain team id in a team field stays a team (the API / CLI form)', async () => {
    const { nodes } = await install({ 'nodes.1.config.team_id': SALES })
    expect(nodes[1].config).toMatchObject({ assignment_type: 'team', team_id: SALES })
  })

  it('escalation to a team sets the escalation team and type', async () => {
    const { nodes } = await install({ 'nodes.0.config.escalation_user_id': `team:${SALES}` })
    expect(nodes[0].config).toMatchObject({ escalation_type: 'team', escalation_team_id: SALES })
    expect(nodes[0].config).not.toHaveProperty('escalation_user_id')
  })

  it('a person by email or id goes into the person field as their id', async () => {
    const { nodes } = await install({ 'nodes.0.config.assignee_id': 'ALICE@example.com', 'nodes.2.config.assignee_id': ALICE })
    expect(nodes[0].config).toMatchObject({ assignment_type: 'individual', assignee_id: ALICE })
    expect(nodes[2].config.assignee_id).toBe(ALICE)
  })

  it('a refused value writes nothing (the step keeps its unknown assignee)', async () => {
    const { nodes } = await install({ 'nodes.0.config.assignee_id': BOB, 'nodes.1.config.team_id': FOREIGN_TEAM })
    expect(nodes[0].config.assignee_id).toBe(PLACEHOLDER)
    expect(nodes[1].config.team_id).toBe(PLACEHOLDER)
  })

  it('plan responses carry the field metadata; stored requirements do not', async () => {
    const { check } = await install({ 'nodes.0.config.assignee_id': ALICE })
    const { requirement } = setup()
    const planned = withAssigneeInfo(requirement, check) as PackageRequirement & { fields: any[] }
    expect(planned.fields[0].assignee).toEqual({ accepts: ['user', 'team'], current: { kind: 'user', id: ALICE, name: 'Alice Ng', email: 'alice@example.com' } })
    expect(stripAssigneeInfo(planned).fields.every((f: any) => !('assignee' in f))).toBe(true)
  })
})

describe('"Assign all"', () => {
  const view = () => {
    const { requirement, REQ } = setup()
    const accepts: Record<string, Array<'user' | 'team'>> = {
      'nodes.0.config.assignee_id': ['user', 'team'],
      'nodes.0.config.escalation_user_id': ['user', 'team'],
      'nodes.1.config.team_id': ['user', 'team'],
      'nodes.2.config.assignee_id': ['user'],
      'nodes.3.config.assignee_id': ['user'],
    }
    return {
      REQ,
      requirements: [{
        ...requirement,
        fields: requirement.fields.map((f) => ({ ...f, assignee: { accepts: accepts[f.key], current: f.key === 'nodes.1.config.team_id' ? { kind: 'team' as const, id: SALES, name: 'Sales' } : null } })),
        field_states: requirement.fields.map((f) => ({ key: f.key, state: 'missing' })),
      }],
    }
  }

  it('fills every empty step with a person, leaving typed and kept ones alone', () => {
    const { REQ, requirements } = view()
    const result = fillEmptyAssignees(requirements, { [REQ]: { 'nodes.0.config.assignee_id': 'typed@example.com' } }, { kind: 'user', id: ALICE })
    expect(result.filled).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.values[REQ]).toEqual({
      'nodes.0.config.assignee_id': 'typed@example.com',
      'nodes.0.config.escalation_user_id': ALICE,
      'nodes.2.config.assignee_id': ALICE,
      'nodes.3.config.assignee_id': ALICE,
    })
  })

  it('a team only goes to steps that can take a team', () => {
    const { REQ, requirements } = view()
    const result = fillEmptyAssignees(requirements, {}, { kind: 'team', id: SALES })
    expect(result).toMatchObject({ filled: 2, skipped: 2 })
    expect(result.values[REQ]).toEqual({ 'nodes.0.config.assignee_id': `team:${SALES}`, 'nodes.0.config.escalation_user_id': `team:${SALES}` })
  })
})

describe('the picker', () => {
  const found = {
    people: [{ id: ALICE, name: 'Alice Ng', email: 'alice@example.com' }, { id: BOB, name: 'Alicia Bo', email: 'alicia@example.com' }],
    teams: [{ id: SALES, name: 'Sales', member_count: 3 }],
  }
  it('a pasted email picks exactly that person, or says nobody here has it', () => {
    expect(resolveTypedAssignee('ALICE@example.com', found, ['user'])).toEqual({ choice: { kind: 'user', id: ALICE, name: 'Alice Ng', email: 'alice@example.com' } })
    expect(resolveTypedAssignee('ali@example.com', found, ['user'])).toEqual({ error: 'No one in this workspace has the email ali@example.com' })
    expect(resolveTypedAssignee('alice@example.com', found, ['team'])).toEqual({ error: expect.stringMatching(/takes a team/) })
  })
  it('other text picks the only match of the kinds the step takes', () => {
    expect(resolveTypedAssignee('sal', { people: [], teams: found.teams }, ['user', 'team'])).toEqual({ choice: { kind: 'team', id: SALES, name: 'Sales', member_count: 3 } })
    expect(resolveTypedAssignee('sal', { people: [], teams: found.teams }, ['user'])).toEqual({ error: 'Nothing in this workspace matches “sal”' })
    expect(resolveTypedAssignee('ali', found, ['user'])).toEqual({ error: expect.stringMatching(/Several match/) })
  })

  it('labels say what the step takes', () => {
    expect(assigneeFieldLabel({ key: 'nodes.8.config.assignee_id', label: 'User for step “Qualify the lead”' }, ['user', 'team'])).toBe('Assignee for step “Qualify the lead”')
    expect(assigneeFieldLabel({ key: 'nodes.8.config.escalation_user_id', label: 'User for step “Qualify the lead”' }, ['user', 'team'])).toBe('Escalate step “Qualify the lead” to')
    expect(assigneeFieldLabel({ key: 'nodes.2.config.assignee_id', label: 'User for step “Reassign”' }, ['user'])).toBe('Person for step “Reassign”')
  })

  it('renders the search trigger with Me, a kept choice, and an inline error', () => {
    const me = { kind: 'user' as const, id: ALICE, name: 'Alice Ng', email: 'alice@example.com' }
    const empty = renderToStaticMarkup(createElement(AssigneePicker, { value: '', onPick: () => {}, accepts: ['user', 'team'], label: 'Assignee', me }))
    expect(empty).toContain('Choose a person or team…')
    expect(empty).toContain('data-assignee-me')
    expect(empty).toContain('aria-haspopup="listbox"')
    const peopleOnly = renderToStaticMarkup(createElement(AssigneePicker, { value: '', onPick: () => {}, accepts: ['user'], label: 'Person' }))
    expect(peopleOnly).toContain('Choose a person…')
    const kept = renderToStaticMarkup(createElement(AssigneePicker, { value: '', onPick: () => {}, accepts: ['user', 'team'], label: 'Assignee', kept: { kind: 'team', id: SALES, name: 'Sales' } }))
    expect(kept).toContain(`data-assignee-choice="team:${SALES}"`)
    expect(kept).toContain('Chosen earlier')
    const error = renderToStaticMarkup(createElement(AssigneePicker, { value: '', onPick: () => {}, accepts: ['user'], label: 'Person', serverError: 'No one in this workspace has the email x@y.z', testId: 'p' }))
    expect(error).toContain('role="alert"')
    expect(error).toContain('aria-invalid="true"')
  })
})
