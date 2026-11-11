"use client"

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import Link from "next/link"
import {
  ArrowRight, ArrowUpRight, BookOpen, Bot, Briefcase, Building2, ChevronDown, Code2, Files, GitFork, GraduationCap, Handshake, Inbox, Laptop, List, Mail, Menu,
  Package, Play, Plug, Scale, Server, ShieldCheck, Sparkles, Terminal, Users, Wallet, Waves, X,
} from "lucide-react"
import { Wordmark } from "@/components/brand/logo"
import { NavArt } from "@/components/marketing/nav-art"
import {
  ANNOUNCEMENT, DEMO_HREF, PRODUCT_FEATURE, PRODUCT_MORE, PRODUCT_TILES, RESOURCES, SOLUTIONS_BY_TEAM, SOLUTIONS_BY_USE_CASE, START_HREF,
  type MenuItem, type NavIconName,
} from "@/lib/marketing-nav"

const ICONS: Record<NavIconName, typeof Inbox> = {
  book: BookOpen, graduation: GraduationCap, package: Package, sparkles: Sparkles, server: Server, github: GitFork, terminal: Terminal, mail: Mail,
  scale: Scale, shield: ShieldCheck, users: Users, wallet: Wallet, laptop: Laptop, building: Building2, handshake: Handshake, briefcase: Briefcase,
  inbox: Inbox, bot: Bot, plug: Plug, list: List, files: Files, waves: Waves, code: Code2,
}

type MenuId = "product" | "solutions" | "resources"
export type HeaderTone = "paper" | "night"

/**
 * The public site's header (Ghost-style structure, our own look): a thin
 * announcement bar, then a sticky bar with the Product, Solutions and
 * Resources mega menus, Open source, Sign in, "See a demo" and "Start free".
 *
 * Menus open on hover (mouse) and on click or Enter/Space/ArrowDown; Escape
 * closes and returns focus to the trigger; focus leaving the header closes.
 * Panels stay in the DOM (inert while closed) so their links are in the
 * server-rendered HTML. Below lg a Menu button opens a full-height sheet:
 * product tiles, a flat link list, then the call to action.
 *
 * `tone="night"` starts transparent over a dark hero and turns into dark
 * glass on scroll; `paper` starts on the cream page.
 */
