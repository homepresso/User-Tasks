import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceDb } from '@/lib/providers/db'
import bcrypt from 'bcryptjs'
import { PERMISSION_KEYS } from './permissions'
import { lookupOAuthToken } from './oauth/tokens'
import { expandScopes } from './oauth/scopes'
import { rateLimit } from './rate-limit'
import { writeAudit } from './audit-log'
import {
  credentialCacheGeneration,
  credentialCacheKey,
  getCachedCredential,
  setCachedCredential,
  shouldWriteLastUsed,
  syncCredentialCache,
} from './api-auth-cache'

export type ApiKeyScopes = {
  workflow_ids: string[]
  table_ids: string[]
}

export type ApiKeySuccessResult = {
  success: true
  tenantId: string
  keyId: string
  keyType: 'tenant' | 'user'
  createdBy: string | null
  actingUserId: string | null
  scopes: ApiKeyScopes
  /** Resolved permission keys this key may exercise (RBAC for API/MCP). */
  permissions: string[]
  supabase: SupabaseClient
  /** How the caller authenticated (surfaced by GET /api/v1/me). */
  authKind?: 'api_key' | 'oauth'
  /** Granted OAuth scopes (OAuth tokens only). */
  oauthScopes?: string[]
  /** Credential expiry (API key expires_at or access-token expiry), if any. */
  expiresAt?: string | null
}

export type AuthResult =
  | ApiKeySuccessResult
  | { success: false; response: NextResponse }

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

function normalizeApiKeyScopes(raw: unknown): ApiKeyScopes {
  const next = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    workflow_ids: uniqueIds(next.workflow_ids),
    table_ids: uniqueIds(next.table_ids),
  }
}

// Sampled security audit of API-key auth failures: at most one audit row per
// (tenant, key prefix) per window per server instance, so a client hammering a
// bad key can't flood the audit log / event stream.
const AUTH_FAILURE_AUDIT_WINDOW_MS = 5 * 60_000
// Max revoked keys bcrypt-checked when attributing a failure to a revoked key.
const REVOKED_PROBE_LIMIT = 3

type AuthFailureReason = 'invalid_secret' | 'expired' | 'revoked'

/**
 * Record a sampled `security.api_key.auth_failed` audit row. Only failures
 * attributable to a tenant (the presented prefix matches a stored key) are
 * recorded; only the stored 8-char prefix is logged, never the presented key.
 */
async function auditApiKeyAuthFailure(
  supabase: SupabaseClient,
  key: { id: string; tenant_id: string },
  prefix: string,
  reason: AuthFailureReason,
): Promise<void> {
  const sample = await rateLimit(`api-key-auth-failure:${key.tenant_id}:${prefix}`, {
    max: 1,
    windowMs: AUTH_FAILURE_AUDIT_WINDOW_MS,
  })
  if (!sample.ok) return
  const what = reason === 'expired' ? 'An expired' : reason === 'revoked' ? 'A revoked' : 'An invalid'
  await writeAudit({
    supabase,
    tenantId: key.tenant_id,
    actorId: null,
    objectType: 'api_key',
    objectId: key.id,
    action: 'auth_failed',
    summary: `${what} API key (${prefix}…) was rejected`,
    metadata: { event: 'auth_failed', key_prefix: prefix, reason },
  })
}

/**
 * No active key matches the prefix: check (sampled, per prefix) whether a
 * revoked key does, so use of a revoked key still reaches the tenant's
 * security events.
 */
async function auditUnmatchedPrefix(supabase: SupabaseClient, token: string, prefix: string): Promise<void> {
  try {
    if (!(await rateLimit(`api-key-auth-probe:${prefix}`, { max: 1, windowMs: AUTH_FAILURE_AUDIT_WINDOW_MS })).ok) return
    const { data: revoked } = await supabase
      .from('api_keys')
      .select('id, tenant_id, key_hash')
      .eq('key_prefix', prefix)
      .eq('is_revoked', true)
      .limit(REVOKED_PROBE_LIMIT)
    const candidates = (revoked ?? []) as Array<{ id: string; tenant_id: string; key_hash: string }>
    if (!candidates.length) return
    const matches = await Promise.all(candidates.map((k) => bcrypt.compare(token, k.key_hash)))
    const hit = candidates.find((_, i) => matches[i])
    if (hit) {
      await auditApiKeyAuthFailure(supabase, hit, prefix, 'revoked')
      return
    }
    // Prefix collision with a revoked key but wrong secret.
    const seen = new Set<string>()
    for (const k of candidates) {
      if (seen.has(k.tenant_id)) continue
      seen.add(k.tenant_id)
      await auditApiKeyAuthFailure(supabase, k, prefix, 'invalid_secret')
    }
  } catch (error) {
    console.warn('[api-auth] auth failure audit failed:', error)
  }
}

