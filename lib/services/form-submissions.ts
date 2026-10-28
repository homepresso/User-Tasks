/**
 * Submitting reusable forms: the standalone page (/f/<id>), the REST / MCP
 * submit endpoints and task forms; the submissions list / detail / CSV; the
 * button behaviours that have effects; and the "Form submitted" trigger.
 *
 * Permissions and attribution:
 *  - Submitting needs forms.submit (all system roles by default). The form
 *    is read from the workspace (latest version); the values are validated
 *    on the server like a task's (types, required, rules, people, lookups
 *    re-checked against their source) — never trusted from the client.
 *  - A button's "Start workflow" was configured by the form's author, who
 *    needed workflows.activate to add it (lib/services/forms). It runs as a
 *    system action in the form's workspace, attributed to the submitter
 *    (the run's `workflow_started_by`, `workflow_started_via` = form, an
 *    audit entry on the form), async on the queue — the submitter needs no
 *    workflow permission. "Form submitted" runs are attributed the same way.
 *  - Reads: everyone sees their own submissions; forms.edit sees all of the
 *    workspace's (the same rule as the form_submissions RLS policy).
 *  - Idempotent: a repeated `idempotency_key` returns the first
 *    submission's result instead of submitting again (double-click).
 *
 * Every submission (task forms included) is a form_submissions row — which
 * the event stream picks up as `form.submitted` — and queues the active
 * workflows whose "Form submitted" trigger names the form.
 */

import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import {
  interpolateButtonText, isSubmittingButton, normalizeFormButtons, planButtonEffects, resolveInputTemplate, safeRedirectUrl,
  type ButtonEffects, type FormButton,
} from '@/lib/forms/buttons'
import { buildFormSubmittedPayload, readFormSubmittedConfig, triggerMatchesButton, FORM_SUBMITTED_TRIGGER } from '@/lib/forms/submitted-trigger'
import { lookupItemKey } from '@/lib/forms/lookup'
import { valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, serviceRoleClient, type Page } from './_shared'
import { redirectPolicy, resolveThemeOverrides } from './forms'
import { withQueuedInitiator } from '@/lib/workflow-initiator'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables are not in the generated Database types */

const SUBMISSION_COLUMNS = 'id, form_id, form_version, form_name, source, task_id, button_id, outcome, submitted_by, values, result, created_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SubmitFormInput {
  values?: Record<string, unknown> | null
  /** The button pressed (default: the first submitting button). */
  button_id?: string | null
  /** Same key → the same submission (double-click / retries). */
  idempotency_key?: string | null
}

export interface StartedRun {
  workflow_id: string
  workflow_name?: string | null
  job_id?: string
  status: 'queued' | 'failed'
  error?: string
}

export interface SubmitFormResult {
  submission: { id: string; created_at: string; form_id: string; form_version: number | null; button_id: string | null; outcome: string | null }
  effects: ButtonEffects
  runs: StartedRun[]
  /** True when the idempotency key matched an earlier submission. */
  replayed?: boolean
}

/* ── Loading the form ────────────────────────────────────────────────── */

async function loadForm(db: AnySupabaseClient, tenantId: string, formId: string) {
  if (!UUID_RE.test(formId)) throw ServiceError.notFound('Form not found')
  const { data, error } = await (db as any).from('forms').select('id, name, description, fields, layout, theme, buttons, header, version').eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  return data as Record<string, any>
}

/**
 * The form as its standalone page draws it: definition, resolved theme,
 * buttons (defaults when none are stored) and header. forms.submit.
 */
export async function getSubmittableForm(ctx: ServiceContext, formId: string) {
  requirePerm(ctx, 'forms.submit')
  const db = await serviceRoleClient(ctx)
  const row = await loadForm(db, ctx.tenantId, formId)
  const def = normalizeFormDefinition(row)
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description ?? null) as string | null,
    version: Number(row.version),
    fields: def.fields,
    layout: def.layout,
    theme_overrides: await resolveThemeOverrides(db, ctx.tenantId, def.theme),
    buttons: normalizeFormButtons(def.buttons ?? null),
    header: def.header ?? null,
  }
}

