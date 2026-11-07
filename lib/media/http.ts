/**
 * The provider context for one step (server only): requests go through the
 * shared integration transport (lib/integrations/http connectorFetch: every
 * URL and redirect hop checked by the egress guard, credential headers
 * dropped when a redirect leaves the origin, rate-limit-aware retries — 429
 * for every method, 502/503/504 for idempotent ones — within one timeout
 * budget per request), tied to the step's own deadline / cancellation.
 */

import type { MediaCredentials, MediaProviderContext } from './types'
import { MEDIA_LIMITS } from './limits'

export interface ProviderContextOptions {
  /** The step's overall deadline / cancellation. */
  signal?: AbortSignal
  log?: (message: string) => void
  /** Per-request timeout (default MEDIA_LIMITS.providerRequestTimeoutMs). */
  requestTimeoutMs?: number
  /** Tests: the transport under the egress guard. */
  fetchImpl?: typeof fetch
}

export function providerContext(credentials: MediaCredentials, options: ProviderContextOptions = {}): MediaProviderContext {
  const timeout = options.requestTimeoutMs ?? MEDIA_LIMITS.providerRequestTimeoutMs
  return {
    credentials,
    signal: options.signal,
    log: options.log,
    fetch: async (url: string, init: RequestInit = {}) => {
      const { connectorFetch } = await import('@/lib/integrations/http')
      const signals = [options.signal, init.signal ?? undefined].filter((s): s is AbortSignal => Boolean(s))
      // connectorFetch owns the timeout; the step's signal cancels the transport underneath.
      const fetchImpl = options.fetchImpl ?? fetch
      const transport: typeof fetch = signals.length
        ? (input, reqInit) => fetchImpl(input, { ...reqInit, signal: reqInit?.signal ? AbortSignal.any([reqInit.signal, ...signals]) : AbortSignal.any(signals) })
        : fetchImpl
      const { signal: _s, ...rest } = init
      return connectorFetch(url, rest, { timeoutMs: timeout, fetchImpl: transport })
    },
  }
}

/** Run `fn` over items with at most `limit` in flight; results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
