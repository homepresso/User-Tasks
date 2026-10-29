/**
 * Spreadsheets for the document actions: .xlsx (ExcelJS, after the bounded
 * ZIP check), .csv / .tsv (a quote-aware parser) and .ods (content.xml),
 * all turned into the same sheet shape — typed values, header detection,
 * ranges, formulas' computed values.
 */

import { openZip, type ZipReader } from './zip'
import { attr, descendants, elements, parseXml, textOf, type XmlElement } from './xml'
import { readOfficeProperties, type OfficeProperties } from './docx'
import { uniqueHeaders, type Block } from './model'
import { DOCUMENT_LIMITS, DocumentLimitError } from './limits'

export type Cell = string | number | boolean | null

export interface SheetOptions {
  /** Sheet name or 1-based index; empty → every sheet. */
  sheet?: string | number | null
  /** A1-style range (`B2:F40`, or `Sheet1!B2:F40`). */
  range?: string | null
  /** `auto` (default) detects the header row, `first` uses the first row, `none` keys columns `column_1…`, or a 1-based row number within the range. */
  headerRow?: 'auto' | 'first' | 'none' | number
  maxRows?: number
}

export interface SheetOut {
  name: string
  index: number
  /** Used range, A1 style. */
  range: string
  row_count: number
  column_count: number
  /** 1-based row of the header within the range, or null. */
  header_row: number | null
  headers: string[]
  /** Data rows as objects keyed by the headers. */
  rows: Record<string, Cell>[]
  /** Every row (header included) as arrays. */
  values: Cell[][]
  formulas: number
  truncated: boolean
}

/* ── A1 helpers ─────────────────────────────────────────────────────── */

export function colLetter(n: number): string {
  let s = ''
  let x = n
  while (x > 0) {
    const m = (x - 1) % 26
    s = String.fromCharCode(65 + m) + s
    x = Math.floor((x - 1) / 26)
  }
  return s || 'A'
}

