/**
 * Form drafts: save, publish, discard, compare, restore and share the
 * working draft of a reusable form (public.form_design_drafts and
 * public.form_design_draft_reviewers, migration 20270110000000). One
 * implementation behind the form designer page, REST /api/v1/forms/{id}/
 * draft*, /publish and /versions/{n}/restore, the MCP forms_draft_* /
 * forms_publish tools and the Agent.
 *
 * The model:
 *  - public.forms holds the PUBLISHED content — what everyone else sees
 *    (form pages, start forms, the Forms menu, public links, task forms,
 *    REST / MCP default reads, workflow drafts and test runs).
 *  - A form has at most one working draft, shared by every editor
 *    (forms.edit): saving replaces it, opening the designer loads it. It
 *    records who saved it last and when, and the published version it
 *    started from.
 *  - Publishing copies the draft into forms through updateForm — the same
 *    validation, permission checks and accessibility gate as a direct save
 *    — so it bumps the version and snapshots it into form_versions (with
 *    the note and the publisher), then deletes the draft. Its reviewers go
 *    with it (ON DELETE CASCADE).
 *  - Draft reviewers: people and teams an editor shares the draft with.
 *    They may open the draft preview (getDraftPreview) read only, without
 *    forms.edit; nothing they enter is submitted. Access is checked here on
 *    every read (a reviewer row naming them or a team they are in) and ends
 *    when the draft is published or discarded, or the row is removed.
 *
 * Before the migration is applied (the table is missing) drafts are "not
 * available": saveDesignDraft publishes straight away exactly as the
 * designer's Save did before, and the draft reads return nothing.
 *
 * Writes use the service-role client with explicit tenant filters (the two
 * tables have no client grants).
 */

import { normalizeFormDefinition } from '@/lib/forms/definition'
import { compactLayoutForSave } from '@/lib/forms/layout'
import { FormThemeRefSchema, formatFormThemeIssues } from '@/lib/forms/form-theme'
import { diffFormContent, type FormDraftDiff } from '@/lib/forms/draft-diff'
import { hasPerm, isServiceError, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient, syncChange } from './_shared'
import { FORM_LIMITS, getFormVersion, resolveThemeOverrides, updateForm, validateFormContent, type FormRow } from './forms'

/* eslint-disable @typescript-eslint/no-explicit-any -- the draft tables are not in the generated Database types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DRAFT_COLUMNS = 'form_id, tenant_id, fields, layout, theme, buttons, header, base_version, created_by, updated_by, created_at, updated_at'
const REVIEWER_COLUMNS = 'id, form_id, principal_type, principal_id, added_by, created_at'

export const PUBLISH_NOTE_MAX = 1000
export const SHARE_NOTE_MAX = 1000
export const MAX_REVIEWERS_PER_DRAFT = 100
export const MAX_REVIEWERS_PER_SHARE = 50
/** Members of a shared team are notified when the team is at most this big. */
export const TEAM_NOTIFY_CAP = 25
/** "Ana is editing the draft": the last save was this recent (ms). */
export const EDITING_WINDOW_MS = 10 * 60 * 1000

export type ReviewerType = 'user' | 'team'

