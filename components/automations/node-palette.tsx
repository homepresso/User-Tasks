'use client'

import { useState, useEffect, useReducer, useId } from "react"
import { useDraggable } from "@dnd-kit/core"
import { NODE_CATALOG, type NodeType } from "@/lib/workflow-schema"
import { getWorkflowActivityDisplayName, getWorkflowActivityPresentation, getWorkflowActivitySetupNotes, getWorkflowActivitySummary } from "@/lib/extensibility"
import {
  Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer,
  Edit, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, Zap,
  FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar,
  CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge,
  CircleStop, Inbox, Search, Users, MessageSquareDashed, Radio, CornerDownRight, XCircle, AlertTriangle, Presentation,
  GitFork, FileUp, FileDown, Download, Tag, Braces, Brackets, FileSpreadsheet, Sheet,
  Star, Scale, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore,
  Puzzle, Briefcase, FilePen, Milestone, Link, Gauge, ChevronRight, ChevronsDownUp, ChevronsUpDown, PanelLeftClose } from 'lucide-react'
import {
  allCollapsed, allExpanded, initialPaletteCollapse, isGroupCollapsed, loadCollapseMap, paletteCollapseReducer, safeLocalStorage, saveCollapseMap,
} from "@/lib/palette-collapse"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"

const iconMap: Record<string, any> = {
  Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer,
  Edit, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, Zap,
  FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar,
  CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge,
  CircleStop, Inbox, Users, MessageSquareDashed, Radio, CornerDownRight, GitFork,
  FileUp, FileDown, Download, Tag, Braces, Brackets, FileSpreadsheet, Sheet, XCircle, AlertTriangle, Presentation, Scale,
  CalendarClock: CalendarPlus, FileInput: FileText,
  Puzzle, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore,
  Gauge,
  Briefcase, FilePen, Milestone, Link, Search,
}

interface NodePaletteProps {
  onAddNode: (type: NodeType) => void
  onAddCustomActivity?: (activityId: string) => void
  tenantId?: string
  disabledNodeTypes?: NodeType[]
  customActivities?: any[]
  /** Collapse the whole sidebar to a narrow rail (the builder owns that state). */
  onCollapseSidebar?: () => void
}

function DraggablePaletteItem({
  type, label, description, icon, color, isDisabled, isFavorite, onAddNode, onToggleFavorite, dragData,
}: {
  type: string; label: string; icon: string; color: string
  description?: string | null
  isDisabled: boolean; isFavorite: boolean
  onAddNode: (type: NodeType) => void
  onToggleFavorite?: () => void
  dragData?: Record<string, any>
}) {
  const Icon = iconMap[icon] ?? Plus

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { fromPalette: true, nodeType: type, ...(dragData ?? {}) },
    disabled: isDisabled,
  })

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-[11px] text-left transition-all group",
        isDisabled && "opacity-40 cursor-not-allowed",
        !isDisabled && !isDragging && "cursor-grab hover:shadow-sm active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
      style={{
        backgroundColor: "var(--theme-surface)",
        border: "1px solid transparent",
      }}
      onClick={() => !isDisabled && !isDragging && onAddNode(type as NodeType)}
    >
      <Icon size={12} className="shrink-0" style={{ color }} />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{label}</p>
        {description && (
          <p className="text-[10px] leading-tight line-clamp-2" style={{ color: "var(--theme-muted-text)" }}>
            {description}
          </p>
        )}
      </div>
      {!isDisabled && onToggleFavorite && (
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleFavorite() }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn("shrink-0 transition-opacity", isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-40")}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star size={10} fill={isFavorite ? "var(--theme-warning)" : "none"} style={{ color: isFavorite ? "var(--theme-warning)" : "var(--theme-muted-text)" }} />
        </button>
      )}
    </div>
  )
}

const categories = [
  { key: "section", label: "Tools" },
  { key: "trigger", label: "Triggers" },
  { key: "action", label: "Actions" },
  { key: "logic", label: "Logic & Flow" },
  { key: "operation", label: "Operations" },
  { key: "collection", label: "Collections" },
]

