/**
 * Apps from manifests — the install / apply side of the `apps` section
 * (lib/portability/apps.ts is the export side). Used by importManifest, so
 * by package installs and upgrades, config apply and GitHub deploy.
 *
 * Create: the app gets a free slug (the package's suggestion, de-duplicated),
 * its pages, an EMPTY audience (only builders see it until the installer
 * shares it) and the installer as its only editor.
 * Update (upgrade in place / re-apply): name, subtitle, description, icon,
 * colour, menu, settings and the package's pages (matched by slug) are
 * replaced; the local slug (its URL), audience, editors and pages added here
 * are kept.
 *
 * On the way in:
 *  - objects are remapped through the import's id maps, and links to other
 *    apps follow their slug here (lib/apps/references.ts — the one walker);
 *  - people (users, teams, roles) that are not in this workspace are dropped;
 *  - uploaded SVG icons are sanitised again (lib/apps/icon-svg.ts) and added
 *    to the icon library (a library icon with the same markup is reused);
 *    an icon that fails sanitising falls back to the default icon;
 *  - a Card view's "Allow app viewers" (API data for viewers without
 *    integration access) is only kept when the installer holds Manage
 *    references;
 *  - the access-issues analysis is re-run for the app.
 *
 * Drafts (lib/services/app-versions.ts): like a form package, what an
 * install or upgrade writes goes live — publishImportedApps publishes each
 * written app as its next version (a new app as version 1; its audience is
 * empty anyway). One exception: an app whose editors have unpublished
 * changes keeps the upgrade in its draft (with a warning), so nobody's
 * unfinished work is published by an upgrade.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- manifests are free-form JSON */

import { manifestTags } from '@/lib/tags/normalize'
import { isMissingTagsColumn } from './tags-column'
import { createHash } from 'node:crypto'
import { cleanAppIconSvg, customIconToken, MAX_LIBRARY_ICONS } from '@/lib/apps/icon-svg'
import { rewriteAppReferences, collectAppReferences, type AppDocument } from '@/lib/apps/references'
import { MAX_LAYOUT_BYTES, MAX_PAGES, RESERVED_APP_SLUGS, SLUG_RE, slugFrom, uniqueSlug, COLOR_RE } from '@/lib/apps/schema'
import { portableAppSettings, remapAppAsset, isRetiredAppAsset, type AppIconAsset } from '@/lib/portability/apps'
import type { AssetIdMaps } from '@/lib/portability/id-maps'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'
import { appDraftsAvailable, loadPublishedSnapshot } from './app-published'
import { diffAppSnapshots } from '@/lib/apps/versions'
import { draftSnapshot, publishProblems, publishSnapshot } from './app-versions'
import { appColumns, draftMark } from './apps'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export interface AppApplyResult {
  id: string
  slug: string
  created: boolean
  warnings: string[]
  /** The app had unpublished draft changes before this write (the upgrade then stays in the draft). */
  had_unpublished_changes?: boolean
}

/** Which of these user / team / role ids exist in the workspace. */
async function livePrincipals(db: AnySupabaseClient, tenantId: string, doc: AppDocument): Promise<Set<string>> {
  const refs = collectAppReferences(doc)
  const ids = (kind: string) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))]
  const live = new Set<string>()
  const checks: Array<[string, string[], string]> = [['user_memberships', ids('user'), 'user_id'], ['teams', ids('team'), 'id'], ['roles', ids('role'), 'id']]
  for (const [table, list, column] of checks) {
    if (!list.length) continue
    const { data } = await (db as any).from(table).select(column).eq('tenant_id', tenantId).in(column, list)
    for (const row of data ?? []) live.add(`${table}:${String(row[column])}`)
  }
  return new Set([...live].map((k) => k.slice(k.indexOf(':') + 1)))
}

