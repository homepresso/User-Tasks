import { z } from 'zod'
import { defineEndpoint } from './registry'
import { deletedResponse, idParams, itemResponse, listResponse, looseObject, paginationQuery } from './common'

/**
 * Directory sync: connections to Entra ID, Okta, LDAP / Active Directory and
 * Google Workspace (pulled on a schedule) and SCIM (pushed by the identity
 * provider to /scim/v2 with a workspace token), sync runs, and SCIM tokens.
 * Per-provider settings and credentials are validated by
 * lib/services/directory-sync; credentials are write-only (masked as
 * __SECRET__, and __SECRET__ on update keeps the stored value) and may be
 * secret://tenants/<workspace id>/<name> references.
 */

export const DIRECTORY_CONNECTION_PROVIDERS = ['entra', 'okta', 'ldap', 'google', 'scim'] as const
export const DIRECTORY_SYNC_PROVIDERS = ['entra', 'okta', 'ldap', 'google'] as const
export const SCIM_TOKEN_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write'] as const

const SETTINGS_NOTE = 'ldap { url, start_tls?, ca_cert?, tls_reject_unauthorized?, tls_server_name?, bind_dn, base_dn, user_base_dn?, group_base_dn?, flavor? (active_directory|openldap|generic), user_filter?, group_filter?, attributes? { id, username, email, display_name, first_name, last_name, group_name, group_description, member }, nested_groups?, page_size?, timeout_ms?, deprovision_missing?, bind_login?, login_attributes? }; google { admin_email, customer?, domain?, user_query?, deprovision_missing? }; scim { rate_limit_per_minute? }; every pull provider: sync_interval_minutes? (default 60, minimum 10)'
const CREDENTIALS_NOTE = 'entra { tenant_id, client_id, client_secret }; okta { org_url, api_token }; ldap { bind_password }; google { service_account_json }; scim: none (use SCIM tokens). Write-only: reads show __SECRET__; values may be secret://tenants/<workspace id>/<name>'

export const providerParams = z.object({ provider: z.enum(DIRECTORY_CONNECTION_PROVIDERS).describe('entra, okta, ldap, google or scim') })
export const syncProviderParams = z.object({ provider: z.enum(DIRECTORY_SYNC_PROVIDERS).describe('entra, okta, ldap or google') })

export const directoryConnectionCreateBody = z.object({
  provider: z.enum(DIRECTORY_CONNECTION_PROVIDERS),
  settings: z.record(z.string(), z.unknown()).optional().describe(`Provider settings: ${SETTINGS_NOTE}`),
  credentials: z.record(z.string(), z.unknown()).optional().describe(`Secrets: ${CREDENTIALS_NOTE}`),
  sync_groups: z.boolean().optional().describe('Directory groups become teams (default true)'),
  auto_provision: z.boolean().optional().describe('Create accounts for directory users without one (default true)'),
})

export const directoryConnectionUpdateBody = z.object({
  provider: z.enum(DIRECTORY_CONNECTION_PROVIDERS).optional().describe('Cannot change; accepted so a fetched connection can be sent back'),
  settings: z.record(z.string(), z.unknown()).optional().describe('Merged over the stored settings (null removes a key)'),
  credentials: z.record(z.string(), z.unknown()).optional().describe('Merged over the stored credentials; __SECRET__ keeps a value'),
  sync_groups: z.boolean().optional(),
  auto_provision: z.boolean().optional(),
})

export const directoryConnectionTestBody = z.object({
  settings: z.record(z.string(), z.unknown()).optional().describe('Try these settings (merged over the stored ones) without saving'),
  credentials: z.record(z.string(), z.unknown()).optional().describe('Try these credentials (merged over the stored ones) without saving'),
})

export const directorySyncBody = z.object({
  full: z.boolean().optional().describe('Force a full sync (LDAP otherwise syncs only changes since the last run)'),
})

export const scimTokenCreateBody = z.object({
  name: z.string().trim().min(1).max(200).describe('Label, e.g. "Entra ID provisioning"'),
  scopes: z.array(z.enum(SCIM_TOKEN_SCOPES)).min(1).optional().describe('Default all four'),
  expires_in_days: z.number().int().min(1).max(3650).optional().describe('Default: never expires'),
})

