/**
 * Document-action file inputs → bytes (server only).
 *
 * A file input can be:
 *  - a file object: a form attachment (`{ id, name, mime_type, url, storage_ref, … }`),
 *    a file another step produced (`{ _file, name, url, path, ref }` from HTTP
 *    Request / Download File / CSV / Excel / document steps, or the file
 *    objects the document actions return), or a list of them (the first, or
 *    all for multi-file inputs such as PDF merge);
 *  - a `storage://bucket/key` reference or an own-storage URL;
 *  - an http(s) URL (through the egress guard; redirects re-checked);
 *  - inline content: `{ base64 | content_base64, name }`, a `data:` URL, or
 *    raw bytes; and, where the node allows text, `{ text, name }` or a plain
 *    string that is not a URL.
 *
 * Own-storage objects are read for the run's tenant only: an object whose key
 * names another tenant (task-files `workflow-files/<tenant>/…`, logos, fonts),
 * a private bucket without an owner, or a form attachment of another
 * workspace is reported as "not found". Form attachments are read through
 * fetchFile's tenant-scoped path (form-attachments branch); when both branches
 * are merged, lib/workflow-files.ts (loadStepFiles) is the shared loader and
 * this file only adds the inline / text / size-capped cases on top of it.
 */

import { fetchFile } from '@/lib/storage/files'
import { formatStorageRef, parseOwnStorageUrl, isStorageRef } from '@/lib/storage/refs'
import { bucketPolicy } from '@/lib/storage/buckets'
import { DOCUMENT_LIMITS, DocumentLimitError } from '@/lib/documents/limits'

export interface ResolvedFile {
  name: string
  mime_type: string
  size: number
  bytes: Uint8Array
  source: 'inline' | 'storage' | 'url' | 'text'
}

export interface ResolveFileOptions {
  tenantId: string
  /** Largest file accepted (default DOCUMENT_MAX_MB). */
  maxBytes?: number
  /** A plain (non-URL) string, or `{ text }`, is the content itself. */
  allowText?: boolean
  /** Name for errors ("Document", "Original", …). */
  label?: string
  timeoutMs?: number
  /** For tests: the fetch used for external URLs. */
  fetchImpl?: typeof fetch
}

export class FileInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileInputError'
  }
}

// fetchFile takes the run's tenant as a third argument once form attachments are merged.
const scopedFetch = fetchFile as unknown as (url: string, init?: RequestInit, options?: { tenantId?: string | null }) => Promise<Response>

// Relative /attachments/<id> links (form attachments); absolute ones go through the egress guard.
const ATTACHMENT_PATH = /^\/attachments\/[0-9a-f-]{36}(?:[/?#]|$)/i

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)
}

/** Every entry a value names (lists flattened one level; JSON text parsed; blanks dropped). */
export function fileInputValues(value: unknown): unknown[] {
  let v = value
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
      try { v = JSON.parse(t) } catch { /* plain text */ }
    }
  }
  if (Array.isArray(v)) return v.flatMap((e) => (Array.isArray(e) ? e : [e])).filter((e) => e !== null && e !== undefined && e !== '')
  return v === null || v === undefined || v === '' ? [] : [v]
}

function nameFromUrl(url: string): string {
  try {
    const last = new URL(url, 'http://x.invalid').pathname.split('/').pop() || ''
    return decodeURIComponent(last) || 'file'
  } catch {
    return 'file'
  }
}

function dispositionName(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) { try { return decodeURIComponent(star[1]) } catch { return star[1] } }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : null
}

/** Base64 (standard or URL-safe; whitespace ignored) → bytes, or null when it is not base64. */
export function decodeBase64(raw: string): Uint8Array | null {
  const clean = raw.replace(/\s+/g, '')
  if (!clean || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) return null
  return new Uint8Array(Buffer.from(clean.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
}

function parseDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]*)?((?:;[^;,]*)*?)(;base64)?,([\s\S]*)$/.exec(url)
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  if (m[3]) {
    const bytes = decodeBase64(m[4])
    return bytes ? { bytes, mime } : null
  }
  try { return { bytes: new TextEncoder().encode(decodeURIComponent(m[4])), mime } } catch { return null }
}

