# Dates & business calendar (`ut_dates`)

Date and business-calendar logic for UserTasks workflows: business days around weekends and holidays, SLA due times in working hours (time zone and DST aware), durations and ages, time zone conversion, recurring schedules and fiscal periods.

Official UserTasks workflow action, version 1.0.0. Source: `src/action.ts`; built module: `dist/action.js` (one self-contained ES module that runs in the UserTasks QuickJS sandbox).

## Operations

### Add business days (`add_business_days`)

Add (or with a negative number, subtract) business days to a date, skipping weekends and holidays. Adding 0 returns the date itself, or the next business day when it falls on a weekend or holiday.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `date` | date | yes |  | The starting date (YYYY-MM-DD). |
| `days` | integer | yes |  | How many business days to add; negative to go back. |
| `weekend_days` | list of strings | no | `["Saturday","Sunday"]` | Days that are not business days (names such as Saturday, or ISO numbers 1 = Monday … 7 = Sunday). |
| `holidays` | list of strings | no |  | Dates that are not business days, as YYYY-MM-DD (a list, or one per line). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `date` | date | The resulting business day. |
| `weekday` | string | Monday … Sunday. |
| `calendar_days` | integer | Calendar days between the start and the result (negative when going back). |

### SLA due time (`sla_due`)

The moment a number of working hours after a start time runs out, counting only working hours on working days in a time zone and skipping holidays. Daylight-saving changes are handled: working hours are wall-clock times.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `start` | datetime | yes |  | When the clock starts (ISO 8601). Without Z or an offset it is local time in Time zone. |
| `hours` | number | yes |  | The SLA in working hours (decimals allowed, e.g. 0.5). |
| `working_hours` | string | no | `"09:00-17:00"` | Start and end of the working day, e.g. 09:00-17:00 (use 00:00-24:00 for round the clock). |
| `working_days` | list of strings | no | `["Monday","Tuesday","Wednesday","Thursday","Friday"]` | Weekdays that have working hours (names or ISO numbers 1–7). |
| `time_zone` | string | no | `"UTC"` | IANA time zone of the working hours and holidays. |
| `holidays` | list of strings | no |  | Dates that are not business days, as YYYY-MM-DD (a list, or one per line). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `due` | datetime | The due moment as an ISO 8601 UTC instant. |
| `due_local` | string | The due moment in the time zone, with its offset, e.g. 2026-11-09T14:30:00+13:00. |
| `due_date` | date |  |
| `start_local` | string | The start in the time zone, with its offset. |
| `calendar_hours` | number | Elapsed real time from start to due, in hours. |

### Duration / age (`duration`)

The time between two dates or date-times: calendar days, business days, hours and minutes, a readable text and the age in years, months and days. Negative when To is before From.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `from` | datetime | yes |  | Date (YYYY-MM-DD) or date-time. |
| `to` | datetime | no |  | Date or date-time; empty for now. |
| `time_zone` | string | no | `"UTC"` | Time zone for dates and times without an offset, and for counting calendar days. |
| `weekend_days` | list of strings | no | `["Saturday","Sunday"]` | Days that are not business days (names such as Saturday, or ISO numbers 1 = Monday … 7 = Sunday). |
| `holidays` | list of strings | no |  | Dates that are not business days, as YYYY-MM-DD (a list, or one per line). |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `days` | integer | Whole calendar days. |
| `business_days` | integer | Business days after From up to and including To. |
| `hours` | number | Elapsed hours (2 decimals). |
| `minutes` | integer | Elapsed whole minutes. |
| `human` | string | For example "36 years, 3 months, 17 days" or "2 hours, 15 minutes". |
| `age_years` | integer | Whole years (age). |
| `age_months` | integer | Months after the whole years. |
| `age_days` | integer | Days after the whole months. |

### Convert time zone (`convert_timezone`)

Show a moment in another time zone: the UTC instant, the local date-time with its offset, date, time and weekday.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `datetime` | datetime | yes |  | ISO 8601. Without Z or an offset it is read in From zone. |
| `from_zone` | string | no | `"UTC"` | IANA time zone of a date-time without an offset. |
| `to_zone` | string | yes |  | IANA time zone to show the moment in. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `iso` | datetime |  |
| `local` | string | With its offset, e.g. 2026-11-03T03:00:00+13:00. |
| `local_date` | date |  |
| `local_time` | string | HH:mm. |
| `weekday` | string |  |
| `offset` | string | For example +13:00. |
| `offset_minutes` | integer |  |

### Next occurrences (`next_occurrence`)

