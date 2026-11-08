"use client"

import { useState, useRef, useId, useEffect, useSyncExternalStore, useContext, useMemo } from "react"
import { useDesignerContext } from "@/lib/assistants/client-registry"
import { usePermissions } from "@/lib/permissions-context"
import { AGENT_RERUN_TEST_EVENT } from "@/components/assistants/agent-store"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useDroppable, useDraggable, useSensor, useSensors, PointerSensor } from "@dnd-kit/core"
import type { WorkflowNode, WorkflowEdge, NodeType } from "@/lib/workflow-schema"
import { createDefaultNode, NODE_CATALOG, nodeColorCategory, nodeColorTextVar, nodeColorVar } from "@/lib/workflow-schema"
import { actionManifestOf, withActionOutputs } from "@/lib/custom-actions/manifest"
import { NodePalette } from "./node-palette"
import { CanvasNode } from "./canvas-node"
import { EdgeRenderer } from "./edge-renderer"
import { useNodeSizes } from "./use-node-sizes"
import { WebhookTriggerConfig } from "./webhook-trigger-config"
import { UserVariablesEditor } from "./user-variables-editor"
import { SwimlaneManager } from "./swimlane-manager"
import { ExpressionsPanel } from "./expressions-panel"
import { ActiveInputProvider } from "./active-input"
import { VersionHistory } from "./version-history"
import { ContextViewer } from "./context-viewer"
import { VariablesPanel } from "./variables-panel"
import { StartFormButton } from "@/components/forms/start-form-button"
import { StartFormPageSection } from "@/components/forms/start-form-page"
import type { StartFormVariable } from "@/lib/forms/start-form"
import { insertLoopBefore } from "@/lib/workflow-data-picker"
import { saveWorkflow, deleteWorkflow, publishWorkflow, getWorkflowPackageBlock } from "@/app/actions/automations"
import { validateWorkflow } from "@/lib/workflow-validation"
import { formatWiringWarning, validateWorkflowWiring, type WiringWarning } from "@/lib/workflow-wiring"
import {
  canRedo, canUndo, commit, createHistory, describeChange, historyShortcut, redo as redoHistory, redoLabel,
  sameSnapshot, shortcutHints, undo as undoHistory, undoLabel, type DesignerSnapshot, type HistoryState,
} from "@/lib/workflow-history"
import { Button, buttonVariants } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { StatusPill, Tag } from "@/components/ui/badge"
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip"
import { Tabs, TabPanel } from "@/components/ui/tabs"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { overlayClass } from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { plural } from "@/lib/format/plural"
import { formatTime } from "@/lib/format/date"
import Link from "next/link"
import { Save, Trash2, TestTube, Zap, CheckCircle, Plus, RefreshCw, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer, Edit as EditIcon, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar, CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge, CircleStop, Inbox, FileUp, FileDown, Download, Upload, MessageSquareDashed, Radio, Loader2, History, CornerDownRight, GitFork, Users, FolderOpen, LayoutGrid, Shield, Scale, Puzzle, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore, Undo2, Redo2, PanelLeftOpen, ArrowLeft, ChevronDown, MoreHorizontal, AlertTriangle } from "lucide-react"
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { cn } from "@/lib/utils"
import { CanvasZoomControls } from "./canvas-zoom-controls"
import { CanvasMinimap, type MinimapItem } from "./canvas-minimap"
import { CanvasZoomContext, scaledDragTransform, useCanvasZoom } from "./use-canvas-zoom"
import { pasteOffset, screenDeltaToCanvas, unionBounds, visibleCanvasRect, type Bounds } from "@/lib/canvas-zoom"
import { nodeBox } from "@/lib/workflow-edge-routing"
import { CanvasBands, SectionFrame, sectionRgb, TRIGGER_ZONE_HEIGHT } from "./canvas-sections"
import { normalizeDataTableNodes } from "@/lib/workflow-table-refs"
import { loadFlag, PALETTE_RAIL_STORAGE_KEY, safeLocalStorage, saveFlag } from "@/lib/palette-collapse"
import { WorkflowLookupsProvider } from "./workflow-lookups"
import { DataSidebar, isDataSidebarShortcut, useDataSidebarState } from "./data-sidebar"
import { LinkedFormsProvider, useLinkedFormsQuery } from "./linked-forms"
import { isDataDrag } from "./data-picker"
import { resolveVisibleGraph, autoAssignSection, getSectionNodes, getSectionDimensions, SECTION_COLORS } from "@/lib/workflow-sections"

const paletteIconMap: Record<string, any> = {
  Plus, RefreshCw, CheckCircle, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer,
  Edit: EditIcon, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, Zap,
  FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar,
  CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge,
  CircleStop, Inbox, CalendarClock: CalendarPlus, FileInput: FileText,
  FileUp, FileDown, Download, MessageSquareDashed, Radio, CornerDownRight, GitFork, Users, FolderOpen, Scale, Puzzle,
  Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore,
}
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useDirectoryCapabilities } from "./aad-group-assignment"
import dynamic from "next/dynamic"

// Heavy panels load in their own chunks: the node config panel (~6k lines,
// all node editors) once the builder mounts, the test runner on demand.
const NodeConfigPanel = dynamic(() => import("./node-config-panel").then((m) => m.NodeConfigPanel), {
  loading: () => <PanelSkeleton rows={5} />,
})
const TestRunner = dynamic(() => import("./test-runner").then((m) => m.TestRunner), {
  loading: () => (
    <div className={`${overlayClass} flex items-center justify-center`}>
      <div className="w-[480px] max-w-[90vw] rounded-xl bg-elevated p-4 shadow-elev-3">
        <PanelSkeleton rows={4} />
      </div>
    </div>
  ),
})

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-2.5 w-1/3" />
          <Skeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

export interface UserVariable {
  id: string
  name: string
  /** `array` + format `attachments`: a list of uploaded files (designed in the start form). */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue: string
  description: string
  /** Input parameter settings (Run dialog, API/CLI starts): a start must supply a value (or the default applies). */
  required?: boolean
  /** Refines a string input: date, datetime, email, url or select (with `options`). */
  format?: 'text' | 'date' | 'datetime' | 'email' | 'url' | 'select' | 'attachments'
  /** Attachments inputs: counts, sizes, types (lib/forms/attachments.ts; set in the start form designer). */
  attachments?: Record<string, unknown>
  /** Choices of a select input, comma separated. */
  options?: string
}

export interface Swimlane {
  id: string
  label: string
  color: string
  y: number
  height: number
}

interface WorkflowBuilderProps {
  workflowId: string
  tenantId: string
  initialNodes: WorkflowNode[]
  initialEdges: WorkflowEdge[]
  triggerType: string
  isActive: boolean
  runs: any[]
  initialUserVariables?: UserVariable[]
  initialSwimlanes?: Swimlane[]
  customActivities?: any[]
  publishedVersionNumber?: number | null
  hasUnpublishedChanges?: boolean
  /** Toolbar identity: the workflow's name and where Back goes. */
  workflowName?: string
  backHref?: string
  /** Extra items at the top of the toolbar's ⋯ menu (Run, Form link, View runs, Export…). */
  menuItems?: React.ReactNode
  /** A banner under the toolbar (e.g. live instances on older versions). */
  notice?: React.ReactNode
}

// Draggable section header wrapper — participates in the same DnD context as canvas nodes
function DraggableSectionHeader({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id })
  const zoom = useContext(CanvasZoomContext)
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.5 : 1, transform: scaledDragTransform(transform, zoom) }}
    >
      {children}
    </div>
  )
}

const GRID_SIZE = 20

const subscribeNever = () => () => {}

function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE
}

