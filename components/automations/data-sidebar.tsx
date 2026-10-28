'use client'

/**
 * The docked "Data" sidebar next to the node config panel: everything the
 * selected step can use — form fields first (trigger form, start form, each
 * upstream User Task's form), then recently used, step outputs and
 * variables. Drag a row onto any input, or click / Enter to insert it into
 * the input last edited (copied when none is).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Database, X } from 'lucide-react'
import { buildDataTree, type PickerEdgeLike, type PickerNodeLike, type PickerWorkflowVariable } from '@/lib/workflow-data-picker'
import { DataTree } from './data-picker'
import { useActiveInput } from './active-input'
import { useLinkedForms } from './linked-forms'

const STORAGE_KEY = 'ut.workflow.dataSidebar'

/** Open/closed state of the sidebar, remembered per viewer (open by default). */
export function useDataSidebarState(): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === '0') setOpen(false)
    } catch { /* storage unavailable: default open */ }
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

export function DataSidebar({ nodes, edges, selectedNodeId, workflowVariables, onInsertLoopBefore, onClose }: {
  nodes: PickerNodeLike[]
  edges: PickerEdgeLike[]
  selectedNodeId: string | null
  workflowVariables?: PickerWorkflowVariable[]
  onInsertLoopBefore?: (nodeId: string, itemsExpression: string) => void
  onClose: () => void
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

  return (
    <aside
      aria-label="Data"
      className="w-64 shrink-0 flex flex-col overflow-hidden rounded-xl border max-lg:hidden"
      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      data-no-dnd="true"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
        <div className="flex items-center gap-1.5">
          <Database size={14} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>Data</span>
          <kbd className="rounded border px-1 text-[9px]" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }} title="Toggle the Data sidebar">⌥D</kbd>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the Data sidebar" className="rounded p-0.5 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
          <X size={14} aria-hidden />
        </button>
      </div>
      <p className="px-3 pt-2 text-[11px] leading-snug" style={{ color: 'var(--theme-muted-text)' }}>
        {selected
          ? <>Available at <strong style={{ color: 'var(--theme-card-text)' }}>{selected.label}</strong>. Drag onto an input, or click to insert where you last typed.</>
          : 'Select a step to see the data available to it. Drag onto an input, or click to insert.'}
      </p>
      <p role="status" aria-live="polite" className="min-h-[16px] px-3 text-[10px]" style={{ color: 'var(--theme-primary-text)' }}>{status ?? ''}</p>
      <DataTree
        key={selectedNodeId ?? 'none'}
        groups={groups}
        className="flex min-h-0 flex-1 flex-col"
        fill
        onPick={apply}
        onLoop={selectedNodeId && onInsertLoopBefore && selected?.type !== 'loop' ? (items, insert) => { onInsertLoopBefore(selectedNodeId, items); apply(insert) } : undefined}
      />
    </aside>
  )
}
