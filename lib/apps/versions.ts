/**
 * App drafts and published versions — the pure part (lib/services/app-versions.ts
 * is the service; migration 20270123090000_app_drafts.sql the tables).
 *
 * A snapshot is the whole versioned definition of an app: its header (name,
 * subtitle, description, icon, colour), menu and settings (nav, params,
 * variables, rules, style) plus every page (id, slug, title, icon, order,
 * layout with its widgets / options / params / variables / rules, filters).
 * NOT in a snapshot (effective at once): the slug, the audience and the
 * editors. The SQL backfill in the migration builds the same shape.
 *
 * Also here: the summary the Apps menu cards read (no layouts) and the
 * readable diff between two snapshots (Compare, the Publish dialog, REST
 * GET /apps/{id}/compare, MCP apps_compare).
 */

import { normaliseMenu, normaliseNav, normaliseAppStyle, normalisePageFilters, normalisePageLayout, type AppMenuItem, type AppNav, type AppPage, type PageLayout } from './schema'
import type { AppStyle } from './style'
import { normaliseRules, type AppRule } from './rules'
import { normaliseParams, normaliseVariables, type ParamDecl, type VariableDecl } from './variables'

/* eslint-disable @typescript-eslint/no-explicit-any -- snapshots are stored JSON */

export const SNAPSHOT_FORMAT = 1
/** Settings keys that describe the stored row, not the design (never versioned). */
export const UNVERSIONED_SETTINGS = ['access_issues', 'access_checked_at', 'package', 'sign_in_page'] as const
export const PUBLISH_NOTE_MAX = 1000

export interface SnapshotPage {
  id: string
  slug: string
  title: string
  icon: string | null
  position: number
  layout: unknown
  filters: unknown
}

export interface AppSnapshot {
  format: number
  app: {
    name: string
    subtitle: string | null
    description: string | null
    icon: string | null
    color: string | null
    menu: unknown
    settings: Record<string, unknown>
  }
  pages: SnapshotPage[]
}

export interface SnapshotSummary {
  name: string
  subtitle: string | null
  description: string | null
  icon: string | null
  color: string | null
  /** Where /apps/<slug> opens for the audience. */
  home_page: string | null
}

