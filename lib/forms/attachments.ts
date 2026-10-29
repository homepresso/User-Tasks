/**
 * Attachments fields: the form field type that takes one or more uploaded
 * files.
 *
 * The config lives on the field (`field.attachments`), so it travels with
 * the form (node config, reusable forms, task metadata, exports and
 * packages); uploaded files never do. Uploads go to the private
 * `form-files` bucket through the app (lib/services/form-files.ts), are
 * "pending" until the form is submitted / the task saved, and are served
 * only through the authorised /attachments/<id> route.
 *
 * Stored value (`task_data.<key>` / `form.<key>`): an ARRAY of file objects
 *
 *   { id, name, size, mime_type, url, storage_ref, uploaded_by, uploaded_at, checksum_sha256 }
 *
 * rebuilt by the server from its own records on every save (never taken
 * from the client), plus `<key>_count` (the number of files).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type AttachmentTypePreset = 'documents' | 'images' | 'spreadsheets' | 'pdf' | 'any'

export const ATTACHMENT_TYPE_PRESETS: AttachmentTypePreset[] = ['documents', 'images', 'spreadsheets', 'pdf', 'any']

export const ATTACHMENT_TYPE_PRESET_LABELS: Record<AttachmentTypePreset, string> = {
  documents: 'Documents',
  images: 'Images',
  spreadsheets: 'Spreadsheets',
  pdf: 'PDF only',
  any: 'Any (safe) file',
}

export interface AttachmentsConfig {
  /** At least this many files (default: 1 when required, else 0). */
  min_files?: number
  /** At most this many files (default 10). */
  max_files?: number
  /** Largest single file in MB (default 10; the instance cap FORM_ATTACHMENT_MAX_MB wins). */
  max_file_mb?: number
  /** All files together in MB (default: max files × max size, at most 200). */
  max_total_mb?: number
  /** Allowed kinds (default: any). */
  types?: AttachmentTypePreset[]
  /** Extra allowed types: `.ext` or MIME types (`application/pdf`, `image/*`). */
  custom_types?: string[]
  /** Offer the camera on phones (images allowed). */
  camera?: boolean
}

export const ATTACHMENT_DEFAULTS = { max_files: 10, max_file_mb: 10 } as const

export const ATTACHMENT_LIMITS = {
  /** Files per field. */
  maxFiles: 50,
  /** Hard cap per file whatever the configuration (the request body limit leaves room for 45 MB). */
  maxFileMb: 45,
  /** All files of one field. */
  maxTotalMb: 500,
  /** Custom type entries. */
  maxCustomTypes: 40,
  /** Display names. */
  maxNameLength: 150,
} as const

/** One uploaded file as stored in a field's value. */
export interface AttachmentFile {
  id: string
  name: string
  size: number
  mime_type: string
  /** Authorised app URL (/attachments/<id>): signed-in users who may see the task / submission. */
  url: string
  /** `storage://form-files/<tenant>/…`: the workflow engine reads the bytes through the storage provider. */
  storage_ref: string
  uploaded_by: string | null
  uploaded_at: string
  checksum_sha256: string
}

/* ── File kinds ──────────────────────────────────────────────────────── */

export type FileKindGroup = 'documents' | 'images' | 'spreadsheets' | 'pdf' | 'other'

export interface FileKind {
  id: string
  label: string
  extensions: string[]
  mime: string
  groups: FileKindGroup[]
  /** How the server recognises the content (lib/forms/attachment-sniff.ts). */
  magic: 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic' | 'ooxml-word' | 'ooxml-sheet' | 'ooxml-slides' | 'odf' | 'zip' | 'ole' | 'rtf' | 'text' | 'svg' | 'mp4' | 'mp3' | 'wav'
}

const OOXML = 'application/vnd.openxmlformats-officedocument'

