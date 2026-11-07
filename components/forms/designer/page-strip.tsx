'use client'

import { useState } from 'react'
import { AlertTriangle, GitBranch, GripVertical, Hourglass, Plus } from 'lucide-react'
import { isPaged, MAX_FORM_PAGES, type FormPageMode } from '@/lib/forms/layout'
import { addPage, moveFieldToPage, movePage, movePageTo, pageFieldKeys, pageMode, pageProblems, setPageMode } from '@/lib/forms/pages'
import { addField, type DesignerState } from '@/lib/forms/designer-state'
import type { TaskFieldType } from '@/lib/task-field-schema'
import { PageIcon } from '@/components/forms/page-icons'
import { DRAG_FIELD_KEY, DRAG_NEW_TYPE, DRAG_PAGE_ID } from './field-icons'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/ui/segmented-control'

/**
 * The designer's page strip above the grid: the form's mode (single page,
 * steps, tabs) and, for steps / tabs, one chip per page — click to edit
 * that page's grid and settings, drag (or Alt+Arrow keys) to reorder, drop
 * a field card on a chip to move the field to that page, drop a palette
 * type to add it there. Every change goes through the undo history.
 */

const MODES: Array<[FormPageMode, string]> = [['single', 'Single page'], ['steps', 'Steps'], ['tabs', 'Tabs']]

