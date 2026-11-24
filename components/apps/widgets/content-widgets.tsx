"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Bot, ChevronDown, ChevronRight, ExternalLink, Info, Megaphone, Search, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StandaloneForm } from "@/components/forms/standalone-form"
import { askAppAgent, appAgentReply } from "@/app/actions/apps"
import { serverQuery } from "@/lib/server-read"
import { sanitizeHtml } from "@/lib/html-sanitize"
import { embedAllowed, videoSource } from "@/lib/apps/embed-origins"
import { needsUser, resolveParams } from "@/lib/apps/params"
import type { AppWidget, WidgetConfig } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { AppIconGlyph, appIcon } from "../app-icon"
import { OverflowMenu, SideNav, useBadgeCounts, type NavTarget } from "../nav-menu"
import { Empty, TONE, toCsv, useAppDispatch, useWidgetData, type WidgetContext } from "./kit"
import { ReportWidget } from "./report-widget"

/** Announcement, embed, video, divider, spacer, tabs, section, tiles, page header, quick search, agent chat, form embed, nav bar. */

const TEXT_TAGS: Record<string, readonly string[]> = {
  p: [], br: [], strong: [], b: [], em: [], i: [], u: [], s: [], h2: [], h3: [], h4: [],
  ul: [], ol: [], li: [], blockquote: [], code: [], pre: [], hr: [], a: ["href", "title"],
}
export function sanitizeWidgetHtml(html: string): string {
  return sanitizeHtml(html, { tags: TEXT_TAGS, hrefSchemes: ["https", "mailto"], relativeLinks: true, rename: { h1: "h2", div: "p" } })
}
const PROSE = "text-sm [&_a]:text-primary-text [&_a]:underline [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1 [&_ul]:list-disc"

/** Is an announcement shown today (inclusive date range)? */
export function announcementLive(c: Pick<WidgetConfig<"announcement">, "starts_on" | "ends_on">, today = new Date().toISOString().slice(0, 10)): boolean {
  if (c.starts_on && today < c.starts_on.slice(0, 10)) return false
  if (c.ends_on && today > c.ends_on.slice(0, 10)) return false
  return true
}

export function AnnouncementWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"announcement">
  const live = announcementLive(c)
  if (!live && !context.preview) return null
  const html = sanitizeWidgetHtml(c.html)
  return (
    <div className={cn("flex h-full gap-2 rounded-lg p-3", TONE[c.tone === "neutral" ? "neutral" : c.tone])} role="note" data-widget-announcement>
      <Megaphone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 overflow-auto text-fg">
        {widget.title && <p className="font-semibold">{widget.title}</p>}
        {html.trim() ? <div className={PROSE} dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-sm text-fg-muted">Write the announcement in the widget settings.</p>}
        {!live && <p className="mt-1 text-2xs text-fg-muted">Not shown to viewers today (outside its dates).</p>}
      </div>
    </div>
  )
}

export function EmbedWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"embed"> & { blocked?: boolean }
  const origins = useQuery({
    queryKey: ["apps", "embed-origins", context.app], enabled: !!context.preview && !!c.url,
    queryFn: async () => (await serverQuery("apps.embedOrigins", { app: context.app })) as { origins: string[] },
  })
  if (c.blocked) return <Empty text="This site isn’t on the workspace’s list of sites app pages may embed." icon={<Info className="size-5 text-fg-subtle" aria-hidden />} />
  if (!c.url) return <Empty text="Add an https:// address in the widget settings." />
  if (context.preview && origins.data) {
    if (!embedAllowed(c.url, origins.data.origins)) return <Empty text="Ask an admin to allow this site under Settings → Embedding (Sites app pages may embed); viewers won’t see it until then." icon={<Info className="size-5 text-warning" aria-hidden />} />
  }
  return <iframe src={c.url} title={c.title || widget.title || "Embedded content"} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy" allowFullScreen={c.allow_fullscreen} data-widget-embed />
}

