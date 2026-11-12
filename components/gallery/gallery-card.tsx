import Link from "next/link"
import type { ReactNode } from "react"
import { BadgeCheck, Puzzle, Sparkles, UsersRound, Workflow, Boxes, Download } from "lucide-react"
import { BROWSE_KINDS, type BrowseItem, type BrowseKind } from "@/lib/gallery/browse"
import { GALLERY_TRIGGERS } from "@/lib/gallery/types"

/**
 * The one gallery card: solutions, form controls and workflow actions, on the
 * public site (marketing palette) and in the app's Browse gallery (app theme
 * tokens, light and dark). Icons come in as nodes so the app does not bundle
 * the site's full icon map. No hooks: it renders on the server or the client.
 */

export type CardTone = "site" | "app"

const KIND_ICON: Record<BrowseKind, typeof Boxes> = { solution: Boxes, control: Puzzle, action: Workflow }

const T = {
  site: {
    frame: "border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) hover:border-(color:--mkt-bronze)/45 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-(color:--mkt-paper)",
    tile: { solution: "bg-(color:--mkt-gold)/[0.14] text-(color:--mkt-bronze)", control: "bg-(color:--mkt-ink)/[0.06] text-(color:--mkt-ink-soft)", action: "bg-(color:--mkt-green)/[0.12] text-(color:--mkt-green)" },
    kind: "bg-(color:--mkt-sand) text-(color:--mkt-muted-strong)",
    fresh: "bg-(color:--mkt-gold)/[0.18] text-[#6F522B]",
    title: "text-(color:--mkt-ink) group-hover:text-(color:--mkt-bronze)",
    summary: "text-(color:--mkt-text)",
    tag: "border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) text-(color:--mkt-muted-strong)",
    native: "bg-(color:--mkt-green)/[0.12] text-[#2F5A3B]",
    system: "bg-[#4E6E8E]/[0.1] text-[#2E4B67]",
    rule: "border-(color:--mkt-ink)/[0.06]",
    meta: "text-(color:--mkt-muted)",
    official: "text-(color:--mkt-ink-soft)",
    officialIcon: "text-(color:--mkt-green)",
    community: "text-[#4F3870]",
  },
  app: {
    frame: "border-border bg-panel hover:border-border-strong focus-within:border-border-strong",
    tile: { solution: "bg-primary-wash text-primary-text", control: "bg-muted text-fg", action: "bg-success-wash text-success" },
    kind: "bg-muted text-fg-muted",
    fresh: "bg-warning-wash text-warning",
    title: "text-fg",
    summary: "text-fg-muted",
    tag: "border-border bg-subtle text-fg-muted",
    native: "bg-success-wash text-success",
    system: "bg-info-wash text-info",
    rule: "border-border-subtle",
    meta: "text-fg-muted",
    official: "text-fg",
    officialIcon: "text-success",
    community: "text-primary-text",
  },
} as const

/** "Solution" / "Form control · Input" / "Workflow action". */
export function kindLabel(item: Pick<BrowseItem, "kind" | "facet">): string {
  return item.facet ? `${BROWSE_KINDS[item.kind].singular} · ${item.facet}` : BROWSE_KINDS[item.kind].singular
}

export function CardBody({ item, icon, isNew, tone, maxTags = 3, as: Heading = "h3", titleSlot }: {
  item: BrowseItem
  icon: ReactNode
  isNew: boolean
  tone: CardTone
  maxTags?: number
  as?: "h2" | "h3"
  /** Replaces the plain title (the app card makes the title a link). */
  titleSlot?: ReactNode
}) {
  const t = T[tone]
  const KindIcon = KIND_ICON[item.kind]
  const tags = item.tags.slice(0, maxTags)
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${tone === "app" ? "size-9 rounded-lg" : "size-11 rounded-xl"} ${t.tile[item.kind]}`}>{icon}</span>
        <span className="flex min-w-0 flex-wrap justify-end gap-1.5">
          {isNew && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${t.fresh}`} data-testid="new-badge"><Sparkles size={11} aria-hidden="true" /> New</span>}
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ${t.kind}`} data-testid="kind-badge"><KindIcon size={11} aria-hidden="true" /> {kindLabel(item)}</span>
        </span>
      </div>
      <Heading className={`${tone === "app" ? "mt-3" : "mt-4"} text-sm font-semibold leading-snug transition-colors ${t.title}`}>{titleSlot ?? item.title}</Heading>
      <p className={`mt-1.5 line-clamp-2 ${tone === "app" ? "text-ui leading-5" : "text-sm leading-6"} ${t.summary}`}>{item.summary}</p>
      {(item.native || item.systems.length > 0 || item.trigger) && (
        <p className="mt-3 flex flex-wrap gap-1.5 text-2xs font-semibold">
          {item.trigger && <span className={`rounded-md px-1.5 py-0.5 ${t.kind}`}>{GALLERY_TRIGGERS[item.trigger].badge}</span>}
          {item.native && <span className={`rounded-md px-1.5 py-0.5 ${t.native}`}>No integrations needed</span>}
          {item.systems.slice(0, 2).map((s) => <span key={s} className={`rounded-md px-1.5 py-0.5 ${t.system}`}>{s}</span>)}
        </p>
      )}
      {tags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
          {tags.map((tag) => <li key={tag} className={`rounded-md border px-1.5 py-0.5 text-2xs ${t.tag}`}>{tag}</li>)}
          {item.tags.length > maxTags && <li className={`px-0.5 py-0.5 text-2xs ${t.meta}`}>+{item.tags.length - maxTags}</li>}
        </ul>
      )}
      <div className="mt-auto pt-4">
      <div className={`flex items-center justify-between gap-3 border-t pt-3 text-xs ${t.rule}`}>
        {item.source === "community"
          ? <span className={`inline-flex min-w-0 items-center gap-1 truncate font-medium ${t.community}`} data-testid="origin-community"><UsersRound size={13} className="shrink-0" aria-hidden="true" /> <span className="truncate">{item.author ? `By ${item.author}` : "Community"}</span>{typeof item.downloads === "number" && <span className={`inline-flex items-center gap-0.5 ${t.meta}`}> · <Download size={11} aria-hidden="true" /><span className="num">{item.downloads}</span></span>}</span>
          : <span className={`inline-flex items-center gap-1 font-medium ${t.official}`} data-testid="origin-official"><BadgeCheck size={13} className={t.officialIcon} aria-hidden="true" /> Official{item.signed ? <span className={t.meta}> · Signed</span> : null}</span>}
        <span className={`num shrink-0 font-mono ${t.meta}`}>v{item.version}</span>
      </div>
      </div>
    </>
  )
}

/** A whole-card link (the public grids). */
export function GalleryItemCard({ item, icon, isNew = false, as }: { item: BrowseItem; icon: ReactNode; isNew?: boolean; as?: "h2" | "h3" }) {
  return (
    <Link href={item.href} data-testid={`card-${item.slug}`} data-kind={item.kind}
      className={`group mkt-lift flex h-full flex-col rounded-2xl border p-5 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 motion-reduce:transform-none ${T.site.frame}`}>
      <CardBody item={item} icon={icon} isNew={isNew} tone="site" as={as} />
    </Link>
  )
}

/** The frame of an app card (the picker adds its own footer buttons). */
export const appCardFrame = `flex flex-col rounded-xl border p-4 transition-colors duration-[var(--ds-dur-fast)] ${T.app.frame}`
