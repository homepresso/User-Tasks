/**
 * Endpoint registry for the public REST API (/api/v1).
 *
 * Each endpoint is declared once with defineEndpoint(): its zod schemas drive
 * request validation (via apiRoute), the generated OpenAPI document
 * (openapi.ts → openapi.json) and, through the `cli` metadata, the generated
 * CLI commands. Keep this module dependency-free apart from zod so it can be
 * loaded by scripts and the packages' build tooling.
 */

import type { z } from 'zod'
import { isPlainObject } from '@/lib/utils/guards'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface CliMetadata {
  /** Command group, e.g. `workflows` → `usertasks workflows <verb>`. */
  resource: string
  /** Sub-command, e.g. `list`, `get`, `create`. */
  verb: string
  /** Path params (in order) taken as positional CLI arguments. */
  positional?: string[]
}

export interface EndpointDef<
  P extends z.ZodType | undefined = z.ZodType | undefined,
  Q extends z.ZodType | undefined = z.ZodType | undefined,
  B extends z.ZodType | undefined = z.ZodType | undefined,
  R extends z.ZodType | undefined = z.ZodType | undefined,
> {
  method: HttpMethod
  /** Path relative to /api/v1, OpenAPI-style params: `/workflows/{id}`. */
  path: string
  operationId: string
  summary: string
  description?: string
  tags: string[]
  /** Permission key required (null = any authenticated caller). */
  permission: string | null
  /** `none` = public endpoint (no bearer token). Defaults to `bearer`. */
  auth?: 'bearer' | 'none'
  params?: P
  query?: Q
  body?: B
  /** Schema of the envelope's `data` member (or the whole body when `envelope` is false). */
  response?: R
  /**
   * false = legacy route that returns a bare JSON body instead of the
   * `{ success, data }` envelope. Defaults to true.
   */
  envelope?: boolean
  /** Status returned on success (default 200). */
  successStatus?: number
  /**
   * Server-Sent Events endpoint: the success response is `text/event-stream`
   * (no envelope), marked `x-usertasks-stream: true` in OpenAPI. Not exposed
   * as a generated CLI command (`usertasks logs tail` covers it).
   */
  stream?: boolean
  /**
   * Has an async variant: `?async=true` or `Prefer: respond-async` returns
   * 202 with a background job (GET /jobs/{id}, then /jobs/{id}/result).
   * The handler must be registered in lib/user-jobs/kinds/api.ts.
   */
  async?: boolean
  /**
   * Returns a file (any content type, attachment), not JSON; marked
   * `x-usertasks-download: true`. Not a generated CLI command (hand-written).
   */
  download?: boolean
  /** Key within `data` holding the item array for list endpoints. */
  listKey?: string
  cli?: CliMetadata
  /**
   * Also accept multipart/form-data: text fields become body fields of the
   * same name, and each file field becomes two body fields (its file name
   * and its base64 content), so the JSON body schema validates both forms.
   */
  multipart?: MultipartOptions
  /**
   * Update endpoints: the matching GET response is also accepted as the body,
   * so `get -o json > x.json` → edit → `update -f x.json` works (see
   * prepareRoundTripBody).
   */
  roundTrip?: RoundTripOptions
}

export interface MultipartOptions {
  /** Form file field → the body fields receiving its name and base64 content. */
  files: Record<string, { name: string; content: string }>
}

export interface RoundTripOptions {
  /** GET wraps the item as `{ <unwrap>: {...} }`: such a body is unwrapped first. */
  unwrap?: string
  /** Resource-specific reshaping, applied before unwrapping. */
  normalize?: (raw: unknown) => unknown
}

/**
 * Make a fetched resource acceptable as an update body:
 *   1. `normalize` (resource-specific), then unwrap `{ <unwrap>: {...} }`
 *      unless <unwrap> is itself a body field;
 *   2. top-level `null` for a field whose schema doesn't accept null is
 *      dropped (= unchanged): GET returns null for unset optional columns.
 * Read-only fields (id, timestamps, counts) need nothing here: object
 * schemas strip unknown keys.
 */
export function prepareRoundTripBody(body: z.ZodType | undefined, options: RoundTripOptions, raw: unknown): unknown {
  let value = options.normalize ? options.normalize(raw) : raw
  if (!isPlainObject(value)) return value
  const shape = (body as unknown as { shape?: Record<string, z.ZodType> } | undefined)?.shape
  if (options.unwrap && isPlainObject(value[options.unwrap]) && !(shape && options.unwrap in shape)) {
    value = value[options.unwrap] as Record<string, unknown>
  }
  if (!shape) return value
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  for (const [key, field] of Object.entries(out)) {
    if (field === null && shape[key] && !shape[key].safeParse(null).success) delete out[key]
  }
  return out
}

export function defineEndpoint<
  P extends z.ZodType | undefined = undefined,
  Q extends z.ZodType | undefined = undefined,
  B extends z.ZodType | undefined = undefined,
  R extends z.ZodType | undefined = undefined,
>(def: EndpointDef<P, Q, B, R>): EndpointDef<P, Q, B, R> {
  return def
}

/** `/workflows/{id}` → `/workflows/[id]` (App Router folder form). */
export function toRouteSegmentPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, '[$1]')
}
