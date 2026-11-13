"use client"

import { ExtensionWidgets } from '@/components/extensions/extension-widgets'
import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, LayoutGrid, Plus, RotateCcw, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePermissions } from "@/lib/permissions-context"
import { useDashboardAuth } from "@/lib/dashboard-auth-context"
import { getGreeting } from "@/lib/utils"
import { serverQuery } from "@/lib/server-read"
import { resetHomeLayout, saveHomeLayout } from "@/app/actions/home"
import { DEFAULT_HOME_STATS_PERIOD, HOME_STATS_PERIODS, parseStatsPeriod, type HomeStatsPeriod } from "@/lib/home/activity"
import {
  HOME_WIDGETS, availableItems, canUseWidget, defaultHomeLayout, displayItems, hideWidget, parseExpandedWidgets, replaceVisible, sameHomeLayout,
  showWidget, toggleExpandedWidget, widgetDef,
  type HomeLayout, type HomeLayoutItem, type HomeWidgetId,
} from "@/lib/home/layout"
import type { HomeLayoutResult } from "@/lib/services/home"
import { MetricWidget } from "./metric-cards"
import { ChartWidget, browserTimeZone, periodKey, useActivityTimezone } from "./activity/activity-section"
import { DraftsWidget, useFormDrafts } from "./favorite-forms-section"
import { FavoritesTab, FollowingTab, HOME_TABS, HomeTabBar, MyTasksTab, SubmissionsTab, homeTabKey, restoreHomeTab, type HomeTab } from "./home-tabs"
import { useFavoriteForms } from "./favorite-star"
import { HOME_QUERY_KEY } from "./shared"
import { HomeContext, useHome, type HomeContextValue } from "./home-context"
import { HomeGrid } from "./home-grid"
import { HomeBuildAction } from "@/components/assistants/home-build-action"

/** React Query key of my Home layout (not under HOME_QUERY_KEY: follow / claim invalidations needn't refetch it). */
export const HOME_LAYOUT_QUERY_KEY = ["home-layout"] as const

/**
 * Home (/home): a grid of widgets — the three cards, the compact My
 * decisions / On time / My submissions widgets, the task list (My tasks (queued included) /
 * Following / My submissions / Favourite forms), the other My
 * activity charts and drafts. Each person arranges their own (Edit layout:
 * drag, resize, hide, add back, reset); the layout is saved per workspace on
 * the server (lib/services/home.ts → users.preferences.home_layout). The
 * chosen tab, chart period and expanded compact widgets are remembered in
 * this browser.
 */
