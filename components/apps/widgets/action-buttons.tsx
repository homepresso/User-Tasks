"use client"

import { cssColor, modeValue } from "@/lib/apps/style"

import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, Copy, Download, ExternalLink, FileText, Filter, Hand, Play, SquareArrowOutUpRight, Table, Zap } from "lucide-react"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Popover } from "@/components/ui/popover"
import { Tooltip } from "@/components/ui/tooltip"
import { StandaloneForm } from "@/components/forms/standalone-form"
import { serverQuery } from "@/lib/server-read"
import type { ActionButton, BadgeSource, WidgetConfig } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { appIcon } from "../app-icon"
import { ReportWidget } from "./report-widget"
import { useAppDispatch, type WidgetContext } from "./kit"

/**
 * The Buttons widget: styled buttons (variant, colour from the theme's
 * semantic tokens or the app colour, size, shape, icon position, full
 * width, description line, live badge, disabled-with-reason, confirmation,
 * keyboard shortcut) laid out in a row, a column, grid tiles or a split
 * button. Each opens its target in its open mode (lib/apps/panels.ts) or
 * claims the next task, copies a link, downloads a report or sets a filter.
 * What happens after is the viewer's own access: the server already removed
 * buttons they may not use (lib/apps/governance.ts).
 */

const SIZE = { sm: "h-8 px-2.5 text-xs gap-1.5", md: "h-9 px-3 text-ui gap-2", lg: "h-11 px-4 text-sm gap-2", xl: "h-14 px-5 text-base gap-2.5" } as const
const ICON = { sm: "size-3.5", md: "size-4", lg: "size-5", xl: "size-6" } as const
const SHAPE = { rounded: "rounded-md", pill: "rounded-full", square: "rounded-none" } as const

/** Solid / tinted colour tokens per colour choice (theme tokens only). */
const COLOR_VAR: Record<ActionButton["color"], { bg: string; fg: string; wash: string; text: string }> = {
  theme: { bg: "var(--theme-primary)", fg: "var(--theme-on-primary)", wash: "var(--theme-primary-light)", text: "var(--theme-primary-text, var(--theme-primary))" },
  app: { bg: "var(--app-accent,var(--theme-primary))", fg: "var(--app-accent-fg,var(--theme-on-primary))", wash: "var(--app-accent-wash,var(--theme-primary-light))", text: "var(--app-accent,var(--theme-primary))" },
  success: { bg: "var(--color-success)", fg: "#fff", wash: "var(--color-success-wash)", text: "var(--color-success)" },
  warning: { bg: "var(--color-warning)", fg: "#000", wash: "var(--color-warning-wash)", text: "var(--color-warning)" },
  danger: { bg: "var(--color-danger)", fg: "var(--color-danger-fg, #fff)", wash: "var(--color-danger-wash)", text: "var(--color-danger)" },
  info: { bg: "var(--color-info)", fg: "#fff", wash: "var(--color-info-wash)", text: "var(--color-info)" },
}

/** CSS for a button: variant × colour (pure; tested). */
/** A button's colours: its own (per-button colours), else the widget style's button colours, else its variant on the theme (lib/apps/style.ts). */
export function buttonStyle(b: Pick<ActionButton, "style" | "color"> & { colors?: ActionButton["colors"] }): React.CSSProperties {
  const color = b.style === "danger" ? COLOR_VAR.danger : COLOR_VAR[b.color]
  const v = (name: "bg" | "text" | "border", widgetVar: string, fallback: string) => `var(--b-${name}, var(${widgetVar}, ${fallback}))`
  const own: Record<string, string> = {}
  for (const k of ["bg", "text", "border"] as const) {
    const c = b.colors?.[k]
    if (!c) continue
    own[`--b-${k}-l`] = cssColor(modeValue(c, "light"))
    own[`--b-${k}-d`] = cssColor(modeValue(c, "dark"))
  }
  const base = (() => {
    switch (b.style) {
      case "primary": case "danger": return { background: v("bg", "--w-btn-bg", color.bg), color: v("text", "--w-btn-text", color.fg), borderColor: v("border", "--w-btn-border", color.bg) }
      case "secondary": return { background: v("bg", "--w-btn-bg", color.wash), color: v("text", "--w-btn-text", color.text), borderColor: v("border", "--w-btn-border", "transparent") }
      case "outline": return { background: v("bg", "--w-btn-bg", "transparent"), color: v("text", "--w-btn-text", color.text), borderColor: v("border", "--w-btn-border", color.text) }
      case "ghost": return { background: v("bg", "--w-btn-bg", "transparent"), color: v("text", "--w-btn-text", color.text), borderColor: v("border", "--w-btn-border", "transparent") }
      case "link": return { background: "transparent", color: v("text", "--w-btn-text", color.text), borderColor: "transparent", textDecoration: "underline", paddingInline: 0 }
    }
  })()
  return { ...own, ...base } as React.CSSProperties
}

