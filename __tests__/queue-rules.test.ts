import { describe, expect, it } from 'vitest'
import {
  MAX_QUEUE_RULES,
  decideAcceptance,
  evaluateQueueRules,
  normaliseQueueBehaviour,
  parseQueueRules,
  priorityLevel,
  resolveQueueRules,
  rulesFromBypassPriority,
  type LegacyQueueRules,
} from '@/lib/tasks/queue-rules'

const WF = '11111111-1111-4111-8111-111111111111'
const OTHER_WF = '22222222-2222-4222-8222-222222222222'
const BOSS = '33333333-3333-4333-8333-333333333333'

/** The engine's / createTask's old inline threshold, for parity checks. */
function legacy(priority: string, bypass: string | undefined): 'pending' | 'accepted' {
  const LEVELS: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 }
  const threshold = LEVELS[bypass ?? 'high'] ?? 3
  return (LEVELS[priority] ?? 2) >= threshold ? 'accepted' : 'pending'
}

describe('back-compat with queue_bypass_priority', () => {
  const priorities = ['critical', 'high', 'medium', 'low', 'none', 'weird', '']
  const bypasses = [undefined, 'critical', 'high', 'medium', 'low', 'none', 'nonsense']

  it('matches the old threshold for every priority × setting (workflow and manual)', () => {
    for (const bypass of bypasses) {
      const prefs = bypass === undefined ? {} : { queue_bypass_priority: bypass }
      for (const priority of priorities) {
        for (const source of ['workflow', 'manual'] as const) {
          expect(decideAcceptance({ preferences: prefs, facts: { priority, source } }), `${priority} / ${bypass}`).toBe(legacy(priority, bypass))
        }
      }
    }
  })

  it('defaults to high when nothing is stored (null / missing preferences)', () => {
    expect(resolveQueueRules(null)).toEqual(rulesFromBypassPriority('high'))
    expect(resolveQueueRules(undefined)).toEqual({ version: 2, default: 'queue', rules: [{ id: 'r1', enabled: true, match: 'all', conditions: [{ field: 'priority', op: 'at_least', value: 'high' }], then: 'add' }] })
    expect(decideAcceptance({ preferences: null, facts: { priority: 'high', source: 'workflow' } })).toBe('accepted')
    expect(decideAcceptance({ preferences: null, facts: { priority: 'medium', source: 'workflow' } })).toBe('pending')
  })

  it("'none' bypass adds everything; unknown task priorities count as medium", () => {
    expect(decideAcceptance({ preferences: { queue_bypass_priority: 'none' }, facts: { priority: 'none', source: 'manual' } })).toBe('accepted')
    expect(priorityLevel('bogus')).toBe(priorityLevel('medium'))
    expect(priorityLevel(null)).toBe(2)
  })

  it('falls back to the threshold when stored queue_rules are invalid', () => {
    const prefs = { queue_bypass_priority: 'critical', queue_rules: { default: 'maybe', rules: [] } }
    expect(resolveQueueRules(prefs)).toEqual(rulesFromBypassPriority('critical'))
    expect(decideAcceptance({ preferences: prefs, facts: { priority: 'high', source: 'manual' } })).toBe('pending')
  })

  it('stored queue_rules win over the legacy threshold', () => {
    const prefs = { queue_bypass_priority: 'none', queue_rules: { default: 'queue', rules: [] } }
    expect(decideAcceptance({ preferences: prefs, facts: { priority: 'critical', source: 'manual' } })).toBe('pending')
  })
})

