import { readFileSync } from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { describe, expect, it, vi } from 'vitest'
import * as xl from '@/lib/excel'
import { pinDefaultStorageProvider } from './fixtures/pin-storage'

// Supabase Storage path (mocked client / local stack buckets).
pinDefaultStorageProvider()

/**
 * lib/excel (ExcelJS) keeps the parse semantics the workflow nodes had on
 * SheetJS. `sheetjs-sample.xlsx` was written by SheetJS 0.18; the expected rows
 * are what SheetJS `sheet_to_json` returned for it, except dates, which are now
 * ISO strings instead of serial numbers.
 */

const FIXTURE = readFileSync(path.join(__dirname, 'fixtures/sheetjs-sample.xlsx'))

async function roundTrip(wb: ExcelJS.Workbook) {
  return xl.loadWorkbook(await xl.workbookToBuffer(wb))
}

describe('reading a SheetJS-written workbook', () => {
  it('lists sheet names in order', async () => {
    const wb = await xl.loadWorkbook(FIXTURE)
    expect(xl.sheetNames(wb)).toEqual(['Orders', 'Notes & Misc'])
    expect(xl.getSheet(wb)?.name).toBe('Orders')
    expect(xl.getSheet(wb, 'Notes & Misc')?.name).toBe('Notes & Misc')
    expect(xl.getSheet(wb, 'Missing')).toBeUndefined()
  })

  it('parses objects like sheet_to_json (numbers, booleans, unicode, duplicate headers, formulas, blank rows)', async () => {
    const wb = await xl.loadWorkbook(FIXTURE)
    expect(xl.sheetToObjects(xl.getSheet(wb)!, { defval: '' })).toEqual([
      { Order: 1001, Customer: 'Müller GmbH', Amount: 1234.5, Paid: true, Due: '2026-01-15', Order_1: 'dup-a', Formula: 1235.5 },
      { Order: 1002, Customer: '田中', Amount: 0.1, Paid: false, Due: '2026-02-28T13:30:00.000Z', Order_1: 'dup-b', Formula: '' },
      { Order: 1003, Customer: 'Said "hi"', Amount: -7, Paid: true, Due: '', Order_1: '', Formula: '' },
    ])
  })

  it('parses arrays like sheet_to_json({ header: 1 }) and keeps blank rows', async () => {
    const wb = await xl.loadWorkbook(FIXTURE)
    expect(xl.sheetToArrays(xl.getSheet(wb)!, { defval: '' })).toEqual([
      ['Order', 'Customer', 'Amount', 'Paid', 'Due', 'Order', 'Formula'],
      [1001, 'Müller GmbH', 1234.5, true, '2026-01-15', 'dup-a', 1235.5],
      [1002, '田中', 0.1, false, '2026-02-28T13:30:00.000Z', 'dup-b', ''],
      ['', '', '', '', '', '', ''],
      [1003, 'Said "hi"', -7, true, '', '', ''],
    ])
  })

  it('starts at the first used cell and names blank headers __EMPTY', async () => {
    const ws = xl.getSheet(await xl.loadWorkbook(FIXTURE), 'Notes & Misc')!
    expect(xl.sheetToObjects(ws, { defval: '' })).toEqual([{ Note: 'Second sheet', __EMPTY: 42 }])
    expect(xl.sheetToArrays(ws, { defval: '' })).toEqual([['Note', ''], ['Second sheet', 42]])
  })

  it('omits empty cells without defval', async () => {
    const wb = await xl.loadWorkbook(FIXTURE)
    const rows = xl.sheetToObjects(xl.getSheet(wb)!)
    expect(rows[1]).toEqual({ Order: 1002, Customer: '田中', Amount: 0.1, Paid: false, Due: '2026-02-28T13:30:00.000Z', Order_1: 'dup-b' })
  })

  it('rejects files that are not .xlsx', async () => {
    await expect(xl.loadWorkbook(Buffer.from('a,b\n1,2\n'))).rejects.toThrow(/only \.xlsx is supported/)
  })
})

