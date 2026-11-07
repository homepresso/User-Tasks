/**
 * Shared HTTP helpers for the media providers (server-only).
 *
 * Every request goes through ctx.fetch — never the global fetch. In the app
 * that is lib/media/http providerContext(): the shared integration runtime
 * (lib/integrations/http connectorFetch — egress guard on every hop,
 * credential headers dropped on cross-origin redirects, one timeout budget,
 * 429 retried with Retry-After, 502/503/504 for idempotent requests).
 * Errors become MediaProviderError with a safe message: the HTTP status and
 * the provider's own error text (truncated), never a key, a signature or the
 * media; 429 / 5xx that still fail are marked retryable.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */

import { MediaProviderError, type MediaBlob, type MediaCredentials, type MediaProviderContext, type MediaProviderId, type Box } from '../types'

/** Retries happen in the transport (connectorFetch); one attempt here. */
export const MAX_RETRIES = 0
export const MAX_RETRY_WAIT_MS = 10_000
const ERROR_TEXT_MAX = 300

/** Swappable sleep (tests replace it to avoid real waits). */
export const retryTiming = {
  sleep: (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('Aborted')); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Aborted')) }
    signal?.addEventListener('abort', onAbort, { once: true })
  }),
}

/** Join a base URL and a path with exactly one slash. */
export function joinUrl(base: string, path: string): string {
  return `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

/** Secret values of the credentials (to scrub from any text we surface). */
function secretsOf(credentials: MediaCredentials | undefined): string[] {
  if (!credentials) return []
  return [credentials.apiKey, credentials.secretAccessKey, credentials.sessionToken, credentials.accessKeyId]
    .filter((v): v is string => typeof v === 'string' && v.length >= 4)
}

/** Remove secrets, signatures and long base64 runs from provider text. */
export function scrubText(text: string, credentials?: MediaCredentials): string {
  let out = String(text ?? '')
  for (const secret of secretsOf(credentials)) out = out.split(secret).join('[redacted]')
  out = out
    .replace(/(Signature|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=[^&\s"']+/gi, '$1=[redacted]')
    .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/[A-Za-z0-9+/=]{200,}/g, '[data]')
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > ERROR_TEXT_MAX ? `${out.slice(0, ERROR_TEXT_MAX)}…` : out
}

/** The error text inside a provider's JSON error body (or the raw text). */
export function extractErrorMessage(body: string): string {
  const text = String(body ?? '').trim()
  if (!text) return ''
  try {
    const json = JSON.parse(text)
    const pick = (v: any): string | null => {
      if (!v) return null
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return v.map(pick).filter(Boolean).join('; ') || null
      if (typeof v === 'object') return pick(v.message) ?? pick(v.msg) ?? pick(v.detail) ?? pick(v.error) ?? pick(v.Message) ?? pick(v.title) ?? pick(v.err_msg) ?? pick(v.errors) ?? pick(v.status) ?? null
      return String(v)
    }
    // AWS JSON 1.1: {"__type":"…#ValidationException","message":"…"}
    const type = typeof json?.__type === 'string' ? json.__type.split('#').pop() : ''
    const message = pick(json?.error) ?? pick(json?.message) ?? pick(json?.Message) ?? pick(json?.detail) ?? pick(json?.err_msg) ?? pick(json?.errors) ?? pick(json?.name) ?? ''
    return [type, message].filter(Boolean).join(': ') || text
  } catch {
    // XML (S3) <Code>…</Code><Message>…</Message>
    const code = text.match(/<Code>([^<]*)<\/Code>/)?.[1]
    const message = text.match(/<Message>([^<]*)<\/Message>/)?.[1]
    if (code || message) return [code, message].filter(Boolean).join(': ')
    return text.startsWith('<') ? '' : text
  }
}

const isRetryableStatus = (status: number) => status === 429 || status >= 500

function retryAfterMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, seconds * 1000))
    const at = Date.parse(header)
    if (Number.isFinite(at)) return Math.min(MAX_RETRY_WAIT_MS, Math.max(0, at - Date.now()))
  }
  return Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt)
}

export interface RequestOptions {
  /** Don't retry (non-idempotent uploads where a retry could duplicate work). */
  noRetry?: boolean
  /** Statuses that are fine (e.g. 404 on a DELETE during cleanup). */
  okStatuses?: number[]
}

/** The provider's error as a MediaProviderError (safe message). */
export async function providerError(label: string, res: Response, credentials?: MediaCredentials): Promise<MediaProviderError> {
  let body = ''
  try { body = await res.text() } catch { /* ignore */ }
  const detail = scrubText(extractErrorMessage(body), credentials)
  const hint = res.status === 401 || res.status === 403 ? ' (check the API key and its permissions in the integration)' : ''
  return new MediaProviderError(`${label} error ${res.status}${detail ? `: ${detail}` : ''}${hint}`, res.status, isRetryableStatus(res.status))
}

/**
 * ctx.fetch with retry on 429 / 5xx / network errors and safe errors. Returns
 * the OK response (body unread).
 */
export async function mediaRequest(ctx: MediaProviderContext, label: string, url: string, init: RequestInit, options: RequestOptions = {}): Promise<Response> {
  const retries = options.noRetry ? 0 : MAX_RETRIES
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await ctx.fetch(url, { ...init, ...(ctx.signal && !init.signal ? { signal: ctx.signal } : {}) })
    } catch (error: any) {
      if (error?.name === 'AbortError' || ctx.signal?.aborted) throw error
      if (attempt < retries) { await retryTiming.sleep(Math.min(MAX_RETRY_WAIT_MS, 1000 * 2 ** attempt), ctx.signal); continue }
      if (error instanceof MediaProviderError) throw error
      throw new MediaProviderError(`${label} request failed: ${scrubText(error?.message ?? String(error), ctx.credentials)}`, undefined, true)
    }
    if (res.ok || options.okStatuses?.includes(res.status)) return res
    if (isRetryableStatus(res.status) && attempt < retries) {
      const wait = retryAfterMs(res, attempt)
      try { await res.body?.cancel() } catch { /* ignore */ }
      ctx.log?.(`${label}: HTTP ${res.status}, retrying in ${Math.round(wait / 100) / 10} s`)
      await retryTiming.sleep(wait, ctx.signal)
      continue
    }
    throw await providerError(label, res, ctx.credentials)
  }
}

/** mediaRequest + JSON body. */
export async function mediaJson<T = any>(ctx: MediaProviderContext, label: string, url: string, init: RequestInit, options?: RequestOptions): Promise<T> {
  const res = await mediaRequest(ctx, label, url, init, options)
  const text = await res.text()
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new MediaProviderError(`${label} returned a response that is not JSON`, res.status)
  }
}

/** mediaRequest + bytes. */
export async function mediaBytes(ctx: MediaProviderContext, label: string, url: string, init: RequestInit, options?: RequestOptions): Promise<{ bytes: Uint8Array; contentType: string; headers: Headers }> {
  const res = await mediaRequest(ctx, label, url, init, options)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { bytes, contentType: res.headers.get('content-type') ?? '', headers: res.headers }
}

/* ── Bodies ───────────────────────────────────────────────────────── */

export function blobOf(media: Pick<MediaBlob, 'bytes' | 'mime_type'>): Blob {
  return new Blob([media.bytes as Uint8Array<ArrayBuffer>], { type: media.mime_type || 'application/octet-stream' })
}

export type MultipartValue = string | number | boolean | null | undefined | MediaBlob | Array<string | number>

/** A multipart body (global FormData). Undefined / null / '' values are skipped; arrays repeat the field. */
export function multipart(fields: Record<string, MultipartValue>): FormData {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) { for (const v of value) form.append(name, String(v)); continue }
    if (typeof value === 'object' && 'bytes' in value) { form.append(name, blobOf(value), uploadName(value)); continue }
    form.append(name, String(value))
  }
  return form
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

export function fromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(String(value ?? ''), 'base64'))
}

export function dataUrl(media: Pick<MediaBlob, 'bytes' | 'mime_type'>): string {
  return `data:${media.mime_type || 'application/octet-stream'};base64,${toBase64(media.bytes)}`
}

/** Raw bytes as a fetch body. */
export function bytesBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}

/* ── Parsing helpers ──────────────────────────────────────────────── */

/** Parse model JSON output (tolerates ```json fences and leading prose). */
export function parseModelJson(text: string): any {
  const raw = String(text ?? '').trim()
  if (!raw) return {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : raw
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.search(/[[{]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)) } catch { /* fall through */ }
    }
    return { description: raw }
  }
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** A box clamped to the image (fractions); null when empty. */
export function normBox(x: number, y: number, width: number, height: number): Box | null {
  if (![x, y, width, height].every(Number.isFinite)) return null
  const x0 = clamp01(x)
  const y0 = clamp01(y)
  const x1 = clamp01(x + width)
  const y1 = clamp01(y + height)
  if (x1 <= x0 || y1 <= y0) return null
  return { x: round(x0), y: round(y0), width: round(x1 - x0), height: round(y1 - y0) }
}

