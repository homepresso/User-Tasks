'use client'

/**
 * The docked "Data" sidebar next to the node config panel: everything the
 * selected step can use — form fields first (trigger form, start form, each
 * upstream User Task's form), then recently used, step outputs and
 * variables. Drag a row onto any input, or click / Enter to insert it into
 * the input last edited (copied when none is).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, PanelRightOpen, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Kbd } from '@/components/ui/kbd'
import { buildDataTree, type PickerEdgeLike, type PickerNodeLike, type PickerWorkflowVariable } from '@/lib/workflow-data-picker'
import { DataTree } from './data-picker'
import { useActiveInput } from './active-input'
import { useLinkedForms } from './linked-forms'

const STORAGE_KEY = 'ut.workflow.dataSidebar'

/**
 * Docked state of the Data panel, remembered per viewer. The panel always
 * lives in the inspector's Data tab; docked, it also gets its own column
 * beside the inspector so fields can be dragged onto the step's inputs.
 * Not docked by default (the canvas keeps its width).
 */
export function useDataSidebarState(): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === '1') setOpen(true) // eslint-disable-line react-hooks/set-state-in-effect -- read once after hydration
    } catch { /* storage unavailable: default undocked */ }
  }, [])
  const update = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setOpen((current) => {
      const value = typeof next === 'function' ? next(current) : next
      try { window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0') } catch { /* convenience only */ }
      return value
    })
  }, [])
  return [open, update]
}

/** Alt+D (⌥D) toggles the sidebar, also while typing in an input. */
export function isDataSidebarShortcut(event: KeyboardEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === 'KeyD'
}

export function DataSidebar({ nodes, edges, selectedNodeId, workflowVariables, onInsertLoopBefore, onClose, embedded = false, onDock }: {
  nodes: PickerNodeLike[]
  edges: PickerEdgeLike[]
  selectedNodeId: string | null
  workflowVariables?: PickerWorkflowVariable[]
  onInsertLoopBefore?: (nodeId: string, itemsExpression: string) => void
  onClose: () => void
  /** Rendered inside the inspector's Data tab (no frame; offers "Dock beside"). */
  embedded?: boolean
  /** Embedded only: dock the panel as its own column. */
  onDock?: () => void
}) {
  const { insertIntoActive } = useActiveInput()
  const linkedForms = useLinkedForms()
  const [status, setStatus] = useState<string | null>(null)
  const groups = useMemo(
    () => buildDataTree({ nodes: nodes.filter((n) => n.id), edges, currentNodeId: selectedNodeId, workflowVariables, linkedForms }),
    [nodes, edges, selectedNodeId, workflowVariables, linkedForms],
  )
  const selected = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null

  useEffect(() => {
    if (!status) return
    const timer = setTimeout(() => setStatus(null), 1600)
    return () => clearTimeout(timer)
  }, [status])

  function apply(token: string) {
    if (insertIntoActive(token)) setStatus(`Inserted ${token}`)
    else {
      void navigator.clipboard?.writeText(token)
      setStatus(`Copied ${token} — click an input first to insert`)
    }
  }

  const intro = (
    <p className="text-xs leading-snug text-fg-muted">
      {selected
        ? <>Available at <strong className="font-medium text-fg">{selected.label}</strong>. Drag onto an input, or click to insert where you last typed.</>
        : 'Select a step to see the data available to it. Drag onto an input, or click to insert.'}
    </p>
  )
  const statusLine = <p role="status" aria-live="polite" className="min-h-4 text-2xs text-primary-text">{status ?? ''}</p>
  const tree = (
    <DataTree
      key={selectedNodeId ?? 'none'}
      groups={groups}
      className="flex min-h-0 flex-1 flex-col"
      fill
      onPick={apply}
      onLoop={selectedNodeId && onInsertLoopBefore && selected?.type !== 'loop' ? (items, insert) => { onInsertLoopBefore(selectedNodeId, items); apply(insert) } : undefined}
    />
  )

  if (embedded) {
    return (
      <div aria-label="Data" className="flex h-full min-h-0 flex-col" data-no-dnd="true">
        <div className="flex items-start gap-2 pb-1">
          <div className="min-w-0 flex-1">{intro}</div>
          {onDock && (
            <IconButton size="sm" label="Dock beside the inspector (⌥D) to drag fields onto inputs" icon={<PanelRightOpen />} onClick={onDock} />
          )}
        </div>
        {statusLine}
        {tree}
      </div>
    )
  }

  return (
    <aside
      aria-label="Data"
      className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-panel max-lg:hidden"
      data-no-dnd="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-subtle px-3">
        <div className="flex items-center gap-1.5">
          <Database size={14} aria-hidden className="text-fg-muted" />
          <span className="text-ui font-semibold text-fg">Data</span>
          <Kbd>⌥D</Kbd>
        </div>
        <IconButton size="sm" label="Close the Data sidebar" icon={<X />} onClick={onClose} />
      </div>
      <div className="px-3 pt-2">{intro}</div>
      <div className="px-3">{statusLine}</div>
      {tree}
    </aside>
  )
}
