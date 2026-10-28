"use client"

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { globalSearch } from "@/app/actions/search"
import {
  Search, FileText, Workflow, Bot, Database, Network, Users } from 'lucide-react'

interface SearchResult {
  id: string
  title: string
  subtitle?: string
  meta?: string
  href: string
  icon: React.ReactNode
  category: string
}

function getSearchableValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(getSearchableValue).filter(Boolean).join(" ")
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.name === "string") return record.name
    if (typeof record.title === "string") return record.title
    if (typeof record.label === "string") return record.label
    if (typeof record.url === "string") return record.url
    return Object.values(record).map(getSearchableValue).filter(Boolean).join(" ")
  }
  return String(value)
}

const CATEGORY_ORDER = ["Tasks", "Workflows", "Agents", "Integrations", "Data Tables", "Data Rows", "Team"]

const STATUS_LABELS: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", blocked: "Blocked",
  completed: "Completed", cancelled: "Cancelled",
}
const PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical", high: "High", medium: "Medium", low: "Low", none: "None",
}

function formatShortDate(d: string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
}

export function GlobalSearch() {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 384 })
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const showDropdown = focused && query.length >= 2

  useEffect(() => { setMounted(true) }, [])

  // Compute the dropdown's fixed position from the input's bounding
  // rect. Portalled to document.body so it escapes the topbar's
  // overflow clipping and always floats above whatever is on screen
  // (including dashboard cards, drawers, modals without their own
  // z-index stacking context).
  useLayoutEffect(() => {
    if (!showDropdown || !containerRef.current) return
    function updatePosition() {
      const rect = containerRef.current!.getBoundingClientRect()
      const width = Math.min(Math.max(rect.width, 384), window.innerWidth - 16)
      setPosition({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [showDropdown])

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        setFocused(true)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  // Click outside to close. The dropdown is portalled to document.body
  // so a click on it is "outside" the container ref — we need to also
  // check the dropdown's own ref so clicking a result doesn't get
  // treated as an outside click and dismiss before the nav fires.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as Node
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setFocused(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim() || q.length < 2) { setResults([]); return }
    setLoading(true)
    // Queried server-side as the user (lib/services/search): same ILIKE
    // matches, RLS and the search_custom_table_rows RPC for row content.
    const response = await globalSearch(q)
    if (!response.ok) {
      setResults([])
      setLoading(false)
      return
    }
    const found = response.data
    const lowerQ = q.toLowerCase()
    const all: SearchResult[] = []

    // Title, description, then status/priority keyword matches (deduplicated).
    found.tasks.forEach((t: any) => {
      const assigneeName = (t.assignee as any)?.display_name
      const parts = [STATUS_LABELS[t.status] ?? t.status, PRIORITY_LABELS[t.priority] ?? t.priority]
      if (assigneeName) parts.push(assigneeName)
      all.push({
        id: t.id,
        title: t.title,
        subtitle: parts.join(" · "),
        meta: t.due_date ? formatShortDate(t.due_date) ?? undefined : undefined,
        href: `/tasks/${t.id}`,
        icon: <FileText size={14} />,
        category: "Tasks",
      })
    })

    found.workflows.forEach((w: any) => all.push({
      id: w.id, title: w.name,
      subtitle: `${w.is_active ? "Active" : "Draft"} · ${w.trigger_type}`,
      href: `/automations/${w.id}`,
      icon: <Workflow size={14} />,
      category: "Workflows",
    }))

    found.agents.forEach((a: any) => all.push({
      id: a.id, title: a.name,
      subtitle: a.is_active ? "Active" : "Inactive",
      href: `/agents/${a.id}`,
      icon: <Bot size={14} />,
      category: "Agents",
    }))

    found.integrations.forEach((i: any) => all.push({
      id: i.id, title: i.name,
      subtitle: `${i.type} · ${i.is_active ? "Active" : "Inactive"}`,
      href: `/integrations/${i.id}`,
      icon: <Network size={14} />,
      category: "Integrations",
    }))

    found.tables.forEach((t: any) => all.push({
      id: t.id, title: t.name,
      href: `/data/${t.id}`,
      icon: <Database size={14} />,
      category: "Data Tables",
    }))

    // Row content results — RPC returns { id, table_id, data, table_name }.
    // Show "<matched snippet>" as the title and "<table> · <field>" as
    // the subtitle so the user sees which field matched.
    found.tableRows.forEach((r: any) => {
      const tableName = r.table_name ?? 'Table'
      let snippet = ''
      let fieldName = ''
      if (r.data && typeof r.data === 'object') {
        for (const [key, value] of Object.entries(r.data as Record<string, unknown>)) {
          const str = getSearchableValue(value)
          if (str.toLowerCase().includes(lowerQ)) {
            snippet = str.length > 60 ? str.slice(0, 60) + '…' : str
            fieldName = key
            break
          }
        }
      }
      all.push({
        id: r.id,
        title: fieldName ? `${fieldName}: ${snippet || 'Match found'}` : snippet || `Row ${String(r.id).slice(0, 8)}`,
        subtitle: fieldName ? `${tableName} · matching column` : tableName,
        href: `/data/${r.table_id}`,
        icon: <Database size={14} />,
        category: "Data Rows",
      })
    })

    found.members.forEach((m: any) => all.push({
      id: m.id, title: m.display_name,
      subtitle: m.email,
      href: `/team`,
      icon: <Users size={14} />,
      category: "Team",
    }))

    setResults(all)
    setSelectedIndex(0)
    setLoading(false)
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => search(query), 150)
    return () => clearTimeout(timer)
  }, [query, search])

  function handleSelect(href: string) {
    setFocused(false)
    setMobileOpen(false)
    setQuery("")
    setResults([])
    router.push(href)
  }

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || results.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (results[selectedIndex]) handleSelect(results[selectedIndex].href)
    } else if (e.key === "Escape") {
      setFocused(false)
      setMobileOpen(false)
    }
  }

  // Group results by category with flat indices for keyboard navigation
  const grouped: { category: string; items: (SearchResult & { flatIdx: number })[] }[] = []
  let idx = 0
  for (const cat of CATEGORY_ORDER) {
    const items = results.filter(r => r.category === cat).map(r => ({ ...r, flatIdx: idx++ }))
    if (items.length > 0) grouped.push({ category: cat, items })
  }

  return (
    <>
    {/* Mobile: search is a topbar icon that opens a full-width overlay bar. */}
    {!mobileOpen && (
      <button
        type="button"
        className="rounded-md p-2 transition-colors hover:bg-[var(--theme-row-highlight)] md:hidden"
        style={{ color: "var(--theme-topbar-text)" }}
        aria-label="Search"
        onClick={() => {
          setMobileOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <Search className="h-4 w-4" />
      </button>
    )}
    <div
      ref={containerRef}
      className={
        mobileOpen
          ? "fixed left-2 right-2 top-2 z-[1001] md:relative md:inset-auto md:z-auto md:block"
          : "relative hidden md:block"
      }
    >
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 z-10 pointer-events-none" style={{ color: "var(--theme-muted-text)" }} />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="h-8 w-64 max-md:h-10 max-md:w-full rounded-lg border pl-9 pr-12 text-sm outline-none transition-all md:focus:w-80 focus:ring-2 focus:ring-[color:var(--theme-primary)]/30"
        style={{
          borderColor: "var(--theme-surface-border)",
          backgroundColor: "var(--theme-surface)",
          color: "var(--theme-card-text)",
        }}
      />
      <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:inline-flex items-center gap-0.5 rounded border px-1.5 text-[10px] font-mono pointer-events-none"
        style={{ borderColor: "var(--theme-surface-border)", color: "var(--theme-muted-text)" }}>
        ⌘K
      </kbd>

      {/* Autocomplete dropdown — portalled to document.body with fixed
          positioning so it always overlays everything on screen and can
          never be clipped by parent overflow-hidden containers (the
          topbar + dashboard shell both create stacking contexts that
          previously hid the dropdown behind page content). */}
      {showDropdown && mounted && createPortal(
        <div
          ref={dropdownRef}
          className="fixed max-h-96 overflow-y-auto rounded-xl border shadow-xl"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${position.width}px`,
            zIndex: 1000,
            backgroundColor: "var(--theme-card-bg)",
            borderColor: "var(--theme-surface-border)",
          }}
        >
          {loading && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--theme-muted-text)" }}>Searching...</p>
          )}

          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-xs" style={{ color: "var(--theme-muted-text)" }}>
              No results for &quot;{query}&quot;
            </p>
          )}

          {!loading && grouped.map(group => (
            <div key={group.category}>
              <p className="px-4 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--theme-muted-text)" }}>
                {group.category}
              </p>
              {group.items.map(item => {
                const isSelected = item.flatIdx === selectedIndex
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.href)}
                    onMouseEnter={() => setSelectedIndex(item.flatIdx)}
                    className="flex items-center gap-3 w-full px-4 py-2 text-left text-sm transition-colors"
                    style={{
                      backgroundColor: isSelected ? "var(--theme-surface)" : "transparent",
                      color: "var(--theme-card-text)",
                    }}
                  >
                    <span className="shrink-0" style={{ color: "var(--theme-primary-text)" }}>{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-sm">{item.title}</p>
                      {item.subtitle && (
                        <p className="truncate text-[11px]" style={{ color: "var(--theme-muted-text)" }}>{item.subtitle}</p>
                      )}
                    </div>
                    {item.meta && (
                      <span className="shrink-0 text-[10px]" style={{ color: "var(--theme-muted-text)" }}>{item.meta}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
    {mobileOpen && (
      <button
        type="button"
        className="fixed inset-0 z-[1000] md:hidden"
        aria-label="Close search"
        onClick={() => { setMobileOpen(false); setFocused(false) }}
      />
    )}
    </>
  )
}
