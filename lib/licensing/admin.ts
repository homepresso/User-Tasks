/**
 * Licence administration for the app: Settings → Licence (instance admins)
 * and /api/v1/licence (instance admin token). Callers authorise first; these
 * functions act at the instance level with the service-role client.
 */

import type { z } from 'zod'
import { grantEntitlementBody } from '@/lib/api-schemas/licence'
import { ServiceError } from '@/lib/services/context'
import { getDeploymentMode } from '@/lib/deployment'
import { getInstanceSetting, setInstanceSetting } from '@/lib/config/instance-settings'
import { activationRequest, checkInstallable, type ActivationRequest } from './install'
import { LICENCES_SETTING, mergeLicence, removeLicence, storedLicences } from './store'
import { getLicenceStatus, invalidateLicenceCache, invalidateTenantEntitlements, licensingDeps, type LicenceStatus, type LicenceSummary } from './service'
import { usageFor } from './limits'
import type { TenantEntitlementRow } from './types'

export interface Actor {
  /** User id when a person did it. */
  actorId?: string | null
  /** Label for the audit trail (`api`, the user's email, …). */
  actor: string
}

export interface LicenceStatusView extends LicenceStatus {
  /** Usage per limit key (null = the extension registered no counter). */
  usage: Record<string, number | null>
}

export async function licenceStatusView(options: { fresh?: boolean } = {}): Promise<LicenceStatusView> {
  const status = await getLicenceStatus(options)
  const keys = [...new Set(status.extensions.flatMap((e) => Object.keys(e.limits)))]
  return { ...status, usage: await usageFor(keys, null) }
}

export interface InstallResult {
  licence: LicenceSummary
  replaced: boolean
  notes: string[]
}

export async function installLicence(text: string, who: Actor): Promise<InstallResult> {
  if (typeof text !== 'string' || !text.trim()) throw ServiceError.validation('Paste or upload the licence file')
  if (text.length > 64_000) throw ServiceError.validation('That is too large to be a licence file')
  const identity = await licensingDeps.identity()
  const check = checkInstallable(text, identity, licensingDeps.now(), licensingDeps.keyring())
  if (!check.ok || !check.licence || !check.summary) {
    throw new ServiceError('validation_error', `Licence not installed: ${check.problems.map((p) => p.message).join('; ')}`, { details: { problems: check.problems } })
  }
  const current = storedLicences(await getInstanceSetting(LICENCES_SETTING))
  const { next, replaced } = mergeLicence(current, check.licence)
  await setInstanceSetting(LICENCES_SETTING, next, { updatedBy: who.actorId ?? null })
  invalidateLicenceCache()
  await licensingDeps.audit({
    event: replaced ? 'replaced' : 'installed',
    licenceId: check.licence.licence_id,
    actorId: who.actorId,
    actor: who.actor,
    summary: `${replaced ? 'Replaced' : 'Installed'} licence ${check.licence.licence_id} (${check.licence.customer.name}; ${check.licence.extensions.map((e) => e.id).join(', ')}; expires ${check.licence.expires_at})`,
    detail: { expires_at: check.licence.expires_at, extensions: check.licence.extensions.map((e) => e.id), kid: check.licence.kid },
  })
  return { licence: check.summary, replaced, notes: check.notes }
}

export async function removeInstalledLicence(licenceId: string | null, who: Actor): Promise<{ removed: string[] }> {
  const current = storedLicences(await getInstanceSetting(LICENCES_SETTING))
  const { next, removed } = removeLicence(current, licenceId)
  if (licenceId && !removed.length) throw ServiceError.notFound(`No installed licence ${licenceId} (licences from USERTASKS_LICENCE / USERTASKS_LICENCE_FILE are removed by unsetting the variable)`)
  if (!removed.length) return { removed }
  await setInstanceSetting(LICENCES_SETTING, next, { updatedBy: who.actorId ?? null })
  invalidateLicenceCache()
  for (const id of removed) {
    await licensingDeps.audit({ event: 'removed', licenceId: id, actorId: who.actorId, actor: who.actor, summary: `Removed licence ${id}` })
  }
  return { removed }
}

