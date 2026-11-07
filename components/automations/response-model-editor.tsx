'use client'

import { useMemo, useState } from 'react'
import { Wand2, Trash2 } from 'lucide-react'
import { captureResponseSample, countSchemaFields, normalizeResponseSchema, stripSample, type ResponseSchema } from '@/lib/response-schema'
import type { DataGroup, PickerItem } from '@/lib/workflow-data-picker'
import { DataTree } from './data-picker'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

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
    <div className="overflow-hidden rounded-md border border-border bg-panel">
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
    <Card variant="inset" padding="sm" className="space-y-2">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 rounded-sm text-left">
        <span className="text-xs font-medium text-fg">Response model</span>
        <span className="truncate text-xs text-fg-muted">{describeModel(schema)}</span>
      </button>
      {open && (
        <>
          <p className="text-xs text-fg-muted">
            Paste a sample response (from a test run or the API docs). Its fields become pickable as <code className="font-mono text-2xs text-fg">{`{{${outputPrefix}_response…}}`}</code> in later steps. Each capture is merged into the model.
          </p>
          <Textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={4}
            aria-label="Sample response JSON"
            aria-invalid={error ? true : undefined}
            placeholder='{"data": [{"id": 1, "email": "ada@example.com"}]}'
            className="font-mono text-xs"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-1.5">
            <Button type="button" variant="secondary" size="sm" onClick={capture} disabled={!sample.trim()} leadingIcon={<Wand2 aria-hidden />}>
              Capture model
            </Button>
            {schema && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onUpdate('_response_schema', undefined)} leadingIcon={<Trash2 aria-hidden />}>
                Clear
              </Button>
            )}
          </div>
          <ResponseModelTree schema={schema} rootPath={`${outputPrefix}_response`} />
        </>
      )}
    </Card>
  )
}
