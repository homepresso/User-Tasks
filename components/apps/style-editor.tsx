"use client"

import { useState } from "react"
import { AlertTriangle, ClipboardPaste, Copy, Pipette, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { updateApp } from "@/app/actions/apps"
import {
  COLOR_KEYS, COLOR_LABELS, COLOR_TOKENS, COLOR_TOKEN_NAMES, PALETTE_PRESETS, contrastWarnings, cssColor, isColor, parseColor, resolveWidgetStyle, toHex, widgetStyleSchema,
  type AppStyle, type ColorKey, type PalettePreset, type ThemedColor, type WidgetStyle,
} from "@/lib/apps/style"
import type { AppDetail, AppWidget } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"

/**
 * The widget settings panel's Style tab (lib/apps/style.ts): colours (theme
 * tokens and the palette first, custom hex / rgb / hsl with alpha, an
 * eyedropper where the browser has one, optional separate dark-mode
 * values), a live WCAG AA contrast check, radius / border / shadow /
 * padding / background image or gradient / title and value type /
 * alignment, the app's named styles (save, apply, copy / paste), the app
 * default every widget inherits, and Reset to theme.
 */

const CLIP = "ut:apps:style-clipboard"
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ")

/** One colour: a theme token or a custom colour with alpha; optional dark-mode value. */
export function ColorField({ value, onChange, name, allowDark = true }: { value: ThemedColor | null | undefined; onChange: (v: ThemedColor | null) => void; name: string; allowDark?: boolean }) {
  const light = value ? (typeof value === "string" ? value : value.light) : null
  const dark = value && typeof value !== "string" ? value.dark ?? null : null
  const [split, setSplit] = useState(!!dark)
  const set = (l: string | null, d: string | null) => onChange(!l ? null : split && d ? { light: l, dark: d } : l)
  return (
    <div className="space-y-1" data-color-field={name}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs text-fg">{name}</span>
        {allowDark && <button type="button" className="text-2xs text-primary-text" onClick={() => { setSplit(!split); if (split) set(light, null) }}>{split ? "One value" : "Dark value…"}</button>}
      </div>
      <OneColor value={light} onChange={(v) => set(v, dark)} label={`${name}${split ? " (light)" : ""}`} />
      {split && <OneColor value={dark} onChange={(v) => set(light ?? v, v)} label={`${name} (dark)`} />}
    </div>
  )
}

function OneColor({ value, onChange, label: aria }: { value: string | null; onChange: (v: string | null) => void; label: string }) {
  const isToken = value?.startsWith("token:")
  const rgba = value && !isToken ? parseColor(value) : null
  const [text, setText] = useState(value && !isToken ? value : "")
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setText(value && !isToken ? value : "") }
  const withAlpha = (hex: string, a: number) => (a >= 1 ? hex : `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`)
  const pickEye = async () => {
    const Eye = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!Eye) return
    try { const r = await new Eye().open(); onChange(r.sRGBHex) } catch { /* cancelled */ }
  }
  const hasEye = typeof window !== "undefined" && "EyeDropper" in window
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-1">
      <span className="size-6 rounded border border-border" style={{ background: value ? cssColor(value) : "transparent" }} aria-hidden />
      <div className="flex min-w-0 gap-1">
        <Select size="sm" aria-label={`${aria}: source`} value={isToken ? value! : value ? "custom" : ""} className="min-w-0 flex-1"
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "custom" ? (rgba ? value : "#2563eb") : e.target.value)}
          options={[{ value: "", label: "Theme default" }, ...COLOR_TOKEN_NAMES.map((t) => ({ value: `token:${t}`, label: `Theme: ${label(t)}` })), { value: "custom", label: "Custom colour…" }]} />
        {value && !isToken && (
          <>
            <input type="color" aria-label={`${aria}: pick`} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent" value={rgba ? toHex(rgba) : "#2563eb"} onChange={(e) => onChange(withAlpha(e.target.value, rgba?.a ?? 1))} />
            {hasEye && <IconButton size="sm" label="Pick from the screen" icon={<Pipette />} onClick={() => void pickEye()} />}
          </>
        )}
      </div>
      {value && !isToken && (
        <div className="col-span-2 grid grid-cols-[1fr_6rem] gap-1">
          <Input size="sm" aria-label={`${aria}: value`} value={text} placeholder="#2563eb, rgb(37 99 235), hsl(…)" onChange={(e) => { setText(e.target.value); if (isColor(e.target.value.trim())) onChange(e.target.value.trim()) }}
            className={cn(text && !isColor(text.trim()) && "border-danger")} />
          <label className="flex items-center gap-1 text-2xs text-fg-muted">α<input type="range" min={0} max={100} value={Math.round((rgba?.a ?? 1) * 100)} aria-label={`${aria}: opacity`} className="w-full"
            onChange={(e) => rgba && onChange(withAlpha(toHex(rgba), Number(e.target.value) / 100))} /></label>
        </div>
      )}
    </div>
  )
}

