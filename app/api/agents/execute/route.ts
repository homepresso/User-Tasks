import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { executeAgent, BUILTIN_TOOL_DEFS } from '@/lib/agent-executor'
import type { AgentConfig, AgentTool } from '@/lib/agent-executor'
import { buildAgentAccessPrompt, getAgentBuiltinToolNames, normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { getUserPermissions } from '@/lib/permissions-server'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { recordAgentRun } from '@/lib/agent-run-service'
import { configuredAppUrl } from '@/lib/config/bootstrap'

// Vercel's default function timeout (10-15s) is far shorter than an agent run
// can take. 60 is the Hobby-plan ceiling; raise to 300 once on a Pro+ plan.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get tenant for validation
  const { data: profile, error: profileError } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  if (profileError || !profile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })
  const tenantId = profile.current_tenant_id ?? profile.tenant_id

  // Running an agent is a privileged action (spends tokens, invokes tools).
  const perms = await getUserPermissions()
  if (!perms.has('agents.test')) {
    return NextResponse.json({ error: "Forbidden: the 'agents.test' permission is required to run agents" }, { status: 403 })
  }

  // Rate limit to bound LLM cost from a single actor / tenant.
  const throttled = await agentExecutionRateLimit(String(tenantId), user.id)
  if (throttled) {
    return NextResponse.json({ error: throttled.message }, { status: 429, headers: { 'Retry-After': String(Math.ceil(throttled.retryAfterMs / 1000)) } })
  }

  const body = await request.json()
  const { agent_id, message, shared_context } = body

  if (!agent_id || !String(message ?? '').trim()) {
    return NextResponse.json({ error: 'Missing agent_id or message' }, { status: 400 })
  }

  // Load agent — with tenant check to prevent cross-tenant access
  const { data: agent, error: agentError } = await (supabase as any).from('agents')
    .select('*, integration:integrations(*)')
    .eq('id', agent_id)
    .eq('tenant_id', tenantId)
    .single()
  if (agentError || !agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if ((agent as any).is_active === false) {
    return NextResponse.json({ error: 'Agent is inactive' }, { status: 400 })
  }

  // Validate integration
  const integration = (agent as any).integration
  if (!integration?.config) {
    return NextResponse.json({ error: 'Agent has no integration configured. Add an AI provider via Integrations.' }, { status: 400 })
  }

  // Credential fields are encrypted at rest — decrypt at the read boundary
  const intConfig = decryptSensitiveFields(integration.config) as any
  const apiKey = intConfig.auth_config?.key_value ?? intConfig.auth_config?.token ?? ''
  const baseUrl = intConfig.base_url ?? 'https://api.openai.com/v1'
  if (!apiKey) return NextResponse.json({ error: 'No API key found in integration' }, { status: 400 })

  // Build tools
  const normalizedOutputConfig = normalizeAgentOutputConfig((agent as any).output_config)
  const builtinToolNames = getAgentBuiltinToolNames(normalizedOutputConfig, {
    includeSharedContext: Boolean(shared_context),
  })
  const agentTools: AgentTool[] = [
    ...((agent as any).tools ?? []),
    ...BUILTIN_TOOL_DEFS.filter(bt => builtinToolNames.includes(bt.name)),
  ]

  // Build system prompt from structured fields
  const a = agent as any
  const promptParts: string[] = []
  if (a.role) promptParts.push(`You are ${a.role}.`)
  if (a.task) promptParts.push(`\nYour task: ${a.task}`)
  if (a.boundaries) promptParts.push(`\nBoundaries and rules:\n${a.boundaries}`)
  const outputVars = normalizedOutputConfig.variables
  // The executor appends the strict JSON-block instruction when outputVariables
  // are passed; we just describe them here so the model knows their meaning.
  if (outputVars.length > 0) {
    promptParts.push(`\nYour response should determine these outputs:`)
    for (const v of outputVars) promptParts.push(`- ${v.name} (${v.type}): ${v.description}`)
  }
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
  if (accessPrompt) promptParts.push(accessPrompt)
  if (a.system_prompt) promptParts.push(`\n${a.system_prompt}`)

  const agentConfig: AgentConfig = {
    baseUrl, apiKey,
    model: a.model ?? 'gpt-4o',
    systemPrompt: promptParts.join('\n') || 'You are a helpful assistant.',
    temperature: Number(a.temperature) || 0.7,
    maxTokens: Number(a.max_tokens) || 4096,
    maxIterations: Number(a.max_iterations) || 10,
    tools: agentTools,
  }

  const appBaseUrl = configuredAppUrl() || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  // Stream events via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const result = await executeAgent(agentConfig, message, {
          onEvent: (event) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          },
          sharedContext: shared_context ?? undefined,
          appBaseUrl,
          _tenantId: tenantId,
          _agentId: agent_id,
          _actingUserId: user.id,
          _agentOutputConfig: normalizedOutputConfig,
          outputVariables: normalizedOutputConfig.variables,
        })

        // Persist the run (records failed vs completed, outputs, and audit).
        await recordAgentRun({
          supabase, tenantId: String(tenantId), agentId: agent_id, result,
          model: agentConfig.model, inputMessage: message, actorId: user.id,
          callerType: 'manual', context: shared_context ?? null,
        })

        // A failed run surfaces as an SSE error, not a silent "done".
        if (result.status === 'failed') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: result.error ?? 'Agent execution failed' })}\n\n`))
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', result })}\n\n`))
        }
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message ?? 'Agent execution failed' })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
