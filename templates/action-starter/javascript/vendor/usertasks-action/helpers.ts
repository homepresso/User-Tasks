/**
 * Authority-free host helpers for the custom action sandbox: crypto
 * primitives and Intl (QuickJS has neither). They read nothing but their
 * arguments, so every action gets them without a capability.
 *
 * Node only (node:crypto). Shared verbatim with @user-tasks/action (its local
 * test runner) — __tests__/custom-action-contract checks the copies match.
 */

import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { ACTION_LIMITS } from './contract'
import { HostServiceError } from './sandbox'

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function encodeBytes(bytes: Buffer, encoding: string): string {
  if (encoding === 'base64') return bytes.toString('base64')
  if (encoding === 'base64url') return bytes.toString('base64url')
  return bytes.toString('hex')
}

export function toBytes(data: unknown, from?: string): Buffer {
  if (typeof data !== 'string') return Buffer.from(JSON.stringify(data ?? null), 'utf8')
  if (from === 'hex') return Buffer.from(data, 'hex')
  if (from === 'base64') return Buffer.from(data, 'base64')
  if (from === 'base64url') return Buffer.from(data, 'base64url')
  return Buffer.from(data, 'utf8')
}

const DIGESTS: Record<string, string> = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512', MD5: 'md5', SHA1: 'sha1', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512' }

export function digestAlg(alg: unknown): string {
  const a = DIGESTS[String(alg ?? '').toUpperCase()] ?? DIGESTS[String(alg ?? '')]
  if (!a) throw new HostServiceError('Hash algorithm must be SHA-1, SHA-256, SHA-384, SHA-512 or MD5', 'invalid')
  return a
}

/** Sync, authority-free helpers: crypto primitives and Intl (QuickJS has neither). */
export function syncHelpers(name: string, args: unknown[]): unknown {
  switch (name) {
    case 'crypto.randomUUID': return randomUUID()
    case 'crypto.randomBytes': {
      const n = Math.floor(Number(args[0]))
      if (!Number.isFinite(n) || n < 1 || n > 4096) throw new HostServiceError('randomBytes: 1–4096 bytes', 'invalid')
      return encodeBytes(randomBytes(n), String(args[1] ?? 'hex'))
    }
    case 'crypto.randomInt': {
      const min = Math.floor(Number(args[0]))
      const max = Math.floor(Number(args[1]))
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min || max - min > 2 ** 47) throw new HostServiceError('randomInt(min, max): integers with min < max', 'invalid')
      return randomInt(min, max)
    }
    case 'crypto.digest': {
      const [alg, data, encoding] = args
      return encodeBytes(createHash(digestAlg(alg)).update(toBytes(data)).digest(), String(encoding ?? 'hex'))
    }
    case 'crypto.timingSafeEqual': {
      const a = Buffer.from(String(args[0] ?? ''), 'utf8')
      const b = Buffer.from(String(args[1] ?? ''), 'utf8')
      return a.length === b.length && timingSafeEqual(a, b)
    }
    case 'crypto.encode': {
      const [data, from, to] = args
      const bytes = toBytes(data, String(from ?? 'utf8'))
      if (bytes.length > ACTION_LIMITS.inputBytes) throw new HostServiceError('Too much data to encode', 'invalid')
      const target = String(to ?? 'base64')
      return target === 'utf8' ? bytes.toString('utf8') : encodeBytes(bytes, target)
    }
    case 'intl.formatNumber': {
      const [value, locale, options] = args
      try {
        return new Intl.NumberFormat(locale ? String(locale) : 'en-US', isPlainObject(options) ? options as Intl.NumberFormatOptions : {}).format(Number(value))
      } catch (error) {
        throw new HostServiceError(`formatNumber: ${(error as Error).message}`, 'invalid')
      }
    }
    case 'intl.formatDate': {
      const [value, locale, options] = args
      const date = new Date(String(value))
      if (Number.isNaN(date.getTime())) throw new HostServiceError('formatDate: not a date', 'invalid')
      try {
        return new Intl.DateTimeFormat(locale ? String(locale) : 'en-US', isPlainObject(options) ? options as Intl.DateTimeFormatOptions : {}).format(date)
      } catch (error) {
        throw new HostServiceError(`formatDate: ${(error as Error).message}`, 'invalid')
      }
    }
    case 'intl.zonedParts': return zonedParts(String(args[0] ?? ''), String(args[1] ?? 'UTC'))
    case 'intl.zonedToUtc': return zonedToUtc(String(args[0] ?? ''), String(args[1] ?? 'UTC'))
    case 'intl.timeZones': return typeof (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf === 'function' ? (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') : ['UTC']
    case 'intl.collate': {
      const [a, b, locale, options] = args
      return new Intl.Collator(locale ? String(locale) : undefined, isPlainObject(options) ? options as Intl.CollatorOptions : {}).compare(String(a ?? ''), String(b ?? ''))
    }
    default:
      throw new HostServiceError(`${name} is not a host function`, 'capability')
  }
}

function checkZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return timeZone
  } catch {
    throw new HostServiceError(`Unknown time zone "${timeZone.slice(0, 60)}"`, 'invalid')
  }
}

/** The wall-clock parts of an instant in a time zone (+ its UTC offset in minutes). */
export function zonedParts(instant: string, timeZone: string) {
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) throw new HostServiceError('zonedParts: not a date', 'invalid')
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: checkZone(timeZone), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const y = Number(get('year')); const mo = Number(get('month')); const d = Number(get('day'))
  const h = Number(get('hour')) % 24; const mi = Number(get('minute')); const s = Number(get('second'))
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s)
  const offset = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  const sign = offset >= 0 ? '+' : '-'
  const abs = Math.abs(offset)
  return {
    year: y, month: mo, day: d, hour: h, minute: mi, second: s,
    weekday: get('weekday'),
    offset_minutes: offset,
    iso: `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  }
}

/** A local wall-clock time (YYYY-MM-DDTHH:mm[:ss]) in a zone → the UTC instant (ISO). */
export function zonedToUtc(local: string, timeZone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(local.trim())
  if (!m) throw new HostServiceError('zonedToUtc: use YYYY-MM-DDTHH:mm[:ss]', 'invalid')
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4] ?? '0', m[5] ?? '0', m[6] ?? '0'].map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  // Two passes settle DST transitions.
  let t = guess
  for (let i = 0; i < 2; i++) {
    const off = zonedParts(new Date(t).toISOString(), timeZone).offset_minutes
    t = guess - off * 60000
  }
  return new Date(t).toISOString()
}