/** Icons of the asset → local icon ids (sanitised again; same markup reuses a library icon); null: use the default icon. */
async function importIcons(ctx: ServiceContext, db: AnySupabaseClient, icons: AppIconAsset[], warnings: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (!icons.length) return out
  const { data: tenant, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  const settings = (tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {}) as Record<string, any>
  const apps = (settings.apps && typeof settings.apps === 'object' ? settings.apps : {}) as Record<string, any>
  const library: any[] = Array.isArray(apps.icons) ? [...apps.icons] : []
  let changed = false
  const { getStorageProvider } = await import('@/lib/providers/storage')
  const { fileRefFields } = await import('@/lib/storage/persist')
  for (const icon of icons) {
    const sourceId = String(icon?.id ?? '').toLowerCase()
    if (!UUID_RE.test(sourceId)) continue
    const clean = cleanAppIconSvg(String(icon?.svg ?? ''))
    if (!clean) {
      out.set(sourceId, null)
      warnings.push(`Icon "${icon?.name ?? 'Icon'}" is not a safe SVG and was replaced with the default icon`)
      continue
    }
    const sha = createHash('sha256').update(clean).digest('hex')
    const existing = library.find((entry) => entry?.sha256 === sha) ?? library.find((entry) => String(entry?.id ?? '').toLowerCase() === sourceId)
    if (existing) { out.set(sourceId, String(existing.id)); continue }
    if (library.length >= MAX_LIBRARY_ICONS) {
      out.set(sourceId, null)
      warnings.push(`The icon library is full; icon "${icon?.name ?? 'Icon'}" uses the default icon`)
      continue
    }
    const id = crypto.randomUUID()
    const path = `app-icons/${ctx.tenantId}/${id}.svg`
    const storage = await getStorageProvider()
    await storage.put('task-files', path, new TextEncoder().encode(clean), { contentType: 'image/svg+xml' })
    const ref = fileRefFields('task-files', path, storage.id).ref
    library.push({ id, token: customIconToken(id), name: String(icon?.name || 'Icon').slice(0, 60), url: ref ?? storage.publicUrl('task-files', path), tint: Boolean(icon?.tint), sha256: sha, created_at: new Date().toISOString() })
    out.set(sourceId, id)
    changed = true
  }
  if (changed) {
    const { error: saveError } = await (db as any).from('tenants').update({ settings: { ...settings, apps: { ...apps, icons: library } } }).eq('id', ctx.tenantId)
    if (saveError) throw dbError(saveError)
  }
  return out
}

/** Card views that let viewers see API data need Manage references from whoever installs them. */
function gateCardViewers(ctx: ServiceContext, pages: any[], warnings: string[]): any[] {
  if (hasPerm(ctx, 'integrations.manage_references')) return pages
  let dropped = 0
  const next = pages.map((page) => {
    const widgets = Array.isArray(page?.layout?.widgets) ? page.layout.widgets : null
    if (!widgets) return page
    return {
      ...page,
      layout: {
        ...page.layout,
        widgets: widgets.map((w: any) => {
          if (w?.type !== 'card_view' || w?.config?.allow_viewers !== true) return w
          dropped++
          return { ...w, config: { ...w.config, allow_viewers: false } }
        }),
      },
    }
  })
  if (dropped) warnings.push(`${dropped} card view${dropped === 1 ? '' : 's'} no longer let app viewers see API data ("Allow app viewers" needs Manage references)`)
  return next
}

function cleanLayout(layout: unknown): Record<string, unknown> {
  const out = layout && typeof layout === 'object' && !Array.isArray(layout) ? { ...(layout as Record<string, unknown>) } : {}
  if (!Array.isArray(out.widgets)) out.widgets = []
  if (JSON.stringify(out).length > MAX_LAYOUT_BYTES) throw ServiceError.validation(`A page layout is too large (over ${MAX_LAYOUT_BYTES / 1024} KB)`)
  return out
}

/**
 * Write one app asset. `existingId`: the local app to update (upgrade /
 * re-apply), else a new app. `appSlugs`: source slug → local slug of apps
 * written in this import (links to them follow).
 */
/** Write with the manifest's tags; a database without the column yet (migration 20270122150000) writes without them. */
async function tagsSafeImport(fields: Record<string, unknown>, run: (values: Record<string, unknown>) => PromiseLike<any>): Promise<any> {
  const first = await run(fields)
  if (!('tags' in fields) || !isMissingTagsColumn(first.error)) return first
  const { tags: _tags, ...rest } = fields
  return run(rest)
}

export async function applyAppManifest(
  ctx: ServiceContext,
  asset: Record<string, any>,
  existingId: string | null,
  idMaps: AssetIdMaps,
  appSlugs: Map<string, string> = new Map(),
): Promise<AppApplyResult> {
  if (isRetiredAppAsset(asset)) throw ServiceError.validation('Not an app asset (it has no pages)')
  const name = text(asset.name, 120)
  if (!name) throw ServiceError.validation('An app needs a name')
  const db = await serviceRoleClient(ctx)
  const warnings: string[] = []

  // Objects through the id maps; then people, icons and app links for this workspace.
  const remapped = remapAppAsset(asset as AppDocument, idMaps)
  const live = await livePrincipals(db, ctx.tenantId, remapped)
  const iconMap = await importIcons(ctx, db, Array.isArray(asset.icons) ? asset.icons : [], warnings)
  let droppedPeople = 0
  const doc = rewriteAppReferences(remapped, (ref) => {
    if (ref.kind === 'user' || ref.kind === 'team' || ref.kind === 'role') {
      if (live.has(ref.id)) return undefined
      droppedPeople++
      return null
    }
    if (ref.kind === 'icon') return iconMap.has(ref.id) ? iconMap.get(ref.id) : null
    if (ref.kind === 'app') return appSlugs.get(ref.id)
    return undefined
  })
  if (droppedPeople) warnings.push(`${droppedPeople} reference${droppedPeople === 1 ? '' : 's'} to people, teams or roles not in this workspace ${droppedPeople === 1 ? 'was' : 'were'} removed (filters, visibility rules)`)
  // A dropped icon token leaves null: the app / page / button falls back to its default.
  const pages = gateCardViewers(ctx, (Array.isArray(doc.pages) ? doc.pages : []).filter((p: any) => p && SLUG_RE.test(String(p.slug ?? ''))), warnings).slice(0, MAX_PAGES)
  if ((doc.pages ?? []).length > pages.length) warnings.push(`Only ${pages.length} of the app's ${(doc.pages ?? []).length} pages could be written (invalid slugs or more than ${MAX_PAGES})`)

  const fields = {
    name,
    subtitle: text(asset.subtitle, 160),
    description: text(asset.description, 1000),
    icon: text(doc.icon, 60),
    color: typeof asset.color === 'string' && COLOR_RE.test(asset.color) ? asset.color : null,
    menu: Array.isArray(doc.menu) ? doc.menu : [],
    // Only when the manifest has tags: an older manifest leaves an existing app's tags alone.
    ...(Array.isArray(asset.tags) ? { tags: manifestTags(asset.tags) } : {}),
  }

  let appId: string
  let slug: string
  let created = false
  let hadUnpublished = false
  const drafts = await appDraftsAvailable(db)
  if (existingId) {
    const { data: row, error } = await (db as any).from('apps').select(drafts ? 'id, slug, settings, published_version, has_draft_changes' : 'id, slug, settings').eq('tenant_id', ctx.tenantId).eq('id', existingId).maybeSingle()
    if (error) throw dbError(error)
    if (!row) throw ServiceError.notFound('App not found')
    hadUnpublished = drafts && row.published_version != null && !!row.has_draft_changes
    const local = (row.settings && typeof row.settings === 'object' ? row.settings : {}) as Record<string, unknown>
    const kept = Object.fromEntries(Object.entries(local).filter(([key]) => ['access_issues', 'access_checked_at'].includes(key)))
    const { error: updateError } = await tagsSafeImport(fields, (values) => (db as any).from('apps').update({ ...values, settings: { ...portableAppSettings(doc.settings), ...kept }, updated_by: ctx.actorId ?? null })
      .eq('tenant_id', ctx.tenantId).eq('id', existingId))
    if (updateError) throw dbError(updateError)
    appId = existingId
    slug = String(row.slug)
  } else {
    const base = typeof asset.slug === 'string' && SLUG_RE.test(asset.slug) ? asset.slug : slugFrom(name, 'app')
    const { data: taken, error: takenError } = await (db as any).from('apps').select('slug').eq('tenant_id', ctx.tenantId).like('slug', `${base.slice(0, 50)}%`).limit(1000)
    if (takenError) throw dbError(takenError)
    slug = uniqueSlug(base, [...((taken ?? []) as any[]).map((r) => String(r.slug)), ...RESERVED_APP_SLUGS])
    if (slug !== base) warnings.push(`The slug "${base}" is taken in this workspace; the app opens at /apps/${slug}`)
    const { data: row, error } = await tagsSafeImport(fields, (values) => (db as any).from('apps').insert({
      tenant_id: ctx.tenantId, slug, ...values, settings: portableAppSettings(doc.settings), created_by: ctx.actorId ?? null, updated_by: ctx.actorId ?? null,
    }).select('id, slug').single())
    if (error) throw dbError(error)
    appId = String(row.id)
    created = true
    // The installer is the app's editor; the audience starts empty (they choose who can use it).
    if (ctx.actorId && UUID_RE.test(ctx.actorId)) {
      const { error: editorError } = await (db as any).from('app_editors').insert({ tenant_id: ctx.tenantId, app_id: appId, user_id: ctx.actorId })
      if (editorError) throw dbError(editorError)
    }
  }

  // Pages by slug: the package's pages are written; pages added here are kept.
  const { data: localPages, error: pagesError } = await (db as any).from('app_pages').select('id, slug').eq('tenant_id', ctx.tenantId).eq('app_id', appId)
  if (pagesError) throw dbError(pagesError)
  const bySlug = new Map<string, string>(((localPages ?? []) as any[]).map((p) => [String(p.slug), String(p.id)]))
  const extra = [...bySlug.keys()].filter((s) => !pages.some((p: any) => p.slug === s)).length
  if (pages.length + extra > MAX_PAGES) throw ServiceError.validation(`The app would have more than ${MAX_PAGES} pages`)
  for (const [index, page] of pages.entries()) {
    const row = {
      title: text(page.title, 120) ?? page.slug,
      icon: text(page.icon, 60),
      position: Number.isInteger(page.position) ? Math.max(0, Math.min(1000, page.position)) : index,
      layout: cleanLayout(page.layout),
      filters: Array.isArray(page.filters) ? page.filters : [],
    }
    const localId = bySlug.get(page.slug)
    const { error } = localId
      ? await (db as any).from('app_pages').update(row).eq('tenant_id', ctx.tenantId).eq('id', localId)
      : await (db as any).from('app_pages').insert({ tenant_id: ctx.tenantId, app_id: appId, slug: page.slug, ...row })
    if (error) throw dbError(error)
  }
  if (!pages.length && !bySlug.size) {
    const { error } = await (db as any).from('app_pages').insert({ tenant_id: ctx.tenantId, app_id: appId, slug: 'home', title: 'Home', position: 0, layout: { widgets: [] }, filters: [] })
    if (error) throw dbError(error)
  }

  await audit({ ...ctx, supabase: db }, {
    objectType: 'app', objectId: appId, action: created ? 'create' : 'update',
    summary: `${created ? 'Created' : 'Updated'} app "${name}" from a package or configuration`,
    metadata: { source: 'import', pages: pages.length, ...(warnings.length ? { warnings: warnings.length } : {}) },
  })
  const { refreshAppAccessIssues } = await import('./apps')
  await refreshAppAccessIssues(ctx, appId)
  return { id: appId, slug, created, warnings, had_unpublished_changes: hadUnpublished }
}

/**
 * After an import wrote its apps (and relinked them): publish each one as
 * its next version, like a form package goes live. An app that had
 * unpublished changes keeps the import in its draft instead. Returns
 * warnings per app id.
 */
export async function publishImportedApps(ctx: ServiceContext, written: Array<Pick<AppApplyResult, 'id' | 'created' | 'had_unpublished_changes'>>): Promise<Array<{ id: string; warning: string }>> {
  const db = await serviceRoleClient(ctx)
  if (!written.length || !(await appDraftsAvailable(db))) return []
  const warnings: Array<{ id: string; warning: string }> = []
  for (const app of written) {
    const { data: row, error } = await (db as any).from('apps').select(appColumns(true)).eq('tenant_id', ctx.tenantId).eq('id', app.id).maybeSingle()
    if (error) throw dbError(error)
    if (!row) continue
    if (!app.created && app.had_unpublished_changes) {
      await (db as any).from('apps').update(draftMark(ctx)).eq('tenant_id', ctx.tenantId).eq('id', app.id)
      warnings.push({ id: app.id, warning: `App "${row.name}" had unpublished changes, so this update was saved to its draft — review it and publish it to make it live` })
      continue
    }
    const snapshot = await draftSnapshot(ctx, db, row)
    const problems = publishProblems(snapshot)
    if (problems.length) {
      await (db as any).from('apps').update(draftMark(ctx)).eq('tenant_id', ctx.tenantId).eq('id', app.id)
      warnings.push({ id: app.id, warning: `App "${row.name}" was saved as a draft and not published: ${problems.join('; ')}` })
      continue
    }
    if (row.published_version != null) {
      const live = await loadPublishedSnapshot(db, ctx.tenantId, app.id, row.published_version)
      if (live && diffAppSnapshots(live.snapshot, snapshot).unchanged) continue
    }
    const version = await publishSnapshot(ctx, db, row, snapshot, { note: app.created ? 'Installed from a package or configuration' : 'Updated from a package or configuration', source: 'import' })
    await audit({ ...ctx, supabase: db }, { objectType: 'app', objectId: app.id, action: 'publish', summary: `Published app "${snapshot.app.name}" (version ${version}) from a package or configuration`, metadata: { version, source: 'import' } })
  }
  return warnings
}

/** Rewrite links to other apps once every app of the import exists (source slug → local slug). */
export async function relinkApps(ctx: ServiceContext, appIds: string[], appSlugs: Map<string, string>): Promise<void> {
  if (!appIds.length || ![...appSlugs].some(([from, to]) => from !== to)) return
  const db = await serviceRoleClient(ctx)
  const { data: apps } = await (db as any).from('apps').select('id, menu, settings').eq('tenant_id', ctx.tenantId).in('id', appIds)
  const { data: pages } = await (db as any).from('app_pages').select('id, app_id, slug, layout').eq('tenant_id', ctx.tenantId).in('app_id', appIds)
  const map = (ref: { kind: string; id: string }) => (ref.kind === 'app' ? appSlugs.get(ref.id) : undefined)
  for (const app of (apps ?? []) as any[]) {
    const next = rewriteAppReferences({ menu: app.menu, settings: app.settings }, map)
    if (JSON.stringify(next.menu) !== JSON.stringify(app.menu) || JSON.stringify(next.settings) !== JSON.stringify(app.settings)) {
      await (db as any).from('apps').update({ menu: next.menu, settings: next.settings }).eq('tenant_id', ctx.tenantId).eq('id', app.id)
    }
  }
  for (const page of (pages ?? []) as any[]) {
    const next = rewriteAppReferences({ pages: [{ slug: page.slug, layout: page.layout }] }, map)
    const layout = next.pages?.[0]?.layout
    if (JSON.stringify(layout) !== JSON.stringify(page.layout)) await (db as any).from('app_pages').update({ layout }).eq('tenant_id', ctx.tenantId).eq('id', page.id)
  }
}

/* ── Package / Export an app ─────────────────────────────────────────── */

export interface AppPackageInput {
  /** Items to leave out of the package (dependencies the installer must already have). */
  excluded?: Array<{ type: string; id: string }>
  /** Per data table id: "schema" (default) or "rows" (sample data). */
  data_modes?: Record<string, 'schema' | 'rows'>
  /** Exact version; default: the next patch version (1.0.0 first). */
  version?: string
  notes?: string | null
  description?: string | null
  readme?: string | null
  /** published (default): the app's published version; draft: its working draft ("Export draft"). */
  content?: 'published' | 'draft'
}

async function appForPackaging(ctx: ServiceContext, idOrSlug: string) {
  const { getApp } = await import('./apps')
  const app = await getApp(ctx, idOrSlug)
  if (app.access !== 'edit') throw ServiceError.forbidden('Only an app’s editors can package it')
  return app
}

/** The package this workspace keeps for an app (root: the app), if one was made. */
async function findAppPackage(ctx: ServiceContext, appId: string) {
  const db = await serviceRoleClient(ctx)
  const { PACKAGE_COLUMNS, presentPackage } = await import('./packages')
  const { data, error } = await (db as any).from('packages').select(PACKAGE_COLUMNS).eq('tenant_id', ctx.tenantId).contains('roots', [{ type: 'app', id: appId }]).order('created_at').limit(1)
  if (error) throw dbError(error)
  return data?.[0] ? presentPackage(data[0]) : null
}

/**
 * What packaging the app would include (Package / Export dialog): the
 * dependency closure — forms, workflows, data tables (+ views), reports, API
 * references with their integration (definitions only, never credentials),
 * decision tables, email templates, agents, other apps it links to — what an
 * install will ask for, the sites its Embed widgets need, and the package
 * kept for the app (its earlier choices and latest version).
 */
export async function previewAppPackage(ctx: ServiceContext, idOrSlug: string, input: Pick<AppPackageInput, 'excluded' | 'data_modes' | 'content'> = {}) {
  const app = await appForPackaging(ctx, idOrSlug)
  const existing = await findAppPackage(ctx, app.id)
  const { previewPackageContents } = await import('./packages')
  const excluded = input.excluded ?? existing?.excluded ?? []
  const dataModes = input.data_modes ?? existing?.data_modes ?? {}
  const contents = await previewPackageContents(ctx, { roots: [{ type: 'app', id: app.id }], excluded: excluded as any, data_modes: dataModes })
  const db = await serviceRoleClient(ctx)
  const { exportApps } = await import('@/lib/portability/apps')
  const [asset] = await exportApps(db, ctx.tenantId, [app.id], { content: input.content === 'draft' ? 'draft' : 'published' })
  const { appEmbedOrigins, appReferenceIds } = await import('@/lib/apps/references')
  const ids = asset ? appReferenceIds(asset) : null
  return {
    app: { id: app.id, slug: app.slug, name: app.name },
    package: existing ? { id: existing.id, slug: existing.slug, latest_version: existing.latest_version, excluded: existing.excluded, data_modes: existing.data_modes } : null,
    contents,
    embed_origins: asset ? appEmbedOrigins(asset) : [],
    icons: asset?.icons?.length ?? 0,
    /** People, teams and roles named in filters / visibility rules: kept only where they exist in the installing workspace. */
    people: ids ? ids.user.length + ids.team.length : 0,
    not_exported: ['audience', 'editors', 'embed allow-list', 'usage data'],
    /** Which version of the app travels: the published one (the draft while never published), or the working draft. */
    content: input.content === 'draft' ? 'draft' : 'published',
    has_draft_changes: app.publish_state?.has_draft_changes ?? false,
  }
}

/**
 * Package / Export: keep (create or update) the app's package with these
 * choices, build the next signed version and return the .utpkg. Needs
 * packages.manage and edit access to the app; audited on the app and the
 * package.
 */
export async function packageApp(ctx: ServiceContext, idOrSlug: string, input: AppPackageInput = {}) {
  const { requirePerm } = await import('./context')
  requirePerm(ctx, 'packages.manage')
  const app = await appForPackaging(ctx, idOrSlug)
  const packages = await import('./packages')
  let pkg = await findAppPackage(ctx, app.id)
  const excluded = (input.excluded ?? pkg?.excluded ?? []) as any
  const dataModes = input.data_modes ?? pkg?.data_modes ?? {}
  if (pkg) {
    pkg = (await packages.updatePackage(ctx, pkg.id, {
      name: app.name, excluded, data_modes: dataModes,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.readme !== undefined ? { readme: input.readme } : {}),
    })).package
  } else {
    const db = await serviceRoleClient(ctx)
    const { data: taken } = await (db as any).from('packages').select('slug').eq('tenant_id', ctx.tenantId).like('slug', `${app.slug.slice(0, 60)}%`)
    const slug = uniqueSlug(`${app.slug}-app`.slice(0, 64), ((taken ?? []) as any[]).map((r) => String(r.slug)))
    pkg = (await packages.createPackage(ctx, {
      name: app.name, slug, description: input.description ?? app.description ?? app.subtitle ?? null, icon: app.icon && !app.icon.startsWith('svg:') ? app.icon : 'LayoutGrid',
      readme: input.readme ?? `# ${app.name}\n\n${app.description ?? app.subtitle ?? ''}\n\nInstalling creates the app with its pages and everything it uses. You become its editor; choose who can use it in the app's settings (Audience).\n`,
      roots: [{ type: 'app', id: app.id }], excluded, data_modes: dataModes,
    })).package
  }
  const built = await packages.buildPackageVersion(ctx, pkg.id, { version: input.version, notes: input.notes ?? null, include_file: true, app_content: input.content === 'draft' ? 'draft' : 'published', ...(pkg.latest_version || input.version ? {} : { version: '1.0.0' }) })
  await audit(ctx, {
    objectType: 'app', objectId: app.id, action: 'export',
    summary: `Packaged app "${app.name}" as ${pkg.slug} ${built.version.version}`,
    metadata: { package_id: pkg.id, version: built.version.version, assets: built.version.asset_count, excluded: excluded.length, content: input.content === 'draft' ? 'draft' : 'published' },
  })
  return { package: { id: pkg.id, slug: pkg.slug, name: pkg.name }, version: built.version, warnings: built.warnings, file_name: built.file_name, file_base64: built.file_base64 }
}
