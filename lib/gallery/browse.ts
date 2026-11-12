/**
 * Gallery browsing: the pure search / filter / sort / URL logic shared by the
 * public gallery (/gallery, /gallery/controls, /gallery/actions) and the
 * in-app "Browse gallery" picker. Client-safe: it never imports the catalog,
 * so the client bundles only this file and the items the page hands it.
 *
 * Items are a flat, serialisable view of a solution (workflow package), a
 * form control (or control bundle) or a workflow action. The public pages
 * build them from lib/gallery/catalog.json (lib/gallery/browse-items.ts); the
 * in-app picker from the gallery index it fetches (indexEntryToBrowseItem).
 */

import { GALLERY_CATEGORIES, GALLERY_TRIGGERS, type GalleryIndexEntry, type GalleryOrigin, type GalleryTrigger } from './types'

export type BrowseKind = 'solution' | 'control' | 'action'

export const BROWSE_KINDS: Record<BrowseKind, { label: string; singular: string; description: string }> = {
  solution: { label: 'Solutions', singular: 'Solution', description: 'Complete processes: workflows with their forms, rules, data, integrations and emails.' },
  control: { label: 'Form controls', singular: 'Form control', description: 'Web components for your forms: charts, maps, signatures, ratings and more.' },
  action: { label: 'Workflow actions', singular: 'Workflow action', description: 'Sandboxed custom steps for your workflows: math, text, calendars, validation.' },
}

export const BROWSE_KIND_ORDER: BrowseKind[] = ['solution', 'control', 'action']

/** The use-case categories of solutions (form controls and actions have a type of their own). */
export const SOLUTION_CATEGORIES = GALLERY_CATEGORIES.filter((c) => c.id !== 'form-controls' && c.id !== 'workflow-actions')

export interface BrowseItem {
  /** Unique across kinds and sources: `${kind}:${source}:${slug}`. */
  key: string
  kind: BrowseKind
  slug: string
  /** Detail page: a site path (/gallery/…) or an absolute URL (community packages from another instance). */
  href: string
  title: string
  summary: string
  tags: string[]
  /** GalleryCategoryId (solutions), form-controls or workflow-actions. */
  category: string
  source: GalleryOrigin
  /** "No integrations needed" (solutions). */
  native: boolean
  systems: string[]
  /** How a solution starts (null for controls and actions). */
  trigger: GalleryTrigger | null
  version: string
  /** First release (YYYY-MM-DD): the oldest changelog entry, else the release date. */
  firstReleased: string | null
  /** Latest release (YYYY-MM-DD). */
  updated: string | null
  /** Signed by the gallery key. */
  signed: boolean
  /** Short facet label within a kind: "Input" / "Display" / "Bundle" for controls; null otherwise. */
  facet: string | null
  /** gallery.json icon name (lucide, kebab-case); null = the category's icon. */
  icon?: string | null
  /** More words people search for: element tags, function names, the author. */
  keywords: string[]
  /** Community: who shared it, and how often it was downloaded. */
  author?: string | null
  downloads?: number
}

export type BrowseSort = 'featured' | 'name' | 'newest' | 'updated'

export const BROWSE_SORTS: Record<BrowseSort, string> = {
  featured: 'Featured',
  name: 'Name (A–Z)',
  newest: 'Newest',
  updated: 'Recently updated',
}

export type SourceFilter = 'all' | GalleryOrigin

export interface BrowseState {
  q: string
  kind: BrowseKind | 'all'
  category: string | 'all'
  tag: string | null
  /** Facet within a kind (controls: Input / Display / Bundle). */
  facet: string | null
  trigger: GalleryTrigger | 'all'
  source: SourceFilter
  native: boolean
  sort: BrowseSort
}

export const DEFAULT_BROWSE_STATE: BrowseState = { q: '', kind: 'all', category: 'all', tag: null, facet: null, trigger: 'all', source: 'all', native: false, sort: 'featured' }

/**
 * Curated picks for the gallery home and the featured sort (first = most
 * prominent). Code, not catalogue data: slugs missing from a build are skipped.
 */
