import type { CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, Check, CalendarClock, ExternalLink, FileStack, GitBranch, ListChecks, Server, Workflow, Layers } from 'lucide-react'
import { seoPageJsonLd, type SeoPage } from '@/lib/seo-pages'
import { MarketingFooter, MarketingHeader, SectionHeading } from '@/components/marketing/marketing-ui'
import { ProductHero } from '@/components/marketing/product-hero'
import { publicBaseUrl } from '@/lib/deployment'
import { displayDate, jsonLdHtml } from '@/lib/seo/site'
import { START_HREF } from '@/lib/marketing-nav'

/**
 * Solution and guide pages (lib/seo-pages.ts): a dark hero, an "In short"
 * definition card, sections, an optional dated timeline with sources, an
 * optional table, steps, an FAQ with question headings and visible answers,
 * and further reading. Everything is server-rendered so crawlers and answer
 * engines read the same text people do.
 */

const ICONS: Record<string, typeof Workflow> = {
  'workflow-automation': Workflow,
  'bpm-workflow-automation': Layers,
  'on-premises-workflow-automation': Server,
  'sharepoint-workflow-migration': ListChecks,
  'infopath-migration-guide': FileStack,
  'open-source-workflow-engine': GitBranch,
}

const THEME = {
  '--theme-card-bg': 'var(--mkt-white)',
  '--theme-card-text': 'var(--mkt-ink)',
  '--theme-surface': 'var(--mkt-canvas)',
  '--theme-surface-border': 'var(--mkt-line)',
  '--theme-muted-text': 'var(--mkt-muted)',
} as CSSProperties

