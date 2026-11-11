/**
 * Data-table import: header matching, type inference, value parsing, date
 * order, validation errors, upsert keys, the error-rows table and the
 * formula-injection guard (lib/data-import/rows, lib/org/csv).
 */
import { describe, expect, it } from 'vitest'
import {
  autoMatchHeaders, checkUpsertKeys, detectDateOrder, errorRowsTable, inferColumn, inferColumns, normalizeHeader,
  parseBoolean, parseDateValue, parseNumber, resolveMapping, upsertKeyOf, validateRows, type ImportTargetColumn,
} from '@/lib/data-import/rows'
import { guardCell, toCsv } from '@/lib/org/csv'

const COLUMNS: ImportTargetColumn[] = [
  { key: 'id', name: 'ID', type: 'number' },
  { key: 'date_created', name: 'Date Created', type: 'date' },
  { key: 'order_no', name: 'Order No', type: 'text', required: true },
  { key: 'amount', name: 'Amount', type: 'number' },
  { key: 'due_date', name: 'Due Date', type: 'date' },
  { key: 'status', name: 'Status', type: 'select', options: ['Open', 'Paid', 'Overdue'] },
  { key: 'paid', name: 'Paid', type: 'boolean' },
  { key: 'receipt', name: 'Receipt', type: 'file' },
]

describe('header matching', () => {
  it('normalises case, spaces, underscores and hyphens', () => {
    expect(normalizeHeader(' Order_No ')).toBe('orderno')
    expect(normalizeHeader('Due-Date')).toBe('duedate')
  })

  it('matches by name or key, each column once; system and file columns are never targets', () => {
    const mapping = autoMatchHeaders(['ORDER NO', 'order_no', 'amount', 'Due Date', 'ID', 'Date Created', 'Receipt', 'Notes'], COLUMNS)
    expect(mapping).toEqual({
      'ORDER NO': 'order_no', order_no: null, amount: 'amount', 'Due Date': 'due_date',
      ID: null, 'Date Created': null, Receipt: null, Notes: null,
    })
  })

  it('resolveMapping: explicit choices win, skipped headers stay skipped, problems are reported', () => {
    const { mapping, problems } = resolveMapping(['Ref', 'Amount', 'Status'], COLUMNS, { Ref: 'Order No', Status: null })
    expect(problems).toEqual([])
    expect(mapping).toEqual({ Ref: 'order_no', Amount: 'amount', Status: null })
    const bad = resolveMapping(['A', 'B', 'C'], COLUMNS, { A: 'amount', B: 'amount', C: 'nope', D: 'paid' })
    expect(bad.problems.join(' | ')).toMatch(/no column "D"/)
    expect(bad.problems.join(' | ')).toMatch(/both map to "Amount"/)
    expect(bad.problems.join(' | ')).toMatch(/"nope", which is not a column/)
    expect(resolveMapping(['X'], COLUMNS, { X: 'id' }).problems[0]).toMatch(/system column/)
    expect(resolveMapping(['X'], COLUMNS, { X: 'receipt' }).problems[0]).toMatch(/file column/)
  })
})

