/**
 * ut_dates — Dates & business calendar: business days, SLA due times in
 * working hours, durations and ages, time zone conversion, recurring
 * schedules and fiscal periods. Time zones come from the host
 * (ctx.intl.zonedParts / zonedToUtc); everything else is UTC day arithmetic.
 */

import { defineAction, type ActionContext } from '@usertasks/action'
import { choice, num, optNum, str, type Inputs } from '../../shared/inputs'
import {
  WEEKDAY_NAMES, addMonths, dayNumber, daysInMonth, fromDayNumber, holidaySet, hms, isoDay, isoWeekday,
  offsetText, parseTimeOfDay, parseWeekday, parseWorkingHours, parseYmd, weekdaySet, type Ymd,
} from './calendar'

const MON_FRI = [1, 2, 3, 4, 5]
const SAT_SUN = [6, 7]

interface LocalMoment {
  /** UTC instant (ms). */
  t: number
  /** Local calendar day number and seconds into it. */
  day: number
  sec: number
  offset: number
  /** Whether the input was a date without a time. */
  dateOnly: boolean
}

function zone(inputs: Inputs, name = 'time_zone'): string {
  return str(inputs, name, { default: 'UTC' })
}

/** Local wall time (day number + seconds) → UTC instant (ms) in a zone. */
function localToUtc(ctx: ActionContext, day: number, sec: number, tz: string): number {
  const extra = Math.floor(sec / 86400)
  const s = sec - extra * 86400
  const local = `${isoDay(day + extra)}T${hms(s)}`
  return Date.parse(ctx.intl.zonedToUtc(local, tz))
}

function momentOf(ctx: ActionContext, t: number, tz: string, dateOnly = false): LocalMoment {
  const p = ctx.intl.zonedParts(new Date(t).toISOString(), tz)
  return { t, day: dayNumber({ y: p.year, m: p.month, d: p.day }), sec: p.hour * 3600 + p.minute * 60 + p.second, offset: p.offset_minutes, dateOnly }
}

/**
 * A date or date-time input → a moment in `tz`. Values with Z or an offset
 * are instants; values without one are wall-clock times in `tz`; a bare
 * date is midnight there.
 */
function parseMoment(ctx: ActionContext, raw: string, name: string, tz: string): LocalMoment {
  const s = raw.trim()
  if (!s) throw new Error(`${name} is required`)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const day = dayNumber(parseYmd(s, name))
    return { ...momentOf(ctx, localToUtc(ctx, day, 0, tz), tz), dateOnly: true }
  }
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s)
  if (!m) throw new Error(`${name} must be a date (YYYY-MM-DD) or date-time (ISO 8601, e.g. 2026-11-02T09:30:00Z), got "${s.slice(0, 40)}"`)
  parseYmd(m[1], name)
  if (Number(m[2]) > 23 || Number(m[3]) > 59 || Number(m[4] ?? 0) > 59) throw new Error(`${name} has an invalid time`)
  if (m[5]) {
    const t = Date.parse(s.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
    if (Number.isNaN(t)) throw new Error(`${name} is not a valid date-time`)
    return momentOf(ctx, t, tz)
  }
  const day = dayNumber(parseYmd(m[1], name))
  const sec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4] ?? 0)
  return momentOf(ctx, localToUtc(ctx, day, sec, tz), tz)
}

function nowOrInput(ctx: ActionContext, inputs: Inputs, name: string, tz: string): LocalMoment {
  const raw = str(inputs, name)
  return raw ? parseMoment(ctx, raw, name, tz) : momentOf(ctx, Date.now(), tz)
}

const iso = (t: number) => new Date(t).toISOString()
const localIso = (ctx: ActionContext, t: number, tz: string) => ctx.intl.zonedParts(iso(t), tz).iso

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

// ── Operations ──────────────────────────────────────────────────────────────

