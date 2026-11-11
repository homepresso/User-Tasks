/**
 * Where a form came from (provenance), stored on the layout as
 * `layout.source` so it travels with the form's versions and exports:
 *
 *   { kind: 'infopath', file_name, view, hash, mode, imported_at }
 *
 * The InfoPath importer (lib/services/infopath-import.ts) matches a
 * re-imported .xsn to the forms it made earlier by `hash` / `file_name` +
 * `view`, and offers to update them. Older readers ignore the key.
 */
import { isPlainObject } from '@/lib/utils/guards'

export interface FormSourceInfo {
  kind: 'infopath'
  file_name: string
  /** The InfoPath view this form was made from (absent: views combined as steps). */
  view?: string
  /** sha256 of the imported file. */
  hash: string
  mode?: 'per_view' | 'combined'
  imported_at?: string
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) : '')

export function normalizeFormSource(raw: unknown): FormSourceInfo | undefined {
  if (!isPlainObject(raw) || raw.kind !== 'infopath') return undefined
  const hash = typeof raw.hash === 'string' && /^[0-9a-f]{64}$/.test(raw.hash) ? raw.hash : ''
  const file = text(raw.file_name, 200)
  if (!hash || !file) return undefined
  const out: FormSourceInfo = { kind: 'infopath', file_name: file, hash }
  const view = text(raw.view, 200)
  if (view) out.view = view
  if (raw.mode === 'per_view' || raw.mode === 'combined') out.mode = raw.mode
  if (typeof raw.imported_at === 'string' && !Number.isNaN(Date.parse(raw.imported_at))) out.imported_at = new Date(raw.imported_at).toISOString()
  return out
}
