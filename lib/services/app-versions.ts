/**
 * App drafts and publishing (migration 20270123090000_app_drafts.sql): one
 * implementation behind the builder (Publish, Discard draft, Version
 * history, Compare, Restore), REST /api/v1/apps/{id}/publish, /draft,
 * /versions, /compare, the MCP apps_publish / apps_draft_discard /
 * apps_versions / apps_version_get / apps_compare / apps_version_restore
 * tools, the CLI and the Agent.
 *
 * The model (lib/apps/versions.ts has the snapshot shape):
 *  - The app rows (apps + app_pages) are the working DRAFT, shared by every
 *    editor; all builder, API, MCP and Agent writes change it and mark it
 *    changed (lib/services/apps.ts).
 *  - Publishing snapshots the whole draft — header, menu, settings (nav,
 *    params, variables, rules, style) and every page — into app_versions
 *    as the next version and points apps.published_version at it. The
 *    audience sees only that version (lib/services/apps.ts resolveContent).
 *  - Discarding writes the published snapshot back into the draft; restoring
 *    writes any version into the draft (nothing changes for the audience
 *    until it is published).
 *  - Not versioned: the slug, the audience and the editors (access is
 *    effective at once, like form permission grants).
 *  - Who: the app's editors or apps.manage (edit access). Publish, discard
 *    and restore are audited on the app.
 *
 * Before the migration is applied drafts are "not available": these calls
 * answer 409 and every save is live, as before.
 */

import { buildAppSnapshot, diffAppSnapshots, readSnapshot, snapshotSummary, PUBLISH_NOTE_MAX, type AppSnapshot, type AppSnapshotDiff } from '@/lib/apps/versions'
import { normaliseMenu, normaliseNav, normalisePageLayout, MAX_PAGES } from '@/lib/apps/schema'
import { appDesignWarnings } from '@/lib/apps/lint'
import { ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, resolvePage, syncChange } from './_shared'
import { appDraftsAvailable, loadPublishedSnapshot } from './app-published'
import { getAppAccessAnalysis, loadApp, loadDraftPageRows, pickVolatile, refreshAppAccessIssues, type LoadedApp } from './apps'

/* eslint-disable @typescript-eslint/no-explicit-any -- app_versions is not in the generated Database types */

const from = (db: AnySupabaseClient, table: string) => (db as any).from(table)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_ENABLED = 'App drafts are not enabled on this server yet (migration 20270123090000_app_drafts.sql). Every save goes live straight away.'

export interface AppVersionInfo {
  version: number
  note: string | null
  source: 'publish' | 'initial' | 'import'
  published_at: string
  published_by: { id: string; name: string } | null
  /** The version the audience sees now. */
  current: boolean
  /** Card fields of the version (name, icon, home page). */
  name: string
  pages: number
}

export interface AppPublishResult {
  app: { id: string; slug: string; name: string }
  version: number
  previous_version: number | null
  note: string | null
  /** What this version changed against the previous one (null for a first publish). */
  diff: AppSnapshotDiff | null
  /** People in the audience who can't use something the app shows (warnings; publishing is not blocked). */
  access: { issues: number; grantable: number } | null
  href: string
}

async function requireDrafts(db: AnySupabaseClient) {
  if (!(await appDraftsAvailable(db))) throw ServiceError.conflict(NOT_ENABLED)
}

function cleanNote(note: unknown): string | null {
  if (note === undefined || note === null) return null
  if (typeof note !== 'string') throw ServiceError.validation('note: must be text')
  const trimmed = note.trim()
  if (trimmed.length > PUBLISH_NOTE_MAX) throw ServiceError.validation(`The publish note is too long (at most ${PUBLISH_NOTE_MAX} characters)`)
  return trimmed || null
}

/** The draft as a snapshot (the app row + its pages as stored). */
export async function draftSnapshot(ctx: ServiceContext, db: AnySupabaseClient, row: LoadedApp['row']): Promise<AppSnapshot> {
  return buildAppSnapshot(row, await loadDraftPageRows(ctx, db, row.id))
}

/** What would block publishing the draft (empty: it can be published). */
export function publishProblems(snapshot: AppSnapshot): string[] {
  const problems: string[] = []
  if (!snapshot.pages.length) problems.push('The app has no pages: add at least one page')
  if (snapshot.pages.length > MAX_PAGES) problems.push(`The app has more than ${MAX_PAGES} pages`)
  for (const page of snapshot.pages) {
    const raw = Array.isArray((page.layout as any)?.widgets) ? (page.layout as any).widgets.length : 0
    const valid = normalisePageLayout(page.layout).widgets.length
    if (valid < raw) problems.push(`Page “${page.title}” has ${raw - valid} widget${raw - valid === 1 ? '' : 's'} that ${raw - valid === 1 ? 'is' : 'are'} not valid — open it in the builder and fix or remove ${raw - valid === 1 ? 'it' : 'them'}`)
  }
  return problems
}

