/**
 * Data-table import: header matching, column type inference, date order
 * detection and row validation (pure; the wizard previews with exactly the
 * code the import service runs).
 *
 * Values are stored as plain data: text stays text (a leading "=" is never
 * evaluated, here or later), numbers are parsed from "1,234.50",
 * "$1,234.50", "USD 1,234.50", "(12.00)" or "1.234,50", dates become
 * YYYY-MM-DD (the date column's format), booleans true / false, and
 * choices the column's own spelling.
 */

import { slugifyColumnName } from '@/lib/data-table-cells'

/** Column types an import can write (file columns cannot be filled from a file). */
export const IMPORTABLE_COLUMN_TYPES = ['text', 'longtext', 'number', 'date', 'boolean', 'select', 'lookup'] as const
export type ImportableColumnType = (typeof IMPORTABLE_COLUMN_TYPES)[number]

/** System columns filled by the table itself. */
export const SYSTEM_COLUMN_KEYS = ['id', 'date_created'] as const

export interface ImportTargetColumn {
  key: string
  name: string
  type: string
  required?: boolean
  options?: string[]
}

/** File header → table column key (null = skip the header). */
export type ImportMapping = Record<string, string | null>

export type DateOrder = 'dmy' | 'mdy' | 'ymd'
export type EmptyCells = 'empty' | 'ignore'

export interface ImportRowOptions {
  /** Trim leading / trailing whitespace (default true). */
  trim?: boolean
  /** Order of day / month in numeric dates such as 03/04/2026 (default: detected). */
  date_order?: DateOrder | 'auto' | null
  /**
   * empty (default): an empty cell clears the column (null);
   * ignore: an empty cell leaves the column out (an upsert keeps its value).
   */
  empty_cells?: EmptyCells
}

export interface ImportRowError {
  /** Spreadsheet row number: the header is row 1, the first data row row 2. */
  row: number
  /** File header. */
  column: string
  value: string
  reason: string
}

export interface ValidatedRow {
  /** Spreadsheet row number (header = 1). */
  row: number
  /** Index in the parsed data rows. */
  index: number
  data: Record<string, unknown>
}

export interface ValidationResult {
  valid: ValidatedRow[]
  /** Indexes of rows with at least one error. */
  invalidRows: number[]
  errors: ImportRowError[]
  dateOrder: DateOrder
}

// ─── Headers ────────────────────────────────────────────────────────────────

/** Header / column name for matching: case-insensitive, spaces, underscores and hyphens ignored. */
export function normalizeHeader(value: string): string {
  return String(value ?? '').toLowerCase().replace(/[\s_\-]+/g, '')
}

export function isImportableColumn(column: ImportTargetColumn): boolean {
  return !SYSTEM_COLUMN_KEYS.includes(column.key as (typeof SYSTEM_COLUMN_KEYS)[number])
    && (IMPORTABLE_COLUMN_TYPES as readonly string[]).includes(column.type)
}

/**
 * Header → column by name or key (normalised); each column is used once,
 * first header wins. Unmatched headers map to null (skip).
 */
export function autoMatchHeaders(headers: readonly string[], columns: readonly ImportTargetColumn[]): ImportMapping {
  const targets = columns.filter(isImportableColumn)
  const used = new Set<string>()
  const mapping: ImportMapping = {}
  for (const header of headers) {
    const h = normalizeHeader(header)
    const match = h ? targets.find((col) => !used.has(col.key) && (normalizeHeader(col.name) === h || normalizeHeader(col.key) === h)) : undefined
    mapping[header] = match ? match.key : null
    if (match) used.add(match.key)
  }
  return mapping
}

