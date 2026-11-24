import { describe, expect, it } from 'vitest'
import { analyzePdf } from '@/lib/importers/pdf/analyze'
import { PDF_IMPORT_LIMITS, openPdfForImport, PdfImportError } from '@/lib/importers/pdf/load'
import { makeAcroFormFixture, makeBlankFixture, makeFlatFixture, makeHybridFixture, makeManyFieldsFixture } from './fixtures/pdf-forms'

describe('PDF importer: fillable AcroForm', async () => {
  const a = await analyzePdf(await makeAcroFormFixture(), 'survey.pdf')
  const m = a.model
  const item = (id: string) => m.items.find((i) => i.id === id)!

  it('reads every field kind with options, formats and the PDF title', () => {
    expect(m.kind).toBe('acroform')
    expect(m.title).toBe('Vehicle and household survey')
    expect(item('dob')).toMatchObject({ type: 'date', label: 'Date of birth', question: '2' })
    expect(item('ownVehicle')).toMatchObject({ type: 'choice', display: 'radio', options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }] })
    expect(item('vehicleType')).toMatchObject({ type: 'choice', display: 'dropdown', options: [{ value: 'Car', label: 'Car' }, { value: 'Van', label: 'Van' }, { value: 'Motorbike', label: 'Motorbike' }] })
    expect(item('vehicleValue')).toMatchObject({ type: 'currency', currency: 'USD', min: 0, max: 1000000 })
    expect(item('comments').type).toBe('textarea')
    expect(item('hasPet').type).toBe('boolean')
    expect(item('total')).toMatchObject({ calc: { op: 'SUM', fields: ['vehicleValue', 'other'] }, readOnly: true })
  })

  it('takes labels by precedence: tooltip → nearby text → field name', () => {
    expect(item('comments')).toMatchObject({ label: 'Anything else you want to tell us', labelSource: 'tooltip' })
    expect(item('fullName')).toMatchObject({ label: 'Full name', labelSource: 'nearby_text', question: '1' })
    expect(item('Text12')).toMatchObject({ label: 'Text12', labelSource: 'field_name' })
  })

  it('infers required from an asterisk when the PDF flag is not set', () => {
    expect(item('fullName')).toMatchObject({ required: true, requiredSource: 'asterisk' })
    expect(item('dob').required).toBeUndefined()
  })

  it('merges split date boxes and Yes / No checkbox pairs', () => {
    expect(item('start_day')).toMatchObject({ type: 'date', label: '7. Start date', sourceFields: ['start_day', 'start_month', 'start_year'] })
    expect(m.items.some((i) => i.id === 'start_month')).toBe(false)
    expect(item('rent_yes')).toMatchObject({ type: 'choice', label: 'Do you rent your home?', options: [{ value: 'Yes', label: 'Yes' }, { value: 'No', label: 'No' }], sourceFields: ['rent_yes', 'rent_no'] })
  })

  it('translates show / hide scripts and printed routing into rules', () => {
    expect(m.rules).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'acrobat_js', confidence: 'high', mode: 'show', when: { item: 'ownVehicle', op: 'equals', value: 'Yes' }, targets: ['vehicleValue', 'vehicleType'] }),
      expect.objectContaining({ source: 'acrobat_js', confidence: 'high', mode: 'show', when: { item: 'hasPet', op: 'equals', value: 'true' }, targets: ['petName'] }),
      expect.objectContaining({ source: 'printed_text', confidence: 'high', mode: 'hide', when: { item: 'ownVehicle', op: 'equals', value: 'No' }, targets: ['vehicleType', 'vehicleValue'] }),
    ]))
  })

  it('keeps untranslated scripts for the report and leaves buttons out', () => {
    expect(item('total').untranslated?.[0]).toMatchObject({ event: 'Format', js: expect.stringContaining('util.printx') })
    expect(m.notes.join(' ')).toMatch(/PrintButton/)
  })

  it('never runs embedded JavaScript', async () => {
    const marker = '__pdfFixturePwned'
    const evil = await makeAcroFormFixture({ evilScript: `globalThis.${marker} = true; app.launchURL("https://example.com");` })
    const r = await analyzePdf(evil, 'evil.pdf')
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
    expect(r.model.items.find((i) => i.id === 'total')!.untranslated?.[0].js).toContain(marker)
  })
})

describe('PDF importer: hybrid XFA, flat and scanned PDFs', () => {
  it('uses the XFA captions, required flag and groups of a hybrid PDF', async () => {
    const m = (await analyzePdf(await makeHybridFixture(), 'w9.pdf')).model
    expect(m.kind).toBe('hybrid')
    expect(m.items[0]).toMatchObject({ label: '1 Name of entity/individual. An entry is required.', labelSource: 'xfa_caption', required: true, requiredSource: 'xfa' })
    expect(m.items[1]).toMatchObject({ label: '2 Business name', labelSource: 'xfa_caption' })
    const group = m.items.find((i) => i.type === 'choice')!
    expect(group).toMatchObject({ label: '3 Check the appropriate box for tax classification', options: [{ value: '1', label: 'Individual' }, { value: '2', label: 'Company' }, { value: '3', label: 'Trust' }] })
  })

  it('says a flat PDF has no fillable fields', async () => {
    const a = await analyzePdf(await makeFlatFixture(), 'paper.pdf')
    expect(a.model).toMatchObject({ kind: 'flat', items: [] })
    expect(a.model.notes[0]).toMatch(/no fillable fields/)
    expect(a.pages[0].lines.length).toBeGreaterThan(3)
  })

  it('says a PDF without text looks scanned', async () => {
    expect((await analyzePdf(await makeBlankFixture(2), 'scan.pdf')).model.kind).toBe('scanned')
  })
})

describe('PDF importer: limits', () => {
  it('refuses files that are not PDFs, too large or too long', async () => {
    await expect(openPdfForImport(new TextEncoder().encode('hello'))).rejects.toMatchObject({ code: 'not_pdf' })
    const big = await makeBlankFixture(1)
    await expect(openPdfForImport(big, { maxInputBytes: 100, maxPages: 10 })).rejects.toMatchObject({ code: 'limit' })
    await expect(openPdfForImport(await makeBlankFixture(3), { maxInputBytes: PDF_IMPORT_LIMITS.maxInputBytes, maxPages: 2 })).rejects.toBeInstanceOf(PdfImportError)
  })

  it('stops at the time budget with a clear error', async () => {
    const bytes = await makeManyFieldsFixture(120)
    const r = await analyzePdf(bytes, 'big.pdf', { maxInputBytes: PDF_IMPORT_LIMITS.maxInputBytes, maxPages: 60, timeoutMs: 1 }).catch((e: Error) => e)
    // Either the budget rejects the work, or the reader stops early and says so.
    expect(r instanceof Error ? r.message : r.warnings.join(' ')).toMatch(/took longer|too complex|only the first/)
    if (!(r instanceof Error)) expect(r.model.items.length).toBeLessThan(120)
  })

  it('caps the widgets read', async () => {
    const a = await analyzePdf(await makeManyFieldsFixture(60), 'many.pdf', { maxInputBytes: PDF_IMPORT_LIMITS.maxInputBytes, maxPages: 60, timeoutMs: 20_000, maxWidgets: 25 })
    expect(a.model.items.length).toBe(25)
    expect(a.warnings[0]).toMatch(/only the first/)
  })
})