async function nextVersion(ctx: ServiceContext, db: AnySupabaseClient, appId: string): Promise<number> {
  const { data, error } = await from(db, 'app_versions').select('version').eq('tenant_id', ctx.tenantId).eq('app_id', appId).order('version', { ascending: false }).limit(1)
  if (error) throw dbError(error)
  return Number(((data ?? []) as any[])[0]?.version ?? 0) + 1
}

/**
 * Publish this snapshot of an app as its next version (no permission checks:
 * the callers check edit access, or are an install the caller may run). A
 * draft change that lands meanwhile keeps the draft marked as changed.
 */
export async function publishSnapshot(ctx: ServiceContext, db: AnySupabaseClient, row: LoadedApp['row'], snapshot: AppSnapshot, opts: { note: string | null; source: 'publish' | 'import' }): Promise<number> {
  const actor = ctx.actorId && UUID_RE.test(ctx.actorId) ? ctx.actorId : null
  let version = await nextVersion(ctx, db, row.id)
  for (let attempt = 0; ; attempt++) {
    const { error } = await from(db, 'app_versions').insert({
      tenant_id: ctx.tenantId, app_id: row.id, version, snapshot, summary: snapshotSummary(snapshot), note: opts.note, source: opts.source, published_by: actor,
    })
    if (!error) break
    // Someone published at the same moment: take the next number.
    if (error.code === '23505' && attempt < 3) { version = await nextVersion(ctx, db, row.id); continue }
    throw dbError(error)
  }
  const now = new Date().toISOString()
  const { error: pointError } = await from(db, 'apps').update({ published_version: version, published_at: now, published_by: actor }).eq('tenant_id', ctx.tenantId).eq('id', row.id)
  if (pointError) throw dbError(pointError, `Version ${version} was saved, but could not be made live`)
  // Clear "changes not published" only if no draft change landed since the snapshot was read.
  let clear = from(db, 'apps').update({ has_draft_changes: false }).eq('tenant_id', ctx.tenantId).eq('id', row.id)
  clear = row.draft_updated_at ? clear.eq('draft_updated_at', row.draft_updated_at) : clear.is('draft_updated_at', null)
  const { error: clearError } = await clear
  if (clearError) throw dbError(clearError)
  return version
}

/**
 * Publish the app's draft as a new version (its editors or apps.manage).
 * Refused with the problems when the draft can't be published, and when it
 * matches the live version already. Access issues come back as warnings.
 */
export async function publishApp(ctx: ServiceContext, idOrSlug: string, input: { note?: string | null } = {}): Promise<AppPublishResult> {
  const note = cleanNote(input.note)
  const loaded = await loadApp(ctx, idOrSlug, 'edit')
  const { db, row } = loaded
  await requireDrafts(db)
  const snapshot = await draftSnapshot(ctx, db, row)
  const problems = publishProblems(snapshot)
  if (problems.length) throw ServiceError.validation(`Can't publish: ${problems.join('; ')}`, problems)
  const previous = row.published_version ?? null
  const before = previous ? await loadPublishedSnapshot(db, ctx.tenantId, row.id, previous) : null
  const diff = before ? diffAppSnapshots(before.snapshot, snapshot) : null
  if (diff?.unchanged) throw ServiceError.conflict(`Nothing to publish: the draft matches the published version (${previous})`)
  const version = await publishSnapshot(ctx, db, row, snapshot, { note, source: 'publish' })
  await audit(ctx, {
    objectType: 'app', objectId: row.id, action: 'publish',
    summary: `Published app "${snapshot.app.name}" (version ${version})`,
    metadata: { version, previous_version: previous, note, changes: diff?.lines.slice(0, 20) ?? ['First version'] },
  })
  void syncChange(ctx, 'app', { id: row.id, name: snapshot.app.name })
  let access: AppPublishResult['access'] = null
  try {
    const analysis = await getAppAccessAnalysis(ctx, row.id)
    access = { issues: analysis.gaps.length, grantable: analysis.grantable }
  } catch { access = null }
  return { app: { id: row.id, slug: row.slug, name: snapshot.app.name }, version, previous_version: previous, note, diff, access, href: `/apps/${row.slug}` }
}

/* ── Writing a snapshot into the draft ───────────────────────────────── */

/**
 * Replace the draft with a snapshot: header, menu and settings (keeping the
 * row's access-issue counts), and the pages — kept pages updated in place,
 * missing ones re-created with their ids, pages the snapshot doesn't have
 * removed. Slugs are moved aside first so a swap never collides.
 */
