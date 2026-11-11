/**
 * Reading CSV / TSV files for the data-table import (pure: no server
 * imports, so the import wizard runs the same code in the browser as the
 * service runs on the server). .xlsx files are read by ./xlsx (ExcelJS,
 * loaded on demand).
 *
 *  - decodeText: UTF-8 (with or without a BOM), UTF-16 LE / BE (BOM) and,
 *    when the bytes are not valid UTF-8, Windows-1252 (what Excel's
 *    "CSV" — not "CSV UTF-8" — writes on Windows).
 *  - detectDelimiter: comma, semicolon or tab, from the first lines
 *    (outside quotes).
 *  - parseDelimited: RFC 4180 via lib/org/csv (quoted fields with embedded
 *    newlines and delimiters, "" escapes, CRLF / LF), within the import
 *    limits. Fully blank rows are dropped; values are always plain text.
 */

import { CsvError, parseCsv } from '@/lib/org/csv'

/**
 * Import limits: the file size (as uploaded), data rows (header excluded),
 * columns and characters per cell. `batchSize` rows are written per
 * database call; imports above `syncRows` run as a background job.
 */
export const DATA_IMPORT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 200,
  maxCellLength: 32_000,
  batchSize: 500,
  syncRows: 5_000,
  /** Row errors returned in a report (the error-rows download carries them all). */
  maxReportedErrors: 1_000,
} as const

export type ImportFileFormat = 'csv' | 'tsv' | 'xlsx'
export type ImportDelimiter = ',' | ';' | '\t'
export type ImportEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFileError'
  }
}

/** A parsed sheet: header row and data rows (every row as wide as the header). */
export interface ParsedImportFile {
  format: ImportFileFormat
  headers: string[]
  rows: string[][]
  /** CSV / TSV only. */
  delimiter?: ImportDelimiter
  encoding?: ImportEncoding
  /** .xlsx only: every sheet, and the one that was read. */
  sheets?: string[]
  sheet?: string
}

export function formatFromName(fileName: string): ImportFileFormat | null {
  const ext = String(fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'csv' || ext === 'txt') return 'csv'
  if (ext === 'tsv' || ext === 'tab') return 'tsv'
  if (ext === 'xlsx') return 'xlsx'
  return null
}

