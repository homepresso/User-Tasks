/**
 * Email templates: CRUD and preview. Shared by /api/v1/email-templates, the
 * MCP email_templates_* tools and the email template server actions.
 *
 * Templates are governed by the workflow permissions (they are workflow
 * building blocks): view → workflows.view, create → workflows.create,
 * edit/delete → workflows.edit. HTML is sanitised on every write
 * (sanitizeEmailHtml) and a blank text body is derived from the HTML.
 *
 * Default template: each tenant is seeded with "UserTasks Default"
 * (is_default) by a DB trigger; a partial unique index allows at most one
 * default per tenant, so making a template the default clears the flag on
 * the others first. The current default cannot be deleted.
 *
 * Templates are a config-as-code / GitHub-sync asset ('email_templates'
 * section); writes queue a sync change.
 */

import { resolveExpression } from '@/lib/expression-resolver'
import { htmlToPlainText, sanitizeEmailHtml } from '@/lib/email-templates'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, syncChange, type Page } from './_shared'
import { configuredAppUrl } from '@/lib/config/bootstrap'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped table (not in the generated Database types) */

const COLUMNS = 'id, name, description, subject, html_body, text_body, is_default, created_at, updated_at'
const LIST_COLUMNS = 'id, name, description, subject, is_default, created_at, updated_at'

export const EMAIL_TEMPLATE_LIMITS = { name: 120, subject: 500, html: 250_000, text: 100_000 } as const

export interface EmailTemplateRow {
  id: string
  name: string
  description: string | null
  subject: string
  html_body: string
  text_body: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface EmailTemplateInput {
  name: string
  description?: string | null
  subject: string
  html_body: string
  /** Blank → generated from the (sanitised) HTML. */
  text_body?: string | null
  is_default?: boolean
}

export type EmailTemplateUpdateInput = Partial<EmailTemplateInput>

async function loadOwned(ctx: ServiceContext, templateId: string, select = COLUMNS): Promise<EmailTemplateRow> {
  const { data, error } = await (ctx.supabase as any).from('email_templates')
    .select(select).eq('id', templateId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Email template not found')
  return data as EmailTemplateRow
}

/** Trim, sanitise and bound-check the content fields (same rules as the UI editor). */
function normalizeContent(input: { name: unknown; description?: unknown; subject: unknown; html_body: unknown; text_body?: unknown }) {
  const name = String(input.name ?? '').trim()
  const subject = String(input.subject ?? '').trim()
  const htmlBody = sanitizeEmailHtml(input.html_body).trim()
  const textBody = String(input.text_body ?? '').trim() || htmlToPlainText(htmlBody)
  if (!name || name.length > EMAIL_TEMPLATE_LIMITS.name) throw ServiceError.validation('Template name must be between 1 and 120 characters')
  if (!subject) throw ServiceError.validation('Subject is required')
  if (!htmlBody) throw ServiceError.validation('HTML body is required')
  if (subject.length > EMAIL_TEMPLATE_LIMITS.subject || htmlBody.length > EMAIL_TEMPLATE_LIMITS.html || textBody.length > EMAIL_TEMPLATE_LIMITS.text) {
    throw ServiceError.validation('Template content is too large')
  }
  const description = String(input.description ?? '').trim() || null
  return { name, description, subject, html_body: htmlBody, text_body: textBody }
}

/** Clear is_default on the tenant's other templates (the unique index allows one). */
async function clearOtherDefaults(ctx: ServiceContext, keepId: string | null) {
  let query = (ctx.supabase as any).from('email_templates')
    .update({ is_default: false })
    .eq('tenant_id', ctx.tenantId)
    .eq('is_default', true)
  if (keepId) query = query.neq('id', keepId)
  const { error } = await query
  if (error) throw dbError(error)
}

export async function listEmailTemplates(ctx: ServiceContext, filters: { search?: string } = {}, page: Page) {
  requirePerm(ctx, 'workflows.view')
  let query = (ctx.supabase as any).from('email_templates')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('updated_at', { ascending: false })
  if (filters.search?.trim()) query = query.ilike('name', `%${ilikeTerm(filters.search)}%`)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { email_templates: (data ?? []) as EmailTemplateRow[], total: (count ?? (data ?? []).length) as number }
}

/** Templates with their bodies, newest first (the UI manager edits in place). */
export async function listEmailTemplatesWithBodies(ctx: ServiceContext, limit = 200) {
  requirePerm(ctx, 'workflows.view')
  const { data, error } = await (ctx.supabase as any).from('email_templates')
    .select(COLUMNS).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false }).limit(limit)
  if (error) throw dbError(error)
  return (data ?? []) as EmailTemplateRow[]
}

export async function getEmailTemplate(ctx: ServiceContext, templateId: string) {
  requirePerm(ctx, 'workflows.view')
  return loadOwned(ctx, templateId)
}

/** `capture: false` (config apply / deploy) skips the per-asset audit and sync capture; the caller records the run. */
export interface EmailTemplateWriteOptions { capture?: boolean }

