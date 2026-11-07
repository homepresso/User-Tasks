/**
 * ut_math — Math & statistics: a safe expression evaluator, precise rounding,
 * descriptive statistics, percentiles, compound interest, loan amortisation
 * schedules and unit conversion. Pure computation (no capabilities).
 */

import { defineAction } from '@usertasks/action'
import { choice, clean, getPath, isBlank, isPlainObject, list, num, obj, optNum, str, toNumber, type Inputs } from '../../shared/inputs'
import { evaluateExpression } from './expression'
import { convertUnits } from './units'

// ── Rounding ────────────────────────────────────────────────────────────────

const ROUND_MODES = ['half_up', 'half_even', 'up', 'down', 'floor', 'ceil'] as const
type RoundMode = (typeof ROUND_MODES)[number]

/** Multiply by 10^d exactly in decimal (string exponent shift, no 1.005 * 100 = 100.49999…). */
function shift(x: number, d: number): number {
  const [mantissa, exponent] = String(x).split('e')
  return Number(`${mantissa}e${Number(exponent ?? 0) + d}`)
}

function roundTo(value: number, decimals: number, mode: RoundMode = 'half_up'): number {
  // 15 significant digits drop binary noise first (0.1 + 0.2 → 0.3).
  const v = Number(value.toPrecision(15))
  const s = shift(Math.abs(v), decimals)
  const sign = v < 0 ? -1 : 1
  const fl = Math.floor(s)
  const frac = s - fl
  let r: number
  switch (mode) {
    case 'half_up': r = frac >= 0.5 ? fl + 1 : fl; break
    case 'half_even': r = frac > 0.5 ? fl + 1 : frac < 0.5 ? fl : (fl % 2 === 0 ? fl : fl + 1); break
    case 'up': r = frac > 0 ? fl + 1 : fl; break
    case 'down': r = fl; break
    case 'floor': r = sign < 0 ? (frac > 0 ? fl + 1 : fl) : fl; break
    case 'ceil': r = sign < 0 ? fl : (frac > 0 ? fl + 1 : fl); break
  }
  const out = shift(sign * r, -decimals)
  return out === 0 ? 0 : out
}

const money = (n: number) => roundTo(n, 2, 'half_up')

// ── Statistics ──────────────────────────────────────────────────────────────

function numbersOf(inputs: Inputs): number[] {
  const values = list(inputs, 'values', { required: true })
  const field = str(inputs, 'field')
  const out: number[] = []
  values.forEach((item, index) => {
    let raw: unknown = item
    if (field) {
      if (!isPlainObject(item)) throw new Error(`values[${index}] is not an object (field "${field}" was given)`)
      raw = getPath(item, field)
    } else if (isPlainObject(item)) {
      throw new Error(`values[${index}] is an object: set field to the property holding the number`)
    }
    if (isBlank(raw)) return
    const n = toNumber(raw)
    if (n === null || !Number.isFinite(n)) throw new Error(`values[${index}]${field ? `.${field}` : ''} is not a number ("${String(raw).slice(0, 30)}")`)
    out.push(n)
  })
  return out
}

/** Neumaier compensated sum. */
function sum(values: number[]): number {
  let s = 0
  let c = 0
  for (const v of values) {
    const t = s + v
    c += Math.abs(s) >= Math.abs(v) ? (s - t) + v : (v - t) + s
    s = t
  }
  return s + c
}

function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const rank = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

// ── Dates (loan schedule) ───────────────────────────────────────────────────

