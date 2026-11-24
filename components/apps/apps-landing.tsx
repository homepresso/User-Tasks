"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { LayoutGrid, Package, PackagePlus, Pencil, Plus, Settings2, ShieldAlert } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { SearchInput } from "@/components/ui/input"
import { Tabs } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { usePermissions } from "@/lib/permissions-context"
import { appsPageSections, searchApps } from "@/lib/apps/access"
import type { AppSummary } from "@/lib/apps/schema"
import { AppIconTile, appAccentStyle } from "./app-icon"
import { NewAppDialog } from "./app-settings"
import { AppPackageDialog } from "./package-dialog"
import { AppDraftBadge } from "./app-draft-controls"
import { appHref, MY_APPS_QUERY_KEY, useMyApps, useRecentApps } from "./use-apps"
import { TagList } from "@/components/ui/tag-chip"
import { TagFilterMenu, TagsActionButton, useTagFilter } from "@/components/ui/list-tags"
import { ObjectTagsDialog } from "@/components/ui/object-tags-dialog"

/**
 * The Apps page (/apps, the Apps item in the main navigation): a card for
 * every app shared with the person ("My apps"), and for designers
 * (apps.manage, or an editor of any app) an "Apps I design" tab with edit /
 * settings actions and New app. An app the person both uses and designs is
 * one card with Open and Edit. Search filters by name, subtitle and description.
 */
type Tab = "mine" | "design"

export function AppsLanding() {
  const { can } = usePermissions()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { apps, loading } = useMyApps()
  const [, remember] = useRecentApps()
  const [query, setQuery] = useState("")
  const canManage = can("apps.manage" as never)
  const sections = useMemo(() => appsPageSections(apps, canManage), [apps, canManage])
  const requested = params.get("tab") === "design" ? "design" : params.get("tab") === "mine" ? "mine" : null
  const tab: Tab = sections.designer ? (requested ?? (sections.use.length ? "mine" : "design")) : "mine"
  const [creating, setCreating] = useState(params.get("new") === "1" && canManage)
  const [packaging, setPackaging] = useState<AppSummary | null>(null)
  const [tagsTarget, setTagsTarget] = useState<AppSummary | null>(null)
  const tagFilter = useTagFilter(apps, (a: AppSummary) => a.tags)

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(params.toString())
    sp.set("tab", next); sp.delete("new")
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }
  const list = searchApps(tab === "design" ? sections.design : sections.use, query).filter(tagFilter.matches)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4" data-apps-landing>
      <PageHeader title="Apps" description={sections.designer ? "Open the apps shared with you, or build and manage your own." : "The apps shared with you."}
        actions={canManage ? (
          <div className="flex gap-2">
            {can("packages.install" as never) && <Button asChild variant="secondary" leadingIcon={<PackagePlus />}><Link href="/settings/packages" data-install-app>Install app</Link></Button>}
            <Button leadingIcon={<Plus />} onClick={() => setCreating(true)} data-new-app>New app</Button>
          </div>
        ) : undefined} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        {sections.designer ? (
          <Tabs value={tab} onValueChange={setTab} aria-label="Apps" bordered={false}
            items={[{ value: "mine", label: "My apps", count: sections.use.length }, { value: "design", label: "Apps I design", count: sections.design.length }]} />
        ) : <span />}
        {apps.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <TagFilterMenu tags={tagFilter.allTags} selected={tagFilter.selected} onChange={tagFilter.setSelected} />
            <SearchInput value={query} onValueChange={setQuery} placeholder="Search apps…" aria-label="Search apps" className="w-full sm:w-72" data-apps-landing-search />
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-lg" />)}</div>
      ) : list.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={tab === "design" ? "Apps I design" : "My apps"}>
          {list.map((app) => <li key={app.id}><AppCard app={app} mode={tab} onOpen={() => remember(app.id)} onPackage={tab === "design" && can("packages.manage" as never) ? () => setPackaging(app) : undefined}
            onTags={app.access === "edit" ? () => setTagsTarget(app) : undefined} onTagClick={tagFilter.toggle} /></li>)}
          {tab === "design" && canManage && !query && !tagFilter.active && (
            <li><NewAppCard onClick={() => setCreating(true)} /></li>
          )}
        </ul>
      ) : query || tagFilter.active ? (
        <EmptyState variant="no-results" title={query ? `No apps match “${query.trim()}”` : "No apps carry the chosen tags"} description="Try another name, word from the description, or tag." size="sm"
          action={{ label: "Clear filters", onClick: () => { setQuery(""); tagFilter.clear() } }} />
      ) : tab === "design" ? (
        canManage
          ? <div className="max-w-sm"><NewAppCard first onClick={() => setCreating(true)} /></div>
          : <EmptyState title="You don’t design any apps yet" description="Ask someone with Build apps to add you as an editor." size="sm" />
      ) : (
        <EmptyState icon={LayoutGrid} title="No apps have been shared with you yet" description={sections.designer ? "Apps you design are under Apps I design. Share one with yourself to see it here." : "When someone shares an app with you, or a team or role of yours, it appears here."} size="md" />
      )}
      <NewAppDialog open={creating} onOpenChange={setCreating} />
      {packaging && <AppPackageDialog app={packaging} open onOpenChange={(open) => { if (!open) setPackaging(null) }} />}
      {tagsTarget && (
        <ObjectTagsDialog open onOpenChange={(open) => { if (!open) setTagsTarget(null) }} type="apps" id={tagsTarget.id} name={tagsTarget.name}
          tags={tagsTarget.tags ?? []} invalidate={[MY_APPS_QUERY_KEY, ["apps"]]} canEdit />
      )}
    </div>
  )
}