function StyleFields({ style, onChange, widgetType }: { style: WidgetStyle; onChange: (s: WidgetStyle) => void; widgetType?: string }) {
  const set = (patch: Partial<WidgetStyle>) => onChange({ ...style, ...patch })
  const setColor = (k: ColorKey, v: ThemedColor | null) => set({ colors: { ...(style.colors ?? {}), [k]: v } })
  const groups: Array<[string, ColorKey[]]> = [
    ["Card", ["background", "border", "header", "title", "text", "muted", "accent"]],
    ["Numbers & buttons", ["kpi_value", "button_bg", "button_text", "button_border"]],
    ["Tables, tabs & navigation", ["table_header", "table_stripe", "table_hover", "tab_active", "tab_inactive", "nav_bg", "nav_item", "nav_active"]],
  ]
  const sel = <K extends keyof WidgetStyle>(k: K, l: string, choices: string[]) => (
    <label className="space-y-0.5"><span className="block text-2xs font-medium text-fg-muted">{l}</span>
      <Select size="sm" value={String(style[k] ?? "")} onChange={(e) => set({ [k]: e.target.value || null } as Partial<WidgetStyle>)} options={[{ value: "", label: "Theme" }, ...choices.map((c) => ({ value: c, label: label(c) }))]} /></label>
  )
  const palette = style.palette
  const warnings = contrastWarnings(style)
  return (
    <div className="space-y-3">
      {warnings.length > 0 && <div role="alert" className="space-y-0.5 rounded-md border border-warning bg-warning-wash p-2 text-2xs text-warning" data-contrast-warning>{warnings.map((w) => <p key={w} className="flex gap-1"><AlertTriangle className="size-3 shrink-0" aria-hidden />{w}</p>)}</div>}
      {groups.map(([g, keys]) => (
        <details key={g} open={g === "Card"} className="rounded-md border border-border p-2">
          <summary className="cursor-pointer text-xs font-semibold text-fg">{g}</summary>
          <div className="mt-2 space-y-2">{keys.map((k) => <ColorField key={k} name={COLOR_LABELS[k]} value={style.colors?.[k]} onChange={(v) => setColor(k, v)} />)}</div>
        </details>
      ))}
      <details className="rounded-md border border-border p-2" open={widgetType === "chart" || widgetType === "pivot"}>
        <summary className="cursor-pointer text-xs font-semibold text-fg">Chart colours & value colours</summary>
        <div className="mt-2 space-y-2">
          <Select size="sm" aria-label="Palette" value={typeof palette === "string" ? palette : Array.isArray(palette) ? "custom" : ""}
            onChange={(e) => set({ palette: e.target.value === "" ? null : e.target.value === "custom" ? [...PALETTE_PRESETS.vivid] : e.target.value as PalettePreset })}
            options={[{ value: "", label: "Theme palette" }, ...Object.keys(PALETTE_PRESETS).map((p) => ({ value: p, label: `Preset: ${label(p)}` })), { value: "custom", label: "Custom colours…" }]} />
          {Array.isArray(palette) && <div className="flex flex-wrap gap-1">{palette.map((c, i) => (
            <input key={i} type="color" aria-label={`Series ${i + 1}`} value={parseColor(c) ? toHex(parseColor(c)!) : "#2563eb"} className="h-7 w-7 cursor-pointer rounded border border-border" onChange={(e) => set({ palette: palette.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}</div>}
          <span className="block text-2xs font-medium text-fg-muted">Colour per value (chart categories, statuses, badges)</span>
          {(style.value_colors ?? []).map((vc, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-1">
              <Input size="sm" aria-label="Value" value={vc.value} onChange={(e) => set({ value_colors: (style.value_colors ?? []).map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <input type="color" aria-label={`Colour for ${vc.value}`} className="h-8 w-8 cursor-pointer rounded border border-border" value={parseColor(vc.color) ? toHex(parseColor(vc.color)!) : "#2563eb"} onChange={(e) => set({ value_colors: (style.value_colors ?? []).map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <IconButton size="sm" label="Remove" icon={<RotateCcw />} onClick={() => set({ value_colors: (style.value_colors ?? []).filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => set({ value_colors: [...(style.value_colors ?? []), { value: "Approved", color: "#16a34a" }] })} disabled={(style.value_colors?.length ?? 0) >= 24}>Add value colour</Button>
        </div>
      </details>
      <details className="rounded-md border border-border p-2">
        <summary className="cursor-pointer text-xs font-semibold text-fg">Shape, spacing & type</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {sel("radius", "Corners", ["none", "sm", "md", "lg", "xl"])}
          {sel("shadow", "Shadow", ["none", "sm", "md", "lg"])}
          {sel("border_style", "Border style", ["solid", "dashed", "dotted", "none"])}
          <label className="space-y-0.5"><span className="block text-2xs font-medium text-fg-muted">Border width</span><Input size="sm" type="number" min={0} max={4} value={style.border_width ?? ""} onChange={(e) => set({ border_width: e.target.value === "" ? null : Math.min(4, Math.max(0, Number(e.target.value))) })} /></label>
          {sel("padding", "Padding", ["compact", "comfortable", "spacious"])}
          {sel("align", "Text alignment", ["left", "center", "right"])}
          {sel("title_size", "Title size", ["sm", "md", "lg", "xl"])}
          {sel("title_weight", "Title weight", ["normal", "medium", "semibold", "bold"])}
          {sel("value_size", "Value size (KPIs)", ["sm", "md", "lg", "xl"])}
          {sel("value_weight", "Value weight", ["normal", "medium", "semibold", "bold"])}
        </div>
      </details>
      <details className="rounded-md border border-border p-2">
        <summary className="cursor-pointer text-xs font-semibold text-fg">Background image or gradient</summary>
        <div className="mt-2 space-y-1.5">
          <Select size="sm" aria-label="Background" value={style.background_image?.kind ?? ""} onChange={(e) => set({ background_image: e.target.value === "image" ? { kind: "image", url: "", fit: "cover" } : e.target.value === "gradient" ? { kind: "gradient", from: "token:primary", to: "token:accent", angle: 135 } : null })}
            options={[{ value: "", label: "None" }, { value: "image", label: "Image (https:// or /path)" }, { value: "gradient", label: "Gradient" }]} />
          {style.background_image?.kind === "image" && <Input size="sm" aria-label="Image address" value={style.background_image.url} placeholder="https://… or /files/…" onChange={(e) => set({ background_image: { kind: "image", url: e.target.value.trim(), fit: "cover" } })} />}
          {style.background_image?.kind === "gradient" && (() => { const g = style.background_image; return (
            <div className="grid grid-cols-[1fr_1fr_5rem] gap-1">
              <OneColor value={g.from} label="From" onChange={(v) => set({ background_image: { ...g, from: v ?? "token:primary" } })} />
              <OneColor value={g.to} label="To" onChange={(v) => set({ background_image: { ...g, to: v ?? "token:accent" } })} />
              <Input size="sm" type="number" min={0} max={360} aria-label="Angle" value={g.angle} onChange={(e) => set({ background_image: { ...g, angle: Math.min(360, Math.max(0, Number(e.target.value) || 0)) } })} />
            </div>
          ) })()}
        </div>
      </details>
    </div>
  )
}

/** The Style tab: this widget, or the app's default widget style; named styles; copy / paste; reset. */
export function StyleEditor({ widget, onChange, app, onAppSaved }: { widget: AppWidget; onChange: (w: AppWidget) => void; app: AppDetail; onAppSaved: () => void }) {
  const [scope, setScope] = useState<"widget" | "app">("widget")
  const [appStyle, setAppStyle] = useState<AppStyle>(app.style ?? { presets: [] })
  const [name, setName] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const own = widget.style ?? {}
  const setOwn = (s: WidgetStyle) => onChange({ ...widget, style: s })
  const saveApp = async (next: AppStyle, note: string) => {
    const r = await updateApp(app.id, { style: next })
    if (!r.ok) { setMsg(r.error); return }
    setAppStyle(next); setMsg(note); onAppSaved()
  }
  const effective = resolveWidgetStyle(appStyle, own)
  return (
    <div className="space-y-3" data-style-editor>
      <div className="flex gap-1" role="tablist">
        <Button size="sm" role="tab" aria-selected={scope === "widget"} variant={scope === "widget" ? "primary" : "ghost"} onClick={() => setScope("widget")}>This widget</Button>
        <Button size="sm" role="tab" aria-selected={scope === "app"} variant={scope === "app" ? "primary" : "ghost"} onClick={() => setScope("app")}>App default</Button>
      </div>
      {scope === "widget" ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <Select size="sm" aria-label="Start from a named style" value={own.preset ?? ""} className="min-w-0 flex-1"
              onChange={(e) => setOwn({ ...own, preset: e.target.value || null })} options={[{ value: "", label: appStyle.default ? "App default" : "Theme" }, ...appStyle.presets.map((p) => ({ value: p.name, label: `Style: ${p.name}` }))]} />
            <IconButton size="sm" label="Copy style" icon={<Copy />} onClick={() => { try { localStorage.setItem(CLIP, JSON.stringify(own)) } catch { /* unavailable */ } setMsg("Style copied — paste it on another widget.") }} />
            <IconButton size="sm" label="Paste style" icon={<ClipboardPaste />} onClick={() => { try { const p = widgetStyleSchema.safeParse(JSON.parse(localStorage.getItem(CLIP) ?? "null")); if (p.success) { setOwn(p.data); setMsg("Style pasted.") } else setMsg("Nothing to paste.") } catch { setMsg("Nothing to paste.") } }} />
            <IconButton size="sm" label="Reset to theme" icon={<RotateCcw />} onClick={() => { onChange({ ...widget, style: undefined }); setMsg("Reset to the theme (and the app default).") }} data-style-reset />
          </div>
          <StyleFields style={own} onChange={setOwn} widgetType={widget.type} />
          <div className="flex gap-1">
            <Input size="sm" aria-label="Name for this style" placeholder="Save as a named style…" value={name} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" variant="secondary" leadingIcon={<Save />} disabled={!name.trim() || appStyle.presets.length >= 30}
              onClick={() => void saveApp({ ...appStyle, presets: [...appStyle.presets.filter((p) => p.name !== name.trim()), { name: name.trim(), style: { ...effective, preset: null } }] }, `Saved “${name.trim()}”. Apply it to other widgets from “Start from”.`)}>Save</Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-2xs text-fg-muted">Every widget of the app inherits this; a widget’s own style (or a named style) overrides it. Saved to the app at once.</p>
          <StyleFields style={appStyle.default ?? {}} onChange={(s) => setAppStyle({ ...appStyle, default: s })} />
          <div className="flex gap-1">
            <Button size="sm" onClick={() => void saveApp(appStyle, "App default saved.")}>Save app default</Button>
            <Button size="sm" variant="ghost" onClick={() => void saveApp({ ...appStyle, default: null }, "App default cleared.")}>Clear</Button>
          </div>
          {appStyle.presets.length > 0 && (
            <ul className="space-y-1 text-xs">{appStyle.presets.map((p) => <li key={p.name} className="flex items-center gap-1"><span className="flex-1 truncate">{p.name}</span><Button size="sm" variant="ghost" onClick={() => void saveApp({ ...appStyle, presets: appStyle.presets.filter((x) => x.name !== p.name) }, `Removed “${p.name}”.`)}>Remove</Button></li>)}</ul>
          )}
        </>
      )}
      {msg && <p role="status" className="text-2xs text-fg-muted">{msg}</p>}
      <p className="text-2xs text-fg-muted">Theme colours follow light and dark mode. With one custom value, dark mode reuses it (backgrounds and text are adjusted to stay readable).</p>
    </div>
  )
}

export { COLOR_KEYS, COLOR_TOKENS }
