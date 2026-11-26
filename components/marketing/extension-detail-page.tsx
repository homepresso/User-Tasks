import type { CSSProperties } from "react"
import Image, { type StaticImageData } from "next/image"
import Link from "next/link"
import { ArrowRight, BookOpen, Check, Cpu, FileKey2, Layers, Server, ShieldCheck, WifiOff } from "lucide-react"
import { ProductHero } from "@/components/marketing/product-hero"
import { FaqList, MarketingFooter, MarketingHeader, SectionHeading, Snippet } from "@/components/marketing/marketing-ui"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { publicBaseUrl } from "@/lib/deployment"
import { breadcrumbNode, faqNode, jsonLdHtml, webPageNode } from "@/lib/seo/site"
import { EXTENSIONS, EXTENSIONS_PAGE, EXTENSIONS_UPDATED, STATUS_LABEL, extensionProductNode, type Extension, type ExtensionStatus } from "@/lib/seo/extensions"
import { detailFaqs, extensionDetail, type DetailId } from "@/lib/seo/extension-details"
import infrastructureSetupWizard from "@/public/screenshots/extensions/infrastructure-setup-wizard.webp"
import infrastructureStoragePlan from "@/public/screenshots/extensions/infrastructure-storage-plan.webp"
import infrastructureDatabaseSwitch from "@/public/screenshots/extensions/infrastructure-database-switch.webp"
import infrastructureSwitchLog from "@/public/screenshots/extensions/infrastructure-switch-log.webp"
import processingSettingsCard from "@/public/screenshots/extensions/processing-settings-card.webp"

/**
 * /extensions/infrastructure and /extensions/processing: the product page of
 * a platform add-on (copy: lib/seo/extension-details.ts; name, status, price
 * and structured data: lib/seo/extensions.ts). The call to action follows the
 * one `status` field: "Request early access" (to /contact with a subject)
 * until the Enterprise edition is published, then the extension's purchase
 * path. Screenshots are real UI from a self-hosted install.
 */

const IMAGES: Record<string, StaticImageData> = {
  "infrastructure-setup-wizard.webp": infrastructureSetupWizard,
  "infrastructure-storage-plan.webp": infrastructureStoragePlan,
  "infrastructure-database-switch.webp": infrastructureDatabaseSwitch,
  "infrastructure-switch-log.webp": infrastructureSwitchLog,
  "processing-settings-card.webp": processingSettingsCard,
}

const THEME = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  "--theme-muted-text": "var(--mkt-muted)",
} as CSSProperties

const ICONS: Record<DetailId, typeof Server> = { infrastructure: Layers, processing: Cpu }
const SECURITY_ICONS = [ShieldCheck, WifiOff, Server, FileKey2]

const TRADEMARKS = "Microsoft Entra ID, Microsoft 365, Exchange, Azure and AD FS are trademarks of the Microsoft group of companies; Amazon S3, Google Cloud Storage, MinIO, Kubernetes, KEDA, Prometheus and other product names are trademarks of their respective owners."

/** The call to action: early access (or coming soon) asks us; available opens the purchase path. */
export function detailAction(extension: Extension, subject: string): { href: string; label: string } {
  if (extension.status === "available") return { href: `/contact?subject=${encodeURIComponent(`${extension.name} add-on: buy`)}`, label: "Buy or ask a question" }
  return { href: `/contact?subject=${encodeURIComponent(subject)}`, label: extension.status === "early-access" ? "Request early access" : "Ask about early access" }
}

function Badge({ status }: { status: ExtensionStatus }) {
  const style = status === "available" ? "bg-(color:--mkt-green)/10 text-(color:--mkt-green) ring-(color:--mkt-green)/25" : "bg-(color:--mkt-gold)/15 text-(color:--mkt-bronze) ring-(color:--mkt-bronze)/25"
  return <span data-extension-status={status} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wider ring-1 ${style}`}>{STATUS_LABEL[status]}</span>
}

function statusNote(extension: Extension): string {
  if (extension.status === "available") return "Available in the Enterprise edition. UserTasks itself is open source and free to self-host; the extension is the paid part."
  return `${STATUS_LABEL[extension.status]}: the Enterprise edition is being prepared for release, so the ${extension.name} add-on can't be bought or downloaded yet. Request early access and we'll be in touch.`
}

function HowToNode(baseUrl: string, path: string, name: string, steps: Array<{ title: string; body: string }>): Record<string, unknown> {
  return {
    "@type": "HowTo",
    "@id": `${baseUrl}${path}#setup`,
    name,
    step: steps.map((step, index) => ({ "@type": "HowToStep", position: index + 1, name: step.title, text: step.body })),
  }
}

