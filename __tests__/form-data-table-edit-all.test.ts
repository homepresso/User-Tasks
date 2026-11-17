/**
 * The form Data table control's "Edit all rows" (components/forms/data-table-field.tsx):
 * a session's edits are folded into the control's value (the change set) as
 * a whole (lib/forms/data-table-edits.ts), exactly as single cell edits
 * would build it, so the "for each changed row" rule (lib/forms/table-changes.ts)
 * plans one operation per changed row with the new values; undo and
 * reverting take rows back out; read-only and key columns never enter it.
 */
import { describe, expect, it } from 'vitest'
import { emptyChangeSet, normalizeDataTableConfig, type DataTableChangeSet, type DataTableFieldConfig } from '@/lib/forms/data-table'
import { applyTableEdits, type TableEdit } from '@/lib/forms/data-table-edits'
import { applyChanges, diffCells, revertCell, startEditAll, undo, type CellChange, type EditAllState } from '@/lib/grid/edit-all'
import { planTableChanges, normalizeTableChanges } from '@/lib/forms/table-changes'
import { ROW_ID_KEY } from '@/lib/forms/row-markers'

const config: DataTableFieldConfig = normalizeDataTableConfig({
  source: 'table', table_id: 't-invoices', mode: 'edit', allow_add: true, open_in_edit_mode: true,
  columns: [
    { key: 'vendor', label: 'Vendor', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'paid', label: 'Paid', type: 'boolean' },
    { key: 'approved_by', label: 'Approved by', type: 'text', read_only: true },
  ],
})

const rows = [
  { key: 'r1', values: { vendor: 'Acme Supplies', amount: 1250, paid: false, approved_by: 'Ana Admin' } },
  { key: 'r2', values: { vendor: 'Apex Office', amount: 480.5, paid: true, approved_by: 'Ana Admin' } },
  { key: 'r3', values: { vendor: 'Blue Harbor', amount: 960, paid: false, approved_by: 'Ana Admin' } },
]

/** What the control does on each session change: the moved cells → one value update. */
function fold(value: DataTableChangeSet, moved: CellChange[]): DataTableChangeSet {
  const edits: TableEdit[] = moved.map((m) => m.row.startsWith('rid:')
    ? { kind: 'added', rid: m.row.slice(4), col: m.col, value: m.value }
    : { kind: 'row', key: m.row, before: rows.find((r) => r.key === m.row)!.values, col: m.col, value: m.value })
  return applyTableEdits(config, value, edits)
}
function step(s: EditAllState, value: DataTableChangeSet, changes: CellChange[]) {
  const next = applyChanges(s, changes)
  return { s: next, value: fold(value, diffCells(s, next)) }
}

describe('config', () => {
  it('keeps "Always open in edit mode" for editable tables only', () => {
    expect(config.open_in_edit_mode).toBe(true)
    expect(normalizeDataTableConfig({ source: 'table', table_id: 't', mode: 'display', open_in_edit_mode: true, columns: [] })).not.toHaveProperty('open_in_edit_mode')
  })
})

