/**
 * UsertasksClient: a small fetch wrapper over /api/v1.
 *
 * - Typed helpers (GET/POST/PUT/PATCH/DELETE) keyed by the OpenAPI path
 *   template, e.g. `client.GET('/workflows/{id}', { path: { id } })`.
 * - Responses are unwrapped from the `{ success, data }` envelope, except for
 *   operations marked `x-usertasks-envelope: false`, which return the body.
 * - Non-2xx responses throw UsertasksApiError; transport failures throw
 *   UsertasksNetworkError.
 * - Idempotent methods (GET/HEAD/OPTIONS/PUT/DELETE) are retried on 429, 5xx
 *   and network errors with exponential backoff (honouring Retry-After).
 * - A 401 gives the TokenProvider one chance to supply a fresh token.
 */

import type { TokenProvider } from './auth'
import { UsertasksApiError, UsertasksJobError, UsertasksNetworkError } from './errors'
import { EventsApi } from './events'
import { OPERATIONS, type OperationInfo } from './generated/operations'
import type { paths } from './generated/schema'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[]

export interface ClientOptions {
  /** Server origin (`https://tasks.example.com`) or API base (`…/api/v1`). */
  baseUrl: string
  auth?: TokenProvider
  /** Custom fetch (tests, proxies). Defaults to globalThis.fetch. */
  fetch?: typeof fetch
  /** Retries for idempotent requests on 429 / 5xx / network errors (default 2). */
  retries?: number
  /** Base backoff delay in ms; doubled each attempt, plus jitter (default 300). */
  retryDelayMs?: number
  /** Upper bound for a single backoff, including Retry-After (default 30 000). */
  maxRetryDelayMs?: number
  /** Per-attempt timeout in ms (default 60 000; 0 disables). */
  timeoutMs?: number
  userAgent?: string
  headers?: Record<string, string>
  /** Receives one line per attempt (`GET https://… → 200 (42 ms)`). */
  debug?: (message: string) => void
}

export interface RequestOptions {
  /** Values for `{param}` placeholders in the path. */
  path?: Record<string, string | number>
  query?: Record<string, QueryValue>
  /** JSON-serialisable request body. */
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /**
   * Force envelope handling. By default it is looked up from the operation
   * table (true when the path is unknown).
   */
  envelope?: boolean
}

export interface RawResponse {
  status: number
  headers: Headers
  /** Parsed JSON body, raw text when not JSON, or null when empty. */
  body: unknown
  requestId?: string
}

export interface PaginateOptions extends Omit<RequestOptions, 'body' | 'envelope'> {
  /** Key of the item array in the response data (defaults to the operation's listKey). */
  listKey?: string
  /** Page size requested per call (1-100, default 100). */
  pageSize?: number
}

// ─── Typed helpers over the generated `paths` ───

type Lower<M extends string> = Lowercase<M>
type OperationOf<P extends keyof paths, M extends string> = Lower<M> extends keyof paths[P] ? NonNullable<paths[P][Lower<M>]> : never
export type PathsWith<M extends string> = {
  [P in keyof paths]: [OperationOf<P, M>] extends [never] ? never : P
}[keyof paths]

type JsonContent<R> = R extends { content: { 'application/json': infer B } } ? B : unknown
type SuccessBody<O> = O extends { responses: infer R }
  ? 200 extends keyof R ? JsonContent<R[200]> : 201 extends keyof R ? JsonContent<R[201]> : unknown
  : unknown
type Unwrap<B> = B extends { success: true; data: infer D } ? D : B
export type ResponseData<P extends keyof paths, M extends string> = Unwrap<SuccessBody<OperationOf<P, M>>>

type ParamsOf<O> = O extends { parameters: infer X } ? X : object
type BodyOf<O> = O extends { requestBody?: infer RB } ? JsonContent<NonNullable<RB>> : never
export type TypedRequestOptions<O> = Omit<RequestOptions, 'path' | 'query' | 'body'> & {
  path?: ParamsOf<O> extends { path?: infer PP } ? NonNullable<PP> : never
  query?: ParamsOf<O> extends { query?: infer Q } ? NonNullable<Q> : never
  body?: BodyOf<O>
}

// ─── Helpers ───

const IDEMPOTENT = new Set<string>(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])

function normaliseBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) throw new Error(`Invalid base URL: ${input}`)
  return /\/api\/v1$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

