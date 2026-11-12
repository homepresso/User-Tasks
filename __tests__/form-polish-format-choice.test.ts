/**
 * Form polish: a calculated value (Label with an expression) shows in a
 * display format — currency / number / percent, and currency by default
 * when it adds up currency values — and the List row pop-out / inline cells
 * use the form's styled dropdown for choice columns, not a native <select>.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { formatLabelValue, inferLabelFormat, labelDisplayFormat, normalizeLabelConfig } from '@/lib/forms/label-field'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { normalizeListConfig, type ListColumn } from '@/lib/forms/list-field'
import { labelFormatFromInfoPath } from '@/lib/infopath/generate'
import { FormRenderer } from '@/components/forms/form-renderer'
import { ColumnInput } from '@/components/forms/list-field'
import { RowFormFields } from '@/components/forms/list-row-dialog'

const wrap = (el: React.ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))

const FIELDS = normalizeTaskFields([
  { key: 'employee', label: 'Employee', type: 'text' },
  {
    key: 'expenses', label: 'Expenses', type: 'repeating_section', repeating_section: {
      fields: [
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD' },
        { key: 'nights', label: 'Nights', type: 'number' },
      ],
      totals: [{ field: 'amount', fn: 'sum' }],
    },
  },
  { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Price', type: 'currency', currency: 'EUR' }] } },
  { key: 'fee', label: 'Fee', type: 'currency', currency: 'USD' },
  { key: 'rate', label: 'Rate', type: 'number' },
  { key: 'claim_total', label: 'Claim total (USD)', type: 'label', label_config: { expression: 'SUM(PLUCK({{form.expenses}}, "amount"))', include: true } },
] as unknown[]) as TaskFieldDef[]
const label = (expression: string, extra: Record<string, unknown> = {}) => ({ key: 'x', label: 'X', type: 'label', label_config: { expression, ...extra } })

describe('label display formats', () => {
  it('currency, number with decimals and percent format with Intl in the locale; the value stays a number', () => {
    expect(formatLabelValue({ format: { kind: 'currency', currency: 'USD' } }, 535, { locale: 'en-US' }).text).toBe('$535.00')
    expect(formatLabelValue({ format: { kind: 'currency', currency: 'EUR' } }, 1234.5, { locale: 'de-DE' }).text.replace(/\s/g, ' ')).toBe('1.234,50 €')
    expect(formatLabelValue({ format: { kind: 'number', decimals: 2 } }, 1234.5, { locale: 'en-US' }).text).toBe('1,234.50')
    expect(formatLabelValue({ format: { kind: 'percent', percent_source: 'fraction', decimals: 1 } }, 0.125, { locale: 'en-US' }).text).toBe('12.5%')
    expect(formatLabelValue({ format: { kind: 'percent' } }, 15, { locale: 'en-US' }).text).toBe('15%')
    expect(formatLabelValue({ format: { kind: 'date' } }, '2026-11-03', { locale: 'en-US' }).empty).toBeFalsy()
  })

  it('summing currency defaults to currency: a repeating section column, a List column (its code), a currency field, a stored total, another currency label', () => {
    const claim = FIELDS.find((f) => f.key === 'claim_total')!
    expect(inferLabelFormat(claim, FIELDS)).toEqual({ kind: 'currency', currency: 'USD' })
    expect(formatLabelValue(claim.label_config, 535, { locale: 'en-US', inferred: labelDisplayFormat(claim, FIELDS) }).text).toBe('$535.00')
    expect(inferLabelFormat(label('SUMPRODUCT({{form.lines}}, "qty", "price")'), FIELDS)).toEqual({ kind: 'currency', currency: 'EUR' })
    expect(inferLabelFormat(label('{{form.fee}} * 1.15'), FIELDS)).toEqual({ kind: 'currency', currency: 'USD' })
    expect(inferLabelFormat(label('{{form.expenses_total_amount}} + 10'), FIELDS)).toEqual({ kind: 'currency', currency: 'USD' })
    const withLabel = [...FIELDS, label('control.claim_total.value * 2') as TaskFieldDef]
    expect(inferLabelFormat(withLabel[withLabel.length - 1], withLabel)).toEqual({ kind: 'currency', currency: 'USD' })
  })

  it('no currency default for counts, plain numbers, mixed currencies, or a hand-written prefix; an explicit format wins', () => {
    expect(inferLabelFormat(label('COUNT({{form.expenses}})'), FIELDS)).toBeNull()
    expect(inferLabelFormat(label('SUM(PLUCK({{form.expenses}}, "nights"))'), FIELDS)).toBeNull()
    expect(inferLabelFormat(label('{{form.rate}} * 2'), FIELDS)).toBeNull()
    expect(inferLabelFormat(label('{{form.fee}} + SUMPRODUCT({{form.lines}}, "qty", "price")'), FIELDS)).toBeNull()
    expect(inferLabelFormat(label('{{form.fee}}', { prefix: '$' }), FIELDS)).toBeNull()
    expect(labelDisplayFormat(label('{{form.fee}}', { format: { kind: 'number', decimals: 1 } }), FIELDS)).toEqual({ kind: 'number', decimals: 1 })
    // Without a format or a default a number shows as calculated.
    expect(formatLabelValue({}, 535, { locale: 'en-US' }).text).toBe('535')
  })

  it('format shorthand ("currency" with currency beside it) normalises to a cell format', () => {
    expect(normalizeLabelConfig({ expression: '1', format: 'currency', currency: 'eur', decimals: 0 })).toEqual({ expression: '1', format: { kind: 'currency', currency: 'EUR', decimals: 0 } })
    expect(normalizeLabelConfig({ expression: '1', format: 'nonsense' })).toEqual({ expression: '1' })
  })

  it('the renderer (runtime and read-only views) shows the summed currency as $535.00', () => {
    const values = { expenses: [{ description: 'Flight', amount: 412.6 }, { description: 'Dinner', amount: 68.4 }, { description: 'Taxi', amount: 54 }] }
    const html = wrap(createElement(FormRenderer, { fields: FIELDS, values: { ...values, claim_total: 535 }, readOnly: true }))
    expect(html).toMatch(/data-label-field="claim_total"[\s\S]*?\$535\.00/)
  })
})

describe('InfoPath expression boxes keep their number format', () => {
  it('currency / number / percentage / date map to the Label format', () => {
    expect(labelFormatFromInfoPath('sum(my:items/my:amount)', 'currency', 'numDigits:2;negativeOrder:1;currencyLocale:1033;', 'USD')).toEqual({ kind: 'currency', currency: 'USD', decimals: 2 })
    expect(labelFormatFromInfoPath('xdFormatting:formatString(sum(my:a), "currency", "numDigits:2;currencyLocale:1033;")', undefined, undefined, 'USD')).toEqual({ kind: 'currency', currency: 'USD', decimals: 2 })
    expect(labelFormatFromInfoPath('my:a * 2', 'number', 'numDigits:auto;', 'USD')).toEqual({ kind: 'number' })
    expect(labelFormatFromInfoPath('my:a * 2', 'number', 'numDigits:3;', 'USD')).toEqual({ kind: 'number', decimals: 3 })
    expect(labelFormatFromInfoPath('my:a div my:b', 'percentage', 'numDigits:1;', 'USD')).toEqual({ kind: 'percent', percent_source: 'fraction', decimals: 1 })
    expect(labelFormatFromInfoPath('my:d', 'date', undefined)).toEqual({ kind: 'date' })
    expect(labelFormatFromInfoPath('concat(my:a, my:b)', undefined, undefined)).toBeNull()
  })
})

describe('List choice columns use the styled dropdown', () => {
  const CONFIG = normalizeListConfig({
    entry_mode: 'inline',
    columns: [
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'category', label: 'Category', type: 'choice', required: true, options: [{ value: 'travel', label: 'Travel' }, { value: 'meals', label: 'Meals' }] },
    ],
  })
  const category = CONFIG.columns.find((c) => c.key === 'category')!

  it('the pop-out form renders the AutocompleteSelect trigger with the option label, never a <select>', () => {
    const html = renderToStaticMarkup(createElement(RowFormFields, {
      mode: 'edit', config: CONFIG, row: { category: 'travel' }, columns: 2, idBase: 'rf',
      renderInput: (column: ListColumn, id: string) => createElement(ColumnInput, { column, value: column.key === 'category' ? 'travel' : '', id, onChange: () => {} }),
    }))
    expect(html).not.toMatch(/<select\b/)
    expect(html).toMatch(/<button[^>]*id="rf-f-category"[^>]*aria-haspopup="listbox"|<button[^>]*aria-haspopup="listbox"[^>]*id="rf-f-category"/)
    expect(html).toContain('data-list-choice="category"')
    expect(html).toContain('aria-labelledby="rf-f-category-label rf-f-category"')
    expect(html).toContain('Travel')
  })

  it('a required choice is not clearable; an optional one shows its placeholder', () => {
    const empty = renderToStaticMarkup(createElement(ColumnInput, { column: { ...category, required: false, placeholder: 'Pick one' }, value: null, id: 'c', onChange: () => {} }))
    expect(empty).toContain('Pick one')
    expect(empty).not.toMatch(/<select\b/)
  })

  it('inline List cells use it too', () => {
    const fields = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', list: CONFIG }])
    const html = wrap(createElement(FormRenderer, { fields, values: { expenses: [{ description: 'Flight', category: 'meals' }] }, onChange: () => {} }))
    expect(html).not.toMatch(/<select\b/)
    expect(html).toContain('data-list-choice="category"')
    expect(html).toContain('Meals')
  })
})
