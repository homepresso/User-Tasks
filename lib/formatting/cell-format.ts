/**
 * Cell display formats: how one value is SHOWN in a table cell (the form
 * Data table field today; any grid can reuse it). Display only — sorting,
 * filtering, stored values, change sets and workflow data keep the raw
 * typed value.
 *
 *   text        max length (ellipsis) / wrap
 *   number      decimals, thousands separator, negative style (minus, parentheses, red)
 *   integer     a number rounded to a whole number
 *   percent     decimals; the source is a 0–1 fraction or 0–100
 *   currency    ISO code, symbol or code, decimals
 *   date / datetime / time
 *               short / medium / long / ISO presets or a custom pattern
 *               (yyyy MM dd HH mm …), in the viewer's time zone or a fixed one
 *   relative    "3 days ago" / "in 2 hours"
 *   boolean     Yes / No, ✓ / ✗, or custom labels
 *   badge       value → label + a theme-safe colour (light and dark)
 *   link        http(s) / mailto / tel only (anything else is plain text)
 *   image       a thumbnail — app paths, or https hosts the author allows
 *   file_size   bytes → KB / MB / GB
 *   json        pretty-printed JSON
 *
 * Locale: the viewer's (Intl default) unless the form fixes one. Null,
 * blank and invalid values become the placeholder ("—"), never "NaN" or
 * "Invalid Date". Pure and isomorphic; formatCellValue returns a small
 * descriptor the renderer draws (and `text` for exports / read-only text).
 */

import { isPlainObject } from '@/lib/utils/guards'

export type CellFormatKind =
  | 'text' | 'number' | 'integer' | 'percent' | 'currency' | 'date' | 'datetime' | 'time' | 'relative'
  | 'boolean' | 'badge' | 'link' | 'image' | 'file_size' | 'json'

export const CELL_FORMAT_KINDS: CellFormatKind[] = [
  'text', 'number', 'integer', 'percent', 'currency', 'date', 'datetime', 'time', 'relative', 'boolean', 'badge', 'link', 'image', 'file_size', 'json',
]

export const CELL_FORMAT_LABELS: Record<CellFormatKind, string> = {
  text: 'Text', number: 'Number', integer: 'Whole number', percent: 'Percent', currency: 'Currency',
  date: 'Date', datetime: 'Date & time', time: 'Time', relative: 'Relative time ("3 days ago")',
  boolean: 'Yes / no', badge: 'Status badge', link: 'Link (web, email, phone)', image: 'Image thumbnail', file_size: 'File size', json: 'JSON',
}

export type BadgeColor = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'teal' | 'pink'
export const BADGE_COLORS: BadgeColor[] = ['gray', 'blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink']

/** Mid-tone hues readable on light and dark surfaces when tinted (see badgeStyle). */
export const BADGE_HUES: Record<BadgeColor, string> = {
  gray: '#64748b', blue: '#3b82f6', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#9333ea', teal: '#0d9488', pink: '#db2777',
}

export interface CellFormat {
  kind: CellFormatKind
  align?: 'left' | 'center' | 'right'
  // text
  max_length?: number
  wrap?: boolean
  // number / integer / percent / currency
  decimals?: number
  /** Thousands separator (default on). */
  thousands?: boolean
  negative?: 'minus' | 'parentheses' | 'red'
  /** percent: the stored value is a 0–1 fraction (default: 0–100). */
  percent_source?: 'fraction' | 'whole'
  currency?: string
  currency_display?: 'symbol' | 'code'
  // date / datetime / time
  style?: 'short' | 'medium' | 'long' | 'iso' | 'custom'
  /** style custom: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H hh h mm ss a, 'quoted text'. */
  pattern?: string
  /** An IANA time zone (default: the viewer's). */
  time_zone?: string
  // boolean
  boolean_style?: 'yes_no' | 'check' | 'custom'
  true_label?: string
  false_label?: string
  // badge
  badges?: Array<{ value: string; label?: string; color: BadgeColor }>
  /** badge: the colour of values not in the map. */
  default_color?: BadgeColor
  // link
  link_type?: 'auto' | 'url' | 'email' | 'phone'
  // image
  /** https hosts thumbnails may come from (app paths are always allowed). */
  image_hosts?: string[]
}

export interface FormatOptions {
  /** A fixed BCP 47 locale (default: the viewer's). */
  locale?: string
  /** "Now" for relative times (tests pin it). */
  now?: Date
  /** The placeholder for empty / invalid values. */
  placeholder?: string
}

