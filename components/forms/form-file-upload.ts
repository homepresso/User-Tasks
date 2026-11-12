'use client'

import { trackAttachmentUpload, type AttachmentFile } from '@/lib/forms/attachments'
import type { FormAttachmentSource } from './attachments-field'
import { formApiHeaders, formApiUrl } from './lookup-field'

/**
 * One file into a form field through the Attachments upload pipeline
 * (lib/services/form-files.ts) — the Image and Signature controls use it.
 * The server says how: straight to storage (a signed URL, then complete,
 * where it verifies the object) or through the app. Counts as an upload in
 * flight for the field while it runs (a form isn't submitted meanwhile).
 */
export async function uploadFieldFile(source: FormAttachmentSource, fieldKey: string, file: File | Blob, name: string, options: { signal?: AbortSignal } = {}): Promise<AttachmentFile> {
  if (source.kind === 'preview') throw new Error('Files are uploaded when the form is filled in')
  const context: Record<string, string> = source.kind === 'task' ? { task_id: source.taskId } : source.kind === 'form' ? { form_id: source.formId }
    : source.kind === 'start' ? { start_workflow_id: source.workflowId } : { workflow_id: source.workflowId }
  const failed = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => null) as { error?: string } | null
    if (body?.error) return new Error(body.error)
    if (res.status === 413) return new Error('The file is too large')
    if (res.status === 429) return new Error('Too many uploads — wait a moment')
    return new Error(fallback)
  }
  trackAttachmentUpload(fieldKey, 1)
  let directId: string | null = null
  try {
    const init = await fetch(formApiUrl(source, 'files/init'), {
      method: 'POST', credentials: 'same-origin', signal: options.signal, headers: { 'Content-Type': 'application/json', ...formApiHeaders(source) },
      body: JSON.stringify({ field_key: fieldKey, name, size: file.size, ...context }),
    })
    if (!init.ok) throw await failed(init, 'The upload failed')
    const plan = await init.json().catch(() => null) as { mode?: string; file_id?: string; upload?: { url: string; method: string; headers: Record<string, string> } } | null
    if (plan?.mode === 'direct' && plan.file_id && plan.upload) {
      directId = plan.file_id
      const put = await fetch(plan.upload.url, { method: plan.upload.method, headers: plan.upload.headers, body: file, signal: options.signal })
      if (!put.ok) throw new Error('The storage service refused the upload — try again')
      const done = await fetch('/api/internal/forms/files/complete', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: directId }),
      })
      directId = null // the server deleted it if it failed
      if (!done.ok) throw await failed(done, 'The upload failed')
      const result = await done.json() as { file?: AttachmentFile }
      if (!result.file) throw new Error('The upload failed')
      return result.file
    }
    const form = new FormData()
    form.append('file', file, name)
    form.append('field_key', fieldKey)
    form.append('size', String(file.size))
    for (const [k, v] of Object.entries(context)) form.append(k, v)
    const res = await fetch(formApiUrl(source, 'files'), { method: 'POST', credentials: 'same-origin', body: form, headers: formApiHeaders(source), signal: options.signal })
    if (!res.ok) throw await failed(res, 'The upload failed')
    const body = await res.json() as { file?: AttachmentFile }
    if (!body.file) throw new Error('The upload failed')
    return body.file
  } catch (err) {
    if (directId) void removeFieldFile(source, directId)
    throw err
  } finally {
    trackAttachmentUpload(fieldKey, -1)
  }
}

/** Drop a pending upload of this visit (Replace / Remove / Clear before submitting). */
export async function removeFieldFile(source: FormAttachmentSource, fileId: string): Promise<void> {
  if (source.kind === 'preview' || !fileId) return
  await fetch(formApiUrl(source, `files/${fileId}`), { method: 'DELETE', credentials: 'same-origin', headers: formApiHeaders(source) }).catch(() => {})
}
