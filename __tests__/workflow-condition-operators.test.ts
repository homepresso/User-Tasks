import { describe, it, expect } from 'vitest'
import { __testing } from '@/lib/workflow-engine'

const { evaluateRule } = __testing

const ctx = { variables: { weight_kg: 3.2, status: 'open', qty: 0 }, task: {} } as any

// Longhand operator spellings (greater_than, ">=", …) come from imported and
// hand-authored workflows; the engine must treat them as their canonical form
// instead of falling through to "no match".
describe('evaluateRule operator aliases', () => {
  it('greater_than behaves as gt', () => {
    expect(evaluateRule('{{weight_kg}}', 'greater_than', '2', ctx)).toBe(true)
    expect(evaluateRule('{{weight_kg}}', 'greater_than', '5', ctx)).toBe(false)
  })

  it('less_than / less_than_or_equal behave as lt / lte', () => {
    expect(evaluateRule('{{weight_kg}}', 'less_than', '5', ctx)).toBe(true)
    expect(evaluateRule('{{weight_kg}}', 'less_than_or_equal', '3.2', ctx)).toBe(true)
  })

  it('symbol spellings work', () => {
    expect(evaluateRule('{{weight_kg}}', '>', '2', ctx)).toBe(true)
    expect(evaluateRule('{{weight_kg}}', '>=', '3.2', ctx)).toBe(true)
    expect(evaluateRule('{{status}}', '==', 'open', ctx)).toBe(true)
    expect(evaluateRule('{{status}}', '!=', 'closed', ctx)).toBe(true)
  })

  it('canonical operators are unchanged', () => {
    expect(evaluateRule('{{weight_kg}}', 'gt', '2', ctx)).toBe(true)
    expect(evaluateRule('{{qty}}', 'lte', '0', ctx)).toBe(true)
  })

  it('bare identifier fields are promoted to variable lookups', () => {
    expect(evaluateRule('weight_kg', 'greater_than', '2', ctx)).toBe(true)
  })
})

// Every operator the Condition node UI offers (and the boolean / negation
// operators the shared vocabulary in lib/conditions.ts defines) must be
// evaluated — an unknown operator silently reads as "no match".
describe('evaluateRule — full operator coverage', () => {
  const vars = {
    variables: {
      flag_true: true, flag_false: false, flag_str_true: 'true', flag_str_false: 'false',
      flag_one: 1, flag_zero: 0, flag_str_one: '1', flag_str_zero: '0', flag_yes: 'yes', flag_empty: '',
      title: 'Invoice overdue', code: 'INV-0042', tags: ['a', 'b'], status: 'open',
    },
    task: {},
  } as any

  it('is_true accepts true / "true" / 1 / "1" / "yes"', () => {
    for (const name of ['flag_true', 'flag_str_true', 'flag_one', 'flag_str_one', 'flag_yes']) {
      expect(evaluateRule(`{{${name}}}`, 'is_true', '', vars), name).toBe(true)
      expect(evaluateRule(`{{${name}}}`, 'is_false', '', vars), name).toBe(false)
    }
  })

  it('is_false accepts false / "false" / 0 / "0" / "" / missing', () => {
    for (const name of ['flag_false', 'flag_str_false', 'flag_zero', 'flag_str_zero', 'flag_empty', 'missing_var']) {
      expect(evaluateRule(`{{${name}}}`, 'is_false', '', vars), name).toBe(true)
      expect(evaluateRule(`{{${name}}}`, 'is_true', '', vars), name).toBe(false)
    }
  })

  it('operator spelling is case-insensitive for the boolean operators', () => {
    expect(evaluateRule('{{flag_true}}', 'IS_TRUE', '', vars)).toBe(true)
  })

  it('not_contains is the negation of contains', () => {
    expect(evaluateRule('{{title}}', 'not_contains', 'paid', vars)).toBe(true)
    expect(evaluateRule('{{title}}', 'not_contains', 'overdue', vars)).toBe(false)
  })

  it('matches tests a regular expression', () => {
    expect(evaluateRule('{{code}}', 'matches', '^INV-\\d+$', vars)).toBe(true)
    expect(evaluateRule('{{code}}', 'matches', '^PO-', vars)).toBe(false)
  })

  it('every operator offered by the Condition node is evaluated', () => {
    // Options of the Condition node's operator <select> (node-config-panel.tsx)
    // plus the gallery-validator list; none may fall through to "no match"
    // for a case that should match.
    const cases: [string, string, string][] = [
      ['{{status}}', 'equals', 'open'],
      ['{{status}}', 'not_equals', 'closed'],
      ['{{title}}', 'contains', 'overdue'],
      ['{{title}}', 'not_contains', 'paid'],
      ['{{flag_one}}', 'gt', '0'],
      ['{{flag_zero}}', 'lt', '1'],
      ['{{flag_one}}', 'gte', '1'],
      ['{{flag_one}}', 'lte', '1'],
      ['{{flag_empty}}', 'is_empty', ''],
      ['{{status}}', 'is_not_empty', ''],
      ['{{flag_true}}', 'is_true', ''],
      ['{{flag_false}}', 'is_false', ''],
      ['{{title}}', 'starts_with', 'Invoice'],
      ['{{title}}', 'ends_with', 'overdue'],
      ['{{status}}', 'in', 'open, pending'],
      ['{{code}}', 'matches', 'INV'],
    ]
    for (const [field, op, value] of cases) expect(evaluateRule(field, op, value, vars), op).toBe(true)
  })
})