/* ── Button actions with effects ─────────────────────────────────────── */

/** A context for the system actions a form performs on behalf of its submitter. */
function systemContext(ctx: ServiceContext, db: AnySupabaseClient): ServiceContext {
  return { db, supabase: db, tenantId: ctx.tenantId, actorId: ctx.actorId, permissions: null, authKind: 'job', source: 'job' }
}

/**
 * Run a button's "Start workflow" actions (in order) and plan what the user
 * sees. Inputs map form values (`{{field}}`, `{{form.field}}`, lookups'
 * `{{field_item}}`) to the workflow's inputs; each run is queued with the
 * submitter as `workflow_started_by` (signed) and `form_submission_id`. A failed
 * start is reported (and audited), not thrown — the submission stands.
 */
export async function runButtonActions(
  ctx: ServiceContext,
  db: AnySupabaseClient,
  input: { button: FormButton; values: Record<string, unknown>; form: { id: string; name: string }; submissionId: string | null; taskId?: string | null },
): Promise<{ runs: StartedRun[]; effects: ButtonEffects }> {
  const runs: StartedRun[] = []
  const starts = (input.button.actions ?? []).filter((a) => a.type === 'start_workflow' && a.workflow_id)
  if (starts.length) {
    const { startWorkflow } = await import('./workflow-start')
    const sys = systemContext(ctx, db)
    for (const action of starts) {
      const scope = { values: input.values, extras: { submission_id: input.submissionId, task_id: input.taskId ?? null } }
      const variables: Record<string, unknown> = {}
      for (const [name, template] of Object.entries(action.inputs ?? {})) variables[name] = resolveInputTemplate(template, scope)
      try {
        const result = await startWorkflow(sys, {
          workflow_id: action.workflow_id!,
          variables: { ...variables, form_submission_id: input.submissionId, form_id: input.form.id },
          async: true,
        }, { via: 'form' })
        runs.push({ workflow_id: action.workflow_id!, workflow_name: action.workflow_name ?? null, job_id: result.mode === 'async' ? result.job_id : undefined, status: 'queued' })
        void audit(ctx, {
          objectType: 'form', objectId: input.form.id, action: 'execute',
          summary: `Form "${input.form.name}" started workflow "${action.workflow_name ?? action.workflow_id}"`,
          metadata: { workflow_id: action.workflow_id, job_id: result.mode === 'async' ? result.job_id : null, submission_id: input.submissionId, task_id: input.taskId ?? null, on_behalf_of: ctx.actorId },
        })
      } catch (error) {
        const message = error instanceof ServiceError ? error.message : 'The workflow could not be started'
        runs.push({ workflow_id: action.workflow_id!, workflow_name: action.workflow_name ?? null, status: 'failed', error: message })
        void audit(ctx, {
          objectType: 'form', objectId: input.form.id, action: 'execute',
          summary: `Form "${input.form.name}" could not start workflow "${action.workflow_name ?? action.workflow_id}"`,
          metadata: { workflow_id: action.workflow_id, error: message, submission_id: input.submissionId },
        })
      }
    }
  }
  const queued = runs.filter((r) => r.job_id).map((r) => r.job_id!.slice(0, 8))
  const effects = planButtonEffects(input.button, {
    values: input.values,
    extras: { run_reference: queued.join(', '), submission_id: input.submissionId ? input.submissionId.slice(0, 8) : '' },
  }, redirectPolicy())
  const failed = runs.filter((r) => r.status === 'failed')
  if (failed.length) effects.messages.push({ text: `${failed.length === 1 ? 'A follow-up workflow' : `${failed.length} follow-up workflows`} could not be started: ${failed.map((r) => r.error).join('; ')}`, tone: 'info' })
  return { runs, effects }
}

/* ── The "Form submitted" trigger ────────────────────────────────────── */

