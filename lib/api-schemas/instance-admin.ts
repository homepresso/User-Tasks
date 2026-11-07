import { z } from 'zod'
import { defineEndpoint } from './registry'

/**
 * Instance-level operations (/api/v1/admin/*): for the operator of the
 * installation, authenticated only with the instance admin token
 * (INSTANCE_ADMIN_TOKEN; off — 404 — when unset). Workspace API keys and
 * OAuth tokens get 403.
 */

const AUTH_NOTE = 'Authorization: Bearer <INSTANCE_ADMIN_TOKEN> only (workspace API keys and OAuth tokens get 403). Off (404) unless the server sets INSTANCE_ADMIN_TOKEN (32+ characters). Rate-limited per IP; audited.'

const SLUG_RULES = 'Lowercase a-z, 0-9 and hyphens, 3-40 characters, no leading, trailing or double hyphen, not a reserved name (admin, api, www, …) and not personal-…; the workspace address follows it.'

export const adminWorkspaceSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  subdomain: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
})

export const adminWorkspaceCreateBody = z.object({
  slug: z.string().describe(SLUG_RULES),
  name: z.string().trim().min(1).max(100).describe('Workspace name'),
  owner_email: z.string().trim().min(3).max(320).describe('The owner. An existing user is added as owner; otherwise an account is created (email confirmed)'),
  owner_name: z.string().trim().min(1).max(200).optional().describe('Display name of a new owner account (default: the email\'s local part)'),
  owner_password: z.string().min(8).max(200).optional().describe('Password of a new owner account; omitted: a random one nobody knows (the owner signs in with SSO or resets it). Ignored for an existing user'),
  create_api_key: z.boolean().optional().describe('Also mint a workspace API key (returned once, as `key`). Also on an existing workspace, where it mints another one'),
  api_key_name: z.string().trim().min(1).max(200).optional().describe('Name of the minted key (default "Provisioning")'),
  api_key_permissions: z.array(z.string()).optional().describe('Permission keys of the minted key (default: every permission, like an owner)'),
  api_key_expires_in_days: z.number().int().min(1).max(3650).optional().describe('Days until the minted key expires (default: never)'),
})

const createResponse = z.looseObject({
  created: z.boolean().describe('false: a workspace with this slug already existed and was returned unchanged'),
  workspace: adminWorkspaceSchema,
  owner: z.looseObject({
    id: z.string(),
    email: z.string(),
    created: z.boolean().describe('A new account was created for the owner'),
  }).nullable().describe('The owner (null for an existing workspace)'),
  api_key: z.looseObject({}).optional().describe('The minted key\'s metadata (create_api_key)'),
  key: z.string().optional().describe('The minted plaintext key: store it now, it cannot be retrieved again'),
})

const tags = ['Instance admin']

export const createAdminWorkspaceEndpoint = defineEndpoint({
  method: 'POST', path: '/admin/workspaces', operationId: 'createAdminWorkspace', tags,
  summary: 'Create a workspace with its owner (instance admin; idempotent on slug)',
  description: `${AUTH_NOTE} 201 with created: true for a new workspace; 200 with created: false when the slug is already a live workspace (nothing is changed; a key is minted only when create_api_key is set). 409 when the slug belongs to a deleted workspace or the owner's account can't be used.`,
  permission: null, auth: 'instance_admin',
  body: adminWorkspaceCreateBody, successStatus: 201,
  response: createResponse,
  cli: { resource: 'admin-workspaces', verb: 'create' },
})

export const getAdminWorkspaceEndpoint = defineEndpoint({
  method: 'GET', path: '/admin/workspaces/{slug}', operationId: 'getAdminWorkspace', tags,
  summary: 'Get a workspace by slug (instance admin)',
  description: AUTH_NOTE,
  permission: null, auth: 'instance_admin',
  params: z.object({ slug: z.string().describe('Workspace slug') }),
  response: z.looseObject({ workspace: adminWorkspaceSchema }),
  cli: { resource: 'admin-workspaces', verb: 'get', positional: ['slug'] },
})

export const instanceAdminEndpoints = [createAdminWorkspaceEndpoint, getAdminWorkspaceEndpoint]
