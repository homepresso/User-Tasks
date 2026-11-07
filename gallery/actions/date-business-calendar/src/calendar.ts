/**
 * Calendar arithmetic on day numbers (days since 1970-01-01, UTC). Never uses
 * the sandbox's local time zone: only Date.UTC and getUTC* methods.
 */

import { isBlank, isPlainObject, list, type Inputs } from '../../shared/inputs'

export const DAY_MS = 86_400_000
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface Ymd { y: number; m: number; d: number }

export const dayNumber = ({ y, m, d }: Ymd): number => Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)

export function fromDayNumber(n: number): Ymd {
  const t = new Date(n * DAY_MS)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export const isoDate = ({ y, m, d }: Ymd): string => `${pad(y, 4)}-${pad(m)}-${pad(d)}`
export const isoDay = (n: number): string => isoDate(fromDayNumber(n))

/** ISO weekday 1 (Monday) … 7 (Sunday). */
export const isoWeekday = (n: number): number => ((((n + 3) % 7) + 7) % 7) + 1

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** A YYYY-MM-DD date (the date part of a longer value) that really exists. */
export function parseYmd(raw: string, name: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD), got "${raw.slice(0, 40)}"`)
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) throw new Error(`${name} is not a real date (${m[0]})`)
  return ymd
}

/** Add months, clamping the day to the end of shorter months (Jan 31 + 1 month = Feb 28/29). */
export function addMonths({ y, m, d }: Ymd, months: number, day = d): Ymd {
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12 + 12) % 12 + 1
  return { y: ny, m: nm, d: Math.min(day, daysInMonth(ny, nm)) }
}

const DAY_ALIASES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
}

/** A weekday name (Monday, mon) or number (ISO 1–7, or 0 for Sunday) → ISO 1–7. */
export function parseWeekday(raw: unknown, name: string): number {
  const s = String(raw ?? '').trim().toLowerCase()
  if (/^\d$/.test(s)) {
    const n = Number(s)
    if (n === 0 || n === 7) return 7
    if (n >= 1 && n <= 6) return n
  }
  const hit = DAY_ALIASES[s]
  if (!hit) throw new Error(`${name}: "${String(raw).slice(0, 20)}" is not a weekday (use Monday … Sunday)`)
  return hit
}

export function weekdaySet(inputs: Inputs, name: string, dflt: number[]): Set<number> {
  const raw = list(inputs, name)
  if (raw.length === 0) return new Set(dflt)
  return new Set(raw.map((v) => parseWeekday(v, name)))
}

/** Holidays: dates (YYYY-MM-DD, or objects with a date) → day numbers. */
export function holidaySet(inputs: Inputs, name = 'holidays'): Set<number> {
  const out = new Set<number>()
  list(inputs, name).forEach((entry, i) => {
    if (isBlank(entry)) return
    const raw = isPlainObject(entry) ? String(entry.date ?? '') : String(entry)
    out.add(dayNumber(parseYmd(raw, `${name}[${i}]`)))
  })
  return out
}

/** "09:00-17:30" → [start, end] seconds of the day. */
export function parseWorkingHours(raw: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})\s*[-\u2013to]+\s*(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) throw new Error(`working_hours must look like 09:00-17:00 (got "${raw.slice(0, 30)}")`)
  const start = Number(m[1]) * 3600 + Number(m[2]) * 60
  const end = Number(m[3]) * 3600 + Number(m[4]) * 60
  if (Number(m[2]) > 59 || Number(m[4]) > 59 || start > 86400 || end > 86400 || start >= end) {
    throw new Error(`working_hours must be a start time before an end time within one day (got "${raw.slice(0, 30)}")`)
  }
  return [start, end]
}

/** "HH:mm[:ss]" → seconds of the day. */
export function parseTimeOfDay(raw: string, name: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) > 59) throw new Error(`${name} must be a time like 09:00 (got "${raw.slice(0, 20)}")`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
}

export function hms(seconds: number): string {
  const s = Math.round(seconds)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export function offsetText(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
