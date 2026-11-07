/**
 * One preparation of an agent run for every caller (server only): the test
 * console (/api/agents/execute), REST execute, the agent queue, the Run
 * Agent workflow step and evaluations. It replaces four hand-copied config
 * builders that had drifted (prompt text, table names, `|| 0.7` turning a
 * temperature of 0 into 0.7, no tenant check on the integration).
 *
 *  - loadAgentForRun(): the agent of the tenant, active, with ITS tenant's
 *    integration (a foreign integration_id is refused), decrypted.
 *  - buildAgentRun(): system prompt, tools (agent tools + derived builtins,
 *    deduplicated), provider endpoint / auth / params, limits, approval
 *    list, output variables and the in-process tool runtime.
 *  - checkDailyBudget(): the agent's and the workspace's token / cost budgets.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUILTIN_TOOL_DEFS, type AgentTool } from '@/lib/agent-tool-defs'
import type { AgentConfig, ExecuteAgentOptions } from '@/lib/agent-executor'
import { buildAgentAccessPrompt, getAgentBuiltinToolNames, normalizeAgentOutputConfig, type NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { DEFAULT_MODEL, providerAllowsNoKey, resolveAgentEndpoint, type AgentProviderKind } from './provider'
import { permissionsResolver, type AgentToolRuntime } from './tools/runtime'

export class AgentRunError extends Error {
  constructor(message: string, readonly status = 400, readonly code: 'not_found' | 'inactive' | 'no_integration' | 'no_key' | 'budget' | 'invalid' = 'invalid') {
    super(message)
    this.name = 'AgentRunError'
  }
}

export interface LoadedAgent {
  agent: Record<string, any>
  integration: { id: string; type: string; config: Record<string, any> }
}

/** Platform caps (whatever an agent row says). */
export const AGENT_CAPS = { maxIterations: 50, maxTokens: 128_000, maxDurationMs: 15 * 60_000 } as const

/** The tenant's agent and its (same-tenant) integration, decrypted. */
export async function loadAgentForRun(db: SupabaseClient, tenantId: string, agentId: string, options: { allowInactive?: boolean; version?: number | null } = {}): Promise<LoadedAgent> {
  const { data: live } = await (db as any).from('agents').select('*').eq('id', agentId).eq('tenant_id', tenantId).maybeSingle()
  if (!live) throw new AgentRunError('Agent not found', 404, 'not_found')
  if (live.is_active === false && !options.allowInactive) throw new AgentRunError('Agent is inactive', 400, 'inactive')
  const agent = options.version ? await pinnedAgent(db, tenantId, live, options.version) : live
  if (!agent.integration_id) throw new AgentRunError('Agent has no AI provider configured. Add one via Integrations and select it on the agent.', 400, 'no_integration')
  const { data: integration } = await (db as any).from('integrations').select('id, type, config, tenant_id, is_active')
    .eq('id', agent.integration_id).eq('tenant_id', tenantId).maybeSingle()
  if (!integration?.config) throw new AgentRunError('The agent\'s AI provider integration was not found in this workspace', 400, 'no_integration')
  if (integration.is_active === false) throw new AgentRunError('The agent\'s AI provider integration is inactive', 400, 'no_integration')
  const config = decryptSensitiveFields(integration.config) as Record<string, any>
  const resolved = { id: integration.id, type: String(integration.type ?? ''), config }
  if (!resolveAgentEndpoint(resolved).apiKey && !providerAllowsNoKey(resolved)) {
    throw new AgentRunError('No API key found in the agent\'s AI provider integration', 400, 'no_key')
  }
  return { agent, integration: resolved }
}

/**
 * The agent as saved in version `version` (a published workflow's pin): the
 * version's snapshot over the live row (id, tenant, creator, active flag stay
 * live — deactivating an agent stops pinned runs too). Snapshots never change,
 * so restoring / rolling back the agent does not change what a pin runs.
 */
