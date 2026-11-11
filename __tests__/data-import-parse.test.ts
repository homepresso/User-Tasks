/**
 * Data-table import: reading CSV / TSV / .xlsx files (lib/data-import/parse,
 * lib/data-import/xlsx) — BOM, quoting, delimiters, encodings, blank rows,
 * headers, limits and the Excel sheet picker.
 */
import { describe, expect, it } from 'vitest'
import {
  checkFileSize, DATA_IMPORT_LIMITS, decodeText, detectDelimiter, formatFromName, ImportFileError,
  parseDelimited, parseTextFile, uniqueHeaders,
} from '@/lib/data-import/parse'
import { parseXlsx } from '@/lib/data-import/xlsx'
import { buildWorkbook, workbookToBuffer } from '@/lib/excel'

const enc = (s: string) => new TextEncoder().encode(s)

describe('decodeText', () => {
  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Name,Amount\nA,1')])
    const { text, encoding } = decodeText(bytes)
    expect(encoding).toBe('utf-8')
    expect(text.startsWith('Name')).toBe(true)
  })

  it('reads UTF-16 LE with a BOM', () => {
    const s = 'Name,Amount\nCafé,1'
    const bytes = new Uint8Array(2 + s.length * 2)
    bytes[0] = 0xff; bytes[1] = 0xfe
    for (let i = 0; i < s.length; i++) { bytes[2 + i * 2] = s.charCodeAt(i) & 0xff; bytes[3 + i * 2] = s.charCodeAt(i) >> 8 }
    const { text, encoding } = decodeText(bytes)
    expect(encoding).toBe('utf-16le')
    expect(text).toBe(s)
  })

  it('falls back to Windows-1252 when the bytes are not UTF-8', () => {
    // "Café" with é = 0xE9 in Windows-1252, and a € (0x80).
    const bytes = new Uint8Array([...enc('Name\nCaf'), 0xe9, 0x20, 0x80])
    const { text, encoding } = decodeText(bytes)
    expect(encoding).toBe('windows-1252')
    expect(text).toBe('Name\nCafé €')
  })

  it('honours a forced encoding', () => {
    expect(decodeText(new Uint8Array([0x41, 0xe9]), 'windows-1252').text).toBe('Aé')
  })
})

describe('detectDelimiter / parseDelimited', () => {
  it('detects comma, semicolon and tab', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2,5;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('"x;y",b\n"1;2",3')).toBe(',')
  })

  it('reads quoted fields with embedded newlines, delimiters and "" escapes', () => {
    const file = parseDelimited('Name,Notes,Amount\r\n"Smith, Jane","Line 1\nLine 2 ""quoted""","$1,234.50"\r\nLee,plain,10\r\n')
    expect(file.delimiter).toBe(',')
    expect(file.headers).toEqual(['Name', 'Notes', 'Amount'])
    expect(file.rows).toEqual([
      ['Smith, Jane', 'Line 1\nLine 2 "quoted"', '$1,234.50'],
      ['Lee', 'plain', '10'],
    ])
  })

  it('reads semicolon files (European Excel)', () => {
    const file = parseDelimited('Name;Amount\nA;1.234,50\nB;"2;5"')
    expect(file.delimiter).toBe(';')
    expect(file.rows).toEqual([['A', '1.234,50'], ['B', '2;5']])
  })

  it('reads TSV by extension', () => {
    const file = parseTextFile(enc('a\tb\n1\t2'), { fileName: 'export.tsv' })
    expect(file.format).toBe('tsv')
    expect(file.rows).toEqual([['1', '2']])
  })

  it('keeps whitespace (the Trim option decides later)', () => {
    expect(parseDelimited('a,b\n  x  ,y').rows[0][0]).toBe('  x  ')
  })

  it('drops fully blank rows and pads short rows', () => {
    const file = parseDelimited('a,b,c\n1,2,3\n,,\n\n4\n')
    expect(file.rows).toEqual([['1', '2', '3'], ['4', '', '']])
  })

  it('names blank headers and disambiguates repeats', () => {
    expect(uniqueHeaders(['Name', '', 'name', 'Name'])).toEqual(['Name', 'Column 2', 'name (2)', 'Name (3)'])
  })

  it('refuses a never-closed quote', () => {
    expect(() => parseDelimited('a,b\n"open,1')).toThrow(ImportFileError)
  })
})

