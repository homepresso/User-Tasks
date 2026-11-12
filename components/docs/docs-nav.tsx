'use client'

/**
 * Docs navigation chrome (client): one provider holding the nav data, the
 * header tabs, the sidebar and its mobile drawer, the search triggers and the
 * ⌘K shortcut. The command palette itself is a separate chunk loaded on
 * first use (search-palette.tsx).
 *
 * Without JavaScript everything still navigates: the search and menu
 * triggers are links to the docs home's full index (#browse), sidebar groups
 * are <details> elements, and the server-rendered HTML carries every link.
 */

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type ReactNode,
} from 'react'
import { ArrowUpRight, ChevronRight, Menu, Monitor, Moon, Search, Sun, X } from 'lucide-react'
import type { DocsIconName, DocsTabId } from '@/lib/docs/nav'
import { DocsIcon, GitHubMark } from './icons'

export interface NavItem { title: string; href: string }
export interface NavSection { title: string; icon: DocsIconName; items: NavItem[] }
export interface NavTab { id: DocsTabId; label: string; href: string; sections: NavSection[] }
export interface NavLinks {
  /** Where the brand mark goes: the website in cloud mode, the docs home otherwise. */
  brandHref: string
  website: string | null
  repository: string | null
  contact: string | null
  signIn: { href: string; label: string }
}
export interface SearchSuggestion { title: string; href: string; section: string }

interface NavState {
  tabs: NavTab[]
  links: NavLinks
  suggestions: SearchSuggestion[]
  pathname: string
  activeTab: NavTab
  openSearch: (opener?: HTMLElement | null) => void
  preloadSearch: () => void
  openDrawer: (opener?: HTMLElement | null) => void
}

const NavContext = createContext<NavState | null>(null)

const NOOP = () => {}
/** Outside the provider (tests rendering a page alone) the triggers stay plain links. */
const FALLBACK: NavState = {
  tabs: [], suggestions: [], pathname: '/docs', openSearch: NOOP, preloadSearch: NOOP, openDrawer: NOOP,
  links: { brandHref: '/docs', website: null, repository: null, contact: null, signIn: { href: '/login', label: 'Sign in' } },
  activeTab: { id: 'guides', label: 'Guides', href: '/docs', sections: [] },
}

function useNav(): NavState {
  return useContext(NavContext) ?? FALLBACK
}

const loadPalette = () => import('./search-palette')
const SearchPalette = dynamic(loadPalette, { ssr: false })

function normalise(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/'
}

function tabFor(tabs: NavTab[], pathname: string): NavTab {
  const path = normalise(pathname)
  return tabs.find((tab) => tab.sections.some((section) => section.items.some((item) => item.href === path))) ?? tabs[0]
}

/** Keyboard focus stays inside `container` (dialogs). */
function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab' || !container) return
  const focusable = [...container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    .filter((element) => element.offsetParent !== null || element === document.activeElement)
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export function DocsNavProvider({ tabs, links, suggestions, children }: { tabs: NavTab[]; links: NavLinks; suggestions: SearchSuggestion[]; children: ReactNode }) {
  const pathname = usePathname() ?? '/docs'
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const searchOpener = useRef<HTMLElement | null>(null)
  const drawerOpener = useRef<HTMLElement | null>(null)

  const openSearch = useCallback((opener?: HTMLElement | null) => {
    searchOpener.current = opener ?? (document.activeElement as HTMLElement | null)
    setDrawerOpen(false)
    setSearchOpen(true)
  }, [])
  const preloadSearch = useCallback(() => { void loadPalette() }, [])
  const openDrawer = useCallback((opener?: HTMLElement | null) => {
    drawerOpener.current = opener ?? null
    setDrawerOpen(true)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (searchOpen) setSearchOpen(false)
        else openSearch()
      } else if (event.key === '/' && !typing && !searchOpen) {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSearch, searchOpen])

  // A navigation closes the drawer.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    const opener = searchOpener.current
    if (opener && document.contains(opener)) requestAnimationFrame(() => opener.focus())
  }, [])
  const closeDrawer = useCallback(() => {
    setDrawerOpen(false)
    const opener = drawerOpener.current
    if (opener && document.contains(opener)) requestAnimationFrame(() => opener.focus())
  }, [])

  const activeTab = useMemo(() => tabFor(tabs, pathname), [tabs, pathname])
  const value = useMemo<NavState>(() => ({ tabs, links, suggestions, pathname: normalise(pathname), activeTab, openSearch, preloadSearch, openDrawer }), [tabs, links, suggestions, pathname, activeTab, openSearch, preloadSearch, openDrawer])

  return (
    <NavContext.Provider value={value}>
      {children}
      {drawerOpen && <NavDrawer onClose={closeDrawer} />}
      {searchOpen && <SearchPalette onClose={closeSearch} suggestions={suggestions} />}
    </NavContext.Provider>
  )
}

