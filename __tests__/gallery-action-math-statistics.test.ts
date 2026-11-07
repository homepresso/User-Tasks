/**
 * Official action ut_math (gallery/actions/math-statistics): contract checks
 * and every operation run in the QuickJS sandbox from the built module.
 */
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const action = contractSuite('math-statistics', {
  key: 'ut_math',
  operations: ['evaluate', 'round', 'stats', 'percentile', 'compound_interest', 'loan_schedule', 'convert_units'],
  capabilities: [],
})

describe('ut_math evaluate', () => {
  it('respects precedence, parentheses, power and unary minus', async () => {
    expect((await ok(action, 'evaluate', { expression: '1 + 2 * 3' })).result).toBe(7)
    expect((await ok(action, 'evaluate', { expression: '(1 + 2) * 3' })).result).toBe(9)
    expect((await ok(action, 'evaluate', { expression: '2 ^ 3 ^ 2' })).result).toBe(512)
    expect((await ok(action, 'evaluate', { expression: '-2 ^ 2' })).result).toBe(-4)
    expect((await ok(action, 'evaluate', { expression: '2 ^ -1' })).result).toBe(0.5)
    expect((await ok(action, 'evaluate', { expression: '10 % 4 - -3' })).result).toBe(5)
    expect((await ok(action, 'evaluate', { expression: '0.1 + 0.2' })).result).toBe(0.3)
    expect((await ok(action, 'evaluate', { expression: '1.5e3 / 3' })).result).toBe(500)
  })

  it('uses variables (dotted paths, numeric text), functions and constants', async () => {
    const out = await ok(action, 'evaluate', {
      expression: '(price * qty) * (1 + tax_rate) - discount',
      variables: { price: 19.99, qty: '3', tax_rate: 0.15, discount: 5 },
      decimals: 2,
    })
    expect(out.result).toBe(63.97)
    expect((await ok(action, 'evaluate', { expression: 'order.total * 2', variables: { order: { total: 21 } } })).result).toBe(42)
    expect((await ok(action, 'evaluate', { expression: 'max(1, 7, 3) + min(4, 2) + abs(-1) + sqrt(16) + pow(2, 10)' })).result).toBe(1038)
    expect((await ok(action, 'evaluate', { expression: 'round(2.675, 2) + floor(1.9) + ceil(1.1)' })).result).toBe(5.68)
    expect((await ok(action, 'evaluate', { expression: 'log(1000) + log(8, 2) + ln(e) + exp(0)' })).result).toBe(8)
    expect((await ok(action, 'evaluate', { expression: 'round(sin(pi / 2) + cos(0) + tan(0), 6)' })).result).toBe(2)
    expect((await ok(action, 'evaluate', { expression: 'e', variables: { e: 5 } })).result).toBe(5)
    expect((await ok(action, 'evaluate', { expression: 'PI', decimals: 4 })).result).toBe(3.1416)
  })

  it('never runs code and explains bad formulas', async () => {
    await fails(action, 'evaluate', { expression: 'constructor.constructor("return 1")()' }, /Unexpected character|Unknown/)
    await fails(action, 'evaluate', { expression: 'process.exit(1)' }, /Unknown function "process.exit"/)
    await fails(action, 'evaluate', { expression: '1 / 0' }, /Division by zero/)
    await fails(action, 'evaluate', { expression: '(1 + 2' }, /Expected "\)"/)
    await fails(action, 'evaluate', { expression: '1 +' }, /ended unexpectedly/)
    await fails(action, 'evaluate', { expression: '2 3' }, /Unexpected "3"/)
    await fails(action, 'evaluate', { expression: 'x + 1' }, /Unknown variable "x"/)
    await fails(action, 'evaluate', { expression: 'x + 1', variables: { x: 'abc' } }, /Variable "x" is not a number/)
    await fails(action, 'evaluate', { expression: 'sqrt(-1)' }, /negative/)
    await fails(action, 'evaluate', { expression: 'pow(2)' }, /pow\(\) takes 2 arguments/)
    await fails(action, 'evaluate', { expression: '"a"' }, /Unexpected character/)
    await fails(action, 'evaluate', { expression: `${'('.repeat(200)}1${')'.repeat(200)}` }, /nested too deeply/)
    await fails(action, 'evaluate', { expression: '' }, /required/)
  })
})