export function colNumber(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export interface A1Range { sheet?: string; top: number; left: number; bottom: number; right: number }

export function parseRange(raw: string): A1Range {
  const text = raw.trim()
  const bang = text.lastIndexOf('!')
  const sheet = bang > 0 ? text.slice(0, bang).replace(/^'(.*)'$/, '$1') : undefined
  const ref = (bang > 0 ? text.slice(bang + 1) : text).replace(/\$/g, '').toUpperCase()
  const m = /^([A-Z]{1,3})?(\d{1,7})?(?::([A-Z]{1,3})?(\d{1,7})?)?$/.exec(ref)
  if (!m || (!m[1] && !m[2])) throw new Error(`Invalid range "${raw}" — use A1 style such as B2:F40`)
  const left = m[1] ? colNumber(m[1]) : 1
  const top = m[2] ? Number(m[2]) : 1
  const right = m[3] ? colNumber(m[3]) : m[4] ? 16384 : (m[1] && !m[2] ? left : 16384)
  const bottom = m[4] ? Number(m[4]) : m[3] && !m[4] ? 1_048_576 : (m[2] && !m[1] ? top : 1_048_576)
  return { sheet, top, left, bottom: Math.max(top, bottom), right: Math.max(left, right) }
}

/* ── Matrix → sheet ─────────────────────────────────────────────────── */

const isBlank = (v: Cell) => v === null || v === ''

function detectHeader(values: Cell[][]): number | null {
  const width = Math.max(0, ...values.slice(0, 15).map((x) => x.filter((v) => !isBlank(v)).length))
  for (let r = 0; r < Math.min(values.length - 1, 10); r++) {
    const row = values[r]
    const filled = row.filter((v) => !isBlank(v))
    // Blank rows and title rows above the table (fewer than half the columns) are skipped.
    if (filled.length < Math.max(1, Math.ceil(width * 0.5))) continue
    const allText = filled.every((v) => typeof v === 'string' && !/^[-+]?\d+([.,]\d+)?$/.test(v.trim()))
    const unique = new Set(filled.map((v) => String(v).trim().toLowerCase())).size === filled.length
    return allText && unique ? r : null
  }
  return null
}

export function matrixToSheet(name: string, index: number, matrix: Cell[][], options: SheetOptions, formulas = 0, origin = { top: 1, left: 1 }, truncated = false): SheetOut {
  // Trim trailing blank rows / columns.
  let values = matrix.map((r) => r.slice())
  while (values.length && values[values.length - 1].every(isBlank)) values.pop()
  const width = Math.max(0, ...values.map((r) => {
    let w = r.length
    while (w > 0 && isBlank(r[w - 1])) w--
    return w
  }))
  values = values.map((r) => Array.from({ length: width }, (_, k) => (r[k] === undefined ? null : r[k])))
  const mode = options.headerRow ?? 'auto'
  let headerIdx: number | null
  if (mode === 'none') headerIdx = null
  else if (mode === 'first') headerIdx = values.findIndex((r) => r.some((v) => !isBlank(v)))
  else if (typeof mode === 'number') headerIdx = mode - 1 < values.length ? Math.max(0, mode - 1) : null
  else headerIdx = detectHeader(values)
  if (headerIdx !== null && headerIdx < 0) headerIdx = null
  const headers = headerIdx === null
    ? Array.from({ length: width }, (_, k) => `column_${k + 1}`)
    : uniqueHeaders(values[headerIdx].map((v) => (v === null ? '' : String(v).trim())))
  const body = headerIdx === null ? values : values.slice(headerIdx + 1)
  let rows = body.filter((r) => r.some((v) => !isBlank(v))).map((r) => Object.fromEntries(headers.map((h, k) => [h, r[k] ?? null])))
  let cut = truncated
  if (options.maxRows && rows.length > options.maxRows) {
    rows = rows.slice(0, options.maxRows)
    cut = true
  }
  const range = values.length && width
    ? `${colLetter(origin.left)}${origin.top}:${colLetter(origin.left + width - 1)}${origin.top + values.length - 1}`
    : ''
  return {
    name,
    index,
    range,
    row_count: rows.length,
    column_count: width,
    header_row: headerIdx === null ? null : headerIdx + 1,
    headers,
    rows,
    values: options.maxRows ? values.slice(0, options.maxRows + (headerIdx ?? -1) + 1) : values,
    formulas,
    truncated: cut,
  }
}

function pickSheets<T extends { name: string }>(all: T[], options: SheetOptions, rangeSheet?: string): Array<{ item: T; index: number }> {
  const wanted = rangeSheet ?? options.sheet
  const indexed = all.map((item, index) => ({ item, index: index + 1 }))
  if (wanted === undefined || wanted === null || wanted === '') return indexed
  const asNumber = typeof wanted === 'number' ? wanted : /^\d+$/.test(String(wanted)) ? Number(wanted) : NaN
  const found = indexed.filter(({ item, index }) => item.name === String(wanted) || item.name.toLowerCase() === String(wanted).toLowerCase() || index === asNumber)
  if (!found.length) throw new Error(`Sheet "${wanted}" not found (sheets: ${all.map((s) => s.name).join(', ')})`)
  return found.slice(0, 1)
}

/* ── XLSX ───────────────────────────────────────────────────────────── */

export interface WorkbookRead {
  sheets: SheetOut[]
  sheetNames: string[]
  properties: OfficeProperties | null
  definedNames: string[]
}

export async function readXlsx(bytes: Uint8Array, options: SheetOptions = {}): Promise<WorkbookRead> {
  const zip = openZip(bytes)
  if (!zip.has('xl/workbook.xml')) throw new Error('Not an Excel workbook (xl/workbook.xml is missing)')
  // Inflate every part once under the caps before ExcelJS sees the file.
  zip.verifyAll()
  const definedNames = (() => {
    const xml = zip.readText('xl/workbook.xml')
    return xml ? descendants(parseXml(xml), 'definedName').map((d) => attr(d, 'name') ?? '').filter((n) => n && !n.startsWith('_xlnm')) : []
  })()
  const properties = readOfficeProperties(zip)
  const { loadWorkbook, plainValue } = await import('@/lib/excel')
  const wb = await loadWorkbook(bytes)
  const range = options.range ? parseRange(options.range) : null
  const out: SheetOut[] = []
  let cells = 0
  for (const { item: ws, index } of pickSheets(wb.worksheets, options, range?.sheet)) {
    const dims = ws.dimensions as unknown as { top: number; left: number; bottom: number; right: number } | undefined
    if (!dims || !ws.actualRowCount) {
      out.push(matrixToSheet(ws.name, index, [], options))
      continue
    }
    const top = Math.max(dims.top, range?.top ?? 1)
    const left = Math.max(dims.left, range?.left ?? 1)
    const bottom = Math.min(dims.bottom, range?.bottom ?? Infinity)
    const right = Math.min(dims.right, range?.right ?? Infinity)
    const matrix: Cell[][] = []
    let formulas = 0
    let truncated = false
    for (let r = top; r <= bottom; r++) {
      const row = ws.getRow(r)
      const arr: Cell[] = []
      for (let c = left; c <= right; c++) {
        const cell = row.getCell(c)
        const raw = cell.value as unknown
        if (raw && typeof raw === 'object' && ('formula' in (raw as object) || 'sharedFormula' in (raw as object))) formulas++
        arr.push(plainValue(cell.value))
      }
      matrix.push(arr)
      cells += arr.length
      if (cells > DOCUMENT_LIMITS.maxCells) { truncated = true; break }
    }
    out.push(matrixToSheet(ws.name, index, matrix, options, formulas, { top, left }, truncated))
    if (cells > DOCUMENT_LIMITS.maxCells) break
  }
  return { sheets: out, sheetNames: wb.worksheets.map((w) => w.name), properties, definedNames }
}

/* ── CSV ────────────────────────────────────────────────────────────── */

/** RFC 4180-ish: quoted fields with embedded delimiters, quotes and newlines. */
export function parseCsv(text: string, delimiter?: string, maxCells = DOCUMENT_LIMITS.maxCells): Cell[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delim = delimiter || sniffDelimiter(src)
  const rows: Cell[][] = []
  let row: Cell[] = []
  let field = ''
  let quoted = false
  let wasQuoted = false
  let cells = 0
  const pushField = () => {
    row.push(wasQuoted ? field : field.trim())
    field = ''
    wasQuoted = false
    if (++cells > maxCells) throw new DocumentLimitError('The CSV file has too many cells')
  }
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field.trim() === '') { quoted = true; wasQuoted = true; field = ''; continue }
    if (ch === delim) { pushField(); continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      pushField()
      rows.push(row)
      row = []
      continue
    }
    field += ch
  }
  if (field !== '' || wasQuoted || row.length) { pushField(); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 5000).split(/\r?\n/).slice(0, 10).join('\n')
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestScore = 0
  for (const c of candidates) {
    const counts = sample.split('\n').filter(Boolean).map((l) => l.split(c).length - 1)
    if (!counts.length || counts[0] === 0) continue
    const consistent = counts.filter((n) => n === counts[0]).length / counts.length
    const score = counts[0] * consistent
    if (score > bestScore) { bestScore = score; best = c }
  }
  return best
}

