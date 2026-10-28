// Normalization / clone helpers shared by the tenant-portability engine
// (export, import) and the MCP tools.

import { normalizeReportConfig } from '@/lib/report-config'
import { createDefaultNode, type NodeType } from '@/lib/workflow-schema'
import { isObjectLike } from '@/lib/utils/guards'

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isObjectBackedReference(reference: any) {
  return Boolean(reference?.request_config?.object_id)
    || String(reference?.request_config?._executor ?? '').trim() === 'object'
}

export function normalizeExpressionValue(value: unknown) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const WORKFLOW_TRIGGER_TYPES = new Set([
  'task_created',
  'task_received',
  'task_submitted',
  'task_updated',
  'task_completed',
  'task_rejected',
  'workflow_error',
  'retention_policy_review',
  'retention_policy_executed',
  'data_table_event',
  'form_submitted',
  'middleware_received',
  'schedule',
  'webhook_received',
  'manual',
])

const WORKFLOW_TRIGGER_LABELS: Record<string, string> = {
  task_created: 'Task Created',
  task_received: 'Task Received',
  task_submitted: 'Task Submitted',
  task_updated: 'Task Updated',
  task_completed: 'Task Completed',
  task_rejected: 'Task Rejected',
  workflow_error: 'Workflow Error',
  retention_policy_review: 'Policy Review',
  retention_policy_executed: 'Policy Executed',
  data_table_event: 'Data Table Event',
  form_submitted: 'Form Submitted',
  middleware_received: 'Middleware',
  schedule: 'Schedule',
  webhook_received: 'Webhook',
  manual: 'Manual Trigger',
}

function normalizeDecisionTableFieldForScaffold(field: any) {
  return {
    id: String(field?.id ?? '').trim() || crypto.randomUUID(),
    key: String(field?.key ?? field?.name ?? '').trim(),
    label: String(field?.label ?? field?.key ?? field?.name ?? '').trim() || String(field?.key ?? field?.name ?? '').trim(),
    type: String(field?.type ?? 'text').trim() || 'text',
  }
}

function parseLegacyDecisionConditionValue(raw: unknown) {
  const normalized = String(raw ?? '').trim()
  const comparisons: Array<[RegExp, string]> = [
    [/^>=\s*(.+)$/i, 'greater_than_or_equal'],
    [/^<=\s*(.+)$/i, 'less_than_or_equal'],
    [/^>\s*(.+)$/i, 'greater_than'],
    [/^<\s*(.+)$/i, 'less_than'],
    [/^!=\s*(.+)$/i, 'not_equals'],
    [/^contains:\s*(.+)$/i, 'contains'],
  ]
  for (const [pattern, operator] of comparisons) {
    const match = normalized.match(pattern)
    if (match) return { operator, value: match[1] ?? '' }
  }
  return { operator: 'equals', value: normalized }
}

function normalizeDecisionTableRuleForScaffold(rule: any) {
  const normalizedConditions = Array.isArray(rule?.conditions)
    ? rule.conditions.map((condition: any) => ({
        id: String(condition?.id ?? '').trim() || crypto.randomUUID(),
        inputKey: String(condition?.inputKey ?? condition?.input_key ?? '').trim(),
        operator: String(condition?.operator ?? 'equals').trim() || 'equals',
        value: condition?.value ?? '',
      }))
    : isObjectLike(rule?.conditions)
      ? Object.entries(rule.conditions).map(([inputKey, rawValue]) => {
          const parsed = parseLegacyDecisionConditionValue(rawValue)
          return {
            id: crypto.randomUUID(),
            inputKey,
            operator: parsed.operator,
            value: parsed.value,
          }
        })
      : []

  // Outputs — accept the canonical object form ({ key: value }) and
  // also the array form LLMs often emit ([{ key, value }] or
  // [{ outputKey, value }]) so the result values actually persist.
  // Previously anything that wasn't already a plain object was reset
  // to `{}` and the decision table shipped with empty results.
  const rawOutputs = rule?.outputs ?? rule?.output ?? rule?.result ?? rule?.results
  let outputs: Record<string, any> = {}
  if (isObjectLike(rawOutputs)) {
    outputs = rawOutputs
  } else if (Array.isArray(rawOutputs)) {
    for (const entry of rawOutputs) {
      if (!isObjectLike(entry)) continue
      const key = String(entry.outputKey ?? entry.key ?? entry.name ?? '').trim()
      if (!key) continue
      outputs[key] = entry.value ?? entry.result ?? null
    }
  }

  return {
    id: String(rule?.id ?? '').trim() || crypto.randomUUID(),
    label: String(rule?.label ?? '').trim(),
    enabled: rule?.enabled !== false,
    conditions: normalizedConditions,
    outputs,
  }
}