export function SiteHeader({ repoUrl, tone = "paper", announce = true }: { repoUrl: string | null; tone?: HeaderTone; announce?: boolean }) {
  const [open, setOpen] = useState<MenuId | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [sheetTop, setSheetTop] = useState(64)
  const closeTimer = useRef<number | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const triggers = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})

  // A night header turns into the paper one once the dark hero has scrolled away.
  const [pastHero, setPastHero] = useState(false)
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
      const hero = document.querySelector("[data-hero-night]")
      setPastHero(hero ? hero.getBoundingClientRect().bottom <= 64 : false)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const night = tone === "night" && !pastHero

  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(null), 160) }

  const close = useCallback((focusTrigger: boolean) => {
    setOpen((current) => {
      if (current && focusTrigger) triggers.current[current]?.focus()
      return null
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(true) }
    const onPointer = (event: PointerEvent) => { if (headerRef.current && !headerRef.current.contains(event.target as Node)) setOpen(null) }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer) }
  }, [open, close])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false) }
    document.addEventListener("keydown", onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow }
  }, [mobileOpen])

  const solid = scrolled || open !== null || mobileOpen
  const bar = night
    ? solid ? "bg-[#100E0B]/92 border-white/10 backdrop-blur-xl backdrop-saturate-150" : "bg-[#100E0B] border-transparent"
    : solid ? "bg-(color:--mkt-paper)/85 border-(color:--mkt-ink)/[0.08] backdrop-blur-xl backdrop-saturate-150" : "bg-(color:--mkt-paper) border-transparent"
  const text = night ? "text-[#E9E1D2] hover:text-white" : "text-(color:--mkt-text) hover:text-(color:--mkt-ink)"

  const menuProps = (id: MenuId) => ({
    id,
    open: open === id,
    night,
    onOpen: () => { cancelClose(); setOpen(id) },
    onToggle: () => { cancelClose(); setOpen((current) => (current === id ? null : id)) },
    onHoverLeave: scheduleClose,
    onClose: () => close(true),
    triggerRef: (element: HTMLButtonElement | null) => { triggers.current[id] = element },
    textClass: text,
  })

  return (
    <>
      {announce && (
        <div className={`relative z-40 ${night ? "bg-[#100E0B] text-[#E9E1D2]" : "bg-(color:--mkt-night) text-[#F4EFE4]"} border-b border-white/[0.06]`} style={night ? undefined : { background: "#100E0B" }}>
          <Link href={ANNOUNCEMENT.href} className="group mx-auto flex h-9 max-w-6xl items-center justify-center gap-2 px-4 text-[13px] sm:px-6">
            <span className="rounded-full bg-gradient-to-r from-[#F3C77F] to-[#E0A158] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1B1406]">{ANNOUNCEMENT.label}</span>
            <span className="truncate text-[#E9E1D2]">{ANNOUNCEMENT.text}</span>
            <span className="hidden items-center gap-1 font-semibold text-[#F0C27B] sm:inline-flex">{ANNOUNCEMENT.cta}<ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
          </Link>
        </div>
      )}
      <header
        ref={headerRef}
        className="sticky top-0 z-50"
        style={night ? ({ "--theme-card-text": "#F4EFE4" } as React.CSSProperties) : undefined}
        onBlur={(event) => { if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null) }}
      >
        {/* The bar's surface is its own layer: a backdrop-filter on the header itself would trap the fixed mobile sheet. */}
        <div aria-hidden="true" className={`absolute inset-0 -z-10 border-b transition-[background-color,border-color] duration-300 ${bar}`} />
        <nav aria-label="Main" className="relative mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link href="/" aria-label="UserTasks home" className="mr-3 shrink-0 rounded-md"><Wordmark size={32} tone={night ? "light" : "dark"} /></Link>

          <ul className="hidden items-center gap-0.5 lg:flex">
            <li><MenuTrigger {...menuProps("product")} label="Product" /></li>
            <li><MenuTrigger {...menuProps("solutions")} label="Solutions" /></li>
            <li><MenuTrigger {...menuProps("resources")} label="Resources" /></li>
            <li><Link href="/gallery" className={`rounded-lg px-3 py-2 text-sm font-medium ${text}`}>Gallery</Link></li>
            <li><Link href="/open-source" className={`rounded-lg px-3 py-2 text-sm font-medium ${text}`}>Open source</Link></li>
          </ul>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Link href="/login" className={`hidden rounded-lg px-3 py-2 text-sm font-medium sm:inline-flex ${text}`}>Sign in</Link>
            <Link href={DEMO_HREF} className={`hidden items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-semibold md:inline-flex ${night ? "border-white/15 text-[#F4EFE4] hover:border-white/35 hover:bg-[#fff]/[0.04]" : "border-(color:--mkt-ink)/15 text-(color:--mkt-ink) hover:border-(color:--mkt-ink)/35 hover:bg-(color:--mkt-white)"}`}>
              <Play size={13} aria-hidden="true" className="fill-current" /> See a demo
            </Link>
            <Link href={START_HREF} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-semibold ${night ? "mkt-btn-ember" : "mkt-btn-primary"}`}>
              Start free <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className={`inline-flex size-10 items-center justify-center rounded-lg border lg:hidden ${night ? "border-white/15 text-[#F4EFE4]" : "border-(color:--mkt-ink)/15 text-(color:--mkt-ink)"}`}
              aria-expanded={mobileOpen}
              aria-controls="mkt-mobile-menu"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => {
                // The sheet starts under the header, wherever it is (below the announcement bar until the page scrolls).
                setSheetTop(Math.round(headerRef.current?.getBoundingClientRect().bottom ?? 64))
                setMobileOpen((value) => !value)
              }}
            >
              {mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            </button>
          </div>

          <MegaPanel id="product" open={open === "product"} onEnter={cancelClose} onLeave={scheduleClose} label="Product">
            <div className="grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
              <div>
                <ul className="grid grid-cols-3 gap-3">
                  {PRODUCT_TILES.map((tile) => (
                    <li key={tile.href}>
                      <Link href={tile.href} onClick={() => setOpen(null)} className="group block rounded-2xl p-2 outline-offset-2 hover:bg-(color:--mkt-sand)">
                        <NavArt kind={tile.art} className="h-[84px] transition-transform duration-300 group-hover:scale-[1.02]" />
                        <span className="mt-3 flex items-center gap-1 px-1 text-sm font-semibold text-(color:--mkt-ink)">{tile.title}<ArrowRight size={13} className="-translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true" /></span>
                        <span className="mt-0.5 block px-1 text-[13px] font-medium text-(color:--mkt-bronze)">{tile.outcome}</span>
                        <span className="mt-0.5 block px-1 text-xs leading-5 text-(color:--mkt-muted)">{tile.description}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <ul className="mt-4 grid grid-cols-3 gap-2 border-t border-(color:--mkt-ink)/[0.07] pt-4">
                  {PRODUCT_MORE.map((item) => <li key={item.href}><MenuLink item={item} onPick={() => setOpen(null)} compact /></li>)}
                </ul>
              </div>
              <Link href={PRODUCT_FEATURE.href} onClick={() => setOpen(null)} className="group relative flex flex-col justify-end overflow-hidden rounded-2xl bg-[#100E0B] p-5 text-[#F4EFE4]">
                <FeatureVisual />
                <span className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F0C27B]">{PRODUCT_FEATURE.eyebrow}</span>
                <span className="relative mt-1 font-display text-xl font-bold leading-tight text-white">{PRODUCT_FEATURE.title}</span>
                <span className="relative mt-1 text-xs leading-5 text-[#C9BFAE]">{PRODUCT_FEATURE.description}</span>
                <span className="relative mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#F0C27B]"><Play size={13} className="fill-current" aria-hidden="true" /> Play it <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
              </Link>
            </div>
          </MegaPanel>

          <MegaPanel id="solutions" open={open === "solutions"} onEnter={cancelClose} onLeave={scheduleClose} label="Solutions">
            <div className="grid gap-6 p-6 lg:grid-cols-[1.25fr_1fr]">
              <div>
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-(color:--mkt-subtle)">By use case</p>
                <ul className="mt-2 grid grid-cols-2 gap-1">
                  {SOLUTIONS_BY_USE_CASE.map((item) => <li key={item.href}><MenuLink item={item} onPick={() => setOpen(null)} /></li>)}
                </ul>
                <Link href="/use-cases" onClick={() => setOpen(null)} className="ml-3 mt-3 inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">All use cases <ArrowRight size={13} aria-hidden="true" /></Link>
              </div>
              <div className="rounded-2xl bg-(color:--mkt-sand) p-3">
                <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-(color:--mkt-subtle)">By team · ready-made packages</p>
                <ul className="mt-2 grid gap-1">
                  {SOLUTIONS_BY_TEAM.map((item) => <li key={item.href}><MenuLink item={item} onPick={() => setOpen(null)} /></li>)}
                </ul>
              </div>
            </div>
          </MegaPanel>

          <MegaPanel id="resources" open={open === "resources"} onEnter={cancelClose} onLeave={scheduleClose} label="Resources">
            <div className="p-6">
              <ul className="grid grid-cols-3 gap-1">
                {RESOURCES.map((item) => <li key={item.href}><MenuLink item={item} onPick={() => setOpen(null)} /></li>)}
              </ul>
              {repoUrl && (
                <a href={repoUrl} className="mt-4 flex items-center justify-between rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-sand) px-4 py-3 text-sm hover:border-(color:--mkt-bronze)/40">
                  <span className="flex items-center gap-2 font-semibold text-(color:--mkt-ink)"><GitFork size={15} aria-hidden="true" /> Source code on GitHub</span>
                  <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              )}
            </div>
          </MegaPanel>
        </nav>

        <MobileSheet open={mobileOpen} onClose={() => setMobileOpen(false)} top={sheetTop} />
      </header>
    </>
  )
}

function MenuTrigger({ id, label, open, night, onOpen, onToggle, onHoverLeave, onClose, triggerRef, textClass }: {
  id: MenuId; label: string; open: boolean; night: boolean; onOpen: () => void; onToggle: () => void; onHoverLeave: () => void; onClose: () => void
  triggerRef: (element: HTMLButtonElement | null) => void; textClass: string
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      onOpen()
      // Focus the first link once the panel is no longer inert.
      window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`#mkt-menu-${id} a`)?.focus())
    } else if (event.key === "Escape" && open) {
      onClose()
    }
  }
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-expanded={open}
      aria-controls={`mkt-menu-${id}`}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") onOpen() }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") onHoverLeave() }}
      className={`group inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${textClass} ${open ? (night ? "text-white" : "text-(color:--mkt-ink)") : ""}`}
    >
      {label}
      <ChevronDown size={14} aria-hidden="true" className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
    </button>
  )
}

