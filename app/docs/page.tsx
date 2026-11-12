import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ArrowUpRight, Flame } from 'lucide-react'
import { pageMetadata } from '@/lib/seo/site'
import { DOC_SECTIONS, docHref } from '@/lib/docs/registry'
import { HOME_FEATURES, POPULAR_PAGES, START_HERE, sectionMeta } from '@/lib/docs/nav'
import { Screenshot } from '@/components/docs/doc-blocks'
import { DocsIcon } from '@/components/docs/icons'
import { DocsSearchTrigger } from '@/components/docs/docs-nav'

export const metadata: Metadata = pageMetadata({
  path: '/docs',
  title: 'UserTasks documentation — the open source process platform',
  description: 'Guides and reference for the UserTasks workflow engine: designer, nodes, expressions, tasks, integrations, decision tables, agents, governance, REST API, MCP, CLI, log export and self-hosting.',
  socialTitle: 'UserTasks documentation',
})

/** Links shown per section card before "more". */
const CARD_LINKS = 4

export default function DocsHome() {
  const pageCount = DOC_SECTIONS.reduce((total, section) => total + section.pages.length, 0)
  return (
    <div className="mx-auto max-w-6xl pb-24">
      {/* Hero */}
      <section aria-labelledby="docs-home-title" className="relative isolate overflow-hidden pb-10 pt-12 sm:pt-16">
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-x-0 -top-10 -z-10 h-[420px] opacity-70" />
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.22),transparent)] blur-2xl" />
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/25 bg-(color:--mkt-white)/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)">
              Documentation
            </p>
            <h1 id="docs-home-title" className="mt-5 font-display text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-(color:--mkt-ink) sm:text-[3.4rem]">
              Build on the UserTasks <span className="mkt-gradient-text-ink">process platform</span>
            </h1>
            <p className="mt-5 max-w-xl mkt-body text-(color:--mkt-muted)">
              Design workflows visually or as JSON, put people in the loop with tasks, connect any API, and drive all of it from the REST API, the MCP server or the <code className="rounded-md bg-(color:--mkt-ink)/[0.06] px-1.5 font-mono text-[0.9em]">usertasks</code> CLI. Reference pages are generated from the code, so they match the version you run.
            </p>
            <div className="mt-7">
              <DocsSearchTrigger variant="hero" />
            </div>
            <p className="mt-3 text-ui text-(color:--mkt-muted)">{pageCount} pages across {DOC_SECTIONS.length} sections · press <kbd className="rounded border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-1 font-sans text-2xs">/</kbd> to search from anywhere</p>
          </div>
          <div className="mkt-glow hidden lg:block [&_figure]:mt-0">
            <Screenshot name="designer" alt="The UserTasks workflow designer with an invoice approval workflow" priority />
          </div>
        </div>
      </section>

      {/* Start here */}
      <section aria-labelledby="docs-start" className="mt-4">
        <h2 id="docs-start" className="font-display text-2xl font-semibold text-(color:--mkt-ink)">Start here</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {START_HERE.map((item) => (
            <Link key={item.href} href={item.href} className="mkt-lift group flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-4 hover:border-(color:--mkt-bronze)/40">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-(color:--mkt-bronze)/[0.1] text-(color:--mkt-bronze)">
                <DocsIcon name={item.icon} size={18} />
              </span>
              <span className="mt-4 flex items-center gap-1 font-semibold leading-snug text-(color:--mkt-ink)">
                {item.title}
                <ArrowRight size={14} aria-hidden="true" className="shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
              </span>
              <span className="mt-1.5 block text-ui leading-5 text-(color:--mkt-muted)">{item.body}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Self-hosting / API / Agent strip */}
      <section aria-label="Self-hosting, API and Agent" className="mkt-night mkt-grain relative mt-14 overflow-hidden rounded-3xl p-6 sm:p-8">
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative grid gap-8 md:grid-cols-3 md:gap-6">
          {HOME_FEATURES.map((feature) => (
            <div key={feature.eyebrow} className="flex flex-col">
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-ember)">
                <DocsIcon name={feature.icon} size={14} /> {feature.eyebrow}
              </p>
              <h2 className="mt-3 font-display text-xl font-semibold text-(color:--mkt-night-text)">{feature.title}</h2>
              <p className="mt-2 text-ui leading-6 text-(color:--mkt-night-muted)">{feature.body}</p>
              <ul className="mt-4 space-y-1.5">
                {feature.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="group inline-flex items-center gap-1.5 text-sm font-medium text-(color:--mkt-night-text) hover:text-(color:--mkt-amber)">
                      {link.title}
                      <ArrowRight size={13} aria-hidden="true" className="text-(color:--mkt-ember) transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Popular */}
      <section aria-labelledby="docs-popular" className="mt-14">
        <h2 id="docs-popular" className="inline-flex items-center gap-2 font-display text-2xl font-semibold text-(color:--mkt-ink)">
          <Flame size={18} aria-hidden="true" className="text-(color:--mkt-bronze)" /> Popular pages
        </h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {POPULAR_PAGES.map(({ title, href }) => (
            <li key={href}>
              <Link href={href} className="inline-flex items-center gap-1 rounded-full border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) px-3.5 py-1.5 text-ui font-medium text-(color:--mkt-ink-soft) transition hover:border-(color:--mkt-bronze)/45 hover:text-(color:--mkt-bronze)">
                {title}
                <ArrowUpRight size={12} aria-hidden="true" className="opacity-50" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Every section: the no-JS index the search and menu triggers link to */}
      <section id="browse" aria-labelledby="docs-browse" className="mt-16 scroll-mt-24">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="docs-browse" className="font-display text-2xl font-semibold text-(color:--mkt-ink)">Browse the docs</h2>
          <p className="text-ui text-(color:--mkt-muted)">Every section and page</p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DOC_SECTIONS.map((section) => {
            const meta = sectionMeta(section.title)
            const items = [...section.pages.map((page) => ({ title: page.title, href: docHref(page.slug) })), ...(section.links ?? [])]
            const shown = items.slice(0, CARD_LINKS)
            const more = items.slice(CARD_LINKS)
            return (
              <div key={section.title} className="flex flex-col rounded-2xl border border-(color:--mkt-ink)/[0.09] bg-(color:--mkt-white) p-5 transition-colors hover:border-(color:--mkt-bronze)/35">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) text-(color:--mkt-bronze)">
                    <DocsIcon name={meta.icon} size={17} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-snug text-(color:--mkt-ink)">
                      <Link href={items[0].href} className="hover:text-(color:--mkt-bronze)">{section.title}</Link>
                    </h3>
                    {meta.blurb && <p className="mt-1 text-ui leading-5 text-(color:--mkt-muted)">{meta.blurb}</p>}
                  </div>
                </div>
                <ul className="mt-4 space-y-1 border-t border-(color:--mkt-ink)/[0.06] pt-3 text-ui">
                  {shown.map((item) => (
                    <li key={item.href}><Link href={item.href} className="block truncate py-0.5 text-(color:--mkt-ink-soft) hover:text-(color:--mkt-bronze)">{item.title}</Link></li>
                  ))}
                </ul>
                {more.length > 0 && (
                  <details className="mt-1 text-ui">
                    <summary className="inline-flex cursor-pointer items-center gap-1 py-0.5 font-medium text-(color:--mkt-bronze)">
                      {more.length} more <ArrowRight size={12} aria-hidden="true" className="docs-chevron transition-transform" />
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {more.map((item) => (
                        <li key={item.href}><Link href={item.href} className="block truncate py-0.5 text-(color:--mkt-ink-soft) hover:text-(color:--mkt-bronze)">{item.title}</Link></li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