export function VideoWidget({ widget }: { widget: AppWidget }) {
  const c = widget.config as WidgetConfig<"video">
  if (!c.url) return <Empty text="Add a YouTube, Vimeo or https:// video address in the widget settings." />
  const src = videoSource(c.url)
  if (!src) return <Empty text="Use a YouTube or Vimeo link, or an https:// video file (.mp4, .webm)." />
  return (
    <figure className="flex h-full flex-col" data-widget-video>
      {src.kind === "frame"
        ? <iframe src={src.src} title={c.caption || widget.title || "Video"} className="min-h-0 w-full flex-1 border-0" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
        : <video src={src.src} controls preload="metadata" className="min-h-0 w-full flex-1 bg-black object-contain" />}
      {c.caption && <figcaption className="px-1 pt-1 text-xs text-fg-muted">{c.caption}</figcaption>}
    </figure>
  )
}

export function DividerWidget({ widget }: { widget: AppWidget }) {
  const c = widget.config as WidgetConfig<"divider">
  return (
    <div className="flex h-full items-center gap-3" role="separator" aria-label={c.label || undefined} data-widget-divider>
      <span className="h-px flex-1 bg-border" />
      {c.label && <><span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{c.label}</span><span className="h-px flex-1 bg-border" /></>}
    </div>
  )
}

/** Which tab to open: the URL (?t.<widget>=n), else the person's last one, else the first. */
function initialTab(widgetId: string, remember: boolean, count: number): number {
  if (typeof window === "undefined" || !remember) return 0
  const fromUrl = Number(new URLSearchParams(window.location.search).get(`t.${widgetId}`))
  if (Number.isInteger(fromUrl) && fromUrl >= 0 && fromUrl < count) return fromUrl
  try { const v = Number(window.localStorage.getItem(`ut:apps:tab:${widgetId}`)); if (Number.isInteger(v) && v >= 0 && v < count) return v } catch { /* storage unavailable */ }
  return 0
}

const TAB_STYLES = {
  underline: { list: "flex gap-1 border-b border-border", tab: (on: boolean) => cn("relative px-3 py-1.5 text-ui", on ? "font-medium text-fg" : "text-fg-muted hover:text-fg") },
  pills: { list: "flex flex-wrap gap-1", tab: (on: boolean) => cn("rounded-full px-3 py-1 text-ui", on ? "bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))]" : "text-fg-muted hover:bg-subtle") },
  segmented: { list: "inline-flex rounded-lg bg-subtle p-0.5", tab: (on: boolean) => cn("rounded-md px-3 py-1 text-ui", on ? "bg-panel font-medium text-fg shadow-elev-1" : "text-fg-muted hover:text-fg") },
  vertical: { list: "flex w-44 shrink-0 flex-col gap-0.5 border-r border-border pr-2", tab: (on: boolean) => cn("rounded-md px-2 py-1.5 text-left text-ui", on ? "bg-[var(--app-accent-wash,var(--theme-primary-light))] font-medium text-fg" : "text-fg-muted hover:bg-subtle") },
} as const

export function TabsWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"tabs">
  const [tab, setTabState] = useState(() => initialTab(widget.id, c.remember, c.tabs.length))
  const [opened, setOpened] = useState<Set<number>>(() => new Set([tab]))
  const dispatch = useAppDispatch(context)
  const badges = useBadgeCounts(context.app, c.tabs.filter((t) => t.badge).map((t) => ({ kind: "url", label: t.label, url: "/", new_tab: false, badge: t.badge })) as never)
  const index = Math.min(tab, c.tabs.length - 1)
  const current = c.tabs[index]
  const id = `tabs-${widget.id}`
  const style = TAB_STYLES[c.style]
  const select = (i: number) => {
    setTabState(i)
    setOpened((s) => new Set(s).add(i))
    if (c.remember) {
      try { window.localStorage.setItem(`ut:apps:tab:${widget.id}`, String(i)) } catch { /* storage unavailable */ }
      const url = new URL(window.location.href)
      url.searchParams.set(`t.${widget.id}`, String(i))
      window.history.replaceState(window.history.state, "", url)
    }
    void dispatch({ type: "tab_changed", widget: widget.id, tab: i })
  }
  const vertical = c.style === "vertical"
  return (
    <div className={cn("flex h-full min-h-0 gap-2", vertical ? "flex-row" : "flex-col")} data-widget-tabs={c.style}>
      <div role="tablist" aria-label={widget.title || "Tabs"} aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(style.list, !vertical && "overflow-x-auto")}
        onKeyDown={(e) => {
          const next = e.key === (vertical ? "ArrowDown" : "ArrowRight") ? 1 : e.key === (vertical ? "ArrowUp" : "ArrowLeft") ? -1 : 0
          if (next) { e.preventDefault(); select((index + next + c.tabs.length) % c.tabs.length) }
        }}>
        {c.tabs.map((t, i) => {
          const Icon = t.icon ? appIcon(t.icon) : null
          const count = t.badge ? badges[t.badge] : undefined
          return (
            <button key={i} role="tab" id={`${id}-t${i}`} aria-selected={i === index} aria-controls={`${id}-p${i}`} tabIndex={i === index ? 0 : -1} onClick={() => select(i)} className={cn("inline-flex shrink-0 items-center gap-1.5", style.tab(i === index))} data-tab={i}>
              {Icon && <Icon className="size-4" aria-hidden />}{t.label}
              {typeof count === "number" && count > 0 && <span className="num rounded-full bg-subtle px-1.5 text-2xs text-fg">{count}</span>}
              {c.style === "underline" && i === index && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--app-accent,var(--theme-primary))]" />}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {c.tabs.map((t, i) => (c.lazy && !opened.has(i) ? null : (
          <div key={i} role="tabpanel" id={`${id}-p${i}`} aria-labelledby={`${id}-t${i}`} hidden={i !== index} className={cn("h-full min-h-0 overflow-auto", t.target?.kind === "form" && "overflow-hidden")}>
            {t.target ? <TabTargetView widget={widget} index={i} target={t.target} context={context} /> : <Children ids={t.widgets} context={context} />}
          </div>
        )))}
        {!current && <Empty text="Add a tab in the widget settings." />}
      </div>
    </div>
  )
}

