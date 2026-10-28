import { errorResponse, type Identity, type PgQueryResponse, type RequestHandler } from './handler'
import { fromPgError, PgrstError } from './errors'

/**
 * A `fetch` that answers PostgREST requests in-process. supabase-js /
 * postgrest-js build exactly the HTTP request they would send to PostgREST;
 * this function serves it from pg-query instead, so the client's whole API
 * (builders, `.single()`, `.maybeSingle()`, error objects, types) is the
 * real one. Requests outside the REST prefix (auth, storage, functions) go
 * to `fallback`.
 */

export interface PgFetchOptions {
  handler: RequestHandler
  /** Identity for a request (from its headers, or fixed for service clients). */
  identity: (headers: Headers) => Promise<Identity> | Identity
  /** URL path prefix served in-process. Default `/rest/v1/`. */
  restPrefix?: string
  fallback?: typeof fetch
}

function toResponse(r: PgQueryResponse): Response {
  return new Response(r.body === null || r.status === 204 ? null : r.body, {
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
  })
}

export function createPgFetch(opts: PgFetchOptions): typeof fetch {
  const prefix = opts.restPrefix ?? '/rest/v1/'
  const fallback = opts.fallback ?? globalThis.fetch
  const pgFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input))
    const at = url.pathname.indexOf(prefix)
    if (at < 0) return fallback(input as Parameters<typeof fetch>[0], init)
    const signal = init?.signal ?? request?.signal
    if (signal?.aborted) throw signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
    const headers = new Headers(init?.headers ?? request?.headers)
    let body: string | null = null
    if (init?.body !== undefined && init.body !== null) body = typeof init.body === 'string' ? init.body : await new Response(init.body).text()
    else if (request && request.body) body = await request.text()
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    let identity: Identity
    try {
      identity = await opts.identity(headers)
    } catch (err) {
      return toResponse(errorResponse(err instanceof PgrstError ? err : fromPgError(err, false)))
    }
    const res = await opts.handler.handle(
      { method, path: url.pathname.slice(at + prefix.length), search: url.searchParams, headers, body },
      identity,
    )
    return toResponse(res)
  }
  return pgFetch as typeof fetch
}
