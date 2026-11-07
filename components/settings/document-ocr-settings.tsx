'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, PlugZap, ScanText, Trash2 } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { serverQuery } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { formatRelativeDate } from '@/lib/utils'
import { removeDocumentOcrKeyAction, testDocumentOcrAction, updateDocumentOcrAction } from '@/app/actions/document-ocr'
import type { DocumentOcrView } from '@/lib/services/document-ocr'
import type { WorkspaceOcrProvider } from '@/lib/documents/ocr-settings'

/**
 * Settings → Document OCR: the OCR provider this workspace's document steps
 * use for scanned PDFs and images. The Azure key is write-only — the page
 * only ever learns whether one is saved ("•••• saved"); replace sends a new
 * one, remove deletes it. Test connection makes a free Azure call.
 */

const QUERY_KEY = ['document-ocr']
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }

const muted = { color: 'var(--theme-muted-text)' }
const fieldStyle = { borderColor: 'var(--theme-surface-border)' }

const STATUS_TONE: Record<string, Notice['tone']> = { ready: 'success', not_configured: 'warning', off: 'warning', unavailable: 'error' }

export function DocumentOcrSettings() {
  const { can } = usePermissions()
  const canView = can('settings.view')
  const canEdit = canView && can('settings.edit')
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    enabled: canView,
    queryFn: () => serverQuery('settings.documentOcr') as Promise<DocumentOcrView>,
  })

  const [provider, setProvider] = useState<WorkspaceOcrProvider>('instance_default')
  const [endpoint, setEndpoint] = useState('')
  const [apiVersion, setApiVersion] = useState('')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'remove'>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!data) return
    setProvider(data.provider)
    setEndpoint(data.azure?.endpoint ?? '')
    setApiVersion(data.azure?.api_version ?? '')
    setKey('')
    setReplacing(false)
  }, [data])

  if (!canView) {
    return <div className="max-w-3xl"><InlineNotice tone="warning" message="You need the View settings permission to see this page." /></div>
  }
  if (isLoading || !data) return <PageSkeleton variant="settings" />

  const keySaved = Boolean(data.azure?.key_saved)
  const showKeyInput = !keySaved || replacing
  const options: Array<{ value: WorkspaceOcrProvider; label: string; hint: string; disabled?: boolean }> = [
    {
      value: 'azure_document_intelligence', label: 'Azure AI Document Intelligence',
      hint: 'Your own Azure resource and key. Page images are sent to it and Azure bills your subscription (the F0 free tier reads 500 pages a month).',
    },
    ...(data.instance.tesseract_available || data.provider === 'tesseract' ? [{
      value: 'tesseract' as const, label: 'Built-in (tesseract)',
      hint: data.instance.tesseract_available ? 'Runs on this instance; pages stay here. Slower, and less accurate on poor scans.' : 'Not available on this instance.',
      disabled: !data.instance.tesseract_available,
    }] : []),
    ...(data.instance.default_allowed || data.provider === 'instance_default' ? [{
      value: 'instance_default' as const,
      label: data.instance.default_allowed ? 'Instance default' : 'Not set up',
      hint: data.instance.default_allowed ? 'Whatever this instance is configured with (DOCUMENT_OCR_PROVIDER).' : 'Document steps with OCR turned on fail until a provider is chosen.',
    }] : []),
    { value: 'off', label: 'Off', hint: 'Document steps with OCR turned on fail with a clear error.' },
  ]

  const dirty = provider !== data.provider
    || (provider === 'azure_document_intelligence' && (endpoint.trim().replace(/\/+$/, '') !== (data.azure?.endpoint ?? '') || apiVersion.trim() !== (data.azure?.api_version ?? '') || key.trim() !== ''))
  const azureReady = provider !== 'azure_document_intelligence' || (endpoint.trim() !== '' && (keySaved || key.trim() !== ''))

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    await queryClient.invalidateQueries({ queryKey: ['document-ocr-status'] })
  }

  async function save() {
    setBusy('save'); setNotice(null); setTestResult(null)
    try {
      const res = await updateDocumentOcrAction(provider === 'azure_document_intelligence'
        ? { provider, endpoint: endpoint.trim(), api_version: apiVersion.trim(), ...(key.trim() ? { key: key.trim() } : {}) }
        : { provider })
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setKey('')
      setNotice({ tone: res.data.effective.status === 'ready' ? 'success' : 'warning', message: res.data.effective.status === 'ready' ? 'Saved.' : `Saved. ${res.data.effective.message}` })
      await refresh()
    } finally { setBusy(null) }
  }

  async function test() {
    setBusy('test'); setNotice(null); setTestResult(null)
    try {
      const res = await testDocumentOcrAction({ endpoint: endpoint.trim() || null, api_version: apiVersion.trim() || null, ...(key.trim() ? { key: key.trim() } : {}) })
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setTestResult(res.data)
      await refresh()
    } finally { setBusy(null) }
  }

  async function remove() {
    setBusy('remove'); setNotice(null); setTestResult(null)
    try {
      const res = await removeDocumentOcrKeyAction()
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setConfirmRemove(false)
      setNotice({ tone: 'success', message: 'The Azure endpoint and key were removed.' })
      await refresh()
    } finally { setBusy(null) }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ScanText size={22} /> Document OCR</h1>
        <p className="text-sm mt-1" style={muted}>
          How document steps read scanned PDFs and images (Read, Convert and Redact with OCR turned on).{' '}
          <Link href="/docs/workflows/documents/ocr" className="underline underline-offset-2">Docs</Link>
        </p>
      </div>

      <InlineNotice tone={STATUS_TONE[data.effective.status] ?? 'warning'} message={data.effective.status === 'ready' ? `OCR is ready. ${data.effective.message}` : data.effective.message} />
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      <Card className="p-5 space-y-5">
        <fieldset disabled={!canEdit || busy !== null} className="space-y-2">
          <legend className="text-sm font-medium mb-1">OCR provider</legend>
          {options.map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="document-ocr-provider" value={o.value} checked={provider === o.value} disabled={o.disabled}
                onChange={() => setProvider(o.value)} className="mt-1" style={{ accentColor: 'var(--theme-primary)' }} />
              <span>
                <span className="font-medium">{o.label}</span>
                <span className="block text-xs" style={muted}>{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {provider === 'azure_document_intelligence' && (
          <div className="space-y-4 border-t pt-4" style={fieldStyle}>
            <div className="space-y-1">
              <label htmlFor="ocr-endpoint" className="block text-sm font-medium">Endpoint</label>
              <Input id="ocr-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={!canEdit || busy !== null}
                placeholder="https://my-resource.cognitiveservices.azure.com" autoComplete="off" spellCheck={false} />
              <p className="text-xs" style={muted}>Azure portal → your Document Intelligence resource → Keys and Endpoint.</p>
            </div>

            <div className="space-y-1">
              <span className="block text-sm font-medium">Key</span>
              {showKeyInput ? (
                <div className="flex items-center gap-2">
                  <Input id="ocr-key" aria-label="Key" type="password" value={key} onChange={(e) => setKey(e.target.value)} disabled={!canEdit || busy !== null}
                    placeholder={keySaved ? 'New key' : 'KEY 1 or KEY 2'} autoComplete="new-password" spellCheck={false} />
                  {replacing && <Button variant="ghost" size="sm" onClick={() => { setReplacing(false); setKey('') }}>Cancel</Button>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-mono" style={fieldStyle} data-testid="ocr-key-saved">
                    <KeyRound size={13} /> •••• saved
                  </span>
                  {canEdit && (
                    <>
                      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setReplacing(true)}>Replace</Button>
                      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmRemove(true)}><Trash2 size={13} /> Remove</Button>
                    </>
                  )}
                </div>
              )}
              <p className="text-xs" style={muted}>Stored encrypted and never shown again. It is not included in exports.</p>
            </div>

            <div className="space-y-1">
              <label htmlFor="ocr-api-version" className="block text-sm font-medium">API version <span className="font-normal" style={muted}>(optional)</span></label>
              <Input id="ocr-api-version" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} disabled={!canEdit || busy !== null}
                placeholder="2024-11-30" className="max-w-48" autoComplete="off" spellCheck={false} />
            </div>

            <p className="text-xs" style={muted}>
              Privacy: page images from document steps are sent to this Azure resource for recognition. Azure bills one page per page image.
            </p>

            {testResult && (
              <InlineNotice tone={testResult.status === 'success' ? 'success' : 'error'} message={testResult.message} onDismiss={() => setTestResult(null)} />
            )}
            {!testResult && data.azure?.last_tested_at && (
              <p className="text-xs flex items-center gap-1" style={muted}>
                {data.azure.last_test_status === 'success' && <CheckCircle2 size={12} />}
                Last test {formatRelativeDate(data.azure.last_tested_at)}: {data.azure.last_test_message}
              </p>
            )}
          </div>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={fieldStyle}>
            <Button size="sm" disabled={!dirty || !azureReady || busy !== null} onClick={() => void save()} data-testid="ocr-save">
              {busy === 'save' ? 'Saving…' : 'Save'}
            </Button>
            {provider === 'azure_document_intelligence' && (
              <Button variant="outline" size="sm" disabled={!azureReady || busy !== null} onClick={() => void test()} data-testid="ocr-test">
                <PlugZap size={13} /> {busy === 'test' ? 'Testing…' : 'Test connection'}
              </Button>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the Azure key?"
        description="Document steps with OCR turned on will fail in this workspace until a provider is set up again."
        confirmLabel="Remove"
        destructive
        busy={busy === 'remove'}
        onConfirm={() => remove()}
      />
    </div>
  )
}
