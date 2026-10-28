'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateReference, deleteReference } from '@/app/actions/integration-references'
import { useRouter } from 'next/navigation'
import { Save, Trash2, Plus, X, Play, Variable, ArrowRight, Search, Database, Table, Eye, Cog, Loader2, Upload, Image } from 'lucide-react'
import { uploadReferenceIcon } from '@/app/actions/uploads'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { resolveStorageUrl } from "@/lib/storage/refs"
import { captureResponseSample, referenceResponseSchema, schemaAtPath, schemaFromOutputs, type ResponseSchema } from '@/lib/response-schema'
import { ResponseModelTree, describeModel, outputNameFor } from '@/components/automations/response-model-editor'

// Default icons for known database/service types — SVG data URIs
const DEFAULT_DB_ICONS: Record<string, string> = {
  mssql: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#CC2927"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="11">SQL</text></svg>'),
  postgres: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#336791"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="10">PG</text></svg>'),
  postgresql: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#336791"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="10">PG</text></svg>'),
  mysql: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#4479A1"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="9">MY</text></svg>'),
  oracle: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#F80000"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="10">OR</text></svg>'),
  mongodb: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#47A248"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="8">MG</text></svg>'),
  snowflake: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#29B5E8"/><text x="16" y="21" text-anchor="middle" fill="white" font-family="Arial" font-weight="bold" font-size="9">SF</text></svg>'),
}

function getDefaultIcon(baseUrl: string): string | null {
  for (const [key, icon] of Object.entries(DEFAULT_DB_ICONS)) {
    if (baseUrl.startsWith(`${key}://`)) return icon
  }
  return null
}

interface ReferenceInput {
  id: string
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
  default_value: string
  required: boolean
  source: 'variable' | 'static'
}

interface ReferenceOutput {
  id: string
  name: string
  path: string
  type: 'string' | 'number' | 'array' | 'object'
}

interface RequestConfig {
  method: string
  path_template: string
  body_template: string
  query_params: Record<string, string>
  headers: Record<string, string>
}

interface ReferenceBuilderProps {
  reference: {
    id: string
    name: string
    description: string | null
    inputs: any
    outputs: any
    request_config: any
    integration_id?: string
  }
  integrationBaseUrl: string
}