export interface DesignDraftRow {
  form_id: string
  tenant_id: string
  fields: unknown[]
  layout: unknown | null
  theme: unknown
  buttons: unknown[] | null
  header: unknown | null
  base_version: number
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface DraftSummary {
  updated_at: string
  created_at: string
  updated_by: { id: string; name: string } | null
  /** The published version the draft started from (behind the form's version when someone published meanwhile). */
  base_version: number
  reviewer_count: number
}

export interface DraftReviewer {
  id: string
  principal_type: ReviewerType
  principal_id: string
  name: string
  /** Team members (null for a person). */
  member_count: number | null
  added_by: { id: string; name: string } | null
  created_at: string
}

export interface DraftContentInput {
  fields?: unknown
  layout?: unknown
  theme?: unknown
  buttons?: unknown
  header?: unknown
}

// ── availability (the migration) ────────────────────────────────────────────

/** PostgREST / Postgres "table does not exist" (the drafts migration not applied yet). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || /Could not find the table|relation .* does not exist/i.test(String(error?.message ?? ''))
}

let availability: { value: boolean; at: number } | null = null

/** For tests. */
export function resetDesignDraftAvailability() { availability = null }

/**
 * Is the drafts table there? Remembered once true; a missing table is
 * re-checked after 30 s, so applying the migration takes effect without a
 * redeploy.
 */
export async function designDraftsAvailable(db: AnySupabaseClient): Promise<boolean> {
  if (availability?.value) return true
  if (availability && Date.now() - availability.at < 30_000) return false
  const { error } = await (db as any).from('form_design_drafts').select('form_id').limit(1)
  if (error && !isMissingTable(error)) throw dbError(error)
  availability = { value: !error, at: Date.now() }
  return availability.value
}

async function requireDrafts(db: AnySupabaseClient) {
  if (!(await designDraftsAvailable(db))) {
    throw ServiceError.conflict('Form drafts are not enabled on this server yet (migration 20270110000000_form_design_drafts.sql). Saving a form publishes it straight away.')
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

async function loadFormRow(db: AnySupabaseClient, tenantId: string, formId: string): Promise<FormRow> {
  if (!UUID_RE.test(String(formId))) throw ServiceError.notFound('Form not found')
  const { data, error } = await (db as any).from('forms').select('id, name, fields, layout, theme, buttons, header, version, updated_at')
    .eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  return data as FormRow
}

async function draftRow(db: AnySupabaseClient, tenantId: string, formId: string): Promise<DesignDraftRow | null> {
  const { data, error } = await (db as any).from('form_design_drafts').select(DRAFT_COLUMNS).eq('tenant_id', tenantId).eq('form_id', formId).maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw dbError(error)
  }
  return (data ?? null) as DesignDraftRow | null
}

/** The form's draft row, or null (no permission check: callers check). */
export async function loadDesignDraft(ctx: ServiceContext, formId: string): Promise<DesignDraftRow | null> {
  if (!UUID_RE.test(String(formId))) return null
  return draftRow(await serviceRoleClient(ctx), ctx.tenantId, formId)
}

async function userNames(db: AnySupabaseClient, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean) as string[])]
  if (!list.length) return new Map()
  const { data } = await (db as any).from('users').select('id, display_name, email').in('id', list)
  return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
}

export async function draftSummary(ctx: ServiceContext, draft: DesignDraftRow): Promise<DraftSummary> {
  const db = await serviceRoleClient(ctx)
  const [names, reviewers] = await Promise.all([
    userNames(db, [draft.updated_by]),
    (db as any).from('form_design_draft_reviewers').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('form_id', draft.form_id),
  ])
  return {
    updated_at: draft.updated_at,
    created_at: draft.created_at,
    updated_by: draft.updated_by ? { id: draft.updated_by, name: names.get(draft.updated_by) ?? 'Former member' } : null,
    base_version: draft.base_version,
    reviewer_count: reviewers.count ?? 0,
  }
}

/** Of these forms, the ones with a draft → when it was last saved (the library's "Draft changes"). */
export async function draftedFormIds(ctx: ServiceContext, formIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!formIds.length) return out
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('form_design_drafts').select('form_id, updated_at').eq('tenant_id', ctx.tenantId).in('form_id', formIds.slice(0, 1000))
  if (error) {
    if (isMissingTable(error)) return out
    throw dbError(error)
  }
  for (const row of (data ?? []) as any[]) out.set(String(row.form_id), String(row.updated_at))
  return out
}

/** What would block publishing this content (today's save validation), as messages; [] = publishable. */
export function publishProblems(content: DraftContentInput, tenantId?: string): string[] {
  try {
    validateFormContent({ fields: content.fields ?? [], layout: content.layout, theme: content.theme, buttons: content.buttons, header: content.header }, { tenantId })
    return []
  } catch (error) {
    if (!isServiceError(error)) throw error
    const fields = (error.details as { fields?: Record<string, string> } | undefined)?.fields
    if (fields && Object.keys(fields).length > 1) return Object.entries(fields).slice(0, 20).map(([key, msg]) => `Field "${key}": ${msg}`)
    return [error.message]
  }
}

export interface DesignDraftView {
  /** false until the drafts migration is applied (Save then publishes directly). */
  available: boolean
  form: { id: string; name: string; version: number }
  draft: (DesignDraftRow & { summary: DraftSummary }) | null
  publish_problems: string[]
}

