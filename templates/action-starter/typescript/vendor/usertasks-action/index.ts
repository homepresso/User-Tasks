/**
 * @user-tasks/action — build custom workflow actions for UserTasks.
 *
 *   import { defineAction } from '@user-tasks/action'
 *
 *   export default defineAction({
 *     operations: {
 *       add: (inputs: { a: number; b: number }) => ({ sum: inputs.a + inputs.b }),
 *     },
 *   })
 *
 * The module runs in the UserTasks QuickJS sandbox: plain JavaScript (ES2023),
 * no Node or browser APIs, no imports at run time (bundle dependencies), and
 * only `ctx` to reach the outside world. See `@user-tasks/action/testing` to run
 * it locally in the same sandbox.
 */

export * from './contract'

/** HTTP response as ctx.http.fetch returns it. */
export interface ActionHttpResponse {
  status: number
  ok: boolean
  headers: Record<string, string>
  text: string
  /** Parsed body when it is JSON (else null). */
  json: unknown
}

export interface ActionHttpInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'
  /** A header value may be `secret://name` (or `Bearer secret://name`): the host substitutes the secret. */
  headers?: Record<string, string>
  body?: string
  /** JSON body (sets content-type). */
  json?: unknown
  timeout_ms?: number
}

export interface ActionRow {
  id: string
  data: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
}

export interface ActionRowQuery {
  filters?: Array<{ field: string; operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'not_empty'; value?: unknown }>
  search?: string
  /** `field`, `-field` or `field.desc`. */
  sort?: string
  limit?: number
  offset?: number
}

export interface ActionFile {
  name: string
  mime_type: string
  size: number
  text?: string
  base64?: string
}

/** What an operation receives as its second argument. */
export interface ActionContext {
  readonly operation: string
  readonly run: { id: string | null; workflow_id: string | null; step_id: string | null; test: boolean }
  readonly log: {
    info(message: string, metadata?: Record<string, unknown>): void
    warn(message: string, metadata?: Record<string, unknown>): void
    error(message: string, metadata?: Record<string, unknown>): void
  }
  /** Fail the step; `retryable` lets the workflow's retry policy try again. */
  fail(message: string, options?: { retryable?: boolean }): never
  /** capabilities.http — approved hosts only, through the egress guard. */
  readonly http: { fetch(url: string, init?: ActionHttpInit): Promise<ActionHttpResponse> }
  /** capabilities.data — tables an administrator granted (by id or name). */
  readonly data: {
    query(table: string, query?: ActionRowQuery): Promise<{ rows: ActionRow[]; total: number; truncated: boolean }>
    get(table: string, rowId: string): Promise<ActionRow | null>
    insert(table: string, values: Record<string, unknown>): Promise<ActionRow | null>
    update(table: string, rowId: string, values: Record<string, unknown>): Promise<ActionRow | null>
  }
  /** capabilities.files — files given to the action as `file` inputs. */
  readonly files: { read(file: unknown, options?: { as?: 'text' | 'base64' }): Promise<ActionFile> }
  /** capabilities.credentials — `secret://<declared name>`. */
  readonly secrets: { get(ref: string): Promise<string> }
  /** Always available (no authority). */
  readonly crypto: {
    randomUUID(): string
    randomBytes(n: number, encoding?: 'hex' | 'base64' | 'base64url'): string
    /** Integer in [min, max). */
    randomInt(min: number, max: number): number
    digest(alg: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | 'MD5', data: string, encoding?: 'hex' | 'base64' | 'base64url'): string
    /** The key may be `secret://name` (needs capabilities.credentials); resolved on the host. */
    hmac(alg: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512', key: string, data: string, encoding?: 'hex' | 'base64' | 'base64url'): Promise<string>
    timingSafeEqual(a: string, b: string): boolean
    /** Re-encode data: from / to 'utf8' | 'hex' | 'base64' | 'base64url'. */
    encode(data: string, from: 'utf8' | 'hex' | 'base64' | 'base64url', to: 'utf8' | 'hex' | 'base64' | 'base64url'): string
  }
  /** Always available: Intl, which QuickJS lacks. */
  readonly intl: {
    formatNumber(value: number, locale?: string, options?: Record<string, unknown>): string
    formatDate(value: string, locale?: string, options?: Record<string, unknown>): string
    zonedParts(instant: string, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: string; offset_minutes: number; iso: string }
    zonedToUtc(local: string, timeZone: string): string
    timeZones(): string[]
    collate(a: string, b: string, locale?: string, options?: Record<string, unknown>): number
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- operation input / output shapes are the author's */
/** An operation: (inputs, ctx) → its outputs object (interfaces welcome — no index signature needed). */
export type ActionOperationFn<I = any, O extends object = Record<string, unknown>> = (inputs: I, ctx: ActionContext) => O | Promise<O>

export interface ActionDefinition {
  operations: Record<string, ActionOperationFn<any, object>>
}

/** Identity helper with types: `export default defineAction({ operations: { … } })`. */
export function defineAction<T extends ActionDefinition>(definition: T): T {
  if (!definition || typeof definition !== 'object' || !definition.operations || typeof definition.operations !== 'object') {
    throw new Error('defineAction({ operations: { id: fn } })')
  }
  return definition
}
