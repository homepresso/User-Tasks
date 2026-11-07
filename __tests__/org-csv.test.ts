import { describe, expect, it } from 'vitest'
import { autoMapHeaders, CsvError, guardCell, normaliseHeader, parseCsv, toCsv, unguardCell } from '@/lib/org/csv'
import { IMPORT_FIELDS } from '@/lib/org/import-plan'

describe('parseCsv', () => {
  it('parses quotes, escaped quotes, embedded commas / newlines, CRLF and a BOM', () => {
    const text = '﻿email,title\r\n"a@x.test","Head of ""R&D"", Europe"\r\nb@x.test,"multi\nline"\r\n\r\n'
    expect(parseCsv(text)).toEqual({
      headers: ['email', 'title'],
      rows: [['a@x.test', 'Head of "R&D", Europe'], ['b@x.test', 'multi\nline']],
    })
  })

  it('handles LF, no trailing newline, short / long rows and trims unquoted cells', () => {
    expect(parseCsv('a,b,c\n 1 ,2\n4,5,6,7').rows).toEqual([['1', '2', ''], ['4', '5', '6']])
    expect(parseCsv('a\n" padded "').rows).toEqual([[' padded ']])
  })

  it('skips blank lines and keeps empty quoted cells', () => {
    expect(parseCsv('a,b\n\n"",x\n').rows).toEqual([['', 'x']])
  })

  it('rejects malformed input', () => {
    expect(() => parseCsv('')).toThrow(CsvError)
    expect(() => parseCsv('a\n"open')).toThrow(/never closed/)
    expect(() => parseCsv('a\n"x"y')).toThrow(/after a closing quote/)
  })

  it('enforces limits', () => {
    expect(() => parseCsv('a\n' + 'x\n'.repeat(4), { maxRows: 3 })).toThrow(/more than 3 rows/)
    expect(() => parseCsv('a,b,c', { maxColumns: 2 })).toThrow(/more than 2 columns/)
    expect(() => parseCsv(`a\n${'x'.repeat(11)}`, { maxCellLength: 10 })).toThrow(/longer than 10/)
    expect(() => parseCsv(`a\n"${'x'.repeat(11)}"`, { maxCellLength: 10 })).toThrow(/longer than 10/)
    expect(() => parseCsv('a\nb', { maxBytes: 2 })).toThrow(/larger than/)
  })
})

describe('autoMapHeaders', () => {
  it('maps exact names first, then synonyms, each header once', () => {
    const headers = ['Email Address', 'Name', 'Manager', 'Title', 'Dept', 'Business Unit', 'Office', 'Employee ID', 'Cost Centre', 'Teams', 'Notes']
    expect(autoMapHeaders(headers, IMPORT_FIELDS)).toEqual({
      email: 'Email Address', display_name: 'Name', manager_email: 'Manager', job_title: 'Title', department: 'Dept',
      division: 'Business Unit', location: 'Office', employee_id: 'Employee ID', cost_center: 'Cost Centre', team: 'Teams',
    })
  })

  it('prefers the field name over a synonym and leaves unknown fields null', () => {
    const map = autoMapHeaders(['manager', 'manager_email', 'email'], IMPORT_FIELDS)
    expect(map.manager_email).toBe('manager_email')
    expect(map.email).toBe('email')
    expect(map.job_title).toBeNull()
    expect(normaliseHeader('E-mail  Address')).toBe('emailaddress')
  })
})

describe('toCsv / formula guard', () => {
  it('guards formula-looking cells but keeps the clear token', () => {
    expect(guardCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(guardCell('+1')).toBe("'+1")
    expect(guardCell('-10')).toBe("'-10")
    expect(guardCell('@cmd')).toBe("'@cmd")
    expect(guardCell('-')).toBe('-')
    expect(guardCell('Engineering')).toBe('Engineering')
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(unguardCell("'quoted")).toBe("'quoted")
  })

  it('writes quoted, escaped CSV that parses back', () => {
    const csv = toCsv(['a', 'b'], [['x, y', 'say "hi"'], [null, '=1+1'], ['multi\nline', undefined]])
    expect(csv).toBe('a,b\r\n"x, y","say ""hi"""\r\n,\'=1+1\r\n"multi\nline",\r\n')
    expect(parseCsv(csv).rows).toEqual([['x, y', 'say "hi"'], ['', "'=1+1"], ['multi\nline', '']])
  })
})
