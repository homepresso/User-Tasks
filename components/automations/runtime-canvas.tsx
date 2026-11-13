"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { Crosshair, Maximize2, Minimize2, X } from "lucide-react"
import { fullNodeCatalog, type WorkflowEdge, type WorkflowNode } from "@/lib/workflow-schema"
import { getSectionNodes, resolveVisibleGraph } from "@/lib/workflow-sections"
import { nodeBox } from "@/lib/workflow-edge-routing"
import { unionBounds } from "@/lib/canvas-zoom"
import { FOCUS_STEP_LABEL, formatRunDuration, joinWaitingLabel, pickFocusStep, RUN_STATUS_LABEL, RUN_STATUS_TOKENS, type EdgeRunTone, type RunNodeResult, type RunOverlay } from "@/lib/workflow-run-overlay"
import { heatColor, heatSummary, type HeatOverlay } from "@/lib/workflow-heat-overlay"
import { EdgeRenderer } from "./edge-renderer"
import { WorkflowNodeCard } from "./workflow-node-card"
import { CanvasBands, SectionFrame } from "./canvas-sections"
import { CanvasZoomControls } from "./canvas-zoom-controls"
import { CanvasMinimap, type MinimapItem } from "./canvas-minimap"
import { useCanvasZoom } from "./use-canvas-zoom"
import { useNodeSizes } from "./use-node-sizes"
import { WorkflowLookupsProvider } from "./workflow-lookups"
import type { SummaryLookups } from "@/lib/workflow-utils"
import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"

/** Dot grid spacing of the background (visual only: positions are not snapped here). */
const GRID = 16
const NO_RUN: RunOverlay = { nodes: {}, edges: {}, traversed: new Set() }
const NO_RESULTS: Record<string, RunNodeResult | undefined> = {}
const subscribeNever = () => () => {}

interface Lane { id: string; label: string; color: string; y: number; height: number }

export interface RuntimeCanvasProps {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  swimlanes?: Lane[]
  /** The run drawn on the cards (Save & Test, run detail); omit for a heat map. */
  overlay?: RunOverlay
  nodeResults?: Record<string, RunNodeResult | undefined>
  /** Aggregate heat overlay (reports' process map) instead of a single run. */
  heat?: HeatOverlay
  workflowActive?: boolean
  /** The previews of one workflow share a remembered zoom (sessionStorage `preview:<id>`). */
  workflowId?: string
  /** sessionStorage scope of the view; defaults to the workflow's preview scope. */
  storageScope?: string
  /** Element whose focus enables the zoom shortcuts. */
  rootRef?: React.RefObject<HTMLElement | null>
  /** External handle on the scroll container (e.g. to scroll a step into view). */
  scrollRef?: React.RefObject<HTMLDivElement | null>
  nodeRef?: (id: string, el: HTMLDivElement | null) => void
  /** Extra outline per step (e.g. anomaly suspects), a CSS colour. */
  outlines?: Record<string, string | undefined>
  selectedNodeId?: string | null
  onSelectNode?: (id: string | null) => void
  /** Content drawn just above a step's card (e.g. who has its task and the open-task icon). */
  nodeAdornments?: Record<string, React.ReactNode>
  /** Extra content in the step details panel (e.g. a waiting step's event id). */
  renderDetails?: (node: WorkflowNode) => React.ReactNode
  /** Fill the parent's height (the parent must have one); otherwise `height` applies. */
  fill?: boolean
  /** CSS height when not filling. */
  height?: string
  minHeight?: number
  /** Zoom to this step (and open its details unless `details: false`); a new nonce repeats it. */
  focusRequest?: { nodeId: string; nonce: number; details?: boolean } | null
  /** Show the full-screen toggle (default true). */
  expandable?: boolean
  markerPrefix?: string
  label?: string
  /** The built-in step details panel (output, error) on click; off for the submitter-safe view (default true). */
  stepDetails?: boolean
  /** Card lookups (data table names) to use instead of loading them; the submitter-safe view passes {}. */
  lookups?: SummaryLookups
}

/** Height of a run preview that isn't inside a sized container: about one screen. */
export const RUNTIME_CANVAS_SCREEN_HEIGHT = "max(520px, calc(100dvh - 140px))"

/**
 * Read-only canvas of a workflow run: the designer's cards, sections, bands
 * and connector routing, with the run drawn as an overlay. Used by every
 * execution preview (Save & Test, run detail, run compare, instance
 * migration). Opens fitted but never below a readable zoom (else on the
 * failed / current step), with the designer's zoom controls, minimap,
 * zoom-to-step and a full-screen toggle.
 */