/**
 * The tenant check for own-storage values: null when allowed, else the reason
 * (callers report every refusal as "not found").
 */
export function ownStorageDenied(source: string, tenantId: string): string | null {
  const ref = parseOwnStorageUrl(source)
  if (!ref) return null
  if (ref.bucket === 'form-files') return null // fetchFile checks the attachment's tenant itself
  const policy = bucketPolicy(ref.bucket)
  if (!policy) return 'unknown bucket'
  const owner = policy.tenantFromKey?.(ref.key) ?? null
  if (owner && owner !== tenantId) return 'another tenant'
  if (!owner && !policy.public) return 'private object'
  return null
}

async function readCapped(response: Response, max: number, name: string): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? NaN)
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => {})
    throw new DocumentLimitError(`"${name}" is too large (${(declared / 1024 / 1024).toFixed(1)} MB; at most ${Math.round(max / 1024 / 1024)} MB)`)
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new DocumentLimitError(`"${name}" is too large (more than ${Math.round(max / 1024 / 1024)} MB)`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

async function fetchExternal(url: string, options: ResolveFileOptions, signal: AbortSignal): Promise<Response> {
  const { assertSafeEgressUrl } = await import('@/lib/egress-guard')
  const doFetch = options.fetchImpl ?? fetch
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    await assertSafeEgressUrl(current)
    const res = await doFetch(current, { redirect: 'manual', signal })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => {})
      current = new URL(res.headers.get('location')!, current).toString()
      continue
    }
    return res
  }
  throw new FileInputError('Too many redirects')
}

async function fromSource(source: string, entry: unknown, options: ResolveFileOptions, label: string): Promise<ResolvedFile> {
  const max = options.maxBytes ?? DOCUMENT_LIMITS.maxInputBytes
  const signal = AbortSignal.timeout(options.timeoutMs ?? 60_000)
  const declaredName = isObject(entry) && typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null
  const declaredMime = isObject(entry) ? String(entry.mime_type ?? entry.content_type ?? entry.contentType ?? '') || null : null
  const own = Boolean(parseOwnStorageUrl(source)) || isStorageRef(source) || ATTACHMENT_PATH.test(source)
  let response: Response
  if (own) {
    const denied = ownStorageDenied(source, options.tenantId)
    if (denied) throw new FileInputError(`${label}: file not found`)
    // Own objects are fetched by reference (works for relative /files/… links too).
    const ref = parseOwnStorageUrl(source)
    const target = ref && ref.bucket !== 'form-files' ? formatStorageRef(ref.bucket, ref.key, ref.search) : source
    response = await scopedFetch(target, { signal }, { tenantId: options.tenantId })
  } else if (/^https?:\/\//i.test(source)) {
    response = await fetchExternal(source, options, signal)
  } else {
    throw new FileInputError(`${label}: "${source.slice(0, 80)}" is not a file, URL or storage reference`)
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    throw new FileInputError(response.status === 404 ? `${label}: file not found` : `${label}: the file could not be read (HTTP ${response.status})`)
  }
  const name = declaredName ?? dispositionName(response.headers.get('content-disposition')) ?? nameFromUrl(source)
  const bytes = await readCapped(response, max, name)
  return {
    name,
    mime_type: declaredMime ?? response.headers.get('content-type')?.split(';')[0].trim() ?? 'application/octet-stream',
    size: bytes.byteLength,
    bytes,
    source: own ? 'storage' : 'url',
  }
}

function inline(bytes: Uint8Array, name: string, mime: string, options: ResolveFileOptions, source: ResolvedFile['source'] = 'inline'): ResolvedFile {
  const max = options.maxBytes ?? DOCUMENT_LIMITS.maxInputBytes
  if (bytes.byteLength > max) throw new DocumentLimitError(`"${name}" is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB; at most ${Math.round(max / 1024 / 1024)} MB)`)
  return { name, mime_type: mime, size: bytes.byteLength, bytes, source }
}

