import type { ReactNode } from "react"
import "./marketing-tokens.css"
import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Bot, Captions, Car, Check, FileSignature, GraduationCap, HardHat, Headset, HeartPulse, IdCard, ImageUp, Inbox, Layers, ListChecks, Plug, Route, Scale, ShieldCheck, Smile, Ticket } from "lucide-react"
import { CopyButton } from "@/components/docs/copy-button"
import { SCREENSHOTS } from "@/lib/docs/screenshots"
import type { ScreenshotName } from "@/lib/docs/screenshot-names"
import type { UseCaseIcon } from "@/lib/use-cases"
import { Wordmark } from "@/components/brand/logo"
import { ScreenshotFrame } from "@/components/marketing/screenshot-frame"
import { LanguageTag } from "@/components/docs/copy-button"
import { SiteHeader, type HeaderTone } from "@/components/marketing/site-header"
import { repositoryUrl, SOURCE_RELEASE_NOTE } from "@/lib/site-links"
import { DEMO_HREF, GUIDES, PRODUCT_MORE, PRODUCT_TILES, RESOURCES, SOLUTIONS_BY_TEAM, SOLUTIONS_BY_USE_CASE, START_HREF } from "@/lib/marketing-nav"

/**
 * Shared building blocks of the public site (landing and use-case pages):
 * cream paper, ink text, bronze accents, Fraunces headings.
 */

export const USE_CASE_ICONS: Record<UseCaseIcon, typeof Inbox> = {
  inbox: Inbox,
  shield: ShieldCheck,
  bot: Bot,
  plug: Plug,
  list: ListChecks,
  route: Route,
  layers: Layers,
  scale: Scale,
  captions: Captions,
  car: Car,
  headset: Headset,
  id: IdCard,
  image: ImageUp,
  smile: Smile,
  heart: HeartPulse,
  graduation: GraduationCap,
  hardhat: HardHat,
  ticket: Ticket,
  signature: FileSignature,
}

