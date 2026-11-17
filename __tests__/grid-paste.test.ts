/**
 * Pasting a block from a spreadsheet into an "Edit all rows" grid
 * (lib/grid/paste.ts): clipboard parsing (Excel quoting), date / number /
 * yes-no / choice / people normalisation, coercion by the column's rules
 * with per-cell errors, read-only cells, and filling a selected range.
 */
import { describe, expect, it } from 'vitest'
import {
  localeDateOrder, normalizePastedDate, normalizePastedNumber, normalizePastedText, parseClipboardTable, planPaste, toClipboardTable,
  type PasteColumn,
} from '@/lib/grid/paste'
import { coerceGridValue, type GridColumnDef } from '@/lib/grid/column-model'

describe('parseClipboardTable', () => {
  it('splits tabs and lines; the trailing newline Excel adds is not a row', () => {
    expect(parseClipboardTable('Acme\t1250\nApex\t480.50\n')).toEqual([['Acme', '1250'], ['Apex', '480.50']])
    expect(parseClipboardTable('one')).toEqual([['one']])
    expect(parseClipboardTable('')).toEqual([])
  })
  it('keeps quoted cells with tabs, newlines and "" escapes; Windows line ends', () => {
    expect(parseClipboardTable('"Line 1\nLine 2"\t"Say ""hi"""\r\nx\t"a\tb"\r\n')).toEqual([['Line 1\nLine 2', 'Say "hi"'], ['x', 'a\tb']])
  })
  it('keeps empty cells', () => {
    expect(parseClipboardTable('a\t\tc\n\t\t')).toEqual([['a', '', 'c'], ['', '', '']])
  })
  it('round-trips with toClipboardTable', () => {
    const rows = [['Say "hi"', 'a\tb', 12], [null, 'two\nlines', true]]
    expect(parseClipboardTable(toClipboardTable(rows))).toEqual([['Say "hi"', 'a\tb', '12'], ['', 'two\nlines', 'true']])
  })
})

describe('normalisation', () => {
  it('dates: ISO, day / month order, month names, two-digit years; invalid dates refused', () => {
    expect(normalizePastedDate('2026-11-23T10:00:00')).toBe('2026-11-23')
    expect(normalizePastedDate('11/23/2026', 'mdy')).toBe('2026-11-23')
    expect(normalizePastedDate('23/11/2026', 'mdy')).toBe('2026-11-23')
    expect(normalizePastedDate('03/04/2026', 'dmy')).toBe('2026-04-03')
    expect(normalizePastedDate('03/04/2026', 'mdy')).toBe('2026-03-04')
    expect(normalizePastedDate('23-Nov-26')).toBe('2026-11-23')
    expect(normalizePastedDate('November 23, 2026')).toBe('2026-11-23')
    expect(normalizePastedDate('31/02/2026', 'dmy')).toBeNull()
    expect(normalizePastedDate('soon')).toBeNull()
  })
  it('locale date order', () => {
    expect(localeDateOrder('en-US')).toBe('mdy')
    expect(localeDateOrder('en-GB')).toBe('dmy')
  })
  it('numbers: currency, thousands, accounting negatives, codes', () => {
    expect(normalizePastedNumber('$1,234.50')).toBe(1234.5)
    expect(normalizePastedNumber('(12.50)')).toBe(-12.5)
    expect(normalizePastedNumber('USD 2,000')).toBe(2000)
    expect(normalizePastedNumber('-$5')).toBe(-5)
    expect(normalizePastedNumber('1 234')).toBe(1234)
    expect(normalizePastedNumber('twelve')).toBeNull()
  })
  it('yes / no, choices by label, multi-select lists, people by name or email', () => {
    expect(normalizePastedText({ key: 'p', label: 'Paid', control: 'boolean' }, 'TRUE')).toBe(true)
    expect(normalizePastedText({ key: 'p', label: 'Paid', control: 'boolean' }, 'No')).toBe(false)
    const status: PasteColumn = { key: 's', label: 'Status', control: 'dropdown', choices: [{ value: 'open', label: 'Open' }, { value: 'paid', label: 'Paid' }] }
    expect(normalizePastedText(status, 'paid')).toBe('paid')
    expect(normalizePastedText(status, 'OPEN')).toBe('open')
    expect(normalizePastedText({ ...status, control: 'multiselect' }, 'Open; Paid')).toEqual(['open', 'paid'])
    const people = [{ id: 'u1', display_name: 'Ana Admin', email: 'ana@example.com' }]
    expect(normalizePastedText({ key: 'o', label: 'Owner', control: 'people' }, 'ana@example.com', { people })).toEqual([{ kind: 'user', id: 'u1', name: 'Ana Admin' }])
    expect(normalizePastedText({ key: 'o', label: 'Owner', control: 'people' }, 'Nobody', { people })).toEqual({ unmatched: true })
  })
})