/** Does a key event match a shortcut like "alt+n"? */
export function matchesShortcut(e: Pick<KeyboardEvent, "key" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey">, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split("+")
  const key = parts.pop()
  if (!key || e.ctrlKey || e.metaKey) return false
  return e.key.toLowerCase() === key && e.altKey === parts.includes("alt") && e.shiftKey === parts.includes("shift")
}

const fallbackIcon = (b: ActionButton) => ({ new_submission: FileText, start_workflow: Play, open_url: ExternalLink, open_page: SquareArrowOutUpRight, open_report: Table, download_report: Download, open_record: Table, claim_next: Hand, copy_link: Copy, set_filter: Filter, run_rules: Zap })[b.action.kind]

export function ActionButtons({ config, context, widgetId }: { config: WidgetConfig<"actions">; context: WidgetContext; widgetId?: string }) {
  const dispatch = useAppDispatch(context)
  const [confirm, setConfirm] = useState<number | null>(null)
  const [inline, setInline] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const wantsBadges = config.buttons.some((b) => b.badge)
  const badges = useQuery({
    queryKey: ["apps", "widget", context.app, context.page, widgetId, "badges", context.previewArgs ?? null],
    enabled: wantsBadges && !!widgetId,
    queryFn: async () => ((await serverQuery("apps.widget", { app: context.app, page: context.page, widget_id: widgetId!, ...(context.preview ? { preview: { type: "actions", config } } : {}), ...(context.previewArgs ?? {}) })) as { counts?: Partial<Record<BadgeSource, number>> }).counts ?? {},
    staleTime: 60_000,
  })

  const press = async (i: number) => {
    const b = config.buttons[i]
    if (b.disabled_reason) return
    setNote(null)
    if (b.open_mode?.mode === "inline" && (b.action.kind === "new_submission" || b.action.kind === "open_report")) { setInline(inline === i ? null : i); return }
    const r = await dispatch({ type: "button_click", widget: widgetId ?? "", index: i, label: b.label, action: b.action, mode: b.open_mode ?? null })
    if (r.note) setNote(r.note)
  }
  const request = (i: number) => (config.buttons[i].confirm ? setConfirm(i) : void press(i))

  useEffect(() => {
    const withKeys = config.buttons.map((b, i) => [b.shortcut, i] as const).filter(([s]) => !!s)
    if (!withKeys.length) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return
      const hit = withKeys.find(([s]) => matchesShortcut(e, s!))
      if (hit) { e.preventDefault(); request(hit[1]) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }) // re-binds with the latest handlers

  if (!config.buttons.length) return <p className="text-sm text-fg-muted">Add buttons in the widget settings.</p>

  const render = (b: ActionButton, i: number, extra = "") => {
    const Icon = b.icon ? appIcon(b.icon) : fallbackIcon(b)
    const count = b.badge ? badges.data?.[b.badge] : undefined
    const iconOnly = b.icon_position === "only"
    const btn = (
      <button key={i} type="button" onClick={() => request(i)} aria-disabled={b.disabled_reason ? true : undefined} aria-label={iconOnly ? b.label : undefined}
        aria-keyshortcuts={b.shortcut ? b.shortcut.replace(/\+/g, "+").replace(/\b\w/g, (m) => m.toUpperCase()) : undefined}
        style={buttonStyle(b)}
        className={cn("inline-flex items-center justify-center border font-medium transition-[filter,transform] hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--theme-card-bg)] motion-reduce:transition-none",
          SIZE[b.size], SHAPE[b.shape], b.full_width && "w-full", iconOnly && "aspect-square px-0", b.disabled_reason && "cursor-not-allowed opacity-50", b.description && !iconOnly && "h-auto flex-col items-start py-2", extra)}
        data-app-action={b.action.kind} data-action-button>
        <span className={cn("inline-flex items-center", b.icon_position === "right" ? "flex-row-reverse" : "flex-row", SIZE[b.size].split(" ").find((c) => c.startsWith("gap")))}>
          <Icon className={ICON[b.size]} aria-hidden />
          {!iconOnly && <span>{b.label}</span>}
          {typeof count === "number" && <span className="num rounded-full bg-black/15 px-1.5 text-2xs font-semibold" aria-label={`${count}`}>{count > 99 ? "99+" : count}</span>}
        </span>
        {b.description && !iconOnly && <span className="text-left text-2xs font-normal opacity-80">{b.description}</span>}
      </button>
    )
    const tip = b.disabled_reason ?? (iconOnly ? b.label : null)
    return tip ? <Tooltip key={i} content={tip} kbd={b.shortcut ?? undefined}>{btn}</Tooltip> : btn
  }

  const justify = { start: "justify-start", center: "justify-center", end: "justify-end", between: "justify-between" }[config.align]
  const gap = { sm: "gap-1", md: "gap-2", lg: "gap-4" }[config.gap]
  let body: React.ReactNode
  if (config.layout === "split" && config.buttons.length > 1) {
    const [first, ...rest] = config.buttons
    body = (
      <div className={cn("flex", justify)}>
        <div className="inline-flex">
          {render(first, 0, "rounded-r-none")}
          <Popover width={240} aria-label={config.split_label || "More actions"}
            trigger={(t) => <button type="button" {...t} style={buttonStyle(first)} aria-label={config.split_label || "More actions"} className={cn("inline-flex items-center border border-l-black/10 px-2", SHAPE[first.shape], "rounded-l-none")} data-split-toggle><ChevronDown className="size-4" aria-hidden /></button>}>
            {(close: () => void) => (
              <ul className="space-y-0.5" role="menu">
                {rest.map((b, j) => {
                  const Icon = b.icon ? appIcon(b.icon) : fallbackIcon(b)
                  return <li key={j} role="none"><button type="button" role="menuitem" disabled={!!b.disabled_reason} title={b.disabled_reason ?? undefined} onClick={() => { close(); request(j + 1) }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui text-fg hover:bg-subtle disabled:opacity-50"><Icon className="size-4 text-fg-muted" aria-hidden />{b.label}</button></li>
                })}
              </ul>
            )}
          </Popover>
        </div>
      </div>
    )
  } else if (config.layout === "grid") {
    body = <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]", gap)}>{config.buttons.map((b, i) => render({ ...b, full_width: true }, i, "h-full min-h-14 flex-col"))}</div>
  } else {
    body = <div className={cn("flex", gap, config.layout === "column" ? "flex-col items-stretch" : cn("flex-wrap items-center", justify))}>{config.buttons.map((b, i) => render(b, i))}</div>
  }
  const inlineButton = inline !== null ? config.buttons[inline] : null
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-widget-actions>
      {body}
      {note && <p role="status" className="text-xs text-fg-muted">{note}</p>}
      {inlineButton && (
        <div className="min-h-48 overflow-auto rounded-lg border border-border motion-safe:animate-[app-slide-up_160ms_ease-out]" data-inline-target>
          {inlineButton.action.kind === "new_submission" && <StandaloneForm formId={inlineButton.action.form_id} surface="app" fill onDone={() => setInline(null)} />}
          {inlineButton.action.kind === "open_report" && <div className="p-3"><ReportWidget reportId={inlineButton.action.report_id} /></div>}
        </div>
      )}
      <ConfirmDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null) }}
        title={confirm !== null ? config.buttons[confirm]?.confirm?.title ?? "Are you sure?" : ""} description={(confirm !== null ? config.buttons[confirm]?.confirm?.message : "") ?? ""}
        confirmLabel={confirm !== null ? config.buttons[confirm]?.label ?? "Continue" : "Continue"}
        onConfirm={() => { const i = confirm; setConfirm(null); if (i !== null) void press(i) }} />
    </div>
  )
}