export default defineAction({
  operations: {
    add_business_days(inputs: Inputs) {
      const start = dayNumber(parseYmd(str(inputs, 'date', { required: true }), 'date'))
      const days = num(inputs, 'days', { integer: true, min: -10000, max: 10000 })
      const weekend = weekdaySet(inputs, 'weekend_days', SAT_SUN)
      if (weekend.size >= 7) throw new Error('weekend_days cannot be every day of the week')
      const holidays = holidaySet(inputs)
      const isBusiness = (n: number) => !weekend.has(isoWeekday(n)) && !holidays.has(n)
      let cur = start
      const step = days < 0 ? -1 : 1
      let remaining = Math.abs(days)
      let guard = 0
      if (days === 0) {
        while (!isBusiness(cur)) {
          cur++
          if (++guard > 3700) throw new Error('No business day within 10 years (check weekend_days and holidays)')
        }
      }
      while (remaining > 0) {
        cur += step
        if (isBusiness(cur)) remaining--
        if (++guard > 400_000) throw new Error('Too many holidays: no business days found')
      }
      return { date: isoDay(cur), weekday: WEEKDAY_NAMES[isoWeekday(cur) - 1], calendar_days: cur - start }
    },

    sla_due(inputs: Inputs, ctx: ActionContext) {
      const tz = zone(inputs)
      const start = parseMoment(ctx, str(inputs, 'start', { required: true }), 'start', tz)
      const hours = num(inputs, 'hours', { min: 0, max: 100_000 })
      const [ws, we] = parseWorkingHours(str(inputs, 'working_hours', { default: '09:00-17:00' }))
      const workdays = weekdaySet(inputs, 'working_days', MON_FRI)
      const holidays = holidaySet(inputs)
      let remaining = Math.round(hours * 3600)
      let day = start.day
      let sec = start.sec
      let guard = 0
      for (;;) {
        if (workdays.has(isoWeekday(day)) && !holidays.has(day)) {
          if (sec < ws) sec = ws
          if (sec < we) {
            const available = we - sec
            if (remaining <= available) {
              sec += remaining
              break
            }
            remaining -= available
          }
        }
        day++
        sec = 0
        if (++guard > 3700) throw new Error('No working time within 10 years (check working_days, working_hours and holidays)')
      }
      const due = localToUtc(ctx, day, sec, tz)
      const local = momentOf(ctx, due, tz)
      return {
        due: iso(due),
        due_local: localIso(ctx, due, tz),
        due_date: isoDay(local.day),
        start_local: localIso(ctx, start.t, tz),
        calendar_hours: Math.round((due - start.t) / 36_000) / 100,
      }
    },

    duration(inputs: Inputs, ctx: ActionContext) {
      const tz = zone(inputs)
      const a = parseMoment(ctx, str(inputs, 'from', { required: true }), 'from', tz)
      const b = nowOrInput(ctx, inputs, 'to', tz)
      const weekend = weekdaySet(inputs, 'weekend_days', SAT_SUN)
      const holidays = holidaySet(inputs)
      const sign = b.t < a.t ? -1 : 1
      const [lo, hi] = sign < 0 ? [b, a] : [a, b]
      const elapsedMs = hi.t - lo.t
      // Calendar breakdown on wall-clock dates and times.
      let toDay = hi.day
      let rem = hi.sec - lo.sec
      if (rem < 0) { toDay -= 1; rem += 86400 }
      const loYmd = fromDayNumber(lo.day)
      const toYmd = fromDayNumber(toDay)
      let months = (toYmd.y - loYmd.y) * 12 + (toYmd.m - loYmd.m)
      if (dayNumber(addMonths(loYmd, months)) > toDay) months -= 1
      const afterMonths = dayNumber(addMonths(loYmd, months))
      const years = Math.floor(months / 12)
      const restMonths = months % 12
      const restDays = toDay - afterMonths
      const remHours = Math.floor(rem / 3600)
      const remMinutes = Math.floor((rem % 3600) / 60)
      let business = 0
      for (let d = lo.day + 1; d <= hi.day; d++) {
        if (!weekend.has(isoWeekday(d)) && !holidays.has(d)) business++
        if (d - lo.day > 400_000) throw new Error('The dates are too far apart')
      }
      const parts = [[years, 'year'], [restMonths, 'month'], [restDays, 'day'], [remHours, 'hour'], [remMinutes, 'minute']] as const
      const shown = parts.filter(([n]) => n > 0).slice(0, 3).map(([n, u]) => plural(n, u))
      const human = (sign < 0 && shown.length ? '-' : '') + (shown.length ? shown.join(', ') : '0 minutes')
      const s = (n: number) => (n === 0 ? 0 : sign * n)
      return {
        days: s(toDay - lo.day),
        business_days: s(business),
        hours: s(Math.round(elapsedMs / 36_000) / 100),
        minutes: s(Math.floor(elapsedMs / 60_000)),
        human,
        age_years: s(years),
        age_months: s(restMonths),
        age_days: s(restDays),
      }
    },

    convert_timezone(inputs: Inputs, ctx: ActionContext) {
      const fromZone = zone(inputs, 'from_zone')
      const toZone = str(inputs, 'to_zone', { required: true })
      const m = parseMoment(ctx, str(inputs, 'datetime', { required: true }), 'datetime', fromZone)
      const p = ctx.intl.zonedParts(iso(m.t), toZone)
      return {
        iso: iso(m.t),
        local: p.iso,
        local_date: p.iso.slice(0, 10),
        local_time: p.iso.slice(11, 16),
        weekday: WEEKDAY_NAMES[isoWeekday(dayNumber({ y: p.year, m: p.month, d: p.day })) - 1],
        offset: offsetText(p.offset_minutes),
        offset_minutes: p.offset_minutes,
      }
    },

    next_occurrence(inputs: Inputs, ctx: ActionContext) {
      const tz = zone(inputs)
      const frequency = choice(inputs, 'frequency', ['daily', 'weekly', 'monthly', 'yearly'] as const, 'weekly')
      const interval = num(inputs, 'interval', { integer: true, min: 1, max: 1000, default: 1 })
      const count = num(inputs, 'count', { integer: true, min: 1, max: 100, default: 5 })
      const time = parseTimeOfDay(str(inputs, 'time', { default: '09:00' }), 'time')
      const after = nowOrInput(ctx, inputs, 'after', tz)
      const startRaw = str(inputs, 'start')
      const anchor = startRaw ? dayNumber(parseYmd(startRaw, 'start')) : after.day
      const anchorYmd = fromDayNumber(anchor)
      const excluded = holidaySet(inputs, 'exclude_dates')
      const daysOfWeek = frequency === 'weekly' ? weekdaySet(inputs, 'days_of_week', [isoWeekday(anchor)]) : new Set<number>()
      const nthRaw = choice(inputs, 'nth_week', ['none', 'first', 'second', 'third', 'fourth', 'last'] as const, 'none')
      const nth = nthRaw !== 'none' ? (nthRaw === 'last' ? -1 : ['first', 'second', 'third', 'fourth'].indexOf(nthRaw) + 1) : 0
      const nthWeekday = nth ? parseWeekday(str(inputs, 'weekday', { required: true }), 'weekday') : 0
      const dom = optNum(inputs, 'day_of_month', { integer: true, min: -1, max: 31 }) ?? anchorYmd.d
      if (dom === 0) throw new Error('day_of_month must be 1–31, or -1 for the last day')
      const month = optNum(inputs, 'month', { integer: true, min: 1, max: 12 }) ?? anchorYmd.m
      const mondayOf = (n: number) => n - (isoWeekday(n) - 1)

      const dayMatches = (ymd: Ymd, n: number): boolean => {
        if (nth) {
          if (isoWeekday(n) !== nthWeekday) return false
          if (nth > 0) return Math.ceil(ymd.d / 7) === nth
          return ymd.d + 7 > daysInMonth(ymd.y, ymd.m)
        }
        const last = daysInMonth(ymd.y, ymd.m)
        // Day 29–31 falls on the last day of shorter months; -1 is always the last day.
        return ymd.d === (dom === -1 ? last : Math.min(dom, last))
      }
      const matches = (n: number): boolean => {
        if (n < anchor) return false
        const ymd = fromDayNumber(n)
        switch (frequency) {
          case 'daily': return (n - anchor) % interval === 0
          case 'weekly': return daysOfWeek.has(isoWeekday(n)) && ((mondayOf(n) - mondayOf(anchor)) / 7) % interval === 0
          case 'monthly': return ((ymd.y - anchorYmd.y) * 12 + (ymd.m - anchorYmd.m)) % interval === 0 && dayMatches(ymd, n)
          case 'yearly': return ymd.m === month && (ymd.y - anchorYmd.y) % interval === 0 && dayMatches(ymd, n)
        }
      }
      const occurrences: string[] = []
      const local: string[] = []
      const limit = 366 * 200
      for (let n = Math.max(anchor, after.day), i = 0; occurrences.length < count && i < limit; n++, i++) {
        if (excluded.has(n) || !matches(n)) continue
        const t = localToUtc(ctx, n, time, tz)
        if (t <= after.t) continue
        occurrences.push(iso(t))
        local.push(localIso(ctx, t, tz))
      }
      return { next: occurrences[0] ?? null, next_local: local[0] ?? null, occurrences, occurrences_local: local }
    },

    fiscal_period(inputs: Inputs, ctx: ActionContext) {
      const raw = str(inputs, 'date')
      const ymd = raw ? parseYmd(raw, 'date') : fromDayNumber(momentOf(ctx, Date.now(), zone(inputs)).day)
      const startMonth = num(inputs, 'start_month', { integer: true, min: 1, max: 12, default: 7 })
      const naming = choice(inputs, 'year_naming', ['end', 'start'] as const, 'end')
      const offset = (ymd.m - startMonth + 12) % 12
      const startYear = ymd.m >= startMonth ? ymd.y : ymd.y - 1
      const fiscalYear = startMonth === 1 ? ymd.y : naming === 'end' ? startYear + 1 : startYear
      const quarter = Math.floor(offset / 3) + 1
      const yearStart: Ymd = { y: startYear, m: startMonth, d: 1 }
      const monthStart = (k: number) => dayNumber(addMonths(yearStart, k, 1))
      const today = dayNumber(ymd)
      return {
        fiscal_year: fiscalYear,
        quarter,
        period: offset + 1,
        label: `FY${fiscalYear} Q${quarter}`,
        period_label: `FY${fiscalYear} P${String(offset + 1).padStart(2, '0')}`,
        period_start: isoDay(monthStart(offset)),
        period_end: isoDay(monthStart(offset + 1) - 1),
        quarter_start: isoDay(monthStart((quarter - 1) * 3)),
        quarter_end: isoDay(monthStart(quarter * 3) - 1),
        year_start: isoDay(monthStart(0)),
        year_end: isoDay(monthStart(12) - 1),
        day_of_year: today - monthStart(0) + 1,
      }
    },
  },
})
