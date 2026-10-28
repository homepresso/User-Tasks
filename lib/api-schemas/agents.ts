import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// The agent routes don't validate bodies with zod; these schemas describe the
// accepted fields loosely (unknown fields are ignored by the routes).
const agentFields = {
  description: z.string().nullable().optional(),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  role: z.string().optional(),
  task: z.string().optional(),
  boundaries: z.string().optional(),
  tools: z.array(z.any()).optional(),
  output_config: looseObject.optional(),
  integration_id: z.string().nullable().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().int().optional(),
  max_iterations: z.number().int().optional(),
}

export const agentCreateBody = z.looseObject({ name: z.string(), ...agentFields })
export const agentUpdateBody = z.looseObject({ name: z.string().optional(), ...agentFields, is_active: z.boolean().optional() })

export const agentExecuteBody = z.looseObject({
  message: z.string(),
  shared_context: z.any().optional(),
  async: z.boolean().optional().describe('Queue the run and return a job id (202)'),
  max_iterations: z.number().int().optional(),
})

const tags = ['Agents']

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
    summary: 'Delete an agent (deactivates workflows that reference it)', permission: 'agents.delete',
    params: idParams,
    response: z.looseObject({ deleted: z.literal(true), deactivated_workflows: z.any() }),
    cli: { resource: 'agents', verb: 'delete', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/agents/{id}/execute', operationId: 'executeAgent', tags,
    summary: 'Run an agent (sync, or async via the agent queue)', permission: 'agents.test',
    params: idParams, body: agentExecuteBody,
    response: z.looseObject({ response: z.any().optional(), outputs: z.any().optional(), job_id: z.string().optional() }),
    cli: { resource: 'agents', verb: 'execute', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/agents/queue', operationId: 'listAgentQueue', tags,
    summary: 'List queued agent jobs', permission: 'agents.view',
    query: paginationQuery.extend({ status: z.string().optional(), agent_id: z.string().optional() }),
    response: listResponse('jobs'), listKey: 'jobs',
    cli: { resource: 'agents', verb: 'queue' },
  }),
]
