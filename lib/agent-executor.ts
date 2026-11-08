/**
 * Agent Executor — the agentic tool loop over an OpenAI-compatible Chat
 * Completions API (every agent provider: lib/agents/provider.ts resolves the
 * endpoint, auth header and body differences per provider).
 *
 * Per run:
 *  - system prompt = SAFETY_PREAMBLE (instruction hierarchy) + the agent's
 *    instructions + the structured-output instruction; tool results reach the
 *    model wrapped as untrusted data and truncated (lib/agents/safety.ts);
 *  - each LLM call is retried on 429 / 5xx / timeouts / network errors with
 *    backoff (Retry-After honoured), bounded by the run's time budget;
 *  - limits: max iterations (exhausting them fails the run), wall-clock
 *    budget, total tokens per run, tool calls per run; cancellation through
 *    an AbortSignal;
 *  - tool calls on the agent's approval list pause the run
 *    (status 'awaiting_approval', `pending` + `state`); executeAgent with
 *    `resume` continues it once a person decided (lib/agents/approval.ts);
 *  - declared outputs are validated against their types; one repair turn is
 *    requested when they are missing / invalid, and a strict agent fails the
 *    run if they still are (lib/agents/outputs.ts);
 *  - `steps` is the run's trace: every LLM call (latency, tokens, finish
 *    reason, attempts) and tool call (redacted arguments / result, latency,
 *    status), stored on agent_runs.steps;
 *  - eval mode runs side-effecting tools as simulations.
 */

export type { AgentTool } from './agent-tool-defs'
import { READ_ONLY_BUILTIN_TOOLS, type AgentTool } from './agent-tool-defs'
import { withoutFileContents, type AgentContentPart } from './agent-files'
import {
  agentProviderKind, chatBodyParams, classifyHttpStatus, isRetryableKind, parseRetryAfterHeader, providerErrorMessage,
  resolveChatUrl, retryDelayMs, type AgentErrorKind, type AgentProviderKind,
} from './agents/provider'
import { SAFETY_PREAMBLE, forStorage, redactString, wrapUntrusted } from './agents/safety'
import { ChatStreamAssembler, SseParser, StreamProviderError, type StreamDelta } from './agents/stream'
import { fromMessagesResponse } from './agents/anthropic-messages'
import { blockingErrors, extractJsonObject, outputInstruction, repairMessage, validateOutputs, type OutputVariableSpec } from './agents/outputs'
import type { AgentToolRuntime } from './agents/tools/runtime'
import type { NormalizedAgentOutputConfig } from './agent-knowledge'

export interface AgentConfig {
  baseUrl: string              // e.g. https://api.openai.com/v1 (or a provider's bare host)
  apiKey: string
  model: string
  systemPrompt: string
  /** null = the provider's default (omitted from the request). */
  temperature: number | null
  maxTokens: number
  maxIterations: number
  tools: AgentTool[]
  /** Provider (resolved from the integration type); derived from baseUrl when absent. */
  provider?: AgentProviderKind
  /** Resolved chat endpoint + headers (lib/agents/provider.ts resolveAgentEndpoint). */
  endpoint?: { url: string; headers: Record<string, string> }
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** Text, or content parts (a user message carrying files: lib/agent-files.ts). */
  content: string | AgentContentPart[] | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
  name?: string
}

export interface AgentToolCall {
  toolName: string
  toolId: string
  arguments: Record<string, any>
  result: any
  duration_ms: number
  /** 'ok' | 'error' | 'rejected' (by a reviewer) | 'simulated' (eval) */
  status?: 'ok' | 'error' | 'rejected' | 'simulated'
  /** Set when a person approved / rejected this call. */
  approval?: { approved: boolean; by?: string | null; notes?: string | null }
}

export interface AgentUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Prompt tokens read from the provider's prompt cache (part of prompt_tokens). */
  cached_tokens?: number
  /** Prompt tokens written to the prompt cache (Anthropic; part of prompt_tokens). */
  cache_write_tokens?: number
  reasoning_tokens?: number
}

/** One entry of a run's trace. */
export type AgentStep =
  | {
      type: 'llm'; iteration: number; started_at: string; duration_ms: number; attempts: number
      usage?: AgentUsage; finish_reason?: string | null; tool_calls?: string[]; error?: string; error_kind?: AgentErrorKind
      /** The reply was streamed (false: the provider answered without streaming / streaming fell back). */
      streamed?: boolean
      /** Time to the first streamed token. */
      first_token_ms?: number
      /** Cost of this call (lib/agents/costs.ts), when the model has a price. */
      cost?: { amount: number | null; currency: string | null }
    }
  | {
      type: 'tool'; iteration: number; started_at: string; duration_ms: number; tool: string; tool_type: string
      tool_call_id: string; arguments: unknown; result: unknown; status: 'ok' | 'error' | 'rejected' | 'simulated'
      approval?: { approved: boolean; by?: string | null; notes?: string | null }
    }
  | { type: 'approval_requested'; iteration: number; started_at: string; tool: string; tool_call_id: string; arguments: unknown }
  | { type: 'output_repair'; iteration: number; started_at: string; errors: string[] }

