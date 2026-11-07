import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { fromMcpContext, isServiceError } from '@/lib/services/context'
import * as agents from '@/lib/services/agents'

function parseJson(value: string | undefined, label: string): { ok: true; value: any } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined }
  try { return { ok: true, value: JSON.parse(value) } } catch { return { ok: false, error: `${label} must be valid JSON` } }
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    if (isServiceError(error)) return mcpErr(error.message)
    return mcpErr(error instanceof Error ? error.message : 'Request failed')
  }
}

const TOOLS_DESCRIPTION = 'JSON array of tool objects: {"type":"builtin","name":"http_get"} | {"type":"reference","referenceId":"<integration reference id>"} (the reference\'s inputs become the tool parameters; a bare reference id string is accepted too) | {"type":"mcp","mcpServerId":"<id>","mcpToolName":"<tool>"}. Add "requiresApproval":true to make a person approve each call. References and MCP servers must belong to this workspace.'
const OUTPUT_CONFIG_DESCRIPTION = 'JSON object: {"variables":[{"name":"summary","type":"string|number|integer|boolean|array|object","required":true,"enum":["a","b"],"description":"..."}],"strict_outputs":false,"document_access":true,"data_access":{"grants":[{"table_id":"...","read":true,"insert":false,"update":false,"delete":false}]},"task_access":true,"task_scope":{"mode":"selected","team_ids":[],"workflow_ids":[]},"workflow_access":true,"workflow_scope":{"mode":"selected","workflow_ids":[]},"knowledge":{"table_ids":[],"files":[]},"limits":{"max_run_tokens":0,"max_tool_calls":0,"daily_token_budget":0,"monthly_token_budget":0,"daily_cost_budget":0,"monthly_cost_budget":0,"budget_currency":"USD"},"approval":{"tools":["http_post"] or ["*"],"assignee_user_id":null,"assignee_team_id":null},"egress":{"allowed_hosts":["api.example.com","*.example.org"]}}'

