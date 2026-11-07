/**
 * Optional AI detection for Redact Document: asks one of the workspace's
 * agents (its OpenAI-compatible model connection) for the names of people
 * and street addresses in the text. Probabilistic, off by default; the
 * values it returns are only used if they occur literally in the text, and
 * they are never logged. The text is sent to the agent's model provider.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped agent rows */

export const AI_MAX_CHARS = 40_000

const SYSTEM = `You find personal data in documents for redaction.
Return ONLY a JSON object: {"names": [...], "addresses": [...]}.
- names: full or partial names of real people exactly as written in the text (not companies, products or places).
- addresses: postal / street addresses exactly as written (one string each).
Copy each value verbatim from the text. No explanations. Empty lists if none.`

export function parseAiValues(response: string, text: string): Array<{ type: string; text: string }> {
  const block = /```(?:json)?\s*([\s\S]*?)```/.exec(response)?.[1] ?? response
  const start = block.indexOf('{')
  const end = block.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: any
  try { parsed = JSON.parse(block.slice(start, end + 1)) } catch { return [] }
  const out: Array<{ type: string; text: string }> = []
  const seen = new Set<string>()
  const add = (type: string, list: unknown) => {
    if (!Array.isArray(list)) return
    for (const raw of list.slice(0, 500)) {
      const v = typeof raw === 'string' ? raw.trim() : ''
      if (v.length < 2 || v.length > 300 || !text.includes(v) || seen.has(`${type}:${v}`)) continue
      seen.add(`${type}:${v}`)
      out.push({ type, text: v })
    }
  }
  add('person_name', parsed?.names)
  add('postal_address', parsed?.addresses)
  return out
}

/** Names and addresses found by the agent's model in `text` (first AI_MAX_CHARS characters). */
export async function findWithAgent(supabase: SupabaseClient, tenantId: string, agentId: string, text: string): Promise<{ values: Array<{ type: string; text: string }>; truncated: boolean }> {
  const { data: agent, error } = await (supabase as any).from('agents').select('*, integration:integrations(*)').eq('id', agentId).eq('tenant_id', tenantId).single()
  if (error || !agent) throw new Error('AI detection: agent not found')
  if (agent.is_active === false) throw new Error('AI detection: the agent is inactive')
  if (!agent.integration?.config) throw new Error('AI detection: the agent has no model connection')
  const { decryptSensitiveFields } = await import('@/lib/secret-fields')
  const cfg = decryptSensitiveFields(agent.integration.config) as any
  const apiKey = cfg.auth_config?.key_value ?? cfg.auth_config?.token ?? ''
  if (!apiKey) throw new Error('AI detection: no API key in the agent\'s connection')
  const { executeAgent } = await import('@/lib/agent-executor')
  const slice = text.slice(0, AI_MAX_CHARS)
  const result = await executeAgent({
    baseUrl: cfg.base_url ?? 'https://api.openai.com/v1',
    apiKey,
    model: agent.model ?? 'gpt-4o',
    systemPrompt: SYSTEM,
    temperature: 0,
    maxTokens: 4096,
    maxIterations: 1,
    tools: [],
  }, `Text:\n"""\n${slice}\n"""`, { _tenantId: tenantId, _agentId: agentId, maxDurationMs: 120_000 })
  if (result.status === 'failed') throw new Error(`AI detection failed: ${result.error ?? 'no response'}`)
  return { values: parseAiValues(result.response ?? '', slice), truncated: text.length > slice.length }
}
