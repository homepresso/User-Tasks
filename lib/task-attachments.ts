/**
 * Task attachments: files attached to a task with a name, a type and a
 * description (the task's Attachments tab, the API / MCP / CLI, the "Add
 * task attachment" workflow step). Stored in public.task_attachments
 * (migration 20261222000000) with the bytes in the private `form-files`
 * bucket; served through /attachments/<id> like form attachments.
 *
 * The TYPE is free text with suggestions: the defaults below plus the types
 * already used in the workspace (no settings screen to maintain; a workspace
 * that wants a fixed list just uses the same few words).
 *
 * Value object (API, workflow outputs `attachments`, `{{task.attachments}}`):
 *
 *   { id, task_id, name, type, description, file_name, mime, mime_type, size,
 *     url, storage_ref, checksum_sha256, uploaded_by, created_at }
 *
 * `url` is the authorised /attachments/<id> link, `storage_ref` the
 * `storage://form-files/…` reference workflow file steps read. `mime_type`
 * duplicates `mime` so file steps that read form attachments read these too.
 *
 * Pure and isomorphic.
 */

export const DEFAULT_ATTACHMENT_TYPES = ['Contract', 'Invoice', 'Receipt', 'Evidence', 'Image', 'Other'] as const

export const TASK_ATTACHMENT_LIMITS = {
  nameMax: 200,
  typeMax: 60,
  descriptionMax: 2000,
  /** Attachments one task may hold (TASK_ATTACHMENT_MAX_PER_TASK overrides on the server). */
  perTask: 100,
} as const

export interface TaskAttachment {
  id: string
  task_id: string
  name: string
  type: string
  description: string
  file_name: string
  mime: string
  mime_type: string
  size: number
  url: string
  storage_ref: string
  checksum_sha256: string
  uploaded_by: string | null
  /** Display name of the uploader (lists only; null for workflow steps). */
  uploaded_by_name?: string | null
  created_at: string
  /** A workflow step attached it. */
  run_id?: string | null
}

export interface TaskAttachmentMeta {
  name: string
  type: string
  description: string
}

function clean(value: unknown): string {
  // Control and bidi characters out, whitespace collapsed.
  return String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '').trim()
}

/** The file name without its extension: the default attachment name. */
export function defaultAttachmentName(fileName: string): string {
  const base = clean(fileName).split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TASK_ATTACHMENT_LIMITS.nameMax)
}

/** A type as stored: trimmed, single-spaced, a known default in its canonical case. */
export function normalizeAttachmentType(value: unknown): string {
  const text = clean(value).replace(/\s+/g, ' ')
  if (!text) return 'Other'
  const known = DEFAULT_ATTACHMENT_TYPES.find((t) => t.toLowerCase() === text.toLowerCase())
  return known ?? text.slice(0, TASK_ATTACHMENT_LIMITS.typeMax)
}

/**
 * Validate and normalise what a person typed. `fileName` fills an empty
 * name. Returns the clean values, or field errors.
 */
export function validateAttachmentMeta(input: { name?: unknown; type?: unknown; description?: unknown }, fileName = ''):
  { ok: true; value: TaskAttachmentMeta } | { ok: false; errors: Partial<Record<keyof TaskAttachmentMeta, string>> } {
  const errors: Partial<Record<keyof TaskAttachmentMeta, string>> = {}
  const name = clean(input.name).replace(/\s+/g, ' ') || defaultAttachmentName(fileName)
  const rawType = clean(input.type)
  const description = clean(input.description).replace(/\r\n?/g, '\n')
  if (!name) errors.name = 'Enter a name'
  else if (name.length > TASK_ATTACHMENT_LIMITS.nameMax) errors.name = `Use ${TASK_ATTACHMENT_LIMITS.nameMax} characters or fewer`
  if (rawType.length > TASK_ATTACHMENT_LIMITS.typeMax) errors.type = `Use ${TASK_ATTACHMENT_LIMITS.typeMax} characters or fewer`
  if (description.length > TASK_ATTACHMENT_LIMITS.descriptionMax) errors.description = `Use ${TASK_ATTACHMENT_LIMITS.descriptionMax} characters or fewer`
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, type: normalizeAttachmentType(rawType), description } }
}

/** Suggestions for the type box: the defaults, then the workspace's own types (deduplicated, case-insensitive). */
export function attachmentTypeSuggestions(used: readonly string[] = []): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of [...DEFAULT_ATTACHMENT_TYPES, ...used]) {
    const v = normalizeAttachmentType(t)
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out.slice(0, 50)
}

/**
 * Inline preview the browser can show cheaply: PNG / JPEG / GIF / WebP
 * images (the signed link with ?inline=1). PDFs are downloaded: the app's
 * CSP allows no blob: frames, and the download route serves files
 * sandboxed, which the browsers' PDF viewers refuse.
 */
export function attachmentPreviewKind(mime: string): 'image' | null {
  return /^image\/(png|jpeg|gif|webp)$/i.test(mime) ? 'image' : null
}

/** Item schema of an attachment for the workflow data picker. */
export const TASK_ATTACHMENT_FIELDS: Array<{ key: keyof TaskAttachment; type: 'string' | 'number'; description: string }> = [
  { key: 'id', type: 'string', description: 'Attachment id' },
  { key: 'name', type: 'string', description: 'Name given to the attachment' },
  { key: 'type', type: 'string', description: 'Type, e.g. Contract, Invoice, Receipt' },
  { key: 'description', type: 'string', description: 'Description' },
  { key: 'file_name', type: 'string', description: 'Original file name' },
  { key: 'mime', type: 'string', description: 'Verified MIME type' },
  { key: 'size', type: 'number', description: 'Size in bytes' },
  { key: 'url', type: 'string', description: 'Authorised download link (/attachments/<id>)' },
  { key: 'storage_ref', type: 'string', description: 'storage:// reference file steps read' },
  { key: 'uploaded_by', type: 'string', description: 'User id of the uploader (empty for workflow steps)' },
  { key: 'created_at', type: 'string', description: 'When it was attached (ISO 8601)' },
]
