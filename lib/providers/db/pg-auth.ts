import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ClientConfig } from 'pg'
import { parseIntoClientConfig } from 'pg-connection-string'

/**
 * How the app authenticates its own PostgreSQL connections (DATABASE_URL and
 * the pools / LISTEN / scheduler clients built on it):
 *
 *  - password (default)  the password in the URL, as before.
 *  - azure               Azure Database for PostgreSQL with Microsoft Entra
 *                        ID: a token for https://ossrdbms-aad.database.windows.net
 *                        from DefaultAzureCredential (managed identity,
 *                        workload identity, AZURE_* env, az login) is the
 *                        password; the URL's user is the Entra principal.
 *  - gcp                 Cloud SQL / AlloyDB IAM database authentication: a
 *                        Google OAuth access token from Application Default
 *                        Credentials (attached service account, workload
 *                        identity) is the password; the URL's user is the IAM
 *                        principal (service account email without
 *                        `.gserviceaccount.com` on Cloud SQL).
 *  - aws                 RDS / Aurora PostgreSQL IAM database authentication
 *                        (also through RDS Proxy): a 15-minute token from
 *                        @aws-sdk/rds-signer, signed with the instance's
 *                        credentials (task role, instance profile, IRSA,
 *                        AWS_* env) for the URL's host, port and user (a role
 *                        granted rds_iam). Region: DATABASE_AWS_REGION, else
 *                        the RDS host name, else AWS_REGION.
 *
 * Selected with DATABASE_AUTH. Tokens are fetched per new connection and
 * cached until five minutes before they expire (Azure and Google issue ~1
 * hour tokens, RDS 15 minutes; an open connection stays valid after its token
 * expires). All require TLS: add sslmode=require (or verify-full) to the URL,
 * or connect through the Cloud SQL Auth Proxy (which then handles TLS). In
 * aws mode TLS is on unless the URL says sslmode=disable, and the server
 * certificate is verified against DATABASE_SSL_CA_FILE, else the RDS CA
 * bundle shipped in the image (certs/rds-global-bundle.pem), else
 * NODE_EXTRA_CA_CERTS. DATABASE_SSL_CA_FILE applies in every mode.
 *
 * Dependency-free apart from the optional cloud SDKs (loaded on first use),
 * so packages/admin can share it. Tokens are never logged.
 */

export type DatabaseAuthMode = 'password' | 'azure' | 'gcp' | 'aws'

export const AZURE_PG_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default'
export const GCP_SQL_SCOPES = ['https://www.googleapis.com/auth/sqlservice.login']

const REFRESH_MARGIN_MS = 5 * 60_000
/** RDS IAM auth tokens are valid for 15 minutes. */
export const RDS_TOKEN_LIFETIME_MS = 15 * 60_000

export function databaseAuthMode(env: Record<string, string | undefined> = process.env): DatabaseAuthMode {
  const raw = (env.DATABASE_AUTH ?? '').trim().toLowerCase()
  if (raw === '' || raw === 'password') return 'password'
  if (raw === 'azure' || raw === 'entra' || raw === 'azure_ad') return 'azure'
  if (raw === 'gcp' || raw === 'google' || raw === 'cloudsql_iam' || raw === 'iam') return 'gcp'
  if (raw === 'aws' || raw === 'rds' || raw === 'rds_iam' || raw === 'aws_iam') return 'aws'
  throw new Error(`DATABASE_AUTH must be password, azure, gcp or aws (got "${env.DATABASE_AUTH}")`)
}

export interface AccessToken {
  token: string
  expiresAt: number
}

export type TokenSource = () => Promise<AccessToken>

/** Caches a token source's result until shortly before it expires; concurrent callers share one fetch. */
export function cachedTokenSource(fetchToken: TokenSource, now: () => number = Date.now): () => Promise<string> {
  let current: AccessToken | null = null
  let inflight: Promise<AccessToken> | null = null
  return async () => {
    if (current && current.expiresAt - REFRESH_MARGIN_MS > now()) return current.token
    inflight ??= fetchToken().finally(() => { inflight = null })
    current = await inflight
    return current.token
  }
}

