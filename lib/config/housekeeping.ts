/**
 * Instance housekeeping settings (`housekeeping.<option>` instance settings,
 * migration 20261109500000_instance_housekeeping.sql).
 *
 * Housekeeping purges the system tables that grow without bound — pg_cron's
 * run history, pg_net's responses, expired cache-store and built-in auth
 * rows — on by default. The purge itself is SQL (app_cron.run_housekeeping),
 * run by pg_cron or by the job registry, and it reads these rows directly;
 * this module is the same rules on the app side (validation for the admin
 * CLI and Settings → Infrastructure, defaults for display). Keep the two in
 * step. There are no environment overrides: the database-side purge cannot
 * see the app's environment.
 */

export const HOUSEKEEPING_PREFIX = 'housekeeping.'

export const HOUSEKEEPING_INTERVALS = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1440] as const

export type HousekeepingOption = 'enabled' | 'interval_minutes' | 'cron_history_hours' | 'http_response_minutes'

export interface HousekeepingSettings {
  enabled: boolean
  /** How often the scheduled pass runs. */
  interval_minutes: number
  /** cron.job_run_details rows older than this are deleted. */
  cron_history_hours: number
  /** net._http_response rows older than this are deleted. */
  http_response_minutes: number
}

interface IntegerSpec {
  kind: 'integer'
  label: string
  /** Unit of the stored number. */
  unit: 'minutes' | 'hours'
  default: number
  min: number
  max: number
  choices?: readonly number[]
  help: string
}

interface BooleanSpec {
  kind: 'boolean'
  label: string
  default: boolean
  help: string
}

export const HOUSEKEEPING_SPECS: { enabled: BooleanSpec } & Record<Exclude<HousekeepingOption, 'enabled'>, IntegerSpec> = {
  enabled: {
    kind: 'boolean',
    label: 'Scheduled housekeeping',
    default: true,
    help: 'Off stops the scheduled passes; an operator can still run one.',
  },
  interval_minutes: {
    kind: 'integer',
    label: 'Run every',
    unit: 'minutes',
    default: 60,
    min: 15,
    max: 1440,
    choices: HOUSEKEEPING_INTERVALS,
    help: 'How often the scheduled pass runs (a daily pass with a larger budget runs at 03:30 UTC as well).',
  },
  cron_history_hours: {
    kind: 'integer',
    label: 'Keep scheduler run history',
    unit: 'hours',
    default: 24,
    min: 1,
    max: 90 * 24,
    help: 'pg_cron run history (cron.job_run_details) older than this is deleted. 1 hour to 90 days.',
  },
  http_response_minutes: {
    kind: 'integer',
    label: 'Keep pg_net responses',
    unit: 'minutes',
    default: 60,
    min: 5,
    max: 7 * 24 * 60,
    help: 'Responses to the database\'s HTTP calls (net._http_response) older than this are deleted. 5 minutes to 7 days.',
  },
}

export const HOUSEKEEPING_OPTIONS = Object.keys(HOUSEKEEPING_SPECS) as HousekeepingOption[]

export const HOUSEKEEPING_DEFAULTS: HousekeepingSettings = {
  enabled: true,
  interval_minutes: 60,
  cron_history_hours: 24,
  http_response_minutes: 60,
}

/** Doctor / status thresholds for cron.job_run_details. */
export const CRON_HISTORY_WARN_BYTES = 50 * 1024 * 1024
export const CRON_HISTORY_WARN_ROWS = 100_000
/** A table this big whose pages hold this many bytes per live row is mostly dead space. */
export const BLOAT_MIN_BYTES = 16 * 1024 * 1024
export const BLOAT_BYTES_PER_ROW = 4096

export class HousekeepingSettingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HousekeepingSettingError'
  }
}

/** `enabled`, `housekeeping.enabled` → `enabled`; null when not a housekeeping option. */
export function housekeepingOption(key: string): HousekeepingOption | null {
  const option = key.startsWith(HOUSEKEEPING_PREFIX) ? key.slice(HOUSEKEEPING_PREFIX.length) : key
  return (HOUSEKEEPING_OPTIONS as string[]).includes(option) ? (option as HousekeepingOption) : null
}

