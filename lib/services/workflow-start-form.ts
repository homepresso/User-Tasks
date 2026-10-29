/**
 * The form a workflow starts from (lib/forms/workflow-start-form.ts), for
 * the designer's Test runner and the Run dialog, the test submission of a
 * "Form submitted" workflow, and the forms that start a workflow (their
 * page links).
 *
 *  - getWorkflowStartForm: `draft` (Test runner; workflows.edit) reads the
 *    draft the test runs; otherwise (Run dialog; workflows.view) the
 *    published version the run uses. A linked form is read as its own page
 *    draws it (forms.submit — without it the plain fields are used).
 *  - prepareTestFormRun: the tested workflow's own trigger config decides
 *    the form and the button filter (never the request); the values are
 *    checked like a real submission and nothing is stored or triggered.
 *  - prepareTestStart: every designer test START goes through it — a
 *    "Form submitted" workflow only starts from a test submission of its
 *    form (never from plain variables: "needs form input"), a start-form
 *    workflow only with values that pass its form's checks.
 *  - getWorkflowFormEntries: the trigger's form, every form whose button
 *    "Start workflow" action starts this workflow (forms.view for those) and
 *    the start form's form page ("Publish as form page", ./form-pages).
 */

import { hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { authorizeWorkflowAccess } from './workflow-designer-runs'
import { resolveThemeOverrides } from './forms'
import { startFormFromVariables } from '@/lib/forms/start-form'
import { formPagePath, formSubmittedTrigger, startFormKind, type WorkflowStartForm } from '@/lib/forms/workflow-start-form'
import { readFormSubmittedConfig } from '@/lib/forms/submitted-trigger'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { validateTaskFieldValues } from '@/lib/task-field-schema'
import type { TestSubmissionLog } from './form-submissions'
import type { StartFormPageInfo } from './form-pages'
import { findFormPageAction } from '@/lib/forms/form-page'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow rows are untyped here */

interface Definition { nodes: unknown; user_variables: unknown }

async function loadDefinition(ctx: ServiceContext, workflowId: string, draft: boolean): Promise<Definition> {
  const { data: workflow, error } = await (ctx.supabase as any).from('workflows')
    .select('id, nodes, user_variables, published_version_id').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')
  if (!draft && workflow.published_version_id) {
    const { data: version } = await (ctx.supabase as any).from('workflow_versions')
      .select('nodes, user_variables').eq('id', workflow.published_version_id).maybeSingle()
    if (version) return { nodes: version.nodes, user_variables: version.user_variables }
  }
  return { nodes: workflow.nodes, user_variables: workflow.user_variables }
}

/** The start form of a definition (see the module comment). */
async function startFormOf(ctx: ServiceContext, def: Definition): Promise<WorkflowStartForm> {
  const kind = startFormKind(def.nodes)
  if (kind === 'form') {
    const config = readFormSubmittedConfig(formSubmittedTrigger(def.nodes)?.config)
    if (!hasPerm(ctx, 'forms.submit')) return { kind: 'none', reason: "Submitting the form needs the 'forms.submit' permission" }
    try {
      const { getSubmittableForm } = await import('./form-submissions')
      const form = await getSubmittableForm(ctx, config.form_id!)
      return { kind: 'form', form, button_ids: config.button_ids ?? [] }
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'not_found') return { kind: 'none', reason: 'The trigger\'s form no longer exists' }
      throw error
    }
  }
  if (kind === 'start_form') {
    const trigger = (Array.isArray(def.nodes) ? def.nodes : []).find((n: any) => n?.config?.start_form)
    const model = startFormFromVariables(Array.isArray(def.user_variables) ? def.user_variables as any[] : [], (trigger as any)?.config)
    if (!model.def.fields.length) return { kind: 'none' }
    let theme = null
    try { theme = await resolveThemeOverrides(ctx.supabase, ctx.tenantId, model.def.theme) } catch { theme = null }
    return { kind: 'start_form', fields: model.def.fields, layout: model.def.layout, theme_overrides: theme, name_by_key: Object.fromEntries(model.nameByKey) }
  }
  return { kind: 'none' }
}

/** The form a workflow starts from: the draft (Test runner, workflows.edit) or the published version (Run dialog, workflows.view). */
export async function getWorkflowStartForm(session: ServiceContext, workflowId: string, options: { draft: boolean }): Promise<WorkflowStartForm> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, options.draft ? 'workflows.edit' : 'workflows.view', session)
  return startFormOf(ctx, await loadDefinition(ctx, workflow.id, options.draft))
}

/**
 * A TEST run started from the workflow's "Form submitted" form: the run
 * variables the trigger would get (form_source = test) and the log lines
 * saying what the button would have done. `ctx` is already authorised for
 * the workflow (its tenant, workflows.edit).
 */
export async function prepareTestFormRun(ctx: ServiceContext, workflowId: string, input: { values?: unknown; button_id?: unknown }): Promise<{ variables: Record<string, unknown>; logs: TestSubmissionLog[] }> {
  const def = await loadDefinition(ctx, workflowId, true)
  const trigger = formSubmittedTrigger(def.nodes)
  const config = readFormSubmittedConfig(trigger?.config)
  if (!config.form_id) throw ServiceError.validation('This workflow does not start from a form')
  const { planTestSubmission } = await import('./form-submissions')
  const values = input.values && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values as Record<string, unknown> : {}
  const buttonId = typeof input.button_id === 'string' && input.button_id ? input.button_id.slice(0, 40) : null
  const { payload, logs } = await planTestSubmission(ctx, config.form_id, { values, button_id: buttonId }, config)
  return { variables: payload, logs }
}

