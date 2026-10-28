import { readFileSync } from 'node:fs'
import type tls from 'node:tls'
import { readEnv } from '@/lib/config/bootstrap'
import {
  cacheBoolOption,
  cacheNumberOption,
  cacheOption,
  DEFAULT_INVALIDATION_CHECK_MS,
  keyPrefix,
  type CacheOptions,
} from './options'
import { parseRedisUrl, RespClient, type RespCredentials, type RespValue } from './resp'
import { AWS_REGION_PATTERN, defaultAwsRegion, instanceCredentials, type AwsCredentialSource } from '@/lib/aws/credentials'
import { presignUrl, type AwsCredentials } from '@/lib/aws/sigv4'
import { CacheStoreError, describeError, windowResult, type CacheStore } from './types'

/**
 * redis: Redis, Valkey, KeyDB or Dragonfly (self-hosted), Azure Cache for
 * Redis / Azure Managed Redis, Amazon ElastiCache, Google Memorystore,
 * Upstash (Redis protocol). Every app replica, the worker and the admin CLI
 * share one window per key.
 *
 * Auth (redis_auth):
 *  - password (default)  redis_password / the URL's password, with an optional
 *                        redis_username (Redis 6 ACL users)
 *  - entra               Microsoft Entra ID token (Azure Cache for Redis /
 *                        Azure Managed Redis with Entra auth): username = the
 *                        identity's object id (redis_username), password = a
 *                        token for redis_entra_scope from DefaultAzureCredential
 *                        (managed identity / workload identity)
 *  - gcp_iam             Memorystore IAM auth: an access token from
 *                        Application Default Credentials (workload identity)
 *  - aws_iam             ElastiCache (Valkey / Redis OSS 7+) or MemoryDB IAM
 *                        auth: username = the IAM-enabled user id
 *                        (redis_username), password = a SigV4-presigned
 *                        `connect` request for redis_aws_cache_name (the
 *                        replication group / serverless cache / MemoryDB
 *                        cluster name), signed with the instance's
 *                        credentials (task role, instance profile, IRSA).
 *                        Valid 15 minutes; TLS is on unless redis_tls=false.
 * Tokens are refreshed and re-sent before they expire (AUTH on the open
 * connection, so ElastiCache's 12-hour limit for IAM connections is extended
 * too).
 *
 * TLS: rediss:// (or redis_tls=true); a private CA via redis_tls_ca_file or
 * NODE_EXTRA_CA_CERTS.
 *
 * Errors carry the server's reason, never a password or token.
 */

// One window per key: INCR, and start the expiry on the window's first hit.
const HIT_SCRIPT = [
  "local c = redis.call('INCR', KEYS[1])",
  "local t = redis.call('PTTL', KEYS[1])",
  "if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end",
  'return {c, t}',
].join('\n')

type TokenSource = () => Promise<RespCredentials>

export interface RedisStoreDeps {
  /** Replace the token source (tests). */
  tokens?: TokenSource
  /** Replace the AWS credential chain for aws_iam (tests). */
  awsCredentials?: AwsCredentialSource
  /** Clock for aws_iam token signing (tests). */
  now?: () => number
  client?: RespClient
}

/** ElastiCache / MemoryDB IAM auth tokens are valid for 15 minutes. */
export const AWS_IAM_TOKEN_LIFETIME_MS = 15 * 60_000
/** A token is reused for this long (so a reconnect storm signs once), then re-signed. */
const AWS_IAM_TOKEN_REUSE_MS = 10 * 60_000

/**
 * The presigned `connect` token ElastiCache / MemoryDB accept as the AUTH
 * password: `<cache name>/?Action=connect&User=<user id>[&ResourceType=ServerlessCache]&X-Amz-…`.
 */
