/**
 * Undo / redo history for the workflow designer.
 *
 * Snapshots hold references to the designer's immutable state arrays, so
 * consecutive snapshots share every node, edge and config object that did
 * not change (structural sharing — nothing is deep-cloned). A change is
 * described by diffing two snapshots by reference, which also yields a
 * coalescing key: rapid edits of the same field of the same step (typing in
 * the config panel, dragging a section's resize handle) fold into one entry
 * while they keep arriving within the idle window.
 */

import type { WorkflowEdge, WorkflowNode } from './workflow-schema'

export interface DesignerSnapshot<V = unknown, L = unknown> {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  userVariables: V[]
  swimlanes: L[]
}

export interface HistoryEntry<S> {
  snapshot: S
  /** What the change away from this snapshot did, e.g. "move step 'Manager approval'". */
  label: string
}

export interface HistoryState<S> {
  past: HistoryEntry<S>[]
  present: S
  future: HistoryEntry<S>[]
  /** Coalescing key and time of the newest past entry. */
  lastKey?: string
  lastAt: number
}

export interface ChangeDescription {
  label: string
  /** Changes with the same key arriving within the window merge into one entry. */
  key?: string
}

export const HISTORY_LIMIT = 100
export const COALESCE_MS = 500

export function createHistory<S>(present: S): HistoryState<S> {
  return { past: [], present, future: [], lastAt: 0 }
}

/** Record `next` as the new present. */
export function commit<S>(h: HistoryState<S>, next: S, change: ChangeDescription, now: number, limit = HISTORY_LIMIT): HistoryState<S> {
  if (next === h.present) return h
  if (change.key && h.lastKey === change.key && now - h.lastAt < COALESCE_MS && h.past.length > 0) {
    return { ...h, present: next, future: [], lastAt: now }
  }
  const past = [...h.past, { snapshot: h.present, label: change.label }]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { past, present: next, future: [], lastKey: change.key, lastAt: now }
}

export function canUndo<S>(h: HistoryState<S>): boolean { return h.past.length > 0 }
export function canRedo<S>(h: HistoryState<S>): boolean { return h.future.length > 0 }
export function undoLabel<S>(h: HistoryState<S>): string | null { return h.past[h.past.length - 1]?.label ?? null }
export function redoLabel<S>(h: HistoryState<S>): string | null { return h.future[h.future.length - 1]?.label ?? null }

export function undo<S>(h: HistoryState<S>): HistoryState<S> {
  const entry = h.past[h.past.length - 1]
  if (!entry) return h
  return {
    past: h.past.slice(0, -1),
    present: entry.snapshot,
    future: [...h.future, { snapshot: h.present, label: entry.label }],
    lastKey: undefined,
    lastAt: 0,
  }
}

export function redo<S>(h: HistoryState<S>): HistoryState<S> {
  const entry = h.future[h.future.length - 1]
  if (!entry) return h
  return {
    past: [...h.past, { snapshot: h.present, label: entry.label }],
    present: entry.snapshot,
    future: h.future.slice(0, -1),
    lastKey: undefined,
    lastAt: 0,
  }
}

/** Same designer state (by reference, field by field). */
export function sameSnapshot(a: DesignerSnapshot, b: DesignerSnapshot): boolean {
  return a.nodes === b.nodes && a.edges === b.edges && a.userVariables === b.userVariables && a.swimlanes === b.swimlanes
}

// ─── Describing a change ───

const quote = (s: string | undefined) => `'${(s ?? '').trim() || 'Untitled'}'`
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

function stepName(n: WorkflowNode): string {
  return n.type === 'section_group' ? `section ${quote(n.label)}` : `step ${quote(n.label)}`
}

/** Keys of `a` and `b` whose values differ by reference. */
function changedKeys(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): string[] {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])
  return [...keys].filter((k) => a?.[k] !== b?.[k]).sort()
}

const humanField = (k: string) => k.replace(/^_+/, '').replace(/_/g, ' ')

function describeNodeChange(prev: WorkflowNode, next: WorkflowNode): ChangeDescription {
  const fields = changedKeys(prev as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>)
  const name = stepName(next)
  if (fields.length === 1 && fields[0] === 'position') return { label: `move ${name}` }
  if (fields.length === 2 && fields.includes('position') && fields.includes('sectionId')) return { label: `move ${name}` }
  if (fields.length === 1 && fields[0] === 'label') return { label: `rename ${stepName(prev)}`, key: `label:${next.id}` }
  if (fields.length === 1 && fields[0] === 'collapsed') return { label: `${next.collapsed ? 'collapse' : 'expand'} ${name}` }
  if (fields.length === 1 && fields[0] === 'config') {
    const cfg = changedKeys(prev.config, next.config)
    if (next.type === 'section_group' && cfg.every((k) => k === 'width' || k === 'height')) return { label: `resize ${name}`, key: `resize:${next.id}` }
    const what = cfg.length === 1 ? humanField(cfg[0]) : 'settings'
    return { label: `edit ${what} of ${name}`, key: `config:${next.id}:${cfg.join(',')}` }
  }
  return { label: `edit ${name}`, key: `node:${next.id}:${fields.join(',')}` }
}

