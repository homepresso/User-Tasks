/**
 * Settings → Packages → Installed (lib/packages/library.ts): search over
 * name / description / version / source / items, the status, source,
 * category and tag filters, sort, paging (a size change actually changes the
 * size and goes back to page 1), the URL round trip, and the wiring
 * (Pagination with the extra page reset off; the library read used).
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  clearLibraryFilters, DEFAULT_LIBRARY_FILTERS, hasLibraryFilters, libraryFacets, nextLibraryFilters, parseLibraryFilters, queryLibrary,
  serializeLibraryFilters, type LibraryRow,
} from '@/lib/packages/library'

const row = (over: Partial<LibraryRow> & { id: string; name: string }): LibraryRow => ({
  version: '1.0.0', status: 'complete', source: 'file', source_label: null, description: null, installed_at: '2026-11-01T00:00:00Z', updated_at: null,
  origin: 'file', category: null, category_label: null, tags: [], latest_version: null, update_available: false, disabled: false, items: [], ...over,
})

const ROWS: LibraryRow[] = [
  row({ id: 'crm', name: 'Revenue CRM', version: '1.0.0', origin: 'gallery', category: 'customer-sales', category_label: 'Customer & Sales', tags: ['crm', 'sales'], items: ['CRM lead intake', 'Deals'], installed_at: '2026-11-20T00:00:00Z', status: 'incomplete', latest_version: '1.1.0', update_available: true }),
  row({ id: 'exp', name: 'Expense claims', version: '2.3.0', origin: 'gallery', category: 'finance', category_label: 'Finance', tags: ['finance'], items: ['Approve expense claim'], installed_at: '2026-11-10T00:00:00Z' }),
  row({ id: 'inv', name: 'Invoice approval', version: '1.10.0', origin: 'library', source: 'library', source_label: 'Northwind Trading', description: 'Two-step invoice approval', tags: ['finance', 'ap'], installed_at: '2026-10-01T00:00:00Z', disabled: true }),
  row({ id: 'ops', name: 'ops-sync', version: '0.9.0', origin: 'cli', source: 'cli', source_label: 'ops-sync-0.9.0.utpkg', installed_at: '2026-11-15T00:00:00Z', updated_at: '2026-11-22T00:00:00Z' }),
]

const f = (over: Partial<typeof DEFAULT_LIBRARY_FILTERS> = {}) => ({ ...DEFAULT_LIBRARY_FILTERS, ...over })
const names = (over: Partial<typeof DEFAULT_LIBRARY_FILTERS> = {}) => queryLibrary(ROWS, f(over)).rows.map((r) => r.id)

describe('search', () => {
  it('matches name, description, version, source and the items inside', () => {
    expect(names({ q: 'crm' })).toEqual(['crm'])
    expect(names({ q: 'two-step' })).toEqual(['inv'])
    expect(names({ q: 'v1.10' })).toEqual(['inv'])
    expect(names({ q: 'northwind' })).toEqual(['inv'])
    expect(names({ q: 'gallery' })).toEqual(['exp', 'crm'])
    expect(names({ q: 'approve expense' })).toEqual(['exp'])
    expect(names({ q: 'lead intake' })).toEqual(['crm'])
    expect(names({ q: 'nothing like this' })).toEqual([])
  })
})

describe('filters', () => {
  it('status: installed, incomplete setup, update available, disabled', () => {
    expect(names({ status: ['incomplete'] })).toEqual(['crm'])
    expect(names({ status: ['update'] })).toEqual(['crm'])
    expect(names({ status: ['disabled'] })).toEqual(['inv'])
    expect(names({ status: ['installed'] })).toEqual(['exp', 'inv', 'ops'])
  })
  it('source, category and tags (any of the chosen tags)', () => {
    expect(names({ source: ['gallery'] })).toEqual(['exp', 'crm'])
    expect(names({ source: ['cli', 'library'] })).toEqual(['inv', 'ops'])
    expect(names({ category: ['finance'] })).toEqual(['exp'])
    expect(names({ tags: ['AP', 'crm'] })).toEqual(['inv', 'crm'])
  })
  it('facets count what the rows have', () => {
    const facets = libraryFacets(ROWS)
    expect(facets.status).toEqual({ installed: 3, incomplete: 1, update: 1, disabled: 1 })
    expect(facets.sources.map((s) => [s.value, s.count])).toEqual([['gallery', 2], ['library', 1], ['cli', 1]])
    expect(facets.categories.map((c) => c.value)).toEqual(['customer-sales', 'finance'])
    expect(facets.tags).toEqual(['ap', 'crm', 'finance', 'sales'])
  })
})

describe('sort', () => {
  it('name, installed, updated, version (semver), status', () => {
    expect(names()).toEqual(['exp', 'inv', 'ops', 'crm'])
    expect(names({ sort: 'installed', dir: 'desc' })).toEqual(['crm', 'ops', 'exp', 'inv'])
    expect(names({ sort: 'updated', dir: 'desc' })).toEqual(['ops', 'crm', 'exp', 'inv'])
    expect(names({ sort: 'version', dir: 'desc' })).toEqual(['exp', 'inv', 'crm', 'ops'])
    expect(names({ sort: 'status', dir: 'asc' })[0]).toBe('crm')
  })
  it('a new sort takes its own default direction', () => {
    expect(nextLibraryFilters(f(), { sort: 'installed' })).toMatchObject({ sort: 'installed', dir: 'desc' })
  })
})

describe('paging', () => {
  const many = Array.from({ length: 60 }, (_, i) => row({ id: `p${i}`, name: `Package ${String(i).padStart(2, '0')}` }))
  it('cuts pages and clamps past the end', () => {
    expect(queryLibrary(many, f({ page: 3 }))).toMatchObject({ total: 60, page: 3 })
    expect(queryLibrary(many, f({ page: 3 })).rows).toHaveLength(10)
    expect(queryLibrary(many, f({ page: 9 })).page).toBe(3)
  })
  it('a page-size change changes the size and goes back to page 1 in one update', () => {
    const next = nextLibraryFilters(f({ page: 3 }), { pageSize: 50 })
    expect(next).toMatchObject({ pageSize: 50, page: 1 })
    expect(queryLibrary(many, next).rows).toHaveLength(50)
    // Filter changes go back to page 1 too; the page itself does not.
    expect(nextLibraryFilters(f({ page: 3 }), { q: 'x' }).page).toBe(1)
    expect(nextLibraryFilters(f({ page: 1 }), { page: 2 }).page).toBe(2)
  })
})

describe('URL state', () => {
  it('round-trips, leaves defaults out and keeps other params', () => {
    const filters = f({ q: 'crm', status: ['incomplete', 'update'], source: ['gallery'], category: ['finance'], tags: ['ap'], sort: 'installed', dir: 'asc', page: 2, pageSize: 50 })
    const query = serializeLibraryFilters(filters, 'tab=library')
    expect(query).toContain('tab=library')
    expect(parseLibraryFilters(new URLSearchParams(query))).toEqual(filters)
    expect(serializeLibraryFilters(f(), 'tab=library')).toBe('tab=library')
  })
  it('drops unknown values', () => {
    expect(parseLibraryFilters(new URLSearchParams('status=nope,disabled&source=evil&sort=x&size=7&page=-2'))).toMatchObject({ status: ['disabled'], source: [], sort: 'name', pageSize: 25, page: 1 })
  })
  it('clear keeps sort and size', () => {
    const cleared = clearLibraryFilters(f({ q: 'x', tags: ['a'], sort: 'version', pageSize: 100 }))
    expect(hasLibraryFilters(cleared)).toBe(false)
    expect(cleared).toMatchObject({ sort: 'version', pageSize: 100 })
  })
})

describe('wiring', () => {
  const root = path.resolve(__dirname, '..')
  it('the Installed tab uses the library read and Pagination without the extra page reset', () => {
    const lib = readFileSync(path.join(root, 'components/packages/installed-library.tsx'), 'utf8')
    expect(lib).toMatch(/<Pagination[\s\S]*?pageSizeResetsPage=\{false\}[\s\S]*?\/>/)
    const settings = readFileSync(path.join(root, 'components/packages/packages-settings.tsx'), 'utf8')
    expect(settings).toContain('listInstallLibraryAction')
    expect(settings).toContain('<InstalledLibrary')
    // Complete setup stays on the row.
    expect(settings).toContain('data-testid="complete-setup"')
  })
})
