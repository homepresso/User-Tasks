import type { CardField, ColumnFormat } from './schema'
import { DEFAULT_CURRENCY, formatCount, formatCurrency, formatPercent } from '@/lib/format/number'
import { formatDate } from '@/lib/format/date'

/**
 * How a record value shows in an app widget (pure, client-safe;
 * __tests__/apps-column-formats.test.ts): card view / Kanban fields, data
 * grid columns and record card fields share one set of formats — as written,
 * number, currency (the field's code, else the column's, else USD), percent
 * (0–100), date (a calendar day, never moved by a time zone) and a progress
 * bar (value of `max`, default 100). A value that isn't a number / date stays
 * as written; an empty one is "—".
 */

export function displayText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(displayText).filter(Boolean).join(', ') || null
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const s = o.label ?? o.name ?? o.display_name ?? o.title ?? o.email ?? o.value
    return s === undefined ? null : String(s).slice(0, 500)
  }
  return String(v).slice(0, 500)
}

/** What a card needs to know about a data table column (its currency, when the column names one). */
export interface CardColumn { key: string; type?: string; currency?: unknown; control_options?: unknown }

/** A column's own currency: `currency` on the column, or its currency control's option. */
export function columnCurrency(col: CardColumn | undefined): string | null {
  const raw = col?.currency ?? (col?.control_options && typeof col.control_options === 'object' ? (col.control_options as Record<string, unknown>).currency : undefined)
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return /^[A-Z]{3}$/.test(code) ? code : null
}

export const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !/^\s*-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?\s*$/.test(v)) return null
  const n = Number(v.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** A card field's value formatted by its `format` (text, or a value that isn't a number / date, stays as written). */
export function formatCardField(f: CardField, raw: unknown, o: { column?: CardColumn; currency?: string | null } = {}): { value: string; progress?: number } {
  const text = displayText(raw)
  if (text === null) return { value: '—' }
  const fmt = f.format ?? 'text'
  if (fmt === 'text') return { value: text }
  if (fmt === 'date') {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(raw) || Number.isNaN(Date.parse(raw))) return { value: text }
    // A date-only value is a calendar day: read it in UTC so no zone moves it.
    return { value: formatDate(raw.length === 10 ? `${raw}T00:00:00Z` : raw, { timeZone: 'UTC' }) }
  }
  const n = asNumber(raw)
  if (n === null) return { value: text }
  const digits = f.decimals
  switch (fmt) {
    case 'number': return { value: formatCount(n, { maxFractionDigits: digits ?? 2 }) }
    case 'currency': {
      const code = f.currency ?? columnCurrency(o.column) ?? o.currency ?? DEFAULT_CURRENCY
      return { value: formatCurrency(n, code, digits !== undefined ? { maxFractionDigits: digits } : {}) }
    }
    case 'percent': return { value: digits !== undefined ? `${formatCount(n, { maxFractionDigits: digits })}%` : formatPercent(n, { fromPercent: true }) }
    case 'progress': {
      const ratio = n / (f.max ?? 100)
      return { value: formatPercent(ratio), progress: Math.max(0, Math.min(1, ratio)) }
    }
  }
}

/** A data grid / record card value through its column format (none, or "text": null — the widget shows it as written). */
export function formatColumnValue(key: string, raw: unknown, format: ColumnFormat | null | undefined, column?: CardColumn): { value: string; progress?: number } | null {
  if (!format?.format || format.format === 'text') return null
  return formatCardField({ key, ...format }, raw, { column })
}
