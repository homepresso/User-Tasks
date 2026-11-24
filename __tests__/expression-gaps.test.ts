/**
 * Expression engine gaps found building the showcase apps:
 *  - `COUNT(a) - COUNT(b)` returned 0 (read as COUNT with the argument "a) - COUNT(b");
 *  - an unknown variable resolved to its own name ("Tel contact_phone");
 *  - NPV / IRR, checked against Excel's documented reference values.
 */
import { describe, expect, it } from 'vitest'
import { FUNCTION_CATALOG, evaluateFunction, parseFunctionCall } from '@/lib/expression-functions'
import { resolveExpression, resolveExpressionValues } from '@/lib/expression-resolver'
import { evaluateLabelExpression, expressionProblems, labelScope } from '@/lib/forms/label-field'

describe('operator expressions over two calls', () => {
  const scope = { a: [1, 2, 3], b: [1], form: { lines: [{ amount: 5 }, { amount: 7 }], refunds: [{ amount: 2 }] } }

  it('COUNT(a) - COUNT(b) is 2, not 0 (every surface)', () => {
    expect(parseFunctionCall('COUNT(a) - COUNT(b)')).toBeNull()
    expect(evaluateFunction('COUNT(a) - COUNT(b)', scope)).toBe(2)
    expect(resolveExpression('{{=COUNT(a) - COUNT(b)}}', { variables: scope })).toBe(2)
    expect(resolveExpressionValues('{{=COUNT(form.lines) - COUNT(form.refunds)}}', scope)).toBe(1)
    expect(evaluateFunction('SUM(form.lines, "amount") - SUM(form.refunds, "amount")', scope)).toBe(10)
    expect(evaluateFunction('ROUND(SUM(form.lines, "amount") / COUNT(form.lines), 1) * 2', scope)).toBe(12)
  })

  it('a single call keeps working, including parentheses inside quotes', () => {
    expect(parseFunctionCall('CONCAT("a)", "(b")')).toEqual({ name: 'CONCAT', args: ['"a)"', '"(b"'] })
    expect(evaluateFunction('CONCAT("a)", "(b")', {})).toBe('a)(b')
    expect(evaluateFunction('IF(COUNT(a) > 2, "many", "few")', scope)).toBe('many')
  })
})

describe('unknown variables are empty, not their own name', () => {
  it('a snake_case name with no value is null inside functions and operators', () => {
    expect(evaluateFunction('IS_EMPTY(irr_stepx)', {})).toBe(true)
    expect(evaluateFunction('CONCAT("Tel ", contact_phone)', {})).toBe('Tel ')
    expect(evaluateFunction('total_cost * 2', {})).toBeNull()
    expect(resolveExpression('{{=UPPER(account_name)}}', { variables: {} })).toBe('')
  })

  it('the whole expression being one unknown name is null', () => {
    expect(evaluateFunction('nope', {})).toBeNull()
    expect(evaluateFunction('form.nope', { form: {} })).toBeUndefined()
    expect(resolveExpressionValues('{{=missing_total}}', {})).toBeNull()
  })

  it('known names still resolve, and plain unquoted words / dotted text keep the documented text reading', () => {
    expect(evaluateFunction('CONCAT("Tel ", contact_phone)', { contact_phone: '021 555' })).toBe('Tel 021 555')
    expect(evaluateFunction('DATE_DIFF("2026-01-01", "2026-01-03", days)', {})).toBe(2)
    expect(evaluateFunction('CONTAINS(email, example.com)', { email: 'a@example.com' })).toBe(true)
    expect(evaluateFunction('IF(status == open, 1, 0)', { status: 'open' })).toBe(1)
  })

  it('a label reading an unknown name: empty value, and the designer warns', () => {
    const fields = [{ key: 'contact_phone', label: 'Phone', type: 'text' }]
    const evaluation = evaluateLabelExpression('CONCAT("Tel ", contact_phon)', labelScope(fields as any, {}))
    expect(evaluation.value).toBe('Tel ')
    const known = { fields: new Set(['contact_phone']), tables: new Map(), labels: new Set<string>(), params: new Set<string>(), variables: new Set<string>() }
    expect(expressionProblems('CONCAT("Tel ", contact_phon)', known)).toEqual(['Unknown name "contact_phon" (pick a field, parameter or control with {x})'])
  })
})

