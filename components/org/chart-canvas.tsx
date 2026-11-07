'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Minus, Plus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import {
  centreOn, edgePath, fitView, layoutChart, NODE_H, NODE_W, visibleNodes, zoomAt,
  type ChartLayout, type ChartTree, type Viewport,
} from './chart-layout'

export interface ChartCanvasProps {
  tree: ChartTree
  expanded: ReadonlySet<string>
  onToggle: (id: string) => void
  renderNode: (id: string) => ReactNode
  /** Accessible name of a node's expand button ("Show 5 reports"). */
  toggleLabel?: (id: string, count: number, expanded: boolean) => string
  /** Centre on this node whenever `nonce` changes. */
  centre?: { id: string; nonce: number } | null
  selectedId?: string | null
  /** Toolbar content (left side). */
  toolbar?: ReactNode
  className?: string
  /** Canvas height (CSS). */
  height?: string
  ariaLabel: string
}

/**
 * Pan / zoom canvas for a tree laid out by chart-layout. Only expanded
 * subtrees are laid out, and only nodes inside the viewport are rendered,
 * so a 2,000-node org stays smooth. Drag (or trackpad scroll) pans,
 * ctrl / ⌘ + wheel (or pinch) and the buttons zoom.
 */
export function ChartCanvas({ tree, expanded, onToggle, renderNode, toggleLabel, centre, selectedId, toolbar, className, height = 'calc(100vh - 260px)', ariaLabel }: ChartCanvasProps) {
  const layout = useMemo(() => layoutChart(tree, expanded), [tree, expanded])
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<Viewport>({ x: 24, y: 24, k: 1 })
  const fitted = useRef(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // First measurement: fit, but never smaller than readable; then start at the top of the first root.
  useEffect(() => {
    if (fitted.current || !size.width || !layout.nodes.length) return
    fitted.current = true
    const fit = fitView(layout, size)
    if (fit.k >= 0.6) { setView(fit); return }
    const first = layout.nodes[0]
    setView({ k: 0.6, x: size.width / 2 - (first.x + NODE_W / 2) * 0.6, y: 24 })
  }, [layout, size])

  useEffect(() => {
    if (!centre || !size.width) return
    const next = centreOn(layout, centre.id, size, Math.max(view.k, 0.8))
    if (next) setView(next)
    // Centre only when asked (nonce), not on every layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre?.nonce, centre?.id, size.width > 0, layout.byId.has(centre?.id ?? '')])

  // Wheel: ctrl / ⌘ (and trackpad pinch) zooms around the cursor; otherwise pans.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0025)
        setView((v) => zoomAt(v, factor, event.clientX - rect.left, event.clientY - rect.top))
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null)
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-chart-node],button,a,input')) return
    drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, id: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [view.x, view.y])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    setView((v) => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y }))
  }, [])
  const endDrag = useCallback(() => { drag.current = null }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const step = 60
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    if (moves[event.key]) { event.preventDefault(); const [dx, dy] = moves[event.key]; setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) }
    if (event.key === '+' || event.key === '=') setView((v) => zoomAt(v, 1.2, size.width / 2, size.height / 2))
    if (event.key === '-') setView((v) => zoomAt(v, 1 / 1.2, size.width / 2, size.height / 2))
  }

  const shown = visibleNodes(layout, view, size)

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border-subtle bg-subtle', className)}>
      <div className="absolute left-2 right-2 top-2 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">{toolbar}</div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-border-subtle bg-panel p-0.5 shadow-elev-1">
          <IconButton size="sm" variant="ghost" label="Zoom out" icon={<Minus />} onClick={() => setView((v) => zoomAt(v, 1 / 1.25, size.width / 2, size.height / 2))} />
          <span className="w-10 text-center text-xs tabular-nums text-fg-muted" aria-live="polite">{Math.round(view.k * 100)}%</span>
          <IconButton size="sm" variant="ghost" label="Zoom in" icon={<Plus />} onClick={() => setView((v) => zoomAt(v, 1.25, size.width / 2, size.height / 2))} />
          <IconButton size="sm" variant="ghost" label="Fit to screen" icon={<Maximize2 />} onClick={() => setView(fitView(layout, size))} />
        </div>
      </div>
      <div
        ref={containerRef}
        role="group"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ height }}
        data-chart-canvas
      >
        <ChartScene layout={layout} shown={shown} view={view} expanded={expanded} tree={tree} onToggle={onToggle}
          renderNode={renderNode} toggleLabel={toggleLabel} selectedId={selectedId} />
      </div>
    </div>
  )
}

/** The transformed scene: edges (SVG) and the visible node cards. Exported for static rendering. */
export function ChartScene({ layout, shown, view, expanded, tree, onToggle, renderNode, toggleLabel, selectedId }: {
  layout: ChartLayout
  shown: ChartLayout['nodes']
  view: Viewport
  expanded: ReadonlySet<string>
  tree: ChartTree
  onToggle: (id: string) => void
  renderNode: (id: string) => ReactNode
  toggleLabel?: (id: string, count: number, expanded: boolean) => string
  selectedId?: string | null
}) {
  const shownIds = new Set(shown.map((n) => n.id))
  const edges = layout.edges.filter((e) => shownIds.has(e.to) || shownIds.has(e.from))
  return (
    <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: layout.width, height: layout.height }}>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={Math.max(1, layout.width)} height={Math.max(1, layout.height)} aria-hidden>
        {edges.map((e) => <path key={`${e.from}-${e.to}`} d={edgePath(e.points)} fill="none" stroke="var(--ds-border-strong)" strokeWidth={1.25} />)}
      </svg>
      {shown.map((node) => {
        const count = tree.childrenOf.get(node.id)?.length ?? 0
        const isOpen = expanded.has(node.id)
        return (
          <div key={node.id} className="absolute" style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }} data-chart-node={node.id} data-selected={selectedId === node.id || undefined}>
            {renderNode(node.id)}
            {count > 0 && (
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                aria-expanded={isOpen}
                aria-label={toggleLabel ? toggleLabel(node.id, count, isOpen) : `${isOpen ? 'Hide' : 'Show'} ${count}`}
                className="absolute -bottom-3 left-1/2 z-[1] flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-panel px-2 text-2xs font-medium text-fg-muted shadow-elev-1 hover:text-fg"
              >
                {count}
                {isOpen ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Height used by node cards (keeps renderers in step with the layout). */
export const CHART_NODE_HEIGHT = NODE_H