describe('limits', () => {
  it('file size: 10 MB, and empty files', () => {
    expect(DATA_IMPORT_LIMITS.maxBytes).toBe(10 * 1024 * 1024)
    expect(() => checkFileSize(DATA_IMPORT_LIMITS.maxBytes + 1)).toThrow(/limit is 10 MB/)
    expect(() => checkFileSize(0)).toThrow(/empty/)
    expect(() => checkFileSize(1024)).not.toThrow()
  })

  it('rows: 50,000 data rows', () => {
    expect(DATA_IMPORT_LIMITS.maxRows).toBe(50_000)
    const ok = 'n\n' + '1\n'.repeat(DATA_IMPORT_LIMITS.maxRows)
    expect(parseDelimited(ok).rows).toHaveLength(DATA_IMPORT_LIMITS.maxRows)
    const tooMany = 'n\n' + '1\n'.repeat(DATA_IMPORT_LIMITS.maxRows + 1)
    expect(() => parseDelimited(tooMany)).toThrow(/limit is 50,000/)
  })

  it('columns: 200', () => {
    const header = Array.from({ length: DATA_IMPORT_LIMITS.maxColumns + 1 }, (_, i) => `c${i}`).join(',')
    expect(() => parseDelimited(`${header}\n1`)).toThrow(ImportFileError)
  })

  it('formatFromName', () => {
    expect(formatFromName('a.CSV')).toBe('csv')
    expect(formatFromName('a.tsv')).toBe('tsv')
    expect(formatFromName('a.xlsx')).toBe('xlsx')
    expect(formatFromName('a.xls')).toBeNull()
  })
})

describe('.xlsx', () => {
  async function workbook() {
    const wb = buildWorkbook([
      { name: 'Summary', arrays: [['Total'], [1]] },
      { name: 'Orders', arrays: [['Order', 'Amount', 'Due', 'Paid'], ['INV-1', 1234.5, new Date(Date.UTC(2026, 2, 31)), true], ['INV-2', 10, null, false]] },
    ])
    // A formula with a cached result: the result is read, never evaluated.
    wb.getWorksheet('Orders')!.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 1244.5 } as never
    wb.getWorksheet('Orders')!.getCell('A4').value = 'Total'
    return new Uint8Array(await workbookToBuffer(wb))
  }

  it('reads the first sheet by default and lists the sheets', async () => {
    const file = await parseXlsx(await workbook())
    expect(file.format).toBe('xlsx')
    expect(file.sheets).toEqual(['Summary', 'Orders'])
    expect(file.sheet).toBe('Summary')
    expect(file.headers).toEqual(['Total'])
  })

  it('reads a chosen sheet: numbers, ISO dates, booleans, formula results', async () => {
    const file = await parseXlsx(await workbook(), { sheet: 'Orders' })
    expect(file.headers).toEqual(['Order', 'Amount', 'Due', 'Paid'])
    expect(file.rows).toEqual([
      ['INV-1', '1234.5', '2026-03-31', 'TRUE'],
      ['INV-2', '10', '', 'FALSE'],
      ['Total', '1244.5', '', ''],
    ])
  })

  it('unknown sheet and non-xlsx bytes are refused with a message', async () => {
    await expect(parseXlsx(await workbook(), { sheet: 'Nope' })).rejects.toThrow(/no sheet named "Nope"/)
    await expect(parseXlsx(enc('a,b\n1,2'))).rejects.toThrow(/not a readable \.xlsx/)
  })
})
