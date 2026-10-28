import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { checkRateLimit, rateLimit } from '@/lib/rate-limit'
import { resolveCacheStore } from '@/lib/providers/cache'
import type { CacheStore } from '@/lib/providers/cache/types'
import { createMemoryCacheStore, resetMemoryCacheForTests } from '@/lib/providers/cache/memory'
import { createPostgresCacheStore, pgCacheSql, sweepPostgresCache } from '@/lib/providers/cache/postgres'
import { createRedisCacheStore, redisConnection } from '@/lib/providers/cache/redis'
import { encodeCommand, parseRedisUrl, parseReply, RespClient, RespReplyError } from '@/lib/providers/cache/resp'
import { GenerationWatcher, publishInvalidation } from '@/lib/providers/cache/invalidation'
import { claimIdempotencyKey, idempotencyClaimKey, releaseIdempotencyKey } from '@/lib/idempotency'

/**
 * Cache / rate-limit store (providers phase 13): the same contract on every
 * store (memory; postgres over EVENT_STREAM_DB_URL; redis / Valkey over
 * CACHE_TEST_REDIS_URL), the RESP client (framing, AUTH with rotating
 * tokens, reconnects, cluster refusal, timeouts), and multi-replica
 * correctness: several separate Node processes running the real app
 * modules share one rate-limit window and see each other's credential and
 * config invalidations — while with the memory store they don't.
 */

const DB_URL = process.env.EVENT_STREAM_DB_URL
const REDIS_URL = process.env.CACHE_TEST_REDIS_URL
const ROOT = process.cwd()

afterEach(() => resetMemoryCacheForTests())

// ── contract ────────────────────────────────────────────────────────────────

function contract(name: string, make: () => Promise<CacheStore>, cleanup?: () => Promise<void>) {
  describe(`${name} store contract`, () => {
    let store: CacheStore
    beforeAll(async () => { store = await make() })
    afterAll(async () => { await store?.close?.(); await cleanup?.() })
    const key = () => `test:${randomUUID()}`

    it('get / set / delete, with and without a TTL', async () => {
      const k = key()
      expect(await store.get(k)).toBeNull()
      await store.set(k, 'a')
      expect(await store.get(k)).toBe('a')
      await store.set(k, 'b', 60_000)
      expect(await store.get(k)).toBe('b')
      await store.delete(k)
      expect(await store.get(k)).toBeNull()
      await store.set(k, 'short', 50)
      await new Promise((r) => setTimeout(r, 120))
      expect(await store.get(k)).toBeNull()
    })

    it('setIfAbsent claims once, and again after expiry', async () => {
      const k = key()
      expect(await store.setIfAbsent(k, '1', 150)).toBe(true)
      expect(await store.setIfAbsent(k, '2', 150)).toBe(false)
      expect(await store.get(k)).toBe('1')
      await new Promise((r) => setTimeout(r, 220))
      expect(await store.setIfAbsent(k, '3', 150)).toBe(true)
      await store.delete(k)
    })

    it('incr counts from 1 and never expires', async () => {
      const k = key()
      expect(await store.incr(k)).toBe(1)
      expect(await store.incr(k)).toBe(2)
      expect(await store.get(k)).toBe('2')
      await store.delete(k)
    })

    it('hit: a fixed window allowing max hits, then retryAfter until it ends', async () => {
      const k = key()
      const opts = { max: 3, windowMs: 400 }
      const results = []
      for (let i = 0; i < 5; i++) results.push(await store.hit(k, opts))
      expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false])
      expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0, 0])
      expect(results[3].retryAfterMs).toBeGreaterThan(0)
      expect(results[3].retryAfterMs).toBeLessThanOrEqual(400)
      await new Promise((r) => setTimeout(r, 450))
      expect((await store.hit(k, opts)).ok).toBe(true)
      await store.delete(k)
    })

    it('hit: concurrent hits never exceed max', async () => {
      const k = key()
      const results = await Promise.all(Array.from({ length: 40 }, () => store.hit(k, { max: 10, windowMs: 30_000 })))
      expect(results.filter((r) => r.ok)).toHaveLength(10)
      await store.delete(k)
    })

    it('ping describes the backend', async () => {
      expect(await store.ping()).toMatch(/\w/)
    })
  })
}

contract('memory', async () => createMemoryCacheStore())

