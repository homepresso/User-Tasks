import type { z } from 'zod'
import type { ServiceContext } from '@/lib/services/context'

/**
 * Job kinds: what a background job does. Each kind (lib/user-jobs/kinds)
 * names its params schema, the permission check (run when the job is
 * enqueued AND again in the runner, as the user or credential that started
 * it) and the work itself.
 */

/** A stored row of public.user_jobs. */
export interface UserJobRow {
  id: string
  tenant_id: string
  user_id: string | null
  kind: string
  title: string
  params: Record<string, unknown>
  origin: JobOrigin
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  result: StoredJobResult | null
  error: string | null
  checkpoint: unknown
  attempts: number
  max_attempts: number
  run_after: string
  lease_owner: string | null
  lease_expires_at: string | null
  heartbeat_at: string | null
  cancel_requested_at: string | null
  idempotency_key: string | null
  created_at: string
  updated_at: string
  started_at: string | null
  finished_at: string | null
  expires_at: string | null
}

/** How the job was started (public.user_jobs.origin). Never secrets. */
export interface JobOrigin {
  source: 'ui' | 'api' | 'mcp'
  auth_kind: 'session' | 'api_key' | 'oauth' | 'mcp'
  /** API key or OAuth token id, re-checked (not revoked / expired) when the job runs. */
  key_id?: string | null
  key_type?: 'tenant' | 'user'
  /** The credential's permissions when the job was started (its ceiling). */
  permissions?: string[]
  resource_scopes?: { workflow_ids: string[]; table_ids: string[] }
  oauth_scopes?: string[]
  credential_owner_id?: string | null
  /** The job's large input is stored at <tenant>/<job>/input. */
  has_input?: boolean
}

export interface StoredJobResult {
  file?: { ref: string; filename: string; content_type: string; size: number }
  counts?: Record<string, number>
  summary?: string
  data?: unknown
  data_ref?: string
}

export interface JobFileOutput {
  name: string
  contentType: string
  body: Uint8Array | string
}

export interface JobOutput {
  /** A file for the user to download. */
  file?: JobFileOutput
  summary?: string
  counts?: Record<string, number>
  /** JSON result (what the synchronous API call returns). Large values are stored as a file. */
  data?: unknown
}

/** Hand back before the time limit; the runner saves `continue` and resumes later. */
export interface JobContinue {
  continue: unknown
  progress?: number
  message?: string
}

export type JobStep = JobOutput | JobContinue

export function isContinue(step: JobStep): step is JobContinue {
  return typeof step === 'object' && step !== null && 'continue' in step
}

export interface JobRun<P> {
  job: UserJobRow
  ctx: ServiceContext
  params: P
  /** State saved by an earlier invocation (JobContinue / saveCheckpoint), or null. */
  checkpoint: unknown
  /** Progress (0–100) and a message. Throws when the job was cancelled or lost its lease. */
  progress(percent: number, message?: string): Promise<void>
  /** Persist resumable state now (a crash resumes from here). */
  saveCheckpoint(state: unknown): Promise<void>
  /** ms left before this invocation must hand back (return a JobContinue). */
  timeLeft(): number
  /** The large input stored when the job was enqueued (null when none). */
  readInput(): Promise<Uint8Array | null>
  /** Chunk files of a job that writes its result over several invocations. */
  putPart(index: number, body: Uint8Array | string): Promise<void>
  readParts(count: number): Promise<Uint8Array[]>
}

export interface JobKind<P = unknown> {
  kind: string
  params: z.ZodType<P>
  /** Shown in the jobs panel, notifications and the API. */
  title(params: P): string
  /** requirePerm() etc.; throw ServiceError to refuse. Runs at enqueue and before every run. */
  authorize(ctx: ServiceContext, params: P): void | Promise<void>
  run(run: JobRun<P>): Promise<JobStep>
  /** Automatic attempts for unexpected errors (default 1: writes are never retried by themselves). */
  maxAttempts?: number
  /** Accepts a large input (bytes) stored next to the job. */
  input?: { maxBytes: number }
  /** What the UI does on success: offer the file, or refresh the page's data. */
  effect: 'download' | 'change' | 'result'
}

/** Identity helper keeping each kind's param type. */
export function defineJobKind<P>(kind: JobKind<P>): JobKind<P> {
  return kind
}
