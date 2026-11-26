"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, ExternalLink, HelpCircle, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { Tooltip } from "@/components/ui/tooltip"
import { Avatar } from "@/components/ui/avatar"
import { usePermissions } from "@/lib/permissions-context"
import { serverQuery } from "@/lib/server-read"
import { formAppPath } from "@/lib/forms/form-paths"
import type { AppMenuItem, AppMenuLeaf, BadgeSource, OpenMode } from "@/lib/apps/schema"
import { resolveParams } from "@/lib/apps/params"
import { displayLabel } from "@/lib/apps/labels"
import { dedupeMenu } from "@/lib/apps/lint"
import { cn } from "@/lib/utils"
import { appIcon } from "./app-icon"
import { hrefOf, useOpenTarget } from "./panels"
import { useAppRuntime } from "./runtime"
import type { PreviewArgs } from "@/lib/apps/versions"

/**
 * The navigation model's one renderer — the app menu (every app navigation
 * style: top bar, sidebar, drawer, tabs, bottom bar, mega-menu) and the Nav
 * bar widget share it. Items: pages (hidden "opened from buttons" pages
 * too), forms, reports, data table records, workflows (start), task views
 * and links, each opening in its open mode (modal / panel / sheet / full
 * screen / navigation / new tab, through the panel stack); groups with
 * collapse (remembered per person), one level of sub-groups, dividers,
 * headings, live badges, a search box that filters the items (and can
 * search the app's objects), an icon rail for collapsed side bars. The menu
 * arrives governance-filtered from the server.
 */

export interface NavTarget {
  app: string
  appSlug: string
  base: string
  /** The page being shown (active highlight). */
  activePage?: string | null
  /** Pages of the app (slug → title) for page items without an icon. */
  pages?: ReadonlyArray<{ slug: string; title: string; icon: string | null }>
  /** Editors previewing the draft: quick search reads the draft too. */
  previewArgs?: PreviewArgs
}

type Leaf = Exclude<AppMenuLeaf, { kind: "divider" } | { kind: "heading" }>

/**
 * The app page view's hooks for its menus (components/apps/app-page-view.tsx): warm the next page's data
 * when an entry is pointed at, and highlight the chosen entry before its address commits.
 */
export const AppNavContext = createContext<{ prefetch?: (pageSlug: string) => void; onNavigate?: (pageSlug: string) => void } | null>(null)

/**
 * A page entry that simply goes to the page (open mode "navigate", no parameters worked out when clicked):
 * its address, for a real link — next/link prefetches it and moves client-side, so only the page content
 * changes (the app's header and navigation live in app/(dashboard)/apps/[slug]/layout.tsx). Null otherwise
 * (panels, sheets, new tabs and computed parameters run through the panel stack on click).
 */
export function pageLinkHref(item: AppMenuLeaf, nav: Pick<NavTarget, "base" | "appSlug">): string | null {
  if (item.kind !== "page" || item.params) return null
  if (item.open_mode && item.open_mode.mode !== "navigate") return null
  return hrefOf({ t: "page", slug: item.page_slug, ...(item.filters ? { filters: item.filters } : {}) }, nav.base, nav.appSlug)
}

export function collectBadges(items: readonly AppMenuItem[]): BadgeSource[] {
  const out = new Set<BadgeSource>()
  const visit = (list: ReadonlyArray<{ kind: string; badge?: BadgeSource | null; items?: unknown }>) => {
    for (const i of list) {
      if (i.badge) out.add(i.badge)
      if (Array.isArray(i.items)) visit(i.items as never)
    }
  }
  visit(items as never)
  return [...out]
}

export function useBadgeCounts(app: string, items: readonly AppMenuItem[]) {
  const sources = useMemo(() => collectBadges(items), [items])
  const q = useQuery({
    queryKey: ["apps", "badges", app, sources],
    enabled: sources.length > 0,
    queryFn: async () => (await serverQuery("apps.badges", { app, sources })) as Partial<Record<BadgeSource, number>>,
    staleTime: 60_000,
  })
  return q.data ?? {}
}

/** Remembered expand / collapse state of groups, per person and menu. */
function useGroupState(key: string) {
  const { userId } = usePermissions()
  const storage = `ut:apps:nav:${userId ?? "anon"}:${key}`
  const [state, setState] = useState<Record<string, boolean>>({})
  // Read the remembered state once the browser is there (after hydration).
  const [loaded, setLoaded] = useState<string | null>(null)
  if (typeof window !== "undefined" && loaded !== storage) {
    setLoaded(storage)
    try { setState(JSON.parse(window.localStorage.getItem(storage) ?? "{}")) } catch { setState({}) }
  }
  const set = useCallback((group: string, open: boolean) => setState((s) => {
    const next = { ...s, [group]: open }
    try { window.localStorage.setItem(storage, JSON.stringify(next)) } catch { /* unavailable */ }
    return next
  }), [storage])
  return [state, set] as const
}

