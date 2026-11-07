import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  MAX_QUEUE_RULES, MAX_RULE_CONDITIONS, conditionMatches, decideAcceptance, describeRuleSet, evaluateQueueRules, explainQueueRules,
  migrateLegacyRules, parseQueueRules, queueFactsFromTask, queueRulesOrgNeeds, resolveQueueRules,
  type QueueCondition, type QueueOrgContext, type QueueRule, type QueueRules, type QueueTaskFacts,
} from '@/lib/tasks/queue-rules'
import { decideAcceptanceForAssignees, loadQueueOrgContexts } from '@/lib/tasks/queue-rules-server'
import { QueueRulesDialogBody, sampleFacts } from '@/components/tasks/queue-rules-dialog'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Queue rules version 2 (lib/tasks/queue-rules.ts): every condition type,
 * all / any, disabled rules, ordering, version 1 back-compat, validation,
 * the org context (one load per batch) and the Queue rules dialog.
 */

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = U(1), BOSS = U(2), BIG_BOSS = U(3), REPORT = U(4), GRAND_REPORT = U(5), PEER = U(6)
const WF = U(10), FORM = U(11), TEAM = U(12), UNIT = U(13), PARENT_UNIT = U(14), PROJECT = U(15), OTHER = U(99)
const NOW = Date.parse('2026-11-04T10:00:00Z') // a Wednesday, 10:00 UTC

const facts = (over: Partial<QueueTaskFacts> = {}): QueueTaskFacts => ({
  priority: 'medium', source: 'manual', workflow_id: null, assigned_by_user_id: PEER, origins: ['manual'], form_id: null, assignment: 'individual',
  assigned_team_id: null, due_date: null, title: 'Approve invoice 42', description: 'Supplier: ACME', has_attachments: false, is_subtask: false, tags: ['finance'], now: NOW, ...over,
})
const org: QueueOrgContext = {
  managerChain: [BOSS, BIG_BOSS], directReports: new Set([REPORT]), allReports: new Set([REPORT, GRAND_REPORT]),
  assignerTeams: new Set([TEAM]), assignerUnits: new Set([UNIT, PARENT_UNIT]), assignerProjects: new Set([PROJECT]),
}
const m = (cond: QueueCondition, f: Partial<QueueTaskFacts> = {}, withOrg = true, ruleSet?: Pick<QueueRules, 'working_hours'>) =>
  conditionMatches(cond, facts(f), { assigneeId: ME, org: withOrg ? org : null, timeZone: 'UTC' }, ruleSet)
const rule = (conditions: QueueCondition[], then: 'queue' | 'add' = 'add', over: Partial<QueueRule> = {}): QueueRule => ({ id: `r${Math.random().toString(36).slice(2, 8)}`, enabled: true, match: 'all', conditions, then, ...over })
const set = (rules: QueueRule[], def: 'queue' | 'add' = 'queue', extra: Partial<QueueRules> = {}): QueueRules => ({ version: 2, default: def, rules, ...extra })