export const FILE_KINDS: FileKind[] = [
  { id: 'pdf', label: 'PDF', extensions: ['pdf'], mime: 'application/pdf', groups: ['documents', 'pdf'], magic: 'pdf' },
  { id: 'docx', label: 'Word', extensions: ['docx'], mime: `${OOXML}.wordprocessingml.document`, groups: ['documents'], magic: 'ooxml-word' },
  { id: 'doc', label: 'Word 97–2003', extensions: ['doc'], mime: 'application/msword', groups: ['documents'], magic: 'ole' },
  { id: 'odt', label: 'OpenDocument text', extensions: ['odt'], mime: 'application/vnd.oasis.opendocument.text', groups: ['documents'], magic: 'odf' },
  { id: 'rtf', label: 'Rich text', extensions: ['rtf'], mime: 'application/rtf', groups: ['documents'], magic: 'rtf' },
  { id: 'txt', label: 'Text', extensions: ['txt', 'text', 'log'], mime: 'text/plain', groups: ['documents'], magic: 'text' },
  { id: 'md', label: 'Markdown', extensions: ['md', 'markdown'], mime: 'text/markdown', groups: ['documents'], magic: 'text' },
  { id: 'pptx', label: 'PowerPoint', extensions: ['pptx'], mime: `${OOXML}.presentationml.presentation`, groups: ['documents'], magic: 'ooxml-slides' },
  { id: 'ppt', label: 'PowerPoint 97–2003', extensions: ['ppt'], mime: 'application/vnd.ms-powerpoint', groups: ['documents'], magic: 'ole' },
  { id: 'odp', label: 'OpenDocument presentation', extensions: ['odp'], mime: 'application/vnd.oasis.opendocument.presentation', groups: ['documents'], magic: 'odf' },
  { id: 'xlsx', label: 'Excel', extensions: ['xlsx'], mime: `${OOXML}.spreadsheetml.sheet`, groups: ['spreadsheets'], magic: 'ooxml-sheet' },
  { id: 'xls', label: 'Excel 97–2003', extensions: ['xls'], mime: 'application/vnd.ms-excel', groups: ['spreadsheets'], magic: 'ole' },
  { id: 'ods', label: 'OpenDocument spreadsheet', extensions: ['ods'], mime: 'application/vnd.oasis.opendocument.spreadsheet', groups: ['spreadsheets'], magic: 'odf' },
  { id: 'csv', label: 'CSV', extensions: ['csv'], mime: 'text/csv', groups: ['spreadsheets'], magic: 'text' },
  { id: 'tsv', label: 'TSV', extensions: ['tsv'], mime: 'text/tab-separated-values', groups: ['spreadsheets'], magic: 'text' },
  { id: 'png', label: 'PNG', extensions: ['png'], mime: 'image/png', groups: ['images'], magic: 'png' },
  { id: 'jpeg', label: 'JPEG', extensions: ['jpg', 'jpeg', 'jpe'], mime: 'image/jpeg', groups: ['images'], magic: 'jpeg' },
  { id: 'gif', label: 'GIF', extensions: ['gif'], mime: 'image/gif', groups: ['images'], magic: 'gif' },
  { id: 'webp', label: 'WebP', extensions: ['webp'], mime: 'image/webp', groups: ['images'], magic: 'webp' },
  { id: 'heic', label: 'HEIC', extensions: ['heic', 'heif'], mime: 'image/heic', groups: ['images'], magic: 'heic' },
  { id: 'bmp', label: 'Bitmap', extensions: ['bmp'], mime: 'image/bmp', groups: ['images'], magic: 'bmp' },
  { id: 'tiff', label: 'TIFF', extensions: ['tif', 'tiff'], mime: 'image/tiff', groups: ['images'], magic: 'tiff' },
  { id: 'svg', label: 'SVG', extensions: ['svg'], mime: 'image/svg+xml', groups: ['images'], magic: 'svg' },
  { id: 'json', label: 'JSON', extensions: ['json'], mime: 'application/json', groups: ['other'], magic: 'text' },
  { id: 'zip', label: 'ZIP archive', extensions: ['zip'], mime: 'application/zip', groups: ['other'], magic: 'zip' },
  { id: 'msg', label: 'Outlook message', extensions: ['msg'], mime: 'application/vnd.ms-outlook', groups: ['other'], magic: 'ole' },
  { id: 'eml', label: 'Email message', extensions: ['eml'], mime: 'message/rfc822', groups: ['other'], magic: 'text' },
  { id: 'mp4', label: 'MP4 video', extensions: ['mp4', 'm4v'], mime: 'video/mp4', groups: ['other'], magic: 'mp4' },
  { id: 'mov', label: 'QuickTime video', extensions: ['mov'], mime: 'video/quicktime', groups: ['other'], magic: 'mp4' },
  { id: 'mp3', label: 'MP3 audio', extensions: ['mp3'], mime: 'audio/mpeg', groups: ['other'], magic: 'mp3' },
  { id: 'wav', label: 'WAV audio', extensions: ['wav'], mime: 'audio/wav', groups: ['other'], magic: 'wav' },
]

