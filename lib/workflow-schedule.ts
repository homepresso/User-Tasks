import { isObjectLike } from '@/lib/utils/guards'

/**
 * Schedule-trigger math for workflows (trigger_type 'schedule').
 *
 * A schedule lives in the trigger node's config (see ScheduleTriggerConfig in
 * the builder). The cron sweep (/api/cron/process-schedules) asks "what is the
 * most recent occurrence at or before now?" and fires the workflow when that
 * occurrence is newer than workflows.schedule_last_fired_at — exactly-once per
 * occurrence, with catch-up limited to the single most recent slot.
 *
 * Pure and dependency-free: timezone handling uses Intl only.
 */

export type ScheduleMode = 'every_minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'once'

export interface ScheduleConfig {
  schedule_mode: ScheduleMode
  /** every_minutes: interval in minutes (min 1). */
  interval_minutes?: number
  /** hourly: minute of the hour, 0-59. */
  minute_of_hour?: number
  /** daily / weekly / monthly: wall-clock "HH:MM" (24h) in `timezone`. */
  time_of_day?: string
  /** weekly: 0 (Sunday) – 6 (Saturday). */
  day_of_week?: number
  /** monthly: 1–31; clamped to the month's last day. */
  day_of_month?: number
  /** once: ISO datetime (UTC or with offset). */
  run_at?: string
  /** IANA timezone for wall-clock modes. Default UTC. */
  timezone?: string
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** An unknown IANA name would make every Intl call downstream throw — one bad
 *  config must not take down the whole schedule sweep. Falls back to UTC. */
function validTimezone(raw: unknown): string {
  const tz = typeof raw === 'string' && raw ? raw : 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** Parses/validates a raw trigger-node config into a ScheduleConfig, or null. */
export function normalizeScheduleConfig(raw: unknown): ScheduleConfig | null {
  if (!isObjectLike(raw)) return null
  const mode = String(raw.schedule_mode ?? '') as ScheduleMode
  if (!['every_minutes', 'hourly', 'daily', 'weekly', 'monthly', 'once'].includes(mode)) return null
  const config: ScheduleConfig = { schedule_mode: mode, timezone: validTimezone(raw.timezone) }
  if (mode === 'every_minutes') {
    const interval = Math.floor(Number(raw.interval_minutes))
    if (!Number.isFinite(interval) || interval < 1) return null
    config.interval_minutes = interval
  }
  if (mode === 'hourly') {
    const minute = Math.floor(Number(raw.minute_of_hour ?? 0))
    if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null
    config.minute_of_hour = minute
  }
  if (mode === 'daily' || mode === 'weekly' || mode === 'monthly') {
    const time = String(raw.time_of_day ?? '')
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) return null
    config.time_of_day = time
  }
  if (mode === 'weekly') {
    const day = Math.floor(Number(raw.day_of_week))
    if (!Number.isFinite(day) || day < 0 || day > 6) return null
    config.day_of_week = day
  }
  if (mode === 'monthly') {
    const day = Math.floor(Number(raw.day_of_month))
    if (!Number.isFinite(day) || day < 1 || day > 31) return null
    config.day_of_month = day
  }
  if (mode === 'once') {
    const runAt = new Date(String(raw.run_at ?? ''))
    if (Number.isNaN(runAt.getTime())) return null
    config.run_at = runAt.toISOString()
  }
  return config
}

// ─── Timezone helpers (Intl-based, no deps) ───

function getTimeZoneOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  )
  return asUTC - date.getTime()
}

/** UTC instant for a wall-clock time in a timezone (two-pass, DST-safe). */
function zonedWallTimeToUtc(timeZone: string, year: number, month1: number, day: number, hour: number, minute: number): Date {
  const wallAsUtc = Date.UTC(year, month1 - 1, day, hour, minute)
  let guess = new Date(wallAsUtc)
  for (let i = 0; i < 2; i++) {
    guess = new Date(wallAsUtc - getTimeZoneOffsetMs(timeZone, guess))
  }
  return guess
}

interface WallClock { year: number; month1: number; day: number; hour: number; minute: number; dayOfWeek: number }

function wallClockInZone(timeZone: string, date: Date): WallClock {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return {
    year: Number(parts.year), month1: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), dayOfWeek,
  }
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

function parseTimeOfDay(value: string | undefined): { hour: number; minute: number } {
  const [hour, minute] = String(value ?? '00:00').split(':').map(Number)
  return { hour: hour || 0, minute: minute || 0 }
}

// ─── Occurrence math ───

