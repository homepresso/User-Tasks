'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Info, Lock, Wand2, Workflow } from 'lucide-react'
import { SearchInput } from '@/components/ui/input'
import { loadExtensionUiData } from '@/app/actions/extensions'
import type { DesignerField, DesignerState } from '@/lib/forms/designer-state'
import {
  allowedModes, bulkPrefillPlan, compatibleType, defaultMode, fieldBinding, groupWorkflowData, modePatch, normalizeRecordFields, singleTokenPath, triggerRecordFor, workflowDataScope,
  WORKFLOW_DATA_MODE_LABELS, type WorkflowDataEntry, type WorkflowDataMode, type WorkflowDataScope, type WorkflowDataScopeInput,
} from '@/lib/forms/workflow-data'
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'
import { DRAG_SOURCE_FIELD, FIELD_ICONS, paletteGroupClass } from './field-icons'

/**
 * "Workflow data" in the form designer (lib/forms/workflow-data.ts): the
 * data in scope at the User Task step whose form is designed — List item,
 * Start inputs, Variables, Earlier steps — as entries to drag onto the grid
 * (or click / Enter to add), each creating the control for its type, plus
 * "Prefill all fields from list data". A field's binding (Prefill / Show
 * read-only / Empty) is changed in its properties (WorkflowDataProperty).
 */

/** What the designer knows about the step it designs a form for. */
export interface WorkflowDataContext {
  scope: WorkflowDataScope | null
  loading: boolean
  /** Why the list item's columns are missing (e.g. no access to the list's columns). */
  note?: string | null
  /** "Approve expense" — the step. */
  stepLabel?: string
}

/** Drag payload prefix (DRAG_SOURCE_FIELD carries `wfd:<entry id>` for workflow data). */
export const WORKFLOW_DATA_DRAG_PREFIX = 'wfd:'

/** The scope at a step, with the trigger record's columns read from its extension (cached). */
export function useWorkflowDataScope(input: Omit<WorkflowDataScopeInput, 'recordFields'> | null): WorkflowDataContext {
  const record = useMemo(() => (input ? triggerRecordFor(input.nodes, input.edges, input.nodeId) : null), [input])
  const wantsFields = Boolean(record?.kind === 'extension' && record.extensionId && record.fieldsFrom)
  const fieldsQuery = useQuery({
    queryKey: ['workflow-data-record-fields', record?.extensionId, record?.nodeType, record?.fieldsFrom, JSON.stringify(record?.config ?? {})],
    enabled: wantsFields,
    staleTime: 60_000,
    queryFn: async () => {
      const result = await loadExtensionUiData({ extensionId: record!.extensionId!, source: record!.fieldsFrom!, objectType: 'workflow_node', item: { node_type: record!.nodeType, values: record!.config } })
      if (!result.ok) throw new Error(result.error)
      return normalizeRecordFields(result.data)
    },
  })
  const scope = useMemo(() => (input ? workflowDataScope({ ...input, recordFields: fieldsQuery.data ?? null }) : null), [input, fieldsQuery.data])
  return {
    scope,
    loading: wantsFields && fieldsQuery.isLoading,
    note: fieldsQuery.error ? `The ${record?.label.toLowerCase() ?? 'list item'}'s columns couldn't be read: ${(fieldsQuery.error as Error).message}` : wantsFields && fieldsQuery.data === null ? 'Choose the list on the trigger to see its columns.' : null,
  }
}

/** A token as the designer draws it (the data picker's pill style), labelled. */
export function TokenPill({ label, token, className }: { label: string; token: string; className?: string }) {
  return (
    <span title={`${label}: ${token}`} data-token-pill={token}
      className={cn('inline-flex max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-md border px-1.5 py-0.5 align-middle text-2xs font-medium', className)}
      style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)', borderColor: 'color-mix(in srgb, var(--theme-accent) 40%, transparent)', fontFamily: 'var(--theme-font-sans)' }}>
      {label}
    </span>
  )
}

const MODE_OPTIONS: Array<{ value: 'auto' | WorkflowDataMode; label: string }> = [
  { value: 'auto', label: 'Default (list columns prefilled, other data read-only)' },
  { value: 'prefill', label: WORKFLOW_DATA_MODE_LABELS.prefill },
  { value: 'read_only', label: WORKFLOW_DATA_MODE_LABELS.read_only },
  { value: 'empty', label: WORKFLOW_DATA_MODE_LABELS.empty },
]