/** Header tabs (lg and up). */
export function DocsTabs() {
  const { tabs, activeTab } = useNav()
  return (
    <nav aria-label="Documentation areas" className="hidden h-full items-stretch gap-1 lg:flex">
      {tabs.map((tab) => {
        const active = tab.id === activeTab.id
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'true' : undefined}
            className={`relative inline-flex items-center px-3 text-ui font-medium transition-colors ${active ? 'text-(color:--mkt-ink)' : 'text-(color:--mkt-muted-strong) hover:text-(color:--mkt-ink)'}`}
          >
            {tab.label}
            <span aria-hidden="true" className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-(color:--mkt-bronze) transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
          </Link>
        )
      })}
    </nav>
  )
}

/** Opens the palette; a link to the full index without JavaScript. */
export function DocsSearchTrigger({ variant = 'header' }: { variant?: 'header' | 'hero' | 'icon' | 'drawer' }) {
  const { openSearch, preloadSearch, tabs } = useNav()
  const [mac, setMac] = useState(true)
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) }, [])
  const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0 || tabs.length === 0) return
    event.preventDefault()
    openSearch(event.currentTarget)
  }
  const common = { href: '/docs#browse', role: 'button' as const, onClick, onPointerEnter: preloadSearch, onFocus: preloadSearch, 'aria-haspopup': 'dialog' as const, 'aria-keyshortcuts': 'Meta+K Control+K /' }
  const hint = (
    <kbd className="hidden items-center gap-0.5 rounded-md border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-paper) px-1.5 py-0.5 font-sans text-2xs font-medium text-(color:--mkt-muted) sm:inline-flex">
      {mac ? '⌘' : 'Ctrl'}<span className={mac ? '' : 'ml-0.5'}>K</span>
    </kbd>
  )
  if (variant === 'icon') {
    return (
      <a {...common} aria-label="Search documentation" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(color:--mkt-muted-strong) transition hover:bg-(color:--mkt-ink)/[0.05] hover:text-(color:--mkt-ink)">
        <Search size={18} aria-hidden="true" />
      </a>
    )
  }
  if (variant === 'hero') {
    return (
      <a {...common} className="group flex h-14 w-full max-w-xl items-center gap-3 rounded-2xl border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) px-4 text-left text-(color:--mkt-muted) shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_12px_32px_-18px_rgba(27,25,22,0.35)] transition hover:border-(color:--mkt-bronze)/50">
        <Search size={20} className="text-(color:--mkt-bronze)" aria-hidden="true" />
        <span className="flex-1 truncate text-base">Search guides, nodes, commands, settings…</span>
        {hint}
      </a>
    )
  }
  return (
    <a {...common} className={`flex h-9 items-center gap-2 rounded-lg border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white)/80 pl-3 pr-1.5 text-ui text-(color:--mkt-muted) transition hover:border-(color:--mkt-ink)/25 hover:text-(color:--mkt-ink) ${variant === 'drawer' ? 'w-full' : 'w-full max-w-[15rem]'}`}>
      <Search size={15} aria-hidden="true" />
      <span className="flex-1 text-left">Search docs</span>
      {hint}
    </a>
  )
}

