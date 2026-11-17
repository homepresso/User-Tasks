/**
 * "Edit all rows" session model (lib/grid/edit-all.ts): dirty tracking,
 * revert, undo, new rows, the batch it sends, folding a batch's outcome
 * (partial failures, conflicts, locked rows), fill down and the keys.
 */
import { describe, expect, it } from 'vitest'
import {
  addRows, applyBatchResult, applyChanges, buildBatch, canUndo, cellValue, changedRowCount, diffCells, editAllKeyAction, errorCount,
  hasChanges, isCellChanged, planFillDown, rangeOf, registerRows, removeAddedRow, resolveConflict, revertCell, revertRow, setCellError,
  startEditAll, undo, EDIT_ALL_LIMITS,
} from '@/lib/grid/edit-all'

const V1 = '2026-11-10T10:00:00.000Z'
const V2 = '2026-11-12T09:30:00.000Z'

function session() {
  return startEditAll([
    { key: 'r1', values: { vendor: 'Acme Supplies', amount: 1250, paid: false }, version: V1 },
    { key: 'r2', values: { vendor: 'Apex Office', amount: 480.5, paid: true }, version: V1 },
    { key: 'r3', values: { vendor: 'Blue Harbor', amount: null, paid: false }, version: V1 },
  ])
}

describe('dirty tracking', () => {
  it('keeps only cells that differ from the row as loaded and counts changed rows', () => {
    let s = session()
    expect(hasChanges(s)).toBe(false)
    s = applyChanges(s, [{ row: 'r1', col: 'amount', value: 1300 }, { row: 'r2', col: 'vendor', value: 'Apex Office Co' }])
    expect(changedRowCount(s)).toBe(2)
    expect(isCellChanged(s, 'r1', 'amount')).toBe(true)
    expect(isCellChanged(s, 'r1', 'vendor')).toBe(false)
    expect(cellValue(s, 'r1', 'amount')).toBe(1300)
    // Typed back to the loaded value: no longer changed.
    s = applyChanges(s, [{ row: 'r1', col: 'amount', value: 1250 }])
    expect(isCellChanged(s, 'r1', 'amount')).toBe(false)
    expect(changedRowCount(s)).toBe(1)
  })

  it('treats numbers by value and blanks as equal (no phantom changes)', () => {
    let s = session()
    s = applyChanges(s, [{ row: 'r1', col: 'amount', value: '1250' }, { row: 'r3', col: 'amount', value: '' }])
    expect(hasChanges(s)).toBe(false)
  })

  it('a value that is already the cell\'s is no undo step', () => {
    const s = session()
    const same = applyChanges(s, [{ row: 'r1', col: 'vendor', value: 'Acme Supplies' }])
    expect(same).toBe(s)
    expect(canUndo(same)).toBe(false)
  })

  it('ignores rows the session never saw', () => {
    const s = applyChanges(session(), [{ row: 'ghost', col: 'vendor', value: 'x' }])
    expect(hasChanges(s)).toBe(false)
  })
})

describe('revert and undo', () => {
  it('Esc reverts one cell; a row reverts as a whole', () => {
    let s = applyChanges(session(), [{ row: 'r1', col: 'amount', value: 99 }, { row: 'r1', col: 'vendor', value: 'X' }])
    s = revertCell(s, 'r1', 'amount')
    expect(cellValue(s, 'r1', 'amount')).toBe(1250)
    expect(isCellChanged(s, 'r1', 'vendor')).toBe(true)
    s = revertRow(s, 'r1')
    expect(hasChanges(s)).toBe(false)
  })

  it('reverting an unchanged cell only clears its error', () => {
    let s = setCellError(session(), 'r2', 'amount', 'Amount must be a number')
    expect(errorCount(s)).toBe(1)
    s = revertCell(s, 'r2', 'amount')
    expect(errorCount(s)).toBe(0)
  })

  it('undoes step by step (a paste is one step) and reports the cells that moved', () => {
    let s = session()
    s = applyChanges(s, [{ row: 'r1', col: 'amount', value: 10 }])
    s = applyChanges(s, [{ row: 'r2', col: 'amount', value: 20 }, { row: 'r3', col: 'amount', value: 30 }])
    let u = undo(s)
    expect(u.changed).toEqual(expect.arrayContaining([{ row: 'r2', col: 'amount', value: 480.5 }, { row: 'r3', col: 'amount', value: null }]))
    expect(cellValue(u.state, 'r1', 'amount')).toBe(10)
    u = undo(u.state)
    expect(hasChanges(u.state)).toBe(false)
    expect(canUndo(u.state)).toBe(false)
    expect(undo(u.state).state).toBe(u.state)
  })

  it('keeps at most the undo limit', () => {
    let s = session()
    for (let i = 0; i < EDIT_ALL_LIMITS.undo + 20; i++) s = applyChanges(s, [{ row: 'r1', col: 'amount', value: i + 1 }])
    expect(s.undo.length).toBe(EDIT_ALL_LIMITS.undo)
  })

  it('edits clear the edited cells\' errors', () => {
    let s = setCellError(session(), 'r1', 'amount', 'bad')
    s = applyChanges(s, [{ row: 'r1', col: 'amount', value: 5 }])
    expect(s.errors).toEqual({})
  })
})

