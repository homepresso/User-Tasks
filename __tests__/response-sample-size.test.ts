import { describe, it, expect } from 'vitest'
import { captureResponseSample, trimSample, SCHEMA_LIMITS } from '@/lib/response-schema'

/** Captured samples keep up to 20 list items (not 3), within a size budget. */
describe('response sample size', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `Customer ${i + 1}`, email: `c${i + 1}@example.com` }))

  it('keeps up to sampleArrayItems (20) items', () => {
    expect(SCHEMA_LIMITS.sampleArrayItems).toBe(20)
    const sample = trimSample({ data: rows }) as any
    expect(sample.data).toHaveLength(20)
    expect(sample.data[19].id).toBe(20)
    const captured = captureResponseSample(null, { data: rows })
    expect((captured.sample as any).data).toHaveLength(20)
  })

  it('the item count is configurable per call', () => {
    expect((trimSample(rows, { arrayItems: 5 }) as any[])).toHaveLength(5)
  })

  it('shrinks the item count until the sample fits the size budget', () => {
    const big = Array.from({ length: 40 }, (_, i) => ({ id: i, blob: Object.fromEntries(Array.from({ length: 60 }, (_, k) => [`f${k}`, 'y'.repeat(190)])) }))
    const sample = trimSample({ data: big }) as any
    expect(JSON.stringify(sample).length).toBeLessThanOrEqual(SCHEMA_LIMITS.sampleMaxBytes)
    expect(sample.data.length).toBeGreaterThanOrEqual(1)
    expect(sample.data.length).toBeLessThan(20)
  })

  it('still masks credentials and cuts long strings', () => {
    const sample = trimSample([{ token: 'abc', note: 'x'.repeat(500) }]) as any
    expect(sample[0].token).toBe('••••')
    expect(sample[0].note.length).toBeLessThan(210)
  })
})
