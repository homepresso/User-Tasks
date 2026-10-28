import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { SEO_PAGES } from '@/lib/seo-pages'
import { GALLERY_PACKAGES } from '@/lib/gallery/site'

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
    ])
    expect(new Set(SEO_PAGES.map((page) => page.title)).size).toBe(SEO_PAGES.length)
    expect(new Set(SEO_PAGES.map((page) => page.description)).size).toBe(SEO_PAGES.length)
    for (const page of SEO_PAGES) {
      expect(page.sections.length).toBeGreaterThanOrEqual(3)
      expect(page.steps.length).toBeGreaterThanOrEqual(4)
      expect(page.faqs.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('includes every public guide in the canonical sitemap', () => {
    const urls = new Set(sitemap().map((entry) => entry.url))
    expect(urls.has('https://usertasks.com')).toBe(true)
    for (const page of SEO_PAGES) {
      expect(urls.has(`https://usertasks.com/${page.slug}`)).toBe(true)
    }
    expect(urls.has('https://usertasks.com/docs')).toBe(true)
    expect(urls.has('https://usertasks.com/contact')).toBe(true)
    expect(urls.has('https://usertasks.com/docs/workflows')).toBe(true)
    expect(urls.has('https://usertasks.com/gallery')).toBe(true)
    expect(GALLERY_PACKAGES.length).toBeGreaterThan(0)
    for (const pkg of GALLERY_PACKAGES) expect(urls.has(`https://usertasks.com/gallery/${pkg.slug}`)).toBe(true)
  })

  it('advertises the sitemap while excluding authenticated and runtime URLs', () => {
    const config = robots()
    expect(config.sitemap).toBe('https://usertasks.com/sitemap.xml')
    const rules = Array.isArray(config.rules) ? config.rules : [config.rules]
    const disallowed = rules.flatMap((rule) => rule.disallow ?? [])
    expect(disallowed).toContain('/api/')
    expect(disallowed).toContain('/settings')
    expect(disallowed).toContain('/tasks')
    expect(disallowed).toContain('/login')
    expect(rules.flatMap((rule) => rule.allow ?? [])).toContain('/gallery')
  })
})