/**
 * Validate an API key from the Authorization: Bearer header.
 * Returns tenantId + a service-role Supabase client scoped for that tenant.
 */
export async function validateApiKey(request: NextRequest): Promise<AuthResult> {
  // Bearer header only, unless ?key= is explicitly opted into via env. Keys in
  // URLs leak into access logs, proxies, and browser history, so the query-param
  // fallback (for MCP connectors that can't set headers) is off by default.
  const authHeader = request.headers.get('Authorization')
  const allowQueryKey = process.env.ALLOW_QUERY_KEY_AUTH === 'true'
  const queryKey = allowQueryKey ? request.nextUrl.searchParams.get('key') : null
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryKey

  if (!token) {
    return {
      success: false,
      response: err(
        authHeader || allowQueryKey
          ? 'Missing Bearer token'
          : 'Missing Bearer token (?key= auth is disabled; send Authorization: Bearer <key>)',
        401,
      ),
    }
  }

  // OAuth access tokens (uoa_) take a separate validation path; legacy raw
  // API keys fall through to the bcrypt/prefix branch. Refresh tokens (uor_)
  // are only ever valid at /api/oauth/token — reject here.
  if (token.startsWith('uor_') || token.startsWith('uoc_')) {
    return { success: false, response: err('This token type cannot be used to access the API', 401) }
  }

  const supabase = serviceClient()

  // Successful validations are cached per instance (lib/api-auth-cache) and
  // invalidated on revoke / role / membership changes (on every instance
  // with a shared cache store).
  const cacheKey = credentialCacheKey(token)
  await syncCredentialCache()
  const cached = getCachedCredential<CachedCredential>(cacheKey)
  if (cached) {
    touchLastUsed(supabase, cached.authKind === 'oauth' ? 'oauth_tokens' : 'api_keys', cached.keyId)
    return materialize(cached, supabase)
  }

  const startedAt = credentialCacheGeneration()
  const result = token.startsWith('uoa_')
    ? await validateOAuthAccessToken(supabase, token)
    : await validateRawApiKey(supabase, token)
  if (result.success) {
    setCachedCredential<CachedCredential>(cacheKey, snapshot(result), {
      startedAt,
      credentialExpiresAt: result.expiresAt ?? null,
    })
  }
  return result
}

type CachedCredential = Omit<ApiKeySuccessResult, 'supabase'>

let sharedServiceClient: SupabaseClient | null = null

/** One service-role client per process: it carries no per-request state. */
function serviceClient(): SupabaseClient {
  sharedServiceClient ??= getServiceDb()
  return sharedServiceClient
}

/** Copy without the client, so callers can't mutate the cached entry. */
function snapshot(result: ApiKeySuccessResult): CachedCredential {
  const { supabase: _client, ...rest } = result
  void _client
  return {
    ...rest,
    scopes: { workflow_ids: [...rest.scopes.workflow_ids], table_ids: [...rest.scopes.table_ids] },
    permissions: [...rest.permissions],
    ...(rest.oauthScopes ? { oauthScopes: [...rest.oauthScopes] } : {}),
  }
}

function materialize(cached: CachedCredential, supabase: SupabaseClient): ApiKeySuccessResult {
  return { ...snapshot({ ...cached, supabase }), supabase }
}

/** Fire-and-forget last_used_at, at most once a minute per credential per instance. */
function touchLastUsed(supabase: SupabaseClient, table: 'api_keys' | 'oauth_tokens', id: string) {
  if (!shouldWriteLastUsed(`${table}:${id}`)) return
  ;(supabase as any).from(table).update({ last_used_at: new Date().toISOString() }).eq('id', id).then(() => {}, () => {})
}

