// Apps in manifests (packages, config as code, GitHub sync).
//
// An app travels as one asset in the `apps` section:
//
//   { id, name, slug (a suggestion: installs de-duplicate it), subtitle,
//     description, icon, color, menu, settings (nav, theme accent and — with
//     app Phase 3 — params / variables / rules), pages: [{ id, slug, title,
//     icon, position, layout, filters }], icons: [{ id, name, tint, svg }] }
//
// Never exported: the audience and editors (the installer chooses who can use
// it and becomes its editor), the workspace embed allow-list (an install
// lists the origins as a requirement), usage data and the cached access-issue
// count. Uploaded SVG icons the app uses travel as their (sanitised) markup
// and are sanitised again on import (lib/services/app-packages.ts).
//
// References (forms, workflows, tables, reports, API references, agents,
// people, pages, other apps, icons) are found and remapped by the one app
// reference walker, lib/apps/references.ts.

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars -- manifests are free-form JSON; destructuring drops fields */

import { selectWithTags } from '@/lib/services/tags-column'
import { collectAppReferences, rewriteAppReferences, type AppDocument, type AppRef } from '@/lib/apps/references'
import { cleanAppIconSvg } from '@/lib/apps/icon-svg'
import type { AssetIdMaps } from './id-maps'
import { readSnapshot, type AppSnapshot } from '@/lib/apps/versions'

/** Settings keys that are per workspace (never exported or compared). */
export const VOLATILE_APP_SETTINGS = ['access_issues', 'access_checked_at', 'package'] as const

export interface AppIconAsset { id: string; name: string; tint: boolean; svg: string }

/** The retired (pre strip-back) apps section carried asset links, not pages. */
export function isRetiredAppAsset(asset: unknown): boolean {
  return !asset || typeof asset !== 'object' || Array.isArray(asset) || !Array.isArray((asset as Record<string, unknown>).pages)
}

export function portableAppSettings(settings: unknown): Record<string, unknown> {
  const out = settings && typeof settings === 'object' && !Array.isArray(settings) ? { ...(settings as Record<string, unknown>) } : {}
  for (const key of VOLATILE_APP_SETTINGS) delete out[key]
  return out
}

/** Dependency refs (object kinds the package system knows) of an app asset. */
export function appDependencyRefs(asset: AppDocument): AppRef[] {
  return collectAppReferences(asset).filter((r) => ['form', 'workflow', 'data_table', 'report', 'reference', 'agent', 'role', 'app'].includes(r.kind))
}

const OBJECT_MAP: Record<string, keyof AssetIdMaps> = {
  form: 'form', workflow: 'workflow', data_table: 'data_table', report: 'report', reference: 'reference', agent: 'agent',
}

/**
 * Objects remapped through the import's id maps (ids not in the maps are
 * kept: they may exist here already). People, icons and app links are left
 * for the caller (lib/services/app-packages.ts), which knows the workspace.
 */
export function remapAppAsset<T extends AppDocument>(asset: T, idMaps: AssetIdMaps): T {
  return rewriteAppReferences(asset, (ref) => {
    const map = OBJECT_MAP[ref.kind]
    if (map) return idMaps[map]?.[ref.id]
    if (ref.kind === 'role') return idMaps.role?.[ref.id]
    return undefined
  })
}

/** Small stable hash (comparison only). */
function hashText(text: string): string {
  let h1 = 0x811c9dc5
  let h2 = 5381
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = (Math.imul(h2, 33) + c) >>> 0
  }
  return `${h1.toString(16)}${h2.toString(16)}`
}

/**
 * The comparable shape of an app (plans): icon tokens become the hash of the
 * icon's markup (an install gives icons new ids), page ids and the slug (local
 * identity) are dropped, volatile settings removed, pages in slug order.
 */
export function comparableAppAsset(asset: Record<string, any>): Record<string, any> {
  if (isRetiredAppAsset(asset)) return asset
  // The markup as an install stores it (sanitised again), so a file with the raw upload doesn't drift.
  // An icon that fails sanitising is dropped by the install (null), as here.
  const icons = new Map<string, string | null>((Array.isArray(asset.icons) ? asset.icons : []).map((i: any) => {
    const clean = cleanAppIconSvg(String(i?.svg ?? ''))
    return [String(i?.id ?? '').toLowerCase(), clean ? hashText(clean) : null]
  }))
  const swapped = rewriteAppReferences(asset as AppDocument, (ref) => (ref.kind === 'icon' ? (icons.has(ref.id) ? icons.get(ref.id) : 'missing') : undefined))
  const { icons: _icons, slug: _slug, ...rest } = swapped as Record<string, any>
  return {
    ...rest,
    settings: portableAppSettings(rest.settings),
    pages: (Array.isArray(rest.pages) ? rest.pages : [])
      .map(({ id: _id, app_id: _app, updated_at: _u, ...page }: any) => page)
      .sort((a: any, b: any) => String(a.slug).localeCompare(String(b.slug))),
  }
}

