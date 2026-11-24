/**
 * App builder (Phase 1): apps, their pages, audience and editors. Shared by
 * /api/v1/apps*, the MCP apps_* tools, the CLI (through REST), the Apps menu
 * and the app pages / builder (server actions in app/actions/apps.ts).
 *
 * Access (lib/apps/access.ts, mirrored in SQL by public.app_access):
 *  - apps.manage: create apps, edit and delete every app in the workspace.
 *  - an app's editors: edit that app (settings, menu, pages, audience).
 *  - apps.view + the audience names the person, a team they are in or a
 *    role they hold: open the app.
 *  - anyone else: the app does not exist for them (404), including every
 *    app of another workspace.
 *
 * Service-role client with explicit tenant filters, after these checks (RLS
 * on the tables is the same rule for direct session reads).
 *
 * Drafts (migration 20270123090000, lib/services/app-versions.ts): the app
 * rows (apps, app_pages) are the working DRAFT — every write here changes
 * the draft and marks it changed. The audience always gets the latest
 * PUBLISHED snapshot (app_versions): pages, widgets, menu, rules, rule
 * actions, the Apps menu cards; an app never published does not exist for
 * them. Editors get the draft in the builder and the API ("stored"), the
 * published version when they use the app ("runtime" — the draft only
 * while it was never published) and the draft as the audience would see
 * it with `preview` (optionally as a viewer or contributor). Before the
 * migration is applied there are no drafts: everyone reads the rows.
 */

import { z } from 'zod'
import { appAccessLevel, appRoleFor, inAudience, type AppViewer } from '@/lib/apps/access'
import { presentLayout, presentMenu, presentRules, referencedIds } from '@/lib/apps/governance'
import { analyseAppAccess, objectFactsFor, type AccessAnalysis } from './app-access'
import { WIDGET_CATALOG } from '@/lib/apps/widgets'
import { ACTION_LABELS, ACTION_TYPES, SERVER_ACTIONS, TRIGGER_LABELS, TRIGGER_PAYLOAD, RULE_TRIGGERS, APP_RULE_LIMITS, appRuleSchema, normaliseRules, ruleActions, type AppRule } from '@/lib/apps/rules'
import { SYSTEM_PATHS, VAR_TYPES, normaliseParams, normaliseVariables, paramDeclSchema, variableDeclSchema } from '@/lib/apps/variables'
import {
  normaliseAppStyle, MAX_LAYOUT_BYTES, MAX_PAGES, SLUG_RE, WIDGET_CONFIG_SCHEMAS, appCreateSchema, appUpdateSchema, normaliseMenu, normaliseNav, pageAllowed, pageOptionsSchema, DEFAULT_PAGE_OPTIONS, normalisePageFilters, normalisePageLayout,
  pageCreateSchema, pageUpdateSchema, RESERVED_APP_SLUGS, slugFrom, uniqueSlug,
  type AppAccess, type AppCreateInput, type AppDetail, type AppPage, type AppSummary, type AppUpdateInput, type AudienceEntry,
  type PageCreateInput, type PageUpdateInput, type PageLayout,
} from '@/lib/apps/schema'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient, syncChange } from './_shared'
import { appDraftsAvailable, loadPublishedSnapshot, loadPublishedSummaries } from './app-published'
import { snapshotPages, UNVERSIONED_SETTINGS, type SnapshotSummary } from '@/lib/apps/versions'
import { isMissingTagsColumn, rowTags, selectWithTags, tagsNotApplied, tagsSafeWrite, validTags } from './tags-column'
import { tagFilterValues } from '@/lib/tags/normalize'
import { parseAppSignInChoice } from '@/lib/forms/sign-in-page'
import { appLinks, type AppLinks } from '@/lib/apps/links'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables not in database.types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE_APP_COLUMNS = 'id, tenant_id, slug, name, subtitle, description, icon, color, menu, settings, created_by, created_at, updated_at'
const DRAFT_STATE_COLUMNS = 'published_version, published_at, published_by, has_draft_changes, draft_updated_at, draft_updated_by'
/** The app columns to select: the draft-state columns exist once the drafts migration is applied. */
export const appColumns = (drafts: boolean) => (drafts ? `${BASE_APP_COLUMNS}, ${DRAFT_STATE_COLUMNS}` : BASE_APP_COLUMNS)
const PAGE_COLUMNS = 'id, app_id, slug, title, icon, position, layout, filters, updated_at'
const NOT_FOUND = 'App not found'

interface AppRow {
  id: string
  tenant_id: string
  slug: string
  name: string
  subtitle: string | null
  description: string | null
  icon: string | null
  color: string | null
  menu: unknown
  settings?: unknown
  /** Absent until migration 20270122150000 is applied. */
  tags?: string[]
  created_by: string | null
  created_at: string
  updated_at: string
  published_version?: number | null
  published_at?: string | null
  published_by?: string | null
  has_draft_changes?: boolean | null
  draft_updated_at?: string | null
  draft_updated_by?: string | null
}

const from = (db: AnySupabaseClient, table: string) => (db as any).from(table)

function validate<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw ServiceError.validation(first ? `${first.path.map(String).join('.') || 'input'}: ${first.message}` : 'Invalid input', parsed.error.issues)
  }
  return parsed.data
}

/* ── The viewer ──────────────────────────────────────────────────────── */

