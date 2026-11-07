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
 *                              dates, arrays); {{form.<key>_item}} for lookups;
 *                              attachments: a list of file objects and
 *                              {{form.<key>_count}}
 *   {{form_id}} {{form_name}} {{form_version}}
 *   {{form_submission_id}} {{form_button}} {{form_outcome}} {{form_source}}
 *   {{submitted_by}} {{submitted_by_name}} {{submitted_by_email}}
 *   {{submitted_at}} {{task_id}} (task forms)
 *   {{submission.*}}           the submission metadata, one reserved object
 *                              (lib/forms/submission-meta.ts): id, reference,
 *                              submitted_at, submitted_by.{id,name,email},
 *                              form.{id,name,version}, source, url_params…
 *
 * A designer test run (Test runner) carries the same payload with
 * `form_source` = 'test' and a `test-…` submission id: nothing is stored.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { lookupItemKey, lookupLabelKey } from './lookup'
import { attachmentsCountKey } from './attachments'
import { includedContextSchema } from './form-params'
import { valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { customOutputSiblingKeys } from './custom-controls/output'
import { buildSubmissionMeta, submissionSurface, type SubmissionSurface } from './submission-meta'

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
  submission: { id: string; created_at: string; source: 'standalone' | 'task' | 'api' | 'test' | 'anonymous'; task_id?: string | null; button_id?: string | null; outcome?: string | null }
  submitter: { id: string | null; name?: string | null; email?: string | null; manager_id?: string | null }
  /** The surface people see (`submission.source`): the Run dialog's submissions are stored as standalone. */
  surface?: SubmissionSurface
  /** The form's URL query parameters as the server parsed them (`submission.url_params`). */
  url_params?: Record<string, unknown> | null
  /** The form's layout: parameters / variables marked "Include in submission" travel in `form` too. */
  layout?: unknown
}

/** The trigger's run variables (only the form's declared fields travel in `form`). */
export function buildFormSubmittedPayload(input: FormSubmittedPayloadInput): Record<string, unknown> {
  const form: Record<string, unknown> = {}
  for (const field of valueFields(input.fields)) {
    form[field.key] = input.values[field.key] ?? null
    if (field.type === 'lookup') form[lookupItemKey(field.key)] = input.values[lookupItemKey(field.key)] ?? (field.lookup?.multiple ? [] : null)
    if (field.type === 'lookup' && !(lookupLabelKey(field.key) in form) && Object.prototype.hasOwnProperty.call(input.values, lookupLabelKey(field.key))) form[lookupLabelKey(field.key)] = input.values[lookupLabelKey(field.key)]
    if (field.type === 'attachments') {
      const files = Array.isArray(input.values[field.key]) ? input.values[field.key] as unknown[] : []
      form[field.key] = files
      form[attachmentsCountKey(field.key)] = files.length
    }
    // Custom control outputs (lib/forms/custom-controls/output.ts): `<key>_raw` and the extras.
    for (const key of customOutputSiblingKeys(field)) form[key] = input.values[key] ?? null
  }
  for (const entry of includedContextSchema(input.layout, Object.keys(form))) {
    if (Object.prototype.hasOwnProperty.call(input.values, entry.key)) form[entry.key] = input.values[entry.key]
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
    submitted_by_name: input.submission.source === 'anonymous' ? 'Anonymous' : input.submitter.name ?? null,
    submitted_by_email: input.submitter.email ?? null,
    // Their manager in the workspace's reporting lines (null: none, or not signed in).
    submitted_by_manager_id: input.submitter.manager_id ?? null,
    submitted_at: input.submission.created_at,
    ...(input.submission.task_id ? { task_id: input.submission.task_id } : {}),
    submission: buildSubmissionMeta({
      id: input.submission.id,
      submitted_at: input.submission.created_at,
      submitter: input.submitter,
      form: input.form,
      source: input.surface ?? submissionSurface(input.submission.source),
      button_id: input.submission.button_id,
      outcome: input.submission.outcome,
      task_id: input.submission.task_id,
      url_params: input.url_params,
    }),
  }
}