/** Uploaded icon ids an app uses (svg:<uuid> tokens anywhere). */
export function appIconIds(asset: AppDocument): string[] {
  return [...new Set(collectAppReferences(asset).filter((r) => r.kind === 'icon').map((r) => r.id))]
}

const MAX_ICON_BYTES = 100 * 1024

/**
 * Export rows of the `apps` section (tenant-pinned). Pages in menu order;
 * the icons the app uses, read from storage (an unreadable icon is left out
 * and its token falls back to the default icon on import).
 *
 * Drafts (migration 20270123090000): the PUBLISHED version of each app is
 * exported — what packages, config-as-code and GitHub sync carry — or its
 * draft while it was never published. `content: 'draft'` exports the
 * working drafts instead ("Export draft").
 */
export async function exportApps(supabase: any, tenantId: string, ids: string[], opts: { content?: 'published' | 'draft' } = {}): Promise<Array<Record<string, any>>> {
  // Tags arrive with migration 20270122150000 (read without them until it is applied); published_version with
  // 20270123090000 (before it, export the rows). Either may be applied first. Tags are live app metadata (not versioned).
  const base = 'id, slug, name, subtitle, description, icon, color, menu, settings'
  const read = (columns: string) => selectWithTags(columns, (cols) => supabase.from('apps').select(cols).in('id', ids).eq('tenant_id', tenantId).order('name'))
  let { data: apps, error } = await read(`${base}, published_version`)
  if (error) ({ data: apps, error } = await read(base))
  // A database without the apps tables (migration 20270120090000) exports none.
  if (error) return []
  if (!apps?.length) return []
  const { data: pages } = await supabase.from('app_pages')
    .select('id, app_id, slug, title, icon, position, layout, filters')
    .in('app_id', apps.map((a: any) => a.id)).eq('tenant_id', tenantId)
    .order('position', { ascending: true }).order('slug', { ascending: true })
  const published = new Map<string, AppSnapshot>()
  const wantPublished = opts.content === 'draft' ? [] : (apps as any[]).filter((a) => a.published_version != null)
  if (wantPublished.length) {
    const { data: versions } = await supabase.from('app_versions').select('app_id, version, snapshot')
      .eq('tenant_id', tenantId).in('app_id', wantPublished.map((a) => a.id)).in('version', [...new Set(wantPublished.map((a) => Number(a.published_version)))])
    for (const v of (versions ?? []) as any[]) {
      if (wantPublished.some((a) => a.id === v.app_id && Number(a.published_version) === Number(v.version))) published.set(String(v.app_id), readSnapshot(v.snapshot))
    }
  }
  let library: any[] = []
  const wantedIcons = new Set<string>()
  const rows = (apps as any[]).map((raw) => {
    const snap = published.get(raw.id)
    const app = snap ? { ...raw, ...snap.app } : raw
    const appPages = snap
      ? snap.pages.map((p) => ({ ...p, app_id: raw.id }))
      : ((pages ?? []) as any[]).filter((p) => p.app_id === raw.id)
    const doc = {
      id: app.id, name: app.name, slug: app.slug, subtitle: app.subtitle ?? null, description: app.description ?? null,
      icon: app.icon ?? null, color: app.color ?? null, menu: Array.isArray(app.menu) ? app.menu : [],
      // Only when tagged, so untagged apps' files don't change.
      ...(Array.isArray(app.tags) && app.tags.length ? { tags: app.tags.map(String) } : {}),
      settings: portableAppSettings(app.settings),
      pages: appPages.map(({ app_id: _a, ...p }: any) => ({
        ...p, icon: p.icon ?? null, layout: p.layout ?? { widgets: [] }, filters: Array.isArray(p.filters) ? p.filters : [],
      })),
    }
    for (const id of appIconIds(doc)) wantedIcons.add(id)
    return doc
  })
  const svgs = new Map<string, AppIconAsset>()
  if (wantedIcons.size) {
    const { data: tenant } = await supabase.from('tenants').select('settings').eq('id', tenantId).maybeSingle()
    library = Array.isArray(tenant?.settings?.apps?.icons) ? tenant.settings.apps.icons : []
    try {
      const { getStorageProvider } = await import('@/lib/providers/storage')
      const storage = await getStorageProvider()
      for (const id of wantedIcons) {
        const entry = library.find((i) => String(i?.id ?? '').toLowerCase() === id)
        try {
          const object = await storage.get('task-files', `app-icons/${tenantId}/${id}.svg`)
          if (!object) continue
          const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
          if (bytes.byteLength > MAX_ICON_BYTES) continue
          svgs.set(id, { id, name: String(entry?.name ?? 'Icon'), tint: Boolean(entry?.tint), svg: new TextDecoder().decode(bytes) })
        } catch { /* unreadable: left out */ }
      }
    } catch { /* no storage: icons left out */ }
  }
  return rows.map((doc) => {
    const icons = appIconIds(doc).map((id) => svgs.get(id)).filter((i): i is AppIconAsset => Boolean(i)).sort((a, b) => a.id.localeCompare(b.id))
    return icons.length ? { ...doc, icons } : doc
  })
}
