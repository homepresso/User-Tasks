/**
 * The public docs chrome: the docs home's curated links, header tabs and
 * section metadata, the table of contents, previous / next order, code
 * blocks (highlighting, copy), callouts, the header links per deployment
 * mode, one h1 per page, "Edit this page", reading time, the palette's fuzzy
 * search and the feedback route.
 */
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Static screenshot imports have no dimensions outside the Next bundler.
vi.mock('next/image', async () => {
  const { createElement: h } = await import('react')
  return { default: ({ src, alt }: { src: string | { src: string }; alt: string }) => h('img', { src: typeof src === 'string' ? src : src.src, alt }) }
})

import DocsHome from '@/app/docs/page'
import DocPage from '@/app/docs/[...slug]/page'
import { POST as feedbackPost } from '@/app/api/docs-feedback/route'
import { Callout, CodeBlock } from '@/components/docs/doc-blocks'
import { CopyButton } from '@/components/docs/copy-button'
import { DocsHeader } from '@/components/docs/docs-header'
import { docsNavLinks, docsNavTabs } from '@/lib/docs/chrome'
import { highlight } from '@/lib/docs/highlight'
import { parseMarkdown } from '@/lib/docs/markdown'
import { DOCS_TABS, HOME_FEATURES, POPULAR_PAGES, SECTION_META, START_HERE, sectionsForTab, tabForPath } from '@/lib/docs/nav'
import { breadcrumbs, editPageUrl, formatDocDate, pageSourcePath, readingMinutes } from '@/lib/docs/page-meta'
import { ALL_DOC_PAGES, DOC_SECTIONS, docHref, getDocPage, neighbours } from '@/lib/docs/registry'
import { expandBlocks, pageBlocks, tableOfContents } from '@/lib/docs/render'
import { highlightParts, searchDocs } from '@/lib/docs/search'
import type { SearchEntry } from '@/lib/docs/render'

const REPO = 'https://github.com/usertasks-example/usertasks'

async function renderDoc(slug: string): Promise<string> {
  return renderToStaticMarkup((await DocPage({ params: Promise.resolve({ slug: slug.split('/') }) })) as ReactElement)
}

