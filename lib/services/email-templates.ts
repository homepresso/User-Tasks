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

import { htmlToPlainText, sanitizeEmailHtml } from '@/lib/email-templates'
import { hasPerm, requireAny, requirePerm, ServiceError, type ServiceContext } from './context'
import { rateLimit } from '@/lib/rate-limit'
import { applyPage, audit, dbError, ilikeTerm, syncChange, type Page } from './_shared'
import { isMissingTagsColumn, selectWithTags, tagsNotApplied, tagsSafeWrite, validTags } from './tags-column'
import { manifestTags, tagFilterValues } from '@/lib/tags/normalize'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { declarationsForSave, normalizeVariableDeclarations, templateVariables, type EmailVariableDeclaration } from '@/lib/email-editor/variables'
import { renderEmailTemplate } from '@/lib/email-editor/render'

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
  /** Absent until migration 20270122150000 is applied. */
  tags?: string[]
  /** Declared variables (empty until migration 20270126120000 is applied). */
  variables?: EmailVariableDeclaration[]
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
  tags?: string[] | null
  /**
   * Declared variables (label / type / description / sample / required).
   * Stored for the custom variables the content uses (auto-detected), so
   * omitted → the detected names, keeping existing declarations.
   */
  variables?: EmailVariableDeclaration[] | null
}

export type EmailTemplateUpdateInput = Partial<EmailTemplateInput>

async function loadOwned(ctx: ServiceContext, templateId: string, select = COLUMNS): Promise<EmailTemplateRow> {
  const { data, error } = await selectWithTags(select, (columns) => (ctx.supabase as any).from('email_templates')
    .select(columns).eq('id', templateId).eq('tenant_id', ctx.tenantId).maybeSingle())
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Email template not found')
  return data as EmailTemplateRow
}

export const EMAIL_TEMPLATE_VARIABLES_MIGRATION = '20270126120000_email_template_variables'

/** Postgres / PostgREST "column variables does not exist" (before migration 20270126120000). */
function isMissingVariablesColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = String(error.message ?? '')
  return /\bvariables\b/.test(message) && (error.code === '42703' || error.code === 'PGRST204' || /does not exist|could not find/i.test(message))
}

/** Declared variables of these templates (id → list); empty before the migration. */
async function loadDeclarations(ctx: ServiceContext, ids: string[]): Promise<Map<string, EmailVariableDeclaration[]>> {
  const out = new Map<string, EmailVariableDeclaration[]>()
  if (!ids.length) return out
  const { data, error } = await (ctx.supabase as any).from('email_templates')
    .select('id, variables').eq('tenant_id', ctx.tenantId).in('id', ids)
  if (error) {
    if (isMissingVariablesColumn(error)) return out
    throw dbError(error)
  }
  for (const row of (data ?? []) as Array<{ id: string; variables: unknown }>) out.set(row.id, normalizeVariableDeclarations(row.variables))
  return out
}

/** Store declarations (a no-op returning false before the migration). */
async function storeDeclarations(ctx: ServiceContext, templateId: string, declarations: EmailVariableDeclaration[]): Promise<boolean> {
  const { error } = await (ctx.supabase as any).from('email_templates')
    .update({ variables: declarations }).eq('id', templateId).eq('tenant_id', ctx.tenantId)
  if (error) {
    if (isMissingVariablesColumn(error)) return false
    throw dbError(error)
  }
  return true
}

async function withDeclarations<T extends EmailTemplateRow>(ctx: ServiceContext, template: T): Promise<T> {
  const declarations = (await loadDeclarations(ctx, [template.id])).get(template.id) ?? []
  return { ...template, variables: declarations }
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

export async function listEmailTemplates(ctx: ServiceContext, filters: { search?: string; tag?: string } = {}, page: Page) {
  requirePerm(ctx, 'workflows.view')
  const tagValues = tagFilterValues(filters.tag)
  const { data, count, error } = await selectWithTags(LIST_COLUMNS, (columns) => {
    let query = (ctx.supabase as any).from('email_templates')
      .select(columns, { count: 'exact' })
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false })
    if (filters.search?.trim()) query = query.ilike('name', `%${ilikeTerm(filters.search)}%`)
    if (tagValues.length) query = query.overlaps('tags', tagValues)
    return applyPage(query, page)
  }) as any
  if (error) throw tagValues.length && isMissingTagsColumn(error) ? tagsNotApplied('email templates') : dbError(error)
  return { email_templates: (data ?? []) as EmailTemplateRow[], total: (count ?? (data ?? []).length) as number }
}

