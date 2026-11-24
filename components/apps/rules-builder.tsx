"use client"

import { INSTANCE_ACTIONS, INSTANCE_ACTION_LABELS, INSTANCE_DATASETS } from "@/lib/instance-admin/schema"

import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowDown, ArrowUp, Bug, Copy, Play, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { VariableInput } from "@/components/automations/variable-input"
import { GroupEditor } from "@/components/forms/designer/data-table-properties"
import { serverQuery } from "@/lib/server-read"
import { updateApp } from "@/app/actions/apps"
import type { DataTableConditionGroup } from "@/lib/forms/data-table"
import {
  ACTION_GROUPS, ACTION_LABELS, ON_ERROR, RULE_TRIGGERS, SERVER_ACTIONS, TRIGGER_LABELS, TRIGGER_PAYLOAD, describeAction, describeTrigger, newRuleId, ruleProblems,
  type AppRule, type DebugEntry, type LeafAction, type RuleAction, type RuleActionType, type RuleEvent, type RuleTrigger,
} from "@/lib/apps/rules"
import { VAR_TYPES, VAR_TYPE_LABELS, type ParamDecl, type VariableDecl, type VarType } from "@/lib/apps/variables"
import type { ParamMap, ValueSource } from "@/lib/apps/params"
import type { AppDetail, AppWidget, OpenMode, PageFilter } from "@/lib/apps/schema"
import { catalogEntry } from "@/lib/apps/widgets"
import { cn } from "@/lib/utils"
import { ObjectPicker } from "./object-picker"
import { FormParamsEditor, OpenModeEditor } from "./widget-settings"
import { AppDeclsProvider, ParamRows, ValueSourceEditor, scopePlaceholders, useAppDecls, type AppDecls } from "./value-source"

/**
 * The builder's Variables and Rules dialogs (lib/apps/variables.ts,
 * lib/apps/rules.ts): parameters and variables of the page (saved with the
 * page) and of the app (saved at once); rules as "When … If … Then …" —
 * the form rules' condition builder and template inputs — with validation,
 * and a debug panel: the last events, evaluated conditions and action
 * results of the live preview, plus "Run with a sample event".
 */

/* ── Variables & parameters ─────────────────────────────────────────── */

function DeclList<T extends ParamDecl | VariableDecl>({ kind, list, onChange, page }: { kind: "param" | "variable"; list: T[]; onChange: (l: T[]) => void; page: boolean }) {
  const set = (i: number, patch: Partial<T>) => onChange(list.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const add = () => {
    let n = list.length + 1
    while (list.some((d) => d.name === `${kind === "param" ? "param" : "var"}${n}`)) n++
    const base = { name: `${kind === "param" ? "param" : "var"}${n}`, type: "text" as VarType, default: null }
    onChange([...list, (kind === "param" ? { ...base, required: false } : { ...base, url: false }) as unknown as T])
  }
  return (
    <div className="space-y-1.5" data-decl-list={kind}>
      {list.map((d, i) => (
        <div key={i} className="grid grid-cols-[1fr_7rem_1fr_auto_auto] items-center gap-1.5" data-decl-row={d.name}>
          <Input size="sm" aria-label="Name" value={d.name} onChange={(e) => set(i, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40) } as Partial<T>)} />
          <Select size="sm" aria-label="Type" value={d.type} onChange={(e) => set(i, { type: e.target.value as VarType } as Partial<T>)} options={VAR_TYPES.map((t) => ({ value: t, label: VAR_TYPE_LABELS[t] }))} />
          <Input size="sm" aria-label="Default" placeholder="Default (or {{sys.user.id}})" value={d.default === null || d.default === undefined ? "" : typeof d.default === "object" ? JSON.stringify(d.default) : String(d.default)}
            onChange={(e) => set(i, { default: e.target.value === "" ? null : e.target.value } as Partial<T>)} />
          {kind === "param"
            ? <Switch checked={(d as ParamDecl).required} onCheckedChange={(v) => set(i, { required: v } as unknown as Partial<T>)} label="Required" />
            : page ? <Switch checked={(d as VariableDecl).url} onCheckedChange={(v) => set(i, { url: v } as unknown as Partial<T>)} label="In URL" /> : <span />}
          <IconButton size="sm" label={`Remove ${d.name}`} icon={<Trash2 />} onClick={() => onChange(list.filter((_, j) => j !== i))} />
        </div>
      ))}
      {!list.length && <p className="text-xs text-fg-muted">None yet.</p>}
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={add} data-add-decl={kind}>{kind === "param" ? "Add parameter" : "Add variable"}</Button>
    </div>
  )
}

