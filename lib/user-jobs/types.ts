/**
 * Background job shapes shared by the server (lib/user-jobs/runner.ts), the
 * REST API (/api/v1/jobs) and the browser (components/jobs). Client-safe: no
 * server imports.
 */

export const USER_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type UserJobStatus = (typeof USER_JOB_STATUSES)[number]

export const ACTIVE_JOB_STATUSES: readonly UserJobStatus[] = ['queued', 'running']

export function isActiveJobStatus(status: string): boolean {
  return status === 'queued' || status === 'running'
}

/** The file a finished job produced. `ref` is a storage:// reference (never sent to browsers). */
export interface UserJobFile {
  filename: string
  content_type: string
  size: number
}

export interface UserJobResult {
  file?: UserJobFile
  /** Counts for the summary line ("Deleted 120 rows"). */
  counts?: Record<string, number>
  /** One line shown in the jobs panel and the completion popup. */
  summary?: string
  /** Small JSON result (what the synchronous call returned), when it has one. */
  data?: unknown
  /** The result JSON was too large to keep inline: GET /jobs/{id}/result streams it from storage. */
  data_in_file?: boolean
}

/** A job as the UI and the API see it (no params internals, origin or storage refs). */
export interface UserJobView {
  id: string
  tenant_id: string
  user_id: string | null
  kind: string
  title: string
  status: UserJobStatus
  progress: number
  message: string | null
  result: UserJobResult | null
  error: string | null
  attempts: number
  max_attempts: number
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
  expires_at: string | null
  /** A file is ready and not expired. */
  downloadable: boolean
  /** Session download route for the UI (the API uses /api/v1/jobs/{id}/download). */
  download_url: string | null
  /** The job can be cancelled (queued or running, no cancel requested yet). */
  cancellable: boolean
  /** Failed or cancelled jobs can be started again with the same input. */
  retryable: boolean
}

/** What a client-side Export / bulk action gets back when it starts a job. */
export interface StartedJob {
  job: UserJobView
}
