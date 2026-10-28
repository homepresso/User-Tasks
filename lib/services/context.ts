/**
 * Shared service-layer context.
 *
 * Every service function takes a ServiceContext instead of reaching for a
 * request, cookie or MCP context directly, so the same logic can sit behind a
 * REST route, an MCP tool and a server action. Services filter `tenant_id`
 * explicitly, call requirePerm() and throw ServiceError for expected failures;
 * the caller's adapter (apiRoute, MCP wrapper, server action) maps that onto
 * its own error shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScopes, ApiKeySuccessResult } from '@/lib/api-auth'
import type { McpContext } from '@/lib/mcp/server'

// Services accept clients of any generated Database typing (service-role REST
// clients are untyped; cookie clients are typed), matching lib/audit-log.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySupabaseClient = SupabaseClient<any, any, any>

/**
 * `job`: a background job (lib/user-jobs/runner.ts) acting for the user or
 * credential that started it, with permissions re-resolved when it runs. It
 * uses a service-role client with explicit tenant filters, like API callers,
 * so services must not rely on RLS for it (source !== 'ui').
 */
export type ServiceAuthKind = 'api_key' | 'oauth' | 'mcp' | 'session' | 'job'
export type ServiceSource = 'api' | 'mcp' | 'ui' | 'job'

export interface ServiceContext {
  /**
   * Database client for this caller (lib/providers/db). Read it with getDb(ctx);
   * contexts built by hand (tests, scripts) may set only `supabase`.
   */
  db?: AnySupabaseClient
  /** Compatibility alias of `db` while call sites migrate (same client). */
  supabase: AnySupabaseClient
  tenantId: string
  /** User the action is attributed to (audit actor), when there is one. */
  actorId: string | null
  /**
   * Resolved permission keys. `null` disables gating — only produced by
   * fromMcpContext for standalone/test MCP contexts, which are ungated today.
   */
  permissions: ReadonlySet<string> | null
  /** Per-key resource allowlists (empty arrays = unrestricted). */
  resourceScopes?: ApiKeyScopes
  authKind: ServiceAuthKind
  source: ServiceSource
  /** Credential flavour: a tenant-wide key, or one acting as a user (API key / OAuth / MCP callers). */
  keyType?: 'tenant' | 'user'
  /** Granted OAuth scopes when the credential is an OAuth access token (undefined otherwise). */
  oauthScopes?: readonly string[]
  /** User who created the credential (tenant API keys have no acting user). */
  credentialOwnerId?: string | null
  /** API key / OAuth token id (API callers), so a background job can re-check it. */
  credentialId?: string | null
  /** Background job this context runs (authKind 'job'). */
  jobId?: string
}

export type ServiceErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation_error'
  | 'conflict'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'internal'

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_error: 400,
  conflict: 409,
  insufficient_scope: 403,
  rate_limited: 429,
  internal: 500,
}

/** Expected, user-facing service failure. Message is safe to return to callers. */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: ServiceErrorCode, message: string, options?: { status?: number; details?: unknown }) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.status = options?.status ?? STATUS_BY_CODE[code]
    this.details = options?.details
  }

  static forbidden(message: string) { return new ServiceError('forbidden', message) }
  static notFound(message: string) { return new ServiceError('not_found', message) }
  static validation(message: string, details?: unknown) { return new ServiceError('validation_error', message, { details }) }
  static conflict(message: string) { return new ServiceError('conflict', message) }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError
}

/** The context's database client (`db`, falling back to the `supabase` alias). */
export function getDb(ctx: ServiceContext): AnySupabaseClient {
  return ctx.db ?? ctx.supabase
}

export function hasPerm(ctx: ServiceContext, permission: string): boolean {
  return ctx.permissions === null || ctx.permissions.has(permission)
}

/** Throw a 403 ServiceError unless the context holds `permission`. */
export function requirePerm(ctx: ServiceContext, permission: string): void {
  if (hasPerm(ctx, permission)) return
  const subject = ctx.authKind === 'api_key' ? 'this API key'
    : ctx.authKind === 'oauth' ? 'this access token'
    : 'you'
  const verb = subject === 'you' ? 'lack' : 'lacks'
  throw ServiceError.forbidden(`Forbidden: ${subject} ${verb} the '${permission}' permission`)
}

