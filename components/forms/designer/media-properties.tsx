'use client'

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { uploadFormImage } from '@/app/actions/forms'
import type { DesignerField } from '@/lib/forms/designer-state'
import {
  DISPLAY_IMAGE_ALIGNS, DISPLAY_IMAGE_WIDTHS, displayImageSrcProblem, IMAGE_DEFAULT_MAX_MB, IMAGE_FORMAT_LABELS, IMAGE_FORMATS, IMAGE_MAX_MB,
  imageFormats, SIGNATURE_DISCLAIMER, SIGNATURE_MODES,
  type DisplayImageConfig, type ImageFieldConfig, type ImageFormat, type SignatureFieldConfig, type SignatureMode,
} from '@/lib/forms/media-fields'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Fieldset({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 border-border" data-testid={testId}>
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function clean<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key]
  return out as T
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-7 flex-1 rounded border text-2xs font-medium', value === v ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** Upload a picture for the form's layout (uploadFormImage: PNG / JPEG / WebP / GIF ≤ 2 MB); returns the value to persist. */
function useFormImageUpload(onStored: (src: string, name: string) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function upload(file: File) {
    setError(null)
    if (file.size > 2 * 1024 * 1024) { setError('The image must be 2 MB or smaller'); return }
    setBusy(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const result = await uploadFormImage(data)
      if (!result.ok) { setError(result.error); return }
      onStored(result.data.ref ?? result.data.url, result.data.name)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, upload }
}

/** Image field: size, formats, the phone camera and an optional default picture. */
export function ImageProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: ImageFieldConfig | undefined, tag?: string) => void }) {
  const config = field.image ?? {}
  const id = (name: string) => `imgp-${field._id}-${name}`
  const set = (patch: Partial<ImageFieldConfig>, tag?: string) => {
    const next = clean({ ...config, ...patch })
    onPatch(Object.keys(next).length ? next : undefined, tag)
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, error, upload } = useFormImageUpload((src, name) => set({ default_file: { name, url: src } }))
  const formats = imageFormats(config)
  const toggle = (t: ImageFormat) => {
    const next = formats.includes(t) ? formats.filter((x) => x !== t) : [...formats, t]
    set({ types: next.length && next.length < IMAGE_FORMATS.length ? IMAGE_FORMATS.filter((x) => next.includes(x)) : undefined })
  }
  return (
    <Fieldset title="Picture" testId="image-properties">
      <div>
        <Label htmlFor={id('mb')}>Largest picture (MB, up to {IMAGE_MAX_MB})</Label>
        <input id={id('mb')} type="number" min={0.1} max={IMAGE_MAX_MB} step={0.5} className={inputClass} placeholder={String(IMAGE_DEFAULT_MAX_MB)}
          value={config.max_mb ?? ''} onChange={(e) => set({ max_mb: e.target.value.trim() === '' ? undefined : Math.min(IMAGE_MAX_MB, Number(e.target.value) || IMAGE_DEFAULT_MAX_MB) }, `imgmb-${field._id}`)} />
      </div>
      <div>
        <Label>Formats</Label>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Allowed picture formats">
          {IMAGE_FORMATS.map((t) => {
            const on = formats.includes(t)
            return (
              <button key={t} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(t)}
                className={cn('rounded-full border px-2.5 py-1 text-2xs font-medium', on ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg')}>
                {IMAGE_FORMAT_LABELS[t]}
              </button>
            )
          })}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={config.camera === true} onChange={(e) => set({ camera: e.target.checked || undefined })} />
        Offer the camera on phones
      </label>
      <div>
        <Label>Default picture</Label>
        {config.default_file ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded default picture (own storage) */}
            <img src={resolveStorageUrl(config.default_file.url) ?? ''} alt="Default picture" className="h-10 w-auto max-w-[120px] rounded border object-contain border-border" />
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => set({ default_file: undefined })}><X size={11} /> Remove</button>
          </div>
        ) : (
          <button type="button" disabled={busy} className="flex items-center gap-1 text-2xs font-medium text-primary-text disabled:opacity-50" onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> {busy ? 'Uploading…' : 'Upload a default picture'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Upload a default picture"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        {error && <p className="mt-1 text-2xs text-danger" role="alert">{error}</p>}
        <p className="mt-1 text-2xs text-fg-muted">Pictures are checked by content and their metadata (GPS location, camera details) is removed.</p>
      </div>
    </Fieldset>
  )
}

/** Signature field: draw / type / both, the statement, audit details, re-sign on change. */
export function SignatureProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: SignatureFieldConfig | undefined, tag?: string) => void }) {
  const config = field.signature ?? {}
  const id = (name: string) => `sigp-${field._id}-${name}`
  const set = (patch: Partial<SignatureFieldConfig>, tag?: string) => {
    const next = clean({ ...config, ...patch })
    onPatch(Object.keys(next).length ? next : undefined, tag)
  }
  const labels: Record<SignatureMode, string> = { both: 'Draw or type', draw: 'Draw', type: 'Type' }
  return (
    <Fieldset title="Signature" testId="signature-properties">
      <div>
        <Label>How people sign</Label>
        <Segmented<SignatureMode> label="How people sign" value={config.mode ?? 'both'} options={SIGNATURE_MODES.map((m) => [m, labels[m]])}
          onChange={(v) => set({ mode: v === 'both' ? undefined : v })} />
      </div>
      <div>
        <Label htmlFor={id('statement')}>Statement</Label>
        <textarea id={id('statement')} rows={2} className="w-full rounded-md border px-2 py-1 text-xs" placeholder="e.g. I confirm the above is correct"
          value={config.statement ?? ''} onChange={(e) => set({ statement: e.target.value || undefined }, `sigst-${field._id}`)} />
      </div>
      <label className="flex items-start gap-1.5 text-2xs">
        <input className="accent-primary mt-0.5" type="checkbox" checked={config.capture_audit === true} onChange={(e) => set({ capture_audit: e.target.checked || undefined })} />
        <span>Record the signer&apos;s IP address and browser (audit details)</span>
      </label>
      <label className="flex items-start gap-1.5 text-2xs">
        <input className="accent-primary mt-0.5" type="checkbox" checked={config.resign_on_change === true} onChange={(e) => set({ resign_on_change: e.target.checked || undefined })} />
        <span>Ask to sign again when other answers change after signing</span>
      </label>
      <p className="text-2xs text-fg-muted">The signer&apos;s name and the time are recorded by the server. {SIGNATURE_DISCLAIMER}</p>
    </Fieldset>
  )
}

