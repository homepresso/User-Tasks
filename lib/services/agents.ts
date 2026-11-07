/**
 * AI agents — the one implementation behind the designer (server actions),
 * REST /api/v1/agents, the MCP agent tools and the CLI (through REST).
 *
 * Writes use the service role after the permission check: since
 * 20261122000000 end users have no write grants on agents / agent_runs /
 * agent_queue (they could otherwise rewrite any agent of their workspace, or
 * enqueue jobs acting as someone else).
 *
 * Every save:
 *  - keeps only the agent's own fields (no tenant_id / created_by / id);
 *  - validates them: the AI provider integration, reference tools and MCP
 *    tools must belong to this workspace (an agent could otherwise spend
 *    another workspace's API key or call its MCP servers), tool names are
 *    unique and provider-valid, reference tools get the reference's inputs
 *    as their parameters, numbers are clamped, output_config is normalised;
 *  - bumps agents.version and snapshots it in agent_versions (restorable);
 *  - writes an audit row and a GitHub-sync change.
 *
 * Deletes go through the deletion queue on every surface (referencing
 * workflows are deactivated first).
 */
import { BUILTIN_TOOL_DEFS, type AgentTool } from '@/lib/agent-tool-defs'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { deactivateWorkflowsReferencingAgent } from '@/lib/agent-references'
import { AGENT_CAPS } from '@/lib/agents/prepare'
import { normalizeExpectations } from '@/lib/agents/evals'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, queueDeletion, resolvePage, serviceRoleClient, syncChange, type PageInput } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- agent rows are untyped here */

/** Fields an agent save may set (everything else is ignored). */
export const AGENT_FIELDS = [
  'name', 'description', 'integration_id', 'model', 'system_prompt', 'role', 'task', 'boundaries',
  'tools', 'output_config', 'temperature', 'max_tokens', 'max_iterations', 'is_active', 'tags',
] as const
type AgentField = (typeof AGENT_FIELDS)[number]
export type AgentInput = Partial<Record<AgentField, any>>

const SNAPSHOT_FIELDS: readonly string[] = AGENT_FIELDS
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function snapshotOf(agent: Record<string, any>): Record<string, any> {
  return Object.fromEntries(SNAPSHOT_FIELDS.map((k) => [k, agent[k] ?? null]))
}

function toolSlug(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64) || 'tool'
}

function referenceInputSchema(inputs: unknown): AgentTool['inputSchema'] {
  if (!Array.isArray(inputs)) return []
  return inputs
    .filter((i: any) => i && typeof i.name === 'string' && TOOL_NAME.test(i.name))
    .slice(0, 50)
    .map((i: any) => ({
      name: i.name,
      type: ['number', 'integer', 'boolean', 'array', 'object'].includes(String(i.type)) ? String(i.type) : 'string',
      description: String(i.description ?? i.label ?? i.name).slice(0, 300),
      ...(i.required ? { required: true } : {}),
    }))
}

/**
 * Validate and normalise the fields of an agent save. Throws a 400
 * ServiceError naming the first problem.
 */
