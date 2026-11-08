/**
 * Server-side execution of an agent's tools (in-process; see runtime.ts).
 *
 *  - builtins: pure helpers, data tables (data.ts), tasks / workflows
 *    (actions.ts), knowledge (knowledge.ts), documents, URL tools and
 *    attached files;
 *  - reference tools: the tenant's integration references
 *    (reference-executor, tenant-checked, logged with the run's trace id);
 *  - MCP tools: the tenant's MCP servers (lib/mcp/client.ts).
 *
 * URL tools (http_get, http_post, download_file, read_csv_file,
 * read_file_content) go through safeFetch: the shared egress guard on every
 * redirect hop plus the agent's allowed-hosts list.
 */
import type { AgentTool } from '@/lib/agent-tool-defs'
import { safeEval } from '@/lib/expression-resolver'
import { AgentToolError, type AgentToolRuntime, type ToolResult } from './runtime'

export { AgentToolError } from './runtime'
export type { AgentToolRuntime } from './runtime'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DROPPED_REQUEST_HEADERS = new Set(['host', 'cookie', 'content-length', 'connection', 'transfer-encoding', 'proxy-authorization'])

function requestHeaders(value: unknown, defaults: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...defaults }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v !== 'string' && typeof v !== 'number') continue
      if (DROPPED_REQUEST_HEADERS.has(k.toLowerCase()) || !/^[A-Za-z0-9-]{1,64}$/.test(k)) continue
      out[k] = String(v)
    }
  }
  return out
}

async function readText(res: Response, maxChars: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => {})
  const buf = new Uint8Array(Math.min(total, MAX_RESPONSE_BYTES))
  let offset = 0
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.byteLength - offset)
    buf.set(c.subarray(0, take), offset)
    offset += take
    if (offset >= buf.byteLength) break
  }
  return new TextDecoder().decode(buf).slice(0, maxChars)
}

async function fetchForAgent(runtime: AgentToolRuntime, url: unknown, init: RequestInit = {}): Promise<Response> {
  const target = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(target)) throw new AgentToolError('A full http(s) URL is required')
  const { safeFetch, EgressBlockedError } = await import('@/lib/egress-guard')
  try {
    return await safeFetch(target, { ...init, signal: runtime.signal ? AbortSignal.any([runtime.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) }, { allowedHosts: runtime.allowedHosts })
  } catch (error) {
    if (error instanceof EgressBlockedError) throw new AgentToolError(`URL blocked: ${error.message}`, 403)
    throw error
  }
}

function safeMath(expression: string): number | null {
  const sanitized = String(expression ?? '').replace(/[^0-9+\-*/%(). ]/g, '').trim()
  if (!sanitized || sanitized.length > 200) return null
  try {
    const out = safeEval(sanitized)
    return typeof out === 'number' && Number.isFinite(out) ? out : null
  } catch { return null }
}

/** Files given to this run (Run Agent → Files), backing read_attached_file. */
export interface RunAttachment { id?: string; name: string; mime_type: string; bytes: Uint8Array }

export interface BuiltinContext {
  facts: Record<string, unknown>
  attachments: RunAttachment[]
}

/** Builtins that need no database or network (unit-testable, always available). */
export async function runPureBuiltin(name: string, args: Record<string, any>, context: BuiltinContext): Promise<ToolResult | undefined> {
  switch (name) {
    case 'calculate': {
      const result = safeMath(String(args.expression ?? ''))
      return result !== null ? { result } : { error: 'Invalid expression' }
    }
    case 'current_datetime':
      return { datetime: new Date().toISOString(), timestamp: Date.now() }
    case 'read_shared_facts':
      return { facts: context.facts }
    case 'write_shared_fact':
    case 'remember_fact': {
      const key = String(args.key ?? '').trim().slice(0, 100)
      if (!key) return { error: 'key is required' }
      context.facts[key] = typeof args.value === 'string' ? args.value.slice(0, 5_000) : args.value
      return { success: true, key }
    }
    case 'read_attached_file': {
      const key = String(args.file_id ?? args.name ?? '').trim()
      const file = context.attachments.find((f) => (f.id && f.id === key.toLowerCase()) || f.name === key)
      if (!file) return { error: `No file "${key}" was given to this agent step`, files: context.attachments.map((f) => ({ id: f.id ?? null, name: f.name })) }
      const { extractFileText } = await import('@/lib/agent-files')
      const text = await extractFileText(file)
      return { name: file.name, mime_type: file.mime_type, text: text.slice(0, 50_000), truncated: text.length > 50_000 }
    }
  }
  return undefined
}

