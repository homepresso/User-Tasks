"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Search, X } from "lucide-react"

/**
 * The /extensions gallery filter: category chips and a search box over
 * cards rendered on the server (handed in by key, same order as `items`).
 * The first render is the full grid (static HTML for crawlers and no-JS);
 * ?category= and ?q= are read after hydration and kept in step with
 * replaceState, so a filtered view can be shared.
 */

export type BrowserItem = { key: string; category: string; text: string }

const chip = (active: boolean) => `inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-1 ${active
  ? "border-(color:--mkt-primary) bg-(color:--mkt-primary) text-(color:--mkt-paper)"
  : "border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) text-(color:--mkt-text) hover:border-(color:--mkt-ink)/30"}`

export function ExtensionsBrowser({ items, cards, categories }: { items: BrowserItem[]; cards: ReactNode[]; categories: Array<{ id: string; label: string }> }) {
  const [category, setCategory] = useState("all")
  const [q, setQ] = useState("")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get("category")
    if (fromUrl && categories.some((c) => c.id === fromUrl)) setCategory(fromUrl)
    setQ(params.get("q") ?? "")
    setReady(true)
    // categories are fixed for the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams(window.location.search)
    if (category === "all") params.delete("category"); else params.set("category", category)
    if (q.trim()) params.set("q", q.trim()); else params.delete("q")
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next)
  }, [category, q, ready])

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const matchesQuery = (item: BrowserItem) => words.every((word) => item.text.includes(word))
  const visible = items.map((item, index) => ({ item, card: cards[index] })).filter(({ item }) => (category === "all" || item.category === category) && matchesQuery(item))
  const counts = useMemo(() => {
    const byQuery = items.filter((item) => words.every((word) => item.text.includes(word)))
    return Object.fromEntries([["all", byQuery.length], ...categories.map((c) => [c.id, byQuery.filter((item) => item.category === c.id).length])]) as Record<string, number>
  }, [items, categories, words.join(" ")]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Category" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-testid="extension-categories">
          {[{ id: "all", label: "Everything" }, ...categories].map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={chip(category === c.id)} data-testid={`extension-category-${c.id}`}>
              {c.label} <span className={`text-xs ${category === c.id ? "text-(color:--mkt-gold-light)" : "text-(color:--mkt-subtle)"}`}>{counts[c.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <form role="search" className="w-full lg:max-w-xs" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="extensions-search" className="sr-only">Search extensions</label>
          <div className="relative">
            <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-(color:--mkt-subtle)" />
            <input
              id="extensions-search"
              type="search"
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search: SharePoint, support…"
              className="h-11 w-full rounded-xl border border-(color:--mkt-ink)/[0.12] bg-(color:--mkt-white) pl-10 pr-10 text-base text-(color:--mkt-ink) outline-none placeholder:text-(color:--mkt-subtle) focus:border-(color:--mkt-bronze)/60 focus:ring-4 focus:ring-(color:--mkt-gold)/20 [&::-webkit-search-cancel-button]:hidden"
              data-testid="extensions-search"
            />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-(color:--mkt-muted) outline-none hover:bg-(color:--mkt-ink)/[0.06] focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)"><X size={15} aria-hidden="true" /></button>}
          </div>
        </form>
      </div>
      <p className="sr-only" aria-live="polite">{visible.length} {visible.length === 1 ? "item" : "items"} shown</p>
      {visible.length ? (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="extension-grid">
          {visible.map(({ item, card }) => <li key={item.key} id={`extension-${item.key}`} className="scroll-mt-24">{card}</li>)}
        </ul>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-(color:--mkt-ink)/[0.15] p-10 text-center text-sm text-(color:--mkt-text)">
          Nothing matches that. <button type="button" onClick={() => { setQ(""); setCategory("all") }} className="font-semibold text-(color:--mkt-bronze) hover:underline">Show everything</button>
        </div>
      )}
    </div>
  )
}