/**
 * Queue the active workflows whose `form_submitted` trigger names this form
 * (and, when it filters, this button / outcome). Published versions' nodes
 * decide; the run starts on that version. Never throws.
 */
export async function enqueueFormSubmittedWorkflows(db: AnySupabaseClient, tenantId: string, payload: Record<string, unknown>): Promise<number> {
  try {
    const { data: workflows } = await (db as any).from('workflows')
      .select('id, nodes, published_version_id').eq('tenant_id', tenantId).eq('is_active', true).eq('trigger_type', FORM_SUBMITTED_TRIGGER)
    const rows = (workflows ?? []) as any[]
    if (!rows.length) return 0
    const versionIds = rows.map((w) => w.published_version_id).filter(Boolean)
    const versionNodes = new Map<string, unknown>()
    if (versionIds.length) {
      const { data: versions } = await (db as any).from('workflow_versions').select('id, nodes').in('id', versionIds)
      for (const v of (versions ?? []) as any[]) versionNodes.set(v.id, v.nodes)
    }
    const jobs: Array<{ workflow_id: string; trigger_type: string; trigger_data: Record<string, unknown> }> = []
    for (const wf of rows) {
      const nodes = (wf.published_version_id && Array.isArray(versionNodes.get(wf.published_version_id)) ? versionNodes.get(wf.published_version_id) : wf.nodes) as any[]
      const trigger = (Array.isArray(nodes) ? nodes : []).find((n) => n?.type === FORM_SUBMITTED_TRIGGER)
      if (!trigger) continue
      const config = readFormSubmittedConfig(trigger.config)
      if (config.form_id !== payload.form_id) continue
      if (!triggerMatchesButton(config, { button_id: payload.form_button as string | null, outcome: payload.form_outcome as string | null })) continue
      // The submitter starts the run (payload.submitted_by is the server's, never the client's).
      const triggerData = { _version_id: wf.published_version_id ?? null, ...payload }
      jobs.push({
        workflow_id: wf.id,
        trigger_type: FORM_SUBMITTED_TRIGGER,
        trigger_data: withQueuedInitiator(triggerData, { tenantId, workflowId: wf.id }, { userId: typeof payload.submitted_by === 'string' ? payload.submitted_by : null, via: 'form' }),
      })
    }
    if (!jobs.length) return 0
    const { error } = await (db as any).rpc('enqueue_workflow_batch', { p_tenant_id: tenantId, p_jobs: jobs })
    if (error) {
      for (const job of jobs) {
        await (db as any).rpc('enqueue_workflow', { p_workflow_id: job.workflow_id, p_tenant_id: tenantId, p_task_id: null, p_trigger_type: job.trigger_type, p_trigger_data: job.trigger_data, p_priority: 0, p_delay_seconds: 0 })
      }
    }
    const { kickQueueProcessor } = await import('@/lib/process-queue')
    kickQueueProcessor()
    return jobs.length
  } catch (error) {
    console.warn('[forms] form_submitted trigger enqueue failed:', error instanceof Error ? error.message : error)
    return 0
  }
}

async function submitter(db: AnySupabaseClient, userId: string | null): Promise<{ id: string | null; name: string | null; email: string | null }> {
  if (!userId) return { id: null, name: null, email: null }
  const { data } = await (db as any).from('users').select('id, display_name, email').eq('id', userId).maybeSingle()
  return { id: userId, name: data?.display_name ?? null, email: data?.email ?? null }
}

/** Values stored for a submission: the form's value fields (and lookups' items), nothing else. */
function storedValues(fields: TaskFieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of valueFields(fields)) {
    if (Object.prototype.hasOwnProperty.call(values, field.key)) out[field.key] = values[field.key]
    if (field.type === 'lookup' && Object.prototype.hasOwnProperty.call(values, lookupItemKey(field.key))) out[lookupItemKey(field.key)] = values[lookupItemKey(field.key)]
  }
  return out
}

