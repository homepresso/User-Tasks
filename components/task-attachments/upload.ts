"use client"

import type { TaskAttachment, TaskAttachmentMeta } from "@/lib/task-attachments"

/**
 * Upload one task attachment from the browser: init asks the server how —
 * straight to storage when the provider signs uploads (Supabase, S3 / MinIO,
 * Azure Blob, GCS: a signed PUT for this one object, then complete, where
 * the server verifies it), else through the app (local disk; up to the
 * server's body limit). XHR for upload progress; `signal` cancels.
 */

export class UploadError extends Error {
  fields?: Partial<Record<keyof TaskAttachmentMeta, string>>
  constructor(message: string, fields?: Partial<Record<keyof TaskAttachmentMeta, string>>) {
    super(message)
    this.fields = fields
  }
}

function send(method: string, url: string, body: XMLHttpRequestBodyInit, headers: Record<string, string>, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))) }
    xhr.onload = () => {
      let parsed: unknown = xhr.responseText
      try { parsed = JSON.parse(xhr.responseText) } catch { /* text */ }
      resolve({ status: xhr.status, body: parsed })
    }
    xhr.onerror = () => reject(new UploadError("The connection failed — try again"))
    xhr.onabort = () => reject(new UploadError("aborted"))
    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

function failure(status: number, body: unknown): UploadError {
  const b = (body ?? {}) as { error?: string; details?: Partial<Record<keyof TaskAttachmentMeta, string>> }
  if (status === 413) return new UploadError(b.error ?? "The file is too large")
  return new UploadError(b.error ?? "The upload failed — try again", b.details && typeof b.details === "object" ? b.details : undefined)
}

export async function uploadTaskAttachment(taskId: string, file: File, meta: TaskAttachmentMeta, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<TaskAttachment> {
  const base = `/api/internal/tasks/${encodeURIComponent(taskId)}/attachments`
  const init = await fetch(`${base}/init`, {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ file_name: file.name, size: file.size, ...meta }),
  })
  const plan = await init.json().catch(() => null) as { mode?: string; attachment_id?: string; upload?: { url: string; method: string; headers: Record<string, string> } } | null
  if (!init.ok) throw failure(init.status, plan)
  if (plan?.mode === "direct" && plan.attachment_id && plan.upload) {
    const id = plan.attachment_id
    try {
      const put = await send(plan.upload.method, plan.upload.url, file, plan.upload.headers, onProgress, signal)
      if (put.status < 200 || put.status >= 300) throw new UploadError("The storage service refused the upload — try again")
    } catch (error) {
      void fetch(`${base}/${id}?upload=1`, { method: "DELETE", credentials: "same-origin" }).catch(() => {})
      throw error
    }
    const done = await fetch(`${base}/${id}/complete`, { method: "POST", credentials: "same-origin" })
    const result = await done.json().catch(() => null) as { attachment?: TaskAttachment } | null
    if (!done.ok || !result?.attachment) throw failure(done.status, result)
    onProgress(100)
    return result.attachment
  }
  const form = new FormData()
  form.append("file", file, file.name)
  form.append("size", String(file.size))
  form.append("name", meta.name)
  form.append("type", meta.type)
  form.append("description", meta.description)
  const res = await send("POST", base, form, {}, onProgress, signal)
  const body = res.body as { attachment?: TaskAttachment } | null
  if (res.status < 200 || res.status >= 300 || !body?.attachment) throw failure(res.status, res.body)
  onProgress(100)
  return body.attachment
}
