import { z } from 'zod'
import { defineEndpoint } from './registry'

export const meResponse = z.object({
  tenant: z.object({ id: z.string(), name: z.string().nullable(), slug: z.string().nullable() }),
  user: z.object({ id: z.string(), email: z.string().nullable() }).nullable().describe('Bound user (null for tenant-wide credentials)'),
  auth: z.object({
    kind: z.enum(['api_key', 'oauth']),
    key_type: z.enum(['tenant', 'user']),
    oauth_scopes: z.array(z.string()).nullable().describe('Granted OAuth scopes (null for API keys)'),
    expires_at: z.string().nullable().describe('Credential expiry, if any'),
  }),
  permissions: z.array(z.string()),
  resource_scopes: z.object({ workflow_ids: z.array(z.string()), table_ids: z.array(z.string()) })
    .describe('Per-key resource allowlists (empty = unrestricted)'),
})

export type MeResponse = z.infer<typeof meResponse>

const tags = ['Identity']

export const meEndpoint = defineEndpoint({
  method: 'GET', path: '/me', operationId: 'getMe', tags,
  summary: 'Describe the calling credential: tenant, user, auth kind and permissions', permission: null,
  response: meResponse,
  cli: { resource: 'me', verb: 'get' },
})

export const openApiEndpoint = defineEndpoint({
  method: 'GET', path: '/openapi.json', operationId: 'getOpenApiSpec', tags,
  summary: 'OpenAPI 3.1 document for this API', permission: null, auth: 'none', envelope: false,
  response: z.looseObject({ openapi: z.string() }),
})

export const identityEndpoints = [meEndpoint, openApiEndpoint]