export function SectionHeading({ eyebrow, title, children, as: Heading = "h2", align = "left" }: { eyebrow: string; title: ReactNode; children?: ReactNode; as?: "h1" | "h2"; align?: "left" | "center" }) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-2xl"} data-reveal>
      <p className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze) ${align === "center" ? "justify-center" : ""}`}><span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-transparent to-(color:--mkt-gold)" />{eyebrow}</p>
      <Heading className="mt-3 font-display text-3xl font-bold tracking-tight text-balance sm:text-[2.75rem] sm:leading-[1.08]">{title}</Heading>
      {children && <p className="mt-4 mkt-body text-pretty text-(color:--mkt-text)">{children}</p>}
    </div>
  )
}

export function Shot({ name, alt, sizes, priority = false }: { name: ScreenshotName; alt: string; sizes: string; priority?: boolean }) {
  return (
    <div className="mkt-glow" data-reveal>
      <ScreenshotFrame>
        <Image src={SCREENSHOTS[name]} alt={alt} sizes={sizes} priority={priority} placeholder="blur" className="h-auto w-full" />
      </ScreenshotFrame>
    </div>
  )
}

export function Snippet({ code, language = "shell" }: { code: string; language?: string }) {
  return (
    <div className="overflow-hidden rounded-xl bg-(color:--mkt-code-bg)">
      <div className="flex items-center justify-between border-b border-(color:--mkt-white)/[0.08] px-4 py-1">
        <LanguageTag lang={language} />
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-ui leading-6 text-(color:--mkt-code-text)"><code className="font-mono">{code}</code></pre>
    </div>
  )
}

/**
 * Header of every public page: the announcement bar and the sticky header
 * with the Product, Solutions and Resources mega menus (site-header.tsx).
 * `tone="night"` for pages whose hero is a dark stage.
 */
export function MarketingHeader({ tone = "paper" }: { tone?: HeaderTone }) {
  return <SiteHeader repoUrl={repositoryUrl()} tone={tone} />
}

/** @deprecated Kept for older imports: the same header. */
export const SiteNav = MarketingHeader

const FOOTER_COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  { title: "Product", links: [...PRODUCT_TILES.map((tile) => ({ href: tile.href, label: tile.title })), ...PRODUCT_MORE.map((item) => ({ href: item.href, label: item.title }))] },
  { title: "Solutions", links: [...SOLUTIONS_BY_USE_CASE.map((item) => ({ href: item.href, label: item.title })), { href: "/use-cases", label: "All use cases" }] },
  { title: "By team", links: SOLUTIONS_BY_TEAM.map((item) => ({ href: item.href, label: item.title })) },
  { title: "Guides", links: GUIDES },
  { title: "Resources", links: [...RESOURCES.map((item) => ({ href: item.href, label: item.title })), { href: "/docs/api-explorer", label: "API Explorer" }] },
]

/** Footer of every public page: a closing call to action, the site map and the legal line. */
export function MarketingFooter({ cta = true }: { cta?: boolean }) {
  const repoUrl = repositoryUrl()
  return (
    <footer className="mkt-night relative overflow-hidden">
      <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0 opacity-60" />
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.22),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        {cta && (
          <div className="flex flex-col items-start justify-between gap-6 border-b border-white/10 py-14 md:flex-row md:items-end">
            <div>
              <p className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">The open source <span className="mkt-gradient-text">process platform.</span></p>
              <p className="mt-2 text-[#C9BFAE]">Open source, on your cloud or ours.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={START_HREF} className="mkt-btn-ember inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold">Start free <ArrowRight size={16} aria-hidden="true" /></Link>
              <Link href={DEMO_HREF} className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-5 py-3 font-semibold text-[#F4EFE4] hover:border-white/35">See a demo</Link>
            </div>
          </div>
        )}
        <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(5,1fr)]">
          <div>
            <Wordmark size={30} tone="light" />
            <p className="mt-4 max-w-xs text-sm leading-6 text-[#C9BFAE]">Workflows, forms, tasks and an AI Agent in one open-source platform. Run it in our cloud, or anywhere you like.</p>
            {repoUrl ? (
              <a href={repoUrl} className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-[#F4EFE4] hover:border-white/35">GitHub <ArrowRight size={14} aria-hidden="true" /></a>
            ) : (
              <p className="mt-5 inline-flex rounded-lg border border-white/10 px-3 py-2 text-xs text-[#C9BFAE]">{SOURCE_RELEASE_NOTE}</p>
            )}
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F0C27B]">{column.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {column.links.map((link) => <li key={link.href}><Link href={link.href} className="text-[#D9D0BF] hover:text-white">{link.label}</Link></li>)}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-start justify-between gap-3 border-t border-white/10 py-6 text-xs text-[#A89E8C] sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} UserTasks · Apache-2.0</p>
          <p className="flex flex-wrap gap-x-5 gap-y-1"><Link href="/contact" className="hover:text-white">Contact</Link><Link href="/login" className="hover:text-white">Sign in</Link><a href="/sitemap.xml" className="hover:text-white">Sitemap</a></p>
        </div>
      </div>
    </footer>
  )
}

/** Bronze pill above a page title. */
export function Pill({ icon: Icon, children }: { icon: typeof Inbox; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-white)/70 py-1 pl-1 pr-3 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze) shadow-sm backdrop-blur">
      <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#F3C77F] to-[#D99A52] text-[#1B1406]"><Icon size={13} aria-hidden="true" /></span> {children}
    </p>
  )
}

/** Green-check bullet list used beside screenshots. */
export function CheckList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="mt-6 space-y-2 text-sm leading-6 text-(color:--mkt-text)">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span>{item}</span></li>
      ))}
    </ul>
  )
}

/** Row of bronze "read more" links. */
export function DocLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="inline-flex items-center gap-1 font-semibold text-(color:--mkt-bronze) hover:underline">{link.label} <ArrowRight size={14} aria-hidden="true" /></Link>
      ))}
    </p>
  )
}

/** Inline code on the cream pages. */
export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-(color:--mkt-ink)/[0.06] px-1 py-0.5 font-mono text-[0.85em] text-(color:--mkt-ink-soft)">{children}</code>
}

/** FAQ accordion (the questions also go into the page's FAQPage JSON-LD). */
export function FaqList({ faqs }: { faqs: Array<{ question: string; answer: string }> }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6 sm:py-24">
      <SectionHeading eyebrow="FAQ" title="Questions, answered." align="center" />
      <div className="mt-10 divide-y divide-(color:--mkt-ink)/[0.08] overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 shadow-[0_20px_60px_-30px_rgba(27,25,22,0.25)]">
        {faqs.map((faq) => (
          <details key={faq.question} className="group px-6 py-5 open:bg-(color:--mkt-paper)">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-semibold">{faq.question}</h3>
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-(color:--mkt-ink)/10 text-(color:--mkt-bronze) transition-transform duration-300 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-(color:--mkt-text)">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** One card in a grid of building blocks. */
export function FeatureCard({ icon: Icon, title, children }: { icon: typeof Inbox; title: string; children: ReactNode }) {
  return (
    <article className="mkt-lift group relative overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/80 p-5 hover:border-(color:--mkt-bronze)/35" data-reveal>
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-[radial-gradient(closest-side,rgba(232,178,102,0.25),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="flex size-10 items-center justify-center rounded-xl border border-(color:--mkt-bronze)/20 bg-gradient-to-br from-[#FFF6E6] to-[#F5EBDA] text-(color:--mkt-bronze)"><Icon size={19} aria-hidden="true" /></span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{children}</p>
    </article>
  )
}
