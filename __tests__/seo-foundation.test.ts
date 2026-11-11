import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { GET as llmsTxt } from '@/app/llms.txt/route'
import { GET as llmsFullTxt } from '@/app/llms-full.txt/route'
import { SEO_PAGES, seoPageJsonLd, seoPageMetadataInput } from '@/lib/seo-pages'
import { GALLERY_PACKAGES } from '@/lib/gallery/site'
import { ALL_DOC_PAGES, getDocPage } from '@/lib/docs/registry'
import { USE_CASES, getUseCase } from '@/lib/use-cases'
import { PUBLIC_PAGES } from '@/lib/seo/public-pages'
import { AI_CRAWLERS, PRIVATE_PATHS } from '@/lib/seo/robots-config'
import { GUIDES, SOLUTIONS_BY_USE_CASE } from '@/lib/marketing-nav'
import { jsonLdHtml, pageMetadata, PRODUCT_DEFINITION, siteGraph } from '@/lib/seo/site'

const BASE = 'https://usertasks.com'
const NEW_GUIDES = ['sharepoint-workflow-migration', 'infopath-migration-guide', 'open-source-workflow-engine']
const words = (text: string) => text.trim().split(/\s+/).length

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] }
const list = (value?: string | string[]) => (value === undefined ? [] : Array.isArray(value) ? value : [value])

/** Google's robots.txt matching: the longest matching rule wins, allow wins a tie. */
function allowed(rule: Rule, url: string): boolean {
  const match = (paths: string[]) => Math.max(-1, ...paths.filter((p) => url.startsWith(p)).map((p) => p.length))
  const allow = match(list(rule.allow))
  const disallow = match(list(rule.disallow))
  return disallow < 0 || allow >= disallow
}