describe('memory store', () => {
  it('is per process, and shares windows with the synchronous checkRateLimit', async () => {
    const store = createMemoryCacheStore()
    expect(store.shared).toBe(false)
    const k = `mixed:${randomUUID()}`
    expect(checkRateLimit(k, { max: 2, windowMs: 60_000 }).ok).toBe(true)
    expect((await store.hit(k, { max: 2, windowMs: 60_000 })).ok).toBe(true)
    expect(checkRateLimit(k, { max: 2, windowMs: 60_000 }).ok).toBe(false)
  })

  it('rateLimit() with the memory provider behaves like checkRateLimit', async () => {
    const previous = process.env.CACHE_PROVIDER
    process.env.CACHE_PROVIDER = 'memory'
    try {
      const k = `default:${randomUUID()}`
      const got = []
      for (let i = 0; i < 4; i++) got.push((await rateLimit(k, { max: 3, windowMs: 60_000 })).ok)
      expect(got).toEqual([true, true, true, false])
      expect(checkRateLimit(k, { max: 3, windowMs: 60_000 }).ok).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.CACHE_PROVIDER
      else process.env.CACHE_PROVIDER = previous
    }
  })

  it('idempotency claims: first wins, release frees the key', async () => {
    const previous = process.env.CACHE_PROVIDER
    process.env.CACHE_PROVIDER = 'memory'
    try {
      const order = `order-${randomUUID()}`
      const claim = idempotencyClaimKey('test', 'tenant-1', order)
      expect(claim).not.toContain(order)
      expect(await claimIdempotencyKey(claim)).toBe(true)
      expect(await claimIdempotencyKey(claim)).toBe(false)
      const other = idempotencyClaimKey('test', 'tenant-2', order)
      expect(await claimIdempotencyKey(other)).toBe(true)
      await releaseIdempotencyKey(claim)
      expect(await claimIdempotencyKey(claim)).toBe(true)
      await releaseIdempotencyKey(claim)
      await releaseIdempotencyKey(other)
    } finally {
      if (previous === undefined) delete process.env.CACHE_PROVIDER
      else process.env.CACHE_PROVIDER = previous
    }
  })
})

// postgres: the SQL functions over a direct connection (the admin CLI's path).
let pgClient: pg.Client | null = null
if (DB_URL) {
  contract('postgres', async () => {
    pgClient = new pg.Client({ connectionString: DB_URL })
    await pgClient.connect()
    await pgClient.query('SET ROLE service_role')
    return createPostgresCacheStore({ key_prefix: `t${randomUUID().slice(0, 8)}:` }, { sql: pgCacheSql(pgClient) })
  }, async () => { await pgClient?.end() })
}

describe.skipIf(!DB_URL)('postgres store specifics', () => {
  let admin: pg.Client
  beforeAll(async () => { admin = new pg.Client({ connectionString: DB_URL }); await admin.connect() })
  afterAll(async () => { await admin?.end() })

  it('only service_role may call the functions; the table is unreachable directly', async () => {
    for (const role of ['anon', 'authenticated']) {
      await admin.query(`SET ROLE ${role}`)
      await expect(admin.query(`SELECT * FROM public.app_cache_get('x')`)).rejects.toThrow(/permission denied/)
      await expect(admin.query('SELECT * FROM app_cache.entries')).rejects.toThrow(/permission denied/)
      await admin.query('RESET ROLE')
    }
    await admin.query('SET ROLE service_role')
    await expect(admin.query('SELECT * FROM app_cache.entries')).rejects.toThrow(/permission denied/)
    await expect(admin.query(`SELECT * FROM public.app_cache_get('x')`)).resolves.toBeTruthy()
    await admin.query('RESET ROLE')
  })

  it('the table is UNLOGGED and the sweep deletes expired rows only', async () => {
    const { rows } = await admin.query(`SELECT relpersistence FROM pg_class WHERE oid = 'app_cache.entries'::regclass`)
    expect(rows[0].relpersistence).toBe('u')
    await admin.query('SET ROLE service_role')
    const sql = pgCacheSql(admin)
    const store = createPostgresCacheStore({ key_prefix: `sweep${randomUUID().slice(0, 6)}:` }, { sql })
    await store.set('gone', 'x', 1)
    await store.set('kept', 'y', 60_000)
    await new Promise((r) => setTimeout(r, 20))
    expect(await sweepPostgresCache(sql, 10_000)).toBeGreaterThanOrEqual(1)
    expect(await store.get('kept')).toBe('y')
    await store.delete('kept')
    await admin.query('RESET ROLE')
  })
})

if (REDIS_URL) {
  contract('redis', async () => createRedisCacheStore({ redis_url: REDIS_URL, key_prefix: `t${randomUUID().slice(0, 8)}:` }))
}

