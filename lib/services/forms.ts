/**
 * Reusable task forms and form themes: CRUD, versions, usages and the
 * runtime resolution the workflow engine uses. Shared by /api/v1/forms*,
 * /api/v1/form-themes*, the MCP forms_* / form_themes_* tools, the Forms
 * library page and the designer's server actions, config-as-code / GitHub
 * sync and packages.
 *
 * Permissions: forms.view (read), forms.edit (create / update / duplicate),
 * forms.delete. Reads use the caller's client (members can SELECT their
 * workspace's rows); the tables have no client write grants (migration
 * 20261115000000), so every write goes through here with a service-role
 * client and an explicit tenant filter.
 *
 * Versioning: every change to a form's content (fields, layout, theme)
 * bumps `version` and stores an immutable snapshot in form_versions. Name,
 * description and tag edits don't. Published workflow versions pin the
 * version they were published with (lib/forms/definition pinFormVersions);
 * drafts and test runs follow the latest.
 *
 * Deleting a form (or a form theme) that a workflow still uses is refused
 * with the list of usages.
 */

import { normalizeFormDefinition, linkedFormIds, pinFormVersions, FORM_NODE_TYPES, type FormDefinition } from '@/lib/forms/definition'
import {
  blockingFormThemeIssues, formatFormThemeIssues, FormThemeOverridesSchema, FormThemeRefSchema,
  parseFormThemeOverrides, type FormThemeOverrides, type FormThemeRef,
} from '@/lib/forms/form-theme'
import { compactLayoutForSave } from '@/lib/forms/layout'
import { fieldDefinitionProblems } from '@/lib/task-field-schema'
import { buttonProblems, normalizeFormButtons, redirectAllowlistFromEnv, startedWorkflowIds, type RedirectPolicy } from '@/lib/forms/buttons'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { formPageOf, withoutFormPageLinks } from '@/lib/forms/form-page'
import { getDb, hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, serviceRoleClient, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables are not in the generated Database types */

export const FORM_LIMITS = { name: 120, description: 2000, tags: 20, tag: 40, fields: 200, bytes: 256 * 1024 } as const

const COLUMNS = 'id, name, description, tags, fields, layout, theme, buttons, header, submission_retention_days, version, created_by, updated_by, created_at, updated_at'
const LIST_COLUMNS = 'id, name, description, tags, fields, buttons, version, theme, updated_at, created_at'
const THEME_COLUMNS = 'id, name, description, overrides, created_by, created_at, updated_at'

export interface FormRow {
  id: string
  name: string
  description: string | null
  tags: string[]
  fields: unknown[]
  layout: unknown | null
  theme: FormThemeRef
  /** Button bar (null = the defaults). */
  buttons?: unknown[] | null
  /** Header (null = none). */
  header?: unknown | null
  /** Days submissions are kept (null = keep). */
  submission_retention_days?: number | null
  version: number
  created_by?: string | null
  updated_by?: string | null
  created_at: string
  updated_at: string
}

export interface FormVersionRow {
  id: string
  form_id: string
  version: number
  name: string
  fields: unknown[]
  layout: unknown | null
  theme: FormThemeRef
  buttons?: unknown[] | null
  header?: unknown | null
  created_by: string | null
  created_at: string
}

export interface FormThemeRow {
  id: string
  name: string
  description: string | null
  overrides: FormThemeOverrides
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface FormUsage {
  workflow_id: string
  workflow_name: string
  node_id: string
  node_label: string
  node_type: string
  /** draft: follows the latest version; published: pinned to `pinned_version`. */
  where: 'draft' | 'published'
  pinned_version: number | null
}

export interface FormInput {
  name: string
  description?: string | null
  tags?: string[] | null
  fields: unknown
  layout?: unknown
  theme?: unknown
  /** The button bar and behaviours (lib/forms/buttons.ts); null / omitted = the defaults. */
  buttons?: unknown
  /** The header (lib/forms/header.ts); null = none. */
  header?: unknown
  /** Keep submissions this many days (null = keep). */
  submission_retention_days?: number | null
}

export type FormUpdateInput = Partial<FormInput>

export interface FormThemeInput {
  name: string
  description?: string | null
  overrides: unknown
}

export interface FormWriteOptions { capture?: boolean }

// ── validation ──────────────────────────────────────────────────────────────

function cleanName(value: unknown, label = 'Form name'): string {
  const name = String(value ?? '').trim()
  if (!name || name.length > FORM_LIMITS.name) throw ServiceError.validation(`${label} must be between 1 and ${FORM_LIMITS.name} characters`)
  return name
}

function cleanDescription(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (text.length > FORM_LIMITS.description) throw ServiceError.validation(`Description must be at most ${FORM_LIMITS.description} characters`)
  return text || null
}

function cleanTags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw ServiceError.validation('tags must be an array of strings')
  const tags = [...new Set(value.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))]
  if (tags.length > FORM_LIMITS.tags || tags.some((t) => t.length > FORM_LIMITS.tag)) {
    throw ServiceError.validation(`At most ${FORM_LIMITS.tags} tags of up to ${FORM_LIMITS.tag} characters`)
  }
  return tags
}

