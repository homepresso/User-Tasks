/**
 * "Publish as form page" for workflows that start from a START form (their
 * inputs; lib/forms/form-page.ts has the model). The workflow itself is
 * never changed: Run, API and CLI starts with inputs keep working; the form
 * page is an ordinary reusable form whose Submit button starts the workflow.
 *
 *  - getStartFormPage      can this workflow get a page, and its page (with
 *                          the sync status) when it has one. workflows.view;
 *                          finding the page needs forms.view.
 *  - publishStartFormPage  create the form page. forms.edit +
 *                          workflows.activate (the Start workflow action).
 *  - syncStartFormPage     copy the start form again (a new form version).
 *                          Refused (409) when the copied parts were edited
 *                          on the form, unless `overwrite`. Same permissions.
 *  - unpublishStartFormPage delete the form page (forms.delete); refused
 *                          like any delete while a workflow step uses it.
 *
 * The start form read is the one runs use: the published version's inputs
 * (the draft's while the workflow was never published).
 */

import { requirePerm, hasPerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError, syncChange } from './_shared'
import { authorizeWorkflowAccess } from './workflow-designer-runs'
import { startFormKind, formPagePath } from '@/lib/forms/workflow-start-form'
import {
  buildFormPage, findFormPageAction, formPageContent, formPageStatus, startFormTriggerConfig, syncFormPageUpdate,
  type FormPageStatus, type StartFormSource,
} from '@/lib/forms/form-page'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow / form rows are untyped here */

export interface StartFormPageInfo {
  /** The workflow has a start form a page can be made from. */
  eligible: boolean
  /** Why not (form-triggered, no inputs…). */
  reason?: string
  /** Inputs left off the page (names a form button can't map). */
  skipped: string[]
  /** Submissions start runs only while the workflow is active. */
  workflow_active: boolean
  /** The published form page, if any. */
  page: { form_id: string; form_name: string; path: string; version: number; status: FormPageStatus } | null
}

export interface RunDefinition {
  id: string
  name: string
  description: string | null
  is_active: boolean
  nodes: unknown
  source: StartFormSource
}

/** The workflow as runs see it: the published version's nodes / inputs, else the draft. */
export async function loadRunDefinition(ctx: ServiceContext, workflowId: string): Promise<RunDefinition> {
  const { data: workflow, error } = await (ctx.supabase as any).from('workflows')
    .select('id, name, description, is_active, nodes, user_variables, published_version_id').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')
  let nodes = workflow.nodes
  let variables = workflow.user_variables
  if (workflow.published_version_id) {
    const { data: version } = await (ctx.supabase as any).from('workflow_versions')
      .select('nodes, user_variables').eq('id', workflow.published_version_id).maybeSingle()
    if (version) { nodes = version.nodes; variables = version.user_variables }
  }
  return {
    id: String(workflow.id),
    name: String(workflow.name ?? 'Workflow'),
    description: workflow.description ?? null,
    is_active: Boolean(workflow.is_active),
    nodes,
    source: { user_variables: variables, trigger_config: startFormTriggerConfig(nodes) },
  }
}

export function eligibility(def: RunDefinition): { eligible: boolean; reason?: string; skipped: string[] } {
  if (startFormKind(def.nodes) === 'form') return { eligible: false, reason: 'This workflow starts from a reusable form already (Form submitted trigger)', skipped: [] }
  const content = formPageContent(def.source)
  if (!content.fields.length) return { eligible: false, reason: 'The workflow has no start form inputs a form can fill in', skipped: content.skipped }
  return { eligible: true, skipped: content.skipped }
}

/** The tenant's form page of a workflow (first match). */
async function findPage(db: any, tenantId: string, workflowId: string): Promise<any | null> {
  const { data, error } = await db.from('forms').select('id, name, fields, layout, theme, buttons, version, created_at')
    .eq('tenant_id', tenantId).order('created_at', { ascending: true }).limit(2000)
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).find((form) => findFormPageAction(form.buttons, workflowId)) ?? null
}

export function presentPage(form: any, def: RunDefinition): NonNullable<StartFormPageInfo['page']> {
  return {
    form_id: String(form.id),
    form_name: String(form.name),
    path: formPagePath(String(form.id)),
    version: Number(form.version),
    status: formPageStatus(form, def.id, def.source) ?? 'in_sync',
  }
}