async function validateRawApiKey(supabase: SupabaseClient, token: string): Promise<AuthResult> {
  const prefix = token.slice(0, 8)

  const { data: keys } = await supabase
    .from('api_keys')
    .select('id, tenant_id, key_hash, key_type, user_id, permissions, scopes, expires_at, created_by')
    .eq('key_prefix', prefix)
    .eq('is_revoked', false)

  if (!keys?.length) {
    await auditUnmatchedPrefix(supabase, token, prefix)
    return { success: false, response: err('Invalid API key', 401) }
  }

  let validKey = null
  for (const key of keys) {
    if (await bcrypt.compare(token, key.key_hash)) {
      validKey = key
      break
    }
  }

  if (!validKey) {
    // One sampled audit row per tenant whose key shares this prefix.
    const seen = new Set<string>()
    for (const key of keys) {
      if (seen.has(key.tenant_id)) continue
      seen.add(key.tenant_id)
      await auditApiKeyAuthFailure(supabase, key, prefix, 'invalid_secret')
    }
    return { success: false, response: err('Invalid API key', 401) }
  }

  if (validKey.expires_at && new Date(validKey.expires_at) < new Date()) {
    await auditApiKeyAuthFailure(supabase, validKey, prefix, 'expired')
    return { success: false, response: err('API key expired', 401) }
  }

  touchLastUsed(supabase, 'api_keys', validKey.id)

  const permissions = await resolveKeyPermissions(supabase, validKey)

  return {
    success: true,
    tenantId: validKey.tenant_id,
    keyId: validKey.id,
    keyType: validKey.key_type === 'user' ? 'user' : 'tenant',
    createdBy: validKey.created_by ?? null,
    actingUserId: validKey.user_id ?? null,
    scopes: normalizeApiKeyScopes(validKey.scopes),
    permissions,
    supabase,
    authKind: 'api_key',
    expiresAt: validKey.expires_at ?? null,
  }
}

/**
 * Resolve the permission set for an API key.
 *  - Explicit `permissions` column set → that array is the ceiling (least-privilege key).
 *  - User-context key → the bound user's role permissions (user_roles → roles.permissions).
 *  - Legacy tenant key with no explicit permissions → full admin (backward compatible).
 */
async function resolveKeyPermissions(supabase: SupabaseClient, key: any): Promise<string[]> {
  if (Array.isArray(key.permissions)) {
    return Array.from(new Set(key.permissions.map((p: unknown) => String(p ?? '').trim()).filter(Boolean)))
  }

  if (key.key_type === 'user' && key.user_id) {
    const { data } = await supabase
      .from('user_roles')
      .select('role:roles(permissions)')
      .eq('tenant_id', key.tenant_id)
      .eq('user_id', key.user_id)
    const set = new Set<string>()
    for (const ur of (data ?? []) as any[]) {
      // PostgREST may return the embed as an object or a one-element array
      // depending on how the FK relationship is detected — accept both, else
      // user keys silently resolve to an empty (fully locked-out) set.
      const roles = Array.isArray(ur?.role) ? ur.role : ur?.role ? [ur.role] : []
      for (const role of roles) {
        for (const p of (role?.permissions ?? [])) set.add(String(p))
      }
    }
    return [...set]
  }

  // Legacy tenant-wide key: full admin for backward compatibility.
  return [...PERMISSION_KEYS]
}

/**
 * Validate an OAuth access token (uoa_): direct SHA-256 hash lookup (no
 * bcrypt on the hot path — 256-bit random tokens don't need slow hashing).
 * Returns the SAME ApiKeySuccessResult shape as the API-key path so every
 * v1 route and the MCP endpoint accept OAuth tokens without changes.
 *
 * Security invariants:
 *  - the token's tenant is FROZEN at issuance (token.tenant_id) — never
 *    re-resolved from the user's current workspace;
 *  - user-delegated tokens re-resolve the user's live role permissions per
 *    request AND hard-fail when the user no longer has an active membership
 *    or any role in the token's tenant (directory-sync deactivation therefore
 *    kills the token immediately, even on permission-ungated surfaces);
 *  - revoked clients invalidate all their tokens at validation time.
 */