export async function validateAgentFields(db: AnySupabaseClient, tenantId: string, input: AgentInput, options: { existingDataAccessMode?: string | null } = {}): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  for (const key of AGENT_FIELDS) if (key in input && input[key] !== undefined) out[key] = input[key]

  if ('name' in out) {
    out.name = String(out.name ?? '').trim()
    if (!out.name) throw ServiceError.validation('name is required')
    if (out.name.length > 200) throw ServiceError.validation('name must be at most 200 characters')
  }
  for (const key of ['description', 'system_prompt', 'role', 'task', 'boundaries'] as const) {
    if (key in out) out[key] = out[key] === null ? (key === 'description' ? null : '') : String(out[key]).slice(0, 50_000)
  }
  if ('model' in out) out.model = String(out.model ?? '').trim().slice(0, 200)
  if ('is_active' in out) out.is_active = out.is_active !== false
  if ('tags' in out) out.tags = Array.isArray(out.tags) ? out.tags.map((t: unknown) => String(t).slice(0, 50)).slice(0, 30) : null
  if ('temperature' in out) {
    if (out.temperature === null || out.temperature === '') out.temperature = null
    else {
      const t = Number(out.temperature)
      if (!Number.isFinite(t) || t < 0 || t > 2) throw ServiceError.validation('temperature must be between 0 and 2')
      out.temperature = t
    }
  }
  if ('max_tokens' in out) {
    const n = Math.floor(Number(out.max_tokens))
    if (!Number.isFinite(n) || n < 1 || n > AGENT_CAPS.maxTokens) throw ServiceError.validation(`max_tokens must be 1–${AGENT_CAPS.maxTokens}`)
    out.max_tokens = n
  }
  if ('max_iterations' in out) {
    const n = Math.floor(Number(out.max_iterations))
    if (!Number.isFinite(n) || n < 1 || n > AGENT_CAPS.maxIterations) throw ServiceError.validation(`max_iterations must be 1–${AGENT_CAPS.maxIterations}`)
    out.max_iterations = n
  }

  if ('integration_id' in out) {
    const id = out.integration_id ? String(out.integration_id).trim() : null
    if (id) {
      const { data } = await (db as any).from('integrations').select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
      if (!data) throw ServiceError.validation('integration_id is not an integration of this workspace')
    }
    out.integration_id = id
  }

  if ('output_config' in out) {
    const config = normalizeAgentOutputConfig(out.output_config ?? {})
    const ids = async (table: string, list: string[]) => {
      if (list.length === 0) return list
      const { data } = await (db as any).from(table).select('id').eq('tenant_id', tenantId).in('id', list.filter((id) => UUID.test(id)))
      const found = new Set((data ?? []).map((r: any) => String(r.id)))
      return list.filter((id) => found.has(id))
    }
    // Per-table grants: only this workspace's tables. "All tables" (legacy)
    // can be kept by an agent that has it, never newly given.
    if (config.data_access.mode === 'all' && options.existingDataAccessMode !== 'all') {
      throw ServiceError.validation('Data access to all tables is no longer available for new grants — grant each table (read / insert / update / delete) in data_access.grants')
    }
    if (config.data_access.mode === 'selected') {
      const kept = new Set(await ids('custom_tables', config.data_access.table_ids))
      config.data_access.grants = config.data_access.grants.filter((g) => kept.has(g.table_id))
      config.data_access.table_ids = config.data_access.grants.map((g) => g.table_id)
      if (config.data_access.grants.length === 0) config.data_access = { mode: 'none', table_ids: [], grants: [] }
    }
    config.knowledge.table_ids = await ids('custom_tables', config.knowledge.table_ids)
    config.workflow_scope.workflow_ids = await ids('workflows', config.workflow_scope.workflow_ids)
    config.task_scope.workflow_ids = await ids('workflows', config.task_scope.workflow_ids)
    config.task_scope.team_ids = await ids('teams', config.task_scope.team_ids)
    if (config.approval.assignee_user_id) {
      const { data } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('user_id', config.approval.assignee_user_id).maybeSingle()
      if (!data) throw ServiceError.validation('The approval reviewer must be a member of this workspace')
    }
    if (config.approval.assignee_team_id && (await ids('teams', [config.approval.assignee_team_id])).length === 0) {
      throw ServiceError.validation('The approval team is not a team of this workspace')
    }
    out.output_config = config
  }

  if ('tools' in out) out.tools = await validateTools(db, tenantId, out.tools)
  return out
}

