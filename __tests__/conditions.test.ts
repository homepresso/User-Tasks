import { describe, expect, it } from 'vitest'

import { evaluateOperator, normalizeOperator, isKnownOperator } from '@/lib/conditions'

describe('evaluateOperator', () => {
  it('handles core operators with String-based equality', () => {
    expect(evaluateOperator('equals', 5, '5')).toBe(true) // string-coerced equality
    expect(evaluateOperator('not_equals', 'a', 'b')).toBe(true)
    expect(evaluateOperator('contains', 'hello world', 'world')).toBe(true)
    expect(evaluateOperator('not_contains', 'abc', 'z')).toBe(true)
    expect(evaluateOperator('gt', '10', 5)).toBe(true)
    expect(evaluateOperator('lte', 5, 5)).toBe(true)
    expect(evaluateOperator('starts_with', 'abcdef', 'abc')).toBe(true)
    expect(evaluateOperator('matches', 'a1b2', '\\d')).toBe(true)
    expect(evaluateOperator('in', 'b', 'a, b, c')).toBe(true)
  })

  it('handles empties and truthiness consistently', () => {
    expect(evaluateOperator('is_empty', '')).toBe(true)
    expect(evaluateOperator('is_empty', [])).toBe(true)
    expect(evaluateOperator('is_not_empty', 'x')).toBe(true)
    expect(evaluateOperator('is_true', 'yes')).toBe(true)
    expect(evaluateOperator('is_false', 'off')).toBe(true)
  })

  it('normalizes decision-table operator spellings to the canonical vocabulary', () => {
    expect(normalizeOperator('greater_than')).toBe('gt')
    expect(normalizeOperator('greater_than_or_equal')).toBe('gte')
    expect(normalizeOperator('less_than')).toBe('lt')
    // both spellings evaluate identically
    expect(evaluateOperator('greater_than', 10, 5)).toBe(evaluateOperator('gt', 10, 5))
    expect(evaluateOperator('less_than_or_equal', 5, 5)).toBe(true)
  })

  it('supports field-to-field comparisons via compareValue', () => {
    expect(evaluateOperator('equals_field', 'x', null, { compareValue: 'x' })).toBe(true)
    expect(evaluateOperator('gt_field', 10, null, { compareValue: 5 })).toBe(true)
  })

  it('detects change via previousValue', () => {
    expect(evaluateOperator('changed', 'new', undefined, { previousValue: 'old' })).toBe(true)
    expect(evaluateOperator('changed', 'same', undefined, { previousValue: 'same' })).toBe(false)
  })

  it('reports unknown operators', () => {
    expect(isKnownOperator('gt')).toBe(true)
    expect(isKnownOperator('greater_than')).toBe(true)
    expect(isKnownOperator('nonsense')).toBe(false)
    expect(evaluateOperator('nonsense', 1, 2)).toBe(false)
  })
})
