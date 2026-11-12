/**
 * Media fields: Image (a picture the person provides), Display image (a
 * static picture in the layout) and Signature (an electronic signature).
 *
 * Image and Signature reuse the Attachments upload pipeline
 * (lib/services/form-files.ts): private `form-files` storage, pending until
 * the form is submitted, content sniffing (only real images pass), size
 * limits, the optional virus scan — and on top, metadata stripping
 * (lib/forms/image-metadata.ts: EXIF / GPS / text chunks). Their config is
 * turned into an Attachments config (imageUploadConfig / SIGNATURE_UPLOAD_CONFIG)
 * so every check of that pipeline applies unchanged.
 *
 * Stored values:
 *   image      ONE file object (AttachmentFile) or null — `{{form.photo}}`
 *              is that object (an Attachments field holds an array).
 *   signature  { file: AttachmentFile (PNG), method: 'draw' | 'type',
 *              typed_name?, signed_at, user_id?, user_name?, ip?, user_agent? }
 *              — user_id / user_name / signed_at / ip / user_agent are set by
 *              the server (stampSignature), never taken from the browser.
 *   display_image  no value (a display element).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  fileExtension, formatBytes, isAttachmentFile, kindForExtension, normalizeAttachmentValue, sanitizeFileName,
  type AttachmentFile, type AttachmentsConfig,
} from './attachments'

/* ── Image ───────────────────────────────────────────────────────────── */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif'
export const IMAGE_FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp', 'gif']
export const IMAGE_FORMAT_LABELS: Record<ImageFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF' }
const FORMAT_EXTENSIONS: Record<ImageFormat, string[]> = { png: ['png'], jpeg: ['jpg', 'jpeg', 'jpe'], webp: ['webp'], gif: ['gif'] }
const FORMAT_MIME: Record<ImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

export const IMAGE_DEFAULT_MAX_MB = 10
export const IMAGE_MAX_MB = 20

/** A picture shown before the person provides their own (an imported default): a stored image. */
export interface ImageDefaultFile {
  name: string
  /** An https URL or the app's own storage (storage:// reference, /files/… path). */
  url: string
  mime_type?: string
  size?: number
}

export interface ImageFieldConfig {
  /** Largest picture in MB (default 10, at most 20; the instance cap FORM_ATTACHMENT_MAX_MB wins). */
  max_mb?: number
  /** Offer the camera on phones (`capture="environment"`). */
  camera?: boolean
  /** Allowed formats (default: all four). */
  types?: ImageFormat[]
  /** The picture the field starts with (kept when the person doesn't replace it). */
  default_file?: ImageDefaultFile
}

function numIn(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10))
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}

/** A stored image's URL: https, the app's storage (storage://, /files/…) or an /attachments/ path. */
export function isImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  const v = value.trim()
  if (/[\s'"()<>\\]/.test(v)) return false
  if (/^storage:\/\/[a-z0-9-]+\/[A-Za-z0-9_.%/-]+(\?[A-Za-z0-9=&_.-]*)?$/.test(v) && !v.includes('..')) return true
  if (/^\/(files|attachments)\/[A-Za-z0-9_.%/-]+(\?[A-Za-z0-9=&_.-]*)?$/.test(v) && !v.includes('..')) return true
  try {
    const url = new URL(v)
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname)
  } catch {
    return false
  }
}

/** A default picture (an object, or JSON text of one) → clean, or undefined. */
export function normalizeImageDefault(raw: unknown): ImageDefaultFile | undefined {
  let value = raw
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try { value = JSON.parse(value) } catch { return undefined }
  }
  if (!isPlainObject(value) || !isImageUrl(value.url)) return undefined
  const name = sanitizeFileName(typeof value.name === 'string' ? value.name : '', 'image')
  const out: ImageDefaultFile = { name, url: String(value.url).trim() }
  const mime = typeof value.mime_type === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(value.mime_type) ? value.mime_type
    : (() => { const k = kindForExtension(fileExtension(name)); return k && k.groups.includes('images') ? k.mime : undefined })()
  if (mime) out.mime_type = mime
  const size = Number(value.size)
  if (Number.isFinite(size) && size > 0) out.size = Math.floor(size)
  return out
}

