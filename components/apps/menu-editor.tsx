"use client"

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { BADGE_SOURCES, type AppMenuItem, type AppMenuLeaf, type PageFilter } from "@/lib/apps/schema"
import { IconPicker } from "./icon-picker"
import { displayLabel, isPlaceholderLabel } from "@/lib/apps/labels"
import { ObjectPicker } from "./object-picker"
import { FormParamsEditor, OpenModeEditor, VisibilityEditor } from "./widget-settings"

/**
 * Editor for the navigation model (the app menu in App settings and the Nav
 * bar widget): entries (page, form, report, record, workflow, tasks view,
 * link), dividers, headings and groups with one level of sub-groups; each
 * entry with an icon, a live badge, an open mode and visibility rules.
 * Targets are chosen with the searchable pickers.
 */

type Kind = AppMenuItem["kind"]
const KIND_LABELS: Record<Kind, string> = {
  page: "Page", form: "Form", report: "Report", record: "Data table record", workflow: "Start a workflow", tasks: "Tasks view", url: "Link",
  divider: "Divider", heading: "Heading", group: "Group",
}

export function newMenuItem(kind: Kind, pages: Array<{ slug: string; title: string }>): AppMenuItem {
  switch (kind) {
    case "page": return { kind, label: pages[0]?.title ?? "Page", page_slug: pages[0]?.slug ?? "home" }
    case "form": return { kind, label: "Form", form_id: "", open: "modal" } as unknown as AppMenuItem
    case "report": return { kind, label: "Report", report_id: "" } as unknown as AppMenuItem
    case "record": return { kind, label: "Record", table_id: "", row_id: null } as unknown as AppMenuItem
    case "workflow": return { kind, label: "Start", workflow_id: "" } as unknown as AppMenuItem
    case "tasks": return { kind, label: "My tasks", view: "mine" }
    case "url": return { kind, label: "Link", url: "https://", new_tab: true }
    case "divider": return { kind, label: "" }
    case "heading": return { kind, label: "Section" }
    case "group": return { kind, label: "Group", items: [], collapsed: false }
  }
}

/** The next entry "Add entry" adds: the first page the menu doesn't list yet (never a page twice), else a link. */
export function nextMenuItem(items: readonly AppMenuItem[], pages: Array<{ slug: string; title: string }>): AppMenuItem {
  const listed = new Set<string>()
  const walk = (list: readonly AppMenuItem[]) => { for (const i of list) { if (i.kind === "group") walk(i.items as AppMenuItem[]); else if (i.kind === "page") listed.add(i.page_slug) } }
  walk(items)
  const page = pages.find((p) => !listed.has(p.slug))
  return page ? { kind: "page", label: page.title, page_slug: page.slug } : newMenuItem("url", pages)
}

