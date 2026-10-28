import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { normalizeAgentOutputConfig, type NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { kickAgentQueueProcessor } from '@/lib/process-queue'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'

/**
 * Best-effort, NON-FATAL validation of an agent's integration + governed output
 * config. Every finding is a warning (never an error) so authoring flows aren't
 * blocked on a stale/typo'd reference. Existence checks are batched with
 * `.in('id', [...])` — one query per referenced table.
 */
async function collectAgentConfigWarnings(
  supabase: any,
  tenantId: string,
  opts: { model?: string | null; integrationId?: string | null; outputConfig?: NormalizedAgentOutputConfig | null },
): Promise<string[]> {
  const warnings: string[] = []

  // model — cheap, no query
  if (opts.model !== undefined) {
    const model = String(opts.model ?? '').trim()
    if (!model) warnings.push('model is empty; the agent will fall back to a default provider model.')
    else if (!/^[\w.\-\/:]+$/.test(model)) warnings.push(`model "${model}" contains unexpected characters and may not resolve to a valid provider model.`)
  }

  // integration_id existence
  if (opts.integrationId) {
    const { data } = await supabase.from('integrations').select('id').eq('tenant_id', tenantId).eq('id', opts.integrationId).maybeSingle()
    if (!data) warnings.push(`integration_id "${opts.integrationId}" was not found in this workspace; the agent may fail to reach its model provider.`)
  }

  const oc = opts.outputConfig
  if (oc) {
    // data_access.table_ids -> custom_tables
    const tableIds = oc.data_access.table_ids
    if (tableIds.length > 0) {
      const { data } = await supabase.from('custom_tables').select('id').eq('tenant_id', tenantId).in('id', tableIds)
      const found = new Set((data ?? []).map((r: any) => r.id))
      for (const id of tableIds) if (!found.has(id)) warnings.push(`data_access table "${id}" was not found in this workspace.`)
    }

    // workflow_scope.workflow_ids -> workflows
    const workflowIds = oc.workflow_scope.workflow_ids
    if (workflowIds.length > 0) {
      const { data } = await supabase.from('workflows').select('id').eq('tenant_id', tenantId).in('id', workflowIds)
      const found = new Set((data ?? []).map((r: any) => r.id))
      for (const id of workflowIds) if (!found.has(id)) warnings.push(`workflow_scope workflow "${id}" was not found in this workspace.`)
    }
  }

  return warnings
}

export function registerAgentTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx
  const capabilityModelNote = [
    'Capability model:',
    '- document_access controls governed file helpers such as CSV reading, downloads, and spreadsheet/document generation',
    '- data_access controls governed table query/insert/update actions',
    '- task_access + task_scope controls task inspection and task actions',
    '- workflow_access + workflow_scope controls workflow start/run/server-event actions',
    '- tools is still available for advanced low-level reference/builtin configuration, but most MCP build flows should treat output_config as the main governed capability surface.',
  ].join('\n')

  server.tool('agents_list', 'List AI agents. Agents can be used in workflow run_agent nodes to execute AI tasks within automations.', {
    active: z.boolean().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    let query = (supabase as any).from('agents')
      .select('id, name, description, model, system_prompt, role, task, boundaries, tools, output_config, integration_id, temperature, max_tokens, max_iterations, is_active, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false }).limit(Math.min(args.limit ?? 50, 200))
    if (args.active !== undefined) query = query.eq('is_active', args.active)
    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ agents: data ?? [], count: (data ?? []).length })
  })

  server.tool('agents_get', 'Get agent details by ID, including integration linkage, declared output variables, and optionally recent runs.', {
    agent_id: z.string().describe('Agent ID'),
    include_runs: z.boolean().optional(),
  }, async (args) => {
    const { data, error } = await (supabase as any).from('agents')
      .select('*').eq('id', args.agent_id).eq('tenant_id', tenantId).single()
    if (error) return mcpErr('Agent not found')

    let runs = null
    if (args.include_runs) {
      const { data: r } = await (supabase as any).from('agent_runs')
        .select('id, status, input_message, output_response, iterations, duration_ms, created_at')
        .eq('agent_id', args.agent_id).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10)
      runs = r
    }
    return mcpOk({ ...data, recent_runs: runs })
  })

  server.tool('agents_create', `Create a new AI agent that can be referenced in workflow run_agent nodes. MCP can define the agent prompt, tool access, output variables, governed document/file access, governed table scope, governed workflow scope, governed task scope, model settings in one call. To enable document/file helpers, set output_config.document_access to true. To constrain app access, set output_config.data_access to {"mode":"all"} or {"mode":"selected","table_ids":["table-id"]}. For workflow actions, set output_config.workflow_access to true and optionally limit it with output_config.workflow_scope such as {"mode":"selected","workflow_ids":["workflow-id-1","workflow-id-2"]}. For task actions, set output_config.task_access to true and optionally narrow it with output_config.task_scope such as {"mode":"selected","team_ids":["team-id"],"workflow_ids":["workflow-id"]}.

${capabilityModelNote}`, {
    name: z.string().describe('Agent name'),
    description: z.string().optional(),
    model: z.string().optional().describe('Model ID (default: gpt-4o)'),
    system_prompt: z.string().optional().describe('System prompt that defines the agent personality and instructions'),
    role: z.string().optional().describe('Agent role (e.g. assistant, analyst, reviewer)'),
    task: z.string().optional().describe('Primary task description for the agent'),
    boundaries: z.string().optional().describe('Constraints and boundaries for agent behavior'),
    tools: z.string().optional().describe('JSON string array of integration reference IDs the agent can call'),
    output_config: z.string().optional().describe('JSON string configuring output variables and governed access. Recommended MCP-first pattern: {"variables":[{"name":"summary","type":"string"}],"document_access":true,"data_access":{"mode":"selected","table_ids":["table-id-1"]},"task_access":true,"task_scope":{"mode":"selected","team_ids":["team-id"]},"workflow_access":true,"workflow_scope":{"mode":"selected","workflow_ids":["workflow-id-1"]}}'),
    integration_id: z.string().optional().describe('Optional backing integration/model provider connection'),
    temperature: z.number().optional().describe('Sampling temperature (default: 0.7)'),
    max_tokens: z.number().optional().describe('Maximum output tokens (default: 4096)'),
    max_iterations: z.number().optional().describe('Maximum tool/model iterations (default: 10)'),
  }, async (args) => {
    let parsedTools: string[] = []
    if (args.tools) {
      try { parsedTools = JSON.parse(args.tools) } catch { return mcpErr('tools must be a valid JSON string array') }
    }
    let parsedOutputConfig: any = null
    if (args.output_config) {
      try { parsedOutputConfig = JSON.parse(args.output_config) } catch { return mcpErr('output_config must be a valid JSON string') }
    }
    const normalizedOutputConfig = normalizeAgentOutputConfig(parsedOutputConfig ?? { variables: [] })
    const warnings = await collectAgentConfigWarnings(supabase, tenantId, {
      model: args.model ?? 'gpt-4o',
      integrationId: args.integration_id ?? null,
      outputConfig: normalizedOutputConfig,
    })
    const { data, error } = await (supabase as any).from('agents').insert({
      tenant_id: tenantId,
      name: args.name,
      description: args.description ?? null,
      model: args.model ?? 'gpt-4o',
      system_prompt: args.system_prompt ?? '',
      role: args.role ?? '',
      task: args.task ?? '',
      boundaries: args.boundaries ?? '',
      tools: parsedTools,
      output_config: normalizedOutputConfig,
      integration_id: args.integration_id ?? null,
      temperature: args.temperature ?? 0.7,
      max_tokens: args.max_tokens ?? 4096,
      max_iterations: args.max_iterations ?? 10,
      is_active: true,
    }).select('id, name, model, integration_id, is_active').single()
    if (error) return mcpErr(error.message)
    return mcpOk({ created: true, agent: data, warnings })
  })

  server.tool('agents_update', `Update an existing AI agent by ID, including prompt, tools, output config, governed document/file access, governed data/table scope, governed workflow scope, governed task scope, model settings, and active state.

${capabilityModelNote}`, {
    agent_id: z.string().describe('Agent ID'),
    name: z.string().optional(),
    description: z.string().optional(),
    model: z.string().optional(),
    system_prompt: z.string().optional(),
    role: z.string().optional(),
    task: z.string().optional(),
    boundaries: z.string().optional(),
    tools: z.string().optional().describe('JSON string array of integration reference IDs'),
    output_config: z.string().optional().describe('JSON string configuring output variables plus optional document_access, data_access, task_access, task_scope, workflow_access, and workflow_scope using the same capability model as agents_create'),
    integration_id: z.string().optional().describe('Optional backing integration/model provider connection'),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    max_iterations: z.number().optional(),
    is_active: z.boolean().optional(),
  }, async (args) => {
    const updates: any = {}
    if (args.name !== undefined) updates.name = args.name
    if (args.description !== undefined) updates.description = args.description
    if (args.model !== undefined) updates.model = args.model
    if (args.system_prompt !== undefined) updates.system_prompt = args.system_prompt
    if (args.role !== undefined) updates.role = args.role
    if (args.task !== undefined) updates.task = args.task
    if (args.boundaries !== undefined) updates.boundaries = args.boundaries
    if (args.integration_id !== undefined) updates.integration_id = args.integration_id
    if (args.temperature !== undefined) updates.temperature = args.temperature
    if (args.max_tokens !== undefined) updates.max_tokens = args.max_tokens
    if (args.max_iterations !== undefined) updates.max_iterations = args.max_iterations
    if (args.is_active !== undefined) updates.is_active = args.is_active
    if (args.tools !== undefined) {
      try { updates.tools = JSON.parse(args.tools) } catch { return mcpErr('tools must be a valid JSON string array') }
    }
    if (args.output_config !== undefined) {
      try { updates.output_config = normalizeAgentOutputConfig(JSON.parse(args.output_config)) } catch { return mcpErr('output_config must be a valid JSON string') }
    }
    if (Object.keys(updates).length === 0) return mcpErr('No fields to update')
    const warnings = await collectAgentConfigWarnings(supabase, tenantId, {
      model: args.model !== undefined ? args.model : undefined,
      integrationId: args.integration_id !== undefined ? args.integration_id : null,
      outputConfig: (updates.output_config as NormalizedAgentOutputConfig | undefined) ?? null,
    })
    const { error } = await (supabase as any).from('agents').update(updates).eq('id', args.agent_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ updated: true, agent_id: args.agent_id, warnings })
  })

  server.tool('agents_delete', 'Delete an AI agent by ID. Any workflows that reference this agent in a run_agent node are deactivated (paused) first so they cannot run broken; the deactivated workflows are returned.', {
    agent_id: z.string().describe('Agent ID'),
  }, async (args) => {
    // Reference integrity: deactivate any workflow referencing this agent before deleting.
    const deactivated = await deactivateWorkflowsReferencingAgent(supabase, tenantId, args.agent_id)
    const { error } = await (supabase as any).from('agents').delete().eq('id', args.agent_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({
      deleted: true,
      agent_id: args.agent_id,
      deactivated_workflows: deactivated,
      message: deactivated.length > 0
        ? `Agent deleted. Deactivated ${deactivated.length} referencing workflow(s): ${deactivated.map((w) => w.name).join(', ')}.`
        : 'Agent deleted. No referencing workflows were affected.',
    })
  })

  server.tool('agents_execute', 'Execute an agent with a message by queueing a run. Use this for direct MCP-driven agent invocation outside workflow execution.', {
    agent_id: z.string().describe('Agent ID'),
    message: z.string().describe('Input message to the agent (max 100k characters)'),
  }, async (args) => {
    // Rate-limit agent executions per actor + per tenant to cap runaway LLM cost.
    const rateLimited = await agentExecutionRateLimit(tenantId, ctx.actingUserId ?? ctx.keyType ?? 'mcp')
    if (rateLimited) return mcpErr(rateLimited.message)

    // Bound the input so a single call can't enqueue an unbounded prompt.
    const MAX_MESSAGE_CHARS = 100_000
    if (typeof args.message !== 'string' || args.message.length === 0) {
      return mcpErr('message is required')
    }
    if (args.message.length > MAX_MESSAGE_CHARS) {
      return mcpErr(`message exceeds the maximum length of ${MAX_MESSAGE_CHARS} characters`)
    }

    // Verify the agent belongs to this tenant before enqueueing a run against it.
    const { data: agent, error: agentErr } = await (supabase as any)
      .from('agents')
      .select('id')
      .eq('id', args.agent_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (agentErr) return mcpErr(agentErr.message)
    if (!agent) return mcpErr('Agent not found')

    // Queue the agent execution
    const { data, error } = await (supabase as any).from('agent_queue').insert({
      agent_id: args.agent_id,
      tenant_id: tenantId,
      input_message: args.message,
      status: 'pending',
      priority: 5,
    }).select('id').single()
    if (error) return mcpErr(error.message)
    // Kick the drainer so the queued job is actually processed promptly;
    // if this fetch dies the cron sweep still drains it on its next tick.
    kickAgentQueueProcessor(1)
    return mcpOk({ queued: true, job_id: data?.id, agent_id: args.agent_id })
  })

  server.tool('agents_runs_list', 'List agent execution runs so MCP can audit outputs, durations, and recent agent activity.', {
    agent_id: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    let query = (supabase as any).from('agent_runs')
      .select('id, agent_id, status, input_message, output_response, iterations, duration_ms, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(Math.min(args.limit ?? 20, 200))
    if (args.agent_id) query = query.eq('agent_id', args.agent_id)
    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ runs: data ?? [], count: (data ?? []).length })
  })
}