/** Bounding box of a polygon in pixels → normalised box. */
export function polygonBox(points: Array<{ x: number; y: number }> | undefined, width: number, height: number): Box | undefined {
  if (!Array.isArray(points) || !points.length || !(width > 0) || !(height > 0)) return undefined
  const xs = points.map((p) => Number(p?.x)).filter(Number.isFinite)
  const ys = points.map((p) => Number(p?.y)).filter(Number.isFinite)
  if (!xs.length || !ys.length) return undefined
  const minX = Math.min(...xs); const maxX = Math.max(...xs)
  const minY = Math.min(...ys); const maxY = Math.max(...ys)
  return normBox(minX / width, minY / height, (maxX - minX) / width, (maxY - minY) / height) ?? undefined
}

export const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits

/** "01:02:03.5", "02:03", "75", "1m3s" → seconds. */
export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const s = String(value ?? '').trim()
  if (!s) return undefined
  if (/^\d+(\.\d+)?s?$/.test(s)) return Number(s.replace(/s$/, ''))
  const parts = s.split(':').map(Number)
  if (parts.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite)) return parts.reduce((acc, p) => acc * 60 + p, 0)
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s)?$/)
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return undefined
}

/** Distinct speaker labels in order of first appearance. */
export function speakersOf(items: Array<{ speaker?: string }>): string[] | undefined {
  const out: string[] = []
  for (const item of items) if (item.speaker && !out.includes(item.speaker)) out.push(item.speaker)
  return out.length ? out : undefined
}

