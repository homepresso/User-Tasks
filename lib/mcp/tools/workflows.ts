import type { McpToolServer } from '../server'
import { z } from 'zod'
import { fromMcpContext, type ServiceContext } from '@/lib/services/context'
import * as workflowService from '@/lib/services/workflows'
import { actOnWorkflowRun, listLiveInstances, migrateInstances } from '@/lib/services/workflow-runs'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { messageOf } from './_util'
import { getWorkflowInputs, startWorkflow } from '@/lib/services/workflow-start'
import { canAccessWorkflow } from '@/lib/api-key-permissions'
import { NODE_CATALOG } from '@/lib/workflow-schema'
import { validateWorkflow } from '@/lib/workflow-validation'
import { MCP_BUILD_ORDER_SENTENCE, MCP_CORE_TOOL_DESCRIPTIONS, MCP_WORKFLOW_RECIPES_GUIDANCE } from '@/lib/mcp/descriptions'
import { normalizeScaffoldWorkflow } from '@/lib/portability/normalize'
import { isObjectLike } from '@/lib/utils/guards'

const TRIGGER_TYPES = new Set([
  'task_created',
  'task_received',
  'task_submitted',
  'task_updated',
  'task_completed',
  'task_rejected',
  'workflow_error',
  'workflow_sla',
  'retention_policy_review',
  'retention_policy_executed',
  'data_table_event',
  'form_submitted',
  'middleware_received',
  'schedule',
  'webhook_received',
  'manual',
])

const TRIGGER_LABELS: Record<string, string> = {
  task_created: 'Task Created',
  task_received: 'Task Received',
  task_submitted: 'Task Submitted',
  task_updated: 'Task Updated',
  task_completed: 'Task Completed',
  task_rejected: 'Task Rejected',
  workflow_error: 'Workflow Error',
  workflow_sla: 'Workflow SLA',
  retention_policy_review: 'Policy Review',
  retention_policy_executed: 'Policy Executed',
  data_table_event: 'Data Table Event',
  form_submitted: 'Form Submitted',
  middleware_received: 'Middleware',
  schedule: 'Schedule',
  webhook_received: 'Webhook',
  manual: 'Manual Trigger',
}

function parseJsonArg<T>(value: string | undefined, fieldName: string): T | null | { error: string } {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return { error: `Invalid ${fieldName} JSON.` }
  }
}

function hasMiddlewareViolations(triggerType: string, nodes: any[]) {
  if (triggerType !== 'middleware_received') return null
  if (nodes.some((node) => isObjectLike(node) && node.type === 'user_task')) {
    return 'Middleware workflows cannot contain user_task nodes. Remove user tasks before adding or publishing middleware flows.'
  }
  if (nodes.length > 0 && !nodes.some((node) => isObjectLike(node) && node.type === 'end_workflow')) {
    return 'Middleware workflows must include an end_workflow node so the synchronous response can be returned to the caller.'
  }
  return null
}

function findTriggerNode(nodes: any[], triggerType: string) {
  return nodes.find((node) => isObjectLike(node) && (node.type === triggerType || node.id === 'trigger' || TRIGGER_TYPES.has(String(node.type ?? ''))))
}

