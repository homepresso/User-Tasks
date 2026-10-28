'use client'

/**
 * Tree data picker for workflow expressions: Steps → each upstream step →
 * its outputs, following reference response models level by level
 * (`Get Customers › response › data[] › address › city`), with the current
 * loop item inside a loop body. Lists (and fields inside lists) open a small
 * menu that makes single-value vs collection explicit: first item, item at
 * index, find item where…, all values as a list, count, loop through each.
 *
 * Data comes from lib/workflow-data-picker (pure), so the picker, the
 * Variables panel and the Loop items autocomplete always agree.
 */

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Braces, Brackets, ChevronDown, ChevronRight, CircleSlash, ClipboardList, Clock, GripVertical, Hash, HelpCircle, List, Plus, Repeat, Search, ToggleLeft, Type, X, AlertTriangle } from 'lucide-react'
import type { SchemaNode } from '@/lib/response-schema'
import { describeSchemaType } from '@/lib/response-schema'
import {
  arrayStatus,
  buildPickExpression,
  childItems,
  collectArrayCandidates,
  flattenTree,
  fuzzyScore,
  listSchemaFor,
  matchableFields,
  plainExpression,
  rankArrayCandidates,
  recentGroup,
  rootItem,
  splitPickPath,
  type ArrayCandidate,
  type DataGroup,
  type PickChoice,
  type PickerItem,
} from '@/lib/workflow-data-picker'
import { DATA_DRAG_MIME, decodeDragPayload, encodeDragPayload, loopItemsFromDrop, readRecentData, rememberRecentData, type DataDragPayload } from '@/lib/workflow-data-drop'

// ─── Context (provided by the node config panel) ─────────────────────────

export interface DataPickerContextValue {
  groups: DataGroup[]
  /** "Loop through each item": wrap the current step in a Loop over `itemsExpression`. */
  onInsertLoop?: (itemsExpression: string) => void
}

const DataPickerContext = createContext<DataPickerContextValue | null>(null)
export const DataPickerProvider = DataPickerContext.Provider
export function useDataPicker(): DataPickerContextValue | null {
  return useContext(DataPickerContext)
}

// ─── Bits ───────────────────────────────────────────────────────────────

export function TypeIcon({ schema, size = 12 }: { schema: SchemaNode | null | undefined; size?: number }) {
  const type = schema?.type ?? 'any'
  const Icon = type === 'object' ? Braces : type === 'array' ? List : type === 'string' ? Type : type === 'number' || type === 'integer' ? Hash : type === 'boolean' ? ToggleLeft : type === 'null' ? CircleSlash : HelpCircle
  return <Icon size={size} aria-hidden className="shrink-0" style={{ color: type === 'array' || type === 'object' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }} />
}

function exampleText(schema: SchemaNode): string | null {
  if (schema.example === undefined) return null
  if (schema.example === null) return 'null'
  return typeof schema.example === 'string' ? `"${schema.example}"` : String(schema.example)
}

function needsChoices(item: { path: string; schema: SchemaNode }): boolean {
  return item.schema.type === 'array' || item.path.includes('[]')
}

/** Group kinds open by default (the rest — other trigger data — start collapsed). */
const OPEN_BY_DEFAULT: ReadonlySet<string> = new Set(['loop', 'step', 'form', 'workflow', 'recent'])

/** Start dragging a data row: `{{path}}` as text (any input) plus the typed payload (choices, loops). */
export function startDataDrag(event: React.DragEvent, item: { path: string; label: string; schema: SchemaNode }) {
  const payload: DataDragPayload = { path: item.path, label: item.label, type: item.schema.type, needsChoices: needsChoices(item) }
  event.dataTransfer.setData('text/plain', plainExpression(item.path))
  event.dataTransfer.setData(DATA_DRAG_MIME, encodeDragPayload(payload))
  event.dataTransfer.effectAllowed = 'copy'
}

