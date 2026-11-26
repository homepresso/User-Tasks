"use client"

import { useConfirm } from '@/components/ui/use-confirm'
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useAssistantChanges, useDesignerContext } from "@/lib/assistants/client-registry"
import { appOutline } from "@/lib/apps/spec"
import {
  ArrowLeft, ArrowRight, Check, ClipboardPaste, Link2, Copy, CopyPlus, ExternalLink, FileStack, Filter, LayoutGrid, ListTree, Maximize2, Pencil, Plus, Search,
  Monitor, Settings2, SlidersHorizontal, Smartphone, Tablet, Trash2, Variable, Workflow, X,
} from "lucide-react"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { IconPicker } from "./icon-picker"
import { PageChecksButton, usePageChecks } from "./page-checks"
import { HomeGrid } from "@/components/home/home-grid"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Popover } from "@/components/ui/popover"
import { Tooltip } from "@/components/ui/tooltip"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { serverQuery } from "@/lib/server-read"
import { createAppPage, deleteAppPage, reorderAppPages, updateAppPage } from "@/app/actions/apps"
import {
  DEFAULT_APP_NAV, FILTER_KINDS, nonDefaultOptions, normalisePageFilters,
  type AppDetail, type AppMenuItem, type AppPage, type AppWidget, type FilterKind, type PageFilter, type PageOptions, type PageUpdateInput, type WidgetType,
} from "@/lib/apps/schema"
import {
  WIDGET_CATALOG, WIDGET_GROUP_LABELS, appGridDefs, autoHeightCap, catalogEntry, containedIds, dockedBars, encodeFilterValue, filterParam, filterValuesFromParams, newWidget,
  type FilterValues, type WidgetGroup,
} from "@/lib/apps/widgets"
import { PAGE_TEMPLATES, clipboardPayload, cloneWidgets, duplicateWidget, pasteWidgets, templateById } from "@/lib/apps/templates"
import { cn } from "@/lib/utils"
import { AppIconTile, appAccentStyle, WIDGET_ICONS } from "./app-icon"
import { AppSettingsSheet } from "./app-settings"
import { FilterBar } from "./inputs"
import { AppNavContext, NavDrawer, NavMenu, OverflowMenu, SideNav, type NavTarget } from "./nav-menu"
import { useAppShellStore } from "@/stores/app-shell-store"
import { appPageSwitchPlaceholder } from "@/lib/apps/shell-collapse"
import { PanelStackProvider } from "./panels"
import { useInvalidateApps, useRecentApps } from "./use-apps"
import { WidgetSettings } from "./widget-settings"
import { AppLayoutContext, WidgetView, type AppLayout, type WidgetContext } from "./widgets/widget-view"
import { colsForWidth } from "@/lib/home/layout"
import { displayLayout, type AutoHeight } from "@/lib/apps/grid"
import { NavBarWidget } from "./widgets/content-widgets"
import { AccessButton, AccessIssuesDialog, useAccessAnalysis } from "./access-issues"
import { AppRuntimeProvider } from "./runtime"
import { AppStyleProvider, styleLookup } from "./widget-style"
import { StyleEditor } from "./style-editor"
import { RulesDialog, VariablesDialog } from "./rules-builder"
import { AppDeclsProvider } from "./value-source"
import { AppDraftControls } from "./app-draft-controls"
import { previewArgsOf } from "@/lib/apps/versions"
import type { AppRule, RuleEvent } from "@/lib/apps/rules"
import type { ParamDecl, VariableDecl } from "@/lib/apps/variables"
import "./apps.css"

/**
 * An app page: the app's header and navigation (its style from App settings
 * — top bar, sidebar, drawer, tabs, bottom bar, mega-menu or none; phones
 * fall back to a menu button), the page filter bar (values in the URL,
 * ?f.<id>=…, so views are shareable), docked nav bars and the widget grid
 * (Home's grid). Buttons, tiles, cards and menu entries open targets in the
 * panel stack (components/apps/panels.tsx, ?panel=…). The app's editors
 * switch to the builder (?edit=1): add widgets from the catalogue (search,
 * groups), start from a template, drag / resize, configure each widget in
 * the side panel (live preview), duplicate, copy and paste widgets between
 * pages, set page filters and page options (hidden from the menu, lowest app
 * role), add / duplicate / rename / reorder / delete pages and open the app
 * settings; Save writes the page.
 *
 * Drafts (lib/services/app-versions.ts): the builder edits the app's DRAFT
 * and its header shows the status, Preview, Publish and the version menu.
 * Everyone else — and editors using the app — sees the PUBLISHED version;
 * ?preview=1 shows editors the draft as the audience would see it
 * (?as=viewer|contributor previews as that app role). An app never
 * published shows its editors the draft with an "Unpublished" banner.
 *
 * `embed`: the chrome-less view (/embed/apps/<slug>/<page>): no shell, links
 * stay inside /embed/, `menu` hides the app navigation (?menu=0).
 */