The next dates of a recurring schedule: daily, weekly on chosen days, monthly on a day of the month or the nth weekday (e.g. last Friday), or yearly, every N periods, at a time of day in a time zone.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `frequency` | choice: `daily`, `weekly`, `monthly`, `yearly` | no | `"weekly"` | How often it repeats. |
| `interval` | integer | no | `1` | Repeat every N days / weeks / months / years. |
| `days_of_week` | list of strings | no |  | Weekly: the days (names or ISO numbers); default the weekday of Start. |
| `day_of_month` | integer | no |  | Monthly / yearly: 1–31 (later than the month has = its last day) or -1 for the last day; default the day of Start. |
| `nth_week` | choice: `none`, `first`, `second`, `third`, `fourth`, `last` | no | `"none"` | Monthly / yearly: instead of a day of the month, the first … fourth or last Weekday. |
| `weekday` | string | no |  | With Nth weekday: Monday … Sunday. |
| `month` | integer | no |  | Yearly: 1–12; default the month of Start. |
| `time` | string | no | `"09:00"` | Local time of each occurrence (HH:mm). |
| `time_zone` | string | no | `"UTC"` | IANA time zone of the schedule. |
| `after` | datetime | no |  | List occurrences after this moment; empty for now. |
| `start` | date | no |  | First possible date of the schedule (the anchor for Every N); default the date of After. |
| `count` | integer | no | `5` | Number of occurrences to return (1–100). |
| `exclude_dates` | list of strings | no |  | Dates (YYYY-MM-DD) to leave out, e.g. holidays. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `next` | datetime | The next occurrence (UTC instant); empty when none was found. |
| `next_local` | string | With its offset. |
| `occurrences` | list of datetimes | UTC instants, in order. |
| `occurrences_local` | list of strings | Local date-times with offsets. |

### Fiscal period (`fiscal_period`)

The fiscal year, quarter and period (month) of a date for a fiscal year starting in any month, with the start and end dates of the period, quarter and year and a label such as FY2027 Q2.

**Inputs**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `date` | date | no |  | The date; empty for today (in Time zone). |
| `start_month` | integer | no | `7` | 1 = January … 12 = December, e.g. 7 for July (Australia, NZ public sector), 4 for April (UK, India, Japan, Canada). |
| `year_naming` | choice: `end`, `start` | no | `"end"` | The calendar year in which the fiscal year ends (FY2027 = July 2026–June 2027) or starts. |
| `time_zone` | string | no | `"UTC"` | For "today" when Date is empty. |

**Outputs**

| Name | Type | Description |
| --- | --- | --- |
| `fiscal_year` | integer |  |
| `quarter` | integer | 1–4. |
| `period` | integer | Month of the fiscal year, 1–12. |
| `label` | string | For example FY2027 Q2. |
| `period_label` | string | For example FY2027 P05. |
| `period_start` | date |  |
| `period_end` | date |  |
| `quarter_start` | date |  |
| `quarter_end` | date |  |
| `year_start` | date |  |
| `year_end` | date |  |
| `day_of_year` | integer | 1 on the first day. |

## Capabilities

None: pure computation. Time zone rules come from the host's ctx.intl helpers (IANA time zone database); the action cannot reach the network, data tables, files or secrets.

## Examples

**8 working hours from Friday afternoon** (`sla_due`)

```json
{
  "start": "2026-11-06T15:30:00",
  "hours": 8,
  "working_hours": "09:00-17:00",
  "time_zone": "Pacific/Auckland"
}
```

1.5 hours on Friday, the rest on Monday.

**3 business days over Christmas** (`add_business_days`)

```json
{
  "date": "2026-12-23",
  "days": 3,
  "holidays": [
    "2026-12-25",
    "2026-12-28",
    "2027-01-01"
  ]
}
```

**Fiscal quarter (year from July)** (`fiscal_period`)

```json
{
  "date": "2026-11-01",
  "start_month": 7
}
```

**Last Friday of the month at 16:00 London** (`next_occurrence`)

```json
{
  "frequency": "monthly",
  "nth_week": "last",
  "weekday": "Friday",
  "time": "16:00",
  "time_zone": "Europe/London",
  "after": "2026-11-01T00:00:00Z",
  "count": 3
}
```

**Age on a date** (`duration`)

```json
{
  "from": "1990-07-15",
  "to": "2026-11-01"
}
```

A sample workflow ships in `assets/workflows/`: it starts from the API or its start form, runs this action with default inputs and shows the outputs.

## Limits

- Each run has 5 seconds and 32 MB of sandbox memory; inputs and outputs are limited to 5 MB of JSON each.
- Time zones are IANA names; an unknown zone is an error. Date-times without Z or an offset are read as wall-clock time in the operation's time zone.
- Business days and SLA searches look at most 10 years ahead; schedules look up to 200 years ahead and return at most 100 occurrences.
- Monthly schedules on day 29–31 fall on the last day of shorter months. Ages count a month from the same day of the month (Jan 31 + 1 month = Feb 28/29).

## Build and test

```sh
node gallery/actions/scripts/build.mjs date-business-calendar
npx vitest run __tests__/gallery-action-date-business-calendar.test.ts
```

## Licence

Apache-2.0. Copyright UserTasks.