/** Run a menu item: open its target in its open mode, or follow its link. */
export function useActivate(nav: NavTarget) {
  const opener = useOpenTarget()
  const runtime = useAppRuntime()
  return (raw: Leaf) => {
    const item = { ...raw, label: displayLabel(raw, { pages: nav.pages }) } as Leaf
    const om = (m: OpenMode | null | undefined, fallback: OpenMode["mode"]): OpenMode => m ?? { mode: fallback, width: "md", motion: "auto" }
    switch (item.kind) {
      case "page": {
        const params = item.params ? resolveParams(item.params, { filters: {}, app: nav.appSlug, page: nav.activePage ?? undefined, scope: runtime?.getScope(), query: Object.fromEntries(new URLSearchParams(window.location.search)) }) : {}
        opener?.open({ t: "page", slug: item.page_slug, ...(item.filters ? { filters: item.filters } : {}), ...(Object.keys(params).length ? { params } : {}) }, om(item.open_mode, "navigate"), item.label)
        return true
      }
      case "form": opener?.open({ t: "form", id: item.form_id, ...(item.params ? { params: resolveParams(item.params, { filters: {}, app: nav.appSlug, page: nav.activePage ?? undefined, scope: runtime?.getScope(), query: Object.fromEntries(new URLSearchParams(window.location.search)) }) } : {}) }, om(item.open_mode, item.open === "page" ? "navigate" : "modal"), item.label); return true
      case "report": opener?.open({ t: "report", id: item.report_id }, om(item.open_mode, "panel_right"), item.label); return true
      case "record": opener?.open({ t: "record", table: item.table_id, row: item.row_id ?? null }, om(item.open_mode, "panel_right"), item.label); return true
      case "workflow": opener?.open({ t: "workflow", id: item.workflow_id }, om(item.open_mode, "modal"), item.label); return true
      default: return false
    }
  }
}

export function leafHref(item: Leaf, nav: NavTarget): string | null {
  switch (item.kind) {
    case "url": return item.url
    case "tasks": return `/tasks?view=${item.view}`
    case "page": return `${nav.base}/${nav.appSlug}/${item.page_slug}`
    case "form": return formAppPath(item.form_id)
    default: return null
  }
}

const ICON_SIZE = { sm: "size-3.5", md: "size-4", lg: "size-5" } as const

interface MenuProps {
  items: readonly AppMenuItem[]
  nav: NavTarget
  orientation: "vertical" | "horizontal"
  /** Vertical: icon rail (labels as tooltips). */
  rail?: boolean
  density?: "comfortable" | "compact"
  iconSize?: "sm" | "md" | "lg"
  showLabels?: boolean
  /** Remembered group state key. */
  stateKey: string
  /** Called after an item runs (close a drawer). */
  onDone?: () => void
  /** Horizontal: group popovers as columns (mega-menu). */
  mega?: boolean
  tone?: "surface" | "app" | "dark"
  className?: string
}

/** The icon a page entry shows when it names none: its page's icon, else a house for the first page and a page icon for the rest. */
export function pageIconName(nav: Pick<NavTarget, "pages">, slug: string): string {
  const pages = nav.pages ?? []
  const page = pages.find((p) => p.slug === slug)
  return page?.icon || (pages[0]?.slug === slug ? "House" : "FileText")
}