describe('values', () => {
  it('parseNumber: plain, thousands, currency (USD), negatives, European', () => {
    expect(parseNumber('1234.5')).toBe(1234.5)
    expect(parseNumber('1,234.50')).toBe(1234.5)
    expect(parseNumber('$1,234.50')).toBe(1234.5)
    expect(parseNumber('USD 1,234.50')).toBe(1234.5)
    expect(parseNumber('US$99')).toBe(99)
    expect(parseNumber('(12.00)')).toBe(-12)
    expect(parseNumber('-$5')).toBe(-5)
    expect(parseNumber('1.234,50')).toBe(1234.5)
    expect(parseNumber('2,5')).toBe(2.5)
    expect(parseNumber('1e3')).toBe(1000)
    for (const bad of ['', 'abc', '12abc', '1.2.3', '=1+1']) expect(parseNumber(bad)).toBeNull()
  })

  it('parseBoolean', () => {
    for (const t of ['true', 'Yes', 'Y', '1', 'on', 'x']) expect(parseBoolean(t)).toBe(true)
    for (const f of ['FALSE', 'no', 'n', '0', 'off']) expect(parseBoolean(f)).toBe(false)
    expect(parseBoolean('maybe')).toBeNull()
  })

  it('parseDateValue: ISO, numeric by order, month names, times; invalid dates refused', () => {
    expect(parseDateValue('2026-03-31')).toMatchObject({ year: 2026, month: 3, day: 31 })
    expect(parseDateValue('03/04/2026', 'mdy')).toMatchObject({ month: 3, day: 4, ambiguous: true })
    expect(parseDateValue('03/04/2026', 'dmy')).toMatchObject({ month: 4, day: 3 })
    expect(parseDateValue('31.03.26', 'dmy')).toMatchObject({ year: 2026, month: 3, day: 31 })
    expect(parseDateValue('5 Jan 2026')).toMatchObject({ month: 1, day: 5 })
    expect(parseDateValue('Jan 5, 2026')).toMatchObject({ month: 1, day: 5 })
    expect(parseDateValue('2026-03-31T14:05:00Z')).toMatchObject({ time: '14:05' })
    expect(parseDateValue('3/31/2026 2:30 PM', 'mdy')).toMatchObject({ day: 31, time: '14:30' })
    for (const bad of ['2026-02-30', '31/03/2026', 'soon', '13/13/2026']) expect(parseDateValue(bad, 'mdy')).toBeNull()
  })

  it('detectDateOrder', () => {
    expect(detectDateOrder(['31/03/2026', '01/04/2026']).order).toBe('dmy')
    expect(detectDateOrder(['03/31/2026', '04/01/2026']).order).toBe('mdy')
    expect(detectDateOrder(['01/02/2026'], 'dmy')).toEqual({ order: 'dmy', ambiguous: true, conflicting: false })
    expect(detectDateOrder(['31/03/2026', '03/31/2026', '25/12/2026']).conflicting).toBe(true)
  })
})

describe('type inference', () => {
  const kind = (values: string[]) => inferColumn('H', values)
  it('detects each kind and the column type that holds it', () => {
    expect(kind(['1', '2', '3.5'])).toMatchObject({ detected: 'number', type: 'number' })
    expect(kind(['$1,200.00', '$35.50'])).toMatchObject({ detected: 'currency', type: 'number' })
    expect(kind(['2026-01-05', '2026-02-10'])).toMatchObject({ detected: 'date', type: 'date' })
    expect(kind(['2026-01-05 09:30', '2026-02-10 17:00'])).toMatchObject({ detected: 'datetime', type: 'text' })
    expect(kind(['Yes', 'No', 'yes'])).toMatchObject({ detected: 'boolean', type: 'boolean' })
    expect(kind(['1', '0', '1'])).toMatchObject({ type: 'number' })
    expect(kind(['a@example.com', 'b@example.org'])).toMatchObject({ detected: 'email', type: 'text' })
    expect(kind(['https://example.com/a', 'http://example.com'])).toMatchObject({ detected: 'url', type: 'text' })
    expect(kind(['short', 'x'.repeat(300)])).toMatchObject({ detected: 'longtext', type: 'longtext' })
    expect(kind(['line 1\nline 2', 'x'])).toMatchObject({ type: 'longtext' })
    expect(kind(['', ' '])).toMatchObject({ detected: 'empty', type: 'text' })
    expect(kind(['Alice', 'Bob', 'Carol'])).toMatchObject({ detected: 'text', type: 'text' })
  })

  it('choices become select columns with options in first-seen order', () => {
    const col = kind(['Open', 'Paid', 'open', 'Overdue', 'Paid', 'Paid'])
    expect(col).toMatchObject({ detected: 'choice', type: 'select', options: ['Open', 'Paid', 'Overdue'] })
  })

  it('inferColumns: unique keys that never clash with system columns', () => {
    const cols = inferColumns(['ID', 'Name', 'name', 'Date Created'], [['1', 'A', 'B', '2026-01-01']])
    expect(cols.map((c) => c.key)).toEqual(['id_2', 'name', 'name_2', 'date_created_2'])
  })
})

