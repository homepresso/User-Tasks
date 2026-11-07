"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import * as RadixDialog from "@radix-ui/react-dialog"
import { Command } from "cmdk"
import { globalSearch } from "@/app/actions/search"
import type { SearchHit, SearchHitKind, SearchSection } from "@/lib/services/search"
import { usePermissions } from "@/lib/permissions-context"
import { searchPageShortcuts, visiblePageShortcuts } from "@/lib/search/pages"
import { searchDocsIndex, searchGalleryIndex, type DocsIndexEntry, type GalleryIndexItem } from "@/lib/search/static-indexes"
import { matchScore } from "@/lib/search/rank"
import { cn } from "@/lib/utils"
import { overlayClass } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { OPEN_COMMAND_EVENT, openCommandPalette } from "./command-palette-event"
import { CREATE_ACTIONS, type CreateAction } from "./create-actions"
import { readRecentPages, type RecentPage } from "./recent-pages"
import {
  Search, FileInput, Globe, SquareCheck, Workflow, CalendarClock, History, Database, Rows3, BarChart3, Scale, Mail,
  Bot, Network, Plug, Link2, Server, Puzzle, Package, Archive, Inbox, Paperclip, UsersRound, User, Compass,
  LayoutGrid, BookOpen, ChevronDown, ExternalLink, Clock, Plus, CornerDownLeft, X,
} from "lucide-react"

/**
 * The ⌘K command palette (docs/design/ui-polish-spec.md §4.3), on cmdk in a
 * Radix dialog: 640px, elev-3, 12vh from the top (full screen on phones).
 *
 * - Empty: Recent pages, Pages, Actions ("Create workflow").
 * - Typing (2+ characters): lib/services/search as the user (every object
 *   type they may open, per-type permission gates, Forms first, "Show
 *   more"), the navigation shortcuts (lib/search/pages), matching actions,
 *   and the static gallery / docs indexes.
 * - Keyboard: ↑↓ move, ↵ opens, ⌘↵ opens in a new tab, Esc closes.
 *
 * Opened by ⌘K / Ctrl+K anywhere, the top-bar trigger, or
 * `openCommandPalette()` (the 404 page's "Search").
 */

type ClientKind = "page" | "gallery" | "doc" | "recent" | "action"

interface Row {
  key: string
  section: string
  kind: SearchHitKind | ClientKind | "more"
  title: string
  subtitle?: string
  meta?: string
  href?: string
  /** Opens in a new tab (docs, gallery). */
  external?: boolean
}

interface Group {
  key: string
  label: string
  rows: Row[]
  more: boolean
}

const KIND_ICONS: Record<Row["kind"], React.ComponentType<{ className?: string }>> = {
  form: FileInput, form_page: Globe, task: SquareCheck, workflow: Workflow, schedule: CalendarClock, run: History,
  table: Database, row: Rows3, report: BarChart3, rule: Scale, email_template: Mail, agent: Bot, integration: Network,
  connector: Plug, reference: Link2, mcp_server: Server, custom_step: Puzzle, package: Package,
  retention_policy: Archive, submission: Inbox, file: Paperclip, team: UsersRound, person: User,
  page: Compass, gallery: LayoutGrid, doc: BookOpen, more: ChevronDown, recent: Clock, action: Plus,
}

/** Short type tag on the right of a result row. */
const KIND_TAG: Partial<Record<Row["kind"], string>> = {
  form: "Form", form_page: "Form page", task: "Task", workflow: "Workflow", schedule: "Schedule", run: "Run", table: "Table",
  row: "Row", report: "Report", rule: "Rule", email_template: "Template", agent: "Agent", integration: "Integration",
  connector: "Connector", reference: "Reference", mcp_server: "MCP server", custom_step: "Custom step", package: "Package",
  retention_policy: "Policy", submission: "Submission", file: "File", team: "Team", person: "Person", page: "Page",
  gallery: "Gallery", doc: "Docs",
}

const DEBOUNCE_MS = 200
const CLIENT_LIMIT = 4
const CLIENT_MORE_LIMIT = 20

