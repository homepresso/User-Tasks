/**
 * The Agent's thinking level (client-safe, pure): one setting — Default,
 * Low, Medium, High, Max — mapped per provider and model to the parameter
 * that provider documents, and only for models known to take it (a
 * capability map). Anything else sends nothing.
 *
 *   provider            parameter                         models                                   Max
 *   anthropic (native)  output_config.effort low…max      Claude 5.x / Fable / Mythos, Opus 4.6–4.8,  max
 *                                                          Sonnet 4.6 (Opus 4.5: low…high)
 *   openai / azure      reasoning_effort low|medium|high  gpt-5*, o-series (not *-chat)             xhigh (gpt-5.5)
 *   xai                 reasoning_effort low|medium|high  grok-4.5, 4.6, 4.7                       xhigh (4.6+)
 *   gemini              reasoning_effort low|medium|high  gemini-2.5 / 3.x / 4 (thinking budget /   —
 *                       (OpenAI compatibility)            thinking level)
 *
 * Sources: the claude-api skill (Anthropic effort levels per model; the
 * OpenAI-compatible endpoint ignores reasoning_effort, so Claude gets it only
 * over the native Messages API), developers.openai.com reasoning guide and
 * model pages, docs.x.ai reasoning guide, aistudio.google.com OpenAI
 * compatibility guide. A provider that still rejects the parameter (HTTP
 * 400) gets the request again without it, and that model is remembered for
 * the life of the server process (rememberThinkingRejected).
 */
import type { AgentProviderKind } from './provider'

export const THINKING_LEVELS = ['default', 'low', 'medium', 'high', 'max'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  default: 'Default (provider\'s default)', low: 'Low', medium: 'Medium', high: 'High', max: 'Max',
}

export const THINKING_UNSUPPORTED_HINT = 'This model doesn\'t support a thinking level'

/** A stored value as a level (absent / unknown → default). */
export function normalizeThinkingLevel(v: unknown): ThinkingLevel {
  return (THINKING_LEVELS as readonly string[]).includes(v as string) ? v as ThinkingLevel : 'default'
}

export interface ThinkingSupport {
  /** The levels (besides Default) this model takes; empty = unsupported. */
  levels: ThinkingLevel[]
  /** For Claude: only over Anthropic's own API (api.anthropic.com), not a gateway / the compatibility endpoint. */
  nativeOnly?: boolean
}

const id = (model: string) => String(model ?? '').trim().toLowerCase()
  .replace(/^models\//, '')
  .replace(/^(?:global\.|us\.|eu\.|au\.|jp\.|apac\.)?anthropic\./, '')
const ALL: ThinkingLevel[] = ['low', 'medium', 'high', 'max']
const NO_MAX: ThinkingLevel[] = ['low', 'medium', 'high']

/** Which levels a provider + model takes. */
export function thinkingSupport(provider: AgentProviderKind | string, model: string): ThinkingSupport {
  const m = id(model)
  if (!m) return { levels: [] }
  switch (provider) {
    case 'anthropic': {
      if (/claude-(fable|mythos)-\d/.test(m) || /claude-(opus|sonnet|haiku)-([5-9])(\b|-|$)/.test(m)) return { levels: ALL, nativeOnly: true }
      if (/claude-opus-4-[6-9]/.test(m) || /claude-sonnet-4-6/.test(m)) return { levels: ALL, nativeOnly: true }
      if (/claude-opus-4-5/.test(m)) return { levels: NO_MAX, nativeOnly: true }
      return { levels: [] }
    }
    case 'openai':
    case 'azure_openai': {
      if (/chat/.test(m) || !/^(o\d|gpt-5)/.test(m)) return { levels: [] }
      return { levels: /^gpt-5\.5(\b|-|$)/.test(m) ? ALL : NO_MAX }
    }
    case 'xai': {
      if (/^grok-4\.[67](\b|-|$)/.test(m)) return { levels: ALL }
      if (/^grok-4\.5(\b|-|$)/.test(m)) return { levels: NO_MAX }
      return { levels: [] }
    }
    case 'gemini':
      return /^gemini-(2\.5|3|4)/.test(m) ? { levels: NO_MAX } : { levels: [] }
    default:
      return { levels: [] }
  }
}

/**
 * The request-body fields for a level: {} for Default, an unsupported model
 * or level, or Claude when the request does not go to the native Messages
 * API (`native: false`).
 */
export function thinkingParams(provider: AgentProviderKind | string, model: string, level: ThinkingLevel | null | undefined, opts: { native?: boolean } = {}): Record<string, unknown> {
  const lvl = normalizeThinkingLevel(level)
  if (lvl === 'default') return {}
  const support = thinkingSupport(provider, model)
  if (!support.levels.includes(lvl)) return {}
  if (provider === 'anthropic') return opts.native ? { output_config: { effort: lvl } } : {}
  return { reasoning_effort: lvl === 'max' ? 'xhigh' : lvl }
}

/** Remove the thinking fields from a body (a retry without them / the compatibility fallback). */
export function withoutThinking<T extends Record<string, unknown>>(body: T): T {
  const { reasoning_effort: _r, output_config: _o, ...rest } = body as Record<string, unknown>
  return rest as T
}

/** Models whose provider rejected the thinking parameter (per server process). */
const rejected = new Set<string>()
const key = (provider: string, model: string) => `${provider}:${id(model)}`
export function thinkingRejected(provider: string, model: string): boolean { return rejected.has(key(provider, model)) }
export function rememberThinkingRejected(provider: string, model: string): void { rejected.add(key(provider, model)) }
/** Test seam. */
export function resetThinkingRejections(): void { rejected.clear() }

export type ThinkingGroup = 'designer' | 'form' | 'task'

/**
 * The level for a request: the Agent profile's own level (`rule`) → the help group's
 * override (Advanced) → the default card's → the provider's default.
 */
export function resolveThinkingLevel(opts: { rule?: ThinkingLevel | null; group?: ThinkingLevel | null; base?: ThinkingLevel | null }): ThinkingLevel {
  for (const v of [opts.rule, opts.group, opts.base]) {
    const lvl = normalizeThinkingLevel(v)
    if (lvl !== 'default') return lvl
  }
  return 'default'
}
