/**
 * Per-workspace extension state (tenant_extensions) and the one access
 * decision every framework gate uses:
 *
 *   usable = in this build ∧ compatible ∧ built for this deployment mode
 *            ∧ enabled in the workspace ∧ entitled (entitlement port)
 *
 * Rows are cached per workspace for 15 s (invalidated on every change made
 * through lib/services/extensions.ts on this instance). With no extensions
 * in the build nothing here touches the database.
 *
 * Server-only.
 */

import { getServiceDb } from '@/lib/providers/db'
import { getEntitlementPort, type EntitlementDecision } from './entitlement-port'
import { getExtensionManifest, hasExtensions } from './registry'
import { isExtensionRunnable } from './server-registry'
import { ServiceError } from '@/lib/services/context'
import { LicenceDeniedError, LicenceExpiredError } from '@/lib/licensing/errors'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenant_extensions is not in the generated Database types */

export interface TenantExtensionRow {
  extension_id: string
  enabled: boolean
  config: Record<string, unknown>
  config_version: number
  enabled_at: string | null
  disabled_at: string | null
  updated_at: string | null
}

export const TENANT_EXTENSION_COLUMNS = 'extension_id, enabled, config, config_version, enabled_at, disabled_at, updated_at'
const TTL_MS = 15_000

type Rows = { rows: Map<string, TenantExtensionRow>; missingTable: boolean }
const cache = new Map<string, { expiresAt: number; value: Promise<Rows> }>()

/** Postgres "undefined_table" (the migration is not applied yet). */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /relation .* does not exist|could not find the table/i.test(error.message ?? '')))
}

async function fetchRows(tenantId: string): Promise<Rows> {
  const { data, error } = await (getServiceDb() as any).from('tenant_extensions').select(TENANT_EXTENSION_COLUMNS).eq('tenant_id', tenantId)
  if (error) {
    if (isMissingTable(error)) return { rows: new Map(), missingTable: true }
    throw new Error(error.message)
  }
  const rows = new Map<string, TenantExtensionRow>()
  for (const row of (data ?? []) as TenantExtensionRow[]) rows.set(row.extension_id, { ...row, config: (row.config ?? {}) as Record<string, unknown> })
  return { rows, missingTable: false }
}

/** The workspace's tenant_extensions rows (cached). */
export async function loadTenantExtensions(tenantId: string): Promise<Rows> {
  if (!hasExtensions() || !tenantId) return { rows: new Map(), missingTable: false }
  const hit = cache.get(tenantId)
  if (hit && hit.expiresAt > Date.now()) return hit.value
  const entry = { expiresAt: Date.now() + TTL_MS, value: fetchRows(tenantId) }
  cache.set(tenantId, entry)
  entry.value.catch(() => { if (cache.get(tenantId) === entry) cache.delete(tenantId) })
  return entry.value
}

export function invalidateTenantExtensions(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

export interface ExtensionAccess {
  usable: boolean
  installed: boolean
  runnable: boolean
  enabled: boolean
  entitlement: EntitlementDecision
  /** Why not usable (for 402/403 responses and the admin page). */
  reason: string | null
  /** HTTP status a denied API call answers with. */
  status: 200 | 402 | 403 | 404
  /**
   * Error code a denied call answers with: an expired licence (past the
   * 24-hour cutoff; retryable once renewed) and a missing one are distinct.
   */
  code: ExtensionAccessCode | null
}

export type ExtensionAccessCode = 'extension_licence_expired' | 'extension_not_licensed' | 'extension_disabled' | 'not_found'

function accessCode(status: ExtensionAccess['status'], entitlement: EntitlementDecision): ExtensionAccessCode | null {
  if (status === 200) return null
  if (status === 404) return 'not_found'
  if (status === 403) return 'extension_disabled'
  return entitlement.state === 'expired' ? 'extension_licence_expired' : 'extension_not_licensed'
}

/**
 * The error a denied access throws (service layer, MCP, workflow engine):
 * 402 extension_licence_expired (LicenceExpiredError, retryable) /
 * extension_not_licensed (LicenceDeniedError), 403 forbidden with details
 * code extension_disabled, 404 not_found.
 */
export function extensionAccessError(access: ExtensionAccess, extensionId: string, feature?: string): ServiceError {
  const reason = access.reason ?? 'Extension not available'
  switch (access.code) {
    case 'extension_licence_expired':
      return new LicenceExpiredError(extensionId, { ...access.entitlement, reason }, feature)
    case 'extension_not_licensed':
      return new LicenceDeniedError(extensionId, { ...access.entitlement, state: access.entitlement.state === 'expired' ? 'unlicensed' : access.entitlement.state, reason }, feature)
    case 'not_found':
      return new ServiceError('not_found', reason, { details: { code: 'not_found', extension_id: extensionId } })
    default:
      return new ServiceError('forbidden', reason, { details: { code: 'extension_disabled', extension_id: extensionId } })
  }
}

/** May this workspace use this extension (and feature) right now? */
export async function extensionAccess(tenantId: string | null, extensionId: string, feature?: string): Promise<ExtensionAccess> {
  const manifest = getExtensionManifest(extensionId)
  const denied = (reason: string, status: ExtensionAccess['status'], extra: Partial<ExtensionAccess> = {}): ExtensionAccess => {
    const entitlement = extra.entitlement ?? { allowed: false, state: 'unlicensed', reason }
    return {
      usable: false, installed: Boolean(manifest), runnable: false, enabled: false,
      entitlement, reason, status, code: accessCode(status, entitlement), ...extra,
    }
  }
  if (!manifest) return denied(`Extension "${extensionId}" is not installed`, 404)
  if (!isExtensionRunnable(extensionId)) return denied(`Extension "${extensionId}" cannot run in this build (see Settings → Extensions)`, 404, { installed: true })
  const entitlement = await getEntitlementPort().check({ tenantId, extensionId, feature })
  if (!tenantId) {
    return entitlement.allowed
      ? { usable: true, installed: true, runnable: true, enabled: true, entitlement, reason: null, status: 200, code: null }
      : denied(entitlement.reason ?? 'Not licensed', 402, { installed: true, runnable: true, entitlement })
  }
  const { rows } = await loadTenantExtensions(tenantId)
  const enabled = rows.get(extensionId)?.enabled === true
  if (!enabled) return denied(`${manifest.name} is not enabled in this workspace (Settings → Extensions)`, 403, { installed: true, runnable: true, entitlement })
  if (!entitlement.allowed) return denied(entitlement.reason ?? `${manifest.name} is not licensed`, 402, { installed: true, runnable: true, enabled: true, entitlement })
  return { usable: true, installed: true, runnable: true, enabled: true, entitlement, reason: null, status: 200, code: null }
}

/** Ids of the extensions this workspace may use now. */
export async function usableExtensionIds(tenantId: string): Promise<string[]> {
  if (!hasExtensions() || !tenantId) return []
  const { rows } = await loadTenantExtensions(tenantId)
  const ids: string[] = []
  for (const row of rows.values()) {
    if (!row.enabled) continue
    if ((await extensionAccess(tenantId, row.extension_id)).usable) ids.push(row.extension_id)
  }
  return ids
}

/** Workspaces with the extension enabled (jobs, event dispatch). */
export async function tenantsWithExtension(extensionId: string): Promise<string[]> {
  if (!hasExtensions()) return []
  const { data, error } = await (getServiceDb() as any).from('tenant_extensions').select('tenant_id').eq('extension_id', extensionId).eq('enabled', true).limit(10_000)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id)
}