/** Normalise an agent's tools; references / MCP servers must be this workspace's. */
export async function validateTools(db: AnySupabaseClient, tenantId: string, value: unknown): Promise<AgentTool[]> {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw ServiceError.validation('tools must be an array')
  if (value.length > 128) throw ServiceError.validation('An agent can have at most 128 tools')
  const tools: AgentTool[] = []
  const names = new Set<string>()
  const referenceIds: string[] = []
  const mcpIds: string[] = []

  for (const raw of value) {
    // Legacy MCP / API shape: a bare reference id.
    const entry: any = typeof raw === 'string' ? { type: 'reference', referenceId: raw } : raw
    if (!entry || typeof entry !== 'object') throw ServiceError.validation('Each tool must be an object')
    const type = String(entry.type ?? '')
    if (!['builtin', 'reference', 'mcp'].includes(type)) throw ServiceError.validation(`Tool type "${type}" is not supported (builtin, reference or mcp)`)
    const tool: AgentTool = {
      id: String(entry.id ?? crypto.randomUUID()),
      type: type as AgentTool['type'],
      name: String(entry.name ?? '').trim(),
      description: String(entry.description ?? '').slice(0, 1024),
      ...(entry.requiresApproval === true ? { requiresApproval: true } : {}),
    }
    if (type === 'builtin') {
      const def = BUILTIN_TOOL_DEFS.find((d) => d.name === tool.name)
      if (!def) throw ServiceError.validation(`Unknown built-in tool "${tool.name}"`)
      Object.assign(tool, { description: def.description, inputSchema: def.inputSchema, id: tool.id || def.id })
    } else if (type === 'reference') {
      const refId = String(entry.referenceId ?? entry.reference_id ?? '').trim()
      if (!UUID.test(refId)) throw ServiceError.validation('A reference tool needs referenceId')
      tool.referenceId = refId
      referenceIds.push(refId)
      if (Array.isArray(entry.inputSchema) && entry.inputSchema.length) tool.inputSchema = referenceInputSchema(entry.inputSchema)
    } else {
      const serverId = String(entry.mcpServerId ?? entry.mcp_server_id ?? '').trim()
      const toolName = String(entry.mcpToolName ?? entry.mcp_tool_name ?? '').trim()
      if (!UUID.test(serverId) || !toolName) throw ServiceError.validation('An MCP tool needs mcpServerId and mcpToolName')
      tool.mcpServerId = serverId
      tool.mcpToolName = toolName
      if (!tool.name) tool.name = toolSlug(toolName)
      mcpIds.push(serverId)
      if (Array.isArray(entry.inputSchema)) tool.inputSchema = referenceInputSchema(entry.inputSchema)
    }
    tools.push(tool)
  }

  if (referenceIds.length) {
    const { data } = await (db as any).from('integration_references').select('id, name, description, inputs').eq('tenant_id', tenantId).in('id', Array.from(new Set(referenceIds)))
    const byId = new Map((data ?? []).map((r: any) => [String(r.id), r]))
    for (const tool of tools.filter((t) => t.type === 'reference')) {
      const ref: any = byId.get(String(tool.referenceId))
      if (!ref) throw ServiceError.validation(`Reference ${tool.referenceId} is not a reference of this workspace`)
      if (!tool.name) tool.name = toolSlug(ref.name)
      if (!tool.description) tool.description = String(ref.description || `Call ${ref.name}`).slice(0, 1024)
      // The reference's inputs are the tool's parameters (an empty schema meant the model could never pass any).
      if (!tool.inputSchema?.length) tool.inputSchema = referenceInputSchema(ref.inputs)
    }
  }
  if (mcpIds.length) {
    const { data } = await (db as any).from('mcp_servers').select('id').eq('tenant_id', tenantId).in('id', Array.from(new Set(mcpIds)))
    const found = new Set((data ?? []).map((r: any) => String(r.id)))
    const missing = mcpIds.find((id) => !found.has(id))
    if (missing) throw ServiceError.validation(`MCP server ${missing} is not an MCP server of this workspace`)
  }
  for (const tool of tools) {
    if (!TOOL_NAME.test(tool.name)) throw ServiceError.validation(`Tool name "${tool.name}" must be 1–64 letters, numbers, _ or -`)
    if (names.has(tool.name)) throw ServiceError.validation(`Two tools are named "${tool.name}" — tool names must be unique`)
    names.add(tool.name)
  }
  return tools
}

async function loadAgent(db: AnySupabaseClient, tenantId: string, id: string): Promise<Record<string, any>> {
  const { data, error } = await (db as any).from('agents').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Agent not found')
  return data
}

