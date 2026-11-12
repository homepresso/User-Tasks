/**
 * File uploads the browser used to send straight to Supabase Storage: they
 * now arrive at a server action (FormData) and are stored through the
 * StorageProvider (service credentials) in the same buckets and paths.
 * Each result carries `url` (a usable URL for the configured provider: the
 * Supabase public URL by default, exactly as before) and, with any other
 * provider, `ref` (`storage://bucket/key`), which callers persist instead
 * (lib/storage/persist.ts).
 *
 *  - integration icons   task-files/integration-icons/<uuid>.<ext>   images, ≤ 512 KB
 *  - reference icons     task-files/reference-icons/<uuid>.<ext>     images, ≤ 512 KB
 *  - data-table files    task-files/data-tables/<table>/<uuid>.<ext> any type, ≤ 45 MB
 *  - agent knowledge     task-files/agent-knowledge/<tenant>/<uuid>.<ext> documents, ≤ 20 MB
 *  - workspace logos     logos/<tenant>/<variant>.<ext> (replaced)   per variant (LOGO_SPECS)
 *  - form images         task-files/form-images/<tenant>/<uuid>.<ext> PNG / JPEG / WebP / GIF, ≤ 2 MB
 *
 * The browser path only required a signed-in user for task-files (any path)
 * and settings.edit in the folder's workspace for logos; these also check the
 * permission of the feature the upload belongs to and, for data-table files,
 * that the table is in the caller's workspace.
 */

import { getStorageProvider } from '@/lib/providers/storage'
import { fileRefFields } from '@/lib/storage/persist'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

export interface UploadInput {
  /** Original file name (only its extension is kept). */
  name: string
  /** MIME type reported by the browser ('' when unknown). */
  type: string
  bytes: Uint8Array
}

export interface StoredFile {
  name: string
  url: string
  size: number
  path: string
  /** `storage://<bucket>/<path>`; only when the provider isn't supabase (lib/storage/persist.ts). */
  ref?: string
}

export const ICON_MAX_BYTES = 512 * 1024
/**
 * Data-table files had no size limit in the UI; they were bounded by the
 * storage bucket (50 MB). Server actions accept 50 MB bodies
 * (next.config.ts), so leave room for the multipart envelope.
 */
export const DATA_FILE_MAX_BYTES = 45 * 1024 * 1024

export type LogoVariant = 'logo' | 'logo-light' | 'logo-dark' | 'favicon' | 'form-sign-in'

