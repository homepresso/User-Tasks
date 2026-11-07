'use client'

import { customKindOf, isWriteReference, KIND_INFO, referencePickerHint } from '@/lib/custom-references/types'
import { mapRowColumnsToInputs } from '@/lib/custom-references/write'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { DesignerVariableScope } from './designer-variable-scope'
import { serverRead } from '@/lib/server-read'
import {
  TABLE_CHANGE_KINDS, TABLE_WRITE_OPERATIONS, TABLE_WRITE_OPERATION_LABELS, describePlannedOp, dryRunTableChanges, normalizeTableChanges,
  type TableChangeKind, type TableChangesConfig, type TableWriteOperation,
} from '@/lib/forms/table-changes'
import { DATA_TABLE_OPERATORS, DATA_TABLE_OPERATOR_LABELS, emptyChangeSet, isChangeSet, type DataTableOperator } from '@/lib/forms/data-table'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useDesignerPreviewValues } from './designer-preview-context'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables / references / workflows are read as the browser sees them */


function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-2xs text-fg-muted">{children}</p>
}

const KIND_LABELS: Record<TableChangeKind, string> = { added: 'Added rows', updated: 'Changed rows', deleted: 'Deleted rows' }

/** A map editor: target name → template (columns of a table, inputs of a reference / workflow). */
function TemplateMap({ label, names, value, onChange, placeholders, free, testId }: {
  label: string
  names: string[]
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  placeholders: Array<{ name: string; group: string; label?: string }>
  /** Allow names not in `names` (e.g. a workflow without declared inputs). */
  free?: boolean
  testId?: string
}) {
  const [extra, setExtra] = useState('')
  const shown = [...new Set([...names, ...Object.keys(value)])]
  return (
    <div className="space-y-1" data-testid={testId}>
      <Label>{label}</Label>
      {shown.map((name) => (
        <div key={name}>
          <p className="font-mono text-2xs">{name}</p>
          <VariableInput value={value[name] ?? ''} extraVariables={placeholders} placeholder="{{row.column}}, {{form.field}} or a fixed value"
            onChange={(v) => { const next = { ...value }; if (v) next[name] = v; else delete next[name]; onChange(next) }} />
        </div>
      ))}
      {free && (
        <div className="flex gap-1">
          <input aria-label="Input name" className={inputClass} value={extra} placeholder="Add an input name…" onChange={(e) => setExtra(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
          <button type="button" className="rounded border px-2 text-2xs border-border" disabled={!extra} onClick={() => { onChange({ ...value, [extra]: '{{row.' }); setExtra('') }}><Plus size={11} aria-label="Add" /></button>
        </div>
      )}
    </div>
  )
}

/**
 * The "For each changed row" rule editor: shared by a submitting button's
 * steps (Buttons & header) and an in-form Button's "Apply table changes".
 */
export function TableChangesEditor({ config: raw, fields, onChange, testId = 'table-changes-editor' }: {
  config: TableChangesConfig | undefined
  fields: TaskFieldDef[]
  onChange: (next: TableChangesConfig, tag?: string) => void
  testId?: string
}) {
  const config = normalizeTableChanges(raw ?? {})
  const set = (patch: Partial<TableChangesConfig>, tag?: string) => onChange({ ...config, ...patch }, tag)
  const tablesFields = fields.filter((f) => f.type === 'data_table' && f.data_table?.mode === 'edit')
  const source = tablesFields.find((f) => f.key === config.field)
  const columns = source?.data_table?.columns ?? []
  const previewValues = useDesignerPreviewValues()
  const [dryRun, setDryRun] = useState<ReturnType<typeof dryRunTableChanges> | null>(null)

  const { data: tables = [] } = useQuery({ queryKey: ['forms-table-columns'], enabled: config.target === 'table', staleTime: 60_000, queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [] })
  const { data: references = [] } = useQuery({ queryKey: ['forms-lookup-references'], enabled: config.target === 'reference', staleTime: 60_000, queryFn: async () => ((await serverRead('integrations.references')).data ?? []) as any[] })
  const { data: workflows = [] } = useQuery({ queryKey: ['form-button-workflows'], enabled: config.target === 'workflow', staleTime: 60_000, queryFn: async () => (await serverRead('automations.workflowOptions')).data ?? [] })

  const table = (tables as any[]).find((t) => t.id === config.table_id)
  const targetColumns: string[] = (table?.columns ?? []).map((c: any) => String(c.key)).filter((k: string) => k !== 'id' && k !== 'date_created')
  const reference = (references as any[]).find((r) => r.id === config.reference_id)
  const refInputs: string[] = Array.isArray(reference?.inputs) ? reference.inputs.map((i: any) => String(i?.name ?? '')).filter(Boolean) : []
  const workflow = (workflows as any[]).find((w) => w.id === config.workflow_id)
  const wfInputs: string[] = Array.isArray(workflow?.user_variables) ? workflow.user_variables.map((v: any) => String(v?.name ?? '')).filter(Boolean) : []

  const placeholders = [
    { name: 'key', group: 'Row', label: 'The row key' },
    { name: 'change', group: 'Row', label: 'added / updated / deleted' },
    { name: 'changed_fields', group: 'Row', label: 'Changed columns' },
    ...columns.flatMap((c) => [
      { name: `row.${c.key}`, group: 'Row', label: `${c.label} (after the change)` },
      { name: `before.${c.key}`, group: 'Row (before)', label: `${c.label} before` },
    ]),
    ...fields.filter((f) => f.type !== 'heading' && f.type !== 'divider' && f.type !== 'button').map((f) => ({ name: `form.${f.key}`, group: 'This form', label: f.label || f.key })),
    { name: 'user.id', group: 'Current user', label: 'User id' }, { name: 'user.email', group: 'Current user', label: 'Email' }, { name: 'user.name', group: 'Current user', label: 'Name' },
    { name: 'today', group: 'Dates', label: 'Today (YYYY-MM-DD)' }, { name: 'now', group: 'Dates', label: 'Now (ISO)' },
    ...(config.target === 'workflow' && config.per === 'once' ? [{ name: 'changes', group: 'Change set', label: 'All changes { added, updated, deleted }' }] : []),
  ]

  const kinds = config.kinds ?? TABLE_CHANGE_KINDS
  const ops = new Set(kinds.map((k) => (config.operation && config.operation !== 'auto' ? config.operation : k === 'added' ? 'insert' : k === 'updated' ? 'update' : 'delete')))

  function runDryRun() {
    const value = previewValues?.[config.field]
    const changes = isChangeSet(value) ? value : emptyChangeSet()
    setDryRun(dryRunTableChanges(config, changes, { values: previewValues ?? {} }, Object.fromEntries(columns.map((c) => [c.key, c.type]))))
  }

  return (
    <DesignerVariableScope state={{ fields, layout: null }} context={{ kind: 'table_changes' }}>
    <div className="min-w-0 max-w-full space-y-2" data-testid={testId}>
      <div>
        <Label>Loop over the changes of</Label>
        <AutocompleteSelect value={config.field} placeholder={tablesFields.length ? 'Choose an editable Data table…' : 'Add an editable Data table first'}
          options={tablesFields.map((f) => ({ value: f.key, label: f.label || f.key }))} onChange={(v) => set({ field: v || '' })} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="Which changes">
        {TABLE_CHANGE_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1 text-2xs">
            <input className="accent-primary" type="checkbox" checked={kinds.includes(k)}
              onChange={(e) => { const next = e.target.checked ? [...new Set([...kinds, k])] : kinds.filter((x) => x !== k); if (next.length) set({ kinds: next.length === 3 ? undefined : next }) }} />
            {KIND_LABELS[k]}
          </label>
        ))}
      </div>
      <div>
        <Label>Only rows where (optional)</Label>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <AutocompleteSelect value={config.where?.column ?? ''} placeholder="Every row" clearable options={columns.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(v) => set({ where: v ? { column: v, operator: config.where?.operator ?? 'eq', value: config.where?.value ?? '' } : undefined })} />
          <AutocompleteSelect value={config.where?.operator ?? 'eq'} disabled={!config.where} options={DATA_TABLE_OPERATORS.map((op) => ({ value: op, label: DATA_TABLE_OPERATOR_LABELS[op] }))}
            onChange={(v) => config.where && set({ where: { ...config.where, operator: (v || 'eq') as DataTableOperator } })} />
          <span />
        </div>
        {config.where && config.where.operator !== 'is_set' && config.where.operator !== 'is_not_set' && (
          <input aria-label="Row condition value" className={`${inputClass} mt-1`} value={config.where.value ?? ''} onChange={(e) => set({ where: { ...config.where!, value: e.target.value } }, 'tc-where')} />
        )}
      </div>

      <div>
        <Label>For each row</Label>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="What to do for each row">
          {([['table', 'Data table'], ['reference', 'API call'], ['workflow', 'Workflow']] as const).map(([t, l]) => (
            <button key={t} type="button" role="radio" aria-checked={config.target === t} onClick={() => t !== config.target && onChange(normalizeTableChanges({ field: config.field, kinds: config.kinds, where: config.where, target: t, order: config.order, on_error: config.on_error, show_summary: config.show_summary }))}
              className={cn('min-h-7 truncate rounded border px-1 py-1 text-2xs font-medium leading-tight', config.target === t ? 'border-primary' : 'border-border', config.target === t ? 'bg-primary-wash' : '', config.target === t ? 'text-primary-text' : 'text-fg')}
              data-tc-target={t}>{l}</button>
          ))}
        </div>
      </div>

      {config.target === 'table' && (
        <>
          <div>
            <Label>Data table</Label>
            <AutocompleteSelect value={config.table_id ?? ''} placeholder="Choose a table…" options={(tables as any[]).map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => set({ table_id: v || undefined, mapping: undefined, match_column: undefined })} />
          </div>
          <div>
            <Label>Operation</Label>
            <AutocompleteSelect value={config.operation ?? 'auto'} options={TABLE_WRITE_OPERATIONS.map((op) => ({ value: op, label: TABLE_WRITE_OPERATION_LABELS[op] }))}
              onChange={(v) => set({ operation: (v || 'auto') as TableWriteOperation })} />
          </div>
          {[...ops].some((op) => op !== 'insert') && (
            <div className="grid grid-cols-2 gap-1">
              <div>
                <Label>Match on target column</Label>
                <AutocompleteSelect value={config.match_column ?? ''} placeholder="Column…" options={[{ value: 'row_id', label: 'Row id' }, ...targetColumns.map((c) => ({ value: c, label: c }))]}
                  onChange={(v) => set({ match_column: v || undefined })} />
              </div>
              <div>
                <Label>…equal to</Label>
                <VariableInput value={config.match_value ?? '{{key}}'} extraVariables={placeholders} onChange={(v) => set({ match_value: v && v !== '{{key}}' ? v : undefined }, 'tc-match')} />
              </div>
            </div>
          )}
          {config.table_id && ![...ops].every((op) => op === 'delete') && (
            <TemplateMap label="Columns (target column ← value)" names={targetColumns} value={config.mapping ?? {}} placeholders={placeholders} testId="tc-mapping"
              onChange={(next) => set({ mapping: Object.keys(next).length ? next : undefined }, 'tc-map')} />
          )}
          <Hint>Writes run as the person who submits (they need permission to manage rows; their data access applies).</Hint>
        </>
      )}

      {config.target === 'reference' && (
        <>
          <div>
            <Label>API reference / connector operation</Label>
            <AutocompleteSelect value={config.reference_id ?? ''} placeholder="Choose a reference…"
              options={(references as any[]).map((r) => ({ value: String(r.id), label: String(r.name), hint: referencePickerHint(r) }))}
              onChange={(v) => { const ref = (references as any[]).find((r) => r.id === v); set({ reference_id: v || undefined, integration_id: ref?.integration?.id ? String(ref.integration.id) : undefined, inputs: undefined }) }} />
          </div>
          {isWriteReference(reference) && (
            <p className="text-2xs text-warning" role="note" data-testid="tc-writes-data">
              &#9888; {KIND_INFO[customKindOf(reference) ?? 'update'].label} reference — writes data for every changed row, on the server, each time this runs.
            </p>
          )}
          {config.reference_id && refInputs.length > 0 && columns.length > 0 && (
            <button type="button" className="text-2xs font-medium text-primary-text" data-testid="tc-map-columns"
              onClick={() => { const next = mapRowColumnsToInputs(refInputs, columns.map((c) => c.key), config.inputs ?? {}); set({ inputs: Object.keys(next).length ? next : undefined }, 'tc-in') }}>
              Map row columns to inputs of the same name
            </button>
          )}
          {config.reference_id && (
            <TemplateMap label="Request (input ← value)" names={refInputs} value={config.inputs ?? {}} placeholders={placeholders} testId="tc-inputs"
              onChange={(next) => set({ inputs: Object.keys(next).length ? next : undefined }, 'tc-in')} />
          )}
          <Hint>Called on the server, once per row; each row&apos;s status and response are captured.</Hint>
        </>
      )}

      {config.target === 'workflow' && (
        <>
          <div>
            <Label>Workflow</Label>
            <AutocompleteSelect value={config.workflow_id ?? ''} placeholder="Choose a workflow…"
              options={(workflows as any[]).map((w) => ({ value: String(w.id), label: String(w.name), hint: w.is_active ? undefined : 'inactive' }))}
              onChange={(v) => set({ workflow_id: v || undefined, workflow_name: (workflows as any[]).find((w) => w.id === v)?.name, inputs: undefined })} />
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="How often">
            {([['row', 'Once per row'], ['once', 'Once with all changes']] as const).map(([p, l]) => (
              <button key={p} type="button" role="radio" aria-checked={(config.per ?? 'row') === p} onClick={() => set({ per: p === 'once' ? 'once' : undefined })}
                className={cn('h-7 flex-1 rounded border text-2xs font-medium', (config.per ?? 'row') === p ? 'border-primary' : 'border-border', (config.per ?? 'row') === p ? 'bg-primary-wash' : '', (config.per ?? 'row') === p ? 'text-primary-text' : 'text-fg')}
               >{l}</button>
            ))}
          </div>
          {config.workflow_id && (
            <TemplateMap label="Inputs (input ← value)" names={wfInputs} value={config.inputs ?? {}} placeholders={placeholders} free={!wfInputs.length}
              onChange={(next) => set({ inputs: Object.keys(next).length ? next : undefined }, 'tc-wf')} />
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-1">
        <div>
          <Label>Order</Label>
          <AutocompleteSelect value={config.order ?? 'deletes_first'} options={[{ value: 'deletes_first', label: 'Deletes, updates, inserts' }, { value: 'inserts_first', label: 'Inserts, updates, deletes' }]}
            onChange={(v) => set({ order: v === 'inserts_first' ? 'inserts_first' : undefined })} />
        </div>
        <div>
          <Label>On an error</Label>
          <AutocompleteSelect value={config.on_error ?? 'stop'} options={[{ value: 'stop', label: 'Stop' }, { value: 'continue', label: 'Continue and report' }]}
            onChange={(v) => set({ on_error: v === 'continue' ? 'continue' : undefined })} />
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={config.show_summary !== false} onChange={(e) => set({ show_summary: e.target.checked ? undefined : false })} />
        Show the summary (&ldquo;3 rows updated, 1 failed&rdquo;)
      </label>
      <Hint>The summary is also {'{{table_changes_summary}}'} in later messages, the success screen and workflow inputs.</Hint>

      <div className="rounded border p-1.5 border-border">
        <button type="button" onClick={runDryRun} disabled={!config.field} className="flex items-center gap-1 text-2xs font-medium disabled:opacity-50 text-primary-text" data-testid="tc-dry-run">
          <Play size={11} aria-hidden /> Dry run with the preview&apos;s changes
        </button>
        {dryRun && (
          <div className="mt-1 space-y-0.5" aria-live="polite" data-testid="tc-dry-run-result">
            <p className="text-2xs font-medium">{dryRun.summary.text}</p>
            {dryRun.plan.ops.slice(0, 12).map((op, i) => <p key={i} className="font-mono text-2xs break-words text-fg-muted">{describePlannedOp(op, config)}</p>)}
            {!dryRun.plan.ops.length && <p className="text-2xs text-fg-muted">Edit rows in the live preview, then run it again.</p>}
            <button type="button" className="text-2xs underline" onClick={() => setDryRun(null)} aria-label="Close the dry run"><X size={10} aria-hidden /></button>
          </div>
        )}
      </div>
    </div>
    </DesignerVariableScope>
  )
}