export function awsIamToken(input: { cacheName: string; userId: string; region: string; service: 'elasticache' | 'memorydb'; serverless?: boolean; credentials: AwsCredentials; now: number }): string {
  const query = new URLSearchParams({ Action: 'connect', User: input.userId })
  if (input.serverless) query.set('ResourceType', 'ServerlessCache')
  const url = presignUrl({
    method: 'GET', url: `http://${input.cacheName}/?${query.toString()}`, region: input.region, service: input.service,
    credentials: input.credentials, expiresInSeconds: AWS_IAM_TOKEN_LIFETIME_MS / 1000, now: input.now,
  })
  return url.replace(/^http:\/\//, '')
}

function awsIamTokens(options: CacheOptions, deps: RedisStoreDeps): TokenSource {
  const userId = cacheOption(options, 'redis_username')
  if (!userId) throw new CacheStoreError('CACHE_REDIS_AUTH=aws_iam requires CACHE_REDIS_USERNAME (the IAM-enabled ElastiCache / MemoryDB user id; it must equal the user name)')
  const cacheName = cacheOption(options, 'redis_aws_cache_name')?.toLowerCase()
  if (!cacheName) throw new CacheStoreError('CACHE_REDIS_AUTH=aws_iam requires CACHE_REDIS_AWS_CACHE_NAME (the replication group id, serverless cache name or MemoryDB cluster name)')
  const region = cacheOption(options, 'redis_aws_region') ?? defaultAwsRegion()
  if (!region || !AWS_REGION_PATTERN.test(region)) throw new CacheStoreError('CACHE_REDIS_AUTH=aws_iam requires CACHE_REDIS_AWS_REGION (or AWS_REGION), e.g. eu-west-1')
  const service = (cacheOption(options, 'redis_aws_service') ?? 'elasticache').toLowerCase()
  if (service !== 'elasticache' && service !== 'memorydb') throw new CacheStoreError('CACHE_REDIS_AWS_SERVICE must be elasticache or memorydb')
  const serverless = cacheBoolOption(options, 'redis_aws_serverless') ?? false
  const now = deps.now ?? Date.now
  let current: RespCredentials | null = null
  let signedAt = 0
  return async () => {
    if (current && now() - signedAt < AWS_IAM_TOKEN_REUSE_MS) return current
    const credentials = await (deps.awsCredentials ?? instanceCredentials())()
    signedAt = now()
    const lifetimeEnd = signedAt + AWS_IAM_TOKEN_LIFETIME_MS
    current = {
      username: userId,
      password: awsIamToken({ cacheName, userId, region, service: service as 'elasticache' | 'memorydb', serverless, credentials, now: signedAt }),
      // A presigned token cannot outlive the credentials that signed it.
      expiresAt: Math.min(lifetimeEnd, credentials.expiration?.getTime() ?? lifetimeEnd),
    }
    return current
  }
}

function entraTokens(options: CacheOptions): TokenSource {
  const username = cacheOption(options, 'redis_username')
  if (!username) throw new CacheStoreError('CACHE_REDIS_AUTH=entra requires CACHE_REDIS_USERNAME (the object id of the app\'s managed identity or service principal)')
  const scope = cacheOption(options, 'redis_entra_scope') ?? 'https://redis.azure.com/.default'
  let credential: { getToken(scope: string): Promise<{ token: string; expiresOnTimestamp: number } | null> } | null = null
  return async () => {
    if (!credential) {
      const { DefaultAzureCredential } = await import('@azure/identity')
      credential = new DefaultAzureCredential()
    }
    const token = await credential.getToken(scope)
    if (!token) throw new CacheStoreError('Entra ID returned no token for Redis')
    return { username, password: token.token, expiresAt: token.expiresOnTimestamp }
  }
}

function gcpTokens(options: CacheOptions): TokenSource {
  const username = cacheOption(options, 'redis_username')
  let auth: { getClient(): Promise<{ getAccessToken(): Promise<{ token?: string | null }>; credentials?: { expiry_date?: number | null } }> } | null = null
  return async () => {
    if (!auth) {
      const { GoogleAuth } = await import('google-auth-library')
      auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) as unknown as typeof auth
    }
    const client = await auth!.getClient()
    const { token } = await client.getAccessToken()
    if (!token) throw new CacheStoreError('Application Default Credentials returned no access token for Memorystore')
    return { ...(username ? { username } : {}), password: token, expiresAt: client.credentials?.expiry_date ?? Date.now() + 3_000_000 }
  }
}

