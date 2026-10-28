import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  cachedTableNameOf, dataTableIdOf, dataTableLabel, DATA_TABLE_NODE_TYPES, normalizeDataTableConfig, normalizeDataTableNodes,
  resolvePickerSelection,
} from '@/lib/workflow-table-refs'
import { getNodeConfigSummary } from '@/lib/workflow-utils'
import { NODE_CATALOG } from '@/lib/workflow-schema'

const ID = 'da131643-ff7c-47d4-8bc3-95089c585bf6'
const names = { [ID]: 'Vendors' }
const tables = [{ id: ID, name: 'Vendors' }, { id: 'other', name: 'Orders' }]

const VARIANTS: Record<string, Record<string, unknown>> = {
  table_id: { table_id: ID },
  tableId: { tableId: ID },
  data_table_id: { data_table_id: ID },
  dataTableId: { dataTableId: ID },
  custom_table_id: { custom_table_id: ID },
  nested: { table: { id: ID, name: 'Vendors' } },
}

describe('data table id / name keys', () => {
  it.each(Object.entries(VARIANTS))('reads the id stored as %s', (_k, config) => {
    expect(dataTableIdOf(config)).toBe(ID)
  })

  it('prefers table_id and trims', () => {
    expect(dataTableIdOf({ table_id: ` ${ID} `, tableId: 'x' })).toBe(ID)
    expect(dataTableIdOf({})).toBe('')
    expect(dataTableIdOf(null)).toBe('')
    expect(cachedTableNameOf({ tableName: 'Old' })).toBe('Old')
  })

  it('every node type that binds a table exists in the catalog', () => {
    for (const t of DATA_TABLE_NODE_TYPES) expect(NODE_CATALOG.some((n) => n.type === t)).toBe(true)
  })
})

describe('summary line shows the table name', () => {
  it.each(Object.entries(VARIANTS))('update_data_table (%s) → name from the lookup', (_k, config) => {
    expect(getNodeConfigSummary({ type: 'update_data_table', config: { ...config, operation: 'list' } }, { tableNames: names })).toBe('list → Vendors')
  })

  it('the live name wins over a stale cached table_name (renamed table)', () => {
    expect(getNodeConfigSummary({ type: 'update_data_table', config: { table_id: ID, table_name: 'Suppliers', operation: 'insert' } }, { tableNames: names }))
      .toBe('insert → Vendors')
  })

  it('deleted table → "Unknown table" + short id, never the raw GUID', () => {
    const s = getNodeConfigSummary({ type: 'update_data_table', config: { table_id: '0b7e1f6a-1111-4222-8333-944455556666', operation: 'delete' } }, { tableNames: names })
    expect(s).toBe('delete → Unknown table (0b7e1f6a)')
    expect(s).not.toContain('0b7e1f6a-1111')
  })

  it('deleted table with a cached name keeps the cached name', () => {
    expect(dataTableLabel({ table_id: 'gone', table_name: 'Archive' }, names)).toBe('Archive')
  })

  it('not loaded yet → cached name, else a neutral short label', () => {
    expect(dataTableLabel({ table_id: ID, table_name: 'Vendors' })).toBe('Vendors')
    expect(dataTableLabel({ table_id: ID })).toBe('Data table (da131643)')
  })

  it('an expression shows as written', () => {
    expect(dataTableLabel({ table_id: '{{summary_table_id}}' }, names)).toBe('{{summary_table_id}}')
  })

  it('data_table_event trigger and server_event outbound show names too', () => {
    expect(getNodeConfigSummary({ type: 'data_table_event', config: { tableId: ID, event_types: ['created', 'updated'] } }, { tableNames: names }))
      .toBe('Vendors · created, updated')
    expect(getNodeConfigSummary({ type: 'server_event', config: { event_name: 'vendor.sync', outbound_action: 'data_table', table_id: ID } }, { tableNames: names }))
      .toBe('vendor.sync → Vendors')
    expect(getNodeConfigSummary({ type: 'data_table_event', config: {} })).toBeNull()
  })
})

describe('properties panel shows the bound table', () => {
  it.each(Object.entries(VARIANTS))('stored as %s → picker selects Vendors', (_k, config) => {
    const normalized = normalizeDataTableConfig({ type: 'update_data_table', config: config as Record<string, unknown> })
    const sel = resolvePickerSelection(tables, dataTableIdOf(normalized.config), { fallbackName: dataTableLabel(normalized.config) ?? undefined })
    expect(sel).toMatchObject({ id: ID, name: 'Vendors', missing: false })
  })

  it('while the list loads, shows the cached name rather than an empty picker', () => {
    expect(resolvePickerSelection([], ID, { loading: true, fallbackName: 'Vendors' })).toMatchObject({ name: 'Vendors', missing: false })
    expect(resolvePickerSelection([], ID, { loading: true })).toMatchObject({ name: 'Loading…' })
  })

  it('a deleted table shows as missing, not empty', () => {
    const sel = resolvePickerSelection(tables, 'gone-1234', { fallbackName: dataTableLabel({ table_id: 'gone-1234' }, names) ?? undefined })
    expect(sel).toMatchObject({ name: 'Unknown table (gone1234)', missing: true })
    expect(resolvePickerSelection(tables, '')).toBeNull()
  })
})

describe('legacy configs migrate on read', () => {
  it('moves legacy keys to table_id / table_name', () => {
    const n = normalizeDataTableConfig({ type: 'update_data_table', config: { tableId: ID, tableName: 'Vendors', operation: 'insert' } })
    expect(n.config).toEqual({ table_id: ID, table_name: 'Vendors', operation: 'insert' })
  })

  it('leaves canonical configs (and the array) untouched so workflows stay clean', () => {
    const node = { type: 'update_data_table', config: { table_id: ID } }
    expect(normalizeDataTableConfig(node)).toBe(node)
    const list = [node, { type: 'log', config: { message: 'x' } }]
    expect(normalizeDataTableNodes(list)).toBe(list)
    expect(normalizeDataTableNodes([{ type: 'x', config: { data_table_id: ID } }])[0].config).toEqual({ table_id: ID })
  })

  it('designer, viewers and the engine read through the helpers', () => {
    const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
    expect(read('components/automations/workflow-builder.tsx')).toContain('normalizeDataTableNodes(initialNodes)')
    expect(read('components/automations/process-viewer.tsx')).toContain('normalizeDataTableNodes(')
    expect(read('lib/workflow-engine.ts')).toMatch(/case "update_data_table": \{[\s\S]{0,120}dataTableIdOf\(config\)/)
    expect(read('components/automations/workflow-node-card.tsx')).toContain('getNodeConfigSummary(node, lookups)')
  })
})