/** Static public indexes, fetched once per page load the first time someone searches. */
let docsIndex: Promise<DocsIndexEntry[]> | null = null
let galleryIndex: Promise<GalleryIndexItem[]> | null = null
function loadDocsIndex() {
  docsIndex ??= fetch("/docs/search-index.json").then((r) => (r.ok ? r.json() : [])).then((j) => (Array.isArray(j) ? j : [])).catch(() => [])
  return docsIndex
}
function loadGalleryIndex() {
  galleryIndex ??= fetch("/gallery/index.json").then((r) => (r.ok ? r.json() : null)).then((j) => (Array.isArray(j?.packages) ? j.packages : [])).catch(() => [])
  return galleryIndex
}

function hitRow(section: string, hit: SearchHit): Row {
  // Forms open inside the app (/fill/<id>); their shareable links open without the shell.
  const href = hit.href
  return { key: `${section}:${hit.kind}:${hit.id}`, section, kind: hit.kind, title: hit.title, subtitle: hit.subtitle, meta: hit.meta, href }
}

function actionRow(action: CreateAction): Row {
  return { key: `actions:${action.id}`, section: "actions", kind: "action", title: action.paletteLabel, href: action.href }
}

function recentRow(page: RecentPage): Row {
  return { key: `recent:${page.href}`, section: "recent", kind: "recent", title: page.title, subtitle: page.area, href: page.href }
}

/** The top-bar trigger: a 280px search-styled button with ⌘K; an icon on phones. */
export function CommandTrigger() {
  return (
    <>
      <button
        type="button"
        onClick={() => openCommandPalette()}
        className="hidden h-8 w-[280px] items-center gap-2 rounded-md border border-input-border bg-input px-2.5 text-left text-ui text-fg-subtle transition-colors duration-[var(--ds-dur-fast)] hover:border-border-strong lg:inline-flex"
        aria-label="Search or jump to (⌘K)"
        aria-haspopup="dialog"
        data-command-trigger
      >
        <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <Kbd aria-hidden>⌘K</Kbd>
      </button>
      <IconButton label="Search" kbd="⌘K" icon={<Search />} onClick={() => openCommandPalette()} className="lg:hidden" aria-haspopup="dialog" />
    </>
  )
}