/** The mode an entry is added with under the panel's "Add as" choice. */
export function modeFor(entry: WorkflowDataEntry, choice: 'auto' | WorkflowDataMode): WorkflowDataMode {
  if (choice === 'auto') return defaultMode(entry)
  return allowedModes(entry).includes(choice) ? choice : defaultMode(entry)
}

export function WorkflowDataPanel({ data, state, selectedId, readOnly, busy, onAdd, onSelectField, onBulk }: {
  data: WorkflowDataContext
  state: DesignerState
  selectedId: string | null
  readOnly?: boolean
  busy?: boolean
  onAdd: (entry: WorkflowDataEntry, mode: WorkflowDataMode) => void
  onSelectField: (id: string) => void
  onBulk: (plan: Array<{ fieldKey: string; entry: WorkflowDataEntry }>) => void
}) {
  const [query, setQuery] = useState('')
  const [choice, setChoice] = useState<'auto' | WorkflowDataMode>('auto')
  const entries = useMemo(() => data.scope?.entries ?? [], [data.scope])
  const groups = useMemo(() => groupWorkflowData(entries, query), [entries, query])
  const onForm = useMemo(() => {
    const out = new Map<string, DesignerField>()
    for (const f of state.fields) { const path = singleTokenPath(f.default); if (path && !out.has(path)) out.set(path, f) }
    return out
  }, [state.fields])
  const plan = useMemo(() => bulkPrefillPlan(state.fields, entries), [state.fields, entries])
  const hasList = entries.some((e) => e.group === 'list')

  return (
    <div className="flex min-h-0 flex-col" data-workflow-data="" aria-label="Workflow data">
      <div className="space-y-1.5 px-3 pb-2 pt-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg"><Workflow size={12} className="text-fg-muted" aria-hidden /> Workflow data{data.stepLabel ? <span className="truncate font-normal text-fg-muted">· {data.stepLabel}</span> : null}</p>
        <p className="text-2xs text-fg-muted">What this task can show: drag onto the grid, or press Enter to add.</p>
        {data.note && <p className="flex items-start gap-1 text-2xs text-warning" role="status"><Info size={11} className="mt-0.5 shrink-0" aria-hidden />{data.note}</p>}
        {entries.length > 0 && <SearchInput size="sm" aria-label="Search workflow data" placeholder="Search workflow data" value={query} onValueChange={setQuery} />}
        {!readOnly && entries.length > 0 && (
          <div>
            <label htmlFor="workflow-data-mode" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Add as</label>
            <select id="workflow-data-mode" className={inputClass} value={choice} onChange={(e) => setChoice(e.target.value as typeof choice)} data-workflow-data-mode="">
              {MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
        {!readOnly && hasList && (
          <button type="button" disabled={busy || !plan.length} onClick={() => onBulk(plan)}
            className="inline-flex items-center gap-1 text-2xs font-medium text-primary-text hover:underline disabled:cursor-default disabled:text-fg-muted disabled:no-underline" data-bulk-prefill=""
            title={plan.length ? plan.map((p) => `${p.fieldKey} ← ${p.entry.label}`).join('\n') : 'No field without a default matches a list column by name or label'}>
            <Wand2 size={11} aria-hidden /> Prefill all fields from list data{plan.length ? ` (${plan.length})` : ''}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin" aria-busy={data.loading}>
        {data.loading && <p className="px-2 py-1 text-xs text-fg-muted">Loading the list&apos;s columns…</p>}
        {!data.loading && !entries.length && <p className="px-2 py-1 text-xs text-fg-muted">Nothing is in scope at this step yet: add a trigger, start inputs or steps before it.</p>}
        {groups.map((group) => (
          <div key={group.key} className="mb-2" role="group" aria-labelledby={`wfd-group-${group.key}`}>
            <p id={`wfd-group-${group.key}`} className={paletteGroupClass}>{group.label}</p>
            <ul>
              {group.entries.map((entry) => {
                const Icon = FIELD_ICONS[entry.control.type] ?? Workflow
                const field = onForm.get(entry.path)
                const mode = modeFor(entry, choice)
                const label = field ? `${entry.label}, ${entry.typeLabel}, on the form as "${field.label || field.key}": select it`
                  : `Add ${entry.label} (${entry.typeLabel}, from ${entry.source}) as ${WORKFLOW_DATA_MODE_LABELS[mode].toLowerCase()}`
                return (
                  <li key={entry.id}>
                    <button type="button"
                      draggable={!readOnly && !field}
                      onDragStart={(e) => { e.dataTransfer.setData(DRAG_SOURCE_FIELD, `${WORKFLOW_DATA_DRAG_PREFIX}${entry.id}::${mode}`); e.dataTransfer.effectAllowed = 'copy' }}
                      onClick={() => { if (field) onSelectField(field._id); else if (!readOnly && !busy) onAdd(entry, mode) }}
                      aria-label={label} aria-pressed={field ? field._id === selectedId : undefined}
                      title={`${entry.token}${entry.system ? ' · system' : ''}`}
                      className={cn('flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs hover:bg-subtle', field && field._id === selectedId && 'bg-primary-wash text-primary-text', !field && !readOnly && 'cursor-grab')}
                      data-workflow-entry={entry.path} data-on-form={field ? field.key : undefined}>
                      <Icon size={13} className="shrink-0 text-fg-muted" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{entry.label}{group.key !== 'list' && <span className="ml-1 text-2xs text-fg-muted">{entry.source}</span>}</span>
                      {entry.readOnly && <Lock size={10} className="shrink-0 text-fg-muted" aria-label="Read only" />}
                      {field ? <Check size={12} className="shrink-0 text-success" aria-hidden /> : <span className="shrink-0 text-2xs text-fg-muted">{entry.typeLabel}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Field properties: which workflow value fills the field, and how (Prefill / Show read-only / Empty). */
export function WorkflowDataProperty({ field, data, readOnly, onPatch }: {
  field: DesignerField
  data: WorkflowDataContext
  readOnly?: boolean
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
}) {
  const entries = data.scope?.entries ?? []
  const bound = fieldBinding(field, entries)
  const compatible = entries.filter((e) => compatibleType(field.type as TaskFieldType, e))
  const id = `wfd-${field._id}`
  const mode: WorkflowDataMode = bound?.mode ?? 'empty'
  const modes = bound ? allowedModes(bound.entry) : (['prefill', 'read_only', 'empty'] as WorkflowDataMode[])
  if (!entries.length) return null
  return (
    <div className="space-y-1.5 rounded-md border border-border-subtle p-2" data-workflow-binding={bound?.entry.path ?? ''}>
      <label htmlFor={id} className="flex items-center gap-1 text-2xs font-semibold text-fg-muted"><Workflow size={11} aria-hidden /> Workflow data</label>
      <select id={id} className={inputClass} disabled={readOnly} value={bound?.entry.path ?? ''}
        onChange={(e) => {
          const entry = entries.find((x) => x.path === e.target.value) ?? null
          onPatch(modePatch(field, entry, entry ? (mode === 'empty' ? defaultMode(entry) : allowedModes(entry).includes(mode) ? mode : defaultMode(entry)) : 'empty'), `wfd-${field._id}`)
        }}>
        <option value="">Not filled from workflow data</option>
        {compatible.map((e) => <option key={e.path} value={e.path}>{e.group === 'list' ? 'List item' : e.source} › {e.label}</option>)}
      </select>
      {bound && (
        <div role="radiogroup" aria-label="How the field uses it" className="flex flex-wrap gap-1">
          {modes.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={readOnly}
              onClick={() => onPatch(modePatch(field, m === 'empty' ? null : bound.entry, m))}
              className={cn('h-7 rounded border px-2 text-2xs font-medium', mode === m ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')} data-workflow-mode={m}>
              {WORKFLOW_DATA_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}
      <p className="text-2xs text-fg-muted">
        {!bound ? 'Pick a value to fill this field when the task opens.'
          : mode === 'prefill' ? `Starts with ${bound.entry.token} and can be changed.${bound.entry.group === 'list' ? ' The list item is read again when the task opens, until someone edits the field.' : ''}`
          : `Shows ${bound.entry.token}; can't be changed.`}
      </p>
    </div>
  )
}

/** Fields of the form that a bulk plan would prefill, as patches by field key. */
export function bulkPatches(state: DesignerState, plan: Array<{ fieldKey: string; entry: WorkflowDataEntry }>): Map<string, Partial<TaskFieldDef>> {
  const out = new Map<string, Partial<TaskFieldDef>>()
  for (const { fieldKey, entry } of plan) {
    const field = state.fields.find((f) => f.key === fieldKey)
    if (field) out.set(field._id, { default: entry.token })
  }
  return out
}
