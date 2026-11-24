/**
 * Friendly AI-provider errors (lib/agents/errors.ts): every failure maps to
 * plain language with a next step, the Details are sanitised (no raw JSON,
 * no keys), and only admins get the provider's own message and the
 * Settings link.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyFailure, describeFailure, describeRequestError, failureFromMessage, forViewer, parseProviderErrorBody,
  retryCountdownText, retryStatusMessage, retrySummary, retrySummaryText, sanitizeProviderMessage, technicalSummary, type ProviderFailure,
} from '@/lib/agents/errors'

const OWNER_EXAMPLE = 'Provider 429: {"error":{"message":"Rate limit exceeded","type":"rate_limit_error","param":null,"code":"rate_limit_exceeded"}} — the provider is rate limiting this key'

const http = (status: number, body: unknown, extra: Partial<ProviderFailure> = {}): ProviderFailure => ({
  kind: status === 401 || status === 403 ? 'auth' : status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : status >= 500 ? 'provider_unavailable' : 'bad_request',
  status, message: `Provider ${status}`, body: typeof body === 'string' ? body : JSON.stringify(body), attempts: 1, provider: 'openai', ...extra,
})

describe('the owner\'s example', () => {
  it('a raw "Provider 429: {json}" becomes the rate-limit message with sanitised details', () => {
    const f = failureFromMessage(OWNER_EXAMPLE, 'baseten')!
    expect(f).toMatchObject({ status: 429, kind: 'rate_limited' })
    const view = describeFailure({ ...f, attempts: 4 })
    expect(view.code).toBe('rate_limited')
    expect(view.message).toBe('The AI provider is busy right now (too many requests for this key). I tried 4 times. Please try again in a minute — or ask your admin to raise the provider\'s rate limit.')
    expect(view.retryable).toBe(true)
    expect(view.details).toEqual({ provider: 'Baseten', status: 429, error_code: 'rate_limit_exceeded', error_type: 'rate_limit_error', attempts: 4 })
    // No raw JSON anywhere a non-admin sees.
    const shown = JSON.stringify(forViewer(view, false))
    expect(shown).not.toMatch(/\{"error"/)
    expect(shown).not.toMatch(/"param"/)
    expect(shown).not.toContain('Rate limit exceeded')
    // Admins get the provider's own words (sanitised), never the body.
    expect(forViewer(view, true).admin_message).toBe('Rate limit exceeded')
  })
})

describe('mapping each case', () => {
  const cases: Array<[string, ProviderFailure, string, RegExp]> = [
    ['429 rate limit', http(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, { attempts: 4 }), 'rate_limited', /busy right now.*I tried 4 times/],
    ['429 insufficient_quota', http(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }), 'quota', /out of credit.*Settings → Agent/],
    ['402 payment', http(402, 'Payment Required'), 'quota', /out of credit/],
    ['Anthropic credit balance', http(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }), 'quota', /out of credit/],
    ['401', http(401, { error: { message: 'Incorrect API key provided: sk-proj-abcdefghijklmnop1234.', type: 'invalid_request_error', code: 'invalid_api_key' } }), 'auth', /rejected the API key\. An admin needs to update it in Settings → Agent/],
    ['403', http(403, { error: { type: 'permission_error', message: 'nope' } }), 'auth', /rejected the API key/],
    ['404 model', http(404, { error: { message: 'The model `gpt-9` does not exist', code: 'model_not_found' } }), 'model_not_found', /model isn't available.*pick another model/],
    ['400 unknown model', http(400, { error: { message: 'Unknown model: foo-1' } }), 'model_not_found', /model isn't available/],
    ['500', http(500, 'Internal Server Error', { attempts: 4 }), 'overloaded', /having trouble\. I retried a few times/],
    ['529 overloaded', http(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), 'overloaded', /having trouble/],
    ['503', http(503, ''), 'overloaded', /having trouble/],
    ['timeout', { kind: 'timeout', status: null, message: 'The provider did not answer in time', attempts: 3, provider: 'openai' }, 'timeout', /took too long.*3 tries/],
    ['network', { kind: 'network', status: null, message: 'Could not reach the provider: fetch failed', attempts: 1, provider: 'openai' }, 'network', /couldn't reach the AI provider/],
    ['context length', http(400, { error: { message: 'This model\'s maximum context length is 128000 tokens.', code: 'context_length_exceeded' } }), 'context_too_long', /too long for the model — start a new chat or remove attachments/],
    ['413', http(413, 'Request Entity Too Large'), 'context_too_long', /too long/],
    ['Anthropic prompt too long', http(400, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: 210000 tokens > 200000 maximum' } }), 'context_too_long', /too long/],
    ['content policy', http(400, { error: { message: 'Your request was rejected as a result of our safety system.', code: 'content_policy_violation' } }), 'content_policy', /declined this request under its content policy/],
    ['Azure content filter', http(400, { error: { code: 'content_filter', message: 'The response was filtered' } }), 'content_policy', /content policy/],
    ['tools unsupported', http(400, { error: 'Tool calling is not supported for this model' }), 'tools_unsupported', /can't use the tools/],
    ['other 400', http(400, { error: { message: 'max_tokens: must be ≤ 8192' } }), 'bad_request', /couldn't process this request/],
    ['mid-stream overloaded', { kind: 'provider_unavailable', status: null, message: 'Provider error mid-stream: Overloaded', errorType: 'overloaded_error', attempts: 2, provider: 'anthropic' }, 'overloaded', /having trouble/],
    ['cancelled', { kind: 'cancelled', status: null, message: 'Agent run was cancelled', attempts: 1 }, 'cancelled', /Stopped/],
  ]
  for (const [name, failure, code, message] of cases) {
    it(name, () => {
      const view = describeFailure(failure)
      expect(view.code).toBe(code)
      expect(view.message).toMatch(message)
      expect(classifyFailure(failure)).toBe(code)
    })
  }

  it('retry makes sense only for transient failures; admin fixes are flagged', () => {
    expect(describeFailure(http(429, '')).retryable).toBe(true)
    expect(describeFailure(http(500, '')).retryable).toBe(true)
    expect(describeFailure(http(401, '')).retryable).toBe(false)
    expect(describeFailure(http(401, '')).admin_fix).toBe(true)
    expect(describeFailure(http(402, '')).admin_fix).toBe(true)
    expect(describeFailure(http(400, { error: { code: 'context_length_exceeded' } })).retryable).toBe(false)
  })

  it('workflow agents point at their own connection, not Settings → Agent', () => {
    expect(describeFailure(http(401, ''), { audience: 'agent' }).message).toMatch(/agent's AI connection \(Integrations\)/)
    expect(describeFailure(http(401, ''), { audience: 'agent' }).message).not.toMatch(/Settings → Agent/)
  })

  it('Retry-After shapes the rate-limit wording', () => {
    expect(describeFailure(http(429, '', { retryAfterMs: 90_000 })).message).toMatch(/try again in about 2 minutes/)
    expect(describeFailure(http(429, '', { retryAfterMs: 30_000 })).retry_after_s).toBe(30)
  })
})

describe('sanitising', () => {
  it('keys, bearer tokens and JWTs are masked in the admin message; long text is capped', () => {
    const view = describeFailure(http(401, { error: { message: 'Incorrect API key provided: sk-proj-abcdefghijklmnopqrstu. Bearer abcdefghijklmnop eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig' } }))
    expect(view.admin_message).not.toMatch(/sk-proj-abc/)
    expect(view.admin_message).not.toMatch(/abcdefghijklmnop/)
    expect(view.admin_message).not.toMatch(/eyJhbGci/)
    expect(sanitizeProviderMessage('x'.repeat(10) + ' ' + 'word '.repeat(100)).length).toBeLessThanOrEqual(200)
  })

  it('details never carry the body; odd error codes are dropped', () => {
    const view = describeFailure(http(400, { error: { code: '<script>alert(1)</script>', type: 'invalid request {}', message: 'bad' } }))
    expect(view.details.error_code).toBeUndefined()
    expect(view.details.error_type).toBeUndefined()
    expect(JSON.stringify(view.details)).not.toMatch(/script|bad/)
  })

  it('non-admins lose admin_message and the settings link; admins get both', () => {
    const view = describeFailure(http(401, { error: { message: 'no' } }))
    expect(forViewer(view, false)).not.toHaveProperty('admin_message')
    expect(forViewer(view, false)).not.toHaveProperty('settings_href')
    expect(forViewer(view, true)).toMatchObject({ admin_message: 'no', settings_href: '/settings/assistants' })
    expect(forViewer(describeFailure(http(500, '')), true)).not.toHaveProperty('settings_href')
  })

  it('retries are quiet for non-admins: the attempt count is admin-only (the friendly message is unchanged)', () => {
    const view = describeFailure(http(429, { error: { type: 'rate_limit_error' } }, { requestId: 'req_1', attempts: 4 }))
    expect(forViewer(view, false).details).not.toHaveProperty('attempts')
    expect(forViewer(view, false).message).toBe(view.message)
    expect(forViewer(view, true).details.attempts).toBe(4)
  })

  it('a retry summary for the admin\'s Details after the turn', () => {
    expect(retrySummary({ retries: 0 })).toBeNull()
    const s = retrySummary({ retries: 2, lastRetry: { code: 'rate_limited', status: 429 }, provider: 'anthropic' })!
    expect(s).toEqual({ retries: 2, code: 'rate_limited', status: 429, provider: 'Anthropic' })
    expect(retrySummaryText(s)).toBe('Answered after 2 automatic retries (rate limited · HTTP 429 · Anthropic)')
    expect(retrySummaryText({ retries: 1, code: 'timeout' })).toBe('Answered after 1 automatic retry (timed out)')
  })

  it('a technical summary for logs', () => {
    expect(technicalSummary(describeFailure(http(429, { error: { type: 'rate_limit_error' } }, { requestId: 'req_1', attempts: 4 })))).toBe('OpenAI · HTTP 429 · rate_limit_error · request req_1 · 4 attempts')
  })

  it('parses the usual body shapes', () => {
    expect(parseProviderErrorBody('{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}')).toEqual({ message: 'Resource has been exhausted', type: 'RESOURCE_EXHAUSTED', code: '429' })
    expect(parseProviderErrorBody('{"message":"Too many requests","__type":"com.amazon#ThrottlingException"}').type).toBe('ThrottlingException')
    expect(parseProviderErrorBody('plain text').message).toBe('plain text')
  })
})

describe('requests refused before the model', () => {
  it('not configured, limits', () => {
    expect(describeRequestError('config', 'No API key is saved for the Agent')).toMatchObject({ code: 'not_configured', message: expect.stringMatching(/isn't set up yet/), admin_fix: true, details: { reason: 'No API key is saved for the Agent' }, retryable: false })
    expect(describeRequestError('rate_limited', 'Too many Agent messages — wait a moment and try again.', 12_000)).toMatchObject({ code: 'limit', retryable: true, retry_after_s: 12 })
    expect(describeRequestError('daily_messages', 'You\'ve reached today\'s limit')).toMatchObject({ code: 'limit', retryable: false })
  })
})

describe('retry status lines (server logs / run traces only — never shown live)', () => {
  it('counts down and names the attempt', () => {
    expect(retryStatusMessage({ kind: 'rate_limited', nextAttempt: 2, maxAttempts: 4, delayMs: 6_000 })).toBe('The AI provider is busy — retrying in 6 s (attempt 2 of 4)…')
    expect(retryCountdownText('overloaded', 0, 3, 4)).toBe('The AI provider is having trouble — trying again (attempt 3 of 4)…')
    expect(retryCountdownText('network', 2.2, 2, 4)).toMatch(/couldn't be reached — retrying in 3 s/)
  })
})

describe('legacy strings', () => {
  it('only provider-looking messages are mapped', () => {
    expect(failureFromMessage('The Agent ran out of time — try a smaller request')).toBeNull()
    expect(failureFromMessage('Could not reach the provider: ECONNRESET')).toMatchObject({ kind: 'network' })
    expect(failureFromMessage('The AI provider failed: Provider 401: {"error":"bad key"} — check the integration\'s API key')).toMatchObject({ status: 401 })
  })
})
