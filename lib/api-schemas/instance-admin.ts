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

const queueHealthSchema = z.looseObject({
  due: z.number(), scheduled: z.number(), processing: z.number(),
  stuck: z.number().describe('Processing jobs whose lease expired (worker lost); the next claim recovers them'),
  retrying: z.number(), dead_24h: z.number(), oldest_due_seconds: z.number(), at: z.string(),
})

export const getAdminProcessingEndpoint = defineEndpoint({
  method: 'GET', path: '/admin/processing', operationId: 'getAdminProcessing', tags,
  summary: 'Processing status: where queued work runs, queue health, processing and stuck jobs (instance admin)',
  description: `${AUTH_NOTE} mode is web (the web app runs queued work) or queue (a processing provider's workers do; the separate processing add-on). provider is that add-on's own status, null without it. jobs lists processing jobs, stuck ones (stuck: true — the worker was lost, its lease expired) first.`,
  permission: null, auth: 'instance_admin',
  response: z.looseObject({
    mode: z.enum(['web', 'queue']),
    provider: z.looseObject({ extension_id: z.string(), mode: z.string(), label: z.string() }).nullable(),
    queue: queueHealthSchema.nullable(),
    jobs: z.array(z.looseObject({ id: z.string(), tenant_id: z.string(), workflow_id: z.string(), stuck: z.boolean() })),
    docs_href: z.string(),
  }),
  cli: { resource: 'admin-processing', verb: 'status' },
})

export const recoverAdminProcessingJobEndpoint = defineEndpoint({
  method: 'POST', path: '/admin/processing/jobs/{id}/recover', operationId: 'recoverAdminProcessingJob', tags,
  summary: 'Retry or cancel a processing job whose worker was lost; force-cancel a live one (instance admin)',
  description: `${AUTH_NOTE} retry: a stuck job (lease expired) goes back to pending (its unfinished run continues from its checkpoint, or is closed as interrupted). cancel: a stuck job is cancelled and its unfinished run failed; a job whose worker is still alive needs force: true (the worker's late result is discarded). 409 when the job is not processing or its worker is alive (retry). Audited in the job's workspace.`,
  permission: null, auth: 'instance_admin',
  params: z.object({ id: z.string().describe('Queue job id') }),
  body: z.object({ action: z.enum(['retry', 'cancel']), force: z.boolean().optional().describe('Cancel a job whose worker is still alive') }),
  response: z.looseObject({ action: z.string(), lease_expired: z.boolean(), forced: z.boolean() }),
  cli: { resource: 'admin-processing', verb: 'recover', positional: ['id'] },
})

export const configureAdminProcessingEndpoint = defineEndpoint({
  method: 'PATCH', path: '/admin/processing', operationId: 'configureAdminProcessing', tags,
  summary: 'Change the processing mode / test-run option (instance admin; needs the processing add-on)',
  description: `${AUTH_NOTE} mode: web (the web app runs queued work) or workers (separate processing workers do). Switching to workers is refused (409) while no worker has reported recently; a setting fixed by the server environment (PROCESSING_MODE) is refused too. 409 without the processing add-on (and its licence).`,
  permission: null, auth: 'instance_admin',
  body: z.object({
    mode: z.enum(['web', 'workers']).optional().describe('Where queued work runs'),
    test_runs_on_workers: z.boolean().optional().describe('Designer test runs on workers too (default: in the web app)'),
  }),
  response: z.looseObject({ mode: z.string(), label: z.string() }),
  cli: { resource: 'admin-processing', verb: 'configure' },
})

export const instanceAdminEndpoints = [createAdminWorkspaceEndpoint, getAdminWorkspaceEndpoint, getAdminProcessingEndpoint, configureAdminProcessingEndpoint, recoverAdminProcessingJobEndpoint]
