/**
 * Agent Executor — agentic loop for OpenAI-compatible APIs with tool calling.
 * Supports any provider: OpenAI, Claude (via proxy), Groq, Together, Ollama, Azure, etc.
 */

export type { AgentTool } from './agent-tool-defs'
import type { AgentTool } from './agent-tool-defs'
import { processorSecret } from '@/lib/config/bootstrap'

export interface AgentConfig {
  baseUrl: string              // e.g. https://api.openai.com/v1
  apiKey: string
  model: string
  systemPrompt: string
  temperature: number
  maxTokens: number
  maxIterations: number
  tools: AgentTool[]
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
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
}

export interface AgentIterationEvent {
  type: 'iteration' | 'tool_call' | 'tool_result' | 'complete' | 'error'
  iteration?: number
  message?: string
  toolCall?: AgentToolCall
  response?: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  error?: string
}

export interface AgentResult {
  /** Whether the run finished normally or errored (LLM/network/timeout/budget). */
  status: 'completed' | 'failed'
  /** Populated when status === 'failed'. */
  error?: string
  response: string
  iterations: number
  toolCalls: AgentToolCall[]
  messages: AgentMessage[]
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  duration_ms: number
  /** Declared structured outputs parsed from the model's final fenced JSON block. */
  outputs?: Record<string, any>
  /** Set when declared outputs were requested but could not be parsed. */
  parse_warning?: string
}

/** A declared output variable an agent should emit as structured JSON. */
export interface AgentOutputVariable {
  name: string
  type?: string
  description?: string
}

// ── Tool Schema Conversion ──

function toolsToOpenAIFormat(tools: AgentTool[]): any[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          (tool.inputSchema ?? []).map(p => [p.name, { type: p.type || 'string', description: p.description }])
        ),
        required: (tool.inputSchema ?? []).filter(p => p.required).map(p => p.name),
      },
    },
  }))
}

// ── Built-in Tool Handlers ──

// ── URL validation (SSRF protection) ──

function isUrlSafe(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return false
    if (host === 'metadata.google.internal') return false
    // Block private IP ranges
    const parts = host.split('.').map(Number)
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      if (parts[0] === 10) return false
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false
      if (parts[0] === 192 && parts[1] === 168) return false
      if (parts[0] === 169 && parts[1] === 254) return false
    }
    return true
  } catch { return false }
}

// ── Safe math eval (no Function/eval) ──

function safeMathEval(expression: string): number | null {
  const sanitized = expression.replace(/[^0-9+\-*/%(). ]/g, '').trim()
  if (!sanitized || sanitized.length > 200) return null
  try {
    const { safeEval } = require('./expression-resolver')
    return safeEval(sanitized)
  } catch { return null }
}

// ── Internal tool-route caller ──

/** The service secret internal agent tool routes accept in lieu of a session. */
function agentProcessorSecret(): string {
  return processorSecret() ?? ''
}

/**
 * Call one of the app's internal agent tool routes (data-tool, action-tool,
 * doc-tool). The executor runs server-side with no browser
 * session cookie, so it authenticates with the processor secret and passes the
 * tenant/agent/acting-user context explicitly in the body. The routes trust that
 * identity ONLY when the secret matches, and re-verify agent scope server-side.
 */
