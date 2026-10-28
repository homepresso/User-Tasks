/**
 * API keys: list, create, revoke, delete. Shared by /api/v1/api-keys, the
 * MCP api_keys_* tools and the API key server actions. Every operation needs
 * settings.manage_api_keys.
 *
 * Creating a key is a privilege-escalation surface, so a new key can never
 * do more than the caller:
 *   - permissions ⊆ the caller's permissions (and, for a user-context key,
 *     ⊆ the bound user's role permissions); omitted = inherit the caller's
 *     ceiling (a full-admin caller minting a tenant key gets a legacy
 *     full-access key, as before);
 *   - resource scopes ⊆ the caller's when the caller is itself scoped
 *     (omitted = inherit them);
 *   - callers acting as a user (user keys, OAuth user tokens) cannot mint
 *     tenant-wide keys, and their user keys are bound to themselves;
 *   - OAuth callers need the first-party `keys:write` scope for any key
 *     change, and their keys must expire within 90 days;
 *   - creation is rate-limited per caller and per tenant, and audited.
 * The plaintext key is returned once by create and is never stored (only a
 * bcrypt hash and an 8-character lookup prefix).
 */

import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { normalizeApiKeyScopes } from '@/lib/api-key-permissions'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { rateLimit } from '@/lib/rate-limit'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, type Page } from './_shared'
import { userRolePermissions } from './roles'

/* eslint-disable @typescript-eslint/no-explicit-any -- api_keys rows */

const COLUMNS = 'id, name, key_prefix, key_type, user_id, permissions, scopes, workflow_source_id, expires_at, is_revoked, last_used_at, created_by, created_at'
const DAY_MS = 86_400_000

export const API_KEY_LIMITS = {
  /** Longest expiry for keys minted with an OAuth access token. */
  oauthMaxExpiryDays: 90,
  maxExpiryDays: 3650,
  /** Creations per caller / per tenant per hour. */
  perCallerPerHour: 10,
  perTenantPerHour: 50,
} as const

export const KEYS_WRITE_SCOPE = 'keys:write'

export interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  key_type: 'tenant' | 'user'
  user_id: string | null
  permissions: string[] | null
  scopes: { workflow_ids: string[]; table_ids: string[] }
  workflow_source_id: string | null
  expires_at: string | null
  is_revoked: boolean
  last_used_at: string | null
  created_by: string | null
  created_at: string
}

export interface ApiKeyCreateInput {
  name: string
  key_type?: 'tenant' | 'user'
  /** User a user-context key acts as (defaults to the calling user). */
  user_id?: string | null
  /** Permission keys; omitted = inherit the caller's. */
  permissions?: string[] | null
  workflow_ids?: string[]
  table_ids?: string[]
  expires_in_days?: number | null
  /** Workflow source the key is issued for (UI ingestion keys). */
  workflow_source_id?: string | null
}

const VALID_PERMISSIONS = new Set<string>(PERMISSION_KEYS)

/** Public shape: the hash is dropped even if a client returned it. */
function withStatus(raw: ApiKeyRow & { key_hash?: string }) {
  const row = { ...raw }
  delete row.key_hash
  const expired = Boolean(row.expires_at && new Date(row.expires_at).getTime() < Date.now())
  return { ...row, scopes: normalizeApiKeyScopes(row.scopes), status: row.is_revoked ? 'revoked' : expired ? 'expired' : 'active' }
}

/** OAuth callers must hold keys:write for any key change (admin scope alone is not enough). */
function requireKeysWriteScope(ctx: ServiceContext) {
  if (ctx.oauthScopes === undefined || ctx.oauthScopes.includes(KEYS_WRITE_SCOPE)) return
  throw new ServiceError('insufficient_scope', `Forbidden: managing API keys with an OAuth token needs the '${KEYS_WRITE_SCOPE}' scope`, {
    details: { required_scope: KEYS_WRITE_SCOPE, granted_scopes: [...ctx.oauthScopes] },
  })
}

function callerPermissions(ctx: ServiceContext): string[] {
  return ctx.permissions === null ? [...PERMISSION_KEYS] : [...ctx.permissions]
}

