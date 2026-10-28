"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { isValidColor, parseColor } from "@/lib/theme/colors"
import type { ContrastCheck } from "@/lib/theme/contrast"

/*
 * Small form controls for the theme designer. Every control has a visible
 * label tied to its input; colours, contrast and validity are also given as
 * text, never by colour alone.
 */

const muted = { color: "var(--theme-muted-text)" }
const fieldBorder = { borderColor: "var(--theme-input-border, var(--theme-surface-border))", backgroundColor: "var(--theme-input-bg, var(--theme-card-bg))", color: "var(--theme-card-text)" }

/** Collapsible designer section (a disclosure button + region). */
export function DesignerSection({ title, description, defaultOpen = false, children }: { title: string; description?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="border-b last:border-b-0" style={{ borderColor: "var(--theme-surface-border)" }}>
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
          style={{ ["--tw-ring-color" as string]: "var(--theme-focus-ring, var(--theme-primary))" }}
        >
          <span className="flex-1">
            {title}
            {description && <span className="block text-xs font-normal" style={muted}>{description}</span>}
          </span>
          <ChevronDown size={16} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      </h2>
      <div id={`${id}-panel`} role="region" aria-label={title} hidden={!open} className="space-y-4 px-4 pb-4">
        {children}
      </div>
    </section>
  )
}

export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-semibold" style={muted}>{title}</legend>
      {children}
    </fieldset>
  )
}

/** #rrggbb for the native picker (alpha dropped). */
function toHex(value: string): string {
  const c = parseColor(value)
  if (!c) return "#000000"
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0")
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

/** Picker output, keeping the original alpha when the colour was translucent. */
function fromPicker(hex: string, previous: string): string {
  const before = parseColor(previous)
  if (!before || before.a >= 1) return hex.toUpperCase()
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${Number(before.a.toFixed(3))})`
}

export function ContrastBadge({ check }: { check: ContrastCheck }) {
  if (check.ratio === null) return null
  const tone = check.ok ? "--theme-success" : check.level === "block" ? "--theme-danger" : "--theme-warning"
  const word = check.ok ? (check.required >= 4.5 ? "AA" : "OK") : check.level === "block" ? "Too low" : "Low"
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
      style={{ color: `var(${tone})`, backgroundColor: `color-mix(in srgb, var(${tone}) 12%, transparent)` }}
      title={`${check.pair.replace("/", " on ")}: ${check.ratio}:1 (needs ${check.required}:1${check.level === "block" ? ", required to save" : ""})`}
    >
      {check.ratio}:1 {word}
    </span>
  )
}

/**
 * Colour swatch picker + text input. The text accepts every notation the
 * theme allows (hex, rgb(a), hsl(a)); it is only committed once valid.
 */
export function ColorField({ label, value, onChange, optional, placeholder, checks = [] }: {
  label: string
  value: string | undefined
  onChange: (value: string | undefined) => void
  /** Optional colours can be cleared (the derived default applies). */
  optional?: boolean
  placeholder?: string
  checks?: ContrastCheck[]
}) {
  const id = useId()
  const [text, setText] = useState(value ?? "")
  // Follow outside changes (undo, templates) without an effect.
  const [synced, setSynced] = useState(value)
  if (value !== synced) { setSynced(value); setText(value ?? "") }
  const invalid = text.trim() !== "" && !isValidColor(text.trim())

  const commit = (next: string) => {
    setText(next)
    const v = next.trim()
    if (v === "" && optional) onChange(undefined)
    else if (isValidColor(v)) onChange(v)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={`${label} colour picker`}
        value={toHex(value ?? placeholder ?? "#000000")}
        onChange={(e) => commit(fromPicker(e.target.value, value ?? ""))}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border p-0.5"
        style={fieldBorder}
      />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-xs">{label}{optional && <span style={muted}> (optional)</span>}</label>
      {checks.map((check) => <ContrastBadge key={check.pair} check={check} />)}
      <input
        id={id}
        type="text"
        spellCheck={false}
        value={text}
        placeholder={optional ? (placeholder ? `auto (${placeholder})` : "auto") : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-err` : undefined}
        onChange={(e) => commit(e.target.value)}
        className="h-8 w-36 shrink-0 rounded-lg border px-2 font-mono text-xs"
        style={{ ...fieldBorder, ...(invalid ? { borderColor: "var(--theme-danger)" } : {}) }}
      />
      {invalid && <span id={`${id}-err`} className="sr-only">Not a valid colour</span>}
    </div>
  )
}

export function RangeField({ label, value, min, max, step = 1, unit = "px", onChange, format }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
  format?: (value: number) => string
}) {
  const id = useId()
  const shown = format ? format(value) : `${value}${unit}`
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-36 shrink-0 text-xs">{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: "var(--theme-primary)" }}
      />
      <output htmlFor={id} className="w-14 shrink-0 text-right text-xs tabular-nums" style={muted}>{shown}</output>
    </div>
  )
}

export function SelectField<T extends string | number>({ label, value, options, onChange, hint }: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-36 shrink-0 text-xs">{label}</label>
      <select
        id={id}
        value={String(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const raw = e.target.value
          const match = options.find((o) => String(o.value) === raw)
          if (match) onChange(match.value)
        }}
        className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-xs"
        style={fieldBorder}
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
      {hint && <span id={`${id}-hint`} className="sr-only">{hint}</span>}
    </div>
  )
}

export function TextField({ label, value, onChange, maxLength, placeholder, validate }: {
  label: string
  value: string
  onChange: (value: string) => void
  maxLength?: number
  placeholder?: string
  /** Error message for an invalid value (not committed), or null. */
  validate?: (value: string) => string | null
}) {
  const id = useId()
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) { setSynced(value); setText(value) }
  const error = validate ? validate(text) : null
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <label htmlFor={id} className="w-36 shrink-0 text-xs">{label}</label>
        <input
          id={id}
          type="text"
          value={text}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => {
            setText(e.target.value)
            if (!validate || !validate(e.target.value)) onChange(e.target.value)
          }}
          className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-xs"
          style={{ ...fieldBorder, ...(error ? { borderColor: "var(--theme-danger)" } : {}) }}
        />
      </div>
      {error && <p id={`${id}-err`} className="pl-[9.75rem] text-[11px]" style={{ color: "var(--theme-danger)" }}>{error}</p>}
    </div>
  )
}

export function ToggleField({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (value: boolean) => void; description?: string }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--theme-primary)" }} />
      <label htmlFor={id} className="text-xs">
        {label}
        {description && <span className="block" style={muted}>{description}</span>}
      </label>
    </div>
  )
}

/** Segmented single choice (radio group). */
export function SegmentedField<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const name = useId()
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="float-left w-36 shrink-0 text-xs">{label}</legend>
      <div className="flex flex-1 flex-wrap gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--theme-surface-border)" }}>
        {options.map((o) => {
          const active = o.value === value
          return (
            <label
              key={o.value}
              className="flex-1 cursor-pointer px-2 py-1 text-center text-xs font-medium has-[:focus-visible]:ring-2"
              style={{
                // Options, not form labels: keep them out of the theme's uppercase-labels rule.
                textTransform: "none",
                letterSpacing: "normal",
                borderRadius: "calc(var(--theme-input-radius) - 2px)",
                backgroundColor: active ? "var(--theme-primary-light)" : "transparent",
                color: active ? "var(--theme-primary-text)" : "var(--theme-card-text)",
                ["--tw-ring-color" as string]: "var(--theme-focus-ring, var(--theme-primary))",
              }}
            >
              <input type="radio" name={name} value={o.value} checked={active} onChange={() => onChange(o.value)} className="sr-only" />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
