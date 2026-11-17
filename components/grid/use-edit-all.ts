'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  addRows, applyChanges, cellValue, diffCells, editAllKeyAction, planFillDown, rangeOf, revertCell, setCellError, setCellErrors,
  startEditAll, undo as undoStep, type CellChange, type CellPos, type CellRange, type EditAllRow, type EditAllState,
} from '@/lib/grid/edit-all'
import { localeDateOrder, parseClipboardTable, planPaste, toClipboardTable, type PasteColumn, type PastePerson } from '@/lib/grid/paste'

/**
 * The "Edit all rows" session of a grid (lib/grid/edit-all.ts) — shared by
 * the Data grid and the form Data table control, which draw the cells. It
 * owns the session, the focused cell and the selected range, the open cell
 * editor, and what keys, paste (a block from Excel / Google Sheets), copy,
 * fill down and undo do. Every change goes through `update`, so a form can
 * fold the moved cells into its value (`onChanged`).
 */
export interface UseEditAllOptions {
  /** The page's existing rows in display order (the session's new rows are drawn after them). */
  rowKeys: string[]
  /** Data columns in display order. */
  colKeys: string[]
  canEdit: (row: string, col: string) => boolean
  isBoolean: (col: string) => boolean
  /** The column as the paste sees it (control, choices, bound). */
  pasteColumn: (col: string) => PasteColumn
  /** The column's own coercion (coerceGridValue / coerceCell). */
  coerce: (col: string, raw: unknown) => { value: unknown } | { error: string }
  /** Columns a bound column's change empties ({{row.<column>}} cascading). */
  dependents?: (col: string) => string[]
  /** New rows may be added (the view / control allows adding). */
  allowAdd: boolean
  blankRow: () => Record<string, unknown>
  people?: PastePerson[]
  locale?: string
  /** Move DOM focus to a cell (scrolling a windowed grid first). */
  focusDom: (r: number, c: number) => void
  /** Cells whose value moved (a form folds them into its change set). */
  onChanged?: (changes: CellChange[], next: EditAllState) => void
  onSave: () => void
  announce: (message: string) => void
  /** Copy text of a value (labels for people; stored values otherwise). */
  copyText?: (col: string, value: unknown) => string
}

export interface EditingCell { row: string; col: string; initial?: string }

