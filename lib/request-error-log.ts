/**
 * Server errors as one JSON line each (instrumentation.ts onRequestError):
 * the digest users see on the error page, the request id (lib/request-id.ts),
 * method, path without its query string (tokens live there), route and kind.
 * Next.js still prints its own stack trace; this line is the one log
 * pipelines can parse and support can search for.
 */
export interface RequestErrorInfo {
  path: string
  method: string
  headers: Record<string, string | string[] | undefined>
}

export interface RequestErrorContext {
  routerKind?: string
  routePath?: string
  routeType?: string
  renderSource?: string
}

export function requestErrorLine(error: unknown, request: RequestErrorInfo, context: RequestErrorContext): string {
  const e = (error ?? {}) as { message?: unknown; digest?: unknown; name?: unknown }
  const header = request.headers['x-request-id']
  return JSON.stringify({
    level: 'error',
    msg: 'request failed',
    time: new Date().toISOString(),
    digest: typeof e.digest === 'string' ? e.digest : undefined,
    requestId: Array.isArray(header) ? header[0] : header,
    method: request.method,
    path: String(request.path ?? '').split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    error: typeof e.name === 'string' ? e.name : 'Error',
    message: typeof e.message === 'string' ? e.message.slice(0, 500) : undefined,
  })
}
