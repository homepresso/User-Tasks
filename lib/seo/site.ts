import type { Metadata } from 'next'

/**
 * Shared SEO and GEO building blocks for the public site: page metadata
 * (title, description, canonical, Open Graph, Twitter), the site-wide
 * structured data (Organization, WebSite, SoftwareApplication) and the
 * per-page JSON-LD helpers (WebPage, BreadcrumbList, FAQPage, HowTo).
 *
 * Pure data and functions so pages, the sitemap, llms.txt and the tests share
 * one source. Claims here must be true of the product: no ratings, reviews,
 * customer names or invented numbers.
 */

export const SITE_NAME = 'UserTasks'

/**
 * Date the public site's content was last reviewed. The sitemap's
 * lastModified for pages without their own `updated` date. Bump it when the
 * marketing copy changes; never derive it from the build time (a value that
 * changes on every deploy tells crawlers nothing).
 */
export const SITE_CONTENT_UPDATED = '2026-11-11'
/** Same, for the generated docs under /docs. */
export const DOCS_UPDATED = '2026-11-11'

/** The one-sentence definition used across the site, llms.txt and structured data. */
export const PRODUCT_DEFINITION = 'UserTasks is an open-source (Apache-2.0) workflow, forms and tasks platform: a visual workflow designer, a grid form designer, one task list for approvals, data tables and reports, integrations with any system and an optional AI Agent, driven by a REST API, an MCP server and a CLI. It runs in the UserTasks cloud, on Docker, on Kubernetes or air-gapped on your own servers.'

export function isoDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** Human date for "Last updated" lines: "November 11, 2026". */
export function displayDate(date: string): string {
  return isoDate(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Metadata for one public page. Next merges metadata shallowly, so a page that
 * sets `openGraph` drops the root layout's `siteName`, and one that omits
 * `twitter` inherits the homepage's Twitter title: this sets both, every time.
 * Images come from the segment's opengraph-image / twitter-image files.
 */
export function pageMetadata({ path, title, description, socialTitle, keywords, type = 'website', noindex = false }: {
  /** Canonical path, starting with a slash. */
  path: string
  /** Full <title>, brand included. */
  title: string
  description: string
  /** Open Graph / Twitter title (defaults to the title). */
  socialTitle?: string
  keywords?: string[]
  type?: 'website' | 'article'
  noindex?: boolean
}): Metadata {
  const social = socialTitle ?? title
  return {
    title,
    description,
    ...(keywords?.length ? { keywords } : {}),
    alternates: { canonical: path },
    openGraph: { title: social, description, url: path, type, siteName: SITE_NAME, locale: 'en_US' },
    twitter: { card: 'summary_large_image', title: social, description },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

type Json = Record<string, unknown>

/** Organization, WebSite and SoftwareApplication: one graph, referenced by @id from every page. */
export function siteGraph(baseUrl: string, { description, repoUrl, featureList }: { description: string; repoUrl?: string | null; featureList?: string[] }): Json[] {
  return [
    { '@type': 'WebSite', '@id': `${baseUrl}/#website`, url: baseUrl, name: SITE_NAME, description, inLanguage: 'en', publisher: { '@id': `${baseUrl}/#organization` } },
    {
      '@type': 'Organization',
      '@id': `${baseUrl}/#organization`,
      name: SITE_NAME,
      url: baseUrl,
      logo: { '@type': 'ImageObject', url: `${baseUrl}/brand/mark-512.png`, width: 512, height: 512 },
      contactPoint: { '@type': 'ContactPoint', contactType: 'sales', url: `${baseUrl}/contact`, availableLanguage: ['en'] },
      ...(repoUrl ? { sameAs: [repoUrl] } : {}),
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${baseUrl}/#software`,
      name: SITE_NAME,
      url: baseUrl,
      description,
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Workflow automation',
      operatingSystem: 'Web browser; self-hosted on Linux with Docker or Kubernetes',
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      isAccessibleForFree: true,
      // True today: the cloud edition is free during the beta and self-hosting is free under Apache-2.0.
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', description: 'Open source (Apache-2.0). The cloud edition is free during the beta.' },
      ...(featureList?.length ? { featureList } : {}),
      publisher: { '@id': `${baseUrl}/#organization` },
      ...(repoUrl ? { sameAs: [repoUrl] } : {}),
    },
  ]
}

export function webPageNode(baseUrl: string, path: string, { name, description, updated, type = 'WebPage' }: { name: string; description: string; updated?: string; type?: 'WebPage' | 'CollectionPage' | 'TechArticle' }): Json {
  const url = path === '/' ? baseUrl : `${baseUrl}${path}`
  return {
    '@type': type,
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': `${baseUrl}/#website` },
    about: { '@id': `${baseUrl}/#software` },
    ...(updated ? { dateModified: updated } : {}),
  }
}

/** Breadcrumbs after "UserTasks" (the homepage), the last one being the page itself. */
export function breadcrumbNode(baseUrl: string, crumbs: Array<{ name: string; path: string }>): Json {
  const items = [{ name: SITE_NAME, path: '/' }, ...crumbs]
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, index) => ({ '@type': 'ListItem', position: index + 1, name: crumb.name, item: crumb.path === '/' ? baseUrl : `${baseUrl}${crumb.path}` })),
  }
}

export function faqNode(faqs: Array<{ question: string; answer: string }>): Json {
  return { '@type': 'FAQPage', mainEntity: faqs.map((faq) => ({ '@type': 'Question', name: faq.question, acceptedAnswer: { '@type': 'Answer', text: faq.answer } })) }
}

export function howToNode(name: string, steps: Array<{ title: string; body: string }>, { description, totalTime }: { description?: string; totalTime?: string } = {}): Json {
  return {
    '@type': 'HowTo',
    name,
    ...(description ? { description } : {}),
    ...(totalTime ? { totalTime } : {}),
    step: steps.map((step, index) => ({ '@type': 'HowToStep', position: index + 1, name: step.title, text: step.body })),
  }
}

/** `<script type="application/ld+json">` body: `<` escaped so the payload can't close the tag. */
export function jsonLdHtml(graph: Json[] | Json): string {
  const doc = Array.isArray(graph) ? { '@context': 'https://schema.org', '@graph': graph } : { '@context': 'https://schema.org', ...graph }
  return JSON.stringify(doc).replace(/</g, '\\u003c')
}