/** The row fields a snapshot is built from (apps + app_pages as stored). */
export interface DraftRowLike {
  name: string
  subtitle?: string | null
  description?: string | null
  icon?: string | null
  color?: string | null
  menu?: unknown
  settings?: unknown
}
export interface DraftPageLike {
  id: string
  slug: string
  title: string
  icon?: string | null
  position?: number | null
  layout?: unknown
  filters?: unknown
  created_at?: string | null
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

export function versionedSettings(settings: unknown): Record<string, unknown> {
  const out = { ...obj(settings) }
  for (const key of UNVERSIONED_SETTINGS) delete out[key]
  return out
}

/** The draft (as stored) → a snapshot. Pages in menu order (position, then creation). */
export function buildAppSnapshot(row: DraftRowLike, pages: readonly DraftPageLike[]): AppSnapshot {
  const ordered = [...pages].sort((a, b) => (Number(a.position ?? 0) - Number(b.position ?? 0)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id))
  return {
    format: SNAPSHOT_FORMAT,
    app: {
      name: row.name, subtitle: row.subtitle ?? null, description: row.description ?? null, icon: row.icon ?? null, color: row.color ?? null,
      menu: Array.isArray(row.menu) ? row.menu : [],
      settings: versionedSettings(row.settings),
    },
    pages: ordered.map((p) => ({
      id: p.id, slug: p.slug, title: p.title, icon: p.icon ?? null, position: Number(p.position ?? 0),
      layout: p.layout ?? { widgets: [] }, filters: Array.isArray(p.filters) ? p.filters : [],
    })),
  }
}

/** A stored snapshot → a well-formed one (never throws). */
export function readSnapshot(raw: unknown): AppSnapshot {
  const s = obj(raw)
  const app = obj(s.app)
  const pages = Array.isArray(s.pages) ? s.pages : []
  return {
    format: Number(s.format) || SNAPSHOT_FORMAT,
    app: {
      name: typeof app.name === 'string' && app.name ? app.name : 'App',
      subtitle: typeof app.subtitle === 'string' ? app.subtitle : null,
      description: typeof app.description === 'string' ? app.description : null,
      icon: typeof app.icon === 'string' ? app.icon : null,
      color: typeof app.color === 'string' ? app.color : null,
      menu: Array.isArray(app.menu) ? app.menu : [],
      settings: versionedSettings(app.settings),
    },
    pages: pages.filter((p: any) => p && typeof p.id === 'string' && typeof p.slug === 'string').map((p: any) => ({
      id: p.id, slug: p.slug, title: typeof p.title === 'string' && p.title ? p.title : p.slug, icon: typeof p.icon === 'string' ? p.icon : null,
      position: Number(p.position ?? 0) || 0, layout: p.layout ?? { widgets: [] }, filters: Array.isArray(p.filters) ? p.filters : [],
    })),
  }
}

/** Where the app opens: the first page in the menu every audience role may open, else the first page. */
export function snapshotHomePage(snapshot: AppSnapshot): string | null {
  const open = snapshot.pages.find((p) => {
    const o = obj(obj(p.layout).options)
    return o.hidden !== true && (o.min_role ?? 'viewer') === 'viewer'
  })
  return open?.slug ?? snapshot.pages[0]?.slug ?? null
}

export function snapshotSummary(snapshot: AppSnapshot): SnapshotSummary {
  const a = snapshot.app
  return { name: a.name, subtitle: a.subtitle, description: a.description, icon: a.icon, color: a.color, home_page: snapshotHomePage(snapshot) }
}

export function readSummary(raw: unknown): SnapshotSummary | null {
  const s = obj(raw)
  if (typeof s.name !== 'string') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return { name: s.name, subtitle: str(s.subtitle), description: str(s.description), icon: str(s.icon), color: str(s.color), home_page: str(s.home_page) }
}

/** A snapshot's pages as AppPage (normalised, as the services serve them). */
export function snapshotPages(snapshot: AppSnapshot, appId: string, stamp: string): AppPage[] {
  return snapshot.pages.map((p) => ({
    id: p.id, app_id: appId, slug: p.slug, title: p.title, icon: p.icon, position: p.position,
    layout: normalisePageLayout(p.layout), filters: normalisePageFilters(p.filters), updated_at: stamp,
  }))
}

/* ── Compare ─────────────────────────────────────────────────────────── */

export interface AppSnapshotDiff {
  app: { changed: string[] }
  menu_changed: boolean
  nav_changed: boolean
  style_changed: boolean
  params: { added: string[]; removed: string[]; changed: string[] }
  variables: { added: string[]; removed: string[]; changed: string[] }
  /** App-level rules (by name or id). */
  rules: { added: string[]; removed: string[]; changed: string[] }
  pages: {
    added: Array<{ slug: string; title: string; widgets: number }>
    removed: Array<{ slug: string; title: string }>
    changed: Array<{
      slug: string
      title: string
      /** Page settings that changed: title, slug, icon, order, filters, options, params, variables. */
      settings: string[]
      widgets: { added: string[]; removed: string[]; changed: string[] }
      rules: { added: string[]; removed: string[]; changed: string[] }
    }>
    reordered: boolean
  }
  unchanged: boolean
  /** One line per change, for people. */
  lines: string[]
}

const stable = (v: unknown): string => JSON.stringify(sortKeys(v ?? null))
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k])
    return out
  }
  return v
}
const quote = (xs: string[], max = 6) => xs.slice(0, max).map((x) => `“${x}”`).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function diffById<T>(before: readonly T[], after: readonly T[], key: (t: T) => string, name: (t: T) => string) {
  const b = new Map(before.map((x) => [key(x), x]))
  const a = new Map(after.map((x) => [key(x), x]))
  return {
    added: [...a.keys()].filter((k) => !b.has(k)).map((k) => name(a.get(k)!)),
    removed: [...b.keys()].filter((k) => !a.has(k)).map((k) => name(b.get(k)!)),
    changed: [...a.keys()].filter((k) => b.has(k) && stable(a.get(k)) !== stable(b.get(k))).map((k) => name(a.get(k)!)),
  }
}