/** The caller's teams and roles in this workspace (for audience checks). */
export async function loadAppViewer(ctx: ServiceContext, db?: AnySupabaseClient): Promise<AppViewer> {
  const can = (p: string) => hasPerm(ctx, p)
  const userId = ctx.actorId ?? null
  if (!userId || !UUID_RE.test(userId)) return { userId: null, teamIds: [], roleIds: [], can }
  const client = db ?? await serviceRoleClient(ctx)
  const [teams, profile, roles] = await Promise.all([
    from(client, 'user_teams').select('team_id, team:teams!inner(tenant_id)').eq('user_id', userId).eq('team.tenant_id', ctx.tenantId),
    from(client, 'users').select('team_id').eq('id', userId).maybeSingle(),
    from(client, 'user_roles').select('role_id').eq('tenant_id', ctx.tenantId).eq('user_id', userId),
  ])
  if (teams.error) throw dbError(teams.error)
  if (roles.error) throw dbError(roles.error)
  const teamIds = new Set<string>(((teams.data ?? []) as any[]).map((t) => String(t.team_id)))
  if (profile.data?.team_id) {
    const { data: legacy } = await from(client, 'teams').select('id').eq('id', profile.data.team_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (legacy) teamIds.add(String(legacy.id))
  }
  return { userId, teamIds: [...teamIds], roleIds: ((roles.data ?? []) as any[]).map((r) => String(r.role_id)), can }
}

interface AccessFacts { audience: Map<string, AudienceEntry[]>; editors: Map<string, string[]> }

async function loadFacts(db: AnySupabaseClient, tenantId: string, appIds: string[]): Promise<AccessFacts> {
  const audience = new Map<string, AudienceEntry[]>()
  const editors = new Map<string, string[]>()
  if (!appIds.length) return { audience, editors }
  const [a, e] = await Promise.all([
    from(db, 'app_audience').select('app_id, principal_type, principal_id, app_role').eq('tenant_id', tenantId).in('app_id', appIds),
    from(db, 'app_editors').select('app_id, user_id').eq('tenant_id', tenantId).in('app_id', appIds),
  ])
  if (a.error) throw dbError(a.error)
  if (e.error) throw dbError(e.error)
  for (const row of (a.data ?? []) as any[]) {
    const list = audience.get(row.app_id) ?? []
    list.push({ type: row.principal_type, id: String(row.principal_id), role: row.app_role === 'contributor' ? 'contributor' : 'viewer' })
    audience.set(row.app_id, list)
  }
  for (const row of (e.data ?? []) as any[]) {
    const list = editors.get(row.app_id) ?? []
    list.push(String(row.user_id))
    editors.set(row.app_id, list)
  }
  return { audience, editors }
}

function accessOf(viewer: AppViewer, facts: AccessFacts, appId: string): AppAccess | null {
  return appAccessLevel(viewer, { audience: facts.audience.get(appId) ?? [], editors: facts.editors.get(appId) ?? [] })
}

/* ── Shapes ──────────────────────────────────────────────────────────── */

async function homePages(db: AnySupabaseClient, tenantId: string, appIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!appIds.length) return out
  const { data, error } = await from(db, 'app_pages').select('app_id, slug, position, options:layout->options').eq('tenant_id', tenantId).in('app_id', appIds)
    .order('position', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw dbError(error)
  // The first page shown in the menu (hidden / role-gated pages are opened from buttons).
  for (const row of (data ?? []) as any[]) if (!out.has(row.app_id) && !row.options?.hidden && (row.options?.min_role ?? 'viewer') === 'viewer') out.set(row.app_id, String(row.slug))
  for (const row of (data ?? []) as any[]) if (!out.has(row.app_id)) out.set(row.app_id, String(row.slug))
  return out
}

function roleOf(viewer: AppViewer, facts: AccessFacts, appId: string) {
  return appRoleFor(viewer, { audience: facts.audience.get(appId) ?? [], editors: facts.editors.get(appId) ?? [] }) ?? 'viewer'
}

function toSummary(row: AppRow, access: AppAccess, homePage: string | null, viewer: AppViewer, facts: AccessFacts, drafts: boolean, shown?: SnapshotSummary | null): AppSummary {
  const issues = Number((row.settings as { access_issues?: unknown } | null)?.access_issues)
  const header = shown ?? row
  return {
    id: row.id, slug: row.slug, name: header.name, subtitle: header.subtitle ?? null, description: header.description ?? null, icon: header.icon ?? null, color: header.color ?? null,
    access, in_audience: inAudience(viewer, facts.audience.get(row.id) ?? []), app_role: roleOf(viewer, facts, row.id),
    access_issues: access === 'edit' && Number.isFinite(issues) ? issues : null,
    tags: rowTags(row),
    home_page: homePage, updated_at: row.updated_at,
    published: !drafts || row.published_version != null,
    published_version: drafts ? row.published_version ?? null : null,
    has_draft_changes: access === 'edit' && drafts ? (row.published_version == null || !!row.has_draft_changes) : null,
  }
}

function toPage(row: any): AppPage {
  return {
    id: row.id, app_id: row.app_id, slug: row.slug, title: row.title, icon: row.icon ?? null, position: row.position ?? 0,
    layout: normalisePageLayout(row.layout), filters: normalisePageFilters(row.filters), updated_at: row.updated_at,
  }
}

/* ── Reads ───────────────────────────────────────────────────────────── */

/**
 * The apps the caller can open (or edit), by name. `search` matches name or
 * description; `editable` keeps only the ones they can edit.
 */
export async function listApps(ctx: ServiceContext, input: { search?: string | null; editable?: boolean; tag?: string | null } = {}): Promise<AppSummary[]> {
  requireAppsAccess(ctx)
  const db = await serviceRoleClient(ctx)
  const drafts = await appDraftsAvailable(db)
  const tagValues = tagFilterValues(input.tag)
  const { data, error } = await selectWithTags(appColumns(drafts), (columns) => {
    let query = from(db, 'apps').select(columns).eq('tenant_id', ctx.tenantId).order('name', { ascending: true }).limit(500)
    const term = input.search?.trim()
    if (term) {
      const safe = term.replace(/[%_\\,()*]/g, ' ').slice(0, 100)
      query = query.or(`name.ilike.%${safe}%,subtitle.ilike.%${safe}%,description.ilike.%${safe}%`)
    }
    if (tagValues.length) query = query.overlaps('tags', tagValues)
    return query
  })
  if (error) throw tagValues.length && isMissingTagsColumn(error) ? tagsNotApplied('apps') : dbError(error)
  const rows = (data ?? []) as AppRow[]
  const [viewer, facts] = await Promise.all([loadAppViewer(ctx, db), loadFacts(db, ctx.tenantId, rows.map((r) => r.id))])
  const visible = rows.flatMap((row) => {
    const access = accessOf(viewer, facts, row.id)
    if (!access || (input.editable && access !== 'edit')) return []
    // The audience never sees an app that was never published.
    if (drafts && access === 'view' && row.published_version == null) return []
    return [{ row, access }]
  })
  // "Apps I design" (editable) shows the drafts; the Apps menu what people use — the published version (the draft until first published).
  const showPublished = (row: AppRow) => drafts && !input.editable && row.published_version != null
  const summaries = await loadPublishedSummaries(db, ctx.tenantId, visible.filter((v) => showPublished(v.row)).map((v) => ({ id: v.row.id, version: Number(v.row.published_version) })))
  const homes = await homePages(db, ctx.tenantId, visible.filter((v) => !summaries.has(v.row.id)).map((v) => v.row.id))
  return visible.map(({ row, access }) => {
    const shown = summaries.get(row.id) ?? null
    return toSummary(row, access, shown ? shown.home_page : homes.get(row.id) ?? null, viewer, facts, drafts, shown)
  })
}

/** apps.view or apps.manage (or an editor, who reaches their app through access checks). */
function requireAppsAccess(ctx: ServiceContext): void {
  if (ctx.authKind === 'anonymous') throw ServiceError.forbidden('Apps are not available on a public form')
  if (ctx.permissions === null) return
  // Editors without apps.view still list the apps they edit: the per-app check decides.
}

export type AppViewRole = 'editor' | 'contributor' | 'viewer'

export interface LoadedApp {
  db: AnySupabaseClient
  row: AppRow
  access: AppAccess
  facts: AccessFacts
  viewer: AppViewer
  /** The app role pages and widgets are presented for (editor for its builders; lowered in a preview as a viewer / contributor). */
  role: AppViewRole
  /** The drafts migration is applied. */
  drafts: boolean
}

/**
 * Load one app (by id or slug) the caller can access, with the access level.
 * 404 otherwise — also for the audience of an app that was never published.
 * (Exported for lib/services/app-versions.ts.)
 */
export async function loadApp(ctx: ServiceContext, idOrSlug: string, need: AppAccess = 'view'): Promise<LoadedApp> {
  requireAppsAccess(ctx)
  const key = String(idOrSlug ?? '').trim()
  if (!key || (!UUID_RE.test(key) && !SLUG_RE.test(key))) throw ServiceError.notFound(NOT_FOUND)
  const db = await serviceRoleClient(ctx)
  const drafts = await appDraftsAvailable(db)
  const { data, error } = await selectWithTags(appColumns(drafts), (columns) => from(db, 'apps').select(columns).eq('tenant_id', ctx.tenantId).eq(UUID_RE.test(key) ? 'id' : 'slug', key.toLowerCase()).maybeSingle())
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound(NOT_FOUND)
  const row = data as AppRow
  const [viewer, facts] = await Promise.all([loadAppViewer(ctx, db), loadFacts(db, ctx.tenantId, [row.id])])
  const access = accessOf(viewer, facts, row.id)
  if (!access) throw ServiceError.notFound(NOT_FOUND)
  if (drafts && access === 'view' && row.published_version == null) throw ServiceError.notFound(NOT_FOUND)
  if (need === 'edit' && access !== 'edit') throw ServiceError.forbidden('Forbidden: you can open this app but not edit it')
  return { db, row, access, facts, viewer, drafts, role: access === 'edit' ? 'editor' : roleOf(viewer, facts, row.id) }
}

/* ── Draft or published ──────────────────────────────────────────────── */

/**
 * Which version of an app to read:
 *  - draft: the working draft (editors only — anyone else is refused);
 *  - published: the live version (404 when never published);
 *  - stored: editors the draft, everyone else the published version (the
 *    API and MCP reads, the builder);
 *  - runtime: the published version, or the draft for editors while the
 *    app was never published (using the app: pages, widgets, rule actions).
 */
export type ContentWant = 'draft' | 'published' | 'stored' | 'runtime'

/** Preview options for runtime reads (editors only): the draft, as a lower app role. */
export interface PreviewOptions {
  draft?: boolean | null
  as_role?: 'viewer' | 'contributor' | null
}

export interface PageHead { id: string; slug: string; title: string; icon: string | null; position: number; options: unknown }

export interface AppContent {
  /** live: no drafts on this server (the rows are what everyone sees). */
  source: 'draft' | 'published' | 'live'
  /** The published version shown (null for the draft / live rows). */
  version: number | null
  /** The app row with the header, menu and settings of the version shown. */
  row: AppRow
  heads: () => Promise<PageHead[]>
  page: (key: string) => Promise<AppPage>
  all: () => Promise<AppPage[]>
}

function draftContent(ctx: ServiceContext, loaded: LoadedApp): AppContent {
  return {
    source: loaded.drafts ? 'draft' : 'live', version: null, row: loaded.row,
    heads: async () => {
      const { data, error } = await from(loaded.db, 'app_pages').select('id, slug, title, icon, position, options:layout->options').eq('tenant_id', ctx.tenantId).eq('app_id', loaded.row.id)
        .order('position', { ascending: true }).order('created_at', { ascending: true })
      if (error) throw dbError(error)
      // (Stores without JSON path selects return the whole row: read options from the layout then.)
      return ((data ?? []) as any[]).map((p) => ({ id: p.id, slug: p.slug, title: p.title, icon: p.icon ?? null, position: p.position ?? 0, options: p.options ?? p.layout?.options }))
    },
    page: (key) => loadPage(ctx, loaded.db, loaded.row.id, key),
    all: () => rawPages(ctx, loaded.db, loaded.row.id),
  }
}

async function publishedContent(ctx: ServiceContext, loaded: LoadedApp): Promise<AppContent> {
  const version = Number(loaded.row.published_version)
  const published = await loadPublishedSnapshot(loaded.db, ctx.tenantId, loaded.row.id, version)
  if (!published) throw ServiceError.notFound(NOT_FOUND)
  const a = published.snapshot.app
  const row: AppRow = {
    ...loaded.row, name: a.name, subtitle: a.subtitle, description: a.description, icon: a.icon, color: a.color, menu: a.menu,
    settings: { ...a.settings, ...pickVolatile(loaded.row.settings) },
  }
  const pages = snapshotPages(published.snapshot, loaded.row.id, published.published_at || loaded.row.updated_at)
  return {
    source: 'published', version, row,
    heads: async () => pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, icon: p.icon, position: p.position, options: p.layout.options })),
    page: async (key) => {
      const k = String(key ?? '').trim().toLowerCase()
      const page = pages.find((p) => p.id.toLowerCase() === k || p.slug === k)
      if (!page) throw ServiceError.notFound('Page not found')
      return page
    },
    all: async () => pages,
  }
}