/** A collapsible palette group: header button (chevron, label, count, aria-expanded) + its items. */
function PaletteGroup({ id, label, count, collapsed, onToggle, icon, children }: {
  id: string; label: string; count: number; collapsed: boolean; onToggle: () => void; icon?: React.ReactNode; children: React.ReactNode
}) {
  const panelId = `${useId()}-${id}`
  return (
    <div data-palette-group={id} data-collapsed={collapsed ? "" : undefined}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        className="group/hdr text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1 w-full text-left rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-[var(--theme-surface)] focus-visible:outline-none focus-visible:ring-2"
        style={{ color: "var(--theme-muted-text)", ["--tw-ring-color" as string]: "var(--theme-focus-ring)" } as React.CSSProperties}
      >
        <ChevronRight size={11} aria-hidden="true" className={cn("shrink-0 transition-transform", !collapsed && "rotate-90")} />
        {icon}
        <span className="flex-1 truncate">{label}</span>
        <span className="text-[9px] font-medium tabular-nums rounded-full px-1.5 py-px"
          style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
          aria-label={`${count} ${count === 1 ? "item" : "items"}`}>
          {count}
        </span>
      </button>
      {!collapsed && (
        <div id={panelId} role="group" aria-label={label} className="space-y-0.5">
          {children}
        </div>
      )}
    </div>
  )
}