describe('planPaste', () => {
  const cols: GridColumnDef[] = [
    { key: 'vendor', label: 'Vendor', control: 'text', required: true },
    { key: 'amount', label: 'Amount', control: 'currency' },
    { key: 'due', label: 'Due', control: 'date' },
    { key: 'paid', label: 'Paid', control: 'boolean' },
    { key: 'id', label: 'ID', control: 'number', editable: false },
  ]
  const byKey = new Map(cols.map((c) => [c.key, c]))
  const columns: PasteColumn[] = cols.map((c) => ({ key: c.key, label: c.label, control: c.control }))
  const base = {
    rowKeys: ['r1', 'r2', 'r3'],
    columns,
    canEdit: (_row: string, col: string) => col !== 'id',
    coerce: (col: PasteColumn, raw: unknown) => coerceGridValue(byKey.get(col.key)!, raw),
    dateOrder: 'mdy' as const,
  }

  it('writes a block from the focused cell with type coercion', () => {
    const plan = planPaste({ ...base, block: parseClipboardTable('Acme Supplies\t$1,250.00\t11/30/2026\tYes\nApex Office\t480.5\t2026-12-15\tFALSE\n'), start: { r: 0, c: 0 } })
    expect(plan.errors).toEqual([])
    expect(plan.changes).toEqual([
      { row: 'r1', col: 'vendor', value: 'Acme Supplies' }, { row: 'r1', col: 'amount', value: 1250 }, { row: 'r1', col: 'due', value: '2026-11-30' }, { row: 'r1', col: 'paid', value: true },
      { row: 'r2', col: 'vendor', value: 'Apex Office' }, { row: 'r2', col: 'amount', value: 480.5 }, { row: 'r2', col: 'due', value: '2026-12-15' }, { row: 'r2', col: 'paid', value: false },
    ])
  })

  it('reports cells that don\'t fit (per cell) and writes the rest', () => {
    const plan = planPaste({ ...base, block: [['lots', 'next week'], ['', '25']], start: { r: 0, c: 1 } })
    expect(plan.changes).toEqual([{ row: 'r2', col: 'amount', value: null }])
    expect(plan.errors.map((e) => [e.row, e.col])).toEqual([['r1', 'amount'], ['r1', 'due'], ['r2', 'due']])
    expect(plan.errors[0].message).toMatch(/Amount must be a number/)
  })

  it('a required column refuses a blank paste', () => {
    const plan = planPaste({ ...base, block: [['']], start: { r: 1, c: 0 } })
    expect(plan.errors).toEqual([{ row: 'r2', col: 'vendor', message: expect.stringMatching(/Vendor is required/) }])
  })

  it('skips read-only cells and counts what fell outside the table', () => {
    const plan = planPaste({ ...base, block: [['true', '7', 'extra'], ['false', '8', 'extra']], start: { r: 2, c: 3 } })
    expect(plan.changes).toEqual([{ row: 'r3', col: 'paid', value: true }])
    expect(plan.skipped).toBe(1)
    expect(plan.outside).toBe(4)
  })

  it('one value pasted over a selected range fills it', () => {
    const plan = planPaste({ ...base, block: [['99']], start: { r: 0, c: 1 }, range: { r1: 0, c1: 1, r2: 2, c2: 1 } })
    expect(plan.changes.map((c) => [c.row, c.value])).toEqual([['r1', 99], ['r2', 99], ['r3', 99]])
  })

  it('files and unknown people are errors, not silent writes', () => {
    const plan = planPaste({ ...base, columns: [{ key: 'f', label: 'Receipt', control: 'file' }, { key: 'o', label: 'Owner', control: 'people' }], canEdit: () => true,
      coerce: () => ({ value: 'x' }), block: [['receipt.pdf', 'Someone']], start: { r: 0, c: 0 } })
    expect(plan.changes).toEqual([])
    expect(plan.errors.map((e) => e.message)).toEqual([expect.stringMatching(/can't be pasted/), expect.stringMatching(/not a person/)])
  })
})
