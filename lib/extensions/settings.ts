/**
 * Typed extension settings (client-safe): the field model of the connector
 * and provider forms (visibleWhen / requiredWhen, secret fields) applied to
 * a manifest's settings page. The browser renders and pre-checks with these
 * functions; the server validates every save with the same ones
 * (lib/services/extensions.ts) before storing anything.
 *
 * Secret and certificate fields: a non-empty string sets the value, `null`
 * clears it, absent / empty keeps the stored one. They are encrypted at
 * rest and only ever reported back as set / not set.
 */

import type { SettingField, SettingsSchema } from './manifest'

export const SECRET_FIELD_TYPES = new Set(['secret', 'certificate'])

export function isSecretField(field: Pick<SettingField, 'type'>): boolean {
  return SECRET_FIELD_TYPES.has(field.type)
}

export function settingsFields(schema: SettingsSchema): SettingField[] {
  return schema.sections.flatMap((s) => s.fields)
}

type Condition = NonNullable<SettingField['visibleWhen']>

function conditionHolds(cond: Condition | undefined, values: Record<string, unknown>): boolean {
  if (!cond) return true
  const value = values[cond.field]
  const normalized = value === undefined || value === null ? '' : value
  if (cond.equals !== undefined && normalized !== cond.equals && String(normalized) !== String(cond.equals)) return false
  if (cond.notEquals !== undefined && (normalized === cond.notEquals || String(normalized) === String(cond.notEquals))) return false
  if (cond.in && !cond.in.some((v) => v === normalized || String(v) === String(normalized))) return false
  return true
}

export function isFieldVisible(field: SettingField, values: Record<string, unknown>): boolean {
  return conditionHolds(field.visibleWhen, values)
}

export function isFieldRequired(field: SettingField, values: Record<string, unknown>): boolean {
  if (!isFieldVisible(field, values)) return false
  if (field.required) return true
  return field.requiredWhen ? conditionHolds(field.requiredWhen, values) : false
}

export function settingsDefaults(schema: SettingsSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of settingsFields(schema)) if (!isSecretField(field) && field.default !== undefined) out[field.key] = field.default
  return out
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PEM_RE = /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/

function coerce(field: SettingField, raw: unknown): { value: unknown } | { error: string } {
  const empty = raw === undefined || raw === null || raw === ''
  switch (field.type) {
    case 'boolean':
      if (empty) return { value: false }
      if (typeof raw === 'boolean') return { value: raw }
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' }
      return { error: 'must be true or false' }
    case 'number': {
      if (empty) return { value: null }
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) return { error: 'must be a number' }
      if (field.min !== undefined && n < field.min) return { error: `must be at least ${field.min}` }
      if (field.max !== undefined && n > field.max) return { error: `must be at most ${field.max}` }
      return { value: n }
    }
    case 'multiselect': {
      if (empty) return { value: [] }
      const list = Array.isArray(raw) ? raw.map(String) : String(raw).split(',').map((s) => s.trim()).filter(Boolean)
      const allowed = new Set((field.options ?? []).map((o) => o.value))
      const bad = list.filter((v) => !allowed.has(v))
      return bad.length ? { error: `has unknown option ${bad.join(', ')}` } : { value: [...new Set(list)] }
    }
    case 'select': {
      if (empty) return { value: null }
      const value = String(raw)
      return (field.options ?? []).some((o) => o.value === value) ? { value } : { error: 'is not one of the options' }
    }
    case 'json': {
      if (empty) return { value: null }
      if (typeof raw !== 'string') return { value: raw }
      try { return { value: JSON.parse(raw) } } catch { return { error: 'must be valid JSON' } }
    }
    default: {
      if (empty) return { value: null }
      if (typeof raw !== 'string') return { error: 'must be text' }
      const value = field.type === 'textarea' || field.type === 'certificate' ? raw : raw.trim()
      const max = field.maxLength ?? (field.type === 'textarea' || field.type === 'certificate' ? 20_000 : 2_000)
      if (value.length > max) return { error: `must be at most ${max} characters` }
      if (field.type === 'url') {
        try {
          const url = new URL(value)
          if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'must be an http(s) URL' }
        } catch { return { error: 'must be a URL' } }
      }
      if (field.type === 'hostname' && !HOSTNAME_RE.test(value)) return { error: 'must be a host name' }
      if (field.type === 'email' && !EMAIL_RE.test(value)) return { error: 'must be an email address' }
      if (field.type === 'certificate' && !PEM_RE.test(value)) return { error: 'must be a PEM certificate or key (-----BEGIN …-----)' }
      if (field.pattern && !new RegExp(field.pattern.regex).test(value)) return { error: field.pattern.message }
      return { value }
    }
  }
}

export interface ValidatedSettings {
  /** Non-secret values to store (every schema field; hidden fields kept as given). */
  values: Record<string, unknown>
  /** Secret changes: string = set, null = clear (keys absent = keep). */
  secrets: Record<string, string | null>
  /** Field key → message. */
  errors: Record<string, string>
}

/**
 * Validate a settings save against the schema. `secretsSet` names the secret
 * fields already stored (a required secret that is set may be left empty).
 * Keys not in the schema are dropped.
 */
export function validateSettings(schema: SettingsSchema, input: Record<string, unknown>, secretsSet: ReadonlySet<string> = new Set()): ValidatedSettings {
  const values: Record<string, unknown> = {}
  const secrets: Record<string, string | null> = {}
  const errors: Record<string, string> = {}
  const fields = settingsFields(schema)
  // Visibility / requiredWhen read the submitted values (secret fields count as "set" when stored or provided).
  const view: Record<string, unknown> = { ...input }
  for (const field of fields) {
    if (isSecretField(field)) {
      const raw = input[field.key]
      if (raw === null) {
        secrets[field.key] = null
      } else if (typeof raw === 'string' && raw !== '') {
        const checked = coerce(field, raw)
        if ('error' in checked) errors[field.key] = `${field.label} ${checked.error}`
        else secrets[field.key] = String(checked.value)
      } else if (raw !== undefined && raw !== '') {
        errors[field.key] = `${field.label} must be text`
      }
      view[field.key] = secrets[field.key] === null ? '' : secrets[field.key] ?? (secretsSet.has(field.key) ? '••••' : '')
      continue
    }
    const checked = coerce(field, input[field.key] === undefined ? field.default : input[field.key])
    if ('error' in checked) errors[field.key] = `${field.label} ${checked.error}`
    else values[field.key] = checked.value
  }
  for (const field of fields) {
    if (errors[field.key] || !isFieldRequired(field, view)) continue
    const value = isSecretField(field) ? view[field.key] : values[field.key]
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) errors[field.key] = `${field.label} is required`
  }
  return { values, secrets, errors }
}