/** Strict theme reference check (the stored value must parse). */
export function validateThemeRef(raw: unknown): FormThemeRef {
  if (raw === undefined || raw === null) return { source: 'workspace' }
  const parsed = FormThemeRefSchema.safeParse(raw)
  if (!parsed.success) throw ServiceError.validation(`Invalid form theme: ${formatFormThemeIssues(parsed.error)}`)
  if (parsed.data.source === 'custom') {
    const blocking = blockingFormThemeIssues(parsed.data.overrides)
    if (blocking.length) throw ServiceError.validation(`Form theme is not legible: ${blocking.join('; ')}`)
  }
  return parsed.data
}

export function validateThemeOverrides(raw: unknown): FormThemeOverrides {
  const parsed = FormThemeOverridesSchema.safeParse(raw ?? {})
  if (!parsed.success) throw ServiceError.validation(`Invalid form theme: ${formatFormThemeIssues(parsed.error)}`)
  const blocking = blockingFormThemeIssues(parsed.data)
  if (blocking.length) throw ServiceError.validation(`Form theme is not legible: ${blocking.join('; ')}`)
  return parsed.data
}

/**
 * Normalize and validate a definition for storage: fields (at least one
 * value-holding or display element, no definition problems), layout cleaned
 * against the keys, theme reference checked.
 */
export function validateFormContent(input: { fields: unknown; layout?: unknown; theme?: unknown; buttons?: unknown; header?: unknown }, options: { tenantId?: string } = {}): { def: FormDefinition; stored: { fields: unknown[]; layout: unknown | null; theme: FormThemeRef; buttons: unknown[] | null; header: unknown | null } } {
  if (!Array.isArray(input.fields)) throw ServiceError.validation('fields must be an array')
  if (input.fields.length > FORM_LIMITS.fields) throw ServiceError.validation(`A form can have at most ${FORM_LIMITS.fields} fields`)
  if (input.buttons !== undefined && input.buttons !== null && !Array.isArray(input.buttons)) throw ServiceError.validation('buttons must be an array')
  const theme = validateThemeRef(input.theme)
  const def = normalizeFormDefinition({ fields: input.fields, layout: input.layout, theme, buttons: input.buttons, header: input.header })
  const buttonIssue = Object.entries(buttonProblems(def.buttons ?? [], { policy: redirectPolicy() }))[0]
  if (buttonIssue) throw ServiceError.validation(`Button "${buttonIssue[0]}": ${buttonIssue[1]}`)
  if (def.header?.image === 'upload' && def.header.image_url && options.tenantId && !def.header.image_url.includes(`/form-headers/${options.tenantId}/`)) {
    throw ServiceError.validation('The header image must be an upload in this workspace')
  }
  if (def.fields.length === 0) throw ServiceError.validation('A form needs at least one field')
  const problems = fieldDefinitionProblems(def.fields)
  const first = Object.entries(problems)[0]
  if (first) throw ServiceError.validation(`Field "${first[0]}": ${first[1]}`, { fields: problems })
  const layout = def.layout ? compactLayoutForSave(def.layout, def.fields.map((f) => f.key)) : null
  const stored = { fields: def.fields as unknown[], layout, theme: def.theme, buttons: (def.buttons ?? null) as unknown[] | null, header: def.header ?? null }
  if (JSON.stringify(stored).length > FORM_LIMITS.bytes) throw ServiceError.validation('Form is too large')
  return { def, stored }
}

