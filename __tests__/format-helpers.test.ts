import { describe, expect, it } from 'vitest'
import { formatBytes, formatCompact, formatCount, formatCurrency, formatPercent } from '@/lib/format/number'
import { formatDurationDelta, formatDurationMs, formatDurationSeconds } from '@/lib/format/duration'
import { plural, pluralForm, pluralWord } from '@/lib/format/plural'
import { formatAbsolute, formatDate, formatDateTime, formatDay, formatRelative, formatTime } from '@/lib/format/date'

describe('number formatting', () => {
  it('groups counts and handles missing values', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(12.345, { maxFractionDigits: 1 })).toBe('12.3')
    expect(formatCount(null)).toBe('—')
    expect(formatCount(Number.NaN)).toBe('—')
    expect(formatCompact(1250)).toBe('1.3K')
  })

  it('percent: 0 dp at 10% and above, 1 dp below', () => {
    expect(formatPercent(0.764)).toBe('76%')
    expect(formatPercent(0.042)).toBe('4.2%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(1)).toBe('100%')
    expect(formatPercent(76.4, { fromPercent: true })).toBe('76%')
  })

  it('currency uses the record currency; unknown codes fall back', () => {
    expect(formatCurrency(1234.5, 'usd')).toBe('US$1,234.50')
    expect(formatCurrency(12, 'EUR')).toBe('€12.00')
    expect(formatCurrency(3, 'NOPE1')).toBe('3 NOPE1')
  })

  it('bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(12.4 * 1024)).toBe('12.4 KB')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('durations', () => {
  it.each([
    [12, '12 ms'], [4200, '4.2 s'], [42_000, '42 s'], [190_000, '3 m 10 s'], [180_000, '3 m'],
    [12.7 * 3_600_000, '12.7 h'], [3 * 86_400_000, '3 d'], [15 * 86_400_000, '15 d'],
  ])('%d ms → %s', (ms, out) => { expect(formatDurationMs(ms)).toBe(out) })

  it('handles missing values, seconds and deltas', () => {
    expect(formatDurationMs(undefined)).toBe('—')
    expect(formatDurationMs(-5)).toBe('—')
    expect(formatDurationSeconds(90)).toBe('1 m 30 s')
    expect(formatDurationDelta(-2)).toBe('−2 ms')
    expect(formatDurationDelta(1400)).toBe('+1.4 s')
  })
})

describe('plurals', () => {
  it('fixes "1 runs" and friends', () => {
    expect(plural(1, 'run')).toBe('1 run')
    expect(plural(3, 'run')).toBe('3 runs')
    expect(plural(1, 'reference')).toBe('1 reference')
    expect(plural(0, 'tool')).toBe('0 tools')
    expect(plural(2, 'entry')).toBe('2 entries')
    expect(plural(2, 'box')).toBe('2 boxes')
    expect(plural(2, 'day')).toBe('2 days')
    expect(plural(2, 'person', 'people')).toBe('2 people')
    expect(plural(1234, 'row')).toBe('1,234 rows')
    expect(pluralWord(1, 'node')).toBe('node')
    expect(pluralForm('Policy')).toBe('Policies')
  })
})

describe('dates', () => {
  const tz = { timeZone: 'Pacific/Auckland', locale: 'en-GB' }
  const now = new Date('2026-11-04T01:00:00Z') // 14:00 NZDT, Wed 4 Nov 2026

  it('relative within 7 days, then the day', () => {
    const at = (iso: string) => formatRelative(iso, { ...tz, now })
    expect(at('2026-11-04T00:59:40Z')).toBe('Just now')
    expect(at('2026-11-04T00:55:00Z')).toBe('5 min ago')
    expect(at('2026-11-03T22:00:00Z')).toBe('3 h ago')
    expect(at('2026-11-02T22:00:00Z')).toBe('Yesterday')
    expect(at('2026-11-01T01:00:00Z')).toBe('3 days ago')
    expect(at('2026-11-04T01:10:00Z')).toBe('in 10 min')
    expect(at('2026-11-05T01:00:00Z')).toBe('Tomorrow')
    expect(at('2026-10-27T01:00:00Z')).toBe('27 Oct')
    expect(at('2025-10-27T01:00:00Z')).toBe('27 Oct 2025')
    expect(formatRelative(null)).toBe('—')
    expect(formatRelative('not a date')).toBe('—')
  })

  it('absolute and fixed forms (never raw toLocaleString)', () => {
    const d = '2026-10-27T01:05:00Z' // 14:05 NZDT
    expect(formatAbsolute(d, tz)).toBe('Tue 27 Oct 2026, 14:05 NZDT')
    expect(formatDate(d, tz)).toBe('27 Oct 2026')
    expect(formatDateTime(d, tz)).toBe('27 Oct 2026, 14:05')
    expect(formatTime(d, tz)).toBe('14:05')
    expect(formatDay(d, { ...tz, now })).toBe('27 Oct')
  })
})
