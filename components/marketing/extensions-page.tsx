import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Check, Cloud, Cpu, FileKey2, GitBranch, Layers, Puzzle, Server, ShieldCheck, WifiOff } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { CheckList, FaqList, MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/marketing-ui"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, faqNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import {
  EXTENSIONS, EXTENSIONS_FAQS, EXTENSIONS_PAGE, EXTENSIONS_UPDATED, LICENSING_FACTS, STATUS_LABEL,
  extensionProductNode, type Extension, type ExtensionId, type ExtensionStatus,
} from "@/lib/seo/extensions"
import { SHAREPOINT_TRIAL } from "@/lib/seo/sharepoint-facts"

/**
 * /extensions and /extensions/<id>: the paid extensions to the open-source
 * core (lib/seo/extensions.ts). SharePoint keeps its own page, /sharepoint;
 * the index lists it with the others and links there. Each extension's
 * badge, calls to action and structured-data offer follow its one `status`
 * field, so flipping "Coming soon" to "Available" is a one-line change.
 */

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const ICONS: Record<ExtensionId, typeof Server> = { sharepoint: Server, infrastructure: Layers, processing: Cpu }

const TRADEMARKS = "UserTasks is an independent open-source project and is not affiliated with or endorsed by Microsoft or Nintex. SharePoint, SharePoint Designer, InfoPath, Microsoft 365, Microsoft Entra ID, Azure and AD FS are trademarks of the Microsoft group of companies; Nintex, Amazon S3, Google Cloud Storage and other product names are trademarks of their respective owners."