function templateToRegExp(template: string): RegExp {
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${pattern}$`)
}

const OPERATION_MATCHERS = OPERATIONS.map((op) => ({ op, re: templateToRegExp(op.path) }))

/**
 * Find the operation for a method + path. Accepts a template
 * (`/workflows/{id}`) or a concrete path (`/workflows/abc`); exact template
 * matches win over pattern matches (`/workflows/runs` vs `/workflows/{id}`).
 */
export function findOperation(method: string, path: string): OperationInfo | undefined {
  const upper = method.toUpperCase()
  const clean = path.split('?')[0]
  return (
    OPERATIONS.find((op) => op.method === upper && op.path === clean) ??
    OPERATION_MATCHERS.find(({ op, re }) => op.method === upper && re.test(clean))?.op
  )
}

export function buildPath(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name]
    if (value === undefined || value === null || value === '') throw new Error(`Missing path parameter: ${name}`)
    return encodeURIComponent(String(value))
  })
}

function appendQuery(url: URL, query: Record<string, QueryValue> | undefined) {
  if (!query) return
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, String(item))
    else url.searchParams.set(key, String(value))
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function requestIdOf(headers: Headers): string | undefined {
  return headers.get('x-request-id') ?? headers.get('x-vercel-id') ?? undefined
}

function toApiError(status: number, headers: Headers, body: unknown): UsertasksApiError {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined
  const message =
    (typeof record?.error === 'string' && record.error) ||
    (typeof record?.message === 'string' && record.message) ||
    (typeof body === 'string' && body.trim() && body.trim().slice(0, 500)) ||
    `HTTP ${status}`
  return new UsertasksApiError({
    status,
    message,
    code: typeof record?.code === 'string' ? record.code : undefined,
    details: record?.details,
    requestId: requestIdOf(headers),
    body,
  })
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** An uploaded file (`POST /files/uploads`): what an Attachments field's value holds. */
export interface UploadedFile {
  id: string
  name: string
  size: number
  mime_type: string
  url: string
  storage_ref: string
  uploaded_by: string | null
  uploaded_at: string
  checksum_sha256: string
}

/** A background job (async requests, `GET /jobs/{id}`). */
export interface Job {
  id: string
  kind: string
  title: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  error: string | null
  result: { file?: { filename: string; content_type: string; size: number }; counts?: Record<string, number>; summary?: string; data?: unknown; data_in_file?: boolean } | null
  created_at: string
  finished_at: string | null
  expires_at: string | null
  downloadable: boolean
  [key: string]: unknown
}

export interface WaitOptions {
  /** Poll interval (default 1 s, backing off to 5 s). */
  intervalMs?: number
  /** Give up after this long (default: no limit). */
  timeoutMs?: number
  /** Called whenever the job's progress or message changes. */
  onProgress?: (job: Job) => void
  signal?: AbortSignal
}

export interface JobFile {
  bytes: Uint8Array
  filename: string
  contentType: string
}

const isFinished = (job: Job) => job.status !== 'queued' && job.status !== 'running'

// ─── Client ───

export class UsertasksClient {
  readonly baseUrl: string
  private readonly auth?: TokenProvider
  private readonly fetchImpl: typeof fetch
  private readonly retries: number
  private readonly retryDelayMs: number
  private readonly maxRetryDelayMs: number
  private readonly timeoutMs: number
  private readonly headers: Record<string, string>
  private readonly debug?: (message: string) => void
  private eventsApi?: EventsApi

  constructor(options: ClientOptions) {
    this.baseUrl = normaliseBaseUrl(options.baseUrl)
    this.auth = options.auth
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.retries = Math.max(0, options.retries ?? 2)
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 300)
    this.maxRetryDelayMs = Math.max(0, options.maxRetryDelayMs ?? 30_000)
    this.timeoutMs = Math.max(0, options.timeoutMs ?? 60_000)
    this.headers = {
      Accept: 'application/json',
      'User-Agent': options.userAgent ?? 'usertasks-sdk/0.1.0',
      ...options.headers,
    }
    this.debug = options.debug
  }

  /** Event stream: `list`, `iterate` (cursor pages) and live `stream` (SSE). */
  get events(): EventsApi {
    return (this.eventsApi ??= new EventsApi(this))
  }

  GET<P extends PathsWith<'GET'>>(path: P, options?: TypedRequestOptions<OperationOf<P, 'GET'>>): Promise<ResponseData<P, 'GET'>> {
    return this.request('GET', path, options as RequestOptions)
  }

  POST<P extends PathsWith<'POST'>>(path: P, options?: TypedRequestOptions<OperationOf<P, 'POST'>>): Promise<ResponseData<P, 'POST'>> {
    return this.request('POST', path, options as RequestOptions)
  }

  PUT<P extends PathsWith<'PUT'>>(path: P, options?: TypedRequestOptions<OperationOf<P, 'PUT'>>): Promise<ResponseData<P, 'PUT'>> {
    return this.request('PUT', path, options as RequestOptions)
  }

  PATCH<P extends PathsWith<'PATCH'>>(path: P, options?: TypedRequestOptions<OperationOf<P, 'PATCH'>>): Promise<ResponseData<P, 'PATCH'>> {
    return this.request('PATCH', path, options as RequestOptions)
  }

  DELETE<P extends PathsWith<'DELETE'>>(path: P, options?: TypedRequestOptions<OperationOf<P, 'DELETE'>>): Promise<ResponseData<P, 'DELETE'>> {
    return this.request('DELETE', path, options as RequestOptions)
  }

  /**
   * Untyped request; `path` is relative to /api/v1 and may contain `{param}`
   * placeholders filled from `options.path`. Returns the unwrapped data.
   */
  async request<T = unknown>(method: HttpMethod | Lowercase<HttpMethod>, path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.raw(method, path, options)
    const envelope = options.envelope ?? findOperation(method, path)?.envelope ?? true
    if (!envelope) return response.body as T
    const body = response.body as Record<string, unknown> | null
    if (body && typeof body === 'object' && body.success === true && 'data' in body) return body.data as T
    return response.body as T
  }

  /**
   * Start an operation as a background job (`Prefer: respond-async`). Returns
   * the job, or — when the server answered synchronously (an older server, or
   * an operation without an async variant) — `{ data }`.
   */
  async startJob<T = unknown>(method: HttpMethod | Lowercase<HttpMethod>, path: string, options: RequestOptions = {}): Promise<{ job: Job; data?: undefined } | { job?: undefined; data: T }> {
    const response = await this.raw(method, path, { ...options, headers: { ...options.headers, Prefer: 'respond-async' } })
    const body = response.body as Record<string, unknown> | null
    const data = body && typeof body === 'object' && body.success === true && 'data' in body ? body.data : body
    if (response.status === 202 && data && typeof data === 'object' && 'job' in data) return { job: (data as { job: Job }).job }
    return { data: data as T }
  }

  async getJob(id: string): Promise<Job> {
    return (await this.request<{ job: Job }>('GET', '/jobs/{id}', { path: { id } })).job
  }

  async cancelJob(id: string): Promise<Job> {
    return (await this.request<{ job: Job }>('POST', '/jobs/{id}/cancel', { path: { id } })).job
  }

  /** Poll until the job is no longer queued or running. */
  async waitForJob(id: string, options: WaitOptions = {}): Promise<Job> {
    const started = Date.now()
    let interval = Math.max(200, options.intervalMs ?? 1000)
    let last = ''
    for (;;) {
      const job = await this.getJob(id)
      const stamp = `${job.status}:${job.progress}:${job.message ?? ''}`
      if (stamp !== last) { last = stamp; options.onProgress?.(job) }
      if (isFinished(job)) return job
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('Aborted')
      if (options.timeoutMs && Date.now() - started > options.timeoutMs) throw new UsertasksNetworkError(`Timed out waiting for job ${id} (still ${job.status})`)
      await sleep(interval)
      interval = Math.min(5000, Math.round(interval * 1.3))
    }
  }

  /** The JSON result of a finished job: what the synchronous request returns. */
  async jobResult<T = unknown>(id: string): Promise<T> {
    return this.request<T>('GET', '/jobs/{id}/result', { path: { id } })
  }

  /**
   * Run an operation as a background job and wait for its result — the same
   * data as `request()`, without one long HTTP request (no gateway timeouts).
   * Falls back to the synchronous response when the server answers inline.
   * Throws UsertasksJobError when the job fails or is cancelled.
   */
  async requestAndWait<T = unknown>(method: HttpMethod | Lowercase<HttpMethod>, path: string, options: RequestOptions & WaitOptions = {}): Promise<T> {
    const { intervalMs, timeoutMs, onProgress, ...request } = options
    const started = await this.startJob<T>(method, path, request)
    if (!started.job) return started.data as T
    const job = await this.waitForJob(started.job.id, { intervalMs, timeoutMs, onProgress, signal: request.signal })
    if (job.status !== 'succeeded') throw new UsertasksJobError(job)
    return this.jobResult<T>(job.id)
  }

  /** Download a finished job's result file. */
  async downloadJob(id: string, options: { signal?: AbortSignal } = {}): Promise<JobFile> {
    const url = new URL(this.baseUrl + buildPath('/jobs/{id}/download', { id }))
    const token = this.auth ? await this.auth.getToken() : undefined
    let response: Response
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers: { ...this.headers, Accept: '*/*', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: options.signal })
    } catch (error) {
      throw new UsertasksNetworkError(`GET ${url} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (!response.ok) throw toApiError(response.status, response.headers, await readBody(response))
    const disposition = response.headers.get('content-disposition') ?? ''
    const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
    const plain = /filename="([^"]+)"/i.exec(disposition)
    const filename = star ? decodeURIComponent(star[1]) : plain?.[1] ?? `job-${id}`
    return { bytes: new Uint8Array(await response.arrayBuffer()), filename, contentType: response.headers.get('content-type') ?? 'application/octet-stream' }
  }

  /**
   * Upload a file for an Attachments field and return its file object; put
   * its `id` in the field's value (task completion, form submission,
   * workflow start). `context` names where the field is: an open task, a
   * reusable form, or a workflow's start form. Large files go straight to
   * storage when the server's storage signs uploads (init → PUT → complete);
   * otherwise the file is sent base64 in one request (`inlineMaxBytes`,
   * default 3 MB, keeps it under small hosted body limits).
   */
  async uploadFile(
    context: { task_id?: string; form_id?: string; workflow_id?: string; field_key: string },
    file: { name: string; bytes: Uint8Array; contentType?: string },
    options: { inlineMaxBytes?: number; signal?: AbortSignal } = {},
  ): Promise<UploadedFile> {
    const base = { ...context, name: file.name }
    const toBase64 = (bytes: Uint8Array) => {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(binary)
    }
    const inline = async () => {
      const done = await this.request<{ mode: string; file: UploadedFile }>('POST', '/files/uploads', { body: { ...base, size: file.bytes.byteLength, content_base64: toBase64(file.bytes) } })
      return done.file
    }
    if (file.bytes.byteLength <= (options.inlineMaxBytes ?? 3 * 1024 * 1024)) return inline()
    const started = await this.request<{ mode: string; file_id?: string; upload?: { url: string; method: string; headers: Record<string, string> } }>('POST', '/files/uploads', { body: { ...base, size: file.bytes.byteLength } })
    if (started.mode !== 'direct' || !started.file_id || !started.upload) return inline()
    let put: Response
    try {
      put = await this.fetchImpl(started.upload.url, { method: started.upload.method, headers: started.upload.headers, body: file.bytes as unknown as NonNullable<RequestInit["body"]>, signal: options.signal })
    } catch (error) {
      throw new UsertasksNetworkError(`Upload of ${file.name} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    if (!put.ok) throw new UsertasksNetworkError(`Upload of ${file.name} failed: storage answered ${put.status}`)
    const done = await this.request<{ file: UploadedFile }>('POST', '/files/uploads/{id}/complete', { path: { id: started.file_id } })
    return done.file
  }

  /** Perform a request and return status, headers and parsed body (throws on non-2xx). */
  async raw(method: HttpMethod | Lowercase<HttpMethod>, path: string, options: RequestOptions = {}): Promise<RawResponse> {
    const verb = method.toUpperCase()
    const relative = buildPath(path.startsWith('/') ? path : `/${path}`, options.path)
    const url = new URL(this.baseUrl + relative)
    appendQuery(url, options.query)

    const headers: Record<string, string> = { ...this.headers, ...options.headers }
    let payload: string | undefined
    if (options.body !== undefined) {
      payload = JSON.stringify(options.body)
      headers['Content-Type'] ??= 'application/json'
    }

    const idempotent = IDEMPOTENT.has(verb)
    let token = this.auth ? await this.auth.getToken() : undefined
    let reauthorised = false

    for (let attempt = 0; ; attempt++) {
      const signals = [options.signal, this.timeoutMs ? AbortSignal.timeout(this.timeoutMs) : undefined].filter(
        (signal): signal is AbortSignal => Boolean(signal),
      )
      const started = Date.now()
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: verb,
          headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
          body: payload,
          signal: signals.length ? AbortSignal.any(signals) : undefined,
        })
      } catch (error) {
        if (options.signal?.aborted) throw error
        this.debug?.(`${verb} ${url} → network error (${Date.now() - started} ms)`)
        if (idempotent && attempt < this.retries) {
          await sleep(this.backoff(attempt))
          continue
        }
        const reason = error instanceof Error ? error.message : String(error)
        throw new UsertasksNetworkError(`${verb} ${url} failed: ${reason}`, { cause: error })
      }
      this.debug?.(`${verb} ${url} → ${response.status} (${Date.now() - started} ms)`)

      if (response.status === 401 && token && this.auth?.invalidate && !reauthorised) {
        reauthorised = true
        if (await this.auth.invalidate(token)) {
          await response.body?.cancel()
          token = await this.auth.getToken()
          attempt--
          continue
        }
        // invalidate() declined: surface the original 401.
        return this.finish(response)
      }

      if ((response.status === 429 || response.status >= 500) && idempotent && attempt < this.retries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
        await response.body?.cancel()
        await sleep(Math.min(this.maxRetryDelayMs, retryAfter ?? this.backoff(attempt)))
        continue
      }

      return this.finish(response)
    }
  }

  /**
   * Open a streaming response (Server-Sent Events): auth and a single 401
   * re-authorisation as for requests, but no retries and no timeout. Resolves
   * once headers arrive; non-2xx responses throw UsertasksApiError.
   */
  async openStream(path: string, options: Omit<RequestOptions, 'body' | 'envelope'> = {}): Promise<Response> {
    const relative = buildPath(path.startsWith('/') ? path : `/${path}`, options.path)
    const url = new URL(this.baseUrl + relative)
    appendQuery(url, options.query)
    const headers: Record<string, string> = { ...this.headers, Accept: 'text/event-stream', ...options.headers }
    let token = this.auth ? await this.auth.getToken() : undefined
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers,
          signal: options.signal,
        })
      } catch (error) {
        if (options.signal?.aborted) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new UsertasksNetworkError(`GET ${url} failed: ${reason}`, { cause: error })
      }
      this.debug?.(`GET ${url} → ${response.status} (stream)`)
      if (response.status === 401 && token && this.auth?.invalidate && attempt === 0 && (await this.auth.invalidate(token))) {
        await response.body?.cancel()
        token = await this.auth.getToken()
        continue
      }
      if (!response.ok) throw toApiError(response.status, response.headers, await readBody(response))
      if (!response.body) throw new UsertasksNetworkError(`GET ${url} returned no body`)
      return response
    }
  }

  /**
   * Iterate every item of a list endpoint, fetching `pageSize` rows at a time
   * via limit/offset until a short page or the reported total is reached.
   * Cursor-paged endpoints (responses with `next_cursor`, e.g. /events) are
   * followed via `after` until `has_more` is false.
   */
  async *paginate<T = unknown>(path: string, options: PaginateOptions = {}): AsyncGenerator<T, void, undefined> {
    const { listKey: explicitKey, pageSize: requested, ...rest } = options
    const pageSize = Math.min(100, Math.max(1, requested ?? 100))
    const operation = findOperation('GET', path)
    const listKey = explicitKey ?? operation?.listKey
    if (!listKey) throw new Error(`paginate: no listKey known for GET ${path}; pass options.listKey`)

    let offset = Number(rest.query?.offset ?? 0) || 0
    for (;;) {
      const data = await this.request<Record<string, unknown>>('GET', path, {
        ...rest,
        query: { ...rest.query, limit: pageSize, offset },
      })
      const items = data?.[listKey]
      if (!Array.isArray(items)) throw new Error(`paginate: response has no "${listKey}" array`)
      for (const item of items) yield item as T
      if ('next_cursor' in data) {
        yield* this.followCursor<T>(path, rest, listKey, data, pageSize)
        return
      }
      offset += items.length
      const total = typeof data.total === 'number' ? data.total : undefined
      if (items.length < pageSize || items.length === 0 || (total !== undefined && offset >= total)) return
    }
  }

  private async *followCursor<T>(path: string, rest: Omit<PaginateOptions, 'listKey' | 'pageSize'>, listKey: string, first: Record<string, unknown>, pageSize: number): AsyncGenerator<T, void, undefined> {
    let page = first
    while (page.has_more === true && typeof page.next_cursor === 'string') {
      const query: Record<string, QueryValue> = { ...rest.query, limit: pageSize, after: page.next_cursor }
      delete query.offset
      page = await this.request<Record<string, unknown>>('GET', path, { ...rest, query })
      const items = page?.[listKey]
      if (!Array.isArray(items)) throw new Error(`paginate: response has no "${listKey}" array`)
      for (const item of items) yield item as T
    }
  }

  private backoff(attempt: number): number {
    const base = this.retryDelayMs * 2 ** attempt
    return Math.min(this.maxRetryDelayMs, base + Math.random() * this.retryDelayMs)
  }

  private async finish(response: Response): Promise<RawResponse> {
    const body = await readBody(response)
    if (!response.ok) throw toApiError(response.status, response.headers, body)
    return { status: response.status, headers: response.headers, body, requestId: requestIdOf(response.headers) }
  }
}

export function createClient(options: ClientOptions): UsertasksClient {
  return new UsertasksClient(options)
}