export function WorkflowBuilder({
  workflowId, tenantId, initialNodes, initialEdges, triggerType, isActive, runs, initialUserVariables, initialSwimlanes,
  customActivities = [],
  publishedVersionNumber, hasUnpublishedChanges: initialHasUnpublished,
  workflowName, backHref, menuItems, notice,
}: WorkflowBuilderProps) {
  // Legacy table keys (tableId, data_table_id, …) are migrated to table_id on open.
  const [nodes, setNodes] = useState<WorkflowNode[]>(() => normalizeDataTableNodes(initialNodes))
  const [edges, setEdges] = useState<WorkflowEdge[]>(initialEdges)
  const [userVariables, setUserVariables] = useState<UserVariable[]>(initialUserVariables ?? [])
  const [swimlanes, setSwimlanes] = useState<Swimlane[]>(initialSwimlanes ?? [])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  /** Selected connection: highlighted with its two steps; deleted only via its button or Delete. */
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  // ─── Undo / redo ───
  // Snapshots reference the immutable state arrays (structural sharing); the
  // effect below records every change, coalescing rapid edits of one field.
  type Snapshot = DesignerSnapshot<UserVariable, Swimlane>
  const historyRef = useRef<HistoryState<Snapshot> | null>(null)
  const [initialSnapshot] = useState<Snapshot>(() => ({ nodes, edges, userVariables, swimlanes }))
  const [historyView, setHistoryView] = useState<{ undo: string | null; redo: string | null }>({ undo: null, redo: null })
  /** Snapshot last written to the server: undoing back to it makes the workflow clean again. */
  const [savedSnapshot, setSavedSnapshot] = useState<Snapshot>(initialSnapshot)
  /** True while Tidy animates: intermediate frames are not history entries. */
  const suppressHistoryRef = useRef(false)
  /** Label for the next recorded change (e.g. "tidy layout") instead of the diff-derived one. */
  const pendingChangeLabelRef = useRef<string | null>(null)
  const isMac = useSyncExternalStore(subscribeNever, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false)
  const hints = { ...shortcutHints(isMac), save: isMac ? "⌘S" : "Ctrl+S", test: isMac ? "⌘↵" : "Ctrl+Enter" }
  /** Inspector tab: the selected step's (or the workflow's) settings, its data, or the variables reference. */
  const [inspectorTab, setInspectorTab] = useState<"configure" | "data" | "variables">("configure")

  useEffect(() => {
    if (suppressHistoryRef.current) return
    const h = historyRef.current ?? createHistory(initialSnapshot)
    const snap: Snapshot = { nodes, edges, userVariables, swimlanes }
    if (sameSnapshot(snap, h.present)) { historyRef.current = h; return }
    const label = pendingChangeLabelRef.current
    pendingChangeLabelRef.current = null
    const next = commit(h, snap, label ? { label } : describeChange(h.present, snap), Date.now())
    historyRef.current = next
    setHistoryView({ undo: undoLabel(next), redo: redoLabel(next) })
  }, [nodes, edges, userVariables, swimlanes, initialSnapshot])

  const isDirty = !sameSnapshot({ nodes, edges, userVariables, swimlanes }, savedSnapshot)
  // The designer assistant works on this workflow's saved draft; it asks for unsaved changes to be saved first.
  useDesignerContext({ area: "workflow", item_id: workflowId, item_name: workflowName ?? null, dirty: isDirty })
  // "Ask Agent to fix" → the Agent changed this workflow → "Re-run test": open the test runner and run the same inputs.
  const { can } = usePermissions()
  const canEditWorkflow = can("workflows.edit" as never)
  const [rerun, setRerun] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    const onRerun = (e: Event) => {
      const detail = (e as CustomEvent<{ workflowId: string; values: Record<string, unknown> }>).detail
      if (detail?.workflowId !== workflowId) return
      setRerun(Object.fromEntries(Object.entries(detail.values ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])))
      setShowTestRunner(true)
    }
    window.addEventListener(AGENT_RERUN_TEST_EVENT, onRerun)
    return () => window.removeEventListener(AGENT_RERUN_TEST_EVENT, onRerun)
  }, [workflowId])

  function applyHistory(next: HistoryState<Snapshot>) {
    historyRef.current = next
    setHistoryView({ undo: undoLabel(next), redo: redoLabel(next) })
    const s = next.present
    setNodes(s.nodes)
    setEdges(s.edges)
    setUserVariables(s.userVariables)
    setSwimlanes(s.swimlanes)
    setConnecting(null)
  }

  function handleUndo() {
    const h = historyRef.current
    if (!h || !canUndo(h) || suppressHistoryRef.current) return
    applyHistory(undoHistory(h))
  }

  function handleRedo() {
    const h = historyRef.current
    if (!h || !canRedo(h) || suppressHistoryRef.current) return
    applyHistory(redoHistory(h))
  }

  const [testResult, setTestResult] = useState<{ status: string; error?: string } | null>(null)
  const [showTestRunner, setShowTestRunner] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingFromPalette, setDraggingFromPalette] = useState<string | null>(null)
  // Docked Data sidebar next to the config panel (remembered; ⌥D toggles).
  const [dataSidebarOpen, setDataSidebarOpen] = useDataSidebarState()
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isDataSidebarShortcut(event)) return
      event.preventDefault()
      setDataSidebarOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setDataSidebarOpen])
  const [showExpressions, setShowExpressions] = useState(false)
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [showPermissions, setShowPermissions] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [publishNotes, setPublishNotes] = useState('')
  const [publishing, setPublishing] = useState(false)
  // Synchronous guard: a double click must not publish two versions.
  const publishGuard = useSubmitGuard()
  // Installed from a package whose setup is incomplete: activation is blocked.
  const [packageBlock, setPackageBlock] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void getWorkflowPackageBlock(workflowId).then((message) => { if (!cancelled) setPackageBlock(message) }).catch(() => {})
    return () => { cancelled = true }
  }, [workflowId])
  const [currentVersion, setCurrentVersion] = useState(publishedVersionNumber ?? null)
  const [hasUnpublished, setHasUnpublished] = useState(initialHasUnpublished ?? true)
  const canvasRef = useRef<HTMLDivElement>(null)
  const canvasContentRef = useRef<HTMLDivElement>(null)
  // Measured card sizes: connector anchors (and Tidy) use the real heights.
  const nodeSizes = useNodeSizes(canvasContentRef, nodes.map((n) => `${n.id}${n.collapsed ? "c" : ""}`).join("|"))
  const designerRef = useRef<HTMLDivElement>(null)
  // Node sidebar collapsed to a rail (per browser, localStorage).
  const [paletteRail, setPaletteRail] = useState(false)
  useEffect(() => {
    const storage = safeLocalStorage()
    const stored = storage?.getItem(PALETTE_RAIL_STORAGE_KEY)
    // No choice yet: below 1600px the palette starts as a rail so the canvas keeps ≥60% of the width.
    if (stored == null ? window.innerWidth < 1600 : loadFlag(storage, PALETTE_RAIL_STORAGE_KEY)) setPaletteRail(true)
  }, [])
  function setPaletteRailPersisted(rail: boolean) {
    setPaletteRail(rail)
    saveFlag(safeLocalStorage(), PALETTE_RAIL_STORAGE_KEY, rail)
  }
  // Canvas navigation: zoom / pan / fit. The view is per-session UI state —
  // never saved with the workflow and never an undo entry.
  const canvasView = useCanvasZoom({
    scrollRef: canvasRef,
    contentRef: canvasContentRef,
    rootRef: designerRef,
    storageScope: `workflow:${workflowId}`,
    getContentBounds: () => unionBounds(visibleBoxes()),
    getSelectionBounds: () => selectionBounds(),
    blocked: showTestRunner || showPublishDialog || showPermissions || showVersionHistory,
  })
  const zoom = canvasView.zoom
  const dndId = useId()
  const router = useRouter()
  const queryClient = useQueryClient()

  // Listen for toggle-collapse events from canvas nodes (double-click)
  useEffect(() => {
    function handleToggleCollapse(e: Event) {
      const nodeId = (e as CustomEvent).detail?.nodeId
      if (nodeId) {
        setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n))
      }
    }
    window.addEventListener('toggle-collapse', handleToggleCollapse)
    return () => window.removeEventListener('toggle-collapse', handleToggleCollapse)
  }, [])

  // Keyboard shortcuts: copy, paste, delete, select all
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Undo / redo — not while typing (native text undo) or with a dialog open.
      const shortcut = historyShortcut(e)
      if (shortcut) {
        if (showTestRunner || showPublishDialog || showPermissions || showVersionHistory) return
        e.preventDefault()
        if (shortcut === 'undo') handleUndo()
        else handleRedo()
        return
      }

      // Don't handle if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      const isMeta = e.metaKey || e.ctrlKey

      // Delete selected nodes (or the selected connection)
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isMeta) {
        if (selectedEdgeId) {
          e.preventDefault()
          deleteEdge(selectedEdgeId)
        } else if (selectedNodeIds.size > 0) {
          e.preventDefault()
          setNodes(prev => prev.filter(n => !selectedNodeIds.has(n.id)))
          setEdges(prev => prev.filter(e => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target)))
          setSelectedNodeIds(new Set())
          setSelectedNodeId(null)
        } else if (selectedNodeId) {
          // Single node delete handled by node's own delete button
        }
      }

      // Copy: Ctrl/Cmd + C
      if (isMeta && e.key === 'c') {
        const ids = selectedNodeIds.size > 0 ? selectedNodeIds : (selectedNodeId ? new Set([selectedNodeId]) : new Set<string>())
        if (ids.size > 0) {
          const copiedNodes = nodes.filter(n => ids.has(n.id))
          const copiedEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target))
          setClipboard({ nodes: copiedNodes, edges: copiedEdges })
        }
      }

      // Paste: Ctrl/Cmd + V
      if (isMeta && e.key === 'v' && clipboard) {
        e.preventDefault()
        const idMap = new Map<string, string>()
        const copiedBounds = unionBounds(clipboard.nodes.map(n => nodeBox(n, nodeSizes)))
        const el = canvasRef.current
        const offset = copiedBounds && el
          ? pasteOffset(copiedBounds, visibleCanvasRect(canvasView.getView(), { width: el.clientWidth, height: el.clientHeight }))
          : { x: 40, y: 40 }
        const newNodes: WorkflowNode[] = clipboard.nodes.map(n => {
          const newId = crypto.randomUUID()
          idMap.set(n.id, newId)
          return {
            ...n,
            id: newId,
            label: `${n.label} (copy)`,
            position: { x: Math.max(0, n.position.x + offset.x), y: Math.max(0, n.position.y + offset.y) },
          }
        })
        const newEdges: WorkflowEdge[] = clipboard.edges
          .filter(e => idMap.has(e.source) && idMap.has(e.target))
          .map(e => ({
            ...e,
            id: crypto.randomUUID(),
            source: idMap.get(e.source)!,
            target: idMap.get(e.target)!,
          }))
        setNodes(prev => [...prev, ...newNodes])
        setEdges(prev => [...prev, ...newEdges])
        setSelectedNodeIds(new Set(newNodes.map(n => n.id)))
        setSelectedNodeId(null)
      }

      // Select all: Ctrl/Cmd + A
      if (isMeta && e.key === 'a') {
        e.preventDefault()
        setSelectedNodeIds(new Set(nodes.map(n => n.id)))
        setSelectedNodeId(null)
      }

      // Escape: clear selection
      if (e.key === 'Escape') {
        setSelectedNodeIds(new Set())
        setSelectedEdgeId(null)
        if (connecting) cancelConnect()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedNodeId, selectedNodeIds, selectedEdgeId, clipboard, nodes, edges, connecting, showTestRunner, showPublishDialog, showPermissions, showVersionHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘S saves the draft, ⌘↵ saves and opens the test runner (also while typing in an input).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (showTestRunner || showPublishDialog || showPermissions || showVersionHistory) return
      const key = e.key.toLowerCase()
      if (key !== "s" && key !== "enter") return
      e.preventDefault()
      if (saving) return
      if (key === "s") void handleSave()
      else void handleTest()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null
  // A newly selected step's settings start at the top of the inspector.
  useEffect(() => { document.getElementById("inspector-panel-configure")?.scrollTo({ top: 0 }) }, [selectedNodeId])

  const TRIGGER_TYPES = NODE_CATALOG.filter(n => n.category === 'trigger').map(n => n.type)

  // Derive effective trigger type from actual canvas nodes (not the static DB value)
  const effectiveTriggerType = nodes.find(n => TRIGGER_TYPES.includes(n.type))?.type ?? triggerType
  const middlewareMode = effectiveTriggerType === 'middleware_received'
  const disabledNodeTypes = middlewareMode ? (['user_task'] as NodeType[]) : []

  function buildMiddlewareReturnNodes(triggerNode: WorkflowNode) {
    const endNode = createDefaultNode('end_workflow', triggerNode.position.x, 180)
    endNode.label = 'Return Response'
    endNode.config = {
      ...endNode.config,
      reason: 'Middleware completed',
      response_status_code: '200',
      response_body_mode: 'json',
      response_mappings: [{ key: 'ok', value: 'true' }],
    }
    const edge: WorkflowEdge = {
      id: crypto.randomUUID(),
      source: triggerNode.id,
      target: endNode.id,
    }
    return { endNode, edge }
  }

  function canAddMiddlewareTrigger() {
    const hasUserTasks = nodes.some((node) => node.type === 'user_task')
    if (hasUserTasks) {
      alert('Please remove User Task nodes from this flow before adding a Middleware trigger.')
      return false
    }
    return true
  }

  function addNode(type: NodeType) {
    if (disabledNodeTypes.includes(type)) return
    if (type === 'middleware_received' && !canAddMiddlewareTrigger()) return
    const isTrigger = TRIGGER_TYPES.includes(type)
    if (isTrigger) {
      const triggerNodes = nodes.filter((n) => TRIGGER_TYPES.includes(n.type))
      const x = triggerNodes.length * 220 + 20
      const node = createDefaultNode(type, x, 20)
      if (type === 'middleware_received') {
        const { endNode, edge } = buildMiddlewareReturnNodes(node)
        setNodes((prev) => [...prev, node, endNode])
        setEdges((prev) => [...prev, edge])
      } else {
        setNodes((prev) => [...prev, node])
      }
      setSelectedNodeId(node.id)
    } else {
      const nonTriggerNodes = nodes.filter((n) => !TRIGGER_TYPES.includes(n.type))
      const maxY = nonTriggerNodes.length > 0
        ? Math.max(...nonTriggerNodes.map((n) => n.position.y)) + 140
        : TRIGGER_ZONE_HEIGHT + 60
      const node = createDefaultNode(type, 200, maxY)
      setNodes((prev) => [...prev, node])
      setSelectedNodeId(node.id)
    }
  }

  // Custom action steps with their function's typed outputs (data picker, Variables panel).
  const dataNodes = useMemo(() => withActionOutputs(nodes, customActivities), [nodes, customActivities])

  function addCustomActivity(activityId: string, x?: number, y?: number) {
    const activity = customActivities.find((item: any) => item.id === activityId)
    if (!activity) return
    const nonTriggerNodes = nodes.filter((n) => !TRIGGER_TYPES.includes(n.type))
    const nextY = y ?? (nonTriggerNodes.length > 0
      ? Math.max(...nonTriggerNodes.map((n) => n.position.y)) + 140
      : TRIGGER_ZONE_HEIGHT + 60)
    const node = createDefaultNode('custom_activity', x ?? 200, nextY)
    node.label = activity.name
    const actionManifest = actionManifestOf(activity)
    const firstOperation = actionManifest.operations[0]
    node.config = {
      ...node.config,
      custom_activity_id: activity.id,
      custom_activity_key: activity.key,
      activity_name: activity.name,
      activity_description: activity.description ?? '',
      activity_icon_name: activity.icon_name ?? 'Puzzle',
      activity_color: activity.color ?? '#0EA5E9',
      operation: firstOperation?.id ?? null,
      operation_label: firstOperation?.label ?? null,
      _action_outputs: firstOperation?.outputs ?? [],
      manifest: { outputs: firstOperation?.outputs ?? [] },
      input_mappings: {},
      _output_prefix: String(activity.key || activity.name || 'custom_action').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30),
    }
    setNodes((prev) => [...prev, node])
    setSelectedNodeId(node.id)
  }

  function updateNode(nodeId: string, updates: Partial<WorkflowNode>) {
    setNodes((prev) =>
      prev.map((n) => (n.id === nodeId ? { ...n, ...updates } : n))
    )
  }

  // Data picker "Loop through each item": wrap the step in a Loop over the list.
  function insertLoopBeforeNode(nodeId: string, itemsExpression: string) {
    const result = insertLoopBefore(nodes, edges, nodeId, itemsExpression, (x, y) => createDefaultNode("loop", x, y), () => crypto.randomUUID())
    if (!result) return
    setNodes(result.nodes)
    setEdges(result.edges)
  }

  function deleteNode(nodeId: string) {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setEdges((prev) =>
      prev.filter((e) => e.source !== nodeId && e.target !== nodeId)
    )
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }

  const connectLabelRef = useRef<string | undefined>(undefined)
  const connectPortRef = useRef<import('@/lib/workflow-schema').PortSide | undefined>(undefined)

  function startConnect(sourceId: string, branchLabel?: string, port?: import('@/lib/workflow-schema').PortSide) {
    setConnecting(sourceId)
    connectLabelRef.current = branchLabel
    connectPortRef.current = port
  }

  function finishConnect(targetId: string) {
    if (connecting && connecting !== targetId) {
      const exists = edges.some(
        (e) => e.source === connecting && e.target === targetId && e.label === (connectLabelRef.current ?? undefined)
      )
      if (!exists) {
        setEdges((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            source: connecting,
            target: targetId,
            label: connectLabelRef.current || undefined,
            sourcePort: connectPortRef.current || undefined,
          },
        ])
      }
    }
    setConnecting(null)
    connectLabelRef.current = undefined
    connectPortRef.current = undefined
  }

  function cancelConnect() {
    setConnecting(null)
  }

  function deleteEdge(edgeId: string) {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId))
    setSelectedEdgeId((cur) => (cur === edgeId ? null : cur))
  }

  function selectEdge(edgeId: string) {
    if (connecting) return
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
    setSelectedNodeIds(new Set())
  }

  function handleDragStart(event: DragStartEvent) {
    const activeData = event.active.data?.current
    if (activeData?.fromPalette) {
      setDraggingFromPalette(activeData.nodeType)
      setDraggingId(null)
    } else {
      setDraggingId(event.active.id as string)
      setDraggingFromPalette(null)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const activeData = active.data?.current
    // dnd-kit reports screen pixels; the canvas is scaled by `zoom`.
    const delta = screenDeltaToCanvas(event.delta, canvasView.zoomRef.current)

    /** Canvas point under the pointer at drop (card centred on it), or null when off the canvas. */
    function dropPoint() {
      const el = canvasRef.current
      const pointer = event.activatorEvent as PointerEvent | null
      if (!el || !pointer || typeof pointer.clientX !== 'number') return null
      const client = { x: pointer.clientX + event.delta.x, y: pointer.clientY + event.delta.y }
      const rect = el.getBoundingClientRect()
      if (client.x < rect.left || client.x > rect.right || client.y < rect.top || client.y > rect.bottom) return null
      const c = canvasView.toCanvas(client)
      return { x: snapToGrid(Math.max(20, c.x - 104)), y: snapToGrid(Math.max(20, c.y - 30)) }
    }

    // Dropping from palette onto canvas
    if (activeData?.fromPalette) {
      const nodeType = activeData.nodeType as NodeType
      const customActivityId = activeData.customActivityId as string | undefined
      if (nodeType === 'custom_activity' && customActivityId) {
        const drop = dropPoint()
        if (drop) {
          const x = drop.x
          const y = Math.max(TRIGGER_ZONE_HEIGHT + 20, drop.y)
          addCustomActivity(customActivityId, x, y)
        } else {
          addCustomActivity(customActivityId)
        }
        setDraggingFromPalette(null)
        return
      }
      if (disabledNodeTypes.includes(nodeType)) {
        setDraggingFromPalette(null)
        return
      }
      if (nodeType === 'middleware_received' && !canAddMiddlewareTrigger()) {
        setDraggingFromPalette(null)
        return
      }
      const isTrigger = TRIGGER_TYPES.includes(nodeType)
      const drop = dropPoint()
      if (drop) {
        const x = drop.x
        let y = drop.y
        if (isTrigger) {
          y = 20
        } else {
          y = Math.max(TRIGGER_ZONE_HEIGHT + 20, y)
        }
        const node = createDefaultNode(nodeType, x, y)
        if (nodeType === 'middleware_received') {
          const { endNode, edge } = buildMiddlewareReturnNodes(node)
          setNodes((prev) => [...prev, node, endNode])
          setEdges((prev) => [...prev, edge])
        } else {
          setNodes((prev) => [...prev, node])
        }
        setSelectedNodeId(node.id)
      } else {
        addNode(nodeType)
      }
      setDraggingFromPalette(null)
      return
    }

    // Moving existing node on canvas (move all selected if part of multi-select)
    const nodeId = active.id as string
    const movingIds = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId])

    // Collect section child IDs — when a section_group is dragged, move its children too
    const sectionChildIds = new Set<string>()
    for (const id of movingIds) {
      const movingNode = nodes.find(n => n.id === id)
      if (movingNode?.type === 'section_group') {
        nodes.forEach(n => { if (n.sectionId === id) sectionChildIds.add(n.id) })
      }
    }

    setNodes((prev) =>
      prev.map((n) => {
        const isDirectlyMoved = movingIds.has(n.id)
        const isChildOfMovedSection = sectionChildIds.has(n.id)
        if (isDirectlyMoved || isChildOfMovedSection) {
          const isTrigger = TRIGGER_TYPES.includes(n.type)
          let newX = snapToGrid(Math.max(0, n.position.x + delta.x))
          let newY = snapToGrid(n.position.y + delta.y)
          if (isTrigger) {
            newY = Math.max(0, Math.min(newY, TRIGGER_ZONE_HEIGHT - 60))
          } else if (n.type !== 'section_group') {
            newY = Math.max(TRIGGER_ZONE_HEIGHT + 20, newY)
          }
          // Auto-assign section for non-section nodes that were directly moved (not children)
          if (isDirectlyMoved && n.type !== 'section_group' && !isTrigger) {
            const sectionId = autoAssignSection({ ...n, position: { x: newX, y: newY } }, prev)
            return { ...n, position: { x: newX, y: newY }, sectionId }
          }
          return { ...n, position: { x: newX, y: newY } }
        }
        return n
      })
    )
    setDraggingId(null)
    setDraggingFromPalette(null)
  }

  async function handleSave() {
    const savedState: Snapshot = { nodes, edges, userVariables, swimlanes }
    setSaving(true)
    await saveWorkflow(workflowId, { nodes, edges, user_variables: userVariables, swimlanes, trigger_type: effectiveTriggerType })
    setLastSaved(new Date())
    setHasUnpublished(true)
    setSavedSnapshot(savedState)
    setSaving(false)
  }

  async function handlePublish() {
    await publishGuard.run(async () => {
      if (!validation.valid) {
        alert(`Cannot publish: ${validation.totalErrors} configuration issue${validation.totalErrors !== 1 ? 's' : ''} found.`)
        return
      }
      setPublishing(true)
      // Save draft first
      await saveWorkflow(workflowId, { nodes, edges, user_variables: userVariables, swimlanes, trigger_type: effectiveTriggerType })
      const result = await publishWorkflow(workflowId, publishNotes || undefined)
      if ('error' in result) {
        setPublishing(false)
        setShowPublishDialog(false)
        setPackageBlock(result.error)
        return
      }
      setCurrentVersion(result.version_number)
      // Run Agent steps are now pinned to their agents' current versions.
      void queryClient.invalidateQueries({ queryKey: ['workflow-agent-pins', workflowId] })
      setHasUnpublished(false)
      setShowPublishDialog(false)
      setPublishNotes('')
      setPublishing(false)
    })
  }




  // AAD group assignment is checked against the workspace (undefined while loading: not checked).
  const directoryCapabilities = useDirectoryCapabilities()
  const validation = validateWorkflow(nodes, effectiveTriggerType, { entraGroups: directoryCapabilities?.entraGroups })

  async function handleDelete() {
    if (!confirm("Delete this workflow?")) return
    await deleteWorkflow(workflowId)
  }

  async function handleTest() {
    try {
      await handleSave()
    } catch (err) {
      console.error('[handleTest] Save failed:', err)
    }
    setShowTestRunner(true)
  }

  const [tidying, setTidying] = useState(false)

  /** Animate node positions (and section sizes) from the current state towards `target`; the caller sets the final state. */
  function animateNodesTo(target: WorkflowNode[], durationMs = 420): Promise<void> {
    const from = nodes
    const reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    if (reduceMotion || from.length > 400) return Promise.resolve()
    const fromById = new Map(from.map((n) => [n.id, n]))
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k
    return new Promise((resolve) => {
      const start = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs)
        if (t >= 1) { resolve(); return }
        const k = ease(t)
        setNodes(target.map((n) => {
          const f = fromById.get(n.id)
          if (!f || f === n) return n
          const moved: WorkflowNode = { ...n, position: { x: lerp(f.position.x, n.position.x, k), y: lerp(f.position.y, n.position.y, k) } }
          if (n.type === "section_group" && (f.config?.width !== n.config?.width || f.config?.height !== n.config?.height)) {
            moved.config = {
              ...n.config,
              width: lerp(f.config?.width ?? 500, n.config?.width ?? 500, k),
              height: lerp(f.config?.height ?? 300, n.config?.height ?? 300, k),
            }
          }
          return moved
        }))
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
  }

  /** Canvas boxes of every visible step and section (fit-to-content, minimap). */
  function visibleBoxes(): (Bounds & { node: WorkflowNode })[] {
    const { hiddenNodeIds } = resolveVisibleGraph(nodes, edges)
    return nodes.filter(n => !hiddenNodeIds.has(n.id)).map(n => ({ ...nodeBox(n, nodeSizes), node: n }))
  }

  /** Bounds of the selected steps, or of the selected connection's two steps. */
  function selectionBounds(): Bounds | null {
    const ids = new Set<string>(selectedNodeIds)
    if (selectedNodeId) ids.add(selectedNodeId)
    if (ids.size === 0 && selectedEdgeId) {
      const edge = edges.find(e => e.id === selectedEdgeId)
      if (edge) { ids.add(edge.source); ids.add(edge.target) }
    }
    return unionBounds(nodes.filter(n => ids.has(n.id)).map(n => nodeBox(n, nodeSizes)))
  }
  const hasSelection = selectedNodeIds.size > 0 || !!selectedNodeId || !!selectedEdgeId

  /**
   * Tidy: re-arrange the canvas as a top-down flowchart (lib/workflow-layout,
   * loaded on demand). Only positions, section sizes and swimlane bands
   * change; ids, configs and connections are untouched.
   */
  async function handleAutoLayout() {
    if (tidying || nodes.length < 2) return
    setTidying(true)
    try {
      const { layoutWorkflow, applyLayout } = await import("@/lib/workflow-layout")
      const result = layoutWorkflow({ nodes, edges, swimlanes, sizes: nodeSizes })
      const laneById = new Map(result.swimlanes.map((l) => [l.id, l]))
      const nextLanes = swimlanes.map((l) => {
        const fitted = laneById.get(l.id)
        return fitted && (fitted.y !== l.y || fitted.height !== l.height) ? { ...l, y: fitted.y, height: fitted.height } : l
      })
      const laidOut = applyLayout(nodes, result)
      // Animation frames are not history entries; the final layout is one "tidy layout" entry.
      suppressHistoryRef.current = true
      try { await animateNodesTo(laidOut) } finally { suppressHistoryRef.current = false }
      pendingChangeLabelRef.current = "tidy layout"
      setNodes(laidOut)
      if (nextLanes.some((l, i) => l !== swimlanes[i])) setSwimlanes(nextLanes)
      canvasView.fitBounds(result.bounds)
    } finally {
      setTidying(false)
    }
  }

  const importRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    const data = {
      version: 1,
      nodes,
      edges,
      user_variables: userVariables,
      swimlanes,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow-${workflowId.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        if (!data.nodes || !Array.isArray(data.nodes)) {
          alert('Invalid workflow file: missing nodes array')
          return
        }
        if (!confirm(`Import ${data.nodes.length} nodes and ${data.edges?.length ?? 0} edges? This will replace the current canvas.`)) return
        // Normalize imported node configs for UI compatibility
        const normalizedNodes = (data.nodes as any[]).map((node: any) => {
          if (!node.config) return node
          const config = { ...node.config }
          // switch_case: normalize object cases to strings, map expression→field
          if (node.type === 'switch_case') {
            if (config.expression && !config.field) {
              config.field = config.expression
              delete config.expression
            }
            if (Array.isArray(config.cases)) {
              config.cases = config.cases.map((c: any) => typeof c === 'object' && c !== null ? (c.value ?? String(c)) : c)
            }
          }
          return { ...node, config }
        })
        setNodes(normalizedNodes)
        setEdges(data.edges ?? [])
        if (data.user_variables) setUserVariables(data.user_variables)
        if (data.swimlanes) setSwimlanes(data.swimlanes)
        setSelectedNodeId(null)
      } catch {
        alert('Failed to parse workflow file. Ensure it is valid JSON.')
      }
    }
    reader.readAsText(file)
    // Reset input so same file can be re-imported
    e.target.value = ''
  }

  // Latest versions of linked reusable forms (fills missing / stale cached fields in the pickers).
  const linkedForms = useLinkedFormsQuery(nodes)

  // Wiring warnings (references that will be blank, config keys the engine
  // ignores): shown beside the issues, never block publishing. Recomputed
  // only when a node's id / type / label / config, the edges, variables or
  // linked forms change — not on every drag frame (positions).
  const wiringCache = useRef<{ parts: unknown[]; warnings: WiringWarning[] } | null>(null)
  const wiringParts: unknown[] = [edges, userVariables, linkedForms, ...nodes.flatMap((n) => [n.id, n.type, n.label, n.config])]
  const cachedWiring = wiringCache.current
  let wiringWarnings: WiringWarning[]
  if (cachedWiring && cachedWiring.parts.length === wiringParts.length && cachedWiring.parts.every((part, i) => part === wiringParts[i])) {
    wiringWarnings = cachedWiring.warnings
  } else {
    // Info notes (assigned for testing) show on their step only, not in the warning count.
    wiringWarnings = validateWorkflowWiring({ nodes, edges, workflowVariables: userVariables, linkedForms }).filter((w) => w.severity !== 'info')
    wiringCache.current = { parts: wiringParts, warnings: wiringWarnings }
  }

  // Plain <input>/<textarea> in the config panel take a dropped {{token}}
  // natively (at the drop caret); highlight the one under the pointer.
  function markNativeDropTarget(event: React.DragEvent) {
    if (!isDataDrag(event)) return
    const target = event.target as HTMLElement
    const field = target.closest?.('input:not([type=checkbox]):not([type=radio]), textarea') as HTMLElement | null
    const previous = document.querySelector('[data-drop-target="true"]')
    if (previous && previous !== field) previous.removeAttribute('data-drop-target')
    if (field && !field.closest('[data-drop-zone]')) field.setAttribute('data-drop-target', 'true')
  }
  function clearNativeDropTarget(event: React.DragEvent) {
    if (event.type === 'dragleave' && (event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) return
    document.querySelectorAll('[data-drop-target="true"]').forEach((el) => el.removeAttribute('data-drop-target'))
  }

  const minimapItems: MinimapItem[] = visibleBoxes().map(({ node: n, ...box }) => ({
    ...box,
    id: n.id,
    color: (n.config?.node_color as string | undefined) ?? nodeColorVar(nodeColorCategory(n.type)),
    selected: n.id === selectedNodeId || selectedNodeIds.has(n.id),
  }))

  return (
    <ActiveInputProvider>
    <LinkedFormsProvider value={linkedForms}>
    <WorkflowLookupsProvider>
    <CanvasZoomContext.Provider value={zoom}>
    <div ref={designerRef} className="flex h-full min-h-0 flex-col">
    <DndContext
      id={dndId}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {packageBlock && (
        <div className="mb-2" data-testid="package-setup-banner">
          <InlineNotice
            tone="warning"
            title="Needs configuration"
            message={packageBlock.replace(/^Needs configuration:\s*/, '')}
            actions={<Button asChild variant="secondary" size="sm"><a href="/settings/packages">Complete setup</a></Button>}
          />
        </div>
      )}
      {/* Toolbar — one 48px row: identity | history + layout | save, test, publish, ⋯ */}
      <TooltipProvider>
      <div
        role="toolbar"
        aria-label="Workflow designer"
        data-designer-toolbar=""
        className="mb-2 flex h-12 min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border bg-panel px-2"
      >
        <div className="flex min-w-0 flex-[1_1_auto] items-center gap-2">
          {backHref && (
            <Tooltip content="Back to workflows">
              <Link href={backHref} aria-label="Back to workflows" className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Link>
            </Tooltip>
          )}
          {workflowName && <h1 className="min-w-0 truncate text-base font-semibold text-fg" title={workflowName}>{workflowName}</h1>}
          <StatusPill status={isActive ? "active" : "inactive"} />
          {currentVersion && <Tag mono className="shrink-0">v{currentVersion} published</Tag>}
          {(isDirty || (hasUnpublished && currentVersion)) && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-muted" data-unpublished-indicator="">
              <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
              {isDirty ? "Unsaved changes" : "Unpublished changes"}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton size="sm" icon={<Undo2 />} onClick={handleUndo} disabled={!historyView.undo}
            label={historyView.undo ? `Undo ${historyView.undo}` : "Undo"} kbd={hints.undo} />
          <IconButton size="sm" icon={<Redo2 />} onClick={handleRedo} disabled={!historyView.redo}
            label={historyView.redo ? `Redo ${historyView.redo}` : "Redo"} kbd={hints.redo} />
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" leadingIcon={tidying ? <Loader2 className="animate-spin" /> : <LayoutGrid />} trailingIcon={<ChevronDown />}>Layout</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem icon={<LayoutGrid />} disabled={nodes.length < 2 || tidying} onSelect={() => { void handleAutoLayout() }}>
                Tidy layout
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Canvas JSON (steps and connections)</DropdownMenuLabel>
              <DropdownMenuItem icon={<Download />} onSelect={handleExport}>Download canvas</DropdownMenuItem>
              <DropdownMenuItem icon={<Upload />} onSelect={() => importRef.current?.click()}>Load canvas…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        </div>

        <div className="flex flex-[1_0_auto] items-center justify-end gap-1.5">
          <Tooltip content="Save the draft" kbd={hints.save}>
            <Button variant="secondary" size="sm" leadingIcon={<Save />} loading={saving} onClick={() => { void handleSave() }}>Save</Button>
          </Tooltip>
          <Tooltip content="Save, then run test cases" kbd={hints.test}>
            <Button variant="secondary" size="sm" leadingIcon={<TestTube />} onClick={() => { void handleTest() }} disabled={saving}>Save &amp; test</Button>
          </Tooltip>
          <Tooltip content={isDirty ? "Save your changes before publishing" : `Publish the draft as version ${(currentVersion ?? 0) + 1}`}>
            <span className="inline-flex">
              <Button size="sm" leadingIcon={<Upload />} onClick={() => setShowPublishDialog(true)} disabled={isDirty}>
                Publish{currentVersion ? ` v${currentVersion + 1}` : ""}
              </Button>
            </span>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton size="sm" label="More workflow actions" icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menuItems}
              {menuItems && <DropdownMenuSeparator />}
              <DropdownMenuItem icon={<Shield />} onSelect={() => setShowPermissions(true)}>Permissions</DropdownMenuItem>
              <DropdownMenuItem icon={<History />} onSelect={() => setShowVersionHistory(true)}>Version history</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => { void handleDelete() }}>Delete workflow</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </TooltipProvider>

      {notice}

      {/* Panels: palette | canvas | (docked data) | inspector */}
      <div className="relative flex min-h-0 flex-1 gap-2">
        {/* Left: Palette (collapsible to a 48px rail) */}
        {paletteRail ? (
          <div
            className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-panel py-2"
            data-palette-rail=""
          >
            <IconButton size="sm" label="Expand the node sidebar" icon={<PanelLeftOpen />} tooltipSide="right"
              aria-expanded={false} onClick={() => setPaletteRailPersisted(false)} />
            <span className="select-none text-2xs font-medium text-fg-muted [writing-mode:vertical-rl] rotate-180">
              Nodes
            </span>
          </div>
        ) : (
        <div className="w-60 shrink-0 space-y-3 overflow-y-auto rounded-lg border border-border bg-panel p-3">
        <NodePalette onAddNode={addNode} onAddCustomActivity={addCustomActivity} tenantId={tenantId} disabledNodeTypes={disabledNodeTypes} customActivities={customActivities}
          onCollapseSidebar={() => setPaletteRailPersisted(true)} />

          {/* Context Viewer */}
          <ContextViewer nodes={nodes} triggerType={effectiveTriggerType} />
        </div>
        )}

        {/* Center: Canvas, its overlays and the status bar in one frame. */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-bg transition-[border-color] duration-[var(--ds-dur-fast)]",
            draggingFromPalette ? "border-primary" : "border-border",
          )}
        >
        <div className="relative min-h-0 flex-1">
        <div
          ref={canvasRef}
          tabIndex={0}
          role="region"
          aria-label="Workflow canvas. Ctrl or Command plus wheel to zoom, space and drag to pan."
          data-workflow-canvas=""
          className={cn(
            "absolute inset-0 overflow-auto transition-[background-color]",
            draggingFromPalette ? "bg-primary-wash" : "bg-bg",
            canvasView.cursorClass,
          )}
          style={{ touchAction: "pan-x pan-y" }}
          {...canvasView.canvasHandlers}
          onClick={(e) => {
            // Don't cancel connect if the click originated from a branch port or node
            const target = e.target as HTMLElement
            if (target.closest('[data-branch-port]') || target.closest('[data-canvas-node]')) return
            if (connecting) cancelConnect()
            else { setSelectedNodeId(null); setSelectedNodeIds(new Set()); setSelectedEdgeId(null) }
          }}
        >
          {/* Drop zone hint when dragging from palette */}
          {draggingFromPalette && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
              <div className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-elev-2">
                Drop here to add the step
              </div>
            </div>
          )}

          <div
            ref={canvasContentRef}
            data-canvas-bg="true"
            className="relative p-4 min-h-full"
            style={{
              // Generous minimum (10000 × 8000) so the canvas feels infinite in every direction.
              // If nodes extend beyond this, the canvas grows to accommodate them.
              minWidth: `${Math.max(10000, ...nodes.map(n => n.type === 'section_group' ? n.position.x + (n.config?.width ?? 500) + 2000 : n.position.x + 2000))}px`,
              minHeight: `${Math.max(8000, ...nodes.map(n => n.type === 'section_group' ? n.position.y + (n.config?.height ?? 300) + 2000 : n.position.y + 2000), ...swimlanes.map(l => l.y + l.height + 2000))}px`,
              transform: canvasView.transform,
              transformOrigin: "0 0",
              // Dot grid on the snap grid, in the subtle border colour.
              backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--ds-border) 80%, transparent) 1px, transparent 1px)",
              backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            }}
          >
            <EdgeRenderer
              nodes={nodes}
              edges={edges}
              sizes={nodeSizes}
              onDeleteEdge={deleteEdge}
              selectedEdgeId={selectedEdgeId}
              onSelectEdge={selectEdge}
              zoom={zoom}
              connecting={connecting}
              isActive={isActive}
            />
            {/* Trigger band + swimlanes (shared with the run viewers) */}
            <CanvasBands showTriggerZone={nodes.some((n) => TRIGGER_TYPES.includes(n.type))} swimlanes={swimlanes} />

            {/* Section group nodes — container rectangles behind regular nodes */}
            {getSectionNodes(nodes).map((section) => {
              const { width, height, color } = getSectionDimensions(section)
              const { r, g, b } = sectionRgb(section)
              const toggle = () => setNodes(prev => prev.map(n => n.id === section.id ? { ...n, collapsed: !n.collapsed } : n))
              return (
                <SectionFrame
                  key={`section-bg-${section.id}`}
                  section={section}
                  collapsed={!!section.collapsed}
                  nodeCount={nodes.filter(n => n.sectionId === section.id).length}
                  onToggle={toggle}
                  interactive
                  wrapHeader={(header) => <DraggableSectionHeader id={section.id}>{header}</DraggableSectionHeader>}
                  title={
                    <input
                      value={section.label}
                      onChange={e => { const val = e.target.value; setNodes(prev => prev.map(n => n.id === section.id ? { ...n, label: val } : n)) }}
                      className="text-xs font-semibold bg-transparent border-none outline-none flex-1 min-w-0 cursor-text"
                      style={{ color }}
                      aria-label="Section name"
                      onClick={e => e.stopPropagation()}
                      onPointerDown={e => e.stopPropagation()}
                    />
                  }
                  resizeHandle={
                    <div
                      className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize pointer-events-auto"
                      style={{ borderRight: `2px solid rgba(${r}, ${g}, ${b}, 0.3)`, borderBottom: `2px solid rgba(${r}, ${g}, ${b}, 0.3)`, borderBottomRightRadius: 10 }}
                      onMouseDown={(e) => {
                        e.preventDefault(); e.stopPropagation()
                        const startX = e.clientX; const startY = e.clientY
                        const startW = width; const startH = height
                        const secId = section.id
                        // Read the live zoom: a gesture may have changed it since render.
                        const z = canvasView.zoomRef.current
                        function onMove(e2: MouseEvent) {
                          const newW = Math.max(280, startW + (e2.clientX - startX) / z)
                          const newH = Math.max(120, startH + (e2.clientY - startY) / z)
                          setNodes(prev => prev.map(n => n.id === secId ? { ...n, config: { ...n.config, width: snapToGrid(newW), height: snapToGrid(newH) } } : n))
                        }
                        function onUp() { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                        window.addEventListener('mousemove', onMove)
                        window.addEventListener('mouseup', onUp)
                      }}
                    />
                  }
                />
              )
            })}

            {/* Nodes — hide those inside collapsed sections */}
            {(() => {
              const { hiddenNodeIds } = resolveVisibleGraph(nodes, edges)
              const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : undefined
              return nodes.filter(n => !hiddenNodeIds.has(n.id) && n.type !== 'section_group').map((node) => (
                <CanvasNode
                  key={node.id}
                  node={node}
                  emphasis={selectedEdge ? (node.id === selectedEdge.source || node.id === selectedEdge.target ? 'highlight' : 'fade') : undefined}
                  isSelected={selectedNodeId === node.id || selectedNodeIds.has(node.id)}
                  isConnecting={connecting !== null}
                  connectingSource={connecting}
                  isActive={isActive}
                  dimmed={middlewareMode && node.type === 'user_task'}
                  onSelect={(e?: React.MouseEvent) => {
                    setSelectedEdgeId(null)
                    if (e?.shiftKey) {
                      setSelectedNodeIds(prev => {
                        const next = new Set(prev)
                        if (next.has(node.id)) next.delete(node.id)
                        else next.add(node.id)
                        return next
                      })
                      setSelectedNodeId(null)
                    } else {
                      setSelectedNodeId(node.id)
                      setSelectedNodeIds(new Set())
                    }
                  }}
                  onDelete={() => deleteNode(node.id)}
                  onStartConnect={(branchLabel, port) => startConnect(node.id, branchLabel, port)}
                  onFinishConnect={() => finishConnect(node.id)}
                />
              ))
            })()}

            {nodes.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <Zap size={40} style={{ color: "var(--theme-muted-text)", opacity: 0.3 }} />
                <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
                  Add nodes from the palette to build your automation
                </p>
              </div>
            )}
          </div>
        </div>
        {/* ─── Overlays — siblings of the scroll container so they stay
               pinned to the viewport while the canvas content scrolls. ─── */}

          {/* Minimap — bottom right, collapsible */}
          <CanvasMinimap items={minimapItems} scrollRef={canvasRef} getView={canvasView.getView} onNavigate={canvasView.centreAt} />

          {/* Expressions reference (floating) */}
          <div className="absolute right-3 top-3 z-20">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Sparkles />}
              aria-pressed={showExpressions}
              className={cn("bg-elevated shadow-elev-2", showExpressions && "border-primary bg-primary-wash text-primary-text")}
              onClick={(e) => { e.stopPropagation(); setShowExpressions(!showExpressions) }}
            >
              Expressions
            </Button>
          </div>
          <ExpressionsPanel open={showExpressions} onClose={() => setShowExpressions(false)} />

          {/* Zoom controls — bottom left, vertical */}
          <CanvasZoomControls
            orientation="vertical"
            className="absolute bottom-3 left-3 z-20"
            zoom={zoom}
            isMac={isMac}
            onZoomIn={canvasView.zoomIn}
            onZoomOut={canvasView.zoomOut}
            onZoomTo={(z) => canvasView.zoomTo(z)}
            onFit={() => canvasView.fitContent()}
            onFitSelection={canvasView.fitSelection}
            hasSelection={hasSelection}
          />
        </div>

        {/* Status bar: counts, readiness, connect hint, last saved */}
        <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border-subtle bg-panel px-3 text-xs text-fg-muted num" data-designer-status="">
          <span>{plural(nodes.length, "node")}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(edges.length, "edge")}</span>
          <span aria-hidden="true">·</span>
          <span>{plural(runs.length, "run")}</span>
          {nodes.length > 0 && <span className="mx-1 h-3 w-px bg-border" aria-hidden="true" />}
          {!validation.valid && (
            <Tooltip content={validation.nodeErrors.map(e => `${e.nodeLabel}: ${e.errors.join(', ')}`).join('\n')}>
              <span tabIndex={0} className="inline-flex items-center gap-1 text-warning">
                <AlertTriangle size={12} aria-hidden="true" />
                {plural(validation.totalErrors, "issue")} to configure
              </span>
            </Tooltip>
          )}
          {wiringWarnings.length > 0 && (
            <Tooltip content={[...wiringWarnings.slice(0, 25).map(formatWiringWarning), ...(wiringWarnings.length > 25 ? [`…and ${wiringWarnings.length - 25} more`] : [])].join('\n')}>
              <button
                type="button"
                data-wiring-warnings=""
                className="inline-flex items-center gap-1 text-fg-muted hover:text-fg"
                onClick={() => setSelectedNodeId(wiringWarnings[0].node_id)}
              >
                <AlertTriangle size={12} aria-hidden="true" className="text-warning" />
                {plural(wiringWarnings.length, "wiring warning")}
              </button>
            </Tooltip>
          )}
          {validation.valid && nodes.length > 0 && (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle size={12} aria-hidden="true" />
              Ready to deploy
            </span>
          )}
          {connecting && (
            <span className="inline-flex items-center gap-2 text-primary-text">
              <span className="font-medium">Click a target step to connect</span>
              <Button variant="link" size="sm" className="h-auto text-xs" onClick={cancelConnect}>Cancel</Button>
            </span>
          )}
          <span className="ml-auto">
            {lastSaved ? <>Saved {formatTime(lastSaved)}</> : null}
          </span>
        </div>
        </div>

        {/* Docked Data column (drag fields onto the inspector's inputs) */}
        {dataSidebarOpen && (
          <DataSidebar
            nodes={dataNodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            workflowVariables={userVariables}
            onInsertLoopBefore={insertLoopBeforeNode}
            onClose={() => setDataSidebarOpen(false)}
          />
        )}

        {/* Right: Inspector — Configure · Data · Variables */}
        <div
          className="flex w-[360px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-elev-3"
          data-no-dnd="true"
          data-inspector=""
          onPointerDown={(e) => e.stopPropagation()}
          onDragOverCapture={markNativeDropTarget}
          onDragLeaveCapture={clearNativeDropTarget}
          onDropCapture={clearNativeDropTarget}
        >
          <div className="shrink-0 px-3">
            <Tabs
              aria-label="Inspector"
              idBase="inspector"
              value={inspectorTab}
              onValueChange={setInspectorTab}
              items={[
                { value: "configure", label: "Configure" },
                { value: "data", label: "Data" },
                { value: "variables", label: "Variables" },
              ]}
            />
          </div>

          <TabPanel idBase="inspector" value="configure" hidden={inspectorTab !== "configure"} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
          {!selectedNode && (
            <div>
              <h2 className="text-ui font-semibold text-fg">Workflow settings</h2>
              <p className="text-xs text-fg-muted">Select a step on the canvas to configure it.</p>
            </div>
          )}

          {/* Show webhook config ONLY when webhook node is selected or no node selected */}
          {((effectiveTriggerType === "webhook_received" || effectiveTriggerType === "middleware_received") ||
              nodes.some(n => n.type === "webhook_received" || n.type === "middleware_received")) &&
            (!selectedNode || selectedNode.type === "webhook_received" || selectedNode.type === "middleware_received") && (
            <>
              <WebhookTriggerConfig
                workflowId={workflowId}
                workflowVariables={userVariables}
                mode={effectiveTriggerType === 'middleware_received' ? 'middleware' : 'webhook'}
              />
              <div className="border-t border-border-subtle" />
            </>
          )}

          {/* Workflow Variables + Swimlanes — show when no node selected */}
          {!selectedNode && (
            <>
              <UserVariablesEditor variables={userVariables} onChange={setUserVariables} />
              {(() => {
                const triggerNode = nodes.find((n) => TRIGGER_TYPES.includes(n.type)) ?? null
                return (
                  <div>
                    <StartFormButton
                      variables={userVariables as unknown as StartFormVariable[]}
                      onVariablesChange={(next) => setUserVariables(next as UserVariable[])}
                      triggerNode={triggerNode}
                      onTriggerConfigChange={(config) => triggerNode && updateNode(triggerNode.id, { config })}
                    />
                    {triggerNode?.type !== "form_submitted" && <div className="mt-2"><StartFormPageSection workflowId={workflowId} /></div>}
                  </div>
                )
              })()}
              <div className="border-t border-border-subtle" />
              <SwimlaneManager swimlanes={swimlanes} onChange={setSwimlanes} />
              <div className="border-t border-border-subtle" />
            </>
          )}

          <NodeConfigPanel workflowId={workflowId} node={selectedNode} onUpdateNode={updateNode} allNodes={dataNodes} allEdges={edges} onInsertLoopBefore={insertLoopBeforeNode} workflowVariables={userVariables} triggerType={effectiveTriggerType} customActivities={customActivities} dataSidebarOpen={dataSidebarOpen} onToggleDataSidebar={() => setDataSidebarOpen((open) => !open)} />
          </TabPanel>

          <TabPanel idBase="inspector" value="data" hidden={inspectorTab !== "data"} className="flex min-h-0 flex-1 flex-col p-3">
            {inspectorTab === "data" && (
              <DataSidebar
                embedded
                nodes={dataNodes}
                edges={edges}
                selectedNodeId={selectedNodeId}
                workflowVariables={userVariables}
                onInsertLoopBefore={insertLoopBeforeNode}
                onClose={() => setInspectorTab("configure")}
                onDock={dataSidebarOpen ? undefined : () => { setDataSidebarOpen(true); setInspectorTab("configure") }}
              />
            )}
          </TabPanel>

          <TabPanel idBase="inspector" value="variables" hidden={inspectorTab !== "variables"} className="flex min-h-0 flex-1 flex-col p-3">
            <VariablesPanel embedded open={inspectorTab === "variables"} onClose={() => setInspectorTab("configure")} nodes={dataNodes} edges={edges} selectedNodeId={selectedNodeId} onInsertLoopBefore={insertLoopBeforeNode} userVariables={userVariables} triggerType={effectiveTriggerType} />
          </TabPanel>
        </div>
      </div>
      {/* Drag overlay - ghost preview when dragging from palette */}
      <DragOverlay dropAnimation={{
        duration: 200,
        easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
      }}>
        {draggingFromPalette && (() => {
          const catalog = NODE_CATALOG.find((n) => n.type === draggingFromPalette)
          if (!catalog) return null
          const Icon = paletteIconMap[catalog.icon] ?? Plus
          const category = nodeColorCategory(catalog.type)
          const accent = nodeColorVar(category)
          return (
            <div className="pointer-events-none w-56 rounded-lg border border-border bg-elevated opacity-95 shadow-elev-3">
              <div className="flex items-center gap-2 rounded-t-lg border-b border-border-subtle px-3 py-2 text-xs font-semibold text-fg"
                style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, var(--theme-card-bg))` }}>
                <span className="inline-flex size-5 items-center justify-center rounded-md"
                  style={{ backgroundColor: `color-mix(in srgb, ${accent} 30%, var(--theme-card-bg))`, color: nodeColorTextVar(category) }}>
                  <Icon size={14} />
                </span>
                <span className="truncate">{catalog.label}</span>
              </div>
              <p className="px-3 py-2 text-2xs text-fg-muted">{catalog.description}</p>
            </div>
          )
        })()}
      </DragOverlay>

      {/* Test Runner Dialog */}
      {showTestRunner && (
        <TestRunner
          workflowId={workflowId}
          nodes={nodes}
          edges={edges}
          userVariables={userVariables}
          swimlanes={swimlanes}
          triggerType={effectiveTriggerType}
          workflowActive={isActive}
          workflowName={workflowName ?? null}
          canEdit={canEditWorkflow}
          initialValues={rerun}
          autoRun={Boolean(rerun)}
          onClose={() => { setShowTestRunner(false); setRerun(null) }}
        />
      )}

      {/* Version History */}
      {showVersionHistory && (
        <VersionHistory
          workflowId={workflowId}
          open={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
        />
      )}

      {/* Publish Dialog */}
      <Dialog open={showPublishDialog} onOpenChange={(open) => { if (!open && !publishing) { setShowPublishDialog(false); setPublishNotes('') } }}>
        <DialogContent size="sm" title={`Publish version ${(currentVersion ?? 0) + 1}`}
          description="In-flight processes continue on the version they started on.">
          <DialogBody className="space-y-3">
            <Field label="Publish notes" optional>
              <Textarea
                value={publishNotes}
                onChange={e => setPublishNotes(e.target.value)}
                placeholder="What changed in this version?"
                rows={3}
              />
            </Field>
            {!validation.valid && (
              <InlineNotice tone="warning" message={`${plural(validation.totalErrors, 'issue')} must be resolved before publishing.`} />
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setShowPublishDialog(false); setPublishNotes('') }} disabled={publishing}>Cancel</Button>
            <Button onClick={handlePublish} loading={publishing} leadingIcon={<Upload />} disabled={!validation.valid}>
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Permissions dialog */}
      <Dialog open={showPermissions} onOpenChange={setShowPermissions}>
        <DialogContent size="lg" title="Permissions">
          <DialogBody>
            <ObjectPermissions objectType="workflow" objectId={workflowId} showExecute={true} />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowPermissions(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
    </div>
    </CanvasZoomContext.Provider>
    </WorkflowLookupsProvider>
    </LinkedFormsProvider>
    </ActiveInputProvider>
  )
}
