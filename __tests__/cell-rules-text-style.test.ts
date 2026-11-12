/**
 * Per-cell rules and text styling (InfoPath "Hide / Disable this control" on a
 * control inside a repeating table or section, and font size / family /
 * colour): style sanitisation (lib/forms/text-style.ts), List cell_rules judged
 * per row, whole-column hide rules (`column:<list>.<column>`), and the server
 * enforcement of locked cells / item controls (mergeTaskFieldValues).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormRenderer } from '@/components/forms/form-renderer'
import {
  colorFromCss, fontFromCss, normalizeControlTextStyle, normalizeTextColor, normalizeTextFont, normalizeTextSize, normalizeTextStyle,
  sizeFromCss, textColorCss, textSizeCss, textStyleProps, mergeStyleProps,
} from '@/lib/forms/text-style'
import { describeStyle, normalizeConditionalStyle, styleAttributes } from '@/lib/forms/conditional-style'
import { alwaysRuleEffects, ruleHiddenColumns, ruleHiddenFieldKeys } from '@/lib/forms/form-rules'
import { columnTarget, parseColumnTarget, parseTarget } from '@/lib/forms/form-state'
import { checkListValue, keepLockedListCells, listCellStates, listConfigProblem, listRowStyles, normalizeListConfig } from '@/lib/forms/list-field'
import { keepLockedItemValues, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { contrastRatio } from '@/lib/theme/colors'

const cond = (column: string, operator: string, value?: unknown) => ({ match: 'all', conditions: [{ column, operator, ...(value === undefined ? {} : { value }) }] })

describe('text style sanitisation', () => {
  it('keeps preset and px sizes within bounds only', () => {
    expect(normalizeTextSize('LG')).toBe('lg')
    expect(normalizeTextSize('14px')).toBe('14px')
    expect(normalizeTextSize('10.5px')).toBe('10.5px')
    expect(normalizeTextSize(13)).toBe('13px')
    expect(normalizeTextSize('7px')).toBeUndefined()
    expect(normalizeTextSize('49px')).toBeUndefined()
    expect(normalizeTextSize('1em')).toBeUndefined()
    expect(normalizeTextSize('12px; color: red')).toBeUndefined()
    expect(normalizeTextSize('calc(100vh)')).toBeUndefined()
    expect(textSizeCss('xl')).toBe('1.25rem')
    expect(textSizeCss('20px')).toBe('20px')
  })

  it('takes only curated font keys (or family names it maps)', () => {
    expect(normalizeTextFont('georgia')).toBe('georgia')
    expect(normalizeTextFont('Times New Roman')).toBe('times_new_roman')
    expect(normalizeTextFont('Comic Sans')).toBeUndefined()
    expect(normalizeTextFont('serif; } body { display:none')).toBeUndefined()
    expect(fontFromCss("'Segoe UI', sans-serif")).toBe('segoe_ui')
    expect(fontFromCss('Calibri')).toBe('calibri')
  })

  it('takes theme tokens and hex colours only', () => {
    expect(normalizeTextColor('danger')).toBe('danger')
    expect(normalizeTextColor('#ABC')).toBe('#aabbcc')
    expect(normalizeTextColor('#c00000')).toBe('#c00000')
    for (const bad of ['red', 'rgb(0,0,0)', 'var(--x)', 'url(javascript:alert(1))', '#12345', '#1234567', 'expression(alert(1))', '#fff;background:red']) expect(normalizeTextColor(bad)).toBeUndefined()
    expect(colorFromCss('windowtext')).toBeUndefined()
    expect(colorFromCss('#000000')).toBeUndefined()
    expect(colorFromCss('red')).toBe('#ff0000')
    expect(colorFromCss('rgb(0, 112, 192)')).toBe('#0070c0')
  })

  it('keeps hex colours legible in light and dark mode', () => {
    const yellow = textColorCss('#ffff00')!
    expect(contrastRatio(yellow.light, '#ffffff')!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(yellow.dark, '#18181b')!).toBeGreaterThanOrEqual(4.5)
    const navy = textColorCss('#000080')!
    expect(navy.light).toBe('#000080')
    expect(contrastRatio(navy.dark, '#0f172a')!).toBeGreaterThanOrEqual(4.5)
    expect(textColorCss('danger')).toEqual({ light: 'var(--theme-danger)', dark: 'var(--theme-danger)' })
  })

  it('normalises a control style and drops anything unknown', () => {
    expect(normalizeTextStyle({ size: 'lg', font: 'georgia', color: '#C00000', bold: true, italic: 'yes', weight: 900, css: 'x' })).toEqual({ size: 'lg', font: 'georgia', color: '#c00000', bold: true })
    expect(normalizeControlTextStyle({ label: { size: 'nope' }, value: { underline: true } })).toEqual({ value: { underline: true } })
    expect(normalizeControlTextStyle({ label: {} })).toBeUndefined()
  })

  it('draws through custom properties built from whitelisted values only', () => {
    const props = textStyleProps({ size: 'lg', font: 'courier_new', color: '#c00000', bold: true })
    expect(props['data-ts']).toBe('')
    expect(props['data-ts-bold']).toBe('')
    expect(props.style).toMatchObject({ '--ts-size': '1.125rem', '--ts-color-light': '#c00000' })
    expect(String(props.style!['--ts-font'])).toContain('Courier New')
    expect(textStyleProps({ size: 'bogus' } as any)).toEqual({})
    expect(mergeStyleProps({ 'data-a': '', style: { '--x': '1' } }, { style: { '--y': '2' } })).toEqual({ 'data-a': '', style: { '--x': '1', '--y': '2' } })
  })

  it('maps InfoPath CSS sizes', () => {
    expect(sizeFromCss('10pt')).toBe('13.5px')
    expect(sizeFromCss('14pt')).toBe('18.5px')
    expect(sizeFromCss('large')).toBe('lg')
    expect(sizeFromCss('100pt')).toBe('48px')
  })

  it('conditional styles take a size, font and colour (alone too)', () => {
    expect(normalizeConditionalStyle({ size: 'xl' })).toEqual({ size: 'xl' })
    expect(normalizeConditionalStyle({ tone: 'danger', color: '#00ff00', font: 'mono' })).toEqual({ tone: 'danger', color: '#00ff00', font: 'mono' })
    expect(normalizeConditionalStyle({ color: 'javascript:1' })).toBeNull()
    const attrs = styleAttributes({ size: '2xl', bold: true })
    expect(attrs['data-cs-size']).toBe('')
    expect(attrs.style).toMatchObject({ '--cs-size': '1.5rem' })
    expect(describeStyle({ size: 'lg', font: 'georgia' })).toContain('Georgia')
  })

  it('fields and List columns keep their text styles through normalisation', () => {
    const [f] = normalizeTaskFields([{ key: 'name', label: 'Name', type: 'text', text_style: { label: { bold: true, color: 'accent' }, value: { font: 'verdana', size: '12px', evil: 1 } } }])
    expect(f.text_style).toEqual({ label: { bold: true, color: 'accent' }, value: { font: 'verdana', size: '12px' } })
    const list = normalizeListConfig({ columns: [{ key: 'qty', label: 'Qty', type: 'number', text_style: { label: { size: 'sm' }, value: { color: '#000' } } }] })
    expect(list.columns[0].text_style).toEqual({ label: { size: 'sm' }, value: { color: '#000000' } })
  })
})

const LINES = normalizeListConfig({
  key_column: 'line_id',
  columns: [
    { key: 'line_id', label: 'Line', type: 'text' },
    { key: 'status', label: 'Status', type: 'choice', options: ['open', 'approved'] },
    { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true },
    { key: 'note', label: 'Note', type: 'text', required: true },
    { key: 'discount', label: 'Discount', type: 'number' },
  ],
  cell_rules: [
    { if: cond('row.status', 'equals', 'approved'), column: 'amount', read_only: true },
    { if: cond('row.status', 'equals', 'approved'), column: 'note', hide: true },
    { if: cond('form.locked_all', 'equals', true), column: 'discount', read_only: true },
    { if: cond('row.status', 'equals', 'x'), column: 'unknown', hide: true },
    { if: cond('row.status', 'equals', 'x'), column: 'amount' },
  ],
})

describe('List cell rules (per row)', () => {
  it('normalises: known columns with hide / read_only only', () => {
    expect(LINES.cell_rules).toHaveLength(3)
    expect(LINES.cell_rules![0]).toEqual({ if: expect.any(Object), column: 'amount', read_only: true })
    expect(normalizeListConfig({ columns: [{ key: 'a', label: 'A' }], cell_rules: [{ if: cond('row.a', 'is_set'), column: 'a', effect: 'hide' }] }).cell_rules).toEqual([{ if: expect.any(Object), column: 'a', hide: true }])
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', label: 'A' }], cell_rules: [{ if: cond('row.zzz', 'is_set'), column: 'a', hide: true }] }))).toMatch(/Cell rule/)
  })

  it('judges each row on its own values (plus the form)', () => {
    const approved = { line_id: '1', status: 'approved', amount: 10 }
    const open = { line_id: '2', status: 'open', amount: 20 }
    expect(listCellStates(LINES, approved, { form: {} })).toEqual({ hidden: { note: true }, locked: { amount: true } })
    expect(listCellStates(LINES, open, { form: {} })).toEqual({ hidden: {}, locked: {} })
    expect(listCellStates(LINES, open, { form: { locked_all: true } }).locked).toEqual({ discount: true })
    const styled = listRowStyles(LINES, approved, { form: {} })
    expect(styled.hidden).toEqual({ note: true })
    expect(styled.locked).toEqual({ amount: true })
  })

  it('a hidden cell is not checked; a locked cell is not required', () => {
    const rows = [{ line_id: '1', status: 'approved', amount: null, note: '' }, { line_id: '2', status: 'open', amount: null, note: '' }]
    const check = checkListValue(LINES, rows, false, 1, { form: {}, user: null })
    expect(check.rowErrors[0]).toBeUndefined()
    expect(check.rowErrors[1]).toEqual({ amount: 'Amount is required', note: 'Note is required' })
    // Hidden columns (a column: rule) are not checked in any row.
    expect(checkListValue(LINES, rows, false, 1, { form: {}, user: null, hiddenColumns: new Set(['amount', 'note']) }).errors).toEqual([])
  })

  it('keeps a locked cell of a row the form opened with (by key column)', () => {
    const stored = [{ line_id: '1', status: 'approved', amount: 10, note: 'n' }, { line_id: '2', status: 'open', amount: 20, note: 'n' }]
    const sent = [{ line_id: '1', status: 'approved', amount: 9999, note: 'n' }, { line_id: '2', status: 'open', amount: 25, note: 'n' }, { line_id: '3', status: 'approved', amount: 5, note: 'n' }]
    const kept = keepLockedListCells(LINES, sent, stored, { form: {}, storedForm: {}, user: null })
    expect((kept.rows as any[]).map((r) => r.amount)).toEqual([10, 25, 5])
    expect(kept.restored).toEqual(['amount'])
  })

  it('unlocking first (an editable condition) lets the change through', () => {
    const stored = [{ line_id: '1', status: 'approved', amount: 10, note: 'n' }]
    const sent = [{ line_id: '1', status: 'open', amount: 50, note: 'n' }]
    expect((keepLockedListCells(LINES, sent, stored, { form: {}, storedForm: {} }).rows as any[])[0].amount).toBe(50)
  })

  it('without a key column, rows match by position only while the count is unchanged', () => {
    const cfg = normalizeListConfig({ ...LINES, key_column: undefined })
    const stored = [{ status: 'approved', amount: 10, note: 'n' }]
    expect((keepLockedListCells(cfg, [{ status: 'approved', amount: 99, note: 'n' }], stored, {}).rows as any[])[0].amount).toBe(10)
    expect((keepLockedListCells(cfg, [{ status: 'approved', amount: 99, note: 'n' }, { status: 'open', amount: 1, note: 'n' }], stored, {}).rows as any[])[0].amount).toBe(99)
  })

  it('mergeTaskFieldValues enforces locked cells on submit and on drafts; the stored shape is unchanged', () => {
    const fields = [{ key: 'lines', label: 'Lines', type: 'list', list: LINES }]
    const stored = [{ line_id: '1', status: 'approved', amount: 10, note: 'n', discount: null }]
    const meta = { fields, template_values: { lines: stored } }
    for (const partial of [false, true]) {
      const { errors, templateValues } = mergeTaskFieldValues(meta as any, { lines: [{ line_id: '1', status: 'approved', amount: 1, note: 'changed', discount: null }] }, { partial })
      expect(errors).toEqual({})
      expect((templateValues.lines as any[])[0]).toEqual({ line_id: '1', status: 'approved', amount: 10, note: 'changed', discount: null })
    }
    // Rule-wide locks read the form: locked as stored and as submitted.
    const locked = mergeTaskFieldValues({ fields: [...fields, { key: 'locked_all', label: 'Lock', type: 'boolean' }], template_values: { lines: stored, locked_all: true } } as any,
      { lines: [{ line_id: '1', status: 'open', amount: 1, note: 'x', discount: 7 }], locked_all: true })
    expect((locked.templateValues.lines as any[])[0]).toMatchObject({ amount: 1, discount: null })
  })

  it('a column a form rule writes is left as sent', () => {
    const fields = [{ key: 'lines', label: 'Lines', type: 'list', list: LINES }]
    const layout = { rows: [], rules: [{ id: 'r1', event: 'value_change', target: 'lines', then: [{ type: 'set_row_values', field: 'lines', row: 'current', values: { amount: '1' } }] }] }
    const stored = [{ line_id: '1', status: 'approved', amount: 10, note: 'n' }]
    const out = mergeTaskFieldValues({ fields, form_layout: layout, template_values: { lines: stored } } as any, { lines: [{ line_id: '1', status: 'approved', amount: 3, note: 'n' }] })
    expect((out.templateValues.lines as any[])[0].amount).toBe(3)
  })
})

describe('whole-column hide rules', () => {
  const layout = {
    rows: [{ columns: 1, cells: [{ field_key: 'customer_type', span: 1 }] }, { columns: 1, cells: [{ field_key: 'lines', span: 1 }] }],
    rules: [{ id: 'r1', event: 'always', if: cond('customer_type', 'equals', 'Retail'), then: [{ type: 'show_hide', mode: 'hide', targets: ['column:lines.discount', 'column:trips.cost'] }] }],
  }

  it('parses column targets', () => {
    expect(parseTarget('column:lines.discount')).toEqual({ kind: 'column', id: 'lines.discount' })
    expect(parseColumnTarget(columnTarget('lines', 'discount'))).toEqual({ field: 'lines', column: 'discount' })
    expect(parseTarget('column:lines')).toBeNull()
    expect(parseTarget('column:a.b.c')).toBeNull()
  })

  it('hides the column while the condition holds (no form field hidden)', () => {
    expect(ruleHiddenColumns(layout, { customer_type: 'Retail' })).toEqual(new Map([['lines', new Set(['discount'])], ['trips', new Set(['cost'])]]))
    expect(ruleHiddenColumns(layout, { customer_type: 'Trade' }).size).toBe(0)
    expect(alwaysRuleEffects(layout, { customer_type: 'Retail' }).hidden.has('column:lines.discount')).toBe(true)
    expect(ruleHiddenFieldKeys(layout, [{ key: 'lines', type: 'list' }], { customer_type: 'Retail' }).size).toBe(0)
  })

  it('server: a hidden column / inner control is not required; its values are kept', () => {
    const fields = normalizeTaskFields([
      { key: 'customer_type', label: 'Customer type', type: 'choice', options: ['Retail', 'Trade'] },
      { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'item', label: 'Item' }, { key: 'discount', label: 'Discount', type: 'number', required: true }] } },
      { key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: { fields: [{ key: 'where', label: 'Where', type: 'text' }, { key: 'cost', label: 'Cost', type: 'currency', required: true }] } },
    ])
    const values = { customer_type: 'Retail', lines: [{ item: 'Desk', discount: null }], trips: [{ where: 'Paris', cost: null }] }
    expect(validateTaskFieldValues(fields, values, { layout })).toEqual({})
    const trade = validateTaskFieldValues(fields, { ...values, customer_type: 'Trade' }, { layout })
    expect(Object.keys(trade).sort()).toEqual(['lines', 'trips', 'trips[0].cost'])
    const { templateValues } = mergeTaskFieldValues({ fields, form_layout: layout, template_values: {} } as any, { ...values, lines: [{ item: 'Desk', discount: 5 }] })
    expect((templateValues.lines as any[])[0]).toEqual({ item: 'Desk', discount: 5 })
  })
})

describe('repeating section item locks (server)', () => {
  const section = {
    key_field: 'ref',
    fields: [{ key: 'ref', label: 'Ref', type: 'text' }, { key: 'state', label: 'State', type: 'text' }, { key: 'cost', label: 'Cost', type: 'currency' }],
    layout: { rows: [], rules: [{ id: 'r1', event: 'always', if: cond('item.state', 'equals', 'closed'), then: [{ type: 'read_only', mode: 'read_only', targets: ['field:cost'] }] }] },
  }
  const [field] = normalizeTaskFields([{ key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: section }])

  it('keeps the stored value of a control an item rule locks', () => {
    expect(field.repeating_section!.key_field).toBe('ref')
    const stored = [{ ref: 'a', state: 'closed', cost: 100 }, { ref: 'b', state: 'open', cost: 5 }]
    const sent = [{ ref: 'b', state: 'open', cost: 6 }, { ref: 'a', state: 'closed', cost: 1 }]
    const kept = keepLockedItemValues(field.repeating_section, sent, stored, {})
    expect((kept.rows as any[]).map((r) => r.cost)).toEqual([6, 100])
    const { templateValues } = mergeTaskFieldValues({ fields: [field], template_values: { trips: stored } } as any, { trips: sent })
    expect((templateValues.trips as any[]).map((r) => r.cost)).toEqual([6, 100])
  })

  it('without a key field, only a section that cannot be reordered is matched by position', () => {
    const [loose] = normalizeTaskFields([{ key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: { ...section, key_field: undefined } }])
    const [fixed] = normalizeTaskFields([{ key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: { ...section, key_field: undefined, allow_reorder: false } }])
    const stored = [{ ref: 'a', state: 'closed', cost: 100 }]
    const sent = [{ ref: 'a', state: 'closed', cost: 1 }]
    expect((keepLockedItemValues(loose.repeating_section, sent, stored, {}).rows as any[])[0].cost).toBe(1)
    expect((keepLockedItemValues(fixed.repeating_section, sent, stored, {}).rows as any[])[0].cost).toBe(100)
  })
})

describe('renderer', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const fields = normalizeTaskFields([
    { key: 'customer_type', label: 'Customer type', type: 'choice', options: ['Retail', 'Trade'], text_style: { label: { bold: true, font: 'georgia' }, value: { size: 'lg' } } },
    { key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, display: 'table' } },
  ])
  const layout = { rows: [{ columns: 1, cells: [{ field_key: 'customer_type', span: 1 }] }, { columns: 1, cells: [{ field_key: 'lines', span: 1 }] }], rules: [{ id: 'r1', event: 'always', if: cond('customer_type', 'equals', 'Retail'), then: [{ type: 'show_hide', mode: 'hide', targets: ['column:lines.discount'] }] }] }
  const rows = [{ line_id: '1', status: 'approved', amount: 10, note: 'secret', discount: 3 }, { line_id: '2', status: 'open', amount: 20, note: 'shown', discount: 4 }]

  it('draws text styles, empties a hidden cell and hides a whole column', () => {
    const retail = wrap(createElement(FormRenderer, { fields, layout: layout as any, values: { customer_type: 'Retail', lines: rows }, readOnly: true }))
    expect(retail).toContain('data-ts-bold')
    expect(retail).toContain('--ts-size:1.125rem')
    expect(retail).toContain('data-list-hidden-cell="note"')
    expect(retail).not.toContain('secret')
    expect(retail).toContain('shown')
    expect(retail).not.toContain('>Discount<')
    const trade = wrap(createElement(FormRenderer, { fields, layout: layout as any, values: { customer_type: 'Trade', lines: rows }, readOnly: true }))
    expect(trade).toContain('>Discount<')
  })

  it('locks a cell in an editable table', () => {
    const editable = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, entry_mode: 'inline', display: 'table', row_editing: 'inline' } }])
    const html = wrap(createElement(FormRenderer, { fields: editable, values: { lines: rows }, onChange: () => {} }))
    expect(html).toContain('data-list-readonly="amount"')
    expect((html.match(/data-list-readonly="amount"/g) ?? []).length).toBe(1)
    expect(html).toContain('data-list-hidden-cell="note"')
  })
})
