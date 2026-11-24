/**
 * Apps behave like applications: the app's header and navigation are drawn by
 * the app's LAYOUT (kept mounted by Next across the app's pages), the page
 * routes draw nothing, menu entries for pages are prefetching next/link links,
 * and every page is still read — and access-checked — on the server per
 * navigation.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageLinkHref } from '@/components/apps/nav-menu'
import { pageSlugFromParams } from '@/components/apps/app-shell-route'

const src = (p: string) => readFileSync(path.join(__dirname, '..', p), 'utf8')
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the app shell lives in the layout', () => {
  it('the dashboard app layout draws the app view', () => {
    const layout = code('app/(dashboard)/apps/[slug]/layout.tsx')
    expect(layout).toMatch(/<AppShellRoute appSlug=\{slug\} \/>/)
    expect(layout).toMatch(/\{children\}/)
  })
  it('the page routes draw nothing (no per-page header / nav / view)', () => {
    for (const p of ['app/(dashboard)/apps/[slug]/page.tsx', 'app/(dashboard)/apps/[slug]/[page]/page.tsx']) {
      const page = code(p)
      expect(page).not.toMatch(/AppPageView|AppShellRoute|AppPageClient|AppHeader/)
      expect(page).toMatch(/return null/)
    }
  })
  it('the app segment has a loading boundary (the address commits at once) that draws nothing over the shell', () => {
    expect(code('app/(dashboard)/apps/[slug]/loading.tsx')).toMatch(/return null/)
  })
  it('the embed route draws the app from its layout too (members), the page only the notices', () => {
    const layout = code('app/embed/apps/[slug]/layout.tsx')
    expect(layout).toMatch(/<AppShellRoute appSlug=\{slug\} embed \/>/)
    expect(layout).toMatch(/viewer\.kind !== 'member'/)
    const page = code('app/embed/apps/[slug]/[[...page]]/page.tsx')
    expect(page).not.toMatch(/AppPageView|AppShellRoute|AppPageClient/)
    expect(page).toMatch(/EmbedSignedOut/)
  })
  it('the dashboard frame keeps an app mounted across its pages (main is not keyed per pathname)', () => {
    const shell = code('components/layout/dashboard-shell.tsx')
    expect(shell).toMatch(/key=\{shellContentKey\(pathname\)\}/)
    expect(shell).not.toMatch(/key=\{pathname\}/)
  })
  it('the view reads the page from the address', () => {
    expect(pageSlugFromParams({ slug: 'hr', page: 'requests' })).toBe('requests')
    expect(pageSlugFromParams({ slug: 'hr', page: ['requests'] })).toBe('requests')
    expect(pageSlugFromParams({ slug: 'hr' })).toBeNull()
    expect(pageSlugFromParams(null)).toBeNull()
  })
})

describe('menu entries for pages are prefetching links', () => {
  const nav = { base: '/apps', appSlug: 'hr' }
  it('a plain page entry links to its page (with its filters)', () => {
    expect(pageLinkHref({ kind: 'page', label: 'Requests', page_slug: 'requests' } as never, nav)).toBe('/apps/hr/requests')
    expect(pageLinkHref({ kind: 'page', label: 'Open', page_slug: 'requests', filters: { status: 'open' } } as never, nav)).toBe('/apps/hr/requests?f.status=open')
    expect(pageLinkHref({ kind: 'page', label: 'Requests', page_slug: 'requests', open_mode: { mode: 'navigate', width: 'md', motion: 'auto' } } as never, nav)).toBe('/apps/hr/requests')
    expect(pageLinkHref({ kind: 'page', label: 'Requests', page_slug: 'requests' } as never, { base: '/embed/apps', appSlug: 'hr' })).toBe('/embed/apps/hr/requests')
  })
  it('panels, new tabs, computed parameters and other kinds keep the click handler', () => {
    expect(pageLinkHref({ kind: 'page', label: 'R', page_slug: 'r', open_mode: { mode: 'panel_right', width: 'md', motion: 'auto' } } as never, nav)).toBeNull()
    expect(pageLinkHref({ kind: 'page', label: 'R', page_slug: 'r', open_mode: { mode: 'tab', width: 'md', motion: 'auto' } } as never, nav)).toBeNull()
    expect(pageLinkHref({ kind: 'page', label: 'R', page_slug: 'r', params: { id: '{{row.id}}' } } as never, nav)).toBeNull()
    expect(pageLinkHref({ kind: 'report', label: 'R', report_id: 'x' } as never, nav)).toBeNull()
  })
  it('the menu renders them with next/link, prefetch on, scroll handled by the app view', () => {
    const menu = code('components/apps/nav-menu.tsx')
    expect(menu).toMatch(/import Link from "next\/link"/)
    expect(menu).toMatch(/<Link href=\{linkHref\} scroll=\{false\}/)
    expect(menu).not.toMatch(/<Link[^>]*prefetch=\{false\}/)
  })
})

describe('access is still checked per page', () => {
  const view = code('components/apps/app-page-view.tsx')
  it('every page is its own server read (keyed by the page), never served from another page', () => {
    expect(view).toMatch(/queryKey: \["apps", "page", appSlug, pageSlug, mode, asRole\]/)
    expect(view).toMatch(/serverQuery\("apps\.page", \{ app: appSlug, page: pageSlug, mode/)
    // The previous page is only a placeholder while the new read runs (isPlaceholderData), not its data.
    expect(view).toMatch(/placeholderData: \(previous, previousQuery\) => appPageSwitchPlaceholder/)
  })
  it('a page the server refuses keeps the app shell but shows nothing of the page', () => {
    expect(view).toMatch(/const pageUnavailable = !!query\.error && mode === "view" && shownApp\?\.slug === appSlug/)
    expect(view).toMatch(/const content = pageUnavailable \? \(/)
    // The refused read never falls back to the previous page's widgets.
    expect(view).toMatch(/const page = query\.data\?\.page \?\? null/)
  })
  it('the server read checks the page (published / draft, lowest app role)', () => {
    const service = code('lib/services/apps.ts')
    const fn = service.slice(service.indexOf('export async function getAppPageView'))
    expect(fn).toMatch(/loadApp\(ctx, appSlug, mode === 'view' \? 'view' : 'edit'\)/)
    expect(fn).toMatch(/presentPage\(ctx, loaded, await content\.page\(target\)\)/)
  })
})
