"use client"

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  DndContext, DragOverlay, MeasuringStrategy, PointerSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable } from "@dnd-kit/sortable"
import { EyeOff, GripVertical, MoveDiagonal2 } from "lucide-react"
import {
  GAP_PX, ROW_PX, applyLayoutKey, colsForWidth, desktopWidth, homeGridDefs, moveWidget, resizeWidget, spanFor,
  type GridDefLookup, type GridItem, type HomeWidgetId,
} from "@/lib/home/layout"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/ui/icon-button"

/**
 * Home's widget grid (lib/home/layout.ts has the model). Rendering is CSS
 * only — container queries pick 12 / 6 / 1 columns from the grid's own
 * width (components/home/home-grid.css, .home-grid), so the server render and the first
 * client render agree. In edit mode:
 *  - drag a widget by its handle (dnd-kit, pointer and touch; the grid
 *    reflows live, the dragged widget follows the pointer as an outline);
 *  - resize from the right edge, bottom edge or corner (12 / 6 columns only);
 *  - keyboard on the handle: arrows move, Shift + arrows resize; the
 *    resize corner takes plain arrows; every change is announced.
 * Outside edit mode no dnd-kit code runs and nothing is draggable.
 *
 * Shared by Home and app pages (components/apps/app-page-view.tsx): `defs`
 * looks up titles and size bounds (Home's catalogue by default), `hideLabel`
 * / `hideIcon` name the remove action, `toolbar` adds per-widget edit
 * buttons (an app page's Configure) and `selectedId` marks the widget whose
 * settings are open.
 */

export interface HomeGridProps<Id extends string = HomeWidgetId> {
  items: GridItem<Id>[]
  editing: boolean
  render: (id: Id) => ReactNode
  onItemsChange: (items: GridItem<Id>[]) => void
  onHide: (id: Id) => void
  announce: (message: string) => void
  defs?: GridDefLookup
  hideLabel?: (title: string) => string
  hideIcon?: ReactNode
  toolbar?: (id: Id) => ReactNode
  selectedId?: string | null
  /** Edit mode: room above uncarded widgets too, so the handle bar never covers them (app pages). */
  padEditing?: boolean
}

/** Items the grid works on internally (ids widened to string). */
type Item = GridItem<string>

/** Pointer inside a widget first; otherwise the closest one. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args)
  return within.length ? within : closestCenter(args)
}

/** No transforms while sorting: the grid itself reflows (sizes differ, so shifting boxes would overlap). */
const noShift = () => null

