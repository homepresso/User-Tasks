'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Copy, Download, QrCode, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { serverRead } from '@/lib/server-read'

/**
 * The QR code of a form page link: shown in a dialog (always dark modules
 * on a white card, whatever the theme), with Download PNG / SVG — plain or
 * with the form's name and the link as a caption — and Copy link. The SVG
 * is drawn on the server (`forms.qr`, lib/forms/qr.ts); the PNG is that SVG
 * rasterised in the browser.
 */

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

export function FormQrDialog({ formId, open, onOpenChange }: { formId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [caption, setCaption] = useState(true)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['form-qr', formId],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const result = await serverRead('forms.qr', { form_id: formId })
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
  })
  const svg = data ? (caption ? data.captioned_svg : data.svg) : null
  const stem = `${fileStem(data?.name)}-qr${caption ? '' : '-code'}`

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" data-form-qr-dialog />
        <Dialog.Content aria-describedby={undefined} data-form-qr-dialog
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
          <div className="mb-3 flex items-center gap-2">
            <QrCode size={15} aria-hidden />
            <Dialog.Title className="flex-1 truncate text-sm font-semibold">QR code{data?.name ? ` — ${data.name}` : ''}</Dialog.Title>
            <Dialog.Close aria-label="Close"><X size={14} /></Dialog.Close>
          </div>
          {isLoading || (!data && !loadError) ? (
            <div className="mx-auto aspect-square w-56 animate-pulse rounded-lg" style={{ backgroundColor: 'var(--theme-surface)' }} />
          ) : loadError || !data || !svg ? (
            <p className="text-xs" style={{ color: 'var(--status-blocked)' }}>{loadError instanceof Error ? loadError.message : 'The QR code could not be made'}</p>
          ) : (
            <div className="space-y-3">
              {/* A white card in every theme: scanners need dark modules on light. */}
              <div className="mx-auto w-fit rounded-lg border p-2" style={{ backgroundColor: '#ffffff', borderColor: 'var(--theme-surface-border)' }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL, not an optimisable asset */}
                <img src={svgDataUrl(svg)} alt={`QR code for ${data.url}`} className="block h-auto w-56 max-w-full" data-form-qr-image />
              </div>
              <code className="block break-all rounded px-1.5 py-1 text-center font-mono text-[11px] select-all" style={{ backgroundColor: 'var(--theme-surface)' }}>{data.url}</code>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} data-form-qr-caption />
                Include the form name and link under the code
              </label>
              {error && <p className="text-xs" style={{ color: 'var(--status-blocked)' }}>{error}</p>}
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

/** "QR code" button that opens the dialog. */
export function FormQrButton({ formId, compact = false, label = 'QR code', className }: { formId: string; compact?: boolean; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {compact ? (
        <button type="button" className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80 ${className ?? ''}`}
          style={{ color: 'var(--theme-primary-text)' }} aria-label="Show the QR code of the form link" data-form-qr-button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}>
          <QrCode size={11} /> {label}
        </button>
      ) : (
        <Button type="button" size="sm" variant="ghost" className={className} aria-label="Show the QR code of the form link" title="QR code" data-form-qr-button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}>
          <QrCode size={12} />
        </Button>
      )}
      <FormQrDialog formId={formId} open={open} onOpenChange={setOpen} />
    </>
  )
}