export async function pinnedAgent(db: SupabaseClient, tenantId: string, live: Record<string, any>, version: number): Promise<Record<string, any>> {
  const pin = Math.floor(Number(version))
  if (!Number.isFinite(pin) || pin < 1) return live
  if (Number(live.version) === pin) return live
  const { data: row } = await (db as any).from('agent_versions').select('snapshot').eq('tenant_id', tenantId).eq('agent_id', live.id).eq('version', pin).maybeSingle()
  if (!row?.snapshot || typeof row.snapshot !== 'object') {
    throw new AgentRunError(`Version ${pin} of agent "${live.name}" (pinned by the published workflow) was not found — publish the workflow again to pin the current version`, 400, 'not_found')
  }
  return { ...live, ...row.snapshot, id: live.id, tenant_id: live.tenant_id, created_by: live.created_by, is_active: live.is_active, version: pin }
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Clamp an integer setting: absent / invalid → fallback. */
export function intSetting(value: unknown, fallback: number, min: number, max: number): number {
  const n = finite(value)
  if (n === null) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

/** The agent's instructions (no safety preamble / output block: the executor adds those). */
export function buildSystemPrompt(agent: Record<string, any>, outputConfig: NormalizedAgentOutputConfig, tableNames: string[] = []): string {
  const parts: string[] = []
  if (agent.role) parts.push(`You are ${agent.role}.`)
  if (agent.task) parts.push(`Your task: ${agent.task}`)
  if (agent.boundaries) parts.push(`Boundaries and rules:\n${agent.boundaries}`)
  const access = buildAgentAccessPrompt(outputConfig, tableNames).trim()
  if (access) parts.push(access)
  if (agent.system_prompt) parts.push(String(agent.system_prompt))
  return parts.join('\n\n') || 'You are a helpful assistant.'
}

export interface PreparedAgentRun {
  config: AgentConfig
  outputConfig: NormalizedAgentOutputConfig
  provider: AgentProviderKind
  /** Options for executeAgent (merge with the caller's onEvent / signal / attachments). */
  options: Pick<ExecuteAgentOptions, 'toolRuntime' | 'outputVariables' | 'strictOutputs' | 'maxRunTokens' | 'maxToolCalls' | 'approvalTools' | 'maxDurationMs'>
  runtime: AgentToolRuntime
}

export async function buildAgentRun(params: {
  db: SupabaseClient
  tenantId: string
  loaded: LoadedAgent
  actingUserId: string | null
  /** Run Agent "share context": adds read/write shared facts tools. */
  includeSharedContext?: boolean
  /** Overrides from the caller (Run Agent node, REST body) — clamped to the platform caps. */
  overrides?: { maxIterations?: unknown; maxDurationMs?: unknown }
  traceId?: string | null
  signal?: AbortSignal
}): Promise<PreparedAgentRun> {
  const { db, tenantId, loaded, actingUserId } = params
  const a = loaded.agent
  const outputConfig = normalizeAgentOutputConfig(a.output_config)

  let tableNames: string[] = []
  if (outputConfig.data_access.mode === 'selected' && outputConfig.data_access.table_ids.length > 0) {
    const { data: tables } = await (db as any).from('custom_tables').select('id, name').eq('tenant_id', tenantId).in('id', outputConfig.data_access.table_ids)
    tableNames = (tables ?? []).filter((t: any) => t?.name).map((t: any) => {
      const grant = outputConfig.data_access.grants.find((g) => g.table_id === t.id)
      const ops = grant ? (['read', 'insert', 'update', 'delete'] as const).filter((op) => grant[op]) : []
      return `${String(t.name)} (${ops.join(', ')})`
    })
  }

  const builtinNames = getAgentBuiltinToolNames(outputConfig, { includeSharedContext: Boolean(params.includeSharedContext) })
  const stored: AgentTool[] = (Array.isArray(a.tools) ? a.tools : []).filter((t: any) => t && typeof t === 'object' && typeof t.name === 'string')
  const tools: AgentTool[] = [
    ...stored,
    ...BUILTIN_TOOL_DEFS.filter((bt) => builtinNames.includes(bt.name) && !stored.some((t) => t.name === bt.name)),
  ]

  const endpoint = resolveAgentEndpoint(loaded.integration)
  const temperature = finite(a.temperature)
  const config: AgentConfig = {
    baseUrl: String(loaded.integration.config.base_url ?? ''),
    apiKey: endpoint.apiKey,
    model: String(a.model ?? '').trim() || DEFAULT_MODEL[endpoint.kind] || 'gpt-4.1',
    systemPrompt: buildSystemPrompt(a, outputConfig, tableNames),
    temperature: temperature === null ? null : Math.max(0, Math.min(2, temperature)),
    maxTokens: intSetting(a.max_tokens, 4096, 1, AGENT_CAPS.maxTokens),
    maxIterations: intSetting(params.overrides?.maxIterations ?? a.max_iterations, 10, 1, AGENT_CAPS.maxIterations),
    tools,
    provider: endpoint.kind,
    endpoint: { url: endpoint.url, headers: endpoint.headers },
  }

  const serviceDb = () => db
  const runtime: AgentToolRuntime = {
    tenantId, agentId: String(a.id), actingUserId, outputConfig, db: serviceDb,
    permissions: permissionsResolver(serviceDb, tenantId, actingUserId),
    traceId: params.traceId ?? null,
    allowedHosts: outputConfig.egress.allowed_hosts,
    generatedFiles: [],
    signal: params.signal,
  }

  return {
    config, outputConfig, provider: endpoint.kind, runtime,
    options: {
      toolRuntime: runtime,
      outputVariables: outputConfig.variables,
      strictOutputs: outputConfig.strict_outputs,
      maxRunTokens: outputConfig.limits.max_run_tokens,
      maxToolCalls: outputConfig.limits.max_tool_calls,
      approvalTools: outputConfig.approval.tools,
      maxDurationMs: intSetting(params.overrides?.maxDurationMs, 300_000, 1_000, AGENT_CAPS.maxDurationMs),
    },
  }
}

/**
 * Refuse a run when the agent's or the workspace's token / cost budget (day:
 * rolling 24 hours, month: calendar month UTC) is spent (lib/agents/costs.ts).
 */
export async function checkDailyBudget(db: SupabaseClient, tenantId: string, agentId: string, outputConfig: NormalizedAgentOutputConfig): Promise<void> {
  const { checkBudgets, BudgetExceededError } = await import('./costs')
  try {
    await checkBudgets(db, tenantId, agentId, outputConfig)
  } catch (error) {
    if (error instanceof BudgetExceededError) throw new AgentRunError(error.message, 429, 'budget')
    throw error
  }
}
