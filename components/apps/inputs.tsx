"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type { PickerKind } from "@/lib/services/app-search"
import { ObjectPicker, usePickerLabels, type PickerToken } from "./object-picker"
import { X } from "lucide-react"
import { DATE_PRESETS, type DateRangeValue, type FilterKind, type FilterRef, type PageFilter } from "@/lib/apps/schema"
import { DATE_PRESET_LABELS, isFilterRef, type FilterValues } from "@/lib/apps/widgets"
import { useAppDecls } from "./value-source"

/**
 * Inputs shared by the page filter bar and the widget settings: a person,
 * team, form, workflow, data table, date range or status — in the settings
 * also "From page filter: …" for the page's filters of the same kind, which
 * stores { filter: '<id>' } so one filter drives several widgets.
 */

export type InputValue = string | DateRangeValue | FilterRef | null | undefined

const STATUS_LABELS: Record<string, string> = { open: "Open", completed: "Completed", all: "Any status" }

/** Object inputs use the searchable picker; date ranges and statuses stay small selects. */
export const PICKER_KIND_OF: Partial<Record<FilterKind, PickerKind>> = { user: "user", team: "team", form: "form", workflow: "workflow", table: "table" }

function smallOptions(kind: FilterKind, includeAny: boolean): Array<{ value: string; label: string }> {
  if (kind === "status") return (["open", "completed", "all"] as const).map((s) => ({ value: s, label: STATUS_LABELS[s] }))
  return [...(includeAny ? [{ value: "", label: "All time" }] : []), ...DATE_PRESETS.filter((p) => p !== "all").map((p) => ({ value: `preset:${p}`, label: DATE_PRESET_LABELS[p] }))]
}

/** Fixed picker choices: the viewer tokens ("Me", "My teams"). */
export function viewerTokens(kind: FilterKind): PickerToken[] {
  if (kind === "user") return [{ value: "me", label: "Me (whoever is viewing)", hint: "The signed-in viewer" }]
  if (kind === "team") return [{ value: "my_teams", label: "My teams (the viewer’s)", hint: "Every team the viewer is in" }]
  return []
}

export function encodeInput(value: InputValue): string {
  if (value === null || value === undefined) return ""
  if (isFilterRef(value)) return `filter:${value.filter}`
  if (typeof value === "string") return value
  if ("preset" in value) return value.preset === "all" ? "" : `preset:${value.preset}`
  return ""
}

export function decodeInput(raw: string): InputValue {
  if (!raw) return null
  if (raw.startsWith("filter:")) return { filter: raw.slice(7) }
  if (raw.startsWith("preset:")) return { preset: raw.slice(7) as never }
  return raw
}

/** One widget input: a searchable picker (or small select) plus the page's filters of the same kind. */
export function BindableInput({ label, kind, value, onChange, app, filters, includeAny = true, id }: {
  label: string
  kind: FilterKind
  value: InputValue
  onChange: (value: InputValue) => void
  app: string
  filters: readonly PageFilter[]
  includeAny?: boolean
  id?: string
}) {
  const decls = useAppDecls()
  // Page filters of the same kind, then parameters, variables and fitting system variables ({ filter: "var.x" } — lib/apps/variables.ts bindings).
  const bound = [
    ...filters.filter((f) => f.kind === kind).map((f) => ({ value: `filter:${f.id}`, label: `From page filter: ${f.label}`, hint: "Follows the filter at the top of the page" })),
    ...decls.params.map((p) => ({ value: `filter:param.${p.name}`, label: `Parameter: ${p.label || p.name}`, hint: "Follows the page / app parameter" })),
    ...decls.variables.map((v) => ({ value: `filter:var.${v.name}`, label: `Variable: ${v.label || v.name}`, hint: "Follows the variable (rules and widgets set it)" })),
    ...(kind === "user" ? [{ value: "filter:sys.user.manager.id", label: "System: the viewer’s manager", hint: "Read-only" }] : []),
    ...(kind === "text" ? [{ value: "filter:sys.user.email", label: "System: viewer’s email", hint: "Read-only" }, { value: "filter:sys.today", label: "System: today", hint: "Read-only" }] : []),
  ]
  const current = encodeInput(value)
  const picker = PICKER_KIND_OF[kind]
  return (
    <div className="block space-y-1" data-bindable-input={kind}>
      <label className="text-ui font-medium text-fg" htmlFor={id}>{label}</label>
      {picker ? (
        <ObjectPicker app={app} kind={picker} id={id} label={label} value={current || null} tokens={[...viewerTokens(kind), ...bound]}
          clearLabel={includeAny ? "Any" : undefined} placeholder={`Search ${label.toLowerCase()}…`} onChange={(v) => onChange(decodeInput(v ?? ""))} />
      ) : kind === "text" ? (
        <div className="flex gap-1">
          <Select size="sm" aria-label={`${label}: source`} value={current.startsWith("filter:") ? current : ""} onChange={(e) => onChange(e.target.value ? decodeInput(e.target.value) : null)} options={[{ value: "", label: "Fixed text" }, ...bound]} className="w-36" />
          {!current.startsWith("filter:") && <Input id={id} size="sm" value={current} maxLength={200} placeholder="Text" onChange={(e) => onChange(e.target.value || null)} />}
        </div>
      ) : (
        <Select id={id} size="sm" value={current} onChange={(e) => onChange(decodeInput(e.target.value))} options={[...smallOptions(kind, includeAny), ...bound]} />
      )}
    </div>
  )
}

