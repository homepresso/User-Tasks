"use client"

import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  BADGE_SOURCES, BUTTON_ACTION_KINDS, CARD_FIELD_FORMATS, BUTTON_COLORS, BUTTON_VARIANTS, CHART_KINDS, OPEN_MODES, ROW_CONDITION_OPS, WIDGET_CONFIG_SCHEMAS,
  type ActionButton, type ColumnFormat, type RowCondition, type AppWidget, type ButtonAction, type CardAction, type ClickTarget, type OpenMode, type PageFilter, type WidgetConfig,
} from "@/lib/apps/schema"
import { autoTitle, catalogEntry, fitsContent, isBleed, needsTitle } from "@/lib/apps/widgets"
import { INSTANCE_DATASETS, INSTANCE_FACT_DATASETS, INSTANCE_FACT_FIELDS, INSTANCE_FACT_LABELS, INSTANCE_DATASET_COLUMNS } from "@/lib/instance-admin/schema"
import type { PickerKind } from "@/lib/services/app-search"
import { useQuery } from "@tanstack/react-query"
import { serverQuery } from "@/lib/server-read"
import { unmappedRequired, type ParamMap, type ValueSource } from "@/lib/apps/params"
import { APP_ICON_NAMES } from "./app-icon"
import { BindableInput, type InputValue } from "./inputs"
import { MenuItemsEditor } from "./menu-editor"
import { ObjectPicker } from "./object-picker"
import { ParamRows, ValueSourceEditor } from "./value-source"
import { ColorField } from "./style-editor"
import { IconPicker } from "./icon-picker"

const CARD_FIELD_FORMAT_LABELS: Record<(typeof CARD_FIELD_FORMATS)[number], string> = { text: "As is", number: "Number", currency: "Currency", percent: "Percent", date: "Date", progress: "Progress bar" }

/**
 * The builder's widget settings panel: one form per widget type, writing a
 * config that matches its schema (lib/apps/schema.ts). Every object or
 * person input is a searchable picker (components/apps/object-picker.tsx,
 * server-side search, only what the designer can see); inputs that take a
 * person, team, form, workflow, table, date range, status or text can bind
 * to a page filter. Click-through (set a filter / open a page), chromeless
 * ("bleed") display and container children are set here too.
 */

interface Props {
  app: string
  widget: AppWidget
  onChange: (widget: AppWidget) => void
  filters: readonly PageFilter[]
  pages: Array<{ slug: string; title: string }>
  /** Other widgets of the page (containers choose their children). */
  widgets: readonly AppWidget[]
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-1"><span className="text-ui font-medium text-fg">{label}</span>{children}{hint && <span className="block text-2xs text-fg-muted">{hint}</span>}</label>
}

export function Num({ label, value, min, max, onChange, step = 1 }: { label: string; value: number | null | undefined; min: number; max: number; onChange: (n: number) => void; step?: number }) {
  return (
    <Row label={label}>
      <Input type="number" size="sm" value={value ?? ""} min={min} max={max} step={step}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, step === 1 ? Math.round(n) : n))) }} />
    </Row>
  )
}

export const opts = (pairs: Array<[string, string]>) => pairs.map(([value, label]) => ({ value, label }))
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

/** A literal object picker field. */
function Pick({ app, label: l, kind, value, onChange, table, clear, multiple }: { app: string; label: string; kind: PickerKind; value: unknown; onChange: (v: string | null) => void; table?: string | null; clear?: string; multiple?: false }) {
  void multiple
  return <div className="space-y-1"><span className="text-ui font-medium text-fg">{l}</span><ObjectPicker app={app} kind={kind} label={l} table={table} value={typeof value === "string" ? value : null} clearLabel={clear} onChange={(v) => onChange(v)} placeholder={`Search ${l.toLowerCase()}…`} /></div>
}

function Columns({ app, label: l, table, value, onChange, max = 30 }: { app: string; label: string; table: unknown; value: string[]; onChange: (v: string[]) => void; max?: number }) {
  if (typeof table !== "string") return null
  return <div className="space-y-1"><span className="text-ui font-medium text-fg">{l}</span><ObjectPicker app={app} kind="column" table={table} multiple value={value} max={max} onChange={onChange} placeholder="All / default columns" label={l} /></div>
}

/** Column formats of a data grid / record card: column key · format (· currency / full at), as card view fields. */
function ColumnFormatsEditor({ value, onChange }: { value: Record<string, ColumnFormat> | null | undefined; onChange: (v: Record<string, ColumnFormat> | null) => void }) {
  const rows = Object.entries(value ?? {})
  const write = (next: Array<[string, ColumnFormat]>) => onChange(next.length ? Object.fromEntries(next) : null)
  const edit = (i: number, patch: Partial<ColumnFormat>, key?: string) => write(rows.map(([k, f], j) => (j === i ? [key ?? k, { ...f, ...patch }] : [k, f])))
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-fg">Column formats</span>
      <p className="text-2xs text-fg-muted">Show a column as a number, money, a percentage, a date or a progress bar (editing keeps the raw value).</p>
      {rows.map(([k, f], i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-1">
          <Input size="sm" aria-label="Column" value={k} placeholder="column key" onChange={(e) => edit(i, {}, e.target.value)} />
          <Select size="sm" aria-label="Format" value={f.format ?? "text"} className="w-28" onChange={(e) => edit(i, { format: e.target.value as (typeof CARD_FIELD_FORMATS)[number] })}
            options={CARD_FIELD_FORMATS.map((v) => ({ value: v, label: CARD_FIELD_FORMAT_LABELS[v] }))} />
          <IconButton size="sm" label="Remove format" icon={<Trash2 />} onClick={() => write(rows.filter((_, j) => j !== i))} />
          {f.format === "currency" && <Input size="sm" aria-label="Currency" className="col-span-2" value={f.currency ?? ""} placeholder="Currency (default: the column’s, else USD)" maxLength={3}
            onChange={(e) => { const v = e.target.value.toUpperCase(); edit(i, { currency: /^[A-Z]{3}$/.test(v) ? v : undefined }) }} />}
          {f.format === "progress" && <Input size="sm" type="number" aria-label="Full at" className="col-span-2" value={f.max ?? ""} placeholder="Full at (default 100)"
            onChange={(e) => { const n = Number(e.target.value); edit(i, { max: n > 0 ? n : undefined }) }} />}
        </div>
      ))}
      <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={rows.length >= 30 || rows.some(([k]) => !k)} onClick={() => onChange({ ...(value ?? {}), "": { format: "number" } })}>Add a format</Button>
    </div>
  )
}

/** Row conditions of a data-table widget (`where`): column · comparison · fixed text or a page filter / parameter / variable / system value. */
const MAX_ROW_CONDITIONS = 10
function RowConditionsEditor({ app, table, value, filters, onChange }: { app: string; table: string; value: RowCondition[]; filters: readonly PageFilter[]; onChange: (v: RowCondition[]) => void }) {
  const OPS: Record<(typeof ROW_CONDITION_OPS)[number], string> = { equals: "equals", not_equals: "is not", contains: "contains", starts_with: "starts with", gt: "greater than", gte: "at least", lt: "less than", lte: "at most", is_empty: "is empty", not_empty: "is not empty" }
  const patch = (i: number, p: Partial<RowCondition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...p } : c)))
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-row-conditions>
      <legend className="px-1 text-xs font-medium text-fg">Only rows where</legend>
      {value.map((c, i) => (
        <div key={i} className="space-y-1 rounded-md bg-subtle p-1.5" data-row-condition={i}>
          <div className="flex items-end gap-1">
            <div className="min-w-0 flex-1"><Pick app={app} label="Column" kind="column" table={table} value={c.column} onChange={(v) => { if (v) patch(i, { column: v }) }} /></div>
            <Select size="sm" aria-label="Comparison" value={c.op} onChange={(e) => patch(i, { op: e.target.value as RowCondition["op"] })} options={ROW_CONDITION_OPS.map((o) => ({ value: o, label: OPS[o] }))} className="w-28" />
            <IconButton size="sm" label="Remove condition" icon={<Trash2 />} onClick={() => onChange(value.filter((_, j) => j !== i))} />
          </div>
          {c.op !== "is_empty" && c.op !== "not_empty" && <BindableInput label="Value" kind="text" value={(typeof c.value === "number" || typeof c.value === "boolean" ? String(c.value) : c.value) as InputValue} onChange={(v) => patch(i, { value: (v ?? null) as RowCondition["value"] })} app={app} filters={filters} />}
        </div>
      ))}
      {value.length < MAX_ROW_CONDITIONS && (
        // A condition starts from its column (a condition without one isn't valid).
        <Pick app={app} label="Add a condition on" kind="column" table={table} value={null} onChange={(v) => { if (v) onChange([...value, { column: v, op: "equals", value: null }]) }} />
      )}
      <p className="text-2xs text-fg-muted">A condition whose value is empty (its filter set to Any) is skipped.</p>
    </fieldset>
  )
}

function ClickEditor({ value, onChange, filters, pages, kinds, note }: { value: ClickTarget; onChange: (v: ClickTarget) => void; filters: readonly PageFilter[]; pages: Array<{ slug: string; title: string }>; kinds?: PageFilter["kind"][]; note?: string }) {
  const usable = kinds ? filters.filter((f) => kinds.includes(f.kind)) : filters
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-click-editor>
      <legend className="px-1 text-xs font-medium text-fg">Click-through</legend>
      <Select size="sm" aria-label="Clicking sets this page filter" value={value?.filter ?? ""} onChange={(e) => onChange({ ...value, filter: e.target.value || null })}
        options={[{ value: "", label: "Clicking does nothing" }, ...usable.map((f) => ({ value: f.id, label: `Set filter: ${f.label}` }))]} />
      {value?.filter && (
        <Select size="sm" aria-label="On" value={value.page ?? ""} onChange={(e) => onChange({ ...value, page: e.target.value || null })}
          options={[{ value: "", label: "On this page" }, ...pages.map((p) => ({ value: p.slug, label: `Open page: ${p.title}` }))]} />
      )}
      <p className="text-2xs text-fg-muted">{note ?? "Clicking a segment, row or group sets the filter (click again to clear), or opens the page with it set."}{!usable.length ? " Add a page filter first." : ""}</p>
    </fieldset>
  )
}

