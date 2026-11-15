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

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/sharepoint' }))

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
    const external = [...html.slice(html.indexOf('<main'), html.indexOf('</main>')).matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1])
    for (const href of external) expect(href, href).toMatch(/^https:\/\/(support\.microsoft\.com|learn\.microsoft\.com)\//)
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
})
