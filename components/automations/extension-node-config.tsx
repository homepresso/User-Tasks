'use client'

/**
 * Properties panel of an extension node or trigger (`ext.<id>.<key>`),
 * generated from the manifest's typed fields with the custom-action
 * editors: one editor per input (values or {{data}}), the typed outputs the
 * step gives back (also in the data picker, via the `_action_outputs`
 * snapshot) and the prefix they are saved under. Triggers show their
 * settings (stored on the node config) and the run variables they provide;
 * a multi-choice setting (type array with options) is a set of checkboxes,
 * the declared field-change filter is edited with FieldFilterBuilder, and a
 * declared preview source adds "Test with the latest event".
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { checkTriggerConflicts } from '@/app/actions/automations'
import { TRIGGER_CONFLICT_CHOICES, type TriggerConflict } from '@/lib/extensions/sdk'
import { TriggerConflictDialog } from './trigger-conflict-dialog'
import type { ActionField } from '@/lib/custom-actions/contract'
import { loadExtensionUiData } from '@/app/actions/extensions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import type { WorkflowNode } from '@/lib/workflow-schema'
import { extensionCatalogEntry } from '@/lib/extensions/nodes'
import { useExtensionUiState } from '@/components/extensions/extensions-provider'
import { InputEditor, OutputRow } from './custom-action-config'
import { FieldFilterBuilder } from './field-filter-builder'
import { FIELD_FILTER_TYPES, type FieldFilterField } from '@/lib/extensions/field-filters'

type Options = Record<string, Array<{ value: string; label?: string }>>

/**
 * Design-time choices for inputs listed in the declaration's optionsFrom:
 * each source (a UI data source of the extension) returns { options }.
 * Re-fetched when another input changes, so a source can depend on it
 * (e.g. the fields of the chosen list). Failures leave the free-text editor.
 */
function useDynamicOptions(extensionId: string | undefined, nodeType: string, optionsFrom: Record<string, string> | undefined, values: Record<string, unknown>, enabled: boolean): Options {
  const [options, setOptions] = useState<Options>({})
  const key = JSON.stringify(values)
  useEffect(() => {
    if (!extensionId || !optionsFrom || !enabled) return
    let cancelled = false
    void Promise.all(Object.entries(optionsFrom).map(async ([input, source]) => {
      const result = await loadExtensionUiData({ extensionId, source, objectType: 'workflow_node', item: { node_type: nodeType, input, values } })
      const list = result.ok && result.data && typeof result.data === 'object' ? (result.data as { options?: unknown }).options : null
      return [input, Array.isArray(list) ? list.filter((o): o is { value: string; label?: string } => Boolean(o) && typeof (o as { value?: unknown }).value === 'string').slice(0, 500) : null] as const
    })).then((pairs) => {
      if (cancelled) return
      const next: Options = {}
      for (const [input, list] of pairs) if (list) next[input] = list
      setOptions(next)
    }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values tracked by their JSON key
  }, [extensionId, nodeType, optionsFrom, enabled, key])
  return options
}

/** One design-time data source (filter fields), re-asked when the settings change. */
function useSourceData(extensionId: string | undefined, nodeType: string, source: string | undefined, values: Record<string, unknown>, enabled: boolean): { data: unknown; loading: boolean } {
  const [state, setState] = useState<{ data: unknown; loading: boolean }>({ data: null, loading: false })
  const key = JSON.stringify(values)
  useEffect(() => {
    if (!extensionId || !source || !enabled) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    void loadExtensionUiData({ extensionId, source, objectType: 'workflow_node', item: { node_type: nodeType, values } })
      .then((result) => { if (!cancelled) setState({ data: result.ok ? result.data : null, loading: false }) })
      .catch(() => { if (!cancelled) setState({ data: null, loading: false }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- values tracked by their JSON key
  }, [extensionId, nodeType, source, enabled, key])
  return state
}

function filterFieldsOf(data: unknown): FieldFilterField[] | null {
  const list = data && typeof data === 'object' ? (data as { fields?: unknown }).fields : null
  if (!Array.isArray(list)) return null
  return list
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string')
    .slice(0, 500)
    .map((f) => ({
      name: String(f.name),
      label: typeof f.label === 'string' ? f.label : undefined,
      type: (FIELD_FILTER_TYPES as readonly string[]).includes(String(f.type)) ? f.type as FieldFilterField['type'] : 'string',
      choices: Array.isArray(f.choices) ? f.choices.map(String).slice(0, 200) : undefined,
    }))
}

/** Multi-choice trigger setting: a declared array field with options. */
function isMultiChoice(field: ActionField): boolean {
  return field.type === 'array' && Array.isArray(field.options) && field.options.length > 0
}

function MultiChoiceEditor({ field, value, onChange }: { field: ActionField; value: unknown; onChange: (next: string[]) => void }) {
  const fallback = Array.isArray(field.default) ? field.default.map(String) : []
  const selected = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? value.split(',').map((v) => v.trim()) : fallback
  return (
    <fieldset className="space-y-1.5 border-t border-border-subtle pt-2" data-multi-choice={field.name}>
      <legend className="text-xs font-medium text-fg">{field.label ?? field.name}</legend>
      {field.description && <p className="text-xs text-fg-muted">{field.description}</p>}
      <div className="grid grid-cols-1 gap-1">
        {(field.options ?? []).map((o) => (
          <Checkbox
            key={o.value}
            label={o.label ?? o.value}
            checked={selected.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...new Set([...selected, o.value])] : selected.filter((v) => v !== o.value))}
          />
        ))}
      </div>
    </fieldset>
  )
}

function TriggerPreview({ extensionId, nodeType, source, values, enabled }: { extensionId: string; nodeType: string; source: string; values: Record<string, unknown>; enabled: boolean }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null; result: { payload?: unknown; matched?: boolean; message?: string } | null }>({ busy: false, error: null, result: null })
  const run = async () => {
    setState({ busy: true, error: null, result: null })
    const res = await loadExtensionUiData({ extensionId, source, objectType: 'workflow_node', item: { node_type: nodeType, values } }).catch(() => null)
    if (!res || !res.ok) return setState({ busy: false, error: res && !res.ok ? res.error : 'The preview failed.', result: null })
    setState({ busy: false, error: null, result: res.data && typeof res.data === 'object' ? res.data as { payload?: unknown; matched?: boolean; message?: string } : null })
  }
  const r = state.result
  return (
    <div className="space-y-2" data-trigger-preview>
      <Button type="button" variant="secondary" size="sm" disabled={!enabled || state.busy} onClick={() => void run()}>
        {state.busy ? 'Reading the latest event…' : 'Test with the latest event'}
      </Button>
      {state.error && <InlineNotice tone="danger" className="text-xs">{state.error}</InlineNotice>}
      {r && (
        <Card variant="inset" padding="sm" className="space-y-1.5">
          {typeof r.matched === 'boolean' && (
            <p className="text-xs font-medium text-fg">{r.matched ? 'This event would start the workflow.' : 'This event would not start the workflow.'}</p>
          )}
          {r.message && <p className="text-xs text-fg-muted">{r.message}</p>}
          {r.payload !== undefined && r.payload !== null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-2xs text-fg-muted">{JSON.stringify(r.payload, null, 2)}</pre>
          )}
        </Card>
      )}
    </div>
  )
}

