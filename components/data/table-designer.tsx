'use client'

import { Fragment, useMemo, useState } from 'react'
import { updateTableColumns } from '@/app/actions/data-store'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, THead, TBody, TH, TD, TableEmpty, trClass } from '@/components/ui/table'
import { serverRead } from '@/lib/server-read'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Plus, X, Trash2, Columns3 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { DataColumn, LookupFilter, LookupFilterOperator } from './lookup-config'
import { COLUMN_TYPE_ICON } from './data-grid'

interface TableDesignerProps {
  tableId: string
  columns: DataColumn[]
}

const TYPE_OPTIONS: Array<{ value: DataColumn['type']; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'select', label: 'Select' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'file', label: 'File' },
]

/**
 * Schema editor: the table's columns as an editable Table (name, type,
 * required, remove). Lookup columns expand a source editor under their row.
 * Changes stay local until "Save changes".
 */
export function TableDesigner({ tableId, columns: initialColumns }: TableDesignerProps) {
  const [columns, setColumns] = useState<DataColumn[]>(initialColumns)
  const [saved, setSaved] = useState<DataColumn[]>(initialColumns)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const dirty = useMemo(() => JSON.stringify(columns) !== JSON.stringify(saved), [columns, saved])

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
    setError(null)
    try {
      await updateTableColumns(tableId, columns)
      setSaved(columns)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the schema')
    } finally {
      setSaving(false)
    }
  }

  const requiredCount = columns.filter(col => col.required).length
  // Key must be STABLE while typing — including the name remounted the row on
  // every keystroke, dropping input focus after one character.
  const getColumnKey = (col: DataColumn, index: number) => col.id || `col:${index}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="num text-xs text-fg-muted">
          {plural(columns.length, 'column')}{requiredCount > 0 && ` · ${requiredCount} required`}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-fg-muted">Unsaved changes</span>}
          {dirty && <Button variant="ghost" size="sm" onClick={() => setColumns(saved)} disabled={saving}>Discard</Button>}
          <Button variant="secondary" size="sm" leadingIcon={<Plus />} onClick={addColumn}>Add column</Button>
          <Button size="sm" onClick={handleSave} disabled={!dirty} loading={saving}>Save changes</Button>
        </div>
      </div>

      {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH className="w-48">Type</TH>
            <TH className="w-28">Required</TH>
            <TH className="w-px"><span className="sr-only">Remove</span></TH>
          </tr>
        </THead>
        <TBody>
          {columns.length === 0 && (
            <TableEmpty
              colSpan={4}
              icon={Columns3}
              title="No columns yet"
              description="Add a column to define what each row holds."
              action={{ label: 'Add column', onClick: addColumn }}
            />
          )}
          {columns.map((col, index) => {
            const Icon = COLUMN_TYPE_ICON[col.type] ?? Columns3
            return (
              <Fragment key={getColumnKey(col, index)}>
                <tr className={cn(trClass, col.type === 'lookup' && 'border-b-0')}>
                  <TD className="py-1">
                    <Input
                      size="sm"
                      value={col.name}
                      onChange={(e) => updateColumn(col.id, 'name', e.target.value)}
                      placeholder="Column name"
                      aria-label="Column name"
                      leading={<Icon />}
                    />
                  </TD>
                  <TD className="py-1">
                    <Select
                      size="sm"
                      value={col.type}
                      onChange={(e) => updateColumn(col.id, 'type', e.target.value as DataColumn['type'])}
                      aria-label={`Type of ${col.name || 'column'}`}
                      options={TYPE_OPTIONS}
                    />
                  </TD>
                  <TD>
                    <Checkbox
                      checked={col.required ?? false}
                      onChange={(e) => updateColumn(col.id, 'required', e.target.checked)}
                      label="Required"
                    />
                  </TD>
                  <TD className="w-px">
                    <IconButton size="sm" variant="danger-ghost" label={`Remove ${col.name || 'column'}`} icon={<Trash2 />} onClick={() => removeColumn(col.id)} />
                  </TD>
                </tr>
                {col.type === 'lookup' && (
                  <tr className="border-b border-border-subtle last:border-b-0">
                    <td colSpan={4} className="px-[var(--theme-density-cell-x)] pb-3">
                      <LookupColumnEditor
                        tableId={tableId}
                        column={col}
                        tables={tables}
                        onUpdateLookup={(updates) => updateLookup(col.id, updates)}
                        onUpdateLookupFilter={(filterId, updates) => updateLookupFilter(col.id, filterId, updates)}
                        onAddLookupFilter={() => addLookupFilter(col.id)}
                        onRemoveLookupFilter={(filterId) => removeLookupFilter(col.id, filterId)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </TBody>
      </Table>
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
  const columnOptions = sourceColumns.map((sourceColumn) => ({ value: sourceColumn.name, label: sourceColumn.name }))

  return (
    <Card variant="inset" padding="md" className="space-y-4">
      <div>
        <p className="text-ui font-medium text-fg">Lookup source</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Pull values from another table and optionally filter, dedupe and sort them.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Source table">
          <Select
            size="sm"
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
            placeholder="Choose a table…"
            options={sourceTables.map((table) => ({ value: table.id, label: table.name }))}
          />
        </Field>
        <Field label="Lookup column">
          <Select
            size="sm"
            value={column.lookup?.sourceColumn ?? ''}
            onChange={(e) => onUpdateLookup({ sourceColumn: e.target.value })}
            disabled={!sourceTable}
            placeholder="Choose a column…"
            options={columnOptions}
          />
        </Field>
      </div>

      <div className="grid items-end gap-3 md:grid-cols-3">
        <Checkbox
          checked={column.lookup?.distinct ?? false}
          onChange={(e) => onUpdateLookup({ distinct: e.target.checked })}
          label="Distinct results only"
          className="pb-1.5"
        />
        <Field label="Sort by">
          <Select
            size="sm"
            value={column.lookup?.sortBy ?? column.lookup?.sourceColumn ?? ''}
            onChange={(e) => onUpdateLookup({ sortBy: e.target.value })}
            disabled={!sourceTable}
            placeholder="Lookup column"
            options={columnOptions}
          />
        </Field>
        <Field label="Sort direction">
          <Select
            size="sm"
            value={column.lookup?.sortDir ?? 'asc'}
            onChange={(e) => onUpdateLookup({ sortDir: e.target.value as 'asc' | 'desc' })}
            options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]}
          />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-ui font-medium text-fg">Filters</p>
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={onAddLookupFilter}>
            Add filter
          </Button>
        </div>
        {filters.length === 0 ? (
          <p className="text-xs text-fg-muted">
            No filters. Every row of the source table is available.
          </p>
        ) : (
          filters.map((filter) => (
            <div key={filter.id} className="grid items-center gap-2 md:grid-cols-[1.3fr_1fr_1.2fr_auto]">
              <Select
                size="sm"
                value={filter.column}
                onChange={(e) => onUpdateLookupFilter(filter.id, { column: e.target.value })}
                disabled={!sourceTable}
                aria-label="Filter column"
                placeholder="Column…"
                options={columnOptions}
              />
              <Select
                size="sm"
                value={filter.operator}
                onChange={(e) => onUpdateLookupFilter(filter.id, { operator: e.target.value as LookupFilterOperator })}
                aria-label="Filter operator"
                options={filterOperators.map((operator) => ({ value: operator, label: operator.replaceAll('_', ' ') }))}
              />
              <Input
                size="sm"
                value={filter.value ?? ''}
                onChange={(e) => onUpdateLookupFilter(filter.id, { value: e.target.value })}
                placeholder={filter.operator === 'is_empty' || filter.operator === 'not_empty' ? 'No value needed' : 'Value'}
                disabled={filter.operator === 'is_empty' || filter.operator === 'not_empty'}
                aria-label="Filter value"
              />
              <IconButton size="sm" label="Remove filter" icon={<X />} onClick={() => onRemoveLookupFilter(filter.id)} />
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
