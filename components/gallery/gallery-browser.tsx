"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Search, SlidersHorizontal, X } from "lucide-react"
import {
  BROWSE_KIND_ORDER, BROWSE_KINDS, BROWSE_SORTS, browse, browseParams, DEFAULT_BROWSE_STATE, facetCounts, isFiltered,
  parseBrowseParams, SOLUTION_CATEGORIES, topTags, type BrowseItem, type BrowseKind, type BrowseSort, type BrowseState,
} from "@/lib/gallery/browse"
import { GALLERY_TRIGGERS, type GalleryTrigger } from "@/lib/gallery/types"

/**
 * The public gallery browser: a hero search, type tabs, category / tag /
 * facet filters, sort, a live results count and the card grid. The cards are
 * rendered on the server and handed in by key, so the client only filters and
 * orders them (small JS, no icon map). The first render is the unfiltered
 * list (static HTML for crawlers and no-JS); the URL's query is applied after
 * hydration and kept in step with replaceState (shareable, no reloads).
 */

const TRIGGERS = Object.keys(GALLERY_TRIGGERS) as GalleryTrigger[]

const chip = (active: boolean) => `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-ui font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-1 ${active
  ? "border-(color:--mkt-primary) bg-(color:--mkt-primary) text-(color:--mkt-paper)"
  : "border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) text-(color:--mkt-text) hover:border-(color:--mkt-ink)/30"}`

const listButton = (active: boolean) => `flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) ${active
  ? "bg-(color:--mkt-ink)/[0.07] font-semibold text-(color:--mkt-ink)"
  : "text-(color:--mkt-text) hover:bg-(color:--mkt-ink)/[0.04] hover:text-(color:--mkt-ink)"}`

function Count({ n, active = false }: { n: number | undefined; active?: boolean }) {
  return <span className={`num text-xs ${active ? "text-(color:--mkt-gold-light)" : "text-(color:--mkt-subtle)"}`}>{n ?? 0}</span>
}

function useBrowseState(base: BrowseState) {
  const [state, setState] = useState<BrowseState>(base)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    // One-time read of the URL after hydration.
    setState(parseBrowseParams(window.location.search, base))
    setReady(true)
    // base is fixed for the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!ready) return
    const params = browseParams(state, base)
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next)
  }, [state, ready, base])
  const update = (patch: Partial<BrowseState>) => setState((s) => ({ ...s, ...patch }))
  return { state, update, reset: () => setState({ ...base, sort: state.sort }) }
}

export interface GalleryBrowserProps {
  items: BrowseItem[]
  /** Server-rendered cards, one per item in the same order (keyed by item key). */
  cards: ReactNode[]
  /** Above the search box (breadcrumbs, eyebrow, the page's h1, intro). */
  hero: ReactNode
  /** Under the type tabs (calls to action, stats). */
  heroFooter?: ReactNode
  /** Shown between the hero and the grid until someone searches or filters. */
  featured?: ReactNode
  /** Lock the browser to one kind (/gallery/controls, /gallery/actions). */
  scope?: BrowseKind
  searchLabel: string
  placeholder: string
  /** Noun for the results count ("items", "controls"). */
  noun?: { one: string; many: string }
}

