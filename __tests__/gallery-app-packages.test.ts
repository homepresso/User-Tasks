/**
 * App-first gallery packages: gallery.json with trigger "app" and an
 * entry_app instead of (or beside) entry_workflow — metadata and source
 * validation, and the catalogue view of the entry app.
 */
import { describe, expect, it } from 'vitest'
import { validateGallerySource, validateMeta } from '@/lib/gallery/validate'
import { catalogApp } from '@/lib/gallery/catalog'
import { galleryScreenshotUrl, isScreenshotImage } from '@/lib/gallery/types'
import type { GallerySource } from '@/lib/gallery/source'
import type { GalleryMeta } from '@/lib/gallery/types'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixture manifests */

const APP = '0f000000-0000-4000-8000-000000000001'
const FORM = '0f000000-0000-4000-8000-000000000002'
const WORKFLOW = '0f000000-0000-4000-8000-000000000003'

const meta: GalleryMeta = {
  id: '0f000000-0000-4000-8000-0000000000aa',
  slug: 'expenses-desk',
  title: 'Expenses desk',
  category: 'finance',
  summary: 'An app for expense claims: submit a claim, see your claims and the team queue, and look up vendors in one place.',
  description: 'Expenses desk gives a finance team one place to work. '.repeat(6),
  trigger: 'app',
  entry_app: APP,
  start: 'Open Expenses desk from the Apps menu once it is shared with you.',
  difficulty: 'starter',
  setup_minutes: 5,
  tags: ['expenses', 'app'],
  version: '1.0.0',
  changelog: [{ version: '1.0.0', date: '2026-11-21', notes: 'First release.' }],
  needs: [],
  setup: ['Choose who can use the app in its settings (Audience).'],
  steps: [{ title: 'Open', body: 'Open the app.' }, { title: 'Claim', body: 'Submit a claim.' }, { title: 'Review', body: 'Approve claims.' }],
  sample_input: {},
} as unknown as GalleryMeta

const app = {
  id: APP, name: 'Expenses desk', slug: 'expenses', subtitle: 'Claims', description: null, icon: 'Receipt', color: '#7c3aed', menu: [], settings: {},
  pages: [
    { id: '0f000000-0000-4000-8000-000000000010', slug: 'home', title: 'Home', position: 0, filters: [], layout: { widgets: [
      { id: 'f', type: 'form_embed', w: 6, h: 6, config: { form_id: FORM } },
      { id: 'e', type: 'embed', w: 6, h: 6, config: { url: 'https://dash.example.com/a' } },
    ] } },
    { id: '0f000000-0000-4000-8000-000000000011', slug: 'admin', title: 'Admin', position: 1, filters: [], layout: { widgets: [], options: { hidden: true, min_role: 'contributor' } } },
  ],
}
const form = { id: FORM, name: 'Expense claim', fields: [{ key: 'title', label: 'What for?', type: 'text' }] }

function source(overrides: Partial<GalleryMeta> = {}, assets: Record<string, any[]> = { apps: [app], forms: [form] }): GallerySource {
  return { dir: '/tmp/x', slug: 'expenses-desk', meta: { ...meta, ...overrides } as GalleryMeta, readme: '# Expenses desk', files: [], manifest: assets, paths: {}, errors: [] } as unknown as GallerySource
}

describe('app-first gallery metadata', () => {
  it('accepts trigger "app" with an entry_app and no entry_workflow or expect', () => {
    expect(validateMeta(meta, 'expenses-desk')).toEqual([])
  })
  it('requires a valid entry_app', () => {
    expect(validateMeta({ ...meta, entry_app: 'nope' }, 'expenses-desk').map((i) => i.message)).toContain('entry_app must be the id of an app in the package')
  })
  it('still requires entry_workflow for workflow packages', () => {
    const { entry_app: _a, ...rest } = meta
    expect(validateMeta({ ...rest, trigger: 'form' } as GalleryMeta, 'expenses-desk').map((i) => i.message)).toContain('entry_workflow must be the id of a workflow in the package')
  })
})