export function SeoSolutionPage({ page }: { page: SeoPage }) {
  const Icon = ICONS[page.slug] ?? Workflow
  const updated = displayDate(page.updated)

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(seoPageJsonLd(page, publicBaseUrl())) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb={page.eyebrow}
          eyebrow={page.eyebrow}
          icon={Icon}
          title={page.title}
          intro={page.intro}
          primary={page.related ? { href: page.related.href, label: page.related.label } : { href: START_HREF, label: 'Start free' }}
          secondary={page.related ? { href: START_HREF, label: 'Start free' } : { href: '/docs', label: 'Read the docs' }}
          visual={
            <div className="rounded-3xl border border-white/10 bg-(color:--mkt-paper) p-6 text-(color:--mkt-ink) shadow-2xl sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">In short</p>
              <p className="mt-3 max-w-4xl text-[17px] leading-8 text-(color:--mkt-ink)">{page.definition}</p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {page.outcomes.map((outcome) => (
                  <li key={outcome} className="flex items-start gap-2 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-3 text-sm leading-6 text-(color:--mkt-text)"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{outcome}</li>
                ))}
              </ul>
              <p className="mt-5 flex items-center gap-2 text-xs text-(color:--mkt-muted)"><CalendarClock size={14} aria-hidden="true" />Last updated <time dateTime={page.updated}>{updated}</time></p>
            </div>
          }
        />

        <section className="mx-auto max-w-6xl space-y-6 px-4 py-16 sm:px-6 sm:py-20">
          {page.sections.map((section, index) => (
            <article key={section.title} className="grid gap-6 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-7 lg:grid-cols-[1fr_1.1fr] lg:p-10" data-reveal>
              <div>
                <p className="text-xs font-bold text-(color:--mkt-bronze)">0{index + 1}</p>
                <h2 className="mt-3 font-display text-2xl font-bold tracking-tight sm:text-3xl">{section.title}</h2>
                <p className="mt-4 leading-7 text-(color:--mkt-text)">{section.body}</p>
              </div>
              <ul className="space-y-3 self-center">
                {section.points.map((point) => <li key={point} className="flex items-start gap-3 rounded-lg border border-(color:--mkt-ink)/[0.06] bg-(color:--mkt-sand) p-4 text-sm leading-6 text-(color:--mkt-text)"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{point}</li>)}
              </ul>
            </article>
          ))}
        </section>

        {page.timeline && (
          <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
              <SectionHeading eyebrow="Dates and sources" title={page.timeline.title}>{page.timeline.body}</SectionHeading>
              <ol className="mt-10 space-y-3">
                {page.timeline.events.map((event) => (
                  <li key={`${event.date}-${event.text}`} className="grid gap-1 rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-4 sm:grid-cols-[11rem_1fr] sm:gap-6">
                    <span className="font-semibold text-(color:--mkt-bronze)">{event.date}</span>
                    <span className="text-sm leading-6 text-(color:--mkt-text)">{event.text}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-sm text-(color:--mkt-muted)">Sources:</p>
              <ul className="mt-2 space-y-1 text-sm">
                {page.timeline.sources.map((source) => <li key={source.href}><a href={source.href} rel="noopener" className="inline-flex items-center gap-1 text-(color:--mkt-bronze) hover:underline">{source.label} <ExternalLink size={12} aria-hidden="true" /></a></li>)}
              </ul>
            </div>
          </section>
        )}

        {page.comparison && (
          <section className="border-t border-(color:--mkt-ink)/[0.07]">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
              <SectionHeading eyebrow="Side by side" title={page.comparison.title}>{page.comparison.body}</SectionHeading>
              <div className="mt-10 overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead className="bg-(color:--mkt-sand) text-xs uppercase tracking-wider text-(color:--mkt-muted)">
                    <tr>{page.comparison.columns.map((column, index) => <th key={index} scope="col" className="px-4 py-3">{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {page.comparison.rows.map((row) => (
                      <tr key={row[0]} className="border-t border-(color:--mkt-ink)/[0.06] align-top">
                        {row.map((cell, index) => index === 0
                          ? <th key={index} scope="row" className="px-4 py-3 font-semibold">{cell}</th>
                          : <td key={index} className="px-4 py-3 text-(color:--mkt-text)">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {page.comparison.note && <p className="mt-4 text-sm text-(color:--mkt-muted)">{page.comparison.note}</p>}
            </div>
          </section>
        )}

        <section className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow={page.howTo ? 'Step by step' : 'Implementation path'} title={page.stepsTitle ?? 'Move from evaluation to a working process'} />
            <ol className={`mt-10 grid gap-4 md:grid-cols-2 ${page.steps.length % 3 === 0 ? 'lg:grid-cols-3' : page.steps.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
              {page.steps.map((step, index) => (
                <li key={step.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5" data-reveal>
                  <span className="flex size-8 items-center justify-center rounded-full bg-(color:--mkt-ink) text-sm font-semibold text-white">{index + 1}</span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {page.related && (
          <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
            <Link href={page.related.href} className="group flex flex-col gap-2 rounded-2xl border border-(color:--mkt-bronze)/25 bg-(color:--mkt-gold)/[0.08] p-7 transition hover:border-(color:--mkt-bronze)/50 sm:flex-row sm:items-center sm:justify-between">
              <span><span className="block text-xl font-bold">{page.related.label}</span><span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{page.related.body}</span></span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Open <ArrowRight size={14} aria-hidden="true" /></span>
            </Link>
          </section>
        )}

        <section id="faq" className="mx-auto max-w-4xl scroll-mt-8 px-4 py-16 sm:px-6 sm:py-20">
          <SectionHeading eyebrow="FAQ" title="Frequently asked questions" align="center" />
          <div className="mt-10 space-y-4">
            {page.faqs.map((faq) => (
              <article key={faq.question} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-6">
                <h3 className="text-lg font-semibold">{faq.question}</h3>
                <p className="mt-2 text-[15px] leading-7 text-(color:--mkt-text)">{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpen size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />Read next</h2>
            <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {page.links.map((link) => <li key={link.href}><Link href={link.href} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link></li>)}
            </ul>
            {page.disclaimer && <p className="mt-8 max-w-3xl text-xs leading-5 text-(color:--mkt-subtle)">{page.disclaimer}</p>}
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
