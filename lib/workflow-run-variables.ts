/**
 * Reportable run variables: the bounded, redacted copy of a run's variables
 * stored in `workflow_runs.variables` (migration 20261129000000) when the run
 * completes, fails or pauses — what reports, OData and the process overview
 * read as workflow variable columns (`vars.<name>`).
 *
 * The engine's full working state stays in `pause_variables` (paused runs
 * only, cleared on resume) and is never exposed by reports. This copy keeps
 * what a designer would report on — start-form inputs, task form values
 * (`task_data.*`), Form submitted values (`form.*`), Set Variable / step
 * outputs — and drops:
 *  - engine / system keys (ids, initiator, trigger type, `_internal` keys)
 *    and steps' resume tokens (`<step>_event_id`),
 *  - anything under a credential-like key (lib/secret-fields isSensitiveKey)
 *    and values that look like secrets (encrypted `enc:v1:`, bearer tokens,
 *    JWTs),
 *  - file bytes (data: URLs, long base64, storage references) and lists of
 *    objects (uploaded file lists: their `<key>_count` is kept instead),
 *  - nesting deeper than three levels (`task_data.vendor_item.name`).
 * Strings are capped at 500 characters, lists at 25 values and the whole
 * object at ~32 KB (top-level values first, then form / task values, then
 * other objects), so a run row stays small whatever a step returned.
 *
 * Pure: shared by the engine (write) and the report builder (read / types).
 */

import { isSensitiveKey } from '@/lib/secret-fields'
import { INITIATOR_VARIABLES } from '@/lib/workflow-initiator'
import { isPlainObject } from '@/lib/utils/guards'

export const RUN_VARIABLES_LIMITS = {
  maxDepth: 3,
  maxStringLength: 500,
  maxArrayItems: 25,
  maxObjectKeys: 50,
  maxLeaves: 300,
  maxBytes: 32 * 1024,
  maxObjectBytes: 8 * 1024,
} as const

/** Engine-owned keys a report never shows as a variable (the run row has the real columns). */
export const SYSTEM_RUN_VARIABLE_KEYS: ReadonlySet<string> = new Set<string>([
  'task_id',
  'tenant_id',
  'workflow_id',
  'workflow_name',
  'workflow_started_at',
  'trigger_type',
  'event_id',
  'user_task_event_id',
  'last_error',
  'error_workflow_id',
  'live',
  'workflow_sla_label',
  'workflow_sla_due_at',
  'workflow_sla_warning_at',
  'workflow_sla_status',
  ...INITIATOR_VARIABLES,
])

/** Object variables written first (form values designers report on most). */
const PRIORITY_OBJECTS = ['task_data', 'form']

/** Keys whose values are file content or storage handles, never reported. */
const FILE_KEYS = new Set(['storage_ref', 'content', 'content_base64', 'base64', 'bytes', 'data_url', 'buffer', 'file_data'])

/** One variable name segment: what a report column path and a PostgREST JSON path both accept. */
const SEGMENT = /^[A-Za-z0-9_]{1,64}$/

export function isReportableSegment(key: string): boolean {
  return SEGMENT.test(key)
}

/** A top-level variable name a report may show. */
export function isReportableVariableKey(key: string): boolean {
  if (!isReportableSegment(key) || key.startsWith('_')) return false
  if (SYSTEM_RUN_VARIABLE_KEYS.has(key) || isResumeTokenKey(key)) return false
  return !isSensitiveKey(key)
}

/** `<step>_event_id`: a paused step's resume token — never stored for reports. */
function isResumeTokenKey(key: string): boolean {
  return key === 'event_id' || key.endsWith('_event_id')
}

function looksSecretOrBytes(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('enc:v1:')) return true
  if (/^bearer\s+\S{8,}/i.test(v)) return true
  if (/^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+$/.test(v)) return true // JWT
  if (/^data:[^,]{0,100};base64,/i.test(v)) return true
  if (v.length >= 256 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return true // long base64 blob
  return false
}

type Primitive = string | number | boolean | null

function cleanPrimitive(value: unknown): Primitive | undefined {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (looksSecretOrBytes(value)) return undefined
    return value.length > RUN_VARIABLES_LIMITS.maxStringLength
      ? `${value.slice(0, RUN_VARIABLES_LIMITS.maxStringLength - 1)}…`
      : value
  }
  return undefined
}

interface Budget { leaves: number }