/** Redirects from form buttons: app pages, the app's origin, FORM_REDIRECT_ALLOWLIST hosts. */
export function redirectPolicy(): RedirectPolicy {
  let appOrigin: string | null = null
  try { appOrigin = new URL(appUrlOrLocalhost()).origin } catch { appOrigin = null }
  return { appOrigin, allowedHosts: redirectAllowlistFromEnv() }
}

/**
 * Starting a workflow from a button is configured by the form's author and
 * later runs for whoever submits: adding one (or pointing it at another
 * workflow) needs workflows.activate — the right to start workflows — and
 * the workflow must be in this workspace.
 */
async function assertStartableWorkflows(ctx: ServiceContext, db: AnySupabaseClient, buttons: unknown, previous: unknown) {
  const ids = startedWorkflowIds(normalizeFormButtons(buttons))
  if (!ids.length) return
  const before = new Set(startedWorkflowIds(Array.isArray(previous) ? normalizeFormButtons(previous) : null))
  const added = ids.filter((id) => !before.has(id))
  if (!added.length) return
  if (!hasPerm(ctx, 'workflows.activate')) throw ServiceError.forbidden("Forbidden: a button that starts a workflow needs the 'workflows.activate' permission")
  const { data, error } = await (db as any).from('workflows').select('id').eq('tenant_id', ctx.tenantId).in('id', added)
  if (error) throw dbError(error)
  const found = new Set(((data ?? []) as any[]).map((r) => String(r.id)))
  const missing = added.find((id) => !found.has(id))
  if (missing) throw ServiceError.validation(`The workflow ${missing} a button starts is not in this workspace`)
}

function cleanRetention(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 1 || n > 3650) throw ServiceError.validation('submission_retention_days must be between 1 and 3650 (or null to keep)')
  return n
}

async function assertSavedThemeExists(db: AnySupabaseClient, tenantId: string, theme: FormThemeRef) {
  if (theme.source !== 'saved') return
  const { data, error } = await (db as any).from('form_themes').select('id').eq('id', theme.theme_id).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.validation('The form theme does not exist in this workspace')
}

// ── forms: reads ────────────────────────────────────────────────────────────

async function loadForm(db: AnySupabaseClient, tenantId: string, formId: string): Promise<FormRow> {
  const { data, error } = await (db as any).from('forms').select(COLUMNS).eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  return data as FormRow
}

function summarize(row: any) {
  const fields = Array.isArray(row.fields) ? row.fields : []
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description ?? null) as string | null,
    tags: (row.tags ?? []) as string[],
    version: row.version as number,
    field_count: fields.filter((f: any) => f?.type !== 'heading' && f?.type !== 'divider').length,
    theme_source: (row.theme?.source ?? 'workspace') as FormThemeRef['source'],
    /** The workflow whose start form this form is the page of ("Publish as form page"), if any. */
    form_page_of: formPageOf(row.buttons),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }
}

export type FormSummary = ReturnType<typeof summarize> & { usage_count: number }

export async function listForms(ctx: ServiceContext, filters: { search?: string; tag?: string } = {}, page: Page) {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx) as any
  let query = db.from('forms').select(LIST_COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false })
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
  }
  if (filters.tag?.trim()) query = query.contains('tags', [filters.tag.trim().toLowerCase()])
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const usage = await usageIndex(db, ctx.tenantId)
  const forms: FormSummary[] = ((data ?? []) as any[]).map((row) => ({ ...summarize(row), usage_count: (usage.get(row.id) ?? []).length }))
  return { forms, total: (count ?? forms.length) as number }
}

export async function getForm(ctx: ServiceContext, formId: string) {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx)
  const form = await loadForm(db, ctx.tenantId, formId)
  const usages = (await usageIndex(db, ctx.tenantId)).get(formId) ?? []
  return { ...form, usages }
}

export async function listFormVersions(ctx: ServiceContext, formId: string, page: Page) {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx) as any
  await loadForm(db, ctx.tenantId, formId)
  const query = db.from('form_versions').select('id, form_id, version, name, created_by, created_at', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).eq('form_id', formId).order('version', { ascending: false })
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { versions: (data ?? []) as Array<Omit<FormVersionRow, 'fields' | 'layout' | 'theme'>>, total: (count ?? (data ?? []).length) as number }
}

