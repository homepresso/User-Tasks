/**
 * Retry policy for AI-provider calls (client-safe, pure).
 *
 * Transient failures are retried: 429 (unless the key is out of credit),
 * 408 / 409 / 5xx / 529 (provider overloaded), timeouts and network errors.
 * Never: 400 / 401 / 403 / 404, out-of-credit (402, insufficient_quota),
 * context too long or content-policy refusals.
 *
 * The provider's wait hint is honoured — Retry-After (seconds or a date),
 * retry-after-ms, OpenAI's x-ratelimit-reset-requests / -tokens ("1m30s",
 * "20ms"), Anthropic's anthropic-ratelimit-*-reset (RFC 3339) and a generic
 * x-ratelimit-reset (seconds, or epoch seconds) — otherwise exponential
 * backoff with jitter. Attempts and the total time spent waiting are both
 * capped; a hint longer than the time left gives up at once (the friendly
 * message then says how long to wait).
 *
 * Retries are per model call: tools that already ran in a turn are never
 * re-run (the loops call tools only after a model call succeeded), and text
 * already streamed for a failed attempt is withdrawn (delta_reset).
 *
 * Defaults: 4 attempts within 45 s of waiting. Override with the env vars
 * AGENT_RETRY_MAX_ATTEMPTS (1–8) and AGENT_RETRY_MAX_WAIT_MS (0–120000).
 */

export interface RetryPolicy {
  /** Attempts in all (1 = no retry). */
  maxAttempts: number
  /** Total time spent waiting between attempts. */
  maxWaitMs: number
  /** First backoff (doubles each retry). */
  baseDelayMs: number
  /** One backoff never exceeds this (a provider's own hint may, within maxWaitMs). */
  maxDelayMs: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, maxWaitMs: 45_000, baseDelayMs: 1_000, maxDelayMs: 20_000 }

function envInt(value: string | undefined, min: number, max: number): number | null {
  if (value === undefined || value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** The policy from the environment (AGENT_RETRY_MAX_ATTEMPTS / AGENT_RETRY_MAX_WAIT_MS), then explicit overrides. */
export function retryPolicy(overrides: Partial<RetryPolicy> = {}, env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): RetryPolicy {
  const attempts = envInt(env.AGENT_RETRY_MAX_ATTEMPTS, 1, 8)
  const wait = envInt(env.AGENT_RETRY_MAX_WAIT_MS, 0, 120_000)
  return {
    ...DEFAULT_RETRY_POLICY,
    ...(attempts !== null ? { maxAttempts: attempts } : {}),
    ...(wait !== null ? { maxWaitMs: wait } : {}),
    ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))),
  }
}

/** "1m30s", "6s", "20ms", "0.5s", "2h" (OpenAI's reset headers) → ms. */
export function parseDurationMs(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000)
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g
  let total = 0
  let matched = ''
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const n = Number(m[1])
    total += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000
    matched += m[0]
  }
  return matched === t ? Math.round(total) : null
}

/** How long the provider asked us to wait, from its response headers (null: it didn't say). */
export function providerWaitMs(headers: { get(name: string): string | null } | null | undefined, now: number = Date.now()): number | null {
  if (!headers?.get) return null
  const get = (n: string) => { const v = headers.get(n); return v === null || v === undefined ? null : String(v).trim() || null }
  const ms = get('retry-after-ms')
  if (ms && /^\d+(\.\d+)?$/.test(ms)) return Math.max(0, Math.round(Number(ms)))
  const ra = get('retry-after')
  if (ra) {
    if (/^\d+(\.\d+)?$/.test(ra)) return Math.max(0, Math.round(Number(ra) * 1000))
    const at = Date.parse(ra)
    if (!Number.isNaN(at)) return Math.max(0, at - now)
  }
  // Rate-limit resets: the longest of the limits that are exhausted (or of all given, when remaining isn't sent).
  const waits: number[] = []
  for (const kind of ['requests', 'tokens']) {
    const reset = get(`x-ratelimit-reset-${kind}`)
    const remaining = get(`x-ratelimit-remaining-${kind}`)
    if (reset && (remaining === null || Number(remaining) <= 0)) { const d = parseDurationMs(reset); if (d !== null) waits.push(d) }
  }
  for (const kind of ['requests', 'tokens', 'input-tokens', 'output-tokens']) {
    const reset = get(`anthropic-ratelimit-${kind}-reset`)
    const remaining = get(`anthropic-ratelimit-${kind}-remaining`)
    if (reset && (remaining === null || Number(remaining) <= 0)) { const at = Date.parse(reset); if (!Number.isNaN(at)) waits.push(Math.max(0, at - now)) }
  }
  const generic = get('x-ratelimit-reset')
  if (generic && /^\d+(\.\d+)?$/.test(generic)) {
    const n = Number(generic)
    // Epoch seconds (a 10-digit number) or seconds to wait.
    waits.push(n > 1e9 ? Math.max(0, n * 1000 - now) : Math.round(n * 1000))
  }
  return waits.length ? Math.max(...waits) : null
}

/**
 * The wait before the next attempt (`attempt` = the 1-based attempt that just
 * failed): exactly the provider's hint when it gave one, else exponential
 * backoff with jitter, capped.
 */
export function backoffMs(attempt: number, hintMs: number | null, policy: RetryPolicy = DEFAULT_RETRY_POLICY, random: () => number = Math.random): number {
  if (hintMs !== null && hintMs >= 0) return Math.round(hintMs)
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(base / 2 + random() * (base / 2))
}

export interface RetryDecision { retry: boolean; delayMs: number }

/**
 * Whether to retry after attempt `attempt` failed with a retryable error,
 * given the time already spent waiting and the call's deadline.
 */
export function decideRetry(input: { attempt: number; waitedMs: number; hintMs: number | null; deadline: number; now?: number; policy: RetryPolicy; random?: () => number }): RetryDecision {
  const { attempt, waitedMs, hintMs, policy } = input
  const now = input.now ?? Date.now()
  if (attempt >= policy.maxAttempts) return { retry: false, delayMs: 0 }
  const delayMs = backoffMs(attempt, hintMs, policy, input.random)
  // A provider hint longer than the waiting budget: give up now rather than wait for nothing.
  if (waitedMs + delayMs > policy.maxWaitMs) return { retry: false, delayMs }
  if (now + delayMs >= input.deadline) return { retry: false, delayMs }
  return { retry: true, delayMs }
}
