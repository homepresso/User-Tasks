/**
 * A User Task's form values downstream (the reverse of
 * lib/forms/workflow-data.ts): when the task completes, its values become the
 * step's outputs — `{{task_data.<key>}}` (the latest task's) and
 * `{{<step>_task_data.<key>}}` (this step's, kept after later tasks), with
 * outcome, comments, completed by / at, attachments and every response —
 * typed in the workflow designer's pickers from the form itself
 * (lib/workflow-data-picker.ts), so adding, renaming or removing a field
 * updates them and a reference to a removed field is a wiring warning
 * (lib/workflow-wiring.ts).
 *
 * This module adds:
 *  - secrets: a field whose key names a secret (password, passphrase, secret, private key) is
 *    left out of the outputs unless the field sets `expose_downstream`;
 *  - "Save to workflow variable" (`config.save_to_variables`: field key →
 *    variable name): on completion the value also overwrites that workflow
 *    variable (e.g. an Approved amount); a field prefilled from a variable
 *    is offered the same variable by default.
 *
 * Multi-assignee tasks: the form values are the task's (shared; the last
 * response's values win), so `task_data` is one set of values; every
 * response's outcome, comment and time is `{{responses}}` (a list).
 * Pure and isomorphic.
 */

import { isSensitiveKey } from '@/lib/secret-keys'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'

/** `{{name}}` / `{{a.b}}` alone → its path (kept local: this module is imported by the data picker). */
function singleTokenPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}$/.exec(value.trim())?.[1] ?? null
}

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
/** Names the engine owns: never overwritten by a mapping. */
const RESERVED = new Set(['task_data', 'outcome', 'outcome_notes', 'task', 'task_id', 'user_task_id', 'workflow_id', 'workflow_run_id', 'tenant_id', 'responses', 'attachments', 'completed_by', 'completed_at', 'event_id'])

/**
 * Form field keys that hold a secret the person typed (a password, a
 * passphrase, a secret, a private key). Narrower than lib/secret-keys (whose
 * `_token` / `api_key` names are common, harmless form keys such as a
 * reference token that later steps already read).
 */
const SECRET_FIELD_RE = /(password|passphrase|secret|private_key|pin_code)/i

/** Is this field kept out of the workflow (a secret-shaped key without expose_downstream)? */
export function isSecretField(field: Pick<TaskFieldDef, 'key' | 'expose_downstream'>): boolean {
  return SECRET_FIELD_RE.test(field.key) && field.expose_downstream !== true
}

/** The values the workflow sees: secret fields (and their derived `<key>_…` values) removed. */
export function downstreamTaskData(fields: Array<Pick<TaskFieldDef, 'key' | 'expose_downstream'>>, values: Record<string, unknown>): Record<string, unknown> {
  const secret = fields.filter(isSecretField).map((f) => f.key)
  if (!secret.length) return values
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (secret.some((s) => k === s || k.startsWith(`${s}_`))) continue
    out[k] = v
  }
  return out
}

/** A stored `save_to_variables` map → clean pairs for the form's fields (unknown fields, bad or reserved names dropped). */
export function saveToVariableMap(raw: unknown, fields: Array<Pick<TaskFieldDef, 'key' | 'expose_downstream'>>): Record<string, string> {
  if (!isPlainObject(raw)) return {}
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const out: Record<string, string> = {}
  for (const [key, name] of Object.entries(raw).slice(0, 100)) {
    const field = byKey.get(key)
    if (!field || isSecretField(field) || typeof name !== 'string' || !VAR_RE.test(name) || RESERVED.has(name) || isSensitiveKey(name)) continue
    out[key] = name
  }
  return out
}

/** The workflow variables a completed task overwrites: variable name → value. */
export function variablesFromTask(raw: unknown, fields: Array<Pick<TaskFieldDef, 'key' | 'expose_downstream'>>, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, name] of Object.entries(saveToVariableMap(raw, fields))) {
    if (Object.prototype.hasOwnProperty.call(values, key)) out[name] = values[key]
  }
  return out
}

/**
 * "Save to workflow variable" offered by default: a field prefilled from a
 * workflow variable (`{{approved_amount}}`, one of `names`) saves back to it.
 */
export function suggestedSaveTargets(fields: Array<Pick<TaskFieldDef, 'key' | 'default' | 'expose_downstream'>>, names: Iterable<string>, stepValues?: unknown): Record<string, string> {
  const known = new Set(names)
  const step = isPlainObject(stepValues) ? stepValues : {}
  const out: Record<string, string> = {}
  for (const f of fields) {
    if (isSecretField(f)) continue
    const own = step[f.key]
    const path = singleTokenPath(typeof own === 'string' && own.trim() ? own : f.default)
    if (path && !path.includes('.') && known.has(path) && !RESERVED.has(path)) out[f.key] = path
  }
  return out
}

/**
 * On completion (the engine's resume of a User Task): `task_data` without
 * secret fields, and the "Save to workflow variable" targets set. Mutates
 * and returns `variables`.
 */
export function applyTaskCompletionOutputs(variables: Record<string, unknown>, node: { config?: Record<string, unknown> | null }, normalize: (raw: unknown) => TaskFieldDef[]): Record<string, unknown> {
  const fields = normalize(node.config?.fields)
  const values = variables.task_data
  if (!isPlainObject(values)) return variables
  const unknown = Object.keys(values).filter((k) => !fields.some((f) => f.key === k)).map((key) => ({ key }))
  const visible = downstreamTaskData([...fields, ...unknown], values)
  variables.task_data = visible
  Object.assign(variables, variablesFromTask(node.config?.save_to_variables, fields, visible))
  return variables
}