/** Most recent occurrence at or before `now`, or null if none exists yet. */
export function getPreviousOccurrence(config: ScheduleConfig, now: Date): Date | null {
  const tz = config.timezone ?? 'UTC'
  switch (config.schedule_mode) {
    case 'every_minutes': {
      const intervalMs = Math.max(1, config.interval_minutes ?? 1) * MINUTE_MS
      return new Date(Math.floor(now.getTime() / intervalMs) * intervalMs)
    }
    case 'hourly': {
      const minute = config.minute_of_hour ?? 0
      for (let hoursBack = 0; hoursBack <= 1; hoursBack++) {
        const wall = wallClockInZone(tz, new Date(now.getTime() - hoursBack * HOUR_MS))
        const candidate = zonedWallTimeToUtc(tz, wall.year, wall.month1, wall.day, wall.hour, minute)
        if (candidate.getTime() <= now.getTime()) return candidate
      }
      return null
    }
    case 'daily': {
      const { hour, minute } = parseTimeOfDay(config.time_of_day)
      for (let daysBack = 0; daysBack <= 1; daysBack++) {
        const wall = wallClockInZone(tz, new Date(now.getTime() - daysBack * DAY_MS))
        const candidate = zonedWallTimeToUtc(tz, wall.year, wall.month1, wall.day, hour, minute)
        if (candidate.getTime() <= now.getTime()) return candidate
      }
      return null
    }
    case 'weekly': {
      const { hour, minute } = parseTimeOfDay(config.time_of_day)
      const targetDay = config.day_of_week ?? 0
      for (let daysBack = 0; daysBack <= 7; daysBack++) {
        const wall = wallClockInZone(tz, new Date(now.getTime() - daysBack * DAY_MS))
        if (wall.dayOfWeek !== targetDay) continue
        const candidate = zonedWallTimeToUtc(tz, wall.year, wall.month1, wall.day, hour, minute)
        if (candidate.getTime() <= now.getTime()) return candidate
      }
      return null
    }
    case 'monthly': {
      const { hour, minute } = parseTimeOfDay(config.time_of_day)
      const targetDay = config.day_of_month ?? 1
      const wallNow = wallClockInZone(tz, now)
      for (let monthsBack = 0; monthsBack <= 1; monthsBack++) {
        let year = wallNow.year
        let month1 = wallNow.month1 - monthsBack
        if (month1 < 1) { month1 += 12; year -= 1 }
        const day = Math.min(targetDay, daysInMonth(year, month1))
        const candidate = zonedWallTimeToUtc(tz, year, month1, day, hour, minute)
        if (candidate.getTime() <= now.getTime()) return candidate
      }
      return null
    }
    case 'once': {
      const runAt = new Date(config.run_at ?? '')
      if (Number.isNaN(runAt.getTime())) return null
      return runAt.getTime() <= now.getTime() ? runAt : null
    }
  }
}

/** Next occurrence strictly after `now`, or null (e.g. a passed one-off). */
export function getNextOccurrence(config: ScheduleConfig, now: Date): Date | null {
  if (config.schedule_mode === 'once') {
    const runAt = new Date(config.run_at ?? '')
    if (Number.isNaN(runAt.getTime())) return null
    return runAt.getTime() > now.getTime() ? runAt : null
  }
  // Step forward from just past the previous occurrence in the smallest unit
  // the mode uses; bounded scan keeps this trivially correct across DST.
  const stepMs = config.schedule_mode === 'every_minutes'
    ? Math.max(1, config.interval_minutes ?? 1) * MINUTE_MS
    : config.schedule_mode === 'hourly' ? HOUR_MS : DAY_MS
  const maxSteps = config.schedule_mode === 'monthly' ? 32 : config.schedule_mode === 'weekly' ? 8 : 2
  for (let step = 1; step <= maxSteps; step++) {
    const probe = new Date(now.getTime() + step * stepMs)
    const occurrence = getPreviousOccurrence(config, probe)
    if (occurrence && occurrence.getTime() > now.getTime()) return occurrence
  }
  return null
}

/** Human-readable summary, e.g. "Daily at 09:00 (Pacific/Auckland)". */
export function describeSchedule(config: ScheduleConfig | null): string {
  if (!config) return 'Not configured'
  const tz = config.timezone && config.timezone !== 'UTC' ? ` (${config.timezone})` : ' (UTC)'
  switch (config.schedule_mode) {
    case 'every_minutes':
      return (config.interval_minutes ?? 1) === 1 ? 'Every minute' : `Every ${config.interval_minutes} minutes`
    case 'hourly':
      return `Hourly at :${String(config.minute_of_hour ?? 0).padStart(2, '0')}`
    case 'daily':
      return `Daily at ${config.time_of_day}${tz}`
    case 'weekly':
      return `Weekly on ${WEEKDAYS[config.day_of_week ?? 0]} at ${config.time_of_day}${tz}`
    case 'monthly':
      return `Monthly on day ${config.day_of_month} at ${config.time_of_day}${tz}`
    case 'once': {
      const runAt = new Date(config.run_at ?? '')
      return Number.isNaN(runAt.getTime()) ? 'Once (no date set)' : `Once at ${runAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
    }
  }
}

/**
 * Whether the schedule is due: the latest occurrence at/before `now` exists and
 * is newer than `lastFiredAt`. Returns the occurrence to record as fired.
 */
export function getDueOccurrence(config: ScheduleConfig, now: Date, lastFiredAt: string | null | undefined): Date | null {
  const previous = getPreviousOccurrence(config, now)
  if (!previous) return null
  if (lastFiredAt) {
    const lastFired = new Date(lastFiredAt)
    if (!Number.isNaN(lastFired.getTime()) && lastFired.getTime() >= previous.getTime()) return null
  }
  return previous
}