type DependencyCheckResult = {
  ok: boolean
  type: string
  id: string
  source: string
  message?: string
  remediation?: string
  candidate_matches?: Array<{ id: string; label: string }>
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function findDependencyCandidates(supabase: any, tenantId: string, type: string, hint: string) {
  const configs: Record<string, { table: string; select: string; label: (row: any) => string; order?: string }> = {
    workflow: { table: 'workflows', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    data_table: { table: 'custom_tables', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    reference: { table: 'integration_references', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    agent: { table: 'agents', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    decision_table: { table: 'decision_tables', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    workflow_activity: { table: 'custom_workflow_activities', select: 'id, name, key', label: (row) => row.key ? `${row.name} (${row.key})` : (row.name ?? row.id), order: 'name' },
    retention_policy: { table: 'retention_policies', select: 'id, name, policy_mode', label: (row) => row.name ? `${row.name}${row.policy_mode ? ` (${row.policy_mode})` : ''}` : row.id, order: 'name' },
    team: { table: 'teams', select: 'id, name', label: (row) => row.name ?? row.id, order: 'name' },
    user: { table: 'users', select: 'id, display_name, email', label: (row) => row.display_name ? `${row.display_name}${row.email ? ` (${row.email})` : ''}` : (row.email ?? row.id), order: 'display_name' },
    role: { table: 'roles', select: 'id, name, slug', label: (row) => row.slug ? `${row.name} (${row.slug})` : (row.name ?? row.id), order: 'name' },
  }
  const config = configs[type]
  if (!config) return []

  let query = (supabase as any)
    .from(config.table)
    .select(config.select)
    .eq('tenant_id', tenantId)
    .limit(25)
  if (config.order) query = query.order(config.order)
  const { data } = await query
  const rows = data ?? []
  const needle = !isUuidLike(hint) ? hint.trim().toLowerCase() : ''
  const filtered = needle
    ? rows.filter((row: any) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle)))
    : rows
  return filtered.slice(0, 5).map((row: any) => ({ id: row.id, label: config.label(row) }))
}

function dependencyRemediation(type: string, id: string, source: string) {
  switch (type) {
    case 'data_table':
      return `Create or link data table ${id} before validating this workflow. Data assets should be created first in the build order. Referenced from ${source}.`
    case 'decision_table':
      return `Create business rule ${id} before this workflow so rule-driven nodes have a valid target. Referenced from ${source}.`
    case 'workflow_activity':
      return `Create or import custom workflow activity ${id} in Extensibility before building this workflow. Referenced from ${source}.`
    case 'retention_policy':
      return `Create or link retention policy ${id} before this workflow, or update the trigger/node mapping to use an existing policy. Referenced from ${source}.`
    case 'reference':
      return `Create the integration/reference ${id} first, usually by scaffolding the integration bundle before workflows. Referenced from ${source}.`
    case 'agent':
      return `Create or link agent ${id} before this workflow so run_agent nodes can resolve. Referenced from ${source}.`
    case 'workflow':
      return `Create or link workflow ${id} before this one, or remove/update the sub-workflow or workflow_error dependency. Referenced from ${source}.`
    case 'team':
      return `Create or link team ${id} before using team-based user tasks or governance logic. Referenced from ${source}.`
    case 'user':
      return `Ensure user ${id} exists in the tenant or replace the hard-coded user reference with a variable-driven assignment. Referenced from ${source}.`
    case 'role':
      return `Ensure role ${id} exists in governance or switch the node to use an existing role name/id. Referenced from ${source}.`
    default:
      return `Create or link ${type} ${id} before retrying workflow validation. Referenced from ${source}.`
  }
}

function collectWorkflowDependencyIds(nodes: any[], triggerType: string, triggerConfig: any) {
  const refs = {
    workflows: new Map<string, string[]>(),
    tables: new Map<string, string[]>(),
    references: new Map<string, string[]>(),
    agents: new Map<string, string[]>(),
    decisionTables: new Map<string, string[]>(),
    customActivities: new Map<string, string[]>(),
    retentionPolicies: new Map<string, string[]>(),
    teams: new Map<string, string[]>(),
    users: new Map<string, string[]>(),
    roles: new Map<string, string[]>(),
  }

  const add = (bucket: Map<string, string[]>, id: unknown, source: string) => {
    const normalized = String(id ?? '').trim()
    if (!normalized) return
    const existing = bucket.get(normalized) ?? []
    existing.push(source)
    bucket.set(normalized, existing)
  }

  for (const node of nodes) {
    if (!isObjectLike(node)) continue
    const config = isObjectLike(node.config) ? node.config : {}
    const nodeSource = `${String(node.label ?? node.type ?? 'node')} (${String(node.id ?? 'unknown')})`

    add(refs.tables, config.table_id, nodeSource)
    add(refs.tables, config.tableId, nodeSource)
    add(refs.references, config.reference_id, nodeSource)
    add(refs.references, config.referenceId, nodeSource)
    add(refs.workflows, config.sub_workflow_id, nodeSource)
    add(refs.agents, config.agent_id, nodeSource)
    add(refs.decisionTables, config.decision_table_id, nodeSource)
    add(refs.customActivities, config.custom_activity_id, nodeSource)
    add(refs.retentionPolicies, config.retention_policy_id, nodeSource)
    add(refs.teams, config.team_id, nodeSource)
    add(refs.users, config.assignee_id, nodeSource)
    add(refs.users, config.user_id, nodeSource)
    add(refs.users, config.assign_to_user_id, nodeSource)
    add(refs.roles, config.role_id, nodeSource)
  }

  if (triggerType === 'data_table_event') add(refs.tables, triggerConfig?.table_id, 'Trigger config')
  if (triggerType === 'retention_policy_review') {
    if (Array.isArray(triggerConfig?.policy_ids)) {
      for (const id of triggerConfig.policy_ids) add(refs.retentionPolicies, id, 'Trigger config')
    } else {
      add(refs.retentionPolicies, triggerConfig?.retention_policy_id, 'Trigger config')
    }
  }
  if (triggerType === 'workflow_error') {
    if (Array.isArray(triggerConfig?.workflow_ids)) {
      for (const id of triggerConfig.workflow_ids) add(refs.workflows, id, 'Trigger config')
    } else {
      add(refs.workflows, triggerConfig?.workflow_id, 'Trigger config')
    }
  }

  return refs
}

function deepReplaceWorkflowIds(value: any, replacementsByType: Record<string, Record<string, string>>): any {
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceWorkflowIds(item, replacementsByType))
  }
  if (!isObjectLike(value)) return value

  const next: Record<string, any> = {}
  for (const [key, child] of Object.entries(value)) {
    let replacementType: string | null = null
    if (key === 'table_id' || key === 'tableId') replacementType = 'data_table'
    else if (key === 'reference_id' || key === 'referenceId') replacementType = 'reference'
    else if (key === 'sub_workflow_id') replacementType = 'workflow'
    else if (key === 'agent_id') replacementType = 'agent'
    else if (key === 'decision_table_id') replacementType = 'decision_table'
    else if (key === 'custom_activity_id') replacementType = 'workflow_activity'
    else if (key === 'retention_policy_id') replacementType = 'retention_policy'
    else if (key === 'team_id') replacementType = 'team'
    else if (key === 'assignee_id' || key === 'user_id') replacementType = 'user'
    else if (key === 'role_id') replacementType = 'role'

    if (replacementType && typeof child === 'string') {
      next[key] = replacementsByType[replacementType]?.[child] ?? child
    } else {
      next[key] = deepReplaceWorkflowIds(child, replacementsByType)
    }
  }
  return next
}

export function buildWorkflowRecipes() {
  return [
    {
      name: 'Data Change To Notification',
      goal: 'React to table changes, update downstream data, and notify a team.',
      trigger_type: 'data_table_event',
      trigger_config: { table_id: '{{table_id}}', event_types: ['created', 'updated'] },
      nodes: [
        { id: 'trigger', type: 'data_table_event', label: 'Table Event', config: { table_id: '{{table_id}}', event_types: ['created', 'updated'] } },
        { id: 'update_row', type: 'update_data_table', label: 'Update Summary Row', config: { table_id: '{{summary_table_id}}', operation: 'update', row_id: '{{data_row_id}}', column_values: { status: '{{data_event}}' } } },
        { id: 'message_team', type: 'send_email', label: 'Notify Team', config: { to: '{{team_email}}', subject: 'Data row changed', body: 'Data row {{data_row_id}} changed with event {{data_event}}' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'update_row' },
        { id: 'e2', source: 'update_row', target: 'message_team' },
      ],
    },
    {
      name: 'Approval With Branching',
      goal: 'Run an approval step and perform different actions for approved, rejected, or rework outcomes.',
      trigger_type: 'manual',
      trigger_config: {},
      nodes: [
        { id: 'trigger', type: 'manual', label: 'Manual Trigger', config: {} },
        { id: 'approval', type: 'user_task', label: 'Approval', config: { task_title: 'Approve Request', assignee_id: '{{approver_id}}', outcomes: ['approved', 'rejected', 'rework'] } },
        { id: 'approved_message', type: 'send_email', label: 'Approved Notice', config: { to: '{{requester_email}}', subject: 'Request approved', body: 'Your request was approved.' } },
        { id: 'rejected_message', type: 'send_email', label: 'Rejected Notice', config: { to: '{{requester_email}}', subject: 'Request rejected', body: 'Your request was rejected.' } },
        { id: 'rework_message', type: 'send_email', label: 'Rework Notice', config: { to: '{{requester_email}}', subject: 'Request needs rework', body: 'Your request needs rework.' } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'approval' },
        { id: 'e2', source: 'approval', target: 'approved_message', label: 'approved' },
        { id: 'e3', source: 'approval', target: 'rejected_message', label: 'rejected' },
        { id: 'e4', source: 'approval', target: 'rework_message', label: 'rework' },
      ],
    },
    {
      name: 'Middleware Request Response',
      goal: 'Handle a synchronous request, do work, and return a response payload using end_workflow.',
      trigger_type: 'middleware_received',
      trigger_config: { path: 'submit-order', method: 'POST', require_api_key: false, input_schema: [{ name: 'customerId', type: 'string', required: true }] },
      nodes: [
        { id: 'trigger', type: 'middleware_received', label: 'Middleware', config: { path: 'submit-order', method: 'POST', require_api_key: false } },
        { id: 'build_response', type: 'json_build_object', label: 'Build Response', config: { fields: [{ key: 'ok', value: 'true' }, { key: 'customerId', value: '{{customerId}}' }], output_var: 'response_body' } },
        { id: 'finish', type: 'end_workflow', label: 'Return Response', config: { status_code: 200, body_mode: 'json', json_body: { ok: true, customerId: '{{customerId}}' } } },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'build_response' },
        { id: 'e2', source: 'build_response', target: 'finish' },
      ],
    },
  ]
}

async function checkWorkflowDependencies(params: {
  supabase: any
  tenantId: string
  nodes: any[]
  triggerType: string
  triggerConfig: any
}) {
  const { supabase, tenantId, nodes, triggerType, triggerConfig } = params
  const refs = collectWorkflowDependencyIds(nodes, triggerType, triggerConfig)
  const checks: DependencyCheckResult[] = []

  async function verifyMap(
    bucket: Map<string, string[]>,
    table: string,
    type: string,
  ) {
    const ids = [...bucket.keys()]
    if (!ids.length) return
    const { data } = await (supabase as any)
      .from(table)
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', ids)
    const found = new Set((data ?? []).map((row: any) => row.id))
    for (const id of ids) {
      const source = (bucket.get(id) ?? []).join(', ')
      const ok = found.has(id)
      checks.push({
        ok,
        type,
        id,
        source,
        message: ok ? undefined : `${type} ${id} was not found in this tenant`,
        remediation: ok ? undefined : dependencyRemediation(type, id, source),
        candidate_matches: ok ? undefined : await findDependencyCandidates(supabase, tenantId, type, id),
      })
    }
  }

  await verifyMap(refs.workflows, 'workflows', 'workflow')
  await verifyMap(refs.tables, 'custom_tables', 'data_table')
  await verifyMap(refs.references, 'integration_references', 'reference')
  await verifyMap(refs.agents, 'agents', 'agent')
  await verifyMap(refs.decisionTables, 'decision_tables', 'decision_table')
  await verifyMap(refs.customActivities, 'custom_workflow_activities', 'workflow_activity')
  await verifyMap(refs.retentionPolicies, 'retention_policies', 'retention_policy')
  await verifyMap(refs.teams, 'teams', 'team')
  await verifyMap(refs.users, 'users', 'user')
  await verifyMap(refs.roles, 'roles', 'role')

  return {
    checks,
    missing: checks.filter((item) => !item.ok),
    available: checks.filter((item) => item.ok),
  }
}

export function registerWorkflowTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx
  const scopedWorkflowIds = ctx.scopes?.workflow_ids ?? []

  server.tool('workflows_catalog', 'List workflow trigger types, node types, and MCP guidance for prompt-building workflows end to end.', {}, async () => {
    const trigger_types = NODE_CATALOG
      .filter((node) => node.category === 'trigger')
      .map((node) => ({ type: node.type, label: node.label, description: node.description }))

    const node_types = NODE_CATALOG
      .filter((node) => node.category !== 'trigger' && node.category !== 'section')
      .map((node) => ({
        type: node.type,
        label: node.label,
        category: node.category,
        description: node.description,
      }))

    return mcpOk({
      trigger_types,
      node_types,
      guidance: {
        recommended_app_build_order: [
          'data_tables',
          'decision_tables',
          'workflow_activities',
          'retention_policies',
          'workflows',
        ],
        notes: [
          'Use custom_activity nodes for uploaded workflow activities from Extensibility.',
          'Build reusable upstream assets before workflows whenever possible.',
          MCP_BUILD_ORDER_SENTENCE,
          'Publish workflows after the final trigger, node graph, and dependency wiring are in place.',
          MCP_WORKFLOW_RECIPES_GUIDANCE,
        ],
      },
      recipes: buildWorkflowRecipes(),
    })
  })

  server.tool('workflows_preflight', MCP_CORE_TOOL_DESCRIPTIONS.workflows_preflight, {
    workflow_id: z.string().optional().describe('Optional existing workflow ID when validating an update against a saved workflow'),
    trigger_type: z.string().optional().describe('Trigger type to validate. Defaults to task_created when omitted'),
    trigger_config: z.string().optional().describe('JSON string of trigger config to validate'),
    nodes: z.string().optional().describe('JSON string array of proposed workflow nodes'),
    edges: z.string().optional().describe('JSON string array of proposed workflow edges'),
  }, async (args) => {
    if (args.workflow_id && !canAccessWorkflow({ ...ctx, success: true } as any, args.workflow_id)) {
      return mcpErr('This API key is not allowed to access that workflow')
    }

    const parsedTriggerConfig = parseJsonArg<any>(args.trigger_config, 'trigger_config')
    if (parsedTriggerConfig && 'error' in parsedTriggerConfig) return mcpErr(parsedTriggerConfig.error)
    const parsedNodes = parseJsonArg<any[]>(args.nodes, 'nodes')
    if (parsedNodes && 'error' in parsedNodes) return mcpErr(parsedNodes.error)
    const parsedEdges = parseJsonArg<any[]>(args.edges, 'edges')
    if (parsedEdges && 'error' in parsedEdges) return mcpErr(parsedEdges.error)

    let existing: any = null
    if (args.workflow_id) {
      const { data, error } = await supabase.from('workflows')
        .select('id, trigger_type, trigger_config, nodes, edges')
        .eq('id', args.workflow_id)
        .eq('tenant_id', tenantId)
        .single()
      if (error || !data) return mcpErr('Workflow not found')
      existing = data
    }

    const triggerType = args.trigger_type ?? existing?.trigger_type ?? 'task_created'
    const triggerConfig = parsedTriggerConfig ?? existing?.trigger_config ?? {}
    const nodes = parsedNodes ?? existing?.nodes ?? []
    const edges = parsedEdges ?? existing?.edges ?? []

    const validation = validateWorkflow(nodes as any[], triggerType)
    const middlewareViolation = hasMiddlewareViolations(triggerType, nodes)
    const triggerNode = findTriggerNode(nodes, triggerType)
    const triggerChecks: string[] = []
    if (!triggerNode) triggerChecks.push(`No trigger node found for ${triggerType}`)
    if (triggerNode && nodes.length > 1 && !edges.some((edge: any) => edge.source === triggerNode.id)) {
      triggerChecks.push('Trigger node has no outgoing edge to the first activity')
    }

    const dependencyResult = await checkWorkflowDependencies({
      supabase,
      tenantId,
      nodes,
      triggerType,
      triggerConfig,
    })

    const issues = [
      ...(middlewareViolation ? [middlewareViolation] : []),
      ...triggerChecks,
      ...validation.nodeErrors.flatMap((entry) => entry.errors.map((message) => `${entry.nodeLabel}: ${message}`)),
      ...dependencyResult.missing.map((item) => `${item.type} ${item.id} missing (${item.source})`),
    ]

    return mcpOk({
      valid: issues.length === 0,
      trigger_type: triggerType,
      summary: {
        node_error_count: validation.totalErrors,
        dependency_count: dependencyResult.checks.length,
        missing_dependency_count: dependencyResult.missing.length,
        trigger_issue_count: triggerChecks.length + (middlewareViolation ? 1 : 0),
      },
      issues,
      node_errors: validation.nodeErrors,
      dependency_checks: dependencyResult.checks,
      remediation_hints: dependencyResult.missing.map((item) => ({
        type: item.type,
        id: item.id,
        source: item.source,
        remediation: item.remediation,
        candidate_matches: item.candidate_matches ?? [],
      })),
      recommendations: [
        'Create missing data tables, business rules, and custom workflow activities before creating the workflow.',
        'Run workflows_catalog before generation so MCP uses only supported trigger and node types.',
        'Publish the workflow after the graph validates cleanly and all dependencies exist.',
      ],
    })
  })

  server.tool('workflows_resolve_dependencies', 'Rewrite a proposed workflow payload using explicit dependency resolutions. Use this after workflows_preflight when MCP has chosen replacement IDs from candidate_matches and wants a patched trigger_config/nodes/edges payload for the next preflight or create/update call.', {
    trigger_type: z.string().optional().describe('Trigger type for the workflow payload'),
    trigger_config: z.string().optional().describe('JSON string of trigger config to patch'),
    nodes: z.string().describe('JSON string array of workflow nodes to patch'),
    edges: z.string().optional().describe('JSON string array of workflow edges to return unchanged'),
    resolutions: z.array(z.object({
      type: z.enum(['workflow', 'data_table', 'reference', 'agent', 'decision_table', 'workflow_activity', 'retention_policy', 'team', 'user', 'role']).describe('Dependency type being replaced'),
      from_id: z.string().describe('Missing or stale ID to replace'),
      to_id: z.string().describe('Resolved tenant ID to use instead'),
    })).describe('Chosen dependency replacements from preflight candidate matches'),
  }, async (args) => {
    const parsedNodes = parseJsonArg<any[]>(args.nodes, 'nodes')
    if (parsedNodes && 'error' in parsedNodes) return mcpErr(parsedNodes.error)
    const parsedEdges = parseJsonArg<any[]>(args.edges, 'edges')
    if (parsedEdges && 'error' in parsedEdges) return mcpErr(parsedEdges.error)
    const parsedTriggerConfig = parseJsonArg<any>(args.trigger_config, 'trigger_config')
    if (parsedTriggerConfig && 'error' in parsedTriggerConfig) return mcpErr(parsedTriggerConfig.error)

    const replacementsByType: Record<string, Record<string, string>> = {}
    for (const resolution of args.resolutions) {
      if (!replacementsByType[resolution.type]) replacementsByType[resolution.type] = {}
      replacementsByType[resolution.type][resolution.from_id] = resolution.to_id
    }

    const patchedNodes = deepReplaceWorkflowIds(parsedNodes ?? [], replacementsByType)
    const patchedTriggerConfig = deepReplaceWorkflowIds(parsedTriggerConfig ?? {}, replacementsByType)
    const triggerType = args.trigger_type ?? 'task_created'
    const patchedEdges = parsedEdges ?? []

    const preflight = await checkWorkflowDependencies({
      supabase,
      tenantId,
      nodes: patchedNodes,
      triggerType,
      triggerConfig: patchedTriggerConfig,
    })

    return mcpOk({
      resolved: true,
      trigger_type: triggerType,
      trigger_config: patchedTriggerConfig,
      nodes: patchedNodes,
      edges: patchedEdges,
      applied_resolutions: args.resolutions,
      unresolved_dependencies: preflight.missing,
    })
  })

  server.tool('workflows_list', 'List workflow definitions. Workflows can be triggered by task events, schedules, webhooks, middleware endpoints, data-table row events, workflow errors, or manual/API starts.', {
    active: z.boolean().optional().describe('Filter by active status'),
    limit: z.number().optional().describe('Max results (default 50)'),
  }, async (args) => {
    let query = supabase.from('workflows')
      .select('id, name, is_active, trigger_type, run_count, last_run_at, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(args.limit ?? 50, 200))
    if (scopedWorkflowIds.length > 0) query = query.in('id', scopedWorkflowIds)
    if (args.active !== undefined) query = query.eq('is_active', args.active)
    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ workflows: data, count: data?.length ?? 0 })
  })

  server.tool('workflows_get', 'Get full workflow details including nodes, edges, trigger config, and optionally recent runs. Use this before updating a workflow so you preserve its published trigger/node semantics.', {
    workflow_id: z.string().describe('Workflow ID'),
    include_runs: z.boolean().optional().describe('Include up to 10 recent run history entries'),
  }, async (args) => {
    if (!canAccessWorkflow({ ...ctx, success: true } as any, args.workflow_id)) return mcpErr('This API key is not allowed to access that workflow')
    const { data: wf, error } = await supabase.from('workflows')
      .select('id, name, description, is_active, trigger_type, trigger_config, nodes, edges, user_variables, swimlanes, published_version_id, run_count, last_run_at, tags, created_at, updated_at')
      .eq('id', args.workflow_id).eq('tenant_id', tenantId).single()
    if (error) return mcpErr('Workflow not found')

    let runs = null
    if (args.include_runs) {
      const { data } = await (supabase as any).from('workflow_runs')
        .select('id, status, started_at, completed_at, error, title')
        .eq('workflow_id', args.workflow_id)
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false }).limit(10)
      runs = data
    }
    return mcpOk({ ...wf, recent_runs: runs })
  })

  server.tool('workflows_create', `Create a workflow with trigger, nodes, edges, and user variables.

TRIGGER TYPES:
- task_created, task_received, task_submitted, task_updated, task_completed, task_rejected
- workflow_error
- workflow_sla
- retention_policy_review
- retention_policy_executed
- data_table_event
- form_submitted
- middleware_received
- schedule
- webhook_received
- manual

TRIGGER CONFIG EXAMPLES:
- data_table_event: {"table_id":"table-id","event_types":["created","updated","deleted"]} or {"table_id":"table-id","event_types":["updated"],"include_columns":["status","amount"]}
- workflow_sla: {"workflow_scope":"all","event_types":["warning","breached"]} or {"workflow_scope":"specific","workflow_ids":["workflow-id-1"],"event_types":["breached"]}
- retention_policy_review: {"policy_scope":"all"} or {"policy_scope":"specific","policy_ids":["policy-id-1","policy-id-2"]}
- retention_policy_executed: {"policy_scope":"all","action_types":["purge"]} or {"policy_scope":"specific","policy_ids":["policy-id"],"action_types":["purge"]}
- webhook_received: {"path":"optional-custom-path","method":"POST","require_api_key":false}
- middleware_received: {"path":"optional-custom-path","method":"POST","require_api_key":false,"input_schema":[{"name":"customerId","type":"string","required":true}]}
- schedule: {"cron":"0 9 * * 1","timezone":"UTC"}
- workflow_error: {"workflow_id":"optional-specific-workflow-id"}
- form_submitted: {"form_id":"form-id","button_ids":["optional-button-or-outcome"]} (forms_list for ids)
- task events: {"filter_priority":"high"}

FORM SUBMITTED VARIABLES: form_submitted triggers expose {{form.<field_key>}} (typed; {{form.<key>_item}} for lookups), {{form_id}}, {{form_name}}, {{form_version}}, {{form_submission_id}}, {{form_button}}, {{form_outcome}}, {{form_source}} (standalone, api or task), {{submitted_by}}, {{submitted_by_name}}, {{submitted_by_email}}, {{submitted_at}} and {{task_id}} for task forms.

DATA TABLE EVENT VARIABLES: data_table_event triggers expose {{data_event}}, {{data_table_id}}, {{data_table_name}}, {{data_row_id}}, {{data_row}}, {{row}}, plus each column keyed by column id/name slug where available.

WORKFLOW SLA VARIABLES: workflow_sla triggers expose {{workflow_sla_event}}, {{workflow_sla_status}}, {{workflow_sla_label}}, {{workflow_sla_due_at}}, {{workflow_sla_warning_at}}, {{workflow_sla_run_id}}, {{workflow_sla_run_title}}, {{workflow_sla_run_status}}, {{workflow_sla_workflow_id}}, {{workflow_sla_workflow_name}}, and {{workflow_sla_task_id}}.

RETENTION POLICY REVIEW VARIABLES: retention_policy_review triggers expose {{retention_review_event_id}}, {{retention_policy_id}}, {{retention_policy_name}}, {{retention_policy_mode}}, {{retention_review_date}}, {{retention_target_type}}, {{retention_target_id}}, and {{retention_asset_name}}.

RETENTION POLICY EXECUTION VARIABLES: retention_policy_executed triggers expose {{retention_execution_event_id}}, {{retention_policy_id}}, {{retention_policy_name}}, {{retention_policy_mode}}, {{retention_action_type}}, {{retention_execution_date}}, {{retention_target_type}}, {{retention_target_id}}, and {{retention_asset_name}}.

MIDDLEWARE NOTES: middleware_received behaves like a webhook trigger with a synchronous response. Middleware workflows cannot contain user_task nodes and should include an end_workflow node to return the response payload.

USER VARIABLES: Define workflow-scoped variables via user_variables. Set them with set_variable nodes and reference them as {{variable_name}}.

NODE TYPES AND CONFIGS:
- set_variable: { name: "var_name" (REQUIRED), expression: "{{some.value}}" (REQUIRED) }
- set_sla: { sla_label: "First response", mode: "relative"|"exact", amount: 4, unit: "hours"|"days"|"weeks"|"minutes", due_at: "{{some_date}}" (used when mode is exact), warning_mode: "relative"|"exact", warning_amount: 1, warning_unit: "hours"|"days"|"weeks"|"minutes", warning_at: "{{warning_date}}" (used when warning_mode is exact) }
- condition: { branches: [{ label: "Approved", logic: "and"|"or" (lowercase), rules: [{ field: "{{var}}", operator: "equals"|"not_equals"|"contains"|"not_contains"|"gt"|"lt"|"gte"|"lte"|"starts_with"|"ends_with"|"in"|"matches"|"is_empty"|"is_not_empty"|"is_true"|"is_false" (lowercase; is_true/is_false treat true/"true"/1/"yes" as true and false/"false"/0/""/missing as false), value: "approved" }] }], has_else: true }. IMPORTANT: every branch.label must appear as the label on an outgoing edge from the condition node so the engine can route to it — edge label matching is case-insensitive. If has_else is true an edge labelled "Else" routes the no-match path. Empty branches (no rules with a non-empty field) are skipped.
- update_data_table: { table_id, operation: "insert"|"update"|"get"|"list"|"delete", row_id: "{{row_id}}", column_values: { col: "{{expr}}" }, apply_retention_policy: true|false, retention_policy_id: "policy-id or {{variable}}" (only used when apply_retention_policy is true on insert/update), filters: [{ column: "status", operator: "equals"|"not_equals"|"contains"|"starts_with"|"ends_with"|"gt"|"lt"|"gte"|"lte"|"ilike"|"is_null"|"not_null", value: "approved" }], sort_column: "created_at", sort_direction: "asc"|"desc", limit: 100, offset: 0, output_row_id_var: "row_id", output_row_var: "row", output_rows_var: "rows", output_count_var: "count" }
- user_task: { task_title: "Approve {{name}}" (REQUIRED), task_description: "...", assignee_id: "user-id" (REQUIRED for individual), task_priority: "medium", outcomes: ["approved","rejected"], assignment_type: "individual"|"team", team_id: "team-id" (REQUIRED if team), due_date_mode: "relative", due_offset_amount: 3, due_offset_unit: "days", fields: [{ key: "amount", label: "Amount", type: "number", required: true }, { key: "category", label: "Category", type: "choice", options: ["A","B"] }] }. FIELDS: when the assignee must capture data beyond an outcome, list it in fields (type text|number|date|boolean|choice; choice needs options; keys must be unique; optional default may use {{variables}}). Values are stored on the task as task.data.<key> and are available after the node as {{task_data.<key>}}. Complete via tasks_complete_workflow with values: { <key>: value }. Tasks that only need an outcome button can omit fields.
- create_subtask: { title: "..." (REQUIRED), description: "...", assignee_id: "user-id", priority: "medium" }
- update_task: { field: "status" (REQUIRED), value: "in_progress" (REQUIRED) }
- http_request: { url: "https://..." (REQUIRED), method: "GET"|"POST"|"PUT"|"DELETE" (REQUIRED), headers: {}, body: "{{json}}", content_type: "json"|"form", auth_type: "none"|"bearer"|"basic"|"api_key", auth_token: "...", output_var: "response" }
- call_reference: { reference_id: "ref-id" (REQUIRED), input_mappings: { param: "{{value}}" }, output_var: "result" }
- send_email: { to: "{{email}}" (REQUIRED), subject: "..." (REQUIRED), body: "..." }
- delay: { duration: 24 (REQUIRED), unit: "seconds"|"minutes"|"hours"|"days" }
- loop: { items: "{{some_array}}" (REQUIRED), item_var: "item", index_var: "index" }
- math: { expression: "{{a}} + {{b}}" (REQUIRED), output_var: "result" }
- modify_string: { operation: "uppercase"|"lowercase"|"trim"|"replace"|"slice"|"concat"|"split", input: "{{var}}", find: "old", replace_with: "new", output_var: "result" }
- text_template: { template: "Hello {{name}}", output_var: "message" }
- format_date: { date: "{{submitted_at}}", format: "DD/MM/YYYY", output_var: "formatted" }
- date_math: { date: "{{due_date}}", operation: "add"|"subtract", value: 7, unit: "days", output_var: "new_date" }
- regex: { input: "{{text}}", pattern: "\\\\d+", operation: "match"|"replace"|"test", replace_with: "", output_var: "result" }
- json_build_object: { fields: [{ key: "name", value: "{{name}}" }] (REQUIRED), output_var: "obj", source_var: "existing_obj" }
- json_get_value: { input: "{{response}}", path: "data.items[0].id", output_var: "item_id" }
- collection_filter: { collection: "{{list}}" (REQUIRED), field: "status", operator: "equals", value: "active", output_var: "filtered" }
- collection_sort: { collection: "{{list}}" (REQUIRED), field: "created_at", direction: "asc"|"desc", output_var: "sorted" }
- log: { message: "Processing: {{name}}" (REQUIRED), level: "info"|"warn"|"error" }
- switch_case: { field: "{{status}}", cases: [{ value: "approved", label: "Approved" }] }
- parallel: { mode: "all"|"any", branches: [{ label: "Branch 1" }, { label: "Branch 2" }] }
- end_workflow: {} for normal flows, or middleware response config such as { status_code: 200, headers: [{ key: "content-type", value: "application/json" }], body_mode: "json"|"text"|"file", json_body: { ok: true, order_id: "{{row_id}}" }, text_body: "done", file_url: "{{file.url}}", file_name: "report.pdf", file_content_type: "application/pdf" }
- pause_until: { date: "{{resume_date}}" }
- call_sub_workflow: { sub_workflow_id: "wf-id" (REQUIRED), input_mappings: { key: "{{value}}" }, output_var: "sub_result" }
- run_agent: { agent_id: "agent-id" (REQUIRED), user_message: "{{prompt}}" (REQUIRED), output_var: "agent_response", max_iterations: 10 }
- auto_action: { instructions: "Summarize: {{description}}", output_var: "summary" }
- custom_activity: { custom_activity_id: "activity-id" (REQUIRED), custom_activity_key: "stable_key", activity_name: "Friendly Name", source_code: "// snapshot from extensibility", manifest: { inputs: [...], outputs: [...] }, input_mappings: { score: "{{amount}}" }, _output_prefix: "scorecard" }
- retention_policies: { operation: "list_policies"|"create_policy"|"delete_policy"|"list_assets"|"assign_policy", retention_policy_id: "policy-id", name: "Contracts", policy_mode: "review"|"review_on_exact_date"|"purge_on"|"purge_on_exact_date"|"keep_forever", duration_value: 30, duration_unit: "days"|"months"|"years", exact_date: "{{date}}", applies_to: ["data_tables","data_rows","roles"], target_type: "data_table"|"data_row"|"role", target_id: "{{row_id}}" }
- file_to_base64: { file_url: "{{receipt.url}}", output_var: "receipt_base64" }
- base64_to_file: { input: "{{base64_data}}", file_name: "report.pdf", output_var: "saved_file" }
- download_file: { url: "{{file_url}}", output_var: "downloaded_file" }
- read_file: { file_url: "{{file.url}}", output_var: "file_contents" }
- read_csv / read_excel: { file_url: "{{file.url}}", output_var: "rows" }
- add_user_to_role / remove_user_from_role: { user_id: "user-id", role_id: "role-id" } or role_name
- check_permission: { user_id: "user-id", permission_key: "tasks.view", output_var: "has_permission" }`, {
    name: z.string().describe('Workflow name'),
    description: z.string().optional().describe('Workflow description'),
    trigger_type: z.string().optional().describe('Trigger type. Supported: task_created, task_received, task_submitted, task_updated, task_completed, task_rejected, workflow_error, workflow_sla, retention_policy_review, retention_policy_executed, data_table_event, form_submitted, middleware_received, schedule, webhook_received, manual. Default: task_created'),
    trigger_config: z.string().optional().describe('JSON string of trigger config. See tool description for examples.'),
    nodes: z.string().optional().describe('JSON string array of workflow nodes. Each node: {"id":"unique_id","type":"node_type","label":"Human Label","position":{"x":300,"y":100},"config":{...}}. See tool description for node configs.'),
    edges: z.string().optional().describe('JSON string array of edges. Each edge: {"id":"edge-1","source":"node_a","target":"node_b","label":"optional_branch_label"}. Trigger nodes should connect to the first action node. user_task outcome edges should match outcome labels.'),
    user_variables: z.string().optional().describe('JSON string array of workflow-scoped variables. Each: {"id":"uuid","name":"variable_name","type":"string"|"number"|"boolean"|"object","defaultValue":"...","description":"...","required":false,"format":"text"|"date"|"datetime"|"email"|"url"|"select","options":"a,b"}. They are the workflow\'s start inputs (required/format/options optional)'),
    is_active: z.boolean().optional().describe('Set true to activate immediately. Default: false'),
  }, async (args) => {
    if (scopedWorkflowIds.length > 0) return mcpErr('Creating workflows is not allowed for workflow-scoped API keys')
    const parsedNodes = parseJsonArg<any[]>(args.nodes, 'nodes')
    if (parsedNodes && 'error' in parsedNodes) return mcpErr(parsedNodes.error)
    const parsedEdges = parseJsonArg<any[]>(args.edges, 'edges')
    if (parsedEdges && 'error' in parsedEdges) return mcpErr(parsedEdges.error)
    const parsedTriggerConfig = parseJsonArg<any>(args.trigger_config, 'trigger_config')
    if (parsedTriggerConfig && 'error' in parsedTriggerConfig) return mcpErr(parsedTriggerConfig.error)
    const parsedUserVariables = parseJsonArg<any[]>(args.user_variables, 'user_variables')
    if (parsedUserVariables && 'error' in parsedUserVariables) return mcpErr(parsedUserVariables.error)

    const normalizedDraft = normalizeScaffoldWorkflow({
      trigger_type: args.trigger_type ?? 'task_created',
      trigger_config: parsedTriggerConfig ?? {},
      nodes: parsedNodes ?? [],
      edges: parsedEdges ?? [],
    })
    const nodes = normalizedDraft.nodes ?? []
    const edges = normalizedDraft.edges ?? []
    const triggerConfig = normalizedDraft.trigger_config ?? parsedTriggerConfig
    const userVariables = parsedUserVariables ?? []
    const triggerType = normalizedDraft.trigger_type ?? args.trigger_type ?? 'task_created'

    const middlewareViolation = hasMiddlewareViolations(triggerType, nodes)
    if (middlewareViolation) return mcpErr(middlewareViolation)

    const hasTriggerNode = nodes.some((node: any) => isObjectLike(node) && (node.type === triggerType || node.id === 'trigger'))
    if (!hasTriggerNode) {
      nodes.unshift({
        id: crypto.randomUUID(),
        type: triggerType,
        label: TRIGGER_LABELS[triggerType] ?? triggerType,
        position: { x: 300, y: 20 },
        config: triggerConfig ?? {},
      })
    } else if (triggerConfig) {
      const triggerNode = nodes.find((node: any) => isObjectLike(node) && (node.type === triggerType || node.id === 'trigger'))
      if (triggerNode) triggerNode.config = { ...triggerNode.config, ...triggerConfig }
    }

    const triggerNode = findTriggerNode(nodes, triggerType)
    if (triggerNode) {
      const hasOutEdge = edges.some((edge: any) => edge.source === triggerNode.id)
      if (!hasOutEdge && nodes.length > 1) {
        const firstNonTrigger = nodes.find((node: any) => node.id !== triggerNode.id && !TRIGGER_TYPES.has(String(node.type ?? '')))
        if (firstNonTrigger) {
          edges.unshift({ id: crypto.randomUUID(), source: triggerNode.id, target: firstNonTrigger.id })
        }
      }
    }

    try {
      const created = await workflowService.createWorkflow(fromMcpContext(ctx), {
        name: args.name,
        description: args.description ?? null,
        trigger_type: triggerType,
        trigger_config: triggerConfig ?? {},
        nodes,
        edges,
        user_variables: userVariables,
        is_active: args.is_active ?? false,
      })
      return mcpOk({
        created: true,
        workflow: { id: created.workflow_id, name: created.name, is_active: created.is_active, trigger_type: triggerType },
      })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Failed to create workflow')
    }
  })

  server.tool('workflows_update', 'Save draft changes to a workflow: trigger type/config, nodes, edges, user variables, metadata, and active status. Runs keep using the published version until workflows_publish (or publish: true). Pass `definition` (the output of workflows_get_definition, edited) to send the whole author payload; the individual JSON-string arguments override it. Fields equal to the stored value are not changes. Middleware workflows still cannot contain user_task nodes and should retain an end_workflow response node.', {
    workflow_id: z.string().describe('Workflow ID to update'),
    definition: z.union([z.string(), z.record(z.string(), z.any())]).optional().describe('Author payload (object or JSON string) as returned by workflows_get_definition, edited'),
    name: z.string().optional().describe('New workflow name'),
    description: z.string().optional().describe('New description'),
    trigger_type: z.string().optional().describe('New trigger type'),
    trigger_config: z.string().optional().describe('JSON string of new trigger config'),
    nodes: z.string().optional().describe('JSON string array of updated nodes (replaces all existing nodes)'),
    edges: z.string().optional().describe('JSON string array of updated edges (replaces all existing edges)'),
    user_variables: z.string().optional().describe('JSON string array of workflow variables (replaces all existing)'),
    is_active: z.boolean().optional().describe('Set active/inactive'),
    publish: z.boolean().optional().describe('Publish the saved draft as a new version (needs workflows.activate)'),
    publish_notes: z.string().optional().describe('Notes for the published version'),
  }, async (args) => {
    if (!canAccessWorkflow({ ...ctx, success: true } as any, args.workflow_id)) return mcpErr('This API key is not allowed to access that workflow')
    const { data: existing, error: existingError } = await supabase.from('workflows')
      .select('trigger_type, trigger_config, nodes, edges')
      .eq('id', args.workflow_id)
      .eq('tenant_id', tenantId)
      .single()
    if (existingError || !existing) return mcpErr('Workflow not found')

    let base: Record<string, any> = {}
    if (args.definition !== undefined) {
      const parsed = typeof args.definition === 'string' ? parseJsonArg<any>(args.definition, 'definition') : args.definition
      if (isObjectLike(parsed) && typeof parsed.error === 'string' && Object.keys(parsed).length === 1) return mcpErr(parsed.error)
      const unwrapped = workflowService.unwrapWorkflowBody(parsed)
      if (!isObjectLike(unwrapped)) return mcpErr('definition must be an object')
      for (const field of workflowService.WORKFLOW_DEFINITION_FIELDS) {
        if ((unwrapped as any)[field] !== undefined && (unwrapped as any)[field] !== null) base[field] = (unwrapped as any)[field]
      }
      if (unwrapped.description === null) base.description = null
    }

    const updates: Record<string, any> = { ...base }
    if (args.name) updates.name = args.name
    if (args.description !== undefined) updates.description = args.description
    if (args.trigger_type) updates.trigger_type = args.trigger_type

    if (args.trigger_config) {
      const parsed = parseJsonArg<any>(args.trigger_config, 'trigger_config')
      if (parsed && 'error' in parsed) return mcpErr(parsed.error)
      updates.trigger_config = parsed
    }
    if (args.nodes) {
      const parsed = parseJsonArg<any[]>(args.nodes, 'nodes')
      if (parsed && 'error' in parsed) return mcpErr(parsed.error)
      updates.nodes = parsed
    }
    if (args.edges) {
      const parsed = parseJsonArg<any[]>(args.edges, 'edges')
      if (parsed && 'error' in parsed) return mcpErr(parsed.error)
      updates.edges = parsed
    }
    if (args.user_variables) {
      const parsed = parseJsonArg<any[]>(args.user_variables, 'user_variables')
      if (parsed && 'error' in parsed) return mcpErr(parsed.error)
      updates.user_variables = parsed
    }

    // Hand-written drafts get the same normalisation as workflows_create
    // (node defaults, trigger node); a fetched definition is left as stored.
    if (args.definition === undefined) {
      const normalizedDraft = normalizeScaffoldWorkflow({
        trigger_type: updates.trigger_type ?? existing.trigger_type,
        trigger_config: updates.trigger_config ?? (existing as any).trigger_config ?? {},
        nodes: Array.isArray(updates.nodes) ? updates.nodes : (Array.isArray(existing.nodes) ? existing.nodes : []),
        edges: Array.isArray(updates.edges) ? updates.edges : (Array.isArray((existing as any).edges) ? (existing as any).edges : []),
      })
      if (args.trigger_type || args.trigger_config) {
        updates.trigger_type = normalizedDraft.trigger_type
        updates.trigger_config = normalizedDraft.trigger_config
      }
      if (args.nodes) updates.nodes = normalizedDraft.nodes
      if (args.edges) updates.edges = normalizedDraft.edges
    }

    try {
      const result = await workflowService.updateWorkflow(fromMcpContext(ctx), args.workflow_id, {
        ...updates,
        ...(args.is_active !== undefined ? { is_active: args.is_active } : {}),
        publish: args.publish ?? false,
        publish_notes: args.publish_notes,
      })
      return mcpOk({ updated: true, ...result })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Failed to update workflow')
    }
  })

  server.tool('workflows_get_definition', 'Get the draft definition of a workflow in author-payload shape (name, description, trigger_type, trigger_config, nodes, edges, user_variables, swimlanes, sections, tags) — the same document as GET /api/v1/workflows/{id}/definition. Edit it and pass it back as workflows_update { definition }.', {
    workflow_id: z.string().describe('Workflow ID'),
  }, async (args) => {
    try {
      return mcpOk({ workflow_id: args.workflow_id, definition: await workflowService.getWorkflowDefinition(fromMcpContext(ctx), args.workflow_id) })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Workflow not found')
    }
  })

  server.tool('workflows_publish', 'Publish the current draft of a workflow as a new version snapshot. This stores the current trigger config, nodes, edges, user variables, and swimlanes, marks the version active, and points the workflow at the published version.', {
    workflow_id: z.string().describe('Workflow ID to publish'),
    notes: z.string().optional().describe('Publish notes describing what changed'),
  }, async (args) => {
    try {
      const result = await workflowService.publishWorkflow(fromMcpContext(ctx), args.workflow_id, args.notes)
      return mcpOk({ published: true, workflow_id: args.workflow_id, version: result.version_number, version_id: result.version_id })
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Failed to publish workflow')
    }
  })

  // Delete / toggle / versions are thin wrappers over lib/services/workflows
  // (delete and toggle are audited there; the versions read needs workflows.view).
  const workflowsWriteCtx = (): ServiceContext => fromMcpContext(ctx)
  const workflowsReadCtx = (): ServiceContext => fromMcpContext(ctx) // reads are gated too (READ_TOOL_PERMISSIONS)
  const serviceCall = async (fn: () => Promise<unknown>) => {
    try {
      return mcpOk(await fn())
    } catch (error) {
      return mcpErr((error instanceof Error && error.message) || 'Request failed')
    }
  }

  server.tool('workflows_delete', 'Delete a workflow by ID. The workflow definition, versions, run history and the tasks it spawned are removed by the deletion queue shortly after.', {
    workflow_id: z.string().describe('Workflow ID to delete'),
  }, async (args) => serviceCall(async () => {
    await workflowService.deleteWorkflow(workflowsWriteCtx(), args.workflow_id)
    return { deleted: true, workflow_id: args.workflow_id }
  }))

  server.tool('workflows_toggle', 'Activate or deactivate a workflow. Active workflows respond to their trigger events; inactive workflows remain paused.', {
    workflow_id: z.string().describe('Workflow ID'),
    is_active: z.boolean().describe('true to activate, false to deactivate'),
  }, async (args) => serviceCall(async () => {
    await workflowService.setWorkflowActive(workflowsWriteCtx(), args.workflow_id, args.is_active)
    return { workflow_id: args.workflow_id, is_active: args.is_active }
  }))

  server.tool('workflows_versions_list', 'List version history for a workflow. Each version is a published snapshot of the trigger config, nodes, edges, and variables used for execution.', {
    workflow_id: z.string().describe('Workflow ID'),
    limit: z.number().optional().describe('Max results (default 20)'),
  }, async (args) => serviceCall(async () => {
    const { versions } = await workflowService.listWorkflowVersions(workflowsReadCtx(), args.workflow_id, { limit: Math.max(1, Math.min(args.limit ?? 20, 100)), offset: 0 })
    return { versions, count: versions.length }
  }))

  server.tool('workflows_version_get', 'Get one published version of a workflow with its full definition (nodes, edges, trigger config, variables).', {
    workflow_id: z.string().describe('Workflow ID'),
    version_id: z.string().describe('Version ID (from workflows_versions_list)'),
  }, async (args) => serviceCall(async () => ({ version: await workflowService.getWorkflowVersion(workflowsReadCtx(), args.workflow_id, args.version_id) })))

  server.tool('workflows_start', 'Start a workflow execution. Uses the published workflow version when available. Declared inputs (workflows_inputs_get) are validated and coerced: a missing required input or a wrong type is an error listing each field; other variables pass through. Async runs are enqueued with enqueue_workflow; sync runs execute immediately. Middleware workflows are normally invoked through their generated endpoint rather than this tool.', {
    workflow_id: z.string().describe('Workflow ID to execute'),
    variables: z.record(z.string(), z.any()).optional().describe('Input values keyed by input name (see workflows_inputs_get); available as {{name}} in the run'),
    task_id: z.string().optional().describe('Task ID to associate with the run'),
    async: z.boolean().optional().describe('Queue for background execution. Default: false'),
    priority: z.number().optional().describe('Queue priority 0-100 for async starts. Default: 50'),
  }, async (args) => serviceCall(async () => {
    const result = await startWorkflow(workflowsWriteCtx(), {
      workflow_id: args.workflow_id, variables: args.variables, task_id: args.task_id, async: args.async ?? false, priority: args.priority,
    })
    return result.mode === 'async' ? { queued: true, ...result } : result
  }))

  server.tool('workflows_inputs_get', 'Get the input parameters a workflow run accepts (same as GET /workflows/{id}/inputs): key, label, type (text, number, boolean, date, datetime, json, select, email, url), required, default, description and options, from the published version (the draft when never published). Pass values as workflows_start { variables }.', {
    workflow_id: z.string().describe('Workflow ID'),
  }, async (args) => serviceCall(async () => getWorkflowInputs(workflowsReadCtx(), args.workflow_id)))

  server.tool('workflows_runs_list', 'List workflow runs with status and timing information. Useful for standard workflows as well as webhook, middleware, data-event, and error-handler executions.', {
    workflow_id: z.string().optional().describe('Filter by workflow ID'),
    status: z.string().optional().describe('Filter: running, completed, failed, waiting_for_event, paused, migrated'),
    version_id: z.string().optional().describe('Filter by workflow version ID'),
    limit: z.number().optional().describe('Max results (default 20)'),
  }, async (args) => {
    let query = (supabase as any).from('workflow_runs')
      .select('id, workflow_id, version_id, migrated_from_run_id, migrated_to_run_id, status, started_at, completed_at, error, title, sla_label, sla_due_at, sla_warning_at, sla_status, sla_warning_triggered_at, sla_breached_triggered_at')
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .limit(Math.min(args.limit ?? 20, 200))
    if (args.workflow_id) {
      if (!canAccessWorkflow({ ...ctx, success: true } as any, args.workflow_id)) return mcpErr('This API key is not allowed to access that workflow')
      query = query.eq('workflow_id', args.workflow_id)
    } else if (scopedWorkflowIds.length > 0) {
      query = query.in('workflow_id', scopedWorkflowIds)
    }
    if (args.status) query = query.eq('status', args.status)
    if (args.version_id) query = query.eq('version_id', args.version_id)
    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ runs: data, count: data?.length ?? 0 })
  })

  server.tool('workflows_run_get', 'Get details of a workflow run including execution state and optionally step-by-step logs.', {
    run_id: z.string().describe('Workflow run ID'),
    include_logs: z.boolean().optional().describe('Include execution logs (step-by-step trace)'),
  }, async (args) => {
    const { data: run, error } = await (supabase as any).from('workflow_runs')
      .select('*').eq('id', args.run_id).eq('tenant_id', tenantId).single()
    if (error) return mcpErr('Run not found')
    if (!canAccessWorkflow({ ...ctx, success: true } as any, run.workflow_id)) return mcpErr('This API key is not allowed to access that workflow')

    let logs = null
    if (args.include_logs) {
      const { data } = await (supabase as any).from('workflow_logs')
        .select('id, level, message, node_type, node_label, duration_ms, created_at')
        .eq('run_id', args.run_id).order('created_at').limit(100)
      logs = data
    }
    return mcpOk({ ...run, logs })
  })

  server.tool('workflows_run_action', 'Perform an action on a workflow run: pause, resume, or cancel (same rules as POST /workflows/runs/{id}/action). Pause keeps the wait state; resume restores a paused wait, or continues the run now with `variables` as return variables (use goto_node_id to continue at a specific node of the run\'s version); cancel ends the run and closes its open user task(s).', {
    run_id: z.string().describe('Workflow run ID'),
    action: z.enum(['pause', 'resume', 'cancel']).describe('Action to perform'),
    variables: z.record(z.string(), z.any()).optional().describe('Variables to pass when resuming (e.g. outcome, outcome_notes)'),
    goto_node_id: z.string().optional().describe('Resume only: continue at this node id of the run\'s workflow version'),
  }, async (args) => {
    try {
      const { action: result, ...rest } = await actOnWorkflowRun(fromMcpContext(ctx), { runId: args.run_id }, {
        action: args.action,
        variables: args.variables ?? null,
        gotoNodeId: args.goto_node_id ?? null,
      })
      return mcpOk({ ...rest, action: args.action, run_id: args.run_id, success: true, variables: args.variables ?? null, result })
    } catch (error) {
      return mcpErr(messageOf(error, 'Run action failed'))
    }
  })

  server.tool('workflows_instances_list', 'List live instances of a workflow (runs waiting on a task/event or paused) with their current node, version, waiting-since time and open task (assignee). `versions` counts live instances per version; `on_older_versions` counts those not on the published version. Same as GET /workflows/{id}/instances.', {
    workflow_id: z.string().describe('Workflow ID'),
    status: z.enum(['active', 'waiting_for_event', 'paused']).optional().describe('active (default) = waiting and paused'),
    version_id: z.string().optional().describe('Only instances on this version'),
    limit: z.number().optional().describe('Max results (default 50, max 500)'),
    offset: z.number().optional().describe('Rows to skip'),
  }, async (args) => serviceCall(async () => listLiveInstances(workflowsReadCtx(), args.workflow_id, {
    status: args.status ?? null, versionId: args.version_id ?? null, limit: args.limit ?? null, offset: args.offset ?? null,
  })))

  server.tool('workflows_instances_migrate', 'Migrate live instances to another version of the workflow (same as POST /workflows/{id}/instances/migrate). Each instance is closed (status migrated, open task cancelled, queued resumes dropped) and a new run starts on to_version_id at the chosen node with the same variables, trace and task; a User Task there creates a fresh task. Target node: node_map[current node] → default_target_node_id → same node id. Use dry_run: true first to review the per-instance plan (warnings, blocked instances).', {
    workflow_id: z.string().describe('Workflow ID'),
    to_version_id: z.string().describe('Target version ID (workflows_versions_list)'),
    run_ids: z.array(z.string()).optional().describe('Instances to migrate (max 500)'),
    from_version_id: z.string().optional().describe('Migrate every live instance on this version'),
    all_active: z.boolean().optional().describe('Migrate every live instance not on to_version_id'),
    node_map: z.record(z.string(), z.string()).optional().describe('Current node id → target node id'),
    default_target_node_id: z.string().optional().describe('Target node for instances whose node is not in node_map'),
    dry_run: z.boolean().optional().describe('Only return the plan (default false)'),
  }, async (args) => serviceCall(async () => migrateInstances(workflowsWriteCtx(), {
    workflowId: args.workflow_id,
    toVersionId: args.to_version_id,
    runIds: args.run_ids ?? null,
    fromVersionId: args.from_version_id ?? null,
    allActive: args.all_active ?? false,
    nodeMap: args.node_map ?? null,
    defaultTargetNodeId: args.default_target_node_id ?? null,
    dryRun: args.dry_run ?? false,
  })))
}
