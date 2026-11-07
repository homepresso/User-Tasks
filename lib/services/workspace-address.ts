/**
 * Workspace address (tenants.subdomain → acme.usertasks.com): read, check,
 * change, and resolve a request host's subdomain to its workspace.
 *
 *  - Any member reads the address (the form URL panel shows it); changing it
 *    needs settings.edit and is audited. The old address keeps redirecting
 *    for a year (tenant_subdomain_history, written by a trigger) and nobody
 *    else can take it in that time.
 *  - Availability: valid (lib/workspace-address.ts subdomainProblem), not a
 *    live workspace's address, not another workspace's retired address of
 *    the last year.
 *
 * Migration 20261223000000_workspace_subdomains.sql.
 */

import {
  baseDomainFromEnv, isValidSubdomain, subdomainProblem, workspaceOrigin,
} from '@/lib/workspace-address'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.subdomain / history tables are not in the generated types */

/** Retired addresses redirect, and stay reserved for their workspace, this long. */
export const SUBDOMAIN_HISTORY_DAYS = 365

/** Injected for tests: the service client used by host resolution (no ServiceContext there). */
export const addressDeps = {
  serviceClient: async (): Promise<AnySupabaseClient> => (await import('@/lib/cron-auth')).createServiceClient() as AnySupabaseClient,
  now: () => Date.now(),
}

export interface WorkspaceAddress {
  /** Subdomains are on for this instance (a base domain is configured). */
  enabled: boolean
  base_domain: string | null
  subdomain: string | null
  /** https://<subdomain>.<base domain>, when both are set. */
  url: string | null
}

export interface SubdomainCheck {
  subdomain: string
  available: boolean
  /** Why not (format, reserved, taken), when not available. */
  reason: string | null
}

function historyCutoff(): string {
  return new Date(addressDeps.now() - SUBDOMAIN_HISTORY_DAYS * 86_400_000).toISOString()
}

/** The address URL for a subdomain on this instance, or null when subdomains are off. */
export function workspaceUrlFor(subdomain: string | null | undefined): string | null {
  const base = baseDomainFromEnv()
  if (!base || !subdomain) return null
  return workspaceOrigin(subdomain, base, configuredAppUrl())
}

function present(subdomain: string | null): WorkspaceAddress {
  const base = baseDomainFromEnv()
  return { enabled: Boolean(base), base_domain: base, subdomain, url: workspaceUrlFor(subdomain) }
}

async function readSubdomain(db: AnySupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await (db as any).from('tenants').select('subdomain').eq('id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  return (data.subdomain ?? null) as string | null
}

/** The current workspace's address (any member). */
export async function getWorkspaceAddress(ctx: ServiceContext): Promise<WorkspaceAddress> {
  const db = await serviceRoleClient(ctx)
  return present(await readSubdomain(db, ctx.tenantId))
}

async function availability(db: AnySupabaseClient, tenantId: string, subdomain: string): Promise<string | null> {
  const problem = subdomainProblem(subdomain)
  if (problem) return problem
  const { data: live, error } = await (db as any).from('tenants').select('id').eq('subdomain', subdomain).is('deleted_at', null).neq('id', tenantId).limit(1)
  if (error) throw dbError(error)
  if ((live ?? []).length) return 'That address is taken.'
  const { data: retired, error: historyError } = await (db as any).from('tenant_subdomain_history').select('tenant_id, retired_at')
    .eq('subdomain', subdomain).neq('tenant_id', tenantId).gt('retired_at', historyCutoff()).limit(1)
  if (historyError) throw dbError(historyError)
  if ((retired ?? []).length) return 'That address is taken.'
  return null
}

/** Whether this workspace could take `value` (format, reserved names, taken). Any member. */
export async function checkSubdomain(ctx: ServiceContext, value: unknown): Promise<SubdomainCheck> {
  const subdomain = String(value ?? '').trim().toLowerCase()
  const db = await serviceRoleClient(ctx)
  const reason = await availability(db, ctx.tenantId, subdomain)
  return { subdomain, available: reason === null, reason }
}

/**
 * Set (or clear, with null) the workspace's address. settings.edit; audited.
 * Links to the old address keep redirecting for a year.
 */
export async function setWorkspaceSubdomain(ctx: ServiceContext, value: unknown): Promise<WorkspaceAddress> {
  requirePerm(ctx, 'settings.edit')
  if (value !== null && typeof value !== 'string') throw ServiceError.validation('subdomain must be a string or null')
  const next = value === null ? null : value.trim().toLowerCase()
  const db = await serviceRoleClient(ctx)
  const before = await readSubdomain(db, ctx.tenantId)
  if (next === before) return present(before)
  if (next !== null) {
    const reason = await availability(db, ctx.tenantId, next)
    if (reason) {
      throw reason === 'That address is taken.' ? ServiceError.conflict(reason) : ServiceError.validation(reason)
    }
  }
  const { error } = await (db as any).from('tenants').update({ subdomain: next }).eq('id', ctx.tenantId)
  if (error) {
    if ((error as { code?: string }).code === '23505') throw ServiceError.conflict('That address is taken.')
    throw dbError(error)
  }
  forgetResolved(before)
  forgetResolved(next)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: next ? `Changed the workspace address to ${next}` : 'Removed the workspace address',
    diff: { subdomain: { before, after: next } },
  })
  return present(next)
}