async function snapshot(db: AnySupabaseClient, ctx: ServiceContext, agent: Record<string, any>, note: string | null) {
  const { error } = await (db as any).from('agent_versions').upsert({
    tenant_id: ctx.tenantId, agent_id: agent.id, version: agent.version ?? 1, snapshot: snapshotOf(agent), note, created_by: ctx.actorId,
  }, { onConflict: 'agent_id,version', ignoreDuplicates: true })
  if (error) console.warn('[agents] version snapshot failed:', error.message)
}

export async function createAgent(ctx: ServiceContext, input: AgentInput): Promise<Record<string, any>> {
  requirePerm(ctx, 'agents.create')
  const db = await serviceRoleClient(ctx)
  const fields = await validateAgentFields(db, ctx.tenantId, { ...input, name: input.name })
  const row = {
    tenant_id: ctx.tenantId,
    created_by: ctx.actorId,
    name: fields.name,
    description: fields.description ?? null,
    integration_id: fields.integration_id ?? null,
    model: fields.model ?? '',
    system_prompt: fields.system_prompt ?? '',
    role: fields.role ?? '',
    task: fields.task ?? '',
    boundaries: fields.boundaries ?? '',
    tools: fields.tools ?? [],
    output_config: fields.output_config ?? normalizeAgentOutputConfig({ variables: [] }),
    temperature: 'temperature' in fields ? fields.temperature : 0.7,
    max_tokens: fields.max_tokens ?? 4096,
    max_iterations: fields.max_iterations ?? 10,
    is_active: fields.is_active ?? true,
    ...(fields.tags ? { tags: fields.tags } : {}),
    version: 1,
  }
  const { data, error } = await (db as any).from('agents').insert(row).select('*').single()
  if (error) throw dbError(error)
  await snapshot(db, ctx, data, 'Created')
  await audit(ctx, { objectType: 'agent', objectId: data.id, action: 'create', summary: `Created agent "${data.name}"` })
  void syncChange(ctx, 'agent', { id: data.id, name: data.name })
  return data
}

export async function updateAgent(ctx: ServiceContext, agentId: string, input: AgentInput, options: { note?: string | null; action?: string } = {}): Promise<Record<string, any>> {
  requirePerm(ctx, 'agents.edit')
  const db = await serviceRoleClient(ctx)
  const existing = await loadAgent(db, ctx.tenantId, agentId)
  const fields = await validateAgentFields(db, ctx.tenantId, input, { existingDataAccessMode: normalizeAgentOutputConfig(existing.output_config).data_access.mode })
  const changed = Object.keys(fields).filter((k) => JSON.stringify(fields[k] ?? null) !== JSON.stringify(existing[k] ?? null))
  if (changed.length === 0) return existing
  // History starts with the state before the first tracked change.
  await snapshot(db, ctx, existing, null)
  const version = (Number(existing.version) || 1) + 1
  const { data, error } = await (db as any).from('agents')
    .update({ ...fields, version, updated_at: new Date().toISOString() })
    .eq('id', agentId).eq('tenant_id', ctx.tenantId).select('*').single()
  if (error) throw dbError(error)
  await snapshot(db, ctx, data, options.note ?? null)
  await audit(ctx, {
    objectType: 'agent', objectId: agentId, action: options.action ?? 'update',
    summary: `${options.action === 'restore' ? 'Restored' : 'Updated'} agent "${data.name}" (version ${version})`,
    metadata: { changed, version },
  })
  void syncChange(ctx, 'agent', { id: agentId, name: data.name })
  return data
}

export async function deleteAgent(ctx: ServiceContext, agentId: string): Promise<{ deleted: true; queued: true; deactivated_workflows: Array<{ id: string; name: string }> }> {
  requirePerm(ctx, 'agents.delete')
  const db = await serviceRoleClient(ctx)
  const agent = await loadAgent(db, ctx.tenantId, agentId)
  const deactivated = await deactivateWorkflowsReferencingAgent(db, ctx.tenantId, agentId)
  await queueDeletion(ctx, 'agent', agentId, { name: agent.name ?? null })
  await audit(ctx, {
    objectType: 'agent', objectId: agentId, action: 'delete', summary: `Queued deletion for agent "${agent.name}"`,
    ...(deactivated.length ? { metadata: { deactivated_workflows: deactivated } } : {}),
  })
  void syncChange(ctx, 'agent', { id: agentId, name: agent.name }, 'delete')
  return { deleted: true, queued: true, deactivated_workflows: deactivated }
}

