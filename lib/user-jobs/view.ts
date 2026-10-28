import type { UserJobRow } from './define'
import type { UserJobResult, UserJobView } from './types'

/** Session download route of a job (the browser's link). */
export const jobDownloadPath = (id: string) => `/api/jobs/${id}/download`

export function isExpired(row: Pick<UserJobRow, 'expires_at'>, now = Date.now()): boolean {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() <= now)
}

/** A stored job as callers see it: no params internals, origin, lease or storage refs. */
export function toJobView(row: UserJobRow, now = Date.now()): UserJobView {
  const stored = row.result
  let result: UserJobResult | null = null
  if (stored) {
    result = {}
    if (stored.file) result.file = { filename: stored.file.filename, content_type: stored.file.content_type, size: stored.file.size }
    if (stored.counts) result.counts = stored.counts
    if (stored.summary) result.summary = stored.summary
    if (stored.data !== undefined) result.data = stored.data
    if (stored.data_ref) result.data_in_file = true
  }
  const downloadable = row.status === 'succeeded' && Boolean(stored?.file) && !isExpired(row, now)
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    kind: row.kind,
    title: row.title,
    status: row.status,
    progress: row.progress,
    message: row.message,
    result,
    error: row.error,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    expires_at: row.status === 'queued' || row.status === 'running' ? null : row.expires_at,
    downloadable,
    download_url: downloadable ? jobDownloadPath(row.id) : null,
    cancellable: (row.status === 'queued' || row.status === 'running') && !row.cancel_requested_at,
    retryable: row.status === 'failed' || row.status === 'cancelled',
  }
}