const KIND_BY_EXTENSION = new Map<string, FileKind>(FILE_KINDS.flatMap((kind) => kind.extensions.map((ext) => [ext, kind] as const)))

/**
 * Never accepted, whatever the configuration: executables and installers,
 * scripts, shortcuts, macro-enabled Office files, web pages and disk images.
 */
export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'dll', 'com', 'bat', 'cmd', 'msi', 'msp', 'mst', 'msix', 'appx', 'scr', 'pif', 'cpl', 'sys', 'drv', 'ocx',
  'ps1', 'psm1', 'psd1', 'ps1xml', 'vb', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'ts', 'wsf', 'wsh', 'wsc', 'hta', 'jar', 'class',
  'sh', 'bash', 'zsh', 'csh', 'ksh', 'fish', 'command', 'run', 'bin', 'elf', 'so', 'dylib', 'o',
  'app', 'apk', 'aab', 'ipa', 'deb', 'rpm', 'pkg', 'dmg', 'iso', 'img', 'vhd', 'vhdx', 'vmdk',
  'html', 'htm', 'xhtml', 'shtml', 'mht', 'mhtml', 'xht', 'svgz', 'xml', 'xsl', 'xslt',
  'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'pyc', 'rb', 'lua',
  'lnk', 'url', 'website', 'reg', 'inf', 'scf', 'gadget', 'application', 'settingcontent-ms', 'library-ms',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'xll', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
  'chm', 'hlp', 'msc', 'jnlp', 'ade', 'adp', 'mde', 'accde',
])

/* ── Names ───────────────────────────────────────────────────────────── */

/** Lower-case extension of a file name ('' when none). */
export function fileExtension(name: string): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20)
}

/**
 * A safe display name: no path, no control / bidi characters, no leading
 * dots, collapsed spaces, at most 150 characters (the extension kept).
 */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  let clean = String(name ?? '')
    .normalize('NFKC')
    .split(/[\\/]/).pop()!
    // Control characters, bidi overrides / isolates, zero-width characters.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
  if (clean.length > ATTACHMENT_LIMITS.maxNameLength) {
    const ext = fileExtension(clean)
    const keep = ext ? ATTACHMENT_LIMITS.maxNameLength - ext.length - 1 : ATTACHMENT_LIMITS.maxNameLength
    clean = `${clean.slice(0, keep).trimEnd()}${ext ? `.${ext}` : ''}`
  }
  return clean || fallback
}

/** ASCII name for the storage key (the display name keeps the original). */
export function storageSafeName(name: string): string {
  const clean = sanitizeFileName(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  return clean || 'file'
}

/** `12 KB`, `3.4 MB`. */
export function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function kindForExtension(ext: string): FileKind | null {
  return KIND_BY_EXTENSION.get(String(ext ?? '').toLowerCase()) ?? null
}

/** The key a field's file count is stored under. */
export function attachmentsCountKey(key: string): string {
  return `${key}_count`
}

/* ── Config ──────────────────────────────────────────────────────────── */

function intIn(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function numIn(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10))
}

