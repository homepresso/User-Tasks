/**
 * Gallery browsing (lib/gallery/browse): catalogue-derived counts, search /
 * filter / sort, the URL query round-trip, and the pages built on it: one h1
 * each, the detail sections rendered from a catalogue entry, and the install
 * links (file, download name, test ids) unchanged.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import catalogJson from '@/lib/gallery/catalog.json'
import {
  browse, browseParams, DEFAULT_BROWSE_STATE, facetCounts, filterItems, galleryCounts, indexEntryToBrowseItem, isFiltered, isNew,
  matchesQuery, newestRelease, parseBrowseParams, sortItems, topTags, type BrowseItem, type BrowseState,
} from '@/lib/gallery/browse'
import { communityBrowseItem, officialBrowseItems } from '@/lib/gallery/browse-items'
import { GALLERY_ACTIONS, GALLERY_CONTROLS, GALLERY_PACKAGES, getGalleryPackage } from '@/lib/gallery/site'
import indexJson from '@/public/gallery/index.json'
import type { GalleryIndex } from '@/lib/gallery/types'
import { GalleryIndexPage } from '@/components/gallery/gallery-index'
import { GalleryPackagePage } from '@/components/gallery/package-page'
import { ControlDetailPage, ControlsIndexPage } from '@/components/gallery/control-pages'
import { ActionDetailPage, ActionsIndexPage } from '@/components/gallery/action-pages'

const catalog = catalogJson as unknown as { packages: Array<{ slug: string; category: string; native: boolean }>; controls: unknown[]; actions: unknown[] }

function item(over: Partial<BrowseItem> & { slug: string }): BrowseItem {
  return {
    key: `${over.kind ?? 'solution'}:${over.source ?? 'official'}:${over.slug}`,
    kind: 'solution', href: `/gallery/${over.slug}`, title: over.slug, summary: '', tags: [], category: 'finance', source: 'official',
    native: false, systems: [], trigger: 'form', version: '1.0.0', firstReleased: '2026-10-01', updated: '2026-10-01', signed: true,
    facet: null, keywords: [], ...over,
  }
}

const SAMPLE: BrowseItem[] = [
  item({ slug: 'expense-claims', title: 'Expense claims', summary: 'Claims routed by policy', tags: ['expenses', 'approvals'], firstReleased: '2026-10-26', updated: '2026-11-04' }),
  item({ slug: 'zeta-survey', title: 'Zeta survey', summary: 'Customer feedback', category: 'surveys-assessments', tags: ['survey'], native: true, trigger: 'schedule', firstReleased: '2026-11-03', updated: '2026-11-03' }),
  item({ slug: 'alpha-sync', title: 'Alpha sync', summary: 'Sync invoices headless', tags: ['invoices', 'approvals'], trigger: 'api', firstReleased: '2026-09-01', updated: '2026-09-02' }),
  item({ slug: 'rating', kind: 'control', category: 'form-controls', title: 'Rating', summary: 'Stars', tags: ['survey'], trigger: null, facet: 'Input', keywords: ['ut-rating'] }),
  item({ slug: 'text-toolkit', kind: 'action', category: 'workflow-actions', title: 'Text toolkit', summary: 'Slugify and more', trigger: null, keywords: ['slugify'] }),
  item({ slug: 'shared-flow', source: 'community', title: 'Shared flow', summary: 'From the community', author: 'Ana', firstReleased: null, updated: null, signed: false }),
]

describe('catalogue-derived counts', () => {
  const items = officialBrowseItems()
  const counts = galleryCounts(items)

  it('counts every solution, control and action in the catalogue', () => {
    expect(counts.kinds.solution).toBe(GALLERY_PACKAGES.length)
    expect(counts.kinds.control).toBe(GALLERY_CONTROLS.length)
    expect(counts.kinds.action).toBe(GALLERY_ACTIONS.length)
    expect(counts.total).toBe(GALLERY_PACKAGES.length + GALLERY_CONTROLS.length + GALLERY_ACTIONS.length)
    expect(counts.official).toBe(counts.total)
    expect(counts.community).toBe(0)
  })

  it('matches the catalogue file itself (categories and native)', () => {
    const published = catalog.packages.filter((p) => GALLERY_PACKAGES.some((g) => g.slug === p.slug))
    expect(counts.native).toBe(published.filter((p) => p.native).length)
    for (const [category, n] of Object.entries(counts.categories)) expect(n, category).toBe(published.filter((p) => p.category === category).length)
    expect(Object.values(counts.categories).reduce((a, b) => a + b, 0)).toBe(GALLERY_PACKAGES.length)
  })

  it('counts community packages separately', () => {
    const community = communityBrowseItem({ slug: 'x', title: 'X', summary: 's', category: 'finance', trigger: 'form', needs: [], tags: [], difficulty: 'starter', setup_minutes: 5, icon: null, steps: 0, version: '1.0.0', source: 'community', author: 'Ana', downloads: 3 })
    const c = galleryCounts([...items, community])
    expect(c.community).toBe(1)
    expect(c.kinds.solution).toBe(GALLERY_PACKAGES.length + 1)
  })

  it('reads "New" from the catalogue dates (deterministic, not the clock)', () => {
    const reference = newestRelease(items)
    expect(reference).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const fresh = items.filter((i) => isNew(i, reference))
    expect(fresh.length).toBeGreaterThan(0)
    for (const i of fresh) expect(i.firstReleased! >= new Date(Date.parse(`${reference}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10)).toBe(true)
    expect(isNew({ firstReleased: '2026-01-01' }, '2026-12-01')).toBe(false)
    expect(isNew({ firstReleased: null }, '2026-12-01')).toBe(false)
  })
})

describe('search, filter and sort', () => {
  it('searches name, description, tags and keywords; every word must match', () => {
    expect(matchesQuery(SAMPLE[0], 'expense')).toBe(true)
    expect(matchesQuery(SAMPLE[0], 'POLICY claims')).toBe(true)
    expect(matchesQuery(SAMPLE[0], 'approvals')).toBe(true)
    expect(matchesQuery(SAMPLE[0], 'approvals survey')).toBe(false)
    expect(matchesQuery(SAMPLE[3], 'ut-rating')).toBe(true)
    expect(matchesQuery(SAMPLE[4], 'slugify')).toBe(true)
    expect(matchesQuery(SAMPLE[5], 'ana')).toBe(true)
  })

  it('filters by type, category, tag, facet, trigger, source and native', () => {
    const run = (patch: Partial<BrowseState>) => filterItems(SAMPLE, { ...DEFAULT_BROWSE_STATE, ...patch }).map((i) => i.slug)
    expect(run({ kind: 'control' })).toEqual(['rating'])
    expect(run({ kind: 'action' })).toEqual(['text-toolkit'])
    expect(run({ category: 'surveys-assessments' })).toEqual(['zeta-survey'])
    expect(run({ tag: 'APPROVALS' })).toEqual(['expense-claims', 'alpha-sync'])
    expect(run({ facet: 'input' })).toEqual(['rating'])
    expect(run({ trigger: 'api' })).toEqual(['alpha-sync'])
    expect(run({ source: 'community' })).toEqual(['shared-flow'])
    expect(run({ native: true })).toEqual(['zeta-survey'])
    expect(run({ q: 'nothing-like-this' })).toEqual([])
  })

  it('counts each facet with the other filters applied', () => {
    const counts = facetCounts(SAMPLE, { ...DEFAULT_BROWSE_STATE, kind: 'solution', tag: 'approvals' }, 'kind')
    expect(counts).toEqual({ all: 2, solution: 2 })
    expect(facetCounts(SAMPLE, DEFAULT_BROWSE_STATE, 'kind')).toEqual({ all: 6, solution: 4, control: 1, action: 1 })
  })

  it('sorts by name, newest, recently updated and featured', () => {
    expect(sortItems(SAMPLE, 'name').map((i) => i.title).slice(0, 3)).toEqual(['Alpha sync', 'Expense claims', 'Rating'])
    expect(sortItems(SAMPLE, 'newest')[0].slug).toBe('zeta-survey')
    expect(sortItems(SAMPLE, 'newest').at(-1)!.slug).toBe('shared-flow')
    expect(sortItems(SAMPLE, 'updated')[0].slug).toBe('expense-claims')
    // Featured: curated picks first (expense-claims, rating), community last.
    const featured = sortItems(SAMPLE, 'featured').map((i) => i.slug)
    expect(featured[0]).toBe('expense-claims')
    expect(featured.indexOf('rating')).toBeLessThan(featured.indexOf('alpha-sync'))
    expect(featured.at(-1)).toBe('shared-flow')
    // While searching, title matches come first.
    expect(browse(SAMPLE, { ...DEFAULT_BROWSE_STATE, q: 'invoices' }).map((i) => i.slug)).toEqual(['alpha-sync'])
    expect(sortItems(SAMPLE, 'featured', 'survey')[0].slug).toBe('zeta-survey')
  })

  it('does not mutate its input', () => {
    const before = SAMPLE.map((i) => i.key)
    sortItems(SAMPLE, 'name')
    expect(SAMPLE.map((i) => i.key)).toEqual(before)
  })

  it('lists the most used tags', () => {
    expect(topTags(SAMPLE, 2)).toEqual([{ tag: 'approvals', count: 2 }, { tag: 'survey', count: 2 }])
  })

  it('maps the in-app index entries onto the same model (controls and actions by page slug)', () => {
    const index = indexJson as unknown as GalleryIndex
    const items = index.packages.map(indexEntryToBrowseItem)
    expect(galleryCounts(items).kinds).toEqual({ solution: GALLERY_PACKAGES.length, control: GALLERY_CONTROLS.length, action: GALLERY_ACTIONS.length })
    const rating = items.find((i) => i.key === 'control:official:form-control-rating')
    expect(rating?.slug).toBe('rating')
    expect(rating?.facet).toBe('Input')
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
  })
})

describe('URL query params', () => {
  const states: Array<Partial<BrowseState>> = [
    {},
    { q: 'invoice approval' },
    { kind: 'control', facet: 'display', sort: 'name' },
    { kind: 'solution', category: 'finance', tag: 'approvals', trigger: 'api', source: 'official', native: true, sort: 'newest' },
    { kind: 'action', sort: 'updated' },
  ]
  it.each(states)('round-trips %o', (patch) => {
    const state = { ...DEFAULT_BROWSE_STATE, ...patch }
    const params = browseParams(state)
    expect(parseBrowseParams(params.toString())).toEqual(state)
  })

  it('leaves defaults out and uses readable keys', () => {
    expect(browseParams(DEFAULT_BROWSE_STATE).toString()).toBe('')
    expect(browseParams({ ...DEFAULT_BROWSE_STATE, kind: 'control', q: ' chart ' }).toString()).toBe('q=chart&type=controls')
    expect(isFiltered(DEFAULT_BROWSE_STATE)).toBe(false)
    expect(isFiltered({ ...DEFAULT_BROWSE_STATE, sort: 'name' })).toBe(false)
    expect(isFiltered({ ...DEFAULT_BROWSE_STATE, tag: 'hr' })).toBe(true)
  })

  it('keeps the older links working and ignores junk', () => {
    expect(parseBrowseParams('category=hr-people&native=1&trigger=form&source=community')).toMatchObject({ category: 'hr-people', native: true, trigger: 'form', source: 'community' })
    expect(parseBrowseParams('category=form-controls').kind).toBe('control')
    expect(parseBrowseParams('category=workflow-actions').kind).toBe('action')
    expect(parseBrowseParams('category=nope&type=nope&trigger=nope&source=x&sort=x&native=yes')).toEqual(DEFAULT_BROWSE_STATE)
  })

  it('round-trips relative to a scoped base (/gallery/controls)', () => {
    const base = { ...DEFAULT_BROWSE_STATE, kind: 'control' as const }
    const state = { ...base, facet: 'input', q: 'map' }
    expect(browseParams(state, base).toString()).toBe('q=map&facet=input')
    expect(parseBrowseParams(browseParams(state, base), base)).toEqual(state)
  })
})

function count(html: string, needle: RegExp): number {
  return (html.match(needle) ?? []).length
}

describe('gallery pages', () => {
  const pkg = getGalleryPackage('expense-claims') ?? GALLERY_PACKAGES[0]

  it('renders the home with one h1, true counts and every item as a link (static list)', () => {
    const html = renderToStaticMarkup(createElement(GalleryIndexPage, { communityCards: [] }))
    expect(count(html, /<h1[\s>]/g)).toBe(1)
    const counts = galleryCounts(officialBrowseItems())
    expect(html).toContain(`Start from ${counts.kinds.solution} official solutions`)
    expect(html).toContain('data-testid="gallery-search"')
    for (const p of GALLERY_PACKAGES) expect(html, p.slug).toContain(`href="/gallery/${p.slug}"`)
    for (const c of GALLERY_CONTROLS) expect(html, c.slug).toContain(`href="/gallery/controls/${c.slug}"`)
    for (const a of GALLERY_ACTIONS) expect(html, a.slug).toContain(`href="/gallery/actions/${a.slug}"`)
    expect(html).toContain('application/ld+json')
  })

  it('renders the package detail sections from its catalogue entry', () => {
    const html = renderToStaticMarkup(createElement(GalleryPackagePage, { pkg }))
    expect(count(html, /<h1[\s>]/g)).toBe(1)
    expect(html).toContain(`>${pkg.title}</h1>`)
    for (const id of ['overview', 'included', 'preview', 'requirements', 'install', 'versions']) expect(html, id).toContain(`id="${id}"`)
    expect(html).toContain('data-testid="section-nav"')
    expect(html).toContain('data-testid="install-card"')
    expect(html).toContain('Install in your workspace')
    expect(html).toContain(`v${pkg.version}`)
    // What's included lists every asset of the manifest, and the changelog every version.
    for (const asset of pkg.assets) expect(html, asset.name).toContain(asset.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'))
    for (const c of pkg.changelog) expect(html).toContain(`v${c.version}`)
    for (const step of pkg.steps) expect(html).toContain(step.title.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'))
    expect(html).toContain('data-testid="related"')
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('"@type":"SoftwareApplication"')
  })

  it('keeps the install links unchanged (same file, download name and test id)', () => {
    const html = renderToStaticMarkup(createElement(GalleryPackagePage, { pkg }))
    expect(count(html, /data-testid="download-package"/g)).toBe(1)
    expect(html).toMatch(new RegExp(`href="${pkg.file.file}" download="${pkg.file.file_name}" data-testid="download-package"`))
    expect(html).toContain('href="#install"')
    expect(html).toContain(`usertasks packages install ${pkg.file.file_name}`)
    const control = GALLERY_CONTROLS[0]
    const controlHtml = renderToStaticMarkup(createElement(ControlDetailPage, { control }))
    expect(controlHtml).toMatch(new RegExp(`href="${control.file.file}" download="${control.file.file_name}" data-testid="download-control"`))
    const action = GALLERY_ACTIONS[0]
    const actionHtml = renderToStaticMarkup(createElement(ActionDetailPage, { action }))
    expect(actionHtml).toMatch(new RegExp(`href="${action.file.file}" download="${action.file.file_name}" data-testid="download-action"`))
  })

  it('shows View source on GitHub only when the repository is public', () => {
    const before = process.env.NEXT_PUBLIC_REPOSITORY_URL
    try {
      delete process.env.NEXT_PUBLIC_REPOSITORY_URL
      expect(renderToStaticMarkup(createElement(GalleryPackagePage, { pkg }))).not.toContain('View source on GitHub')
      process.env.NEXT_PUBLIC_REPOSITORY_URL = 'https://github.com/example/usertasks'
      expect(renderToStaticMarkup(createElement(GalleryPackagePage, { pkg }))).toContain(`https://github.com/example/usertasks/tree/main/gallery/packages/${pkg.slug}`)
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_REPOSITORY_URL
      else process.env.NEXT_PUBLIC_REPOSITORY_URL = before
    }
  })

  it('renders the controls and actions pages with one h1 each', () => {
    for (const html of [
      renderToStaticMarkup(createElement(ControlsIndexPage)),
      renderToStaticMarkup(createElement(ActionsIndexPage)),
      renderToStaticMarkup(createElement(ControlDetailPage, { control: GALLERY_CONTROLS.find((c) => c.preview) ?? GALLERY_CONTROLS[0] })),
      renderToStaticMarkup(createElement(ActionDetailPage, { action: GALLERY_ACTIONS[0] })),
    ]) {
      expect(count(html, /<h1[\s>]/g)).toBe(1)
      expect(html).toContain('application/ld+json')
    }
  })
})