export function normalizeImageConfig(raw: unknown): ImageFieldConfig {
  const c = isPlainObject(raw) ? raw : {}
  const out: ImageFieldConfig = {}
  const mb = numIn(c.max_mb, 0.1, IMAGE_MAX_MB)
  if (mb !== undefined) out.max_mb = mb
  if (c.camera === true) out.camera = true
  if (Array.isArray(c.types)) {
    const types = IMAGE_FORMATS.filter((t) => (c.types as unknown[]).map((v) => String(v).toLowerCase().replace(/^jpg$/, 'jpeg')).includes(t))
    if (types.length && types.length < IMAGE_FORMATS.length) out.types = types
  }
  const def = normalizeImageDefault(c.default_file)
  if (def) out.default_file = def
  return out
}

export function imageFormats(config: ImageFieldConfig | undefined): ImageFormat[] {
  return config?.types?.length ? config.types : IMAGE_FORMATS
}

/** The Attachments config the upload pipeline checks an Image field's picture against. */
export function imageUploadConfig(config: ImageFieldConfig | undefined): AttachmentsConfig {
  return {
    max_files: 1,
    max_file_mb: Math.min(config?.max_mb ?? IMAGE_DEFAULT_MAX_MB, IMAGE_MAX_MB),
    custom_types: imageFormats(config).flatMap((t) => FORMAT_EXTENSIONS[t].map((e) => `.${e}`)),
  }
}

/** The file input's `accept`: extensions and MIME types of the allowed formats. */
export function imageAccept(config: ImageFieldConfig | undefined): string {
  return imageFormats(config).flatMap((t) => [FORMAT_MIME[t], ...FORMAT_EXTENSIONS[t].map((e) => `.${e}`)]).join(',')
}

