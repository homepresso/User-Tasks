import type { McpToolServer } from '../server'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import * as apiKeys from '@/lib/services/api-keys'
import { messageOf } from './_util'

/*
 * API key tools: thin wrappers over lib/services/api-keys, which caps new
 * keys to the caller (permissions, resource scopes, key type, OAuth
 * keys:write + 90-day expiry), rate-limits creation and audits every change.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

export function registerApiKeyTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('api_keys_list', 'List API keys for this tenant. Shows id, name, key_prefix, status, expires_at, last_used_at, key_type, user_id, permissions and scopes. The full key is never exposed after creation.', {}, async () => run(async () => {
    const { api_keys: rows } = await apiKeys.listApiKeys(svc(), {}, { limit: null, offset: 0 })
    return { api_keys: rows, count: rows.length }
  }))

  server.tool('api_keys_create', 'Generate a new API key. The plain key is returned only in this response and cannot be retrieved later. Store it securely. The new key can never hold permissions or resource scopes the calling key lacks; user-context callers can only create user keys for themselves.', {
    name: z.string().describe('Human-readable name for the API key'),
    expires_in_days: z.number().optional().describe('Number of days until the key expires (optional, no expiry if omitted; required and at most 90 for OAuth callers)'),
    key_type: z.enum(['tenant', 'user']).optional().describe('Tenant-wide key or user-context key'),
    user_id: z.string().optional().describe('Required for user-context keys. API and MCP actions execute as this UserTasks user (must belong to this tenant).'),
    permissions: z.array(z.string()).optional().describe('Optional least-privilege permission keys for the new key; must be a subset of the calling key\'s permissions. Omit to inherit the caller\'s permissions.'),
    workflow_ids: z.array(z.string()).optional().describe('Optional workflow IDs the key can access'),
    table_ids: z.array(z.string()).optional().describe('Optional data table IDs the key can access'),
  }, async (args) => run(async () => {
    const { api_key, key } = await apiKeys.createApiKey(svc(), args)
    return { created: true, api_key, key }
  }))

  server.tool('api_keys_revoke', 'Revoke an API key by ID. The key will no longer be valid for authentication.', {
    api_key_id: z.string().describe('API key ID to revoke'),
  }, async (args) => run(async () => {
    await apiKeys.revokeApiKey(svc(), args.api_key_id)
    return { revoked: true, api_key_id: args.api_key_id }
  }))

  server.tool('api_keys_delete', 'Permanently delete an API key (revoke it first to keep an audit trail of the key row).', {
    api_key_id: z.string().describe('API key ID to delete'),
  }, async (args) => run(() => apiKeys.deleteApiKey(svc(), args.api_key_id)))
}
