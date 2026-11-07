import { describe, expect, it } from 'vitest'
import {
  agentProviderKind, chatBodyParams, claudeRejectsTemperature, classifyHttpStatus, isAiProviderIntegration, isRetryableKind,
  parseRetryAfterHeader, providerAllowsNoKey, resolveAgentEndpoint, resolveChatUrl, retryDelayMs,
} from '@/lib/agents/provider'

/**
 * Provider adaptation (lib/agents/provider.ts): the connector presets store a
 * bare host as base_url; every provider must get its real Chat Completions
 * URL, auth header and body fields.
 */
describe('resolveAgentEndpoint — the URL / auth each preset produces', () => {
  const cases: Array<[string, Record<string, any>, string, Record<string, string>]> = [
    ['openai', { base_url: 'https://api.openai.com', auth_type: 'bearer', auth_config: { token: 'sk' }, headers: { 'OpenAI-Organization': 'org-1' } },
      'https://api.openai.com/v1/chat/completions', { Authorization: 'Bearer sk', 'OpenAI-Organization': 'org-1' }],
    ['claude', { base_url: 'https://api.anthropic.com', auth_type: 'api_key', auth_config: { key_name: 'x-api-key', key_value: 'ak', add_to: 'header' }, headers: { 'anthropic-version': '2023-06-01' } },
      'https://api.anthropic.com/v1/chat/completions', { Authorization: 'Bearer ak', 'anthropic-version': '2023-06-01' }],
    ['azure_openai', { base_url: 'https://acme.openai.azure.com', auth_type: 'api_key', auth_config: { key_name: 'api-key', key_value: 'az', add_to: 'header' } },
      'https://acme.openai.azure.com/openai/v1/chat/completions', { 'api-key': 'az' }],
    ['google_gemini', { base_url: 'https://generativelanguage.googleapis.com', auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'gk', add_to: 'query' } },
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { Authorization: 'Bearer gk' }],
    ['mistral', { base_url: 'https://api.mistral.ai', auth_config: { token: 'm' } }, 'https://api.mistral.ai/v1/chat/completions', { Authorization: 'Bearer m' }],
    ['deepseek', { base_url: 'https://api.deepseek.com', auth_config: { token: 'd' } }, 'https://api.deepseek.com/chat/completions', { Authorization: 'Bearer d' }],
    ['groq', { base_url: 'https://api.groq.com', auth_config: { token: 'g' } }, 'https://api.groq.com/openai/v1/chat/completions', { Authorization: 'Bearer g' }],
    ['together', { base_url: 'https://api.together.xyz', auth_config: { token: 't' } }, 'https://api.together.xyz/v1/chat/completions', { Authorization: 'Bearer t' }],
    ['perplexity', { base_url: 'https://api.perplexity.ai', auth_config: { token: 'p' } }, 'https://api.perplexity.ai/chat/completions', { Authorization: 'Bearer p' }],
    ['ollama', { base_url: 'http://localhost:11434', auth_type: 'none', auth_config: {} }, 'http://localhost:11434/v1/chat/completions', {}],
    ['rest_api', { base_url: 'https://bedrock-runtime.us-east-1.amazonaws.com', auth_config: { token: 'br' } }, 'https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions', { Authorization: 'Bearer br' }],
  ]
  for (const [type, config, url, headers] of cases) {
    it(type, () => {
      const endpoint = resolveAgentEndpoint({ type, config })
      expect(endpoint.url).toBe(url)
      expect(endpoint.headers).toEqual({ 'Content-Type': 'application/json', ...headers })
    })
  }

  it('keeps a base URL that already has a path (proxies, vLLM /v1) and one that ends in /chat/completions', () => {
    expect(resolveChatUrl('other', 'http://vllm:8000/v1/')).toBe('http://vllm:8000/v1/chat/completions')
    expect(resolveChatUrl('openai', 'https://api.openai.com/v1')).toBe('https://api.openai.com/v1/chat/completions')
    expect(resolveChatUrl('other', 'https://proxy.test/x/chat/completions')).toBe('https://proxy.test/x/chat/completions')
    expect(resolveChatUrl('other', 'https://llm.test')).toBe('https://llm.test/chat/completions')
  })

  it('never lets connector headers override the auth header', () => {
    const endpoint = resolveAgentEndpoint({ type: 'openai', config: { base_url: 'https://api.openai.com', auth_config: { token: 'real' }, headers: { Authorization: 'Bearer forged', Host: 'evil' } } })
    expect(endpoint.headers.Authorization).toBe('Bearer real')
    expect(endpoint.headers.Host).toBeUndefined()
  })

  it('classifies providers by type and host; local servers need no key', () => {
    expect(agentProviderKind('rest_api', 'https://x.cognitiveservices.azure.com')).toBe('azure_openai')
    expect(agentProviderKind('claude', '')).toBe('anthropic')
    expect(isAiProviderIntegration({ type: 'rest_api', config: { base_url: 'https://api.openai.com' } })).toBe(true)
    expect(isAiProviderIntegration({ type: 'rest_api', config: { base_url: 'https://example.com' } })).toBe(false)
    expect(isAiProviderIntegration({ type: 'openai_compatible', config: { base_url: 'http://vllm:8000/v1' } })).toBe(true)
    expect(providerAllowsNoKey({ type: 'ollama', config: { base_url: 'http://localhost:11434' } })).toBe(true)
    expect(providerAllowsNoKey({ type: 'openai', config: { base_url: 'https://api.openai.com', auth_type: 'bearer' } })).toBe(false)
  })
})

