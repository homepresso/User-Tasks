/** A non-2xx response from the API. */
export class UsertasksApiError extends Error {
  override readonly name = 'UsertasksApiError'
  /** HTTP status code. */
  readonly status: number
  /** Machine-readable error code (`validation_error`, `forbidden`, …) when the server sends one. */
  readonly code?: string
  /** Structured detail, e.g. zod validation issues. */
  readonly details?: unknown
  /** Request id from the `x-request-id` (or `x-vercel-id`) response header. */
  readonly requestId?: string
  /** Parsed response body (or raw text when it was not JSON). */
  readonly body: unknown

  constructor(init: { status: number; message: string; code?: string; details?: unknown; requestId?: string; body?: unknown }) {
    super(init.message)
    this.status = init.status
    this.code = init.code
    this.details = init.details
    this.requestId = init.requestId
    this.body = init.body
  }
}

/** The request never produced an HTTP response (DNS, connection refused, timeout, …). */
export class UsertasksNetworkError extends Error {
  override readonly name = 'UsertasksNetworkError'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** A background job (async request) ended without succeeding. */
export class UsertasksJobError extends Error {
  override readonly name = 'UsertasksJobError'
  readonly job: { id: string; status: string; error: string | null }

  constructor(job: { id: string; status: string; error: string | null; title?: string }) {
    super(job.status === 'cancelled' ? `Job ${job.id} was cancelled` : `Job ${job.id} failed: ${job.error ?? 'unknown error'}`)
    this.job = job
  }
}

export function isUsertasksApiError(error: unknown): error is UsertasksApiError {
  return error instanceof UsertasksApiError
}
