/* eslint-disable @typescript-eslint/no-explicit-any -- app configs are walked as free-form JSON */

/**
 * The ONE reference walker for app configuration (pure, client-safe;
 * __tests__/apps-references.test.ts). Packaging (lib/services/app-packages.ts),
 * dependency discovery (lib/portability/dependencies.ts), config-as-code /
 * GitHub sync and install-time id remapping all go through it — so a new
 * widget, button, tab target, menu entry or (Phase 3) rule action that names
 * an object is picked up everywhere at once.
 *
 * What it finds, anywhere in an app (icon, menu, settings incl. nav and
 * Phase 3 params / variables / rules, and every page's icon, layout and
 * filters):
 *
 *  - objects by key (OBJECT_REF_KEYS): form_id, workflow_id, table_id,
 *    report_id, reference_id (API reference → its integration), agent_id —
 *    at any depth, whatever widget or entry holds them. Values bound to a
 *    page filter ({ filter: '<id>' }) are not ids and are skipped.
 *  - page filters of kind form / workflow / table whose `default` is an id,
 *    and literal ids passed to such a filter (open-page `filters`, a
 *    set_filter action, a metric's click_value) — the kind comes from the
 *    target page's filter definition.
 *  - people (PRINCIPAL_REF_KEYS): user / team ids (assignee, person, team,
 *    visibility teams) and role ids (visibility roles). They never travel;
 *    an install keeps the ones that exist in the workspace and drops the rest.
 *  - pages of this app by slug (page_slug, page, after_page) — internal links.
 *  - other apps by slug in a link (`/apps/<slug>…` in url / link fields).
 *  - uploaded icons: any `svg:<uuid>` token, at any key.
 *
 * `rewriteAppReferences` returns a copy with every reference mapped through a
 * callback (undefined: keep; null: drop — a scalar becomes null, a list entry
 * is removed). Nothing else in the config is touched.
 */

import { customIconId, customIconToken } from './icon-svg'

export type AppObjectKind = 'form' | 'workflow' | 'data_table' | 'report' | 'reference' | 'agent'
export type AppPrincipalKind = 'user' | 'team' | 'role'
export type AppRefKind = AppObjectKind | AppPrincipalKind | 'page' | 'app' | 'icon'

/** Config keys holding an object id (at any depth). */
export const OBJECT_REF_KEYS: Readonly<Record<string, AppObjectKind>> = {
  form_id: 'form',
  workflow_id: 'workflow',
  table_id: 'data_table',
  report_id: 'report',
  reference_id: 'reference',
  agent_id: 'agent',
}

/** Config keys holding a person / team / role id, or a list of them. */
export const PRINCIPAL_REF_KEYS: Readonly<Record<string, AppPrincipalKind>> = {
  assignee: 'user',
  person: 'user',
  team: 'team',
  teams: 'team',
  roles: 'role',
}

/** Config keys holding the slug of a page of the same app. */
export const PAGE_REF_KEYS: readonly string[] = ['page_slug', 'page', 'after_page']

/** Config keys holding a link that may point at another app (/apps/<slug>). */
export const LINK_KEYS: readonly string[] = ['url', 'link', 'footer_help_url', 'banner_url']

/** Maps whose keys are names (parameters, reference inputs), not config keys: never walked as config. */
const OPAQUE_KEYS = new Set(['params', 'reference_inputs', 'prefill', 'badge_colors', 'template'])

/** Page filter kind → the object its id value names. */
const FILTER_KIND_REF: Readonly<Record<string, AppRefKind>> = { form: 'form', workflow: 'workflow', table: 'data_table', user: 'user', team: 'team' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const APP_LINK_RE = /^\/apps\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?=$|[/?#])/
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface AppRef {
  kind: AppRefKind
  /** The id (objects, people, icons) or slug (pages, apps). */
  id: string
  /** JSON path inside the app document. */
  path: Array<string | number>
  /** Human-readable place ("Page Home › Actions", "Menu", "App icon"). */
  where: string
}

/** The parts of an app the walker reads (an exported app asset, or app + pages rows). */
export interface AppDocument {
  icon?: string | null
  menu?: unknown
  settings?: unknown
  pages?: ReadonlyArray<{ slug?: string; title?: string; icon?: string | null; layout?: unknown; filters?: unknown }>
  [key: string]: unknown
}

type Mapper = (ref: AppRef) => unknown

interface WalkState {
  doc: AppDocument
  /** Filter kinds per page slug. */
  filterKinds: Map<string, Map<string, string>>
  map: Mapper | null
  out: AppRef[]
}

function filterKindsOf(doc: AppDocument): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
    const kinds = new Map<string, string>()
    for (const f of Array.isArray(page?.filters) ? page.filters as any[] : []) if (isObj(f) && typeof f.id === 'string') kinds.set(f.id, String(f.kind ?? ''))
    out.set(String(page?.slug ?? ''), kinds)
  }
  return out
}

