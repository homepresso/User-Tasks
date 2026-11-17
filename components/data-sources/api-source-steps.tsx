'use client'

/**
 * The steps after "Pick the rows" in the API picker:
 *  - ColumnChecklist (a Data table's rows): the generated columns with tick
 *    boxes, type and an example; a drop zone for field badges; a live
 *    preview of the test's rows as the table will show them;
 *  - ValueLabelPicker (a dropdown / autocomplete column's options): what is
 *    stored and what people see, each a drop zone and a select;
 *  - RefreshOptions: when the rows load again, and API paging.
 */

import { useMemo } from 'react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import {
  DATA_TABLE_COLUMN_TYPE_LABELS, formatCell, type DataTableColumn, type DataTableFieldConfig,
} from '@/lib/forms/data-table'
import type { LookupConfig } from '@/lib/forms/lookup'
import { generateColumns, pagingSupport, rowFieldOrder, sampleRows, setPaging, type GeneratedColumn, type RefInputLike } from '@/lib/data-sources/api-rows'
import { FormattedCellView } from '@/components/forms/data-table-cell'
import { ResponseDropZone } from './data-chip'
import { Step, type ApiTestResult } from './api-source-picker'

/** The test's rows at the chosen path, and the columns generated from them. */
export function useGeneratedColumns(test: ApiTestResult | null, resultsPath: string | undefined): { rows: Array<Record<string, unknown>>; generated: GeneratedColumn[] } {
  return useMemo(() => {
    if (!test) return { rows: [], generated: [] }
    const rows = sampleRows(test.sample, resultsPath ?? '')
    return { rows, generated: generateColumns(rows, { order: rowFieldOrder(test.root, resultsPath ?? '') }) }
  }, [test, resultsPath])
}

function cellValue(row: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = row
  for (const p of path.split('.')) cursor = cursor !== null && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[p] : undefined
  return cursor
}