/** Display image: the picture (upload or https address), alt text, width and alignment. */
export function DisplayImageProperties({ field, onPatch }: { field: DesignerField; onPatch: (config: DisplayImageConfig, tag?: string) => void }) {
  const config: DisplayImageConfig = field.display_image ?? { src: '', alt: '' }
  const id = (name: string) => `dip-${field._id}-${name}`
  const set = (patch: Partial<DisplayImageConfig>, tag?: string) => onPatch(clean({ ...config, ...patch }), tag)
  const fileRef = useRef<HTMLInputElement>(null)
  const { busy, error, upload } = useFormImageUpload((src) => set({ src }))
  const [address, setAddress] = useState(config.src.startsWith('https://') ? config.src : '')
  const srcProblem = config.src ? displayImageSrcProblem(config.src) : null
  return (
    <Fieldset title="Picture" testId="display-image-properties">
      <div>
        <Label>Image</Label>
        {config.src && !srcProblem ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- the chosen picture (own storage or https) */}
            <img src={config.src.startsWith('data:') ? config.src : resolveStorageUrl(config.src) ?? ''} alt="" className="h-10 w-auto max-w-[120px] rounded border object-contain border-border" />
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => fileRef.current?.click()}><Upload size={11} /> Replace</button>
          </div>
        ) : (
          <button type="button" disabled={busy} className="flex items-center gap-1 text-2xs font-medium text-primary-text disabled:opacity-50" onClick={() => fileRef.current?.click()} data-testid="display-image-upload">
            <Upload size={11} /> {busy ? 'Uploading…' : 'Upload an image'}
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Upload an image"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
        {error && <p className="mt-1 text-2xs text-danger" role="alert">{error}</p>}
      </div>
      <div>
        <Label htmlFor={id('url')}>Or an https address</Label>
        <input id={id('url')} className={inputClass} placeholder="https://…" value={address}
          onChange={(e) => { setAddress(e.target.value); if (!displayImageSrcProblem(e.target.value)) set({ src: e.target.value.trim() }, `disrc-${field._id}`) }} />
        {address && displayImageSrcProblem(address) && <p className="mt-1 text-2xs text-danger">{displayImageSrcProblem(address)}</p>}
      </div>
      <div>
        <Label htmlFor={id('alt')}>Alt text (required)</Label>
        <input id={id('alt')} className={inputClass} value={config.alt} aria-invalid={!config.alt.trim() || undefined} placeholder="Describe the picture, e.g. Acme Ltd logo"
          onChange={(e) => set({ alt: e.target.value }, `dialt-${field._id}`)} data-testid="display-image-alt" />
        {!config.alt.trim() && <p className="mt-1 text-2xs text-danger">Screen readers announce this text instead of the picture.</p>}
      </div>
      <div>
        <Label>Width</Label>
        <Segmented label="Image width" value={config.width ?? 'md'} options={DISPLAY_IMAGE_WIDTHS.map((w) => [w, w === 'sm' ? 'Small' : w === 'md' ? 'Medium' : w === 'lg' ? 'Large' : 'Full'])}
          onChange={(v) => set({ width: v === 'md' ? undefined : v })} />
      </div>
      <div>
        <Label>Alignment</Label>
        <Segmented label="Image alignment" value={config.align ?? 'left'} options={DISPLAY_IMAGE_ALIGNS.map((a) => [a, a[0].toUpperCase() + a.slice(1)])}
          onChange={(v) => set({ align: v === 'left' ? undefined : v })} />
      </div>
    </Fieldset>
  )
}
