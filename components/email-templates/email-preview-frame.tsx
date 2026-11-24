'use client'

/**
 * Live email preview: the rendered template in a sandboxed iframe
 * (`sandbox=""` — no scripts, forms, popups, top navigation or same-origin
 * access; plus the CSP and sanitising of lib/email-editor/preview.ts), with
 * a toolbar for desktop / mobile width, light / dark client simulation,
 * zoom, remote images, and the inbox header (subject + preheader).
 */

import { useMemo, useState, type ReactNode } from 'react'
import { ImageOff, Image as ImageIcon, Mail, Monitor, Moon, Smartphone, Sun, ZoomIn, ZoomOut } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { buildPreviewDocument } from '@/lib/email-editor/preview'
import { cn } from '@/lib/utils'

export type PreviewDevice = 'desktop' | 'mobile'
export type PreviewScheme = 'light' | 'dark'

export interface EmailPreviewFrameProps {
  /** Rendered HTML (variables already filled). */
  html: string
  subject: string
  preheader?: string
  /** Extra toolbar content (e.g. the sample data picker). */
  toolbarExtra?: ReactNode
  className?: string
  /** Start state (screenshots, tests). */
  initialDevice?: PreviewDevice
  initialScheme?: PreviewScheme
}

const ZOOMS = [50, 75, 90, 100, 125] as const

export function EmailPreviewFrame({ html, subject, preheader, toolbarExtra, className, initialDevice = 'desktop', initialScheme = 'light' }: EmailPreviewFrameProps) {
  const [device, setDevice] = useState<PreviewDevice>(initialDevice)
  const [scheme, setScheme] = useState<PreviewScheme>(initialScheme)
  const [zoom, setZoom] = useState<number>(100)
  const [envelope, setEnvelope] = useState(true)
  const [remoteImages, setRemoteImages] = useState(true)
  const doc = useMemo(
    () => buildPreviewDocument(html, { dark: scheme === 'dark', remoteImages, envelope: envelope ? { subject, preheader } : null }),
    [html, scheme, remoteImages, envelope, subject, preheader],
  )
  const width = device === 'mobile' ? 375 : 720
  const scale = zoom / 100
  const zoomIndex = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number])

  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-email-preview="">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-3 py-2">
        <SegmentedControl<PreviewDevice>
          size="sm" aria-label="Preview width" value={device} onValueChange={setDevice}
          options={[{ value: 'desktop', icon: <Monitor />, label: 'Desktop' }, { value: 'mobile', icon: <Smartphone />, label: 'Mobile' }]}
        />
        <SegmentedControl<PreviewScheme>
          size="sm" aria-label="Email client colour scheme" value={scheme} onValueChange={setScheme}
          options={[{ value: 'light', icon: <Sun />, label: 'Light' }, { value: 'dark', icon: <Moon />, label: 'Dark mode (simulated)' }]}
        />
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" label="Zoom out" icon={<ZoomOut />} disabled={zoomIndex <= 0} onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])} />
          <span className="num w-10 text-center text-xs text-fg-muted" aria-live="polite">{zoom}%</span>
          <IconButton size="sm" label="Zoom in" icon={<ZoomIn />} disabled={zoomIndex >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])} />
        </div>
        <IconButton size="sm" label={envelope ? 'Hide subject & preheader' : 'Show subject & preheader'} icon={<Mail />} aria-pressed={envelope} onClick={() => setEnvelope((v) => !v)} variant={envelope ? 'secondary' : 'ghost'} />
        <IconButton size="sm" label={remoteImages ? 'Block remote images' : 'Load remote images'} icon={remoteImages ? <ImageIcon /> : <ImageOff />} aria-pressed={remoteImages} onClick={() => setRemoteImages((v) => !v)} variant={remoteImages ? 'secondary' : 'ghost'} />
        {toolbarExtra && <div className="ml-auto flex items-center gap-2">{toolbarExtra}</div>}
      </div>
      <div className={cn('min-h-0 flex-1 overflow-x-auto p-4', scheme === 'dark' ? 'bg-[#111]' : 'bg-muted')}>
        {/* Scaled with a transform; the wrapper takes the scaled size so the page lays out around it. */}
        <div className="mx-auto h-full min-h-[480px] overflow-hidden rounded-lg shadow-elev-1" style={{ width: width * scale }}>
          <div style={{ width, height: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <iframe
              title="Email preview"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={doc}
              className="block h-full w-full border-0"
              style={{ backgroundColor: scheme === 'dark' ? '#1f1f1f' : '#ffffff' }}
              data-email-preview-frame=""
            />
          </div>
        </div>
      </div>
    </div>
  )
}