/** Templates with their bodies, newest first (the UI manager edits in place). */
export async function listEmailTemplatesWithBodies(ctx: ServiceContext, limit = 200) {
  requirePerm(ctx, 'workflows.view')
  const { data, error } = await selectWithTags(COLUMNS, (columns) => (ctx.supabase as any).from('email_templates')
    .select(columns).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false }).limit(limit))
  if (error) throw dbError(error)
  const rows = (data ?? []) as EmailTemplateRow[]
  const declarations = await loadDeclarations(ctx, rows.map((row) => row.id))
  return rows.map((row) => ({ ...row, variables: declarations.get(row.id) ?? [] }))
}

export async function getEmailTemplate(ctx: ServiceContext, templateId: string) {
  requirePerm(ctx, 'workflows.view')
  return withDeclarations(ctx, await loadOwned(ctx, templateId))
}

/**
 * A template's variables for the workflow designer's mapping table: every
 * variable the subject / HTML / text use (built-in ones marked `auto`), with
 * the template's declarations (label, type, description, sample, required).
 */
export async function getEmailTemplateVariables(ctx: ServiceContext, templateId: string) {
  requirePerm(ctx, 'workflows.view')
  const template = await withDeclarations(ctx, await loadOwned(ctx, templateId))
  return {
    id: template.id,
    name: template.name,
    subject: template.subject,
    html_body: template.html_body,
    text_body: template.text_body,
    variables: templateVariables(template, template.variables),
  }
}

/** `capture: false` (config apply / deploy) skips the per-asset audit and sync capture; the caller records the run. */
export interface EmailTemplateWriteOptions { capture?: boolean }