export function PageStrip({ state, activeId, onSelect, onChange, onFieldAdded, announce }: {
  state: DesignerState
  activeId: string | null
  onSelect: (id: string) => void
  onChange: (next: DesignerState, tag?: string) => void
  /** A field was added on a page (select it). */
  onFieldAdded: (fieldId: string) => void
  announce: (message: string) => void
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const mode = pageMode(state.layout)
  const pages = isPaged(state.layout) ? state.layout.pages : []
  const problems = pageProblems(state.layout)
  const noun = mode === 'tabs' ? 'tab' : 'step'

  function switchMode(next: FormPageMode) {
    if (next === mode) return
    const layout = setPageMode(state.layout, next)
    onChange({ ...state, layout })
    if (isPaged(layout)) onSelect(layout.pages[0].id)
    announce(next === 'single' ? 'Pages merged into one grid (Ctrl+Z to undo)' : `The form is now ${next === 'steps' ? 'a set of steps' : 'tabbed'}`)
  }

  function add() {
    const { layout, id } = addPage(state.layout, { after: activeId ?? undefined })
    if (!id) return
    onChange({ ...state, layout })
    onSelect(id)
    announce(`${noun === 'tab' ? 'Tab' : 'Step'} added`)
  }

  function drop(e: React.DragEvent, pageId: string, index: number) {
    e.preventDefault()
    setDropTarget(null)
    const page = e.dataTransfer.getData(DRAG_PAGE_ID)
    const key = e.dataTransfer.getData(DRAG_FIELD_KEY)
    const type = e.dataTransfer.getData(DRAG_NEW_TYPE) as TaskFieldType
    if (page) {
      onChange({ ...state, layout: movePageTo(state.layout, page, index) })
      announce(`Moved to position ${index + 1}`)
    } else if (key) {
      onChange({ ...state, layout: moveFieldToPage(state.layout, key, pageId) })
      announce(`Field moved to ${pages.find((p) => p.id === pageId)?.title ?? 'the page'}`)
    } else if (type) {
      const { state: next, field } = addField(state, type, undefined, pageId)
      onChange(next)
      onSelect(pageId)
      onFieldAdded(field._id)
    }
  }

  function onChipKey(e: React.KeyboardEvent, pageId: string) {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    const layout = movePage(state.layout, pageId, e.key === 'ArrowLeft' ? -1 : 1)
    if (layout === state.layout) return
    onChange({ ...state, layout })
    const at = layout.pages!.findIndex((p) => p.id === pageId)
    announce(`Moved to position ${at + 1} of ${layout.pages!.length}`)
    requestAnimationFrame(() => document.getElementById(`page-chip-${pageId}`)?.focus())
  }

  return (
    <div className="mb-3 space-y-2" data-page-strip>
      <div className="flex flex-wrap items-center gap-2 text-2xs">
        <span className="font-medium text-xs text-fg-muted">Layout</span>
        <SegmentedControl size="sm" aria-label="Form layout" value={mode} onValueChange={switchMode}
          options={MODES.map(([value, label]) => ({ value, text: label }))} />
        {mode !== 'single' && <span className="text-fg-muted">Drag a field onto a {noun} to move it there; Alt+Arrow keys reorder.</span>}
      </div>
      {mode !== 'single' && (
        <div className="flex flex-wrap items-stretch gap-1.5" role="list" aria-label={mode === 'tabs' ? 'Tabs' : 'Steps'}>
          {pages.map((page, i) => {
            const active = page.id === activeId
            const count = pageFieldKeys(page).length
            const problem = problems.blocking[page.id]
            const warning = problems.warnings[page.id]
            const target = dropTarget === page.id
            return (
              <div key={page.id} role="listitem" className="flex">
                <button
                  id={`page-chip-${page.id}`}
                  type="button"
                  draggable
                  aria-pressed={active}
                  aria-label={`${mode === 'tabs' ? 'Tab' : 'Step'} ${i + 1}: ${page.title || 'Untitled'}, ${count} field${count === 1 ? '' : 's'}${page.visible_when ? ', conditional' : ''}${page.load ? (page.load === 'rule' ? ', loads by rule' : ', loads when opened') : ''}. Alt+Arrow keys reorder.`}
                  onClick={() => onSelect(page.id)}
                  onKeyDown={(e) => onChipKey(e, page.id)}
                  onDragStart={(e) => { e.dataTransfer.setData(DRAG_PAGE_ID, page.id); e.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(e) => {
                    if (![...e.dataTransfer.types].some((t) => t === DRAG_PAGE_ID || t === DRAG_FIELD_KEY || t === DRAG_NEW_TYPE)) return
                    e.preventDefault()
                    if (dropTarget !== page.id) setDropTarget(page.id)
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === page.id ? null : t))}
                  onDrop={(e) => drop(e, page.id, i)}
                  className={cn('group flex max-w-[14rem] items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs text-fg', problem ? 'border-danger' : active || target ? 'border-primary' : 'border-border', active || target ? 'bg-primary-wash' : 'bg-panel')}
                  title={problem ?? warning ?? undefined}
                  data-page-chip={page.id}
                >
                  <GripVertical size={11} className="shrink-0 opacity-40 group-hover:opacity-80" aria-hidden />
                  {mode === 'steps' && <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs font-semibold', active ? 'bg-primary' : 'bg-border', active ? 'text-primary-fg' : 'text-fg')}>{i + 1}</span>}
                  <PageIcon icon={page.icon} size={12} className="shrink-0" />
                  <span className="truncate font-medium">{page.title || <em className="text-fg-muted">Untitled</em>}</span>
                  <span className="shrink-0 text-2xs text-fg-muted">{count}</span>
                  {page.visible_when && <GitBranch size={11} className="shrink-0 text-primary-text" aria-hidden />}
                  {page.load && <Hourglass size={11} className="shrink-0 text-fg-muted" aria-hidden />}
                  {(problem || warning) && <AlertTriangle size={11} className={cn('shrink-0', problem ? 'text-danger' : 'text-warning')} aria-hidden />}
                </button>
              </div>
            )
          })}
          {pages.length < MAX_FORM_PAGES && (
            <button type="button" onClick={add} className="flex items-center gap-1 rounded-md border border-dashed px-2 py-1.5 text-xs font-medium border-border text-primary-text"
              data-add-page>
              <Plus size={12} aria-hidden /> Add {noun}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
