import { createHash, randomBytes } from 'node:crypto'
import { rateLimit } from '@/lib/rate-limit'
import { DIRECTORY_CONNECTOR_KEYS } from '@/lib/directory-sync/connection'
import { ScimError } from './errors'

/* eslint-disable @typescript-eslint/no-explicit-any -- the service-role client is untyped */

/**
 * SCIM bearer tokens (scim_tokens): `utscim_<43 chars base64url>` (256 bits),
 * stored as SHA-256 only and shown once. Each token belongs to one workspace,
 * carries scopes (users:read / users:write / groups:read / groups:write), may
 * expire, and is revoked by deleting or rotating it.
 *
 * Per request: the token must exist, not be revoked or expired, and the
 * workspace's SCIM connector must be enabled. Requests are rate limited per
 * token (scim settings.rate_limit_per_minute, default 1200) and failed
 * authentications per client IP (30 per 10 minutes, then 429).
 */

export const SCIM_TOKEN_PREFIX = 'utscim_'
export const SCIM_SCOPES = ['users:read', 'users:write', 'groups:read', 'groups:write'] as const
export type ScimScope = (typeof SCIM_SCOPES)[number]

const FAILURES_PER_WINDOW = 30
const FAILURE_WINDOW_MS = 10 * 60_000
const DEFAULT_RATE_PER_MINUTE = 1200
const LAST_USED_WRITE_INTERVAL_MS = 60_000
const lastUsedWrites = new Map<string, number>()

export function hashScimToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function generateScimToken(): { token: string; hash: string; prefix: string } {
  const token = `${SCIM_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  return { token, hash: hashScimToken(token), prefix: token.slice(0, SCIM_TOKEN_PREFIX.length + 6) }
}

export function isScimScope(value: unknown): value is ScimScope {
  return typeof value === 'string' && (SCIM_SCOPES as readonly string[]).includes(value)
}

export interface ScimAuth {
  tenantId: string
  tokenId: string
  scopes: ReadonlySet<ScimScope>
  settings: Record<string, unknown>
  autoProvision: boolean
  syncGroups: boolean
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  return (forwarded?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim() || 'unknown'
}

async function unauthorized(request: Request, message: string): Promise<ScimError> {
  const limited = await rateLimit(`scim:auth-fail:${clientIp(request)}`, { max: FAILURES_PER_WINDOW, windowMs: FAILURE_WINDOW_MS })
  if (!limited.ok) {
    return new ScimError(429, 'Too many failed authentication attempts', undefined, { 'Retry-After': String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) })
  }
  return new ScimError(401, message, undefined, { 'WWW-Authenticate': 'Bearer realm="scim"' })
}

/** Resolve the request's bearer token to its workspace. Throws ScimError (401 / 429). */
export async function authenticateScim(db: any, request: Request, now = Date.now()): Promise<ScimAuth> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!match) throw await unauthorized(request, 'A bearer token is required')
  const token = match[1]
  if (!token.startsWith(SCIM_TOKEN_PREFIX) || token.length > 200) throw await unauthorized(request, 'Invalid token')

  const { data: row, error } = await db
    .from('scim_tokens')
    .select('id, tenant_id, scopes, expires_at, revoked_at, last_used_at')
    .eq('token_hash', hashScimToken(token))
    .maybeSingle()
  if (error) throw new ScimError(500, 'Token lookup failed')
  if (!row || row.revoked_at) throw await unauthorized(request, 'Invalid token')
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) throw await unauthorized(request, 'The token has expired')

  const { data: connector } = await db
    .from('tenant_connectors')
    .select('config, is_enabled')
    .eq('tenant_id', row.tenant_id)
    .eq('connector_key', DIRECTORY_CONNECTOR_KEYS.scim)
    .maybeSingle()
  if (!connector?.is_enabled) throw await unauthorized(request, 'SCIM provisioning is disabled for this workspace')
  const config = (connector.config ?? {}) as Record<string, any>
  const settings = (config.settings && typeof config.settings === 'object' ? config.settings : {}) as Record<string, unknown>

  const perMinute = Number(settings.rate_limit_per_minute)
  const max = Number.isFinite(perMinute) && perMinute > 0 ? Math.min(Math.max(perMinute, 60), 10_000) : DEFAULT_RATE_PER_MINUTE
  const limited = await rateLimit(`scim:token:${row.id}`, { max, windowMs: 60_000 })
  if (!limited.ok) {
    throw new ScimError(429, 'Rate limit exceeded', undefined, { 'Retry-After': String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) })
  }

  const lastWrite = lastUsedWrites.get(row.id) ?? (row.last_used_at ? new Date(row.last_used_at).getTime() : 0)
  if (now - lastWrite >= LAST_USED_WRITE_INTERVAL_MS) {
    lastUsedWrites.set(row.id, now)
    void Promise.resolve(db.from('scim_tokens').update({ last_used_at: new Date(now).toISOString() }).eq('id', row.id)).catch(() => undefined)
  }

  return {
    tenantId: String(row.tenant_id),
    tokenId: String(row.id),
    scopes: new Set(((row.scopes ?? []) as unknown[]).filter(isScimScope)),
    settings,
    autoProvision: config.auto_provision !== false,
    syncGroups: config.sync_groups !== false,
  }
}

export function requireScimScope(auth: ScimAuth, scope: ScimScope): void {
  if (!auth.scopes.has(scope)) throw new ScimError(403, `This token lacks the ${scope} scope`)
}