export interface AgentIterationEvent {
  /**
   * delta: streamed reply text (`text`); tool_call_delta: a tool call being
   * streamed (`toolCallDelta`); delta_reset: the partial reply of this
   * iteration is void (the call is retried after an error mid-stream).
   */
  type: 'iteration' | 'tool_call' | 'tool_result' | 'complete' | 'error' | 'approval_required' | 'retry' | 'delta' | 'tool_call_delta' | 'delta_reset'
  iteration?: number
  message?: string
  toolCall?: AgentToolCall
  response?: string
  usage?: AgentUsage
  error?: string
  text?: string
  toolCallDelta?: { index: number; id?: string; name?: string; arguments_delta?: string }
}

/** A tool call waiting for a person's decision. */
export interface AgentPendingApproval {
  tool_call_id: string
  tool: string
  tool_type: string
  arguments: Record<string, any>
}

/** Everything needed to continue a paused run (stored on agent_runs.paused_context). */
export interface AgentResumeState {
  version: 1
  messages: AgentMessage[]
  /** Tool calls of the last assistant message not yet answered (first = the pending one). */
  pending_calls: { id: string; name: string; arguments: string }[]
  iteration: number
  usage: AgentUsage
  tool_calls: AgentToolCall[]
  steps: AgentStep[]
  facts: Record<string, any>
  output_repaired: boolean
  elapsed_ms: number
}

export interface AgentResult {
  /** completed | failed | awaiting_approval (a tool call needs a person; see `pending`/`state`). */
  status: 'completed' | 'failed' | 'awaiting_approval'
  /** Populated when status === 'failed'. */
  error?: string
  error_kind?: AgentErrorKind | 'budget' | 'max_iterations' | 'timeout' | 'cancelled' | 'outputs'
  response: string
  iterations: number
  toolCalls: AgentToolCall[]
  messages: AgentMessage[]
  usage: AgentUsage
  duration_ms: number
  /** Declared structured outputs (validated / coerced). */
  outputs?: Record<string, any>
  /** Set when declared outputs were requested but some are missing / invalid. */
  parse_warning?: string
  steps: AgentStep[]
  pending?: AgentPendingApproval
  state?: AgentResumeState
  /** Files produced by tools (generate_excel). */
  files?: AgentToolRuntime['generatedFiles']
}

/** A declared output variable an agent should emit as structured JSON. */
export type AgentOutputVariable = OutputVariableSpec

export interface ApprovalDecision { approved: boolean; by?: string | null; notes?: string | null }

export interface ExecuteAgentOptions {
  onEvent?: (event: AgentIterationEvent) => void
  /** Shared facts / prior agents' messages (Run Agent "share context"). Only user/assistant text is replayed. */
  sharedContext?: { facts: Record<string, any>; messages: AgentMessage[] }
  /** Earlier turns of this conversation (multi-turn test console). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** In-process tool runtime (tenant / acting user / scopes). Without it only pure builtins run. */
  toolRuntime?: AgentToolRuntime
  /** @deprecated kept for callers / tests that pass the old fields; prefer toolRuntime. */
  _tenantId?: string
  _agentId?: string
  _actingUserId?: string | null
  _agentOutputConfig?: NormalizedAgentOutputConfig | Record<string, any>
  appBaseUrl?: string
  /** Declared structured outputs the agent should emit as a final JSON block. */
  outputVariables?: AgentOutputVariable[]
  /** Fail the run when outputs are still missing / invalid after one repair turn. */
  strictOutputs?: boolean
  /** Overall wall-clock budget in ms (default 5 min). Exceeding → status 'failed'. */
  maxDurationMs?: number
  /** Total tokens one run may use (0 = no limit). */
  maxRunTokens?: number
  /** Tool calls one run may make (0 = no limit). */
  maxToolCalls?: number
  /** Tool names needing approval (`*` = all but read-only builtins). */
  approvalTools?: string[]
  /** Continue a run paused for approval. */
  resume?: { state: AgentResumeState; decision: ApprovalDecision }
  /** 'eval': side-effecting tools are simulated, approvals never wait. */
  mode?: 'live' | 'eval'
  signal?: AbortSignal
  /** Retries per LLM call on transient errors (default 3). */
  maxRetries?: number
  /**
   * Stream model replies (delta / tool_call_delta / delta_reset events
   * through onEvent). Providers that reject streaming fall back to a normal
   * request for the rest of the run; the result is the same either way.
   */
  stream?: boolean
  /** Test seams. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /**
   * Files for this run (Run Agent's "Files"): `parts` go into the user
   * message (images / documents / extracted text, lib/agent-files.ts);
   * `files` back the read_attached_file tool (by id or name). Never logged.
   */
  attachments?: { parts: AgentContentPart[]; files: Array<{ id?: string; name: string; mime_type: string; bytes: Uint8Array }> }
}