/** Opens the mobile drawer; a link to the full index without JavaScript. */
export function DocsMenuButton() {
  const { openDrawer } = useNav()
  return (
    <a
      href="/docs#browse"
      role="button"
      aria-haspopup="dialog"
      aria-label="Open documentation menu"
      onClick={(event) => { event.preventDefault(); openDrawer(event.currentTarget) }}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(color:--mkt-ink) transition hover:bg-(color:--mkt-ink)/[0.05] lg:hidden"
    >
      <Menu size={20} aria-hidden="true" />
    </a>
  )
}

type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_KEY = 'docs-theme'
const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' }

/** Light / dark / system. The choice is applied before paint by the root layout's bootstrap. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>('system')
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY)
      if (stored === 'light' || stored === 'dark') setTheme(stored)
    } catch { /* storage unavailable: follow the system */ }
  }, [])
  const choose = () => {
    const next = NEXT_THEME[theme]
    setTheme(next)
    const root = document.documentElement
    if (next === 'system') root.removeAttribute('data-docs-theme')
    else root.setAttribute('data-docs-theme', next)
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, next)
    } catch { /* not persisted */ }
  }
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      onClick={choose}
      title={`Theme: ${THEME_LABEL[theme]} (switch to ${THEME_LABEL[NEXT_THEME[theme]].toLowerCase()})`}
      aria-label={`Colour theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[NEXT_THEME[theme]]}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(color:--mkt-muted-strong) transition hover:bg-(color:--mkt-ink)/[0.05] hover:text-(color:--mkt-ink)"
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  )
}

function SectionGroup({ section, pathname, defaultOpen, onNavigate }: { section: NavSection; pathname: string; defaultOpen: boolean; onNavigate?: () => void }) {
  const containsActive = section.items.some((item) => item.href === pathname)
  const [open, setOpen] = useState(defaultOpen || containsActive)
  // Navigating into a collapsed group opens it.
  useEffect(() => { if (containsActive) setOpen(true) }, [containsActive])
  return (
    <details open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)} className="group/section">
      <summary className={`flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-ui font-semibold transition-colors hover:bg-(color:--mkt-ink)/[0.04] ${containsActive ? 'text-(color:--mkt-ink)' : 'text-(color:--mkt-ink-soft)'}`}>
        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${containsActive ? 'border-(color:--mkt-bronze)/40 bg-(color:--mkt-bronze)/[0.1] text-(color:--mkt-bronze)' : 'border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) text-(color:--mkt-muted-strong)'}`}>
          <DocsIcon name={section.icon} size={13} />
        </span>
        <span className="min-w-0 flex-1 truncate">{section.title}</span>
        <ChevronRight size={14} aria-hidden="true" className="docs-chevron shrink-0 text-(color:--mkt-subtle) transition-transform duration-200" />
      </summary>
      <ul className="mb-2 ml-[1.15rem] mt-0.5 space-y-px border-l border-(color:--mkt-ink)/[0.08] pl-2">
        {section.items.map((item) => {
          const active = item.href === pathname
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                data-active={active || undefined}
                className={`relative block rounded-md px-2.5 py-1.5 text-ui leading-5 transition-colors ${active
                  ? 'bg-(color:--mkt-bronze)/[0.1] font-semibold text-(color:--mkt-ink) before:absolute before:-left-[9px] before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-(color:--mkt-bronze)'
                  : 'text-(color:--mkt-muted-strong) hover:bg-(color:--mkt-ink)/[0.04] hover:text-(color:--mkt-ink)'}`}
              >
                {item.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function SectionList({ tab, pathname, onNavigate }: { tab: NavTab; pathname: string; onNavigate?: () => void }) {
  // Short tabs open every group; long ones open the group holding the page (or the first).
  const openAll = tab.sections.length <= 3
  const anyActive = tab.sections.some((section) => section.items.some((item) => item.href === pathname))
  return (
    <div className="space-y-0.5">
      {tab.sections.map((section, index) => (
        <SectionGroup key={section.title} section={section} pathname={pathname} defaultOpen={openAll || (!anyActive && index === 0)} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

/** Desktop sidebar (lg and up): the active tab's sections. Hidden on the docs home, which is its own index. */
export function DocsSidebar() {
  const { pathname, activeTab } = useNav()
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the active page in view inside the sidebar (not the window).
  useEffect(() => {
    const container = scroller.current
    const active = container?.querySelector<HTMLElement>('[data-active]')
    if (!container || !active) return
    const box = container.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.top < box.top + 40 || item.bottom > box.bottom - 40) {
      container.scrollTop += item.top - box.top - box.height / 3
    }
  }, [pathname])

  if (pathname === '/docs') return null
  return (
    <aside aria-label="Documentation sidebar" className="hidden w-[17rem] shrink-0 lg:block">
      <div ref={scroller} className="docs-scroll sticky top-(--docs-header-h) max-h-[calc(100vh-var(--docs-header-h))] overflow-y-auto pb-10 pr-3 pt-7">
        <nav aria-label={`${activeTab.label} pages`}>
          <p className="mb-2 px-2 text-2xs font-semibold uppercase tracking-[0.16em] text-(color:--mkt-bronze)">{activeTab.label}</p>
          <SectionList tab={activeTab} pathname={pathname} />
        </nav>
      </div>
    </aside>
  )
}

/** Mobile slide-over: tabs, sections and the header's links. */
function NavDrawer({ onClose }: { onClose: () => void }) {
  const { tabs, activeTab, pathname, links } = useNav()
  const [tabId, setTabId] = useState(activeTab.id)
  const panel = useRef<HTMLDivElement>(null)
  const tab = tabs.find((candidate) => candidate.id === tabId) ?? activeTab

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      trapFocus(event, panel.current)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow }
  }, [onClose])

  // Scroll the current page into view once open.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'center' })
  }, [tabId])

  return (
    <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation menu">
      <button type="button" tabIndex={-1} aria-label="Close menu" className="docs-fade absolute inset-0 bg-[rgba(16,14,11,0.5)] backdrop-blur-[2px]" onClick={onClose} />
      <div ref={panel} className="docs-slide absolute inset-y-0 left-0 flex w-[88%] max-w-[22rem] flex-col bg-(color:--mkt-paper) shadow-2xl">
        <div className="flex h-(--docs-header-h) shrink-0 items-center justify-between border-b border-(color:--mkt-ink)/[0.08] px-4">
          <span className="font-display text-lg font-semibold text-(color:--mkt-ink)">Documentation</span>
          <button type="button" data-autofocus onClick={onClose} aria-label="Close menu" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-(color:--mkt-muted-strong) hover:bg-(color:--mkt-ink)/[0.05]">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="shrink-0 space-y-3 border-b border-(color:--mkt-ink)/[0.08] p-4">
          <DocsSearchTrigger variant="drawer" />
          <div role="group" aria-label="Documentation areas" className="grid grid-cols-2 gap-1.5">
            {tabs.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === tab.id}
                onClick={() => setTabId(candidate.id)}
                className={`rounded-lg px-2.5 py-1.5 text-left text-ui font-medium transition ${candidate.id === tab.id ? 'bg-(color:--mkt-primary) text-(color:--mkt-paper)' : 'bg-(color:--mkt-ink)/[0.04] text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.08]'}`}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>
        <nav aria-label={`${tab.label} pages`} className="docs-scroll min-h-0 flex-1 overflow-y-auto p-3">
          <Link href="/docs" onClick={onClose} aria-current={pathname === '/docs' ? 'page' : undefined} className={`mb-1 block rounded-md px-2 py-1.5 text-ui font-semibold ${pathname === '/docs' ? 'bg-(color:--mkt-bronze)/[0.1] text-(color:--mkt-ink)' : 'text-(color:--mkt-ink-soft)'}`}>Docs home</Link>
          <SectionList tab={tab} pathname={pathname} onNavigate={onClose} />
        </nav>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-(color:--mkt-ink)/[0.08] p-4 text-ui">
          <Link href={links.signIn.href} className="rounded-lg bg-(color:--mkt-primary) px-3 py-2 font-semibold text-(color:--mkt-paper)">{links.signIn.label}</Link>
          {links.website && <Link href={links.website} className="rounded-lg px-3 py-2 font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">Website</Link>}
          {links.repository && (
            <a href={links.repository} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-(color:--mkt-ink-soft) hover:bg-(color:--mkt-ink)/[0.05]">
              <GitHubMark size={14} /> GitHub <ArrowUpRight size={12} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