/** Same types and sizes as the logo picker (components/settings/logo-upload.tsx). */
export const LOGO_SPECS: Record<LogoVariant, { types: string[]; maxBytes: number }> = {
  logo: { types: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'], maxBytes: 2 * 1024 * 1024 },
  'logo-light': { types: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'], maxBytes: 2 * 1024 * 1024 },
  'logo-dark': { types: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'], maxBytes: 2 * 1024 * 1024 },
  favicon: { types: ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/webp'], maxBytes: 512 * 1024 },
  /** The form sign-in page logo (Settings → Forms): shown to visitors who aren't signed in, so SVGs are sanitised. */
  'form-sign-in': { types: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'], maxBytes: 2 * 1024 * 1024 },
}

const TASK_FILES = 'task-files'
const LOGOS = 'logos'

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024}MB` : `${bytes / 1024}KB`
}

function checkFile(file: UploadInput, maxBytes: number) {
  if (!file || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0) throw ServiceError.validation('The file is empty')
  if (file.bytes.byteLength > maxBytes) {
    throw new ServiceError('validation_error', `File must be under ${sizeLabel(maxBytes)}`, { status: 413 })
  }
}

/** Lower-case alphanumeric extension from the file name, or `fallback`. */
export function fileExtension(name: string, fallback: string): string {
  const parts = String(name ?? '').split('.')
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : ''
  return ext || fallback
}

async function store(bucket: string, path: string, file: UploadInput, options: { upsert?: boolean; contentType?: string } = {}): Promise<StoredFile> {
  const storage = await getStorageProvider()
  try {
    await storage.put(bucket, path, file.bytes, { contentType: options.contentType ?? (file.type || 'application/octet-stream'), upsert: options.upsert })
  } catch (error) {
    throw dbError(error as { message?: string }, 'Upload failed')
  }
  return { name: file.name, url: storage.publicUrl(bucket, path), size: file.bytes.byteLength, path, ...fileRefFields(bucket, path, storage.id) }
}

function requireImage(file: UploadInput) {
  if (!/^image\//i.test(file.type)) throw ServiceError.validation('Icons must be image files (SVG, PNG, JPEG, …)')
}

/** Icon picked in the create-integration dialog. */
export async function uploadIntegrationIcon(ctx: ServiceContext, file: UploadInput): Promise<StoredFile> {
  if (!hasPerm(ctx, 'integrations.create') && !hasPerm(ctx, 'integrations.edit')) requirePerm(ctx, 'integrations.create')
  checkFile(file, ICON_MAX_BYTES)
  requireImage(file)
  return store(TASK_FILES, `integration-icons/${crypto.randomUUID()}.${fileExtension(file.name, 'svg')}`, file)
}

/** Icon picked in the reference builder. */
export async function uploadReferenceIcon(ctx: ServiceContext, file: UploadInput): Promise<StoredFile> {
  requirePerm(ctx, 'integrations.manage_references')
  checkFile(file, ICON_MAX_BYTES)
  requireImage(file)
  return store(TASK_FILES, `reference-icons/${crypto.randomUUID()}.${fileExtension(file.name, 'svg')}`, file)
}

/** File cell value for a data-table row (grid or row drawer). Returns the cell's JSON. */
export async function uploadDataTableFile(ctx: ServiceContext, tableId: string, file: UploadInput): Promise<StoredFile> {
  requirePerm(ctx, 'data.manage_rows')
  checkFile(file, DATA_FILE_MAX_BYTES)
  const { data: table, error } = await ctx.supabase.from('custom_tables').select('id').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!table) throw ServiceError.notFound('Table not found')
  return store(TASK_FILES, `data-tables/${tableId}/${crypto.randomUUID()}.${fileExtension(file.name, 'bin')}`, file)
}

export const KNOWLEDGE_FILE_MAX_BYTES = 20 * 1024 * 1024
const KNOWLEDGE_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'xml'])

/**
 * A knowledge document for an agent (agents.edit): PDF, Word, Excel,
 * PowerPoint, text, Markdown, CSV, JSON, HTML or XML up to 20 MB. The
 * returned file object goes into the agent's output_config.knowledge.files
 * (search_knowledge reads it; lib/agents/tools/knowledge.ts).
 */
export async function uploadAgentKnowledgeFile(ctx: ServiceContext, file: UploadInput): Promise<StoredFile & { mime_type: string }> {
  requirePerm(ctx, 'agents.edit')
  checkFile(file, KNOWLEDGE_FILE_MAX_BYTES)
  const ext = fileExtension(file.name, '')
  if (!KNOWLEDGE_EXTENSIONS.has(ext)) throw ServiceError.validation('Knowledge files must be PDF, Word, Excel, PowerPoint, text, Markdown, CSV, JSON, HTML or XML')
  const stored = await store(TASK_FILES, `agent-knowledge/${ctx.tenantId}/${crypto.randomUUID()}.${ext}`, file)
  return { ...stored, name: String(file.name).slice(0, 200), mime_type: file.type || 'application/octet-stream' }
}

/**
 * Workspace logo / theme logo / favicon, replacing the variant's previous
 * file. The returned URL carries a cache-busting `?t=` as before; saving it
 * (workspace branding or the theme draft) stays with the caller.
 */
export async function uploadWorkspaceLogo(ctx: ServiceContext, variant: LogoVariant, file: UploadInput): Promise<StoredFile> {
  requirePerm(ctx, 'settings.edit')
  const spec = LOGO_SPECS[variant]
  if (!spec) throw ServiceError.validation('Unknown logo variant')
  if (!spec.types.includes(file?.type)) throw ServiceError.validation('Unsupported image type')
  checkFile(file, spec.maxBytes)
  let upload = file
  let ext = fileExtension(file.name, 'png')
  if (variant === 'form-sign-in') {
    // Public page: SVGs are sanitised (scripts, handlers, external references removed); other images must look like one.
    ext = file.type === 'image/svg+xml' ? 'svg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    if (file.type === 'image/svg+xml') {
      const { sanitizeSvg } = await import('@/lib/sanitize-svg')
      const text = new TextDecoder().decode(file.bytes).replace(/^\uFEFF?\s*(<\?xml[\s\S]*?\?>\s*)?(<!DOCTYPE[^>]*>\s*)?/i, '')
      const clean = sanitizeSvg(text)
      if (!clean) throw ServiceError.validation('That SVG could not be used (it is not a valid, safe SVG image)')
      upload = { ...file, bytes: new TextEncoder().encode(clean) }
    } else if (!looksLikeImage(file.bytes, file.type)) {
      throw ServiceError.validation('The file is not a valid image')
    }
  }
  const stored = await store(LOGOS, `${ctx.tenantId}/${variant}.${ext}`, upload, { upsert: true, contentType: file.type })
  const t = `?t=${Date.now()}`
  return { ...stored, url: `${stored.url}${t}`, ...(stored.ref ? { ref: `${stored.ref}${t}` } : {}) }
}

/**
 * Form header image (the form designer's Header settings): forms.edit,
 * PNG / JPEG / SVG / WebP up to 1 MB. SVGs are sanitised (scripts, event
 * handlers, external references removed) before they are stored. Stored at
 * task-files/form-headers/<tenant>/<uuid>.<ext> and served through /files.
 */
export async function uploadFormHeaderImage(ctx: ServiceContext, file: UploadInput): Promise<StoredFile> {
  requirePerm(ctx, 'forms.edit')
  const { HEADER_IMAGE_MAX_BYTES, HEADER_IMAGE_TYPES } = await import('@/lib/forms/header')
  if (!(HEADER_IMAGE_TYPES as readonly string[]).includes(file?.type)) throw ServiceError.validation('Use a PNG, JPEG, SVG or WebP image')
  checkFile(file, HEADER_IMAGE_MAX_BYTES)
  let upload = file
  const ext = file.type === 'image/svg+xml' ? 'svg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  if (file.type === 'image/svg+xml') {
    const { sanitizeSvg } = await import('@/lib/sanitize-svg')
    // An XML prolog / doctype before <svg> is common in exported files.
    const text = new TextDecoder().decode(file.bytes).replace(/^\uFEFF?\s*(<\?xml[\s\S]*?\?>\s*)?(<!DOCTYPE[^>]*>\s*)?/i, '')
    const clean = sanitizeSvg(text)
    if (!clean) throw ServiceError.validation('That SVG could not be used (it is not a valid, safe SVG image)')
    upload = { ...file, bytes: new TextEncoder().encode(clean) }
  } else if (!looksLikeImage(file.bytes, file.type)) {
    throw ServiceError.validation('The file is not a valid image')
  }
  return store(TASK_FILES, `form-headers/${ctx.tenantId}/${crypto.randomUUID()}.${ext}`, upload, { contentType: file.type })
}

/** Largest picture uploadFormImage stores (display images in a form's layout). */
export const FORM_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const FORM_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

/**
 * A picture placed in a form's layout (Display image field, an Image
 * field's default picture; the InfoPath importer stores pictures from .xsn
 * files with it): forms.edit, PNG / JPEG / WebP / GIF up to 2 MB, verified
 * by content (the browser's type is only a hint), metadata (EXIF / GPS, text
 * chunks) stripped. Stored at task-files/form-images/<tenant>/<uuid>.<ext>
 * and served through /files; persist `ref ?? url` (a storage:// reference
 * under non-Supabase providers).
 */
export async function uploadFormImage(ctx: ServiceContext, file: UploadInput): Promise<StoredFile & { mime_type: string }> {
  requirePerm(ctx, 'forms.edit')
  checkFile(file, FORM_IMAGE_MAX_BYTES)
  const { sniffContent } = await import('@/lib/forms/attachment-sniff')
  const sniffed = sniffContent(file.bytes)
  const mime = sniffed === 'png' ? 'image/png' : sniffed === 'jpeg' ? 'image/jpeg' : sniffed === 'webp' ? 'image/webp' : sniffed === 'gif' ? 'image/gif' : null
  if (!mime) throw ServiceError.validation('Use a PNG, JPEG, WebP or GIF image')
  const { stripImageMetadata } = await import('@/lib/forms/image-metadata')
  const bytes = stripImageMetadata(file.bytes, sniffed).bytes
  const stored = await store(TASK_FILES, `form-images/${ctx.tenantId}/${crypto.randomUUID()}.${FORM_IMAGE_TYPES[mime]}`, { ...file, bytes, type: mime }, { contentType: mime })
  return { ...stored, mime_type: mime }
}

/** Magic bytes of the raster types we accept. */
function looksLikeImage(bytes: Uint8Array, type: string): boolean {
  const b = (i: number) => bytes[i]
  if (type === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47
  if (type === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8
  if (type === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50
  return false
}