describe('ut_math round', () => {
  it('rounds decimal-exactly in every mode', async () => {
    const r = async (value: number, decimals: number, mode: string) => (await ok(action, 'round', { value, decimals, mode })).result
    expect(await r(1.005, 2, 'half_up')).toBe(1.01)
    expect(await r(-1.005, 2, 'half_up')).toBe(-1.01)
    expect(await r(2.345, 2, 'half_even')).toBe(2.34)
    expect(await r(2.355, 2, 'half_even')).toBe(2.36)
    expect(await r(2.5, 0, 'half_even')).toBe(2)
    expect(await r(3.5, 0, 'half_even')).toBe(4)
    expect(await r(1.231, 2, 'up')).toBe(1.24)
    expect(await r(-1.231, 2, 'up')).toBe(-1.24)
    expect(await r(1.239, 2, 'down')).toBe(1.23)
    expect(await r(-1.239, 2, 'down')).toBe(-1.23)
    expect(await r(-1.231, 2, 'floor')).toBe(-1.24)
    expect(await r(1.239, 2, 'floor')).toBe(1.23)
    expect(await r(-1.239, 2, 'ceil')).toBe(-1.23)
    expect(await r(1.231, 2, 'ceil')).toBe(1.24)
    expect(await r(1234.5, -2, 'half_up')).toBe(1200)
    expect(await r(0.1 + 0.2, 2, 'up')).toBe(0.3)
    expect(await r(-0.4, 0, 'half_up')).toBe(0)
  })

  it('defaults to whole numbers, half up', async () => {
    expect((await ok(action, 'round', { value: 2.5 })).result).toBe(3)
  })

  it('rejects bad input', async () => {
    await fails(action, 'round', { value: 'abc' }, /must be a number/)
    await fails(action, 'round', { value: 1, decimals: 1.5 }, /whole number/)
    await fails(action, 'round', { value: 1, mode: 'sideways' }, /must be one of/)
  })
})

describe('ut_math stats and percentile', () => {
  it('summarises a list of numbers', async () => {
    const out = await ok(action, 'stats', { values: [12, 15, 15, 18, 21, 30] })
    expect(out).toEqual({ count: 6, sum: 111, mean: 18.5, min: 12, max: 30, median: 16.5, mode: 15, variance: 41.1, stddev: 6.41092816992984, range: 18 })
    const pop = await ok(action, 'stats', { values: [2, 4, 4, 4, 5, 5, 7, 9], variance_type: 'population' })
    expect(pop.variance).toBe(4)
    expect(pop.stddev).toBe(2)
    expect(pop.mode).toBe(4)
    expect(pop.median).toBe(4.5)
  })

  it('reads a field of objects, skips blanks and accepts numeric text', async () => {
    const out = await ok(action, 'stats', { values: [{ a: { v: '1,000' } }, { a: { v: 2 } }, { a: { v: null } }, { a: {} }], field: 'a.v' })
    expect(out.count).toBe(2)
    expect(out.sum).toBe(1002)
    expect(out.mode).toBeNull()
    expect((await ok(action, 'stats', { values: [0.1, 0.2] })).sum).toBe(0.3)
  })

  it('handles empty and single-value lists', async () => {
    expect(await ok(action, 'stats', { values: [] })).toEqual({ count: 0, sum: 0, mean: null, min: null, max: null, median: null, mode: null, variance: null, stddev: null, range: null })
    await fails(action, 'stats', {}, /Values is required/)
    const one = await ok(action, 'stats', { values: [5] })
    expect(one).toMatchObject({ count: 1, mean: 5, variance: null, stddev: null, range: 0 })
    const blanks = await ok(action, 'stats', { values: ['', null] })
    expect(blanks).toMatchObject({ count: 0, sum: 0, mean: null })
  })

  it('rejects non-numbers and objects without a field', async () => {
    await fails(action, 'stats', { values: [1, 'two'] }, /values\[1\] is not a number/)
    await fails(action, 'stats', { values: [{ a: 1 }] }, /set field/)
  })

  it('interpolates percentiles like PERCENTILE.INC', async () => {
    const values = [15, 20, 35, 40, 50]
    expect((await ok(action, 'percentile', { values, p: 40 })).value).toBe(29)
    expect((await ok(action, 'percentile', { values, p: 0 })).value).toBe(15)
    expect((await ok(action, 'percentile', { values, p: 100 })).value).toBe(50)
    expect((await ok(action, 'percentile', { values, p: 50 })).value).toBe(35)
    expect((await ok(action, 'percentile', { values: [12, 15, 15, 18, 21, 30], p: 90 }))).toEqual({ value: 25.5, count: 6 })
    expect((await ok(action, 'percentile', { values: [7], p: 75 })).value).toBe(7)
    await fails(action, 'percentile', { values: [1, 2], p: 101 }, /at most 100/)
    await fails(action, 'percentile', { values: [null], p: 50 }, /no numbers/)
  })
})