export function NavMenu({ items: rawItems, nav, orientation, rail = false, density = "comfortable", iconSize = "md", showLabels = true, stateKey, onDone, mega = false, tone = "surface", className }: MenuProps) {
  // Each target once (a page listed twice shows once); placeholder labels ("Link") read as their target's name.
  const items = useMemo(() => dedupeMenu(rawItems), [rawItems])
  const itemLabel = (item: { kind: string; label?: string }) => displayLabel(item, { pages: nav.pages })
  const counts = useBadgeCounts(nav.app, items)
  const [groups, setGroup] = useGroupState(stateKey)
  const activate = useActivate(nav)
  const appNav = useContext(AppNavContext)
  const horizontal = orientation === "horizontal"
  const pad = density === "compact" ? "py-1" : "py-1.5"
  const labels = showLabels && !rail
  const fg = tone === "surface" ? "text-fg-muted hover:text-fg hover:bg-subtle" : "text-current/80 hover:bg-current/10 hover:text-current"
  const activeCls = tone === "surface" ? "bg-[var(--app-accent-wash,var(--theme-primary-light))] text-fg font-medium" : "bg-current/15 font-medium"

  const leaf = (item: AppMenuLeaf, key: string, depth = 0): ReactNode => {
    if (item.kind === "divider") return horizontal ? <span key={key} className="mx-1 h-5 w-px self-center bg-border" role="separator" /> : <li key={key} role="separator" className="my-1 border-t border-border-subtle">{item.label && !rail ? <span className="block px-2 pt-1 text-2xs uppercase tracking-wide text-fg-subtle">{item.label}</span> : null}</li>
    if (item.kind === "heading") return rail ? null : <li key={key} className="px-2 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-subtle" role="presentation">{item.label}</li>
    const Icon = item.icon ? appIcon(item.icon) : item.kind === "page" ? appIcon(pageIconName(nav, item.page_slug)) : null
    const active = item.kind === "page" && item.page_slug === nav.activePage
    const badge = item.badge ? counts[item.badge] : undefined
    const href = leafHref(item, nav)
    const external = item.kind === "url" && /^https?:/i.test(item.url)
    const inner = (
      <>
        {Icon && <Icon className={cn("shrink-0", ICON_SIZE[iconSize])} aria-hidden />}
        {labels || !Icon ? <span className="min-w-0 flex-1 truncate">{itemLabel(item)}</span> : <span className="sr-only">{itemLabel(item)}</span>}
        {typeof badge === "number" && badge > 0 && <span className={cn("num shrink-0 rounded-full bg-[var(--app-accent,var(--theme-primary))] px-1.5 text-2xs font-semibold text-[color:var(--app-accent-fg,var(--theme-on-primary))]", rail && "absolute -right-0.5 -top-0.5")} aria-label={`${badge} items`}>{badge > 99 ? "99+" : badge}</span>}
        {external && labels && <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />}
      </>
    )
    const cls = cn("relative flex w-full items-center gap-2 rounded-md px-2 text-left text-ui outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]", pad, fg, active && activeCls, depth > 0 && !rail && !horizontal && "pl-6", rail && "justify-center px-0")
    const linkHref = pageLinkHref(item, nav)
    const el = linkHref && item.kind === "page"
      ? <Link href={linkHref} scroll={false} className={cls} aria-current={active ? "page" : undefined} data-nav-item={item.kind} data-nav-link
          onMouseEnter={() => appNav?.prefetch?.(item.page_slug)} onFocus={() => appNav?.prefetch?.(item.page_slug)}
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; appNav?.onNavigate?.(item.page_slug); onDone?.() }}>{inner}</Link>
      : item.kind === "url" || item.kind === "tasks"
      ? <a href={href ?? "#"} className={cls} target={item.kind === "url" && item.new_tab ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} onClick={() => onDone?.()} data-nav-item={item.kind}>{inner}</a>
      : <a href={href ?? "#"} className={cls} aria-current={active ? "page" : undefined} data-nav-item={item.kind}
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); activate(item as Leaf); onDone?.() }}>{inner}</a>
    const wrapped = rail ? <Tooltip content={itemLabel(item)} side="right">{el}</Tooltip> : el
    return horizontal ? <span key={key} className="shrink-0">{wrapped}</span> : <li key={key}>{wrapped}</li>
  }

  const group = (g: Extract<AppMenuItem, { kind: "group" }>, key: string, depth = 0): ReactNode => {
    const Icon = g.icon ? appIcon(g.icon) : null
    const open = groups[key] ?? !("collapsed" in g && g.collapsed)
    if (horizontal) {
      return (
        <Popover key={key} width={mega ? 560 : 260} aria-label={g.label}
          trigger={(t) => <button type="button" {...t} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 text-ui", pad, fg)} data-nav-group={g.label}>{Icon && <Icon className={ICON_SIZE[iconSize]} aria-hidden />}{g.label}<ChevronDown className="size-3.5" aria-hidden /></button>}>
          {(close: () => void) => (
            <ul className={cn(mega ? "grid grid-cols-2 gap-x-4" : "space-y-0.5")}>
              {g.items.map((i, j) => (i.kind === "group"
                ? <li key={j}><span className="block px-2 pb-0.5 pt-2 text-2xs font-semibold uppercase text-fg-subtle">{i.label}</span><ul>{i.items.map((x, k) => <NavLeafInPopover key={k} item={x} render={(n) => leaf(n, `${key}.${j}.${k}`, 1)} onRun={close} />)}</ul></li>
                : <NavLeafInPopover key={j} item={i} render={(n) => leaf(n, `${key}.${j}`)} onRun={close} />))}
            </ul>
          )}
        </Popover>
      )
    }
    if (rail) {
      return (
        <li key={key}>
          <Popover width={240} aria-label={g.label}
            trigger={(t) => <Tooltip content={g.label} side="right"><button type="button" {...t} className={cn("flex w-full justify-center rounded-md", pad, fg)} aria-label={g.label}>{Icon ? <Icon className={ICON_SIZE[iconSize]} aria-hidden /> : <MoreHorizontal className={ICON_SIZE[iconSize]} aria-hidden />}</button></Tooltip>}>
            {(close: () => void) => <NavMenu items={g.items as AppMenuItem[]} nav={nav} orientation="vertical" stateKey={`${stateKey}.${key}`} onDone={() => { close(); onDone?.() }} />}
          </Popover>
        </li>
      )
    }
    return (
      <li key={key}>
        <button type="button" aria-expanded={open} onClick={() => setGroup(key, !open)} className={cn("flex w-full items-center gap-2 rounded-md px-2 text-left text-ui font-medium", pad, fg, depth > 0 && "pl-4")} data-nav-group={g.label}>
          {Icon && <Icon className={cn("shrink-0", ICON_SIZE[iconSize])} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{g.label}</span>
          {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
        </button>
        {open && <ul className="mt-0.5 space-y-0.5">{g.items.map((i, j) => (i.kind === "group" ? group(i as never, `${key}.${j}`, depth + 1) : leaf(i, `${key}.${j}`, depth + 1)))}</ul>}
      </li>
    )
  }

  const nodes = items.map((m, i) => (m.kind === "group" ? group(m, `g${i}`) : leaf(m, `i${i}`)))
  if (horizontal) return <div className={cn("flex min-w-0 items-center gap-0.5", className)}>{nodes}</div>
  return <ul className={cn("space-y-0.5", className)}>{nodes}</ul>
}

function NavLeafInPopover({ item, render, onRun }: { item: AppMenuLeaf; render: (i: AppMenuLeaf) => ReactNode; onRun: () => void }) {
  return <li onClickCapture={() => { if (item.kind !== "divider" && item.kind !== "heading") setTimeout(onRun, 0) }}>{render(item)}</li>
}

/** Horizontal menu that moves what doesn't fit into "More". */
export function OverflowMenu(props: Omit<MenuProps, "orientation">) {
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState(props.items.length)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const width = el.clientWidth
      // About 130px per entry; "More" needs ~80px.
      const n = Math.max(1, Math.floor((width - 80) / 130))
      setFit(n >= props.items.length ? props.items.length : n)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.items.length])
  const shown = props.items.slice(0, fit)
  const rest = props.items.slice(fit)
  return (
    <div ref={box} className="flex min-w-0 flex-1 items-center gap-0.5">
      <NavMenu {...props} items={shown} orientation="horizontal" />
      {rest.length > 0 && (
        <Popover width={260} aria-label="More"
          trigger={(t) => <button type="button" {...t} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-ui text-fg-muted hover:bg-subtle hover:text-fg" data-nav-more><MoreHorizontal className="size-4" aria-hidden />More</button>}>
          {(close: () => void) => <NavMenu {...props} items={rest} orientation="vertical" onDone={() => { close(); props.onDone?.() }} />}
        </Popover>
      )}
    </div>
  )
}

/** A filter over the menu's items by label (keeps groups with matching entries). */
export function filterMenu(items: readonly AppMenuItem[], query: string): AppMenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const hit = (i: { kind: string; label?: string }) => i.kind !== "divider" && i.kind !== "heading" && (i.label ?? "").toLowerCase().includes(q)
  const out: AppMenuItem[] = []
  for (const m of items) {
    if (m.kind === "group") {
      if (hit(m)) { out.push(m); continue }
      type Kid = (typeof m.items)[number]
      const kids = m.items.flatMap((i): Kid[] => (i.kind === "group" ? (hit(i) ? [i] : (() => { const s = i.items.filter(hit); return s.length ? [{ ...i, items: s }] : [] })()) : hit(i) ? [i] : []))
      if (kids.length) out.push({ ...m, items: kids, collapsed: false })
    } else if (hit(m)) out.push(m)
  }
  return out
}

