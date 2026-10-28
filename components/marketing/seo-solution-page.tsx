import Link from 'next/link'
import { ArrowRight, CheckCircle2, Cloud, Server, Workflow } from 'lucide-react'
import type { SeoPage } from '@/lib/seo-pages'
import { Wordmark } from '@/components/brand/logo'

const SITE_URL = 'https://usertasks.com'

export function SeoSolutionPage({ page }: { page: SeoPage }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${SITE_URL}/${page.slug}#webpage`,
        url: `${SITE_URL}/${page.slug}`,
        name: page.title,
        description: page.description,
        isPartOf: { '@id': `${SITE_URL}/#website` },
        about: { '@id': `${SITE_URL}/#software` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'UserTasks', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: page.title, item: `${SITE_URL}/${page.slug}` },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  }

  return (
    <div className="relative min-h-screen bg-[#FAF8F3] text-[#1B1916]">
      {/* Fixed full-viewport backdrop so the page's dark theme covers overscroll
          and never lets the dashboard body background (var(--theme-surface),
          light by default) bleed through — matches the landing page pattern. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#FAF8F3]" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <header className="border-b border-[#1B1916]/[0.08] bg-[#FAF8F3]/95">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6" aria-label="Main navigation">
          <Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link>
          <div className="flex items-center gap-3">
            <Link href="/use-cases" className="hidden text-sm text-[#4A463E] hover:text-[#1B1916] sm:inline">Use cases</Link>
            <Link href="/deploy-anywhere" className="hidden text-sm text-[#4A463E] hover:text-[#1B1916] md:inline">Deploy anywhere</Link>
            <Link href="/docs" className="hidden text-sm text-[#4A463E] hover:text-[#1B1916] sm:inline">Documentation</Link>
            <Link href="/contact" className="hidden text-sm text-[#4A463E] hover:text-[#1B1916] md:inline">Contact</Link>
            <Link href="/login" className="rounded-lg bg-[#17150F] px-4 py-2 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Start free beta</Link>
          </div>
        </nav>
      </header>

      <main>
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(23,21,15,0.14),transparent_42%)]">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]"><Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>{page.eyebrow}</nav>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">{page.eyebrow}</p>
            <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{page.title}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">{page.intro}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3.5 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Build your first workflow <ArrowRight size={16} /></Link>
              <Link href="/docs/workflows" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3.5 font-medium text-[#33302A] hover:bg-[#1B1916]/[0.05]">Explore workflow documentation</Link>
            </div>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {page.outcomes.map((outcome) => <li key={outcome} className="flex items-start gap-2 rounded-xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-4 text-sm text-[#4A463E]"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#8A6D45]" />{outcome}</li>)}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl space-y-6 px-6 py-20">
          {page.sections.map((section, index) => (
            <article key={section.title} className="grid gap-6 rounded-2xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-7 lg:grid-cols-[1fr_1.1fr] lg:p-10">
              <div><p className="text-xs font-bold text-[#8A6D45]">0{index + 1}</p><h2 className="mt-3 text-2xl font-bold sm:text-3xl">{section.title}</h2><p className="mt-4 leading-7 text-[#6E6759]">{section.body}</p></div>
              <ul className="space-y-3 self-center">{section.points.map((point) => <li key={point} className="flex items-start gap-3 rounded-lg border border-[#1B1916]/[0.06] bg-[#1B1916]/[0.03] p-4 text-sm leading-6 text-[#4A463E]"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#8A6D45]" />{point}</li>)}</ul>
            </article>
          ))}
        </section>

        <section className="border-y border-[#1B1916]/[0.06] bg-[#F5F2EA]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">Implementation path</p>
            <h2 className="mt-3 text-3xl font-bold">Move from evaluation to a working process</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">{page.steps.map((step, index) => <article key={step.title} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-5"><span className="text-xs font-bold text-[#8A6D45]">STEP {index + 1}</span><h3 className="mt-3 font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-[#6E6759]">{step.body}</p></article>)}</div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-[#17150F]/20 bg-[#17150F]/[0.05] p-7"><Cloud className="text-[#8A6D45]" /><h2 className="mt-4 text-2xl font-bold">UserTasks Cloud</h2><p className="mt-3 leading-7 text-[#6E6759]">Start with a managed, tenant-isolated workspace and move quickly from design to production operation.</p></article>
            <article className="rounded-2xl border border-[#8A6D45]/20 bg-[#8A6D45]/[0.05] p-7"><Server className="text-[#A0946C]" /><h2 className="mt-4 text-2xl font-bold">Private or on premises</h2><p className="mt-3 leading-7 text-[#6E6759]">Plan an organization-controlled deployment for private networking, infrastructure ownership, and data-location requirements: start on Supabase, our recommended platform, and move any area to AWS, Azure, Google Cloud or your own servers whenever you're ready.</p><Link href="/deploy-anywhere" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] hover:underline">See the deployment topologies <ArrowRight size={14} /></Link></article>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 pb-20">
          <div className="text-center"><Workflow className="mx-auto text-[#8A6D45]" /><h2 className="mt-4 text-3xl font-bold">Frequently asked questions</h2></div>
          <div className="mt-8 space-y-3">{page.faqs.map((faq) => <details key={faq.question} className="group rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-5"><summary className="cursor-pointer list-none font-semibold">{faq.question}</summary><p className="mt-3 text-sm leading-7 text-[#6E6759]">{faq.answer}</p></details>)}</div>
        </section>

        <section className="border-t border-[#1B1916]/[0.06] bg-[#F1EDE3]">
          <div className="mx-auto max-w-6xl px-6 py-16 text-center"><h2 className="text-3xl font-bold">Build the process you actually need</h2><p className="mx-auto mt-3 max-w-2xl text-[#6E6759]">Model workflows, human tasks, integrations, decision tables, and reports in one private workspace — then drive them from your own applications through the API and MCP server.</p><Link href="/login" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Start free beta <ArrowRight size={16} /></Link></div>
        </section>
      </main>

      <footer className="border-t border-[#1B1916]/[0.06] bg-[#FAF8F3]"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-[#857D6D]"><span>© {new Date().getFullYear()} UserTasks</span><div className="flex flex-wrap gap-4"><Link href="/workflow-automation">Workflow automation</Link><Link href="/bpm-workflow-automation">BPM</Link><Link href="/on-premises-workflow-automation">On premises</Link><Link href="/deploy-anywhere">Deploy anywhere</Link><Link href="/use-cases">Use cases</Link><Link href="/use-cases/k2-migration">K2 migration</Link><Link href="/use-cases/nintex-migration">Nintex migration</Link><Link href="/contact">Contact</Link></div></div></footer>
    </div>
  )
}