describe('evaluateQueueRules', () => {
  const rules: LegacyQueueRules = {
    default: 'add',
    rules: [
      { when: { workflow_id: WF }, then: 'queue' },
      { when: { source: 'workflow', priority_at_least: 'high' }, then: 'add' },
      { when: { source: 'workflow' }, then: 'queue' },
      { when: { assigned_by_user_id: BOSS }, then: 'queue' },
    ],
  }

  it('first matching rule wins', () => {
    // Matches rule 1 even though rule 2 would add it.
    expect(evaluateQueueRules(rules, { source: 'workflow', workflow_id: WF, priority: 'critical' })).toBe('queue')
    expect(evaluateQueueRules(rules, { source: 'workflow', workflow_id: OTHER_WF, priority: 'critical' })).toBe('add')
    expect(evaluateQueueRules(rules, { source: 'workflow', workflow_id: OTHER_WF, priority: 'low' })).toBe('queue')
  })

  it('matches on the assigner and falls back to the default', () => {
    expect(evaluateQueueRules(rules, { source: 'manual', assigned_by_user_id: BOSS })).toBe('queue')
    expect(evaluateQueueRules(rules, { source: 'manual', assigned_by_user_id: WF })).toBe('add')
    expect(evaluateQueueRules(rules, { source: 'manual' })).toBe('add')
  })

  it('all conditions of a rule must hold; a rule with none matches everything', () => {
    const r: LegacyQueueRules = { default: 'queue', rules: [{ when: { source: 'manual', priority_at_least: 'critical' }, then: 'add' }] }
    expect(evaluateQueueRules(r, { source: 'manual', priority: 'high' })).toBe('queue')
    expect(evaluateQueueRules(r, { source: 'workflow', priority: 'critical' })).toBe('queue')
    expect(evaluateQueueRules(r, { source: 'manual', priority: 'critical' })).toBe('add')
    expect(evaluateQueueRules({ default: 'queue', rules: [{ when: {}, then: 'add' }] }, { source: 'manual' })).toBe('add')
  })

  it('a workflow_id rule does not match tasks without a workflow', () => {
    expect(evaluateQueueRules({ default: 'add', rules: [{ when: { workflow_id: WF }, then: 'queue' }] }, { source: 'manual', workflow_id: null })).toBe('add')
  })
})

describe('parseQueueRules', () => {
  it('drops empty condition fields (cleared pickers mean "any")', () => {
    const parsed = parseQueueRules({ default: 'queue', rules: [{ when: { source: '', workflow_id: null, priority_at_least: 'high' }, then: 'add' }] })
    expect(parsed).toEqual({ ok: true, value: { version: 2, default: 'queue', rules: [{ id: 'r1', enabled: true, match: 'all', conditions: [{ field: 'priority', op: 'at_least', value: 'high' }], then: 'add' }] } })
  })

  it(`rejects more than ${MAX_QUEUE_RULES} rules`, () => {
    const rules = Array.from({ length: MAX_QUEUE_RULES + 1 }, () => ({ when: {}, then: 'add' }))
    const parsed = parseQueueRules({ default: 'queue', rules })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(String(MAX_QUEUE_RULES))
    expect(parseQueueRules({ default: 'queue', rules: rules.slice(1) }).ok).toBe(true)
  })

  it('rejects unknown values, keys and non-uuid ids', () => {
    expect(parseQueueRules({ default: 'later', rules: [] }).ok).toBe(false)
    expect(parseQueueRules({ default: 'queue', rules: [{ when: { colour: 'red' }, then: 'add' }] }).ok).toBe(false)
    expect(parseQueueRules({ default: 'queue', rules: [{ when: { workflow_id: 'abc' }, then: 'add' }] }).ok).toBe(false)
    expect(parseQueueRules({ default: 'queue', rules: [{ when: {}, then: 'skip' }] }).ok).toBe(false)
    expect(parseQueueRules(null).ok).toBe(false)
    expect(parseQueueRules({ default: 'queue' }).ok).toBe(false)
  })
})

describe('node override (queue_behaviour)', () => {
  const addAll = { queue_rules: { default: 'add', rules: [] } }
  const queueAll = { queue_rules: { default: 'queue', rules: [] } }

  it('takes precedence over the assignee\'s rules', () => {
    expect(decideAcceptance({ preferences: addAll, facts: { source: 'workflow' }, override: 'queue' })).toBe('pending')
    expect(decideAcceptance({ preferences: queueAll, facts: { source: 'workflow' }, override: 'add' })).toBe('accepted')
  })

  it("'rules', absent or unknown values follow the rules", () => {
    for (const override of ['rules', undefined, null, '', 'sometimes']) {
      expect(decideAcceptance({ preferences: addAll, facts: { source: 'workflow' }, override })).toBe('accepted')
      expect(decideAcceptance({ preferences: queueAll, facts: { source: 'workflow' }, override })).toBe('pending')
    }
    expect(normaliseQueueBehaviour('add')).toBe('add')
    expect(normaliseQueueBehaviour(undefined)).toBe('rules')
  })
})
