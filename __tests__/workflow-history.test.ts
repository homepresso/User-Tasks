import { describe, it, expect } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '@/lib/workflow-schema'
import {
  commit, createHistory, describeChange, undo, redo, canUndo, canRedo, undoLabel, redoLabel, sameSnapshot,
  historyShortcut, isEditableTarget, shortcutHints, HISTORY_LIMIT, COALESCE_MS, type DesignerSnapshot,
} from '@/lib/workflow-history'

const node = (id: string, label = id, extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id, type: 'log', label, config: { message: 'hi' }, position: { x: 0, y: 0 }, ...extra })
const edge = (id: string, source: string, target: string, label?: string): WorkflowEdge => ({ id, source, target, label })

function snap(nodes: WorkflowNode[], edges: WorkflowEdge[] = [], userVariables: unknown[] = [], swimlanes: unknown[] = []): DesignerSnapshot {
  return { nodes, edges, userVariables, swimlanes }
}

const a = node('a', 'Manager approval')
const b = node('b', 'Notify')
const base = snap([a, b], [edge('e1', 'a', 'b')])

const withNode = (s: DesignerSnapshot, id: string, patch: Partial<WorkflowNode>) =>
  ({ ...s, nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })

describe('describeChange', () => {
  it('names every kind of designer change', () => {
    expect(describeChange(base, { ...base, nodes: [...base.nodes, node('c', 'Log it')] }).label).toBe("add step 'Log it'")
    expect(describeChange(base, { ...base, nodes: [...base.nodes, node('c'), node('d')] }).label).toBe('add 2 steps')
    expect(describeChange(base, { ...base, nodes: [b], edges: [] }).label).toBe("delete step 'Manager approval'")
    expect(describeChange(base, withNode(base, 'a', { position: { x: 40, y: 0 } })).label).toBe("move step 'Manager approval'")
    expect(describeChange(base, { ...base, nodes: base.nodes.map((n) => ({ ...n, position: { x: 9, y: 9 } })) }).label).toBe('move 2 steps')
    expect(describeChange(base, withNode(base, 'a', { label: 'CFO approval' }))).toEqual({ label: "rename step 'Manager approval'", key: 'label:a' })
    expect(describeChange(base, withNode(base, 'a', { config: { message: 'bye' } }))).toEqual({ label: "edit message of step 'Manager approval'", key: 'config:a:message' })
    expect(describeChange(base, withNode(base, 'a', { collapsed: true })).label).toBe("collapse step 'Manager approval'")
    expect(describeChange(base, { ...base, edges: [...base.edges, edge('e2', 'b', 'a')] }).label).toBe("connect 'Notify' → 'Manager approval'")
    expect(describeChange(base, { ...base, edges: [] }).label).toBe("remove connection 'Manager approval' → 'Notify'")
    expect(describeChange(base, { ...base, edges: [edge('e1', 'a', 'b', 'Yes')] })).toEqual({ label: "relabel connection 'Manager approval' → 'Notify'", key: 'edge:e1' })
    expect(describeChange(base, { ...base, userVariables: [{ name: 'x' }] })).toEqual({ label: 'edit variables', key: 'variables' })
    expect(describeChange(base, { ...base, swimlanes: [{ id: 'l' }] })).toEqual({ label: 'edit swimlanes', key: 'swimlanes' })
  })

  it('names section changes and coalesces section resizes', () => {
    const s = node('s', 'Prep', { type: 'section_group', config: { width: 300, height: 200 } })
    const sb = snap([s])
    expect(describeChange(sb, withNode(sb, 's', { config: { width: 320, height: 200 } }))).toEqual({ label: "resize section 'Prep'", key: 'resize:s' })
    expect(describeChange(sb, withNode(sb, 's', { position: { x: 1, y: 1 } })).label).toBe("move section 'Prep'")
  })

  it('treats a paste (nodes + their edges) as one node change', () => {
    const next = { ...base, nodes: [...base.nodes, node('c'), node('d')], edges: [...base.edges, edge('e9', 'c', 'd')] }
    expect(describeChange(base, next).label).toBe('add 2 steps')
  })
})