/** Build a context from a validated v1 API credential (API key or OAuth token). */
export function fromApiAuth(auth: ApiKeySuccessResult): ServiceContext {
  return {
    db: auth.supabase,
    supabase: auth.supabase,
    tenantId: auth.tenantId,
    actorId: auth.actingUserId ?? null,
    permissions: new Set(auth.permissions),
    resourceScopes: auth.scopes,
    authKind: auth.authKind ?? 'api_key',
    source: 'api',
    keyType: auth.keyType,
    oauthScopes: auth.authKind === 'oauth' ? auth.oauthScopes ?? [] : undefined,
    credentialOwnerId: auth.createdBy ?? null,
    credentialId: auth.keyId ?? null,
  }
}

/** Build a context from an MCP tool context. Missing permissions = ungated (matches MCP authz). */
export function fromMcpContext(ctx: McpContext): ServiceContext {
  return {
    db: ctx.supabase,
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    actorId: ctx.actingUserId ?? null,
    permissions: Array.isArray(ctx.permissions) ? new Set(ctx.permissions) : null,
    resourceScopes: ctx.scopes,
    authKind: 'mcp',
    source: 'mcp',
    keyType: ctx.keyType,
    oauthScopes: ctx.oauthScopes,
    credentialOwnerId: ctx.credentialOwnerId ?? null,
  }
}

/**
 * Build a context for the signed-in UI user (server actions / session routes).
 * Uses the cookie-bound client so RLS still applies. The tenant is the user's
 * current workspace, falling back to their home tenant (a NULL current tenant
 * is the unified view, which has no single tenant to act in).
 *
 * `tenantId` acts in one specific workspace instead (the tenant of a record
 * the user opened from the unified view): the user must be a member of it,
 * and the permissions are their roles there.
 */
export async function fromSession(options: { tenantId?: string } = {}): Promise<ServiceContext> {
  // Imported lazily: these pull in next/headers and React cache(), which
  // must not load in scripts (OpenAPI generation) or API-only code paths.
  const [{ getSessionDbWithUser }, { getUserPermissions }] = await Promise.all([
    import('@/lib/providers/db/session'),
    import('@/lib/permissions-server'),
  ])
  const { supabase, user } = await getSessionDbWithUser()
  if (!user) throw new ServiceError('unauthorized', 'Not authenticated')

  if (options.tenantId) {
    // Same membership set the tenant RLS policies use (rls_member_tenant_ids).
    const { data: tenantIds, error } = await supabase.rpc('get_user_tenant_ids')
    if (error) throw new Error(error.message)
    const memberOf = new Set(((tenantIds ?? []) as unknown[]).map((row) =>
      String(typeof row === 'object' && row !== null ? Object.values(row)[0] : row)))
    if (!memberOf.has(options.tenantId)) throw ServiceError.forbidden('Forbidden: you are not a member of that workspace')
    const { data: perms, error: permError } = await supabase.rpc('get_user_permissions' as never, { p_tenant_id: options.tenantId } as never)
    if (permError) throw new Error(permError.message)
    return {
      db: supabase,
      supabase,
      tenantId: options.tenantId,
      actorId: user.id,
      permissions: new Set((perms as unknown as string[] | null) ?? []),
      authKind: 'session',
      source: 'ui',
    }
  }

  // Independent lookups: the profile (for the tenant) and the permissions.
  const [{ data: profile }, permissions] = await Promise.all([
    supabase
      .from('users')
      .select('current_tenant_id, tenant_id')
      .eq('id', user.id)
      .maybeSingle(),
    getUserPermissions(),
  ])
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id ?? null
  if (!tenantId) throw ServiceError.forbidden('No workspace selected')

  return {
    db: supabase,
    supabase,
    tenantId: String(tenantId),
    actorId: user.id,
    permissions,
    authKind: 'session',
    source: 'ui',
  }
}