/** CSV text cells → typed values (numbers, booleans) when `typed`. */
export function typeCell(v: Cell): Cell {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t === '') return ''
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'
  if (/^[-+]?(\d+|\d*\.\d+)([eE][-+]?\d+)?$/.test(t) && !/^[-+]?0\d/.test(t)) {
    const n = Number(t)
    if (Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER) return n
  }
  return v
}

export function readCsv(text: string, options: SheetOptions & { delimiter?: string; typed?: boolean; name?: string } = {}): SheetOut {
  let matrix = parseCsv(text, options.delimiter)
  if (options.typed !== false) matrix = matrix.map((r) => r.map(typeCell))
  const range = options.range ? parseRange(options.range) : null
  if (range) matrix = matrix.slice(range.top - 1, range.bottom).map((r) => r.slice(range.left - 1, range.right))
  return matrixToSheet(options.name ?? 'Sheet1', 1, matrix, options, 0, { top: range?.top ?? 1, left: range?.left ?? 1 })
}

export function toCsv(rows: Cell[][], delimiter = ','): string {
  const q = (v: Cell) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'string' ? v : String(v)
    // Spreadsheet formula injection: prefix cells that would run as formulas.
    const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s
    return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return rows.map((r) => r.map(q).join(delimiter)).join('\r\n')
}

/* ── ODS / ODF ──────────────────────────────────────────────────────── */

function odsCellValue(cell: XmlElement): Cell {
  const type = attr(cell, 'value-type')
  const value = attr(cell, 'value')
  if (type === 'float' || type === 'percentage' || type === 'currency') return value !== undefined ? Number(value) : null
  if (type === 'boolean') return attr(cell, 'boolean-value') === 'true'
  if (type === 'date') return attr(cell, 'date-value') ?? null
  const text = elements(cell).filter((e) => e.local === 'p').map(textOf).join('\n')
  return text === '' ? null : text
}

