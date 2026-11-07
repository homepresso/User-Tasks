/**
 * Official action ut_dates (gallery/actions/date-business-calendar): contract
 * checks and every operation run in the QuickJS sandbox from the built module
 * (business days, DST-crossing SLAs, holidays, fiscal years from July and April).
 */
import { describe, expect, it } from 'vitest'
import { contractSuite, fails, ok } from '../gallery/actions/scripts/test-kit'

const action = contractSuite('date-business-calendar', {
  key: 'ut_dates',
  operations: ['add_business_days', 'sla_due', 'duration', 'convert_timezone', 'next_occurrence', 'fiscal_period'],
  capabilities: [],
})

const XMAS = ['2026-12-25', '2026-12-28', '2027-01-01']

describe('ut_dates add_business_days', () => {
  it('skips weekends and holidays', async () => {
    expect(await ok(action, 'add_business_days', { date: '2026-12-23', days: 3, holidays: XMAS })).toEqual({ date: '2026-12-30', weekday: 'Wednesday', calendar_days: 7 })
    expect((await ok(action, 'add_business_days', { date: '2026-11-06', days: 1 })).date).toBe('2026-11-09')
    expect((await ok(action, 'add_business_days', { date: '2026-11-02', days: 10 })).date).toBe('2026-11-16')
  })

  it('goes backwards with negative days', async () => {
    expect(await ok(action, 'add_business_days', { date: '2026-12-30', days: -3, holidays: XMAS })).toEqual({ date: '2026-12-23', weekday: 'Wednesday', calendar_days: -7 })
    expect((await ok(action, 'add_business_days', { date: '2026-11-09', days: -1 })).date).toBe('2026-11-06')
  })

  it('rolls 0 days forward to a business day', async () => {
    expect((await ok(action, 'add_business_days', { date: '2026-12-26', days: 0, holidays: XMAS })).date).toBe('2026-12-29')
    expect((await ok(action, 'add_business_days', { date: '2026-12-29', days: 0 })).date).toBe('2026-12-29')
  })

  it('supports other weekends and holiday lists as text or objects', async () => {
    expect((await ok(action, 'add_business_days', { date: '2026-11-05', days: 1, weekend_days: ['Friday', 'Saturday'] })).date).toBe('2026-11-08')
    expect((await ok(action, 'add_business_days', { date: '2026-11-05', days: 1, weekend_days: '5, 6' })).date).toBe('2026-11-08')
    expect((await ok(action, 'add_business_days', { date: '2026-12-24', days: 1, holidays: '2026-12-25\n2026-12-28' })).date).toBe('2026-12-29')
    expect((await ok(action, 'add_business_days', { date: '2026-12-24', days: 1, holidays: [{ date: '2026-12-25', name: 'Christmas' }, { date: '2026-12-28' }] })).date).toBe('2026-12-29')
  })

  it('rejects bad input', async () => {
    await fails(action, 'add_business_days', { date: '2026-02-30', days: 1 }, /not a real date/)
    await fails(action, 'add_business_days', { date: '2026-11-02', days: 1.5 }, /whole number/)
    await fails(action, 'add_business_days', { date: '2026-11-02', days: 1, weekend_days: ['Funday'] }, /not a weekday/)
    await fails(action, 'add_business_days', { date: '2026-11-02', days: 1, holidays: ['25/12/2026'] }, /holidays\[0\] must be a date/)
    await fails(action, 'add_business_days', { date: '2026-11-02', days: 1, weekend_days: [1, 2, 3, 4, 5, 6, 7] }, /every day/)
  })
})