/** `.PDF` → `.pdf`, `Image/*` → `image/*`; anything else dropped. */
function normalizeCustomType(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (/^\.?[a-z0-9][a-z0-9-]{0,19}$/.test(s)) {
    const ext = s.replace(/^\./, '')
    return BLOCKED_EXTENSIONS.has(ext) ? null : `.${ext}`
  }
  if (/^[a-z0-9][a-z0-9.+-]{0,63}\/(?:\*|[a-z0-9][a-z0-9.+-]{0,99})$/.test(s)) return s
  return null
}

export function normalizeAttachmentsConfig(raw: unknown): AttachmentsConfig {
  const c = isPlainObject(raw) ? raw : {}
  const out: AttachmentsConfig = {}
  const min = intIn(c.min_files, 0, ATTACHMENT_LIMITS.maxFiles)
  const max = intIn(c.max_files, 1, ATTACHMENT_LIMITS.maxFiles)
  const fileMb = numIn(c.max_file_mb, 0.1, ATTACHMENT_LIMITS.maxFileMb)
  const totalMb = numIn(c.max_total_mb, 0.1, ATTACHMENT_LIMITS.maxTotalMb)
  if (min !== undefined && min > 0) out.min_files = min
  if (max !== undefined) out.max_files = max
  if (fileMb !== undefined) out.max_file_mb = fileMb
  if (totalMb !== undefined) out.max_total_mb = totalMb
  if (Array.isArray(c.types)) {
    const types = [...new Set(c.types.filter((t): t is AttachmentTypePreset => (ATTACHMENT_TYPE_PRESETS as unknown[]).includes(t)))]
    if (types.length) out.types = types.includes('any') ? ['any'] : types
  }
  if (Array.isArray(c.custom_types)) {
    const custom = [...new Set(c.custom_types.map(normalizeCustomType).filter((t): t is string => Boolean(t)))].slice(0, ATTACHMENT_LIMITS.maxCustomTypes)
    if (custom.length) out.custom_types = custom
  }
  if (c.camera === true) out.camera = true
  return out
}

/** Resolved limits of a field (defaults applied; `instanceMaxMb` = FORM_ATTACHMENT_MAX_MB when known). */
export function attachmentLimits(config: AttachmentsConfig | undefined, options: { required?: boolean; instanceMaxMb?: number } = {}) {
  const c = config ?? {}
  const maxFiles = c.max_files ?? ATTACHMENT_DEFAULTS.max_files
  const minFiles = Math.min(maxFiles, c.min_files ?? (options.required ? 1 : 0))
  const cap = Math.min(ATTACHMENT_LIMITS.maxFileMb, options.instanceMaxMb ?? ATTACHMENT_LIMITS.maxFileMb)
  const fileMb = Math.min(c.max_file_mb ?? ATTACHMENT_DEFAULTS.max_file_mb, cap)
  const totalMb = c.max_total_mb ?? Math.min(maxFiles * fileMb, 200)
  return {
    minFiles,
    maxFiles,
    maxFileBytes: Math.floor(fileMb * 1024 * 1024),
    maxTotalBytes: Math.floor(totalMb * 1024 * 1024),
  }
}

/** Problem with a field's config (null = fine). */
export function attachmentsConfigProblem(config: AttachmentsConfig | undefined): string | null {
  const c = config ?? {}
  const max = c.max_files ?? ATTACHMENT_DEFAULTS.max_files
  if (c.min_files !== undefined && c.min_files > max) return 'Minimum files is greater than maximum files'
  const fileMb = c.max_file_mb ?? ATTACHMENT_DEFAULTS.max_file_mb
  if (c.max_total_mb !== undefined && c.max_total_mb < fileMb) return 'The total size limit is smaller than the size limit per file'
  return null
}

/** Kinds a config allows (custom MIME patterns included; `any` = every known kind). */
export function allowedKinds(config: AttachmentsConfig | undefined): FileKind[] {
  const types = config?.types?.length ? config.types : (config?.custom_types?.length ? [] : ['any' as const])
  if (types.includes('any')) return FILE_KINDS
  return FILE_KINDS.filter((kind) => kind.groups.some((g) => (types as string[]).includes(g)) || customAllows(config, kind.extensions[0], kind.mime))
}

