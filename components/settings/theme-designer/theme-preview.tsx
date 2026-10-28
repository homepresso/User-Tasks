"use client"

import { useId, useMemo } from "react"
import { Bell, CheckSquare, Inbox, LayoutGrid, Search, Settings, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { themeAttributes } from "@/lib/theme/resolve"
import { LogoMark } from "@/components/brand/logo"
import { themeFontsHref, themeStylesheet } from "@/lib/theme/to-css"
import type { ThemeMode, WorkspaceTheme } from "@/lib/theme/schema"
import { resolveStorageUrl } from "@/lib/storage/refs"

/**
 * Live preview of the draft theme: real app chrome and components rendered
 * inside a container that carries the draft's CSS variables (to-css scoped
 * output) and theme attributes, so the app's own var-driven rules style it
 * exactly as they will style the app. `mode` forces the light or dark palette.
 *
 * rem-based sizes follow the app's root font size (the saved theme), so the
 * draft's base size is shown with `zoom` relative to it. The preview is inert:
 * it is a picture of the app, not part of the form.
 */
export function ThemePreview({ theme, mode, appBaseSize, logoUrl }: {
  theme: WorkspaceTheme
  mode: ThemeMode
  /** Root font size the app currently renders with (px). */
  appBaseSize: number
  /** Workspace logo fallback when the theme has none. */
  logoUrl?: string | null
}) {
  const rawId = useId()
  const id = `theme-preview-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`
  const forced = useMemo<WorkspaceTheme>(() => ({ ...theme, meta: { ...theme.meta, mode } }), [theme, mode])
  const css = useMemo(() => themeStylesheet(forced, { scope: `#${id}`, important: false }), [forced, id])
  const fontsHref = useMemo(() => themeFontsHref(theme), [theme])
  const attrs = themeAttributes(forced, mode === "dark")
  const data = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null)) as Record<string, string>
  const b = theme.branding
  const logo = resolveStorageUrl(mode === "dark" ? (b.logoDark ?? b.logoLight ?? logoUrl) : (b.logoLight ?? b.logoDark ?? logoUrl))
  const zoom = Math.round((theme.typography.baseSize / (appBaseSize || 16)) * 1000) / 1000

  return (
    <figure className="m-0">
      {fontsHref && <link rel="stylesheet" href={fontsHref} />}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <figcaption className="sr-only">Live preview of the theme in {mode} mode</figcaption>
      <div
        id={id}
        {...data}
        inert
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: "var(--theme-surface-border)", fontFamily: "var(--theme-font-sans)", color: "var(--theme-card-text)", backgroundColor: "var(--theme-surface)" }}
      >
        <div className="flex" style={{ zoom, minHeight: 620 }}>
          <PreviewSidebar logo={logo ?? null} wordmark={b.wordmark ?? null} />
          <div className="flex min-w-0 flex-1 flex-col">
            <PreviewTopbar />
            <div className="flex-1 space-y-4 p-5" style={{ backgroundImage: "var(--theme-canvas-image, none)", backgroundSize: "var(--theme-canvas-image-size, auto)", backgroundColor: "var(--theme-surface)" }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold">Tasks</h1>
                  <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>12 open · 3 due today</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm">Export</Button>
                  <Button variant="ghost" size="sm">Filters</Button>
                  <Button size="sm">New task</Button>
                </div>
              </div>
              <PreviewTaskList />
              <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
                <PreviewTaskDetail />
                <PreviewChart />
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}

const NAV = [
  { label: "Tasks", icon: CheckSquare, active: true, badge: 12 },
  { label: "Queue", icon: Inbox },
  { label: "Automations", icon: Workflow },
  { label: "Reports", icon: LayoutGrid },
  { label: "Settings", icon: Settings },
]