/** The settings keys of the stored row that are not part of a version (access-issue counts, package origin). */
export const pickVolatile = (settings: unknown): Record<string, unknown> => Object.fromEntries(Object.entries((settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>).filter(([k]) => (UNVERSIONED_SETTINGS as readonly string[]).includes(k)))

/** The draft's pages as stored (raw layouts, with created_at) — what a snapshot is built from. */
export async function loadDraftPageRows(ctx: ServiceContext, db: AnySupabaseClient, appId: string): Promise<Array<{ id: string; slug: string; title: string; icon: string | null; position: number; layout: unknown; filters: unknown; created_at: string | null }>> {
  const { data, error } = await from(db, 'app_pages').select('id, slug, title, icon, position, layout, filters, created_at').eq('tenant_id', ctx.tenantId).eq('app_id', appId)
    .order('position', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw dbError(error)
  return (data ?? []) as any[]
}

/** The version of a loaded app to read (see ContentWant). */
export async function resolveContent(ctx: ServiceContext, loaded: LoadedApp, want: ContentWant): Promise<AppContent> {
  if (!loaded.drafts) return draftContent(ctx, loaded)
  const published = loaded.row.published_version != null
  const editor = loaded.access === 'edit'
  if (want === 'draft') {
    if (!editor) throw ServiceError.forbidden('Only the app’s editors can see its draft')
    return draftContent(ctx, loaded)
  }
  if (want === 'published') {
    if (!published) throw ServiceError.notFound(editor ? 'This app has not been published yet' : NOT_FOUND)
    return publishedContent(ctx, loaded)
  }
  if (want === 'stored') return editor ? draftContent(ctx, loaded) : publishedContent(ctx, loaded)
  return published ? publishedContent(ctx, loaded) : editor ? draftContent(ctx, loaded) : Promise.reject(ServiceError.notFound(NOT_FOUND))
}

/** A runtime read with preview options: the draft and / or a lower app role, for editors only. */
async function runtimeContent(ctx: ServiceContext, loaded: LoadedApp, preview: PreviewOptions | undefined): Promise<{ loaded: LoadedApp; content: AppContent }> {
  const asRole = preview?.as_role ?? null
  if ((preview?.draft || asRole) && loaded.access !== 'edit') throw ServiceError.forbidden('Only the app’s editors can preview it')
  const view = asRole ? { ...loaded, role: asRole } : loaded
  return { loaded: view, content: await resolveContent(ctx, loaded, preview?.draft ? 'draft' : 'runtime') }
}

/** The caller's access to an app (null when they have none), without throwing. */
export async function getAppAccess(ctx: ServiceContext, idOrSlug: string): Promise<AppAccess | null> {
  try {
    return (await loadApp(ctx, idOrSlug)).access
  } catch (error) {
    if (error instanceof ServiceError && error.status === 404) return null
    throw error
  }
}

/** The caller's app role in an app (editor / contributor / viewer); not found when they can't open it. Preview: the role previewed as. */
export async function getViewerAppRole(ctx: ServiceContext, idOrSlug: string, preview?: PreviewOptions): Promise<'editor' | 'contributor' | 'viewer'> {
  const loaded = await loadApp(ctx, idOrSlug)
  if (preview?.as_role && loaded.access === 'edit') return preview.as_role
  return loaded.role
}

/** The draft / publish state of an app, for its editors (null for everyone else and before the drafts migration). */
function publishStateOf(loaded: LoadedApp): AppDetail['publish_state'] {
  if (!loaded.drafts || loaded.access !== 'edit') return null
  const r = loaded.row
  return {
    published_version: r.published_version ?? null, published_at: r.published_at ?? null, published_by: r.published_by ?? null,
    has_draft_changes: r.published_version == null || !!r.has_draft_changes, draft_updated_at: r.draft_updated_at ?? null, draft_updated_by: r.draft_updated_by ?? null,
  }
}

async function detailOf(ctx: ServiceContext, loaded: LoadedApp, content: AppContent): Promise<AppDetail> {
  const { access, facts, viewer, role } = loaded
  const row = content.row
  const pages = (await content.heads()).map((p) => {
    const options = pageOptionsSchema.safeParse(p.options ?? {})
    const o = options.success ? options.data : DEFAULT_PAGE_OPTIONS
    return { id: p.id, slug: p.slug, title: p.title, icon: p.icon ?? null, position: p.position ?? 0, hidden: o.hidden, min_role: o.min_role }
  }).filter((p) => pageAllowed({ hidden: p.hidden, min_role: p.min_role }, role))
  const home = pages.find((p) => !p.hidden) ?? pages[0]
  const summary = toSummary(loaded.row, access, home?.slug ?? null, viewer, facts, loaded.drafts, { name: row.name, subtitle: row.subtitle, description: row.description, icon: row.icon, color: row.color, home_page: null })
  return {
    ...summary,
    app_role: role,
    content: content.source,
    version: content.version,
    publish_state: publishStateOf(loaded),
    sign_in_page: parseAppSignInChoice((loaded.row.settings as { sign_in_page?: unknown } | null)?.sign_in_page),
    menu: normaliseMenu(row.menu),
    nav: normaliseNav((row.settings as { nav?: unknown } | null)?.nav),
    params: normaliseParams((row.settings as { params?: unknown } | null)?.params),
    variables: normaliseVariables((row.settings as { variables?: unknown } | null)?.variables),
    rules: normaliseRules((row.settings as { rules?: unknown } | null)?.rules),
    style: normaliseAppStyle((row.settings as { style?: unknown } | null)?.style),
    pages,
    audience: access === 'edit' ? (facts.audience.get(row.id) ?? []) : null,
    editors: access === 'edit' ? (facts.editors.get(row.id) ?? []) : null,
    created_at: row.created_at,
    created_by: row.created_by ?? null,
  }
}

/**
 * One app (by id or slug) with its pages, menu and — for its builders —
 * audience and editors. Anyone else gets the menu as they may use it
 * (lib/apps/governance.ts presentMenu).
 */
export async function getApp(ctx: ServiceContext, idOrSlug: string, opts: { version?: 'draft' | 'published' | null } = {}): Promise<AppDetail> {
  const loaded = await loadApp(ctx, idOrSlug)
  const content = await resolveContent(ctx, loaded, opts.version ?? 'stored')
  const app = await detailOf(ctx, loaded, content)
  return loaded.access === 'edit' ? app : presentApp(ctx, loaded, app)
}

type Loaded = LoadedApp

async function presentApp(ctx: ServiceContext, loaded: Loaded, app: AppDetail): Promise<AppDetail> {
  const facts = await objectFactsFor(ctx, loaded.db, loaded.viewer, referencedIds([], app.menu, app.rules))
  return { ...app, menu: presentMenu(app.menu, facts, app.app_role, loaded.viewer), rules: presentRules(app.rules, facts, app.app_role) }
}

/**
 * A page as this viewer may see it: widgets, buttons and the Claim button
 * they may use under their own permissions and their app role. Nothing about
 * what is hidden is sent.
 */
async function presentPage(ctx: ServiceContext, loaded: Loaded, page: AppPage): Promise<AppPage> {
  const role = loaded.role
  // A page for a higher app role (e.g. contributors-only config pages) does not exist for this viewer.
  if (!pageAllowed(page.layout.options, role)) throw ServiceError.notFound('Page not found')
  const facts = await objectFactsFor(ctx, loaded.db, loaded.viewer, referencedIds([page.layout], []))
  const layout = presentLayout(page.layout, facts, role, loaded.viewer)
  // Embed widgets frame only the sites the workspace allows (Settings → Embedding); otherwise their address isn't sent.
  if (layout.widgets.some((w) => w.type === 'embed' || (w.type === 'tabs' && (w.config as any).tabs.some((t: any) => t.target?.kind === 'url')))) {
    const { loadAppEmbedOrigins } = await import('./tenant-settings')
    const { embedAllowed } = await import('@/lib/apps/embed-origins')
    const origins = await loadAppEmbedOrigins(ctx).catch(() => [] as string[])
    layout.widgets = layout.widgets.map((w) => {
      if (w.type === 'embed' && (w.config as any).url && !embedAllowed((w.config as any).url, origins)) return { ...w, config: { ...(w.config as any), url: '', blocked: true } }
      // A URL tab outside the list becomes an "open in a new tab" link.
      if (w.type === 'tabs') return { ...w, config: { ...(w.config as any), tabs: (w.config as any).tabs.map((t: any) => (t.target?.kind === 'url' && !embedAllowed(t.target.url, origins) ? { ...t, target: { ...t.target, link_only: true } } : t)) } }
      return w
    })
  }
  return { ...page, layout }
}

/* ── Writes ──────────────────────────────────────────────────────────── */

/** Audience and editor ids must be users / teams / roles of this workspace. */
async function checkPrincipals(db: AnySupabaseClient, tenantId: string, audience: AudienceEntry[] | undefined, editors: string[] | undefined): Promise<void> {
  const ids = (type: AudienceEntry['type']) => [...new Set((audience ?? []).filter((a) => a.type === type).map((a) => a.id))]
  const userIds = [...new Set([...ids('user'), ...(editors ?? [])])]
  const checks: Array<[string, string[], string]> = [
    ['user_memberships', userIds, 'user_id'],
    ['teams', ids('team'), 'id'],
    ['roles', ids('role'), 'id'],
  ]
  for (const [table, list, column] of checks) {
    if (!list.length) continue
    let query = from(db, table).select(column).eq('tenant_id', tenantId).in(column, list)
    if (table === 'user_memberships') query = query.eq('is_active', true)
    const { data, error } = await query
    if (error) throw dbError(error)
    const found = new Set(((data ?? []) as any[]).map((r) => String(r[column])))
    const missing = list.filter((id) => !found.has(id))
    if (missing.length) {
      const what = table === 'user_memberships' ? 'person' : table === 'teams' ? 'team' : 'role'
      throw ServiceError.validation(`No ${what} with id ${missing[0]} in this workspace`)
    }
  }
}

async function replaceAudience(db: AnySupabaseClient, tenantId: string, appId: string, audience: AudienceEntry[]): Promise<void> {
  const del = await from(db, 'app_audience').delete().eq('tenant_id', tenantId).eq('app_id', appId)
  if (del.error) throw dbError(del.error)
  const unique = [...new Map(audience.map((a) => [`${a.type}:${a.id}`, a])).values()]
  if (!unique.length) return
  const ins = await from(db, 'app_audience').insert(unique.map((a) => ({ tenant_id: tenantId, app_id: appId, principal_type: a.type, principal_id: a.id, app_role: a.role ?? 'viewer' })))
  if (ins.error) throw dbError(ins.error)
}

async function replaceEditors(db: AnySupabaseClient, tenantId: string, appId: string, editors: string[]): Promise<void> {
  const del = await from(db, 'app_editors').delete().eq('tenant_id', tenantId).eq('app_id', appId)
  if (del.error) throw dbError(del.error)
  const unique = [...new Set(editors)]
  if (!unique.length) return
  const ins = await from(db, 'app_editors').insert(unique.map((user_id) => ({ tenant_id: tenantId, app_id: appId, user_id })))
  if (ins.error) throw dbError(ins.error)
}

async function takenSlugs(db: AnySupabaseClient, tenantId: string, base: string): Promise<string[]> {
  const { data, error } = await from(db, 'apps').select('slug').eq('tenant_id', tenantId).like('slug', `${base.slice(0, 50)}%`).limit(1000)
  if (error) throw dbError(error)
  return [...((data ?? []) as any[]).map((r) => String(r.slug)), ...RESERVED_APP_SLUGS]
}

const isUniqueViolation = (error: { code?: string } | null | undefined) => error?.code === '23505'

/**
 * Create an app (apps.manage). It starts with one empty page, Home; the
 * creator is its first editor. The audience defaults to nobody (only
 * builders see it) until set.
 */
export async function createApp(ctx: ServiceContext, input: AppCreateInput): Promise<AppDetail> {
  requirePerm(ctx, 'apps.manage')
  const body = validate(appCreateSchema, input)
  const db = await serviceRoleClient(ctx)
  const drafts = await appDraftsAvailable(db)
  if (body.rules) await checkRuleGovernance(ctx, null, [], normaliseRules(body.rules), 'app rules')
  const editors = [...new Set([...(body.editors ?? []), ...(ctx.actorId && UUID_RE.test(ctx.actorId) ? [ctx.actorId] : [])])]
  await checkPrincipals(db, ctx.tenantId, body.audience, body.editors)
  let slug = body.slug
  if (!slug) {
    const base = slugFrom(body.name, 'app')
    slug = uniqueSlug(base, await takenSlugs(db, ctx.tenantId, base))
  }
  const { data, error } = await tagsSafeWrite('apps', {
    tenant_id: ctx.tenantId, slug, name: body.name, subtitle: body.subtitle ?? null, description: body.description ?? null, icon: body.icon ?? null,
    color: body.color ?? null, menu: body.menu ?? [], tags: validTags(body.tags), created_by: ctx.actorId ?? null, updated_by: ctx.actorId ?? null,
    settings: { ...(body.sign_in_page ? { sign_in_page: body.sign_in_page } : {}), ...(body.nav ? { nav: body.nav } : {}), ...(body.params ? { params: body.params } : {}), ...(body.variables ? { variables: body.variables } : {}), ...(body.rules ? { rules: body.rules } : {}), ...(body.style ? { style: body.style } : {}) },
    // A new app is an unpublished draft: only its builders see it until it is published.
    ...(drafts ? draftMark(ctx) : {}),
  }, appColumns(drafts), (values, columns) => from(db, 'apps').insert(values).select(columns).single())
  if (isUniqueViolation(error)) throw ServiceError.conflict(`An app with the slug '${slug}' already exists`)
  if (error) throw dbError(error)
  const row = data as AppRow
  const page = await from(db, 'app_pages').insert({ tenant_id: ctx.tenantId, app_id: row.id, slug: 'home', title: 'Home', position: 0, layout: { widgets: [] }, filters: [] })
  if (page.error) throw dbError(page.error)
  if (body.audience?.length) await replaceAudience(db, ctx.tenantId, row.id, body.audience)
  await replaceEditors(db, ctx.tenantId, row.id, editors)
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'create', summary: `Created app "${row.name}"` })
  void syncChange(ctx, 'app', { id: row.id, name: row.name })
  return getApp(ctx, row.id)
}

