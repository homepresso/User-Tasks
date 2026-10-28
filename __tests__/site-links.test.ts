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
import { ALL_DOC_PAGES } from '@/lib/docs/registry'
import { repositoryUrl, SOURCE_RELEASE_NOTE } from '@/lib/site-links'

const PRIVATE_REPO = /github\.com\/homepresso\/UserTasks(?![-\w])/i
const PUBLIC_REPO = 'https://github.com/usertasks-example/usertasks'
const DOC_SAMPLE = ['cli', 'sdk', 'quickstart/self-host', 'self-hosting/environment', 'changelog']

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

// Renders the landing page and whole docs pages (the changelog parses every
// release note): seconds of CPU, so a loaded machine needs more than 5 s.
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
