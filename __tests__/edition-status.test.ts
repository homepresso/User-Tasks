/**
 * Edition status, stated the same way everywhere: UserTasks Cloud is in beta
 * (a "Beta" badge or wording wherever cloud is offered); self-hosted
 * UserTasks, the SharePoint extension included, is production-ready. Never a
 * fake schema field: structured data says it in description text only.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteHeader } from '@/components/marketing/site-header'
import { SharePointPage } from '@/components/marketing/sharepoint-page'
import { getDocPage } from '@/lib/docs/registry'
import { buildLlmsFullTxt, buildLlmsTxt } from '@/lib/seo/llms'
import { SHAREPOINT_KEY_FACTS } from '@/lib/seo/sharepoint-facts'
import { EDITION_STATUS, siteGraph } from '@/lib/seo/site'
import { SEO_PAGES } from '@/lib/seo-pages'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: unknown; alt: string }) => createElement('img', { src: String((src as { src?: string })?.src ?? src), alt }) }))

const BASE = 'https://usertasks.com'

describe('edition status: cloud beta, self-hosted production-ready', () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('puts a Beta badge on the header "Start free" (cloud sign-up)', () => {
    const html = renderToStaticMarkup(createElement(SiteHeader, { repoUrl: null }))
    const start = html.slice(html.indexOf('href="/start"'), html.indexOf('</a>', html.indexOf('href="/start"')))
    expect(start).toContain('data-edition="cloud-beta"')
  })

  it('on /sharepoint: the cloud gateway option is Beta, self-hosted is production-ready', () => {
    const html = renderToStaticMarkup(SharePointPage())
    const gateway = html.slice(html.indexOf('id="gateway"'), html.indexOf('id="air-gapped"'))
    expect(gateway).toContain('data-edition="cloud-beta"')
    expect(gateway).toContain('data-edition="self-hosted-ga"')
    expect(gateway).toMatch(/production-ready today/)
    expect(SHAREPOINT_KEY_FACTS.find((fact) => fact.label === 'Deployment')!.value).toMatch(/Production-ready self-hosted.*UserTasks Cloud.*is in beta/)
  })

  it('every guide that compares cloud and self-hosted labels them Beta and Production-ready', () => {
    for (const slug of ['on-premises-workflow-automation', 'open-source-workflow-engine']) {
      const rows = SEO_PAGES.find((page) => page.slug === slug)!.comparison!.rows
      const status = rows.find((row) => row[0] === 'Status')
      expect(status, slug).toBeDefined()
      expect([...status!].sort()).toEqual(['Beta', 'Production-ready', 'Status'])
    }
  })

  it('says it in the docs: self-hosting overview and the cloud quickstart', () => {
    expect(getDocPage('self-hosting')!.body).toMatch(/Self-hosted UserTasks is production-ready/)
    expect(getDocPage('quickstart/cloud')!.body).toMatch(/UserTasks Cloud is in beta/)
  })

  it('tells AI assistants the same, and keeps the status out of schema fields', () => {
    for (const text of [buildLlmsTxt(BASE), buildLlmsFullTxt(BASE)]) {
      expect(text).toContain('UserTasks Cloud is in beta; self-hosted UserTasks is production-ready')
    }
    expect(EDITION_STATUS.short).toBe('UserTasks Cloud is in beta; self-hosted UserTasks is production-ready.')
    const software = siteGraph(BASE, { description: 'x' }).find((node) => node['@type'] === 'SoftwareApplication')!
    expect(JSON.stringify(software)).not.toMatch(/"(releaseStatus|availability|beta)"\s*:/i)
    expect((software.offers as { description: string }).description).toMatch(/production-ready.*in beta/)
  })
})
