import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { AWS_IAM_TOKEN_LIFETIME_MS, awsIamToken, createRedisCacheStore, redisConnection } from '@/lib/providers/cache/redis'
import { parseRedisUrl, RespClient } from '@/lib/providers/cache/resp'
import type { AwsCredentials } from '@/lib/aws/sigv4'

/**
 * CACHE_REDIS_AUTH=aws_iam (ElastiCache / MemoryDB IAM auth). The fake
 * credential chain stands in for the task role; against a real Valkey
 * (CACHE_TEST_REDIS_URL) an ACL user's password is set to the presigned
 * token the store will send, and rotated as tokens are re-signed — what
 * ElastiCache checks, minus the signature.
 */

const REDIS_URL = process.env.CACHE_TEST_REDIS_URL
const CREDS: AwsCredentials = { accessKeyId: 'ASIATESTKEY', secretAccessKey: 'never-logged-secret-key', sessionToken: 'session-token-value' }
const fakeChain = (creds: AwsCredentials = CREDS) => vi.fn(async () => creds)

afterEach(() => vi.useRealTimers())

describe('aws_iam options and tokens', () => {
  const base = { redis_url: 'rediss://master.acme-ut.abc123.euw1.cache.amazonaws.com:6379', redis_auth: 'aws_iam', redis_username: 'usertasks-app', redis_aws_cache_name: 'Acme-UT', redis_aws_region: 'eu-west-1' }

  it('the token is a presigned connect request for the cache and user', () => {
    const token = awsIamToken({ cacheName: 'acme-ut', userId: 'usertasks-app', region: 'eu-west-1', service: 'elasticache', credentials: CREDS, now: Date.UTC(2026, 9, 26, 12) })
    expect(token.startsWith('acme-ut/?')).toBe(true)
    const query = new URL(`http://${token}`).searchParams
    expect(query.get('Action')).toBe('connect')
    expect(query.get('User')).toBe('usertasks-app')
    expect(query.get('X-Amz-Expires')).toBe('900')
    expect(query.get('X-Amz-Credential')).toBe('ASIATESTKEY/20261026/eu-west-1/elasticache/aws4_request')
    expect(query.get('X-Amz-Security-Token')).toBe('session-token-value')
    expect(query.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(token).not.toContain('never-logged-secret-key')
    const serverless = awsIamToken({ cacheName: 'acme-ut', userId: 'u', region: 'eu-west-1', service: 'elasticache', serverless: true, credentials: CREDS, now: 0 })
    expect(new URL(`http://${serverless}`).searchParams.get('ResourceType')).toBe('ServerlessCache')
    const memorydb = awsIamToken({ cacheName: 'acme-ut', userId: 'u', region: 'eu-west-1', service: 'memorydb', credentials: CREDS, now: 0 })
    expect(new URL(`http://${memorydb}`).searchParams.get('X-Amz-Credential')).toMatch(/\/memorydb\/aws4_request$/)
  })

  it('needs the user, cache name and region; TLS is on by default', async () => {
    expect(() => redisConnection({ ...base, redis_username: '' })).toThrow(/CACHE_REDIS_USERNAME/)
    expect(() => redisConnection({ ...base, redis_aws_cache_name: '' })).toThrow(/CACHE_REDIS_AWS_CACHE_NAME/)
    const previous = { AWS_REGION: process.env.AWS_REGION, AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION }
    delete process.env.AWS_REGION
    delete process.env.AWS_DEFAULT_REGION
    try {
      expect(() => redisConnection({ ...base, redis_aws_region: '' })).toThrow(/CACHE_REDIS_AWS_REGION/)
    } finally {
      Object.assign(process.env, Object.fromEntries(Object.entries(previous).filter(([, v]) => v !== undefined)))
    }
    expect(() => redisConnection({ ...base, redis_aws_service: 'dynamodb' })).toThrow(/elasticache or memorydb/)
    expect(redisConnection({ ...base, redis_url: 'redis://cache:6379' }, { awsCredentials: fakeChain() }).tls).toBeTruthy()
    expect(redisConnection({ ...base, redis_url: 'redis://cache:6379', redis_tls: 'false' }, { awsCredentials: fakeChain() }).tls).toBeNull()
    expect(() => redisConnection({ ...base, redis_auth: 'kerberos' })).toThrow(/aws_iam/)
  })

  it('signs with the cache name lower-cased, reuses a token for 10 minutes, then re-signs', async () => {
    let now = Date.UTC(2026, 9, 26, 12)
    const chain = fakeChain()
    const conn = redisConnection(base, { awsCredentials: chain, now: () => now })
    const first = (await conn.credentials()) as { password: string; expiresAt?: number }
    expect(first).toMatchObject({ username: 'usertasks-app', expiresAt: now + AWS_IAM_TOKEN_LIFETIME_MS })
    expect(first!.password.startsWith('acme-ut/?')).toBe(true)
    now += 9 * 60_000
    expect((await conn.credentials())!.password).toBe(first!.password)
    now += 61_000
    const second = await conn.credentials()
    expect(second!.password).not.toBe(first!.password)
    expect(chain).toHaveBeenCalledTimes(2)
  })

  it('a token never outlives the credentials that signed it', async () => {
    const now = Date.UTC(2026, 9, 26, 12)
    const conn = redisConnection(base, { awsCredentials: fakeChain({ ...CREDS, expiration: new Date(now + 6 * 60_000) }), now: () => now })
    expect(((await conn.credentials()) as { expiresAt?: number }).expiresAt).toBe(now + 6 * 60_000)
  })
})

describe.skipIf(!REDIS_URL)('aws_iam against Valkey (ACL user, rotated token passwords)', () => {
  const user = `ut-iam-${randomUUID().slice(0, 8)}`
  let admin: RespClient
  const parts = REDIS_URL ? parseRedisUrl(REDIS_URL) : null
  const options = () => ({ redis_url: REDIS_URL, redis_tls: 'false', redis_auth: 'aws_iam', redis_username: user, redis_aws_cache_name: 'local-cache', redis_aws_region: 'eu-west-1', key_prefix: `iam${randomUUID().slice(0, 6)}:` })
  const tokenAt = (now: number) => awsIamToken({ cacheName: 'local-cache', userId: user, region: 'eu-west-1', service: 'elasticache', credentials: CREDS, now })

  beforeAll(async () => {
    admin = new RespClient({ host: parts!.host, port: parts!.port, credentials: async () => (parts!.password ? { password: parts!.password } : null) })
    await admin.command(['ACL', 'SETUSER', user, 'on', 'nopass', 'off'])
  })
  afterAll(async () => {
    await admin.command(['ACL', 'DELUSER', user]).catch(() => undefined)
    await admin.close()
  })

  it('authenticates with the token, and reconnects with a re-signed one after rotation', async () => {
    let now = Date.UTC(2026, 9, 26, 12)
    const store = createRedisCacheStore(options(), { awsCredentials: fakeChain(), now: () => now })
    await admin.command(['ACL', 'SETUSER', user, 'reset', 'on', `>${tokenAt(now)}`, '~*', '+@all'])
    await store.set('k', 'v', 60_000)
    expect(await store.get('k')).toBe('v')

    // 11 minutes on: only a newly signed token is accepted, and the server drops the old session.
    now += 11 * 60_000
    await admin.command(['ACL', 'SETUSER', user, 'resetpass', `>${tokenAt(now)}`])
    await admin.command(['CLIENT', 'KILL', 'USER', user])
    let value: string | null = null
    for (let i = 0; i < 20 && value === null; i++) {
      value = await store.get('k').catch(() => null)
      if (value === null) await new Promise((r) => setTimeout(r, 100))
    }
    expect(value).toBe('v')
    await store.close?.()
  })

  it('re-AUTHs the open connection with a fresh token before the old one lapses', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const start = Date.now()
    const chain = fakeChain()
    const conn = redisConnection(options(), { awsCredentials: chain })
    await admin.command(['ACL', 'SETUSER', user, 'reset', 'on', `>${tokenAt(start)}`, '~*', '+@all'])
    const client = new RespClient({ host: conn.host, port: conn.port, credentials: conn.credentials })
    try {
      const id = await client.command(['CLIENT', 'ID'])
      // The re-AUTH runs a minute before the 15-minute token expires; the server only knows the new token by then.
      const reauthAt = start + AWS_IAM_TOKEN_LIFETIME_MS - 60_000
      await admin.command(['ACL', 'SETUSER', user, 'resetpass', `>${tokenAt(reauthAt)}`])
      await vi.advanceTimersByTimeAsync(AWS_IAM_TOKEN_LIFETIME_MS - 60_000)
      for (let i = 0; i < 50 && chain.mock.calls.length < 2; i++) await new Promise((r) => setImmediate(r))
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
      expect(chain).toHaveBeenCalledTimes(2)
      vi.useRealTimers()
      // Same connection (no teardown: the new token was accepted), still authenticated as the IAM user.
      expect(await client.command(['CLIENT', 'ID'])).toBe(id)
      expect(await client.command(['ACL', 'WHOAMI'])).toBe(user)
    } finally {
      vi.useRealTimers()
      await client.close()
    }
  })

  it('a rejected token fails with the server reason and no secret material', async () => {
    await admin.command(['ACL', 'SETUSER', user, 'reset', 'on', '>some-other-token', '~*', '+@all'])
    const store = createRedisCacheStore(options(), { awsCredentials: fakeChain() })
    const error = await store.get('k').catch((e: Error) => e)
    expect(String(error)).toMatch(/AUTH failed/)
    expect(String(error)).not.toContain('never-logged-secret-key')
    expect(String(error)).not.toContain('X-Amz-Signature')
    await store.close?.()
  })
})