async function writeDraft(ctx: ServiceContext, db: AnySupabaseClient, row: LoadedApp['row'], snapshot: AppSnapshot, mark: { changed: boolean }): Promise<void> {
  const a = snapshot.app
  const current = await loadDraftPageRows(ctx, db, row.id)
  const wanted = new Map(snapshot.pages.map((p) => [p.id, p]))
  const stale = current.filter((p) => !wanted.has(p.id)).map((p) => p.id)
  if (stale.length) {
    const { error } = await from(db, 'app_pages').delete().eq('tenant_id', ctx.tenantId).eq('app_id', row.id).in('id', stale)
    if (error) throw dbError(error)
  }
  const kept = current.filter((p) => wanted.has(p.id))
  for (const [i, p] of kept.entries()) {
    if (p.slug === wanted.get(p.id)!.slug) continue
    const { error } = await from(db, 'app_pages').update({ slug: `restoring-${i}-${p.id.slice(0, 8)}` }).eq('tenant_id', ctx.tenantId).eq('id', p.id)
    if (error) throw dbError(error)
  }
  const keptIds = new Set(kept.map((p) => p.id))
  for (const page of snapshot.pages) {
    const values = { slug: page.slug, title: page.title, icon: page.icon, position: page.position, layout: page.layout, filters: page.filters }
    const { error } = keptIds.has(page.id)
      ? await from(db, 'app_pages').update(values).eq('tenant_id', ctx.tenantId).eq('id', page.id)
      : await from(db, 'app_pages').insert({ id: page.id, tenant_id: ctx.tenantId, app_id: row.id, ...values })
    if (error) throw dbError(error)
  }
  const actor = ctx.actorId && UUID_RE.test(ctx.actorId) ? ctx.actorId : null
  const { error } = await from(db, 'apps').update({
    name: a.name, subtitle: a.subtitle, description: a.description, icon: a.icon, color: a.color, menu: a.menu,
    settings: { ...a.settings, ...pickVolatile(row.settings) }, updated_by: actor,
    has_draft_changes: mark.changed, draft_updated_at: new Date().toISOString(), draft_updated_by: actor,
  }).eq('tenant_id', ctx.tenantId).eq('id', row.id)
  if (error) throw dbError(error)
}

/** Throw the draft away: the app goes back to its published version (editors). */
export async function discardAppDraft(ctx: ServiceContext, idOrSlug: string): Promise<{ discarded: true; app: { id: string; slug: string; name: string }; version: number }> {
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  await requireDrafts(db)
  if (row.published_version == null) throw ServiceError.conflict('This app has never been published: there is no published version to go back to (delete the app instead)')
  const published = await loadPublishedSnapshot(db, ctx.tenantId, row.id, row.published_version)
  if (!published) throw ServiceError.notFound('The published version could not be found')
  await writeDraft(ctx, db, row, published.snapshot, { changed: false })
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'discard_draft', summary: `Discarded the draft of app "${published.snapshot.app.name}" (back to version ${row.published_version})`, metadata: { version: row.published_version } })
  await refreshAppAccessIssues(ctx, row.id)
  return { discarded: true, app: { id: row.id, slug: row.slug, name: published.snapshot.app.name }, version: row.published_version }
}

/** Copy a version into the draft (replacing it); nothing changes for the audience until it is published. */
export async function restoreAppVersion(ctx: ServiceContext, idOrSlug: string, version: number): Promise<{ restored_version: number; app: { id: string; slug: string; name: string }; diff: AppSnapshotDiff | null }> {
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  await requireDrafts(db)
  const target = await loadPublishedSnapshot(db, ctx.tenantId, row.id, toVersion(version))
  if (!target) throw ServiceError.notFound(`Version ${version} not found`)
  const published = row.published_version ? await loadPublishedSnapshot(db, ctx.tenantId, row.id, row.published_version) : null
  const diff = published ? diffAppSnapshots(published.snapshot, target.snapshot) : null
  await writeDraft(ctx, db, row, target.snapshot, { changed: row.published_version !== target.version })
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'restore', summary: `Restored version ${target.version} of app "${target.snapshot.app.name}" into its draft`, metadata: { version: target.version, published_version: row.published_version ?? null, draft: true } })
  await refreshAppAccessIssues(ctx, row.id)
  return { restored_version: target.version, app: { id: row.id, slug: row.slug, name: target.snapshot.app.name }, diff }
}

function toVersion(v: unknown): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 1) throw ServiceError.validation('version: a version number (1, 2, …)')
  return n
}

/* ── Reads ───────────────────────────────────────────────────────────── */

async function names(db: AnySupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => UUID_RE.test(id)))]
  if (!unique.length) return new Map()
  const { data } = await from(db, 'users').select('id, display_name, email').in('id', unique)
  return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || (u.email ? String(u.email).split('@')[0] : 'Someone'))]))
}

