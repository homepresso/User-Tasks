import { describe, expect, it } from 'vitest'
import { analyzePdf } from '@/lib/importers/pdf/analyze'
import { buildForms } from '@/lib/importers/pdf/build'
import { pdfReport } from '@/lib/importers/pdf/report'
import { pdfOptions } from '@/lib/importers/pdf/importer'
import { genericRowLabel, headerText, pluralize } from '@/lib/importers/pdf/tables'
import { cleanLabel, humanizeFieldName } from '@/lib/importers/pdf/model'
import { tidyTooltip } from '@/lib/importers/pdf/infer'
import { parseXfaTemplate } from '@/lib/importers/pdf/xfa'
import { modelFromXfa } from '@/lib/importers/pdf/xfa-model'
import { evaluateLabelExpression, labelScope } from '@/lib/forms/label-field'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { fieldDefinitionProblems, normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { validateFormContent } from '@/lib/services/forms'
import {
  makeExpensesFixture, makeNamedGridFixture, makeRoomingListFixture, makeSingleColumnFixture, makeTransposedFixture, makeTwoColumnFormFixture, makeTwoPageTableFixture,
} from './fixtures/pdf-tables'

const opts = { fileName: 'form.pdf', hash: 'a'.repeat(64) }
const section = (fields: TaskFieldDef[]) => fields.find((f) => f.type === 'repeating_section')!

describe('PDF importer: tables become repeating lists', async () => {
  const rooming = await analyzePdf(await makeRoomingListFixture(), 'Hotel_Rooming_List.pdf')

  it('finds the 16 × 6 rooming list with header labels, typed columns and generic row labels', () => {
    const tables = rooming.model.tables ?? []
    expect(tables).toHaveLength(1)
    const t = tables[0]
    expect(t).toMatchObject({ name: 'Rooms', rows: 16, maxRows: 16, rowLabelMode: 'generic', noun: 'Room', pages: [1] })
    expect(t.columns.map((c) => [c.label, c.type, c.labelSource])).toEqual([
      ['Name 1', 'text', 'header'], ['Name 2', 'text', 'header'], ['Name 3', 'text', 'header'], ['Name 4', 'text', 'header'],
      ['Bed Type', 'choice', 'header'], ['Special Requests/Notes', 'text', 'header'],
    ])
    expect(t.itemIds).toHaveLength(96)
  })

  it('builds ONE repeating section (max 16 rows, starts with 1) beside the header fields', () => {
    const form = buildForms(rooming.model, opts).forms[0]
    expect(form.fields.filter((f) => f.type !== 'repeating_section').map((f) => f.key).sort()).toEqual(['arrival_date', 'contact_name', 'group_name'])
    expect(form.fields).toHaveLength(4)
    const rooms = section(form.fields)
    expect(rooms).toMatchObject({ key: 'rooms', label: 'Rooms' })
    const config = rooms.repeating_section!
    expect(config).toMatchObject({ max_items: 16, start_items: 1, item_title: 'Room {{index}}', add_label: 'Add room' })
    expect(config.fields.map((f) => [f.key, f.label, f.type])).toEqual([
      ['name_1', 'Name 1', 'text'], ['name_2', 'Name 2', 'text'], ['name_3', 'Name 3', 'text'], ['name_4', 'Name 4', 'text'],
      ['bed_type', 'Bed Type', 'choice'], ['special_requests_notes', 'Special Requests/Notes', 'text'],
    ])
    expect(config.fields.find((f) => f.key === 'bed_type')).toMatchObject({ options: ['Two Queens', 'Single King'], display: 'dropdown' })
    // The forms service takes it as it is.
    expect(fieldDefinitionProblems(form.fields)).toEqual({})
    expect(normalizeTaskFields(form.fields).find((f) => f.key === 'rooms')?.repeating_section?.fields).toHaveLength(6)
    expect(normalizeFormLayout(form.layout, form.fields.map((f) => f.key))).not.toBeNull()
    expect(() => validateFormContent({ fields: form.fields, layout: form.layout })).not.toThrow()
    // The list is alone on its layout row.
    const rows = form.layout.rows.length ? form.layout.rows : form.layout.pages!.flatMap((p) => p.rows)
    expect(rows.find((r) => r.cells.some((c) => c.field_key === 'rooms'))!.cells).toHaveLength(1)
  })

  it('never labels a field with a bare number or a field-name fragment', () => {
    const labels = rooming.model.items.map((i) => i.label)
    expect(labels.some((l) => /^\d+$/.test(l))).toBe(false)
    expect(labels.some((l) => /_1$/.test(l))).toBe(false)
    expect(rooming.model.items.find((i) => i.id === 'Name 1.1.2')).toMatchObject({ label: 'Name 3 (Room #2)', labelSource: 'table_header' })
  })

  it('keeps a table as separate, readable fields when asked (per table or all)', () => {
    for (const o of [{ tables: false }, { keepTables: ['table_1'] }]) {
      const form = buildForms(rooming.model, { ...opts, ...o }).forms[0]
      expect(form.fields).toHaveLength(99)
      expect(form.fields.some((f) => f.type === 'repeating_section')).toBe(false)
      expect(form.fields.find((f) => f.label === 'Bed Type (Room #4)')).toMatchObject({ type: 'choice' })
    }
  })

  it('allows unlimited rows (the repeating section cap) with the option', () => {
    expect(section(buildForms(rooming.model, { ...opts, tableRows: 'unlimited' }).forms[0].fields).repeating_section!.max_items).toBe(200)
  })

  it('reports the table, its columns (where their labels came from) and the fields it absorbed', () => {
    const built = buildForms(rooming.model, opts)
    const report = pdfReport(rooming.model, built, { fileName: 'Hotel_Rooming_List.pdf', warnings: [] })
    const t = report.items.find((i) => i.kind === 'table')!
    expect(t).toMatchObject({ name: 'Rooms', status: 'mapped', mappedTo: expect.stringContaining('Repeating section "rooms"') })
    expect(t.detail).toContain('"Bed Type" (single choice, label from the header)')
    expect(t.detail).toContain('Name 1.0.0')
    expect(t.detail).toMatch(/absorbs 96 PDF fields/)
    expect(report.items.filter((i) => i.kind === 'field')).toHaveLength(3)
    expect(report.summary).toMatch(/^4 fields \(3 single fields and 1 repeating list in place of 96 table boxes\)/)
  })

  it('takes "required" only from the PDF\'s Required flag (no false positive on the header fields)', () => {
    const item = (id: string) => rooming.model.items.find((i) => i.id === id)!
    expect(item('Group Name')).toMatchObject({ required: true, requiredSource: 'flag' })
    expect(item('Contact Name').required).toBeUndefined()
    expect(item('Arrival Date').required).toBeUndefined()
    expect(item('Contact Name').label).toBe('Contact Name')
  })

  it('aims a rule that hides a whole column at the list\'s column; one that hides a single box is turned off with a note', async () => {
    const column = await analyzePdf(await makeRoomingListFixture({ hideScript: 'column' }), 'r.pdf')
    const b1 = buildForms(column.model, opts)
    const rule = b1.forms[0].layout.rules!.find((r) => r.then.some((a) => (a as { targets?: string[] }).targets?.includes('column:rooms.bed_type')))
    expect(rule).toBeDefined()
    expect(rule!.disabled).toBeUndefined()
    expect(b1.remapped).toHaveLength(1)
    const cell = await analyzePdf(await makeRoomingListFixture({ hideScript: 'cell' }), 'r.pdf')
    const b2 = buildForms(cell.model, opts)
    expect(b2.forms[0].layout.rules!.every((r) => r.disabled)).toBe(true)
    expect(b2.dropped[0].why).toMatch(/single boxes of the table "Rooms"/)
    const report = pdfReport(cell.model, b2, { fileName: 'r.pdf', warnings: [] })
    expect(report.items.find((i) => i.kind === 'rule')!.detail).toMatch(/turned off — it shows \/ hides single boxes/)
  })
})

describe('PDF importer: table variants', () => {
  it.each(['rowcol', 'sequential', 'suffix', 'brackets'] as const)('finds a grid whose field names follow the %s pattern', async (pattern) => {
    const m = (await analyzePdf(await makeNamedGridFixture(pattern), 'order.pdf')).model
    expect(m.tables).toHaveLength(1)
    expect(m.tables![0]).toMatchObject({ rows: 5, rowLabelMode: 'none' })
    expect(m.tables![0].columns.map((c) => c.label)).toEqual(['Item', 'Quantity', 'Colour'])
    const built = buildForms(m, opts).forms[0]
    expect(built.fields).toHaveLength(1)
    expect(section(built.fields).repeating_section).toMatchObject({ max_items: 5, start_items: 1 })
  })

  it('turns a SUM of a column into a calculated total over the list', async () => {
    const m = (await analyzePdf(await makeExpensesFixture(), 'claim.pdf')).model
    const t = m.tables![0]
    expect(t.columns.map((c) => [c.label, c.type])).toEqual([['Description', 'text'], ['Amount', 'currency']])
    expect(t.totals).toEqual([{ item: 'total', column: 1 }])
    const form = buildForms(m, opts).forms[0]
    const list = section(form.fields)
    const total = form.fields.find((f) => f.key === form.keys.total)!
    expect(total).toMatchObject({ type: 'label', label_config: { expression: `SUM({{form.${list.key}}}, "amount")`, include: true, format: { kind: 'currency', currency: 'USD' } } })
    expect(fieldDefinitionProblems(form.fields)).toEqual({})
    // The formula adds up the list's column.
    const values = { [list.key]: [{ description: 'Taxi', amount: 12.5 }, { description: 'Hotel', amount: 100 }] }
    expect(evaluateLabelExpression(total.label_config!.expression, labelScope(form.fields, values)).value).toBe(112.5)
    expect(form.fields.map((f) => f.key)).toEqual(['your_name', list.key, total.key])
  })

  it('finds a numbered list of one field', async () => {
    const m = (await analyzePdf(await makeSingleColumnFixture(), 'signup.pdf')).model
    expect(m.tables).toHaveLength(1)
    expect(m.tables![0]).toMatchObject({ rows: 6, rowLabelMode: 'generic', columns: [{ label: 'Attendee name', type: 'text' }] })
    const list = section(buildForms(m, opts).forms[0].fields)
    expect(list.label).toBe('Attendee name list')
  })

  it('joins a table continued on the next page', async () => {
    const m = (await analyzePdf(await makeTwoPageTableFixture(), 'inventory.pdf')).model
    expect(m.tables).toHaveLength(1)
    expect(m.tables![0]).toMatchObject({ pages: [1, 2], rows: 18 })
    expect(m.tables![0].columns.map((c) => [c.label, c.type])).toEqual([['Item', 'text'], ['Serial number', 'text'], ['Purchased', 'date']])
    const built = buildForms(m, opts).forms[0]
    expect(built.fields).toHaveLength(1)
    expect(section(built.fields).repeating_section!.max_items).toBe(18)
  })

  it('turns round a table whose columns are the entries (Dependent 1 … over First name / Last name …)', async () => {
    const m = (await analyzePdf(await makeTransposedFixture(), '1040.pdf')).model
    expect(m.tables).toHaveLength(1)
    expect(m.tables![0]).toMatchObject({ name: 'Dependents', rows: 4, noun: 'Dependent' })
    expect(m.tables![0].columns.map((c) => c.label)).toEqual(['First name', 'Last name', 'SSN', 'Relationship'])
  })

  it('finds no table in a normal form (side-by-side boxes, stacked labelled boxes)', async () => {
    const m = (await analyzePdf(await makeTwoColumnFormFixture(), 'contact.pdf')).model
    expect(m.tables ?? []).toEqual([])
    expect(buildForms(m, opts).forms[0].fields).toHaveLength(12)
  })

  it('reads the import options (tables on by default, kept tables, rows)', () => {
    expect(pdfOptions({})).toMatchObject({ tables: true, keepTables: [], tableRows: 'pdf' })
    expect(pdfOptions({ tables: false, keep_tables: 'table_2, table_x, table_10', table_rows: 'unlimited' })).toMatchObject({ tables: false, keepTables: ['table_2', 'table_10'], tableRows: 'unlimited' })
    expect(pdfOptions({ tables: 'true', keep_tables: ['table_1'] })).toMatchObject({ tables: true, keepTables: ['table_1'] })
  })
})

describe('PDF importer: XFA repeating subforms', () => {
  it('builds a repeating subform as a repeating list (occur max = rows)', () => {
    const xml = `<template><subform name="form1"><subform name="Page1">
      <field name="Applicant"><caption><value><text>Applicant name</text></value></caption><ui><textEdit/></ui></field>
      <subform name="Children"><draw><value><text>Children</text></value></draw>
        <subform name="Child"><occur min="1" max="8"/>
          <field name="ChildName"><caption><value><text>Name</text></value></caption><ui><textEdit/></ui><validate nullTest="error"/></field>
          <field name="ChildDob"><caption><value><text>Date of birth</text></value></caption><ui><dateTimeEdit/></ui></field>
        </subform>
      </subform>
    </subform></subform></template>`
    const m = modelFromXfa(parseXfaTemplate(xml), 'Family')
    expect(m.tables).toHaveLength(1)
    expect(m.tables![0]).toMatchObject({ source: 'xfa', maxRows: 8, columns: [{ label: 'Name', type: 'text', required: true }, { label: 'Date of birth', type: 'date' }] })
    const form = buildForms(m, opts).forms[0]
    expect(form.fields.map((f) => f.type)).toEqual(['text', 'repeating_section'])
    expect(section(form.fields).repeating_section).toMatchObject({ max_items: 8, start_items: 1 })
    expect(section(form.fields).repeating_section!.fields[0]).toMatchObject({ label: 'Name', required: true })
  })
})

describe('PDF importer: label helpers', () => {
  it('reads generic row labels and plurals', () => {
    expect(genericRowLabel('Room #12')).toEqual({ noun: 'Room', n: 12 })
    expect(genericRowLabel('3.')).toEqual({ noun: '', n: 3 })
    expect(genericRowLabel('Item 4:')).toEqual({ noun: 'Item', n: 4 })
    expect(genericRowLabel('b)')).toEqual({ noun: '', n: 2 })
    expect(genericRowLabel('Rent')).toBeNull()
    expect(pluralize('Room')).toBe('Rooms')
    expect(pluralize('Entry')).toBe('Entries')
    expect(pluralize('Box')).toBe('Boxes')
  })

  it('splits a long header into the label and its examples', () => {
    expect(headerText('Name of illness or disability For example, Alzheimers, kidney failure')).toEqual({ text: 'Name of illness or disability', help: 'Name of illness or disability For example, Alzheimers, kidney failure' })
    expect(headerText('Bed Type')).toEqual({ text: 'Bed Type' })
  })

  it('never makes a bare number or a copy counter a label', () => {
    expect(humanizeFieldName('Name 1.1.2')).toBe('Name 1 1 2')
    expect(humanizeFieldName('Bed Type.3')).toBe('Bed Type 3')
    expect(humanizeFieldName('topmostSubform[0].Page1[0].f1_01[0]')).toBe('f1 01')
    expect(tidyTooltip('Special Requests/Notes_1')).toBe('Special Requests/Notes')
    expect(cleanLabel('Contact Name: :')).toBe('Contact Name')
  })
})