/** Edit an app's settings, menu, audience and editors (its editors or apps.manage). */
export async function updateApp(ctx: ServiceContext, idOrSlug: string, input: AppUpdateInput): Promise<AppDetail> {
  const body = validate(appUpdateSchema, input)
  const { db, row, drafts: loadedDrafts } = await loadApp(ctx, idOrSlug, 'edit')
  await checkPrincipals(db, ctx.tenantId, body.audience, body.editors)
  const patch: Record<string, unknown> = {}
  for (const key of ['name', 'slug', 'subtitle', 'description', 'icon', 'color', 'menu'] as const) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  if (body.tags !== undefined) {
    const tags = validTags(body.tags)
    // Before migration 20270122150000 rows have no tags: an empty list is no change.
    if (row.tags !== undefined || tags.length) patch.tags = tags
  }
  const settingsPatch: Record<string, unknown> = {}
  for (const key of ['nav', 'params', 'variables', 'rules', 'style', 'sign_in_page'] as const) if (body[key] !== undefined) settingsPatch[key] = body[key]
  if (body.rules !== undefined) await checkRuleGovernance(ctx, row.id, normaliseRules((row.settings as { rules?: unknown } | null)?.rules), normaliseRules(body.rules), 'app rules')
  if (Object.keys(settingsPatch).length) patch.settings = { ...((row.settings ?? {}) as Record<string, unknown>), ...settingsPatch }
  const changed = [...Object.keys(patch).filter((k) => k !== 'settings'), ...Object.keys(settingsPatch)]
  if (changed.length) {
    patch.updated_by = ctx.actorId ?? null
    // Everything but the slug (the app's address), tags (live metadata) and the sign-in page (access, like the audience) is part of the draft.
    if (loadedDrafts && changed.some((k) => k !== 'slug' && k !== 'tags' && k !== 'sign_in_page')) Object.assign(patch, draftMark(ctx))
    const { error } = await tagsSafeWrite('apps', patch, 'id', (values) => from(db, 'apps').update(values).eq('tenant_id', ctx.tenantId).eq('id', row.id))
    if (isUniqueViolation(error)) throw ServiceError.conflict(`An app with the slug '${String(patch.slug)}' already exists`)
    if (error) throw dbError(error)
  }
  if (body.audience) await replaceAudience(db, ctx.tenantId, row.id, body.audience)
  if (body.editors) {
    // Only builders with apps.manage change who edits; an editor can't remove the last way back in for others.
    if (!hasPerm(ctx, 'apps.manage') && ctx.actorId && !body.editors.includes(ctx.actorId)) {
      throw ServiceError.validation('You can’t remove yourself from the editors (ask someone with Build apps)')
    }
    await replaceEditors(db, ctx.tenantId, row.id, body.editors)
  }
  await audit(ctx, {
    objectType: 'app', objectId: row.id, action: 'update', summary: `Updated app "${body.name ?? row.name}"`,
    metadata: { fields: [...changed, ...(body.audience ? ['audience'] : []), ...(body.editors ? ['editors'] : [])] },
  })
  if (body.audience || body.menu || body.rules) await refreshAccessIssues(ctx, row.id)
  // Audience and editors never travel: only config changes reach GitHub sync.
  if (changed.length) void syncChange(ctx, 'app', { id: row.id, name: body.name ?? row.name })
  return getApp(ctx, row.id)
}

