import Link from "next/link"
import { ArrowRight, Check, CircleAlert, ExternalLink } from "lucide-react"
import { MarketingFooter, MarketingHeader, SectionHeading, Shot, Snippet, USE_CASE_ICONS } from "@/components/marketing/marketing-ui"
import { UseCaseDiagramSvg } from "@/components/marketing/use-case-diagram"
import { publicBaseUrl } from "@/lib/deployment"
import { getUseCase, type UseCase } from "@/lib/use-cases"

/** Cream paper backdrop shared by the use-case index and detail pages. */
export function UseCaseShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-[#FAF8F3] text-[#1B1916]">
      {/* Fixed backdrop so overscroll never shows the app body background. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#FAF8F3]" aria-hidden="true" />
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  )
}

export function UseCaseCard({ useCase }: { useCase: UseCase }) {
  const Icon = USE_CASE_ICONS[useCase.icon]
  return (
    <Link href={`/use-cases/${useCase.slug}`} className="group flex h-full flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-6 transition hover:border-[#8A6D45]/40 hover:shadow-md">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#B08A54]/[0.12] text-[#8A6D45]"><Icon size={20} aria-hidden="true" /></span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#8A6D45]">{useCase.eyebrow}</p>
      <h3 className="mt-1 text-lg font-semibold leading-snug">{useCase.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-[#4A463E]">{useCase.summary}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] group-hover:underline">Read the use case <ArrowRight size={14} aria-hidden="true" /></span>
    </Link>
  )
}

function ProblemSolution({ useCase }: { useCase: UseCase }) {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">The problem</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">{useCase.problem.title}</h2>
          <p className="mt-4 leading-7 text-[#4A463E]">{useCase.problem.body}</p>
          <ul className="mt-5 space-y-2 text-sm text-[#4A463E]">
            {useCase.problem.points.map((point) => <li key={point} className="flex gap-2"><CircleAlert size={16} className="mt-0.5 shrink-0 text-[#A0804F]" aria-hidden="true" />{point}</li>)}
          </ul>
        </article>
        <article className="rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8A6D45]">How UserTasks solves it</p>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">{useCase.solution.title}</h2>
          <p className="mt-4 leading-7 text-[#4A463E]">{useCase.solution.body}</p>
          <ul className="mt-5 space-y-2 text-sm text-[#4A463E]">
            {useCase.solution.points.map((point) => <li key={point} className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-[#4F7A5B]" aria-hidden="true" />{point}</li>)}
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
        <section className="border-b border-[#1B1916]/[0.06] bg-[radial-gradient(circle_at_50%_0%,rgba(176,138,84,0.14),transparent_45%)]">
          <div className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
            <nav aria-label="Breadcrumb" className="text-xs text-[#857D6D]">
              <Link href="/" className="hover:text-[#8A6D45]">UserTasks</Link><span className="px-2">/</span>
              <Link href="/use-cases" className="hover:text-[#8A6D45]">Use cases</Link><span className="px-2">/</span>
              <span aria-current="page">{useCase.eyebrow}</span>
            </nav>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.22em] text-[#8A6D45]">{useCase.eyebrow}</p>
            <h1 className="mt-4 max-w-4xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">{useCase.title}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-[#4A463E]">{useCase.description}</p>
            {useCase.disclaimer && <p className="mt-4 max-w-3xl text-xs leading-5 text-[#857D6D]">{useCase.disclaimer}</p>}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Get started <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href={useCase.features[0].href} className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Read the docs</Link>
            </div>
          </div>
        </section>

        <ProblemSolution useCase={useCase} />

        {/* Architecture */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Architecture" title="How the pieces fit" />
            <figure className="mt-8">
              <div className="overflow-x-auto rounded-2xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-3 sm:p-5">
                <UseCaseDiagramSvg id={`uc-${useCase.slug}`} diagram={useCase.diagram} />
              </div>
              <figcaption className="mt-3 max-w-3xl text-sm leading-6 text-[#6E6759]">{useCase.diagram.desc}</figcaption>
            </figure>
          </div>
        </section>

        {/* Timeline (dated facts with sources) */}
        {useCase.timeline && (
          <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Timeline" title={useCase.timeline.title}>{useCase.timeline.body}</SectionHeading>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {useCase.timeline.events.map((event) => (
                <li key={event.date} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5">
                  <p className="font-[family-name:var(--font-display)] text-lg font-bold">{event.date}</p>
                  <p className="mt-2 text-sm leading-6 text-[#4A463E]">{event.text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 text-sm text-[#6E6759]">
              Sources:{" "}
              {useCase.timeline.sources.map((source, index) => (
                <span key={source.href}>
                  {index > 0 && " · "}
                  <a href={source.href} rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-[#8A6D45] hover:underline">{source.label}<ExternalLink size={12} aria-hidden="true" /></a>
                </span>
              ))}
            </p>
          </section>
        )}

        {/* Concept mapping */}
        {useCase.mapping && (
          <section className={`mx-auto max-w-6xl px-4 sm:px-6 ${useCase.timeline ? "pb-16" : "py-16"}`}>
            <SectionHeading eyebrow="Concept map" title={useCase.mapping.title}>{useCase.mapping.body}</SectionHeading>
            <div className="mt-8 overflow-x-auto rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#F1EDE3] text-xs uppercase tracking-[0.12em] text-[#6E6759]">
                  <tr><th scope="col" className="px-5 py-3 font-semibold">{useCase.mapping.from}</th><th scope="col" className="px-5 py-3 font-semibold">In UserTasks</th></tr>
                </thead>
                <tbody>
                  {useCase.mapping.rows.map((row) => (
                    <tr key={row.from} className="border-t border-[#1B1916]/[0.06] align-top">
                      <th scope="row" className="w-2/5 px-5 py-3.5 font-semibold text-[#1B1916]">{row.from}</th>
                      <td className="px-5 py-3.5 leading-6 text-[#4A463E]">
                        {row.to}
                        {row.href && <> <Link href={row.href} className="whitespace-nowrap font-medium text-[#8A6D45] hover:underline">Docs →</Link></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Features */}
        <section className="border-y border-[#1B1916]/[0.07] bg-[#FFFFFF]/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <SectionHeading eyebrow="Key features" title="What you will use" />
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {useCase.features.map((feature) => (
                <li key={feature.title}>
                  <Link href={feature.href} className="group block h-full rounded-xl border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-5 transition hover:border-[#8A6D45]/40">
                    <span className="flex items-center justify-between gap-2 font-semibold">{feature.title}<ArrowRight size={14} className="text-[#8A6D45] opacity-60 group-hover:opacity-100" aria-hidden="true" /></span>
                    <span className="mt-1 block text-sm leading-6 text-[#4A463E]">{feature.body}</span>
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
              <figcaption className="mt-2 text-sm text-[#6E6759]">{useCase.screenshot.caption}</figcaption>
            </figure>
          </div>
        </section>

        {/* Migration steps */}
        {useCase.steps && (
          <section className="border-y border-[#1B1916]/[0.07] bg-[#F5F2EA]">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
              <SectionHeading eyebrow="Plan" title="A migration path that holds up" />
              <ol className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {useCase.steps.map((step, index) => (
                  <li key={step.title} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#FFFFFF]/70 p-5">
                    <span className="text-xs font-bold text-[#8A6D45]">STEP {index + 1}</span>
                    <h3 className="mt-2 font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-[#4A463E]">{step.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          <h2 className="text-center font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Frequently asked questions</h2>
          <div className="mt-8 space-y-3">
            {useCase.faqs.map((faq) => (
              <details key={faq.question} className="rounded-xl border border-[#1B1916]/[0.08] bg-[#F1EDE3] p-5">
                <summary className="cursor-pointer font-semibold">{faq.question}</summary>
                <p className="mt-3 text-sm leading-7 text-[#4A463E]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Related + CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">Related use cases</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-3">
            {related.map((item) => <UseCaseCard key={item.slug} useCase={item} />)}
          </div>
          <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[#4A463E]">
            <span className="font-semibold text-[#1B1916]">Building blocks:</span>
            <Link href="/forms" className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">Forms and attachments <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/documents" className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">Document actions <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/gallery" className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">Package gallery <ArrowRight size={14} aria-hidden="true" /></Link>
            <Link href="/deploy-anywhere" className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] hover:underline">Deploy anywhere <ArrowRight size={14} aria-hidden="true" /></Link>
          </p>
          <div className="mt-14 rounded-3xl border border-[#1B1916]/10 bg-gradient-to-br from-[#17150F]/[0.06] via-transparent to-[#B08A54]/[0.12] p-8 text-center sm:p-12">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight">Build it on an engine you control.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-[#4A463E]">Open source under Apache-2.0. Use the cloud, or self-host it next to your own systems.</p>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#17150F] px-6 py-3 font-semibold text-[#FAF8F3] hover:bg-[#2E2A24]">Get started <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href="/docs/quickstart/cloud" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Quickstart</Link>
              <Link href="/contact" className="inline-flex items-center justify-center rounded-lg border border-[#1B1916]/15 px-6 py-3 font-medium text-[#33302A] hover:border-[#1B1916]/30">Talk to us</Link>
            </div>
          </div>
        </section>
      </main>
    </UseCaseShell>
  )
}
