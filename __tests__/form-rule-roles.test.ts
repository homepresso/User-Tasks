/**
 * Roles and teams in form rules: `user.roles` / `user.teams` (role / team
 * names, slugs and ids — lib/services/form-rule-user.ts) read with the
 * existing operators — `contains` = has the role, `does not equal` = has
 * not. The browser's scope gets them from forms.ruleUser; the server judges
 * Always / Validate rules, rule claims and read-only writes with its OWN view
 * of the submitter (never anything the browser sent). Anonymous visitors
 * have empty roles.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { ruleClaimGate, ruleConditionsMet, ruleValidationErrors, ruleWrittenReadOnlyValues, serverVerifiable, alwaysRuleEffects } from '@/lib/forms/form-rules'
import { ANONYMOUS_RULE_USER, loadRuleUser } from '@/lib/services/form-rule-user'
import { mergeTaskFieldValuesChecked, readsRuleUser } from '@/lib/forms/task-values'
import { reads } from '@/lib/services/ui-reads/forms'

const TENANT = 't-1'

/** A tiny query builder over fixed tables (eq filters; embedded role / team objects as the select would return them). */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v))
      const builder: any = {
        select: () => builder,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return builder },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null }),
      }
      return builder
    },
  }
}

const DB = fakeDb({
  users: [{ id: 'u-1', email: 'ada@example.com', display_name: 'Ada' }, { id: 'u-2', email: 'bob@example.com', display_name: 'Bob' }],
  user_roles: [
    { tenant_id: TENANT, user_id: 'u-1', role_id: 'r-mgr', role: { id: 'r-mgr', name: 'Manager', slug: 'manager' } },
    { tenant_id: 'other', user_id: 'u-1', role_id: 'r-x', role: { id: 'r-x', name: 'Elsewhere', slug: 'elsewhere' } },
  ],
  user_teams: [
    { user_id: 'u-1', team_id: 'tm-fin', team: { id: 'tm-fin', name: 'Finance', tenant_id: TENANT } },
    { user_id: 'u-1', team_id: 'tm-o', team: { id: 'tm-o', name: 'Other workspace', tenant_id: 'other' } },
  ],
})

const has = (path: string, value: string) => ({ match: 'all' as const, conditions: [{ column: path, operator: 'contains' as const, value }] })
const hasNot = (path: string, value: string) => ({ match: 'all' as const, conditions: [{ column: path, operator: 'neq' as const, value }] })

describe('the rule user: roles and teams', () => {
  it('loads names, slugs and ids of this workspace only', async () => {
    const user = await loadRuleUser(DB, TENANT, 'u-1')
    expect(user).toEqual({ id: 'u-1', email: 'ada@example.com', name: 'Ada', roles: ['Manager', 'manager', 'r-mgr'], teams: ['Finance', 'tm-fin'] })
    expect(await loadRuleUser(DB, TENANT, 'u-2')).toMatchObject({ id: 'u-2', roles: [], teams: [] })
    // Nobody signed in: empty roles / teams.
    expect(await loadRuleUser(DB, TENANT, null)).toEqual(ANONYMOUS_RULE_USER)
  })

  it('forms.ruleUser gives the browser the same shape (null when no one is signed in)', async () => {
    const ctx = { db: DB, supabase: DB, tenantId: TENANT, actorId: 'u-1', permissions: null, authKind: 'session' } as any
    expect(await (reads['forms.ruleUser'] as any).run(ctx, undefined)).toMatchObject({ roles: ['Manager', 'manager', 'r-mgr'], teams: ['Finance', 'tm-fin'] })
    expect(await (reads['forms.ruleUser'] as any).run({ ...ctx, actorId: null }, undefined)).toBeNull()
  })

  it('conditions: contains = has the role / team (name, slug or id, any case); does not equal = has not', () => {
    const user = { roles: ['Manager', 'manager', 'r-mgr'], teams: ['Finance', 'tm-fin'] }
    const scope = { values: {}, user }
    expect(ruleConditionsMet(has('user.roles', 'Manager'), scope)).toBe(true)
    expect(ruleConditionsMet(has('user.roles', 'MANAGER'), scope)).toBe(true)
    expect(ruleConditionsMet(has('user.roles', 'r-mgr'), scope)).toBe(true)
    expect(ruleConditionsMet(has('user.roles', 'Admin'), scope)).toBe(false)
    expect(ruleConditionsMet(hasNot('user.roles', 'Admin'), scope)).toBe(true)
    expect(ruleConditionsMet(hasNot('user.roles', 'manager'), scope)).toBe(false)
    expect(ruleConditionsMet(has('user.teams', 'finance'), scope)).toBe(true)
    // A role named in a form field: {{form.approver_role}}.
    expect(ruleConditionsMet(has('user.roles', '{{form.approver_role}}'), { values: { approver_role: 'Manager' }, user })).toBe(true)
    // Anonymous / not loaded: never "has", always "has not".
    for (const u of [null, ANONYMOUS_RULE_USER]) {
      expect(ruleConditionsMet(has('user.roles', 'Manager'), { values: {}, user: u as any })).toBe(false)
      expect(ruleConditionsMet(hasNot('user.roles', 'Manager'), { values: {}, user: u as any })).toBe(true)
      expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'user.roles', operator: 'is_not_set' }] }, { values: {}, user: u as any })).toBe(true)
    }
  })
})

