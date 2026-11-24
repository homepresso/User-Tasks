/**
 * Retry policy for AI-provider calls (lib/agents/retry.ts) and the call path
 * that applies it (lib/agent-executor callModel): which failures retry,
 * Retry-After and rate-limit reset headers honoured, attempts and total wait
 * capped, the status line reported, and the failure carried for the
 * friendly message. Mocked fetch and sleep — no real calls, no real waiting.
 */
import { describe, expect, it, vi } from 'vitest'
import { backoffMs, decideRetry, DEFAULT_RETRY_POLICY, parseDurationMs, providerWaitMs, retryPolicy } from '@/lib/agents/retry'
import { callModel, type RetryInfo } from '@/lib/agent-executor'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
const fail = (status: number, body: unknown = { error: { message: 'x' } }, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const headers = (h: Record<string, string>) => new Headers(h)

function seq(...responses: Array<Response | Error>) {
  const queue = [...responses]
  return vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
}

async function call(fetchImpl: any, extra: Record<string, unknown> = {}) {
  const sleeps: number[] = []
  const retries: RetryInfo[] = []
  const res = await callModel('https://api.example.com/v1/chat/completions', { 'Content-Type': 'application/json' }, { model: 'm', messages: [] }, {
    deadline: Date.now() + 240_000, fetchImpl, sleep: async (ms) => { sleeps.push(ms) }, random: () => 0.5, provider: 'openai',
    policy: { maxAttempts: 4, maxWaitMs: 45_000 },
    onRetry: (_a, _m, _d, info) => retries.push(info), ...extra,
  })
  return { res, sleeps, retries }
}

describe('policy', () => {
  it('defaults: 4 attempts within 45 s of waiting; env overrides, clamped', () => {
    expect(retryPolicy({}, {})).toEqual(DEFAULT_RETRY_POLICY)
    expect(retryPolicy({}, { AGENT_RETRY_MAX_ATTEMPTS: '2', AGENT_RETRY_MAX_WAIT_MS: '10000' })).toMatchObject({ maxAttempts: 2, maxWaitMs: 10_000 })
    expect(retryPolicy({}, { AGENT_RETRY_MAX_ATTEMPTS: '99', AGENT_RETRY_MAX_WAIT_MS: '-5' })).toMatchObject({ maxAttempts: 8, maxWaitMs: 0 })
    expect(retryPolicy({}, { AGENT_RETRY_MAX_ATTEMPTS: 'lots' })).toMatchObject({ maxAttempts: 4 })
    expect(retryPolicy({ maxAttempts: 1 }, { AGENT_RETRY_MAX_ATTEMPTS: '6' }).maxAttempts).toBe(1)
  })

  it('reads the provider\'s wait hints', () => {
    const now = Date.parse('2026-11-22T10:00:00Z')
    expect(providerWaitMs(headers({ 'retry-after': '6' }), now)).toBe(6_000)
    expect(providerWaitMs(headers({ 'retry-after-ms': '1500' }), now)).toBe(1_500)
    expect(providerWaitMs(headers({ 'retry-after': 'Sun, 22 Nov 2026 10:00:09 GMT' }), now)).toBe(9_000)
    expect(providerWaitMs(headers({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '1m30s', 'x-ratelimit-remaining-tokens': '500', 'x-ratelimit-reset-tokens': '2s' }), now)).toBe(90_000)
    expect(providerWaitMs(headers({ 'anthropic-ratelimit-requests-remaining': '0', 'anthropic-ratelimit-requests-reset': '2026-11-22T10:00:12Z' }), now)).toBe(12_000)
    expect(providerWaitMs(headers({ 'x-ratelimit-reset': String(now / 1000 + 20) }), now)).toBe(20_000)
    expect(providerWaitMs(headers({ 'x-ratelimit-reset': '3' }), now)).toBe(3_000)
    expect(providerWaitMs(headers({}), now)).toBeNull()
    expect(parseDurationMs('20ms')).toBe(20)
    expect(parseDurationMs('6m0s')).toBe(360_000)
    expect(parseDurationMs('soon')).toBeNull()
  })

  it('backoff: exponential with jitter, capped; a hint is honoured', () => {
    expect(backoffMs(1, null, DEFAULT_RETRY_POLICY, () => 0)).toBe(500)
    expect(backoffMs(3, null, DEFAULT_RETRY_POLICY, () => 1)).toBe(4_000)
    expect(backoffMs(10, null, DEFAULT_RETRY_POLICY, () => 1)).toBe(20_000)
    expect(backoffMs(1, 6_000, DEFAULT_RETRY_POLICY, () => 0)).toBe(6_000)
    expect(backoffMs(1, 6_000, DEFAULT_RETRY_POLICY, () => 1)).toBe(6_000)
  })

  it('gives up at max attempts, past the waiting budget, or past the deadline', () => {
    const base = { waitedMs: 0, hintMs: null, deadline: Date.now() + 100_000, policy: DEFAULT_RETRY_POLICY, random: () => 0.5 }
    expect(decideRetry({ ...base, attempt: 1 }).retry).toBe(true)
    expect(decideRetry({ ...base, attempt: 4 }).retry).toBe(false)
    expect(decideRetry({ ...base, attempt: 1, hintMs: 60_000 }).retry).toBe(false)
    expect(decideRetry({ ...base, attempt: 2, waitedMs: 44_000 }).retry).toBe(false)
    expect(decideRetry({ ...base, attempt: 1, deadline: Date.now() + 100 }).retry).toBe(false)
  })
})

describe('callModel retries', () => {
  it('429 then success: retried once, Retry-After honoured, the caller told', async () => {
    const { res, sleeps, retries } = await call(seq(fail(429, { error: { type: 'rate_limit_error' } }, { 'retry-after': '6' }), ok()))
    expect(res.ok).toBe(true)
    expect(res).toMatchObject({ attempts: 2, retries: 1 })
    expect(sleeps).toHaveLength(1)
    expect(sleeps[0]).toBe(6_000)
    expect(retries[0]).toMatchObject({ attempt: 1, nextAttempt: 2, maxAttempts: 4, kind: 'rate_limited', status: 429 })
  })

  for (const status of [500, 502, 503, 504, 529, 408]) {
    it(`${status} is retried`, async () => {
      const { res, sleeps } = await call(seq(fail(status), ok()))
      expect(res.ok).toBe(true)
      expect(sleeps).toHaveLength(1)
    })
  }

  it('network errors and timeouts are retried', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    const { res, sleeps } = await call(seq(new TypeError('fetch failed'), timeout, ok()))
    expect(res.ok).toBe(true)
    expect(sleeps).toHaveLength(2)
  })

  for (const status of [400, 401, 403, 404]) {
    it(`${status} is not retried`, async () => {
      const fetchImpl = seq(fail(status), ok())
      const { res, sleeps } = await call(fetchImpl)
      expect(res.ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(sleeps).toEqual([])
    })
  }

  it('out of credit (429 insufficient_quota, 402) is not retried', async () => {
    for (const r of [fail(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }), fail(402, 'Payment Required')]) {
      const fetchImpl = seq(r, ok())
      const { res } = await call(fetchImpl)
      expect(res.ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      if (!res.ok) expect(res.kind).toBe('quota')
    }
  })

  it('content policy and context too long (400) are not retried', async () => {
    for (const body of [{ error: { code: 'content_policy_violation', message: 'safety system' } }, { error: { code: 'context_length_exceeded', message: 'maximum context length' } }]) {
      const fetchImpl = seq(fail(400, body), ok())
      const { res } = await call(fetchImpl)
      expect(res.ok).toBe(false)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('stops at max attempts and carries the failure (status, body, request id, attempts)', async () => {
    const r = () => fail(429, { error: { message: 'Rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, { 'x-request-id': 'req_abc123' })
    const fetchImpl = seq(r(), r(), r(), r(), ok())
    const { res, sleeps, retries } = await call(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    expect(sleeps).toHaveLength(3)
    expect(retries.map((x) => x.nextAttempt)).toEqual([2, 3, 4])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failure).toMatchObject({ status: 429, requestId: 'req_abc123', attempts: 4, provider: 'openai' })
      expect(res.failure.body).toContain('rate_limit_exceeded')
    }
  })

  it('a hint longer than the waiting budget gives up at once', async () => {
    const fetchImpl = seq(fail(429, {}, { 'retry-after': '120' }), ok())
    const { res, sleeps } = await call(fetchImpl)
    expect(res.ok).toBe(false)
    expect(sleeps).toEqual([])
    if (!res.ok) expect(res.failure.retryAfterMs).toBe(120_000)
  })

  it('total waiting stays within the budget', async () => {
    const r = () => fail(503, '', { 'retry-after': '20' })
    const fetchImpl = seq(r(), r(), r(), r())
    const { sleeps } = await call(fetchImpl)
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(45_000)
    expect(sleeps).toHaveLength(2)
  })

  it('maxRetries (older callers) still bounds the attempts', async () => {
    const fetchImpl = seq(fail(500), fail(500), ok())
    const { res } = await call(fetchImpl, { policy: undefined, maxRetries: 1 })
    expect(res.ok).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a cancelled call is not retried', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => { controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })
    const { res, sleeps } = await call(fetchImpl, { signal: controller.signal })
    expect(res).toMatchObject({ ok: false, kind: 'cancelled' })
    expect(sleeps).toEqual([])
  })
})