/** Report one reference; returns the (possibly mapped) value. `undefined` from the mapper keeps it. */
function hit(state: WalkState, kind: AppRefKind, id: string, path: Array<string | number>, where: string, current: unknown, toValue: (mapped: string) => unknown = (m) => m): unknown {
  const ref: AppRef = { kind, id, path, where }
  state.out.push(ref)
  if (!state.map) return current
  const mapped = state.map(ref)
  if (mapped === undefined) return current
  if (mapped === null) return null
  return toValue(String(mapped))
}

/** A literal value given to a page filter (by the target page's filter kind). */
function filterValue(state: WalkState, pageSlug: string, filterId: string, value: unknown, path: Array<string | number>, where: string): unknown {
  const kind = FILTER_KIND_REF[state.filterKinds.get(pageSlug)?.get(filterId) ?? '']
  if (!kind || !isUuid(value)) return value
  return hit(state, kind, value, path, where, value)
}

function walk(state: WalkState, value: unknown, path: Array<string | number>, where: string, page: string, depth: number): unknown {
  if (depth > 40) return value
  if (typeof value === 'string') {
    const icon = customIconId(value)
    return icon ? hit(state, 'icon', icon, path, where, value, (m) => customIconToken(m)) : value
  }
  if (Array.isArray(value)) {
    const out: unknown[] = []
    value.forEach((item, i) => {
      const next = walk(state, item, [...path, i], where, page, depth + 1)
      out.push(next)
    })
    return out
  }
  if (!isObj(value)) return value
  const out: Record<string, unknown> = {}
  // An open-page target: literal filter values are typed by the target page's filters.
  const targetPage = typeof value.page_slug === 'string' ? value.page_slug : null
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key]
    if (OPAQUE_KEYS.has(key)) {
      // Still find uploaded icons in a card template (field icons).
      out[key] = key === 'template' ? walk(state, child, childPath, where, page, depth + 1) : child
      continue
    }
    const objectKind = OBJECT_REF_KEYS[key]
    if (objectKind && isUuid(child)) { out[key] = hit(state, objectKind, child, childPath, where, child); continue }
    const principal = PRINCIPAL_REF_KEYS[key]
    if (principal && isUuid(child)) { out[key] = hit(state, principal, child, childPath, where, child); continue }
    if (principal && Array.isArray(child)) {
      const list: unknown[] = []
      child.forEach((id, i) => {
        if (!isUuid(id)) { list.push(id); return }
        const next = hit(state, principal, id, [...childPath, i], where, id)
        if (next !== null) list.push(next)
      })
      out[key] = list
      continue
    }
    if (PAGE_REF_KEYS.includes(key) && typeof child === 'string' && child) {
      hit(state, 'page', child, childPath, where, child)
      out[key] = child
      continue
    }
    if (LINK_KEYS.includes(key) && typeof child === 'string') {
      const m = APP_LINK_RE.exec(child)
      out[key] = m ? hit(state, 'app', m[1], childPath, where, child, (slug) => child.replace(APP_LINK_RE, `/apps/${slug}`)) : child
      continue
    }
    if (key === 'filters' && targetPage && isObj(child)) {
      out[key] = Object.fromEntries(Object.entries(child).map(([filterId, v]) => [filterId, filterValue(state, targetPage, filterId, v, [...childPath, filterId], where)]))
      continue
    }
    out[key] = walk(state, child, childPath, where, page, depth + 1)
  }
  // set_filter actions and metric click-throughs pass a literal to a filter.
  if (value.kind === 'set_filter' && typeof value.filter === 'string' && 'value' in out) {
    out.value = filterValue(state, page, value.filter, out.value, [...path, 'value'], where)
  }
  if (isObj(value.click) && typeof value.click.filter === 'string' && 'click_value' in out) {
    out.click_value = filterValue(state, typeof value.click.page === 'string' && value.click.page ? value.click.page : page, value.click.filter, out.click_value, [...path, 'click_value'], where)
  }
  return out
}