describe('validateRows', () => {
  const headers = ['Order No', 'Amount', 'Due Date', 'Status', 'Paid', 'Notes']
  const mapping = autoMatchHeaders(headers, COLUMNS)

  it('converts values and reports every error with its spreadsheet row (header = row 1)', () => {
    const rows = [
      ['INV-1', '$1,234.50', '03/31/2026', 'paid', 'yes', 'n'],
      ['INV-2', 'twelve', '2026-13-01', 'Lost', 'maybe', ''],
      ['', '10', '', '', '', ''],
    ]
    const r = validateRows(headers, rows, COLUMNS, mapping)
    expect(r.dateOrder).toBe('mdy')
    expect(r.valid).toEqual([{ row: 2, index: 0, data: { order_no: 'INV-1', amount: 1234.5, due_date: '2026-03-31', status: 'Paid', paid: true } }])
    expect(r.invalidRows).toEqual([1, 2])
    expect(r.errors.map((e) => [e.row, e.column, e.reason.split(' (')[0]])).toEqual([
      [3, 'Amount', 'Not a number'],
      [3, 'Due Date', 'Not a date'],
      [3, 'Status', 'Not one of the choices'],
      [3, 'Paid', 'Not a yes / no value'],
      [4, 'Order No', 'Required: "Order No" cannot be empty'],
    ])
  })

  it('a required column the file lacks fails every row', () => {
    const r = validateRows(['Amount'], [['1']], COLUMNS, { Amount: 'amount' })
    expect(r.errors).toEqual([{ row: 2, column: 'Order No', value: '', reason: 'Required: "Order No" is not in the file' }])
  })

  it('empty cells: empty → null, ignore → left out; trim on by default', () => {
    const cols: ImportTargetColumn[] = [{ key: 'name', name: 'Name', type: 'text' }, { key: 'amount', name: 'Amount', type: 'number' }]
    const m = { Name: 'name', Amount: 'amount' }
    expect(validateRows(['Name', 'Amount'], [['  Ann  ', '']], cols, m).valid[0].data).toEqual({ name: 'Ann', amount: null })
    expect(validateRows(['Name', 'Amount'], [['Ann', '']], cols, m, { empty_cells: 'ignore' }).valid[0].data).toEqual({ name: 'Ann' })
    expect(validateRows(['Name', 'Amount'], [['  Ann  ', '1']], cols, m, { trim: false }).valid[0].data.name).toBe('  Ann  ')
  })

  it('date order override', () => {
    const cols: ImportTargetColumn[] = [{ key: 'd', name: 'D', type: 'date' }]
    expect(validateRows(['D'], [['03/04/2026']], cols, { D: 'd' }, { date_order: 'dmy' }).valid[0].data.d).toBe('2026-04-03')
    expect(validateRows(['D'], [['03/04/2026']], cols, { D: 'd' }, { date_order: 'mdy' }).valid[0].data.d).toBe('2026-03-04')
    // Detected: a day above 12 decides day-first for the whole column.
    expect(validateRows(['D'], [['03/04/2026'], ['25/04/2026']], cols, { D: 'd' }).valid[0].data.d).toBe('2026-04-03')
  })

  it('formulas are stored as plain text, never evaluated', () => {
    const cols: ImportTargetColumn[] = [{ key: 'name', name: 'Name', type: 'text' }]
    expect(validateRows(['Name'], [['=1+1'], ['@SUM(A1)']], cols, { Name: 'name' }).valid.map((v) => v.data.name)).toEqual(['=1+1', '@SUM(A1)'])
  })
})

