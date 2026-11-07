/**
 * Submission metadata: who submitted a form, when, from where — one object
 * under ONE reserved run variable, `submission`, wherever a form starts or
 * feeds a workflow:
 *
 *   {{submission.id}}                 the form_submissions row id (null for a
 *                                     start form, which stores no row)
 *   {{submission.reference}}          the short reference people see (the
 *                                     first 8 characters of the id, as the
 *                                     Submitted page's {{submission_id}})
 *   {{submission.submitted_at}}       ISO 8601
 *   {{submission.submitted_by.id}}    .name  .email
 *   {{submission.form.id}}            .name  .version
 *   {{submission.source}}             page | run_dialog | api | task | test | anonymous
 *   {{submission.button}}             the button pressed (id)
 *   {{submission.outcome}}            an outcome button's / task's outcome
 *   {{submission.task_id}}            task forms
 *   {{submission.url_params}}         the form's URL query parameters, as
 *                                     declared and re-validated by the server
 *                                     (run variables only: parameters are not
 *                                     stored unless marked "Include in
 *                                     submission", so stored views show {})
 *
 * Why one object at the top level: field values travel under `form.<key>`
 * (Form submitted trigger) or as the workflow's inputs (start forms), and a
 * custom control's outputs add `<key>_raw` / `<key>_text` / `<key>_parts`…
 * siblings there — a single top-level `submission` can never collide with a
 * field key or a control extra. The engine treats it as reserved (a data
 * table read never copies a column over it).
 *
 * Server-set only: every builder below takes the server's own values (the
 * stored row, the signed-in actor, the server clock). Variables a client
 * sends are passed through `stripSubmissionMeta` first, so a forged
 * `submission` is dropped and replaced, never merged.
 *
 * The older flat variables ({{submitted_by_name}}, {{form_submission_id}},
 * {{form_source}}…) stay for existing workflows.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

/** The reserved run variable. */
export const SUBMISSION_META_KEY = 'submission'

/** Where a submission came from (what people see; the stored row keeps standalone / api / task). */
export type SubmissionSurface = 'page' | 'run_dialog' | 'api' | 'task' | 'test' | 'anonymous'
export const SUBMISSION_SURFACES: SubmissionSurface[] = ['page', 'run_dialog', 'api', 'task', 'test', 'anonymous']

/**
 * Who an anonymous submission (a public form link, /p/<token>) was made by:
 * nobody signed in. Always set by the server from the stored source, never
 * from anything the visitor sent.
 */
export const ANONYMOUS_SUBMITTER = { id: null, name: 'Anonymous', email: null } as const

export interface SubmissionMeta {
  id: string | null
  reference: string | null
  submitted_at: string
  submitted_by: { id: string | null; name: string | null; email: string | null }
  form: { id: string | null; name: string | null; version: number | null }
  source: SubmissionSurface
  button: string | null
  outcome: string | null
  task_id: string | null
  url_params: Record<string, unknown>
}

/** The fields of the metadata, for the data picker, docs and the API notes. */
export const SUBMISSION_META_FIELDS: Array<{ name: string; type: 'string' | 'number' | 'object'; description: string; fields?: Array<{ name: string; type: 'string' | 'number'; description: string }> }> = [
  { name: 'id', type: 'string', description: 'Submission id (empty for a start form)' },
  { name: 'reference', type: 'string', description: 'Short reference people see (first 8 characters of the id)' },
  { name: 'submitted_at', type: 'string', description: 'When it was submitted (ISO 8601, server time)' },
  {
    name: 'submitted_by', type: 'object', description: 'Who submitted it',
    fields: [
      { name: 'id', type: 'string', description: 'User id' },
      { name: 'name', type: 'string', description: 'Display name' },
      { name: 'email', type: 'string', description: 'Email' },
    ],
  },
  {
    name: 'form', type: 'object', description: 'The form',
    fields: [
      { name: 'id', type: 'string', description: 'Form id' },
      { name: 'name', type: 'string', description: 'Form name' },
      { name: 'version', type: 'number', description: 'Form version submitted' },
    ],
  },
  { name: 'source', type: 'string', description: 'page, run_dialog, api, task, test or anonymous' },
  { name: 'button', type: 'string', description: 'Button pressed (id)' },
  { name: 'outcome', type: 'string', description: 'Outcome of an outcome button / task' },
  { name: 'task_id', type: 'string', description: 'The task (task forms)' },
  { name: 'url_params', type: 'object', description: 'URL query parameters the form declares (validated)' },
]

