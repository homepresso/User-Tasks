/**
 * Workflow variables inside a task's form: a form designed from a workflow
 * step may use the step's workflow data — `{{after.Title}}`, `{{cost_centre}}`,
 * `{{approve_task_data.comments}}` — in any typed value: labels, help text,
 * placeholders, visibility and validation conditions, rule conditions and
 * actions, button steps, messages, data table / lookup filters, dynamic
 * values (lib/forms/workflow-data.ts lists them in the designer's pickers).
 *
 * The browser never sees run variables, so they are resolved on the server:
 * when the engine creates the task (the form definition stored on the task)
 * and again when the task OPENS, from the run's current variables
 * (lib/services/task-live-prefill.ts) — the definition the task was created
 * with is kept as `metadata.workflow_templates` so each open starts from it.
 * Validation on submit reads the same stored, resolved definition.
 *
 * Only a token whose first segment is a run variable is replaced; the form's
 * own namespaces ({{form.x}}, {{task_data.x}}, {{user.*}}, {{param.x}},
 * {{control.*}}, {{event.*}}, dates…) and formulas ({{= …}}) are left for the
 * form, and credential-shaped names are never followed (they resolve to '').
 * Pure and isomorphic.
 */

import { isSensitiveKey } from '@/lib/secret-keys'
import { isPlainObject } from '@/lib/utils/guards'

/** Roots the form resolves itself (never taken from the run). */
export const FORM_TOKEN_ROOTS: ReadonlySet<string> = new Set([
  'form', 'task_data', 'task', 'user', 'param', 'var', 'control', 'event', 'item', 'row', 'parent', 'search', 'query',
  'today', 'now', 'tomorrow', 'yesterday', 'submission', 'target', 'run_reference', 'submission_id', 'state', 'page', 'flags', 'section',
])

export const WORKFLOW_TEMPLATES_KEY = 'workflow_templates'

const TOKEN_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_$-]+)*)\s*\}\}/g
const MAX_DEPTH = 40

function at(vars: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = vars
  for (const seg of path.split('.')) {
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return undefined
    if (Array.isArray(cursor) && /^\d+$/.test(seg)) { cursor = cursor[Number(seg)]; continue }
    if (!isPlainObject(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

/** Is `path` a run variable reference (its root is a run variable and not a form namespace)? */
export function isWorkflowPath(path: string, vars: Record<string, unknown>): boolean {
  const root = path.split('.')[0]
  return !FORM_TOKEN_ROOTS.has(root) && Object.prototype.hasOwnProperty.call(vars, root)
}

/** One text with its run-variable tokens resolved (secrets → ''). */
export function resolveWorkflowText(text: string, vars: Record<string, unknown>): string {
  if (!text.includes('{{')) return text
  return text.replace(TOKEN_RE, (whole, path: string) => {
    if (!isWorkflowPath(path, vars)) return whole
    if (path.split('.').some((seg) => isSensitiveKey(seg))) return ''
    const v = at(vars, path)
    if (v === undefined || v === null) return ''
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Does any string in `value` reference a run variable? */
export function hasWorkflowTokens(value: unknown, vars: Record<string, unknown>, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false
  if (typeof value === 'string') {
    if (!value.includes('{{')) return false
    for (const m of value.matchAll(TOKEN_RE)) if (isWorkflowPath(m[1], vars)) return true
    return false
  }
  if (Array.isArray(value)) return value.some((v) => hasWorkflowTokens(v, vars, depth + 1))
  if (isPlainObject(value)) return Object.values(value).some((v) => hasWorkflowTokens(v, vars, depth + 1))
  return false
}

/** Every string of `value` (deep; keys untouched) with run-variable tokens resolved. */
export function resolveWorkflowTokens<T>(value: T, vars: Record<string, unknown>, depth = 0): T {
  if (depth > MAX_DEPTH) return value
  if (typeof value === 'string') return resolveWorkflowText(value, vars) as unknown as T
  if (Array.isArray(value)) return value.map((v) => resolveWorkflowTokens(v, vars, depth + 1)) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveWorkflowTokens(v, vars, depth + 1)
    return out as T
  }
  return value
}

export interface TaskFormParts {
  fields: unknown
  form_layout?: unknown
  form_buttons?: unknown
}

/**
 * The task's form parts with run variables resolved, and the templates to
 * keep (null when nothing referenced a run variable: the task stores no
 * templates and opens exactly as before).
 */
export function resolveTaskForm(parts: TaskFormParts, vars: Record<string, unknown>): { resolved: TaskFormParts; templates: TaskFormParts | null } {
  if (!hasWorkflowTokens(parts, vars)) return { resolved: parts, templates: null }
  return { resolved: resolveWorkflowTokens(parts, vars), templates: parts }
}
