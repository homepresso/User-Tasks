import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { DocBlocks } from '@/components/docs/doc-blocks'
import { ALL_DOC_PAGES, docHref, getDocPage, neighbours, sectionOf } from '@/lib/docs/registry'
import { pageBlocks, tableOfContents } from '@/lib/docs/render'

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
    openGraph: { title, description: page.description, url: docHref(page.slug), type: 'article', images: [image] },
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

  return (
    <div className="flex gap-10">
      <article className="min-w-0 max-w-3xl flex-1 pb-24 pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A6D45]">{section?.title}</p>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[#1B1916] sm:text-4xl">{page.title}</h1>
        <p className="mt-3 text-lg leading-8 text-[#6E6759]">{page.description}</p>
        <DocBlocks blocks={blocks} />
        <nav aria-label="Previous and next" className="mt-16 grid gap-3 border-t border-[#1B1916]/[0.08] pt-6 sm:grid-cols-2">
          {prev ? (
            <Link href={docHref(prev.slug)} className="group rounded-xl border border-[#1B1916]/[0.09] p-4 hover:border-[#8A6D45]/40">
              <span className="flex items-center gap-1 text-xs text-[#6E6759]"><ArrowLeft size={12} aria-hidden="true" /> Previous</span>
              <span className="mt-1 block font-semibold text-[#1B1916] group-hover:text-[#8A6D45]">{prev.title}</span>
            </Link>
          ) : <span />}
          {next && (
            <Link href={docHref(next.slug)} className="group rounded-xl border border-[#1B1916]/[0.09] p-4 text-right hover:border-[#8A6D45]/40">
              <span className="flex items-center justify-end gap-1 text-xs text-[#6E6759]">Next <ArrowRight size={12} aria-hidden="true" /></span>
              <span className="mt-1 block font-semibold text-[#1B1916] group-hover:text-[#8A6D45]">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      {toc.length > 1 && (
        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto py-10">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8A6D45]">On this page</p>
            <ul className="mt-3 space-y-1.5 border-l border-[#1B1916]/[0.08] text-[13px]">
              {toc.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`} className={`block leading-5 text-[#5C564C] hover:text-[#1B1916] ${entry.level === 3 ? 'pl-6' : 'pl-3'}`}>{entry.text}</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  )
}