function azureTokenSource(): TokenSource {
  let credential: { getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number } | null> } | null = null
  return async () => {
    if (!credential) {
      const { DefaultAzureCredential } = await import('@azure/identity')
      credential = new DefaultAzureCredential()
    }
    const token = await credential.getToken(AZURE_PG_SCOPE)
    if (!token) throw new Error('Microsoft Entra ID returned no token for Azure Database for PostgreSQL')
    return { token: token.token, expiresAt: token.expiresOnTimestamp }
  }
}

function gcpTokenSource(): TokenSource {
  let auth: { getAccessToken(): Promise<string | null | undefined> } | null = null
  return async () => {
    if (!auth) {
      const { GoogleAuth } = await import('google-auth-library')
      auth = new GoogleAuth({ scopes: GCP_SQL_SCOPES })
    }
    const token = await auth.getAccessToken()
    if (!token) throw new Error('Google Application Default Credentials returned no access token for Cloud SQL')
    // getAccessToken refreshes on its own; re-ask well within the hour.
    return { token, expiresAt: Date.now() + 30 * 60_000 }
  }
}

export interface RdsTarget {
  hostname: string
  port: number
  username: string
  region: string
}

/** `<id>.<hash>.<region>.rds.amazonaws.com` (instances, clusters, proxies) → region. */
export function rdsRegionFromHost(host: string): string | undefined {
  return /\.([a-z]{2}(?:-gov|-iso[a-z]*)?-[a-z]+-\d)\.rds\.amazonaws\.com(?:\.cn)?$/i.exec(host)?.[1]?.toLowerCase()
}

export function rdsTarget(config: { host?: string | null; port?: number | string | null; user?: string | null }, env: Record<string, string | undefined> = process.env): RdsTarget {
  const hostname = config.host ?? ''
  const username = config.user ?? ''
  if (!hostname || hostname.startsWith('/')) throw new Error('DATABASE_AUTH=aws needs a TCP host in the database URL (the RDS, Aurora or RDS Proxy endpoint)')
  if (!username) throw new Error('DATABASE_AUTH=aws needs the database user in the URL (a role granted rds_iam)')
  const region = env.DATABASE_AWS_REGION?.trim() || rdsRegionFromHost(hostname) || env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim()
  if (!region) throw new Error('DATABASE_AUTH=aws: set DATABASE_AWS_REGION (or AWS_REGION); the region could not be read from the host name')
  return { hostname, port: Number(config.port) || 5432, username, region }
}

/**
 * The RDS token for one endpoint and user (signed locally; no network call
 * apart from resolving credentials). Lives 15 minutes.
 */
function awsTokenSource(target: RdsTarget, now: () => number): TokenSource {
  let signer: { getAuthToken(): Promise<string> } | null = null
  return async () => {
    if (!signer) {
      const { Signer } = await import('@aws-sdk/rds-signer')
      const { instanceCredentials } = await import('@/lib/aws/credentials')
      const credentials = instanceCredentials()
      signer = new Signer({ ...target, credentials: async () => credentials() })
    }
    const issuedAt = now()
    const token = await signer.getAuthToken()
    if (!token) throw new Error('@aws-sdk/rds-signer returned no token')
    return { token, expiresAt: issuedAt + RDS_TOKEN_LIFETIME_MS }
  }
}

const passwordCallbacks = new Map<string, () => Promise<string>>()

/**
 * The password callback for a token mode: one shared cache per mode (Azure,
 * Google: the token is not tied to a server) or per endpoint and user (RDS)
 * and process.
 */
export function tokenPassword(mode: Exclude<DatabaseAuthMode, 'password'>, target?: RdsTarget, now: () => number = Date.now): () => Promise<string> {
  if (mode === 'aws' && !target) throw new Error('DATABASE_AUTH=aws needs the endpoint and user')
  const key = mode === 'aws' ? `aws|${target!.region}|${target!.hostname}|${target!.port}|${target!.username}` : mode
  let callback = passwordCallbacks.get(key)
  if (!callback) {
    callback = cachedTokenSource(mode === 'azure' ? azureTokenSource() : mode === 'gcp' ? gcpTokenSource() : awsTokenSource(target!, now), now)
    passwordCallbacks.set(key, callback)
  }
  return callback
}

/** Forget cached token callbacks (tests). */
export function resetTokenCallbacks(): void {
  passwordCallbacks.clear()
}

