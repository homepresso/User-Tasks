/**
 * Pasting a block from Excel / Google Sheets / Numbers into an "Edit all
 * rows" grid (lib/grid/edit-all.ts): the clipboard's tab-separated text is
 * parsed (quoted cells with tabs, newlines and "" escapes, as Excel writes
 * them), each pasted text is normalised for its target column (dates in the
 * viewer's day / month order, $1,234.50 and (12.50), TRUE / FALSE, a
 * choice's label, people by name or email) and then coerced by the column's
 * own rules (the caller passes coerceGridValue / coerceCell). A cell that
 * doesn't fit keeps its value and gets an error; read-only targets are
 * skipped. Pure.
 */

import type { CellChange } from './edit-all'

export const PASTE_LIMITS = {
  /** Cells one paste may write. */
  cells: 20_000,
} as const

/** Parse clipboard text (TSV with Excel quoting) into rows of cells. */
export function parseClipboardTable(text: string): string[][] {
  if (!text) return []
  const src = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let quoted = false
  let atCellStart = true
  while (i < src.length) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      cell += ch; i++; continue
    }
    if (ch === '"' && atCellStart) { quoted = true; atCellStart = false; i++; continue }
    if (ch === '\t') { row.push(cell); cell = ''; atCellStart = true; i++; continue }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; atCellStart = true; i++; continue }
    cell += ch; atCellStart = false; i++
  }
  // The trailing newline Excel adds does not make an empty last row.
  if (cell !== '' || row.length || !atCellStart) { row.push(cell); rows.push(row) }
  return rows
}

/** Rows of values as clipboard text (copy out of the grid): tabs between cells, quotes where needed. */
export function toClipboardTable(rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(cell).join('\t')).join('\n')
}

export type DateOrder = 'dmy' | 'mdy'

/** The day / month order of a locale's short dates (en-US → mdy; en-NZ, en-GB, de… → dmy). */
export function localeDateOrder(locale?: string): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(Date.UTC(2026, 10, 23)))
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type)
    return order[0] === 'month' ? 'mdy' : 'dmy'
  } catch {
    return 'mdy'
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * A pasted date as YYYY-MM-DD: ISO (2026-11-23, with or without time),
 * 23/11/2026 or 11/23/2026 (the order decides when both fit; a day over 12
 * decides by itself), 23-Nov-2026, Nov 23, 2026, 23 November 2026. Two-digit
 * years are 20xx. Null when it isn't a date.
 */
export function normalizePastedDate(text: string, order: DateOrder = 'mdy'): string | null {
  const s = text.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s)
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(s)
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    const a = Number(m[1]), b = Number(m[2])
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const dayFirst = a > 12 ? true : b > 12 ? false : order === 'dmy'
    return dayFirst ? validYmd(y, b, a) : validYmd(y, a, b)
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-,]+(\d{2}|\d{4})$/.exec(s)
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    return mon >= 0 ? validYmd(y, mon + 1, Number(m[1])) : null
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    return mon >= 0 ? validYmd(Number(m[3]), mon + 1, Number(m[2])) : null
  }
  return null
}