const ruleName = (r: AppRule) => r.name || r.id
const widgetName = (w: { id: string; title?: string | null; type: string }) => (w.title ? `${w.title} (${w.type})` : `${w.type} ${w.id}`)

interface Design {
  nav: AppNav
  style: AppStyle
  menu: AppMenuItem[]
  params: ParamDecl[]
  variables: VariableDecl[]
  rules: AppRule[]
}
function designOf(s: AppSnapshot): Design {
  const st = s.app.settings
  return { nav: normaliseNav(st.nav), style: normaliseAppStyle(st.style), menu: normaliseMenu(s.app.menu), params: normaliseParams(st.params), variables: normaliseVariables(st.variables), rules: normaliseRules(st.rules) }
}

/**
 * What `after` changes against `before` (e.g. the draft against the published
 * version, or version 3 against version 2). Pages are matched by id.
 */
export function diffAppSnapshots(before: AppSnapshot, after: AppSnapshot): AppSnapshotDiff {
  const lines: string[] = []
  const appChanged = (['name', 'subtitle', 'description', 'icon', 'color'] as const).filter((k) => (before.app[k] ?? null) !== (after.app[k] ?? null))
  const db = designOf(before)
  const da = designOf(after)
  const menuChanged = stable(db.menu) !== stable(da.menu)
  const navChanged = stable(db.nav) !== stable(da.nav)
  const styleChanged = stable(db.style) !== stable(da.style)
  const params = diffById(db.params, da.params, (p) => p.name, (p) => p.name)
  const variables = diffById(db.variables, da.variables, (v) => v.name, (v) => v.name)
  const rules = diffById(db.rules, da.rules, (r) => r.id, ruleName)

  const pb = new Map(before.pages.map((p) => [p.id, p]))
  const pa = new Map(after.pages.map((p) => [p.id, p]))
  const layoutOf = (p: SnapshotPage): PageLayout => normalisePageLayout(p.layout)
  const added = after.pages.filter((p) => !pb.has(p.id)).map((p) => ({ slug: p.slug, title: p.title, widgets: layoutOf(p).widgets.length }))
  const removed = before.pages.filter((p) => !pa.has(p.id)).map((p) => ({ slug: p.slug, title: p.title }))
  const changed: AppSnapshotDiff['pages']['changed'] = []
  for (const p of after.pages) {
    const was = pb.get(p.id)
    if (!was) continue
    const lb = layoutOf(was)
    const la = layoutOf(p)
    const settings: string[] = []
    if (was.title !== p.title) settings.push('title')
    if (was.slug !== p.slug) settings.push('slug')
    if ((was.icon ?? null) !== (p.icon ?? null)) settings.push('icon')
    if (stable(normalisePageFilters(was.filters)) !== stable(normalisePageFilters(p.filters))) settings.push('filters')
    if (stable(lb.options ?? null) !== stable(la.options ?? null)) settings.push('options')
    if (stable(lb.params ?? []) !== stable(la.params ?? [])) settings.push('params')
    if (stable(lb.variables ?? []) !== stable(la.variables ?? [])) settings.push('variables')
    const widgets = diffById(lb.widgets, la.widgets, (w) => w.id, widgetName)
    const pageRules = diffById(lb.rules ?? [], la.rules ?? [], (r) => r.id, ruleName)
    if (settings.length || widgets.added.length || widgets.removed.length || widgets.changed.length || pageRules.added.length || pageRules.removed.length || pageRules.changed.length) {
      changed.push({ slug: p.slug, title: p.title, settings, widgets, rules: pageRules })
    }
  }
  const commonOrder = (list: SnapshotPage[]) => list.filter((p) => pb.has(p.id) && pa.has(p.id)).map((p) => p.id).join(',')
  const reordered = commonOrder(before.pages) !== commonOrder(after.pages)

  if (appChanged.length) lines.push(`App ${appChanged.join(', ')} changed${appChanged.includes('name') ? ` (“${before.app.name}” → “${after.app.name}”)` : ''}`)
  if (added.length) lines.push(`Added ${plural(added.length, 'page')}: ${quote(added.map((p) => p.title))}`)
  if (removed.length) lines.push(`Removed ${plural(removed.length, 'page')}: ${quote(removed.map((p) => p.title))}`)
  if (reordered) lines.push('Pages reordered')
  for (const c of changed) {
    const parts: string[] = []
    if (c.widgets.added.length) parts.push(`${plural(c.widgets.added.length, 'widget')} added (${quote(c.widgets.added, 3)})`)
    if (c.widgets.removed.length) parts.push(`${plural(c.widgets.removed.length, 'widget')} removed (${quote(c.widgets.removed, 3)})`)
    if (c.widgets.changed.length) parts.push(`${plural(c.widgets.changed.length, 'widget')} changed (${quote(c.widgets.changed, 3)})`)
    const rc = c.rules.added.length + c.rules.removed.length + c.rules.changed.length
    if (rc) parts.push(`${plural(rc, 'rule')} changed`)
    if (c.settings.length) parts.push(`${c.settings.join(', ')} changed`)
    lines.push(`Page “${c.title}”: ${parts.join('; ')}`)
  }
  if (menuChanged) lines.push('Menu changed')
  if (navChanged) lines.push('Navigation and header changed')
  if (styleChanged) lines.push('Style changed')
  const rcount = rules.added.length + rules.removed.length + rules.changed.length
  if (rcount) lines.push(`App rules: ${[rules.added.length && `${rules.added.length} added`, rules.removed.length && `${rules.removed.length} removed`, rules.changed.length && `${rules.changed.length} changed`].filter(Boolean).join(', ')}`)
  const vcount = params.added.length + params.removed.length + params.changed.length + variables.added.length + variables.removed.length + variables.changed.length
  if (vcount) lines.push(`App parameters and variables: ${plural(vcount, 'change')}`)
  return {
    app: { changed: appChanged }, menu_changed: menuChanged, nav_changed: navChanged, style_changed: styleChanged,
    params, variables, rules,
    pages: { added, removed, changed, reordered },
    unchanged: lines.length === 0,
    lines,
  }
}

/** Do two snapshots hold the same design? */
export function sameSnapshot(a: AppSnapshot, b: AppSnapshot): boolean {
  return stable({ app: a.app, pages: a.pages }) === stable({ app: b.app, pages: b.pages })
}

/* ── Client: preview arguments ───────────────────────────────────────── */

/** What runtime reads / actions send so the server uses the same version the page shows (editors previewing the draft). */
export interface PreviewArgs { draft?: boolean; as_role?: 'viewer' | 'contributor' | null }

/** The preview arguments for an app as loaded: the draft (editors) and the role previewed as. Empty for the published version. */
export function previewArgsOf(app: { content?: 'draft' | 'published' | 'live'; access?: 'edit' | 'view'; app_role?: string } | null | undefined): PreviewArgs {
  if (!app || app.access !== 'edit') return {}
  const asRole = app.app_role === 'viewer' || app.app_role === 'contributor' ? app.app_role : null
  return { ...(app.content === 'draft' ? { draft: true } : {}), ...(asRole ? { as_role: asRole } : {}) }
}