export function registerAgentTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx
  const svc = () => fromMcpContext(ctx)
  const capabilityModelNote = [
    'Capability model:',
    '- document_access controls governed file helpers such as CSV reading, downloads, and spreadsheet generation',
    '- data_access.grants lists the tables the agent may use and, per table, read / insert / update / delete (none by default)',
    '- task_access + task_scope controls task inspection and task actions',
    '- workflow_access + workflow_scope controls workflow start/run/server-event actions',
    '- knowledge (tables / uploaded documents) adds search_knowledge; approval lists tools a person must approve; limits cap tokens and tool calls; egress.allowed_hosts limits URL tools',
    '- tools adds low-level builtin, integration reference and MCP tools.',
  ].join('\n')

  const fieldsSchema = {
    description: z.string().optional(),
    model: z.string().optional().describe('Model id for the provider (e.g. gpt-4.1, claude-opus-5-5, gemini-2.5-flash)'),
    system_prompt: z.string().optional().describe('Custom instructions appended to the generated prompt'),
    role: z.string().optional().describe('Agent role (e.g. assistant, analyst, reviewer)'),
    task: z.string().optional().describe('Primary task description for the agent'),
    boundaries: z.string().optional().describe('Constraints and boundaries for agent behavior'),
    tools: z.string().optional().describe(TOOLS_DESCRIPTION),
    output_config: z.string().optional().describe(OUTPUT_CONFIG_DESCRIPTION),
    integration_id: z.string().optional().describe('The AI provider integration (must belong to this workspace)'),
    temperature: z.number().optional().describe('Sampling temperature 0–2 (default 0.7; ignored by models that do not take one)'),
    max_tokens: z.number().optional().describe('Maximum output tokens per model call (default 4096)'),
    max_iterations: z.number().optional().describe('Maximum tool/model iterations (default 10, max 50)'),
  }
  const collect = (args: Record<string, any>) => {
    const tools = parseJson(args.tools, 'tools')
    if (!tools.ok) return { error: tools.error }
    const outputConfig = parseJson(args.output_config, 'output_config')
    if (!outputConfig.ok) return { error: outputConfig.error }
    const input: Record<string, any> = {}
    for (const key of ['name', 'description', 'model', 'system_prompt', 'role', 'task', 'boundaries', 'integration_id', 'temperature', 'max_tokens', 'max_iterations', 'is_active']) {
      if (args[key] !== undefined) input[key] = args[key]
    }
    if (tools.value !== undefined) input.tools = tools.value
    if (outputConfig.value !== undefined) input.output_config = outputConfig.value
    return { input }
  }

  server.tool('agents_list', 'List AI agents. Agents can be used in workflow run_agent nodes to execute AI tasks within automations.', {
    active: z.boolean().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    let query = (supabase as any).from('agents')
      .select('id, name, description, model, system_prompt, role, task, boundaries, tools, output_config, integration_id, temperature, max_tokens, max_iterations, is_active, version, created_at, updated_at')
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
        .select('id, status, input_message, output_response, iterations, total_tokens, duration_ms, created_at')
        .eq('agent_id', args.agent_id).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(10)
      runs = r
    }
    return mcpOk({ ...data, recent_runs: runs })
  })

  server.tool('agents_create', `Create a new AI agent that can be referenced in workflow run_agent nodes. Define the prompt, AI provider, tools, typed output variables and governed access in one call. To enable document/file helpers, set output_config.document_access to true. New agents have no data-table access; grant tables with output_config.data_access = {"grants":[{"table_id":"table-id","read":true,"insert":false,"update":false,"delete":false}]}. For workflow actions, set output_config.workflow_access to true and optionally limit it with output_config.workflow_scope. For task actions, set output_config.task_access to true and optionally narrow it with output_config.task_scope.

${capabilityModelNote}`, {
    name: z.string().describe('Agent name'),
    ...fieldsSchema,
  }, async (args) => {
    const collected = collect(args)
    if ('error' in collected) return mcpErr(collected.error as string)
    return run(async () => {
      const agent = await agents.createAgent(svc(), collected.input)
      return { created: true, agent: { id: agent.id, name: agent.name, model: agent.model, integration_id: agent.integration_id, is_active: agent.is_active, version: agent.version }, tools: agent.tools }
    })
  })

  server.tool('agents_update', `Update an existing AI agent by ID, including prompt, tools, output config, governed access, limits, approvals, model settings, and active state. Every change is saved as a new version (agents_versions_list / agents_version_restore).

${capabilityModelNote}`, {
    agent_id: z.string().describe('Agent ID'),
    name: z.string().optional(),
    ...fieldsSchema,
    is_active: z.boolean().optional(),
  }, async (args) => {
    const collected = collect(args)
    if ('error' in collected) return mcpErr(collected.error as string)
    if (Object.keys(collected.input).length === 0) return mcpErr('No fields to update')
    return run(async () => {
      const agent = await agents.updateAgent(svc(), args.agent_id, collected.input)
      return { updated: true, agent_id: args.agent_id, version: agent.version }
    })
  })

  server.tool('agents_delete', 'Delete an AI agent by ID (queued). Any workflows that reference this agent in a run_agent node are deactivated (paused) first so they cannot run broken; the deactivated workflows are returned.', {
    agent_id: z.string().describe('Agent ID'),
  }, async (args) => run(async () => {
    const result = await agents.deleteAgent(svc(), args.agent_id)
    return {
      ...result,
      agent_id: args.agent_id,
      message: result.deactivated_workflows.length > 0
        ? `Agent deletion queued. Deactivated ${result.deactivated_workflows.length} referencing workflow(s): ${result.deactivated_workflows.map((w) => w.name).join(', ')}.`
        : 'Agent deletion queued. No referencing workflows were affected.',
    }
  }))

  server.tool('agents_execute', 'Execute an agent with a message by queueing a run (acting as the credential\'s user). Poll agents_job_get with the returned job_id for the result.', {
    agent_id: z.string().describe('Agent ID'),
    message: z.string().describe('Input message to the agent (max 100k characters)'),
  }, async (args) => {
    // Rate-limit agent executions per actor + per tenant to cap runaway LLM cost.
    const rateLimited = await agentExecutionRateLimit(tenantId, ctx.actingUserId ?? ctx.keyType ?? 'mcp')
    if (rateLimited) return mcpErr(rateLimited.message)

    // Bound the input so a single call can't enqueue an unbounded prompt.
    const MAX_MESSAGE_CHARS = 100_000
    if (typeof args.message !== 'string' || args.message.length === 0) return mcpErr('message is required')
    if (args.message.length > MAX_MESSAGE_CHARS) return mcpErr(`message exceeds the maximum length of ${MAX_MESSAGE_CHARS} characters`)

    return run(async () => ({ ...(await agents.enqueueAgentRun(svc(), args.agent_id, { message: args.message })), agent_id: args.agent_id }))
  })

  server.tool('agents_job_get', 'Get a queued agent job (from agents_execute or a REST async run): status, result (response, outputs, usage) and the agent run id.', {
    job_id: z.string().describe('Job ID'),
  }, async (args) => run(() => agents.getAgentQueueJob(svc(), args.job_id)))

  server.tool('agents_runs_list', 'List agent execution runs so MCP can audit outputs, durations, and recent agent activity.', {
    agent_id: z.string().optional(),
    limit: z.number().optional(),
  }, async (args) => {
    let query = (supabase as any).from('agent_runs')
      .select('id, agent_id, status, input_message, output_response, iterations, total_tokens, cost_amount, cost_currency, cost_status, agent_version, duration_ms, caller_type, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(Math.min(args.limit ?? 20, 200))
    if (args.agent_id) query = query.eq('agent_id', args.agent_id)
    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ runs: data ?? [], count: (data ?? []).length })
  })

  server.tool('agents_versions_list', 'List the saved versions of an agent (every change is a version), newest first, with their snapshots.', {
    agent_id: z.string().describe('Agent ID'),
  }, async (args) => run(() => agents.listAgentVersions(svc(), args.agent_id)))

  server.tool('agents_version_restore', 'Restore an earlier version of an agent (saved as a new version, so it can be undone).', {
    agent_id: z.string().describe('Agent ID'),
    version: z.number().describe('Version number to restore'),
  }, async (args) => run(async () => {
    const agent = await agents.restoreAgentVersion(svc(), args.agent_id, args.version)
    return { restored: true, agent_id: args.agent_id, version: agent.version }
  }))

  server.tool('agents_eval_cases_list', 'List an agent\'s evaluation test cases (input + expectations).', {
    agent_id: z.string().describe('Agent ID'),
  }, async (args) => run(() => agents.listEvalCases(svc(), args.agent_id)))

  server.tool('agents_eval_case_save', 'Create or update an evaluation test case of an agent. expected: {"contains":[],"not_contains":[],"outputs":{"key":"value"},"tools_called":[],"tools_not_called":[],"status":"completed","max_tokens":0,"rubric":"criterion graded by the model"}.', {
    agent_id: z.string().describe('Agent ID'),
    case_id: z.string().optional().describe('Existing case to update'),
    name: z.string(),
    input_message: z.string(),
    expected: z.string().optional().describe('JSON object of expectations'),
    is_active: z.boolean().optional(),
  }, async (args) => {
    const expected = parseJson(args.expected, 'expected')
    if (!expected.ok) return mcpErr(expected.error)
    return run(() => agents.saveEvalCase(svc(), args.agent_id, { id: args.case_id ?? null, name: args.name, input_message: args.input_message, expected: expected.value ?? {}, is_active: args.is_active }))
  })

  server.tool('agents_eval_case_delete', 'Delete an evaluation test case of an agent.', {
    agent_id: z.string().describe('Agent ID'),
    case_id: z.string().describe('Test case ID'),
  }, async (args) => run(() => agents.deleteEvalCase(svc(), args.agent_id, args.case_id)))

  server.tool('agents_eval_runs_list', 'List an agent\'s evaluation runs, newest first (passed / failed counts).', {
    agent_id: z.string().describe('Agent ID'),
    limit: z.number().optional(),
  }, async (args) => run(() => agents.listEvalRuns(svc(), args.agent_id, args.limit ?? 20)))

  server.tool('agents_usage_get', 'Token usage and cost of an agent per day (last 30 days by default), the last 24 hours, this month, and its budgets / limits. Cost is per currency; runs whose model has no price are counted in unpriced_runs, never guessed.', {
    agent_id: z.string().describe('Agent ID'),
    days: z.number().optional(),
  }, async (args) => run(() => agents.agentUsage(svc(), args.agent_id, args.days ?? 30)))

  server.tool('agents_workspace_usage_get', 'Workspace AI agent usage: tokens and cost per day and per agent (last 30 days by default), this month, the workspace budgets and the model price table in effect (workspace overrides, instance prices, shipped list prices).', {
    days: z.number().optional(),
  }, async (args) => run(() => agents.workspaceAgentUsage(svc(), args.days ?? 30)))

  server.tool('agents_cost_settings_update', 'Set the workspace\'s model price overrides and agent budgets. model_prices: JSON list of {"provider":"openai","model":"gpt-4.1","input_per_1m":2,"output_per_1m":8,"cached_input_per_1m":0.5,"currency":"USD","effective_date":"2026-10-29"}; budgets: {"daily_token_budget":0,"monthly_token_budget":0,"daily_cost_budget":0,"monthly_cost_budget":0,"budget_currency":"USD"} (0 = none).', {
    model_prices: z.string().optional().describe('JSON array of price entries'),
    budgets: z.string().optional().describe('JSON object of budgets'),
  }, async (args) => run(() => {
    const parse = (v?: string) => (v === undefined ? undefined : JSON.parse(v))
    return agents.saveAgentCostSettings(svc(), { model_prices: parse(args.model_prices), budgets: parse(args.budgets) })
  }))

  server.tool('agents_eval_run', 'Run an agent\'s evaluation suite (all active cases, or case_ids). Side-effecting tools are simulated. Returns the evaluation run; poll agents_eval_run_get for results.', {
    agent_id: z.string().describe('Agent ID'),
    case_ids: z.array(z.string()).optional(),
  }, async (args) => run(() => agents.startEvalRun(svc(), args.agent_id, { case_ids: args.case_ids })))

  server.tool('agents_eval_run_get', 'Get an evaluation run: status, passed / failed counts and per-case checks.', {
    eval_run_id: z.string(),
  }, async (args) => run(() => agents.getEvalRun(svc(), args.eval_run_id)))
}