function parseDate(raw: string, name: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD)`)
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  const t = new Date(Date.UTC(y, mo - 1, d))
  if (t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) throw new Error(`${name} is not a real date (${raw.slice(0, 10)})`)
  return { y, m: mo, d }
}

/** The date `months` after start, clamped to the end of shorter months (Jan 31 → Feb 28). */
function addMonths(start: { y: number; m: number; d: number }, months: number): string {
  const total = start.y * 12 + (start.m - 1) + months
  const y = Math.floor(total / 12)
  const m = total % 12
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const d = Math.min(start.d, last)
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    evaluate(inputs: Inputs) {
      const expression = str(inputs, 'expression', { required: true })
      const variables = obj(inputs, 'variables')
      const decimals = optNum(inputs, 'decimals', { integer: true, min: 0, max: 15 })
      let result = clean(evaluateExpression(expression, variables))
      if (decimals !== null) result = roundTo(result, decimals)
      return { result }
    },

    round(inputs: Inputs) {
      const value = num(inputs, 'value')
      const decimals = optNum(inputs, 'decimals', { integer: true, min: -15, max: 15, default: 0 })!
      const mode = choice(inputs, 'mode', ROUND_MODES, 'half_up')
      return { result: roundTo(value, decimals, mode) }
    },

    stats(inputs: Inputs) {
      const values = numbersOf(inputs)
      const kind = choice(inputs, 'variance_type', ['sample', 'population'] as const, 'sample')
      const n = values.length
      if (n === 0) {
        return { count: 0, sum: 0, mean: null, min: null, max: null, median: null, mode: null, variance: null, stddev: null, range: null }
      }
      const sorted = [...values].sort((a, b) => a - b)
      const total = sum(values)
      const mean = total / n
      const squares = sum(values.map((v) => (v - mean) ** 2))
      const variance = kind === 'population' ? squares / n : n > 1 ? squares / (n - 1) : null
      const counts = new Map<number, number>()
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
      let mode: number | null = null
      let best = 1
      for (const v of sorted) {
        const c = counts.get(v)!
        if (c > best) { best = c; mode = v }
      }
      return {
        count: n,
        sum: clean(total),
        mean: clean(mean),
        min: sorted[0],
        max: sorted[n - 1],
        median: clean(percentileOf(sorted, 50)),
        mode,
        variance: variance === null ? null : clean(variance),
        stddev: variance === null ? null : clean(Math.sqrt(variance)),
        range: clean(sorted[n - 1] - sorted[0]),
      }
    },

    percentile(inputs: Inputs) {
      const values = numbersOf(inputs)
      const p = num(inputs, 'p', { min: 0, max: 100 })
      if (values.length === 0) throw new Error('values has no numbers')
      const sorted = [...values].sort((a, b) => a - b)
      return { value: clean(percentileOf(sorted, p)), count: values.length }
    },

    compound_interest(inputs: Inputs) {
      const principal = num(inputs, 'principal', { min: 0, default: 0 })
      const annualRate = num(inputs, 'annual_rate', { min: -100, max: 1000 })
      const years = num(inputs, 'years', { integer: true, min: 1, max: 100 })
      const perYear = num(inputs, 'compounds_per_year', { integer: true, min: 1, max: 365, default: 12 })
      const contribution = num(inputs, 'contribution', { default: 0 })
      const timing = choice(inputs, 'contribution_timing', ['end', 'start'] as const, 'end')
      const r = annualRate / 100 / perYear
      let balance = principal
      let contributed = principal
      const schedule: Array<{ year: number; contributions: number; interest: number; balance: number }> = []
      for (let year = 1; year <= years; year++) {
        let yearContrib = 0
        let yearInterest = 0
        for (let k = 0; k < perYear; k++) {
          if (timing === 'start') { balance += contribution; yearContrib += contribution }
          const interest = balance * r
          balance += interest
          yearInterest += interest
          if (timing === 'end') { balance += contribution; yearContrib += contribution }
        }
        contributed += yearContrib
        schedule.push({ year, contributions: money(yearContrib), interest: money(yearInterest), balance: money(balance) })
      }
      const futureValue = money(balance)
      return {
        future_value: futureValue,
        total_contributions: money(contributed),
        interest_earned: money(futureValue - contributed),
        schedule,
      }
    },

    loan_schedule(inputs: Inputs) {
      const principal = num(inputs, 'principal', { min: 0.01 })
      const annualRate = num(inputs, 'annual_rate', { min: 0, max: 100 })
      const n = num(inputs, 'term_months', { integer: true, min: 1, max: 600 })
      const extra = num(inputs, 'extra_payment', { min: 0, default: 0 })
      const startRaw = str(inputs, 'start_date')
      const start = startRaw ? parseDate(startRaw, 'start_date') : null
      const r = annualRate / 100 / 12
      const payment = money(r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n)))
      // Cents as integers: no drift over hundreds of periods.
      const paymentC = Math.round(payment * 100)
      const extraC = Math.round(extra * 100)
      let balanceC = Math.round(principal * 100)
      let interestTotalC = 0
      let paidTotalC = 0
      const schedule: Array<{ period: number; date: string | null; payment: number; principal: number; interest: number; balance: number }> = []
      for (let period = 1; period <= n && balanceC > 0; period++) {
        const interestC = Math.round(balanceC * r)
        let principalC = paymentC - interestC + extraC
        // The last period (or an overpayment) pays exactly what is left.
        if (principalC >= balanceC || period === n) principalC = balanceC
        if (principalC < 0) throw new Error('The payment does not cover the interest')
        const payC = principalC + interestC
        balanceC -= principalC
        interestTotalC += interestC
        paidTotalC += payC
        schedule.push({
          period,
          date: start ? addMonths(start, period - 1) : null,
          payment: payC / 100,
          principal: principalC / 100,
          interest: interestC / 100,
          balance: balanceC / 100,
        })
      }
      const last = schedule[schedule.length - 1]
      return {
        payment,
        total_interest: interestTotalC / 100,
        total_paid: paidTotalC / 100,
        number_of_payments: schedule.length,
        payoff_date: last?.date ?? null,
        schedule,
      }
    },

    convert_units(inputs: Inputs) {
      const value = num(inputs, 'value')
      const from = str(inputs, 'from', { required: true })
      const to = str(inputs, 'to', { required: true })
      return convertUnits(value, from, to)
    },
  },
})
