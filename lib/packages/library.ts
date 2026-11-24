/**
 * Settings → Packages → Installed: search, filters, sort and paging of the
 * installed package library (pure and isomorphic).
 *
 *  - Search: name, description, version, source (gallery / file / library /
 *    cli / api / mcp and the file or workspace it came from), category, tags
 *    and the names of the items inside the package.
 *  - Filters: status (installed · incomplete setup · update available ·
 *    disabled), source, category, tags.
 *  - Sort: name, installed, updated, version, status (asc / desc).
 *  - URL: `?q=&status=&source=&category=&tag=&sort=&dir=&page=&size=` (lists
 *    comma-separated; keys at their default are left out). A size change
 *    alone goes back to page 1 (lists/pagination: one state, so the
 *    Pagination's own page reset is turned off).
 *
 * The list is filtered in the browser: a workspace installs tens of packages,
 * and the library read returns at most LIBRARY_MAX of them (newest first
 * when capped; the page says so).
 */

import { compareSemver } from './semver'

export const LIBRARY_MAX = 1000
export const LIBRARY_PAGE_SIZES = [25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 25

export type LibraryStatus = 'installed' | 'incomplete' | 'update' | 'disabled'
export type LibraryOrigin = 'gallery' | 'library' | 'file' | 'cli' | 'api' | 'mcp'
export type LibrarySort = 'name' | 'installed' | 'updated' | 'version' | 'status'
export type LibraryDir = 'asc' | 'desc'

export const LIBRARY_STATUSES: ReadonlyArray<{ value: LibraryStatus; label: string; description: string }> = [
  { value: 'installed', label: 'Installed', description: 'Setup complete' },
  { value: 'incomplete', label: 'Incomplete setup', description: 'Values still missing: Complete setup' },
  { value: 'update', label: 'Update available', description: 'A newer version is in the gallery or was built here' },
  { value: 'disabled', label: 'Disabled', description: 'Setup is complete but every workflow in the package is switched off' },
]
export const LIBRARY_ORIGINS: ReadonlyArray<{ value: LibraryOrigin; label: string }> = [
  { value: 'gallery', label: 'Gallery' },
  { value: 'library', label: 'Authored in a workspace' },
  { value: 'file', label: 'File' },
  { value: 'cli', label: 'CLI' },
  { value: 'api', label: 'API' },
  { value: 'mcp', label: 'MCP' },
]
export const LIBRARY_SORTS: ReadonlyArray<{ value: LibrarySort; label: string; dir: LibraryDir }> = [
  { value: 'name', label: 'Name', dir: 'asc' },
  { value: 'installed', label: 'Installed', dir: 'desc' },
  { value: 'updated', label: 'Updated', dir: 'desc' },
  { value: 'version', label: 'Version', dir: 'desc' },
  { value: 'status', label: 'Status', dir: 'asc' },
]

/** What the library read adds to an install row. */
export interface LibraryFacts {
  origin: LibraryOrigin
  /** Gallery category id (gallery packages only). */
  category: string | null
  category_label: string | null
  tags: string[]
  /** Newer version available (gallery or authored here), else null. */
  latest_version: string | null
  update_available: boolean
  /** Setup complete, and every workflow of the package is switched off. */
  disabled: boolean
  /** Names of the items in the package (workflows, forms, tables, …). */
  items: string[]
}

export interface LibraryRow extends LibraryFacts {
  id: string
  name: string
  slug?: string | null
  description?: string | null
  version: string
  source?: string | null
  source_label?: string | null
  status: string
  installed_at?: string | null
  updated_at?: string | null
}

export interface LibraryFilters {
  q: string
  status: LibraryStatus[]
  source: LibraryOrigin[]
  category: string[]
  tags: string[]
  sort: LibrarySort
  dir: LibraryDir
  page: number
  pageSize: number
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = { q: '', status: [], source: [], category: [], tags: [], sort: 'name', dir: 'asc', page: 1, pageSize: DEFAULT_PAGE_SIZE }

type ParamsLike = { get(name: string): string | null }

const list = (value: string | null): string[] => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : [])
const oneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value)
const STATUS_VALUES = LIBRARY_STATUSES.map((s) => s.value)
const ORIGIN_VALUES = LIBRARY_ORIGINS.map((s) => s.value)
const SORT_VALUES = LIBRARY_SORTS.map((s) => s.value)