export function HomeDashboard() {
  const { can, userId } = usePermissions()
  const queryClient = useQueryClient()
  const tabs = HOME_TABS.filter((t) => !t.perm || can(t.perm as never))
  const [tab, setTabState] = useState<HomeTab>(tabs[0]?.id ?? "following")
  const [period, setPeriodState] = useState<HomeStatsPeriod>(DEFAULT_HOME_STATS_PERIOD)
  // Day buckets follow the browser's zone (the read falls back to the profile's, then UTC).
  const [timezone] = useState<string | undefined>(browserTimeZone)

  useEffect(() => {
    try {
      // An old "queue" choice opens My tasks (the Task queue tab was folded into it).
      const saved = restoreHomeTab(window.localStorage.getItem(homeTabKey(userId)), tabs)
      if (saved) setTabState(saved)
      const savedPeriod = window.localStorage.getItem(periodKey(userId))
      if (savedPeriod) setPeriodState(parseStatsPeriod(savedPeriod))
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per user
  }, [userId])

  const setTab = useCallback((next: HomeTab) => {
    setTabState(next)
    try { window.localStorage.setItem(homeTabKey(userId), next) } catch { /* storage unavailable */ }
  }, [userId])
  const setPeriod = useCallback((next: HomeStatsPeriod) => {
    setPeriodState(next)
    try { window.localStorage.setItem(periodKey(userId), String(next)) } catch { /* storage unavailable */ }
  }, [userId])
  const openTab = useCallback((next: HomeTab) => {
    setTab(next)
    document.querySelector('[data-widget="tasks"]')?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [setTab])

  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "following")
  const [draft, setDraft] = useState<HomeLayout | null>(null)
  const editing = draft !== null
  const compact = useCompactWidgets(userId, editing)
  const context = useMemo<HomeContextValue>(
    () => ({ tab: active, setTab, openTab, period, setPeriod, timezone, isExpanded: compact.isExpanded, toggleExpanded: compact.toggleExpanded, reportHeight: compact.reportHeight }),
    [active, setTab, openTab, period, setPeriod, timezone, compact.isExpanded, compact.toggleExpanded, compact.reportHeight],
  )

  /* ── Layout ── */
  const layoutQuery = useQuery({
    queryKey: HOME_LAYOUT_QUERY_KEY,
    queryFn: async () => (await serverQuery("home.layout")) as HomeLayoutResult,
    staleTime: 5 * 60_000,
    // Never restored from the session cache: a layout saved on another device (or tab) shows on the next visit.
    meta: { persist: false },
  })
  const canFn = useCallback((perm: string) => can(perm as never), [can])
  const saved: HomeLayout | null = layoutQuery.data?.layout ?? (layoutQuery.isError ? defaultHomeLayout(canFn) : null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const layout = draft ?? saved
  const { drafts, loading: draftsLoading } = useFormDrafts()

  // Outside edit mode an empty Drafts widget takes no space.
  const items = useMemo(() => {
    if (!layout) return []
    const mine = availableItems(layout, canFn)
    return editing ? mine : mine.filter((i) => i.id !== "drafts" || (!draftsLoading && drafts.length > 0))
  }, [layout, canFn, editing, draftsLoading, drafts.length])
  const visibleIds = useMemo(() => new Set(items.map((i) => i.id)), [items])
  // Outside edit mode an expanded compact widget grows to its content; in edit mode every widget shows its saved size.
  const shown = useMemo(() => (editing ? items : displayItems(items, compact.expandedSet, compact.heights)), [editing, items, compact.expandedSet, compact.heights])
  const hint = useNewDefaultHint(userId, layoutQuery.data?.customised, editing)
  const addable = editing && draft ? draft.hidden.filter((id) => canUseWidget(id, canFn)) : []
  const showsCharts = items.some((i) => widgetDef(i.id)?.group === "chart")

  const announce = useCallback((text: string) => setMessage((prev) => (prev === text ? `${text} ` : text)), [])
  const onItemsChange = useCallback((next: HomeLayoutItem[]) => {
    setDraft((d) => (d ? replaceVisible(d, visibleIds, next) : d))
  }, [visibleIds])

  const startEditing = () => { if (saved) { setDraft(saved); setError(null); announce("Editing your Home layout.") } }
  const cancel = () => { setDraft(null); setError(null); announce("Changes discarded.") }
  const reset = () => { setDraft(defaultHomeLayout(canFn)); announce("Layout reset to the default. Select Done to save it.") }
  const tryDefault = () => { if (!saved) return; hint.dismiss(); setDraft(defaultHomeLayout(canFn)); setError(null); announce("Showing the new default layout. Select Done to keep it, or Cancel to go back to yours.") }
  const hide = (id: HomeWidgetId) => { setDraft((d) => (d ? hideWidget(d, id) : d)); announce(`${widgetDef(id)?.title} hidden. Add it back from Add widget.`) }
  const add = (id: HomeWidgetId) => {
    setDraft((d) => (d ? showWidget(d, id) : d))
    announce(`${widgetDef(id)?.title} added.`)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-widget-handle="${id}"]`)?.focus())
  }

  async function done() {
    if (!draft) return
    const toDefault = sameHomeLayout(draft, defaultHomeLayout(canFn))
    if (saved && sameHomeLayout(draft, saved) && (layoutQuery.data?.customised ?? false) === !toDefault) {
      setDraft(null)
      announce("Layout unchanged.")
      return
    }
    setSaving(true)
    setError(null)
    const previous = layoutQuery.data
    if (previous) queryClient.setQueryData(HOME_LAYOUT_QUERY_KEY, { ...previous, layout: draft, customised: !toDefault })
    // Saving the default clears the saved layout, so future default changes reach this person.
    const result = toDefault ? await resetHomeLayout() : await saveHomeLayout(draft)
    setSaving(false)
    if (!result.ok) {
      if (previous) queryClient.setQueryData(HOME_LAYOUT_QUERY_KEY, previous)
      setError(result.error)
      return
    }
    queryClient.setQueryData(HOME_LAYOUT_QUERY_KEY, result.data)
    setDraft(null)
    hint.dismiss()
    announce("Layout saved.")
  }

  const headerActions = (
    <>
      {showsCharts && <ActivityPeriod />}
      {/* Quick action: "Build from a process with Agent" when the Agent is on for this builder, else the form wizard (forms.wizard). */}
      <HomeBuildAction canWizard={can("forms.wizard" as never)} />
      <Button type="button" variant="ghost" size="sm" onClick={startEditing} disabled={!saved} leadingIcon={<LayoutGrid />} data-home-edit-layout>
        Edit layout
      </Button>
    </>
  )

  return (
    <HomeContext.Provider value={context}>
      <div className="space-y-4" data-home>
        <PageHeader
          className="mb-2"
          title={<HomeTitle />}
          description={<HomeDescription showZone={showsCharts} />}
          actions={!editing ? <div className="hidden items-center gap-2 sm:flex">{headerActions}</div> : undefined}
        />
        {/* On a phone the controls sit under the title, so the greeting keeps the width. */}
        {!editing && <div className="-mt-1 flex flex-wrap items-center gap-2 sm:hidden">{headerActions}</div>}

        {hint.show && <NewDefaultHint onTry={tryDefault} onDismiss={hint.dismiss} />}

        {editing && (
          <EditBar addable={addable} saving={saving} error={error} onAdd={add} onReset={reset} onCancel={cancel} onDone={done} />
        )}

        <p role="status" aria-live="polite" className="sr-only" data-home-layout-status>{message}</p>

        {layout ? (
          <HomeGrid items={shown} editing={editing} render={renderWidget} onItemsChange={onItemsChange} onHide={hide} announce={announce} />
        ) : (
          <LayoutSkeleton />
        )}
        {/* Widgets contributed by extensions enabled in this workspace (none in a build without extensions). */}
        {!editing && <ExtensionWidgets />}
      </div>
    </HomeContext.Provider>
  )
}

/** "Good afternoon, Ada" and "Wednesday 4 November", computed on the client (the reader's clock and zone). */
function useGreeting(): { greeting: string | null; today: string | null } {
  const { profile } = useDashboardAuth()
  const [now, setNow] = useState<Date | null>(null)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- set once after hydration
  useEffect(() => { setNow(new Date()) }, [])
  if (!now) return { greeting: null, today: null }
  const first = String(profile?.display_name ?? "").trim().split(/\s+/)[0]
  return {
    greeting: first ? `${getGreeting()}, ${first}` : getGreeting(),
    today: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(now),
  }
}

/** The page title: the greeting (the top bar no longer carries it); "Home" until the client renders. */
function HomeTitle() {
  const { greeting } = useGreeting()
  return <span data-home-greeting>{greeting ?? "Home"}</span>
}

/** Today's date, and the zone the activity days follow (shown once, here). */
function HomeDescription({ showZone }: { showZone: boolean }) {
  const zone = useActivityTimezone()
  const { today } = useGreeting()
  const where = showZone && zone ? `activity days in ${zone.replace(/_/g, " ")}` : null
  return <span data-home-description>{[today, where].filter(Boolean).join(" · ") || "Your tasks, the processes you follow and the forms you’ve submitted."}</span>
}

function renderWidget(id: HomeWidgetId) {
  switch (id) {
    case "metric.tasks": return <MetricWidget which="tasks" />
    case "metric.submissions": return <MetricWidget which="submissions" />
    case "metric.following": return <MetricWidget which="following" />
    case "chart.decisions": return <MetricWidget which="decisions" />
    case "tasks": return <TaskListWidget />
    case "drafts": return <DraftsWidget />
    default: return <ChartWidget id={id} />
  }
}

/** The tabbed list: My tasks / Following / My submissions / Favourite forms. */
function TaskListWidget() {
  const { can } = usePermissions()
  const { tab, setTab } = useHome()
  const counts = useTabCounts()
  const tabs = HOME_TABS.filter((t) => !t.perm || can(t.perm as never))
  return (
    <section className="scroll-mt-4 space-y-3" aria-label="Lists">
      <HomeTabBar tabs={tabs} value={tab} onChange={setTab} counts={counts} />
      <div id={`home-panel-${tab}`} role="tabpanel" aria-labelledby={`home-tab-${tab}`}>
        {tab === "tasks" && <MyTasksTab />}
        {tab === "following" && <FollowingTab />}
        {tab === "submissions" && <SubmissionsTab />}
        {tab === "favorites" && <FavoritesTab />}
      </div>
    </section>
  )
}

/** Counts on the list tabs, from the cards' reads (shared cache): open + queued tasks, active followed processes, favourite forms. */
function useTabCounts(): Partial<Record<HomeTab, number>> {
  const { can } = usePermissions()
  const tasks = useQuery({ queryKey: [...HOME_QUERY_KEY, "metrics", "tasks"], queryFn: () => serverQuery("home.taskMetrics"), enabled: can("tasks.view_own"), staleTime: 30_000 })
  const follow = useQuery({ queryKey: [...HOME_QUERY_KEY, "metrics", "following"], queryFn: () => serverQuery("home.followMetrics"), staleTime: 30_000 })
  const { forms, loading } = useFavoriteForms()
  return {
    ...(tasks.data ? { tasks: (Number(tasks.data.open) || 0) + (Number(tasks.data.queue) || 0) } : {}),
    ...(follow.data ? { following: follow.data.active } : {}),
    ...(!loading && can("forms.submit") ? { favorites: forms.length } : {}),
  }
}

/** localStorage key of the compact widgets a person expanded. */
export const expandedKey = (userId: string | null | undefined) => `usertasks.home.expanded.${userId || "anon"}`
/** localStorage key: the "new default layout" hint was seen (the Dec 2026 merged-cards default; the earlier compact-row key no longer counts). */
export const newDefaultHintKey = (userId: string | null | undefined) => `usertasks.home.new-default-2026-12-cards.${userId || "anon"}`

/**
 * Expanded / collapsed state of the compact widgets (remembered per person
 * in this browser) and their measured content heights. In edit mode they
 * all show collapsed (the collapsed size is the minimum).
 */
function useCompactWidgets(userId: string | null | undefined, editing: boolean) {
  const [expanded, setExpanded] = useState<HomeWidgetId[]>([])
  const [heights, setHeights] = useState<Record<string, number>>({})
  useEffect(() => {
    try { setExpanded(parseExpandedWidgets(window.localStorage.getItem(expandedKey(userId)))) } catch { /* storage unavailable */ }
  }, [userId])
  const toggleExpanded = useCallback((id: HomeWidgetId) => {
    setExpanded((prev) => {
      const next = toggleExpandedWidget(prev, id)
      try { window.localStorage.setItem(expandedKey(userId), JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [userId])
  const reportHeight = useCallback((id: HomeWidgetId, px: number) => {
    const rounded = Math.ceil(px)
    setHeights((prev) => (prev[id] === rounded ? prev : { ...prev, [id]: rounded }))
  }, [])
  const expandedSet = useMemo(() => new Set<string>(editing ? [] : expanded), [editing, expanded])
  const isExpanded = useCallback((id: HomeWidgetId) => expandedSet.has(id), [expandedSet])
  return { expandedSet, heights, isExpanded, toggleExpanded, reportHeight }
}

/**
 * The one-time "Home has a new default layout" hint, for people whose saved
 * layout predates it. Seeing Home on the default (or saving a layout)
 * counts as seen, so people who customise later never get it.
 */
function useNewDefaultHint(userId: string | null | undefined, customised: boolean | undefined, editing: boolean) {
  const [seen, setSeen] = useState(true)
  useEffect(() => {
    if (customised === undefined) return
    try {
      const key = newDefaultHintKey(userId)
      if (window.localStorage.getItem(key)) { setSeen(true); return }
      if (!customised) { window.localStorage.setItem(key, "1"); setSeen(true); return }
      setSeen(false)
    } catch { setSeen(true) }
  }, [userId, customised])
  const dismiss = useCallback(() => {
    setSeen(true)
    try { window.localStorage.setItem(newDefaultHintKey(userId), "1") } catch { /* storage unavailable */ }
  }, [userId])
  return { show: !seen && !editing && customised === true, dismiss }
}

function NewDefaultHint({ onTry, onDismiss }: { onTry: () => void; onDismiss: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-ui text-fg" role="note" data-home-new-default-hint>
      <Sparkles className="size-4 shrink-0 text-primary-text" aria-hidden />
      <p className="mr-auto">Home has a new default layout: four cards at the top that show your activity as small charts, with the details a click away. Reset to try it?</p>
      <Button type="button" size="sm" variant="secondary" onClick={onTry} data-home-try-default>Try the new default</Button>
      <IconButton size="sm" label="Dismiss" icon={<X />} onClick={onDismiss} data-home-hint-dismiss />
    </div>
  )
}

const PERIOD_OPTIONS = HOME_STATS_PERIODS.map((p) => ({ value: String(p), text: `${p} days` }))

/** The header's period control: it scopes every My activity graphic (the cards and the charts). */
function ActivityPeriod() {
  const { period, setPeriod } = useHome()
  return (
    <div data-home-activity data-period-picker>
      <SegmentedControl size="sm" aria-label="My activity period" options={PERIOD_OPTIONS} value={String(period)}
        onValueChange={(v) => setPeriod(parseStatsPeriod(v))} />
    </div>
  )
}

function EditBar({ addable, saving, error, onAdd, onReset, onCancel, onDone }: {
  addable: HomeWidgetId[]
  saving: boolean
  error: string | null
  onAdd: (id: HomeWidgetId) => void
  onReset: () => void
  onCancel: () => void
  onDone: () => void
}) {
  return (
    <div className="sticky top-0 z-30 space-y-1.5 rounded-lg border border-border-strong bg-elevated px-3 py-2 text-fg shadow-elev-2" role="toolbar" aria-label="Edit Home layout" data-home-edit-bar>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto flex items-center gap-2 text-ui font-medium"><LayoutGrid className="size-4 text-fg-muted" aria-hidden /> Edit layout</p>
        <AddWidgetMenu addable={addable} onAdd={onAdd} />
        <Button type="button" variant="ghost" size="sm" onClick={onReset} leadingIcon={<RotateCcw />} data-home-layout-reset>Reset</Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={saving} data-home-layout-cancel>Cancel</Button>
        <Button type="button" size="sm" onClick={onDone} loading={saving} leadingIcon={<Check />} data-home-layout-done>Done</Button>
      </div>
      <p className="text-xs text-fg-muted">
        Drag a widget by its handle, or resize it from its right edge, bottom edge or corner. Keyboard: focus a handle, then the arrow keys move it and Shift + arrow keys resize it.
      </p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function AddWidgetMenu({ addable, onAdd }: { addable: HomeWidgetId[]; onAdd: (id: HomeWidgetId) => void }) {
  const ordered = HOME_WIDGETS.filter((d) => addable.includes(d.id))
  const groups: Array<[string, typeof ordered]> = [
    ["Cards", ordered.filter((d) => d.group === "metric")],
    ["Lists", ordered.filter((d) => d.group === "list" || d.group === "forms")],
    ["My activity charts", ordered.filter((d) => d.group === "chart")],
  ]
  if (!addable.length) {
    return <Button type="button" variant="secondary" size="sm" disabled leadingIcon={<Plus />} aria-describedby="home-add-none" data-home-add-widget>
      Add widget<span id="home-add-none" className="sr-only">: every widget is on your Home</span>
    </Button>
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm" leadingIcon={<Plus />} data-home-add-widget>Add widget ({addable.length})</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-home-add-menu>
        {groups.filter(([, list]) => list.length).map(([label, list], i) => (
          <div key={label} role="group" aria-label={label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            {list.map((d) => (
              <DropdownMenuItem key={d.id} icon={<Plus />} onSelect={() => onAdd(d.id)} data-home-add={d.id}>{d.title}</DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Until the layout read answers (first visit; afterwards the cache answers at once). */
function LayoutSkeleton() {
  return (
    <div className="space-y-3" aria-hidden data-home-layout-skeleton>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[196px] rounded-lg" />)}
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </div>
  )
}