function walkPageFilters(state: WalkState, filters: unknown, path: Array<string | number>, where: string): unknown {
  if (!Array.isArray(filters)) return filters
  return filters.map((f, i) => {
    if (!isObj(f)) return f
    const kind = FILTER_KIND_REF[String(f.kind ?? '')]
    if (!kind || !isUuid(f.default)) return f
    return { ...f, default: hit(state, kind, f.default, [...path, i, 'default'], `${where} › filter ${f.label ?? f.id}`, f.default) }
  })
}

function run(doc: AppDocument, map: Mapper | null): { refs: AppRef[]; doc: AppDocument } {
  const state: WalkState = { doc, filterKinds: filterKindsOf(doc), map, out: [] }
  const next: AppDocument = { ...doc }
  if ('icon' in doc) next.icon = walk(state, doc.icon, ['icon'], 'App icon', '', 0) as string | null
  if ('menu' in doc) next.menu = walk(state, doc.menu, ['menu'], 'Menu', '', 0)
  if ('settings' in doc) next.settings = walk(state, doc.settings, ['settings'], 'App settings', '', 0)
  if (Array.isArray(doc.pages)) {
    next.pages = doc.pages.map((page, i) => {
      if (!isObj(page)) return page
      const slug = String(page.slug ?? '')
      const where = `Page ${page.title ?? slug}`
      const copy: Record<string, unknown> = { ...page }
      if ('icon' in page) copy.icon = walk(state, page.icon, ['pages', i, 'icon'], where, slug, 0)
      if ('layout' in page) copy.layout = walk(state, page.layout, ['pages', i, 'layout'], where, slug, 0)
      if ('filters' in page) copy.filters = walkPageFilters(state, page.filters, ['pages', i, 'filters'], where)
      return copy as typeof page
    })
  }
  return { refs: state.out, doc: next }
}

/** Every reference in an app, in document order. */
export function collectAppReferences(doc: AppDocument): AppRef[] {
  return run(doc, null).refs
}

/** A copy of the app with each reference mapped (undefined: keep; null: drop). */
export function rewriteAppReferences<T extends AppDocument>(doc: T, map: Mapper): T {
  return run(doc, map).doc as T
}

/** Distinct ids per kind (objects, people, icons) or slugs (pages, apps). */
export function appReferenceIds(doc: AppDocument): Record<AppRefKind, string[]> {
  const out: Record<string, Set<string>> = {}
  for (const ref of collectAppReferences(doc)) (out[ref.kind] ??= new Set()).add(ref.id)
  const kinds: AppRefKind[] = ['form', 'workflow', 'data_table', 'report', 'reference', 'agent', 'user', 'team', 'role', 'page', 'app', 'icon']
  return Object.fromEntries(kinds.map((k) => [k, [...(out[k] ?? [])]])) as Record<AppRefKind, string[]>
}

/** Links to pages that are not in the app (by slug), with where they are. */
export function brokenPageLinks(doc: AppDocument): AppRef[] {
  const slugs = new Set((doc.pages ?? []).map((p) => String(p?.slug ?? '')))
  return collectAppReferences(doc).filter((r) => r.kind === 'page' && !slugs.has(r.id))
}

/**
 * Sites the app frames (Embed widgets and URL tabs): origins an installer
 * must allow in Settings → Embedding for them to show. Videos play from the
 * always-allowed players and are not listed.
 */
export function appEmbedOrigins(doc: AppDocument): string[] {
  const out = new Set<string>()
  const origin = (url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return
    try { out.add(new URL(url).origin.toLowerCase()) } catch { /* not a URL */ }
  }
  for (const page of Array.isArray(doc.pages) ? doc.pages : []) {
    const widgets = isObj(page?.layout) && Array.isArray((page.layout as any).widgets) ? (page.layout as any).widgets as any[] : []
    for (const w of widgets) {
      if (w?.type === 'embed') origin(w?.config?.url)
      if (w?.type === 'tabs') for (const t of Array.isArray(w?.config?.tabs) ? w.config.tabs : []) if (t?.target?.kind === 'url') origin(t.target.url)
    }
  }
  return [...out].sort()
}
