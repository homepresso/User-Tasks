'use client'

import { Pencil } from 'lucide-react'
import { describeShaping } from '@/lib/custom-references/shaping'
import { normalizeCustomConfig } from '@/lib/custom-references/normalize'
import { columnName } from '@/lib/custom-references/types'
import { Button } from '@/components/ui/button'
import { muted } from './sections'

/* eslint-disable @typescript-eslint/no-explicit-any -- stored JSON */

/** What a saved custom reference does, at a glance (expanded row in the reference list). */
export function CustomReferenceSummary({ reference, onEdit }: { reference: { request_config?: any; inputs?: any; outputs?: any }; onEdit: () => void }) {
  let config: ReturnType<typeof normalizeCustomConfig> | null = null
  let error: string | null = null
  try {
    config = normalizeCustomConfig(reference.request_config?.custom, { allowNoColumns: true })
  } catch (e: any) {
    error = String(e?.message ?? e)
  }
  if (!config) return <p className="pt-2 text-xs text-danger">This custom reference is not valid: {error}</p>
  const stages = describeShaping(config)
  const source = config.source.type === 'table' ? `${config.source.schema ? `${config.source.schema}.` : ''}${config.source.table}` : config.source.label ?? `${reference.request_config?.method ?? 'GET'} ${reference.request_config?.path_template ?? ''}`
  const fixed = config.inputs.filter((i) => i.mode === 'fixed')
  const asked = config.inputs.filter((i) => i.mode !== 'fixed')
  return (
    <div className="space-y-2 pt-3 text-xs" data-testid="custom-reference-summary">
      <div className="flex items-start gap-2">
        <dl className="grid flex-1 grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          <dt className="text-fg-muted">Kind</dt><dd>{config.kind === 'list' ? `List${config.include_total ? ' ({ rows, total })' : ' (rows)'}` : 'Read (one record)'}</dd>
          <dt className="text-fg-muted">Source</dt><dd className="font-mono">{source}</dd>
          <dt className="text-fg-muted">Inputs</dt>
          <dd>{asked.map((i) => `${i.name}${i.required ? '*' : ''}`).join(', ') || '—'}{fixed.length ? ` · fixed: ${fixed.map((i) => (i.fixed_setting ? `${i.name} ← setting ${i.fixed_setting}` : `${i.name} = ${JSON.stringify(i.fixed_value)}`)).join(', ')}` : ''}</dd>
          <dt className="text-fg-muted">Columns</dt><dd className="font-mono">{config.columns.map((c) => (columnName(c) === c.path ? c.path : `${c.path} → ${columnName(c)}`)).join(', ') || 'all'}</dd>
          {stages.api.length > 0 && <><dt className="text-fg-muted">At the {config.source.type === 'table' ? 'database' : 'API'}</dt><dd>{stages.api.join('; ')}</dd></>}
          <dt className="text-fg-muted">On the server</dt><dd>{stages.server.join('; ')}</dd>
        </dl>
        <Button size="sm" variant="outline" onClick={onEdit}><Pencil size={12} className="mr-1" /> Edit</Button>
      </div>
    </div>
  )
}
