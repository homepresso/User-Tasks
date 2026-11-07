import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sitemap from '@/app/sitemap'
import { getDocPage } from '@/lib/docs/registry'
import { SCREENSHOT_NAMES } from '@/lib/docs/screenshot-names'
import { SEO_PAGES } from '@/lib/seo-pages'
import { readFileSync } from 'node:fs'
import { GALLERY_CATALOG_FILE } from '@/lib/gallery/source'
import { USE_CASE_REDIRECTS, USE_CASES, getUseCase, useCasesInGroup } from '@/lib/use-cases'

describe('use-case pages', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('publishes the planned use cases with unique slugs and metadata', () => {
    expect(USE_CASES.map((useCase) => useCase.slug)).toEqual([
      'headless-task-management',
      'approvals-and-compliance',
      'ai-agent-orchestration',
      'middleware-integration-hub',
      'sharepoint-workflow-replacement',
      'nintex-migration',
      'k2-migration',
      'foia-evidence-redaction',
      'meeting-minutes-from-recordings',
      'insurance-claim-photo-assessment',
      'support-call-qa-redaction',
      'identity-document-kyc',
      'user-generated-media-moderation',
      'customer-satisfaction-nps-survey',
      'employee-pulse-survey',
      'training-quiz-certificates',
      'site-safety-inspections',
      'event-registration-capacity',
      'contract-policy-review-signoff',
      'legal-request-intake',
      'contract-review-approval',
    ])
    for (const key of ['title', 'metaTitle', 'description'] as const) {
      expect(new Set(USE_CASES.map((useCase) => useCase[key])).size).toBe(USE_CASES.length)
    }
  })

  it('gives every page the required sections', () => {
    for (const useCase of USE_CASES) {
      expect(useCase.faqs.length, useCase.slug).toBeGreaterThanOrEqual(3)
      expect(useCase.faqs.length, useCase.slug).toBeLessThanOrEqual(4)
      expect(useCase.features.length, useCase.slug).toBeGreaterThanOrEqual(3)
      expect(useCase.snippet.code.trim(), useCase.slug).not.toBe('')
      expect(SCREENSHOT_NAMES, useCase.slug).toContain(useCase.screenshot.name)
      expect(useCase.diagram.title && useCase.diagram.desc, useCase.slug).toBeTruthy()
      for (const column of [useCase.diagram.left.items, useCase.diagram.right.items, useCase.diagram.center.items]) {
        expect(column.length, useCase.slug).toBeGreaterThan(0)
        expect(column.length, useCase.slug).toBeLessThanOrEqual(5)
      }
      for (const slug of useCase.related) expect(getUseCase(slug), `${useCase.slug} → ${slug}`).toBeDefined()
    }
  })

  it('links only to docs pages that exist', () => {
    for (const useCase of USE_CASES) {
      const hrefs = [...useCase.features.map((feature) => feature.href), ...(useCase.mapping?.rows.map((row) => row.href) ?? [])]
      for (const href of hrefs) {
        if (!href) continue
        expect(href.startsWith('/docs/'), href).toBe(true)
        expect(getDocPage(href.slice('/docs/'.length)), `${useCase.slug}: ${href}`).toBeDefined()
      }
    }
  })

  it('offers a gallery package on every media use case, with careful wording on the records page', () => {
    const media = useCasesInGroup('media')
    expect(media).toHaveLength(6)
    const catalog = JSON.parse(readFileSync(GALLERY_CATALOG_FILE, 'utf8')) as { packages: Array<{ slug: string; category: string }> }
    for (const useCase of media) {
      const pkg = catalog.packages.find((p) => p.slug === useCase.gallery)
      expect(pkg?.category, useCase.slug).toBe('media-evidence')
      expect(useCase.steps?.length, useCase.slug).toBeGreaterThanOrEqual(3)
      expect(useCase.stepsHeading, useCase.slug).toBeDefined()
    }
    expect(useCasesInGroup('platform').map((u) => u.slug)).not.toContain('foia-evidence-redaction')
    const foia = JSON.stringify(getUseCase('foia-evidence-redaction'))
    expect(foia).toMatch(/not legal advice/)
    expect(foia).toMatch(/a person must check every redaction before release/)
    expect(foia).not.toMatch(/fully automated|guarantee|compliant/i)
  })

  it('offers a "No integrations needed" package built on official form controls on every forms use case', () => {
    const forms = useCasesInGroup('forms')
    expect(forms).toHaveLength(6)
    const catalog = JSON.parse(readFileSync(GALLERY_CATALOG_FILE, 'utf8')) as { packages: Array<{ slug: string; native: boolean; controls?: Array<{ slug: string; tag: string }> }> }
    for (const useCase of forms) {
      const pkg = catalog.packages.find((p) => p.slug === useCase.gallery)
      expect(pkg, useCase.slug).toBeDefined()
      expect(pkg?.native, useCase.slug).toBe(true)
      expect(pkg?.controls?.length, useCase.slug).toBeGreaterThanOrEqual(4)
      // The page names the controls it relies on and links to the control docs.
      expect(useCase.features.some((f) => f.href === '/docs/tasks/gallery-form-controls'), useCase.slug).toBe(true)
      expect(useCase.screenshot.name.startsWith('forms-'), useCase.slug).toBe(true)
      expect(useCase.steps?.length, useCase.slug).toBeGreaterThanOrEqual(3)
    }
    // Signatures are described as internal sign-offs, never as a regulated e-signature service.
    const text = JSON.stringify(forms)
    expect(text).not.toMatch(/legally binding|qualified electronic signature service|eIDAS[- ]compliant/i)
    expect(text).toMatch(/internal sign-off|internal attestation/)
  })

  it('cites Microsoft for the SharePoint retirement dates', () => {
    const timeline = getUseCase('sharepoint-workflow-replacement')?.timeline
    expect(timeline?.sources.every((source) => source.href.startsWith('https://support.microsoft.com/'))).toBe(true)
  })

  it('keeps performance comparisons off the use-case pages', () => {
    const text = JSON.stringify(USE_CASES)
    expect(text).not.toMatch(/\d\s*(?:x|×)\s*faster|faster than|→\s*\d/i)
  })

  it('redirects the retired K2 and Nintex SEO pages to the migration guides', () => {
    expect(USE_CASE_REDIRECTS).toEqual({ '/k2-replacement': '/use-cases/k2-migration', '/nintex-replacement': '/use-cases/nintex-migration' })
    for (const destination of Object.values(USE_CASE_REDIRECTS)) expect(getUseCase(destination.replace('/use-cases/', ''))).toBeDefined()
    const seoSlugs = SEO_PAGES.map((page) => `/${page.slug}`)
    for (const source of Object.keys(USE_CASE_REDIRECTS)) expect(seoSlugs).not.toContain(source)
  })

  it('lists the index and every use case in the sitemap', () => {
    const urls = new Set(sitemap().map((entry) => entry.url))
    expect(urls.has('https://usertasks.com/use-cases')).toBe(true)
    for (const useCase of USE_CASES) expect(urls.has(`https://usertasks.com/use-cases/${useCase.slug}`)).toBe(true)
  })
})
