import { describe, expect, it } from 'vitest'
import {
  buildDataTableTriggerPayload,
  buildRowContextVariables,
  normalizeTableColumns,
} from '@/lib/data-table-workflow-triggers'

const TABLE = {
  id: 'tbl_travel',
  name: 'Travel Requests',
  slug: 'travel_requests',
  columns: [
    { key: 'requester_name', label: 'Requester Name', type: 'text' },
    { key: 'destination', label: 'Destination', type: 'text' },
    { key: 'cost_usd', label: 'Cost (USD)', type: 'number' },
  ],
}

const ROW = {
  requester_name: 'Andy',
  destination: 'Wellington',
  cost_usd: 1200,
}

describe('buildRowContextVariables', () => {
  it('exposes row_id under all conventional aliases', () => {
    const { vars } = buildRowContextVariables({ table: TABLE, rowId: 'row_42', rowData: ROW })
    expect(vars.row_id).toBe('row_42')
    expect(vars.table_row_id).toBe('row_42')
    expect(vars.data_row_id).toBe('row_42')
  })

  it('exposes the row payload as both row and data_row', () => {
    const { vars } = buildRowContextVariables({ table: TABLE, rowId: 'row_42', rowData: ROW })
    expect(vars.row).toEqual(ROW)
    expect(vars.data_row).toEqual(ROW)
  })

  it('exposes table metadata for downstream nodes', () => {
    const { vars } = buildRowContextVariables({ table: TABLE, rowId: 'row_42', rowData: ROW })
    expect(vars.data_table_id).toBe('tbl_travel')
    expect(vars.data_table_name).toBe('Travel Requests')
    expect(vars.data_table_slug).toBe('travel_requests')
    expect(vars.data_table_columns).toHaveLength(3)
  })

  it('exposes each column under its key, slugified key, and slugified label', () => {
    const { vars } = buildRowContextVariables({ table: TABLE, rowId: 'row_42', rowData: ROW })
    // direct key
    expect(vars.requester_name).toBe('Andy')
    // slugified label "Cost (USD)" → "cost_usd" — collides with the key, same value
    expect(vars.cost_usd).toBe(1200)
  })

  it('handles missing slug as null', () => {
    const { vars } = buildRowContextVariables({
      table: { id: 't', name: 'T', columns: [] },
      rowId: 'r',
      rowData: {},
    })
    expect(vars.data_table_slug).toBe(null)
  })

  it('falls back to raw rowData keys when columns are not declared', () => {
    const { vars } = buildRowContextVariables({
      table: { id: 't', name: 'T', columns: [] },
      rowId: 'r',
      rowData: { foo_bar: 1, 'Weird Key': 'x' },
    })
    expect(vars.foo_bar).toBe(1)
    expect(vars['Weird Key']).toBe('x')
    expect(vars.weird_key).toBe('x')
  })
})

describe('buildDataTableTriggerPayload', () => {
  it('adds data_event/data_event_type alongside the row context', () => {
    const { payload } = buildDataTableTriggerPayload({
      eventType: 'created',
      table: TABLE,
      rowId: 'row_42',
      rowData: ROW,
    })
    expect(payload.data_event).toBe('created')
    expect(payload.data_event_type).toBe('created')
    expect(payload.row_id).toBe('row_42')
    expect(payload.data_table_id).toBe('tbl_travel')
  })

  it('returns the same row context shape for created/updated/deleted', () => {
    const types = ['created', 'updated', 'deleted'] as const
    for (const t of types) {
      const { payload } = buildDataTableTriggerPayload({
        eventType: t,
        table: TABLE,
        rowId: 'row_42',
        rowData: ROW,
      })
      expect(payload.data_event).toBe(t)
      expect(payload.row_id).toBe('row_42')
    }
  })
})

describe('normalizeTableColumns', () => {
  it('accepts an array of column objects', () => {
    const cols = normalizeTableColumns([{ key: 'a', label: 'A', type: 'text' }])
    expect(cols).toEqual([{ key: 'a', label: 'A', type: 'text' }])
  })

  it('accepts a record map', () => {
    const cols = normalizeTableColumns({ a: { label: 'A', type: 'number' } })
    expect(cols).toEqual([{ key: 'a', label: 'A', type: 'number' }])
  })

  it('returns [] for nullish or invalid input', () => {
    expect(normalizeTableColumns(null)).toEqual([])
    expect(normalizeTableColumns(undefined)).toEqual([])
    expect(normalizeTableColumns(42)).toEqual([])
  })
})
