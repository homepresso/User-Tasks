/**
 * Files the document actions produce (converted documents, redlines, reports,
 * merged / split / stamped PDFs, redacted copies) are written through the
 * storage provider into the tenant's workflow-files folder and returned as
 * file objects — the same fields as a form attachment (`id`, `name`, `size`,
 * `mime_type`, `url`, `storage_ref`, `uploaded_by`, `uploaded_at`,
 * `checksum_sha256`) plus the fields older file steps produce (`_file`,
 * `path`, `content_type`, `ref`), so they can be emailed, attached, looped
 * over and read by any file step.
 */

import { createHash } from 'node:crypto'
import type { SupabaseStorageClient } from '@/lib/providers/storage/supabase'
import { storeWorkflowFile, TASK_FILES_BUCKET } from '@/lib/storage/files'
import { formatStorageRef } from '@/lib/storage/refs'

export interface DocumentFileObject {
  _file: true
  id: string
  name: string
  size: number
  mime_type: string
  content_type: string
  url: string
  path: string
  storage_ref: string
  ref?: string
  uploaded_by: string | null
  uploaded_at: string
  checksum_sha256: string
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A safe output file name: no path separators or control characters, the right extension. */
export function outputFileName(raw: unknown, fallback: string, ext: string): string {
  let name = String(raw ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150)
  if (!name) name = fallback
  if (!name.toLowerCase().endsWith(`.${ext}`)) name = `${name.replace(/\.[a-z0-9]{1,5}$/i, '')}.${ext}`
  return name
}

export async function storeDocumentFile(client: SupabaseStorageClient, tenantId: string, bytes: Uint8Array, name: string, mime: string): Promise<DocumentFileObject> {
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] ?? 'bin').toLowerCase()
  const stored = await storeWorkflowFile(client, tenantId, bytes, ext, mime)
  const id = stored.path.split('/').pop()!.replace(/\.[^.]+$/, '')
  return {
    _file: true,
    id,
    name,
    size: bytes.byteLength,
    mime_type: mime,
    content_type: mime,
    url: stored.url,
    path: stored.path,
    storage_ref: formatStorageRef(TASK_FILES_BUCKET, stored.path),
    ...(stored.ref ? { ref: stored.ref } : {}),
    uploaded_by: null,
    uploaded_at: new Date().toISOString(),
    checksum_sha256: sha256Hex(bytes),
  }
}

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
} as const
