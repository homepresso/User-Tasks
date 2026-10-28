/**
 * The "Form submitted" trigger (node type `form_submitted`): starts a
 * workflow whenever a reusable form is submitted — on its own page
 * (/f/<id>), through the REST / MCP submit endpoints, or as the form of a
 * User Task. Its config names the form (`form_id`, remapped on import like
 * every form link) and optionally the buttons / outcomes that count
 * (`button_ids`, empty = any); a cached copy of the form's fields
 * (`fields`) lets the data picker type the payload without a database read.
 *
 * Run variables:
 *   {{form.<key>}}             every field, typed (numbers, booleans, ISO
 *                              dates, arrays); {{form.<key>_item}} for lookups
 *   {{form_id}} {{form_name}} {{form_version}}
 *   {{form_submission_id}} {{form_button}} {{form_outcome}} {{form_source}}
 *   {{submitted_by}} {{submitted_by_name}} {{submitted_by_email}}
 *   {{submitted_at}} {{task_id}} (task forms)
 *
 * A designer test run (Test runner) carries the same payload with
 * `form_source` = 'test' and a `test-…` submission id: nothing is stored.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { lookupItemKey } from './lookup'
import { valueFields, type TaskFieldDef } from '@/lib/task-field-schema'

export const FORM_SUBMITTED_TRIGGER = 'form_submitted'

export interface FormSubmittedTriggerConfig {
  form_id?: string
  form_name?: string
  /** Only submissions with one of these buttons (ids; outcome labels also match). Empty = any. */
  button_ids?: string[]
}

export function readFormSubmittedConfig(config: unknown): FormSubmittedTriggerConfig {
  const c = isPlainObject(config) ? config : {}
  const out: FormSubmittedTriggerConfig = {}
  if (typeof c.form_id === 'string' && c.form_id) out.form_id = c.form_id
  if (typeof c.form_name === 'string') out.form_name = c.form_name
  if (Array.isArray(c.button_ids)) out.button_ids = c.button_ids.map((b) => String(b ?? '').trim()).filter(Boolean).slice(0, 20)
  return out
}

/** Does a submission (its button id / outcome) match the trigger's filter? */
export function triggerMatchesButton(config: FormSubmittedTriggerConfig, submission: { button_id?: string | null; outcome?: string | null }): boolean {
  const wanted = config.button_ids ?? []
  if (!wanted.length) return true
  return wanted.some((b) => b === submission.button_id || (submission.outcome != null && b.toLowerCase() === submission.outcome.toLowerCase()))
}

export interface FormSubmittedPayloadInput {
  form: { id: string; name: string; version: number | null }
  fields: TaskFieldDef[]
  /** Validated, typed values (lookups' `<key>_item` included). */
  values: Record<string, unknown>
  submission: { id: string; created_at: string; source: 'standalone' | 'task' | 'api' | 'test'; task_id?: string | null; button_id?: string | null; outcome?: string | null }
  submitter: { id: string | null; name?: string | null; email?: string | null }
}

/** The trigger's run variables (only the form's declared fields travel in `form`). */
export function buildFormSubmittedPayload(input: FormSubmittedPayloadInput): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (const field of valueFields(input.fields)) {
    form[field.key] = input.values[field.key] ?? null
    if (field.type === 'lookup') form[lookupItemKey(field.key)] = input.values[lookupItemKey(field.key)] ?? (field.lookup?.multiple ? [] : null)
  }
  return {
    form,
    form_id: input.form.id,
    form_name: input.form.name,
    form_version: input.form.version,
    form_submission_id: input.submission.id,
    form_button: input.submission.button_id ?? null,
    form_outcome: input.submission.outcome ?? null,
    form_source: input.submission.source,
    submitted_by: input.submitter.id,
    submitted_by_name: input.submitter.name ?? null,
    submitted_by_email: input.submitter.email ?? null,
    submitted_at: input.submission.created_at,
    ...(input.submission.task_id ? { task_id: input.submission.task_id } : {}),
  }
}