describe('NPV and IRR (Excel reference values)', () => {
  it('NPV(rate, values…): first value discounted one period', () => {
    expect(evaluateFunction('NPV(0.1, -10000, 3000, 4200, 6800)', {})).toBeCloseTo(1188.4434, 3)
    expect(evaluateFunction('NPV(0.08, 8000, 9200, 10000, 12000, 14500) + -40000', {})).toBeCloseTo(1922.0616, 3)
    // A list (a List / repeating section column) works like spread values; blanks and text are skipped.
    const scope = { form: { cash_flows: [{ year: 1, net: 3000 }, { year: 2, net: 4200 }, { year: 3, net: '' }, { year: 4, net: 6800 }] } }
    expect(evaluateFunction('NPV(0.1, -10000, PLUCK(form.cash_flows, "net"))', scope)).toBeCloseTo(1188.4434, 3)
    expect(evaluateFunction('NPV(0, 1, 2, 3)', {})).toBe(6)
    expect(evaluateFunction('NPV(-1, 1, 2)', {})).toBeNull()
  })

  it('IRR(values…): period 0 first; null without a sign change', () => {
    expect(evaluateFunction('IRR(-70000, 12000, 15000, 18000, 21000)', {})).toBeCloseTo(-0.021245, 5)
    expect(evaluateFunction('IRR(-70000, 12000, 15000, 18000, 21000, 26000)', {})).toBeCloseTo(0.086631, 5)
    expect(evaluateFunction('IRR(-70000, 12000, 15000)', {})).toBeCloseTo(-0.443507, 5)
    expect(evaluateFunction('IRR(PLUCK(rows, "net"))', { rows: [{ net: -1000 }, { net: 1100 }] })).toBeCloseTo(0.1, 10)
    expect(evaluateFunction('IRR(1000, 200, 300)', {})).toBeNull()
    expect(evaluateFunction('IRR(-1000)', {})).toBeNull()
    // NPV at the IRR is 0.
    const rate = evaluateFunction('IRR(-50000, 15000, 18000, 20000, 22000)', {}) as number
    expect(evaluateFunction(`NPV(${rate}, 15000, 18000, 20000, 22000) - 50000`, {})).toBeCloseTo(0, 6)
  })

  it('CapEx-style label formulas: NPV at the hurdle rate and IRR from the cash-flow rows', () => {
    const fields = [{ key: 'investment', label: 'Investment', type: 'currency' }, { key: 'discount_rate', label: 'Rate', type: 'number' }]
    const values = { investment: 100000, discount_rate: 10, cash_flows: [{ year: 1, net: 30000 }, { year: 2, net: 35000 }, { year: 3, net: 40000 }, { year: 4, net: 30000 }] }
    const scope = labelScope(fields as any, values)
    const viaMap = evaluateLabelExpression('ROUND(SUM(MAP(form.cash_flows, "net / POWER(1 + form.discount_rate / 100, year)")) - investment, 0)', scope).value
    const viaNpv = evaluateLabelExpression('ROUND(NPV(form.discount_rate / 100, PLUCK(form.cash_flows, "net")) - investment, 0)', scope).value
    expect(viaNpv).toBe(viaMap)
    const irr = evaluateLabelExpression('ROUND(100 * IRR(-1 * investment, PLUCK(form.cash_flows, "net")), 1)', scope).value
    expect(irr).toBe(13)  // 13.04% (worked out independently)
  })

  it('documented in the function catalog (the generated docs read it)', () => {
    for (const name of ['NPV', 'IRR']) {
      const fn = FUNCTION_CATALOG.find((f) => f.name === name)
      expect(fn?.category).toBe('math')
      expect(fn?.example).toMatch(new RegExp(`^${name}\\(`))
    }
  })
})