/** A pasted number: $1,234.50, USD 1,234.50, (12.50) → -12.5, 1 234, −5. Null when it isn't one. */
export function normalizePastedNumber(text: string): number | null {
  let s = text.trim().replace(/−/g, '-')
  if (!s) return null
  let negative = false
  const paren = /^\((.*)\)$/.exec(s)
  if (paren) { negative = true; s = paren[1].trim() }
  s = s.replace(/^[A-Za-z]{3}\s*/, '').replace(/\s*[A-Za-z]{3}$/, '').replace(/^-?\s*[$€£¥]/, (x) => (x.startsWith('-') ? '-' : '')).replace(/[,\s ]/g, '')
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** The minimal column the paste needs (a grid column; a form column is mapped to one). */
export interface PasteColumn {
  key: string
  label: string
  control: string
  choices?: Array<{ value: string; label?: string }>
  multiple?: boolean
  /** Bound to a source: the text goes as is (the server checks it is one of the options). */
  bound?: boolean
}

export interface PastePerson { id: string; display_name: string | null; email: string | null }

/**
 * Turn pasted text into what the column's coerce step expects. Unknown
 * shapes pass through unchanged — the coerce step then reports the error.
 */
export function normalizePastedText(col: PasteColumn, text: string, ctx: { dateOrder?: DateOrder; people?: PastePerson[] } = {}): unknown {
  const s = text.trim()
  if (s === '') return null
  switch (col.control) {
    case 'number': case 'currency': {
      const n = normalizePastedNumber(s)
      return n === null ? s : n
    }
    case 'date': return normalizePastedDate(s, ctx.dateOrder) ?? s
    case 'datetime': {
      const day = /^(.+?)[\sT]+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)$/i.exec(s)
      if (day) {
        const d = normalizePastedDate(day[1], ctx.dateOrder)
        if (d) {
          const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?/i.exec(day[2])!
          let h = Number(t[1])
          if (t[4]) { const pm = t[4].toLowerCase() === 'p'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
          const local = new Date(`${d}T${pad(h)}:${t[2]}:${t[3] ?? '00'}`)
          if (!Number.isNaN(local.getTime())) return local.toISOString()
        }
      }
      const d = normalizePastedDate(s, ctx.dateOrder)
      return d ? new Date(`${d}T00:00:00`).toISOString() : s
    }
    case 'boolean': {
      const v = s.toLowerCase()
      if (['true', 'yes', 'y', '1', 'on', 'x', '✓', '✔', 'checked'].includes(v)) return true
      if (['false', 'no', 'n', '0', 'off', 'unchecked'].includes(v)) return false
      return s
    }
    case 'dropdown': case 'autocomplete': case 'lookup': {
      if (col.bound || !col.choices?.length) return s
      return matchChoice(col.choices, s) ?? s
    }
    case 'multiselect': {
      const parts = s.split(/[;,\n]/).map((x) => x.trim()).filter(Boolean)
      return col.bound || !col.choices?.length ? parts : parts.map((p) => matchChoice(col.choices!, p) ?? p)
    }
    case 'people': {
      const names = s.split(/[;,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
      const refs = names.map((n) => (ctx.people ?? []).find((p) => p.email?.toLowerCase() === n || p.display_name?.toLowerCase() === n))
      if (refs.some((r) => !r)) return { unmatched: true }
      return refs.map((p) => ({ kind: 'user', id: p!.id, name: p!.display_name || p!.email || undefined }))
    }
    case 'file': case 'signature': return { unpasteable: true }
    default: return text.replace(/\r?\n$/, '')
  }
}

function matchChoice(choices: Array<{ value: string; label?: string }>, text: string): string | null {
  const t = text.toLowerCase()
  const hit = choices.find((c) => c.value === text) ?? choices.find((c) => c.value.toLowerCase() === t || (c.label ?? '').toLowerCase() === t)
  return hit ? hit.value : null
}

export interface PastePlan {
  changes: CellChange[]
  errors: Array<{ row: string; col: string; message: string }>
  /** Read-only targets left alone. */
  skipped: number
  /** Pasted cells that fell outside the grid (no more rows / columns). */
  outside: number
}

/**
 * Where a pasted block goes, cell by cell, from the focused cell (`start`).
 * A single value pasted over a selected range fills the whole range.
 * `rowKeys` / `columns`: the grid's rows and columns in display order
 * (extend the rows first when new rows may be added).
 */
export function planPaste(params: {
  block: string[][]
  start: { r: number; c: number }
  /** The selected range: a single pasted value fills it. */
  range?: { r1: number; c1: number; r2: number; c2: number } | null
  rowKeys: string[]
  columns: PasteColumn[]
  canEdit: (row: string, col: string) => boolean
  coerce: (col: PasteColumn, raw: unknown) => { value: unknown } | { error: string }
  dateOrder?: DateOrder
  people?: PastePerson[]
}): PastePlan {
  const { block, rowKeys, columns, canEdit, coerce } = params
  const plan: PastePlan = { changes: [], errors: [], skipped: 0, outside: 0 }
  if (!block.length) return plan
  const single = block.length === 1 && block[0].length === 1
  const range = params.range && single && (params.range.r2 > params.range.r1 || params.range.c2 > params.range.c1) ? params.range : null
  const origin = range ? { r: range.r1, c: range.c1 } : params.start
  const height = range ? range.r2 - range.r1 + 1 : block.length
  const width = range ? range.c2 - range.c1 + 1 : Math.max(...block.map((r) => r.length))
  let count = 0
  for (let dr = 0; dr < height; dr++) {
    for (let dc = 0; dc < width; dc++) {
      const text = range ? block[0][0] : block[dr]?.[dc]
      if (text === undefined) continue
      const row = rowKeys[origin.r + dr]
      const col = columns[origin.c + dc]
      if (!row || !col) { plan.outside++; continue }
      if (!canEdit(row, col.key)) { plan.skipped++; continue }
      if (++count > PASTE_LIMITS.cells) { plan.outside++; continue }
      const raw = normalizePastedText(col, text, { dateOrder: params.dateOrder, people: params.people })
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'unmatched' in raw) { plan.errors.push({ row, col: col.key, message: `${col.label}: "${text.slice(0, 60)}" is not a person in this workspace` }); continue }
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'unpasteable' in raw) { plan.errors.push({ row, col: col.key, message: `${col.label}: files and signatures can't be pasted` }); continue }
      const coerced = coerce(col, raw)
      if ('error' in coerced) { plan.errors.push({ row, col: col.key, message: `${coerced.error} ("${text.slice(0, 60)}" not pasted)` }); continue }
      plan.changes.push({ row, col: col.key, value: coerced.value })
    }
  }
  return plan
}
