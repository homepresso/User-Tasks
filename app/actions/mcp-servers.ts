'use server'

import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { requireTenant } from '@/lib/actions/require-tenant'

export async function addMcpServer(input: {
  name: string
  url: string
  authType: 'none' | 'bearer' | 'api_key'
  token?: string
}) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const name = input.name.trim()
  const url = input.url.trim()
  if (!name || !url) throw new Error('Name and URL are required')
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { throw new Error('Invalid URL') }
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) {
    throw new Error('Private network URLs are not allowed')
  }

  const authConfig = input.authType === 'bearer'
    ? { token: input.token ?? '' }
    : input.authType === 'api_key'
      ? { key_name: 'X-API-Key', key_value: input.token ?? '' }
      : {}

  const { data, error } = await (supabase as any)
    .from('mcp_servers')
    .insert({
      tenant_id: tenantId,
      name,
      url,
      auth_type: input.authType,
      auth_config: authConfig,
      is_active: true,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message ?? 'Failed to add server')

  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'mcp_server', objectId: data.id,
    action: 'create', summary: `Added MCP server "${name}"`,
  })
  void recordAssetChange({ supabase, tenantId, assetType: 'mcp_server', assetId: data.id, assetName: name, action: 'save', actorId: user.id })
  return data.id as string
}

export async function deleteMcpServer(serverId: string) {
  await requirePermission('settings.edit')
  const { supabase, user, tenantId } = await requireTenant()

  const { data: server } = await (supabase as any)
    .from('mcp_servers')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', serverId)
    .maybeSingle()

  const { error } = await (supabase as any)
    .from('mcp_servers')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', serverId)
  if (error) throw new Error(error.message ?? 'Failed to delete server')

  await writeAudit({
    supabase, tenantId, actorId: user.id,
    objectType: 'mcp_server', objectId: serverId,
    action: 'delete', summary: `Deleted MCP server "${(server as any)?.name ?? serverId}"`,
  })
  void recordAssetChange({ supabase, tenantId, assetType: 'mcp_server', assetId: serverId, assetName: (server as any)?.name ?? null, action: 'delete', actorId: user.id })
}
