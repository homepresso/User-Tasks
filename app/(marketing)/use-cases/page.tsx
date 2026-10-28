import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { SectionHeading } from '@/components/marketing/marketing-ui'
import { UseCaseCard, UseCaseShell } from '@/components/marketing/use-case-page'
import { GalleryTeaser } from '@/components/gallery/gallery-teaser'
import { publicBaseUrl } from '@/lib/deployment'
import { USE_CASES } from '@/lib/use-cases'

const TITLE = 'Use cases: headless tasks, approvals, AI agents, integrations and migrations'
const DESCRIPTION = 'How teams use UserTasks: human tasks inside their own apps, governed approvals, AI agents with human review, an integration hub, and replacing SharePoint, Nintex and K2 workflows.'

export const metadata: Metadata = {
  title: `${TITLE} | UserTasks`,
  description: DESCRIPTION,
  alternates: { canonical: '/use-cases' },
  openGraph: { title: TITLE, description: DESCRIPTION, url: '/use-cases', type: 'website' },
}

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
          {USE_CASES.map((useCase) => <UseCaseCard key={useCase.slug} useCase={useCase} />)}
        </div>
        <div className="mt-16"><GalleryTeaser eyebrow="Or start from a package" title="Ready-made workflows for each of these" /></div>
        <p className="mt-10 text-sm text-[#4A463E]">
          Not sure where to start? <Link href="/docs/concepts" className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">Read the concepts <ArrowRight size={14} aria-hidden="true" /></Link>
        </p>
      </main>
    </UseCaseShell>
  )
}