export async function createEmailTemplate(ctx: ServiceContext, input: EmailTemplateInput, options: EmailTemplateWriteOptions = {}) {
  requirePerm(ctx, 'workflows.create')
  const content = normalizeContent(input)
  // Inserted as non-default and then promoted, so a failed insert never
  // leaves the tenant without its existing default.
  const { data, error } = await (ctx.supabase as any).from('email_templates').insert({
    ...content,
    tenant_id: ctx.tenantId,
    is_default: false,
    created_by: ctx.actorId,
  }).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to create email template')
  let template = data as EmailTemplateRow
  if (input.is_default) {
    await clearOtherDefaults(ctx, template.id)
    const promoted = await (ctx.supabase as any).from('email_templates')
      .update({ is_default: true }).eq('id', template.id).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
    if (promoted.error || !promoted.data) throw dbError(promoted.error, 'Failed to make the template the default')
    template = promoted.data as EmailTemplateRow
  }
  if (options.capture !== false) {
    await audit(ctx, {
      objectType: 'email_template', objectId: template.id, action: 'create',
      summary: `Created email template "${template.name}"${template.is_default ? ' (default)' : ''}`,
    })
    await syncChange(ctx, 'email_template', template)
  }
  return template
}

export async function updateEmailTemplate(ctx: ServiceContext, templateId: string, input: EmailTemplateUpdateInput, options: EmailTemplateWriteOptions = {}) {
  requirePerm(ctx, 'workflows.edit')
  const existing = await loadOwned(ctx, templateId)

  const contentChanged = (['name', 'description', 'subject', 'html_body', 'text_body'] as const).some((key) => input[key] !== undefined)
  if (!contentChanged && input.is_default === undefined) throw ServiceError.validation('No fields to update')

  const updates: Record<string, unknown> = {}
  if (contentChanged) {
    // A new HTML body without a new text body regenerates the text from it.
    const textBody = input.text_body !== undefined ? input.text_body
      : input.html_body !== undefined ? '' : existing.text_body
    Object.assign(updates, normalizeContent({
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
      subject: input.subject ?? existing.subject,
      html_body: input.html_body ?? existing.html_body,
      text_body: textBody,
    }))
  }
  if (input.is_default !== undefined && input.is_default !== existing.is_default) {
    if (input.is_default) await clearOtherDefaults(ctx, templateId)
    updates.is_default = input.is_default
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await (ctx.supabase as any).from('email_templates')
    .update(updates).eq('id', templateId).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to update email template')
  const template = data as EmailTemplateRow
  const fields = Object.keys(updates).filter((key) => key !== 'updated_at')
  if (options.capture !== false) {
    await audit(ctx, {
      objectType: 'email_template', objectId: templateId, action: 'update',
      summary: updates.is_default === true ? `Made email template "${template.name}" the default` : `Updated email template "${template.name}"`,
      metadata: { fields },
    })
    await syncChange(ctx, 'email_template', template)
  }
  return template
}

export async function deleteEmailTemplate(ctx: ServiceContext, templateId: string) {
  requirePerm(ctx, 'workflows.edit')
  const existing = await loadOwned(ctx, templateId, 'id, name, is_default')
  if (existing.is_default) throw ServiceError.conflict('The default email template cannot be deleted; make another template the default first')
  const { error } = await (ctx.supabase as any).from('email_templates').delete().eq('id', templateId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'email_template', objectId: templateId, action: 'delete', summary: `Deleted email template "${existing.name}"` })
  await syncChange(ctx, 'email_template', existing, 'delete')
  return { deleted: true as const, id: templateId }
}

/**
 * Create or update a template from a manifest asset (config apply, GitHub
 * deploy) with the editor's rules. `is_default: true` makes it the default
 * (only when `allowDefault` — the first default in a manifest wins); an
 * import never clears the flag on the tenant's current default, so a
 * tenant is never left without one.
 */
export async function applyEmailTemplateManifest(
  ctx: ServiceContext,
  asset: Record<string, any>,
  existingId: string | null,
  options: { allowDefault: boolean },
) {
  const content = {
    name: asset.name,
    description: asset.description ?? null,
    subject: asset.subject,
    html_body: asset.html_body,
    text_body: asset.text_body ?? null,
  }
  const wantsDefault = asset.is_default === true && options.allowDefault
  if (!existingId) return createEmailTemplate(ctx, { ...content, is_default: wantsDefault }, { capture: false })
  // is_default is only ever raised by an import, never lowered.
  return updateEmailTemplate(ctx, existingId, { ...content, ...(wantsDefault ? { is_default: true } : {}) }, { capture: false })
}

export interface EmailTemplatePreviewInput {
  /** Sample workflow variables ({{name}}, {{=FUNC(...)}} references). */
  variables?: Record<string, unknown>
  /** Sample task record ({{task.title}} references). */
  task?: Record<string, unknown>
}

/**
 * Render subject/HTML/text with sample variables using the workflow engine's
 * resolver — exactly what the send_email / user_task nodes do at run time
 * (including the app_url default). Nothing is sent.
 */
export async function previewEmailTemplate(ctx: ServiceContext, templateId: string, input: EmailTemplatePreviewInput = {}) {
  requirePerm(ctx, 'workflows.view')
  const template = await loadOwned(ctx, templateId)
  const variables: Record<string, any> = { ...(input.variables ?? {}) }
  if (!variables.app_url) variables.app_url = configuredAppUrl() ?? ''
  const exprCtx = { variables, task: input.task as Record<string, any> | undefined }
  const render = (value: string) => {
    const resolved = resolveExpression(value, exprCtx)
    return resolved === undefined || resolved === null ? '' : String(resolved)
  }
  return {
    id: template.id,
    name: template.name,
    subject: render(template.subject),
    html_body: render(template.html_body),
    text_body: render(template.text_body),
  }
}