export async function createEmailTemplate(ctx: ServiceContext, input: EmailTemplateInput, options: EmailTemplateWriteOptions = {}) {
  requirePerm(ctx, 'workflows.create')
  const content = normalizeContent(input)
  // Inserted as non-default and then promoted, so a failed insert never
  // leaves the tenant without its existing default.
  const { data, error } = await tagsSafeWrite('email templates', {
    ...content,
    tags: validTags(input.tags),
    tenant_id: ctx.tenantId,
    is_default: false,
    created_by: ctx.actorId,
  }, COLUMNS, (values, columns) => (ctx.supabase as any).from('email_templates').insert(values).select(columns).single())
  if (error || !data) throw dbError(error, 'Failed to create email template')
  let template = data as EmailTemplateRow
  const declarations = declarationsForSave(content, input.variables ?? [])
  template = { ...template, variables: (await storeDeclarations(ctx, template.id, declarations)) ? declarations : [] }
  if (input.is_default) {
    await clearOtherDefaults(ctx, template.id)
    const promoted = await selectWithTags(COLUMNS, (columns) => (ctx.supabase as any).from('email_templates')
      .update({ is_default: true }).eq('id', template.id).eq('tenant_id', ctx.tenantId).select(columns).single())
    if (promoted.error || !promoted.data) throw dbError(promoted.error, 'Failed to make the template the default')
    template = { ...(promoted.data as EmailTemplateRow), variables: template.variables }
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
  const variablesChanged = input.variables !== undefined
  if (!contentChanged && !variablesChanged && input.is_default === undefined && input.tags === undefined) throw ServiceError.validation('No fields to update')

  const updates: Record<string, unknown> = {}
  if (input.tags !== undefined) {
    const tags = validTags(input.tags)
    // Before migration 20270122150000 rows have no tags: an empty list is no change.
    if (existing.tags !== undefined || tags.length) updates.tags = tags
  }
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

  const { data, error } = await tagsSafeWrite('email templates', updates, COLUMNS, (values, columns) => (ctx.supabase as any).from('email_templates')
    .update(values).eq('id', templateId).eq('tenant_id', ctx.tenantId).select(columns).single())
  if (error || !data) throw dbError(error, 'Failed to update email template')
  let template = data as EmailTemplateRow
  const fields = Object.keys(updates).filter((key) => key !== 'updated_at')
  if (contentChanged || variablesChanged) {
    // Re-detect from the saved content, keeping the declarations given (or stored).
    const current = (await loadDeclarations(ctx, [templateId])).get(templateId) ?? []
    const declarations = declarationsForSave(template, variablesChanged ? input.variables ?? [] : current)
    // Unchanged declarations are not rewritten (an unedited round trip writes nothing new).
    const same = JSON.stringify(declarations) === JSON.stringify(current)
    const stored = same || await storeDeclarations(ctx, templateId, declarations)
    template = { ...template, variables: stored ? declarations : [] }
    if (variablesChanged && !same) fields.push('variables')
  }
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
    // Tags travel when the manifest has them; a manifest without tags leaves an existing template's tags alone.
    ...(Array.isArray(asset.tags) ? { tags: manifestTags(asset.tags) } : {}),
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
  /** A workflow step's variable mappings (variable → expression over `variables`). */
  mappings?: Record<string, unknown>
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
  const rendered = renderEmailTemplate(template, { variables, task: input.task as Record<string, any> | undefined }, input.mappings)
  return {
    id: template.id,
    name: template.name,
    subject: rendered.subject,
    html_body: rendered.html,
    text_body: rendered.text,
  }
}

// ── Test send ────────────────────────────────────────────────────────────────

export interface EmailTemplateTestSendInput {
  /** The saved template this is a draft of (audit), or null for a new one. */
  template_id?: string | null
  name?: string | null
  subject: string
  html_body: string
  text_body?: string | null
  /** Sample values for the template's variables. */
  variables?: Record<string, unknown>
}

/** Per person: a handful of test sends per 10 minutes; per workspace: a ceiling per hour. */
export const TEST_SEND_LIMITS = { perActor: { max: 5, windowMs: 10 * 60_000 }, perTenant: { max: 30, windowMs: 60 * 60_000 } } as const

/** A provider / configuration error in plain words (the provider's own message kept as detail). */
export function friendlyEmailError(raw: string, provider?: string): string {
  const message = String(raw ?? '').trim()
  const via = provider ? ` (${provider})` : ''
  if (/not configured|RESEND_API_KEY|EMAIL_FROM|missing .*(key|host|credential)/i.test(message)) {
    return `Email is not set up for this workspace yet${via}. An administrator needs to configure an email provider and sender (EMAIL_FROM) — see Settings → Infrastructure.`
  }
  if (/domain.*not.*verified|verify a domain|not verified|own email address|testing emails/i.test(message)) {
    return `The sending domain is not verified with the email provider yet${via}, so it only delivers to the provider account's own address. Verify the domain with the provider (or use a verified sender) and try again.`
  }
  if (/api key is invalid|invalid api key|unauthori[sz]ed|forbidden|\b40[13]\b|authentication/i.test(message)) {
    return `The email provider rejected the credentials${via}. Check the API key / password configured for email.`
  }
  if (/rate.?limit|too many|\b429\b/i.test(message)) return `The email provider is limiting how fast mail is sent${via}. Wait a minute and try again.`
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed? ?out|getaddrinfo/i.test(message)) return `Could not reach the mail server${via}. Check the email provider's host and port.`
  return `The email provider did not accept the message${via}: ${message || 'unknown error'}`
}

/**
 * Send the editor's current draft to the signed-in person (only them) with
 * sample values, through the configured email provider. Needs a person
 * (not a tenant API key) with workflows.create or workflows.edit;
 * rate-limited and audited. Provider failures come back as
 * `{ sent: false, error }` in plain words, never thrown.
 */