describe('upsert keys', () => {
  it('empty and repeated keys are errors (the later row is refused)', () => {
    const headers = ['Order No', 'Amount']
    const r = validateRows(headers, [['INV-1', '1'], ['inv-1', '2'], ['INV-2', '3']], [{ key: 'order_no', name: 'Order No', type: 'text' }, { key: 'amount', name: 'Amount', type: 'number' }], { 'Order No': 'order_no', Amount: 'amount' })
    const checked = checkUpsertKeys(r, { key: 'order_no', name: 'Order No', type: 'text' }, 'Order No')
    expect(checked.valid.map((v) => v.row)).toEqual([2, 4])
    expect(checked.errors[0]).toMatchObject({ row: 3, reason: 'Duplicate key: row 2 has the same "Order No"' })
  })

  it('upsertKeyOf compares numbers by value and text case-insensitively', () => {
    expect(upsertKeyOf(12)).toBe(upsertKeyOf('12.0'))
    expect(upsertKeyOf(' ABC ')).toBe(upsertKeyOf('abc'))
    expect(upsertKeyOf('')).toBeNull()
    expect(upsertKeyOf(null)).toBeNull()
  })
})

describe('error rows download', () => {
  it('original cells plus Row and Errors', () => {
    const t = errorRowsTable(['A', 'B'], [['1', 'x'], ['2', 'y']], [
      { row: 3, column: 'B', value: 'y', reason: 'Not a number' },
      { row: 3, column: 'A', value: '2', reason: 'Too big' },
    ])
    expect(t).toEqual({ headers: ['Row', 'A', 'B', 'Errors'], rows: [['3', '2', 'y', 'B: Not a number; A: Too big']] })
  })

  it('CSV export guards formula injection', () => {
    expect(guardCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)")
    expect(guardCell('-')).toBe('-')
    const csv = toCsv(['Value'], [['=HYPERLINK("http://evil.example")'], ['+1'], ['@cmd'], ['$1,234.50']])
    expect(csv).toBe('Value\r\n"\'=HYPERLINK(""http://evil.example"")"\r\n\'+1\r\n\'@cmd\r\n"$1,234.50"\r\n')
  })
})

describe('type inference with a few bad values', () => {
  it('from 20 values, up to 5% may fail: the column keeps its type and the bad cells become row errors', () => {
    const amounts = Array.from({ length: 40 }, (_, i) => `$${(i * 12.5 + 10).toFixed(2)}`)
    amounts[7] = 'TBC'
    amounts[30] = '=1+1'
    const amount = inferColumn('Amount (USD)', amounts)
    expect(amount).toMatchObject({ detected: 'currency', type: 'number' })
    const dates = Array.from({ length: 40 }, (_, i) => `03/${String((i % 28) + 1).padStart(2, '0')}/2026`)
    dates[5] = '02/30/2026'
    expect(inferColumn('Order Date', dates, 'mdy')).toMatchObject({ detected: 'date', type: 'date' })
    // Fewer than 20 values: one bad value makes it text.
    expect(inferColumn('Amount', ['$1.00', '$2.00', 'TBC'])).toMatchObject({ type: 'text' })
    // Too many bad values (> 5%): text.
    const mixed = amounts.map((v, i) => (i % 5 === 0 ? 'n/a' : v))
    expect(inferColumn('Amount', mixed)).toMatchObject({ type: 'text' })
    const r = validateRows(['Amount (USD)'], amounts.map((v) => [v]), [{ key: 'amount_usd', name: 'Amount (USD)', type: 'number' }], { 'Amount (USD)': 'amount_usd' })
    expect(r.errors.map((e) => [e.row, e.reason])).toEqual([[9, 'Not a number'], [32, 'Not a number']])
  })
})