export async function getFormVersion(ctx: ServiceContext, formId: string, version: number) {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx) as any
  const { data, error } = await db.from('form_versions').select('id, form_id, version, name, fields, layout, theme, buttons, header, created_by, created_at')
    .eq('tenant_id', ctx.tenantId).eq('form_id', formId).eq('version', version).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form version not found')
  return data as FormVersionRow
}

/** Where a form is used: workflow drafts (linked nodes / start form) and active published versions (pinned). */
export async function getFormUsages(ctx: ServiceContext, formId: string): Promise<FormUsage[]> {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx)
  await loadForm(db, ctx.tenantId, formId)
  return (await usageIndex(db, ctx.tenantId)).get(formId) ?? []
}

/** Workflows queued for deletion (deleteWorkflow defers the hard delete): not usages any more. */
async function deletingWorkflowIds(db: AnySupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await (db as any).from('deletion_queue').select('target_id')
    .eq('tenant_id', tenantId).eq('target_type', 'workflow').in('status', ['pending', 'processing', 'failed'])
  if (error) return new Set()
  return new Set(((data ?? []) as any[]).map((r) => String(r.target_id)))
}

/** form id → usages across the tenant's workflows (drafts + active published versions). */
async function usageIndex(db: AnySupabaseClient, tenantId: string): Promise<Map<string, FormUsage[]>> {
  const out = new Map<string, FormUsage[]>()
  const add = (formId: string, usage: FormUsage) => out.set(formId, [...(out.get(formId) ?? []), usage])
  const { data: workflows, error } = await (db as any).from('workflows').select('id, name, nodes, trigger_config').eq('tenant_id', tenantId).limit(5000)
  if (error) throw dbError(error)
  const deleting = await deletingWorkflowIds(db, tenantId)
  const names = new Map<string, string>()
  for (const wf of (workflows ?? []) as any[]) {
    if (deleting.has(String(wf.id))) continue
    names.set(wf.id, wf.name)
    collectUsages(wf.nodes, wf.trigger_config, (formId, node, pinned) => add(formId, { workflow_id: wf.id, workflow_name: wf.name, ...node, where: 'draft', pinned_version: pinned }))
  }
  const { data: versions, error: versionError } = await (db as any).from('workflow_versions').select('workflow_id, nodes, trigger_config').eq('tenant_id', tenantId).eq('is_active', true).limit(5000)
  if (versionError) throw dbError(versionError)
  for (const v of (versions ?? []) as any[]) {
    if (deleting.has(String(v.workflow_id))) continue
    collectUsages(v.nodes, v.trigger_config, (formId, node, pinned) => add(formId, { workflow_id: v.workflow_id, workflow_name: names.get(v.workflow_id) ?? 'Workflow', ...node, where: 'published', pinned_version: pinned }))
  }
  return out
}

function collectUsages(nodes: unknown, _triggerConfig: unknown, add: (formId: string, node: { node_id: string; node_label: string; node_type: string }, pinned: number | null) => void) {
  const byId = new Map<string, any>((Array.isArray(nodes) ? nodes : []).map((n: any) => [String(n?.id), n]))
  for (const [formId, nodeIds] of linkedFormIds(nodes)) {
    for (const nodeId of nodeIds) {
      const n = byId.get(nodeId)
      const pinned = Number.isInteger(n?.config?.form_version) ? n.config.form_version : null
      add(formId, { node_id: nodeId, node_label: String(n?.label ?? n?.type ?? ''), node_type: String(n?.type ?? '') }, pinned)
    }
  }
}

// ── forms: writes ───────────────────────────────────────────────────────────

async function insertVersion(db: AnySupabaseClient, ctx: ServiceContext, form: FormRow) {
  const { error } = await (db as any).from('form_versions').insert({
    tenant_id: ctx.tenantId,
    form_id: form.id,
    version: form.version,
    name: form.name,
    fields: form.fields,
    layout: form.layout,
    theme: form.theme,
    buttons: form.buttons ?? null,
    header: form.header ?? null,
    created_by: ctx.actorId,
  })
  if (error) throw dbError(error, 'Failed to store the form version')
}

