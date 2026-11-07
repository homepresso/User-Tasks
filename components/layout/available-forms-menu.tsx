"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ChevronRight, FileText, Search, Star, X, type LucideIcon } from "lucide-react"
import { FavoriteStar, useFavoriteForms } from "@/components/home/favorite-star"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { formHref } from "@/lib/forms/form-page-url"
import {
  AVAILABLE_FORMS_QUERY_KEY, SIDEBAR_FORMS_SEARCH_MIN, withFavoriteForms, availableFormsExpandedKey, filterAvailableForms, highlightMatch, showsAvailableFormsSearch,
  type AvailableForm,
} from "@/lib/forms/available-forms"
import { cn } from "@/lib/utils"

/**
 * The sidebar's Forms menu ("Available forms"): forms marked available that
 * the signed-in person was given explicit access to (lib/forms/available-forms.ts).
 *
 * - Desktop sidebar: a disclosure arrow next to Forms expands the list
 *   inline; collapsed sidebar: a flyout beside the icon.
 * - Mobile drawer: the same list under a Forms disclosure.
 * - More than 10 forms: a search box (combobox + listbox: type-ahead,
 *   arrows, Enter opens, Escape clears / closes, matches highlighted).
 * - The expanded state is remembered per user (localStorage).
 * - No available forms: no arrow at all.
 */

/**
 * The signed-in person's available forms and whether they're still loading
 * (one cached query, shared by the sidebar menu and the Forms dropdown;
 * invalidated when availability or grants change).
 */
export function useAvailableFormsState(): { forms: AvailableForm[]; loading: boolean } {
  const { can } = usePermissions()
  const enabled = can("forms.submit")
  const query = useQuery({
    queryKey: AVAILABLE_FORMS_QUERY_KEY,
    queryFn: async () => ((await serverQuery("forms.available")) ?? []) as AvailableForm[],
    enabled,
    staleTime: 60_000,
  })
  // Favourites are pinned to the top, including ones not marked available.
  const favorites = useFavoriteForms()
  const forms = useMemo(
    () => withFavoriteForms(query.data ?? [], favorites.forms.map(({ id, name, description, system_name }) => ({ id, name, description, system_name }))),
    [query.data, favorites.forms],
  )
  return enabled ? { forms, loading: query.isPending } : { forms: [], loading: false }
}

/** The signed-in person's available forms (cached; invalidated when availability or grants change). */
export function useAvailableForms() {
  return useAvailableFormsState().forms
}

/** Expanded / collapsed, remembered per user in this browser. */
function useRememberedExpanded(): [boolean, (next: boolean) => void] {
  const { userId } = usePermissions()
  const key = availableFormsExpandedKey(userId)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    try { setExpanded(window.localStorage.getItem(key) === "1") } catch { /* storage unavailable */ }
  }, [key])
  const set = useCallback((next: boolean) => {
    setExpanded(next)
    try { window.localStorage.setItem(key, next ? "1" : "0") } catch { /* storage unavailable */ }
  }, [key])
  return [expanded, set]
}

function Highlighted({ name, query }: { name: string; query: string }) {
  return (
    <>
      {highlightMatch(name, query).map((part, i) => part.match
        ? <mark key={i} className="rounded-sm bg-transparent font-semibold underline decoration-2 underline-offset-2" style={{ color: "inherit", textDecorationColor: "var(--theme-sidebar-accent, var(--theme-primary))" }}>{part.text}</mark>
        : <span key={i}>{part.text}</span>)}
    </>
  )
}

type ListVariant = "sidebar" | "flyout" | "mobile" | "header"

/** Colour classes for the list on the sidebar palette, or on a card (the header panel). */
const SIDEBAR_TONE = {
  text: "text-[color:var(--theme-sidebar-text)]",
  muted: "text-[color:var(--theme-sidebar-muted)]",
  current: "text-[color:var(--theme-sidebar-accent,var(--theme-primary))]",
  hover: "hover:bg-[var(--sidebar-hover-bg)]",
  highlight: "bg-[var(--sidebar-hover-bg)] ring-1 ring-inset ring-[color:var(--theme-sidebar-accent,var(--theme-primary))]",
  input: "border-[color:var(--theme-sidebar-border)] bg-[var(--sidebar-hover-bg)] text-[color:var(--theme-sidebar-text)]",
}
const CARD_TONE = {
  text: "text-fg",
  muted: "text-fg-muted",
  current: "text-primary-text",
  hover: "hover:bg-subtle",
  highlight: "bg-subtle",
  input: "border-input-border bg-input text-fg placeholder:text-fg-subtle",
}

