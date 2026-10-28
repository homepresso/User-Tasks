import { describe, it, expect } from 'vitest'
import { evaluateDecisionCondition, evaluateDecisionTable } from '@/lib/decision-table-engine'

describe('decision table engine', () => {
  it('evaluates equality conditions', () => {
    expect(evaluateDecisionCondition(
      { id: 'c1', inputKey: 'country', operator: 'equals', value: 'AU' },
      { id: 'f1', key: 'country', label: 'Country', type: 'text' },
      { country: 'AU' },
    )).toBe(true)
  })

  it('evaluates numeric comparison conditions', () => {
    expect(evaluateDecisionCondition(
      { id: 'c1', inputKey: 'amount', operator: 'greater_than', value: '1000' },
      { id: 'f1', key: 'amount', label: 'Amount', type: 'number' },
      { amount: 1500 },
    )).toBe(true)
  })

  it('evaluates numeric comparisons even when the field is configured as text', () => {
    expect(evaluateDecisionCondition(
      { id: 'c1', inputKey: 'amount', operator: 'less_than', value: '1000' },
      { id: 'f1', key: 'amount', label: 'Amount', type: 'text' },
      { amount: '5' },
    )).toBe(true)
  })

  it('evaluates date comparisons for date-like text values', () => {
    expect(evaluateDecisionCondition(
      { id: 'c1', inputKey: 'due_date', operator: 'less_than', value: '2026-05-01' },
      { id: 'f1', key: 'due_date', label: 'Due Date', type: 'text' },
      { due_date: '2026-04-11' },
    )).toBe(true)
  })

  it('returns the first matching enabled rule', () => {
    const result = evaluateDecisionTable(
      [
        { id: 'f1', key: 'amount', label: 'Amount', type: 'number' },
        { id: 'f2', key: 'department', label: 'Department', type: 'text' },
      ],
      [
        {
          id: 'r1',
          label: 'Large finance approval',
          enabled: true,
          conditions: [
            { id: 'c1', inputKey: 'amount', operator: 'greater_than', value: '1000' },
            { id: 'c2', inputKey: 'department', operator: 'equals', value: 'Finance' },
          ],
          outputs: { approver: 'CFO', priority: 'high' },
        },
      ],
      { amount: 2000, department: 'Finance' },
    )

    expect(result.matched).toBe(true)
    expect(result.rule?.id).toBe('r1')
    expect(result.outputs).toEqual({ approver: 'CFO', priority: 'high' })
  })

  it('returns unmatched when no rule matches', () => {
    const result = evaluateDecisionTable(
      [{ id: 'f1', key: 'country', label: 'Country', type: 'text' }],
      [{ id: 'r1', label: 'US only', enabled: true, conditions: [{ id: 'c1', inputKey: 'country', operator: 'equals', value: 'US' }], outputs: { route: 'domestic' } }],
      { country: 'AU' },
    )

    expect(result.matched).toBe(false)
    expect(result.rule).toBeNull()
    expect(result.outputs).toEqual({})
  })
})

describe('decision table catch-all rules', () => {
  const inputs = [{ id: 'f1', key: 'amount', label: 'Amount', type: 'number' as const }]
  const big = { id: 'r1', label: 'Big', conditions: [{ id: 'c1', inputKey: 'amount', operator: 'greater_than', value: '1000' }], outputs: { approver: 'CFO' } }
  const fallback = { id: 'r2', label: 'Default', conditions: [], outputs: { approver: 'Manager' } }

  it('a rule with no conditions matches anything', () => {
    const result = evaluateDecisionTable(inputs, [big, fallback], { amount: 10 })
    expect(result.matched).toBe(true)
    expect(result.rule?.id).toBe('r2')
    expect(result.outputs).toEqual({ approver: 'Manager' })
  })

  it('first-match order is kept: an earlier specific rule still wins', () => {
    expect(evaluateDecisionTable(inputs, [big, fallback], { amount: 5000 }).rule?.id).toBe('r1')
  })

  it('a catch-all placed first shadows later rules (first hit wins)', () => {
    expect(evaluateDecisionTable(inputs, [fallback, big], { amount: 5000 }).rule?.id).toBe('r2')
  })

  it('a disabled catch-all is skipped', () => {
    expect(evaluateDecisionTable(inputs, [big, { ...fallback, enabled: false }], { amount: 10 }).matched).toBe(false)
  })

  it('blank condition rows (no input chosen, as the editor adds them) are ignored', () => {
    const blank = { ...fallback, conditions: [{ id: 'c', inputKey: '', operator: 'equals', value: '' }] }
    expect(evaluateDecisionTable(inputs, [big, blank], { amount: 10 }).rule?.id).toBe('r2')
    const mixed = { ...big, conditions: [...big.conditions, { id: 'c', inputKey: '  ', operator: 'equals', value: '' }] }
    expect(evaluateDecisionTable(inputs, [mixed], { amount: 5000 }).rule?.id).toBe('r1')
  })

  it('a missing conditions array is a catch-all too', () => {
    expect(evaluateDecisionTable(inputs, [{ id: 'r3', label: 'Any', outputs: { x: 1 } } as any], {}).matched).toBe(true)
  })
})
