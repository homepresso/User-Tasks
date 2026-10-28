export interface AgentTableAccessScope {
  mode: 'all' | 'selected'
  table_ids: string[]
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

export interface NormalizedAgentOutputConfig {
  variables: { name: string; description: string; type: string }[]
  data_access: AgentTableAccessScope
  document_access: boolean
  workflow_access: boolean
  workflow_scope: AgentWorkflowAccessScope
  task_access: boolean
  task_scope: AgentTaskAccessScope
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

export function normalizeAgentOutputConfig(value: any): NormalizedAgentOutputConfig {
  const variables = Array.isArray(value?.variables)
    ? value.variables
        .map((entry: any) => ({
          name: String(entry?.name ?? '').trim(),
          description: String(entry?.description ?? '').trim(),
          type: String(entry?.type ?? 'string').trim() || 'string',
        }))
        .filter((entry: any) => entry.name)
    : []

  const dataAccessMode = value?.data_access?.mode === 'selected' ? 'selected' : 'all'
  const dataAccessTableIds = Array.isArray(value?.data_access?.table_ids)
    ? value.data_access.table_ids.map((entry: any) => String(entry ?? '').trim()).filter(Boolean)
    : []
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

  return {
    variables,
    data_access: {
      mode: dataAccessMode,
      table_ids: dataAccessMode === 'selected' ? Array.from(new Set(dataAccessTableIds)) : [],
    },
    document_access: value?.document_access === true,
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
        ? `Data access is limited to these approved tables: ${tableNames.join(', ')}.`
        : 'Data access is limited to an approved subset of tables selected for this agent.',
    )
  } else {
    lines.push('Data access can use any tenant table when a data tool has been enabled for this agent.')
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
  if (config.document_access) {
    lines.push('Document and file utility access is enabled. You may use the supported file/document helpers when needed.')
  }

  return lines.length > 0 ? `\n${lines.join('\n')}` : ''
}

export function getAgentBuiltinToolNames(
  config: NormalizedAgentOutputConfig,
  options: AgentBuiltinToolOptions = {},
) {
  const builtinToolNames = ['calculate', 'current_datetime']

  if (config.data_access.mode === 'all' || config.data_access.table_ids.length > 0) {
    builtinToolNames.push('query_data_table', 'insert_data_row', 'update_data_rows')
  }
  if (config.document_access) builtinToolNames.push(
    'generate_word_document',
    'generate_excel',
    'read_csv_file',
    'download_file',
    'read_file_content',
  )
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