describe('chatBodyParams', () => {
  it('OpenAI reasoning models: max_completion_tokens and no temperature', () => {
    expect(chatBodyParams('openai', 'o3-mini', { maxTokens: 100, temperature: 0.2 })).toEqual({ max_completion_tokens: 100 })
    expect(chatBodyParams('azure_openai', 'gpt-5-mini', { maxTokens: 100, temperature: 0.2 })).toEqual({ max_completion_tokens: 100 })
    expect(chatBodyParams('openai', 'gpt-4.1', { maxTokens: 100, temperature: 0 })).toEqual({ max_completion_tokens: 100, temperature: 0 })
  })
  it('Claude: no sampling params on current models, 0..1 on older ones', () => {
    expect(claudeRejectsTemperature('claude-opus-5-5')).toBe(true)
    expect(claudeRejectsTemperature('claude-opus-4-7')).toBe(true)
    expect(claudeRejectsTemperature('claude-fable-5-1')).toBe(true)
    expect(claudeRejectsTemperature('claude-sonnet-4-6')).toBe(false)
    expect(chatBodyParams('anthropic', 'claude-opus-5-5', { maxTokens: 100, temperature: 0.7 })).toEqual({ max_completion_tokens: 100 })
    expect(chatBodyParams('anthropic', 'claude-sonnet-4-6', { maxTokens: 100, temperature: 1.6 })).toEqual({ max_completion_tokens: 100, temperature: 1 })
  })
  it('others keep max_tokens; a null temperature is omitted (provider default)', () => {
    expect(chatBodyParams('mistral', 'mistral-large-latest', { maxTokens: 50, temperature: 0 })).toEqual({ max_tokens: 50, temperature: 0 })
    expect(chatBodyParams('ollama', 'llama3.1', { maxTokens: 50, temperature: null })).toEqual({ max_tokens: 50 })
  })
})

describe('errors and retries', () => {
  it('classifies statuses', () => {
    expect(classifyHttpStatus(429)).toBe('rate_limited')
    expect(classifyHttpStatus(503)).toBe('provider_unavailable')
    expect(classifyHttpStatus(529)).toBe('provider_unavailable')
    expect(classifyHttpStatus(401)).toBe('auth')
    expect(classifyHttpStatus(400)).toBe('bad_request')
    expect(isRetryableKind('rate_limited')).toBe(true)
    expect(isRetryableKind('bad_request')).toBe(false)
  })
  it('honours Retry-After (seconds or date), else backs off exponentially', () => {
    expect(parseRetryAfterHeader('2')).toBe(2000)
    expect(parseRetryAfterHeader(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000)
    expect(parseRetryAfterHeader('nonsense')).toBeNull()
    expect(retryDelayMs(1, 1500)).toBe(1500)
    expect(retryDelayMs(1, null, () => 0)).toBe(250)
    expect(retryDelayMs(3, null, () => 1)).toBe(2000)
    expect(retryDelayMs(1, 999_999)).toBe(30_000)
  })
})