export function ExtensionDetailPage({ extension }: { extension: Extension }) {
  const id = extension.id as DetailId
  const detail = extensionDetail(id)
  const baseUrl = publicBaseUrl()
  const path = extension.href
  const Icon = ICONS[id]
  const action = detailAction(extension, detail.contactSubject)
  const others = EXTENSIONS.filter((other) => other.id !== extension.id)
  const [lead, ...gallery] = detail.screenshots
  const faqs = detailFaqs(detail, extension.status === "available")
  const jsonLd = [
    webPageNode(baseUrl, path, { name: extension.page.title, description: extension.page.description, updated: EXTENSIONS_UPDATED }),
    breadcrumbNode(baseUrl, [{ name: EXTENSIONS_PAGE.eyebrow, path: EXTENSIONS_PAGE.path }, { name: extension.name, path }]),
    extensionProductNode(baseUrl, extension),
    HowToNode(baseUrl, path, `Set up the UserTasks ${extension.name} add-on`, detail.setup),
    faqNode(faqs),
  ]

  return (
    <div className="mkt relative min-h-screen bg-(color:--mkt-paper) text-(color:--mkt-ink)" style={THEME} data-extension-detail={id}>
      <div className="pointer-events-none fixed inset-0 -z-10 bg-(color:--mkt-paper)" aria-hidden="true" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />
      <MarketingHeader tone="night" />
      <main>
        <ProductHero
          crumb={`Extensions / ${extension.name}`}
          eyebrow={`${extension.name} add-on · ${STATUS_LABEL[extension.status]}`}
          icon={Icon}
          title={<>{extension.name}. <span className="mkt-gradient-text">{extension.tagline}</span></>}
          intro={<>{extension.summary} <strong className="text-white">{detail.heroAudience}, on self-hosted UserTasks.</strong></>}
          primary={action}
          secondary={{ href: "#how-it-works", label: "How it works" }}
          bullets={[`${extension.price.amount} USD ${extension.price.unit}`, "Self-hosted: the Enterprise edition", "Licence verified offline"]}
          visual={lead ? <ScreenshotFrame><Image src={IMAGES[lead.file]} alt={lead.alt} sizes="(min-width: 1024px) 40vw, 100vw" priority placeholder="blur" className="h-auto w-full" /></ScreenshotFrame> : undefined}
        />

        <section aria-labelledby="status-title" className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 sm:px-6">
            <Badge status={extension.status} />
            <p id="status-title" className="min-w-[16rem] flex-1 text-sm leading-6 text-(color:--mkt-text)" data-testid="status-note">{statusNote(extension)} {detail.selfHosted}</p>
            <Link href={action.href} className="mkt-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold" data-testid="status-cta">{action.label} <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
        </section>

        <section aria-labelledby="who-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">What it is</p>
              <h2 id="who-title" className="mt-3 font-display text-3xl font-bold tracking-tight">Who it&rsquo;s for</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">{extension.audience}</p>
            </div>
            <ul className="space-y-3">
              {detail.who.map((line) => <li key={line} className="flex gap-3 rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-4 text-sm leading-6 text-(color:--mkt-text)" data-reveal><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{line}</li>)}
            </ul>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="How it works" title={<span id="how-title">{id === "infrastructure" ? "One service at a time, tested, copied and verified." : "The web app queues. Workers process."}</span>} />
            <ol className="mt-10 grid gap-4 md:grid-cols-2">
              {detail.howItWorks.map((item, index) => (
                <li key={item.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
                  <p className="font-display text-sm font-bold text-(color:--mkt-bronze)">{String(index + 1).padStart(2, "0")}</p>
                  <h3 className="mt-2 text-lg font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p>
                </li>
              ))}
            </ol>
            <h3 className="mt-12 text-sm font-semibold uppercase tracking-[0.16em] text-(color:--mkt-subtle)">Key capabilities</h3>
            <ul className="mt-4 grid gap-2 text-sm leading-6 text-(color:--mkt-text) md:grid-cols-2">
              {extension.capabilities.map((item) => <li key={item} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{item}</li>)}
            </ul>
          </div>
        </section>

        {detail.screenshots.length > 0 && (
          <section aria-labelledby="screens-title" className="border-t border-(color:--mkt-ink)/[0.07]">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
              <SectionHeading eyebrow="In the product" title={<span id="screens-title">{id === "infrastructure" ? "What a move looks like." : "Where you see it."}</span>}>Screenshots from a self-hosted UserTasks install.</SectionHeading>
              <div className={`mt-10 grid gap-8 ${gallery.length ? "lg:grid-cols-2" : ""}`}>
                {(gallery.length ? gallery : [lead]).map((shot) => (
                  <figure key={shot.file} className="mkt-glow" data-reveal data-screenshot={shot.file}>
                    <ScreenshotFrame><Image src={IMAGES[shot.file]} alt={shot.alt} sizes="(min-width: 1024px) 50vw, 100vw" placeholder="blur" className="h-auto w-full" /></ScreenshotFrame>
                    <figcaption className="mt-3 text-sm text-(color:--mkt-muted)">{shot.caption}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        <section id="setup" aria-labelledby="setup-title" className="scroll-mt-20 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Setup" title={<span id="setup-title">Get it running.</span>}>{detail.selfHosted}</SectionHeading>
            <ol className="mt-10 space-y-8">
              {detail.setup.map((step, index) => (
                <li key={step.title} className="grid gap-3 sm:grid-cols-[2.5rem_1fr]" data-setup-step={index + 1}>
                  <span className="flex size-9 items-center justify-center rounded-full bg-(color:--mkt-ink) font-display text-sm font-bold text-(color:--mkt-paper)">{index + 1}</span>
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{step.body}</p>
                    {step.code && <div className="mt-3"><Snippet code={step.code} wrap /></div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="free-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">Open source</p>
              <h2 id="free-title" className="mt-3 font-display text-3xl font-bold tracking-tight">What stays free in the core</h2>
              <p className="mt-4 mkt-body text-(color:--mkt-text)">UserTasks is open source under Apache-2.0. The add-on is the paid part; this stays free without it.</p>
            </div>
            <ul className="space-y-3 text-sm leading-6 text-(color:--mkt-text)">
              {detail.free.map((item) => <li key={item} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{item}</li>)}
            </ul>
          </div>
        </section>

        <section aria-labelledby="security-title" className="border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-sand)/60">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Security and licensing" title={<span id="security-title">Checked on your server, verified offline.</span>} />
            <div className="mt-10 grid gap-4 md:grid-cols-2">
              {detail.security.map((item, index) => {
                const ItemIcon = SECURITY_ICONS[index % SECURITY_ICONS.length]
                return (
                  <div key={item.title} className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-6" data-reveal>
                    <h3 className="flex items-center gap-2 text-lg font-semibold"><ItemIcon size={18} className="text-(color:--mkt-bronze)" aria-hidden="true" />{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-(color:--mkt-text)">{item.body}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-8 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-white)/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHeading eyebrow="Pricing" title={<span id="pricing-title">One price per deployment.</span>} align="center" />
            <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) shadow-[0_30px_80px_-40px_rgba(16,14,11,0.35)]">
              <div className="grid gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.2fr]">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">{extension.name} add-on <Badge status={extension.status} /></p>
                  <p className="mt-3 font-display text-5xl font-bold tracking-tight">{extension.price.amount}<span className="ml-1 text-base font-semibold text-(color:--mkt-muted)">{extension.price.currency}</span></p>
                  <p className="mt-1 text-sm text-(color:--mkt-text)">{extension.price.unit}</p>
                  <Link href={action.href} className="mkt-btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 font-semibold" data-testid="pricing-cta">{action.label} <ArrowRight size={16} aria-hidden="true" /></Link>
                  <p className="mt-3 text-xs leading-5 text-(color:--mkt-muted)">{statusNote(extension)}</p>
                </div>
                <ul className="space-y-2 text-sm leading-6 text-(color:--mkt-text)">
                  {[
                    "Self-hosted UserTasks only: the Enterprise edition, on your servers, on premises or air-gapped.",
                    "One image with every paid extension; this licence unlocks this add-on, with no reinstall for the next one.",
                    "A signed licence file, verified offline: no call home.",
                    "Per deployment, per year, in USD.",
                  ].map((fact) => <li key={fact} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" />{fact}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="border-t border-(color:--mkt-ink)/[0.07]">
          <FaqList faqs={faqs} />
        </div>

        <section aria-labelledby="others-title" className="border-t border-(color:--mkt-ink)/[0.07]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <p className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {detail.docs.map((doc) => <Link key={doc.href} href={doc.href} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline"><BookOpen size={14} aria-hidden="true" />{doc.label}</Link>)}
              <Link href="/extensions" className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">All extensions <ArrowRight size={14} aria-hidden="true" /></Link>
            </p>
            <h2 id="others-title" className="mt-10 font-display text-2xl font-bold tracking-tight">The other extensions</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-2">
              {others.map((other) => (
                <li key={other.id}>
                  <Link href={other.href} className="mkt-lift flex h-full flex-col rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-5 hover:border-(color:--mkt-bronze)/40">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">{other.name} <Badge status={other.status} /></span>
                    <span className="mt-1 block text-sm leading-6 text-(color:--mkt-text)">{other.tagline}</span>
                    <span className="mt-1 block text-sm font-semibold">{other.price.amount} USD {other.price.unit}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-xs leading-5 text-(color:--mkt-muted)">{TRADEMARKS}</p>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  )
}