/** A mapping checked against the headers and columns: unknown headers are dropped, unknown / repeated / system columns refused. */
export function resolveMapping(headers: readonly string[], columns: readonly ImportTargetColumn[], requested?: ImportMapping | null): { mapping: ImportMapping; problems: string[] } {
  const auto = autoMatchHeaders(headers, columns)
  if (!requested) return { mapping: auto, problems: [] }
  const byKey = new Map(columns.map((col) => [col.key, col]))
  const byName = new Map(columns.map((col) => [normalizeHeader(col.name), col]))
  const headerSet = new Map(headers.map((h) => [normalizeHeader(h), h]))
  const problems: string[] = []
  const mapping: ImportMapping = Object.fromEntries(headers.map((h) => [h, null]))
  const used = new Map<string, string>()
  for (const [rawHeader, target] of Object.entries(requested)) {
    const header = headers.includes(rawHeader) ? rawHeader : headerSet.get(normalizeHeader(rawHeader))
    if (!header) { problems.push(`The file has no column "${rawHeader}"`); continue }
    if (target === null || target === undefined || target === '') { mapping[header] = null; continue }
    const column = byKey.get(target) ?? byName.get(normalizeHeader(target)) ?? columns.find((col) => slugifyColumnName(col.name) === slugifyColumnName(target))
    if (!column) { problems.push(`"${header}" maps to "${target}", which is not a column of this table`); continue }
    if (!isImportableColumn(column)) { problems.push(`"${column.name}" cannot be imported into (${SYSTEM_COLUMN_KEYS.includes(column.key as never) ? 'system column' : `${column.type} column`})`); continue }
    if (used.has(column.key)) { problems.push(`"${header}" and "${used.get(column.key)}" both map to "${column.name}"`); continue }
    used.set(column.key, header)
    mapping[header] = column.key
  }
  // Headers the request did not mention keep their automatic match when that column is still free.
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(requested, header) || Object.keys(requested).some((k) => normalizeHeader(k) === normalizeHeader(header))) continue
    const key = auto[header]
    if (key && !used.has(key)) { mapping[header] = key; used.set(key, header) }
  }
  return { mapping, problems }
}

// ─── Values ─────────────────────────────────────────────────────────────────

const CURRENCY = /^(?:US\$|USD|EUR|GBP|AUD|NZD|CAD|[$€£¥₹])\s*|\s*(?:US\$|USD|EUR|GBP|AUD|NZD|CAD|[$€£¥₹])$/i

/** "1,234.50", "$1,234.50", "USD 1,234.50", "(12.00)", "-12", "1.234,50", "1e3" → number; anything else null. */
export function parseNumber(raw: string): number | null {
  let s = String(raw ?? '').trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim() }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim() }
  else if (s.startsWith('+')) s = s.slice(1).trim()
  s = s.replace(CURRENCY, '').trim()
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim() }
  s = s.replace(/[\s  ]/g, '')
  let n: number
  if (/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s) || /^\.\d+$/.test(s)) n = Number(s)
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) n = Number(s.replace(/,/g, ''))
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'))
  else if (/^\d{1,3}('\d{3})+(\.\d+)?$/.test(s)) n = Number(s.replace(/'/g, ''))
  else return null
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

export function hasCurrency(raw: string): boolean {
  return CURRENCY.test(String(raw ?? '').trim().replace(/^[(\-+]\s*/, '').replace(/\)$/, ''))
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'x', '✓', '✔'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off', 'unchecked'])

export function parseBoolean(raw: string): boolean | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (TRUE_WORDS.has(s)) return true
  if (FALSE_WORDS.has(s)) return false
  return null
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const TIME = String.raw`(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(am|pm)?\s*(Z|[+-]\d{2}:?\d{2})?)?`
const ISO_DATE = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME}$`, 'i')
const NUMERIC_DATE = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})${TIME}$`, 'i')
const NAMED_DMY = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]+([a-z]{3,9})\.?,?[\s\-/.]+(\d{2}|\d{4})${TIME}$`, 'i')
const NAMED_MDY = new RegExp(String.raw`^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?[\s\-/.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-/.]+(\d{2}|\d{4})${TIME}$`, 'i')

export interface ParsedDate {
  year: number
  month: number
  day: number
  /** "HH:MM" or "HH:MM:SS" when the value has a time. */
  time?: string
  /** Day / month order mattered (both parts ≤ 12, numeric). */
  ambiguous?: boolean
}

function fullYear(y: string): number {
  const n = Number(y)
  if (y.length === 4) return n
  return n < 70 ? 2000 + n : 1900 + n
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000 || year > 9999) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

function timeOf(h?: string, m?: string, s?: string, ampm?: string): string | undefined | null {
  if (h === undefined) return undefined
  let hour = Number(h)
  if (ampm) {
    if (hour < 1 || hour > 12) return null
    if (ampm.toLowerCase() === 'pm' && hour < 12) hour += 12
    if (ampm.toLowerCase() === 'am' && hour === 12) hour = 0
  }
  if (hour > 23 || Number(m) > 59 || (s !== undefined && Number(s) > 59)) return null
  const pad = (n: number | string) => String(n).padStart(2, '0')
  return `${pad(hour)}:${pad(m!)}${s !== undefined && s !== '00' ? `:${pad(s)}` : ''}`
}

/** Read a date (optionally with a time). `order` decides numeric dates like 03/04/2026. */
export function parseDateValue(raw: string, order: DateOrder = 'mdy'): ParsedDate | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  let m = s.match(ISO_DATE)
  if (m) {
    const [, y, mo, d, h, mi, se, ap] = m
    const time = timeOf(h, mi, se, ap)
    if (time === null || !validDate(Number(y), Number(mo), Number(d))) return null
    return { year: Number(y), month: Number(mo), day: Number(d), ...(time ? { time } : {}) }
  }
  m = s.match(NUMERIC_DATE)
  if (m) {
    const [, a, b, y, h, mi, se, ap] = m
    const time = timeOf(h, mi, se, ap)
    if (time === null) return null
    const year = fullYear(y)
    const [day, month] = order === 'mdy' ? [Number(b), Number(a)] : [Number(a), Number(b)]
    if (!validDate(year, month, day)) return null
    return { year, month, day, ...(time ? { time } : {}), ...(Number(a) <= 12 && Number(b) <= 12 && a !== b ? { ambiguous: true } : {}) }
  }
  m = s.match(NAMED_DMY)
  if (m && MONTHS[m[2].toLowerCase()]) {
    const [, d, mon, y, h, mi, se, ap] = m
    const time = timeOf(h, mi, se, ap)
    const month = MONTHS[mon.toLowerCase()]
    if (time === null || !validDate(fullYear(y), month, Number(d))) return null
    return { year: fullYear(y), month, day: Number(d), ...(time ? { time } : {}) }
  }
  m = s.match(NAMED_MDY)
  if (m && MONTHS[m[1].toLowerCase()]) {
    const [, mon, d, y, h, mi, se, ap] = m
    const time = timeOf(h, mi, se, ap)
    const month = MONTHS[mon.toLowerCase()]
    if (time === null || !validDate(fullYear(y), month, Number(d))) return null
    return { year: fullYear(y), month, day: Number(d), ...(time ? { time } : {}) }
  }
  return null
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD (what date columns hold). */
export function isoDate(date: ParsedDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`
}

