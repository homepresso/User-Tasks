"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, Globe, ShieldCheck } from "lucide-react"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { FilterTag, GallerySearch } from "./gallery-browser"
import { CardPreview, galleryCardClass, PackageIcon } from "./gallery-ui"
import type { ControlCard } from "@/lib/gallery/site"

type KindFilter = "all" | "input" | "display" | "bundle"
type NeedFilter = "all" | "none" | "lookup" | "reports" | "files" | "network"

const CAPABILITY_LABEL: Record<string, string> = { lookup: "Lookups", reports: "Saved reports", files: "Files", network: "Network" }
const CAPABILITY_HELP: Record<string, string> = {
  lookup: "Suggestions from the field's lookup source (a data table or an API reference called by the server)",
  reports: "Rows of the saved report the designer picks, run with the viewer's permissions",
  files: "Uploads to Attachments, and reads files the form already has",
  network: "Fetches from declared hosts once an admin approves them",
}

function matches(card: ControlCard, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = [card.title, card.summary, ...card.tags, ...card.elements, ...card.systems, ...card.capabilities].join(" ").toLowerCase()
  return words.every((w) => haystack.includes(w))
}

export function ControlsBrowser({ cards }: { cards: ControlCard[] }) {
  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<KindFilter>("all")
  const [need, setNeed] = useState<NeedFilter>("all")
  const visible = useMemo(() => cards.filter((card) => matches(card, query)
    && (kind === "all" || (kind === "bundle" ? card.kind === "control_bundle" : card.control_kind === kind))
    && (need === "all" || (need === "none" ? card.capabilities.length === 0 : card.capabilities.includes(need)))), [cards, query, kind, need])
  const kindCount = (id: KindFilter) => cards.filter((c) => id === "all" || (id === "bundle" ? c.kind === "control_bundle" : c.control_kind === id)).length
  return (
    <div>
      <div className="flex flex-col gap-4">
        <GallerySearch value={query} onChange={setQuery} label="Search form controls" placeholder="Search: chart, address, signature, table…" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-[#857D6D]">Show</span>
            <SegmentedControl aria-label="Kind of control" value={kind} onValueChange={setKind}
              options={([["all", "Everything"], ["input", "Inputs"], ["display", "Displays"], ["bundle", "Bundles"]] as Array<[KindFilter, string]>).map(([id, label]) => ({
                value: id, text: <>{label} <span className="num text-[#857D6D]">{kindCount(id)}</span></>,
              }))} />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Host services">
            <span className="text-xs font-medium text-[#857D6D]">Uses</span>
            {(["all", "none", "lookup", "reports", "files", "network"] as NeedFilter[]).map((id) => (
              <FilterTag key={id} active={need === id} onClick={() => setNeed(id)}>
                <span title={CAPABILITY_HELP[id]}>{id === "all" ? "Anything" : id === "none" ? "Nothing (self-contained)" : CAPABILITY_LABEL[id]}</span>
              </FilterTag>
            ))}
          </div>
        </div>
      </div>
      <p className="num mt-6 text-sm text-[#6E6759]" aria-live="polite">{visible.length === cards.length ? `${cards.length} controls and bundles` : `${visible.length} of ${cards.length}`}</p>
      {visible.length ? (
        <ul className="mt-3 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((card) => <li key={card.slug} className="min-w-0"><ControlCardView card={card} /></li>)}
        </ul>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-[#1B1916]/15 p-10 text-center">
          <p className="font-semibold">No control matches those filters.</p>
          <button type="button" onClick={() => { setQuery(""); setKind("all"); setNeed("all") }} className="mt-3 text-sm font-semibold text-[#8A6D45] hover:underline">Show all controls</button>
        </div>
      )}
    </div>
  )
}

export function ControlCardView({ card }: { card: ControlCard }) {
  return (
    <Link href={card.href} data-testid={`control-card-${card.slug}`} className={galleryCardClass}>
      <CardPreview tone="ink" icon={<PackageIcon icon={card.icon} category="form-controls" size={28} />}
        badge={<span className="whitespace-nowrap rounded-full bg-[#FFFFFF] px-2.5 py-0.5 text-xs font-semibold text-[#33302A] ring-1 ring-inset ring-[#17150F]/15">
          {card.kind === "control_bundle" ? `Bundle · ${card.elements.length} controls` : card.control_kind === "display" ? "Display" : "Input"}
        </span>} />
      <div className="flex flex-1 flex-col p-4">
        <p className="text-xs font-medium text-[#8A6D45]">Form control</p>
        <h3 className="mt-1.5 text-base font-semibold leading-snug text-[#1B1916]">{card.title}</h3>
        <p className="mt-0.5 truncate font-mono text-xs text-[#6E6759]">{card.elements.map((t) => `<${t}>`).join(" ")}</p>
        <p className="mt-1 truncate text-sm text-[#4A463E]" title={card.summary}>{card.summary}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-2xs">
          {card.capabilities.length === 0 && <span className="inline-flex items-center gap-1 rounded-sm bg-[#4F7A5B]/[0.12] px-1.5 py-0.5 font-semibold text-[#2F5A3B]"><ShieldCheck size={12} aria-hidden="true" /> Self-contained</span>}
          {card.capabilities.map((c) => <span key={c} title={CAPABILITY_HELP[c]} className="rounded-sm border border-[#1B1916]/[0.1] bg-[#FAF8F3] px-1.5 py-0.5 font-medium text-[#4A463E]">{CAPABILITY_LABEL[c] ?? c}</span>)}
          {card.hosts.length > 0 && <span className="inline-flex items-center gap-1 rounded-sm bg-[#4E6E8E]/[0.1] px-1.5 py-0.5 font-semibold text-[#2E4B67]"><Globe size={12} aria-hidden="true" /> {card.systems[0] ?? card.hosts[0]}</span>}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4 text-xs text-[#6E6759]">
          <span className="num">value {card.value_types.join(" / ")} · v{card.version}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-[#8A6D45] group-hover:underline">Try it <ArrowRight size={12} aria-hidden="true" /></span>
        </div>
      </div>
    </Link>
  )
}
