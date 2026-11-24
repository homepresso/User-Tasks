"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, Search, SlidersHorizontal, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/input"
import { ProgressBar } from "@/components/ui/progress-bar"
import { deleteGridRows, deleteGridView, listGridViews, saveGridView, updateGridRow } from "@/app/actions/apps"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { unwrapAction } from "@/lib/action-result"
import { MAX_VIEW_FILTERS, nextSort, stateParams, type GridState, type GridView } from "@/lib/apps/grid-views"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Popover } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { rowActionEvents } from "@/lib/apps/events"
import { useAppRuntime } from "../runtime"
import { formatCount } from "@/lib/format/number"
import type { AppWidget, CardAction, ColumnFormat, WidgetConfig } from "@/lib/apps/schema"
import { formatColumnValue } from "@/lib/apps/field-format"
import { RowChangeList } from "@/components/data/change-history"
import type { Card } from "@/lib/services/app-card-sources"
import { resolveParams } from "@/lib/apps/params"
import { cn } from "@/lib/utils"
import { appIcon } from "../app-icon"
import { useOpenTarget } from "../panels"
import { useValueColors } from "../widget-style"
import { Empty, TONE, WidgetError, WidgetSkeleton, isActive, useClickThrough, useRefreshWidgets, useWidgetData, type DataOf, type WidgetContext } from "./kit"

/** Data grid (editable for contributors with Manage rows), record card, filtered list and card view. */

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.map(cellText).join(", ")
  if (typeof value === "object") { const v = value as Record<string, unknown>; return String(v.label ?? v.name ?? v.display_name ?? v.email ?? v.value ?? "") }
  return String(value)
}

/* ── Data grid ───────────────────────────────────────────────────────── */

/** A grid cell / record field as shown: through its column format (lib/apps/field-format.ts), else as written. */
function FormattedValue({ column, raw, format, label }: { column: { key: string; currency?: string | null }; raw: unknown; format: ColumnFormat | undefined; label: string }) {
  const f = formatColumnValue(column.key, raw, format, column)
  if (!f) return <>{cellText(raw)}</>
  if (f.progress !== undefined) return <span className="flex items-center gap-1.5" data-grid-progress><ProgressBar value={f.progress * 100} size="sm" label={label} className="min-w-12 flex-1" /><span className="num shrink-0">{f.value}</span></span>
  return <>{f.value}</>
}

