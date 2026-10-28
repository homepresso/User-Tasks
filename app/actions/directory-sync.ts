'use server'

import { getUserPermissions } from '@/lib/permissions-server'
import * as directory from '@/lib/services/directory-sync'
import { fromSession, isServiceError } from '@/lib/services/context'
import type { DirectoryLinkProvider } from '@/lib/directory-sync/types'
import type { LdapTestResult } from '@/lib/directory-sync/ldap'

/*
 * Settings → SSO & Directory server actions: thin wrappers over
 * lib/services/directory-sync (shared with /api/v1/directory-sync, MCP and
 * the CLI), which verifies connections before saving, masks credentials and
 * audits every change. Expected failures come back as { ok: false, error }
 * so their messages survive production builds (thrown Server Function errors
 * are redacted there).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}

export type DirectoryProviderId = DirectoryLinkProvider

export interface DirectoryConnectionSummary {
  provider: DirectoryProviderId
  orgName: string | null
  syncGroups: boolean
  autoProvision: boolean
  lastSyncAt: string | null
  lastSyncStats: Record<string, number> | null
  isEnabled: boolean
  /** Non-secret provider settings (only for settings.view). */
  settings: Record<string, unknown> | null
  /** Masked credentials (only for settings.view). */
  credentials: Record<string, unknown> | null
  linkedUsers: number
  linkedGroups: number
}