/* ── Submitting ──────────────────────────────────────────────────────── */

function presentSubmission(row: Record<string, any>): SubmitFormResult['submission'] {
  return { id: row.id, created_at: row.created_at, form_id: row.form_id, form_version: row.form_version ?? null, button_id: row.button_id ?? null, outcome: row.outcome ?? null }
}

/** The form, its definition and the pressed (submitting) button: forms.submit. */
async function loadSubmission(ctx: ServiceContext, formId: string, input: { button_id?: string | null }) {
  requirePerm(ctx, 'forms.submit')
  const db = await serviceRoleClient(ctx)
  const row = await loadForm(db, ctx.tenantId, formId)
  const def = normalizeFormDefinition(row)
  const buttons = normalizeFormButtons(def.buttons ?? null)
  const button = input.button_id ? buttons.find((b) => b.id === input.button_id) : buttons.find(isSubmittingButton)
  if (!button) throw ServiceError.validation(`The form has no button "${String(input.button_id).slice(0, 40)}"`)
  if (!isSubmittingButton(button)) throw ServiceError.validation(`"${button.label}" does not submit the form`)
  return { db, row, def, button }
}

/** Validate like a task: types, required, rules, people, lookups (scoped to this form + submitter). */
async function checkSubmissionValues(ctx: ServiceContext, db: AnySupabaseClient, formId: string, fields: TaskFieldDef[], raw: unknown): Promise<Record<string, unknown>> {
  const { formLookupScope } = await import('./form-lookup')
  const scope = formLookupScope(formId, ctx.actorId)
  const { errors, templateValues } = await mergeTaskFieldValuesChecked(db, ctx.tenantId, { fields, template_values: {} }, isPlainObject(raw) ? raw : {}, { taskId: scope })
  if (Object.keys(errors).length) throw ServiceError.validation(`Invalid field values: ${Object.values(errors).join('; ')}`, { fields: errors })
  return storedValues(fields, templateValues)
}

/**
 * Submit a reusable form (standalone page, REST, MCP): forms.submit, the
 * values validated on the server, one form_submissions row, the button's
 * workflows started for the submitter, the "Form submitted" trigger fired.
 */
export async function submitForm(ctx: ServiceContext, formId: string, input: SubmitFormInput, options: { source?: 'standalone' | 'api' } = {}): Promise<SubmitFormResult> {
  const { db, row, def, button } = await loadSubmission(ctx, formId, input)
  const key = typeof input.idempotency_key === 'string' && input.idempotency_key.trim() ? input.idempotency_key.trim().slice(0, 100) : null
  if (key && key.length < 8) throw ServiceError.validation('idempotency_key must be 8-100 characters')

  if (key) {
    const replay = await findReplay(db, ctx, key, formId)
    if (replay) return replay
  }

  const values = await checkSubmissionValues(ctx, db, formId, def.fields, input.values)

  const { data: inserted, error } = await (db as any).from('form_submissions').insert({
    tenant_id: ctx.tenantId,
    form_id: formId,
    form_version: row.version ?? null,
    form_name: row.name,
    source: options.source ?? 'standalone',
    button_id: button.id,
    outcome: button.kind === 'outcome' ? (button.outcome ?? button.label) : null,
    submitted_by: ctx.actorId,
    values,
    idempotency_key: key,
  }).select(SUBMISSION_COLUMNS).single()
  if (error?.code === '23505' && key) {
    const replay = await findReplay(db, ctx, key, formId)
    if (replay) return replay
  }
  if (error || !inserted) throw dbError(error, 'Failed to store the submission')

  const { runs, effects } = await runButtonActions(ctx, db, { button, values, form: { id: formId, name: row.name }, submissionId: inserted.id })
  const who = await submitter(db, ctx.actorId)
  const payload = buildFormSubmittedPayload({
    form: { id: formId, name: row.name, version: row.version ?? null },
    fields: def.fields,
    values,
    submission: { id: inserted.id, created_at: inserted.created_at, source: inserted.source, button_id: inserted.button_id, outcome: inserted.outcome },
    submitter: who,
  })
  const triggered = await enqueueFormSubmittedWorkflows(db, ctx.tenantId, payload)
  await (db as any).from('form_submissions').update({ result: { runs, effects, triggered } }).eq('id', inserted.id).eq('tenant_id', ctx.tenantId)
  return { submission: presentSubmission(inserted), effects, runs }
}

