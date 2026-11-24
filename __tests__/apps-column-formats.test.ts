import { describe, expect, it } from 'vitest'
import { WIDGET_CONFIG_SCHEMAS } from '@/lib/apps/schema'
import { columnCurrency, displayText, formatCardField, formatColumnValue } from '@/lib/apps/field-format'
import * as cardSources from '@/lib/services/app-card-sources'

describe('data grid / record card column formats', () => {
  it('the schemas take formats by column key (and refuse unknown formats, empty keys, more than 30)', () => {
    const grid = WIDGET_CONFIG_SCHEMAS.data_grid.parse({ columns: ['amount'], formats: { amount: { format: 'currency', decimals: 0 }, probability: { format: 'progress', max: 100 }, close_date: { format: 'date' } } })
    expect(grid.formats?.amount).toEqual({ format: 'currency', decimals: 0 })
    expect(WIDGET_CONFIG_SCHEMAS.record_card.parse({ fields: ['arr'], formats: { arr: { format: 'currency', currency: 'EUR' } } }).formats?.arr.currency).toBe('EUR')
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.parse({ formats: null }).formats).toBeNull()
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.parse({}).formats).toBeUndefined()
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.safeParse({ formats: { amount: { format: 'money' } } }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.safeParse({ formats: { '': { format: 'number' } } }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.safeParse({ formats: { amount: { format: 'number', key: 'x' } } }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`c${i}`, { format: 'number' }]))
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.safeParse({ formats: many }).success).toBe(false)
  })

  it('formats a value by its column format; no format (or text) leaves it to the widget', () => {
    expect(formatColumnValue('amount', 202200, { format: 'currency', decimals: 0 })).toEqual({ value: '$202,200' })
    expect(formatColumnValue('amount', '202200', { format: 'currency', decimals: 0 })?.value).toBe('$202,200')
    expect(formatColumnValue('amount', 990.5, { format: 'currency' }, { key: 'amount', currency: 'EUR' })?.value).toBe('€990.50')
    expect(formatColumnValue('employees', 12500, { format: 'number' })?.value).toBe('12,500')
    expect(formatColumnValue('close_date', '2027-01-09', { format: 'date' })?.value).toBe('9 Jan 2027')
    expect(formatColumnValue('probability', 75, { format: 'progress' })).toEqual({ value: '75%', progress: 0.75 })
    expect(formatColumnValue('year', 2026, undefined)).toBeNull()
    expect(formatColumnValue('year', 2026, { format: 'text' })).toBeNull()
    expect(formatColumnValue('amount', 'n/a', { format: 'currency' })?.value).toBe('n/a')
    expect(formatColumnValue('amount', null, { format: 'currency' })?.value).toBe('—')
  })

  it('the card sources keep exporting the shared helpers', () => {
    expect(cardSources.formatCardField).toBe(formatCardField)
    expect(cardSources.displayText).toBe(displayText)
    expect(columnCurrency({ key: 'a', control_options: { currency: 'gbp' } })).toBe('GBP')
    expect(columnCurrency({ key: 'a', currency: 'dollars' })).toBeNull()
  })
})

describe('card footer format', async () => {
  const { toCard } = await import('@/lib/services/app-card-sources')
  it('a date / money footer is formatted; none or text stays as written; empty stays empty', () => {
    const t = (footer_format?: string) => WIDGET_CONFIG_SCHEMAS.card_view.parse({ template: { title: 'subject', footer: 'date', ...(footer_format ? { footer_format } : {}) } })
    expect(toCard({ subject: 'Call', date: '2026-11-20' }, 'a', t('date')).footer).toBe('20 Nov 2026')
    expect(toCard({ subject: 'Call', date: '2026-11-20' }, 'a', t()).footer).toBe('2026-11-20')
    expect(toCard({ subject: 'Call', date: '2026-11-20' }, 'a', t('text')).footer).toBe('2026-11-20')
    expect(toCard({ subject: 'Call' }, 'a', t('date')).footer).toBeNull()
    expect(WIDGET_CONFIG_SCHEMAS.card_view.safeParse({ template: { title: 'x', footer: 'y', footer_format: 'weird' } }).success).toBe(false)
  })
})