describe('who it is from', () => {
  it('assigned by specific people (is / is not / in / not in)', () => {
    expect(m({ field: 'assigned_by', op: 'is', value: PEER })).toBe(true)
    expect(m({ field: 'assigned_by', op: 'is_not', value: PEER })).toBe(false)
    expect(m({ field: 'assigned_by', op: 'in', value: [OTHER, PEER] })).toBe(true)
    expect(m({ field: 'assigned_by', op: 'not_in', value: [OTHER] })).toBe(true)
    expect(m({ field: 'assigned_by', op: 'is', value: PEER }, { assigned_by_user_id: null })).toBe(false)
  })

  it('relationships: myself, my manager, manager chain, direct / any report, no person', () => {
    const rel = (value: string, by: string | null, op: 'is' | 'is_not' = 'is', withOrg = true) => m({ field: 'assigned_by_relation', op, value }, { assigned_by_user_id: by }, withOrg)
    expect(rel('self', ME)).toBe(true)
    expect(rel('manager', BOSS)).toBe(true)
    expect(rel('manager', BIG_BOSS)).toBe(false)
    expect(rel('manager_chain', BIG_BOSS)).toBe(true)
    expect(rel('direct_report', REPORT)).toBe(true)
    expect(rel('direct_report', GRAND_REPORT)).toBe(false)
    expect(rel('any_report', GRAND_REPORT)).toBe(true)
    expect(rel('automation', null)).toBe(true)
    expect(rel('automation', PEER)).toBe(false)
    expect(rel('manager', PEER, 'is_not')).toBe(true)
    // Without org data, org relations never match (either operator); self / automation still do.
    expect(rel('manager', BOSS, 'is', false)).toBe(false)
    expect(rel('manager', PEER, 'is_not', false)).toBe(false)
    expect(rel('self', ME, 'is', false)).toBe(true)
  })

  it('members of a team / org unit (including units above) / project', () => {
    expect(m({ field: 'assigned_by_team', op: 'in', value: [TEAM] })).toBe(true)
    expect(m({ field: 'assigned_by_team', op: 'not_in', value: [TEAM] })).toBe(false)
    expect(m({ field: 'assigned_by_org_unit', op: 'in', value: [PARENT_UNIT] })).toBe(true)
    expect(m({ field: 'assigned_by_project', op: 'in', value: [PROJECT] })).toBe(true)
    expect(m({ field: 'assigned_by_project', op: 'in', value: [OTHER] })).toBe(false)
    expect(m({ field: 'assigned_by_team', op: 'in', value: [TEAM] }, {}, false)).toBe(false)
    expect(m({ field: 'assigned_by_team', op: 'not_in', value: [OTHER] }, {}, false)).toBe(false)
    // No person assigned it: no team.
    expect(m({ field: 'assigned_by_team', op: 'in', value: [TEAM] }, { assigned_by_user_id: null })).toBe(false)
  })
})

describe('where it came from', () => {
  it('source covers source and origin tags', () => {
    expect(m({ field: 'source', op: 'is', value: 'manual' })).toBe(true)
    expect(m({ field: 'source', op: 'is', value: 'redirect' }, { origins: ['redirect'] })).toBe(true)
    expect(m({ field: 'source', op: 'in', value: ['mcp', 'agent'] }, { origins: ['agent', 'escalation'] })).toBe(true)
    expect(m({ field: 'source', op: 'not_in', value: ['workflow'] })).toBe(true)
    expect(m({ field: 'source', op: 'is', value: 'workflow' }, { source: 'workflow', origins: undefined })).toBe(true)
  })
  it('workflow, form, team assignment and how it reached me', () => {
    expect(m({ field: 'workflow', op: 'is', value: WF }, { workflow_id: WF })).toBe(true)
    expect(m({ field: 'workflow', op: 'is_not', value: WF }, { workflow_id: null })).toBe(true)
    expect(m({ field: 'form', op: 'in', value: [FORM] }, { form_id: FORM })).toBe(true)
    expect(m({ field: 'form', op: 'is', value: FORM }, { form_id: undefined })).toBe(false) // unknown never matches
    expect(m({ field: 'form', op: 'is_not', value: FORM }, { form_id: undefined })).toBe(false)
    expect(m({ field: 'assigned_team', op: 'in', value: [TEAM] }, { assigned_team_id: TEAM })).toBe(true)
    expect(m({ field: 'assignment', op: 'is', value: 'aad_group' }, { assignment: 'aad_group' })).toBe(true)
    expect(m({ field: 'assignment', op: 'not_in', value: ['team', 'aad_group'] })).toBe(true)
  })
})

