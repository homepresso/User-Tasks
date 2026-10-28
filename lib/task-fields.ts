/**
 * Field allowlists for dynamic task updates. Both `updateTaskField` (server
 * action, driven by inline UI editors) and the workflow engine's
 * `update_task` node previously wrote ANY column by name — including
 * tenant_id, assignee_id, event_id, and metadata — a mass-assignment hole.
 */

import { sanitizeTaskDescription } from './html-sanitize'

/** Fields the inline UI editors may set via updateTaskField. */
export const UPDATABLE_TASK_FIELDS = new Set([
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'progress_pct',
  'estimated_completion',
  'tags',
])

/** Fields a workflow `update_task` node may set (slightly wider: outcomes + reassignment). */
export const WORKFLOW_UPDATABLE_TASK_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'due_date',
  'progress_pct',
  'tags',
  'outcome',
  'outcome_notes',
  'assignee_id',
] as const

/**
 * Normalise an allowlisted field value before it is written: descriptions
 * may be HTML and are sanitised (lib/html-sanitize); other fields pass through.
 */
export function normalizeTaskFieldValue(field: string, value: unknown): unknown {
  if (field === 'description') return typeof value === 'string' ? sanitizeTaskDescription(value) : value
  return value
}

export const TASK_STATUS_VALUES = new Set(['draft', 'todo', 'in_progress', 'blocked', 'completed', 'cancelled'])
export const TASK_PRIORITY_VALUES = new Set(['critical', 'high', 'medium', 'low', 'none'])

/** Validate a value for an allowlisted field. Returns an error message or null. */
export function validateTaskFieldValue(field: string, value: unknown): string | null {
  if (field === 'status' && value != null && !TASK_STATUS_VALUES.has(String(value))) {
    return `"${value}" is not a valid task status`
  }
  if (field === 'priority' && value != null && !TASK_PRIORITY_VALUES.has(String(value))) {
    return `"${value}" is not a valid task priority`
  }
  if (field === 'progress_pct' && value != null && value !== '') {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 100) return 'progress_pct must be between 0 and 100'
  }
  return null
}
