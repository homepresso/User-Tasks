/**
 * AI assistants: what the form / task assistant may set, and how a proposed
 * value is checked (client-safe, pure). Used twice — on the server when the
 * model proposes values (lib/assistants/tools/form.ts) and in the browser
 * again when the person presses Apply, against the live form (a field that
 * became hidden or read-only meanwhile is refused).
 *
 * The assistant never sets: hidden fields, read-only fields, secret
 * (credential-like) fields, and field types whose values are references or
 * files (people, lookups, attachments, data tables, custom controls, labels,
 * buttons, headings) or complex survey answers.
 */
import { isSensitiveKey } from '@/lib/secret-keys'
import type { FormSnapshot, FormSnapshotField } from './types'

/** Field types the assistant may propose a value for. */
export const ASSISTANT_SETTABLE_TYPES = new Set([
  'text', 'textarea', 'number', 'currency', 'email', 'phone', 'url', 'date', 'datetime', 'boolean',
  'choice', 'multi_choice', 'rating', 'nps', 'slider', 'csat', 'likert', 'yes_no_maybe',
])

/** Field types with no value (never sent as fields to fill). */
const DISPLAY_TYPES = new Set(['heading', 'divider', 'button'])

const SECRET_LABEL = /\b(password|passcode|passphrase|secret|api[ -]?key|access token|token|pin|cvv|cvc|security code)\b/i

/** A credential-like field: its value is never shown to the model and it can't be set. */
export function isSecretField(field: { key: string; label?: string; type?: string }): boolean {
  return isSensitiveKey(field.key) || SECRET_LABEL.test(String(field.label ?? ''))
}

export type CoerceResult = { ok: true; value: unknown; display: string } | { ok: false; reason: string }

function optionMatch(field: FormSnapshotField, raw: unknown): { value: string; label: string } | null {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return null
  for (const o of field.options ?? []) if (o.value.toLowerCase() === text) return o
  for (const o of field.options ?? []) if (o.label.toLowerCase() === text) return o
  return null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.replace(/[, ]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function bounded(field: FormSnapshotField, n: number, fallbackMin?: number, fallbackMax?: number): string | null {
  const min = field.min ?? fallbackMin
  const max = field.max ?? fallbackMax
  if (min !== undefined && n < min) return `must be at least ${min}`
  if (max !== undefined && n > max) return `must be at most ${max}`
  return null
}

/** Why the assistant may not set this field at all (null: it may). */
export function unsettableReason(field: FormSnapshotField | undefined, formReadOnly = false): string | null {
  if (!field) return 'there is no such field on this form'
  if (!field.visible) return 'the field is hidden'
  if (field.read_only || formReadOnly) return 'the field is read-only'
  if (field.secret || isSecretField(field)) return 'the field holds a secret'
  if (DISPLAY_TYPES.has(field.type)) return 'the element holds no value'
  if (!ASSISTANT_SETTABLE_TYPES.has(field.type)) return `the assistant can't fill ${field.type} fields — ask the person to fill it`
  return null
}

/** Check and normalise one proposed value for a field. */
export function coerceProposedValue(field: FormSnapshotField, raw: unknown): CoerceResult {
  const bad = (reason: string): CoerceResult => ({ ok: false, reason })
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: field.type === 'multi_choice' ? [] : field.type === 'boolean' ? false : '', display: '(empty)' }
  switch (field.type) {
    case 'text': case 'textarea': case 'phone': case 'email': case 'url': {
      if (typeof raw === 'object') return bad('must be text')
      const value = String(raw).trim()
      if (field.max_length && value.length > field.max_length) return bad(`must be at most ${field.max_length} characters`)
      if (field.min_length && value.length < field.min_length) return bad(`must be at least ${field.min_length} characters`)
      if (field.type === 'email' && !EMAIL.test(value)) return bad('must be an email address')
      if (field.type === 'url' && !/^https?:\/\/\S+$/i.test(value)) return bad('must be a web address starting with http:// or https://')
      if (field.type === 'phone' && !/^[+()\d\s.-]{5,30}$/.test(value)) return bad('must be a phone number')
      if (field.pattern) {
        try { if (field.pattern.length <= 500 && !new RegExp(`^(?:${field.pattern})$`).test(value)) return bad(field.pattern_message || 'does not match the required format') } catch { /* an invalid pattern is the form's problem, not the value's */ }
      }
      return { ok: true, value, display: value }
    }
    case 'number': case 'currency': case 'slider': {
      const n = toNumber(raw)
      if (n === null) return bad('must be a number')
      const why = bounded(field, n)
      return why ? bad(why) : { ok: true, value: n, display: String(n) }
    }
    case 'rating': case 'csat': case 'nps': {
      const n = toNumber(raw)
      if (n === null || !Number.isInteger(n)) return bad('must be a whole number')
      const why = field.type === 'nps' ? bounded(field, n, 0, 10) : bounded(field, n, 1, field.type === 'csat' ? 5 : field.max ?? 5)
      return why ? bad(why) : { ok: true, value: n, display: String(n) }
    }
    case 'date': {
      const value = String(raw).trim().slice(0, 10)
      if (!DATE.test(value) || Number.isNaN(Date.parse(value)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) return bad('must be a date (YYYY-MM-DD)')
      if (field.min_date && value < field.min_date.slice(0, 10)) return bad(`must be on or after ${field.min_date.slice(0, 10)}`)
      if (field.max_date && value > field.max_date.slice(0, 10)) return bad(`must be on or before ${field.max_date.slice(0, 10)}`)
      return { ok: true, value, display: value }
    }
    case 'datetime': {
      const value = String(raw).trim()
      if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) || Number.isNaN(Date.parse(value))) return bad('must be a date and time (YYYY-MM-DDTHH:MM)')
      return { ok: true, value, display: value }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw, display: raw ? 'Yes' : 'No' }
      const t = String(raw).trim().toLowerCase()
      if (['true', 'yes', 'y', '1', 'on'].includes(t)) return { ok: true, value: true, display: 'Yes' }
      if (['false', 'no', 'n', '0', 'off'].includes(t)) return { ok: true, value: false, display: 'No' }
      return bad('must be yes or no')
    }
    case 'choice': case 'likert': case 'yes_no_maybe': {
      const o = optionMatch(field, raw)
      return o ? { ok: true, value: o.value, display: o.label } : bad(`must be one of: ${(field.options ?? []).map((x) => x.label).join(', ') || '(no options)'}`)
    }
    case 'multi_choice': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',')
      const picked: Array<{ value: string; label: string }> = []
      for (const item of list) {
        const o = optionMatch(field, item)
        if (!o) return bad(`"${String(item).trim()}" is not an option (options: ${(field.options ?? []).map((x) => x.label).join(', ')})`)
        if (!picked.some((p) => p.value === o.value)) picked.push(o)
      }
      const why = bounded(field, picked.length)
      return why ? bad(`selection count ${why}`) : { ok: true, value: picked.map((p) => p.value), display: picked.map((p) => p.label).join(', ') }
    }
    default:
      return bad(`the assistant can't fill ${field.type} fields`)
  }
}