/** An app's share links (anyone who can open it): the friendly /app/<slug>, the embed and the in-app address (lib/apps/links.ts). */
export async function getAppLinks(ctx: ServiceContext, idOrSlug: string): Promise<AppLinks> {
  const { db, row } = await loadApp(ctx, idOrSlug)
  const { data: tenant, error } = await from(db, 'tenants').select('slug, subdomain').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  const { workspaceUrlFor } = await import('./workspace-address')
  const { publicAppOrigin } = await import('@/lib/forms/form-page-url')
  return appLinks({ slug: row.slug, workspaceUrl: workspaceUrlFor(tenant?.subdomain ?? null), mainOrigin: publicAppOrigin(), workspaceSlug: tenant?.slug ?? null })
}

/** Delete an app with its pages, audience and editors (apps.manage). */
export async function deleteApp(ctx: ServiceContext, idOrSlug: string): Promise<{ deleted: true; id: string }> {
  requirePerm(ctx, 'apps.manage')
  const { db, row } = await loadApp(ctx, idOrSlug, 'edit')
  const { error } = await from(db, 'apps').delete().eq('tenant_id', ctx.tenantId).eq('id', row.id)
  if (error) throw dbError(error)
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'delete', summary: `Deleted app "${row.name}"` })
  void syncChange(ctx, 'app', { id: row.id, name: row.name }, 'delete')
  return { deleted: true, id: row.id }
}

