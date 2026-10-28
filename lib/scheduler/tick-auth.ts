import { NextResponse } from 'next/server'
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { getProviderConfig } from '@/lib/config'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import { getProcessorSecret, isAuthorizedServiceCall } from '@/lib/cron-auth'
import { schedulerListOption, schedulerOption, type SchedulerOptions } from '@/lib/providers/scheduler/options'

/**
 * Who may call POST /api/cron/tick.
 *
 *  1. The shared cron secret (CRON_SECRET / WORKFLOW_PROCESSOR_SECRET), as
 *     `Authorization: Bearer <secret>` or `X-Processor-Secret` — pg_cron,
 *     OS cron, Kubernetes CronJobs, Vercel Cron.
 *  2. A Google-signed OIDC ID token (Google Cloud Scheduler's OIDC auth):
 *     issuer accounts.google.com, `aud` = the configured audience (default
 *     <APP_URL>/api/cron/tick), `email` one of the allowed service accounts
 *     and verified. Anyone with a Google account can mint an ID token for any
 *     audience, so the allow-list is required.
 *  3. A Microsoft Entra ID access token (managed identity of an Azure
 *     Container Apps Job, Functions timer or Logic App): issuer of the
 *     configured tenant (v1 or v2), `aud` one of the configured audiences,
 *     caller (`oid`, `appid` or `azp`) on the allow-list.
 *  4. An Amazon Cognito access token (an EventBridge API destination whose
 *     connection uses OAuth client credentials against a Cognito user pool
 *     app client): issuer of the configured user pool, `token_use` access,
 *     `client_id` on the allow-list, and the required scope when one is
 *     configured. The app never holds the client secret (EventBridge keeps
 *     it in Secrets Manager); Cognito access tokens carry no `aud`, so the
 *     client allow-list is required.
 *
 * Tokens are verified against the issuer's JWKS (cached by jose), RS256 only,
 * with 60 s clock tolerance. 2, 3 and 4 are only consulted when configured; with
 * nothing configured at all the endpoint answers 503 as before.
 */

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const CLOCK_TOLERANCE_S = 60

export type TickAuthMethod = 'secret' | 'google_oidc' | 'entra' | 'cognito'

export interface TickTokenConfig {
  google?: { audiences: string[]; serviceAccounts: string[] }
  entra?: { tenantId: string; audiences: string[]; principals: string[] }
  cognito?: { issuer: string; clients: string[]; scope?: string }
}

export interface TickAuthDeps {
  /** JWKS for a URL (tests serve a local one). */
  jwks?: (url: string) => JWTVerifyGetKey
}

const jwksCache = new Map<string, JWTVerifyGetKey>()
function remoteJwks(url: string): JWTVerifyGetKey {
  let jwks = jwksCache.get(url)
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 })
    jwksCache.set(url, jwks)
  }
  return jwks
}

export function entraIssuers(tenantId: string): string[] {
  return [`https://login.microsoftonline.com/${tenantId}/v2.0`, `https://sts.windows.net/${tenantId}/`]
}

export function entraJwksUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
}

/** https://cognito-idp.<region>.amazonaws.com/<user pool id> (region: the pool id's prefix unless given). */
export function cognitoIssuer(userPoolId: string, region?: string): string {
  return `https://cognito-idp.${region || userPoolId.split('_')[0]}.amazonaws.com/${userPoolId}`
}

/** Token config from scheduler options; a method is enabled only when fully configured. */
export function tickTokenConfig(options: SchedulerOptions, appUrl = configuredAppUrl()): TickTokenConfig {
  const config: TickTokenConfig = {}
  const serviceAccounts = schedulerListOption(options, 'oidc_service_accounts').map((email) => email.toLowerCase())
  if (serviceAccounts.length) {
    const audience = schedulerOption(options, 'oidc_audience') ?? (appUrl ? `${appUrl.trim().replace(/\/+$/, '')}/api/cron/tick` : undefined)
    if (audience) config.google = { audiences: [audience], serviceAccounts }
  }
  const tenantId = schedulerOption(options, 'entra_tenant_id')
  const audiences = schedulerListOption(options, 'entra_audience')
  const principals = schedulerListOption(options, 'entra_allowed_principals').map((id) => id.toLowerCase())
  if (tenantId && audiences.length && principals.length) config.entra = { tenantId, audiences, principals }
  const pool = schedulerOption(options, 'cognito_user_pool_id')
  const clients = schedulerListOption(options, 'cognito_allowed_clients')
  if (pool && /^[a-z]{2}(-gov)?-[a-z]+-\d_[0-9A-Za-z]+$/.test(pool) && clients.length) {
    const scope = schedulerOption(options, 'cognito_scope')
    config.cognito = { issuer: cognitoIssuer(pool, schedulerOption(options, 'cognito_region')), clients, ...(scope ? { scope } : {}) }
  }
  return config
}

