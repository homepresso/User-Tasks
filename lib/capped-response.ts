/**
 * Responses whose body may not exceed a byte cap. Workflow steps that fetch
 * a URL the workflow names (HTTP Request, Download / Read File, CSV / Excel
 * import, file responses) read the whole body into memory; without a cap a
 * builder could point one at a multi-GB file and crash the shared worker
 * process (out of memory), taking every other tenant's jobs on it down.
 *
 * capResponseBody wraps a Response so .arrayBuffer() / .json() / .text()
 * keep working but fail with ResponseBodyTooLargeError once the cap is
 * passed (a declared Content-Length over the cap fails at once).
 */

/** Default cap for workflow downloads (env WORKFLOW_DOWNLOAD_MAX_BYTES, default 100 MB). */
export function workflowDownloadMaxBytes(): number {
  const value = Number(process.env.WORKFLOW_DOWNLOAD_MAX_BYTES)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 100 * 1024 * 1024
}

export class ResponseBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`The response is larger than the ${Math.round(limit / (1024 * 1024))} MB limit for workflow downloads (WORKFLOW_DOWNLOAD_MAX_BYTES)`)
    this.name = 'ResponseBodyTooLargeError'
  }
}

export function capResponseBody(res: Response, maxBytes: number = workflowDownloadMaxBytes()): Response {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    res.body?.cancel().catch(() => {})
    throw new ResponseBodyTooLargeError(maxBytes)
  }
  if (!res.body || [101, 204, 205, 304].includes(res.status)) return res
  let total = 0
  const capped = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength
        if (total > maxBytes) {
          controller.error(new ResponseBodyTooLargeError(maxBytes))
          return
        }
        controller.enqueue(chunk)
      },
    }),
  )
  const out = new Response(capped, { status: res.status, statusText: res.statusText, headers: res.headers })
  // Keep what callers read off the original (redirect target, type).
  Object.defineProperty(out, 'url', { value: res.url })
  Object.defineProperty(out, 'redirected', { value: res.redirected })
  return out
}
