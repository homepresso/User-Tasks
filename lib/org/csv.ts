/**
 * CSV for the org structure import / export (pure, no server imports).
 *
 *  - parseCsv: RFC 4180 — quoted fields, "" escapes, commas / newlines in
 *    quotes, CRLF or LF, a leading UTF-8 BOM; trailing empty lines ignored.
 *    Limits (CSV_LIMITS) are enforced while parsing so an oversized file
 *    fails fast with a readable message.
 *  - autoMapHeaders: header → import field by normalised name and common
 *    synonyms ("Email Address", "Manager", "Title", "Dept", "Cost Centre").
 *  - toCsv: writer with formula-injection guarding (cells starting with
 *    = + - @ or a tab / carriage return get a leading ') so a spreadsheet
 *    never evaluates an exported value. The lone clear token "-" is kept as
 *    is (it is data, not a formula).
 */

export const CSV_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 10_000,
  maxColumns: 50,
  maxCellLength: 1_000,
} as const

export class CsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvError'
  }
}

export interface ParsedCsv {
  headers: string[]
  /** Data rows (header excluded), each padded / trimmed to the header width. */
  rows: string[][]
}

function byteLength(text: string): number {
  // TextEncoder exists in Node and browsers.
  return new TextEncoder().encode(text).length
}

export type CsvLimits = { maxBytes: number; maxRows: number; maxColumns: number; maxCellLength: number }

export interface CsvParseOptions extends Partial<CsvLimits> {
  /** Field separator (default ","; data-table imports also read ";" and tab). */
  delimiter?: string
  /** Trim unquoted cells (default true). */
  trim?: boolean
}

/** Parse CSV text (first row = headers). Throws CsvError on malformed input or a limit breach. */
export function parseCsv(input: string, limits: CsvParseOptions = {}): ParsedCsv {
  const lim = { ...CSV_LIMITS, ...limits }
  const delimiter = limits.delimiter ?? ','
  const trim = limits.trim ?? true
  if (typeof input !== 'string') throw new CsvError('The file is not text')
  if (input.length > lim.maxBytes || byteLength(input) > lim.maxBytes) {
    throw new CsvError(`The file is larger than ${Math.round(lim.maxBytes / 1024 / 1024)} MB`)
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false
  let line = 1

  const pushField = () => {
    if (field.length > lim.maxCellLength) throw new CsvError(`Line ${line}: a cell is longer than ${lim.maxCellLength} characters`)
    record.push(fieldWasQuoted || !trim ? field : field.trim())
    if (record.length > lim.maxColumns) throw new CsvError(`Line ${line}: more than ${lim.maxColumns} columns`)
    field = ''
    fieldWasQuoted = false
  }
  const pushRecord = () => {
    pushField()
    // Skip fully empty lines.
    if (!(record.length === 1 && record[0] === '')) {
      records.push(record)
      if (records.length > lim.maxRows + 1) throw new CsvError(`The file has more than ${lim.maxRows.toLocaleString('en-US')} rows`)
    }
    record = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        if (ch === '\n') line++
        field += ch
        if (field.length > lim.maxCellLength) throw new CsvError(`Line ${line}: a cell is longer than ${lim.maxCellLength} characters`)
      }
      continue
    }
    if (ch === '"') {
      if (field.trim() === '' && !fieldWasQuoted) { field = ''; inQuotes = true; fieldWasQuoted = true; continue }
      // A quote in the middle of an unquoted field: keep it literally (lenient).
      field += ch
      continue
    }
    if (ch === delimiter) { pushField(); continue }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      pushRecord(); line++
      continue
    }
    if (ch === '\n') { pushRecord(); line++; continue }
    if (fieldWasQuoted) {
      // Text after a closing quote ("a"b): only whitespace is allowed.
      if (ch.trim() === '' && ch !== delimiter) continue
      throw new CsvError(`Line ${line}: unexpected text after a closing quote`)
    }
    field += ch
  }
  if (inQuotes) throw new CsvError(`Line ${line}: a quoted cell is never closed`)
  if (field !== '' || fieldWasQuoted || record.length) pushRecord()

  if (!records.length) throw new CsvError('The file is empty')
  const headers = records[0].map((h) => h.trim())
  if (headers.every((h) => !h)) throw new CsvError('The first row must be the column headers')
  const width = headers.length
  const rows = records.slice(1).map((r) => (r.length >= width ? r.slice(0, width) : [...r, ...Array(width - r.length).fill('')]))
  return { headers, rows }
}

/** Normalised header: lower case, letters and digits only ("E-mail Address" → "emailaddress"). */
export function normaliseHeader(header: string): string {
  return String(header ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Synonyms per import field (normalised). */
export const HEADER_SYNONYMS: Record<string, readonly string[]> = {
  email: ['email', 'emailaddress', 'mail', 'workemail', 'useremail', 'upn', 'userprincipalname', 'login', 'username'],
  display_name: ['displayname', 'name', 'fullname', 'employeename', 'person'],
  manager_email: ['manageremail', 'manager', 'manageremailaddress', 'reportsto', 'reportstoemail', 'supervisor', 'supervisoremail', 'linemanager'],
  job_title: ['jobtitle', 'title', 'position', 'role', 'jobrole', 'designation'],
  department: ['department', 'dept', 'departmentname'],
  division: ['division', 'businessunit', 'bu', 'divisionname', 'group'],
  location: ['location', 'office', 'officelocation', 'site', 'city', 'workplace'],
  employee_id: ['employeeid', 'employeenumber', 'empid', 'empno', 'staffid', 'staffnumber', 'personnelnumber', 'id'],
  cost_center: ['costcenter', 'costcentre', 'costcode', 'cc'],
  team: ['team', 'teams', 'squad'],
}

/** Header for each field: exact field name first, then synonyms; each header used once. */
export function autoMapHeaders<F extends string>(headers: readonly string[], fields: readonly F[]): Record<F, string | null> {
  const normalised = headers.map(normaliseHeader)
  const used = new Set<number>()
  const out = {} as Record<F, string | null>
  // Pass 1: exact field names (job_title ↔ "Job Title"); pass 2: synonyms in order.
  for (const field of fields) {
    const idx = normalised.findIndex((h, i) => !used.has(i) && h && h === normaliseHeader(field))
    if (idx >= 0) { out[field] = headers[idx]; used.add(idx) } else out[field] = null
  }
  for (const field of fields) {
    if (out[field]) continue
    for (const synonym of HEADER_SYNONYMS[field] ?? []) {
      const idx = normalised.findIndex((h, i) => !used.has(i) && h === synonym)
      if (idx >= 0) { out[field] = headers[idx]; used.add(idx); break }
    }
  }
  return out
}

const FORMULA_START = /^[=+\-@\t\r]/

/** Guard a cell against spreadsheet formula injection ("-" alone is the clear token and stays). */
export function guardCell(value: string): string {
  if (value === '-' || !FORMULA_START.test(value)) return value
  return `'${value}`
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** CSV text (CRLF line ends, header first). Null / undefined → empty cell. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const line = (cells: ReadonlyArray<string | number | null | undefined>) =>
    cells.map((c) => quote(guardCell(c === null || c === undefined ? '' : String(c)))).join(',')
  return [line(headers), ...rows.map(line)].join('\r\n') + '\r\n'
}

/** Undo guardCell on import: "'=SUM" → "=SUM" (only for the characters guardCell protects). */
export function unguardCell(value: string): string {
  return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value
}