export function RuntimeCanvas({
  nodes, edges, swimlanes = [], overlay = NO_RUN, nodeResults = NO_RESULTS, heat, workflowActive = false, workflowId, storageScope, rootRef, scrollRef: externalScrollRef,
  nodeRef, outlines, nodeAdornments, selectedNodeId: controlledSelected, onSelectNode, renderDetails, fill = false, height = RUNTIME_CANVAS_SCREEN_HEIGHT, minHeight = 360,
  focusRequest, expandable = true, markerPrefix = "rt-arrow", label = "Workflow run canvas", stepDetails = true, lookups,
}: RuntimeCanvasProps) {
  const internalScrollRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = externalScrollRef ?? internalScrollRef
  const contentRef = useRef<HTMLDivElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [localSections, setLocalSections] = useState<Record<string, boolean>>({})
  const [internalSelected, setInternalSelected] = useState<string | null>(null)
  const selectedNodeId = controlledSelected !== undefined ? controlledSelected : internalSelected
  const select = (id: string | null) => { if (onSelectNode) onSelectNode(id); else setInternalSelected(id) }
  const isMac = useSyncExternalStore(subscribeNever, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false)

  // Viewer-local section collapse state over the saved one.
  const effectiveNodes = useMemo(
    () => nodes.map((n) => (n.type === "section_group" && localSections[n.id] !== undefined ? { ...n, collapsed: localSections[n.id] } : n)),
    [nodes, localSections],
  )
  const { hiddenNodeIds, resolvedEdges } = useMemo(() => resolveVisibleGraph(effectiveNodes, edges), [effectiveNodes, edges])
  const sizes = useNodeSizes(contentRef, `${effectiveNodes.map((n) => `${n.id}${n.collapsed ? "c" : ""}`).join("|")}`)

  // Tones for the routed edges (collapsed sections re-route edges to their header).
  const tones = useMemo(() => {
    const t: Record<string, EdgeRunTone> = { ...overlay.edges }
    for (const e of resolvedEdges) {
      if (t[e.id] || !overlay.traversed.has(e.source) || !overlay.traversed.has(e.target)) continue
      const target = overlay.nodes[e.target]
      t[e.id] = target?.status === "failed" ? "danger" : target?.status === "waiting" || target?.status === "running" ? "warning" : "success"
    }
    return t
  }, [overlay, resolvedEdges])

  const visibleBoxes = () => effectiveNodes.filter((n) => !hiddenNodeIds.has(n.id)).map((n) => ({ ...nodeBox(n, sizes), node: n }))

  const focusStep = useMemo(() => pickFocusStep(effectiveNodes.filter((n) => !hiddenNodeIds.has(n.id)), resolvedEdges, overlay), [effectiveNodes, hiddenNodeIds, resolvedEdges, overlay])
  const boxOf = (id: string) => {
    const n = effectiveNodes.find((x) => x.id === id)
    if (!n) return null
    // A step inside a collapsed section: its section header.
    const section = hiddenNodeIds.has(n.id) && n.sectionId ? effectiveNodes.find((x) => x.id === n.sectionId) : null
    return nodeBox(section ?? n, sizes)
  }

  const view = useCanvasZoom({
    scrollRef,
    contentRef,
    rootRef: rootRef ?? wrapRef,
    storageScope: storageScope ?? (workflowId ? `preview:${workflowId}` : undefined),
    getContentBounds: () => unionBounds(visibleBoxes()),
    getSelectionBounds: () => (selectedNodeId ? boxOf(selectedNodeId) : null),
    getFocusBounds: () => (focusStep ? boxOf(focusStep.id) : null),
    preview: {},
  })

  // Zoom to a step picked in a step list / log line (keyed on the nonce: a
  // repeat click re-focuses; StrictMode's re-run restarts the animation).
  const focusNonce = focusRequest?.nonce
  const [seenFocus, setSeenFocus] = useState<number | undefined>(undefined)
  if (focusRequest && seenFocus !== focusNonce) {
    // Open the step's details with the request (state derived during render).
    setSeenFocus(focusNonce)
    if (focusRequest.details !== false && !onSelectNode) setInternalSelected(focusRequest.nodeId)
  }
  useEffect(() => {
    if (!focusRequest) return
    const box = boxOf(focusRequest.nodeId)
    if (!box) return
    if (focusRequest.details !== false) onSelectNode?.(focusRequest.nodeId)
    view.focusBounds(box)
  }, [focusNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  // Full screen: Escape leaves it (a step details panel closes first: it stops the event).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.closest?.('[data-step-details], [role="menu"]')) return
      e.preventDefault()
      e.stopPropagation()
      setExpanded(false)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [expanded])

  const maxX = Math.max(600, ...effectiveNodes.map((n) => nodeBox(n, sizes)).map((b) => b.x + b.width))
  const maxY = Math.max(400, ...effectiveNodes.map((n) => nodeBox(n, sizes)).map((b) => b.y + b.height), ...swimlanes.map((l) => l.y + l.height))
  const triggerTypes: string[] = fullNodeCatalog().filter((c) => c.category === "trigger").map((c) => c.type)
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null

  const minimapItems: MinimapItem[] = visibleBoxes().map(({ node: n, ...box }) => {
    const status = overlay.nodes[n.id]?.status
    const h = heat?.nodes[n.id]
    return {
      ...box,
      id: n.id,
      color: h ? heatColor(h) : status && status !== "not_run" && status !== "skipped" ? RUN_STATUS_TOKENS[status].fill : "var(--theme-muted-text)",
      selected: n.id === selectedNodeId,
    }
  })

  return (
    <WorkflowLookupsProvider value={lookups}>
    <div
      ref={wrapRef}
      data-runtime-canvas-root=""
      data-expanded={expanded ? "" : undefined}
      className={expanded ? "fixed inset-0 z-[70] p-3 flex flex-col" : `relative flex flex-col ${fill ? "flex-1 h-full min-h-0" : ""}`}
      style={expanded ? { backgroundColor: "var(--theme-overlay)" } : undefined}
      role={expanded ? "dialog" : undefined}
      aria-modal={expanded ? true : undefined}
      aria-label={expanded ? `${label} (full screen)` : undefined}
    >
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        role="region"
        aria-label={`${label}. Ctrl or Command plus wheel to zoom, space and drag to pan, Shift+3 for the ${focusStep?.kind === "failed" ? "failed" : focusStep?.kind === "current" ? "current" : "first"} step.`}
        data-runtime-canvas=""
        className={`rounded-lg border border-border bg-bg overflow-auto ${expanded || fill ? "flex-1 min-h-0" : ""} ${view.cursorClass}`}
        style={{
          ...(expanded || fill ? { minHeight: Math.min(minHeight, 240) } : { height, minHeight }),
          touchAction: "pan-x pan-y",
        }}
        {...view.canvasHandlers}
        onClick={(e) => {
          const t = e.target as HTMLElement
          if (!t.closest("[data-node-card]") && !t.closest("[data-step-details]")) select(null)
        }}
      >
        <div
          ref={contentRef}
          data-canvas-bg="true"
          className="relative"
          style={{
            // Room around the drawing so zooming around the pointer can keep it fixed.
            width: Math.max(maxX + 800, 2400),
            height: Math.max(maxY + 600, 1600),
            transform: view.transform,
            transformOrigin: "0 0",
            backgroundImage: "radial-gradient(circle, var(--ds-border-subtle) 1px, transparent 1px)",
            backgroundSize: `${GRID}px ${GRID}px`,
          }}
        >
          <CanvasBands showTriggerZone={nodes.some((n) => triggerTypes.includes(n.type))} swimlanes={swimlanes} />

          <EdgeRenderer nodes={effectiveNodes} edges={edges} sizes={sizes} connecting={null} readOnly tones={heat ? undefined : tones} heat={heat?.edges} zoom={view.zoom} markerPrefix={markerPrefix} />

          {getSectionNodes(effectiveNodes).map((section) => {
            const members = nodes.filter((n) => n.sectionId === section.id)
            const statuses = members.map((n) => overlay.nodes[n.id]?.status).filter(Boolean)
            const tone = statuses.includes("failed") ? "danger" as const
              : statuses.length > 0 && statuses.every((s) => s === "completed") ? "success" as const : undefined
            return (
              <SectionFrame
                key={section.id}
                section={section}
                collapsed={!!section.collapsed}
                nodeCount={members.length}
                tone={tone}
                onToggle={() => setLocalSections((prev) => ({ ...prev, [section.id]: !section.collapsed }))}
              />
            )
          })}

          {effectiveNodes.filter((n) => n.type !== "section_group" && !hiddenNodeIds.has(n.id)).map((node) => {
            const outline = outlines?.[node.id]
            return (
              <WorkflowNodeCard
                key={node.id}
                node={node}
                run={heat ? undefined : overlay.nodes[node.id]}
                heat={heat?.nodes[node.id]}
                selected={selectedNodeId === node.id}
                workflowActive={workflowActive}
                rootRef={(el) => nodeRef?.(node.id, el)}
                style={{
                  position: "absolute",
                  left: node.position.x,
                  top: node.position.y,
                  zIndex: selectedNodeId === node.id || overlay.nodes[node.id]?.current ? 10 : 1,
                  cursor: "pointer",
                  outline: outline ? `3px solid ${outline}` : undefined,
                  // Past the status / heat ring (2px gap + 2–3px ring).
                  outlineOffset: outline ? 6 : undefined,
                }}
                rootProps={{
                  role: "button",
                  tabIndex: 0,
                  "aria-label": `${node.label}: ${heat?.nodes[node.id] ? heatSummary(heat.nodes[node.id], formatRunDuration) : (overlay.nodes[node.id]?.joinWaiting ? joinWaitingLabel(overlay.nodes[node.id]!.joinWaiting!) : RUN_STATUS_LABEL[overlay.nodes[node.id]?.status ?? "not_run"])}. Show step details`,
                  onClick: (e) => { e.stopPropagation(); select(selectedNodeId === node.id ? null : node.id) },
                  onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(selectedNodeId === node.id ? null : node.id) } },
                }}
              />
            )
          })}

          {nodeAdornments && effectiveNodes.filter((n) => n.type !== "section_group" && !hiddenNodeIds.has(n.id) && nodeAdornments[n.id]).map((node) => (
            <div
              key={`adorn-${node.id}`}
              data-node-adornment={node.id}
              className="pointer-events-none absolute"
              style={{ left: node.position.x, top: node.position.y - 6, transform: "translateY(-100%)", zIndex: 12 }}
              onClick={(e) => e.stopPropagation()}
            >
              {nodeAdornments[node.id]}
            </div>
          ))}
        </div>
      </div>

      <CanvasMinimap items={minimapItems} scrollRef={scrollRef} getView={view.getView} onNavigate={view.centreAt} />
      {/* Top-right: always on screen, even when the preview is taller than the dialog / window. */}
      <CanvasZoomControls
        className="absolute top-3 right-3 z-20"
        placement="top"
        zoom={view.zoom}
        isMac={isMac}
        onZoomIn={view.zoomIn}
        onZoomOut={view.zoomOut}
        onZoomTo={(z) => view.zoomTo(z)}
        onFit={() => view.fitContent()}
        onFitSelection={view.fitSelection}
        hasSelection={!!selectedNodeId}
        onFocusStep={focusStep ? () => { view.fitFocus() } : undefined}
        focusStepLabel={focusStep ? FOCUS_STEP_LABEL[focusStep.kind] : undefined}
      >
        {expandable && (
          <IconButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setExpanded((x) => !x)}
            aria-pressed={expanded}
            label={expanded ? "Exit full screen (Esc)" : "Full screen"}
            tooltipSide="bottom"
            data-canvas-expand=""
            className="rounded-lg bg-elevated text-fg shadow-elev-2"
            icon={expanded ? <Minimize2 /> : <Maximize2 />}
          />
        )}
      </CanvasZoomControls>

      {selectedNode && stepDetails && (
        <StepDetails node={selectedNode} result={nodeResults[selectedNode.id]} overlay={overlay} heat={heat} onClose={() => select(null)} extra={renderDetails?.(selectedNode)} />
      )}
    </div>
    </div>
    </WorkflowLookupsProvider>
  )
}

