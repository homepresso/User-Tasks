"use client"

import { useContext, useRef } from "react"
import { useDraggable } from "@dnd-kit/core"
import type { PortSide, WorkflowNode } from "@/lib/workflow-schema"
import { CanvasZoomContext, scaledDragTransform } from "./use-canvas-zoom"
import { WorkflowNodeCard, NODE_ICON_MAP } from "./workflow-node-card"

interface CanvasNodeProps {
  node: WorkflowNode
  isSelected: boolean
  isConnecting: boolean
  connectingSource: string | null
  isActive?: boolean
  dimmed?: boolean
  /** A selected connection highlights the two steps it joins and fades the rest. */
  emphasis?: 'highlight' | 'fade'
  onSelect: (e?: React.MouseEvent) => void
  onDelete: () => void
  onStartConnect: (branchLabel?: string, port?: PortSide) => void
  onFinishConnect: () => void
}

/**
 * A step on the designer canvas: the shared WorkflowNodeCard made draggable
 * (dnd-kit), selectable and connectable. Viewers render the same card
 * read-only with a runtime overlay.
 */
export function CanvasNode({
  node, isSelected, isConnecting, connectingSource, isActive, dimmed = false, emphasis,
  onSelect, onDelete, onStartConnect, onFinishConnect,
}: CanvasNodeProps) {
  const wasDragged = useRef(false)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: node.id })
  const zoom = useContext(CanvasZoomContext)
  const isDropTarget = isConnecting && connectingSource !== node.id

  const style: React.CSSProperties = {
    position: "absolute",
    left: node.position.x,
    top: node.position.y,
    zIndex: isDragging ? 50 : isSelected || emphasis === 'highlight' ? 10 : 1,
    transform: scaledDragTransform(transform, zoom),
    transition: isDragging ? undefined : "box-shadow 0.2s ease, opacity 0.15s ease",
    // Faded steps (an edge is selected elsewhere) lose their colour, not their contrast:
    // no opacity (muted body text sits near 4.5:1), and grayscale keeps the header's luminance.
    opacity: isDragging ? 0.85 : dimmed ? 0.55 : 1,
    // The highlight ring uses the focus-ring token (3:1 on the surface and on cards in every theme).
    boxShadow: emphasis === 'highlight'
      ? "0 0 0 3px var(--theme-focus-ring), 0 0 22px color-mix(in srgb, var(--theme-focus-ring) 40%, transparent)"
      : undefined,
    willChange: isDragging ? "transform" : undefined,
    filter: dimmed ? "grayscale(0.5)" : emphasis === 'fade' ? "grayscale(1)" : undefined,
  }

  // eslint-disable-next-line react-hooks/refs -- drag flag read by the click that ends the drag
  if (isDragging) wasDragged.current = true

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (wasDragged.current) {
      wasDragged.current = false
      return
    }
    // When in connect mode, clicking anywhere on a target node completes the connection
    if (isDropTarget) {
      e.preventDefault()
      onFinishConnect()
      return
    }
    onSelect(e)
  }

  function handleMouseDown(e: React.MouseEvent) {
    // Also handle connection on mousedown for faster response
    if (isDropTarget) {
      e.stopPropagation()
      e.preventDefault()
      onFinishConnect()
    }
  }

  return (
    <WorkflowNodeCard
      node={node}
      selected={isSelected}
      emphasis={emphasis}
      workflowActive={isActive}
      dragging={isDragging}
      connect={{ isConnecting, connectingSource, onStartConnect, onFinishConnect }}
      onDelete={onDelete}
      rootRef={setNodeRef}
      style={style}
      rootProps={{
        "data-canvas-node": "true",
        onMouseDown: handleMouseDown,
        onClick: handleClick,
        onDoubleClick: (e) => {
          e.stopPropagation()
          onSelect(e)
          // Toggle collapsed via a custom event the builder listens for
          window.dispatchEvent(new CustomEvent('toggle-collapse', { detail: { nodeId: node.id } }))
        },
      }}
      headerProps={{ ...attributes, ...listeners }}
    />
  )
}

export { NODE_ICON_MAP }
