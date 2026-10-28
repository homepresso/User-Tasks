import { describe, it, expect } from 'vitest'
import { columnKey, getCellValue, getCellByIdentifier, normalizeRowData, slugifyColumnName } from '@/lib/data-table-cells'

const orderNo = { id: 'c1', key: 'order_no', name: 'Order No' }
const legacyCol = { id: 'c2', name: 'Ship Method' } // UI-created column without a key

describe('columnKey', () => {
  it('uses the explicit key when present', () => {
    expect(columnKey(orderNo)).toBe('order_no')
  })
  it('slugs the name for legacy columns', () => {
    expect(columnKey(legacyCol)).toBe('ship_method')
    expect(slugifyColumnName('Grand Total ($)')).toBe('grand_total')
  })
})

describe('getCellValue', () => {
  it('reads canonical key-keyed data (workflow/MCP writes)', () => {
    expect(getCellValue({ order_no: 'ORD-1' }, orderNo)).toBe('ORD-1')
  })
  it('falls back to display-name keys (legacy grid writes)', () => {
    expect(getCellValue({ 'Order No': 'ORD-2' }, orderNo)).toBe('ORD-2')
  })
  it('prefers the canonical key when both spellings exist', () => {
    expect(getCellValue({ order_no: 'new', 'Order No': 'old' }, orderNo)).toBe('new')
  })
  it('resolves slug-insensitive spellings', () => {
    expect(getCellValue({ 'ORDER NO': 'ORD-3' }, orderNo)).toBe('ORD-3')
  })
  it('returns undefined when absent', () => {
    expect(getCellValue({ other: 1 }, orderNo)).toBeUndefined()
    expect(getCellValue(null, orderNo)).toBeUndefined()
  })
})

describe('getCellByIdentifier', () => {
  it('matches exact, then slug-insensitive', () => {
    expect(getCellByIdentifier({ ship_method: 'express' }, 'ship_method')).toBe('express')
    expect(getCellByIdentifier({ ship_method: 'express' }, 'Ship Method')).toBe('express')
    expect(getCellByIdentifier({ 'Ship Method': 'express' }, 'ship_method')).toBe('express')
  })
})

describe('normalizeRowData', () => {
  it('migrates name-keyed cells onto canonical keys', () => {
    const result = normalizeRowData({ 'Order No': 'ORD-9', 'Ship Method': 'economy' }, [orderNo, legacyCol])
    expect(result).toEqual({ order_no: 'ORD-9', ship_method: 'economy' })
  })
  it('collapses duplicate spellings, canonical value winning', () => {
    const result = normalizeRowData({ order_no: 'keep', 'Order No': 'drop' }, [orderNo])
    expect(result).toEqual({ order_no: 'keep' })
  })
  it('preserves entries that do not belong to a known column', () => {
    const result = normalizeRowData({ 'Order No': 'ORD-9', 'Date Created': '2026-07-09', id: 4 }, [orderNo])
    expect(result).toEqual({ order_no: 'ORD-9', 'Date Created': '2026-07-09', id: 4 })
  })
})