export interface FormattedCell {
  /** Plain text (exports, read-only text, screen readers). */
  text: string
  /** How to draw it. */
  as: 'text' | 'link' | 'image' | 'badge' | 'json'
  href?: string
  src?: string
  color?: BadgeColor
  /** A negative number shown in red. */
  negative?: boolean
  /** The value was empty / invalid (the placeholder is shown). */
  empty?: boolean
  align: 'left' | 'center' | 'right'
}

export const CELL_FORMAT_LIMITS = { decimals: 10, maxLength: 5000, badges: 50, label: 80, pattern: 60, hosts: 10, json: 2000 } as const
export const EMPTY_PLACEHOLDER = '—'

const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/
const HOST_RE = /^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/

function intIn(raw: unknown, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined
}

function label(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, CELL_FORMAT_LIMITS.label) : undefined
}

/** Is this a valid IANA time zone (as Intl knows it)? */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !TZ_RE.test(value)) return false
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}

export function isLocale(value: unknown): value is string {
  if (typeof value !== 'string' || !LOCALE_RE.test(value)) return false
  try { return Intl.NumberFormat.supportedLocalesOf([value]).length > 0 } catch { return false }
}

/** Clean a stored format; `fallback` = the kind when none (or an unknown one) is stored. */
export function normalizeCellFormat(raw: unknown, fallback: CellFormatKind = 'text'): CellFormat {
  const r = isPlainObject(raw) ? raw : {}
  const kind: CellFormatKind = CELL_FORMAT_KINDS.includes(r.kind as CellFormatKind) ? r.kind as CellFormatKind : fallback
  const out: CellFormat = { kind }
  if (r.align === 'left' || r.align === 'center' || r.align === 'right') out.align = r.align
  switch (kind) {
    case 'text': {
      const max = intIn(r.max_length, 1, CELL_FORMAT_LIMITS.maxLength)
      if (max !== undefined) out.max_length = max
      if (r.wrap === true) out.wrap = true
      break
    }
    case 'number': case 'integer': case 'percent': case 'currency': {
      if (kind !== 'integer') {
        const decimals = intIn(r.decimals, 0, CELL_FORMAT_LIMITS.decimals)
        if (decimals !== undefined) out.decimals = decimals
      }
      if (r.thousands === false) out.thousands = false
      if (r.negative === 'parentheses' || r.negative === 'red') out.negative = r.negative
      if (kind === 'percent' && r.percent_source === 'fraction') out.percent_source = 'fraction'
      if (kind === 'currency') {
        const code = typeof r.currency === 'string' ? r.currency.trim().toUpperCase() : ''
        out.currency = /^[A-Z]{3}$/.test(code) ? code : 'USD'
        if (r.currency_display === 'code') out.currency_display = 'code'
      }
      break
    }
    case 'date': case 'datetime': case 'time': {
      if (r.style === 'short' || r.style === 'long' || r.style === 'iso' || r.style === 'custom') out.style = r.style
      if (out.style === 'custom') {
        const pattern = typeof r.pattern === 'string' ? r.pattern.slice(0, CELL_FORMAT_LIMITS.pattern) : ''
        if (pattern.trim()) out.pattern = pattern
        else delete out.style
      }
      if (isTimeZone(r.time_zone)) out.time_zone = r.time_zone
      break
    }
    case 'relative':
      break
    case 'boolean': {
      if (r.boolean_style === 'check' || r.boolean_style === 'custom') out.boolean_style = r.boolean_style
      if (out.boolean_style === 'custom') {
        out.true_label = label(r.true_label) ?? 'Yes'
        out.false_label = label(r.false_label) ?? 'No'
      }
      break
    }
    case 'badge': {
      if (Array.isArray(r.badges)) {
        const badges: NonNullable<CellFormat['badges']> = []
        for (const b of r.badges) {
          if (!isPlainObject(b) || b.value === undefined || b.value === null) continue
          const value = String(b.value).trim().slice(0, 200)
          if (!value || badges.some((x) => x.value === value) || badges.length >= CELL_FORMAT_LIMITS.badges) continue
          const color = BADGE_COLORS.includes(b.color as BadgeColor) ? b.color as BadgeColor : 'gray'
          const l = label(b.label)
          badges.push({ value, ...(l ? { label: l } : {}), color })
        }
        if (badges.length) out.badges = badges
      }
      if (BADGE_COLORS.includes(r.default_color as BadgeColor)) out.default_color = r.default_color as BadgeColor
      break
    }
    case 'link':
      if (r.link_type === 'url' || r.link_type === 'email' || r.link_type === 'phone') out.link_type = r.link_type
      break
    case 'image': {
      if (Array.isArray(r.image_hosts)) {
        const hosts = [...new Set(r.image_hosts.map((h) => String(h ?? '').trim().toLowerCase()).filter((h) => HOST_RE.test(h)))].slice(0, CELL_FORMAT_LIMITS.hosts)
        if (hosts.length) out.image_hosts = hosts
      }
      break
    }
    default:
      break
  }
  return out
}