/** Can the workflow get a form page, and its page (status) when it has one. */
export async function getStartFormPage(session: ServiceContext, workflowId: string): Promise<StartFormPageInfo> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, 'workflows.view', session)
  const def = await loadRunDefinition(ctx, workflow.id)
  const out: StartFormPageInfo = { ...eligibility(def), workflow_active: def.is_active, page: null }
  if (!hasPerm(ctx, 'forms.view')) return out
  const form = await findPage(ctx.supabase as any, ctx.tenantId, def.id)
  if (form) out.page = presentPage(form, def)
  return out
}

function requirePublishPerms(ctx: ServiceContext) {
  requirePerm(ctx, 'forms.edit')
  // The page's Start workflow action runs for whoever submits it.
  requirePerm(ctx, 'workflows.activate')
}

/** Create the workflow's form page from its start form. */
export async function publishStartFormPage(session: ServiceContext, workflowId: string): Promise<{ form_id: string; form_name: string; path: string; skipped: string[] }> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, 'workflows.view', session)
  requirePublishPerms(ctx)
  const def = await loadRunDefinition(ctx, workflow.id)
  const check = eligibility(def)
  if (!check.eligible) throw ServiceError.validation(check.reason ?? 'This workflow has no start form')
  const existing = await findPage(ctx.supabase as any, ctx.tenantId, def.id)
  if (existing) throw new ServiceError('conflict', `This workflow is already published as form page "${existing.name}" (${formPagePath(String(existing.id))})`, { details: { form_id: existing.id } })
  const content = formPageContent(def.source)
  const { createForm } = await import('./forms')
  const form = await createForm(ctx, buildFormPage({ id: def.id, name: def.name, description: def.description }, content), { capture: false })
  await audit(ctx, { objectType: 'form', objectId: form.id, action: 'create', summary: `Published the start form of "${def.name}" as form page "${form.name}"`, metadata: { workflow_id: def.id, start_form_page: true } })
  await syncChange(ctx, 'form', form)
  return { form_id: form.id, form_name: form.name, path: formPagePath(form.id), skipped: content.skipped }
}

/**
 * Copy the start form to the form page again (a new form version). When
 * the copied parts (fields, layout, theme, input mapping) were edited on
 * the form, 409 unless `overwrite`.
 */
export async function syncStartFormPage(session: ServiceContext, workflowId: string, options: { overwrite?: boolean } = {}): Promise<{ form_id: string; version: number; version_changed: boolean; status: FormPageStatus }> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, 'workflows.view', session)
  requirePublishPerms(ctx)
  const def = await loadRunDefinition(ctx, workflow.id)
  const check = eligibility(def)
  if (!check.eligible) throw ServiceError.validation(check.reason ?? 'This workflow has no start form')
  const form = await findPage(ctx.supabase as any, ctx.tenantId, def.id)
  if (!form) throw ServiceError.notFound('This workflow has no form page')
  const status = formPageStatus(form, def.id, def.source)
  if ((status === 'form_edited' || status === 'both_changed') && !options.overwrite) {
    throw new ServiceError('conflict', `The form page "${form.name}" was edited since it was published (fields, layout, theme or input mapping). Overwrite those edits with the start form?`, { details: { form_id: form.id, status } })
  }
  const update = syncFormPageUpdate(form, { id: def.id, name: def.name, description: def.description }, formPageContent(def.source))
  if (!update) throw ServiceError.notFound('This workflow has no form page')
  const { updateForm } = await import('./forms')
  const saved = await updateForm(ctx, String(form.id), update, { capture: false })
  if (saved.version_changed) {
    await audit(ctx, { objectType: 'form', objectId: saved.id, action: 'update', summary: `Updated form page "${saved.name}" from the start form of "${def.name}" (version ${saved.version})`, metadata: { workflow_id: def.id, overwrite: options.overwrite === true, previous_status: status } })
    await syncChange(ctx, 'form', saved)
  }
  return { form_id: saved.id, version: saved.version, version_changed: saved.version_changed, status: 'in_sync' }
}

/** Delete the workflow's form page (refused while a workflow step uses the form). */
export async function unpublishStartFormPage(session: ServiceContext, workflowId: string): Promise<{ deleted: true; form_id: string }> {
  const { ctx, workflow } = await authorizeWorkflowAccess(workflowId, 'workflows.view', session)
  requirePerm(ctx, 'forms.delete')
  const form = await findPage(ctx.supabase as any, ctx.tenantId, workflow.id)
  if (!form) throw ServiceError.notFound('This workflow has no form page')
  const { deleteForm } = await import('./forms')
  await deleteForm(ctx, String(form.id))
  return { deleted: true, form_id: String(form.id) }
}