describe('what it is', () => {
  it('priority: at least / at most / is / in', () => {
    expect(m({ field: 'priority', op: 'at_least', value: 'high' }, { priority: 'critical' })).toBe(true)
    expect(m({ field: 'priority', op: 'at_most', value: 'low' }, { priority: 'medium' })).toBe(false)
    expect(m({ field: 'priority', op: 'is', value: 'medium' }, { priority: 'weird' })).toBe(true) // unknown = medium
    expect(m({ field: 'priority', op: 'not_in', value: ['low', 'none'] })).toBe(true)
  })
  it('due: within / later than / overdue / set / not set', () => {
    const in2h = new Date(NOW + 2 * 3_600_000).toISOString()
    const in3d = new Date(NOW + 3 * 86_400_000).toISOString()
    expect(m({ field: 'due', op: 'within', value: { amount: 1, unit: 'days' } }, { due_date: in2h })).toBe(true)
    expect(m({ field: 'due', op: 'within', value: { amount: 1, unit: 'days' } }, { due_date: in3d })).toBe(false)
    expect(m({ field: 'due', op: 'not_within', value: { amount: 1, unit: 'days' } }, { due_date: in3d })).toBe(true)
    expect(m({ field: 'due', op: 'overdue' }, { due_date: new Date(NOW - 1000).toISOString() })).toBe(true)
    expect(m({ field: 'due', op: 'not_set' }, { due_date: null })).toBe(true)
    expect(m({ field: 'due', op: 'set' }, { due_date: in2h })).toBe(true)
    expect(m({ field: 'due', op: 'within', value: { amount: 1, unit: 'days' } }, { due_date: null })).toBe(false)
  })
  it('title / text: contains any keyword, contains none, matches a safe pattern', () => {
    expect(m({ field: 'title', op: 'contains', value: ['INVOICE', 'refund'] })).toBe(true)
    expect(m({ field: 'title', op: 'not_contains', value: ['refund'] })).toBe(true)
    expect(m({ field: 'title', op: 'contains', value: ['acme'] })).toBe(false)
    expect(m({ field: 'text', op: 'contains', value: ['acme'] })).toBe(true)
    expect(m({ field: 'title', op: 'matches', value: 'invoice \\d+$' })).toBe(true)
  })
  it('attachments, subtask, tags', () => {
    expect(m({ field: 'has_attachments', op: 'is', value: true }, { has_attachments: true })).toBe(true)
    expect(m({ field: 'has_attachments', op: 'is', value: false }, { has_attachments: undefined })).toBe(false)
    expect(m({ field: 'is_subtask', op: 'is', value: true }, { is_subtask: true })).toBe(true)
    expect(m({ field: 'tags', op: 'contains_any', value: ['Finance', 'hr'] })).toBe(true)
    expect(m({ field: 'tags', op: 'contains_all', value: ['finance', 'hr'] })).toBe(false)
    expect(m({ field: 'tags', op: 'contains_none', value: ['hr'] })).toBe(true)
  })
})