export async function createForm(ctx: ServiceContext, input: FormInput, options: FormWriteOptions = {}): Promise<FormRow> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const name = cleanName(input.name)
  const { stored } = validateFormContent(input, { tenantId: ctx.tenantId })
  await assertSavedThemeExists(db, ctx.tenantId, stored.theme)
  await assertStartableWorkflows(ctx, db, stored.buttons, null)
  const retention = cleanRetention(input.submission_retention_days)
  const { data, error } = await (db as any).from('forms').insert({
    tenant_id: ctx.tenantId,
    name,
    description: cleanDescription(input.description),
    tags: cleanTags(input.tags),
    ...stored,
    ...(retention !== undefined ? { submission_retention_days: retention } : {}),
    version: 1,
    created_by: ctx.actorId,
    updated_by: ctx.actorId,
  }).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to create form')
  const form = data as FormRow
  await insertVersion(db, ctx, form)
  if (options.capture !== false) {
    await audit(ctx, { objectType: 'form', objectId: form.id, action: 'create', summary: `Created form "${form.name}"` })
    await syncChange(ctx, 'form', form)
  }
  return form
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export async function updateForm(ctx: ServiceContext, formId: string, input: FormUpdateInput, options: FormWriteOptions = {}): Promise<FormRow & { version_changed: boolean }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const existing = await loadForm(db, ctx.tenantId, formId)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = cleanName(input.name)
  if (input.description !== undefined) updates.description = cleanDescription(input.description)
  if (input.tags !== undefined) updates.tags = cleanTags(input.tags)
  const retention = cleanRetention(input.submission_retention_days)
  if (retention !== undefined) updates.submission_retention_days = retention
  let versionChanged = false
  if (input.fields !== undefined || input.layout !== undefined || input.theme !== undefined || input.buttons !== undefined || input.header !== undefined) {
    const { stored } = validateFormContent({
      fields: input.fields ?? existing.fields,
      layout: input.layout !== undefined ? input.layout : existing.layout,
      theme: input.theme !== undefined ? input.theme : existing.theme,
      buttons: input.buttons !== undefined ? input.buttons : existing.buttons,
      header: input.header !== undefined ? input.header : existing.header,
    }, { tenantId: ctx.tenantId })
    await assertSavedThemeExists(db, ctx.tenantId, stored.theme)
    await assertStartableWorkflows(ctx, db, stored.buttons, existing.buttons)
    if (!sameJson(stored.fields, existing.fields) || !sameJson(stored.layout, existing.layout) || !sameJson(stored.theme, existing.theme)
      || !sameJson(stored.buttons, existing.buttons) || !sameJson(stored.header, existing.header)) {
      Object.assign(updates, stored)
      updates.version = existing.version + 1
      versionChanged = true
    }
  }
  const changed = Object.entries(updates).filter(([k, v]) => !sameJson(v, (existing as any)[k])).map(([k]) => k)
  if (changed.length === 0) return { ...existing, version_changed: false }
  updates.updated_by = ctx.actorId
  const { data, error } = await (db as any).from('forms').update(updates).eq('id', formId).eq('tenant_id', ctx.tenantId).eq('version', existing.version).select(COLUMNS).maybeSingle()
  if (error) throw dbError(error, 'Failed to update form')
  if (!data) throw ServiceError.conflict('The form was changed by someone else; reload and try again')
  const form = data as FormRow
  if (versionChanged) await insertVersion(db, ctx, form)
  if (options.capture !== false) {
    await audit(ctx, {
      objectType: 'form', objectId: formId, action: 'update',
      summary: versionChanged ? `Updated form "${form.name}" (version ${form.version})` : `Updated form "${form.name}"`,
      metadata: { fields: changed.filter((k) => k !== 'version'), version: form.version },
    })
    await syncChange(ctx, 'form', form)
  }
  return { ...form, version_changed: versionChanged }
}

/** A copy is an ordinary form: a form page's link to its workflow's start form is not copied. */
export async function duplicateForm(ctx: ServiceContext, formId: string, name?: string | null): Promise<FormRow> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const source = await loadForm(db, ctx.tenantId, formId)
  const copyName = String(name ?? '').trim() || `${source.name} (copy)`.slice(0, FORM_LIMITS.name)
  const form = await createForm(ctx, { name: copyName, description: source.description, tags: source.tags, fields: source.fields, layout: source.layout, theme: source.theme, buttons: (withoutFormPageLinks(source.buttons) ?? null) as unknown[] | null, header: source.header ?? null, submission_retention_days: source.submission_retention_days ?? null }, { capture: false })
  await audit(ctx, { objectType: 'form', objectId: form.id, action: 'duplicate', summary: `Duplicated form "${source.name}" as "${form.name}"`, metadata: { source_id: formId } })
  await syncChange(ctx, 'form', form)
  return form
}

