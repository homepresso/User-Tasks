"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Clock, Download } from "lucide-react"
import { SearchInput } from "@/components/ui/input"
import { SegmentedControl } from "@/components/ui/segmented-control"
import type { GalleryCard } from "@/lib/gallery/site"
import { GALLERY_CATEGORIES, GALLERY_NEEDS, GALLERY_TRIGGERS, type GalleryCategoryId, type GalleryTrigger } from "@/lib/gallery/types"
import { CardPreview, DIFFICULTY_LABEL, galleryCardClass, NativeBadge, OriginBadge, PackageIcon, SystemChips, TRIGGER_ICONS, TriggerBadge } from "./gallery-ui"

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

/** A filter pill (category, "No integrations needed"): a toggle with a count. */
export function FilterTag({ active, onClick, children, count, testId, role, tone = "neutral" }: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
  testId?: string
  role?: "tab"
  tone?: "neutral" | "success"
}) {
  return (
    <button
      type="button"
      role={role}
      {...(role === "tab" ? { "aria-selected": active } : { "aria-pressed": active })}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-ui font-medium transition-colors duration-[var(--ds-dur-fast)] ${active
        ? tone === "success" ? "border-[#4F7A5B] bg-[#4F7A5B]/[0.12] text-[#2F5A3B]" : "border-[#17150F] bg-[#17150F] text-[#FAF8F3]"
        : "border-[#1B1916]/15 bg-[#FFFFFF] text-[#4A463E] hover:border-[#1B1916]/30"}`}
    >
      {children}
      {count !== undefined && <span className={`num ${active && tone !== "success" ? "text-[#D9CDB5]" : "text-[#857D6D]"}`}>{count}</span>}
    </button>
  )
}

/** The shared search field of the public gallery pages (40px, the marketing scale). */
export function GallerySearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return (
    <div className="max-w-xl">
      <SearchInput size="lg" value={value} onValueChange={onChange} placeholder={placeholder} aria-label={label} className="bg-[#FFFFFF]" />
    </div>
  )
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
  const sourceCount = (id: SourceFilter) => id === "all" ? cards.length : cards.filter((card) => (card.source ?? "official") === id).length

  return (
    <div>
      <div className="flex flex-col gap-4">
        <GallerySearch value={query} onChange={setQuery} label="Search packages" placeholder="Search: onboarding, invoice, webhook, decision table…" />

        <div role="tablist" aria-label="Categories" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {([{ id: "all", title: "All packages" }, ...GALLERY_CATEGORIES.filter((c) => c.id !== "form-controls")] as Array<{ id: CategoryFilter; title: string }>).map((item) => (
            <FilterTag key={item.id} role="tab" active={category === item.id} onClick={() => setCategory(item.id)} count={countFor(item.id)}>{item.title}</FilterTag>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#857D6D]">Show</span>
            <SegmentedControl aria-label="Source" value={source} onValueChange={setSource}
              options={([["all", "Everything"], ["official", "Official"], ["community", "Community"]] as Array<[SourceFilter, string]>).map(([id, label]) => ({
                value: id, text: <>{label} <span className="num text-[#857D6D]">{sourceCount(id)}</span></>,
              }))} />
            <FilterTag active={nativeOnly} onClick={() => setNativeOnly(!nativeOnly)} count={nativeCount} testId="native-filter" tone="success">No integrations needed</FilterTag>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#857D6D]">Starts</span>
            <SegmentedControl aria-label="How the process starts" value={trigger} onValueChange={setTrigger}
              options={(["all", ...TRIGGERS] as TriggerFilter[]).map((item) => {
                const Icon = item === "all" ? null : TRIGGER_ICONS[item]
                const count = inCategory.filter((card) => item === "all" || card.trigger === item).length
                return { value: item, icon: Icon ? <Icon /> : undefined, text: <>{item === "all" ? "Any way" : GALLERY_TRIGGERS[item].label} <span className="num text-[#857D6D]">{count}</span></> }
              })} />
          </div>
          {communityCount === 0 && source === "community" && <span className="text-xs text-[#6E6759]">No community packages yet: be the first to share one.</span>}
        </div>
      </div>

      <p className="num mt-6 text-sm text-[#6E6759]" aria-live="polite">
        {visible.length === cards.length ? `${cards.length} packages` : `${visible.length} of ${cards.length} packages`}
      </p>

      {visible.length ? (
        <ul className="mt-3 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => <li key={`${card.source ?? "official"}-${card.slug}`}><PackageCard card={card} /></li>)}
        </ul>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-[#1B1916]/15 p-10 text-center">
          <p className="font-semibold">No package matches those filters.</p>
          <button type="button" onClick={() => { setQuery(""); setCategory("all"); setTrigger("all"); setSource("all"); setNativeOnly(false) }} className="mt-3 text-sm font-semibold text-[#8A6D45] hover:underline">Show all packages</button>
        </div>
      )}
    </div>
  )
}

export function PackageCard({ card }: { card: GalleryCard }) {
  const category = GALLERY_CATEGORIES.find((c) => c.id === card.category)
  const needs = card.needs.map((need) => GALLERY_NEEDS[need]?.label ?? need)
  return (
    <Link href={card.href ?? `/gallery/${card.slug}`} data-testid={`card-${card.slug}`} className={galleryCardClass}>
      <CardPreview icon={<PackageIcon icon={card.icon} category={card.category} size={28} />} steps={card.steps} badge={<TriggerBadge trigger={card.trigger} />} />
      <div className="flex flex-1 flex-col p-4">
        <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#8A6D45]">{category?.title} <OriginBadge source={card.source ?? "official"} /></p>
        <h3 className="mt-1.5 text-base font-semibold leading-snug text-[#1B1916]">{card.title}</h3>
        <p className="mt-1 truncate text-sm text-[#4A463E]" title={card.summary}>{card.summary}</p>
        {card.source === "community" && card.author && <p className="mt-1 text-xs text-[#6E6759]">by {card.author}{typeof card.downloads === "number" ? <> · <Download size={12} className="inline" aria-hidden="true" /> <span className="num">{card.downloads}</span></> : null}</p>}
        {(card.native || (card.systems ?? []).length > 0) && <div className="mt-3 flex flex-wrap items-center gap-1.5">{card.native && <NativeBadge />}<SystemChips systems={card.systems ?? []} /></div>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-[#6E6759]">
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <Clock size={12} className="shrink-0" aria-hidden="true" /> ~{card.setup_minutes} min · {DIFFICULTY_LABEL[card.difficulty] ?? card.difficulty}
            {!card.native && needs.length > 0 && <span className="truncate"> · Needs {needs.join(", ")}</span>}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#8A6D45] group-hover:underline">Details <ArrowRight size={12} aria-hidden="true" /></span>
        </div>
      </div>
    </Link>
  )
}
