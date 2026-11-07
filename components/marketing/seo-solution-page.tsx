import Link from 'next/link'
import { ArrowRight, CheckCircle2, Cloud, Server, Workflow } from 'lucide-react'
import type { SeoPage } from '@/lib/seo-pages'
import { MarketingHeader } from '@/components/marketing/marketing-ui'

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
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      {/* Fixed full-viewport backdrop so the page's dark theme covers overscroll
          and never lets the dashboard body background (var(--theme-surface),
          light by default) bleed through — matches the landing page pattern. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <MarketingHeader />

      <main>
        <section className="border-b border-(color:--mkt-ink)/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(23,21,15,0.14),transparent_42%)]">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <nav aria-label="Breadcrumb" className="text-xs text-(color:--mkt-subtle)"><Link href="/" className="hover:text-(color:--mkt-bronze)">UserTasks</Link><span className="px-2">/</span>{page.eyebrow}</nav>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-(color:--mkt-bronze)">{page.eyebrow}</p>
            <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{page.title}</h1>
            <p className="mt-6 max-w-3xl mkt-body text-(color:--mkt-text)">{page.intro}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3.5 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Build your first workflow <ArrowRight size={16} /></Link>
              {page.related
                ? <Link href={page.related.href} className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3.5 font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">{page.related.label}</Link>
                : <Link href="/docs/workflows" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3.5 font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">Explore workflow documentation</Link>}
            </div>
            <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {page.outcomes.map((outcome) => <li key={outcome} className="flex items-start gap-2 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-ink)/[0.03] p-4 text-sm text-(color:--mkt-text)"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" />{outcome}</li>)}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl space-y-6 px-6 py-20">
          {page.sections.map((section, index) => (
            <article key={section.title} className="grid gap-6 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-7 lg:grid-cols-[1fr_1.1fr] lg:p-10">
              <div><p className="text-xs font-bold text-(color:--mkt-bronze)">0{index + 1}</p><h2 className="mt-3 text-2xl font-bold sm:text-3xl">{section.title}</h2><p className="mt-4 leading-7 text-(color:--mkt-muted)">{section.body}</p></div>
              <ul className="space-y-3 self-center">{section.points.map((point) => <li key={point} className="flex items-start gap-3 rounded-lg border border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-ink)/[0.03] p-4 text-sm leading-6 text-(color:--mkt-text)"><CheckCircle2 size={17} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" />{point}</li>)}</ul>
            </article>
          ))}
        </section>

        <section className="border-y border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-canvas)">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Implementation path</p>
            <h2 className="mt-3 text-3xl font-bold">Move from evaluation to a working process</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">{page.steps.map((step, index) => <article key={step.title} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-ink)/[0.03] p-5"><span className="text-xs font-bold text-(color:--mkt-bronze)">STEP {index + 1}</span><h3 className="mt-3 font-semibold">{step.title}</h3><p className="mt-2 text-sm leading-6 text-(color:--mkt-muted)">{step.body}</p></article>)}</div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-(color:--mkt-primary)/20 bg-(color:--mkt-primary)/[0.05] p-7"><Cloud className="text-(color:--mkt-bronze)" /><h2 className="mt-4 text-2xl font-bold">UserTasks Cloud</h2><p className="mt-3 leading-7 text-(color:--mkt-muted)">Start with a managed, tenant-isolated workspace and move quickly from design to production operation.</p></article>
            <article className="rounded-2xl border border-(color:--mkt-bronze)/20 bg-(color:--mkt-bronze)/[0.05] p-7"><Server className="text-[#A0946C]" /><h2 className="mt-4 text-2xl font-bold">Private or on premises</h2><p className="mt-3 leading-7 text-(color:--mkt-muted)">Plan an organization-controlled deployment for private networking, infrastructure ownership, and data-location requirements: start on Supabase, our recommended platform, and move any area to AWS, Azure, Google Cloud or your own servers whenever you're ready.</p><Link href="/deploy-anywhere" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">See the deployment topologies <ArrowRight size={14} /></Link></article>
          </div>
        </section>

        {page.related && (
          <section className="mx-auto max-w-6xl px-6 pb-16">
            <Link href={page.related.href} className="group flex flex-col gap-2 rounded-2xl border border-(color:--mkt-bronze)/25 bg-(color:--mkt-gold)/[0.08] p-7 transition hover:border-(color:--mkt-bronze)/50 sm:flex-row sm:items-center sm:justify-between">
              <span><span className="block text-xl font-bold">{page.related.label}</span><span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{page.related.body}</span></span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Open <ArrowRight size={14} /></span>
            </Link>
          </section>
        )}

        <section className="mx-auto max-w-4xl px-6 pb-20">
          <div className="text-center"><Workflow className="mx-auto text-(color:--mkt-bronze)" /><h2 className="mt-4 text-3xl font-bold">Frequently asked questions</h2></div>
          <div className="mt-8 space-y-3">{page.faqs.map((faq) => <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5"><summary className="cursor-pointer list-none font-semibold">{faq.question}</summary><p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p></details>)}</div>
        </section>

        <section className="border-t border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-sand)">
          <div className="mx-auto max-w-6xl px-6 py-16 text-center"><h2 className="text-3xl font-bold">Build the process you actually need</h2><p className="mx-auto mt-3 max-w-2xl text-(color:--mkt-muted)">Model workflows, human tasks, integrations, decision tables, and reports in one private workspace — then drive them from your own applications through the API and MCP server.</p><Link href="/login" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Start free beta <ArrowRight size={16} /></Link></div>
        </section>
      </main>

      <footer className="border-t border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-paper)"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-xs text-(color:--mkt-subtle)"><span>© {new Date().getFullYear()} UserTasks</span><div className="flex flex-wrap gap-4"><Link href="/workflows">Workflows</Link><Link href="/connectors">Integrations</Link><Link href="/workflow-automation">Workflow automation</Link><Link href="/bpm-workflow-automation">BPM</Link><Link href="/on-premises-workflow-automation">On premises</Link><Link href="/deploy-anywhere">Deploy anywhere</Link><Link href="/use-cases">Use cases</Link><Link href="/use-cases/k2-migration">K2 migration</Link><Link href="/use-cases/nintex-migration">Nintex migration</Link><Link href="/contact">Contact</Link></div></div></footer>
    </div>
  )
}