/** One entry → bytes. */
export async function resolveFileEntry(entry: unknown, options: ResolveFileOptions): Promise<ResolvedFile> {
  const label = options.label ?? 'File'
  if (entry instanceof Uint8Array) return inline(entry, 'file', 'application/octet-stream', options)
  if (entry instanceof ArrayBuffer) return inline(new Uint8Array(entry), 'file', 'application/octet-stream', options)
  if (isObject(entry)) {
    const name = String(entry.name ?? entry.file_name ?? entry.filename ?? '').trim()
    const mime = String(entry.mime_type ?? entry.content_type ?? entry.contentType ?? '').trim()
    const b64 = entry.base64 ?? entry.content_base64 ?? entry.data_base64
    if (typeof b64 === 'string' && b64) {
      const bytes = b64.startsWith('data:') ? parseDataUrl(b64)?.bytes ?? null : decodeBase64(b64)
      if (!bytes) throw new FileInputError(`${label}: the base64 content is not valid`)
      return inline(bytes, name || 'file', mime || 'application/octet-stream', options)
    }
    if (options.allowText && typeof entry.text === 'string') return inline(new TextEncoder().encode(entry.text), name || 'text.txt', mime || 'text/plain', options, 'text')
    // Form attachment → its storage reference; generated file → ref / url.
    const candidates = [entry.storage_ref, entry.ref, entry.url, entry.file_url, entry.href]
    const source = candidates.find((c): c is string => typeof c === 'string' && c.trim() !== '')
    if (source) {
      const s = source.trim()
      if (s.startsWith('data:')) {
        const parsed = parseDataUrl(s)
        if (!parsed) throw new FileInputError(`${label}: the data URL is not valid`)
        return inline(parsed.bytes, name || 'file', mime || parsed.mime, options)
      }
      return fromSource(s, entry, options, label)
    }
    throw new FileInputError(`${label}: the value is not a file (expected a file object with a url, a storage reference or base64 content)`)
  }
  if (typeof entry === 'string') {
    const s = entry.trim()
    if (s.startsWith('data:')) {
      const parsed = parseDataUrl(s)
      if (!parsed) throw new FileInputError(`${label}: the data URL is not valid`)
      return inline(parsed.bytes, 'file', parsed.mime, options)
    }
    if (isStorageRef(s) || /^https?:\/\//i.test(s) || s.startsWith('/files/') || ATTACHMENT_PATH.test(s)) return fromSource(s, entry, options, label)
    if (options.allowText) return inline(new TextEncoder().encode(entry), 'text.txt', 'text/plain', options, 'text')
    throw new FileInputError(`${label}: "${s.slice(0, 80)}" is not a file, URL or storage reference`)
  }
  throw new FileInputError(`${label}: no file given`)
}

/** A single-file input (a list → its first file). */
export async function resolveFileInput(value: unknown, options: ResolveFileOptions): Promise<ResolvedFile> {
  if (value instanceof Uint8Array) return resolveFileEntry(value, options)
  const entries = fileInputValues(value)
  if (!entries.length) {
    // An empty string is valid text content when text is allowed.
    if (options.allowText && value === '') return inline(new Uint8Array(0), 'text.txt', 'text/plain', options, 'text')
    throw new FileInputError(`${options.label ?? 'File'}: no file given`)
  }
  return resolveFileEntry(entries[0], options)
}

/** A multi-file input (merge): every file, in order, within a count and total size. */
export async function resolveFileInputs(value: unknown, options: ResolveFileOptions & { maxFiles?: number; maxTotalBytes?: number }): Promise<ResolvedFile[]> {
  const entries = fileInputValues(value)
  const maxFiles = options.maxFiles ?? DOCUMENT_LIMITS.maxMergeFiles
  if (entries.length > maxFiles) throw new FileInputError(`Too many files (${entries.length}; at most ${maxFiles})`)
  const out: ResolvedFile[] = []
  let total = 0
  for (const [k, entry] of entries.entries()) {
    const file = await resolveFileEntry(entry, { ...options, label: `${options.label ?? 'File'} ${k + 1}` })
    total += file.size
    if (options.maxTotalBytes && total > options.maxTotalBytes) throw new DocumentLimitError(`The files are larger than ${Math.round(options.maxTotalBytes / 1024 / 1024)} MB together`)
    out.push(file)
  }
  return out
}