/** Characters of one tool result the model sees. */
export const TOOL_RESULT_MAX_CHARS = 20_000

// ── Tool Schema Conversion ──

function paramSchema(p: NonNullable<AgentTool['inputSchema']>[number]): Record<string, unknown> {
  const type = ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(p.type) ? p.type : 'string'
  const schema: Record<string, unknown> = { type, description: p.description }
  // Providers reject array schemas without `items` (OpenAI, Gemini).
  if (type === 'array') schema.items = p.items ?? { type: 'string' }
  return schema
}

export function toolsToOpenAIFormat(tools: AgentTool[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: String(tool.description ?? '').slice(0, 1024),
      parameters: {
        type: 'object',
        properties: Object.fromEntries((tool.inputSchema ?? []).map(p => [p.name, paramSchema(p)])),
        required: (tool.inputSchema ?? []).filter(p => p.required).map(p => p.name),
      },
    },
  }))
}

/** Tools with unique, provider-valid names (first one wins). */
export function dedupeTools(tools: AgentTool[]): AgentTool[] {
  const seen = new Set<string>()
  const out: AgentTool[] = []
  for (const tool of tools) {
    const name = String(tool?.name ?? '').trim()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || seen.has(name)) continue
    seen.add(name)
    out.push(tool)
  }
  return out
}

export { BUILTIN_TOOL_DEFS, type BuiltinToolCategory } from './agent-tool-defs'

/** Does this tool call wait for a person's approval? */
export function toolNeedsApproval(tool: AgentTool | undefined, approvalTools: string[] = []): boolean {
  if (!tool) return false
  if (tool.requiresApproval) return true
  const readOnly = tool.type === 'builtin' && READ_ONLY_BUILTIN_TOOLS.has(tool.name)
  if (approvalTools.includes(tool.name)) return true
  return approvalTools.includes('*') && !readOnly
}

/** Side-effecting = not a read-only builtin (references / MCP may change things). */
export function isSideEffecting(tool: AgentTool): boolean {
  return !(tool.type === 'builtin' && READ_ONLY_BUILTIN_TOOLS.has(tool.name))
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' ? p.text : '')).join('')
  return ''
}

export function addUsage(total: AgentUsage, usage: any): AgentUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const step: AgentUsage = {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0,
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0,
    total_tokens: Number(usage.total_tokens ?? 0) || 0,
  }
  if (!step.total_tokens) step.total_tokens = step.prompt_tokens + step.completion_tokens
  // OpenAI-style cached_tokens; Anthropic Messages (input_tokens excludes cache reads / writes) when sent raw.
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0
  const written = Number(usage.prompt_tokens_details?.cache_write_tokens ?? usage.cache_creation_input_tokens ?? 0) || 0
  if (usage.prompt_tokens === undefined && usage.input_tokens !== undefined && (usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined)) {
    step.prompt_tokens += cached + written
    if (!Number(usage.total_tokens)) step.total_tokens = step.prompt_tokens + step.completion_tokens
  }
  const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens ?? 0) || 0
  if (cached) step.cached_tokens = cached
  if (written) step.cache_write_tokens = written
  if (reasoning) step.reasoning_tokens = reasoning
  total.prompt_tokens += step.prompt_tokens
  total.completion_tokens += step.completion_tokens
  total.total_tokens += step.total_tokens
  if (cached) total.cached_tokens = (total.cached_tokens ?? 0) + cached
  if (written) total.cache_write_tokens = (total.cache_write_tokens ?? 0) + written
  if (reasoning) total.reasoning_tokens = (total.reasoning_tokens ?? 0) + reasoning
  return step
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Streaming state of one run: whether to stream, and whether to ask for usage in the stream. */
export interface StreamState { enabled: boolean; includeUsage: boolean }

/** Providers whose OpenAI-compatible streaming takes stream_options.include_usage. */
export function streamUsageOption(provider: AgentProviderKind): boolean {
  return provider !== 'perplexity'
}

