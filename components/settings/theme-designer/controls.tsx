"use client"

import { useId, useState } from "react"
import { ChevronDown } from "lucide-react"
import { isValidColor, parseColor } from "@/lib/theme/colors"
import type { ContrastCheck } from "@/lib/theme/contrast"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input, controlClass } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/*
 * Small form controls for the theme designer. Every control has a visible
 * label tied to its input; colours, contrast and validity are also given as
 * text, never by colour alone. The designer pane is dense, so labels sit in
 * a 144px column beside the control (the Field anatomy, side by side).
 */

const LABEL = "w-36 shrink-0 text-ui text-fg"

/** Collapsible designer section (a disclosure button + region). */
export function DesignerSection({ title, description, defaultOpen = false, children }: { title: string; description?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="border-b border-border-subtle last:border-b-0">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle"
        >
          <span className="flex-1">
            <span className="block text-sm font-semibold text-fg">{title}</span>
            {description && <span className="block text-xs font-normal text-fg-muted">{description}</span>}
          </span>
          <ChevronDown aria-hidden className={cn("size-4 text-fg-muted transition-transform duration-[var(--ds-dur-fast)]", open && "rotate-180")} />
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
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1.5 text-xs font-medium text-fg-muted">{title}</legend>
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
  const tone = check.ok ? "success" : check.level === "block" ? "danger" : "warning"
  const word = check.ok ? (check.required >= 4.5 ? "AA" : "OK") : check.level === "block" ? "Too low" : "Low"
  const detail = `${check.pair.replace("/", " on ")}: ${check.ratio}:1 (needs ${check.required}:1${check.level === "block" ? ", required to save" : ""})`
  return (
    <Tooltip content={detail}>
      <Badge tone={tone} className="num shrink-0" tabIndex={0} aria-label={detail}>
        {check.ratio}:1 {word}
      </Badge>
    </Tooltip>
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
        className={cn(controlClass, "h-[var(--ds-control-h-sm)] w-[var(--ds-control-h-sm)] shrink-0 cursor-pointer p-0.5")}
      />
      <label htmlFor={id} className="min-w-0 flex-1 truncate text-ui text-fg">{label}{optional && <span className="text-fg-muted"> (optional)</span>}</label>
      {checks.map((check) => <ContrastBadge key={check.pair} check={check} />)}
      <Input
        id={id}
        size="sm"
        type="text"
        spellCheck={false}
        value={text}
        placeholder={optional ? (placeholder ? `auto (${placeholder})` : "auto") : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-err` : undefined}
        onChange={(e) => commit(e.target.value)}
        className="w-36 shrink-0 font-mono text-xs"
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
      <label htmlFor={id} className={LABEL}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--theme-primary)]"
      />
      <output htmlFor={id} className="num w-14 shrink-0 text-right text-xs text-fg-muted">{shown}</output>
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
      <label htmlFor={id} className={LABEL}>{label}</label>
      <Select
        id={id}
        size="sm"
        value={String(value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const raw = e.target.value
          const match = options.find((o) => String(o.value) === raw)
          if (match) onChange(match.value)
        }}
        wrapperClassName="min-w-0 flex-1"
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </Select>
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
        <label htmlFor={id} className={LABEL}>{label}</label>
        <div className="min-w-0 flex-1">
          <Input
            id={id}
            size="sm"
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
          />
        </div>
      </div>
      {error && <p id={`${id}-err`} className="pl-[9.75rem] text-xs text-danger">{error}</p>}
    </div>
  )
}

export function ToggleField({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (value: boolean) => void; description?: string }) {
  return <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} label={label} description={description} className="flex" />
}

/** Segmented single choice (the SegmentedControl primitive, a radio group). */
export function SegmentedField<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className={LABEL} aria-hidden>{label}</span>
      {/* Phones: the control goes under its label (three labels don't fit beside it). */}
      <SegmentedControl<T>
        aria-label={label}
        value={value}
        onValueChange={onChange}
        size="sm"
        className="min-w-0 flex-1 max-sm:basis-full [&>*]:flex-1"
        options={options.map((o) => ({ value: o.value, text: o.label }))}
      />
    </div>
  )
}