export function housekeepingKey(option: HousekeepingOption): string {
  return `${HOUSEKEEPING_PREFIX}${option}`
}

const UNIT_MINUTES: Record<string, number> = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440 }

/**
 * A duration in `unit`: a bare number is already in that unit; `90m`, `12h`,
 * `1d`, `2 days` are converted. Must come out a whole number.
 */
export function parseDuration(raw: string | number, unit: 'minutes' | 'hours'): number {
  if (typeof raw === 'number') return raw
  const text = raw.trim().toLowerCase()
  if (/^\d+$/.test(text)) return Number(text)
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(text)
  const factor = match ? UNIT_MINUTES[match[2]] : undefined
  if (!match || factor === undefined) throw new HousekeepingSettingError(`"${raw}" is not a duration (e.g. 30m, 12h, 1d)`)
  const minutes = Number(match[1]) * factor
  return unit === 'minutes' ? minutes : minutes / 60
}

function describeAmount(value: number, unit: 'minutes' | 'hours'): string {
  const minutes = unit === 'hours' ? value * 60 : value
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** Human form of an option's value ("1 day", "every 60 minutes", "on"). */
export function describeHousekeepingValue(option: HousekeepingOption, value: unknown): string {
  const spec = HOUSEKEEPING_SPECS[option]
  if (spec.kind === 'boolean') return value ? 'on' : 'off'
  return describeAmount(Number(value), spec.unit)
}

/**
 * Validates (and normalises) a value for `housekeeping.<option>`. Accepts
 * what an operator types (`true`, `off`, `12h`, `"60"`) as well as JSON
 * values. Throws HousekeepingSettingError naming the allowed range.
 */
export function parseHousekeepingValue(option: HousekeepingOption, raw: unknown): boolean | number {
  const spec = HOUSEKEEPING_SPECS[option]
  if (spec.kind === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const text = String(raw ?? '').trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(text)) return true
    if (['false', '0', 'no', 'off'].includes(text)) return false
    throw new HousekeepingSettingError(`${housekeepingKey(option)} must be true or false`)
  }
  if (typeof raw !== 'number' && typeof raw !== 'string') throw new HousekeepingSettingError(`${housekeepingKey(option)} must be a number of ${spec.unit}`)
  const value = parseDuration(raw, spec.unit)
  if (spec.choices) {
    if (!spec.choices.includes(value)) throw new HousekeepingSettingError(`${housekeepingKey(option)} must be one of ${spec.choices.join(', ')} (${spec.unit})`)
    return value
  }
  if (!Number.isInteger(value)) throw new HousekeepingSettingError(`${housekeepingKey(option)} must be a whole number of ${spec.unit}`)
  if (value < spec.min || value > spec.max) {
    throw new HousekeepingSettingError(`${housekeepingKey(option)} must be from ${describeAmount(spec.min, spec.unit)} to ${describeAmount(spec.max, spec.unit)}`)
  }
  return value
}

/** Validation hook for instance_settings writes: housekeeping keys must be known options with valid values. */
export function validateHousekeepingSetting(key: string, value: unknown): void {
  if (!key.startsWith(HOUSEKEEPING_PREFIX)) return
  const option = housekeepingOption(key)
  if (!option) throw new HousekeepingSettingError(`Unknown housekeeping setting "${key}" (options: ${HOUSEKEEPING_OPTIONS.join(', ')})`)
  const parsed = parseHousekeepingValue(option, value)
  if (parsed !== value) throw new HousekeepingSettingError(`${key}: store ${JSON.stringify(parsed)}, not ${JSON.stringify(value)}`)
}

/**
 * Effective settings from stored rows, as app_cron.housekeeping_settings()
 * computes them: a missing or invalid value is the default.
 */
export function resolveHousekeepingSettings(settings: Map<string, unknown>): HousekeepingSettings {
  const out = { ...HOUSEKEEPING_DEFAULTS }
  for (const option of HOUSEKEEPING_OPTIONS) {
    const raw = settings.get(housekeepingKey(option))
    if (raw === undefined || raw === null) continue
    try {
      ;(out as Record<string, unknown>)[option] = parseHousekeepingValue(option, raw)
    } catch {
      // Invalid stored value: the default, like the SQL side.
    }
  }
  return out
}