const LAYOUT = {
  rows: [{ columns: 1, cells: [{ field_key: 'amount', span: 1 }] }, { columns: 1, cells: [{ field_key: 'approval', span: 1 }] }, { columns: 1, cells: [{ field_key: 'note', span: 1 }] }],
  rules: [
    // Only managers see (and must fill) the approval field.
    { id: 'show_approval', event: 'always', if: has('user.roles', 'Manager'), then: [{ type: 'show_hide', mode: 'show', targets: ['field:approval'] }] },
    // Over $10,000 needs the Finance team.
    { id: 'big', event: 'before_submit', if: { match: 'all', conditions: [{ column: 'amount', operator: 'gt', value: '10000' }, { column: 'user.teams', operator: 'neq', value: 'Finance' }] }, then: [{ type: 'field_error', field: 'amount', text: 'Amounts over $10,000 need someone in Finance' }] },
    // A manager's note is filled in by a rule (read-only field).
    { id: 'note', event: 'form_load', if: has('user.roles', 'Manager'), then: [{ type: 'set_values', assign: { note: 'Approved by {{user.name}}' } }] },
  ],
}
const FIELDS = [
  { key: 'amount', label: 'Amount (USD)', type: 'number', required: true },
  { key: 'approval', label: 'Approval', type: 'choice', options: ['Approve', 'Reject'], required: true },
  { key: 'note', label: 'Note', type: 'text', read_only: true },
]

describe('server checks use the server\'s own user', () => {
  it('rules reading the user are judged only when the server knows the user', () => {
    const rule = { event: 'before_submit' as const, if: has('user.roles', 'Manager') }
    expect(serverVerifiable(rule)).toBe(false)
    expect(serverVerifiable(rule, true)).toBe(true)
    const staff = { roles: ['Staff'], teams: [] }
    expect(ruleValidationErrors(LAYOUT, { amount: 20000 }, { user: staff })).toEqual({ amount: 'Amounts over $10,000 need someone in Finance' })
    expect(ruleValidationErrors(LAYOUT, { amount: 20000 }, { user: { roles: [], teams: ['Finance'] } })).toEqual({})
    // Without a user (an unknown caller) the rule is not judged.
    expect(ruleValidationErrors(LAYOUT, { amount: 20000 })).toEqual({})
    expect(alwaysRuleEffects(LAYOUT, {}, { user: staff }).hidden.has('field:approval')).toBe(true)
    expect(alwaysRuleEffects(LAYOUT, {}, { user: { roles: ['Manager'] } }).hidden.has('field:approval')).toBe(false)
  })

  it('claims and read-only writes from a role-gated rule are checked against the server user', () => {
    const gate = ruleClaimGate({}, null, { roles: ['Staff'] })
    expect(gate(LAYOUT.rules[2])).toBe(false)
    expect(ruleClaimGate({}, null, { roles: ['Manager'] })(LAYOUT.rules[2])).toBe(true)
    // Unknown user: trusted like a click (as before).
    expect(ruleClaimGate({})(LAYOUT.rules[2])).toBe(true)
    const sent = { note: 'Approved by Ada' }
    expect(ruleWrittenReadOnlyValues(LAYOUT, ['note'], sent, {}, null, { roles: ['Staff'], name: 'Ada' })).toEqual({})
    expect(ruleWrittenReadOnlyValues(LAYOUT, ['note'], sent, {}, null, { roles: ['Manager'], name: 'Ada' })).toEqual(sent)
    // A manager, but the browser forged another name: refused (the server computes the value itself).
    expect(ruleWrittenReadOnlyValues(LAYOUT, ['note'], { note: 'Approved by Eve' }, {}, null, { roles: ['Manager'], name: 'Ada' })).toEqual({})
  })

  it('mergeTaskFieldValuesChecked loads the submitter itself — a forged user / roles in the values changes nothing', async () => {
    const meta = { fields: FIELDS, form_layout: LAYOUT }
    expect(readsRuleUser(meta)).toBe(true)
    const forged = { amount: 20000, approval: 'Approve', user: { roles: ['Manager'], teams: ['Finance'] } }
    // u-2 has no roles / teams: approval is hidden (not required) and the Finance check blocks.
    const bob = await mergeTaskFieldValuesChecked(DB as any, TENANT, meta, forged, { actorId: 'u-2' })
    expect(bob.errors).toEqual({ amount: 'Amounts over $10,000 need someone in Finance' })
    // u-1 (Manager, Finance): approval shows and is required; the amount passes.
    const ada = await mergeTaskFieldValuesChecked(DB as any, TENANT, meta, { amount: 20000 }, { actorId: 'u-1' })
    expect(ada.errors).toEqual({ approval: 'Approval is required' })
    const adaOk = await mergeTaskFieldValuesChecked(DB as any, TENANT, meta, { amount: 20000, approval: 'Approve', note: 'Approved by Ada' }, { actorId: 'u-1' })
    expect(adaOk.errors).toEqual({})
    expect(adaOk.templateValues.note).toBe('Approved by Ada')
  })

  it('anonymous visitors (public links) are judged with empty roles', async () => {
    const meta = { fields: FIELDS, form_layout: LAYOUT }
    const anon = await mergeTaskFieldValuesChecked(DB as any, TENANT, meta, { amount: 20000, user: { roles: ['Manager'], teams: ['Finance'] } }, { ctx: { authKind: 'anonymous', actorId: null, tenantId: TENANT } as any })
    expect(anon.errors).toEqual({ amount: 'Amounts over $10,000 need someone in Finance' })
  })
})
