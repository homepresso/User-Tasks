/**
 * Friendly AI-provider errors (client-safe, pure) — ONE place that turns a
 * provider / HTTP / network failure into plain language with a next step,
 * shared by the Agent (lib/assistants), workflow agents' run logs
 * (lib/agent-executor), the agent designer's test console and the PDF
 * import's AI assist.
 *
 * Two shapes:
 *  - ProviderFailure: what the call path knows (status, the provider's error
 *    body — already secret-redacted — request id, Retry-After, attempts).
 *    Server-side only; it is never sent to a browser as is.
 *  - AgentFailureView: what a person sees — a friendly message, whether a
 *    Retry makes sense, whether an admin fixes it in Settings, and a
 *    sanitised technical summary (provider, status, error code / type,
 *    request id, attempts). Never the raw body, headers or keys. The
 *    provider's own message is kept only as `admin_message` (sanitised,
 *    capped) for people who can change the Agent's settings.
 *
 * Classification order matters: a 429 that says "insufficient_quota" is out
 * of credit (no retry helps), a 400 about the context window is "too long",
 * a 400 from a safety filter is a content-policy refusal.
 */

import type { AgentErrorKind } from './provider'

export type AgentFailureCode =
  | 'rate_limited' | 'quota' | 'auth' | 'model_not_found' | 'overloaded' | 'timeout' | 'network'
  | 'context_too_long' | 'content_policy' | 'tools_unsupported' | 'not_configured' | 'bad_request'
  | 'limit' | 'cancelled' | 'unknown'

export interface ProviderFailure {
  kind: AgentErrorKind | 'cancelled'
  /** HTTP status (null: network / timeout / a mid-stream error). */
  status: number | null
  /** The technical message (what the run logs showed before). */
  message: string
  /** The provider's error body (secret-redacted, capped). Server-side only. */
  body?: string | null
  /** Error type / code from a mid-stream error event (e.g. overloaded_error). */
  errorType?: string | null
  requestId?: string | null
  retryAfterMs?: number | null
  attempts: number
  provider?: string | null
}

export interface AgentFailureDetails {
  provider?: string
  status?: number
  error_code?: string
  error_type?: string
  request_id?: string
  attempts?: number
  /** Our own (never the provider's) explanation, e.g. which setting is missing. */
  reason?: string
}

export interface AgentFailureView {
  code: AgentFailureCode
  /** Plain language, with the next step. */
  message: string
  /** A Retry button makes sense (the same request might work later). */
  retryable: boolean
  /** An admin fixes this in Settings → Agent (the panel links there for admins). */
  admin_fix?: boolean
  /** Seconds the provider asked us to wait (when it said). */
  retry_after_s?: number
  details: AgentFailureDetails
  /** The provider's own error message, sanitised — for admins only (the route strips it for others). */
  admin_message?: string
  /** Set for people who can fix it (forViewer): where. */
  settings_href?: string
}

/** Where the person / admin fixes the connection: the Agent's settings, or the workflow agent's own connection. */
export type FailureAudience = 'assistant' | 'agent'

export const AGENT_SETTINGS_HREF = '/settings/assistants'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', azure_openai: 'Azure OpenAI', gemini: 'Google Gemini', bedrock: 'Amazon Bedrock',
  mistral: 'Mistral', deepseek: 'DeepSeek', groq: 'Groq', together: 'Together AI', baseten: 'Baseten', perplexity: 'Perplexity',
  xai: 'xAI', ollama: 'Ollama', other: 'OpenAI-compatible server',
}

export function providerLabel(provider: string | null | undefined): string | undefined {
  if (!provider) return undefined
  return PROVIDER_LABELS[provider] ?? provider
}

/* ── Parsing the provider's error body ── */

interface ParsedBody { message: string; type: string; code: string }

/** The error message / type / code from the usual provider shapes (OpenAI, Anthropic, Gemini, Bedrock, plain text). */
export function parseProviderErrorBody(body: string | null | undefined): ParsedBody {
  const text = String(body ?? '').trim()
  const out: ParsedBody = { message: '', type: '', code: '' }
  if (!text) return out
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider JSON of unknown shape
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  if (Array.isArray(json)) json = json[0]
  if (json && typeof json === 'object') {
    const e = json.error ?? json
    if (typeof e === 'string') out.message = e
    else if (e && typeof e === 'object') {
      out.message = typeof e.message === 'string' ? e.message : typeof json.message === 'string' ? json.message : ''
      out.type = typeof e.type === 'string' ? e.type : typeof e.status === 'string' ? e.status : ''
      out.code = typeof e.code === 'string' ? e.code : typeof e.code === 'number' ? String(e.code) : ''
    }
    if (!out.type && typeof json.type === 'string' && json.type !== 'error') out.type = json.type
    if (!out.message && typeof json.detail === 'string') out.message = json.detail
    if (!out.message && typeof json.Message === 'string') out.message = json.Message
    if (!out.type && typeof json.__type === 'string') out.type = json.__type.split('#').pop() ?? ''
  } else {
    out.message = text
  }
  return out
}