export async function sendEmailTemplateTest(ctx: ServiceContext, input: EmailTemplateTestSendInput) {
  requireAny(ctx, ['workflows.edit', 'workflows.create'])
  if (!ctx.actorId) throw ServiceError.validation('Test emails go to the signed-in person — use a personal sign-in, not a workspace API key')
  const actorLimit = await rateLimit(`email-test:actor:${ctx.tenantId}:${ctx.actorId}`, TEST_SEND_LIMITS.perActor)
  const tenantLimit = actorLimit.ok ? await rateLimit(`email-test:tenant:${ctx.tenantId}`, TEST_SEND_LIMITS.perTenant) : actorLimit
  if (!actorLimit.ok || !tenantLimit.ok) {
    const minutes = Math.max(1, Math.ceil((actorLimit.ok ? tenantLimit : actorLimit).retryAfterMs / 60_000))
    throw new ServiceError('rate_limited', `Too many test emails — try again in ${minutes} minute${minutes === 1 ? '' : 's'}`)
  }
  const { data: me, error: meError } = await (ctx.supabase as any).from('users').select('email').eq('id', ctx.actorId).maybeSingle()
  if (meError) throw dbError(meError)
  const to = String(me?.email ?? '').trim()
  if (!to) throw ServiceError.validation('Your profile has no email address to send the test to')

  const html = sanitizeEmailHtml(input.html_body).trim()
  if (!String(input.subject ?? '').trim() || !html) throw ServiceError.validation('A subject and an HTML body are needed to send a test')
  if (html.length > EMAIL_TEMPLATE_LIMITS.html) throw ServiceError.validation('Template content is too large')
  const variables: Record<string, any> = { ...(input.variables ?? {}) }
  if (!variables.app_url) variables.app_url = configuredAppUrl() ?? ''
  const rendered = renderEmailTemplate({ subject: input.subject, html_body: html, text_body: input.text_body || htmlToPlainText(html) }, { variables })

  const { sendEmail } = await import('@/lib/email')
  const { getEmailProviderWithOptions } = await import('@/lib/providers/email')
  const providerId = await getEmailProviderWithOptions().then((p) => p.provider.id, () => undefined)
  const result = await sendEmail({ to, subject: `[Test] ${rendered.subject}`.slice(0, 900), body: rendered.html, text: rendered.text })
  const name = String(input.name ?? '').trim() || 'Untitled template'
  await audit(ctx, {
    objectType: 'email_template', objectId: input.template_id || 'draft', action: 'test_send',
    summary: result.success ? `Sent a test of email template "${name}" to ${to}` : `Test of email template "${name}" failed`,
    metadata: { to, provider: providerId ?? null, success: result.success, ...(result.success ? {} : { error: String(result.error ?? '').slice(0, 300) }) },
  })
  if (!result.success) return { sent: false as const, to, provider: providerId ?? null, error: friendlyEmailError(result.error ?? '', providerId), detail: String(result.error ?? '').slice(0, 500) }
  return { sent: true as const, to, provider: providerId ?? null, id: result.id ?? null }
}

// ── Editor context ───────────────────────────────────────────────────────────

const HEX6 = /^#[0-9a-f]{6}$/i

/** `#abc` → `#AABBCC`; anything but hex → null (email clients want hex). */
function hexColor(value: unknown): string | null {
  const v = String(value ?? '').trim()
  if (HEX6.test(v)) return v.toUpperCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v)
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase() : null
}