/** Every internal link must point at a page that exists. */
function resolves(href: string): boolean {
  const [pathname] = href.split(/[?#]/)
  if (pathname.startsWith('/docs/')) return Boolean(getDocPage(pathname.slice('/docs/'.length)))
  if (pathname.startsWith('/use-cases/')) return Boolean(getUseCase(pathname.slice('/use-cases/'.length)))
  return PUBLIC_PAGES.some((page) => page.path === pathname)
}

function types(nodes: Array<Record<string, unknown>>): string[] {
  return nodes.map((node) => String(node['@type']))
}

describe('public SEO foundation', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('publishes unique, substantial pages for the target search intents', () => {
    expect(SEO_PAGES.map((page) => page.slug)).toEqual([
      'workflow-automation',
      'bpm-workflow-automation',
      'on-premises-workflow-automation',
      ...NEW_GUIDES,
    ])
    for (const key of ['title', 'metaTitle', 'description', 'definition'] as const) {
      expect(new Set(SEO_PAGES.map((page) => page[key])).size).toBe(SEO_PAGES.length)
    }
    for (const page of SEO_PAGES) {
      expect(page.sections.length).toBeGreaterThanOrEqual(3)
      expect(page.steps.length).toBeGreaterThanOrEqual(4)
      expect(page.faqs.length).toBeGreaterThanOrEqual(4)
      expect(page.metaTitle).toMatch(/\| UserTasks$/)
      expect(page.description.length).toBeGreaterThan(120)
      expect(page.description.length).toBeLessThanOrEqual(320)
      expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(page.keywords.length).toBeGreaterThanOrEqual(4)
      expect(page.links.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('writes citable copy: a definition first and direct FAQ answers', () => {
    for (const page of SEO_PAGES) {
      // The definition names UserTasks so it can be quoted on its own.
      expect(page.definition).toMatch(/UserTasks is /)
      for (const faq of page.faqs) {
        expect(faq.question).toMatch(/\?$/)
        expect(words(faq.answer), `${page.slug}: ${faq.question}`).toBeGreaterThanOrEqual(35)
        expect(words(faq.answer), `${page.slug}: ${faq.question}`).toBeLessThanOrEqual(75)
      }
    }
  })

  it('cites Microsoft for every retirement date, and states the InfoPath facts as announced', () => {
    for (const page of SEO_PAGES.filter((p) => p.timeline)) {
      for (const source of page.timeline!.sources) expect(source.href).toMatch(/^https:\/\/(support\.microsoft\.com|learn\.microsoft\.com|techcommunity\.microsoft\.com)\//)
    }
    const infopath = SEO_PAGES.find((page) => page.slug === 'infopath-migration-guide')!
    const text = JSON.stringify(infopath)
    expect(text).toContain('July 14, 2026')
    expect(text).toContain('May 18, 2026')
    expect(infopath.timeline!.sources.some((source) => source.href.includes('lifecycle/products/infopath-2013'))).toBe(true)
  })

  it('makes no unverifiable claims', () => {
    const text = JSON.stringify([SEO_PAGES, USE_CASES])
    expect(text).not.toMatch(/aggregateRating|testimonial|trusted by|\d+\s*(?:customers|companies)|\d\s*(?:x|×)\s*faster|NZD|NZ\$/i)
  })

  it('links only to pages that exist', () => {
    for (const page of SEO_PAGES) {
      for (const link of [...page.links, ...(page.related ? [page.related] : [])]) expect(resolves(link.href), `${page.slug} → ${link.href}`).toBe(true)
    }
    for (const link of GUIDES) expect(resolves(link.href), link.href).toBe(true)
    for (const item of SOLUTIONS_BY_USE_CASE) expect(resolves(item.href), item.href).toBe(true)
  })

  it('gives every page a title, description, canonical URL, Open Graph and Twitter card', () => {
    for (const page of SEO_PAGES) {
      const metadata = pageMetadata(seoPageMetadataInput(page))
      expect(metadata.title).toBe(page.metaTitle)
      expect(metadata.description).toBe(page.description)
      expect(metadata.alternates?.canonical).toBe(`/${page.slug}`)
      expect(metadata.openGraph).toMatchObject({ title: page.title, url: `/${page.slug}`, siteName: 'UserTasks' })
      expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: page.title, description: page.description })
    }
    // Every marketing route sets its metadata through the shared helper (or a generator), and has a link-preview card.
    const root = path.join(process.cwd(), 'app/(marketing)')
    for (const dir of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const file = path.join(root, dir.name, 'page.tsx')
      if (!existsSync(file) || dir.name === 'start' || dir.name === 'gallery') continue
      const source = readFileSync(file, 'utf8')
      expect(source, dir.name).toMatch(/pageMetadata\(/)
    }
    for (const slug of NEW_GUIDES) {
      expect(existsSync(path.join(root, slug, 'page.tsx'))).toBe(true)
      expect(existsSync(path.join(root, slug, 'opengraph-image.tsx'))).toBe(true)
      expect(existsSync(path.join(root, slug, 'twitter-image.tsx'))).toBe(true)
    }
  })

  it('describes each guide with valid JSON-LD: WebPage, BreadcrumbList, FAQPage and HowTo where steps are real', () => {
    for (const page of SEO_PAGES) {
      const graph = seoPageJsonLd(page, BASE) as Array<Record<string, any>>
      expect(types(graph)).toEqual(expect.arrayContaining(['WebPage', 'BreadcrumbList', 'FAQPage']))
      const web = graph.find((node) => node['@type'] === 'WebPage')!
      expect(web).toMatchObject({ '@id': `${BASE}/${page.slug}#webpage`, url: `${BASE}/${page.slug}`, dateModified: page.updated, isPartOf: { '@id': `${BASE}/#website` }, about: { '@id': `${BASE}/#software` } })
      const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList')!
      expect(crumbs.itemListElement.map((item: any) => item.position)).toEqual([1, 2])
      expect(crumbs.itemListElement.at(-1).item).toBe(`${BASE}/${page.slug}`)
      const faq = graph.find((node) => node['@type'] === 'FAQPage')!
      expect(faq.mainEntity).toHaveLength(page.faqs.length)
      for (const question of faq.mainEntity) {
        expect(question['@type']).toBe('Question')
        expect(question.name).toBeTruthy()
        expect(question.acceptedAnswer).toMatchObject({ '@type': 'Answer' })
        expect(question.acceptedAnswer.text.length).toBeGreaterThan(100)
      }
    }
    const howTo = (seoPageJsonLd(SEO_PAGES.find((page) => page.slug === 'infopath-migration-guide')!, BASE) as Array<Record<string, any>>).find((node) => node['@type'] === 'HowTo')!
    expect(howTo.name).toMatch(/InfoPath/)
    expect(howTo.step.length).toBeGreaterThanOrEqual(5)
    howTo.step.forEach((step: any, index: number) => expect(step).toMatchObject({ '@type': 'HowToStep', position: index + 1 }))
    // Advisory "implementation paths" are not published as HowTo.
    expect(types(seoPageJsonLd(SEO_PAGES[0], BASE) as Array<Record<string, unknown>>)).not.toContain('HowTo')
  })

  it('publishes Organization, WebSite and SoftwareApplication without invented ratings', () => {
    const graph = siteGraph(BASE, { description: PRODUCT_DEFINITION, repoUrl: null }) as Array<Record<string, any>>
    expect(types(graph)).toEqual(['WebSite', 'Organization', 'SoftwareApplication'])
    const app = graph.find((node) => node['@type'] === 'SoftwareApplication')!
    expect(app).toMatchObject({ '@id': `${BASE}/#software`, applicationCategory: 'BusinessApplication', license: 'https://www.apache.org/licenses/LICENSE-2.0', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' } })
    expect(app.operatingSystem).toBeTruthy()
    expect(graph.find((node) => node['@type'] === 'Organization')).toMatchObject({ '@id': `${BASE}/#organization`, logo: { url: `${BASE}/brand/mark-512.png` } })
    const html = jsonLdHtml(graph)
    expect(JSON.parse(html)['@context']).toBe('https://schema.org')
    expect(html).not.toMatch(/aggregateRating|review/i)
    expect(jsonLdHtml({ '@type': 'Thing', name: '</script><script>' })).not.toContain('</script>')
    // The marketing layout renders it on every marketing page.
    expect(readFileSync(path.join(process.cwd(), 'app/(marketing)/layout.tsx'), 'utf8')).toMatch(/siteGraph\(/)
  })

  it('includes every public page, use case, gallery package and doc in the sitemap with a stable lastModified', () => {
    const entries = sitemap()
    const urls = entries.map((entry) => entry.url)
    expect(new Set(urls).size).toBe(urls.length)
    const set = new Set(urls)
    expect(set.has(BASE)).toBe(true)
    for (const page of PUBLIC_PAGES) expect(set.has(`${BASE}${page.path}`), page.path).toBe(true)
    for (const page of SEO_PAGES) {
      const entry = entries.find((e) => e.url === `${BASE}/${page.slug}`)!
      expect((entry.lastModified as Date).toISOString().slice(0, 10)).toBe(page.updated)
    }
    for (const useCase of USE_CASES) expect(set.has(`${BASE}/use-cases/${useCase.slug}`)).toBe(true)
    for (const doc of ALL_DOC_PAGES) expect(set.has(`${BASE}/docs/${doc.slug}`)).toBe(true)
    for (const pkg of GALLERY_PACKAGES) expect(set.has(`${BASE}/gallery/${pkg.slug}`)).toBe(true)
    for (const url of ['/forms', '/infopath', '/documents', '/media', '/ai-assistants', '/connectors', '/workflows', '/tasks-and-approvals', '/data-and-reports', '/contact', '/docs', '/gallery']) expect(set.has(`${BASE}${url}`), url).toBe(true)
    // Sign-up is a step, not a landing page: kept out of the sitemap.
    expect(set.has(`${BASE}/start`)).toBe(false)
    for (const entry of entries) {
      expect(entry.lastModified, entry.url).toBeInstanceOf(Date)
      expect(Number.isNaN((entry.lastModified as Date).getTime())).toBe(false)
    }
    // Not the build time: two calls give the same dates.
    expect(sitemap().map((e) => String(e.lastModified))).toEqual(entries.map((e) => String(e.lastModified)))
  })

  it('lets search engines and AI crawlers read the public site, and nobody read the app', () => {
    const config = robots()
    expect(config.sitemap).toBe(`${BASE}/sitemap.xml`)
    const rules = (Array.isArray(config.rules) ? config.rules : [config.rules]) as Rule[]
    const agents = rules.flatMap((rule) => list(rule.userAgent))
    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot']) {
      expect(agents, bot).toContain(bot)
      expect(AI_CRAWLERS).toContain(bot)
    }
    expect(agents).toContain('*')
    const publicUrls = [...PUBLIC_PAGES.map((page) => page.path), '/', '/llms.txt', '/llms-full.txt', '/docs/workflows', '/use-cases/nintex-migration', '/gallery/employee-onboarding']
    const privateUrls = ['/api/v1/tasks', '/api/public/infopath/analyze', '/settings', '/tasks', '/tasks/123', '/login', '/data', '/data/tables', '/reports', '/home', '/p/abc', '/f/abc', '/oauth/authorize']
    for (const rule of rules) {
      for (const url of publicUrls) expect(allowed(rule, url), `${list(rule.userAgent)[0]} ${url}`).toBe(true)
      for (const url of privateUrls) expect(allowed(rule, url), `${list(rule.userAgent)[0]} ${url}`).toBe(false)
      for (const p of ['/api/', '/settings', '/tasks', '/login']) expect(list(rule.disallow)).toContain(p)
    }
    expect(PRIVATE_PATHS).toContain('/api/')
  })

  it('keeps everything out of search on self-hosted installs', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' })
    expect(sitemap()).toEqual([])
    expect(llmsTxt().status).toBe(404)
    expect(llmsFullTxt().status).toBe(404)
  })

  it('serves /llms.txt: a Markdown map of the site', async () => {
    const response = llmsTxt()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/)
    const text = await response.text()
    expect(text.startsWith('# UserTasks\n\n> UserTasks is ')).toBe(true)
    expect(text).toContain('## Guides: migration, on-premises and open source')
    for (const page of SEO_PAGES) expect(text).toContain(`](${BASE}/${page.slug}): `)
    for (const useCase of USE_CASES) expect(text).toContain(`${BASE}/use-cases/${useCase.slug}`)
    for (const doc of ALL_DOC_PAGES) expect(text).toContain(`${BASE}/docs/${doc.slug})`)
    expect(text).toContain(`${BASE}/llms-full.txt`)
    expect(text).toContain(`${BASE}/infopath`)
    // Links are well-formed Markdown list items.
    for (const line of text.split('\n').filter((l) => l.startsWith('- ['))) expect(line).toMatch(/^- \[[^\]]+\]\(https:\/\/usertasks\.com[^)]*\)(: .+)?$/)
  })

  it('serves /llms-full.txt: the full text of the guides, use cases and docs', async () => {
    const text = await llmsFullTxt().text()
    for (const page of SEO_PAGES) {
      expect(text).toContain(`# ${page.title}`)
      expect(text).toContain(page.definition)
      for (const faq of page.faqs) expect(text).toContain(faq.answer)
    }
    expect(text).toContain('## Import InfoPath forms')
    expect(text).toContain('XPath conditions and formulas are translated')
    // Docs directives are expanded, not left as raw ::lines; links are absolute.
    expect(text).not.toMatch(/^::/m)
    expect(text).not.toMatch(/\]\(\/docs\//)
    expect(text.length).toBeGreaterThan(200_000)
  })
})