describe('writing workbooks', () => {
  it('writes objects with a header from the union of keys and reads them back', async () => {
    const data = [
      { Name: 'Alice', Email: 'alice@test.com', Age: 30 },
      { Name: 'Bob', Age: 25, Active: true },
    ]
    const wb = await roundTrip(xl.buildWorkbook([{ name: 'TestSheet', rows: data }]))
    expect(xl.sheetNames(wb)).toEqual(['TestSheet'])
    expect(xl.sheetToObjects(xl.getSheet(wb)!)).toEqual([
      { Name: 'Alice', Email: 'alice@test.com', Age: 30 },
      { Name: 'Bob', Age: 25, Active: true },
    ])
  })

  it('writes multiple sheets, mixed types, dates and nested values', async () => {
    const wb = await roundTrip(xl.buildWorkbook([
      { name: 'Sheet1', rows: [{ id: 1, price: 19.99, when: new Date(Date.UTC(2026, 4, 1)), meta: { a: 1 }, none: null }] },
      { name: 'Sheet2', arrays: [['b'], [2]] },
    ]))
    expect(xl.sheetNames(wb)).toEqual(['Sheet1', 'Sheet2'])
    expect(xl.sheetToObjects(xl.getSheet(wb, 'Sheet1')!)).toEqual([{ id: 1, price: 19.99, when: '2026-05-01', meta: '{"a":1}' }])
    expect(xl.sheetToObjects(xl.getSheet(wb, 'Sheet2')!)).toEqual([{ b: 2 }])
  })

  it('keeps strings that look like formulas as text', async () => {
    const wb = await roundTrip(xl.buildWorkbook([{ name: 'S', arrays: [['h'], ['=1+1']] }]))
    expect(xl.getSheet(wb)!.getCell('A2').value).toBe('=1+1')
  })

  it('handles an empty sheet and a large one', async () => {
    const empty = await roundTrip(xl.buildWorkbook([{ name: 'Empty', rows: [] }]))
    expect(xl.sheetToObjects(xl.getSheet(empty)!)).toEqual([])
    const big = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, name: `Row ${i + 1}` }))
    const wb = await roundTrip(xl.buildWorkbook([{ name: 'Big', rows: big }]))
    const rows = xl.sheetToObjects(xl.getSheet(wb)!)
    expect(rows).toHaveLength(1000)
    expect(rows[999]).toEqual({ id: 1000, name: 'Row 1000' })
  })

  it('addObjects writes at an origin, optionally without a header', async () => {
    const wb = xl.buildWorkbook([{ name: 'Data', arrays: [['Header1', 'Header2']] }])
    const ws = xl.getSheet(wb)!
    xl.addObjects(ws, [{ Header1: 'A', Header2: 'B' }, { Header1: 'C', Header2: 'D' }], { origin: 'A2', skipHeader: true })
    xl.addObjects(ws, [{ x: 1 }], { origin: '$D$5' })
    const back = xl.getSheet(await roundTrip(wb))!
    expect(xl.sheetToArrays(back)[0]).toEqual(['Header1', 'Header2'])
    expect(back.getCell('A3').value).toBe('C')
    expect(back.getCell('D5').value).toBe('x')
    expect(back.getCell('D6').value).toBe(1)
    expect(() => xl.addObjects(ws, [{ x: 1 }], { origin: 'not a cell' })).toThrow(/Invalid cell reference/)
  })
})

describe('handleDocExcel (template modes)', () => {
  async function run(config: Record<string, unknown>, template: ExcelJS.Workbook, vars: Record<string, unknown> = {}) {
    const tpl = await xl.workbookToBuffer(template)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(tpl))))
    let uploaded: Buffer | null = null
    const supabase = {
      storage: {
        from: () => ({
          upload: async (_p: string, buf: Buffer) => { uploaded = buf; return { error: null } },
          getPublicUrl: (p: string) => ({ data: { publicUrl: `https://files.test/${p}` } }),
        }),
      },
    }
    const resolve = (e: unknown) => (typeof e === 'string' && e.startsWith('$') ? vars[e.slice(1)] : e)
    const { handleDocExcel } = await import('@/lib/doc-handlers')
    const result = await handleDocExcel({ template_url: 'https://files.test/t.xlsx', ...config }, resolve, supabase as never, 't1', () => {})
    vi.unstubAllGlobals()
    expect(uploaded).not.toBeNull()
    return { result, wb: await xl.loadWorkbook(uploaded!) }
  }

  it('find_replace changes text cells on every sheet and leaves numbers alone', async () => {
    const tpl = xl.buildWorkbook([
      { name: 'One', arrays: [['Hello {{Name}}', '{{Name}} is great'], ['No placeholder', 123]] },
      { name: 'Two', arrays: [['{{Name}} again']] },
    ])
    const { result, wb } = await run({ mode: 'find_replace', replacements: [{ find: '{{Name}}', replace: 'Alice' }] }, tpl)
    expect(result.fileRef.content_type).toBe(xl.EXCEL_MIME)
    expect(xl.sheetToArrays(xl.getSheet(wb, 'One')!)).toEqual([['Hello Alice', 'Alice is great'], ['No placeholder', 123]])
    expect(xl.sheetToArrays(xl.getSheet(wb, 'Two')!)).toEqual([['Alice again']])
  })

  it('update_cell_value / update_cell_text set cells, skipping invalid references', async () => {
    const tpl = xl.buildWorkbook([{ name: 'S', arrays: [['Price', 'Label'], [0, 'x']] }])
    const v = await run({ mode: 'update_cell_value', cells: [{ cell: 'A2', value: '99.99' }, { cell: 'bogus', value: '1' }] }, tpl)
    expect(xl.sheetToObjects(xl.getSheet(v.wb)!)).toEqual([{ Price: 99.99, Label: 'x' }])
    const t = await run({ mode: 'update_cell_text', cells: [{ cell: 'B2', text: '$label' }] }, tpl, { label: 'Bob' })
    expect(xl.sheetToObjects(xl.getSheet(t.wb)!)).toEqual([{ Price: 0, Label: 'Bob' }])
  })

  it('insert_data writes rows below the template header', async () => {
    const tpl = xl.buildWorkbook([{ name: 'Data', arrays: [['Header1', 'Header2']] }])
    const { wb } = await run(
      { mode: 'insert_data', data_var: '$rows', placeholder: 'A2', include_headers: false },
      tpl,
      { rows: [{ Header1: 'A', Header2: 'B' }, { Header1: 'C', Header2: 'D' }] },
    )
    expect(xl.sheetToObjects(xl.getSheet(wb)!)).toEqual([{ Header1: 'A', Header2: 'B' }, { Header1: 'C', Header2: 'D' }])
  })
})

describe('client bundle guard', () => {
  it('no client component imports lib/excel or exceljs', async () => {
    const { execSync } = await import('child_process')
    const out = execSync(
      "git grep -l -E \"(from |import\\()['\\\"][^'\\\"]*(exceljs|/excel)['\\\"]\" -- app components hooks stores lib || true",
      { cwd: path.join(__dirname, '..'), encoding: 'utf8' },
    )
    const offenders = out.split('\n').filter(Boolean).filter((f) => /^['"]use client['"]/m.test(readFileSync(path.join(__dirname, '..', f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
