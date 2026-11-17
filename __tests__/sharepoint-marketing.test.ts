/**
 * /sharepoint (the paid SharePoint Server extension) and the Solutions menu:
 * the page is listed everywhere public pages are, both migration pages show
 * up in the desktop AND the mobile menu, every Microsoft claim links to a
 * Microsoft page, the price is stated in USD, and internal links resolve.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteHeader } from '@/components/marketing/site-header'
import { SharePointPage } from '@/components/marketing/sharepoint-page'
import { getDocPage } from '@/lib/docs/registry'
import { GUIDES, SOLUTIONS_BY_USE_CASE } from '@/lib/marketing-nav'
import { SHAREPOINT_PAGE } from '@/lib/marketing-pages'
import { PUBLIC_PAGES } from '@/lib/seo/public-pages'
import { getUseCase } from '@/lib/use-cases'
import { SEO_PAGES } from '@/lib/seo-pages'
import { SHAREPOINT_PAGES } from '@/lib/docs/content/sharepoint'
import { ALTERNATIVES_COMPARISON, SHAREPOINT_KEY_FACTS } from '@/lib/seo/sharepoint-facts'
import { buildLlmsTxt } from '@/lib/seo/llms'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/sharepoint' }))
// The page shows real SharePoint screenshots through next/image; under Vitest the .webp imports are plain URLs.
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: unknown; alt: string }) => createElement('img', { src: String((src as { src?: string })?.src ?? src), alt }) }))

function resolves(href: string): boolean {
  const [pathname] = href.split(/[?#]/)
  if (!pathname) return true
  if (pathname.startsWith('/docs/')) return Boolean(getDocPage(pathname.slice('/docs/'.length)))
  if (pathname.startsWith('/use-cases/')) return Boolean(getUseCase(pathname.slice('/use-cases/'.length)))
  return pathname === '/' || PUBLIC_PAGES.some((page) => page.path === pathname)
}

function jsonLd(html: string): Array<Record<string, any>> {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  if (!match) throw new Error('no JSON-LD')
  const parsed = JSON.parse(match[1])
  return parsed['@graph'] ?? parsed
}

describe('SharePoint solution page', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is a public product page, next to InfoPath in Solutions and in the footer guides', () => {
    expect(PUBLIC_PAGES.find((page) => page.path === '/sharepoint')).toMatchObject({ group: 'product', updated: SHAREPOINT_PAGE.updated })
    const hrefs = SOLUTIONS_BY_USE_CASE.map((item) => item.href)
    expect(hrefs.indexOf('/infopath') - hrefs.indexOf('/sharepoint')).toBe(1)
    expect(GUIDES.some((guide) => guide.href === '/sharepoint')).toBe(true)
  })

  it('shows SharePoint and InfoPath in the desktop Solutions menu and the mobile menu', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { repoUrl: null }))
    const desktop = html.slice(html.indexOf('id="mkt-menu-solutions"'), html.indexOf('id="mkt-menu-resources"'))
    const mobile = html.slice(html.indexOf('id="mkt-mobile-menu"'))
    for (const href of ['/sharepoint', '/infopath']) {
      expect(desktop, `desktop ${href}`).toContain(`href="${href}"`)
      expect(mobile, `mobile ${href}`).toContain(`href="${href}"`)
    }
  })

  it('features InfoPath and SharePoint workflow replacement as boxes right below Product on mobile', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { repoUrl: null }))
    const mobile = html.slice(html.indexOf('id="mkt-mobile-menu"'))
    const featured = mobile.slice(mobile.indexOf('data-mobile-featured-solutions'))
    const boxes = featured.slice(0, featured.indexOf('</ul>'))
    expect(boxes).toContain('href="/sharepoint"')
    expect(boxes).toContain('href="/infopath"')
    // Directly after the Product tiles, before the Solutions list.
    expect(mobile.indexOf('data-mobile-featured-solutions')).toBeLessThan(mobile.indexOf('>Solutions<'))
  })

  it('states the price in USD, cites Microsoft and links only to pages that exist', () => {
    const html = renderToStaticMarkup(SharePointPage())
    expect(html).toContain('$7,500')
    expect(html).toMatch(/per SharePoint farm, per year/)
    expect(html).not.toMatch(/NZD|NZ\$|aggregateRating|testimonial|trusted by/i)
    expect(html).toContain('https://support.microsoft.com/en-us/servicing/office/hotfix/sharepoint/5002945')
    expect(html).toContain('July 13, 2027')
    expect(html).toMatch(/not affiliated with or endorsed by Microsoft/)
    expect(html).toMatch(/real SharePoint Server Subscription Edition screens with demo data/i)
    expect(html).not.toMatch(/contoso\.local|ut-addin|>Illustration</i)
    const external = [...html.slice(html.indexOf('<main'), html.indexOf('</main>')).matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1])
    // Microsoft for every Microsoft fact; Nintex's own documentation for the one Nintex fact in the comparison.
    for (const href of external) expect(href, href).toMatch(/^https:\/\/(support\.microsoft\.com|learn\.microsoft\.com|help\.nintex\.com)\//)
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
    const internal = [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])
    expect(internal).toContain('/contact')
    for (const href of internal) expect(resolves(href), href).toBe(true)
  })

  it('publishes WebPage, BreadcrumbList, the priced extension, HowTo and FAQPage structured data', () => {
    const graph = jsonLd(renderToStaticMarkup(SharePointPage()))
    expect(graph.map((node) => node['@type'])).toEqual(['WebPage', 'BreadcrumbList', 'SoftwareApplication', 'HowTo', 'FAQPage'])
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication')!
    expect(app.offers).toMatchObject({ price: '7500', priceCurrency: 'USD' })
    const faq = graph.find((node) => node['@type'] === 'FAQPage')!
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(6)
    for (const question of faq.mainEntity) expect(question.name).toMatch(/\?$/)
  })

  it('shows the list dashboard (Overview, Runs, Metrics, Permissions), manual start and the web parts with real screenshots', () => {
    const html = renderToStaticMarkup(SharePointPage())
    for (const id of ['summary', 'dashboard', 'dashboard-overview', 'dashboard-runs', 'dashboard-metrics', 'dashboard-permissions', 'start', 'web-parts', 'compare']) expect(html, id).toContain(`id="${id}"`)
    expect(html).toContain('See every workflow and form on the list.')
    for (const shot of ['sharepoint-dashboard-overview', 'sharepoint-dashboard-runs', 'sharepoint-dashboard-metrics', 'sharepoint-dashboard-permissions', 'sharepoint-start-menu', 'sharepoint-start-page', 'sharepoint-my-tasks']) expect(html, shot).toContain(shot)
    expect(html).toContain('Start a UserTasks workflow')
    expect(html).toMatch(/UserTasks – My tasks/)
    // Lab names and test data never reach the public page.
    expect(html).not.toMatch(/contoso|spsites|ut-test|utadmin|UT Dash|Orders/i)
  })

  it('opens with an answer and quotable key facts, and compares the options factually', () => {
    const html = renderToStaticMarkup(SharePointPage())
    expect(html.indexOf('id="summary"')).toBeLessThan(html.indexOf('id="retirement"'))
    for (const fact of SHAREPOINT_KEY_FACTS) expect(html).toContain(fact.label)
    expect(ALTERNATIVES_COMPARISON.columns).toHaveLength(5)
    for (const row of ALTERNATIVES_COMPARISON.rows) expect(row).toHaveLength(5)
    expect(JSON.stringify(ALTERNATIVES_COMPARISON)).not.toMatch(/best|worse|better|outdated|legacy|cheaper|expensive/i)
    expect(html).toMatch(/Last updated/)
  })

  it('describes the Nintex importer as available (free in core), never as coming', () => {
    const nintex = SEO_PAGES.find((page) => page.slug === 'nintex-alternative')!
    const text = JSON.stringify([nintex, SHAREPOINT_KEY_FACTS, getUseCase('nintex-migration'), renderToStaticMarkup(SharePointPage()), buildLlmsTxt('https://usertasks.com')])
    expect(text).toMatch(/free Nintex (workflow )?importer in UserTasks core/i)
    expect(text).toMatch(/\.nwf/)
    expect(text).toMatch(/\.nwp/)
    expect(text).toMatch(/placeholders to rebuild/)
    expect(text).not.toMatch(/nintex.{0,80}(coming|not released|in development|being built|soon|not yet)/i)
    expect(text).not.toMatch(/nintex[^"]{0,200}100 ?%|100 ?%[^"]{0,200}nintex/i)
    expect(nintex.faqs.find((faq) => /import Nintex/.test(faq.question))!.answer).toMatch(/^Yes\./)
  })

  it('documents the extension: dashboard, triggers, manual start, forms, web parts, permissions and migration, without private details', () => {
    expect(SHAREPOINT_PAGES.map((page) => page.slug)).toEqual(['sharepoint', 'sharepoint/list-dashboard', 'sharepoint/triggers', 'sharepoint/manual-start', 'sharepoint/forms', 'sharepoint/web-parts', 'sharepoint/permissions', 'sharepoint/migration', 'sharepoint/trial'])
    for (const page of SHAREPOINT_PAGES) {
      expect(getDocPage(page.slug), page.slug).toBeDefined()
      expect(page.body, page.slug).not.toMatch(/contoso|spsites|ut-addin|src\/|ext_sharepoint__|usertasks-sharepoint|ctx\.|lab-results/i)
    }
    expect(buildLlmsTxt('https://usertasks.com')).toContain('https://usertasks.com/docs/sharepoint/list-dashboard')
  })
})