async function callAgentTool(
  path: string,
  payload: Record<string, any>,
  context: Record<string, any> | undefined,
  timeoutMs = 15_000,
): Promise<any> {
  try {
    const appUrl = (context as any)?._appBaseUrl ?? ''
    const secret = agentProcessorSecret()
    const resp = await fetch(`${appUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-processor-secret': secret } : {}),
      },
      body: JSON.stringify({
        agent_id: (context as any)?._agentId ?? null,
        tenant_id: (context as any)?._tenantId ?? null,
        acting_user_id: (context as any)?._actingUserId ?? null,
        ...payload,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      return { error: `Tool call failed (${resp.status})${errText ? `: ${errText.slice(0, 200)}` : ''}` }
    }
    return await resp.json()
  } catch (e: any) {
    return { error: e.message }
  }
}

// ── Builtin tool handlers ──

const BUILTIN_TOOLS: Record<string, (args: Record<string, any>, context?: Record<string, any>) => any | Promise<any>> = {
  calculate: (args) => {
    const result = safeMathEval(String(args.expression ?? ''))
    return result !== null ? { result } : { error: 'Invalid expression' }
  },
  current_datetime: () => ({ datetime: new Date().toISOString(), timestamp: Date.now() }),
  read_shared_facts: (_args, context) => ({ facts: context?.facts ?? {} }),
  write_shared_fact: (args, context) => {
    if (context) { if (!context.facts) context.facts = {}; context.facts[args.key] = args.value }
    return { success: true, key: args.key }
  },
  remember_fact: (args, context) => {
    if (context) { if (!context.facts) context.facts = {}; context.facts[args.key] = args.value }
    return { success: true }
  },

  // HTTP tools (with SSRF protection)
  http_get: async (args) => {
    if (!isUrlSafe(args.url)) return { error: 'URL blocked: private/local addresses not allowed' }
    try {
      const headers = typeof args.headers === 'object' ? args.headers : {}
      const resp = await fetch(args.url, { headers, signal: AbortSignal.timeout(15_000) })
      const text = (await resp.text()).slice(0, 10_000)
      try { return { status: resp.status, data: JSON.parse(text) } } catch { return { status: resp.status, data: text } }
    } catch (e: any) { return { error: e.message } }
  },
  http_post: async (args) => {
    if (!isUrlSafe(args.url)) return { error: 'URL blocked: private/local addresses not allowed' }
    try {
      const headers = { 'Content-Type': 'application/json', ...(typeof args.headers === 'object' ? args.headers : {}) }
      const resp = await fetch(args.url, { method: 'POST', headers, body: JSON.stringify(args.body), signal: AbortSignal.timeout(15_000) })
      const text = (await resp.text()).slice(0, 10_000)
      try { return { status: resp.status, data: JSON.parse(text) } } catch { return { status: resp.status, data: text } }
    } catch (e: any) { return { error: e.message } }
  },

  // Data tools — execute real Supabase queries via the app API
  query_data_table: (args, context) => callAgentTool('/api/agents/data-tool', {
    action: 'query', table_name: args.table_name, filter_column: args.filter_column, filter_value: args.filter_value, limit: args.limit ?? 50,
  }, context),
  insert_data_row: (args, context) => callAgentTool('/api/agents/data-tool', {
    action: 'insert', table_name: args.table_name, data: args.data,
  }, context),
  update_data_rows: (args, context) => callAgentTool('/api/agents/data-tool', {
    action: 'update', table_name: args.table_name, filter_column: args.filter_column, filter_value: args.filter_value, updates: args.updates,
  }, context),
  get_task_status: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'get_task_status', task_id: args.task_id,
  }, context),
  respond_to_task: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'respond_to_task', task_id: args.task_id, response: args.response, comment: args.comment ?? '',
  }, context),
  complete_task: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'complete_task', task_id: args.task_id, outcome: args.outcome ?? 'completed', outcome_notes: args.outcome_notes ?? args.notes ?? '',
  }, context),
  complete_workflow_task: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'complete_workflow_task', task_id: args.task_id, outcome: args.outcome, notes: args.notes ?? args.outcome_notes ?? '',
  }, context, 30_000),
  escalate_task: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'escalate_task', task_id: args.task_id, escalate_to: args.escalate_to, reason: args.reason ?? '',
  }, context),
  redirect_task: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'redirect_task', task_id: args.task_id, redirect_to: args.redirect_to, reason: args.reason ?? '',
  }, context),
  start_workflow_run: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'start_workflow_run', workflow_id: args.workflow_id, variables: args.variables ?? {}, async: args.async === true,
  }, context, 30_000),
  get_workflow_run_status: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'get_workflow_run_status', run_id: args.run_id,
  }, context),
  complete_server_event: (args, context) => callAgentTool('/api/agents/action-tool', {
    action: 'complete_server_event', event_id: args.event_id, variables: args.variables ?? {},
  }, context, 30_000),

  // Document tools — delegate to app API
  generate_word_document: (args, context) => callAgentTool('/api/agents/doc-tool', { action: 'word', ...args }, context, 30_000),
  generate_excel: (args, context) => callAgentTool('/api/agents/doc-tool', { action: 'excel', ...args }, context, 30_000),
  read_csv_file: async (args) => {
    if (!isUrlSafe(args.file_url)) return { error: 'URL blocked' }
    try {
      const resp = await fetch(args.file_url, { signal: AbortSignal.timeout(15_000) })
      const text = (await resp.text()).slice(0, 50_000)
      const lines = text.split('\n').filter(Boolean)
      const delimiter = args.delimiter ?? ','
      const headers = lines[0]?.split(delimiter).map((h: string) => h.trim().replace(/^"|"$/g, '')) ?? []
      const rows = lines.slice(1, 101).map(line => {
        const vals = line.split(delimiter).map((v: string) => v.trim().replace(/^"|"$/g, ''))
        return Object.fromEntries(headers.map((h: string, i: number) => [h, vals[i] ?? '']))
      })
      return { headers, rows, total_rows: lines.length - 1 }
    } catch (e: any) { return { error: e.message } }
  },

  // File tools (with SSRF protection)
  download_file: async (args) => {
    if (!isUrlSafe(args.url)) return { error: 'URL blocked' }
    try {
      const resp = await fetch(args.url, { signal: AbortSignal.timeout(15_000) })
      const text = (await resp.text()).slice(0, 5000)
      return { status: resp.status, content_type: resp.headers.get('content-type'), size: text.length, preview: text }
    } catch (e: any) { return { error: e.message } }
  },
  read_file_content: async (args) => {
    if (!isUrlSafe(args.file_path)) return { error: 'URL blocked' }
    try {
      const resp = await fetch(args.file_path, { signal: AbortSignal.timeout(15_000) })
      return { content: (await resp.text()).slice(0, 10_000) }
    } catch (e: any) { return { error: e.message } }
  },
}

// ── Default Built-in Tool Definitions ──

export { BUILTIN_TOOL_DEFS, type BuiltinToolCategory } from './agent-tool-defs'

// ── Reference Tool Executor ──

async function executeReferenceTool(referenceId: string, args: Record<string, any>, context: Record<string, any> | undefined): Promise<any> {
  // Same dual-auth as the other internal tools: send the processor secret + tenant
  // so the route can execute without a browser session (it re-verifies reference
  // ownership against the tenant server-side).
  return callAgentTool('/api/references/execute', {
    referenceId,
    inputs: args,
  }, context, 30_000)
}

// ── Main Agent Executor ──

export async function executeAgent(
  config: AgentConfig,
  userMessage: string,
  options: {
    onEvent?: (event: AgentIterationEvent) => void
    sharedContext?: { facts: Record<string, any>; messages: AgentMessage[] }
    appBaseUrl?: string
    _tenantId?: string
    _agentId?: string
    /** Identity to act as for scoped tools (task/message). Null → agent-scope only. */
    _actingUserId?: string | null
    _agentOutputConfig?: Record<string, any>
    /** Declared structured outputs the agent should emit as a final JSON block. */
    outputVariables?: AgentOutputVariable[]
    /** Overall wall-clock budget in ms (default 5 min). Exceeding → status 'failed'. */
    maxDurationMs?: number
  } = {}
): Promise<AgentResult> {
  const { onEvent, sharedContext, appBaseUrl = '', _tenantId, _agentId, _actingUserId = null, _agentOutputConfig, outputVariables = [], maxDurationMs = 300_000 } = options
  const startTime = Date.now()
  const allToolCalls: AgentToolCall[] = []
  const totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  let iterationCount = 0

  // Inject appBaseUrl into context so data/doc tools can call back to the app
  const toolContext = sharedContext
    ? { ...sharedContext, _appBaseUrl: appBaseUrl, _tenantId, _agentId, _actingUserId, _agentOutputConfig }
    : { facts: {}, messages: [], _appBaseUrl: appBaseUrl, _tenantId, _agentId, _actingUserId, _agentOutputConfig }

  const failed = (error: string): AgentResult => {
    onEvent?.({ type: 'error', error })
    if (sharedContext?.messages) sharedContext.messages.push({ role: 'assistant', content: `Agent error: ${error}` })
    return {
      status: 'failed',
      error,
      response: `Agent error: ${error}`,
      iterations: iterationCount,
      toolCalls: allToolCalls,
      messages,
      usage: totalUsage,
      duration_ms: Date.now() - startTime,
    }
  }

  // Build messages
  const messages: AgentMessage[] = []
  // System prompt, optionally augmented with a strict structured-output instruction
  // so declared output variables come back as a parseable JSON block.
  const outputInstruction = outputVariables.length > 0
    ? `\n\nWhen you have finished, end your final message with a fenced code block labelled json containing EXACTLY these keys: ${outputVariables.map(v => `"${v.name}"${v.description ? ` (${v.description})` : ''}`).join(', ')}. Emit only those keys. Example:\n\`\`\`json\n{ ${outputVariables.map(v => `"${v.name}": ...`).join(', ')} }\n\`\`\``
    : ''
  if (config.systemPrompt || outputInstruction) {
    messages.push({ role: 'system', content: (config.systemPrompt ?? '') + outputInstruction })
  }
  // Include shared context messages from prior agents
  if (sharedContext?.messages?.length) {
    for (const msg of sharedContext.messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push(msg)
      }
    }
  }
  messages.push({ role: 'user', content: userMessage })

  // Convert tools to OpenAI format
  const openaiTools = config.tools.length > 0 ? toolsToOpenAIFormat(config.tools) : undefined

  // Normalise base URL
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  const chatUrl = baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`

  let finalResponse = ''

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    iterationCount = iteration + 1
    onEvent?.({ type: 'iteration', iteration: iterationCount })

    // Wall-clock budget — a runaway tool/LLM loop must not run for many minutes.
    if (Date.now() - startTime >= maxDurationMs) {
      return failed(`Agent run exceeded its ${Math.round(maxDurationMs / 1000)}s time budget`)
    }

    // Call the API
    const body: any = {
      model: config.model,
      messages: messages.map(m => {
        const msg: any = { role: m.role, content: m.content }
        if (m.tool_calls) msg.tool_calls = m.tool_calls
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
        if (m.name) msg.name = m.name
        return msg
      }),
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }
    if (openaiTools?.length) body.tools = openaiTools

    let apiResponse: any
    try {
      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      })
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`)
      }
      apiResponse = await resp.json()
    } catch (err: any) {
      return failed(err.message)
    }

    // Track usage
    if (apiResponse.usage) {
      totalUsage.prompt_tokens += apiResponse.usage.prompt_tokens ?? 0
      totalUsage.completion_tokens += apiResponse.usage.completion_tokens ?? 0
      totalUsage.total_tokens += apiResponse.usage.total_tokens ?? 0
    }

    const choice = apiResponse.choices?.[0]
    if (!choice) {
      return failed('No response from model')
    }

    const assistantMsg = choice.message
    messages.push(assistantMsg)

    // Check for tool calls
    if (assistantMsg.tool_calls?.length) {
      for (const tc of assistantMsg.tool_calls) {
        const fnName = tc.function.name
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}

        onEvent?.({ type: 'tool_call', toolCall: { toolName: fnName, toolId: tc.id, arguments: args, result: null, duration_ms: 0 } })

        const toolStart = Date.now()
        let result: any

        // Find the tool definition
        const toolDef = config.tools.find(t => t.name === fnName)

        if (toolDef?.type === 'builtin' && BUILTIN_TOOLS[fnName]) {
          result = await BUILTIN_TOOLS[fnName](args, toolContext)
        } else if (toolDef?.type === 'reference' && toolDef.referenceId) {
          result = await executeReferenceTool(toolDef.referenceId, args, toolContext)
        } else if (toolDef?.type === 'mcp' && toolDef.mcpServerId && toolDef.mcpToolName) {
          try {
            const { executeMcpTool } = await import('@/lib/mcp/client')
            const { getServiceDb } = await import('@/lib/providers/db')
            const mcpSupabase = getServiceDb()
            result = await executeMcpTool(mcpSupabase, toolDef.mcpServerId, toolDef.mcpToolName, args)
          } catch (mcpErr: any) {
            result = { error: `MCP tool error: ${mcpErr.message ?? 'Unknown error'}` }
          }
        } else {
          result = { error: `Unknown tool: ${fnName}` }
        }

        const toolCall: AgentToolCall = {
          toolName: fnName,
          toolId: tc.id,
          arguments: args,
          result,
          duration_ms: Date.now() - toolStart,
        }
        allToolCalls.push(toolCall)

        onEvent?.({ type: 'tool_result', toolCall })

        // Add tool result to messages
        messages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: tc.id,
          name: fnName,
        })
      }
      // Continue the loop — model needs to process tool results
      continue
    }

    // No tool calls — agent is done
    finalResponse = assistantMsg.content ?? ''
    onEvent?.({ type: 'complete', response: finalResponse, usage: totalUsage })
    break
  }

  // Store in shared context
  if (sharedContext?.messages) {
    sharedContext.messages.push({ role: 'assistant', content: finalResponse })
  }

  // Parse declared structured outputs from the final response's fenced JSON block.
  let outputs: Record<string, any> | undefined
  let parse_warning: string | undefined
  if (outputVariables.length > 0) {
    const parsed = parseStructuredOutputs(finalResponse, outputVariables)
    outputs = parsed.outputs
    parse_warning = parsed.warning
    if (parsed.warning) onEvent?.({ type: 'error', error: parsed.warning })
  }

  return {
    status: 'completed',
    response: finalResponse,
    iterations: iterationCount,
    toolCalls: allToolCalls,
    messages,
    usage: totalUsage,
    duration_ms: Date.now() - startTime,
    ...(outputs !== undefined ? { outputs } : {}),
    ...(parse_warning ? { parse_warning } : {}),
  }
}

/**
 * Extract declared output variables from a model's final message. Looks for the
 * last ```json fenced block, then a bare trailing {...} object, tolerating prose
 * around it. Returns only the declared keys; missing keys resolve to null and are
 * reported (not thrown) so a run still completes.
 */
export function parseStructuredOutputs(
  text: string,
  outputVariables: AgentOutputVariable[],
): { outputs: Record<string, any>; warning?: string } {
  const declared = outputVariables.map(v => v.name)
  const tryParse = (raw: string): Record<string, any> | null => {
    try {
      const obj = JSON.parse(raw)
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
    } catch { return null }
  }

  let source: Record<string, any> | null = null
  // Last fenced ```json block (or generic fenced block containing an object).
  const fences = [...String(text ?? '').matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (let i = fences.length - 1; i >= 0 && !source; i--) {
    source = tryParse(fences[i][1].trim())
  }
  // Fallback: a trailing bare {...} object.
  if (!source) {
    const braceMatch = String(text ?? '').match(/\{[\s\S]*\}\s*$/)
    if (braceMatch) source = tryParse(braceMatch[0])
  }

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