export function ReferenceBuilder({ reference, integrationBaseUrl }: ReferenceBuilderProps) {
  const [refName, setRefName] = useState(reference.name)
  const [refDescription, setRefDescription] = useState(reference.description ?? '')
  const [inputs, setInputs] = useState<ReferenceInput[]>(() =>
    (reference.inputs ?? []).map((inp: any) => ({ ...inp, id: inp.id ?? crypto.randomUUID() }))
  )
  const [outputs, setOutputs] = useState<ReferenceOutput[]>(() =>
    (reference.outputs ?? []).map((out: any) => ({ ...out, id: out.id ?? crypto.randomUUID() }))
  )
  const [config, setConfig] = useState<RequestConfig>(reference.request_config ?? {
    method: 'GET', path_template: '', body_template: '', query_params: {}, headers: {},
  })
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  // Response model: stored (spec / captured / table) or derived from outputs.
  const [responseSchema, setResponseSchema] = useState<ResponseSchema | null>(() => referenceResponseSchema(reference))
  const [modelOpen, setModelOpen] = useState(true)
  const [iconUrl, setIconUrl] = useState<string | null>((reference.request_config as any)?.icon_url ?? null)
  const [iconUploading, setIconUploading] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const iconInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const defaultIcon = getDefaultIcon(integrationBaseUrl)

  async function handleIconUpload(file: File) {
    if (file.size > 512 * 1024) { setNotice({ tone: 'error', message: 'Icon must be under 512KB' }); return }
    setIconUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      const result = await uploadReferenceIcon(body)
      if (!result.ok) throw new Error(result.error)
      setIconUrl(result.data.ref ?? result.data.url)
      setConfig({ ...config, icon_url: result.data.ref ?? result.data.url } as any)
    } catch (e: any) { setNotice({ tone: 'error', message: `Upload failed: ${e.message}` }) }
    setIconUploading(false)
  }

  function addInput() {
    setInputs([...inputs, {
      id: crypto.randomUUID(),
      name: '',
      type: 'string',
      default_value: '',
      required: true,
      source: 'variable',
    }])
  }

  function removeInput(id: string) {
    setInputs(inputs.filter(i => i.id !== id))
  }

  function updateInput(id: string, field: string, value: any) {
    setInputs(inputs.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function addOutput() {
    setOutputs([...outputs, {
      id: crypto.randomUUID(),
      name: '',
      path: '',
      type: 'string',
    }])
  }

  function removeOutput(id: string) {
    setOutputs(outputs.filter(o => o.id !== id))
  }

  function updateOutput(id: string, field: string, value: any) {
    setOutputs(outputs.map(o => o.id === id ? { ...o, [field]: value } : o))
  }

  // A derived (outputs-only) model follows the outputs as they are edited.
  useEffect(() => {
    if (responseSchema && responseSchema.source !== 'outputs') return
    const derived = schemaFromOutputs(outputs)
    setResponseSchema(derived ? { version: 1, source: 'outputs', root: derived } : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputs])

  /** Database operations rebuild outputs from the table's columns — the model follows. */
  function setDbOutputs(next: ReferenceOutput[]) {
    setOutputs(next)
    const derived = schemaFromOutputs(next)
    setResponseSchema(derived ? { version: 1, source: 'database', root: derived } : null)
  }

  function captureFromTest() {
    if (!testResult || testResult.error || testResult.data == null) return
    setResponseSchema(captureResponseSample(responseSchema, testResult.data))
    setNotice({ tone: 'success', message: 'Response model captured from the test response. Save to keep it.' })
  }

  function addOutputFromModel(path: string, relativePath: string) {
    const rootPath = 'response'
    const base = outputNameFor(path, rootPath)
    let name = base
    for (let i = 2; outputs.some((o) => o.name === name); i++) name = `${base}_${i}`
    const node = responseSchema ? schemaAtPath(responseSchema.root, relativePath) : null
    const type: ReferenceOutput['type'] = node?.type === 'array' ? 'array' : node?.type === 'object' ? 'object' : node?.type === 'number' || node?.type === 'integer' ? 'number' : 'string'
    setOutputs([...outputs, { id: crypto.randomUUID(), name, path: relativePath, type }])
  }

  async function handleSave() {
    setSaving(true)
    // A model derived from outputs is not stored (it is re-derived on read).
    const { response_schema: _ignored, ...requestConfig } = config as RequestConfig & { response_schema?: unknown }
    void _ignored
    await updateReference(reference.id, {
      name: refName, description: refDescription || undefined, inputs, outputs, request_config: requestConfig,
      response_schema: responseSchema && responseSchema.source !== 'outputs' ? responseSchema : null,
    })
    setSaving(false)
    setNotice({ tone: 'success', message: 'Reference saved.' })
    router.refresh()
  }

  async function handleDelete() {
    await deleteReference(reference.id)
    setNotice({ tone: 'success', message: 'Reference deleted.' })
    router.refresh()
  }

  async function handleTest() {
    setTestResult({ loading: true })
    try {
      // Build input values from defaults
      const inputValues: Record<string, string> = {}
      for (const input of inputs) {
        inputValues[input.name] = input.default_value || ''
      }
      const resp = await fetch('/api/integrations/test-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_id: reference.id,
          inputs: inputValues,
          // Backfill: a reference without a captured/spec model gets one from its first test.
          capture_schema: 'auto',
        }),
      })
      const result = await resp.json()
      setTestResult(result.error ? { error: result.error } : { status: result.status, data: result.data })
      if (!result.error && result.response_schema && (!responseSchema || ['sample', 'outputs'].includes(responseSchema.source))) {
        setResponseSchema(result.response_schema)
      }
    } catch (e: any) {
      setTestResult({ error: e.message })
    }
  }

  // Build the preview URL
  let previewUrl = integrationBaseUrl + (config.path_template || '/')
  for (const input of inputs) {
    previewUrl = previewUrl.replace(`{{${input.name}}}`, `\${${input.name}}`)
  }

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Name & Description */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium mb-1">Name</label>
          <Input value={refName} onChange={e => setRefName(e.target.value)} className="!text-xs" placeholder="Reference name" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Description</label>
          <Input value={refDescription} onChange={e => setRefDescription(e.target.value)} className="!text-xs" placeholder="Optional description" />
        </div>
      </div>

      {/* Icon */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg border flex items-center justify-center overflow-hidden shrink-0"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          {iconUrl ? (
            <img src={resolveStorageUrl(iconUrl)} alt="" className="w-6 h-6 object-contain" />
          ) : defaultIcon ? (
            <img src={defaultIcon} alt="" className="w-6 h-6 object-contain" />
          ) : (
            <Image size={14} style={{ color: 'var(--theme-muted-text)' }} />
          )}
        </div>
        <div>
          <label className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border hover:opacity-70"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
            <Upload size={10} />
            {iconUploading ? 'Uploading...' : iconUrl ? 'Change icon' : 'Upload icon'}
            <input ref={iconInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleIconUpload(f); e.target.value = '' }}
              disabled={iconUploading} />
          </label>
          {iconUrl && (
            <button onClick={() => { setIconUrl(null); setConfig({ ...config, icon_url: undefined } as any) }}
              className="ml-1 text-[9px] hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Request Config — different UI for database vs HTTP */}
      {integrationBaseUrl.match(/^(postgresql|postgres|mssql|mysql|oracle|mongodb|snowflake):\/\//) ? (
        <DbReferenceBuilder
          integrationId={reference.integration_id ?? ''}
          config={config}
          setConfig={setConfig}
          inputs={inputs}
          setInputs={setInputs}
          outputs={outputs}
          setOutputs={setDbOutputs}
          setRefName={setRefName}
          setRefDescription={setRefDescription}
        />
      ) : (
        // HTTP reference UI
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Request
          </h4>
          <div className="flex gap-2 mb-2">
            <select
              value={config.method}
              onChange={(e) => setConfig({ ...config, method: e.target.value })}
              className="rounded-lg border px-2 py-2 text-xs font-bold w-24"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
            <Input
              value={config.path_template}
              onChange={(e) => setConfig({ ...config, path_template: e.target.value })}
              placeholder="/api/v1/users/{{user_id}}"
              className="flex-1 font-mono !text-xs"
            />
          </div>
          <div className="text-[10px] font-mono px-2 py-1.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            {previewUrl}
          </div>
          {config.method !== 'GET' && (
            <div className="mt-2">
              <label className="block text-xs font-medium mb-1">Body Template (JSON with {'{{variables}}'} )</label>
              <textarea
                value={config.body_template}
                onChange={(e) => setConfig({ ...config, body_template: e.target.value })}
                placeholder={'{\n  "name": "{{name}}",\n  "email": "{{email}}"\n}'}
                rows={4}
                className="w-full rounded-lg border px-3 py-2 text-xs font-mono"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              />
            </div>
          )}
        </div>
      )}

      {/* Inputs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
            <Variable size={10} className="inline mr-1" />
            Inputs
          </h4>
          <Button variant="ghost" size="sm" onClick={addInput} className="!text-[10px] !h-6">
            <Plus size={10} className="mr-1" /> Add Input
          </Button>
        </div>
        {inputs.length === 0 ? (
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>No inputs. Add parameters that callers must provide.</p>
        ) : (
          <div className="space-y-2">
            {inputs.map(input => (
              <div key={input.id} className="flex items-center gap-1.5 text-xs" style={{ border: '1px solid var(--theme-surface-border)', borderRadius: '6px', padding: '6px' }}>
                <Input
                  value={input.name}
                  onChange={(e) => updateInput(input.id, 'name', e.target.value)}
                  placeholder="param_name"
                  className="!h-6 !text-[10px] font-mono w-24"
                />
                <select
                  value={input.type}
                  onChange={(e) => updateInput(input.id, 'type', e.target.value)}
                  className="rounded border px-1 py-0.5 text-[10px]"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="boolean">Boolean</option>
                </select>
                <select
                  value={input.source}
                  onChange={(e) => updateInput(input.id, 'source', e.target.value)}
                  className="rounded border px-1 py-0.5 text-[10px]"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                >
                  <option value="variable">Variable</option>
                  <option value="static">Static</option>
                </select>
                <Input
                  value={input.default_value}
                  onChange={(e) => updateInput(input.id, 'default_value', e.target.value)}
                  placeholder={input.source === 'static' ? 'Fixed value' : 'Default'}
                  className="!h-6 !text-[10px] flex-1"
                />
                <label className="flex items-center gap-0.5 text-[10px] shrink-0">
                  <input type="checkbox" checked={input.required} onChange={(e) => updateInput(input.id, 'required', e.target.checked)} className="rounded" />
                  Req
                </label>
                <button onClick={() => removeInput(input.id)} className="shrink-0 hover:text-red-500" style={{ color: 'var(--theme-muted-text)' }}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outputs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowRight size={10} className="inline mr-1" />
            Outputs
          </h4>
          <Button variant="ghost" size="sm" onClick={addOutput} className="!text-[10px] !h-6">
            <Plus size={10} className="mr-1" /> Add Output
          </Button>
        </div>
        {outputs.length === 0 ? (
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>No outputs. Map response values to named outputs.</p>
        ) : (
          <div className="space-y-2">
            {outputs.map(output => (
              <div key={output.id} className="flex items-center gap-1.5 text-xs" style={{ border: '1px solid var(--theme-surface-border)', borderRadius: '6px', padding: '6px' }}>
                <Input
                  value={output.name}
                  onChange={(e) => updateOutput(output.id, 'name', e.target.value)}
                  placeholder="output_name"
                  className="!h-6 !text-[10px] font-mono w-24"
                />
                <span style={{ color: 'var(--theme-muted-text)' }}>&#8592;</span>
                <Input
                  value={output.path}
                  onChange={(e) => updateOutput(output.id, 'path', e.target.value)}
                  placeholder="data.items[0].name"
                  className="!h-6 !text-[10px] font-mono flex-1"
                />
                <select
                  value={output.type}
                  onChange={(e) => updateOutput(output.id, 'type', e.target.value)}
                  className="rounded border px-1 py-0.5 text-[10px]"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="array">Array</option>
                  <option value="object">Object</option>
                </select>
                <button onClick={() => removeOutput(output.id)} className="shrink-0 hover:text-red-500" style={{ color: 'var(--theme-muted-text)' }}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Response model */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <button type="button" onClick={() => setModelOpen((v) => !v)} aria-expanded={modelOpen} className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>
            <Eye size={10} className="inline mr-1" />
            Response model
          </button>
          <span className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{describeModel(responseSchema)}</span>
          {responseSchema && responseSchema.source !== 'outputs' && (
            <Button variant="ghost" size="sm" className="!text-[10px] !h-6" onClick={() => {
              const derived = schemaFromOutputs(outputs)
              setResponseSchema(derived ? { version: 1, source: 'outputs', root: derived } : null)
            }}>
              Reset
            </Button>
          )}
        </div>
        {modelOpen && (
          <div className="space-y-1.5">
            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              The shape of the response. Workflows browse it in the data picker, so designers click fields instead of writing JSON paths.
              Run <span className="font-medium">Test</span> to capture it from a real response; + adds a named output.
            </p>
            {responseSchema ? (
              <ResponseModelTree schema={responseSchema} rootPath="response" onAddOutput={(item, relativePath) => addOutputFromModel(item.path, relativePath)} />
            ) : (
              <p className="text-[10px] rounded-lg px-2.5 py-2" style={{ color: 'var(--theme-muted-text)', backgroundColor: 'var(--theme-surface)' }}>No model yet — test the reference to capture one.</p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          <Save size={14} className="mr-1" /> {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button size="sm" variant="outline" onClick={handleTest}>
          <Play size={14} className="mr-1" /> Test
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} className="ml-auto hover:text-red-500">
          <Trash2 size={14} />
        </Button>
      </div>

      {/* Test result */}
      {testResult && !testResult.loading && (
        <div className="rounded-lg border p-3 text-xs font-mono overflow-auto max-h-48" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          {testResult.error ? (
            <span className="text-red-500">Error: {testResult.error}</span>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className={testResult.status < 400 ? 'text-green-600' : 'text-red-500'}>
                  Status: {testResult.status}
                </span>
                {testResult.status < 400 && testResult.data != null && (
                  <Button size="sm" variant="outline" className="!h-6 !text-[10px] ml-auto font-sans" onClick={captureFromTest}>
                    Capture from test response
                  </Button>
                )}
              </div>
              <pre className="mt-2 whitespace-pre-wrap" style={{ color: 'var(--theme-card-text)' }}>
                {JSON.stringify(testResult.data, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete Reference"
        description="Delete this reference? This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await handleDelete()
            setDeleteOpen(false)
          } catch (e: any) {
            setNotice({ tone: 'error', message: e?.message ?? 'Failed to delete reference' })
          }
        }}
      />
    </div>
  )
}

// ─── Database Reference Builder (auto-discovery) ───

interface DbObj { name: string; schema: string; type: 'table' | 'view' | 'procedure'; fullName: string }
interface DbParam { name: string; type: string; isOutput: boolean; hasDefault: boolean }

function DbReferenceBuilder({ integrationId, config, setConfig, inputs, setInputs, outputs, setOutputs, setRefName, setRefDescription }: {
  integrationId: string
  config: RequestConfig
  setConfig: (c: RequestConfig) => void
  inputs: ReferenceInput[]
  setInputs: (i: ReferenceInput[]) => void
  outputs: ReferenceOutput[]
  setOutputs: (o: ReferenceOutput[]) => void
  setRefName: (n: string) => void
  setRefDescription: (d: string) => void
}) {
  const [objects, setObjects] = useState<DbObj[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'table' | 'view' | 'procedure'>('all')
  const [selectedObj, setSelectedObj] = useState<DbObj | null>(null)
  const [discoveredCols, setDiscoveredCols] = useState<{ name: string; type: string; nullable?: boolean }[]>([])
  const [discoveredPK, setDiscoveredPK] = useState<string[]>([])
  const [identityCol, setIdentityCol] = useState<string | null>(null)
  const [pickingOperation, setPickingOperation] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const [browsing, setBrowsing] = useState(!config.path_template?.trim())

  // Only auto-load objects when browsing
  useEffect(() => {
    if (!integrationId || objects !== null || !browsing) return
    loadObjects()
  }, [integrationId, browsing]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadObjects() {
    setLoading(true)
    try {
      const resp = await fetch('/api/integrations/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ integration_id: integrationId, action: 'objects' }),
      })
      const data = await resp.json()
      setObjects(data.objects ?? [])
    } catch {
      setObjects([])
    }
    setLoading(false)
  }

  async function selectObject(obj: DbObj) {
    // Confirm overwrite if reference already has config
    if (config.path_template?.trim()) return

    setSelectedObj(obj)
    setConfiguring(true)

    if (obj.type === 'procedure') {
      // Stored proc — auto-discover parameters, no operation picker needed
      try {
        const resp = await fetch('/api/integrations/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integration_id: integrationId, action: 'parameters', schema: obj.schema, name: obj.name }),
        })
        const data = await resp.json()
        const params: DbParam[] = data.parameters ?? []

        const inputParams = params.filter(p => !p.isOutput)
        const paramAssignments = inputParams.map(p => `@${p.name} = @${p.name}`).join(', ')
        const sql = `EXEC ${obj.fullName}${paramAssignments ? ' ' + paramAssignments : ''}`

        setConfig({ ...config, method: 'EXEC', path_template: sql, body_template: '' })
        setInputs(inputParams.map(p => ({
          id: crypto.randomUUID(), name: p.name, type: mapDbType(p.type),
          default_value: '', required: !p.hasDefault, source: 'variable' as const,
        })))
        setRefName(`${obj.name}`)
        setRefDescription(`Execute stored procedure ${obj.fullName}`)
      } catch { /* keep manual config */ }
      setConfiguring(false)
      setBrowsing(false)
    } else {
      // Table or view — discover columns + primary key, then show operation picker
      try {
        const [colResp, pkResp] = await Promise.all([
          fetch('/api/integrations/discover', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integration_id: integrationId, action: 'columns', schema: obj.schema, name: obj.name }),
          }),
          obj.type === 'table' ? fetch('/api/integrations/discover', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ integration_id: integrationId, action: 'primary_key', schema: obj.schema, name: obj.name }),
          }) : Promise.resolve(null),
        ])
        const colData = await colResp.json()
        setDiscoveredCols(colData.columns ?? [])
        if (pkResp) {
          const pkData = await pkResp.json()
          setDiscoveredPK(pkData.primary_key ?? [])
          setIdentityCol(pkData.identity_column ?? null)
        } else {
          setDiscoveredPK([])
          setIdentityCol(null)
        }
      } catch { setDiscoveredCols([]); setDiscoveredPK([]); setIdentityCol(null) }
      setConfiguring(false)
      setPickingOperation(true)
    }
  }

  function applyOperation(obj: DbObj, operation: 'list' | 'get' | 'insert' | 'update' | 'delete') {
    const cols = discoveredCols
    const colNames = cols.map(c => c.name)
    // Use actual primary key if discovered, otherwise fall back to first column
    const pkCol = discoveredPK.length > 0 ? discoveredPK[0] : (colNames[0] || 'id')
    const pkType = cols.find(c => c.name === pkCol)?.type ?? 'string'
    // Columns excluding PK and identity (for insert)
    const isAutoIncrement = (col: string) => col === identityCol
    const nonPkCols = colNames.filter(c => c !== pkCol)

    switch (operation) {
      case 'list': {
        const sql = `SELECT * FROM ${obj.fullName} ORDER BY 1 OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
        setConfig({ ...config, method: 'POST', path_template: sql, body_template: '' })
        setInputs([
          { id: crypto.randomUUID(), name: 'limit', type: 'number', default_value: '100', required: true, source: 'static' },
          { id: crypto.randomUUID(), name: 'offset', type: 'number', default_value: '0', required: true, source: 'static' },
        ])
        setOutputs(cols.slice(0, 30).map(col => ({
          id: crypto.randomUUID(), name: col.name, path: `[].${col.name}`, type: mapDbTypeToOutput(col.type),
        })))
        setRefName(`List ${obj.name}`)
        setRefDescription(`Get rows from ${obj.fullName} with pagination`)
        break
      }
      case 'get': {
        const sql = `SELECT TOP 1 * FROM ${obj.fullName} WHERE ${pkCol} = @${pkCol}`
        setConfig({ ...config, method: 'POST', path_template: sql, body_template: '' })
        setInputs([
          { id: crypto.randomUUID(), name: pkCol, type: mapDbType(pkType), default_value: '', required: true, source: 'variable' },
        ])
        setOutputs(cols.slice(0, 30).map(col => ({
          id: crypto.randomUUID(), name: col.name, path: col.name, type: mapDbTypeToOutput(col.type),
        })))
        setRefName(`Get ${obj.name}`)
        setRefDescription(`Get a single row from ${obj.fullName} by ${pkCol}`)
        break
      }
      case 'insert': {
        // Skip identity/auto-increment columns from INSERT
        const insertCols = colNames.filter(c => !isAutoIncrement(c)).slice(0, 20)
        const placeholders = insertCols.map(c => `@${c}`).join(', ')
        const sql = `INSERT INTO ${obj.fullName} (${insertCols.join(', ')}) VALUES (${placeholders})`
        setConfig({ ...config, method: 'POST', path_template: sql, body_template: '' })
        setInputs(insertCols.map(c => {
          const col = cols.find(cc => cc.name === c)
          return {
            id: crypto.randomUUID(), name: c, type: mapDbType(col?.type ?? 'string'),
            default_value: '', required: !col?.nullable, source: 'variable' as const,
          }
        }))
        setOutputs([
          { id: crypto.randomUUID(), name: 'affected_rows', path: 'affected_rows', type: 'number' },
        ])
        setRefName(`Insert ${obj.name}`)
        setRefDescription(`Insert a new row into ${obj.fullName}`)
        break
      }
      case 'update': {
        // SET columns = everything except PK; WHERE uses PK
        const updateCols = nonPkCols.slice(0, 15)
        const setClauses = updateCols.map(c => `${c} = @${c}`).join(', ')
        const sql = `UPDATE ${obj.fullName} SET ${setClauses} WHERE ${pkCol} = @${pkCol}`
        setConfig({ ...config, method: 'POST', path_template: sql, body_template: '' })
        // Inputs: SET columns first (what user wants to change), then PK (the row identifier)
        setInputs([
          ...updateCols.map(c => {
            const col = cols.find(cc => cc.name === c)
            return {
              id: crypto.randomUUID(), name: c, type: mapDbType(col?.type ?? 'string'),
              default_value: '', required: false, source: 'variable' as const,
            }
          }),
          { id: crypto.randomUUID(), name: pkCol, type: mapDbType(pkType), default_value: '', required: true, source: 'variable' as const },
        ])
        setOutputs([
          { id: crypto.randomUUID(), name: 'affected_rows', path: 'affected_rows', type: 'number' },
        ])
        setRefName(`Update ${obj.name}`)
        setRefDescription(`Update a row in ${obj.fullName} by ${pkCol}`)
        break
      }
      case 'delete': {
        const sql = `DELETE FROM ${obj.fullName} WHERE ${pkCol} = @${pkCol}`
        setConfig({ ...config, method: 'POST', path_template: sql, body_template: '' })
        setInputs([
          { id: crypto.randomUUID(), name: pkCol, type: mapDbType(pkType), default_value: '', required: true, source: 'variable' as const },
        ])
        setOutputs([
          { id: crypto.randomUUID(), name: 'affected_rows', path: 'affected_rows', type: 'number' },
        ])
        setRefName(`Delete ${obj.name}`)
        setRefDescription(`Permanently delete a row from ${obj.fullName} by ${pkCol}`)
        break
      }
    }

    setPickingOperation(false)
    setBrowsing(false)
  }

  const filtered = (objects ?? []).filter(obj => {
    if (typeFilter !== 'all' && obj.type !== typeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return obj.name.toLowerCase().includes(q) || obj.schema.toLowerCase().includes(q)
    }
    return true
  })

  const typeIcon = (t: string) => t === 'table' ? <Table size={11} /> : t === 'view' ? <Eye size={11} /> : <Cog size={11} />
  const typeCounts = {
    table: (objects ?? []).filter(o => o.type === 'table').length,
    view: (objects ?? []).filter(o => o.type === 'view').length,
    procedure: (objects ?? []).filter(o => o.type === 'procedure').length,
  }

  return (
    <div className="space-y-2">
      {/* Source badge + browse/cancel button */}
      {!browsing && !pickingOperation && (
        <div className="flex items-center gap-2">
          {selectedObj && (
            <span className="text-[9px] font-medium px-2 py-0.5 rounded-full capitalize flex items-center gap-1"
              style={{
                backgroundColor: selectedObj.type === 'procedure' ? '#F5F3FF' : selectedObj.type === 'view' ? '#ECFEFF' : 'var(--theme-primary-light)',
                color: selectedObj.type === 'procedure' ? '#7C3AED' : selectedObj.type === 'view' ? '#0891B2' : 'var(--theme-primary-text)',
              }}>
              {typeIcon(selectedObj.type)} {selectedObj.type} — {selectedObj.fullName}
            </span>
          )}
          {!browsing && config.path_template && (
            <button onClick={() => setBrowsing(true)} className="text-[10px] hover:opacity-70 ml-auto" style={{ color: 'var(--theme-primary-text)' }}>
              Change
            </button>
          )}
        </div>
      )}
      {browsing && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Select a table, view, or stored procedure</span>
          {config.path_template && (
            <button onClick={() => { setBrowsing(false); setPickingOperation(false) }} className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
              Cancel
            </button>
          )}
        </div>
      )}

      {configuring && (
        <div className="flex items-center gap-2 py-4 justify-center" style={{ color: 'var(--theme-muted-text)' }}>
          <Loader2 size={14} className="animate-spin" />
          <span className="text-xs">Discovering schema...</span>
        </div>
      )}

      {/* Operation picker — shown after selecting a table/view */}
      {pickingOperation && selectedObj && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
            <span style={{ color: 'var(--theme-primary-text)' }}>{typeIcon(selectedObj.type)}</span>
            <span className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>{selectedObj.fullName}</span>
            <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
              {discoveredCols.length} columns{discoveredPK.length > 0 ? ` · PK: ${discoveredPK.join(', ')}` : ''}
              {identityCol ? ` · Auto: ${identityCol}` : ''}
            </span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            What operation do you want to perform?
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {([
              { op: 'list' as const, label: 'List Records', desc: 'SELECT with pagination', icon: '📋' },
              { op: 'get' as const, label: 'Get Record', desc: 'SELECT single row by key', icon: '🔍' },
              { op: 'insert' as const, label: 'Insert Record', desc: 'INSERT new row', icon: '➕' },
              { op: 'update' as const, label: 'Update Record', desc: 'UPDATE row by key', icon: '✏️' },
              { op: 'delete' as const, label: 'Delete Record', desc: 'DELETE row by key', icon: '🗑️' },
            ]).filter(o => selectedObj.type === 'view' ? ['list', 'get'].includes(o.op) : true).map(o => (
              <button key={o.op} type="button" onClick={() => applyOperation(selectedObj, o.op)}
                className="flex items-start gap-2 rounded-lg p-2.5 text-left hover:opacity-80 transition-opacity"
                style={{ backgroundColor: 'var(--theme-card-bg)', border: '1px solid var(--theme-surface-border)' }}>
                <span className="text-sm mt-0.5">{o.icon}</span>
                <div>
                  <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>{o.label}</p>
                  <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{o.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Current SQL summary — shown when object is configured and not browsing */}
      {!browsing && !selectedObj && config.path_template && (
        <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}>
          <pre className="text-[10px] font-mono whitespace-pre-wrap" style={{ color: 'var(--theme-card-text)' }}>
            {config.path_template}
          </pre>
        </div>
      )}

      {/* Object browser — shown when browsing */}
      {browsing && !configuring && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {/* Search + filter */}
          <div className="p-2 space-y-1.5" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search tables, views, procedures..."
                className="w-full rounded border pl-7 pr-2 py-1.5 text-[10px]"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
            </div>
            <div className="flex gap-1">
              {(['all', 'table', 'view', 'procedure'] as const).map(t => (
                <button key={t} onClick={() => setTypeFilter(t)}
                  className="text-[9px] font-medium px-2 py-0.5 rounded-full transition-colors"
                  style={{
                    backgroundColor: typeFilter === t ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                    color: typeFilter === t ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                  }}>
                  {t === 'all' ? `All (${(objects ?? []).length})` : `${t}s (${typeCounts[t]})`}
                </button>
              ))}
            </div>
          </div>

          {/* Object list */}
          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-1.5" style={{ color: 'var(--theme-muted-text)' }}>
                <Loader2 size={14} className="animate-spin" />
                <span className="text-xs">Discovering database objects...</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-4 text-center text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                {objects?.length === 0 ? 'No objects found. Check database permissions.' : 'No matches'}
              </div>
            ) : (
              filtered.map(obj => (
                <button key={`${obj.schema}.${obj.name}`} type="button" onClick={() => selectObject(obj)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:opacity-80 transition-opacity"
                  style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                  <span style={{ color: obj.type === 'procedure' ? '#8B5CF6' : obj.type === 'view' ? '#0891B2' : 'var(--theme-primary-text)' }}>
                    {typeIcon(obj.type)}
                  </span>
                  <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--theme-card-text)' }}>
                    {obj.name}
                  </span>
                  <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{obj.schema}</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full capitalize"
                    style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                    {obj.type}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Editable SQL — only shown when an object is selected */}
      {selectedObj && !browsing && config.path_template && (
        <details className="text-[10px]">
          <summary className="cursor-pointer font-medium" style={{ color: 'var(--theme-muted-text)' }}>
            Edit SQL
          </summary>
          <textarea
            value={config.path_template}
            onChange={(e) => setConfig({ ...config, path_template: e.target.value })}
            rows={4}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-[10px] font-mono"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          />
        </details>
      )}
    </div>
  )
}

function mapDbType(dbType: string): 'string' | 'number' | 'date' | 'boolean' {
  const t = dbType.toLowerCase()
  if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money'].some(n => t.includes(n))) return 'number'
  if (['date', 'time', 'datetime', 'timestamp'].some(n => t.includes(n))) return 'date'
  if (['bit', 'boolean', 'bool'].some(n => t.includes(n))) return 'boolean'
  return 'string'
}

function mapDbTypeToOutput(dbType: string): 'string' | 'number' | 'array' | 'object' {
  const t = dbType.toLowerCase()
  if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money'].some(n => t.includes(n))) return 'number'
  return 'string'
}