describe('ut_dates sla_due', () => {
  it('counts working hours over a weekend (local start, Pacific/Auckland)', async () => {
    const out = await ok(action, 'sla_due', { start: '2026-11-06T15:30:00', hours: 8, time_zone: 'Pacific/Auckland' })
    expect(out).toEqual({
      due: '2026-11-09T02:30:00.000Z',
      due_local: '2026-11-09T15:30:00+13:00',
      due_date: '2026-11-09',
      start_local: '2026-11-06T15:30:00+13:00',
      calendar_hours: 72,
    })
    // The same start as a UTC instant.
    expect((await ok(action, 'sla_due', { start: '2026-11-06T02:30:00Z', hours: 8, time_zone: 'Pacific/Auckland' })).due).toBe('2026-11-09T02:30:00.000Z')
  })

  it('crosses a daylight-saving change (NZ spring forward)', async () => {
    const out = await ok(action, 'sla_due', { start: '2026-09-25T16:00:00', hours: 4, time_zone: 'Pacific/Auckland' })
    expect(out.start_local).toBe('2026-09-25T16:00:00+12:00')
    expect(out.due_local).toBe('2026-09-28T12:00:00+13:00')
    expect(out.due).toBe('2026-09-27T23:00:00.000Z')
    expect(out.calendar_hours).toBe(67)
  })

  it('crosses a daylight-saving change (US spring forward)', async () => {
    const out = await ok(action, 'sla_due', { start: '2026-03-06T16:00:00', hours: 2, time_zone: 'America/New_York' })
    expect(out.due_local).toBe('2026-03-09T10:00:00-04:00')
    expect(out.due).toBe('2026-03-09T14:00:00.000Z')
    expect(out.calendar_hours).toBe(65)
  })

  it('skips holidays, starts at opening time and ends exactly at closing time', async () => {
    expect((await ok(action, 'sla_due', { start: '2026-12-24T16:00:00', hours: 2, time_zone: 'Pacific/Auckland', holidays: XMAS })).due_local).toBe('2026-12-29T10:00:00+13:00')
    expect((await ok(action, 'sla_due', { start: '2026-11-09T07:00:00', hours: 0.5 })).due).toBe('2026-11-09T09:30:00.000Z')
    expect((await ok(action, 'sla_due', { start: '2026-11-06T09:00:00', hours: 8 })).due).toBe('2026-11-06T17:00:00.000Z')
    expect((await ok(action, 'sla_due', { start: '2026-11-06T17:30:00', hours: 1, working_hours: '08:30-17:00' })).due).toBe('2026-11-09T09:30:00.000Z')
  })

  it('supports round-the-clock and custom working days', async () => {
    const all = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    expect((await ok(action, 'sla_due', { start: '2026-11-06T23:30:00Z', hours: 1, working_hours: '00:00-24:00', working_days: all })).due).toBe('2026-11-07T00:30:00.000Z')
    expect((await ok(action, 'sla_due', { start: '2026-11-07T10:00:00Z', hours: 1, working_days: ['Saturday'] })).due).toBe('2026-11-07T11:00:00.000Z')
  })

  it('rejects bad input', async () => {
    await fails(action, 'sla_due', { start: '2026-11-06T09:00:00', hours: 1, time_zone: 'Mars/Olympus' }, /Unknown time zone/)
    await fails(action, 'sla_due', { start: '2026-11-06T09:00:00', hours: 1, working_hours: '17:00-09:00' }, /start time before an end time/)
    await fails(action, 'sla_due', { start: '2026-11-06T09:00:00', hours: 1, working_hours: 'nine to five' }, /09:00-17:00/)
    await fails(action, 'sla_due', { start: 'next tuesday', hours: 1 }, /Start must be a date|start must be a date/)
    await fails(action, 'sla_due', { start: '2026-11-06T09:00:00', hours: -1 }, /at least 0/)
  })
})

describe('ut_dates duration', () => {
  it('computes an age and business days', async () => {
    const out = await ok(action, 'duration', { from: '1990-07-15', to: '2026-11-01' })
    expect(out.age_years).toBe(36)
    expect(out.age_months).toBe(3)
    expect(out.age_days).toBe(17)
    expect(out.human).toBe('36 years, 3 months, 17 days')
    expect(out.days).toBe((Date.UTC(2026, 10, 1) - Date.UTC(1990, 6, 15)) / 86_400_000)
    let business = 0
    for (let t = Date.UTC(1990, 6, 16); t <= Date.UTC(2026, 10, 1); t += 86_400_000) {
      const dow = new Date(t).getUTCDay()
      if (dow !== 0 && dow !== 6) business++
    }
    expect(out.business_days).toBe(business)
    expect(out.hours).toBe(out.days * 24)
  })

  it('handles month ends, times and negative spans', async () => {
    expect(await ok(action, 'duration', { from: '2027-01-31', to: '2027-02-28' })).toMatchObject({ age_months: 1, age_days: 0, days: 28, human: '1 month' })
    expect(await ok(action, 'duration', { from: '2026-11-01T22:00:00Z', to: '2026-11-02T01:15:00Z' })).toMatchObject({ days: 0, hours: 3.25, minutes: 195, human: '3 hours, 15 minutes', business_days: 1 })
    expect(await ok(action, 'duration', { from: '2026-11-10', to: '2026-11-01' })).toMatchObject({ days: -9, business_days: -7, human: '-9 days', age_days: -9 })
    expect(await ok(action, 'duration', { from: '2026-11-02', to: '2026-11-09', holidays: ['2026-11-04'] })).toMatchObject({ days: 7, business_days: 4 })
    expect((await ok(action, 'duration', { from: '2026-11-01T10:00:00Z', to: '2026-11-01T10:00:00Z' })).human).toBe('0 minutes')
  })

  it('measures real elapsed hours across DST', async () => {
    expect(await ok(action, 'duration', { from: '2026-03-08', to: '2026-03-09', time_zone: 'America/New_York' })).toMatchObject({ days: 1, hours: 23, minutes: 1380 })
  })

  it('defaults To to now', async () => {
    const out = await ok(action, 'duration', { from: '2000-01-01' })
    expect(out.age_years).toBeGreaterThanOrEqual(26)
  })
})