/* ── Pages ───────────────────────────────────────────────────────────── */

/**
 * The pages of an app in menu order: the draft as stored for its editors, the
 * published version as they may see it for everyone else (`version` picks
 * one for editors).
 */
export async function listPages(ctx: ServiceContext, appIdOrSlug: string, opts: { version?: 'draft' | 'published' | null } = {}): Promise<AppPage[]> {
  const loaded = await loadApp(ctx, appIdOrSlug)
  const pages = await (await resolveContent(ctx, loaded, opts.version ?? 'stored')).all()
  if (loaded.access === 'edit') return pages
  return Promise.all(pages.filter((p) => pageAllowed(p.layout.options, loaded.role)).map((p) => presentPage(ctx, loaded, p)))
}

async function rawPages(ctx: ServiceContext, db: AnySupabaseClient, appId: string): Promise<AppPage[]> {
  const { data, error } = await from(db, 'app_pages').select(PAGE_COLUMNS).eq('tenant_id', ctx.tenantId).eq('app_id', appId)
    .order('position', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map(toPage)
}

async function loadPage(ctx: ServiceContext, db: AnySupabaseClient, appId: string, pageIdOrSlug: string): Promise<AppPage> {
  const key = String(pageIdOrSlug ?? '').trim().toLowerCase()
  if (!key || (!UUID_RE.test(key) && !SLUG_RE.test(key))) throw ServiceError.notFound('Page not found')
  const { data, error } = await from(db, 'app_pages').select(PAGE_COLUMNS).eq('tenant_id', ctx.tenantId).eq('app_id', appId)
    .eq(UUID_RE.test(key) ? 'id' : 'slug', key).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Page not found')
  return toPage(data)
}

/** One page of an app (widgets and filters): the draft as stored for its editors, the published version as they may see it for everyone else. */
export async function getPage(ctx: ServiceContext, appIdOrSlug: string, pageIdOrSlug: string, opts: { version?: 'draft' | 'published' | null } = {}): Promise<AppPage> {
  const loaded = await loadApp(ctx, appIdOrSlug)
  const page = await (await resolveContent(ctx, loaded, opts.version ?? 'stored')).page(pageIdOrSlug)
  return loaded.access === 'edit' ? page : presentPage(ctx, loaded, page)
}

/**
 * One page as the caller may see it at run time — editors too (the builder
 * uses getAppPageView with mode edit): the published version (the draft
 * while never published); `preview` reads the draft / as a lower role.
 */
export async function getPresentedPage(ctx: ServiceContext, appIdOrSlug: string, pageIdOrSlug: string, preview?: PreviewOptions): Promise<AppPage> {
  const { loaded, content } = await runtimeContent(ctx, await loadApp(ctx, appIdOrSlug), preview)
  return presentPage(ctx, loaded, await content.page(pageIdOrSlug))
}

/**
 * An app and one of its pages (the first when no page is given) — what
 * /apps/<slug>/<page> renders.
 *  - view: the published version as the caller may see it (everyone,
 *    builders included; the draft for builders while never published);
 *  - edit: the draft as stored, for the builder (edit access);
 *  - preview: the draft as the audience would see it (edit access), as the
 *    editor or — `as_role` — as a viewer / contributor of the app (still
 *    under the editor's own permissions on the objects it shows).
 */
export async function getAppPageView(ctx: ServiceContext, appSlug: string, pageSlug?: string | null, mode: 'view' | 'edit' | 'preview' = 'view', opts: { as_role?: 'viewer' | 'contributor' | null } = {}): Promise<{ app: AppDetail; page: AppPage | null }> {
  const base = await loadApp(ctx, appSlug, mode === 'view' ? 'view' : 'edit')
  if (mode === 'edit') {
    const content = await resolveContent(ctx, base, 'draft')
    const app = await detailOf(ctx, base, content)
    const target = pageSlug || app.home_page
    return { app, page: target ? await content.page(target) : null }
  }
  const { loaded, content } = await runtimeContent(ctx, base, mode === 'preview' ? { draft: true, as_role: opts.as_role ?? null } : undefined)
  const detail = await detailOf(ctx, loaded, content)
  const app = await presentApp(ctx, loaded, detail)
  const target = pageSlug || app.home_page
  if (!target) return { app, page: null }
  return { app, page: await presentPage(ctx, loaded, await content.page(target)) }
}

/**
 * A saved rule for the app actions endpoint (lib/services/app-rule-actions.ts):
 * the caller must be able to open the app (and the page, for page rules,
 * under its lowest app role). Rules come from the SAVED app — never from the
 * request.
 */
export async function loadRuleForAction(ctx: ServiceContext, appKey: string, pageKey: string | null, ruleId: string, preview?: PreviewOptions): Promise<{ db: AnySupabaseClient; app: { id: string; name: string }; page: { id: string; title: string } | null; role: 'editor' | 'contributor' | 'viewer'; viewer: AppViewer; rule: AppRule }> {
  // The audience runs the PUBLISHED rule; editors previewing the draft run the draft's.
  const { loaded, content } = await runtimeContent(ctx, await loadApp(ctx, appKey), preview)
  const role = loaded.role
  let rules: AppRule[]
  let page: { id: string; title: string } | null = null
  if (pageKey) {
    const p = await content.page(pageKey)
    if (!pageAllowed(p.layout.options, role)) throw ServiceError.notFound('Page not found')
    rules = p.layout.rules ?? []
    page = { id: p.id, title: p.title }
  } else {
    rules = normaliseRules((content.row.settings as { rules?: unknown } | null)?.rules)
  }
  const rule = rules.find((r) => r.id === ruleId && r.enabled)
  if (!rule) throw ServiceError.notFound('That rule does not exist')
  return { db: loaded.db, app: { id: loaded.row.id, name: content.row.name }, page, role, viewer: loaded.viewer, rule }
}

/* ── Access analysis ─────────────────────────────────────────────────── */

/**
 * Access issues of an app (its editors): who in the audience can't use what
 * its pages and menu show them (lib/services/app-access.ts). `draft` checks
 * unsaved builder changes: one page's widgets, the audience or the menu.
 */
export async function getAppAccessAnalysis(ctx: ServiceContext, idOrSlug: string, draft: { page_id?: string | null; layout?: unknown; audience?: AudienceEntry[] | null; menu?: unknown; rules?: unknown } = {}): Promise<AccessAnalysis> {
  const loaded = await loadApp(ctx, idOrSlug, 'edit')
  const pages = await rawPages(ctx, loaded.db, loaded.row.id)
  const withDraft = pages.map((p) => (draft.page_id && (p.id === draft.page_id || p.slug === draft.page_id) && draft.layout !== undefined ? { ...p, layout: normalisePageLayout(draft.layout) } : p))
  const audience = draft.audience ? validate(appUpdateSchema, { audience: draft.audience }).audience ?? [] : loaded.facts.audience.get(loaded.row.id) ?? []
  const menu = draft.menu !== undefined ? normaliseMenu(draft.menu) : normaliseMenu(loaded.row.menu)
  const settings = (loaded.row.settings ?? {}) as Record<string, unknown>
  const rules = draft.rules !== undefined ? normaliseRules(draft.rules) : normaliseRules(settings.rules)
  return analyseAppAccess(ctx, loaded.db, { audience, pages: withDraft, menu, app: { params: normaliseParams(settings.params), variables: normaliseVariables(settings.variables), rules } })
}

/** Re-run the analysis on a saved app (e.g. one just installed from a package) and keep the issue count (best effort). */
export async function refreshAppAccessIssues(ctx: ServiceContext, appId: string): Promise<void> {
  return refreshAccessIssues(ctx, appId)
}

/** Re-run the analysis on the saved app and keep the issue count for the Apps page badge (best effort). */
async function refreshAccessIssues(ctx: ServiceContext, appId: string): Promise<void> {
  try {
    const loaded = await loadApp(ctx, appId, 'edit')
    const st = (loaded.row.settings ?? {}) as Record<string, unknown>
    const analysis = await analyseAppAccess(ctx, loaded.db, {
      audience: loaded.facts.audience.get(loaded.row.id) ?? [], pages: await rawPages(ctx, loaded.db, loaded.row.id), menu: normaliseMenu(loaded.row.menu),
      app: { params: normaliseParams(st.params), variables: normaliseVariables(st.variables), rules: normaliseRules(st.rules) },
    })
    const settings = { ...((loaded.row.settings ?? {}) as Record<string, unknown>), access_issues: analysis.gaps.length, access_checked_at: new Date().toISOString() }
    await from(loaded.db, 'apps').update({ settings }).eq('tenant_id', ctx.tenantId).eq('id', loaded.row.id)
  } catch (error) {
    console.warn('[apps] access analysis failed', error instanceof Error ? error.message : error)
  }
}

/**
 * Give the form grants that fix the chosen access issues (`keys`, or every
 * one the caller can fix). Recomputed here from the saved app — the caller
 * names gaps, never grants. Each grant goes through
 * lib/services/object-permissions (Manage roles, team.change_roles; View +
 * Submit, the minimum to submit; audited as `grant` on the form).
 */
export async function grantAppAccess(ctx: ServiceContext, idOrSlug: string, keys: string[] | 'all'): Promise<{ granted: number; analysis: AccessAnalysis }> {
  requirePerm(ctx, 'team.change_roles')
  const loaded = await loadApp(ctx, idOrSlug, 'edit')
  const before = await getAppAccessAnalysis(ctx, loaded.row.id)
  const wanted = keys === 'all' ? null : new Set(keys)
  const { setObjectPermission } = await import('./object-permissions')
  const done = new Set<string>()
  let granted = 0
  for (const gap of before.gaps) {
    if (gap.fix.kind !== 'grant' || !gap.fix.can_grant || (wanted && !wanted.has(gap.key))) continue
    const g = gap.fix.grant
    const once = `${g.object_id}:${g.principal_type}:${g.principal_id}`
    if (done.has(once)) continue
    done.add(once)
    await setObjectPermission(ctx, {
      object_type: 'form', object_id: g.object_id, [`${g.principal_type}_id`]: g.principal_id, can_view: true, can_execute: true,
    })
    granted++
  }
  await audit(ctx, { objectType: 'app', objectId: loaded.row.id, action: 'update', summary: `Granted access for app "${loaded.row.name}" (${granted} form grant${granted === 1 ? '' : 's'})`, metadata: { kind: 'access_grants', granted } })
  await refreshAccessIssues(ctx, loaded.row.id)
  return { granted, analysis: await getAppAccessAnalysis(ctx, loaded.row.id) }
}

/**
 * Card view API references run with the workspace connection: only a
 * designer with View integrations may bind (or re-bind) one, and only one
 * with Manage references may let app viewers without integration access see
 * its data ("Allow app viewers") — audited. Unchanged bindings pass, so other
 * editors can still save the page.
 */
export async function checkCardReferences(ctx: ServiceContext, appId: string, before: PageLayout | null, after: PageLayout): Promise<void> {
  const refs = (layout: PageLayout | null) => new Map((layout?.widgets ?? []).filter((w) => w.type === 'card_view' && (w.config as any).source === 'reference')
    .map((w) => [w.id, { ref: (w.config as any).reference_id ?? null, inputs: JSON.stringify((w.config as any).reference_inputs ?? {}), allow: (w.config as any).allow_viewers === true }]))
  const old = refs(before)
  for (const [id, now] of refs(after)) {
    const was = old.get(id)
    const rebound = !was || was.ref !== now.ref || was.inputs !== now.inputs
    if (rebound && now.ref && !hasPerm(ctx, 'integrations.view')) throw ServiceError.forbidden('Binding an API reference to a card view needs View integrations')
    if (now.allow && (!was || !was.allow || was.ref !== now.ref)) {
      if (!hasPerm(ctx, 'integrations.manage_references')) throw ServiceError.forbidden('Allowing app viewers to see API data needs Manage references')
      await audit(ctx, { objectType: 'app', objectId: appId, action: 'update', summary: `Allowed app viewers to see API reference data (widget ${id})`, metadata: { widget_id: id, reference_id: now.ref, allow_viewers: true } })
    }
  }
}

/**
 * App rules' server actions run with the workspace connection (API
 * references) or start work: binding (or re-binding) a "Call an API
 * reference" action needs View integrations; letting app viewers without
 * integration access run it ("allow_viewers") needs Manage references and is
 * audited; adding or changing "Start a workflow" needs Start workflows.
 * Unchanged actions pass, so other editors can still save.
 */
export async function checkRuleGovernance(ctx: ServiceContext, appId: string | null, before: readonly AppRule[], after: readonly AppRule[], where: string): Promise<void> {
  const index = (rules: readonly AppRule[]) => new Map(rules.flatMap((r) => ruleActions(r).map(({ path, action }) => [`${r.id}:${path}`, action] as const)))
  const old = index(before)
  for (const [key, a] of index(after)) {
    const was = old.get(key)
    if (a.type === 'call_reference') {
      const prev = was?.type === 'call_reference' ? was : null
      const rebound = !prev || prev.reference_id !== a.reference_id || JSON.stringify(prev.inputs) !== JSON.stringify(a.inputs)
      if (rebound && !hasPerm(ctx, 'integrations.view')) throw ServiceError.forbidden('Adding an API reference call to an app rule needs View integrations')
      if (a.allow_viewers && (!prev || !prev.allow_viewers || prev.reference_id !== a.reference_id)) {
        if (!hasPerm(ctx, 'integrations.manage_references')) throw ServiceError.forbidden('Letting app viewers run an API reference needs Manage references')
        if (appId) await audit(ctx, { objectType: 'app', objectId: appId, action: 'update', summary: `Allowed app viewers to run an API reference from ${where} (rule ${key.split(':')[0]})`, metadata: { rule: key, reference_id: a.reference_id, allow_viewers: true } })
      }
    }
    if (a.type === 'start_workflow') {
      const prev = was?.type === 'start_workflow' ? was : null
      if ((!prev || prev.workflow_id !== a.workflow_id) && !hasPerm(ctx, 'workflows.activate')) throw ServiceError.forbidden('Adding "Start a workflow" to an app rule needs Start workflows')
    }
  }
}

function checkLayoutSize(layout: unknown): void {
  if (layout !== undefined && JSON.stringify(layout).length > MAX_LAYOUT_BYTES) {
    throw ServiceError.validation(`The page layout is too large (over ${MAX_LAYOUT_BYTES / 1024} KB)`)
  }
}

export async function createPage(ctx: ServiceContext, appIdOrSlug: string, input: PageCreateInput): Promise<AppPage> {
  const body = validate(pageCreateSchema, input)
  checkLayoutSize(body.layout)
  const { db, row } = await loadApp(ctx, appIdOrSlug, 'edit')
  if (body.layout) await checkCardReferences(ctx, row.id, null, normalisePageLayout(body.layout))
  if (body.layout) await checkRuleGovernance(ctx, row.id, [], normalisePageLayout(body.layout).rules ?? [], `page "${body.title}"`)
  const { data: existing, error } = await from(db, 'app_pages').select('slug, position').eq('tenant_id', ctx.tenantId).eq('app_id', row.id)
  if (error) throw dbError(error)
  const pages = (existing ?? []) as any[]
  if (pages.length >= MAX_PAGES) throw ServiceError.validation(`An app can have at most ${MAX_PAGES} pages`)
  const slug = body.slug ?? uniqueSlug(slugFrom(body.title, 'page'), pages.map((p) => String(p.slug)))
  const position = body.position ?? (pages.reduce((max, p) => Math.max(max, Number(p.position ?? 0)), -1) + 1)
  const { data, error: insertError } = await from(db, 'app_pages').insert({
    tenant_id: ctx.tenantId, app_id: row.id, slug, title: body.title, icon: body.icon ?? null, position,
    layout: body.layout ?? { widgets: [] }, filters: body.filters ?? [],
  }).select(PAGE_COLUMNS).single()
  if (isUniqueViolation(insertError)) throw ServiceError.conflict(`This app already has a page with the slug '${slug}'`)
  if (insertError) throw dbError(insertError)
  await touchApp(ctx, db, row.id)
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'update', summary: `Added page "${body.title}" to app "${row.name}"`, metadata: { page_id: (data as any).id } })
  return toPage(data)
}

