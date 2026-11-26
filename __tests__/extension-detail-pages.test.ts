/**
 * /extensions/infrastructure and /extensions/processing: full product pages
 * in early access. Every section is there (who it's for, how it works, setup,
 * what stays free, security, price, FAQ, real screenshots), the call to
 * action asks for early access at /contact with a subject, nothing claims the
 * add-on can be bought or downloaded today, both say they are for self-hosted
 * UserTasks only (owner decision: no cloud runners or data-residency mode),
 * and the structured data is a PreOrder with a HowTo and an FAQ.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionDetailPage, detailAction } from '@/components/marketing/extension-detail-page'
import { subjectFromSearch } from '@/components/marketing/contact-form'
import { EXTENSION_DETAILS, extensionDetail } from '@/lib/seo/extension-details'
import { EXTENSION_DETAIL_IDS, extensionById, type Extension } from '@/lib/seo/extensions'

vi.mock('next/image', () => ({ default: ({ src, alt }: { src: unknown; alt: string }) => createElement('img', { src: String((src as { src?: string })?.src ?? src), alt }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/extensions/infrastructure' }))

function jsonLd(html: string): Array<Record<string, any>> {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { const parsed = JSON.parse(m[1]); return parsed['@graph'] ?? (Array.isArray(parsed) ? parsed : [parsed]) })
}

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')

describe('extension product pages (early access)', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  for (const id of EXTENSION_DETAIL_IDS) {
    it(`${id}: every section, the early-access call to action and self-hosted only`, () => {
      const extension = extensionById(id)
      const detail = extensionDetail(id)
      const html = renderToStaticMarkup(createElement(ExtensionDetailPage, { extension }))
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
      const body = text(main)
      for (const anchor of ['who-title', 'how-it-works', 'setup', 'free-title', 'security-title', 'pricing']) expect(main, anchor).toContain(`id="${anchor}"`)
      expect(body).toContain(extension.price.amount)
      expect(body).toContain('Early access')
      // Call to action: early access, at /contact with the subject the form pre-fills.
      const href = `/contact?subject=${encodeURIComponent(detail.contactSubject)}`
      expect(detailAction(extension, detail.contactSubject)).toEqual({ href, label: 'Request early access' })
      for (const testId of ['status-cta', 'pricing-cta']) {
        const tag = new RegExp(`<a [^>]*data-testid="${testId}"[^>]*>Request early access`).exec(main)?.[0] ?? ''
        expect(tag, testId).toContain(`href="${href}"`)
      }
      // Never sold or downloadable while in early access.
      expect(body).not.toMatch(/\bbuy now\b|\bdownload (it|the add-on) (now|today)\b|available (now|today)/i)
      expect(body).toMatch(/can't be bought or downloaded yet/)
      // Self-hosted only, through the Enterprise edition; setup with the licence.
      expect(body).toContain('For self-hosted UserTasks only')
      expect(body).toContain('not offered for usertasks.com cloud workspaces')
      expect(body).toContain('--edition enterprise --licence')
      expect(body).toContain('usertasks upgrade --edition enterprise')
      expect(body).toContain('Settings → Licence')
      expect(body).toMatch(/verified offline|Licences verified offline/)
      // Real screenshots, present on disk, with alt text.
      for (const shot of detail.screenshots) {
        expect(existsSync(path.join(process.cwd(), 'public/screenshots/extensions', shot.file)), shot.file).toBe(true)
        expect(main).toContain(`alt="${shot.alt.replace(/'/g, '&#x27;')}"`)
      }
      // Structured data: a PreOrder product, the setup HowTo, the FAQ, the breadcrumb.
      const graph = jsonLd(html)
      const product = graph.find((n) => Array.isArray(n['@type']) && n['@type'].includes('Product'))!
      expect(product.offers).toMatchObject({ availability: 'https://schema.org/PreOrder', priceCurrency: 'USD', price: extension.price.value })
      expect(product.offers.description).toMatch(/Early access: not yet available to buy or download/)
      expect(graph.find((n) => n['@type'] === 'HowTo')!.step).toHaveLength(detail.setup.length)
      expect(graph.find((n) => n['@type'] === 'FAQPage')!.mainEntity).toHaveLength(detail.faqs.length)
      expect(graph.map((n) => n['@type'])).toContain('BreadcrumbList')
    })
  }

  it('processing: no cloud runners or data-residency mode, and reliability stays free', () => {
    const html = renderToStaticMarkup(createElement(ExtensionDetailPage, { extension: extensionById('processing') }))
    const body = text(html.slice(html.indexOf('<main'), html.indexOf('</main>')))
    expect(body).not.toMatch(/data residency|data-residency|customer-hosted|on your (own )?side|UserTasks Cloud: host/i)
    expect(JSON.stringify(extensionById('processing'))).not.toMatch(/residency|UserTasks Cloud/i)
    for (const word of ['stuck-job recovery', 'checkpoints', 'Prometheus', 'graceful drain', 'Backpressure', 'test runs on workers']) expect(body.toLowerCase()).toContain(word.toLowerCase())
  })

  it('makes no claims it cannot back: no throughput or speed numbers, no customers, prices in USD', () => {
    const all = JSON.stringify([EXTENSION_DETAILS, extensionById('infrastructure'), extensionById('processing')])
    expect(all).not.toMatch(/\d+\s*(?:x|×)\s*(?:faster|more)|throughput of|\d[\d,]*\s*(?:jobs|runs|requests) (?:per|a) (?:second|minute)|trusted by|\d+\s*customers|NZD|NZ\$/i)
  })

  it('the status flip: available leads to the purchase path, with no early-access copy', () => {
    const flipped: Extension = { ...extensionById('infrastructure'), status: 'available' }
    expect(detailAction(flipped, 'x').label).toBe('Buy or ask a question')
    const body = text(renderToStaticMarkup(createElement(ExtensionDetailPage, { extension: flipped })))
    expect(body).not.toContain('Request early access')
    expect(body).not.toContain("can't be bought")
  })

  it('the contact form takes the subject as one line of plain text', () => {
    expect(subjectFromSearch('?subject=Infrastructure%20add-on%3A%20early%20access')).toBe('Infrastructure add-on: early access')
    expect(subjectFromSearch('?subject=a%0Ab%00c')).toBe('a b c')
    expect(subjectFromSearch(`?subject=${'x'.repeat(300)}`)).toHaveLength(120)
    expect(subjectFromSearch('?other=1')).toBeNull()
    expect(subjectFromSearch('?subject=%20%20')).toBeNull()
  })
})