/** "PNG, JPEG, WebP or GIF up to 10 MB". */
export function describeImageLimits(config: ImageFieldConfig | undefined): string {
  const labels = imageFormats(config).map((t) => IMAGE_FORMAT_LABELS[t])
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}` : labels[0]
  return `${list} up to ${formatBytes(Math.floor((config?.max_mb ?? IMAGE_DEFAULT_MAX_MB) * 1024 * 1024))}`
}

/** The value a default picture stands for (no upload record: `id` is empty, `is_default` true). */
export function imageDefaultValue(def: ImageDefaultFile): AttachmentFile & { is_default: true } {
  return {
    id: '', name: def.name, size: def.size ?? 0, mime_type: def.mime_type ?? 'image/png', url: def.url,
    storage_ref: def.url.startsWith('storage://') ? def.url : '', uploaded_by: null, uploaded_at: '', checksum_sha256: '', is_default: true,
  }
}

/** An Image value that is the field's default picture (as stored / sent back). */
export function isImageDefaultValue(value: unknown): boolean {
  return isPlainObject(value) && value.is_default === true
}

/**
 * An Image value as one clean file object or null: a file object, a list of
 * one, a bare file id or JSON text of one. The default picture reads as null
 * (the server puts it back). Anything else → null.
 */
export function normalizeImageValue(value: unknown): AttachmentFile | null {
  if (isImageDefaultValue(value)) return null
  let v = value
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { v = JSON.parse(v) } catch { return null }
  }
  const files = normalizeAttachmentValue(Array.isArray(v) ? v : v === null || v === undefined ? [] : [v])
  return files[0] ?? null
}

/** Is the raw value shaped like an Image value (blank, the default, or exactly one file)? */
export function isImageValueShape(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || isImageDefaultValue(value)) return true
  let v = value
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { v = JSON.parse(v) } catch { return false }
  }
  const list = Array.isArray(v) ? v : [v]
  if (list.length > 1) return false
  if (list.length === 0) return true
  return normalizeAttachmentValue(list).length === 1
}

/** Type / size of an Image field's picture (null = fine). `instanceMaxMb`: FORM_ATTACHMENT_MAX_MB when known. */
export function imageValueError(field: { label: string; image?: ImageFieldConfig }, value: unknown, options: { instanceMaxMb?: number } = {}): string | null {
  if (!isImageValueShape(value)) return `${field.label} must be one picture`
  const file = normalizeImageValue(value)
  if (!file || !file.name) return null
  const maxMb = Math.min(field.image?.max_mb ?? IMAGE_DEFAULT_MAX_MB, IMAGE_MAX_MB, options.instanceMaxMb ?? IMAGE_MAX_MB)
  if (file.size > Math.floor(maxMb * 1024 * 1024)) return `${field.label}: the picture is larger than ${formatBytes(Math.floor(maxMb * 1024 * 1024))}`
  const ext = fileExtension(file.name)
  const allowed = imageFormats(field.image).flatMap((t) => FORMAT_EXTENSIONS[t])
  if (!allowed.includes(ext)) return `${field.label}: use a ${imageFormats(field.image).map((t) => IMAGE_FORMAT_LABELS[t]).join(', ')} picture`
  if (file.mime_type && file.mime_type !== 'application/octet-stream' && !/^image\//.test(file.mime_type)) return `${field.label}: the file is not a picture`
  return null
}

/* ── Display image ───────────────────────────────────────────────────── */

export type DisplayImageWidth = 'sm' | 'md' | 'lg' | 'full'
export type DisplayImageAlign = 'left' | 'center' | 'right'
export const DISPLAY_IMAGE_WIDTHS: DisplayImageWidth[] = ['sm', 'md', 'lg', 'full']
export const DISPLAY_IMAGE_ALIGNS: DisplayImageAlign[] = ['left', 'center', 'right']
/** Largest inline `data:` image (prefer stored files: uploadFormImage). */
export const DISPLAY_IMAGE_MAX_DATA_BYTES = 512 * 1024

export interface DisplayImageConfig {
  /** An https URL, the app's own storage (storage:// reference / /files/… path) or a small data:image/(png|jpeg|webp|gif);base64. */
  src: string
  /** Text alternative (WCAG 1.1.1); the accessibility checker flags an empty one. */
  alt: string
  /** sm 160px · md 320px (default) · lg 480px · full the cell's width. */
  width?: DisplayImageWidth
  align?: DisplayImageAlign
}

const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/

/** Problem with a display image's source (null = fine). */
export function displayImageSrcProblem(src: unknown): string | null {
  if (typeof src !== 'string' || !src.trim()) return 'Choose an image (upload one or give an https address)'
  const s = src.trim()
  if (/^data:/i.test(s)) {
    const m = DATA_IMAGE_RE.exec(s)
    if (!m) return 'Only PNG, JPEG, WebP or GIF data: images (base64) are allowed'
    const bytes = Math.floor((m[2].length * 3) / 4)
    if (bytes > DISPLAY_IMAGE_MAX_DATA_BYTES) return 'An inline image must be under 512 KB — upload it instead'
    return null
  }
  if (s.length > 2048) return 'The image address is too long'
  if (!isImageUrl(s)) return 'Use an https address or an uploaded image'
  return null
}

export function normalizeDisplayImageConfig(raw: unknown): DisplayImageConfig {
  const c = isPlainObject(raw) ? raw : {}
  const src = typeof c.src === 'string' && !displayImageSrcProblem(c.src) ? c.src.trim() : ''
  const out: DisplayImageConfig = { src, alt: cleanText(c.alt, 500)?.replace(/[<>]/g, '') ?? '' }
  if (DISPLAY_IMAGE_WIDTHS.includes(c.width as DisplayImageWidth) && c.width !== 'md') out.width = c.width as DisplayImageWidth
  if (DISPLAY_IMAGE_ALIGNS.includes(c.align as DisplayImageAlign) && c.align !== 'left') out.align = c.align as DisplayImageAlign
  return out
}

/** A display image's blocking problem (null = fine): no usable source. A missing alt is an accessibility finding. */
export function displayImageConfigProblem(config: DisplayImageConfig | undefined): string | null {
  return displayImageSrcProblem(config?.src)
}

export const DISPLAY_IMAGE_MAX_WIDTH_PX: Record<DisplayImageWidth, number | null> = { sm: 160, md: 320, lg: 480, full: null }

/* ── Signature ───────────────────────────────────────────────────────── */

export type SignatureMode = 'draw' | 'type' | 'both'
export const SIGNATURE_MODES: SignatureMode[] = ['draw', 'type', 'both']
export type SignatureMethod = 'draw' | 'type'

export const SIGNATURE_DISCLAIMER = 'This is an electronic signature, not a cryptographic digital signature.'

export interface SignatureFieldConfig {
  /** Draw, type or both (default both). */
  mode?: SignatureMode
  /** Shown above the pad, e.g. "I confirm the above is correct". */
  statement?: string
  /** Record the signer's IP address and browser (user agent) — set by the server. Default off. */
  capture_audit?: boolean
  /** Changing another answer after signing (in the same session) clears the signature: sign again. Default off. */
  resign_on_change?: boolean
}

export interface SignatureValue {
  /** The signature as a PNG (drawn, or the typed name rendered in a script font). */
  file: AttachmentFile
  method: SignatureMethod
  /** The name typed (method 'type'). */
  typed_name?: string
  /** When it was signed (ISO; the server's time when missing / implausible). */
  signed_at: string
  /** The signed-in person (server-set). */
  user_id?: string
  user_name?: string
  /** capture_audit only (server-set). */
  ip?: string
  user_agent?: string
}

/** The Attachments config a signature's PNG is checked against: one PNG, at most 1 MB. */
export const SIGNATURE_UPLOAD_CONFIG: AttachmentsConfig = { max_files: 1, max_file_mb: 1, custom_types: ['.png'] }

export function normalizeSignatureConfig(raw: unknown): SignatureFieldConfig {
  const c = isPlainObject(raw) ? raw : {}
  const out: SignatureFieldConfig = {}
  if (c.mode === 'draw' || c.mode === 'type') out.mode = c.mode
  const statement = cleanText(c.statement, 1000)
  if (statement) out.statement = statement
  if (c.capture_audit === true) out.capture_audit = true
  if (c.resign_on_change === true) out.resign_on_change = true
  return out
}

export function signatureMethods(config: SignatureFieldConfig | undefined): SignatureMethod[] {
  const mode = config?.mode ?? 'both'
  return mode === 'both' ? ['draw', 'type'] : [mode]
}

/**
 * A signature value, cleaned (only the known keys, typed), or null when it
 * isn't one (no file object, unknown method). JSON text is read.
 */
export function normalizeSignatureValue(value: unknown): SignatureValue | null {
  let v = value
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try { v = JSON.parse(v) } catch { return null }
  }
  if (!isPlainObject(v) || !isAttachmentFile(v.file)) return null
  const file = normalizeAttachmentValue([v.file])[0]
  if (!file) return null
  if (v.method !== 'draw' && v.method !== 'type') return null
  const out: SignatureValue = { file, method: v.method, signed_at: typeof v.signed_at === 'string' ? v.signed_at.slice(0, 40) : '' }
  const typed = cleanText(v.typed_name, 200)
  if (typed) out.typed_name = typed
  for (const key of ['user_id', 'user_name', 'ip', 'user_agent'] as const) {
    const text = cleanText(v[key], key === 'user_agent' ? 500 : 200)
    if (text) out[key] = text
  }
  return out
}

function isBlankValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** Shape rules for a signature value (null = fine). Blank values are judged by `required` elsewhere. */
export function signatureValueError(field: { label: string; signature?: SignatureFieldConfig }, value: unknown): string | null {
  if (isBlankValue(value)) return null
  const sig = normalizeSignatureValue(value)
  if (!sig) return `${field.label} has an invalid signature`
  if (!signatureMethods(field.signature).includes(sig.method)) return `${field.label}: ${sig.method === 'draw' ? 'drawn' : 'typed'} signatures are not allowed here`
  if (sig.method === 'type' && !sig.typed_name) return `${field.label}: type your name to sign`
  if (sig.file.name && fileExtension(sig.file.name) !== 'png') return `${field.label}: the signature must be a PNG image`
  if (sig.file.mime_type && sig.file.mime_type !== 'application/octet-stream' && sig.file.mime_type !== 'image/png') return `${field.label}: the signature must be a PNG image`
  if (sig.file.size > 1024 * 1024) return `${field.label}: the signature image is too large`
  return null
}

export interface SignatureStampInput {
  /** The server's clock (tests pass one). */
  now?: Date
  /** The signed-in person (absent: anonymous / API key — no user is recorded). */
  user?: { id: string; name?: string | null } | null
  /** The request (used only when the field has capture_audit). */
  request?: { ip?: string | null; user_agent?: string | null } | null
  /** The value stored before (a draft): the same PNG keeps its original stamp. */
  previous?: unknown
}

/** How far before "now" a browser-sent signed_at is believed (the form may have been open a while). */
const SIGNED_AT_WINDOW_MS = 24 * 3_600_000
/** Clock skew allowed into the future. */
const SIGNED_AT_SKEW_MS = 5 * 60_000

/**
 * The stored signature: the browser's file / method / typed name, with the
 * metadata the SERVER decides — user_id / user_name from the session (never
 * the browser's), signed_at (the browser's time only when plausible: within
 * the last 24 hours and not in the future; else now), and ip / user_agent
 * only when the field asks for them (capture_audit). A value already stored
 * for the same PNG (a saved draft) keeps its stamp.
 */
export function stampSignature(field: { signature?: SignatureFieldConfig }, value: unknown, input: SignatureStampInput = {}): SignatureValue | null {
  const sig = normalizeSignatureValue(value)
  if (!sig) return null
  const prev = normalizeSignatureValue(input.previous)
  const out: SignatureValue = { file: sig.file, method: sig.method, signed_at: '' }
  if (sig.method === 'type' && sig.typed_name) out.typed_name = sig.typed_name
  if (prev && prev.file.id === sig.file.id && prev.signed_at) {
    out.signed_at = prev.signed_at
    if (prev.user_id) out.user_id = prev.user_id
    if (prev.user_name) out.user_name = prev.user_name
    if (field.signature?.capture_audit) {
      if (prev.ip) out.ip = prev.ip
      if (prev.user_agent) out.user_agent = prev.user_agent
    }
    return out
  }
  const now = input.now ?? new Date()
  const sent = sig.signed_at ? new Date(sig.signed_at).getTime() : NaN
  const plausible = Number.isFinite(sent) && sent <= now.getTime() + SIGNED_AT_SKEW_MS && sent >= now.getTime() - SIGNED_AT_WINDOW_MS
  out.signed_at = plausible ? new Date(Math.min(sent, now.getTime())).toISOString() : now.toISOString()
  if (input.user?.id) {
    out.user_id = input.user.id
    const name = cleanText(input.user.name ?? undefined, 200)
    if (name) out.user_name = name
  }
  if (field.signature?.capture_audit && input.request) {
    const ip = cleanText(input.request.ip ?? undefined, 100)
    const ua = cleanText(input.request.user_agent ?? undefined, 500)
    if (ip) out.ip = ip
    if (ua) out.user_agent = ua
  }
  return out
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "11 Nov 2026 14:02" in `timeZone` (default: the runtime's). */
export function formatSignedAt(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}),
    }).formatToParts(d).map((p) => [p.type, p.value]))
    return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year} ${parts.hour}:${parts.minute}`
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** "Signed by Ada Lovelace on 11 Nov 2026 14:02" (the typed name when no user is recorded). */
export function describeSignature(value: unknown, timeZone?: string): string {
  const sig = normalizeSignatureValue(value)
  if (!sig) return '—'
  const who = sig.user_name || sig.typed_name
  const when = sig.signed_at ? formatSignedAt(sig.signed_at, timeZone) : ''
  return `Signed${who ? ` by ${who}` : ''}${when ? ` on ${when}` : ''}`
}

/** The file ids a media field's value names (for the upload records). */
export function mediaFileIds(type: 'image' | 'signature', value: unknown): string[] {
  if (type === 'image') { const f = normalizeImageValue(value); return f ? [f.id] : [] }
  const sig = normalizeSignatureValue(value)
  return sig ? [sig.file.id] : []
}
