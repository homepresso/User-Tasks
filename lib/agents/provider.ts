/**
 * AI provider adaptation for agents (client-safe: no server-only imports).
 *
 * Every agent provider is reached through its OpenAI-compatible Chat
 * Completions API. The connector presets (lib/connectors/definitions) store
 * the provider's bare host as `base_url`, because their API reference
 * templates carry the full path (`/v1/chat/completions`, ...). The agent
 * executor used to append `/chat/completions` to that bare host, which 404s
 * on almost every provider. This module resolves the real chat endpoint, the
 * auth header and the request-body differences per provider:
 *
 *   provider      chat endpoint                                         auth
 *   openai        https://api.openai.com/v1/chat/completions             Bearer
 *   anthropic     https://api.anthropic.com/v1/chat/completions          Bearer (OpenAI SDK compatibility)
 *   azure_openai  https://{resource}.openai.azure.com/openai/v1/chat/completions   api-key header
 *   gemini        https://generativelanguage.googleapis.com/v1beta/openai/chat/completions   Bearer
 *   bedrock       https://bedrock-runtime.{region}.amazonaws.com/openai/v1/chat/completions  Bearer (Bedrock API key)
 *   mistral       https://api.mistral.ai/v1/chat/completions             Bearer
 *   deepseek      https://api.deepseek.com/chat/completions              Bearer
 *   groq          https://api.groq.com/openai/v1/chat/completions        Bearer
 *   together      https://api.together.xyz/v1/chat/completions           Bearer
 *   perplexity    https://api.perplexity.ai/chat/completions             Bearer
 *   ollama        {base}/v1/chat/completions                             none (or Bearer when a key is set)
 *   other         {base_url}/chat/completions (unchanged behaviour)      Bearer when a key is set
 *
 * A base_url that already carries a path (e.g. `https://api.openai.com/v1`,
 * a proxy, vLLM's `/v1`) is used as is; one that already ends in
 * `/chat/completions` is used verbatim.
 */

export type AgentProviderKind =
  | 'openai' | 'anthropic' | 'azure_openai' | 'gemini' | 'bedrock' | 'mistral'
  | 'deepseek' | 'groq' | 'together' | 'perplexity' | 'ollama' | 'other'

/** Integration types (connector keys) that are AI providers usable by agents. */
export const AI_PROVIDER_TYPES: Record<string, AgentProviderKind> = {
  openai: 'openai',
  claude: 'anthropic',
  anthropic: 'anthropic',
  azure_openai: 'azure_openai',
  google_gemini: 'gemini',
  gemini: 'gemini',
  aws_bedrock: 'bedrock',
  bedrock: 'bedrock',
  mistral: 'mistral',
  deepseek: 'deepseek',
  groq: 'groq',
  together: 'together',
  perplexity: 'perplexity',
  ollama: 'ollama',
  openai_compatible: 'other',
}

/** Path appended to a bare-host base_url, per provider. */
const DEFAULT_PATH: Record<AgentProviderKind, string> = {
  openai: '/v1',
  anthropic: '/v1',
  azure_openai: '/openai/v1',
  gemini: '/v1beta/openai',
  bedrock: '/openai/v1',
  mistral: '/v1',
  deepseek: '',
  groq: '/openai/v1',
  together: '/v1',
  perplexity: '',
  ollama: '/v1',
  other: '',
}

/** A sensible model when an agent has none (never gpt-4o on a Claude key). */
export const DEFAULT_MODEL: Partial<Record<AgentProviderKind, string>> = {
  openai: 'gpt-4.1',
  anthropic: 'claude-opus-5-5',
  gemini: 'gemini-2.5-flash',
  mistral: 'mistral-large-latest',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  perplexity: 'sonar-pro',
  ollama: 'llama3.1',
}

/** Which provider an integration is: by its type, else by its base URL host. */
export function agentProviderKind(integrationType: string | null | undefined, baseUrl: string | null | undefined): AgentProviderKind {
  const byType = AI_PROVIDER_TYPES[String(integrationType ?? '').toLowerCase()]
  if (byType && byType !== 'other') return byType
  let host = ''
  try { host = new URL(String(baseUrl ?? '')).hostname.toLowerCase() } catch { return byType ?? 'other' }
  if (host === 'api.openai.com') return 'openai'
  if (host === 'api.anthropic.com') return 'anthropic'
  if (host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com') || host.endsWith('.services.ai.azure.com')) return 'azure_openai'
  if (host === 'generativelanguage.googleapis.com') return 'gemini'
  if (/^bedrock-(runtime|mantle)\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) return 'bedrock'
  if (host === 'api.mistral.ai') return 'mistral'
  if (host === 'api.deepseek.com') return 'deepseek'
  if (host === 'api.groq.com') return 'groq'
  if (host === 'api.together.xyz') return 'together'
  if (host === 'api.perplexity.ai') return 'perplexity'
  return byType ?? 'other'
}

/** Is this integration an AI provider an agent can use? */
export function isAiProviderIntegration(i: { type?: string | null; config?: any }): boolean {
  if (AI_PROVIDER_TYPES[String(i.type ?? '').toLowerCase()]) return true
  return agentProviderKind(null, i.config?.base_url) !== 'other'
}

/** The Chat Completions URL for a provider and base URL. */
export function resolveChatUrl(kind: AgentProviderKind, baseUrl: string): string {
  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed
  let path = ''
  try { path = new URL(trimmed).pathname.replace(/\/+$/, '') } catch { /* relative / invalid: leave as is */ }
  const prefix = path === '' ? DEFAULT_PATH[kind] : ''
  return `${trimmed}${prefix}/chat/completions`
}

export interface AgentEndpoint {
  kind: AgentProviderKind
  url: string
  headers: Record<string, string>
}

const RESERVED_HEADERS = new Set(['authorization', 'api-key', 'x-api-key', 'content-type', 'content-length', 'host'])

/**
 * Endpoint + headers for an integration's decrypted config. `apiKey` may be
 * empty for providers without auth (Ollama, a local vLLM); no Authorization
 * header is sent then.
 */
export function resolveAgentEndpoint(integration: { type?: string | null; config: any }): AgentEndpoint & { apiKey: string } {
  const config = integration.config ?? {}
  const baseUrl = String(config.base_url ?? '').trim() || 'https://api.openai.com/v1'
  const kind = agentProviderKind(integration.type, baseUrl)
  const apiKey = String(config.auth_config?.key_value ?? config.auth_config?.token ?? '').trim()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Static headers from the connector (OpenAI-Organization, anthropic-version, ...).
  const extra = config.headers && typeof config.headers === 'object' ? config.headers : {}
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value !== 'string' || !value || RESERVED_HEADERS.has(name.toLowerCase())) continue
    headers[name] = value
  }
  if (apiKey) {
    if (kind === 'azure_openai') headers['api-key'] = apiKey
    else headers.Authorization = `Bearer ${apiKey}`
  }
  return { kind, url: resolveChatUrl(kind, baseUrl), headers, apiKey }
}