function MegaPanel({ id, open, onEnter, onLeave, label, children }: { id: MenuId; open: boolean; onEnter: () => void; onLeave: () => void; label: string; children: ReactNode }) {
  return (
    <div
      id={`mkt-menu-${id}`}
      role="region"
      aria-label={`${label} menu`}
      inert={!open}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") onEnter() }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse") onLeave() }}
      className={`absolute inset-x-4 top-full hidden pt-2 sm:inset-x-6 lg:block ${open ? "visible" : "invisible"}`}
    >
      <div
        className={`origin-top overflow-hidden rounded-3xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) text-(color:--mkt-ink) shadow-[0_30px_80px_-20px_rgba(16,14,11,0.35),0_0_0_1px_rgba(255,255,255,0.6)_inset] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "translate-y-0 scale-100 opacity-100" : "-translate-y-2 scale-[0.98] opacity-0"}`}
        style={{ "--theme-card-text": "var(--mkt-ink)" } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  )
}

function MenuLink({ item, onPick, compact = false }: { item: MenuItem; onPick: () => void; compact?: boolean }) {
  const Icon = ICONS[item.icon]
  return (
    <Link href={item.href} onClick={onPick} className={`group flex items-start gap-3 rounded-xl ${compact ? "p-2" : "p-3"} hover:bg-(color:--mkt-white)`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) text-(color:--mkt-bronze) shadow-sm transition-colors group-hover:border-(color:--mkt-bronze)/40 group-hover:bg-[#FFF8EC]">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-(color:--mkt-ink)">
          {item.title}
          {item.badge && <span className="rounded-full bg-gradient-to-r from-[#F3C77F] to-[#E0A158] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-[#1B1406]">{item.badge}</span>}
        </span>
        <span className="block text-xs leading-5 text-(color:--mkt-muted)">{item.description}</span>
      </span>
    </Link>
  )
}

/** Mini "the Agent building" visual on the featured card. */
function FeatureVisual() {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_80%_10%,rgba(232,178,102,0.45),transparent_60%),radial-gradient(70%_60%_at_10%_40%,rgba(139,124,246,0.35),transparent_60%)]" />
      <div className="absolute inset-x-4 top-4 space-y-1.5">
        {["Data table", "Form", "Form", "Workflow", "Report"].map((kind, index) => (
          <div key={index} className="flex items-center gap-2 rounded-md border border-white/10 bg-[#fff]/[0.06] px-2 py-1 text-[10px] text-[#E9E1D2] backdrop-blur" style={{ opacity: 1 - index * 0.14 }}>
            <span className="flex size-3 items-center justify-center rounded-full bg-[#7FA98A] text-[8px] text-[#100E0B]">✓</span>{kind}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#100E0B] via-[#100E0B]/90 to-transparent" />
    </div>
  )
}

function MobileSheet({ open, onClose, top }: { open: boolean; onClose: () => void; top: number }) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) sheetRef.current?.querySelector<HTMLElement>("a")?.focus() }, [open])
  return (
    <div
      id="mkt-mobile-menu"
      ref={sheetRef}
      inert={!open}
      aria-labelledby={titleId}
      className={`fixed inset-x-0 bottom-0 z-50 overflow-y-auto bg-(color:--mkt-paper) text-(color:--mkt-ink) transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:hidden ${open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-3 opacity-0"}`}
      style={{ top, "--theme-card-text": "var(--mkt-ink)" } as React.CSSProperties}
    >
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-4 sm:px-6">
        <p id={titleId} className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(color:--mkt-subtle)">Product</p>
        <ul className="mt-3 grid grid-cols-2 gap-3">
          {PRODUCT_TILES.map((tile) => (
            <li key={tile.href}>
              <Link href={tile.href} onClick={onClose} className="block rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-2">
                <NavArt kind={tile.art} live={open} className="h-16" />
                <span className="mt-2 block px-1 text-sm font-semibold">{tile.title}</span>
                <span className="block px-1 pb-1 text-xs leading-4 text-(color:--mkt-muted)">{tile.outcome}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <MobileGroup title="Solutions" items={[...SOLUTIONS_BY_USE_CASE.slice(0, 4), ...SOLUTIONS_BY_TEAM.slice(0, 3), { href: "/use-cases", title: "All use cases", description: "", icon: "list" }]} onPick={onClose} />
          <MobileGroup title="Resources" items={[...PRODUCT_MORE, ...RESOURCES.filter((item) => !PRODUCT_MORE.some((more) => more.href === item.href))]} onPick={onClose} />
        </div>
        <div className="mt-8 space-y-3 border-t border-(color:--mkt-ink)/[0.08] pt-6">
          <Link href={START_HREF} onClick={onClose} className="mkt-btn-primary flex items-center justify-center gap-2 rounded-xl px-5 py-3.5 font-semibold">Start free <ArrowRight size={16} aria-hidden="true" /></Link>
          <Link href={DEMO_HREF} onClick={onClose} className="flex items-center justify-center gap-2 rounded-xl border border-(color:--mkt-ink)/15 px-5 py-3.5 font-semibold"><Play size={14} className="fill-current" aria-hidden="true" /> See a demo</Link>
          <p className="text-center text-sm text-(color:--mkt-muted)">Existing customer? <Link href="/login" onClick={onClose} className="font-semibold text-(color:--mkt-ink) underline-offset-4 hover:underline">Sign in</Link></p>
        </div>
      </div>
    </div>
  )
}

function MobileGroup({ title, items, onPick }: { title: string; items: MenuItem[]; onPick: () => void }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-(color:--mkt-subtle)">{title}</p>
      <ul className="mt-2 divide-y divide-(color:--mkt-ink)/[0.06]">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} onClick={onPick} className="flex items-center justify-between py-3 text-[15px] font-medium text-(color:--mkt-ink-soft)">
              {item.title}<ArrowRight size={14} className="text-(color:--mkt-subtle)" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