// ── RESP client ─────────────────────────────────────────────────────────────

describe('RESP framing and URLs', () => {
  it('encodes commands as arrays of bulk strings', () => {
    expect(encodeCommand(['SET', 'k', 'héllo', 5]).toString()).toBe('*4\r\n$3\r\nSET\r\n$1\r\nk\r\n$6\r\nhéllo\r\n$1\r\n5\r\n')
  })

  it('parses every reply type and waits for partial ones', () => {
    const buf = Buffer.from('+OK\r\n:42\r\n$-1\r\n$3\r\nabc\r\n*2\r\n:1\r\n$1\r\nx\r\n-ERR bad\r\n')
    const values: unknown[] = []
    let offset = 0
    for (;;) {
      const r = parseReply(buf, offset)
      if (!r) break
      values.push(r.value)
      offset = r.next
    }
    expect(values.slice(0, 5)).toEqual(['OK', 42, null, 'abc', [1, 'x']])
    expect(values[5]).toBeInstanceOf(RespReplyError)
    expect(parseReply(Buffer.from('$5\r\nab'))).toBeNull()
    expect(parseReply(Buffer.from('*2\r\n:1\r\n'))).toBeNull()
  })

  it('parses redis / rediss / valkey URLs', () => {
    expect(parseRedisUrl('redis://cache:6379')).toEqual({ host: 'cache', port: 6379, tls: false })
    expect(parseRedisUrl('rediss://app:p%40ss@my.redis.cache.windows.net:6380/2')).toEqual({ host: 'my.redis.cache.windows.net', port: 6380, tls: true, username: 'app', password: 'p@ss', db: 2 })
    expect(parseRedisUrl('valkey://[::1]').host).toBe('::1')
    expect(() => parseRedisUrl('http://x')).toThrow(/redis:\/\//)
    expect(() => parseRedisUrl('redis://x/abc')).toThrow(/database number/)
  })

  it('configuration errors name the option, never a password', () => {
    expect(() => redisConnection({})).toThrow(/CACHE_REDIS_URL/)
    expect(() => redisConnection({ redis_url: 'redis://x', redis_auth: 'kerberos' })).toThrow(/CACHE_REDIS_AUTH/)
    expect(() => redisConnection({ redis_url: 'redis://x', redis_auth: 'entra' })).toThrow(/CACHE_REDIS_USERNAME/)
    const tls = redisConnection({ redis_url: 'rediss://x:6380', redis_tls_servername: 'x.example' })
    expect(tls.tls).toEqual({ servername: 'x.example', rejectUnauthorized: true })
  })
})

/** A fake server that answers every command with `reply` (or never). */
async function fakeServer(reply: string | null): Promise<{ port: number; close: () => Promise<void>; received: string[] }> {
  const received: string[] = []
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('data', (d) => { received.push(d.toString()); if (reply !== null) socket.write(reply) })
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  return { port, received, close: async () => { for (const s of sockets) s.destroy(); await new Promise((r) => server.close(r)) } }
}

describe('RESP client behaviour', () => {
  it('refuses Redis Cluster redirects with an explanation', async () => {
    const server = await fakeServer('-MOVED 3999 10.0.0.2:6379\r\n')
    const client = new RespClient({ host: '127.0.0.1', port: server.port })
    await expect(client.command(['GET', 'k'])).rejects.toThrow(/Cluster mode is not supported/)
    await client.close()
    await server.close()
  })

  it('a command timeout closes the connection; the next command reconnects', async () => {
    const server = await fakeServer(null)
    const client = new RespClient({ host: '127.0.0.1', port: server.port, commandTimeoutMs: 100 })
    await expect(client.command(['PING'])).rejects.toThrow(/timed out/)
    await expect(client.command(['PING'])).rejects.toThrow(/timed out|connect/)
    await client.close()
    await server.close()
  })

  it('sends AUTH with a username and the current token on every (re)connection', async () => {
    const server = await fakeServer('+OK\r\n')
    let n = 0
    const client = new RespClient({ host: '127.0.0.1', port: server.port, credentials: async () => ({ username: 'oid-1', password: `token-${++n}`, expiresAt: Date.now() + 3_600_000 }) })
    expect(await client.command(['PING'])).toBe('OK')
    expect(server.received.join('')).toContain('AUTH\r\n$5\r\noid-1\r\n$7\r\ntoken-1')
    await client.close()
    await server.close()
  })

  it('an unreachable server fails fast with the address', async () => {
    const client = new RespClient({ host: '127.0.0.1', port: 9, connectTimeoutMs: 1000 })
    await expect(client.command(['PING'])).rejects.toThrow(/127\.0\.0\.1:9/)
    await client.close()
  })
})

describe.skipIf(!REDIS_URL)('redis: ACL users, rotating tokens, reconnects (real server)', () => {
  const user = `ut_${randomUUID().slice(0, 8)}`
  let admin: RespClient
  beforeAll(async () => {
    const parts = parseRedisUrl(REDIS_URL!)
    admin = new RespClient({ host: parts.host, port: parts.port, credentials: async () => (parts.password ? { password: parts.password } : null) })
    await admin.command(['ACL', 'SETUSER', user, 'on', '>token-a', '~*', '+@all'])
  })
  afterAll(async () => {
    await admin.command(['ACL', 'DELUSER', user]).catch(() => undefined)
    await admin.close()
  })

  it('token auth: a rotated token is used when the server drops the connection', async () => {
    let token = 'token-a'
    const store = createRedisCacheStore({ redis_url: REDIS_URL, redis_auth: 'entra', redis_username: user, key_prefix: `acl${randomUUID().slice(0, 6)}:` }, {
      tokens: async () => ({ username: user, password: token, expiresAt: Date.now() + 3_600_000 }),
    })
    await store.set('k', 'v', 10_000)
    // The IdP rotates the token; the server only accepts the new one and drops the old session.
    token = 'token-b'
    await admin.command(['ACL', 'SETUSER', user, 'resetpass', '>token-b'])
    await admin.command(['CLIENT', 'KILL', 'USER', user])
    let value: string | null = null
    for (let i = 0; i < 10 && value === null; i++) {
      value = await store.get('k').catch(() => null)
      if (value === null) await new Promise((r) => setTimeout(r, 100))
    }
    expect(value).toBe('v')
    await store.close?.()
  })

  it('a wrong password fails with the server reason and without the password', async () => {
    const store = createRedisCacheStore({ redis_url: REDIS_URL, redis_username: user, redis_password: 'definitely-wrong-secret' })
    const error = await store.get('k').catch((e: Error) => e)
    expect(String(error)).toMatch(/AUTH failed/)
    expect(String(error)).not.toContain('definitely-wrong-secret')
    await store.close?.()
  })
})

// ── invalidation generations (in process) ───────────────────────────────────

describe('generation watcher', () => {
  it('reports a change once per bump, at most every invalidationCheckMs', async () => {
    const shared = { ...createMemoryCacheStore(), shared: true, invalidationCheckMs: 0 }
    const watcher = new GenerationWatcher('credentials')
    expect(await watcher.check(shared)).toBe(false) // first look records the value
    expect(await watcher.check(shared)).toBe(false)
    await publishInvalidation('credentials', shared)
    expect(await watcher.check(shared)).toBe(true)
    expect(await watcher.check(shared)).toBe(false)
    const slow = { ...shared, invalidationCheckMs: 60_000 }
    const w2 = new GenerationWatcher('credentials')
    await w2.check(slow)
    await publishInvalidation('credentials', slow)
    expect(await w2.check(slow)).toBe(false) // not re-read within the interval
  })

  it('treats an unreadable store as changed (callers reload from the database)', async () => {
    const broken = { ...createMemoryCacheStore(), shared: true, invalidationCheckMs: 0, get: async () => { throw new Error('down') } }
    expect(await new GenerationWatcher('config').check(broken)).toBe(true)
  })

  it('never publishes to a per-process store', async () => {
    const store = createMemoryCacheStore()
    await publishInvalidation('config', store)
    expect(await store.get('gen:config')).toBeNull()
  })
})

describe('resolveCacheStore', () => {
  it('maps ids to stores with their onPrem / shared flags', () => {
    expect(resolveCacheStore('memory', {})).toMatchObject({ id: 'memory', onPrem: true, shared: false })
    expect(resolveCacheStore('postgres', {})).toMatchObject({ id: 'postgres', onPrem: true, shared: true })
    expect(resolveCacheStore('redis', { redis_url: 'redis://127.0.0.1:1' })).toMatchObject({ id: 'redis', onPrem: true, shared: true })
  })
})

// ── multi-replica correctness (separate processes) ──────────────────────────

class Replica {
  private lines: AsyncIterator<string>
  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  }

  static async start(env: Record<string, string>): Promise<Replica> {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, '__tests__/fixtures/cache-replica.ts')], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'test', ...env },
    })
    child.stderr.on('data', (d) => { if (process.env.CACHE_TEST_DEBUG) process.stderr.write(d) })
    const replica = new Replica(child)
    const first = await replica.read()
    if (!first.ready) throw new Error('replica did not start')
    return replica
  }

  private async read(): Promise<Record<string, unknown>> {
    const { value, done } = await this.lines.next()
    if (done) throw new Error('replica exited')
    return JSON.parse(value)
  }

  async send(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.child.stdin.write(`${JSON.stringify(cmd)}\n`)
    const reply = await this.read()
    if (reply.error) throw new Error(String(reply.error))
    return reply
  }

  stop() {
    this.child.stdin.end()
    this.child.kill()
  }
}