function PreviewSidebar({ logo, wordmark }: { logo: string | null; wordmark: string | null }) {
  return (
    <div className="premium-sidebar themed-sidebar flex shrink-0 flex-col border-r" style={{ width: "calc(var(--theme-sidebar-width) * 0.82)", borderColor: "var(--theme-sidebar-border)" }}>
      <div className="sidebar-decorations pointer-events-none absolute inset-0 z-0">
        <div className="absolute rounded-full" style={{ top: "18%", left: -80, width: 300, height: 300, background: "radial-gradient(circle, var(--sidebar-glow-1) 0%, transparent 70%)" }} />
        <div className="absolute rounded-full" style={{ bottom: "10%", right: -40, width: 240, height: 240, background: "radial-gradient(circle, var(--sidebar-glow-2) 0%, transparent 70%)" }} />
        <div className="deco-workflow absolute" style={{ bottom: 32, left: 12, opacity: 0.05 }}>
          <svg width="160" height="114" viewBox="0 0 280 200" fill="none">
            <rect x="110" y="10" width="60" height="32" rx="8" fill="white" />
            <rect x="30" y="80" width="60" height="32" rx="8" fill="white" />
            <rect x="190" y="80" width="60" height="32" rx="8" fill="white" />
            <path d="M130 42 L60 80" stroke="white" strokeWidth="2" />
            <path d="M150 42 L220 80" stroke="white" strokeWidth="2" />
          </svg>
        </div>
      </div>
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center border-b px-4" style={{ height: "var(--theme-topbar-height)", borderColor: "var(--theme-sidebar-border)" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- workspace upload, any size
            <img src={logo} alt="" className="max-h-7 max-w-[130px] object-contain" />
          ) : (
            <span className="text-lg font-semibold tracking-tight" style={{ color: "var(--sidebar-brand-color)" }}>
              {wordmark ? wordmark : (<span className="inline-flex items-center gap-2"><LogoMark variant="glyph" size={24} color="var(--sidebar-brand-color)" accent="var(--theme-sidebar-accent, var(--theme-primary))" /><span>user<span className="themed-sidebar-accent">tasks</span></span></span>)}
            </span>
          )}
        </div>
        <nav className="space-y-0.5 p-2">
          {NAV.map(({ label, icon: Icon, active, badge }) => (
            <div
              key={label}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${active ? "themed-sidebar-active" : ""}`}
              style={active ? undefined : { color: "var(--theme-sidebar-text)" }}
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {badge ? <span className="rounded-full px-1.5 text-[10px] font-semibold" style={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" }}>{badge}</span> : null}
            </div>
          ))}
          <div className="mt-1 rounded-lg px-3 py-2 text-sm" style={{ color: "var(--theme-sidebar-text)", backgroundColor: "var(--sidebar-hover-bg)" }}>Hovered item</div>
        </nav>
      </div>
    </div>
  )
}

function PreviewTopbar() {
  return (
    <div className="themed-topbar flex shrink-0 items-center gap-3 border-b px-4" style={{ height: "var(--theme-topbar-height)" }}>
      <div className="flex h-8 max-w-xs flex-1 items-center gap-2 rounded-lg border px-3 text-xs" style={{ borderColor: "var(--theme-input-border)", backgroundColor: "var(--theme-input-bg)", color: "var(--theme-muted-text)" }}>
        <Search size={14} /> Search tasks, workflows…
      </div>
      <div className="ml-auto flex items-center gap-3">
        <Bell size={16} />
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold" style={{ backgroundColor: "var(--theme-accent)", color: "var(--theme-on-accent)" }}>AL</span>
      </div>
    </div>
  )
}

const ROWS = [
  { title: "Approve invoice INV-2041", status: "in_progress", priority: "high", due: "Today", row: "highlight" },
  { title: "Vendor onboarding: Contoso", status: "todo", priority: "medium", due: "Tomorrow" },
  { title: "Payment run exceeds limit", status: "blocked", priority: "critical", due: "Overdue", row: "critical" },
  { title: "Quarterly access review", status: "completed", priority: "low", due: "Done" },
] as const

function PreviewTaskList() {
  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: "var(--theme-surface-border)" }}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide" style={{ color: "var(--theme-muted-text)" }}>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr
              key={r.title}
              className="border-t"
              style={{
                borderColor: "var(--theme-surface-border)",
                backgroundColor: "row" in r ? (r.row === "critical" ? "var(--theme-row-highlight-strong)" : "var(--theme-row-highlight)") : undefined,
                boxShadow: "row" in r && r.row === "critical" ? "inset 3px 0 0 var(--theme-danger)" : undefined,
              }}
            >
              <td className="px-3 py-2 font-medium">{r.title}</td>
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="px-3 py-2"><PriorityBadge priority={r.priority} /></td>
              <td className="px-3 py-2 text-xs" style={{ color: r.due === "Overdue" ? "var(--theme-danger)" : "var(--theme-muted-text)" }}>{r.due}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PreviewTaskDetail() {
  const field = { borderColor: "var(--theme-input-border)", backgroundColor: "var(--theme-input-bg)", color: "var(--theme-card-text)" }
  return (
    <div className="space-y-3 rounded-xl border bg-white p-4" style={{ borderColor: "var(--theme-surface-border)" }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Approve invoice INV-2041</h2>
          <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>Invoice approval · step 2 of 3</p>
        </div>
        <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "var(--status-info-bg)", color: "var(--status-info)" }}>SLA 4h</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium">Amount</label>
          <input readOnly value="€ 12,480.00" className="h-9 w-full rounded-lg border px-3 text-sm" style={field} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Cost centre</label>
          <select className="h-9 w-full rounded-lg border px-2 text-sm" style={field} defaultValue="ops"><option value="ops">Operations</option></select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs font-medium">Comment</label>
          <input readOnly placeholder="Add a note for the requester" className="h-9 w-full rounded-lg border px-3 text-sm" style={{ ...field, boxShadow: "0 0 0 2px var(--theme-focus-ring)" }} />
        </div>
      </div>
      <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "color-mix(in srgb, var(--theme-warning) 35%, transparent)", backgroundColor: "var(--status-warning-bg)", color: "var(--theme-warning)" }}>
        Amount is above the €10,000 approval limit.
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm">Approve</Button>
        <Button size="sm" variant="outline">Request changes</Button>
        <Button size="sm" variant="destructive">Reject</Button>
      </div>
    </div>
  )
}

const BARS = [42, 68, 55, 80, 61, 74]

function PreviewChart() {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: "var(--theme-surface-border)" }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Completed this week</h3>
        <span className="text-xs font-semibold" style={{ color: "var(--theme-success)" }}>+18%</span>
      </div>
      <svg viewBox="0 0 240 120" className="h-36 w-full" role="presentation">
        {[30, 60, 90].map((y) => <line key={y} x1="0" x2="240" y1={y} y2={y} style={{ stroke: "var(--theme-surface-border)" }} strokeWidth="1" />)}
        {BARS.map((h, i) => (
          <rect key={i} x={10 + i * 38} y={110 - h} width="26" height={h} rx="4" style={{ fill: `var(--theme-chart-${i + 1})` }} />
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--theme-muted-text)" }}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
          <span key={d} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: `var(--theme-chart-${i + 1})` }} />{d}</span>
        ))}
      </div>
    </div>
  )
}
