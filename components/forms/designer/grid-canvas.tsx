'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react'
import { addRow, findCell, moveRow, nudgeField, placeField, removeRow, rowFree, setRowColumns, MAX_FORM_COLUMNS } from '@/lib/forms/layout'
import { addField, removeField, type DesignerState } from '@/lib/forms/designer-state'
import { TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { DRAG_FIELD_KEY, DRAG_NEW_TYPE, FIELD_ICONS } from './field-icons'

/**
 * The designer's grid: rows of 1–4 columns holding field cards. Drag a type
 * from the palette (or a card) onto a card to insert before it, onto a row's
 * free space to append, or onto "new row". Keyboard: focus a card, Alt+Arrow
 * keys move it (left/right within the row, up/down between rows), Delete
 * removes it; Enter selects it for the properties panel.
 */

const COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4']
const SPAN = ['', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4']

export function GridCanvas({ state, selectedId, problems, onSelect, onChange, announce }: {
  state: DesignerState
  selectedId: string | null
  problems: Record<string, string>
  onSelect: (id: string | null) => void
  onChange: (next: DesignerState, tag?: string) => void
  /** Screen-reader announcement (keyboard moves). */
  announce: (message: string) => void
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const byKey = new Map(state.fields.map((f) => [f.key, f]))

  function handleDrop(e: React.DragEvent, row: number, index: number) {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const type = e.dataTransfer.getData(DRAG_NEW_TYPE) as TaskFieldType
    const key = e.dataTransfer.getData(DRAG_FIELD_KEY)
    if (type) {
      const { state: next, field } = row >= state.layout.rows.length
        ? addField(state, type)
        : addField(state, type, { row, index })
      onChange(next)
      onSelect(field._id)
      return
    }
    if (key && byKey.has(key)) {
      onChange({ ...state, layout: placeField(state.layout, key, row, index) })
    }
  }

  const dropProps = (id: string, row: number, index: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].some((t) => t === DRAG_NEW_TYPE || t === DRAG_FIELD_KEY)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = [...e.dataTransfer.types].includes(DRAG_NEW_TYPE) ? 'copy' : 'move'
      if (dropTarget !== id) setDropTarget(id)
    },
    onDragLeave: () => setDropTarget((t) => (t === id ? null : t)),
    onDrop: (e: React.DragEvent) => handleDrop(e, row, index),
  })

  function onCardKey(e: React.KeyboardEvent, key: string, id: string) {
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
    if (e.altKey && dirs[e.key]) {
      e.preventDefault()
      const next = nudgeField(state.layout, key, dirs[e.key])
      if (next !== state.layout) {
        onChange({ ...state, layout: next })
        const at = findCell(next, key)
        if (at) announce(`Moved to row ${at.row + 1}, position ${at.index + 1}`)
        requestAnimationFrame(() => document.getElementById(`form-cell-${id}`)?.focus())
      }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(id)
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onChange(removeField(state, id))
      onSelect(null)
      announce('Field removed')
    }
  }

  return (
    <div className="space-y-3" onClick={() => onSelect(null)}>
      {state.layout.rows.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
          Drag a field from the palette, or click one to add it.
        </p>
      )}
      {state.layout.rows.map((row, r) => {
        const free = rowFree(row)
        return (
          <div key={r} className="rounded-lg border p-2" style={{ borderColor: 'var(--theme-surface-border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              <span className="font-semibold uppercase tracking-wider">Row {r + 1}</span>
              <div className="flex items-center gap-0.5" role="radiogroup" aria-label={`Row ${r + 1} columns`}>
                {Array.from({ length: MAX_FORM_COLUMNS }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={row.columns === n}
                    aria-label={`${n} column${n === 1 ? '' : 's'}`}
                    onClick={() => onChange({ ...state, layout: setRowColumns(state.layout, r, n) })}
                    className="h-6 w-6 rounded border text-[10px] font-semibold"
                    style={row.columns === n
                      ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                      : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                  >
                    {n}
                  </button>
                ))}
                <span className="ml-1">columns</span>
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                <button type="button" className="rounded p-1 disabled:opacity-30" disabled={r === 0} aria-label={`Move row ${r + 1} up`} onClick={() => onChange({ ...state, layout: moveRow(state.layout, r, -1) })}><ArrowUp size={12} /></button>
                <button type="button" className="rounded p-1 disabled:opacity-30" disabled={r === state.layout.rows.length - 1} aria-label={`Move row ${r + 1} down`} onClick={() => onChange({ ...state, layout: moveRow(state.layout, r, 1) })}><ArrowDown size={12} /></button>
                <button type="button" className="rounded p-1" aria-label={`Add a row below row ${r + 1}`} onClick={() => onChange({ ...state, layout: addRow(state.layout, row.columns, r + 1) })}><Plus size={12} /></button>
                <button
                  type="button"
                  className="rounded p-1"
                  aria-label={`Remove row ${r + 1}${row.cells.length ? ' and its fields' : ''}`}
                  title={row.cells.length ? 'Remove the row and its fields (undo with Ctrl+Z)' : 'Remove the row'}
                  onClick={() => {
                    const { layout, removedKeys } = removeRow(state.layout, r)
                    const removed = new Set(removedKeys)
                    onChange({ ...state, layout, fields: state.fields.filter((f) => !removed.has(f.key)) })
                    if (selectedId && state.fields.some((f) => f._id === selectedId && removed.has(f.key))) onSelect(null)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className={cn('grid gap-2', COLS[row.columns])}>
              {row.cells.map((cell, index) => {
                const field = byKey.get(cell.field_key)
                if (!field) return null
                const Icon = FIELD_ICONS[field.type]
                const selected = field._id === selectedId
                const target = `cell:${r}:${index}`
                const problem = problems[field._id]
                return (
                  <div
                    key={field._id}
                    id={`form-cell-${field._id}`}
                    role="button"
                    tabIndex={0}
                    draggable
                    aria-pressed={selected}
                    aria-label={`${field.label || 'Untitled'} — ${TASK_FIELD_TYPE_LABELS[field.type]}, row ${r + 1}, spans ${cell.span} of ${row.columns}. Alt+Arrow keys move it.`}
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_FIELD_KEY, field.key); e.dataTransfer.effectAllowed = 'move' }}
                    onClick={(e) => { e.stopPropagation(); onSelect(field._id) }}
                    onKeyDown={(e) => onCardKey(e, field.key, field._id)}
                    {...dropProps(target, r, index)}
                    className={cn('group relative flex min-h-14 cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 text-left outline-none focus-visible:ring-2', SPAN[Math.min(cell.span, row.columns)])}
                    style={{
                      borderColor: problem ? 'var(--status-blocked)' : selected ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                      backgroundColor: selected ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)',
                      boxShadow: dropTarget === target ? 'inset 3px 0 0 var(--theme-primary)' : undefined,
                      ['--tw-ring-color' as string]: 'var(--theme-primary)',
                    }}
                    data-field-key={field.key}
                  >
                    <GripVertical size={12} className="mt-0.5 shrink-0 opacity-40 group-hover:opacity-80" aria-hidden />
                    <Icon size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--theme-primary-text)' }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                        {field.label || <em style={{ color: 'var(--theme-muted-text)' }}>Untitled</em>}
                        {field.required && <span className="ml-0.5" style={{ color: 'var(--status-blocked)' }}>*</span>}
                      </p>
                      <p className="truncate font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                        {field.type === 'heading' || field.type === 'divider' ? TASK_FIELD_TYPE_LABELS[field.type] : field.key}
                        {cell.span > 1 && ` · span ${cell.span}`}
                      </p>
                      {problem && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--status-blocked)' }}>{problem}</p>}
                    </div>
                  </div>
                )
              })}
              {free > 0 && (
                <div
                  {...dropProps(`free:${r}`, r, row.cells.length)}
                  className={cn('flex min-h-14 items-center justify-center rounded-lg border border-dashed text-[10px]', SPAN[free])}
                  style={{
                    borderColor: dropTarget === `free:${r}` ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                    backgroundColor: dropTarget === `free:${r}` ? 'var(--theme-primary-light)' : undefined,
                    color: 'var(--theme-muted-text)',
                  }}
                  aria-hidden
                >
                  Drop a field here
                </div>
              )}
            </div>
          </div>
        )
      })}
      <div
        {...dropProps('new-row', state.layout.rows.length, 0)}
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-[11px]"
        style={{
          borderColor: dropTarget === 'new-row' ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
          backgroundColor: dropTarget === 'new-row' ? 'var(--theme-primary-light)' : undefined,
          color: 'var(--theme-muted-text)',
        }}
      >
        <span className="flex-1">Drop here for a new row, or add an empty row:</span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ ...state, layout: addRow(state.layout, n) })}
            className="rounded border px-2 py-1 text-[10px] font-medium"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          >
            + {n} col{n === 1 ? '' : 's'}
          </button>
        ))}
      </div>
    </div>
  )
}
