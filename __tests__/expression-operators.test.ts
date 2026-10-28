import { describe, it, expect } from 'vitest'
import { resolveExpression } from '@/lib/expression-resolver'
import { evaluateFunction } from '@/lib/expression-functions'

/**
 * Operators inside {{= … }} — documented on /docs/workflows/expressions
 * ("Operators and truthiness"):
 * - `==` / `!=`: numeric when both sides are numbers (or numeric text),
 *   otherwise exact, case-sensitive text comparison
 * - `> < >= <=`: numeric when both sides are numeric, otherwise text order
 * - `+ - * / %` arithmetic, `+` joins text when either side is not numeric
 * - boolean contexts (IF, AND, OR, NOT): false, 0, "", "false", "0", "no",
 *   "off", null and missing values are false
 */
const ctx = {
  variables: {
    status: 'approved', other: 'rejected', a: 3, b: 4, s: '10', flag: 'false', zero: '0', yes: 'true',
    name: 'Ada', d: '2026-01-05', price: 19.99, qty: '2', empty: '', nothing: null, items: [1, 2, 3],
  },
}
const r = (expr: string) => resolveExpression(expr, ctx)

describe('string equality', () => {
  it('== compares strings exactly', () => {
    expect(r('{{=IF({{status}} == "approved", "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF({{status}} == "rejected", "yes", "no")}}')).toBe('no')
    expect(r('{{=IF(status == "approved", "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF({{status}} == {{other}}, "yes", "no")}}')).toBe('no')
    expect(r('{{=IF({{status}} == "Approved", "yes", "no")}}')).toBe('no')
  })

  it('!= is the exact negation', () => {
    expect(r('{{=IF({{status}} != "approved", "yes", "no")}}')).toBe('no')
    expect(r('{{=IF({{status}} != "rejected", "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF("a" != "b", 1, 0)}}')).toBe(1)
  })

  it('a whole-expression comparison returns a boolean', () => {
    expect(r('{{= {{status}} == "approved" }}')).toBe(true)
    expect(r('{{= status != "approved" }}')).toBe(false)
  })

  it('compares numerically when both sides are numeric', () => {
    expect(r('{{=IF({{s}} == 10, "eq", "ne")}}')).toBe('eq')
    expect(r('{{=IF({{s}} == "10.0", "eq", "ne")}}')).toBe('eq')
    expect(r('{{=IF(s > 9, "big", "small")}}')).toBe('big')
    expect(r('{{=IF("10" > "9", "big", "small")}}')).toBe('big')
  })

  it('orders text when a side is not numeric', () => {
    expect(r('{{= d < "2026-02-01" }}')).toBe(true)
    expect(r('{{= "b" > "a" }}')).toBe(true)
  })

  it('a quoted string containing an operator stays a string', () => {
    expect(r('{{=CONCAT("a == b", "!")}}')).toBe('a == b!')
    expect(r('{{=LENGTH("1 + 1")}}')).toBe(5)
  })
})

describe('arithmetic', () => {
  it('a whole expression of variables and operators', () => {
    expect(r('{{= {{a}} + {{b}} }}')).toBe(7)
    expect(r('{{={{a}} * 2}}')).toBe(6)
    expect(r('{{= a * b - 2 }}')).toBe(10)
    expect(r('{{= (a + b) * 2 }}')).toBe(14)
    expect(r('{{= price * qty }}')).toBeCloseTo(39.98)
    expect(r('{{= 10 % 4 }}')).toBe(2)
    expect(r('{{= -a + 1 }}')).toBe(-2)
  })

  it('inside a mixed string', () => {
    expect(r('Total {{= {{a}} + 1 }} items')).toBe('Total 4 items')
  })

  it('as function arguments', () => {
    expect(r('{{=IF(a > 2, a * 2, 0)}}')).toBe(6)
    expect(r('{{=ROUND({{a}} / {{b}}, 2)}}')).toBe(0.75)
    expect(r('{{=ROUND(price * 1.15, 2)}}')).toBe(22.99)
  })

  it('+ joins text when a side is not numeric', () => {
    expect(r('{{= "Hello " + name }}')).toBe('Hello Ada')
  })

  it('division by zero and non-numeric operands give null', () => {
    expect(r('{{= a / 0 }}')).toBeNull()
    expect(r('{{= name * 2 }}')).toBeNull()
  })

  it('unquoted dates, ids and phone numbers stay text', () => {
    expect(evaluateFunction('LEFT(2026-01-05, 4)')).toBe('2026')
    expect(evaluateFunction('CONCAT(021-555-1234)')).toBe('021-555-1234')
    expect(evaluateFunction('UPPER(inv-0042)')).toBe('INV-0042')
    expect(r('{{=ADD_DAYS(d, -3)}}')).toBe('2026-01-02T00:00:00.000Z')
  })
})

describe('truthiness in IF / AND / OR / NOT', () => {
  it('"false", "0", "" and null are false', () => {
    expect(r('{{=IF({{flag}}, "yes", "no")}}')).toBe('no')
    expect(r('{{=IF("false", "yes", "no")}}')).toBe('no')
    expect(r('{{=IF({{zero}}, "yes", "no")}}')).toBe('no')
    expect(r('{{=IF({{empty}}, "yes", "no")}}')).toBe('no')
    expect(r('{{=IF(nothing, "yes", "no")}}')).toBe('no')
    expect(r('{{=IF(0, "yes", "no")}}')).toBe('no')
  })

  it('"true", non-empty text, numbers and lists are true', () => {
    expect(r('{{=IF({{yes}}, "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF(name, "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF(1, "yes", "no")}}')).toBe('yes')
    expect(r('{{=IF(items, "yes", "no")}}')).toBe('yes')
  })

  it('NOT / AND / OR use the same rules', () => {
    expect(r('{{=NOT({{flag}})}}')).toBe(true)
    expect(r('{{=AND(true, {{flag}})}}')).toBe(false)
    expect(r('{{=OR({{flag}}, {{zero}})}}')).toBe(false)
    expect(r('{{=OR({{flag}}, "yes")}}')).toBe(true)
  })

  it('existing boolean behaviour is unchanged', () => {
    expect(evaluateFunction('IF(true, "Yes", "No")')).toBe('Yes')
    expect(evaluateFunction('IF(false, "Yes", "No")')).toBe('No')
    expect(evaluateFunction('AND(true, true)')).toBe(true)
    expect(evaluateFunction('OR(false, false)')).toBe(false)
    expect(evaluateFunction('NOT(true)')).toBe(false)
  })
})

describe('missing values', () => {
  it('ordering against a missing or empty value is false', () => {
    expect(r('{{=IF(a > missing.limit, true, false)}}')).toBe(false)
    expect(r('{{=IF(a < empty, true, false)}}')).toBe(false)
    expect(r('{{= nothing >= 0 }}')).toBe(false)
  })

  it('null and missing equal the empty string', () => {
    expect(r('{{= nothing == "" }}')).toBe(true)
    expect(r('{{= empty != "" }}')).toBe(false)
  })
})