const STREAM_IDLE_MS = 60_000

/** Read a streamed completion; deltas go to onDelta. */
async function readStream(resp: Response, onDelta: (d: StreamDelta) => void, idle: () => void): Promise<{ json: any; firstTokenMs: number | null }> {
  const reader = resp.body?.getReader()
  if (!reader) throw new StreamProviderError('The provider sent an empty stream')
  const parser = new SseParser()
  const assembler = new ChatStreamAssembler()
  const started = Date.now()
  let firstTokenMs: number | null = null
  const feed = (events: ReturnType<SseParser['push']>) => {
    for (const event of events) {
      for (const delta of assembler.push(event)) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started
        onDelta(delta)
      }
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      idle()
      feed(parser.push(value))
      if (assembler.done) break
    }
    feed(parser.end())
  } finally {
    reader.cancel().catch(() => {})
  }
  return { json: assembler.result(), firstTokenMs }
}

/** One chat completion with retries (streamed when `stream` is set and the provider allows it). */
export async function callModel(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  opts: {
    deadline: number; signal?: AbortSignal; fetchImpl: typeof fetch; sleep: (ms: number) => Promise<void>; maxRetries: number
    onRetry?: (attempt: number, message: string, delay: number) => void
    stream?: { state: StreamState; onDelta: (d: StreamDelta) => void; onReset: () => void }
    /** 'anthropic': the body is a native Messages request (lib/agents/anthropic-messages); replies come back in the chat-completion shape. */
    dialect?: 'openai' | 'anthropic'
  },
): Promise<{ ok: true; json: any; attempts: number; streamed: boolean; firstTokenMs: number | null } | { ok: false; error: string; kind: AgentErrorKind | 'cancelled'; attempts: number }> {
  let attempt = 0
  for (;;) {
    attempt++
    if (opts.signal?.aborted) return { ok: false, error: 'Agent run was cancelled', kind: 'cancelled', attempts: attempt - 1 }
    const remaining = opts.deadline - Date.now()
    if (remaining <= 0) return { ok: false, error: 'Agent run exceeded its time budget', kind: 'timeout', attempts: attempt - 1 }
    const streaming = Boolean(opts.stream?.state.enabled)
    let kind: AgentErrorKind
    let message: string
    let retryAfter: number | null = null
    let emitted = false
    // Streaming: the whole call may take the run's remaining time, but the
    // stream must not go silent for longer than STREAM_IDLE_MS.
    const idleAbort = new AbortController()
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const touch = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => idleAbort.abort(new DOMException('stream idle', 'TimeoutError')), STREAM_IDLE_MS)
    }
    try {
      const timeout = AbortSignal.timeout(streaming ? remaining : Math.min(120_000, remaining))
      const signals = [timeout, ...(opts.signal ? [opts.signal] : []), ...(streaming ? [idleAbort.signal] : [])]
      const anthropic = opts.dialect === 'anthropic'
      const requestBody = streaming
        ? { ...body, stream: true, ...(!anthropic && opts.stream!.state.includeUsage ? { stream_options: { include_usage: true } } : {}) }
        : body
      if (streaming) touch()
      const resp = await opts.fetchImpl(url, {
        method: 'POST',
        headers: streaming ? { ...headers, Accept: 'text/event-stream' } : headers,
        body: JSON.stringify(requestBody),
        signal: signals.length > 1 ? AbortSignal.any(signals) : timeout,
      })
      const contentType = String(resp.headers?.get?.('content-type') ?? '')
      if (resp.ok && streaming && contentType.includes('text/event-stream')) {
        const { json, firstTokenMs } = await readStream(resp, (d) => { emitted = true; opts.stream!.onDelta(d) }, touch)
        return { ok: true, json, attempts: attempt, streamed: true, firstTokenMs }
      }
      if (resp.ok) {
        // Not a stream (provider ignored `stream`, or streaming is off): the usual JSON.
        const raw = await resp.json().catch(() => null)
        const json = anthropic ? fromMessagesResponse(raw) : raw
        if (json && typeof json === 'object') return { ok: true, json, attempts: attempt, streamed: false, firstTokenMs: null }
        kind = 'provider_unavailable'
        message = 'Provider returned a response that is not JSON'
      } else {
        const errText = await resp.text().catch(() => '')
        kind = classifyHttpStatus(resp.status)
        message = providerErrorMessage(kind, resp.status, redactString(errText), url)
        retryAfter = parseRetryAfterHeader(resp.headers?.get?.('retry-after') ?? null)
        // A provider / model / gateway that rejects streaming (or its usage option): fall back, without counting it as a retry.
        // (A rejected thinking level is not a streaming problem: the turn retries without it.)
        if (streaming && !anthropic && !/reasoning_effort|output_config|\beffort\b/i.test(errText) && (resp.status === 400 || resp.status === 404 || resp.status === 405 || resp.status === 415 || resp.status === 422 || resp.status === 501)) {
          const state = opts.stream!.state
          if (state.includeUsage && /stream_options|include_usage/i.test(errText)) state.includeUsage = false
          else state.enabled = false
          attempt--
          continue
        }
      }
    } catch (err: any) {
      if (opts.signal?.aborted) return { ok: false, error: 'Agent run was cancelled', kind: 'cancelled', attempts: attempt }
      if (err instanceof StreamProviderError) {
        kind = err.retryable ? 'provider_unavailable' : 'bad_request'
        message = err.message
      } else {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError' || idleAbort.signal.aborted
        kind = timedOut ? 'timeout' : 'network'
        message = idleAbort.signal.aborted ? 'The provider\'s stream stalled' : timedOut ? 'The provider did not answer in time' : `Could not reach the provider: ${err?.message ?? 'network error'}`
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
    }
    if (!isRetryableKind(kind) || attempt > opts.maxRetries) return { ok: false, error: message, kind, attempts: attempt }
    const delay = retryDelayMs(attempt, retryAfter)
    if (Date.now() + delay >= opts.deadline) return { ok: false, error: message, kind, attempts: attempt }
    // Text already shown for this attempt is discarded before the retry.
    if (emitted) opts.stream?.onReset()
    opts.onRetry?.(attempt, message, delay)
    await opts.sleep(delay)
  }
}

