"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Clock, Download, Search, X } from "lucide-react"
import type { GalleryCard } from "@/lib/gallery/site"
import { GALLERY_CATEGORIES, GALLERY_TRIGGERS, type GalleryCategoryId, type GalleryTrigger } from "@/lib/gallery/types"
import { DIFFICULTY_LABEL, NativeBadge, NeedsChips, OriginBadge, PackageIcon, SystemChips, TRIGGER_ICONS, TriggerBadge } from "./gallery-ui"

type CategoryFilter = GalleryCategoryId | "all"
type TriggerFilter = GalleryTrigger | "all"
type SourceFilter = "all" | "official" | "community"

const TRIGGERS = Object.keys(GALLERY_TRIGGERS) as GalleryTrigger[]

function matches(card: GalleryCard, query: string): boolean {
  if (!query) return true
  const haystack = [card.title, card.summary, ...card.tags, ...(card.systems ?? []), card.author ?? "", card.native ? "no integrations needed native built-in" : "", GALLERY_TRIGGERS[card.trigger].label, GALLERY_CATEGORIES.find((c) => c.id === card.category)?.title ?? ""].join(" ").toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}

/** Reads ?category=&trigger=&source=&native=1&q= once on mount and keeps the URL in step (shareable filters, no navigation). */
function useFilterState() {
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [trigger, setTrigger] = useState<TriggerFilter>("all")
  const [source, setSource] = useState<SourceFilter>("all")
  const [nativeOnly, setNativeOnly] = useState(false)
  const [query, setQuery] = useState("")
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const c = params.get("category")
    const t = params.get("trigger")
    const s = params.get("source")
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL after hydration */
    if (c && GALLERY_CATEGORIES.some((x) => x.id === c)) setCategory(c as GalleryCategoryId)
    if (t && TRIGGERS.includes(t as GalleryTrigger)) setTrigger(t as GalleryTrigger)
    if (s === "official" || s === "community") setSource(s)
    setNativeOnly(params.get("native") === "1")
    setQuery(params.get("q") ?? "")
    setReady(true)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])
  useEffect(() => {
    if (!ready) return
    const params = new URLSearchParams()
    if (category !== "all") params.set("category", category)
    if (trigger !== "all") params.set("trigger", trigger)
    if (source !== "all") params.set("source", source)
    if (nativeOnly) params.set("native", "1")
    if (query.trim()) params.set("q", query.trim())
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next)
  }, [category, trigger, source, nativeOnly, query, ready])
  return { category, setCategory, trigger, setTrigger, source, setSource, nativeOnly, setNativeOnly, query, setQuery }
}