/** The model's view of the form: hidden fields left out, secret values never included. */
export function formForModel(snapshot: FormSnapshot | null | undefined): Record<string, unknown> | null {
  if (!snapshot || !Array.isArray(snapshot.fields)) return null
  const fields = snapshot.fields
    .filter((f) => f && f.visible && !DISPLAY_TYPES.has(f.type))
    .slice(0, 300)
    .map((f) => {
      const secret = f.secret || isSecretField(f)
      const out: Record<string, unknown> = { key: f.key, label: f.label, type: f.type }
      if (f.required) out.required = true
      if (f.read_only || snapshot.read_only) out.read_only = true
      if (secret) out.secret = true
      if (f.options?.length) out.options = f.options.slice(0, 100).map((o) => (o.label && o.label !== o.value ? `${o.value} (${o.label})` : o.value))
      for (const k of ['help_text', 'placeholder', 'min', 'max', 'min_length', 'max_length', 'pattern_message', 'min_date', 'max_date'] as const) {
        if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = typeof f[k] === 'string' ? String(f[k]).slice(0, 500) : f[k]
      }
      out.value = secret ? (f.value ? '[secret — hidden]' : null) : clip(f.value)
      if (f.error) out.error = String(f.error).slice(0, 300)
      if (!ASSISTANT_SETTABLE_TYPES.has(f.type)) out.assistant_can_set = false
      return out
    })
  return { title: snapshot.title ? String(snapshot.title).slice(0, 200) : undefined, read_only: snapshot.read_only || undefined, fields }
}

function clip(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value
  if (value === undefined) return null
  try {
    const json = JSON.stringify(value)
    return json && json.length > 2_000 ? `${json.slice(0, 2_000)}…` : value
  } catch { return null }
}

/** Normalise the browser's snapshot (bounded, typed) before anything reads it. */
export function sanitizeSnapshot(raw: unknown): FormSnapshot | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).fields)) return null
  const fields: FormSnapshotField[] = []
  for (const f of ((raw as any).fields as any[]).slice(0, 300)) {
    if (!f || typeof f.key !== 'string' || !f.key || f.key.length > 200) continue
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const str = (v: unknown, n = 500) => (typeof v === 'string' && v ? v.slice(0, n) : undefined)
    fields.push({
      key: f.key,
      label: str(f.label, 300) ?? f.key,
      type: str(f.type, 40) ?? 'text',
      required: f.required === true || undefined,
      options: Array.isArray(f.options) ? f.options.slice(0, 200).filter((o: any) => o && typeof o.value === 'string').map((o: any) => ({ value: o.value.slice(0, 300), label: typeof o.label === 'string' ? o.label.slice(0, 300) : o.value.slice(0, 300) })) : undefined,
      help_text: str(f.help_text), placeholder: str(f.placeholder, 200),
      min: num(f.min), max: num(f.max), min_length: num(f.min_length), max_length: num(f.max_length),
      pattern: str(f.pattern), pattern_message: str(f.pattern_message, 300), min_date: str(f.min_date, 40), max_date: str(f.max_date, 40),
      visible: f.visible !== false,
      read_only: f.read_only === true,
      secret: f.secret === true || isSecretField({ key: f.key, label: f.label }),
      value: f.value,
      error: str(f.error, 300),
    })
  }
  return { title: typeof (raw as any).title === 'string' ? (raw as any).title.slice(0, 200) : undefined, read_only: (raw as any).read_only === true || undefined, fields }
}
