'use server'

import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { requireTenant } from '@/lib/actions/require-tenant'
import { encryptSensitiveFields } from '@/lib/secret-fields'
import { findRecentDuplicate } from '@/lib/recent-duplicate'

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
  try {
    const { assertSafeEgressUrl } = await import('@/lib/egress-guard')
    await assertSafeEgressUrl(url)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'That URL is not allowed')
  }

  const authConfig = input.authType === 'bearer'
    ? { token: input.token ?? '' }
    : input.authType === 'api_key'
      ? { key_name: 'X-API-Key', key_value: input.token ?? '' }
      : {}

  // A repeated submit (double click, retry) must not add the same server twice
  // (created_by isn't stored, so match tenant + name + URL).
  const recent = await findRecentDuplicate<{ id: string }>(supabase, 'mcp_servers', { tenant_id: tenantId, name, url })
  if (recent) return recent.id

  const { data, error } = await (supabase as any)
    .from('mcp_servers')
    .insert({
      tenant_id: tenantId,
      name,
      url,
      auth_type: input.authType,
      // Credentials are encrypted at rest (decrypted only when an agent calls the server).
      auth_config: encryptSensitiveFields(authConfig),
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