export function DataGridWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const formats = (widget.config as WidgetConfig<"data_grid">).formats ?? {}
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  // The viewer's sort (header click), columns and filters — the state a saved view captures (lib/apps/grid-views.ts).
  const [order, setOrder] = useState<{ sort: string | null; dir: "asc" | "desc" }>({ sort: null, dir: "asc" })
  const [cols, setCols] = useState<string[] | null>(null)
  const [eq, setEq] = useState<Array<{ column: string; value: string }>>([])
  const search = useDebounced(q)
  const query = useWidgetData(widget, context, { ...(search ? { q: search } : {}), page, ...stateParams({ ...order, search, columns: cols, filters: eq }) })
  const refresh = useRefreshWidgets(context.app)
  const rowClick = useClickThrough(context, null, "row_click", widget.id)
  const [editing, setEditing] = useState<{ row: string; key: string; value: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const runtime = useAppRuntime()
  const data = query.data as DataOf<"data_grid"> | undefined
  const groups = useMemo(() => {
    if (!data || data.type !== "data_grid" || !data.group_by) return null
    const out = new Map<string, typeof data.rows>()
    for (const r of data.rows) { const k = cellText(r.data[data.group_by]) || "(blank)"; out.set(k, [...(out.get(k) ?? []), r]) }
    return [...out.entries()]
  }, [data])
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  if (!data || data.type !== "data_grid") return <Empty text={(query.data as { reason?: string })?.reason ?? "No data."} />
  const save = async () => {
    if (!editing) return
    const col = data.columns.find((c) => c.key === editing.key)
    const value = col?.type === "number" ? (editing.value === "" ? null : Number(editing.value)) : col?.type === "boolean" ? editing.value === "true" : editing.value
    setSaving(true); setError(null)
    const r = await updateGridRow({ app: context.app, page: context.page, widget_id: widget.id, row_id: editing.row, cells: { [editing.key]: value }, ...(context.previewArgs ?? {}) })
    setSaving(false)
    if (!r.ok) { setError(r.error); return }
    setEditing(null)
    await refresh()
  }
  const pages = Math.max(1, Math.ceil(data.total / data.page_size))
  // Bulk selection (this page's rows): delete, and the grid's row actions (rules run once per row).
  const rowActions = runtime ? (data.row_actions ?? []) : []
  const selectable = !!data.can_delete || rowActions.length > 0
  const pageIds = data.rows.map((r) => r.id)
  const chosen = pageIds.filter((id) => selected.has(id))
  const allChosen = pageIds.length > 0 && chosen.length === pageIds.length
  const rowRecord = (r: (typeof data.rows)[number]) => ({ id: r.id, ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, cellText(v)])) })
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const deleteChosen = async () => {
    setBulkBusy(true); setError(null)
    const r = await deleteGridRows({ app: context.app, page: context.page, widget_id: widget.id, row_ids: chosen, ...(context.previewArgs ?? {}) })
    setBulkBusy(false); setConfirmDelete(false)
    if (!r.ok) { setError(r.error); return }
    setSelected(new Set())
    setNotice(`${formatCount(chosen.length)} ${chosen.length === 1 ? "row" : "rows"} deleted`)
    await refresh()
  }
  const runRowAction = async (index: number, label: string) => {
    if (!runtime) return
    const rows = data.rows.filter((r) => selected.has(r.id)).map(rowRecord)
    setBulkBusy(true); setError(null)
    try { for (const e of rowActionEvents(widget.id, index, label, rows)) await runtime.raise(e) } catch (e) { setError(e instanceof Error ? e.message : "The action didn’t finish") }
    setBulkBusy(false)
    setNotice(`${label}: ${formatCount(rows.length)} ${rows.length === 1 ? "row" : "rows"}`)
    await refresh()
  }
  const row = (r: (typeof data.rows)[number]) => (
    <tr key={r.id} className={cn("border-b border-border-subtle", rowClick && !data.editable && "cursor-pointer hover:bg-subtle", selected.has(r.id) && "bg-primary-wash")} data-grid-row={r.id} data-selected={selected.has(r.id) || undefined}
      onClick={rowClick && !editing ? (e) => { if ((e.target as HTMLElement).closest("button, input, select, a, label")) return; rowClick(r.id, rowRecord(r)) } : undefined}>
      {selectable && <td className="w-8 px-2 py-1"><Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select row ${cellText(r.data[data.columns[0]?.key ?? ""]) || r.id}`} data-grid-select={r.id} /></td>}
      {data.columns.map((c) => {
        const isEditing = editing?.row === r.id && editing.key === c.key
        return (
          <td key={c.key} className={cn("max-w-64 px-2 py-1 text-fg", (c.type === "number" || c.type === "currency") && "num text-right", formats[c.key]?.format === "progress" && "min-w-32 text-left")}>
            {isEditing ? (
              c.options?.length || c.type === "boolean" ? (
                <select autoFocus className="w-full rounded border border-border bg-panel px-1 text-sm" value={editing.value} disabled={saving}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={() => void save()} onKeyDown={(e) => { if (e.key === "Escape") setEditing(null) }} aria-label={c.label}>
                  {(c.type === "boolean" ? ["true", "false"] : ["", ...(c.options ?? [])]).map((o) => <option key={o} value={o}>{c.type === "boolean" ? (o === "true" ? "Yes" : "No") : o || "—"}</option>)}
                </select>
              ) : (
                <input autoFocus type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} className="w-full rounded border border-border bg-panel px-1 text-sm" value={editing.value} disabled={saving}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })} aria-label={c.label}
                  onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(null) }} onBlur={() => void save()} />
              )
            ) : data.editable && !["file", "lookup"].includes(c.type) ? (
              <button type="button" className="block w-full truncate rounded px-0.5 text-left hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]" aria-label={`Edit ${c.label}: ${cellText(r.data[c.key]) || "empty"}`}
                onClick={() => setEditing({ row: r.id, key: c.key, value: c.type === "boolean" ? String(!!r.data[c.key]) : cellText(r.data[c.key]) })} data-grid-cell={`${r.id}:${c.key}`}>
                {cellText(r.data[c.key]) ? <FormattedValue column={c} raw={r.data[c.key]} format={formats[c.key]} label={c.label} /> : <span className="text-fg-subtle">—</span>}
              </button>
            ) : <span className="block truncate"><FormattedValue column={c} raw={r.data[c.key]} format={formats[c.key]} label={c.label} /></span>}
          </td>
        )
      })}
    </tr>
  )
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-widget-data-grid data-editable={data.editable || undefined}>
      <div className="flex items-center gap-2">
        <SearchInput value={q} onValueChange={(v) => { setQ(v); setPage(0) }} placeholder={`Search ${data.table.name}…`} size="sm" aria-label={`Search ${data.table.name}`} className="max-w-xs" />
        {data.editable && <span className="text-2xs text-fg-muted">Click a cell to edit</span>}
        {data.personal_views && <GridViews widget={widget} context={context} columns={data.grid_columns} state={{ ...order, sort: order.sort, search: q, columns: cols, filters: eq }}
          apply={(v) => { setOrder({ sort: v.sort ?? null, dir: v.dir ?? "asc" }); setQ(v.search ?? ""); setCols(v.columns?.length ? v.columns : null); setEq(v.filters ?? []); setPage(0) }} />}
        {data.source !== "instance" && <Link href={`/data/${data.table.id}`} target={context.embed ? "_blank" : undefined} className="ml-auto inline-flex items-center gap-1 text-xs text-primary-text hover:underline">Open table <ExternalLink className="size-3" aria-hidden /></Link>}
        {data.note && <span className="ml-auto text-2xs text-warning" role="status">{data.note}</span>}
      </div>
      {selectable && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-primary-wash px-2 py-1" data-grid-bulk-bar>
          <span className="num mr-1 text-xs font-medium text-primary-text">{formatCount(chosen.length)} selected</span>
          {rowActions.map((a, i) => <Button key={i} size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void runRowAction(i, a.label)} data-grid-row-action={i}>{a.label}</Button>)}
          {data.can_delete && <Button size="sm" variant="danger-ghost" disabled={bulkBusy} onClick={() => setConfirmDelete(true)} data-grid-bulk-delete>Delete</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" disabled={bulkBusy} onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {notice && !chosen.length && <p role="status" className="text-xs text-fg-muted">{notice}</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {!data.rows.length ? <Empty text={search ? "No rows match." : `No rows in ${data.table.name} yet.`} /> : (
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          <table className="w-full text-sm">
            <caption className="sr-only">{data.table.name}</caption>
            <thead className="sticky top-0 z-[1] bg-panel"><tr>{selectable && <th scope="col" className="w-8 border-b border-border px-2 py-1.5"><Checkbox checked={allChosen} ref={(el) => { if (el) el.indeterminate = chosen.length > 0 && !allChosen }} onChange={() => setSelected(allChosen ? new Set() : new Set(pageIds))} aria-label={allChosen ? "Clear the selection" : "Select every row on this page"} data-grid-select-all /></th>}{data.columns.map((c) => {
              const dir = data.sort === c.key ? data.dir : null
              return (
                <th key={c.key} scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} className="whitespace-nowrap border-b border-border px-1 py-1 text-left text-xs font-medium text-fg-muted">
                  <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]" data-grid-sort={c.key}
                    onClick={() => { setOrder(nextSort({ sort: data.sort ?? null, dir: data.dir ?? "asc" }, c.key)); setPage(0) }} title={`Sort by ${c.label}`}>
                    {c.label}{dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : null}
                  </button>
                </th>
              )
            })}</tr></thead>
            <tbody>
              {groups ? groups.map(([g, rows]) => (
                <GroupRows key={g} label={g} count={rows.length} span={data.columns.length + (selectable ? 1 : 0)} collapsed={collapsed.has(g)}
                  onToggle={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n })}>
                  {rows.map(row)}
                </GroupRows>
              )) : data.rows.map(row)}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{formatCount(data.total)} rows{data.truncated ? " (searching the newest)" : ""}</span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="num">{page + 1} / {pages}</span>
            <Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        )}
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} destructive busy={bulkBusy}
        title={`Delete ${formatCount(chosen.length)} ${chosen.length === 1 ? "row" : "rows"}?`}
        description={`The selected rows are deleted from ${data.table.name} for everyone.`}
        confirmLabel="Delete rows" onConfirm={deleteChosen} />
    </div>
  )
}

type ViewPatch = { sort?: string | null; dir?: "asc" | "desc"; search?: string | null; columns?: string[] | null; filters?: Array<{ column: string; value: string }> }

/** A grid's personal saved views: pick one, save the current sort / search / columns / filters under a name, delete. */
function GridViews({ widget, context, columns, state, apply }: { widget: AppWidget; context: WidgetContext; columns: ReadonlyArray<{ key: string; label: string }>; state: GridState; apply: (v: ViewPatch) => void }) {
  const ref = { app: context.app, page: context.page, widget_id: widget.id, ...(context.previewArgs ?? {}) }
  const key = ["apps", "gridViews", context.app, context.page, widget.id]
  const client = useQueryClient()
  const views = useQuery({ queryKey: key, queryFn: async () => unwrapAction(await listGridViews(ref)).views, staleTime: 60_000, retry: false })
  const [active, setActive] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = views.data ?? []
  const shown = state.columns ?? columns.map((c) => c.key)
  const done = (r: { ok: true; data: { views: GridView[] } } | { ok: false; error: string }) => { setBusy(false); if (!r.ok) { setError(r.error); return false } setError(null); client.setQueryData(key, r.data.views); return true }
  const save = async () => {
    const label = name.trim() || list.find((v) => v.id === active)?.name || ""
    if (!label) { setError("Name the view"); return }
    setBusy(true)
    const id = list.find((v) => v.name.toLowerCase() === label.toLowerCase())?.id ?? `v-${Date.now().toString(36)}`
    const view: GridView = { id, name: label, ...(state.sort ? { sort: state.sort, dir: state.dir } : {}), ...(state.search.trim() ? { search: state.search.trim() } : {}), ...(state.columns?.length ? { columns: state.columns } : {}), ...(state.filters.length ? { filters: state.filters } : {}) }
    if (done(await saveGridView({ ...ref, view }))) { setActive(id); setName("") }
  }
  const remove = async () => { if (!active) return; setBusy(true); if (done(await deleteGridView({ ...ref, id: active }))) { setActive(""); apply({}) } }
  return (
    <div className="flex items-center gap-1" data-grid-views>
      <Select size="sm" aria-label="Saved view" className="w-40" value={active}
        onChange={(e) => { const v = list.find((x) => x.id === e.target.value); setActive(e.target.value); apply(v ?? {}) }}
        options={[{ value: "", label: "All rows" }, ...list.map((v) => ({ value: v.id, label: v.name }))]} />
      <Popover width={300} aria-label="Customize the view" trigger={(p) => <Button {...p} size="sm" variant="ghost" leadingIcon={<SlidersHorizontal />} data-grid-view-open>View</Button>}>
        <div className="space-y-2 p-2 text-sm" data-grid-view-editor>
          <fieldset className="space-y-1"><legend className="text-xs font-medium text-fg">Columns</legend>
            {columns.map((c) => <label key={c.key} className="flex items-center gap-2"><Checkbox checked={shown.includes(c.key)} onChange={() => { const next = shown.includes(c.key) ? shown.filter((k) => k !== c.key) : columns.map((x) => x.key).filter((k) => k === c.key || shown.includes(k)); apply({ ...state, columns: next.length && next.length < columns.length ? next : null }) }} />{c.label}</label>)}
          </fieldset>
          <fieldset className="space-y-1"><legend className="text-xs font-medium text-fg">Only rows where</legend>
            {state.filters.map((f, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <Select size="sm" aria-label="Column" value={f.column} options={columns.map((c) => ({ value: c.key, label: c.label }))} onChange={(e) => apply({ ...state, filters: state.filters.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)) })} />
                <Input size="sm" aria-label="Equals" value={f.value} onChange={(e) => apply({ ...state, filters: state.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <IconButtonLite label="Remove the condition" onClick={() => apply({ ...state, filters: state.filters.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {state.filters.length < MAX_VIEW_FILTERS && columns.length > 0 && <Button size="sm" variant="ghost" onClick={() => apply({ ...state, filters: [...state.filters, { column: columns[0].key, value: "" }] })}>Add a condition</Button>}
          </fieldset>
          <div className="flex items-center gap-1 border-t border-border-subtle pt-2">
            <Input size="sm" aria-label="View name" placeholder={list.find((v) => v.id === active)?.name ?? "View name"} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void save()} data-grid-view-save>Save view</Button>
          </div>
          {active && <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} disabled={busy} onClick={() => void remove()}>Delete this view</Button>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <p className="text-2xs text-fg-muted">Views are yours: nobody else sees them.</p>
        </div>
      </Popover>
    </div>
  )
}

function IconButtonLite({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-7 items-center justify-center rounded text-fg-muted hover:bg-subtle hover:text-fg"><Trash2 className="size-3.5" aria-hidden /></button>
}

function GroupRows({ label, count, span, collapsed, onToggle, children }: { label: string; count: number; span: number; collapsed: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-subtle">
        <td colSpan={span} className="px-2 py-1">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-fg" aria-expanded={!collapsed} onClick={onToggle}>
            {collapsed ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}{label} <span className="num text-fg-muted">({count})</span>
          </button>
        </td>
      </tr>
      {!collapsed && children}
    </>
  )
}

/* ── Record card ─────────────────────────────────────────────────────── */

export function RecordCardWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const formats = (widget.config as WidgetConfig<"record_card">).formats ?? {}
  const query = useWidgetData(widget, context)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"record_card">
  if (d.type !== "record_card") return <Empty text={(query.data as { reason?: string }).reason ?? "No data."} />
  if (!d.row) return <Empty text="Choose a record (a fixed row id, or a page filter that holds one)." />
  return (
    <div className="space-y-3">
    <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm" data-widget-record>
      {d.columns.map((c) => <div key={c.key} className="contents"><dt className="text-fg-muted">{c.label}</dt><dd className="min-w-0 break-words text-fg">{cellText(d.row!.data[c.key]) ? <FormattedValue column={c} raw={d.row!.data[c.key]} format={formats[c.key]} label={c.label} /> : "—"}</dd></div>)}
    </dl>
    {d.history && (
      <section className="space-y-1.5 border-t border-border-subtle pt-2" aria-label="Change history" data-record-history>
        <h4 className="text-xs font-semibold text-fg">Change history</h4>
        <RowChangeList changes={d.history} />
      </section>
    )}
    </div>
  )
}

/* ── Filtered list ───────────────────────────────────────────────────── */

export function FilteredListWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"filtered_list">
  const [q, setQ] = useState("")
  const search = useDebounced(q)
  const query = useWidgetData(widget, context, search ? { q: search } : {})
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"filtered_list">
  if (d.type !== "filtered_list") return <Empty text={(query.data as { reason?: string }).reason ?? "No data."} />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5" data-widget-filtered-list>
      {c.show_search && <SearchInput value={q} onValueChange={setQ} placeholder="Search…" size="sm" aria-label={`Search ${d.table.name}`} />}
      {!d.items.length ? <Empty text="Nothing matches." /> : (
        <ul className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto scrollbar-thin">
          {d.items.map((i) => {
            const active = i.value ? isActive(context, c.click, i.value) : false
            const body = <><span className="block truncate text-sm font-medium text-fg">{i.title}</span>{i.subtitle && <span className="block truncate text-xs text-fg-muted">{i.subtitle}</span>}</>
            return (
              <li key={i.id}>
                {click && (i.value || !c.click) ? <button type="button" onClick={() => click(i.value ?? i.id, { id: String(i.id), title: i.title, ...(i.subtitle ? { subtitle: i.subtitle } : {}), ...(i.value ? { value: i.value } : {}) })} aria-pressed={active} className={cn("block w-full px-1 py-1.5 text-left hover:bg-subtle", active && "bg-primary-wash")} data-click-value={i.value ?? i.id}>{body}</button> : <div className="px-1 py-1.5">{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-2xs text-fg-subtle">{formatCount(d.items.length)} of {formatCount(d.total)}</p>
    </div>
  )
}

/* ── Card view ───────────────────────────────────────────────────────── */

const CARD_COLS = { sm: "grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]", md: "grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]", lg: "grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]" } as const

export function CardViewWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"card_view">
  const [q, setQ] = useState("")
  const [page, setPage] = useState(0)
  const [cards, setCards] = useState<Card[]>([])
  const [detail, setDetail] = useState<Card | null>(null)
  const search = useDebounced(q)
  // A new search or filter starts again at the first page.
  const scope = JSON.stringify([search, context.filters])
  const [scopeSeen, setScopeSeen] = useState(scope)
  if (scope !== scopeSeen) { setScopeSeen(scope); setPage(0) }
  const query = useWidgetData(widget, context, { ...(search ? { q: search } : {}), page })
  const click = useClickThrough(context, c.click, "card_click", widget.id)
  const valueColors = useValueColors()
  const opener = useOpenTarget()
  const d = query.data as DataOf<"card_view"> | undefined
  // "Load more": pages accumulate (adjusted while rendering when a new page arrives).
  const [seen, setSeen] = useState<unknown>(null)
  if (d && d !== seen && d.type === "card_view") {
    setSeen(d)
    setCards((prev) => (d.page === 0 ? d.cards : [...prev.filter((p) => !d.cards.some((x) => x.id === p.id)), ...d.cards]))
  }
  if (query.isPending && !cards.length) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  if (d && d.type !== "card_view") return <Empty text={(query.data as { reason?: string }).reason ?? "No data."} />
  const runAction = (a: CardAction, card: Card) => {
    switch (a.kind) {
      case "detail": setDetail(card); return
      case "open_page": opener?.open({ t: "page", slug: a.page_slug, filters: card.values[a.value_key] ? { [a.filter]: card.values[a.value_key] } : {} }, { mode: "navigate", width: "md", motion: "auto" }, a.label); return
      case "open_url": {
        const url = a.url.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, k: string) => encodeURIComponent(card.values[k] ?? ""))
        if (/^(https:\/\/|\/(?!\/))/i.test(url)) window.open(url, "_blank", "noopener,noreferrer")
        return
      }
      case "start_workflow": opener?.open({ t: "workflow", id: a.workflow_id }, { mode: "modal", width: "md", motion: "auto" }, a.label); return
      case "open_form": {
        // The card's values feed the form's parameters (and prefill mapped fields).
        const params = { ...Object.fromEntries(a.prefill.map((p) => [p.field, card.values[p.key] ?? ""]).filter(([, v]) => v)), ...resolveParams(a.params, { filters: context.filters, app: context.appSlug, page: context.page, event: card.values }) }
        opener?.open({ t: "form", id: a.form_id, ...(Object.keys(params).length ? { params } : {}) }, { mode: "panel_right", width: "md", motion: "auto" }, a.label)
        return
      }
    }
  }
  const layout = c.layout === "grid" ? cn("grid auto-rows-max content-start gap-2", CARD_COLS[c.card_size]) : c.layout === "list" ? "flex flex-col gap-2" : "flex flex-col divide-y divide-border-subtle"
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-widget-card-view={c.source}>
      {c.show_search && (
        <div className="relative">
          <SearchInput value={q} onValueChange={setQ} placeholder="Search cards…" size="sm" aria-label="Search cards" />
        </div>
      )}
      {!cards.length ? <Empty text={c.empty_text || (search ? "No cards match." : "Nothing to show yet.")} icon={search ? <Search className="size-5 text-fg-subtle" aria-hidden /> : undefined} /> : (
        <ul className={cn("min-h-0 flex-1 overflow-y-auto scrollbar-thin", layout)} aria-label={widget.title || "Cards"}>
          {cards.map((card) => {
            const value = c.click_key ? card.values[c.click_key] : !c.click?.filter && !c.click?.page ? card.id : undefined
            const active = value ? isActive(context, c.click, value) : false
            return (
              <li key={card.id} className={cn(c.layout === "compact" ? "flex items-center gap-2 py-1.5" : "flex flex-col overflow-hidden rounded-lg border border-border bg-panel", active && "ring-2 ring-[var(--theme-primary)]")} data-card={card.id}>
                {card.image && c.template.image_style === "cover" && c.layout !== "compact" && (
                  // eslint-disable-next-line @next/next/no-img-element -- template image from the record (https only)
                  <img src={card.image} alt="" className={cn("w-full object-cover", c.card_size === "sm" ? "h-20" : c.card_size === "lg" ? "h-40" : "h-28")} loading="lazy" referrerPolicy="no-referrer" />
                )}
                <div className={cn("flex min-w-0 flex-1 gap-2", c.layout === "compact" ? "items-center" : "p-3")}>
                  {card.image && (c.template.image_style === "avatar" || c.layout === "compact") && (
                    // eslint-disable-next-line @next/next/no-img-element -- template image from the record (https only)
                    <img src={card.image} alt="" className="size-9 shrink-0 rounded-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      {click && value
                        ? <button type="button" className="min-w-0 truncate text-left text-sm font-semibold text-fg hover:underline" onClick={() => click(value, { ...card.values, id: card.id, title: card.title })} aria-pressed={active} data-click-value={value}>{card.title}</button>
                        : <h3 className="min-w-0 truncate text-sm font-semibold text-fg">{card.title}</h3>}
                      {card.badge && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", !valueColors[card.badge.toLowerCase()] && TONE[card.badge_tone])} style={valueColors[card.badge.toLowerCase()] ? { color: valueColors[card.badge.toLowerCase()], background: `color-mix(in oklab, ${valueColors[card.badge.toLowerCase()]} 14%, transparent)` } : undefined}>{card.badge}</span>}
                    </div>
                    {card.subtitle && <p className="truncate text-xs text-fg-muted">{card.subtitle}</p>}
                    {card.description && c.layout !== "compact" && <p className="line-clamp-3 text-xs text-fg">{card.description}</p>}
                    {card.fields.length > 0 && c.layout !== "compact" && (
                      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                        {card.fields.map((f, i) => {
                          const Icon = f.icon ? appIcon(f.icon) : null
                          return <div key={i} className="contents"><dt className="flex items-center gap-1 text-fg-muted">{Icon && <Icon className="size-3" aria-hidden />}{f.label}</dt><dd className="num truncate text-fg">{f.progress !== undefined ? <span className="flex items-center gap-1.5" data-card-progress><ProgressBar value={f.progress * 100} size="sm" label={f.label} className="min-w-12 flex-1" /><span className="shrink-0">{f.value}</span></span> : f.value}</dd></div>
                        })}
                      </dl>
                    )}
                  </div>
                </div>
                {(card.footer || c.actions.length > 0) && c.layout !== "compact" && (
                  <div className="flex flex-wrap items-center gap-1 border-t border-border-subtle px-3 py-1.5">
                    {card.footer && <span className="mr-auto truncate text-2xs text-fg-muted">{card.footer}</span>}
                    {c.actions.map((a, i) => <Button key={i} size="sm" variant={i === 0 ? "secondary" : "ghost"} onClick={() => runAction(a, card)} data-card-action={a.kind}>{a.label}</Button>)}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex items-center justify-between text-2xs text-fg-subtle">
        <span>{d ? `${formatCount(cards.length)} of ${formatCount(d.total)}` : ""}{d?.cached ? " · cached" : ""}</span>
        {d?.next !== null && d?.next !== undefined && <Button size="sm" variant="ghost" loading={query.isFetching} onClick={() => setPage(d.next!)} data-card-more>Load more</Button>}
      </div>
      {detail && (
        <div role="dialog" aria-modal aria-label={detail.title} className="fixed inset-0 z-[950] flex justify-end bg-black/40" onClick={() => setDetail(null)} onKeyDown={(e) => { if (e.key === "Escape") setDetail(null) }}>
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-elevated p-4 shadow-elev-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2"><h2 className="text-base font-semibold text-fg">{detail.title}</h2><Button size="sm" variant="ghost" onClick={() => setDetail(null)} autoFocus>Close</Button></div>
            {detail.subtitle && <p className="text-sm text-fg-muted">{detail.subtitle}</p>}
            {detail.description && <p className="mt-2 text-sm text-fg">{detail.description}</p>}
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {Object.entries(detail.values).map(([k, v]) => <div key={k} className="contents"><dt className="text-fg-muted">{k}</dt><dd className="break-words text-fg">{v}</dd></div>)}
            </dl>
            {d?.source === "table" && d.table_id && <Link href={`/data/${d.table_id}`} className="mt-3 inline-flex items-center gap-1 text-sm text-primary-text hover:underline">Open in Data <ExternalLink className="size-3" aria-hidden /></Link>}
          </div>
        </div>
      )}
    </div>
  )
}