/** Where the Docker image ships the Amazon RDS CA bundle (deploy/aws/rds-global-bundle.pem). */
export const RDS_CA_BUNDLE_PATHS = ['certs/rds-global-bundle.pem', 'deploy/aws/rds-global-bundle.pem']

/** The CA bundle for server verification: DATABASE_SSL_CA_FILE, else (aws) the shipped RDS bundle. */
export function databaseCaFile(mode: DatabaseAuthMode, env: Record<string, string | undefined> = process.env): string | null {
  const explicit = env.DATABASE_SSL_CA_FILE?.trim()
  if (explicit) return explicit
  if (mode !== 'aws') return null
  for (const candidate of RDS_CA_BUNDLE_PATHS) {
    // Resolved at runtime only: keeps the build from tracing the whole project.
    const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), candidate)
    if (existsSync(file)) return file
  }
  return null
}

const caCache = new Map<string, string>()

function readCa(file: string): string {
  let ca = caCache.get(file)
  if (ca === undefined) {
    try {
      ca = readFileSync(file, 'utf8')
    } catch (error) {
      throw new Error(`DATABASE_SSL_CA_FILE ${file} cannot be read: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
    }
    caCache.set(file, ca)
  }
  return ca
}

/** TLS options for a token mode: on unless the URL disables it, verified, with the CA bundle when there is one. */
function tlsFor(mode: DatabaseAuthMode, parsedSsl: unknown, env: Record<string, string | undefined>): ClientConfig['ssl'] {
  if (parsedSsl === false) return false
  const caFile = databaseCaFile(mode, env)
  const base = parsedSsl && typeof parsedSsl === 'object' ? (parsedSsl as Record<string, unknown>) : {}
  if (mode !== 'aws' && !caFile) return parsedSsl as ClientConfig['ssl']
  // The URL's sslrootcert (already in base.ca) wins over the defaults.
  return { ...(caFile && !base.ca ? { ca: readCa(caFile) } : {}), ...base }
}

/**
 * node-postgres connection options for `connectionString` under the
 * configured DATABASE_AUTH: unchanged for passwords, else the URL's password
 * is replaced by a token callback.
 */
export function pgConnectionConfig<E extends object = object>(
  connectionString: string,
  extra: E = {} as E,
  env: Record<string, string | undefined> = process.env,
): E & ClientConfig {
  const mode = databaseAuthMode(env)
  if (mode === 'password' && !env.DATABASE_SSL_CA_FILE?.trim()) return { ...extra, connectionString }
  // node-postgres lets a connection string's (empty) password override a
  // password callback (and its sslmode override `ssl`), so the URL is
  // expanded into discrete fields here.
  const parsed = parseIntoClientConfig(connectionString)
  const ssl = tlsFor(mode, parsed.ssl, env)
  if (mode === 'password') return { ...extra, ...parsed, ssl } as E & ClientConfig
  const password = mode === 'aws' ? tokenPassword(mode, rdsTarget(parsed, env)) : tokenPassword(mode)
  return { ...extra, ...parsed, ...(ssl === undefined ? {} : { ssl }), password } as E & ClientConfig
}

/** A one-line, secret-free description of how DATABASE_URL authenticates (doctor, Infrastructure page). */
export function describeDatabaseAuth(connectionString: string | null | undefined, env: Record<string, string | undefined> = process.env): string {
  const mode = databaseAuthMode(env)
  if (mode === 'password') return env.DATABASE_SSL_CA_FILE?.trim() ? `password (CA ${env.DATABASE_SSL_CA_FILE.trim()})` : 'password'
  if (mode === 'azure') return 'Microsoft Entra ID token (DATABASE_AUTH=azure)'
  if (mode === 'gcp') return 'Cloud SQL / AlloyDB IAM token (DATABASE_AUTH=gcp)'
  if (!connectionString) return 'RDS IAM token (DATABASE_AUTH=aws)'
  const parsed = parseIntoClientConfig(connectionString)
  const target = rdsTarget(parsed, env)
  const caFile = databaseCaFile(mode, env)
  const tls = parsed.ssl === false ? 'TLS disabled by sslmode=disable' : caFile ? `TLS verified with ${path.basename(caFile)}` : 'TLS verified with the system / NODE_EXTRA_CA_CERTS roots'
  return `RDS IAM token for ${target.username}@${target.hostname}:${target.port} in ${target.region} (${tls})`
}