function AppCard({ app, mode, onOpen, onPackage, onTags, onTagClick }: { app: AppSummary; mode: Tab; onOpen: () => void; onPackage?: () => void; onTags?: () => void; onTagClick?: (tag: string) => void }) {
  const editHref = app.home_page ? `/apps/${app.slug}/${app.home_page}?edit=1` : `/apps/${app.slug}?edit=1`
  return (
    <article className="group relative flex h-full flex-col gap-3 rounded-lg border border-border bg-panel p-4 shadow-elev-1 transition-shadow focus-within:ring-2 focus-within:ring-focus hover:shadow-elev-2"
      style={appAccentStyle(app.color)} data-app-card={app.slug}>
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 rounded-t-lg bg-[var(--app-accent,var(--theme-primary))]" />
      <div className="flex items-start gap-3">
        <AppIconTile icon={app.icon} color={app.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-fg">
            <Link href={appHref(app)} onClick={onOpen} className="after:absolute after:inset-0 focus:outline-none">{app.name}</Link>
          </h3>
          {app.subtitle && <p className="truncate text-sm text-fg-muted">{app.subtitle}</p>}
        </div>
      </div>
      {app.description && <p className="line-clamp-3 text-sm text-fg-muted">{app.description}</p>}
      {(app.tags?.length ?? 0) > 0 && (
        <span className="relative z-10 block" data-tags-cell=""><TagList tags={app.tags} max={3} size="xs" onTagClick={onTagClick} /></span>
      )}
      <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2">
        <AppDraftBadge app={app} />
        {mode === "design" && !!app.access_issues && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-wash px-2 py-0.5 text-2xs font-medium text-warning" title="Some of the audience can’t use what this app shows them" data-app-access-badge>
            <ShieldAlert className="size-3" aria-hidden />{app.access_issues} access issue{app.access_issues === 1 ? "" : "s"}
          </span>
        )}
        {mode === "design" && !app.in_audience && !app.access_issues && <span className="text-2xs text-fg-subtle">Not shared with you</span>}
        {app.access === "edit" && (
          <div className="ml-auto flex gap-1">
            <Button asChild size="sm" variant="ghost" leadingIcon={<Pencil />}><Link href={editHref} data-edit-app={app.slug}>Edit</Link></Button>
            {mode === "design" && <Button asChild size="sm" variant="ghost" leadingIcon={<Settings2 />}><Link href={`${editHref}&settings=1`}>Settings</Link></Button>}
            {onTags && <TagsActionButton onClick={onTags} />}
            {onPackage && <Button size="sm" variant="ghost" leadingIcon={<Package />} onClick={onPackage} data-package-app={app.slug} title="Package / Export: a .utpkg with the app and what it uses">Package</Button>}
          </div>
        )}
      </div>
    </article>
  )
}

function NewAppCard({ onClick, first = false }: { onClick: () => void; first?: boolean }) {
  return (
    <button type="button" onClick={onClick} data-new-app-card
      className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong p-4 text-center text-fg-muted transition-colors hover:border-primary hover:text-primary-text">
      <Plus className="size-6" aria-hidden />
      <span className="text-sm font-semibold">{first ? "Create your first app" : "New app"}</span>
      {first && <span className="text-xs">Pages of widgets — task lists, SLAs, charts, buttons that open forms — shared with the people who need them.</span>}
    </button>
  )
}