function TabTargetView({ widget, index, target, context }: { widget: AppWidget; index: number; target: NonNullable<WidgetConfig<"tabs">["tabs"][number]["target"]> & { link_only?: boolean }; context: WidgetContext }) {
  switch (target.kind) {
    case "form": return <StandaloneForm formId={target.form_id} surface="app" fill hideHeader={target.hide_header} contextParams={resolveParams(target.params, { filters: context.filters, app: context.appSlug, page: context.page })} />
    case "page": return <>{context.renderPage?.(target.page_slug, target.filters ?? {}) ?? <Empty text="Pages open here on the app page." />}</>
    case "report": return <div className="p-1"><ReportWidget reportId={target.report_id} /></div>
    case "table": return <TabTable widget={widget} index={index} context={context} />
    case "url":
      return target.link_only
        ? <div className="flex h-full items-center justify-center p-4"><a href={target.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary-text underline">Open in a new tab<ExternalLink className="size-3.5" aria-hidden /></a></div>
        : <iframe src={target.url} title={widget.title || "Embedded content"} className="h-full w-full border-0" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy" />
  }
}

function TabTable({ widget, index, context }: { widget: AppWidget; index: number; context: WidgetContext }) {
  const q = useWidgetData(widget, context, { tab: index })
  if (q.isPending) return <p className="p-2 text-xs text-fg-muted">Loading…</p>
  const d = q.data as { type: string; table?: { id: string; name: string }; columns?: Array<{ key: string; label: string }>; rows?: Array<{ id: string; data: Record<string, unknown> }>; total?: number; reason?: string }
  if (q.error || d.type !== "table_view" || !d.columns) return <Empty text={q.error instanceof Error ? q.error.message : d.reason ?? "No data."} />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-tab-table>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{d.table?.name}</caption>
          <thead className="sticky top-0 bg-panel"><tr>{d.columns.map((col) => <th key={col.key} scope="col" className="border-b border-border px-2 py-1.5 text-left text-xs font-medium text-fg-muted">{col.label}</th>)}</tr></thead>
          <tbody>{(d.rows ?? []).map((r) => <tr key={r.id} className="border-b border-border-subtle">{d.columns!.map((col) => <td key={col.key} className="max-w-64 truncate px-2 py-1.5 text-fg">{cellString(r.data[col.key])}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {d.table && <a href={`/data/${d.table.id}`} className="text-xs text-primary-text hover:underline">{d.total ?? 0} rows · Open table</a>}
    </div>
  )
}

const cellString = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? String((v as Record<string, unknown>).label ?? (v as Record<string, unknown>).name ?? JSON.stringify(v)) : String(v))

function Children({ ids, context }: { ids: string[]; context: WidgetContext }) {
  const list = ids.map((id) => context.widgets?.get(id)).filter((w): w is AppWidget => !!w)
  if (!list.length) return <Empty text={context.preview ? "Choose widgets for this container in its settings." : "Nothing here."} />
  return (
    <div className="grid grid-cols-12 gap-3">
      {list.map((w) => (
        <div key={w.id} className="col-span-12 min-h-0 rounded-lg border border-border bg-panel p-3 @[40rem]:col-[span_var(--w)]" style={{ "--w": `span ${w.w}`, gridColumn: `span ${Math.min(12, w.w)} / span ${Math.min(12, w.w)}`, minHeight: `${w.h * 40}px` } as React.CSSProperties} data-child-widget={w.id}>
          {context.renderChild?.(w)}
        </div>
      ))}
    </div>
  )
}

export function SectionWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"section">
  const [open, setOpen] = useState(!c.collapsed)
  return (
    <section className="flex h-full min-h-0 flex-col gap-2" data-widget-section aria-label={c.label}>
      {c.collapsible ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-left text-sm font-semibold text-fg">
          {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}{c.label}
        </button>
      ) : <h2 className="text-sm font-semibold text-fg">{c.label}</h2>}
      {open && <div className="min-h-0 flex-1 overflow-auto"><Children ids={c.widgets} context={context} /></div>}
    </section>
  )
}

export function TilesWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"tiles">
  const dispatch = useAppDispatch(context)
  if (!c.tiles.length) return <Empty text="Add tiles in the widget settings." />
  return (
    <ul className="grid h-full gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${Math.max(8, 36 / c.columns)}rem), 1fr))` }} data-widget-tiles>
      {c.tiles.map((t, i) => {
        const Icon = appIcon(t.icon ?? (t.action.kind === "new_submission" ? "FileText" : t.action.kind === "start_workflow" ? "Rocket" : "LayoutGrid"))
        const go = () => void dispatch({ type: "button_click", widget: widget.id, index: i, label: t.label, action: t.action, mode: t.open_mode ?? null })
        return (
          <li key={i}>
            <button type="button" onClick={go} className="flex h-full w-full items-start gap-3 rounded-lg border border-border bg-panel p-3 text-left transition-colors hover:border-[var(--app-accent,var(--theme-primary))] hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]" data-tile={t.action.kind}>
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[var(--app-accent-wash,var(--theme-primary-light))] text-[var(--app-accent,var(--theme-primary))]"><Icon className="size-5" aria-hidden /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-fg">{t.label}</span>{t.description && <span className="line-clamp-2 text-xs text-fg-muted">{t.description}</span>}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The page's title area: the page's icon in a soft tile, its title and an
 * optional subtitle. The app header above already names the app, so the
 * breadcrumb ("Apps › <app>") only shows where that header doesn't (embedded
 * pages, apps that hide their title).
 */
export function PageHeaderWidget({ widget, context, app, pageTitle }: { widget: AppWidget; context: WidgetContext; app?: { name: string; icon: string | null; color: string | null; slug: string; home_page: string | null; pages?: ReadonlyArray<{ id: string; slug: string; icon: string | null }>; nav?: { show_title?: boolean } | null }; pageTitle?: string }) {
  const c = widget.config as WidgetConfig<"page_header">
  if (!app) return null
  const page = app.pages?.find((p) => p.id === context.page)
  const icon = page?.icon || (app.pages?.[0]?.id === context.page ? "House" : "FileText")
  const breadcrumb = c.show_breadcrumb && (context.embed || app.nav?.show_title === false)
  return (
    <div className="flex h-full min-w-0 items-center gap-3" data-widget-page-header>
      {c.show_icon && (
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--app-accent-wash,var(--theme-primary-light))] text-primary-text" aria-hidden>
          <AppIconGlyph name={icon} className="size-[18px]" />
        </span>
      )}
      <div className="min-w-0">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="truncate text-xs text-fg-muted">
            <Link href={`${context.base ?? "/apps"}/${app.slug}`} className="hover:underline">{app.name}</Link><span aria-hidden> › </span><span aria-current="page">{pageTitle ?? app.name}</span>
          </nav>
        )}
        <h2 className="truncate text-xl font-semibold leading-tight tracking-tight text-fg" title={pageTitle ?? app.name}>{pageTitle ?? app.name}</h2>
        {c.subtitle && <p className="truncate text-ui text-fg-muted" title={c.subtitle}>{c.subtitle}</p>}
      </div>
    </div>
  )
}

export function QuickSearchWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"quick_search">
  const [q, setQ] = useState("")
  const [term, setTerm] = useState("")
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t) }, [q])
  const res = useQuery({
    queryKey: ["apps", "quick-search", context.app, term, c.include, context.previewArgs ?? null],
    enabled: term.length >= 2,
    queryFn: async () => (await serverQuery("apps.quickSearch", { app: context.app, q: term, include: c.include, ...(context.previewArgs ?? {}) })) as { hits: Array<{ kind: string; id: string; title: string; hint: string | null; href: string | null }> },
  })
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" role="search" data-widget-quick-search>
      <label className="flex items-center gap-2 rounded-md border border-border bg-panel px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--theme-primary)]">
        <Search className="size-4 text-fg-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.placeholder} aria-label={c.placeholder} className="w-full bg-transparent text-sm text-fg outline-none" />
      </label>
      {term.length >= 2 && (
        <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto scrollbar-thin" aria-live="polite">
          {res.isPending ? <li className="py-1 text-xs text-fg-muted">Searching…</li> : !res.data?.hits.length ? <li className="py-1 text-xs text-fg-muted">Nothing found.</li> : res.data.hits.map((h) => (
            <li key={`${h.kind}:${h.id}`} className="py-1">
              {h.href ? <Link href={h.href} target={context.embed ? "_blank" : undefined} className="block truncate text-sm text-fg hover:underline">{h.title}</Link> : <span className="block truncate text-sm text-fg">{h.title}</span>}
              {h.hint && <span className="text-2xs text-fg-muted">{h.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ChatTurn { role: "user" | "agent"; text: string }

export function AgentChatWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"agent_chat">
  const [turns, setTurns] = useState<ChatTurn[]>(c.greeting ? [{ role: "agent", text: c.greeting }] : [])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }) }, [turns, busy])
  if (!c.agent_id) return <Empty text="Choose an agent in the widget settings." icon={<Bot className="size-5 text-fg-subtle" aria-hidden />} />
  const send = async () => {
    const message = input.trim()
    if (!message || busy) return
    if (context.preview) { setError("Chat works on the saved page, not in the builder."); return }
    setInput(""); setError(null); setBusy(true)
    const history = turns.slice(-8)
    setTurns((t) => [...t, { role: "user", text: message }])
    const r = await askAppAgent({ app: context.app, page: context.page, widget_id: widget.id, message, history, ...(context.previewArgs ?? {}) })
    if (!r.ok) { setBusy(false); setError(r.error); return }
    // Poll the queued run (up to ~2 minutes).
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, i < 5 ? 1000 : 2000))
      const reply = await appAgentReply({ app: context.app, page: context.page, widget_id: widget.id, job_id: r.data.job_id, ...(context.previewArgs ?? {}) })
      if (!reply.ok) { setError(reply.error); break }
      if (reply.data.status === "completed") { setTurns((t) => [...t, { role: "agent", text: reply.data.text ?? "(No answer.)" }]); break }
      if (reply.data.status === "failed" || reply.data.status === "cancelled") { setError(reply.data.error ?? "The agent couldn’t answer."); break }
    }
    setBusy(false)
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-widget-agent-chat>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin" aria-live="polite">
        {!turns.length && <p className="text-sm text-fg-muted">Ask a question to get started.</p>}
        {turns.map((t, i) => (
          <div key={i} className={cn("max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", t.role === "user" ? "ml-auto bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))]" : "bg-subtle text-fg")}>{t.text}</div>
        ))}
        {busy && <div className="w-fit rounded-lg bg-subtle px-3 py-2 text-sm text-fg-muted" role="status">Thinking…</div>}
        <div ref={end} />
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={c.placeholder} aria-label={c.placeholder} maxLength={4000}
          className="min-w-0 flex-1 rounded-md border border-border bg-panel px-2 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]" />
        <Button type="submit" size="sm" leadingIcon={<Send />} loading={busy} disabled={!input.trim()}>Send</Button>
      </form>
    </div>
  )
}