export function normalizeScaffoldDecisionTable(table: any) {
  return {
    ...table,
    inputs: Array.isArray(table?.inputs) ? table.inputs.map((field: any) => normalizeDecisionTableFieldForScaffold(field)) : [],
    outputs: Array.isArray(table?.outputs) ? table.outputs.map((field: any) => normalizeDecisionTableFieldForScaffold(field)) : [],
    rules: Array.isArray(table?.rules) ? table.rules.map((rule: any) => normalizeDecisionTableRuleForScaffold(rule)) : [],
  }
}

function normalizeWorkflowNodeConfig(type: string, config: Record<string, any>) {
  const nextConfig = { ...config }

  if (type === 'custom_activity' && !nextConfig.input_mappings && isObjectLike(nextConfig.inputs)) {
    nextConfig.input_mappings = Object.fromEntries(
      Object.entries(nextConfig.inputs).map(([key, value]) => [key, normalizeExpressionValue(value)])
    )
  }
  if (type === 'decision_table') {
    if (!nextConfig.input_mappings && isObjectLike(nextConfig.inputs)) {
      nextConfig.input_mappings = Object.fromEntries(
        Object.entries(nextConfig.inputs).map(([key, value]) => [key, normalizeExpressionValue(value)])
      )
    }
    // Engine reads config.decision_table_id — LLMs often write
    // config.table_id (same field they use for update_data_table
    // nodes). Funnel all plausible aliases into the canonical key.
    // decision_table_id is in ID_KEY_TO_MAP → 'decision_table', so
    // remapKnownIds resolves the manifest id to the real UUID.
    if (!nextConfig.decision_table_id && nextConfig.decisionTableId) nextConfig.decision_table_id = nextConfig.decisionTableId
    if (!nextConfig.decision_table_id && nextConfig.table_id) {
      nextConfig.decision_table_id = nextConfig.table_id
      delete nextConfig.table_id
    }
    if (!nextConfig.decision_table_id && nextConfig.tableId) {
      nextConfig.decision_table_id = nextConfig.tableId
      delete nextConfig.tableId
    }
  }
  if (type === 'update_data_table' && !nextConfig.column_values && isObjectLike(nextConfig.values)) {
    nextConfig.column_values = Object.fromEntries(
      Object.entries(nextConfig.values).map(([key, value]) => [key, normalizeExpressionValue(value)])
    )
  }
  if (type === 'update_data_table') {
    if (!nextConfig.row_match_field && nextConfig.match_column) nextConfig.row_match_field = nextConfig.match_column
    if (nextConfig.row_match_value === undefined && nextConfig.match_value !== undefined) {
      nextConfig.row_match_value = normalizeExpressionValue(nextConfig.match_value)
    }
  }
  if (type === 'user_task') {
    if (!nextConfig.task_title && nextConfig.title) nextConfig.task_title = nextConfig.title
    if (!nextConfig.task_title && nextConfig.taskName) nextConfig.task_title = nextConfig.taskName
    if (!nextConfig.task_description && nextConfig.description) nextConfig.task_description = nextConfig.description
    if (!nextConfig.task_description && nextConfig.body) nextConfig.task_description = nextConfig.body
    if (!nextConfig.assignment_type && nextConfig.assignmentType) nextConfig.assignment_type = nextConfig.assignmentType
    if (!nextConfig.assignee_id && nextConfig.assign_to_user_id) nextConfig.assignee_id = nextConfig.assign_to_user_id
    if (!nextConfig.assignee_id && nextConfig.user_id) nextConfig.assignee_id = nextConfig.user_id
    if (!nextConfig.assignee_id && typeof nextConfig.assignee === 'string') nextConfig.assignee_id = nextConfig.assignee
    if (!nextConfig.assignee_variable && nextConfig.assign_to_user_variable) nextConfig.assignee_variable = nextConfig.assign_to_user_variable
    if (!nextConfig.assignee_variable && nextConfig.user_variable) nextConfig.assignee_variable = nextConfig.user_variable
    if (!nextConfig.team_id && nextConfig.assign_to_team_id) nextConfig.team_id = nextConfig.assign_to_team_id
    if (!nextConfig.team_id && nextConfig.teamId) nextConfig.team_id = nextConfig.teamId
    if (!nextConfig.team_id && typeof nextConfig.team === 'string') nextConfig.team_id = nextConfig.team
    if (!nextConfig.outcomes && Array.isArray(nextConfig.outcome_options)) nextConfig.outcomes = nextConfig.outcome_options
  }
  if (type === 'set_title' && nextConfig.template && !nextConfig.title) {
    nextConfig.title = nextConfig.template
  }
  if (type === 'set_variable') {
    if (nextConfig.variable && !nextConfig.name) nextConfig.name = nextConfig.variable
    if (nextConfig.value !== undefined && !nextConfig.expression) nextConfig.expression = normalizeExpressionValue(nextConfig.value)
  }

  // Condition ("Branch by Condition") — the engine expects lowercase
  // `logic` and lowercase `operator`, and branch labels must be
  // non-empty. Without normalization here an LLM-generated config
  // with "AND"/"Equals"/etc. either silently evaluates wrong or
  // skips branches entirely, so the node "never completes".
  if (type === 'condition' && Array.isArray(nextConfig.branches)) {
    nextConfig.branches = nextConfig.branches
      .map((branch: any) => {
        if (!isObjectLike(branch)) return null
        const label = typeof branch.label === 'string' ? branch.label.trim() : ''
        if (!label) return null
        const logic = String(branch.logic ?? 'and').toLowerCase().trim()
        const rules = Array.isArray(branch.rules)
          ? branch.rules
              .map((rule: any) => {
                if (!isObjectLike(rule)) return null
                const field = typeof rule.field === 'string' ? rule.field.trim() : ''
                if (!field) return null
                return {
                  field,
                  operator: String(rule.operator ?? 'equals').toLowerCase().trim(),
                  value: rule.value ?? '',
                }
              })
              .filter(Boolean)
          : []
        return {
          label,
          logic: logic === 'or' ? 'or' : 'and',
          rules,
        }
      })
      .filter(Boolean)
    if (nextConfig.has_else === undefined) nextConfig.has_else = true
  }

  return nextConfig
}

