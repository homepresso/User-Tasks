'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, LayoutList, Plus, Trash2 } from 'lucide-react'
import { addRow, findCell, moveRow, nudgeField, placeField, placeFieldInSection, removeRow, rowFree, setRowColumns, setRowSection, MAX_FORM_COLUMNS, type FormRow, type FormSection } from '@/lib/forms/layout'
import { sectionBlocks } from '@/lib/forms/sections'
import { addField, removeField, type DesignerState } from '@/lib/forms/designer-state'
import { TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { describeFieldButton } from '@/lib/forms/field-buttons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { DRAG_FIELD_KEY, DRAG_NEW_TYPE, FIELD_ICONS } from './field-icons'

/**
 * The designer's grid: rows of 1–4 columns holding field cards. Drag a type
 * from the palette (or a card) onto a card to insert before it, onto a row's
 * free space to append, or onto "new row". Keyboard: focus a card, Alt+Arrow
 * keys move it (left/right within the row, up/down between rows), Delete
 * removes it; Enter selects it for the properties panel.
 *
 * Sections (lib/forms/sections.ts) draw as a dashed group around their rows:
 * its header selects it (properties panel), a drop zone at its foot adds a
 * field to it, and each row's "Section" menu moves the row in or out
 * (the keyboard way). Moving a row up / down at a section's edge crosses it.
 */

const COLS = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4']
const SPAN = ['', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4']
/** A row's toolbar shows on hover or focus (always on touch). */
const ROW_TOOLS = 'opacity-0 transition-opacity duration-[var(--ds-dur-fast)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100'

export function GridCanvas({ state, selectedId, problems, onSelect, onChange, announce, sections = [], selectedSection = null, onSelectSection = () => {}, sectionProblems = {} }: {
  state: DesignerState
  selectedId: string | null
  problems: Record<string, string>
  /** The form's sections (layout.sections; the grid may be one page's). */
  sections?: FormSection[]
  selectedSection?: string | null
  onSelectSection?: (key: string | null) => void
  sectionProblems?: Record<string, string>
  onSelect: (id: string | null) => void
  onChange: (next: DesignerState, tag?: string) => void
  /** Screen-reader announcement (keyboard moves). */
  announce: (message: string) => void
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const byKey = new Map(state.fields.map((f) => [f.key, f]))
  const sectionsByKey = new Map(sections.map((s) => [s.key, s]))

  /** Drop at a section's foot: a new field (palette) or a moved one goes to the end of the section. */
  const sectionDropProps = (id: string, sectionKey: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].some((t) => t === DRAG_NEW_TYPE || t === DRAG_FIELD_KEY)) return
      e.preventDefault()
      e.stopPropagation()
      if (dropTarget !== id) setDropTarget(id)
    },
    onDragLeave: () => setDropTarget((t) => (t === id ? null : t)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDropTarget(null)
      const type = e.dataTransfer.getData(DRAG_NEW_TYPE) as TaskFieldType
      const key = e.dataTransfer.getData(DRAG_FIELD_KEY)
      if (type) {
        const { state: added, field } = addField(state, type)
        onChange({ ...added, layout: placeFieldInSection(added.layout, field.key, sectionKey) })
        onSelect(field._id)
        announce(`${TASK_FIELD_TYPE_LABELS[type]} added to ${sectionsByKey.get(sectionKey)?.title ?? 'the section'}`)
        return
      }
      if (key && byKey.has(key)) {
        onChange({ ...state, layout: placeFieldInSection(state.layout, key, sectionKey) })
        announce(`Moved into ${sectionsByKey.get(sectionKey)?.title ?? 'the section'}`)
      }
    },
  })

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

  function renderRow(row: FormRow, r: number) {
    const free = rowFree(row)
        return (
          <div key={r} className="group/row rounded-lg bg-subtle p-2" onClick={(e) => e.stopPropagation()} data-designer-row={r}>
            <div className="mb-2 flex min-h-6 flex-wrap items-center gap-2 text-2xs text-fg-muted">
              <span className="font-medium">Row {r + 1}</span>
              <div className={cn('flex items-center gap-1.5', ROW_TOOLS)}>
                <SegmentedControl size="sm" aria-label={`Row ${r + 1} columns`} value={String(row.columns)} onValueChange={(v) => onChange({ ...state, layout: setRowColumns(state.layout, r, Number(v)) })}
                  options={Array.from({ length: MAX_FORM_COLUMNS }, (_, i) => ({ value: String(i + 1), text: String(i + 1) }))} className="h-6 [&_button]:min-w-6 [&_button]:px-1.5 [&_button]:text-2xs" />
                <span>columns</span>
              </div>
              <div className={cn('ml-auto flex items-center gap-0.5', ROW_TOOLS)}>
                <IconButton size="sm" icon={<ArrowUp />} label={`Move row ${r + 1} up`} disabled={r === 0} onClick={() => onChange({ ...state, layout: moveRow(state.layout, r, -1) })} />
                <IconButton size="sm" icon={<ArrowDown />} label={`Move row ${r + 1} down`} disabled={r === state.layout.rows.length - 1} onClick={() => onChange({ ...state, layout: moveRow(state.layout, r, 1) })} />
                {sections.length > 0 && (
                  <select
                    aria-label={`Row ${r + 1} section`}
                    className="h-6 max-w-[9rem] rounded-md border border-input-border bg-input px-1 text-2xs text-fg"
                    value={row.section ?? ''}
                    onChange={(e) => { onChange({ ...state, layout: setRowSection(state.layout, r, e.target.value || null) }); announce(e.target.value ? `Row moved into ${sectionsByKey.get(e.target.value)?.title ?? 'the section'}` : 'Row moved out of the section') }}
                    data-row-section={r}
                  >
                    <option value="">No section</option>
                    {sections.map((s) => <option key={s.key} value={s.key}>{s.title || s.key}</option>)}
                  </select>
                )}
                <IconButton size="sm" icon={<Plus />} label={`Add a row below row ${r + 1}`} onClick={() => onChange({ ...state, layout: addRow(state.layout, row.columns, r + 1, row.section) })} />
                <IconButton
                  size="sm"
                  variant="danger-ghost"
                  icon={<Trash2 />}
                  label={`Remove row ${r + 1}${row.cells.length ? ' and its fields' : ''}`}
                  onClick={() => {
                    const { layout, removedKeys } = removeRow(state.layout, r)
                    const removed = new Set(removedKeys)
                    onChange({ ...state, layout, fields: state.fields.filter((f) => !removed.has(f.key)) })
                    if (selectedId && state.fields.some((f) => f._id === selectedId && removed.has(f.key))) onSelect(null)
                  }}
                />
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
                    className={cn('group relative flex min-h-14 cursor-pointer items-start gap-2 rounded-md border px-2 py-2 text-left transition-colors duration-[var(--ds-dur-fast)]', SPAN[Math.min(cell.span, row.columns)], problem ? 'border-danger' : selected ? 'border-primary' : 'border-border hover:border-border-strong', selected ? 'bg-primary-wash' : 'bg-panel', dropTarget === target && 'shadow-[inset_3px_0_0_var(--theme-primary)]')}
                    data-field-key={field.key}
                  >
                    <GripVertical size={14} className="mt-0.5 shrink-0 cursor-grab text-fg-subtle group-hover:text-fg-muted" aria-hidden />
                    <Icon size={14} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-ui font-medium text-fg">
                        {field.label || <em className="text-fg-muted">Untitled</em>}
                        {field.required && <span className="ml-0.5 text-danger">*</span>}
                      </p>
                      <p className="truncate font-mono text-2xs text-fg-muted">
                        {field.type === 'button' ? `Button · ${describeFieldButton(field.button)}` : field.type === 'heading' || field.type === 'divider' ? TASK_FIELD_TYPE_LABELS[field.type] : field.key}
                        {cell.span > 1 && ` · span ${cell.span}`}
                      </p>
                      {problem && <p className="mt-0.5 text-2xs text-danger">{problem}</p>}
                    </div>
                  </div>
                )
              })}
              {free > 0 && (
                <div
                  {...dropProps(`free:${r}`, r, row.cells.length)}
                  className={cn('flex min-h-14 items-center justify-center rounded-md border border-dashed text-2xs text-fg-muted', SPAN[free], dropTarget === `free:${r}` ? 'border-primary bg-primary-wash' : 'border-border')}
                  aria-hidden
                >
                  Drop a field here
                </div>
              )}
            </div>
          </div>
        )
  }

  return (
    <div className="space-y-3" onClick={() => onSelect(null)}>
      {state.layout.rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-ui text-fg-muted">
          Drag a field from the palette, or click one to add it.
        </p>
      )}
      {sectionBlocks(state.layout.rows).map((block) => {
        const section = block.section ? sectionsByKey.get(block.section) : undefined
        const rows = block.rows.map((row, i) => renderRow(row, block.start + i))
        if (!section) return rows
        const selected = selectedSection === section.key
        const problem = sectionProblems[section.key]
        const dropId = `section-end:${section.key}`
        return (
          <section
            key={`section-${section.key}`}
            aria-label={`Section ${section.title}`}
            className={cn('space-y-2 rounded-lg border border-dashed p-2', problem ? 'border-danger' : selected ? 'border-primary bg-primary-wash' : 'border-border-strong')}
            onClick={(e) => e.stopPropagation()}
            data-designer-section={section.key}
          >
            <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
              <button type="button" onClick={() => onSelectSection(section.key)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left font-medium text-fg" aria-pressed={selected} data-designer-section-select={section.key}>
                <LayoutList className="text-fg-muted" size={14} aria-hidden />
                <span className="truncate">{section.title || 'Untitled section'}</span>
                <span className="shrink-0 font-normal text-fg-muted">
                  · section{section.optional ? ' · optional' : ''}{section.collapsible ? ' · collapsible' : ''}{section.visible_when ? ' · conditional' : ''}{section.load === 'visible' ? ' · loads when shown' : section.load === 'rule' ? ' · loads by rule' : ''}
                </span>
              </button>
              <IconButton size="sm" icon={<Plus />} label={`Add a row to section ${section.title}`} onClick={() => onChange({ ...state, layout: addRow(state.layout, 1, block.start + block.rows.length, section.key) })} />
            </div>
            {problem && <p className="px-1 text-2xs text-danger">{problem}</p>}
            {rows}
            <div
              {...sectionDropProps(dropId, section.key)}
              className={cn('rounded-md border border-dashed p-2 text-center text-2xs text-fg-muted', dropTarget === dropId ? 'border-primary bg-primary-wash' : 'border-border')}
              aria-hidden
              data-section-drop={section.key}
            >
              Drop a field here to add it to {section.title || 'this section'}
            </div>
          </section>
        )
      })}
      <div
        {...dropProps('new-row', state.layout.rows.length, 0)}
        onClick={(e) => e.stopPropagation()}
        className={cn('flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-fg-muted', dropTarget === 'new-row' ? 'border-primary bg-primary-wash' : 'border-border')}
      >
        <span className="flex-1">Drop here for a new row, or add an empty row:</span>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange({ ...state, layout: addRow(state.layout, n) })}
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            + {n} col{n === 1 ? '' : 's'}
          </button>
        ))}
      </div>
    </div>
  )
}
