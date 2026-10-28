"use client"

import { useMemo, useRef, useState } from "react"
import { Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LogoUpload } from "@/components/settings/logo-upload"
import { uploadWorkspaceThemeFont } from "@/app/actions/workspace-theme"
import { paletteContrastChecks, checkThemeContrast, type ContrastCheck } from "@/lib/theme/contrast"
import { CURATED_FONTS, SYSTEM_FONT_STACKS, findCuratedFont, type FontSlot } from "@/lib/theme/fonts"
import { DEFAULT_SHADOWS, THEME_TEMPLATES, presetToWorkspaceTheme } from "@/lib/theme/presets"
import { isValidShadow, type FontRef, type ThemeMode, type ThemePalette, type WorkspaceTheme } from "@/lib/theme/schema"
import { fontFamilyValue } from "@/lib/theme/to-css"
import { legiblePalette } from "@/lib/theme/legibility"
import type { ThemePath } from "@/lib/theme/designer-state"
import { ColorField, ContrastBadge, DesignerSection, FieldGroup, RangeField, SegmentedField, SelectField, TextField, ToggleField } from "./controls"

/*
 * The designer's left-hand sections. Each edits the draft through `set(path,
 * value)` (one undoable step per field gesture); `mode` is the palette being
 * edited (and previewed).
 */

export type SetThemeField = (path: ThemePath, value: unknown) => void

interface SectionProps {
  theme: WorkspaceTheme
  set: SetThemeField
  mode: ThemeMode
}

const muted = { color: "var(--theme-muted-text)" }

// ── Start from template ─────────────────────────────────────────────────────

