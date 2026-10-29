'use client'

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Camera, Download, File as FileIcon, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, RotateCw, Upload, X,
} from 'lucide-react'
import {
  acceptAttribute, allowsImages, attachmentLimits, attachmentPath, BLOCKED_EXTENSIONS, describeAllowedTypes, fileExtension,
  formatBytes, isPreviewableImage, isTypeAllowed, kindForExtension, normalizeAttachmentValue, trackAttachmentUpload, type AttachmentFile,
} from '@/lib/forms/attachments'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { useFormLookupSource } from './lookup-field'
import { cn } from '@/lib/utils'

/**
 * Where an Attachments field uploads to: an open task, a reusable form's
 * page / start form, a designer test run's User Task, or the designer
 * preview (nothing is uploaded). Without a provider the form's lookup
 * source decides (task → task, form → form, preview → preview).
 */
export type FormAttachmentSource =
  | { kind: 'task'; taskId: string }
  | { kind: 'form'; formId: string }
  | { kind: 'test'; workflowId: string }
  /** A workflow's start form (Run dialog): its attachments inputs. */
  | { kind: 'start'; workflowId: string }
  | { kind: 'preview' }

const AttachmentSourceContext = createContext<FormAttachmentSource | null>(null)

export function FormAttachmentsProvider({ source, children }: { source: FormAttachmentSource | null; children: React.ReactNode }) {
  return <AttachmentSourceContext.Provider value={source}>{children}</AttachmentSourceContext.Provider>
}

function useAttachmentSource(): FormAttachmentSource | null {
  const explicit = useContext(AttachmentSourceContext)
  const lookup = useFormLookupSource()
  if (explicit) return explicit
  if (!lookup) return null
  if (lookup.kind === 'task') return { kind: 'task', taskId: lookup.taskId }
  if (lookup.kind === 'form') return { kind: 'form', formId: lookup.formId }
  return { kind: 'preview' }
}

