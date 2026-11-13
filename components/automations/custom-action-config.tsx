'use client'

/**
 * Properties panel of a custom workflow action step (node type
 * custom_activity): pick the action and its function, then fill a panel
 * GENERATED from the manifest — one typed editor per input (choices become a
 * select, booleans a yes / no, the rest accept values and {{data}}) — and see
 * the typed outputs the step gives back (also in the data picker).
 *
 * The step stores { custom_activity_id, custom_activity_key, operation,
 * input_mappings, _output_prefix } plus a snapshot of the function's outputs
 * (_action_outputs) for the data picker. It never stores code: the engine
 * runs the action from the workspace library.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BadgeCheck, ChevronDown, ChevronRight, ExternalLink, Globe, KeyRound, Database, FileText, ShieldCheck } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { TONE_CLASSES, type Tone } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { WorkflowNode } from '@/lib/workflow-schema'
import { actionFieldTypeLabel, actionManifestOf, operationOf } from '@/lib/custom-actions/manifest'
import type { ActionField } from '@/lib/custom-actions/contract'
import { VariableInput } from './variable-input'

function snake(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
}

function exampleText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' | 'ok' | 'primary' }) {
  const t = TONE_CLASSES[({ muted: 'neutral', warn: 'warning', ok: 'success', primary: 'brand' } as const satisfies Record<string, Tone>)[tone]]
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs font-medium', t.bg, t.text)}>{children}</span>
}

/** One generated input editor (also used for extension nodes). */
export function InputEditor({ field, value, onChange, extraVariables }: {
  field: ActionField
  value: string
  onChange: (value: string) => void
  extraVariables: { name: string; group: string }[]
}) {
  const id = `action-input-${field.name}`
  const isExpression = /\{\{/.test(value)
  const [expression, setExpression] = useState(isExpression)
  const placeholder = exampleText(field.example) ?? exampleText(field.default) ?? field.placeholder ?? (field.required ? 'Value or {{data}}' : 'Optional')
  const choice = field.type === 'select' || field.type === 'boolean'
  return (
    <div className="space-y-1.5 border-t border-border-subtle pt-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={id} className="text-xs font-medium text-fg">{field.label ?? field.name}</label>
        <Chip>{actionFieldTypeLabel(field)}</Chip>
        <Chip tone={field.required ? 'warn' : 'muted'}>{field.required ? 'Required' : 'Optional'}</Chip>
        {choice && (
          <Button type="button" variant="link" size="sm" className="ml-auto h-auto" onClick={() => setExpression((v) => !v)}>
            {expression ? 'Pick a value' : 'Use data'}
          </Button>
        )}
      </div>
      {field.description && <p className="text-xs text-fg-muted">{field.description}</p>}
      {choice && !expression ? (
        <Select
          id={id}
          size="sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{field.default !== undefined ? `Default (${exampleText(field.default)})` : '—'}</option>
          {field.type === 'boolean'
            ? [<option key="true" value="true">Yes</option>, <option key="false" value="false">No</option>]
            : (field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
        </Select>
      ) : (
        <VariableInput
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          extraVariables={extraVariables}
          multiline={field.type === 'text' || field.type === 'object' || field.type === 'array' || field.type === 'json'}
          rows={field.type === 'text' ? 3 : 2}
        />
      )}
      {(field.type === 'array' || field.type === 'object' || field.type === 'json') && (
        <p className="text-xs text-fg-muted">Insert data with {'{{…}}'} or type JSON{field.type === 'array' ? ' (or one item per line)' : ''}.</p>
      )}
    </div>
  )
}

export function OutputRow({ field, prefix, depth = 0 }: { field: ActionField; prefix: string; depth?: number }) {
  const nested = field.type === 'array' ? field.items?.fields : field.type === 'object' ? field.fields : undefined
  return (
    <div className="space-y-1" style={{ marginLeft: depth * 12 }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-fg">{field.label ?? field.name}</span>
        <Chip>{actionFieldTypeLabel(field)}</Chip>
        {depth === 0 && <code className="text-2xs text-primary-text">{`{{${prefix}_${field.name}}}`}</code>}
        {depth > 0 && <code className="text-2xs text-fg-muted">{field.name}</code>}
      </div>
      {field.description && depth === 0 && <p className="text-xs text-fg-muted">{field.description}</p>}
      {nested?.map((child) => <OutputRow key={child.name} field={child} prefix={prefix} depth={depth + 1} />)}
    </div>
  )
}

export function CustomActionConfig({ node, activities, onUpdate, onBatchUpdate, extraVariables }: {
  node: WorkflowNode
  activities: any[]
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const [advanced, setAdvanced] = useState(false)
  const config = node.config ?? {}
  const activityId = String(config.custom_activity_id ?? '')
  const selected = activities.find((a) => a.id === activityId) ?? activities.find((a) => config.custom_activity_key && a.key === config.custom_activity_key)
  const manifest = useMemo(() => actionManifestOf(selected ?? { manifest: config.manifest, key: config.custom_activity_key, name: config.activity_name }), [selected, config.manifest, config.custom_activity_key, config.activity_name])
  const operation = operationOf(manifest, config.operation) ?? manifest.operations[0] ?? null
  const mappings = (config.input_mappings ?? {}) as Record<string, string>
  const prefix = String(config._output_prefix || selected?.key || 'custom_action').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const caps = manifest.capabilities ?? {}
  const signed = Boolean(selected?.signature?.verified)

  // Keep the outputs snapshot (data picker) in step with the installed version.
  useEffect(() => {
    if (!selected || !operation) return
    const snapshot = JSON.stringify(operation.outputs)
    if (JSON.stringify(config._action_outputs ?? null) !== snapshot || config.operation !== operation.id) {
      onBatchUpdate({ operation: operation.id, operation_label: operation.label, _action_outputs: operation.outputs, manifest: { outputs: operation.outputs } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when the action / function changes
  }, [selected?.id, selected?.version, operation?.id])

  function chooseAction(next: any) {
    const m = actionManifestOf(next)
    const op = m.operations[0]
    onBatchUpdate({
      custom_activity_id: next.id,
      custom_activity_key: next.key,
      activity_name: next.name,
      activity_description: next.description ?? '',
      activity_icon_name: next.icon_name ?? 'Puzzle',
      activity_color: next.color ?? '#0EA5E9',
      operation: op?.id ?? null,
      operation_label: op?.label ?? null,
      input_mappings: {},
      _action_outputs: op?.outputs ?? [],
      manifest: { outputs: op?.outputs ?? [] },
      source_code: undefined,
      demo_inputs: undefined,
      _output_prefix: config._output_prefix || snake(next.key || next.name || 'custom_action'),
    })
  }

  function chooseOperation(id: string) {
    const op = manifest.operations.find((o) => o.id === id)
    if (!op) return
    const keep = Object.fromEntries(Object.entries(mappings).filter(([name]) => op.inputs.some((f) => f.name === name)))
    onBatchUpdate({ operation: op.id, operation_label: op.label, input_mappings: keep, _action_outputs: op.outputs, manifest: { outputs: op.outputs } })
  }

  const required = operation?.inputs.filter((f) => f.required) ?? []
  const missing = required.filter((f) => !String(mappings[f.name] ?? '').trim() && f.default === undefined)

  return (
    <div className="space-y-4" onPointerDown={(e) => e.stopPropagation()}>
      <div>
        <label className="mb-1 block text-xs font-medium text-fg">Action</label>
        <AutocompleteSelect
          value={selected?.id ?? activityId}
          placeholder="Choose a custom action…"
          options={activities.map((a: any) => ({
            value: a.id,
            label: `${a.name}${a.enabled === false ? ' (disabled)' : ''}`,
            hint: [a.key, a.version ? `v${a.version}` : null].filter(Boolean).join(' · ') || undefined,
          }))}
          onChange={(nextId) => {
            const next = activities.find((a) => a.id === nextId)
            if (next) chooseAction(next)
          }}
        />
        {activities.length === 0 && (
          <p className="mt-1 text-xs text-fg-muted">
            No actions yet. Install official ones (math, text, dates, data, validation, crypto) from{' '}
            <Link href="/extensibility" className="text-primary-text underline-offset-4 hover:underline">Extensibility → Workflow actions → Browse gallery</Link>.
          </p>
        )}
      </div>

      {!selected && activityId && (
        <InlineNotice tone="warning" className="text-xs">
          This step&apos;s action ({String(config.activity_name ?? config.custom_activity_key ?? activityId)}) is not installed or not active in this workspace.
        </InlineNotice>
      )}

      {selected && (
        <Card variant="inset" padding="sm" className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-xs font-semibold text-fg">{selected.name}</p>
            <Chip tone="primary">v{selected.version}</Chip>
            {selected.enabled === false && <Chip tone="warn">Disabled</Chip>}
            {signed && <Chip tone="ok"><BadgeCheck size={12} aria-hidden="true" />Signed</Chip>}
          </div>
          {(manifest.summary || selected.description) && <p className="text-xs text-fg-muted">{manifest.summary || selected.description}</p>}
          <div className="flex flex-wrap gap-1.5">
            {!caps.http && !caps.data && !caps.files && !caps.credentials?.length && <Chip><ShieldCheck size={12} aria-hidden="true" />Pure computation</Chip>}
            {caps.http && <Chip><Globe size={12} aria-hidden="true" />{caps.http.hosts.join(', ')}</Chip>}
            {caps.data && <Chip><Database size={12} aria-hidden="true" />Data {caps.data.write ? 'read / write' : 'read'}</Chip>}
            {caps.files && <Chip><FileText size={12} aria-hidden="true" />Files</Chip>}
            {(caps.credentials?.length ?? 0) > 0 && <Chip><KeyRound size={12} aria-hidden="true" />{caps.credentials!.map((s) => s.name).join(', ')}</Chip>}
          </div>
          <Link href={`/extensibility?action=${encodeURIComponent(selected.id)}`} className="inline-flex items-center gap-1 text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            Manage in Extensibility <ExternalLink size={12} aria-hidden="true" />
          </Link>
        </Card>
      )}

      {selected && manifest.operations.length > 1 && (
        <div>
          <label htmlFor="action-operation" className="mb-1 block text-xs font-medium text-fg">Function</label>
          <Select
            id="action-operation"
            size="sm"
            value={operation?.id ?? ''}
            onChange={(e) => chooseOperation(e.target.value)}
          >
            {manifest.operations.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
          </Select>
          {operation?.description && <p className="mt-1 text-xs text-fg-muted">{operation.description}</p>}
        </div>
      )}

      {selected && operation && (
        <>
          {operation.inputs.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-fg-muted">Inputs</p>
                {required.length > 0 && <span className="num text-xs text-fg-muted">{required.length - missing.length} of {required.length} required set</span>}
              </div>
              {operation.inputs.map((field) => (
                <InputEditor
                  key={`${operation.id}-${field.name}`}
                  field={field}
                  value={String(mappings[field.name] ?? '')}
                  onChange={(value) => onUpdate('input_mappings', { ...mappings, [field.name]: value })}
                  extraVariables={extraVariables}
                />
              ))}
            </div>
          )}

          {operation.outputs.length > 0 && (
            <Card variant="inset" padding="sm" className="space-y-2">
              <p className="text-xs font-medium text-fg-muted">Outputs</p>
              <p className="text-xs text-fg-muted">Available to later steps in the data picker, with their types.</p>
              {operation.outputs.map((field) => <OutputRow key={field.name} field={field} prefix={prefix} />)}
            </Card>
          )}

          <button type="button" className="flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
            {advanced ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} Advanced
          </button>
          {advanced && (
            <div className="space-y-3">
              <div>
                <label htmlFor="action-prefix" className="mb-1 block text-xs font-medium text-fg">Save outputs as</label>
                <Input id="action-prefix" value={config._output_prefix ?? ''} placeholder={snake(selected.key ?? 'custom_action')}
                  onChange={(e) => onUpdate('_output_prefix', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} size="sm" className="font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="action-timeout" className="mb-1 block text-xs font-medium text-fg">Time limit (ms)</label>
                  <Input id="action-timeout" type="number" min={100} max={60000} step={500} value={config.timeout_ms ?? ''} placeholder={String(manifest.limits.timeout_ms)}
                    onChange={(e) => onUpdate('timeout_ms', e.target.value ? Number(e.target.value) : undefined)} size="sm" className="font-mono" />
                </div>
                <div>
                  <label htmlFor="action-retries" className="mb-1 block text-xs font-medium text-fg">Retries</label>
                  <Input id="action-retries" type="number" min={0} max={5} value={config.retry_attempts ?? ''} placeholder="2"
                    onChange={(e) => onUpdate('retry_attempts', e.target.value === '' ? undefined : Number(e.target.value))} size="sm" className="font-mono" />
                </div>
              </div>
              <p className="text-xs text-fg-muted">Retries apply to retryable failures only (time limit, a failed HTTP call, ctx.fail with retryable). Memory limit {manifest.limits.memory_mb} MB.</p>
              <div>
                <label htmlFor="action-version" className="mb-1 block text-xs font-medium text-fg">Pin version</label>
                <Input id="action-version" value={config.custom_activity_version ?? ''} placeholder={`Current (${selected.version})`}
                  onChange={(e) => onUpdate('custom_activity_version', e.target.value.trim() || undefined)} size="sm" className="font-mono" />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