/** A provider message made safe to show an admin: keys / tokens masked, whitespace folded, capped. */
export function sanitizeProviderMessage(message: string | null | undefined, max = 200): string {
  let m = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!m) return ''
  m = m
    .replace(/\b(sk|pk|rk|sess|key|xai|gsk|pplx|AIza)[-_A-Za-z0-9]{8,}/g, '[key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [key]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[…]')
  return m.length > max ? `${m.slice(0, max - 1)}…` : m
}

/** Request id from the response headers (OpenAI x-request-id, Anthropic request-id, Azure apim, Bedrock amzn). */
export function requestIdFrom(headers: { get(name: string): string | null } | null | undefined): string | null {
  if (!headers?.get) return null
  for (const name of ['x-request-id', 'request-id', 'x-amzn-requestid', 'apim-request-id', 'x-ms-request-id', 'cf-ray']) {
    const v = headers.get(name)
    if (v && /^[A-Za-z0-9._:-]{4,120}$/.test(v.trim())) return v.trim()
  }
  return null
}

/* ── Classification ── */

const QUOTA = /insufficient[_ ]?quota|billing|credit balance|out of credits?|insufficient (funds|balance|credits?)|payment required|exceeded your current quota|quota[_ ]exhausted|account.*(suspended|deactivated|inactive)/i
const CONTEXT = /context[_ ]length|context window|maximum context|prompt is too long|input is too long|too many (input )?tokens|reduce the length|string_above_max_length|request too large for model|exceeds? the (model's )?(maximum|max) (context|input)|input.*too long/i
const CONTENT = /content[_ ]?(policy|filter|management)|safety (system|filter|setting)|responsible ?ai|flagged|moderation|harm[_ ]category|blocked.*(safety|policy)|policy violation/i
const TOOLS = /tool/i
const TOOLS_UNSUPPORTED = /(not supported|unsupported|does not support|doesn't support|not enabled)/i
const MODEL_MISSING = /model[_ ]not[_ ]found|(model|deployment).{0,60}(not found|does not exist|doesn't exist|not available|unknown|no access|is not supported)|unknown model|invalid model/i
const OVERLOADED = /overloaded|server[_ ]error|internal[_ ]error|unavailable|api_error|service_unavailable/i
const RATE = /rate[_ ]?limit|too many requests|throttl|resource_exhausted|requests per|tokens per min/i
const AUTH = /authentication|invalid[_ ]?api[_ ]?key|incorrect api key|unauthori[sz]ed|permission[_ ]?(denied|error)|forbidden|invalid x-api-key|access denied/i

/** Is this failure out of credit (a retry can't help)? Used by the retry policy on 402 / 429. */
export function isQuotaFailure(status: number | null, body: string | null | undefined): boolean {
  if (status === 402) return true
  const p = parseProviderErrorBody(body)
  return QUOTA.test(`${p.code} ${p.type} ${p.message}`)
}

/** Is this a non-retryable 4xx dressed as something else (context too long, content policy)? */
export function isPermanentFailure(status: number | null, body: string | null | undefined): boolean {
  if (isQuotaFailure(status, body)) return true
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return true
  const p = parseProviderErrorBody(body)
  const text = `${p.code} ${p.type} ${p.message}`
  return CONTEXT.test(text) || CONTENT.test(text)
}

export function classifyFailure(f: Pick<ProviderFailure, 'kind' | 'status' | 'body' | 'message' | 'errorType'>): AgentFailureCode {
  if (f.kind === 'cancelled') return 'cancelled'
  const p = parseProviderErrorBody(f.body)
  const text = `${f.errorType ?? ''} ${p.code} ${p.type} ${p.message}`.trim()
  const full = `${text} ${f.body ? '' : f.message ?? ''}`
  const status = f.status
  if (status === 402 || QUOTA.test(text)) return 'quota'
  if (status === 413 || CONTEXT.test(full)) return 'context_too_long'
  if (CONTENT.test(full) && (status === null || status === 400 || status === 403 || status === 422)) return 'content_policy'
  if ((status === 400 || status === 422 || f.kind === 'bad_request') && TOOLS.test(full) && TOOLS_UNSUPPORTED.test(full)) return 'tools_unsupported'
  if (status === 401 || status === 403 || f.kind === 'auth' || (status === null && AUTH.test(full))) return 'auth'
  if (status === 404 || f.kind === 'not_found' || (status === 400 && MODEL_MISSING.test(text))) return 'model_not_found'
  if (status === 429 || f.kind === 'rate_limited' || (status === null && RATE.test(full))) return 'rate_limited'
  if (f.kind === 'quota') return 'quota'
  if ((status !== null && (status >= 500 || status === 409)) || f.kind === 'provider_unavailable' || (status === null && OVERLOADED.test(full))) return 'overloaded'
  if (f.kind === 'timeout' || status === 408) return 'timeout'
  if (f.kind === 'network') return 'network'
  if ((status !== null && status >= 400) || f.kind === 'bad_request') return 'bad_request'
  return 'unknown'
}

/* ── Messages ── */

function waitPhrase(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null
  const s = Math.ceil(ms / 1000)
  if (s < 90) return `about ${s} second${s === 1 ? '' : 's'}`
  const m = Math.ceil(s / 60)
  return m < 90 ? `about ${m} minute${m === 1 ? '' : 's'}` : 'a while'
}

/** The friendly message for a failure code. */
export function friendlyMessage(code: AgentFailureCode, opts: { attempts?: number; retryAfterMs?: number | null; audience?: FailureAudience } = {}): string {
  const attempts = opts.attempts ?? 1
  const agent = opts.audience === 'agent'
  const fixWhere = agent ? 'in the agent\'s AI connection (Integrations)' : 'in Settings → Agent'
  switch (code) {
    case 'rate_limited': {
      const wait = waitPhrase(opts.retryAfterMs)
      const tried = attempts > 1 ? ` I tried ${attempts} times.` : ''
      return `The AI provider is busy right now (too many requests for this key).${tried} Please try again ${wait ? `in ${wait}` : 'in a minute'} — or ask your admin to raise the provider's rate limit.`
    }
    case 'quota':
      return `The AI provider says this key is out of credit. Ask your admin to top it up or switch provider ${fixWhere}.`
    case 'auth':
      return `The AI provider rejected the API key. An admin needs to update it ${fixWhere}.`
    case 'model_not_found':
      return `The model isn't available on this provider. An admin can pick another model ${fixWhere}.`
    case 'overloaded':
      return attempts > 1
        ? 'The AI provider is having trouble. I retried a few times — please try again shortly.'
        : 'The AI provider is having trouble. Please try again shortly.'
    case 'timeout':
      return `The AI provider took too long to answer${attempts > 1 ? `, even after ${attempts} tries` : ''}. Please try again — a shorter request can help.`
    case 'network':
      return `I couldn't reach the AI provider${attempts > 1 ? ` (tried ${attempts} times)` : ''}. Check your connection and try again — if it keeps happening, an admin can check the provider's address ${fixWhere}.`
    case 'context_too_long':
      return agent
        ? 'The request is too long for the model — shorten the input or the conversation history, or use a model with a larger context window.'
        : 'This conversation is too long for the model — start a new chat or remove attachments.'
    case 'content_policy':
      return 'The AI provider declined this request under its content policy. Try rephrasing it.'
    case 'tools_unsupported':
      return `This model can't use the tools ${agent ? 'the agent' : 'the Agent'} needs. An admin can pick a model that supports tool calling ${fixWhere}.`
    case 'not_configured':
      return 'The Agent isn\'t set up yet. An admin can connect an AI provider in Settings → Agent.'
    case 'bad_request':
      return 'The AI provider couldn\'t process this request. Try again or rephrase it — if it keeps happening, an admin can check the details.'
    case 'limit':
      return 'You\'ve reached an Agent limit — try again later.'
    case 'cancelled':
      return 'Stopped.'
    default:
      return 'Something went wrong while the AI was working. Please try again.'
  }
}

const RETRYABLE: ReadonlySet<AgentFailureCode> = new Set(['rate_limited', 'overloaded', 'timeout', 'network', 'bad_request', 'unknown', 'content_policy', 'limit'])
const ADMIN_FIX: ReadonlySet<AgentFailureCode> = new Set(['quota', 'auth', 'model_not_found', 'tools_unsupported', 'not_configured'])

/** The person-facing view of a provider failure. */
export function describeFailure(f: ProviderFailure, opts: { audience?: FailureAudience } = {}): AgentFailureView {
  const code = classifyFailure(f)
  const p = parseProviderErrorBody(f.body)
  const details: AgentFailureDetails = {}
  const provider = providerLabel(f.provider)
  if (provider) details.provider = provider
  if (f.status) details.status = f.status
  const errorCode = sanitizeToken(p.code)
  const errorType = sanitizeToken(p.type || f.errorType || '')
  if (errorCode) details.error_code = errorCode
  if (errorType && errorType !== errorCode) details.error_type = errorType
  if (f.requestId) details.request_id = f.requestId
  if (f.attempts > 0) details.attempts = f.attempts
  const adminMessage = sanitizeProviderMessage(p.message || (f.body ? '' : stripPrefix(f.message)))
  return {
    code,
    message: friendlyMessage(code, { attempts: f.attempts, retryAfterMs: f.retryAfterMs, audience: opts.audience }),
    retryable: RETRYABLE.has(code),
    ...(ADMIN_FIX.has(code) ? { admin_fix: true } : {}),
    ...(f.retryAfterMs && f.retryAfterMs > 0 ? { retry_after_s: Math.ceil(f.retryAfterMs / 1000) } : {}),
    details,
    ...(adminMessage ? { admin_message: adminMessage } : {}),
  }
}

/** A failure that is not a provider call (the Agent isn't configured, a limit was reached, …). */
export function describeSimpleFailure(code: AgentFailureCode, message?: string | null, opts: { reason?: string | null; retryable?: boolean; retryAfterMs?: number | null } = {}): AgentFailureView {
  return {
    code,
    message: message?.trim() || friendlyMessage(code),
    retryable: opts.retryable ?? RETRYABLE.has(code),
    ...(ADMIN_FIX.has(code) ? { admin_fix: true } : {}),
    ...(opts.retryAfterMs && opts.retryAfterMs > 0 ? { retry_after_s: Math.ceil(opts.retryAfterMs / 1000) } : {}),
    details: opts.reason ? { reason: opts.reason.slice(0, 300) } : {},
  }
}

/**
 * The view for an Agent request refused before the model was called
 * (lib/assistants/chat AssistantRequestError codes): not configured, a burst
 * limit, the daily message limit, the monthly cost cap.
 */
export function describeRequestError(code: string, message: string, retryAfterMs?: number | null): AgentFailureView {
  if (code === 'config') return describeSimpleFailure('not_configured', null, { reason: message })
  if (code === 'rate_limited') return describeSimpleFailure('limit', message, { retryable: true, retryAfterMs })
  if (code === 'daily_messages' || code === 'monthly_cost') return describeSimpleFailure('limit', message, { retryable: false })
  return describeSimpleFailure('unknown', message, { retryable: true })
}

function sanitizeToken(v: string): string {
  const t = String(v ?? '').trim()
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(t) ? t : ''
}

function stripPrefix(message: string): string {
  return String(message ?? '').replace(/^Provider (error|\d{3})(: )?/, '').replace(/^Could not reach the provider: /, '')
}

/**
 * The view without what only admins may read: the provider's own message,
 * the Settings link and the retry count (retries are quiet for everyone
 * else — the friendly message itself is unchanged).
 */
export function forViewer(view: AgentFailureView, isAdmin: boolean, settingsHref: string | null = AGENT_SETTINGS_HREF): AgentFailureView {
  const { admin_message: adminMessage, settings_href: _href, ...rest } = view
  void _href
  if (!isAdmin) {
    const { attempts: _attempts, ...details } = rest.details ?? {}
    void _attempts
    return { ...rest, details }
  }
  return { ...rest, ...(adminMessage ? { admin_message: adminMessage } : {}), ...(view.admin_fix && settingsHref ? { settings_href: settingsHref } : {}) }
}

/**
 * Automatic retries a turn needed before it was answered — for the Details
 * of people who manage the Agent, after the turn (never shown live).
 */
export interface AgentRetrySummary {
  /** Retries made (attempts − 1, over every model call of the turn). */
  retries: number
  /** Why the last one was needed (an AgentFailureCode). */
  code: AgentFailureCode
  status?: number
  provider?: string
}

export function retrySummary(input: { retries?: number | null; lastRetry?: { code: AgentFailureCode; status: number | null } | null; provider?: string | null }): AgentRetrySummary | null {
  const retries = Math.max(0, Math.floor(Number(input.retries) || 0))
  if (!retries) return null
  const provider = providerLabel(input.provider)
  return {
    retries,
    code: input.lastRetry?.code ?? 'unknown',
    ...(input.lastRetry?.status ? { status: input.lastRetry.status } : {}),
    ...(provider ? { provider } : {}),
  }
}

const RETRY_REASONS: Partial<Record<AgentFailureCode, string>> = {
  rate_limited: 'rate limited', overloaded: 'provider overloaded or erroring', timeout: 'timed out', network: 'network error',
}

/** "Answered after 2 automatic retries (rate limited · HTTP 429 · Anthropic)". */
export function retrySummaryText(summary: AgentRetrySummary): string {
  const why = [RETRY_REASONS[summary.code] ?? summary.code, summary.status ? `HTTP ${summary.status}` : null, summary.provider].filter(Boolean).join(' · ')
  return `Answered after ${summary.retries} automatic ${summary.retries === 1 ? 'retry' : 'retries'}${why ? ` (${why})` : ''}`
}

/** One line for logs / run records: "anthropic · HTTP 429 · rate_limit_error · request req_1 · 4 attempts". */
export function technicalSummary(view: AgentFailureView): string {
  const d = view.details
  return [
    d.provider, d.status ? `HTTP ${d.status}` : null, d.error_code, d.error_type,
    d.request_id ? `request ${d.request_id}` : null, d.attempts && d.attempts > 1 ? `${d.attempts} attempts` : null,
  ].filter(Boolean).join(' · ') || view.code
}

/**
 * A stored / legacy error string ("Provider 429: {…} — the provider is
 * rate limiting this key", "Could not reach the provider: …") as a failure,
 * or null when it doesn't look like a provider error. Lets earlier messages
 * (persisted conversations, older run records) render friendly too.
 */
export function failureFromMessage(message: string | null | undefined, provider?: string | null): ProviderFailure | null {
  const text = String(message ?? '').trim()
  if (!text) return null
  const http = text.match(/^(?:The AI provider failed: |Agent error: |AI detection failed: )?Provider (\d{3})(?::\s*([\s\S]*?))?(?:\s+—\s+[^{}]*)?$/)
  if (http) {
    const status = Number(http[1])
    const kind: AgentErrorKind = status === 401 || status === 403 ? 'auth' : status === 404 ? 'not_found' : status === 408 ? 'timeout'
      : status === 429 ? 'rate_limited' : status >= 500 || status === 409 ? 'provider_unavailable' : 'bad_request'
    return { kind, status, message: text, body: http[2] ?? null, attempts: 1, provider: provider ?? null }
  }
  if (/^Could not reach the provider/i.test(text)) return { kind: 'network', status: null, message: text, attempts: 1, provider: provider ?? null }
  if (/did not answer in time|stream stalled/i.test(text)) return { kind: 'timeout', status: null, message: text, attempts: 1, provider: provider ?? null }
  const mid = text.match(/^Provider error mid-stream: ([\s\S]*)$/)
  if (mid) return { kind: 'provider_unavailable', status: null, message: text, errorType: null, body: null, attempts: 1, provider: provider ?? null }
  return null
}

/** What the provider is doing, for the retry status line. */
function retryWhat(kind: string): string {
  return kind === 'rate_limited' ? 'is busy'
    : kind === 'timeout' ? 'is slow to answer'
      : kind === 'network' ? 'couldn\'t be reached'
        : 'is having trouble'
}

/**
 * The status line while waiting to retry: "The AI provider is busy —
 * retrying in 6 s (attempt 2 of 4)…" (`kind`: an AgentErrorKind or an
 * AgentFailureCode). With 0 seconds left: "… — trying again (attempt 2 of 4)…".
 */
export function retryCountdownText(kind: string, secondsLeft: number, attempt: number, maxAttempts: number): string {
  const s = Math.max(0, Math.ceil(secondsLeft))
  return s > 0
    ? `The AI provider ${retryWhat(kind)} — retrying in ${s} s (attempt ${attempt} of ${maxAttempts})…`
    : `The AI provider ${retryWhat(kind)} — trying again (attempt ${attempt} of ${maxAttempts})…`
}

export function retryStatusMessage(info: { kind: AgentErrorKind | string; nextAttempt: number; maxAttempts: number; delayMs: number }): string {
  return retryCountdownText(info.kind, Math.max(1, Math.round(info.delayMs / 1000)), info.nextAttempt, info.maxAttempts)
}
