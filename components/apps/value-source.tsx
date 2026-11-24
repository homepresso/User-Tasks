"use client"

import { createContext, useContext, type ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import type { PageFilter } from "@/lib/apps/schema"
import type { ParamMap, ValueSource } from "@/lib/apps/params"
import { SYSTEM_PATHS, type ParamDecl, type VariableDecl } from "@/lib/apps/variables"

/**
 * The builder's view of the app's and the page's parameters and variables
 * (draft), so every value picker — form parameter mapping, widget inputs,
 * rule actions — can offer them, plus the system variables.
 */
export interface AppDecls { params: readonly ParamDecl[]; variables: readonly VariableDecl[] }
const DeclsContext = createContext<AppDecls>({ params: [], variables: [] })
export const useAppDecls = () => useContext(DeclsContext)
export function AppDeclsProvider({ value, children }: { value: AppDecls; children: ReactNode }) {
  return <DeclsContext.Provider value={value}>{children}</DeclsContext.Provider>
}

/** Placeholders for template inputs ({x} pickers): params, variables, system variables, filters, event payload. */
export function scopePlaceholders(decls: AppDecls, filters: readonly PageFilter[] = [], event: string[] = []): Array<{ name: string; group: string; label?: string }> {
  return [
    ...event.map((p) => ({ name: p, group: "This event" })),
    { name: "result", group: "Previous action", label: "Its result" },
    ...decls.params.map((p) => ({ name: `param.${p.name}`, group: "Parameters", label: p.label || p.name })),
    ...decls.variables.map((v) => ({ name: `var.${v.name}`, group: "Variables", label: v.label || v.name })),
    ...filters.map((f) => ({ name: `filter.${f.id}`, group: "Page filters", label: f.label })),
    ...SYSTEM_PATHS.filter((s) => !s.path.includes("<")).map((s) => ({ name: s.path, group: "System", label: s.label })),
  ]
}

const SYSTEM_OPTIONS: Array<{ value: string; label: string }> = [
  ["user_id", "Viewer: id"], ["user_name", "Viewer: name"], ["user_email", "Viewer: email"], ["team_id", "Viewer: first team"], ["user_teams", "Viewer: teams"], ["user_roles", "Viewer: roles"],
  ["user_manager", "Viewer: manager"], ["user_timezone", "Viewer: timezone"], ["today", "Today"], ["now", "Now"], ["start_of_week", "Start of week"], ["start_of_month", "Start of month"],
  ["end_of_month", "End of month"], ["workspace_id", "Workspace id"], ["workspace_name", "Workspace name"], ["app", "This app (slug)"], ["app_id", "This app (id)"], ["page", "This page (slug)"],
  ["page_id", "This page (id)"], ["is_mobile", "Is mobile"], ["app_role", "Viewer’s app role"], ["url_param", "URL parameter"],
].map(([k, l]) => ({ value: `system:${k}`, label: l }))

export function encodeSource(s: ValueSource | undefined): string {
  if (!s) return ""
  switch (s.from) {
    case "static": return "static"
    case "filter": return `filter:${s.filter}`
    case "system": return `system:${s.key}`
    case "event": return `event:${s.key}`
    case "variable": return `variable:${s.name}`
    case "param": return `param:${s.name}`
    case "expression": return "expression"
  }
}

/** One value source picker (a fixed value, a filter, a parameter, a variable, a system variable, the clicked row / card, or an expression). */
export function ValueSourceEditor({ value, onChange, filters = [], eventKeys = [], label, emptyLabel = "Not passed", fallbackName = "value" }: {
  value: ValueSource | undefined
  onChange: (v: ValueSource | undefined) => void
  filters?: readonly PageFilter[]
  eventKeys?: string[]
  label: string
  emptyLabel?: string
  fallbackName?: string
}) {
  const decls = useAppDecls()
  const set = (raw: string) => {
    if (!raw) return onChange(undefined)
    if (raw === "static") return onChange({ from: "static", value: value?.from === "static" ? value.value : "" })
    if (raw === "expression") return onChange({ from: "expression", expr: value?.from === "expression" ? value.expr : "" })
    const [kind, ...rest] = raw.split(":")
    const key = rest.join(":")
    if (kind === "filter") return onChange({ from: "filter", filter: key })
    if (kind === "event") return onChange({ from: "event", key })
    if (kind === "variable") return onChange({ from: "variable", name: key || fallbackName })
    if (kind === "param") return onChange({ from: "param", name: key || fallbackName })
    if (kind === "system") return onChange({ from: "system", key: key as never, ...(key === "url_param" ? { param: fallbackName } : {}) })
  }
  return (
    <div className="space-y-1" data-value-source>
      <Select size="sm" aria-label={label} value={encodeSource(value)} onChange={(e) => set(e.target.value)}
        options={[
          { value: "", label: emptyLabel }, { value: "static", label: "Fixed value" }, { value: "expression", label: "Expression / template…" },
          ...decls.params.map((p) => ({ value: `param:${p.name}`, label: `Parameter: ${p.label || p.name}` })),
          ...decls.variables.map((v) => ({ value: `variable:${v.name}`, label: `Variable: ${v.label || v.name}` })),
          ...filters.map((f) => ({ value: `filter:${f.id}`, label: `Filter: ${f.label}` })),
          ...eventKeys.map((k) => ({ value: `event:${k}`, label: `Clicked row / card: ${k}` })),
          ...SYSTEM_OPTIONS,
        ]} />
      {value?.from === "static" && <Input size="sm" aria-label={`${label}: fixed value`} value={value.value} onChange={(e) => onChange({ from: "static", value: e.target.value })} />}
      {value?.from === "expression" && <Input size="sm" aria-label={`${label}: expression`} value={value.expr} placeholder="{{var.rowId}} or {{= var.qty * 2 }}" onChange={(e) => onChange({ from: "expression", expr: e.target.value })} />}
      {value?.from === "system" && value.key === "url_param" && <Input size="sm" aria-label="URL parameter name" value={value.param ?? ""} onChange={(e) => onChange({ ...value, param: e.target.value })} />}
    </div>
  )
}

/** Parameters to pass to a page: name → value source rows. */
export function ParamRows({ value, onChange, filters }: { value: ParamMap | undefined; onChange: (m: ParamMap) => void; filters: readonly PageFilter[] }) {
  const entries = Object.entries(value ?? {})
  const set = (list: Array<[string, ValueSource | undefined]>) => onChange(Object.fromEntries(list.filter((x): x is [string, ValueSource] => !!x[0] && !!x[1])))
  return (
    <div className="space-y-1">
      {entries.map(([k, src], i) => (
        <div key={i} className="grid grid-cols-[8rem_1fr_auto] items-start gap-1">
          <Input size="sm" aria-label="Parameter name" value={k} onChange={(e) => set(entries.map((x, j) => (j === i ? [e.target.value.replace(/[^A-Za-z0-9_]/g, ""), x[1]] : x)))} />
          <ValueSourceEditor label={`Value for ${k}`} value={src} filters={filters} fallbackName={k} onChange={(nv) => set(entries.map((x, j) => (j === i ? [x[0], nv] : x)))} />
          <IconButton size="sm" label="Remove" icon={<X />} onClick={() => set(entries.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => onChange({ ...(value ?? {}), [`param${entries.length + 1}`]: { from: "static", value: "" } })}><Plus size={11} /> Parameter to pass</button>
    </div>
  )
}