function withOptions(field: ActionField, options: Options): ActionField {
  const list = options[field.name]
  return list ? { ...field, type: 'select', options: list } : field
}

function snake(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
}

export function ExtensionNodeConfig({ node, onUpdate, onBatchUpdate, extraVariables }: {
  node: WorkflowNode
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const entry = extensionCatalogEntry(node.type)
  const { state } = useExtensionUiState()
  const config = node.config ?? {}
  const trigger = entry?.category === 'trigger'
  const usable = Boolean(entry && state.extensions.some((e) => e.id === entry.extensionId && (!entry.feature || e.features.includes(entry.feature))))
  const filterConfig = trigger ? entry?.filters?.config : undefined
  const allValues = (trigger ? Object.fromEntries((entry?.inputs ?? []).map((f) => [f.name, config[f.name]])) : (config.input_mappings ?? {})) as Record<string, unknown>
  // Sources depend on the settings, not on the filter being edited.
  const currentValues = filterConfig ? Object.fromEntries(Object.entries(allValues).filter(([k]) => k !== filterConfig)) : allValues
  const dynamicOptions = useDynamicOptions(entry?.extensionId, node.type, entry?.optionsFrom, currentValues, usable)
  const filterSource = useSourceData(entry?.extensionId, node.type, trigger ? entry?.filters?.fieldsFrom : undefined, currentValues, usable)
  const filterFields = filterFieldsOf(filterSource.data)
  const conflicts = useTriggerConflicts(trigger && usable ? node : null, onUpdate, onBatchUpdate)

  // Keep the outputs snapshot (data picker) and the prefix in step with the installed manifest.
  useEffect(() => {
    if (!entry || trigger) return
    const snapshot = JSON.stringify(entry.outputs)
    if (JSON.stringify(config._action_outputs ?? null) !== snapshot || !config._output_prefix) {
      onBatchUpdate({ _action_outputs: entry.outputs, manifest: { outputs: entry.outputs }, ...(config._output_prefix ? {} : { _output_prefix: snake(entry.key) }) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when the node type changes
  }, [node.type])

  if (!entry) {
    return <InlineNotice tone="warning" className="text-xs">This step uses {node.type}, which is not installed in this build. It will fail when it runs.</InlineNotice>
  }
  const mappings = (config.input_mappings ?? {}) as Record<string, string>
  const prefix = String(config._output_prefix || snake(entry.key))

  return (
    <>
    {conflicts}
    <div className="space-y-4" onPointerDown={(e) => e.stopPropagation()} data-extension-node={node.type}>
      <Card variant="inset" padding="sm" className="space-y-1">
        <p className="text-xs font-semibold text-fg">{entry.label}</p>
        <p className="text-xs text-fg-muted">{entry.description}</p>
        <p className="text-2xs text-fg-subtle">From the {entry.extensionName} extension</p>
      </Card>
      {!usable && (
        <InlineNotice tone="warning" className="text-xs">
          {entry.extensionName} is not enabled or not licensed in this workspace: the step will fail until an administrator enables it (Settings → Extensions).
        </InlineNotice>
      )}
      {entry.inputs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-muted">{trigger ? 'Trigger settings' : 'Inputs'}</p>
          {entry.inputs.map((field) => {
            if (trigger && field.name === filterConfig) {
              return (
                <FieldFilterBuilder
                  key={field.name}
                  label={field.label ?? field.name}
                  description={field.description}
                  fields={filterFields}
                  loading={filterSource.loading}
                  value={config[field.name]}
                  onChange={(next) => onUpdate(field.name, next)}
                />
              )
            }
            if (trigger && isMultiChoice(field)) {
              return <MultiChoiceEditor key={field.name} field={field} value={config[field.name]} onChange={(next) => onUpdate(field.name, next)} />
            }
            return (
              <InputEditor
                key={field.name}
                field={withOptions(field, dynamicOptions)}
                value={String((trigger ? config[field.name] : mappings[field.name]) ?? '')}
                onChange={(value) => (trigger ? onUpdate(field.name, value) : onUpdate('input_mappings', { ...mappings, [field.name]: value }))}
                extraVariables={extraVariables}
              />
            )
          })}
        </div>
      )}
      {trigger && entry.previewFrom && (
        <TriggerPreview extensionId={entry.extensionId} nodeType={node.type} source={entry.previewFrom} values={allValues} enabled={usable} />
      )}
      {entry.outputs.length > 0 && (
        <Card variant="inset" padding="sm" className="space-y-2">
          <p className="text-xs font-medium text-fg-muted">{trigger ? 'Run variables' : 'Outputs'}</p>
          <p className="text-xs text-fg-muted">{trigger ? 'Set by the event that starts the run.' : 'Available to later steps in the data picker, with their types.'}</p>
          {entry.outputs.map((field) => trigger
            ? <p key={field.name} className="text-xs"><code className="text-primary-text">{`{{${field.name}}}`}</code> <span className="text-fg-muted">{field.label ?? field.name}</span></p>
            : <OutputRow key={field.name} field={field} prefix={prefix} />)}
        </Card>
      )}
      {!trigger && (
        <div>
          <label htmlFor="ext-prefix" className="mb-1 block text-xs font-medium text-fg">Save outputs as</label>
          <Input id="ext-prefix" value={config._output_prefix ?? ''} placeholder={snake(entry.key)} size="sm" className="font-mono"
            onChange={(e) => onUpdate('_output_prefix', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </div>
      )}
    </div>
    </>
  )
}

/**
 * Trigger settings that overlap with other workflows (the extension's TriggerHandler.conflicts):
 * checked shortly after each change; each unanswered conflict asks Remove / Keep both / Cancel.
 * The answer is stored in the draft (TRIGGER_CONFLICT_CHOICES) and applied when publishing;
 * Cancel puts the settings back as they were before the change.
 */
function useTriggerConflicts(node: WorkflowNode | null, onUpdate: (key: string, value: any) => void, onBatchUpdate: (updates: Record<string, any>) => void) {
  const params = useParams<{ id?: string }>()
  const workflowId = typeof params?.id === 'string' ? params.id : ''
  const config = (node?.config ?? {}) as Record<string, any>
  const { [TRIGGER_CONFLICT_CHOICES]: stored, ...settings } = config
  const key = node ? JSON.stringify(settings) : ''
  const previous = useRef<Record<string, any> | null>(null)
  const last = useRef<string>('')
  const [open, setOpen] = useState<TriggerConflict[]>([])
  useEffect(() => {
    if (!node || !key) return
    if (!last.current) { last.current = key; previous.current = config; return } // the settings as loaded: nothing to ask
    if (key === last.current) return
    const before = previous.current
    const timer = setTimeout(async () => {
      const r = await checkTriggerConflicts(workflowId, [{ ...node, config }]).catch(() => null)
      last.current = key
      if (!r?.unanswered.length) { previous.current = config; return }
      setOpen(r.conflicts.filter((c) => r.unanswered.includes(c.key)))
      previous.current = before
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the settings' content is the trigger
  }, [key])
  const current = open[0] ?? null
  return (
    <TriggerConflictDialog
      conflict={current}
      onChoose={(choice) => {
        onUpdate(TRIGGER_CONFLICT_CHOICES, { ...((stored ?? {}) as Record<string, string>), [current!.key]: choice })
        setOpen((rest) => rest.slice(1))
        previous.current = config
      }}
      onCancel={() => {
        setOpen([])
        if (previous.current) { last.current = ''; onBatchUpdate(previous.current) }
      }}
    />
  )
}