export function GalleryBrowser({ items, cards, hero, heroFooter, featured, scope, searchLabel, placeholder, noun = { one: "item", many: "items" } }: GalleryBrowserProps) {
  const base = useMemo<BrowseState>(() => ({ ...DEFAULT_BROWSE_STATE, kind: scope ?? "all" }), [scope])
  const { state, update, reset } = useBrowseState(base)
  const searchRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => browse(items, state), [items, state])
  const cardFor = useMemo(() => new Map(items.map((item, i) => [item.key, cards[i]])), [items, cards])
  const kindCounts = useMemo(() => facetCounts(items, state, "kind"), [items, state])
  const categoryCounts = useMemo(() => facetCounts(items, state, "category"), [items, state])
  const facetCount = useMemo(() => facetCounts(items, state, "facet"), [items, state])
  const triggerCounts = useMemo(() => facetCounts(items, state, "trigger"), [items, state])
  const sourceCounts = useMemo(() => facetCounts(items, state, "source"), [items, state])
  // Tags of the type and source in view (Community shows the community's tags, not ones that would match nothing).
  const tags = useMemo(() => topTags(items.filter((i) => (state.kind === "all" || i.kind === state.kind) && (state.source === "all" || i.source === state.source)), 14), [items, state.kind, state.source])
  const facets = useMemo(() => state.kind === "all" ? [] : [...new Set(items.filter((i) => i.facet && i.kind === state.kind).map((i) => i.facet!))], [items, state.kind])
  const hasCommunity = items.some((i) => i.source === "community")
  const showSolutionFilters = state.kind === "all" || state.kind === "solution"
  const filtered = isFiltered(state, base)
  const scopeTotal = items.filter((i) => !scope || i.kind === scope).length

  // "/" focuses the search, like the docs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || target?.closest("input, textarea, select, [contenteditable=true]")) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const active: Array<{ label: string; clear: () => void }> = [
    ...(state.q.trim() ? [{ label: `“${state.q.trim()}”`, clear: () => update({ q: "" }) }] : []),
    ...(!scope && state.kind !== "all" ? [{ label: BROWSE_KINDS[state.kind].label, clear: () => update({ kind: "all", facet: null }) }] : []),
    ...(state.category !== "all" ? [{ label: SOLUTION_CATEGORIES.find((c) => c.id === state.category)?.title ?? state.category, clear: () => update({ category: "all" }) }] : []),
    ...(state.facet ? [{ label: facets.find((f) => f.toLowerCase() === state.facet) ?? state.facet, clear: () => update({ facet: null }) }] : []),
    ...(state.tag ? [{ label: `#${state.tag}`, clear: () => update({ tag: null }) }] : []),
    ...(state.trigger !== "all" ? [{ label: GALLERY_TRIGGERS[state.trigger].label, clear: () => update({ trigger: "all" }) }] : []),
    ...(state.source !== "all" ? [{ label: state.source === "official" ? "Official" : "Community", clear: () => update({ source: "all" }) }] : []),
    ...(state.native ? [{ label: "No integrations needed", clear: () => update({ native: false }) }] : []),
  ]

  const filters = (
    <div className="grid gap-7">
      {showSolutionFilters && (
        <div role="group" aria-labelledby="gb-categories">
          <p id="gb-categories" className="px-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-subtle)">Categories</p>
          <ul className="mt-2 grid gap-0.5">
            <li><button type="button" aria-pressed={state.category === "all"} onClick={() => update({ category: "all" })} className={listButton(state.category === "all")}>All categories <Count n={categoryCounts.all} /></button></li>
            {SOLUTION_CATEGORIES.map((c) => (
              <li key={c.id}>
                <button type="button" aria-pressed={state.category === c.id} onClick={() => update({ category: state.category === c.id ? "all" : c.id, kind: state.kind === "all" ? "solution" : state.kind })} className={listButton(state.category === c.id)} data-testid={`category-${c.id}`}>
                  <span className="truncate">{c.title}</span> <Count n={categoryCounts[c.id]} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {facets.length > 1 && (
        <div role="group" aria-labelledby="gb-facets">
          <p id="gb-facets" className="px-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-subtle)">Kind</p>
          <ul className="mt-2 grid gap-0.5">
            <li><button type="button" aria-pressed={!state.facet} onClick={() => update({ facet: null })} className={listButton(!state.facet)}>Everything <Count n={facetCount.all} /></button></li>
            {facets.map((f) => (
              <li key={f}><button type="button" aria-pressed={state.facet === f.toLowerCase()} onClick={() => update({ facet: state.facet === f.toLowerCase() ? null : f.toLowerCase() })} className={listButton(state.facet === f.toLowerCase())}>{f === "Bundle" ? "Bundles" : `${f}s`} <Count n={facetCount[f]} /></button></li>
            ))}
          </ul>
        </div>
      )}
      {showSolutionFilters && (
        <div role="group" aria-labelledby="gb-starts">
          <p id="gb-starts" className="px-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-subtle)">How it starts</p>
          <ul className="mt-2 grid gap-0.5">
            {TRIGGERS.map((t) => (
              <li key={t}><button type="button" aria-pressed={state.trigger === t} onClick={() => update({ trigger: state.trigger === t ? "all" : t })} className={listButton(state.trigger === t)}>{GALLERY_TRIGGERS[t].label} <Count n={triggerCounts[t]} /></button></li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2 px-2.5 text-sm text-(color:--mkt-text)">
            <input type="checkbox" checked={state.native} onChange={(e) => update({ native: e.target.checked })} className="size-4 accent-(color:--mkt-green)" data-testid="native-filter" />
            No integrations needed
          </label>
        </div>
      )}
      {hasCommunity && (
        <div role="group" aria-labelledby="gb-source">
          <p id="gb-source" className="px-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-subtle)">Source</p>
          <ul className="mt-2 grid gap-0.5">
            {(["all", "official", "community"] as const).map((s) => (
              <li key={s}><button type="button" aria-pressed={state.source === s} onClick={() => update({ source: s })} className={listButton(state.source === s)}>{s === "all" ? "Everything" : s === "official" ? "Official" : "Community"} <Count n={sourceCounts[s]} /></button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )

  return (
    <>
      <section className="relative overflow-hidden border-b border-(color:--mkt-ink)/[0.06]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(176,138,84,0.16),transparent_70%)]" />
        <div aria-hidden="true" className="mkt-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-12 sm:pt-12">
          <div>{hero}</div>
          <form role="search" className="mt-8 max-w-2xl" onSubmit={(e) => { e.preventDefault(); document.getElementById("gallery-results")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }) }}>
            <label htmlFor="gallery-search" className="sr-only">{searchLabel}</label>
            <div className="group relative">
              <Search size={20} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-(color:--mkt-subtle)" />
              <input
                ref={searchRef}
                id="gallery-search"
                name="q"
                type="search"
                autoComplete="off"
                value={state.q}
                onChange={(e) => update({ q: e.target.value })}
                placeholder={placeholder}
                className="h-14 w-full rounded-2xl border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) pl-12 pr-24 text-base text-(color:--mkt-ink) shadow-[0_12px_32px_-18px_rgba(27,25,22,0.35)] outline-none transition placeholder:text-(color:--mkt-subtle) focus:border-(color:--mkt-bronze)/60 focus:ring-4 focus:ring-(color:--mkt-gold)/20 [&::-webkit-search-cancel-button]:hidden"
                data-testid="gallery-search"
              />
              {state.q
                ? <button type="button" onClick={() => { update({ q: "" }); searchRef.current?.focus() }} aria-label="Clear search" className="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-(color:--mkt-muted) outline-none hover:bg-(color:--mkt-ink)/[0.06] focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)"><X size={16} aria-hidden="true" /></button>
                : <kbd aria-hidden="true" className="absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-md border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-paper) px-1.5 py-0.5 font-mono text-xs text-(color:--mkt-muted) sm:block">/</kbd>}
            </div>
          </form>
          {!scope && (
            <div role="group" aria-label="Type" className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-testid="kind-tabs">
              <button type="button" aria-pressed={state.kind === "all"} onClick={() => update({ kind: "all", facet: null })} className={chip(state.kind === "all")}>Everything <Count n={kindCounts.all} active={state.kind === "all"} /></button>
              {BROWSE_KIND_ORDER.map((k) => (
                <button key={k} type="button" aria-pressed={state.kind === k} onClick={() => update({ kind: k, facet: null, ...(k !== "solution" ? { category: "all", trigger: "all", native: false } : {}) })} className={chip(state.kind === k)} data-testid={`kind-${k}`}>
                  {BROWSE_KINDS[k].label} <Count n={kindCounts[k]} active={state.kind === k} />
                </button>
              ))}
            </div>
          )}
          {heroFooter && <div>{heroFooter}</div>}
        </div>
      </section>

      {featured && !filtered && <div data-testid="featured">{featured}</div>}

      <section id="gallery-results" aria-label="Results" className="scroll-mt-20">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="grid gap-8 lg:grid-cols-[232px_minmax(0,1fr)]">
            <aside className="hidden lg:block">
              <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6">{filters}</div>
            </aside>

            <div className="min-w-0">
              <details className="group mb-5 rounded-xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2"><SlidersHorizontal size={16} aria-hidden="true" /> Filters</span>
                  {active.length > 0 && <span className="num rounded-full bg-(color:--mkt-primary) px-2 py-0.5 text-xs text-(color:--mkt-paper)">{active.length}</span>}
                </summary>
                <div className="border-t border-(color:--mkt-ink)/[0.07] px-2 py-4">{filters}</div>
              </details>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="num text-sm text-(color:--mkt-muted)" aria-live="polite" data-testid="results-count">
                  {visible.length === scopeTotal && !filtered
                    ? <><strong className="font-semibold text-(color:--mkt-ink)">{scopeTotal}</strong> {scopeTotal === 1 ? noun.one : noun.many}</>
                    : <><strong className="font-semibold text-(color:--mkt-ink)">{visible.length}</strong> of {scopeTotal} {scopeTotal === 1 ? noun.one : noun.many}</>}
                </p>
                <label className="inline-flex items-center gap-2 text-sm text-(color:--mkt-muted)">
                  Sort
                  <select value={state.sort} onChange={(e) => update({ sort: e.target.value as BrowseSort })} className="h-9 rounded-lg border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) px-2.5 text-sm font-medium text-(color:--mkt-ink) outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)" data-testid="gallery-sort">
                    {(Object.keys(BROWSE_SORTS) as BrowseSort[]).map((s) => <option key={s} value={s}>{BROWSE_SORTS[s]}</option>)}
                  </select>
                </label>
              </div>

              {active.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="active-filters">
                  {active.map((f) => (
                    <button key={f.label} type="button" onClick={f.clear} className="inline-flex items-center gap-1 rounded-full bg-(color:--mkt-ink)/[0.06] py-1 pl-3 pr-2 text-xs font-medium text-(color:--mkt-ink-soft) outline-none hover:bg-(color:--mkt-ink)/[0.1] focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)" aria-label={`Remove filter ${f.label}`}>
                      {f.label} <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                  <button type="button" onClick={reset} className="text-xs font-semibold text-(color:--mkt-bronze) hover:underline">Clear all</button>
                </div>
              )}

              {tags.length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" role="group" aria-label="Popular tags">
                  {tags.map(({ tag }) => (
                    <button key={tag} type="button" aria-pressed={state.tag === tag} onClick={() => update({ tag: state.tag === tag ? null : tag })} className={`${chip(state.tag === tag)} h-7 px-2.5 text-xs`}>#{tag}</button>
                  ))}
                </div>
              )}

              {visible.length ? (
                <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="gallery-grid">
                  {visible.map((item) => <li key={item.key} className="min-w-0">{cardFor.get(item.key)}</li>)}
                </ul>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-(color:--mkt-ink)/[0.15] bg-(color:--mkt-white)/60 px-6 py-14 text-center" data-testid="gallery-empty">
                  <Search size={28} aria-hidden="true" className="mx-auto text-(color:--mkt-subtle)" />
                  <p className="mt-3 font-semibold text-(color:--mkt-ink)">Nothing matches {state.q.trim() ? <>“{state.q.trim()}”</> : "those filters"}</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-(color:--mkt-muted)">Try fewer words, another category, or clear the filters.</p>
                  <button type="button" onClick={reset} className="mt-5 inline-flex h-9 items-center rounded-lg bg-(color:--mkt-primary) px-4 text-sm font-semibold text-(color:--mkt-paper) hover:bg-(color:--mkt-primary-hover)">Clear filters</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