/** The designer's view: the draft (content + who saved it), or null (forms.edit). */
export async function getDesignDraft(ctx: ServiceContext, formId: string): Promise<DesignDraftView> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  const available = await designDraftsAvailable(db)
  const draft = available ? await draftRow(db, ctx.tenantId, formId) : null
  return {
    available,
    form: { id: form.id, name: form.name, version: form.version },
    draft: draft ? { ...draft, summary: await draftSummary(ctx, draft) } : null,
    publish_problems: draft ? publishProblems(draft, ctx.tenantId) : [],
  }
}

// ── save ────────────────────────────────────────────────────────────────────

/**
 * Normalise a draft's content for storage. Lighter than publishing: the
 * shape, the limits and the theme reference are checked; field problems,
 * buttons and data targets are checked when it is published (and reported
 * back as publish_problems meanwhile).
 */
export function cleanDraftContent(input: Required<Pick<DraftContentInput, 'fields'>> & DraftContentInput) {
  if (!Array.isArray(input.fields)) throw ServiceError.validation('fields must be an array')
  if (input.fields.length > FORM_LIMITS.fields) throw ServiceError.validation(`A form can have at most ${FORM_LIMITS.fields} fields`)
  if (input.buttons !== undefined && input.buttons !== null && !Array.isArray(input.buttons)) throw ServiceError.validation('buttons must be an array')
  const themeRaw = input.theme ?? { source: 'workspace' }
  const theme = FormThemeRefSchema.safeParse(themeRaw)
  if (!theme.success) throw ServiceError.validation(`Invalid form theme: ${formatFormThemeIssues(theme.error)}`)
  const def = normalizeFormDefinition({ fields: input.fields, layout: input.layout, theme: theme.data, buttons: input.buttons, header: input.header })
  const layout = def.layout ? compactLayoutForSave(def.layout, def.fields.map((f) => f.key)) : null
  const stored = { fields: def.fields as unknown[], layout, theme: def.theme, buttons: (def.buttons ?? null) as unknown[] | null, header: def.header ?? null }
  if (JSON.stringify(stored).length > FORM_LIMITS.bytes) throw ServiceError.validation('Form is too large')
  return stored
}

export type SaveDraftResult =
  | { mode: 'draft'; draft: DesignDraftRow & { summary: DraftSummary }; publish_problems: string[] }
  /** Drafts not available (migration not applied): saved and published as a new version, as before. */
  | { mode: 'live'; form: FormRow & { version_changed: boolean } }

/**
 * Save the form's working draft (create or replace; partial input keeps
 * the rest of the draft, or of the published form for a new draft).
 * expected_updated_at: the draft's updated_at the editor loaded (null: there
 * was no draft) — a 409 when someone saved or started it since ("reload to
 * see their changes"). Omitted: last save wins (API callers).
 */
export async function saveDesignDraft(ctx: ServiceContext, formId: string, input: DraftContentInput & { expected_updated_at?: string | null }): Promise<SaveDraftResult> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  if (!(await designDraftsAvailable(db))) {
    const { expected_updated_at: _ignored, ...content } = input
    return { mode: 'live', form: await updateForm(ctx, formId, content) }
  }
  const existing = await draftRow(db, ctx.tenantId, formId)
  if (input.expected_updated_at && existing && existing.updated_at !== input.expected_updated_at) {
    const names = await userNames(db, [existing.updated_by])
    const who = existing.updated_by ? (existing.updated_by === ctx.actorId ? 'You' : names.get(existing.updated_by) ?? 'Someone') : 'Someone'
    throw new ServiceError('conflict', `${who} saved this draft since you opened it. Reload to see the latest draft before saving.`, { details: { draft_updated_at: existing.updated_at } })
  }
  // null: the editor opened the form with no draft — someone started one since.
  if (input.expected_updated_at === null && existing && existing.updated_by !== ctx.actorId) {
    const names = await userNames(db, [existing.updated_by])
    throw new ServiceError('conflict', `${(existing.updated_by && names.get(existing.updated_by)) || 'Someone'} started a draft of this form since you opened it. Reload to open their draft before saving.`, { details: { draft_updated_at: existing.updated_at } })
  }
  if (input.expected_updated_at && !existing) {
    throw ServiceError.conflict('This draft was published or discarded since you opened it. Reload to start from the published form.')
  }
  const base = existing ?? form
  const pick = <K extends keyof DraftContentInput>(k: K) => (input[k] !== undefined ? input[k] : (base as any)[k])
  const stored = cleanDraftContent({ fields: pick('fields'), layout: pick('layout'), theme: pick('theme'), buttons: pick('buttons'), header: pick('header') })
  let row: DesignDraftRow | null
  if (existing) {
    let query = (db as any).from('form_design_drafts').update({ ...stored, updated_by: ctx.actorId }).eq('tenant_id', ctx.tenantId).eq('form_id', formId)
    if (input.expected_updated_at) query = query.eq('updated_at', input.expected_updated_at)
    const { data, error } = await query.select(DRAFT_COLUMNS).maybeSingle()
    if (error) throw dbError(error, 'Failed to save the draft')
    if (!data) throw ServiceError.conflict('Someone saved this draft at the same moment. Reload to see the latest draft before saving.')
    row = data as DesignDraftRow
  } else {
    const { data, error } = await (db as any).from('form_design_drafts').insert({
      form_id: formId, tenant_id: ctx.tenantId, ...stored, base_version: form.version, created_by: ctx.actorId, updated_by: ctx.actorId,
    }).select(DRAFT_COLUMNS).single()
    if ((error as { code?: string } | null)?.code === '23505') throw ServiceError.conflict('Someone started a draft of this form at the same moment. Reload to open it.')
    if (error || !data) throw dbError(error, 'Failed to save the draft')
    row = data as DesignDraftRow
    await audit(ctx, { objectType: 'form', objectId: formId, action: 'update', summary: `Started a draft of form "${form.name}"`, metadata: { draft: true, base_version: form.version } })
  }
  return { mode: 'draft', draft: { ...row!, summary: await draftSummary(ctx, row!) }, publish_problems: publishProblems(row!, ctx.tenantId) }
}