export function hasTokenAuth(config: TickTokenConfig): boolean {
  return Boolean(config.google || config.entra || config.cognito)
}

export class TickTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TickTokenError'
  }
}

/** Verifies a bearer token against the configured issuers; throws TickTokenError. */
export async function verifyTickToken(token: string, config: TickTokenConfig, deps: TickAuthDeps = {}): Promise<{ method: 'google_oidc' | 'entra' | 'cognito'; subject: string }> {
  let unverified: JWTPayload
  try {
    unverified = decodeJwt(token)
  } catch {
    throw new TickTokenError('not a JWT')
  }
  const jwks = deps.jwks ?? remoteJwks
  const iss = typeof unverified.iss === 'string' ? unverified.iss : ''

  if (config.google && GOOGLE_ISSUERS.includes(iss)) {
    const { payload } = await verify(token, jwks(GOOGLE_JWKS_URL), GOOGLE_ISSUERS, config.google.audiences)
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : ''
    if (!email || payload.email_verified !== true) throw new TickTokenError('token has no verified email')
    if (!config.google.serviceAccounts.includes(email)) throw new TickTokenError('service account not allowed')
    return { method: 'google_oidc', subject: email }
  }

  if (config.entra && entraIssuers(config.entra.tenantId).includes(iss)) {
    const { tenantId, audiences, principals } = config.entra
    const { payload } = await verify(token, jwks(entraJwksUrl(tenantId)), entraIssuers(tenantId), audiences)
    if (payload.tid !== undefined && String(payload.tid).toLowerCase() !== tenantId.toLowerCase()) throw new TickTokenError('wrong tenant')
    const ids = [payload.oid, payload.appid, payload.azp].filter((v): v is string => typeof v === 'string').map((v) => v.toLowerCase())
    if (!ids.some((id) => principals.includes(id))) throw new TickTokenError('principal not allowed')
    return { method: 'entra', subject: ids[0] ?? '' }
  }

  if (config.cognito && iss === config.cognito.issuer) {
    const { issuer, clients, scope } = config.cognito
    const { payload } = await verify(token, jwks(`${issuer}/.well-known/jwks.json`), [issuer], undefined)
    // ID tokens of the same pool are signed with the same keys: only access tokens count.
    if (payload.token_use !== 'access') throw new TickTokenError('not a Cognito access token')
    const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''
    if (!clientId || !clients.includes(clientId)) throw new TickTokenError('client not allowed')
    if (scope && !String(payload.scope ?? '').split(/\s+/).includes(scope)) throw new TickTokenError('required scope missing')
    return { method: 'cognito', subject: clientId }
  }

  throw new TickTokenError('untrusted issuer')
}

async function verify(token: string, key: JWTVerifyGetKey, issuer: string[], audience: string[] | undefined) {
  try {
    return await jwtVerify(token, key, { issuer, ...(audience ? { audience } : {}), algorithms: ['RS256'], clockTolerance: CLOCK_TOLERANCE_S, requiredClaims: ['exp', 'iat'] })
  } catch (error) {
    // jose messages name the failed check ("exp" claim timestamp check failed, unexpected "aud" …); no token content.
    throw new TickTokenError((error as Error).message)
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null
  return match ? match[1] : null
}

/**
 * Authorizes a tick request. Returns the method used, or a 401/503 response.
 * Same responses as requireServiceAuth when no token method is configured.
 */
export async function authorizeTickRequest(
  request: Request,
  deps: TickAuthDeps & { config?: TickTokenConfig } = {},
): Promise<{ method: TickAuthMethod; subject?: string } | NextResponse> {
  if (isAuthorizedServiceCall(request)) return { method: 'secret' }
  const config = deps.config ?? tickTokenConfig((await getProviderConfig('scheduler')).options)
  const secretConfigured = Boolean(getProcessorSecret())
  if (!secretConfigured && !hasTokenAuth(config)) {
    return NextResponse.json({ error: 'Service endpoint is not configured (missing WORKFLOW_PROCESSOR_SECRET / CRON_SECRET)' }, { status: 503 })
  }
  const token = bearerToken(request)
  if (token && hasTokenAuth(config) && token.split('.').length === 3) {
    try {
      return await verifyTickToken(token, config, deps)
    } catch (error) {
      console.warn(`[cron-tick] rejected bearer token: ${(error as Error).message}`)
    }
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