describe('history', () => {
  it('undoes and redoes, restoring exactly the previous references', () => {
    let h = createHistory(base)
    const moved = withNode(base, 'a', { position: { x: 40, y: 0 } })
    h = commit(h, moved, describeChange(base, moved), 1000)
    expect(canUndo(h)).toBe(true)
    expect(undoLabel(h)).toBe("move step 'Manager approval'")
    h = undo(h)
    expect(h.present).toBe(base)
    expect(canRedo(h)).toBe(true)
    expect(redoLabel(h)).toBe("move step 'Manager approval'")
    h = redo(h)
    expect(h.present).toBe(moved)
    expect(undo(createHistory(base))).toEqual(createHistory(base))
  })

  it('shares unchanged objects between snapshots (no deep clone)', () => {
    const moved = withNode(base, 'a', { position: { x: 40, y: 0 } })
    const h = commit(createHistory(base), moved, { label: 'move' }, 1)
    expect(h.past[0].snapshot.nodes[1]).toBe(h.present.nodes[1])
    expect(h.past[0].snapshot.edges).toBe(h.present.edges)
  })

  it('coalesces rapid edits of the same field into one entry', () => {
    let h = createHistory(base)
    let cur = base
    for (const [i, msg] of ['h', 'he', 'hel', 'hell', 'hello'].entries()) {
      const next = withNode(cur, 'a', { config: { message: msg } })
      h = commit(h, next, describeChange(cur, next), 1000 + i * 200)
      cur = next
    }
    expect(h.past).toHaveLength(1)
    expect(h.present.nodes[0].config.message).toBe('hello')
    expect(undo(h).present).toBe(base)
  })

  it('starts a new entry after the idle window or for a different field', () => {
    let h = createHistory(base)
    const s1 = withNode(base, 'a', { config: { message: 'x' } })
    h = commit(h, s1, describeChange(base, s1), 1000)
    const s2 = withNode(s1, 'a', { config: { message: 'xy' } })
    h = commit(h, s2, describeChange(s1, s2), 1000 + COALESCE_MS + 1)
    expect(h.past).toHaveLength(2)
    const s3 = withNode(s2, 'a', { label: 'Renamed' })
    h = commit(h, s3, describeChange(s2, s3), 1000 + COALESCE_MS + 2)
    expect(h.past).toHaveLength(3)
  })

  it('never coalesces across an undo', () => {
    let h = createHistory(base)
    const s1 = withNode(base, 'a', { config: { message: 'x' } })
    h = commit(h, s1, describeChange(base, s1), 1000)
    h = undo(h)
    const s2 = withNode(base, 'a', { config: { message: 'y' } })
    h = commit(h, s2, describeChange(base, s2), 1001)
    expect(h.past).toHaveLength(1)
    expect(h.past[0].snapshot).toBe(base)
  })

  it('clears redo on a new change', () => {
    let h = createHistory(base)
    const s1 = withNode(base, 'a', { position: { x: 1, y: 0 } })
    h = undo(commit(h, s1, { label: 'move' }, 1))
    expect(canRedo(h)).toBe(true)
    const s2 = withNode(base, 'b', { position: { x: 2, y: 0 } })
    h = commit(h, s2, { label: 'move b' }, 2)
    expect(canRedo(h)).toBe(false)
  })

  it(`caps the history at ${HISTORY_LIMIT} entries`, () => {
    let h = createHistory(base)
    let cur = base
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) {
      const next = withNode(cur, 'a', { position: { x: i + 1, y: 0 } })
      h = commit(h, next, { label: `move ${i}` }, i * 1000)
      cur = next
    }
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0].label).toBe('move 25')
  })

  it('records one entry for a multi-frame operation labelled explicitly (tidy)', () => {
    let h = createHistory(base)
    const tidied = { ...base, nodes: base.nodes.map((n, i) => ({ ...n, position: { x: 100, y: 100 + i * 200 } })) }
    h = commit(h, tidied, { label: 'tidy layout' }, 5)
    expect(h.past).toHaveLength(1)
    expect(undoLabel(h)).toBe('tidy layout')
    expect(undo(h).present).toBe(base)
  })

  it('compares snapshots by reference', () => {
    expect(sameSnapshot(base, { ...base })).toBe(true)
    expect(sameSnapshot(base, { ...base, nodes: [...base.nodes] })).toBe(false)
  })
})

describe('keyboard shortcuts', () => {
  const div = { tagName: 'DIV', isContentEditable: false, closest: () => null }
  const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: unknown = div) =>
    ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: target as EventTarget, ...mods })

  it('maps Cmd/Ctrl+Z to undo and Cmd/Ctrl+Shift+Z / Ctrl+Y to redo', () => {
    expect(historyShortcut(key('z', { metaKey: true }))).toBe('undo')
    expect(historyShortcut(key('z', { ctrlKey: true }))).toBe('undo')
    expect(historyShortcut(key('Z', { metaKey: true, shiftKey: true }))).toBe('redo')
    expect(historyShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe('redo')
    expect(historyShortcut(key('y', { ctrlKey: true }))).toBe('redo')
    expect(historyShortcut(key('z'))).toBe(null)
    expect(historyShortcut(key('z', { ctrlKey: true, altKey: true }))).toBe(null)
    expect(historyShortcut(key('c', { ctrlKey: true }))).toBe(null)
  })

  it('leaves Ctrl+Z to the browser while typing in inputs, textareas, selects, contenteditable and code editors', () => {
    const targets = [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'number' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'SPAN', isContentEditable: false, closest: (sel: string) => (sel.includes('.cm-editor') ? {} : null) },
    ]
    for (const t of targets) {
      expect(isEditableTarget(t as unknown as EventTarget)).toBe(true)
      expect(historyShortcut(key('z', { ctrlKey: true }, t))).toBe(null)
    }
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON', closest: () => null } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })

  it('shows platform shortcut hints', () => {
    expect(shortcutHints(true)).toEqual({ undo: '⌘Z', redo: '⇧⌘Z' })
    expect(shortcutHints(false)).toEqual({ undo: 'Ctrl+Z', redo: 'Ctrl+Y' })
  })
})