// ── publish / discard / restore ─────────────────────────────────────────────

function cleanNote(value: unknown, max: number, label: string): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > max) throw ServiceError.validation(`${label} must be at most ${max} characters`)
  return text || null
}

export interface PublishResult {
  form: FormRow
  version: number
  /** false when the draft matched the published content (no new version; the draft is cleared). */
  version_changed: boolean
  note: string | null
}

/**
 * Publish the draft: a new version from its content (updateForm: the same
 * validation, permission checks and accessibility gate as a save; a
 * form_versions snapshot with the note and the publisher), then the draft
 * and its reviewers are removed. Blocked with the validation message when
 * the draft has problems.
 */
export async function publishDesignDraft(ctx: ServiceContext, formId: string, input: { note?: string | null } = {}): Promise<PublishResult> {
  requirePerm(ctx, 'forms.edit')
  const note = cleanNote(input.note, PUBLISH_NOTE_MAX, 'The publish note')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  await requireDrafts(db)
  const draft = await draftRow(db, ctx.tenantId, formId)
  if (!draft) throw ServiceError.notFound('This form has no draft to publish')
  let updated: FormRow & { version_changed: boolean }
  try {
    updated = await updateForm(ctx, formId, { fields: draft.fields, layout: draft.layout, theme: draft.theme, buttons: draft.buttons, header: draft.header }, { capture: false, versionNote: note })
  } catch (error) {
    if (isServiceError(error) && error.code === 'validation_error') {
      throw new ServiceError('validation_error', `Can't publish: ${error.message}`, { details: error.details })
    }
    throw error
  }
  // Only the draft that was published: a save that landed meanwhile stays a draft.
  const { error: deleteError } = await (db as any).from('form_design_drafts').delete().eq('tenant_id', ctx.tenantId).eq('form_id', formId).eq('updated_at', draft.updated_at)
  if (deleteError) throw dbError(deleteError, 'Published, but the draft could not be cleared')
  await audit(ctx, {
    objectType: 'form', objectId: formId, action: 'publish',
    summary: updated.version_changed ? `Published form "${updated.name}" (version ${updated.version})` : `Published form "${updated.name}" (no changes; version ${updated.version} kept)`,
    metadata: { version: updated.version, previous_version: form.version, note, from_draft: true, version_changed: updated.version_changed },
  })
  if (updated.version_changed) await syncChange(ctx, 'form', updated)
  return { form: updated, version: updated.version, version_changed: updated.version_changed, note }
}

