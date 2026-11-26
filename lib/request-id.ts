/**
 * Request ids: proxy.ts gives every request an `x-request-id` (a caller's own
 * id is kept when it looks like one: 8–128 of [A-Za-z0-9._:-], so a load
 * balancer's or client's correlation id survives), forwards it to the server
 * and echoes it on the response. instrumentation.ts onRequestError logs it
 * with the error digest, so a support report ties to one log line.
 * No imports: this runs in the proxy bundle.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

const VALID = /^[A-Za-z0-9._:-]{8,128}$/

export function resolveRequestId(incoming: string | null | undefined, mint: () => string = () => crypto.randomUUID()): string {
  const value = incoming?.trim()
  return value && VALID.test(value) ? value : mint()
}
