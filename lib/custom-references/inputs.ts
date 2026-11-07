/**
 * Custom reference inputs: typed validation of caller values, Fixed values
 * (constants or integration settings), and rendering of `{{input.x}}`
 * templates for operation parameters and filter values.
 *
 * Rules:
 *  - Only DECLARED inputs are read; anything else a caller sends is dropped.
 *  - A Fixed input never reads the caller's value (callers cannot override it).
 *  - Values are data: rendering never evaluates them, and whole-value tokens
 *    keep the input's type.
 *
 * Pure and client-safe.
 */

import { isSensitiveKey } from '@/lib/secret-keys'
import {
  CUSTOM_LIMITS,
  INPUT_TOKEN_RE,
  wholeInputToken,
  type CustomInput,
  type CustomInputType,
  type CustomReferenceConfig,
} from './types'

export class CustomReferenceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CustomReferenceError'
    this.status = status
  }
}

export const PAGING_INPUTS = { page: 'page', limit: 'limit' } as const

const isEmpty = (v: unknown) => v === undefined || v === null || v === ''

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new CustomReferenceError(`Input "${name}" must be valid JSON`)
  }
}

/** Coerce a value to an input's declared type, or throw a clear error. */
export function coerceInputValue(type: CustomInputType | string | undefined, value: unknown, name: string): unknown {
  if (isEmpty(value)) return value
  switch (type) {
    case 'number':
    case 'integer': {
      if (typeof value === 'object') throw new CustomReferenceError(`Input "${name}" must be a number`)
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(n)) throw new CustomReferenceError(`Input "${name}" must be a number`)
      if (type === 'integer' && !Number.isInteger(n)) throw new CustomReferenceError(`Input "${name}" must be a whole number`)
      return n
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      const s = String(value).trim().toLowerCase()
      if (s === 'true' || s === '1' || s === 'yes') return true
      if (s === 'false' || s === '0' || s === 'no') return false
      throw new CustomReferenceError(`Input "${name}" must be true or false`)
    }
    case 'date': {
      const s = value instanceof Date ? value.toISOString() : String(value).trim()
      if (s.length > 40 || Number.isNaN(Date.parse(s))) throw new CustomReferenceError(`Input "${name}" must be a date`)
      return s
    }
    case 'array': {
      if (Array.isArray(value)) return value.slice(0, CUSTOM_LIMITS.maxInValues)
      if (typeof value === 'string') {
        const s = value.trim()
        if (s.startsWith('[')) {
          const parsed = parseJson(s, name)
          if (!Array.isArray(parsed)) throw new CustomReferenceError(`Input "${name}" must be a list`)
          return parsed.slice(0, CUSTOM_LIMITS.maxInValues)
        }
        return s.split(',').map((part) => part.trim()).filter(Boolean).slice(0, CUSTOM_LIMITS.maxInValues)
      }
      throw new CustomReferenceError(`Input "${name}" must be a list`)
    }
    case 'object': {
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
      if (typeof value === 'string') {
        const parsed = parseJson(value.trim(), name)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      }
      throw new CustomReferenceError(`Input "${name}" must be an object`)
    }
    default: {
      const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
      if (s.length > 10000) throw new CustomReferenceError(`Input "${name}" is too long`)
      return s
    }
  }
}

export interface ResolvedCustomInputs {
  values: Record<string, unknown>
  /** Inputs whose value came from a credential (never usable in server-side filters or outputs). */
  sensitive: Set<string>
}

/**
 * Resolve every declared input. `settings` are the integration's own values
 * (connector configuration and credentials), server-side only.
 */