/** Prefill values for the form embed: the viewer, page filters or fixed values → the form's URL parameters. */
export function prefillQuery(prefill: WidgetConfig<"form_embed">["prefill"], ctx: { filters: WidgetContext["filters"]; me?: { id?: string | null; email?: string | null; name?: string | null } }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of prefill) {
    const v = p.from === "me_id" ? ctx.me?.id : p.from === "me_email" ? ctx.me?.email : p.from === "me_name" ? ctx.me?.name
      : p.from === "filter" ? (p.filter ? (typeof ctx.filters[p.filter] === "string" ? ctx.filters[p.filter] as string : null) : null) : p.value
    if (v) out[p.field] = String(v).slice(0, 400)
  }
  return out
}

export function FormEmbedWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"form_embed">
  const dispatch = useAppDispatch(context)
  const [round, setRound] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const me = useQuery({ queryKey: ["tasks", "myProfile"], enabled: c.prefill.some((p) => p.from.startsWith("me_")) || needsUser(c.params), queryFn: () => serverQuery("tasks.myProfile"), staleTime: 300_000 })
  if (!c.form_id || typeof c.form_id !== "string") {
    return c.unavailable === "notice" && !context.preview
      ? <div className="flex h-full items-center justify-center p-4 text-center text-sm text-fg-muted" data-form-unavailable>This form isn’t available to you here.</div>
      : <Empty text="Choose a form in the widget settings." />
  }
  if (message) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center" role="status" data-form-embed-message>
        <p className="text-sm text-fg">{message}</p>
        <Button size="sm" variant="secondary" onClick={() => { setMessage(null); setRound((r) => r + 1) }}>Submit another</Button>
      </div>
    )
  }
  const params = resolveParams(c.params, { filters: context.filters, app: context.appSlug, page: context.page, user: { name: me.data?.display_name ?? null }, query: typeof window === "undefined" ? {} : Object.fromEntries(new URLSearchParams(window.location.search)) })
  const query = { ...prefillQuery(c.prefill, { filters: context.filters, me: { id: null, email: null, name: me.data?.display_name ?? null } }), ...params }
  return (
    <div className="h-full w-full" data-widget-form-embed>
      <StandaloneForm key={round} formId={c.form_id} surface="app" fill hideHeader={c.hide_header} query={query} contextParams={params}
        onSubmitted={(r) => void dispatch({ type: "form_submitted", widget: widget.id, form: String(c.form_id), submission_id: r.submission_id, values: r.values, then: { kind: "none" } })}
        onDone={c.after_submit === "thank_you" ? undefined : (event) => {
          if (event !== "submitted") { setRound((r) => r + 1); return }
          if (c.after_submit === "reset") setRound((r) => r + 1)
          else if (c.after_submit === "message") setMessage(c.after_message || "Thank you — your response was sent.")
          else if (c.after_submit === "page" && c.after_page) void dispatch({ type: "form_submitted", widget: widget.id, form: String(c.form_id), then: { kind: "navigate", page: c.after_page } })
        }} />
    </div>
  )
}