async function validateOAuthAccessToken(supabase: SupabaseClient, token: string): Promise<AuthResult> {
  const row = await lookupOAuthToken(supabase, token, 'access')
  if (!row || row.revoked_at) {
    return { success: false, response: err('Invalid or revoked access token', 401) }
  }
  if (new Date(row.expires_at) < new Date()) {
    return { success: false, response: err('Access token expired', 401) }
  }

  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('id, revoked_at, created_by')
    .eq('client_id', row.client_id)
    .maybeSingle()
  if (!client || client.revoked_at) {
    return { success: false, response: err('Invalid or revoked access token', 401) }
  }

  let permissions = expandScopes(row.scopes ?? [])

  if (row.user_id) {
    // User-delegated token: intersect scope permissions with the user's LIVE
    // role permissions in the token's frozen tenant, and require an active
    // membership. Empty intersection or lost membership = hard 401.
    const [{ data: roleRows }, { data: membership }, { data: userRow }] = await Promise.all([
      (supabase as any)
        .from('user_roles')
        .select('role:roles(permissions)')
        .eq('tenant_id', row.tenant_id)
        .eq('user_id', row.user_id),
      (supabase as any)
        .from('user_memberships')
        .select('id')
        .eq('user_id', row.user_id)
        .eq('tenant_id', row.tenant_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle(),
      (supabase as any)
        .from('users')
        .select('id, tenant_id')
        .eq('id', row.user_id)
        .maybeSingle(),
    ])

    const userPermissions = new Set<string>()
    for (const ur of (roleRows ?? []) as any[]) {
      const roles = Array.isArray(ur?.role) ? ur.role : ur?.role ? [ur.role] : []
      for (const role of roles) for (const p of (role?.permissions ?? [])) userPermissions.add(String(p))
    }

    // Membership: an active user_memberships row OR the token tenant being
    // the user's home tenant (single-workspace users may lack membership rows).
    const isMember = Boolean(membership) || (userRow && String((userRow as any).tenant_id) === String(row.tenant_id))
    if (!isMember || userPermissions.size === 0) {
      return { success: false, response: err('Access token no longer authorized for this workspace', 401) }
    }
    permissions = permissions.filter((p) => userPermissions.has(p))
    if (permissions.length === 0) {
      return { success: false, response: err('Access token no longer authorized for this workspace', 401) }
    }
  }

  touchLastUsed(supabase, 'oauth_tokens', row.id)

  return {
    success: true,
    tenantId: row.tenant_id,
    keyId: row.id,
    keyType: row.user_id ? 'user' : 'tenant',
    createdBy: client.created_by ?? null,
    actingUserId: row.user_id ?? null,
    // OAuth tokens don't carry per-resource allowlists — empty means
    // unrestricted resources, bounded only by the permission set above.
    scopes: { workflow_ids: [], table_ids: [] },
    permissions,
    supabase,
    authKind: 'oauth',
    oauthScopes: [...(row.scopes ?? [])],
    expiresAt: row.expires_at,
  }
}

/** Success response */
export function ok(data: any, status = 200) {
  return NextResponse.json({ success: true, data }, { status })
}

/** Error response */
export function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * Enforce that an authenticated API key holds a permission. Returns a 403
 * NextResponse to short-circuit with, or null to proceed. Mirrors the MCP
 * TOOL_PERMISSIONS gating for the REST v1 surface. Legacy tenant keys resolve to
 * the full permission set (see resolveKeyPermissions), so this is backward
 * compatible for them.
 */
export function requireApiPermission(auth: ApiKeySuccessResult, permission: string): NextResponse | null {
  if (auth.permissions.includes(permission)) return null
  return err(`Forbidden: this API key lacks the '${permission}' permission`, 403)
}

/** Parse pagination params from URL search params */
export function parsePagination(params: URLSearchParams): { limit: number | null; offset: number } {
  const rawLimit = Number(params.get('limit') ?? 50)
  const limit = rawLimit === 0 ? null : Math.min(Math.max(rawLimit, 1), 100)
  const offset = Math.max(Number(params.get('offset') ?? 0), 0)
  return { limit, offset }
}
