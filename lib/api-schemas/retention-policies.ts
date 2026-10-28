import { z } from 'zod'
import { defineEndpoint } from './registry'
import { idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

// Retention routes validate fields by hand (lib/retention-policy-api.ts);
// these schemas describe the accepted fields loosely.
const policyFields = {
  description: z.string().nullable().optional(),
  policy_mode: z.string().describe('Retention mode (see lib/retention-policy-api.ts RETENTION_POLICY_MODES)'),
  duration_value: z.number().optional(),
  duration_unit: z.string().optional(),
  exact_date: z.string().optional(),
  applies_to: z.array(z.string()).optional().describe('Asset types the policy can be assigned to'),
}

export const retentionPolicyCreateBody = z.looseObject({ name: z.string(), ...policyFields })
export const retentionPolicyUpdateBody = z.looseObject({ name: z.string().optional(), ...policyFields, policy_mode: policyFields.policy_mode.optional() })

export const retentionAssignBody = z.looseObject({
  target_type: z.string(),
  target_id: z.string(),
  retention_policy_id: z.string().nullable().optional().describe('Omit or null to clear the assignment'),
})

const tags = ['Retention']

export const retentionEndpoints = [
  defineEndpoint({
    method: 'GET', path: '/retention-policies', operationId: 'listRetentionPolicies', tags,
    summary: 'List retention policies', permission: 'settings.view',
    query: paginationQuery.extend({
      search: z.string().optional(),
      applies_to: z.string().optional(),
      policy_mode: z.string().optional(),
    }),
    response: listResponse('retention_policies'), listKey: 'retention_policies',
    cli: { resource: 'retention', verb: 'list' },
  }),
  defineEndpoint({
    method: 'POST', path: '/retention-policies', operationId: 'createRetentionPolicy', tags,
    summary: 'Create a retention policy', permission: 'settings.edit',
    body: retentionPolicyCreateBody, successStatus: 201, response: itemResponse('retention_policy'),
    cli: { resource: 'retention', verb: 'create' },
  }),
  defineEndpoint({
    method: 'GET', path: '/retention-policies/{id}', operationId: 'getRetentionPolicy', tags,
    summary: 'Get a retention policy', permission: 'settings.view',
    params: idParams, response: itemResponse('retention_policy'),
    cli: { resource: 'retention', verb: 'get', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PUT', path: '/retention-policies/{id}', operationId: 'updateRetentionPolicy', tags,
    summary: 'Update a retention policy', permission: 'settings.edit',
    params: idParams, body: retentionPolicyUpdateBody, response: itemResponse('retention_policy'),
    roundTrip: { unwrap: 'retention_policy' },
    cli: { resource: 'retention', verb: 'update', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'PATCH', path: '/retention-policies/{id}', operationId: 'patchRetentionPolicy', tags,
    summary: 'Update a retention policy (same as PUT)', permission: 'settings.edit',
    params: idParams, body: retentionPolicyUpdateBody, response: itemResponse('retention_policy'),
    roundTrip: { unwrap: 'retention_policy' },
  }),
  defineEndpoint({
    method: 'DELETE', path: '/retention-policies/{id}', operationId: 'deleteRetentionPolicy', tags,
    summary: 'Delete a retention policy', permission: 'settings.edit',
    params: idParams, response: z.looseObject({ deleted: z.literal(true), retention_policy_id: z.string() }),
    cli: { resource: 'retention', verb: 'delete', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'GET', path: '/retention-policies/{id}/assets', operationId: 'getRetentionPolicyAssets', tags,
    summary: 'List assets governed by a retention policy', permission: 'settings.view',
    params: idParams,
    response: z.looseObject({ retention_policy: looseObject, usage: z.any(), assets: looseObject }),
    cli: { resource: 'retention', verb: 'assets', positional: ['id'] },
  }),
  defineEndpoint({
    method: 'POST', path: '/retention-policies/assign', operationId: 'assignRetentionPolicy', tags,
    summary: 'Assign (or clear) the retention policy on an asset', permission: 'settings.edit',
    body: retentionAssignBody,
    response: z.looseObject({ assigned: z.boolean(), target_type: z.string(), target_id: z.string() }),
    cli: { resource: 'retention', verb: 'assign' },
  }),
]