/** A docs link (path + optional #anchor) that resolves to a page and heading. */
function resolves(href: string): boolean {
  const [pathname, hash] = href.split('#')
  if (pathname === '/docs' || pathname === '/docs/api-explorer') return !hash
  const page = getDocPage(pathname.replace(/^\/docs\//, ''))
  if (!page) return false
  return !hash || pageBlocks(page).some((block) => block.kind === 'heading' && block.id === hash)
}

function countH1(html: string): number {
  return (html.match(/<h1[\s>]/g) ?? []).length
}

/** Every element in a server-component tree (function components are called, client ones are left as leaves). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) { for (const child of node) elements(child, out); return out }
  if (!isValidElement(node)) return out
  out.push(node)
  elements((node.props as { children?: ReactNode }).children, out)
  return out
}

beforeEach(() => {
  vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
  vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('docs home', { timeout: 30_000 }, () => {
  it('has a hero search, Start here, the feature strip, popular pages and every section, with one h1', () => {
    const html = renderToStaticMarkup(DocsHome())
    expect(countH1(html)).toBe(1)
    expect(html).toContain('Start here')
    expect(html).toContain('Popular pages')
    expect(html).toContain('id="browse"')
    // The search trigger works without JavaScript: a link to the full index.
    expect(html).toMatch(/href="\/docs#browse"[^>]*aria-haspopup="dialog"/)
    for (const item of START_HERE) expect(html).toContain(`href="${item.href}"`)
    for (const feature of HOME_FEATURES) for (const link of feature.links) expect(html).toContain(`href="${link.href}"`)
    for (const section of DOC_SECTIONS) {
      expect(html).toContain(section.title.replace(/&/g, '&amp;'))
      expect(html).toContain(SECTION_META[section.title].blurb.replace(/'/g, '&#x27;'))
      for (const page of section.pages) expect(html).toContain(`href="${docHref(page.slug)}"`)
    }
  })

  it('curated links resolve to real pages and anchors', () => {
    const hrefs = [...START_HERE.map((item) => item.href), ...POPULAR_PAGES.map((item) => item.href), ...HOME_FEATURES.flatMap((feature) => feature.links.map((link) => link.href)), ...DOCS_TABS.map((tab) => tab.href)]
    expect(hrefs.filter((href) => !resolves(href))).toEqual([])
    const html = renderToStaticMarkup(DocsHome())
    const broken = [...html.matchAll(/href="(\/docs[^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&')).filter((href) => href !== '/docs#browse' && !resolves(href))
    expect(broken).toEqual([])
  })
})

describe('header tabs and section metadata', () => {
  it('gives every section an icon, a blurb and exactly one tab', () => {
    for (const section of DOC_SECTIONS) {
      const meta = SECTION_META[section.title]
      expect(meta, section.title).toBeDefined()
      expect(meta.blurb.length, section.title).toBeGreaterThan(10)
    }
    const inTabs = DOCS_TABS.flatMap((tab) => sectionsForTab(tab.id).map((section) => section.title))
    expect(inTabs.sort()).toEqual(DOC_SECTIONS.map((section) => section.title).sort())
    for (const tab of DOCS_TABS) expect(sectionsForTab(tab.id).length, tab.id).toBeGreaterThan(0)
  })

  it('maps paths to tabs, and the client nav data carries every page once', () => {
    expect(tabForPath('/docs')).toBe('guides')
    expect(tabForPath('/docs/tasks/forms')).toBe('guides')
    expect(tabForPath('/docs/api/endpoints')).toBe('api')
    expect(tabForPath('/docs/api-explorer')).toBe('api')
    expect(tabForPath('/docs/cli/commands')).toBe('cli')
    expect(tabForPath('/docs/self-hosting/install/')).toBe('operate')
    const hrefs = docsNavTabs().flatMap((tab) => tab.sections.flatMap((section) => section.items.map((item) => item.href)))
    expect(new Set(hrefs).size).toBe(hrefs.length)
    for (const page of ALL_DOC_PAGES) expect(hrefs).toContain(docHref(page.slug))
    expect(hrefs).toContain('/docs/api-explorer')
  })
})

describe('header links per deployment mode', () => {
  it('cloud: website, contact and sign-in; GitHub only when a repository is configured', () => {
    const html = renderToStaticMarkup(createElement(DocsHeader, { links: docsNavLinks() }))
    expect(html).toContain('href="/login"')
    expect(html).toMatch(/href="\/"[^>]*>Website/)
    expect(html).not.toMatch(/github/i)
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', REPO)
    const withRepo = renderToStaticMarkup(createElement(DocsHeader, { links: docsNavLinks() }))
    expect(withRepo).toContain(`href="${REPO}"`)
    expect(withRepo).toContain('aria-label="UserTasks on GitHub"')
  })

  it('self-hosted: no marketing pages (they 404 there), the brand goes to the docs home', () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    const links = docsNavLinks()
    expect(links).toMatchObject({ brandHref: '/docs', website: null, contact: null, signIn: { href: '/login' } })
    const html = renderToStaticMarkup(createElement(DocsHeader, { links }))
    expect(html).not.toMatch(/href="\/"/)
    expect(html).not.toContain('/contact')
    expect(html).not.toContain('>Website')
    expect(html).toContain('href="/login"')
    expect(html).toContain('href="/docs"')
  })
})

describe('table of contents', () => {
  const page = {
    slug: 'fixture',
    title: 'Fixture',
    description: 'A fixture page.',
    body: '## Install `it`\n\nText.\n\n### On **macOS**\n\nText.\n\n#### Deep\n\n## Install it\n\n### [Linked](/docs/cli)\n',
  }

  it('lists h2 and h3 headings with plain text and unique ids', () => {
    const blocks = expandBlocks(parseMarkdown(page.body))
    expect(tableOfContents(page, blocks)).toEqual([
      { id: 'install-it', text: 'Install it', level: 2 },
      { id: 'on-macos', text: 'On macOS', level: 3 },
      { id: 'install-it-2', text: 'Install it', level: 2 },
      { id: 'linked', text: 'Linked', level: 3 },
    ])
  })

  it('honours tocDepth 2', () => {
    const blocks = expandBlocks(parseMarkdown(page.body))
    expect(tableOfContents({ ...page, tocDepth: 2 }, blocks).map((entry) => entry.level)).toEqual([2, 2])
  })
})

describe('previous / next', { timeout: 30_000 }, () => {
  it('follows sidebar order across sections', () => {
    expect(neighbours(ALL_DOC_PAGES[0].slug).prev).toBeUndefined()
    expect(neighbours(ALL_DOC_PAGES[ALL_DOC_PAGES.length - 1].slug).next).toBeUndefined()
    for (let index = 1; index < ALL_DOC_PAGES.length; index++) {
      expect(neighbours(ALL_DOC_PAGES[index].slug).prev?.slug).toBe(ALL_DOC_PAGES[index - 1].slug)
      expect(neighbours(ALL_DOC_PAGES[index - 1].slug).next?.slug).toBe(ALL_DOC_PAGES[index].slug)
    }
    // Sections chain: the last page of one section leads to the first of the next.
    const lastOfFirst = DOC_SECTIONS[0].pages[DOC_SECTIONS[0].pages.length - 1]
    expect(neighbours(lastOfFirst.slug).next?.slug).toBe(DOC_SECTIONS[1].pages[0].slug)
  })

  it('renders as cards on the page', async () => {
    const slug = ALL_DOC_PAGES[3].slug
    const html = await renderDoc(slug)
    const nav = /<nav aria-label="Previous and next"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? ''
    expect(nav).toContain(`href="${docHref(ALL_DOC_PAGES[2].slug)}"`)
    expect(nav).toContain(`href="${docHref(ALL_DOC_PAGES[4].slug)}"`)
  })
})

describe('article page', { timeout: 60_000 }, () => {
  it('has one h1, breadcrumbs, last updated, reading time, TOC, feedback and the JSON-LD', async () => {
    for (const slug of ['self-hosting/install', 'cli', 'workflows/nodes', 'tasks/forms']) {
      const html = await renderDoc(slug)
      expect(countH1(html), slug).toBe(1)
      expect(html, slug).toContain('aria-label="Breadcrumb"')
      expect(html, slug).toMatch(/Last updated <time dateTime="\d{4}-\d{2}-\d{2}">/)
      expect(html, slug).toMatch(/\d+ min read/)
      expect(html, slug).toContain('Was this page helpful?')
      expect(html, slug).toContain('"@type":"TechArticle"')
      expect(html, slug).toContain('"@type":"BreadcrumbList"')
      expect(html, slug).toContain('data-docs-anchor')
    }
  })

  it('every page has exactly one h1', async () => {
    for (const page of ALL_DOC_PAGES) expect(countH1(await renderDoc(page.slug)), page.slug).toBe(1)
  })

  it('offers "Edit this page on GitHub" only with a repository', async () => {
    expect(await renderDoc('cli')).not.toContain('Edit this page')
    vi.stubEnv('NEXT_PUBLIC_REPOSITORY_URL', REPO)
    const html = await renderDoc('cli')
    expect(html).toContain(`href="${REPO}/edit/main/lib/docs/content/developers.ts"`)
    expect(editPageUrl('cli', null)).toBeNull()
    expect(editPageUrl('no-such-page', REPO)).toBeNull()
  })

  it('knows the source file of every page', () => {
    for (const page of ALL_DOC_PAGES) {
      const file = pageSourcePath(page.slug)
      expect(file, page.slug).toBeTruthy()
      expect(existsSync(path.join(process.cwd(), file!)), file!).toBe(true)
      expect(readFileSync(path.join(process.cwd(), file!), 'utf8'), page.slug).toContain(`slug: '${page.slug}'`)
    }
  })

  it('breadcrumbs skip a repeated section page; reading time and dates are sane', () => {
    const first = DOC_SECTIONS[0].pages[0]
    expect(breadcrumbs(first).map((crumb) => crumb.path)).toEqual(['/docs', docHref(first.slug)])
    expect(breadcrumbs(getDocPage('self-hosting/install')!).map((crumb) => crumb.name)).toEqual(['Docs', 'Self-hosting', 'Install step by step'])
    expect(readingMinutes([])).toBe(1)
    expect(readingMinutes([{ kind: 'paragraph', text: 'word '.repeat(1100) }])).toBe(5)
    expect(formatDocDate('2026-11-13')).toBe('November 13, 2026')
  })
})

describe('code blocks', () => {
  it('render a title, a language label, highlighting and a copy button with the exact code', () => {
    const code = 'npm install\nnpm run stack -- up --email "a@example.com"'
    const html = renderToStaticMarkup(createElement(CodeBlock, { code, lang: 'bash', title: 'Terminal' }))
    expect(html).toContain('data-code-lang="bash"')
    expect(html).toContain('>Terminal<')
    expect(html).toContain('>Bash<')
    expect(html).toContain('data-copy-button=""')
    expect(html).toContain('aria-label="Copy to clipboard"')
    expect(html).toContain('class="docs-tok-command"')
    expect(html).toContain('class="docs-tok-flag"')
    expect(html).toContain('class="docs-tok-string"')
    // The copy button gets the code verbatim, not the highlighted markup.
    const copy = elements(CodeBlock({ code, lang: 'bash', title: 'Terminal' })).find((element) => element.type === CopyButton)
    expect((copy?.props as { text: string }).text).toBe(code)
  })

  it('a block without a title shows the language; unknown languages stay plain', () => {
    const html = renderToStaticMarkup(createElement(CodeBlock, { code: '{"a": 1}', lang: 'json' }))
    expect(html).toContain('>JSON<')
    expect(html).toContain('class="docs-tok-key"')
    const plain = renderToStaticMarkup(createElement(CodeBlock, { code: 'a <b> & c', lang: 'text' }))
    expect(plain).toContain('a &lt;b&gt; &amp; c')
    expect(plain).not.toContain('docs-tok-')
  })

  it('highlighting never changes the text of any docs code block', () => {
    for (const page of ALL_DOC_PAGES) {
      for (const block of pageBlocks(page)) {
        if (block.kind !== 'code') continue
        expect(highlight(block.code, block.lang).map((token) => token.text).join(''), `${page.slug} ${block.lang}`).toBe(block.code)
      }
    }
  })
})

describe('callouts', () => {
  it('render each tone with its label and icon; [!CAUTION] is danger', () => {
    for (const [tone, label] of [['note', 'Note'], ['tip', 'Tip'], ['warning', 'Warning'], ['danger', 'Danger']] as const) {
      const html = renderToStaticMarkup(createElement(Callout, { tone, text: 'First **bold**.\n\nSecond.' }))
      expect(html).toContain(`data-callout="${tone}"`)
      expect(html).toContain(`aria-label="${label}"`)
      expect(html).toContain(`>${label}.</strong>`)
      expect(html).toContain('<svg')
      expect(html).toContain('<strong class="font-semibold text-(color:--mkt-ink)">bold</strong>')
      expect((html.match(/<p>/g) ?? []).length).toBe(2)
    }
    expect(parseMarkdown('> [!CAUTION]\n> Deletes data.')).toEqual([{ kind: 'callout', tone: 'danger', text: 'Deletes data.' }])
    expect(parseMarkdown('> [!IMPORTANT]\n> Read this.')).toEqual([{ kind: 'callout', tone: 'warning', text: 'Read this.' }])
  })
})

describe('palette search', () => {
  const index: SearchEntry[] = [
    { t: 'Webhooks', h: '/docs/integrations/webhooks', s: 'Integrations', d: 'Receive webhooks' },
    { t: 'Webhook', h: '/docs/workflows/nodes#webhook', s: 'Node reference' },
    { t: 'API keys', h: '/docs/governance/api-keys', s: 'Governance and security' },
    { t: 'Install step by step', h: '/docs/self-hosting/install', s: 'Self-hosting', d: 'docker kubernetes' },
  ]

  it('ranks exact titles, then prefixes, pages above headings, and tolerates typos', () => {
    expect(searchDocs(index, 'webhook').map((result) => result.entry.h)).toEqual(['/docs/workflows/nodes#webhook', '/docs/integrations/webhooks'])
    expect(searchDocs(index, 'webhooks').map((result) => result.entry.h)).toEqual(['/docs/integrations/webhooks'])
    expect(searchDocs([{ t: 'Webhooks', h: '/docs/a#webhooks', s: 'A' }, { t: 'Webhooks', h: '/docs/b', s: 'B' }], 'webhooks')[0].entry.h).toBe('/docs/b')
    expect(searchDocs(index, 'webhok')[0]?.entry.t).toBe('Webhooks')
    expect(searchDocs(index, 'kubernetes')[0]?.entry.t).toBe('Install step by step')
    expect(searchDocs(index, 'install docker').map((result) => result.entry.t)).toEqual(['Install step by step'])
    expect(searchDocs(index, 'zzz')).toEqual([])
    expect(searchDocs(index, '   ')).toEqual([])
  })

  it('returns highlight ranges for the matched text', () => {
    const [result] = searchDocs(index, 'api')
    expect(highlightParts(result.entry.t, result.ranges)).toEqual([{ text: 'API', match: true }, { text: ' keys', match: false }])
  })
})

describe('/api/docs-feedback', () => {
  const post = (body: unknown, ip = '203.0.113.7') => feedbackPost(new NextRequest('https://usertasks.com/api/docs-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  }))

  it('is cloud only', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect((await post({ path: '/docs/cli', helpful: true })).status).toBe(404)
  })

  it('rejects unknown pages and malformed input', async () => {
    expect((await post({ path: '/docs/no-such-page', helpful: true }, '203.0.113.8')).status).toBe(400)
    expect((await post({ path: '/admin', helpful: true }, '203.0.113.8')).status).toBe(400)
    expect((await post({ path: '/docs/cli', helpful: 'yes' }, '203.0.113.8')).status).toBe(400)
  })

  it('forwards the vote and an escaped comment, and nothing about the reader', async () => {
    vi.stubEnv('CHIRPME_API_KEY', 'server-only-test-key')
    vi.stubEnv('CHIRPME_CHANNEL_ID', 'test-channel-id')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
    const response = await post({ path: '/docs/cli', helpful: false, comment: 'Missing <b>login</b> step' }, '203.0.113.9')
    expect(response.status).toBe(200)
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(payload.title).toBe('Docs feedback: not helpful')
    expect(payload.detail).toContain('Missing &lt;b&gt;login&lt;/b&gt; step')
    expect(JSON.stringify(payload)).not.toContain('203.0.113.9')
  })
})