export function redisConnection(options: CacheOptions, deps: RedisStoreDeps = {}) {
  const url = cacheOption(options, 'redis_url') ?? readEnv('REDIS_URL')
  if (!url) throw new CacheStoreError('CACHE_PROVIDER=redis requires CACHE_REDIS_URL (redis://host:6379 or rediss://host:6380)')
  let parts
  try {
    parts = parseRedisUrl(url)
  } catch (error) {
    throw new CacheStoreError((error as Error).message)
  }
  const auth = (cacheOption(options, 'redis_auth') ?? 'password').toLowerCase()
  if (!['password', 'entra', 'gcp_iam', 'aws_iam'].includes(auth)) throw new CacheStoreError('CACHE_REDIS_AUTH must be password, entra, gcp_iam or aws_iam')
  // ElastiCache / MemoryDB only take IAM auth over TLS (in-transit encryption).
  const useTls = cacheBoolOption(options, 'redis_tls') ?? (parts.tls || auth === 'aws_iam')
  let tlsOptions: tls.ConnectionOptions | null = null
  if (useTls) {
    const caFile = cacheOption(options, 'redis_tls_ca_file')
    let ca: string | undefined
    if (caFile) {
      try {
        ca = readFileSync(caFile, 'utf8')
      } catch (error) {
        throw new CacheStoreError(`CACHE_REDIS_TLS_CA_FILE cannot be read: ${describeError(error)}`)
      }
    }
    const servername = cacheOption(options, 'redis_tls_servername')
    tlsOptions = {
      ...(ca ? { ca } : {}),
      ...(servername ? { servername } : {}),
      rejectUnauthorized: cacheBoolOption(options, 'redis_tls_reject_unauthorized') ?? true,
    }
  }
  const tokens = deps.tokens ?? (auth === 'entra' ? entraTokens(options) : auth === 'gcp_iam' ? gcpTokens(options) : auth === 'aws_iam' ? awsIamTokens(options, deps) : null)
  const username = cacheOption(options, 'redis_username') ?? parts.username
  const password = cacheOption(options, 'redis_password') ?? parts.password
  const db = cacheOption(options, 'redis_db') ? Number(cacheOption(options, 'redis_db')) : parts.db
  return {
    host: parts.host,
    port: parts.port,
    tls: tlsOptions,
    db,
    auth,
    credentials: tokens ?? (async () => (password !== undefined ? { ...(username ? { username } : {}), password } : null)),
  }
}

export function createRedisCacheStore(options: CacheOptions, deps: RedisStoreDeps = {}): CacheStore {
  const connection = redisConnection(options, deps)
  const prefix = keyPrefix(options)
  const commandTimeoutMs = cacheNumberOption(options, 'redis_command_timeout_ms', 2_000)
  const client = deps.client ?? new RespClient({
    host: connection.host,
    port: connection.port,
    tls: connection.tls,
    db: connection.db,
    credentials: connection.credentials,
    commandTimeoutMs,
    connectTimeoutMs: Math.max(commandTimeoutMs, 5_000),
  })
  const k = (key: string) => `${prefix}${key}`

  async function run(args: Array<string | number>): Promise<RespValue> {
    try {
      return await client.command(args)
    } catch (error) {
      throw new CacheStoreError(`Redis ${String(args[0])}: ${describeError(error)}`)
    }
  }

  return {
    id: 'redis',
    onPrem: true,
    shared: true,
    invalidationCheckMs: cacheNumberOption(options, 'invalidation_check_ms', DEFAULT_INVALIDATION_CHECK_MS),
    async get(key) {
      const value = await run(['GET', k(key)])
      return typeof value === 'string' ? value : null
    },
    async set(key, value, ttlMs) {
      await run(ttlMs === undefined ? ['SET', k(key), value] : ['SET', k(key), value, 'PX', Math.max(1, Math.ceil(ttlMs))])
    },
    async setIfAbsent(key, value, ttlMs) {
      return (await run(['SET', k(key), value, 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX'])) === 'OK'
    },
    async delete(key) {
      await run(['DEL', k(key)])
    },
    async hit(key, { max, windowMs }) {
      const reply = await run(['EVAL', HIT_SCRIPT, 1, k(key), Math.max(1, Math.ceil(windowMs))])
      const [count, ttl] = Array.isArray(reply) ? reply.map(Number) : [NaN, NaN]
      if (!Number.isFinite(count)) throw new CacheStoreError('Redis returned an unexpected rate-limit reply')
      return windowResult(count, ttl, max)
    },
    async incr(key) {
      return Number(await run(['INCR', k(key)]))
    },
    async ping() {
      const pong = await run(['PING'])
      let version = ''
      try {
        const info = await client.command(['INFO', 'server'])
        const text = typeof info === 'string' ? info : ''
        const valkey = /valkey_version:([^\r\n]+)/.exec(text)?.[1]
        const redis = /redis_version:([^\r\n]+)/.exec(text)?.[1]
        version = valkey ? ` Valkey ${valkey}` : redis ? ` Redis ${redis}` : ''
      } catch {
        // INFO is often disabled on managed services.
      }
      return `${pong === 'PONG' ? 'PONG' : String(pong)} from ${connection.host}:${connection.port}${version}${connection.tls ? ' (TLS)' : ''}${connection.auth !== 'password' ? ` (${connection.auth} auth)` : ''}`
    },
    async close() {
      await client.close()
    },
  }
}