/** Is an email provider ready to send? (Configuration only; the provider has the last word.) */
export async function describeEmailSetup(): Promise<{ provider: string | null; ready: boolean; problem: string | null }> {
  try {
    const { getEmailProviderWithOptions } = await import('@/lib/providers/email')
    const { emailOption } = await import('@/lib/providers/email/types')
    const { provider, options } = await getEmailProviderWithOptions()
    if (provider.id === 'resend' && !emailOption(options, 'resend_api_key')) {
      return { provider: provider.id, ready: false, problem: 'No Resend API key is configured (RESEND_API_KEY).' }
    }
    if (!['resend', 'console'].includes(provider.id) && !emailOption(options, 'from')) {
      return { provider: provider.id, ready: false, problem: `No sender address is configured (EMAIL_FROM) for the ${provider.id} provider.` }
    }
    return { provider: provider.id, ready: true, problem: null }
  } catch (error) {
    return { provider: null, ready: false, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * What the template editor needs besides the templates: workspace branding
 * for starters (logo, accent, name), the email setup (for Send test) and
 * the signed-in person's address (test sends go only there).
 */
export async function getEmailEditorContext(ctx: ServiceContext) {
  requirePerm(ctx, 'workflows.view')
  const [{ readWorkspaceTheme }, { resolveStorageUrl }] = await Promise.all([import('./workspace-theme'), import('@/lib/storage/refs')])
  const [themeRecord, tenant, me, email] = await Promise.all([
    readWorkspaceTheme(ctx.supabase, ctx.tenantId).catch(() => null),
    (ctx.supabase as any).from('tenants').select('name, branding').eq('id', ctx.tenantId).maybeSingle().then((r: any) => r.data, () => null),
    ctx.actorId ? (ctx.supabase as any).from('users').select('email').eq('id', ctx.actorId).maybeSingle().then((r: any) => r.data, () => null) : null,
    describeEmailSetup(),
  ])
  const palette = themeRecord?.theme?.colors?.light
  const logoRef = themeRecord?.theme?.branding?.logoLight ?? tenant?.branding?.logo_url ?? null
  let logoUrl: string | null = null
  try { logoUrl = logoRef ? resolveStorageUrl(String(logoRef), { absolute: true }) : null } catch { logoUrl = null }
  return {
    branding: {
      logoUrl: logoUrl && /^https?:\/\//i.test(logoUrl) ? logoUrl : null,
      accent: hexColor(palette?.primary),
      accentText: hexColor(palette?.onPrimary),
      workspaceName: (themeRecord?.theme?.branding?.wordmark || tenant?.name || null) as string | null,
    },
    email,
    me: { email: (me?.email ?? null) as string | null },
    canTestSend: !!ctx.actorId && (hasPerm(ctx, 'workflows.edit') || hasPerm(ctx, 'workflows.create')),
  }
}

/**
 * Sample values from a form for the preview's sample data: each field under
 * `form.<key>`, `task_data.<key>` and the bare key, valued from its default,
 * first option or a type-appropriate example (USD for money).
 */
export async function getEmailSampleFromForm(ctx: ServiceContext, formId: string) {
  requirePerm(ctx, 'workflows.view')
  const { getForm } = await import('./forms')
  const form = await getForm(ctx, formId)
  const { normalizeTaskFields, valueFields } = await import('@/lib/task-field-schema')
  const fields = valueFields(normalizeTaskFields(form.fields as any) as any) as any[]
  const values: Record<string, unknown> = {}
  const fieldList: Array<{ key: string; label: string }> = []
  for (const field of fields.slice(0, 200)) {
    const key = String(field.key ?? '').trim()
    if (!key) continue
    const sample = sampleForField(field)
    values[`form.${key}`] = sample
    values[`task_data.${key}`] = sample
    values[key] = sample
    fieldList.push({ key, label: String(field.label ?? key) })
  }
  return { form: { id: form.id, name: form.name }, values: { ...values, form_name: form.name }, fields: fieldList }
}

function sampleForField(field: any): string {
  if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') return String(field.default_value)
  const first = Array.isArray(field.options) && field.options.length ? field.options[0] : null
  if (first !== null) return String(typeof first === 'object' ? first.label ?? first.value ?? '' : first)
  const label = String(field.label ?? field.key ?? '').toLowerCase()
  switch (String(field.type ?? 'text')) {
    case 'number': case 'currency': return /amount|price|cost|total|budget/.test(label) || field.type === 'currency' ? '$2,400.00' : '42'
    case 'date': return '2026-12-04'
    case 'datetime': return '2026-12-04 14:30'
    case 'email': return 'jordan.lee@example.com'
    case 'checkbox': case 'boolean': return 'Yes'
    case 'url': return 'https://example.com'
    case 'phone': return '+1 555 0100'
    case 'textarea': case 'rich_text': return `Example ${String(field.label ?? 'details').toLowerCase()} entered on the form.`
    default:
      if (/email/.test(label)) return 'jordan.lee@example.com'
      if (/name/.test(label)) return 'Jordan Lee'
      if (/amount|price|cost|total|budget/.test(label)) return '$2,400.00'
      return `Example ${String(field.label ?? field.key ?? 'value')}`
  }
}
