/** What an agent may do with one data table. */
export interface AgentTableGrant {
  table_id: string
  read: boolean
  insert: boolean
  update: boolean
  delete: boolean
}

export type AgentTableOperation = 'read' | 'insert' | 'update' | 'delete'

/**
 * An agent's data-table access (migration 20261124000000):
 *  - `none` (the default for new agents): no data-table tools at all;
 *  - `selected`: explicit per-table grants (read / insert / update / delete);
 *  - `all`: every table of the workspace with read / insert / update — only
 *    kept for agents that had it before per-table grants existed
 *    (`legacy: true`, set by the migration and by imports of older files);
 *    new agents cannot be given it.
 * `table_ids` lists the granted tables (compatibility with older readers).
 */
export interface AgentTableAccessScope {
  mode: 'none' | 'selected' | 'all'
  table_ids: string[]
  grants: AgentTableGrant[]
  legacy?: boolean
}

export interface AgentWorkflowAccessScope {
  mode: 'all' | 'selected'
  workflow_ids: string[]
}

export interface AgentTaskAccessScope {
  mode: 'all' | 'selected'
  team_ids: string[]
  workflow_ids: string[]
}

export type AgentOutputType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'

export interface AgentOutputVariableConfig {
  name: string
  description: string
  type: string
  /** A completed run must produce it (non-null). Default false. */
  required?: boolean
  /** Allowed values (string outputs). */
  enum?: string[]
}

/** Per-agent spend / loop limits (0 / absent = no limit beyond the platform caps). */
export interface AgentLimits {
  /** Total tokens one run may use (all LLM calls of the loop). */
  max_run_tokens: number
  /** Tool calls one run may make. */
  max_tool_calls: number
  /** Tokens this agent may use per rolling 24 hours (all runs). */
  daily_token_budget: number
  /** Tokens this agent may use per calendar month (UTC). */
  monthly_token_budget: number
  /** Cost this agent may spend per rolling 24 hours, in budget_currency (priced runs only). */
  daily_cost_budget: number
  /** Cost this agent may spend per calendar month (UTC), in budget_currency. */
  monthly_cost_budget: number
  /** ISO 4217 code the cost budgets are in (default USD). */
  budget_currency: string
}

/** Tool calls that need a person's approval (a task) before they run. */
export interface AgentApprovalConfig {
  /** Tool names needing approval. `*` = every tool except read-only built-ins. */
  tools: string[]
  /** Who reviews: a user, else a team, else the agent's creator. */
  assignee_user_id: string | null
  assignee_team_id: string | null
}

/** Outbound HTTP from agent tools (http_get / http_post / download / read_* URL tools). */
export interface AgentEgressConfig {
  /** Hostnames the agent's URL tools may reach (`*.example.com` allowed). Empty = any public host. */
  allowed_hosts: string[]
}

/** A document uploaded as agent knowledge (stored file object). */
export interface AgentKnowledgeFile {
  name: string
  url: string
  path?: string
  ref?: string
  size?: number
  mime_type?: string
}

/** Retrieval sources for the search_knowledge / read_knowledge_document tools. */
export interface AgentKnowledgeConfig {
  /** Data tables searched by keyword. */
  table_ids: string[]
  /** Uploaded documents (PDF, Word, Excel, text, …) searched by passage. */
  files: AgentKnowledgeFile[]
}

export interface NormalizedAgentOutputConfig {
  variables: AgentOutputVariableConfig[]
  /** Fail the run when declared outputs are missing / invalid after one repair attempt. */
  strict_outputs: boolean
  limits: AgentLimits
  approval: AgentApprovalConfig
  egress: AgentEgressConfig
  knowledge: AgentKnowledgeConfig
  data_access: AgentTableAccessScope
  document_access: boolean
  /** Media tools (transcribe_media, analyze_image) through this workspace integration. */
  media_access: AgentMediaAccess
  workflow_access: boolean
  workflow_scope: AgentWorkflowAccessScope
  task_access: boolean
  task_scope: AgentTaskAccessScope
}