export interface DirectorySyncRun {
  id: string
  provider: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  mode: 'full' | 'delta' | null
  progress: { phase: string; message: string } | null
  stats: Record<string, number> | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export interface ScimTokenRow {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
}

// ── Status ───────────────────────────────────────────────────────────────────

export async function getDirectorySyncStatus(): Promise<{
  connections: DirectoryConnectionSummary[]
  runs: DirectorySyncRun[]
  counts: { linkedUsers: number; linkedGroups: number }
  scimTokens: ScimTokenRow[]
  scimUrl: string
  canViewSettings: boolean
}> {
  const perms = await getUserPermissions()
  if (!perms.has('team.view_members') && !perms.has('settings.view')) throw new Error('Forbidden')
  const canViewSettings = perms.has('settings.view')
  // team.view_members may see the sync state (as before); settings and
  // credentials (masked) and the SCIM tokens only with settings.view.
  const session = await fromSession()
  const ctx = { ...session, permissions: new Set([...(session.permissions ?? []), 'settings.view']) }

  const [list, runs, tokens] = await Promise.all([
    directory.listDirectoryConnections(ctx),
    directory.listDirectorySyncRuns(ctx, { limit: 20, offset: 0 }).catch(() => ({ runs: [] as DirectorySyncRun[], total: 0 })),
    canViewSettings ? directory.listScimTokens(ctx).catch(() => ({ scim_tokens: [], total: 0 })) : Promise.resolve({ scim_tokens: [], total: 0 }),
  ])
  const connections = list.connections.map((c) => ({
    provider: c.provider,
    orgName: c.org_name,
    syncGroups: c.sync_groups,
    autoProvision: c.auto_provision,
    lastSyncAt: c.last_sync_at,
    lastSyncStats: c.last_sync_stats,
    isEnabled: c.enabled,
    settings: canViewSettings ? c.settings : null,
    credentials: canViewSettings ? c.credentials : null,
    linkedUsers: c.linked_users,
    linkedGroups: c.linked_groups,
  }))
  return {
    connections,
    runs: runs.runs as DirectorySyncRun[],
    counts: connections.reduce((acc, c) => ({ linkedUsers: acc.linkedUsers + c.linkedUsers, linkedGroups: acc.linkedGroups + c.linkedGroups }), { linkedUsers: 0, linkedGroups: 0 }),
    scimTokens: tokens.scim_tokens as ScimTokenRow[],
    scimUrl: list.scim_url,
    canViewSettings,
  }
}

// ── Connect / configure ──────────────────────────────────────────────────────

export interface ConnectInput {
  provider: DirectoryProviderId
  settings?: Record<string, unknown>
  credentials?: Record<string, unknown>
  syncGroups: boolean
  autoProvision: boolean
}

export async function connectDirectory(input: ConnectInput): Promise<ActionResult<{ orgName: string | null; test: LdapTestResult | null }>> {
  return run(async () => {
    const result = await directory.createDirectoryConnection(await fromSession(), {
      provider: input.provider,
      settings: input.settings,
      credentials: input.credentials,
      sync_groups: Boolean(input.syncGroups),
      auto_provision: Boolean(input.autoProvision),
    })
    return { orgName: result.connection.org_name, test: result.test ?? null }
  })
}

export async function updateDirectoryConnection(
  provider: DirectoryProviderId,
  input: { settings?: Record<string, unknown>; credentials?: Record<string, unknown>; syncGroups?: boolean; autoProvision?: boolean },
): Promise<ActionResult<{ changed: boolean }>> {
  return run(async () => {
    const result = await directory.updateDirectoryConnection(await fromSession(), provider, {
      settings: input.settings,
      credentials: input.credentials,
      ...(input.syncGroups !== undefined ? { sync_groups: input.syncGroups } : {}),
      ...(input.autoProvision !== undefined ? { auto_provision: input.autoProvision } : {}),
    })
    return { changed: result.changed }
  })
}

export async function updateDirectoryOptions(
  provider: DirectoryProviderId,
  options: { syncGroups?: boolean; autoProvision?: boolean },
): Promise<ActionResult<{ changed: boolean }>> {
  return updateDirectoryConnection(provider, options)
}

export async function testDirectoryConnection(
  provider: Exclude<DirectoryProviderId, 'scim'>,
  input: { settings?: Record<string, unknown>; credentials?: Record<string, unknown> } = {},
): Promise<ActionResult<{ ok: boolean; orgName: string | null; error: string | null; details: LdapTestResult | null }>> {
  return run(async () => {
    const result = await directory.testDirectoryConnection(await fromSession(), provider, input)
    return { ok: result.ok, orgName: result.org_name, error: result.error, details: result.details }
  })
}

export async function disconnectDirectory(provider: DirectoryProviderId): Promise<ActionResult<null>> {
  return run(async () => {
    await directory.deleteDirectoryConnection(await fromSession(), provider)
    return null
  })
}

// ── Sync ─────────────────────────────────────────────────────────────────────

/**
 * Enqueue a background sync run and kick the worker. The run executes in the
 * worker (service client) — provisioning needs the auth admin API.
 */
export async function startDirectorySync(
  provider: Exclude<DirectoryProviderId, 'scim'>,
  options: { full?: boolean } = {},
): Promise<ActionResult<{ runId: string; alreadyRunning: boolean }>> {
  return run(async () => {
    const result = await directory.startDirectorySyncRun(await fromSession(), provider, options)
    return { runId: result.run_id, alreadyRunning: result.already_running }
  })
}

// ── SCIM tokens ──────────────────────────────────────────────────────────────

export async function createScimToken(input: { name: string; scopes?: string[]; expiresInDays?: number }): Promise<ActionResult<{ token: string; scimUrl: string }>> {
  return run(async () => {
    const result = await directory.createScimToken(await fromSession(), { name: input.name, scopes: input.scopes, expires_in_days: input.expiresInDays })
    return { token: result.token, scimUrl: result.scim_url }
  })
}

export async function rotateScimToken(id: string, graceMinutes = 0): Promise<ActionResult<{ token: string }>> {
  return run(async () => ({ token: (await directory.rotateScimToken(await fromSession(), id, { grace_minutes: graceMinutes })).token }))
}

export async function revokeScimToken(id: string): Promise<ActionResult<null>> {
  return run(async () => {
    await directory.deleteScimToken(await fromSession(), id)
    return null
  })
}