export function MenuItemsEditor({ app, items, onChange, pages, filters, nested = true, depth = 0 }: {
  app: string; items: readonly AppMenuItem[]; onChange: (items: AppMenuItem[]) => void; pages: Array<{ slug: string; title: string }>; filters: readonly PageFilter[]; nested?: boolean; depth?: number
}) {
  const set = (i: number, item: AppMenuItem) => onChange(items.map((m, j) => (j === i ? item : m)))
  const move = (i: number, d: number) => { const list = [...items]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; onChange(list) }
  const kinds = (Object.keys(KIND_LABELS) as Kind[]).filter((k) => k !== "group" || (nested && depth < 2))
  void filters
  return (
    <div className="space-y-2" data-menu-editor={depth}>
      {items.map((item, i) => (
        <div key={i} className="space-y-1.5 rounded-md border border-border p-2" data-menu-item={item.kind}>
          <div className="flex items-center gap-1">
            <Select size="sm" aria-label="Entry type" className="w-36" value={item.kind} onChange={(e) => set(i, { ...newMenuItem(e.target.value as Kind, pages), ...("label" in item && item.label ? { label: item.label } : {}) } as AppMenuItem)} options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
            {item.kind !== "divider" && <Input size="sm" aria-label="Label" value={item.label} onChange={(e) => set(i, { ...item, label: e.target.value } as AppMenuItem)} />}
            <IconButton size="sm" label="Move up" icon={<ArrowUp />} onClick={() => move(i, -1)} />
            <IconButton size="sm" label="Move down" icon={<ArrowDown />} onClick={() => move(i, 1)} />
            <IconButton size="sm" label="Remove entry" icon={<Trash2 />} onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
          {item.kind !== "divider" && item.kind !== "heading" && isPlaceholderLabel(item.label) && (
            <p className="text-xs text-warning" data-menu-placeholder>“{item.label || "(empty)"}” is a placeholder — viewers see “{displayLabel(item, { pages })}”. Give it a real label.</p>
          )}
          <LeafFields app={app} item={item} onChange={(next) => set(i, next)} pages={pages} />
          {item.kind === "group" && (
            <div className="border-l-2 border-border-subtle pl-2">
              <Switch checked={!!item.collapsed} onCheckedChange={(v) => set(i, { ...item, collapsed: v })} label="Collapsed at first" />
              <MenuItemsEditor app={app} items={item.items as AppMenuItem[]} onChange={(sub) => set(i, { ...item, items: sub as never })} pages={pages} filters={filters} nested={depth < 1} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => onChange([...items, nextMenuItem(items, pages)])} data-add-menu-item>Add entry</Button>
    </div>
  )
}

function LeafFields({ app, item, onChange, pages }: { app: string; item: AppMenuItem; onChange: (i: AppMenuItem) => void; pages: Array<{ slug: string; title: string }> }) {
  if (item.kind === "divider" || item.kind === "heading") return null
  const leaf = item as Exclude<AppMenuLeaf, { kind: "divider" } | { kind: "heading" }> | Extract<AppMenuItem, { kind: "group" }>
  const common = (
    <div className="grid grid-cols-2 gap-1.5">
      <IconPicker app={app} value={leaf.icon ?? null} onChange={(icon) => onChange({ ...leaf, icon } as AppMenuItem)} />
      <Select size="sm" aria-label="Badge" value={leaf.badge ?? ""} onChange={(e) => onChange({ ...leaf, badge: e.target.value || null } as AppMenuItem)} options={[{ value: "", label: "No badge" }, ...BADGE_SOURCES.map((s) => ({ value: s, label: `Badge: ${s.replace(/_/g, " ")}` }))]} />
    </div>
  )
  const withMode = (target: React.ReactNode) => (
    <>
      {target}
      {"open_mode" in leaf || ["page", "form", "report", "record", "workflow"].includes(leaf.kind) ? <OpenModeEditor value={(leaf as { open_mode?: never }).open_mode} onChange={(m) => onChange({ ...leaf, open_mode: m } as AppMenuItem)} /> : null}
    </>
  )
  let target: React.ReactNode = null
  switch (leaf.kind) {
    case "page": target = withMode(<Select size="sm" aria-label="Page" value={leaf.page_slug} onChange={(e) => {
      const old = pages.find((p) => p.slug === leaf.page_slug)?.title
      const next = pages.find((p) => p.slug === e.target.value)
      // The label follows the page while it is still the old page's title (or a placeholder).
      onChange({ ...leaf, page_slug: e.target.value, ...(next && (isPlaceholderLabel(leaf.label) || leaf.label === old) ? { label: next.title } : {}) })
    }} options={pages.map((p) => ({ value: p.slug, label: p.title }))} />); break
    case "form": target = withMode(<><ObjectPicker app={app} kind="form" label="Form" value={leaf.form_id || null} onChange={(v) => onChange({ ...leaf, form_id: v ?? "" })} /><FormParamsEditor app={app} formId={leaf.form_id} value={leaf.params} onChange={(params) => onChange({ ...leaf, params })} filters={[]} /></>); break
    case "report": target = withMode(<ObjectPicker app={app} kind="report" label="Report" value={leaf.report_id || null} onChange={(v) => onChange({ ...leaf, report_id: v ?? "" })} />); break
    case "record": target = withMode(<><ObjectPicker app={app} kind="table" label="Data table" value={leaf.table_id || null} onChange={(v) => onChange({ ...leaf, table_id: v ?? "" })} /><Input size="sm" aria-label="Row id" value={leaf.row_id ?? ""} placeholder="Row id (empty: new record)" onChange={(e) => onChange({ ...leaf, row_id: e.target.value || null })} /></>); break
    case "workflow": target = withMode(<ObjectPicker app={app} kind="workflow" label="Workflow" value={leaf.workflow_id || null} onChange={(v) => onChange({ ...leaf, workflow_id: v ?? "" })} />); break
    case "tasks": target = <Select size="sm" aria-label="Tasks view" value={leaf.view} onChange={(e) => onChange({ ...leaf, view: e.target.value as never })} options={[{ value: "mine", label: "My tasks" }, { value: "queue", label: "Queue" }, { value: "team", label: "Team" }, { value: "all", label: "All" }]} />; break
    case "url": target = <div className="flex items-center gap-2"><Input size="sm" aria-label="Address" value={leaf.url} placeholder="https://… or /path" onChange={(e) => onChange({ ...leaf, url: e.target.value.trim() })} /><Switch checked={leaf.new_tab} onCheckedChange={(v) => onChange({ ...leaf, new_tab: v })} label="New tab" /></div>; break
  }
  return (
    <div className="space-y-1.5">
      {target}
      {common}
      <VisibilityEditor app={app} value={leaf.visibility ?? null} onChange={(v) => onChange({ ...leaf, visibility: v } as AppMenuItem)} />
    </div>
  )
}
