/**
 * Number display (docs/design/foundations.md → Formatting). Pure and
 * client-safe; Intl formatters are cached per locale and option set.
 *
 * Render the results with the `num` utility (tabular figures) wherever
 * numbers stack: tables, KPI tiles, counters.
 */

export const DEFAULT_LOCALE = 'en-GB'

const cache = new Map<string, Intl.NumberFormat>()

function nf(locale: string | undefined, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale ?? DEFAULT_LOCALE}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, options)
    if (cache.size > 200) cache.clear()
    cache.set(key, f)
  }
  return f
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Grouped integer / decimal count: `1,234`, `12.5`. `—` for missing values. */
export function formatCount(n: number | null | undefined, opts: { locale?: string; maxFractionDigits?: number } = {}): string {
  if (!isNum(n)) return '—'
  return nf(opts.locale, { maximumFractionDigits: opts.maxFractionDigits ?? 0 }).format(n)
}

/** Compact count for tight spaces: `950`, `1.2K`, `3.4M`. */
export function formatCompact(n: number | null | undefined, opts: { locale?: string } = {}): string {
  if (!isNum(n)) return '—'
  const out = nf(opts.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  // CLDR 46+ (Node 22.12+, current browsers) switched en-GB's thousands
  // suffix to a lowercase `k`; older ICU builds still print `K`. Keep the
  // documented `1.2K` everywhere so server and client renders agree.
  return /^en(-|$)/i.test(opts.locale ?? DEFAULT_LOCALE) ? out.replace(/(\d)k$/, '$1K') : out
}

/**
 * A ratio (0–1) as a percentage: 0 decimals at 10% and above, 1 below
 * (`76%`, `4.2%`, `0%`). Pass `{ fromPercent: true }` for values already in 0–100.
 */
export function formatPercent(value: number | null | undefined, opts: { locale?: string; fromPercent?: boolean } = {}): string {
  if (!isNum(value)) return '—'
  const ratio = opts.fromPercent ? value / 100 : value
  const digits = Math.abs(ratio) >= 0.1 || ratio === 0 ? 0 : 1
  return nf(opts.locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(ratio)
}

/** Money in the record's own currency (ISO 4217): `$1,234.50`, `€12`. Falls back to a plain number for an unknown code. */
export function formatCurrency(amount: number | null | undefined, currency: string, opts: { locale?: string; maxFractionDigits?: number } = {}): string {
  if (!isNum(amount)) return '—'
  try {
    return nf(opts.locale, {
      style: 'currency',
      currency: currency.toUpperCase(),
      ...(opts.maxFractionDigits !== undefined ? { maximumFractionDigits: opts.maxFractionDigits, minimumFractionDigits: Math.min(opts.maxFractionDigits, 2) } : {}),
    }).format(amount)
  } catch {
    return `${formatCount(amount, { locale: opts.locale, maxFractionDigits: 2 })} ${currency.toUpperCase()}`
  }
}

/** File / payload size: `512 B`, `12.4 KB`, `3.1 MB` (1024-based). */
export function formatBytes(bytes: number | null | undefined, opts: { locale?: string } = {}): string {
  if (!isNum(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${nf(opts.locale, { maximumFractionDigits: i === 0 || v >= 100 ? 0 : 1 }).format(v)} ${units[i]}`
}
