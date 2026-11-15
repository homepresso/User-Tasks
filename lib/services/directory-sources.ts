/**
 * Directory sources contributed by extensions (e.g. SharePoint groups and
 * people): their state, their directory entries (pending first sign-in /
 * linked / inactive) and "sync now". Shared by /api/v1/directory-sync/sources,
 * the MCP directory_source* tools and Settings → SSO & Directory.
 *
 * Permissions: reads need settings.view, sync settings.edit. The tables are
 * service-role only; every query filters the workspace
 * (lib/directory-sync/sources.ts).
 */

import {
  directorySourceAccess,
  directorySourceStatus,
  getDirectorySource,
  listDirectoryEntries,
  listDirectorySources,
  requestDirectorySourceSync,
  type RegisteredDirectorySource,
} from '@/lib/directory-sync/sources'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, serviceRoleClient, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows */

export interface DirectorySourceView {
  source: string
  extension_id: string
  extension_name: string
  label: string
  description: string | null
  /** The extension is enabled and licensed (with the source's feature) in this workspace. */
  available: boolean
  unavailable_reason: string | null
  interval_minutes: number
  last_sync_at: string | null
  last_full_sync_at: string | null
  last_error: string | null
  last_sync_stats: Record<string, number> | null
  active_run_id: string | null
  linked_users: number
  pending_entries: number
  groups: number
}

function requireSource(raw: string): RegisteredDirectorySource {
  const source = getDirectorySource(String(raw ?? ''))
  if (!source) throw ServiceError.notFound(`Unknown directory source "${String(raw)}" (ext.<extension>.<key> of an installed extension)`)
  return source
}

async function view(ctx: ServiceContext, db: any, source: RegisteredDirectorySource): Promise<DirectorySourceView> {
  const access = await directorySourceAccess(ctx.tenantId, source)
  const status = await directorySourceStatus(db, ctx.tenantId, source.id).catch(() => null)
  return {
    source: source.id,
    extension_id: source.extensionId,
    extension_name: source.extensionName,
    label: source.label,
    description: source.description ?? null,
    available: access.usable,
    unavailable_reason: access.usable ? null : access.reason,
    interval_minutes: source.intervalMinutes,
    last_sync_at: status?.lastSyncAt ?? null,
    last_full_sync_at: status?.lastFullSyncAt ?? null,
    last_error: status?.lastError ?? null,
    last_sync_stats: status?.stats ?? null,
    active_run_id: status?.activeRunId ?? null,
    linked_users: status?.counts.linked ?? 0,
    pending_entries: status?.counts.pending ?? 0,
    groups: status?.counts.groups ?? 0,
  }
}

export async function listDirectorySourceViews(ctx: ServiceContext): Promise<{ sources: DirectorySourceView[]; total: number }> {
  requirePerm(ctx, 'settings.view')
  const sources = listDirectorySources()
  if (!sources.length) return { sources: [], total: 0 }
  const db = await serviceRoleClient(ctx)
  const views = await Promise.all(sources.map((s) => view(ctx, db, s)))
  return { sources: views, total: views.length }
}

export async function listDirectorySourceEntries(
  ctx: ServiceContext,
  rawSource: string,
  page: Page,
  filters: { status?: 'pending' | 'linked' | 'inactive' | null; search?: string | null } = {},
): Promise<{ entries: any[]; total: number }> {
  requirePerm(ctx, 'settings.view')
  const source = requireSource(rawSource)
  const db = await serviceRoleClient(ctx)
  try {
    return await listDirectoryEntries(db as any, ctx.tenantId, source.id, { status: filters.status ?? null, search: filters.search ?? null, limit: page.limit ?? 1000, offset: page.offset })
  } catch (error) {
    throw new ServiceError('conflict', (error as Error).message)
  }
}

export async function startDirectorySourceSync(ctx: ServiceContext, rawSource: string, input: { full?: boolean } = {}): Promise<{ run_id: string; already_running: boolean }> {
  requirePerm(ctx, 'settings.edit')
  const source = requireSource(rawSource)
  const db = await serviceRoleClient(ctx)
  const result = await requestDirectorySourceSync(db as any, ctx.tenantId, source.id, { full: input.full, actorId: ctx.actorId })
  if (result.runId && (result.queued || result.reason === 'already_running')) {
    if (result.queued) await audit(ctx, { objectType: 'directory_sync', objectId: source.id, action: 'sync', summary: `Started a ${source.label} directory sync${input.full ? ' (full)' : ''}` })
    return { run_id: result.runId, already_running: !result.queued }
  }
  throw new ServiceError('conflict', result.reason && result.reason !== 'unknown_source' ? result.reason : `${source.label} cannot sync in this workspace`)
}
