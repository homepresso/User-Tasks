/** Column definitions, parsing, formatting and validation for <ut-table>. Pure (Intl only). */

export type ColumnType = 'text' | 'number' | 'currency' | 'date' | 'select' | 'checkbox'
export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'currency', 'date', 'select', 'checkbox']

export interface Column {
  key: string
  label: string
  type: ColumnType
  required: boolean
  options: string[]
  min: number | null
  max: number | null
  width: number | null
}

export type Row = Record<string, unknown>

export const DEFAULT_COLUMNS = [
  { key: 'item', label: 'Item', type: 'text', required: true, width: 220 },
  { key: 'quantity', label: 'Quantity', type: 'number', min: 1, width: 110 },
  { key: 'unit_price', label: 'Unit price', type: 'currency', min: 0, width: 130 },
]

const MAX_COLUMNS = 20

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Columns from the designer's JSON (array or JSON text); falls back to the default example. */
export function normaliseColumns(raw: unknown): Column[] {
  let list: unknown = raw
  if (typeof raw === 'string') { try { list = JSON.parse(raw) } catch { list = null } }
  if (!Array.isArray(list) || !list.length) list = DEFAULT_COLUMNS
  const seen = new Set<string>()
  const out: Column[] = []
  for (const item of list as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const c = item as Record<string, unknown>
    const key = String(c.key ?? '').trim().slice(0, 64)
    if (!key || seen.has(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    seen.add(key)
    const type = COLUMN_TYPES.includes(c.type as ColumnType) ? (c.type as ColumnType) : 'text'
    const options = Array.isArray(c.options)
      ? c.options.map((o) => (o && typeof o === 'object' ? String((o as Record<string, unknown>).value ?? '') : String(o ?? ''))).map((s) => s.trim()).filter(Boolean).slice(0, 200)
      : []
    const width = num(c.width)
    out.push({
      key,
      label: String(c.label ?? '').trim().slice(0, 80) || key,
      type,
      required: c.required === true,
      options,
      min: num(c.min),
      max: num(c.max),
      width: width && width >= 48 && width <= 800 ? width : null,
    })
    if (out.length >= MAX_COLUMNS) break
  }
  return out.length ? out : normaliseColumns(DEFAULT_COLUMNS)
}

export function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

/** A blank row for these columns (checkboxes false, everything else null). */
export function blankRow(columns: Column[]): Row {
  const row: Row = {}
  for (const c of columns) row[c.key] = c.type === 'checkbox' ? false : null
  return row
}

export function rowIsBlank(row: Row, columns: Column[]): boolean {
  return columns.every((c) => (c.type === 'checkbox' ? row[c.key] !== true : isBlank(row[c.key])))
}

/** Parse "1,234.50", "$ 12", "-3" into a number; null when blank, NaN when not a number. */
export function parseNumber(text: string): number | null {
  const s = text.trim()
  if (!s) return null
  const cleaned = s.replace(/[\s,'  ]/g, '').replace(/^[^\d.+-]+/, '').replace(/[^\d.]+$/, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return NaN
  return Number(cleaned)
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** The stored value for what was typed into a cell's editor. Unparseable numbers stay as text (and fail validation). */
export function parseCell(column: Column, text: string): unknown {
  const s = text.trim()
  switch (column.type) {
    case 'number':
    case 'currency': {
      const n = parseNumber(s)
      if (n === null) return null
      return Number.isNaN(n) ? s : n
    }
    case 'checkbox': return s === 'true'
    default: return s === '' ? null : s
  }
}

/** Text for a cell's editor. */
export function editText(column: Column, v: unknown): string {
  if (isBlank(v)) return ''
  if (column.type === 'checkbox') return v === true ? 'true' : 'false'
  return String(v)
}

export function formatCell(column: Column, v: unknown, locale: string, currency: string): string {
  if (column.type === 'checkbox') return v === true ? 'Yes' : 'No'
  if (isBlank(v)) return ''
  if (column.type === 'number' || column.type === 'currency') {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return String(v)
    return column.type === 'currency' ? formatMoney(n, locale, currency) : formatNum(n, locale)
  }
  if (column.type === 'date' && typeof v === 'string' && isIsoDate(v)) {
    try { return new Intl.DateTimeFormat(locale || 'en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${v}T00:00:00Z`)) } catch { return v }
  }
  return String(v)
}

export function formatNum(n: number, locale: string): string {
  try { return new Intl.NumberFormat(locale || 'en', { maximumFractionDigits: 6 }).format(n) } catch { return String(n) }
}

export function formatMoney(n: number, locale: string, currency: string): string {
  try { return new Intl.NumberFormat(locale || 'en', { style: 'currency', currency: currency || 'USD' }).format(n) } catch {
    return `${currency} ${n.toFixed(2)}`
  }
}

/** The problem with one cell, or null. */
export function cellError(column: Column, v: unknown): string | null {
  if (column.type === 'checkbox') {
    if (column.required && v !== true) return `${column.label} must be ticked`
    return null
  }
  if (isBlank(v)) return column.required ? `${column.label} is required` : null
  switch (column.type) {
    case 'number':
    case 'currency': {
      const n = typeof v === 'number' ? v : NaN
      if (!Number.isFinite(n)) return `${column.label} must be a number`
      if (column.min !== null && n < column.min) return `${column.label} must be at least ${column.min}`
      if (column.max !== null && n > column.max) return `${column.label} must be at most ${column.max}`
      return null
    }
    case 'date':
      return typeof v === 'string' && isIsoDate(v) ? null : `${column.label} must be a date (YYYY-MM-DD)`
    case 'select':
      return column.options.length && !column.options.includes(String(v)) ? `${column.label} must be one of: ${column.options.join(', ')}` : null
    default:
      return typeof v === 'string' || typeof v === 'number' ? (String(v).length > 2000 ? `${column.label} is too long (2000 characters at most)` : null) : `${column.label} must be text`
  }
}