describe('new rows', () => {
  it('adds rows at the bottom; blank ones are neither counted nor sent; removing one is undoable', () => {
    let s = addRows(session(), { paid: false }, 2)
    expect(s.added.map((r) => r.id)).toEqual(['new:1', 'new:2'])
    expect(changedRowCount(s)).toBe(0)
    s = applyChanges(s, [{ row: 'new:1', col: 'vendor', value: 'Cobalt Freight' }, { row: 'new:1', col: 'amount', value: 75 }])
    expect(changedRowCount(s)).toBe(1)
    expect(buildBatch(s).inserts).toEqual([{ client_id: 'new:1', cells: { paid: false, vendor: 'Cobalt Freight', amount: 75 } }])
    const removed = removeAddedRow(s, 'new:1')
    expect(removed.added.map((r) => r.id)).toEqual(['new:2'])
    expect(undo(removed).state.added).toHaveLength(2)
  })

  it('caps the rows one session may add', () => {
    const s = addRows(session(), {}, EDIT_ALL_LIMITS.addedRows + 50)
    expect(s.added).toHaveLength(EDIT_ALL_LIMITS.addedRows)
    expect(addRows(s, {}, 1)).toBe(s)
  })
})

describe('rows seen later (paging, refresh)', () => {
  it('joins new rows; a clean row takes newer server values; an edited row keeps the version it was edited against', () => {
    let s = applyChanges(session(), [{ row: 'r1', col: 'amount', value: 1 }])
    const same = registerRows(s, [{ key: 'r2', values: { vendor: 'Apex Office', amount: 480.5, paid: true }, version: V1 }])
    expect(same).toBe(s)
    s = registerRows(s, [
      { key: 'r1', values: { vendor: 'Acme', amount: 2000 }, version: V2 },
      { key: 'r2', values: { vendor: 'Apex Office', amount: 500, paid: true }, version: V2 },
      { key: 'r4', values: { vendor: 'Delta Paper', amount: 12 }, version: V1 },
    ])
    expect(s.versions.r1).toBe(V1)
    expect(cellValue(s, 'r1', 'amount')).toBe(1)
    expect(cellValue(s, 'r2', 'amount')).toBe(500)
    expect(cellValue(s, 'r4', 'vendor')).toBe('Delta Paper')
  })
})