function customAllows(config: AttachmentsConfig | undefined, ext: string, mime: string): boolean {
  for (const entry of config?.custom_types ?? []) {
    if (entry.startsWith('.')) { if (entry.slice(1) === ext) return true; continue }
    if (entry.endsWith('/*')) { if (mime.startsWith(entry.slice(0, -1))) return true; continue }
    if (entry === mime) return true
  }
  return false
}

/**
 * Is a file of this extension (and, when known, verified kind) allowed by
 * the config? Blocked extensions never are. A file of an unknown
 * extension is allowed by `any` or by a matching custom `.ext`.
 */
export function isTypeAllowed(config: AttachmentsConfig | undefined, ext: string, kind: FileKind | null): boolean {
  const e = String(ext ?? '').toLowerCase()
  if (BLOCKED_EXTENSIONS.has(e)) return false
  const types = config?.types?.length ? config.types : (config?.custom_types?.length ? [] : ['any' as const])
  if (!kind) return types.includes('any') || customAllows(config, e, 'application/octet-stream')
  if (types.includes('any')) return true
  if (kind.groups.some((g) => (types as string[]).includes(g))) return true
  return customAllows(config, e, kind.mime)
}

/** The file input's `accept` attribute (empty = anything). */
export function acceptAttribute(config: AttachmentsConfig | undefined): string {
  const types = config?.types?.length ? config.types : (config?.custom_types?.length ? [] : ['any' as const])
  if (types.includes('any')) return ''
  const out = new Set<string>()
  for (const kind of allowedKinds(config)) for (const ext of kind.extensions) out.add(`.${ext}`)
  for (const entry of config?.custom_types ?? []) out.add(entry)
  return [...out].join(',')
}

/** "PDF, Word, PNG, … up to 10 MB each" for the drop zone. */
export function describeAllowedTypes(config: AttachmentsConfig | undefined): string {
  const types = config?.types?.length ? config.types : (config?.custom_types?.length ? [] : ['any' as const])
  if (types.includes('any')) return 'Any file type'
  const parts: string[] = types.map((t) => ATTACHMENT_TYPE_PRESET_LABELS[t].replace(' only', ''))
  for (const entry of config?.custom_types ?? []) parts.push(entry.startsWith('.') ? entry.slice(1).toUpperCase() : entry)
  return parts.join(', ')
}

/** Images allowed (thumbnails, the camera button). */
export function allowsImages(config: AttachmentsConfig | undefined): boolean {
  return allowedKinds(config).some((kind) => kind.groups.includes('images'))
}

/* ── Values ──────────────────────────────────────────────────────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A file object or a reference to one (`{ id }`). */
function isFileRef(value: unknown): value is { id: string } {
  return isPlainObject(value) && typeof value.id === 'string' && UUID_RE.test(value.id)
}

/** Looks like a stored file object (id + name). */
export function isAttachmentFile(value: unknown): value is AttachmentFile {
  return isPlainObject(value) && typeof value.id === 'string' && UUID_RE.test(value.id) && typeof value.name === 'string'
}

/**
 * A field value as a clean list of file objects (only the known keys, typed).
 * A single object is a list of one; anything that isn't a file object is
 * dropped. The server replaces every entry with its own record anyway.
 */
export function normalizeAttachmentValue(value: unknown): AttachmentFile[] {
  let list: unknown[] = []
  if (Array.isArray(value)) list = value
  else if (isPlainObject(value)) list = [value]
  else if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) list = parsed } catch { /* not JSON */ }
  }
  const out: AttachmentFile[] = []
  const seen = new Set<string>()
  for (const item of list) {
    // A bare file id (API / CLI callers) stands for the file the server will look up.
    const entry: unknown = typeof item === 'string' && UUID_RE.test(item.trim()) ? { id: item.trim(), name: '' } : item
    if (!isFileRef(entry) || seen.has(String(entry.id).toLowerCase())) continue
    seen.add(String(entry.id).toLowerCase())
    const e = entry as Record<string, unknown>
    out.push({
      id: String(e.id).toLowerCase(),
      name: typeof e.name === 'string' && e.name.trim() ? sanitizeFileName(e.name) : '',
      size: Number.isFinite(Number(e.size)) ? Math.max(0, Math.floor(Number(e.size))) : 0,
      mime_type: typeof e.mime_type === 'string' ? e.mime_type.slice(0, 120) : 'application/octet-stream',
      url: typeof e.url === 'string' ? e.url.slice(0, 2048) : '',
      storage_ref: typeof e.storage_ref === 'string' ? e.storage_ref.slice(0, 2048) : '',
      uploaded_by: typeof e.uploaded_by === 'string' ? e.uploaded_by : null,
      uploaded_at: typeof e.uploaded_at === 'string' ? e.uploaded_at : '',
      checksum_sha256: typeof e.checksum_sha256 === 'string' ? e.checksum_sha256.slice(0, 64) : '',
    })
  }
  return out
}