/** True when the integration needs no key to be usable (local model servers). */
export function providerAllowsNoKey(integration: { type?: string | null; config: any }): boolean {
  const config = integration.config ?? {}
  if (config.auth_type === 'none') return true
  return agentProviderKind(integration.type, config.base_url) === 'ollama'
}

/** OpenAI / Azure reasoning models (o-series, gpt-5*): different token + sampling params. */
export function isOpenAiReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(String(model ?? '').trim())
}

/**
 * Claude models whose API rejects sampling parameters (temperature/top_p):
 * Opus 4.7+, Opus 5.x, Sonnet 5.x, Haiku 5.x, Fable, Mythos. Older Claude
 * models (4.6 and earlier, Haiku 4.5) still accept temperature.
 */
export function claudeRejectsTemperature(model: string): boolean {
  const id = String(model ?? '').toLowerCase().replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.|global\.anthropic\.)/, '')
  if (/claude-(fable|mythos)/.test(id)) return true
  if (/claude-(opus|sonnet|haiku)-[5-9]/.test(id)) return true
  const m = id.match(/claude-opus-4-(\d+)/)
  return Boolean(m && Number(m[1]) >= 7)
}

/**
 * Provider-specific body fields: the token limit's name and whether
 * temperature may be sent. `temperature === null` means "provider default".
 */
export function chatBodyParams(kind: AgentProviderKind, model: string, opts: { maxTokens: number; temperature: number | null }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const reasoning = (kind === 'openai' || kind === 'azure_openai') && isOpenAiReasoningModel(model)
  if (kind === 'openai' || kind === 'azure_openai' || kind === 'anthropic') out.max_completion_tokens = opts.maxTokens
  else out.max_tokens = opts.maxTokens
  const claudeNoSampling = (kind === 'anthropic' || kind === 'bedrock') && claudeRejectsTemperature(model)
  if (opts.temperature !== null && !reasoning && !claudeNoSampling) {
    // Anthropic's range is 0..1; others 0..2.
    out.temperature = kind === 'anthropic' ? Math.min(1, opts.temperature) : opts.temperature
  }
  return out
}

/** Which file parts a provider takes in a user message (lib/agent-files.ts). */
export function providerFileSupport(kind: AgentProviderKind): { images: boolean; pdf: boolean } {
  switch (kind) {
    case 'openai': return { images: true, pdf: true }
    case 'azure_openai': case 'anthropic': case 'gemini': case 'bedrock': case 'mistral': case 'ollama':
      return { images: true, pdf: false }
    default: return { images: false, pdf: false }
  }
}

/* ── Errors / retries ── */

export type AgentErrorKind = 'rate_limited' | 'provider_unavailable' | 'timeout' | 'auth' | 'bad_request' | 'not_found' | 'network' | 'unknown'

export function classifyHttpStatus(status: number): AgentErrorKind {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 408) return 'timeout'
  if (status === 429) return 'rate_limited'
  if (status >= 500 || status === 409 || status === 529) return 'provider_unavailable'
  if (status >= 400) return 'bad_request'
  return 'unknown'
}

export function isRetryableKind(kind: AgentErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'provider_unavailable' || kind === 'timeout' || kind === 'network'
}

/** Backoff before retry `attempt` (1-based): Retry-After when given, else exponential with jitter. */
export function retryDelayMs(attempt: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  if (retryAfterMs !== null && retryAfterMs >= 0) return Math.min(retryAfterMs, 30_000)
  const base = Math.min(8_000, 500 * 2 ** (attempt - 1))
  return Math.round(base / 2 + random() * (base / 2))
}

export function parseRetryAfterHeader(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null
  const text = value.trim()
  if (/^\d+(\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text) * 1000))
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** Readable message for a provider error, with a hint for the common misconfigurations. */
export function providerErrorMessage(kind: AgentErrorKind, status: number | null, body: string, url: string): string {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 300)
  const where = (() => { try { const u = new URL(url); return `${u.host}${u.pathname}` } catch { return url } })()
  const hint = kind === 'auth' ? ' — check the integration\'s API key'
    : kind === 'not_found' ? ` — check the model id and the integration's base URL (${where})`
    : kind === 'rate_limited' ? ' — the provider is rate limiting this key'
    : ''
  return `Provider ${status ?? 'error'}${detail ? `: ${detail}` : ''}${hint}`
}