/** The first rows of a test as a table with these columns (WYSIWYG). */
export function SampleRowsTable({ rows, columns, max = 5, locale }: { rows: Array<Record<string, unknown>>; columns: DataTableColumn[]; max?: number; locale?: string }) {
  const shown = columns.filter((c) => !c.hidden)
  if (!shown.length || !rows.length) return null
  return (
    <div className="max-h-48 overflow-auto rounded border border-border" data-testid="api-sample-rows">
      <table className="w-full text-2xs">
        <thead><tr>{shown.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap px-1.5 py-1 text-left font-medium">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i} className="border-t border-border">
              {shown.map((c) => <td key={c.key} className="whitespace-nowrap px-1.5 py-1"><FormattedCellView cell={formatCell(c, cellValue(r, c.key), { locale })} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ColumnChecklist({ config, generated, rows, onToggle, onDropField, n = 5 }: {
  config: DataTableFieldConfig
  generated: GeneratedColumn[]
  rows: Array<Record<string, unknown>>
  onToggle: (key: string, show: boolean) => void
  onDropField: (rowPath: string) => void
  n?: number
}) {
  const shown = new Set(config.columns.filter((c) => !c.hidden).map((c) => c.key))
  return (
    <Step n={n} title="Columns to show" done={shown.size > 0} testId="columns">
      <ResponseDropZone testId="columns" label="Drop here to add this field as a column" accepts={(p) => p.kind !== 'rows' && p.kind !== 'sublist' && p.rowPath !== undefined}
        onDrop={(p) => p.rowPath && onDropField(p.rowPath)}>
        {generated.length === 0
          ? <p className="p-1 text-2xs text-fg-muted">Test the API to see its fields.</p>
          : (
            <ul className="max-h-56 overflow-y-auto rounded border border-border" data-testid="api-column-checklist">
              {generated.map((g) => {
                const example = g.example === undefined ? '' : typeof g.example === 'string' ? g.example : JSON.stringify(g.example)
                return (
                  <li key={g.key} className="border-b border-border last:border-b-0">
                    <label className="flex min-w-0 items-center gap-1.5 px-1.5 py-1 text-2xs">
                      <input type="checkbox" className="accent-primary" checked={shown.has(g.key)} onChange={(e) => onToggle(g.key, e.target.checked)} data-api-column={g.key} />
                      <span className="min-w-0 flex-1 truncate">{config.columns.find((c) => c.key === g.key)?.label ?? g.label}
                        <span className="text-fg-muted"> · {g.format?.kind === 'currency' ? 'Money (USD)' : DATA_TABLE_COLUMN_TYPE_LABELS[g.type]}{example ? ` · ${example.length > 24 ? `${example.slice(0, 23)}…` : example}` : ''}</span>
                      </span>
                      {config.key_column === g.key && <span className="shrink-0 text-2xs text-fg-muted" title="Identifies a row">key</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
      </ResponseDropZone>
      <SampleRowsTable rows={rows} columns={config.columns} locale={config.locale} />
      {rows.length > 0 && <p className="text-2xs text-fg-muted">Sample rows from the last test. Rename, format or reorder columns under Column settings.</p>}
    </Step>
  )
}

export function ValueLabelPicker({ binding, generated, onChange, n = 5 }: {
  binding: LookupConfig
  generated: GeneratedColumn[]
  onChange: (next: LookupConfig) => void
  n?: number
}) {
  const options = generated.map((g) => ({ value: g.key, label: g.label, hint: g.example === undefined ? undefined : String(g.example) }))
  const label = binding.display_fields?.[0]
  const accepts = (p: { rowPath?: string; kind: string }) => p.rowPath !== undefined && p.kind === 'field'
  return (
    <Step n={n} title="What people pick" done={!!binding.value_field && !!label} testId="value-label">
      <div className="grid grid-cols-2 gap-1.5">
        <ResponseDropZone testId="label" label="Drop: what people see" accepts={accepts} onDrop={(p) => p.rowPath && onChange({ ...binding, display_fields: [p.rowPath, ...(binding.display_fields ?? []).filter((f) => f !== p.rowPath)] })}>
          <p className="mb-0.5 text-2xs font-medium text-fg-muted">What people see</p>
          <AutocompleteSelect value={label ?? ''} placeholder="Choose a field…" options={options} onChange={(v) => onChange({ ...binding, display_fields: v ? [v, ...(binding.display_fields ?? []).filter((f) => f !== v)] : undefined })} />
        </ResponseDropZone>
        <ResponseDropZone testId="value" label="Drop: what is stored" accepts={accepts} onDrop={(p) => p.rowPath && onChange({ ...binding, value_field: p.rowPath })}>
          <p className="mb-0.5 text-2xs font-medium text-fg-muted">What is stored</p>
          <AutocompleteSelect value={binding.value_field ?? ''} placeholder="Choose a field…" options={options} onChange={(v) => onChange({ ...binding, value_field: v || undefined })} />
        </ResponseDropZone>
      </div>
      <p className="text-2xs text-fg-muted">Usually: people see a name, the form stores its id.</p>
    </Step>
  )
}

export function RefreshOptions({ config, inputs, onChange, n = 6 }: {
  config: DataTableFieldConfig
  /** The API's parameters (paging is offered when it has a page or offset one). */
  inputs?: RefInputLike[]
  onChange: (patch: Partial<DataTableFieldConfig>) => void
  n?: number
}) {
  const paging = inputs ? pagingSupport(inputs, config.input_mappings) : { possible: false, on: false }
  return (
    <Step n={n} title="When to load the rows" done testId="refresh">
      <p className="text-2xs text-fg-muted">Always when the form opens.</p>
      <label className="flex items-center gap-1.5 text-2xs">
        <input type="checkbox" className="accent-primary" checked={config.refresh_on_change !== false} onChange={(e) => onChange({ refresh_on_change: e.target.checked ? undefined : false })} data-testid="dt-refresh-on-change" />
        Again when a field it uses changes
      </label>
      <label className="flex items-center gap-1.5 text-2xs">
        <input type="checkbox" className="accent-primary" checked={config.refresh_button === true} onChange={(e) => onChange({ refresh_button: e.target.checked || undefined })} data-testid="dt-refresh-button" />
        Show a Refresh button
      </label>
      {paging.possible && inputs && (
        <label className="flex items-center gap-1.5 text-2xs">
          <input type="checkbox" className="accent-primary" checked={paging.on} onChange={(e) => onChange({ input_mappings: setPaging(inputs, config.input_mappings, e.target.checked) })} data-testid="dt-api-paging" />
          Let the API send one page at a time (it supports paging)
        </label>
      )}
    </Step>
  )
}
