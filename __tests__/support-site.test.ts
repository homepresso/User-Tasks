/**
 * /extensions/support (and the /support short link): the four paid support plans (three monthly USD prices, the public
 * sector on request), email support with phone support when needed,
 * consulting from $250 an hour, valid structured data, no invented terms
 * (response times, SLAs, uptime, customers), and the page listed wherever
 * public pages are (sitemap, robots, llms.txt, nav, footer).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { SiteHeader } from '@/components/marketing/site-header'
import { MarketingFooter } from '@/components/marketing/marketing-ui'
import { SupportPage } from '@/components/marketing/support-page'
import { ExtensionsPage } from '@/components/marketing/extensions-page'
import { getDocPage } from '@/lib/docs/registry'
import { PRODUCT_MORE } from '@/lib/marketing-nav'
import { CATALOGUE, priceLabel } from '@/lib/seo/extensions-catalogue'
import nextConfig from '@/next.config'
import { PUBLIC_PAGES } from '@/lib/seo/public-pages'
import { publicAllowList } from '@/lib/seo/robots-config'
import { buildLlmsTxt } from '@/lib/seo/llms'
import { getUseCase } from '@/lib/use-cases'
import { CONSULTING, SUPPORT_FAQS, SUPPORT_INCLUDES, SUPPORT_PAGE, SUPPORT_PLANS, supportServiceNodes } from '@/lib/seo/support'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/extensions/support' }))

const BASE = 'https://usertasks.com'

const INVENTED = /response time|respond within|SLA\b|service level|uptime|99\.\d|24\s*\/\s*7|24x7|business hours|within \d+ (?:hour|minute|day)|\d+\s*(?:hours?|minutes?)\b(?! *USD)|named (?:engineer|contact)|dedicated (?:engineer|account manager)|seats?\b|aggregateRating|testimonial|trusted by|\d+\s*(?:customers|companies)|employees|NZD|NZ\$/i

function resolves(href: string): boolean {
  const [pathname] = href.split(/[?#]/)
  if (!pathname) return true
  if (pathname.startsWith('/docs/')) return Boolean(getDocPage(pathname.slice('/docs/'.length)))
  if (pathname.startsWith('/use-cases/')) return Boolean(getUseCase(pathname.slice('/use-cases/'.length)))
  return pathname === '/' || pathname === '/docs' || PUBLIC_PAGES.some((page) => page.path === pathname)
}

function jsonLd(html: string): Array<Record<string, any>> {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  if (!scripts.length) throw new Error('no JSON-LD')
  return scripts.flatMap((match) => { const parsed = JSON.parse(match[1]); return parsed['@graph'] ?? (Array.isArray(parsed) ? parsed : [parsed]) })
}

function mainHtml(html: string): string {
  return html.slice(html.indexOf('<main'), html.indexOf('</main>'))
}

function text(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, ' ')
}

describe('Support page', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('has the four plans with the given USD monthly prices, and no price for the public sector', () => {
    expect(SUPPORT_PLANS.map((plan) => [plan.name, plan.price?.amount ?? null])).toEqual([
      ['SMB', '$850'],
      ['Mid-market', '$1,500'],
      ['Enterprise', '$2,500'],
      ['Public sector', null],
    ])
    for (const plan of SUPPORT_PLANS.filter((p) => p.price)) {
      expect(plan.price).toMatchObject({ currency: 'USD', unit: 'per month' })
      expect(plan.price!.amount).toBe(`$${Number(plan.price!.value).toLocaleString('en-US')}`)
    }
    expect(SUPPORT_INCLUDES.map((item) => item.title)).toEqual(['Email support', 'Phone support when needed'])
    expect(CONSULTING.rate).toMatchObject({ amount: '$250', value: '250', currency: 'USD', unit: 'per hour' })
  })

  it('renders every plan with its price and a contact call to action; the public sector card shows no price', () => {
    const main = mainHtml(renderToStaticMarkup(createElement(SupportPage)))
    expect(main).toContain('Support from the team that')
    for (const plan of SUPPORT_PLANS) {
      const start = main.indexOf(`data-support-plan="${plan.id}"`)
      expect(start, plan.id).toBeGreaterThan(-1)
      const card = main.slice(start, main.indexOf('</article>', start))
      expect(card).toContain(`data-testid="support-cta-${plan.id}"`)
      expect(card).toContain('href="/contact"')
      expect(card).toContain('Email support')
      expect(card).toContain('Phone support when needed')
      if (plan.price) {
        expect(card).toContain(plan.price.amount)
        expect(card).toContain('USD')
        expect(card).toContain('per month')
      } else {
        expect(card).not.toMatch(/\$\s*\d/)
        expect(card).toContain('Contact us')
      }
    }
    expect(main).toContain('$250')
    expect(main).toContain('id="consulting"')
    expect(main).toContain('href="/docs"')
    expect(main).toContain('href="/open-source"')
    for (const href of [...main.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1])) expect(resolves(href), href).toBe(true)
  })

  it('states only the given facts: no response times, SLAs, uptime, seat limits or customer claims', () => {
    const page = text(mainHtml(renderToStaticMarkup(createElement(SupportPage))))
    expect(page).not.toMatch(INVENTED)
    expect(JSON.stringify([SUPPORT_PLANS, SUPPORT_INCLUDES, CONSULTING, SUPPORT_PAGE, SUPPORT_FAQS])).not.toMatch(INVENTED)
    expect(page).not.toMatch(/(?:€|£|NZ\$|A\$|C\$)/)
    // Every dollar amount on the page is one of the given prices.
    for (const [amount] of page.matchAll(/\$[\d,]+/g)) expect(['$850', '$1,500', '$2,500', '$250'], amount).toContain(amount)
  })

  it('answers the FAQ from the facts, and the FAQ is in the structured data', () => {
    const faq = (q: RegExp) => SUPPORT_FAQS.find((item) => q.test(item.question))!
    expect(faq(/phone support/i).answer).toMatch(/^Yes, when needed, alongside email/)
    expect(faq(/public sector/i).answer).toMatch(/Contact us/)
    expect(faq(/cost/i).answer).toMatch(/\$850[\s\S]*\$1,500[\s\S]*\$2,500/)
    expect(faq(/need a support plan/i).answer).toMatch(/Apache-2\.0/)
  })

  it('publishes valid JSON-LD: WebPage, BreadcrumbList, FAQPage and Services with USD offers (none priced for the public sector)', () => {
    const html = renderToStaticMarkup(createElement(SupportPage))
    const graph = jsonLd(html)
    expect(graph.map((node) => node['@type'])).toEqual(expect.arrayContaining(['WebPage', 'BreadcrumbList', 'FAQPage', 'Service']))
    expect(graph.find((node) => node['@type'] === 'FAQPage')!.mainEntity).toHaveLength(SUPPORT_FAQS.length)
    const support = graph.find((node) => node['@id'] === `${BASE}/extensions/support#support`)!
    expect(support).toMatchObject({ '@type': 'Service', provider: { '@id': `${BASE}/#organization` } })
    expect(support.offers).toHaveLength(4)
    const offer = (name: string) => support.offers.find((o: Record<string, any>) => o.name === `${name} support plan`)
    expect(offer('SMB')).toMatchObject({ '@type': 'Offer', price: '850', priceCurrency: 'USD', priceSpecification: { billingDuration: 'P1M', priceCurrency: 'USD', price: '850' } })
    expect(offer('Mid-market')).toMatchObject({ price: '1500', priceCurrency: 'USD' })
    expect(offer('Enterprise')).toMatchObject({ price: '2500', priceCurrency: 'USD' })
    const publicSector = offer('Public sector')
    expect(publicSector['@type']).toBe('Offer')
    expect(publicSector).not.toHaveProperty('price')
    expect(publicSector).not.toHaveProperty('priceSpecification')
    const consulting = graph.find((node) => node['@id'] === `${BASE}/extensions/support#consulting`)!
    expect(consulting.offers).toMatchObject({ priceCurrency: 'USD', priceSpecification: { minPrice: '250', priceCurrency: 'USD', unitCode: 'HUR' } })
    expect(JSON.stringify(supportServiceNodes(BASE))).not.toMatch(/aggregateRating|review/i)
  })

  it('is a public page with metadata and a link-preview card, in the sitemap, robots allow-list and llms.txt', () => {
    const root = path.join(process.cwd(), 'app/(marketing)/extensions/support')
    for (const file of ['page.tsx', 'opengraph-image.tsx', 'twitter-image.tsx']) expect(existsSync(path.join(root, file)), file).toBe(true)
    expect(readFileSync(path.join(root, 'page.tsx'), 'utf8')).toMatch(/pageMetadata\(/)
    expect(SUPPORT_PAGE.path).toBe('/extensions/support')
    expect(PUBLIC_PAGES.find((page) => page.path === '/extensions/support')).toMatchObject({ title: SUPPORT_PAGE.title, description: SUPPORT_PAGE.description, group: 'product' })
    expect(sitemap().some((entry) => entry.url === `${BASE}/extensions/support`)).toBe(true)
    expect(publicAllowList()).toContain('/extensions/support')
    const llms = buildLlmsTxt(BASE)
    expect(llms).toContain('## Support and consulting')
    expect(llms).toContain(`](${BASE}/extensions/support): `)
    expect(llms).toContain('SMB $850 USD per month')
    expect(llms).toContain('Public sector on request')
    expect(llms).toContain('$250 USD per hour')
  })

  it('keeps /support working as a permanent redirect to /extensions/support', async () => {
    const redirects = await nextConfig.redirects!()
    expect(redirects).toContainEqual({ source: '/support', destination: '/extensions/support', permanent: true })
  })

  it('is a card in the extensions gallery (Support and Consulting under Services), linked from the footer and the install page', () => {
    const support = CATALOGUE.find((item) => item.id === 'support')!
    const consulting = CATALOGUE.find((item) => item.id === 'consulting')!
    expect(support).toMatchObject({ category: 'services', href: '/extensions/support', status: 'available' })
    expect(consulting).toMatchObject({ category: 'services', href: '/extensions/support#consulting' })
    expect(priceLabel(support)).toBe('from $850/month')
    expect(priceLabel(consulting)).toBe('from $250/hour')
    const gallery = mainHtml(renderToStaticMarkup(createElement(ExtensionsPage)))
    expect(gallery).toContain('href="/extensions/support"')
    expect(gallery).toContain('href="/extensions/support#consulting"')
    // Extensions stays the menu entry; Support has its own footer link.
    expect(PRODUCT_MORE.some((item) => item.href === '/extensions')).toBe(true)
    expect(renderToStaticMarkup(createElement(MarketingFooter))).toContain('href="/extensions/support"')
    expect(renderToStaticMarkup(createElement(SiteHeader, { repoUrl: null }))).toContain('href="/extensions"')
    expect(readFileSync(path.join(process.cwd(), 'components/marketing/install-page.tsx'), 'utf8')).toMatch(/data-windows-msi[^\n]*href="\/extensions\/support"/)
  })
})
