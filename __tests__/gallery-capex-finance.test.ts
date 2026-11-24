/**
 * The CapEx planning gallery package works out NPV, IRR, payback and ROI with
 * label expressions on its request form (gallery/packages/capex-planning). These
 * tests evaluate the form's own expressions — through the server path that
 * stores them (mergeTaskFieldValues) — against plain reference implementations.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeTaskFieldValues } from '@/lib/task-field-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- form JSON */

const dir = join(process.cwd(), 'gallery/packages/capex-planning/assets/forms')
const form = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.startsWith('capex-request-'))!), 'utf8')).asset

// Reference implementations: year 0 = the investment, net cash flows at the end of years 1..N.
const npv = (r: number, inv: number, nets: number[]) => nets.reduce((s, n, i) => s + n / Math.pow(1 + r, i + 1), 0) - inv
function irr(inv: number, nets: number[]): number | null {
  if (npv(0, inv, nets) <= 0) return null
  let lo = 0, hi = 1
  if (npv(hi, inv, nets) > 0) return null
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (npv(mid, inv, nets) > 0) lo = mid; else hi = mid }
  return lo
}
function payback(inv: number, nets: number[]): number | null {
  let cum = 0
  for (let i = 0; i < nets.length; i++) { const before = cum; cum += nets[i]; if (cum >= inv && nets[i] > 0) return i + (inv - before) / nets[i] }
  return null
}
const roi = (inv: number, nets: number[]) => ((nets.reduce((a, b) => a + b, 0) - inv) / inv) * 100

/** Submit the request form's values the way the server stores them; cash-flow rows are sent WITHOUT their calculated net. */
function submit(costs: number[], flows: Array<[number, number]>, rate = 8) {
  const values = {
    discount_rate: rate,
    cost_lines: costs.map((amount, i) => ({ line_item: `Line ${i + 1}`, cost_type: 'Equipment', amount })),
    cash_flows: flows.map(([benefits, operating_costs], i) => ({ year: i + 1, benefits, operating_costs })),
  }
  const { templateValues } = mergeTaskFieldValues({ fields: form.fields, form_layout: form.layout }, values, { partial: true })
  // partial skips labels: run the full path but ignore unrelated required-field errors.
  const full = mergeTaskFieldValues({ fields: form.fields, form_layout: form.layout, template_values: templateValues }, values)
  return full.templateValues as Record<string, any>
}

const CASES: Array<{ name: string; costs: number[]; flows: Array<[number, number]> }> = [
  { name: 'even annuity', costs: [100000], flows: [[35000, 5000], [35000, 5000], [35000, 5000], [35000, 5000], [35000, 5000]] },
  { name: 'ramp-up with several cost lines', costs: [96000, 54000, 15000], flows: [[48000, 6000], [72000, 9000], [74000, 9000], [76000, 9000]] },
  { name: 'a negative year (refit) in the middle', costs: [80000], flows: [[55000, 5000], [5000, 15000], [45000, 5000], [45000, 5000]] },
  { name: 'fast payback, high IRR', costs: [40000], flows: [[50000, 5000], [50000, 5000], [50000, 5000]] },
  { name: 'never pays back', costs: [500000], flows: [[60000, 10000], [60000, 10000], [60000, 10000]] },
]

describe('CapEx request form: financial expressions', () => {
  it.each(CASES)('$name', ({ costs, flows }) => {
    const v = submit(costs, flows)
    const inv = costs.reduce((a, b) => a + b, 0)
    const nets = flows.map(([b, o]) => b - o)
    expect(v.investment).toBe(inv)
    expect(v.total_benefit).toBe(nets.reduce((a, b) => a + b, 0))
    expect(v.npv).toBe(Math.round(npv(0.08, inv, nets)))
    expect(v.roi_pct).toBeCloseTo(roi(inv, nets), 1)
    const r = irr(inv, nets)
    if (r === null) expect(v.irr_pct === '' || v.irr_pct === null || v.irr_pct === undefined).toBe(true)
    else expect(Math.abs(Number(v.irr_pct) - r * 100)).toBeLessThan(0.06)
    const p = payback(inv, nets)
    if (p === null) expect(v.payback_years === '' || v.payback_years === null || v.payback_years === undefined).toBe(true)
    else expect(Number(v.payback_years)).toBeCloseTo(p, 1)
  })

  it('NPV follows the discount rate; the sensitivity grid brackets the IRR', () => {
    const v = submit([100000], [[35000, 5000], [35000, 5000], [35000, 5000], [35000, 5000], [35000, 5000]], 12)
    expect(v.npv).toBe(Math.round(npv(0.12, 100000, [30000, 30000, 30000, 30000, 30000])))
    expect(v.npv_10).toBeGreaterThan(0)
    expect(v.npv_20).toBeLessThan(0)
    expect(Number(v.irr_pct)).toBeGreaterThan(10)
    expect(Number(v.irr_pct)).toBeLessThan(20)
  })
})