function iconFor(name: string, mime: string) {
  if (/^image\//.test(mime)) return FileImage
  const kind = kindForExtension(fileExtension(name))
  if (kind?.groups.includes('spreadsheets')) return FileSpreadsheet
  if (kind?.groups.includes('documents')) return FileText
  return FileIcon
}

/** A stored file: thumbnail or icon, name, size, download link. */
export function AttachmentChip({ file, children, preview }: { file: AttachmentFile; children?: React.ReactNode; preview?: string | null }) {
  const Icon = iconFor(file.name, file.mime_type)
  const thumb = preview ?? (isPreviewableImage(file.mime_type) ? `${attachmentPath(file.id)}?inline=1` : null)
  return (
    <div className="flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: 'var(--theme-surface-border)' }} data-attachment-id={file.id}>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element -- authorised, signed, same-origin thumbnails
        <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" style={{ backgroundColor: 'var(--theme-surface-border)' }} />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)' }}>
          <Icon size={16} aria-hidden style={{ color: 'var(--theme-primary-text)' }} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <a href={attachmentPath(file.id)} className="block truncate text-sm font-medium hover:underline" style={{ color: 'var(--theme-card-text)' }} download={file.name} title={file.name}>
          {file.name}
        </a>
        <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{formatBytes(file.size)}</p>
      </div>
      {children}
    </div>
  )
}

/** Read-only list of a field's files with download links (completed tasks, submissions). */
export function AttachmentList({ value, empty = '—' }: { value: unknown; empty?: string }) {
  const files = normalizeAttachmentValue(value)
  if (!files.length) return <span>{empty}</span>
  return (
    <ul className="space-y-1.5" aria-label="Files">
      {files.map((file) => (
        <li key={file.id}>
          <AttachmentChip file={file}>
            <a href={attachmentPath(file.id)} download={file.name} aria-label={`Download ${file.name}`} className="rounded p-1.5" style={{ color: 'var(--theme-muted-text)' }}>
              <Download size={14} aria-hidden />
            </a>
          </AttachmentChip>
        </li>
      ))}
    </ul>
  )
}

interface Upload {
  localId: string
  file: File
  status: 'uploading' | 'error'
  progress: number
  error?: string
  xhr?: XMLHttpRequest
}

function uploadError(status: number, body: unknown): string {
  const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : ''
  if (message) return message
  if (status === 413) return 'The file is too large'
  if (status === 429) return 'Too many uploads — wait a moment'
  if (status === 401) return 'Your session has ended — sign in again'
  return 'The upload failed'
}

/**
 * The Attachments control: a drop zone (drag and drop, Browse, paste,
 * camera on phones when images are allowed), several files at once, per-file
 * progress with cancel / retry / remove, thumbnails for images, reordering
 * with buttons. Each file is uploaded on its own request as soon as it is
 * added; the field's value is the list of uploaded file objects (the server
 * re-reads them on submit). Progress and errors are announced politely.
 */
export function AttachmentsField({ field, value, onChange, id, describedBy, invalid, disabled }: {
  field: TaskFieldDef
  value: unknown
  onChange: (value: AttachmentFile[]) => void
  id: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
}) {
  const source = useAttachmentSource()
  const files = useMemo(() => normalizeAttachmentValue(value), [value])
  const filesRef = useRef(files)
  useEffect(() => { filesRef.current = files }, [files])
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const previews = useRef(new Map<string, string>())
  const running = useRef(new Set<XMLHttpRequest>())
  const sessionIds = useRef(new Set<string>())
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const hintId = useId()
  const config = field.attachments
  const limits = attachmentLimits(config, { required: field.required })
  const accept = acceptAttribute(config)
  const canUpload = !disabled && Boolean(source) && source!.kind !== 'preview'
  const showCamera = Boolean(config?.camera) && allowsImages(config)

  useEffect(() => {
    const map = previews.current
    const xhrs = running.current
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
      // Leaving the form: stop uploads (their loadend releases the in-flight count).
      for (const xhr of xhrs) xhr.abort()
    }
  }, [])

  /** Change the value now (several uploads can finish before the next render). */
  function emit(next: AttachmentFile[]) {
    filesRef.current = next
    onChange(next)
  }

  function setUpload(localId: string, patch: Partial<Upload>) {
    setUploads((list) => list.map((u) => (u.localId === localId ? { ...u, ...patch } : u)))
  }

  /** One XHR with upload progress; resolves with the status and parsed JSON (or text) body. */
  function send(localId: string, file: File, xhr: XMLHttpRequest, method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
      xhr.open(method, url)
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
      let lastAnnounced = 0
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return
        const progress = Math.min(99, Math.round((event.loaded / event.total) * 100))
        setUpload(localId, { progress })
        if (progress - lastAnnounced >= 25) { lastAnnounced = progress; setAnnouncement(`Uploading ${file.name}: ${progress}%`) }
      }
      xhr.onload = () => {
        let parsed: unknown = xhr.responseText
        try { parsed = JSON.parse(xhr.responseText) } catch { /* not JSON */ }
        resolve({ status: xhr.status, body: parsed })
      }
      xhr.onerror = () => reject(new Error('Network error — check your connection'))
      xhr.onabort = () => reject(new Error('aborted'))
      xhr.send(body)
    })
  }

  function contextFields(): Record<string, string> {
    if (!source || source.kind === 'preview') return {}
    return source.kind === 'task' ? { task_id: source.taskId } : source.kind === 'form' ? { form_id: source.formId }
      : source.kind === 'start' ? { start_workflow_id: source.workflowId } : { workflow_id: source.workflowId }
  }

  /**
   * Upload one file: init asks the server how — straight to storage when
   * the provider signs uploads (Supabase, S3 / MinIO, Azure Blob, GCS: a
   * signed URL for this one object, the browser's PUT with progress, then
   * complete, where the server verifies the object), else through the app
   * (local disk; up to the server's body limit). Works on any host:
   * serverless platforms cap request bodies at a few MB.
   */
  async function start(localId: string, file: File) {
    if (!source || source.kind === 'preview') return
    const xhr = new XMLHttpRequest()
    trackAttachmentUpload(field.key, 1)
    running.current.add(xhr)
    setUpload(localId, { status: 'uploading', progress: 0, error: undefined, xhr })
    let directId: string | null = null
    try {
      let stored: AttachmentFile | null = null
      {
        const init = await fetch('/api/internal/forms/files/init', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field_key: field.key, name: file.name, size: file.size, ...contextFields() }),
        })
        const plan = await init.json().catch(() => null) as { mode?: string; file_id?: string; upload?: { url: string; method: string; headers: Record<string, string> }; error?: string } | null
        if (!init.ok) throw new Error(uploadError(init.status, plan))
        if (plan?.mode === 'direct' && plan.file_id && plan.upload) {
          directId = plan.file_id
          const put = await send(localId, file, xhr, plan.upload.method, plan.upload.url, file, plan.upload.headers)
          if (put.status < 200 || put.status >= 300) throw new Error('The storage service refused the upload — try again')
          const done = await fetch('/api/internal/forms/files/complete', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: directId }),
          })
          const result = await done.json().catch(() => null) as { file?: AttachmentFile; error?: string } | null
          directId = null // the server deleted it if it failed
          if (!done.ok || !result?.file) throw new Error(uploadError(done.status, result))
          stored = result.file
        }
      }
      if (!stored) {
        const form = new FormData()
        form.append('file', file, file.name)
        form.append('field_key', field.key)
        form.append('size', String(file.size))
        for (const [name, value] of Object.entries(contextFields())) form.append(name, value)
        const res = await send(localId, file, xhr, 'POST', '/api/internal/forms/files', form)
        const body = res.body as { file?: AttachmentFile } | null
        if (res.status < 200 || res.status >= 300 || !body?.file) throw new Error(uploadError(res.status, res.body))
        stored = body.file
      }
      sessionIds.current.add(stored.id)
      if (isPreviewableImage(stored.mime_type)) previews.current.set(stored.id, URL.createObjectURL(file))
      setUploads((list) => list.filter((u) => u.localId !== localId))
      emit([...filesRef.current, stored])
      setAnnouncement(`${stored.name} uploaded`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The upload failed'
      // A started direct upload that didn't finish: let the server drop it.
      if (directId) void fetch(`/api/internal/forms/files/${directId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
      if (message === 'aborted') return
      setUpload(localId, { status: 'error', error: message, xhr: undefined })
      setAnnouncement(`${file.name} could not be uploaded: ${message}`)
    } finally {
      trackAttachmentUpload(field.key, -1)
      running.current.delete(xhr)
    }
  }

  function addFiles(list: FileList | File[] | null) {
    if (!list || !canUpload) return
    const incoming = Array.from(list)
    if (!incoming.length) return
    setNotice(null)
    const room = limits.maxFiles - filesRef.current.length - uploads.filter((u) => u.status === 'uploading').length
    const accepted = incoming.slice(0, Math.max(0, room))
    if (accepted.length < incoming.length) setNotice(`Only ${limits.maxFiles} file${limits.maxFiles === 1 ? '' : 's'} can be attached here — ${incoming.length - accepted.length} not added`)
    const next: Upload[] = []
    for (const file of accepted) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const ext = fileExtension(file.name)
      let error: string | undefined
      if (file.size === 0) error = 'The file is empty'
      else if (file.size > limits.maxFileBytes) error = `Larger than ${formatBytes(limits.maxFileBytes)}`
      else if (BLOCKED_EXTENSIONS.has(ext) || !isTypeAllowed(config, ext, kindForExtension(ext))) error = ext ? `.${ext} files are not allowed here` : 'Files need an extension here'
      next.push({ localId, file, status: error ? 'error' : 'uploading', progress: 0, error })
    }
    setUploads((current) => [...current, ...next])
    for (const u of next) if (u.status === 'uploading') start(u.localId, u.file)
  }

  function cancel(upload: Upload) {
    upload.xhr?.abort()
    setUploads((list) => list.filter((u) => u.localId !== upload.localId))
    setAnnouncement(`${upload.file.name} removed`)
  }

  function remove(file: AttachmentFile) {
    emit(filesRef.current.filter((f) => f.id !== file.id))
    setAnnouncement(`${file.name} removed`)
    // Uploaded in this visit and not submitted: delete it now (the server keeps a task draft's saved files).
    if (sessionIds.current.has(file.id)) {
      sessionIds.current.delete(file.id)
      void fetch(`/api/internal/forms/files/${file.id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {})
    }
  }

  function move(index: number, delta: number) {
    const next = [...filesRef.current]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    emit(next)
    setAnnouncement(`${next[target].name} moved to position ${target + 1} of ${next.length}`)
  }

  const busy = uploads.some((u) => u.status === 'uploading')
  const zoneText = !source || source.kind === 'preview'
    ? 'Files are uploaded when the form is filled in'
    : disabled ? 'Attachments are read-only' : 'Drag files here, paste, or browse'

  return (
    <div className="space-y-2" data-attachments-field={field.key} aria-busy={busy || undefined}>
      <div
        id={id}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(' ') || undefined}
        tabIndex={canUpload ? 0 : -1}
        onDragOver={(e) => { if (!canUpload || !Array.from(e.dataTransfer.types).includes('Files')) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
        onDrop={(e) => { if (!canUpload) return; e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
        onPaste={(e) => {
          if (!canUpload) return
          const pasted = Array.from(e.clipboardData.files)
          if (pasted.length) { e.preventDefault(); addFiles(pasted) }
        }}
        onKeyDown={(e) => {
          if (!canUpload || e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() }
        }}
        className={cn('flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center outline-none transition-colors focus-visible:ring-2 sm:flex-row sm:justify-between sm:text-left', !canUpload && 'opacity-70')}
        style={{
          borderColor: invalid ? 'var(--status-blocked)' : dragging ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
          backgroundColor: dragging ? 'color-mix(in srgb, var(--theme-primary) 8%, transparent)' : 'transparent',
          ['--tw-ring-color' as string]: 'var(--theme-primary)',
        }}
        data-dropzone
      >
        <div className="flex items-center gap-2.5">
          <Paperclip size={18} aria-hidden style={{ color: 'var(--theme-muted-text)' }} className="hidden sm:block" />
          <div>
            <p className="text-sm" style={{ color: 'var(--theme-card-text)' }}>{zoneText}</p>
            <p id={hintId} className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              {describeAllowedTypes(config)} · up to {formatBytes(limits.maxFileBytes)} each · {limits.maxFiles === 1 ? 'one file' : `up to ${limits.maxFiles} files`}
            </p>
          </div>
        </div>
        {canUpload && (
          <div className="flex shrink-0 flex-wrap justify-center gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium"
              style={{ borderColor: 'var(--theme-primary)', color: 'var(--theme-primary-text)' }}>
              <Upload size={14} aria-hidden /> Browse…
            </button>
            {showCamera && (
              <button type="button" onClick={() => cameraRef.current?.click()} className="inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium sm:hidden"
                style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                <Camera size={14} aria-hidden /> Take photo
              </button>
            )}
          </div>
        )}
        <input ref={inputRef} type="file" multiple={limits.maxFiles > 1} accept={accept || undefined} className="sr-only" tabIndex={-1} aria-hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} data-attachments-input />
        {showCamera && (
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        )}
      </div>

      {notice && <p className="text-[11px]" role="status" style={{ color: 'var(--theme-warning, var(--theme-muted-text))' }}>{notice}</p>}

      {(files.length > 0 || uploads.length > 0) && (
        <ul className="space-y-1.5" aria-label={`${field.label}: files`}>
          {files.map((file, index) => (
            <li key={file.id}>
              <AttachmentChip file={file} preview={previews.current.get(file.id) ?? null}>
                {!disabled && files.length > 1 && (
                  <>
                    <button type="button" className="rounded p-1.5 disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${file.name} up`}><ArrowUp size={13} aria-hidden /></button>
                    <button type="button" className="rounded p-1.5 disabled:opacity-30" disabled={index === files.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${file.name} down`}><ArrowDown size={13} aria-hidden /></button>
                  </>
                )}
                {!disabled && (
                  <button type="button" className="rounded p-1.5" onClick={() => remove(file)} aria-label={`Remove ${file.name}`} data-remove-attachment>
                    <X size={14} aria-hidden />
                  </button>
                )}
              </AttachmentChip>
            </li>
          ))}
          {uploads.map((upload) => (
            <li key={upload.localId} className="rounded-lg border px-2.5 py-2" style={{ borderColor: upload.status === 'error' ? 'var(--status-blocked)' : 'var(--theme-surface-border)' }} data-upload-status={upload.status}>
              <div className="flex items-center gap-2.5">
                {upload.status === 'uploading'
                  ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden style={{ color: 'var(--theme-primary-text)' }} />
                  : <FileIcon size={16} className="shrink-0" aria-hidden style={{ color: 'var(--status-blocked)' }} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: 'var(--theme-card-text)' }}>{upload.file.name}</p>
                  <p className="text-[11px]" style={{ color: upload.status === 'error' ? 'var(--status-blocked)' : 'var(--theme-muted-text)' }}>
                    {upload.status === 'error' ? upload.error : `${formatBytes(upload.file.size)} · ${upload.progress}%`}
                  </p>
                </div>
                {upload.status === 'error' && upload.error !== 'The file is empty' && !/not allowed|Larger than|extension/.test(upload.error ?? '') && (
                  <button type="button" className="rounded p-1.5" onClick={() => start(upload.localId, upload.file)} aria-label={`Retry ${upload.file.name}`}><RotateCw size={14} aria-hidden /></button>
                )}
                <button type="button" className="rounded p-1.5" onClick={() => cancel(upload)} aria-label={upload.status === 'uploading' ? `Cancel uploading ${upload.file.name}` : `Dismiss ${upload.file.name}`}>
                  <X size={14} aria-hidden />
                </button>
              </div>
              {upload.status === 'uploading' && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--theme-surface-border)' }}
                  role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.progress} aria-label={`Uploading ${upload.file.name}`}>
                  <div className="h-full transition-[width]" style={{ width: `${upload.progress}%`, backgroundColor: 'var(--theme-primary)' }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" aria-live="polite" role="status">{announcement}</p>
    </div>
  )
}
