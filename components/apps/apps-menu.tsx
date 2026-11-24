"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronRight, LayoutGrid, Plus, Settings2 } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import { SearchInput } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { sidebarItemClass, sidebarMuted } from "@/components/layout/sidebar-nav-item"
import { usePermissions } from "@/lib/permissions-context"
import { searchApps, showsAppsMenu, withRecentFirst } from "@/lib/apps/access"
import type { AppSummary } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { AppIconTile } from "./app-icon"
import { appHref, useMyApps, useRecentApps } from "./use-apps"

/**
 * The Apps item in the main navigation. Shown to anyone with at least one
 * app they can open (its audience names them, a team or a role of theirs),
 * and to builders (apps.manage). The label opens the Apps page (/apps); the
 * expand control beside it opens a panel listing every app they can access
 * with search (name / description), recently opened apps first, and — for
 * builders — New app and Manage apps.
 */
export function SidebarAppsMenu({ collapsed }: { collapsed: boolean }) {
  const { can } = usePermissions()
  const { apps } = useMyApps()
  const pathname = usePathname()
  // Open on the page it was opened on: navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null)
  const canManage = can("apps.manage" as never)
  if (!showsAppsMenu({ appCount: apps.filter((a) => a.in_audience).length, canManage, editsAny: apps.some((a) => a.access === 'edit') })) return null
  const active = pathname === "/apps" || pathname.startsWith("/apps/")

  const panel = (close: () => void) => <AppsPanel apps={apps} canManage={canManage} onClose={close} />

  if (collapsed) {
    return (
      <Popover open={open} onOpenChange={setOpen} width={320} aria-label="Apps"
        trigger={(t) => (
          <Tooltip content="Apps" side="right">
            <button type="button" {...t} className={cn(sidebarItemClass, "justify-center px-0")} aria-label="Apps" data-apps-menu-trigger>
              <LayoutGrid className={cn("size-4", active ? "text-[color:var(--theme-sidebar-accent,var(--theme-primary))]" : sidebarMuted)} aria-hidden />
            </button>
          </Tooltip>
        )}>
        {panel}
      </Popover>
    )
  }

  return (
    <div className="relative flex items-center" data-apps-menu>
      <Link href="/apps" className={cn(sidebarItemClass, "pr-9")} aria-current={pathname === "/apps" ? "page" : undefined} data-nav-item="/apps">
        {active && <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--theme-sidebar-accent,var(--theme-primary))]" />}
        <LayoutGrid className={cn("size-4 shrink-0", active ? "text-[color:var(--theme-sidebar-accent,var(--theme-primary))]" : sidebarMuted)} aria-hidden />
        <span className="truncate">Apps</span>
      </Link>
      <Popover open={open} onOpenChange={setOpen} width={340} aria-label="Your apps"
        trigger={(t) => (
          <button type="button" {...t}
            className={cn("absolute right-1 inline-flex size-7 items-center justify-center rounded-md hover:bg-[var(--sidebar-hover-bg)]", sidebarMuted)}
            aria-label={open ? "Close the apps list" : "Show your apps"} data-apps-menu-trigger>
            <ChevronRight className={cn("size-4 transition-transform duration-[var(--ds-dur-fast)]", open && "rotate-90")} aria-hidden />
          </button>
        )}>
        {panel}
      </Popover>
    </div>
  )
}

/** The panel: search, recent apps, all apps, builder links. Keyboard: type to search, ↑/↓ to move, Enter to open, Esc to clear / close. */
export function AppsPanel({ apps, canManage, onClose }: { apps: AppSummary[]; canManage: boolean; onClose?: () => void }) {
  const router = useRouter()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const [recentIds, remember] = useRecentApps()
  const searching = query.trim().length > 0
  const matches = useMemo(() => searchApps(apps, query), [apps, query])
  const { recent, rest } = useMemo(() => (searching ? { recent: [], rest: matches } : withRecentFirst(apps, recentIds)), [searching, matches, apps, recentIds])
  const ordered = [...recent, ...rest]
  const activeIndex = Math.min(active, Math.max(0, ordered.length - 1))

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }) }, [])

  const open = (app: AppSummary) => {
    remember(app.id)
    router.push(appHref(app))
    onClose?.()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (ordered.length) setActive((activeIndex + 1) % ordered.length) }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (ordered.length) setActive((activeIndex - 1 + ordered.length) % ordered.length) }
    else if (e.key === "Enter") { e.preventDefault(); if (ordered[activeIndex]) open(ordered[activeIndex]) }
    else if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); setQuery(""); setActive(0) }
  }

  const option = (app: AppSummary, index: number) => (
    <li key={app.id} id={`${listId}-opt-${index}`} role="option" aria-selected={index === activeIndex}
      onMouseMove={() => { if (index !== activeIndex) setActive(index) }} data-app-option={app.slug}>
      <Link href={appHref(app)} tabIndex={-1} onClick={() => { remember(app.id); onClose?.() }}
        className={cn("flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-fg hover:bg-subtle", index === activeIndex && "bg-subtle")}>
        <AppIconTile icon={app.icon} color={app.color} size="md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium">{app.name}</span>
          {(app.subtitle || app.description) && <span className="block truncate text-xs text-fg-muted">{app.subtitle || app.description}</span>}
        </span>
        {app.access === "edit" && <span className="shrink-0 text-2xs text-fg-subtle" data-app-option-status={app.published === false ? "unpublished" : app.has_draft_changes ? "draft-changes" : undefined}>{app.published === false ? "Unpublished" : app.has_draft_changes ? "Editor · draft" : "Editor"}</span>}
      </Link>
    </li>
  )

  return (
    <div className="flex flex-col gap-2" data-apps-panel>
      {apps.length > 0 && (
        <SearchInput ref={inputRef} value={query} onValueChange={(v) => { setQuery(v); setActive(0) }} placeholder="Search apps…" aria-label="Search apps"
          role="combobox" aria-expanded aria-controls={`${listId}-listbox`} aria-autocomplete="list"
          aria-activedescendant={ordered[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
          onKeyDown={onKeyDown} size="sm" data-apps-search />
      )}
      <ul id={`${listId}-listbox`} role="listbox" aria-label="Apps" className="max-h-[50vh] space-y-0.5 overflow-y-auto">
        {recent.length > 0 && <li role="presentation" className="px-2 pt-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">Recent</li>}
        {recent.map((app, i) => option(app, i))}
        {recent.length > 0 && rest.length > 0 && <li role="presentation" className="px-2 pt-2 text-2xs font-medium uppercase tracking-wide text-fg-subtle">All apps</li>}
        {rest.map((app, i) => option(app, recent.length + i))}
      </ul>
      {apps.length > 0 && searching && matches.length === 0 && (
        <p className="px-2 py-3 text-center text-sm text-fg-muted" role="status">No apps match “{query.trim()}”.</p>
      )}
      {apps.length === 0 && <p className="px-2 py-3 text-sm text-fg-muted">No apps have been shared with you yet.</p>}
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Link href="/apps" onClick={() => onClose?.()} className="rounded-md px-2 py-1 text-xs font-medium text-primary-text hover:bg-subtle">All apps</Link>
        {canManage && (
          <>
            <Link href="/apps?tab=design&new=1" onClick={() => onClose?.()} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg hover:bg-subtle" data-apps-new>
              <Plus className="size-3.5" aria-hidden /> New app
            </Link>
            <Link href="/apps?tab=design" onClick={() => onClose?.()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg hover:bg-subtle" data-apps-manage>
              <Settings2 className="size-3.5" aria-hidden /> Manage
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