/** Mounted once by the dashboard shell. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    function onOpen(e: Event) {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query
      if (typeof q === "string") setQuery(q)
      setOpen(true)
    }
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen)
    }
  }, [])

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery("") }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content
          className={cn(
            "ds-dialog fixed left-1/2 top-[12vh] z-50 flex max-h-[min(560px,76vh)] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-elevated text-fg shadow-elev-3 outline-none",
            "max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:translate-x-0 max-sm:rounded-none",
          )}
          aria-describedby={undefined}
          data-testid="command-palette"
        >
          <RadixDialog.Title className="sr-only">Search or jump to</RadixDialog.Title>
          {open && <Palette query={query} setQuery={setQuery} onClose={() => { setOpen(false); setQuery("") }} />}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

function Palette({ query, setQuery, onClose }: { query: string; setQuery: (q: string) => void; onClose: () => void }) {
  const router = useRouter()
  const { permissions, can } = usePermissions()
  const [sections, setSections] = useState<SearchSection[]>([])
  const [docs, setDocs] = useState<DocsIndexEntry[]>([])
  const [gallery, setGallery] = useState<GalleryIndexItem[]>([])
  const [clientLimits, setClientLimits] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState("")
  const [recent, setRecent] = useState<RecentPage[]>([])
  // Only the latest request may update the results (typing fast).
  const requestSeq = useRef(0)

  const trimmed = query.trim()
  const searching = trimmed.length >= 2
  const canGallery = permissions.has("packages.view")

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is read on open (client only)
  useEffect(() => { setRecent(readRecentPages()) }, [])

  const actions = useMemo(() => CREATE_ACTIONS.filter((a) => can(a.requires)), [can])

  const search = useCallback(async (q: string) => {
    const seq = ++requestSeq.current
    if (q.length < 2) { setSections([]); setLoading(false); setError(false); return }
    setLoading(true)
    setClientLimits({})
    const [response, docsEntries, galleryItems] = await Promise.all([
      globalSearch(q).catch(() => null),
      loadDocsIndex(),
      canGallery ? loadGalleryIndex() : Promise.resolve([] as GalleryIndexItem[]),
    ])
    if (seq !== requestSeq.current) return
    setDocs(docsEntries)
    setGallery(galleryItems)
    setError(!response?.ok)
    setSections(response?.ok ? response.data.sections : [])
    setLoading(false)
  }, [canGallery])

  useEffect(() => {
    const timer = setTimeout(() => { void search(trimmed) }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmed, search])

  async function showMore(sectionKey: string) {
    if (["pages", "gallery", "docs"].includes(sectionKey)) {
      setClientLimits((limits) => ({ ...limits, [sectionKey]: CLIENT_MORE_LIMIT }))
      return
    }
    const seq = requestSeq.current
    setLoadingMore(sectionKey)
    const response = await globalSearch(trimmed, { section: sectionKey as SearchSection["key"] }).catch(() => null)
    setLoadingMore(null)
    if (seq !== requestSeq.current || !response?.ok) return
    const expanded = response.data.sections.find((s) => s.key === sectionKey)
    if (expanded) setSections((current) => current.map((s) => (s.key === sectionKey ? expanded : s)))
  }

  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    if (!searching) {
      // Start page: recent pages, then the main destinations and the create actions.
      const here = typeof window === "undefined" ? "" : window.location.pathname + window.location.search
      const rec = recent.filter((r) => r.href !== here && (!trimmed || matchScore(r.title, trimmed) > 0)).slice(0, 5)
      if (rec.length) out.push({ key: "recent", label: "Recent", rows: rec.map(recentRow), more: false })
      const starter = trimmed
        ? visiblePageShortcuts(permissions).filter((p) => matchScore(p.title, trimmed) > 0).slice(0, 8)
        : searchPageShortcutsStarter(permissions)
      if (starter.length) out.push({ key: "pages", label: "Pages", more: false, rows: starter.map((p) => ({ key: `pages:${p.href}`, section: "pages", kind: "page" as const, title: p.title, subtitle: p.area, href: p.href })) })
      const acts = actions.filter((a) => !trimmed || matchScore(`${a.paletteLabel} ${a.keywords}`, trimmed) > 0)
      if (acts.length) out.push({ key: "actions", label: "Actions", rows: acts.map(actionRow), more: false })
      return out
    }
    for (const s of sections) out.push({ key: s.key, label: s.label, more: s.more, rows: s.hits.map((hit) => hitRow(s.key, hit)) })
    const client = (key: string, label: string, all: Row[]) => {
      const limit = clientLimits[key] ?? CLIENT_LIMIT
      if (all.length) out.push({ key, label, rows: all.slice(0, limit), more: all.length > limit })
    }
    client("pages", "Pages", searchPageShortcuts(trimmed, permissions, CLIENT_MORE_LIMIT + 1).map((p) => ({
      key: `pages:${p.href}`, section: "pages", kind: "page", title: p.title, subtitle: p.area, href: p.href,
    })))
    const acts = actions.filter((a) => matchScore(`${a.paletteLabel} ${a.keywords}`, trimmed) > 0)
    if (acts.length) out.push({ key: "actions", label: "Actions", rows: acts.map(actionRow), more: false })
    if (canGallery) {
      client("gallery", "Gallery", searchGalleryIndex(gallery, trimmed, CLIENT_MORE_LIMIT + 1).map((p) => ({
        key: `gallery:${p.slug}`, section: "gallery", kind: "gallery", title: p.title, subtitle: p.summary, href: `/gallery/${p.slug}`, external: true,
      })))
    }
    client("docs", "Docs", searchDocsIndex(docs, trimmed, CLIENT_MORE_LIMIT + 1).map((d) => ({
      key: `docs:${d.h}`, section: "docs", kind: "doc", title: d.t, subtitle: d.s, href: d.h, external: true,
    })))
    return out
  }, [searching, trimmed, recent, permissions, actions, sections, clientLimits, canGallery, gallery, docs])

  const rowsByKey = useMemo(() => {
    const map = new Map<string, Row>()
    for (const g of groups) {
      for (const r of g.rows) map.set(r.key, r)
      if (g.more) map.set(`${g.key}:more`, { key: `${g.key}:more`, section: g.key, kind: "more", title: `Show more ${g.label.toLowerCase()}` })
    }
    return map
  }, [groups])

  function activate(row: Row, newTab = false) {
    if (row.kind === "more") { void showMore(row.section); return }
    if (!row.href) return
    onClose()
    if (row.external || newTab) window.open(row.href, "_blank", "noopener,noreferrer")
    else router.push(row.href)
  }

  const showSkeleton = searching && loading && sections.length === 0
  const empty = !showSkeleton && groups.length === 0

  return (
    <Command
      label="Search or jump to"
      shouldFilter={false}
      loop
      value={selected}
      onValueChange={setSelected}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          const row = rowsByKey.get(selected)
          if (row) { e.preventDefault(); activate(row, true) }
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
        <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search or jump to…"
          // The open palette is the focus context: no extra ring on its input.
          className="h-full min-w-0 flex-1 bg-transparent text-base text-fg placeholder:text-fg-subtle focus-visible:shadow-none"
          data-testid="global-search-input"
        />
        <RadixDialog.Close asChild>
          <button type="button" className="inline-flex items-center rounded-sm max-sm:hidden" aria-label="Close"><Kbd>Esc</Kbd></button>
        </RadixDialog.Close>
        <RadixDialog.Close asChild>
          <IconButton label="Close" icon={<X />} size="sm" className="sm:hidden" noTooltip />
        </RadixDialog.Close>
      </div>

      <Command.List className="min-h-0 flex-1 overflow-y-auto scrollbar-thin p-2" data-testid="global-search-results">
        {showSkeleton && (
          <Command.Loading>
            <div className="space-y-1 p-1" aria-label="Searching">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-9 items-center gap-3 px-2">
                  <Skeleton className="size-4 rounded-sm" />
                  <Skeleton className={cn("h-2.5", i === 1 ? "w-1/3" : "w-1/2")} />
                </div>
              ))}
            </div>
          </Command.Loading>
        )}
        {empty && (
          <EmptyState
            size="sm"
            variant={error ? "error" : "no-results"}
            title={error ? "Search failed" : trimmed ? `No results for “${trimmed}”` : "Nothing here yet"}
            description={error ? "Please try again." : "Try another word, or open a page from the menu."}
          />
        )}
        {groups.map((group) => (
          <Command.Group
            key={group.key}
            heading={group.label}
            data-search-section={group.key}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted"
          >
            {group.rows.map((row) => <ResultRow key={row.key} row={row} onSelect={() => activate(row)} />)}
            {group.more && (
              <Command.Item
                value={`${group.key}:more`}
                onSelect={() => void showMore(group.key)}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-xs font-medium text-primary-text data-[selected=true]:bg-subtle"
              >
                <ChevronDown className="size-3.5" aria-hidden />
                {loadingMore === group.key ? "Loading…" : `Show more ${group.label.toLowerCase()}`}
              </Command.Item>
            )}
          </Command.Group>
        ))}
      </Command.List>

      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border-subtle px-4 text-2xs text-fg-muted max-sm:hidden" aria-hidden>
        <span className="inline-flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
        <span className="inline-flex items-center gap-1"><Kbd><CornerDownLeft className="size-3" /></Kbd> open</span>
        <span className="inline-flex items-center gap-1"><Kbd>⌘</Kbd><Kbd><CornerDownLeft className="size-3" /></Kbd> open in new tab</span>
        <span className="ml-auto inline-flex items-center gap-1"><Kbd>esc</Kbd> close</span>
      </div>
    </Command>
  )
}

function ResultRow({ row, onSelect }: { row: Row; onSelect: () => void }) {
  const Icon = KIND_ICONS[row.kind]
  const tag = row.meta ?? KIND_TAG[row.kind]
  return (
    <Command.Item
      value={row.key}
      onSelect={onSelect}
      data-search-kind={row.kind}
      className="group/row flex h-9 cursor-default items-center gap-3 rounded-md px-2 text-left data-[selected=true]:bg-subtle"
    >
      <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-ui font-medium text-fg">{row.title}</span>
        {row.subtitle && row.subtitle !== row.title && <span className="min-w-0 truncate text-xs text-fg-muted max-sm:hidden">{row.subtitle}</span>}
      </span>
      {row.external && <ExternalLink className="size-3.5 shrink-0 text-fg-subtle" aria-label="Opens in a new tab" />}
      {tag && <span className="shrink-0 text-xs text-fg-subtle group-data-[selected=true]/row:hidden">{tag}</span>}
      <CornerDownLeft className="hidden size-3.5 shrink-0 text-fg-muted group-data-[selected=true]/row:block" aria-hidden />
    </Command.Item>
  )
}

/** The palette's start list: the main destinations the person can open. */
function searchPageShortcutsStarter(permissions: Iterable<string>) {
  const starters = ["/home", "/tasks", "/automations", "/automations/forms", "/data", "/reports", "/integrations", "/settings"]
  const all = visiblePageShortcuts(permissions)
  return starters.map((href) => all.find((p) => p.href === href)).filter((p): p is NonNullable<typeof p> => !!p)
}