export function HomeGrid<Id extends string = HomeWidgetId>(props: HomeGridProps<Id>) {
  const { editing, announce, defs = homeGridDefs, hideLabel, hideIcon, selectedId, padEditing = false } = props
  const items = props.items as Item[]
  const render = props.render as (id: string) => ReactNode
  const onItemsChange = props.onItemsChange as (items: Item[]) => void
  const onHide = props.onHide as (id: string) => void
  const toolbar = props.toolbar as ((id: string) => ReactNode) | undefined
  const instructionsId = useId()
  const outerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState<1 | 6 | 12>(12)
  const [focusId, setFocusId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = outerRef.current
    if (!el) return
    const update = () => setCols(colsForWidth(el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keyboard moves re-order the DOM, which can drop focus: put it back on the handle.
  useEffect(() => {
    if (!focusId) return
    const frame = requestAnimationFrame(() => {
      outerRef.current?.querySelector<HTMLElement>(`[data-widget-handle="${focusId}"]`)?.focus()
      setFocusId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusId, items])

  /** Pixels per column step and per row step, for pointer resizing. */
  const steps = useCallback(() => {
    const width = outerRef.current?.clientWidth ?? 0
    return { col: (width + GAP_PX) / cols, row: ROW_PX + GAP_PX }
  }, [cols])

  const onKey = useCallback((id: string, e: React.KeyboardEvent, resizeOnly = false) => {
    const key = resizeOnly ? { key: e.key, shiftKey: e.key.startsWith("Arrow") } : { key: e.key, shiftKey: e.shiftKey }
    const result = applyLayoutKey({ items }, id, key, cols, defs)
    if (!result) return
    e.preventDefault()
    if (result.layout.items !== items) onItemsChange(result.layout.items)
    announce(result.message)
    if (!resizeOnly) setFocusId(id)
  }, [items, cols, onItemsChange, announce, defs])

  const onResize = useCallback((id: string, w: number, h: number) => {
    onItemsChange(resizeWidget({ items }, id, w, h, defs).items)
  }, [items, onItemsChange, defs])

  const frames = items.map((item) => {
    const frame: FrameProps = {
      item, cols, editing, steps, onKey, onResize, onResizeEnd: (it) => announce(sizeMessage(it, cols, defs)), onHide, children: render(item.id),
      defs, instructionsId, hideLabel, hideIcon, toolbar: toolbar?.(item.id), selected: selectedId === item.id, padEditing,
    }
    return editing ? <SortableFrame key={item.id} {...frame} /> : <WidgetFrame key={item.id} {...frame} />
  })

  return (
    <div ref={outerRef} className="home-grid" data-home-grid data-cols={cols} data-editing={editing || undefined}>
      {editing ? (
        <EditableGrid items={items} onItemsChange={onItemsChange} announce={announce} defs={defs}>{frames}</EditableGrid>
      ) : (
        <div className="home-grid-inner">{frames}</div>
      )}
      {editing && (
        <p id={instructionsId} className="sr-only">
          Drag the handle to move this widget. With the keyboard: arrow keys move it earlier or later, Shift and the arrow keys make it narrower, wider, shorter or taller.
        </p>
      )}
    </div>
  )
}

function sizeMessage(item: Item, cols: number, defs: GridDefLookup): string {
  return `${defs(item.id)?.title}: ${spanFor(item, cols, defs)} of ${cols} columns wide, ${item.h} rows tall.`
}

function EditableGrid({ items, onItemsChange, announce, defs, children }: { items: Item[]; onItemsChange: (items: Item[]) => void; announce: (m: string) => void; defs: GridDefLookup; children: ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [active, setActive] = useState<{ id: string; width: number; height: number } | null>(null)
  const before = useRef<Item[] | null>(null)
  const title = (id: unknown) => defs(String(id))?.title ?? "Widget"
  const position = (id: unknown) => `position ${items.findIndex((i) => i.id === id) + 1} of ${items.length}`

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements: {
          onDragStart: ({ active: a }) => `Picked up ${title(a.id)}.`,
          onDragOver: ({ active: a }) => `${title(a.id)} is at ${position(a.id)}.`,
          onDragEnd: ({ active: a }) => `${title(a.id)} dropped at ${position(a.id)}.`,
          onDragCancel: ({ active: a }) => `Moving ${title(a.id)} was cancelled.`,
        },
      }}
      onDragStart={(e: DragStartEvent) => {
        before.current = items
        const rect = e.active.rect.current.initial
        setActive({ id: String(e.active.id), width: rect?.width ?? 200, height: rect?.height ?? 120 })
      }}
      onDragOver={({ active: a, over }: DragOverEvent) => {
        if (!over || a.id === over.id) return
        const from = items.findIndex((i) => i.id === a.id)
        const to = items.findIndex((i) => i.id === over.id)
        if (from < 0 || to < 0) return
        onItemsChange(moveWidget({ items }, from, to).items)
      }}
      onDragEnd={({ active: a }) => {
        setActive(null)
        before.current = null
        announce(`${title(a.id)} moved to ${position(a.id)}.`)
      }}
      onDragCancel={() => {
        setActive(null)
        if (before.current) onItemsChange(before.current)
        before.current = null
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={noShift}>
        <div className="home-grid-inner">{children}</div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="flex cursor-grabbing items-start rounded-lg border-2 border-dashed border-border-strong bg-panel/90 p-3 text-ui font-medium text-fg shadow-elev-2"
            style={{ width: active.width, height: active.height }}
            data-drag-overlay>
            <GripVertical aria-hidden className="mr-1 size-4 text-fg-muted" /> {title(active.id)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface FrameProps {
  item: Item
  cols: number
  editing: boolean
  steps: () => { col: number; row: number }
  onKey: (id: string, e: React.KeyboardEvent, resizeOnly?: boolean) => void
  onResize: (id: string, w: number, h: number) => void
  onResizeEnd: (item: Item) => void
  onHide: (id: string) => void
  children: ReactNode
  defs: GridDefLookup
  instructionsId: string
  hideLabel?: (title: string) => string
  hideIcon?: ReactNode
  toolbar?: ReactNode
  selected?: boolean
  padEditing?: boolean
}

function SortableFrame(props: FrameProps) {
  const { setNodeRef, setActivatorNodeRef, listeners, isDragging } = useSortable({ id: props.item.id })
  return <WidgetFrame ref={setNodeRef} {...props} handleRef={setActivatorNodeRef} handleListeners={listeners} dragging={isDragging} />
}

const WidgetFrame = forwardRef<HTMLDivElement, FrameProps & {
  handleRef?: (el: HTMLElement | null) => void
  handleListeners?: Record<string, unknown>
  dragging?: boolean
}>(function WidgetFrame({ item, cols, editing, steps, onKey, onResize, onResizeEnd, onHide, children, handleRef, handleListeners, dragging, defs, instructionsId, hideLabel, hideIcon, toolbar, selected, padEditing }, ref) {
  const def: { title: string; group: string; compact?: boolean; bleed?: boolean; cardStyle?: Record<string, string>; cardFlags?: string } = defs(item.id) ?? { title: "Widget", group: "list", compact: false }
  const carded = def.group === "list" || def.group === "forms"
  const style = {
    "--w-lg": item.w,
    "--w-md": spanFor(item, 6, defs),
    "--h": item.h,
    "--h-px": `${item.h * ROW_PX + (item.h - 1) * GAP_PX}px`,
  } as CSSProperties
  return (
    <div ref={ref} className={cn("home-widget group/widget relative min-w-0", dragging && "opacity-40")} style={style}
      data-widget={item.id} data-group={def.group} data-w={item.w} data-h={item.h} data-compact={def.compact || undefined} data-selected={selected || undefined}>
      <div
        className={cn("@container h-full min-h-0 min-w-0", carded && "overflow-auto rounded-lg border border-border bg-panel p-3 scrollbar-thin", (carded || padEditing) && editing && !def.bleed && "pt-12", editing && "home-widget-editing")}
        inert={editing || undefined}
        data-widget-body
        style={def.cardStyle as CSSProperties | undefined}
        data-widget-styled={def.cardStyle ? def.cardFlags ?? "" : undefined}
      >
        {children}
      </div>
      {editing && (
        <EditChrome item={item} cols={cols} title={def.title} steps={steps} onKey={onKey} onResize={onResize} onResizeEnd={onResizeEnd} onHide={onHide}
          handleRef={handleRef} handleListeners={handleListeners} defs={defs} instructionsId={instructionsId} hideLabel={hideLabel} hideIcon={hideIcon} toolbar={toolbar} selected={selected} bleed={def.bleed} />
      )}
    </div>
  )
})

function EditChrome({ item, cols, title, steps, onKey, onResize, onResizeEnd, onHide, handleRef, handleListeners, defs, instructionsId, hideLabel, hideIcon, toolbar, selected, bleed }: {
  bleed?: boolean
  item: Item
  defs: GridDefLookup
  instructionsId: string
  hideLabel?: (title: string) => string
  hideIcon?: ReactNode
  toolbar?: ReactNode
  selected?: boolean
  cols: number
  title: string
  steps: () => { col: number; row: number }
  onKey: FrameProps["onKey"]
  onResize: FrameProps["onResize"]
  onResizeEnd: FrameProps["onResizeEnd"]
  onHide: FrameProps["onHide"]
  handleRef?: (el: HTMLElement | null) => void
  handleListeners?: Record<string, unknown>
}) {
  const resizable = cols > 1
  const drag = useRef<{ x: number; y: number; span: number; h: number; axis: "x" | "y" | "xy"; last: Item } | null>(null)
  const latest = useRef(item)
  useLayoutEffect(() => { latest.current = item })

  const start = (axis: "x" | "y" | "xy") => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, span: spanFor(item, cols, defs), h: item.h, axis, last: item }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const s = steps()
    const span = d.axis === "y" ? d.span : d.span + Math.round((e.clientX - d.x) / s.col)
    const h = d.axis === "x" ? d.h : d.h + Math.round((e.clientY - d.y) / s.row)
    const w = d.axis === "y" ? latest.current.w : desktopWidth(item.id, Math.max(1, span), cols, defs)
    if (w !== latest.current.w || h !== latest.current.h) onResize(item.id, w, h)
  }
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    onResizeEnd(latest.current)
  }
  const edge = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  return (
    <>
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 rounded-lg border-2 border-dashed", selected ? "border-primary" : "border-border-strong")} data-edit-outline />
      <div className={cn("absolute inset-x-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-elevated px-1 py-0.5 text-fg shadow-elev-1", bleed && !selected && "opacity-0 transition-opacity focus-within:opacity-100 group-hover/widget:opacity-100")}>
        <button
          type="button"
          ref={handleRef}
          {...(handleListeners as object)}
          onKeyDown={(e) => onKey(item.id, e)}
          aria-label={`Move ${title}`}
          aria-describedby={instructionsId}
          className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-1.5 rounded-sm px-1 py-1 text-left text-ui font-medium hover:bg-subtle active:cursor-grabbing"
          data-widget-handle={item.id}
        >
          <GripVertical aria-hidden className="size-4 shrink-0 text-fg-muted" />
          <span className="truncate">{title}</span>
          {resizable && <span className="num ml-auto shrink-0 pl-1 text-2xs font-normal text-fg-muted" aria-hidden>{spanFor(item, cols, defs)}×{item.h}</span>}
        </button>
        {toolbar}
        <IconButton size="sm" onClick={() => onHide(item.id)} label={hideLabel ? hideLabel(title) : `Hide ${title}`} icon={hideIcon ?? <EyeOff />} className="shrink-0" data-widget-hide={item.id} />
      </div>
      {resizable && (
        <>
          <div aria-hidden className="absolute inset-y-6 -right-1.5 z-10 w-3 cursor-ew-resize touch-none" {...edge} onPointerDown={start("x")} data-resize-edge="x" />
          <div aria-hidden className="absolute inset-x-6 -bottom-1.5 z-10 h-3 cursor-ns-resize touch-none" {...edge} onPointerDown={start("y")} data-resize-edge="y" />
          <button
            type="button"
            aria-label={`Resize ${title}: ${spanFor(item, cols, defs)} of ${cols} columns wide, ${item.h} rows tall. Use the arrow keys.`}
            className="absolute -bottom-1 -right-1 z-20 flex size-6 cursor-nwse-resize touch-none items-center justify-center rounded-md border border-border-strong bg-elevated text-fg-muted shadow-elev-1 hover:text-fg"
            {...edge}
            onPointerDown={start("xy")}
            onKeyDown={(e) => onKey(item.id, e, true)}
            data-resize-handle={item.id}
          >
            <MoveDiagonal2 aria-hidden className="size-3.5" />
          </button>
        </>
      )}
    </>
  )
}
