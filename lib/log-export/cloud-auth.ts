/**
 * Access tokens for the cloud log destinations (Azure Monitor, Event Hubs,
 * Cloud Logging, Pub/Sub), and AWS credentials for CloudWatch Logs.
 *
 * Destinations belong to workspaces, so by default they authenticate with
 * credentials the workspace supplies: an Entra ID app registration's client
 * secret, or a Google service-account key. The instance's own identity
 * (managed identity / workload identity / Application Default Credentials /
 * the AWS task role or instance profile) could reach whatever the
 * *operator's* identity can, so a destination may
 * use it only when the operator opts in with
 * LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true (single-tenant installs).
 *
 * Token endpoints are fixed per cloud (login.microsoftonline.com and its
 * sovereign equivalents; oauth2.googleapis.com — never a token_uri taken
 * from a tenant-supplied key file); the operator may override them for a
 * private endpoint or tests with LOG_EXPORT_AZURE_AUTHORITY_URL /
 * LOG_EXPORT_GCP_TOKEN_URL. Tokens are cached in memory until a minute
 * before they expire, keyed by a hash of the credentials. Error messages
 * carry the identity provider's reason, never a secret or a token.
 */

import { createHash } from 'node:crypto'
import { AuthorizeError, FormatterConfigError, type AuthorizeOptions, type FormatContext } from './formats/types'
import type { AwsCredentials } from '@/lib/aws/sigv4'

export type AzureCloud = 'public' | 'usgov' | 'china'

const AZURE_AUTHORITY: Record<AzureCloud, string> = {
  public: 'https://login.microsoftonline.com',
  usgov: 'https://login.microsoftonline.us',
  china: 'https://login.chinacloudapi.cn',
}

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

export function instanceIdentityAllowed(): boolean {
  return process.env.LOG_EXPORT_ALLOW_INSTANCE_IDENTITY === 'true'
}

function requireInstanceIdentity(what: string): void {
  if (!instanceIdentityAllowed()) {
    throw new FormatterConfigError(`${what} uses the instance's identity, which this deployment does not allow (the operator can enable it with LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true)`)
  }
}

const cache = new Map<string, { token: string; expiresAt: number }>()
const MAX_CACHED = 500

function cacheKey(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

async function cached(key: string, now: number, fetchToken: () => Promise<{ token: string; expiresInMs: number }>): Promise<string> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt - 60_000 > now) return hit.token
  const { token, expiresInMs } = await fetchToken()
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!)
  cache.set(key, { token, expiresAt: now + expiresInMs })
  return token
}

export function clearTokenCache(): void {
  cache.clear()
}

const oneLine = (text: unknown) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)

/** POST a token request; classify failures (4xx: credentials → permanent; 429 / 5xx / network → retry). */
async function tokenRequest(url: string, body: URLSearchParams, options: AuthorizeOptions, label: string): Promise<{ token: string; expiresInMs: number }> {
  let res: Response
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new AuthorizeError(`${label} token request failed: ${(error as Error).message}`)
  }
  const json = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number | string; error?: string; error_description?: string } | null
  if (res.ok && json?.access_token) return { token: json.access_token, expiresInMs: (Number(json.expires_in) || 3600) * 1000 }
  const reason = json?.error_description ? oneLine(json.error_description) : json?.error ? oneLine(json.error) : `HTTP ${res.status}`
  if (res.status === 429 || res.status >= 500) throw new AuthorizeError(`${label} token request failed (${res.status}): ${reason}`)
  throw new FormatterConfigError(`${label} rejected the credentials (${res.status}): ${reason}`)
}

export interface EntraTokenInput {
  auth: 'client_secret' | 'managed_identity'
  cloud?: AzureCloud
  tenantId?: string
  clientId?: string
  clientSecret?: unknown
  scope: string
}

export async function entraToken(input: EntraTokenInput, options: AuthorizeOptions = {}): Promise<string> {
  const now = (options.now ?? Date.now)()
  if (input.auth === 'managed_identity') {
    requireInstanceIdentity('auth=managed_identity')
    return cached(cacheKey(['mi', input.clientId ?? '', input.scope]), now, async () => {
      const { ManagedIdentityCredential } = await import('@azure/identity')
      const credential = input.clientId ? new ManagedIdentityCredential({ clientId: input.clientId }) : new ManagedIdentityCredential()
      try {
        const token = await credential.getToken(input.scope)
        if (!token) throw new Error('no token')
        return { token: token.token, expiresInMs: Math.max(60_000, token.expiresOnTimestamp - now) }
      } catch (error) {
        throw new AuthorizeError(`managed identity token request failed: ${oneLine((error as Error).message)}`)
      }
    })
  }
  if (!input.tenantId || !input.clientId) throw new FormatterConfigError('config.tenant_id and config.client_id are required for client_secret auth')
  if (typeof input.clientSecret !== 'string' || !input.clientSecret) throw new FormatterConfigError('credentials.client_secret is not set')
  const authority = (process.env.LOG_EXPORT_AZURE_AUTHORITY_URL?.trim() || AZURE_AUTHORITY[input.cloud ?? 'public']).replace(/\/+$/, '')
  const secret = input.clientSecret
  return cached(cacheKey(['entra', authority, input.tenantId, input.clientId, secret, input.scope]), now, () => tokenRequest(
    `${authority}/${encodeURIComponent(input.tenantId!)}/oauth2/v2.0/token`,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: input.clientId!, client_secret: secret, scope: input.scope }),
    options,
    'Microsoft Entra ID',
  ))
}

