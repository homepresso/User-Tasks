import { describe, expect, it } from 'vitest'
import {
  EMPTY_PLACEHOLDER, defaultAlign, defaultFormatKind, formatCellValue, formatFileSize, formatPattern, formatRelative, normalizeCellFormat,
  safeCellHref, safeImageSrc, toDate, type CellFormat,
} from '@/lib/formatting/cell-format'

const f = (format: Partial<CellFormat> & { kind: CellFormat['kind'] }, value: unknown, locale = 'en-US') => formatCellValue(value, normalizeCellFormat(format, format.kind), { locale, now: new Date('2026-10-31T12:00:00Z') })

describe('cell formats: numbers', () => {
  it('number: decimals, thousands, negatives', () => {
    expect(f({ kind: 'number' }, 1234.5).text).toBe('1,234.5')
    expect(f({ kind: 'number', decimals: 2 }, 1234.5).text).toBe('1,234.50')
    expect(f({ kind: 'number', thousands: false }, 1234567).text).toBe('1234567')
    expect(f({ kind: 'number', negative: 'parentheses', decimals: 0 }, -42).text).toBe('(42)')
    const red = f({ kind: 'number', negative: 'red' }, -5)
    expect(red.text).toBe('-5')
    expect(red.negative).toBe(true)
    expect(f({ kind: 'number' }, '1,500').text).toBe('1,500')
  })

  it('integer rounds; percent from 0–100 or a 0–1 fraction', () => {
    expect(f({ kind: 'integer' }, 12.6).text).toBe('13')
    expect(f({ kind: 'percent' }, 42.5).text).toBe('42.5%')
    expect(f({ kind: 'percent', decimals: 1 }, 0.425, 'en-US').text).toBe('0.4%')
    expect(f({ kind: 'percent', percent_source: 'fraction', decimals: 1 }, 0.425).text).toBe('42.5%')
  })

  it('currency: code, symbol vs code, decimals, locale', () => {
    expect(f({ kind: 'currency', currency: 'USD' }, 1499).text).toBe('$1,499.00')
    expect(f({ kind: 'currency', currency: 'EUR', currency_display: 'code', decimals: 0 }, 1499).text.replace(/\s/g, ' ')).toBe('EUR 1,499')
    expect(f({ kind: 'currency', currency: 'EUR' }, 1499.5, 'de-DE').text.replace(/\s/g, ' ')).toBe('1.499,50 €')
    expect(normalizeCellFormat({ kind: 'currency', currency: 'bad!' }).currency).toBe('USD')
  })

  it('locale changes separators', () => {
    expect(f({ kind: 'number', decimals: 2 }, 1234.5, 'de-DE').text).toBe('1.234,50')
    expect(f({ kind: 'number', decimals: 2 }, 1234.5, 'fr-FR').text.replace(/\s/g, ' ')).toBe('1 234,50')
  })

  it('file size', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1536, 'en-US')).toBe('1.5 KB')
    expect(f({ kind: 'file_size' }, 5 * 1024 * 1024).text).toBe('5 MB')
  })
})

