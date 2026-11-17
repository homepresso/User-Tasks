/**
 * Live prefill: a task's fields prefilled from the trigger's record
 * ("Workflow data" → List item, lib/forms/workflow-data.ts) show the record
 * as it is when the task OPENS, not only as it was when the run started.
 *
 * When the engine creates the task it notes, in `metadata.live_prefill`,
 * which fields hold a record value (their default or the step's prefill is
 * exactly `{{<record variable>.<column>…}}`), where the record lives and the
 * value each field was given. When the task opens
 * (lib/services/task-live-prefill.ts) the record's current values are read
 * (core data table rows; an extension trigger's `readRecord`) and a field is
 * refreshed only if it still holds the value it was given — a field the
 * assignee (or a draft save, a rule, the API) already changed keeps that
 * value. The new value becomes the field's "given" value, so later opens
 * keep following the record until someone edits the field.
 *
 * Why this choice: the person opening a task should see the item as it is
 * (an approver reading an amount that was corrected after the request was
 * made), but nothing they typed may ever be overwritten behind their back.
 * Values never leave the form's own declared value fields (the field
 * allowlist), credential-shaped paths are never followed, and fields whose
 * value can't be refreshed safely (files, signatures, lists) are not noted.
 *
 * Pure and isomorphic.
 */

import { isSensitiveKey } from '@/lib/secret-keys'
import { isDisplayField, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { singleTokenPath } from './workflow-data'

export const LIVE_PREFILL_KEY = 'live_prefill'

export interface LivePrefillSource {
  kind: 'table' | 'extension'
  /** table: the data table and row. */
  table_id?: string
  row_id?: string
  /** extension: the trigger's node type (ext.<id>.<key>), the record's ids (record.idFrom) and the trigger's scalar settings. */
  trigger?: string
  ids?: Record<string, string | number>
  config?: Record<string, string | number | boolean>
}

export interface LivePrefill {
  source: LivePrefillSource
  /** Field key → path inside the record (`Title`, `Department.value`). */
  fields: Record<string, string>
  /** The value each field was last given from the record. */
  values: Record<string, unknown>
}

const NOT_REFRESHED = new Set(['attachments', 'image', 'signature', 'data_table', 'list', 'repeating_section', 'custom', 'button', 'rich_text'])
const PATH_RE = /^[A-Za-z0-9_$-]{1,255}(?:\.[A-Za-z0-9_$-]{1,64}){0,3}$/

/**
 * The fields that take a value from the record: their step prefill
 * (`config.field_values[key]`) or else their default is exactly one token
 * under `variable` (`{{after.Title}}` → `Title`).
 */
export function livePrefillFields(fields: TaskFieldDef[], stepValues: unknown, variable: string): Record<string, string> {
  const out: Record<string, string> = {}
  const step = isPlainObject(stepValues) ? stepValues : {}
  for (const field of fields) {
    if (isDisplayField(field) || NOT_REFRESHED.has(field.type)) continue
    const own = step[field.key]
    const template = typeof own === 'string' && own.trim() ? own : field.default
    const path = singleTokenPath(template)
    if (!path || !path.startsWith(`${variable}.`)) continue
    const inner = path.slice(variable.length + 1)
    if (!PATH_RE.test(inner) || inner.split('.').some((seg) => seg.startsWith('_') || isSensitiveKey(seg) || seg === '__proto__' || seg === 'constructor' || seg === 'prototype')) continue
    out[field.key] = inner
  }
  return out
}

/** Value at a dotted path (no prototype keys). */
function at(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const seg of path.split('.')) {
    if (!isPlainObject(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

/** The record's raw values for the noted fields (undefined = the record has no such value: left alone). */
export function pickRecordValues(map: Record<string, string>, record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, path] of Object.entries(map)) {
    if (path.split('.').some((s) => isSensitiveKey(s))) continue
    const v = at(record, path)
    if (v !== undefined) out[key] = v
  }
  return out
}

/** Equal for prefill purposes (blank = null = '' = []; objects by JSON). */
export function samePrefillValue(a: unknown, b: unknown): boolean {
  const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
  if (blank(a) && blank(b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b || String(a) === String(b)
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

/**
 * Which fields to refresh: those still holding the value they were given
 * (`live.values`) whose fresh, coerced value differs. Returns the patch for
 * template_values and the next live state.
 */
export function planLiveRefresh(stored: Record<string, unknown>, live: LivePrefill, fresh: Record<string, unknown>): { values: Record<string, unknown>; changed: string[]; live: LivePrefill } {
  const values: Record<string, unknown> = {}
  const changed: string[] = []
  const nextValues = { ...live.values }
  for (const key of Object.keys(live.fields)) {
    if (!Object.prototype.hasOwnProperty.call(fresh, key)) continue
    if (!samePrefillValue(stored[key], live.values[key])) continue // edited since: keep it
    if (samePrefillValue(stored[key], fresh[key])) continue
    values[key] = fresh[key]
    nextValues[key] = fresh[key]
    changed.push(key)
  }
  return { values, changed, live: { ...live, values: nextValues } }
}

/** A stored `metadata.live_prefill` → a clean one, or null. */
export function readLivePrefill(raw: unknown): LivePrefill | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.source) || !isPlainObject(raw.fields)) return null
  const src = raw.source
  const kind = src.kind === 'table' ? 'table' : src.kind === 'extension' ? 'extension' : null
  if (!kind) return null
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.fields).slice(0, 200)) if (/^[a-z0-9][a-z0-9_]{0,63}$/.test(k) && typeof v === 'string' && PATH_RE.test(v)) fields[k] = v
  if (!Object.keys(fields).length) return null
  const source: LivePrefillSource = { kind }
  if (kind === 'table') {
    if (typeof src.table_id !== 'string' || typeof src.row_id !== 'string') return null
    source.table_id = src.table_id
    source.row_id = src.row_id
  } else {
    if (typeof src.trigger !== 'string' || !/^ext\.[a-z0-9-]+\.[a-z0-9_]+$/i.test(src.trigger)) return null
    source.trigger = src.trigger
    source.ids = scalars(src.ids) as Record<string, string | number>
    source.config = scalars(src.config)
  }
  return { source, fields, values: isPlainObject(raw.values) ? raw.values as Record<string, unknown> : {} }
}

/** Scalar entries only (strings capped), at most 40. */
export function scalars(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  if (!isPlainObject(raw)) return out
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k) || isSensitiveKey(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 500)
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  return out
}
