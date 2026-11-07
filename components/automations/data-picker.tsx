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
import { Button } from '@/components/ui/button'
import { floatingSurfaceClass } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

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
  return <Icon size={size} aria-hidden className={cn('shrink-0', type === 'array' || type === 'object' ? 'text-primary-text' : 'text-fg-subtle')} />
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
      className="m-1 rounded-md bg-subtle p-1"
    >
      <p className="px-2 pb-1 pt-0.5 text-xs text-fg-muted">
        {parts.isList ? <><span className="font-medium text-fg">{item.label}</span> is a list. Use…</> : <><span className="font-medium text-fg">{fieldLabel}</span> is inside a list. Use…</>}
      </p>
      {mode === 'menu' && choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          data-choice
          onClick={choice.run}
          className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-ui text-fg hover:bg-panel focus-visible:bg-panel"
        >
          <span className="mt-0.5 shrink-0 text-fg-muted [&>svg]:size-3.5">{choice.icon ?? <ChevronRight size={14} aria-hidden />}</span>
          <span className="min-w-0 flex-1">
            <span className="block">{choice.label}</span>
            <span className="block truncate font-mono text-2xs text-fg-muted">{choice.hint}</span>
          </span>
        </button>
      ))}
      {mode === 'index' && (
        <form className="flex items-center gap-1.5 px-2 py-1" onSubmit={(e) => { e.preventDefault(); onPick(expr({ kind: 'index', index: Math.max(1, Number(index) || 1) - 1 })) }}>
          <label className="text-xs font-medium text-fg" htmlFor={`${item.id}-index`}>Position</label>
          <Input id={`${item.id}-index`} type="number" min={1} value={index} onChange={(e) => setIndex(e.target.value)}
            size="sm" className="num w-16" />
          <Button type="submit" size="sm">Insert</Button>
        </form>
      )}
      {mode === 'find' && (
        <form className="space-y-1.5 px-2 py-1" onSubmit={(e) => { e.preventDefault(); if (findField) onPick(expr({ kind: 'find', field: findField, value: findValue })) }}>
          <div className="flex items-center gap-1.5">
            <label className="w-12 text-xs font-medium text-fg" htmlFor={`${item.id}-find-field`}>Where</label>
            <Select id={`${item.id}-find-field`} value={findField} onChange={(e) => setFindField(e.target.value)}
              size="sm" wrapperClassName="min-w-0 flex-1">
              {fields.map((field) => <option key={field} value={field}>{field}</option>)}
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="w-12 text-xs font-medium text-fg" htmlFor={`${item.id}-find-value`}>equals</label>
            <Input id={`${item.id}-find-value`} value={findValue} onChange={(e) => setFindValue(e.target.value)} placeholder="value or {{variable}}"
              size="sm" className="min-w-0 flex-1 font-mono text-xs" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm">
              Insert {parts.isList ? 'item' : fieldLabel}
            </Button>
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
      <div className="px-2 pb-1 pt-2">
        <Input
          ref={searchRef}
          size="sm"
          leading={<Search />}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setChoicesFor(null) }}
          placeholder="Search data (e.g. email)"
          aria-label="Search data"
          aria-controls={treeId}
        />
      </div>
      <div
        ref={listRef}
        id={treeId}
        role="tree"
        aria-label="Workflow data"
        tabIndex={0}
        aria-activedescendant={focusable.length ? `${treeId}-row-${active}` : undefined}
        className={cn('overflow-y-auto rounded-md px-1 pb-1', fill && 'min-h-0 flex-1')}
        style={fill ? undefined : { maxHeight }}
      >
        {rows.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-fg-muted">
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
                className={cn('mt-1 flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-fg-muted hover:bg-subtle hover:text-fg', isActive && 'bg-subtle text-fg')}
              >
                {open ? <ChevronDown size={14} aria-hidden className="shrink-0" /> : <ChevronRight size={14} aria-hidden className="shrink-0" />}
                {row.header.kind === 'loop' && <Repeat size={12} aria-hidden className="shrink-0" />}
                {(row.header.kind === 'form' || row.header.kind === 'workflow') && <ClipboardList size={12} aria-hidden className="shrink-0" />}
                {row.header.kind === 'recent' && <Clock size={12} aria-hidden className="shrink-0" />}
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
                className={cn('group flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md py-1 pr-1.5 text-ui text-fg hover:bg-subtle', isActive && 'bg-subtle', !readOnly && 'active:cursor-grabbing')}
                style={{ paddingLeft: 6 + item.depth * 12 }}
              >
                {item.hasChildren && !row.breadcrumb ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
                    onClick={(e) => { e.stopPropagation(); setActive(index); toggle(item.id) }}
                    className="shrink-0 rounded-sm text-fg-muted hover:bg-muted hover:text-fg"
                  >
                    {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  </button>
                ) : <span className="w-3.5 shrink-0" />}
                <TypeIcon schema={item.schema} size={12} />
                {item.hint ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {row.breadcrumb ? <span className="text-fg-muted">{row.breadcrumb.split(' › ').slice(0, -1).join(' › ')} › </span> : null}
                      <span>{label}</span>
                    </span>
                    <span className="block truncate font-mono text-2xs text-fg-muted">
                      {item.hint}{example ? ` · e.g. ${example}` : ''}
                    </span>
                  </span>
                ) : (<>
                  <span className="min-w-0 truncate font-mono text-xs">
                    {row.breadcrumb ? <span className="text-fg-muted">{row.breadcrumb.split(' › ').slice(0, -1).join(' › ')} › </span> : null}
                    {label}
                  </span>
                  {example && <span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted">{example}</span>}
                  {!example && <span className="flex-1" />}
                </>)}
                {!readOnly && <GripVertical size={12} aria-hidden className="shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100" />}
                <span className="shrink-0 text-right text-2xs text-fg-subtle">{describeSchemaType(item.schema)}</span>
                {onAddOutput && (
                  <button
                    type="button"
                    tabIndex={-1}
                    title="Add as output"
                    aria-label={`Add ${item.label} as output`}
                    onClick={(e) => { e.stopPropagation(); onAddOutput(item) }}
                    className="shrink-0 rounded-sm p-0.5 text-primary-text opacity-60 hover:bg-primary-wash hover:opacity-100 group-hover:opacity-100"
                  >
                    <Plus size={12} aria-hidden />
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
        <p className="border-t border-border-subtle px-2.5 pb-1.5 pt-1 text-2xs text-fg-subtle">
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
      className={cn('fixed z-[200] flex flex-col border border-border', floatingSurfaceClass)}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: position?.width ?? POPOVER_WIDTH,
        maxHeight: position?.maxHeight,
      }}
    >
      <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
        <span className="text-ui font-semibold text-fg">Insert data</span>
        <IconButton size="sm" label="Close" icon={<X />} onClick={onClose} noTooltip />
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
        className={cn('absolute right-1 top-1 rounded-sm p-0.5 transition-colors', open ? 'bg-primary-wash text-primary-text' : 'text-fg-muted hover:bg-subtle hover:text-fg')}
      >
        <Brackets size={14} aria-hidden />
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
    <div ref={ref} role="dialog" aria-label={`Insert ${payload.label}`} className={cn('fixed z-[210] border border-border', floatingSurfaceClass)} style={{ top, left, width }}
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
      <Input
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
        className={cn('font-mono text-xs', dragOver && 'border-primary bg-primary-wash ring-2 ring-primary')}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Lists you can loop through"
          className={cn('absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto border border-border p-1', floatingSurfaceClass)}
        >
          {order.length === 0 ? (
            <p className="px-2 py-2 text-xs text-fg-muted">
              {candidates.length === 0 ? 'No lists from earlier steps yet — you can still type an expression.' : 'No list matches — free text is fine too.'}
            </p>
          ) : grouped.map((bucket) => (
            <div key={bucket.group} role="group" aria-label={bucket.group}>
              <div className="sticky top-0 flex items-center gap-1.5 bg-elevated px-2 pb-1 pt-2 text-xs font-medium text-fg-muted">
                {bucket.kind === 'loop' && <Repeat size={12} aria-hidden />}
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
                    className={cn('cursor-pointer rounded-md px-2 py-1', isActive && 'bg-subtle')}
                  >
                    <div className="flex items-center gap-1.5 text-ui text-fg">
                      <List size={12} aria-hidden className="shrink-0 text-primary-text" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{candidate.label}</span>
                      <span className="shrink-0 text-2xs text-fg-subtle">{candidate.hint}</span>
                    </div>
                    <div className="truncate pl-[18px] font-mono text-2xs text-fg-muted">
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
        <p role="status" className="mt-1 flex items-start gap-1.5 text-xs text-fg">
          <AlertTriangle size={14} aria-hidden className="mt-px shrink-0 text-warning" />
          This value isn&apos;t known to be a list — the loop will run zero times unless it is one at run time.
        </p>
      )}
    </div>
  )
}
