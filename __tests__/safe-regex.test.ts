/**
 * ReDoS guard (lib/safe-regex.ts) and its use by the expression functions,
 * the condition `matches` operator and the Regex node.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_REGEX_INPUT_LENGTH,
  MAX_REGEX_PATTERN_LENGTH,
  UnsafeRegexError,
  compileUserRegex,
  findNestedQuantifier,
} from '@/lib/safe-regex'
import { evaluateFunction } from '@/lib/expression-functions'
import { evaluateOperator } from '@/lib/conditions'
import { handleRegex } from '@/lib/workflow-node-handlers'

const EVIL_INPUT = 'a'.repeat(40) + '!'

describe('findNestedQuantifier', () => {
  it.each([
    '(a+)+$',
    '(a*)*',
    '(\\d+)*x',
    '(a|b+){2,}',
    '(.*a){20}',
    '((ab)+c)+',
    '(?:\\w+\\s?)+$',
    '([a-z]+)*@',
  ])('rejects %s', (pattern) => {
    expect(findNestedQuantifier(pattern)).toMatch(/nested quantifier/)
  })

  it.each([
    '\\d+',
    '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$',
    '(\\d{3})+',
    '(ab?)+',
    '(a+)?',
    '(a+)b+',
    '[(a+)+]',
    '\\(a+\\)+',
    '(?<year>\\d{4})-(?<month>\\d{2})',
  ])('accepts %s', (pattern) => {
    expect(findNestedQuantifier(pattern)).toBeNull()
  })
})

describe('compileUserRegex', () => {
  it('compiles safe patterns with flags', () => {
    expect(compileUserRegex('a+', 'gi').flags).toBe('gi')
  })

  it('rejects over-long and nested-quantifier patterns with a clear error', () => {
    expect(() => compileUserRegex('a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1))).toThrow(UnsafeRegexError)
    expect(() => compileUserRegex('(a+)+$')).toThrow(/Regex rejected: nested quantifier/)
  })

  it('surfaces invalid patterns as the native SyntaxError', () => {
    expect(() => compileUserRegex('(')).toThrow(SyntaxError)
  })
})

describe('user regex call sites', () => {
  it('expression functions treat an unsafe pattern like an invalid one, without hanging', () => {
    const started = Date.now()
    expect(evaluateFunction(`REGEX_MATCH("${EVIL_INPUT}", "(a+)+$")`)).toBe(false)
    expect(evaluateFunction(`REGEX_EXTRACT("${EVIL_INPUT}", "(a+)+$")`)).toBe('')
    expect(evaluateFunction(`REGEX_REPLACE("${EVIL_INPUT}", "(a+)+$", "x")`)).toBe(EVIL_INPUT)
    expect(Date.now() - started).toBeLessThan(500)
    // Safe patterns behave as before.
    expect(evaluateFunction('REGEX_MATCH("abc123", "[0-9]+")')).toBe(true)
    expect(evaluateFunction('REGEX_EXTRACT("abc123", "[0-9]+")')).toBe('123')
  })

  it('expression functions reject an over-long input', () => {
    const scope = { big: 'a'.repeat(MAX_REGEX_INPUT_LENGTH + 1) }
    expect(evaluateFunction('REGEX_MATCH(big, "a")', scope)).toBe(false)
  })

  it('condition `matches` reads an unsafe pattern as no match', () => {
    expect(evaluateOperator('matches', EVIL_INPUT, '(a+)+$')).toBe(false)
    expect(evaluateOperator('matches', 'abc', '^a')).toBe(true)
  })

  it('the Regex node fails with a clear error', () => {
    const ctx = { variables: {} as Record<string, unknown> }
    expect(() => handleRegex({ input: EVIL_INPUT, pattern: '(a+)+$', operation: 'test' }, ctx)).toThrow(/Regex rejected/)
    expect(() => handleRegex({ input: 'x'.repeat(MAX_REGEX_INPUT_LENGTH + 1), pattern: 'x', operation: 'test' }, ctx)).toThrow(/input is/)
    expect(handleRegex({ input: 'abc123', pattern: '\\d+', operation: 'test' }, ctx).result).toBe(true)
  })
})
