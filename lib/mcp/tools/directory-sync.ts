import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { resolvePage } from '@/lib/services/_shared'
import * as directory from '@/lib/services/directory-sync'
import { DIRECTORY_CONNECTION_PROVIDERS, DIRECTORY_SYNC_PROVIDERS, SCIM_TOKEN_SCOPES } from '@/lib/api-schemas/directory-sync'
import { messageOf } from './_util'

/*
 * Directory sync tools: thin wrappers over lib/services/directory-sync
 * (reads need settings.view, writes settings.edit; audited in the service).
 * Credentials are write-only (reads show '__SECRET__', '__SECRET__' on update
 * keeps the stored value). SCIM tokens are returned once, at creation or
 * rotation.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const SETTINGS_HELP = 'ldap: { url (ldaps://host:636 | ldap://host:389), start_tls?, ca_cert? (PEM), tls_reject_unauthorized?, tls_server_name?, bind_dn, base_dn, user_base_dn?, group_base_dn?, flavor? (active_directory|openldap|generic), user_filter?, group_filter?, attributes? { id, username, email, display_name, first_name, last_name, group_name, group_description, member }, nested_groups?, deprovision_missing?, bind_login?, login_attributes? }; google: { admin_email, customer?, domain?, user_query? }; scim: { rate_limit_per_minute? }; pull providers: sync_interval_minutes?'
const CREDENTIALS_HELP = 'entra: { tenant_id, client_id, client_secret }; okta: { org_url, api_token }; ldap: { bind_password }; google: { service_account_json }; values may be secret://tenants/<workspace id>/<name>'
const jsonObject = z.record(z.string(), z.any())
const provider = z.enum(DIRECTORY_CONNECTION_PROVIDERS).describe('entra, okta, ldap, google or scim')
const syncProvider = z.enum(DIRECTORY_SYNC_PROVIDERS).describe('entra, okta, ldap or google')

export function registerDirectorySyncTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('directory_sync_list', 'List directory connections (Entra ID, Okta, LDAP / Active Directory, Google Workspace, SCIM) with sync state, linked user/group counts and the SCIM base URL. Credentials are masked.', {},
    async () => run(() => directory.listDirectoryConnections(svc())))

  server.tool('directory_sync_get', 'Get one directory connection (settings, masked credentials, sync state).', {
    provider,
  }, async (args) => run(() => directory.getDirectoryConnectionView(svc(), args.provider)))

  server.tool('directory_sync_connect', 'Connect a directory. The connection is verified first (LDAP: connect with TLS as configured, bind, read the base DN, count users and groups). SCIM needs no settings: create a SCIM token instead.', {
    provider,
    settings: jsonObject.optional().describe(SETTINGS_HELP),
    credentials: jsonObject.optional().describe(CREDENTIALS_HELP),
    sync_groups: z.boolean().optional().describe('Groups become teams (default true)'),
    auto_provision: z.boolean().optional().describe('Create accounts for directory users without one (default true)'),
  }, async (args) => run(() => directory.createDirectoryConnection(svc(), args)))

  server.tool('directory_sync_update', 'Update a directory connection: settings and credentials merge over the stored ones (null removes a key, __SECRET__ keeps a secret); re-verified when they change.', {
    provider,
    settings: jsonObject.optional().describe(SETTINGS_HELP),
    credentials: jsonObject.optional().describe(CREDENTIALS_HELP),
    sync_groups: z.boolean().optional(),
    auto_provision: z.boolean().optional(),
  }, async (args) => run(() => {
    const { provider: p, ...input } = args
    return directory.updateDirectoryConnection(svc(), p, input)
  }))

  server.tool('directory_sync_disconnect', 'Disconnect a directory: syncing stops and credentials are removed (SCIM: every token is revoked). Directory links and accounts are kept.', {
    provider,
  }, async (args) => run(() => directory.deleteDirectoryConnection(svc(), args.provider)))

  server.tool('directory_sync_test', 'Test a directory connection, optionally with unsaved settings/credentials merged over the stored ones. LDAP returns user/group counts, a mapped sample and warnings.', {
    provider: syncProvider,
    settings: jsonObject.optional().describe(SETTINGS_HELP),
    credentials: jsonObject.optional().describe(CREDENTIALS_HELP),
  }, async (args) => run(() => directory.testDirectoryConnection(svc(), args.provider, { settings: args.settings, credentials: args.credentials })))

  server.tool('directory_sync_start', 'Start a directory sync run now (background). LDAP syncs only changes unless full is true.', {
    provider: syncProvider,
    full: z.boolean().optional().describe('Force a full sync'),
  }, async (args) => run(() => directory.startDirectorySyncRun(svc(), args.provider, { full: args.full })))

  server.tool('directory_sync_runs_list', 'List directory sync runs, newest first, with status, mode (full/delta), stats and errors.', {
    provider: syncProvider.optional(),
    limit: z.number().optional().describe('Page size (1-100, default 50; 0 = no limit)'),
    offset: z.number().optional(),
  }, async (args) => run(() => directory.listDirectorySyncRuns(svc(), resolvePage(args), { provider: args.provider })))

  server.tool('scim_tokens_list', 'List SCIM tokens (name, prefix, scopes, last use, expiry) — never the tokens themselves.', {},
    async () => run(() => directory.listScimTokens(svc())))

  server.tool('scim_tokens_create', 'Create a SCIM bearer token for an identity provider (returned once) and enable SCIM provisioning. Give the IdP the returned scim_url as the tenant URL.', {
    name: z.string().describe('Label, e.g. "Entra ID provisioning"'),
    scopes: z.array(z.enum(SCIM_TOKEN_SCOPES)).optional().describe('Default all four'),
    expires_in_days: z.number().optional().describe('Default: never expires'),
  }, async (args) => run(() => directory.createScimToken(svc(), args)))

  server.tool('scim_tokens_rotate', 'Replace a SCIM token with a new one (same name and scopes, returned once); the old one stops working now or after grace_minutes.', {
    token_id: z.string().describe('SCIM token ID'),
    grace_minutes: z.number().optional().describe('Default 0'),
  }, async (args) => run(() => directory.rotateScimToken(svc(), args.token_id, { grace_minutes: args.grace_minutes })))

  server.tool('scim_tokens_delete', 'Revoke and delete a SCIM token.', {
    token_id: z.string().describe('SCIM token ID'),
  }, async (args) => run(() => directory.deleteScimToken(svc(), args.token_id)))
}
