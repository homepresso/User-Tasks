import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The home page reads the session first; render it as a signed-out visitor.
vi.mock('@/lib/supabase/server', () => ({
  getSessionUserFast: async () => null,
}))

// Static screenshot imports have no dimensions outside the Next bundler.
vi.mock('next/image', async () => {
  const { createElement } = await import('react')
  return { default: ({ src, alt }: { src: string | { src: string }; alt: string }) => createElement('img', { src: typeof src === 'string' ? src : src.src, alt }) }
})

import Home from '@/app/page'
import DocsHome from '@/app/docs/page'
import DocPage from '@/app/docs/[...slug]/page'
import OpenSourcePage from '@/app/(marketing)/open-source/page'
import FormsMarketingPage from '@/app/(marketing)/forms/page'
import InfoPathMarketingPage from '@/app/(marketing)/infopath/page'
import TasksMarketingPage from '@/app/(marketing)/tasks-and-approvals/page'
import DataReportsMarketingPage from '@/app/(marketing)/data-and-reports/page'
import { ALL_DOC_PAGES, getDocPage } from '@/lib/docs/registry'
import { pageBlocks } from '@/lib/docs/render'
import { repositoryUrl, SOURCE_RELEASE_NOTE } from '@/lib/site-links'

const PRIVATE_REPO = /github\.com\/homepresso\/UserTasks(?![-\w])/i
const PUBLIC_REPO = 'https://github.com/usertasks-example/usertasks'
const DOC_SAMPLE = ['cli', 'sdk', 'quickstart/self-host', 'self-hosting/environment', 'performance']

async function renderHome(): Promise<string> {
  return renderToStaticMarkup((await Home()) as ReactElement)
}

async function renderDoc(slug: string): Promise<string> {
  return renderToStaticMarkup((await DocPage({ params: Promise.resolve({ slug: slug.split('/') }) })) as ReactElement)
}

function jsonLd(html: string): { '@graph': Array<Record<string, unknown>> } {
  const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
  if (!match) throw new Error('no JSON-LD on the home page')
  return JSON.parse(match[1])
}

// Renders the landing page and whole docs pages: seconds of CPU, so a loaded machine needs more than 5 s.
describe('repository link', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is null unless NEXT_PUBLIC_REPOSITORY_URL is a valid http(s) URL', () => {
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', '')
    expect(repositoryUrl()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', '   ')
    expect(repositoryUrl()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', 'javascript:alert(1)')
    expect(repositoryUrl()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', 'not a url')
    expect(repositoryUrl()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', `${PUBLIC_REPO}/`)
    expect(repositoryUrl()).toBe(PUBLIC_REPO)
  })

  it('is omitted from the landing page, structured data and docs while unset', async () => {
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', '')
    const home = await renderHome()
    expect(home).not.toMatch(/github\.com/i)
    expect(home).not.toMatch(/>GitHub</)
    expect(home).toContain(SOURCE_RELEASE_NOTE)
    const graph = jsonLd(home)['@graph']
    expect(graph.some((node) => 'sameAs' in node || 'codeRepository' in node)).toBe(false)
    expect(graph.some((node) => node['@type'] === 'SoftwareSourceCode')).toBe(false)

    expect(renderToStaticMarkup(DocsHome())).not.toMatch(PRIVATE_REPO)
    expect(renderToStaticMarkup(OpenSourcePage())).not.toMatch(/github\.com/i)
    for (const page of ALL_DOC_PAGES) expect(await renderDoc(page.slug), page.slug).not.toMatch(PRIVATE_REPO)
    for (const slug of DOC_SAMPLE) expect(await renderDoc(slug), slug).not.toContain(PUBLIC_REPO)
  })

  it('renders the configured repository on the landing page and in structured data', async () => {
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', PUBLIC_REPO)
    const home = await renderHome()
    expect(home).toContain(`href="${PUBLIC_REPO}"`)
    expect(home).not.toContain(SOURCE_RELEASE_NOTE)
    expect(home).not.toMatch(PRIVATE_REPO)
    const graph = jsonLd(home)['@graph']
    expect(graph.find((node) => node['@type'] === 'Organization')?.sameAs).toEqual([PUBLIC_REPO])
    expect(graph.find((node) => node['@type'] === 'SoftwareSourceCode')?.codeRepository).toBe(PUBLIC_REPO)
  })

  it('is not hardcoded in rendered source, package metadata or published docs', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(tsx?|mjs|json|md)$/.test(name)) files.push(full)
      }
    }
    for (const dir of ['app', 'components', 'lib', 'docs', 'packages']) walk(path.join(process.cwd(), dir))
    for (const file of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example']) files.push(path.join(process.cwd(), file))
    const offenders = files.filter((file) => PRIVATE_REPO.test(readFileSync(file, 'utf8')))
    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([])
  })
})

// The landing page, the /forms, /tasks-and-approvals and /data-and-reports pages and the docs home deep-link into docs
// pages and their headings; a renamed heading or a retired page (such as the
// old /docs/changelog) must not leave a dangling link behind.
describe('public pages link only to docs pages and anchors that exist', { timeout: 30_000 }, () => {
  beforeEach(() => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('on the landing page, /forms, /tasks-and-approvals, /data-and-reports and the docs home', async () => {
    const pages = { home: await renderHome(), forms: renderToStaticMarkup(FormsMarketingPage()), infopath: renderToStaticMarkup(InfoPathMarketingPage()), tasks: renderToStaticMarkup(TasksMarketingPage()), data: renderToStaticMarkup(DataReportsMarketingPage()), docs: renderToStaticMarkup(DocsHome()) }
    const problems: string[] = []
    let checked = 0
    for (const [name, html] of Object.entries(pages)) {
      expect(html, name).not.toContain('/docs/changelog')
      for (const [, href] of html.matchAll(/href="(\/docs\/[^"]*)"/g)) {
        if (href.startsWith('/docs/api-explorer')) continue
        checked++
        const [pathname, hash] = href.split('#')
        const page = getDocPage(pathname.replace(/^\/docs\//, ''))
        if (!page) { problems.push(`${name}: ${href} (no page)`); continue }
        if (hash && !pageBlocks(page).some((block) => block.kind === 'heading' && (block as { id: string }).id === hash)) problems.push(`${name}: ${href} (no anchor)`)
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(problems).toEqual([])
  })

  it('no longer show the refocus banner on the landing page', async () => {
    const home = await renderHome()
    expect(home).not.toMatch(/What changed and why/)
    expect(home).toContain('id="forms-and-tasks"')
  })
})

describe('/infopath', () => {
  beforeEach(() => { vi.stubEnv('DEPLOYMENT_MODE', 'cloud') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('has the hero, the upload box, the explainer sections, FAQ JSON-LD and is in the nav and footer', async () => {
    const html = renderToStaticMarkup(InfoPathMarketingPage())
    expect(html).toContain('Bring your InfoPath forms')
    expect(html).toContain('data-testid="infopath-preview-box"')
    for (const id of ['id="how"', 'id="maps"', 'id="faq"']) expect(html).toContain(id)
    expect(html).toContain('Is my file stored?')
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1])
    expect(ld['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['WebPage', 'BreadcrumbList', 'HowTo', 'FAQPage'])
    // Solutions menu and footer (both read lib/marketing-nav).
    expect(html).toContain('href="/infopath"')
    const { SOLUTIONS_BY_USE_CASE } = await import('@/lib/marketing-nav')
    expect(SOLUTIONS_BY_USE_CASE.some((i) => i.href === '/infopath')).toBe(true)
  })
})
