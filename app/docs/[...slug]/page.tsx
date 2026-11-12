import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, CalendarDays, ChevronRight, Clock, ListTree, Pencil } from 'lucide-react'
import { DocBlocks } from '@/components/docs/doc-blocks'
import { AnchorCopy, DocsToc, FeedbackWidget } from '@/components/docs/article-client'
import { DocsIcon } from '@/components/docs/icons'
import { ALL_DOC_PAGES, docHref, getDocPage, neighbours, sectionOf } from '@/lib/docs/registry'
import { pageBlocks, tableOfContents } from '@/lib/docs/render'
import { breadcrumbs, editPageUrl, formatDocDate, readingMinutes } from '@/lib/docs/page-meta'
import { sectionMeta } from '@/lib/docs/nav'
import { isCloud, publicBaseUrl } from '@/lib/deployment'
import { repositoryUrl } from '@/lib/site-links'
import { breadcrumbNode, DOCS_UPDATED, jsonLdHtml, webPageNode } from '@/lib/seo/site'

type Props = { params: Promise<{ slug: string[] }> }

export const dynamicParams = false

export function generateStaticParams() {
  return ALL_DOC_PAGES.map((page) => ({ slug: page.slug.split('/') }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = getDocPage((await params).slug.join('/'))
  if (!page) return { title: 'Documentation — UserTasks' }
  const title = `${page.title} — UserTasks docs`
  // Card rendered by app/og/docs/[...slug]/route.tsx.
  const image = { url: `/og/docs/${page.slug}`, width: 1200, height: 630, alt: title, type: 'image/png' }
  return {
    title,
    description: page.description,
    alternates: { canonical: docHref(page.slug) },
    openGraph: { title, description: page.description, url: docHref(page.slug), type: 'article', siteName: 'UserTasks', images: [image] },
    twitter: { card: 'summary_large_image', title, description: page.description, images: [image] },
  }
}

export default async function DocPage({ params }: Props) {
  const page = getDocPage((await params).slug.join('/'))
  if (!page) notFound()
  const blocks = pageBlocks(page)
  const toc = tableOfContents(page, blocks)
  const section = sectionOf(page.slug)
  const { prev, next } = neighbours(page.slug)
  const baseUrl = publicBaseUrl()
  const crumbs = breadcrumbs(page)
  const minutes = readingMinutes(blocks)
  const editUrl = editPageUrl(page.slug, repositoryUrl())
  const cloud = isCloud()
  const jsonLd = [
    { ...webPageNode(baseUrl, docHref(page.slug), { name: page.title, description: page.description, updated: DOCS_UPDATED, type: 'TechArticle' }), headline: page.title, publisher: { '@id': `${baseUrl}/#organization` } },
    breadcrumbNode(baseUrl, crumbs),
  ]

  return (
    <div className="flex gap-10 xl:gap-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <article id="top" className="min-w-0 max-w-[46rem] flex-1 pb-20 pt-8 sm:pt-10">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-ui text-(color:--mkt-muted)">
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1
              return (
                <li key={crumb.path} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-(color:--mkt-subtle)" />}
                  {last
                    ? <span aria-current="page" className="truncate font-medium text-(color:--mkt-ink-soft)">{crumb.name}</span>
                    : <Link href={crumb.path} className="truncate transition-colors hover:text-(color:--mkt-ink)">{crumb.name}</Link>}
                </li>
              )
            })}
          </ol>
        </nav>

        <header className="mt-6">
          {section && (
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)">
              <DocsIcon name={sectionMeta(section.title).icon} size={14} />
              {section.title}
            </p>
          )}
          <h1 className="mt-3 font-display text-[2.1rem] font-semibold leading-[1.12] tracking-[-0.015em] text-(color:--mkt-ink) sm:text-[2.6rem]">{page.title}</h1>
          <p className="mt-4 text-lg leading-8 text-(color:--mkt-muted)">{page.description}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-(color:--mkt-ink)/[0.07] pb-6 text-ui text-(color:--mkt-muted)">
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden="true" /> Last updated <time dateTime={DOCS_UPDATED}>{formatDocDate(DOCS_UPDATED)}</time></span>
            <span className="inline-flex items-center gap-1.5"><Clock size={14} aria-hidden="true" /> {minutes} min read</span>
            {editUrl && (
              <a href={editUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-(color:--mkt-ink)">
                <Pencil size={13} aria-hidden="true" /> Edit this page on GitHub
              </a>
            )}
          </div>
        </header>

        {toc.length > 1 && (
          <details className="group mt-6 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/60 xl:hidden">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-ui font-semibold text-(color:--mkt-ink)">
              <ListTree size={15} aria-hidden="true" className="text-(color:--mkt-bronze)" /> On this page
              <ChevronRight size={14} aria-hidden="true" className="docs-chevron ml-auto text-(color:--mkt-subtle) transition-transform" />
            </summary>
            <ul className="space-y-1 border-t border-(color:--mkt-ink)/[0.06] px-4 py-3 text-ui">
              {toc.map((entry) => (
                <li key={entry.id} className={entry.level === 3 ? 'pl-4' : ''}>
                  <a href={`#${entry.id}`} className="block py-0.5 text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink)">{entry.text}</a>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="docs-prose">
          <DocBlocks blocks={blocks} />
        </div>

        <FeedbackWidget path={docHref(page.slug)} send={cloud} contactHref={cloud ? '/contact' : null} />

        <nav aria-label="Previous and next" className="mt-8 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link href={docHref(prev.slug)} className="mkt-lift group rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white)/60 p-4 hover:border-(color:--mkt-bronze)/40">
              <span className="flex items-center gap-1.5 text-xs font-medium text-(color:--mkt-muted)"><ArrowLeft size={13} aria-hidden="true" className="transition-transform group-hover:-translate-x-0.5" /> Previous</span>
              <span className="mt-1.5 block font-semibold leading-snug text-(color:--mkt-ink) group-hover:text-(color:--mkt-bronze)">{prev.title}</span>
              <span className="mt-0.5 block text-xs text-(color:--mkt-muted)">{sectionOf(prev.slug)?.title}</span>
            </Link>
          ) : <span className="hidden sm:block" />}
          {next && (
            <Link href={docHref(next.slug)} className="mkt-lift group rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white)/60 p-4 text-right hover:border-(color:--mkt-bronze)/40">
              <span className="flex items-center justify-end gap-1.5 text-xs font-medium text-(color:--mkt-muted)">Next <ArrowRight size={13} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" /></span>
              <span className="mt-1.5 block font-semibold leading-snug text-(color:--mkt-ink) group-hover:text-(color:--mkt-bronze)">{next.title}</span>
              <span className="mt-0.5 block text-xs text-(color:--mkt-muted)">{sectionOf(next.slug)?.title}</span>
            </Link>
          )}
        </nav>
        <AnchorCopy />
      </article>
      {toc.length > 1 && (
        <aside aria-label="On this page" className="hidden w-[13.5rem] shrink-0 xl:block">
          <div data-toc-scroll="" className="docs-scroll sticky top-(--docs-header-h) max-h-[calc(100vh-var(--docs-header-h))] overflow-y-auto pb-10 pt-10">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)"><ListTree size={13} aria-hidden="true" /> On this page</p>
            <DocsToc entries={toc} />
          </div>
        </aside>
      )}
    </div>
  )
}
