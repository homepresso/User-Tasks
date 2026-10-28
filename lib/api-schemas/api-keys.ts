import { z } from 'zod'
import { defineEndpoint } from './registry'
import { booleanFlag, deletedResponse, idParams, listResponse, paginationQuery } from './common'

const CAPS_NOTE = [
  'A new key can never exceed the caller: permissions must be a subset of the caller\'s (omit to inherit them),',
  'workflow/table scopes must be within the caller\'s own scopes when the caller is scoped,',
  'user-context callers can only create user keys for themselves, and OAuth callers need the keys:write scope',
  'and must set expires_in_days (at most 90). Rate-limited. The plaintext key is returned once, in this response only.',
].join(' ')

export const apiKeyCreateBody = z.object({
  name: z.string().min(1).max(200),
  key_type: z.enum(['tenant', 'user']).optional().describe('tenant (workspace-wide) or user (acts as user_id); default tenant, or user for user-context callers'),
  user_id: z.string().optional().describe('User a user-context key acts as (default: the calling user)'),
  permissions: z.array(z.string()).optional().describe('Permission keys for the key (subset of the caller\'s; omit to inherit)'),
  workflow_ids: z.array(z.string()).optional().describe('Restrict the key to these workflows'),
  table_ids: z.array(z.string()).optional().describe('Restrict the key to these data tables'),
  expires_in_days: z.number().int().min(1).max(3650).optional().describe('Days until expiry (required, at most 90, for OAuth callers)'),
})

const tags = ['API keys']

export const listApiKeysEndpoint = defineEndpoint({
  method: 'GET', path: '/api-keys', operationId: 'listApiKeys', tags,
  summary: 'List API keys (never the key itself)', permission: 'settings.manage_api_keys',
  query: paginationQuery.extend({ include_revoked: booleanFlag('Include revoked keys (default true)') }),
  response: listResponse('api_keys'), listKey: 'api_keys',
  cli: { resource: 'api-keys', verb: 'list' },
})

export const createApiKeyEndpoint = defineEndpoint({
  method: 'POST', path: '/api-keys', operationId: 'createApiKey', tags,
  summary: 'Create an API key (the key is shown once)', description: CAPS_NOTE, permission: 'settings.manage_api_keys',
  body: apiKeyCreateBody, successStatus: 201,
  response: z.looseObject({ api_key: z.looseObject({}), key: z.string().describe('Plaintext key; store it now, it cannot be retrieved again') }),
  cli: { resource: 'api-keys', verb: 'create' },
})

export const revokeApiKeyEndpoint = defineEndpoint({
  method: 'POST', path: '/api-keys/{id}/revoke', operationId: 'revokeApiKey', tags,
  summary: 'Revoke an API key (kept for history, stops authenticating)', permission: 'settings.manage_api_keys',
  params: idParams, response: z.looseObject({ revoked: z.literal(true) }),
  cli: { resource: 'api-keys', verb: 'revoke', positional: ['id'] },
})

export const deleteApiKeyEndpoint = defineEndpoint({
  method: 'DELETE', path: '/api-keys/{id}', operationId: 'deleteApiKey', tags,
  summary: 'Delete an API key', permission: 'settings.manage_api_keys',
  params: idParams, response: deletedResponse,
  cli: { resource: 'api-keys', verb: 'delete', positional: ['id'] },
})

export const apiKeyEndpoints = [listApiKeysEndpoint, createApiKeyEndpoint, revokeApiKeyEndpoint, deleteApiKeyEndpoint]
