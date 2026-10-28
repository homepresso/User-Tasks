"use client"

import { useMemo, useState } from "react"
import { X } from "lucide-react"
import type { WorkflowNode, WorkflowEdge } from "@/lib/workflow-schema"
import { NODE_CATALOG } from "@/lib/workflow-schema"
import { resolveVisibleGraph } from "@/lib/workflow-sections"
import { EDGE_TONE_TOKEN, type EdgeRunTone } from "@/lib/workflow-run-overlay"
import { edgeHeatColor, type EdgeHeat } from "@/lib/workflow-heat-overlay"
import { DELETE_BUTTON_SIZE, deleteButtonPosition, GOTO_ROUTE_PREFIX, nodeBox, routeEdges, type EdgeRoute, type SizeMap } from "@/lib/workflow-edge-routing"

export const BRANCH_COLORS = ["#22C55E", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316", "#6B7280"]

interface EdgeRendererProps {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /** Measured card sizes; connector anchors follow them. */
  sizes?: SizeMap
  onDeleteEdge?: (id: string) => void
  /** The selected connection (highlighted, with its label and delete button). */
  selectedEdgeId?: string | null
  onSelectEdge?: (id: string) => void
  connecting: string | null
  isActive?: boolean
  /** Canvas zoom: the delete button keeps a usable on-screen size when zoomed out. */
  zoom?: number
  /** Viewers: no selection, hover or delete — the same routes, labels and arrows. */
  readOnly?: boolean
  /** Runtime overlay: connections the run took, coloured by how the target ended. */
  tones?: Record<string, EdgeRunTone>
  /** Marker id prefix (unique per canvas on the page). */
  markerPrefix?: string
  /** Heat overlay (reports): traversal counts — width, colour and a count label per connection. */
  heat?: Record<string, EdgeHeat>
}

/** Arrowhead markers sized in canvas units with the tip exactly at the path end (the target border). */
export function ArrowMarkers({ prefix, colors }: { prefix: string; colors: Record<string, string> }) {
  return (
    <defs>
      {Object.entries(colors).map(([key, fill]) => (
        <marker key={key} id={`${prefix}-${key}`} markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="8" refX="10" refY="4" orient="auto">
          <path d="M 0 0 L 10 4 L 0 8 z" style={{ fill }} />
        </marker>
      ))}
    </defs>
  )
}

export function labelWidth(label: string): number {
  return Math.round(label.length * 5.6) + 14
}

export function EdgeRenderer({ nodes, edges, sizes, onDeleteEdge, selectedEdgeId = null, onSelectEdge, connecting, isActive, zoom = 1, readOnly = false, tones, markerPrefix = "wf-arrow", heat }: EdgeRendererProps) {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null)

  const { routes, byId } = useMemo(() => {
    // Collapsed sections: edges to hidden members re-route to the section header.
    const { resolvedEdges, hiddenNodeIds } = resolveVisibleGraph(nodes, edges)
    const visible = nodes.filter((n) => !hiddenNodeIds.has(n.id))
    return {
      routes: routeEdges(visible, resolvedEdges, { sizes }),
      byId: new Map(nodes.map((n) => [n.id, n])),
    }
  }, [nodes, edges, sizes])

  const markerColors: Record<string, string> = { muted: "var(--theme-muted-text)", hover: "var(--theme-danger)" }
  BRANCH_COLORS.forEach((c, i) => { markerColors[`c${i}`] = c })
  for (const [tone, token] of Object.entries(EDGE_TONE_TOKEN)) markerColors[`run-${tone}`] = token
  if (heat) { markerColors.heat = "var(--theme-primary)"; markerColors["heat-idle"] = "var(--theme-muted-text)" }
  const sourceColorKeys = new Map<string, string>()
  for (const n of nodes) {
    const color = (n.config?.node_color as string | undefined) ?? NODE_CATALOG.find((c) => c.type === n.type)?.color ?? "#6B7280"
    const key = `n${color.replace(/[^a-zA-Z0-9]/g, "")}`
    markerColors[key] = color
    sourceColorKeys.set(n.id, key)
  }

  function styleOf(route: EdgeRoute) {
    const source = byId.get(route.source)
    // `text` is the label colour: a theme text token, never the raw branch / step colour
    // (an amber or cyan label on a white card, or a navy one on a dark card, fails AA).
    if (route.kind === "goto") return { color: "var(--theme-muted-text)", text: "var(--theme-muted-text)", marker: "muted", width: 1.75, opacity: 0.7, dash: "6 4" }
    if (route.branchIndex >= 0) {
      const i = route.branchIndex % BRANCH_COLORS.length
      return { color: BRANCH_COLORS[i], text: "var(--theme-card-text)", marker: `c${i}`, width: 2.25, opacity: 0.85, dash: undefined }
    }
    if (route.kind === "error") return { color: "var(--theme-danger)", text: "var(--theme-danger)", marker: "hover", width: 2, opacity: 0.75, dash: "5 3" }
    const key = source ? sourceColorKeys.get(source.id) ?? "muted" : "muted"
    return { color: markerColors[key], text: "var(--theme-card-text)", marker: key, width: 2, opacity: 0.55, dash: undefined }
  }

  // Hit target and delete button keep a usable on-screen size when zoomed out.
  const screenScale = Math.min(1, Math.max(0.1, zoom))
  const hitWidth = 14 / screenScale

  const selectedRoute = selectedEdgeId ? routes.find((r) => r.id === selectedEdgeId) ?? null : null
  const anySelected = !!selectedRoute

  return (
    <>
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%", overflow: "visible", zIndex: 0 }}
    >
      <ArrowMarkers prefix={markerPrefix} colors={markerColors} />

      {(isActive || tones) && (
        <style>{`
          @keyframes dashFlow {
            from { stroke-dashoffset: 20; }
            to { stroke-dashoffset: 0; }
          }
        `}</style>
      )}

      {routes.map((route) => {
        const isGoto = route.id.startsWith(GOTO_ROUTE_PREFIX)
        const edge = isGoto ? null : edges.find((e) => e.id === route.id) ?? null
        const isSelected = !readOnly && !isGoto && selectedEdgeId === route.id
        const isHovered = !readOnly && !isGoto && hoveredEdge === route.id && !isSelected
        const base = styleOf(route)
        // Runtime: a taken connection is drawn in its outcome colour, thicker, with a flow.
        const tone = tones?.[route.id] ?? (isGoto ? undefined : tones?.[`${route.source}->${route.target}`])
        const h = heat ? heat[route.id] ?? heat[`${route.source}->${route.target}`] : undefined
        const s = tone ? { ...base, color: EDGE_TONE_TOKEN[tone], marker: `run-${tone}`, width: 3, opacity: 0.9 }
          : heat ? { ...base, color: edgeHeatColor(h), marker: h && h.count > 0 ? "heat" : "heat-idle", width: h?.width ?? 1.5, opacity: 1, dash: undefined }
          : base
        const label = isGoto ? "Go to" : edge?.label
        // Branch edges are labelled by their chip; plain labelled edges (and the selected edge) get a badge.
        const showLabel = !!label && (route.branchIndex < 0 || isSelected)
        const lw = label ? labelWidth(label) : 0
        const dim = anySelected && !isSelected

        return (
          <g key={route.id}>
            {/* Dimming fades the lines only: labels stay at full contrast. */}
            <g opacity={dim ? 0.3 : 1} style={{ transition: "opacity 0.15s" }}>
            {!isGoto && !readOnly && (
              <path d={route.path} fill="none" stroke="transparent" strokeWidth={hitWidth}
                className="pointer-events-auto cursor-pointer"
                data-edge-id={route.id}
                onMouseEnter={() => setHoveredEdge(route.id)}
                onMouseLeave={() => setHoveredEdge(null)}
                onClick={(e) => { e.stopPropagation(); onSelectEdge?.(route.id) }}
              />
            )}

            {isSelected && (
              <path d={route.path} fill="none" stroke={s.color} strokeWidth={9} strokeOpacity={0.18} strokeLinejoin="round" strokeLinecap="round" />
            )}

            <path
              d={route.path} fill="none"
              stroke={s.color}
              strokeWidth={isSelected ? 3.25 : isHovered ? s.width + 1 : s.width}
              strokeOpacity={isSelected ? 1 : isHovered ? Math.min(1, s.opacity + 0.25) : s.opacity}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
              markerEnd={`url(#${markerPrefix}-${s.marker})`}
              style={{ transition: "stroke-width 0.15s, stroke-opacity 0.15s" }}
            />

            {tone && (
              <path d={route.path} fill="none" stroke={s.color} strokeWidth={2} opacity={0.35} strokeDasharray="8 6"
                data-run-flow={tone}
                style={{ animation: "dashFlow 1.6s linear infinite" }} />
            )}

            {isActive && !tone && !isSelected && !isGoto && (
              <path
                d={route.path} fill="none"
                stroke={s.color}
                strokeWidth={1.5}
                opacity={0.3}
                strokeDasharray="6 4"
                style={{ animation: "dashFlow 1s linear infinite" }}
              />
            )}
            </g>

            {h && h.count > 0 && (() => {
              const text = String(h.count)
              const w = labelWidth(text)
              const x = route.labelX + (showLabel ? lw / 2 + 4 : 10)
              return (
                <g className="pointer-events-none" data-edge-heat={h.count}>
                  <rect x={x} y={route.labelY - 8} width={w} height={16} rx={8} ry={8}
                    style={{ fill: "var(--theme-card-bg)", stroke: "var(--theme-primary)" }} strokeWidth={1} />
                  <text x={x + w / 2} y={route.labelY + 0.5} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9.5" fontWeight="700" style={{ fill: "var(--theme-card-text)" }}>
                    {text}
                  </text>
                </g>
              )
            })()}

            {showLabel && label && (
              <g className="pointer-events-none">
                <rect x={route.labelX - lw / 2} y={route.labelY - 8} width={lw} height={16} rx={8} ry={8}
                  style={{ fill: "var(--theme-card-bg)" }} stroke={s.color} strokeWidth={isSelected ? 1.5 : 1} strokeOpacity={isSelected ? 1 : 0.6} />
                <text x={route.labelX} y={route.labelY + 0.5} textAnchor="middle" dominantBaseline="middle"
                  fontSize="9.5" fontWeight="600" style={{ fill: s.text }}>
                  {label}
                </text>
              </g>
            )}
          </g>
        )
      })}

      {connecting && (() => {
        const source = byId.get(connecting)
        if (!source) return null
        const box = nodeBox(source, sizes)
        return <circle cx={box.x + box.width / 2} cy={box.y + box.height + 4} r="4"
          fill="var(--theme-primary)" className="animate-ping" opacity="0.6" />
      })()}
    </svg>

    {/* Delete button of the selected connection — a real button beside (not on) the line. */}
    {selectedRoute && !readOnly && onDeleteEdge && (() => {
      const edge = edges.find((e) => e.id === selectedRoute.id)
      const size = DELETE_BUTTON_SIZE / screenScale
      const pos = deleteButtonPosition(selectedRoute, edge?.label ? labelWidth(edge.label) : 0, size)
      const from = byId.get(selectedRoute.source)?.label || "step"
      const to = byId.get(selectedRoute.target)?.label || "step"
      return (
        <button
          type="button"
          data-edge-delete={selectedRoute.id}
          aria-label={`Delete connection from ${from} to ${to}`}
          title="Delete connection"
          className="absolute flex items-center justify-center rounded-full shadow-md transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{
            left: pos.x - size / 2, top: pos.y - size / 2, width: size, height: size,
            backgroundColor: "var(--theme-danger)", color: "var(--theme-on-danger)", zIndex: 40,
            // @ts-expect-error CSS custom properties for the focus ring
            "--tw-ring-color": "var(--theme-focus-ring)", "--tw-ring-offset-color": "var(--theme-card-bg)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDeleteEdge(selectedRoute.id) }}
        >
          <X size={Math.round(size * 0.6)} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )
    })()}
    </>
  )
}