export const FEATURED_SLUGS: string[] = [
  'employee-onboarding',
  'expense-claims',
  'invoice-three-way-match',
  'access-request-provisioning',
  'csat-nps-survey',
  'contract-approval-esign',
  'rating',
  'signature',
  'date-business-calendar',
]

export function featuredRank(slug: string): number | null {
  const i = FEATURED_SLUGS.indexOf(slug)
  return i === -1 ? null : i
}

/** Lower-case words of a query (whitespace separated, empty words dropped). */
export function queryWords(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean)
}

function haystack(item: BrowseItem): string {
  const category = GALLERY_CATEGORIES.find((c) => c.id === item.category)?.title ?? ''
  return [
    item.title, item.summary, ...item.tags, ...item.systems, ...item.keywords, item.author ?? '', category,
    item.trigger ? GALLERY_TRIGGERS[item.trigger].label : '', item.native ? 'no integrations needed native built-in' : '',
    BROWSE_KINDS[item.kind].singular, item.facet ?? '',
  ].join(' ').toLowerCase()
}

/** Every word of the query appears in the name, description, tags or keywords. */
export function matchesQuery(item: BrowseItem, q: string): boolean {
  const words = queryWords(q)
  if (!words.length) return true
  const text = haystack(item)
  return words.every((w) => text.includes(w))
}

/** Relevance for the featured sort while searching: title hits outrank tag hits outrank the rest. */
export function relevance(item: BrowseItem, q: string): number {
  const words = queryWords(q)
  if (!words.length) return 0
  const title = item.title.toLowerCase()
  const tags = item.tags.join(' ').toLowerCase()
  let score = 0
  for (const w of words) {
    if (title.startsWith(w)) score += 6
    else if (title.includes(w)) score += 4
    if (tags.includes(w)) score += 2
    if (item.summary.toLowerCase().includes(w)) score += 1
  }
  return score
}

type Facet = 'kind' | 'category' | 'tag' | 'facet' | 'trigger' | 'source' | 'native'

/** The items that pass every filter of the state except the ones listed in `ignore` (for facet counts). */
export function filterItems(items: BrowseItem[], state: BrowseState, ignore: Facet[] = []): BrowseItem[] {
  const skip = new Set(ignore)
  return items.filter((item) => matchesQuery(item, state.q)
    && (skip.has('kind') || state.kind === 'all' || item.kind === state.kind)
    && (skip.has('category') || state.category === 'all' || item.category === state.category)
    && (skip.has('tag') || !state.tag || item.tags.some((t) => t.toLowerCase() === state.tag!.toLowerCase()))
    && (skip.has('facet') || !state.facet || item.facet?.toLowerCase() === state.facet.toLowerCase())
    && (skip.has('trigger') || state.trigger === 'all' || item.trigger === state.trigger)
    && (skip.has('source') || state.source === 'all' || item.source === state.source)
    && (skip.has('native') || !state.native || item.native))
}

function byTitle(a: BrowseItem, b: BrowseItem): number {
  return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.key.localeCompare(b.key)
}

/**
 * Sorted copy. featured: curated picks first, then official before community,
 * solutions before controls before actions, then the given (catalogue) order;
 * while searching, relevance comes first. newest / updated: by date, newest
 * first, then by name.
 */
export function sortItems(items: BrowseItem[], sort: BrowseSort, q = ''): BrowseItem[] {
  const order = new Map(items.map((item, i) => [item.key, i]))
  const rank = (item: BrowseItem) => item.source === 'official' ? featuredRank(item.slug) ?? Infinity : Infinity
  const list = [...items]
  switch (sort) {
    case 'name':
      return list.sort(byTitle)
    case 'newest':
      return list.sort((a, b) => (b.firstReleased ?? '').localeCompare(a.firstReleased ?? '') || byTitle(a, b))
    case 'updated':
      return list.sort((a, b) => (b.updated ?? '').localeCompare(a.updated ?? '') || byTitle(a, b))
    default:
      return list.sort((a, b) => relevance(b, q) - relevance(a, q)
        || rank(a) - rank(b)
        || Number(a.source === 'community') - Number(b.source === 'community')
        || BROWSE_KIND_ORDER.indexOf(a.kind) - BROWSE_KIND_ORDER.indexOf(b.kind)
        || order.get(a.key)! - order.get(b.key)!)
  }
}