function resolveExpiry(ctx: ServiceContext, days: number | null | undefined): string | null {
  const isOAuth = ctx.oauthScopes !== undefined
  if (days === undefined || days === null) {
    if (isOAuth) throw ServiceError.validation(`expires_in_days is required for keys created with an OAuth token (1-${API_KEY_LIMITS.oauthMaxExpiryDays})`)
    return null
  }
  const max = isOAuth ? API_KEY_LIMITS.oauthMaxExpiryDays : API_KEY_LIMITS.maxExpiryDays
  if (!Number.isInteger(days) || days < 1 || days > max) {
    throw ServiceError.validation(`expires_in_days must be a whole number between 1 and ${max}${isOAuth ? ' for keys created with an OAuth token' : ''}`)
  }
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

/** Requested ids ⊆ the caller's allowlist when the caller is scoped; omitted = inherit. */
function capScope(requested: string[] | undefined, callerIds: string[], label: string): string[] {
  const ids = Array.from(new Set((requested ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)))
  if (callerIds.length === 0) return ids
  if (ids.length === 0) return [...callerIds]
  const outside = ids.filter((id) => !callerIds.includes(id))
  if (outside.length) throw ServiceError.forbidden(`Forbidden: ${label} outside this credential's own scope: ${outside.join(', ')}`)
  return ids
}

async function checkTenantUser(ctx: ServiceContext, userId: string) {
  const { data: home } = await (ctx.supabase as any).from('users')
    .select('id').eq('id', userId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (home) return
  const { data: membership } = await (ctx.supabase as any).from('user_memberships')
    .select('id').eq('user_id', userId).eq('tenant_id', ctx.tenantId).eq('is_active', true).maybeSingle()
  if (!membership) throw ServiceError.validation('user_id does not belong to this workspace')
}

async function enforceRateLimit(ctx: ServiceContext) {
  const caller = ctx.actorId ?? ctx.credentialOwnerId ?? 'anonymous'
  const hour = 3_600_000
  const perCaller = await rateLimit(`api-key-create:caller:${ctx.tenantId}:${caller}`, { max: API_KEY_LIMITS.perCallerPerHour, windowMs: hour })
  const perTenant = perCaller.ok ? await rateLimit(`api-key-create:tenant:${ctx.tenantId}`, { max: API_KEY_LIMITS.perTenantPerHour, windowMs: hour }) : perCaller
  const limited = !perCaller.ok ? perCaller : !perTenant.ok ? perTenant : null
  if (limited) {
    throw new ServiceError('rate_limited', 'Too many API keys created recently; try again later', {
      details: { retry_after_seconds: Math.ceil(limited.retryAfterMs / 1000) },
    })
  }
}

export async function listApiKeys(ctx: ServiceContext, filters: { include_revoked?: boolean } = {}, page: Page) {
  requirePerm(ctx, 'settings.manage_api_keys')
  let query = (ctx.supabase as any).from('api_keys')
    .select(COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if (filters.include_revoked === false) query = query.eq('is_revoked', false)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const rows = (data ?? []) as ApiKeyRow[]
  return { api_keys: rows.map(withStatus), total: (count ?? rows.length) as number }
}

/** Create a key. Returns the row and the plaintext `key` (shown once). */
export async function createApiKey(ctx: ServiceContext, input: ApiKeyCreateInput) {
  requirePerm(ctx, 'settings.manage_api_keys')
  requireKeysWriteScope(ctx)

  const name = String(input.name ?? '').trim()
  if (!name || name.length > 200) throw ServiceError.validation('Key name must be between 1 and 200 characters')
  const expiresAt = resolveExpiry(ctx, input.expires_in_days)

  // Key type: callers acting as a user may only mint user keys for themselves.
  const callerIsUser = ctx.keyType === 'user'
  const keyType = input.key_type ?? (callerIsUser ? 'user' : 'tenant')
  if (callerIsUser && keyType === 'tenant') throw ServiceError.forbidden('Forbidden: a user-context credential cannot create tenant-wide API keys')
  let userId: string | null = null
  if (keyType === 'user') {
    userId = String(input.user_id ?? '').trim() || (callerIsUser ? ctx.actorId : null)
    if (!userId) throw ServiceError.validation('user_id is required for a user-context key')
    if (callerIsUser && userId !== ctx.actorId) throw ServiceError.forbidden('Forbidden: a user-context credential can only create keys for its own user')
  }

  // Permissions: never more than the caller (and, for user keys, the bound user) holds.
  const held = callerPermissions(ctx)
  const callerIsFullAdmin = PERMISSION_KEYS.every((p) => held.includes(p))
  let permissions: string[] | null
  if (Array.isArray(input.permissions)) {
    const requested = Array.from(new Set(input.permissions.map((p) => String(p ?? '').trim()).filter(Boolean)))
    const unknown = requested.filter((p) => !VALID_PERMISSIONS.has(p))
    if (unknown.length) throw ServiceError.validation(`Unknown permissions: ${unknown.join(', ')}`)
    const excess = requested.filter((p) => !held.includes(p))
    if (excess.length) throw ServiceError.forbidden(`Forbidden: a new key cannot hold permissions the caller lacks: ${excess.join(', ')}`)
    permissions = requested
  } else {
    permissions = callerIsFullAdmin ? null : held
  }

  if (userId) {
    await checkTenantUser(ctx, userId)
    // A user key's explicit permission list replaces the user's roles (lib/api-auth),
    // so it must also stay within what that user may do.
    if (permissions !== null) {
      const userPerms = await userRolePermissions(ctx, userId)
      if (Array.isArray(input.permissions)) {
        const beyondUser = permissions.filter((p) => !userPerms.has(p))
        if (beyondUser.length) throw ServiceError.forbidden(`Forbidden: the user does not hold: ${beyondUser.join(', ')}`)
      } else {
        permissions = permissions.filter((p) => userPerms.has(p))
      }
    }
  }

  const callerScopes = ctx.resourceScopes ?? { workflow_ids: [], table_ids: [] }
  const scopes = {
    workflow_ids: capScope(input.workflow_ids, callerScopes.workflow_ids, 'workflow_ids'),
    table_ids: capScope(input.table_ids, callerScopes.table_ids, 'table_ids'),
  }

  await enforceRateLimit(ctx)

  const key = `ut_${randomBytes(32).toString('hex')}`
  const { data, error } = await (ctx.supabase as any).from('api_keys').insert({
    tenant_id: ctx.tenantId,
    name,
    key_prefix: key.slice(0, 8),
    key_hash: await bcrypt.hash(key, 10),
    key_type: keyType,
    user_id: userId,
    permissions,
    scopes,
    workflow_source_id: input.workflow_source_id || null,
    expires_at: expiresAt,
    created_by: ctx.actorId ?? ctx.credentialOwnerId ?? null,
  }).select(COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to create API key')

  await audit(ctx, {
    objectType: 'api_key', objectId: data.id, action: 'create',
    summary: `Created ${keyType} API key "${name}"`,
    metadata: { key_type: keyType, user_id: userId, permissions, scopes, expires_at: expiresAt, via_auth: ctx.authKind },
  })
  return { api_key: withStatus(data as ApiKeyRow), key }
}

async function loadKey(ctx: ServiceContext, keyId: string) {
  const { data, error } = await (ctx.supabase as any).from('api_keys')
    .select('id, name, is_revoked').eq('id', keyId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('API key not found')
  return data as { id: string; name: string; is_revoked: boolean }
}

/** Revoke a key (kept for history; no longer authenticates). */
export async function revokeApiKey(ctx: ServiceContext, keyId: string) {
  requirePerm(ctx, 'settings.manage_api_keys')
  requireKeysWriteScope(ctx)
  const existing = await loadKey(ctx, keyId)
  if (!existing.is_revoked) {
    const { error } = await (ctx.supabase as any).from('api_keys').update({ is_revoked: true }).eq('id', keyId).eq('tenant_id', ctx.tenantId)
    // Even a failed update may have landed; never keep serving a cached validation.
    await invalidateCredentialCache()
    if (error) throw dbError(error, 'Failed to revoke API key')
    await audit(ctx, { objectType: 'api_key', objectId: keyId, action: 'revoke', summary: `Revoked API key "${existing.name}"` })
  }
  return { revoked: true as const, id: keyId }
}

export async function deleteApiKeys(ctx: ServiceContext, keyIds: string[]) {
  requirePerm(ctx, 'settings.manage_api_keys')
  requireKeysWriteScope(ctx)
  const ids = Array.from(new Set(keyIds.map((id) => String(id ?? '').trim()).filter(Boolean)))
  if (ids.length === 0) return { deleted: 0, ids: [] as string[] }
  if (ids.length > 500) throw ServiceError.validation('Delete at most 500 keys at a time')
  const { data, error } = await (ctx.supabase as any).from('api_keys')
    .delete().in('id', ids).eq('tenant_id', ctx.tenantId).select('id, name')
  await invalidateCredentialCache()
  if (error) throw dbError(error, 'Failed to delete API keys')
  const removed = (data ?? []) as Array<{ id: string; name: string }>
  for (const row of removed) await audit(ctx, { objectType: 'api_key', objectId: row.id, action: 'delete', summary: `Deleted API key "${row.name}"` })
  return { deleted: removed.length, ids: removed.map((row) => row.id) }
}

export async function deleteApiKey(ctx: ServiceContext, keyId: string) {
  requirePerm(ctx, 'settings.manage_api_keys')
  requireKeysWriteScope(ctx)
  await loadKey(ctx, keyId)
  await deleteApiKeys(ctx, [keyId])
  return { deleted: true as const, id: keyId }
}