/** Minutes of media for usage (from a duration in seconds). */
export function minutesOf(seconds: number | undefined): number | undefined {
  if (!Number.isFinite(seconds) || (seconds as number) <= 0) return undefined
  return round((seconds as number) / 60, 4)
}

/** Default model for an operation: option → integration extra → catalog default. */
export function modelFor(option: string | undefined, credentials: MediaCredentials, extraKey: string, fallback: string): string {
  return String(option || credentials.extra?.[extraKey] || fallback).trim()
}

export function requireKey(credentials: MediaCredentials, label: string): string {
  const key = credentials.apiKey
  if (!key) throw new MediaProviderError(`${label}: the integration has no API key`)
  return key
}

/** A stable id for a provider. */
export type ProviderLabel = { id: MediaProviderId; label: string }

/** Extension for a mime type (upload file names). */
export function extensionFor(mime: string): string {
  const m = String(mime ?? '').toLowerCase().split(';')[0].trim()
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/mpeg': 'mpeg',
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  }
  return map[m] ?? 'bin'
}

/** File name with an extension the provider can sniff. */
export function uploadName(media: MediaBlob): string {
  const name = String(media.name || '').trim()
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name
  return `${name || 'media'}.${extensionFor(media.mime_type)}`
}

/** Speech output mime types. */
export const SPEECH_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/L16',
}

/** Pixel size of a PNG / JPEG / GIF / WebP / BMP from its header, or null. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const b = bytes
  const u16be = (i: number) => (b[i] << 8) | b[i + 1]
  const u16le = (i: number) => b[i] | (b[i + 1] << 8)
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: u16le(6), height: u16le(8) }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: Math.abs(b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24)), height: Math.abs(b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] << 24)) }
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (kind === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff }
    if (kind === 'VP8L') { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 } }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = u16be(i + 2)
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: u16be(i + 7), height: u16be(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}
