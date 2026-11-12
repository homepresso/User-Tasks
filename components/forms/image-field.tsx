'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ImageIcon, Loader2, RefreshCw, Upload, X } from 'lucide-react'
import { attachmentPath, fileExtension, formatBytes, type AttachmentFile } from '@/lib/forms/attachments'
import {
  describeImageLimits, imageAccept, imageFormats, IMAGE_DEFAULT_MAX_MB, IMAGE_MAX_MB, isImageDefaultValue, normalizeImageValue,
  type ImageDefaultFile,
} from '@/lib/forms/media-fields'
import { resolveStorageUrl } from '@/lib/storage/refs'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useAttachmentSource } from './attachments-field'
import { removeFieldFile, uploadFieldFile } from './form-file-upload'
import { cn } from '@/lib/utils'

const EXTENSIONS: Record<string, string[]> = { png: ['png'], jpeg: ['jpg', 'jpeg', 'jpe'], webp: ['webp'], gif: ['gif'] }

/** Where a stored Image value (or a default picture) is shown from. */
export function imageValueSrc(value: unknown, fallback?: ImageDefaultFile): string | null {
  const file = normalizeImageValue(value)
  if (file) return `${attachmentPath(file.id)}?inline=1`
  if (isImageDefaultValue(value) && typeof (value as { url?: unknown }).url === 'string') return resolveStorageUrl((value as { url: string }).url)
  return fallback ? resolveStorageUrl(fallback.url) : null
}

/** Read-only: the picture (links to the full size) and its name. */
export function ImageValueView({ value, label }: { value: unknown; label: string }) {
  const src = imageValueSrc(value)
  if (!src) return <p className="text-sm text-fg">—</p>
  const name = normalizeImageValue(value)?.name ?? (isImageDefaultValue(value) ? String((value as { name?: unknown }).name ?? '') : '')
  return (
    <a href={src.replace('?inline=1', '')} className="inline-block max-w-full" target="_blank" rel="noreferrer" data-image-value>
      {/* eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin picture */}
      <img src={src} alt={name ? `${label}: ${name}` : label} className="max-h-48 max-w-full rounded-md border object-contain border-border bg-subtle" />
      {name && <span className="mt-1 block truncate text-2xs text-fg-muted">{name}</span>}
    </a>
  )
}

/**
 * The Image control: one picture — upload (Browse, drag and drop, paste) or
 * the phone camera (`capture="environment"`), a preview, Replace and
 * Remove. The picture goes through the Attachments pipeline (checked by
 * content, metadata such as GPS stripped on the server); the value is the
 * stored file object. A field with a default picture shows it until the
 * person provides their own (Remove goes back to the default).
 */
