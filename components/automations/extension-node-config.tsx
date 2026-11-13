'use client'

/**
 * Properties panel of an extension node or trigger (`ext.<id>.<key>`),
 * generated from the manifest's typed fields with the custom-action
 * editors: one editor per input (values or {{data}}), the typed outputs the
 * step gives back (also in the data picker, via the `_action_outputs`
 * snapshot) and the prefix they are saved under. Triggers show their
 * settings (stored on the node config) and the run variables they provide.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import type { WorkflowNode } from '@/lib/workflow-schema'
import { extensionCatalogEntry } from '@/lib/extensions/nodes'
import { useExtensionUiState } from '@/components/extensions/extensions-provider'
import { InputEditor, OutputRow } from './custom-action-config'

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
          {entry.inputs.map((field) => (
            <InputEditor
              key={field.name}
              field={field}
              value={String((trigger ? config[field.name] : mappings[field.name]) ?? '')}
              onChange={(value) => (trigger ? onUpdate(field.name, value) : onUpdate('input_mappings', { ...mappings, [field.name]: value }))}
              extraVariables={extraVariables}
            />
          ))}
        </div>
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
  )
}
