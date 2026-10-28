import { describe, expect, it } from 'vitest'
import {
  normalizeScheduleConfig,
  getPreviousOccurrence,
  getNextOccurrence,
  getDueOccurrence,
  describeSchedule,
  type ScheduleConfig,
} from '@/lib/workflow-schedule'

const at = (iso: string) => new Date(iso)

describe('normalizeScheduleConfig', () => {
  it('accepts a valid every_minutes config', () => {
    expect(normalizeScheduleConfig({ schedule_mode: 'every_minutes', interval_minutes: 15 }))
      .toEqual({ schedule_mode: 'every_minutes', interval_minutes: 15, timezone: 'UTC' })
  })
  it('rejects missing/invalid mode and bad fields', () => {
    expect(normalizeScheduleConfig({})).toBeNull()
    expect(normalizeScheduleConfig({ schedule_mode: 'every_minutes', interval_minutes: 0 })).toBeNull()
    expect(normalizeScheduleConfig({ schedule_mode: 'hourly', minute_of_hour: 75 })).toBeNull()
    expect(normalizeScheduleConfig({ schedule_mode: 'daily', time_of_day: '25:00' })).toBeNull()
    expect(normalizeScheduleConfig({ schedule_mode: 'weekly', time_of_day: '09:00', day_of_week: 9 })).toBeNull()
    expect(normalizeScheduleConfig({ schedule_mode: 'once', run_at: 'garbage' })).toBeNull()
  })
})

describe('getPreviousOccurrence', () => {
  it('every_minutes floors to the interval grid', () => {
    const config: ScheduleConfig = { schedule_mode: 'every_minutes', interval_minutes: 15, timezone: 'UTC' }
    expect(getPreviousOccurrence(config, at('2026-07-08T10:37:12Z'))?.toISOString()).toBe('2026-07-08T10:30:00.000Z')
  })

  it('hourly picks this hour when past the minute, previous hour when before it', () => {
    const config: ScheduleConfig = { schedule_mode: 'hourly', minute_of_hour: 30, timezone: 'UTC' }
    expect(getPreviousOccurrence(config, at('2026-07-08T10:45:00Z'))?.toISOString()).toBe('2026-07-08T10:30:00.000Z')
    expect(getPreviousOccurrence(config, at('2026-07-08T10:15:00Z'))?.toISOString()).toBe('2026-07-08T09:30:00.000Z')
  })

  it('daily respects the timezone wall clock', () => {
    // 09:00 in Auckland (UTC+12 in July) = 21:00 UTC the previous day
    const config: ScheduleConfig = { schedule_mode: 'daily', time_of_day: '09:00', timezone: 'Pacific/Auckland' }
    expect(getPreviousOccurrence(config, at('2026-07-08T22:00:00Z'))?.toISOString()).toBe('2026-07-08T21:00:00.000Z')
    expect(getPreviousOccurrence(config, at('2026-07-08T20:00:00Z'))?.toISOString()).toBe('2026-07-07T21:00:00.000Z')
  })

  it('weekly lands on the requested weekday', () => {
    // 2026-07-08 is a Wednesday; Monday=1 → most recent Monday is 2026-07-06
    const config: ScheduleConfig = { schedule_mode: 'weekly', day_of_week: 1, time_of_day: '09:00', timezone: 'UTC' }
    expect(getPreviousOccurrence(config, at('2026-07-08T12:00:00Z'))?.toISOString()).toBe('2026-07-06T09:00:00.000Z')
  })

  it('monthly clamps day 31 to shorter months', () => {
    const config: ScheduleConfig = { schedule_mode: 'monthly', day_of_month: 31, time_of_day: '09:00', timezone: 'UTC' }
    // In June (30 days) the occurrence clamps to June 30
    expect(getPreviousOccurrence(config, at('2026-07-08T00:00:00Z'))?.toISOString()).toBe('2026-06-30T09:00:00.000Z')
  })

  it('once returns the instant only after it passes', () => {
    const config: ScheduleConfig = { schedule_mode: 'once', run_at: '2026-07-10T09:00:00.000Z', timezone: 'UTC' }
    expect(getPreviousOccurrence(config, at('2026-07-09T00:00:00Z'))).toBeNull()
    expect(getPreviousOccurrence(config, at('2026-07-10T10:00:00Z'))?.toISOString()).toBe('2026-07-10T09:00:00.000Z')
  })
})

describe('getNextOccurrence', () => {
  it('returns the upcoming slot for interval and daily modes', () => {
    expect(getNextOccurrence({ schedule_mode: 'every_minutes', interval_minutes: 15, timezone: 'UTC' }, at('2026-07-08T10:37:00Z'))?.toISOString())
      .toBe('2026-07-08T10:45:00.000Z')
    expect(getNextOccurrence({ schedule_mode: 'daily', time_of_day: '09:00', timezone: 'UTC' }, at('2026-07-08T10:00:00Z'))?.toISOString())
      .toBe('2026-07-09T09:00:00.000Z')
  })
  it('returns null for a passed one-off', () => {
    expect(getNextOccurrence({ schedule_mode: 'once', run_at: '2026-07-01T00:00:00Z', timezone: 'UTC' }, at('2026-07-08T00:00:00Z'))).toBeNull()
  })
})

describe('getDueOccurrence', () => {
  const config: ScheduleConfig = { schedule_mode: 'hourly', minute_of_hour: 0, timezone: 'UTC' }
  it('fires when never fired before', () => {
    expect(getDueOccurrence(config, at('2026-07-08T10:30:00Z'), null)?.toISOString()).toBe('2026-07-08T10:00:00.000Z')
  })
  it('does not double-fire within the same slot', () => {
    expect(getDueOccurrence(config, at('2026-07-08T10:30:00Z'), '2026-07-08T10:00:00.000Z')).toBeNull()
  })
  it('fires again once the next slot passes', () => {
    expect(getDueOccurrence(config, at('2026-07-08T11:05:00Z'), '2026-07-08T10:00:00.000Z')?.toISOString()).toBe('2026-07-08T11:00:00.000Z')
  })
  it('one-off fires exactly once', () => {
    const once: ScheduleConfig = { schedule_mode: 'once', run_at: '2026-07-08T09:00:00.000Z', timezone: 'UTC' }
    expect(getDueOccurrence(once, at('2026-07-08T10:00:00Z'), null)?.toISOString()).toBe('2026-07-08T09:00:00.000Z')
    expect(getDueOccurrence(once, at('2026-07-09T10:00:00Z'), '2026-07-08T09:00:00.000Z')).toBeNull()
  })
})

describe('describeSchedule', () => {
  it('describes each mode', () => {
    expect(describeSchedule({ schedule_mode: 'every_minutes', interval_minutes: 5, timezone: 'UTC' })).toBe('Every 5 minutes')
    expect(describeSchedule({ schedule_mode: 'hourly', minute_of_hour: 5, timezone: 'UTC' })).toBe('Hourly at :05')
    expect(describeSchedule({ schedule_mode: 'daily', time_of_day: '09:00', timezone: 'Pacific/Auckland' })).toBe('Daily at 09:00 (Pacific/Auckland)')
    expect(describeSchedule({ schedule_mode: 'weekly', day_of_week: 1, time_of_day: '09:00', timezone: 'UTC' })).toBe('Weekly on Monday at 09:00 (UTC)')
    expect(describeSchedule(null)).toBe('Not configured')
  })
})