/** Environment of a replica process: the app on pg-query over the local DB, the given cache store. */
function replicaEnv(cache: Record<string, string>): Record<string, string> {
  return {
    DB_PROVIDER: 'postgres',
    DATABASE_URL: DB_URL!,
    // Few connections per replica: the suite shares the local server with every other DB test.
    DATABASE_POOL_MAX: '2',
    CACHE_INVALIDATION_CHECK_MS: '0',
    CACHE_KEY_PREFIX: `mr${randomUUID().slice(0, 8)}:`,
    ...cache,
  }
}

function multiReplica(name: string, cache: () => Record<string, string>) {
  describe(`multi-replica: ${name}`, () => {
    let a: Replica
    let b: Replica
    let c: Replica
    beforeAll(async () => {
      const env = replicaEnv(cache())
      ;[a, b, c] = await Promise.all([Replica.start(env), Replica.start(env), Replica.start(env)])
    }, 60_000)
    afterAll(() => { a?.stop(); b?.stop(); c?.stop() })

    it('three processes hammering one key share a single window', async () => {
      const key = `login:${randomUUID()}`
      const results = await Promise.all([a, b, c].map((r) => r.send({ op: 'hit', key, max: 25, windowMs: 60_000, n: 20 })))
      expect(results.reduce((sum, r) => sum + Number(r.ok), 0)).toBe(25)
    })

    it('a credential revoked on one replica is dropped by the others', async () => {
      const key = `cred-${randomUUID()}`
      await a.send({ op: 'cacheCredential', key })
      await c.send({ op: 'cacheCredential', key })
      expect((await a.send({ op: 'cachedCredential', key })).cached).toBe(true)
      await b.send({ op: 'invalidateCredentials' })
      expect((await a.send({ op: 'cachedCredential', key })).cached).toBe(false)
      expect((await c.send({ op: 'cachedCredential', key })).cached).toBe(false)
    })

    it('an instance setting written by one replica is seen by the others at once (not after the 30 s TTL)', async () => {
      const key = `instance.cache_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`
      try {
        expect((await a.send({ op: 'setting', key })).value).toBeNull()
        await b.send({ op: 'setSetting', key, value: 'v1' })
        expect((await a.send({ op: 'setting', key })).value).toBe('v1')
        await b.send({ op: 'setSetting', key, value: 'v2' })
        expect((await c.send({ op: 'setting', key })).value).toBe('v2')
        expect((await a.send({ op: 'setting', key })).value).toBe('v2')
      } finally {
        await b.send({ op: 'deleteSetting', key }).catch(() => undefined)
      }
    })
  })
}