/**
 * The list of forms: a plain list, or a search box with a listbox once there
 * are `searchMin` forms (default: the sidebar's rule, more than 10).
 * `onClose` runs on Escape with nothing typed (collapse / close the flyout).
 * The `header` variant (the Forms dropdown, components/layout/header-forms-menu.tsx)
 * is a listbox even without the search box, and closes when a form is opened.
 */
export function AvailableFormsList({ forms, variant, onClose, autoFocus = false, searchMin = SIDEBAR_FORMS_SEARCH_MIN }: {
  forms: AvailableForm[]
  variant: ListVariant
  onClose?: () => void
  autoFocus?: boolean
  searchMin?: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const listId = useId()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const plainRef = useRef<HTMLUListElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)
  const searchable = showsAvailableFormsSearch(forms.length, searchMin)
  // Favourites are starred here; the plain list can star / unstar (Home → Favourite forms).
  const favorites = new Set(useFavoriteForms().forms.map((f) => f.id))
  const closesOnOpen = variant === "flyout" || variant === "header"
  const shown = searchable ? filterAvailableForms(forms, query) : forms
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1))

  useEffect(() => {
    if (!autoFocus) return
    // preventScroll: the flyout may not be placed yet, and focusing must never scroll the page.
    if (searchable) inputRef.current?.focus({ preventScroll: true })
    else if (variant === "header") listboxRef.current?.focus({ preventScroll: true })
    else plainRef.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true })
  }, [autoFocus, searchable, variant])

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!searchable && variant !== "header") return
    // Scroll the listbox only (scrollIntoView would also scroll the page, e.g. while the flyout is being placed).
    const option = document.getElementById(`${listId}-opt-${activeIndex}`)
    const box = option?.parentElement
    if (!option || !box) return
    if (option.offsetTop < box.scrollTop) box.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = option.offsetTop + option.offsetHeight - box.clientHeight
  }, [activeIndex, listId, searchable, variant])

  const open = (form: AvailableForm) => {
    setQuery("")
    setActive(0)
    router.push(formHref(form))
    if (closesOnOpen) onClose?.()
  }

  // The header panel floats on the elevated (card) surface; the others sit on the sidebar.
  const tone = variant === "header" ? CARD_TONE : SIDEBAR_TONE
  const itemClass = (highlighted = false) => cn(
    "flex min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors",
    tone.hover,
    variant === "mobile" ? "py-2 text-sm" : variant === "header" ? "h-8 text-ui" : "py-1 text-xs",
    highlighted && tone.highlight,
  )
  const itemStyle = (current: boolean): string => (current ? cn(tone.current, "font-semibold") : cn(tone.text, "font-medium"))

  /** Arrows / Home / End move, Enter opens, Escape clears the search, then closes. */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (shown.length) setActive((activeIndex + 1) % shown.length) }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (shown.length) setActive((activeIndex - 1 + shown.length) % shown.length) }
    else if (e.key === "Home" && (e.altKey || !searchable)) { e.preventDefault(); setActive(0) }
    else if (e.key === "End" && (e.altKey || !searchable)) { e.preventDefault(); setActive(Math.max(0, shown.length - 1)) }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[activeIndex]) open(shown[activeIndex]) }
    else if (e.key === "Escape") {
      e.preventDefault()
      if (query) { setQuery(""); setActive(0) } else onClose?.()
    }
  }

  const options = (
    <ul ref={listboxRef} id={`${listId}-listbox`} role="listbox" aria-label="Available forms"
      tabIndex={searchable ? undefined : 0}
      aria-activedescendant={!searchable && shown[activeIndex] ? `${listId}-opt-${activeIndex}` : undefined}
      onKeyDown={searchable ? undefined : onListKeyDown}
      className={cn("relative space-y-0.5 overflow-y-auto outline-none", variant === "flyout" || variant === "header" ? "max-h-[50vh]" : "max-h-72")}
      data-available-forms-listbox>
      {shown.map((form, i) => {
        const current = pathname === formHref(form)
        return (
          <li key={form.id} id={`${listId}-opt-${i}`} role="option" aria-selected={i === activeIndex}
            onMouseMove={() => { if (i !== activeIndex) setActive(i) }}
            data-available-form={form.id}>
            <Link href={formHref(form)} tabIndex={-1} className={cn(itemClass(i === activeIndex), itemStyle(current))}
              aria-current={current ? "page" : undefined} title={form.description ? `${form.name} — ${form.description}` : form.name}
              onClick={() => { if (closesOnOpen) onClose?.() }}>
              <span className="truncate"><Highlighted name={form.name} query={query} /></span>
              {favorites.has(form.id) && <Star className={cn("ml-auto size-3 shrink-0", tone.current)} fill="currentColor" aria-label="Favourite" />}
            </Link>
          </li>
        )
      })}
    </ul>
  )

  // The header dropdown is a listbox from the first form (arrows move the highlight, Enter opens).
  if (!searchable && variant === "header") return options

  if (!searchable) {
    return (
      <ul ref={plainRef} id={listId} className="space-y-0.5" aria-label="Available forms" data-available-forms-list
        onKeyDown={(e) => {
          const links = [...(plainRef.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])]
          const at = links.indexOf(document.activeElement as HTMLAnchorElement)
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            if (!links.length) return
            const next = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length
            links[next]?.focus()
          } else if (e.key === "Escape" && onClose) {
            e.preventDefault()
            onClose()
          }
        }}>
        {forms.map((form) => {
          const current = pathname === formHref(form)
          return (
            <li key={form.id} className="group flex items-center gap-0.5">
              <Link href={formHref(form)} className={cn(itemClass(), itemStyle(current), "flex-1")} aria-current={current ? "page" : undefined}
                title={form.description ? `${form.name} — ${form.description}` : form.name} onClick={() => { if (variant === "flyout") onClose?.() }}
                data-available-form={form.id}>
                <span className="truncate">{form.name}</span>
              </Link>
              <FavoriteStar formId={form.id} name={form.name} description={form.description} size={12}
                className={cn("p-0.5 focus-visible:opacity-100 group-hover:opacity-100", favorites.has(form.id) ? "opacity-100" : "opacity-0 max-md:opacity-100")} />
            </li>
          )
        })}
      </ul>
    )
  }

  const activeOption = shown[activeIndex]
  return (
    <div className="space-y-1" data-available-forms-search>
      <div className="relative">
        <Search className={cn("pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2", tone.muted)} aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search available forms"
          aria-autocomplete="list"
          aria-expanded={shown.length > 0}
          aria-controls={`${listId}-listbox`}
          aria-activedescendant={activeOption ? `${listId}-opt-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={`Search ${forms.length} forms`}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0) }}
          onKeyDown={onListKeyDown}
          className={cn(
            "w-full rounded-md border pl-7 pr-7",
            tone.input,
            variant === "mobile" ? "h-9 text-sm" : variant === "header" ? "h-8 text-ui" : "h-7 text-xs",
          )}
          data-available-forms-input
        />
        {query && (
          <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setActive(0); inputRef.current?.focus() }}
            className={cn("absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-0.5", tone.hover, tone.muted)}>
            <X className="size-3" aria-hidden />
          </button>
        )}
      </div>
      {options}
      {shown.length === 0 && (
        <p className={cn("px-2 py-1 text-2xs", tone.muted)} role="status">No forms match “{query.trim()}”</p>
      )}
      <p className="sr-only" aria-live="polite">{query ? `${shown.length} form${shown.length === 1 ? "" : "s"} found` : ""}</p>
    </div>
  )
}

const ROW_CLASS = "relative flex h-[max(var(--ds-nav-item-h),var(--ds-touch-min))] w-full items-center gap-2 rounded-md px-2 text-ui font-medium transition-colors hover:bg-[var(--sidebar-hover-bg)]"

/**
 * The sidebar Forms item with its disclosure arrow. `navItem` is the regular
 * nav link (people who can open the Forms library); without it the label
 * itself toggles the list.
 */
export function SidebarFormsMenu({ navItem, collapsed, icon: Icon = FileText }: {
  navItem?: React.ReactNode
  collapsed: boolean
  icon?: LucideIcon
}) {
  const forms = useAvailableForms()
  const [expanded, setExpanded] = useRememberedExpanded()
  const [focusList, setFocusList] = useState(false)
  const [flyout, setFlyout] = useState(false)
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const hasForms = forms.length > 0

  // Leaving the page closes the flyout.
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setFlyout(false)
  }

  if (!hasForms) return navItem ? <>{navItem}</> : null

  const toggle = () => {
    if (collapsed) { setFlyout((v) => !v); return }
    setFocusList(!expanded)
    setExpanded(!expanded)
  }
  const closeList = () => {
    if (collapsed) setFlyout(false)
    else setExpanded(false)
    toggleRef.current?.focus()
  }
  const isOpen = collapsed ? flyout : expanded
  const toggleLabel = `${isOpen ? "Hide" : "Show"} available forms (${forms.length})`

  return (
    <div data-sidebar-forms>
      <div className="relative">
        {navItem ? (
          <>
            {navItem}
            {/* The label opens the Forms library; the arrow expands the list. */}
            <button
              ref={toggleRef}
              type="button"
              onClick={toggle}
              aria-expanded={isOpen}
              aria-controls={isOpen ? listId : undefined}
              aria-label={toggleLabel}
              title={toggleLabel}
              className={cn(
                "absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-[var(--sidebar-hover-bg)] focus-visible:outline-none focus-visible:ring-2",
                collapsed ? "-right-2 h-5 w-4" : "right-1 h-7 w-7",
              )}
              style={{ color: "var(--theme-sidebar-muted)", ["--tw-ring-color" as string]: "var(--theme-sidebar-accent, var(--theme-primary))" }}
              data-available-forms-toggle
            >
              <ChevronRight className={cn("transition-transform", collapsed ? "h-3 w-3" : "h-3.5 w-3.5", isOpen && !collapsed && "rotate-90")} aria-hidden />
            </button>
          </>
        ) : (
          // No Forms library for this person: the whole row (label + arrow) toggles the list.
          <button ref={toggleRef} type="button" onClick={toggle} className={ROW_CLASS} style={{ color: "var(--theme-sidebar-text)" }}
            aria-expanded={isOpen} aria-controls={isOpen ? listId : undefined} title={collapsed ? toggleLabel : undefined}
            aria-label={collapsed ? toggleLabel : undefined} data-available-forms-toggle>
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="flex-1 text-left">Forms</span>}
            <ChevronRight className={cn("shrink-0 transition-transform", collapsed ? "absolute -right-1 h-3 w-3" : "h-3.5 w-3.5", isOpen && !collapsed && "rotate-90")}
              style={{ color: "var(--theme-sidebar-muted)" }} aria-hidden />
          </button>
        )}
      </div>
      {!collapsed && expanded && (
        <div id={listId} className="ml-7 mt-1 mb-1 pr-1" data-available-forms>
          <AvailableFormsList forms={forms} variant="sidebar" onClose={closeList} autoFocus={focusList} />
        </div>
      )}
      {collapsed && flyout && <FormsFlyout id={listId} anchor={toggleRef} forms={forms} onClose={closeList} />}
    </div>
  )
}

/** Collapsed sidebar: the list in a panel beside the icon (portalled: the nav scrolls and clips). */
function FormsFlyout({ id, anchor, forms, onClose }: { id: string; anchor: React.RefObject<HTMLButtonElement | null>; forms: AvailableForm[]; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.closest("[data-sidebar-forms]")?.getBoundingClientRect()
      if (!rect) return
      const height = panelRef.current?.offsetHeight ?? 0
      const rail = anchor.current?.closest("aside")?.getBoundingClientRect()
      setPos({ left: (rail?.right ?? rect.right) + 8, top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - height - 8)) })
    }
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [anchor, forms.length])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return
      onClose()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label="Available forms"
      className="themed-sidebar fixed z-50 w-64 rounded-xl border p-2 shadow-2xl"
      style={{ position: "fixed", borderColor: "var(--theme-sidebar-border)", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose() } }}
      data-available-forms-flyout
    >
      <p className="px-2 pb-1 pt-0.5 text-2xs font-medium text-[color:var(--theme-sidebar-muted)]">Forms</p>
      <AvailableFormsList forms={forms} variant="flyout" onClose={onClose} autoFocus />
    </div>,
    document.body,
  )
}

/** Mobile drawer: a Forms disclosure with the same list (nothing when there are no available forms). */
export function MobileFormsMenu() {
  const forms = useAvailableForms()
  const [expanded, setExpanded] = useRememberedExpanded()
  const [focusList, setFocusList] = useState(false)
  const listId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  if (forms.length === 0) return null
  return (
    <div data-mobile-forms>
      <button ref={toggleRef} type="button" onClick={() => { setFocusList(!expanded); setExpanded(!expanded) }}
        aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--sidebar-hover-bg)]"
        style={{ color: "var(--theme-sidebar-text)" }} data-available-forms-toggle>
        <FileText className="h-4 w-4 shrink-0 opacity-90" />
        <span className="flex-1 truncate text-left">Forms</span>
        <span className="num text-2xs text-[color:var(--theme-sidebar-muted)]">{forms.length}</span>
        <ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} aria-hidden />
      </button>
      {expanded && (
        <div id={listId} className="ml-7 mt-1 pr-1">
          <AvailableFormsList forms={forms} variant="mobile" autoFocus={focusList} onClose={() => { setExpanded(false); toggleRef.current?.focus() }} />
        </div>
      )}
    </div>
  )
}