export async function licenceActivationRequest(): Promise<ActivationRequest> {
  const status = await getLicenceStatus()
  return activationRequest({
    identity: status.instance,
    installed: status.licences.map((l) => l.licenceId).filter((id): id is string => Boolean(id)),
    now: licensingDeps.now(),
    deploymentMode: getDeploymentMode(),
  })
}

// ─── Cloud entitlements (tenant_entitlements) ──────────────────────────────

export const EntitlementGrantSchema = grantEntitlementBody
export type EntitlementGrant = z.infer<typeof EntitlementGrantSchema>

async function db() {
  const { requireServiceDb } = await import('@/lib/providers/db')
  return requireServiceDb()
}

const COLUMNS = 'id, tenant_id, extension_id, edition, features, limits, status, source, starts_at, ends_at, notes, created_at, updated_at, updated_by'

export async function listTenantEntitlements(filter: { tenantId?: string; extensionId?: string } = {}): Promise<TenantEntitlementRow[]> {
  let query = (await db()).from('tenant_entitlements').select(COLUMNS).order('created_at', { ascending: false }).limit(500)
  if (filter.tenantId) query = query.eq('tenant_id', filter.tenantId)
  if (filter.extensionId) query = query.eq('extension_id', filter.extensionId)
  const { data, error } = await query
  if (error) throw new ServiceError('internal', `tenant_entitlements: ${error.message}`)
  return (data ?? []) as TenantEntitlementRow[]
}

/** Grant or update a workspace's entitlement (one row per workspace and extension). */
export async function grantTenantEntitlement(input: EntitlementGrant, who: Actor): Promise<TenantEntitlementRow> {
  const body = EntitlementGrantSchema.parse(input)
  const client = await db()
  const { data: tenant } = await client.from('tenants').select('id').eq('id', body.tenant_id).maybeSingle()
  if (!tenant) throw ServiceError.notFound(`No workspace ${body.tenant_id}`)
  const row = {
    tenant_id: body.tenant_id,
    extension_id: body.extension_id,
    edition: body.edition ?? null,
    features: body.features ?? [],
    limits: body.limits ?? {},
    status: body.status ?? 'active',
    source: body.source ?? 'admin',
    starts_at: body.starts_at ?? null,
    ends_at: body.ends_at ?? null,
    notes: body.notes ?? null,
    updated_at: new Date().toISOString(),
    updated_by: who.actorId ?? null,
  }
  const { data, error } = await client.from('tenant_entitlements').upsert(row, { onConflict: 'tenant_id,extension_id' }).select(COLUMNS).single()
  if (error) throw new ServiceError('internal', `tenant_entitlements: ${error.message}`)
  await invalidateTenantEntitlements(body.tenant_id)
  await licensingDeps.audit({
    event: 'entitlement_granted', extensionId: body.extension_id, tenantId: body.tenant_id, actorId: who.actorId, actor: who.actor,
    summary: `Entitlement ${body.extension_id} ${row.status}${row.ends_at ? ` until ${row.ends_at}` : ''} (${row.source})`,
    detail: { status: row.status, source: row.source, ends_at: row.ends_at, limits: row.limits, features: row.features },
  })
  return data as TenantEntitlementRow
}

export async function revokeTenantEntitlement(tenantId: string, extensionId: string, who: Actor): Promise<{ deleted: boolean }> {
  const client = await db()
  const { data, error } = await client.from('tenant_entitlements').delete().eq('tenant_id', tenantId).eq('extension_id', extensionId).select('id')
  if (error) throw new ServiceError('internal', `tenant_entitlements: ${error.message}`)
  const deleted = Array.isArray(data) && data.length > 0
  if (!deleted) throw ServiceError.notFound(`No ${extensionId} entitlement for workspace ${tenantId}`)
  await invalidateTenantEntitlements(tenantId)
  await licensingDeps.audit({ event: 'entitlement_revoked', extensionId, tenantId, actorId: who.actorId, actor: who.actor, summary: `Entitlement ${extensionId} removed` })
  return { deleted }
}
