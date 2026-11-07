/**
 * Directory groups for workflow task assignment (AAD group User Tasks):
 * the capability the designer checks before it offers "AAD Group", and the
 * Entra group search behind its picker. Shared by the designer (ui-reads
 * directory.capabilities / directory.entraGroups), REST
 * (/api/v1/directory-sync/capabilities, /api/v1/directory-sync/entra/groups)
 * and MCP (directory_entra_groups_search).
 *
 * Permission: workflows.view or settings.view (people who build workflows
 * need the picker; they need not manage the directory connection).
 * tenant_connectors and directory_links are read with a service-role client
 * and an explicit tenant filter (lib/directory-sync/entra-groups.ts).
 */

import { EntraGroupsUnavailableError, entraGroupCapabilities, searchEntraGroups, type EntraGroupSearchResult } from '@/lib/directory-sync/entra-groups'
import { DirectoryApiError } from '@/lib/directory-sync/types'
import type { DirectoryCapabilities } from '@/lib/tasks/aad-group-assignment'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

function requireViewer(ctx: ServiceContext) {
  if (hasPerm(ctx, 'workflows.view') || hasPerm(ctx, 'settings.view')) return
  requirePerm(ctx, 'workflows.view')
}

/** What the workspace's directory connections make available to workflows. */
export async function getDirectoryCapabilities(ctx: ServiceContext): Promise<DirectoryCapabilities> {
  requireViewer(ctx)
  if (!ctx.tenantId) return { entraGroups: false, syncedGroups: false }
  const db = await serviceRoleClient(ctx)
  return entraGroupCapabilities(db as any, ctx.tenantId)
}

/** Search the workspace's Entra ID groups (synced groups when the connection syncs them, else Microsoft Graph). */
export async function searchDirectoryEntraGroups(
  ctx: ServiceContext,
  input: { search?: string | null; limit?: number | null; cursor?: string | null } = {},
): Promise<EntraGroupSearchResult> {
  requireViewer(ctx)
  if (!ctx.tenantId) throw ServiceError.validation('Choose a workspace first')
  const db = await serviceRoleClient(ctx)
  try {
    return await searchEntraGroups(db as any, ctx.tenantId, input)
  } catch (error) {
    if (error instanceof EntraGroupsUnavailableError) throw new ServiceError('conflict', 'Entra ID is not configured for this workspace')
    if (error instanceof DirectoryApiError) {
      if (error.status === 400) throw ServiceError.validation(error.message)
      if (error.status === 401 || error.status === 403) {
        throw new ServiceError('conflict', `Microsoft Graph refused the group search — grant the app registration GroupMember.Read.All (or Group.Read.All) as an application permission with admin consent. ${error.message}`)
      }
      throw new ServiceError('internal', `Microsoft Graph group search failed: ${error.message}`)
    }
    throw error
  }
}