export function NodePalette({ onAddNode, onAddCustomActivity, tenantId, disabledNodeTypes = [], customActivities = [], onCollapseSidebar }: NodePaletteProps) {
  const [search, setSearch] = useState("")
  // Group collapse: the user's saved choice (localStorage, default all expanded) and a
  // temporary map while searching, so a search never overwrites the saved state.
  const [collapse, dispatch] = useReducer(paletteCollapseReducer, undefined, () => initialPaletteCollapse())
  useEffect(() => {
    dispatch({ type: "load", saved: loadCollapseMap(safeLocalStorage()) })
  }, [])
  // Written back only once loaded, so the default never overwrites the stored map.
  useEffect(() => {
    if (collapse.loaded) saveCollapseMap(safeLocalStorage(), collapse.saved)
  }, [collapse.loaded, collapse.saved])
  const searching = search.trim().length > 0
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  // Load favorites from Supabase
  useEffect(() => {
    if (!tenantId) return
    async function load() {
      const { data } = await serverRead('automations.nodeFavorites', { tenantId: tenantId! })
      if (data) setFavorites(new Set(data))
    }
    load()
  }, [tenantId])

  async function toggleFavorite(nodeType: string) {
    if (!tenantId) return
    const { setNodeFavorite } = await import('@/app/actions/automations')
    const isFav = favorites.has(nodeType)
    const result = await setNodeFavorite(nodeType, !isFav)
    if (!result.ok) return
    if (isFav) {
      setFavorites(prev => { const next = new Set(prev); next.delete(nodeType); return next })
    } else {
      setFavorites(prev => new Set([...prev, nodeType]))
    }
  }

  const q = search.toLowerCase()

  // Get favorite items for the favorites section
  const favoriteItems = NODE_CATALOG.filter(n => favorites.has(n.type))
    .filter(n => !q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
  const filteredCustomActivities = customActivities.filter((activity: any) => {
    if (!q) return true
    return [activity.name, activity.description, activity.key]
      .some((value) => String(value ?? '').toLowerCase().includes(q))
  })
  const customActivityCards = filteredCustomActivities.map((activity: any) => {
    const summary = getWorkflowActivitySummary(activity.manifest ?? { inputs: [], outputs: [] })
    const presentation = getWorkflowActivityPresentation(activity.manifest ?? { inputs: [], outputs: [] })
    const setupNotes = getWorkflowActivitySetupNotes(activity.manifest ?? { inputs: [], outputs: [] })
    return {
      ...activity,
      displayLabel: getWorkflowActivityDisplayName(activity.manifest ?? { inputs: [], outputs: [] }, activity.name) ?? activity.name,
      helperText: [presentation.purpose, activity.description, summary, setupNotes[0]].find((value) => String(value ?? '').trim().length > 0) ?? null,
    }
  })

  const groups: { key: string; label: string; count: number; icon?: React.ReactNode; items: React.ReactNode }[] = []
  if (favoriteItems.length > 0) {
    groups.push({
      key: "_favorites",
      label: "Favorites",
      count: favoriteItems.length,
      icon: <Star size={10} aria-hidden="true" fill="var(--theme-warning)" style={{ color: "var(--theme-warning)" }} />,
      items: favoriteItems.map((item) => (
        <DraggablePaletteItem
          key={`fav-${item.type}`}
          type={item.type}
          label={item.label}
          description={item.description}
          icon={item.icon}
          color={item.color}
          isDisabled={disabledNodeTypes.includes(item.type)}
          isFavorite={true}
          onAddNode={onAddNode}
          onToggleFavorite={() => toggleFavorite(item.type)}
        />
      )),
    })
  }
  for (const cat of categories) {
    const items = NODE_CATALOG.filter((n) => n.category === cat.key && (!q || n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q)))
    if (items.length === 0) continue
    groups.push({
      key: cat.key,
      label: cat.label,
      count: items.length,
      items: items.map((item) => (
        <DraggablePaletteItem
          key={item.type}
          type={item.type}
          label={item.label}
          description={item.description}
          icon={item.icon}
          color={item.color}
          isDisabled={disabledNodeTypes.includes(item.type)}
          isFavorite={favorites.has(item.type)}
          onAddNode={onAddNode}
          onToggleFavorite={() => toggleFavorite(item.type)}
        />
      )),
    })
  }
  if (customActivityCards.length > 0) {
    groups.push({
      key: "custom_activities",
      label: "Custom Activities",
      count: customActivityCards.length,
      items: customActivityCards.map((activity: any) => (
        <DraggablePaletteItem
          key={`custom-${activity.id}`}
          type="custom_activity"
          label={activity.displayLabel}
          description={activity.helperText}
          icon={activity.icon_name || 'Puzzle'}
          color={activity.color || '#0EA5E9'}
          isDisabled={disabledNodeTypes.includes('custom_activity')}
          isFavorite={false}
          onAddNode={() => onAddCustomActivity?.(activity.id)}
          dragData={{ customActivityId: activity.id }}
        />
      )),
    })
  }
  const groupKeys = groups.map((g) => g.key)
  const iconBtn = "p-1 rounded-md transition-colors hover:bg-[var(--theme-surface)] disabled:opacity-40 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2"
  const iconBtnStyle = { color: "var(--theme-muted-text)", ["--tw-ring-color" as string]: "var(--theme-focus-ring)" } as React.CSSProperties

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 className="flex-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
          Nodes
        </h3>
        {onCollapseSidebar && (
          <button type="button" onClick={onCollapseSidebar} className={iconBtn} style={iconBtnStyle}
            title="Collapse the node sidebar" aria-label="Collapse the node sidebar">
            <PanelLeftClose size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--theme-muted-text)" }} />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); dispatch({ type: "searchChanged" }) }}
          onKeyDown={(e) => { if (e.key === "Escape" && search) { e.stopPropagation(); setSearch(""); dispatch({ type: "searchChanged" }) } }}
          placeholder="Search nodes..."
          aria-label="Search nodes"
          className="w-full rounded-lg border pl-7 pr-2 py-1.5 text-[11px]"
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
        />
      </div>

      {/* Expand / collapse all */}
      <div className="flex items-center justify-end gap-0.5 -mt-1" role="toolbar" aria-label="Palette groups">
        <button type="button" onClick={() => dispatch({ type: "setAll", keys: groupKeys, collapsed: false, searching })}
          disabled={allExpanded(collapse, groupKeys, searching)}
          className={iconBtn} style={iconBtnStyle} title="Expand all groups" aria-label="Expand all groups">
          <ChevronsUpDown size={13} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => dispatch({ type: "setAll", keys: groupKeys, collapsed: true, searching })}
          disabled={allCollapsed(collapse, groupKeys, searching)}
          className={iconBtn} style={iconBtnStyle} title="Collapse all groups" aria-label="Collapse all groups">
          <ChevronsDownUp size={13} aria-hidden="true" />
        </button>
      </div>

      {groups.length === 0 && (
        <p className="text-[11px] px-1 py-2" style={{ color: "var(--theme-muted-text)" }}>No nodes match “{search.trim()}”.</p>
      )}

      {groups.map((g) => (
        <PaletteGroup key={g.key} id={g.key} label={g.label} count={g.count} icon={g.icon}
          collapsed={isGroupCollapsed(collapse, g.key, searching)}
          onToggle={() => dispatch({ type: "toggle", key: g.key, searching })}>
          {g.items}
        </PaletteGroup>
      ))}
    </div>
  )
}