export function useEditAll(opts: UseEditAllOptions) {
  const [session, setSessionState] = useState<EditAllState | null>(null)
  const ref = useRef<EditAllState | null>(null)
  const optsRef = useRef(opts)
  // The latest options for the handlers (they run after the commit).
  useLayoutEffect(() => { optsRef.current = opts })
  const [pos, setPos] = useState<CellPos>({ r: 0, c: 0 })
  const [anchor, setAnchor] = useState<CellPos | null>(null)
  const [editing, setEditing] = useState<EditingCell | null>(null)

  /** Every row in display order: the page's rows, then the session's new rows. */
  const keysOf = useCallback((): string[] => [...optsRef.current.rowKeys, ...(ref.current?.added.map((a) => a.id) ?? [])], [])
  const set = useCallback((next: EditAllState | null) => { ref.current = next; setSessionState(next) }, [])
  /** Replace the session; the cells that moved are reported (forms). */
  const update = useCallback((next: EditAllState) => {
    const prev = ref.current
    if (!prev || next === prev) return
    set(next)
    const moved = diffCells(prev, next)
    if (moved.length) optsRef.current.onChanged?.(moved, next)
  }, [set])

  const start = useCallback((rows: EditAllRow[]) => { set(startEditAll(rows)); setAnchor(null); setEditing(null) }, [set])
  const stop = useCallback(() => { set(null); setAnchor(null); setEditing(null) }, [set])

  const range: CellRange = rangeOf(anchor ?? pos, pos)
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2

  const focus = useCallback((r: number, c: number, extend = false) => {
    const o = optsRef.current
    const rr = Math.max(0, Math.min(keysOf().length - 1, r))
    const cc = Math.max(0, Math.min(o.colKeys.length - 1, c))
    if (extend) setAnchor((a) => a ?? pos)
    else setAnchor(null)
    setPos({ r: rr, c: cc })
    o.focusDom(rr, cc)
  }, [pos, keysOf])

  /** The next editable cell after / before (r, c), across rows (Tab / Shift+Tab). */
  const tabFrom = useCallback((r: number, c: number, back: boolean): CellPos => {
    const o = optsRef.current
    const cols = o.colKeys.length
    let i = r * cols + c
    const total = keysOf().length * cols
    for (let n = 0; n < total; n++) {
      i += back ? -1 : 1
      if (i < 0 || i >= total) break
      const rr = Math.floor(i / cols), cc = i % cols
      if (o.canEdit(keysOf()[rr], o.colKeys[cc])) return { r: rr, c: cc }
    }
    return { r, c }
  }, [keysOf])

  const apply = useCallback((changes: CellChange[]) => {
    const s = ref.current
    if (!s) return
    update(applyChanges(s, changes))
  }, [update])

  /** A cell editor's value: coerced by the column, cascading dependents emptied; an error stays on the cell. */
  const commit = useCallback((row: string, col: string, raw: unknown) => {
    const s = ref.current
    if (!s) return false
    const o = optsRef.current
    const coerced = o.coerce(col, raw)
    if ('error' in coerced) { set(setCellError(s, row, col, coerced.error)); o.announce(coerced.error); return false }
    const cleared = (o.dependents?.(col) ?? []).filter((k) => k !== col && o.canEdit(row, k) && !sameEmpty(cellValue(s, row, k))).map((k) => ({ row, col: k, value: null }))
    update(applyChanges(s, [{ row, col, value: coerced.value }, ...cleared]))
    return true
  }, [set, update])

  /** Close the editor of (row, col) — only if it is still the open one (a late blur must not close the next cell's editor). */
  const closeEditor = useCallback((row: string, col: string) => setEditing((cur) => (cur && cur.row === row && cur.col === col ? null : cur)), [])
  /** Focus (r, c) once the editor is gone — unless the person already moved focus elsewhere (clicked another cell). */
  const refocus = useCallback((r: number, c: number) => {
    requestAnimationFrame(() => {
      const a = typeof document !== 'undefined' ? document.activeElement : null
      if (!a || a === document.body) focus(r, c)
    })
  }, [focus])

  /** After an editor commits: where focus goes (Enter down, Tab sideways; a blur stays where the person clicked). */
  const afterEdit = useCallback((r: number, c: number, row: string, col: string, move?: 'next' | 'prev' | 'down') => {
    closeEditor(row, col)
    if (move === 'down') focus(r + 1, c)
    else if (move === 'next' || move === 'prev') { const t = tabFrom(r, c, move === 'prev'); focus(t.r, t.c) }
    else refocus(r, c)
  }, [closeEditor, focus, tabFrom, refocus])

  /** After an editor cancels (Esc, or a blur). */
  const afterCancel = useCallback((r: number, c: number, row: string, col: string) => { closeEditor(row, col); refocus(r, c) }, [closeEditor, refocus])

  const cellsIn = useCallback((rg: CellRange, editableOnly = true) => {
    const o = optsRef.current
    const out: Array<{ row: string; col: string }> = []
    for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
      const row = keysOf()[r], col = o.colKeys[c]
      if (row && col && (!editableOnly || o.canEdit(row, col))) out.push({ row, col })
    }
    return out
  }, [keysOf])

  const doUndo = useCallback(() => {
    const s = ref.current
    if (!s) return
    const { state, changed } = undoStep(s)
    if (state === s) { optsRef.current.announce('Nothing to undo'); return }
    set(state)
    if (changed.length) optsRef.current.onChanged?.(changed, state)
    optsRef.current.announce(changed.length ? `Undone: ${changed.length} cell${changed.length === 1 ? '' : 's'}` : 'Undone')
  }, [set])

  const fillDown = useCallback(() => {
    const s = ref.current
    if (!s) return
    const o = optsRef.current
    const plan = planFillDown({ range, rowKeys: keysOf(), colKeys: o.colKeys, value: (row, col) => cellValue(s, row, col), canEdit: o.canEdit })
    if (!plan.changes.length) { o.announce('Nothing to fill down'); return }
    update(applyChanges(s, plan.changes))
    o.announce(`Filled down ${plan.changes.length} cell${plan.changes.length === 1 ? '' : 's'}${plan.skipped ? `; ${plan.skipped} read-only skipped` : ''}`)
  }, [range, update, keysOf])

  /** Keys on a focused cell (no editor open). */
  const onCellKey = useCallback((e: React.KeyboardEvent, r: number, c: number) => {
    if (editing) return
    const s = ref.current
    const o = optsRef.current
    if (!s) return
    const row = keysOf()[r], col = o.colKeys[c]
    if (!row || !col) return
    const editable = o.canEdit(row, col)
    const action = editAllKeyAction({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing }, { editable, boolean: o.isBoolean(col) })
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    switch (action.type) {
      case 'move': focus(r + action.dr, c + action.dc, action.extend); break
      case 'tab': { const t = tabFrom(r, c, action.back); focus(t.r, t.c); break }
      case 'edge': {
        if (action.to === 'row-start') focus(r, 0)
        else if (action.to === 'row-end') focus(r, o.colKeys.length - 1)
        else if (action.to === 'first') focus(0, 0)
        else focus(keysOf().length - 1, o.colKeys.length - 1)
        break
      }
      case 'edit': setAnchor(null); setEditing({ row, col, ...(action.initial !== undefined ? { initial: action.initial } : {}) }); break
      case 'revert': {
        if (multi) { let next = s; for (const cell of cellsIn(range)) next = revertCell(next, cell.row, cell.col); update(next) } else update(revertCell(s, row, col))
        o.announce('Reverted')
        break
      }
      case 'clear': {
        const cells = multi ? cellsIn(range) : [{ row, col }]
        const changes = cells.flatMap(({ row: rw, col: cl }) => { const v = o.coerce(cl, null); return 'error' in v ? [{ row: rw, col: cl, value: o.isBoolean(cl) ? false : null }] : [{ row: rw, col: cl, value: v.value }] })
        apply(changes)
        break
      }
      case 'toggle': {
        const to = cellValue(s, row, col) !== true
        const cells = multi ? cellsIn(range).filter((x) => o.isBoolean(x.col)) : [{ row, col }]
        apply(cells.map((x) => ({ ...x, value: to })))
        break
      }
      case 'undo': doUndo(); break
      case 'fill-down': fillDown(); break
      case 'save': o.onSave(); break
    }
  }, [editing, focus, tabFrom, multi, cellsIn, range, update, apply, doUndo, fillDown, keysOf])

  /** Paste a block (Excel / Google Sheets / Numbers) from the focused cell; extra rows are added when allowed. */
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const s = ref.current
    if (!s || editing) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const o = optsRef.current
    const block = parseClipboardTable(text)
    if (!block.length) return
    const origin = multi && block.length === 1 && block[0].length === 1 ? { r: range.r1, c: range.c1 } : pos
    let next = s
    let keys = keysOf()
    const need = origin.r + block.length - keys.length
    let addedNote = ''
    if (need > 0 && o.allowAdd && !(block.length === 1 && block[0].length === 1)) {
      const before = next.added.length
      next = addRows(next, o.blankRow(), need)
      const ids = next.added.slice(before).map((a) => a.id)
      keys = [...keys, ...ids]
      if (ids.length) addedNote = `; ${ids.length} new row${ids.length === 1 ? '' : 's'} added`
    }
    const plan = planPaste({
      block, start: origin, range: multi ? range : null, rowKeys: keys, columns: o.colKeys.map(o.pasteColumn),
      // New rows are judged by their column alone (the surfaces' canEdit), so rows this paste just added count too.
      canEdit: (row, col) => o.canEdit(row, col),
      coerce: (col, raw) => o.coerce(col.key, raw), dateOrder: localeDateOrder(o.locale), people: o.people,
    })
    const withRows = next
    next = applyChanges(next, plan.changes)
    // The added rows and their values are one undo step.
    if (withRows !== s && next !== withRows) next = { ...next, undo: withRows.undo }
    next = setCellErrors(next, plan.errors)
    update(next)
    const parts = [`Pasted ${plan.changes.length} cell${plan.changes.length === 1 ? '' : 's'}${addedNote}`]
    if (plan.errors.length) parts.push(`${plan.errors.length} didn't fit (marked)`)
    if (plan.skipped) parts.push(`${plan.skipped} read-only skipped`)
    if (plan.outside) parts.push(`${plan.outside} outside the table`)
    o.announce(parts.join('; '))
  }, [editing, multi, range, pos, update, keysOf])

  /** Copy the selected cells as tab-separated text (pastes into a spreadsheet). */
  const onCopy = useCallback((e: React.ClipboardEvent) => {
    const s = ref.current
    if (!s || editing) return
    const o = optsRef.current
    const rows: unknown[][] = []
    for (let r = range.r1; r <= range.r2; r++) {
      const line: unknown[] = []
      for (let c = range.c1; c <= range.c2; c++) {
        const row = keysOf()[r], col = o.colKeys[c]
        const v = row && col ? cellValue(s, row, col) : null
        line.push(col && o.copyText ? o.copyText(col, v) : v)
      }
      rows.push(line)
    }
    e.preventDefault()
    e.clipboardData.setData('text/plain', toClipboardTable(rows))
    o.announce(`Copied ${(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} cells`)
  }, [editing, range, keysOf])

  const addRow = useCallback(() => {
    const s = ref.current
    if (!s) return
    const next = addRows(s, optsRef.current.blankRow(), 1)
    if (next === s) { optsRef.current.announce('No more new rows can be added in one go — save first'); return }
    const r = keysOf().length
    update(next)
    optsRef.current.announce('Row added at the bottom')
    // Focus its first editable cell once drawn.
    const c = Math.max(0, optsRef.current.colKeys.findIndex((col) => optsRef.current.canEdit(next.added[next.added.length - 1].id, col)))
    setPos({ r, c })
    requestAnimationFrame(() => optsRef.current.focusDom(r, c))
  }, [update, keysOf])

  return {
    session, set, update, start, keysOf, stop, pos, setPos, anchor, setAnchor, range, multi, editing, setEditing, focus,
    commit, afterEdit, afterCancel, onCellKey, onPaste, onCopy, undo: doUndo, fillDown, addRow, apply,
    /** The live session (for handlers that run before a re-render). */
    current: () => ref.current,
  }
}

function sameEmpty(v: unknown) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)
}