export interface AgentMediaAccess {
  enabled: boolean
  /** The media-capable integration (lib/media/catalog) the tools use. */
  integration_id: string | null
}

export interface AgentBuiltinToolOptions {
  includeSharedContext?: boolean
}

/**
 * Sanitize an agent name into the prefix used for its structured output variables
 * ({{prefix_outputName}}). Shared by the workflow canvas UI and the engine so the
 * variable names they generate can never drift apart.
 */
export function agentOutputPrefix(name: string | null | undefined): string {
  return String(name ?? 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30) || 'agent'
}

function knowledgeFiles(value: unknown): AgentKnowledgeFile[] {
  if (!Array.isArray(value)) return []
  const out: AgentKnowledgeFile[] = []
  for (const entry of value.slice(0, 50)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const url = typeof e.url === 'string' ? e.url : ''
    const name = typeof e.name === 'string' ? e.name.slice(0, 200) : ''
    if (!url || !name) continue
    out.push({
      name, url,
      ...(typeof e.path === 'string' ? { path: e.path } : {}),
      ...(typeof e.ref === 'string' ? { ref: e.ref } : {}),
      ...(Number.isFinite(Number(e.size)) ? { size: Number(e.size) } : {}),
      ...(typeof e.mime_type === 'string' ? { mime_type: e.mime_type } : {}),
    })
  }
  return out
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean)))
}

/**
 * The prefix of a Run Agent step's prefixed output variables
 * ({{prefix_output}}): the step's Output Prefix, else the agent's name —
 * what the engine sets (lib/agents/run.ts), so the canvas advertises the
 * same names.
 */
export function runAgentOutputPrefix(config: { _output_prefix?: unknown; agent_name?: unknown } | null | undefined): string {
  const explicit = typeof config?._output_prefix === 'string' ? config._output_prefix.trim() : ''
  return explicit || agentOutputPrefix(typeof config?.agent_name === 'string' ? config.agent_name : null)
}

function nonNegMoney(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, 1_000_000_000) : 0
}