/** Readable size: "10 MB", "512 KB". */
export function formatLimitBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`
}

export function checkFileSize(size: number): void {
  if (size > DATA_IMPORT_LIMITS.maxBytes) {
    throw new ImportFileError(`The file is ${formatLimitBytes(size)}; the limit is ${formatLimitBytes(DATA_IMPORT_LIMITS.maxBytes)}. Split it into smaller files.`)
  }
  if (size === 0) throw new ImportFileError('The file is empty')
}

/** Text of a CSV / TSV file and the encoding it was read as. */
export function decodeText(bytes: Uint8Array, encoding?: ImportEncoding | 'auto' | null): { text: string; encoding: ImportEncoding } {
  const forced = encoding && encoding !== 'auto' ? encoding : null
  if (forced === 'windows-1252') return { text: decodeWindows1252(bytes), encoding: forced }
  if (forced) return { text: stripBom(new TextDecoder(forced).decode(bytes)), encoding: forced }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: stripBom(new TextDecoder('utf-16le').decode(bytes)), encoding: 'utf-16le' }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: stripBom(new TextDecoder('utf-16be').decode(bytes)), encoding: 'utf-16be' }
  try {
    return { text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8' }
  } catch {
    return { text: decodeWindows1252(bytes), encoding: 'windows-1252' }
  }
}

/** Windows-1252 bytes 0x80–0x9F (€, smart quotes, dashes …); undefined positions stay as the C1 control. */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
]

/**
 * Windows-1252 decoding done here: Node's TextDecoder('windows-1252') maps
 * it to Latin-1 (0x80 → U+0080 instead of €), unlike browsers.
 */
export function decodeWindows1252(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192)
    const codes = new Array<number>(chunk.length)
    for (let j = 0; j < chunk.length; j++) {
      const b = chunk[j]
      codes[j] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b
    }
    out += String.fromCharCode(...codes)
  }
  return out
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** The delimiter used most consistently in the first lines (quotes skipped); comma when unsure. */
export function detectDelimiter(text: string): ImportDelimiter {
  const candidates: ImportDelimiter[] = [',', ';', '\t']
  const lines: Record<ImportDelimiter, number[]> = { ',': [], ';': [], '\t': [] }
  let counts: Record<ImportDelimiter, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  let lineCount = 0
  for (let i = 0; i < text.length && lineCount < 20; i++) {
    const ch = text[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (inQuotes) continue
    if (ch === '\n') {
      for (const d of candidates) lines[d].push(counts[d])
      counts = { ',': 0, ';': 0, '\t': 0 }
      lineCount++
      continue
    }
    if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++
  }
  if (lineCount < 20) for (const d of candidates) lines[d].push(counts[d])
  let best: ImportDelimiter = ','
  let bestScore = 0
  for (const d of candidates) {
    const nonEmpty = lines[d].filter((n) => n > 0)
    if (!nonEmpty.length || lines[d][0] === 0) continue
    // Consistent counts across lines win; the header's count is the reference.
    const consistent = lines[d].filter((n) => n === lines[d][0]).length
    const score = consistent * 1000 + lines[d][0]
    if (score > bestScore) { best = d; bestScore = score }
  }
  return best
}

/** Parse delimited text (header row first) within the import limits. */
export function parseDelimited(text: string, options: { delimiter?: ImportDelimiter | 'auto' | null; format?: 'csv' | 'tsv' } = {}): ParsedImportFile {
  const delimiter: ImportDelimiter = options.delimiter && options.delimiter !== 'auto'
    ? options.delimiter
    : options.format === 'tsv' ? '\t' : detectDelimiter(text)
  let parsed
  try {
    parsed = parseCsv(text, {
      delimiter,
      // Whitespace is kept here; the import's Trim option decides.
      trim: false,
      // Bytes were checked before decoding; this only guards decoded text.
      maxBytes: DATA_IMPORT_LIMITS.maxBytes * 4,
      maxRows: DATA_IMPORT_LIMITS.maxRows + 1_000,
      maxColumns: DATA_IMPORT_LIMITS.maxColumns,
      maxCellLength: DATA_IMPORT_LIMITS.maxCellLength,
    })
  } catch (error) {
    if (error instanceof CsvError) throw new ImportFileError(error.message)
    throw error
  }
  return finish({ format: delimiter === '\t' ? 'tsv' : 'csv', headers: parsed.headers, rows: parsed.rows, delimiter })
}

/** Drop fully blank rows, name blank headers, enforce the row limit. */
export function finish(file: ParsedImportFile): ParsedImportFile {
  const headers = uniqueHeaders(file.headers)
  if (!headers.length) throw new ImportFileError('The first row must be the column headers')
  if (headers.length > DATA_IMPORT_LIMITS.maxColumns) throw new ImportFileError(`The file has ${headers.length} columns; the limit is ${DATA_IMPORT_LIMITS.maxColumns}`)
  const rows = file.rows.filter((row) => row.some((cell) => String(cell ?? '').trim() !== ''))
  if (rows.length > DATA_IMPORT_LIMITS.maxRows) {
    throw new ImportFileError(`The file has ${rows.length.toLocaleString('en-US')} rows; the limit is ${DATA_IMPORT_LIMITS.maxRows.toLocaleString('en-US')}. Split it into smaller files.`)
  }
  return { ...file, headers, rows: rows.map((row) => headers.map((_, i) => String(row[i] ?? ''))) }
}

/** Blank headers become "Column 3"; repeats get " (2)", " (3)". */
export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((raw, i) => {
    const base = String(raw ?? '').trim() || `Column ${i + 1}`
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1
    seen.set(base.toLowerCase(), n)
    return n === 1 ? base : `${base} (${n})`
  })
}

/** CSV / TSV bytes → parsed file. (.xlsx: see ./xlsx.) */
export function parseTextFile(bytes: Uint8Array, options: { fileName?: string; delimiter?: ImportDelimiter | 'auto' | null; encoding?: ImportEncoding | 'auto' | null } = {}): ParsedImportFile {
  checkFileSize(bytes.byteLength)
  const { text, encoding } = decodeText(bytes, options.encoding)
  const format = formatFromName(options.fileName ?? '') === 'tsv' ? 'tsv' : 'csv'
  return { ...parseDelimited(text, { delimiter: options.delimiter, format }), encoding }
}