describe('ut_dates convert_timezone', () => {
  it('converts local time between zones', async () => {
    expect(await ok(action, 'convert_timezone', { datetime: '2026-11-02T09:00:00', from_zone: 'America/New_York', to_zone: 'Pacific/Auckland' })).toEqual({
      iso: '2026-11-02T14:00:00.000Z',
      local: '2026-11-03T03:00:00+13:00',
      local_date: '2026-11-03',
      local_time: '03:00',
      weekday: 'Tuesday',
      offset: '+13:00',
      offset_minutes: 780,
    })
    const india = await ok(action, 'convert_timezone', { datetime: '2026-06-01T00:00:00Z', to_zone: 'Asia/Kolkata' })
    expect(india).toMatchObject({ local: '2026-06-01T05:30:00+05:30', offset: '+05:30', offset_minutes: 330 })
    expect((await ok(action, 'convert_timezone', { datetime: '2026-06-01T12:00:00-0700', to_zone: 'UTC' })).iso).toBe('2026-06-01T19:00:00.000Z')
  })

  it('rejects unknown zones', async () => {
    await fails(action, 'convert_timezone', { datetime: '2026-06-01T00:00:00Z', to_zone: 'Nowhere/Land' }, /Unknown time zone/)
  })
})

describe('ut_dates next_occurrence', () => {
  it('finds the last Friday of each month in London', async () => {
    const out = await ok(action, 'next_occurrence', { frequency: 'monthly', nth_week: 'last', weekday: 'Friday', time: '16:00', time_zone: 'Europe/London', after: '2026-11-01T00:00:00Z', count: 3 })
    expect(out.occurrences).toEqual(['2026-11-27T16:00:00.000Z', '2026-12-25T16:00:00.000Z', '2027-01-29T16:00:00.000Z'])
    expect(out.next).toBe('2026-11-27T16:00:00.000Z')
    expect(out.next_local).toBe('2026-11-27T16:00:00+00:00')
  })

  it('handles weekly days with an interval and skipped dates', async () => {
    const base = { frequency: 'weekly', interval: 2, days_of_week: ['Monday', 'Thursday'], start: '2026-11-02', after: '2026-11-01T00:00:00Z', count: 4 }
    expect((await ok(action, 'next_occurrence', base)).occurrences).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-05T09:00:00.000Z', '2026-11-16T09:00:00.000Z', '2026-11-19T09:00:00.000Z'])
    expect((await ok(action, 'next_occurrence', { ...base, count: 2, exclude_dates: ['2026-11-05'] })).occurrences).toEqual(['2026-11-02T09:00:00.000Z', '2026-11-16T09:00:00.000Z'])
  })

  it('handles daily intervals, month ends, leap years and the second Tuesday', async () => {
    expect((await ok(action, 'next_occurrence', { frequency: 'daily', interval: 3, start: '2026-11-01', after: '2026-11-01T10:00:00Z', count: 3 })).occurrences)
      .toEqual(['2026-11-04T09:00:00.000Z', '2026-11-07T09:00:00.000Z', '2026-11-10T09:00:00.000Z'])
    expect((await ok(action, 'next_occurrence', { frequency: 'monthly', day_of_month: 31, start: '2027-01-01', after: '2027-01-01T00:00:00Z', count: 3, time: '00:00' })).occurrences)
      .toEqual(['2027-01-31T00:00:00.000Z', '2027-02-28T00:00:00.000Z', '2027-03-31T00:00:00.000Z'])
    expect((await ok(action, 'next_occurrence', { frequency: 'yearly', month: 2, day_of_month: 29, start: '2027-01-01', after: '2027-01-01T00:00:00Z', count: 2, time: '12:00' })).occurrences)
      .toEqual(['2027-02-28T12:00:00.000Z', '2028-02-29T12:00:00.000Z'])
    expect((await ok(action, 'next_occurrence', { frequency: 'monthly', nth_week: 'second', weekday: 'Tue', after: '2026-11-01T00:00:00Z', count: 2, time: '10:00', time_zone: 'Pacific/Auckland' })).occurrences_local)
      .toEqual(['2026-11-10T10:00:00+13:00', '2026-12-08T10:00:00+13:00'])
  })

  it('keeps the local time across DST', async () => {
    const out = await ok(action, 'next_occurrence', { frequency: 'daily', start: '2026-03-07', after: '2026-03-07T00:00:00Z', count: 3, time: '09:00', time_zone: 'America/New_York' })
    expect(out.occurrences).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z'])
  })

  it('rejects bad schedules', async () => {
    await fails(action, 'next_occurrence', { frequency: 'monthly', nth_week: 'last' }, /Weekday is required|weekday is required/)
    await fails(action, 'next_occurrence', { frequency: 'monthly', day_of_month: 0 }, /day_of_month/)
    await fails(action, 'next_occurrence', { frequency: 'daily', time: '25:00' }, /time must be a time/)
    await fails(action, 'next_occurrence', { frequency: 'hourly' }, /must be one of/)
  })
})

