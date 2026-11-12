import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, BadgeCheck, ChevronRight, Download, ExternalLink, ShieldAlert, ShieldCheck, UsersRound } from "lucide-react"
import { formatBytes, GALLERY_ACTIONS, GALLERY_CONTROLS, GALLERY_PACKAGES, GALLERY_SIGNING } from "@/lib/gallery/site"
import type { GalleryIndexEntry } from "@/lib/gallery/types"
import { repositoryUrl } from "@/lib/site-links"

/**
 * Building blocks of the gallery's detail pages (solutions, form controls,
 * workflow actions): breadcrumbs, the header, the in-page section nav and
 * the sticky install card. Server components, marketing palette.
 */

/** The package's source folder on GitHub, when the repository is public. */
export function sourceUrl(path: string): string | null {
  const repo = repositoryUrl()
  return repo ? `${repo}/tree/main/${path.replace(/^\/+/, "")}` : null
}

export const H2 = "font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl"

export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
}

export function GalleryBreadcrumbs({ trail }: { trail: Array<{ label: string; href?: string }> }) {
  const items = [{ label: "UserTasks", href: "/" }, ...trail]
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-(color:--mkt-muted)">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="inline-flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-(color:--mkt-faint)" />}
            {item.href && i < items.length - 1
              ? <Link href={item.href} className="rounded hover:text-(color:--mkt-bronze) hover:underline">{item.label}</Link>
              : <span aria-current="page" className="truncate font-medium text-(color:--mkt-ink-soft)">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** All · Form controls · Workflow actions: the gallery's own pages (index pages of controls and actions). */
export function GalleryTabs({ active }: { active: "packages" | "controls" | "actions" }) {
  const tabs = [
    { id: "packages", href: "/gallery", label: "Everything", count: GALLERY_PACKAGES.length + GALLERY_CONTROLS.length + GALLERY_ACTIONS.length },
    { id: "controls", href: "/gallery/controls", label: "Form controls", count: GALLERY_CONTROLS.length },
    ...(GALLERY_ACTIONS.length ? [{ id: "actions", href: "/gallery/actions", label: "Workflow actions", count: GALLERY_ACTIONS.length }] : []),
  ] as const
  return (
    <nav aria-label="Gallery sections" className="mt-5 flex flex-wrap gap-2" data-testid="gallery-tabs">
      {tabs.map((tab) => {
        const on = tab.id === active
        return (
          <Link key={tab.id} href={tab.href} aria-current={on ? "page" : undefined}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-ui font-semibold transition-colors ${on ? "border-(color:--mkt-primary) bg-(color:--mkt-primary) text-(color:--mkt-paper)" : "border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) text-(color:--mkt-text) hover:border-(color:--mkt-ink)/30"}`}>
            {tab.label} <span className={`num text-xs ${on ? "text-(color:--mkt-gold-light)" : "text-(color:--mkt-subtle)"}`}>{tab.count}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/** The header of a detail page: icon, eyebrow, the page's one h1, summary, badges and the primary actions. */
export function DetailHero({ breadcrumbs, icon, eyebrow, title, subtitle, byline, summary, badges, actions }: {
  breadcrumbs: ReactNode
  icon: ReactNode
  eyebrow: string
  title: string
  subtitle?: ReactNode
  /** A line under the title in body type (the author of a community package). */
  byline?: ReactNode
  summary: string
  badges: ReactNode
  actions: ReactNode
}) {
  return (
    <section className="relative overflow-hidden border-b border-(color:--mkt-ink)/[0.06]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_90%_at_30%_0%,rgba(176,138,84,0.15),transparent_70%)]" />
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-10">
        {breadcrumbs}
        <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-start">
          <span aria-hidden="true" className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl border border-(color:--mkt-gold)/25 bg-(color:--mkt-white) text-(color:--mkt-bronze) shadow-[0_10px_30px_-16px_rgba(138,109,69,0.6)]">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">{eyebrow}</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">{title}</h1>
            {subtitle && <div className="mt-2 break-words font-mono text-sm text-(color:--mkt-muted)">{subtitle}</div>}
            {byline && <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(color:--mkt-text)" data-testid="detail-byline">{byline}</div>}
            <p className="mkt-body mt-4 max-w-3xl text-(color:--mkt-text)">{summary}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="detail-badges">{badges}</div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="detail-actions">{actions}</div>
          </div>
        </div>
      </div>
    </section>
  )
}

export const primaryButton = "mkt-btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-2"
export const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-5 py-3 text-sm font-semibold text-(color:--mkt-ink-soft) outline-none transition-colors hover:border-(color:--mkt-ink)/30 focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)"

/** "Install in your workspace" (the install section) and "View source on GitHub" when the repository is public. */
export function HeroActions({ source }: { source: string | null }) {
  return (
    <>
      <a href="#install" className={primaryButton} data-testid="install-cta">Install in your workspace <ArrowRight size={15} aria-hidden="true" /></a>
      {source && <a href={source} className={secondaryButton} data-testid="view-source" rel="noopener">View source on GitHub <ExternalLink size={14} aria-hidden="true" /></a>}
    </>
  )
}

export function Pill({ children, mono = false }: { children: ReactNode; mono?: boolean }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) px-3 py-1 text-sm text-(color:--mkt-text) ${mono ? "font-mono" : ""}`}>{children}</span>
}

/** Publisher badge: Official (built by the UserTasks team, signed with the gallery key). */
export function OfficialPublisher({ signed }: { signed: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-(color:--mkt-green)/[0.12] px-3 py-1 text-sm font-semibold text-[#2F5A3B] ring-1 ring-inset ring-(color:--mkt-green)/30" data-testid="origin-official" title="Built and maintained by the UserTasks team from the sources in the repository.">
      <BadgeCheck size={14} aria-hidden="true" /> Official · UserTasks{signed ? " · Signed" : ""}
    </span>
  )
}

/**
 * Publisher badge: Community (shared by a UserTasks user, checked automatically
 * and approved by a moderator; not built or signed by the UserTasks team).
 */
export function CommunityPublisher() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#6B4E8E]/[0.1] px-3 py-1 text-sm font-semibold text-[#4F3870] ring-1 ring-inset ring-[#6B4E8E]/30" data-testid="origin-community" title="Shared by a member of the UserTasks community and approved by a moderator after automatic validation. Not built or signed by the UserTasks team.">
      <UsersRound size={14} aria-hidden="true" /> Community · Unverified publisher
    </span>
  )
}

/** The page's in-page sections, as a sticky horizontal nav (anchors only: no JS). */
export function SectionNav({ sections }: { sections: Array<{ id: string; label: string }> }) {
  return (
    <nav aria-label="On this page" className="sticky top-16 z-20 border-b border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-paper)/90 backdrop-blur supports-[backdrop-filter]:bg-(color:--mkt-paper)/75" data-testid="section-nav">
      <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none]">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a href={`#${s.id}`} className="inline-flex h-11 items-center border-b-2 border-transparent px-3 text-sm font-medium text-(color:--mkt-muted) outline-none transition-colors hover:border-(color:--mkt-ink)/25 hover:text-(color:--mkt-ink) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(color:--mkt-bronze)">{s.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Main column and the sticky install card. */
export function DetailLayout({ children, aside }: { children: ReactNode; aside: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:py-12">
      <div className="min-w-0 space-y-16">{children}</div>
      <aside className="order-first lg:order-none" aria-label="Install">
        <div className="lg:sticky lg:top-32">{aside}</div>
      </aside>
    </div>
  )
}

/** A titled section of the main column. */
export function DetailSection({ id, eyebrow, title, intro, children, testId }: { id: string; eyebrow: string; title: string; intro?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-32" data-testid={testId ?? `section-${id}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">{eyebrow}</p>
      <h2 id={`${id}-heading`} className={`mt-2 ${H2}`}>{title}</h2>
      {intro && <div className="mt-3 max-w-3xl text-sm leading-7 text-(color:--mkt-text)">{intro}</div>}
      <div className="mt-6">{children}</div>
    </section>
  )
}

/**
 * The install card: download (the same file link as before), install steps
 * and the facts people check before installing. Sticky beside the content on
 * desktop; first under the header on mobile.
 */
export function InstallCard({ file, downloadTestId, facts, source, signature, intro, downloadName, children }: {
  file: Pick<GalleryIndexEntry, "file" | "file_name" | "size_bytes" | "signed">
  downloadTestId: string
  facts: Array<{ label: string; value: ReactNode }>
  source: string | null
  /** Replaces the Signature row's value (community packages are signed by their author, not the gallery key). */
  signature?: ReactNode
  /** Replaces the line under "Install". */
  intro?: ReactNode
  /** The download attribute; null leaves it off (the server names the file). Defaults to file_name. */
  downloadName?: string | null
  children?: ReactNode
}) {
  return (
    <div className="mkt-ring overflow-hidden shadow-[0_24px_48px_-32px_rgba(27,25,22,0.45)]" data-testid="install-card">
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)">Install</p>
        <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{intro ?? "Free for UserTasks cloud and self-hosted. Nothing runs until you finish setup."}</p>
        <div className="mt-4 grid gap-2">
          <a href="#install" className={primaryButton}>Install in your workspace</a>
          <a href={file.file} download={downloadName === undefined ? file.file_name : downloadName ?? undefined} data-testid={downloadTestId} className={secondaryButton}>
            <Download size={15} aria-hidden="true" /> Download .utpkg <span className="num font-normal text-(color:--mkt-muted)">{formatBytes(file.size_bytes)}</span>
          </a>
          {source && <a href={source} rel="noopener" className="inline-flex items-center justify-center gap-1.5 py-1.5 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">View source on GitHub <ExternalLink size={13} aria-hidden="true" /></a>}
        </div>
      </div>
      <dl className="grid gap-3 border-t border-(color:--mkt-ink)/[0.07] bg-(color:--mkt-paper)/60 p-5 text-sm">
        {facts.map((f) => (
          <div key={f.label} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-(color:--mkt-muted)">{f.label}</dt>
            <dd className="min-w-0 text-right font-medium text-(color:--mkt-ink-soft)">{f.value}</dd>
          </div>
        ))}
        <div className="flex items-start justify-between gap-4">
          <dt className="shrink-0 text-(color:--mkt-muted)">Signature</dt>
          <dd className="inline-flex items-center gap-1.5 text-right font-medium text-(color:--mkt-ink-soft)">
            {signature ?? (file.signed ? <><ShieldCheck size={14} className="text-(color:--mkt-green)" aria-hidden="true" /> {GALLERY_SIGNING.key_name}</> : <><ShieldAlert size={14} className="text-(color:--mkt-gold-deep)" aria-hidden="true" /> Unsigned preview</>)}
          </dd>
        </div>
      </dl>
      {children && <div className="border-t border-(color:--mkt-ink)/[0.07] p-5">{children}</div>}
    </div>
  )
}

/** The changelog, newest first. */
export function VersionHistory({ changelog, current }: { changelog: Array<{ version: string; date: string; notes: string }>; current: string }) {
  const entries = [...changelog].sort((a, b) => b.date.localeCompare(a.date) || b.version.localeCompare(a.version, undefined, { numeric: true }))
  return (
    <ol className="relative space-y-4 border-l border-(color:--mkt-ink)/[0.1] pl-6" data-testid="version-history">
      {entries.map((c) => (
        <li key={`${c.version}-${c.date}`} className="relative">
          <span aria-hidden="true" className={`absolute -left-[31px] top-1.5 size-2.5 rounded-full ring-4 ring-(color:--mkt-paper) ${c.version === current ? "bg-(color:--mkt-gold)" : "bg-(color:--mkt-faint)"}`} />
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-semibold text-(color:--mkt-ink)">v{c.version}</span>
            <time dateTime={c.date} className="text-sm text-(color:--mkt-muted)">{formatDate(c.date)}</time>
            {c.version === current && <span className="rounded-full bg-(color:--mkt-gold)/[0.16] px-2 py-0.5 text-2xs font-semibold text-[#6F522B]">Latest</span>}
          </p>
          <p className="mt-1 text-sm leading-6 text-(color:--mkt-text)">{c.notes}</p>
        </li>
      ))}
    </ol>
  )
}

/** 2026-10-26 → 26 Oct 2026 (fixed locale and time zone: identical on the server and in tests). */
export function formatDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}