describe('app-first gallery sources', () => {
  const messages = (s: GallerySource) => validateGallerySource(s).map((i) => i.message)
  it('validates a package whose entry is an app (its dependencies inside the package)', () => {
    const found = messages(source())
    expect(found.filter((m) => /entry|app|points at/.test(m))).toEqual([])
  })
  it('flags a missing entry app, a dependency outside the package, a broken page link and a carried audience', () => {
    expect(messages(source({}, { apps: [], forms: [form] }))).toContain('entry_app is not an app in the package')
    expect(messages(source({}, { apps: [app] })).some((m) => m.includes(`points at form ${FORM}`))).toBe(true)
    const broken = structuredClone(app) as any
    broken.pages[0].layout.widgets.push({ id: 'b', type: 'actions', w: 4, h: 2, config: { buttons: [{ label: 'Go', action: { kind: 'open_page', page_slug: 'missing' } }] } })
    broken.audience = []
    const found = messages(source({}, { apps: [broken], forms: [form] }))
    expect(found.some((m) => m.includes('links to page "missing"'))).toBe(true)
    expect(found).toContain('apps never carry an audience or editors (the installer chooses them)')
  })
  it('checks every page’s widgets and filters as the app service does on install', () => {
    const bad = structuredClone(app) as any
    // A metric whose table is a list and whose conditions are an object (a builder slip): refused before install.
    bad.pages[0].layout.widgets.push({ id: 'm', type: 'metric', w: 3, h: 3, config: { source: 'table_rows', table_id: [{ column: 'x' }], where: { column: 'x' } } })
    bad.pages[1].filters = [{ id: 'Bad Id', kind: 'text', label: 'x' }]
    const found = messages(source({}, { apps: [bad], forms: [form] }))
    expect(found.some((m) => m.startsWith('page "home" › widgets.2.config.table_id'))).toBe(true)
    expect(found.some((m) => m.startsWith('page "home" › widgets.2.config.where'))).toBe(true)
    expect(found.some((m) => m.startsWith('page "admin" › filter 1'))).toBe(true)
    expect(messages(source()).filter((m) => m.startsWith('page "'))).toEqual([])
  })
  it('checks an optional entry workflow against the app trigger', () => {
    const wf = { id: WORKFLOW, name: 'Approve', trigger_type: 'schedule', nodes: [], edges: [] }
    expect(messages(source({ entry_workflow: WORKFLOW }, { apps: [app], forms: [form], workflows: [wf] })).some((m) => /trigger "app" needs an entry workflow/.test(m))).toBe(true)
  })
})

describe('catalogue view of the entry app', () => {
  it('lists pages with their widget types and the embed sites', () => {
    expect(catalogApp(app)).toEqual({
      id: APP, name: 'Expenses desk', slug: 'expenses', subtitle: 'Claims', description: null, icon: 'Receipt', color: '#7c3aed',
      pages: [{ slug: 'home', title: 'Home', hidden: false, widgets: ['form_embed', 'embed'] }, { slug: 'admin', title: 'Admin', hidden: true, widgets: [] }],
      embed_origins: ['https://dash.example.com'],
    })
    expect(catalogApp({ ...app, icon: `svg:${APP}` }).icon).toBeNull()
  })
})

describe('package screenshots', () => {
  const shot = (o: Record<string, unknown> = {}) => ({ file: 'screenshots/home.webp', caption: 'Home page with the main buttons.', ...o })
  const messages = (screenshots: unknown) => validateMeta({ ...meta, screenshots } as GalleryMeta, 'expenses-desk').map((i) => i.message)
  it('accepts up to six WebP / PNG files in screenshots/ with captions', () => {
    expect(messages([shot(), shot({ file: 'screenshots/dark.png', theme: 'dark' })])).toEqual([])
  })
  it('rejects paths outside screenshots/, other formats, short captions, unknown themes, duplicates and too many', () => {
    expect(messages([shot({ file: '../secret.webp' })]).some((m) => m.includes('screenshots/<name>.webp'))).toBe(true)
    expect(messages([shot({ file: 'screenshots/a.gif' })]).some((m) => m.includes('screenshots/<name>.webp'))).toBe(true)
    expect(messages([shot({ caption: 'Home' })]).some((m) => m.includes('caption'))).toBe(true)
    expect(messages([shot({ theme: 'sepia' })]).some((m) => m.includes('theme'))).toBe(true)
    expect(messages([shot(), shot()])).toContain('screenshots must not list a file twice')
    expect(messages(Array.from({ length: 7 }, (_, i) => shot({ file: `screenshots/s${i}.webp` }))).some((m) => m.includes('1-6'))).toBe(true)
  })
  it('publishes under /gallery/screenshots/<slug>/ and checks image bytes', () => {
    expect(galleryScreenshotUrl('expense-desk', 'screenshots/home.webp')).toBe('/gallery/screenshots/expense-desk/home.webp')
    const webp = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')])
    expect(isScreenshotImage(webp, 'screenshots/a.webp')).toBe(true)
    expect(isScreenshotImage(new Uint8Array([0x89, ...Buffer.from('PNG'), 13, 10, 26, 10, 0]), 'screenshots/a.png')).toBe(true)
    expect(isScreenshotImage(new Uint8Array(Buffer.from('<svg onload=alert(1)>')), 'screenshots/a.webp')).toBe(false)
  })
})
