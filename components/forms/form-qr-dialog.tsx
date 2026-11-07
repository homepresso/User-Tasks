'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Download, QrCode, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'
import { cn } from '@/lib/utils'
import { FORM_PARAM_TYPE_LABELS, type FormParam } from '@/lib/forms/form-params'
import { iframeSnippet, resizeScriptSnippet } from '@/lib/forms/embed'

/**
 * The QR code of a form page link: shown in a dialog (always dark modules
 * on a white card, whatever the theme), with Download PNG / SVG — plain or
 * with the form's name and the link as a caption — and Copy link. The SVG
 * is drawn on the server (`forms.qr`, lib/forms/qr.ts); the PNG is that SVG
 * rasterised in the browser.
 *
 * A form with URL parameters (lib/forms/form-params.ts) gets a link
 * builder: fill in values and the link and its QR code carry them
 * (/f/<id>?customer=ALFKI). The server builds the link, so only declared
 * parameters make it in.
 *
 * Embed: the iframe snippet of the chosen link (?embed=1 — the form on its
 * own, transparent, auto-height) and the optional host-page resize script
 * (lib/forms/embed.ts).
 *
 * The friendly link comes first when the workspace has an address
 * (https://acme.usertasks.com/form/employee-onboarding); the /f/<id> page
 * and the public /p/<token> link are listed under it.
 */

type LinkKind = 'friendly' | 'signed_in' | 'anonymous'
const KIND_LABELS: Record<LinkKind, string> = { friendly: 'Friendly link', signed_in: 'Form page link', anonymous: 'Public link (anonymous)' }

const PNG_MIN_SIDE = 1024

function fileStem(name: string | null | undefined): string {
  const slug = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'form'
}

function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** The SVG drawn on a canvas at ≥ 1024 px (whole pixels per module), as a PNG blob. */
async function svgToPng(svg: string): Promise<Blob> {
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('The QR code could not be drawn'))
    img.src = svgDataUrl(svg)
  })
  const width = img.naturalWidth || 328
  const height = img.naturalHeight || width
  const factor = Math.max(1, Math.ceil(PNG_MIN_SIDE / width))
  const canvas = document.createElement('canvas')
  canvas.width = width * factor
  canvas.height = height * factor
  const g = canvas.getContext('2d')
  if (!g) throw new Error('The QR code could not be drawn')
  g.imageSmoothingEnabled = false
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(img, 0, 0, canvas.width, canvas.height)
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The PNG could not be made'))), 'image/png'))
}