describe('a batch edit as the control\'s value', () => {
  it('a paste over many rows becomes one change set update with only the changed cells', () => {
    const s0 = startEditAll(rows.map((r) => ({ key: r.key, values: r.values })))
    const { s, value } = step(s0, emptyChangeSet(), [
      { row: 'r1', col: 'amount', value: 1300 }, { row: 'r1', col: 'paid', value: true },
      { row: 'r2', col: 'amount', value: 480.5 }, // unchanged: not in the value
      { row: 'r3', col: 'vendor', value: 'Blue Harbor Ltd' },
    ])
    expect(value.updated).toEqual([
      { key: 'r1', before: rows[0].values, after: { amount: 1300, paid: true }, changed_fields: ['amount', 'paid'] },
      { key: 'r3', before: rows[2].values, after: { vendor: 'Blue Harbor Ltd' }, changed_fields: ['vendor'] },
    ])
    expect(s.drafts.r2).toBeUndefined()
  })

  it('equals what the same edits one cell at a time produce', () => {
    const s0 = startEditAll(rows.map((r) => ({ key: r.key, values: r.values })))
    const batch = step(s0, emptyChangeSet(), [{ row: 'r1', col: 'amount', value: 1300 }, { row: 'r3', col: 'vendor', value: 'Blue Harbor Ltd' }, { row: 'r1', col: 'paid', value: true }]).value
    let single = emptyChangeSet()
    single = applyTableEdits(config, single, [{ kind: 'row', key: 'r1', before: rows[0].values, col: 'amount', value: 1300 }])
    single = applyTableEdits(config, single, [{ kind: 'row', key: 'r3', before: rows[2].values, col: 'vendor', value: 'Blue Harbor Ltd' }])
    single = applyTableEdits(config, single, [{ kind: 'row', key: 'r1', before: rows[0].values, col: 'paid', value: true }])
    expect(batch.updated.map((u) => [u.key, u.after]).sort()).toEqual(single.updated.map((u) => [u.key, u.after]).sort())
  })

  it('"for each changed row" plans exactly one operation per changed row, with the new values', () => {
    const s0 = startEditAll(rows.map((r) => ({ key: r.key, values: r.values })))
    const { value } = step(s0, emptyChangeSet(), [{ row: 'r1', col: 'amount', value: 1300 }, { row: 'r1', col: 'paid', value: true }, { row: 'r3', col: 'amount', value: 990 }])
    const rule = normalizeTableChanges({ field: 'invoices', target: 'table', table_id: 't-invoices', operation: 'auto', mapping: { amount: '{{row.amount}}', paid: '{{row.paid}}', vendor: '{{row.vendor}}' } })
    const plan = planTableChanges(rule, value, { values: {} })
    expect(plan.ops).toEqual([
      { kind: 'updated', key: 'r1', action: 'update', match: { column: 'row_id', value: 'r1' }, data: { amount: 1300, paid: true, vendor: 'Acme Supplies' } },
      { kind: 'updated', key: 'r3', action: 'update', match: { column: 'row_id', value: 'r3' }, data: { amount: 990, paid: false, vendor: 'Blue Harbor' } },
    ])
  })

  it('undo and Esc take rows back out of the value; a row typed back to its value leaves it', () => {
    let s = startEditAll(rows.map((r) => ({ key: r.key, values: r.values })))
    let value = emptyChangeSet()
    ;({ s, value } = step(s, value, [{ row: 'r1', col: 'amount', value: 1300 }]))
    ;({ s, value } = step(s, value, [{ row: 'r2', col: 'vendor', value: 'Apex' }, { row: 'r3', col: 'paid', value: true }]))
    expect(value.updated.map((u) => u.key)).toEqual(['r1', 'r2', 'r3'])
    const u = undo(s)
    value = fold(value, u.changed)
    s = u.state
    expect(value.updated.map((x) => x.key)).toEqual(['r1'])
    const reverted = revertCell(s, 'r1', 'amount')
    value = fold(value, diffCells(s, reverted))
    expect(value.updated).toEqual([])
  })

  it('a read-only column never enters the value (the server keeps it too)', () => {
    const value = applyTableEdits(config, emptyChangeSet(), [{ kind: 'row', key: 'r1', before: rows[0].values, col: 'approved_by', value: 'Mallory' }])
    expect(value.updated).toEqual([])
  })

  it('new rows at the bottom are filled by their row id', () => {
    const start: DataTableChangeSet = { added: [{ vendor: null, amount: null, paid: false, [ROW_ID_KEY]: 'abc' }], updated: [], deleted: [] }
    let s = startEditAll([...rows.map((r) => ({ key: r.key, values: r.values })), { key: 'rid:abc', values: start.added[0] }])
    let value = start
    ;({ s, value } = step(s, value, [{ row: 'rid:abc', col: 'vendor', value: 'Cobalt Freight' }, { row: 'rid:abc', col: 'amount', value: 75 }]))
    expect(value.added).toEqual([{ vendor: 'Cobalt Freight', amount: 75, paid: false, [ROW_ID_KEY]: 'abc' }])
    expect(s.drafts['rid:abc']).toEqual({ vendor: 'Cobalt Freight', amount: 75 })
  })
})
