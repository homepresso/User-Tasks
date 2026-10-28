'use client'

import { useMemo, useState } from 'react'
import { updateTableColumns } from '@/app/actions/data-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { Plus, X, Save, ChevronDown, ChevronRight, Columns3, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { DataColumn, LookupFilter, LookupFilterOperator } from './lookup-config'

interface TableDesignerProps {
  tableId: string
  columns: DataColumn[]
}

export function TableDesigner({ tableId, columns: initialColumns }: TableDesignerProps) {
  const [columns, setColumns] = useState<DataColumn[]>(initialColumns)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState(true)
  const router = useRouter()

  const { data: tables = [] } = useQuery({
    queryKey: ['custom-tables-for-lookups'],
    queryFn: async () => (await serverRead('data.lookupTables')).data ?? [],
  })

  function addColumn() {
    setColumns([...columns, {
      id: crypto.randomUUID(),
      name: '',
      type: 'text',
    }])
  }

  function removeColumn(id: string) {
    setColumns(columns.filter(c => c.id !== id))
  }

  function updateColumn(id: string, field: keyof DataColumn, value: DataColumn[keyof DataColumn]) {
    setColumns(columns.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  function updateLookup(id: string, updates: Partial<DataColumn['lookup']>) {
    setColumns(columns.map((column) => {
      if (column.id !== id) return column
      return {
        ...column,
        lookup: {
          ...(column.lookup ?? {}),
          ...updates,
        },
      }
    }))
  }

  function updateLookupFilter(id: string, filterId: string, updates: Partial<LookupFilter>) {
    setColumns(columns.map((column) => {
      if (column.id !== id) return column
      const filters = (column.lookup?.filters ?? []).map((filter) =>
        filter.id === filterId ? { ...filter, ...updates } : filter
      )
      return {
        ...column,
        lookup: {
          ...(column.lookup ?? {}),
          filters,
        },
      }
    }))
  }

  function addLookupFilter(id: string) {
    setColumns(columns.map((column) => {
      if (column.id !== id) return column
      return {
        ...column,
        lookup: {
          ...(column.lookup ?? {}),
          filters: [
            ...(column.lookup?.filters ?? []),
            {
              id: crypto.randomUUID(),
              column: '',
              operator: 'equals',
              value: '',
            },
          ],
        },
      }
    }))
  }

  function removeLookupFilter(id: string, filterId: string) {
    setColumns(columns.map((column) => {
      if (column.id !== id) return column
      return {
        ...column,
        lookup: {
          ...(column.lookup ?? {}),
          filters: (column.lookup?.filters ?? []).filter((filter) => filter.id !== filterId),
        },
      }
    }))
  }

  async function handleSave() {
    setSaving(true)
    await updateTableColumns(tableId, columns)
    setSaving(false)
    setCollapsed(true)
    router.refresh()
  }

  const requiredCount = columns.filter(col => col.required).length
  // Key must be STABLE while typing — including the name remounted the row on
  // every keystroke, dropping input focus after one character.
  const getColumnKey = (col: DataColumn, index: number) => col.id || `col:${index}`

  return (
    <div className="rounded-lg border p-4" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setCollapsed(prev => !prev)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--theme-primary-light)' }}
          >
            <Columns3 size={16} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Columns</h3>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
              >
                {columns.length} total
              </span>
              {requiredCount > 0 && (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                >
                  {requiredCount} required
                </span>
              )}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Define the schema for this table. Expand to add, rename, or remove fields.
            </p>
            {columns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {columns.slice(0, collapsed ? 6 : 10).map((col, index) => (
                  <span
                    key={getColumnKey(col, index)}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]"
                    style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
                  >
                    <span>{col.name || 'Untitled'}</span>
                    <span style={{ color: 'var(--theme-primary-text)' }}>{col.type}</span>
                    {col.required && <CheckCircle2 size={10} />}
                  </span>
                ))}
                {collapsed && columns.length > 6 && (
                  <span
                    className="inline-flex items-center rounded-full px-2 py-1 text-[10px]"
                    style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
                  >
                    +{columns.length - 6} more
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="pt-1" style={{ color: 'var(--theme-muted-text)' }}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setCollapsed(false); addColumn() }}>
            <Plus size={14} className="mr-1" /> Add Column
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || collapsed}>
            <Save size={14} className="mr-1" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="mt-4">
          {columns.length === 0 ? (
            <p className="text-sm py-2" style={{ color: 'var(--theme-muted-text)' }}>No columns. Add one to define your table schema.</p>
          ) : (
            <div className="space-y-2">
              {columns.map((col, index) => (
                <div
                  key={getColumnKey(col, index)}
                  className="rounded-lg border p-3"
                  style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={col.name}
                      onChange={(e) => updateColumn(col.id, 'name', e.target.value)}
                      placeholder="Column name"
                      className="min-w-[220px] flex-1"
                    />
                    <select
                      value={col.type}
                      onChange={(e) => updateColumn(col.id, 'type', e.target.value as DataColumn['type'])}
                      className="rounded-lg border px-2 py-2 text-sm"
                      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                    >
                      <option value="text">Text</option>
                      <option value="longtext">Long Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="boolean">Boolean</option>
                      <option value="select">Select</option>
                      <option value="lookup">Lookup</option>
                      <option value="file">File</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={col.required ?? false}
                        onChange={(e) => updateColumn(col.id, 'required', e.target.checked)}
                      />
                      Required
                    </label>
                    <button onClick={() => removeColumn(col.id)} className="p-1 hover:text-red-500" style={{ color: 'var(--theme-muted-text)' }}>
                      <X size={14} />
                    </button>
                  </div>

                  {col.type === 'lookup' && (
                    <LookupColumnEditor
                      tableId={tableId}
                      column={col}
                      tables={tables}
                      onUpdateLookup={(updates) => updateLookup(col.id, updates)}
                      onUpdateLookupFilter={(filterId, updates) => updateLookupFilter(col.id, filterId, updates)}
                      onAddLookupFilter={() => addLookupFilter(col.id)}
                      onRemoveLookupFilter={(filterId) => removeLookupFilter(col.id, filterId)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LookupColumnEditor({
  tableId,
  column,
  tables,
  onUpdateLookup,
  onUpdateLookupFilter,
  onAddLookupFilter,
  onRemoveLookupFilter,
}: {
  tableId: string
  column: DataColumn
  tables: { id: string; name: string; columns: { id: string; name: string; type: string }[] }[]
  onUpdateLookup: (updates: Partial<DataColumn['lookup']>) => void
  onUpdateLookupFilter: (filterId: string, updates: Partial<LookupFilter>) => void
  onAddLookupFilter: () => void
  onRemoveLookupFilter: (filterId: string) => void
}) {
  const sourceTables = useMemo(() => tables.filter((table) => table.id !== tableId), [tableId, tables])
  const sourceTable = sourceTables.find((table) => table.id === column.lookup?.sourceTableId)
  const sourceColumns = (sourceTable?.columns ?? []).filter((sourceColumn) => sourceColumn.name !== 'ID' && sourceColumn.name !== 'Date Created')
  const filters = column.lookup?.filters ?? []
  const filterOperators: LookupFilterOperator[] = ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'is_empty', 'not_empty']

  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
          Lookup Source
        </p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          Pull values from another table and optionally filter, dedupe, and sort them.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium">Source table</label>
          <select
            value={column.lookup?.sourceTableId ?? ''}
            onChange={(e) => {
              const nextTable = sourceTables.find((table) => table.id === e.target.value)
              const nextColumns = nextTable?.columns ?? []
              onUpdateLookup({
                sourceTableId: e.target.value,
                sourceTableName: nextTable?.name ?? '',
                sourceColumn: nextColumns.find((candidate) => candidate.name !== 'ID' && candidate.name !== 'Date Created')?.name ?? '',
                sortBy: nextColumns.find((candidate) => candidate.name !== 'ID' && candidate.name !== 'Date Created')?.name ?? '',
              })
            }}
            className="w-full rounded-lg border px-2 py-2 text-sm"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
          >
            <option value="">Choose a table…</option>
            {sourceTables.map((table) => (
              <option key={table.id} value={table.id}>{table.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium">Lookup column</label>
          <select
            value={column.lookup?.sourceColumn ?? ''}
            onChange={(e) => onUpdateLookup({ sourceColumn: e.target.value })}
            className="w-full rounded-lg border px-2 py-2 text-sm"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
            disabled={!sourceTable}
          >
            <option value="">Choose a column…</option>
            {sourceColumns.map((sourceColumn) => (
              <option key={sourceColumn.id} value={sourceColumn.name}>{sourceColumn.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="flex items-center gap-2 text-[11px] font-medium">
          <input
            type="checkbox"
            checked={column.lookup?.distinct ?? false}
            onChange={(e) => onUpdateLookup({ distinct: e.target.checked })}
          />
          Distinct results only
        </label>

        <div>
          <label className="mb-1 block text-[11px] font-medium">Sort by</label>
          <select
            value={column.lookup?.sortBy ?? column.lookup?.sourceColumn ?? ''}
            onChange={(e) => onUpdateLookup({ sortBy: e.target.value })}
            className="w-full rounded-lg border px-2 py-2 text-sm"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
            disabled={!sourceTable}
          >
            <option value="">Lookup column</option>
            {sourceColumns.map((sourceColumn) => (
              <option key={sourceColumn.id} value={sourceColumn.name}>{sourceColumn.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium">Sort direction</label>
          <select
            value={column.lookup?.sortDir ?? 'asc'}
            onChange={(e) => onUpdateLookup({ sortDir: e.target.value as 'asc' | 'desc' })}
            className="w-full rounded-lg border px-2 py-2 text-sm"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium">Filters</label>
          <Button size="sm" variant="outline" className="!h-7 !text-[11px]" onClick={onAddLookupFilter}>
            <Plus size={12} className="mr-1" /> Add Filter
          </Button>
        </div>
        {filters.length === 0 ? (
          <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            No filters configured. All matching rows from the source table will be available.
          </p>
        ) : (
          filters.map((filter) => (
            <div key={filter.id} className="grid gap-2 md:grid-cols-[1.3fr_1fr_1.2fr_auto]">
              <select
                value={filter.column}
                onChange={(e) => onUpdateLookupFilter(filter.id, { column: e.target.value })}
                className="rounded-lg border px-2 py-2 text-sm"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                disabled={!sourceTable}
              >
                <option value="">Column…</option>
                {sourceColumns.map((sourceColumn) => (
                  <option key={sourceColumn.id} value={sourceColumn.name}>{sourceColumn.name}</option>
                ))}
              </select>
              <select
                value={filter.operator}
                onChange={(e) => onUpdateLookupFilter(filter.id, { operator: e.target.value as LookupFilterOperator })}
                className="rounded-lg border px-2 py-2 text-sm"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
              >
                {filterOperators.map((operator) => (
                  <option key={operator} value={operator}>{operator.replaceAll('_', ' ')}</option>
                ))}
              </select>
              <Input
                value={filter.value ?? ''}
                onChange={(e) => onUpdateLookupFilter(filter.id, { value: e.target.value })}
                placeholder={filter.operator === 'is_empty' || filter.operator === 'not_empty' ? 'No value needed' : 'Value'}
                disabled={filter.operator === 'is_empty' || filter.operator === 'not_empty'}
              />
              <Button size="sm" variant="ghost" className="!h-9 !px-2" onClick={() => onRemoveLookupFilter(filter.id)}>
                <X size={12} />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