export function FormQrDialog({ formId, open, onOpenChange, anonymous: startAnonymous = false }: { formId: string; open: boolean; onOpenChange: (open: boolean) => void; anonymous?: boolean }) {
  const [caption, setCaption] = useState(true)
  // Which link: null = the server's default (the friendly link when there is one, else /f/<id>).
  const [kind, setKind] = useState<LinkKind | null>(startAnonymous ? 'anonymous' : null)
  const [copiedOther, setCopiedOther] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The link builder's values, applied after a short pause (the server redraws the code).
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [applied, setApplied] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setTimeout(() => setApplied(Object.fromEntries(Object.entries(paramValues).filter(([, v]) => v.trim()))), 350)
    return () => clearTimeout(t)
  }, [paramValues])
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['form-qr', formId, applied, kind],
    enabled: open,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const result = await serverRead('forms.qr', { form_id: formId, ...(Object.keys(applied).length ? { params: applied } : {}), ...(kind ? { kind } : {}) })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const params: FormParam[] = data?.params ?? []
  const current: LinkKind = data?.kind ?? kind ?? 'signed_in'
  const kinds = data ? (['friendly', 'signed_in', 'anonymous'] as LinkKind[]).filter((k) => Boolean(data.links?.[k])) : []
  const others = data ? kinds.filter((k) => k !== current).map((k) => ({ kind: k, url: data.links[k]! })) : []
  const svg = data ? (caption ? data.captioned_svg : data.svg) : null
  const stem = `${fileStem(data?.name)}-qr${caption ? '' : '-code'}`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" data-form-qr-dialog />
        <Dialog.Content aria-describedby={undefined} data-form-qr-dialog
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          className={`fixed left-1/2 top-1/2 z-50 ${params.length ? 'w-[min(34rem,94vw)]' : 'w-[min(24rem,92vw)]'} max-h-[92vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl dialog-content bg-panel text-fg`}
         >
          <div className="mb-3 flex items-center gap-2">
            <QrCode size={15} aria-hidden />
            <Dialog.Title className="flex-1 truncate text-sm font-semibold">QR code{data?.name ? ` — ${data.name}` : ''}</Dialog.Title>
            <Dialog.Close aria-label="Close"><X size={14} /></Dialog.Close>
          </div>
          {isLoading || (!data && !loadError) ? (
            <div className="mx-auto aspect-square w-56 animate-pulse rounded-lg bg-bg" />
          ) : loadError || !data || !svg ? (
            <p className="text-xs text-danger">{loadError instanceof Error ? loadError.message : 'The QR code could not be made'}</p>
          ) : (
            <div className="space-y-3">
              {/* A white card in every theme: scanners need dark modules on light. */}
              <div className="mx-auto w-fit rounded-lg border p-2 border-border" style={{ backgroundColor: 'white' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL, not an optimisable asset */}
                <img src={svgDataUrl(svg)} alt={`QR code for ${data.url}`} className="block h-auto w-56 max-w-full" data-form-qr-image />
              </div>
              {kinds.length > 1 && (
                <div className="flex flex-wrap justify-center gap-1 text-2xs" role="radiogroup" aria-label="Which link" data-form-qr-link-kind>
                  {kinds.map((k) => (
                    <button key={k} type="button" role="radio" aria-checked={current === k} onClick={() => setKind(k)}
                      className={cn('rounded-full border border-border px-2 py-0.5', current === k && 'bg-primary-wash font-semibold')}
                      data-form-qr-anonymous={k === 'anonymous' ? 'public' : k === 'signed_in' ? 'signed-in' : undefined}
                      data-form-qr-kind={k}>{KIND_LABELS[k]}</button>
                  ))}
                </div>
              )}
              <code className="block break-all rounded px-1.5 py-1 text-center font-mono text-2xs select-all bg-bg" data-form-qr-url>{data.url}</code>
              {current === 'friendly' && <p className="text-center text-2xs text-fg-muted">Signed-in members open the form here. Visitors need &ldquo;Allow friendly public link&rdquo; on the form&rsquo;s anonymous settings.</p>}
              {params.length > 0 && (
                <fieldset className="rounded-lg border px-3 py-2 border-border" data-form-link-builder>
                  <legend className="px-1 text-xs font-medium">Link with parameters</legend>
                  <p className="mb-2 text-2xs text-fg-muted">Fill in values to put them in the link and the code. Leave one empty to use its default.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {params.map((p) => (
                      <label key={p.name} className="block text-2xs">
                        <span className="font-medium">{p.label ?? p.name}{p.required && <span className="text-danger" aria-hidden> *</span>}</span>
                        <span className="ml-1 font-mono opacity-70">?{p.query_name ?? p.name}=</span>
                        <input type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'} value={paramValues[p.name] ?? ''}
                          placeholder={p.default ?? (p.type === 'text_list' ? 'a, b' : p.type === 'boolean' ? 'true / false' : FORM_PARAM_TYPE_LABELS[p.type])}
                          onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: e.target.value }))} data-form-link-param={p.name}
                          className="mt-0.5 h-8 w-full rounded-md border px-2 text-xs border-border bg-input text-fg" />
                      </label>
                    ))}
                  </div>
                  {params.some((p) => p.required && !p.default && !(applied[p.name] ?? '').trim()) && (
                    <p className="mt-2 text-2xs text-danger">The form needs every required parameter: without one it shows a message instead of the form.</p>
                  )}
                </fieldset>
              )}
              {others.length > 0 && (
                <div className="space-y-1 border-t border-border-subtle pt-2" data-form-qr-other-links>
                  <p className="text-2xs font-medium text-fg-muted">Other links</p>
                  {others.map((o) => (
                    <div key={o.kind} className="flex items-center gap-2 text-2xs" data-form-qr-other={o.kind}>
                      <span className="w-28 shrink-0 text-fg-muted">{KIND_LABELS[o.kind]}</span>
                      <code className="min-w-0 flex-1 truncate font-mono select-all" title={o.url}>{o.url}</code>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Copy the ${KIND_LABELS[o.kind].toLowerCase()}`} onClick={async () => {
                        try { await navigator.clipboard.writeText(o.url); setCopiedOther(o.kind); setTimeout(() => setCopiedOther(null), 1500) } catch { setError('Could not copy the link') }
                      }}>
                        {copiedOther === o.kind ? <Check size={12} /> : <Copy size={12} />}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <EmbedSnippet url={data.url} title={data.name ?? 'Form'} signedIn={current !== 'anonymous'} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} data-form-qr-caption />
                Include the form name and link under the code
              </label>
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" data-form-qr-copy onClick={async () => {
                  try { await navigator.clipboard.writeText(data.url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setError('Could not copy the link') }
                }}>
                  {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button type="button" size="sm" variant="outline" data-form-qr-download="svg" onClick={() => {
                  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
                  download(url, `${stem}.svg`)
                  setTimeout(() => URL.revokeObjectURL(url), 10_000)
                }}>
                  <Download size={12} /> SVG
                </Button>
                <Button type="button" size="sm" data-form-qr-download="png" onClick={async () => {
                  setError(null)
                  try {
                    const url = URL.createObjectURL(await svgToPng(svg))
                    download(url, `${stem}.png`)
                    setTimeout(() => URL.revokeObjectURL(url), 10_000)
                  } catch (e) { setError(e instanceof Error ? e.message : 'The PNG could not be made') }
                }}>
                  <Download size={12} /> PNG
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Embed: the iframe snippet (and the optional resize script) for a form link, with Copy. */
function EmbedSnippet({ url, title, signedIn }: { url: string; title: string; signedIn: boolean }) {
  const [copied, setCopied] = useState<'iframe' | 'script' | null>(null)
  const snippet = iframeSnippet(url, title)
  let origin = ''
  try { origin = new URL(url).origin } catch { origin = '' }
  const script = origin ? resizeScriptSnippet(origin) : ''
  async function copy(kind: 'iframe' | 'script', text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(kind); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <details className="rounded-lg border border-border px-3 py-2 text-2xs" data-form-embed>
      <summary className="cursor-pointer text-xs font-medium">Embed in a website</summary>
      <div className="mt-2 space-y-2">
        <p className="text-fg-muted">Paste this where the form should appear. It shows the form alone, without a page background.</p>
        <textarea readOnly value={snippet} rows={3} aria-label="iframe code" className="w-full resize-none rounded-md border border-border bg-bg p-2 font-mono text-2xs" data-form-embed-code onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" size="sm" variant="outline" onClick={() => void copy('iframe', snippet)} data-form-embed-copy>
          {copied === 'iframe' ? <Check size={12} /> : <Copy size={12} />} {copied === 'iframe' ? 'Copied' : 'Copy embed code'}
        </Button>
        {script && (
          <>
            <p className="text-fg-muted">Optional: add this script once to the page so the frame grows and shrinks with the form.</p>
            <textarea readOnly value={script} rows={4} aria-label="Resize script" className="w-full resize-none rounded-md border border-border bg-bg p-2 font-mono text-2xs" onFocus={(e) => e.currentTarget.select()} />
            <Button type="button" size="sm" variant="ghost" onClick={() => void copy('script', script)} data-form-embed-copy-script>
              {copied === 'script' ? <Check size={12} /> : <Copy size={12} />} {copied === 'script' ? 'Copied' : 'Copy script'}
            </Button>
          </>
        )}
        {signedIn && <p className="text-fg-muted">When this link needs sign-in: browsers don&apos;t keep sign-ins inside other websites, so visitors get a button to open the form in a new tab. Use the public link to let people fill it in right on your page.</p>}
      </div>
    </details>
  )
}

/** "QR code" button that opens the dialog. */
export function FormQrButton({ formId, compact = false, label = 'QR code', className, anonymous = false }: { formId: string; compact?: boolean; label?: string; className?: string; /** Open on the public (anonymous) link. */ anonymous?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {compact ? (
        <button type="button" className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium hover:opacity-80 ${className ?? ''} text-primary-text`}
          aria-label="Show the QR code of the form link" data-form-qr-button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}>
          <QrCode size={11} /> {label}
        </button>
      ) : (
        <Button type="button" size="sm" variant="ghost" className={className} aria-label="Show the QR code of the form link" title="QR code" data-form-qr-button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}>
          <QrCode size={12} />
        </Button>
      )}
      <FormQrDialog formId={formId} open={open} onOpenChange={setOpen} anonymous={anonymous} />
    </>
  )
}
