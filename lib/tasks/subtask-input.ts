/**
 * Subtask fields (create and edit): the one validation the service, the
 * REST / MCP / CLI surfaces, the Agent and the inline forms share. Pure (no
 * I/O) so the browser form can use the same limits.
 *
 * All fields but the title are optional:
 *  - title (required on create, at most SUBTASK_TITLE_MAX)
 *  - subtitle: a short summary under the title (tasks.subtitle)
 *  - description: plain text or HTML, sanitised like every task description
 *  - estimated_effort_minutes: whole minutes, 0…MAX_EFFORT_MINUTES (the same
 *    unit as tasks.actual_effort and the effort estimates); stored as the
 *    creator's (assigner's) estimate — tasks.estimated_effort_assigner
 *  - due_date: a date (ISO 8601 / yyyy-mm-dd), years 2000–2100
 *  - priority: a task priority (default on create: the parent's)
 *  - tags: up to SUBTASK_TAGS_MAX short labels
 *
 * `assignee_id` is reserved for assigning subtasks to other people (not
 * offered yet): a subtask goes to the parent's assignee, else its creator.
 */

import { sanitizeTaskDescription } from '@/lib/html-sanitize'
import { TASK_PRIORITY_VALUES } from '@/lib/task-fields'

export const SUBTASK_TITLE_MAX = 500
export const SUBTASK_SUBTITLE_MAX = 200
export const SUBTASK_DESCRIPTION_MAX = 20_000
export const SUBTASK_TAGS_MAX = 20
export const SUBTASK_TAG_MAX = 50
/** Largest estimate, in minutes (one year — the effort fields' limit). */
export const SUBTASK_EFFORT_MAX_MINUTES = 525_600
/** How many levels of subtasks a task can have below it (subtasks of subtasks…). */
export const SUBTASK_MAX_DEPTH = 4

export interface SubtaskInput {
  title?: string
  subtitle?: string | null
  description?: string | null
  estimated_effort_minutes?: number | null
  due_date?: string | null
  priority?: string | null
  tags?: string[] | null
}

/** Normalised values, ready to write (only the fields given). */
export interface SubtaskValues {
  title?: string
  subtitle?: string | null
  description?: string | null
  estimated_effort_assigner?: number | null
  due_date?: string | null
  priority?: string
  tags?: string[] | null
}

export type SubtaskValidation = { ok: true; values: SubtaskValues } | { ok: false; errors: Record<string, string> }

const blank = (value: unknown) => value === null || value === undefined || (typeof value === 'string' && !value.trim())

/**
 * Check and normalise subtask fields. `partial` (edit): only the fields
 * present are checked and returned, and the title may be left out (but not
 * emptied).
 */
export function validateSubtaskInput(input: SubtaskInput | null | undefined, options: { partial?: boolean } = {}): SubtaskValidation {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const has = (key: string) => raw[key] !== undefined
  const errors: Record<string, string> = {}
  const values: SubtaskValues = {}

  if (!options.partial || has('title')) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : ''
    if (!title) errors.title = 'Give the subtask a title'
    else if (title.length > SUBTASK_TITLE_MAX) errors.title = `A subtask title is at most ${SUBTASK_TITLE_MAX} characters`
    else values.title = title
  }

  if (has('subtitle')) {
    if (blank(raw.subtitle)) values.subtitle = null
    else if (typeof raw.subtitle !== 'string') errors.subtitle = 'subtitle must be text'
    else if (raw.subtitle.trim().length > SUBTASK_SUBTITLE_MAX) errors.subtitle = `A subtitle is at most ${SUBTASK_SUBTITLE_MAX} characters`
    else values.subtitle = raw.subtitle.trim().replace(/\s+/g, ' ')
  }

  if (has('description')) {
    if (blank(raw.description)) values.description = null
    else if (typeof raw.description !== 'string') errors.description = 'description must be text'
    else if (raw.description.length > SUBTASK_DESCRIPTION_MAX) errors.description = `A description is at most ${SUBTASK_DESCRIPTION_MAX.toLocaleString('en')} characters`
    else values.description = sanitizeTaskDescription(raw.description)
  }

  if (has('estimated_effort_minutes')) {
    const value = raw.estimated_effort_minutes
    if (value === null || value === '') values.estimated_effort_assigner = null
    else {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
      if (!Number.isInteger(n) || n < 0 || n > SUBTASK_EFFORT_MAX_MINUTES) {
        errors.estimated_effort_minutes = `The estimate is a whole number of minutes between 0 and ${SUBTASK_EFFORT_MAX_MINUTES}`
      } else values.estimated_effort_assigner = n === 0 ? null : n
    }
  }

  if (has('due_date')) {
    if (blank(raw.due_date)) values.due_date = null
    else {
      const due = typeof raw.due_date === 'string' ? new Date(raw.due_date) : new Date(NaN)
      const year = due.getUTCFullYear()
      if (Number.isNaN(due.getTime())) errors.due_date = 'due_date must be a date'
      else if (year < 2000 || year > 2100) errors.due_date = 'due_date must be between 2000 and 2100'
      else values.due_date = due.toISOString()
    }
  }

  if (has('priority') && raw.priority !== null) {
    if (!TASK_PRIORITY_VALUES.has(String(raw.priority))) errors.priority = `"${String(raw.priority)}" is not a valid task priority`
    else values.priority = String(raw.priority)
  }

  if (has('tags')) {
    if (raw.tags === null) values.tags = null
    else if (!Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== 'string')) errors.tags = 'tags must be a list of text labels'
    else {
      const tags = [...new Set((raw.tags as string[]).map((tag) => tag.trim()).filter(Boolean))]
      if (tags.length > SUBTASK_TAGS_MAX) errors.tags = `At most ${SUBTASK_TAGS_MAX} tags`
      else if (tags.some((tag) => tag.length > SUBTASK_TAG_MAX)) errors.tags = `A tag is at most ${SUBTASK_TAG_MAX} characters`
      else values.tags = tags.length ? tags : null
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values }
}

/** "1.5" / "1h 30m" / "90m" / "2h" → minutes (null when blank, NaN when unreadable). For the forms' estimate box. */
export function parseEffortInput(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 60)
  const match = value.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/)
  if (!match || (!match[1] && !match[2])) return NaN
  return Math.round(Number(match[1] ?? 0) * 60) + Number(match[2] ?? 0)
}

/** Minutes → the estimate box's text ("1.5" hours, or "" for none). */
export function effortInputText(minutes: number | null | undefined): string {
  if (!minutes) return ''
  const hours = minutes / 60
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100)
}

/** Task priorities, most urgent first (forms, the Agent). */
export const SUBTASK_PRIORITY_VALUES_LIST = ['critical', 'high', 'medium', 'low', 'none'] as const