describe.skipIf(!DB_URL)('multi-replica baseline (memory store)', () => {
  let a: Replica
  let b: Replica
  beforeAll(async () => {
    const env = replicaEnv({ CACHE_PROVIDER: 'memory' })
    ;[a, b] = await Promise.all([Replica.start(env), Replica.start(env)])
  }, 60_000)
  afterAll(() => { a?.stop(); b?.stop() })

  it('each process has its own window and caches (why shared stores exist)', async () => {
    const key = `login:${randomUUID()}`
    const results = await Promise.all([a, b].map((r) => r.send({ op: 'hit', key, max: 5, windowMs: 60_000, n: 10 })))
    expect(results.map((r) => r.ok)).toEqual([5, 5])
    const cred = `cred-${randomUUID()}`
    await a.send({ op: 'cacheCredential', key: cred })
    await b.send({ op: 'invalidateCredentials' })
    expect((await a.send({ op: 'cachedCredential', key: cred })).cached).toBe(true)
  })
})

if (DB_URL) multiReplica('postgres store', () => ({ CACHE_PROVIDER: 'postgres' }))
if (DB_URL && REDIS_URL) multiReplica('redis store', () => ({ CACHE_PROVIDER: 'redis', CACHE_REDIS_URL: REDIS_URL! }))