/** Throw away the draft (and its reviewers' access); the published form is untouched. */
export async function discardDesignDraft(ctx: ServiceContext, formId: string): Promise<{ discarded: true; form_id: string }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  await requireDrafts(db)
  const { data, error } = await (db as any).from('form_design_drafts').delete().eq('tenant_id', ctx.tenantId).eq('form_id', formId).select('form_id')
  if (error) throw dbError(error, 'Failed to discard the draft')
  if (!(data ?? []).length) throw ServiceError.notFound('This form has no draft')
  await audit(ctx, { objectType: 'form', objectId: formId, action: 'discard_draft', summary: `Discarded the draft of form "${form.name}"`, metadata: { version: form.version } })
  return { discarded: true, form_id: formId }
}

/** "Compare with published": what the draft changes. */
export async function compareDesignDraft(ctx: ServiceContext, formId: string): Promise<{ form_id: string; published_version: number; base_version: number | null; has_draft: boolean; diff: FormDraftDiff }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  const draft = (await designDraftsAvailable(db)) ? await draftRow(db, ctx.tenantId, formId) : null
  return { form_id: formId, published_version: form.version, base_version: draft?.base_version ?? null, has_draft: Boolean(draft), diff: diffFormContent(form, draft ?? form) }
}

/** Version history → "Restore as draft": the version's content becomes the draft (replacing any draft). */
export async function restoreFormVersionAsDraft(ctx: ServiceContext, formId: string, version: number): Promise<{ mode: 'draft'; draft: DesignDraftRow & { summary: DraftSummary }; publish_problems: string[]; restored_version: number }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  await requireDrafts(db)
  const snapshot = await getFormVersion(ctx, formId, version)
  const stored = cleanDraftContent({ fields: snapshot.fields, layout: snapshot.layout, theme: snapshot.theme, buttons: snapshot.buttons ?? null, header: snapshot.header ?? null })
  const { data, error } = await (db as any).from('form_design_drafts').upsert({
    form_id: formId, tenant_id: ctx.tenantId, ...stored, base_version: form.version, created_by: ctx.actorId, updated_by: ctx.actorId,
  }, { onConflict: 'form_id' }).select(DRAFT_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to restore the version')
  const row = data as DesignDraftRow
  await audit(ctx, { objectType: 'form', objectId: formId, action: 'restore', summary: `Restored version ${version} of form "${form.name}" as a draft`, metadata: { version, published_version: form.version, draft: true } })
  return { mode: 'draft', draft: { ...row, summary: await draftSummary(ctx, row) }, publish_problems: publishProblems(row, ctx.tenantId), restored_version: version }
}

// ── reviewers ("Share draft") ───────────────────────────────────────────────

