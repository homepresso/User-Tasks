'use client'

/**
 * Loop "Pick a list from a response": choose an earlier Call reference step,
 * then the list in its response (any depth) with the shared collection
 * picker. "Load sample" runs the reference and refreshes that step's model
 * snapshot, so the data picker can drill into the items too.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { ResponseCollectionPicker } from '@/components/integrations/response-collection-picker'
import { normalizeResponseSchema, stripSample } from '@/lib/response-schema'
import { collectionPathFromExpression, workflowCollectionExpression } from '@/lib/response-collections'
import { nodeOutputPrefix, upstreamNodeIds, type PickerEdgeLike, type PickerNodeLike } from '@/lib/workflow-data-picker'

/* eslint-disable @typescript-eslint/no-explicit-any -- node configs are free-form */

export function LoopCollectionPicker({ loopId, items, nodes, edges, onSetItems, onUpdateNodeConfig }: {
  loopId: string
  items: string
  nodes: PickerNodeLike[]
  edges: PickerEdgeLike[]
  onSetItems: (expression: string) => void
  onUpdateNodeConfig: (nodeId: string, config: Record<string, any>) => void
}) {
  const steps = useMemo(() => {
    const upstream = upstreamNodeIds(loopId, edges)
    return nodes.filter((n) => upstream.has(n.id) && n.type === 'call_reference' && n.config?.reference_id)
  }, [loopId, nodes, edges])
  // The step the current items expression points at, else the nearest one.
  const pointed = steps.find((n) => collectionPathFromExpression(items, `${nodeOutputPrefix(n)}_response`) !== null)
  const [stepId, setStepId] = useState<string>(pointed?.id ?? steps[steps.length - 1]?.id ?? '')
  const [open, setOpen] = useState(!!pointed || !items.trim())
  const step = steps.find((n) => n.id === stepId) ?? null
  if (!steps.length) return null
  const base = step ? `${nodeOutputPrefix(step)}_response` : ''
  const current = step ? collectionPathFromExpression(items, base) : null
  const schema = step ? normalizeResponseSchema(step.config?._ref_response_schema) : null
  const inputs = Array.isArray(step?.config?._ref_inputs) ? step!.config._ref_inputs : []
  const mappings = (step?.config?.input_mappings && typeof step.config.input_mappings === 'object' ? step.config.input_mappings : {}) as Record<string, string>

  return (
    <div className="rounded-md border border-border p-2" data-testid="loop-collection-picker">
      <button type="button" className="flex w-full items-center gap-1 rounded-sm text-xs font-medium text-fg hover:text-primary-text" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} className="text-fg-muted" /> : <ChevronRight size={14} className="text-fg-muted" />} Pick a list from a step&apos;s response
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <AutocompleteSelect value={stepId} options={steps.map((n) => ({ value: n.id, label: String(n.label ?? n.id), hint: `${nodeOutputPrefix(n)}_response` }))} onChange={(v) => setStepId(v)} />
          {step && (
            <ResponseCollectionPicker
              key={step.id}
              schema={schema}
              value={current ?? undefined}
              autoPick={!items.trim()}
              onChange={(path) => onSetItems(workflowCollectionExpression(base, path))}
              referenceId={String(step.config.reference_id)}
              inputs={inputs}
              mappings={mappings}
              onSchemaLoaded={(loaded) => onUpdateNodeConfig(step.id, { ...step.config, _ref_response_schema: stripSample(loaded) ?? undefined })}
              label="Loop through"
              expressionFor={(path) => workflowCollectionExpression(base, path)}
              testId="loop-rows-list"
            />
          )}
        </div>
      )}
    </div>
  )
}
