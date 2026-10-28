"use client"

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Maximize2, Minimize2 } from "lucide-react"
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-schema"
import { nodeBox } from "@/lib/workflow-edge-routing"
import { unionBounds } from "@/lib/canvas-zoom"
import { EdgeRenderer } from "@/components/automations/edge-renderer"
import { WorkflowNodeCard } from "@/components/automations/workflow-node-card"
import { WorkflowLookupsContext } from "@/components/automations/workflow-lookups"
import { useNodeSizes } from "@/components/automations/use-node-sizes"

const PAD = 48

/**
 * Read-only drawing of a packaged workflow with the designer's own step
 * cards and connector routing (WorkflowNodeCard + EdgeRenderer), scaled to
 * the page width. No data loading: names come from the package itself.
 */
export function WorkflowPreview({ nodes, edges, tableNames, label, markerPrefix }: {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  tableNames?: Record<string, string>
  label: string
  markerPrefix: string
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const sizes = useNodeSizes(contentRef, nodes.map((n) => n.id).join("|"))
  const visible = useMemo(() => nodes.filter((n) => n.type !== "section_group"), [nodes])

  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bounds = unionBounds(visible.map((n) => nodeBox(n, sizes))) ?? { x: 0, y: 0, width: 600, height: 400 }
  const box = { x: bounds.x - PAD, y: bounds.y - PAD, width: bounds.width + PAD * 2, height: bounds.height + PAD * 2 + 24 }
  // Fit the width; never enlarge; keep cards legible on phones (scroll sideways instead).
  const fit = width ? Math.min(1, width / box.width) : 0.6
  // Long flows: shrink a little so more of the process is visible at once (never below ~0.55 of the card size).
  const scale = expanded ? Math.max(fit, 0.85) : Math.max(Math.min(fit, Math.max(0.78, 900 / box.height)), 0.42)

  return (
    <WorkflowLookupsContext.Provider value={{ tableNames: tableNames ?? {} }}>
      <div className="relative">
        <div
          ref={wrapperRef}
          role="img"
          aria-label={label}
          className={`overflow-auto rounded-2xl border border-[#1B1916]/[0.09] ${expanded ? "max-h-none" : "max-h-[760px]"}`}
          style={{
            backgroundColor: "#F5F2EA",
            backgroundImage: "radial-gradient(circle, #E3DDCF 1px, transparent 1px)",
            backgroundSize: `${20 * scale}px ${20 * scale}px`,
          }}
        >
          <div style={{ width: box.width * scale, height: box.height * scale, position: "relative", margin: "0 auto" }}>
            <div
              ref={contentRef}
              style={{ position: "absolute", left: 0, top: 0, width: box.width, height: box.height, transform: `scale(${scale}) translate(${-box.x}px, ${-box.y}px)`, transformOrigin: "0 0" }}
              aria-hidden="true"
            >
              <EdgeRenderer nodes={visible} edges={edges} sizes={sizes} connecting={null} readOnly tones={{}} zoom={scale} markerPrefix={markerPrefix} />
              {visible.map((node) => (
                <WorkflowNodeCard
                  key={node.id}
                  node={node}
                  workflowActive
                  style={{ position: "absolute", left: node.position.x, top: node.position.y, zIndex: 1 }}
                />
              ))}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg border border-[#1B1916]/15 bg-[#FFFFFF]/95 px-2.5 py-1.5 text-xs font-semibold text-[#33302A] shadow-sm hover:border-[#1B1916]/30"
        >
          {expanded ? <Minimize2 size={13} aria-hidden="true" /> : <Maximize2 size={13} aria-hidden="true" />}
          {expanded ? "Fit" : "Larger"}
        </button>
      </div>
    </WorkflowLookupsContext.Provider>
  )
}