async function presentReviewers(db: AnySupabaseClient, tenantId: string, rows: any[]): Promise<DraftReviewer[]> {
  const userIds = rows.filter((r) => r.principal_type === 'user').map((r) => String(r.principal_id))
  const teamIds = rows.filter((r) => r.principal_type === 'team').map((r) => String(r.principal_id))
  const [users, teams, members] = await Promise.all([
    userNames(db, [...userIds, ...rows.map((r) => r.added_by)]),
    teamIds.length ? (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', teamIds) : { data: [] },
    teamIds.length ? (db as any).from('user_teams').select('team_id').in('team_id', teamIds).limit(5000) : { data: [] },
  ])
  const teamName = new Map<string, string>(((teams.data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')]))
  const count = new Map<string, number>()
  for (const m of (members.data ?? []) as any[]) count.set(String(m.team_id), (count.get(String(m.team_id)) ?? 0) + 1)
  return rows.map((r) => {
    const pid = String(r.principal_id)
    const type = r.principal_type as ReviewerType
    return {
      id: String(r.id), principal_type: type, principal_id: pid,
      name: type === 'user' ? users.get(pid) ?? 'Former member' : teamName.get(pid) ?? 'Deleted team',
      member_count: type === 'team' ? count.get(pid) ?? 0 : null,
      added_by: r.added_by ? { id: String(r.added_by), name: users.get(String(r.added_by)) ?? 'Someone' } : null,
      created_at: String(r.created_at),
    }
  })
}

async function reviewerRows(db: AnySupabaseClient, tenantId: string, formId: string): Promise<any[]> {
  const { data, error } = await (db as any).from('form_design_draft_reviewers').select(REVIEWER_COLUMNS).eq('tenant_id', tenantId).eq('form_id', formId).order('created_at').limit(MAX_REVIEWERS_PER_DRAFT)
  if (error) {
    if (isMissingTable(error)) return []
    throw dbError(error)
  }
  return (data ?? []) as any[]
}

/** Who the draft is shared with (forms.edit). */
export async function listDraftReviewers(ctx: ServiceContext, formId: string): Promise<{ form_id: string; has_draft: boolean; reviewers: DraftReviewer[] }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  await loadFormRow(db, ctx.tenantId, formId)
  const draft = (await designDraftsAvailable(db)) ? await draftRow(db, ctx.tenantId, formId) : null
  return { form_id: formId, has_draft: Boolean(draft), reviewers: draft ? await presentReviewers(db, ctx.tenantId, await reviewerRows(db, ctx.tenantId, formId)) : [] }
}

export function parseReviewerPrincipals(input: unknown): Array<{ type: ReviewerType; id: string }> {
  if (!Array.isArray(input) || !input.length) throw ServiceError.validation('Choose at least one person or team to share the draft with')
  const seen = new Set<string>()
  const out: Array<{ type: ReviewerType; id: string }> = []
  for (const raw of input) {
    const type = String((raw as any)?.type ?? '') as ReviewerType
    const id = String((raw as any)?.id ?? '').trim().toLowerCase()
    if (type !== 'user' && type !== 'team') throw ServiceError.validation('Each reviewer has a type: user or team')
    if (!UUID_RE.test(id)) throw ServiceError.validation(`Invalid ${type === 'user' ? 'person' : 'team'} id`)
    if (seen.has(`${type}:${id}`)) continue
    seen.add(`${type}:${id}`)
    out.push({ type, id })
  }
  if (out.length > MAX_REVIEWERS_PER_SHARE) throw ServiceError.validation(`Share with at most ${MAX_REVIEWERS_PER_SHARE} people or teams at a time`)
  return out
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function draftPreviewPath(formId: string) {
  return `/forms/${formId}/draft-preview`
}

async function notifyReviewers(db: AnySupabaseClient, tenantId: string, form: { id: string; name: string }, actorName: string, note: string | null, people: { direct: string[]; team: string[] }) {
  try {
    const title = `${actorName} shared a form draft with you: ${form.name}`
    const body = note ? `${actorName}: ${note}` : 'Preview the draft before it is published (read only — nothing you enter is submitted).'
    const rows = [...people.direct, ...people.team].map((userId) => ({ user_id: userId, tenant_id: tenantId, type: 'form_draft_shared', title: title.slice(0, 300), body: body.slice(0, 1000), form_id: form.id }))
    if (rows.length) {
      const { error } = await (db as any).from('notifications').insert(rows)
      if (error) console.warn('[form-design-drafts] notification insert failed:', error.message)
    }
    if (!people.direct.length) return
    const { data: users } = await (db as any).from('users').select('id, email').in('id', people.direct)
    const [{ sendEmail }, { appUrlOrLocalhost }] = await Promise.all([import('@/lib/email'), import('@/lib/config/bootstrap')])
    const link = `${appUrlOrLocalhost().replace(/\/$/, '')}${draftPreviewPath(form.id)}`
    for (const u of (users ?? []) as any[]) {
      if (!u.email) continue
      await sendEmail({
        to: String(u.email),
        subject: title.slice(0, 200),
        body: `<p>${escapeHtml(actorName)} shared a draft of the form <strong>${escapeHtml(form.name)}</strong> with you, to review before it is published. You can fill it in to try it — nothing is submitted.</p>`
          + (note ? `<p>${escapeHtml(note)}</p>` : '')
          + `<p><a href="${escapeHtml(link)}">Preview the draft</a></p>`,
      }).catch(() => undefined)
    }
  } catch (error) {
    console.warn('[form-design-drafts] notify failed:', error instanceof Error ? error.message : error)
  }
}

/** Share the draft with people and teams (forms.edit; the form must have a draft). Already-shared ones are left as they are. */
export async function addDraftReviewers(ctx: ServiceContext, formId: string, input: { principals: unknown; note?: string | null }): Promise<{ form_id: string; added: DraftReviewer[]; existing: number; notified: number; preview_path: string }> {
  requirePerm(ctx, 'forms.edit')
  const principals = parseReviewerPrincipals(input.principals)
  const note = cleanNote(input.note, SHARE_NOTE_MAX, 'The note')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  await requireDrafts(db)
  if (!(await draftRow(db, ctx.tenantId, formId))) throw ServiceError.conflict('Save a draft first: there is nothing to share until the form has unpublished changes')
  const users = principals.filter((p) => p.type === 'user').map((p) => p.id)
  const teams = principals.filter((p) => p.type === 'team').map((p) => p.id)
  const [okUsers, okTeams] = await Promise.all([
    users.length ? (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).in('user_id', users) : { data: [] },
    teams.length ? (db as any).from('teams').select('id').eq('tenant_id', ctx.tenantId).in('id', teams) : { data: [] },
  ])
  const valid = { user: new Set(((okUsers.data ?? []) as any[]).map((r) => String(r.user_id))), team: new Set(((okTeams.data ?? []) as any[]).map((r) => String(r.id))) }
  const bad = principals.find((p) => !valid[p.type].has(p.id))
  if (bad) throw ServiceError.validation(bad.type === 'user' ? 'That person is not a member of this workspace' : 'That team is not in this workspace')

  const existingRows = await reviewerRows(db, ctx.tenantId, formId)
  const existing = new Set(existingRows.map((r) => `${r.principal_type}:${r.principal_id}`))
  const fresh = principals.filter((p) => !existing.has(`${p.type}:${p.id}`) && !(p.type === 'user' && p.id === ctx.actorId))
  if (existing.size + fresh.length > MAX_REVIEWERS_PER_DRAFT) throw ServiceError.validation(`A draft can be shared with at most ${MAX_REVIEWERS_PER_DRAFT} people and teams`)
  if (!fresh.length) return { form_id: formId, added: [], existing: principals.length, notified: 0, preview_path: draftPreviewPath(formId) }
  const { data: inserted, error } = await (db as any).from('form_design_draft_reviewers').insert(fresh.map((p) => ({
    tenant_id: ctx.tenantId, form_id: formId, principal_type: p.type, principal_id: p.id, added_by: ctx.actorId,
  }))).select(REVIEWER_COLUMNS)
  if (error) throw dbError(error, 'Failed to share the draft')
  const added = await presentReviewers(db, ctx.tenantId, (inserted ?? []) as any[])

  // Notify: people named directly, and members of small teams (not the actor; active members only).
  const direct = new Set(fresh.filter((p) => p.type === 'user').map((p) => p.id))
  const team = new Set<string>()
  for (const p of fresh.filter((x) => x.type === 'team')) {
    const { data } = await (db as any).from('user_teams').select('user_id').eq('team_id', p.id).limit(TEAM_NOTIFY_CAP + 1)
    const ids = ((data ?? []) as any[]).map((r) => String(r.user_id))
    if (ids.length > TEAM_NOTIFY_CAP) continue
    for (const id of ids) if (!direct.has(id)) team.add(id)
  }
  if (ctx.actorId) { direct.delete(ctx.actorId); team.delete(ctx.actorId) }
  const all = [...direct, ...team]
  const { data: active } = all.length ? await (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).in('user_id', all) : { data: [] }
  const keep = new Set(((active ?? []) as any[]).map((r) => String(r.user_id)))
  const people = { direct: [...direct].filter((id) => keep.has(id)), team: [...team].filter((id) => keep.has(id)) }
  const actorName = ctx.actorId ? (await userNames(db, [ctx.actorId])).get(ctx.actorId) ?? 'Someone' : 'Someone'
  await notifyReviewers(db, ctx.tenantId, { id: formId, name: form.name }, actorName, note, people)
  await audit(ctx, {
    objectType: 'form', objectId: formId, action: 'share',
    summary: `Shared the draft of form "${form.name}" with ${added.map((r) => r.principal_type === 'team' ? `${r.name} (team)` : r.name).join(', ').slice(0, 300)}`,
    metadata: { draft: true, reviewers: added.map((r) => ({ type: r.principal_type, id: r.principal_id })), note },
  })
  return { form_id: formId, added, existing: principals.length - fresh.length, notified: people.direct.length + people.team.length, preview_path: draftPreviewPath(formId) }
}

/** Stop sharing the draft with one reviewer (by the reviewer row's id, or a principal). */
export async function removeDraftReviewer(ctx: ServiceContext, formId: string, target: { id?: string; type?: string; principal_id?: string }): Promise<{ form_id: string; removed: DraftReviewer }> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  await requireDrafts(db)
  let query = (db as any).from('form_design_draft_reviewers').select(REVIEWER_COLUMNS).eq('tenant_id', ctx.tenantId).eq('form_id', formId)
  if (target.id) {
    if (!UUID_RE.test(target.id)) throw ServiceError.notFound('Reviewer not found')
    query = query.eq('id', target.id)
  } else {
    const [p] = parseReviewerPrincipals([{ type: target.type, id: target.principal_id }])
    query = query.eq('principal_type', p.type).eq('principal_id', p.id)
  }
  const { data: row, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!row) throw ServiceError.notFound('Reviewer not found')
  const { error: deleteError } = await (db as any).from('form_design_draft_reviewers').delete().eq('tenant_id', ctx.tenantId).eq('id', row.id)
  if (deleteError) throw dbError(deleteError, 'Failed to remove the reviewer')
  const [removed] = await presentReviewers(db, ctx.tenantId, [row])
  await audit(ctx, { objectType: 'form', objectId: formId, action: 'unshare', summary: `Stopped sharing the draft of form "${form.name}" with ${removed.name}`, metadata: { draft: true, reviewer: { type: removed.principal_type, id: removed.principal_id } } })
  return { form_id: formId, removed }
}

/**
 * May this person preview the form's draft? Editors (forms.edit) always;
 * otherwise a reviewer row naming them or one of their teams. Server-side
 * check for the preview page and its read.
 */
export async function draftReviewerAccess(db: AnySupabaseClient, tenantId: string, formId: string, userId: string | null): Promise<{ via: ReviewerType; added_by: string | null } | null> {
  if (!userId) return null
  const rows = await reviewerRows(db, tenantId, formId)
  const mine = rows.find((r) => r.principal_type === 'user' && String(r.principal_id) === userId)
  if (mine) return { via: 'user', added_by: mine.added_by ?? null }
  const teamRows = rows.filter((r) => r.principal_type === 'team')
  if (!teamRows.length) return null
  const { data } = await (db as any).from('user_teams').select('team_id').eq('user_id', userId).in('team_id', teamRows.map((r) => String(r.principal_id)))
  const inTeam = new Set(((data ?? []) as any[]).map((r) => String(r.team_id)))
  const via = teamRows.find((r) => inTeam.has(String(r.principal_id)))
  return via ? { via: 'team', added_by: via.added_by ?? null } : null
}

export interface DraftPreview {
  form: { id: string; name: string; published_version: number }
  definition: { fields: unknown[]; layout: unknown | null; theme: unknown; buttons: unknown[] | null; header: unknown | null }
  theme_overrides: unknown | null
  updated_at: string
  updated_by: { id: string; name: string } | null
  /** editor: has forms.edit; reviewer: shared with them (user or team). */
  access: 'editor' | 'reviewer'
  shared_by: { id: string; name: string } | null
}

const NO_DRAFT = 'This draft is no longer shared with you — it may have been published or discarded.'

/** The draft preview (/forms/<id>/draft-preview): editors and reviewers only; everyone else gets 404. */
export async function getDraftPreview(ctx: ServiceContext, formId: string): Promise<DraftPreview> {
  if (!UUID_RE.test(String(formId))) throw ServiceError.notFound(NO_DRAFT)
  const db = await serviceRoleClient(ctx)
  const editor = hasPerm(ctx, 'forms.edit')
  if (!(await designDraftsAvailable(db))) throw ServiceError.notFound(NO_DRAFT)
  const draft = await draftRow(db, ctx.tenantId, formId)
  if (!draft) throw ServiceError.notFound(NO_DRAFT)
  const reviewer = editor ? null : await draftReviewerAccess(db, ctx.tenantId, formId, ctx.actorId)
  if (!editor && !reviewer) throw ServiceError.notFound(NO_DRAFT)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  const names = await userNames(db, [draft.updated_by, reviewer?.added_by])
  const theme = (draft.theme ?? { source: 'workspace' }) as any
  return {
    form: { id: form.id, name: form.name, published_version: form.version },
    definition: { fields: draft.fields, layout: draft.layout, theme: draft.theme, buttons: draft.buttons, header: draft.header },
    theme_overrides: await resolveThemeOverrides(db, ctx.tenantId, theme).catch(() => null),
    updated_at: draft.updated_at,
    updated_by: draft.updated_by ? { id: draft.updated_by, name: names.get(draft.updated_by) ?? 'Former member' } : null,
    access: editor ? 'editor' : 'reviewer',
    shared_by: reviewer?.added_by ? { id: reviewer.added_by, name: names.get(reviewer.added_by) ?? 'Someone' } : null,
  }
}