describe('batch save', () => {
  it('sends the changed cells of each row with the version it was edited against', () => {
    const s = applyChanges(session(), [{ row: 'r1', col: 'amount', value: 1300 }, { row: 'r3', col: 'paid', value: true }])
    expect(buildBatch(s)).toEqual({
      rows: [{ row_id: 'r1', cells: { amount: 1300 }, expected_updated_at: V1 }, { row_id: 'r3', cells: { paid: true }, expected_updated_at: V1 }],
      inserts: [],
    })
  })

  it('folds partial failures: saved rows are settled (never re-sent), refused cells keep drafts with errors, conflicts keep drafts', () => {
    let s = applyChanges(session(), [
      { row: 'r1', col: 'amount', value: 1300 },
      { row: 'r2', col: 'vendor', value: '' },
      { row: 'r3', col: 'amount', value: 64 },
    ])
    s = addRows(s, {}, 1)
    s = applyChanges(s, [{ row: 'new:1', col: 'vendor', value: 'Cobalt Freight' }])
    const out = applyBatchResult(s, {
      rows: [
        { row_id: 'r1', status: 'saved', row: { data: { vendor: 'Acme Supplies', amount: 1300, paid: false }, updated_at: V2 } },
        { row_id: 'r2', status: 'invalid', error: 'Vendor is required', cells: { vendor: 'Vendor is required' } },
        { row_id: 'r3', status: 'conflict', error: 'Ana Admin changed this row after you opened it.', current: { data: { vendor: 'Blue Harbor', amount: 70, paid: true }, updated_at: V2 } },
      ],
      inserts: [{ client_id: 'new:1', status: 'saved', row: { id: 'r9', data: { vendor: 'Cobalt Freight' }, updated_at: V2 } }],
    })
    expect(out.saved).toBe(2)
    expect(out.failed).toBe(1)
    expect(out.conflicts).toBe(1)
    expect(out.inserted.map((i) => i.row.id)).toEqual(['r9'])
    const next = out.state
    expect(next.drafts.r1).toBeUndefined()
    expect(next.versions.r1).toBe(V2)
    expect(cellValue(next, 'r1', 'amount')).toBe(1300)
    expect(next.errors.r2).toEqual({ vendor: 'Vendor is required' })
    expect(next.drafts.r2).toEqual({ vendor: '' })
    expect(next.conflicts.r3.theirs.amount).toBe(70)
    expect(next.added).toHaveLength(0)
    // The retry sends only what is left.
    expect(buildBatch(next).rows.map((r) => r.row_id)).toEqual(['r2', 'r3'])
  })

  it('puts a row-level error on the row\'s first changed cell; a forbidden row becomes read-only', () => {
    let s = applyChanges(session(), [{ row: 'r1', col: 'amount', value: 5 }, { row: 'r2', col: 'amount', value: 6 }])
    s = applyBatchResult(s, {
      rows: [
        { row_id: 'r1', status: 'error', error: 'The row could not be saved — try again.' },
        { row_id: 'r2', status: 'forbidden', error: 'You can\'t change this row' },
      ],
      inserts: [],
    }).state
    expect(s.errors.r1).toEqual({ amount: 'The row could not be saved — try again.' })
    expect(s.locked.r2).toBe('You can\'t change this row')
    expect(s.drafts.r2).toBeUndefined()
    // A locked row takes no more edits.
    expect(applyChanges(s, [{ row: 'r2', col: 'vendor', value: 'x' }]).drafts.r2).toBeUndefined()
  })
})

describe('conflicts', () => {
  function conflicted() {
    const s = applyChanges(session(), [{ row: 'r3', col: 'amount', value: 64 }, { row: 'r3', col: 'paid', value: true }])
    return applyBatchResult(s, { rows: [{ row_id: 'r3', status: 'conflict', error: 'changed', current: { data: { vendor: 'Blue Harbor Ltd', amount: 70, paid: true }, updated_at: V2 } }], inserts: [] }).state
  }

  it('take theirs: their row becomes the base and our drafts go', () => {
    const s = resolveConflict(conflicted(), 'r3', 'theirs')
    expect(s.conflicts.r3).toBeUndefined()
    expect(s.drafts.r3).toBeUndefined()
    expect(cellValue(s, 'r3', 'vendor')).toBe('Blue Harbor Ltd')
    expect(s.versions.r3).toBe(V2)
  })

  it('keep mine: drafts stay against their version (equal ones drop) so the next save overwrites', () => {
    const s = resolveConflict(conflicted(), 'r3', 'mine')
    expect(s.drafts.r3).toEqual({ amount: 64 })
    expect(buildBatch(s).rows).toEqual([{ row_id: 'r3', cells: { amount: 64 }, expected_updated_at: V2 }])
  })
})