/* ── Versions ── */

export async function listAgentVersions(ctx: ServiceContext, agentId: string) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const agent = await loadAgent(db, ctx.tenantId, agentId)
  const { data, error } = await (db as any).from('agent_versions').select('id, version, note, created_by, created_at, snapshot')
    .eq('tenant_id', ctx.tenantId).eq('agent_id', agentId).order('version', { ascending: false }).limit(100)
  if (error) throw dbError(error)
  return { current_version: Number(agent.version) || 1, versions: data ?? [] }
}

export async function restoreAgentVersion(ctx: ServiceContext, agentId: string, version: number) {
  requirePerm(ctx, 'agents.edit')
  const db = await serviceRoleClient(ctx)
  const { data: row } = await (db as any).from('agent_versions').select('snapshot, version')
    .eq('tenant_id', ctx.tenantId).eq('agent_id', agentId).eq('version', Math.floor(Number(version))).maybeSingle()
  if (!row) throw ServiceError.notFound(`Version ${version} not found`)
  const snapshot = { ...(row.snapshot ?? {}) }
  let note = `Restored version ${row.version}`
  // An old snapshot with "all tables" never re-broadens an agent that was narrowed since.
  const current = await loadAgent(db, ctx.tenantId, agentId)
  const currentAccess = normalizeAgentOutputConfig(current.output_config).data_access
  if (snapshot.output_config && normalizeAgentOutputConfig(snapshot.output_config).data_access.mode === 'all' && currentAccess.mode !== 'all') {
    snapshot.output_config = { ...snapshot.output_config, data_access: currentAccess }
    note += ' (kept the current per-table data grants)'
  }
  return updateAgent(ctx, agentId, snapshot, { note, action: 'restore' })
}

/* ── Runs / queue ── */

export async function enqueueAgentRun(ctx: ServiceContext, agentId: string, input: { message: string; shared_context?: unknown; max_iterations?: unknown }) {
  requirePerm(ctx, 'agents.test')
  const message = String(input.message ?? '')
  if (!message.trim()) throw ServiceError.validation('message is required')
  const db = await serviceRoleClient(ctx)
  const agent = await loadAgent(db, ctx.tenantId, agentId)
  if (agent.is_active === false) throw ServiceError.validation('Agent is inactive')
  const { data, error } = await (db as any).from('agent_queue').insert({
    agent_id: agentId, tenant_id: ctx.tenantId, input_message: message.slice(0, 100_000),
    shared_context: input.shared_context && typeof input.shared_context === 'object' ? input.shared_context : null,
    created_by: ctx.actorId, status: 'pending', kind: 'run',
    options: { acting_user_id: ctx.actorId, ...(input.max_iterations !== undefined ? { max_iterations: input.max_iterations } : {}) },
  }).select('id, status, created_at').single()
  if (error) throw dbError(error)
  const { kickAgentQueueProcessor } = await import('@/lib/process-queue')
  kickAgentQueueProcessor(1)
  return { queued: true, job_id: data.id, status: data.status }
}

export async function getAgentQueueJob(ctx: ServiceContext, jobId: string) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const { data } = await (db as any).from('agent_queue')
    .select('id, agent_id, kind, status, input_message, attempts, error, result, run_id, created_at, started_at, completed_at')
    .eq('id', jobId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!data) throw ServiceError.notFound('Job not found')
  return { job: data }
}

const RUN_LIST_COLUMNS = 'id, agent_id, status, model, iterations, total_tokens, input_tokens, output_tokens, cost_amount, cost_currency, cost_status, initiated_by, actor_id, duration_ms, caller_type, caller_id, trace_id, workflow_run_id, agent_version, error, started_at, completed_at, created_at'

