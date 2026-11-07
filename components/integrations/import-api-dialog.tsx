'use client'

import { useState, useRef } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Upload, FileJson, Globe, Key, CheckCircle, XCircle, Loader2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { parseApiSpec, detectFormat, type ParsedIntegration, type ParsedReference } from '@/lib/api-spec-parser'
import { createImportedApiIntegration } from '@/app/actions/integrations'
import { useRouter } from 'next/navigation'

interface ImportApiDialogProps {
  open: boolean
  onClose: () => void
}

export function ImportApiDialog({ open, onClose }: ImportApiDialogProps) {
  const [step, setStep] = useState<'upload' | 'configure' | 'importing'>('upload')
  const [parsed, setParsed] = useState<ParsedIntegration | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [format, setFormat] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Editable config
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [authType, setAuthType] = useState<string>('none')
  const [authConfig, setAuthConfig] = useState<Record<string, string>>({})
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [selectedRefs, setSelectedRefs] = useState<Set<number>>(new Set())
  const [expandedRef, setExpandedRef] = useState<number | null>(null)
  // "Start empty": no references now — every operation stays available to the custom reference builder.
  const [startEmpty, setStartEmpty] = useState(false)
  const [refQuery, setRefQuery] = useState('')

  // Import progress
  const [importing, setImporting] = useState(false)
  // Synchronous guard: two clicks in one frame both start an import.
  const importGuard = useSubmitGuard()
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [importResult, setImportResult] = useState<{ success: boolean; integrationId?: string; refCount?: number; error?: string } | null>(null)

  function processFile(file: File) {
    setError(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      try {
        const fmt = detectFormat(content)
        setFormat(fmt === 'openapi2' ? 'Swagger 2.0' : fmt === 'openapi3' ? 'OpenAPI 3.0' : fmt === 'postman' ? 'Postman Collection' : 'Unknown')

        if (fmt === 'unknown') {
          setError('Unsupported format. Please provide OpenAPI 2.0, OpenAPI 3.0, or Postman Collection in JSON or YAML.')
          return
        }

        const result = parseApiSpec(content)
        setParsed(result)
        setName(result.name)
        setBaseUrl(result.baseUrl)
        setAuthType(result.authType === 'oauth2' ? 'none' : result.authType)
        setAuthConfig(Object.fromEntries(Object.entries(result.authConfig).map(([k, v]) => [k, String(v ?? '')])))
        setSelectedRefs(new Set(result.references.map((_, i) => i)))
        setStep('configure')
      } catch (err: any) {
        setError(err.message || 'Failed to parse file')
      }
    }
    reader.readAsText(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  async function handleImport() {
    await importGuard.run(async () => {
      if (!parsed) return
      setImporting(true)
      setStep('importing')
      setImportResult(null)

      const refsToImport = startEmpty ? [] : parsed.references.filter((_, i) => selectedRefs.has(i))
      setImportProgress({ done: 0, total: refsToImport.length })

      try {
        // Build integration config
        const integrationConfig: Record<string, any> = {
          base_url: baseUrl,
          auth_type: authType,
          auth_config: {},
          headers: {},
        }

        if (authType === 'api_key') {
          integrationConfig.auth_config = { key_name: authConfig.key_name || 'X-API-Key', key_value: authConfig.key_value || '' }
        } else if (authType === 'bearer') {
          integrationConfig.auth_config = { token: authConfig.token || '' }
        } else if (authType === 'basic') {
          integrationConfig.auth_config = { username: authConfig.username || '', password: authConfig.password || '' }
        }

        const result = await createImportedApiIntegration({
          name,
          baseUrl,
          authType: authType as 'none' | 'api_key' | 'bearer' | 'basic',
          authConfig: integrationConfig.auth_config,
          tags,
          // Every parsed operation is stored on the integration for custom references.
          operations: parsed.references.map((ref) => ({
            name: ref.name,
            description: ref.description,
            method: ref.method,
            pathTemplate: ref.pathTemplate,
            bodyTemplate: ref.bodyTemplate,
            headers: ref.headers,
            inputs: ref.inputs.map((inp) => ({ ...inp })),
            responseSchema: ref.responseSchema,
          })),
          references: refsToImport.map((ref) => ({
            name: ref.name,
            description: ref.description,
            method: ref.method,
            pathTemplate: ref.pathTemplate,
            bodyTemplate: ref.bodyTemplate,
            headers: ref.headers,
            tags: ref.tags,
            inputs: ref.inputs.map(inp => ({
              id: crypto.randomUUID(),
              name: inp.name,
              type: inp.type,
              required: inp.required,
              default_value: inp.default_value,
              source: 'variable',
              location: inp.location ?? 'query',
            })),
            outputs: ref.outputs.map(out => ({
              id: crypto.randomUUID(),
              name: out.name,
              path: out.path,
              type: out.type,
            })),
            responseSchema: ref.responseSchema,
          })),
        })
        setImportProgress({ done: result.refCount, total: refsToImport.length })
        setImportResult({ success: true, integrationId: result.integrationId, refCount: result.refCount })
      } catch (err: any) {
        setImportResult({ success: false, error: err.message })
      }

      setImporting(false)
    })
  }

  function handleDone() {
    if (importResult?.integrationId) {
      router.push(`/integrations/${importResult.integrationId}`)
      router.refresh()
    }
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div
        className="w-[90vw] max-w-3xl max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden bg-panel border-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-primary-text" />
            <span className="text-sm font-semibold">Import API Specification</span>
            {format && (
              <span className="text-2xs px-2 py-0.5 rounded-full bg-primary-wash text-primary-text">
                {format}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70 text-fg-muted">
            <XCircle size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors hover:opacity-80"
                style={{
                  borderColor: dragOver ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                  backgroundColor: dragOver ? 'var(--theme-primary-light)' : 'transparent',
                }}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                <FileJson size={40} className="mx-auto mb-3 text-fg-muted" />
                <p className="text-sm font-medium">Drop a file or click to browse</p>
                <p className="text-xs mt-1 text-fg-muted">
                  Supports OpenAPI 2.0 (Swagger), OpenAPI 3.0/3.1, Postman Collection v2.x
                </p>
                <p className="text-2xs mt-2 text-fg-muted">
                  JSON or YAML
                </p>
                <input ref={fileRef} type="file" accept=".json,.yaml,.yml" className="hidden" onChange={handleFile} />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-danger-wash p-3 text-sm text-danger">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 'configure' && parsed && (
            <div className="space-y-5">
              {/* Integration details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Integration</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium mb-1 block">Name</label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="!text-xs" />
                  </div>
                  <div>
                    <label className="text-xs font-medium mb-1 block">Base URL</label>
                    <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="!text-xs font-mono" />
                  </div>
                </div>
                {parsed.description && (
                  <p className="text-2xs text-fg-muted">{parsed.description.slice(0, 200)}</p>
                )}
                {/* Tags */}
                <div>
                  <label className="text-xs font-medium mb-1 block">Tags</label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {tags.map(tag => (
                      <span key={tag} className="flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-primary-wash text-primary-text">
                        {tag}
                        <button onClick={() => setTags(t => t.filter(x => x !== tag))} className="hover:opacity-70">
                          <XCircle size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Input value={tagInput} onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); setTags(t => [...new Set([...t, tagInput.trim()])]); setTagInput('') } }}
                      placeholder="Add tag and press Enter" className="!text-xs !h-7 flex-1" />
                  </div>
                </div>
              </div>

              {/* Auth */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 text-fg-muted">
                  <Key size={12} /> Authentication
                </h3>
                <select value={authType} onChange={e => setAuthType(e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-xs bg-panel border-border text-fg">
                  <option value="none">No Authentication</option>
                  <option value="api_key">API Key</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                </select>

                {authType === 'api_key' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Header Name</label>
                      <Input value={authConfig.key_name ?? 'X-API-Key'} onChange={e => setAuthConfig(p => ({ ...p, key_name: e.target.value }))} className="!text-xs font-mono" />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">API Key</label>
                      <Input value={authConfig.key_value ?? ''} onChange={e => setAuthConfig(p => ({ ...p, key_value: e.target.value }))} type="password" className="!text-xs font-mono" placeholder="Enter API key" />
                    </div>
                  </div>
                )}
                {authType === 'bearer' && (
                  <div>
                    <label className="text-xs font-medium mb-1 block">Token</label>
                    <Input value={authConfig.token ?? ''} onChange={e => setAuthConfig(p => ({ ...p, token: e.target.value }))} type="password" className="!text-xs font-mono" placeholder="Enter bearer token" />
                  </div>
                )}
                {authType === 'basic' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium mb-1 block">Username</label>
                      <Input value={authConfig.username ?? ''} onChange={e => setAuthConfig(p => ({ ...p, username: e.target.value }))} className="!text-xs font-mono" />
                    </div>
                    <div>
                      <label className="text-xs font-medium mb-1 block">Password</label>
                      <Input value={authConfig.password ?? ''} onChange={e => setAuthConfig(p => ({ ...p, password: e.target.value }))} type="password" className="!text-xs font-mono" />
                    </div>
                  </div>
                )}
              </div>

              {/* References list */}
              <div className="space-y-2">
                <label className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" data-testid="import-start-empty"
                  style={{ borderColor: startEmpty ? 'var(--theme-primary)' : 'var(--theme-surface-border)', backgroundColor: startEmpty ? 'var(--theme-primary-light)' : undefined }}>
                  <input type="checkbox" className="mt-0.5" checked={startEmpty} onChange={(e) => setStartEmpty(e.target.checked)} />
                  <span>
                    <span className="font-medium">Start empty</span>
                    <span className="block text-2xs text-fg-muted">
                      Create no references now and build tidy custom ones (columns, filters, sort, inputs). All {parsed.references.length} operations stay available to the custom reference builder.
                    </span>
                  </span>
                </label>
                {!startEmpty && (
                <input value={refQuery} onChange={(e) => setRefQuery(e.target.value)} placeholder="Search operations…" data-testid="import-search"
                  className="h-7 w-full rounded border px-2 text-xs outline-none border-border bg-panel" />
                )}
                {!startEmpty && <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                    References ({selectedRefs.size}/{parsed.references.length} selected)
                  </h3>
                  <div className="flex gap-2">
                    <button onClick={() => setSelectedRefs(new Set(parsed.references.map((_, i) => i)))} className="text-2xs underline text-primary-text">Select All</button>
                    <button onClick={() => setSelectedRefs(new Set())} className="text-2xs underline text-fg-muted">Clear</button>
                  </div>
                </div>}

                {!startEmpty && <div className="max-h-[280px] overflow-y-auto rounded-lg border border-border">
                  {parsed.references.map((ref, i) => {
                    if (refQuery.trim() && !`${ref.name} ${ref.method} ${ref.pathTemplate} ${ref.description ?? ''}`.toLowerCase().includes(refQuery.trim().toLowerCase())) return null
                    const isSelected = selectedRefs.has(i)
                    const isExpanded = expandedRef === i
                    const methodColors: Record<string, string> = { GET: 'bg-success-wash text-success', POST: 'bg-info-wash text-info', PUT: 'bg-warning-wash text-warning', DELETE: 'bg-danger-wash text-danger', PATCH: 'bg-primary-wash text-primary-text' }
                    return (
                      <div key={i} style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                        <div className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-90"
                          onClick={() => setExpandedRef(isExpanded ? null : i)}>
                          <input type="checkbox" checked={isSelected}
                            onChange={() => {
                              const next = new Set(selectedRefs)
                              isSelected ? next.delete(i) : next.add(i)
                              setSelectedRefs(next)
                            }}
                            onClick={e => e.stopPropagation()}
                            className="shrink-0"
                          />
                          <span className={`text-2xs font-mono font-semibold px-1.5 py-0.5 rounded shrink-0 ${methodColors[ref.method] ?? 'bg-muted text-fg-muted'}`}>
                            {ref.method}
                          </span>
                          <span className="text-xs font-medium flex-1 truncate">{ref.name}</span>
                          <span className="text-2xs font-mono truncate max-w-[200px] text-fg-muted">
                            {ref.pathTemplate}
                          </span>
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </div>

                        {isExpanded && (
                          <div className="px-3 pb-2 ml-7 space-y-1 text-2xs text-fg-muted">
                            {ref.description && <p>{ref.description.slice(0, 150)}</p>}
                            {ref.inputs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                <span className="font-semibold">Inputs:</span>
                                {ref.inputs.map(inp => (
                                  <span key={inp.name} className="font-mono px-1 py-0.5 rounded bg-bg">
                                    {inp.name}{inp.required ? '*' : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                            {ref.outputs.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                <span className="font-semibold">Outputs:</span>
                                {ref.outputs.map(out => (
                                  <span key={out.name} className="font-mono px-1 py-0.5 rounded bg-bg">
                                    {out.name}
                                  </span>
                                ))}
                              </div>
                            )}
                            {ref.tags.length > 0 && (
                              <div className="flex gap-1">
                                {ref.tags.map(t => (
                                  <span key={t} className="px-1.5 py-0.5 rounded-full bg-primary-wash text-primary-text">{t}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>}
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              {importing ? (
                <>
                  <Loader2 size={32} className="animate-spin mb-4 text-primary-text" />
                  <p className="text-sm font-medium">Importing references...</p>
                  <p className="text-xs mt-1 text-fg-muted">
                    {importProgress.done} / {importProgress.total}
                  </p>
                  <div className="w-48 h-1.5 rounded-full mt-3 bg-bg">
                    <div className="h-full rounded-full transition-all" style={{
                      backgroundColor: 'var(--theme-primary)',
                      width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%`,
                    }} />
                  </div>
                </>
              ) : importResult?.success ? (
                <>
                  <CheckCircle size={40} className="mb-4 text-success" />
                  <p className="text-sm font-semibold">Import Complete</p>
                  <p className="text-xs mt-1 text-fg-muted">
                    Created integration with {importResult.refCount} references
                  </p>
                  <Button size="sm" onClick={handleDone} className="mt-4">
                    <Globe size={14} className="mr-1" /> View Integration
                  </Button>
                </>
              ) : (
                <>
                  <XCircle size={40} className="mb-4 text-danger" />
                  <p className="text-sm font-semibold">Import Failed</p>
                  <p className="text-xs mt-1 text-danger">
                    {importResult?.error ?? 'Unknown error'}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setStep('configure')} className="mt-4">
                    Back
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'configure' && (
          <div className="px-5 py-3 shrink-0 flex items-center justify-between" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
            <button onClick={() => { setStep('upload'); setParsed(null); setError(null) }}
              className="text-xs underline text-fg-muted">
              Upload Different File
            </button>
            <Button size="sm" onClick={handleImport} disabled={(!startEmpty && selectedRefs.size === 0) || !name.trim() || !baseUrl.trim()} data-testid="import-submit">
              <Upload size={14} className="mr-1" /> {startEmpty ? 'Create integration (start empty)' : `Import ${selectedRefs.size} Reference${selectedRefs.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
