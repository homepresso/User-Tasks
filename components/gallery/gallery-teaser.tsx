import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { SectionHeading } from "@/components/marketing/marketing-ui"
import { GALLERY_PACKAGES } from "@/lib/gallery/site"
import { GALLERY_CATEGORIES } from "@/lib/gallery/types"
import { PackageIcon } from "./gallery-ui"

/** Gallery band for the landing and use-case pages: one tile per category, linking to the filtered gallery. */
export function GalleryTeaser({ eyebrow = "Package gallery", title = "Start from a working process." }: { eyebrow?: string; title?: string }) {
  return (
    <div>
      <SectionHeading eyebrow={eyebrow} title={title}>
        {GALLERY_PACKAGES.length} ready-made packages — onboarding, expense claims, invoice matching, access requests, DSARs, API-first orchestration and more. Download one, connect your systems, run it.
      </SectionHeading>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GALLERY_CATEGORIES.map((category) => {
          const items = GALLERY_PACKAGES.filter((pkg) => pkg.category === category.id)
          return (
            <li key={category.id}>
              <Link href={`/gallery?category=${category.id}`} className="group flex h-full flex-col rounded-2xl border border-[#1B1916]/[0.08] bg-[#FFFFFF] p-5 transition hover:border-[#8A6D45]/40 hover:shadow-md">
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#B08A54]/[0.12] text-[#8A6D45]"><PackageIcon icon={null} category={category.id} size={18} /></span>
                  <span className="font-semibold">{category.title}</span>
                  <span className="ml-auto text-xs text-[#857D6D]">{items.length}</span>
                </span>
                <span className="mt-3 flex-1 text-sm leading-6 text-[#4A463E]">{items.slice(0, 4).map((pkg) => pkg.title).join(" · ") || category.summary}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#8A6D45] group-hover:underline">Browse {category.title} <ArrowRight size={14} aria-hidden="true" /></span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