async function runBuiltin(name: string, args: Record<string, any>, runtime: AgentToolRuntime, context: BuiltinContext): Promise<ToolResult> {
  const pure = await runPureBuiltin(name, args, context)
  if (pure) return pure

  switch (name) {
    case 'query_data_table':
    case 'insert_data_row':
    case 'insert_data_rows':
    case 'update_data_rows':
    case 'delete_data_rows': {
      const { runDataTool } = await import('./data')
      return runDataTool(runtime, name, args)
    }
    case 'transcribe_media':
    case 'analyze_image': {
      const { runMediaTool } = await import('./media')
      return runMediaTool(runtime, name, args, context.attachments)
    }
    case 'search_knowledge':
    case 'read_knowledge_document': {
      const { runKnowledgeTool } = await import('./knowledge')
      return runKnowledgeTool(runtime, name, args)
    }
    case 'generate_excel': {
      if (!runtime.outputConfig.document_access) throw new AgentToolError('Document access is disabled for this agent', 403)
      const headers = Array.isArray(args.headers) ? args.headers.map((h: unknown) => String(h ?? '')) : []
      const rows = Array.isArray(args.rows) ? args.rows.slice(0, 50_000).map((r: unknown) => (Array.isArray(r) ? r : [r])) : []
      if (headers.length === 0) throw new AgentToolError('headers is required')
      const xl = await import('@/lib/excel')
      const buffer = await xl.workbookToBuffer(xl.buildWorkbook([{ name: String(args.sheet_name ?? 'Sheet1').slice(0, 31) || 'Sheet1', arrays: [headers, ...rows] }]))
      const { storeWorkflowFile } = await import('@/lib/storage/files')
      const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      const stored = await storeWorkflowFile(runtime.db() as any, runtime.tenantId, buffer, 'xlsx', contentType)
      const raw = String(args.file_name ?? 'export.xlsx').replace(/[^\w .-]/g, '_').slice(0, 100) || 'export.xlsx'
      const name = raw.toLowerCase().endsWith('.xlsx') ? raw : `${raw}.xlsx`
      const file = { name, url: stored.url, path: stored.path, ...(stored.ref ? { ref: stored.ref } : {}), size: buffer.byteLength, content_type: contentType }
      runtime.generatedFiles.push(file)
      return { success: true, file: { name, url: stored.url, size: buffer.byteLength }, rows: rows.length }
    }
    case 'generate_word_document':
      throw new AgentToolError('generate_word_document is no longer available to agents — use the workflow Word document step with a template', 400)
    case 'get_task_status': case 'respond_to_task': case 'complete_task': case 'complete_workflow_task':
    case 'escalate_task': case 'redirect_task': case 'start_workflow_run': case 'get_workflow_run_status':
    case 'complete_server_event': {
      const { runActionTool } = await import('./actions')
      return runActionTool(runtime, name, args)
    }
    case 'http_get': {
      const res = await fetchForAgent(runtime, args.url, { headers: requestHeaders(args.headers) })
      const text = await readText(res, 10_000)
      try { return { status: res.status, data: JSON.parse(text) } } catch { return { status: res.status, data: text } }
    }
    case 'http_post': {
      const res = await fetchForAgent(runtime, args.url, {
        method: 'POST',
        headers: requestHeaders(args.headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(args.body ?? null),
      })
      const text = await readText(res, 10_000)
      try { return { status: res.status, data: JSON.parse(text) } } catch { return { status: res.status, data: text } }
    }
    case 'download_file': {
      const res = await fetchForAgent(runtime, args.url)
      const text = await readText(res, 5_000)
      return { status: res.status, content_type: res.headers.get('content-type'), size: text.length, preview: text }
    }
    case 'read_file_content': {
      const res = await fetchForAgent(runtime, args.file_path ?? args.url)
      return { status: res.status, content: await readText(res, 10_000) }
    }
    case 'read_csv_file': {
      const res = await fetchForAgent(runtime, args.file_url)
      const text = await readText(res, 50_000)
      const lines = text.split('\n').filter(Boolean)
      const delimiter = typeof args.delimiter === 'string' && args.delimiter ? args.delimiter : ','
      const headers = lines[0]?.split(delimiter).map((h) => h.trim().replace(/^"|"$/g, '')) ?? []
      const rows = lines.slice(1, 101).map((line) => {
        const vals = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ''))
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
      })
      return { headers, rows, total_rows: Math.max(0, lines.length - 1) }
    }
  }
  throw new AgentToolError(`Unknown tool: ${name}`, 400)
}

/**
 * Run one tool call. Expected failures (scope, permission, validation,
 * blocked URL) come back as `{ error }` for the model; unexpected ones too,
 * with their message.
 */
export async function executeAgentTool(tool: AgentTool, args: Record<string, any>, runtime: AgentToolRuntime, context: BuiltinContext): Promise<ToolResult> {
  try {
    if (tool.type === 'builtin') return await runBuiltin(tool.name, args, runtime, context)
    if (tool.type === 'reference' && tool.referenceId) {
      const { getOwnedReference } = await import('@/lib/integrations/auth')
      const { executeReference } = await import('@/lib/reference-executor')
      const db = runtime.db()
      try { await getOwnedReference(db as any, runtime.tenantId, tool.referenceId) } catch { throw new AgentToolError('Reference not found', 404) }
      const inputs: Record<string, string> = {}
      for (const [k, v] of Object.entries(args ?? {})) inputs[k] = typeof v === 'string' ? v : JSON.stringify(v)
      const result = await executeReference({
        supabase: db, referenceId: tool.referenceId, inputValues: inputs, timeout: 30_000, expectedTenantId: runtime.tenantId,
        caller: { traceId: runtime.traceId ?? '', callerType: 'agent_tool', callerId: runtime.agentId },
      })
      return result as unknown as ToolResult
    }
    if (tool.type === 'mcp' && tool.mcpServerId && tool.mcpToolName) {
      const { executeMcpTool } = await import('@/lib/mcp/client')
      return await executeMcpTool(runtime.db(), tool.mcpServerId, tool.mcpToolName, args, { tenantId: runtime.tenantId })
    }
    return { error: `Tool "${tool.name}" (${tool.type}) cannot be run by agents` }
  } catch (error) {
    if (error instanceof AgentToolError) return { error: error.message }
    return { error: error instanceof Error ? error.message : 'Tool failed' }
  }
}