export async function listAgentRuns(ctx: ServiceContext, filters: { agentId?: string | null; status?: string | null; callerType?: string | null } & PageInput = {}) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const page = resolvePage(filters)
  let q = (db as any).from('agent_runs').select(RUN_LIST_COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId).order('started_at', { ascending: false })
  if (filters.agentId) q = q.eq('agent_id', filters.agentId)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.callerType) q = q.eq('caller_type', filters.callerType)
  q = page.offset > 0 ? q.range(page.offset, page.offset + (page.limit ?? 50) - 1) : q.limit(page.limit ?? 50)
  const { data, count, error } = await q
  if (error) throw dbError(error)
  return { runs: data ?? [], total: count ?? 0 }
}

export async function getAgentRun(ctx: ServiceContext, runId: string) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const { data } = await (db as any).from('agent_runs').select('*').eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!data) throw ServiceError.notFound('Run not found')
  // The resumable state holds the conversation; callers get the pending call only.
  const paused = data.paused_context as any
  const { paused_context: _omit, ...run } = data
  return {
    run: {
      ...run,
      ...(paused ? { pending_approval: { tool: paused.pending?.tool ?? null, arguments: paused.pending?.arguments ?? null, task_id: paused.approval_task_id ?? null } } : {}),
    },
  }
}

/** Tokens and cost of an agent per day (last `days` days), last 24 hours, this month and its budgets. */
export async function agentUsage(ctx: ServiceContext, agentId: string, days = 30) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const agent = await loadAgent(db, ctx.tenantId, agentId)
  const { agentUsageView } = await import('@/lib/agents/usage')
  return agentUsageView({ ...ctx, db, supabase: db }, agent, days)
}

/** Workspace agent usage (tokens + cost), per-agent totals, budgets and the price table in effect. */
export async function workspaceAgentUsage(ctx: ServiceContext, days = 30) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const { workspaceCostView } = await import('@/lib/agents/usage')
  return workspaceCostView({ ...ctx, db, supabase: db }, days)
}

/**
 * Workspace price overrides and budgets (settings.edit). Prices: a list of
 * {provider, model, input_per_1m, output_per_1m, cached_input_per_1m,
 * currency, effective_date} that win over the instance's and the shipped
 * list prices for this workspace's runs.
 */
export async function saveAgentCostSettings(ctx: ServiceContext, input: { model_prices?: unknown; budgets?: unknown }) {
  requirePerm(ctx, 'settings.edit')
  const db = await serviceRoleClient(ctx)
  const { normalizePriceList } = await import('@/lib/agents/pricing')
  const { loadCostSettings, normalizeWorkspaceBudgets } = await import('@/lib/agents/costs')
  const current = await loadCostSettings(db, ctx.tenantId)
  let prices = current.prices
  if (input.model_prices !== undefined) {
    const parsed = normalizePriceList(input.model_prices)
    if (parsed.errors.length) throw ServiceError.validation(`Invalid prices: ${parsed.errors.slice(0, 3).join('; ')}`)
    prices = parsed.prices
  }
  const budgets = input.budgets !== undefined ? normalizeWorkspaceBudgets(input.budgets) : current.budgets
  const { error } = await (db as any).from('agent_cost_settings').upsert({
    tenant_id: ctx.tenantId, model_prices: prices, budgets, updated_by: ctx.actorId, updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) throw dbError(error)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: 'Updated AI agent prices and budgets', metadata: { prices: prices.length, budgets },
  })
  return { model_prices: prices, budgets }
}

/* ── Evaluations ── */

export async function listEvalCases(ctx: ServiceContext, agentId: string) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  await loadAgent(db, ctx.tenantId, agentId)
  const { data, error } = await (db as any).from('agent_eval_cases').select('*').eq('tenant_id', ctx.tenantId).eq('agent_id', agentId).order('created_at')
  if (error) throw dbError(error)
  return { cases: data ?? [] }
}

