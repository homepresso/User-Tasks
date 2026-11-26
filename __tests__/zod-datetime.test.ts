/**
 * lib/zod-datetime: zod 4.6 made `.datetime()` require seconds; the API,
 * the forms wizard and the UI reads keep accepting them optional.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isoDateTime } from '@/lib/zod-datetime'
import { grantEntitlementBody } from '@/lib/api-schemas/licence'

const ok = (schema: z.ZodType, v: string) => schema.safeParse(v).success

describe('isoDateTime', () => {
  const withOffset = isoDateTime({ offset: true })
  const utc = isoDateTime()

  it('accepts date-times with and without seconds', () => {
    for (const v of ['2026-01-01T10:00Z', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00.123Z', '2024-02-29T23:59Z']) {
      expect(ok(withOffset, v), v).toBe(true)
      expect(ok(utc, v), v).toBe(true)
    }
  })

  it('accepts offsets only with offset: true', () => {
    for (const v of ['2026-01-01T10:00+02:00', '2026-01-01T10:00:00-05:30']) {
      expect(ok(withOffset, v), v).toBe(true)
      expect(ok(utc, v), v).toBe(false)
    }
  })

  it('rejects garbage, bare dates, impossible dates and missing zones', () => {
    for (const v of ['garbage', '', '2026-01-01', '2026-01-01T10Z', '2026-13-01T10:00Z', '2026-02-30T10:00Z', '2025-02-29T10:00Z', '2026-01-01T24:00Z', '2026-01-01T10:00', '2026-01-01T10:00:00+2']) {
      expect(ok(withOffset, v), v).toBe(false)
    }
  })

  it('publishes a date-time string with the seconds-optional pattern', () => {
    const json = z.toJSONSchema(withOffset) as Record<string, unknown>
    expect(json.type).toBe('string')
    expect(json.format).toBe('date-time')
    expect(String(json.pattern)).toContain('[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?')
  })

  it('the licence API takes an ends_at without seconds', () => {
    const shape = grantEntitlementBody.shape as Record<string, z.ZodType>
    expect(ok(shape.ends_at, '2026-01-01T10:00Z')).toBe(true)
    expect(ok(shape.ends_at, '2026-01-01T10:00:00Z')).toBe(true)
    expect(ok(shape.ends_at, 'tomorrow')).toBe(false)
  })
})
