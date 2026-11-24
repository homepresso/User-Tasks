import { describe, expect, it } from 'vitest'
import { analyzePdf } from '@/lib/importers/pdf/analyze'
import { buildForms } from '@/lib/importers/pdf/build'
import { pdfReport } from '@/lib/importers/pdf/report'
import type { PdfFormModel, PdfItem } from '@/lib/importers/pdf/model'
import { alwaysRuleEffects, normalizeFormRules } from '@/lib/forms/form-rules'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { fieldDefinitionProblems, normalizeTaskFields } from '@/lib/task-field-schema'
import { validateFormContent } from '@/lib/services/forms'
import { importReportMarkdown } from '@/lib/importers/report'
import { makeAcroFormFixture, makeManyFieldsFixture } from './fixtures/pdf-forms'

const opts = { fileName: 'survey.pdf', hash: 'a'.repeat(64) }

describe('PDF importer: building forms', async () => {
  const a = await analyzePdf(await makeAcroFormFixture(), 'survey.pdf')
  const built = buildForms(a.model, opts)
  const form = built.forms[0]
  const key = (id: string) => form.keys[id]

  it('makes one valid form the forms service accepts', () => {
    expect(built.forms).toHaveLength(1)
    expect(fieldDefinitionProblems(form.fields)).toEqual({})
    expect(normalizeTaskFields(form.fields)).toHaveLength(form.fields.length)
    expect(normalizeFormRules(form.layout.rules)).toHaveLength(form.layout.rules!.length)
    expect(normalizeFormLayout(form.layout, form.fields.map((f) => f.key))).not.toBeNull()
    expect(() => validateFormContent({ fields: form.fields, layout: form.layout })).not.toThrow()
    expect(form.layout.source).toMatchObject({ kind: 'pdf', file_name: 'survey.pdf' })
    expect(form.tags).toEqual(['pdf'])
  })

  it('maps types, options, currency, bounds and required', () => {
    const f = (id: string) => form.fields.find((x) => x.key === key(id))!
    expect(f('fullName')).toMatchObject({ label: 'Full name', type: 'text', required: true })
    expect(f('ownVehicle')).toMatchObject({ type: 'choice', options: ['Yes', 'No'], display: 'radio' })
    expect(f('vehicleValue')).toMatchObject({ type: 'currency', currency: 'USD', min: 0, max: 1000000 })
    expect(f('total').help_text).toMatch(/Calculated in the PDF/)
  })

  it('makes rules that behave: show while Yes, hidden otherwise', () => {
    const enabled = form.layout.rules!.filter((r) => !r.disabled)
    expect(enabled.length).toBeGreaterThanOrEqual(3)
    const hiddenWhen = (values: Record<string, unknown>) => alwaysRuleEffects(form.layout, values).hidden
    expect(hiddenWhen({ [key('ownVehicle')]: 'Yes' }).has(`field:${key('vehicleValue')}`)).toBe(false)
    expect(hiddenWhen({ [key('ownVehicle')]: 'No' }).has(`field:${key('vehicleValue')}`)).toBe(true)
    expect(hiddenWhen({ [key('hasPet')]: true }).has(`field:${key('petName')}`)).toBe(false)
    expect(hiddenWhen({ [key('hasPet')]: false }).has(`field:${key('petName')}`)).toBe(true)
  })

  it('creates LOW confidence rules turned off with the original and the reason', () => {
    const m: PdfFormModel = { ...a.model, rules: [...a.model.rules, { id: 'low1', mode: 'hide', when: null, targets: [], confidence: 'low', source: 'printed_text', original: 'Otherwise, go to Part 3', reason: 'an "otherwise" jump', origin: 'deterministic' }] }
    const rule = buildForms(m, opts).forms[0].layout.rules!.find((r) => r.description?.includes('Otherwise, go to Part 3'))!
    expect(rule).toMatchObject({ disabled: true, event: 'always' })
    expect(rule.description).toMatch(/Turned off: an "otherwise" jump/)
    expect(rule.then[0]).toMatchObject({ type: 'message' })
  })

  it('puts pages in steps and splits a PDF over 200 fields into parts', async () => {
    const big = await analyzePdf(await makeManyFieldsFixture(260, 40), 'big.pdf')
    const b = buildForms(big.model, { ...opts, fileName: 'big.pdf' })
    expect(b.forms.map((f) => f.fields.length)).toEqual([200, 60])
    expect(b.forms[0].name).toMatch(/part 1 of 2/)
    expect(b.forms[0].layout.mode).toBe('steps')
    expect(b.forms[0].layout.pages).toHaveLength(5)
    const single = buildForms(big.model, { ...opts, pages: 'single' })
    expect(single.forms[0].layout.mode).toBeUndefined()
  })
})

describe('PDF importer: the mapping report', async () => {
  const a = await analyzePdf(await makeAcroFormFixture(), 'survey.pdf')
  const built = buildForms(a.model, opts)
  const report = pdfReport(a.model, built, { fileName: 'survey.pdf', warnings: [] })

  it('lists every field, rule, script and note with a status', () => {
    const fields = report.items.filter((i) => i.kind === 'field')
    expect(fields).toHaveLength(a.model.items.length)
    expect(fields.find((i) => i.name === 'Anything else you want to tell us')).toMatchObject({ status: 'mapped', detail: expect.stringContaining('tooltip') })
    expect(fields.find((i) => i.name === 'Text12')).toMatchObject({ status: 'partial', detail: expect.stringContaining('internal name') })
    expect(fields.find((i) => i.name === 'Full name')?.detail).toMatch(/asterisk/)
    expect(report.items.filter((i) => i.kind === 'rule').every((i) => i.status === 'mapped')).toBe(true)
    expect(report.items.find((i) => i.kind === 'script')).toMatchObject({ status: 'skipped', detail: expect.stringContaining('never run') })
    expect(report.items.find((i) => i.kind === 'note')).toMatchObject({ status: 'skipped' })
    expect(report.outputs).toEqual([expect.objectContaining({ kind: 'form', name: 'Vehicle and household survey' })])
  })

  it('marks AI items "AI — review" (also in Markdown)', () => {
    const aiItem: PdfItem = { ...a.model.items[0], id: 'x', origin: 'ai', labelSource: 'ai', label: 'From AI' }
    const r = pdfReport({ ...a.model, items: [...a.model.items, aiItem] }, buildForms({ ...a.model, items: [...a.model.items, aiItem] }, opts), { fileName: 'f.pdf', warnings: [], aiUsed: true })
    expect(r.items.find((i) => i.name === 'From AI')).toMatchObject({ status: 'partial', origin: 'ai' })
    expect(importReportMarkdown(r)).toContain('| AI — review | field | From AI')
  })

  it('reports a flat PDF as needing a rebuild, with nothing to make', () => {
    const flat: PdfFormModel = { title: 'Paper', kind: 'flat', pages: 1, sections: [], items: [], rules: [], notes: ['no fillable fields'] }
    const r = pdfReport(flat, buildForms(flat, opts), { fileName: 'p.pdf', warnings: [] })
    expect(r.readiness).toBe('rebuild')
    expect(r.outputs).toEqual([])
    expect(r.summary).toMatch(/no fillable fields/)
  })
})
