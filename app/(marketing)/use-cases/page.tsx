import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/seo/site'
import { USE_CASES_INDEX } from '@/lib/seo/public-pages'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { SectionHeading } from '@/components/marketing/marketing-ui'
import { UseCaseCard, UseCaseShell } from '@/components/marketing/use-case-page'
import { GalleryTeaser } from '@/components/gallery/gallery-teaser'
import { publicBaseUrl } from '@/lib/deployment'
import { USE_CASES, useCasesInGroup } from '@/lib/use-cases'

const TITLE = USE_CASES_INDEX.title
const DESCRIPTION = USE_CASES_INDEX.description

export const metadata: Metadata = pageMetadata({ path: '/use-cases', title: `${TITLE} | UserTasks`, description: DESCRIPTION, socialTitle: TITLE })

export default function UseCasesIndex() {
  const baseUrl = publicBaseUrl()
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${baseUrl}/use-cases#webpage`,
    url: `${baseUrl}/use-cases`,
    name: TITLE,
    description: DESCRIPTION,
    isPartOf: { '@id': `${baseUrl}/#website` },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: USE_CASES.map((useCase, index) => ({ '@type': 'ListItem', position: index + 1, name: useCase.title, url: `${baseUrl}/use-cases/${useCase.slug}` })),
    },
  }
  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <SectionHeading as="h1" eyebrow="Use cases" title="What teams build on UserTasks">
          One headless engine for human tasks, approvals, AI agents and integrations — driven from the API, MCP and CLI, in your own UI or ours.
        </SectionHeading>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {useCasesInGroup('platform').map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
        </div>
        <section id="forms" className="mt-16 scroll-mt-8" aria-labelledby="forms-use-cases">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Surveys, questionnaires and sign-offs</p>
              <h2 id="forms-use-cases" className="mt-2 font-display text-3xl font-bold tracking-tight">Forms that do more than collect answers</h2>
              <p className="mt-3 leading-7 text-(color:--mkt-text)">Ratings, sliders, Likert matrices, editable tables, signatures, PDF viewing and charts from the gallery&apos;s official form controls, wired to data tables, decision tables, SLAs and reports. Each one is a ready-made package that needs no integration.</p>
            </div>
            <Link href="/gallery/controls" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">The form controls <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {useCasesInGroup('forms').map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
          </div>
        </section>
        <section id="media" className="mt-16 scroll-mt-8" aria-labelledby="media-use-cases">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Images, audio and video</p>
              <h2 id="media-use-cases" className="mt-2 font-display text-3xl font-bold tracking-tight">Recordings, photos and video in the process</h2>
              <p className="mt-3 leading-7 text-(color:--mkt-text)">Transcribe, analyse and redact media with your own AI provider key, and keep a person on every decision that matters. Each one has a ready-made package in the gallery.</p>
            </div>
            <Link href="/media" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">The media steps <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {useCasesInGroup('media').map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
          </div>
        </section>
        <section className="mt-16 grid gap-5 md:grid-cols-2" aria-label="Building blocks">
          {[
            { href: '/workflows', eyebrow: 'Workflows', title: 'Build complex workflows visually', body: 'Branches, parallel paths, loops, sub-workflows, rules, people, SLAs and error paths — tested, versioned and migrated live.' },
            { href: '/connectors', eyebrow: 'Integrations and AI', title: 'Connect to any system and any AI', body: 'Connectors, any REST or OData API, databases, webhooks, MCP both ways and agents on the models you choose.' },
            { href: '/forms', eyebrow: 'Forms', title: 'Forms that start and drive your workflows', body: 'Grid forms with lookups and file uploads on tasks, workflow starts and their own pages with QR codes.' },
            { href: '/documents', eyebrow: 'Documents', title: 'Read, compare and transform documents', body: 'Word, Excel, PowerPoint and PDF in the run: redlines, conversion, extraction to tables and redaction.' },
            { href: '/media', eyebrow: 'Images, audio and video', title: 'Transcribe, analyse and redact media', body: 'Calls and meetings to text with speakers and subtitles, photo and video analysis, blurred faces and bleeped personal data — with your own AI key.' },
            { href: '/deploy-anywhere', eyebrow: 'Deploy anywhere', title: 'Run it where your data lives', body: 'Our cloud, or self-hosted on Supabase, AWS, Azure, Google Cloud, Kubernetes or fully on-premises.' },
          ].map((block) => (
            <Link key={block.href} href={block.href} className="group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-6 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-(color:--mkt-bronze)">{block.eyebrow}</span>
              <span className="mt-2 font-display text-xl font-bold">{block.title}</span>
              <span className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{block.body}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Explore <ArrowRight size={14} aria-hidden="true" /></span>
            </Link>
          ))}
        </section>
        <div className="mt-16"><GalleryTeaser eyebrow="Or start from a package" title="Ready-made workflows for each of these" /></div>
        <p className="mt-10 text-sm text-(color:--mkt-text)">
          Not sure where to start? <Link href="/docs/concepts" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Read the concepts <ArrowRight size={14} aria-hidden="true" /></Link>
        </p>
      </main>
    </UseCaseShell>
  )
}