export interface GoogleTokenInput {
  auth: 'service_account' | 'workload_identity'
  serviceAccountJson?: unknown
  scope: string
}

export async function googleToken(input: GoogleTokenInput, options: AuthorizeOptions = {}): Promise<string> {
  const now = (options.now ?? Date.now)()
  if (input.auth === 'workload_identity') {
    requireInstanceIdentity('auth=workload_identity')
    return cached(cacheKey(['adc', input.scope]), now, async () => {
      const { GoogleAuth } = await import('google-auth-library')
      try {
        const token = await new GoogleAuth({ scopes: [input.scope] }).getAccessToken()
        if (!token) throw new Error('no token')
        return { token, expiresInMs: 50 * 60_000 }
      } catch (error) {
        throw new AuthorizeError(`Application Default Credentials token request failed: ${oneLine((error as Error).message)}`)
      }
    })
  }
  if (typeof input.serviceAccountJson !== 'string' || !input.serviceAccountJson) throw new FormatterConfigError('credentials.service_account_json is not set')
  let key: { client_email?: string; private_key?: string; private_key_id?: string }
  try {
    key = JSON.parse(input.serviceAccountJson)
  } catch {
    throw new FormatterConfigError('credentials.service_account_json is not valid JSON')
  }
  if (!key.client_email || !key.private_key) throw new FormatterConfigError('credentials.service_account_json needs client_email and private_key')
  const tokenUrl = process.env.LOG_EXPORT_GCP_TOKEN_URL?.trim() || GOOGLE_TOKEN_URL
  return cached(cacheKey(['sa', tokenUrl, key.client_email, key.private_key, input.scope]), now, async () => {
    const { SignJWT, importPKCS8 } = await import('jose')
    let assertion: string
    try {
      const signingKey = await importPKCS8(key.private_key!, 'RS256')
      const iat = Math.floor(now / 1000)
      assertion = await new SignJWT({ scope: input.scope })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) })
        .setIssuer(key.client_email!).setAudience(tokenUrl).setIssuedAt(iat).setExpirationTime(iat + 3600)
        .sign(signingKey)
    } catch {
      throw new FormatterConfigError('credentials.service_account_json has an unusable private_key')
    }
    return tokenRequest(tokenUrl, new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), options, 'Google OAuth')
  })
}

/**
 * AWS credentials for a destination (CloudWatch Logs):
 *  - access_key (default): credentials.access_key_id + secret_access_key,
 *    stored encrypted; either may be a secret://tenants/<workspace id>/…
 *    reference, resolved from the instance's secret store;
 *  - instance_role: the instance's own credential chain (ECS task role,
 *    instance profile, IRSA), only with LOG_EXPORT_ALLOW_INSTANCE_IDENTITY=true.
 */
export async function awsCredentialsFor(ctx: Pick<FormatContext, 'tenantId' | 'config' | 'credentials'>): Promise<AwsCredentials> {
  if (ctx.config.auth === 'instance_role') {
    requireInstanceIdentity('auth=instance_role')
    try {
      const { instanceCredentials } = await import('@/lib/aws/credentials')
      return await instanceCredentials()()
    } catch (error) {
      throw new AuthorizeError(`AWS credential chain failed: ${oneLine((error as Error).message)}`)
    }
  }
  let creds: Record<string, unknown> = { access_key_id: ctx.credentials.access_key_id, secret_access_key: ctx.credentials.secret_access_key }
  if (typeof creds.access_key_id !== 'string' || !creds.access_key_id) throw new FormatterConfigError('credentials.access_key_id is not set')
  if (typeof creds.secret_access_key !== 'string' || !creds.secret_access_key) throw new FormatterConfigError('credentials.secret_access_key is not set')
  try {
    const { resolveTenantSecretRefs } = await import('@/lib/config/tenant-secret-refs')
    creds = await resolveTenantSecretRefs(ctx.tenantId, creds, 'log destination credential', 'cloudwatch-secret-key')
  } catch (error) {
    // A refused or missing reference is a configuration problem; the message names the reference, never a value.
    throw new FormatterConfigError(oneLine((error as Error).message))
  }
  return { accessKeyId: String(creds.access_key_id).trim(), secretAccessKey: String(creds.secret_access_key).trim() }
}