export function TemplateSection({ theme, mode, onApply }: { theme: WorkspaceTheme; mode: ThemeMode; onApply: (id: string) => void }) {
  const [query, setQuery] = useState("")
  const templates = useMemo(() => THEME_TEMPLATES.map((t) => ({ ...t, theme: presetToWorkspaceTheme(t.id)! })), [])
  const q = query.trim().toLowerCase()
  const shown = q ? templates.filter((t) => `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)) : templates
  return (
    <DesignerSection title="Start from template" description={`${THEME_TEMPLATES.length} built-in themes; your logos are kept`} defaultOpen>
      <label className="block text-xs">
        <span className="sr-only">Search templates</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          className="h-8 w-full rounded-lg border px-2 text-xs"
          style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}
        />
      </label>
      <ul className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3" aria-label="Theme templates">
        {shown.map((t) => {
          const p = t.theme.colors[mode]
          const current = theme.meta.basePreset === t.id
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onApply(t.id)}
                aria-pressed={current}
                title={t.description}
                className="w-full border p-1.5 text-left focus-visible:outline-none focus-visible:ring-2"
                style={{
                  borderRadius: "var(--theme-border-radius)",
                  borderColor: current ? "var(--theme-primary)" : "var(--theme-surface-border)",
                  boxShadow: current ? "0 0 0 1px var(--theme-primary)" : undefined,
                  ["--tw-ring-color" as string]: "var(--theme-focus-ring, var(--theme-primary))",
                }}
              >
                <span aria-hidden className="flex h-12 overflow-hidden rounded border" style={{ borderColor: p.surfaceBorder }}>
                  <span className="w-4" style={{ backgroundColor: p.sidebar }} />
                  <span className="flex flex-1 flex-col" style={{ backgroundColor: p.surface }}>
                    <span className="h-2.5" style={{ backgroundColor: p.topbar, borderBottom: `1px solid ${p.surfaceBorder}` }} />
                    <span className="m-1 flex-1 rounded-sm p-1" style={{ backgroundColor: p.cardBg }}>
                      <span className="block h-1.5 w-2/3 rounded-sm" style={{ backgroundColor: p.cardText, opacity: 0.6 }} />
                      <span className="mt-1 block h-1.5 w-1/3 rounded-sm" style={{ backgroundColor: p.primary }} />
                    </span>
                  </span>
                </span>
                <span className="mt-1 block truncate text-[11px] font-medium">{t.name}</span>
                <span className="block truncate text-[10px]" style={muted}>{t.category}</span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="col-span-full text-xs" style={muted}>No template matches “{query}”.</li>}
      </ul>
    </DesignerSection>
  )
}

// ── Colours ─────────────────────────────────────────────────────────────────

type PaletteKey = Exclude<keyof ThemePalette, "status" | "chart">

const COLOR_GROUPS: Array<{ title: string; fields: Array<{ key: PaletteKey; label: string; optional?: boolean }> }> = [
  { title: "Brand", fields: [
    { key: "primary", label: "Primary" }, { key: "primaryHover", label: "Primary hover" }, { key: "primaryLight", label: "Primary tint" },
    { key: "onPrimary", label: "Text on primary", optional: true }, { key: "accent", label: "Accent" }, { key: "accentLight", label: "Accent tint" },
  ] },
  { title: "Navigation", fields: [
    { key: "sidebar", label: "Sidebar" }, { key: "sidebarText", label: "Sidebar text" }, { key: "sidebarActive", label: "Sidebar active" },
    { key: "sidebarBorder", label: "Sidebar border" }, { key: "sidebarAccent", label: "Sidebar accent", optional: true },
    { key: "topbar", label: "Top bar" }, { key: "topbarText", label: "Top bar text" },
  ] },
  { title: "Surfaces & text", fields: [
    { key: "surface", label: "Page background" }, { key: "surfaceBorder", label: "Borders" }, { key: "cardBg", label: "Cards" },
    { key: "cardText", label: "Text" }, { key: "mutedText", label: "Muted text" }, { key: "inputBg", label: "Input background", optional: true },
    { key: "inputBorder", label: "Input border", optional: true }, { key: "focusRing", label: "Focus ring", optional: true }, { key: "overlay", label: "Dialog backdrop" },
  ] },
  { title: "Feedback", fields: [
    { key: "success", label: "Success" }, { key: "warning", label: "Warning" }, { key: "danger", label: "Danger" }, { key: "info", label: "Info" },
  ] },
  { title: "Table rows", fields: [
    { key: "rowHighlight", label: "Highlighted row" }, { key: "rowHighlightStrong", label: "Critical row" },
  ] },
]

const STATUS_FIELDS: Array<{ key: keyof ThemePalette["status"]; label: string }> = [
  { key: "todo", label: "To do" }, { key: "todoBg", label: "To do tint" },
  { key: "progress", label: "In progress" }, { key: "progressBg", label: "In progress tint" },
  { key: "blocked", label: "Blocked" }, { key: "blockedBg", label: "Blocked tint" },
  { key: "done", label: "Done" }, { key: "doneBg", label: "Done tint" },
  { key: "info", label: "Info" }, { key: "infoBg", label: "Info tint" },
  { key: "warningBg", label: "Warning tint" }, { key: "dangerBg", label: "Danger tint" }, { key: "successBg", label: "Success tint" },
]

/** Contrast pair (lib/theme/contrast.ts) → the field its badge sits on: the foreground's field. */
function pairField(pair: string): string {
  const fg = pair.split("/")[0]
  if (fg === "primaryText" || fg === "onPrimary") return "primary"
  if (fg === "accentText") return "accent"
  return fg
}

/** Worst check per field (lowest share of its target), so each field shows one badge. */
function worstByField(checks: ContrastCheck[]): Map<string, ContrastCheck[]> {
  const map = new Map<string, ContrastCheck[]>()
  const score = (c: ContrastCheck) => (c.ratio ?? Infinity) / c.required
  for (const check of checks) {
    const field = pairField(check.pair)
    const prev = map.get(field)?.[0]
    if (!prev || score(check) < score(prev)) map.set(field, [check])
  }
  return map
}

export function ColorsSection({ theme, set, mode, onModeChange }: SectionProps & { onModeChange: (mode: ThemeMode) => void }) {
  const palette = theme.colors[mode]
  const checks = useMemo(() => paletteContrastChecks(palette, theme.chrome), [palette, theme.chrome])
  const byField = useMemo(() => worstByField(checks), [checks])
  const lowCount = checks.filter((c) => !c.ok && c.level !== "block").length
  const blocking = checks.filter((c) => !c.ok && c.level === "block")
  const unused = theme.meta.mode !== "auto" && theme.meta.mode !== mode
  const path = (...rest: Array<string | number>) => ["colors", mode, ...rest]

  return (
    <DesignerSection title="Colours" description="Light and dark palettes with WCAG contrast checks">
      <SegmentedField label="Editing palette" value={mode} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={onModeChange} />
      {unused && (
        <p className="text-xs" style={muted}>
          The theme is always {theme.meta.mode}, so members never see this palette. Change “Appearance” to “Follow device” to use it.
        </p>
      )}
      {blocking.length > 0 && (
        <p role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ color: "var(--theme-danger)", borderColor: "var(--theme-danger)" }}>
          {blocking.map((c) => `${c.pair.replace("/", " on ")} is ${c.ratio}:1`).join("; ")} — below 3:1, so the theme can’t be saved until it is fixed.
        </p>
      )}
      {lowCount > 0 && (
        <p className="rounded-lg border px-3 py-2 text-xs" style={{ color: "var(--theme-card-text)", borderColor: "var(--theme-warning)" }}>
          {lowCount} text {lowCount === 1 ? "pair is" : "pairs are"} below the WCAG target (4.5:1 for text, 3:1 for large text, sidebar highlights and charts) — hover a badge for details. Members see those colours nudged to the nearest readable shade.
        </p>
      )}
      {(blocking.length > 0 || lowCount > 0) && (
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => set(["colors"], { light: legiblePalette(theme.colors.light, theme.chrome), dark: legiblePalette(theme.colors.dark, theme.chrome) })}
        >
          Fix contrast in both palettes
        </Button>
      )}
      {COLOR_GROUPS.map((group) => (
        <FieldGroup key={group.title} title={group.title}>
          {group.fields.map((f) => (
            <ColorField
              key={f.key}
              label={f.label}
              optional={f.optional}
              value={palette[f.key] as string | undefined}
              onChange={(v) => set(path(f.key), v)}
              checks={byField.get(f.key) ?? []}
            />
          ))}
        </FieldGroup>
      ))}
      <FieldGroup title="Status pills">
        {STATUS_FIELDS.map((f) => (
          <ColorField key={f.key} label={f.label} value={palette.status[f.key]} onChange={(v) => v && set(path("status", f.key), v)} checks={byField.get(`status.${f.key}`) ?? []} />
        ))}
      </FieldGroup>
      <FieldGroup title={`Chart series (${palette.chart.length} of 6–10)`}>
        {palette.chart.map((color, i) => (
          <div key={i} className="flex items-center gap-1">
            <div className="flex-1"><ColorField label={`Series ${i + 1}`} value={color} onChange={(v) => v && set(path("chart", i), v)} checks={byField.get(`chart${i + 1}`) ?? []} /></div>
            <Button
              type="button" variant="ghost" size="icon" className="h-8 w-8"
              aria-label={`Remove series ${i + 1}`}
              disabled={palette.chart.length <= 6}
              onClick={() => set(path("chart"), palette.chart.filter((_, j) => j !== i))}
            >
              <Trash2 size={14} aria-hidden />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={palette.chart.length >= 10} onClick={() => set(path("chart"), [...palette.chart, palette.chart[palette.chart.length % 6]])}>
          <Plus size={14} aria-hidden /> Add series
        </Button>
      </FieldGroup>
    </DesignerSection>
  )
}

// ── Typography ──────────────────────────────────────────────────────────────

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))
const LETTER_SPACING = ["-0.03em", "-0.02em", "-0.01em", "normal", "0.01em", "0.02em", "0.05em"].map((v) => ({ value: v, label: v }))
const SLOT_LABEL: Record<FontSlot, string> = { sans: "Body & UI", display: "Display (headings)", mono: "Monospace (code, ids)" }
const SLOT_CATEGORY: Record<FontSlot, string> = { sans: "sans", display: "serif", mono: "mono" }
const SPECIMEN = "Approve invoice INV-2041 · The quick brown fox jumps over the lazy dog 0123456789"

function FontPicker({ slot, font, onChange }: { slot: FontSlot; font: FontRef; onChange: (font: FontRef) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Show the slot's natural category first, then the rest.
  const ordered = [...CURATED_FONTS].sort((a, b) => Number(b.category === SLOT_CATEGORY[slot]) - Number(a.category === SLOT_CATEGORY[slot]))
  const options = [
    ...ordered.map((f) => ({ value: `google:${f.family}`, label: `${f.family} (${f.category === "sans" ? "sans-serif" : f.category === "serif" ? "serif" : "monospace"})` })),
    ...Object.keys(SYSTEM_FONT_STACKS).map((family) => ({ value: `system:${family}`, label: `${family} (system font)` })),
    ...(font.source === "upload" ? [{ value: `upload:${font.family}`, label: `${font.family} (uploaded)` }] : []),
  ]
  const current = `${font.source}:${font.family}`

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setBusy(true); setError(null)
    const form = new FormData()
    form.set("file", file)
    const result = await uploadWorkspaceThemeFont(form)
    setBusy(false)
    if ("error" in result) { setError(result.error); return }
    onChange(result.font)
  }

  return (
    <div className="space-y-1.5">
      <SelectField
        label={SLOT_LABEL[slot]}
        value={current}
        options={options}
        onChange={(value) => {
          const [source, ...rest] = value.split(":")
          const family = rest.join(":")
          if (source === "google" && findCuratedFont(family)) onChange({ source: "google", family })
          else if (source === "system") onChange({ source: "system", family })
        }}
      />
      <p className="truncate rounded-lg border px-3 py-2 text-sm" style={{ fontFamily: fontFamilyValue(font, slot), borderColor: "var(--theme-surface-border)" }} aria-label={`${SLOT_LABEL[slot]} specimen`}>
        {SPECIMEN}
      </p>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".woff2,font/woff2" className="hidden" onChange={upload} aria-label={`Upload a woff2 font for ${SLOT_LABEL[slot]}`} />
        <Button type="button" variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={13} aria-hidden /> {busy ? "Uploading…" : "Upload woff2"}
        </Button>
        <span className="text-[11px]" style={muted}>Max 1 MB</span>
      </div>
      {error && <p role="alert" className="text-xs" style={{ color: "var(--theme-danger)" }}>{error}</p>}
    </div>
  )
}

export function TypographySection({ theme, set }: SectionProps) {
  const t = theme.typography
  return (
    <DesignerSection title="Typography" description="Fonts, weights and sizes">
      {(["sans", "display", "mono"] as const).map((slot) => (
        <FontPicker key={slot} slot={slot} font={t[slot]} onChange={(font) => set(["typography", slot], font)} />
      ))}
      <FieldGroup title="Weights">
        <SelectField label="Regular" value={t.weights.normal} options={WEIGHTS} onChange={(v) => set(["typography", "weights", "normal"], v)} />
        <SelectField label="Medium" value={t.weights.medium} options={WEIGHTS} onChange={(v) => set(["typography", "weights", "medium"], v)} />
        <SelectField label="Semibold" value={t.weights.semibold} options={WEIGHTS} onChange={(v) => set(["typography", "weights", "semibold"], v)} />
        <SelectField label="Bold" value={t.weights.bold} options={WEIGHTS} onChange={(v) => set(["typography", "weights", "bold"], v)} />
        <SelectField
          label="Page titles"
          value={t.weights.heading ?? 0}
          options={[{ value: 0, label: "Default (semibold)" }, ...WEIGHTS]}
          onChange={(v) => set(["typography", "weights", "heading"], v === 0 ? undefined : v)}
        />
      </FieldGroup>
      <FieldGroup title="Size & headings">
        <RangeField label="Base size" value={t.baseSize} min={12} max={20} step={0.5} onChange={(v) => set(["typography", "baseSize"], v)} />
        <SegmentedField label="Heading font" value={t.headingFont} options={[{ value: "sans", label: "Body font" }, { value: "display", label: "Display font" }]} onChange={(v) => set(["typography", "headingFont"], v)} />
        <SelectField label="Heading letter spacing" value={t.headingLetterSpacing} options={LETTER_SPACING.some((o) => o.value === t.headingLetterSpacing) ? LETTER_SPACING : [...LETTER_SPACING, { value: t.headingLetterSpacing, label: t.headingLetterSpacing }]} onChange={(v) => set(["typography", "headingLetterSpacing"], v)} />
        <ToggleField label="Uppercase form labels" checked={t.uppercaseLabels} onChange={(v) => set(["typography", "uppercaseLabels"], v)} />
      </FieldGroup>
    </DesignerSection>
  )
}

// ── Shape & elevation ───────────────────────────────────────────────────────

const SHADOW_PRESETS: Array<{ id: string; label: string; value: WorkspaceTheme["shadows"] }> = [
  { id: "none", label: "Flat", value: { sm: "none", md: "none", lg: "none", xl: "none", card: "none" } },
  { id: "soft", label: "Soft", value: DEFAULT_SHADOWS },
  { id: "crisp", label: "Crisp", value: {
    sm: "0 1px 0 rgba(0,0,0,0.08)", md: "0 1px 2px rgba(0,0,0,0.12)", lg: "0 2px 4px rgba(0,0,0,0.14)", xl: "0 4px 8px rgba(0,0,0,0.16)", card: "0 1px 0 rgba(0,0,0,0.08)",
  } },
  { id: "deep", label: "Deep", value: {
    sm: "0 2px 4px rgba(0,0,0,0.08)", md: "0 6px 16px rgba(0,0,0,0.12)", lg: "0 16px 40px rgba(0,0,0,0.16)", xl: "0 28px 64px rgba(0,0,0,0.22)", card: "0 6px 16px rgba(0,0,0,0.10)",
  } },
]

const RADII: Array<{ key: keyof WorkspaceTheme["shape"]; label: string; pill?: boolean }> = [
  { key: "cardRadius", label: "Cards" }, { key: "buttonRadius", label: "Buttons", pill: true }, { key: "inputRadius", label: "Inputs" },
  { key: "badgeRadius", label: "Badges", pill: true }, { key: "dialogRadius", label: "Dialogs" },
]

export function ShapeSection({ theme, set }: SectionProps) {
  const active = SHADOW_PRESETS.find((p) => (Object.keys(p.value) as Array<keyof WorkspaceTheme["shadows"]>).every((k) => p.value[k] === theme.shadows[k]))
  return (
    <DesignerSection title="Shape & elevation" description="Corner radii and shadows">
      <FieldGroup title="Corner radius">
        {RADII.map((r) => {
          const value = theme.shape[r.key]
          const pill = value >= 9999
          return (
            <div key={r.key} className="space-y-1">
              <RangeField label={r.label} value={pill ? 32 : Math.min(value, 32)} min={0} max={32} format={(v) => (pill ? "pill" : `${v}px`)} onChange={(v) => set(["shape", r.key], v)} />
              {r.pill && <div className="pl-[9.75rem]"><ToggleField label="Fully rounded (pill)" checked={pill} onChange={(on) => set(["shape", r.key], on ? 9999 : 8)} /></div>}
            </div>
          )
        })}
      </FieldGroup>
      <FieldGroup title="Shadows">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Shadow style">
          {SHADOW_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active?.id === p.id}
              onClick={() => set(["shadows"], p.value)}
              className="flex flex-col items-center gap-2 border p-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2"
              style={{ borderRadius: "var(--theme-border-radius)", borderColor: active?.id === p.id ? "var(--theme-primary)" : "var(--theme-surface-border)", ["--tw-ring-color" as string]: "var(--theme-focus-ring, var(--theme-primary))" }}
            >
              <span aria-hidden className="h-8 w-10 rounded-md" style={{ boxShadow: p.value.lg, backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-surface-border)" }} />
              {p.label}
            </button>
          ))}
        </div>
        {(["sm", "md", "lg", "xl", "card"] as const).map((k) => (
          <TextField
            key={k}
            label={k === "card" ? "Card shadow" : `Shadow ${k}`}
            value={theme.shadows[k]}
            validate={(v) => (isValidShadow(v) ? null : "Use `none` or lengths plus one colour per layer, e.g. 0 2px 8px rgba(0,0,0,0.1)")}
            onChange={(v) => set(["shadows", k], v.trim())}
          />
        ))}
      </FieldGroup>
    </DesignerSection>
  )
}

// ── Density & layout ────────────────────────────────────────────────────────

export function LayoutSection({ theme, set }: SectionProps) {
  return (
    <DesignerSection title="Density & layout" description="Row spacing, sidebar width and top bar height">
      <SegmentedField
        label="Density"
        value={theme.layout.density}
        options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "spacious", label: "Spacious" }]}
        onChange={(v) => set(["layout", "density"], v)}
      />
      <RangeField label="Sidebar width" value={theme.layout.sidebarWidth} min={200} max={360} step={4} onChange={(v) => set(["layout", "sidebarWidth"], v)} />
      <RangeField label="Top bar height" value={theme.layout.topbarHeight} min={48} max={72} onChange={(v) => set(["layout", "topbarHeight"], v)} />
    </DesignerSection>
  )
}

// ── Sidebar & top bar ───────────────────────────────────────────────────────

type Surface = "sidebar" | "topbar"

function BackgroundEditor({ surface, theme, set }: { surface: Surface } & SectionProps) {
  const chrome = theme.chrome[surface]
  const base = theme.colors.light[surface]
  const gradient = chrome.gradient ?? { angle: 180, stops: [{ color: base, at: 0 }, { color: base, at: 100 }] }
  const texture = chrome.texture ?? { pattern: "dots" as const, color: "rgba(255,255,255,0.06)", size: 24 }
  const root = ["chrome", surface]
  return (
    <div className="space-y-2">
      <SegmentedField
        label="Background"
        value={chrome.style}
        options={[{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient" }, { value: "texture", label: "Texture" }]}
        onChange={(style) => set(root, {
          ...chrome,
          style,
          ...(style === "gradient" && !chrome.gradient ? { gradient } : {}),
          ...(style === "texture" && !chrome.texture ? { texture } : {}),
        })}
      />
      {chrome.style === "solid" && <p className="text-xs" style={muted}>Uses the {surface === "sidebar" ? "Sidebar" : "Top bar"} colour of each palette.</p>}
      {(chrome.style === "gradient" || (chrome.style === "texture" && chrome.gradient)) && (
        <>
          <RangeField label="Gradient angle" value={gradient.angle} min={0} max={360} unit="°" onChange={(v) => set([...root, "gradient", "angle"], v)} />
          {gradient.stops.map((stop, i) => (
            <div key={i} className="space-y-1 rounded-lg border p-2" style={{ borderColor: "var(--theme-surface-border)" }}>
              <ColorField label={`Stop ${i + 1}`} value={stop.color} onChange={(v) => v && set([...root, "gradient", "stops", i, "color"], v)} />
              <RangeField label="Position" value={stop.at} min={0} max={100} unit="%" onChange={(v) => set([...root, "gradient", "stops", i, "at"], v)} />
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={gradient.stops.length >= 3} onClick={() => set([...root, "gradient", "stops"], [...gradient.stops.slice(0, 1), { color: gradient.stops[0].color, at: 50 }, ...gradient.stops.slice(1)])}>Add stop</Button>
            <Button type="button" variant="ghost" size="sm" disabled={gradient.stops.length <= 2} onClick={() => set([...root, "gradient", "stops"], [gradient.stops[0], gradient.stops[gradient.stops.length - 1]])}>Remove middle stop</Button>
          </div>
        </>
      )}
      {chrome.style === "texture" && (
        <>
          <ColorField label="Dot colour" value={texture.color} onChange={(v) => v && set([...root, "texture", "color"], v)} />
          <RangeField label="Dot spacing" value={texture.size} min={8} max={64} onChange={(v) => set([...root, "texture", "size"], v)} />
          <ToggleField label="Dots over a gradient" checked={Boolean(chrome.gradient)} onChange={(on) => set([...root, "gradient"], on ? gradient : undefined)} />
        </>
      )}
    </div>
  )
}

export function ChromeSection({ theme, set, mode }: SectionProps) {
  const sidebar = theme.chrome.sidebar
  const gradientIssues = useMemo(() => checkThemeContrast(theme).filter((i) => i.pair.includes("gradient")), [theme])
  const canvas = theme.chrome.canvas.texture
  return (
    <DesignerSection title="Sidebar & top bar" description="Backgrounds, glows, hover and decorations">
      <FieldGroup title="Sidebar">
        <BackgroundEditor surface="sidebar" theme={theme} set={set} mode={mode} />
        {gradientIssues.length > 0 && (
          <ul className="space-y-1 text-xs" aria-label="Gradient contrast">
            {gradientIssues.map((i, n) => (
              <li key={n} className="flex items-center gap-2">
                <ContrastBadge check={{ pair: i.pair, ratio: i.ratio, required: i.required, level: i.level, ok: false }} />
                <span>{i.pair.split("/")[0]} on a gradient stop ({i.background}, {i.mode})</span>
              </li>
            ))}
          </ul>
        )}
        <ColorField label="Hover background" value={sidebar.hoverBg} onChange={(v) => v && set(["chrome", "sidebar", "hoverBg"], v)} />
        <ColorField label="Wordmark colour" value={sidebar.brandColor} onChange={(v) => v && set(["chrome", "sidebar", "brandColor"], v)} />
        <ColorField label="Glow 1" value={sidebar.glow1} onChange={(v) => v && set(["chrome", "sidebar", "glow1"], v)} />
        <ColorField label="Glow 2" value={sidebar.glow2} onChange={(v) => v && set(["chrome", "sidebar", "glow2"], v)} />
        <SegmentedField
          label="Decorations"
          value={sidebar.decorations}
          options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "light", label: "For light sidebars" }]}
          onChange={(v) => set(["chrome", "sidebar", "decorations"], v)}
        />
        {sidebar.decorations === "light" && (
          <ColorField label="Decoration colour" value={sidebar.decorationColor} optional onChange={(v) => set(["chrome", "sidebar", "decorationColor"], v)} />
        )}
      </FieldGroup>
      <FieldGroup title="Top bar">
        <BackgroundEditor surface="topbar" theme={theme} set={set} mode={mode} />
      </FieldGroup>
      <FieldGroup title="Page background">
        <ToggleField
          label="Dot texture"
          checked={Boolean(canvas)}
          onChange={(on) => set(["chrome", "canvas", "texture"], on ? { pattern: "dots", color: "rgba(27,25,22,0.045)", size: 28 } : undefined)}
        />
        {canvas && (
          <>
            <ColorField label="Dot colour" value={canvas.color} onChange={(v) => v && set(["chrome", "canvas", "texture", "color"], v)} />
            <RangeField label="Dot spacing" value={canvas.size} min={8} max={64} onChange={(v) => set(["chrome", "canvas", "texture", "size"], v)} />
          </>
        )}
      </FieldGroup>
    </DesignerSection>
  )
}

// ── Branding ────────────────────────────────────────────────────────────────

export function BrandingSection({ theme, set, tenantId, readOnly }: SectionProps & { tenantId: string; readOnly: boolean }) {
  const b = theme.branding
  return (
    <DesignerSection title="Branding" description="Logos, favicon and wordmark">
      <FieldGroup title="Logo on light sidebars">
        <LogoUpload tenantId={tenantId} variant="logo-light" currentLogoUrl={b.logoLight ?? null} readOnly={readOnly} previewBackground={theme.colors.light.sidebar} onChange={(url) => set(["branding", "logoLight"], url ?? undefined)} />
      </FieldGroup>
      <FieldGroup title="Logo on dark sidebars">
        <LogoUpload tenantId={tenantId} variant="logo-dark" currentLogoUrl={b.logoDark ?? null} readOnly={readOnly} previewBackground={theme.colors.dark.sidebar} onChange={(url) => set(["branding", "logoDark"], url ?? undefined)} />
      </FieldGroup>
      <FieldGroup title="Favicon">
        <LogoUpload tenantId={tenantId} variant="favicon" currentLogoUrl={b.favicon ?? null} readOnly={readOnly} onChange={(url) => set(["branding", "favicon"], url ?? undefined)} />
      </FieldGroup>
      <TextField
        label="Wordmark text"
        value={b.wordmark ?? ""}
        maxLength={40}
        placeholder="usertasks"
        validate={(v) => (/[<>{}]/.test(v) ? "No <, >, { or }" : null)}
        onChange={(v) => set(["branding", "wordmark"], v.trim() ? v : undefined)}
      />
      <p className="text-xs" style={muted}>Shown in the sidebar when there is no logo for the current mode.</p>
    </DesignerSection>
  )
}