export function AppPageView({ appSlug, pageSlug, embed = false, menu = true }: { appSlug: string; pageSlug: string | null; embed?: boolean; menu?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const client = useQueryClient()
  const [, remember] = useRecentApps()
  const wantsEdit = !embed && params.get("edit") === "1"
  const wantsPreview = !embed && !wantsEdit && params.get("preview") === "1"
  const asParam = params.get("as")
  const asRole = wantsPreview && (asParam === "viewer" || asParam === "contributor") ? asParam : null
  const mode = wantsEdit ? "edit" : wantsPreview ? "preview" : "view"
  const query = useQuery({
    queryKey: ["apps", "page", appSlug, pageSlug, mode, asRole],
    queryFn: async () => (await serverQuery("apps.page", { app: appSlug, page: pageSlug, mode, ...(asRole ? { as_role: asRole } : {}) })) as { app: AppDetail; page: AppPage | null },
    retry: false,
    // The builder and Preview always read the draft (and its publish state) fresh, never from the tab's cache.
    ...(mode === "view" ? {} : { meta: { persist: false }, staleTime: 0 }),
    // Moving to another page of the same app (same mode): keep showing the app — its header and navigation
    // stay put — while the next page loads; only the content area shows it is switching (appPageSwitchPlaceholder).
    placeholderData: (previous, previousQuery) => appPageSwitchPlaceholder(previous, previousQuery?.queryKey, { appSlug, mode, asRole }),
  })
  // A page of an app already on screen that this person can't open (its lowest app role, removed since):
  // the app's header and navigation stay, the content area says so — the server decides, page by page.
  const [shownApp, setShownApp] = useState<AppDetail | null>(null)
  if (query.data?.app && !query.isPlaceholderData && query.data.app !== shownApp) setShownApp(query.data.app)
  const pageUnavailable = !!query.error && mode === "view" && shownApp?.slug === appSlug
  const app = query.data?.app ?? (pageUnavailable ? shownApp! : undefined)
  const page = query.data?.page ?? null
  const switching = query.isPlaceholderData
  const setAutoCollapse = useAppShellStore((s) => s.setAutoCollapse)
  // The app's "Collapse the UserTasks menu in this app" (default on) for the side menu (hooks/use-shell-sidebar.ts).
  const autoCollapse = app ? app.nav?.collapse_shell_menu !== false : null
  useEffect(() => { if (!embed && autoCollapse !== null) setAutoCollapse(appSlug, autoCollapse) }, [embed, appSlug, autoCollapse, setAutoCollapse])
  // The page clicked in the app's navigation, highlighted at once (before its address commits).
  const routeKey = `${pageSlug ?? ""}`
  const [pending, setPending] = useState<{ from: string; slug: string } | null>(null)
  // Any change of address settles it (Back to the page it was clicked on must not light the clicked entry again).
  const [settledRoute, setSettledRoute] = useState(routeKey)
  if (settledRoute !== routeKey) {
    setSettledRoute(routeKey)
    setPending(null)
  }
  const pendingPage = pending && pending.from === routeKey ? pending.slug : null
  // A new page: the content area (not the window, not the header) back to the top.
  const rootRef = useRef<HTMLDivElement>(null)
  const shownPage = useRef(pageSlug)
  useEffect(() => {
    if (shownPage.current === pageSlug) return
    shownPage.current = pageSlug
    scrollAppContentToTop(rootRef.current, embed)
  }, [pageSlug, embed])
  const prefetchPage = useCallback((slug: string) => {
    if (mode !== "view" || slug === pageSlug) return
    void client.prefetchQuery({
      queryKey: ["apps", "page", appSlug, slug, "view", null],
      queryFn: async () => (await serverQuery("apps.page", { app: appSlug, page: slug, mode: "view" })) as { app: AppDetail; page: AppPage | null },
      staleTime: 30_000,
      retry: false,
    })
  }, [client, appSlug, mode, pageSlug])
  const navContext = useMemo(() => ({ prefetch: prefetchPage, onNavigate: (slug: string) => setPending({ from: routeKey, slug }) }), [prefetchPage, routeKey])
  // Not available (not in the audience, or no such app): the workspace sign-in page's support link, when it has one.
  const support = useQuery({
    queryKey: ["signIn", "support"],
    enabled: !!query.error,
    queryFn: async () => (await serverQuery("forms.signInSupport")) as { label: string; url: string } | null,
    staleTime: 300_000,
  })
  useEffect(() => { if (app) remember(app.id) }, [app, remember])
  // The Agent knows the app and page on screen (and reloads them after it changes the app).
  // (In the builder, PageBuilder registers its own — with the edited outline and unsaved changes.)
  useDesignerContext(app && !embed && !(wantsEdit && app.access === "edit") ? { area: "app", item_id: app.id, item_name: app.name, summary: appOutline(app, page) } : null)
  useAssistantChanges(useCallback((change) => { if (change.kind === "app") void client.invalidateQueries({ queryKey: ["apps"] }) }, [client]))

  const canEdit = app?.access === "edit" && !embed
  const editing = canEdit && params.get("edit") === "1"
  const base = embed ? "/embed/apps" : "/apps"

  const setParam = useCallback((name: string, value: string | null) => {
    const sp = new URLSearchParams(params.toString())
    if (value === null) sp.delete(name); else sp.set(name, value)
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router])

  const renderPage = useCallback(({ slug, filters, params }: { slug: string; filters: Record<string, string>; params?: Record<string, string> }) => <PanelPage appSlug={appSlug} pageSlug={slug} initial={filters} params={params} embed={embed} />, [appSlug, embed])

  if (query.isPending) {
    return <div className="space-y-3" aria-busy aria-label="Loading app"><Skeleton className="h-12 w-72" /><Skeleton className="h-64 w-full" /></div>
  }
  if (!app || (query.error && !pageUnavailable)) {
    return (
      <EmptyState icon={LayoutGrid} variant="error" title="This app isn’t available" size="lg"
        description="It doesn’t exist, or it hasn’t been shared with you. Ask the person who built it to add you to its audience."
        action={embed ? undefined : { label: "Back to Apps", href: "/apps" }}
        secondaryAction={support.data ? { label: support.data.label, href: support.data.url } : undefined} />
    )
  }

  const refresh = async () => { await client.invalidateQueries({ queryKey: ["apps"] }) }
  const nav = app.nav ?? DEFAULT_APP_NAV
  const appOnly = nav.shell === "app_only" && !embed && !editing
  // One navigation: a docked nav bar that lists the app's pages replaces the app's tabs on its page (unless it says to keep them);
  // an app with one page and no menu entries needs no tabs at all.
  const replacedByBar = !!page && !editing && navBarReplacesAppNav(page.layout.widgets, app.pages)
  const singlePage = app.pages.filter((p) => !p.hidden).length <= 1 && !app.menu.length
  const showNav = menu && nav.style !== "none" && !replacedByBar && !singlePage
  // Active entry from the address (and a click in flight), not the loaded page: it moves the moment a page is chosen.
  const navTarget: NavTarget = { app: app.id, appSlug: app.slug, base, activePage: pendingPage ?? pageSlug ?? app.home_page ?? page?.slug ?? null, pages: app.pages, previewArgs: previewArgsOf(app) }
  const items = navItems(app)
  // Phones: ONE menu button in the header — the app's pages plus the page's docked nav bar entries (each target once).
  const phoneMerged = !editing && nav.style !== "drawer" && nav.style !== "bottom"
  const barItems = page && phoneMerged ? Object.values(dockedBars(page.layout.widgets)).filter((b) => b && (b.config as { edge: string }).edge !== "top").flatMap((b) => (b!.config as { items: AppMenuItem[] }).items) : []
  const phoneItems = phoneMerged ? [...(menu && nav.style !== "none" && !singlePage ? items : []), ...barItems] : []
  const previewHref = `${base}/${app.slug}/${page?.slug ?? app.home_page ?? ""}?preview=1`.replace(/\/\?/, "?")

  const content = pageUnavailable ? (
    <EmptyState icon={LayoutGrid} variant="error" title="This page isn’t available" size="md"
      description="It doesn’t exist, or your app role can’t open it."
      action={{ label: "Back to the app", href: `${base}/${app.slug}` }} />
  ) : !page ? (
    <EmptyState icon={LayoutGrid} title="This app has no pages yet" size="md"
      description={canEdit ? "Add a page to start building." : "Its builders haven’t added any pages yet."}
      action={canEdit ? { label: "Add a page", onClick: async () => {
        const r = await createAppPage(app.id, { title: "Home" })
        if (r.ok) { await refresh(); router.push(`${base}/${app.slug}/${r.data.slug}?edit=1`) }
      } } : undefined} />
  ) : editing ? (
    <PageBuilder key={`${page.id}:${page.updated_at}`} app={app} page={page} base={base} previewHref={previewHref}
      onDone={() => setParam("edit", null)} onSaved={refresh} openSettings={params.get("settings") === "1" || params.get("settings") === "audience"} settingsTab={params.get("settings") === "audience" ? "audience" : undefined} />
  ) : (
    <PageRuntime key={page.id} app={app} page={page} embed={embed} base={base} />
  )
  // Only this area changes between the app's pages: it fades the new page in and, while the next page loads,
  // dims the current one under a thin progress line (the header and navigation stay as they are).
  const contentArea = (
    <div key={pageUnavailable ? "unavailable" : page?.id ?? "none"} className="app-page-content relative min-w-0" data-app-page-content={page?.slug ?? ""} data-switching={switching || undefined} aria-busy={switching || undefined}>
      {switching && <div className="app-page-progress" role="progressbar" aria-label="Loading page" />}
      {content}
    </div>
  )

  const sidebar = showNav && nav.style === "sidebar" && !editing
  return (
    <AppStyleProvider value={app.style}>
    <PanelStackProvider appSlug={app.slug} base={base} renderPage={renderPage}>
    <AppNavContext.Provider value={navContext}>
    <PhoneNavMergedContext.Provider value={phoneMerged}>
      <div ref={rootRef} className={cn("flex flex-col", nav.density === "compact" ? "gap-2" : "gap-3", embed && "p-3", appOnly && "fixed inset-0 z-[60] overflow-auto bg-[var(--theme-page-bg,var(--theme-surface))] p-4")}
        style={appAccentStyle(app.color)} data-app={app.slug} data-app-page={page?.slug} data-nav-style={nav.style} data-shell={nav.shell} data-app-page-root={!editing || undefined}>
        {canEdit && !editing && <DraftBanner app={app} page={page} base={base} preview={wantsPreview} asRole={asRole} previewHref={previewHref} onChanged={refresh}
          onRole={(r) => { const sp = new URLSearchParams(params.toString()); if (r) sp.set("as", r); else sp.delete("as"); router.replace(`${pathname}?${sp.toString()}`, { scroll: false }) }} />}
        <AppHeader app={app} page={page} embed={embed} canEdit={canEdit} editing={editing} onEdit={() => setParam("edit", "1")} sticky={!embed && !appOnly && !editing}
          mobileNav={phoneItems.length ? <NavDrawer items={phoneItems} nav={navTarget} stateKey={`app-phone:${app.id}`} title={app.name} search /> : null}
          navigation={showNav && !editing ? <AppNavigation style={nav.style} items={items} nav={navTarget} title={app.name} phone={!phoneMerged} /> : editing && showNav ? <AppNavigation style="tabs" items={items} nav={navTarget} title={app.name} editing /> : null} />
        {sidebar ? (
          <div className="flex min-h-0 gap-3">
            <aside className="hidden shrink-0 sm:block" aria-label={`${app.name} navigation`}>
              <div className="sticky top-2 max-h-[calc(100dvh-6rem)]"><SideNavShell items={items} nav={navTarget} startCollapsed={nav.sidebar_collapsed} /></div>
            </aside>
            <div className="min-w-0 flex-1">{contentArea}</div>
          </div>
        ) : contentArea}
        {showNav && nav.style === "bottom" && !editing && <BottomBar items={items} nav={navTarget} />}
      </div>
    </PhoneNavMergedContext.Provider>
    </AppNavContext.Provider>
    </PanelStackProvider>
    </AppStyleProvider>
  )
}

/** Does a docked nav bar on this page list all of the app's pages (and so replace the app's own navigation)? */
export function navBarReplacesAppNav(widgets: readonly AppWidget[], pages: AppDetail["pages"]): boolean {
  const visible = pages.filter((p) => !p.hidden).map((p) => p.slug)
  const bars = Object.values(dockedBars([...widgets]))
  return bars.some((b) => {
    const c = b!.config as { app_nav?: "hide" | "show"; items: AppMenuItem[] }
    if (c.app_nav === "show") return false
    const slugs = new Set<string>()
    const walk = (items: readonly AppMenuItem[]) => { for (const i of items) { if (i.kind === "group") walk(i.items as AppMenuItem[]); else if (i.kind === "page") slugs.add(i.page_slug) } }
    walk(c.items)
    // Only when it lists every page the tabs would: hiding them must not strand a page.
    return visible.length > 0 && visible.every((s) => slugs.has(s))
  })
}

/** Scroll what holds the app (the dashboard's #main, the full-window app, or the embed's page) back to the top. */
function scrollAppContentToTop(root: HTMLElement | null, embed: boolean) {
  if (typeof window === "undefined") return
  if (root && root.scrollHeight > root.clientHeight && getComputedStyle(root).overflowY !== "visible") { root.scrollTo({ top: 0 }); return }
  const main = embed ? null : document.getElementById("main")
  if (main) main.scrollTo({ top: 0 }); else window.scrollTo({ top: 0 })
}

/** The app's navigation items: its pages shown in the menu (as page entries), then its menu entries. */
export function navItems(app: Pick<AppDetail, "pages" | "menu">): AppMenuItem[] {
  return [
    ...app.pages.filter((p) => !p.hidden).map((p) => ({ kind: "page" as const, label: p.title, page_slug: p.slug, icon: p.icon })),
    ...app.menu,
  ]
}

function SideNavShell({ items, nav, startCollapsed }: { items: AppMenuItem[]; nav: NavTarget; startCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(startCollapsed)
  return <div className="rounded-lg border border-border bg-panel p-2" style={{ width: collapsed ? 56 : 220 }}><SideNav items={items} nav={nav} stateKey={`app:${nav.app}`} collapsed={collapsed} onCollapsedChange={setCollapsed} /></div>
}

function BottomBar({ items, nav }: { items: AppMenuItem[]; nav: NavTarget }) {
  const first = items.filter((i) => i.kind !== "divider" && i.kind !== "heading" && i.kind !== "group").slice(0, 4)
  const rest = items.filter((i) => !(first as AppMenuItem[]).includes(i))
  return (
    <nav aria-label="App navigation" className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-border bg-elevated px-1 py-1 sm:hidden" data-bottom-bar>
      <NavMenu items={first} nav={nav} orientation="horizontal" stateKey={`bottom:${nav.app}`} density="compact" className="flex-1 justify-around" />
      {rest.length > 0 && <NavDrawer items={rest} nav={nav} stateKey={`bottom-more:${nav.app}`} title="More" />}
    </nav>
  )
}

/** The app-level navigation in the chosen style (phones: a menu button, except the bottom bar). */
function AppNavigation({ style, items, nav, title, editing = false, phone = true }: { style: AppDetail["nav"]["style"]; items: AppMenuItem[]; nav: NavTarget; title: string; editing?: boolean; /** Draw its own phone menu button (off when the header draws the merged one). */ phone?: boolean }) {
  if (!items.length) return null
  const stateKey = `app:${nav.app}`
  const mobile = phone ? <div className="sm:hidden"><NavDrawer items={items} nav={nav} stateKey={stateKey} title={title} search /></div> : null
  const editingNav = editing ? { ...nav } : nav
  switch (style) {
    case "drawer": return <NavDrawer items={items} nav={nav} stateKey={stateKey} title={title} search />
    case "sidebar": return mobile
    case "bottom": return <div className="hidden sm:block"><TabsNav items={items} nav={editingNav} /></div>
    case "top": case "mega": return <>{mobile}<div className="hidden min-w-0 flex-1 sm:flex"><OverflowMenu items={items} nav={nav} stateKey={stateKey} mega={style === "mega"} /></div></>
    default: return <>{mobile}<div className="hidden sm:block"><TabsNav items={items} nav={editingNav} /></div></>
  }
}

function TabsNav({ items, nav }: { items: AppMenuItem[]; nav: NavTarget }) {
  return (
    <nav aria-label="App menu" className="border-b border-border pb-1" data-app-menu>
      <OverflowMenu items={items} nav={nav} stateKey={`tabs:${nav.app}`} />
    </nav>
  )
}

/* ── Header ──────────────────────────────────────────────────────────── */

function AppHeader({ app, page, embed, canEdit, editing, onEdit, navigation, mobileNav, sticky = false }: {
  app: AppDetail; page: AppPage | null; embed: boolean; canEdit: boolean; editing: boolean; onEdit: () => void; navigation: ReactNode; mobileNav?: ReactNode; sticky?: boolean
}) {
  const nav = app.nav ?? DEFAULT_APP_NAV
  const colored = nav.header_style === "colored"
  const banner = nav.header_style === "banner" && nav.banner_url
  const inline = nav.style === "top" || nav.style === "mega" || nav.style === "drawer"
  const subtitle = app.subtitle || app.description
  const showText = nav.show_title || (nav.show_subtitle && subtitle)
  const [copied, setCopied] = useState(false)
  const copyLink = async () => {
    try { await navigator.clipboard?.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* clipboard permission */ }
  }
  return (
    <header className={cn("flex flex-col gap-2", (colored || banner) && "overflow-hidden rounded-xl p-3", colored && "app-header-colored bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))]",
      sticky && !colored && !banner && "-mx-4 -mt-4 px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6 -top-4 md:-top-6")}
      style={banner ? { backgroundImage: `linear-gradient(to right, color-mix(in oklab, var(--theme-surface) 85%, transparent), transparent), url("${nav.banner_url}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      data-app-header={nav.header_style} data-app-header-sticky={(sticky && !colored && !banner) || undefined}>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {mobileNav && <div className="sm:hidden">{mobileNav}</div>}
        {inline && nav.style === "drawer" && navigation}
        {nav.show_icon && <AppIconTile icon={app.icon} color={colored ? null : app.color} size={nav.density === "compact" ? "md" : "lg"} className={colored ? "bg-current/20 text-current" : undefined} />}
        {showText && (
          <div className="min-w-0 shrink">
            {nav.show_title && <h1 className={cn("truncate font-semibold leading-tight tracking-tight", nav.density === "compact" ? "text-lg" : "text-xl", !colored && "text-fg")} title={app.name} data-app-title>{app.name}</h1>}
            {nav.show_subtitle && subtitle && <p className={cn("truncate text-ui", colored ? "opacity-80" : "text-fg-muted")} title={subtitle}>{subtitle}</p>}
          </div>
        )}
        {inline && nav.style !== "drawer" ? <div className="flex min-w-0 flex-1 items-center">{navigation}</div> : <div className="flex-1" />}
        {!editing && (
          <div className="flex items-center gap-1" data-app-header-actions>
            {page && !embed && (
              <Tooltip content={copied ? "Link copied" : "Copy a link to this page (with its filters)"}>
                <IconButton size="sm" label={copied ? "Link copied" : "Copy link"} icon={copied ? <Check /> : <Link2 />} onClick={() => void copyLink()} noTooltip data-app-copy-link />
              </Tooltip>
            )}
            {page && !embed && (
              <Tooltip content="Open this page full screen, without the UserTasks menus">
                <Button asChild size="sm" variant="ghost" leadingIcon={<Maximize2 />}>
                  <a href={`/embed/apps/${app.slug}/${page.slug}`} target="_blank" rel="noreferrer" data-app-fullscreen><span className="max-sm:sr-only">Full screen</span></a>
                </Button>
              </Tooltip>
            )}
            {embed && page && (
              <Button asChild size="sm" variant="ghost" leadingIcon={<ExternalLink />}>
                <a href={`/apps/${app.slug}/${page.slug}`} target="_blank" rel="noreferrer">Open in UserTasks</a>
              </Button>
            )}
            {canEdit && <Button size="sm" variant="secondary" leadingIcon={<Pencil />} onClick={onEdit} data-edit-page>Edit</Button>}
          </div>
        )}
      </div>
      {!inline && navigation}
    </header>
  )
}

/* ── Viewing ─────────────────────────────────────────────────────────── */

function useFilterValues(filters: readonly PageFilter[]): [FilterValues, (id: string, value: FilterValues[string]) => void] {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const values = useMemo(() => filterValuesFromParams(filters, (n) => params.get(n)), [filters, params])
  const set = useCallback((id: string, value: FilterValues[string]) => {
    const sp = new URLSearchParams(params.toString())
    const encoded = encodeFilterValue(value)
    if (encoded === null) sp.set(filterParam(id), ""); else sp.set(filterParam(id), encoded)
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
  }, [params, pathname, router])
  return [values, set]
}

/** The header's phone menu already holds the docked nav bars' entries (PageBody then draws no second menu button). */
const PhoneNavMergedContext = createContext(false)

/** The page's widgets as drawn: docked nav bars, the grid (without container children), containers drawing their children. */
function PageBody({ app, page, widgets, values, setValue, embed, base, preview = false, grid, hidden }: {
  app: AppDetail; page: AppPage; widgets: AppWidget[]; values: FilterValues; setValue: (id: string, v: FilterValues[string]) => void
  embed: boolean; base: string; preview?: boolean; grid: (gridWidgets: AppWidget[], context: WidgetContext) => ReactNode
  /** Widgets a rule hid. */
  hidden?: ReadonlySet<string>
}) {
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets])
  const bars = useMemo(() => dockedBars(widgets), [widgets])
  const merged = useContext(PhoneNavMergedContext) && !preview
  const inside = useMemo(() => containedIds(widgets), [widgets])
  const gridWidgets = widgets.filter((w) => !inside.has(w.id) && w.type !== "nav_bar" && !hidden?.has(w.id))
  const context: WidgetContext = {
    app: app.id, page: page.id, filters: values, embed, preview, appSlug: app.slug, base, filterDefs: page.filters, setFilter: setValue,
    role: app.app_role, widgets: byId, previewArgs: previewArgsOf(app),
  }
  context.renderChild = (w) => <WidgetView widget={w} context={context} app={app} pageTitle={page.title} inline />
  context.renderPage = (slug, filters) => (slug === page.slug ? null : <PanelPage appSlug={app.slug} pageSlug={slug} initial={filters} embed={embed} />)
  const navTarget: NavTarget = { app: app.id, appSlug: app.slug, base, activePage: page.slug, pages: app.pages, previewArgs: previewArgsOf(app) }
  const bar = (edge: "left" | "right" | "top") => {
    const w = bars[edge]
    if (!w) return null
    const css = styleLookup([w], app.style)(w.id)
    return css ? <div style={css.vars} data-widget-styled={css.flags}><NavBarWidget widget={w} nav={navTarget} /></div> : <NavBarWidget widget={w} nav={navTarget} />
  }
  const side = (edge: "left" | "right") => bars[edge] && (
    <>
      <div className="hidden sm:block">{bar(edge)}</div>
    </>
  )
  const mobileBars = !merged && (bars.left || bars.right) && (
    <div className="sm:hidden">
      {[bars.left, bars.right].filter(Boolean).map((b) => <NavDrawer key={b!.id} items={(b!.config as { items: AppMenuItem[] }).items} nav={navTarget} stateKey={`bar:${b!.id}`} title={b!.title || "Menu"} />)}
    </div>
  )
  return (
    <div className="flex min-h-0 flex-col" data-page-body>
      {bar("top")}
      {mobileBars}
      <div className="flex min-h-0 items-stretch">
        {side("left")}
        <div className={cn("min-w-0 flex-1 space-y-3", bars.left && "sm:pl-3", bars.right && "sm:pr-3", bars.top && "pt-3")}>{grid(gridWidgets, context)}</div>
        {side("right")}
      </div>
    </div>
  )
}

function PageRuntime({ app, page, embed, base }: { app: AppDetail; page: AppPage; embed: boolean; base: string }) {
  const [values, setValue] = useFilterValues(page.filters)
  return <RuntimeGrid app={app} page={page} embed={embed} base={base} values={values} setValue={setValue} />
}

function RuntimeGrid({ app, page, embed, base, values, setValue, params }: { app: AppDetail; page: AppPage; embed: boolean; base: string; values: FilterValues; setValue: (id: string, v: FilterValues[string]) => void; params?: Record<string, string> | null }) {
  const widgets = page.layout.widgets
  if (!widgets.length) {
    return <EmptyState icon={LayoutGrid} title="Nothing on this page yet" description={app.access === "edit" ? "Choose Edit to add widgets." : "Its builders haven’t added anything yet."} size="md" />
  }
  return (
    <AppRuntimeProvider app={app} page={page} values={values} setValue={setValue} given={params ?? null} embed={embed} base={base}>
    {(rt) => <PageBody app={app} page={page} widgets={widgets} values={rt.filters} setValue={setValue} embed={embed} base={base} hidden={rt.hidden}
      grid={(list, context) => (
        <>
          <FilterBar filters={page.filters} values={values} onChange={setValue} app={app.id} defaults={page.filters} />
          <SizedGrid app={app} list={list} context={context} pageTitle={page.title} equalRows={page.layout.options?.equal_rows !== false} />
        </>
      )} />}
    </AppRuntimeProvider>
  )
}

/**
 * The page grid as viewers see it: auto-height cards follow their content,
 * cards in a row line up, rows fill the full width (lib/apps/grid.ts
 * displayLayout); widgets learn the grid's columns (AppLayoutContext).
 */
function SizedGrid({ app, list, context, pageTitle, equalRows }: { app: AppDetail; list: AppWidget[]; context: WidgetContext; pageTitle: string; equalRows: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState<number>(12)
  const [heights, setHeights] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setCols(colsForWidth(el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const report = useCallback((id: string, px: number) => setHeights((h) => (Math.abs((h[id] ?? -100) - px) < 2 ? h : { ...h, [id]: px })), [])
  const layout = useMemo<AppLayout>(() => ({ cols, report }), [cols, report])
  const defs = appGridDefs(list, styleLookup(list, app.style))
  const byId = new Map(list.map((w) => [w.id, w]))
  const items = useMemo(() => {
    const raw = list.map(({ id, w, h }) => ({ id, w, h }))
    if (cols <= 1) return raw
    const auto = new Map<string, AutoHeight>()
    for (const w of list) {
      const cap = autoHeightCap(w)
      if (cap !== null && heights[w.id]) auto.set(w.id, { px: heights[w.id], cap })
    }
    return displayLayout(raw, (id) => defs(id), { auto, equalRows, fill: cols >= 12 })
  }, [list, heights, cols, equalRows, defs])
  return (
    <div ref={box} className="app-grid" data-app-grid>
      <AppLayoutContext.Provider value={layout}>
        <HomeGrid items={items} editing={false} defs={defs}
          render={(id) => { const w = byId.get(id); return w ? <WidgetView widget={w} context={context} app={app} pageTitle={pageTitle} /> : null }}
          onItemsChange={() => {}} onHide={() => {}} announce={() => {}} />
      </AppLayoutContext.Provider>
    </div>
  )
}

/** Another page of the app inside a panel: its own filter values (from the opener), not the URL. */
function PanelPage({ appSlug, pageSlug, initial, params, embed }: { appSlug: string; pageSlug: string; initial: Record<string, string>; params?: Record<string, string>; embed: boolean }) {
  // In the builder and in Preview a panel shows the draft page too (editors only; the server checks).
  const search = useSearchParams()
  const draft = !embed && (search.get("preview") === "1" || search.get("edit") === "1")
  const as = search.get("as")
  const asRole = draft && search.get("preview") === "1" && (as === "viewer" || as === "contributor") ? as : null
  const query = useQuery({
    queryKey: ["apps", "page", appSlug, pageSlug, draft ? "preview" : "view", asRole],
    queryFn: async () => (await serverQuery("apps.page", { app: appSlug, page: pageSlug, mode: draft ? "preview" : "view", ...(asRole ? { as_role: asRole } : {}) })) as { app: AppDetail; page: AppPage | null },
    retry: false,
  })
  const page = query.data?.page ?? null
  const [changed, setValues] = useState<FilterValues>({})
  const values = useMemo<FilterValues>(() => ({ ...(page ? filterValuesFromParams(page.filters, (n) => (n.startsWith("f.") ? initial[n.slice(2)] ?? null : null)) : {}), ...changed }), [page, initial, changed])
  if (query.isPending) return <Skeleton className="h-48 w-full" />
  if (!query.data?.app || !page) return <EmptyState icon={LayoutGrid} title="This page isn’t available" size="sm" description="It doesn’t exist, or your app role can’t open it." />
  return <RuntimeGrid app={query.data.app} page={page} embed={embed} base={embed ? "/embed/apps" : "/apps"} values={values} params={params ?? {}} setValue={(id, v) => setValues((s) => ({ ...s, [id]: v }))} />
}

/* ── Drafts ──────────────────────────────────────────────────────────── */

/**
 * For the app's editors outside the builder: in Preview, what they are
 * looking at (the draft, as which role) with Back to builder and Publish;
 * otherwise whether the app is unpublished or has unpublished changes.
 */
function DraftBanner({ app, page, base, preview, asRole, previewHref, onChanged, onRole }: {
  app: AppDetail; page: AppPage | null; base: string; preview: boolean; asRole: "viewer" | "contributor" | null; previewHref: string
  onChanged: () => Promise<void>; onRole: (role: "viewer" | "contributor" | null) => void
}) {
  const state = app.publish_state
  if (!state) return null
  const neverPublished = state.published_version == null
  if (!preview && !neverPublished && !state.has_draft_changes) return null
  const builderHref = `${base}/${app.slug}/${page?.slug ?? app.home_page ?? ""}?edit=1`
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-ui", preview ? "border-[color-mix(in_srgb,var(--theme-info)_35%,var(--ds-border))] bg-info-wash" : "border-[color-mix(in_srgb,var(--theme-warning)_35%,var(--ds-border))] bg-warning-wash")}
      role="status" data-app-draft-banner={preview ? "preview" : neverPublished ? "unpublished" : "changes"}>
      {preview ? (
        <>
          <span className="font-semibold text-fg">Previewing the draft</span>
          <label className="flex items-center gap-1.5 text-fg-muted">as
            <Select size="sm" value={asRole ?? "editor"} onChange={(e) => onRole(e.target.value === "editor" ? null : e.target.value as "viewer" | "contributor")} aria-label="Preview as"
              options={[{ value: "editor", label: "an editor (you)" }, { value: "contributor", label: "a contributor" }, { value: "viewer", label: "a viewer" }]} data-app-preview-as />
          </label>
          <span className="text-fg-muted">{neverPublished ? "· Not published yet: only editors can open it" : state.has_draft_changes ? "· Its audience still sees the published version" : "· Same as the published version"}</span>
        </>
      ) : neverPublished ? (
        <span><span className="font-semibold text-fg">Unpublished</span><span className="text-fg-muted"> · Only the app’s editors can open it until it is published</span></span>
      ) : (
        <span><span className="font-semibold text-fg">You’re seeing the published version</span><span className="text-fg-muted"> · The draft has changes that are not published</span></span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {preview
          ? <Button asChild size="sm" variant="ghost" leadingIcon={<Pencil />}><a href={builderHref}>Back to builder</a></Button>
          : !neverPublished && <Button asChild size="sm" variant="ghost"><a href={previewHref} data-app-preview-draft>Preview the draft</a></Button>}
        <AppDraftControls app={app} previewHref={previewHref} onChanged={onChanged} compact showPreview={false} />
      </span>
    </div>
  )
}

/* ── Builder ─────────────────────────────────────────────────────────── */

const CLIPBOARD_KEY = "ut:apps:clipboard"

function PageBuilder({ app, page, base, previewHref, onDone, onSaved, openSettings, settingsTab }: { app: AppDetail; page: AppPage; base: string; previewHref: string; onDone: () => void; onSaved: () => Promise<void>; openSettings: boolean; settingsTab?: "audience" }) {
  const [confirm, confirmDialog] = useConfirm()
  const router = useRouter()
  const invalidateApps = useInvalidateApps()
  const [widgets, setWidgets] = useState<AppWidget[]>(page.layout.widgets)
  const [filters, setFilters] = useState<PageFilter[]>(page.filters)
  const [options, setOptions] = useState<PageOptions>(page.layout.options ?? { hidden: false, min_role: "viewer" })
  const [pageParams, setPageParams] = useState<ParamDecl[]>(page.layout.params ?? [])
  const [pageVars, setPageVars] = useState<VariableDecl[]>(page.layout.variables ?? [])
  const [rules, setRules] = useState<AppRule[]>(page.layout.rules ?? [])
  const [varsOpen, setVarsOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<"settings" | "style">("settings")
  const [rulesOpen, setRulesOpen] = useState(false)
  const [title, setTitle] = useState(page.title)
  const [pageIcon, setPageIcon] = useState<string | null>(page.icon)
  const [viewport, setViewport] = useState<"desktop" | "tablet" | "phone">("desktop")
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(openSettings)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [addingPage, setAddingPage] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [accessOpen, setAccessOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState("")
  const [values, setValue] = useFilterValues(filters)
  const access = useAccessAnalysis(app.id, { pageId: page.id, widgets })
  const layoutOut = useMemo(() => ({ widgets, ...(nonDefaultOptions(options) ? { options } : {}), ...(pageParams.length ? { params: pageParams } : {}), ...(pageVars.length ? { variables: pageVars } : {}), ...(rules.length ? { rules } : {}) }), [widgets, options, pageParams, pageVars, rules])
  const original = useMemo(() => ({ widgets: page.layout.widgets, ...(page.layout.options ? { options: page.layout.options } : {}), ...(page.layout.params ? { params: page.layout.params } : {}), ...(page.layout.variables ? { variables: page.layout.variables } : {}), ...(page.layout.rules ? { rules: page.layout.rules } : {}) }), [page.layout])
  const decls = useMemo(() => ({ params: [...(app.params ?? []), ...pageParams], variables: [...(app.variables ?? []), ...pageVars] }), [app.params, app.variables, pageParams, pageVars])
  const dirty = JSON.stringify({ l: layoutOut, filters, title, icon: pageIcon }) !== JSON.stringify({ l: original, filters: page.filters, title: page.title, icon: page.icon })
  const checkApp = useMemo(() => ({ nav: app.nav, menu: app.menu, pages: app.pages.map((p) => (p.id === page.id ? { ...p, title, icon: pageIcon } : p)) }), [app.nav, app.menu, app.pages, page.id, title, pageIcon])
  const checks = usePageChecks(checkApp, widgets)
  const byId = useMemo(() => new Map(widgets.map((w) => [w.id, w])), [widgets])
  const selectedWidget = selected ? byId.get(selected) ?? null : null
  const pageIndex = app.pages.findIndex((p) => p.id === page.id)
  const draftPage: AppPage = useMemo(() => ({ ...page, filters, layout: { widgets, params: pageParams, variables: pageVars, rules } }), [page, filters, widgets, pageParams, pageVars, rules])
  const simulate = useRef<((e: RuleEvent) => void) | null>(null)
  const [debugView, setDebugView] = useState<{ debug: import("@/lib/apps/rules").DebugEntry[]; clear: () => void }>({ debug: [], clear: () => {} })

  // In the builder: the outline of the page as edited, and whether it has unsaved changes (the Agent asks to save first).
  useDesignerContext({ area: "app", item_id: app.id, item_name: app.name, dirty, summary: appOutline(app, { slug: page.slug, title, filters, layout: { widgets } }, true) })

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  const add = (type: WidgetType) => {
    if (type === "nav_bar" && widgets.filter((w) => w.type === "nav_bar").length >= 3) { setMessage("One nav bar per edge (left, right, top)."); return }
    const widget = newWidget(type, widgets.map((w) => w.id))
    if (type === "nav_bar") {
      const used = new Set(widgets.filter((w) => w.type === "nav_bar").map((w) => (w.config as { edge: string }).edge))
      const edge = (["left", "top", "right"] as const).find((e) => !used.has(e)) ?? "left"
      // Every visible page (the bar then replaces the app's tabs on this page); entries follow their page's icon.
      widget.config = { ...(widget.config as object), edge, items: app.pages.filter((p) => !p.hidden).map((p) => ({ kind: "page", label: p.title, page_slug: p.slug })) } as never
    }
    // New widgets go right after the selected one (else at the end), so they land where you are working.
    const at = selected ? widgets.findIndex((w) => w.id === selected) : -1
    setWidgets(at >= 0 ? [...widgets.slice(0, at + 1), widget, ...widgets.slice(at + 1)] : [...widgets, widget])
    setSelected(widget.id)
    setMessage(`${catalogEntry(type).title} added ${at >= 0 ? "after the selected widget" : "at the end of the page"}.`)
  }

  const duplicate = (id: string) => {
    const r = duplicateWidget(widgets, id)
    setWidgets(r.widgets)
    if (r.copyId) { setSelected(r.copyId); setMessage("Widget duplicated.") }
  }

  const copy = async (ids: string[]) => {
    const payload = clipboardPayload(widgets, ids)
    try { window.localStorage.setItem(CLIPBOARD_KEY, payload) } catch { /* storage unavailable */ }
    try { await navigator.clipboard?.writeText(payload) } catch { /* clipboard permission */ }
    setMessage(ids.length === widgets.length ? "All widgets copied — paste them on another page." : "Widget copied — paste it on any page.")
  }

  const paste = async () => {
    let raw: string | null = null
    try { raw = await navigator.clipboard?.readText() } catch { raw = null }
    let pasted = raw ? pasteWidgets(raw, widgets) : null
    if (!pasted) { try { raw = window.localStorage.getItem(CLIPBOARD_KEY) } catch { raw = null }; pasted = raw ? pasteWidgets(raw, widgets) : null }
    if (!pasted?.length) { setMessage("Nothing to paste — copy a widget first."); return }
    setWidgets([...widgets, ...pasted])
    setSelected(pasted[0].id)
    setMessage(`${pasted.length} widget${pasted.length === 1 ? "" : "s"} pasted at the end of the page.`)
  }

  const applyTemplate = (id: string) => {
    const t = templateById(id)
    if (!t) return
    const copies = cloneWidgets(t.layout.widgets, widgets.map((w) => w.id))
    setWidgets([...widgets, ...copies])
    const known = new Set(filters.map((f) => f.id))
    setFilters(normalisePageFilters([...filters, ...t.filters.filter((f) => !known.has(f.id))]))
    setMessage(`Template “${t.title}” added. Choose the forms, workflows and tables in each widget’s settings.`)
  }

  const save = async (close: boolean) => {
    setBusy(true); setError(null)
    const result = await updateAppPage(app.id, page.id, { title: title.trim() || page.title, icon: pageIcon, layout: layoutOut as unknown as PageUpdateInput["layout"], filters })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await onSaved()
    if (close) onDone()
  }

  const movePage = async (delta: number) => {
    const order = app.pages.map((p) => p.id)
    const to = pageIndex + delta
    if (to < 0 || to >= order.length) return
    ;[order[pageIndex], order[to]] = [order[to], order[pageIndex]]
    const result = await reorderAppPages(app.id, order)
    if (!result.ok) { setError(result.error); return }
    await onSaved()
  }

  const removePage = async () => {
    const result = await deleteAppPage(app.id, page.id)
    setConfirmDelete(false)
    if (!result.ok) { setError(result.error); return }
    await invalidateApps()
    const next = app.pages.find((p) => p.id !== page.id)
    router.push(next ? `${base}/${app.slug}/${next.slug}?edit=1` : `${base}/${app.slug}`)
  }

  const duplicatePage = async () => {
    const r = await createAppPage(app.id, { title: `${page.title} (copy)`, layout: { ...layoutOut, widgets: cloneWidgets(widgets, []) } as never, filters })
    if (!r.ok) { setError(r.error); return }
    await onSaved()
    router.push(`${base}/${app.slug}/${r.data.slug}?edit=1`)
  }

  const needle = catalogQuery.trim().toLowerCase()
  const catalog = WIDGET_CATALOG.filter((e) => !needle || `${e.title} ${e.description} ${e.keywords ?? ""}`.toLowerCase().includes(needle))
  const groups = [...new Set(catalog.map((e) => e.group))] as WidgetGroup[]

  return (
    <div className="flex flex-col gap-3" data-app-builder>
      {confirmDialog}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-elevated p-2 shadow-elev-1" role="toolbar" aria-label="Page builder">
        <div className="w-36" title="Page icon (the menu, the nav bar and the page header use it)"><IconPicker app={app.id} value={pageIcon} onChange={setPageIcon} label="Page icon" /></div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Page title" size="sm" className="w-44" maxLength={120} data-page-title-input />
        <Popover width={420} aria-label="Add a widget"
          trigger={(t) => <Button {...t} size="sm" leadingIcon={<Plus />} data-add-widget>Add widget</Button>}>
          {(close) => (
            <div className="space-y-2" data-widget-catalogue>
              <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <Search className="size-3.5 text-fg-muted" aria-hidden />
                <input autoFocus value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Search widgets…" aria-label="Search widgets" className="w-full bg-transparent text-xs text-fg outline-none" data-catalogue-search />
              </label>
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {groups.map((g) => (
                  <section key={g}>
                    <h3 className="mb-1 text-2xs font-medium uppercase tracking-wide text-fg-subtle">{WIDGET_GROUP_LABELS[g]}</h3>
                    <ul className="space-y-0.5">
                      {catalog.filter((e) => e.group === g).map((e) => {
                        const Icon = WIDGET_ICONS[e.icon] ?? LayoutGrid
                        return (
                          <li key={e.type}>
                            <button type="button" onClick={() => { add(e.type); close() }} className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-subtle" data-catalogue-item={e.type}>
                              <Icon className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
                              <span className="min-w-0"><span className="block text-ui font-medium text-fg">{e.title}</span><span className="block text-xs text-fg-muted">{e.description}</span></span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
                {!catalog.length && <p className="text-xs text-fg-muted">No widget matches.</p>}
              </div>
            </div>
          )}
        </Popover>
        <Popover width={360} aria-label="Templates"
          trigger={(t) => <Button {...t} size="sm" variant="secondary" leadingIcon={<FileStack />} data-templates>Templates</Button>}>
          {(close) => (
            <ul className="space-y-1" data-template-list>
              {PAGE_TEMPLATES.map((t) => (
                <li key={t.id}>
                  <button type="button" className="w-full rounded-md px-2 py-1.5 text-left hover:bg-subtle" onClick={() => { applyTemplate(t.id); close() }} data-template={t.id}>
                    <span className="block text-ui font-medium text-fg">{t.title}</span><span className="block text-xs text-fg-muted">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
        <Button size="sm" variant="secondary" leadingIcon={<Filter />} onClick={() => setFiltersOpen(true)} data-edit-filters>Filters{filters.length ? ` (${filters.length})` : ""}</Button>
        <Button size="sm" variant="secondary" leadingIcon={<Variable />} onClick={() => setVarsOpen(true)} data-edit-variables>Variables{decls.params.length + decls.variables.length ? ` (${decls.params.length + decls.variables.length})` : ""}</Button>
        <Button size="sm" variant="secondary" leadingIcon={<Workflow />} onClick={() => setRulesOpen(true)} data-edit-rules>Rules{rules.length + (app.rules?.length ?? 0) ? ` (${rules.length + (app.rules?.length ?? 0)})` : ""}</Button>
        <Popover width={300} aria-label="All widgets on this page"
          trigger={(t) => <IconButton {...t} size="sm" label="All widgets on this page" icon={<ListTree />} data-widget-outline />}>
          {(close) => (
            <ul className="max-h-80 space-y-0.5 overflow-y-auto">
              {widgets.map((w) => <li key={w.id}><button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-subtle" onClick={() => { setSelected(w.id); close() }}><span className="truncate text-fg">{w.title || catalogEntry(w.type).title}</span><span className="ml-auto text-2xs text-fg-subtle">{w.id}</span></button></li>)}
              {!widgets.length && <li className="text-xs text-fg-muted">No widgets yet.</li>}
            </ul>
          )}
        </Popover>
        <IconButton size="sm" label="Paste widgets" icon={<ClipboardPaste />} onClick={() => void paste()} data-paste-widgets />
        <IconButton size="sm" label="Copy all widgets" icon={<Copy />} disabled={!widgets.length} onClick={() => void copy(widgets.map((w) => w.id))} />
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <IconButton size="sm" label="Move page earlier" icon={<ArrowLeft />} disabled={pageIndex <= 0 || dirty} onClick={() => void movePage(-1)} />
        <IconButton size="sm" label="Move page later" icon={<ArrowRight />} disabled={pageIndex < 0 || pageIndex >= app.pages.length - 1 || dirty} onClick={() => void movePage(1)} />
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setAddingPage(true)} disabled={dirty} data-add-page>Page</Button>
        <IconButton size="sm" label="Duplicate this page" icon={<CopyPlus />} disabled={dirty} onClick={() => void duplicatePage()} data-duplicate-page />
        <Popover width={300} aria-label="Page options"
          trigger={(t) => <IconButton {...t} size="sm" label="Page options" icon={<SlidersHorizontal />} data-page-options />}>
          {() => (
            <div className="space-y-2">
              <Switch checked={options.hidden} onCheckedChange={(v) => setOptions({ ...options, hidden: v })} label="Hidden from the menu (opened from buttons only)" />
              <label className="block space-y-1"><span className="text-xs font-medium text-fg">Who can open it</span>
                <Select size="sm" value={options.min_role} onChange={(e) => setOptions({ ...options, min_role: e.target.value as PageOptions["min_role"] })}
                  options={[{ value: "viewer", label: "Everyone in the audience" }, { value: "contributor", label: "Contributors and editors" }, { value: "editor", label: "Editors only" }]} /></label>
              <p className="text-2xs text-fg-muted">For config / admin pages: still governed by the audience; a lower app role gets “page not found”.</p>
              <Switch checked={options.equal_rows !== false} onCheckedChange={(v) => setOptions({ ...options, equal_rows: v ? undefined : false })} label="Line up the cards in each row" data-page-equal-rows />
            </div>
          )}
        </Popover>
        <IconButton size="sm" label="Delete this page" icon={<Trash2 />} disabled={app.pages.length <= 1} onClick={() => setConfirmDelete(true)} />
        <Button size="sm" variant="ghost" leadingIcon={<Settings2 />} onClick={() => setSettingsOpen(true)} data-app-settings>App settings</Button>
        <AccessButton analysis={access.data} loading={access.isPending} onClick={() => setAccessOpen(true)} />
        <PageChecksButton app={checkApp} widgets={widgets} checks={checks} onChange={(next) => { setWidgets(next); setMessage("Fixed — Save to keep the changes.") }} onSelect={setSelected} onOpenSettings={() => setSettingsOpen(true)} />
        <SegmentedControl size="sm" aria-label="Preview width" value={viewport} onValueChange={setViewport} data-builder-viewport
          options={[{ value: "desktop", icon: <Monitor />, label: "Desktop" }, { value: "tablet", icon: <Tablet />, label: "Tablet" }, { value: "phone", icon: <Smartphone />, label: "Phone" }]} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AppDraftControls app={app} previewHref={previewHref} dirty={dirty} onChanged={onSaved} compact />
          {dirty && <span className="text-xs text-fg-muted" role="status">Unsaved changes</span>}
          <Button size="sm" variant="ghost" onClick={async () => { if (!dirty || await confirm({ title: "Discard your changes to this page?", description: "Your unsaved edits to this page are lost.", confirmLabel: "Discard", destructive: true })) onDone() }}>{dirty ? "Discard" : "Done"}</Button>
          <Button size="sm" loading={busy} disabled={!dirty} onClick={() => void save(true)} data-save-page>Save</Button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <p className="sr-only" aria-live="polite">{message}</p>
      {message && <p className="text-xs text-fg-muted" aria-hidden>{message}</p>}

      <div className={cn("grid gap-3", selectedWidget && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className={cn("min-w-0 space-y-3", viewport !== "desktop" && "mx-auto w-full rounded-xl border border-dashed border-border-strong p-2", viewport === "tablet" && "max-w-[820px]", viewport === "phone" && "max-w-[390px]")} data-builder-canvas={viewport}>
          {widgets.length ? (
            <AppRuntimeProvider app={app} page={draftPage} values={values} setValue={setValue} preview base={base}>
            {(rt) => <><RuntimeBridge rt={rt} onReady={(fn, d) => { simulate.current = fn; setDebugView((cur) => (cur.debug === d.debug ? cur : d)) }} />
            <PageBody app={app} page={draftPage} widgets={widgets} values={rt.filters} setValue={setValue} embed={false} base={base} preview
              grid={(list, context) => {
                const defs = appGridDefs(list, styleLookup(list, app.style))
                const ids = new Map(list.map((w) => [w.id, w]))
                return (
                  <>
                    <FilterBar filters={filters} values={values} onChange={setValue} app={app.id} />
                    {widgets.some((w) => w.type === "nav_bar") && (
                      <div className="flex flex-wrap gap-1">{widgets.filter((w) => w.type === "nav_bar").map((w) => <Button key={w.id} size="sm" variant={selected === w.id ? "primary" : "ghost"} leadingIcon={<SlidersHorizontal />} onClick={() => setSelected(w.id)}>Nav bar ({(w.config as { edge: string }).edge})</Button>)}</div>
                    )}
                    <div className="app-grid"><HomeGrid items={list.map(({ id, w, h }) => ({ id, w, h }))} editing padEditing defs={defs} selectedId={selected}
                      render={(id) => { const w = ids.get(id); return w ? <WidgetView widget={w} context={context} app={app} pageTitle={title} /> : null }}
                      onItemsChange={(items) => {
                        const moved = items.map((it) => ({ ...ids.get(it.id)!, w: it.w, h: it.h }))
                        const hidden = widgets.filter((w) => !ids.has(w.id))
                        setWidgets([...moved, ...hidden])
                      }}
                      onHide={(id) => { setWidgets(widgets.filter((w) => w.id !== id)); if (selected === id) setSelected(null); setMessage("Widget removed.") }}
                      hideLabel={(t) => `Remove ${t}`} hideIcon={<X />}
                      toolbar={(id) => (
                        <>
                          <IconButton size="sm" label={`Duplicate ${ids.get(id)?.title || defs(id)?.title}`} icon={<CopyPlus />} onClick={() => duplicate(id)} data-widget-duplicate={id} />
                          <IconButton size="sm" label={`Copy ${ids.get(id)?.title || defs(id)?.title}`} icon={<Copy />} onClick={() => void copy([id])} data-widget-copy={id} />
                          <IconButton size="sm" label={`Settings for ${ids.get(id)?.title || defs(id)?.title}`} icon={<SlidersHorizontal />} onClick={() => setSelected(id)} data-widget-configure={id} />
                        </>
                      )}
                      announce={setMessage} /></div>
                  </>
                )
              }} /></>}
            </AppRuntimeProvider>
          ) : (
            <EmptyState icon={LayoutGrid} title="Add your first widget" description="Pick a widget, or start from a template (Team dashboard, Requester portal, Manager approvals, Operations SLA)." size="md" />
          )}
        </div>
        {selectedWidget && (
          <aside className="h-fit max-h-[calc(100dvh-8rem)] space-y-3 overflow-y-auto rounded-lg border border-border bg-panel p-3 lg:sticky lg:top-16" aria-label="Widget settings" data-widget-panel>
            <div className="flex items-center justify-between gap-1">
              <h2 className="text-sm font-semibold text-fg">{catalogEntry(selectedWidget.type).title} settings</h2>
              <div className="flex items-center">
                {(selectedWidget.type === "nav_bar" || containedIds(widgets).has(selectedWidget.id)) && <IconButton size="sm" label="Remove widget" icon={<Trash2 />} onClick={() => { setWidgets(widgets.filter((w) => w.id !== selectedWidget.id)); setSelected(null) }} />}
                <IconButton size="sm" label="Close settings" icon={<X />} onClick={() => setSelected(null)} />
              </div>
            </div>
            <div className="flex gap-1" role="tablist" aria-label="Widget panel">
              <Button size="sm" role="tab" aria-selected={panelTab === "settings"} variant={panelTab === "settings" ? "secondary" : "ghost"} onClick={() => setPanelTab("settings")}>Settings</Button>
              <Button size="sm" role="tab" aria-selected={panelTab === "style"} variant={panelTab === "style" ? "secondary" : "ghost"} onClick={() => setPanelTab("style")} data-widget-style-tab>Style</Button>
            </div>
            {panelTab === "style" ? (
              <StyleEditor key={selectedWidget.id} widget={selectedWidget} app={app} onAppSaved={() => void onSaved()}
                onChange={(next) => setWidgets(widgets.map((w) => (w.id === next.id ? next : w)))} />
            ) : (
            <AppDeclsProvider value={decls}>
            <WidgetSettings app={app.id} widget={selectedWidget} filters={filters} pages={app.pages} widgets={widgets}
              onChange={(next) => setWidgets(widgets.map((w) => (w.id === next.id ? next : w)))} />
            </AppDeclsProvider>
            )}
          </aside>
        )}
      </div>

      <AccessIssuesDialog app={app.id} open={accessOpen} onOpenChange={setAccessOpen} analysis={access.data} dirty={dirty} />
      <FiltersDialog open={filtersOpen} onOpenChange={setFiltersOpen} filters={filters} onChange={setFilters} />
      <VariablesDialog open={varsOpen} onOpenChange={setVarsOpen} params={pageParams} variables={pageVars} app={app}
        onChange={(p, v) => { setPageParams(p); setPageVars(v) }} onAppSaved={() => void onSaved()} />
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} rules={rules} onChange={setRules} app={app} widgets={widgets} filters={filters} decls={decls}
        debug={debugView.debug} onClearDebug={debugView.clear} onSimulate={(e) => simulate.current?.(e)} onAppSaved={() => void onSaved()} />
      <AddPageDialog open={addingPage} onOpenChange={setAddingPage} onCreate={async (t, template) => {
        const tpl = template ? templateById(template) : null
        const r = await createAppPage(app.id, { title: t, ...(tpl ? { layout: tpl.layout as never, filters: tpl.filters } : {}) })
        if (!r.ok) return r.error
        await onSaved()
        router.push(`${base}/${app.slug}/${r.data.slug}?edit=1`)
        return null
      }} />
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete the page “${page.title}”?`}
        description="Its widgets and filters are removed. The rest of the app stays." confirmLabel="Delete page" destructive onConfirm={removePage} />
      <AppSettingsSheet app={app} open={settingsOpen} onOpenChange={setSettingsOpen} initialTab={settingsTab}
        onSaved={(next) => { void onSaved(); if (next.slug !== app.slug) router.replace(`${base}/${next.slug}/${page.slug}?edit=1`) }} />
    </div>
  )
}

/** Hands the builder the preview runtime's debug log and a way to run sample events. */
function RuntimeBridge({ rt, onReady }: { rt: import("./runtime").AppRuntime; onReady: (simulate: (e: RuleEvent) => void, debug: { debug: import("@/lib/apps/rules").DebugEntry[]; clear: () => void }) => void }) {
  useEffect(() => { onReady((e) => void rt.raise(e), { debug: rt.debug, clear: rt.clearDebug }) }, [rt, onReady])
  return null
}

const FILTER_KIND_LABELS: Record<FilterKind, string> = {
  user: "Person", team: "Team", form: "Form", workflow: "Workflow", table: "Data table", date_range: "Date range", status: "Status", text: "Text / value",
}

function FiltersDialog({ open, onOpenChange, filters, onChange }: { open: boolean; onOpenChange: (o: boolean) => void; filters: PageFilter[]; onChange: (f: PageFilter[]) => void }) {
  const [draft, setDraft] = useState<PageFilter[]>(filters)
  useEffect(() => { if (open) setDraft(filters) }, [open, filters])
  const set = (i: number, patch: Partial<PageFilter>) => setDraft(draft.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  const add = () => {
    let n = draft.length + 1
    while (draft.some((f) => f.id === `filter_${n}`)) n++
    setDraft([...draft, { id: `filter_${n}`, kind: "user", label: "Person", default: "me" }])
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Page filters" description="Inputs at the top of the page, kept in the URL so views can be shared. In a widget’s settings, choose “From page filter” for an input and this filter drives it; charts, lists and cards can set filters when clicked.">
        <DialogBody className="space-y-2">
          {draft.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2" data-filter-row>
              <label className="space-y-1"><span className="text-xs font-medium text-fg-muted">Label</span><Input size="sm" value={f.label} onChange={(e) => set(i, { label: e.target.value })} /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-fg-muted">Kind</span>
                <Select size="sm" value={f.kind} onChange={(e) => {
                  const kind = e.target.value as FilterKind
                  set(i, { kind, label: FILTER_KIND_LABELS[kind], default: kind === "user" ? "me" : kind === "team" ? "my_teams" : kind === "status" ? "open" : kind === "date_range" ? { preset: "30d" } : null })
                }} options={FILTER_KINDS.map((k) => ({ value: k, label: FILTER_KIND_LABELS[k] }))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-fg-muted">Id</span><Input size="sm" value={f.id} onChange={(e) => set(i, { id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) })} /></label>
              <IconButton size="sm" label="Remove filter" icon={<Trash2 />} onClick={() => setDraft(draft.filter((_, j) => j !== i))} />
              {f.kind === "text" && (
                <label className="col-span-3 space-y-1"><span className="text-xs font-medium text-fg-muted">Choices (comma-separated; empty: a free text box)</span>
                  <Input size="sm" defaultValue={(f.options ?? []).join(", ")} placeholder="e.g. Engineering, Sales, Finance" data-filter-options
                    onBlur={(e) => { const options = e.target.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 50); set(i, { options: options.length ? options : undefined }) }} /></label>
              )}
            </div>
          ))}
          {!draft.length && <p className="text-sm text-fg-muted">No filters yet.</p>}
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={add} disabled={draft.length >= 8} data-add-filter>Add filter</Button>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onChange(normalisePageFilters(draft)); onOpenChange(false) }} data-apply-filters>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddPageDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (title: string, template: string | null) => Promise<string | null> }) {
  const [title, setTitle] = useState("")
  const [template, setTemplate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setTitle(""); setTemplate(null); setError(null) } }}>
      <DialogContent size="md" title="Add a page">
        <DialogBody className="space-y-3">
          <form id="add-page-form" onSubmit={async (e) => {
            e.preventDefault()
            if (!title.trim()) { setError("Give the page a title."); return }
            setBusy(true)
            const err = await onCreate(title.trim(), template)
            setBusy(false)
            if (err) setError(err); else onOpenChange(false)
          }}>
            <label className="space-y-1"><span className="text-ui font-medium text-fg">Title</span><Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={120} /></label>
          </form>
          <fieldset>
            <legend className="mb-1 text-ui font-medium text-fg">Start from</legend>
            <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Start from">
              {[{ id: null, title: "Blank page", description: "No widgets yet." }, ...PAGE_TEMPLATES].map((t) => (
                <button key={t.id ?? "blank"} type="button" role="radio" aria-checked={template === t.id} onClick={() => { setTemplate(t.id); if (!title && t.id) setTitle(t.title) }}
                  className={cn("rounded-md border p-2 text-left", template === t.id ? "border-primary bg-primary-wash" : "border-border hover:bg-subtle")} data-page-template={t.id ?? "blank"}>
                  <span className="block text-sm font-medium text-fg">{t.title}</span><span className="block text-xs text-fg-muted">{t.description}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-page-form" loading={busy}>Add page</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