export async function saveEvalCase(ctx: ServiceContext, agentId: string, input: { id?: string | null; name?: string; input_message?: string; expected?: unknown; is_active?: boolean }) {
  requirePerm(ctx, 'agents.edit')
  const db = await serviceRoleClient(ctx)
  await loadAgent(db, ctx.tenantId, agentId)
  const name = String(input.name ?? '').trim().slice(0, 200)
  const message = String(input.input_message ?? '')
  if (!name) throw ServiceError.validation('name is required')
  if (!message.trim()) throw ServiceError.validation('input_message is required')
  const row = { name, input_message: message.slice(0, 50_000), expected: normalizeExpectations(input.expected), is_active: input.is_active !== false, updated_at: new Date().toISOString() }
  if (input.id) {
    const { data, error } = await (db as any).from('agent_eval_cases').update(row).eq('id', input.id).eq('tenant_id', ctx.tenantId).eq('agent_id', agentId).select('*').maybeSingle()
    if (error) throw dbError(error)
    if (!data) throw ServiceError.notFound('Test case not found')
    return { case: data }
  }
  const { count } = await (db as any).from('agent_eval_cases').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenantId).eq('agent_id', agentId)
  if ((count ?? 0) >= 100) throw ServiceError.validation('An agent can have at most 100 test cases')
  const { data, error } = await (db as any).from('agent_eval_cases').insert({ ...row, tenant_id: ctx.tenantId, agent_id: agentId, created_by: ctx.actorId }).select('*').single()
  if (error) throw dbError(error)
  return { case: data }
}

export async function deleteEvalCase(ctx: ServiceContext, agentId: string, caseId: string) {
  requirePerm(ctx, 'agents.edit')
  const db = await serviceRoleClient(ctx)
  const { error } = await (db as any).from('agent_eval_cases').delete().eq('id', caseId).eq('tenant_id', ctx.tenantId).eq('agent_id', agentId)
  if (error) throw dbError(error)
  return { deleted: true }
}

export async function listEvalRuns(ctx: ServiceContext, agentId: string, limit = 20) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('agent_eval_runs').select('*').eq('tenant_id', ctx.tenantId).eq('agent_id', agentId)
    .order('started_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 100))
  if (error) throw dbError(error)
  return { runs: data ?? [] }
}

export async function getEvalRun(ctx: ServiceContext, evalRunId: string) {
  requirePerm(ctx, 'agents.view')
  const db = await serviceRoleClient(ctx)
  const { data } = await (db as any).from('agent_eval_runs').select('*').eq('id', evalRunId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!data) throw ServiceError.notFound('Evaluation run not found')
  return { run: data }
}

/**
 * Start a suite run (all active cases, or `caseIds`). The cases run after
 * the response (lib/agents/eval-runner.ts); poll getEvalRun.
 */
export async function startEvalRun(ctx: ServiceContext, agentId: string, input: { case_ids?: string[] } = {}) {
  requirePerm(ctx, 'agents.test')
  const db = await serviceRoleClient(ctx)
  const agent = await loadAgent(db, ctx.tenantId, agentId)
  let q = (db as any).from('agent_eval_cases').select('id').eq('tenant_id', ctx.tenantId).eq('agent_id', agentId).eq('is_active', true)
  if (Array.isArray(input.case_ids) && input.case_ids.length) q = q.in('id', input.case_ids)
  const { data: cases } = await q
  if (!cases?.length) throw ServiceError.validation('This agent has no active test cases')
  const { data: run, error } = await (db as any).from('agent_eval_runs').insert({
    tenant_id: ctx.tenantId, agent_id: agentId, agent_version: agent.version ?? 1, status: 'running', total: cases.length, created_by: ctx.actorId,
  }).select('*').single()
  if (error) throw dbError(error)
  const { startEvalRunner } = await import('@/lib/agents/eval-runner')
  startEvalRunner({ db, tenantId: ctx.tenantId, evalRunId: run.id, agentId, caseIds: cases.map((c: any) => c.id), actingUserId: ctx.actorId })
  return { run }
}