export function GalleryBrowser({ cards }: { cards: GalleryCard[] }) {
  const { category, setCategory, trigger, setTrigger, source, setSource, nativeOnly, setNativeOnly, query, setQuery } = useFilterState()

  const searched = useMemo(() => cards.filter((card) => matches(card, query.trim())
    && (source === "all" || (card.source ?? "official") === source)
    && (!nativeOnly || card.native)), [cards, query, source, nativeOnly])
  const communityCount = cards.filter((card) => card.source === "community").length
  const nativeCount = cards.filter((card) => card.native && (source === "all" || (card.source ?? "official") === source)).length
  const inCategory = useMemo(() => searched.filter((card) => category === "all" || card.category === category), [searched, category])
  const visible = useMemo(() => inCategory.filter((card) => trigger === "all" || card.trigger === trigger), [inCategory, trigger])
  const countFor = (id: CategoryFilter) => searched.filter((card) => (id === "all" || card.category === id) && (trigger === "all" || card.trigger === trigger)).length

  return (
    <div>
      <div className="flex flex-col gap-4">
        <label className="relative block max-w-xl">
          <span className="sr-only">Search packages</span>
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#857D6D]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: onboarding, invoice, webhook, decision table…"
            className="w-full rounded-xl border border-[#1B1916]/15 bg-[#FFFFFF] py-3 pl-10 pr-10 text-[15px] text-[#1B1916] placeholder:text-[#857D6D] focus:border-[#8A6D45] focus:outline-none focus:ring-2 focus:ring-[#B08A54]/30"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[#857D6D] hover:text-[#1B1916]">
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </label>

        <div role="tablist" aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {([{ id: "all", title: "All packages" }, ...GALLERY_CATEGORIES] as Array<{ id: CategoryFilter; title: string }>).map((item) => {
            const active = category === item.id
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(item.id)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${active ? "border-[#17150F] bg-[#17150F] text-[#FAF8F3]" : "border-[#1B1916]/15 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`}
              >
                {item.title} <span className={active ? "text-[#D9CDB5]" : "text-[#857D6D]"}>{countFor(item.id)}</span>
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Source and integrations">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#857D6D]">Show</span>
          {([["all", "Everything"], ["official", "Official"], ["community", `Community`]] as Array<[SourceFilter, string]>).map(([id, label]) => {
            const active = source === id
            const count = id === "all" ? cards.length : cards.filter((card) => (card.source ?? "official") === id).length
            return (
              <button key={id} type="button" aria-pressed={active} onClick={() => setSource(id)} data-testid={`source-${id}`}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${active ? "border-[#8A6D45] bg-[#B08A54]/[0.12] font-semibold text-[#5E4524]" : "border-[#1B1916]/12 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`}>
                {label} <span className="text-[#857D6D]">{count}</span>
              </button>
            )
          })}
          <button type="button" aria-pressed={nativeOnly} onClick={() => setNativeOnly(!nativeOnly)} data-testid="native-filter"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${nativeOnly ? "border-[#4F7A5B] bg-[#4F7A5B]/[0.12] font-semibold text-[#2F5A3B]" : "border-[#1B1916]/12 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`}>
            No integrations needed <span className="text-[#857D6D]">{nativeCount}</span>
          </button>
          {communityCount === 0 && source === "community" && <span className="text-xs text-[#6E6759]">No community packages yet: be the first to share one.</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How the process starts">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.14em] text-[#857D6D]">Starts</span>
          {(["all", ...TRIGGERS] as TriggerFilter[]).map((item) => {
            const active = trigger === item
            const Icon = item === "all" ? null : TRIGGER_ICONS[item]
            const count = inCategory.filter((card) => item === "all" || card.trigger === item).length
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setTrigger(item)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${active ? "border-[#8A6D45] bg-[#B08A54]/[0.12] font-semibold text-[#5E4524]" : "border-[#1B1916]/12 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`}
              >
                {Icon && <Icon size={14} aria-hidden="true" />}
                {item === "all" ? "Any way" : GALLERY_TRIGGERS[item].label}
                <span className="text-[#857D6D]">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-6 text-sm text-[#6E6759]" aria-live="polite">
        {visible.length === cards.length ? `${cards.length} packages` : `${visible.length} of ${cards.length} packages`}
      </p>

      {visible.length ? (
        <ul className="mt-3 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => <li key={`${card.source ?? "official"}-${card.slug}`}><PackageCard card={card} /></li>)}
        </ul>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-[#1B1916]/15 p-10 text-center">
          <p className="font-semibold">No package matches those filters.</p>
          <button type="button" onClick={() => { setQuery(""); setCategory("all"); setTrigger("all"); setSource("all"); setNativeOnly(false) }} className="mt-3 text-sm font-semibold text-[#8A6D45] hover:underline">Show all packages</button>
        </div>
      )}
    </div>
  )
}

export function PackageCard({ card }: { card: GalleryCard }) {
  const category = GALLERY_CATEGORIES.find((c) => c.id === card.category)
  return (
    <Link href={card.href ?? `/gallery/${card.slug}`} data-testid={`card-${card.slug}`} className="group flex h-full flex-col rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-5 transition hover:border-[#8A6D45]/45 hover:shadow-[0_12px_32px_rgba(27,25,22,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#B08A54]/[0.12] text-[#8A6D45]"><PackageIcon icon={card.icon} category={card.category} size={20} /></span>
        <TriggerBadge trigger={card.trigger} />
      </div>
      <p className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#8A6D45]">{category?.title} <OriginBadge source={card.source ?? "official"} /></p>
      <h3 className="mt-1 text-lg font-semibold leading-snug text-[#1B1916]">{card.title}</h3>
      {card.source === "community" && card.author && <p className="mt-0.5 text-xs text-[#6E6759]">by {card.author}{typeof card.downloads === "number" ? <> · <Download size={11} className="inline" aria-hidden="true" /> {card.downloads}</> : null}</p>}
      <p className="mt-2 flex-1 text-sm leading-6 text-[#4A463E]">{card.summary}</p>
      {(card.native || (card.systems ?? []).length > 0) && <div className="mt-3 flex flex-wrap items-center gap-1.5">{card.native && <NativeBadge />}<SystemChips systems={card.systems ?? []} /></div>}
      <div className="mt-4">{card.native ? <p className="text-xs text-[#6E6759]">Nothing to configure: works as soon as it is installed</p> : <NeedsChips needs={card.needs} />}</div>
      <div className="mt-4 flex items-center justify-between border-t border-[#1B1916]/[0.07] pt-3 text-xs text-[#6E6759]">
        <span className="inline-flex items-center gap-1"><Clock size={12} aria-hidden="true" /> ~{card.setup_minutes} min setup · {DIFFICULTY_LABEL[card.difficulty] ?? card.difficulty}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] group-hover:underline">Details <ArrowRight size={12} aria-hidden="true" /></span>
      </div>
    </Link>
  )
}