function edgeName(e: WorkflowEdge, nodes: Map<string, WorkflowNode>): string {
  return `${quote(nodes.get(e.source)?.label)} → ${quote(nodes.get(e.target)?.label)}`
}

/** A short human label for the change from `prev` to `next`, plus a coalescing key. */
export function describeChange(prev: DesignerSnapshot, next: DesignerSnapshot): ChangeDescription {
  const parts: ChangeDescription[] = []

  if (prev.nodes !== next.nodes) {
    const before = new Map(prev.nodes.map((n) => [n.id, n]))
    const after = new Map(next.nodes.map((n) => [n.id, n]))
    const added = next.nodes.filter((n) => !before.has(n.id))
    const removed = prev.nodes.filter((n) => !after.has(n.id))
    const changed = next.nodes.filter((n) => before.has(n.id) && before.get(n.id) !== n)
    if (added.length) parts.push({ label: added.length === 1 ? `add ${stepName(added[0])}` : `add ${plural(added.length, 'step')}` })
    if (removed.length) parts.push({ label: removed.length === 1 ? `delete ${stepName(removed[0])}` : `delete ${plural(removed.length, 'step')}` })
    if (changed.length === 1) parts.push(describeNodeChange(before.get(changed[0].id)!, changed[0]))
    else if (changed.length > 1) {
      const allMoves = changed.every((n) => changedKeys(before.get(n.id) as unknown as Record<string, unknown>, n as unknown as Record<string, unknown>).every((k) => k === 'position' || k === 'sectionId'))
      parts.push({ label: allMoves ? `move ${plural(changed.length, 'step')}` : `edit ${plural(changed.length, 'step')}` })
    }
    if (!added.length && !removed.length && !changed.length && prev.nodes.length === next.nodes.length) parts.push({ label: 'reorder steps' })
  }

  if (prev.edges !== next.edges) {
    const names = new Map(next.nodes.map((n) => [n.id, n]))
    for (const n of prev.nodes) if (!names.has(n.id)) names.set(n.id, n)
    const before = new Map(prev.edges.map((e) => [e.id, e]))
    const after = new Map(next.edges.map((e) => [e.id, e]))
    const added = next.edges.filter((e) => !before.has(e.id))
    const removed = prev.edges.filter((e) => !after.has(e.id))
    const changed = next.edges.filter((e) => before.has(e.id) && before.get(e.id) !== e)
    const nodeOp = parts.length > 0 // edges removed/added alongside a node change belong to it
    if (!nodeOp) {
      if (added.length === 1 && !removed.length) parts.push({ label: `connect ${edgeName(added[0], names)}` })
      else if (removed.length === 1 && !added.length) parts.push({ label: `remove connection ${edgeName(removed[0], names)}` })
      else if (changed.length === 1 && !added.length && !removed.length) parts.push({ label: `relabel connection ${edgeName(changed[0], names)}`, key: `edge:${changed[0].id}` })
      else if (added.length || removed.length || changed.length) parts.push({ label: 'edit connections' })
    }
  }

  if (prev.userVariables !== next.userVariables) parts.push({ label: 'edit variables', key: 'variables' })
  if (prev.swimlanes !== next.swimlanes) parts.push({ label: 'edit swimlanes', key: 'swimlanes' })

  if (parts.length === 0) return { label: 'change' }
  if (parts.length === 1) return parts[0]
  // Node + its edges (delete step, paste) reads as the node change.
  if (prev.nodes !== next.nodes && parts.every((p) => !p.key)) return { label: parts[0].label }
  return { label: 'edit workflow' }
}

// ─── Keyboard ───

export type HistoryShortcut = 'undo' | 'redo' | null

interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/**
 * True when the event target edits text itself (native undo applies there):
 * inputs, textareas, selects, contenteditable regions and code editors.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { type?: string }) | null
  if (!el || typeof el !== 'object' || !('tagName' in el)) return false
  const tag = String(el.tagName).toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = String(el.type ?? 'text').toLowerCase()
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type)
  }
  if (el.isContentEditable) return true
  const closest = (el as HTMLElement).closest?.bind(el)
  return !!closest?.('[contenteditable=""], [contenteditable="true"], [role="textbox"], .cm-editor, .monaco-editor, .ProseMirror')
}

/** Map a keydown to undo / redo: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y. Ignored while typing. */
export function historyShortcut(e: KeyLike): HistoryShortcut {
  if (e.altKey) return null
  if (!(e.metaKey || e.ctrlKey)) return null
  if (isEditableTarget(e.target)) return null
  const key = e.key.toLowerCase()
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && !e.shiftKey) return 'redo'
  return null
}

/** Shortcut hints for tooltips. */
export function shortcutHints(isMac: boolean): { undo: string; redo: string } {
  return isMac ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Y' }
}