export function resolveCustomInputs(
  config: Pick<CustomReferenceConfig, 'inputs' | 'paging_inputs' | 'page_size' | 'max_rows'>,
  callerValues: Record<string, unknown>,
  settings: Record<string, unknown> = {},
): ResolvedCustomInputs {
  const values: Record<string, unknown> = {}
  const sensitive = new Set<string>()
  const given = callerValues ?? {}
  for (const input of config.inputs ?? []) {
    if (input.mode === 'fixed') {
      let value: unknown = input.fixed_value
      if (input.fixed_setting) {
        if (!Object.prototype.hasOwnProperty.call(settings, input.fixed_setting) || isEmpty(settings[input.fixed_setting])) {
          throw new CustomReferenceError(`Fixed input "${input.name}" uses the integration setting "${input.fixed_setting}", which is not set`)
        }
        value = settings[input.fixed_setting]
        if (isSensitiveKey(input.fixed_setting)) sensitive.add(input.name)
      }
      values[input.name] = coerceInputValue(input.type, value, input.name)
      continue
    }
    let value = Object.prototype.hasOwnProperty.call(given, input.name) ? given[input.name] : undefined
    if (isEmpty(value)) value = input.default_value
    value = coerceInputValue(input.type, value, input.name)
    if (input.required && isEmpty(value)) {
      throw new CustomReferenceError(`Required input "${input.name}" is missing. Provide a value or set a default.`)
    }
    values[input.name] = isEmpty(value) ? '' : value
  }
  if (config.paging_inputs) {
    const max = maxRowsOf(config)
    const page = coerceInputValue('integer', isEmpty(given.page) ? 1 : given.page, 'page') as number
    const limit = coerceInputValue('integer', isEmpty(given.limit) ? pageSizeOf(config) : given.limit, 'limit') as number
    values.page = Math.max(1, page)
    values.limit = Math.min(Math.max(1, limit), max)
  }
  return { values, sensitive }
}

export function maxRowsOf(config: Pick<CustomReferenceConfig, 'max_rows'>): number {
  const n = Number(config.max_rows)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), CUSTOM_LIMITS.maxRows) : CUSTOM_LIMITS.maxRows
}

export function pageSizeOf(config: Pick<CustomReferenceConfig, 'page_size' | 'max_rows'>): number {
  const n = Number(config.page_size)
  const size = Number.isFinite(n) && n > 0 ? Math.floor(n) : CUSTOM_LIMITS.defaultPageSize
  return Math.min(size, maxRowsOf(config))
}

/**
 * A template value (operation parameter, filter value): a whole `{{input.x}}`
 * token gives the input's typed value; tokens inside text become text;
 * anything else is a constant.
 */
export function renderTemplateValue(template: unknown, values: Record<string, unknown>): unknown {
  const whole = wholeInputToken(template)
  if (whole) return values[whole]
  if (typeof template !== 'string') return template
  return template.replace(INPUT_TOKEN_RE, (_m, name: string) => {
    const v = values[name]
    if (v === undefined || v === null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Names of inputs a template mentions. */
export function templateInputNames(template: unknown): string[] {
  if (typeof template !== 'string') return []
  return Array.from(template.matchAll(INPUT_TOKEN_RE), (m) => m[1])
}

/** The reference's PUBLIC inputs (Ask mode + paging), as integration_references.inputs rows. Ids stay stable by name. */
export function publicInputRows(config: CustomReferenceConfig, existing: Array<{ id?: string; name?: string }> = []) {
  const ids = new Map(existing.map((row) => [String(row.name ?? ''), row.id]))
  const rows = (config.inputs ?? [])
    .filter((input: CustomInput) => input.mode !== 'fixed')
    .map((input) => ({
      id: ids.get(input.name) ?? cryptoId(),
      name: input.name,
      type: input.type === 'date' ? 'string' : input.type,
      required: Boolean(input.required),
      description: input.description ?? '',
      default_value: input.default_value === undefined || input.default_value === null ? '' : input.default_value,
      location: 'query',
      source: 'variable',
    }))
  if (config.paging_inputs) {
    for (const [name, description, def] of [
      [PAGING_INPUTS.page, 'Page number (1 = first page)', 1],
      [PAGING_INPUTS.limit, `Rows per page (at most ${maxRowsOf(config)})`, pageSizeOf(config)],
    ] as const) {
      if (rows.some((row) => row.name === name)) continue
      rows.push({ id: ids.get(name) ?? cryptoId(), name, type: 'integer', required: false, description, default_value: def, location: 'query', source: 'variable' })
    }
  }
  return rows
}

function cryptoId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : `in_${Math.random().toString(36).slice(2, 12)}`
}
