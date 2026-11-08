/**
 * Anthropic's native Messages API for the Agent (client-safe, pure).
 *
 * Anthropic's OpenAI compatibility endpoint (/v1/chat/completions) does not
 * support prompt caching and reports no cached tokens
 * (platform.claude.com/docs/en/api/openai-sdk: "Prompt caching is not
 * supported"; usage.prompt_tokens_details "Always empty"). Every Agent call
 * resends the system prompt, the tool list and the growing conversation, so
 * on Claude that is billed in full on every call. The native Messages API
 * caches the prefix: cache reads cost 0.05×–0.1× the input price.
 *
 * This module converts the OpenAI-style request the turn engine builds into
 * a Messages request (and a non-streamed Messages response back); streamed
 * Messages events are already understood by lib/agents/stream.ts
 * ChatStreamAssembler. Prompt caching:
 *   - render order is tools → system → messages, so ONE breakpoint on the
 *     system block caches the tool list and the system prompt together;
 *   - a second breakpoint on the last block of the conversation caches the
 *     history so far; the next call (same turn, a tool result appended) reads
 *     it back and writes only what was added.
 * Thinking blocks are not replayed (the browser keeps none; the
 * compatibility endpoint never returned them either).
 *
 * Used only for provider `anthropic` on api.anthropic.com (gateways and
 * proxies may speak only the compatibility dialect); the engine falls back to
 * the compatibility endpoint for the rest of the turn when a native request
 * is rejected (400 / 404), and AGENT_ANTHROPIC_NATIVE=off turns it off.
 */
import { anthropicUsage } from './stream'
import type { AgentProviderKind } from './provider'

/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON */

export const ANTHROPIC_VERSION = '2023-06-01'

/** Use the native Messages API for this connection? */
export function useAnthropicNative(provider: AgentProviderKind, url: string, env: Record<string, string | undefined> = process.env): boolean {
  if (provider !== 'anthropic') return false
  if (String(env.AGENT_ANTHROPIC_NATIVE ?? '').toLowerCase() === 'off') return false
  try {
    const u = new URL(url)
    return u.hostname === 'api.anthropic.com' && /\/chat\/completions$/.test(u.pathname)
  } catch {
    return false
  }
}

/** The Messages endpoint for a compatibility URL (…/v1/chat/completions → …/v1/messages). */
export function messagesUrl(chatUrl: string): string {
  return chatUrl.replace(/\/chat\/completions$/, '/messages')
}

/** Headers for the Messages API: the key as x-api-key (from the Bearer header), anthropic-version unless the connection sets one. */
export function messagesHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  let key = ''
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (lower === 'authorization') { key = String(value).replace(/^Bearer\s+/i, ''); continue }
    if (lower === 'x-api-key') { key = String(value); continue }
    out[name] = value
  }
  if (key) out['x-api-key'] = key
  if (!Object.keys(out).some((k) => k.toLowerCase() === 'anthropic-version')) out['anthropic-version'] = ANTHROPIC_VERSION
  if (!Object.keys(out).some((k) => k.toLowerCase() === 'content-type')) out['Content-Type'] = 'application/json'
  return out
}

const EPHEMERAL = { type: 'ephemeral' } as const

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' ? String(p.text ?? '') : '')).join('')
  return ''
}

/** An OpenAI image_url part as a Messages image block (data URLs as base64, others by URL). */
function imageBlock(url: string): Record<string, unknown> | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url)
  if (m) return { type: 'image', source: { type: 'base64', media_type: m[1].toLowerCase(), data: m[2] } }
  if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } }
  return null
}

function userBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content.trim() ? [{ type: 'text', text: content }] : []
  const out: Array<Record<string, unknown>> = []
  for (const part of Array.isArray(content) ? content : []) {
    if (part?.type === 'text' && String(part.text ?? '').trim()) out.push({ type: 'text', text: String(part.text) })
    else if (part?.type === 'image_url') {
      const block = imageBlock(String(part.image_url?.url ?? ''))
      if (block) out.push(block)
    }
  }
  return out
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>
  try {
    const v = JSON.parse(String(args ?? '{}'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

/**
 * An OpenAI-style chat body (model, messages with system / user / assistant
 * tool_calls / tool, tools, max_completion_tokens | max_tokens, temperature)
 * as a Messages body, with cache breakpoints on the system prompt and the
 * conversation's last block.
 */
export function toMessagesBody(body: Record<string, any>): Record<string, unknown> {
  const system: string[] = []
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = []
  const append = (role: 'user' | 'assistant', blocks: Array<Record<string, unknown>>) => {
    if (!blocks.length) return
    const last = messages[messages.length - 1]
    // Consecutive same-role messages become one (tool results all in one user message, before any text).
    if (last && last.role === role) {
      if (role === 'user' && blocks.some((b) => b.type === 'tool_result')) {
        const results = [...last.content.filter((b) => b.type === 'tool_result'), ...blocks.filter((b) => b.type === 'tool_result')]
        last.content = [...results, ...last.content.filter((b) => b.type !== 'tool_result'), ...blocks.filter((b) => b.type !== 'tool_result')]
      } else last.content.push(...blocks)
    } else messages.push({ role, content: blocks })
  }
  for (const m of Array.isArray(body.messages) ? body.messages : []) {
    if (m?.role === 'system' || m?.role === 'developer') { const t = textOf(m.content); if (t) system.push(t); continue }
    if (m?.role === 'user') { append('user', userBlocks(m.content)); continue }
    if (m?.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = []
      const t = textOf(m.content)
      if (t.trim()) blocks.push({ type: 'text', text: t })
      for (const c of Array.isArray(m.tool_calls) ? m.tool_calls : []) {
        if (c?.id && c?.function?.name) blocks.push({ type: 'tool_use', id: String(c.id), name: String(c.function.name), input: parseArgs(c.function.arguments) })
      }
      append('assistant', blocks)
      continue
    }
    if (m?.role === 'tool' && m.tool_call_id) {
      append('user', [{ type: 'tool_result', tool_use_id: String(m.tool_call_id), content: textOf(m.content) || '(empty)' }])
    }
  }
  // The conversation must start with a user turn.
  while (messages.length && messages[0].role !== 'user') messages.shift()
  // Cache breakpoint on the conversation's last block (the next call reads everything up to here).
  const last = messages[messages.length - 1]
  if (last?.content.length) {
    const i = last.content.length - 1
    last.content[i] = { ...last.content[i], cache_control: EPHEMERAL }
  }
  const out: Record<string, unknown> = {
    model: body.model,
    max_tokens: Number(body.max_completion_tokens ?? body.max_tokens) || 4096,
    messages,
  }
  if (system.length) out.system = [{ type: 'text', text: system.join('\n\n'), cache_control: EPHEMERAL }]
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter((t: any) => t?.function?.name)
      .map((t: any) => ({ name: t.function.name, description: String(t.function.description ?? ''), input_schema: t.function.parameters ?? { type: 'object', properties: {} } }))
    // No system prompt: cache the tool list on its own.
    if (!system.length && (out.tools as any[]).length) {
      const tools = out.tools as any[]
      tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: EPHEMERAL }
    }
  }
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  // The thinking level (lib/agents/reasoning.ts): output_config.effort.
  if (body.output_config && typeof body.output_config === 'object') out.output_config = body.output_config
  if (Array.isArray(body.stop) && body.stop.length) out.stop_sequences = body.stop
  return out
}

const FINISH: Record<string, string> = { tool_use: 'tool_calls', max_tokens: 'length', end_turn: 'stop', stop_sequence: 'stop', pause_turn: 'stop' }

/** A non-streamed Messages response in the OpenAI chat-completion shape the loop reads. */
export function fromMessagesResponse(json: any): any {
  if (!json || typeof json !== 'object' || json.type === 'error' || json.error) return json
  if (!Array.isArray(json.content)) return json
  let text = ''
  const toolCalls: any[] = []
  for (const block of json.content) {
    if (block?.type === 'text' && typeof block.text === 'string') text += block.text
    else if (block?.type === 'tool_use' && block.name) toolCalls.push({ id: String(block.id ?? `call_${toolCalls.length}`), type: 'function', function: { name: String(block.name), arguments: JSON.stringify(block.input ?? {}) } })
  }
  const stop = String(json.stop_reason ?? '')
  return {
    choices: [{ message: { role: 'assistant', content: text || (toolCalls.length ? null : ''), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: FINISH[stop] ?? (stop || (toolCalls.length ? 'tool_calls' : 'stop')) }],
    ...(json.usage ? { usage: anthropicUsage(json.usage) } : {}),
    ...(typeof json.model === 'string' ? { model: json.model } : {}),
  }
}