/** The default alignment: numbers and sizes right, booleans centred, the rest left. */
export function defaultAlign(kind: CellFormatKind): 'left' | 'center' | 'right' {
  if (kind === 'number' || kind === 'integer' || kind === 'percent' || kind === 'currency' || kind === 'file_size') return 'right'
  if (kind === 'boolean') return 'center'
  return 'left'
}

/**
 * The default format of a column: from its data table column type
 * (text, number, date, datetime, boolean, select, email, url, phone, file…)
 * or, for API sources, inferred from sample values.
 */
export function defaultFormatKind(type: string | undefined, samples: unknown[] = []): CellFormatKind {
  switch (type) {
    case 'number': return 'number'
    case 'integer': return 'integer'
    case 'currency': return 'currency'
    case 'date': return 'date'
    case 'datetime': return 'datetime'
    case 'boolean': return 'boolean'
    case 'select': case 'choice': return 'badge'
    case 'email': case 'url': case 'phone': return 'link'
    case 'json': return 'json'
    default: break
  }
  const present = samples.filter((v) => v !== null && v !== undefined && v !== '').slice(0, 20)
  if (!present.length) return 'text'
  if (present.every((v) => typeof v === 'boolean')) return 'boolean'
  if (present.every((v) => typeof v === 'number')) return present.every((v) => Number.isInteger(v)) ? 'integer' : 'number'
  if (present.every((v) => typeof v === 'object')) return 'json'
  const texts = present.map(String)
  if (texts.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))) return 'date'
  if (texts.every((s) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s)))) return 'datetime'
  if (texts.every((s) => /^https?:\/\//i.test(s) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) return 'link'
  return 'text'
}

/* ── Links and images ────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[^\s@<>"'`]+$/
const PHONE_RE = /^\+?[0-9 ()./-]{5,30}$/

/**
 * A safe link for a value: http(s) URLs (no credentials), mailto: for an
 * email, tel: for a phone number — anything else (javascript:, data:, …)
 * is null and the cell shows plain text.
 */
export function safeCellHref(value: unknown, type: CellFormat['link_type'] = 'auto'): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const s = String(value).trim()
  if (!s || s.length > 2000 || /[\u0000-\u001f\u007f]/.test(s)) return null
  const asUrl = () => {
    try {
      const u = new URL(s)
      if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
      return u.toString()
    } catch { return null }
  }
  const asEmail = () => {
    const addr = s.replace(/^mailto:/i, '')
    return EMAIL_RE.test(addr) ? `mailto:${encodeURIComponent(addr).replace(/%40/g, '@')}` : null
  }
  const asPhone = () => {
    const num = s.replace(/^tel:/i, '')
    return PHONE_RE.test(num) ? `tel:${num.replace(/[^0-9+]/g, '')}` : null
  }
  if (type === 'url') return asUrl()
  if (type === 'email') return asEmail()
  if (type === 'phone') return asPhone()
  if (/^https?:\/\//i.test(s)) return asUrl()
  if (/^mailto:/i.test(s) || EMAIL_RE.test(s)) return asEmail()
  if (/^tel:/i.test(s) || PHONE_RE.test(s)) return asPhone()
  return null
}

/** A thumbnail source: an app path (/…, not //), or an https URL on an allowed host. */
export function safeImageSrc(value: unknown, hosts: string[] = []): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s || s.length > 2000 || /[\u0000-\u001f\u007f\s]/.test(s)) return null
  if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return s
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    const host = u.hostname.toLowerCase()
    return hosts.some((h) => host === h || (h.startsWith('*.') && host.endsWith(h.slice(1)))) ? u.toString() : null
  } catch { return null }
}

/* ── Dates ───────────────────────────────────────────────────────────── */

/** A Date from a stored value (ISO text, YYYY-MM-DD, epoch ms / s), or null. Date-only values are midnight UTC. */
export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const d = new Date(value < 1e11 ? value * 1000 : value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const d = new Date(`1970-01-01T${s}Z`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) && !/^[A-Za-z]{3},? /.test(s)) return null
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
  return Number.isNaN(d.getTime()) ? null : d
}

