/**
 * Input helpers shared by the official actions (bundled into each module).
 *
 * The engine already coerces inputs to their declared types and applies
 * manifest defaults; these helpers repeat that defensively (Test runs, the
 * local runner and hand-written API calls may pass raw values) and produce
 * clear error messages naming the input.
 */

export type Inputs = Record<string, unknown>

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

const show = (value: unknown): string => {
  let s: string
  try { s = typeof value === 'string' ? value : JSON.stringify(value) } catch { s = String(value) }
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

/** A number from a number or numeric string ("1,234.5" accepted); null when blank. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'string') {
    const s = value.trim().replace(/,(?=\d{3}(?:\D|$))/g, '').replace(/^\+/, '')
    if (s === '') return null
    if (!/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return NaN
    return Number(s)
  }
  if (value === undefined || value === null) return null
  return NaN
}

export interface NumOptions { default?: number; min?: number; max?: number; integer?: boolean }

export function optNum(inputs: Inputs, name: string, opts: NumOptions = {}): number | null {
  const raw = inputs[name]
  let n = isBlank(raw) ? null : toNumber(raw)
  if (n === null) n = opts.default ?? null
  if (n === null) return null
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${show(raw)}")`)
  if (opts.integer && !Number.isInteger(n)) throw new Error(`${name} must be a whole number (got ${n})`)
  if (opts.min !== undefined && n < opts.min) throw new Error(`${name} must be at least ${opts.min} (got ${n})`)
  if (opts.max !== undefined && n > opts.max) throw new Error(`${name} must be at most ${opts.max} (got ${n})`)
  return n
}

export function num(inputs: Inputs, name: string, opts: NumOptions = {}): number {
  const n = optNum(inputs, name, opts)
  if (n === null) throw new Error(`${name} is required`)
  return n
}

export function str(inputs: Inputs, name: string, opts: { default?: string; required?: boolean; trim?: boolean; max?: number } = {}): string {
  const raw = inputs[name]
  let s: string
  if (raw === undefined || raw === null) s = opts.default ?? ''
  else if (typeof raw === 'string') s = raw
  else if (typeof raw === 'number' || typeof raw === 'boolean') s = String(raw)
  else s = JSON.stringify(raw)
  if (opts.trim !== false) s = s.trim()
  if (s === '' && opts.default !== undefined && raw !== '') s = opts.default
  if (opts.required && s === '') throw new Error(`${name} is required`)
  if (opts.max !== undefined && s.length > opts.max) throw new Error(`${name} is longer than ${opts.max} characters`)
  return s
}

/** Raw text (not trimmed); blank allowed. */
export function text(inputs: Inputs, name: string, opts: { required?: boolean; max?: number } = {}): string {
  return str(inputs, name, { ...opts, trim: false })
}

export function bool(inputs: Inputs, name: string, dflt: boolean): boolean {
  const raw = inputs[name]
  if (isBlank(raw)) return dflt
  if (typeof raw === 'boolean') return raw
  const s = String(raw).trim().toLowerCase()
  if (['true', 'yes', '1', 'on', 'y'].includes(s)) return true
  if (['false', 'no', '0', 'off', 'n'].includes(s)) return false
  throw new Error(`${name} must be true or false (got "${show(raw)}")`)
}

export function choice<T extends string>(inputs: Inputs, name: string, options: readonly T[], dflt: T): T {
  const raw = inputs[name]
  if (isBlank(raw)) return dflt
  const s = String(raw).trim()
  const hit = options.find((o) => o === s) ?? options.find((o) => o.toLowerCase() === s.toLowerCase())
  if (!hit) throw new Error(`${name} must be one of ${options.join(', ')} (got "${show(raw)}")`)
  return hit
}

/** A list: an array, a JSON array string, or comma / newline separated text. */
export function list(inputs: Inputs, name: string, opts: { required?: boolean } = {}): unknown[] {
  const raw = inputs[name]
  if (isBlank(raw)) {
    if (opts.required) throw new Error(`${name} is required (a list)`)
    return []
  }
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed
      } catch { /* fall through */ }
      throw new Error(`${name} is not a valid JSON list`)
    }
    return s.split(/\r?\n|,/).map((p) => p.trim()).filter(Boolean)
  }
  throw new Error(`${name} must be a list (got ${typeof raw})`)
}

export function strList(inputs: Inputs, name: string, opts: { required?: boolean } = {}): string[] {
  return list(inputs, name, opts)
    .filter((v) => !isBlank(v))
    .map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'object' ? JSON.stringify(v) : String(v)))
}

/** An object: a plain object or a JSON object string. */
export function obj(inputs: Inputs, name: string, opts: { required?: boolean } = {}): Record<string, unknown> {
  const raw = inputs[name]
  if (isBlank(raw)) {
    if (opts.required) throw new Error(`${name} is required (an object)`)
    return {}
  }
  if (isPlainObject(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (isPlainObject(parsed)) return parsed
    } catch { /* fall through */ }
  }
  throw new Error(`${name} must be an object`)
}

/** Any JSON value; strings that look like JSON are parsed. */
export function json(inputs: Inputs, name: string): unknown {
  const raw = inputs[name]
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (/^[[{]/.test(s)) {
      try { return JSON.parse(s) } catch { /* keep the text */ }
    }
  }
  return raw ?? null
}

/** Drop binary floating point noise (0.1 + 0.2 → 0.3). */
export function clean(n: number, digits = 15): number {
  if (!Number.isFinite(n) || n === 0) return n === 0 ? 0 : n
  const r = Number(n.toPrecision(digits))
  return r === 0 ? 0 : r
}

/** Read a value at a dotted path (`a.b[0].c`) of an object. */
export function getPath(source: unknown, path: string): unknown {
  if (!path) return source
  if (isPlainObject(source) && Object.prototype.hasOwnProperty.call(source, path)) return source[path]
  let cur: unknown = source
  for (const part of splitPath(path)) {
    if (cur === null || cur === undefined) return undefined
    if (typeof part === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[part < 0 ? cur.length + part : part]
    } else if (isPlainObject(cur) || Array.isArray(cur)) {
      cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined
    } else {
      return undefined
    }
  }
  return cur
}

/** `a.b[0]["x y"]` → ['a', 'b', 0, 'x y']. */
export function splitPath(path: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /([^.[\]]+)|\[(-?\d+)\]|\[(?:"([^"]*)"|'([^']*)')\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    if (m[1] !== undefined) out.push(m[1])
    else if (m[2] !== undefined) out.push(Number(m[2]))
    else out.push(m[3] ?? m[4] ?? '')
  }
  return out
}