/** A log line of a test submission (what the real one would have done). */
export interface TestSubmissionLog { level: 'info' | 'warn'; message: string; metadata?: Record<string, unknown> }

/**
 * A designer TEST submission of a form (the Test runner's form start): the
 * same permission, button and value checks as submitForm and the payload
 * the "Form submitted" trigger would get — with `form_source` = 'test' and a
 * `test-…` submission id — but nothing happens: no form_submissions row (so
 * no `form.submitted` event), no other workflow's trigger fired, no button
 * "Start workflow" run. What the button would do is described in `logs`.
 * `trigger` is the tested workflow's trigger config: a button it does not
 * listen to is refused (a real submission would not start the workflow).
 */
export async function planTestSubmission(ctx: ServiceContext, formId: string, input: { values?: Record<string, unknown> | null; button_id?: string | null }, trigger: { button_ids?: string[] } = {}): Promise<{ payload: Record<string, unknown>; logs: TestSubmissionLog[]; effects: ButtonEffects }> {
  const { db, row, def, button } = await loadSubmission(ctx, formId, input)
  if (!triggerMatchesButton(trigger, { button_id: button.id, outcome: button.kind === 'outcome' ? (button.outcome ?? button.label) : null })) {
    throw ServiceError.validation(`A real "${button.label}" submission would not start this workflow: its trigger only listens to ${trigger.button_ids!.map((b) => `"${b}"`).join(', ')}`)
  }
  const values = await checkSubmissionValues(ctx, db, formId, def.fields, input.values)
  const who = await submitter(db, ctx.actorId)
  const submissionId = `test-${crypto.randomUUID()}`
  const payload = buildFormSubmittedPayload({
    form: { id: formId, name: row.name, version: row.version ?? null },
    fields: def.fields,
    values,
    submission: { id: submissionId, created_at: new Date().toISOString(), source: 'test', button_id: button.id, outcome: button.kind === 'outcome' ? (button.outcome ?? button.label) : null },
    submitter: who,
  })
  const scope = { values, extras: { run_reference: '(test run)', submission_id: 'test' } }
  const logs: TestSubmissionLog[] = [{
    level: 'info',
    message: `Test submission of "${row.name}" with "${button.label}": nothing is stored, no other workflow is triggered, no form.submitted event`,
    metadata: { form: payload.form, form_button: payload.form_button, form_version: payload.form_version },
  }]
  const policy = redirectPolicy()
  for (const action of button.actions ?? []) {
    if (action.type === 'start_workflow') {
      const inputs: Record<string, unknown> = {}
      for (const [name, template] of Object.entries(action.inputs ?? {})) inputs[name] = resolveInputTemplate(template, scope)
      logs.push({ level: 'info', message: `Would start workflow "${action.workflow_name ?? action.workflow_id}" (not started in a test)`, metadata: { workflow_id: action.workflow_id, inputs } })
    } else if (action.type === 'message') {
      logs.push({ level: 'info', message: `Would show the message "${interpolateButtonText(action.text, scope)}"` })
    } else if (action.type === 'success_screen') {
      const text = interpolateButtonText(action.text, scope)
      logs.push({ level: 'info', message: `Would show the success screen "${interpolateButtonText(action.title, scope)}"${text ? `: ${text}` : ''}` })
    } else if (action.type === 'redirect') {
      const url = safeRedirectUrl(action.url, policy)
      logs.push(url ? { level: 'info', message: `Would redirect to ${url}` } : { level: 'warn', message: `Would not redirect: "${action.url ?? ''}" is not an allowed address` })
    } else if (action.type === 'close') {
      logs.push({ level: 'info', message: 'Would close the form' })
    }
  }
  if (!(button.actions ?? []).length) logs.push({ level: 'info', message: 'Would stay on the form, cleared, with "Submitted."' })
  const effects = planButtonEffects(button, scope, policy)
  return { payload, logs, effects }
}