export const scimTokenRotateBody = z.object({
  grace_minutes: z.number().int().min(0).max(10_080).optional().describe('Keep the old token working this long (default 0: revoked now)'),
})

const connection = z.looseObject({
  provider: z.enum(DIRECTORY_CONNECTION_PROVIDERS),
  enabled: z.boolean(),
  org_name: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  credentials: z.record(z.string(), z.unknown()).describe('Masked: every secret is __SECRET__'),
  sync_groups: z.boolean(),
  auto_provision: z.boolean(),
  last_sync_at: z.string().nullable(),
  last_sync_stats: z.record(z.string(), z.number()).nullable(),
  linked_users: z.number().int(),
  linked_groups: z.number().int(),
})

const run = z.looseObject({
  id: z.string(),
  provider: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  mode: z.string().nullable(),
  progress: looseObject.nullable(),
  stats: z.record(z.string(), z.number()).nullable(),
  error: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
})

const scimToken = z.looseObject({
  id: z.string(),
  name: z.string(),
  token_prefix: z.string().describe('First characters of the token'),
  scopes: z.array(z.string()),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
})

const tags = ['Directory sync']

export const listDirectoryConnectionsEndpoint = defineEndpoint({
  method: 'GET', path: '/directory-sync/connections', operationId: 'listDirectoryConnections', tags,
  summary: 'List directory connections (Entra ID, Okta, LDAP, Google Workspace, SCIM) with sync state', permission: 'settings.view',
  response: z.looseObject({ connections: z.array(connection), total: z.number().int(), scim_url: z.string() }), listKey: 'connections',
  cli: { resource: 'directory-sync', verb: 'list' },
})

export const createDirectoryConnectionEndpoint = defineEndpoint({
  method: 'POST', path: '/directory-sync/connections', operationId: 'createDirectoryConnection', tags,
  summary: 'Connect a directory (the connection is verified before it is saved)',
  description: `Settings: ${SETTINGS_NOTE}. Credentials: ${CREDENTIALS_NOTE}.`,
  permission: 'settings.edit',
  body: directoryConnectionCreateBody, successStatus: 201,
  response: z.looseObject({ connection, test: looseObject.optional().describe('LDAP: what the connection test found') }),
  cli: { resource: 'directory-sync', verb: 'connect' },
})

export const getDirectoryConnectionEndpoint = defineEndpoint({
  method: 'GET', path: '/directory-sync/connections/{provider}', operationId: 'getDirectoryConnection', tags,
  summary: 'Get a directory connection (credentials masked)', permission: 'settings.view',
  params: providerParams, response: itemResponse('connection', connection),
  cli: { resource: 'directory-sync', verb: 'get', positional: ['provider'] },
})

export const updateDirectoryConnectionEndpoint = defineEndpoint({
  method: 'PATCH', path: '/directory-sync/connections/{provider}', operationId: 'updateDirectoryConnection', tags,
  summary: 'Update a directory connection (re-verified when settings or credentials change)', permission: 'settings.edit',
  params: providerParams, body: directoryConnectionUpdateBody,
  response: z.looseObject({ connection, changed: z.boolean() }),
  roundTrip: { unwrap: 'connection' },
  cli: { resource: 'directory-sync', verb: 'update', positional: ['provider'] },
})

export const deleteDirectoryConnectionEndpoint = defineEndpoint({
  method: 'DELETE', path: '/directory-sync/connections/{provider}', operationId: 'deleteDirectoryConnection', tags,
  summary: 'Disconnect a directory: syncing stops and credentials are removed (SCIM: every token is revoked). Links and accounts are kept.',
  permission: 'settings.edit',
  params: providerParams, response: deletedResponse,
  cli: { resource: 'directory-sync', verb: 'disconnect', positional: ['provider'] },
})

