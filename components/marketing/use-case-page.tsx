import Link from "next/link"
import { ArrowRight, Check, CircleAlert, ExternalLink, Package } from "lucide-react"
import { MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet, USE_CASE_ICONS } from "@/components/marketing/marketing-ui"
import { UseCaseDiagramSvg } from "@/components/marketing/use-case-diagram"
import { publicBaseUrl } from "@/lib/deployment"
import { getGalleryPackage, needLabel, triggerLabel } from "@/lib/gallery/site"
import { getUseCase, type UseCase } from "@/lib/use-cases"

/** Cream paper backdrop shared by the use-case index and detail pages. */
export function UseCaseShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)">
      {/* Fixed backdrop so overscroll never shows the app body background. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  )
}

export function UseCaseCard({ useCase }: { useCase: UseCase }) {
  const Icon = USE_CASE_ICONS[useCase.icon]
  return (
    <Link href={`/use-cases/${useCase.slug}`} className="group flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-6 transition hover:border-(color:--mkt-bronze)/40 hover:shadow-md">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-(color:--mkt-gold)/[0.12] text-(color:--mkt-bronze)"><Icon size={20} aria-hidden="true" /></span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)">{useCase.eyebrow}</p>
      <h3 className="mt-1 text-lg font-semibold leading-snug">{useCase.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{useCase.summary}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) group-hover:underline">Read the use case <ArrowRight size={14} aria-hidden="true" /></span>
    </Link>
  )
}

function ProblemSolution({ useCase }: { useCase: UseCase }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">The problem</p>
          <h2 className="mt-3 font-display text-2xl font-bold tracking-tight">{useCase.problem.title}</h2>
          <p className="mt-4 leading-7 text-(color:--mkt-text)">{useCase.problem.body}</p>
          <ul className="mt-5 space-y-2 text-sm text-(color:--mkt-text)">
            {useCase.problem.points.map((point) => <li key={point} className="flex gap-2"><CircleAlert size={16} className="mt-0.5 shrink-0 text-(color:--mkt-gold-deep)" aria-hidden="true" />{point}</li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">How UserTasks solves it</p>
          <h2 className="mt-3 font-display text-2xl font-bold tracking-tight">{useCase.solution.title}</h2>
          <p className="mt-4 leading-7 text-(color:--mkt-text)">{useCase.solution.body}</p>
          <ul className="mt-5 space-y-2 text-sm text-(color:--mkt-text)">
            {useCase.solution.points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{point}</li>)}
          </ul>
        </article>
      </div>
    </section>
  )
}

export function UseCasePage({ useCase }: { useCase: UseCase }) {
  const baseUrl = publicBaseUrl()
  const url = `${baseUrl}/use-cases/${useCase.slug}`
  const related = useCase.related.map(getUseCase).filter((item): item is UseCase => Boolean(item))
  const pkg = useCase.gallery ? getGalleryPackage(useCase.gallery) : undefined
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": `${url}#webpage`, url, name: useCase.metaTitle, description: useCase.description, isPartOf: { "@id": `${baseUrl}/#website` }, about: { "@id": `${baseUrl}/#software` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "UserTasks", item: baseUrl },
          { "@type": "ListItem", position: 2, name: "Use cases", item: `${baseUrl}/use-cases` },
          { "@type": "ListItem", position: 3, name: useCase.eyebrow, item: url },
        ],
      },
      { "@type": "FAQPage", mainEntity: useCase.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  }

  return (
    <UseCaseShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <main>
        {/* Hero */}
        <section className="border-b border-(color:--mkt-ink)/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
            <nav aria-label="Breadcrumb" className="text-xs text-(color:--mkt-subtle)">
              <Link href="/" className="hover:text-(color:--mkt-bronze)">UserTasks</Link><span className="px-2">/</span>
              <Link href="/use-cases" className="hover:text-(color:--mkt-bronze)">Use cases</Link><span className="px-2">/</span>
              <span aria-current="page">{useCase.eyebrow}</span>
            </nav>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-(color:--mkt-bronze)">{useCase.eyebrow}</p>
            <h1 className="mt-4 max-w-4xl font-display text-display font-bold">{useCase.title}</h1>
            <p className="mt-6 max-w-3xl mkt-body text-(color:--mkt-text)">{useCase.description}</p>
            {useCase.disclaimer && <p className="mt-4 max-w-3xl text-xs leading-5 text-(color:--mkt-subtle)">{useCase.disclaimer}</p>}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Get started <ArrowRight size={16} aria-hidden="true" /></Link>
              {pkg && <Link href={`/gallery/${pkg.slug}`} className="inline-flex items-center justify-center gap-2 rounded-lg border border-(color:--mkt-bronze)/40 bg-(color:--mkt-gold)/[0.1] px-6 py-3 font-semibold text-[#6F522B] hover:border-(color:--mkt-bronze)/70"><Package size={16} aria-hidden="true" />Install the package</Link>}
              <Link href={useCase.features[0].href} className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Read the docs</Link>
            </div>
          </div>
        </section>

        <ProblemSolution useCase={useCase} />

        {/* Architecture */}
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Architecture" title="How the pieces fit" />
            <figure className="mt-8">
              <div className="overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-3 sm:p-5">
                <UseCaseDiagramSvg id={`uc-${useCase.slug}`} diagram={useCase.diagram} />
              </div>
              <figcaption className="mt-3 max-w-3xl text-sm leading-6 text-(color:--mkt-muted)">{useCase.diagram.desc}</figcaption>
            </figure>
          </div>
        </section>

        {/* Timeline (dated facts with sources) */}
        {useCase.timeline && (
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Timeline" title={useCase.timeline.title}>{useCase.timeline.body}</SectionHeading>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {useCase.timeline.events.map((event) => (
                <li key={event.date} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5">
                  <p className="font-display text-lg font-bold">{event.date}</p>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{event.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm text-(color:--mkt-muted)">
              Sources:{" "}
              {useCase.timeline.sources.map((source, index) => (
                <span key={source.href}>
                  {index > 0 && " · "}
                  <a href={source.href} rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-(color:--mkt-bronze) hover:underline">{source.label}<ExternalLink size={12} aria-hidden="true" /></a>
                </span>
              ))}
            </p>
          </section>
        )}

        {/* Concept mapping */}
        {useCase.mapping && (
          <section className={`mx-auto max-w-6xl px-4 sm:px-6 ${useCase.timeline ? "pb-16" : "py-16"}`}>
            <SectionHeading eyebrow="Concept map" title={useCase.mapping.title}>{useCase.mapping.body}</SectionHeading>
            <div className="mt-8 overflow-x-auto rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-(color:--mkt-sand) text-xs uppercase tracking-[0.12em] text-(color:--mkt-muted)">
                  <tr><th scope="col" className="px-5 py-3 font-semibold">{useCase.mapping.from}</th><th scope="col" className="px-5 py-3 font-semibold">In UserTasks</th></tr>
                </thead>
                <tbody>
                  {useCase.mapping.rows.map((row) => (
                    <tr key={row.from} className="border-t border-(color:--mkt-ink)/[0.06] align-top">
                      <th scope="row" className="w-2/5 px-5 py-3.5 font-semibold text-(color:--mkt-ink)">{row.from}</th>
                      <td className="px-5 py-3.5 leading-6 text-(color:--mkt-text)">
                        {row.to}
                        {row.href && <> <Link href={row.href} className="whitespace-nowrap font-medium text-(color:--mkt-bronze) hover:underline">Docs →</Link></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Features */}
        <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Key features" title="What you will use" />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {useCase.features.map((feature) => (
                <li key={feature.title}>
                  <Link href={feature.href} className="group block h-full rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-5 transition hover:border-(color:--mkt-bronze)/40">
                    <span className="flex items-center justify-between gap-2 font-semibold">{feature.title}<ArrowRight size={14} className="text-(color:--mkt-bronze) opacity-60 group-hover:opacity-100" aria-hidden="true" /></span>
                    <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{feature.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Snippet + screenshot */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2">
            <div className="min-w-0">
              <SectionHeading eyebrow="In practice" title={useCase.snippet.title}>{useCase.snippet.body}</SectionHeading>
              <div className="mt-6"><Snippet code={useCase.snippet.code} language={useCase.snippet.language} /></div>
            </div>
            <figure className="min-w-0 lg:pt-10">
              <Shot name={useCase.screenshot.name} alt={useCase.screenshot.alt} sizes="(min-width: 1024px) 540px, 100vw" />
              <figcaption className="mt-2 text-sm text-(color:--mkt-muted)">{useCase.screenshot.caption}</figcaption>
            </figure>
          </div>
        </section>

        {/* Migration steps */}
        {useCase.steps && (
          <section className="border-y border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-canvas)">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <SectionHeading eyebrow={useCase.stepsHeading?.eyebrow ?? "Plan"} title={useCase.stepsHeading?.title ?? "A migration path that holds up"} />
              <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {useCase.steps.map((step, index) => (
                  <li key={step.title} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
                    <span className="text-xs font-bold text-(color:--mkt-bronze)">STEP {index + 1}</span>
                    <h3 className="mt-2 font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* Ready-made gallery package */}
        {pkg && (
          <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6">
            <div className="flex flex-col gap-6 rounded-3xl border border-(color:--mkt-bronze)/25 bg-(color:--mkt-white) p-7 sm:flex-row sm:items-center sm:justify-between sm:p-9">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Ready-made package</p>
                <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{pkg.title}</h2>
                <p className="mt-3 leading-7 text-(color:--mkt-text)">{pkg.summary}</p>
                <p className="mt-3 text-sm text-(color:--mkt-muted)">{triggerLabel(pkg.trigger)} · needs {pkg.needs.map(needLabel).join(", ")} · about {pkg.setup_minutes} minutes to set up · signed, free to install</p>
              </div>
              <Link href={`/gallery/${pkg.slug}`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">See the package <ArrowRight size={16} aria-hidden="true" /></Link>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-display text-3xl font-bold tracking-tight">Frequently asked questions</h2>
          <div className="mt-8 space-y-3">
            {useCase.faqs.map((faq) => (
              <details key={faq.question} className="rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
                <summary className="cursor-pointer font-semibold">{faq.question}</summary>
                <p className="mt-3 text-sm leading-7 text-(color:--mkt-text)">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Related + CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <h2 className="font-display text-2xl font-bold tracking-tight">Related use cases</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {related.map((item) => <UseCaseCard key={item.slug} useCase={item} />)}
          </div>
          <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-(color:--mkt-text)">
            <span className="font-semibold text-(color:--mkt-ink)">Building blocks:</span>
            <Link href="/workflows" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Complex workflows <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/connectors" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Integrations and AI <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/forms" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Forms and attachments <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/documents" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Document actions <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/media" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Images, audio and video <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/gallery" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Package gallery <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/deploy-anywhere" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Deploy anywhere <ArrowRight size={14} aria-hidden="true" /></Link>
          </p>
          <div className="mt-14 rounded-3xl border border-(color:--mkt-ink)/10 bg-gradient-to-br from-(color:--mkt-primary)/[0.06] via-transparent to-(color:--mkt-gold)/[0.12] p-8 text-center sm:p-12">
            <h2 className="font-display text-3xl font-bold tracking-tight">Build it on an engine you control.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-(color:--mkt-text)">Open source under Apache-2.0. Use the cloud, or self-host it next to your own systems.</p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-(color:--mkt-primary) px-6 py-3 font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Get started <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/docs/quickstart/cloud" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Quickstart</Link>
              <Link href="/contact" className="inline-flex items-center justify-center rounded-lg border border-(color:--mkt-ink)/15 px-6 py-3 font-medium text-(color:--mkt-ink-soft) hover:border-(color:--mkt-ink)/30">Talk to us</Link>
            </div>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