/* ── Host resolution ─────────────────────────────────────────────────── */

export interface HostTenant {
  id: string
  name: string
  slug: string
  subdomain: string
}

export type ResolvedSubdomain =
  | { kind: 'workspace'; tenant: HostTenant }
  /** A retired address: redirect to the workspace's current one. */
  | { kind: 'moved'; subdomain: string }
  | { kind: 'unknown' }

const CACHE_MS = 15_000
const resolvedCache = new Map<string, { at: number; value: ResolvedSubdomain }>()

function forgetResolved(subdomain: string | null) {
  if (subdomain) resolvedCache.delete(subdomain)
}

/** Test hook: drop every cached lookup. */
export function clearResolvedSubdomains() {
  resolvedCache.clear()
}

/**
 * The workspace a subdomain names, a retired address's new one, or
 * unknown. Service role (the visitor may be signed out); cached 15 s per
 * server instance.
 */
export async function resolveSubdomain(label: string): Promise<ResolvedSubdomain> {
  if (!isValidSubdomain(label)) return { kind: 'unknown' }
  const hit = resolvedCache.get(label)
  if (hit && addressDeps.now() - hit.at < CACHE_MS) return hit.value
  const db = await addressDeps.serviceClient()
  let value: ResolvedSubdomain = { kind: 'unknown' }
  const { data: tenant, error } = await (db as any).from('tenants').select('id, name, slug, subdomain')
    .eq('subdomain', label).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (tenant) {
    value = { kind: 'workspace', tenant: { id: String(tenant.id), name: String(tenant.name ?? ''), slug: String(tenant.slug ?? ''), subdomain: label } }
  } else {
    const { data: old } = await (db as any).from('tenant_subdomain_history').select('tenant_id, retired_at')
      .eq('subdomain', label).gt('retired_at', historyCutoff()).maybeSingle()
    if (old) {
      const { data: owner } = await (db as any).from('tenants').select('subdomain').eq('id', old.tenant_id).is('deleted_at', null).maybeSingle()
      if (owner?.subdomain && owner.subdomain !== label) value = { kind: 'moved', subdomain: String(owner.subdomain) }
    }
  }
  resolvedCache.set(label, { at: addressDeps.now(), value })
  return value
}

/** Whether `userId` is an active member of `tenantId` (service role). */
export async function isActiveMember(userId: string, tenantId: string): Promise<boolean> {
  const db = await addressDeps.serviceClient()
  const { data } = await (db as any).from('user_memberships').select('tenant_id')
    .eq('user_id', userId).eq('tenant_id', tenantId).eq('is_active', true).limit(1)
  return (data ?? []).length > 0
}

/** The user's stored current workspace (null = the "All organizations" view) and home workspace. */
export async function storedWorkspaceOf(userId: string): Promise<{ current: string | null; home: string | null }> {
  const db = await addressDeps.serviceClient()
  const { data } = await (db as any).from('users').select('current_tenant_id, tenant_id').eq('id', userId).maybeSingle()
  return { current: (data?.current_tenant_id ?? null) as string | null, home: (data?.tenant_id ?? null) as string | null }
}