/**
 * Day / month order of numeric dates across values: a first part above 12
 * means day-first, a second part above 12 month-first. Undecided (every
 * value ambiguous, or none numeric) → `fallback`.
 */
export function detectDateOrder(values: Iterable<string>, fallback: DateOrder = 'mdy'): { order: DateOrder; ambiguous: boolean; conflicting: boolean } {
  let dayFirst = 0
  let monthFirst = 0
  let numeric = 0
  for (const raw of values) {
    const m = String(raw ?? '').trim().match(NUMERIC_DATE)
    if (!m) continue
    numeric++
    const a = Number(m[1])
    const b = Number(m[2])
    if (a > 12 && b <= 12) dayFirst++
    else if (b > 12 && a <= 12) monthFirst++
  }
  if (dayFirst && monthFirst) return { order: dayFirst >= monthFirst ? 'dmy' : 'mdy', ambiguous: false, conflicting: true }
  if (dayFirst) return { order: 'dmy', ambiguous: false, conflicting: false }
  if (monthFirst) return { order: 'mdy', ambiguous: false, conflicting: false }
  return { order: fallback, ambiguous: numeric > 0, conflicting: false }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URL_RE = /^https?:\/\/[^\s]+$/i

// ─── Inference ──────────────────────────────────────────────────────────────

/** What a file column looks like ("detected"), and the table column type that holds it. */
export type DetectedKind = 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'choice' | 'email' | 'url' | 'empty'

export interface InferredColumn {
  header: string
  /** Suggested column name and key. */
  name: string
  key: string
  detected: DetectedKind
  /** Column type of this table that holds it (date & time, email and URL are text columns). */
  type: ImportableColumnType
  options?: string[]
  /** Non-empty values seen. */
  filled: number
}

/** Choice columns: at most this many distinct values, each repeated on average twice. */
export const CHOICE_MAX_OPTIONS = 12

export function inferColumn(header: string, values: readonly string[], order: DateOrder = 'mdy'): InferredColumn {
  const filled = values.map((v) => String(v ?? '').trim()).filter(Boolean)
  const base = { header, name: header.trim() || 'Column', key: slugifyColumnName(header) || 'column', filled: filled.length }
  if (!filled.length) return { ...base, detected: 'empty', type: 'text' }
  const all = (test: (v: string) => boolean) => filled.every(test)
  // From 20 values on, up to 5% may fail the type: they are typos / bad rows the check step reports, not text.
  const tolerance = filled.length >= 20 ? Math.floor(filled.length * 0.05) : 0
  const mostly = (test: (v: string) => boolean) => filled.reduce((bad, v) => bad + (test(v) ? 0 : 1), 0) <= tolerance
  const isBoolWord = (v: string) => parseBoolean(v) !== null && !/^[01]$/.test(v)
  if (all(isBoolWord)) return { ...base, detected: 'boolean', type: 'boolean' }
  if (mostly((v) => parseNumber(v) !== null)) {
    return { ...base, detected: filled.some((v) => parseNumber(v) !== null && hasCurrency(v)) ? 'currency' : 'number', type: 'number' }
  }
  const dates = filled.map((v) => parseDateValue(v, order))
  if (dates.filter((d) => !d).length <= tolerance) {
    return dates.some((d) => d?.time) ? { ...base, detected: 'datetime', type: 'text' } : { ...base, detected: 'date', type: 'date' }
  }
  if (all((v) => EMAIL.test(v))) return { ...base, detected: 'email', type: 'text' }
  if (all((v) => URL_RE.test(v))) return { ...base, detected: 'url', type: 'text' }
  if (filled.some((v) => v.length > 255 || /[\r\n]/.test(v))) return { ...base, detected: 'longtext', type: 'longtext' }
  const distinct: string[] = []
  const seen = new Set<string>()
  for (const v of filled) {
    const k = v.toLowerCase()
    if (!seen.has(k)) { seen.add(k); distinct.push(v) }
  }
  if (filled.length >= 4 && distinct.length <= CHOICE_MAX_OPTIONS && distinct.length * 2 <= filled.length && distinct.every((v) => v.length <= 60)) {
    return { ...base, detected: 'choice', type: 'select', options: distinct }
  }
  return { ...base, detected: 'text', type: 'text' }
}

/** Every header's inferred column; keys are unique and never a system key. */
export function inferColumns(headers: readonly string[], rows: readonly string[][], order?: DateOrder): InferredColumn[] {
  const dateOrder = order ?? detectDateOrder(rows.flatMap((r) => r)).order
  const keys = new Set<string>(SYSTEM_COLUMN_KEYS)
  return headers.map((header, i) => {
    const col = inferColumn(header, rows.map((r) => r[i] ?? ''), dateOrder)
    let key = col.key
    for (let n = 2; keys.has(key); n++) key = `${col.key}_${n}`
    keys.add(key)
    return { ...col, key }
  })
}

export const DETECTED_LABELS: Record<DetectedKind, string> = {
  text: 'Text', longtext: 'Long text', number: 'Number', currency: 'Currency (number)', date: 'Date',
  datetime: 'Date & time (text)', boolean: 'Yes / no', choice: 'Choice', email: 'Email (text)', url: 'URL (text)', empty: 'Empty',
}

// ─── Validation ─────────────────────────────────────────────────────────────

function convert(column: ImportTargetColumn, value: string, order: DateOrder): { ok: true; value: unknown } | { ok: false; reason: string } {
  switch (column.type) {
    case 'number': {
      const n = parseNumber(value)
      return n === null ? { ok: false, reason: 'Not a number' } : { ok: true, value: n }
    }
    case 'boolean': {
      const b = parseBoolean(value)
      return b === null ? { ok: false, reason: 'Not a yes / no value (use true / false, yes / no or 1 / 0)' } : { ok: true, value: b }
    }
    case 'date': {
      const d = parseDateValue(value, order)
      return d ? { ok: true, value: isoDate(d) } : { ok: false, reason: `Not a date (expected e.g. 2026-03-31 or ${order === 'dmy' ? '31/03/2026' : '03/31/2026'})` }
    }
    case 'select': {
      const options = (column.options ?? []).map(String)
      if (!options.length) return { ok: true, value }
      const match = options.find((o) => o === value) ?? options.find((o) => o.trim().toLowerCase() === value.trim().toLowerCase())
      if (match !== undefined) return { ok: true, value: match }
      const shown = options.slice(0, 8).join(', ') + (options.length > 8 ? ', …' : '')
      return { ok: false, reason: `Not one of the choices (${shown})` }
    }
    default:
      // text, longtext, lookup: stored exactly as text, never evaluated.
      return { ok: true, value }
  }
}

/**
 * Validate and convert every row. `columns` are the table's columns (incl.
 * ones about to be created); `mapping` header → column key.
 */
export function validateRows(
  headers: readonly string[],
  rows: readonly string[][],
  columns: readonly ImportTargetColumn[],
  mapping: ImportMapping,
  options: ImportRowOptions = {},
): ValidationResult {
  const trim = options.trim ?? true
  const emptyCells = options.empty_cells ?? 'empty'
  const byKey = new Map(columns.map((col) => [col.key, col]))
  const mapped = headers
    .map((header, index) => ({ header, index, column: mapping[header] ? byKey.get(mapping[header]!) : undefined }))
    .filter((m): m is { header: string; index: number; column: ImportTargetColumn } => Boolean(m.column))
  const dateHeaders = mapped.filter((m) => m.column.type === 'date')
  const order: DateOrder = options.date_order && options.date_order !== 'auto'
    ? options.date_order
    : detectDateOrder(dateHeaders.flatMap((m) => rows.map((r) => r[m.index] ?? ''))).order
  // Required columns the file does not fill at all.
  const requiredMissing = columns.filter((col) => col.required && isImportableColumn(col) && !mapped.some((m) => m.column.key === col.key))

  const valid: ValidatedRow[] = []
  const invalidRows: number[] = []
  const errors: ImportRowError[] = []
  rows.forEach((cells, index) => {
    const rowNumber = index + 2
    const data: Record<string, unknown> = {}
    let bad = false
    for (const m of mapped) {
      const raw = String(cells[m.index] ?? '')
      const value = trim ? raw.trim() : raw
      if (value.trim() === '') {
        if (m.column.required) {
          errors.push({ row: rowNumber, column: m.header, value: raw, reason: `Required: "${m.column.name}" cannot be empty` })
          bad = true
        } else if (emptyCells === 'empty') data[m.column.key] = null
        continue
      }
      const converted = convert(m.column, value, order)
      if (converted.ok) data[m.column.key] = converted.value
      else {
        errors.push({ row: rowNumber, column: m.header, value: raw.slice(0, 200), reason: converted.reason })
        bad = true
      }
    }
    for (const col of requiredMissing) {
      errors.push({ row: rowNumber, column: col.name, value: '', reason: `Required: "${col.name}" is not in the file` })
      bad = true
    }
    if (bad) invalidRows.push(index)
    else valid.push({ row: rowNumber, index, data })
  })
  return { valid, invalidRows, errors, dateOrder: order }
}

/**
 * Upsert keys: the key column's value per valid row, and errors for empty
 * keys and keys repeated in the file (the later row is refused).
 */
export function checkUpsertKeys(result: ValidationResult, keyColumn: ImportTargetColumn, keyHeader: string): ValidationResult {
  const seen = new Map<string, number>()
  const errors = [...result.errors]
  const invalid = new Set(result.invalidRows)
  const valid: ValidatedRow[] = []
  for (const row of result.valid) {
    const key = upsertKeyOf(row.data[keyColumn.key])
    if (key === null) {
      errors.push({ row: row.row, column: keyHeader, value: '', reason: `The key column "${keyColumn.name}" is empty, so the row cannot be matched` })
      invalid.add(row.index)
      continue
    }
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({ row: row.row, column: keyHeader, value: String(row.data[keyColumn.key]), reason: `Duplicate key: row ${first} has the same "${keyColumn.name}"` })
      invalid.add(row.index)
      continue
    }
    seen.set(key, row.row)
    valid.push(row)
  }
  errors.sort((a, b) => a.row - b.row)
  return { ...result, valid, errors, invalidRows: [...invalid].sort((a, b) => a - b) }
}

/** Comparable key value (numbers by value, text case-insensitively, trimmed); null when empty. */
export function upsertKeyOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? `n:${value}` : null
  if (typeof value === 'boolean') return `b:${value}`
  const s = String(value).trim()
  if (!s) return null
  const n = parseNumber(s)
  if (n !== null && /^[-+(]?[\d.,\s$]+\)?$/.test(s)) return `n:${n}`
  return `s:${s.toLowerCase()}`
}

/** The rows with errors, as a CSV body: the original cells plus "Row" and "Errors" columns. */
export function errorRowsTable(headers: readonly string[], rows: readonly string[][], errors: readonly ImportRowError[]): { headers: string[]; rows: string[][] } {
  const byRow = new Map<number, string[]>()
  for (const e of errors) {
    const list = byRow.get(e.row) ?? []
    list.push(`${e.column}: ${e.reason}`)
    byRow.set(e.row, list)
  }
  const out = [...byRow.keys()].sort((a, b) => a - b).map((row) => [String(row), ...headers.map((_, i) => rows[row - 2]?.[i] ?? ''), byRow.get(row)!.join('; ')])
  return { headers: ['Row', ...headers, 'Errors'], rows: out }
}
