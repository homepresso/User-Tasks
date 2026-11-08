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
import { MobileMenu, type NavLink } from "@/components/marketing/mobile-menu"
import { repositoryUrl } from "@/lib/site-links"

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

export function SectionHeading({ eyebrow, title, children, as: Heading = "h2" }: { eyebrow: string; title: ReactNode; children?: ReactNode; as?: "h1" | "h2" }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">{eyebrow}</p>
      <Heading className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</Heading>
      {children && <p className="mt-4 mkt-body text-(color:--mkt-text)">{children}</p>}
    </div>
  )
}

export function Shot({ name, alt, sizes, priority = false }: { name: ScreenshotName; alt: string; sizes: string; priority?: boolean }) {
  return (
    <ScreenshotFrame>
      <Image src={SCREENSHOTS[name]} alt={alt} sizes={sizes} priority={priority} placeholder="blur" className="h-auto w-full" />
    </ScreenshotFrame>
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

const NAV_ITEM = "whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-(color:--mkt-text) hover:text-(color:--mkt-ink) xl:px-3"

/**
 * Main navigation of every public page: Workflows, Forms, Documents, Media,
 * Agent, Integrations, Gallery, Deploy, Docs (GitHub from xl). Below lg a Menu
 * button opens all of them plus Use cases and Contact; Docs and Sign in stay
 * visible at every width.
 */
export function SiteNav() {
  const repoUrl = repositoryUrl()
  const links: NavLink[] = [
    { href: "/workflows", label: "Workflows" },
    { href: "/forms", label: "Forms" },
    { href: "/documents", label: "Documents" },
    { href: "/media", label: "Media" },
    { href: "/ai-assistants", label: "Agent" },
    { href: "/connectors", label: "Integrations" },
    { href: "/gallery", label: "Gallery" },
    { href: "/deploy-anywhere", label: "Deploy" },
    { href: "/docs", label: "Docs" },
    { href: "/use-cases", label: "Use cases" },
    { href: "/contact", label: "Contact" },
    ...(repoUrl ? [{ href: repoUrl, label: "GitHub", external: true }] : []),
  ]
  return (
    <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6" aria-label="Main">
      <Link href="/" aria-label="UserTasks home"><Wordmark size={34} /></Link>
      <div className="flex items-center gap-1 sm:gap-1.5">
        <Link href="/workflows" className={`hidden lg:inline ${NAV_ITEM}`}>Workflows</Link>
        <Link href="/forms" className={`hidden lg:inline ${NAV_ITEM}`}>Forms</Link>
        <Link href="/documents" className={`hidden lg:inline ${NAV_ITEM}`}>Documents</Link>
        <Link href="/media" className={`hidden lg:inline ${NAV_ITEM}`}>Media</Link>
        <Link href="/ai-assistants" className={`hidden lg:inline ${NAV_ITEM}`}>Agent</Link>
        <Link href="/connectors" className={`hidden lg:inline ${NAV_ITEM}`}>Integrations</Link>
        <Link href="/gallery" className={`hidden sm:inline ${NAV_ITEM}`}>Gallery</Link>
        <Link href="/deploy-anywhere" className={`hidden lg:inline ${NAV_ITEM}`}>Deploy</Link>
        <Link href="/docs" className={NAV_ITEM}>Docs</Link>
        {repoUrl && <a href={repoUrl} className={`hidden xl:inline ${NAV_ITEM}`}>GitHub</a>}
        <MobileMenu links={links} />
        <Link href="/login" className="ml-1 whitespace-nowrap rounded-lg bg-(color:--mkt-primary) px-3 py-2 text-sm font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover) sm:px-4">Sign in</Link>
      </div>
    </nav>
  )
}

/** Header for public pages other than the landing page. */
export function MarketingHeader() {
  return (
    <header className="relative z-20 border-b border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper)/95">
      <SiteNav />
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-(color:--mkt-ink)/[0.07]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
        <Wordmark size={26} />
        <p className="text-xs text-(color:--mkt-subtle)">Open-source headless workflow engine · Apache-2.0 · © {new Date().getFullYear()} UserTasks</p>
        <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-(color:--mkt-muted)">
          <Link href="/workflows" className="hover:text-(color:--mkt-ink)">Workflows</Link>
          <Link href="/forms" className="hover:text-(color:--mkt-ink)">Forms</Link>
          <Link href="/documents" className="hover:text-(color:--mkt-ink)">Documents</Link>
          <Link href="/media" className="hover:text-(color:--mkt-ink)">Media</Link>
          <Link href="/ai-assistants" className="hover:text-(color:--mkt-ink)">Agent</Link>
          <Link href="/connectors" className="hover:text-(color:--mkt-ink)">Integrations</Link>
          <Link href="/use-cases" className="hover:text-(color:--mkt-ink)">Use cases</Link>
          <Link href="/gallery" className="hover:text-(color:--mkt-ink)">Package gallery</Link>
          <Link href="/deploy-anywhere" className="hover:text-(color:--mkt-ink)">Deploy anywhere</Link>
          <Link href="/docs" className="hover:text-(color:--mkt-ink)">Docs</Link>
          <Link href="/docs/api-explorer" className="hover:text-(color:--mkt-ink)">API Explorer</Link>
          <Link href="/open-source" className="hover:text-(color:--mkt-ink)">Why open source</Link>
          <Link href="/contact" className="hover:text-(color:--mkt-ink)">Contact</Link>
          <Link href="/login" className="hover:text-(color:--mkt-ink)">Sign in</Link>
        </div>
      </div>
    </footer>
  )
}

/** Bronze pill above a page title. */
export function Pill({ icon: Icon, children }: { icon: typeof Inbox; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-(color:--mkt-bronze)/30 bg-(color:--mkt-gold)/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(color:--mkt-bronze)">
      <Icon size={13} aria-hidden="true" /> {children}
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
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <h2 className="text-center font-display text-3xl font-bold tracking-tight">Questions</h2>
      <div className="mt-8 space-y-3">
        {faqs.map((faq) => (
          <details key={faq.question} className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) p-5">
            <summary className="cursor-pointer list-none font-semibold">{faq.question}</summary>
            <p className="mt-3 text-sm leading-7 text-(color:--mkt-muted)">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/** One card in a grid of building blocks. */
export function FeatureCard({ icon: Icon, title, children }: { icon: typeof Inbox; title: string; children: ReactNode }) {
  return (
    <article className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white)/70 p-5">
      <Icon size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{children}</p>
    </article>
  )
}