/** A cleaned value, or undefined to drop it. */
function cleanValue(value: unknown, depth: number, budget: Budget): unknown {
  if (budget.leaves >= RUN_VARIABLES_LIMITS.maxLeaves) return undefined
  if (Array.isArray(value)) {
    // Lists of scalars (multi-selects, tags) only: lists of objects are file
    // lists / API rows — their counts are separate variables.
    if (!value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) return undefined
    const items = value.slice(0, RUN_VARIABLES_LIMITS.maxArrayItems).map(cleanPrimitive).filter((item) => item !== undefined)
    budget.leaves += 1
    return items
  }
  if (isPlainObject(value)) {
    if (depth >= RUN_VARIABLES_LIMITS.maxDepth) return undefined
    const out: Record<string, unknown> = {}
    let kept = 0
    for (const [key, child] of Object.entries(value)) {
      if (kept >= RUN_VARIABLES_LIMITS.maxObjectKeys) break
      if (!isReportableSegment(key) || key.startsWith('_') || isSensitiveKey(key) || isResumeTokenKey(key) || FILE_KEYS.has(key)) continue
      const cleaned = cleanValue(child, depth + 1, budget)
      if (cleaned === undefined) continue
      out[key] = cleaned
      kept += 1
    }
    return kept > 0 ? out : undefined
  }
  const primitive = cleanPrimitive(value)
  if (primitive !== undefined) budget.leaves += 1
  return primitive
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/**
 * The reportable copy of a run's variables (see the module comment), or null
 * when nothing is reportable.
 */
export function reportableRunVariables(variables: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!isPlainObject(variables)) return null
  const entries = Object.entries(variables).filter(([key]) => isReportableVariableKey(key) && !FILE_KEYS.has(key))
  const rank = (key: string, value: unknown) => {
    if (!isPlainObject(value)) return 0
    const priority = PRIORITY_OBJECTS.indexOf(key)
    return priority >= 0 ? 1 + priority : 1 + PRIORITY_OBJECTS.length
  }
  // Stable: scalars and lists, then task_data / form, then other objects.
  const ordered = entries
    .map((entry, index) => ({ entry, index, rank: rank(entry[0], entry[1]) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry)

  const out: Record<string, unknown> = {}
  const budget: Budget = { leaves: 0 }
  let bytes = 2
  for (const [key, value] of ordered) {
    const cleaned = cleanValue(value, 1, budget)
    if (cleaned === undefined) continue
    const size = byteLength(cleaned) + key.length + 4
    if (isPlainObject(cleaned) && size > RUN_VARIABLES_LIMITS.maxObjectBytes) continue
    if (bytes + size > RUN_VARIABLES_LIMITS.maxBytes) continue
    out[key] = cleaned
    bytes += size
  }
  return Object.keys(out).length > 0 ? out : null
}

/* ── Reading: variable paths and types for reports ─────────────────────── */

/** Prefix of a workflow variable column in report configs (`vars.amount`, `vars.task_data.amount`). */
export const RUN_VARIABLE_COLUMN_PREFIX = 'vars.'

/** `vars.<a>[.<b>[.<c>]]` — a workflow variable column key. */
export function isRunVariableColumnKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(RUN_VARIABLE_COLUMN_PREFIX)) return false
  const parts = key.slice(RUN_VARIABLE_COLUMN_PREFIX.length).split('.')
  return parts.length >= 1 && parts.length <= RUN_VARIABLES_LIMITS.maxDepth && parts.every(isReportableSegment)
}

/** The value at a variable path (`task_data.amount`) of a stored variables object. */
export function readRunVariable(variables: unknown, path: string): unknown {
  let cursor: unknown = variables
  for (const part of path.split('.')) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

/**
 * Leaf paths of a stored variables object (what a report can show), with
 * their values: scalars and scalar lists, nested up to the depth limit.
 */
export function runVariableLeaves(variables: unknown, prefix = '', depth = 1): Array<[string, unknown]> {
  if (!isPlainObject(variables)) return []
  const out: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(variables)) {
    if (!isReportableSegment(key)) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) {
      if (depth < RUN_VARIABLES_LIMITS.maxDepth) out.push(...runVariableLeaves(value, path, depth + 1))
      continue
    }
    out.push([path, value])
  }
  return out
}

export type RunVariableType = 'text' | 'number' | 'date' | 'boolean'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** The report type of observed values: number / boolean / date when every value is one, else text. */
export function inferRunVariableType(values: unknown[]): RunVariableType {
  const present = values.filter((value) => value !== null && value !== undefined && value !== '')
  if (present.length === 0) return 'text'
  if (present.every((value) => typeof value === 'number')) return 'number'
  if (present.every((value) => typeof value === 'boolean')) return 'boolean'
  if (present.every((value) => typeof value === 'string' && ISO_DATE.test(value))) return 'date'
  return 'text'
}