export async function deleteForm(ctx: ServiceContext, formId: string) {
  requirePerm(ctx, 'forms.delete')
  const db = await serviceRoleClient(ctx)
  const existing = await loadForm(db, ctx.tenantId, formId)
  const usages = (await usageIndex(db, ctx.tenantId)).get(formId) ?? []
  if (usages.length) {
    const list = [...new Set(usages.map((u) => `${u.workflow_name} › ${u.node_label}${u.where === 'published' ? ' (published)' : ''}`))]
    throw new ServiceError('conflict', `Form "${existing.name}" is used by ${list.length} step${list.length === 1 ? '' : 's'}: ${list.slice(0, 10).join('; ')}. Detach or remove it there first.`, { details: { usages } })
  }
  const { error } = await (db as any).from('forms').delete().eq('id', formId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'form', objectId: formId, action: 'delete', summary: `Deleted form "${existing.name}"` })
  await syncChange(ctx, 'form', existing, 'delete')
  return { deleted: true as const, id: formId }
}

/**
 * Create or update a form from a manifest asset (config apply, GitHub
 * deploy, package install). An update with different content becomes a new
 * version, so workflows pinned to an older one keep it.
 */
export async function applyFormManifest(ctx: ServiceContext, asset: Record<string, any>, existingId: string | null): Promise<FormRow> {
  const input: FormInput = {
    name: asset.name, description: asset.description ?? null, tags: asset.tags ?? [], fields: asset.fields, layout: asset.layout ?? null, theme: asset.theme ?? { source: 'workspace' },
    buttons: asset.buttons ?? null, header: asset.header ?? null,
    ...(asset.submission_retention_days !== undefined ? { submission_retention_days: asset.submission_retention_days } : {}),
  }
  if (!existingId) return createForm(ctx, input, { capture: false })
  return updateForm(ctx, existingId, input, { capture: false })
}

// ── form themes ─────────────────────────────────────────────────────────────

async function loadTheme(db: AnySupabaseClient, tenantId: string, themeId: string): Promise<FormThemeRow> {
  const { data, error } = await (db as any).from('form_themes').select(THEME_COLUMNS).eq('id', themeId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form theme not found')
  return data as FormThemeRow
}

export async function listFormThemes(ctx: ServiceContext, filters: { search?: string } = {}, page: Page) {
  requirePerm(ctx, 'forms.view')
  const db = getDb(ctx) as any
  let query = db.from('form_themes').select(THEME_COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false })
  if (filters.search?.trim()) query = query.ilike('name', `%${ilikeTerm(filters.search)}%`)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { form_themes: (data ?? []) as FormThemeRow[], total: (count ?? (data ?? []).length) as number }
}

export async function getFormTheme(ctx: ServiceContext, themeId: string) {
  requirePerm(ctx, 'forms.view')
  return loadTheme(getDb(ctx), ctx.tenantId, themeId)
}

export async function createFormTheme(ctx: ServiceContext, input: FormThemeInput, options: FormWriteOptions = {}): Promise<FormThemeRow> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('form_themes').insert({
    tenant_id: ctx.tenantId,
    name: cleanName(input.name, 'Theme name'),
    description: cleanDescription(input.description),
    overrides: validateThemeOverrides(input.overrides),
    created_by: ctx.actorId,
  }).select(THEME_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to create form theme')
  const theme = data as FormThemeRow
  if (options.capture !== false) {
    await audit(ctx, { objectType: 'form_theme', objectId: theme.id, action: 'create', summary: `Created form theme "${theme.name}"` })
    await syncChange(ctx, 'form_theme', theme)
  }
  return theme
}

export async function updateFormTheme(ctx: ServiceContext, themeId: string, input: Partial<FormThemeInput>, options: FormWriteOptions = {}): Promise<FormThemeRow> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const existing = await loadTheme(db, ctx.tenantId, themeId)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = cleanName(input.name, 'Theme name')
  if (input.description !== undefined) updates.description = cleanDescription(input.description)
  if (input.overrides !== undefined) updates.overrides = validateThemeOverrides(input.overrides)
  const changed = Object.entries(updates).filter(([k, v]) => !sameJson(v, (existing as any)[k])).map(([k]) => k)
  if (changed.length === 0) return existing
  const { data, error } = await (db as any).from('form_themes').update(updates).eq('id', themeId).eq('tenant_id', ctx.tenantId).select(THEME_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to update form theme')
  const theme = data as FormThemeRow
  if (options.capture !== false) {
    await audit(ctx, { objectType: 'form_theme', objectId: themeId, action: 'update', summary: `Updated form theme "${theme.name}"`, metadata: { fields: changed } })
    await syncChange(ctx, 'form_theme', theme)
  }
  return theme
}