const BAR_TONE = { surface: "bg-panel text-fg", app: "bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))]", dark: "bg-[#111827] text-white" } as const

/** A Nav bar widget docked to a page edge (the page view docks it; this draws it). */
export function NavBarWidget({ widget, nav }: { widget: AppWidget; nav: NavTarget }) {
  const c = widget.config as WidgetConfig<"nav_bar">
  const [collapsed, setCollapsed] = useState(false)
  if (c.edge === "top") {
    return (
      <div className={cn("flex items-center gap-2 border-b border-border px-2", BAR_TONE[c.background])} style={{ minHeight: Math.min(c.size, 96) }} data-nav-bar="top">
        <OverflowMenu items={c.items} nav={nav} density={c.density} iconSize={c.icon_size} showLabels={c.show_labels} stateKey={`bar:${widget.id}`} tone={c.background} />
      </div>
    )
  }
  return (
    <div className={cn("h-full border-border p-2", c.edge === "left" ? "border-r" : "border-l", BAR_TONE[c.background])} style={{ width: collapsed ? 56 : c.size }} data-nav-bar={c.edge}>
      <SideNav items={c.items} nav={nav} stateKey={`bar:${widget.id}`} search={c.show_search} searchObjects={c.search_objects} collapsible={c.collapsible}
        collapsed={collapsed} onCollapsedChange={setCollapsed} density={c.density} iconSize={c.icon_size} showLabels={c.show_labels}
        footerProfile={c.footer_profile} helpUrl={c.footer_help_url ?? null} tone={c.background} />
    </div>
  )
}

export { toCsv }