describe('cell formats: dates and times', () => {
  it('a date-only value keeps its calendar day in any time zone', () => {
    expect(f({ kind: 'date', style: 'iso' }, '2026-03-05').text).toBe('2026-03-05')
    expect(f({ kind: 'date', style: 'medium', time_zone: 'Pacific/Auckland' }, '2026-03-05').text).toBe('Mar 5, 2026')
    expect(f({ kind: 'date', style: 'long' }, '2026-03-05').text).toBe('March 5, 2026')
    expect(f({ kind: 'date', style: 'short' }, '2026-03-05', 'en-GB').text).toBe('05/03/2026')
  })

  it('date & time in a fixed time zone', () => {
    const v = '2026-10-31T23:30:00Z'
    expect(f({ kind: 'datetime', style: 'custom', pattern: 'yyyy-MM-dd HH:mm', time_zone: 'UTC' }, v).text).toBe('2026-10-31 23:30')
    expect(f({ kind: 'datetime', style: 'custom', pattern: 'yyyy-MM-dd HH:mm', time_zone: 'Pacific/Auckland' }, v).text).toBe('2026-11-01 12:30')
    expect(f({ kind: 'datetime', style: 'custom', pattern: 'dd MMM yyyy h:mm a', time_zone: 'America/New_York' }, v).text).toBe('31 Oct 2026 7:30 PM')
    expect(f({ kind: 'time', style: 'iso', time_zone: 'UTC' }, v).text).toBe('23:30:00')
    expect(f({ kind: 'datetime', style: 'iso', time_zone: 'UTC' }, v).text).toBe('2026-10-31T23:30:00 UTC')
  })

  it('custom patterns: quoted text, weekday names in the locale', () => {
    const d = new Date('2026-10-31T09:05:07Z')
    expect(formatPattern(d, "EEEE d MMMM 'at' HH:mm:ss", 'en-US', 'UTC')).toBe('Saturday 31 October at 09:05:07')
    expect(formatPattern(d, 'EEE d MMM yy', 'fr-FR', 'UTC')).toMatch(/^sam\.? 31 oct\.? 26$/)
  })

  it('an invalid time zone is dropped (the viewer’s is used)', () => {
    expect(normalizeCellFormat({ kind: 'datetime', time_zone: 'Not/AZone' }).time_zone).toBeUndefined()
    expect(normalizeCellFormat({ kind: 'datetime', time_zone: 'Europe/Berlin' }).time_zone).toBe('Europe/Berlin')
  })

  it('relative time', () => {
    const now = new Date('2026-10-31T12:00:00Z')
    expect(formatRelative('2026-10-28T12:00:00Z', { locale: 'en-US', now })).toBe('3 days ago')
    expect(formatRelative('2026-10-31T14:00:00Z', { locale: 'en-US', now })).toBe('in 2 hours')
    expect(formatRelative('2026-10-30T12:00:00Z', { locale: 'en-US', now })).toBe('yesterday')
    expect(f({ kind: 'relative' }, '2026-10-21T12:00:00Z').text).toBe('last week')
  })

  it('toDate: ISO, date-only, epoch seconds / ms; rejects junk', () => {
    expect(toDate('2026-01-02')?.toISOString()).toBe('2026-01-02T00:00:00.000Z')
    expect(toDate(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
    expect(toDate(1_700_000_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z')
    expect(toDate('tomorrow')).toBeNull()
    expect(toDate('12')).toBeNull()
  })
})

describe('cell formats: empty and invalid values never show NaN / Invalid Date', () => {
  it.each([
    ['number', 'abc'], ['number', NaN], ['currency', Infinity], ['percent', ''], ['integer', null], ['date', 'not a date'], ['datetime', '2026-13-45T99:99'],
    ['time', {}], ['relative', 'soon'], ['file_size', undefined], ['boolean', 'maybe'], ['badge', '  '], ['text', null],
  ] as const)('%s ← %j', (kind, value) => {
    const cell = f({ kind } as CellFormat, value)
    expect(cell.text).toBe(EMPTY_PLACEHOLDER)
    expect(cell.empty).toBe(true)
    expect(cell.text).not.toMatch(/NaN|Invalid|undefined|null/)
  })

  it('a custom placeholder', () => {
    expect(formatCellValue(null, { kind: 'text' }, { placeholder: '' }).text).toBe('')
  })
})

describe('cell formats: text, boolean, badge, json', () => {
  it('text max length', () => {
    expect(f({ kind: 'text', max_length: 5 }, 'Hello world').text).toBe('Hello…')
    expect(f({ kind: 'text' }, 42).text).toBe('42')
  })

  it('booleans', () => {
    expect(f({ kind: 'boolean' }, true).text).toBe('Yes')
    expect(f({ kind: 'boolean' }, 'false').text).toBe('No')
    expect(f({ kind: 'boolean', boolean_style: 'check' }, 1).text).toBe('✓')
    expect(f({ kind: 'boolean', boolean_style: 'custom', true_label: 'Active', false_label: 'Inactive' }, false).text).toBe('Inactive')
  })

  it('badges: label and colour map, case-insensitive, a default colour', () => {
    const format = { kind: 'badge' as const, badges: [{ value: 'High', label: 'High risk', color: 'red' as const }, { value: 'Low', color: 'green' as const }], default_color: 'amber' as const }
    expect(f(format, 'High')).toMatchObject({ text: 'High risk', as: 'badge', color: 'red' })
    expect(f(format, 'low')).toMatchObject({ text: 'low', color: 'green' })
    expect(f(format, 'Medium')).toMatchObject({ text: 'Medium', color: 'amber' })
    expect(normalizeCellFormat({ kind: 'badge', badges: [{ value: 'x', color: 'neon' }] }).badges![0].color).toBe('gray')
  })

  it('json pretty-prints and is bounded', () => {
    expect(f({ kind: 'json' }, { a: 1 }).text).toBe('{\n  "a": 1\n}')
    expect(f({ kind: 'json' }, '{"b":2}').text).toBe('{\n  "b": 2\n}')
    expect(f({ kind: 'json' }, { s: 'x'.repeat(5000) }).text.length).toBeLessThan(2100)
  })
})

describe('links and images are sanitised', () => {
  it('http(s), mailto and tel only', () => {
    expect(safeCellHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeCellHref('ana@example.com')).toBe('mailto:ana@example.com')
    expect(safeCellHref('+64 9 555 1234')).toBe('tel:+6495551234')
    expect(safeCellHref('javascript:alert(1)')).toBeNull()
    expect(safeCellHref('JaVaScRiPt:alert(1)', 'url')).toBeNull()
    expect(safeCellHref('data:text/html,<script>')).toBeNull()
    expect(safeCellHref('https://user:pass@example.com')).toBeNull()
    expect(safeCellHref('vbscript:x')).toBeNull()
    expect(safeCellHref('mailto:a@b.co?subject=<x>')).toBeNull()
    expect(safeCellHref('https://example.com', 'email')).toBeNull()
  })

  it('a link format falls back to text for unsafe values', () => {
    expect(f({ kind: 'link' }, 'javascript:alert(1)')).toMatchObject({ as: 'text', text: 'javascript:alert(1)' })
    expect(f({ kind: 'link' }, 'https://usertasks.test')).toMatchObject({ as: 'link', href: 'https://usertasks.test/' })
  })

  it('images: app paths and allowed https hosts only', () => {
    expect(safeImageSrc('/files/abc.png')).toBe('/files/abc.png')
    expect(safeImageSrc('//evil.test/x.png')).toBeNull()
    expect(safeImageSrc('https://img.example.com/x.png')).toBeNull()
    expect(safeImageSrc('https://img.example.com/x.png', ['img.example.com'])).toBe('https://img.example.com/x.png')
    expect(safeImageSrc('https://a.cdn.example.com/x.png', ['*.cdn.example.com'])).toBe('https://a.cdn.example.com/x.png')
    expect(safeImageSrc('http://img.example.com/x.png', ['img.example.com'])).toBeNull()
    expect(safeImageSrc('data:image/png;base64,AAAA', ['img.example.com'])).toBeNull()
    expect(f({ kind: 'image', image_hosts: ['img.example.com'] }, 'https://evil.test/x.png').as).toBe('text')
  })
})

describe('defaults and alignment', () => {
  it('defaults from the column type, or inferred from samples', () => {
    expect(defaultFormatKind('number')).toBe('number')
    expect(defaultFormatKind('select')).toBe('badge')
    expect(defaultFormatKind('email')).toBe('link')
    expect(defaultFormatKind(undefined, [1, 2, 3])).toBe('integer')
    expect(defaultFormatKind(undefined, [1.5])).toBe('number')
    expect(defaultFormatKind(undefined, ['2026-01-01'])).toBe('date')
    expect(defaultFormatKind(undefined, ['2026-01-01T10:00:00Z'])).toBe('datetime')
    expect(defaultFormatKind(undefined, [true, false])).toBe('boolean')
    expect(defaultFormatKind(undefined, ['https://x.test'])).toBe('link')
    expect(defaultFormatKind(undefined, [{ a: 1 }])).toBe('json')
    expect(defaultFormatKind(undefined, ['plain'])).toBe('text')
  })

  it('numbers right, booleans centred, an override wins', () => {
    expect(defaultAlign('currency')).toBe('right')
    expect(defaultAlign('boolean')).toBe('center')
    expect(defaultAlign('text')).toBe('left')
    expect(f({ kind: 'number', align: 'left' }, 1).align).toBe('left')
  })

  it('unknown kinds fall back; formatting never changes the value', () => {
    expect(normalizeCellFormat({ kind: 'nope' }, 'number').kind).toBe('number')
    const value = { n: 1234.5 }
    f({ kind: 'currency' }, value.n)
    expect(value.n).toBe(1234.5)
  })
})
