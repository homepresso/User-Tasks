/**
 * Server-side .xlsx helpers on ExcelJS (replaces the abandoned SheetJS 0.18
 * build). Only server code imports this module — load it with a dynamic
 * `import('@/lib/excel')` so the engine's cold start and the client bundles
 * never pull ExcelJS in.
 *
 * Reading mirrors SheetJS `sheet_to_json` semantics the workflow nodes relied
 * on: the first used row is the header row (duplicate headers get `_1`, `_2`
 * suffixes, blank ones `__EMPTY`), blank rows are skipped for objects and kept
 * for arrays, formulas yield their cached result. Date cells become ISO 8601
 * strings (`YYYY-MM-DD` when there is no time part) rather than serial numbers.
 */

import ExcelJS from 'exceljs'

export const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export type CellValue = string | number | boolean | null

type Workbook = ExcelJS.Workbook
type Worksheet = ExcelJS.Worksheet

/** Loads an .xlsx workbook. Other formats (.xls, .csv, .ods) are rejected with a clear error. */
export async function loadWorkbook(data: ArrayBuffer | Uint8Array): Promise<Workbook> {
  const wb = new ExcelJS.Workbook()
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  try {
    // ExcelJS's typings want a Node Buffer; a Uint8Array view works the same.
    await wb.xlsx.load(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as ArrayBuffer)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`Not a readable .xlsx workbook (only .xlsx is supported): ${msg}`)
  }
  return wb
}

export function sheetNames(wb: Workbook): string[] {
  return wb.worksheets.map((ws) => ws.name)
}

/** A sheet by name, or the first sheet when no name is given. */
export function getSheet(wb: Workbook, name?: string | null): Worksheet | undefined {
  return name ? wb.getWorksheet(name) : wb.worksheets[0]
}

/** The plain value of a cell: rich text joined, formulas → cached result, dates → ISO strings. */
export function plainValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return dateToIso(value)
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('')
    if ('formula' in value || 'sharedFormula' in value) {
      return 'result' in value && value.result !== undefined ? plainValue(value.result as ExcelJS.CellValue) : null
    }
    if ('hyperlink' in value && 'text' in value) return plainValue(value.text as ExcelJS.CellValue)
    if ('error' in value) return String(value.error)
  }
  return String(value)
}

function dateToIso(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  const iso = d.toISOString()
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
}

/** Bounds of the used range (cells with a value), or null for an empty sheet. */
function usedRange(ws: Worksheet): { top: number; left: number; bottom: number; right: number } | null {
  let top = Infinity, left = Infinity, bottom = 0, right = 0
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (plainValue(cell.value) === null) return
      if (r < top) top = r
      if (r > bottom) bottom = r
      if (c < left) left = c
      if (c > right) right = c
    })
  })
  return bottom === 0 ? null : { top, left, bottom, right }
}

/** Rows as arrays (first used row included), like SheetJS `sheet_to_json(ws, { header: 1 })`. */
export function sheetToArrays(ws: Worksheet, opts: { defval?: CellValue } = {}): CellValue[][] {
  const range = usedRange(ws)
  if (!range) return []
  const out: CellValue[][] = []
  for (let r = range.top; r <= range.bottom; r++) {
    const row = ws.getRow(r)
    const arr: CellValue[] = []
    for (let c = range.left; c <= range.right; c++) {
      const v = plainValue(row.getCell(c).value)
      if (v !== null) arr[c - range.left] = v
      else if (opts.defval !== undefined) arr[c - range.left] = opts.defval
    }
    out.push(arr)
  }
  return out
}

/** Rows as objects keyed by the header row, like SheetJS `sheet_to_json(ws)`. Blank rows are skipped. */
export function sheetToObjects(ws: Worksheet, opts: { defval?: CellValue } = {}): Record<string, CellValue>[] {
  const range = usedRange(ws)
  if (!range) return []
  const headerRow = ws.getRow(range.top)
  const seen: Record<string, number> = {}
  const headers: string[] = []
  for (let c = range.left; c <= range.right; c++) {
    const raw = plainValue(headerRow.getCell(c).value)
    const base = raw === null || raw === '' ? '__EMPTY' : String(raw)
    let key = base
    if (seen[base]) key = `${base}_${seen[base]}`
    seen[base] = (seen[base] ?? 0) + 1
    headers.push(key)
  }
  const out: Record<string, CellValue>[] = []
  for (let r = range.top + 1; r <= range.bottom; r++) {
    const row = ws.getRow(r)
    const obj: Record<string, CellValue> = {}
    let empty = true
    headers.forEach((h, i) => {
      const v = plainValue(row.getCell(range.left + i).value)
      if (v !== null) { obj[h] = v; empty = false }
      else if (opts.defval !== undefined) obj[h] = opts.defval
    })
    if (!empty) out.push(obj)
  }
  return out
}

/** A JS value as something a cell can hold (objects/arrays as JSON text). */
export function toCell(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value
  if (typeof value === 'bigint') return value.toString()
  return JSON.stringify(value)
}

/** Header = union of keys in first-seen order (SheetJS `json_to_sheet`). */
function objectHeaders(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    for (const k of Object.keys(row)) if (!seen.has(k)) { seen.add(k); keys.push(k) }
  }
  return keys
}

/** Writes arrays of rows into `ws` starting at (row, col). */
function writeArrays(ws: Worksheet, rows: unknown[][], top: number, left: number): void {
  rows.forEach((values, i) => {
    const row = ws.getRow(top + i)
    values.forEach((v, j) => {
      const cell = toCell(v)
      if (cell !== null) row.getCell(left + j).value = cell
    })
    row.commit()
  })
}

const CELL_REF = /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]{0,6}$/

export function isCellRef(ref: string): boolean {
  return CELL_REF.test(ref.trim())
}

/**
 * Appends objects as a table at `origin` (default A1): a header row of their
 * keys unless `skipHeader`, then one row per object (SheetJS `sheet_add_json`).
 */
export function addObjects(
  ws: Worksheet,
  rows: Record<string, unknown>[],
  opts: { origin?: string; skipHeader?: boolean } = {},
): void {
  const origin = (opts.origin ?? 'A1').trim()
  if (!isCellRef(origin)) throw new Error(`Invalid cell reference "${origin}"`)
  const start = ws.getCell(origin.replace(/\$/g, '').toUpperCase())
  const headers = objectHeaders(rows)
  const matrix: unknown[][] = rows.map((r) => headers.map((h) => (r && typeof r === 'object' ? r[h] : undefined)))
  if (!opts.skipHeader) matrix.unshift(headers)
  writeArrays(ws, matrix, Number(start.row), Number(start.col))
}

/** New workbook with one sheet per entry: objects (header from keys) or arrays of rows. */
export function buildWorkbook(sheets: { name: string; rows?: Record<string, unknown>[]; arrays?: unknown[][] }[]): Workbook {
  const wb = new ExcelJS.Workbook()
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name)
    if (s.arrays) writeArrays(ws, s.arrays, 1, 1)
    else if (s.rows?.length) addObjects(ws, s.rows)
  }
  return wb
}

export async function workbookToBuffer(wb: Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer())
}
