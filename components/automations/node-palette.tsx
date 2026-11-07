'use client'

import { useState, useEffect, useReducer, useId } from "react"
import { useDraggable } from "@dnd-kit/core"
import { NODE_CATALOG, nodeColorCategory, nodeColorTextVar, type NodeType } from "@/lib/workflow-schema"
import { getWorkflowActivityDisplayName, getWorkflowActivityPresentation, getWorkflowActivitySetupNotes, getWorkflowActivitySummary } from "@/lib/extensibility"
import {
  Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer,
  Edit, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, Zap,
  FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar,
  CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge,
  CircleStop, Inbox, Search, Users, MessageSquareDashed, Radio, CornerDownRight, XCircle, AlertTriangle, Presentation,
  GitFork, FileUp, FileDown, Download, Tag, Braces, Brackets, FileSpreadsheet, Sheet,
  Star, Scale, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore,
  Puzzle, Briefcase, FilePen, Milestone, Link, Gauge, FileSearch, GitCompare, FileOutput, FileStack, ScanText, EyeOff, FileScan, Captions, ScanEye, Film, ScanFace, VideoOff, ImagePlus, AudioLines, Clapperboard, ChevronRight, ChevronsDownUp, ChevronsUpDown, PanelLeftClose, Shuffle, BadgeCheck, KeyRound, CalendarDays, Signature, FileSignature, Hourglass, FileCheck } from 'lucide-react'
import {
  allCollapsed, allExpanded, initialPaletteCollapse, isGroupCollapsed, loadCollapseMap, paletteCollapseReducer, safeLocalStorage, saveCollapseMap,
} from "@/lib/palette-collapse"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"
import { IconButton } from "@/components/ui/icon-button"
import { SearchInput } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { CountBadge } from "@/components/ui/badge"

/** Action icons are Lucide names in kebab case (manifest) or Pascal case (older activities). */
function paletteIconName(name: unknown): string {
  const raw = String(name ?? '').trim()
  if (!raw) return 'Puzzle'
  const pascal = raw.includes('-') || /^[a-z]/.test(raw) ? raw.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('') : raw
  return pascal in iconMap ? pascal : 'Puzzle'
}

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
  FileSearch, GitCompare, FileOutput, FileStack, ScanText, EyeOff, FileScan,
  Captions, ScanEye, Film, ScanFace, VideoOff, ImagePlus, AudioLines, Clapperboard,
  Shuffle, BadgeCheck, KeyRound, CalendarDays,
  Signature, FileSignature, Hourglass, FileCheck,
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

  const row = (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-center gap-2 w-full h-8 rounded-md px-2 text-ui text-fg text-left transition-colors group",
        isDisabled && "opacity-40 cursor-not-allowed",
        !isDisabled && !isDragging && "cursor-grab hover:bg-subtle active:cursor-grabbing",
        isDragging && "opacity-30",
      )}
      onClick={() => !isDisabled && !isDragging && onAddNode(type as NodeType)}
    >
      <Icon size={16} className="shrink-0" style={{ color }} aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate">{label}</span>
      {!isDisabled && onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleFavorite() }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn("shrink-0 inline-flex size-5 items-center justify-center rounded-sm transition-opacity hover:bg-muted", isFavorite ? "opacity-100 text-warning" : "opacity-0 text-fg-muted group-hover:opacity-60 focus-visible:opacity-100")}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFavorite}
        >
          <Star size={12} fill={isFavorite ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      )}
    </div>
  )
  if (!description) return row
  return (
    <Tooltip content={description} side="right" align="start" className="max-w-64 font-normal">
      {row}
    </Tooltip>
  )
}

const categories = [
  { key: "section", label: "Tools" },
  { key: "trigger", label: "Triggers" },
  { key: "action", label: "Actions" },
  { key: "logic", label: "Logic & flow" },
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
        className="group/hdr text-xs font-medium text-fg-muted mb-0.5 flex items-center gap-1.5 w-full h-7 text-left rounded-md px-1 -mx-1 transition-colors hover:bg-subtle hover:text-fg"
      >
        <ChevronRight size={12} aria-hidden="true" className={cn("shrink-0 transition-transform", !collapsed && "rotate-90")} />
        {icon}
        <span className="flex-1 truncate">{label}</span>
        <CountBadge count={count} max={999} aria-label={`${count} ${count === 1 ? "item" : "items"}`} />
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
    if (activity.enabled === false) return false
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
      icon: <Star size={12} aria-hidden="true" fill="currentColor" className="shrink-0 text-warning" />,
      items: favoriteItems.map((item) => (
        <DraggablePaletteItem
          key={`fav-${item.type}`}
          type={item.type}
          label={item.label}
          description={item.description}
          icon={item.icon}
          color={nodeColorTextVar(nodeColorCategory(item.type))}
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
          color={nodeColorTextVar(nodeColorCategory(item.type))}
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
      label: "Custom actions",
      count: customActivityCards.length,
      items: customActivityCards.map((activity: any) => (
        <DraggablePaletteItem
          key={`custom-${activity.id}`}
          type="custom_activity"
          label={activity.displayLabel}
          description={activity.helperText}
          icon={paletteIconName(activity.icon_name)}
          color={activity.color || nodeColorTextVar(nodeColorCategory('custom_activity'))}
          isDisabled={disabledNodeTypes.includes('custom_activity')}
          isFavorite={false}
          onAddNode={() => onAddCustomActivity?.(activity.id)}
          dragData={{ customActivityId: activity.id }}
        />
      )),
    })
  }
  const groupKeys = groups.map((g) => g.key)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <h3 className="flex-1 text-xs font-medium text-fg-muted">
          Nodes
        </h3>
        {onCollapseSidebar && (
          <IconButton size="sm" onClick={onCollapseSidebar} label="Collapse the node sidebar" icon={<PanelLeftClose />} className="text-fg-muted" />
        )}
      </div>

      {/* Search */}
      <SearchInput
        size="sm"
        value={search}
        onValueChange={(v) => { setSearch(v); dispatch({ type: "searchChanged" }) }}
        onKeyDown={(e) => { if (e.key === "Escape" && search) e.stopPropagation() }}
        placeholder="Search nodes…"
        aria-label="Search nodes"
      />

      {/* Expand / collapse all */}
      <div className="flex items-center justify-end gap-0.5 -mt-1" role="toolbar" aria-label="Palette groups">
        <IconButton size="sm" onClick={() => dispatch({ type: "setAll", keys: groupKeys, collapsed: false, searching })}
          disabled={allExpanded(collapse, groupKeys, searching)}
          className="text-fg-muted" label="Expand all groups" aria-label="Expand all groups" icon={<ChevronsUpDown />} />
        <IconButton size="sm" onClick={() => dispatch({ type: "setAll", keys: groupKeys, collapsed: true, searching })}
          disabled={allCollapsed(collapse, groupKeys, searching)}
          className="text-fg-muted" label="Collapse all groups" aria-label="Collapse all groups" icon={<ChevronsDownUp />} />
      </div>

      {groups.length === 0 && (
        <p className="text-xs text-fg-muted px-1 py-2">No nodes match “{search.trim()}”.</p>
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