/** Resolve a log line's step: its node id, else a unique label match. */
export function logStepId(log: { node_id?: string | null; node_label?: string | null }, nodes: Array<{ id: string; label?: string }>): string | null {
  if (log.node_id && nodes.some((n) => n.id === log.node_id)) return log.node_id
  if (!log.node_label) return null
  const matches = nodes.filter((n) => n.label === log.node_label)
  return matches.length === 1 ? matches[0].id : null
}

/** A step name in a step list / log line that zooms the run canvas to that step. */
export function StepChip({ label, onFocus }: { label: string; onFocus?: () => void }) {
  const chip = "text-2xs px-1 py-0.5 rounded-sm shrink-0 bg-subtle text-fg-muted"
  if (!onFocus) return <span className={chip}>{label}</span>
  return (
    <Tooltip content={`Show ${label} on the canvas`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFocus() }}
        className={`${chip} inline-flex items-center gap-1 hover:text-fg hover:underline`}
        aria-label={`Show ${label} on the canvas`}
        data-step-chip=""
      >
        <Crosshair size={12} aria-hidden="true" />
        {label}
      </button>
    </Tooltip>
  )
}

function StepDetails({ node, result, overlay, heat, onClose, extra }: { node: WorkflowNode; result: RunNodeResult | undefined; overlay: RunOverlay; heat?: HeatOverlay; onClose: () => void; extra?: React.ReactNode }) {
  if (heat) return <HeatDetails node={node} heat={heat} onClose={onClose} extra={extra} />
  const o = overlay.nodes[node.id]
  const status = o?.status ?? "not_run"
  const tokens = RUN_STATUS_TOKENS[status]
  const output = result?.output
  return (
    <div
      data-step-details=""
      role="dialog"
      aria-label={`Step details: ${node.label}`}
      className="absolute top-14 right-3 z-30 w-80 max-w-[calc(100%-24px)] max-h-[calc(100%-128px)] overflow-y-auto rounded-lg border border-border bg-elevated text-fg shadow-elev-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose() } }}
    >
      <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 border-b border-border-subtle">
        <span className="text-ui font-semibold flex-1 truncate">{node.label}</span>
        <span className="inline-flex items-center h-5 shrink-0 text-2xs font-medium rounded-full px-2" style={{ backgroundColor: tokens.fill, color: tokens.on }}>
          {RUN_STATUS_LABEL[status]}
        </span>
        <IconButton type="button" size="sm" onClick={onClose} label="Close step details" icon={<X />} />
      </div>
      <dl className="px-3 py-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">Duration</dt>
        <dd className="num">{o?.durationMs != null ? formatRunDuration(o.durationMs) : "—"}</dd>
        <dt className="text-fg-muted">Visits</dt>
        <dd className="num">{o?.visits ?? (result ? 1 : 0)}</dd>
        {o?.takenBranches && (<>
          <dt className="text-fg-muted">Took</dt>
          <dd>{o.takenBranches.join(", ")}</dd>
        </>)}
        {o?.joinWaiting && (<>
          <dt className="text-fg-muted">Join</dt>
          <dd>{joinWaitingLabel(o.joinWaiting)}{o.joinWaiting.waitingFor.length > 0 ? `: ${o.joinWaiting.waitingFor.join(", ")}` : ""}</dd>
        </>)}
      </dl>
      {result?.error && (
        <div className="mx-3 mb-2 rounded-md px-2 py-1.5 text-xs bg-danger-wash text-danger">
          {String(result.error)}
        </div>
      )}
      {extra}
      <div className="px-3 pb-3">
        <p className="text-xs font-medium text-fg-muted mb-1">Output</p>
        {output && Object.keys(output).length > 0 ? (
          <pre className="text-2xs font-mono whitespace-pre-wrap break-all rounded-md p-2 max-h-64 overflow-auto bg-subtle text-fg">
            {JSON.stringify(output, null, 2)}
          </pre>
        ) : (
          <p className="text-xs text-fg-muted">{result ? "No output" : "This step did not run."}</p>
        )}
      </div>
    </div>
  )
}