export function parseLibraryFilters(params: ParamsLike): LibraryFilters {
  const sortRaw = params.get('sort') ?? ''
  const sort = oneOf(SORT_VALUES, sortRaw) ? sortRaw : DEFAULT_LIBRARY_FILTERS.sort
  const dirRaw = params.get('dir')
  const size = Number(params.get('size'))
  const page = Number(params.get('page'))
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    status: list(params.get('status')).filter((v): v is LibraryStatus => oneOf(STATUS_VALUES, v)),
    source: list(params.get('source')).filter((v): v is LibraryOrigin => oneOf(ORIGIN_VALUES, v)),
    category: list(params.get('category')).slice(0, 20),
    tags: list(params.get('tag')).slice(0, 20),
    sort,
    dir: dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : LIBRARY_SORTS.find((s) => s.value === sort)!.dir,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (LIBRARY_PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/** The library's URL query (other params in `base`, e.g. tab, are kept). */
export function serializeLibraryFilters(f: LibraryFilters, base?: URLSearchParams | string): string {
  const out = new URLSearchParams(base)
  for (const key of ['q', 'status', 'source', 'category', 'tag', 'sort', 'dir', 'page', 'size']) out.delete(key)
  if (f.q.trim()) out.set('q', f.q.trim())
  if (f.status.length) out.set('status', f.status.join(','))
  if (f.source.length) out.set('source', f.source.join(','))
  if (f.category.length) out.set('category', f.category.join(','))
  if (f.tags.length) out.set('tag', f.tags.join(','))
  if (f.sort !== DEFAULT_LIBRARY_FILTERS.sort) out.set('sort', f.sort)
  if (f.dir !== LIBRARY_SORTS.find((s) => s.value === f.sort)!.dir) out.set('dir', f.dir)
  if (f.page > 1) out.set('page', String(f.page))
  if (f.pageSize !== DEFAULT_PAGE_SIZE) out.set('size', String(f.pageSize))
  return out.toString()
}

/**
 * One change applied to the filters. Anything but the page itself goes back
 * to page 1 — a size change included, so Pagination's own reset is off.
 */
export function nextLibraryFilters(f: LibraryFilters, patch: Partial<LibraryFilters>): LibraryFilters {
  const next = { ...f, ...patch }
  if (patch.sort && !patch.dir) next.dir = LIBRARY_SORTS.find((s) => s.value === patch.sort)!.dir
  if (!('page' in patch)) next.page = 1
  return next
}

export function hasLibraryFilters(f: LibraryFilters): boolean {
  return Boolean(f.q.trim() || f.status.length || f.source.length || f.category.length || f.tags.length)
}

export function clearLibraryFilters(f: LibraryFilters): LibraryFilters {
  return { ...f, q: '', status: [], source: [], category: [], tags: [], page: 1 }
}

export function rowStatuses(row: LibraryRow): LibraryStatus[] {
  const out: LibraryStatus[] = [row.status === 'incomplete' ? 'incomplete' : 'installed']
  if (row.update_available) out.push('update')
  if (row.disabled) out.push('disabled')
  return out
}

function haystack(row: LibraryRow): string {
  const origin = LIBRARY_ORIGINS.find((o) => o.value === row.origin)?.label ?? ''
  return [row.name, row.slug, row.description, row.version, `v${row.version}`, row.source, row.source_label, origin, row.category_label, ...row.tags, ...row.items]
    .filter(Boolean).join('\n').toLowerCase()
}

export function matchesLibrary(row: LibraryRow, f: LibraryFilters): boolean {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length) {
    const text = haystack(row)
    if (!terms.every((term) => text.includes(term))) return false
  }
  if (f.status.length && !rowStatuses(row).some((s) => f.status.includes(s))) return false
  if (f.source.length && !f.source.includes(row.origin)) return false
  if (f.category.length && !(row.category && f.category.includes(row.category))) return false
  if (f.tags.length) {
    const tags = new Set(row.tags.map((t) => t.toLowerCase()))
    // Any of the chosen tags (as the other lists' tag filter).
    if (!f.tags.some((t) => tags.has(t.toLowerCase()))) return false
  }
  return true
}

const STATUS_RANK: Record<string, number> = { incomplete: 0, complete: 1 }
const time = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0)

export function compareLibrary(a: LibraryRow, b: LibraryRow, sort: LibrarySort, dir: LibraryDir): number {
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  let c: number
  switch (sort) {
    case 'installed': c = time(a.installed_at) - time(b.installed_at); break
    case 'updated': c = time(a.updated_at ?? a.installed_at) - time(b.updated_at ?? b.installed_at); break
    case 'version': c = safeSemver(a.version, b.version); break
    // Needs attention first: incomplete, then update available, then disabled.
    case 'status': c = (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2) || Number(b.update_available) - Number(a.update_available) || Number(b.disabled) - Number(a.disabled); break
    default: c = byName
  }
  if (c === 0) return byName
  return dir === 'desc' ? -c : c
}

function safeSemver(a: string, b: string): number {
  try { return compareSemver(a, b) } catch { return a.localeCompare(b) }
}

export interface LibraryFacets {
  status: Record<LibraryStatus, number>
  sources: Array<{ value: LibraryOrigin; label: string; count: number }>
  categories: Array<{ value: string; label: string; count: number }>
  tags: string[]
}

export function libraryFacets(rows: LibraryRow[]): LibraryFacets {
  const status: Record<LibraryStatus, number> = { installed: 0, incomplete: 0, update: 0, disabled: 0 }
  const sources = new Map<LibraryOrigin, number>()
  const categories = new Map<string, { label: string; count: number }>()
  const tags = new Map<string, string>()
  for (const row of rows) {
    for (const s of rowStatuses(row)) status[s]++
    sources.set(row.origin, (sources.get(row.origin) ?? 0) + 1)
    if (row.category) categories.set(row.category, { label: row.category_label ?? row.category, count: (categories.get(row.category)?.count ?? 0) + 1 })
    for (const tag of row.tags) if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag)
  }
  return {
    status,
    sources: LIBRARY_ORIGINS.filter((o) => sources.has(o.value)).map((o) => ({ ...o, count: sources.get(o.value)! })),
    categories: [...categories].map(([value, c]) => ({ value, label: c.label, count: c.count })).sort((a, b) => a.label.localeCompare(b.label)),
    tags: [...tags.values()].sort((a, b) => a.localeCompare(b)),
  }
}

/** Filter, sort and cut one page (the page is clamped to the last one). */
export function queryLibrary<R extends LibraryRow>(rows: R[], f: LibraryFilters): { rows: R[]; total: number; page: number } {
  const matched = rows.filter((row) => matchesLibrary(row, f)).sort((a, b) => compareLibrary(a, b, f.sort, f.dir))
  const pages = Math.max(1, Math.ceil(matched.length / f.pageSize))
  const page = Math.min(Math.max(1, f.page), pages)
  return { rows: matched.slice((page - 1) * f.pageSize, page * f.pageSize), total: matched.length, page }
}