describe('ut_math compound_interest', () => {
  it('matches the closed form for annual and monthly compounding', async () => {
    const annual = await ok(action, 'compound_interest', { principal: 1000, annual_rate: 5, years: 10, compounds_per_year: 1 })
    expect(annual.future_value).toBe(1628.89)
    expect(annual.total_contributions).toBe(1000)
    expect(annual.interest_earned).toBe(628.89)
    expect(annual.schedule).toHaveLength(10)
    expect(annual.schedule[0]).toEqual({ year: 1, contributions: 0, interest: 50, balance: 1050 })
    const monthly = await ok(action, 'compound_interest', { principal: 1000, annual_rate: 5, years: 10 })
    expect(monthly.future_value).toBe(Math.round(1000 * (1 + 0.05 / 12) ** 120 * 100) / 100)
  })

  it('adds contributions at the end or the start of each period', async () => {
    const r = 0.06 / 12
    const n = 120
    const annuity = 100 * ((1 + r) ** n - 1) / r
    const end = await ok(action, 'compound_interest', { principal: 0, annual_rate: 6, years: 10, contribution: 100 })
    expect(end.future_value).toBe(Math.round(annuity * 100) / 100)
    expect(end.total_contributions).toBe(12000)
    expect(end.interest_earned).toBe(Math.round((annuity - 12000) * 100) / 100)
    const start = await ok(action, 'compound_interest', { principal: 0, annual_rate: 6, years: 10, contribution: 100, contribution_timing: 'start' })
    expect(start.future_value).toBe(Math.round(annuity * (1 + r) * 100) / 100)
    expect(end.schedule[9].balance).toBe(end.future_value)
  })

  it('rejects bad terms', async () => {
    await fails(action, 'compound_interest', { principal: 1000, annual_rate: 5, years: 0 }, /at least 1/)
    await fails(action, 'compound_interest', { principal: 1000, annual_rate: 5, years: 2.5 }, /whole number/)
  })
})