async function findReplay(db: AnySupabaseClient, ctx: ServiceContext, key: string, formId: string): Promise<SubmitFormResult | null> {
  const { data } = await (db as any).from('form_submissions').select(SUBMISSION_COLUMNS).eq('tenant_id', ctx.tenantId).eq('idempotency_key', key).maybeSingle()
  if (!data) return null
  if (data.form_id !== formId || (data.submitted_by ?? null) !== (ctx.actorId ?? null)) throw ServiceError.conflict('That idempotency key was used for another submission')
  const result = isPlainObject(data.result) ? data.result : {}
  return {
    submission: presentSubmission(data),
    effects: (isPlainObject(result.effects) ? result.effects : { messages: [] }) as ButtonEffects,
    runs: Array.isArray(result.runs) ? result.runs as StartedRun[] : [],
    replayed: true,
  }
}

/**
 * A task form linked to a reusable form was completed (every surface goes
 * through recordTaskResponse): record the submission and fire the trigger.
 * Never throws — the task completion stands.
 */
export async function recordTaskFormSubmission(db: AnySupabaseClient, input: {
  tenantId: string
  task: Record<string, any>
  userId: string | null
  outcome: string | null
  values: Record<string, unknown>
  buttonId?: string | null
}): Promise<{ submission_id: string } | null> {
  try {
    const meta = (input.task.metadata ?? {}) as Record<string, any>
    const ref = isPlainObject(meta.form_ref) ? meta.form_ref : null
    const formId = typeof ref?.form_id === 'string' ? ref.form_id : null
    if (!formId) return null
    const fields = normalizeFormDefinition({ fields: meta.fields }).fields
    const values = storedValues(fields, input.values)
    const { data: inserted, error } = await (db as any).from('form_submissions').insert({
      tenant_id: input.tenantId,
      form_id: formId,
      form_version: Number.isInteger(ref?.version) ? ref!.version : null,
      form_name: String(ref?.name ?? 'Form'),
      source: 'task',
      task_id: input.task.id,
      button_id: input.buttonId ?? null,
      outcome: input.outcome,
      submitted_by: input.userId,
      values,
    }).select(SUBMISSION_COLUMNS).single()
    if (error || !inserted) {
      // The form may have been deleted since the task was created.
      if (error && error.code !== '23503') console.warn('[forms] task form submission not recorded:', error.message)
      return null
    }
    const who = await submitter(db, input.userId)
    const payload = buildFormSubmittedPayload({
      form: { id: formId, name: inserted.form_name, version: inserted.form_version },
      fields,
      values,
      submission: { id: inserted.id, created_at: inserted.created_at, source: 'task', task_id: input.task.id, button_id: inserted.button_id, outcome: inserted.outcome },
      submitter: who,
    })
    await enqueueFormSubmittedWorkflows(db, input.tenantId, payload)
    return { submission_id: inserted.id }
  } catch (error) {
    console.warn('[forms] task form submission failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/* ── Reads ───────────────────────────────────────────────────────────── */

export interface SubmissionFilters {
  form_id?: string
  submitted_by?: string
  button_id?: string
  source?: 'standalone' | 'task' | 'api'
  since?: string
  until?: string
}

/** Everyone sees their own; forms.edit sees the workspace's (as the RLS policy). */
function scopedQuery(ctx: ServiceContext, db: AnySupabaseClient, columns: string, filters: SubmissionFilters, count = true) {
  requirePerm(ctx, 'forms.submit')
  let query = (db as any).from('form_submissions').select(columns, count ? { count: 'exact' } : undefined).eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false })
  const seeAll = hasPerm(ctx, 'forms.edit')
  if (!seeAll) {
    if (!ctx.actorId) throw ServiceError.forbidden("Forbidden: listing other people's submissions needs the 'forms.edit' permission")
    query = query.eq('submitted_by', ctx.actorId)
  }
  if (filters.form_id) {
    if (!UUID_RE.test(filters.form_id)) throw ServiceError.validation('form_id must be a uuid')
    query = query.eq('form_id', filters.form_id)
  }
  if (filters.submitted_by) {
    if (!UUID_RE.test(filters.submitted_by)) throw ServiceError.validation('submitted_by must be a uuid')
    query = query.eq('submitted_by', filters.submitted_by)
  }
  if (filters.button_id) query = query.eq('button_id', String(filters.button_id).slice(0, 40))
  if (filters.source) query = query.eq('source', filters.source)
  if (filters.since) query = query.gte('created_at', filters.since)
  if (filters.until) query = query.lte('created_at', filters.until)
  return query
}

export async function listFormSubmissions(ctx: ServiceContext, filters: SubmissionFilters, page: Page) {
  const db = await serviceRoleClient(ctx)
  const { data, count, error } = await applyPage(scopedQuery(ctx, db, SUBMISSION_COLUMNS, filters), page)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const names = await userNames(db, rows.map((r) => r.submitted_by))
  const submissions = rows.map((r) => ({ ...r, submitted_by_name: names.get(r.submitted_by) ?? null }))
  return { submissions, total: (count ?? submissions.length) as number }
}

export async function getFormSubmission(ctx: ServiceContext, submissionId: string) {
  if (!UUID_RE.test(submissionId)) throw ServiceError.notFound('Submission not found')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await scopedQuery(ctx, db, SUBMISSION_COLUMNS, {}, false).eq('id', submissionId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Submission not found')
  const names = await userNames(db, [data.submitted_by])
  return { ...data, submitted_by_name: names.get(data.submitted_by) ?? null }
}

async function userNames(db: AnySupabaseClient, ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('users').select('id, display_name, email').in('id', unique)
  for (const u of (data ?? []) as any[]) out.set(u.id, u.display_name || u.email || u.id)
  return out
}

const CSV_MAX_ROWS = 50_000

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  // Spreadsheet formula injection: a leading = + - @ (or tab / CR) is quoted as text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Submissions as CSV (one column per field of the form; background job). */
export async function formSubmissionsCsv(ctx: ServiceContext, filters: SubmissionFilters): Promise<{ csv: string; rows: number; file_name: string }> {
  if (!filters.form_id) throw ServiceError.validation('Choose the form to export')
  const db = await serviceRoleClient(ctx)
  const form = await loadForm(db, ctx.tenantId, filters.form_id)
  const fields = valueFields(normalizeFormDefinition(form).fields)
  const rows: any[] = []
  for (let offset = 0; offset < CSV_MAX_ROWS; offset += 1000) {
    const { data, error } = await scopedQuery(ctx, db, SUBMISSION_COLUMNS, filters, false).range(offset, offset + 999)
    if (error) throw dbError(error)
    rows.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  const names = await userNames(db, rows.map((r) => r.submitted_by))
  const header = ['submission_id', 'submitted_at', 'submitted_by', 'source', 'button', 'outcome', 'task_id', ...fields.map((f) => f.key)]
  const lines = [header.map(csvCell).join(',')]
  for (const r of rows) {
    const values = isPlainObject(r.values) ? r.values : {}
    lines.push([r.id, r.created_at, names.get(r.submitted_by) ?? r.submitted_by ?? '', r.source, r.button_id ?? '', r.outcome ?? '', r.task_id ?? '', ...fields.map((f) => values[f.key])].map(csvCell).join(','))
  }
  const slug = String(form.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'form'
  return { csv: `${lines.join('\n')}\n`, rows: rows.length, file_name: `${slug}-submissions.csv` }
}