/** The ids in a value (in order), for the server to look up. */
export function attachmentIds(value: unknown): string[] {
  return normalizeAttachmentValue(value).map((f) => f.id)
}

/**
 * Count / size / type rules for a field's files (null = fine). `label` is
 * the field label. Used on the client (before submit) and on the server
 * (after the files are re-read from the server's records).
 */
export function attachmentsValueError(
  field: { label: string; required?: boolean; attachments?: AttachmentsConfig },
  value: unknown,
  options: { instanceMaxMb?: number } = {},
): string | null {
  // A start form keeps the list as JSON text in its state (Run dialog).
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try { value = JSON.parse(value) } catch { return `${field.label} has an invalid value` }
  }
  if (value !== null && value !== undefined && !Array.isArray(value) && !isPlainObject(value)) return `${field.label} has an invalid value`
  const raw = Array.isArray(value) ? value : value ? [value] : []
  const files = normalizeAttachmentValue(raw)
  if (files.length !== raw.length) return `${field.label} has an invalid file`
  const limits = attachmentLimits(field.attachments, { required: field.required, instanceMaxMb: options.instanceMaxMb })
  if (files.length < limits.minFiles) return limits.minFiles === 1 ? `${field.label} is required` : `${field.label}: add at least ${limits.minFiles} files`
  if (files.length > limits.maxFiles) return `${field.label}: at most ${limits.maxFiles} file${limits.maxFiles === 1 ? '' : 's'}`
  let total = 0
  for (const file of files) {
    // A bare id: the server checks the file it names.
    if (!file.name) continue
    if (file.size > limits.maxFileBytes) return `${field.label}: "${file.name}" is larger than ${formatBytes(limits.maxFileBytes)}`
    const ext = fileExtension(file.name)
    if (!isTypeAllowed(field.attachments, ext, kindForExtension(ext))) return `${field.label}: "${file.name}" is not an allowed file type`
    total += file.size
  }
  if (total > limits.maxTotalBytes) return `${field.label}: the files add up to more than ${formatBytes(limits.maxTotalBytes)}`
  return null
}

/** "a.pdf, b.png" (read-only displays, CSV, logs). */
export function attachmentNames(value: unknown): string {
  return normalizeAttachmentValue(value).map((f) => f.name).join(', ')
}

/** Raster images the browser can show as a thumbnail. */
export function isPreviewableImage(mime: string): boolean {
  return /^image\/(png|jpeg|gif|webp)$/i.test(String(mime ?? ''))
}

/** The authorised URL path of an uploaded file. */
export function attachmentPath(id: string): string {
  return `/attachments/${id}`
}

/* ── Uploads in flight (browser) ─────────────────────────────────────── */

const uploadsInFlight = new Map<string, number>()

/** The Attachments control counts its running uploads per field key (browser only; the server never does). */
export function trackAttachmentUpload(key: string, delta: 1 | -1): void {
  const next = Math.max(0, (uploadsInFlight.get(key) ?? 0) + delta)
  if (next) uploadsInFlight.set(key, next)
  else uploadsInFlight.delete(key)
}

/** Running uploads of a field: a form isn't submitted while files are still uploading. */
export function attachmentUploadsInFlight(key: string): number {
  return uploadsInFlight.get(key) ?? 0
}
