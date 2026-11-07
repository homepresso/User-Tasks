/**
 * Dates for people (docs/design/foundations.md → Formatting). One format
 * family everywhere instead of raw toLocaleString():
 *
 *   formatRelative   — "Just now", "5 min ago", "3 h ago", "Yesterday",
 *                      "3 days ago" (within 7 days; the future reads
 *                      "in 5 min", "Tomorrow", "in 3 days"), then
 *                      formatDay: "27 Oct" this year, "27 Oct 2025" otherwise.
 *   formatAbsolute   — "Tue 27 Oct 2026, 14:05 NZDT" (the tooltip on a relative date).
 *   formatDay        — "27 Oct" / "27 Oct 2025".
 *   formatDate       — "27 Oct 2026" (always with the year).
 *   formatDateTime   — "27 Oct 2026, 14:05".
 *   formatTime       — "14:05".
 *
 * All take `{ locale, timeZone, now }`; the workspace timezone should be passed
 * where the app knows it (show it once in the page header, not in every caption).
 */

import { DEFAULT_LOCALE } from './number'

export interface DateFormatOptions {
  locale?: string
  /** IANA zone; the viewer's zone when omitted. */
  timeZone?: string
  /** Reference time for relative dates (tests, server renders). */
  now?: Date | number
}

type DateInput = string | number | Date | null | undefined

const cache = new Map<string, Intl.DateTimeFormat>()

function dtf(opts: DateFormatOptions, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${opts.locale ?? DEFAULT_LOCALE}|${opts.timeZone ?? ''}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(opts.locale ?? DEFAULT_LOCALE, { ...options, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) })
    if (cache.size > 200) cache.clear()
    cache.set(key, f)
  }
  return f
}

/** A valid Date, or null. */
export function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Calendar parts of `d` in the formatter's zone (for "same day / year" comparisons). */
function ymd(d: Date, opts: DateFormatOptions): { y: number; m: number; d: number } {
  const parts = dtf({ ...opts, locale: 'en-CA' }, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** Whole calendar days from `a` to `b` in the zone (b later → positive). */
function calendarDays(a: Date, b: Date, opts: DateFormatOptions): number {
  const A = ymd(a, opts), B = ymd(b, opts)
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86_400_000)
}

const nowOf = (opts: DateFormatOptions) => (opts.now === undefined ? new Date() : new Date(opts.now))

/** "27 Oct" in the current year, "27 Oct 2025" otherwise. */
export function formatDay(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  if (!d) return '—'
  const sameYear = ymd(d, opts).y === ymd(nowOf(opts), opts).y
  return dtf(opts, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

/** "27 Oct 2026". */
export function formatDate(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  return d ? dtf(opts, { day: 'numeric', month: 'short', year: 'numeric' }).format(d) : '—'
}

/** "14:05" (24-hour). */
export function formatTime(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  return d ? dtf(opts, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d) : '—'
}

/** "27 Oct 2026, 14:05". */
export function formatDateTime(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  return d ? `${formatDate(d, opts)}, ${formatTime(d, opts)}` : '—'
}

/** "Tue 27 Oct 2026, 14:05 NZDT" — the full, unambiguous form (tooltips, audit details). */
export function formatAbsolute(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  if (!d) return '—'
  const weekday = dtf(opts, { weekday: 'short' }).format(d)
  const zone = zoneName(d, opts)
  return `${weekday} ${formatDateTime(d, opts)}${zone ? ` ${zone}` : ''}`
}

/**
 * Short zone name ("NZDT", "BST", "PST"). Abbreviations are locale data, so
 * an English locale that only knows "GMT+13" borrows one from a regional
 * English locale that names the zone.
 */
function zoneName(d: Date, opts: DateFormatOptions): string | undefined {
  const name = (locale: string) => dtf({ ...opts, locale }, { timeZoneName: 'short', hour: 'numeric' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value
  const own = name(opts.locale ?? DEFAULT_LOCALE)
  if (!own || !/^(GMT|UTC)[+-]/.test(own) || !(opts.locale ?? DEFAULT_LOCALE).startsWith('en')) return own
  for (const locale of ['en-NZ', 'en-AU', 'en-GB', 'en-US', 'en-IN']) {
    const alt = name(locale)
    if (alt && !/^(GMT|UTC)[+-]/.test(alt)) return alt
  }
  return own
}

/**
 * Relative within 7 days ("5 min ago", "Yesterday", "in 3 days"), then
 * formatDay(). Pair it with formatAbsolute() in a Tooltip.
 */
export function formatRelative(value: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(value)
  if (!d) return '—'
  const now = nowOf(opts)
  const diff = d.getTime() - now.getTime()
  const abs = Math.abs(diff)
  const future = diff > 0
  if (abs < 45_000) return 'Just now'
  if (abs < 3_600_000) {
    const m = Math.max(1, Math.round(abs / 60_000))
    return future ? `in ${m} min` : `${m} min ago`
  }
  const days = calendarDays(now, d, opts)
  if (days === 0 || abs < 6 * 3_600_000) {
    const h = Math.max(1, Math.round(abs / 3_600_000))
    return future ? `in ${h} h` : `${h} h ago`
  }
  if (days === -1) return 'Yesterday'
  if (days === 1) return 'Tomorrow'
  if (Math.abs(days) < 7) return days < 0 ? `${-days} days ago` : `in ${days} days`
  return formatDay(d, opts)
}