/** The vertical bar used by the sidebar style, the drawer and the Nav bar widget: search, menu, collapse toggle, footer. */
export function SideNav({ items, nav, stateKey, search = false, searchObjects = false, collapsible = true, collapsed: collapsedProp, onCollapsedChange, density, iconSize, showLabels = true, footerProfile = false, helpUrl, tone = "surface", onDone, header }: {
  items: readonly AppMenuItem[]; nav: NavTarget; stateKey: string; search?: boolean; searchObjects?: boolean; collapsible?: boolean
  collapsed?: boolean; onCollapsedChange?: (c: boolean) => void; density?: "comfortable" | "compact"; iconSize?: "sm" | "md" | "lg"; showLabels?: boolean
  footerProfile?: boolean; helpUrl?: string | null; tone?: "surface" | "app" | "dark"; onDone?: () => void; header?: ReactNode
}) {
  const [q, setQ] = useState("")
  const [inner, setInner] = useState(false)
  const collapsed = collapsedProp ?? inner
  const setCollapsed = onCollapsedChange ?? setInner
  const shown = useMemo(() => filterMenu(items, q), [items, q])
  const hits = useQuery({
    queryKey: ["apps", "quick-search", nav.app, q, nav.previewArgs ?? null],
    enabled: searchObjects && q.trim().length >= 2,
    queryFn: async () => (await serverQuery("apps.quickSearch", { app: nav.app, q: q.trim(), include: ["pages", "forms", "workflows", "tables", "reports", "tasks"], ...(nav.previewArgs ?? {}) })) as { hits: Array<{ kind: string; id: string; title: string; hint: string | null; href: string | null }> },
    staleTime: 30_000,
  })
  const profile = useQuery({ queryKey: ["tasks", "myProfile"], enabled: footerProfile, queryFn: () => serverQuery("tasks.myProfile"), staleTime: 300_000 })
  const displayName = profile.data?.display_name ?? null
  const email: string | null = null
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-side-nav={collapsed ? "rail" : "full"}>
      {header}
      {search && !collapsed && (
        <label className="flex items-center gap-1.5 rounded-md border border-border bg-panel px-2 py-1">
          <Search className="size-3.5 text-fg-muted" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search the menu" className="w-full bg-transparent text-xs text-fg outline-none" data-nav-search />
          {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")}><X className="size-3 text-fg-muted" aria-hidden /></button>}
        </label>
      )}
      <nav aria-label="Navigation" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <NavMenu items={shown} nav={nav} orientation="vertical" rail={collapsed} density={density} iconSize={iconSize} showLabels={showLabels} stateKey={stateKey} onDone={onDone} tone={tone} />
        {searchObjects && q.trim().length >= 2 && (hits.data?.hits.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-0.5 border-t border-border-subtle pt-2" aria-label="Found in this app">
            {hits.data!.hits.map((h) => <li key={`${h.kind}:${h.id}`}><a href={h.href ?? "#"} className="block truncate rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-subtle hover:text-fg">{h.title} <span className="text-fg-subtle">· {h.hint}</span></a></li>)}
          </ul>
        )}
        {q && !shown.length && !hits.data?.hits.length && <p className="px-2 text-xs text-fg-muted">Nothing found.</p>}
      </nav>
      {(footerProfile || helpUrl) && (
        <div className="space-y-1 border-t border-border-subtle pt-2">
          {helpUrl && <a href={helpUrl} target="_blank" rel="noreferrer" className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-ui text-fg-muted hover:bg-subtle", collapsed && "justify-center")}><HelpCircle className="size-4" aria-hidden />{!collapsed && "Help"}</a>}
          {footerProfile && <div className={cn("flex items-center gap-2 px-2 py-1", collapsed && "justify-center")}><Avatar name={displayName || email || "Me"} src={profile.data?.avatar_url ?? null} size="sm" />{!collapsed && <span className="truncate text-xs text-fg">{displayName || email || "Me"}</span>}</div>}
        </div>
      )}
      {collapsible && (
        <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand navigation" : "Collapse to icons"} className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-subtle", collapsed && "justify-center")} data-nav-collapse>
          {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <><PanelLeftClose className="size-4" aria-hidden />Collapse</>}
        </button>
      )}
    </div>
  )
}

/** The hamburger + drawer used on phones by every style (and by the drawer style everywhere). */
export function NavDrawer({ items, nav, stateKey, title, search }: { items: readonly AppMenuItem[]; nav: NavTarget; stateKey: string; title: string; search?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${title} menu`} aria-expanded={open} className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg" data-nav-hamburger>
        <Menu className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-[880]" role="dialog" aria-modal aria-label={`${title} menu`}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 flex w-[min(85vw,300px)] flex-col border-r border-border bg-elevated p-3 shadow-elev-3 motion-safe:animate-[app-slide-in-left_180ms_ease-out]">
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-fg">{title}</span><button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 hover:bg-subtle" autoFocus><X className="size-4" aria-hidden /></button></div>
            <SideNav items={items} nav={nav} stateKey={stateKey} search={search} collapsible={false} onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