/** An ISO 4217-shaped currency code (3 letters), default USD. */
export function currencyCode(v: unknown): string {
  const code = String(v ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : 'USD'
}

const GRANT_OPS: readonly AgentTableOperation[] = ['read', 'insert', 'update', 'delete']

/**
 * Normalise data_access. Absent / unknown → `none` (fail closed). The old
 * `selected` shape (table_ids without grants) keeps its old meaning: read,
 * insert and update on each listed table. `all` is preserved (legacy).
 */
export function normalizeDataAccess(value: any): AgentTableAccessScope {
  if (value?.mode === 'all') return { mode: 'all', table_ids: [], grants: [], legacy: true }
  const byTable = new Map<string, AgentTableGrant>()
  if (Array.isArray(value?.grants)) {
    for (const g of value.grants.slice(0, 500)) {
      const id = String(g?.table_id ?? '').trim()
      if (!id) continue
      const prev = byTable.get(id) ?? { table_id: id, read: false, insert: false, update: false, delete: false }
      for (const op of GRANT_OPS) if (g?.[op] === true) prev[op] = true
      byTable.set(id, prev)
    }
  } else if (value?.mode === 'selected' && Array.isArray(value?.table_ids)) {
    for (const raw of value.table_ids.slice(0, 500)) {
      const id = String(raw ?? '').trim()
      if (id) byTable.set(id, { table_id: id, read: true, insert: true, update: true, delete: false })
    }
  }
  const grants = Array.from(byTable.values()).filter((g) => GRANT_OPS.some((op) => g[op]))
  if (grants.length === 0) return { mode: 'none', table_ids: [], grants: [] }
  return { mode: 'selected', table_ids: grants.map((g) => g.table_id), grants, ...(value?.legacy === true ? { legacy: true } : {}) }
}

/** May the agent do `op` on this table? (`all` = read / insert / update on every table.) */
export function agentTableAllows(access: AgentTableAccessScope, tableId: string, op: AgentTableOperation): boolean {
  if (access.mode === 'all') return op !== 'delete'
  if (access.mode !== 'selected') return false
  const grant = access.grants.find((g) => g.table_id === tableId)
  return Boolean(grant?.[op])
}

/** Operations granted on at least one table (decides which data tools the model gets). */
export function agentDataOperations(access: AgentTableAccessScope): Set<AgentTableOperation> {
  if (access.mode === 'all') return new Set(['read', 'insert', 'update'])
  const ops = new Set<AgentTableOperation>()
  if (access.mode === 'selected') for (const g of access.grants) for (const op of GRANT_OPS) if (g[op]) ops.add(op)
  return ops
}

/** Data-table tool per operation. */
export const DATA_TOOL_FOR_OPERATION: Record<AgentTableOperation, string> = {
  read: 'query_data_table', insert: 'insert_data_row', update: 'update_data_rows', delete: 'delete_data_rows',
}

export function normalizeAgentOutputConfig(value: any): NormalizedAgentOutputConfig {
  const variables: AgentOutputVariableConfig[] = Array.isArray(value?.variables)
    ? value.variables
        .map((entry: any) => {
          const out: AgentOutputVariableConfig = {
            name: String(entry?.name ?? '').trim(),
            description: String(entry?.description ?? '').trim(),
            type: String(entry?.type ?? 'string').trim() || 'string',
          }
          if (entry?.required === true) out.required = true
          const enumValues = stringList(entry?.enum)
          if (enumValues.length) out.enum = enumValues
          return out
        })
        .filter((entry: AgentOutputVariableConfig) => entry.name)
    : []
  const nonNegInt = (v: unknown, max: number) => {
    const n = Math.floor(Number(v))
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
  }

  const dataAccess = normalizeDataAccess(value?.data_access)
  const workflowAccess = value?.workflow_access === true
  const workflowAccessMode = value?.workflow_scope?.mode === 'selected' ? 'selected' : 'all'
  const workflowAccessIds = Array.isArray(value?.workflow_scope?.workflow_ids)
    ? value.workflow_scope.workflow_ids.map((entry: any) => String(entry ?? '').trim()).filter(Boolean)
    : []
  const taskAccess = value?.task_access === true
  const taskAccessMode = value?.task_scope?.mode === 'selected' ? 'selected' : 'all'
  const taskScopeTeamIds = Array.isArray(value?.task_scope?.team_ids)
    ? value.task_scope.team_ids.map((entry: any) => String(entry ?? '').trim()).filter(Boolean)
    : []
  const taskScopeWorkflowIds = Array.isArray(value?.task_scope?.workflow_ids)
    ? value.task_scope.workflow_ids.map((entry: any) => String(entry ?? '').trim()).filter(Boolean)
    : []

  const approvalTools = stringList(value?.approval?.tools)
  return {
    variables,
    strict_outputs: value?.strict_outputs === true,
    limits: {
      max_run_tokens: nonNegInt(value?.limits?.max_run_tokens, 10_000_000),
      max_tool_calls: nonNegInt(value?.limits?.max_tool_calls, 1_000),
      daily_token_budget: nonNegInt(value?.limits?.daily_token_budget, 1_000_000_000),
      monthly_token_budget: nonNegInt(value?.limits?.monthly_token_budget, 100_000_000_000),
      daily_cost_budget: nonNegMoney(value?.limits?.daily_cost_budget),
      monthly_cost_budget: nonNegMoney(value?.limits?.monthly_cost_budget),
      budget_currency: currencyCode(value?.limits?.budget_currency),
    },
    approval: {
      tools: approvalTools,
      assignee_user_id: String(value?.approval?.assignee_user_id ?? '').trim() || null,
      assignee_team_id: String(value?.approval?.assignee_team_id ?? '').trim() || null,
    },
    egress: {
      allowed_hosts: stringList(value?.egress?.allowed_hosts).map((h) => h.toLowerCase()),
    },
    knowledge: {
      table_ids: stringList(value?.knowledge?.table_ids),
      files: knowledgeFiles(value?.knowledge?.files),
    },
    data_access: dataAccess,
    document_access: value?.document_access === true,
    media_access: {
      enabled: value?.media_access?.enabled === true,
      integration_id: String(value?.media_access?.integration_id ?? '').trim() || null,
    },
    workflow_access: workflowAccess,
    workflow_scope: {
      mode: workflowAccessMode,
      workflow_ids: workflowAccessMode === 'selected' ? Array.from(new Set(workflowAccessIds)) : [],
    },
    task_access: taskAccess,
    task_scope: {
      mode: taskAccessMode,
      team_ids: taskAccessMode === 'selected' ? Array.from(new Set(taskScopeTeamIds)) : [],
      workflow_ids: taskAccessMode === 'selected' ? Array.from(new Set(taskScopeWorkflowIds)) : [],
    },
  }
}

export function buildAgentAccessPrompt(config: NormalizedAgentOutputConfig, tableNames: string[] = []) {
  const lines: string[] = []

  if (config.data_access.mode === 'selected') {
    lines.push(
      tableNames.length > 0
        ? `Data access is limited to these approved tables (and the operations granted on each): ${tableNames.join(', ')}.`
        : 'Data access is limited to an approved subset of tables selected for this agent.',
    )
  } else if (config.data_access.mode === 'all') {
    lines.push('Data access can read, add and update rows in any table of this workspace.')
  }

  if (config.task_access) {
    if (config.task_scope.mode === 'selected') {
      lines.push('Task access is enabled, but limited to specific approved teams, workflows, or apps selected for this agent.')
    } else {
      lines.push('Task access is enabled. You may inspect tasks and, when appropriate, respond to, complete, escalate, or redirect tasks.')
    }
  }
  if (config.workflow_access) {
    if (config.workflow_scope.mode === 'selected') {
      lines.push('Workflow access is enabled, but limited to specific approved workflows selected for this agent.')
    } else {
      lines.push('Workflow access is enabled. You may start approved workflows, inspect workflow run status, and complete waiting server events when needed.')
    }
  }
  if (config.knowledge.table_ids.length > 0 || config.knowledge.files.length > 0) {
    lines.push('Knowledge sources are attached. Use search_knowledge to find relevant passages before answering questions they may cover, and cite the source names you used.')
  }
  if (config.document_access) {
    lines.push('Document and file utility access is enabled. You may use the supported file/document helpers when needed.')
  }
  if (config.media_access.enabled && config.media_access.integration_id) {
    lines.push('Media access is enabled: transcribe_media turns an audio or video file into text, analyze_image describes an image and reads its text. Files are sent to the workspace\'s AI media provider.')
  }

  return lines.length > 0 ? `\n${lines.join('\n')}` : ''
}

export function getAgentBuiltinToolNames(
  config: NormalizedAgentOutputConfig,
  options: AgentBuiltinToolOptions = {},
) {
  const builtinToolNames = ['calculate', 'current_datetime']

  const dataOps = agentDataOperations(config.data_access)
  for (const op of GRANT_OPS) if (dataOps.has(op)) builtinToolNames.push(DATA_TOOL_FOR_OPERATION[op])
  if (config.knowledge.table_ids.length > 0 || config.knowledge.files.length > 0) {
    builtinToolNames.push('search_knowledge')
    if (config.knowledge.files.length > 0) builtinToolNames.push('read_knowledge_document')
  }
  if (config.document_access) builtinToolNames.push(
    'generate_excel',
    'read_csv_file',
    'download_file',
    'read_file_content',
  )
  if (config.media_access.enabled && config.media_access.integration_id) builtinToolNames.push('transcribe_media', 'analyze_image')
  if (config.task_access) builtinToolNames.push(
    'get_task_status',
    'respond_to_task',
    'complete_task',
    'complete_workflow_task',
    'escalate_task',
    'redirect_task',
  )
  if (config.workflow_access) builtinToolNames.push('start_workflow_run', 'get_workflow_run_status', 'complete_server_event')
  if (options.includeSharedContext) builtinToolNames.push('read_shared_facts', 'write_shared_fact')

  return Array.from(new Set(builtinToolNames))
}