export function readOdsZip(zip: ZipReader, options: SheetOptions = {}): WorkbookRead {
  const xml = zip.readText('content.xml')
  if (!xml) throw new Error('Not an OpenDocument file (content.xml is missing)')
  const tables = descendants(parseXml(xml), 'table')
  const range = options.range ? parseRange(options.range) : null
  const all = tables.map((t) => ({ name: attr(t, 'name') ?? 'Sheet', el: t }))
  const sheets: SheetOut[] = []
  let cells = 0
  for (const { item, index } of pickSheets(all, options, range?.sheet)) {
    const matrix: Cell[][] = []
    for (const row of descendants(item.el, 'table-row')) {
      const repeatRows = Math.min(Number(attr(row, 'number-rows-repeated') ?? 1), 1000)
      const arr: Cell[] = []
      for (const cell of elements(row).filter((e) => e.local === 'table-cell' || e.local === 'covered-table-cell')) {
        const repeat = Math.min(Number(attr(cell, 'number-columns-repeated') ?? 1), 1000)
        const v = odsCellValue(cell)
        for (let k = 0; k < repeat; k++) arr.push(v)
      }
      for (let k = 0; k < repeatRows; k++) matrix.push(arr)
      cells += arr.length * repeatRows
      if (cells > DOCUMENT_LIMITS.maxCells) break
    }
    const sliced = range ? matrix.slice(range.top - 1, range.bottom).map((r) => r.slice(range.left - 1, range.right)) : matrix
    sheets.push(matrixToSheet(item.name, index, sliced, options, 0, { top: range?.top ?? 1, left: range?.left ?? 1 }))
  }
  return { sheets, sheetNames: all.map((t) => t.name), properties: null, definedNames: [] }
}

/** OpenDocument text (.odt) / presentation (.odp): headings, paragraphs, lists, tables. */
export function readOdfTextZip(zip: ZipReader): Block[] {
  const xml = zip.readText('content.xml')
  if (!xml) throw new Error('Not an OpenDocument file (content.xml is missing)')
  const body = descendants(parseXml(xml), 'body')[0]
  const blocks: Block[] = []
  const walk = (node: XmlElement, listLevel: number) => {
    for (const el of elements(node)) {
      if (el.local === 'h') blocks.push({ type: 'heading', level: Number(attr(el, 'outline-level') ?? 1), inlines: [{ text: textOf(el) }] })
      else if (el.local === 'p') {
        if (listLevel >= 0) blocks.push({ type: 'list_item', ordered: false, level: listLevel, inlines: [{ text: textOf(el) }] })
        else blocks.push({ type: 'paragraph', inlines: [{ text: textOf(el) }] })
      } else if (el.local === 'list') walk(el, listLevel + 1)
      else if (el.local === 'table') {
        const rows = descendants(el, 'table-row').map((r) => elements(r).filter((c) => c.local === 'table-cell').map((c) => descendants(c, 'p').map(textOf).join('\n')))
        blocks.push({ type: 'table', rows, header: true })
      } else if (el.local === 'page') {
        blocks.push({ type: 'heading', level: 2, inlines: [{ text: attr(el, 'name') ?? 'Slide' }] })
        walk(el, listLevel)
      } else walk(el, listLevel)
    }
  }
  if (body) walk(body, -1)
  return blocks
}

/** Rows (objects or arrays) → .xlsx bytes. */
export async function writeXlsx(sheets: Array<{ name: string; rows?: Record<string, unknown>[]; arrays?: unknown[][] }>): Promise<Buffer> {
  const xl = await import('@/lib/excel')
  const safe = sheets.map((s, k) => ({ ...s, name: (s.name || `Sheet${k + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${k + 1}` }))
  return xl.workbookToBuffer(xl.buildWorkbook(safe))
}

export function sheetBlocks(sheets: SheetOut[]): Block[] {
  const blocks: Block[] = []
  for (const s of sheets) {
    blocks.push({ type: 'heading', level: 2, inlines: [{ text: s.name }] })
    const rows = s.values.map((r) => r.map((v) => (v === null ? '' : String(v))))
    if (rows.length) blocks.push({ type: 'table', rows: s.header_row ? rows.slice(s.header_row - 1) : rows, header: s.header_row !== null })
  }
  return blocks
}