/** A filter value in its URL / select form ("" = any). */
function rawValue(v: FilterValues[string]): string {
  return typeof v === "string" ? v : v && "preset" in v ? (v.preset === "all" ? "" : `preset:${v.preset}`) : v && ("from" in v || "to" in v) ? `${v.from ?? ""}..${v.to ?? ""}` : ""
}

/**
 * The page filter bar: one compact control per filter (values in the URL,
 * ?f.<id>=…; pickers list what the viewer may see), aligned with the grid,
 * then a chip for each filter changed from its default (× resets it) and
 * "Reset filters".
 */
export function FilterBar({ filters, values, onChange, app, defaults }: {
  filters: readonly PageFilter[]
  values: FilterValues
  onChange: (id: string, value: FilterValues[string]) => void
  app: string
  /** The filters' defaults (enables the changed-filter chips and Reset). */
  defaults?: readonly PageFilter[]
}) {
  if (!filters.length) return null
  const changed = defaults ? filters.filter((f) => rawValue(values[f.id]) !== rawValue(f.default ?? null)) : []
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2" role="group" aria-label="Page filters" data-app-filters>
      {filters.map((f) => {
        const raw = rawValue(values[f.id])
        const picker = PICKER_KIND_OF[f.kind]
        return (
          <div key={f.id} className="w-48 min-w-0 space-y-1 max-sm:w-full" data-app-filter={f.id}>
            <span className="block text-xs font-medium text-fg-muted">{f.label}</span>
            {picker ? (
              <ObjectPicker app={app} kind={picker} mode="filter" label={f.label} value={raw || null} tokens={viewerTokens(f.kind)} clearLabel="Any"
                onChange={(next) => onChange(f.id, next || null)} />
            ) : f.kind === "text" && f.options?.length ? (
              <Select size="sm" value={raw} aria-label={f.label} options={[{ value: "", label: "Any" }, ...(raw && !f.options.includes(raw) ? [raw] : []), ...f.options].map((o) => (typeof o === "string" ? { value: o, label: o } : o))}
                onChange={(e) => onChange(f.id, e.target.value || null)} />
            ) : f.kind === "text" ? (
              <TextFilter value={raw} label={f.label} onChange={(v) => onChange(f.id, v || null)} />
            ) : (
              <Select size="sm" value={raw} aria-label={f.label} options={smallOptions(f.kind, f.kind !== "status")}
                onChange={(e) => {
                  const next = e.target.value
                  onChange(f.id, !next ? null : next.startsWith("preset:") ? { preset: next.slice(7) as never } : next)
                }} />
            )}
          </div>
        )
      })}
      {changed.length > 0 && (
        <div className="flex min-h-8 flex-wrap items-center gap-1.5" data-app-filter-chips>
          {changed.map((f) => <FilterChip key={f.id} app={app} filter={f} value={values[f.id]} onReset={() => onChange(f.id, f.default ?? null)} />)}
          {changed.length > 1 && (
            <button type="button" className="h-7 rounded-md px-1.5 text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
              onClick={() => { for (const f of changed) onChange(f.id, f.default ?? null) }} data-app-filters-reset>Reset filters</button>
          )}
        </div>
      )}
    </div>
  )
}

/** One changed filter as a chip: "Team: Facilities ×" (× puts its default back). */
function FilterChip({ app, filter, value, onReset }: { app: string; filter: PageFilter; value: FilterValues[string]; onReset: () => void }) {
  const raw = rawValue(value)
  const picker = PICKER_KIND_OF[filter.kind]
  const tokens = viewerTokens(filter.kind)
  const labels = usePickerLabels(app, picker ?? "user", picker && raw && !tokens.some((t) => t.value === raw) ? [raw] : [], { mode: "filter" })
  const text = !raw ? "Any"
    : tokens.find((t) => t.value === raw)?.label.replace(/ \(.*\)$/, "")
      ?? (picker ? labels.data?.items?.find((i) => i.id === raw)?.name ?? "…" : raw.startsWith("preset:") ? DATE_PRESET_LABELS[raw.slice(7) as keyof typeof DATE_PRESET_LABELS] ?? raw : STATUS_LABELS[raw] ?? raw.replace("..", " – "))
  return (
    <span className="inline-flex h-7 max-w-64 items-center gap-1 rounded-full border border-border bg-subtle pl-2.5 pr-1 text-xs text-fg" data-app-filter-chip={filter.id}>
      <span className="truncate"><span className="text-fg-muted">{filter.label}:</span> {text}</span>
      <button type="button" onClick={onReset} aria-label={`Reset ${filter.label}`} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-panel hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )
}

/** A text filter: applied as you type (debounced). */
function TextFilter({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => onChange(text), 350)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  return <Input size="sm" value={text} maxLength={200} aria-label={label} placeholder="Any" onChange={(e) => setText(e.target.value)} />
}
