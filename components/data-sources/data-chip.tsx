'use client'

/**
 * Draggable data badges and their drop targets: the chip a test response's
 * lists, objects and fields are drawn as (components/data-sources/
 * response-badge-tree.tsx), and the zones they can be dropped on (a Data
 * table's "Rows from", its columns, a dropdown's value / label).
 *
 * The chip uses the designer's token pill look (the Data panel's TokenPill:
 * primary-light fill, accent border, small medium text) so workflow data and
 * API data read as one system. While a badge is dragged, every zone that
 * accepts it is highlighted (ResponseDragProvider); a click opens the same
 * actions as a menu, for keyboard and touch.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Box, Calendar, Hash, List, ToggleLeft, Type } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RESPONSE_DRAG_TYPE, decodeBadgeDrag, type BadgeIcon, type ResponseDragPayload } from '@/lib/data-sources/api-rows'

export const BADGE_ICONS: Record<BadgeIcon, React.ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>> = {
  list: List, object: Box, text: Type, number: Hash, boolean: ToggleLeft, date: Calendar,
}

/** The token-pill look shared with the Data panel (components/forms/designer/workflow-data-panel.tsx TokenPill). */
export const chipStyle: React.CSSProperties = {
  backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)',
  borderColor: 'color-mix(in srgb, var(--theme-accent) 40%, transparent)', fontFamily: 'var(--theme-font-sans)',
}

export function DataChip({ icon, label, title, payload, selected, recommended, muted, onActivate, menuOpen, testId, className }: {
  icon: BadgeIcon
  label: string
  title?: string
  /** Drag payload (a ResponseDragPayload as JSON); none: not draggable. */
  payload?: string
  selected?: boolean
  recommended?: boolean
  muted?: boolean
  onActivate?: () => void
  menuOpen?: boolean
  testId?: string
  className?: string
}) {
  const drag = useResponseDrag()
  const Icon = BADGE_ICONS[icon]
  return (
    <button type="button" title={title ?? label}
      draggable={!!payload}
      onDragStart={payload ? (e) => {
        e.dataTransfer.setData(RESPONSE_DRAG_TYPE, payload)
        e.dataTransfer.setData('text/plain', label)
        e.dataTransfer.effectAllowed = 'copy'
        drag.start(decodeBadgeDrag(payload))
      } : undefined}
      onDragEnd={payload ? () => drag.end() : undefined}
      onClick={onActivate}
      aria-haspopup={onActivate ? 'menu' : undefined}
      aria-expanded={onActivate ? !!menuOpen : undefined}
      aria-pressed={selected || undefined}
      data-response-badge={testId}
      className={cn('inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-2xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary',
        payload && 'cursor-grab active:cursor-grabbing', muted && 'opacity-70', selected && 'ring-2 ring-primary', className)}
      style={chipStyle}>
      <Icon size={11} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      {recommended && !selected && <span className="rounded bg-primary px-1 text-2xs leading-4 text-primary-fg">best match</span>}
    </button>
  )
}

/* ── Drag state (drop zones highlight while a badge is dragged) ──────── */

interface DragState { dragging: ResponseDragPayload | null; start: (p: ResponseDragPayload | null) => void; end: () => void }
const NOOP: DragState = { dragging: null, start: () => {}, end: () => {} }
const DragContext = createContext<DragState>(NOOP)

export function ResponseDragProvider({ children }: { children: React.ReactNode }) {
  const [dragging, setDragging] = useState<ResponseDragPayload | null>(null)
  const start = useCallback((p: ResponseDragPayload | null) => setDragging(p), [])
  const end = useCallback(() => setDragging(null), [])
  const value = useMemo(() => ({ dragging, start, end }), [dragging, start, end])
  return <DragContext.Provider value={value}>{children}</DragContext.Provider>
}

export function useResponseDrag(): DragState {
  return useContext(DragContext)
}

/**
 * Where a badge can be dropped: highlighted while an accepted badge is
 * dragged, outlined while it is over the zone. Anything else dropped is
 * ignored.
 */
export function ResponseDropZone({ accepts, onDrop, label, children, className, testId }: {
  accepts: (p: ResponseDragPayload) => boolean
  onDrop: (p: ResponseDragPayload) => void
  /** What a drop does ("Drop a list here to use it as rows"), shown while dragging. */
  label: string
  children?: React.ReactNode
  className?: string
  testId?: string
}) {
  const { dragging, end } = useResponseDrag()
  const [over, setOver] = useState(false)
  const active = !!dragging && accepts(dragging)
  return (
    <div
      data-drop-zone={testId}
      data-drop-active={active || undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(RESPONSE_DRAG_TYPE) && (!dragging || accepts(dragging))) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const p = decodeBadgeDrag(e.dataTransfer.getData(RESPONSE_DRAG_TYPE))
        if (!p || !accepts(p)) return
        e.preventDefault()
        onDrop(p)
        end()
      }}
      className={cn('rounded-md border border-dashed transition-colors duration-[var(--ds-dur-fast)]', active ? 'border-primary bg-primary-wash' : 'border-transparent', over && active && 'ring-2 ring-primary', className)}>
      {children}
      {active && <p className="px-2 py-1 text-2xs font-medium text-primary-text" aria-live="polite">{label}</p>}
    </div>
  )
}