function HeatDetails({ node, heat, onClose, extra }: { node: WorkflowNode; heat: HeatOverlay; onClose: () => void; extra?: React.ReactNode }) {
  const h = heat.nodes[node.id]
  return (
    <div
      data-step-details=""
      role="dialog"
      aria-label={`Step statistics: ${node.label}`}
      className="absolute top-14 right-3 z-30 w-72 max-w-[calc(100%-24px)] rounded-lg border border-border bg-elevated text-fg shadow-elev-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose() } }}
    >
      <div className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 border-b border-border-subtle">
        <span className="text-ui font-semibold flex-1 truncate">{node.label}</span>
        <IconButton type="button" size="sm" onClick={onClose} label="Close step statistics" icon={<X />} />
      </div>
      <dl className="px-3 py-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-fg-muted">Visits</dt>
        <dd className="num">{h?.count ?? 0}{h && heat.maxNodeCount > 0 ? ` (${Math.round(h.ratio * 100)}% of the busiest step)` : ""}</dd>
        <dt className="text-fg-muted">Avg duration</dt>
        <dd className="num">{h?.avgDurationMs != null ? formatRunDuration(h.avgDurationMs) : "—"}</dd>
        <dt className="text-fg-muted">Error rate</dt>
        <dd className={h && h.errors > 0 ? "num text-danger" : "num"}>
          {h?.errorRate != null ? `${(h.errorRate * 100).toFixed(h.errorRate > 0 && h.errorRate < 0.01 ? 1 : 0)}% (${h.errors})` : "—"}
        </dd>
      </dl>
      {extra}
    </div>
  )
}
