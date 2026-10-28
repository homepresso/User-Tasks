"use client"

import { useState, useRef, useId, useEffect, useSyncExternalStore, useContext } from "react"
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useDroppable, useDraggable, useSensor, useSensors, PointerSensor } from "@dnd-kit/core"
import type { WorkflowNode, WorkflowEdge, NodeType } from "@/lib/workflow-schema"
import { createDefaultNode, NODE_CATALOG } from "@/lib/workflow-schema"
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
import {
  canRedo, canUndo, commit, createHistory, describeChange, historyShortcut, redo as redoHistory, redoLabel,
  sameSnapshot, shortcutHints, undo as undoHistory, undoLabel, type DesignerSnapshot, type HistoryState,
} from "@/lib/workflow-history"
import { Button } from "@/components/ui/button"
import { Save, Trash2, TestTube, Zap, CheckCircle, Plus, RefreshCw, Clock, GitBranch, GitMerge, Repeat, RotateCw, Timer, Edit as EditIcon, Database, Globe, ListPlus, ThumbsUp, ThumbsDown, Variable, Send, FileText, Mail, Bell, Sparkles, Calculator, CaseSensitive, Type, Calendar, CalendarPlus, Regex, Hash, ListTree, Filter, ArrowUpDown, Fingerprint, Merge, CircleStop, Inbox, FileUp, FileDown, Download, Upload, MessageSquareDashed, Radio, Loader2, History, CornerDownRight, GitFork, Users, FolderOpen, LayoutGrid, Shield, Scale, Puzzle, Bot, UserPlus, UserMinus, MessageSquare, Archive, ArchiveRestore, Undo2, Redo2, PanelLeftOpen } from "lucide-react"
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
import dynamic from "next/dynamic"

// Heavy panels load in their own chunks: the node config panel (~6k lines,
// all node editors) once the builder mounts, the test runner on demand.
const NodeConfigPanel = dynamic(() => import("./node-config-panel").then((m) => m.NodeConfigPanel), {
  loading: () => <PanelSkeleton rows={5} />,
})
const TestRunner = dynamic(() => import("./test-runner").then((m) => m.TestRunner), {
  loading: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
      <div className="w-[480px] max-w-[90vw] rounded-xl border p-4" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
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
          <div className="h-2.5 w-1/3 rounded" style={{ backgroundColor: "var(--theme-surface-border)", animation: "shimmer 1.5s ease-in-out infinite" }} />
          <div className="h-7 w-full rounded" style={{ backgroundColor: "var(--theme-surface)", animation: "shimmer 1.5s ease-in-out infinite" }} />
        </div>
      ))}
    </div>
  )
}

export interface UserVariable {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object'
  defaultValue: string
  description: string
  /** Input parameter settings (Run dialog, API/CLI starts): a start must supply a value (or the default applies). */
  required?: boolean
  /** Refines a string input: date, datetime, email, url or select (with `options`). */
  format?: 'text' | 'date' | 'datetime' | 'email' | 'url' | 'select'
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
  const hints = shortcutHints(isMac)

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
  const [showVariables, setShowVariables] = useState(false)
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
  useEffect(() => { if (loadFlag(safeLocalStorage(), PALETTE_RAIL_STORAGE_KEY)) setPaletteRail(true) }, [])
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null

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

  function addCustomActivity(activityId: string, x?: number, y?: number) {
    const activity = customActivities.find((item: any) => item.id === activityId)
    if (!activity) return
    const nonTriggerNodes = nodes.filter((n) => !TRIGGER_TYPES.includes(n.type))
    const nextY = y ?? (nonTriggerNodes.length > 0
      ? Math.max(...nonTriggerNodes.map((n) => n.position.y)) + 140
      : TRIGGER_ZONE_HEIGHT + 60)
    const node = createDefaultNode('custom_activity', x ?? 200, nextY)
    node.label = activity.name
    node.config = {
      ...node.config,
      custom_activity_id: activity.id,
      custom_activity_key: activity.key,
      activity_name: activity.name,
      activity_description: activity.description ?? '',
      activity_icon_name: activity.icon_name ?? 'Puzzle',
      activity_color: activity.color ?? '#0EA5E9',
      source_code: activity.source_code ?? '',
      manifest: activity.manifest ?? { inputs: [], outputs: [] },
      demo_inputs: activity.demo_inputs ?? {},
      input_mappings: {},
      _output_prefix: activity.key || activity.name?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30),
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
    setHasUnpublished(false)
    setShowPublishDialog(false)
    setPublishNotes('')
    setPublishing(false)
  }