/**
 * The variables a designer TEST run starts with, checked against the form
 * the workflow starts from (the draft being tested). Throws a validation
 * error (422) instead of starting: a "Form submitted" workflow without a
 * test submission (`details.needs_form_input`), or values that fail the
 * form's checks (`details.fields`, keyed by field key).
 */
export async function prepareTestStart(ctx: ServiceContext, workflowId: string, input: { variables?: unknown; form_submission?: unknown }): Promise<{ variables: Record<string, unknown> | undefined; logs: TestSubmissionLog[] }> {
  const def = await loadDefinition(ctx, workflowId, true)
  const kind = startFormKind(def.nodes)
  const variables = input.variables && typeof input.variables === 'object' && !Array.isArray(input.variables) ? input.variables as Record<string, unknown> : undefined
  if (kind === 'form') {
    if (!input.form_submission || typeof input.form_submission !== 'object' || Array.isArray(input.form_submission)) {
      throw ServiceError.validation('This workflow starts when its form is submitted: fill in the form and press its button to start a test run', { needs_form_input: true })
    }
    return prepareTestFormRun(ctx, workflowId, input.form_submission as { values?: unknown; button_id?: unknown })
  }
  if (kind === 'start_form') {
    const trigger = (Array.isArray(def.nodes) ? def.nodes : []).find((n: any) => n?.config?.start_form)
    const model = startFormFromVariables(Array.isArray(def.user_variables) ? def.user_variables as any[] : [], (trigger as any)?.config)
    if (model.def.fields.length) {
      const values: Record<string, unknown> = {}
      for (const field of model.def.fields) {
        const value = variables?.[model.nameByKey.get(field.key) ?? field.key]
        if (value !== undefined) values[field.key] = value
      }
      const fields = validateTaskFieldValues(model.def.fields, values)
      if (Object.keys(fields).length) throw ServiceError.validation('Some start form fields need attention', { fields })
    }
    // Attachments inputs of a test run: only the tester's own uploads (test context, cleaned up after 24 h).
    if (variables && model.def.fields.some((f) => f.type === 'attachments')) {
      const [{ sanitizeTestTaskFiles }, { createServiceClient }, { normalizeAttachmentValue }] = await Promise.all([import('./form-files'), import('@/lib/cron-auth'), import('@/lib/forms/attachments')])
      const typed = { ...variables }
      for (const field of model.def.fields) {
        const name = model.nameByKey.get(field.key) ?? field.key
        if (field.type === 'attachments' && typed[name] !== undefined) typed[name] = normalizeAttachmentValue(typed[name])
      }
      return { variables: await sanitizeTestTaskFiles(createServiceClient() as any, ctx.tenantId, ctx.actorId, typed), logs: [] }
    }
  }
  return { variables, logs: [] }
}

export interface WorkflowFormEntries {
  /** The "Form submitted" trigger's form. */
  trigger: { form_id: string; form_name: string | null; path: string; exists: boolean; button_ids: string[] } | null
  /** Forms whose button "Start workflow" action starts this workflow. */
  buttons: Array<{ form_id: string; form_name: string; button_label: string; path: string }>
  /** The workflow has a designed start form (opened by Run, not a page). */
  start_form: boolean
  /** "Publish as form page": whether the start form can get a page, and the page (with its sync status). */
  start_form_page: StartFormPageInfo
}

/** The forms that start a workflow (page links). workflows.view; forms.view for the button scan. */
export async function getWorkflowFormEntries(session: ServiceContext, workflowId: string): Promise<WorkflowFormEntries> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, 'workflows.view', session)
  const def = await loadDefinition(ctx, workflow.id, true)
  const config = readFormSubmittedConfig(formSubmittedTrigger(def.nodes)?.config)
  const { loadRunDefinition, eligibility, presentPage } = await import('./form-pages')
  const runDef = await loadRunDefinition(ctx, workflow.id)
  const start_form_page: StartFormPageInfo = { ...eligibility(runDef), workflow_active: runDef.is_active, page: null }
  const out: WorkflowFormEntries = { trigger: null, buttons: [], start_form: startFormKind(def.nodes) === 'start_form' || start_form_page.eligible, start_form_page }
  if (!hasPerm(ctx, 'forms.view')) {
    if (config.form_id) out.trigger = { form_id: config.form_id, form_name: config.form_name ?? null, path: formPagePath(config.form_id), exists: true, button_ids: config.button_ids ?? [] }
    return out
  }
  const { data: forms, error } = await (ctx.supabase as any).from('forms').select('id, name, fields, layout, theme, buttons, version, created_at').eq('tenant_id', ctx.tenantId).order('created_at', { ascending: true }).limit(2000)
  if (error) throw dbError(error)
  const rows = (forms ?? []) as any[]
  if (config.form_id) {
    const row = rows.find((f) => f.id === config.form_id)
    out.trigger = { form_id: config.form_id, form_name: row?.name ?? config.form_name ?? null, path: formPagePath(config.form_id), exists: Boolean(row), button_ids: config.button_ids ?? [] }
  }
  const page = rows.find((form) => findFormPageAction(form.buttons, workflow.id))
  if (page) start_form_page.page = presentPage(page, runDef)
  for (const form of rows) {
    if (form === page) continue
    for (const button of normalizeFormButtons(form.buttons ?? null)) {
      if ((button.actions ?? []).some((a) => a.type === 'start_workflow' && a.workflow_id === workflow.id)) {
        out.buttons.push({ form_id: String(form.id), form_name: String(form.name), button_label: button.label, path: formPagePath(String(form.id)) })
      }
    }
  }
  return out
}