export const testDirectoryConnectionEndpoint = defineEndpoint({
  method: 'POST', path: '/directory-sync/connections/{provider}/test', operationId: 'testDirectoryConnection', tags,
  summary: 'Test a directory connection (optionally with unsaved settings/credentials)',
  description: 'LDAP: connects (TLS as configured), binds, reads the base DN and counts users and groups with the filters, returning a mapped sample and warnings.',
  permission: 'settings.edit',
  params: syncProviderParams, body: directoryConnectionTestBody,
  response: z.looseObject({ ok: z.boolean(), org_name: z.string().nullable(), error: z.string().nullable(), details: looseObject.nullable() }),
  cli: { resource: 'directory-sync', verb: 'test', positional: ['provider'] },
})

export const startDirectorySyncEndpoint = defineEndpoint({
  method: 'POST', path: '/directory-sync/connections/{provider}/sync', operationId: 'startDirectorySync', tags,
  summary: 'Start a sync run now (runs in the background)', permission: 'settings.edit',
  params: syncProviderParams, body: directorySyncBody, successStatus: 202,
  response: z.looseObject({ run_id: z.string(), already_running: z.boolean() }),
  cli: { resource: 'directory-sync', verb: 'sync', positional: ['provider'] },
})

export const listDirectorySyncRunsEndpoint = defineEndpoint({
  method: 'GET', path: '/directory-sync/runs', operationId: 'listDirectorySyncRuns', tags,
  summary: 'List directory sync runs, newest first', permission: 'settings.view',
  query: paginationQuery.extend({ provider: z.enum(DIRECTORY_SYNC_PROVIDERS).optional() }),
  response: listResponse('runs', run), listKey: 'runs',
  cli: { resource: 'directory-sync', verb: 'runs' },
})

export const listScimTokensEndpoint = defineEndpoint({
  method: 'GET', path: '/directory-sync/scim-tokens', operationId: 'listScimTokens', tags,
  summary: 'List SCIM tokens (never the tokens themselves)', permission: 'settings.view',
  response: listResponse('scim_tokens', scimToken), listKey: 'scim_tokens',
  cli: { resource: 'scim-tokens', verb: 'list' },
})

export const createScimTokenEndpoint = defineEndpoint({
  method: 'POST', path: '/directory-sync/scim-tokens', operationId: 'createScimToken', tags,
  summary: 'Create a SCIM token for the identity provider (shown once); enables SCIM provisioning',
  permission: 'settings.edit',
  body: scimTokenCreateBody, successStatus: 201,
  response: z.looseObject({ scim_token: scimToken, token: z.string().describe('The bearer token (shown once)'), scim_url: z.string() }),
  cli: { resource: 'scim-tokens', verb: 'create' },
})

export const deleteScimTokenEndpoint = defineEndpoint({
  method: 'DELETE', path: '/directory-sync/scim-tokens/{id}', operationId: 'deleteScimToken', tags,
  summary: 'Revoke and delete a SCIM token', permission: 'settings.edit',
  params: idParams, response: deletedResponse,
  cli: { resource: 'scim-tokens', verb: 'delete', positional: ['id'] },
})

export const rotateScimTokenEndpoint = defineEndpoint({
  method: 'POST', path: '/directory-sync/scim-tokens/{id}/rotate', operationId: 'rotateScimToken', tags,
  summary: 'Replace a SCIM token with a new one (same name and scopes); the old one stops working now or after grace_minutes',
  permission: 'settings.edit',
  params: idParams, body: scimTokenRotateBody,
  response: z.looseObject({ scim_token: scimToken, token: z.string().describe('The new bearer token (shown once)'), previous: scimToken }),
  cli: { resource: 'scim-tokens', verb: 'rotate', positional: ['id'] },
})

export const directorySyncEndpoints = [
  listDirectoryConnectionsEndpoint, createDirectoryConnectionEndpoint, getDirectoryConnectionEndpoint,
  updateDirectoryConnectionEndpoint, deleteDirectoryConnectionEndpoint, testDirectoryConnectionEndpoint,
  startDirectorySyncEndpoint, listDirectorySyncRunsEndpoint,
  listScimTokensEndpoint, createScimTokenEndpoint, deleteScimTokenEndpoint, rotateScimTokenEndpoint,
]
