/**
 * .xlsx for the data-table import, on ExcelJS. Load this module on demand
 * (`await import('@/lib/data-import/xlsx')`): the import wizard reads the
 * workbook in the browser (ExcelJS's browser build), the import service on
 * the server — same code, same result.
 *
 * Cells become plain text: numbers as written by JS (no locale), dates as
 * ISO 8601 (YYYY-MM-DD, or a full timestamp when the cell has a time),
 * formulas as their cached result (never evaluated), rich text joined.
 * The first used row is the header row.
 */

import ExcelJS from 'exceljs'
import { plainValue } from '@/lib/excel'
import { checkFileSize, DATA_IMPORT_LIMITS, finish, ImportFileError, type ParsedImportFile } from './parse'

/** Read one sheet (default: the first) of an .xlsx file. */
export async function parseXlsx(bytes: Uint8Array, options: { sheet?: string | null } = {}): Promise<ParsedImportFile> {
  checkFileSize(bytes.byteLength)
  const wb = new ExcelJS.Workbook()
  try {
    // A plain Uint8Array works in Node and in the browser build.
    await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new ImportFileError('This is not a readable .xlsx workbook. Save it as .xlsx (Excel Workbook) or CSV and try again.')
  }
  const sheets = wb.worksheets.map((ws) => ws.name)
  if (!sheets.length) throw new ImportFileError('The workbook has no sheets')
  const name = options.sheet?.trim() || sheets[0]
  const ws = wb.getWorksheet(name)
  if (!ws) throw new ImportFileError(`The workbook has no sheet named "${name}" (sheets: ${sheets.join(', ')})`)

  let top = Infinity, left = Infinity, bottom = 0, right = 0
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const v = plainValue(cell.value)
      if (v === null || v === '') return
      if (r < top) top = r
      if (r > bottom) bottom = r
      if (c < left) left = c
      if (c > right) right = c
    })
  })
  if (bottom === 0) throw new ImportFileError(`The sheet "${name}" is empty`)
  if (right - left + 1 > DATA_IMPORT_LIMITS.maxColumns) throw new ImportFileError(`The sheet has ${right - left + 1} columns; the limit is ${DATA_IMPORT_LIMITS.maxColumns}`)
  // Blank rows are dropped later; this only stops a runaway sheet early.
  if (bottom - top > DATA_IMPORT_LIMITS.maxRows * 2) {
    throw new ImportFileError(`The sheet has more than ${DATA_IMPORT_LIMITS.maxRows.toLocaleString('en-US')} rows. Split it into smaller files.`)
  }

  const text = (v: ReturnType<typeof plainValue>) => (v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))
  const matrix: string[][] = []
  for (let r = top; r <= bottom; r++) {
    const row = ws.getRow(r)
    const cells: string[] = []
    for (let c = left; c <= right; c++) cells.push(text(plainValue(row.getCell(c).value)))
    matrix.push(cells)
  }
  const [headers, ...rows] = matrix
  return finish({ format: 'xlsx', headers, rows, sheets, sheet: name })
}
