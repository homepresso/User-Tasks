/** RFC 4180 CSV parsing and writing. */

/** Parse CSV text into rows of fields (quoted fields, "" escapes, CRLF / LF, newlines inside quotes). */
export function parseCsv(input: string, delimiter: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  let fieldStarted = false
  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      i++
      continue
    }
    if (text.startsWith(delimiter, i)) {
      endField()
      i += delimiter.length
      continue
    }
    if (ch === '\r' || ch === '\n') {
      endRow()
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += ch
    fieldStarted = true
    i++
  }
  if (quoted) throw new Error('The CSV has an unclosed quote')
  if (field !== '' || fieldStarted || row.length > 0) endRow()
  return rows
}

/** Guess the delimiter from the first line: the most frequent of , ; tab | outside quotes. */
export function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const unquoted = firstLine.replace(/"[^"]*"/g, '')
  let best = ','
  let bestCount = 0
  for (const d of [',', ';', '\t', '|']) {
    const count = unquoted.split(d).length - 1
    if (count > bestCount) {
      best = d
      bestCount = count
    }
  }
  return best
}

export function csvField(value: unknown, delimiter: string, escapeFormulas: boolean): string {
  let s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Spreadsheet formula injection: =, +, -, @, tab, CR at the start of a text cell.
  if (escapeFormulas && typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Infer a typed value from CSV text: numbers (no leading zeros), booleans, empty → null. */
export function inferValue(s: string): unknown {
  if (s === '') return null
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n) && (Number.isSafeInteger(n) || !/^-?\d+$/.test(s))) return n
  }
  const lower = s.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  return s
}