export const SUBMISSION_SOURCE_LABELS: Record<SubmissionSurface, string> = {
  page: 'Form page', run_dialog: 'Run dialog', api: 'API / MCP', task: 'Task form', test: 'Test run', anonymous: 'Public link (anonymous)',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The short reference shown to people: the first 8 characters of a stored submission's id ('test' for a test). */
export function submissionReference(id: string | null | undefined): string | null {
  if (!id) return null
  if (id.startsWith('test-')) return 'test'
  return UUID_RE.test(id) ? id.slice(0, 8) : null
}

/**
 * The surface from the stored row: `source` (standalone / api / task) and
 * the server's `result.surface` (run_dialog when the Run dialog submitted).
 */
export function submissionSurface(source: unknown, surface?: unknown): SubmissionSurface {
  if (source === 'task') return 'task'
  if (source === 'api') return 'api'
  if (source === 'test') return 'test'
  if (source === 'anonymous') return 'anonymous'
  if (surface === 'run_dialog') return 'run_dialog'
  return 'page'
}

/** URL query parameters of a form context (only the layout's `source: url` declarations; values as the server parsed them). */
export function urlParamsOf(layout: unknown, params: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const declared = isPlainObject(layout) && Array.isArray(layout.params) ? layout.params as unknown[] : []
  const out: Record<string, unknown> = {}
  if (!params) return out
  for (const p of declared) {
    if (!isPlainObject(p) || p.source !== 'url' || typeof p.name !== 'string') continue
    if (Object.prototype.hasOwnProperty.call(params, p.name)) out[p.name] = params[p.name]
  }
  return out
}

export interface SubmissionMetaInput {
  id: string | null
  submitted_at: string
  submitter: { id: string | null; name?: string | null; email?: string | null }
  form: { id: string | null; name: string | null; version: number | null }
  source: SubmissionSurface
  button_id?: string | null
  outcome?: string | null
  task_id?: string | null
  url_params?: Record<string, unknown> | null
}

export function buildSubmissionMeta(input: SubmissionMetaInput): SubmissionMeta {
  return {
    id: input.id,
    reference: submissionReference(input.id),
    submitted_at: input.submitted_at,
    // Anonymous: always "Anonymous", whatever submitter was passed (there is no user).
    submitted_by: input.source === 'anonymous' ? { ...ANONYMOUS_SUBMITTER } : { id: input.submitter.id ?? null, name: input.submitter.name ?? null, email: input.submitter.email ?? null },
    form: { id: input.form.id, name: input.form.name, version: input.form.version ?? null },
    source: input.source,
    button: input.button_id ?? null,
    outcome: input.outcome ?? null,
    task_id: input.task_id ?? null,
    url_params: { ...(input.url_params ?? {}) },
  }
}

/** A stored form_submissions row (+ the submitter's profile) → its metadata (views, exports, API, Home). */
export function submissionMetaFromRow(row: Record<string, unknown>, user?: { name?: string | null; email?: string | null } | null): SubmissionMeta {
  const result = isPlainObject(row.result) ? row.result : {}
  return buildSubmissionMeta({
    id: typeof row.id === 'string' ? row.id : null,
    submitted_at: String(row.created_at ?? row.submitted_at ?? ''),
    submitter: { id: typeof row.submitted_by === 'string' ? row.submitted_by : null, name: user?.name ?? null, email: user?.email ?? null },
    form: { id: typeof row.form_id === 'string' ? row.form_id : null, name: typeof row.form_name === 'string' ? row.form_name : null, version: typeof row.form_version === 'number' ? row.form_version : null },
    source: submissionSurface(row.source, result.surface),
    button_id: typeof row.button_id === 'string' ? row.button_id : null,
    outcome: typeof row.outcome === 'string' ? row.outcome : null,
    task_id: typeof row.task_id === 'string' ? row.task_id : null,
    // URL parameters are not stored with a submission (lib/forms/form-params: only "Include in submission" ones, as values).
    url_params: {},
  })
}

/** Variables a client sent, without the reserved `submission` (a forged one is dropped, never merged). */
export function stripSubmissionMeta<T extends Record<string, unknown>>(variables: T | null | undefined): T {
  if (!variables || !Object.prototype.hasOwnProperty.call(variables, SUBMISSION_META_KEY)) return (variables ?? {}) as T
  const out = { ...variables }
  delete out[SUBMISSION_META_KEY]
  return out
}

/** Variables with the server's metadata set (replacing whatever was there). */
export function withSubmissionMeta<T extends Record<string, unknown>>(variables: T, meta: SubmissionMeta): T & { submission: SubmissionMeta } {
  return { ...stripSubmissionMeta(variables), [SUBMISSION_META_KEY]: meta } as T & { submission: SubmissionMeta }
}