/** True while a workflow-data drag is over the target. */
export function isDataDrag(event: React.DragEvent | DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(DATA_DRAG_MIME)
}

/** The payload of a drop (null for other drags). */
export function dataDropPayload(event: React.DragEvent): DataDragPayload | null {
  return decodeDragPayload(event.dataTransfer.getData(DATA_DRAG_MIME))
}

/** Recently used paths (per viewer), kept current across pickers. */
function useRecentData(enabled: boolean): string[] {
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => {
    if (!enabled) return
    const load = () => setRecent(readRecentData())
    load()
    window.addEventListener('ut-recent-data', load)
    return () => window.removeEventListener('ut-recent-data', load)
  }, [enabled])
  return recent
}

/** `get_customers_response.data[].email` → `data › email` style breadcrumb (without the root). */
function breadcrumb(item: PickerItem): string {
  return item.path.replace(/\[\]/g, '[]').split('.').join(' › ')
}

// ─── Choices menu (single value vs collection) ───────────────────────────

function ChoicesMenu({ item, groups, onPick, onLoop, onClose }: {
  item: PickerItem
  groups: DataGroup[]
  onPick: (expression: string) => void
  onLoop?: (itemsExpression: string, insert: string) => void
  onClose: () => void
}) {
  const parts = splitPickPath(item.path, item.schema)
  const listSchema = listSchemaFor(item.path, item.schema, groups)
  const fields = matchableFields(listSchema?.items)
  const [mode, setMode] = useState<'menu' | 'index' | 'find'>('menu')
  const [index, setIndex] = useState('1')
  const [findField, setFindField] = useState(fields[0] ?? '')
  const [findValue, setFindValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const fieldLabel = parts.itemPath || 'item'
  const listLabel = (parts.arrayPath ?? '').split('.').slice(-1)[0] || 'list'

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus()
  }, [mode])

  const expr = (choice: PickChoice) => buildPickExpression(item.path, item.schema, choice)
  const choices: { key: string; label: string; hint: string; run: () => void; icon?: React.ReactNode }[] = []
  if (onLoop && parts.arrayPath) {
    choices.push({
      key: 'loop',
      label: 'Loop through each item',
      hint: parts.isList ? `Runs this step once per item of ${listLabel}` : `Runs this step per item; inserts {{item.${fieldLabel}}}`,
      icon: <Repeat size={12} aria-hidden />,
      run: () => onLoop(`{{${parts.arrayPath}}}`, expr({ kind: 'loop' })),
    })
  }
  choices.push({ key: 'first', label: parts.isList ? 'First item' : `First item's ${fieldLabel}`, hint: expr({ kind: 'first' }), run: () => onPick(expr({ kind: 'first' })) })
  choices.push({ key: 'index', label: 'Item at index…', hint: 'Pick a position (1 = first)', run: () => setMode('index') })
  if (!parts.isList && fields.length) choices.push({ key: 'find', label: 'Find item where…', hint: 'Match a field to a value', run: () => setMode('find') })
  if (parts.isList && fields.length) choices.push({ key: 'find', label: 'Find item where…', hint: 'Match a field to a value', run: () => setMode('find') })
  if (!parts.isList) choices.push({ key: 'pluck', label: `All values of ${fieldLabel} as a list`, hint: expr({ kind: 'pluck' }), run: () => onPick(expr({ kind: 'pluck' })) })
  choices.push({ key: 'count', label: 'Count of items', hint: expr({ kind: 'count' }), run: () => onPick(expr({ kind: 'count' })) })
  if (parts.isList) choices.push({ key: 'list', label: 'The whole list', hint: expr({ kind: 'list' }), run: () => onPick(expr({ kind: 'list' })) })

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (mode !== 'menu') setMode('menu'); else onClose(); return }
    if (mode !== 'menu' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-choice]') ?? [])
    const at = buttons.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={ref}
      role="group"
      aria-label={`Choose how to use ${item.label}`}
      onKeyDown={onKeyDown}
      className="mx-1 my-1 rounded-md border p-1"
      style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
    >
      <p className="px-1.5 pb-1 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
        {parts.isList ? <><strong style={{ color: 'var(--theme-card-text)' }}>{item.label}</strong> is a list. Use…</> : <><strong style={{ color: 'var(--theme-card-text)' }}>{fieldLabel}</strong> is inside a list. Use…</>}
      </p>
      {mode === 'menu' && choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          data-choice
          onClick={choice.run}
          className="flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-[var(--theme-row-highlight)] focus:bg-[var(--theme-row-highlight)] focus:outline-none"
          style={{ color: 'var(--theme-card-text)' }}
        >
          <span className="mt-0.5 shrink-0" style={{ color: 'var(--theme-primary-text)' }}>{choice.icon ?? <ChevronRight size={12} aria-hidden />}</span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{choice.label}</span>
            <span className="block truncate font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{choice.hint}</span>
          </span>
        </button>
      ))}
      {mode === 'index' && (
        <form className="flex items-center gap-1.5 px-1.5 py-1" onSubmit={(e) => { e.preventDefault(); onPick(expr({ kind: 'index', index: Math.max(1, Number(index) || 1) - 1 })) }}>
          <label className="text-[11px]" style={{ color: 'var(--theme-card-text)' }} htmlFor={`${item.id}-index`}>Position</label>
          <input id={`${item.id}-index`} type="number" min={1} value={index} onChange={(e) => setIndex(e.target.value)}
            className="w-16 rounded border px-1.5 py-0.5 text-[11px]" style={{ backgroundColor: 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
          <button type="submit" className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>Insert</button>
        </form>
      )}
      {mode === 'find' && (
        <form className="space-y-1 px-1.5 py-1" onSubmit={(e) => { e.preventDefault(); if (findField) onPick(expr({ kind: 'find', field: findField, value: findValue })) }}>
          <div className="flex items-center gap-1.5">
            <label className="w-12 text-[11px]" style={{ color: 'var(--theme-card-text)' }} htmlFor={`${item.id}-find-field`}>Where</label>
            <select id={`${item.id}-find-field`} value={findField} onChange={(e) => setFindField(e.target.value)}
              className="min-w-0 flex-1 rounded border px-1 py-0.5 text-[11px]" style={{ backgroundColor: 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
              {fields.map((field) => <option key={field} value={field}>{field}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="w-12 text-[11px]" style={{ color: 'var(--theme-card-text)' }} htmlFor={`${item.id}-find-value`}>equals</label>
            <input id={`${item.id}-find-value`} value={findValue} onChange={(e) => setFindValue(e.target.value)} placeholder="value or {{variable}}"
              className="min-w-0 flex-1 rounded border px-1.5 py-0.5 font-mono text-[11px]" style={{ backgroundColor: 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
              Insert {parts.isList ? 'item' : fieldLabel}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Tree ───────────────────────────────────────────────────────────────

interface VisibleRow { item: PickerItem; groupId: string; breadcrumb?: string }

export interface DataTreeProps {
  groups: DataGroup[]
  /** Insert an expression (`{{...}}` / `{{=...}}`). */
  onPick: (expression: string) => void
  /** "Loop through each item": `itemsExpression` for the Loop; `insert` is the item expression for the field. */
  onLoop?: (itemsExpression: string, insert: string) => void
  /** "Add as output" on a row (path is the tree path, `[]` = inside each item). */
  onAddOutput?: (item: PickerItem) => void
  /** Rows have no pick action (preview only); Enter toggles. */
  readOnly?: boolean
  autoFocusSearch?: boolean
  emptyMessage?: string
  className?: string
  maxHeight?: number
  /** Fill the parent's height (a flex column) instead of a max height. */
  fill?: boolean
}

export function DataTree({ groups: treeGroups, onPick: onPickRaw, onLoop, onAddOutput, readOnly, autoFocusSearch, emptyMessage, className, maxHeight = 320, fill }: DataTreeProps) {
  const [query, setQuery] = useState('')
  const recentPaths = useRecentData(!readOnly)
  const groups = useMemo(() => {
    const recent = readOnly ? null : recentGroup(treeGroups, recentPaths)
    return recent ? [recent, ...treeGroups] : treeGroups
  }, [treeGroups, recentPaths, readOnly])
  const onPick = useCallback((expression: string) => {
    if (!readOnly) rememberRecentData(expression)
    onPickRaw(expression)
  }, [onPickRaw, readOnly])
  // Group headers: membership in `expanded` flips the kind's default (form
  // fields, steps and loop items open; other trigger data collapsed).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>()
    for (const group of groups) {
      if (group.kind !== 'loop' && group.kind !== 'step') continue
      // Open structured roots (a response, the current item) one level.
      for (const root of group.roots) if (root.schema && (root.schema.type === 'object' || root.schema.type === 'array')) open.add(`${group.id}:${root.path}`)
    }
    return open
  })
  const groupOpen = useCallback((group: DataGroup) => OPEN_BY_DEFAULT.has(group.kind) !== expanded.has(`group:${group.id}`), [expanded])
  const [active, setActive] = useState(0)
  const [choicesFor, setChoicesFor] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const treeId = useId()

  useEffect(() => { if (autoFocusSearch) searchRef.current?.focus() }, [autoFocusSearch])

  const rows: (VisibleRow | { header: DataGroup })[] = useMemo(() => {
    const out: (VisibleRow | { header: DataGroup })[] = []
    if (query.trim()) {
      const matches = flattenTree(groups)
        .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.path), fuzzyScore(query, item.label) + 50) }))
        .filter((entry) => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 60)
      for (const { item } of matches) out.push({ item: { ...item, depth: 0 }, groupId: item.group, breadcrumb: `${item.group} › ${breadcrumb(item)}` })
      return out
    }
    for (const group of groups) {
      out.push({ header: group })
      if (!groupOpen(group)) continue
      const walk = (item: PickerItem) => {
        out.push({ item, groupId: group.id })
        if (item.hasChildren && expanded.has(item.id)) for (const child of childItems(item)) walk(child)
      }
      for (const root of group.roots) walk(rootItem(group, root))
    }
    return out
  }, [groups, expanded, query, groupOpen])

  const focusable = rows
  useEffect(() => { setActive((current) => Math.min(current, Math.max(focusable.length - 1, 0))) }, [focusable.length])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  function activate(row: VisibleRow | { header: DataGroup }) {
    if ('header' in row) { toggle(`group:${row.header.id}`); return }
    if (readOnly) { if (row.item.hasChildren) toggle(row.item.id); return }
    if (needsChoices(row.item)) { setChoicesFor((current) => (current === row.item.id ? null : row.item.id)); return }
    onPick(plainExpression(row.item.path))
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (choicesFor && (event.target as HTMLElement).closest('[role="group"]')) return
    const row = focusable[active]
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); setActive((i) => Math.min(i + 1, focusable.length - 1)); setChoicesFor(null); break
      case 'ArrowUp': event.preventDefault(); setActive((i) => Math.max(i - 1, 0)); setChoicesFor(null); break
      case 'ArrowRight':
        if (!row) break
        event.preventDefault()
        if ('header' in row) { if (!groupOpen(row.header)) toggle(`group:${row.header.id}`) } else if (row.item.hasChildren && !expanded.has(row.item.id)) toggle(row.item.id)
        else setActive((i) => Math.min(i + 1, focusable.length - 1))
        break
      case 'ArrowLeft':
        if (!row) break
        event.preventDefault()
        if ('header' in row) { if (groupOpen(row.header)) toggle(`group:${row.header.id}`) } else if (row.item.hasChildren && expanded.has(row.item.id)) toggle(row.item.id)
        else {
          // Jump to the parent row.
          for (let i = active - 1; i >= 0; i--) {
            const candidate = focusable[i]
            if ('header' in candidate || candidate.item.depth < row.item.depth) { setActive(i); break }
          }
        }
        break
      case 'Enter':
        if (!row) break
        event.preventDefault()
        activate(row)
        break
      case 'Home': event.preventDefault(); setActive(0); break
      case 'End': event.preventDefault(); setActive(focusable.length - 1); break
      default: break
    }
  }

  const choiceItem = choicesFor ? (rows.find((row) => !('header' in row) && row.item.id === choicesFor) as VisibleRow | undefined)?.item : undefined

  return (
    <div className={className} onKeyDown={onKeyDown}>
      <div className="relative px-2 pt-2 pb-1">
        <Search size={12} aria-hidden className="absolute left-4 top-1/2 -translate-y-1/2 mt-0.5" style={{ color: 'var(--theme-muted-text)' }} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setChoicesFor(null) }}
          placeholder="Search data (e.g. email)"
          aria-label="Search data"
          aria-controls={treeId}
          className="w-full rounded-md border py-1 pl-7 pr-2 text-[11px] outline-none focus:ring-1"
          style={{ backgroundColor: 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        />
      </div>
      <div
        ref={listRef}
        id={treeId}
        role="tree"
        aria-label="Workflow data"
        tabIndex={0}
        aria-activedescendant={focusable.length ? `${treeId}-row-${active}` : undefined}
        className={`overflow-y-auto px-1 pb-1 outline-none focus-visible:ring-1${fill ? ' min-h-0 flex-1' : ''}`}
        style={fill ? undefined : { maxHeight }}
      >
        {rows.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            {query ? `Nothing matches "${query}"` : emptyMessage ?? 'No data from earlier steps yet. Connect this step after the steps whose data you need.'}
          </p>
        )}
        {rows.map((row, index) => {
          const isActive = index === active
          if ('header' in row) {
            const open = groupOpen(row.header)
            return (
              <div
                key={`h-${row.header.id}`}
                id={`${treeId}-row-${index}`}
                data-row-index={index}
                role="treeitem"
                aria-expanded={open}
                aria-level={1}
                aria-selected={isActive}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setActive(index); toggle(`group:${row.header.id}`) }}
                className="mt-1 flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--theme-muted-text)', backgroundColor: isActive ? 'var(--theme-row-highlight)' : undefined }}
              >
                {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                {row.header.kind === 'loop' && <Repeat size={11} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />}
                {(row.header.kind === 'form' || row.header.kind === 'workflow') && <ClipboardList size={11} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />}
                {row.header.kind === 'recent' && <Clock size={11} aria-hidden />}
                <span className="truncate">{row.header.label}</span>
              </div>
            )
          }
          const { item } = row
          const open = expanded.has(item.id)
          const example = exampleText(item.schema)
          const showChoices = choiceItem?.id === item.id
          const label = item.schema.type === 'array' ? `${item.label}[]` : item.label
          return (
            <div key={item.id} role="none">
              <div
                id={`${treeId}-row-${index}`}
                data-row-index={index}
                role="treeitem"
                aria-level={item.depth + 2}
                aria-selected={isActive}
                aria-expanded={item.hasChildren ? open : undefined}
                title={item.description ? `${item.description}\n${plainExpression(item.path)}` : plainExpression(item.path)}
                draggable={!readOnly}
                onDragStart={readOnly ? undefined : (e) => { e.stopPropagation(); startDataDrag(e, item) }}
                onMouseDown={(e) => { if (!readOnly) return; e.preventDefault() }}
                onClick={() => { setActive(index); activate(row) }}
                data-data-path={item.path}
                className={`group flex cursor-pointer items-center gap-1 rounded py-1 pr-1 text-[11px]${readOnly ? '' : ' active:cursor-grabbing'}`}
                style={{ paddingLeft: 6 + item.depth * 12, backgroundColor: isActive ? 'var(--theme-row-highlight)' : undefined, color: 'var(--theme-card-text)' }}
              >
                {item.hasChildren && !row.breadcrumb ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                    onClick={(e) => { e.stopPropagation(); setActive(index); toggle(item.id) }}
                    className="shrink-0 rounded hover:opacity-70"
                    style={{ color: 'var(--theme-muted-text)' }}
                  >
                    {open ? <ChevronDown size={11} aria-hidden /> : <ChevronRight size={11} aria-hidden />}
                  </button>
                ) : <span className="w-[11px] shrink-0" />}
                <TypeIcon schema={item.schema} size={11} />
                {item.hint ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {row.breadcrumb ? <span style={{ color: 'var(--theme-muted-text)' }}>{row.breadcrumb.split(' › ').slice(0, -1).join(' › ')} › </span> : null}
                      <span className="font-medium">{label}</span>
                    </span>
                    <span className="block truncate font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {item.hint}{example ? ` · e.g. ${example}` : ''}
                    </span>
                  </span>
                ) : (<>
                  <span className="min-w-0 truncate font-mono">
                    {row.breadcrumb ? <span style={{ color: 'var(--theme-muted-text)' }}>{row.breadcrumb.split(' › ').slice(0, -1).join(' › ')} › </span> : null}
                    {label}
                  </span>
                  {example && <span className="min-w-0 flex-1 truncate font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{example}</span>}
                  {!example && <span className="flex-1" />}
                </>)}
                {!readOnly && <GripVertical size={11} aria-hidden className="shrink-0 opacity-0 group-hover:opacity-60" style={{ color: 'var(--theme-muted-text)' }} />}
                <span className="shrink-0 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{describeSchemaType(item.schema)}</span>
                {onAddOutput && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title="Add as output"
                    aria-label={`Add ${item.label} as output`}
                    onClick={(e) => { e.stopPropagation(); onAddOutput(item) }}
                    className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 group-hover:opacity-100"
                    style={{ color: 'var(--theme-primary-text)' }}
                  >
                    <Plus size={11} aria-hidden />
                  </button>
                )}
              </div>
              {showChoices && choiceItem && (
                <ChoicesMenu
                  item={choiceItem}
                  groups={groups}
                  onPick={(expression) => { setChoicesFor(null); onPick(expression) }}
                  onLoop={onLoop ? (items, insert) => { setChoicesFor(null); onLoop(items, insert) } : undefined}
                  onClose={() => { setChoicesFor(null); listRef.current?.focus() }}
                />
              )}
            </div>
          )
        })}
      </div>
      {!readOnly && (
        <p className="px-2.5 pb-1.5 pt-1 text-[10px]" style={{ borderTop: '1px solid var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
          ↑↓ move · → open · Enter insert · drag onto any input · lists offer first / find / loop
        </p>
      )}
    </div>
  )
}

