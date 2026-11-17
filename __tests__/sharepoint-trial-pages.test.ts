/**
 * The trial pages of the public site: /sharepoint calls to action (trial when
 * available, "Contact us" otherwise), /sharepoint/trial (form or "Trials
 * aren't available yet"), /sharepoint/get-started (four steps, the real
 * commands, HowTo + FAQ JSON-LD, links that exist), sitemap and llms.txt.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharePointPage } from '@/components/marketing/sharepoint-page'
import { SharePointTrialPage } from '@/components/marketing/sharepoint-trial-page'
import { EDITION_BUNDLE_SH, EDITION_INSTALL_PS1, EDITION_INSTALL_PS1_URL, EDITION_INSTALL_SH, EDITION_SWITCH_SH, INSTALL_PS1 as GS_PS1, INSTALL_SH as GS_SH, SharePointGetStartedPage, TRIAL_LICENCE_FILE } from '@/components/marketing/sharepoint-get-started-page'
import { EDITIONS, editionBundleDownloadSh, editionInstallPs1, editionInstallSh, editionSwitchSh } from '@/lib/editions/catalog'
import { INSTALL_PS1, INSTALL_SH } from '@/components/marketing/install-page'
import { getDocPage } from '@/lib/docs/registry'
import { PUBLIC_PAGES } from '@/lib/seo/public-pages'
import { buildLlmsTxt } from '@/lib/seo/llms'
import sitemap from '@/app/sitemap'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/sharepoint' }))
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: unknown; alt: string }) => createElement('img', { src: String((src as { src?: string })?.src ?? src), alt }) }))

function internal(html: string): string[] {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
  return [...main.matchAll(/href="(\/[^"#]*)/g)].map((m) => m[1]).filter(Boolean)
}
function resolves(path: string): boolean {
  if (path.startsWith('/docs/')) return Boolean(getDocPage(path.slice(6)))
  return path === '/' || PUBLIC_PAGES.some((p) => p.path === path)
}
function graph(html: string): Array<Record<string, any>> {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)!
  return JSON.parse(m[1])['@graph']
}

describe('SharePoint trial pages', () => {
  beforeEach(() => { vi.stubEnv('DEPLOYMENT_MODE', 'cloud'); vi.stubEnv('NEXT_PUBLIC_APP_URL', '') })
  afterEach(() => vi.unstubAllEnvs())

  it('/sharepoint offers the trial only when trials are available, and always the 4-step guide', () => {
    const on = renderToStaticMarkup(SharePointPage({ trialsAvailable: true }))
    expect(on).toContain('Start a 30-day free trial')
    expect(on).toContain('href="/sharepoint/trial"')
    expect(on).toContain('href="/sharepoint/get-started"')
    expect(graph(on).find((n) => n['@type'] === 'SoftwareApplication')!.potentialAction).toMatchObject({ '@type': 'TryAction' })
    const off = renderToStaticMarkup(SharePointPage())
    expect(off).not.toContain('href="/sharepoint/trial"')
    expect(off).toContain('Contact us to get started')
    expect(off).toContain('href="/sharepoint/get-started"')
    const faq = graph(off).find((n) => n['@type'] === 'FAQPage')!
    expect(faq.mainEntity.map((q: any) => q.name)).toContain('What happens when the SharePoint trial ends?')
  })

  it('/sharepoint/trial shows the form, or "Trials aren\'t available yet" with Contact us', () => {
    const on = renderToStaticMarkup(createElement(SharePointTrialPage, { available: true }))
    expect(on).toContain('data-testid="sharepoint-trial-form"')
    expect(on).toContain('name="website"')
    expect(on).toContain('$7,500 USD')
    const off = renderToStaticMarkup(createElement(SharePointTrialPage, { available: false }))
    expect(off).not.toContain('sharepoint-trial-form')
    expect(off).toContain('Trials aren&#x27;t available yet')
    for (const href of internal(on)) expect(resolves(href), href).toBe(true)
  })

  it('/sharepoint/get-started: four timed steps, the real commands, HowTo + FAQ, production-ready vs beta', () => {
    const html = renderToStaticMarkup(SharePointGetStartedPage({ trialsAvailable: true }))
    for (const text of ['(Get-SPFarm).Id', 'Get-SPAuthenticationRealm', 'irm https://usertasks.com/install.ps1 | iex', 'curl -fsSL https://usertasks.com/install.sh | sh', 'Install-UserTasksAddin.ps1 -SiteUrls', 'setup code', 'Settings → Licence', 'Settings → Extensions', 'EGRESS_PRIVATE_ALLOW', 'Production-ready', 'Beta']) {
      expect(html, text).toContain(text.replace(/&/g, '&amp;'))
    }
    expect(html).not.toMatch(/\.msi|MSI installer|NZD/)
    expect([GS_PS1, GS_SH]).toEqual([INSTALL_PS1, INSTALL_SH])
    // The SharePoint edition: the same installers with the licence; no "we'll send you the build".
    expect(EDITION_INSTALL_SH).toBe(`${INSTALL_SH} -s -- --edition sharepoint --licence usertasks-sharepoint-trial-3f2504e0.licence`)
    expect(EDITION_INSTALL_PS1).toBe('& ([scriptblock]::Create((irm https://usertasks.com/install.ps1))) -Edition sharepoint -Licence .\\usertasks-sharepoint-trial-3f2504e0.licence')
    // Literal snippet constants on the page, equal to what the catalog builds.
    const sp = EDITIONS.sharepoint
    expect([EDITION_INSTALL_SH, EDITION_INSTALL_PS1, EDITION_INSTALL_PS1_URL, EDITION_SWITCH_SH, EDITION_BUNDLE_SH]).toEqual([
      editionInstallSh(sp, TRIAL_LICENCE_FILE), editionInstallPs1(sp, `.\\${TRIAL_LICENCE_FILE}`), `${editionInstallPs1(sp, `.\\${TRIAL_LICENCE_FILE}`)} -Url https://usertasks.corp.example`,
      editionSwitchSh(sp), editionBundleDownloadSh(sp, TRIAL_LICENCE_FILE),
    ])
    for (const text of [EDITION_INSTALL_SH, 'usertasks upgrade --edition sharepoint', '--bundle-download']) expect(html, text).toContain(text.replace(/&/g, '&amp;'))
    expect(html).not.toMatch(/send you the build/)
    expect(html).toMatch(/not a SharePoint server/)
    const g = graph(html)
    expect(g.map((n) => n['@type'])).toEqual(['WebPage', 'BreadcrumbList', 'HowTo', 'FAQPage'])
    expect(g[2].step).toHaveLength(4)
    for (const href of internal(html)) expect(resolves(href), href).toBe(true)
    const off = renderToStaticMarkup(SharePointGetStartedPage({ trialsAvailable: false }))
    expect(off).toContain('Contact us for a trial')
  })

  it('lists both pages in the sitemap and llms.txt; the started step stays out', () => {
    const urls = sitemap().map((e) => e.url)
    expect(urls).toContain('https://usertasks.com/sharepoint/get-started')
    expect(urls).toContain('https://usertasks.com/sharepoint/trial')
    expect(urls).not.toContain('https://usertasks.com/sharepoint/trial/started')
    const llms = buildLlmsTxt('https://usertasks.com')
    expect(llms).toContain('https://usertasks.com/sharepoint/get-started')
    expect(llms).toContain('https://usertasks.com/sharepoint/trial')
  })
})