export async function updatePage(ctx: ServiceContext, appIdOrSlug: string, pageIdOrSlug: string, input: PageUpdateInput): Promise<AppPage> {
  const body = validate(pageUpdateSchema, input)
  checkLayoutSize(body.layout)
  const { db, row } = await loadApp(ctx, appIdOrSlug, 'edit')
  const page = await loadPage(ctx, db, row.id, pageIdOrSlug)
  if (body.layout) await checkCardReferences(ctx, row.id, page.layout, normalisePageLayout(body.layout))
  if (body.layout) await checkRuleGovernance(ctx, row.id, page.layout.rules ?? [], normalisePageLayout(body.layout).rules ?? [], `page "${page.title}"`)
  const patch: Record<string, unknown> = {}
  for (const key of ['title', 'slug', 'icon', 'position', 'layout', 'filters'] as const) {
    if (body[key] !== undefined) patch[key] = body[key]
  }
  if (!Object.keys(patch).length) return page
  const { data, error } = await from(db, 'app_pages').update(patch).eq('tenant_id', ctx.tenantId).eq('id', page.id).select(PAGE_COLUMNS).single()
  if (isUniqueViolation(error)) throw ServiceError.conflict(`This app already has a page with the slug '${String(patch.slug)}'`)
  if (error) throw dbError(error)
  await touchApp(ctx, db, row.id)
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'update', summary: `Updated page "${body.title ?? page.title}" of app "${row.name}"`, metadata: { page_id: page.id, fields: Object.keys(patch) } })
  return toPage(data)
}

