import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// Agent saves go through lib/services/agents (validation, versions, audit);
// these schemas describe the accepted fields (unknown fields are ignored).
const agentFields = {
  description: z.string().nullable().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  role: z.string().optional(),
  task: z.string().optional(),
  boundaries: z.string().optional(),
  tools: z.array(z.any()).optional().describe('Tool objects: {type:"builtin",name} | {type:"reference",referenceId} | {type:"mcp",mcpServerId,mcpToolName}; add requiresApproval:true to need a person\'s approval per call'),
  output_config: looseObject.optional().describe('variables (typed outputs: name, type, required, enum, description), strict_outputs, document_access, data_access {grants: [{table_id, read, insert, update, delete}]} (default: no tables), task_access/task_scope, workflow_access/workflow_scope, knowledge {table_ids, files}, limits {max_run_tokens, max_tool_calls, daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency}, approval {tools, assignee_user_id, assignee_team_id}, egress {allowed_hosts}'),
  integration_id: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  max_tokens: z.number().int().optional(),
  max_iterations: z.number().int().optional(),
}

export const agentCreateBody = z.looseObject({ name: z.string(), ...agentFields })
export const agentUpdateBody = z.looseObject({ name: z.string().optional(), ...agentFields, is_active: z.boolean().optional() })

export const agentExecuteBody = z.looseObject({
  message: z.string(),
  shared_context: z.any().optional().describe('{ messages, facts } from earlier agents (only user / assistant text is used)'),
  history: z.array(z.looseObject({ role: z.enum(['user', 'assistant']), content: z.string() })).optional().describe('Earlier turns of this conversation'),
  async: z.boolean().optional().describe('Queue the run and return a job id (202)'),
  stream: z.boolean().optional().describe('Stream Server-Sent Events: the reply token by token, then done / error / awaiting_approval'),
  max_iterations: z.number().int().optional(),
})

const agentCaseParams = z.object({ id: z.string().describe('Agent id'), caseId: z.string().describe('Test case id') })
const agentEvalRunParams = z.object({ id: z.string().describe('Agent id'), runId: z.string().describe('Evaluation run id') })
export const evalCaseBody = z.looseObject({
  name: z.string(),
  input_message: z.string(),
  expected: z.looseObject({
    contains: z.array(z.string()).optional(),
    not_contains: z.array(z.string()).optional(),
    outputs: looseObject.optional(),
    tools_called: z.array(z.string()).optional(),
    tools_not_called: z.array(z.string()).optional(),
    status: z.enum(['completed', 'failed']).optional(),
    max_tokens: z.number().int().optional(),
    rubric: z.string().optional().describe('Criterion graded by the agent\'s model'),
  }).optional(),
  is_active: z.boolean().optional(),
})

const tags = ['Agents']

export const getAgentQueueJobEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/queue/{id}', operationId: 'getAgentQueueJob', tags,
  summary: 'Get a queued agent job (status, result, run id)', permission: 'agents.view',
  params: idParams, response: itemResponse('job'),
  cli: { resource: 'agents', verb: 'job', positional: ['id'] },
})

export const listAgentRunsEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/runs', operationId: 'listAgentRuns', tags,
  summary: 'List agent runs (newest first)', permission: 'agents.view',
  query: paginationQuery.extend({
    agent_id: z.string().optional(),
    status: z.string().optional().describe('completed | failed | awaiting_approval | running'),
    caller_type: z.string().optional().describe('manual | api | queued | workflow_node | eval'),
  }),
  response: listResponse('runs'), listKey: 'runs',
  cli: { resource: 'agents', verb: 'runs' },
})

export const getAgentRunEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/runs/{id}', operationId: 'getAgentRun', tags,
  summary: 'Get an agent run with its step trace (LLM calls, tool calls, tokens, latency)', permission: 'agents.view',
  params: idParams, response: itemResponse('run'),
  cli: { resource: 'agents', verb: 'run', positional: ['id'] },
})

const costByCurrency = z.record(z.string(), z.number()).describe('Cost per ISO currency code (priced runs only)')
const usageSummary = {
  days: z.array(looseObject).describe('Per day: runs, failed, tokens, cost {currency: amount}, unpriced_runs'),
  tokens_last_24h: z.number(),
  cost_last_24h: costByCurrency,
  tokens_this_month: z.number(),
  cost_this_month: costByCurrency,
  unpriced_runs: z.number().describe('Runs whose cost is unknown (no price for the model, or recorded before cost tracking)'),
}

export const getAgentUsageEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/{id}/usage', operationId: 'getAgentUsage', tags,
  summary: 'Tokens and cost per day, last 24 hours, this month, and the agent\'s limits and budgets', permission: 'agents.view',
  params: idParams, query: z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
  response: z.looseObject(usageSummary),
  cli: { resource: 'agents', verb: 'usage', positional: ['id'] },
})

export const getWorkspaceAgentUsageEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/usage', operationId: 'getWorkspaceAgentUsage', tags,
  summary: 'Workspace agent usage: tokens and cost per day and per agent, workspace budgets, and the price table in effect', permission: 'agents.view',
  query: z.object({ days: z.coerce.number().int().min(1).max(90).optional() }),
  response: z.looseObject({ ...usageSummary, agents: z.array(looseObject), budgets: looseObject, prices: looseObject }),
  cli: { resource: 'agents', verb: 'workspace-usage' },
})

export const updateAgentCostSettingsEndpoint = defineEndpoint({
  method: 'PUT', path: '/agents/cost-settings', operationId: 'updateAgentCostSettings', tags,
  summary: 'Set the workspace\'s model price overrides and agent budgets', permission: 'settings.edit',
  body: z.object({
    model_prices: z.array(looseObject).optional().describe('[{provider, model, input_per_1m, output_per_1m, cached_input_per_1m, currency, effective_date}] — win over the instance\'s and the shipped list prices'),
    budgets: looseObject.optional().describe('{daily_token_budget, monthly_token_budget, daily_cost_budget, monthly_cost_budget, budget_currency} — 0 = none'),
  }),
  response: z.looseObject({ model_prices: z.array(looseObject), budgets: looseObject }),
  cli: { resource: 'agents', verb: 'cost-settings' },
})

export const listAgentVersionsEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/{id}/versions', operationId: 'listAgentVersions', tags,
  summary: 'List an agent\'s saved versions (newest first)', permission: 'agents.view',
  params: idParams, response: z.looseObject({ current_version: z.number(), versions: z.array(looseObject) }), listKey: 'versions',
  cli: { resource: 'agents', verb: 'versions', positional: ['id'] },
})

export const restoreAgentVersionEndpoint = defineEndpoint({
  method: 'POST', path: '/agents/{id}/versions/{version}/restore', operationId: 'restoreAgentVersion', tags,
  summary: 'Restore an earlier version (saved as a new version)', permission: 'agents.edit',
  params: z.object({ id: z.string().describe('Agent id'), version: z.coerce.number().int().min(1).describe('Version number') }),
  response: itemResponse('agent'),
  cli: { resource: 'agents', verb: 'restore', positional: ['id', 'version'] },
})

export const listAgentEvalCasesEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/{id}/evals/cases', operationId: 'listAgentEvalCases', tags,
  summary: 'List an agent\'s evaluation test cases', permission: 'agents.view',
  params: idParams, response: listResponse('cases'), listKey: 'cases',
  cli: { resource: 'agents', verb: 'cases', positional: ['id'] },
})

export const createAgentEvalCaseEndpoint = defineEndpoint({
  method: 'POST', path: '/agents/{id}/evals/cases', operationId: 'createAgentEvalCase', tags,
  summary: 'Add an evaluation test case', permission: 'agents.edit',
  params: idParams, body: evalCaseBody, successStatus: 201, response: itemResponse('case'),
  cli: { resource: 'agents', verb: 'case-create', positional: ['id'] },
})

export const updateAgentEvalCaseEndpoint = defineEndpoint({
  method: 'PUT', path: '/agents/{id}/evals/cases/{caseId}', operationId: 'updateAgentEvalCase', tags,
  summary: 'Update an evaluation test case', permission: 'agents.edit',
  params: agentCaseParams, body: evalCaseBody, response: itemResponse('case'),
  cli: { resource: 'agents', verb: 'case-update', positional: ['id', 'caseId'] },
})

export const deleteAgentEvalCaseEndpoint = defineEndpoint({
  method: 'DELETE', path: '/agents/{id}/evals/cases/{caseId}', operationId: 'deleteAgentEvalCase', tags,
  summary: 'Delete an evaluation test case', permission: 'agents.edit',
  params: agentCaseParams, response: z.looseObject({ deleted: z.literal(true) }),
  cli: { resource: 'agents', verb: 'case-delete', positional: ['id', 'caseId'] },
})

export const runAgentEvalsEndpoint = defineEndpoint({
  method: 'POST', path: '/agents/{id}/evals/runs', operationId: 'runAgentEvals', tags,
  summary: 'Run the evaluation suite (side-effecting tools simulated); poll the run', permission: 'agents.test',
  params: idParams, body: z.looseObject({ case_ids: z.array(z.string()).optional() }), successStatus: 202,
  response: itemResponse('run'),
  cli: { resource: 'agents', verb: 'eval', positional: ['id'] },
})

