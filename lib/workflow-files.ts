/**
 * Files a workflow step is given — Send Email attachments, an HTTP Request's
 * multipart file parts or binary body — as bytes (server only).
 *
 * A value can be one file or a list: an uploaded form attachment
 * (`{{task_data.files}}`, `{{item}}` inside a Loop over them), a file another
 * step produced (`{ url, name, … }` from HTTP Request / Download File /
 * document steps), a storage reference or a URL, or JSON text of those.
 * Form attachments are read through the storage provider for the run's
 * tenant only (lib/services/form-files.ts readWorkflowFile): a value naming
 * another workspace's file is "not found". Other URLs go through the egress
 * guard. Logs and step outputs carry names and sizes, never contents.
 */

import { fetchFile, fileSource } from '@/lib/storage/files'
import { formFileTarget } from '@/lib/services/form-files'
import { isOwnStorageObject, isStorageRef } from '@/lib/storage/refs'
import { STORAGE_BUCKET_NAMES } from '@/lib/storage/buckets'
import { isPlainObject } from '@/lib/utils/guards'

export interface StepFile {
  name: string
  mime_type: string
  size: number
  bytes: Uint8Array
}

/** Every file a value names (a list flattened one level; JSON text parsed; blanks dropped). */
export function fileValues(value: unknown): unknown[] {
  let v = value
  if (typeof v === 'string') {
    const text = v.trim()
    if (!text) return []
    if (text.startsWith('[') || text.startsWith('{')) {
      try { v = JSON.parse(text) } catch { /* a plain string */ }
    }
  }
  if (Array.isArray(v)) return v.flatMap((entry) => (Array.isArray(entry) ? entry : [entry])).filter((entry) => entry !== null && entry !== undefined && entry !== '')
  return v === null || v === undefined || v === '' ? [] : [v]
}

function nameFrom(value: unknown, source: string, disposition: string | null): string {
  if (isPlainObject(value) && typeof value.name === 'string' && value.name.trim()) return value.name.trim()
  const match = disposition?.match(/filename\*=UTF-8''([^;]+)/i) ?? disposition?.match(/filename="?([^";]+)"?/i)
  if (match) {
    try { return decodeURIComponent(match[1]) } catch { return match[1] }
  }
  try { return decodeURIComponent(new URL(source, 'http://x.invalid').pathname.split('/').pop() || 'file') } catch { return 'file' }
}

export interface LoadStepFilesOptions {
  tenantId: string
  /** At most this many files (default 20). */
  maxFiles?: number
  /** All files together (default 25 MB, what most mail services accept). */
  maxTotalBytes?: number
  timeoutMs?: number
}

/** Read the files a value names (in order). Throws a clear error for a missing file or a limit. */
export async function loadStepFiles(value: unknown, options: LoadStepFilesOptions): Promise<StepFile[]> {
  const entries = fileValues(value)
  const maxFiles = options.maxFiles ?? 20
  const maxTotal = options.maxTotalBytes ?? 25 * 1024 * 1024
  if (entries.length > maxFiles) throw new Error(`Too many files (${entries.length}; at most ${maxFiles})`)
  const out: StepFile[] = []
  let total = 0
  for (const entry of entries) {
    const source = fileSource(entry)
    if (!source) continue
    const own = Boolean(formFileTarget(source)) || isStorageRef(source) || Boolean(isOwnStorageObject(String(source), STORAGE_BUCKET_NAMES))
    if (!own) {
      if (!/^https?:\/\//i.test(source)) throw new Error(`"${String(source).slice(0, 80)}" is not a file`)
      const { assertSafeEgressUrl } = await import('@/lib/egress-guard')
      await assertSafeEgressUrl(source)
    }
    const response = await fetchFile(source, { signal: AbortSignal.timeout(options.timeoutMs ?? 60_000) }, { tenantId: options.tenantId })
    if (!response.ok) throw new Error(`File "${nameFrom(entry, source, null)}" could not be read (HTTP ${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    total += bytes.byteLength
    if (total > maxTotal) throw new Error(`The files are larger than ${Math.round(maxTotal / 1024 / 1024)} MB together`)
    const mime = (isPlainObject(entry) && typeof entry.mime_type === 'string' && entry.mime_type)
      || (isPlainObject(entry) && typeof entry.content_type === 'string' && entry.content_type)
      || response.headers.get('content-type')?.split(';')[0].trim()
      || 'application/octet-stream'
    out.push({ name: nameFrom(entry, source, response.headers.get('content-disposition')), mime_type: String(mime), size: bytes.byteLength, bytes })
  }
  return out
}

/** Names and sizes for logs and step outputs (never the contents). */
export function describeStepFiles(files: StepFile[]): Array<{ name: string; size: number; mime_type: string }> {
  return files.map((f) => ({ name: f.name, size: f.size, mime_type: f.mime_type }))
}