// ─── Button + popover used next to expression inputs ─────────────────────

const POPOVER_WIDTH = 352

/**
 * Rendered in a portal at a fixed position under `anchor` (the input), so the
 * narrow, scrolling config panel never clips it; flips above when there is no
 * room below and stays inside the viewport.
 */
export function DataPickerPopover({ onPick, onClose, anchor }: {
  onPick: (expression: string) => void
  onClose: () => void
  anchor: HTMLElement | null
}) {
  const picker = useDataPicker()
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  useLayoutEffect(() => {
    function place() {
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16)
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const openAbove = below < 320 && above > below
      const maxHeight = Math.max(220, Math.min(480, openAbove ? above : below))
      setPosition({ top: openAbove ? Math.max(8, rect.top - 4 - maxHeight) : rect.bottom + 4, left, width, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [anchor])
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose, anchor])
  if (!picker || typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Insert data"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } else e.stopPropagation() }}
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-[200] flex flex-col rounded-lg border shadow-xl"
      style={{
        backgroundColor: 'var(--theme-card-bg)',
        borderColor: 'var(--theme-surface-border)',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: position?.width ?? POPOVER_WIDTH,
        maxHeight: position?.maxHeight,
      }}
    >
      <div className="flex items-center justify-between px-2.5 pt-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--theme-card-text)' }}>Insert data</span>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-0.5 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}><X size={12} aria-hidden /></button>
      </div>
      <DataTree
        groups={picker.groups}
        autoFocusSearch
        maxHeight={Math.max(140, (position?.maxHeight ?? 420) - 110)}
        onPick={(expression) => { onPick(expression); onClose() }}
        onLoop={picker.onInsertLoop ? (items, insert) => { picker.onInsertLoop!(items); onPick(insert); onClose() } : undefined}
      />
    </div>,
    document.body,
  )
}

export function DataPickerButton({ onPick }: { onPick: (expression: string) => void }) {
  const picker = useDataPicker()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  if (!picker) return null
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Insert data from earlier steps"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Insert data from earlier steps"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className="absolute right-1 top-1 rounded p-0.5 hover:opacity-80"
        style={{ color: open ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)', backgroundColor: open ? 'var(--theme-primary-light)' : 'transparent' }}
      >
        <Brackets size={12} aria-hidden />
      </button>
      {open && <DataPickerPopover onPick={onPick} onClose={() => { setOpen(false); buttonRef.current?.focus() }} anchor={buttonRef.current?.parentElement ?? null} />}
    </>
  )
}

// ─── Drop of a list (or a field inside one): first / all / loop ─────────

/**
 * Shown where a list-valued item was dropped on an input: the same choices
 * as the picker (first item, index, find, all values, count, loop).
 */
export function DropChoicesPopover({ payload, at, onPick, onClose }: {
  payload: DataDragPayload
  at: { x: number; y: number }
  onPick: (expression: string) => void
  onClose: () => void
}) {
  const picker = useDataPicker()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(event: MouseEvent) { if (ref.current && !ref.current.contains(event.target as Node)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])
  if (typeof document === 'undefined') return null
  const schema: SchemaNode = payload.type === 'array' ? (listSchemaFor(payload.path, { type: 'array' }, picker?.groups ?? []) ?? { type: 'array' }) : { type: (payload.type || 'any') as SchemaNode['type'] }
  const item: PickerItem = { id: `drop:${payload.path}`, label: payload.label, path: payload.path, schema, depth: 0, hasChildren: false, group: '' }
  const width = 300
  const left = Math.min(Math.max(8, at.x - 20), window.innerWidth - width - 8)
  const top = Math.min(at.y + 8, window.innerHeight - 260)
  return createPortal(
    <div ref={ref} role="dialog" aria-label={`Insert ${payload.label}`} className="fixed z-[210] rounded-lg border shadow-xl" style={{ top, left, width, backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } else e.stopPropagation() }}
      onPointerDown={(e) => e.stopPropagation()}>
      <ChoicesMenu
        item={item}
        groups={picker?.groups ?? []}
        onPick={(expression) => { rememberRecentData(expression); onPick(expression) }}
        onLoop={picker?.onInsertLoop ? (items, insert) => { picker.onInsertLoop!(items); onPick(insert) } : undefined}
        onClose={onClose}
      />
    </div>,
    document.body,
  )
}