export const listAgentEvalRunsEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/{id}/evals/runs', operationId: 'listAgentEvalRuns', tags,
  summary: 'List evaluation runs (newest first)', permission: 'agents.view',
  params: idParams, response: listResponse('runs'), listKey: 'runs',
  cli: { resource: 'agents', verb: 'eval-runs', positional: ['id'] },
})

export const getAgentEvalRunEndpoint = defineEndpoint({
  method: 'GET', path: '/agents/{id}/evals/runs/{runId}', operationId: 'getAgentEvalRun', tags,
  summary: 'Get an evaluation run with per-case checks', permission: 'agents.view',
  params: agentEvalRunParams, response: itemResponse('run'),
  cli: { resource: 'agents', verb: 'eval-run', positional: ['id', 'runId'] },
})

const EXTRA_AGENT_ENDPOINTS = [getAgentQueueJobEndpoint, listAgentRunsEndpoint, getAgentRunEndpoint, getAgentUsageEndpoint, getWorkspaceAgentUsageEndpoint, updateAgentCostSettingsEndpoint, listAgentVersionsEndpoint, restoreAgentVersionEndpoint, listAgentEvalCasesEndpoint, createAgentEvalCaseEndpoint, updateAgentEvalCaseEndpoint, deleteAgentEvalCaseEndpoint, runAgentEvalsEndpoint, listAgentEvalRunsEndpoint, getAgentEvalRunEndpoint]

export const agentEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/agents', operationId: 'listAgents', tags,
    summary: 'List agents', permission: 'agents.view',
    query: paginationQuery.extend({ active: booleanFlag('Filter by active flag') }),
    response: listResponse('agents'), listKey: 'agents',
    cli: { resource: 'agents', verb: 'list' },
  }),
  defineEndpoint({
    method: 'POST', path: '/agents', operationId: 'createAgent', tags,
    summary: 'Create an agent', permission: 'agents.create',
    body: agentCreateBody, successStatus: 201, response: itemResponse('agent'),
    cli: { resource: 'agents', verb: 'create' },
  }),
  defineEndpoint({
    method: 'GET', path: '/agents/{id}', operationId: 'getAgent', tags,
    summary: 'Get an agent', permission: 'agents.view',
    params: idParams,
    query: z.object({ include_runs: booleanFlag('Include the 20 most recent runs') }),
    response: z.looseObject({ agent: looseObject, runs: z.array(looseObject).optional() }),
    cli: { resource: 'agents', verb: 'get', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PUT', path: '/agents/{id}', operationId: 'updateAgent', tags,
    summary: 'Update an agent', permission: 'agents.edit',
    params: idParams, body: agentUpdateBody, response: itemResponse('agent'),
    roundTrip: { unwrap: 'agent' },
    cli: { resource: 'agents', verb: 'update', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PATCH', path: '/agents/{id}', operationId: 'patchAgent', tags,
    summary: 'Update an agent (same as PUT)', permission: 'agents.edit',
    params: idParams, body: agentUpdateBody, response: itemResponse('agent'),
    roundTrip: { unwrap: 'agent' },
  }),
  defineEndpoint({
    method: 'DELETE', path: '/agents/{id}', operationId: 'deleteAgent', tags,
    summary: 'Delete an agent (queued; deactivates workflows that reference it)', permission: 'agents.delete',
    params: idParams,
    response: z.looseObject({ deleted: z.literal(true), queued: z.boolean().optional(), deactivated_workflows: z.any() }),
    cli: { resource: 'agents', verb: 'delete', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/agents/{id}/execute', operationId: 'executeAgent', tags,
    summary: 'Run an agent (sync, or async via the agent queue)', permission: 'agents.test',
    description: 'Sync: 200 with response, outputs, usage, run_id (502 when the run fails; 202 with status awaiting_approval and the approval task when a tool call needs a person). Async: 202 with job_id — poll GET /agents/queue/{id}. Stream: `stream: true` (or Accept: text/event-stream) answers with Server-Sent Events — loop events, the reply token by token (`delta`, `delta_reset` when a call is retried), then one `done` / `error` / `awaiting_approval`; disconnecting cancels the run.',
    params: idParams, body: agentExecuteBody,
    response: z.looseObject({ response: z.any().optional(), outputs: z.any().optional(), job_id: z.string().optional(), run_id: z.string().nullable().optional(), status: z.string().optional() }),
    cli: { resource: 'agents', verb: 'execute', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/agents/queue', operationId: 'listAgentQueue', tags,
    summary: 'List queued agent jobs', permission: 'agents.view',
    query: paginationQuery.extend({ status: z.string().optional(), agent_id: z.string().optional() }),
    response: listResponse('jobs'), listKey: 'jobs',
    cli: { resource: 'agents', verb: 'queue' },
  }),
  ...EXTRA_AGENT_ENDPOINTS,
]