function isDateOnly(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
}

function parts(d: Date, locale: string | undefined, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat(locale, { ...opts, timeZone }).formatToParts(d)) out[p.type] = p.value
  return out
}

/** A custom pattern: yyyy yy MMMM MMM MM M dd d EEEE EEE HH H hh h mm ss a; 'quoted' text is literal. */
export function formatPattern(d: Date, pattern: string, locale?: string, timeZone?: string): string {
  const num = parts(d, 'en-US', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const named = parts(d, locale, timeZone, { month: 'long', weekday: 'long' })
  const short = parts(d, locale, timeZone, { month: 'short', weekday: 'short' })
  const hour = Number(num.hour) % 24
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const tokens: Record<string, string> = {
    yyyy: num.year, yy: num.year.slice(-2), MMMM: named.month, MMM: short.month, MM: num.month, M: String(Number(num.month)),
    dd: num.day, d: String(Number(num.day)), EEEE: named.weekday, EEE: short.weekday,
    HH: String(hour).padStart(2, '0'), H: String(hour), hh: String(h12).padStart(2, '0'), h: String(h12),
    mm: num.minute, ss: num.second, a: hour < 12 ? 'AM' : 'PM',
  }
  return pattern.replace(/'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g, (m, quoted: string | undefined) => (quoted !== undefined ? quoted : tokens[m] ?? m))
}

function formatDate(value: unknown, format: CellFormat, opts: FormatOptions): string | null {
  const d = toDate(value)
  if (!d) return null
  const kind = format.kind
  // A date-only value has no time zone: show the calendar date as stored.
  const timeZone = kind === 'date' && isDateOnly(value) ? 'UTC' : format.time_zone
  const style = format.style ?? 'medium'
  try {
    if (style === 'custom' && format.pattern) return formatPattern(d, format.pattern, opts.locale, timeZone)
    if (style === 'iso') {
      if (kind === 'date') return isDateOnly(value) ? String(value).trim() : formatPattern(d, 'yyyy-MM-dd', 'en-US', timeZone)
      if (kind === 'time') return formatPattern(d, 'HH:mm:ss', 'en-US', timeZone)
      return timeZone ? `${formatPattern(d, "yyyy-MM-dd'T'HH:mm:ss", 'en-US', timeZone)} ${timeZone}` : d.toISOString()
    }
    const dateStyle = style as 'short' | 'medium' | 'long'
    const options: Intl.DateTimeFormatOptions = kind === 'date' ? { dateStyle } : kind === 'time' ? { timeStyle: dateStyle === 'long' ? 'medium' : 'short' } : { dateStyle, timeStyle: 'short' }
    return new Intl.DateTimeFormat(opts.locale, { ...options, timeZone }).format(d)
  } catch {
    return null
  }
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600], ['month', 30 * 24 * 3600], ['week', 7 * 24 * 3600], ['day', 24 * 3600], ['hour', 3600], ['minute', 60], ['second', 1],
]

export function formatRelative(value: unknown, opts: FormatOptions = {}): string | null {
  const d = toDate(value)
  if (!d) return null
  const seconds = (d.getTime() - (opts.now ?? new Date()).getTime()) / 1000
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat(opts.locale, { numeric: 'auto' })
  for (const [unit, size] of RELATIVE_UNITS) {
    if (abs >= size || unit === 'second') return rtf.format(Math.round(seconds / size), unit)
  }
  return null
}

/* ── Numbers ─────────────────────────────────────────────────────────── */

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const s = value.trim().replace(/,/g, '')
    if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function formatNumber(n: number, format: CellFormat, opts: FormatOptions): string {
  const grouping = format.thousands !== false
  let value = n
  const options: Intl.NumberFormatOptions = { useGrouping: grouping }
  switch (format.kind) {
    case 'integer':
      options.maximumFractionDigits = 0
      break
    case 'percent':
      value = format.percent_source === 'fraction' ? n : n / 100
      options.style = 'percent'
      options.minimumFractionDigits = format.decimals ?? 0
      options.maximumFractionDigits = format.decimals ?? 2
      break
    case 'currency':
      options.style = 'currency'
      options.currency = format.currency ?? 'USD'
      options.currencyDisplay = format.currency_display === 'code' ? 'code' : 'symbol'
      if (format.decimals !== undefined) { options.minimumFractionDigits = format.decimals; options.maximumFractionDigits = format.decimals }
      break
    default:
      if (format.decimals !== undefined) { options.minimumFractionDigits = format.decimals; options.maximumFractionDigits = format.decimals }
      else options.maximumFractionDigits = 6
  }
  const negative = value < 0
  const text = new Intl.NumberFormat(opts.locale, options).format(format.negative === 'parentheses' && negative ? -value : value)
  return format.negative === 'parentheses' && negative ? `(${text})` : text
}

export function formatFileSize(bytes: number, locale?: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = Math.abs(bytes)
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(n)
  return `${bytes < 0 ? '-' : ''}${text} ${units[i]}`
}

/* ── One cell ────────────────────────────────────────────────────────── */

function plainText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return '' } }
  return String(value)
}

