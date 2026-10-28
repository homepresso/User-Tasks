import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { executeAgent, BUILTIN_TOOL_DEFS } from '@/lib/agent-executor'
import type { AgentConfig, AgentTool } from '@/lib/agent-executor'
import { buildAgentAccessPrompt, getAgentBuiltinToolNames, normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { recordAgentRun } from '@/lib/agent-run-service'
import { kickAgentQueueProcessor } from '@/lib/process-queue'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { configuredAppUrl } from '@/lib/config/bootstrap'

// Vercel's default function timeout (10-15s) is far shorter than an agent run
// can take. 60 is the Hobby-plan ceiling; raise to 300 once on a Pro+ plan.
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  // Executing an agent requires the same permission as MCP agents_execute.
  const forbidden = requireApiPermission(auth, 'agents.test')
  if (forbidden) return forbidden
  const { id } = await params

  // Bound LLM cost per API key / tenant.
  const throttled = await agentExecutionRateLimit(String(tenantId), auth.keyId)
  if (throttled) return err(throttled.message, 429)

  const body = await request.json()
  const { message, shared_context, async: asyncMode } = body
  if (!String(message ?? '').trim()) return err('message is required')

  // Load agent with tenant check
  const { data: agent, error: agentErr } = await (supabase as any).from('agents')
    .select('*, integration:integrations(*)')
    .eq('id', id).eq('tenant_id', tenantId).single()
  if (agentErr || !agent) return err('Agent not found', 404)

  const a = agent as any
  if (a.is_active === false) return err('Agent is inactive', 400)
  const integration = a.integration
  if (!integration?.config) return err('Agent has no integration configured', 400)

  // Async mode — enqueue to agent_queue and return immediately
  if (asyncMode) {
    const { data: job, error: qErr } = await (supabase as any).from('agent_queue').insert({
      agent_id: id, tenant_id: tenantId,
      input_message: message, shared_context: shared_context ?? null,
      created_by: auth.actingUserId ?? null,
      status: 'pending',
    }).select('id').single()

    if (qErr) return err(`Failed to enqueue: ${qErr.message}`, 500)

    kickAgentQueueProcessor(1)

    return ok({ queued: true, job_id: (job as any).id, status: 'pending' }, 202)
  }

  // Sync mode — execute inline
  // Credential fields are encrypted at rest — decrypt at the read boundary
  const intConfig = decryptSensitiveFields(integration.config) as any
  const apiKey = intConfig.auth_config?.key_value ?? intConfig.auth_config?.token ?? ''
  const baseUrl = intConfig.base_url ?? 'https://api.openai.com/v1'
  if (!apiKey) return err('No API key in integration', 400)

  const normalizedOutputConfig = normalizeAgentOutputConfig(a.output_config)
  const builtinToolNames = getAgentBuiltinToolNames(normalizedOutputConfig, {
    includeSharedContext: Boolean(shared_context),
  })
  const agentTools: AgentTool[] = [
    ...(a.tools ?? []),
    ...BUILTIN_TOOL_DEFS.filter(bt => builtinToolNames.includes(bt.name)),
  ]

  const parts: string[] = []
  if (a.role) parts.push(`You are ${a.role}.`)
  if (a.task) parts.push(`\nYour task: ${a.task}`)
  if (a.boundaries) parts.push(`\nBoundaries:\n${a.boundaries}`)
  const ov = normalizedOutputConfig.variables
  if (ov.length > 0) { parts.push(`\nOutputs:`); for (const v of ov) parts.push(`- ${v.name} (${v.type}): ${v.description}`) }
  let allowedTableNames: string[] = []
  if (normalizedOutputConfig.data_access.mode === 'selected' && normalizedOutputConfig.data_access.table_ids.length > 0) {
    const { data: tables } = await (supabase as any)
      .from('custom_tables')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', normalizedOutputConfig.data_access.table_ids)
    allowedTableNames = (tables ?? []).map((table: any) => String(table.name ?? '')).filter(Boolean)
  }
  const accessPrompt = buildAgentAccessPrompt(normalizedOutputConfig, allowedTableNames)
  if (accessPrompt) parts.push(accessPrompt)
  if (a.system_prompt) parts.push(`\n${a.system_prompt}`)

  const config: AgentConfig = {
    baseUrl, apiKey,
    model: a.model ?? 'gpt-4o',
    systemPrompt: parts.join('\n') || 'You are a helpful assistant.',
    temperature: Number(a.temperature) || 0.7,
    maxTokens: Number(a.max_tokens) || 4096,
    maxIterations: Number(body.max_iterations ?? a.max_iterations) || 10,
    tools: agentTools,
  }

  const appBaseUrl = configuredAppUrl() || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  try {
    const result = await executeAgent(config, message, {
      sharedContext: shared_context ?? undefined,
      appBaseUrl,
      _tenantId: tenantId,
      _agentId: id,
      _actingUserId: auth.actingUserId ?? null,
      _agentOutputConfig: normalizedOutputConfig,
      outputVariables: normalizedOutputConfig.variables,
    })

    await recordAgentRun({
      supabase, tenantId: String(tenantId), agentId: id, result,
      model: config.model, inputMessage: message, actorId: auth.actingUserId ?? null,
      callerType: 'api',
    })

    // A real failure is a 502, not a 200 with an error string in the body.
    if (result.status === 'failed') {
      return err(`Agent execution failed: ${result.error ?? 'unknown error'}`, 502)
    }

    return ok({
      response: result.response,
      outputs: result.outputs ?? null,
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      usage: result.usage,
      duration_ms: result.duration_ms,
    })
  } catch (e: any) {
    return err(`Agent execution failed: ${e.message}`, 500)
  }
}
