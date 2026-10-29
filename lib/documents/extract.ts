/**
 * Extract from documents: key-value pairs by regex, and finders for emails,
 * URLs, phone numbers, dates, money amounts and percentages. User patterns go
 * through the ReDoS guard (lib/safe-regex) and run line by line.
 */

import { compileUserRegex, MAX_REGEX_INPUT_LENGTH } from '@/lib/safe-regex'

export interface PatternSpec {
  name: string
  pattern: string
  /** Regex flags (i, m, s, u); `g` is implied for `all`. */
  flags?: string
  /** Capture group to return (number or name); default 1 when the pattern has a group, else the whole match. */
  group?: string | number
  /** Every match (a list) instead of the first. */
  all?: boolean
}

export interface ExtractedValue { value: string | null; values?: string[]; line?: number }

/** Run named patterns over text, line by line (a match never spans lines). */
export function extractPatterns(text: string, specs: PatternSpec[]): { values: Record<string, string | string[] | null>; details: Record<string, ExtractedValue>; errors: string[] } {
  const values: Record<string, string | string[] | null> = {}
  const details: Record<string, ExtractedValue> = {}
  const errors: string[] = []
  const lines = text.split(/\r?\n/)
  for (const spec of specs.slice(0, 100)) {
    const name = String(spec.name ?? '').trim()
    if (!name || !spec.pattern) continue
    let re: RegExp
    try {
      const flags = [...new Set(`${(spec.flags ?? '').replace(/[^imsu]/g, '')}g`)].join('')
      re = compileUserRegex(String(spec.pattern), flags)
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`)
      values[name] = spec.all ? [] : null
      continue
    }
    const found: string[] = []
    let firstLine: number | undefined
    for (let n = 0; n < lines.length; n++) {
      const line = lines[n].length > MAX_REGEX_INPUT_LENGTH ? lines[n].slice(0, MAX_REGEX_INPUT_LENGTH) : lines[n]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line))) {
        if (m[0] === '') { re.lastIndex++; continue }
        const g = spec.group
        const v = g !== undefined && g !== '' ? (typeof g === 'number' || /^\d+$/.test(String(g)) ? m[Number(g)] : m.groups?.[String(g)]) : m.length > 1 ? m[1] ?? m[0] : m[0]
        if (v !== undefined) {
          found.push(v.trim())
          firstLine ??= n + 1
        }
        if (!spec.all) break
        if (found.length >= 1000) break
      }
      if (!spec.all && found.length) break
    }
    values[name] = spec.all ? found : found[0] ?? null
    details[name] = { value: found[0] ?? null, ...(spec.all ? { values: found } : {}), ...(firstLine ? { line: firstLine } : {}) }
  }
  return { values, details, errors }
}

/* ── Finders ────────────────────────────────────────────────────────── */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}/g
const URL_RE = /\bhttps?:\/\/[^\s<>"'()[\]{}]+[^\s<>"'()[\]{}.,;:!?]/gi
const PHONE = /(?<![\w+])(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])/g
const PERCENT = /(?<![\w.])-?\d+(?:[.,]\d+)?\s?%/g
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DATE_PATTERNS: Array<{ re: RegExp; parse: (m: RegExpExecArray, order: 'DMY' | 'MDY') => [number, number, number] | null }> = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{2}):(\d{2})(?::\d{2})?)?\b/g, parse: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  { re: /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, parse: (m, order) => {
    const a = Number(m[1]); const b = Number(m[2]); let y = Number(m[3]); if (m[3].length === 2) y += y < 70 ? 2000 : 1900
    if (a > 12 && b <= 12) return [y, b, a]
    if (b > 12 && a <= 12) return [y, a, b]
    return order === 'MDY' ? [y, a, b] : [y, b, a]
  } },
  { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'), parse: (m) => [Number(m[3]), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1])] },
  { re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), parse: (m) => [Number(m[3]), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2])] },
]
const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'NZ$': 'NZD', 'US$': 'USD', 'A$': 'AUD', 'AU$': 'AUD', 'C$': 'CAD', 'CA$': 'CAD', 'HK$': 'HKD', 'S$': 'SGD', R: 'ZAR', 'CHF': 'CHF', 'kr': 'SEK' }
const CODES = 'USD|EUR|GBP|NZD|AUD|CAD|JPY|CHF|CNY|INR|SGD|HKD|ZAR|SEK|NOK|DKK|MXN|BRL'
const NUM = '-?\\d{1,3}(?:[,.\\s]\\d{3})+(?:[.,]\\d{1,2})?|-?\\d+(?:[.,]\\d{1,2})?'
const AMOUNT = new RegExp(`(?:(NZ\\$|US\\$|AU\\$|A\\$|CA\\$|C\\$|HK\\$|S\\$|[$€£¥₹])\\s?|\\b(${CODES})\\s?)(${NUM})(?:\\s?(${CODES})\\b)?|(?<![\\d.,])(${NUM})\\s?(?:(${CODES})\\b|(€))`, 'g')

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    // "1.234,56" or "12,50" → decimal comma (2 digits after it), else thousands.
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function iso(y: number, m: number, d: number): string | null {
  if (!y || !m || !d || m > 12 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return dt.toISOString().slice(0, 10)
}

export type FinderName = 'emails' | 'urls' | 'phones' | 'dates' | 'amounts' | 'percentages'
export const FINDERS: FinderName[] = ['emails', 'urls', 'phones', 'dates', 'amounts', 'percentages']

export interface FinderResults {
  emails?: string[]
  urls?: string[]
  phones?: string[]
  dates?: Array<{ text: string; date: string }>
  amounts?: Array<{ text: string; value: number; currency: string | null }>
  percentages?: Array<{ text: string; value: number }>
}

const uniq = <T>(arr: T[], key: (t: T) => string) => {
  const seen = new Set<string>()
  return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true })
}

export function runFinders(text: string, which: FinderName[], options: { dateOrder?: 'DMY' | 'MDY'; unique?: boolean; limit?: number } = {}): FinderResults {
  const out: FinderResults = {}
  const limit = options.limit ?? 1000
  const unique = options.unique !== false
  const all = (re: RegExp) => { re.lastIndex = 0; return [...text.matchAll(re)].slice(0, limit * 4) }
  if (which.includes('emails')) {
    const v = all(EMAIL).map((m) => m[0])
    out.emails = (unique ? uniq(v, (x) => x.toLowerCase()) : v).slice(0, limit)
  }
  if (which.includes('urls')) {
    const v = all(URL_RE).map((m) => m[0])
    out.urls = (unique ? uniq(v, (x) => x) : v).slice(0, limit)
  }
  if (which.includes('phones')) {
    const v = all(PHONE).map((m) => m[0].trim()).filter((p) => {
      const digits = p.replace(/\D/g, '')
      return digits.length >= 7 && digits.length <= 15 && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(p) && !/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(p) && (/[\s().+-]/.test(p) || digits.length >= 9)
    })
    out.phones = (unique ? uniq(v, (x) => x.replace(/\D/g, '')) : v).slice(0, limit)
  }
  if (which.includes('dates')) {
    const found: Array<{ text: string; date: string; at: number }> = []
    const taken: Array<[number, number]> = []
    for (const { re, parse } of DATE_PATTERNS) {
      for (const m of all(re)) {
        const start = m.index ?? 0
        const end = start + m[0].length
        if (taken.some(([s, e]) => start < e && end > s)) continue
        const p = parse(m as RegExpExecArray, options.dateOrder ?? 'DMY')
        const d = p ? iso(p[0], p[1], p[2]) : null
        if (d) { found.push({ text: m[0], date: d, at: start }); taken.push([start, end]) }
      }
    }
    found.sort((a, b) => a.at - b.at)
    const v = found.map(({ text: t, date }) => ({ text: t, date }))
    out.dates = (unique ? uniq(v, (x) => x.date) : v).slice(0, limit)
  }
  if (which.includes('amounts')) {
    const v: Array<{ text: string; value: number; currency: string | null }> = []
    for (const m of all(AMOUNT)) {
      const symbol = m[1] ?? null
      const code = m[2] ?? m[4] ?? m[6] ?? (m[7] ? 'EUR' : null)
      const num = m[3] ?? m[5]
      const value = num ? parseAmount(num) : null
      if (value === null) continue
      const currency = code ? code : symbol ? CURRENCY_SYMBOLS[symbol] ?? null : null
      v.push({ text: m[0].trim(), value, currency })
    }
    out.amounts = (unique ? uniq(v, (x) => `${x.currency}:${x.value}`) : v).slice(0, limit)
  }
  if (which.includes('percentages')) {
    const v = all(PERCENT).map((m) => ({ text: m[0], value: parseAmount(m[0].replace('%', '')) ?? 0 }))
    out.percentages = (unique ? uniq(v, (x) => String(x.value)) : v).slice(0, limit)
  }
  return out
}

/* ── Search ─────────────────────────────────────────────────────────── */

export interface SearchMatch { text: string; index: number; line: number; page?: number; before: string; after: string; context: string }

export function searchText(text: string, query: string, options: { regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; context?: number; limit?: number; pageStarts?: number[] } = {}): { matches: SearchMatch[]; count: number; truncated: boolean } {
  if (!query) return { matches: [], count: 0, truncated: false }
  const flags = `g${options.caseSensitive ? '' : 'i'}u`
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`
  const re = options.regex ? compileUserRegex(source, flags) : new RegExp(source, flags)
  const ctx = Math.max(0, Math.min(500, options.context ?? 60))
  const limit = options.limit ?? 500
  const matches: SearchMatch[] = []
  let count = 0
  // Line starts for line numbers.
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (idx: number) => {
    let lo = 0, hi = lineStarts.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1 }
    return lo + 1
  }
  const scan = options.regex ? text.slice(0, Math.max(MAX_REGEX_INPUT_LENGTH * 20, 0)) : text
  let m: RegExpExecArray | null
  while ((m = re.exec(scan))) {
    if (m[0] === '') { re.lastIndex++; continue }
    count++
    if (matches.length < limit) {
      const before = scan.slice(Math.max(0, m.index - ctx), m.index)
      const after = scan.slice(m.index + m[0].length, m.index + m[0].length + ctx)
      const page = options.pageStarts ? options.pageStarts.filter((s) => s <= m!.index).length : undefined
      matches.push({ text: m[0], index: m.index, line: lineOf(m.index), ...(page ? { page } : {}), before, after, context: `${before}${m[0]}${after}`.replace(/\s+/g, ' ').trim() })
    }
    if (count > 100_000) break
  }
  return { matches, count, truncated: count > matches.length }
}