export function ImageField({ field, value, onChange, id, describedBy, invalid, disabled }: {
  field: TaskFieldDef
  value: unknown
  onChange: (value: AttachmentFile | null) => void
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const source = useAttachmentSource()
  const file = normalizeImageValue(value)
  const fallback = field.image?.default_file
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [dragging, setDragging] = useState(false)
  const previews = useRef(new Map<string, string>())
  const sessionIds = useRef(new Set<string>())
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const canUpload = !disabled && Boolean(source) && source!.kind !== 'preview'
  const maxBytes = Math.floor(Math.min(field.image?.max_mb ?? IMAGE_DEFAULT_MAX_MB, IMAGE_MAX_MB) * 1024 * 1024)
  const allowed = imageFormats(field.image).flatMap((t) => EXTENSIONS[t])

  useEffect(() => {
    const map = previews.current
    return () => { for (const url of map.values()) URL.revokeObjectURL(url) }
  }, [])

  async function take(list: FileList | File[] | null) {
    const picked = list ? Array.from(list)[0] : null
    if (!picked || !canUpload || !source) return
    setError(null)
    const ext = fileExtension(picked.name) || (picked.type === 'image/jpeg' ? 'jpg' : picked.type.replace('image/', ''))
    if (!allowed.includes(ext)) { setError(`Use a ${describeImageLimits(field.image).split(' up to')[0]} picture`); return }
    if (picked.size === 0) { setError('The file is empty'); return }
    if (picked.size > maxBytes) { setError(`The picture is larger than ${formatBytes(maxBytes)}`); return }
    const name = fileExtension(picked.name) ? picked.name : `photo.${ext}`
    setBusy(true)
    setAnnouncement(`Uploading ${name}`)
    try {
      const stored = await uploadFieldFile(source, field.key, picked, name)
      previews.current.set(stored.id, URL.createObjectURL(picked))
      const previous = file
      sessionIds.current.add(stored.id)
      onChange(stored)
      setAnnouncement(`${stored.name} uploaded`)
      // Replaced a picture uploaded in this visit: drop it now.
      if (previous && sessionIds.current.has(previous.id)) { sessionIds.current.delete(previous.id); void removeFieldFile(source, previous.id) }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The upload failed'
      setError(message)
      setAnnouncement(`${name} could not be uploaded: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    if (!file) return
    onChange(null)
    setAnnouncement(fallback ? 'Picture removed — the default picture is used' : 'Picture removed')
    if (source && sessionIds.current.has(file.id)) { sessionIds.current.delete(file.id); void removeFieldFile(source, file.id) }
  }

  const src = file ? previews.current.get(file.id) ?? `${attachmentPath(file.id)}?inline=1` : fallback ? resolveStorageUrl(fallback.url) : null
  const hint = !source || source.kind === 'preview' ? 'Pictures are uploaded when the form is filled in' : describeImageLimits(field.image)

  return (
    <div className="space-y-2" data-image-field={field.key} aria-busy={busy || undefined}>
      <div
        id={id}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
        onDragOver={(e) => { if (!canUpload || !Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); setDragging(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
        onDrop={(e) => { if (!canUpload) return; e.preventDefault(); setDragging(false); void take(e.dataTransfer.files) }}
        onPaste={(e) => { if (!canUpload || !e.clipboardData.files.length) return; e.preventDefault(); void take(e.clipboardData.files) }}
        className={cn('flex flex-col gap-3 rounded-lg border-2 border-dashed p-3 sm:flex-row sm:items-center', invalid ? 'border-(--status-blocked)' : dragging ? 'border-primary' : 'border-border', disabled && 'opacity-70')}
      >
        <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-md bg-subtle sm:w-40">
          {busy ? <Loader2 size={20} className="animate-spin text-primary-text" aria-hidden />
            : src ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview / authorised same-origin picture
              <img src={src} alt={file ? `Preview of ${file.name}` : 'Default picture'} className="h-full w-full object-contain" data-image-preview />
            ) : <ImageIcon size={24} className="text-fg-muted" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="truncate text-sm text-fg">{file ? file.name : fallback ? 'Default picture' : 'No picture yet'}</p>
          <p id={hintId} className="text-2xs text-fg-muted">{hint}</p>
          {canUpload && (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium border-primary text-primary-text disabled:opacity-50" data-image-upload>
                {file ? <RefreshCw size={14} aria-hidden /> : <Upload size={14} aria-hidden />} {file ? 'Replace' : 'Upload picture'}
              </button>
              {field.image?.camera && (
                <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium border-border text-fg sm:hidden disabled:opacity-50">
                  <Camera size={14} aria-hidden /> Take photo
                </button>
              )}
              {file && (
                <button type="button" disabled={busy} onClick={remove} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium border-border text-fg disabled:opacity-50" data-image-remove>
                  <X size={14} aria-hidden /> Remove
                </button>
              )}
            </div>
          )}
        </div>
        <input ref={inputRef} type="file" accept={imageAccept(field.image)} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void take(e.target.files); e.target.value = '' }} data-image-input />
        {field.image?.camera && (
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void take(e.target.files); e.target.value = '' }} />
        )}
      </div>
      {error && <p className="text-2xs text-(--status-blocked)" role="alert">{error}</p>}
      <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
    </div>
  )
}