/** The versions of an app, newest first (editors). */
export async function listAppVersions(ctx: ServiceContext, idOrSlug: string, page: { limit?: number; offset?: number } = {}): Promise<{ app: { id: string; slug: string }; published_version: number | null; has_draft_changes: boolean; versions: AppVersionInfo[] }> {
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  await requireDrafts(db)
  const { limit, offset } = resolvePage(page)
  let q = from(db, 'app_versions').select('version, note, source, published_at, published_by, summary, pages:snapshot->pages').eq('tenant_id', ctx.tenantId).eq('app_id', row.id).order('version', { ascending: false })
  q = limit ? q.range(offset, offset + limit - 1) : q
  const { data, error } = await q
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const who = await names(db, rows.map((r) => String(r.published_by ?? '')))
  return {
    app: { id: row.id, slug: row.slug },
    published_version: row.published_version ?? null,
    has_draft_changes: row.published_version == null || !!row.has_draft_changes,
    versions: rows.map((r) => ({
      version: Number(r.version), note: r.note ?? null, source: r.source ?? 'publish', published_at: String(r.published_at),
      published_by: r.published_by ? { id: String(r.published_by), name: who.get(String(r.published_by)) ?? 'Someone' } : null,
      current: Number(r.version) === row.published_version,
      name: String(r.summary?.name ?? ''), pages: Array.isArray(r.pages) ? r.pages.length : 0,
    })),
  }
}

/** One version's snapshot (editors). */
export async function getAppVersion(ctx: ServiceContext, idOrSlug: string, version: number): Promise<{ app: { id: string; slug: string }; version: number; current: boolean; snapshot: AppSnapshot; published_at: string }> {
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  await requireDrafts(db)
  const found = await loadPublishedSnapshot(db, ctx.tenantId, row.id, toVersion(version))
  if (!found) throw ServiceError.notFound(`Version ${version} not found`)
  return { app: { id: row.id, slug: row.slug }, version: found.version, current: found.version === row.published_version, snapshot: found.snapshot, published_at: found.published_at }
}

export type CompareSide = 'draft' | 'published' | number

function parseSide(v: unknown, fallback: CompareSide): CompareSide {
  if (v === undefined || v === null || v === '') return fallback
  if (v === 'draft' || v === 'published') return v
  return toVersion(v)
}

/**
 * Compare two versions of an app (editors): `from` / `to` are draft,
 * published or a version number — by default the published version against
 * the draft ("what publishing would change").
 */
export async function compareAppVersions(ctx: ServiceContext, idOrSlug: string, input: { from?: unknown; to?: unknown } = {}): Promise<{ app: { id: string; slug: string }; from: { side: CompareSide; version: number | null }; to: { side: CompareSide; version: number | null }; publish_problems: string[]; design_warnings: string[]; diff: AppSnapshotDiff }> {
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  await requireDrafts(db)
  const fromSide = parseSide(input.from, 'published')
  const toSide = parseSide(input.to, 'draft')
  let draft: AppSnapshot | null = null
  const load = async (side: CompareSide): Promise<{ snapshot: AppSnapshot; version: number | null }> => {
    if (side === 'draft') {
      draft ??= await draftSnapshot(ctx, db, row)
      return { snapshot: draft, version: null }
    }
    const v = side === 'published' ? row.published_version : side
    if (v == null) return { snapshot: readSnapshot({ app: { name: row.name }, pages: [] }), version: null }
    const found = await loadPublishedSnapshot(db, ctx.tenantId, row.id, v)
    if (!found) throw ServiceError.notFound(`Version ${v} not found`)
    return { snapshot: found.snapshot, version: found.version }
  }
  const [a, b] = [await load(fromSide), await load(toSide)]
  const problems = toSide === 'draft' ? publishProblems(b.snapshot) : []
  const design = toSide === 'draft' ? snapshotDesignWarnings(b.snapshot) : []
  return { app: { id: row.id, slug: row.slug }, from: { side: fromSide, version: a.version }, to: { side: toSide, version: b.version }, publish_problems: problems, design_warnings: design, diff: diffAppSnapshots(a.snapshot, b.snapshot) }
}

/** The builder's design checks over a snapshot (lib/apps/lint.ts): warnings only, publishing is never blocked by them. */
export function snapshotDesignWarnings(snapshot: AppSnapshot): string[] {
  const nav = normaliseNav((snapshot.app.settings as { nav?: unknown } | undefined)?.nav)
  const pages = snapshot.pages.map((p) => ({ ...p, layout: normalisePageLayout(p.layout) }))
  return appDesignWarnings({
    nav, menu: normaliseMenu(snapshot.app.menu),
    pages: pages.map((p) => ({ slug: p.slug, title: p.title, icon: p.icon, hidden: p.layout.options?.hidden })),
    pageLayouts: pages.map((p) => ({ title: p.title, widgets: p.layout.widgets })),
  })
}