describe('ut_math loan_schedule', () => {
  it('amortises a 30-year mortgage to exactly zero', async () => {
    const out = await ok(action, 'loan_schedule', { principal: 200000, annual_rate: 6, term_months: 360, start_date: '2027-01-31' })
    expect(out.payment).toBe(1199.1)
    expect(out.number_of_payments).toBe(360)
    expect(out.schedule).toHaveLength(360)
    expect(out.schedule[0]).toEqual({ period: 1, date: '2027-01-31', payment: 1199.1, principal: 199.1, interest: 1000, balance: 199800.9 })
    expect(out.schedule[1].date).toBe('2027-02-28')
    expect(out.schedule[2].date).toBe('2027-03-31')
    const last = out.schedule[359]
    expect(last.balance).toBe(0)
    expect(last.date).toBe('2056-12-31')
    expect(out.payoff_date).toBe('2056-12-31')
    const principalSum = out.schedule.reduce((s: number, row: any) => s + Math.round(row.principal * 100), 0)
    expect(principalSum).toBe(20000000)
    const interestSum = out.schedule.reduce((s: number, row: any) => s + Math.round(row.interest * 100), 0)
    expect(out.total_interest).toBe(interestSum / 100)
    expect(out.total_paid).toBe(Math.round((200000 + out.total_interest) * 100) / 100)
    // Every row: payment = principal + interest; balances fall.
    for (const row of out.schedule) expect(Math.round(row.principal * 100) + Math.round(row.interest * 100)).toBe(Math.round(row.payment * 100))
    expect(Math.abs(last.payment - 1199.1)).toBeLessThan(2)
  })

  it('handles interest-free loans and extra payments', async () => {
    const free = await ok(action, 'loan_schedule', { principal: 1000, annual_rate: 0, term_months: 3 })
    expect(free.payment).toBe(333.33)
    expect(free.schedule.map((r: any) => r.payment)).toEqual([333.33, 333.33, 333.34])
    expect(free.total_interest).toBe(0)
    expect(free.payoff_date).toBeNull()
    expect(free.schedule[0].date).toBeNull()
    const extra = await ok(action, 'loan_schedule', { principal: 10000, annual_rate: 12, term_months: 12, extra_payment: 500 })
    expect(extra.payment).toBe(888.49)
    expect(extra.number_of_payments).toBeLessThan(12)
    expect(extra.schedule[extra.schedule.length - 1].balance).toBe(0)
    const base = await ok(action, 'loan_schedule', { principal: 10000, annual_rate: 12, term_months: 12 })
    expect(extra.total_interest).toBeLessThan(base.total_interest)
    expect(base.total_interest).toBe(661.86)
  })

  it('rejects bad loans', async () => {
    await fails(action, 'loan_schedule', { principal: 0, annual_rate: 5, term_months: 12 }, /at least 0.01/)
    await fails(action, 'loan_schedule', { principal: 1000, annual_rate: 5, term_months: 601 }, /at most 600/)
    await fails(action, 'loan_schedule', { principal: 1000, annual_rate: 5, term_months: 12, start_date: '2026-02-30' }, /not a real date/)
  })
})

describe('ut_math convert_units', () => {
  it('converts in every category', async () => {
    const c = async (value: number, from: string, to: string) => (await ok(action, 'convert_units', { value, from, to }))
    expect(await c(26.2, 'mi', 'km')).toEqual({ result: 42.1648128, category: 'length', from_unit: 'mi', to_unit: 'km' })
    expect((await c(1, 'kg', 'lb')).result).toBe(2.20462262185)
    expect((await c(1, 'gal', 'L')).result).toBe(3.785411784)
    expect((await c(100, 'C', 'F')).result).toBe(212)
    expect((await c(32, 'fahrenheit', 'celsius')).result).toBe(0)
    expect((await c(0, 'K', 'C')).result).toBe(-273.15)
    expect((await c(1, 'ha', 'm2')).result).toBe(10000)
    expect((await c(1, 'ac', 'ha')).result).toBe(0.40468564224)
    expect((await c(100, 'km/h', 'mph')).result).toBe(62.1371192237)
    expect((await c(1, 'GiB', 'MB')).result).toBe(1073.741824)
    expect((await c(1, 'MB', 'Mb')).result).toBe(8)
    expect((await c(90, 'minutes', 'h')).result).toBe(1.5)
    expect((await c(1, 'yr', 'd')).result).toBe(365.2425)
  })

  it('explains impossible conversions', async () => {
    await fails(action, 'convert_units', { value: 1, from: 'kg', to: 'm' }, /Cannot convert mass \(kg\) to length \(m\)/)
    await fails(action, 'convert_units', { value: 1, from: 'parsec', to: 'm' }, /Unknown unit "parsec"/)
    await fails(action, 'convert_units', { value: 1, from: 'mb', to: 'B' }, /ambiguous/)
    await fails(action, 'convert_units', { value: -500, from: 'C', to: 'K' }, /absolute zero/)
  })
})