describe('ut_dates fiscal_period', () => {
  it('fiscal year starting in July', async () => {
    expect(await ok(action, 'fiscal_period', { date: '2026-11-01', start_month: 7 })).toEqual({
      fiscal_year: 2027, quarter: 2, period: 5, label: 'FY2027 Q2', period_label: 'FY2027 P05',
      period_start: '2026-11-01', period_end: '2026-11-30', quarter_start: '2026-10-01', quarter_end: '2026-12-31',
      year_start: '2026-07-01', year_end: '2027-06-30', day_of_year: 124,
    })
    expect(await ok(action, 'fiscal_period', { date: '2027-06-30', start_month: 7 })).toMatchObject({ fiscal_year: 2027, quarter: 4, period: 12, day_of_year: 365 })
    expect(await ok(action, 'fiscal_period', { date: '2026-07-01', start_month: 7, year_naming: 'start' })).toMatchObject({ fiscal_year: 2026, quarter: 1, period: 1, label: 'FY2026 Q1', day_of_year: 1 })
  })

  it('fiscal year starting in April', async () => {
    expect(await ok(action, 'fiscal_period', { date: '2027-03-15', start_month: 4 })).toMatchObject({
      fiscal_year: 2027, quarter: 4, period: 12, label: 'FY2027 Q4', period_start: '2027-03-01', period_end: '2027-03-31',
      quarter_start: '2027-01-01', quarter_end: '2027-03-31', year_start: '2026-04-01', year_end: '2027-03-31',
    })
    expect(await ok(action, 'fiscal_period', { date: '2028-02-29', start_month: 4 })).toMatchObject({ fiscal_year: 2028, period: 11, period_end: '2028-02-29' })
    expect(await ok(action, 'fiscal_period', { date: '2026-04-01', start_month: 4, year_naming: 'start' })).toMatchObject({ fiscal_year: 2026, label: 'FY2026 Q1' })
  })

  it('calendar fiscal years and today', async () => {
    expect(await ok(action, 'fiscal_period', { date: '2026-05-20', start_month: 1 })).toMatchObject({ fiscal_year: 2026, quarter: 2, period: 5, label: 'FY2026 Q2', year_end: '2026-12-31' })
    const today = await ok(action, 'fiscal_period', {})
    expect(today.label).toMatch(/^FY\d{4} Q[1-4]$/)
    await fails(action, 'fiscal_period', { date: '2026-11-01', start_month: 13 }, /at most 12/)
  })
})