export function WidgetSettings({ app, widget, onChange, filters, pages, widgets }: Props) {
  const config = widget.config as Record<string, unknown>
  const set = (patch: Record<string, unknown>) => onChange({ ...widget, config: { ...config, ...patch } as WidgetConfig })
  const bind = (key: string, l: string, kind: Parameters<typeof BindableInput>[0]["kind"], includeAny = true) => (
    <BindableInput key={key} label={l} kind={kind} value={config[key] as InputValue} onChange={(v) => set({ [key]: v ?? null })} app={app} filters={filters} includeAny={includeAny} />
  )
  const pick = (key: string, l: string, kind: PickerKind, extra: { table?: string | null; clear?: string } = {}) => <Pick key={key} app={app} label={l} kind={kind} value={config[key]} onChange={(v) => set({ [key]: v })} {...extra} />
  const sel = (key: string, l: string, choices: readonly string[] | Array<[string, string]>) => (
    <Row key={key} label={l}><Select size="sm" value={String(config[key] ?? "")} onChange={(e) => set({ [key]: e.target.value })} options={Array.isArray(choices[0]) ? opts(choices as Array<[string, string]>) : (choices as string[]).map((c) => ({ value: c, label: label(c) }))} /></Row>
  )
  const num = (key: string, l: string, min: number, max: number) => <Num key={key} label={l} value={config[key] as number} min={min} max={max} onChange={(n) => set({ [key]: n })} />
  const sw = (key: string, l: string) => <Switch key={key} checked={!!config[key]} onCheckedChange={(v) => set({ [key]: v })} label={l} />
  const txt = (key: string, l: string, placeholder?: string, max = 400) => <Row key={key} label={l}><Input size="sm" value={String(config[key] ?? "")} maxLength={max} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value || null })} /></Row>
  const click = (kinds?: PageFilter["kind"][], note?: string) => <ClickEditor key="click" value={config.click as ClickTarget} onChange={(v) => set({ click: v })} filters={filters} pages={pages} kinds={kinds} note={note} />
  const taskScope = () => sel("scope", "Show", [["mine", "My tasks (assigned to the viewer)"], ["team", "A team’s tasks"], ["all", "All tasks the viewer can see"]])
  const tableId = typeof config.table_id === "string" ? config.table_id : null
  const entry = catalogEntry(widget.type)
  /** The built-in "UserTasks instance" source (instance admins only): fact dataset, value, workspace. */
  const instanceFactFields = (valueKey: "field" | "value_field" = "field") => {
    const ds = (config.dataset as keyof typeof INSTANCE_FACT_FIELDS | null) ?? null
    const fields = ds ? INSTANCE_FACT_FIELDS[ds] : []
    return (
      <>
        <p className="text-2xs text-fg-muted">Operational data of every workspace. Only UserTasks instance admins see it; others see an access message.</p>
        {sel("dataset", "Dataset", [["", "Choose…"], ...INSTANCE_FACT_DATASETS.map((d) => [d, INSTANCE_FACT_LABELS[d]] as [string, string])])}
        {"aggregate" in config && sel("aggregate", "Value", [["count", "Count"], ["sum", "Sum of a field"], ["avg", "Average of a field"]])}
        {config.aggregate !== "count" && fields.length > 0 && sel(valueKey, "Of field", [["", "Choose…"], ...fields.map((f) => [f, label(f)] as [string, string])])}
        {bind("instance_workspace", "One workspace (an id or a filter; empty: all)", "text")}
      </>
    )
  }
  const instanceListFields = () => (
    <>
      <p className="text-2xs text-fg-muted">Operational data of every workspace (read-only). Only UserTasks instance admins see it; others see an access message.</p>
      {sel("instance_dataset", "Dataset", [["", "Choose…"], ...INSTANCE_DATASETS.map((d) => [d, label(d)] as [string, string])])}
      {(["workspace_id", "user_id", "status", "q", "days"] as const).map((k) => (
        <Row key={k} label={`Parameter: ${k} (literal or {{filter:<id>}})`}>
          <Input size="sm" value={String(((config.instance_params as Record<string, unknown> | null) ?? {})[k] ?? "")} maxLength={200}
            onChange={(e) => { const next = { ...((config.instance_params as Record<string, unknown> | null) ?? {}) }; if (e.target.value) next[k] = e.target.value; else delete next[k]; set({ instance_params: next }) }} />
        </Row>
      ))}
      {typeof config.instance_dataset === "string" && config.instance_dataset && (
        <p className="text-2xs text-fg-muted">Columns: {(INSTANCE_DATASET_COLUMNS[config.instance_dataset as keyof typeof INSTANCE_DATASET_COLUMNS] ?? []).map((c) => c.key).join(", ")}</p>
      )}
    </>
  )

  const sourceFields = (allowTable = true) => {
    const s = config.source
    return (
      <>
        {sel("source", "Data", allowTable ? [["tasks", "Tasks"], ["runs", "Workflow runs"], ["submissions", "Form submissions"], ["table_rows", "Data table rows"], ["instance", "UserTasks instance (admins)"]] : [["tasks", "Tasks"], ["runs", "Workflow runs"]])}
        {s === "instance" && instanceFactFields(widget.type === "pivot" ? "value_field" : "field")}
        {s === "table_rows" && bind("table_id", "Data table", "table", false)}
        {s === "table_rows" && "aggregate" in config && sel("aggregate", "Value", [["count", "Count of rows"], ["sum", "Sum of a column"], ["avg", "Average of a column"]])}
        {s === "table_rows" && config.aggregate !== "count" && "field" in config && tableId && <Pick app={app} label="Of column" kind="column" table={tableId} value={config.field} onChange={(v) => set({ field: v })} />}
        {s === "tasks" && bind("assignee", "Assignee", "user")}
        {s === "tasks" && bind("team", "Team", "team")}
        {(s === "tasks" || s === "runs") && bind("workflow_id", "Workflow", "workflow")}
        {s === "submissions" && bind("form_id", "Form", "form")}
        {(s === "tasks" || s === "runs") && "status" in config && bind("status", "Status", "status", false)}
        {bind("date_range", "Period", "date_range")}
      </>
    )
  }
  const formatFields = () => (
    <>
      {sel("format", "Format", [["number", "Number"], ["currency", "Currency"], ["percent", "Percent"]])}
      {config.format === "currency" && <Row label="Currency"><Input size="sm" value={String(config.currency ?? "USD")} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></Row>}
    </>
  )

  let body: ReactNode = null
  switch (widget.type) {
    case "actions": body = <ButtonsEditor app={app} config={widget.config as WidgetConfig<"actions">} onChange={(c) => set(c)} pages={pages} filters={filters} />; break
    case "tiles": body = <TilesEditor app={app} config={widget.config as WidgetConfig<"tiles">} onChange={(c) => set(c)} pages={pages} filters={filters} />; break
    case "task_list":
      body = <>
        {sel("scope", "Show", [["mine", "My tasks (assigned to the viewer)"], ["queue", "Queue (waiting for the viewer or their teams)"], ["team", "A team’s tasks"], ["all", "All tasks the viewer can see"]])}
        {bind("team", "Team", "team")}{bind("assignee", "Assignee", "user")}{bind("workflow_id", "Workflow", "workflow")}{bind("status", "Status", "status", false)}{bind("date_range", "Created", "date_range")}
        {num("limit", "Rows", 1, 50)}{sel("open_in", "Open a task", [["drawer", "In the quick-view drawer"], ["page", "On its own page"]])}{sw("show_claim", "Claim button on team tasks")}
      </>
      break
    case "kanban":
      if (config.source === "table") {
        body = <>
          {sel("source", "Cards", [["tasks", "Tasks by status"], ["table", "Data table rows in lanes"]])}
          {bind("table_id", "Data table", "table", false)}{txt("lane_column", "Lane column (its value puts a card in a lane)", "stage", 80)}
          <Row label="Lanes, in order (one per line; empty: the column’s choices)"><Textarea rows={4} value={((config.lanes as string[] | undefined) ?? []).join("\n")} onChange={(e) => set({ lanes: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 10) })} /></Row>
          {txt("sum_field", "Total per lane (a number column)", "amount", 80)}{sel("sum_format", "Total format", ["number", "currency"])}
          {num("per_column", "Cards per lane", 1, 50)}{sw("allow_drag", "Drag to change the lane (contributors who may manage rows)")}
          <p className="text-2xs text-fg-muted">Card title, subtitle, badge and fields use the Card view template (edit them in the page JSON or with the app spec).</p>
        </>
        break
      }
      body = <>
        {sel("source", "Cards", [["tasks", "Tasks by status"], ["table", "Data table rows in lanes"]])}
        {taskScope()}{bind("team", "Team", "team")}{bind("assignee", "Assignee", "user")}{bind("workflow_id", "Workflow", "workflow")}{bind("date_range", "Created", "date_range")}
        <fieldset className="space-y-1"><legend className="text-ui font-medium text-fg">Columns</legend>
          {(["todo", "in_progress", "blocked", "completed", "cancelled"] as const).map((s) => {
            const cols = (config.columns as string[]) ?? []
            return <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--theme-primary)]" checked={cols.includes(s)} onChange={(e) => set({ columns: e.target.checked ? [...cols, s] : cols.filter((c) => c !== s) })} />{label(s)}</label>
          })}
        </fieldset>
        {num("per_column", "Cards per column", 1, 50)}{sw("allow_drag", "Drag to change status (contributors who may complete tasks)")}
      </>
      break
    case "task_calendar": body = <>{taskScope()}{bind("team", "Team", "team")}{bind("assignee", "Assignee", "user")}{bind("workflow_id", "Workflow", "workflow")}{bind("status", "Status", "status", false)}{sel("view", "View", ["month", "week"])}</>; break
    case "my_workload": body = <>{num("at_risk_hours", "At risk when due within (hours)", 1, 720)}</>; break
    case "overdue_list": body = <>{taskScope()}{bind("team", "Team", "team")}{bind("assignee", "Assignee", "user")}{bind("workflow_id", "Workflow", "workflow")}{num("limit", "Rows", 1, 50)}{sel("open_in", "Open a task", [["drawer", "In the quick-view drawer"], ["page", "On its own page"]])}</>; break
    case "team_workload": body = <>{bind("team", "Team", "team")}{bind("workflow_id", "Workflow", "workflow")}{num("limit", "People", 1, 50)}{click(["user"], "Clicking a person sets a Person filter.")}</>; break
    case "sla":
      body = <>{sel("source", "Measure", [["tasks", "Open tasks (due dates and run SLAs)"], ["runs", "Running workflows (workflow SLAs)"]])}{config.source === "tasks" && bind("assignee", "Assignee", "user")}{config.source === "tasks" && bind("team", "Team", "team")}{bind("workflow_id", "Workflow", "workflow")}{num("at_risk_hours", "At risk when due within (hours)", 1, 720)}</>
      break
    case "sla_trend": case "cycle_time": case "throughput":
      body = <>{sel("source", "Measure", [["tasks", "Tasks"], ["runs", "Workflow runs"]])}{config.source === "tasks" && bind("assignee", "Assignee", "user")}{config.source === "tasks" && bind("team", "Team", "team")}{bind("workflow_id", "Workflow", "workflow")}{bind("date_range", "Period", "date_range")}{sel("interval", "Interval", ["day", "week", "month"])}</>
      break
    case "sla_breakdown":
      body = <>{sel("source", "Measure", [["tasks", "Open tasks"], ["runs", "Running workflows"]])}{sel("by", "Break down by", config.source === "runs" ? [["workflow", "Workflow"], ["assignee", "Started by"]] : [["workflow", "Workflow"], ["team", "Team"], ["assignee", "Assignee"], ["form", "Form"]])}{bind("workflow_id", "Workflow", "workflow")}{config.source === "tasks" && bind("team", "Team", "team")}{num("at_risk_hours", "At risk when due within (hours)", 1, 720)}{num("limit", "Rows", 1, 30)}{click(config.by === "team" ? ["team"] : config.by === "assignee" ? ["user"] : config.by === "form" ? ["form"] : ["workflow"])}</>
      break
    case "bottleneck": body = <>{bind("workflow_id", "Workflow", "workflow")}{bind("team", "Team", "team")}{num("limit", "Steps", 1, 20)}</>; break
    case "run_status": body = <>{bind("workflow_id", "Workflow", "workflow")}{bind("person", "Started by", "user")}{bind("date_range", "Period", "date_range")}{click(["status"], "Clicking a status sets a Status filter (open / completed / any).")}</>; break
    case "recent_failures": body = <>{bind("workflow_id", "Workflow", "workflow")}{bind("date_range", "Period", "date_range")}{num("limit", "Rows", 1, 50)}</>; break
    case "run_timeline": body = <>{bind("workflow_id", "Workflow", "workflow")}{bind("person", "Started by (default: the viewer)", "user")}</>; break
    case "start_workflow": body = <>{pick("workflow_id", "Workflow", "workflow")}{txt("button_label", "Button label", "Start", 60)}<Row label="Description"><Textarea rows={3} value={String(config.description ?? "")} maxLength={400} onChange={(e) => set({ description: e.target.value || null })} /></Row></>; break
    case "submission_trend": body = <>{bind("form_id", "Form", "form")}{bind("person", "Submitted by", "user")}{bind("date_range", "Period", "date_range")}{sel("interval", "Interval", ["day", "week", "month"])}</>; break
    case "my_submissions": body = <>{bind("form_id", "Form", "form")}{bind("date_range", "Period", "date_range")}{num("limit", "Rows", 1, 50)}</>; break
    case "field_analytics": body = <>{pick("form_id", "Form", "form")}{txt("field", "Field key (empty: every choice field)", "e.g. satisfaction", 80)}{bind("date_range", "Period", "date_range")}</>; break
    case "form_embed": body = <FormEmbedEditor app={app} config={widget.config as WidgetConfig<"form_embed">} onChange={(c) => set(c)} filters={filters} pages={pages} />; break
    case "metric": case "chart": {
      const c = widget.config as WidgetConfig<"chart">
      const isChart = widget.type === "chart"
      body = <>
        {sel("source", "Data", [["tasks", "Tasks"], ["runs", "Workflow runs"], ["submissions", "Form submissions"], ["table_rows", "Data table rows"], ["instance", "UserTasks instance (admins)"]])}
        {c.source === "instance" && instanceFactFields(isChart ? "value_field" : "field")}
        {c.source === "instance" && isChart && sel("field", "Group field (Group by: a column)", [["", "—"], ...((c.dataset ? INSTANCE_FACT_FIELDS[c.dataset] : []) as readonly string[]).map((f) => [f, label(f)] as [string, string])])}
        {c.source === "table_rows" && bind("table_id", "Data table", "table", false)}
        {isChart && <>
          <Row label="Chart"><Select size="sm" value={c.chart} onChange={(e) => set({ chart: e.target.value })} options={CHART_KINDS.map((k) => ({ value: k, label: label(k) }))} /></Row>
          {c.chart !== "scatter" && sel("group_by", "Group by", [["time", "Time"], ...(c.source === "tasks" || c.source === "runs" ? [["status", "Status"], ["workflow", "Workflow"]] as Array<[string, string]> : []), ...(c.source === "submissions" ? [["form", "Form"]] as Array<[string, string]> : []), ...(c.source === "instance" ? [["status", "Status"], ["field", "A field"]] as Array<[string, string]> : c.source !== "table_rows" ? [["assignee", c.source === "tasks" ? "Assignee" : c.source === "runs" ? "Started by" : "Submitted by"]] as Array<[string, string]> : [["field", "A column"]] as Array<[string, string]>)])}
          {(c.chart === "stacked_bar" || c.chart === "combo") && sel("series_by", "Series (stack / bars by)", [["none", "None"], ["status", "Status"], ["workflow", "Workflow"], ["assignee", "Person"], ...(c.source === "submissions" ? [["form", "Form"]] as Array<[string, string]> : []), ...(c.source === "table_rows" ? [["field", "A column"]] as Array<[string, string]> : [])])}
          {c.group_by === "time" && sel("interval", "Interval", ["day", "week", "month"])}
          {(c.group_by === "field" || c.series_by === "field" || c.chart === "scatter") && tableId && <Pick app={app} label={c.chart === "scatter" ? "Label column" : "Column"} kind="column" table={tableId} value={c.field} onChange={(v) => set({ field: v })} />}
          {c.chart === "scatter" && tableId && <><Pick app={app} label="X column" kind="column" table={tableId} value={c.value_field} onChange={(v) => set({ value_field: v })} /><Pick app={app} label="Y column" kind="column" table={tableId} value={c.y_field} onChange={(v) => set({ y_field: v })} /></>}
        </>}
        {c.source === "table_rows" && c.chart !== "scatter" && <>
          {sel("aggregate", "Value", [["count", "Count of rows"], ["sum", "Sum of a column"], ["avg", "Average of a column"]])}
          {c.aggregate !== "count" && tableId && <Pick app={app} label="Of column" kind="column" table={tableId} value={isChart ? c.value_field : (config.field as string)} onChange={(v) => set(isChart ? { value_field: v } : { field: v })} />}
        </>}
        {c.source === "tasks" && bind("assignee", "Assignee", "user")}{c.source === "tasks" && bind("team", "Team", "team")}
        {(c.source === "tasks" || c.source === "runs") && bind("workflow_id", "Workflow", "workflow")}{c.source === "submissions" && bind("form_id", "Form", "form")}
        {(c.source === "tasks" || c.source === "runs") && bind("status", "Status", "status", false)}{bind("date_range", "Period", "date_range")}
        {!isChart && <>{sw("compare_previous", "Compare with the previous period")}{formatFields()}{click(undefined, "Clicking the number sets the filter to the value below (empty clears it), or opens the page.")}{(config.click as ClickTarget)?.filter && txt("click_value", "Value to set", "e.g. open", 200)}</>}
        {isChart && <>{num("max_groups", "Most groups", 2, 24)}{click(c.group_by === "time" ? ["date_range"] : c.group_by === "workflow" ? ["workflow"] : c.group_by === "assignee" ? ["user"] : c.group_by === "form" ? ["form"] : c.group_by === "status" ? ["status"] : ["text"])}</>}
      </>
      break
    }
    case "kpi": body = <>{sourceFields()}{sel("interval", "Sparkline interval", ["day", "week", "month"])}<Num label="Target (optional)" value={config.target as number} min={-1e12} max={1e12} step={0.01} onChange={(n) => set({ target: n })} />{formatFields()}{click()}</>; break
    case "goal": body = <>{sourceFields()}<Num label="Target" value={config.target as number} min={0.01} max={1e12} step={0.01} onChange={(n) => set({ target: n })} />{txt("target_label", "Target label", "e.g. this quarter", 80)}{formatFields()}</>; break
    case "gauge": body = <>{sourceFields()}<div className="grid grid-cols-2 gap-2"><Num label="Minimum" value={config.min as number} min={-1e12} max={1e12} step={0.01} onChange={(n) => set({ min: n })} /><Num label="Maximum" value={config.max as number} min={-1e12} max={1e12} step={0.01} onChange={(n) => set({ max: n })} /><Num label="Warning at" value={config.warn_at as number} min={-1e12} max={1e12} step={0.01} onChange={(n) => set({ warn_at: n })} /><Num label="Danger at" value={config.danger_at as number} min={-1e12} max={1e12} step={0.01} onChange={(n) => set({ danger_at: n })} /></div>{sw("higher_is_better", "Higher is better")}{formatFields()}</>; break
    case "heatmap": body = <>{sel("source", "Data", [["tasks", "Tasks"], ["runs", "Workflow runs"], ["submissions", "Form submissions"]])}{config.source === "tasks" && sel("event", "When", [["created", "Created"], ["completed", "Completed"]])}{config.source === "tasks" && bind("assignee", "Assignee", "user")}{config.source === "tasks" && bind("team", "Team", "team")}{config.source !== "submissions" && bind("workflow_id", "Workflow", "workflow")}{config.source === "submissions" && bind("form_id", "Form", "form")}{bind("date_range", "Period", "date_range")}</>; break
    case "pivot": {
      const dims: Array<[string, string]> = [["time", "Time"], ["status", "Status"], ["workflow", "Workflow"], ["form", "Form"], ["assignee", "Person"], ["field", "A column"]]
      body = <>
        {sourceFields()}
        {sel("rows", "Rows", dims)}{config.rows === "field" && tableId && <Pick app={app} label="Row column" kind="column" table={tableId} value={config.row_field} onChange={(v) => set({ row_field: v })} />}
        {sel("columns", "Columns", [["none", "None"], ...dims])}{config.columns === "field" && tableId && <Pick app={app} label="Column column" kind="column" table={tableId} value={config.column_field} onChange={(v) => set({ column_field: v })} />}
        {(config.rows === "time" || config.columns === "time") && sel("interval", "Interval", ["day", "week", "month"])}
        {config.source === "table_rows" && config.aggregate !== "count" && tableId && <Pick app={app} label="Value column" kind="column" table={tableId} value={config.value_field} onChange={(v) => set({ value_field: v })} />}
        {click()}
      </>
      break
    }
    case "table_view": {
      const c = widget.config as WidgetConfig<"table_view">
      body = <>{sel("kind", "Show", [["data_table", "A data table"], ["report", "A saved report"]])}{c.kind === "data_table" ? <>{bind("table_id", "Data table", "table", false)}<Columns app={app} label="Columns (none: the first 8)" table={c.table_id} value={c.columns} onChange={(v) => set({ columns: v })} max={20} />{num("limit", "Rows", 1, 100)}</> : pick("report_id", "Report", "report")}</>
      break
    }
    case "data_grid": {
      const c = widget.config as WidgetConfig<"data_grid">
      body = <>{sel("source", "Data", [["table", "A data table"], ["instance", "UserTasks instance (admins)"]])}{c.source === "instance" ? instanceListFields() : bind("table_id", "Data table", "table", false)}{c.source !== "instance" && tableId && <Pick app={app} label="Saved view (optional)" kind="view" table={tableId} value={c.view_id} clear="No view" onChange={(v) => set({ view_id: v })} />}<Columns app={app} label="Columns (none: the view’s / the first 8)" table={c.table_id} value={c.columns} onChange={(v) => set({ columns: v })} />{bind("search", "Search (fixed text or a text filter)", "text")}{tableId && <Pick app={app} label="Group by (optional)" kind="column" table={tableId} value={c.group_by} clear="No grouping" onChange={(v) => set({ group_by: v })} />}{tableId && <Pick app={app} label="Sort by (optional; viewers re-sort with the column headers)" kind="column" table={tableId} value={c.sort} clear="Newest first" onChange={(v) => set({ sort: v })} />}{c.sort && sel("sort_dir", "Order", [["asc", "Ascending"], ["desc", "Descending"]])}{num("page_size", "Rows per page", 5, 100)}{sw("personal_views", "Viewers can save their own views (sort, search, columns, filters)")}{sw("editable", "Contributors with Manage rows can edit cells")}{sw("allow_delete", "Contributors with Manage rows can select rows and delete them")}
        <div className="space-y-1">
          <span className="text-xs font-medium text-fg">Actions for selected rows</span>
          <p className="text-2xs text-fg-muted">Each button runs this page’s “Grid row action” rules once per selected row ({"{{event.row.<column>}}"}).</p>
          {(c.row_actions ?? []).map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-1">
              <Input size="sm" aria-label={`Row action ${i + 1}`} value={a.label} placeholder="e.g. Mark won" maxLength={40} onChange={(e) => set({ row_actions: (c.row_actions ?? []).map((x, j) => (j === i ? { label: e.target.value } : x)) })} />
              <IconButton size="sm" label="Remove action" icon={<Trash2 />} onClick={() => set({ row_actions: (c.row_actions ?? []).filter((_, j) => j !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={(c.row_actions ?? []).length >= 4} onClick={() => set({ row_actions: [...(c.row_actions ?? []), { label: "Action" }] })}>Add an action</Button>
        </div>
        <ColumnFormatsEditor value={c.formats} onChange={(formats) => set({ formats })} /></>
      break
    }
    case "record_card": body = <>{bind("table_id", "Data table", "table", false)}{bind("row_id", "Row (an id, or a text filter holding one)", "text")}<Columns app={app} label="Fields" table={config.table_id} value={(config.fields as string[]) ?? []} onChange={(v) => set({ fields: v })} /><ColumnFormatsEditor value={(widget.config as WidgetConfig<"record_card">).formats} onChange={(formats) => set({ formats })} />{sw("show_history", "Show the record’s change history (tables that record changes)")}</>; break
    case "filtered_list": body = <>{bind("table_id", "Data table", "table", false)}{tableId && <><Pick app={app} label="Title column" kind="column" table={tableId} value={config.title_column} onChange={(v) => set({ title_column: v })} /><Pick app={app} label="Subtitle column" kind="column" table={tableId} value={config.subtitle_column} clear="None" onChange={(v) => set({ subtitle_column: v })} /></>}{bind("search", "Search (fixed or a text filter)", "text")}{sw("show_search", "Search box")}{num("limit", "Rows", 1, 100)}{click()}{tableId && (config.click as ClickTarget)?.filter && <Pick app={app} label="Value of the clicked row (column; default its id)" kind="column" table={tableId} value={config.click_column} clear="Row id" onChange={(v) => set({ click_column: v })} />}</>; break
    case "card_view": body = <CardViewEditor app={app} config={widget.config as WidgetConfig<"card_view">} onChange={(c) => set(c)} filters={filters} pages={pages} />; break
    case "team_members": body = <>{bind("team", "Team", "team")}{sw("show_workload", "Open task counts")}{sw("show_presence", "Presence (last seen)")}{num("limit", "People", 1, 100)}{click(["user"])}</>; break
    case "org_chart": body = <>{bind("person", "Whose org chart (default: the viewer)", "user")}{num("depth", "Levels of reports", 1, 3)}</>; break
    case "people_directory": body = <>{bind("team", "Only a team (optional)", "team")}{num("limit", "Per page", 5, 100)}</>; break
    case "activity_feed":
      body = <>
        <fieldset className="space-y-1"><legend className="text-ui font-medium text-fg">Show</legend>
          {(["tasks", "runs", "submissions", "audit"] as const).map((s) => { const list = (config.sources as string[]) ?? []; return <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--theme-primary)]" checked={list.includes(s)} onChange={(e) => set({ sources: e.target.checked ? [...list, s] : list.filter((x) => x !== s) })} />{s === "audit" ? "Audit log (admins with View settings only)" : label(s)}</label> })}
        </fieldset>
        {bind("workflow_id", "Workflow", "workflow")}{bind("person", "Person", "user")}{bind("date_range", "Period", "date_range")}{num("limit", "Items", 1, 50)}
      </>
      break
    case "announcement": body = <><Row label="Text (HTML: paragraphs, lists, links, bold, italic)"><Textarea rows={6} value={String(config.html ?? "")} maxLength={20000} onChange={(e) => set({ html: e.target.value })} className="font-mono text-xs" /></Row>{sel("tone", "Tone", ["info", "success", "warning", "danger", "neutral"])}<div className="grid grid-cols-2 gap-2"><Row label="Show from"><Input size="sm" type="date" value={String(config.starts_on ?? "")} onChange={(e) => set({ starts_on: e.target.value || null })} /></Row><Row label="Until"><Input size="sm" type="date" value={String(config.ends_on ?? "")} onChange={(e) => set({ ends_on: e.target.value || null })} /></Row></div></>; break
    case "embed": body = <>{txt("url", "Address (https://)", "https://…", 2000)}{txt("title", "Accessible title", "What the frame shows", 120)}{sw("allow_fullscreen", "Allow full screen")}<p className="text-2xs text-fg-muted">Only sites an admin allowed under Settings → Embedding (Sites app pages may embed) are shown.</p></>; break
    case "video": body = <>{txt("url", "Video (YouTube, Vimeo or an https:// .mp4 / .webm)", "https://…", 2000)}{txt("caption", "Caption", "", 300)}</>; break
    case "divider": body = txt("label", "Label (optional)", "", 80); break
    case "spacer": body = <p className="text-xs text-fg-muted">Resize the spacer on the grid.</p>; break
    case "tabs": body = <TabsEditor app={app} config={widget.config as WidgetConfig<"tabs">} onChange={(c) => set(c)} widget={widget} widgets={widgets} pages={pages} />; break
    case "section": body = <>{txt("label", "Heading", "Section", 80)}<ChildPicker label="Widgets in this section" value={(config.widgets as string[]) ?? []} onChange={(v) => set({ widgets: v })} self={widget.id} widgets={widgets} />{sw("collapsible", "Can be collapsed")}{sw("collapsed", "Collapsed at first")}</>; break
    case "page_header": body = <>{sw("show_icon", "App icon")}{sw("show_breadcrumb", "Breadcrumb")}{txt("subtitle", "Subtitle", "", 300)}</>; break
    case "quick_search":
      body = <>{txt("placeholder", "Placeholder", "Search this app…", 80)}<fieldset className="space-y-1"><legend className="text-ui font-medium text-fg">Search</legend>{(["pages", "forms", "workflows", "tables", "reports", "tasks"] as const).map((s) => { const list = (config.include as string[]) ?? []; return <label key={s} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--theme-primary)]" checked={list.includes(s)} onChange={(e) => set({ include: e.target.checked ? [...list, s] : list.filter((x) => x !== s) })} />{label(s)}</label> })}</fieldset></>
      break
    case "agent_chat": body = <>{pick("agent_id", "Agent", "agent")}<Row label="Greeting"><Textarea rows={2} value={String(config.greeting ?? "")} maxLength={400} onChange={(e) => set({ greeting: e.target.value || null })} /></Row>{txt("placeholder", "Placeholder", "Ask a question…", 120)}<p className="text-2xs text-fg-muted">Shown to contributors who may run agents (View agents + Run agents).</p></>; break
    case "nav_bar": {
      const c = widget.config as WidgetConfig<"nav_bar">
      body = <>
        {sel("edge", "Dock to", [["left", "Left edge"], ["right", "Right edge"], ["top", "Top edge"]])}
        <MenuItemsEditor app={app} items={c.items} onChange={(items) => set({ items })} pages={pages} filters={filters} nested />
        {num("size", c.edge === "top" ? "Height (px)" : "Width (px)", 40, 400)}
        {sel("background", "Background", [["surface", "Surface"], ["app", "App colour"], ["dark", "Dark"]])}
        {sel("density", "Density", ["comfortable", "compact"])}{sel("icon_size", "Icon size", [["sm", "Small"], ["md", "Medium"], ["lg", "Large"]])}
        {sw("show_labels", "Show labels")}{c.edge !== "top" && sw("collapsible", "Collapse to icons")}{c.edge !== "top" && sw("show_search", "Search box")}{c.edge !== "top" && c.show_search && sw("search_objects", "Search also finds the app’s objects")}
        {c.edge !== "top" && sw("footer_profile", "Footer: the viewer")}{c.edge !== "top" && txt("footer_help_url", "Footer: help link", "https://…", 2000)}
        <p className="text-2xs text-fg-muted">One bar per edge; on phones side bars become a menu button.</p>
      </>
      break
    }
    case "heading": body = <>{txt("text", "Heading", "", 200)}{txt("subtitle", "Subtitle", "", 400)}<Row label="Size"><Select size="sm" value={String(config.level)} onChange={(e) => set({ level: Number(e.target.value) })} options={opts([["1", "Large"], ["2", "Medium"], ["3", "Small"]])} /></Row></>; break
    case "text": body = <Row label="Text (HTML: paragraphs, headings, lists, links, bold, italic)"><Textarea rows={10} value={String(config.html ?? "")} maxLength={20000} onChange={(e) => set({ html: e.target.value })} className="font-mono text-xs" /></Row>; break
    case "image": body = <>{txt("url", "Image address (https://)", "https://…", 2000)}{txt("alt", "Alternative text", "What the image shows", 300)}{sel("fit", "Fit", [["cover", "Fill the box"], ["contain", "Show it all"]])}{txt("link", "Link (optional)", "https://… or /path", 2000)}</>; break
    case "links": {
      const c = widget.config as WidgetConfig<"links">
      body = (
        <div className="space-y-2">
          {c.links.map((link, i) => (
            <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
              <div className="flex gap-1"><Input size="sm" value={link.label} placeholder="Label" aria-label="Label" onChange={(e) => set({ links: c.links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)) })} /><IconButton size="sm" label="Remove link" icon={<Trash2 />} onClick={() => set({ links: c.links.filter((_, j) => j !== i) })} /></div>
              <Input size="sm" value={link.url} placeholder="https://… or /path" aria-label="Address" onChange={(e) => set({ links: c.links.map((l, j) => (j === i ? { ...l, url: e.target.value.trim() } : l)) })} />
              <Input size="sm" value={link.description ?? ""} placeholder="Description (optional)" aria-label="Description" onChange={(e) => set({ links: c.links.map((l, j) => (j === i ? { ...l, description: e.target.value || null } : l)) })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => set({ links: [...c.links, { label: "Link", url: "https://" }] })}>Add link</Button>
        </div>
      )
      break
    }
  }

  return (
    <div className="space-y-3" data-widget-settings={widget.type}>
      <p className="text-xs text-fg-muted">{entry.description}</p>
      {!["heading", "divider", "spacer", "nav_bar"].includes(widget.type) && (
        <Row label="Title" hint={needsTitle(widget.type) && !widget.title?.trim() ? `Untitled: viewers see “${autoTitle(widget)}”.` : undefined}>
          <Input size="sm" value={widget.title ?? ""} maxLength={120} placeholder={needsTitle(widget.type) ? autoTitle(widget) : entry.title} onChange={(e) => onChange({ ...widget, title: e.target.value || null })} data-widget-title-input />
        </Row>
      )}
      {body}
      {widget.type === "pivot" && <>{sw("heat", "Shade cells by value (heat map)")}<Switch checked={config.totals !== false} onCheckedChange={(v) => set({ totals: v ? undefined : false })} label="Total row and column" /></>}
      {tableId && "where" in WIDGET_CONFIG_SCHEMAS[widget.type].shape && (widget.type === "data_grid" || widget.type === "filtered_list" || (widget.type === "card_view" ? config.source === "table" : config.source === "table_rows")) && (
        <RowConditionsEditor app={app} table={tableId} value={(config.where as RowCondition[] | undefined) ?? []} filters={filters} onChange={(where) => set({ where: where.length ? where : undefined })} />
      )}
      {fitsContent(widget.type) && !isBleed(widget) && <HeightEditor widget={widget} onChange={onChange} />}
      <WidgetDataSource widget={widget} onChange={onChange} />
      {!["nav_bar", "spacer", "divider"].includes(widget.type) && (
        <Switch checked={isBleed(widget)} onCheckedChange={(v) => onChange({ ...widget, bleed: v })} label="Chromeless (fill the area: no card, border, padding or title)" />
      )}
    </div>
  )
}

/* ── Height ──────────────────────────────────────────────────────────── */

/** Auto height (fit the content, up to a cap, then scroll inside) or a fixed number of rows. */
function HeightEditor({ widget, onChange }: { widget: AppWidget; onChange: (widget: AppWidget) => void }) {
  const mode = widget.height ?? "legacy"
  const e = catalogEntry(widget.type)
  return (
    <Row label="Height" hint={mode === "auto" ? "Grows and shrinks with its content, up to the cap, then scrolls inside." : mode === "fixed" ? "Exactly the size you drag it to; lists show the rows that fit and “View all”." : "Shrinks to its content, never taller than the size you dragged it to."}>
      <div className="flex items-center gap-2">
        <Select size="sm" value={mode} aria-label="Height" data-widget-height
          options={[{ value: "auto", label: "Auto (fit content)" }, { value: "fixed", label: "Fixed" }, ...(mode === "legacy" ? [{ value: "legacy", label: "Fit, up to its size" }] : [])]}
          onChange={(ev) => {
            const v = ev.target.value
            onChange(v === "legacy" ? { ...widget, height: undefined, max_h: undefined } : v === "auto" ? { ...widget, height: "auto" } : { ...widget, height: "fixed", max_h: undefined })
          }} />
        {mode === "auto" && (
          <label className="flex items-center gap-1 text-xs text-fg-muted">up to
            <Input size="sm" type="number" className="w-16" min={Math.max(2, e.minH)} max={30} value={widget.max_h ?? 14} aria-label="Most rows"
              onChange={(ev) => { const n = Number(ev.target.value); if (Number.isFinite(n)) onChange({ ...widget, max_h: Math.min(30, Math.max(Math.max(2, e.minH), Math.round(n))) }) }} />
            rows
          </label>
        )}
      </div>
    </Row>
  )
}

/* ── Data source (Settings → Query) ──────────────────────────────────── */

/** Widgets whose numbers can come from the report rollups. */
const ROLLUP_WIDGETS = new Set(["metric", "chart", "kpi", "goal", "gauge", "pivot", "throughput", "submission_trend", "cycle_time", "sla_trend"])

/** Inherit / Flat table / Real time — shown only when the workspace allows per-widget overrides. */
function WidgetDataSource({ widget, onChange }: { widget: AppWidget; onChange: (widget: AppWidget) => void }) {
  const supported = ROLLUP_WIDGETS.has(widget.type)
  const { data } = useQuery({
    queryKey: ["settings", "query", "widget-override"],
    enabled: supported,
    staleTime: 60_000,
    queryFn: () => serverQuery("settings.queryWidgetOverride") as Promise<{ allowed: boolean }>,
  })
  if (!supported || !data?.allowed) return null
  return (
    <Row label="Data source" hint="Flat table: the per-day rollups (fast); Real time: every row. Inherit follows the app and Settings → Query.">
      <Select size="sm" value={widget.data_source ?? "inherit"} data-widget-data-source
        options={[{ value: "inherit", label: "Inherit" }, { value: "auto", label: "Auto" }, { value: "rollup", label: "Flat table" }, { value: "live", label: "Real time" }]}
        onChange={(e) => onChange({ ...widget, data_source: e.target.value === "inherit" ? undefined : e.target.value as AppWidget["data_source"] })} />
    </Row>
  )
}

/* ── Buttons ─────────────────────────────────────────────────────────── */

const ACTION_LABELS: Record<ButtonAction["kind"], string> = {
  new_submission: "Open a form", start_workflow: "Start a workflow", open_page: "Open a page", open_url: "Open a link", open_report: "Open a report",
  download_report: "Download a report (CSV)", open_record: "Open a data table record", claim_next: "Claim the next task", copy_link: "Copy a link", set_filter: "Set a page filter", run_rules: "Run app rules only (When this button is clicked)",
}

export function defaultAction(kind: ButtonAction["kind"], pages: Array<{ slug: string }>, filters: readonly PageFilter[]): ButtonAction {
  switch (kind) {
    case "new_submission": return { kind, form_id: "", open: "modal" }
    case "start_workflow": return { kind, workflow_id: "" }
    case "open_page": return { kind, page_slug: pages[0]?.slug ?? "home" }
    case "open_url": return { kind, url: "https://", new_tab: true }
    case "open_report": case "download_report": return { kind, report_id: "" }
    case "open_record": return { kind, table_id: "", row_id: null }
    case "claim_next": return { kind, team: "my_teams" }
    case "copy_link": return { kind, target: "this_page" }
    case "set_filter": return { kind, filter: filters[0]?.id ?? "filter", value: null }
    case "run_rules": return { kind }
  }
}

/** The target of an action (pickers per kind) — shared by buttons and tiles. */
export function ActionTarget({ app, action, onChange, pages, filters }: { app: string; action: ButtonAction; onChange: (a: ButtonAction) => void; pages: Array<{ slug: string; title: string }>; filters: readonly PageFilter[] }) {
  const a = action
  switch (a.kind) {
    case "new_submission": return (
      <div className="space-y-1">
        <ObjectPicker app={app} kind="form" label="Form" value={a.form_id || null} onChange={(v) => onChange({ ...a, form_id: v ?? "" })} placeholder="Search forms…" />
        <FormParamsEditor app={app} formId={a.form_id} value={a.params} onChange={(params) => onChange({ ...a, params })} filters={filters} />
      </div>
    )
    case "start_workflow": return <ObjectPicker app={app} kind="workflow" label="Workflow" value={a.workflow_id || null} onChange={(v) => onChange({ ...a, workflow_id: v ?? "" })} placeholder="Search workflows…" />
    case "open_report": case "download_report": return <ObjectPicker app={app} kind="report" label="Report" value={a.report_id || null} onChange={(v) => onChange({ ...a, report_id: v ?? "" })} placeholder="Search reports…" />
    case "open_record": return <div className="space-y-1"><ObjectPicker app={app} kind="table" label="Data table" value={a.table_id || null} onChange={(v) => onChange({ ...a, table_id: v ?? "" })} placeholder="Search data tables…" /><Input size="sm" value={a.row_id ?? ""} placeholder="Row id (empty: a new record)" aria-label="Row id" onChange={(e) => onChange({ ...a, row_id: e.target.value || null })} /></div>
    case "open_page": return (
      <div className="space-y-1">
        <ObjectPicker app={app} kind="page" label="Page" value={a.page_slug} onChange={(v) => onChange({ ...a, page_slug: v ?? pages[0]?.slug ?? "home" })} />
        {filters.length > 0 && <Input size="sm" aria-label="Filter values to pass" placeholder="Pass filters: team={{filter:team}}, status=open"
          value={Object.entries(a.filters ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}
          onChange={(e) => onChange({ ...a, filters: Object.fromEntries(e.target.value.split(",").map((p) => p.split("=").map((x) => x.trim())).filter(([k, v]) => /^[a-z][a-z0-9_]{0,39}$/.test(k ?? "") && v)) })} />}
        <span className="block text-2xs font-medium text-fg-muted">Page parameters to pass (opened in a panel or this tab)</span>
        <ParamRows value={a.params} onChange={(params) => onChange({ ...a, params })} filters={filters} />
      </div>
    )
    case "open_url": return <div className="flex items-center gap-2"><Input size="sm" aria-label="Address" value={a.url} placeholder="https://… or /path" onChange={(e) => onChange({ ...a, url: e.target.value.trim() })} /><Switch checked={a.new_tab} onCheckedChange={(v) => onChange({ ...a, new_tab: v })} label="New tab" /></div>
    case "claim_next": return <ObjectPicker app={app} kind="team" label="Team queue" value={a.team} tokens={[{ value: "my_teams", label: "Any of the viewer’s teams" }]} onChange={(v) => onChange({ ...a, team: v ?? "my_teams" })} />
    case "copy_link": return <Input size="sm" aria-label="Link" value={a.target === "this_page" ? "" : a.target} placeholder="This page (or https://… / /path)" onChange={(e) => onChange({ ...a, target: e.target.value.trim() || "this_page" })} />
    case "run_rules": return <p className="text-2xs text-fg-muted">Add an app rule: When “Button clicked” on this widget and button, then … (Rules tab).</p>
    case "set_filter": return <div className="grid grid-cols-2 gap-1"><Select size="sm" aria-label="Filter" value={a.filter} onChange={(e) => onChange({ ...a, filter: e.target.value })} options={filters.map((f) => ({ value: f.id, label: f.label }))} /><Input size="sm" aria-label="Value" value={a.value ?? ""} placeholder="Value (empty: clear)" onChange={(e) => onChange({ ...a, value: e.target.value || null })} /></div>
  }
}

export function OpenModeEditor({ value, onChange }: { value: OpenMode | null | undefined; onChange: (v: OpenMode | null) => void }) {
  const v = value ?? null
  const sized = v && ["modal", "panel_right", "panel_left", "sheet"].includes(v.mode)
  return (
    <div className="space-y-1" data-open-mode>
      <div className="grid grid-cols-2 gap-1">
        <Select size="sm" aria-label="Open in" value={v?.mode ?? ""} onChange={(e) => onChange(e.target.value ? { mode: e.target.value as OpenMode["mode"], width: v?.width ?? "md", motion: v?.motion ?? "auto", resizable: v?.resizable ?? true } : null)}
          options={[{ value: "", label: "Default" }, ...OPEN_MODES.map((m) => ({ value: m, label: { modal: "Modal", panel_right: "Panel (right)", panel_left: "Panel (left)", sheet: "Bottom sheet", fullscreen: "Full screen", inline: "Inline", navigate: "This tab", tab: "New tab" }[m] }))]} />
        {v && !["navigate", "tab", "inline"].includes(v.mode) && <Select size="sm" aria-label="Motion" value={v.motion} onChange={(e) => onChange({ ...v, motion: e.target.value as OpenMode["motion"] })} options={opts([["auto", "Motion: auto"], ["slide", "Slide"], ["fade", "Fade"], ["scale", "Scale"], ["none", "None"]])} />}
      </div>
      {sized && v && (
        <>
          <div className="grid grid-cols-3 gap-1">
            <Select size="sm" aria-label="Size" value={v.preset ?? ""} onChange={(e) => onChange({ ...v, preset: (e.target.value || null) as OpenMode["preset"], width_pct: null, height_pct: null })} options={[{ value: "", label: "Size: default" }, ...(["s", "m", "l", "xl", "full"] as const).map((k) => ({ value: k, label: k.toUpperCase() === "FULL" ? "Full" : k.toUpperCase() }))]} />
            {v.mode !== "sheet" && <Input size="sm" type="number" min={20} max={100} aria-label="Width (% of the window)" placeholder="W %" value={v.width_pct ?? ""} onChange={(e) => onChange({ ...v, width_pct: e.target.value ? Math.min(100, Math.max(20, Number(e.target.value))) : null })} />}
            {(v.mode === "modal" || v.mode === "sheet") && <Input size="sm" type="number" min={20} max={100} aria-label="Height (% of the window)" placeholder="H %" value={v.height_pct ?? ""} onChange={(e) => onChange({ ...v, height_pct: e.target.value ? Math.min(100, Math.max(20, Number(e.target.value))) : null })} />}
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={v.resizable !== false} onCheckedChange={(r) => onChange({ ...v, resizable: r })} label="Allow resizing" />
            <Input size="sm" aria-label="Header title" placeholder="Title (default: its own)" value={v.title ?? ""} onChange={(e) => onChange({ ...v, title: e.target.value || null })} />
          </div>
          <p className="text-2xs text-fg-muted">Phones always open it full screen.</p>
        </>
      )}
    </div>
  )
}

/** A form's declared parameters (and its variables, for reference) → value sources (lib/apps/params.ts). */
export function FormParamsEditor({ app, formId, value, onChange, filters, eventKeys = [] }: { app: string; formId: string | null | undefined; value: ParamMap | null | undefined; onChange: (v: ParamMap) => void; filters: readonly PageFilter[]; eventKeys?: string[] }) {
  const q = useQuery({
    queryKey: ["apps", "form-params", app, formId],
    enabled: !!formId,
    queryFn: async () => (await serverQuery("apps.formParams", { app, form: formId! })) as { params: Array<{ name: string; label: string | null; type: string; required: boolean; default: string | null; source: string }>; variables: Array<{ name: string; label: string | null; type: string; initial: string }> },
    staleTime: 60_000,
  })
  if (!formId || !q.data || (!q.data.params.length && !q.data.variables.length)) return null
  const map = value ?? {}
  const setSource = (name: string, src: ValueSource | undefined) => { const next = { ...map }; if (src) next[name] = src; else delete next[name]; onChange(next) }
  const missing = unmappedRequired(q.data.params.map((p) => ({ name: p.name, required: p.required, default: p.default ?? undefined })), map)
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-form-params>
      <legend className="px-1 text-xs font-medium text-fg">Form parameters</legend>
      {q.data.params.map((p) => {
        const cur = map[p.name]
        return (
          <div key={p.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-1">
            <span className="truncate text-xs text-fg" title={p.name}>{p.label || p.name}{p.required && <span className="text-danger" aria-label="required"> *</span>} <span className="text-2xs text-fg-subtle">{p.type}</span></span>
            <ValueSourceEditor label={`Value for ${p.name}`} value={cur} onChange={(src) => setSource(p.name, src)} filters={filters} eventKeys={eventKeys}
              emptyLabel={p.default ? `Form default (${p.default})` : "Not passed"} fallbackName={p.name} />
          </div>
        )
      })}
      {missing.length > 0 && <p className="text-2xs text-warning" role="status">Required and not passed: {missing.join(", ")} — the form will ask for {missing.length === 1 ? "it" : "them"} or refuse to open.</p>}
      {q.data.variables.length > 0 && (
        <p className="text-2xs text-fg-muted">Form variables (computed by the form itself, read-only here): {q.data.variables.map((v) => `${v.label || v.name} (${v.initial === "param" ? "from a parameter" : v.initial})`).join(", ")}. After a submission, a “Form submitted” rule reads the form’s values as {"{{event.values.<field>}}"}.</p>
      )}
    </fieldset>
  )
}

function ButtonsEditor({ app, config, onChange, pages, filters }: { app: string; config: WidgetConfig<"actions">; onChange: (c: Partial<WidgetConfig<"actions">>) => void; pages: Array<{ slug: string; title: string }>; filters: readonly PageFilter[] }) {
  const setButton = (i: number, b: ActionButton) => onChange({ buttons: config.buttons.map((x, j) => (j === i ? b : x)) })
  const move = (i: number, d: number) => { const list = [...config.buttons]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; onChange({ buttons: list }) }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1.5">
        <Row label="Layout"><Select size="sm" value={config.layout} onChange={(e) => onChange({ layout: e.target.value as never })} options={opts([["row", "Row"], ["column", "Stacked"], ["grid", "Grid tiles"], ["split", "Split button"]])} /></Row>
        <Row label="Align"><Select size="sm" value={config.align} onChange={(e) => onChange({ align: e.target.value as never })} options={opts([["start", "Left"], ["center", "Centre"], ["end", "Right"], ["between", "Spread"]])} /></Row>
        <Row label="Gap"><Select size="sm" value={config.gap} onChange={(e) => onChange({ gap: e.target.value as never })} options={opts([["sm", "Small"], ["md", "Medium"], ["lg", "Large"]])} /></Row>
      </div>
      {config.layout === "split" && <Row label="Menu button label"><Input size="sm" value={config.split_label ?? ""} placeholder="More actions" onChange={(e) => onChange({ split_label: e.target.value || null })} /></Row>}
      {config.buttons.map((b, i) => (
        <details key={i} className="rounded-md border border-border p-2" open={i === config.buttons.length - 1} data-button-editor>
          <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium text-fg">
            <span className="flex-1 truncate">{b.label}</span>
            <IconButton size="sm" label="Move up" icon={<ArrowUp />} onClick={(e) => { e.preventDefault(); move(i, -1) }} />
            <IconButton size="sm" label="Move down" icon={<ArrowDown />} onClick={(e) => { e.preventDefault(); move(i, 1) }} />
            <IconButton size="sm" label="Remove button" icon={<Trash2 />} onClick={(e) => { e.preventDefault(); onChange({ buttons: config.buttons.filter((_, j) => j !== i) }) }} />
          </summary>
          <div className="mt-2 space-y-1.5">
            <Input size="sm" value={b.label} placeholder="Label" aria-label="Button label" onChange={(e) => setButton(i, { ...b, label: e.target.value })} />
            <details className="rounded border border-border p-1.5" data-button-colors>
              <summary className="cursor-pointer text-2xs font-medium text-fg-muted">Button colours (override the style)</summary>
              <div className="mt-1 space-y-1.5">
                {(["bg", "text", "border"] as const).map((k) => <ColorField key={k} name={{ bg: "Background", text: "Text", border: "Border" }[k]} value={b.colors?.[k]} onChange={(v) => setButton(i, { ...b, colors: { ...(b.colors ?? {}), [k]: v } })} />)}
              </div>
            </details>
            <Select size="sm" aria-label="Action" value={b.action.kind} onChange={(e) => setButton(i, { ...b, action: defaultAction(e.target.value as ButtonAction["kind"], pages, filters) })} options={BUTTON_ACTION_KINDS.map((k) => ({ value: k, label: ACTION_LABELS[k] }))} />
            <ActionTarget app={app} action={b.action} onChange={(a) => setButton(i, { ...b, action: a })} pages={pages} filters={filters} />
            {["new_submission", "open_page", "open_report", "open_record", "start_workflow"].includes(b.action.kind) && <OpenModeEditor value={b.open_mode} onChange={(m) => setButton(i, { ...b, open_mode: m as ActionButton["open_mode"] })} />}
            <div className="grid grid-cols-2 gap-1.5">
              <Select size="sm" aria-label="Style" value={b.style} onChange={(e) => setButton(i, { ...b, style: e.target.value as ActionButton["style"] })} options={BUTTON_VARIANTS.map((v) => ({ value: v, label: label(v) }))} />
              <Select size="sm" aria-label="Colour" value={b.color} onChange={(e) => setButton(i, { ...b, color: e.target.value as ActionButton["color"] })} options={BUTTON_COLORS.map((v) => ({ value: v, label: v === "theme" ? "Theme accent" : v === "app" ? "App colour" : label(v) }))} />
              <Select size="sm" aria-label="Size" value={b.size} onChange={(e) => setButton(i, { ...b, size: e.target.value as ActionButton["size"] })} options={opts([["sm", "Small"], ["md", "Medium"], ["lg", "Large"], ["xl", "Extra large"]])} />
              <Select size="sm" aria-label="Shape" value={b.shape} onChange={(e) => setButton(i, { ...b, shape: e.target.value as ActionButton["shape"] })} options={opts([["rounded", "Rounded"], ["pill", "Pill"], ["square", "Square"]])} />
              <IconPicker app={app} value={b.icon ?? null} onChange={(icon) => setButton(i, { ...b, icon })} />
              <Select size="sm" aria-label="Icon position" value={b.icon_position} onChange={(e) => setButton(i, { ...b, icon_position: e.target.value as ActionButton["icon_position"] })} options={opts([["left", "Icon left"], ["right", "Icon right"], ["only", "Icon only"]])} />
              <Select size="sm" aria-label="Badge" value={b.badge ?? ""} onChange={(e) => setButton(i, { ...b, badge: (e.target.value || null) as ActionButton["badge"] })} options={[{ value: "", label: "No badge" }, ...BADGE_SOURCES.map((s) => ({ value: s, label: `Badge: ${label(s)}` }))]} />
              <Input size="sm" aria-label="Keyboard shortcut" value={b.shortcut ?? ""} placeholder="Shortcut, e.g. alt+n" onChange={(e) => setButton(i, { ...b, shortcut: e.target.value.toLowerCase() || null })} />
            </div>
            <Switch checked={b.full_width} onCheckedChange={(v) => setButton(i, { ...b, full_width: v })} label="Full width" />
            <Input size="sm" aria-label="Description" value={b.description ?? ""} placeholder="Description line (optional)" onChange={(e) => setButton(i, { ...b, description: e.target.value || null })} />
            <Input size="sm" aria-label="Disabled reason" value={b.disabled_reason ?? ""} placeholder="Disabled with this reason (optional)" onChange={(e) => setButton(i, { ...b, disabled_reason: e.target.value || null })} />
            <Switch checked={!!b.confirm} onCheckedChange={(v) => setButton(i, { ...b, confirm: v ? { title: "Are you sure?", message: "" } : null })} label="Ask to confirm" />
            {b.confirm && <div className="grid gap-1"><Input size="sm" aria-label="Confirm title" value={b.confirm.title} onChange={(e) => setButton(i, { ...b, confirm: { ...b.confirm!, title: e.target.value } })} /><Input size="sm" aria-label="Confirm message" value={b.confirm.message} placeholder="Message" onChange={(e) => setButton(i, { ...b, confirm: { ...b.confirm!, message: e.target.value } })} /></div>}
            <VisibilityEditor app={app} value={b.visibility ?? null} onChange={(v) => setButton(i, { ...b, visibility: v })} />
          </div>
        </details>
      ))}
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} data-add-button
        onClick={() => onChange({ buttons: [...config.buttons, { label: "New submission", style: "primary", color: "app", size: "md", shape: "rounded", icon_position: "left", full_width: false, action: defaultAction("new_submission", pages, filters) }] })}>Add button</Button>
    </div>
  )
}

export function VisibilityEditor({ app, value, onChange }: { app: string; value: ActionButton["visibility"]; onChange: (v: ActionButton["visibility"]) => void }) {
  const v = value ?? { app_roles: [], teams: [], roles: [] }
  const empty = (x: typeof v) => !x.app_roles.length && !x.teams.length && !x.roles.length
  const put = (x: typeof v) => onChange(empty(x) ? null : x)
  return (
    <details className="rounded-md bg-subtle p-1.5 text-xs" data-visibility-editor>
      <summary className="cursor-pointer text-fg-muted">Who sees it {empty(v) ? "(everyone who may use it)" : "(restricted)"}</summary>
      <div className="mt-1.5 space-y-1.5">
        <div className="flex flex-wrap gap-2">{(["viewer", "contributor", "editor"] as const).map((r) => <label key={r} className="flex items-center gap-1"><input type="checkbox" className="accent-[var(--theme-primary)]" checked={v.app_roles.includes(r)} onChange={(e) => put({ ...v, app_roles: e.target.checked ? [...v.app_roles, r] : v.app_roles.filter((x) => x !== r) })} />{label(r)}s</label>)}</div>
        <ObjectPicker app={app} kind="team" multiple value={v.teams} onChange={(teams) => put({ ...v, teams })} placeholder="Only these teams…" label="Teams" />
        <ObjectPicker app={app} kind="role" multiple value={v.roles} onChange={(roles) => put({ ...v, roles })} placeholder="Only these roles…" label="Roles" />
        <p className="text-2xs text-fg-muted">Narrows only: people still need permission to use the target.</p>
      </div>
    </details>
  )
}

function TilesEditor({ app, config, onChange, pages, filters }: { app: string; config: WidgetConfig<"tiles">; onChange: (c: Partial<WidgetConfig<"tiles">>) => void; pages: Array<{ slug: string; title: string }>; filters: readonly PageFilter[] }) {
  const setTile = (i: number, t: WidgetConfig<"tiles">["tiles"][number]) => onChange({ tiles: config.tiles.map((x, j) => (j === i ? t : x)) })
  return (
    <div className="space-y-2">
      <Num label="Columns (wide screens)" value={config.columns} min={1} max={6} onChange={(n) => onChange({ columns: n })} />
      {config.tiles.map((t, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2" data-tile-editor>
          <div className="flex gap-1"><Input size="sm" value={t.label} aria-label="Tile label" onChange={(e) => setTile(i, { ...t, label: e.target.value })} /><IconButton size="sm" label="Remove tile" icon={<Trash2 />} onClick={() => onChange({ tiles: config.tiles.filter((_, j) => j !== i) })} /></div>
          <Input size="sm" value={t.description ?? ""} placeholder="Description" aria-label="Description" onChange={(e) => setTile(i, { ...t, description: e.target.value || null })} />
          <IconPicker app={app} value={t.icon ?? null} onChange={(icon) => setTile(i, { ...t, icon })} />
          <Select size="sm" aria-label="Action" value={t.action.kind} onChange={(e) => setTile(i, { ...t, action: defaultAction(e.target.value as ButtonAction["kind"], pages, filters) })} options={BUTTON_ACTION_KINDS.filter((k) => k !== "claim_next" && k !== "set_filter").map((k) => ({ value: k, label: ACTION_LABELS[k] }))} />
          <ActionTarget app={app} action={t.action} onChange={(a) => setTile(i, { ...t, action: a })} pages={pages} filters={filters} />
          <OpenModeEditor value={t.open_mode} onChange={(m) => setTile(i, { ...t, open_mode: m as never })} />
        </div>
      ))}
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => onChange({ tiles: [...config.tiles, { label: "New tile", action: defaultAction("open_page", pages, filters) }] })}>Add tile</Button>
    </div>
  )
}

/* ── Containers ──────────────────────────────────────────────────────── */

function ChildPicker({ label: l, value, onChange, self, widgets }: { label: string; value: string[]; onChange: (v: string[]) => void; self: string; widgets: readonly AppWidget[] }) {
  const candidates = widgets.filter((w) => w.id !== self && w.type !== "tabs" && w.type !== "section" && w.type !== "nav_bar")
  return (
    <fieldset className="space-y-1" data-child-picker>
      <legend className="text-ui font-medium text-fg">{l}</legend>
      {!candidates.length && <p className="text-xs text-fg-muted">Add other widgets to the page first.</p>}
      {candidates.map((w) => <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--theme-primary)]" checked={value.includes(w.id)} onChange={(e) => onChange(e.target.checked ? [...value, w.id] : value.filter((x) => x !== w.id))} /><span className="truncate">{w.title || catalogEntry(w.type).title}</span><span className="text-2xs text-fg-subtle">{w.id}</span></label>)}
      <p className="text-2xs text-fg-muted">Chosen widgets move into the container (off the grid).</p>
    </fieldset>
  )
}

function TabsEditor({ app, config, onChange, widget, widgets, pages }: { app: string; config: WidgetConfig<"tabs">; onChange: (c: Partial<WidgetConfig<"tabs">>) => void; widget: AppWidget; widgets: readonly AppWidget[]; pages: Array<{ slug: string; title: string }> }) {
  type Tab = WidgetConfig<"tabs">["tabs"][number]
  const setTab = (i: number, t: Tab) => onChange({ tabs: config.tabs.map((x, j) => (j === i ? t : x)) })
  const targetKind = (t: Tab) => t.target?.kind ?? "widgets"
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1.5">
        <Row label="Tab style"><Select size="sm" value={config.style} onChange={(e) => onChange({ style: e.target.value as never })} options={opts([["underline", "Underline"], ["pills", "Pills"], ["segmented", "Segmented"], ["vertical", "Vertical"]])} /></Row>
        <div className="space-y-1 pt-5"><Switch checked={config.lazy} onCheckedChange={(v) => onChange({ lazy: v })} label="Load on first open" /><Switch checked={config.remember} onCheckedChange={(v) => onChange({ remember: v })} label="Remember the last tab" /></div>
      </div>
      {config.tabs.map((t, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2" data-tab-editor>
          <div className="flex gap-1"><Input size="sm" value={t.label} aria-label="Tab label" onChange={(e) => setTab(i, { ...t, label: e.target.value })} /><IconButton size="sm" label="Remove tab" icon={<Trash2 />} disabled={config.tabs.length <= 1} onClick={() => onChange({ tabs: config.tabs.filter((_, j) => j !== i) })} /></div>
          <div className="grid grid-cols-2 gap-1.5">
            <IconPicker app={app} value={t.icon ?? null} onChange={(icon) => setTab(i, { ...t, icon })} />
            <Select size="sm" aria-label="Badge" value={t.badge ?? ""} onChange={(e) => setTab(i, { ...t, badge: (e.target.value || null) as Tab["badge"] })} options={[{ value: "", label: "No badge" }, ...BADGE_SOURCES.map((x) => ({ value: x, label: `Badge: ${label(x)}` }))]} />
          </div>
          <Select size="sm" aria-label="Tab shows" value={targetKind(t)} onChange={(e) => {
            const k = e.target.value
            setTab(i, { ...t, target: k === "widgets" ? null : k === "form" ? { kind: "form", form_id: "", hide_header: true } as never : k === "page" ? { kind: "page", page_slug: pages[0]?.slug ?? "home" } : k === "report" ? { kind: "report", report_id: "" } as never : k === "table" ? { kind: "table", table_id: "" } as never : { kind: "url", url: "https://" } })
          }} options={opts([["widgets", "Widgets of this page"], ["form", "A form (filled in place)"], ["page", "Another page of the app"], ["report", "A report"], ["table", "A data table"], ["url", "A website (embed allow-list)"]])} />
          {targetKind(t) === "widgets" && <ChildPicker label="Widgets on this tab" value={t.widgets} onChange={(v) => setTab(i, { ...t, widgets: v })} self={widget.id} widgets={widgets} />}
          {t.target?.kind === "form" && <><ObjectPicker app={app} kind="form" label="Form" value={t.target.form_id || null} onChange={(v) => setTab(i, { ...t, target: { kind: "form", form_id: v ?? "", hide_header: t.target?.kind === "form" ? t.target.hide_header : true } })} /><Switch checked={t.target.hide_header} onCheckedChange={(v) => setTab(i, { ...t, target: { ...(t.target as { kind: "form"; form_id: string; hide_header: boolean }), hide_header: v } })} label="Hide the form’s header" /><FormParamsEditor app={app} formId={t.target.form_id} value={t.target.params} onChange={(params) => setTab(i, { ...t, target: { ...(t.target as { kind: "form"; form_id: string; hide_header: boolean }), params } })} filters={[]} /></>}
          {t.target?.kind === "page" && <Select size="sm" aria-label="Page" value={t.target.page_slug} onChange={(e) => setTab(i, { ...t, target: { kind: "page", page_slug: e.target.value } })} options={pages.map((p) => ({ value: p.slug, label: p.title }))} />}
          {t.target?.kind === "report" && <ObjectPicker app={app} kind="report" label="Report" value={t.target.report_id || null} onChange={(v) => setTab(i, { ...t, target: { kind: "report", report_id: v ?? "" } })} />}
          {t.target?.kind === "table" && <ObjectPicker app={app} kind="table" label="Data table" value={t.target.table_id || null} onChange={(v) => setTab(i, { ...t, target: { kind: "table", table_id: v ?? "" } })} />}
          {t.target?.kind === "url" && <Input size="sm" aria-label="Address" value={t.target.url} placeholder="https://…" onChange={(e) => setTab(i, { ...t, target: { kind: "url", url: e.target.value.trim() } })} />}
        </div>
      ))}
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} disabled={config.tabs.length >= 8} onClick={() => onChange({ tabs: [...config.tabs, { label: `Tab ${config.tabs.length + 1}`, widgets: [] }] })}>Add tab</Button>
      <p className="text-2xs text-fg-muted">Tabs whose form, report or table a viewer can’t use are hidden for them; websites not on the embed allow-list show as a link.</p>
    </div>
  )
}

/* ── Form embed ──────────────────────────────────────────────────────── */

function FormEmbedEditor({ app, config, onChange, filters, pages }: { app: string; config: WidgetConfig<"form_embed">; onChange: (c: Partial<WidgetConfig<"form_embed">>) => void; filters: readonly PageFilter[]; pages: Array<{ slug: string; title: string }> }) {
  return (
    <div className="space-y-2">
      <div className="space-y-1"><span className="text-ui font-medium text-fg">Form</span><ObjectPicker app={app} kind="form" label="Form" value={typeof config.form_id === "string" ? config.form_id : null} onChange={(v) => onChange({ form_id: v })} placeholder="Search forms…" /></div>
      <FormParamsEditor app={app} formId={typeof config.form_id === "string" ? config.form_id : null} value={config.params} onChange={(params) => onChange({ params })} filters={filters} />
      <Switch checked={config.hide_header} onCheckedChange={(v) => onChange({ hide_header: v })} label="Hide the form’s header" />
      <Row label="After submit"><Select size="sm" value={config.after_submit} onChange={(e) => onChange({ after_submit: e.target.value as never })} options={opts([["thank_you", "The form’s own thank-you"], ["reset", "Reset for another submission"], ["message", "Show a message"], ["page", "Go to a page"]])} /></Row>
      {config.after_submit === "message" && <Row label="Message"><Input size="sm" value={config.after_message ?? ""} onChange={(e) => onChange({ after_message: e.target.value || null })} /></Row>}
      {config.after_submit === "page" && <Row label="Page"><Select size="sm" value={config.after_page ?? ""} placeholder="Choose a page" onChange={(e) => onChange({ after_page: e.target.value || null })} options={pages.map((p) => ({ value: p.slug, label: p.title }))} /></Row>}
      <Row label="When the viewer can’t submit"><Select size="sm" value={config.unavailable} onChange={(e) => onChange({ unavailable: e.target.value as never })} options={opts([["hide", "Hide the widget"], ["notice", "Show a short notice"]])} /></Row>
      <fieldset className="space-y-1.5"><legend className="text-ui font-medium text-fg">Prefill</legend>
        {config.prefill.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
            <Input size="sm" aria-label="Form field (URL parameter)" placeholder="Field / parameter" value={p.field} onChange={(e) => onChange({ prefill: config.prefill.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })} />
            <Select size="sm" aria-label="From" value={p.from === "filter" ? `filter:${p.filter ?? ""}` : p.from} onChange={(e) => { const v = e.target.value; onChange({ prefill: config.prefill.map((x, j) => (j === i ? (v.startsWith("filter:") ? { ...x, from: "filter" as const, filter: v.slice(7) } : { ...x, from: v as never }) : x)) }) }}
              options={[{ value: "me_name", label: "The viewer’s name" }, { value: "me_email", label: "The viewer’s email" }, { value: "me_id", label: "The viewer’s id" }, { value: "value", label: "A fixed value" }, ...filters.map((f) => ({ value: `filter:${f.id}`, label: `Filter: ${f.label}` }))]} />
            <IconButton size="sm" label="Remove" icon={<Trash2 />} onClick={() => onChange({ prefill: config.prefill.filter((_, j) => j !== i) })} />
            {p.from === "value" && <Input size="sm" className="col-span-2" aria-label="Value" value={p.value ?? ""} onChange={(e) => onChange({ prefill: config.prefill.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
          </div>
        ))}
        <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => onChange({ prefill: [...config.prefill, { field: "", from: "me_name" }] })}>Add prefill</Button>
        <p className="text-2xs text-fg-muted">Fills fields the form declares as URL parameters.</p>
      </fieldset>
    </div>
  )
}

/* ── Card view ───────────────────────────────────────────────────────── */

function CardViewEditor({ app, config, onChange, filters, pages }: { app: string; config: WidgetConfig<"card_view">; onChange: (c: Partial<WidgetConfig<"card_view">>) => void; filters: readonly PageFilter[]; pages: Array<{ slug: string; title: string }> }) {
  const t = config.template
  const tableId = config.source === "table" && typeof config.table_id === "string" ? config.table_id : null
  const setT = (patch: Partial<typeof t>) => onChange({ template: { ...t, ...patch } })
  const key = (l: string, value: string | null | undefined, put: (v: string | null) => void) => tableId
    ? <div className="space-y-1"><span className="text-xs font-medium text-fg">{l}</span><ObjectPicker app={app} kind="column" table={tableId} label={l} value={value ?? null} clearLabel="None" onChange={put} /></div>
    : <Row label={l}><Input size="sm" value={value ?? ""} placeholder="field or path.to.field" onChange={(e) => put(e.target.value || null)} /></Row>
  const setAction = (i: number, a: CardAction) => onChange({ actions: config.actions.map((x, j) => (j === i ? a : x)) })
  return (
    <div className="space-y-2">
      <Row label="Cards from"><Select size="sm" value={config.source} onChange={(e) => onChange({ source: e.target.value as never })} options={opts([["table", "A data table"], ["report", "A report’s rows"], ["reference", "An API reference"], ["instance", "UserTasks instance (admins)"]])} /></Row>
      {config.source === "instance" && <>
        <p className="text-2xs text-fg-muted">Operational data of every workspace (read-only). Only UserTasks instance admins see it; others see an access message.</p>
        <Row label="Dataset"><Select size="sm" value={config.instance_dataset ?? ""} onChange={(e) => onChange({ instance_dataset: (e.target.value || null) as never })} options={opts([["", "Choose…"], ...INSTANCE_DATASETS.map((d) => [d, label(d)] as [string, string])])} /></Row>
        <Row label="Parameters" hint="One per line: name=value (workspace_id, user_id, status, q, days). Values: text or {{filter:<id>}} / {{param.<name>}}.">
          <Textarea rows={3} className="font-mono text-xs" value={Object.entries(config.instance_params ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? v : `{{filter:${v.filter}}}`}`).join("\n")}
            onChange={(e) => onChange({ instance_params: Object.fromEntries(e.target.value.split("\n").map((l) => { const i = l.indexOf("="); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null }).filter((x): x is [string, string] => !!x && ["q", "workspace_id", "user_id", "status", "plan", "days"].includes(x[0]))) as never })} />
        </Row>
      </>}
      {config.source === "table" && <>
        <div className="space-y-1"><span className="text-ui font-medium text-fg">Data table</span><ObjectPicker app={app} kind="table" label="Data table" value={tableId} onChange={(v) => onChange({ table_id: v })} /></div>
        {tableId && <div className="space-y-1"><span className="text-ui font-medium text-fg">Saved view</span><ObjectPicker app={app} kind="view" table={tableId} label="View" value={config.view_id ?? null} clearLabel="No view" onChange={(v) => onChange({ view_id: v })} /></div>}
      </>}
      {config.source === "report" && <div className="space-y-1"><span className="text-ui font-medium text-fg">Report</span><ObjectPicker app={app} kind="report" label="Report" value={typeof config.report_id === "string" ? config.report_id : null} onChange={(v) => onChange({ report_id: v })} /></div>}
      {config.source === "reference" && <>
        <div className="space-y-1"><span className="text-ui font-medium text-fg">API reference</span><ObjectPicker app={app} kind="reference" label="API reference" value={typeof config.reference_id === "string" ? config.reference_id : null} onChange={(v) => onChange({ reference_id: v })} /></div>
        <Row label="Records at (response path)" hint="e.g. data.items — empty: the whole response"><Input size="sm" value={config.results_path ?? ""} onChange={(e) => onChange({ results_path: e.target.value || null })} /></Row>
        <Row label="Inputs" hint="One per line: input=value. Values: text, {{me_email}}, {{me_id}} or {{filter:<id>}}. Only the reference’s declared inputs are sent.">
          <Textarea rows={3} className="font-mono text-xs" value={Object.entries(config.reference_inputs).map(([k, v]) => `${k}=${v}`).join("\n")}
            onChange={(e) => onChange({ reference_inputs: Object.fromEntries(e.target.value.split("\n").map((l) => { const i = l.indexOf("="); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null }).filter((x): x is [string, string] => !!x && /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(x[0]))) })} />
        </Row>
        <Num label="Cache responses (seconds)" value={config.cache_ttl_s} min={0} max={3600} onChange={(n) => onChange({ cache_ttl_s: n })} />
        <Switch checked={config.allow_viewers} onCheckedChange={(v) => onChange({ allow_viewers: v })} label="Allow app viewers to see this API data" />
        <p className="text-2xs text-fg-muted">The call uses the workspace’s connection. Without this, only people with View integrations see the cards. Turning it on needs Manage references and is recorded in the audit log.</p>
      </>}
      <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-card-template>
        <legend className="px-1 text-xs font-medium text-fg">Card template</legend>
        {key("Title", t.title, (v) => setT({ title: v ?? "" }))}
        {key("Subtitle", t.subtitle, (v) => setT({ subtitle: v }))}
        {key("Description", t.description, (v) => setT({ description: v }))}
        {key("Image / avatar", t.image, (v) => setT({ image: v }))}
        {t.image && <Select size="sm" aria-label="Image style" value={t.image_style} onChange={(e) => setT({ image_style: e.target.value as never })} options={opts([["cover", "Cover image"], ["avatar", "Avatar"], ["none", "Hidden"]])} />}
        {key("Badge", t.badge, (v) => setT({ badge: v }))}
        {t.badge && (
          <Row label="Badge colours" hint="One per line: value=tone (info, success, warning, danger, accent, neutral)">
            <Textarea rows={2} className="font-mono text-xs" value={t.badge_colors.map((b) => `${b.value}=${b.tone}`).join("\n")}
              onChange={(e) => setT({ badge_colors: e.target.value.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter(([v, tone]) => v && ["neutral", "info", "success", "warning", "danger", "accent"].includes(tone)).map(([value, tone]) => ({ value, tone: tone as never })).slice(0, 20) })} />
          </Row>
        )}
        <div className="space-y-1">
          <span className="text-xs font-medium text-fg">Extra fields</span>
          {t.fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-1">
              <Input size="sm" aria-label="Field" value={f.key} placeholder="field" onChange={(e) => setT({ fields: t.fields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <Input size="sm" aria-label="Label" value={f.label ?? ""} placeholder="Label" onChange={(e) => setT({ fields: t.fields.map((x, j) => (j === i ? { ...x, label: e.target.value || null } : x)) })} />
              <Select size="sm" aria-label="Format" value={f.format ?? "text"} className="w-28"
                onChange={(e) => setT({ fields: t.fields.map((x, j) => (j === i ? { ...x, format: e.target.value === "text" ? undefined : e.target.value as (typeof CARD_FIELD_FORMATS)[number] } : x)) })}
                options={CARD_FIELD_FORMATS.map((v) => ({ value: v, label: CARD_FIELD_FORMAT_LABELS[v] }))} />
              <IconButton size="sm" label="Remove field" icon={<Trash2 />} onClick={() => setT({ fields: t.fields.filter((_, j) => j !== i) })} />
              {f.format === "currency" && <Input size="sm" aria-label="Currency" className="col-span-2" value={f.currency ?? ""} placeholder="Currency (default: the column’s, else USD)" maxLength={3}
                onChange={(e) => { const v = e.target.value.toUpperCase(); setT({ fields: t.fields.map((x, j) => (j === i ? { ...x, currency: /^[A-Z]{3}$/.test(v) ? v : undefined } : x)) }) }} />}
              {f.format === "progress" && <Input size="sm" type="number" aria-label="Full at" className="col-span-2" value={f.max ?? ""} placeholder="Full at (default 100)"
                onChange={(e) => { const n = Number(e.target.value); setT({ fields: t.fields.map((x, j) => (j === i ? { ...x, max: n > 0 ? n : undefined } : x)) }) }} />}
            </div>
          ))}
          <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={t.fields.length >= 8} onClick={() => setT({ fields: [...t.fields, { key: "" }] })}>Add field</Button>
        </div>
        {key("Footer", t.footer, (v) => setT({ footer: v }))}
        {t.footer && <Select size="sm" aria-label="Footer format" value={t.footer_format ?? "text"} onChange={(e) => setT({ footer_format: e.target.value === "text" ? undefined : e.target.value as (typeof CARD_FIELD_FORMATS)[number] })}
          options={CARD_FIELD_FORMATS.filter((v) => v !== "progress").map((v) => ({ value: v, label: `Footer: ${CARD_FIELD_FORMAT_LABELS[v].toLowerCase()}` }))} />}
      </fieldset>
      <fieldset className="space-y-1.5 rounded-md border border-border p-2">
        <legend className="px-1 text-xs font-medium text-fg">Card actions</legend>
        {config.actions.map((a, i) => (
          <div key={i} className="space-y-1 rounded bg-subtle p-1.5">
            <div className="flex gap-1">
              <Select size="sm" aria-label="Action" value={a.kind} onChange={(e) => {
                const kind = e.target.value as CardAction["kind"]
                setAction(i, kind === "detail" ? { kind, label: "Details" } : kind === "open_page" ? { kind, label: "Open", page_slug: pages[0]?.slug ?? "home", filter: filters[0]?.id ?? "filter", value_key: "id" } : kind === "open_url" ? { kind, label: "Open", url: "https://" } : kind === "start_workflow" ? { kind, label: "Start", workflow_id: "" } : { kind, label: "Fill in", form_id: "", prefill: [] })
              }} options={opts([["detail", "Record detail"], ["open_page", "Open a page with its values"], ["open_url", "Open a URL"], ["start_workflow", "Start a workflow"], ["open_form", "Open a form"]])} />
              <IconButton size="sm" label="Remove action" icon={<Trash2 />} onClick={() => onChange({ actions: config.actions.filter((_, j) => j !== i) })} />
            </div>
            <Input size="sm" aria-label="Label" value={a.label} onChange={(e) => setAction(i, { ...a, label: e.target.value } as CardAction)} />
            {a.kind === "open_page" && <div className="grid grid-cols-3 gap-1">
              <Select size="sm" aria-label="Page" value={a.page_slug} onChange={(e) => setAction(i, { ...a, page_slug: e.target.value })} options={pages.map((p) => ({ value: p.slug, label: p.title }))} />
              <Select size="sm" aria-label="Filter" value={a.filter} onChange={(e) => setAction(i, { ...a, filter: e.target.value })} options={filters.map((f) => ({ value: f.id, label: f.label }))} />
              <Input size="sm" aria-label="Value field" value={a.value_key} onChange={(e) => setAction(i, { ...a, value_key: e.target.value })} />
            </div>}
            {a.kind === "open_url" && <Input size="sm" aria-label="URL" value={a.url} placeholder="https://…/{{id}}" onChange={(e) => setAction(i, { ...a, url: e.target.value })} />}
            {a.kind === "start_workflow" && <ObjectPicker app={app} kind="workflow" label="Workflow" value={a.workflow_id || null} onChange={(v) => setAction(i, { ...a, workflow_id: v ?? "" })} />}
            {a.kind === "open_form" && <><ObjectPicker app={app} kind="form" label="Form" value={a.form_id || null} onChange={(v) => setAction(i, { ...a, form_id: v ?? "" })} /><FormParamsEditor app={app} formId={a.form_id} value={a.params} onChange={(params) => setAction(i, { ...a, params })} filters={filters} eventKeys={[t.title, t.subtitle, t.badge, ...t.fields.map((f) => f.key)].filter((k): k is string => !!k)} /></>}
          </div>
        ))}
        <Button size="sm" variant="ghost" leadingIcon={<Plus />} disabled={config.actions.length >= 4} onClick={() => onChange({ actions: [...config.actions, { kind: "detail", label: "Details" }] })}>Add action</Button>
      </fieldset>
      <div className="grid grid-cols-2 gap-1.5">
        <Row label="Layout"><Select size="sm" value={config.layout} onChange={(e) => onChange({ layout: e.target.value as never })} options={opts([["grid", "Grid"], ["list", "List"], ["compact", "Compact"]])} /></Row>
        <Row label="Card size"><Select size="sm" value={config.card_size} onChange={(e) => onChange({ card_size: e.target.value as never })} options={opts([["sm", "Small"], ["md", "Medium"], ["lg", "Large"]])} /></Row>
        {key("Sort by", config.sort, (v) => onChange({ sort: v }))}
        <Row label="Order"><Select size="sm" value={config.sort_dir} onChange={(e) => onChange({ sort_dir: e.target.value as never })} options={opts([["asc", "Ascending"], ["desc", "Descending"]])} /></Row>
      </div>
      <Switch checked={config.show_search} onCheckedChange={(v) => onChange({ show_search: v })} label="Search box" />
      <Num label="Cards per page (Load more)" value={config.page_size} min={1} max={60} onChange={(n) => onChange({ page_size: n })} />
      <Row label="Empty text"><Input size="sm" value={config.empty_text ?? ""} placeholder="Nothing to show yet." onChange={(e) => onChange({ empty_text: e.target.value || null })} /></Row>
      <ClickEditor value={config.click} onChange={(v) => onChange({ click: v })} filters={filters} pages={pages} note="Clicking a card’s title sets the filter to its value below." />
      {config.click?.filter && key("Value of the clicked card", config.click_key, (v) => onChange({ click_key: v }))}
    </div>
  )
}

export { APP_ICON_NAMES }