/** Filter, then sort: what the grid shows. */
export function browse(items: BrowseItem[], state: BrowseState): BrowseItem[] {
  return sortItems(filterItems(items, state), state.sort, state.q)
}

/** Counts for one facet's options, applying every other filter (so each chip says what clicking it shows). */
export function facetCounts(items: BrowseItem[], state: BrowseState, facet: 'kind' | 'category' | 'facet' | 'trigger' | 'source'): Record<string, number> {
  const pool = filterItems(items, state, [facet])
  const counts: Record<string, number> = { all: pool.length }
  for (const item of pool) {
    const value = facet === 'kind' ? item.kind : facet === 'category' ? item.category : facet === 'facet' ? item.facet : facet === 'trigger' ? item.trigger : item.source
    if (value) counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

/** The most used tags (case-insensitive, ties by name), with counts. */
export function topTags(items: BrowseItem[], limit = 12): Array<{ tag: string; count: number }> {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const item of items) {
    for (const tag of new Set(item.tags.map((t) => t.toLowerCase()))) {
      const entry = counts.get(tag) ?? { tag, count: 0 }
      entry.count += 1
      counts.set(tag, entry)
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, limit)
}

export interface GalleryCounts {
  total: number
  kinds: Record<BrowseKind, number>
  /** Solutions per use-case category (categories with none are left out). */
  categories: Record<string, number>
  official: number
  community: number
  native: number
  signed: number
}

/** True counts for the hero, the tabs and the chips, from the items themselves. */
export function galleryCounts(items: BrowseItem[]): GalleryCounts {
  const counts: GalleryCounts = { total: items.length, kinds: { solution: 0, control: 0, action: 0 }, categories: {}, official: 0, community: 0, native: 0, signed: 0 }
  for (const item of items) {
    counts.kinds[item.kind] += 1
    if (item.kind === 'solution') counts.categories[item.category] = (counts.categories[item.category] ?? 0) + 1
    if (item.source === 'community') counts.community += 1
    else counts.official += 1
    if (item.native) counts.native += 1
    if (item.signed) counts.signed += 1
  }
  return counts
}

/** The newest first-release date in the list (the reference for "New"; deterministic, not the build time). */
export function newestRelease(items: BrowseItem[]): string | null {
  return items.reduce<string | null>((max, item) => (item.firstReleased && (!max || item.firstReleased > max) ? item.firstReleased : max), null)
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

/** First released within `days` days of the reference date (the newest release in the gallery). */
export function isNew(item: Pick<BrowseItem, 'firstReleased'>, reference: string | null, days = 14): boolean {
  if (!item.firstReleased || !reference) return false
  const age = dayNumber(reference) - dayNumber(item.firstReleased)
  return Number.isFinite(age) && age >= 0 && age <= days
}

// ── URL query params (shareable filters) ─────────────────────────────────

const KIND_PARAM: Record<BrowseKind, string> = { solution: 'solutions', control: 'controls', action: 'actions' }

/**
 * Reads ?q=&type=&category=&tag=&trigger=&source=&native=1&sort= (unknown
 * values fall back to the defaults). The older ?category=form-controls /
 * workflow-actions links select the type instead.
 */
export function parseBrowseParams(input: URLSearchParams | string, base: BrowseState = DEFAULT_BROWSE_STATE): BrowseState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input
  const state: BrowseState = { ...base }
  const q = params.get('q')
  if (q) state.q = q.slice(0, 200)
  const type = params.get('type')
  const kind = (Object.keys(KIND_PARAM) as BrowseKind[]).find((k) => KIND_PARAM[k] === type || k === type)
  if (kind) state.kind = kind
  const category = params.get('category')
  if (category === 'form-controls') state.kind = 'control'
  else if (category === 'workflow-actions') state.kind = 'action'
  else if (category && SOLUTION_CATEGORIES.some((c) => c.id === category)) state.category = category
  const tag = params.get('tag')
  if (tag) state.tag = tag.toLowerCase().slice(0, 80)
  const facet = params.get('facet')
  if (facet) state.facet = facet.toLowerCase().slice(0, 40)
  const trigger = params.get('trigger')
  if (trigger && trigger in GALLERY_TRIGGERS) state.trigger = trigger as GalleryTrigger
  const source = params.get('source')
  if (source === 'official' || source === 'community') state.source = source
  if (params.get('native') === '1') state.native = true
  const sort = params.get('sort')
  if (sort && sort in BROWSE_SORTS) state.sort = sort as BrowseSort
  return state
}

/** The query params of a state, leaving out every value equal to `base` (stable key order). */
export function browseParams(state: BrowseState, base: BrowseState = DEFAULT_BROWSE_STATE): URLSearchParams {
  const params = new URLSearchParams()
  const q = state.q.trim()
  if (q && q !== base.q) params.set('q', q)
  if (state.kind !== base.kind && state.kind !== 'all') params.set('type', KIND_PARAM[state.kind])
  if (state.category !== base.category && state.category !== 'all') params.set('category', state.category)
  if (state.tag && state.tag !== base.tag) params.set('tag', state.tag)
  if (state.facet && state.facet !== base.facet) params.set('facet', state.facet.toLowerCase())
  if (state.trigger !== base.trigger && state.trigger !== 'all') params.set('trigger', state.trigger)
  if (state.source !== base.source && state.source !== 'all') params.set('source', state.source)
  if (state.native && !base.native) params.set('native', '1')
  if (state.sort !== base.sort) params.set('sort', state.sort)
  return params
}

/** Any filter or search differs from the base (the home then hides its featured strip). */
export function isFiltered(state: BrowseState, base: BrowseState = DEFAULT_BROWSE_STATE): boolean {
  return state.q.trim() !== base.q || state.kind !== base.kind || state.category !== base.category || state.tag !== base.tag
    || state.facet !== base.facet || state.trigger !== base.trigger || state.source !== base.source || state.native !== base.native
}

// ── The in-app picker's index entries ─────────────────────────────────────

/** A gallery index entry (public/gallery/index.json or the community index) as a browse item. */
export function indexEntryToBrowseItem(entry: GalleryIndexEntry): BrowseItem {
  const kind: BrowseKind = entry.kind === 'form_control' || entry.kind === 'control_bundle' ? 'control' : entry.kind === 'workflow_action' ? 'action' : 'solution'
  const source = entry.source ?? 'official'
  // Controls and actions are listed by their page slug (form-control-rating → rating), like the public pages.
  const slug = kind === 'solution' ? entry.slug : entry.page.split('/').filter(Boolean).pop() ?? entry.slug
  return {
    key: `${kind}:${source}:${entry.slug}`,
    kind,
    slug,
    href: entry.page,
    title: entry.title,
    summary: entry.summary,
    tags: entry.tags,
    category: entry.category,
    source,
    native: entry.native === true,
    systems: entry.systems ?? [],
    trigger: kind === 'solution' ? entry.trigger ?? null : null,
    version: entry.version,
    firstReleased: entry.released || null,
    updated: entry.released || null,
    signed: entry.signed,
    facet: kind === 'control' ? (entry.kind === 'control_bundle' ? 'Bundle' : entry.control?.kind === 'display' ? 'Display' : 'Input') : null,
    keywords: [
      ...(entry.control?.tags ?? []),
      ...(entry.control?.capabilities ?? []),
      ...(entry.action ? [entry.action.key, ...entry.action.operations.flatMap((o) => [o.id, o.label])] : []),
    ],
    author: entry.author?.name ?? null,
    downloads: entry.downloads,
  }
}