// ─── Loop "items to loop through" autocomplete ──────────────────────────

export function LoopItemsInput({ value, onChange, groups, placeholder }: {
  value: string
  onChange: (value: string) => void
  groups: DataGroup[]
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [query, setQuery] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const candidates = useMemo(() => collectArrayCandidates(groups), [groups])
  const ranked = useMemo(() => rankArrayCandidates(query ?? '', candidates), [query, candidates])
  const status = useMemo(() => arrayStatus(value, groups), [value, groups])

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])
  useEffect(() => { setActive((current) => Math.min(current, Math.max(ranked.length - 1, 0))) }, [ranked.length])
  useEffect(() => {
    if (!open) return
    containerRef.current?.querySelector<HTMLElement>(`[data-option-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function choose(candidate: ArrayCandidate) {
    onChange(candidate.expression)
    setQuery(null)
    setOpen(false)
  }

  // Group the ranked list by step, keeping rank order within and between groups.
  const grouped: { group: string; kind: string; items: { candidate: ArrayCandidate; index: number }[] }[] = []
  ranked.forEach((candidate, index) => {
    let bucket = grouped.find((entry) => entry.group === candidate.group)
    if (!bucket) { bucket = { group: candidate.group, kind: candidate.groupKind, items: [] }; grouped.push(bucket) }
    bucket.items.push({ candidate, index })
  })
  const order = grouped.flatMap((bucket) => bucket.items.map((entry) => entry.candidate))

  return (
    <div ref={containerRef} className="relative" onPointerDown={(e) => e.stopPropagation()}>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && order.length ? `${listId}-opt-${active}` : undefined}
        aria-label="Items to loop through"
        value={value}
        onDragOver={(e) => { if (!isDataDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          const payload = dataDropPayload(e)
          if (!payload) return
          // A list (or a field inside one) sets the loop to that list.
          e.preventDefault()
          const items = loopItemsFromDrop(payload)
          onChange(items ?? `{{${payload.path}}}`)
          setOpen(false)
        }}
        placeholder={placeholder ?? 'Pick a list, or type {{variable}}'}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(order.length - 1, 0))); return }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return }
          if (e.key === 'Enter' && open && order[active]) { e.preventDefault(); choose(order[active]); return }
          if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } return }
          e.stopPropagation()
        }}
        className={`w-full rounded-md border px-2 py-1.5 font-mono text-xs outline-none focus:ring-1${dragOver ? ' ring-2' : ''}`}
        style={{ backgroundColor: dragOver ? 'var(--theme-primary-light)' : 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: dragOver ? 'var(--theme-primary)' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)', ['--tw-ring-color' as string]: 'var(--theme-primary)' }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Lists you can loop through"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border shadow-xl"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          {order.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              {candidates.length === 0 ? 'No lists from earlier steps yet — you can still type an expression.' : 'No list matches — free text is fine too.'}
            </p>
          ) : grouped.map((bucket) => (
            <div key={bucket.group} role="group" aria-label={bucket.group}>
              <div className="sticky top-0 flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                {bucket.kind === 'loop' && <Repeat size={10} aria-hidden />}
                {bucket.group}
              </div>
              {bucket.items.map(({ candidate }) => {
                const position = order.indexOf(candidate)
                const isActive = position === active
                return (
                  <div
                    key={candidate.path}
                    id={`${listId}-opt-${position}`}
                    data-option-index={position}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => { e.preventDefault(); choose(candidate) }}
                    onMouseEnter={() => setActive(position)}
                    className="cursor-pointer px-2.5 py-1.5"
                    style={{ backgroundColor: isActive ? 'var(--theme-row-highlight)' : undefined }}
                  >
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
                      <List size={11} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />
                      <span className="min-w-0 flex-1 truncate font-mono">{candidate.label}</span>
                      <span className="shrink-0 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{candidate.hint}</span>
                    </div>
                    <div className="truncate pl-[17px] font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {candidate.preview ? `e.g. ${candidate.preview}` : candidate.expression}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {status === 'not-array' && (
        <p role="status" className="mt-1 flex items-start gap-1 text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
          <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" style={{ color: 'var(--theme-warning)' }} />
          This value isn&apos;t known to be a list — the loop will run zero times unless it is one at run time.
        </p>
      )}
    </div>
  )
}
