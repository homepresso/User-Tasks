/**
 * Acme tax calculator: a UserTasks custom workflow action.
 *
 * Each operation in manifest.json has a function here with the same id. It
 * gets the step's inputs (already coerced to the manifest types) and `ctx`,
 * and returns its outputs as an object. The code runs in a QuickJS
 * WebAssembly sandbox: plain JavaScript only, no Node or browser APIs, no
 * fetch or timers. Reach the outside world through `ctx` (and only for the
 * capabilities the manifest declares).
 *
 * `npm test` runs every operation's sample inputs and test/cases.json in the
 * same sandbox the app uses.
 */
import { defineAction, type ActionContext } from '../vendor/usertasks-action/index'

type Rounding = 'half_up' | 'half_even' | 'none'

interface CalculateInputs {
  amount: number
  rate_percent: number
  prices_include_tax?: boolean
  rounding?: Rounding
}

interface InvoiceLine {
  description?: string
  quantity?: number
  unit_price?: number
  tax_rate_percent?: number
}

interface InvoiceInputs {
  lines: InvoiceLine[]
  default_rate_percent?: number
  currency?: string
  locale?: string
}

/** Round to cents. Works on the decimal string so 1.005 rounds like a person would expect. */
function roundCents(value: number, rounding: Rounding = 'half_up'): number {
  if (rounding === 'none') return value
  const cents = Number((Math.abs(value) * 100).toFixed(6))
  const floor = Math.floor(cents)
  const diff = cents - floor
  let rounded: number
  if (diff > 0.5) rounded = floor + 1
  else if (diff < 0.5) rounded = floor
  else rounded = rounding === 'half_even' ? (floor % 2 === 0 ? floor : floor + 1) : floor + 1
  const result = (Math.sign(value) || 1) * rounded / 100
  return Object.is(result, -0) ? 0 : result
}

function requireNumber(ctx: ActionContext, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) ctx.fail(`${name} must be a number`)
  return value
}

function taxOf(amount: number, ratePercent: number, inclusive: boolean, rounding: Rounding) {
  const rate = ratePercent / 100
  if (inclusive) {
    const gross = roundCents(amount, rounding)
    const net = roundCents(amount / (1 + rate), rounding)
    return { net, tax: roundCents(gross - net, rounding), gross }
  }
  const net = roundCents(amount, rounding)
  const tax = roundCents(amount * rate, rounding)
  return { net, tax, gross: roundCents(net + tax, rounding) }
}

export default defineAction({
  operations: {
    calculate(inputs: CalculateInputs, ctx) {
      const amount = requireNumber(ctx, 'amount', inputs.amount)
      const rate = requireNumber(ctx, 'rate_percent', inputs.rate_percent)
      if (rate < 0 || rate > 100) ctx.fail('rate_percent must be between 0 and 100')
      const result = taxOf(amount, rate, inputs.prices_include_tax === true, inputs.rounding ?? 'half_up')
      ctx.log.info('Calculated tax', { rate, inclusive: inputs.prices_include_tax === true })
      return result
    },

    invoice_totals(inputs: InvoiceInputs, ctx) {
      if (!Array.isArray(inputs.lines) || inputs.lines.length === 0) ctx.fail('lines must list at least one invoice line')
      const defaultRate = inputs.default_rate_percent ?? 15
      const lines = inputs.lines.map((line, index) => {
        const quantity = requireNumber(ctx, `lines[${index}].quantity`, line.quantity ?? 1)
        const unitPrice = requireNumber(ctx, `lines[${index}].unit_price`, line.unit_price)
        const rate = line.tax_rate_percent ?? defaultRate
        return { description: line.description ?? `Line ${index + 1}`, ...taxOf(quantity * unitPrice, rate, false, 'half_up') }
      })
      const sum = (key: 'net' | 'tax' | 'gross') => roundCents(lines.reduce((total, line) => total + line[key], 0))
      const total = sum('gross')
      // QuickJS has no Intl: ctx.intl formats on the host.
      const total_formatted = ctx.intl.formatNumber(total, inputs.locale ?? 'en-NZ', { style: 'currency', currency: inputs.currency ?? 'NZD' })
      if (lines.length > 100) ctx.log.warn('Large invoice', { lines: lines.length })
      return { lines, subtotal: sum('net'), tax_total: sum('tax'), total, total_formatted }
    },
  },
})