export async function deletePage(ctx: ServiceContext, appIdOrSlug: string, pageIdOrSlug: string): Promise<{ deleted: true; id: string }> {
  const { db, row } = await loadApp(ctx, appIdOrSlug, 'edit')
  const page = await loadPage(ctx, db, row.id, pageIdOrSlug)
  const { error } = await from(db, 'app_pages').delete().eq('tenant_id', ctx.tenantId).eq('id', page.id)
  if (error) throw dbError(error)
  await touchApp(ctx, db, row.id)
  await audit(ctx, { objectType: 'app', objectId: row.id, action: 'update', summary: `Deleted page "${page.title}" of app "${row.name}"`, metadata: { page_id: page.id } })
  return { deleted: true, id: page.id }
}

/** Put the app's pages in this order (ids or slugs; pages not listed keep their order after them). */
export async function reorderPages(ctx: ServiceContext, appIdOrSlug: string, order: string[]): Promise<AppPage[]> {
  const { db, row } = await loadApp(ctx, appIdOrSlug, 'edit')
  const pages = await listPages(ctx, row.id)
  const rank = new Map(order.map((key, i) => [key.toLowerCase(), i]))
  const sorted = [...pages].sort((a, b) => (rank.get(a.id) ?? rank.get(a.slug) ?? 1000 + a.position) - (rank.get(b.id) ?? rank.get(b.slug) ?? 1000 + b.position))
  for (const [i, page] of sorted.entries()) {
    if (page.position === i) continue
    const { error } = await from(db, 'app_pages').update({ position: i }).eq('tenant_id', ctx.tenantId).eq('id', page.id)
    if (error) throw dbError(error)
  }
  await touchApp(ctx, db, row.id)
  return listPages(ctx, row.id)
}

/** The columns that mark the draft as changed (drafts migration applied). */
export function draftMark(ctx: ServiceContext): Record<string, unknown> {
  return { has_draft_changes: true, draft_updated_at: new Date().toISOString(), draft_updated_by: ctx.actorId && UUID_RE.test(ctx.actorId) ? ctx.actorId : null }
}

async function touchApp(ctx: ServiceContext, db: AnySupabaseClient, appId: string): Promise<void> {
  await from(db, 'apps').update({ updated_by: ctx.actorId ?? null, ...((await appDraftsAvailable(db)) ? draftMark(ctx) : {}) }).eq('tenant_id', ctx.tenantId).eq('id', appId)
  void syncChange(ctx, 'app', { id: appId })
  await refreshAccessIssues(ctx, appId)
}

/* ── Widget catalogue ────────────────────────────────────────────────── */

/** Every widget type with its sizes and config JSON schema (for API / MCP builders). */
export function listWidgetTypes(): Array<Record<string, unknown>> {
  return WIDGET_CATALOG.map((e) => {
    let schema: unknown = null
    try { schema = z.toJSONSchema(WIDGET_CONFIG_SCHEMAS[e.type], { io: 'input', unrepresentable: 'any' }) } catch { schema = null }
    return {
      type: e.type, title: e.title, description: e.description, group: e.group,
      size: { w: e.w, h: e.h, min_w: e.minW, max_w: e.maxW, min_h: e.minH, max_h: e.maxH },
      config_schema: schema,
    }
  })
}

/** The app rules reference (for API / MCP / CLI builders and the AI agent). */
export function listRuleTypes(): Record<string, unknown> {
  const schema = (zs: z.ZodType) => { try { return z.toJSONSchema(zs, { io: 'input', unrepresentable: 'any' }) } catch { return null } }
  return {
    triggers: RULE_TRIGGERS.map((t) => ({ type: t, label: TRIGGER_LABELS[t], payload: TRIGGER_PAYLOAD[t] })),
    actions: ACTION_TYPES.map((t) => ({ type: t, label: ACTION_LABELS[t], server: SERVER_ACTIONS.has(t) })),
    system_variables: SYSTEM_PATHS,
    variable_types: VAR_TYPES,
    limits: APP_RULE_LIMITS,
    templates: 'Values are templates: {{param.x}}, {{var.x}}, {{sys.user.name}}, {{sys.today}}, {{filter.x}}, {{event.row.id}}, {{result.x}}, or expressions {{= var.qty * 2 }}.',
    rule_schema: schema(appRuleSchema),
    param_schema: schema(paramDeclSchema),
    variable_schema: schema(variableDeclSchema),
  }
}