/** Forms and workflow steps whose theme is this saved theme. */
async function themeUsages(db: AnySupabaseClient, tenantId: string, themeId: string): Promise<string[]> {
  const out: string[] = []
  const { data: forms, error } = await (db as any).from('forms').select('name, theme').eq('tenant_id', tenantId)
  if (error) throw dbError(error)
  for (const form of (forms ?? []) as any[]) if (form.theme?.source === 'saved' && form.theme.theme_id === themeId) out.push(`form "${form.name}"`)
  const { data: workflows, error: wfError } = await (db as any).from('workflows').select('id, name, nodes, trigger_config').eq('tenant_id', tenantId).limit(5000)
  if (wfError) throw dbError(wfError)
  const deleting = await deletingWorkflowIds(db, tenantId)
  for (const wf of (workflows ?? []) as any[]) {
    if (deleting.has(String(wf.id))) continue
    for (const node of (Array.isArray(wf.nodes) ? wf.nodes : []) as any[]) {
      if (FORM_NODE_TYPES.has(String(node?.type)) && !node?.config?.form_id && node?.config?.form_theme?.source === 'saved' && node.config.form_theme.theme_id === themeId) {
        out.push(`${wf.name} › ${node.label ?? node.type}`)
      }
      // A start form's theme lives on the trigger node (lib/forms/start-form).
      const sf = node?.config?.start_form
      if (sf?.theme?.source === 'saved' && sf.theme.theme_id === themeId) out.push(`${wf.name} › Start form`)
    }
  }
  return out
}

export async function deleteFormTheme(ctx: ServiceContext, themeId: string) {
  requirePerm(ctx, 'forms.delete')
  const db = await serviceRoleClient(ctx)
  const existing = await loadTheme(db, ctx.tenantId, themeId)
  const usages = await themeUsages(db, ctx.tenantId, themeId)
  if (usages.length) {
    throw new ServiceError('conflict', `Form theme "${existing.name}" is used by ${usages.slice(0, 10).join('; ')}. Pick another theme there first.`, { details: { usages } })
  }
  const { error } = await (db as any).from('form_themes').delete().eq('id', themeId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'form_theme', objectId: themeId, action: 'delete', summary: `Deleted form theme "${existing.name}"` })
  await syncChange(ctx, 'form_theme', existing, 'delete')
  return { deleted: true as const, id: themeId }
}

export async function applyFormThemeManifest(ctx: ServiceContext, asset: Record<string, any>, existingId: string | null): Promise<FormThemeRow> {
  const input: FormThemeInput = { name: asset.name, description: asset.description ?? null, overrides: asset.overrides ?? {} }
  if (!existingId) return createFormTheme(ctx, input, { capture: false })
  return updateFormTheme(ctx, existingId, input, { capture: false })
}

// ── runtime (engine; service-role client, no permission checks) ─────────────

export interface ResolvedRuntimeForm extends FormDefinition {
  form_id: string | null
  form_name: string | null
  version: number | null
  /** Concrete overrides (saved themes resolved), null = workspace theme. */
  theme_overrides: FormThemeOverrides | null
}

/** A saved / custom theme reference → concrete overrides (null = inherit). */
export async function resolveThemeOverrides(db: AnySupabaseClient, tenantId: string, ref: FormThemeRef): Promise<FormThemeOverrides | null> {
  if (ref.source === 'custom') return ref.overrides
  if (ref.source !== 'saved') return null
  const { data } = await (db as any).from('form_themes').select('overrides').eq('id', ref.theme_id).eq('tenant_id', tenantId).maybeSingle()
  return parseFormThemeOverrides(data?.overrides) ?? null
}

/**
 * The form a step uses at run time: the linked form (its pinned version
 * inside a published snapshot, else the latest), falling back to the cached
 * copy on the node when the form is gone; otherwise the node's own form.
 */
