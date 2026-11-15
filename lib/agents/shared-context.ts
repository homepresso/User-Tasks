/**
 * The shared multi-agent context of a workflow run (`agent_context`): what
 * Run Agent steps with "Share context" on pass to each other.
 *
 *   agent_context = {
 *     messages:     [{ id, role, content, agent, node_id, branch, timestamp }],
 *     facts:        { <key>: <value> },
 *     fact_writers: { <key>: { agent, node_id, branch, at } },
 *   }
 *
 * Several agents can finish at about the same time (Parallel branches,
 * queued agents), each with its own copy of the context. Copies are MERGED,
 * never overwritten (mergeAgentContexts):
 *
 *  - messages: the union of both copies (by message id), ordered by
 *    timestamp — every agent's turn is kept, tagged with the agent, its step
 *    and its Parallel branch; at most MAX_SHARED_MESSAGES (the newest);
 *  - facts: per key, the value written last (fact_writers[key].at) wins —
 *    last-writer-wins per key, with the writer recorded. When the base copy
 *    has no write time for the key (a Set Variable step, older runs) the
 *    incoming copy wins; an incoming value without a write time does not
 *    replace one that has it.
 *
 * While agents run, facts also live on the run's blackboard
 * (lib/agents/blackboard.ts), so running agents see each other's facts.
 */

export interface SharedMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  agent?: string | null
  node_id?: string | null
  branch?: string | null
  timestamp?: string
}

export interface FactWriter {
  agent?: string | null
  node_id?: string | null
  branch?: string | null
  at: string
}

export interface AgentContext {
  messages: SharedMessage[]
  facts: Record<string, unknown>
  fact_writers?: Record<string, FactWriter>
  [key: string]: unknown
}

/** The newest messages kept in agent_context. */
export const MAX_SHARED_MESSAGES = 200

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A well-formed context from whatever is in the variable (null / partial / malformed). */
export function normalizeAgentContext(value: unknown): AgentContext {
  const v = isObject(value) ? value : {}
  return {
    ...v,
    messages: Array.isArray(v.messages) ? (v.messages.filter(isObject) as unknown as SharedMessage[]) : [],
    facts: isObject(v.facts) ? { ...v.facts } : {},
    ...(isObject(v.fact_writers) ? { fact_writers: { ...(v.fact_writers as Record<string, FactWriter>) } } : {}),
  }
}

/** Identity of a message: its id, or (older messages) its content and author. */
function messageKey(m: SharedMessage): string {
  if (m.id) return `id:${m.id}`
  return `m:${m.role}|${m.agent ?? ''}|${m.timestamp ?? ''}|${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`
}

const time = (iso: unknown) => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * Merge two copies of agent_context (see the module comment). Neither input
 * is changed. `incoming` is the newer copy when nothing else decides.
 */
export function mergeAgentContexts(base: unknown, incoming: unknown): AgentContext {
  const a = normalizeAgentContext(base)
  const b = normalizeAgentContext(incoming)

  // Messages: union by key, stable order by timestamp (then first seen).
  const seen = new Map<string, { m: SharedMessage; order: number }>()
  let order = 0
  for (const m of [...a.messages, ...b.messages]) {
    const key = messageKey(m)
    if (!seen.has(key)) seen.set(key, { m, order: order++ })
  }
  const messages = [...seen.values()]
    .sort((x, y) => {
      const tx = time(x.m.timestamp)
      const ty = time(y.m.timestamp)
      if (tx !== null && ty !== null && tx !== ty) return tx - ty
      return x.order - y.order
    })
    .map((e) => e.m)
    .slice(-MAX_SHARED_MESSAGES)

  // Facts: last writer wins per key.
  const facts: Record<string, unknown> = { ...a.facts }
  const writers: Record<string, FactWriter> = { ...(a.fact_writers ?? {}) }
  for (const [key, value] of Object.entries(b.facts)) {
    if (!(key in facts)) {
      facts[key] = value
      if (b.fact_writers?.[key]) writers[key] = b.fact_writers[key]
      continue
    }
    const ta = time(a.fact_writers?.[key]?.at)
    const tb = time(b.fact_writers?.[key]?.at)
    const incomingWins = ta === null || (tb !== null && tb >= ta)
    if (incomingWins) {
      facts[key] = value
      if (b.fact_writers?.[key]) writers[key] = b.fact_writers[key]
      else delete writers[key]
    }
  }

  const out: AgentContext = { ...a, ...b, messages, facts }
  if (Object.keys(writers).length > 0) out.fact_writers = writers
  else delete out.fact_writers
  return out
}

/** Shared facts as a context fragment (for merging an agent's facts into agent_context). */
export function factsContext(facts: Record<string, unknown>, writers: Record<string, FactWriter> = {}): AgentContext {
  return { messages: [], facts: { ...facts }, ...(Object.keys(writers).length ? { fact_writers: { ...writers } } : {}) }
}
