import type { CSSProperties, ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, Check, Cloud, Cpu, FileKey2, GitBranch, Headset, Layers, LifeBuoy, Puzzle, Server, ShieldCheck, WifiOff } from "lucide-react"
import { ExtensionsBrowser } from "@/components/marketing/extensions-browser"
import { ProductHero } from "@/components/marketing/product-hero"
import { CheckList, FaqList, MarketingFooter, MarketingHeader, SectionHeading } from "@/components/marketing/marketing-ui"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, faqNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import {
  EXTENSIONS, EXTENSIONS_FAQS, EXTENSIONS_PAGE, EXTENSIONS_UPDATED, LICENSING_FACTS, STATUS_LABEL,
  extensionProductNode, type Extension, type ExtensionId, type ExtensionStatus,
} from "@/lib/seo/extensions"
import { SHAREPOINT_TRIAL } from "@/lib/seo/sharepoint-facts"
import { CATALOGUE, EXTENSION_CATEGORIES, catalogueItemNode, type CatalogueIcon, type CatalogueItem } from "@/lib/seo/extensions-catalogue"
import { SUPPORT_PAGE } from "@/lib/seo/support"

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
  return { href: "/contact", label: extension.status === "early-access" ? "Request early access" : "Ask about early access" }
}

function Price({ extension, size = "md" }: { extension: Extension; size?: "md" | "lg" }) {
  return (
    <div>
      <p className={`font-display font-bold tracking-tight ${size === "lg" ? "text-5xl" : "text-4xl"}`}>{extension.price.amount}<span className="ml-1 text-base font-semibold text-(color:--mkt-muted)">{extension.price.currency}</span></p>
      <p className="mt-1 text-sm text-(color:--mkt-text)">{extension.price.unit}</p>
    </div>
  )
}

const CATALOGUE_ICONS: Record<CatalogueIcon, typeof Server> = { server: Server, layers: Layers, cpu: Cpu, lifebuoy: LifeBuoy, headset: Headset, puzzle: Puzzle }

const CATEGORY_LABEL = Object.fromEntries(EXTENSION_CATEGORIES.map((category) => [category.id, category.label])) as Record<string, string>

/** One gallery card: icon, status, name, one line, price and where it goes. */
function CatalogueCard({ item }: { item: CatalogueItem }) {
  const Icon = CATALOGUE_ICONS[item.icon]
  const headingId = `extension-card-${item.id}`
  return (
    <article aria-labelledby={headingId} className="mkt-lift group relative flex h-full flex-col rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) p-6 shadow-[0_24px_60px_-44px_rgba(16,14,11,0.4)] hover:border-(color:--mkt-bronze)/40" data-extension={item.id} data-extension-category={item.category}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2A251E] to-[#14110D] text-[#F0C27B] shadow-lg"><Icon size={22} aria-hidden="true" /></span>
        <StatusBadge status={item.status} />
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">{CATEGORY_LABEL[item.category]}</p>
      <h3 id={headingId} className="mt-1 font-display text-2xl font-bold tracking-tight">
        <Link href={item.href} className="outline-none after:absolute after:inset-0 after:rounded-3xl focus-visible:after:ring-2 focus-visible:after:ring-(color:--mkt-bronze)" data-testid={`extension-cta-${item.id}`}>{item.name}</Link>
      </h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-(color:--mkt-text)">{item.summary}</p>
      <div className="mt-6 flex items-end justify-between gap-3 border-t border-(color:--mkt-ink)/[0.07] pt-5">
        <div data-extension-price>
          {item.price ? (
            <p className="font-display text-2xl font-bold tracking-tight">
              {item.price.from && <span className="mr-1 text-sm font-semibold text-(color:--mkt-muted)">from</span>}
              {item.price.amount}<span className="text-sm font-semibold text-(color:--mkt-muted)">/{item.price.per}</span>
              <span className="ml-1 text-xs font-semibold text-(color:--mkt-subtle)">{item.price.currency}</span>
            </p>
          ) : <p className="font-display text-2xl font-bold tracking-tight">Contact us</p>}
          {item.price?.detail && <p className="text-xs text-(color:--mkt-muted)">{item.price.detail}</p>}
        </div>
        <span aria-hidden="true" className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze)">Details <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
      </div>
    </article>
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
      itemListElement: CATALOGUE.map((item, index) => ({ "@type": "ListItem", position: index + 1, item: catalogueItemNode(baseUrl, item) })),
    },
    faqNode(EXTENSIONS_FAQS),
  ]
  const browserItems = CATALOGUE.map((item) => ({ key: item.id, category: item.category, text: [item.name, item.summary, CATEGORY_LABEL[item.category], ...item.keywords].join(" ").toLowerCase() }))

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader />
      <main>
        <section id="extensions" aria-labelledby="extensions-title" className="relative overflow-hidden border-b border-(color:--mkt-ink)/[0.06]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(176,138,84,0.16),transparent_70%)]" />
          <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 sm:pt-12">
            <nav aria-label="Breadcrumb" className="text-xs text-(color:--mkt-muted)"><Link href="/" className="hover:text-(color:--mkt-ink)">UserTasks</Link><span className="px-2">/</span><span aria-current="page">Extensions</span></nav>
            <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-white)/70 py-1 pl-1 pr-3 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">
              <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#F3C77F] to-[#D99A52] text-[#1B1406]"><Puzzle size={13} aria-hidden="true" /></span>Extensions · add-ons and services
            </p>
            <h1 id="extensions-title" className="mt-5 max-w-4xl font-display text-4xl font-bold leading-[1.06] tracking-tight text-balance sm:text-6xl">An open-source core. <span className="mkt-gradient-text-ink">Extensions when you need more.</span></h1>
            <p className="mkt-body mt-5 max-w-3xl text-(color:--mkt-text)">UserTasks is open source under <strong className="text-(color:--mkt-ink)">Apache-2.0</strong> and complete on its own. Extensions add what some organizations need on top: integrations such as SharePoint Server, platform add-ons for your own infrastructure and runners, and services from the team that builds UserTasks.</p>
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-(color:--mkt-text)">
              {["Core: Apache-2.0, free to run", "Licences verified offline, air-gapped ready", "Prices in USD"].map((bullet) => <li key={bullet} className="flex items-center gap-2"><Check size={14} className="text-(color:--mkt-green)" aria-hidden="true" />{bullet}</li>)}
            </ul>
            <div className="mt-10">
              <ExtensionsBrowser items={browserItems} cards={CATALOGUE.map((item) => <CatalogueCard key={item.id} item={item} />)} categories={EXTENSION_CATEGORIES.map(({ id, label }) => ({ id, label }))} />
            </div>
          </div>
        </section>

        <section aria-labelledby="summary-title">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">In short</p>
              <h2 id="summary-title" className="mt-3 font-display text-3xl font-bold tracking-tight">What an extension is</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">{EXTENSIONS_PAGE.definition}</p>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">Support plans and consulting are listed here too. <Link href={SUPPORT_PAGE.path} className="font-semibold text-(color:--mkt-bronze) hover:underline">See the support plans</Link>.</p>
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

        <div className="border-t border-(color:--mkt-ink)/[0.07]">
          <FaqList faqs={EXTENSIONS_FAQS} />
        </div>

        <section className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
            <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <Link href="/sharepoint" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">SharePoint extension <ArrowRight size={14} aria-hidden="true" /></Link>
              <Link href={SUPPORT_PAGE.path} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">Support plans <ArrowRight size={14} aria-hidden="true" /></Link>
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