  const validation = validateWorkflow(nodes, effectiveTriggerType)

  async function handleDelete() {
    if (!confirm("Delete this automation?")) return
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
    color: (n.config?.node_color as string | undefined) ?? NODE_CATALOG.find(c => c.type === n.type)?.color ?? "#6B7280",
    selected: n.id === selectedNodeId || selectedNodeIds.has(n.id),
  }))

  return (
    <ActiveInputProvider>
    <LinkedFormsProvider value={linkedForms}>
    <WorkflowLookupsProvider>
    <CanvasZoomContext.Provider value={zoom}>
    <div ref={designerRef} className="contents">
    <DndContext
      id={dndId}
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {packageBlock && (
        <div
          className="mb-3 px-3 py-2 rounded-xl border text-xs flex flex-wrap items-center gap-2"
          role="status"
          data-testid="package-setup-banner"
          style={{ backgroundColor: "var(--status-warning-bg)", color: "var(--theme-warning)", borderColor: "color-mix(in srgb, var(--theme-warning) 35%, transparent)" }}
        >
          <span><span className="font-semibold">Needs configuration:</span>{packageBlock.replace(/^Needs configuration:/, '')}</span>
          <a href="/settings/packages" className="underline underline-offset-2 font-medium">Complete setup</a>
        </div>
      )}
      {/* Toolbar */}
      <div
        className="flex flex-wrap justify-between items-center gap-2 gap-y-2 mb-3 px-3 py-2 rounded-xl border min-w-0"
        style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
      >
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: isActive ? "var(--theme-primary-light)" : "var(--theme-surface)",
              color: isActive ? "var(--theme-success)" : "var(--theme-muted-text)",
              border: `1px solid ${isActive ? "var(--theme-surface-border)" : "var(--theme-surface-border)"}`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: isActive ? "var(--theme-success)" : "var(--theme-muted-text)" }}
            />
            {isActive ? "Active" : "Inactive"}
          </div>

          <div className="w-px h-5" style={{ backgroundColor: "var(--theme-surface-border)" }} />

          <div
            className="text-xs flex items-center gap-2"
            style={{ color: "var(--theme-muted-text)" }}
          >
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: "var(--theme-surface)" }}>
              {nodes.length} nodes
            </span>
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: "var(--theme-surface)" }}>
              {edges.length} edges
            </span>
            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium" style={{ backgroundColor: "var(--theme-surface)" }}>
              {runs.length} runs
            </span>
          </div>

          {/* Validation indicator */}
          {!validation.valid && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold cursor-default"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)', border: '1px solid color-mix(in srgb, var(--theme-warning) 20%, transparent)' }}
              title={validation.nodeErrors.map(e => `${e.nodeLabel}: ${e.errors.join(', ')}`).join('\n')}
            >
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ backgroundColor: 'var(--theme-warning)', color: 'var(--theme-card-bg)' }}>
                {validation.totalErrors}
              </span>
              {validation.totalErrors === 1 ? '1 issue' : `${validation.totalErrors} issues`} to configure
            </div>
          )}
          {validation.valid && nodes.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, transparent)', color: 'var(--theme-success)' }}>
              <CheckCircle size={12} />
              Ready to deploy
            </div>
          )}

          {connecting && (
            <div className="flex items-center gap-2 text-xs animate-pulse">
              <span
                className="px-2 py-1 rounded-full font-medium"
                style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}
              >
                Click a target node to connect
              </span>
              <button
                onClick={cancelConnect}
                className="text-xs underline"
                style={{ color: "var(--theme-muted-text)" }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 items-center">
          {/* Last saved indicator */}
          {lastSaved && (
            <span className="text-[10px] mr-2" style={{ color: "var(--theme-muted-text)" }}>
              Saved {lastSaved.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}

          {/* Button group: Test + Save */}
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <Button size="sm" variant="ghost" onClick={handleTest} disabled={saving} className="rounded-none border-r" style={{ borderColor: "var(--theme-surface-border)" }}>
              <TestTube size={14} className="mr-1" /> {saving ? "Saving..." : "Save & Test"}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving} className="rounded-none border-r" style={{ borderColor: "var(--theme-surface-border)" }}>
              <Save size={14} className="mr-1" /> {saving ? "..." : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPermissions(true)} className="rounded-none">
              <Shield size={14} className="mr-1" /> Permissions
            </Button>
          </div>

          {/* Button group: Undo + Redo */}
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <Button size="sm" variant="ghost" onClick={handleUndo} disabled={!historyView.undo} aria-label="Undo"
              className="rounded-none border-r px-2.5" style={{ borderColor: "var(--theme-surface-border)" }}
              title={historyView.undo ? `Undo ${historyView.undo} (${hints.undo})` : `Nothing to undo (${hints.undo})`}>
              <Undo2 size={14} />
            </Button>
            <Button size="sm" variant="ghost" onClick={handleRedo} disabled={!historyView.redo} aria-label="Redo"
              className="rounded-none px-2.5"
              title={historyView.redo ? `Redo ${historyView.redo} (${hints.redo})` : `Nothing to redo (${hints.redo})`}>
              <Redo2 size={14} />
            </Button>
          </div>

          {/* Button group: Layout + canvas JSON export / import + History */}
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <Button size="sm" variant="ghost" onClick={handleAutoLayout} disabled={nodes.length < 2 || tidying} className="rounded-none border-r" style={{ borderColor: "var(--theme-surface-border)" }} title="Tidy: arrange the steps as a top-down flowchart (branches side by side, loops and error paths to the right)">
              {tidying ? <Loader2 size={14} className="mr-1 animate-spin" /> : <LayoutGrid size={14} className="mr-1" />} Tidy
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExport} className="rounded-none border-r" style={{ borderColor: "var(--theme-surface-border)" }} title="Download the canvas (steps and connections) as JSON. To move the whole workflow to another workspace, use Export in the header.">
              <Download size={14} className="mr-1" /> Canvas
            </Button>
            <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()} className="rounded-none border-r" style={{ borderColor: "var(--theme-surface-border)" }} title="Replace the canvas with a canvas JSON file">
              <Upload size={14} className="mr-1" /> Load canvas
            </Button>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <Button size="sm" variant="ghost" onClick={() => setShowVersionHistory(true)} className="rounded-none">
              <History size={14} className="mr-1" /> History
            </Button>
          </div>

          {/* Unpublished changes indicator */}
          {hasUnpublished && currentVersion && (
            <span className="text-[10px] px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)', border: '1px solid color-mix(in srgb, var(--theme-warning) 20%, transparent)' }}>
              Unpublished changes
            </span>
          )}

          {/* Version badge */}
          {currentVersion && (
            <span className="text-[10px] px-2 py-1 rounded-full font-medium"
              style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
              v{currentVersion}
            </span>
          )}

          {/* Button group: Publish + Delete */}
          <div
            className="flex rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowPublishDialog(true)}
              disabled={isDirty}
              className="rounded-none border-r"
              style={{ borderColor: "var(--theme-surface-border)" }}
              title={isDirty ? "Save your changes before publishing" : undefined}
            >
              <Upload size={14} className="mr-1" /> Publish{currentVersion ? ` v${currentVersion + 1}` : ''}
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDelete} className="rounded-none hover:text-red-500">
              <Trash2 size={14} />
            </Button>
          </div>
          {isDirty && (
            <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
              Save first to publish
            </span>
          )}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="relative flex gap-3 h-[calc(100%-3rem)]">
        {/* Left: Palette (collapsible to a narrow rail) */}
        {paletteRail ? (
          <div
            className="w-10 shrink-0 rounded-xl border flex flex-col items-center py-2 gap-2"
            style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
            data-palette-rail=""
          >
            <button type="button" onClick={() => setPaletteRailPersisted(false)}
              className="p-1.5 rounded-md transition-colors hover:bg-[var(--theme-surface)] focus-visible:outline-none focus-visible:ring-2"
              style={{ color: "var(--theme-muted-text)", ["--tw-ring-color" as string]: "var(--theme-focus-ring)" } as React.CSSProperties}
              title="Expand the node sidebar" aria-label="Expand the node sidebar" aria-expanded={false}>
              <PanelLeftOpen size={15} aria-hidden="true" />
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-rl] rotate-180 select-none" style={{ color: "var(--theme-muted-text)" }}>
              Nodes
            </span>
          </div>
        ) : (
        <div
          className="w-52 shrink-0 overflow-y-auto rounded-xl border p-3 space-y-3"
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
        >
        <NodePalette onAddNode={addNode} onAddCustomActivity={addCustomActivity} tenantId={tenantId} disabledNodeTypes={disabledNodeTypes} customActivities={customActivities}
          onCollapseSidebar={() => setPaletteRailPersisted(true)} />

          {/* Context Viewer */}
          <ContextViewer nodes={nodes} triggerType={effectiveTriggerType} />
        </div>
        )}

        {/* Center: Canvas — wrapped in an outer relative container so overlays
            (toggles, minimap, zoom, floating variable/expression panels) stay
            pinned to the viewport while the canvas content scrolls underneath. */}
        <div className="flex-1 relative min-w-0">
        <div
          ref={canvasRef}
          tabIndex={0}
          role="region"
          aria-label="Workflow canvas. Ctrl or Command plus wheel to zoom, space and drag to pan."
          data-workflow-canvas=""
          className={cn(
            "absolute inset-0 overflow-auto rounded-xl border transition-[background-color,border-color] focus-visible:outline-none focus-visible:ring-2",
            draggingFromPalette && "ring-2 ring-dashed",
            canvasView.cursorClass,
          )}
          style={{
            backgroundColor: draggingFromPalette ? "var(--theme-primary-light)" : "var(--theme-surface)",
            borderColor: draggingFromPalette ? "var(--theme-primary)" : "var(--theme-surface-border)",
            touchAction: "pan-x pan-y",
            // @ts-ignore
            "--tw-ring-color": draggingFromPalette ? "var(--theme-primary)" : "var(--theme-focus-ring)",
          }}
          {...canvasView.canvasHandlers}
          onClick={(e) => {
            // Don't cancel connect if the click originated from a branch port or node
            const target = e.target as HTMLElement
            if (target.closest('[data-branch-port]') || target.closest('[data-canvas-node]')) return
            if (connecting) cancelConnect()
            else { setSelectedNodeId(null); setSelectedNodeIds(new Set()); setSelectedEdgeId(null) }
          }}
        >
          {/* Grid background — rendered on parent via style below */}

          {/* Drop zone hint when dragging from palette */}
          {draggingFromPalette && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
              <div className="px-4 py-2 rounded-full text-sm font-medium animate-pulse"
                style={{ backgroundColor: "var(--theme-primary)", color: 'var(--theme-on-primary)', opacity: 0.7 }}>
                Drop here to add node
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
              backgroundImage: "radial-gradient(circle, var(--theme-surface-border) 1px, transparent 1px)",
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

          {/* Minimap */}
          <CanvasMinimap items={minimapItems} scrollRef={canvasRef} getView={canvasView.getView} onNavigate={canvasView.centreAt} />

          {/* Top-right toggle buttons */}
          <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); setShowExpressions(!showExpressions); if (!showExpressions) setShowVariables(false) }}
              className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:opacity-90"
              style={{
                backgroundColor: showExpressions ? "var(--theme-accent)" : "var(--theme-card-bg)",
                color: showExpressions ? 'var(--theme-on-accent)' : "var(--theme-accent-text)",
                border: `1px solid ${showExpressions ? "var(--theme-accent)" : "var(--theme-surface-border)"}`,
              }}
            >
              <Sparkles size={12} />
              Expressions
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowVariables(!showVariables); if (!showVariables) setShowExpressions(false) }}
              className="flex items-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-all hover:opacity-90"
              style={{
                backgroundColor: showVariables ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: showVariables ? 'var(--theme-on-primary)' : "var(--theme-primary-text)",
                border: `1px solid ${showVariables ? "var(--theme-primary)" : "var(--theme-surface-border)"}`,
              }}
            >
              <Variable size={12} />
              Variables
            </button>
          </div>

          {/* Floating panels */}
          <VariablesPanel open={showVariables} onClose={() => setShowVariables(false)} nodes={nodes} edges={edges} selectedNodeId={selectedNodeId} onInsertLoopBefore={insertLoopBeforeNode} userVariables={userVariables} triggerType={effectiveTriggerType} />
          <ExpressionsPanel open={showExpressions} onClose={() => setShowExpressions(false)} />

          {/* Zoom controls — bottom right */}
          <CanvasZoomControls
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

        {/* Docked Data sidebar: drag fields / outputs onto the config inputs */}
        {dataSidebarOpen && (
          <DataSidebar
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            workflowVariables={userVariables}
            onInsertLoopBefore={insertLoopBeforeNode}
            onClose={() => setDataSidebarOpen(false)}
          />
        )}

        {/* Right: Config panel */}
        <div
          className="w-72 shrink-0 overflow-y-auto rounded-xl border p-3 space-y-4 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl"
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
          data-no-dnd="true"
          onPointerDown={(e) => e.stopPropagation()}
          onDragOverCapture={markNativeDropTarget}
          onDragLeaveCapture={clearNativeDropTarget}
          onDropCapture={clearNativeDropTarget}
        >
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
              <div className="my-2" style={{ borderTop: "1px solid var(--theme-surface-border)" }} />
            </>
          )}

          {/* Workflow Variables + Swimlanes — show when no node selected */}
          {!selectedNode && (
            <>
              <UserVariablesEditor variables={userVariables} onChange={setUserVariables} />
              {(() => {
                const triggerNode = nodes.find((n) => TRIGGER_TYPES.includes(n.type)) ?? null
                return (
                  <div className="px-1 pb-1">
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
              <div className="my-2" style={{ borderTop: "1px solid var(--theme-surface-border)" }} />
              <SwimlaneManager swimlanes={swimlanes} onChange={setSwimlanes} />
              <div className="my-2" style={{ borderTop: "1px solid var(--theme-surface-border)" }} />
            </>
          )}

          <NodeConfigPanel workflowId={workflowId} node={selectedNode} onUpdateNode={updateNode} allNodes={nodes} allEdges={edges} onInsertLoopBefore={insertLoopBeforeNode} workflowVariables={userVariables} triggerType={effectiveTriggerType} customActivities={customActivities} dataSidebarOpen={dataSidebarOpen} onToggleDataSidebar={() => setDataSidebarOpen((open) => !open)} />
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
          return (
            <div className="w-56 rounded-2xl shadow-2xl opacity-90 pointer-events-none"
              style={{ border: `2px solid ${catalog.color}` }}>
              <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-t-2xl text-white text-xs font-medium"
                style={{ background: `linear-gradient(135deg, ${catalog.color}, ${catalog.color}DD)` }}>
                <Icon size={14} />
                <span>{catalog.label}</span>
              </div>
              <div className="px-3 py-2.5 text-[10px] rounded-b-2xl"
                style={{ backgroundColor: "var(--theme-card-bg)" }}>
                <p style={{ color: "var(--theme-muted-text)" }}>{catalog.description}</p>
              </div>
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
          onClose={() => { setShowTestRunner(false) }}
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
      {showPublishDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
              <h3 className="text-sm font-semibold">Publish Workflow</h3>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                Creates version {(currentVersion ?? 0) + 1}. In-flight processes will continue on their started version.
              </p>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Publish Notes (optional)</label>
                <textarea
                  value={publishNotes}
                  onChange={e => setPublishNotes(e.target.value)}
                  placeholder="What changed in this version?"
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-xs resize-none"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                />
              </div>
              {!validation.valid && (
                <div className="rounded-lg p-2.5 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}>
                  {validation.totalErrors} issue{validation.totalErrors !== 1 ? 's' : ''} must be resolved before publishing.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
              <Button size="sm" variant="ghost" onClick={() => { setShowPublishDialog(false); setPublishNotes('') }}>Cancel</Button>
              <Button size="sm" onClick={handlePublish} disabled={publishing || !validation.valid}>
                {publishing ? <><Loader2 size={14} className="mr-1 animate-spin" /> Publishing...</> : <><Upload size={14} className="mr-1" /> Publish</>}
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Permissions dialog */}
      {showPermissions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden p-6"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <ObjectPermissions objectType="workflow" objectId={workflowId} showExecute={true} />
            <div className="flex justify-end mt-4">
              <Button variant="outline" size="sm" onClick={() => setShowPermissions(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </DndContext>
    </div>
    </CanvasZoomContext.Provider>
    </WorkflowLookupsProvider>
    </LinkedFormsProvider>
    </ActiveInputProvider>
  )
}