describe('when it arrives', () => {
  it('day of week and working hours in the person\'s time zone', () => {
    expect(m({ field: 'day_of_week', op: 'in', value: [3] })).toBe(true) // Wednesday UTC
    expect(m({ field: 'day_of_week', op: 'not_in', value: [0, 6] })).toBe(true)
    expect(m({ field: 'working_hours', op: 'inside' })).toBe(true) // 10:00 Wed, default 09–17 Mon–Fri
    // 10:00 UTC is 23:00 in Auckland (NZDT, UTC+13): outside.
    expect(m({ field: 'working_hours', op: 'outside' }, {}, true, { working_hours: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', time_zone: 'Pacific/Auckland' } })).toBe(true)
    // Overnight shift 22:00–06:00.
    expect(m({ field: 'working_hours', op: 'inside' }, { now: Date.parse('2026-11-04T23:30:00Z') }, true, { working_hours: { days: [3], start: '22:00', end: '06:00' } })).toBe(true)
  })
})

describe('rules: all / any, disabled, ordering', () => {
  const manager: QueueCondition = { field: 'assigned_by_relation', op: 'is', value: 'manager' }
  const critical: QueueCondition = { field: 'priority', op: 'at_least', value: 'critical' }
  it('all needs every condition; any needs one', () => {
    const ctx = { assigneeId: ME, org }
    expect(evaluateQueueRules(set([rule([manager, critical])]), facts({ assigned_by_user_id: BOSS }), ctx)).toBe('queue')
    expect(evaluateQueueRules(set([rule([manager, critical], 'add', { match: 'any' })]), facts({ assigned_by_user_id: BOSS }), ctx)).toBe('add')
  })
  it('disabled rules are skipped; first match wins; no conditions = every task', () => {
    const rules = set([
      rule([critical], 'add', { enabled: false, name: 'off' }),
      rule([{ field: 'source', op: 'is', value: 'manual' }], 'queue', { name: 'manual' }),
      rule([], 'add', { name: 'catch all' }),
    ], 'add')
    const r = explainQueueRules(rules, facts({ priority: 'critical' }))
    expect(r).toMatchObject({ decision: 'queue', ruleIndex: 1 })
    expect(explainQueueRules(rules, facts({ source: 'workflow', origins: [] }))).toMatchObject({ decision: 'add', ruleIndex: 2 })
    expect(explainQueueRules(set([], 'add'), facts())).toEqual({ decision: 'add', ruleIndex: null, rule: null })
  })
  it('decideAcceptance passes the context through; the node override still wins', () => {
    const prefs = { queue_rules: set([rule([manager], 'add')]) }
    expect(decideAcceptance({ preferences: prefs, facts: facts({ assigned_by_user_id: BOSS }), context: { assigneeId: ME, org } })).toBe('accepted')
    expect(decideAcceptance({ preferences: prefs, facts: facts({ assigned_by_user_id: BOSS }), context: { assigneeId: ME, org }, override: 'queue' })).toBe('pending')
  })
})

describe('validation and back-compat', () => {
  it('version 1 rules and the bypass threshold migrate on read with the same behaviour', () => {
    const v1 = { default: 'add' as const, rules: [{ when: { workflow_id: WF, priority_at_least: 'high' as const }, then: 'queue' as const }] }
    const v2 = migrateLegacyRules(v1)
    expect(v2.rules[0].conditions).toEqual([{ field: 'priority', op: 'at_least', value: 'high' }, { field: 'workflow', op: 'is', value: WF }])
    for (const p of ['critical', 'high', 'medium']) {
      for (const wf of [WF, OTHER, null]) {
        const f = facts({ priority: p, workflow_id: wf, source: 'workflow' })
        expect(evaluateQueueRules(v2, f)).toBe(evaluateQueueRules(v1, f))
      }
    }
    expect(resolveQueueRules({ queue_rules: v1 })).toEqual(v2)
    expect(resolveQueueRules({ queue_bypass_priority: 'critical' }).rules[0].conditions).toEqual([{ field: 'priority', op: 'at_least', value: 'critical' }])
  })

  it('accepts a full version 2 rule set, drops values operators don\'t take', () => {
    const parsed = parseQueueRules(set([rule([{ field: 'due', op: 'overdue', value: 'junk' }, { field: 'title', op: 'matches', value: '^PO-\\d+' }], 'add', { id: 'a', name: '  ' })], 'queue', { working_hours: { days: [1, 2], start: '08:30', end: '16:00', time_zone: 'Europe/London' } }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.rules[0].conditions[0]).toEqual({ field: 'due', op: 'overdue' })
      expect(parsed.value.rules[0].name).toBeUndefined()
    }
  })

  it('rejects wrong operators, values, unsafe patterns, unknown zones, duplicate ids and too many rules / conditions', () => {
    const bad = (r: QueueRule, extra: Partial<QueueRules> = {}) => parseQueueRules(set([r], 'queue', extra))
    expect(bad(rule([{ field: 'priority', op: 'contains', value: 'x' }]))).toMatchObject({ ok: false, error: expect.stringMatching(/Rule 1/) })
    expect(bad(rule([{ field: 'workflow', op: 'is', value: 'not-a-uuid' }])).ok).toBe(false)
    expect(bad(rule([{ field: 'title', op: 'matches', value: '(a+)+$' }])).ok).toBe(false)
    expect(bad(rule([]), { working_hours: { days: [1], start: '09:00', end: '17:00', time_zone: 'Mars/Olympus' } }).ok).toBe(false)
    expect(parseQueueRules(set([rule([], 'add', { id: 'x' }), rule([], 'add', { id: 'x' })])).ok).toBe(false)
    expect(parseQueueRules(set(Array.from({ length: MAX_QUEUE_RULES + 1 }, (_, i) => rule([], 'add', { id: `r${i}` }))))).toMatchObject({ ok: false, error: expect.stringMatching(String(MAX_QUEUE_RULES)) })
    expect(bad(rule(Array.from({ length: MAX_RULE_CONDITIONS + 1 }, () => ({ field: 'due', op: 'set' }) as QueueCondition))).ok).toBe(false)
    expect(parseQueueRules({ version: 3, default: 'queue', rules: [] }).ok).toBe(false)
  })

  it('facts from an existing task (redirect / escalate / reassign paths)', () => {
    const f = queueFactsFromTask({ priority: 'high', is_workflow_task: true, workflow_id: WF, metadata: { form_ref: { form_id: FORM } }, assignment_type: 'team', assigned_team_id: TEAM, due_date: null, title: 'T', description: null, parent_task_id: 'p', tags: ['a'] }, { assignedBy: ME, origins: ['redirect'] })
    expect(f).toMatchObject({ source: 'workflow', origins: ['redirect', 'form'], form_id: FORM, assigned_team_id: TEAM, is_subtask: true, has_attachments: undefined, tags: ['a'] })
  })
})

describe('org context (server)', () => {
  function fixture() {
    const db = createMemorySupabase({
      user_memberships: [
        { tenant_id: 't1', user_id: ME, manager_user_id: BOSS, is_active: true },
        { tenant_id: 't1', user_id: BOSS, manager_user_id: BIG_BOSS, is_active: true },
        { tenant_id: 't1', user_id: REPORT, manager_user_id: ME, is_active: true },
        { tenant_id: 't1', user_id: GRAND_REPORT, manager_user_id: REPORT, is_active: true },
        { tenant_id: 't2', user_id: ME, manager_user_id: PEER, is_active: true },
      ],
      user_teams: [{ user_id: BOSS, team_id: TEAM }],
      org_unit_members: [{ tenant_id: 't1', user_id: BOSS, org_unit_id: UNIT }],
      org_units: [{ tenant_id: 't1', id: UNIT, parent_id: PARENT_UNIT }, { tenant_id: 't1', id: PARENT_UNIT, parent_id: null }],
      project_members: [],
      project_teams: [{ tenant_id: 't1', project_id: PROJECT, team_id: TEAM }],
      users: [
        { id: ME, timezone: 'UTC', preferences: { queue_rules: set([
          rule([{ field: 'assigned_by_relation', op: 'is', value: 'manager' }, { field: 'assigned_by_project', op: 'in', value: [PROJECT] }, { field: 'assigned_by_org_unit', op: 'in', value: [PARENT_UNIT] }], 'add'),
        ]) } },
        { id: PEER, timezone: null, preferences: null },
      ],
    })
    const reads: string[] = []
    const from = db.from.bind(db)
    ;(db as any).from = (table: string) => { reads.push(table); return from(table) }
    return { db, reads }
  }

  it('loads reporting lines, the assigner\'s teams, units (with parents) and projects (direct or via teams) once', async () => {
    const { db } = fixture()
    const ctxs = await loadQueueOrgContexts(db, { tenantId: 't1', assignerId: BOSS, assigneeIds: [ME], needs: { reporting: true, teams: true, units: true, projects: true } })
    const me = ctxs!.get(ME)!
    expect(me.managerChain).toEqual([BOSS, BIG_BOSS])
    expect([...me.directReports]).toEqual([REPORT])
    expect([...me.allReports].sort()).toEqual([GRAND_REPORT, REPORT].sort())
    expect([...me.assignerTeams]).toEqual([TEAM])
    expect([...me.assignerUnits].sort()).toEqual([PARENT_UNIT, UNIT].sort())
    expect([...me.assignerProjects]).toEqual([PROJECT])
    expect(await loadQueueOrgContexts(db, { tenantId: null, assignerId: BOSS, assigneeIds: [ME], needs: { reporting: true, teams: false, units: false, projects: false } })).toBeNull()
  })

  it('decides a batch with one profile read and org reads only when some rules need them', async () => {
    const { db, reads } = fixture()
    const decided = await decideAcceptanceForAssignees(db, { tenantId: 't1', assigneeIds: [ME, PEER], facts: facts({ assigned_by_user_id: BOSS }) })
    expect(decided.get(ME)).toBe('accepted') // manager + project (via team) + parent unit
    expect(decided.get(PEER)).toBe('pending') // legacy default: medium → queue
    expect(reads.filter((t) => t === 'users')).toHaveLength(1)
    expect(reads.filter((t) => t === 'user_memberships')).toHaveLength(1)

    // Nobody's rules need org data → no org reads at all.
    const plain = fixture()
    await decideAcceptanceForAssignees(plain.db, { tenantId: 't1', assigneeIds: [PEER], facts: facts() })
    expect(plain.reads).toEqual(['users'])
  })

  it('a different assigner (not my manager, in no team) does not match; missing workspace = no org match', async () => {
    const { db } = fixture()
    expect((await decideAcceptanceForAssignees(db, { tenantId: 't1', assigneeIds: [ME], facts: facts({ assigned_by_user_id: PEER }) })).get(ME)).toBe('pending')
    expect((await decideAcceptanceForAssignees(db, { tenantId: null, assigneeIds: [ME], facts: facts({ assigned_by_user_id: BOSS }) })).get(ME)).toBe('pending')
  })

  it('org needs come from enabled rules only', () => {
    expect(queueRulesOrgNeeds(set([rule([{ field: 'assigned_by_relation', op: 'is', value: 'self' }])]))).toEqual({ reporting: false, teams: false, units: false, projects: false })
    expect(queueRulesOrgNeeds(set([rule([{ field: 'assigned_by_team', op: 'in', value: [TEAM] }], 'add', { enabled: false })])).teams).toBe(false)
    expect(queueRulesOrgNeeds(set([rule([{ field: 'assigned_by_project', op: 'in', value: [PROJECT] }])]))).toMatchObject({ projects: true, teams: true })
  })
})

describe('the Queue rules dialog', () => {
  const options = { workflows: [{ id: WF, label: 'Invoice approval' }], forms: [], people: [{ id: BOSS, label: 'Priya Nair' }], teams: [{ id: TEAM, label: 'Finance' }], units: [], projects: [] }
  const render = (rules: QueueRules) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
    createElement(QueueRulesDialogBody, { rules, onChange: vi.fn(), options })))

  it('shows the summary, default, each rule with its conditions, and Test a task', () => {
    const html = render(set([
      rule([{ field: 'assigned_by_relation', op: 'is', value: 'manager' }, { field: 'workflow', op: 'in', value: [WF] }], 'add', { id: 'a', name: 'Boss work', match: 'any' }),
      rule([{ field: 'working_hours', op: 'outside' }], 'queue', { id: 'b', enabled: false }),
    ]))
    expect(html).toContain('data-queue-rules-summary')
    expect(html).toContain('except where your rule says otherwise') // one enabled rule
    expect(html).toContain('value="Boss work"')
    expect(html).toContain('data-queue-condition="assigned_by_relation"')
    expect(html).toContain('Invoice approval')
    expect(html).toContain('data-queue-working-hours') // a time condition shows the working hours
    expect(html).toContain('Test a task')
    expect(html).toContain('Duplicate Rule 1')
  })

  it('summary and sample facts', () => {
    expect(describeRuleSet(set([], 'add'))).toBe('New tasks go straight to your list.')
    const f = sampleFacts({ priority: 'high', origin: 'form', workflow_id: WF, form_id: '', assigned_by_user_id: BOSS, assignment: 'team', assigned_team_id: TEAM, due: '2h', title: 'x', has_attachments: true, is_subtask: false, tags: 'a, b', when: '' }, NOW)
    expect(f).toMatchObject({ source: 'workflow', origins: ['form'], workflow_id: WF, form_id: null, due_date: new Date(NOW + 2 * 3_600_000).toISOString(), tags: ['a', 'b'] })
  })
})