/** "Available" or "Coming soon", from the extension's status field. */
export function StatusBadge({ status, tone = "light" }: { status: ExtensionStatus; tone?: "light" | "dark" }) {
  const available = status === "available"
  const style = available
    ? tone === "dark" ? "bg-[#7FA98A]/15 text-[#A8D0B2] ring-[#7FA98A]/35" : "bg-(color:--mkt-green)/10 text-(color:--mkt-green) ring-(color:--mkt-green)/25"
    : tone === "dark" ? "bg-[#F0C27B]/15 text-[#F0C27B] ring-[#F0C27B]/30" : "bg-(color:--mkt-gold)/15 text-(color:--mkt-bronze) ring-(color:--mkt-bronze)/25"
  return <span data-extension-status={status} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wider ring-1 ${style}`}>{STATUS_LABEL[status]}</span>
}

/** The call to action for an extension: its page (and trial) when available, early access while coming soon. */
function primaryAction(extension: Extension, onIndex: boolean): { href: string; label: string } {
  if (extension.status === "available") {
    if (extension.id === "sharepoint") return onIndex ? { href: extension.href, label: "See the SharePoint extension" } : { href: SHAREPOINT_TRIAL.path, label: `Start a ${SHAREPOINT_TRIAL.days}-day free trial` }
    return onIndex ? { href: extension.href, label: `See the ${extension.name} extension` } : { href: "/contact", label: "Buy or ask a question" }
  }
  return { href: "/contact", label: "Ask about early access" }
}

function Price({ extension, size = "md" }: { extension: Extension; size?: "md" | "lg" }) {
  return (
    <div>
      <p className={`font-display font-bold tracking-tight ${size === "lg" ? "text-5xl" : "text-4xl"}`}>{extension.price.amount}<span className="ml-1 text-base font-semibold text-(color:--mkt-muted)">{extension.price.currency}</span></p>
      <p className="mt-1 text-sm text-(color:--mkt-text)">{extension.price.unit}</p>
    </div>
  )
}

function ExtensionCard({ extension }: { extension: Extension }) {
  const Icon = ICONS[extension.id]
  const action = primaryAction(extension, true)
  const detailsHref = extension.href
  const headingId = `extension-${extension.id}`
  return (
    <article aria-labelledby={headingId} className="flex h-full flex-col rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) p-6 shadow-[0_30px_80px_-50px_rgba(16,14,11,0.35)] sm:p-7" data-reveal data-extension={extension.id}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2A251E] to-[#14110D] text-[#F0C27B] shadow-lg"><Icon size={22} aria-hidden="true" /></span>
        <StatusBadge status={extension.status} />
      </div>
      <h3 id={headingId} className="mt-5 font-display text-2xl font-bold tracking-tight"><Link href={detailsHref} className="hover:underline">{extension.name}</Link></h3>
      <p className="mt-1 text-sm font-medium text-(color:--mkt-bronze)">{extension.tagline}</p>
      <p className="mt-3 text-sm leading-6 text-(color:--mkt-text)">{extension.summary}</p>

      <div className="mt-5 border-t border-(color:--mkt-ink)/[0.07] pt-5"><Price extension={extension} /></div>

      <dl className="mt-5 space-y-4 text-sm leading-6">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Who it&rsquo;s for</dt>
          <dd className="mt-1 text-(color:--mkt-text)">{extension.audience}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Key capabilities</dt>
          <dd>
            <ul className="mt-2 space-y-1.5 text-(color:--mkt-text)">
              {extension.capabilities.map((item) => <li key={item} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>)}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Deployment</dt>
          <dd>
            <ul className="mt-1 space-y-1 text-(color:--mkt-text)">
              {extension.deployment.map((item) => <li key={item.label}><strong className="font-semibold text-(color:--mkt-ink)">{item.label}:</strong> {item.detail}</li>)}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Free in the core</dt>
          <dd className="mt-1 text-(color:--mkt-text)">{extension.freeInCore}</dd>
        </div>
      </dl>

      <div className="mt-auto pt-7">
        <Link href={action.href} className="mkt-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid={`extension-cta-${extension.id}`}>{action.label} <ArrowRight size={16} aria-hidden="true" /></Link>
        {action.href !== detailsHref && <Link href={detailsHref} className="mt-3 inline-flex w-full items-center justify-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">Details <ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>
    </article>
  )
}

/** Dark mini-cards in the hero: name, status and price at a glance. */
function HeroOverview() {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {EXTENSIONS.map((extension) => {
        const Icon = ICONS[extension.id]
        return (
          <li key={extension.id}>
            <a href={`#extension-${extension.id}`} className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#fff]/[0.04] p-5 text-[#F4EFE4] transition-colors hover:border-white/25">
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold"><Icon size={17} className="text-[#F0C27B]" aria-hidden="true" />{extension.name}</span>
                <StatusBadge status={extension.status} tone="dark" />
              </span>
              <span className="mt-2 flex-1 text-sm leading-6 text-[#C9BFAE]">{extension.tagline}</span>
              <span className="mt-4 font-display text-2xl font-bold text-white">{extension.price.amount} <span className="text-sm font-semibold text-[#A89E8C]">USD {extension.price.unit}</span></span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

const LICENSING_ICONS = [GitBranch, WifiOff, FileKey2, ShieldCheck]

export function ExtensionsPage() {
  const baseUrl = publicBaseUrl()
  const path = EXTENSIONS_PAGE.path
  const jsonLd = [
    webPageNode(baseUrl, path, { name: EXTENSIONS_PAGE.title, description: EXTENSIONS_PAGE.description, updated: EXTENSIONS_UPDATED, type: "CollectionPage" }),
    breadcrumbNode(baseUrl, [{ name: EXTENSIONS_PAGE.eyebrow, path }]),
    {
      "@type": "ItemList",
      "@id": `${baseUrl}${path}#extensions`,
      name: "UserTasks extensions",
      itemListElement: EXTENSIONS.map((extension, index) => ({ "@type": "ListItem", position: index + 1, item: extensionProductNode(baseUrl, extension) })),
    },
    faqNode(EXTENSIONS_FAQS),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb="Extensions"
          eyebrow="Extensions · paid add-ons"
          icon={Puzzle}
          title={<>An open-source core. <span className="mkt-gradient-text">Extensions when you need more.</span></>}
          intro={<>UserTasks is open source under <strong className="text-white">Apache-2.0</strong> and complete on its own. Three paid extensions add what some organizations need on top: SharePoint Server integration, infrastructure you choose for each service, and processing on separate runners.</>}
          primary={{ href: "#extensions", label: "Compare the extensions" }}
          secondary={{ href: "/open-source", label: "About the open-source core" }}
          bullets={["Core: Apache-2.0, free to run", "Licences verified offline, air-gapped ready", "Prices in USD, per year"]}
          visual={<HeroOverview />}
        />

        <section aria-labelledby="summary-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">In short</p>
              <h2 id="summary-title" className="mt-3 font-display text-3xl font-bold tracking-tight">What an extension is</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">{EXTENSIONS_PAGE.definition}</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {LICENSING_FACTS.map((fact, index) => {
                const Icon = LICENSING_ICONS[index % LICENSING_ICONS.length]
                return (
                  <li key={fact} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5 text-sm leading-6 text-(color:--mkt-text)" data-reveal>
                    <Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />
                    <p className="mt-2">{fact}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>

        <section id="extensions" aria-label="The extensions" className="scroll-mt-20 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="The extensions" title="Three extensions, one price each." align="center">Every price is in USD, per year. SharePoint is available today; Infrastructure and Processing are being finished.</SectionHeading>
            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              {EXTENSIONS.map((extension) => <div key={extension.id} id={`extension-${extension.id}`} className="scroll-mt-24"><ExtensionCard extension={extension} /></div>)}
            </div>
          </div>
        </section>

        <div className="border-t border-(color:--mkt-ink)/[0.07]">
          <FaqList faqs={EXTENSIONS_FAQS} />
        </div>

        <section className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/sharepoint" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint extension <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/docs/self-hosting/licensing" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Licences for paid extensions (docs) <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/docs/developers/extensions" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">How extensions work (docs) <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/open-source" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Open source <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href="/contact" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Contact us <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
            <p className="mt-8 text-xs leading-5 text-(color:--mkt-muted)">{TRADEMARKS}</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}

function DeploymentCard({ icon: Icon, title, children }: { icon: typeof Server; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
      <h3 className="flex items-center gap-2 text-lg font-semibold"><Icon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />{title}</h3>
      <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{children}</p>
    </div>
  )
}

/** /extensions/<id> for the extensions without a page of their own elsewhere (not SharePoint). */
export function ExtensionDetailPage({ extension }: { extension: Extension }) {
  const baseUrl = publicBaseUrl()
  const path = extension.href
  const Icon = ICONS[extension.id]
  const action = primaryAction(extension, false)
  const comingSoon = extension.status === "coming-soon"
  const others = EXTENSIONS.filter((other) => other.id !== extension.id)
  const jsonLd = [
    webPageNode(baseUrl, path, { name: extension.page.title, description: extension.page.description, updated: EXTENSIONS_UPDATED }),
    breadcrumbNode(baseUrl, [{ name: EXTENSIONS_PAGE.eyebrow, path: EXTENSIONS_PAGE.path }, { name: extension.name, path }]),
    extensionProductNode(baseUrl, extension),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb={`Extensions / ${extension.name}`}
          eyebrow={`${extension.name} extension · ${STATUS_LABEL[extension.status]}`}
          icon={Icon}
          title={<>{extension.name}. <span className="mkt-gradient-text">{extension.tagline}</span></>}
          intro={<>{extension.summary} {comingSoon && <strong className="text-white">Coming soon: contact us for early access.</strong>}</>}
          primary={action}
          secondary={{ href: "/extensions", label: "All extensions" }}
          bullets={[`${extension.price.amount} USD ${extension.price.unit}`, ...extension.deployment.map((item) => item.label), "Licence verified offline"]}
        />

        <section aria-labelledby="who-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">{extension.name} extension</p>
              <h2 id="who-title" className="mt-3 font-display text-3xl font-bold tracking-tight">Who it&rsquo;s for</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">{extension.audience}</p>
            </div>
            <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Free in the open-source core</p>
              <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{extension.freeInCore} The extension adds the rest. UserTasks itself stays open source under Apache-2.0.</p>
            </div>
          </div>
        </section>

        <section aria-label="Key capabilities" className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Key capabilities" title={`What the ${extension.name} extension does.`} />
            <div className="max-w-3xl"><CheckList items={extension.capabilities} /></div>
          </div>
        </section>

        <section aria-label="Deployment" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Deployment" title="Where it runs." />
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {extension.deployment.map((item) => <DeploymentCard key={item.label} icon={item.label === "UserTasks Cloud" ? Cloud : Server} title={item.label}>{item.detail}</DeploymentCard>)}
            </div>
          </div>
        </section>

        <section id="pricing" aria-label="Pricing" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Pricing" title="One price per deployment." align="center" />
            <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) shadow-[0_30px_80px_-40px_rgba(16,14,11,0.35)]">
              <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{extension.name} extension <StatusBadge status={extension.status} /></p>
                  <div className="mt-3"><Price extension={extension} size="lg" /></div>
                  <Link href={action.href} className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid="pricing-cta">{action.label} <ArrowRight size={16} aria-hidden="true" /></Link>
                  <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">{comingSoon ? "Coming soon. Tell us about your deployment and we'll be in touch about early access." : "UserTasks itself is open source and free to self-host. The extension is the paid part."}</p>
                </div>
                <ul className="space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                  {LICENSING_FACTS.map((fact) => <li key={fact} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{fact}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="others-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="others-title" className="font-display text-2xl font-bold tracking-tight">The other extensions</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {others.map((other) => {
                const OtherIcon = ICONS[other.id]
                return (
                  <li key={other.id}>
                    <Link href={other.href} className="mkt-lift flex h-full items-start gap-4 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 hover:border-(color:--mkt-bronze)/40">
                      <OtherIcon size={20} className="mt-0.5 shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />
                      <span>
                        <span className="flex flex-wrap items-center gap-2 font-semibold">{other.name} <StatusBadge status={other.status} /></span>
                        <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{other.tagline}</span>
                        <span className="mt-1 block text-sm font-semibold">{other.price.amount} USD {other.price.unit}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            <p className="mt-8 text-xs leading-5 text-(color:--mkt-muted)">{TRADEMARKS}</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