/** Fallback runtime for callers that still pass _tenantId/_agentId (tool calls then need the DB). */
async function legacyRuntime(options: ExecuteAgentOptions): Promise<AgentToolRuntime | undefined> {
  if (!options._tenantId || !options._agentId) return undefined
  const [{ normalizeAgentOutputConfig }, { getServiceDb }, { permissionsResolver }] = await Promise.all([
    import('./agent-knowledge'), import('./providers/db'), import('./agents/tools/runtime'),
  ])
  const db = () => getServiceDb() as any
  const outputConfig = normalizeAgentOutputConfig(options._agentOutputConfig ?? {})
  return {
    tenantId: options._tenantId, agentId: options._agentId, actingUserId: options._actingUserId ?? null, outputConfig,
    db, permissions: permissionsResolver(db, options._tenantId, options._actingUserId ?? null),
    allowedHosts: outputConfig.egress.allowed_hosts, generatedFiles: [], signal: options.signal,
  }
}

// ── Main Agent Executor ──

export async function executeAgent(config: AgentConfig, userMessage: string, options: ExecuteAgentOptions = {}): Promise<AgentResult> {
  const {
    onEvent, sharedContext, history = [], outputVariables = [], strictOutputs = false, maxDurationMs = 300_000,
    maxRunTokens = 0, maxToolCalls = 0, approvalTools = [], resume, mode = 'live', signal, attachments,
  } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const streamState: StreamState | null = options.stream && onEvent ? { enabled: true, includeUsage: true } : null
  const maxRetries = Math.max(0, options.maxRetries ?? 3)
  const runtime = options.toolRuntime ?? (await legacyRuntime(options))

  const startTime = Date.now() - (resume?.state.elapsed_ms ?? 0)
  const deadline = Date.now() + Math.max(0, maxDurationMs - (resume?.state.elapsed_ms ?? 0))
  const allToolCalls: AgentToolCall[] = resume ? [...resume.state.tool_calls] : []
  const steps: AgentStep[] = resume ? [...resume.state.steps] : []
  const totalUsage: AgentUsage = resume ? { ...resume.state.usage } : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const facts: Record<string, any> = resume ? { ...resume.state.facts } : (sharedContext?.facts ?? {})
  if (sharedContext && !resume) sharedContext.facts = facts
  const builtinContext = { facts, attachments: attachments?.files ?? [] }
  let iterationCount = resume?.state.iteration ?? 0
  let outputRepaired = resume?.state.output_repaired ?? false
  const tools = dedupeTools(config.tools)
  const provider = config.provider ?? agentProviderKind(null, config.baseUrl)
  const url = config.endpoint?.url ?? resolveChatUrl(provider, config.baseUrl)
  const headers = config.endpoint?.headers ?? {
    'Content-Type': 'application/json',
    ...(config.apiKey ? (provider === 'azure_openai' ? { 'api-key': config.apiKey } : { Authorization: `Bearer ${config.apiKey}` }) : {}),
  }

  // What callers get back: file parts replaced by their names (no contents).
  const scrubbed = (list: AgentMessage[]): AgentMessage[] => list.map((m) => (Array.isArray(m.content) ? { ...m, content: withoutFileContents(m.content) as string } : m))

  // Build / restore messages
  let messages: AgentMessage[]
  if (resume) {
    messages = resume.state.messages.map((m) => ({ ...m }))
  } else {
    messages = []
    messages.push({ role: 'system', content: [SAFETY_PREAMBLE, config.systemPrompt ?? '', outputInstruction(outputVariables)].filter(Boolean).join('\n\n') })
    // Earlier conversation: prior agents' shared messages (as context), then this conversation's history.
    for (const msg of sharedContext?.messages ?? []) {
      if ((msg.role === 'user' || msg.role === 'assistant') && messageText(msg.content).trim()) {
        messages.push({ role: msg.role, content: messageText(msg.content) })
      }
    }
    for (const turn of history.slice(-40)) {
      if ((turn.role === 'user' || turn.role === 'assistant') && String(turn.content ?? '').trim()) {
        messages.push({ role: turn.role, content: String(turn.content).slice(0, 20_000) })
      }
    }
    messages.push({ role: 'user', content: attachments?.parts.length ? [{ type: 'text', text: userMessage }, ...attachments.parts] : userMessage })
  }

  const base = () => ({
    iterations: iterationCount, toolCalls: allToolCalls, messages: scrubbed(messages), usage: totalUsage,
    duration_ms: Date.now() - startTime, steps, ...(runtime?.generatedFiles.length ? { files: runtime.generatedFiles } : {}),
  })
  const failed = (error: string, kind: AgentResult['error_kind']): AgentResult => {
    onEvent?.({ type: 'error', error })
    return { status: 'failed', error, error_kind: kind, response: `Agent error: ${error}`, ...base() }
  }

  const openaiTools = tools.length > 0 ? toolsToOpenAIFormat(tools) : undefined
  let finalResponse = ''
  let outputs: Record<string, any> | undefined
  let parseWarning: string | undefined

  /**
   * Answer the pending tool calls in order. Returns a pause result when one
   * needs approval (and no decision was given for it).
   */
  const runToolCalls = async (calls: { id: string; name: string; arguments: string }[], decision?: ApprovalDecision): Promise<AgentResult | null> => {
    for (let i = 0; i < calls.length; i++) {
      const tc = calls[i]
      const toolDef = tools.find((t) => t.name === tc.name)
      let args: Record<string, any> = {}
      let argError: string | null = null
      try {
        const parsed = tc.arguments ? JSON.parse(tc.arguments) : {}
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed
        else argError = 'Tool arguments must be a JSON object'
      } catch { argError = 'Tool arguments were not valid JSON — call the tool again with a valid JSON object' }

      const thisDecision = i === 0 ? decision : undefined
      if (toolDef && !argError && mode !== 'eval' && toolNeedsApproval(toolDef, approvalTools) && !thisDecision) {
        const pending: AgentPendingApproval = { tool_call_id: tc.id, tool: tc.name, tool_type: toolDef.type, arguments: args }
        steps.push({ type: 'approval_requested', iteration: iterationCount, started_at: new Date().toISOString(), tool: tc.name, tool_call_id: tc.id, arguments: forStorage(args) })
        onEvent?.({ type: 'approval_required', toolCall: { toolName: tc.name, toolId: tc.id, arguments: forStorage(args) as any, result: null, duration_ms: 0 } })
        const state: AgentResumeState = {
          version: 1, messages: scrubbed(messages), pending_calls: calls.slice(i), iteration: iterationCount, usage: totalUsage,
          tool_calls: allToolCalls, steps, facts, output_repaired: outputRepaired, elapsed_ms: Date.now() - startTime,
        }
        return { status: 'awaiting_approval', response: '', pending, state, ...base() }
      }

      onEvent?.({ type: 'tool_call', toolCall: { toolName: tc.name, toolId: tc.id, arguments: forStorage(args) as any, result: null, duration_ms: 0 } })
      const toolStart = Date.now()
      let result: any
      let status: 'ok' | 'error' | 'rejected' | 'simulated' = 'ok'
      if (argError) { result = { error: argError }; status = 'error' }
      else if (!toolDef) { result = { error: `Unknown tool: ${tc.name}` }; status = 'error' }
      else if (maxToolCalls > 0 && allToolCalls.length >= maxToolCalls) {
        result = { error: `This agent may make at most ${maxToolCalls} tool calls per run — finish with the information you have` }
        status = 'error'
      } else if (thisDecision && !thisDecision.approved) {
        result = { error: 'A reviewer rejected this tool call — do not retry it; continue without it.', reviewer_notes: thisDecision.notes ?? null }
        status = 'rejected'
      } else if (mode === 'eval' && isSideEffecting(toolDef)) {
        result = { simulated: true, note: 'Evaluation run: this side-effecting tool was not executed.' }
        status = 'simulated'
      } else if (signal?.aborted) {
        return failed('Agent run was cancelled', 'cancelled')
      } else {
        try {
          if (toolDef.type === 'builtin') {
            const { runPureBuiltin, executeAgentTool } = await import('./agents/tools')
            result = runtime ? await executeAgentTool(toolDef, args, runtime, builtinContext) : (await runPureBuiltin(toolDef.name, args, builtinContext)) ?? { error: `Tool "${toolDef.name}" needs a workspace context` }
          } else if (runtime) {
            const { executeAgentTool } = await import('./agents/tools')
            result = await executeAgentTool(toolDef, args, runtime, builtinContext)
          } else {
            result = { error: `Tool "${toolDef.name}" needs a workspace context` }
          }
        } catch (err: any) {
          result = { error: err?.message ?? 'Tool failed' }
        }
        if (result && typeof result === 'object' && 'error' in result && result.error) status = 'error'
      }

      const toolCall: AgentToolCall = {
        toolName: tc.name, toolId: tc.id, arguments: args, result, duration_ms: Date.now() - toolStart, status,
        ...(thisDecision ? { approval: { approved: thisDecision.approved, by: thisDecision.by ?? null, notes: thisDecision.notes ?? null } } : {}),
      }
      allToolCalls.push(toolCall)
      steps.push({
        type: 'tool', iteration: iterationCount, started_at: new Date(toolStart).toISOString(), duration_ms: toolCall.duration_ms,
        tool: tc.name, tool_type: toolDef?.type ?? 'unknown', tool_call_id: tc.id, arguments: forStorage(args), result: forStorage(result), status,
        ...(toolCall.approval ? { approval: toolCall.approval } : {}),
      })
      onEvent?.({ type: 'tool_result', toolCall: { ...toolCall, arguments: forStorage(args) as any, result: forStorage(result, 2_000) } })
      messages.push({ role: 'tool', content: wrapUntrusted(tc.name, result, TOOL_RESULT_MAX_CHARS), tool_call_id: tc.id, name: tc.name })
    }
    return null
  }

  // Continue a paused run: decide the pending call, answer the rest.
  if (resume) {
    const paused = await runToolCalls(resume.state.pending_calls, resume.decision)
    if (paused) return paused
  }

  let completed = false
  while (iterationCount < config.maxIterations) {
    iterationCount++
    onEvent?.({ type: 'iteration', iteration: iterationCount })

    if (signal?.aborted) return failed('Agent run was cancelled', 'cancelled')
    if (Date.now() >= deadline) return failed(`Agent run exceeded its ${Math.round(maxDurationMs / 1000)}s time budget`, 'timeout')
    if (maxRunTokens > 0 && totalUsage.total_tokens >= maxRunTokens) {
      return failed(`Agent run used ${totalUsage.total_tokens} tokens, over its ${maxRunTokens}-token limit`, 'budget')
    }

    const body: Record<string, unknown> = {
      model: config.model,
      messages: messages.map(m => {
        const msg: any = { role: m.role, content: m.content }
        if (m.tool_calls) msg.tool_calls = m.tool_calls
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
        if (m.name && m.role === 'tool') msg.name = m.name
        return msg
      }),
      ...chatBodyParams(provider, config.model, { maxTokens: config.maxTokens, temperature: config.temperature }),
    }
    if (openaiTools?.length) body.tools = openaiTools

    const callStart = Date.now()
    if (streamState && streamState.includeUsage && !streamUsageOption(provider)) streamState.includeUsage = false
    const iteration = iterationCount
    const call = await callModel(url, headers, body, {
      deadline, signal, fetchImpl, sleep, maxRetries,
      onRetry: (attempt, message, delay) => onEvent?.({ type: 'retry', iteration: iterationCount, message: `Retrying in ${Math.round(delay / 100) / 10}s (attempt ${attempt + 1}): ${message}` }),
      ...(streamState ? {
        stream: {
          state: streamState,
          onDelta: (d: StreamDelta) => {
            if (d.text) onEvent?.({ type: 'delta', iteration, text: d.text })
            if (d.tool_call) onEvent?.({ type: 'tool_call_delta', iteration, toolCallDelta: d.tool_call })
          },
          onReset: () => onEvent?.({ type: 'delta_reset', iteration }),
        },
      } : {}),
    })
    if (!call.ok) {
      steps.push({ type: 'llm', iteration: iterationCount, started_at: new Date(callStart).toISOString(), duration_ms: Date.now() - callStart, attempts: call.attempts, error: call.error, ...(call.kind !== 'cancelled' ? { error_kind: call.kind } : {}) })
      return failed(call.error, call.kind)
    }

    const apiResponse = call.json
    const stepUsage = addUsage(totalUsage, apiResponse.usage)
    const choice = apiResponse.choices?.[0]
    const assistantMsg = choice?.message
    steps.push({
      type: 'llm', iteration: iterationCount, started_at: new Date(callStart).toISOString(), duration_ms: Date.now() - callStart,
      attempts: call.attempts, ...(stepUsage ? { usage: stepUsage } : {}), finish_reason: choice?.finish_reason ?? null,
      ...(streamState ? { streamed: call.streamed } : {}), ...(call.firstTokenMs !== null ? { first_token_ms: call.firstTokenMs } : {}),
      ...(assistantMsg?.tool_calls?.length ? { tool_calls: assistantMsg.tool_calls.map((t: any) => String(t?.function?.name ?? '')) } : {}),
    })
    if (!assistantMsg) return failed('No response from model', 'provider_unavailable')

    const toolCalls = Array.isArray(assistantMsg.tool_calls)
      ? assistantMsg.tool_calls
          .filter((t: any) => t && t.function && typeof t.function.name === 'string')
          .map((t: any, i: number) => ({ id: String(t.id || `call_${iterationCount}_${i}`), type: 'function' as const, function: { name: t.function.name, arguments: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments ?? {}) } }))
      : []
    const text = messageText(assistantMsg.content)
    messages.push({ role: 'assistant', content: text || (toolCalls.length ? null : ''), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })

    if (toolCalls.length) {
      const paused = await runToolCalls(toolCalls.map((t: { id: string; function: { name: string; arguments: string } }) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments })))
      if (paused) return paused
      continue
    }

    // No tool calls — the agent answered.
    finalResponse = text
    if (outputVariables.length > 0) {
      const validation = validateOutputs(finalResponse, outputVariables)
      const problems = blockingErrors(validation, outputVariables)
      if (problems.length > 0 && !outputRepaired && iterationCount < config.maxIterations) {
        outputRepaired = true
        steps.push({ type: 'output_repair', iteration: iterationCount, started_at: new Date().toISOString(), errors: problems })
        messages.push({ role: 'user', content: repairMessage(problems, outputVariables) })
        continue
      }
      outputs = validation.outputs
      if (validation.errors.length) parseWarning = `Agent outputs: ${validation.errors.join('; ')}`
      if (problems.length > 0 && strictOutputs) {
        return { ...failed(`Agent outputs are invalid: ${problems.join('; ')}`, 'outputs'), outputs }
      }
      if (parseWarning) onEvent?.({ type: 'error', error: parseWarning })
    }
    if (choice?.finish_reason === 'length' && !finalResponse) return failed('The model hit its max tokens limit before answering — raise Max tokens', 'bad_request')
    completed = true
    onEvent?.({ type: 'complete', response: finalResponse, usage: totalUsage })
    break
  }

  if (!completed) {
    return failed(`Agent did not finish within ${config.maxIterations} iterations (still calling tools) — raise Max iterations or simplify the task`, 'max_iterations')
  }

  return {
    status: 'completed',
    response: finalResponse,
    ...base(),
    ...(outputs !== undefined ? { outputs } : {}),
    ...(parseWarning ? { parse_warning: parseWarning } : {}),
  }
}

/**
 * Extract declared output variables from a model's final message (kept for
 * callers / tests of the earlier API). Missing keys resolve to null and are
 * reported in `warning`.
 */
export function parseStructuredOutputs(
  text: string,
  outputVariables: AgentOutputVariable[],
): { outputs: Record<string, any>; warning?: string } {
  const source = extractJsonObject(text)
  const declared = outputVariables.map(v => v.name)
  if (!source) {
    return { outputs: Object.fromEntries(declared.map(k => [k, null])), warning: 'Agent did not return a parseable JSON output block; declared outputs are null' }
  }
  const outputs: Record<string, any> = {}
  const missing: string[] = []
  for (const key of declared) {
    if (key in source) outputs[key] = source[key]
    else { outputs[key] = null; missing.push(key) }
  }
  return { outputs, warning: missing.length ? `Agent output missing declared keys: ${missing.join(', ')}` : undefined }
}