export function VariablesDialog({ open, onOpenChange, params, variables, onChange, app, onAppSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void
  params: ParamDecl[]; variables: VariableDecl[]; onChange: (p: ParamDecl[], v: VariableDecl[]) => void
  app: AppDetail; onAppSaved: () => void
}) {
  const [scope, setScope] = useState<"page" | "app">("page")
  const [p, setP] = useState(params)
  const [v, setV] = useState(variables)
  const [ap, setAp] = useState(app.params ?? [])
  const [av, setAv] = useState(app.variables ?? [])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Start from the current declarations each time the dialog opens (adjusted while rendering).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) { setWasOpen(open); if (open) { setP(params); setV(variables); setAp(app.params ?? []); setAv(app.variables ?? []); setError(null) } }
  const apply = async () => {
    setError(null)
    if (JSON.stringify(ap) !== JSON.stringify(app.params ?? []) || JSON.stringify(av) !== JSON.stringify(app.variables ?? [])) {
      setBusy(true)
      const r = await updateApp(app.id, { params: ap, variables: av })
      setBusy(false)
      if (!r.ok) { setError(r.error); return }
      onAppSaved()
    }
    onChange(p, v)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Parameters and variables" description="Parameters come in from the URL (?p.name=…), from whatever opens the page (a button, menu entry or rule) or from the embed URL. Variables hold values while the app is open; rules and widgets set them. Use them anywhere as {{param.name}} / {{var.name}}, with system values like {{sys.user.name}} and {{sys.today}}.">
        <DialogBody className="space-y-3">
          <div role="tablist" className="flex gap-1">
            {(["page", "app"] as const).map((s) => <Button key={s} role="tab" aria-selected={scope === s} size="sm" variant={scope === s ? "primary" : "ghost"} onClick={() => setScope(s)}>{s === "page" ? "This page" : "Whole app"}</Button>)}
          </div>
          <section className="space-y-1.5"><h3 className="text-sm font-semibold text-fg">Parameters</h3>
            {scope === "page" ? <DeclList kind="param" list={p} onChange={setP} page /> : <DeclList kind="param" list={ap} onChange={setAp} page={false} />}
          </section>
          <section className="space-y-1.5"><h3 className="text-sm font-semibold text-fg">Variables</h3>
            {scope === "page" ? <DeclList kind="variable" list={v} onChange={setV} page /> : <DeclList kind="variable" list={av} onChange={setAv} page={false} />}
            <p className="text-2xs text-fg-muted">{scope === "page" ? "Page variables start from their default each visit; “In URL” keeps the value in the address so the view can be shared." : "App variables are kept while the person moves between pages (this browser tab)."}</p>
          </section>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={() => void apply()} data-apply-variables>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── Rules ──────────────────────────────────────────────────────────── */

interface Ctx {
  app: string
  widgets: AppWidget[]
  filters: readonly PageFilter[]
  pages: Array<{ slug: string; title: string }>
  decls: AppDecls
  tables: Array<{ id: string; name: string; columns: Array<{ key: string; name: string }> }>
}

const WIDGET_FOR: Partial<Record<RuleTrigger, string[]>> = {
  button_click: ["actions", "tiles"], row_click: ["data_grid", "filtered_list", "task_list", "team_workload", "team_members", "sla_breakdown", "pivot", "run_status"],
  card_click: ["card_view", "kanban"], segment_click: ["chart", "metric"], tab_changed: ["tabs"], form_submitted: ["form_embed"], row_action: ["data_grid"],
}

const L = ({ children }: { children: ReactNode }) => <span className="block text-2xs font-medium text-fg-muted">{children}</span>

function TemplateInput({ value, onChange, placeholders, placeholder, label }: { value: string; onChange: (v: string) => void; placeholders: Array<{ name: string; group: string; label?: string }>; placeholder?: string; label: string }) {
  return <div aria-label={label} data-template-input={label}><VariableInput value={value} extraVariables={placeholders} placeholder={placeholder ?? "A value, {{var.x}}, {{event.row.id}} or {{= expression }}"} onChange={onChange} /></div>
}

function KeyValues({ value, onChange, keyLabel, placeholders, keys }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyLabel: string; placeholders: Array<{ name: string; group: string; label?: string }>; keys?: Array<{ value: string; label: string }> }) {
  const entries = Object.entries(value)
  const set = (list: Array<[string, string]>) => onChange(Object.fromEntries(list.filter(([k]) => k)))
  return (
    <div className="space-y-1">
      {entries.map(([k, v], i) => (
        <div key={i} className="grid grid-cols-[9rem_1fr_auto] items-start gap-1">
          {keys?.length ? <Select size="sm" aria-label={keyLabel} value={k} onChange={(e) => set(entries.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} options={[{ value: k, label: k || "Choose…" }, ...keys.filter((o) => o.value !== k)]} />
            : <Input size="sm" aria-label={keyLabel} value={k} onChange={(e) => set(entries.map((x, j) => (j === i ? [e.target.value.replace(/[^A-Za-z0-9_.-]/g, ""), x[1]] : x)))} />}
          <TemplateInput label={`${keyLabel} ${k}`} value={v} onChange={(nv) => set(entries.map((x, j) => (j === i ? [x[0], nv] : x)))} placeholders={placeholders} />
          <IconButton size="sm" label="Remove" icon={<X />} onClick={() => set(entries.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => onChange({ ...value, [keys?.find((o) => !(o.value in value))?.value ?? `input${entries.length + 1}`]: "" })}><Plus size={11} /> {keyLabel}</button>
    </div>
  )
}

export function newAction(type: RuleActionType, ctx: Pick<Ctx, "filters" | "decls" | "pages">): RuleAction {
  const v = ctx.decls.variables[0]?.name ?? "var1"
  switch (type) {
    case "set_variable": return { type, values: [{ name: v, value: "" }] }
    case "set_filter": return { type, filter: ctx.filters[0]?.id ?? "filter_1", value: "" }
    case "clear_filters": return { type, filters: [] }
    case "open_target": return { type, target: { kind: "form", form_id: "00000000-0000-4000-8000-000000000000" }, open_mode: { mode: "panel_right", width: "md", motion: "auto", resizable: true } }
    case "close_panel": return { type, all: false }
    case "navigate": return { type, page_slug: ctx.pages[0]?.slug ?? "home" }
    case "refresh": return { type, widgets: [] }
    case "set_visibility": return { type, widgets: [], visible: "hide" }
    case "set_enabled": return { type, widget: "", enabled: false }
    case "message": return { type, text: "Done.", tone: "success" }
    case "confirm": return { type, title: "Are you sure?", message: "", then: [], else: [] }
    case "call_reference": return { type, reference_id: "00000000-0000-4000-8000-000000000000", inputs: {}, allow_viewers: false, result_var: null }
    case "table_lookup": return { type, table_id: "00000000-0000-4000-8000-000000000000", limit: 1, result_var: null }
    case "table_create": return { type, table_id: "00000000-0000-4000-8000-000000000000", values: {} }
    case "table_update": return { type, table_id: "00000000-0000-4000-8000-000000000000", row_id: "{{event.row.id}}", values: {} }
    case "start_workflow": return { type, workflow_id: "00000000-0000-4000-8000-000000000000", inputs: {} }
    case "instance_read": return { type, dataset: "workspace", params: { workspace_id: "{{param.workspace}}" }, result_var: null }
    case "instance_action": return { type, action: "unlock_user", inputs: { user_id: "{{param.user}}", reason: "" } }
    case "copy": return { type, text: "" }
    case "download_report": return { type, report_id: "00000000-0000-4000-8000-000000000000" }
    default: return { type: "noop" }
  }
}

const EMPTY_ID = "00000000-0000-4000-8000-000000000000"
const idOrNull = (v: string) => (v === EMPTY_ID ? null : v)

function ActionEditor({ action, onChange, onRemove, onMove, ctx, placeholders, nested = false }: {
  action: RuleAction; onChange: (a: RuleAction) => void; onRemove: () => void; onMove?: (d: number) => void; ctx: Ctx
  placeholders: Array<{ name: string; group: string; label?: string }>; nested?: boolean
}) {
  const a = action
  const tableCols = (id: string) => (ctx.tables.find((t) => t.id === id)?.columns ?? []).map((c) => ({ value: c.key, label: c.name }))
  const set = (patch: Record<string, unknown>) => onChange({ ...a, ...patch } as RuleAction)
  let body: ReactNode = null
  switch (a.type) {
    case "set_variable":
      body = (
        <div className="space-y-1">
          {a.values.map((row, i) => (
            <div key={i} className="grid grid-cols-[9rem_1fr_auto] items-start gap-1">
              <Select size="sm" aria-label="Variable" value={row.name} onChange={(e) => set({ values: a.values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                options={[...(ctx.decls.variables.some((d) => d.name === row.name) ? [] : [{ value: row.name, label: `${row.name} (not declared)` }]), ...ctx.decls.variables.map((d) => ({ value: d.name, label: d.label || d.name }))]} />
              <TemplateInput label={`Value of ${row.name}`} value={row.value} onChange={(v) => set({ values: a.values.map((x, j) => (j === i ? { ...x, value: v } : x)) })} placeholders={placeholders} />
              <IconButton size="sm" label="Remove" icon={<X />} disabled={a.values.length < 2} onClick={() => set({ values: a.values.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => set({ values: [...a.values, { name: ctx.decls.variables[0]?.name ?? "var1", value: "" }] })}><Plus size={11} /> Another variable</button>
        </div>
      )
      break
    case "set_filter":
      body = <div className="grid grid-cols-[9rem_1fr] gap-1"><Select size="sm" aria-label="Filter" value={a.filter} onChange={(e) => set({ filter: e.target.value })} options={ctx.filters.map((f) => ({ value: f.id, label: f.label }))} /><TemplateInput label="Filter value" value={a.value} onChange={(v) => set({ value: v })} placeholders={placeholders} /></div>
      break
    case "clear_filters":
      body = <div className="flex flex-wrap gap-2">{ctx.filters.map((f) => <label key={f.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.filters.includes(f.id)} onChange={(e) => set({ filters: e.target.checked ? [...a.filters, f.id] : a.filters.filter((x) => x !== f.id) })} />{f.label}</label>)}<span className="text-2xs text-fg-muted">None ticked: every filter.</span></div>
      break
    case "open_target": {
      const t = a.target
      const setT = (nt: typeof t) => set({ target: nt })
      body = (
        <div className="space-y-1.5">
          <Select size="sm" aria-label="What to open" value={t.kind} onChange={(e) => {
            const k = e.target.value
            setT(k === "form" ? { kind: "form", form_id: EMPTY_ID } : k === "page" ? { kind: "page", page_slug: ctx.pages[0]?.slug ?? "home" } : k === "report" ? { kind: "report", report_id: EMPTY_ID } : k === "record" ? { kind: "record", table_id: EMPTY_ID, row_id: "{{event.row.id}}" } : k === "workflow" ? { kind: "workflow", workflow_id: EMPTY_ID } : { kind: "url", url: "https://" })
          }} options={[["form", "A form (new submission)"], ["page", "A page of this app"], ["report", "A report"], ["record", "A data table record"], ["workflow", "A workflow’s start form"], ["url", "A web address"]].map(([value, label]) => ({ value, label }))} />
          {t.kind === "form" && <><ObjectPicker app={ctx.app} kind="form" label="Form" value={idOrNull(t.form_id)} onChange={(v) => setT({ ...t, form_id: v ?? EMPTY_ID })} />
            <FormParamsEditor app={ctx.app} formId={idOrNull(t.form_id)} value={t.params} onChange={(params) => setT({ ...t, params })} filters={ctx.filters} eventKeys={["id", "row.id"]} /></>}
          {t.kind === "page" && <>
            <Select size="sm" aria-label="Page" value={t.page_slug} onChange={(e) => setT({ ...t, page_slug: e.target.value })} options={ctx.pages.map((p) => ({ value: p.slug, label: p.title }))} />
            <L>Page parameters to pass</L><ParamRows value={t.params} onChange={(params) => setT({ ...t, params })} filters={ctx.filters} />
          </>}
          {t.kind === "report" && <ObjectPicker app={ctx.app} kind="report" label="Report" value={idOrNull(t.report_id)} onChange={(v) => setT({ ...t, report_id: v ?? EMPTY_ID })} />}
          {t.kind === "record" && <><ObjectPicker app={ctx.app} kind="table" label="Data table" value={idOrNull(t.table_id)} onChange={(v) => setT({ ...t, table_id: v ?? EMPTY_ID })} /><TemplateInput label="Row id" value={t.row_id ?? ""} onChange={(v) => setT({ ...t, row_id: v || null })} placeholders={placeholders} placeholder="Row id (empty: a new record)" /></>}
          {t.kind === "workflow" && <ObjectPicker app={ctx.app} kind="workflow" label="Workflow" value={idOrNull(t.workflow_id)} onChange={(v) => setT({ ...t, workflow_id: v ?? EMPTY_ID })} />}
          {t.kind === "url" && <TemplateInput label="Address" value={t.url} onChange={(v) => setT({ ...t, url: v })} placeholders={placeholders} placeholder="https://… or /path, with {{placeholders}}" />}
          <L>Open in</L><OpenModeEditor value={a.open_mode as OpenMode | null | undefined} onChange={(m) => set({ open_mode: m })} />
        </div>
      )
      break
    }
    case "close_panel": body = <Switch checked={a.all} onCheckedChange={(v) => set({ all: v })} label="Close every open panel (otherwise the top one)" />; break
    case "navigate":
      body = <div className="space-y-1"><Select size="sm" aria-label="Page" value={a.page_slug} onChange={(e) => set({ page_slug: e.target.value })} options={ctx.pages.map((p) => ({ value: p.slug, label: p.title }))} /><L>Page parameters</L><ParamRows value={a.params} onChange={(params) => set({ params })} filters={ctx.filters} /></div>
      break
    case "refresh": case "set_visibility":
      body = (
        <div className="space-y-1">
          {a.type === "set_visibility" && <Select size="sm" aria-label="Show or hide" value={a.visible} onChange={(e) => set({ visible: e.target.value })} options={[{ value: "hide", label: "Hide" }, { value: "show", label: "Show" }, { value: "toggle", label: "Toggle" }]} />}
          <div className="flex max-h-28 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">{ctx.widgets.map((w) => <label key={w.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.widgets.includes(w.id)} onChange={(e) => set({ widgets: e.target.checked ? [...a.widgets, w.id] : a.widgets.filter((x) => x !== w.id) })} />{w.title || catalogEntry(w.type).title} <span className="text-fg-subtle">{w.id}</span></label>)}</div>
          {a.type === "refresh" && <span className="text-2xs text-fg-muted">None ticked: every widget.</span>}
        </div>
      )
      break
    case "set_enabled": {
      const btnWidget = ctx.widgets.find((w) => w.id === a.widget)
      const buttons = btnWidget?.type === "actions" ? ((btnWidget.config as { buttons: Array<{ label: string }> }).buttons) : []
      body = (
        <div className="grid grid-cols-3 gap-1">
          <Select size="sm" aria-label="Buttons widget" value={a.widget} onChange={(e) => set({ widget: e.target.value })} options={[{ value: "", label: "Choose…" }, ...ctx.widgets.filter((w) => w.type === "actions").map((w) => ({ value: w.id, label: w.title || w.id }))]} />
          <Select size="sm" aria-label="Button" value={a.button === null || a.button === undefined ? "" : String(a.button)} onChange={(e) => set({ button: e.target.value === "" ? null : Number(e.target.value) })} options={[{ value: "", label: "Every button" }, ...buttons.map((b, i) => ({ value: String(i), label: b.label }))]} />
          <Select size="sm" aria-label="Enable or disable" value={a.enabled ? "1" : "0"} onChange={(e) => set({ enabled: e.target.value === "1" })} options={[{ value: "0", label: "Disable" }, { value: "1", label: "Enable" }]} />
        </div>
      )
      break
    }
    case "message":
      body = <div className="grid grid-cols-[1fr_7rem] gap-1"><TemplateInput label="Message" value={a.text} onChange={(v) => set({ text: v })} placeholders={placeholders} /><Select size="sm" aria-label="Tone" value={a.tone} onChange={(e) => set({ tone: e.target.value })} options={["info", "success", "warning", "danger"].map((t) => ({ value: t, label: t }))} /></div>
      break
    case "copy": body = <TemplateInput label="Text to copy" value={a.text} onChange={(v) => set({ text: v })} placeholders={placeholders} />; break
    case "download_report": body = <ObjectPicker app={ctx.app} kind="report" label="Report" value={idOrNull(a.report_id)} onChange={(v) => set({ report_id: v ?? EMPTY_ID })} />; break
    case "confirm":
      body = (
        <div className="space-y-1.5">
          <TemplateInput label="Question" value={a.title} onChange={(v) => set({ title: v })} placeholders={placeholders} />
          <TemplateInput label="Details" value={a.message} onChange={(v) => set({ message: v })} placeholders={placeholders} placeholder="More detail (optional)" />
          <Input size="sm" aria-label="Confirm button" placeholder="Confirm button (Continue)" value={a.confirm_label ?? ""} onChange={(e) => set({ confirm_label: e.target.value || null })} />
          {nested ? null : (["then", "else"] as const).map((branch) => (
            <div key={branch} className="space-y-1 rounded-md border-l-2 border-primary pl-2">
              <L>{branch === "then" ? "If they confirm" : "Otherwise"}</L>
              <ActionList list={a[branch]} onChange={(l) => set({ [branch]: l })} ctx={ctx} placeholders={placeholders} nested />
            </div>
          ))}
        </div>
      )
      break
    case "call_reference":
      body = (
        <div className="space-y-1.5">
          <ObjectPicker app={ctx.app} kind="reference" label="API reference" value={idOrNull(a.reference_id)} onChange={(v) => set({ reference_id: v ?? EMPTY_ID })} />
          <L>Inputs (declared reference inputs only)</L><KeyValues value={a.inputs} onChange={(inputs) => set({ inputs })} keyLabel="Input" placeholders={placeholders} />
          <Input size="sm" aria-label="Results path" placeholder="Keep only this part of the response (e.g. data.customer)" value={a.results_path ?? ""} onChange={(e) => set({ results_path: e.target.value || null })} />
          <Switch checked={a.allow_viewers} onCheckedChange={(v) => set({ allow_viewers: v })} label="Allow app viewers without integration access (needs Manage references; audited)" />
        </div>
      )
      break
    case "table_lookup":
      body = (
        <div className="space-y-1.5">
          <ObjectPicker app={ctx.app} kind="table" label="Data table" value={idOrNull(a.table_id)} onChange={(v) => set({ table_id: v ?? EMPTY_ID })} />
          <TemplateInput label="Row id" value={a.row_id ?? ""} onChange={(v) => set({ row_id: v || null })} placeholders={placeholders} placeholder="A row id (optional) — or filter below" />
          <L>Rows where</L>
          {a.filter
            ? <GroupEditor group={a.filter as DataTableConditionGroup} depth={0} columns={tableCols(a.table_id)} placeholders={placeholders} onChange={(g) => set({ filter: g ?? null })} />
            : <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => set({ filter: { match: "all", conditions: [{ column: tableCols(a.table_id)[0]?.value ?? "", operator: "eq", value: "" }] } })}><Plus size={11} /> Add a filter</button>}
          <div className="flex items-center gap-2"><L>At most</L><Input size="sm" type="number" min={1} max={50} className="w-20" aria-label="Limit" value={a.limit} onChange={(e) => set({ limit: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} /><span className="text-2xs text-fg-muted">1: the row itself; more: a list.</span></div>
        </div>
      )
      break
    case "table_create": case "table_update":
      body = (
        <div className="space-y-1.5">
          <ObjectPicker app={ctx.app} kind="table" label="Data table" value={idOrNull(a.table_id)} onChange={(v) => set({ table_id: v ?? EMPTY_ID })} />
          {a.type === "table_update" && <TemplateInput label="Row id" value={a.row_id} onChange={(v) => set({ row_id: v })} placeholders={placeholders} />}
          <L>Column values</L><KeyValues value={a.values} onChange={(values) => set({ values })} keyLabel="Column" placeholders={placeholders} keys={tableCols(a.table_id)} />
        </div>
      )
      break
    case "start_workflow":
      body = <div className="space-y-1.5"><ObjectPicker app={ctx.app} kind="workflow" label="Workflow" value={idOrNull(a.workflow_id)} onChange={(v) => set({ workflow_id: v ?? EMPTY_ID })} /><L>Inputs</L><KeyValues value={a.inputs} onChange={(inputs) => set({ inputs })} keyLabel="Input" placeholders={placeholders} /></div>
      break
    case "instance_read":
      body = (
        <div className="space-y-1.5">
          <Select size="sm" aria-label="Dataset" value={a.dataset} onChange={(e) => set({ dataset: e.target.value })} options={INSTANCE_DATASETS.map((d) => ({ value: d, label: d.replace(/_/g, " ") }))} />
          <L>Parameters (workspace_id, user_id, status, q, days, sort, dir, limit)</L><KeyValues value={a.params} onChange={(params) => set({ params })} keyLabel="Parameter" placeholders={placeholders} />
          <p className="text-2xs text-fg-muted">Only UserTasks instance admins get data; anyone else gets an access message.</p>
        </div>
      )
      break
    case "instance_action":
      body = (
        <div className="space-y-1.5">
          <Select size="sm" aria-label="Action" value={a.action} onChange={(e) => set({ action: e.target.value })} options={INSTANCE_ACTIONS.map((x) => ({ value: x, label: INSTANCE_ACTION_LABELS[x] }))} />
          <L>Inputs (reason is required; user_id, workspace_id, invitation_id, email, role, extension_id, days)</L><KeyValues value={a.inputs} onChange={(inputs) => set({ inputs })} keyLabel="Input" placeholders={placeholders} />
          <p className="text-2xs text-fg-muted">Instance admins only. Recorded in the instance admin trail and in the workspace’s own audit log as “UserTasks support (on behalf)”.</p>
        </div>
      )
      break
    default: body = null
  }
  const server = SERVER_ACTIONS.has(a.type)
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2" data-rule-action={a.type}>
      <div className="flex items-center gap-1">
        <span className="flex-1 text-xs font-semibold text-fg">{ACTION_LABELS[a.type]}{server && <span className="ml-1 rounded bg-subtle px-1 text-2xs font-normal text-fg-muted">server</span>}</span>
        {onMove && <><IconButton size="sm" label="Move up" icon={<ArrowUp />} onClick={() => onMove(-1)} /><IconButton size="sm" label="Move down" icon={<ArrowDown />} onClick={() => onMove(1)} /></>}
        <IconButton size="sm" label="Remove action" icon={<Trash2 />} onClick={onRemove} />
      </div>
      {body}
      {a.type !== "noop" && (
        <div className="grid grid-cols-2 gap-1">
          <Select size="sm" aria-label="Store the result in" value={a.result_var ?? ""} onChange={(e) => set({ result_var: e.target.value || null })} options={[{ value: "", label: "Don’t store the result" }, ...ctx.decls.variables.map((v) => ({ value: v.name, label: `Result → ${v.label || v.name}` }))]} />
          {!nested && <Select size="sm" aria-label="If it fails" value={a.on_error ?? "stop"} onChange={(e) => set({ on_error: e.target.value === "stop" ? undefined : e.target.value })} options={ON_ERROR.map((o) => ({ value: o, label: o === "stop" ? "If it fails: stop the rule" : o === "continue" ? "If it fails: continue" : "If it fails: run the on-error actions" }))} />}
        </div>
      )}
    </div>
  )
}

function ActionList({ list, onChange, ctx, placeholders, nested = false }: { list: RuleAction[]; onChange: (l: RuleAction[]) => void; ctx: Ctx; placeholders: Array<{ name: string; group: string; label?: string }>; nested?: boolean }) {
  return (
    <div className="space-y-1.5">
      {list.map((a, i) => (
        <ActionEditor key={i} action={a} ctx={ctx} placeholders={placeholders} nested={nested}
          onChange={(n) => onChange(list.map((x, j) => (j === i ? n : x)))}
          onRemove={() => onChange(list.filter((_, j) => j !== i))}
          onMove={(d) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x); onChange(n) }} />
      ))}
      <select aria-label="Add an action" className="w-full rounded-md border border-border bg-panel px-2 py-1 text-xs" value="" data-add-rule-action
        onChange={(e) => { const t = e.target.value as RuleActionType; if (t) onChange([...list, newAction(t, ctx)]) }}>
        <option value="">+ Add an action…</option>
        {ACTION_GROUPS.map((g) => <optgroup key={g.label} label={g.label}>{g.types.filter((t) => !(nested && t === "confirm")).map((t) => <option key={t} value={t}>{ACTION_LABELS[t]}</option>)}</optgroup>)}
      </select>
    </div>
  )
}

function RuleEditor({ rule, onChange, ctx, problems }: { rule: AppRule; onChange: (r: AppRule) => void; ctx: Ctx; problems: string[] }) {
  const w = rule.when
  const setWhen = (patch: Partial<AppRule["when"]>) => onChange({ ...rule, when: { ...w, ...patch } })
  const placeholders = scopePlaceholders(ctx.decls, ctx.filters, TRIGGER_PAYLOAD[w.type].filter((p) => !p.includes("<")))
  const subjects = placeholders.map((p) => ({ value: p.name, label: `${p.group}: ${p.label ?? p.name}` }))
  const widgetTypes = WIDGET_FOR[w.type]
  const btnWidget = w.widget ? ctx.widgets.find((x) => x.id === w.widget) : null
  const buttons = btnWidget && (btnWidget.type === "actions" || btnWidget.type === "tiles") ? ((btnWidget.config as { buttons?: Array<{ label: string }>; tiles?: Array<{ label: string }> }).buttons ?? (btnWidget.config as { tiles?: Array<{ label: string }> }).tiles ?? []) : []
  const rowActions = btnWidget?.type === "data_grid" ? ((btnWidget.config as { row_actions?: Array<{ label: string }> }).row_actions ?? []) : []
  return (
    <div className="space-y-3" data-rule-editor={rule.id}>
      {problems.map((p, i) => <p key={i} role="alert" className="flex items-start gap-1 text-2xs text-warning"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />{p}</p>)}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="space-y-0.5"><L>Name</L><Input size="sm" value={rule.name ?? ""} placeholder="e.g. Row clicked → check credit" onChange={(e) => onChange({ ...rule, name: e.target.value || null })} data-rule-name /></label>
        <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ ...rule, enabled: v })} label="On" />
      </div>
      <fieldset className="space-y-1.5 rounded-lg border border-border p-2">
        <legend className="px-1 text-2xs font-semibold text-primary-text">When</legend>
        <Select size="sm" aria-label="Trigger" value={w.type} data-rule-trigger onChange={(e) => onChange({ ...rule, when: { type: e.target.value as RuleTrigger, ...(e.target.value === "timer" ? { interval_s: 60 } : {}) } })}
          options={RULE_TRIGGERS.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))} />
        {widgetTypes && <Select size="sm" aria-label="Widget" value={w.widget ?? ""} onChange={(e) => setWhen({ widget: e.target.value || null, button: null })}
          options={[{ value: "", label: "Any widget" }, ...ctx.widgets.filter((x) => widgetTypes.includes(x.type)).map((x) => ({ value: x.id, label: `${x.title || catalogEntry(x.type).title} (${x.id})` }))]} />}
        {w.type === "button_click" && buttons.length > 0 && <Select size="sm" aria-label="Button" value={w.button === null || w.button === undefined ? "" : String(w.button)} onChange={(e) => setWhen({ button: e.target.value === "" ? null : Number(e.target.value) })} options={[{ value: "", label: "Any button" }, ...buttons.map((b, i) => ({ value: String(i), label: b.label }))]} />}
        {w.type === "row_action" && rowActions.length > 0 && <Select size="sm" aria-label="Row action" value={w.button === null || w.button === undefined ? "" : String(w.button)} onChange={(e) => setWhen({ button: e.target.value === "" ? null : Number(e.target.value) })} options={[{ value: "", label: "Any action" }, ...rowActions.map((a, i) => ({ value: String(i), label: a.label }))]} />}
        {w.type === "variable_changed" && <Select size="sm" aria-label="Parameter or variable" value={w.variable ?? ""} onChange={(e) => setWhen({ variable: e.target.value || null })}
          options={[{ value: "", label: "Any" }, ...ctx.decls.variables.map((v) => ({ value: `var.${v.name}`, label: `Variable: ${v.label || v.name}` })), ...ctx.decls.params.map((p) => ({ value: `param.${p.name}`, label: `Parameter: ${p.label || p.name}` }))]} />}
        {w.type === "filter_changed" && <Select size="sm" aria-label="Filter" value={w.filter ?? ""} onChange={(e) => setWhen({ filter: e.target.value || null })} options={[{ value: "", label: "Any filter" }, ...ctx.filters.map((f) => ({ value: f.id, label: f.label }))]} />}
        {w.type === "form_submitted" && <ObjectPicker app={ctx.app} kind="form" label="Form" value={w.form_id ?? null} clearLabel="Any form the app opened" onChange={(v) => setWhen({ form_id: v })} />}
        {w.type === "reference_returned" && <ObjectPicker app={ctx.app} kind="reference" label="API reference" value={w.reference_id ?? null} clearLabel="Any API reference" onChange={(v) => setWhen({ reference_id: v })} />}
        {w.type === "timer" && <div className="flex items-center gap-2"><L>Every</L><Input size="sm" type="number" min={30} max={3600} className="w-24" aria-label="Seconds" value={w.interval_s ?? 60} onChange={(e) => setWhen({ interval_s: Math.min(3600, Math.max(30, Number(e.target.value) || 30)) })} /><span className="text-2xs text-fg-muted">seconds (at least 30; only while the page is visible)</span></div>}
        <p className="text-2xs text-fg-muted">This event carries: {TRIGGER_PAYLOAD[w.type].map((p) => `{{${p}}}`).join(", ")}</p>
      </fieldset>
      <fieldset className="space-y-1.5 rounded-lg border border-border p-2">
        <legend className="px-1 text-2xs font-semibold text-primary-text">If</legend>
        {rule.if
          ? <GroupEditor group={rule.if as DataTableConditionGroup} depth={0} columns={subjects} placeholders={placeholders} onChange={(g) => onChange({ ...rule, if: (g ?? null) as AppRule["if"] })} />
          : <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => onChange({ ...rule, if: { match: "all", conditions: [{ column: subjects[0]?.value ?? "event.value", operator: "is_set" }] } })} data-rule-add-condition><Plus size={11} /> Add a condition (otherwise: always)</button>}
      </fieldset>
      <fieldset className="space-y-1.5 rounded-lg border border-border p-2">
        <legend className="px-1 text-2xs font-semibold text-primary-text">Then</legend>
        <ActionList list={rule.then} onChange={(then) => onChange({ ...rule, then })} ctx={ctx} placeholders={placeholders} />
        <p className="text-2xs text-fg-muted">Actions run in order. A later action reads the previous one’s result as {"{{result}}"} (e.g. {"{{result.name}}"}); store results in variables to use them anywhere. Server actions run from the saved page.</p>
      </fieldset>
      <details className="rounded-lg border border-border p-2">
        <summary className="cursor-pointer text-2xs font-semibold text-fg">On error ({rule.on_error_actions.length})</summary>
        <div className="mt-1.5 space-y-1"><p className="text-2xs text-fg-muted">Run when an action set to “run the on-error actions” fails ({"{{event.error.message}}"}).</p>
          <ActionList list={rule.on_error_actions} onChange={(l) => onChange({ ...rule, on_error_actions: l as LeafAction[] })} ctx={ctx} placeholders={[...placeholders, { name: "event.error.message", group: "Error", label: "Why it failed" }]} nested /></div>
      </details>
    </div>
  )
}

export function DebugPanel({ debug, onClear, onSimulate, rules }: { debug: DebugEntry[]; onClear: () => void; onSimulate?: (e: RuleEvent) => void; rules: AppRule[] }) {
  const [rule, setRule] = useState("")
  const [payload, setPayload] = useState('{ "row": { "id": "" } }')
  const [err, setErr] = useState<string | null>(null)
  const chosen = rules.find((r) => r.id === rule) ?? rules[0]
  const simulate = () => {
    if (!chosen || !onSimulate) return
    let p: Record<string, unknown> = {}
    try { p = payload.trim() ? JSON.parse(payload) : {} } catch { setErr("The sample payload isn’t valid JSON"); return }
    setErr(null)
    const w = chosen.when
    onSimulate({ type: w.type, widget: w.widget ?? null, button: w.button ?? null, variable: w.variable ?? null, filter: w.filter ?? null, form_id: w.form_id ?? null, reference_id: w.reference_id ?? null, payload: p })
  }
  return (
    <section className="space-y-2" aria-label="Rule debug" data-rule-debug>
      <div className="flex items-center gap-2"><Bug className="size-4 text-fg-muted" aria-hidden /><h3 className="flex-1 text-sm font-semibold text-fg">Debug</h3><Button size="sm" variant="ghost" onClick={onClear}>Clear</Button></div>
      {onSimulate && rules.length > 0 && (
        <div className="space-y-1 rounded-md border border-border p-2">
          <L>Run with a sample event</L>
          <Select size="sm" aria-label="Rule to trigger" value={chosen?.id ?? ""} onChange={(e) => setRule(e.target.value)} options={rules.map((r) => ({ value: r.id, label: `${r.name || r.id}: ${describeTrigger(r.when)}` }))} />
          <Textarea rows={2} aria-label="Sample event payload (JSON)" value={payload} onChange={(e) => setPayload(e.target.value)} className="font-mono text-2xs" />
          {err && <p role="alert" className="text-2xs text-danger">{err}</p>}
          <Button size="sm" variant="secondary" leadingIcon={<Play />} onClick={simulate} data-rule-simulate>Run</Button>
        </div>
      )}
      <ol className="max-h-72 space-y-0.5 overflow-y-auto font-mono text-2xs" data-rule-debug-log>
        {debug.map((e, i) => (
          <li key={i} style={{ paddingLeft: e.depth * 12 }} className={cn(e.kind === "error" ? "text-danger" : e.kind === "skipped" ? "text-warning" : e.kind === "event" ? "font-semibold text-fg" : "text-fg-muted")}>
            <span className="text-fg-subtle">{e.at.slice(11, 19)}</span> {e.kind === "event" ? "▶" : e.kind === "condition" ? "?" : e.kind === "action" ? "✓" : "!"} {e.text}{e.path ? ` [${e.path}]` : ""}
            {e.data !== undefined && e.data !== null && (Array.isArray(e.data) ? e.data.length > 0 : true) && <details className="ml-4"><summary className="cursor-pointer">data</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(e.data, null, 1).slice(0, 2000)}</pre></details>}
          </li>
        ))}
        {!debug.length && <li className="text-fg-muted">Interact with the preview (click rows, buttons, change filters) or run a sample event — events, conditions and action results show here.</li>}
      </ol>
    </section>
  )
}

export function RulesDialog({ open, onOpenChange, rules, onChange, app, widgets, filters, decls, debug, onClearDebug, onSimulate, onAppSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void
  rules: AppRule[]; onChange: (r: AppRule[]) => void
  app: AppDetail; widgets: AppWidget[]; filters: readonly PageFilter[]; decls: AppDecls
  debug: DebugEntry[]; onClearDebug: () => void; onSimulate?: (e: RuleEvent) => void; onAppSaved: () => void
}) {
  const [scope, setScope] = useState<"page" | "app">("page")
  const [pageDraft, setPageDraft] = useState(rules)
  const [appDraft, setAppDraft] = useState(app.rules ?? [])
  const [sel, setSel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) { setWasOpen(open); if (open) { setPageDraft(rules); setAppDraft(app.rules ?? []); setError(null) } }
  const pickers = useQuery({ queryKey: ["apps", "pickers", app.id], enabled: open, staleTime: 60_000, queryFn: async () => (await serverQuery("apps.pickers", { app: app.id })) as { tables: Ctx["tables"] } })
  const list = scope === "page" ? pageDraft : appDraft
  const setList = scope === "page" ? setPageDraft : setAppDraft
  const current = list.find((r) => r.id === sel) ?? list[0] ?? null
  const ctx: Ctx = { app: app.id, widgets: scope === "page" ? widgets : [], filters: scope === "page" ? filters : [], pages: app.pages.map((p) => ({ slug: p.slug, title: p.title })), decls, tables: pickers.data?.tables ?? [] }
  const problems = useMemo(() => ruleProblems(list, {
    params: decls.params.map((p) => p.name), vars: decls.variables.map((v) => v.name), filters: ctx.filters.map((f) => f.id),
    widgets: new Map(ctx.widgets.map((w) => [w.id, { type: w.type }])), pages: ctx.pages.map((p) => p.slug),
  }).filter((p) => scope === "page" || !/is not on this page/.test(p.message)), [list, decls, ctx.filters, ctx.widgets, ctx.pages, scope])
  const add = () => {
    const id = newRuleId(list.map((r) => r.id))
    setList([...list, { id, name: null, enabled: true, when: { type: "page_loaded" }, then: [], on_error_actions: [] }])
    setSel(id)
  }
  const apply = async () => {
    setError(null)
    if (JSON.stringify(appDraft) !== JSON.stringify(app.rules ?? [])) {
      setBusy(true)
      const r = await updateApp(app.id, { rules: appDraft })
      setBusy(false)
      if (!r.ok) { setError(r.error); return }
      onAppSaved()
    }
    onChange(pageDraft)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" title="App rules" description="When something happens on the page, if conditions hold, then run actions in order — set variables, open forms and pages passing values, call API references, look up and update data tables, start workflows.">
        <DialogBody>
          <AppDeclsProvider value={decls}>
          <div className="mb-2 flex gap-1" role="tablist">
            {(["page", "app"] as const).map((s) => <Button key={s} role="tab" aria-selected={scope === s} size="sm" variant={scope === s ? "primary" : "ghost"} onClick={() => { setScope(s); setSel(null) }}>{s === "page" ? `This page (${pageDraft.length})` : `Whole app (${appDraft.length})`}</Button>)}
          </div>
          <div className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
            <aside className="space-y-1" aria-label="Rules" data-rule-list>
              {list.map((r, i) => (
                <div key={r.id} className={cn("group rounded-md border px-2 py-1.5 text-left", current?.id === r.id ? "border-primary bg-primary-wash" : "border-border hover:bg-subtle", !r.enabled && "opacity-60")}>
                  <button type="button" className="block w-full text-left" onClick={() => setSel(r.id)} data-rule-item={r.id}>
                    <span className="block truncate text-xs font-medium text-fg">{r.name || r.id}</span>
                    <span className="block truncate text-2xs text-fg-muted">{describeTrigger(r.when)} → {r.then.map(describeAction).join("; ") || "no actions"}</span>
                  </button>
                  <div className="mt-0.5 flex gap-0.5">
                    <IconButton size="sm" label="Move up" icon={<ArrowUp />} disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setList(n) }} />
                    <IconButton size="sm" label="Move down" icon={<ArrowDown />} disabled={i === list.length - 1} onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; setList(n) }} />
                    <IconButton size="sm" label="Duplicate rule" icon={<Copy />} onClick={() => { const id = newRuleId(list.map((x) => x.id)); setList([...list, { ...structuredClone(r), id, name: `${r.name || r.id} (copy)` }]); setSel(id) }} />
                    <IconButton size="sm" label="Delete rule" icon={<Trash2 />} onClick={() => setList(list.filter((x) => x.id !== r.id))} />
                  </div>
                </div>
              ))}
              {!list.length && <p className="text-xs text-fg-muted">No rules yet.</p>}
              <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={add} disabled={list.length >= 50} data-add-rule>Add rule</Button>
            </aside>
            <div className="min-w-0">
              {current
                ? <RuleEditor key={`${scope}:${current.id}`} rule={current} ctx={ctx} problems={problems.filter((p) => p.rule === current.id).map((p) => `${p.path ? `${p.path}: ` : ""}${p.message}`)} onChange={(n) => setList(list.map((r) => (r.id === current.id ? n : r)))} />
                : <p className="text-sm text-fg-muted">Add a rule: for example “List / grid row clicked → set rowId = {"{{event.row.id}}"} → look up the customer → call the credit check → open the form in a slide-in panel with both passed”.</p>}
            </div>
            <DebugPanel debug={debug} onClear={onClearDebug} onSimulate={scope === "page" ? onSimulate : undefined} rules={scope === "page" ? pageDraft : []} />
          </div>
          </AppDeclsProvider>
          {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-2xs text-fg-muted">Page rules are saved with the page; app rules when you apply.</span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={() => void apply()} data-apply-rules>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { useAppDecls }
