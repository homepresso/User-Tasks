'use client'

import { useMemo, useState } from 'react'
import { Wand2, Trash2 } from 'lucide-react'
import { captureResponseSample, countSchemaFields, normalizeResponseSchema, stripSample, type ResponseSchema } from '@/lib/response-schema'
import type { DataGroup, PickerItem } from '@/lib/workflow-data-picker'
import { DataTree } from './data-picker'

const SOURCE_LABEL: Record<string, string> = {
  openapi: 'from the API spec',
  sample: 'captured from a test response',
  database: 'from the table columns',
  connector: 'from the connector catalogue',
  outputs: 'derived from the declared outputs',
  manual: 'set by hand',
}

export function describeModel(schema: ResponseSchema | null): string {
  if (!schema) return 'No response model yet'
  const fields = countSchemaFields(schema.root)
  const samples = schema.samples && schema.samples > 1 ? ` · ${schema.samples} samples merged` : ''
  return `${fields} field${fields === 1 ? '' : 's'} ${SOURCE_LABEL[schema.source] ?? ''}${samples}`
}

/** A response model as a browsable tree (one synthetic group rooted at `rootPath`). */
export function ResponseModelTree({ schema, rootPath, rootLabel = 'response', onAddOutput, maxHeight = 260 }: {
  schema: ResponseSchema | null
  rootPath: string
  rootLabel?: string
  onAddOutput?: (item: PickerItem, relativePath: string) => void
  maxHeight?: number
}) {
  const groups = useMemo<DataGroup[]>(() => (schema ? [{
    id: 'model',
    label: 'Response model',
    kind: 'step',
    roots: [{ path: rootPath, label: rootLabel, schema: schema.root }],
  }] : []), [schema, rootPath, rootLabel])
  if (!schema) return null
  return (
    <div className="rounded-lg border" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <DataTree
        groups={groups}
        readOnly
        maxHeight={maxHeight}
        onPick={() => {}}
        onAddOutput={onAddOutput ? (item) => onAddOutput(item, relativeOutputPath(item.path, rootPath)) : undefined}
      />
    </div>
  )
}

/** Tree path → output path relative to the response (`data[].email` → `data[0].email`). */
export function relativeOutputPath(path: string, rootPath: string): string {
  const rest = path === rootPath ? '' : path.startsWith(`${rootPath}.`) ? path.slice(rootPath.length + 1) : path
  return rest.replace(/\[\]/g, '[0]')
}

/** Suggested output/variable name for a tree path (`data[].address.city` → `address_city`). */
export function outputNameFor(path: string, rootPath: string): string {
  const rest = relativeOutputPath(path, rootPath).replace(/\[0\]/g, '')
  const parts = rest.split('.').filter(Boolean)
  const name = (parts.slice(-2).join('_') || 'response').replace(/[^a-zA-Z0-9_]/g, '_')
  return path.includes('[]') && parts.length ? `first_${name}` : name
}

/**
 * HTTP Request: paste a sample response (e.g. from a test run) to give the
 * step a response model, so later steps can pick its fields.
 */
export function HttpResponseModelEditor({ config, outputPrefix, onUpdate }: {
  config: Record<string, any>
  outputPrefix: string
  onUpdate: (key: string, value: any) => void
}) {
  const schema = normalizeResponseSchema(config._response_schema)
  const [sample, setSample] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  function capture() {
    try {
      const parsed = JSON.parse(sample)
      onUpdate('_response_schema', stripSample(captureResponseSample(schema, parsed)))
      setSample('')
      setError(null)
    } catch {
      setError('That is not valid JSON — paste the response body exactly as returned.')
    }
  }

  return (
    <div className="rounded-lg border p-2 space-y-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="text-[11px] font-medium" style={{ color: 'var(--theme-card-text)' }}>Response model</span>
        <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{describeModel(schema)}</span>
      </button>
      {open && (
        <>
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            Paste a sample response (from a test run or the API docs). Its fields become pickable as <code className="font-mono">{`{{${outputPrefix}_response…}}`}</code> in later steps. Each capture is merged into the model.
          </p>
          <textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={4}
            aria-label="Sample response JSON"
            placeholder='{"data": [{"id": 1, "email": "ada@example.com"}]}'
            className="w-full rounded border px-2 py-1.5 font-mono text-[11px]"
            style={{ backgroundColor: 'var(--theme-input-bg, var(--theme-card-bg))', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          />
          {error && <p className="text-[11px]" style={{ color: 'var(--theme-danger)' }}>{error}</p>}
          <div className="flex gap-1.5">
            <button type="button" onClick={capture} disabled={!sample.trim()}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
              <Wand2 size={11} aria-hidden /> Capture model
            </button>
            {schema && (
              <button type="button" onClick={() => onUpdate('_response_schema', undefined)}
                className="flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
                style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                <Trash2 size={11} aria-hidden /> Clear
              </button>
            )}
          </div>
          <ResponseModelTree schema={schema} rootPath={`${outputPrefix}_response`} />
        </>
      )}
    </div>
  )
}
