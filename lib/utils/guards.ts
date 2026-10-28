/** Shared type guards for untyped JSON (request bodies, stored config, rows). */

/** Any non-null object, arrays included. */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A non-null object that is not an array. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
