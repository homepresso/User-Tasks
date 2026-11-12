/**
 * InfoPath → per-cell rules and text styles (lib/infopath/view.ts, generate.ts):
 * inline fonts / sizes / colours from the view become field and List column
 * text styles (the view's usual font and size left to the theme); conditional
 * formatting on a control in a repeating table becomes a List cell rule (hide /
 * read only per row) or, on a form condition, a whole-column hide; conditional
 * font sizes become set_style sizes. Built from the expense-report fixture with
 * an edited view.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { analyzeInfoPath } from '@/lib/infopath/analyze'
import { generateForms } from '@/lib/infopath/generate'
import { publicInfoPathSummary } from '@/lib/infopath/public-summary'
import { validateFormContent } from '@/lib/services/forms'
import { listCellStates } from '@/lib/forms/list-field'
import { ruleHiddenColumns } from '@/lib/forms/form-rules'
import { fixtureFiles } from './helpers/infopath-fixtures'
import { writeCab } from './helpers/cab-writer'

function styledXsn(): Buffer {
  const files = fixtureFiles('expense-report').map((f) => {
    if (f.name !== 'view1.xsl') return f
    let xsl = f.data.toString('utf8')
    // The usual font everywhere (dropped), one control in Georgia 14pt red with a blue Georgia label.
    xsl = xsl.replace(/style="WIDTH: 100%"/g, 'style="WIDTH: 100%; FONT-FAMILY: Calibri; FONT-SIZE: 10pt"')
    xsl = xsl.replace('<td><div>Department:</div>', '<td><div><font face="Georgia" color="#0070c0">Department:</font></div>')
    xsl = xsl.replace('xd:binding="my:department" xd:boundProp="value" style="WIDTH: 100%; FONT-FAMILY: Calibri; FONT-SIZE: 10pt"', 'xd:binding="my:department" xd:boundProp="value" style="WIDTH: 100%; FONT-FAMILY: Georgia; FONT-SIZE: 14pt; COLOR: #c00000; FONT-WEIGHT: bold"')
    // Per row: Description hidden in Meals rows, Qty locked in Lodging rows.
    xsl = xsl.replace(/(xd:CtrlId="CTRL10"[^>]*>)/, '$1<xsl:attribute name="style">WIDTH: 100%;<xsl:choose><xsl:when test="my:category = &quot;Meals&quot;">DISPLAY: none</xsl:when></xsl:choose></xsl:attribute>')
    xsl = xsl.replace(/(xd:CtrlId="CTRL12"[^>]*>)/, '$1<xsl:attribute name="xd:disableEditing"><xsl:choose><xsl:when test="my:category = &quot;Lodging&quot;">yes</xsl:when></xsl:choose></xsl:attribute>')
    // A form condition on a cell control (Unit price) and on a header cell (Category): whole columns.
    xsl = xsl.replace(/(xd:CtrlId="CTRL13"[^>]*>)/, '$1<xsl:attribute name="style">WIDTH: 100%;<xsl:choose><xsl:when test="../../my:department = &quot;Sales&quot;">DISPLAY: none</xsl:when></xsl:choose></xsl:attribute>')
    xsl = xsl.replace('<td><div><strong>Category</strong></div></td>', '<td><div><xsl:attribute name="style"><xsl:choose><xsl:when test="my:department = &quot;Engineering&quot;">DISPLAY: none</xsl:when></xsl:choose></xsl:attribute><strong>Category</strong></div></td>')
    xsl = xsl.replace('<td><div><strong>Qty</strong></div></td>', '<td><div><font color="#7030a0"><strong>Qty</strong></font></div></td>')
    // A conditional font size.
    xsl = xsl.replace('COLOR: #008000;caption: Green when submitted', 'COLOR: #008000; FONT-SIZE: 14pt;caption: Green when submitted')
    return { name: f.name, data: Buffer.from(xsl, 'utf8') }
  })
  return writeCab(files, 'mszip', { blockSize: 4096 })
}

describe('InfoPath fonts and per-cell formatting', () => {
  const model = analyzeInfoPath(styledXsn(), { fileName: 'Expense Report.xsn' })
  const { forms, report } = generateForms(model, { now: '2026-11-11T00:00:00.000Z' })
  const form = forms[0]
  const fields = form.input.fields as any[]
  const list = fields.find((f) => f.type === 'list')
  const col = (k: string) => list.list.columns.find((c: any) => c.key === k)

  it('is a valid form', () => {
    expect(() => validateFormContent({ fields: form.input.fields, layout: form.input.layout })).not.toThrow()
  })

  it('maps inline fonts to text styles and leaves the usual font to the theme', () => {
    expect(fields.find((f) => f.key === 'department').text_style).toEqual({ label: { font: 'georgia', color: '#0070c0' }, value: { size: '18.5px', font: 'georgia', color: '#c00000', bold: true } })
    expect(fields.find((f) => f.key === 'employee_name').text_style).toBeUndefined()
    expect(col('quantity').text_style).toEqual({ label: { color: '#7030a0', bold: true } })
    expect(report.items.find((i) => i.id.startsWith('fonts:'))).toMatchObject({ status: 'converted', detail: expect.stringContaining('Font styles') })
  })

  it('maps per-row hide / disable on a cell to List cell rules, judged per row', () => {
    expect(list.list.cell_rules).toEqual([
      { if: { match: 'all', conditions: [{ column: 'row.category', operator: 'eq', value: 'Meals' }] }, column: 'description', hide: true },
      { if: { match: 'all', conditions: [{ column: 'row.category', operator: 'eq', value: 'Lodging' }] }, column: 'quantity', read_only: true },
    ])
    expect(listCellStates(list.list, { category: 'Meals' }, { form: {} })).toEqual({ hidden: { description: true }, locked: {} })
    expect(listCellStates(list.list, { category: 'Lodging' }, { form: {} })).toEqual({ hidden: {}, locked: { quantity: true } })
    expect(report.items.filter((i) => i.area === 'formatting' && /Cell rule/.test(i.detail))).toHaveLength(2)
  })

  it('maps a form condition on a cell control or a header cell to a whole-column hide', () => {
    const rules = (form.input.layout.rules ?? []).filter((r: any) => r.name.startsWith('Hide column:'))
    expect(rules.map((r: any) => r.then[0].targets[0]).sort()).toEqual([`column:${list.key}.category`, `column:${list.key}.unit_price`])
    expect(ruleHiddenColumns(form.input.layout, { department: 'Sales' }).get(list.key)).toEqual(new Set(['unit_price']))
    expect(ruleHiddenColumns(form.input.layout, { department: 'Engineering' }).get(list.key)).toEqual(new Set(['category']))
  })

  it('maps a conditional font size into set_style', () => {
    const style = (form.input.layout.rules ?? []).find((r: any) => r.name === 'Style: Status (Green when submitted)')
    expect(style?.then[0]).toMatchObject({ type: 'set_style', style: { tone: 'success', text: true, size: '18.5px' } })
  })

  it('the public summary counts them and the preview keeps the column rule', () => {
    const summary = publicInfoPathSummary(new Uint8Array(styledXsn()), 'Expense Report.xsn')
    const keys = summary.features.map((f: any) => f.key)
    expect(keys).toEqual(expect.arrayContaining(['cell_rules', 'column_rules', 'text_styles']))
    expect(JSON.stringify(summary.preview!.layout.rules ?? [])).toContain(`column:${list.key}.unit_price`)
  })
})

describe('InfoPath fonts that Google Fonts has', () => {
  function googleXsn(): Buffer {
    const files = fixtureFiles('expense-report').map((f) => {
      if (f.name !== 'view1.xsl') return f
      let xsl = f.data.toString('utf8')
      xsl = xsl.replace(/style="WIDTH: 100%"/g, 'style="WIDTH: 100%; FONT-FAMILY: Calibri; FONT-SIZE: 10pt"')
      // Open Sans (on Google Fonts) on the Department label; Wingdings (nowhere) on its value.
      xsl = xsl.replace('<td><div>Department:</div>', '<td><div><font face="Open Sans">Department:</font></div>')
      xsl = xsl.replace('xd:binding="my:department" xd:boundProp="value" style="WIDTH: 100%; FONT-FAMILY: Calibri; FONT-SIZE: 10pt"', 'xd:binding="my:department" xd:boundProp="value" style="WIDTH: 100%; FONT-FAMILY: Wingdings; COLOR: #c00000"')
      return { name: f.name, data: Buffer.from(xsl, 'utf8') }
    })
    return writeCab(files, 'mszip', { blockSize: 4096 })
  }
  const xsn = googleXsn()
  const { forms, report } = generateForms(analyzeInfoPath(xsn, { fileName: 'Expense Report.xsn' }), { now: '2026-11-11T00:00:00.000Z' })
  const fields = forms[0].input.fields as any[]

  it('maps the font to that Google family (a valid form) and names unavailable fonts in the report', () => {
    expect(fields.find((f) => f.key === 'department').text_style).toEqual({ label: { font: 'google:Open Sans' }, value: { color: '#c00000' } })
    expect(() => validateFormContent({ fields: forms[0].input.fields, layout: forms[0].input.layout })).not.toThrow()
    const item = report.items.find((i) => i.id.startsWith('fonts:'))!
    expect(item.detail).toContain('Google Fonts used (served from this site): Open Sans')
    expect(item.detail).toContain('not available, so the theme font is used instead: Wingdings')
  })

  it('the public summary lists the Google fonts', () => {
    const summary = publicInfoPathSummary(new Uint8Array(xsn), 'Expense Report.xsn')
    expect(summary.features.find((f: any) => f.key === 'google_fonts')).toMatchObject({ count: 1, items: ['Open Sans'] })
  })
})
