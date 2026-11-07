/**
 * Firestore REST typed values ⇄ plain JSON, so callers can write
 * {"name": "Ada", "age": 36} instead of
 * {"fields": {"name": {"stringValue": "Ada"}, "age": {"integerValue": "36"}}}.
 *
 * Pure: meant for a request/response transform on the Firebase connector
 * (request_config._transform 'firestore'; see the connector audit notes).
 */

export type FirestoreValue = Record<string, unknown>

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

export function toFirestoreValue(value: unknown, opts: { timestamps?: boolean } = {}): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Firestore values must be finite numbers')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (typeof value === 'bigint') return { integerValue: value.toString() }
  if (typeof value === 'string') {
    if (opts.timestamps && ISO_TIMESTAMP.test(value)) return { timestampValue: value }
    return { stringValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((v) => toFirestoreValue(v, opts)) } }
  if (typeof value === 'object') return { mapValue: { fields: toFirestoreFields(value as Record<string, unknown>, opts) } }
  throw new Error(`Unsupported value type ${typeof value}`)
}

export function toFirestoreFields(obj: Record<string, unknown>, opts: { timestamps?: boolean } = {}): Record<string, FirestoreValue> {
  const out: Record<string, FirestoreValue> = {}
  for (const [k, v] of Object.entries(obj ?? {})) if (v !== undefined) out[k] = toFirestoreValue(v, opts)
  return out
}

export function fromFirestoreValue(value: FirestoreValue | null | undefined): unknown {
  if (!value || typeof value !== 'object') return null
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return Boolean(value.booleanValue)
  if ('integerValue' in value) {
    const n = Number(value.integerValue)
    return Number.isSafeInteger(n) ? n : String(value.integerValue)
  }
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('stringValue' in value) return String(value.stringValue)
  if ('timestampValue' in value) return String(value.timestampValue)
  if ('bytesValue' in value) return String(value.bytesValue)
  if ('referenceValue' in value) return String(value.referenceValue)
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) {
    const values = (value.arrayValue as { values?: FirestoreValue[] })?.values ?? []
    return values.map((v) => fromFirestoreValue(v))
  }
  if ('mapValue' in value) return fromFirestoreFields((value.mapValue as { fields?: Record<string, FirestoreValue> })?.fields)
  return null
}

export function fromFirestoreFields(fields: Record<string, FirestoreValue> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = fromFirestoreValue(v)
  return out
}

/** A REST document → { id, path, data, createTime, updateTime }. */
export function fromFirestoreDocument(doc: { name?: string; fields?: Record<string, FirestoreValue>; createTime?: string; updateTime?: string }) {
  const name = String(doc?.name ?? '')
  const path = name.includes('/documents/') ? name.slice(name.indexOf('/documents/') + '/documents/'.length) : name
  return { id: path.split('/').pop() ?? '', path, data: fromFirestoreFields(doc?.fields), createTime: doc?.createTime, updateTime: doc?.updateTime }
}