/** Format one value for display. Never throws; empty / invalid values give the placeholder. */
export function formatCellValue(value: unknown, format: CellFormat, opts: FormatOptions = {}): FormattedCell {
  const placeholder = opts.placeholder ?? EMPTY_PLACEHOLDER
  const align = format.align ?? defaultAlign(format.kind)
  const empty = (): FormattedCell => ({ text: placeholder, as: 'text', empty: true, align })
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '' && format.kind !== 'boolean')) return empty()
  try {
    switch (format.kind) {
      case 'number': case 'integer': case 'percent': case 'currency': {
        const n = toNumber(value)
        if (n === null) return empty()
        return { text: formatNumber(n, format, opts), as: 'text', align, ...(format.negative === 'red' && n < 0 ? { negative: true } : {}) }
      }
      case 'file_size': {
        const n = toNumber(value)
        return n === null ? empty() : { text: formatFileSize(n, opts.locale), as: 'text', align }
      }
      case 'date': case 'datetime': case 'time': {
        const text = formatDate(value, format, opts)
        return text === null ? empty() : { text, as: 'text', align }
      }
      case 'relative': {
        const text = formatRelative(value, opts)
        return text === null ? empty() : { text, as: 'text', align }
      }
      case 'boolean': {
        const s = String(value).trim().toLowerCase()
        const truthy = value === true || ['true', '1', 'yes', 'y', 'on'].includes(s)
        const falsy = value === false || ['false', '0', 'no', 'n', 'off', ''].includes(s)
        if (!truthy && !falsy) return empty()
        const style = format.boolean_style ?? 'yes_no'
        const text = style === 'check' ? (truthy ? '✓' : '✗') : style === 'custom' ? (truthy ? format.true_label ?? 'Yes' : format.false_label ?? 'No') : (truthy ? 'Yes' : 'No')
        return { text, as: 'text', align }
      }
      case 'badge': {
        const raw = plainText(value).trim()
        if (!raw) return empty()
        const hit = format.badges?.find((b) => b.value === raw) ?? format.badges?.find((b) => b.value.toLowerCase() === raw.toLowerCase())
        return { text: hit?.label ?? raw, as: 'badge', color: hit?.color ?? format.default_color ?? 'gray', align }
      }
      case 'link': {
        const text = plainText(value).trim()
        const href = safeCellHref(value, format.link_type)
        return href ? { text, as: 'link', href, align } : { text, as: 'text', align }
      }
      case 'image': {
        const src = safeImageSrc(value, format.image_hosts)
        return src ? { text: plainText(value), as: 'image', src, align } : { text: plainText(value), as: 'text', align }
      }
      case 'json': {
        let text: string
        try { text = typeof value === 'string' ? JSON.stringify(JSON.parse(value), null, 2) : JSON.stringify(value, null, 2) } catch { text = plainText(value) }
        if (text.length > CELL_FORMAT_LIMITS.json) text = `${text.slice(0, CELL_FORMAT_LIMITS.json)}…`
        return { text, as: 'json', align }
      }
      default: {
        let text = plainText(value)
        if (format.max_length && text.length > format.max_length) text = `${text.slice(0, format.max_length).trimEnd()}…`
        return { text, as: 'text', align }
      }
    }
  } catch {
    return empty()
  }
}

/** Inline style of a badge (tinted background, readable text in light and dark themes). */
export function badgeStyle(color: BadgeColor): { backgroundColor: string; color: string; borderColor: string } {
  const hue = BADGE_HUES[color] ?? BADGE_HUES.gray
  return {
    backgroundColor: `color-mix(in srgb, ${hue} 16%, transparent)`,
    color: `color-mix(in srgb, ${hue} 60%, var(--theme-card-text, currentColor))`,
    borderColor: `color-mix(in srgb, ${hue} 35%, transparent)`,
  }
}
