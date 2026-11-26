/**
 * ISO 8601 date-time strings, seconds optional.
 *
 * zod 4.6 made `z.iso.datetime()` / `z.string().datetime()` require seconds
 * whenever the value carries `Z` or an offset (RFC 3339). The API, the forms
 * wizard and the UI reads have always accepted `2026-01-01T10:00Z`, so these
 * schemas keep zod 4.3's grammar: `YYYY-MM-DDTHH:MM[:SS[.fff]]` followed by
 * `Z` (or `±HH:MM` with `offset`). The published JSON Schema stays
 * `{ type: string, format: date-time, pattern }`, with the same pattern the
 * OpenAPI document carried before the upgrade.
 *
 * Only imports zod: usable from API schemas, services and the forms wizard.
 */
import { z } from 'zod'

/** zod's calendar-checked date (leap years included), without the anchors. */
const DATE = z.regexes.date.source.replace(/^\^/, '').replace(/\$$/, '')
const TIME = '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?'
const OFFSET = '([+-](?:[01]\\d|2[0-3]):[0-5]\\d)'

export const ISO_DATETIME_UTC = new RegExp(`^${DATE}T(?:${TIME}(?:Z))$`)
export const ISO_DATETIME_OFFSET = new RegExp(`^${DATE}T(?:${TIME}(?:Z|${OFFSET}))$`)

/**
 * An ISO date-time string, seconds optional. `offset: true` also accepts
 * `±HH:MM` offsets; otherwise only `Z` (zod's default).
 */
export function isoDateTime(options: { offset?: boolean } = {}) {
  return z
    .string()
    .regex(options.offset ? ISO_DATETIME_OFFSET : ISO_DATETIME_UTC, { message: 'Invalid ISO date-time' })
    .meta({ format: 'date-time' })
}
