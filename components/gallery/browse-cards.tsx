import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight } from "lucide-react"
import { isNew, newestRelease, type BrowseItem } from "@/lib/gallery/browse"
import type { GalleryCategoryId } from "@/lib/gallery/types"
import { GalleryItemCard } from "./gallery-card"
import { PackageIcon } from "./gallery-ui"

/** Server-rendered cards for the client browser, in item order and keyed by item key ("New" judged against the newest release). */
export function renderBrowseCards(items: BrowseItem[], reference: string | null = newestRelease(items)): ReactNode[] {
  return items.map((item) => <BrowseCard key={item.key} item={item} reference={reference} />)
}

export function BrowseCard({ item, reference, as }: { item: BrowseItem; reference: string | null; as?: "h2" | "h3" }) {
  return <GalleryItemCard item={item} as={as} isNew={isNew(item, reference)} icon={<PackageIcon icon={item.icon ?? null} category={item.category as GalleryCategoryId} size={22} />} />
}

/** A titled strip of cards (featured on the home, related on the detail pages). */
export function CardStrip({ id, headingId, eyebrow, title, items, reference, more, children }: {
  id?: string
  headingId?: string
  eyebrow: string
  title: string
  items: BrowseItem[]
  reference: string | null
  more?: { href: string; label: string }
  children?: ReactNode
}) {
  if (!items.length) return null
  return (
    <div id={id} className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(color:--mkt-bronze)">{eyebrow}</p>
          <h2 id={headingId} className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
          {children && <p className="mt-2 max-w-2xl text-sm leading-6 text-(color:--mkt-text)">{children}</p>}
        </div>
        {more && <Link href={more.href} className="inline-flex items-center gap-1 text-sm font-semibold text-(color:--mkt-bronze) hover:underline">{more.label} <ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => <li key={item.key} className="min-w-0"><BrowseCard item={item} reference={reference} /></li>)}
      </ul>
    </div>
  )
}