export function normalizeScaffoldWorkflow(workflow: any) {
  const triggerType = String(workflow?.trigger_type ?? 'manual')
  const triggerConfig = isObjectLike(workflow?.trigger_config) ? { ...workflow.trigger_config } : {}
  const rawNodes = Array.isArray(workflow?.nodes) ? workflow.nodes : []
  const rawEdges = Array.isArray(workflow?.edges) ? workflow.edges : []

  let triggerIndex = 0
  let actionIndex = 0
  const nodes = rawNodes
    .filter((node: any) => isObjectLike(node) && typeof node.type === 'string')
    .map((node: any) => {
      const type = String(node.type) as NodeType
      const isTrigger = WORKFLOW_TRIGGER_TYPES.has(type)
      const x = isTrigger ? 40 + (triggerIndex * 240) : 220
      const y = isTrigger ? 20 : 160 + (actionIndex * 140)
      const defaults = createDefaultNode(type, x, y)
      if (isTrigger) triggerIndex += 1
      else actionIndex += 1
      return {
        ...defaults,
        ...node,
        id: String(node.id ?? '').trim() || defaults.id,
        label: String(node.label ?? defaults.label ?? type),
        position: isObjectLike(node.position) && typeof node.position.x === 'number' && typeof node.position.y === 'number'
          ? node.position
          : defaults.position,
        config: normalizeWorkflowNodeConfig(type, isObjectLike(node.config) ? node.config : {}),
      }
    })

  const normalizedEdges = rawEdges
    .filter((edge: any) => isObjectLike(edge))
    .map((edge: any) => ({
      id: String(edge.id ?? '').trim() || crypto.randomUUID(),
      source: String(edge.source ?? edge.from ?? '').trim(),
      target: String(edge.target ?? edge.to ?? '').trim(),
      label: edge.label ?? edge.condition ?? undefined,
      sourcePort: edge.sourcePort ?? edge.source_port ?? undefined,
    }))
    .filter((edge: any) => edge.source && edge.target)

  const triggerNode = nodes.find((node: any) => WORKFLOW_TRIGGER_TYPES.has(node.type))
  if (!triggerNode) {
    const createdTrigger = createDefaultNode(triggerType as NodeType, 300, 20)
    createdTrigger.label = WORKFLOW_TRIGGER_LABELS[triggerType] ?? triggerType
    createdTrigger.config = triggerConfig
    nodes.unshift(createdTrigger)
  } else {
    triggerNode.config = { ...triggerNode.config, ...triggerConfig }
  }

  const effectiveTrigger = nodes.find((node: any) => WORKFLOW_TRIGGER_TYPES.has(node.type))
  if (effectiveTrigger) {
    const hasOutEdge = normalizedEdges.some((edge: any) => edge.source === effectiveTrigger.id)
    if (!hasOutEdge && nodes.length > 1) {
      const firstNonTrigger = nodes.find((node: any) => node.id !== effectiveTrigger.id && !WORKFLOW_TRIGGER_TYPES.has(node.type))
      if (firstNonTrigger) {
        normalizedEdges.unshift({
          id: crypto.randomUUID(),
          source: effectiveTrigger.id,
          target: firstNonTrigger.id,
        })
      }
    }
  }

  return {
    ...workflow,
    trigger_type: triggerType,
    trigger_config: triggerConfig,
    nodes,
    edges: normalizedEdges,
    user_variables: Array.isArray(workflow?.user_variables) ? workflow.user_variables : [],
    swimlanes: Array.isArray(workflow?.swimlanes) ? workflow.swimlanes : [],
  }
}

export function normalizeScaffoldReportConfig(config: any) {
  return normalizeReportConfig(config)
}
