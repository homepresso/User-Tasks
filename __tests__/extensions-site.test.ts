/**
 * /extensions and its detail pages: the three paid extensions (and no
 * others), prices in USD that agree with the SharePoint facts, one status
 * field that drives the badge, the call to action and the structured-data
 * offer, the pages listed wherever public pages are (sitemap, llms.txt, nav,
 * footer), and SharePoint left where it was.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { SiteHeader } from '@/components/marketing/site-header'
import { MarketingFooter } from '@/components/marketing/marketing-ui'
import { ExtensionDetailPage, ExtensionsPage } from '@/components/marketing/extensions-page'
import { getDocPage } from '@/lib/docs/registry'
import { GUIDES, PRODUCT_MORE, SOLUTIONS_BY_USE_CASE } from '@/lib/marketing-nav'
import { PUBLIC_PAGES } from '@/lib/seo/public-pages'
import { getUseCase } from '@/lib/use-cases'
import { buildLlmsTxt } from '@/lib/seo/llms'
import { SHAREPOINT_PRICE } from '@/lib/seo/sharepoint-facts'
import { EXTENSION_DETAIL_IDS, EXTENSIONS, EXTENSIONS_FAQS, EXTENSIONS_PAGE, extensionById, extensionProductNode, type Extension } from '@/lib/seo/extensions'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/extensions' }))

const BASE = 'https://usertasks.com'

function resolves(href: string): boolean {
  const [pathname] = href.split(/[?#]/)
  if (!pathname) return true
  if (pathname.startsWith('/docs/')) return Boolean(getDocPage(pathname.slice('/docs/'.length)))
  if (pathname.startsWith('/use-cases/')) return Boolean(getUseCase(pathname.slice('/use-cases/'.length)))
  return pathname === '/' || PUBLIC_PAGES.some((page) => page.path === pathname)
}

function jsonLd(html: string): Array<Record<string, any>> {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  if (!scripts.length) throw new Error('no JSON-LD')
  return scripts.flatMap((match) => { const parsed = JSON.parse(match[1]); return parsed['@graph'] ?? (Array.isArray(parsed) ? parsed : [parsed]) })
}

function mainHtml(html: string): string {
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'))
}

describe('Extensions section', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('lists exactly the three extensions, priced in USD, SharePoint agreeing with its facts', () => {
    expect(EXTENSIONS.map((extension) => extension.id)).toEqual(['sharepoint', 'infrastructure', 'processing'])
    for (const extension of EXTENSIONS) {
      expect(extension.price.currency).toBe('USD')
      expect(extension.price.amount).toBe(`$${Number(extension.price.value).toLocaleString('en-US')}`)
    }
    expect(extensionById('sharepoint')).toMatchObject({ href: '/sharepoint', status: 'available', price: { amount: SHAREPOINT_PRICE.amount, value: SHAREPOINT_PRICE.value } })
    expect(extensionById('infrastructure').price.value).toBe('9000')
    expect(extensionById('processing').price.value).toBe('2500')
    expect(extensionById('infrastructure').status).toBe('coming-soon')
    expect(extensionById('processing').status).toBe('coming-soon')
  })

  it('makes no unverifiable claims', () => {
    const text = JSON.stringify([EXTENSIONS, EXTENSIONS_PAGE, EXTENSIONS_FAQS])
    expect(text).not.toMatch(/aggregateRating|testimonial|trusted by|\d+\s*(?:customers|companies)|\d\s*(?:x|×)\s*faster|NZD|NZ\$/i)
  })

  it('offers coming-soon extensions as a pre-order, never in stock, and follows a status flip', () => {
    for (const extension of EXTENSIONS) {
      const node = extensionProductNode(BASE, extension)
      expect(node.offers).toMatchObject({ '@type': 'Offer', priceCurrency: 'USD', price: extension.price.value })
      expect((node.offers as Record<string, unknown>).availability).toBe(extension.status === 'available' ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder')
    }
    const flipped: Extension = { ...extensionById('processing'), status: 'available' }
    expect((extensionProductNode(BASE, flipped).offers as Record<string, unknown>).availability).toBe('https://schema.org/InStock')
    const html = mainHtml(renderToStaticMarkup(createElement(ExtensionDetailPage, { extension: flipped })))
    const own = html.slice(0, html.indexOf('id="others-title"'))
    expect(own).not.toContain('Coming soon')
    expect(own).not.toContain('Ask about early access')
  })

  it('renders the index: every extension with price, status, audience, capabilities, deployment and a call to action', () => {
    const html = renderToStaticMarkup(createElement(ExtensionsPage))
    const main = mainHtml(html)
    expect(main).toContain('Apache-2.0')
    expect(main).toMatch(/offline/)
    for (const extension of EXTENSIONS) {
      const card = main.slice(main.indexOf(`data-extension="${extension.id}"`))
      expect(card).toContain(extension.price.amount)
      expect(card).toContain(`data-extension-status="${extension.status}"`)
      expect(card).toContain(extension.audience.replace(/'/g, '&#x27;'))
      expect(card).toContain(`data-testid="extension-cta-${extension.id}"`)
      expect(card).toContain(`href="${extension.href}"`)
    }
    // SharePoint links to its own page; coming-soon extensions ask for early access.
    const cta = (id: string) => /<a [^>]*>/.exec(main.slice(main.lastIndexOf('<a ', main.indexOf(`data-testid="extension-cta-${id}"`))))![0]
    expect(cta('sharepoint')).toContain('href="/sharepoint"')
    expect(cta('infrastructure')).toContain('href="/contact"')
    expect(cta('processing')).toContain('href="/contact"')
    for (const href of [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])) expect(resolves(href), href).toBe(true)
    const graph = jsonLd(html)
    expect(graph.map((node) => node['@type'])).toEqual(expect.arrayContaining(['CollectionPage', 'BreadcrumbList', 'ItemList', 'FAQPage']))
    expect(graph.find((node) => node['@type'] === 'ItemList')!.itemListElement).toHaveLength(3)
  })

  it('renders each detail page with its price, status and a resolving set of links', () => {
    for (const id of EXTENSION_DETAIL_IDS) {
      const extension = extensionById(id)
      const html = renderToStaticMarkup(createElement(ExtensionDetailPage, { extension }))
      const main = mainHtml(html)
      expect(main).toContain(extension.price.amount)
      expect(main).toContain('Coming soon')
      expect(main).toContain(extension.freeInCore)
      for (const href of [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])) expect(resolves(href), href).toBe(true)
      const product = jsonLd(html).find((node) => Array.isArray(node['@type']) && node['@type'].includes('Product'))!
      expect(product.offers.availability).toBe('https://schema.org/PreOrder')
    }
  })

  it('is a public page with metadata and a link-preview card, in the sitemap and llms.txt', () => {
    const root = path.join(process.cwd(), 'app/(marketing)/extensions')
    for (const dir of ['', ...EXTENSION_DETAIL_IDS]) {
      for (const file of ['page.tsx', 'opengraph-image.tsx', 'twitter-image.tsx']) expect(existsSync(path.join(root, dir, file)), `${dir}/${file}`).toBe(true)
      expect(readFileSync(path.join(root, dir, 'page.tsx'), 'utf8')).toMatch(/pageMetadata\(/)
    }
    const paths = ['/extensions', ...EXTENSION_DETAIL_IDS.map((id) => `/extensions/${id}`)]
    const urls = new Set(sitemap().map((entry) => entry.url))
    for (const p of paths) {
      expect(PUBLIC_PAGES.find((page) => page.path === p), p).toMatchObject({ group: 'product' })
      expect(urls.has(`${BASE}${p}`), p).toBe(true)
    }
    const llms = buildLlmsTxt(BASE)
    expect(llms).toContain('## Paid extensions')
    for (const extension of EXTENSIONS) expect(llms).toContain(`](${BASE}${extension.href}): `)
  })

  it('links Extensions from the Product menu, the mobile menu and the footer, and keeps SharePoint where it was', () => {
    expect(PRODUCT_MORE.some((item) => item.href === '/extensions')).toBe(true)
    const header = renderToStaticMarkup(createElement(SiteHeader, { repoUrl: null }))
    const desktop = header.slice(header.indexOf('id="mkt-menu-product"'), header.indexOf('id="mkt-menu-solutions"'))
    expect(desktop).toContain('href="/extensions"')
    expect(header.slice(header.indexOf('id="mkt-mobile-menu"'))).toContain('href="/extensions"')
    expect(renderToStaticMarkup(createElement(MarketingFooter))).toContain('href="/extensions"')
    // SharePoint keeps its Solutions entry (with its badge), its guide link and the mobile featured card.
    expect(SOLUTIONS_BY_USE_CASE.find((item) => item.href === '/sharepoint')).toMatchObject({ badge: 'New' })
    expect(GUIDES.some((guide) => guide.href === '/sharepoint')).toBe(true)
    expect(header).toMatch(/data-mobile-featured-solutions[\s\S]*href="\/sharepoint"/)
  })
})