export async function resolveRuntimeForm(db: AnySupabaseClient, tenantId: string, config: Record<string, any>): Promise<ResolvedRuntimeForm> {
  const own = normalizeFormDefinition({ fields: config?.fields, layout: config?.form_layout, theme: config?.form_theme, buttons: config?.form_buttons, header: config?.form_header })
  let resolved: ResolvedRuntimeForm = { ...own, form_id: null, form_name: null, version: null, theme_overrides: null }
  const formId = typeof config?.form_id === 'string' ? config.form_id : null
  if (formId) {
    const pinned = Number.isInteger(config?.form_version) ? Number(config.form_version) : null
    let row: any = null
    if (pinned) {
      const { data } = await (db as any).from('form_versions').select('name, fields, layout, theme, buttons, header, version').eq('tenant_id', tenantId).eq('form_id', formId).eq('version', pinned).maybeSingle()
      row = data
    }
    if (!row) {
      const { data } = await (db as any).from('forms').select('name, fields, layout, theme, buttons, header, version').eq('tenant_id', tenantId).eq('id', formId).maybeSingle()
      row = data
    }
    if (row) {
      resolved = { ...normalizeFormDefinition(row), form_id: formId, form_name: row.name, version: row.version, theme_overrides: null }
    } else {
      resolved = { ...own, form_id: formId, form_name: typeof config?.form_name === 'string' ? config.form_name : null, version: null, theme_overrides: null }
    }
  }
  resolved.theme_overrides = await resolveThemeOverrides(db, tenantId, resolved.theme)
  return resolved
}

/** form id → current version, for pinning at publish. */
export async function currentFormVersions(db: AnySupabaseClient, tenantId: string, formIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!formIds.length) return out
  const { data, error } = await (db as any).from('forms').select('id, version').eq('tenant_id', tenantId).in('id', formIds)
  if (error) throw dbError(error)
  for (const row of (data ?? []) as any[]) out.set(row.id, row.version)
  return out
}

/**
 * Nodes for a published snapshot: linked steps pinned to their form's
 * current version (trigger_config passes through unchanged). Called by both
 * publish paths (lib/services/workflows publishWorkflow, the designer's
 * publish action). The draft itself is left unpinned (follows the latest).
 */
export async function pinWorkflowForms(db: AnySupabaseClient, tenantId: string, nodes: unknown, triggerConfig: unknown): Promise<{ nodes: unknown; trigger_config: unknown }> {
  const ids = [...linkedFormIds(nodes).keys()]
  if (!ids.length) return { nodes, trigger_config: triggerConfig }
  const versions = await currentFormVersions(db, tenantId, ids)
  return { nodes: pinFormVersions(nodes, versions), trigger_config: triggerConfig }
}

const MAX_SOURCE_ROWS = 2000

/**
 * Choice fields with `options_source` get their options from the data table
 * column (distinct values, in row order, at most 500) — the snapshot the
 * task is validated against. Fields whose table is missing keep their own
 * options.
 */
export async function resolveOptionSources<T extends { options?: string[]; options_source?: { table_id: string; column: string } }>(db: AnySupabaseClient, tenantId: string, fields: T[]): Promise<T[]> {
  const sourced = fields.filter((f) => f.options_source)
  if (!sourced.length) return fields
  const byTable = new Map<string, string[]>()
  for (const field of sourced) {
    const { table_id, column } = field.options_source!
    if (!byTable.has(table_id)) byTable.set(table_id, [])
    byTable.get(table_id)!.push(column)
  }
  const values = new Map<string, string[]>()
  for (const [tableId, columns] of byTable) {
    const { data } = await (db as any).from('custom_table_rows').select('data').eq('tenant_id', tenantId).eq('table_id', tableId).order('created_at').limit(MAX_SOURCE_ROWS)
    for (const column of columns) {
      const seen = new Set<string>()
      for (const row of (data ?? []) as any[]) {
        const v = row?.data?.[column]
        if (v === null || v === undefined || v === '' || typeof v === 'object') continue
        seen.add(String(v).trim())
        if (seen.size >= 500) break
      }
      values.set(`${tableId}:${column}`, [...seen].filter(Boolean))
    }
  }
  return fields.map((field) => {
    if (!field.options_source) return field
    const options = values.get(`${field.options_source.table_id}:${field.options_source.column}`)
    return options && options.length ? { ...field, options } : field
  })
}