describe('diffCells', () => {
  it('lists the cells whose value differs, new rows included', () => {
    const a = addRows(session(), {}, 1)
    const b = applyChanges(a, [{ row: 'r1', col: 'vendor', value: 'Z' }, { row: 'new:1', col: 'amount', value: 3 }])
    expect(diffCells(a, b)).toEqual([{ row: 'r1', col: 'vendor', value: 'Z' }, { row: 'new:1', col: 'amount', value: 3 }])
  })
})

describe('fill down', () => {
  const rows = ['r1', 'r2', 'r3']
  const cols = ['vendor', 'amount', 'locked']
  const s = session()
  const value = (row: string, col: string) => cellValue(s, row, col)
  const canEdit = (_row: string, col: string) => col !== 'locked'

  it('a range copies its top row down, read-only targets skipped', () => {
    const plan = planFillDown({ range: rangeOf({ r: 0, c: 1 }, { r: 2, c: 2 }), rowKeys: rows, colKeys: cols, value, canEdit })
    expect(plan.changes).toEqual([{ row: 'r2', col: 'amount', value: 1250 }, { row: 'r3', col: 'amount', value: 1250 }])
    expect(plan.skipped).toBe(2)
  })

  it('one cell copies the cell above; the first row has nothing above', () => {
    expect(planFillDown({ range: rangeOf({ r: 2, c: 0 }, { r: 2, c: 0 }), rowKeys: rows, colKeys: cols, value, canEdit }).changes).toEqual([{ row: 'r3', col: 'vendor', value: 'Apex Office' }])
    expect(planFillDown({ range: rangeOf({ r: 0, c: 0 }, { r: 0, c: 0 }), rowKeys: rows, colKeys: cols, value, canEdit }).changes).toEqual([])
  })
})

describe('keys on a focused cell', () => {
  const text = { editable: true }
  const ro = { editable: false }
  const bool = { editable: true, boolean: true }
  it('moves with arrows (Shift extends), Tab / Shift+Tab, Home / End', () => {
    expect(editAllKeyAction({ key: 'ArrowDown' }, text)).toEqual({ type: 'move', dr: 1, dc: 0, extend: false })
    expect(editAllKeyAction({ key: 'ArrowLeft', shiftKey: true }, ro)).toEqual({ type: 'move', dr: 0, dc: -1, extend: true })
    expect(editAllKeyAction({ key: 'Tab', shiftKey: true }, text)).toEqual({ type: 'tab', back: true })
    expect(editAllKeyAction({ key: 'End', ctrlKey: true }, text)).toEqual({ type: 'edge', to: 'last' })
  })
  it('edits on Enter / F2 / typing (with the character); Enter moves down on a read-only or yes / no cell', () => {
    expect(editAllKeyAction({ key: 'Enter' }, text)).toEqual({ type: 'edit' })
    expect(editAllKeyAction({ key: 'Enter' }, ro)).toEqual({ type: 'move', dr: 1, dc: 0, extend: false })
    expect(editAllKeyAction({ key: 'Enter' }, bool)).toEqual({ type: 'move', dr: 1, dc: 0, extend: false })
    expect(editAllKeyAction({ key: '7' }, text)).toEqual({ type: 'edit', initial: '7' })
    expect(editAllKeyAction({ key: '7' }, ro)).toBeNull()
  })
  it('Esc reverts, Delete clears, Space toggles, Ctrl/Cmd+Z undo, +D fill down, +S save', () => {
    expect(editAllKeyAction({ key: 'Escape' }, text)).toEqual({ type: 'revert' })
    expect(editAllKeyAction({ key: 'Escape' }, ro)).toBeNull()
    expect(editAllKeyAction({ key: 'Delete' }, text)).toEqual({ type: 'clear' })
    expect(editAllKeyAction({ key: ' ' }, bool)).toEqual({ type: 'toggle' })
    expect(editAllKeyAction({ key: 'z', metaKey: true }, text)).toEqual({ type: 'undo' })
    expect(editAllKeyAction({ key: 'd', ctrlKey: true }, ro)).toEqual({ type: 'fill-down' })
    expect(editAllKeyAction({ key: 's', metaKey: true }, ro)).toEqual({ type: 'save' })
    expect(editAllKeyAction({ key: 'a', isComposing: true }, text)).toBeNull()
  })
})
