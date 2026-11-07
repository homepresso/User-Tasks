/**
 * Response paths a form rule's "Call an API reference" maps from (the
 * "Then map the response" table): `name`, `data.address.city`, `[0].name`,
 * `items[0].id`, `@odata.count`; '' = the whole response. No prototype keys.
 * Kept free of other form modules so the action normalizer can use it
 * (lib/forms/field-buttons.ts); the mapping itself is lib/forms/reference-results.ts.
 */

import { splitPath } from '@/lib/response-schema'

const SEGMENT = '[A-Za-z0-9_$@-]{1,64}'
const INDEX = '(?:\\[\\d{1,4}\\])'
export const RESULT_PATH_RE = new RegExp(`^(?:(?:${SEGMENT}${INDEX}*|${INDEX}+)(?:\\.${SEGMENT}${INDEX}*){0,9})?$`)
export const RESULT_SEGMENT_RE = new RegExp(`^${SEGMENT}$`)
export const FORBIDDEN_RESULT_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/** A response path a rule may map (syntax and no prototype keys). */
export function isResultPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 200 && RESULT_PATH_RE.test(path) && !splitPath(path).some((s) => FORBIDDEN_RESULT_SEGMENTS.has(s))
}

/** Canonical spelling: trimmed, a leading `$.` dropped, `.0.` as `[0].`. */
export function normalizeResultPath(path: unknown): string {
  return String(path ?? '').trim().replace(/^\$\.?/, '').replace(/^\.+/, '').replace(/\.(\d+)(?=\.|\[|$)/g, '[$1]').replace(/^(\d+)(?=\.|\[|$)/, '[$1]')
}
